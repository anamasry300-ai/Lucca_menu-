/**
 * Lucca POS — Health Monitor Test (Phase 7)
 * اختبارات لمراقب الصحة:
 * - جلب إحصائيات الذاكرة
 * - جلب استخدام المعالج
 * - التحقق من صحة النظام
 * - بدء وإيقاف المراقبة
 */

'use strict';

let results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  results.push({ ok: true, message });
}

async function run() {
  results = [];

  // اختبار 1: تحميل وحدة health-monitor
  try {
    const healthMonitor = require('../main/js/health-monitor');
    assert(typeof healthMonitor.getMemoryStats === 'function', 'دالة getMemoryStats موجودة');
    assert(typeof healthMonitor.getCPUUsage === 'function', 'دالة getCPUUsage موجودة');
    assert(typeof healthMonitor.runHealthCheck === 'function', 'دالة runHealthCheck موجودة');
    assert(typeof healthMonitor.startMonitoring === 'function', 'دالة startMonitoring موجودة');
    assert(typeof healthMonitor.stopMonitoring === 'function', 'دالة stopMonitoring موجودة');
    assert(typeof healthMonitor.getState === 'function', 'دالة getState موجودة');
    console.log('✅ اختبار 1 نجح: تحميل الوحدة');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 1 فشل: ${err.message}` });
    console.log(`❌ اختبار 1 فشل: ${err.message}`);
  }

  // اختبار 2: إحصائيات الذاكرة
  try {
    const healthMonitor = require('../main/js/health-monitor');
    const mem = healthMonitor.getMemoryStats();
    assert(typeof mem.usedMB === 'number', 'usedMB يجب أن يكون رقماً');
    assert(typeof mem.totalMB === 'number', 'totalMB يجب أن يكون رقماً');
    assert(typeof mem.percent === 'number', 'percent يجب أن يكون رقماً');
    assert(mem.percent >= 0 && mem.percent <= 100, 'نسبة الذاكرة يجب أن تكون بين 0 و 100');
    console.log('✅ اختبار 2 نجح: إحصائيات الذاكرة');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 2 فشل: ${err.message}` });
    console.log(`❌ اختبار 2 فشل: ${err.message}`);
  }

  // اختبار 3: استخدام المعالج
  try {
    const healthMonitor = require('../main/js/health-monitor');
    const cpu = healthMonitor.getCPUUsage();
    assert(typeof cpu === 'number', 'استخدام المعالج يجب أن يكون رقماً');
    assert(cpu >= 0 && cpu <= 100, 'نسبة المعالج يجب أن تكون بين 0 و 100');
    console.log('✅ اختبار 3 نجح: استخدام المعالج');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 3 فشل: ${err.message}` });
    console.log(`❌ اختبار 3 فشل: ${err.message}`);
  }

  // اختبار 4: تشغيل فحص الصحة مع دوال وهمية
  try {
    const healthMonitor = require('../main/js/health-monitor');
    const result = await healthMonitor.runHealthCheck({
      checkDb: async () => { return { status: 'connected', latencyMs: 10 }; },
      checkUpdate: async () => { return { status: 'connected', latencyMs: 50 }; }
    });
    assert(typeof result.stats === 'object', 'الإحصائيات يجب أن تكون كائناً');
    assert(Array.isArray(result.warnings), 'التحذيرات يجب أن تكون مصفوفة');
    assert(typeof result.healthy === 'boolean', 'الحالة الصحية يجب أن تكونBoolean');
    console.log('✅ اختبار 4 نجح: فحص الصحة');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 4 فشل: ${err.message}` });
    console.log(`❌ اختبار 4 فشل: ${err.message}`);
  }

  // اختبار 5: بدء وإيقاف المراقبة
  try {
    const healthMonitor = require('../main/js/health-monitor');
    healthMonitor.startMonitoring({
      intervalMs: 1000,
      checkDb: async () => { return { status: 'connected' }; },
      checkUpdate: async () => { return { status: 'connected' }; }
    });
    assert(healthMonitor.getState().monitoring === true, 'المراقبة يجب أن تكون مفعلة');
    healthMonitor.stopMonitoring();
    assert(healthMonitor.getState().monitoring === false, 'المراقبة يجب أن تكون معطلة بعد التوقف');
    console.log('✅ اختبار 5 نجح: بدء وإيقاف المراقبة');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 5 فشل: ${err.message}` });
    console.log(`❌ اختبار 5 فشل: ${err.message}`);
  }

  // اختبار 6: تقييم الصحة مع تجاوز العتبة
  try {
    const healthMonitor = require('../main/js/health-monitor');
    const warnings = healthMonitor.evaluateHealth({
      memory: { percent: 95, usedMB: 1000, totalMB: 2000 },
      cpu: 90,
      database: { status: 'connected' },
      updateServer: { status: 'connected' }
    });
    assert(warnings.length > 0, 'يجب أن يكون هناك تحذير عندما تتجاوز الذاكرة 85%');
    assert(warnings.some(w => w.type === 'memory_high'), 'يجب أن يكون هناك تحذير ذاكرة عالية');
    console.log('✅ اختبار 6 نجح: تقييم الصحة مع تجاوز العتبة');
  } catch (err) {
    results.push({ ok: false, message: `اختبار 6 فشل: ${err.message}` });
    console.log(`❌ اختبار 6 فشل: ${err.message}`);
  }

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;

  console.log(`\n📊 نتائج Health Monitor: نجح ${okCount}، فشل ${failCount} من أصل ${results.length}`);

  return {
    ok: failCount === 0,
    details: `نفذ ${results.length} اختبار، نجح ${okCount}، فشل ${failCount}`,
    error: failCount > 0 ? 'بعض الاختبارات فشلت' : null
  };
}

module.exports = { run };
