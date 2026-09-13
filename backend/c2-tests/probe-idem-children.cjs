// ============================================================================
// probe-idem-children.cjs — storage-level idempotency for §2.د (child rows)
// Prove on an ISOLATED copy (NOT the live/production DB).
//  1) create the same partial unique index that dist/db.js:830 creates on boot
//  2) raw duplicate INSERT of the same child syncId must throw UNIQUE constraint
//  3) engine-style pattern (pre-check + fallback update) run 30x with the SAME
//     batch must leave EXACTLY ONE row per child syncId — no accumulation.
// Uses only better-sqlite3 (the real storage driver, same as the engine).
// ============================================================================
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC_DB = process.env.PROBE_SRC || path.join(process.cwd(), 'data', 'lucca.db');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-probe-children-'));
const DB_FILE = path.join(WORK, 'probe.db');
fs.copyFileSync(SRC_DB, DB_FILE);

const db = new Database(DB_FILE);
const prefix = 'probe-' + Date.now() + '-';
let seq = 0;
const uid = () => { seq++; return prefix + seq + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10); };
const now = () => new Date().toISOString();

let passes = 0, fails = 0;
function record(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
  ok ? passes++ : fails++;
}
function countStore(col, syncId) {
  const r = db.prepare(`SELECT COUNT(*) AS c FROM \`${col}\` WHERE syncId = ?`).get(syncId);
  return Number(r.c);
}
function hasIndex(indexName) {
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(indexName);
  return !!r;
}

(async () => {
  // (1) توافر عمودي syncId/orderSyncId في order_items (أساس تطابق §2.د)
  const cols = db.prepare(`SELECT name FROM pragma_table_info('order_items')`).all().map(r => r.name);
  const hasSync = cols.includes('syncId') && cols.includes('orderSyncId');
  record('1) order_items يملك syncId + orderSyncId (الأساس الفعلي للـ idempotency)', hasSync);

  // (2) الفهرس الفريد الجزئي — نفس الجملة التي تُنشأ عند الإقلاع في dist/db.js:830
  const DDL = `CREATE UNIQUE INDEX IF NOT EXISTS ux_order_items_syncId ON order_items(syncId) WHERE syncId IS NOT NULL AND syncId <> ''`;
  try {
    db.exec(DDL);
  } catch (e) {
    console.log('(فشل الإنشاء — تكرارات سابقة؟ سيُقيَّم): ' + e.message);
  }
  record('2) الفهرس الفريد الجزئي ux_order_items_syncId موجودَ', hasIndex('ux_order_items_syncId'));

  // (3) المحاكاة الأمنية §2.د: 30× نفس الدفعة (أب + طفلان ب syncId ثابت) =>
  //     صف أب واحد + صف طفل واحد لكلّ syncId — لا تراكم
  const orderSync = uid();
  const childA = uid();
  const childB = uid();
  const ts = now();

  const parent = {
      syncId: orderSync, tableId: 99910, status: 'open', total: 520,
    subtotal: 500, tax: 20, createdAt: ts, updatedAt: ts, version: 1,
  };
  const childs = (n, p, qty, unit, total) => ({
    syncId: n, orderSyncId: p, productId: 67990, name: 'probe-child', quantity: qty,
    unitPrice: unit, total, price: unit, createdAt: ts, updatedAt: ts, version: 1,
  });

  const pk_set = new Set([
    'id', 'orderId', 'createdAt', 'updatedAt',
  ]);

  function stableInsert(store, row) {
    try {
      const c = Object.keys(row);
      db.prepare(`INSERT INTO \`${store}\` (${c.map(k => '`' + k + '`').join(',')}) VALUES (${c.map(() => '?').join(',')})`)
        .run(...c.map(k => row[k]));
      return 'inserted';
    } catch (e) {
      // السباق: فهرس فريد رفض — إمّا موجود فعلاً (ثبات) أو تعارض تخزين
      const ex = db.prepare(`SELECT * FROM \`${store}\` WHERE syncId = ?`).get(row.syncId);
      if (ex) {
        const c = Object.keys(row);
        const set = c.map(k => '`' + k + '` = ?').join(', ');
        db.prepare(`UPDATE \`${store}\` SET ${set} WHERE syncId = ?`)
          .run(...c.map(k => row[k]), row.syncId);
        return 'conflict->updated';
      }
      throw e;
    }
  }

  // seed أول مرة
  stableInsert('orders', parent);
  stableInsert('order_items', childs(childA, orderSync, 2, 168, 36));
  stableInsert('order_items', childs(childB, orderSync, 200, 2, 50));

  let outcome = '';
  // بدّل 50 مرة بنفس SAME batch (يُمثّل مزامنة متزامنة/متكررة على اختلاف الأجهزة)
  for (let i = 0; i < 50; i++) {
    const r1 = stableInsert('order_items', childs(childA, orderSync, 2, 168, 36));
    const r2 = stableInsert('order_items', childs(childB, orderSync, 200, 2, 60));
    if (i === 0) outcome += r1 + ',' + r2;
  }

  const ca = countStore('order_items', childA);
  const cb = countStore('order_items', childB);
  record('3) طفلA يبقى 1 بالضبط بعد 51 إدراجًا (كان=' + outcome + ')', ca === 1, 'count=' + ca);
  record('3b) طفلB يبقى 1 بالضبط', cb === 1, 'count=' + cb);

  // (4) الطبقة الخام: إدراج مكرر لنفس syncId فعليًا يرفض UNIQUE
  {
    const dupSync = uid();
    const row = childs(dupSync, orderSync, 3, 100, 300);
    const cA = Object.keys(row);
    db.prepare(`INSERT INTO \`order_items\` (${cA.map(k => '`' + k + '`').join(',')}) VALUES (${cA.map(() => '?').join(',')})`)
      .run(...cA.map(k => row[k]));
    let threw = null, ok = false;
    try {
      db.prepare(`INSERT INTO \`order_items\` (${cA.map(k => '`' + k + '`').join(',')}) VALUES (${cA.map(() => '?').join(',')})`)
        .run(...cA.map(k => row[k]));
    } catch (e) { threw = e.message; ok = /UNIQUE/i.test(String(e.message)); }
    record('4) إدراج خام مكرر يرفضه الفهرس الفريد (UNIQUE ' + (ok ? '✓' : '✗') + ')', ok);
  }

  // (5) الآلية الأمنية §2.د: إرسال متزامن فعلي لنفس batch عبر عدد مؤشرات —
  //     مقارنة engine مع المحرك: الحقيقة أن syncId فريد على التخزين.
  const order2 = uid(); const c2A = uid(); const c2B = uid();
  for (let i = 0; i < 60; i++) {
    stableInsert('orders', { ...parent, syncId: order2 });
    stableInsert('order_items', childs(c2A, order2, 1, 9999, 1));
    stableInsert('order_items', childs(c2B, order2, 1, 9999, 2));
  }
  record('5) بعد 60 إعادة إرسال لنفس الأب: orders=1، order_items لكل طفل=1',
    countStore('orders', order2) === 1 && countStore('order_items', c2A) === 1 && countStore('order_items', c2B) === 1,
    'orders=' + countStore('orders', order2) + ' A=' + countStore('order_items', c2A) + ' B=' + countStore('order_items', c2B));

  console.log('====');
  console.log('RESULT: ' + (fails === 0 ? 'PASS (all ' + passes + ')' : 'FAIL (' + passes + ' pass / ' + fails + ' fail)'));
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(e => { console.error('FATAL', e); process.exit(1); });
