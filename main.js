const { app, BrowserWindow, Menu, globalShortcut, dialog, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// ===== CONFIG =====
const GITHUB_OWNER = 'anamasry300-ai';
const GITHUB_REPO = 'Lucca_menu-';
const GITHUB_BRANCH = 'main';
const LOCAL_VERSION = app.getVersion();

// ===== REAL PRODUCTION AUTO-UPDATE (electron-updater + GitHub Releases) =====
const updateEngine = require('./update-engine');

function sendToRenderer(channel, payload) {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch (e) { }
}

function sendUpdateState(payload) {
    // payload = { state, currentVersion, targetVersion, error, percent? }
    sendToRenderer('update-state', payload);
    if (payload && payload.percent !== undefined) {
        sendToRenderer('update-progress', { percent: payload.percent });
    }
}

// ===== MAIN WINDOW =====
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'Lucca Caffè - POS',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.on('page-title-updated', (e) => { e.preventDefault(); });

    // ---- Real update IPC (checked / downloaded / installed via engine) ----
    ipcMain.handle('update-check', async () => {
        const r = await updateEngine.check();
        return { ok: r.offline ? false : r.ok, offline: !!r.offline, ...updateEngine.getState() };
    });
    ipcMain.handle('update-download', async () => {
        const r = await updateEngine.download();
        return { ...r, ...updateEngine.getState() };
    });
    ipcMain.handle('update-install', () => {
        const r = updateEngine.installAndRestart();
        return r;
    });
    ipcMain.handle('get-update-state', () => updateEngine.getState());
    ipcMain.handle('get-version', () => ({ version: LOCAL_VERSION, platform: process.platform }));
    ipcMain.handle('check-remote-version', async () => {
        const remote = await updateEngine.target;
        return remote ? { version: remote } : null;
    });

    const menuTemplate = [
        {
            label: 'عرض',
            submenu: [
                { label: 'ملء الشاشة', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
                { type: 'separator' },
                { label: 'تكبير', accelerator: 'CmdOrCtrl+=', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5) },
                { label: 'تصغير', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5) },
                { label: 'إعادة حجم الخط', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.setZoomLevel(0) },
                { type: 'separator' },
                { label: 'مطور', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
            ]
        },
        {
            label: 'مساعدة',
            submenu: [
                {
                    label: 'التحقق من تحديثات',
                    click: () => updateEngine.check()
                },
                {
                    label: 'حول النظام',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'حول Lucca Caffè',
                            message: 'Lucca Caffè POS\nالإصدار ' + LOCAL_VERSION + '\n\nنظام إدارة المقهى\nبورسعيد - شارع محمد علي\n01010058989'
                        });
                    }
                }
            ]
        }
    ];

    mainWindow.setMenu(Menu.buildFromTemplate(menuTemplate));

    // Auto-check for updates on startup (check only; offline-safe, no false positives)
    setTimeout(() => updateEngine.check(), 15000);
}

app.whenReady().then(() => {
    createWindow();

    // Initialize the real update engine (logs to userData, crash/rollback detect)
    updateEngine.init({ app, currentVersion: LOCAL_VERSION, send: sendUpdateState });

    ipcMain.on('open-admin', () => {
        const adminWin = new BrowserWindow({
            width: 1200,
            height: 800,
            title: 'Lucca Caffè - لوحة التحكم',
            icon: path.join(__dirname, 'icon.ico'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        adminWin.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('http:') || url.startsWith('https:')) {
                shell.openExternal(url);
                return { action: 'deny' };
            }
            return { action: 'allow' };
        });
        adminWin.loadFile(path.join(__dirname, 'admin', 'index.html'));
        adminWin.on('page-title-updated', (e) => e.preventDefault());
    });

    ipcMain.on('open-external', (event, url) => {
        if (typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'))) {
            shell.openExternal(url);
        }
    });

    ipcMain.on('save-image-clipboard', (event, base64Data) => {
        try {
            const buffer = Buffer.from(base64Data, 'base64');
            const img = nativeImage.createFromBuffer(buffer);
            clipboard.writeImage(img);
            const tempPath = path.join(app.getPath('temp'), 'lucca_invoice_' + Date.now() + '.png');
            fs.writeFileSync(tempPath, buffer);
            event.reply('image-saved', { tempPath, success: true });
        } catch (e) {
            event.reply('image-saved', { success: false, error: e.message });
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
