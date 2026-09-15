// Runtime smoke: boots the real compiled server against a temp DB and exercises
// the full auth lifecycle, analytics, batman decision gate, CRUD, and idempotent checkout.
// Usage: node test/runtime-smoke.cjs   (requires `npm run build` first)
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-smoke-'));
  const dbPath = path.join(tmp, 'smoke.db');
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
  function check(name, cond, extra = '') { results.push({ name, pass: !!cond, extra }); return !!cond; }

  let token = null;
  async function api(method, p, body, t) {
    const headers = { 'Content-Type': 'application/json' };
    if (t) headers.Authorization = `Bearer ${t}`;
    if (!t && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch { /* non-json */ }
    return { status: res.status, j };
  }

  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`${base}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 400));

    let r = await api('GET', '/health');
    await check('health → 200', r.status === 200, `status=${r.status}`);

    r = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
    const mustChange = r.j && r.j.mustChangePassword === true;
    token = r.j && r.j.token;
    await check('login admin (seed) → 200 mustChange', r.status === 200 && mustChange && !!token, `status=${r.status} mustChange=${mustChange}`);

    r = await api('PUT', '/api/auth/password', { currentPassword: '123456', newPassword: 'smokePass#2026' });
    await check('change password → 200', r.status === 200, `status=${r.status}`);

    r = await api('POST', '/api/auth/login', { username: 'admin', password: 'smokePass#2026' });
    token = r.j && r.j.token;
    await check('login new password → 200 mustChange:false', r.status === 200 && !r.j.mustChangePassword && !!token, `status=${r.status}`);

    r = await api('GET', '/api/auth/me');
    await check('GET /api/auth/me → 200', r.status === 200 && r.j.user && r.j.user.username === 'admin', `status=${r.status}`);

    r = await api('GET', '/api/dashboard/kpis');
    await check('analytics kpis → 200 (real, all zeros pre-orders)', r.status === 200 && r.j && typeof r.j.sales.value === 'number', `status=${r.status}`);

    r = await api('POST', '/api/batman/check', { action: 'place_order', role: 'admin' });
    await check('batman decision gate → 200 executed', r.status === 200 && r.j.decision === 'executed', `status=${r.status} decision=${r.j && r.j.decision}`);

    r = await api('POST', '/api/orders', {
      orderType: 'dine_in', tableId: '1',
      items: [{ productId: 1, name: 'قهوة', qty: 1, price: 250, subtotal: 250 }],
      subtotal: 250, tax: 0, discount: 0, discountAmount: 0, total: 250,
      paymentMethod: 'cash', createdBy: 'runtime-smoke',
    });
    const oid = r.j && r.j.id;
    await check('create order → 201', r.status === 201 && !!oid, `status=${r.status} id=${oid}`);

    r = await api('GET', '/api/orders');
    await check('GET /api/orders → 200 list', r.status === 200 && Array.isArray(r.j), `status=${r.status} count=${Array.isArray(r.j) ? r.j.length : '-'}`);

    r = await api('POST', `/api/orders/${oid}/checkout`, { paymentMethodId: 1, amount: 250, paymentSyncId: 'rtm-pay-1', orderSyncId: 'rtm-ord-1', changeAmount: 0 });
    await check('checkout → 200 closed', r.status === 200 && r.j.success && r.j.order.status === 'closed', `status=${r.status}`);

    r = await api('POST', `/api/orders/${oid}/checkout`, { paymentMethodId: 1, amount: 250, paymentSyncId: 'rtm-pay-1', orderSyncId: 'rtm-ord-1' });
    await check('checkout retry same paymentSyncId → alreadyProcessed', r.status === 200 && r.j.alreadyProcessed === true, `status=${r.status}`);

    // confirmed single payment row server-side
    const payments = await api('GET', '/api/payments');
    const rows = (payments.j || []).filter(p => String(p.orderId) === String(oid));
    await check('payments store has exactly 1 row for order', rows.length === 1, `count=${rows.length}`);

    r = await api('POST', `/api/orders/${oid}/checkout`, { paymentMethodId: 1, amount: 250, paymentSyncId: 'rtm-pay-2' });
    await check('different paymentSyncId on closed order → 409', r.status === 409, `status=${r.status}`);
  } catch (e) {
    results.push({ name: 'unexpected error', pass: false, extra: (e && e.message) || String(e) });
  }

  console.log(results.map(x => `  ${x.pass ? 'PASS' : 'FAIL'}  ${x.name}  |  ${x.extra}`).join('\n'));
  console.log(`==== ${results.filter(x => x.pass).length}/${results.length} passed, ${results.filter(x => !x.pass).length} failed ====`);
  child.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(results.some(x => !x.pass) ? 1 : 0);
})().catch(e => { console.log('ERROR', (e && e.stack) || e); process.exit(1); });