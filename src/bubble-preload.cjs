const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  toggleBubble: () => ipcRenderer.invoke('bubble-toggle'),
  moveBubble: (x, y) => ipcRenderer.invoke('bubble-move', x, y),
  saveBubblePosition: () => ipcRenderer.invoke('bubble-save-position'),
  onBubbleState: callback => ipcRenderer.on('bubble-state', (_event, value) => callback(value))
});
