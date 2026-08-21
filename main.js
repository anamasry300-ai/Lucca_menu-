const { app, BrowserWindow, Menu, globalShortcut, dialog, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let updateAvailable = false;
let updateInfo = null;

// ===== AUTO UPDATER =====
let autoUpdater;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch(e) {}

function setupAutoUpdater() {
    if (!autoUpdater) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Check for updates on startup (after 5 seconds)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);

    // Check every 30 minutes
    setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => {});
    }, 30 * 60 * 1000);

    autoUpdater.on('update-available', (info) => {
        updateAvailable = true;
        updateInfo = info;
        if (mainWindow) {
            mainWindow.webContents.send('update-available', {
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes || ''
            });
        }
        // Show dialog
        const response = dialog.showMessageBoxSync(mainWindow, {
            type: 'info',
            title: 'تحديث جديد متاح',
            message: `إصدار جديد ${info.version} متاح!\n\nهل تريد تحميل التحديث الآن؟`,
            buttons: ['تحميل التحديث', 'لاحقاً'],
            defaultId: 0,
            cancelId: 1
        });
        if (response === 0) {
            autoUpdater.downloadUpdate().catch(() => {});
            if (mainWindow) {
                mainWindow.webContents.send('update-downloading');
            }
        }
    });

    autoUpdater.on('update-not-available', () => {
        updateAvailable = false;
    });

    autoUpdater.on('download-progress', (progress) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-progress', {
                percent: Math.round(progress.percent),
                transferred: progress.transferred,
                total: progress.total
            });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        updateAvailable = true;
        updateInfo = info;
        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', { version: info.version });
        }
        const response = dialog.showMessageBoxSync(mainWindow, {
            type: 'info',
            title: 'تم تحميل التحديث',
            message: `تم تحميل التحديث ${info.version} بنجاح!\n\nسيتم إعادة تشغيل التطبيق لتطبيق التحديث.`,
            buttons: ['إعادة التشغيل الآن', 'إعادة التشغيل لاحقاً'],
            defaultId: 0,
            cancelId: 1
        });
        if (response === 0) {
            autoUpdater.quitAndInstall();
        }
    });

    autoUpdater.on('error', (err) => {
        // Silent fail - don't crash the app
    });
}

// ===== VERSION CHECK (Fallback for when GitHub releases aren't available) =====
const LOCAL_VERSION = app.getVersion();

async function checkVersionFromURL() {
    try {
        const https = require('https');
        const url = 'https://raw.githubusercontent.com/anamasry300-ai/Lucca_menu-/main/version.json';
        return new Promise((resolve) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const remote = JSON.parse(data);
                        resolve(remote);
                    } catch(e) { resolve(null); }
                });
            }).on('error', () => resolve(null));
        });
    } catch(e) { return null; }
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

    // IPC: Check for updates manually
    ipcMain.on('check-for-updates', () => {
        if (autoUpdater) {
            autoUpdater.checkForUpdates().catch(() => {});
        }
    });

    // IPC: Download update
    ipcMain.on('download-update', () => {
        if (autoUpdater) {
            autoUpdater.downloadUpdate().catch(() => {});
        }
    });

    // IPC: Install update and restart
    ipcMain.on('install-update', () => {
        if (autoUpdater) {
            autoUpdater.quitAndInstall();
        }
    });

    // IPC: Get version
    ipcMain.handle('get-version', () => {
        return { version: LOCAL_VERSION, platform: process.platform };
    });

    // IPC: Force check version from URL
    ipcMain.handle('check-remote-version', async () => {
        const remote = await checkVersionFromURL();
        return remote;
    });

    const menuTemplate = [
        {
            label: 'عرض',
            submenu: [
                {
                    label: 'ملء الشاشة',
                    accelerator: 'F11',
                    click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen())
                },
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
                    click: () => {
                        if (autoUpdater) {
                            autoUpdater.checkForUpdates().catch(() => {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    title: 'تحقق من التحديثات',
                                    message: 'لا يوجد تحديثات متاحة حالياً.\n\nالإصدار الحالي: ' + LOCAL_VERSION
                                });
                            });
                        }
                    }
                },
                {
                    label: 'حول النظام',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'حول Lucca Caffè',
                            message: 'Lucca Caffè POS\nالإصدار ' + LOCAL_VERSION + '\n\nنظام إدارة المقهى\nبورسعيد - شارع محمد علي\n01551007413'
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();

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
