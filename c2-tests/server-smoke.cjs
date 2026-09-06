// ===== Server Smoke — الفحص السريع للأمان والصحة ضد السيرفر الحي =====
// 6 نقاط بلا أي كتابة: لا شبكة، لا sync، لا بيانات — GET/أذونات فقط.
// تشغيل: node c2-tests/server-smoke.cjs   (يفترض سيرفراً قائماً على localhost:3000)
const BASE = process.env.SERVER_URL || 'http://localhost:3000';
const GOOD_KEY = process.env.SERVER_KEY || 'lucca-secret-key';

let passed = 0, failed = 0;
function record(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
  ok ? passed++ : failed++;
}

async function statusOf(path, headers) {
  try {
    const r = await fetch(BASE + path, { headers, method: 'GET', redirect: 'manual' });
    return r.status;
  } catch { return 0; }
}

(async () => {
  // 1) الصحة
  const h = await (await fetch(BASE + '/health')).json().catch(() => ({}));
  record('1. health', h.status === 'ok', JSON.stringify(h));

  // 2) مصادقة صحيحة تصل للقراءة
  record('2. مفتاح صحيح -> GET /api/orders 200', await statusOf('/api/orders', { 'x-api-key': GOOD_KEY }) === 200, '');

  // 3) مفتاح خاطئ -> 401
  record('3. مفتاح خاطئ -> 401', await statusOf('/api/orders', { 'x-api-key': 'wrong-key-xyz' }) === 401, '');

  // 4) بلا مفتاح -> 401
  record('4. بلا مفتاح -> 401', await statusOf('/api/orders', {}) === 401, '');

  // 5) مخزن إداري (users) بمفتاح جهاز -> غير مسموح (device لا يقرأ الإدارة)
  const s5 = await statusOf('/api/users', { 'x-api-key': GOOD_KEY });
  record('5. users بمفتاح جهاز -> 403/401 (محمي إدارياً)', s5 === 403 || s5 === 401, `status=${s5}`);

  // 6) مزامنة إدارية: محاولة POST /api/auth/device-status بمفتاح جهاز -> مرفوض (دور device)
  let s6 = 0;
  try {
    const r = await fetch(BASE + '/api/auth/device-status', { method: 'GET', headers: { 'x-api-key': GOOD_KEY } });
    s6 = r.status;
  } catch { }
  record('6. device-status (يطلبه admin) بمفتاح جهاز -> 403/401', s6 === 403 || s6 === 401, `status=${s6}`);

  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
  process.exitCode = failed === 0 ? 0 : 1;
})().catch(e => { console.error('خطأ في التنفيذ:', e); process.exitCode = 1; });