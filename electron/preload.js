const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noeDesktop', {
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onOpen: (handler) => {
      const listener = (_event, payload) => handler(payload || {});
      ipcRenderer.on('updater:open', listener);
      return () => ipcRenderer.removeListener('updater:open', listener);
    },
    onEvent: (handler) => {
      const listener = (_event, payload) => handler(payload || {});
      ipcRenderer.on('updater:event', listener);
      return () => ipcRenderer.removeListener('updater:event', listener);
    },
  },
});
