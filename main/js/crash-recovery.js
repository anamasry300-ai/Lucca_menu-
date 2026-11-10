/**
 * Lucca POS — Crash Recovery Service (Phase 2)
 * يلتقط تعطل العمليات (renderer, main process),
 * الرفض غير المعالج للوعود، والاستثناءات غير الملتقطة.
 * يخزن السجلات في userData/logs/ ويولد crash-report.json.
 *
 * @module crash-recovery
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

// ---- إعدادات ----
const LOG_DIR_NAME = 'logs';
const CRASH_REPORT_FILE = 'crash-report.json';
const MAX_CRASH_REPORTS = 50; // الحفاظ على آخر 50 تقرير فقط

let _logDir = null;
let _crashCount = 0;
let _isInitialized = false;
let _mainWindow = null;
let _crashHistory = [];

/**
 * الحصول على دليل السجلات داخل userData
 * @returns {string}
 */
function getLogDir() {
  if (_logDir) return _logDir;
  try {
    const userDataDir = app.getPath('userData');
    _logDir = path.join(userDataDir, LOG_DIR_NAME);
    fs.mkdirSync(_logDir, { recursive: true });
  } catch (e) {
    _logDir = path.join(os.homedir(), '.lucca-pos', LOG_DIR_NAME);
    try { fs.mkdirSync(_logDir, { recursive: true }); } catch {}
  }
  return _logDir;
}

/**
 * كتابة سجل crash
 * @param {Object} crashData - بيانات التعطل
 * @returns {string|null} - مسار الملف المحفوظ أو null
 */
function writeCrashLog(crashData) {
  try {
    const logDir = getLogDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `crash-${timestamp}.json`;
    const filePath = path.join(logDir, fileName);

    const entry = {
      ...crashData,
      timestamp: new Date().toISOString(),
      processType: crashData.processType || 'unknown',
      appVersion: app.getVersion ? app.getVersion() : 'unknown',
      platform: process.platform,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };

    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

    // إضافة إلى السجل التراكمي
    _crashHistory.push(entry);
    if (_crashHistory.length > MAX_CRASH_REPORTS) {
      _crashHistory = _crashHistory.slice(-MAX_CRASH_REPORTS);
    }

    // تحديث crash-report.json مع آخر تعطل
    writeCrashReport(entry);

    _crashCount++;
    return filePath;
  } catch (e) {
    console.error('[crash-recovery] فشل كتابة سجل التعطل:', e.message);
    return null;
  }
}

/**
 * كتابة/تحديث ملف crash-report.json مع أحدث تعطل
 * @param {Object} latestCrash - بيانات آخر تعطل
 */
function writeCrashReport(latestCrash) {
  try {
    const logDir = getLogDir();
    const reportPath = path.join(logDir, CRASH_REPORT_FILE);

    const report = {
      generatedAt: new Date().toISOString(),
      totalCrashes: _crashCount,
      latestCrash,
      crashHistory: _crashHistory.slice(-10), // آخر 10 تعطلات للعرض السريع
      appInfo: {
        version: app.getVersion ? app.getVersion() : 'unknown',
        platform: process.platform,
        electronVersion: process.versions.electron
      }
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (e) {
    console.error('[crash-recovery] فشل كتابة crash-report.json:', e.message);
  }
}

/**
 * تسجيل استثناء غير ملتقط
 * @param {Error} err - كائن الاستثناء
 * @param {string} source - مصدر الاستثناء (main, renderer, promise)
 */
function recordException(err, source = 'unknown') {
  const crashData = {
    type: 'uncaught_exception',
    source,
    message: err && err.message ? String(err.message) : String(err),
    stack: err && err.stack ? String(err.stack) : '',
    name: err && err.name ? String(err.name) : 'Error'
  };
  return writeCrashLog(crashData);
}

/**
 * تسجيل رفض وعد غير معالج
 * @param {Object} reason - سبب الرفض
 * @param {Promise} promise - الوعد المرفوض
 */
function recordUnhandledRejection(reason, promise) {
  const crashData = {
    type: 'unhandled_rejection',
    reason: reason && reason.message ? String(reason.message) : String(reason),
    stack: reason && reason.stack ? String(reason.stack) : '',
    promise: promise ? '[object Promise]' : 'unknown'
  };
  return writeCrashLog(crashData);
}

/**
 * تسجيل تعطل عملية Renderer
 * @param {Object} eventData - بيانات الحدث من Electron
 */
function recordRendererCrash(eventData) {
  const crashData = {
    type: 'renderer_crash',
    processType: 'renderer',
    reason: eventData && eventData.reason ? String(eventData.reason) : 'unknown',
    exitCode: eventData && eventData.exitCode !== undefined ? eventData.exitCode : null,
    reproductionURL: eventData && eventData.reproductionURL ? String(eventData.reproductionURL) : ''
  };
  return writeCrashLog(crashData);
}

/**
 * تسجيل تعطل عملية Main
 * @param {Object} eventData - بيانات الحدث من Electron
 */
function recordMainCrash(eventData) {
  const crashData = {
    type: 'main_process_crash',
    processType: 'main',
    reason: eventData && eventData.reason ? String(eventData.reason) : 'unknown',
    exitCode: eventData && eventData.exitCode !== undefined ? eventData.exitCode : null
  };
  return writeCrashLog(crashData);
}

/**
 * تهيئة خدمة استعادة التعطل
 * @param {Object} opts - خيارات التهيئة
 * @param {BrowserWindow} opts.mainWindow - مرجع النافذة الرئيسية
 * @param {boolean} opts.autoReopen - إعادة فتح تلقائي بعد التعطل (افتراضي true)
 */
function init(opts = {}) {
  if (_isInitialized) return;

  const { mainWindow, autoReopen = true } = opts;
  _mainWindow = mainWindow;

  // ضمان وجود دليل السجلات
  getLogDir();

  // 1. التقاط الاستثناءات غير الملتقطة (Main Process)
  process.on('uncaughtException', (err) => {
    console.error('[crash-recovery] uncaughtException:', err.message);
    recordException(err, 'main');
    if (autoReopen) {
      scheduleReopen();
    }
  });

  // 2. التقاط رفض الوعود غير المعالج (Main Process)
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[crash-recovery] unhandledRejection:', String(reason));
    recordUnhandledRejection(reason, promise);
  });

  // 3. التقاط تعطل عملية Renderer (عند استخدام webContents)
  if (_mainWindow && _mainWindow.webContents) {
    _mainWindow.webContents.on('crashed', (event, killed) => {
      console.error('[crash-recovery] renderer crashed:', killed);
      recordRendererCrash({ reason: killed ? 'killed' : 'crashed', exitCode: null });
      if (autoReopen) {
        scheduleReopen();
      }
    });
  }

  _isInitialized = true;
}

/**
 * جدولة إعادة فتح التطبيق بعد التعطل
 */
function scheduleReopen() {
  // انتظار قصير قبل إعادة الفتح للسماح بتسجيل السجلات
  setTimeout(() => {
    try {
      if (_mainWindow && !_mainWindow.isDestroyed()) {
        _mainWindow.reload();
      } else if (app && !app.isQuitting()) {
        // إنشاء نافذة رئيسية جديدة إذا كانت مغلقة
        const { BrowserWindow } = require('electron');
        const newWin = new BrowserWindow({
          width: 1400,
          height: 900,
          title: 'Lucca Caffè - POS (استعادة)',
          icon: path.join(__dirname, '..', 'icon.ico'),
          webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
          }
        });
        newWin.loadFile(path.join(__dirname, '..', 'index.html'));
        _mainWindow = newWin;
      }
    } catch (e) {
      console.error('[crash-recovery] فشل إعادة الفتح:', e.message);
    }
  }, 3000);
}

/**
 * تسجيل تعطل في عملية Renderer (يُستدعى من renderer عبر IPC)
 * @param {Object} crashData - بيانات التعطل منenderer
 */
function recordRendererCrashFromIPC(crashData) {
  return writeCrashLog({
    ...crashData,
    type: 'renderer_crash_ipc',
    processType: 'renderer',
    reportedVia: 'ipc'
  });
}

/**
 * الحصول على تقرير التعطل الأخير للتشخيص
 * @returns {Object|null}
 */
function getLatestCrashReport() {
  try {
    const logDir = getLogDir();
    const reportPath = path.join(logDir, CRASH_REPORT_FILE);
    if (!fs.existsSync(reportPath)) return null;
    const content = fs.readFileSync(reportPath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

/**
 * الحصول على جميع سجلات التعطل
 * @returns {Array}
 */
function getCrashHistory() {
  return [..._crashHistory];
}

/**
 * الحصول على إحصائيات التعطل
 * @returns {Object}
 */
function getCrashStats() {
  return {
    totalCrashes: _crashCount,
    logDir: getLogDir(),
    crashReportExists: fs.existsSync(path.join(getLogDir(), CRASH_REPORT_FILE)),
    initialized: _isInitialized,
    recentCrashes: _crashHistory.slice(-5)
  };
}

module.exports = {
  init,
  recordException,
  recordUnhandledRejection,
  recordRendererCrash,
  recordMainCrash,
  recordRendererCrashFromIPC,
  getLatestCrashReport,
  getCrashHistory,
  getCrashStats,
  writeCrashLog,
  writeCrashReport
};
