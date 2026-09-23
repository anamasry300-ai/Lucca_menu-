// Phase 4 — Admin Control Center: write endpoints verification (Tier 1 + Tier 2).
// Boots the real compiled server against a seeded temp DB and checks each write op
// against the report numbers it must move (hasCostData philosophy):
//   catalog (tables/categories/products+recipes/payment-methods),
//   expenses, purchases, stock adjust/waste, attendance, daily shifts, RBAC 401/403.
// Usage: node test/phase4-admin-write.cjs   (requires `npm run build` first)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p4-device-key-123';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}

function awaitFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const D = '2026-09-03';
const TODAY = new Date().toISOString().slice(0, 10);

(async () => {
  try {
    const port = await awaitFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase4-'));
    const dbPath = path.join(tmp, 'p4.db');
    process.env.DB_PATH = dbPath;

    const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
    const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
    await dbMod.initDb();
    const run = (sql, params = []) => dbMod.execute(sql, params);

    const mkUser = (username, role) => {
      const pw = authMod.hashPassword(username + '#2026');
      run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)', [username, pw, username, role, 1, 0]);
    };
    mkUser('admin2', 'admin');
    mkUser('manager1', 'manager');
    mkUser('cashier1', 'cashier');

    run("INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)", [9501, 'طحين', 10, 'كجم', 5, 20]);
    run("INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)", [9502, 'حليب', 0, 'لتر', 5, 30]);
    run("INSERT INTO employees (name, role, salary, active) VALUES (?,?,?,?)", ['أحمد', 'كاشير', 0, 1]);
    run("INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)", [9201, 'كابتشينو محمي', 1, 150, 40]);
    run("INSERT INTO orders (id, orderNumber, status, paymentStatus, subtotal, total, totalPaid, orderType, paymentMethod, createdBy, date, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [100, 'X1', 'completed', 'paid', 150, 150, 150, 'dine_in', 'cash', 'كاشير1', `${D}T10:00:00`, `${D}T10:00:00`]);
    run("INSERT INTO order_items (orderId, productId, name, quantity, unitPrice, total) VALUES (?,?,?,?,?,?)", [100, 9201, 'كابتشينو محمي', 1, 150, 150]);

    dbMod.closeDb();

    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: BACKEND,
      env: { ...process.env, DB_PATH: dbPath, PORT: String(port), BACKUP_DIR: path.join(tmp, 'backups'), DEVICE_API_KEY: DEVICE_KEY },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });

    let up = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`${BASE}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 600));

    let gAdmin = null;
    let gManager = null;
    let gCashier = null;

    async function login(username, password) {
      const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      return { status: res.status, token: j.token || null, j };
    }

    async function api(method, p, body, headers) {
      const h = { 'Content-Type': 'application/json', ...(headers || {}) };
      if (!(headers || {}).Authorization && !(headers || {})['x-api-key']) h.Authorization = `Bearer ${gAdmin}`;
      const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    }
    const as = (token) => ({ Authorization: `Bearer ${token}` });

    const la = await login('admin2', 'admin2#2026');
    gAdmin = la.token;
    const lm = await login('manager1', 'manager1#2026');
    gManager = lm.token;
    const lc = await login('cashier1', 'cashier1#2026');
    gCashier = lc.token;
    record('إعداد الأدوار (admin/manager/cashier)', !!(gAdmin && gManager && gCashier), `tokens=${!!gAdmin}/${!!gManager}/${!!gCashier}`);

    // ===== RBAC 401/403 =====
    let r = await fetch(`${BASE}/api/cc/tables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: 40 }) });
    record('POST tables بلا هوية → 401', r.status === 401, `status=${r.status}`);
    r = await fetch(`${BASE}/api/cc/tables`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...as(gCashier) }, body: JSON.stringify({ number: 40 }) });
    record('POST tables كاشير (بلا tables.write) → 403', r.status === 403, `status=${r.status}`);
    r = await fetch(`${BASE}/api/cc/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...as(gCashier) }, body: JSON.stringify({ amount: 10 }) });
    record('POST expenses كاشير → 403', r.status === 403, `status=${r.status}`);

    // ===== القراءات التي كانت مفقودة =====
    let cat = await api('GET', '/api/cc/categories');
    record('GET /api/cc/categories → 200 + أقسام رئيسة', cat.status === 200 && cat.j.rows.length > 0, `rows=${cat.j.rows.length}`);
    let pm = await api('GET', '/api/cc/payment-methods');
    record('GET /api/cc/payment-methods → 200 + الافتراضية', pm.status === 200 && pm.j.rows.length > 0, `rows=${pm.j.rows.length}`);

    // ===== الطاولات =====
    let tb = await api('POST', '/api/cc/tables', { number: 41, zone: 'صالة' });
    record('POST tables 41 → 201', tb.status === 201 && tb.j.number === 41 && tb.j.status === 'available', JSON.stringify(tb.j));
    const tableId = tb.j && tb.j.id;
    tb = await api('POST', '/api/cc/tables', { number: 41 });
    record('POST tables رقم مكرر → 409', tb.status === 409, `status=${tb.status}`);
    tb = await api('PUT', `/api/cc/tables/${tableId}`, { status: 'reserved' });
    record('PUT tables status=reserved → 200', tb.status === 200 && tb.j.status === 'reserved', JSON.stringify(tb.j));
    tb = await api('DELETE', `/api/cc/tables/${tableId}`);
    record('DELETE tables → deleted', tb.status === 200 && tb.j.deleted === true, '');
    tb = await api('DELETE', `/api/cc/tables/${tableId}`);
    record('DELETE tables مرتين → 404', tb.status === 404, `status=${tb.status}`);

    // ===== الأقسام =====
    cat = await api('POST', '/api/cc/categories', { name: 'مشروبات الابتكار' });
    record('POST categories → 201', cat.status === 201 && cat.j.name === 'مشروبات الابتكار', JSON.stringify(cat.j || {}).slice(0, 120));
    const catId = cat.j && cat.j.id;
    cat = await api('POST', '/api/cc/categories', { name: 'مشروبات الابتكار' });
    record('POST categories اسم مكرر → 409', cat.status === 409, `status=${cat.status}`);
    const prodInCat = await api('POST', '/api/cc/products', { name: 'لقطة اختيار', categoryId: catId, price: 60, cost: 15 });
    record('POST products (داخل قسم جديد) → 201', prodInCat.status === 201 && prodInCat.j.id > 0, `status=${prodInCat.status}`);
    cat = await api('DELETE', `/api/cc/categories/${catId}`);
    record('DELETE categories بقسم فيه منتج → 409', cat.status === 409, `status=${cat.status}`);
    await api('DELETE', `/api/cc/products/${prodInCat.j.id}`);
    cat = await api('DELETE', `/api/cc/categories/${catId}`);
    record('DELETE categories بعد حذف المنتج → 200', cat.status === 200 && cat.j.deleted === true, JSON.stringify(cat.j));

    // ===== المنتجات + الوصفات =====
    const prod = await api('POST', '/api/cc/products', { name: 'قرفة سبيسي', categoryId: 1, price: 55, cost: 12, recipes: [{ ingredient: 'طحين', quantity: 0.5, unit: 'كجم' }] });
    record('POST products مع وصفة (مكوّن موجود) → 201', prod.status === 201 && prod.j.id > 0, JSON.stringify(prod.j || {}).slice(0, 140));
    const prodId = prod.j.id;
    let rec = await api('GET', `/api/cc/products/${prodId}/recipes`);
    record('GET recipes → مكوّن واحد', rec.status === 200 && rec.j.rows.length === 1 && rec.j.rows[0].ingredient === 'طحين', JSON.stringify(rec.j));
    rec = await api('PUT', `/api/cc/products/${prodId}/recipes`, { recipes: [{ ingredient: 'غير موجود إطلاقاً', quantity: 1 }] });
    record('PUT recipes مكوّن خارج المخزون → 400', rec.status === 400, `status=${rec.status}`);
    rec = await api('PUT', `/api/cc/products/${prodId}/recipes`, { recipes: [{ ingredient: 'حليب', quantity: 0.2, unit: 'لتر' }] });
    record('PUT recipes حليب → rows=1', rec.status === 200 && rec.j.rows.length === 1 && rec.j.rows[0].ingredient === 'حليب', JSON.stringify(rec.j));
    const delRef = await api('DELETE', '/api/cc/products/9201');
    record('DELETE منتج مُشار إليه في طلب → 409', delRef.status === 409, `status=${delRef.status}`);
    const delP = await api('DELETE', `/api/cc/products/${prodId}`);
    record('DELETE منتج جديد → 200', delP.status === 200 && delP.j.deleted === true, '');
    const badProd = await api('POST', '/api/cc/products', { name: 'بدون سعر', price: -5 });
    record('POST products سعر سالب → 400', badProd.status === 400, `status=${badProd.status}`);

    // ===== طرق الدفع =====
    pm = await api('POST', '/api/cc/payment-methods', { name: 'أبل باي', type: 'wallet' });
    record('POST payment-methods → 201', pm.status === 201 && pm.j.name === 'أبل باي', JSON.stringify(pm.j || {}).slice(0, 120));
    const pmId = pm.j.id;
    pm = await api('POST', '/api/cc/payment-methods', { name: 'أبل باي' });
    record('POST payment-methods اسم مكرر → 409', pm.status === 409, `status=${pm.status}`);
    pm = await api('PUT', `/api/cc/payment-methods/${pmId}`, { type: 'card' });
    record('PUT payment-methods type=card → 200', pm.status === 200 && pm.j.type === 'card', JSON.stringify(pm.j));
    pm = await api('DELETE', `/api/cc/payment-methods/${pmId}`);
    record('DELETE payment-methods → 200', pm.status === 200 && pm.j.deleted === true, '');

    // ===== المصروفات (عدد/إجمالي يتحرك ثم يعود) =====
    let ex = await api('GET', `/api/cc/expenses?from=${TODAY}&to=${TODAY}`);
    const before = { c: ex.j.summary.count, t: ex.j.summary.total };
    ex = await api('POST', '/api/cc/expenses', { amount: 50, description: 'ورق طباعة', category: 'operating', paymentMethod: 'cash' });
    record('POST expenses → 201 + id', ex.status === 201 && ex.j.id > 0, JSON.stringify(ex.j));
    const expId = ex.j.id;
    ex = await api('GET', `/api/cc/expenses?from=${TODAY}&to=${TODAY}`);
    record('expenses بعد الإضافة: count+1 total+50', ex.status === 200 && ex.j.summary.count === before.c + 1 && ex.j.summary.total === before.t + 50, JSON.stringify(ex.j.summary));
    ex = await api('DELETE', `/api/cc/expenses/${expId}`);
    record('DELETE expenses → 200', ex.status === 200 && ex.j.deleted === true, '');
    ex = await api('GET', `/api/cc/expenses?from=${TODAY}&to=${TODAY}`);
    record('expenses بعد الحذف: رجوع للأرقام', ex.status === 200 && ex.j.summary.count === before.c && ex.j.summary.total === before.t, JSON.stringify(ex.j.summary));
    ex = await api('POST', '/api/cc/expenses', { amount: 0 });
    record('POST expenses مبلغ صفر → 400', ex.status === 400, `status=${ex.status}`);

    // ===== المشتريات =====
    let pu = await api('GET', `/api/cc/purchases?from=${D}&to=${D}`);
    const puBefore = { c: pu.j.summary.count, t: pu.j.summary.total };
    pu = await api('POST', '/api/cc/purchases', { name: 'أرز', item: 'أرز بسمتي', quantity: 5, costPrice: 30, total: 150, date: D });
    record('POST purchases → 201', pu.status === 201 && pu.j.id > 0, JSON.stringify(pu.j || {}).slice(0, 120));
    const puId = pu.j.id;
    pu = await api('GET', `/api/cc/purchases?from=${D}&to=${D}`);
    record('purchases بعد الإضافة: count+1 total+150', pu.status === 200 && pu.j.summary.count === puBefore.c + 1 && pu.j.summary.total === puBefore.t + 150, JSON.stringify(pu.j.summary));
    pu = await api('DELETE', `/api/cc/purchases/${puId}`);
    record('DELETE purchases → 200', pu.status === 200 && pu.j.deleted === true, '');
    pu = await api('GET', `/api/cc/purchases?from=${D}&to=${D}`);
    record('purchases بعد الحذف: رجوع للأرقام', pu.status === 200 && pu.j.summary.count === puBefore.c && pu.j.summary.total === puBefore.t, JSON.stringify(pu.j.summary));

    // ===== المخزون: إنشاء/تعديل/جرد تكلفة/تالف =====
    let st = await api('GET', '/api/cc/stock');
    record('stock قبل عمليات الكتابة: totalValue=200', st.status === 200 && st.j.totalValue === 200, `value=${st.j.totalValue}`);
    st = await api('POST', '/api/cc/stock', { name: 'زيت جوز', quantity: 0, unit: 'لتر', costPrice: 50, minStock: 2 });
    record('POST stock → 201', st.status === 201 && st.j.id > 0, JSON.stringify(st.j || {}).slice(0, 120));
    const stId = st.j.id;
    st = await api('POST', `/api/cc/stock/${stId}/adjust`, { delta: 5, notes: 'تسوية' });
    record('adjust +5 → qty=5', st.status === 200 && st.j.quantity === 5, JSON.stringify(st.j));
    st = await api('GET', '/api/cc/stock');
    record('stock بعد adjust: totalValue=200+250=450', st.status === 200 && st.j.totalValue === 450, `value=${st.j.totalValue}`);
    st = await api('POST', '/api/cc/stock/waste', { productId: stId, quantity: 2, reason: 'انتهاء صلاحية' });
    record('waste 2 → qty=3', st.status === 200 && st.j.quantity === 3, JSON.stringify(st.j));
    st = await api('GET', '/api/cc/stock');
    record('stock بعد waste: totalValue=450-100=350', st.status === 200 && st.j.totalValue === 350, `value=${st.j.totalValue}`);
    let mv = await api('GET', `/api/cc/movements?from=${TODAY}&to=${TODAY}&productId=${stId}`);
    record('movements للصنف: adjust + waste', mv.status === 200 && mv.j.total === 2 && mv.j.rows.some((x) => x.type === 'adjust') && mv.j.rows.some((x) => x.type === 'waste'), `total=${mv.j.total}`);
    st = await api('DELETE', `/api/cc/stock/${stId}`);
    record('DELETE stock برصيد غير صفري → 409', st.status === 409, `status=${st.status}`);
    st = await api('POST', `/api/cc/stock/${stId}/adjust`, { delta: -10 });
    record('adjust ينتج رصيد سالب → 400', st.status === 400, `status=${st.status}`);
    st = await api('PUT', `/api/cc/stock/${stId}`, { minStock: 4, unit: 'كجم' });
    record('PUT stock (minStock/unit) → 200', st.status === 200 && st.j.minStock === 4 && st.j.unit === 'كجم', '');

    // ===== الحضور والانصراف =====
    let rep = await api('GET', `/api/cc/reports/employees?from=${D}&to=${D}`);
    record('attendance قبل: 0 سجلات', rep.status === 200 && rep.j.attendance.length === 0, `len=${rep.j.attendance.length}`);
    let att = await api('POST', '/api/cc/attendance/check-in', { employeeId: 1, date: D, createdAt: `${D}T08:00:00` });
    record('check-in → 201', att.status === 201 && att.j.id > 0, JSON.stringify(att.j || {}).slice(0, 120));
    att = await api('POST', '/api/cc/attendance/check-in', { employeeId: 1, date: D, createdAt: `${D}T08:05:00` });
    record('check-in مكرر → 409', att.status === 409, `status=${att.status}`);
    rep = await api('GET', `/api/cc/reports/employees?from=${D}&to=${D}`);
    record('attendance بعد check-in: len=1', rep.j && rep.j.attendance.length === 1, `len=${rep.j && rep.j.attendance.length}`);
    att = await api('POST', '/api/cc/attendance/check-out', { employeeId: 1, date: D, createdAt: `${D}T18:00:00` });
    record('check-out → 200 + hoursWorked=10', att.status === 200 && att.j.checkOut && Math.abs(Number(att.j.hoursWorked) - 10) < 0.01, JSON.stringify(att.j || {}).slice(0, 140));
    att = await api('POST', '/api/cc/attendance/check-out', { employeeId: 1, date: D, createdAt: `${D}T18:01:00` });
    record('check-out مكرر → 409', att.status === 409, `status=${att.status}`);
    att = await api('POST', '/api/cc/attendance/check-out', { employeeId: 999, date: D });
    record('check-out لموظف غير موجود → 404', att.status === 404, `status=${att.status}`);

    // ===== الورديات اليومية (تفتح/تقفل + الأرقام) =====
    let sh = await api('GET', `/api/cc/cash/daily?from=${D}&to=${D}`);
    record('cash/daily قبل: 0 صفوف', sh.status === 200 && sh.j.rows.length === 0, `rows=${sh.j.rows.length}`);
    sh = await api('POST', '/api/cc/shifts/open', { date: D, openingBalance: 500 });
    record('open shift → 201', sh.status === 201 && sh.j.status === 'open' && sh.j.openingBalance === 500, JSON.stringify(sh.j || {}).slice(0, 140));
    sh = await api('POST', '/api/cc/shifts/open', { date: D, openingBalance: 700 });
    record('open shift مكرر → 409', sh.status === 409, `status=${sh.status}`);
    sh = await api('POST', '/api/cc/shifts/close', { date: D, actualCash: 530, notes: 'إغلاق يومي' });
    record('close shift → expected=500 diff=30', sh.status === 200 && sh.j.status === 'closed' && sh.j.expectedCash === 500 && sh.j.difference === 30 && sh.j.cashSales === 0, JSON.stringify(sh.j || {}).slice(0, 160));
    sh = await api('GET', `/api/cc/cash/daily?from=${D}&to=${D}`);
    record('cash/daily بعد: صف مغلق بالأرقام', sh.status === 200 && sh.j.rows.length === 1 && sh.j.rows[0].status === 'closed' && sh.j.rows[0].difference === 30, JSON.stringify(sh.j));
    sh = await api('POST', '/api/cc/shifts/close', { date: D, actualCash: 600 });
    record('close shift مكرر → 409', sh.status === 409, `status=${sh.status}`);

    // ===== meta: الكتابة مفعّلة + readonly محفوظ =====
    const meta = await api('GET', '/api/cc');
    record('meta: readonly=true + writes.enabled=true', meta.status === 200 && meta.j.readonly === true && meta.j.writes && meta.j.writes.enabled === true && Array.isArray(meta.j.writes.endpoints), JSON.stringify({ readonly: meta.j.readonly, writes: meta.j.writes && meta.j.writes.enabled }));

    const sweep = [JSON.stringify(cat.j), JSON.stringify(prod.j), JSON.stringify(ex.j), JSON.stringify(meta.j)];
    const leaked = sweep.filter((s) => /pbkdf2:|password|DEVICE_API_KEY|SERVER_KEY|lucca_openai/i.test(s || ''));
    record('لا تسريب أسرار في استجابات /api/cc', leaked.length === 0, leaked.join(' | ').slice(0, 120));

    console.log('\n====================');
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('خطأ في التنفيذ:', e);
    process.exitCode = 1;
  }
})().catch((e) => { console.error('خطأ:', e); process.exitCode = 1; });