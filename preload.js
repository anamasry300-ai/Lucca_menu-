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
    isElectron: true,

    // Update system
    getVersion: () => ipcRenderer.invoke('get-version'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    downloadUpdate: () => ipcRenderer.send('download-update'),
    installUpdate: () => ipcRenderer.send('install-update'),
    checkRemoteVersion: () => ipcRenderer.invoke('check-remote-version'),

    // Update events
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (e, data) => callback(data)),
    onUpdateDownloading: (callback) => ipcRenderer.on('update-downloading', () => callback()),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (e, data) => callback(data)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (e, data) => callback(data))
});
