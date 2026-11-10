/**
 * Lucca POS — Test Runner (Phase 7)
 * يشغل جميع اختبارات الاستقرار للإصدار v1.4.0
 */

'use strict';

const path = require('path');

const TESTS = [
  { name: 'force-update', file: 'force-update.test.cjs' },
  { name: 'crash-recovery', file: 'crash-recovery.test.cjs' },
  { name: 'health-monitor', file: 'health-monitor.test.cjs' }
];

let passed = 0;
let failed = 0;
const results = [];

async function run() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  Lucca POS v1.4.0 — Enterprise Stability Test Suite   ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  for (const test of TESTS) {
    const testPath = path.join(__dirname, test.file);
    process.stdout.write(`🧪 تشغيل اختبار: ${test.name}... `);

    try {
      // تحميل وتشغيل الاختبار
      const mod = require(testPath);
      if (typeof mod.run === 'function') {
        const result = await mod.run();
        if (result.ok) {
          console.log('✅ نجح');
          passed++;
          results.push({ name: test.name, ok: true, details: result.details || '' });
        } else {
          console.log('❌ فشل');
          failed++;
          results.push({ name: test.name, ok: false, error: result.error || 'غير معروف' });
        }
      } else {
        console.log('⚠️  لا يحتوي على دالة run() — تخطي');
        results.push({ name: test.name, ok: true, details: 'تخطي (لا توجد دالة run)' });
      }
    } catch (err) {
      console.log('❌ فشل');
      failed++;
      results.push({ name: test.name, ok: false, error: err.message });
    }
  }

  console.log('\n═════════════════════════════════════════════════════════════');
  console.log(`📊 النتائج: ${passed} نجح، ${failed} فشل من أصل ${TESTS.length}`);
  console.log('═════════════════════════════════════════════════════════════\n');

  for (const r of results) {
    const status = r.ok ? '✅' : '❌';
    console.log(`${status} ${r.name}${r.ok ? '' : ' — ' + r.error}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('❌ خطأ غير متوقع في running tests:', err.message);
  process.exit(1);
});
