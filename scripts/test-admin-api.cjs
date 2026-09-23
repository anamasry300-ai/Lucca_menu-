const path = require('path');
require(path.join(__dirname, '..', 'admin', 'admin-api.js'));
const A = globalThis.AdminApi;
if (!A) { console.error('FAIL: AdminApi غير مضافة'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + ' = ' + JSON.stringify(actual) + ' (متوقع ' + JSON.stringify(expected) + ')'); }
}
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}

const mem = (init) => {
  const m = Object.assign({}, init || {});
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
};

A.use({ local: mem({}), session: mem({}) });

console.log('\nعناوين وتوكن:');
eq('baseUrl الافتراضي', A.baseUrl(), 'http://localhost:3000');
A.use({ local: mem({ luccaServerUrl: 'https://lucca.example:4000', luccaApiKey: 'ak1' }), session: mem({ luccaToken: 'tk1' }) });
eq('baseUrl مخصص', A.baseUrl(), 'https://lucca.example:4000');
eq('token من sessionStorage', A.token(), 'tk1');
eq('apiKey من localStorage', A.apiKey(), 'ak1');

console.log('\nالمصادقة:');
eq('authHeaders مع توكن', A.authHeaders(), { 'Content-Type': 'application/json', 'Authorization': 'Bearer tk1' });
A.use({ local: mem({ luccaServerUrl: '', luccaApiKey: 'ak1' }), session: mem({}) });
eq('authHeaders مع مفتاح فقط', A.authHeaders(), { 'Content-Type': 'application/json', 'x-api-key': 'ak1' });
eq('authHeaders دمج extra', A.authHeaders({ 'X-Test': '1' }), { 'Content-Type': 'application/json', 'x-api-key': 'ak1', 'X-Test': '1' });
ok('hasAuth صحيح مع توكن/مفتاح', A.hasAuth());
A.use({ local: mem({}), session: mem({}) });
ok('hasAuth خاطئ بدون', !A.hasAuth());

function withFetch(impl) {
  const prev = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = prev; };
}

console.log('\nrequest — نجاح JSON:');
{
  const restore = withFetch((url, cfg) => {
    ok('المسار يُمرَّر كما هو (بلا بادئة baseUrl)', url === '/api/cc/orders?page=1&pageSize=50');
    ok('الطريقة تُمرَّر', cfg.method === 'GET');
    ok('content-type مضبوط', cfg.headers['Content-Type'] === 'application/json');
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ rows: [1], total: 1 }) });
  });
  A.request('/api/cc/orders?page=1&pageSize=50', { method: 'GET' }).then((r) => {
    eq('مظروف نجاح JSON', r, { ok: true, status: 200, j: { rows: [1], total: 1 } });
    restore();
  });
}

console.log('\nrequest — نجاح نصي:');
{
  const restore = withFetch(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: () => Promise.resolve('pong') }));
  A.request('/api/auth/me', {}).then((r) => {
    eq('مظروف نجاح نصي', r, { ok: true, status: 200, j: 'pong' });
    restore();
  });
}

console.log('\nrequest — فشل شبكة:');
{
  const restore = withFetch(() => Promise.reject(new Error('net')));
  A.request('/api/cc/x', {}).then((r) => {
    eq('مظروف فشل الاتصال', r, { ok: false, status: 0, j: { error: 'تعذّر الاتصال بالخادم' }, net: true });
    restore();
  });
}

console.log('\nwrite — طريقة + جسم:');
{
  const restore = withFetch((url, cfg) => {
    ok('url كما هو', url === '/api/cc/expenses');
    ok('method POST', cfg.method === 'POST');
    eq('body JSON', cfg.body, JSON.stringify({ amount: 500 }));
    return Promise.resolve({ ok: true, status: 201, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ id: 7 }) });
  });
  A.write('POST', '/api/cc/expenses', { amount: 500 }).then((r) => {
    eq('مظروف كتابة', r, { ok: true, status: 201, j: { id: 7 } });
    restore();
  });
}

console.log('\nبدون مخازن (Node بلا localStorage):');
{
  A.use(null);
  const restore = withFetch(() => Promise.resolve({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ error: 'unauthorized' }) }));
  A.request('/api/auth/me', { headers: { Authorization: 'Bearer x' } }).then((r) => {
    eq('مظروف 401', r, { ok: false, status: 401, j: { error: 'unauthorized' } });
    ok('لم ينهار دون مخازن', A.token() === '' && A.apiKey() === '' && A.baseUrl() === 'http://localhost:3000');
    restore();
  });
}

setTimeout(() => {
  console.log('\nنسخ admin-api test — المدخُل: ' + pass + '/' + (pass + fail));
  process.exit(pass > 0 && fail === 0 ? 0 : 1);
}, 250);