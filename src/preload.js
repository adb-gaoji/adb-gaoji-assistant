const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gaoji', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  run: (action, payload) => ipcRenderer.invoke('action:run', action, payload),
  copyLog: (text) => ipcRenderer.invoke('log:copy', text),
  exportLog: (text) => ipcRenderer.invoke('log:export', text),
  onLog: (handler) => ipcRenderer.on('log', (_event, text) => handler(text)),
  // 刷机进度：主进程发结构化事件，界面据此显示进度条与实时输出。
  // 用结构化事件而非让前端解析日志字符串，日志格式调整时界面不会跟着失效。
  onFlashProgress: (handler) => ipcRenderer.on('flash-progress', (_event, payload) => handler(payload))
});
