const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  platform: process.platform,
});

// Безопасный мост к Deezer API: рендерер никогда не делает
// сетевые запросы напрямую, только просит главный процесс.
contextBridge.exposeInMainWorld('pulseMusic', {
  request: (path) => ipcRenderer.invoke('deezer:request', path),
  scanLocal: () => ipcRenderer.invoke('local-music:scan'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (payload) => ipcRenderer.invoke('update:download', payload),
  installUpdate: (filePath) => ipcRenderer.invoke('update:install', filePath),
});
