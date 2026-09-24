// Phase 5A — RBAC & Write-Path Closures: verification.
// Boots the real compiled server against a seeded temp DB and proves the three closures:
//   A) /api/sync per-store RBAC (purchases/expenses/suppliers/product_recipes/waste_log)
//   B) Batman expense write-path (server-derived role in /check, decision gate, blocked bypass,
//      direct saver cannot bypass server authorization, authorized flows still work)
//   C) cash_registers writes restricted to admin/manager (reads + single-open-register unchanged)
// Usage: node test/phase5a-rbac-write-paths.cjs   (requires `npm run build` first)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p5a-device-key-789';

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

(async () => {
  let child;
  try {
    const port = await awaitFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase5a-'));
    const dbPath = path.join(tmp, 'p5a.db');
    process.env.DB_PATH = dbPath;

    const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
    const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
    await dbMod.initDb();
    const run = (sql, params = []) => dbMod.execute(sql, params);

    const mkUser = (username, role) => {
      const pw = authMod.hashPassword(username + '#2026');
      run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)', [username, pw, username, role, 1, 0]);
    };
    mkUser('admin5a', 'admin');
    mkUser('manager5a', 'manager');
    mkUser('cashier5a', 'cashier');
    mkUser('kitchen5a', 'kitchen');

    dbMod.closeDb();

    child = spawn(process.execPath, ['dist/index.js'], {
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

    let gAdmin = null, gManager = null, gCashier = null, gKitchen = null;

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
      const res = await fetch(BASE + p, { method, headers: h, body: body !== undefined && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    }
    const as = (token) => ({ Authorization: `Bearer ${token}` });
    const asDevice = () => ({ 'x-api-key': DEVICE_KEY });
    const skippedFor = (j, store, needle) => {
      const details = (j && Array.isArray(j.log && j.log.conflictDetail)) ? j.log.conflictDetail : [];
      return details.some((d) => d && d.store === store && (!needle || String(d.reason || '').indexOf(needle) !== -1));
    };

    const la = await login('admin5a', 'admin5a#2026'); gAdmin = la.token;
    const lm = await login('manager5a', 'manager5a#2026'); gManager = lm.token;
    const lc = await login('cashier5a', 'cashier5a#2026'); gCashier = lc.token;
    const lk = await login('kitchen5a', 'kitchen5a#2026'); gKitchen = lk.token;
    record('إعداد الأدوار (admin/manager/cashier/kitchen) + device', !!(gAdmin && gManager && gCashier && gKitchen), `tokens=${!!gAdmin}/${!!gManager}/${!!gCashier}/${!!gKitchen}`);

    // ======================= A) /api/sync per-store RBAC =======================
    const purchaseItem = (i) => ({ syncId: `p5a-pur-${i}`, name: 'شراء مورد' + i, item: 'بن كولومبي', quantity: 10, costPrice: 120, total: 1200, supplier: 'مورد 1', date: '2026-09-10' });
    const expenseItem = (i) => ({ syncId: `p5a-exp-${i}`, description: 'كهرباء ' + i, category: 'عام', amount: 300, paymentMethod: 'cash', date: '2026-09-10' });
    const supplierItem = (i) => ({ syncId: `p5a-sup-${i}`, name: 'مورد خارجي ' + i, phone: '0100', updatedAt: '2026-09-10' });
    const recipeItem = (i) => ({ syncId: `p5a-rec-${i}`, productId: 1, productSyncId: 'prod-1', ingredient: 'طحين', quantity: 2, unit: 'كجم', updatedAt: '2026-09-10' });
    const wasteItem = (i) => ({ syncId: `p5a-wst-${i}`, productId: 1, productSyncId: 'prod-1', quantity: 1, reason: 'تالف', createdAt: '2026-09-10' });

    let r = await api('POST', '/api/sync', { purchases: [purchaseItem(1)] }, as(gCashier));
    record('A1: cashier+sync → purchase write مرفوضة (skip)', r.status === 200 && skippedFor(r.j, 'purchases', 'صلاحية'), `status=${r.status} skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { purchases: [purchaseItem(2)] }, as(gKitchen));
    record('A2: kitchen+sync → purchase write مرفوضة (skip)', r.status === 200 && skippedFor(r.j, 'purchases', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { purchases: [purchaseItem(3)] }, asDevice());
    record('A3: device+sync → purchase write مرفوضة (skip)', r.status === 200 && skippedFor(r.j, 'purchases', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);

    r = await api('POST', '/api/sync', { expenses: [expenseItem(1)] }, as(gCashier));
    record('A4: cashier+sync → expense write مرفوضة (skip)', r.status === 200 && skippedFor(r.j, 'expenses', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { expenses: [expenseItem(2)] }, as(gKitchen));
    record('A5: kitchen+sync → expense write مرفوضة (skip)', r.status === 200 && skippedFor(r.j, 'expenses', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { expenses: [expenseItem(3)] }, asDevice());
    record('A6: device+sync → expense write مرفوضة (skip)', r.status === 200 && skippedFor(r.j, 'expenses', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);

    r = await api('POST', '/api/sync', { suppliers: [supplierItem(1)] }, as(gCashier));
    record('A7: cashier+sync → supplier write مرفوضة (admin-only)', r.status === 200 && skippedFor(r.j, 'suppliers', 'admin'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { suppliers: [supplierItem(2)] }, as(gManager));
    record('A7b: manager+sync → supplier write مرفوضة (admin-only كالمفضل في CRUD)', r.status === 200 && skippedFor(r.j, 'suppliers', 'admin'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);

    r = await api('POST', '/api/sync', { product_recipes: [recipeItem(1)] }, as(gCashier));
    record('A8: cashier+sync → recipe write مرفوضة (products.write)', r.status === 200 && skippedFor(r.j, 'product_recipes', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);

    r = await api('POST', '/api/sync', { waste_log: [wasteItem(1)] }, asDevice());
    record('A9: device+sync → waste write مرفوضة (inventory.write)', r.status === 200 && skippedFor(r.j, 'waste_log', 'صلاحية'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);

    // إيجابي: admin/manager يتزامنون بنجاح حسب صلاحياتهم، والمخازن غير المالية تبقى كالسابق للكاشير/المطبخ
    r = await api('POST', '/api/sync', { expenses: [expenseItem(10)] }, as(gAdmin));
    record('A10: admin+sync → expense write مقبولة (inserted)', r.status === 200 && r.j.log.inserted === 1 && !skippedFor(r.j, 'expenses'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { purchases: [purchaseItem(10)] }, as(gManager));
    record('A10b: manager+sync → purchase write مقبولة (purchases.write)', r.status === 200 && r.j.log.inserted === 1 && !skippedFor(r.j, 'purchases'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { expenses: [expenseItem(11)] }, as(gManager));
    record('A10c: manager+sync → expense write مقبولة (expenses.write)', r.status === 200 && r.j.log.inserted === 1 && !skippedFor(r.j, 'expenses'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { waste_log: [wasteItem(10)] }, as(gManager));
    record('A10d: manager+sync → waste write مقبولة (inventory.write)', r.status === 200 && r.j.log.inserted === 1 && !skippedFor(r.j, 'waste_log'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { categories: [{ syncId: 'p5a-cat-1', name: 'مشروبات كيتشن', color: '#fff' }] }, as(gKitchen));
    record('A10e: kitchen+sync → categories (غير مالية) تبقى مقبولة كالسابق', r.status === 200 && r.j.log.inserted === 1, `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { orders: [{ syncId: 'p5a-ord-1', tableId: 'takeaway', status: 'pending', items: '[]' }] }, as(gCashier));
    record('A10f: cashier+sync → orders (مسار POS التشغيلي) تبقى مقبولة', r.status === 200 && r.j.log.inserted === 1 && !skippedFor(r.j, 'orders'), `ins=${r.j && r.j.log && r.j.log.inserted}`);

    const noAuthRes = await fetch(BASE + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expenses: [expenseItem(99)] }) });
    record('A11: /api/sync بلا هوية → 401', noAuthRes.status === 401, `status=${noAuthRes.status}`);

    // ======================= B) Batman expense write-path =======================
    r = await api('POST', '/api/batman/check', { action: 'add_expense', role: 'admin', amount: 50 }, as(gCashier));
    record('B1: /check كاشير بادعاء role=admin → executorRole=cashier + under_threshold', r.status === 200 && r.j.executorRole === 'cashier' && r.j.decision === 'under_threshold', JSON.stringify(r.j && { executorRole: r.j.executorRole, decision: r.j.decision }));
    r = await api('POST', '/api/batman/check', { action: 'add_expense', role: 'admin', amount: 600 }, as(gCashier));
    record('B2: /check كاشير بادعاء admin فوق الحد → needs_approval (لا تصعيد بالدور)', r.status === 200 && r.j.executorRole === 'cashier' && r.j.decision === 'needs_approval', JSON.stringify(r.j && { executorRole: r.j.executorRole, decision: r.j.decision }));
    r = await api('POST', '/api/batman/check', { action: 'add_expense', role: 'admin', amount: 50 }, asDevice());
    record('B2b: /check device بادعاء role=admin → executorRole=device (دور الجهاز يُفرض)', r.status === 200 && r.j.executorRole === 'device', JSON.stringify(r.j && { executorRole: r.j.executorRole }));
    r = await api('POST', '/api/batman/check', { action: 'add_expense', role: 'manager', amount: 600 }, as(gKitchen));
    record('B2c: /check kitchen بادعاء manager → executorRole=kitchen + needs_approval', r.status === 200 && r.j.executorRole === 'kitchen' && r.j.decision === 'needs_approval', JSON.stringify(r.j && { executorRole: r.j.executorRole, decision: r.j.decision }));

    r = await api('POST', '/api/batman/execute', { action: 'create_expense', params: { amount: 250, description: 'محاولة كاشير' }, explicitConfirm: true }, as(gCashier));
    record('B3: كاشير لا ينشئ مصروفاً عبر طبقة القرار حتى بتأكيد صريح (blocked — RBAC)', r.status === 200 && r.j.decision === 'blocked' && r.j.executed === false, JSON.stringify(r.j && { decision: r.j.decision, reason: (r.j.reason || '').slice(0, 60) }));
    r = await api('POST', '/api/batman/execute', { action: 'create_expense', params: { amount: 250, description: 'مصروف أدمن' } }, as(gAdmin));
    record('B4: أدمن ينشئ مصروفاً عبر طبقة القرار → executed (+ result=id)', r.status === 200 && r.j.decision === 'executed' && r.j.executed === true && typeof r.j.result === 'number', JSON.stringify({ decision: r.j && r.j.decision, result: r.j && r.j.result }));

    // "direct saveExpenseFromText cannot bypass server authorization": السيرفر هو حدود الإنفاذ
    // (كتابة المصروف محلياً ثم دفعها بالمزامنة أو تحميلها عبر /api/cc تُرفض فوراً لجهة بلا صلاحية)
    r = await api('POST', '/api/sync', { expenses: [expenseItem(12)] }, as(gCashier));
    record('B5: كتابة مصروف محلياً ثم دفعها عبر sync من كاشير → مرفوضة سيرفراً (لا تجاوز بالحارس الموحّد)', r.status === 200 && skippedFor(r.j, 'expenses', 'صلاحية') && r.j.log.inserted === 0, `ins=${r.j && r.j.log && r.j.log.inserted} skip=${r.j && r.j.log && r.j.log.skipped}`);
    r = await api('POST', '/api/cc/expenses', { description: 'مصروف كاشير cc', category: 'عام', amount: 30, paymentMethod: 'cash' }, as(gCashier));
    record('B5b: /api/cc/expenses من كاشير → 403 (expenses.write)', r.status === 403, `status=${r.status}`);
    r = await api('POST', '/api/batman/execute', { action: 'create_expense', params: { amount: 600, description: 'مصروف مدير يؤكد' }, eventId: 'p5a-mgr-1' }, as(gManager));
    record('B6: مدير ينفذ مصروفاً فوق الحد مباشرة (المسار المصرَّح يعمل)', r.status === 200 && r.j.decision === 'executed' && r.j.executed === true, JSON.stringify({ decision: r.j && r.j.decision, confirmed: r.j && r.j.confirmed }));

    // ======================= C) cash_registers authorization =======================
    const reg = { syncId: 'p5a-cr-1', status: 'open', startingCash: 500, expectedCash: 1500, difference: 0 };
    r = await api('POST', '/api/cash_registers', reg, as(gCashier));
    record('C1: كاشير لا يكتب cash_registers (403)', r.status === 403, `status=${r.status}`);
    r = await api('POST', '/api/cash_registers', { ...reg, syncId: 'p5a-cr-2' }, as(gKitchen));
    record('C2a: مطبخ لا يكتب cash_registers (403)', r.status === 403, `status=${r.status}`);
    r = await api('POST', '/api/cash_registers', { ...reg, syncId: 'p5a-cr-3' }, asDevice());
    record('C2b: device لا يكتب cash_registers (403)', r.status === 403, `status=${r.status}`);
    r = await api('POST', '/api/cash_registers', reg, as(gAdmin));
    record('C3: admin يفتح/يكتب cash_registers → 201 (مسار مصرَّح يعمل)', r.status === 201, `status=${r.status}`);
    const openRegId = r.j && r.j.id;
    r = await api('POST', '/api/cash_registers', { ...reg, syncId: 'p5a-cr-4' }, as(gManager));
    record('C4: سلوك الوردية الواحدة لم يتغير — وردية ثانية من مدير → 409', r.status === 409, `status=${r.status}`);
    r = await api('PUT', '/api/cash_registers/' + openRegId, { difference: 10 }, as(gManager));
    record('C5: manager يعدّل cash_registers → 200', r.status === 200, `status=${r.status}`);
    r = await api('GET', '/api/cash_registers', null, as(gCashier));
    record('C6: قراءة cash_registers للكاشير تبقى متاحة (200)', r.status === 200 && Array.isArray(r.j), `status=${r.status} rows=${Array.isArray(r.j) ? r.j.length : '?'}`);

    console.log('\n====================');
    const passed = results.filter((x) => x.ok).length;
    const failed = results.length - passed;
    console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
    child.kill(); child = undefined;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('خطأ في التنفيذ:', e);
    if (child) { try { child.kill(); } catch {} }
    process.exitCode = 1;
  }
})().catch((e) => { console.error('خطأ:', e); process.exitCode = 1; });