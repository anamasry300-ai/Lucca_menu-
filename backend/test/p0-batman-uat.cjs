#!/usr/bin/env node
/**
 * P0 — Batman read-path UAT
 *
 * الهدف: إثبات أن Batman لا يعيد حساب الأرقام، وأن المسار هو:
 *      Batman tool → canonicalReport() → /api/reports/* → reportService → server numbers
 *
 * الطريقة: نحمّل batman-dashboard.js الحقيقي داخل vm مع
 *   - ServerAPI.get = نداء حقيقي للخادم المُقلع
 *   - LuccaDB.db.getAll = يرمي استثناءً (THROW)
 * فإذا أعادت أي أداة رقماً فذلك يعني أنها اشتقّته محلياً،(Test يفشل فوراً).
 * أي استثناء يُلتقط بواسطة الأداة ويحوّلها إلى fallback local — ونتحقق أن
 * ذلك يحدث فقط عند تعطّل الخادم فعلاً (وأن المصدر يُعلَن صراحةً: 'local').
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const ROOT = path.join(BACKEND, '..');
const DEVICE_KEY = 'p0-batman-uat-key';
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n         -> ${detail}`}`);
}
const eq = (a, b) => Number(a) === Number(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function awaitFreePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

/** Load the real batman-dashboard.js in a sandbox whose window we control. */
function loadBatman(windowObj) {
  const code = fs.readFileSync(path.join(ROOT, 'batman-dashboard.js'), 'utf8');
  const documentStub = {
    // 'loading' => BatmanDashboard.init() is deferred to a DOMContentLoaded listener that
    // never fires here. We only need the read-only `tools` object, not the UI wiring.
    readyState: 'loading',
    addEventListener() { },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() { }, remove() { } }, appendChild() { } }; },
    body: { appendChild() { }, classList: { add() { }, remove() { } } },
  };
  const sandbox = {
    window: windowObj,
    document: documentStub,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: globalThis.fetch,
    URL, URLSearchParams, encodeURIComponent, decodeURIComponent,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, RegExp, isNaN, parseInt, parseFloat,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = windowObj;
  windowObj.window = windowObj;
  windowObj.document = documentStub;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'batman-dashboard.js' });
  return windowObj.BatmanDashboard;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-p0-bman-'));
  const dbPath = path.join(tmp, 'bman.db');
  process.env.DB_PATH = dbPath;
  const port = await awaitFreePort();
  const BASE = `http://127.0.0.1:${port}`;

  const TODAY = new Date().toISOString().slice(0, 10);
  const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
  const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
  await dbMod.initDb();
  const run = (sql, params = []) => dbMod.execute(sql, params);
  const pw = authMod.hashPassword('bm-uat#2026');
  run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)',
    ['bmanuat', pw, 'bm-uat', 'admin', 1, 0]);
  run('INSERT INTO products (id, name, categoryId, price, cost) VALUES (?,?,?,?,?)', [9902, 'Latte', 1, 100, 40]);
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
      try { const r = await fetch(`${BASE}/health`); if (r.ok) { up = true; break; } } catch { }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 800));

    const login = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bmanuat', password: 'bm-uat#2026' }),
    });
    const token = (await login.json()).token;
    if (!token) throw new Error('no token');
    const api = async (method, p, body) => {
      const res = await fetch(BASE + p, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    };

    // seed: today = cash 100 + card 200 + mixed(100 cash + 50 card) = 450, disc 20, refund 50 cash
    //       yesterday = card 300 (لاختبار salesOn على يوم سابق و salesTrendCompact)
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);
    let seq = 0;
    const seed = async (day, items, discount, discountType, payments, hhmm) => {
      seq += 1;
      const c = await api('POST', '/api/orders', {
        orderType: 'takeaway', tableId: 'takeaway', status: 'pending', paymentStatus: 'unpaid',
        items, discount, discountType, customerName: 'BM-UAT', date: new Date().toISOString(),
      });
      const id = c.j.id;
      const co = await api('POST', `/api/orders/${id}/checkout`, { payments, paymentSyncId: `bm-uat-${seq}` });
      if (co.status !== 200) throw new Error('checkout ' + JSON.stringify(co.j));
      raw.prepare('UPDATE orders SET date = ?, createdAt = ? WHERE id = ?').run(`${day}T10:00:00.000Z`, `${day}T10:00:00.000Z`, id);
      raw.prepare('UPDATE payments SET createdAt = ? WHERE orderId = ?').run(`${day} ${hhmm}:00`, id);
      return id;
    };
    const u = (q, price) => ({ productId: 9902, name: 'Latte', quantity: q, unitPrice: price, price });

    const t1 = await seed(TODAY, [u(1, 120)], 20, 'fixed', [{ method: 'cash', amount: 100 }], '10:05');
    await seed(TODAY, [u(2, 100)], 0, 'percent', [{ method: 'card', amount: 200 }], '10:10');
    await seed(TODAY, [u(1, 150)], 0, 'percent', [{ method: 'cash', amount: 100 }, { method: 'card', amount: 50 }], '10:15');
    await seed(YESTERDAY, [u(3, 100)], 0, 'percent', [{ method: 'card', amount: 300 }], '10:20');

    const rf = await api('POST', '/api/refunds', { orderId: t1, amount: 50, reason: 'bm', type: 'partial', refundMethod: 'cash' });
    if (rf.status >= 300) throw new Error('refund ' + JSON.stringify(rf.j));
    raw.prepare('UPDATE refunds SET createdAt = ? WHERE orderId = ? AND createdAt IS NOT NULL').run(`${TODAY} 11:00:00`, t1);
    await api('POST', '/api/expenses', { description: 'rent', category: 'operating', amount: 300, paymentMethod: 'cash', date: `${TODAY}T09:00:00` });

    // canonical truth from the server (this is what Reports shows)
    const srvToday = (await api('GET', `/api/reports/sales?from=${TODAY}&to=${TODAY}`)).j || {};
    const srvYest = (await api('GET', `/api/reports/sales?from=${YESTERDAY}&to=${YESTERDAY}`)).j || {};
    const srvExp = (await api('GET', `/api/reports/expenses?from=${TODAY}&to=${TODAY}`)).j || {};
    record('SEED: canonical revenue=450 net=400 discounts=20 refunds=50 orders=3',
      eq(srvToday.revenue, 450) && eq(srvToday.netSales, 400) && eq(srvToday.discounts, 20) && eq(srvToday.refunds, 50) && eq(srvToday.orders, 3),
      `got rev=${srvToday.revenue} net=${srvToday.netSales} disc=${srvToday.discounts} ref=${srvToday.refunds} ord=${srvToday.orders}`);

    // ================= load Batman with a BOOMING local db =================
    let dbHits = 0;
    const win = {
      LuccaDB: {
        ServerAPI: {
          async get(url) {
            const res = await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error('http ' + res.status);
            return res.json();
          },
        },
        db: {
          async getAll(store) { dbHits += 1; throw new Error('LOCAL RECOMPUTE ATTEMPTED on store=' + store); },
        },
      },
    };
    const BD = loadBatman(win);
    const T = BD && BD.tools;
    record('BATMAN: BatmanDashboard.tools loaded from the real file', !!(T && T.salesToday), 'tools missing');
    if (!T) throw new Error('tools not exposed');

    const before = dbHits;

    // ---------- salesToday ----------
    const st = await T.salesToday();
    record('BATMAN salesToday: sales=400 gross=450 count=3 refunds=50 source=reportService',
      eq(st.sales, srvToday.netSales) && eq(st.gross, srvToday.revenue) && eq(st.count, srvToday.orders) &&
      eq(st.refunds, srvToday.refunds) && st.source === 'reportService', JSON.stringify(st));

    // ---------- salesByPayment ----------
    const sbp = await T.salesByPayment();
    const sbpMap = {}; for (const r of sbp) sbpMap[String(r.method)] = Number(r.value);
    const srvPay = {}; for (const p of (srvToday.payments || [])) srvPay[String(p.method)] = Number(p.total) || 0;
    record('BATMAN salesByPayment: cash=200 card=250 (mapped from reportService, not recomputed)',
      eq(sbpMap.cash || 0, srvPay.cash) && eq(sbpMap.card || 0, srvPay.card), `got ${JSON.stringify(sbp)} server=${JSON.stringify(srvPay)}`);

    // ---------- productTotals ----------
    const pt = await T.productTotals();
    const ptQty = pt.reduce((a, b) => a + Number(b.qty || 0), 0);
    const srvQty = (srvToday.topProducts || []).reduce((a, b) => a + (Number(b.quantity) || 0), 0);
    record('BATMAN productTotals: qty matches server topProducts (4)',
      eq(ptQty, srvQty) && eq(ptQty, 4), `got ${ptQty} server=${srvQty}`);

    // ---------- salesOn (today) ----------
    const so = await T.salesOn(TODAY);
    record('BATMAN salesOn(today): sales=400 gross=450 count=3 refunds=50 discounts=20 avgOrder=150 source=reportService',
      eq(so.sales, srvToday.netSales) && eq(so.gross, srvToday.revenue) && eq(so.count, srvToday.orders) &&
      eq(so.refunds, srvToday.refunds) && eq(so.discounts, srvToday.discounts) && eq(so.avgOrder, srvToday.avgOrder) &&
      so.source === 'reportService', JSON.stringify(so));

    // ---------- salesOn (yesterday) — proves it is a range query, not "today" cached ----------
    const soy = await T.salesOn(YESTERDAY);
    record('BATMAN salesOn(yesterday): sales=300 gross=300 count=1 (no today-data leak)',
      eq(soy.sales, srvYest.netSales) && eq(soy.gross, srvYest.revenue) && eq(soy.count, 1) && soy.source === 'reportService',
      JSON.stringify(soy));

    // ---------- expensesOn ----------
    const eo = await T.expensesOn(TODAY);
    record('BATMAN expensesOn: total=300 count=1 source=reportService',
      eq(eo.total, srvExp.total) && eq(eo.count, srvExp.count) && eo.source === 'reportService', JSON.stringify(eo));
    const et = await T.expensesToday();
    record('BATMAN expensesToday: total=300 (delegates to expensesOn)', eq(et.total, srvExp.total), JSON.stringify(et));

    // ---------- yearSales ----------
    const ys = await T.yearSales();
    const srvYear = (await api('GET', `/api/reports/sales?from=${TODAY.slice(0, 4)}-01-01&to=${TODAY.slice(0, 4)}-12-31`)).j || {};
    record('BATMAN yearSales: matches full-year server report (sales=700 gross=750 count=4)',
      eq(ys.sales, srvYear.netSales) && eq(ys.gross, srvYear.revenue) && eq(ys.count, srvYear.orders) && ys.source === 'reportService',
      `got ${JSON.stringify(ys)} server net=${srvYear.netSales} rev=${srvYear.revenue} ord=${srvYear.orders}`);

    // ---------- salesTrendCompact ----------
    const tr = await T.salesTrendCompact(2);
    record('BATMAN salesTrendCompact(2): [[MM-DD, net]...] from reportService byDay',
      Array.isArray(tr) && tr.length === 2 && eq(tr[0][1], srvYest.netSales) && eq(tr[1][1], srvToday.netSales),
      `got ${JSON.stringify(tr)} (expected yesterday net=${srvYest.netSales}, today net=${srvToday.netSales})`);

    record('BATMAN: no local recompute attempted (LuccaDB.db.getAll never called)', dbHits === before, `dbHits=${dbHits}`);

    // ================= OFFLINE: server dies → must fall back, and must LABEL it =================
    child.kill();
    await sleep(800);
    let offlineErr = null;
    const so2 = await T.salesOn(TODAY).catch((e) => { offlineErr = e; return null; });
    // With the server gone AND a throwing local db, the tool must NOT return a number.
    const refused = (offlineErr !== null) || (so2 === null) ||
      (eq(so2.sales, 0) && so2.source === 'local');
    record('OFFLINE: with server down, tool refuses to fabricate (errors or 0/local) — no invented figures',
      refused, offlineErr ? `threw: ${offlineErr.message}` : `returned ${JSON.stringify(so2)}`);
    record('OFFLINE: any local source is explicitly labelled source="local", never "reportService"',
      (so2 === null) || so2.source === 'local', so2 ? `source=${so2.source}` : 'threw (acceptable)');

    raw.close();
  } catch (e) {
    record('تشغيل Batman UAT', false, String((e && e.message) || e));
  } finally {
    cleanup();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== p0-batman-uat: ${passed}/${results.length} passed, ${results.length - passed} failed ====`);
  process.exit(passed === results.length ? 0 : 1);
})();
