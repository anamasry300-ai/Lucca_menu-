// Phase 5 — Batman Decision Layer (Tier 1 + Tier 2 gate): verification.
// Boots the real compiled server against a seeded temp DB.
// Proves the decision layer is callable standalone from Node (pre-server, via dist),
// then exercises the HTTP surface /api/batman/actions + /api/batman/execute:
//   RBAC (Layer 1), Batman matrix (Layer 2), needs_approval, explicitConfirm,
//   idempotent execution by eventId, audit log, RBAC 401/403, no secret leaks.
// Usage: node test/phase5-decision-layer.cjs   (requires `npm run build` first)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const DEVICE_KEY = 'p5-device-key-456';

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

const D = '2026-09-10';

(async () => {
  try {
    const port = await awaitFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase5-'));
    const dbPath = path.join(tmp, 'p5.db');
    process.env.DB_PATH = dbPath;

    const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
    const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
    await dbMod.initDb();
    const run = (sql, params = []) => dbMod.execute(sql, params);

    const mkUser = (username, role) => {
      const pw = authMod.hashPassword(username + '#2026');
      run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)', [username, pw, username, role, 1, 0]);
    };
    mkUser('admin5', 'admin');
    mkUser('manager5', 'manager');
    mkUser('cashier5', 'cashier');

    run("INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?,?,?,?,?,?)", [9601, 'طحين', 5, 'كجم', 2, 20]);
    run("INSERT INTO employees (name, role, salary, active) VALUES (?,?,?,?)", ['خالد', 'كاشير', 0, 1]);
    // مصفوفة إضافية لتغطية مسار needs_approval/تأكيد صريح (دور device يملك payments.write كصلاحية خام)
    run("INSERT OR IGNORE INTO batman_permissions (action, description, limitValue, requiresApproval, autoExecute, minRole) VALUES (?,?,?,?,?,?)", ['create_payment_method', 'إنشاء وسيلة دفع (تأكيد)', 0, 1, 0, 'cashier']);

    const decisionMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'decisionService.js')).href);
    const permMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'permissionService.js')).href);

    record('listActions → 28 أداة موثقة', decisionMod.listActions().length === 28, `count=${decisionMod.listActions().length}`);
    const first = decisionMod.listActions()[0];
    record('أداة تحمل كامل الوصف (permission/matrixAction/readOnly)', !!(first && first.permission && first.matrixAction && first.readOnly === false && first.requiresConfirmation !== undefined && first.inputSchema), JSON.stringify(first).slice(0, 140));

    let r1 = decisionMod.approve('create_category', { role: 'cashier', name: 'casher5' }, { name: 'قسم من كاشير' });
    record('مباشر: كاشير create_category → blocked (RBAC Layer 1)', r1.decision === 'blocked' && r1.executed === false, JSON.stringify(r1));

    const directCat = decisionMod.approve('create_category', { role: 'manager', name: 'manager5' }, { name: 'قسم مدير مباشر' });
    record('مباشر: مدير create_category → executed', directCat.decision === 'executed' && directCat.executed === true && directCat.result && directCat.result.id > 0, JSON.stringify({ decision: directCat.decision, id: directCat.result && directCat.result.id }));

    const directExp = decisionMod.approve('create_expense', { role: 'admin', name: 'admin5' }, { amount: 50, description: 'مباشر' });
    record('مباشر: أدمن create_expense → executed + result=id', directExp.decision === 'executed' && typeof directExp.result === 'number' && directExp.amount === 50, JSON.stringify({ decision: directExp.decision, result: directExp.result, amount: directExp.amount }));

    const pending = decisionMod.approve('create_payment_method', { role: 'device', name: 'device' }, { name: 'محفظة مباشر' });
    record('مباشر: device create_payment_method → needs_approval', pending.decision === 'needs_approval' && pending.executed === false && pending.requiresApproval === true, JSON.stringify(pending));

    const confirmed = decisionMod.approve('create_payment_method', { role: 'device', name: 'device' }, { name: 'محفظة مؤكدة' }, { eventId: 'p5-direct-confirm-1', explicitConfirm: true });
    record('مباشر: تأكيد صريح → executed + confirmed=true', confirmed.decision === 'executed' && confirmed.executed === true && confirmed.confirmed === true, JSON.stringify(confirmed));

    const idem1 = decisionMod.approve('create_category', { role: 'manager', name: 'manager5' }, { name: 'قسم idem' }, { eventId: 'p5-direct-idem-1' });
    const idem2 = decisionMod.approve('create_category', { role: 'manager', name: 'manager5' }, { name: 'يجب ألا يكرر' }, { eventId: 'p5-direct-idem-1' });
    record('مباشر: إعادة نفس eventId → alreadyExecuted بلا تنفيذ', idem1.decision === 'executed' && idem1.executed === true && idem2.alreadyExecuted === true && idem2.executed === false, JSON.stringify({ first: idem1.decision, second: idem2.decision, already: !!idem2.alreadyExecuted }));

    record('مباشر: unknown action يرمي badRequest', (() => { try { decisionMod.approve('nope', { role: 'admin' }, {}); return false; } catch (e) { return e.status === 400; } })());

    const dRows = dbMod.queryAll('SELECT action, decision FROM batman_decisions WHERE eventId = ?', ['p5-direct-confirm-1']);
    record('مباشر: قرار التأكيد مسجل executed في السجل', dRows.length === 1 && dRows[0].decision === 'executed', JSON.stringify(dRows));
    const dIdem = dbMod.queryAll('SELECT decision FROM batman_decisions WHERE eventId = ?', ['p5-direct-idem-1']);
    record('مباشر: صف idempotent واحد فقط', dIdem.length === 1, `rows=${dIdem.length}`);

    record('مباشر: decide() كاشير add_expense 50 → under_threshold', permMod.decide('cashier', 'add_expense', 50).decision === 'under_threshold', '');
    record('مباشر: decide() كاشير add_expense 600 → needs_approval', permMod.decide('cashier', 'add_expense', 600).decision === 'needs_approval', '');
    record('مباشر: decide() كاشير update_price → blocked', permMod.decide('cashier', 'update_price', 0).decision === 'blocked', '');

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
      const res = await fetch(BASE + p, { method, headers: h, body: body && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    }
    const as = (token) => ({ Authorization: `Bearer ${token}` });
    const asDevice = () => ({ 'x-api-key': DEVICE_KEY });

    const la = await login('admin5', 'admin5#2026');
    gAdmin = la.token;
    const lm = await login('manager5', 'manager5#2026');
    gManager = lm.token;
    const lc = await login('cashier5', 'cashier5#2026');
    gCashier = lc.token;
    record('إعداد الأدوار (admin/manager/cashier)', !!(gAdmin && gManager && gCashier), `tokens=${!!gAdmin}/${!!gManager}/${!!gCashier}`);

    // ===== سجل الأدوات =====
    let r = await fetch(`${BASE}/api/batman/actions`, { method: 'GET' });
    record('GET /api/batman/actions بلا هوية → 401', r.status === 401, `status=${r.status}`);
    r = await api('GET', '/api/batman/actions');
    record('GET /api/batman/actions أدمن → 200 + count=28', r.status === 200 && r.j.count === 28 && Array.isArray(r.j.actions), `count=${r.j && r.j.count}`);
    r = await api('GET', '/api/batman/actions', null, asDevice());
    record('GET /api/batman/actions device → 200 (غير إدارية)', r.status === 200 && r.j.count === 28, `status=${r.status}`);

    // ===== تنفيذ عبر طبقة القرار (HTTP) =====
    r = await fetch(`${BASE}/api/batman/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_category', params: {} }) });
    record('POST /api/batman/execute بلا هوية → 401', r.status === 401, `status=${r.status}`);

    r = await api('POST', '/api/batman/execute', { action: 'create_expense', params: { amount: 10 } }, as(gCashier));
    record('HTTP كاشير create_expense → blocked (RBAC)', r.status === 200 && r.j.decision === 'blocked' && r.j.executed === false, JSON.stringify(r.j));

    r = await api('POST', '/api/batman/execute', { action: 'create_category', params: { name: 'فئة HTTP' } }, as(gManager));
    record('HTTP مدير create_category → executed', r.status === 200 && r.j.decision === 'executed' && r.j.result && r.j.result.name === 'فئة HTTP', JSON.stringify({ decision: r.j && r.j.decision, id: r.j && r.j.result && r.j.result.id }));

    r = await api('POST', '/api/batman/execute', { action: 'create_table', params: { number: 77, zone: 'تراس' } });
    record('HTTP أدمن create_table → executed', r.status === 200 && r.j.decision === 'executed' && r.j.result && r.j.result.number === 77, JSON.stringify(r.j.result || {}).slice(0, 120));

    r = await api('POST', '/api/batman/execute', { action: 'create_expense', params: { amount: 25, description: 'قرطاسية' } });
    record('HTTP أدمن create_expense → executed + result=id', r.status === 200 && r.j.decision === 'executed' && typeof r.j.result === 'number' && r.j.amount === 25, JSON.stringify({ decision: r.j && r.j.decision, result: r.j && r.j.result }));

    r = await api('POST', '/api/batman/execute', { action: 'create_payment_method', params: { name: 'مصرفي' } }, asDevice());
    record('HTTP device create_payment_method → needs_approval', r.status === 200 && r.j.decision === 'needs_approval' && r.j.executed === false && r.j.requiresApproval === true, JSON.stringify(r.j));

    r = await api('POST', '/api/batman/execute', { action: 'create_payment_method', params: { name: 'تأكيد HTTP' }, eventId: 'p5-http-confirm-1', explicitConfirm: true }, asDevice());
    record('HTTP device + تأكيد صريح → executed + confirmed', r.status === 200 && r.j.decision === 'executed' && r.j.executed === true && r.j.confirmed === true, JSON.stringify({ decision: r.j && r.j.decision, confirmed: r.j && r.j.confirmed }));

    r = await api('POST', '/api/batman/execute', { action: 'create_category', params: { name: 'idem HTTP' }, eventId: 'p5-http-idem-1' });
    const httpIdem1 = r;
    r = await api('POST', '/api/batman/execute', { action: 'create_category', params: { name: 'idem HTTP 2' }, eventId: 'p5-http-idem-1' });
    record('HTTP idempotency: نفس eventId → alreadyExecuted', httpIdem1.status === 200 && httpIdem1.j.decision === 'executed' && httpIdem1.j.executed === true && r.j.decision === 'executed' && r.j.executed === false && r.j.alreadyExecuted === true, JSON.stringify({ first: httpIdem1.j.decision, second: r.j.decision, already: !!r.j.alreadyExecuted }));

    r = await api('POST', '/api/batman/execute', { action: 'create_product', params: { name: 'منتج بلا صلاحية', price: -5 } }, as(gCashier));
    record('HTTP كاشير create_product → blocked + لا تصريح خاطئ', r.status === 200 && r.j.decision === 'blocked', `decision=${r.j && r.j.decision}`);
    r = await api('POST', '/api/batman/execute', { action: 'غير_معروف', params: {} });
    record('HTTP action غير مسجل → 400', r.status === 400, `status=${r.status}`);

    r = await api('POST', '/api/batman/execute', { action: 'create_category', params: { name: 'قسم مدير' } }, as(gManager));
    const cat2 = r;
    r = await api('POST', '/api/batman/execute', { action: 'delete_category', params: { id: cat2.j.result.id } }, as(gManager));
    record('HTTP حذف قسم (بعد إنشائه عبر القرار) → executed', r.status === 200 && r.j.decision === 'executed' && r.j.executed === true, JSON.stringify({ decision: r.j && r.j.decision, result: r.j && r.j.result }));

    // ===== سجل القرارات (مراجعة) =====
    r = await api('GET', '/api/batman/decisions?limit=50');
    const decisions = r.j && Array.isArray(r.j.decisions) ? r.j.decisions : [];
    record('GET /api/batman/decisions أدمن → 200 + سجل>0', r.status === 200 && decisions.length > 0, `rows=${decisions.length}`);
    const hasExec = decisions.some((x) => x.decision === 'executed');
    const hasPending = decisions.some((x) => x.decision === 'needs_approval');
    const hasBlocked = decisions.some((x) => x.decision === 'blocked');
    record('السجل يحوي executed/needs_approval/blocked', hasExec && hasPending && hasBlocked, `exec=${hasExec} pend=${hasPending} block=${hasBlocked}`);
    const confRow = decisions.filter((x) => x.eventId === 'p5-http-confirm-1');
    record('سجل التأكيد HTTP مسجل executed', confRow.length === 1 && confRow[0].decision === 'executed', JSON.stringify(confRow));
    r = await api('GET', '/api/batman/decisions', null, as(gCashier));
    record('GET /api/batman/decisions كاشير → 403', r.status === 403, `status=${r.status}`);

    // ===== استمرار البيانات عبر تنفيذ مباشر سابق =====
    r = await api('GET', '/api/cc/categories');
    const catNames = r.j && Array.isArray(r.j.rows) ? r.j.rows.map((x) => x.name) : [];
    record('الأقسام المُنشأة مباشراً + HTTP ظاهرة في /api/cc', catNames.includes('قسم مدير مباشر') && catNames.includes('فئة HTTP'), `names=${catNames.join('|').slice(0, 100)}`);

    const sweep = [JSON.stringify(r.j), JSON.stringify(decisions), JSON.stringify(directExp), JSON.stringify(confirmed)];
    const leaked = sweep.filter((s) => /pbkdf2:|password|DEVICE_API_KEY|SERVER_KEY|lucca_openai|p5-device-key-456/i.test(s || ''));
    record('لا تسريب أسرار في استجابات طبقة القرار', leaked.length === 0, leaked.join(' | ').slice(0, 120));

    console.log('\n====================');
    const passed = results.filter((x) => x.ok).length;
    const failed = results.length - passed;
    console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('خطأ في التنفيذ:', e);
    if (typeof child !== 'undefined') { try { child.kill(); } catch {} }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exitCode = 1;
  }
})().catch((e) => { console.error('خطأ:', e); process.exitCode = 1; });