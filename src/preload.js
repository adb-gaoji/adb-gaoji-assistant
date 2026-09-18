const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gaoji', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  run: (action, payload) => ipcRenderer.invoke('action:run', action, payload),
  copyLog: (text) => ipcRenderer.invoke('log:copy', text),
  exportLog: (text) => ipcRenderer.invoke('log:export', text),
  onLog: (handler) => ipcRenderer.on('log', (_event, text) => handler(text))
});
