const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

/** @type {Map<string, BrowserWindow>} */
const windows = new Map();
let getMainWindow = () => null;
let getBaseUrl = () => 'http://127.0.0.1:3000';
let ipcBound = false;

function sendToMain(channel, payload) {
  const main = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (!main || main.isDestroyed()) return;
  try {
    main.webContents.send(channel, payload);
  } catch {
    /* ignore */
  }
}

function sendToEditor(editorId, channel, payload) {
  const win = windows.get(editorId);
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch {
    /* ignore */
  }
}

function setupEditorWindows(options = {}) {
  if (typeof options.getMainWindow === 'function') getMainWindow = options.getMainWindow;
  if (typeof options.getBaseUrl === 'function') getBaseUrl = options.getBaseUrl;
  bindIpc();
}

function bindIpc() {
  if (ipcBound) return;
  ipcBound = true;

  ipcMain.handle('editor:open', async (_event, payload = {}) => {
    const id = String(payload.id || '');
    if (!id) return { ok: false };
    const existing = windows.get(id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      if (payload.state) sendToEditor(id, 'editor:state', payload.state);
      return { ok: true, reused: true };
    }

    const iconPath = path.join(__dirname, 'icons', 'icon.png');
    const win = new BrowserWindow({
      width: Number(payload.width) || 920,
      height: Number(payload.height) || 640,
      minWidth: 480,
      minHeight: 320,
      title: payload.title || 'Noe-SSH Editor',
      icon: iconPath,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    windows.set(id, win);
    const url = `${getBaseUrl()}/?noeEditor=${encodeURIComponent(id)}`;
    await win.loadURL(url);
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });

    win.on('focus', () => {
      sendToMain('editor:from-child', { type: 'focus', id });
    });

    // System minimize → stash into main-window archive tray (not taskbar).
    win.on('minimize', () => {
      try {
        if (!win.isDestroyed()) win.restore();
      } catch {
        /* ignore */
      }
      sendToMain('editor:from-child', { type: 'minimize', id });
      windows.delete(id);
      try {
        win.removeAllListeners('close');
        win.removeAllListeners('minimize');
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* ignore */
      }
    });

    win.on('close', (event) => {
      // Ask renderer to confirm (dirty files); it will call editor:destroy.
      event.preventDefault();
      sendToEditor(id, 'editor:request-close', {});
    });

    win.on('closed', () => {
      windows.delete(id);
      sendToMain('editor:from-child', { type: 'os-closed', id });
    });

    if (payload.state) {
      win.webContents.on('did-finish-load', () => {
        sendToEditor(id, 'editor:state', payload.state);
      });
    }

    return { ok: true };
  });

  ipcMain.handle('editor:push', async (_event, payload = {}) => {
    const id = String(payload.id || '');
    if (!id || !payload.state) return { ok: false };
    sendToEditor(id, 'editor:state', payload.state);
    return { ok: true };
  });

  ipcMain.handle('editor:focus', async (_event, payload = {}) => {
    const id = String(payload.id || '');
    const win = windows.get(id);
    if (!win || win.isDestroyed()) return { ok: false };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
  });

  ipcMain.handle('editor:destroy', async (_event, payload = {}) => {
    const id = String(payload.id || '');
    const win = windows.get(id);
    if (!win || win.isDestroyed()) {
      windows.delete(id);
      return { ok: true };
    }
    windows.delete(id);
    win.removeAllListeners('close');
    win.removeAllListeners('minimize');
    win.destroy();
    return { ok: true };
  });

  ipcMain.on('editor:from-child', (_event, payload) => {
    sendToMain('editor:from-child', payload || {});
  });
}

function closeAllEditorWindows() {
  for (const [id, win] of windows) {
    try {
      win.removeAllListeners('close');
      win.removeAllListeners('minimize');
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* ignore */
    }
    windows.delete(id);
  }
}

module.exports = {
  setupEditorWindows,
  closeAllEditorWindows,
};
