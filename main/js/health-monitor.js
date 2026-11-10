/**
 * Lucca POS — Health Monitor Service (Phase 4)
 * يراقب استهلاك الذاكرة، المعالج، اتصال قاعدة البيانات، وخادم التحديث.
 * يولد تحذيرات عند تجاوز العتبات المحددة.
 *
 * @module health-monitor
 */

'use strict';

const os = require('os');

// ---- العتبات الافتراضية ----
const DEFAULT_THRESHOLDS = {
  memoryUsagePercent: 85, // نسبة استخدام الذاكرة المسموحة (%)
  cpuUsagePercent: 80,    // نسبة استخدام المعالج المسموحة (%)
  memoryWarningMB: 500,   # تحذير إذا تجاوزت الذاكرة 500 ميجابايت
  dbConnectTimeoutMs: 5000, // مهلة اتصال قاعدة البيانات (مللي ثانية)
  updateServerTimeoutMs: 10000 // مهلة اتصال خادم التحديث (مللي ثانية)
};

// ---- حالة المراقب ----
let _thresholds = { ...DEFAULT_THRESHOLDS };
let _isMonitoring = false;
let _monitorInterval = null;
let _intervalMs = 30000; // فحص كل 30 ثانية
let _callbacks = []; // دوال ردع للإشعارات
let _lastStats = null;
let _dbStatus = 'unknown';
let _updateServerStatus = 'unknown';
let _lastSyncTime = null;
let _lastCrashTime = null;

/**
 * الحصول على استخدام الذاكرة الحالي
 * @returns {Object} - { usedMB, totalMB, percent }
 */
function getMemoryStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const percent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
  return {
    usedMB: Math.round(usedMem / 1024 / 1024),
    totalMB: Math.round(totalMem / 1024 / 1024),
    percent,
    freeMB: Math.round(freeMem / 1024 / 1024)
  };
}

/**
 * الحصول على استخدام المعالج الحالي (تقريبي)
 * @returns {number} - نسبة الاستخدام (%)
 */
function getCPUUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    const idle = times.idle;
    const tick = times.user + times.nice + times.sys + times.irq + times.idle;
    totalIdle += idle;
    totalTick += tick;
  }
  return totalTick > 0 ? Math.round(((1 - totalIdle / totalTick) * 100)) : 0;
}

/**
 * التحقق من اتصال قاعدة البيانات (Supabase)
 * @param {Function} checkDbFn - دالة فحص الاتصال (تُعيد Promise)
 * @returns {Promise<{status: string, latencyMs?: number, error?: string}>}
 */
async function checkDatabaseConnection(checkDbFn) {
  const start = Date.now();
  try {
    if (typeof checkDbFn !== 'function') {
      return { status: 'unknown', error: 'دالة فحص قاعدة البيانات غير مقدمة' };
    }
    await checkDbFn();
    const latency = Date.now() - start;
    _dbStatus = 'connected';
    _lastSyncTime = new Date().toISOString();
    return { status: 'connected', latencyMs: latency };
  } catch (err) {
    _dbStatus = 'disconnected';
    return { status: 'disconnected', error: err.message || String(err), latencyMs: Date.now() - start };
  }
}

/**
 * التحقق من اتصال خادم التحديث (GitHub/electron-updater)
 * @param {Function} checkUpdateFn - دالة فحص التحديث (تُعيد Promise)
 * @returns {Promise<{status: string, latencyMs?: number, error?: string}>}
 */
async function checkUpdateServerConnection(checkUpdateFn) {
  const start = Date.now();
  try {
    if (typeof checkUpdateFn !== 'function') {
      return { status: 'unknown', error: 'دالة فحص التحديث غير مقدمة' };
    }
    await checkUpdateFn();
    const latency = Date.now() - start;
    _updateServerStatus = 'connected';
    return { status: 'connected', latencyMs: latency };
  } catch (err) {
    _updateServerStatus = 'disconnected';
    return { status: 'disconnected', error: err.message || String(err), latencyMs: Date.now() - start };
  }
}

/**
 * تقييم صحة النظام وإنشاء تحذيرات إذا لزم الأمر
 * @param {Object} stats - إحصائيات النظام الحالية
 * @returns {Array} - قائمة التحذيرات
 */
function evaluateHealth(stats) {
  const warnings = [];

  if (stats.memory.percent >= _thresholds.memoryUsagePercent) {
    warnings.push({
      type: 'memory_high',
      severity: stats.memory.percent >= 95 ? 'critical' : 'warning',
      message: `استخدام الذاكرة مرتفع: ${stats.memory.percent}% (الحد: ${_thresholds.memoryUsagePercent}%)`,
      value: stats.memory.percent,
      threshold: _thresholds.memoryUsagePercent
    });
  }

  if (stats.cpu >= _thresholds.cpuUsagePercent) {
    warnings.push({
      type: 'cpu_high',
      severity: stats.cpu >= 95 ? 'critical' : 'warning',
      message: `استخدام المعالج مرتفع: ${stats.cpu}% (الحد: ${_thresholds.cpuUsagePercent}%)`,
      value: stats.cpu,
      threshold: _thresholds.cpuUsagePercent
    });
  }

  if (stats.database.status === 'disconnected') {
    warnings.push({
      type: 'database_disconnected',
      severity: 'critical',
      message: 'قاعدة البيانات غير متصلة',
      error: stats.database.error
    });
  }

  if (stats.updateServer.status === 'disconnected') {
    warnings.push({
      type: 'update_server_disconnected',
      severity: 'warning',
      message: 'خادم التحديث غير متصل',
      error: stats.updateServer.error
    });
  }

  return warnings;
}

/**
 * تشغيل عملية المراقبة مرة واحدة
 * @param {Object} opts - خيارات التشغيل
 * @param {Function} opts.checkDb - دالة فحص قاعدة البيانات
 * @param {Function} opts.checkUpdate - دالة فحص خادم التحديث
 * @returns {Promise<Object>} - الإحصائيات والتحذيرات
 */
async function runHealthCheck(opts = {}) {
  const { checkDb, checkUpdate } = opts;

  const memory = getMemoryStats();
  const cpu = getCPUUsage();
  const database = await checkDatabaseConnection(checkDb);
  const updateServer = await checkUpdateServerConnection(checkUpdate);

  const stats = {
    timestamp: new Date().toISOString(),
    memory,
    cpu,
    database: database,
    updateServer: updateServer,
    uptime: process.uptime(),
    platform: process.platform,
    appVersion: null // سيتم تعبئته من قبل المسخدم
  };

  const warnings = evaluateHealth(stats);

  // إخطار الدوال المسجلة
  if (warnings.length > 0) {
    for (const cb of _callbacks) {
      try { cb({ warnings, stats }); } catch {}
    }
  }

  _lastStats = stats;
  return { stats, warnings, healthy: warnings.length === 0 };
}

/**
 * بدء المراقبة الدورية
 * @param {Object} opts - خيارات المراقبة
 * @param {number} opts.intervalMs - فترة الفحص بالمللي ثانية (افتراضي 30000)
 * @param {Function} opts.checkDb - دالة فحص قاعدة البيانات
 * @param {Function} opts.checkUpdate - دالة فحص خادم التحديث
 * @param {Function} opts.onHealthChange - دالة ردع عند اكتشاف تحذيرات
 */
function startMonitoring(opts = {}) {
  if (_isMonitoring) return;

  _intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
  _thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };

  if (opts.checkDb) _checkDbFn = opts.checkDb;
  if (opts.checkUpdate) _checkUpdateFn = opts.checkUpdate;
  if (opts.onHealthChange) _callbacks.push(opts.onHealthChange);

  _isMonitoring = true;

  // فحص فوري عند البدء
  runHealthCheck({ checkDb: _checkDbFn, checkUpdate: _checkUpdateFn }).catch(() => {});

  // فحص دوري
  _monitorInterval = setInterval(() => {
    runHealthCheck({ checkDb: _checkDbFn, checkUpdate: _checkUpdateFn }).catch(() => {});
  }, _intervalMs);
}

/**
 * إيقاف المراقبة الدورية
 */
function stopMonitoring() {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
  }
  _isMonitoring = false;
  _callbacks = [];
}

// مراجع للدوال الخارجية (يتم تعيينها من قبل المسخدم)
let _checkDbFn = null;
let _checkUpdateFn = null;
const DEFAULT_INTERVAL_MS = 30000;

/**
 * إضافة دالة ردع للإشعارات الصحية
 * @param {Function} callback - دالة تُستدعى عند وجود تحذيرات
 */
function onHealthWarning(callback) {
  if (typeof callback === 'function') {
    _callbacks.push(callback);
  }
}

/**
 * الحصول على الحالة الحالية للمراقب
 * @returns {Object}
 */
function getState() {
  return {
    monitoring: _isMonitoring,
    intervalMs: _intervalMs,
    thresholds: _thresholds,
    lastStats: _lastStats,
    dbStatus: _dbStatus,
    updateServerStatus: _updateServerStatus,
    lastSyncTime: _lastSyncTime,
    lastCrashTime: _lastCrashTime
  };
}

/**
 * تعيين وقت التعطل الأخير (يتم استدعاؤه من خدمة التعافي)
 * @param {string} timestamp - وقت التعطل
 */
function setLastCrashTime(timestamp) {
  _lastCrashTime = timestamp;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  getMemoryStats,
  getCPUUsage,
  checkDatabaseConnection,
  checkUpdateServerConnection,
  evaluateHealth,
  runHealthCheck,
  startMonitoring,
  stopMonitoring,
  onHealthWarning,
  getState,
  setLastCrashTime,
  init: function (opts = {}) {
    _thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
    _intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
  }
};
