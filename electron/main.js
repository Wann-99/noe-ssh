const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { setupAutoUpdater, checkForUpdatesManual } = require('./updater');

const HOST = '127.0.0.1';
let listenPort = Number(process.env.PORT) || 3000;

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;
let serverLog = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getResourcesPath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, '..', ...parts);
}

function getNodeBinary() {
  if (app.isPackaged) {
    const bin = process.platform === 'win32' ? 'node.exe' : 'node';
    return path.join(process.resourcesPath, 'node', bin);
  }
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function getServerEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'src', 'index.js');
  }
  return path.join(__dirname, '..', 'src', 'index.js');
}

function getServerCwd() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..');
}

function appendServerLog(chunk) {
  const text = String(chunk || '');
  serverLog = `${serverLog}${text}`.slice(-4000);
  process.stdout.write(`[server] ${text}`);
}

function startServer() {
  const nodeBin = getNodeBinary();
  const serverEntry = getServerEntry();
  const cwd = getServerCwd();
  // .deb/.AppImage install dirs are root-owned; keep DB under userData.
  const dataDir = path.join(app.getPath('userData'), 'data');

  const env = {
    ...process.env,
    NOE_SSH_MODE: 'desktop',
    NOE_SSH_DATA_DIR: dataDir,
    HOST,
    PORT: String(listenPort),
  };
  // Avoid Electron-as-Node inheritance breaking the bundled runtime.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;

  serverLog = '';
  serverProcess = spawn(nodeBin, [serverEntry], {
    cwd,
    env,
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', appendServerLog);
  serverProcess.stderr.on('data', appendServerLog);
  serverProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) {
      console.error(`Server exited with code ${code}`);
    }
  });
  serverProcess.on('error', (err) => {
    appendServerLog(`spawn error: ${err.message}\n`);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  const url = `http://${HOST}:${listenPort}/api/health`;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (serverProcess && serverProcess.exitCode != null && serverProcess.exitCode !== 0) {
        reject(new Error(
          `内嵌服务退出 (code ${serverProcess.exitCode})\n${serverLog.trim() || '(无日志)'}`,
        ));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(
          `Server failed to start on ${HOST}:${listenPort}\n${serverLog.trim() || '(无日志)'}`,
        ));
        return;
      }
      setTimeout(check, 300);
    };

    check();
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Noe-SSH',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://${HOST}:${listenPort}`);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function buildAppMenu() {
  // Windows / Linux: hide the File / Help menubar entirely.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  // macOS keeps the system app menu; update check opens the in-page window.
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: '检查更新…',
          click: () => { checkForUpdatesManual(); },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function quitApp() {
  isQuitting = true;
  stopServer();
  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } catch {
    /* ignore */
  }
  if (mainWindow) {
    mainWindow.removeAllListeners('close');
    mainWindow.destroy();
    mainWindow = null;
  }
  // Force-exit: app.quit() alone can leave the Node server / tray alive.
  setTimeout(() => app.exit(0), 50);
}

function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Noe-SSH');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '检查更新…',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        checkForUpdatesManual();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => quitApp(),
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    buildAppMenu();
    createWindow();
    createTray();
    setupAutoUpdater({
      setQuitting: () => { isQuitting = true; },
      getMainWindow: () => mainWindow,
    });
  } catch (err) {
    console.error(err);
    dialog.showErrorBox(
      'Noe-SSH 启动失败',
      `${err && err.message ? err.message : String(err)}\n\n`
        + `数据目录：${path.join(app.getPath('userData'), 'data')}\n`
        + `终端排查：/opt/Noe-SSH/noe-ssh\n`
        + `若仍失败可试：/opt/Noe-SSH/noe-ssh --no-sandbox`,
    );
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  // Subscribing prevents Electron's default quit-on-last-window.
  // Main window may be hidden to tray; editor children can close freely.
  // Explicit「退出」goes through quitApp() → app.exit(0).
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
