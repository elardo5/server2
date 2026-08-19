const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,

  // Licence
  getMachineId:     ()      => ipcRenderer.invoke('get-machine-id'),
  requestActivation: () => ipcRenderer.invoke('request-online-activation'),
  checkActivation:   () => ipcRenderer.invoke('check-online-activation'),
  launchApp:        ()      => ipcRenderer.send('launch-app')
})
