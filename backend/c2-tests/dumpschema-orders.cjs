// dumpschema-orders.cjs - READ-ONLY pragma dump of the isolated copy
// Prints only ASCII; used to align probe rows with the real schema.
const Database = require('better-sqlite3');
const path = require('node:path');
const f = path.resolve(process.argv[2]);
const db = new Database(f, { readonly: true });
for (const t of ['orders', 'order_items']) {
  console.log('## ' + t);
  const cols = db.prepare(`SELECT name, type, notnull, dflt_value, pk FROM pragma_table_info('${t}')`).all();
  for (const c of cols) {
    console.log('  C ' + c.name + ' | ' + c.type + ' | notnull=' + c.notnull + ' | pk=' + c.pk + ' | dflt=' + String(c.dflt_value));
  }
  const idx = db.prepare(`SELECT name, "sql" FROM sqlite_master WHERE type='index' AND tbl_name='${t}'`).all();
  for (const r of idx) console.log('  I ' + r.name + ' | ' + String(r.sql).replace(/\s+/g, ' '));
}
db.close();
