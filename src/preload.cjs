const { contextBridge, ipcRenderer } = require('electron');

const call = (name, ...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('api', {
  status: () => call('status'),
  chooseLibrary: () => call('choose-library'),
  list: options => call('list', options),
  addText: data => call('add-text', data),
  addImage: data => call('add-image', data),
  collect: () => call('collect'),
  update: (id, patch) => call('update', id, patch),
  trash: id => call('trash', id),
  trashMany: ids => call('trash-many', ids),
  restore: id => call('restore', id),
  restoreMany: ids => call('restore-many', ids),
  favoriteMany: (ids, value) => call('favorite-many', ids, value),
  deleteForever: id => call('delete-forever', id),
  emptyTrash: () => call('empty-trash'),
  copy: id => call('copy', id),
  thumb: id => call('thumb', id),
  preview: id => call('preview', id),
  hide: () => call('hide'),
  setShortcuts: value => call('set-shortcuts', value),
  beginShortcutCapture: () => call('begin-shortcut-capture'),
  endShortcutCapture: () => call('end-shortcut-capture'),
  setStartup: value => call('set-startup', value),
  migrate: () => call('migrate'),
  onChange: callback => ipcRenderer.on('library-changed', () => callback()),
  onPanelExpanded: callback => ipcRenderer.on('panel-expanded', (_event, value) => callback(value)),
  onPanelAnchor: callback => ipcRenderer.on('panel-anchor', (_event, value) => callback(value)),
  onToast: callback => ipcRenderer.on('toast', (_event, value) => callback(value))
});
