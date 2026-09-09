// اختبار إضافة الموظفين عند عدم توفر الخادم (وضع منفصل/أوفلاين):
//  1) invite() مع بريد يجب أن توقع محلياً بدل الرمي (علامة local).
//  2) add() بدون بريد يجب أن تعمل محلياً.
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

// السيرفر معطّل تماماً — كل طلبات الشبكة تفشل فوراً (ECONNREFUSED).
global.fetch = () => Promise.reject(new TypeError('fetch failed (simulated offline)'));

require(path.join(__dirname, '..', 'admin', 'database.js'));
const L = global.window.LuccaDB;

(async () => {
  await L.db.init();

  const res = await L.Employees.invite({ name: 'Test Emp', email: 't@x.com', role: 'cashier', salary: 1000, phone: '111' });
  assert(res && res.local === true, 'expected local fallback marker');
  let all = await L.Employees.getAll();
  let emp = all.find(e => e.email === 't@x.com');
  assert(emp, 'employee with email must exist locally after invite fallback');
  assert.equal(emp.name, 'Test Emp');
  assert.equal(emp.salary, 1000);
  assert.equal(emp.active, true);

  const id = await L.Employees.add({ name: 'Test2', employeeCode: 'T2', role: 'waiter', salary: 500 });
  assert(id, 'local add should return an id');
  all = await L.Employees.getAll();
  assert.equal(all.length, 2, 'expected 2 employees locally');
  emp = all.find(e => e.employeeCode === 'T2');
  assert(emp && emp.role === 'waiter', 'second employee must exist locally');

  console.log('PASSED: employee invite/add work locally when server is unreachable');
  process.exit(0);
})().catch(e => { console.error('FAIL: ' + e.message + '\n' + e.stack); process.exit(1); });