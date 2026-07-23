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
  editor: {
    open: (payload) => ipcRenderer.invoke('editor:open', payload),
    push: (payload) => ipcRenderer.invoke('editor:push', payload),
    focus: (payload) => ipcRenderer.invoke('editor:focus', payload),
    hide: (payload) => ipcRenderer.invoke('editor:hide', payload),
    destroy: (payload) => ipcRenderer.invoke('editor:destroy', payload),
    send: (payload) => ipcRenderer.send('editor:from-child', payload),
    onFromChild: (handler) => {
      const listener = (_event, payload) => handler(payload || {});
      ipcRenderer.on('editor:from-child', listener);
      return () => ipcRenderer.removeListener('editor:from-child', listener);
    },
    onState: (handler) => {
      const listener = (_event, payload) => handler(payload || {});
      ipcRenderer.on('editor:state', listener);
      return () => ipcRenderer.removeListener('editor:state', listener);
    },
    onRequestClose: (handler) => {
      const listener = (_event, payload) => handler(payload || {});
      ipcRenderer.on('editor:request-close', listener);
      return () => ipcRenderer.removeListener('editor:request-close', listener);
    },
  },
});
