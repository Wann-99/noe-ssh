const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { setupAutoUpdater, checkForUpdatesManual } = require('./updater');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

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

function startServer() {
  const nodeBin = getNodeBinary();
  const serverEntry = getServerEntry();
  const cwd = getServerCwd();

  serverProcess = spawn(nodeBin, [serverEntry], {
    cwd,
    env: {
      ...process.env,
      NOE_SSH_MODE: 'desktop',
      HOST,
      PORT: String(PORT),
    },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[server] ${data}`);
  });
  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`);
  });
  serverProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) {
      console.error(`Server exited with code ${code}`);
    }
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  const url = `http://${HOST}:${PORT}/api/health`;

  return new Promise((resolve, reject) => {
    const check = () => {
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
        reject(new Error('Server failed to start'));
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
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://${HOST}:${PORT}`);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
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
        }]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '显示窗口',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => { checkForUpdatesManual(); },
        },
        {
          label: '打开发布页',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://github.com/Wann-99/noe-ssh/releases');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
      click: () => { checkForUpdatesManual(); },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
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
    });
  } catch (err) {
    console.error(err);
    dialog.showErrorBox(
      'Noe-SSH 启动失败',
      `${err && err.message ? err.message : String(err)}\n\n`
        + `可在终端运行查看详情：\n`
        + `/opt/Noe-SSH/noe-ssh\n\n`
        + `若提示 chrome-sandbox，可执行：\n`
        + `sudo chown root:root /opt/Noe-SSH/chrome-sandbox\n`
        + `sudo chmod 4755 /opt/Noe-SSH/chrome-sandbox\n`
        + `或：/opt/Noe-SSH/noe-ssh --no-sandbox`,
    );
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // keep running in tray
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
