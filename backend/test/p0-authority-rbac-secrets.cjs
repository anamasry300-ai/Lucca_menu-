// P0 — Authority, RBAC & Secret Isolation: verification.
// Proves, against the real compiled server + a seeded temp DB:
//   A) /api/sync products store is gated by products.write (no cashier/kitchen write)
//   B) Batman price write (update_product) is server-authoritative for every role,
//      incl. body.role escalation, explicitConfirm abuse, idempotency + audit trail
//   C) Employee shifts (open/close_employee_shift) are server-authoritative + audited
//   D) Secret isolation: no renderer-supplied OpenAI key is honoured, status leaks nothing
//   E) Profit isolation: /api/auth/permissions is server-first (wildcard / reports.read)
//   F) Renderer engine: localStorage role cannot escalate; no local write before the server decides;
//      Ollama works with zero OpenAI configuration and provider failures are explicit codes
// Usage: node test/p0-authority-rbac-secrets.cjs   (requires `npm run build` first)
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
const DEVICE_KEY = 'p0-device-key-789';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-p0-'));
    const dbPath = path.join(tmp, 'p0.db');
    process.env.DB_PATH = dbPath;

    const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
    const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
    await dbMod.initDb();
    const run = (sql, params = []) => dbMod.execute(sql, params);

    // اتصال قراءة مستقل (الخادم يملك اتصاله الخاص بعد الإقلاع)
    const Database = require(path.join(BACKEND, 'node_modules', 'better-sqlite3'));
    let reader = null;
    const one = (sql, params = []) => {
      if (!reader) reader = new Database(dbPath, { readonly: true, timeout: 5000 });
      return reader.prepare(sql).get(...(params || []));
    };

    const mkUser = (username, role) => {
      const pw = authMod.hashPassword(username + '#2026');
      run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)', [username, pw, username, role, 1, 0]);
    };
    mkUser('adminp0', 'admin');
    mkUser('managerp0', 'manager');
    mkUser('cashierp0', 'cashier');
    mkUser('kitchenp0', 'kitchen');
    run('INSERT INTO products (name, price, cost, categoryId, available) VALUES (?,?,?,?,?)', ['قهوة P0', 100, 40, 1, 1]);
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

    async function login(username, password) {
      const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      return j.token || null;
    }
    const as = (token) => ({ Authorization: `Bearer ${token}` });
    const asDevice = () => ({ 'x-api-key': DEVICE_KEY });
    async function api(method, p, body, headers) {
      const res = await fetch(BASE + p, {
        method, headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: body !== undefined && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await res.json(); } catch { /* non-json */ }
      return { status: res.status, j, text: await res.text().catch(() => '') };
    }
    const skippedFor = (j, store) => {
      const details = (j && j.log && Array.isArray(j.log.conflictDetail)) ? j.log.conflictDetail : [];
      return details.some((d) => d && d.store === store && String(d.reason || '').indexOf('صلاحية') !== -1);
    };

    const gAdmin = await login('adminp0', 'adminp0#2026');
    const gManager = await login('managerp0', 'managerp0#2026');
    const gCashier = await login('cashierp0', 'cashierp0#2026');
    const gKitchen = await login('kitchenp0', 'kitchenp0#2026');
    record('إعداد جلسات الأدوار الأربعة', !!(gAdmin && gManager && gCashier && gKitchen), `tokens=${!!gAdmin}/${!!gManager}/${!!gCashier}/${!!gKitchen}`);

    const exec = (action, params, headers, extra) => api('POST', '/api/batman/execute', Object.assign({ action, params }, extra || {}), headers);

    // ======================= A) products sync closure (C2) =======================
    const prodRow = (i, price) => ({ syncId: `p0-prod-${i}`, name: 'منتج متزامن ' + i, price, cost: 10, categoryId: 1, available: 1, updatedAt: '2026-09-10' });
    let r = await api('POST', '/api/sync', { products: [prodRow(1, 11)] }, as(gCashier));
    record('A1: cashier+sync → products write مرفوضة (products.write)', r.status === 200 && skippedFor(r.j, 'products'), `skip=${r.j && r.j.log && r.j.log.skipped} ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { products: [prodRow(2, 12)] }, as(gKitchen));
    record('A2: kitchen+sync → products write مرفوضة', r.status === 200 && skippedFor(r.j, 'products'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { products: [prodRow(3, 13)] }, asDevice());
    record('A3: device+sync → products write مرفوضة', r.status === 200 && skippedFor(r.j, 'products'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { products: [prodRow(4, 14)] }, as(gManager));
    record('A4: manager+sync → products write مقبولة', r.status === 200 && r.j.log.inserted === 1 && !skippedFor(r.j, 'products'), `ins=${r.j && r.j.log && r.j.log.inserted}`);
    r = await api('POST', '/api/sync', { products: [prodRow(5, 15)] }, as(gAdmin));
    record('A5: admin+sync → products write مقبولة', r.status === 200 && r.j.log.inserted === 1, `ins=${r.j && r.j.log && r.j.log.inserted}`);

    // ======================= B) price write authority (C1) =======================
    const productId = () => one('SELECT id FROM products WHERE name = ?', ['قهوة P0']).id;
    const priceNow = () => one('SELECT price FROM products WHERE name = ?', ['قهوة P0']).price;

    r = await exec('update_product', { id: productId(), price: 500 }, as(gManager));
    record('B1: manager → update_product executed والسعر على الخادم تغيّر', r.status === 200 && r.j.decision === 'executed' && Number(priceNow()) === 500, `decision=${r.j && r.j.decision} price=${priceNow()}`);

    r = await exec('update_product', { id: productId(), price: 7 }, as(gCashier));
    record('B2: cashier → blocked والسعر لم يتغيّر', r.status === 200 && r.j.decision === 'blocked' && Number(priceNow()) === 500, `decision=${r.j && r.j.decision} price=${priceNow()}`);

    r = await exec('update_product', { id: productId(), price: 8 }, as(gKitchen));
    record('B3: kitchen → blocked والسعر لم يتغيّر', r.status === 200 && r.j.decision === 'blocked' && Number(priceNow()) === 500, `decision=${r.j && r.j.decision}`);

    r = await exec('update_product', { id: productId(), price: 9, role: 'admin' }, as(gCashier));
    record('B4: cashier + body.role=admin → blocked (لا تصعيد عبر body)', r.status === 200 && r.j.decision === 'blocked' && Number(priceNow()) === 500, `decision=${r.j && r.j.decision} price=${priceNow()}`);

    r = await exec('update_product', { id: productId(), price: 10 }, as(gCashier), { explicitConfirm: true });
    record('B5: cashier + explicitConfirm → blocked (التأكيد لا يرفع الصلاحية)', r.status === 200 && r.j.decision === 'blocked' && Number(priceNow()) === 500, `decision=${r.j && r.j.decision}`);

    r = await exec('update_product', { id: productId(), price: 600 }, as(gManager), { explicitConfirm: true, eventId: 'p0-price-confirm-1' });
    record('B6: manager + explicitConfirm → executed (تأكيد صريح مسموح للمدير)', r.status === 200 && r.j.decision === 'executed' && Number(priceNow()) === 600, `decision=${r.j && r.j.decision} price=${priceNow()}`);

    r = await exec('update_product', { id: productId(), price: 999 }, as(gManager), { explicitConfirm: true, eventId: 'p0-price-confirm-1' });
    record('B7: نفس eventId → alreadyExecuted بلا تنفيذ ثانٍ', r.status === 200 && r.j.alreadyExecuted === true && Number(priceNow()) === 600, `already=${r.j && r.j.alreadyExecuted} price=${priceNow()}`);

    r = await exec('update_product', { id: productId(), price: 700 }, asDevice());
    record('B8: device (صلاحية apparatus فقط) → blocked للسعر', r.status === 200 && r.j.decision === 'blocked' && Number(priceNow()) === 600, `decision=${r.j && r.j.decision}`);

    r = await api('GET', '/api/batman/decisions?limit=50', undefined, as(gAdmin));
    const auditRows = (r.j && r.j.decisions) || [];
    const priceAudit = auditRows.filter((d) => d.action === 'products.update');
    record('B9: سجل التدقيق يحوي blocked (كاشير) وexecuted (مدير) للسعر', priceAudit.some((d) => d.decision === 'blocked' && d.actorRole === 'cashier') && priceAudit.some((d) => d.decision === 'executed' && d.actorRole === 'manager'), `rows=${priceAudit.length}`);

    // ======================= C) employee shifts authority (C1) =======================
    const empId = (username) => one('SELECT id FROM users WHERE username = ?', [username]).id;
    const shiftRows = () => one('SELECT COUNT(*) AS c FROM shifts').c;

    const empCashier = empId('cashierp0');
    const before = shiftRows();
    r = await exec('open_employee_shift', { employeeId: empCashier }, as(gCashier));
    record('C1: cashier → open_employee_shift blocked (شifts.write)', r.status === 200 && r.j.decision === 'blocked' && shiftRows() === before, `decision=${r.j && r.j.decision} rows=${shiftRows()}`);

    r = await exec('open_employee_shift', { employeeId: empCashier, role: 'admin' }, as(gCashier));
    record('C2: cashier + body.role=admin → blocked (لا تصعيد)', r.status === 200 && r.j.decision === 'blocked' && shiftRows() === before, `decision=${r.j && r.j.decision}`);

    r = await exec('open_employee_shift', { employeeId: empCashier }, as(gKitchen));
    record('C3: kitchen → open_employee_shift blocked', r.status === 200 && r.j.decision === 'blocked' && shiftRows() === before, `decision=${r.j && r.j.decision}`);

    r = await exec('open_employee_shift', { employeeId: empCashier }, as(gManager));
    record('C4: manager → open_employee_shift executed وصف في SQLite', r.status === 200 && r.j.decision === 'executed' && shiftRows() === before + 1, `decision=${r.j && r.j.decision} rows=${shiftRows()}`);

    r = await exec('open_employee_shift', { employeeId: empCashier }, as(gManager));
    record('C5: فتح مكرر → خطأ من الخادم (لا صف ثانٍ)', r.status >= 400 && shiftRows() === before + 1, `status=${r.status} rows=${shiftRows()}`);

    r = await exec('close_employee_shift', { employeeId: empCashier }, as(gCashier));
    record('C6: cashier → close_employee_shift blocked والوردية ما زالت نشطة', r.status === 200 && r.j.decision === 'blocked' && String(one('SELECT status FROM shifts WHERE employeeId = ? ORDER BY id DESC LIMIT 1', [empCashier]).status) === 'active', `decision=${r.j && r.j.decision}`);

    r = await exec('close_employee_shift', { employeeId: empCashier }, as(gManager));
    record('C7: manager → close_employee_shift executed والصف مغلق على الخادم', r.status === 200 && r.j.decision === 'executed' && String(one('SELECT status FROM shifts WHERE employeeId = ? ORDER BY id DESC LIMIT 1', [empCashier]).status) === 'closed', `decision=${r.j && r.j.decision}`);

    r = await api('GET', '/api/batman/decisions?limit=50', undefined, as(gAdmin));
    const shiftAudit = ((r.j && r.j.decisions) || []).filter((d) => String(d.action).indexOf('shifts.employee_') === 0);
    record('C8: سجل التدقيق يحوي فتح/إغلاق وردية الموظف', shiftAudit.some((d) => d.decision === 'executed') && shiftAudit.some((d) => d.decision === 'blocked'), `rows=${shiftAudit.length}`);

    // ======================= D) secret isolation (C3) =======================
    r = await api('GET', '/api/proxy-llm/status');
    record('D1: status بلا هوية → 401', r.status === 401, `status=${r.status}`);

    r = await api('GET', '/api/proxy-llm/status', undefined, as(gAdmin));
    const leakKey = 'sk-p0-renderer-leak-1234567890';
    const statusText = JSON.stringify(r.j || {});
    record('D2: status للمدير يعطي bool فقط (لا سرّ)', r.status === 200 && r.j.openaiConfigured === false && statusText.indexOf(leakKey) === -1 && !/sk-[A-Za-z0-9]/.test(statusText), `body=${statusText}`);

    r = await api('POST', '/api/proxy-llm', { target: 'openai', key: leakKey, messages: [{ role: 'user', content: 'hi' }] }, as(gAdmin));
    const proxyText = JSON.stringify(r.j || {});
    record('D3: مفتاح من الواجهة يُتجاهل (لا OPENAI_API_KEY على الخادم) بلا تسريب', r.status === 400 && proxyText.indexOf(leakKey) === -1 && /OPENAI_API_KEY/.test(proxyText), `status=${r.status} msg=${(r.j && r.j.error || '').slice(0, 90)}`);

    r = await api('POST', '/api/proxy-llm', { target: 'openai', key: leakKey, messages: [{ role: 'user', content: 'hi' }] });
    record('D4: بلا هوية على البروكسي → 401 (لا مسار مفتوح)', r.status === 401, `status=${r.status}`);

    const adapterSrc = fs.readFileSync(path.join(ROOT, 'ollama-adapter.js'), 'utf8');
    const engineSrc = fs.readFileSync(path.join(ROOT, 'ai-pos-engine.js'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    record('D5: لا كتابة مفتاح OpenAI في localStorage (adapter)', !/kSet\(\s*'luccaOpenAIKey'/.test(adapterSrc) && !/localStorage\.setItem\(\s*'luccaOpenAIKey'/.test(adapterSrc), '');
    record('D6: getOpenAIKey لا يُعيد سرّاً + setOpenAIKey يرفض', /function getOpenAIKey\(\)\s*\{\s*return '';/.test(adapterSrc) && /function setOpenAIKey\([^)]*\)\s*\{\s*return false;/.test(adapterSrc), '');
    record('D7: لا اتصال مباشر لـ OpenAI من الواجهة (Bearer/chat/completions)', !/Authorization['\"]?\s*:\s*['\"]Bearer ['\"]\s*\+/.test(adapterSrc) && !/\$\{base\}\/chat\/completions/.test(adapterSrc), '');
    record('D8: لا openAIKeyMasked يكشف مقطع المفتاح', !/openAIKeyMasked:\s*hasOpenAI\(\)\s*\?/.test(adapterSrc), '');
    record('D9: index.html لا يستدعي setOpenAIKey (لا إدخال مفتاح من الدردشة)', !/setOpenAIKey\(/.test(indexSrc), '');
    record('D10: لا مفتاح يُرسل في جسم طلب البروكسي', !/target:\s*'openai',\s*\n\s*key:/.test(adapterSrc), '');

    // ======================= E) profit isolation (C4) =======================
    r = await api('GET', '/api/auth/permissions', undefined, as(gCashier));
    record('E1: كاشير: بلا wildcard وبلا reports.read', r.status === 200 && r.j.wildcard === false && r.j.permissions.indexOf('reports.read') === -1, JSON.stringify(r.j && r.j.permissions));
    r = await api('GET', '/api/auth/permissions', undefined, as(gKitchen));
    record('E2: مطبخ: بلا wildcard وبلا reports.read', r.status === 200 && r.j.wildcard === false && r.j.permissions.indexOf('reports.read') === -1, JSON.stringify(r.j && r.j.permissions));
    r = await api('GET', '/api/auth/permissions', undefined, as(gManager));
    record('E3: مدير: reports.read موجودة (يُسمح بتقرير مالي)', r.status === 200 && r.j.permissions.indexOf('reports.read') >= 0, JSON.stringify(r.j && r.j.permissions));
    r = await api('GET', '/api/auth/permissions', undefined, as(gAdmin));
    record('E4: أدمن: wildcard (يُسمح بالربح الصافي)', r.status === 200 && r.j.wildcard === true, JSON.stringify(r.j));
    record('E5: buildLiveContext يحجب todayRevenue/totalRevenue بلا صلاحية', /function buildLiveContext\(allowFinancials\)/.test(indexSrc) && /const _money = !!allowFinancials;/.test(indexSrc) && /ctx\.financials = 'redacted'/.test(indexSrc) && /if\(_money\)\{[\s\S]{0,400}ctx\.todayRevenue/.test(indexSrc) && /if\(_money\)\{[\s\S]{0,600}ctx\.totalRevenue/.test(indexSrc), '');
    record('E6: prompt لا يطلب حساب الربح إلا لمصرّح', /canSeeMoney[\s\S]{0,200}اجمع الربح/.test(indexSrc) && /الأرقام المالية غير مُتاحة في هذا السياق/.test(indexSrc), '');
    record('E7: القدرات تأتي من الخادم (serverCaps) لا من localStorage', /async serverCaps\(\)/.test(engineSrc) && /canViewReports: !!c\.ok/.test(engineSrc) && /canViewNetProfit: !!c\.ok && !!c\.wildcard/.test(engineSrc), '');

    // ======================= F) renderer engine (localStorage escalation + no local write) =====
    const calls = { productUpdate: [], shiftStart: 0, shiftEnd: 0, openai: 0, ollama: 0, proxy: 0 };
    const fakeProducts = [{ id: productId(), name: 'قهوة P0', nameAr: 'قهوة P0', price: Number(priceNow()) }];
    const store = (init) => {
      const m = new Map(Object.entries(init || {}));
      return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
    };
    function makeEngine(sessionToken, currentUser) {
      const ls = store({ luccaServerUrl: BASE, currentUser: JSON.stringify(currentUser) });
      const ss = store({ luccaToken: sessionToken });
      const win = {
        localStorage: ls, sessionStorage: ss,
        LuccaDB: {
          Products: { getActive: async () => fakeProducts, update: async (id, data) => { calls.productUpdate.push({ id, data, role: currentUser.role }); return id; } },
          Shifts: { start: async (id) => { calls.shiftStart++; return id; }, end: async (id) => { calls.shiftEnd++; return id; } },
          Users: { getCurrentUser: () => currentUser },
          AuditLogs: { log: async () => 0 },
          BotMemory: { add: async () => 0, logInteraction: async () => 0 },
          Orders: { getAll: async () => [] },
          db: { getAll: async () => [] },
        },
        console, setTimeout, clearTimeout, AbortController, Date, Math, JSON, fetch,
      };
      win.window = win;
      const ctx = vm.createContext(win);
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'ai-pos-engine.js'), 'utf8'), ctx, { filename: 'ai-pos-engine.js' });
      return { engine: win.aiPosEngine, ls, ss };
    }

    // F1: كاشير — لا كتابة محلية إطلاقاً
    calls.productUpdate.length = 0;
    let e = makeEngine(gCashier, { id: empCashier, name: 'كاشير', role: 'cashier' });
    let out = await e.engine.updateProductPrice(productId(), 1111, 'تعديل سعر قهوة P0 1111');
    record('F1: كاشير → updateProductPrice مرفوض + صفر كتابة محلية', out.success === false && out.code === 'BLOCKED' && calls.productUpdate.length === 0, `code=${out.code} localWrites=${calls.productUpdate.length}`);

    // F2: تصعيد عبر localStorage.currentUser.role = admin — لاServer يقبل
    e = makeEngine(gCashier, { id: empCashier, name: 'مزيّف', role: 'admin' });
    out = await e.engine.updateProductPrice(productId(), 2222, 'تعديل سعر قهوة P0 2222');
    record('F2: localStorage role=admin مع جلسة كاشير → blocked + صفر كتابة محلية', out.success === false && out.code === 'BLOCKED' && calls.productUpdate.length === 0, `code=${out.code}`);

    // F3: تصعيد عبر body.role في renderer — الـengine لا يرسل role أصلاً
    e = makeEngine(gCashier, { id: empCashier, name: 'كاشير', role: 'cashier' });
    out = await e.engine.updateProductPrice(productId(), 3333, 'تعديل سعر قهوة P0 3333');
    const serverPriceAfterAttempts = priceNow();
    record('F3: renderer لا يرسل role للخادم والسعر على الخادم ثابت', serverPriceAfterAttempts === 600 && out.success === false, `price=${serverPriceAfterAttempts}`);

    // F4: الوردية — كاشير بلا كتابة محلية
    calls.shiftStart = 0;
    e = makeEngine(gCashier, { id: empCashier, name: 'كاشير', role: 'cashier' });
    out = await e.engine.manageEmployeeShift('start', empCashier, 'do_shift_start_' + empCashier);
    record('F4: كاشير → manageEmployeeShift blocked + صفر Shifts.start', out.success === false && out.code === 'BLOCKED' && calls.shiftStart === 0, `code=${out.code} localStarts=${calls.shiftStart}`);

    // F5: مدير — تنفيذ على الخادم ثم إسقاط محلي (cache فقط)
    const empManager = empId('managerp0');
    calls.productUpdate.length = 0;
    e = makeEngine(gManager, { id: empManager, name: 'مدير', role: 'manager' });
    out = await e.engine.updateProductPrice(productId(), 1234, 'تعديل سعر قهوة P0 1234');
    record('F5: مدير → success + الخادم هو المرجع + إسقاط محلي واحد', out.success === true && Number(priceNow()) === 1234 && calls.productUpdate.length === 1, `price=${priceNow()} localWrites=${calls.productUpdate.length}`);

    calls.shiftStart = 0;
    out = await e.engine.manageEmployeeShift('start', empManager, 'do_shift_start_' + empManager);
    record('F6: مدير → manageEmployeeShift executed (صف جديد على الخادم)', out.success === true && calls.shiftStart === 1 && Number(shiftRows()) === before + 2, `rows=${shiftRows()} localStarts=${calls.shiftStart}`);

    // F7: انقطاع الخادم = رفض (fail-closed) بلا كتابة محلية
    calls.productUpdate.length = 0;
    const deadWin = makeEngine(gManager, { id: empManager, name: 'مدير', role: 'manager' });
    deadWin.ls.setItem('luccaServerUrl', 'http://127.0.0.1:1');
    out = await deadWin.engine.updateProductPrice(productId(), 4321, 'تعديل سعر قهوة P0 4321');
    record('F7: الخادم غير متاح → رفض (fail-closed) + صفر كتابة محلية', out.success === false && out.code === 'BACKEND_UNAVAILABLE' && calls.productUpdate.length === 0, `code=${out.code} localWrites=${calls.productUpdate.length}`);

    // F8: Ollama يعمل بدون أي إعداد OpenAI (stub يخدم /api/chat محلياً)
    const olCalls = { openaiHits: 0, ollamaHits: 0, bodies: [] };
    function ollamaFetch(url, init) {
      const u = String(url);
      if (u.indexOf('api.openai.com') >= 0) { olCalls.openaiHits++; return Promise.reject(new Error('blocked direct openai')); }
      // Ollama "شغّال" على هذا العنوان فقط — أي عنوان آخر = الخدمة متوقفة
      if (u.indexOf('http://ollama.local:11434') !== 0) return Promise.reject(new Error('connect ECONNREFUSED ' + u));
      if (u.indexOf('/api/tags') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen2.5:3b' }] }) });
      }
      if (u.indexOf('/api/chat') >= 0) {
        olCalls.ollamaHits++;
        olCalls.bodies.push(init && init.body);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ message: { content: 'رد محلي من Qwen' } }) });
      }
      return Promise.reject(new Error('no route ' + u));
    }
    function makeAdapter(provider) {
      const ls = store({ luccaServerUrl: BASE, luccaAIProvider: provider, luccaOllamaHost: 'http://ollama.local:11434', luccaOpenAIKey: leakKey });
      const win = { localStorage: ls, sessionStorage: store({}), console, setTimeout, clearTimeout, AbortController, Date, Math, JSON, fetch: ollamaFetch };
      win.window = win;
      const ctx = vm.createContext(win);
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'ollama-adapter.js'), 'utf8'), ctx, { filename: 'ollama-adapter.js' });
      return { ai: win.OllamaAI, ls };
    }
    let a = makeAdapter('ollama');
    let chatOut = await a.ai.chat('system', 'مرحبا', {});
    record('F8: Ollama يعمل بدون مفتاح OpenAI (stub محلي)', chatOut.ok === true && chatOut.text === 'رد محلي من Qwen' && olCalls.openaiHits === 0, `ok=${chatOut.ok} openaiHits=${olCalls.openaiHits}`);

    record('F9: مفتاح قديم في localStorage يُمحى عند التحميل', a.ls.getItem('luccaOpenAIKey') === null, `value=${a.ls.getItem('luccaOpenAIKey')}`);
    record('F10: setOpenAIKey يرفض التخزين', a.ai.setOpenAIKey('sk-abc') === false && a.ls.getItem('luccaOpenAIKey') === null, '');
    record('F11: getOpenAIKey لا يُعيد مفتاحاً', a.ai.getOpenAIKey() === '', '');

    // F12: Ollama متوقف + وضع ollama ⇒ خطأ واضح (لا "ما فهمت")
    a = makeAdapter('ollama');
    a.ai.setOllamaHost('http://127.0.0.1:1');
    chatOut = await a.ai.chat('system', 'مرحبا', {});
    record('F12: Ollama غير متاح ⇒ code=OLLAMA_ERROR صريح', chatOut.ok === false && !!chatOut.code, `code=${chatOut.code} err=${(chatOut.error || '').slice(0, 60)}`);

    // F13: llmEnabled/llmReady في وضع ollama لا يعتمدان على OpenAI إطلاقاً
    a = makeAdapter('ollama');
    a.ai.setOllamaHost('http://127.0.0.1:1');
    const readyOllamaDown = await a.ai.llmReady();
    record('F13: llmReady في وضع ollama (Ollama متوقف) = false بلا OpenAI', readyOllamaDown === false, `ready=${readyOllamaDown}`);
    a = makeAdapter('ollama');
    record('F13b: llmReady في وضع ollama (Ollama يعمل) = true', (await a.ai.llmReady()) === true, '');
    a = makeAdapter('ollama');
    a.ai.setOllamaHost('http://127.0.0.1:1');
    const chatNoOllama = await a.ai.chat('s', 'u', {});
    record('F13c: chat في وضع ollama لا يحاول OpenAI إطلاقاً', chatNoOllama.ok === false && chatNoOllama.code === 'OLLAMA_UNREACHABLE' && olCalls.openaiHits === 0, `code=${chatNoOllama.code} openaiHits=${olCalls.openaiHits}`);

    // F14: index.html يعرض سبب فشل المزوّد بدل "ما فهمت"
    record('F14: رسالة خطأ المزوّد صريحة في الشات', /تعذّر الحصول على رد من الذكاء الاصطناعي/.test(indexSrc) && /OPENAI_NOT_CONFIGURED/.test(indexSrc) && /NO_PROVIDER/.test(indexSrc), '');

    // ---------- summary ----------
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
      console.log('FAILED:');
      failed.forEach((f) => console.log('  - ' + f.name));
    }
  } catch (e) {
    console.log('FATAL  ' + (e && e.stack || e));
    results.push({ name: 'harness', ok: false });
  } finally {
    if (child) child.kill();
  }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
})();