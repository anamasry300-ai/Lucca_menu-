// اختبار محوّل Supabase (supabase-db.js) — عميل وهمي في الذاكرة:
//  1) Employees.invite موجودة، وعند غياب ServerAPI تخلق الموظف وتُرجع {local:true}.
//  2) Shifts.start تحفظ shiftType/label، وgetToday/end تعمل.
const assert = require('assert');
const path = require('path');

global.window = globalThis;

// عميل Supabase وهمي (سلاسل select/insert/update/delete) يخزن صفوفاً في الذاكرة.
function makeFakeSupabase() {
  const stores = {};
  const nextId = {};
  function store(t) { if (!stores[t]) { stores[t] = []; nextId[t] = 1; } return stores[t]; }
  function from(table) {
    const list = store(table);
    const ctx = { filters: [], single: false };
    const base = {
      select() { return base; },
      eq(k, v) { ctx.filters.push([k, v]); return base; },
      single() { ctx.single = true; return base; },
      then(resolve) {
        let rows = list;
        for (const [k, v] of ctx.filters) rows = rows.filter(r => r[k] === v || String(r[k]) === String(v));
        if (ctx.single) rows = rows.length ? rows.slice(0, 1) : [];
        resolve({ data: rows.map(r => ({ ...r })), error: null });
      },
      insert(row) {
        const r = { ...row };
        if (r.id == null) r.id = nextId[table]++;
        list.push(r);
        const sub = { select() { return sub; }, single() { return sub; }, then(resolve) { resolve({ data: { ...r }, error: null }); } };
        return sub;
      },
      update(row) {
        const r = { ...row };
        const uctx = { filters: [] };
        const ub = {
          eq(k, v) { uctx.filters.push([k, v]); return ub; },
          then(resolve) {
            list.forEach(x => { if (uctx.filters.some(([k, v]) => x[k] === v || String(x[k]) === String(v))) Object.assign(x, r); });
            resolve({ error: null });
          }
        };
        return ub;
      },
      delete() {
        const dctx = { filters: [] };
        const db = {
          eq(k, v) { dctx.filters.push([k, v]); return db; },
          then(resolve) {
            const remove = list.filter(r => dctx.filters.some(([k, v]) => r[k] === v || String(r[k]) === String(v))).map(r => r.id);
            remove.forEach(id => { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); });
            resolve({ error: null });
          }
        };
        return db;
      }
    };
    return base;
  }
  return { stores, createClient: () => ({ from }) };
}

const fake = makeFakeSupabase();
global.supabase = { createClient: fake.createClient };
// بدون database.js هنا → لا يوجد window.ServerAPI → invite تتنازل للتخزين البعيد المباشر.

require(path.join(__dirname, '..', 'supabase-db.js'));
const L = global.window.LuccaDB;

(async () => {
  assert(L && L.Employees && typeof L.Employees.invite === 'function', 'Employees.invite must exist on Supabase adapter');
  assert(L.Shifts && typeof L.Shifts.getToday === 'function', 'Shifts.getToday must exist');

  // 1) دعوة موظف — بدون ServerAPI → local fallback.
  const inv = await L.Employees.invite({ name: 'علي', email: 'ali@x.com', role: 'cashier', salary: 800 });
  assert(inv && inv.local === true, 'invite must return {local:true} when server absent');
  let emps = await L.Employees.getAll();
  let ali = emps.find(e => e.name === 'علي');
  assert(ali && ali.email === 'ali@x.com', 'employee must be persisted: ' + JSON.stringify(emps));
  assert.equal(ali.active, true);

  // 2) الشيفت التلقائي (صباحي) + getToday + end.
  const shiftId = await L.Shifts.start(ali.id, 'صباحي (08:00–17:00)', { shiftType: 'morning', label: 'صباحي (08:00–17:00)' });
  assert(shiftId, 'shift start must return id');
  const today = new Date().toISOString().slice(0, 10);
  const shifts = await L.Shifts.getToday();
  assert.equal(shifts.length, 1, 'getToday must return today shift');
  const s = shifts[0];
  assert.equal(s.status, 'active');
  assert.equal(s.shiftType, 'morning');
  assert.equal(s.label, 'صباحي (08:00–17:00)');
  assert.equal(s.employeeId, ali.id);

  let dup = null;
  try { await L.Shifts.start(ali.id, 'تكرار'); } catch (e) { dup = e.message; }
  assert(dup && String(dup).includes('تم تسجيل شيفت'), 'duplicate start must throw');

  const ended = await L.Shifts.end(ali.id);
  assert(ended && ended.status === 'completed' && ended.hoursWorked >= 0, 'end must close shift with hours');

  console.log('PASSED: Supabase adapter Employees.invite + Shifts(start/type/today/end) work');
  process.exit(0);
})().catch(e => { console.error('FAIL: ' + e.message + '\n' + e.stack); process.exit(1); });