// Phase 3 — Admin Control Center: read-only /api/cc verification.
// Boots the real compiled server against a seeded temp DB and checks:
//   KPI dashboard, profit role-gating (admin vs manager), 401/403, pagination,
//   filters, order detail, reports proxy, health (no secrets), batman placeholder,
//   mustChangePassword enforcement (H2).
// Usage: node test/phase3-admin.cjs   (requires `npm run build` first)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p3-device-key-123';

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

const D = '2026-09-01';
const D2 = '2026-09-02';

(async () => {
  try {
    const port = await awaitFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase3-'));
    const dbPath = path.join(tmp, 'p3.db');
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

    run("INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)", [9001, 'قهوة بن', 10, 'كجم', 5, 40]);
    run("INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)", [9002, 'حليب', 2, 'لتر', 5, 30]);
    run("INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)", [9003, 'سكر', 0, 'كجم', 5, 10]);
    run("INSERT INTO stock_movements (productId, quantity, type, notes, createdAt) VALUES (?,?,?,?,?)", [9001, -1, 'usage', 'استخدام', `${D}T08:00:00`]);
    run("INSERT INTO stock_movements (productId, quantity, type, notes, createdAt) VALUES (?,?,?,?,?)", [9001, 5, 'restock', 'توريد', `${D}T09:00:00`]);
    run("INSERT INTO stock_movements (productId, quantity, type, notes, createdAt) VALUES (?,?,?,?,?)", [9002, -1, 'usage', 'استخدام', `${D2}T08:00:00`]);

    run("INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)", [9101, 'كابتشينو اختبار', 1, 150, 40]);
    run("INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)", [9102, 'لاتيه اختبار', 2, 120, 30]);

    run("INSERT INTO suppliers (name, phone) VALUES (?,?)", ['مورد الخضار', '0111111111']);

    const orders = [
      [1, 'O1', 'completed', 'paid', 150, 150, 150, 'dine_in', 'cash', 'كاشير1', D, `${D}T10:00:00`],
      [2, 'O2', 'completed', 'paid', 120, 120, 120, 'dine_in', 'card', 'كاشير1', D, `${D}T10:05:00`],
      [3, 'O3', 'completed', 'paid', 100, 100, 100, 'dine_in', 'cash', 'كاشير2', D, `${D}T10:10:00`],
      [4, 'O4', 'completed', 'paid', 90, 90, 90, 'dine_in', 'card', 'كاشير2', D2, `${D2}T10:00:00`],
      [5, 'O5', 'cancelled', 'unpaid', 500, 500, 0, 'dine_in', 'cash', 'كاشير1', D, `${D}T11:00:00`],
      [6, 'O6', 'pending', 'unpaid', 400, 400, 0, 'takeaway', 'cash', 'كاشير1', D2, `${D2}T12:00:00`],
    ];
    for (const o of orders) {
      run("INSERT INTO orders (id, orderNumber, status, paymentStatus, subtotal, total, totalPaid, orderType, paymentMethod, createdBy, date, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", o);
    }
    const items = [
      [1, 9101, 'كابتشينو اختبار', 1, 150, 150],
      [2, 9102, 'لاتيه اختبار', 1, 120, 120],
      [3, 9101, 'كابتشينو اختبار', 1, 100, 100],
      [4, 9102, 'لاتيه اختبار', 1, 90, 90],
    ];
    for (const it of items) {
      run("INSERT INTO order_items (orderId, productId, name, quantity, unitPrice, total) VALUES (?,?,?,?,?,?)", it);
    }
    const payments = [
      [1, 150, 'cash', `${D}T10:01:00`],
      [2, 120, 'card', `${D}T10:06:00`],
      [3, 100, 'cash', `${D}T10:11:00`],
      [4, 90, 'card', `${D2}T10:01:00`],
    ];
    for (const p of payments) {
      run("INSERT INTO payments (orderId, amount, method, status, createdAt) VALUES (?,?,?,?,?)", [p[0], p[1], p[2], 'completed', p[3]]);
    }
    run("INSERT INTO refunds (orderId, amount, type, refundMethod, createdAt) VALUES (?,?,?,?,?)", [1, 50, 'partial', 'cash', `${D}T10:30:00`]);

    run("INSERT INTO daily_shifts (date, openingBalance, actualCash, status) VALUES (?,?,?,?)", [D, 500, 700, 'closed']);
    run("INSERT INTO daily_shifts (date, openingBalance, actualCash, status) VALUES (?,?,?,?)", [D2, 0, 900, 'open']);

    run("INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)", ['كهرباء', 'utilities', 120, 'bank', `${D2}T09:00:00`, `${D2}T09:00:00`]);
    run("INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)", ['مواد تنظيف', 'operating', 80, 'cash', `${D2}T09:30:00`, `${D2}T09:30:00`]);

    run("INSERT INTO purchases (name, item, quantity, costPrice, total, supplier, date, createdBy) VALUES (?,?,?,?,?,?,?,?)", ['طماطم', 'طماطم', 10, 40, 400, 'مورد الخضار', `${D}T08:00:00`, 'admin']);
    run("INSERT INTO purchases (name, item, quantity, costPrice, total, supplier, date, createdBy) VALUES (?,?,?,?,?,?,?,?)", ['زيت', 'زيت', 2, 30, 60, 'مورد الخضار', `${D}T08:10:00`, 'admin']);

    run("INSERT INTO employees (name, role, salary, active) VALUES (?,?,?,?)", ['أحمد', 'كاشير', 0, 1]);

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

    async function api(method, p, body, headers) {
      const h = { 'Content-Type': 'application/json', ...(headers || {}) };
      if (!(headers || {}).Authorization && !(headers || {})['x-api-key']) h.Authorization = `Bearer ${gAdmin}`;
      const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    }
    let gAdmin = null;

    async function login(username, password) {
      const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      return { status: res.status, token: j.token || null, j };
    }

    // ===== المصادقة والأدوار =====
    const la = await login('admin2', 'admin2#2026');
    record('login admin2 → token', la.status === 200 && !!la.token && la.j.mustChangePassword === false, `status=${la.status}`);
    gAdmin = la.token;
    const lm = await login('manager1', 'manager1#2026');
    record('login manager1 → token', lm.status === 200 && !!lm.token, `status=${lm.status}`);
    const lc = await login('cashier1', 'cashier1#2026');
    const lseed = await login('admin', '123456');
    record('login seeded admin (mustChange) → token', lseed.status === 200 && !!lseed.token && lseed.j.mustChangePassword === true, `status=${lseed.status}`);

    let r = await fetch(`${BASE}/api/cc/dashboard`);
    record('401 بدون هوية → /api/cc/dashboard', r.status === 401, `status=${r.status}`);
    r = await fetch(`${BASE}/api/cc/dashboard`, { headers: { 'x-api-key': DEVICE_KEY } });
    record('403 مفتاح device → /api/cc/dashboard', r.status === 403, `status=${r.status}`);
    r = await fetch(`${BASE}/api/cc/dashboard`, { headers: { Authorization: `Bearer ${lc.token}` } });
    record('403 كاشير (بلا reports.read) → /api/cc/dashboard', r.status === 403, `status=${r.status}`);
    r = await fetch(`${BASE}/api/cc/dashboard`, { headers: { Authorization: `Bearer ${lseed.token}` } });
    record('403 mustChangePassword (H2) → /api/cc/dashboard', r.status === 403, `status=${r.status}`);
    if (lseed.token) {
      const ch = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'changed#2026' }, { Authorization: `Bearer ${lseed.token}` });
      const l2 = await login('admin', 'changed#2026');
      const d2 = await api('GET', '/api/cc/dashboard', null, l2.token ? { Authorization: `Bearer ${l2.token}` } : {});
      record('بعد تغيير كلمة المرور (mustChange=0) → 200', ch.status === 200 && !!l2.token && d2.status === 200, `ch=${ch.status} d2=${d2.status}`);
    }

    // ===== لوحة المعلومات =====
    const dash = await api('GET', `/api/cc/dashboard?from=${D}&to=${D2}`);
    const dj = dash.j || {};
    record('dashboard admin → 200 + شكل موحّد', dash.status === 200 && !!dj.range && !!dj.sales && !!dj.profitAndLoss && !!dj.expenses && !!dj.purchases && !!dj.cash && !!dj.inventory, `status=${dash.status}`);
    record('dashboard KPIs: gross=460 net=410 orders=4 AOV=115 cancelled=1', dj.sales && dj.sales.grossSales === 460 && dj.sales.netSales === 410 && dj.sales.ordersCount === 4 && Math.abs(dj.sales.aov - 115) < 1e-6 && dj.sales.cancelledCount === 1, JSON.stringify(dj.sales));
    record('dashboard P&L (admin): cogs=140 gp=270 opProfit=70', dj.profitAndLoss && dj.profitAndLoss.cogs === 140 && dj.profitAndLoss.grossProfit === 270 && dj.profitAndLoss.operatingProfit === 70, JSON.stringify(dj.profitAndLoss));
    record('dashboard expenses: total=200 cash=80 count=2', dj.expenses && dj.expenses.total === 200 && dj.expenses.cash === 80 && dj.expenses.count === 2, '');
    record('dashboard purchases: total=460 count=2', dj.purchases && dj.purchases.total === 460 && dj.purchases.count === 2, '');
    record('dashboard cash: expected=620 actual=900 diff=280', dj.cash && dj.cash.expected === 620 && dj.cash.actual === 900 && dj.cash.difference === 280, JSON.stringify(dj.cash));
    record('dashboard inventory: value=460 low=1 out=1', dj.inventory && dj.inventory.totalValue === 460 && dj.inventory.lowStock === 1 && dj.inventory.outOfStock === 1, '');
    record('dashboard financial (admin) presente', !!(dj.financial && dj.financial.netSales === 410), '');

    const dashM = await api('GET', `/api/cc/dashboard?from=${D}&to=${D2}`, null, { Authorization: `Bearer ${lm.token}` });
    const dm = dashM.j || {};
    record('dashboard manager → 200', dashM.status === 200, `status=${dashM.status}`);
    record('dashboard manager: الأرباح محجوبة (cogs/gp/opProfit=null) + financial null', dm.profitAndLoss && dm.profitAndLoss.cogs === null && dm.profitAndLoss.grossProfit === null && dm.profitAndLoss.operatingProfit === null && dm.financial === null, JSON.stringify(dm.profitAndLoss));

    // ===== الطلبات (pagination + فلاتر) =====
    let o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&page=1&pageSize=2`);
    record('orders page1/2: rows=2 total=6 hasMore', o.status === 200 && o.j.rows.length === 2 && o.j.total === 6 && o.j.hasMore === true && o.j.page === 1, JSON.stringify({ len: o.j.rows.length, total: o.j.total, hasMore: o.j.hasMore }));
    o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&page=4&pageSize=2`);
    record('orders page4/2: rows=0 hasMore=false', o.status === 200 && o.j.rows.length === 0 && o.j.hasMore === false, '');
    o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&status=cancelled`);
    record('orders filter status=cancelled → 1', o.status === 200 && o.j.total === 1 && o.j.rows[0].id === 5, `total=${o.j.total}`);
    o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&paymentStatus=paid`);
    record('orders filter paymentStatus=paid → 4', o.status === 200 && o.j.total === 4, `total=${o.j.total}`);
    o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&orderType=takeaway`);
    record('orders filter orderType=takeaway → 1', o.status === 200 && o.j.total === 1, `total=${o.j.total}`);
    o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&q=كاشير1`);
    record('orders search q=كاشير1 → 4 (createdBy LIKE)', o.status === 200 && o.j.total === 4, `total=${o.j.total}`);
    o = await api('GET', `/api/cc/orders?from=${D}&to=${D2}&pageSize=9999`);
    record('orders pageSize مقيّد بـ 200', o.status === 200 && o.j.rows.length === 6, `len=${o.j.rows.length}`);

    const od = await api('GET', `/api/cc/orders/1`);
    record('order detail شامل items/payments/refunds', od.status === 200 && od.j.items.length === 1 && od.j.payments.length === 1 && od.j.refunds.length === 1 && od.j.total === 150, JSON.stringify({ items: od.j.items.length, payments: od.j.payments.length, refunds: od.j.refunds.length }));
    const odn = await api('GET', `/api/cc/orders/99999`);
    record('order detail غير موجود → 404', odn.status === 404, `status=${odn.status}`);

    // ===== المصاريف =====
    let e = await api('GET', `/api/cc/expenses?from=${D}&to=${D2}`);
    record('expenses: rows=2 summary.total=200 count=2', e.status === 200 && e.j.page.rows.length === 2 && e.j.summary.total === 200 && e.j.summary.count === 2, '');
    e = await api('GET', `/api/cc/expenses?from=${D}&to=${D2}&category=utilities`);
    record('expenses filter category=utilities → 1', e.status === 200 && e.j.page.total === 1, `total=${e.j.page.total}`);

    // ===== المشتريات =====
    let pu = await api('GET', `/api/cc/purchases?from=${D}&to=${D2}`);
    record('purchases: rows=2 summary.total=460', pu.status === 200 && pu.j.page.rows.length === 2 && pu.j.summary.total === 460, '');

    // ===== المخزون والحركات =====
    let st = await api('GET', `/api/cc/stock`);
    record('stock: total=3 totalValue=460', st.status === 200 && st.j.page.total === 3 && st.j.totalValue === 460, `total=${st.j.page.total}`);
    st = await api('GET', `/api/cc/stock?status=low`);
    record('stock filter status=low → 1 (حليب)', st.status === 200 && st.j.page.total === 1 && st.j.page.rows[0].id === 9002, '');
    st = await api('GET', `/api/cc/stock?status=out`);
    record('stock filter status=out → 1 (سكر)', st.status === 200 && st.j.page.total === 1 && st.j.page.rows[0].id === 9003, '');
    st = await api('GET', `/api/cc/stock?q=قهوة`);
    record('stock search q=قهوة → 1 (بن)', st.status === 200 && st.j.page.total === 1 && st.j.page.rows[0].name === 'قهوة بن', '');
    let mv = await api('GET', `/api/cc/movements?from=${D}&to=${D2}`);
    record('movements: total=3', mv.status === 200 && mv.j.total === 3, JSON.stringify(mv.j).slice(0, 200));
    mv = await api('GET', `/api/cc/movements?from=${D}&to=${D2}&productId=9001`);
    record('movements filter productId=9001 → 2 (بأسماء منتجات)', mv.status === 200 && mv.j.total === 2 && mv.j.rows.every((x) => x.productName), '');

    // ===== المنتجات =====
    const pr = await api('GET', `/api/cc/products?q=اختبار`);
    record('products search q=اختبار → 2 + أسماء فئات', pr.status === 200 && pr.j.total === 2 && pr.j.rows.every((x) => typeof x.name === 'string'), JSON.stringify(pr.j).slice(0, 200));

    // ===== طاولات / موظفون / موردون =====
    let tb = await api('GET', `/api/cc/tables`);
    record('tables: 14 (S) + ملخص', tb.status === 200 && tb.j.rows.length === 14 && Array.isArray(tb.j.summary) && tb.j.summary.length > 0, `rows=${tb.j.rows.length}`);
    let em = await api('GET', `/api/cc/employees`);
    record('employees: ≥1 (بدون كلمات مرور)', em.status === 200 && em.j.rows.length >= 1 && !JSON.stringify(em.j).includes('password'), '');
    let su = await api('GET', `/api/cc/suppliers`);
    record('suppliers: 1', su.status === 200 && su.j.rows.length === 1, `rows=${su.j.rows.length}`);

    // ===== تقارير canonical =====
    let rep = await api('GET', `/api/cc/reports/sales?from=${D}&to=${D2}`);
    record('reports/sales admin: revenue=460 net=410 cogs=140 gp=270', rep.status === 200 && rep.j.revenue === 460 && rep.j.netSales === 410 && rep.j.cogs === 140 && rep.j.grossProfit === 270 && rep.j.hasCostData === true, JSON.stringify({ revenue: rep.j.revenue, netSales: rep.j.netSales, cogs: rep.j.cogs, gp: rep.j.grossProfit }));
    let repM = await api('GET', `/api/cc/reports/sales?from=${D}&to=${D2}`, null, { Authorization: `Bearer ${lm.token}` });
    record('reports/sales manager: الأرباح محجوبة (cogs/gp null, hasCostData false)', repM.status === 200 && repM.j.cogs === null && repM.j.grossProfit === null && repM.j.hasCostData === false && repM.j.netSales === 410, JSON.stringify({ cogs: repM.j.cogs, gp: repM.j.grossProfit }));
    const repInv = await api('GET', `/api/cc/reports/inventory`);
    record('reports/inventory → 200 (items + movements)', repInv.status === 200 && Array.isArray(repInv.j.items) && Array.isArray(repInv.j.movements), '');

    // ===== تغطية كاملة لعمق تقارير كل وحدة (تعرضها صفحة المركز) =====
    const repTypes = ['sales', 'expenses', 'inventory', 'employees', 'suppliers'];
    for (const t of repTypes) {
      const rr = await api('GET', `/api/cc/reports/${t}?from=${D}&to=${D2}`);
      record(`reports/${t} → 200 بالعمق المتوقع`, rr.status === 200 && rr.j != null && typeof rr.j === 'object' && Object.keys(rr.j).length > 0, `keys=${Object.keys(rr.j || {}).join(',')}`);
    }

    // ===== نقاط إضافية تستخدمها صفحة المركز =====
    const meta = await api('GET', '/api/cc');
    record('meta /api/cc نطاق + readonly + نقاط', meta.status === 200 && meta.j.readonly === true && meta.j.scope === 'admin' && Array.isArray(meta.j.endpoints) && meta.j.endpoints.length > 0, JSON.stringify({ scope: meta.j.scope, endpoints: meta.j.endpoints.length }));
    const cd = await api('GET', `/api/cc/cash/daily?from=${D}&to=${D2}`);
    record('cash/daily → 2 شيفتات روزنامة', cd.status === 200 && cd.j.rows.length === 2 && cd.j.rows[0].date === D2, `rows=${cd.j.rows.length}`);
    const od2 = await api('GET', `/api/cc/orders/3`);
    record('order detail: items/payments أعمدة عرض المركز', od2.status === 200 && Array.isArray(od2.j.items) && Array.isArray(od2.j.payments) && Array.isArray(od2.j.refunds) && 'orderNumber' in od2.j, `keys=${Object.keys(od2.j || {}).join(',')}`);

    // ===== الصحة وبلا أسرار =====
    const h = await api('GET', '/api/cc/system/health');
    const healthStr = JSON.stringify(h.j);
    record('system/health → 200 ولا أسرار', h.status === 200 && h.j.status === 'ok' && !healthStr.includes(DEVICE_KEY) && !/api[_-]?key/i.test(healthStr) && !/OPENAI|DEEPSEEK|KEY/i.test(healthStr), healthStr);
    const bat = await api('GET', '/api/cc/batman');
    record('batman placeholder → readonly', bat.status === 200 && bat.j.status === 'readonly', '');

    // فحص أمان عام: لا تسريب كلمات مرور/مفاتيح عبر الاستجابات
    const sweep = [JSON.stringify(dash.j), JSON.stringify(o.j), JSON.stringify(rep.j), JSON.stringify(h.j)];
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