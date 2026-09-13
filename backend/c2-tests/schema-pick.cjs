const Database = require('better-sqlite3');
const fs = require('node:fs');
const list = (process.env.CAND_LIST_FILE && fs.existsSync(process.env.CAND_LIST_FILE))
  ? fs.readFileSync(process.env.CAND_LIST_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  : (JSON.parse(process.env.CAND_LIST || '[]'));
for (const f of list) {
  let db;
  try { db = new Database(f, { readonly: true }); } catch (e) { console.log('OPEN_FAIL ' + f + ' :: ' + e.message); continue; }
  try {
    const ord = db.prepare(`SELECT name FROM pragma_table_info('orders')`).all().map(r => r.name);
    const ci = db.prepare(`SELECT name FROM pragma_table_info('order_items')`).all().map(r => r.name);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name IN ('ux_order_items_syncId','ux_order_items_orderSyncId')`).all().map(r => r.name);
    console.log('CHECK ' + f);
    console.log('  orders.deviceId=' + ord.includes('deviceId') + '  syncId=' + ord.includes('syncId'));
    console.log('  oi.syncId=' + ci.includes('syncId') + '  oi.orderSyncId=' + ci.includes('orderSyncId') + '  oi.deviceId=' + ci.includes('deviceId'));
    console.log('  ux_idx=' + JSON.stringify(idx));
  } catch (e) { console.log('QUERY_FAIL ' + f + ' :: ' + e.message); }
  db.close();
}
