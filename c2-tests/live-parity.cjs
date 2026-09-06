// ==== LIVE PARITY: يتحقق أن قرارات /api/sync الحي تطابق قرارات safe-sync-engine النقي ====
// يُعيد سيناريوهات المحرك (insert/update/skip/conflict) ضد السيرفر الحي ثم ينظّف كل ما كتبه.
// تشغيل: node c2-tests/live-parity.cjs   (يتطلب سيرفراً حياً على localhost:3000)
const { mergePush, sameData, newestWins } = require('./safe-sync-engine');
const BASE = process.env.SERVER_URL || 'http://localhost:3000';
const KEY  = process.env.SERVER_KEY  || 'lucca-secret-key';
const H = { 'Content-Type': 'application/json', 'x-api-key': KEY };

let passed = 0, failed = 0;
function record(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
  ok ? passed++ : failed++;
}
const uniq = (p) => p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const postSync = async (body) => {
  const r = await fetch(BASE + '/api/sync', { method: 'POST', headers: H, body: JSON.stringify(body) });
  return r.json();
};
const getCol = async (col) => {
  const r = await fetch(BASE + '/api/' + col, { headers: { 'x-api-key': KEY } });
  return r.json();
};

(async () => {
  if (!(await fetch(BASE + '/health')).ok) { console.error('السيرفر غير متاح على', BASE); process.exit(2); }

  const createdIds = [];

  // 1) INSERT: سجل جديد بلا وجود سابق
  {
    const syncId = uniq('p-insert');
    const row = { syncId, customerName: 'parity-insert', total: 10, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const engineExpect = mergePush(null, row).action;               // insert
    const res = await postSync({ orders: [row] });
    record('Parity-1 insert (engine=' + engineExpect + ')', res.log && res.log.inserted === 1 && engineExpect === 'insert', JSON.stringify(res.log || res));
    createdIds.push(['orders', syncId]);
  }

  // 2) UPDATE: أقدم ثم أحدث بنفس syncId (الفارق خارج نافذة الغموض)
  {
    const syncId = uniq('p-update');
    const t0 = new Date(Date.now() - 60000).toISOString();
    const t1 = new Date().toISOString();
    const oldR = { syncId, customerName: 'parity-u', total: 1, status: 'pending', createdAt: t0, updatedAt: t0 };
    const newR = { syncId, customerName: 'parity-u', total: 99, status: 'pending', createdAt: t0, updatedAt: t1 };
    const s0 = await postSync({ orders: [oldR] });                    // insert
    // المحرك: mergePush(oldRow, newR) => update لأن newer
    const st = newR; const lv = { updatedAt: t1 }; // محلي (المرسِل هو الجديد)
    const win = newestWins(oldR, newR);
    const engineExpect = win === 'local' ? 'update' : (sameData(oldR, newR) ? 'skip' : 'conflict');
    const res = await postSync({ orders: [newR] });
    record('Parity-2 update (engine=' + engineExpect + ', win=' + win + ', server updated=' + res.log.updated + ')',
      engineExpect === 'update' && res.log.updated === 1, JSON.stringify(res.log));
    createdIds.push(['orders', syncId]);
  }

  // 3) SKIP: إعادة إرسال نفس المحتوى => skip
  {
    const syncId = uniq('p-skip');
    const row = { syncId, customerName: 'parity-skip', total: 5, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await postSync({ orders: [row] });
    const s1 = await postSync({ orders: [row] });  // مطابق تماما
    const engineExpect = mergePush(row, row).action; // skip
    record('Parity-3 skip (engine=' + engineExpect + ')', engineExpect === 'skip' && s1.log && s1.log.skipped === 1, JSON.stringify(s1.log));
    createdIds.push(['orders', syncId]);
  }

  // 4) CONFLICT: تغيّر محتوى بدون updatedAt موثوق => conflict لا overwrite
  {
    const syncId = uniq('p-conflict');
    const t = new Date().toISOString();
    const a = { syncId, customerName: 'parity-conf-A', total: 20, status: 'pending', createdAt: t, updatedAt: t };
    const b = { syncId, customerName: 'parity-conf-B', total: 30, status: 'pending', createdAt: t, updatedAt: t }; // نفس النافذة => غموض
    await postSync({ orders: [a] });
    const r2 = await postSync({ orders: [b] });
    const engineExpect = mergePush(a, b).action; // conflict
    record('Parity-4 conflict (engine=' + engineExpect + ')',
      engineExpect === 'conflict' && r2.log.conflicts === 1 && r2.log.updated === 0,
      JSON.stringify(r2.log.conflictDetail || []));
    const rows = await getCol('orders');
    const arr = Array.isArray(rows) ? rows : rows.rows;
    const kept = arr.find(o => o.syncId === syncId);
    record('Parity-4b conflict يحافظ على النسخة الأولى', kept && Number(kept.total) === 20, 'total=' + (kept && kept.total));
    createdIds.push(['orders', syncId]);
  }

  // 5) إعادة ربط order_items عبر orderSyncId (مطابق للمحرك TEST6)
  {
    const osid = uniq('p-parent'); const isid = uniq('p-child');
    const t = new Date().toISOString();
    await postSync({ orders: [{ syncId: osid, customerName: 'parity-parent', total: 60, status: 'completed', createdAt: t, updatedAt: t }] });
    const r = await postSync({ order_items: [{ syncId: isid, orderSyncId: osid, name: 'parity-item', quantity: 1, unitPrice: 60, total: 60, status: 'served', createdAt: t, updatedAt: t }] });
    const orders = await getCol('orders'); const oArr = Array.isArray(orders) ? orders : orders.rows;
    const items = await getCol('order_items'); const iArr = Array.isArray(items) ? items : items.rows;
    const parent = oArr.find(o => o.syncId === osid);
    const child = iArr.find(i => i.syncId === isid);
    record('Parity-5 ربط orderSyncId (orderId=' + (child && child.orderId) + ' parent.id=' + (parent && parent.id) + ')',
      !!child && !!parent && child.orderId === parent.id, '');
    createdIds.push(['orders', osid]);
    createdIds.push(['order_items', isid]);
  }

  // ==== التنظيف الذاتي (admin) ====
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456' }) })).json();
  const AH = { 'x-api-key': KEY, 'Authorization': 'Bearer ' + (login.token || '') };
  let cleaned = 0;
  const colId = {};
  for (const [col, sid] of createdIds) {
    try {
      const rows = await getCol(col); const arr = Array.isArray(rows) ? rows : rows.rows;
      const row = arr.find(x => x.syncId === sid);
      if (row && row.id != null) {
        const d = await fetch(`${BASE}/api/${col}/${row.id}`, { method: 'DELETE', headers: AH });
        if (d.ok) { cleaned++; }
      }
    } catch { }
  }
  console.log('cleaned artifacts:', cleaned + '/' + createdIds.length);

  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
  process.exitCode = failed === 0 ? 0 : 1;
})().catch(e => { console.error('خطأ:', e); process.exitCode = 1; });