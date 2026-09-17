const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

// ===== C3-P0: اختبارات قفل المسارات المالية (P0) =====
// الحالات (8) المطلوبة:
//  1) PUT /api/orders {status:'paid', total:0} على طلب مفتوح → 409 ويبقى مفتوحاً بلا دفعات
//  2) تعديل أو حذف طلب بعد checkout → 409 (لا صمت)
//  3) POST /api/sync بطلب paid/closed من هوية غير إدارية → لا يُكتب على السيرفر
//  4) POST/PUT/DELETE /api/payments عبر CRUD → 409
//  5) checkout مرتين بنفس paymentSyncId → دفعة واحدة وخصم مخزون واحد
//  6) checkout يخصم المخزون من الوصفات، و void يعيده مرة واحدة
//  7) POST /api/refunds بدون سبب/على طلب غير مدفوع/بقيمة مفرطة → مرفوض
//  8) مسار الـ checkout السعيد (الإغلاق + الدفعة + التدقيق) ما زال يعمل
const DEVICE_KEY = 'device-test-key-c3p0';

const BACKEND_ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-p0-'));
  const dbPath = path.join(tmp, 'test.db');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      BACKUP_DIR: path.join(tmp, 'backups'),
      DEVICE_API_KEY: DEVICE_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });

  const results = [];
  async function check(name, cond, extra = '') { results.push({ name, pass: !!cond, extra }); return !!cond; }

  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`${base}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 400));

    async function api(method, p, body, token) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch { /* non-json */ }
      return { status: r.status, json: j };
    }
    async function apiDevice(method, p, body) {
      const r = await fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-api-key': DEVICE_KEY },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await r.json(); } catch { /* non-json */ }
      return { status: r.status, json: j };
    }

    // ── Prepare admin session ──────────────────────────────
    let r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    await check('login admin fresh → 200', r.status === 200, JSON.stringify(r.json || r.status));
    r = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'testPass#2026' }, r.json.token);
    await check('change password → 200', r.status === 200, JSON.stringify(r.json || r.status));
    r = await api('POST', '/api/auth/login', { username: 'admin', password: 'testPass#2026' });
    await check('login new password → 200', r.status === 200 && r.json?.mustChangePassword === false, JSON.stringify(r.json || r.status));
    const token = r.json.token;

    // ── Seed inventory / product / recipe ──────────────────
    r = await api('POST', '/api/inventory', { name: 'قهوة', quantity: 50, unit: 'cup', minStock: 5 }, token);
    await check('seed inventory قهوة → 201', r.status === 201, `status=${r.status}`);
    r = await api('POST', '/api/inventory', { name: 'سكر', quantity: 1, unit: 'cup', minStock: 1 }, token);
    await check('seed inventory سكر → 201', r.status === 201, `status=${r.status}`);
    r = await api('POST', '/api/products', { name: 'قهوة أمريكية', price: 30, available: 1 }, token);
    await check('seed product → 201', r.status === 201, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    const productId = r.json?.id;
    r = await api('POST', '/api/product_recipes', { productId, ingredient: 'قهوة', quantity: 2 }, token);
    await check('seed recipe (قهوة أمريكية ← قهوة ×2) → 201', r.status === 201, `status=${r.status}`);

    async function invQty(name) {
      const get = await api('GET', '/api/inventory', null, token);
      const list = get.json || [];
      const it = (Array.isArray(list) ? list : list.rows || []).find(x => String(x.name) === name);
      return it ? Number(it.quantity) : NaN;
    }
    async function paymentsFor(orderId) {
      const get = await api('GET', '/api/payments', null, token);
      const list = get.json || [];
      const rows = Array.isArray(list) ? list : list.rows || list.data || [];
      return rows.filter(p => String(p.orderId) === String(orderId));
    }
    async function createOrder(items, subtotal, total, extra = {}) {
      const body = {
        status: 'pending',
        paymentStatus: 'unpaid',
        tableId: 'takeaway',
        items,
        subtotal,
        discount: 0,
        tax: 0,
        total,
        createdBy: 'p0-test',
        ...extra,
      };
      const res = await api('POST', '/api/orders', body, token);
      if (!res.json?.id && Array.isArray(res.json) && res.json[0]?.id) res.json.id = res.json[0].id;
      return res;
    }

    const NULL_ITEMS = [];

    // ═══ Case 1: PUT يدفع/يغلق طلباً مفتوحاً → 409 ═══
    r = await createOrder(NULL_ITEMS, 5, 5);
    await check('Case1: create open order → 201', r.status === 201, `status=${r.status}`);
    const o1 = r.json?.id;
    r = await api('PUT', `/api/orders/${o1}`, { status: 'paid', total: 0 }, token);
    await check('Case1: PUT {status:paid,total:0} → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    r = await api('GET', `/api/orders/${o1}`, null, token);
    await check('Case1: order still open unpaid', r.status === 200 && r.json?.status === 'pending' && r.json?.paymentStatus === 'unpaid', `status=${r.json?.status} pay=${r.json?.paymentStatus}`);
    const p1 = await paymentsFor(o1);
    await check('Case1: no payments recorded', p1.length === 0, `count=${p1.length}`);
    r = await api('PUT', `/api/orders/${o1}`, { paymentStatus: 'paid' }, token);
    await check('Case1: PUT {paymentStatus:paid} → 409', r.status === 409, `status=${r.status}`);
    r = await api('PUT', `/api/orders/${o1}`, { totalPaid: 50 }, token);
    await check('Case1: PUT {totalPaid:50} → 409', r.status === 409, `status=${r.status}`);
    r = await api('PUT', `/api/orders/${o1}`, { total: 0 }, token);
    await check('Case1: PUT {total:0} (غيّر الإجمالي يدوياً) → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    r = await api('PUT', `/api/orders/${o1}`, { customerNotes: 'ملاحظة تشغيلية' }, token);
    await check('Case1: PUT {customerNotes} على طلب مفتوح → 200 (تعديل تشغيلي مسموح)', r.status === 200, `status=${r.status}`);
    r = await api('PUT', `/api/orders/${o1}`, { subtotal: 5, discount: 0, tax: 0, total: 5, paymentMethod: 'cash' }, token);
    await check('Case1: PUT بإجمالي مطابق للحساب → 200', r.status === 200, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    r = await api('GET', '/api/audit_logs', null, token);
    const auditRows = (r.json || []);
    await check('Case1: رفض الـ PUT مقيَّد في audit_logs', Array.isArray(auditRows) && auditRows.some(a => a.action === 'orders.rejected'), `count=${Array.isArray(auditRows) ? auditRows.length : 0}`);
    await check('Case1: نجاح التعديل مقيَّد في audit_logs', Array.isArray(auditRows) && auditRows.some(a => a.action === 'update' && a.objectType === 'orders'), 'update audit');

    // ═══ Case 4: الدفعات عبر CRUD → 409 ═══
    r = await api('POST', '/api/payments', { orderId: o1, amount: 5, method: 'cash', status: 'completed' }, token);
    await check('Case4: POST /api/payments → 409', r.status === 409, `status=${r.status}`);
    r = await api('PUT', '/api/payments/1', { amount: 99 }, token);
    await check('Case4: PUT /api/payments/1 → 409', r.status === 409, `status=${r.status}`);
    r = await api('DELETE', '/api/payments/1', null, token);
    await check('Case4: DELETE /api/payments/1 → 409', r.status === 409, `status=${r.status}`);

    // ═══ Cases 2 + 5 + 6 (+ قاعدة حالة 8): checkout سعيد + خصم واحد + isOrderPaidOrClosed ═══
    const item1 = [{ productId, name: 'قهوة أمريكية', quantity: 1, price: 30, unitPrice: 30, total: 30 }];
    r = await createOrder(item1, 30, 30);
    await check('Case2/5: create order → 201', r.status === 201, `status=${r.status}`);
    const o2 = r.json?.id;
    const PSID = 'p0-payment-sync-1';
    r = await api('POST', `/api/orders/${o2}/checkout`, { paymentMethod: 'cash', paymentSyncId: PSID }, token);
    await check('Case2/5: checkout #1 → 200 success (happy path still works)', r.status === 200 && r.json?.success === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    await check('Case6: قهوة خُصمت بالوصفة (50 → 48)', (await invQty('قهوة')) === 48, `qty=${await invQty('قهوة')}`);
    r = await api('POST', `/api/orders/${o2}/checkout`, { paymentMethod: 'cash', paymentSyncId: PSID }, token);
    await check('Case5: checkout #2 نفس paymentSyncId → alreadyProcessed', r.status === 200 && r.json?.alreadyProcessed === true, `status=${r.status}`);
    await check('Case5: دفعة واحدة فقط للطلب', (await paymentsFor(o2)).length === 1, `count=${(await paymentsFor(o2)).length}`);
    await check('Case6: خصم واحد فقط (لا خصم مزدوج عبر إعادة الدفع)', (await invQty('قهوة')) === 48, `qty=${await invQty('قهوة')}`);
    const moves = await api('GET', '/api/stock_movements', null, token);
    const saleMoves = (moves.json || []).filter(m => m.type === 'sale' && String(m.orderId) === String(o2));
    await check('Case6: حركة sale واحدة للطلب', saleMoves.length === 1 && Math.abs(Number(saleMoves[0].quantity)) === 2, `sales=${saleMoves.length}`);

    // Case 2: تعديل/حذف الطلب المغلق → 409
    r = await api('PUT', `/api/orders/${o2}`, { notes: 'بعد الدفع' }, token);
    await check('Case2: PUT notes على طلب مدفوع → 409', r.status === 409, `status=${r.status}`);
    r = await api('PUT', `/api/orders/${o2}`, { status: 'ready' }, token);
    await check('Case2: PUT status على طلب مدفوع → 409', r.status === 409, `status=${r.status}`);
    r = await api('DELETE', `/api/orders/${o2}`, null, token);
    await check('Case2: DELETE طلب مدفوع → 409', r.status === 409, `status=${r.status}`);

    // ═══ Case 7: قيود الاسترداد النقدي ═══
    r = await api('POST', '/api/refunds', { orderId: o2, amount: 5 }, token);
    await check('Case7: refund بدون سبب → 409', r.status === 409, `status=${r.status}`);
    r = await api('POST', '/api/refunds', { orderId: o2, amount: 0, reason: 'اختبار' }, token);
    await check('Case7: refund بقيمة صفر → 409', r.status === 409, `status=${r.status}`);
    r = await createOrder(NULL_ITEMS, 5, 5); // طلب مفتوح غير مدفوع
    const o3 = r.json?.id;
    r = await api('POST', '/api/refunds', { orderId: o3, amount: 5, reason: 'اختبار' }, token);
    await check('Case7: refund على طلب غير مدفوع → 409', r.status === 409, `status=${r.status}`);
    r = await api('POST', '/api/refunds', { orderId: o2, amount: 999999, reason: 'اختبار' }, token);
    await check('Case7: refund أكبر من صافي المدفوع → 409', r.status === 409, `status=${r.status}`);
    r = await api('POST', '/api/refunds', { orderId: o2, amount: 5, reason: 'استرجاع فرعي' }, token);
    await check('Case7: refund صحيح على طلب مدفوع → 201', r.status === 201, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    const refId = r.json?.id;
    r = await api('DELETE', `/api/refunds/${refId}`, null, token);
    await check('Case7: DELETE refund (admin) → 200 + تدقيق', r.status === 200, `status=${r.status}`);
    r = await api('GET', '/api/audit_logs', null, token);
    const audit2 = (r.json || []);
    await check('Case7: حذف الاسترداد مقيَّد', Array.isArray(audit2) && audit2.some(a => a.action === 'delete' && a.objectType === 'refunds'), 'delete refund audit');

    // ═══ Case 6: void يعيد المخزون مرة واحدة ═══
    r = await api('POST', `/api/orders/${o2}/void`, { reason: 'إلغاء تجريبي' }, token);
    await check('Case6: void → 200', r.status === 200 && r.json?.success === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    await check('Case6: قهوة عادت إلى 50 بعد void', (await invQty('قهوة')) === 50, `qty=${await invQty('قهوة')}`);
    const moves2 = await api('GET', '/api/stock_movements', null, token);
    const retMoves = (moves2.json || []).filter(m => m.type === 'return' && String(m.orderId) === String(o2));
    await check('Case6: حركة return واحدة للطلب', retMoves.length === 1, `returns=${retMoves.length}`);

    // ═══ Case: عجز المخزون → 409 ثم allowNegativeStock ═══
    r = await createOrder([{ name: 'سكر', quantity: 5, price: 10, unitPrice: 10, total: 50 }], 50, 50);
    const o4 = r.json?.id;
    r = await api('POST', `/api/orders/${o4}/checkout`, { paymentMethod: 'cash', paymentSyncId: 'p0-short-1' }, token);
    await check('Case6b: مخزون غير كافٍ (سكر 1 < 5) → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    r = await api('GET', `/api/orders/${o4}`, null, token);
    await check('Case6b: الطلب ظل مفتوحاً بعد 409', r.status === 200 && r.json?.status === 'pending', `status=${r.json?.status}`);
    await check('Case6b: لا دفعات بعد 409', (await paymentsFor(o4)).length === 0, `count=${(await paymentsFor(o4)).length}`);
    await check('Case6b: سكر لم يتغير بعد 409', (await invQty('سكر')) === 1, `qty=${await invQty('سكر')}`);
    r = await api('POST', '/api/settings', { key: 'allowNegativeStock', value: 'true' }, token);
    await check('Case6b: تعيين allowNegativeStock → 201', r.status === 201, `status=${r.status}`);
    r = await api('POST', `/api/orders/${o4}/checkout`, { paymentMethod: 'cash', paymentSyncId: 'p0-short-2' }, token);
    await check('Case6b: allowNegativeStock → success 200', r.status === 200 && r.json?.success === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    await check('Case6b: سكر أصبح سالباً (-4) بإذن الإعداد', (await invQty('سكر')) === -4, `qty=${await invQty('سكر')}`);

    // ═══ Case 3: sync بطلب مدفوع/مغلق من جهاز → لا يُكتب ═══
    r = await apiDevice('POST', '/api/sync', {
      orders: [
        { syncId: 'dev-paid-order-1', status: 'closed', paymentStatus: 'paid', items: '[]', subtotal: 10, discount: 0, tax: 0, total: 10 },
      ],
      payments: [
        { syncId: 'dev-pay-1', orderId: 1, amount: 10, method: 'cash', status: 'completed' },
      ],
    });
    await check('Case3: sync من جهاز → 200 (مع سجل نشاط)', r.status === 200, `status=${r.status}`);
    const log = r.json?.log || {};
    const rejected = (log.conflicts || 0) + (log.skipped || 0);
    await check('Case3: الصف المالي مردود في الرد (conflicts/skipped)', rejected >= 2, JSON.stringify(log));
    r = await api('GET', '/api/orders', null, token);
    const allOrders = (r.json || []);
    await check('Case3: الطلب المدفوع لم يُكتب على السيرفر', !allOrders.some(o => o.syncId === 'dev-paid-order-1'), 'paid order leaked');
    r = await api('GET', '/api/payments', null, token);
    const allPayments = (r.json || []);
    await check('Case3: الدفعة القادمة من الجهاز لم تُكتب', !allPayments.some(p => p.syncId === 'dev-pay-1'), 'payment leaked');

    // Positive: طلب مفتوح من جهاز عبر sync ما زال يُدمج (الـ whitelist ليس إغلاقاً كاملاً)
    r = await apiDevice('POST', '/api/sync', {
      orders: [
        { syncId: 'dev-open-order-1', status: 'in_preparation', paymentStatus: 'unpaid', items: '[]', subtotal: 20, discount: 0, tax: 0, total: 20 },
      ],
    });
    await check('Case3b: طلب مفتوح (in_preparation) من جهاز يُدمج', r.status === 200 && (r.json?.log?.inserted || 0) >= 1, JSON.stringify(r.json?.log || {}));
    r = await api('GET', '/api/orders', null, token);
    const allOrders2 = (r.json || []);
    await check('Case3b: الطلب المفتوح موجود على السيرفر', allOrders2.some(o => o.syncId === 'dev-open-order-1'), 'open order missing');

    // ═══ ملخص: الأدوات المالية كلها سليمة بعد الإصلاحات ═══
    r = await api('GET', '/api/settings', null, token);
    await check('Case8b: قراءة settings سليمة (flow intact)', r.status === 200, `status=${r.status}`);
  } catch (e) {
    results.push({ name: 'fatal error', pass: false, extra: String(e).slice(0, 400) });
  } finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup */ }
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  console.log('\n==== p0-money-guards results ====');
  for (const t of results) console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.name}${t.extra ? '  |  ' + t.extra : ''}`);
  console.log(`==== ${pass}/${results.length} passed, ${fail} failed ====`);
  process.exit(fail > 0 ? 1 : 0);
})();