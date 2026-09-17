const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

// ===== C3-P1: اختبارات المتابعة (P1) =====
//  1) الجلسات خارج الذاكرة (SQLite): صف في DB مباشرة + تصمد أمام إعادة تشغيل السيرفر + logout يحذف + TTL يبطل ويحذف
//  2) التحصيل المقسّم (split) عبر /checkout: عدة دفعات بمجموع يساوي الإجمالي → close+split؛
//     إعادة محاولة idempotent؛ مجموع أقل → 409 والطلب مفتوح + تدقيق رفض
//  3) مسار الاسترداد الصريح: المديـر فقط (device → 403)؛ استرداد كامل → 201 + إعادة مخزون مرة؛
//     استرداد مرة ثانية كاملة → 409 (مزدوج) بدون إعادة مخزون ثانية
//  4) SSRF على /api/proxy-llm: مضيفات خاصة/mيتاداتا/غير مسموحة → 400؛ مضيف خاص مع إضافة عبر البيئة → 400 أيضاً؛ بلا مصادقة → 401
//  5) فحص مصدر ثابت: لا مسارات دفع محلي في ai-pos / confirmSplitPayment — كلها عبر checkoutToServer
const DEVICE_KEY = 'device-test-key-c3p1';
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-p1-'));
  const results = [];
  async function check(name, cond, extra = '') { results.push({ name, pass: !!cond, extra }); return !!cond; }

  async function bootServer(overrides = {}) {
    const dbPath = path.join(tmp, `${overrides.tag || 'main'}.db`);
    const port = await freePort();
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        DB_PATH: dbPath,
        PORT: String(port),
        BACKUP_DIR: path.join(tmp, 'backups'),
        DEVICE_API_KEY: DEVICE_KEY,
        ...overrides.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let exitCode = null;
    child.stderr.on('data', d => { stderr += d; });
    child.on('exit', c => { exitCode = c; });
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch { /* retry */ }
      await sleep(250);
    }
    return { child, dbPath, port, base: `http://127.0.0.1:${port}`, stderr: () => stderr, exitCode: () => exitCode };
  }
  function kill(child) { try { child.kill('SIGKILL'); } catch { /* done */ } }

  function dbRead(dbPath, sql, params = []) {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    try { return db.prepare(sql).get(...params); } finally { db.close(); }
  }
  function dbRows(dbPath, sql, params = []) {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    try { return db.prepare(sql).all(...params); } finally { db.close(); }
  }

  const apiFor = (base) => async (method, p, body, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* non-json */ }
    return { status: r.status, json: j };
  };

  // ═════ A) الخادم الرئيسي ═══════
  const main = await bootServer({ tag: 'main' });
  const api = apiFor(main.base);

  let tokenA = null;
  let token = null;
  let r = null;

  try {
    // ── تحضير مدير ──
    r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    await check('P1: login admin → 200', r.status === 200, JSON.stringify(r.json || r.status));
    r = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'testPass#2026' }, r.json.token);
    await check('P1: change password → 200', r.status === 200, `status=${r.status}`);
    r = await api('POST', '/api/auth/login', { username: 'admin', password: 'testPass#2026' });
    await check('P1: login جديد → 200', r.status === 200 && r.json?.mustChangePassword === false, JSON.stringify(r.json || r.status));
    tokenA = r.json.token;

    // ── 1 restore الجلسة في SQLite ──
    r = await api('GET', '/api/auth/verify', null, tokenA);
    await check('P1: verify → 200 قبل إعادة التشغيل', r.status === 200, `status=${r.status}`);
    const sRow = dbRead(main.dbPath, 'SELECT token, userId, username, role, createdAt, expiresAt FROM sessions WHERE token = ?', [tokenA]);
    await check('P1: جلسة admin مسجّلة كصف في جدول sessions (قراءة مباشرة من DB)', !!sRow && sRow.token === tokenA && Number(sRow.userId) === 1 && Number(sRow.expiresAt) > Number(sRow.createdAt), JSON.stringify(sRow || null).slice(0, 160));

    // ── إعادة تشغيل حقيقية (SIGKILL + spawn جديد على نفس DB) ──
    kill(main.child);
    await sleep(600);
    const revived = await bootServer({ tag: 'main', env: {} });
    const api2 = apiFor(revived.base);
    r = await api2('GET', '/api/auth/verify', null, tokenA);
    await check('P1: بعد إعادة تشغيل السيرفر الجلسة ما زالت صالحة (خارج الذاكرة)', r.status === 200, `status=${r.status} ${r.json?.error || ''}`);
    r = await api2('POST', '/api/auth/logout', null, tokenA);
    await check('P1: logout → 200', r.status === 200, `status=${r.status}`);
    r = await api2('GET', '/api/auth/verify', null, tokenA);
    await check('P1: verify بعد logout → 401', r.status === 401, `status=${r.status}`);
    const gone = dbRead(revived.dbPath, 'SELECT token FROM sessions WHERE token = ?', [tokenA]);
    await check('P1: صف الجلسة حُذف من DB بعد logout', !gone, JSON.stringify(gone || null));

    // إعادة دخول لبقية الاختبارات
    r = await api2('POST', '/api/auth/login', { username: 'admin', password: 'testPass#2026' });
    token = r.json.token;
    await check('P1: إعادة دخول بعد إعادة التشغيل → 200', r.status === 200, `status=${r.status}`);

    // ── بيانات أساسية ──
    r = await api2('POST', '/api/inventory', { name: 'قهوة', quantity: 50, unit: 'cup', minStock: 5 }, token);
    await check('P1: بذر مخزون قهوة=50 → 201', r.status === 201, `status=${r.status}`);
    r = await api2('POST', '/api/products', { name: 'قهوة أمريكية', price: 30, available: 1 }, token);
    const productId = r.json?.id;
    await check('P1: بذر منتج → 201', r.status === 201, `status=${r.status}`);
    r = await api2('POST', '/api/product_recipes', { productId, ingredient: 'قهوة', quantity: 2 }, token);
    await check('P1: بذر وصفة (قهوة×2) → 201', r.status === 201, `status=${r.status}`);

    async function invQty(portBase, name) {
      const get = await apiFor(portBase)('GET', '/api/inventory', null, token);
      const list = get.json || [];
      const it = (Array.isArray(list) ? list : list.rows || []).find(x => String(x.name) === name);
      return it ? Number(it.quantity) : NaN;
    }
    async function paymentsFor(portBase, orderId) {
      const get = await apiFor(portBase)('GET', '/api/payments', null, token);
      const list = get.json || [];
      const rows = Array.isArray(list) ? list : list.rows || list.data || [];
      return rows.filter(p => String(p.orderId) === String(orderId));
    }
    async function createOrder(portBase, items, subtotal, total, extra = {}) {
      const res = await apiFor(portBase)('POST', '/api/orders', {
        status: 'pending', paymentStatus: 'unpaid', tableId: 'takeaway', items,
        subtotal, discount: 0, tax: 0, total, createdBy: 'p1-test', ...extra,
      }, token);
      if (res.json?.id) return res.json.id;
      if (Array.isArray(res.json) && res.json[0]?.id) return res.json[0].id;
      return null;
    }
    const AUD = api2;

    // ── 2) التحصيل المقسّم (split) عبر /checkout ──
    const itemCof = [{ productId, name: 'قهوة أمريكية', quantity: 1, price: 30, unitPrice: 30, total: 30 }];
    const oSplit = await createOrder(revived.base, itemCof, 30, 30);
    await check('P1-split: إنشاء طلب 30 → id موجود', oSplit != null, `id=${oSplit}`);

    r = await api2('POST', `/api/orders/${oSplit}/checkout`, {
      payments: [{ method: 'cash', amount: 15, paymentSyncId: 'sp-a1' }, { method: 'card', amount: 15, paymentSyncId: 'sp-a2' }],
    }, token);
    await check('P1-split: دفعتان (15 كاش + 15 فيزا = 30) → 200', r.status === 200 && r.json?.success === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    r = await api2('GET', `/api/orders/${oSplit}`, null, token);
    await check('P1-split: الطلب مغلق ودفعته split', r.json?.status === 'closed' && r.json?.paymentStatus === 'paid' && r.json?.paymentMethod === 'split', `status=${r.json?.status} method=${r.json?.paymentMethod}`);
    const paySplit = await paymentsFor(revived.base, oSplit);
    const sumSplit = paySplit.reduce((s, p) => s + Number(p.amount), 0);
    await check('P1-split: صفا دفع مسجلان للمجموع 30', paySplit.length === 2 && Math.abs(sumSplit - 30) < 0.01, `count=${paySplit.length} sum=${sumSplit}`);
    await check('P1-split: خصم مخزون واحد (قهوة 50→48)', (await invQty(revived.base, 'قهوة')) === 48, `qty=${await invQty(revived.base, 'قهوة')}`);
    r = await api2('GET', '/api/audit_logs', null, token);
    const aud = r.json || [];
    await check('P1-split: تدقيق checkout ناجح مسجل', Array.isArray(aud) && aud.some(a => a.action === 'checkout' && a.objectType === 'orders'), `action=checkout count=${Array.isArray(aud) ? aud.filter(a => a.action === 'checkout').length : 0}`);

    // إعادة محاولة نفس الدفعات → idempotent
    r = await api2('POST', `/api/orders/${oSplit}/checkout`, {
      payments: [{ method: 'cash', amount: 15, paymentSyncId: 'sp-a1' }, { method: 'card', amount: 15, paymentSyncId: 'sp-a2' }],
    }, token);
    await check('P1-split: إعادة نفس الدفعات → alreadyProcessed', r.status === 200 && r.json?.alreadyProcessed === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    const paySplit2 = await paymentsFor(revived.base, oSplit);
    await check('P1-split: لا تكرار دفع بعد إعادة المحاولة (يبقى صفّان)', paySplit2.length === 2, `count=${paySplit2.length}`);
    await check('P1-split: لا خصم مخزون مزدوج بعد إعادة المحاولة (قهوة=48)', (await invQty(revived.base, 'قهوة')) === 48, `qty=${await invQty(revived.base, 'قهوة')}`);

    // ── 2b) مبلغ لا يطابق الإجمالي → 409 والطلب مفتوح ──
    const oShort = await createOrder(revived.base, itemCof, 30, 30);
    r = await api2('POST', `/api/orders/${oShort}/checkout`, {
      payments: [{ method: 'cash', amount: 10, paymentSyncId: 'sp-b1' }],
    }, token);
    await check('P1-split: دفعة أقل من الإجمالي (10 من 30) → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    r = await api2('GET', `/api/orders/${oShort}`, null, token);
    await check('P1-split: الطلب بقي مفتوحاً بعد 409 (pending/unpaid)', r.json?.status !== 'closed' && (r.json?.paymentStatus || 'unpaid') === 'unpaid', `status=${r.json?.status} pay=${r.json?.paymentStatus}`);
    await check('P1-split: لا دفعات سجلت بعد الرفض', (await paymentsFor(revived.base, oShort)).length === 0, `count=${(await paymentsFor(revived.base, oShort)).length}`);
    await check('P1-split: لا خصم مخزون بعد النسخة المرفوضة (قهوة=48)', (await invQty(revived.base, 'قهوة')) === 48, `qty=${await invQty(revived.base, 'قهوة')}`);
    const aud2 = (await AUD('GET', '/api/audit_logs', null, token)).json || [];
    await check('P1-split: تدقيق رفض checkout (checkout.rejected) مسجل', Array.isArray(aud2) && aud2.some(a => a.action === 'checkout.rejected' && a.objectType === 'orders'), 'checkout.rejected audit');

    // ── 3) مسار الاسترداد الصريح ──
    r = await fetch(revived.base + '/api/refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': DEVICE_KEY },
      body: JSON.stringify({ orderId: oSplit, amount: 15, reason: 'اختبار جهاز' }),
    });
    let jDev = null; try { jDev = await r.json(); } catch { /* non-json */ }
    await check('P1-refund: device (دور محدود بلا refunds.write) → 403', r.status === 403, `status=${r.status} ${JSON.stringify(jDev || {})}`);

    const oRef = await createOrder(revived.base, itemCof, 30, 30);
    r = await api2('POST', `/api/orders/${oRef}/checkout`, { paymentMethod: 'cash', paymentSyncId: 'p1-ref-pay' }, token);
    await check('P1-refund: دفع الطلب (قهوة كان 48 → 46)', r.status === 200 && (await invQty(revived.base, 'قهوة')) === 46, `status=${r.status} qty=${await invQty(revived.base, 'قهوة')}`);
    r = await api2('POST', '/api/refunds', { orderId: oRef, amount: 30, reason: 'استرجاع كامل — تأسف صادق' }, token);
    await check('P1-refund: استرداد كامل من المسؤول → 201', r.status === 201, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    await check('P1-refund: إعادة مخزون مرة واحدة (قهوة 46→48)', (await invQty(revived.base, 'قهوة')) === 48, `qty=${await invQty(revived.base, 'قهوة')}`);
    r = await api2('POST', '/api/refunds', { orderId: oRef, amount: 30, reason: 'محاولة استرداد مزدوجة' }, token);
    await check('P1-refund: استرداد كامل مرة ثانية → 409 (استرداد مزدوج مرفوض)', r.status === 409, `status=${r.status} ${JSON.stringify(r.json || {})}`);
    await check('P1-refund: لا إعادة مخزون ثانية بعد المزدوج (قهوة=48)', (await invQty(revived.base, 'قهوة')) === 48, `qty=${await invQty(revived.base, 'قهوة')}`);
    const refRows = dbRows(revived.dbPath, 'SELECT orderId, amount, reason FROM refunds WHERE orderId = ?', [oRef]);
    await check('P1-refund: صف استرداد واحد فقط للطلب', refRows.length === 1, `count=${refRows.length}`);

    // ── 4) SSRF على /api/proxy-llm ──
    const ssrfBases = ['http://169.254.169.254/v1', 'https://169.254.169.254', 'http://192.168.1.10', 'http://10.0.0.5', 'http://172.16.0.5', 'http://evil.example.com'];
    for (const b of ssrfBases) {
      r = await api2('POST', '/api/proxy-llm', { base: b, prompt: 'hi' }, token);
      await check(`P1-ssrf: ${b} → 400 (محجوب)`, r.status === 400, `status=${r.status} ${JSON.stringify(r.json || {}).slice(0, 120)}`);
    }
    r = await api2('POST', '/api/proxy-llm', { base: 'ftp://api.openai.com', prompt: 'hi' }, token);
    await check('P1-ssrf: ftp:// → 400 (مخطط غير مسموح)', r.status === 400, `status=${r.status}`);
    r = await fetch(`${revived.base}/api/proxy-llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: 'https://api.openai.com/v1', prompt: 'hi' }) });
    await check('P1-ssrf: بلا مصادقة → 401', r.status === 401, `status=${r.status}`);

    // ── 5) فحص مصدر ثابت: لا دفع محلي في ai-pos / confirmSplitPayment ──
    const aiPos = fs.readFileSync(path.join(BACKEND_ROOT, '..', 'ai-pos-engine.js'), 'utf8');
    await check('P1-src: ai-pos يستخدم checkoutToServer', /checkoutToServer\s*\(/.test(aiPos), 'checkoutToServer');
    await check('P1-src: لا Orders.update بـ status completed/paid fallback', !/status:\s*'completed',\s*paymentStatus:\s*'paid'/.test(aiPos), 'completed+paid fallback');
    await check('P1-src: لا Orders.update بدفع محلي (status paid + paymentStatus paid)', !/status:\s*'paid',\s*paymentStatus:\s*'paid'/.test(aiPos), 'paid+paid update');
    await check('P1-src: ملاحظة الـ fallback القديمة أزيلت', aiPos.indexOf('Fallback: update order status manually') === -1, 'old fallback comment');

    const indexHtml = fs.readFileSync(path.join(BACKEND_ROOT, '..', 'index.html'), 'utf8');
    const fStart = indexHtml.indexOf('async function confirmSplitPayment');
    const fEnd = indexHtml.indexOf('// ═══ Sync Queue', fStart);
    const splitFn = indexHtml.slice(fStart, fEnd > fStart ? fEnd : fStart + 4000);
    await check('P1-src: confirmSplitPayment يستخدم checkoutToServer', /checkoutToServer\s*\(currentOrderId,\s*\{\s*payments/.test(splitFn), 'checkoutToServer in split');
    await check('P1-src: لا كتابة دفعة محلية (db.add payments) في الـ split', splitFn.indexOf('LuccaDB.db.add(\'payments\'') === -1 && splitFn.indexOf('db.add(\'payments\'') === -1, 'local payments add');
    await check('P1-src: لا pushAll() بعد إقفال الـ split', splitFn.indexOf('pushAll(') === -1, 'pushAll in split');

    const dbJs = fs.readFileSync(path.join(BACKEND_ROOT, '..', 'admin', 'database.js'), 'utf8');
    await check('P1-src: Orders.checkoutToServer معرف في database.js', /async checkoutToServer\s*\(orderId,\s*data\)/.test(dbJs), 'checkoutToServer defined');

    // ── 6) فاتورة يدوية (toolRecordInvoice + دردشة index.html) → مسار سيرفر فقط ──
    await check('P1-src: ai-pos toolRecordInvoice يستخدم recordManualInvoice', /recordManualInvoice\s*\(\{/.test(aiPos), 'recordManualInvoice in ai-pos');
    const invA = aiPos.slice(aiPos.indexOf('async toolRecordInvoice'), aiPos.indexOf('async toolViewExpenses'));
    await check('P1-src: toolRecordInvoice لا يكتب طلب paid محلياً', !/status:\s*'paid'/.test(invA) && !/paymentStatus:\s*'paid'/.test(invA), 'no local paid order in toolRecordInvoice');
    const invB = indexHtml.slice(indexHtml.indexOf('// Process invoice recording'), indexHtml.indexOf('// ===== INVOICES LIST ====='));
    await check('P1-src: دردشة invoice تستخدم recordManualInvoice', /recordManualInvoice\s*\(\{/.test(invB), 'recordManualInvoice in index.html');
    await check('P1-src: لا إنشاء طلب paid محلي في دردشة invoice', !/status:\s*'paid'/.test(invB) && !/paymentStatus:\s*'paid'/.test(invB), 'no local paid in chat invoice');
    await check('P1-src: لا hack مصروف إيراد بمبلغ 0 في دردشة invoice', invB.indexOf('category:\'إيراد\'') === -1 && invB.indexOf('amount:0') === -1, 'no zero-expense hack');
    await check('P1-src: recordManualInvoice معرف في database.js (POST orders + checkout)', /async recordManualInvoice\s*\(\{/.test(dbJs), 'recordManualInvoice defined');

    // ── 6b) ai-pos split stub (awaitingSplitDetails) مكتمل → مسار /checkout على السيرفر ──
    const splitWired =
      /this\.pendingSplit\s*=\s*\{\s*orderId:\s*order\.id/.test(aiPos) &&        // toolSplitPayment يحفظ السياق
      /if \(this\.pendingSplit\)/.test(aiPos) &&                                  // process() يستهلكه
      /checkoutToServer\s*\(sp\.orderId,\s*\{\s*payments/.test(aiPos) &&         // عبر مسار split السيرفر
      /paymentSyncId/.test(aiPos.slice(aiPos.indexOf('async _executeSplitDetails'), aiPos.indexOf('async toolSplitBill'))); // هوية دفع مستقرة
    await check('P1-src: split stub مكتمل — awaitingSplitDetails موصول بـ checkoutToServer(payments)', splitWired, 'pendingSplit-wired');

    // ── 7) جرّب فاتورة يدوية شكلاً مطابقاً لما يرسله العميل إلى السيرفر ──
    const invBody = {
      status: 'pending', paymentStatus: 'unpaid', orderType: 'takeaway', tableId: 'takeaway',
      orderNumber: 'INV-' + Date.now(),
      items: [{ name: 'بيع قهوة', quantity: 1, price: 15000, unitPrice: 15000, total: 15000 }],
      subtotal: 15000, discount: 0, discountAmount: 0, discountType: 'percent', tax: 0,
      total: 15000, paymentMethod: 'card', createdBy: 'test'
    };
    r = await api2('POST', '/api/orders', invBody, token);
    await check('P1-invoice: إنشاء طلب مفتوح للفاتورة → 201', r.status === 201 && r.json && r.json.id, `status=${r.status} ${JSON.stringify(r.json || {}).slice(0, 160)}`);
    const invId = r.json && r.json.id;
    if (invId) {
      r = await api2('POST', `/api/orders/${invId}/checkout`, { paymentMethod: 'card', paymentSyncId: 'inv-test-' + Date.now() }, token);
      await check('P1-invoice: إقفال فاتورة عبر /checkout → 200', r.status === 200 && r.json && r.json.order && r.json.order.status === 'closed', `status=${r.status} ${JSON.stringify(r.json || {}).slice(0, 200)}`);
      const payRows = dbRows(revived.dbPath, 'SELECT method, amount FROM payments WHERE orderId = ?', [invId]);
      await check('P1-invoice: صف دفع واحد (card) للفاتورة', payRows.length === 1 && payRows[0].method === 'card', JSON.stringify(payRows));
      const auRows = dbRows(revived.dbPath, "SELECT action FROM audit_logs WHERE objectType = 'orders' AND objectId = ?", [invId]);
      await check('P1-invoice: تدقيق checkout مسجل للفاتورة', auRows.some(x => String(x.action).includes('checkout')), JSON.stringify(auRows));
    }
  } catch (e) {
    results.push({ name: 'fatal error (main)', pass: false, extra: String(e).slice(0, 500) + ' || exit=' + main.exitCode() + ' || stderr=' + main.stderr().slice(-500) });
  } finally {
    kill(main.child);
  }

  // ═════ B) خادم TTL + تضمين مضيف خاص عبر البيئة (فرع SSRF الداخلي) ═══════
  {
    const ttl = await bootServer({ tag: 'ttl', env: { SESSION_TTL_MS: '1500', OLLAMA_BASE_URL: 'http://10.0.50.99/v1' } });
    const apiT = apiFor(ttl.base);
    try {
      let r = await apiT('POST', '/api/auth/login', { username: 'admin', password: '123456' });
      const tk = r.json?.token;
      await check('P1-ttl: دخول بخادم TTL قصير → 200', r.status === 200, `status=${r.status}`);
      r = await apiT('GET', '/api/auth/verify', null, tk);
      await check('P1-ttl: verify فوراً → 200', r.status === 200, `status=${r.status}`);
      const sTtl = dbRead(ttl.dbPath, 'SELECT token, expiresAt FROM sessions WHERE token = ?', [tk]);
      await check('P1-ttl: صف جلسة موجود في DB', !!sTtl && Number(sTtl.expiresAt) > 0, JSON.stringify(sTtl || null));
      const ttlDevice = await fetch(ttl.base + '/api/proxy-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': DEVICE_KEY },
        body: JSON.stringify({ base: 'http://10.0.50.99/v1', target: 'ollama', prompt: 'hi' }),
      });
      const tj = await ttlDevice.json().catch(() => ({}));
      await check('P1-ssrf: مضيف خاص أُضيف عبر OLLAMA_BASE_URL → 400 (خاص/ميتاداتا رغم القائمة البيضاء)', ttlDevice.status === 400 && /خاص|SSRF/.test(String(tj.error || '')), `status=${ttlDevice.status} ${JSON.stringify(tj).slice(0, 140)}`);
      await sleep(2500);
      r = await apiT('GET', '/api/auth/verify', null, tk);
      await check('P1-ttl: بعد انتهاء المهلة verify → 401', r.status === 401, `status=${r.status} ${r.json?.error || ''}`);
      const gone = dbRead(ttl.dbPath, 'SELECT token FROM sessions WHERE token = ?', [tk]);
      await check('P1-ttl: صف الجلسة المنتهية حُذف من DB', !gone, JSON.stringify(gone || null));
    } catch (e) {
      results.push({ name: 'fatal error (ttl)', pass: false, extra: String(e).slice(0, 500) });
    } finally {
      kill(ttl.child);
    }
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup */ }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  console.log('\n==== p1-followup results ====');
  for (const t of results) console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.name}${t.extra ? '  |  ' + t.extra : ''}`);
  console.log(`==== ${pass}/${results.length} passed, ${fail} failed ====`);
  process.exit(fail > 0 ? 1 : 0);
})();