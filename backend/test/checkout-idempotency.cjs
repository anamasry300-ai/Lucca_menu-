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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-idem-'));
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

    // 1) Admin session (unlock mustChangePassword)
    let r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    await check('login admin fresh → 200', r.status === 200, JSON.stringify(r.json || r.status));
    const token = r.json.token;
    r = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'testPass#2026' }, token);
    await check('change admin password → 200', r.status === 200, JSON.stringify(r.json || r.status));
    r = await api('POST', '/api/auth/login', { username: 'admin', password: 'testPass#2026' });
    await check('login new password → 200', r.status === 200 && r.json?.mustChangePassword === false, JSON.stringify(r.json || r.status));
    const token2 = r.json.token;

    // 2) Create an open order
    r = await api('POST', '/api/orders', {
      status: 'pending', paymentStatus: 'unpaid', items: '[]',
      subtotal: 250, tax: 0, total: 250, createdBy: 'idem-test',
      orderType: 'dine_in', tableId: '1',
    }, token2);
    await check('create order → 201/200', r.status === 200 || r.status === 201, `status=${r.status} ${JSON.stringify(r.json || {})} `);
    let orderId = r.json?.id;
    if (!orderId && Array.isArray(r.json) && r.json[0] && r.json[0].id) orderId = r.json[0].id;
    await check('order id obtained', !!orderId, `id=${orderId}`);

    // 3) First checkout with a stable paymentSyncId
    const PSID = 'idem-payment-sync-0001';
    r = await api('POST', `/api/orders/${orderId}/checkout`, { paymentMethod: 'cash', paymentSyncId: PSID }, token2);
    await check('checkout #1 (with paymentSyncId) → success', r.status === 200 && r.json?.success === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);

    // 4) Re-fire the SAME logical payment (offline-fallback retry) — must NOT double-book
    r = await api('POST', `/api/orders/${orderId}/checkout`, { paymentMethod: 'cash', paymentSyncId: PSID }, token2);
    await check('checkout #2 same paymentSyncId → alreadyProcessed (no duplicate)', r.status === 200 && r.json?.alreadyProcessed === true, `status=${r.status} ${JSON.stringify(r.json || {})}`);

    // 5) Exactly one payment row for the order
    r = await api('GET', '/api/payments', null, token2);
    const payments = r.json || {};
    const rows = Array.isArray(payments) ? payments : payments.rows || payments.data || [];
    const mine = rows.filter(p => String(p.orderId) === String(orderId) || p.syncId === PSID || p.paymentSyncId === PSID);
    await check('payments store has exactly 1 row for order', mine.length === 1, `count=${mine.length}`);

    // 6) A DIFFERENT paymentSyncId on the already-closed order → 409
    r = await api('POST', `/api/orders/${orderId}/checkout`, { paymentMethod: 'card', paymentSyncId: 'idem-payment-sync-0002' }, token2);
    await check('checkout with different syncId on closed order → 409', r.status === 409, `status=${r.status}`);
  } catch (e) {
    results.push({ name: 'fatal error', pass: false, extra: String(e).slice(0, 300) });
  } finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup */ }
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  console.log('\n==== checkout-idempotency results ====');
  for (const t of results) console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.name}${t.extra ? '  |  ' + t.extra : ''}`);
  console.log(`==== ${pass}/${results.length} passed, ${fail} failed ====`);
  process.exit(fail > 0 ? 1 : 0);
})();