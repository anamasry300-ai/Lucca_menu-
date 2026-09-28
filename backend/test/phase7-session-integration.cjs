// PHASE 7 (2C-B): SECURE SESSION INTEGRATION
// A) auth endpoints: login → me → permissions → logout → token invalidation → expiry (SESSION_TTL_MS)
// B) main/session-manager.js (pure Node): token stays in main, session() never leaks secret,
//    apiRequest() enforces /api/ + method whitelist, injects Authorization for logged-in session.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const BACKEND_ROOT = path.join(__dirname, '..');
const SESSION_MANAGER = path.join(BACKEND_ROOT, '..', 'main', 'session-manager.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase7-'));
  const dbPath = path.join(tmp, 'test.db');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  // Short TTL verifies expiry=denial (K3: strict deny on stale/expired sessions).
  const ttlMs = '400';

  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), BACKUP_DIR: path.join(tmp, 'backups'), SESSION_TTL_MS: ttlMs },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });

  const results = [];
  async function check(name, cond, extra = '') { results.push({ name, pass: !!cond, extra }); return !!cond; }

  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`${base}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 400));

    async function api(method, p, body, token) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch { /* non-json */ }
      return { status: r.status, json: j };
    }

    // ── A) BACKEND AUTH CONTRACT ──────────────────────────────────────────────
    let r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    await check('A1 fresh login → 200 mustChange:true', r.status === 200 && r.json?.mustChangePassword === true, JSON.stringify(r.json || r.status));
    const tokenA = r.json.token;

    r = await api('GET', '/api/auth/permissions', null, tokenA);
    await check('A2 GET /api/auth/permissions (pre-change) → 200 wildcard admin', r.status === 200 && r.json?.role === 'admin' && r.json?.wildcard === true, JSON.stringify(r.json || r.status));

    r = await api('GET', '/api/auth/permissions');
    await check('A3 GET /api/auth/permissions no-auth → 401', r.status === 401, `status=${r.status}`);

    r = await api('PAT', '/api/auth/permissions', null, tokenA);
    await check('A4 unknown method → denied (>=400)', r.status >= 400 && r.status <= 599, `status=${r.status}`);

    r = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'phase7Pass#2026' }, tokenA);
    await check('A5 PUT /api/auth/password → 200', r.status === 200, JSON.stringify(r.json || r.status));

    r = await api('POST', '/api/auth/login', { username: 'admin', password: 'phase7Pass#2026' });
    await check('A6 login new password → 200 mustChange:false', r.status === 200 && r.json?.mustChangePassword === false, JSON.stringify(r.json || r.status));
    const tokenB = r.json.token;

    r = await api('GET', '/api/auth/me', null, tokenB);
    await check('A7 GET /api/auth/me → 200 role admin', r.status === 200 && r.json?.user?.role === 'admin', JSON.stringify(r.json || r.status));

    r = await api('GET', '/api/auth/permissions', null, tokenB);
    await check('A8 GET /api/auth/permissions (after change) → 200 role admin, username admin', r.status === 200 && r.json?.role === 'admin' && r.json?.username === 'admin', JSON.stringify(r.json || r.status));

    r = await api('POST', '/api/auth/logout', null, tokenB);
    await check('A9 POST /api/auth/logout → 200', r.status === 200, `status=${r.status}`);

    r = await api('GET', '/api/auth/me', null, tokenB);
    await check('A10 me after logout → 401 (token invalidated)', r.status === 401, `status=${r.status}`);

    // ── B) SESSION MANAGER (main-process proxy, pure Node) ────────────────────
    const Manager = require(SESSION_MANAGER).default || require(SESSION_MANAGER).SessionManager || require(SESSION_MANAGER);
    const Session = typeof Manager === 'function' ? new Manager() : Manager;
    Session.serverUrl = base;

    let sv = Session.session();
    await check('B1 fresh session → not authenticated, no token leaked', sv.authenticated === false && !('token' in sv), JSON.stringify(sv));

    const lg = await Session.login({ username: 'admin', password: 'phase7Pass#2026', serverUrl: base });
    await check('B2 SessionManager.login → ok, authenticated, user.admin', !!lg && !!lg.ok && Session.session().authenticated && Session.session().user?.role === 'admin', JSON.stringify(lg));

    sv = Session.session();
    await check('B3 session() exposes user+permissions, NEVER token', !!sv.user && !!sv.permissions && sv.permissions.wildcard === true && !('token' in sv) && !('_token' in sv) && !('_lastTokenAt' in sv), JSON.stringify(sv));

    const pm = await Session.apiRequest('GET', '/api/auth/permissions');
    await check('B4 apiRequest token-injection → 200', !!pm && pm.status === 200, JSON.stringify(pm && pm.status));

    const rej = await Session.apiRequest('GET', '/etc/passwd');
    await check('B5 apiRequest non-/api/ path → 400 rejected', !!rej && rej.status === 400, JSON.stringify(rej));

    const rej2 = await Session.apiRequest('TRACE', '/api/auth/me');
    await check('B6 apiRequest disallowed method → 405 rejected', !!rej2 && rej2.status === 405, JSON.stringify(rej2));

    const okGet = await Session.apiRequest('GET', '/api/orders');
    await check('B7 apiRequest GET /api/orders → 200 (guarded write path intact)', !!okGet && okGet.status === 200, JSON.stringify(okGet && okGet.status));

    // expiry: server-side short TTL (400ms) → token invalid; plus local TTL enforcement (K3 strict deny, no cached identity).
    await sleep(900);
    const exp = await Session.apiRequest('GET', '/api/auth/me');
    await check('B8 expired token → server rejects apiRequest 401', !!exp && exp.status === 401, JSON.stringify(exp && exp.status));

    const Session2 = new (typeof Manager === 'function' ? Manager : Object.getPrototypeOf(Manager).constructor)();
    Session2.serverUrl = base;
    const lg2 = await Session2.login({ username: 'admin', password: 'phase7Pass#2026', serverUrl: base });
    await check('B8b second login ok', !!lg2 && !!lg2.ok, JSON.stringify(lg2));
    const shortTtl = Object.getPrototypeOf(Session2);
    const ttlKey = Object.keys(Session2).find(k => k === '_ttlMs');
    Session2._ttlMs = 200; // local expiry shorter than server TTL
    await sleep(500);
    const exp2 = await Session2.apiRequest('GET', '/api/auth/me');
    await check('B9 local TTL → apiRequest denied 401 (no offline fallback)', !!exp2 && exp2.status === 401, JSON.stringify(exp2 && exp2.status));
    await check('B9b local TTL → session() no longer authenticated', Session2.session().authenticated === false, JSON.stringify(Session2.session()));
    /* eslint-disable no-unused-vars */
    const ttlKeyUnused = typeof ttlKey; void ttlKey;
  } catch (e) {
    results.push({ name: 'fatal error', pass: false, extra: String(e).slice(0, 400) });
  } finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup */ }
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  console.log('\n==== phase7-session-integration results ====');
  for (const t of results) console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.name}${t.extra ? '  |  ' + t.extra : ''}`);
  console.log(`==== ${pass}/${results.length} passed, ${fail} failed ====`);
  process.exit(fail > 0 ? 1 : 0);
})();