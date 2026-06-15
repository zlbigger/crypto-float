const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cryptoFloat', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  fetchPrices: (tokenIds) => ipcRenderer.invoke('prices:fetch', tokenIds),
  searchCoins: (query) => ipcRenderer.invoke('coins:search', query),
  syncBoard: () => ipcRenderer.invoke('board:sync'),
  getBoardStatus: () => ipcRenderer.invoke('board:status'),
  chooseSound: () => ipcRenderer.invoke('sound:choose'),
  openSettingsFile: () => ipcRenderer.invoke('app:open-settings-file'),
  setWindowMode: (mode) => ipcRenderer.send('window:set-mode', mode),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
