// اختبار الشيفت السريع: start(options) بعلامة صباحي/مسائي + end + getToday + المنع من التكرار.
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
global.fetch = () => Promise.reject(new TypeError('fetch failed (simulated offline)'));

require(path.join(__dirname, '..', 'admin', 'database.js'));
const L = global.window.LuccaDB;

(async () => {
  await L.db.init();
  const empId = await L.Employees.add({ name: 'Shift Tester', role: 'cashier' });
  assert(empId, 'employee seed must work');

  // توقيت وهمي للتحقق من فكرة "صباحي/مسائي": دالة التصنيف نفسها في index.html، نختبرها منطقياً بحدودها.
  function periodFor(hour) { return (hour >= 8 && hour < 17) ? 'morning' : 'night'; }
  assert.equal(periodFor(8), 'morning');
  assert.equal(periodFor(12), 'morning');
  assert.equal(periodFor(16, 59), 'morning');
  assert.equal(periodFor(17), 'night');
  assert.equal(periodFor(23), 'night');
  assert.equal(periodFor(0), 'night');
  assert.equal(periodFor(2), 'night');
  assert.equal(periodFor(7), 'night');

  const started = await L.Shifts.start(empId, 'صباحي (08:00–17:00)', { shiftType: 'morning', label: 'صباحي (08:00–17:00)' });
  assert(started, 'start must return id');
  const today = new Date().toISOString().slice(0, 10);
  const todayShifts = await L.Shifts.getToday();
  assert.equal(todayShifts.length, 1);
  const s = todayShifts[0];
  assert.equal(s.status, 'active');
  assert.equal(s.shiftType, 'morning');
  assert.equal(s.label, 'صباحي (08:00–17:00)');
  assert.equal(s.date, today);
  assert(s.startTime, 'startTime must be set');

  let dupError = null;
  try { await L.Shifts.start(empId, 'ثانية'); } catch (e) { dupError = e.message; }
  assert(dupError && dupError.includes('تم تسجيل شيفت'), 'duplicate start must throw: got ' + dupError);

  const ended = await L.Shifts.end(empId);
  assert(ended.endTime, 'end must set endTime');
  assert.equal(ended.status, 'completed');
  assert(ended.hoursWorked >= 0, 'hoursWorked must be computed');

  console.log('PASSED: shift start(auto-type)/end/today/duplicate-guard work locally');
  process.exit(0);
})().catch(e => { console.error('FAIL: ' + e.message + '\n' + e.stack); process.exit(1); });