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
    getUpdateState: () => ipcRenderer.invoke('get-update-state'),

    // Real update flow (state machine driven by update-engine.js)
    checkForUpdates: () => ipcRenderer.invoke('update-check'),
    startUpdate: () => ipcRenderer.invoke('update-check'),
    downloadUpdate: () => ipcRenderer.invoke('update-download'),
    installUpdate: () => ipcRenderer.invoke('update-install'),
    checkRemoteVersion: () => ipcRenderer.invoke('check-remote-version'),

    onUpdateState: (callback) => ipcRenderer.on('update-state', (e, data) => callback(data)),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (e, data) => callback(data)),
    onUpdateStatus: (callback) => ipcRenderer.on('update-state', (e, data) => callback((data && data.state) || 'idle')),

    // Compat: legacy channels so existing/renderer code does not crash
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (e, data) => callback(data)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (e, data) => callback(data))
});
