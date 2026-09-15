const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const BACKEND_ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-guard-'));
  const dbPath = path.join(tmp, 'test.db');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), BACKUP_DIR: path.join(tmp, 'backups') },
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

    let r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    await check('login admin/123456 fresh → 200 mustChange:true',
      r.status === 200 && r.json?.mustChangePassword === true, JSON.stringify(r.json || r.status));
    const token = r.json.token;

    const blocked = ['/api/orders', '/api/users', '/api/settings', '/api/batman/permissions', '/api/daily-shifts', '/api/admin/backups', '/api/tables/1/lock'];
    for (const p of blocked) {
      r = await api('GET', p, null, token);
      await check(`GET ${p} → 403 block`, r.status === 403 && r.json?.error === 'Password change required (mustChangePassword)', `status=${r.status}`);
    }
    r = await api('POST', '/api/openai', { target: 'ollama', prompt: 'x' }, token);
    await check('POST /api/openai → 403 block', r.status === 403, `status=${r.status}`);
    r = await api('POST', '/api/sync', {}, token);
    await check('POST /api/sync → 403 block', r.status === 403, `status=${r.status}`);
    r = await api('GET', '/api/auth/me', null, token);
    await check('GET /api/auth/me → 200 (flow intact)', r.status === 200, `status=${r.status}`);

    r = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'testPass#2026' }, token);
    await check('PUT /api/auth/password → 200', r.status === 200, JSON.stringify(r.json || r.status));

    r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    await check('login admin/123456 after change → 401', r.status === 401, `status=${r.status}`);
    r = await api('POST', '/api/auth/login', { username: 'admin', password: 'testPass#2026' });
    await check('login new password → 200 mustChange:false', r.status === 200 && r.json?.mustChangePassword === false, JSON.stringify(r.json || r.status));
    const token2 = r.json.token;

    r = await api('GET', '/api/orders', null, token2);
    await check('GET /api/orders after change → 200', r.status === 200, `status=${r.status}`);
    r = await api('GET', '/api/users', null, token2);
    await check('GET /api/users after change → 200', r.status === 200, `status=${r.status}`);
  } catch (e) {
    results.push({ name: 'fatal error', pass: false, extra: String(e).slice(0, 300) });
  } finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup */ }
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  console.log('\n==== guard-regression results ====');
  for (const t of results) console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.name}${t.extra ? '  |  ' + t.extra : ''}`);
  console.log(`==== ${pass}/${results.length} passed, ${fail} failed ====`);
  process.exit(fail > 0 ? 1 : 0);
})();