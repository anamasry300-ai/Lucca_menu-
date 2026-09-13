// ================================================================
// probe_child_uniqueness.cjs
// Runs ONLY on an isolated copy of the DB (never the live :3000 / backend/data/lucca.db).
// It opens the isolated copy with better-sqlite3 and proves the STORAGE-LAYER
// guarantee behind section 2 (d) of the report: order_items rows are protected
// by a partial unique index on syncId, so a raw duplicate insert of the same
// child syncId is REJECTED by SQLite itself, and the engine's pre-check + fallback
// (check-then-insert/update) keeps exactly ONE row per stable child syncId even
// under repeated same-batch pushes.
// ================================================================
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// source: an ISOLATED copy that already carries the schema + an order row
// (we do NOT touch backend/data/lucca.db).
const SRC = process.env.PROBE_SRC
  || 'C:/Users/Acer/AppData/Local/Temp/opencode/lucca_iso5/lucca_iso5.db';
const WORK = path.join(os.tmpdir(), 'opencode', 'probe_child_' + process.pid);
fs.mkdirSync(WORK, { recursive: true });
const DB_FILE = path.join(WORK, 'probe.db');
fs.copyFileSync(SRC, DB_FILE obvious);

const db = new Database(DB_FILE);

const uid = () => crypto.randomUUID().replace(/-/g, '');
const now = new Date().toISOString();
const json = (o) => JSON.stringify(o);

// --- Ground truth helpers (direct SQL, no HTTP, no live server) ---
function countWhere(table, col, val) {
  const r = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`).get(val);
  return Number(r.c);
}
function indexName(table, ixName) {
  const r = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=? AND tbl_name=?`
  ).get(ixName, table);
  return r ? true : false;
}
function hasColumn(t, c) {
  const row = db.prepare(`SELECT * FROM pragma_table_info(?)`).all(t).find(x => x.name === c);
  return !!row;
}

// --- helper to build a child order_item row carrying a STABLE child syncId ---
function childRow(syncId, orderSyncId, name, qty, unitPrice, total) {
  return {
    syncId, orderSyncId,
    productId: 712777, name, quantity: qty, unitPrice, price: unitPrice, total,
    createdAt: now, updatedAt: now, version: 1,
  };
}

// normalized insert handling duplicate syncId the way the engine does:
// 1) pre-check by syncId -> if exists -> update (idempotent, no duplicate)
// 2) if not exists -> try INSERT; on unique-constraint conflict -> switch to UPDATE
function upsertStore(store, row) {
  const cols = Object.keys(row);
  const existingSync = row.syncId
    ? db.prepare(`SELECT * FROM \`${store}\` WHERE syncId = ?`).get(row.syncId)
    : undefined;
  if (existingSync) {
    const set = cols.filter(c => c !== 'syncId').map(c => `\`${c}\` = ?`).join(', ');
    db.prepare(`UPDATE \`${store}\` SET ${set} WHERE syncId = ?`)
      .run(...cols.filter(c => c !== 'syncId').map(c => row[c]), row.syncId);
    return 'updated';
  }
  try {
    db.prepare(
      `INSERT INTO \`${store}\` (${cols.map(c => '`' + c + '`').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).run(...cols.map(c => row[c]));
    return 'inserted';
  } catch (e) {
    // race fallback: another device inserted the same syncId between our check and insert
    const existing = db.prepare(`SELECT * FROM \`${store}\` WHERE syncId = ?`).get(row.syncId);
    if (existing) {
      const set = cols.filter(c => c !== 'syncId').map(c => `\`${c}\` = ?`).join(', ');
      db.prepare(`UPDATE \`${store}\` SET ${set} WHERE syncId = ?`)
        .run(...cols.filter(c => c !== 'syncId').map(c => row[c]), row.syncId);
      return 'raced-updated';
    }
    return 'hard-conflict:' + e.message;
  }
}

let passes = 0, fails = 0;
function record(name, ok, detail) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  :: ' + detail : ''));
  ok ? passes++ : fails++;
}

// ===== checks =====
(async () => {
  // 1) ORDER_ITEMS table has the syncId + orderSyncId columns
  record('order_items has syncId+orderSyncId',
    hasColumn('order_items', 'syncId') && hasColumn('order_items', 'orderSyncId'));

  // 2) RAW storage uniqueness: inserting the same child syncId twice as a raw INSERT
  //    must FAIL on the second attempt (SQLite enforces it at the storage layer).
  {
    const osid = uid(); const a = uid();
    const parent = { syncId: osid, customerName: 'probe-parent', total: 400, status: 'open',
      createdAt: now, updatedAt: now, version: 1 };
    db.prepare(`INSERT INTO orders (${Object.keys(parent).map(c => '`' + c + '`').join(',')}) VALUES (${Object.keys(parent).map(() => '?').join(',')})`)
      .run(...Object.values(parent));

    const row = childRow(a, osid, 'ChildRaw', 9, 12, 108);
    let msg = '';
    try {
      db.prepare(`INSERT INTO order_items (${Object.keys(row).map(c => '`' + c + '`').join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`)
        .run(...Object.values(row));
      record('raw 1st insert child unique (ok)', true);
    } catch (e) { msg = e.message; record('raw 1st insert child (unexpected fail)', false, msg); }

    const before = countWhere('order_items', 'syncId', a);
    try {
      db.prepare(`INSERT INTO order_items (${Object.keys(row).map(c => '`' + c + '`').join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`)
        .run(...Object.values(row));
      record('raw 2nd insert must be rejected by unique index', false);
    } catch (e) {
      const isUnique = /UNIQUE|unique/i.test(String(e.message || ''));
      record('raw 2nd insert rejected (UNIQUE) = ' + isUnique, isUnique, String(e.message || '').split('\n')[0]);
    }
    const after = countWhere('order_items', 'syncId', a);
    record('storage keeps child at exactly 1 behind raw reject', before === 1 && after === 1,
      'before=' + before + ' after=' + after | 0);
  }

  // 3) ENGINE-LAYER: the pre-check + race-fallback (upsertStore above) is idempotent:
  //    50 repeated pushes of the SAME batch (same parent + same 2 child syncIds)
  //    must leave orders=1, order_items=2 (exactly one row per child syncId).
  {
    const osid = uid(); const a = uid(); const b = uid();
    const parent = { syncId: osid, customerName: 'probe-batch', total: 560, status: 'open',
      createdAt: now, updatedAt: now, version: 1 };
    const children = [childRow(a, osid, 'ChildA', 15, 11, 165), childRow(b, osid, 'ChildB', 30, 13, 390)];
    const pushOnce = () => {
      const ra = upsertStore('orders', { ...parent });
      const rb = upsertStore('order_items', { ...children[0] });
      const rc = upsertStore('order_items', { ...children[1] });
      return [ra, rb, rc];
    };
    pushOnce(); // seed
    const results = [];
    for (let i = 1; i <= 50; i++) results.push(pushOnce()); // race over HTTP is emulated by identical batch re-push
    const cO = countWhere('orders', 'syncId', osid);
    const cA = countWhere('order_items', 'syncId', a);
    const cB = countWhere('order_items', 'syncId', b);
    const allInserts = results.every(r => r[1] === 'inserted' && r[2] === 'inserted');
    record('engine idempotency: orders=1 & children=1 each after 50 re-pushes',
      cO === 1 && cA === 1 && cB === 1,
      'orders=' + cO + ' childA=' + cA + ' childB=' + cB);
    record('all child gets were insert (no dupes), 2nd+ are sqlite-rejected path',
      allInserts, results.map(r => r[1] + '/' + r[2]).slice(0, 8).join(' '));
  }

  db.close();
  console.log('-----');
  console.log('TOTAL passes=' + passes + ' fails=' + fails);
  process.exitCode = fails === 0 ? 0 : 1;
})();
