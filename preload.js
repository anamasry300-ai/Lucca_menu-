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
    saveImageToClipboard: (base64) => ipcRenderer.send('save-image-clipboard', base64),
    onImageSaved: (callback) => ipcRenderer.on('image-saved', (e, data) => callback(data)),
    isElectron: true,

    getVersion: () => ipcRenderer.invoke('get-version'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    startUpdate: () => ipcRenderer.send('start-update'),
    checkRemoteVersion: () => ipcRenderer.invoke('check-remote-version'),

    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (e, data) => callback(data)),
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (e, status) => callback(status)),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (e, data) => callback(data))
});
