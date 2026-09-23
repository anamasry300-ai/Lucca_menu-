// Phase 6 — ACCOUNTING & REPORTING CONVERGENCE (Phase 4 of the roadmap).
// الغرض: جميع التقارير/الحسابات مأخوذة من نموذج مالي واحد قياسي (canonical) عبر HTTP.
// الفيكسشرات محسوبة مسبقاً بشكل مستقل (متطلّب العقد: "احسب الأرقام المتوقعة يدوياً").
//
//  المراجع القياسية (من docs/CANONICAL_REPORTING_CONTRACT.md):
//   NetSales      = Σ orders.total(paid) − Σ refunds.amount
//   Discounts     = Σ orders.discountAmount        (الحقل discount نسبة مئوية — لا يجمّع)
//   GrossSales    = Σ orders.subtotal(paid)
//   AOV           = Σ total ÷ COUNT(paid)          (قبل الاسترداد)
//   COGS          = Σ(quantity × unitCost)  unitCost = recipe→inventory.costPrice→products.cost→null
//   تعقيب النقد   = openingBalance + cash payments − cash refunds − cash expenses
//   أرباح العمليات = NetSales − COGS − Σ expenses   (المشتريات لا تنزل من الربح)
//
// الأيام (ثابتة — مستقلة عن "اليوم"):
//   A = 2026-04-15  خصم+مرتجعات: subtotal 950 / discountAmount 15 / total 935 / refund 120 → netSales 815
//   B = 2026-04-16  النقد: فتح 1000 + كاش 2500 (1500+1000) − استرداد كاش 200 − مصروف كاش 300 → 3000
//   C = 2026-04-17  COGS مكتمل: P1×2(recipe 40) + P2×3(product 30) → 170
//   D = 2026-04-18  COGS ناقص: P1×1(40) + P3(null) → null
//   E = 2026-04-19  COGS معدوم: P3×1 → null (unavailable)
//   F = 2026-04-20  COGS بوصفة ناقصة → fallback products.cost: P4×4 → 28
//   G = 2026-04-21  متعدد العناصر: P1 + P2×2 + P4 → 107 ; استرداد كارت 50 عند نهاية اليوم 23:59:59
//   H = 2026-04-30  حدّ الشهر: O801 في آخر يوم
//   (2026-04-01 بلا بيانات → فترة فارغة)
//
// Usage: node test/phase6-accounting-convergence.cjs   (يتطلب `npm run build` أولاً)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p6-device-key-123';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
function near(a, b, tol = 1e-6) { return Math.abs(a - b) < tol; }

const A = '2026-04-15';
const B = '2026-04-16';
const C = '2026-04-17';
const D = '2026-04-18';
const E = '2026-04-19';
const F = '2026-04-20';
const G = '2026-04-21';
const H = '2026-04-30';
const EMPTY = '2026-04-01';

function awaitFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    const port = await awaitFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase6-'));
    const dbPath = path.join(tmp, 'p6.db');
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

    // ===== مخزون أساسي للوصفات =====
    run('INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)', [9101, 'قهوة بن', 10, 'كجم', 5, 20]);
    run('INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)', [9102, 'حليب كامل', 10, 'لتر', 5, 10]);
    run('INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)', [9103, 'سكر ناعم', 10, 'كجم', 2, 5]);

    // ===== المنتجات (cases الأربعة للتكلفة) =====
    run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9201, 'P1_وصفة', 1, 150, 50]);
    run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9202, 'P2_منتج', 1, 80, 30]);
    run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9203, 'P3_بلا_تكلفة', 1, 60, 0]);
    run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9204, 'P4_وصفة_ناقصة', 1, 90, 7]);
    // P1 recipe كاملة → 1×20 + 2×10 = 40 (تتجاوز products.cost=50)
    run('INSERT INTO product_recipes (productId, ingredient, quantity, unit) VALUES (?,?,?,?)', [9201, 'قهوة بن', 1, 'كجم']);
    run('INSERT INTO product_recipes (productId, ingredient, quantity, unit) VALUES (?,?,?,?)', [9201, 'حليب كامل', 2, 'لتر']);
    // P4 recipe ناقصة (المكوّن غير موجود بالمخزون) → fallback products.cost=7
    run('INSERT INTO product_recipes (productId, ingredient, quantity, unit) VALUES (?,?,?,?)', [9204, 'مكوّن غائب غير موجود بالمخزون', 1, 'كجم']);

    // ===== الطلبات =====
    const order = (id, num, day, subtotal, discountAmount, total, method, items) => {
      run('INSERT INTO orders (id, orderNumber, status, paymentStatus, subtotal, discount, discountAmount, total, totalPaid, orderType, paymentMethod, createdBy, date, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, num, 'completed', 'paid', subtotal, discountAmount, discountAmount, total, total, 'dine_in', method, 'كاشير6', `${day}T10:00:00`, `${day}T10:00:00`]);
      for (const it of items) {
        run('INSERT INTO order_items (orderId, productId, name, quantity, unitPrice, total) VALUES (?,?,?,?,?,?)', [id, it[0], it[1], it[2], it[3], it[3] * it[2]]);
      }
    };
    const pay = (orderId, amount, method, day, time = 'T10:05:00') =>
      run('INSERT INTO payments (orderId, amount, method, status, createdAt) VALUES (?,?,?,?,?)', [orderId, amount, method, 'completed', `${day}${time}`]);
    const refund = (orderId, amount, method, day, time) =>
      run('INSERT INTO refunds (orderId, amount, type, refundMethod, createdAt) VALUES (?,?,?,?,?)', [orderId, amount, 'partial', method, `${day}${time}`]);

    // A — 815 (خصم × مرتجعات)
    order(1001, 'P6-A', A, 950, 15, 935, 'cash', [[9201, 'P1_وصفة', 1, 935]]);
    pay(1001, 935, 'cash', A);
    refund(1001, 120, 'cash', A, 'T10:30:00');

    // B — النقد 3000
    order(2001, 'P6-B1', B, 1500, 0, 1500, 'cash', [[9201, 'P1_وصفة', 1, 1500]]);
    pay(2001, 1500, 'cash', B);
    order(2002, 'P6-B2', B, 1300, 0, 1300, 'cash', [[9202, 'P2_منتج', 1, 1300]]);
    pay(2002, 1000, 'cash', B);
    pay(2002, 300, 'card', B);
    refund(2002, 200, 'cash', B, 'T11:00:00');

    // C — COGS مكتمل 170
    order(3001, 'P6-C1', C, 300, 0, 300, 'cash', [[9201, 'P1_وصفة', 2, 150]]);
    pay(3001, 300, 'cash', C);
    order(3002, 'P6-C2', C, 240, 0, 240, 'card', [[9202, 'P2_منتج', 3, 80]]);
    pay(3002, 240, 'card', C);

    // D — COGS ناقص (40 + null)
    order(4001, 'P6-D', D, 210, 0, 210, 'cash', [[9201, 'P1_وصفة', 1, 150], [9203, 'P3_بلا_تكلفة', 1, 60]]);
    pay(4001, 210, 'cash', D);

    // E — COGS معدوم
    order(5001, 'P6-E', E, 60, 0, 60, 'cash', [[9203, 'P3_بلا_تكلفة', 1, 60]]);
    pay(5001, 60, 'cash', E);

    // F — COGS بواسطة fallback (وصفة ناقصة) 4×7=28
    order(6001, 'P6-F', F, 360, 0, 360, 'cash', [[9204, 'P4_وصفة_ناقصة', 4, 90]]);
    pay(6001, 360, 'cash', F);

    // G — متعدد العناصر: 40 + 2×30 + 7 = 107 ; استرداد كارت 50 نهاية اليوم 23:59:59
    order(7001, 'P6-G', G, 400, 0, 400, 'cash', [[9201, 'P1_وصفة', 1, 150], [9202, 'P2_منتج', 2, 80], [9204, 'P4_وصفة_ناقصة', 1, 90]]);
    pay(7001, 400, 'cash', G);
    refund(7001, 50, 'card', G, 'T23:59:59');

    // H — حدّ الشهر: أول وآخر يوم في النطاق
    order(8001, 'P6-H', H, 150, 0, 150, 'cash', [[9201, 'P1_وصفة', 1, 150]]);
    pay(8001, 150, 'cash', H);

    // ===== الورديات والمصروفات =====
    run('INSERT INTO daily_shifts (date, openingBalance, actualCash, status) VALUES (?,?,?,?)', [A, 1000, 1470, 'closed']);
    run('INSERT INTO daily_shifts (date, openingBalance, actualCash, status) VALUES (?,?,?,?)', [B, 1000, 3050, 'closed']);
    run('INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)', ['كاش مصروف', 'operating', 300, 'cash', `${A}T09:00:00`, `${A}T09:00:00`]);
    run('INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)', ['كاش مصروف B', 'operating', 300, 'cash', `${B}T09:00:00`, `${B}T09:00:00`]);
    run('INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)', ['كارت مصروف (لا يدخل بالنقد)', 'utilities', 1000, 'card', `${A}T09:10:00`, `${A}T09:10:00`]);

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
    const login = async (username, password) => {
      const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      return { status: res.status, token: j.token || null, j };
    };
    async function api(method, p, body, headers) {
      const h = { 'Content-Type': 'application/json', ...(headers || {}) };
      if (!(headers || {}).Authorization) h.Authorization = `Bearer ${gAdmin}`;
      const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    }
    const as = (token) => ({ Authorization: `Bearer ${token}` });

    const la = await login('admin2', 'admin2#2026');
    gAdmin = la.token;
    const lm = await login('manager1', 'manager1#2026');
    const lc = await login('cashier1', 'cashier1#2026');
    record('إعداد الأدوار (admin/manager/cashier)', !!(gAdmin && lm.token && lc.token), `tokens=${!!gAdmin}/${!!lm.token}/${!!lc.token}`);

    // ============================================================
    // 1) تقارب NetSales — التوافق عبر كل نقاط التقارير على A = 815
    // ============================================================
    const dashA = await api('GET', `/api/cc/dashboard?from=${A}&to=${A}`);
    record('cc/dashboard A: sales.gross=950 discounts=15 refunds=120 net=815 orders=1',
      dashA.status === 200 && dashA.j.sales.grossSales === 950 && dashA.j.sales.discounts === 15 &&
      dashA.j.sales.refunds === 120 && dashA.j.sales.netSales === 815 && dashA.j.sales.ordersCount === 1 && dashA.j.sales.cancelledCount === 0,
      JSON.stringify(dashA.j && dashA.j.sales));

    const ccRepA = await api('GET', `/api/cc/reports/sales?from=${A}&to=${A}`);
    record('cc/reports/sales A: revenue=935 net=815 discounts=15 refunds=120',
      ccRepA.status === 200 && ccRepA.j.revenue === 935 && ccRepA.j.netSales === 815 && ccRepA.j.discounts === 15 && ccRepA.j.refunds === 120,
      JSON.stringify({ rev: ccRepA.j && ccRepA.j.revenue, net: ccRepA.j && ccRepA.j.netSales }));

    const repA = await api('GET', `/api/reports/sales?from=${A}&to=${A}`);
    record('reports/sales A (legacy endpoint متقارب): net=815 — لا انحراف 800',
      repA.status === 200 && repA.j.netSales === 815 && repA.j.netSales !== 800,
      `net=${repA.j && repA.j.netSales}`);

    const kpiA = await api('GET', `/api/dashboard/kpis?from=${A}&to=${A}`);
    record('dashboard/kpis A: sales=815 orders=1 avgOrder=935 refunds=120 discounts=15 cancelled=0',
      kpiA.status === 200 && kpiA.j.sales.value === 815 && kpiA.j.orders.value === 1 &&
      kpiA.j.avgOrder.value === 935 && kpiA.j.refunds.value === 120 && kpiA.j.discounts.value === 15 && kpiA.j.cancelled.value === 0,
      JSON.stringify(kpiA.j && { sales: kpiA.j.sales, orders: kpiA.j.orders, avgOrder: kpiA.j.avgOrder }));

    // ============================================================
    // 2) COGS — الحالات الأربع للتكلفة + كلفة متعددة
    // ============================================================
    const dashC = await api('GET', `/api/cc/dashboard?from=${C}&to=${C}`);
    record('COGS مكتمل (C): recipe(2×40)+product(3×30)=170, gp=540−170=370',
      dashC.status === 200 && dashC.j.profitAndLoss.cogs === 170 && dashC.j.profitAndLoss.grossProfit === 370 && dashC.j.financial.cogs === 170,
      JSON.stringify(dashC.j && dashC.j.profitAndLoss));

    const dashD = await api('GET', `/api/cc/dashboard?from=${D}&to=${D}`);
    record('COGS ناقص (D): cogs=null (جزئي) + gp null',
      dashD.status === 200 && dashD.j.profitAndLoss.cogs === null && dashD.j.profitAndLoss.grossProfit === null && dashD.j.financial.cogs === null,
      JSON.stringify(dashD.j && dashD.j.profitAndLoss));

    const dashE = await api('GET', `/api/cc/dashboard?from=${E}&to=${E}`);
    record('COGS معدوم (E): cogs=null (unavailable)',
      dashE.status === 200 && dashE.j.profitAndLoss.cogs === null && dashE.j.financial.completeness.cogs === 'unavailable',
      JSON.stringify({ cogs: dashE.j && dashE.j.profitAndLoss.cogs, comp: dashE.j && dashE.j.financial.completeness.cogs }));

    const dashF = await api('GET', `/api/cc/dashboard?from=${F}&to=${F}`);
    record('COGS وصفة ناقصة (F): fallback products.cost 4×7=28',
      dashF.status === 200 && dashF.j.profitAndLoss.cogs === 28 && dashF.j.profitAndLoss.grossProfit === 332,
      JSON.stringify(dashF.j && dashF.j.profitAndLoss));

    const dashGW = await api('GET', `/api/cc/dashboard?from=${G}&to=${G}`);
    record('COGS متعدد العناصر (G): 40+2×30+7=107, net=400−50=350, gp=243',
      dashGW.status === 200 && dashGW.j.profitAndLoss.cogs === 107 && dashGW.j.profitAndLoss.grossProfit === 243,
      JSON.stringify(dashGW.j && dashGW.j.profitAndLoss));

    const tpA = await api('GET', `/api/dashboard/top-products?from=${A}&to=${A}`);
    record('top-products A: cost من الوصفة (40) لا من products.cost (50), profit=935−40=895',
      tpA.status === 200 && tpA.j[0] && tpA.j[0].cost === 40 && tpA.j[0].costPrice === 50 && tpA.j[0].profit === 895,
      JSON.stringify(tpA.j && tpA.j[0] && { cost: tpA.j[0].cost, costPrice: tpA.j[0].costPrice, profit: tpA.j[0].profit }));

    // ============================================================
    // 3) تعقيب النقد — B: 1000 + 2500 − 200 − 300 = 3000
    // ============================================================
    const dashB = await api('GET', `/api/cc/dashboard?from=${B}&to=${B}`);
    record('النقد (B): expected = 1000+2500−200−300 = 3000, actual=3050, diff=50',
      dashB.status === 200 && dashB.j.cash.expected === 3000 && dashB.j.cash.actual === 3050 && dashB.j.cash.difference === 50,
      JSON.stringify(dashB.j && dashB.j.cash));

    const dashA2 = await api('GET', `/api/cc/dashboard?from=${A}&to=${A}`);
    record('النقد (A): 1000+935−120−300 = 1515 (مصروف كارت لا يدخل)',
      dashA2.status === 200 && dashA2.j.cash.expected === 1515,
      JSON.stringify(dashA2.j && dashA2.j.cash));

    // ============================================================
    // 4) تعدّد النطاقات الزمنية + حدود الشهر + منتصف الليل + فترة فارغة
    // ============================================================
    const month = await api('GET', `/api/cc/dashboard?from=2026-04-01&to=${H}`);
    record(`شهر 2026-04: net=5085 orders=10 aov=545.5 cogs=null(يوم ناقص)`,
      month.status === 200 && month.j.sales.netSales === 5085 && month.j.sales.ordersCount === 10 &&
      near(month.j.sales.aov, 545.5) && month.j.financial.cogs === null,
      JSON.stringify({ net: month.j.sales.netSales, orders: month.j.sales.ordersCount, aov: month.j.sales.aov }));

    const monthReport = await api('GET', `/api/cc/reports/sales?from=2026-04-01&to=${H}`);
    record('reports/sales شهر: net=5085 + orders=10 (متطابق مع dashboard)',
      monthReport.status === 200 && monthReport.j.netSales === 5085 && monthReport.j.orders === 10,
      JSON.stringify({ net: monthReport.j && monthReport.j.netSales, orders: monthReport.j && monthReport.j.orders }));

    const week = await api('GET', `/api/cc/reports/sales?from=${A}&to=${C}`);
    record('نطاق متعدد الأيام A→C: net = 815+2600+540 = 3955 (5 طلبات)',
      week.status === 200 && week.j.netSales === 3955 && week.j.orders === 5,
      JSON.stringify({ net: week.j && week.j.netSales, orders: week.j && week.j.orders }));

    const gEnd = await api('GET', `/api/cc/reports/sales?from=${G}&to=${G}`);
    record('منتصف الليل G: استرداد 23:59:59 داخل النطاق → net=350 (400−50)',
      gEnd.status === 200 && gEnd.j.refunds === 50 && gEnd.j.netSales === 350,
      JSON.stringify({ ref: gEnd.j && gEnd.j.refunds, net: gEnd.j && gEnd.j.netSales }));

    const upToF = await api('GET', `/api/cc/reports/sales?from=${G}&to=${F}`);
    record('استرداد G مستبعد عند to=F (نهاية F): refunds=0',
      upToF.status === 200 && upToF.j.refunds === 0,
      JSON.stringify({ ref: upToF.j && upToF.j.refunds }));

    const beforeH = await api('GET', `/api/cc/reports/sales?from=${H}&to=2026-04-29`);
    record('حدّ الشهر: O801 خارج النطاق قبل H (orders=0, net=0)',
      beforeH.status === 200 && beforeH.j.orders === 0 && beforeH.j.netSales === 0,
      JSON.stringify({ orders: beforeH.j && beforeH.j.orders, net: beforeH.j && beforeH.j.netSales }));

    const onH = await api('GET', `/api/cc/reports/sales?from=${H}&to=${H}`);
    record('حدّ الشهر: O801 داخل النطاق عند H (orders=1, net=150)',
      onH.status === 200 && onH.j.orders === 1 && onH.j.netSales === 150,
      JSON.stringify({ orders: onH.j && onH.j.orders, net: onH.j && onH.j.netSales }));

    const empty = await api('GET', `/api/cc/dashboard?from=${EMPTY}&to=${EMPTY}`);
    record('فترة فارغة: orders=0, net=0, aov=null, cogs=0 (complete) و hasCostData=true',
      empty.status === 200 && empty.j.sales.ordersCount === 0 && empty.j.sales.netSales === 0 &&
      empty.j.sales.aov === null && empty.j.profitAndLoss.cogs === 0 && empty.j.profitAndLoss.completeness.netSales === 'complete',
      JSON.stringify({ o: empty.j.sales.ordersCount, n: empty.j.sales.netSales, c: empty.j.profitAndLoss.cogs }));

    const emptyKpi = await api('GET', `/api/dashboard/kpis?from=${EMPTY}&to=${EMPTY}`);
    record('kpis فترة فارغة: sales=0, grossProfit={0,null}, hasCostData=true (متقارب)',
      emptyKpi.status === 200 && emptyKpi.j.sales.value === 0 && emptyKpi.j.orders.value === 0 &&
      emptyKpi.j.hasCostData === true && emptyKpi.j.grossProfit && emptyKpi.j.grossProfit.value === 0,
      JSON.stringify({ s: emptyKpi.j.sales.value, hasCost: emptyKpi.j.hasCostData, gp: emptyKpi.j.grossProfit }));

    // ============================================================
    // 5) الاكتمال (completeness) في التقرير المالي — عقد §15
    // ============================================================
    const finA = await api('GET', `/api/cc/dashboard?from=${A}&to=${A}`);
    const comp = finA.j && finA.j.financial && finA.j.financial.completeness;
    record('financial.completeness: netSales/discounts/refunds/orders/aov/cancelled/cogs/gp/expenses/opProfit/cash/dates',
      !!comp && comp.netSales === 'complete' && comp.discounts === 'complete' && comp.refunds === 'complete' &&
      comp.aov === 'complete' && comp.cogs === 'complete' && comp.grossProfit === 'complete' &&
      comp.expenses === 'complete' && comp.cash === 'complete' && comp.dates === 'complete',
      JSON.stringify(comp));

    // ============================================================
    // 6) RBAC: الأرباح محجوبة للمدير + 403 لكاشير/مفتاح device
    // ============================================================
    const mgrA = await api('GET', `/api/cc/dashboard?from=${A}&to=${A}`, null, as(lm.token));
    record('manager A: net=815 مرئية، cogs/gp/operatingProfit=null، financial=null',
      mgrA.status === 200 && mgrA.j.sales.netSales === 815 && mgrA.j.profitAndLoss.cogs === null &&
      mgrA.j.profitAndLoss.grossProfit === null && mgrA.j.financial === null,
      JSON.stringify({ net: mgrA.j.sales.netSales, cogs: mgrA.j.profitAndLoss.cogs }));

    const mgrKpi = await api('GET', `/api/dashboard/kpis?from=${A}&to=${A}`, null, as(lm.token));
    record('manager kpis A: 200 + sales=815 (reports.read متاح للمدير)',
      mgrKpi.status === 200 && mgrKpi.j.sales.value === 815, `status=${mgrKpi.status}`);

    const cashierKpi = await api('GET', `/api/dashboard/kpis?from=${A}&to=${A}`, null, as(lc.token));
    record('cashier kpis → 403 (بلا reports.read)', cashierKpi.status === 403, `status=${cashierKpi.status}`);

    const devDash = await fetch(`${BASE}/api/cc/dashboard?from=${A}&to=${A}`, { headers: { 'x-api-key': DEVICE_KEY } });
    record('device key /api/cc/dashboard → 403', devDash.status === 403, `status=${devDash.status}`);

    const noAuth = await fetch(`${BASE}/api/dashboard/kpis?from=${A}&to=${A}`);
    record('kpis بلا هوية → 401', noAuth.status === 401, `status=${noAuth.status}`);

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