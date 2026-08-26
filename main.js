const { app, BrowserWindow, Menu, globalShortcut, dialog, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

let mainWindow;

// ===== CONFIG =====
const GITHUB_OWNER = 'anamasry300-ai';
const GITHUB_REPO = 'Lucca_menu-';
const GITHUB_BRANCH = 'main';
const LOCAL_VERSION = app.getVersion();
const APP_DIR = path.dirname(app.getPath('exe'));

// Files to update (relative to app root)
const UPDATE_FILES = [
    'index.html',
    'styles.css',
    'main.js',
    'preload.js',
    'ai-pos-engine.js',
    'supabase-db.js',
    'sync-engine.js',
    'forecasting.js',
    'knowledge-base.js',
    'report-export.js',
    'package.json',
    'version.json',
    'admin/database.js',
    'admin/index.html'
];

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGet(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
    });
}

function httpsGetBinary(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGetBinary(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

// ===== VERSION CHECK =====
async function checkRemoteVersion() {
    try {
        const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/version.json`;
        const res = await httpsGet(url);
        if (res.status === 200) return JSON.parse(res.data);
    } catch (e) { }
    return null;
}

function compareVersions(local, remote) {
    const lp = local.split('.').map(Number);
    const rp = remote.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((rp[i] || 0) > (lp[i] || 0)) return 1;
        if ((rp[i] || 0) < (lp[i] || 0)) return -1;
    }
    return 0;
}

// ===== SELF UPDATER =====
async function performSelfUpdate() {
    if (mainWindow) mainWindow.webContents.send('update-status', 'checking');

    const remote = await checkRemoteVersion();
    if (!remote) {
        if (mainWindow) mainWindow.webContents.send('update-status', 'no-update');
        return;
    }

    if (compareVersions(LOCAL_VERSION, remote.version) <= 0) {
        if (mainWindow) mainWindow.webContents.send('update-status', 'up-to-date');
        return;
    }

    if (mainWindow) {
        mainWindow.webContents.send('update-available', {
            version: remote.version,
            releaseNotes: remote.releaseNotes || ''
        });
    }

    const response = dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'تحديث جديد متاح',
        message: `إصدار جديد ${remote.version} متاح!\n\n${remote.releaseNotes || ''}\n\nهل تريد تحميل التحديث الآن؟`,
        buttons: ['تحميل التحديث', 'لاحقاً'],
        defaultId: 0,
        cancelId: 1
    });

    if (response !== 0) return;

    if (mainWindow) mainWindow.webContents.send('update-status', 'downloading');

    let downloaded = 0;
    for (const file of UPDATE_FILES) {
        try {
            downloaded++;
            if (mainWindow) {
                mainWindow.webContents.send('update-progress', {
                    file,
                    current: downloaded,
                    total: UPDATE_FILES.length,
                    percent: Math.round((downloaded / UPDATE_FILES.length) * 100)
                });
            }

            const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file}`;
            const res = await httpsGet(rawUrl);
            if (res.status === 200) {
                const filePath = path.join(APP_DIR, file);
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(filePath, res.data, 'utf8');
            }
        } catch (e) {
            console.error(`Failed to update ${file}:`, e.message);
        }
    }

    // Update local version.json
    try {
        fs.writeFileSync(path.join(APP_DIR, 'version.json'), JSON.stringify(remote, null, 4), 'utf8');
    } catch (e) { }

    if (mainWindow) mainWindow.webContents.send('update-status', 'completed');

    const restart = dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'تم التحديث بنجاح',
        message: `تم تحديث التطبيق إلى الإصدار ${remote.version}!\n\nيجب إعادة تشغيل التطبيق لتطبيق التحديث.`,
        buttons: ['إعادة التشغيل الآن', 'إعادة التشغيل لاحقاً'],
        defaultId: 0,
        cancelId: 1
    });

    if (restart === 0) {
        app.relaunch();
        app.exit(0);
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

    ipcMain.on('check-for-updates', () => performSelfUpdate());
    ipcMain.on('start-update', () => performSelfUpdate());
    ipcMain.handle('get-version', () => ({ version: LOCAL_VERSION, platform: process.platform }));
    ipcMain.handle('check-remote-version', async () => {
        const remote = await checkRemoteVersion();
        if (remote && compareVersions(LOCAL_VERSION, remote.version) > 0) return remote;
        return null;
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
                    click: () => performSelfUpdate()
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

    // Auto-check for updates on startup (after 10 seconds)
    setTimeout(() => performSelfUpdate(), 10000);
}

app.whenReady().then(() => {
    createWindow();

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
