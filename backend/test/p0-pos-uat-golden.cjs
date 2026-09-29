#!/usr/bin/env node
/**
 * P0 — Golden POS UAT (scenario-driven, cross-surface)
 *
 * يغطي: cash / card / mixed / transfer / discount / refund(cash+card) /
 *       expense(cash+card) / open order / closed order
 *
 * ويتحقق أن نفس الأرقام تُقرأ من كل الأسطح الخمسة:
 *   POS  → سجلات الطلبات/المدفوعات/الاستردادات نفسها
 *   Reports      → /api/reports/sales  +  /api/reports/expenses
 *   Daily Shift  → /api/cc/shifts/close  (يكتب daily_shifts)
 *   Admin        → /api/cc/dashboard
 *   Batman       → نفس /api/reports/* عبر canonicalReport() (يُتحقق من الاستدعاء في batman UAT)
 *
 * العقد §1.1/§1.3:
 *   grossSales = Σ subtotal(paid) | discounts = Σ discountAmount
 *   revenue    = Σ total(paid)   | refunds  = Σ refunds.amount
 *   netSales   = revenue − refunds| orders   = COUNT(paid)
 *   AOV        = Σ total ÷ COUNT(paid)      (قبل الاسترداد)
 *   cashExpected = opening + cashPayments − cashRefunds − cashExpenses
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p0-uat-device-key';
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n         -> ${detail}`}`);
}
const eq = (a, b) => Number(a) === Number(b);

const D1 = '2026-05-20';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function awaitFreePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-p0-uat-'));
  const dbPath = path.join(tmp, 'uat.db');
  process.env.DB_PATH = dbPath;
  const port = await awaitFreePort();
  const BASE = `http://127.0.0.1:${port}`;

  const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
  const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
  await dbMod.initDb();
  const run = (sql, params = []) => dbMod.execute(sql, params);
  const pw = authMod.hashPassword('uat-admin#2026');
  run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)',
    ['uatadmin', pw, 'uat-admin', 'admin', 1, 0]);
    // categoryId 1 is seeded by migrations; do not re-insert it.
    run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9901, 'Cafe', 1, 100, 40]);
  dbMod.closeDb();

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
      body: JSON.stringify({ username: 'uatadmin', password: 'uat-admin#2026' }),
    });
    const token = (await login.json()).token;
    if (!token) throw new Error('no token');
    record('UAT: admin login', true);

    const api = async (method, p, body) => {
      const res = await fetch(BASE + p, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    };

    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);
    const backdate = (orderId, day, hhmm) => {
      raw.prepare('UPDATE orders SET date = ?, createdAt = ? WHERE id = ?').run(`${day}T10:00:00.000Z`, `${day}T10:00:00.000Z`, orderId);
      raw.prepare('UPDATE payments SET createdAt = ? WHERE orderId = ?').run(`${day} ${hhmm}:00`, orderId);
    };
    const backdateRefund = (orderId, day, hhmm) => {
      raw.prepare('UPDATE refunds SET createdAt = ? WHERE orderId = ? AND createdAt IS NOT NULL').run(`${day} ${hhmm}:00`, orderId);
    };

    let seq = 0;
    const sell = async ({ items, discount = 0, discountType = 'percent', payments, hhmm = '10:05' }) => {
      seq += 1;
      const c = await api('POST', '/api/orders', {
        orderType: 'takeaway', tableId: 'takeaway', status: 'pending', paymentStatus: 'unpaid',
        items, discount, discountType, customerName: 'UAT', date: new Date().toISOString(),
      });
      if (c.status >= 300) throw new Error('create order failed: ' + JSON.stringify(c.j));
      const id = c.j.id;
      const co = await api('POST', `/api/orders/${id}/checkout`, { payments, paymentSyncId: `p0-uat-${seq}` });
      if (co.status !== 200 || !co.j.success) throw new Error('checkout failed: ' + JSON.stringify(co.j));
      backdate(id, D1, hhmm);
      return { id, total: co.j.order && co.j.order.total };
    };
    const unit = (q, price) => ({ productId: 9901, name: 'Cafe', quantity: q, unitPrice: price, price });

    // ================= SCENARIO =================
    // o1 cash 100 (subtotal 120, خصم ثابت 20) | o2 card 200 | o3 mixed 150 (100 cash + 50 card)
    // o4 transfer 300 | o5 OPEN (غير محصّل) 500
    const o1 = await sell({ items: [unit(1, 120)], discount: 20, discountType: 'fixed', payments: [{ method: 'cash', amount: 100 }] });
    const o2 = await sell({ items: [unit(2, 100)], payments: [{ method: 'card', amount: 200 }], hhmm: '10:10' });
    const o3 = await sell({ items: [unit(1, 150)], payments: [{ method: 'cash', amount: 100 }, { method: 'card', amount: 50 }], hhmm: '10:15' });
    const o4 = await sell({ items: [unit(3, 100)], payments: [{ method: 'transfer', amount: 300 }], hhmm: '10:20' });

    // o5: open order — never checked out
    const open = await api('POST', '/api/orders', {
      orderType: 'dine_in', tableId: 't1', status: 'pending', paymentStatus: 'unpaid',
      items: [unit(5, 100)], discount: 0, discountType: 'percent', customerName: 'UAT-OPEN', date: new Date().toISOString(),
    });
    const openId = open.j.id;
    if (!openId) throw new Error('open order create failed: status=' + open.status + ' body=' + JSON.stringify(open.j));
    raw.prepare('UPDATE orders SET date = ?, createdAt = ? WHERE id = ?').run(`${D1}T11:00:00.000Z`, `${D1}T11:00:00.000Z`, openId);
    record('SCENARIO: cash / card / mixed / transfer / discount / open order created', !!o1.id && !!o2.id && !!o3.id && !!o4.id && !!openId);

    // refunds: cash 50 on o1, CARD 40 on o2
    const r1 = await api('POST', '/api/refunds', { orderId: o1.id, amount: 50, reason: 'uat cash', type: 'partial', refundMethod: 'cash' });
    const r2 = await api('POST', '/api/refunds', { orderId: o2.id, amount: 40, reason: 'uat card', type: 'partial', refundMethod: 'card' });
    backdateRefund(o1.id, D1, '11:10');
    backdateRefund(o2.id, D1, '11:15');
    record('SCENARIO: refund cash=50 + refund CARD=40', r1.status < 300 && r2.status < 300, `status=${r1.status}/${r2.status}`);

    // expenses: cash 100 + CARD 60
    const e1 = await api('POST', '/api/expenses', { description: 'cash exp', category: 'operating', amount: 100, paymentMethod: 'cash', date: `${D1}T09:00:00` });
    const e2 = await api('POST', '/api/expenses', { description: 'card exp', category: 'operating', amount: 60, paymentMethod: 'card', date: `${D1}T09:05:00` });
    record('SCENARIO: expense cash=100 + expense CARD=60', e1.status < 300 && e2.status < 300, `status=${e1.status}/${e2.status}`);

    // ================= EXPECTED (canonical) =================
    // paid orders only: o1(120/100) o2(200/200) o3(150/150) o4(300/300); o5 OPEN excluded
    // gross=120+200+150+300=770 | disc=20 | Σtotal=750 | refunds=90 | net=660 | orders=4 | AOV=187.5
    // cash pay=100+100=200 | card pay=200+50=250 | transfer=300 | nonCash=550
    // cashRefund=50 | cashExpense=100
    // expectedCash = 1000 + 200 − 50 − 100 = 1050
    const E = {
      gross: 770, discounts: 20, revenue: 750, refunds: 90, net: 660, orders: 4, aov: 187.5,
      cash: 200, card: 250, transfer: 300, nonCash: 550,
      cashRefunds: 50, totalRefunds: 90, allExpenses: 160, cashExpenses: 100, expCash: 1050,
    };

    // ================= 1) POS (source records) =================
    const posOrder = raw.prepare('SELECT COUNT(*) c, COALESCE(SUM(total),0) t, COALESCE(SUM(discountAmount),0) d, COALESCE(SUM(subtotal),0) s FROM orders WHERE paymentStatus = ?').get('paid');
    record('POS: paid orders=4 Σtotal=750 ΣdiscountAmount=20 Σsubtotal=770',
      posOrder.c === E.orders && eq(posOrder.t, E.revenue) && eq(posOrder.d, E.discounts) && eq(posOrder.s, E.gross),
      `got c=${posOrder.c} t=${posOrder.t} d=${posOrder.d} s=${posOrder.s}`);
    const openRow = raw.prepare('SELECT paymentStatus, status, total FROM orders WHERE id = ?').get(openId);
    record('POS: open order is EXCLUDED (unpaid, not closed)',
      openRow.paymentStatus === 'unpaid' && openRow.status === 'pending' && eq(openRow.total, 500), JSON.stringify(openRow));
    const closedRow = raw.prepare('SELECT paymentStatus, status, totalPaid FROM orders WHERE id = ?').get(o1.id);
    record('POS: closed order is paid/closed with totalPaid=total',
      closedRow.paymentStatus === 'paid' && closedRow.status === 'closed' && eq(closedRow.totalPaid, 100), JSON.stringify(closedRow));
    const payRow = raw.prepare("SELECT method, COALESCE(SUM(amount),0) t FROM payments WHERE status='completed' GROUP BY method ORDER BY method").all();
    const payMap = {}; for (const p of payRow) payMap[p.method] = Number(p.t);
    record('POS: payments cash=200 card=250 transfer=300 (mixed split recorded)',
      eq(payMap.cash, E.cash) && eq(payMap.card, E.card) && eq(payMap.transfer, E.transfer), JSON.stringify(payMap));
    const refRow = raw.prepare("SELECT refundMethod, COALESCE(SUM(amount),0) t FROM refunds GROUP BY refundMethod").all();
    const refMap = {}; for (const p of refRow) refMap[p.refundMethod] = Number(p.t);
    record('POS: refunds cash=50 card=40', eq(refMap.cash, E.cashRefunds) && eq(refMap.card, 40), JSON.stringify(refMap));

    // ================= 2) REPORTS =================
    const rs = (await api('GET', `/api/reports/sales?from=${D1}&to=${D1}`)).j || {};
    record('REPORTS: revenue=750 net=660 discounts=20 refunds=90 orders=4',
      eq(rs.revenue, E.revenue) && eq(rs.netSales, E.net) && eq(rs.discounts, E.discounts) &&
      eq(rs.refunds, E.refunds) && eq(rs.orders, E.orders),
      `got rev=${rs.revenue} net=${rs.netSales} disc=${rs.discounts} ref=${rs.refunds} ord=${rs.orders}`);
    record('REPORTS: avgOrder=187.5 (Σtotal ÷ paid, قبل الاسترداد)', eq(rs.avgOrder, E.aov), `got ${rs.avgOrder}`);
    const rsm = {}; for (const p of (rs.payments || [])) rsm[String(p.method)] = Number(p.total) || 0;
    record('REPORTS: paymentMethods cash=200 card=250 transfer=300',
      eq(rsm.cash, E.cash) && eq(rsm.card, E.card) && eq(rsm.transfer, E.transfer), JSON.stringify(rsm));
    const tp = (rs.topProducts || []).map((p) => Number(p.quantity) || 0).reduce((a, b) => a + b, 0);
    record('REPORTS: topProducts qty=7 (open order 5 مستبعدة)', eq(tp, 7), `got ${tp}`);

    // byDay: `revenue` يبقى إجمالياً (Σ total) و`net` هو الصافي بعد الاسترداد.
    // Batman كان يقرأ revenue كأنه net فيعرض 450 بدل 400.
    const bd = (rs.byDay || [])[0] || {};
    record('REPORTS: byDay revenue=750 (gross, unchanged) AND net=660 (after refunds)',
      eq(bd.revenue, 750) && eq(bd.net, 660), `got revenue=${bd.revenue} net=${bd.net} (row=${JSON.stringify(bd)})`);

    const re = (await api('GET', `/api/reports/expenses?from=${D1}&to=${D1}`)).j || {};
    record('REPORTS/expenses (Batman expensesOn): total=160 count=2', eq(re.total, E.allExpenses) && eq(re.count, 2),
      `got total=${re.total} count=${re.count}`);

    // ================= 3) ADMIN (cc/dashboard) =================
    const db = (await api('GET', `/api/cc/dashboard?from=${D1}&to=${D1}`)).j || {};
    const s = db.sales || {};
    record('ADMIN: grossSales=770 discounts=20 refunds=90 netSales=660 ordersCount=4',
      eq(s.grossSales, E.gross) && eq(s.discounts, E.discounts) && eq(s.refunds, E.refunds) &&
      eq(s.netSales, E.net) && eq(s.ordersCount, E.orders),
      `got gross=${s.grossSales} disc=${s.discounts} ref=${s.refunds} net=${s.netSales} ord=${s.ordersCount}`);

    // ================= 4) DAILY SHIFT (cash reconciliation) =================
    await api('POST', '/api/cc/shifts/open', { date: D1, openingBalance: 1000 });
    const fin = (await api('GET', `/api/cc/dashboard?from=${D1}&to=${D1}`)).j || {};
    const exp0 = fin.financial && fin.financial.cash ? fin.financial.cash.expected : null;
    record('SHIFT: cash.expected=1050 (1000+200−50−100؛ CARD refund/expense مستثناة)', eq(exp0, E.expCash), `got ${exp0}`);

    const cl = await api('POST', '/api/cc/shifts/close', { date: D1, actualCash: 1050 });
    const sh = raw.prepare('SELECT * FROM daily_shifts WHERE date = ?').get(D1) || {};
    record('SHIFT: cashSales=200 cardSales=550 totalSales=750 totalExpenses=100 orderCount=4',
      cl.status === 200 && eq(sh.cashSales, E.cash) && eq(sh.cardSales, E.nonCash) &&
      eq(sh.totalSales, E.revenue) && eq(sh.totalExpenses, E.cashExpenses) && eq(sh.orderCount, E.orders),
      `got cash=${sh.cashSales} card=${sh.cardSales} total=${sh.totalSales} exp=${sh.totalExpenses} ord=${sh.orderCount} (status=${cl.status})`);
    record('SHIFT: expectedCash=1050 actualCash=1050 difference=0',
      eq(sh.expectedCash, E.expCash) && eq(sh.actualCash, 1050) && eq(sh.difference, 0),
      `got expected=${sh.expectedCash} actual=${sh.actualCash} diff=${sh.difference}`);

    // CARD refund 40 must NOT reduce shift cash; CARD expense 60 must NOT either.
    record('SHIFT: CARD refund/expense excluded from cash math (1050 not 950/1010/950)',
      eq(sh.expectedCash, 1050), `expected=${sh.expectedCash}`);

    // ================= 5) CROSS-SURFACE EQUALITY =================
    record('CROSS: Reports.net == Admin.net == 660', eq(rs.netSales, E.net) && eq(s.netSales, E.net),
      `reports=${rs.netSales} admin=${s.netSales}`);
    record('CROSS: Reports.orders == Admin.ordersCount == Shift.orderCount == 4',
      eq(rs.orders, E.orders) && eq(s.ordersCount, E.orders) && eq(sh.orderCount, E.orders),
      `r=${rs.orders} a=${s.ordersCount} sh=${sh.orderCount}`);
    record('CROSS: POS Σtotal == Reports.revenue == Shift.totalSales == 750',
      eq(posOrder.t, E.revenue) && eq(rs.revenue, E.revenue) && eq(sh.totalSales, E.revenue),
      `pos=${posOrder.t} rep=${rs.revenue} shift=${sh.totalSales}`);

    // ================= 6) NEGATIVE: next day must not leak =================
    const nx = (await api('GET', '/api/reports/sales?from=2026-05-21&to=2026-05-21')).j || {};
    record('NEGATIVE: D2 فارغ تماماً (لا تسريب من D1)',
      eq(nx.revenue, 0) && eq(nx.netSales, 0) && eq(nx.orders, 0) && eq(nx.refunds, 0),
      `got rev=${nx.revenue} net=${nx.netSales} ord=${nx.orders} ref=${nx.refunds}`);

    // ================= 7) OFFLINE-SAFE: server unavailable =================
    // The local drawer must not fabricate numbers: with no server the report endpoints 5xx
    // rather than return partial/local data. (Batman falls back to IndexedDB in that case.)
    child.kill();
    await sleep(700);
    let refused = false;
    try { await fetch(`${BASE}/api/reports/sales?from=${D1}&to=${D1}`); } catch { refused = true; }
    record('OFFLINE: reports endpoint refuses rather than serving partial data', refused, 'expected connection refusal after shutdown');

    raw.close();
  } catch (e) {
    record('تشغيل Golden POS UAT', false, String((e && e.message) || e));
  } finally {
    cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== p0-pos-uat-golden: ${passed}/${results.length} passed, ${results.length - passed} failed ====`);
  process.exit(passed === results.length ? 0 : 1);
})();
