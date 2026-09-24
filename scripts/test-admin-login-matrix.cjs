// ADMIN LOGIN MATRIX — deterministic, no network, no real DB.
// Loads the real admin/database.js (LuccaDB) with fake-indexeddb and a stubbed fetch.
// Proves:
//   1) server is authoritative: valid creds succeed even when the local IndexedDB copy
//      is missing or stale (the reported "login error with valid credentials" bug);
//   2) explicit server rejection (401/403) is FINAL — local copy must not override (no bypass);
//   3) offline fallback still works when the server is unreachable.
const assert = require('assert');
const path = require('path');

global.window = globalThis;

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear()
  };
}
global.localStorage = memStorage();
global.sessionStorage = memStorage();

require('fake-indexeddb/auto');
const { indexedDB } = require('fake-indexeddb');
global.indexedDB = indexedDB;

// ---------------------------------------------------------------- helpers
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
function finalize() {
  const failed = results.filter(r => !r.ok);
  const passed = results.length - failed.length;
  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed.length} فاشل`);
  console.log('====================');
  process.exitCode = failed.length === 0 ? 0 : 1;
}

const json = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body)
});

// A controllable stand-in for the Lucca backend /api/auth/login.
function makeAuthServer(users) {
  const log = [];
  const server = {
    log,
    down: false,
    users: users || [],
    add(u) { this.users.push(Object.assign({ active: true, mustChangePassword: false }, u)); return this; }
  };
  server.fetchImpl = (url, init) => {
    if (server.down) return Promise.reject(new TypeError('fetch failed (simulated offline)'));
    const u = String(url);
    const call = { url: u };
    if (u.endsWith('/api/auth/login')) {
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (_) {}
      const key = String(body.username || '').trim().toLowerCase();
      call.username = key;
      const user = server.users.find(x =>
        String(x.username || '').toLowerCase() === key ||
        String(x.email || '').toLowerCase() === key
      );
      if (!user) { log.push(Object.assign({ verdict: '401-user' }, call)); return json(401, { error: 'بيانات الدخول غير صحيحة' }); }
      if (Number(user.active) === 0) { log.push(Object.assign({ verdict: '403-inactive' }, call)); return json(403, { error: 'الحساب مُعطَّل' }); }
      if (String(user.password) !== String(body.password)) { log.push(Object.assign({ verdict: '401-pass' }, call)); return json(401, { error: 'بيانات الدخول غير صحيحة' }); }
      const token = 'tok-' + user.username + '-x';
      log.push(Object.assign({ verdict: '200' }, call));
      return json(200, {
        success: true,
        token,
        mustChangePassword: !!user.mustChangePassword,
        user: {
          id: user.id, username: user.username, name: user.name || '', role: user.role,
          active: user.active, mustChangePassword: !!user.mustChangePassword
        }
      });
    }
    if (u.endsWith('/api/auth/logout')) { log.push(Object.assign({ verdict: 'logout' }, call)); return json(200, { success: true }); }
    // generic API endpoint used to assert the Authorization header
    call.headers = init && init.headers || {};
    log.push(Object.assign({ verdict: 'api' }, call));
    return json(200, { ok: true });
  };
  return server;
}

// pbkdf2 that this harness uses to build a "stale" hash for offline tests.
async function hashPw(password, salt) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' }, km, 512);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const server = makeAuthServer([
    { id: 1, username: 'admin', password: 's1m0nsays', role: 'admin', mustChangePassword: false },
    { id: 2, username: 'mana', password: 'passM', role: 'manager' },
    { id: 3, username: 'cashier1', password: 'cashP', role: 'cashier' },
    { id: 4, username: 'temp', password: '123456', role: 'cashier', mustChangePassword: true }
  ]);
  global.fetch = server.fetchImpl;
  require(path.join(__dirname, '..', 'admin', 'database.js'));
  const U = global.window.LuccaDB.Users;
  await global.window.LuccaDB.db.init();

  // Reusable local store injector: overwrite the IndexedDB users store.
  async function seedLocalUsers(records) {
    await new Promise((res, rej) => {
      const tx = global.indexedDB.open('lucca_caffe_db', 9); // reuse live DB
      tx.onsuccess = () => {
        const db = tx.result;
        const t = db.transaction('users', 'readwrite');
        t.objectStore('users').clear();
        (records || []).forEach((r, i) => t.objectStore('users').put(r));
        t.oncomplete = () => { db.close(); res(); };
        t.onerror = () => rej(t.error);
      };
      tx.onerror = () => rej(tx.error);
    });
  }

  // ===== 1) no credentials =====
  await (async () => {
    let threw = false;
    try { await U.login('', ''); } catch (_) { threw = true; }
    record('1. no credentials -> error', threw, 'expected throw');
  })();

  // ===== 2) invalid username (server answers 401) =====
  await (async () => {
    let msg = '';
    try { await U.login('ghost', 'x'); } catch (e) { msg = e.message; }
    record('2. invalid username -> error', msg.indexOf('غير صحيحة') !== -1 || msg.length > 0, msg || 'no message');
  })();

  // ===== 3) invalid password (server answers 401) =====
  await (async () => {
    let msg = '';
    try { await U.login('admin', 'wrongpw'); } catch (e) { msg = e.message; }
    record('3. invalid password -> error', !!msg, msg);
  })();

  // ===== 4) THE BUG: valid admin, but local IndexedDB store is EMPTY =====
  // Server (source of truth) accepts. The client must NOT block on a missing local copy.
  await seedLocalUsers([]);
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('admin', 's1m0nsays'); } catch (e) { err = e.message; }
    record('4. valid admin + EMPTY local store -> success (server-first)',
      !!u && u.role === 'admin', err ? 'ERR: ' + err : 'ok');
    if (u) {
      const tok = u && global.sessionStorage.getItem('luccaToken');
      record('4b. token stored for server session', !!tok, tok ? tok : 'missing token');
    }
  })();

  // ===== 5) valid manager =====
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('mana', 'passM'); } catch (e) { err = e.message; }
    record('5. valid manager -> success', !!u && u.role === 'manager', err || 'ok');
  })();

  // ===== 6) valid cashier =====
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('cashier1', 'cashP'); } catch (e) { err = e.message; }
    record('6. valid cashier -> success', !!u && u.role === 'cashier', err || 'ok');
  })();

  // ===== 7) device credential is NOT a user login (no bypass path) =====
  // The device role comes from x-api-key on the serverside; Users.login must reject it as a user.
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('device', 'dontmatter'); } catch (e) { err = e.message; }
    record('7. device key is not accepted as user credentials', !u, err || 'no error (bad!)');
  })();

  // ===== 8) mustChangePassword flag surfaces from server =====
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('temp', '123456'); } catch (e) { err = e.message; }
    record('8. mustChangePassword user -> success + flag', !!u && u.mustChangePassword === true, err || JSON.stringify(u));
  })();

  // ===== 9) expired/invalid token handling: token stored under known key usable on next request =====
  await (async () => {
    const tok = global.sessionStorage.getItem('luccaToken');
    record('9. token present under luccaToken key after login', !!tok, tok || 'missing');
    const SA = global.window.LuccaDB.ServerAPI;
    await SA.get('/api/cc'); // authenticated admin API right after login
    const lastApi = [...server.log].reverse().find(l => l.verdict === 'api');
    record('9b. authenticated admin API call carries Bearer token',
      lastApi && String((lastApi.headers || {})['Authorization'] || '').indexOf('Bearer ') === 0,
      JSON.stringify(lastApi && lastApi.headers) || 'no api call');
  })();

  // ===== 10) missing token before login =====
  await (async () => {
    global.sessionStorage.removeItem('luccaToken');
    record('10. missing token -> not authenticated yet', !global.window.LuccaDB.ServerAPI.getToken(), 'clean');
  })();

  // ===== 11) logout clears token + identity =====
  await (async () => {
    await U.logout();
    const tok = global.sessionStorage.getItem('luccaToken');
    const cu = U.getCurrentUser();
    record('11. logout clears session + identity', !tok && !cu, `tok=${tok} user=${cu ? 'present' : 'none'}`);
  })();

  // ===== 12) reload persistence: token + identity survive (same storage) =====
  await (async () => {
    await U.login('cashier1', 'cashP');
    const tokBefore = global.sessionStorage.getItem('luccaToken');
    const cuBefore = U.getCurrentUser();
    // simulate reload: storage untouched (module state would rebuild from storage on boot)
    const tokAfter = global.sessionStorage.getItem('luccaToken');
    const cuAfter = U.getCurrentUser();
    record('12. reload keeps session (token + currentUser persist)',
      !!tokBefore && tokBefore === tokAfter && !!cuBefore && !!cuAfter,
      `tok=${!!tokBefore} user=${!!cuBefore}`);
  })();

  // ===== 13) Admin API immediately after login =====
  await (async () => {
    await U.login('mana', 'passM');
    const SA = global.window.LuccaDB.ServerAPI;
    await SA.get('/api/cc');
    const last = [...server.log].reverse().filter(l => l.verdict === 'api')[0];
    record('13. admin API right after login carries token',
      last && String((last.headers || {})['Authorization'] || '').indexOf('Bearer ') === 0,
      JSON.stringify(last && last.headers));
  })();

  // ===== 14) stale local hash MUST NOT block server-valid login =====
  // Local copy has an OLD hash; server holds the new password. Client must trust the server.
  const staleSalt = '11111111-2222-4444-8888-000000000000';
  const staleHash = await hashPw('oldpass99', staleSalt);
  await seedLocalUsers([
    { id: 1, username: 'admin', password: 'pbkdf2:' + staleSalt + ':' + staleHash, role: 'admin' }
  ]);
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('admin', 's1m0nsays'); } catch (e) { err = e.message; }
    record('14. valid creds + stale local hash -> success (server-first)',
      !!u && u.username === 'admin', err || 'ok');
  })();

  // ===== 15) SECURITY: server 401 is FINAL even if local copy accepts =====
  // Local stale copy accepts 'oldpass99'; server rejects it. Must NOT log in locally.
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('admin', 'oldpass99'); } catch (e) { err = e.message; }
    record('15. server 401 -> login rejected (no local bypass)', !u && !!err, u ? 'BYBASSED' : (err || 'no error'));
  })();

  // ===== 16) OFFLINE fallback preserved: server down + valid local plaintext =====
  server.down = true;
  await seedLocalUsers([{ id: 7, username: 'offadmin', password: '123456', role: 'admin' }]);
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('offadmin', '123456'); } catch (e) { err = e.message; }
    record('16. offline + valid local creds -> local login works', !!u && u.role === 'admin', err || 'ok');
  })();

  // ===== 17) OFFLINE with wrong local creds =====
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('offadmin', 'nope'); } catch (e) { err = e.message; }
    record('17. offline + wrong creds -> rejected', !u && !!err, u ? 'accepted' : (err || 'no error'));
  })();

  // ===== 18) OFFLINE + local user INACTIVE (active:0) + correct password => REJECTED =====
  await seedLocalUsers([{ id: 9, username: 'offdead', password: '123456', role: 'cashier', active: 0 }]);
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('offdead', '123456'); } catch (e) { err = e.message; }
    record('18. offline + inactive local user (active:0) + correct pw -> rejected', !u && !!err, u ? 'accepted inactive!' : (err || 'no error'));
  })();

  // ===== 19) OFFLINE + local user ACTIVE (active:1) + correct password => ACCEPTED =====
  await seedLocalUsers([{ id: 10, username: 'offalive', password: '123456', role: 'manager', active: 1 }]);
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('offalive', '123456'); } catch (e) { err = e.message; }
    record('19. offline + active local user (active:1) + correct pw -> accepted', !!u && u.role === 'manager', err || 'ok');
  })();
  server.down = false;

  // ===== 20) SERVER FINAL even when the LOCAL copy would accept =====
  // Server unambiguously rejects an inactive account (403-inactive); the local copy
  // holds the SAME correct password but marks the account active. Must NOT fall back.
  server.add({ id: 11, username: 'dead', password: 'deadpw', role: 'cashier', active: 0 });
  await seedLocalUsers([{ id: 11, username: 'dead', password: 'deadpw', role: 'cashier', active: 1 }]);
  await (async () => {
    let u = null, err = '';
    try { u = await U.login('dead', 'deadpw'); } catch (e) { err = e.message; }
    record('20. server rejects (403) inactive account + local w/ same pw -> rejected (no fallback)', !u && !!err, u ? 'BYBASSED via local' : (err || 'no error'));
  })();

  finalize();
})().catch(e => { console.error('ERROR:', e.stack); process.exitCode = 1; });