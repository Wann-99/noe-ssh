const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');

let checking = false;
let setQuitting = () => {};

function log(...args) {
  console.log('[updater]', ...args);
}

function setupAutoUpdater(options = {}) {
  if (typeof options.setQuitting === 'function') {
    setQuitting = options.setQuitting;
  }

  if (!app.isPackaged) {
    log('skip in unpackaged/dev mode');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Linux AppImage is the primary supported auto-update path.
  // Win/mac work without code signing but may show OS trust warnings.
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    log('checking for update...');
  });

  autoUpdater.on('update-available', async (info) => {
    log('update available', info.version);
    checking = false;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${info.version}`,
      detail: process.platform === 'linux'
        ? '建议使用 AppImage 安装包以获得自动更新支持。点击「下载更新」开始下载。'
        : '当前构建未做代码签名，系统可能提示未知开发者，可选择继续安装。',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        log('download failed', err);
        dialog.showErrorBox('下载失败', err.message || String(err));
      }
    }
  });

  autoUpdater.on('update-not-available', async (info) => {
    log('no update', info && info.version);
    if (checking) {
      checking = false;
      await dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本',
        detail: info && info.version ? `版本 ${info.version}` : '',
        buttons: ['好的'],
      });
    }
  });

  autoUpdater.on('error', async (err) => {
    log('error', err);
    if (checking) {
      checking = false;
      await dialog.showMessageBox({
        type: 'warning',
        title: '检查更新失败',
        message: '无法检查更新',
        detail: (err && err.message) || String(err),
        buttons: ['好的'],
      });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    log(`download ${Math.floor(p.percent || 0)}%`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log('downloaded', info.version);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新已就绪',
      message: `版本 ${info.version} 已下载完成`,
      detail: '重启应用以完成安装。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      setQuitting();
      // isSilent=false, isForceRunAfter=true
      autoUpdater.quitAndInstall(false, true);
    }
  });

  // Silent check a few seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => log('startup check failed', err));
  }, 8000);
}

async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '开发模式下不检查更新',
      buttons: ['好的'],
    });
    return;
  }
  if (checking) return;
  checking = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    checking = false;
    await dialog.showMessageBox({
      type: 'warning',
      title: '检查更新失败',
      message: '无法检查更新',
      detail: (err && err.message) || String(err),
      buttons: ['好的'],
    });
  }
}

module.exports = {
  setupAutoUpdater,
  checkForUpdatesManual,
};
