const { app, BrowserWindow, Menu, globalShortcut, dialog, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const SessionManager = require('./main/session-manager');

let mainWindow;
let adminWindow;
let kitchenWindow;

// ===== CONFIG =====
const GITHUB_OWNER = 'anamasry300-ai';
const GITHUB_REPO = 'Lucca_menu-';
const GITHUB_BRANCH = 'main';
const LOCAL_VERSION = app.getVersion();

// ===== SECURE SESSION (main-process owned) =====
const appSession = new SessionManager({ serverUrl: process.env.LUCCA_SERVER_URL || 'http://localhost:3000' });

function broadcastSession(channel, payload) {
    try {
        for (const w of [mainWindow, adminWindow]) {
            if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
        }
    } catch (e) { }
}

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
    // Single instance: second launch focuses the running POS instead of opening a copy
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
        return;
    }
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    createWindow();

    // Initialize the real update engine (logs to userData, crash/rollback detect)
    updateEngine.init({ app, currentVersion: LOCAL_VERSION, send: sendUpdateState });

    // ===== Session IPC (token held in main-process ONLY — never sent to renderer) =====
    ipcMain.handle('session:get', () => appSession.session());
    ipcMain.handle('session:login', async (_e, creds) => {
        const r = await appSession.login(creds || {});
        broadcastSession('session-changed', appSession.session());
        return r;
    });
    ipcMain.handle('session:logout', async () => {
        const r = await appSession.logout();
        broadcastSession('session-changed', appSession.session());
        return r;
    });
    ipcMain.handle('session:refresh', async () => {
        const r = await appSession.refresh();
        broadcastSession('session-changed', appSession.session());
        return r;
    });
    ipcMain.handle('api:request', async (_e, args) => {
        const r = await appSession.apiRequest(args && args.method, args && args.path, args && args.body);
        return r;
    });

    ipcMain.on('open-admin', (event) => {
        // GATE: no authenticated session → explicit denial (no silent bypass path)
        const s = appSession.session();
        if (!s.authenticated || !s.user) {
            event.sender.send('admin-denied', { reason: 'no-session' });
            return;
        }
        if (s.user.role !== 'admin' && s.user.role !== 'manager') {
            event.sender.send('admin-denied', { reason: 'no-role' });
            return;
        }
        // نافذة واحدة قابلة لإعادة الاستخدام: إن كانت مفتوحة → التركيز عليها بدل فتح نافذة فارغة أخرى
        if (adminWindow && !adminWindow.isDestroyed()) {
            adminWindow.focus();
            return;
        }
        adminWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: false,
            parent: mainWindow, // إغلاق POS يغلق لوحة التحكم (واحدة=نفس الجلسة)
            title: 'Lucca Caffè - لوحة التحكم',
            icon: path.join(__dirname, 'icon.ico'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        adminWindow.once('ready-to-show', () => {
            if (adminWindow && !adminWindow.isDestroyed() && !adminWindow.showing()) adminWindow.show();
        });
        adminWindow.on('closed', () => { adminWindow = null; });
        adminWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('http:') || url.startsWith('https:')) {
                shell.openExternal(url);
                return { action: 'deny' };
            }
            return { action: 'allow' };
        });
        adminWindow.loadFile(path.join(__dirname, 'admin', 'index.html'));
        adminWindow.on('page-title-updated', (e) => e.preventDefault());
    });

    // D-04: شاشة المطبخ تُفتح كنافذة Electron بجلسة موثَّقة (لا anon) — تحديث الحالات يمر
    // عبر apiRequest/الخادم المصادق عليه. أي دور تشغيلي (admin/manager/cashier/kitchen) يملك orders.write.
    ipcMain.on('open-kitchen', (event) => {
        const s = appSession.session();
        if (!s.authenticated || !s.user) {
            event.sender.send('kitchen-denied', { reason: 'no-session' });
            return;
        }
        const allowed = ['admin', 'manager', 'cashier', 'kitchen'];
        if (!allowed.includes(s.user.role)) {
            event.sender.send('kitchen-denied', { reason: 'no-role' });
            return;
        }
        if (kitchenWindow && !kitchenWindow.isDestroyed()) {
            kitchenWindow.focus();
            return;
        }
        kitchenWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            show: false,
            parent: mainWindow,
            title: 'Lucca Caffè - شاشة المطبخ',
            icon: path.join(__dirname, 'icon.ico'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        kitchenWindow.once('ready-to-show', () => {
            if (kitchenWindow && !kitchenWindow.isDestroyed() && !kitchenWindow.showing()) kitchenWindow.show();
        });
        kitchenWindow.on('closed', () => { kitchenWindow = null; });
        kitchenWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('http:') || url.startsWith('https:')) {
                shell.openExternal(url);
                return { action: 'deny' };
            }
            return { action: 'allow' };
        });
        kitchenWindow.loadFile(path.join(__dirname, 'kitchen.html'));
        kitchenWindow.on('page-title-updated', (e) => e.preventDefault());
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
