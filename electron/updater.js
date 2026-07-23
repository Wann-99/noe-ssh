const { autoUpdater } = require('electron-updater');
const { app, ipcMain } = require('electron');

let checking = false;
let setQuitting = () => {};
let getMainWindow = () => null;
let listenersBound = false;
let ipcBound = false;

function log(...args) {
  console.log('[updater]', ...args);
}

function send(channel, payload) {
  const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch (err) {
    log('send failed', err && err.message);
  }
}

function emit(event) {
  send('updater:event', event);
}

function openUpdateUi(payload = {}) {
  send('updater:open', payload);
}

function setupAutoUpdater(options = {}) {
  if (typeof options.setQuitting === 'function') {
    setQuitting = options.setQuitting;
  }
  if (typeof options.getMainWindow === 'function') {
    getMainWindow = options.getMainWindow;
  }

  bindIpc();

  if (!app.isPackaged) {
    log('skip in unpackaged/dev mode');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  if (!listenersBound) {
    listenersBound = true;

    autoUpdater.on('checking-for-update', () => {
      log('checking for update...');
      emit({ type: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      log('update available', info.version);
      checking = false;
      const detail = process.platform === 'linux'
        ? '建议使用 AppImage 安装包以获得自动更新支持。'
        : '当前构建未做代码签名，系统可能提示未知开发者，可选择继续安装。';
      emit({
        type: 'available',
        version: info.version,
        detail,
      });
      // Silent startup check: surface the in-page window when an update exists.
      openUpdateUi({ reason: 'available', version: info.version });
    });

    autoUpdater.on('update-not-available', (info) => {
      log('no update', info && info.version);
      const wasManual = checking;
      checking = false;
      emit({
        type: 'not-available',
        version: info && info.version,
        manual: wasManual,
      });
    });

    autoUpdater.on('error', (err) => {
      log('error', err);
      checking = false;
      emit({
        type: 'error',
        message: (err && err.message) || String(err),
      });
    });

    autoUpdater.on('download-progress', (p) => {
      const percent = Math.min(100, Math.max(0, Number(p.percent) || 0));
      log(`download ${Math.floor(percent)}%`);
      emit({
        type: 'progress',
        percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      log('downloaded', info.version);
      emit({
        type: 'downloaded',
        version: info.version,
      });
      openUpdateUi({ reason: 'downloaded', version: info.version });
    });
  }

  // Silent check a few seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => log('startup check failed', err));
  }, 8000);
}

function bindIpc() {
  if (ipcBound) return;
  ipcBound = true;

  ipcMain.handle('updater:check', async () => {
    await checkForUpdatesManual();
    return { ok: true };
  });

  ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged) {
      emit({ type: 'error', message: '开发模式下不能下载更新' });
      return { ok: false };
    }
    try {
      emit({ type: 'downloading' });
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      emit({
        type: 'error',
        message: (err && err.message) || String(err),
      });
      return { ok: false };
    }
  });

  ipcMain.handle('updater:install', async () => {
    if (!app.isPackaged) {
      emit({ type: 'error', message: '开发模式下不能安装更新' });
      return { ok: false };
    }
    setQuitting();
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
}

async function checkForUpdatesManual() {
  openUpdateUi({ reason: 'manual' });

  if (!app.isPackaged) {
    emit({
      type: 'error',
      message: '开发模式下不检查更新',
      code: 'dev',
    });
    return;
  }
  if (checking) return;
  checking = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    checking = false;
    emit({
      type: 'error',
      message: (err && err.message) || String(err),
    });
  }
}

module.exports = {
  setupAutoUpdater,
  checkForUpdatesManual,
  openUpdateUi,
};
