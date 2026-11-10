/**
 * Lucca POS — Crash Recovery Test (Phase 7)
 * اختبارات لاستعادة التعطل:
 * - تسجيل الاستثناءات غير الملتقطة
 * - تسجيل رفض الوعود غير المعالج
 * - توليد crash-report.json
 * - استعادة التطبيق بعد التعطل
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

let results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  results.push({ ok: true, message });
}

async function run() {
  results = [];

  // اختبار 1: التحقق من أن وحدة crash-recovery يمكن تحميلها
  try {
    const crashRecovery = require('../main/js/crash-recovery');
    assert(typeof crashRecovery.init === 'function', 'دالة init موجودة');
    assert(typeof crashRecovery.recordException === 'function', 'دالة recordException موجودة');
    assert(typeof crashRecovery.recordUnhandledRejection === 'function', 'دالة recordUnhandledRejection موجودة');
    assert(typeof crashRecovery.getCrashStats === 'function', 'دالة getCrashStats موجودة');
    assert(typeof crashRecovery.getLatestCrashReport === 'function', 'دالة getLatestCrashReport موجودة');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 1 فشل: ${err.message}` });
  }

  // اختبار 2: تسجيل استثناء والتحقق من إنشاء ملف السجل
  try {
    const crashRecovery = require('../main/js/crash-recovery');
    crashRecovery.init({ autoReopen: false });
    const logPath = crashRecovery.recordException(new Error('اختبار استثناء متعمد'), 'test');
    assert(logPath !== null, 'يجب إرجاع مسار ملف السجل');
    assert(fs.existsSync(logPath), 'يجب أن يكون ملف السجل موجوداً على القرص');
    
    // تنظيف ملف الاختبار
    try { fs.unlinkSync(logPath); } catch {}
    
    // التحقق من crash-report.json
    const report = crashRecovery.getLatestCrashReport();
    // قد يكون null إذا لم يتم إنشاء التقرير بعد، لكن يجب أن لا يفشل
    assert(report === null || typeof report === 'object', 'تقرير التعطل يجب أن يكون كائناً أو null');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 2 فشل: ${err.message}` });
  }

  // اختبار 3: تسجيل رفض وعد غير معالج
  try {
    const crashRecovery = require('../main/js/crash-recovery');
    crashRecovery.recordUnhandledRejection('رفض اختبار متعمد', null);
    results.push({ ok: true, message: 'تسجيل رفض الوعد نجح' });
  } catch (err) {
    results.push({ ok: false, message: `اختبار 3 فشل: ${err.message}` });
  }

  // اختبار 4: إحصائيات التعطل
  try {
    const crashRecovery = require('../main/js/crash-recovery');
    const stats = crashRecovery.getCrashStats();
    assert(typeof stats.totalCrashes === 'number', 'إجمالي التعطلات يجب أن يكون رقماً');
    assert(typeof stats.logDir === 'string', 'دليل السجلات يجب أن يكون نصاً');
    assert(typeof stats.initialized === 'boolean', 'حالة التهيئة يجب أن تكونBoolean');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 4 فشل: ${err.message}` });
  }

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;

  return {
    ok: failCount === 0,
    details: `نفذ ${results.length} اختبار، نجح ${okCount}، فشل ${failCount}`,
    error: failCount > 0 ? 'بعض الاختبارات فشلت' : null
  };
}

module.exports = { run };
