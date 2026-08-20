const { app, BrowserWindow, Menu, globalShortcut, dialog, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;

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

    // Open external http(s) links (WhatsApp, phone, maps...) in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.on('page-title-updated', (e) => {
        e.preventDefault();
    });

    const menuTemplate = [
        {
            label: 'عرض',
            submenu: [
                {
                    label: 'ملء الشاشة',
                    accelerator: 'F11',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
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
                    label: 'حول النظام',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'حول Lucca Caffè',
                            message: 'Lucca Caffè POS\nالإصدار 1.0.0\n\nنظام إدارة المقهى\nبورسعيد - شارع محمد علي\n01551007413'
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
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
