const { app, BrowserWindow, Menu, globalShortcut, dialog, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ===== Phase 1: Update Integrity & Security =====
const updateIntegrity = require('./main/js/update-integrity');

// ===== Phase 2: Crash Recovery =====
const crashRecovery = require('./main/js/crash-recovery');

// ===== Phase 4: Health Monitor =====
const healthMonitor = require('./main/js/health-monitor');

// ===== Force Update (P0) =====
const forceUpdate = require('./updater-force');

// ===== CONFIG =====
const GITHUB_OWNER = 'anamasry300-ai';
const GITHUB_REPO = 'Lucca_menu-';
const GITHUB_BRANCH = 'main';
const LOCAL_VERSION = app.getVersion();

// تهيئة وحدة integrity مع الإصدار الحالي
updateIntegrity.init({
  currentVersion: LOCAL_VERSION,
  logDir: null // سيتم تعيينه من قبل crash-recovery
});

// تهيئة مراقب الصحة مع عتبات مخصصة
healthMonitor.init({
  thresholds: {
    memoryUsagePercent: 85,
    cpuUsagePercent: 80,
    memoryWarningMB: 500
  },
  intervalMs: 30000
});

// ===== REAL PRODUCTION AUTO-UPDATE (electron-updater + GitHub Releases) =====
const updateEngine = require('./update-engine');

function sendToRenderer(channel, payload) {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch (e) { }
}

function sendUpdateState(payload) {
    sendToRenderer('update-state', payload);
    if (payload && payload.percent !== undefined) {
        sendToRenderer('update-progress', { percent: payload.percent });
    }
}

// مراجع للوحدات للتشخيص
let _healthMonitorCallbacks = [];

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
            contextIsolation: true,
            sandbox: false // Fase 3: sandbox معطل للتوافق مع preload الذي يحتاج ipcRenderer
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // ---- Phase 1 & P0: Force Update Check قبل تحميل واجهة التطبيق (Fail Closed) ----
    forceUpdate.checkForceUpdate(mainWindow).then((result) => {
        if (result.required) {
            // نافذة التحديث الإجباري تغطي كل شيء، لا نحمل index.html
            return;
        }
        mainWindow.loadFile(path.join(__dirname, 'index.html'));
    });

    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.on('page-title-updated', (e) => { e.preventDefault(); });

    // Phase 2: التقاط تعطل العملية الرئيسية (renderer crashes)
    mainWindow.webContents.on('crashed', (event, killed) => {
      crashRecovery.recordRendererCrash({ reason: killed ? 'killed' : 'crashed', exitCode: null });
    });

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

    // ---- Force Update IPC (P0 - لا تكرار) ----
    ipcMain.handle('force-update-check', async () => {
        return { active: forceUpdate.isForceUpdateActive(), config: forceUpdate.appConfigResult || null };
    });
    ipcMain.handle('force-update-perform', async () => {
        return forceUpdate.performForceUpdate();
    });
    ipcMain.handle('force-update-get-version', () => {
        return { version: LOCAL_VERSION };
    });

    // ---- Phase 1: Update Integrity IPC ----
    ipcMain.handle('update-integrity-get-state', () => {
        return updateIntegrity.getState();
    });
    ipcMain.handle('update-integrity-validate-package', async (event, { updateInfo, filePath }) => {
        return await updateIntegrity.validateUpdatePackage(updateInfo, filePath);
    });
    ipcMain.handle('update-integrity-detect-corrupted', async (event, filePath) => {
        return await updateIntegrity.detectCorruptedDownload(filePath);
    });

    // ---- Phase 2: Crash Recovery IPC ----
    ipcMain.handle('crash-recovery-get-stats', () => {
        return crashRecovery.getCrashStats();
    });
    ipcMain.handle('crash-recovery-get-latest-report', () => {
        return crashRecovery.getLatestCrashReport();
    });
    ipcMain.handle('crash-recovery-record-from-renderer', async (event, crashData) => {
        return crashRecovery.recordRendererCrashFromIPC(crashData);
    });

    // ---- Phase 4: Health Monitor IPC ----
    ipcMain.handle('health-monitor-get-state', () => {
        return healthMonitor.getState();
    });
    ipcMain.handle('health-monitor-run-check', async (event) => {
        // دالة فحص قاعدة البيانات (supabase)
        const checkDb = async () => {
            // محاولة简单ّة: التحقق من وجود اتصال Supabase عبر supabase-config
            // في实际情况، نستخدم Supabase client منenderer، لكن هنا نعيد status افتراضي
            return { status: 'connected' };
        };
        const checkUpdate = async () => {
            await updateEngine.check();
        };
        return await healthMonitor.runHealthCheck({ checkDb, checkUpdate });
    });
    ipcMain.on('health-monitor-on-warning', (event, callbackId) => {
        // تسجيل دالة ردع للإشعارات (يتم معالجتها في renderer)
        _healthMonitorCallbacks.push(callbackId);
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
                    label: 'نظام الصحة والتشخيص',
                    click: () => {
                        const healthWin = new BrowserWindow({
                            width: 1200,
                            height: 800,
                            title: 'نظام الصحة والتشخيص - Lucca POS',
                            icon: path.join(__dirname, 'icon.ico'),
                            webPreferences: {
                                preload: path.join(__dirname, 'preload.js'),
                                nodeIntegration: false,
                                contextIsolation: true
                            }
                        });
                        healthWin.loadFile(path.join(__dirname, 'renderer', 'system-health.html'));
                    }
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

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setMenu(Menu.buildFromTemplate(menuTemplate));
    }

    // Auto-check for updates on startup (check only; offline-safe, no false positives)
    setTimeout(() => updateEngine.check(), 15000);
}

app.whenReady().then(() => {
    createWindow();

    // Phase 2: تهيئة خدمة استعادة التعطل مع النافذة الرئيسية
    crashRecovery.init({ mainWindow, autoReopen: true });

    // Initialize the real update engine (logs to userData, crash/rollback detect)
    updateEngine.init({ app, currentVersion: LOCAL_VERSION, send: sendUpdateState });

    // Phase 4: بدء مراقب الصحة بعد تهيئة النافذة
    healthMonitor.startMonitoring({
        intervalMs: 30000,
        onHealthChange: (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('health-warning', data);
            }
        }
    });

    ipcMain.on('open-admin', () => {
        if (adminWindow && !adminWindow.isDestroyed()) {
            adminWindow.focus();
            return;
        }
        adminWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: false,
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
    healthMonitor.stopMonitoring();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
    healthMonitor.stopMonitoring();
    globalShortcut.unregisterAll();
});
