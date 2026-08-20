const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron
    },
    openAdmin: () => ipcRenderer.send('open-admin'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    isElectron: true
});
