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

    // ===== Secure session bridge (no secrets cross the boundary) =====
    session: {
        get: () => ipcRenderer.invoke('session:get'),
        login: (creds) => ipcRenderer.invoke('session:login', creds),
        logout: () => ipcRenderer.invoke('session:logout'),
        refresh: () => ipcRenderer.invoke('session:refresh'),
        onChanged: (callback) => ipcRenderer.on('session-changed', (e, session) => callback(session)),
    },
    apiRequest: (method, path, body) => ipcRenderer.invoke('api:request', { method, path, body }),
    onAdminDenied: (callback) => ipcRenderer.on('admin-denied', (e, info) => callback(info)),

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
