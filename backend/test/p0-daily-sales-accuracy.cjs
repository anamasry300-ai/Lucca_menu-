'use strict';
// ============================================================================
// P0 — DAILY SALES ACCURACY (golden / regression suite)
//
// الهدف: إثبات أن POS → Database → Reports → CashDrawer يعطي أرقام يومية صحيحة
// وفق العقد المرجعي docs/CANONICAL_REPORTING_CONTRACT.md:
//   grossSales   = Σ orders.subtotal        (paymentStatus = 'paid')
//   discounts    = Σ orders.discountAmount  (وليس orders.discount)
//   netSales     = Σ orders.total − Σ refunds.amount
//   ordersCount  = COUNT(paymentStatus='paid')
//   aov          = Σ orders.total / ordersCount
//   cashExpected = openingBalance + cashPayments − cashRefunds − cashExpenses
//
// البيانات تُكتب عبر الـ API الحقيقي (POST /api/orders ثم /checkout) ثم تُرجَع
// زمنياً إلى يومها — بصيغات الإنتاج نفسها:
//   orders.date/createdAt      → ISO-8601  'YYYY-MM-DDTHH:MM:SS.sssZ'  (كما يكتبها POS)
//   payments.createdAt         → SQLite      'YYYY-MM-DD HH:MM:SS'       (datetime('now') default)
//   refunds.createdAt          → SQLite      'YYYY-MM-DD HH:MM:SS'       (datetime('now') default)
//   expenses.date/createdAt    → ISO-8601
// (هذه هي المشكلة التي أخفتُها اختبارات phase6: كانت تبني طوابع ISO لكل شيء).
//
// كل حساب يومي يجب أن يُعزل عن يومه: لا تسريب من الأيام التالية/السابقة.
// Usage: node test/p0-daily-sales-accuracy.cjs   (بعد `npm run build`)
// ============================================================================
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p0-dsa-device-key';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
const eq = (a, b) => Number(a) === Number(b);

const D1 = '2026-05-10';
const D2 = '2026-05-11';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function awaitFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-p0-dsa-'));
  const dbPath = path.join(tmp, 'p0-dsa.db');
  process.env.DB_PATH = dbPath;
  const port = await awaitFreePort();
  const BASE = `http://127.0.0.1:${port}`;

  // ---------- 1) تهيئة قاعدة البيانات والمستخدم (قبل تشغيل الخادم) ----------
  const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
  const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
  await dbMod.initDb();
  const run = (sql, params = []) => dbMod.execute(sql, params);
  const pw = authMod.hashPassword('dsa-admin#2026');
  run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)',
    ['dsaadmin', pw, 'dsa-admin', 'admin', 1, 0]);
  run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9801, 'اختبار', 1, 100, 40]);
  dbMod.closeDb();

  // ---------- 2) تشغيل الخادم ----------
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: BACKEND,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), BACKUP_DIR: path.join(tmp, 'backups'), DEVICE_API_KEY: DEVICE_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const cleanup = () => { try { child.kill(); } catch { } };
  process.on('exit', cleanup);

  try {
    let up = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`${BASE}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 800));

    const login = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'dsaadmin', password: 'dsa-admin#2026' }),
    });
    const token = (await login.json()).token;
    record('تسجيل دخول الأدمن', !!token, `status=${login.status}`);
    if (!token) throw new Error('no token');

    const api = async (method, p, body) => {
      const res = await fetch(BASE + p, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    };

    // ---------- 3) مساعد: إنشاء طلب + تحصيل حقيقي، ثم إرجاعه ليومه ----------
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);

    const backdate = (orderId, day, hhmm) => {
      // orders.date = ISO-8601 كما يكتبها POS (ثابت بين الإرسال والخادم)
      raw.prepare("UPDATE orders SET date = ?, createdAt = ? WHERE id = ?").run(`${day}T10:00:00.000Z`, `${day}T10:00:00.000Z`, orderId);
      // payments.createdAt = datetime('now') => 'YYYY-MM-DD HH:MM:SS' (UTC، فاصل مسافة)
      raw.prepare("UPDATE payments SET createdAt = ? WHERE orderId = ?").run(`${day} ${hhmm}:00`, orderId);
    };
    const backdateRefund = (orderId, day, hhmm) => {
      raw.prepare("UPDATE refunds SET createdAt = ? WHERE orderId = ? AND createdAt IS NOT NULL").run(`${day} ${hhmm}:00`, orderId);
    };

    let seq = 0;
    const sell = async ({ day, items, discount = 0, discountType = 'percent', payments, hhmm }) => {
      seq += 1;
      const order = {
        orderType: 'takeaway', tableId: 'takeaway',
        status: 'pending', paymentStatus: 'unpaid',
        items, discount, discountType,
        customerName: 'اختبار', date: new Date().toISOString(),
      };
      const c = await api('POST', '/api/orders', order);
      if (c.status >= 300) throw new Error('create order failed: ' + JSON.stringify(c.j));
      const id = c.j.id;
      const co = await api('POST', `/api/orders/${id}/checkout`, { payments, paymentSyncId: `p0-dsa-${day}-${seq}` });
      if (co.status !== 200 || !co.j.success) throw new Error('checkout failed: ' + JSON.stringify(co.j));
      backdate(id, day, hhmm || '10:05');
      return { id, total: co.j.order && co.j.order.total };
    };

    // ---------- 4) السيناريو الذهبي (§10) ----------
    // D1: طلب1 = 100 نقدي (خصم 20 على subtotal 120) | طلب2 = 200 بطاقة | طلب3 = 150 مختلط (100 نقدي + 50 بطاقة)
    // استرداد 50 نقدي على طلب1 | مصروف 100 نقدي | افتتاح وردية 1000
    // D2: طلب4 = 400 نقدي | مصروف 200 نقدي   (يوم كامل — يجب ألا يتسرّب إلى D1)
    const o1 = await sell({ day: D1, discount: 20, discountType: 'fixed', items: [{ productId: 9801, name: 'اختبار', quantity: 1, unitPrice: 120, price: 120 }], payments: [{ method: 'cash', amount: 100 }] });
    const o2 = await sell({ day: D1, items: [{ productId: 9801, name: 'اختبار', quantity: 2, unitPrice: 100, price: 100 }], payments: [{ method: 'card', amount: 200 }] });
    const o3 = await sell({ day: D1, items: [{ productId: 9801, name: 'اختبار', quantity: 1, unitPrice: 150, price: 150 }], payments: [{ method: 'cash', amount: 100 }, { method: 'card', amount: 50 }] });
    const o4 = await sell({ day: D2, items: [{ productId: 9801, name: 'اختبار', quantity: 4, unitPrice: 100, price: 100 }], payments: [{ method: 'cash', amount: 400 }], hhmm: '11:05' });

    // استرداد كامل/جزئي عبر الـ API الحقيقي (POST /api/refunds) ثم إرجاعه ليوم D1
    const rf = await api('POST', '/api/refunds', { orderId: o1.id, amount: 50, reason: 'اختبار استرداد', type: 'partial', refundMethod: 'cash' });
    record('إنشاء استرداد 50 على D1', rf.status === 200 || rf.status === 201, `status=${rf.status}`);
    backdateRefund(o1.id, D1, '11:00');

    // مصروفات (expenses.date = ISO كما يكتبها الخادم)
    const e1 = await api('POST', '/api/expenses', { description: 'مصروف D1', category: 'operating', amount: 100, paymentMethod: 'cash', date: `${D1}T09:00:00` });
    const e2 = await api('POST', '/api/expenses', { description: 'مصروف D2', category: 'operating', amount: 200, paymentMethod: 'cash', date: `${D2}T09:00:00` });
    record('تسجيل مصروف D1=100 و D2=200', e1.status < 300 && e2.status < 300, `status=${e1.status}/${e2.status}`);

    // ---------- 5) التوقعات المرجعية ----------
    // D1: gross=Σsubtotal=120+200+150=470 | discounts=20 | Σtotal=100+200+150=450
    //     refunds=50 | net=400 | orders=3 | aov=150 | cash pay=200 | card pay=250
    //     expectedCash=1000+200-50-100=1050
    // D2: gross=400 | discounts=0 | Σtotal=400 | refunds=0 | net=400 | orders=1 | aov=400 | cash pay=400
    //     expectedCash(no shift)=0+400-0-200=200
    const EXP = {
      [D1]: { gross: 470, discounts: 20, total: 450, refunds: 50, net: 400, orders: 3, aov: 150, cash: 200, card: 250, cashExp: 100, expCash: 1050 },
      [D2]: { gross: 400, discounts: 0, total: 400, refunds: 0, net: 400, orders: 1, aov: 400, cash: 400, card: 0, cashExp: 200, expCash: 200 },
    };

    // ---------- 6) تقارير المبيعات (reportService) ----------
    for (const day of [D1, D2]) {
      const e = EXP[day];
      const r = await api('GET', `/api/reports/sales?from=${day}&to=${day}`);
      const j = r.j || {};
      record(`reports/sales ${day}: revenue=Σtotal=${e.total} netSales=${e.net} discounts=${e.discounts} refunds=${e.refunds} orders=${e.orders}`,
        r.status === 200 && eq(j.revenue, e.total) && eq(j.netSales, e.net) && eq(j.discounts, e.discounts) && eq(j.refunds, e.refunds) && eq(j.orders, e.orders),
        `got revenue=${j.revenue} net=${j.netSales} disc=${j.discounts} ref=${j.refunds} ord=${j.orders}`);
      const a = (j.avgOrder == null) ? null : Number(j.avgOrder);
      record(`reports/sales ${day}: avgOrder=${e.aov}`, eq(a, e.aov), `got ${j.avgOrder}`);
      const byMethod = {};
      for (const p of (j.payments || [])) byMethod[String(p.method)] = Number(p.total) || 0;
      record(`reports/sales ${day}: paymentMethods cash=${e.cash} card=${e.card} (بلا تسريب من يوم آخر)`,
        eq(byMethod.cash || 0, e.cash) && eq(byMethod.card || 0, e.card), `got ${JSON.stringify(byMethod)}`);
    }

    // ---------- 7) cc/dashboard (getSalesSummary) — نفس المصدر ----------
    for (const day of [D1, D2]) {
      const e = EXP[day];
      const d = await api('GET', `/api/cc/dashboard?from=${day}&to=${day}`);
      const s = (d.j && d.j.sales) || {};
      record(`cc/dashboard ${day}: gross=${e.gross} discounts=${e.discounts} refunds=${e.refunds} net=${e.net} orders=${e.orders}`,
        d.status === 200 && eq(s.grossSales, e.gross) && eq(s.discounts, e.discounts) && eq(s.refunds, e.refunds) && eq(s.netSales, e.net) && eq(s.ordersCount, e.orders),
        `got gross=${s.grossSales} disc=${s.discounts} ref=${s.refunds} net=${s.netSales} ord=${s.ordersCount}`);
    }

    // ---------- 8) الصندوق المتوقع (getCashReport) ----------
    await api('POST', '/api/cc/shifts/open', { date: D1, openingBalance: 1000 });
    for (const day of [D1, D2]) {
      const e = EXP[day];
      const c = await api('GET', `/api/cc/cash/daily?from=${day}&to=${day}`);
      const fin = await api('GET', `/api/cc/dashboard?from=${day}&to=${day}`);
      const exp = fin.j && fin.j.financial ? fin.j.financial.cash.expected : (fin.j && fin.j.cash ? fin.j.cash.expected : null);
      record(`cc/dashboard ${day}: cash.expected=${e.expCash} (expected — بدون closing)`,
        eq(exp, e.expCash), `got ${exp}; cash/daily=${JSON.stringify(c.j)}`);
    }

    // ---------- 9) إغلاق الوردية اليومية (المسار الذي يكتب daily_shifts) ----------
    const closed = await api('POST', '/api/cc/shifts/close', { date: D1, actualCash: 1050 });
    const row = (raw.prepare('SELECT * FROM daily_shifts WHERE date = ?').get(D1)) || {};
    record(`shifts/close ${D1}: cashSales=${EXP[D1].cash} cardSales=${EXP[D1].card} totalSales=${EXP[D1].total} totalExpenses=${EXP[D1].cashExp} orderCount=${EXP[D1].orders} expectedCash=${EXP[D1].expCash}`,
      closed.status === 200 && eq(row.cashSales, EXP[D1].cash) && eq(row.cardSales, EXP[D1].card) &&
      eq(row.totalSales, EXP[D1].total) && eq(row.totalExpenses, EXP[D1].cashExp) &&
      eq(row.orderCount, EXP[D1].orders) && eq(row.expectedCash, EXP[D1].expCash) && eq(row.actualCash, 1050) && eq(row.difference, 0),
      `got cashSales=${row.cashSales} cardSales=${row.cardSales} totalSales=${row.totalSales} exp=${row.totalExpenses} ord=${row.orderCount} expected=${row.expectedCash} diff=${row.difference} (status=${closed.status})`);

    // ---------- 10) نطاق متعدد الأيام ----------
    const rng = await api('GET', `/api/reports/sales?from=${D1}&to=${D2}`);
    record(`reports/sales range ${D1}..${D2}: revenue=850 net=800 orders=4`,
      rng.status === 200 && eq(rng.j.revenue, 850) && eq(rng.j.netSales, 800) && eq(rng.j.orders, 4),
      `got revenue=${rng.j.revenue} net=${rng.j.netSales} ord=${rng.j.orders}`);

    // ---------- 11) يوم فارغ ----------
    const empty = await api('GET', '/api/reports/sales?from=2026-05-01&to=2026-05-01');
    record('reports/sales يوم فارغ: كل الأرقام صفر (لا تسريب من نطاق مفتوح)',
      empty.status === 200 && eq(empty.j.revenue, 0) && eq(empty.j.netSales, 0) && eq(empty.j.orders, 0) && eq(empty.j.refunds, 0),
      `got revenue=${empty.j.revenue} net=${empty.j.netSales} ord=${empty.j.orders} ref=${empty.j.refunds}`);

    // ---------- 12) صحّة البيانات نفسها (حارس ضد future-fix كاذب) ----------
    const pRow = raw.prepare('SELECT createdAt FROM payments WHERE orderId = ?').get(o1.id);
    record('حارس: payments.createdAt بصيغة SQLite (مسافة) كما في الإنتاج', !!pRow && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(pRow.createdAt)), `createdAt=${pRow && pRow.createdAt}`);
    const oRow = raw.prepare('SELECT date, paymentStatus, totalPaid, status FROM orders WHERE id = ?').get(o1.id);
    record('حارس: الطلب مدفوع ومغلق: paymentStatus=paid totalPaid=total',
      oRow && oRow.paymentStatus === 'paid' && eq(oRow.totalPaid, 100) && oRow.status === 'closed',
      `got ${JSON.stringify(oRow)}`);

    raw.close();
  } catch (e) {
    record('تشغيل السيناريو الذهبي', false, String((e && e.message) || e));
  } finally {
    cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
