// prove_children_idempotency.cjs
// يثبت §2.د على نسخة معزولة فقط (نفس قاعدة المثيل المعزول 4986، قراءة فقط للملف)
// عبر better-sqlite3 مباشرة (لا عبر HTTP ولا عبر محرك — الحقيقة من الملف نفسه):
//   (أ) الفهرس الفريد الجزئي ux_order_items_syncId موجود في البناء الجديد.
//   (ب) إدراج نفس syncId طفل مرتين -> يتعذر (قيد فريد) => منع التكرار على مستوى التخزين.
//   (ت) أنماط دمج المحرك (pre-check ثم fallback) تُبقي count = 1 بالضبط لكل child syncId.
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SRC = process.argv[2] || 'C:/Users/Acer/AppData/Local/Temp/opencode/lucca_iso5/lucca_iso5.db';
const work = path.join(os.tmpdir(), 'opencode', 'lucca_prove_' + process.pid);
fs.mkdirSync(work, { recursive: true });
const COPY = path.join(work, 'probe.db');
fs.copyFileSync(SRC, COPY collect);
const db = new Database(COPY);

function hasIndex(name) {
  const r = db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type='index' AND name=?").get(name);
  return !!r;
}
function cols(t) {
  return db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
}
function countSync(t, sid) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM "${t}" WHERE syncId = ?`).get(sid).c);
}
const uniq = () => {
  const b = crypto.randomBytes(10).toString('hex'); return 'x' + b;
};

(async () => {
  let fails = 0;
  const chk = (name, ok, d) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? '  :: ' + d : ''));
    if (!ok) fails++;
  };

  // (أ) الفهرس الفريد للطفل في البناء الجديد
  chk('Index ux_order_items_syncId present', hasIndex('ux_order_items_syncId'));
  // (ب) عمودا syncId و orderSyncId موجودان في جدول الأطفال
  const oc = cols('order_items');
  chk('order_items has syncId+orderSyncId', oc.includes('syncId') && oc.includes('orderSyncId'));

  const ts = new Date().toISOString();
  const orderSync = uniq();
  const childA = uniq();
  const childB = uniq();

  const orderRow = {
    syncId: orderSync, deviceId: 'probe-dev', tableId: 9777, status: 'open', total: 320,
    subtotal: 280, tax: 40, createdAt: ts, updatedAt: ts, version: 1,
  };
  const childRow = (sy, orderSy, name, qty, unit, total) => ({
    syncId: sy, orderSyncId: orderSy, productId: 700001, name, quantity: qty, unitPrice: unit,
    total, price: unit, createdAt: ts, updatedAt: ts, version: 1,
  });

  function canonicalKeys(row) {
    return Object.keys(row).filter(k => k !== 'syncId' && k !== 'id').sort();
  }

  // المحاكاة الحرفية لمنطق المحرك (نفس ما يفعله /api/sync عند pre-check + fallback):
  // الإدراج؛ عند تصادم الفهرس الفريد نستعلم عن الصف الموجود ونحدّث عبر syncId.
  const upsert = (table, row) => {
    const colsArr = Object.keys(row);
    try {
      db.prepare(`INSERT INTO "${table}" (${colsArr.map(c => '`' + c + '`').join(',')}) VALUES (${colsArr.map(() => '?').join(',')})`)
        .run(...colsArr.map(c => row[c]));
      return 'insert';
    } catch (e) {
      const existing = db.prepare(`SELECT * FROM "${table}" WHERE syncId = ?`).get(row.syncId);
      if (existing) {
        const colsArr2 = Object.keys(row).filter(k => k !== 'syncId');
        db.prepare(`UPDATE "${table}" SET ${colsArr2.map(c => '`' + c + '` = ?').join(', ')} WHERE syncId = ?`)
          .run(...colsArr2.map(c => row[c]), row.syncId);
        return 'update';
      }
      return 'conflict:' + e.message;
    }
  };

  // 1) التأسيس (إدراج واحد عادي)
  const sOrder = upsert('orders', orderRow);
  const sA0 = upsert('order_items', childRow(childA, orderSync, 'Kid-A', 2, 150, 300));
  const sB0 = upsert('order_items', childRow(childB, orderSync, 'Kid-B', 3, 120, 240));
  chk('seed insert order=' + sOrder + ' A=' + sA0 + ' B=' + sB0', sOrder === 'insert' && sA0 === 'insert' && sB0 === 'insert');

  // 2) السباق الفعلي: 40 إرسالاً متزامناً نظرياً — نجرّب إدراج نفس الطفل مراراً
  //    بلا فحص مسبق (يحاكي المنافسة حين يصل سجلان بنفس syncId في آنٍٍ):
  //    يجب أن يبقى كل syncId = 1 بسبب الفهرس الفريد + fallback.
  const N = 40;
  for (let i = 0; i < N; i++) {
    const ra = upsert('order_items', childRow(childA, orderSync, 'Kid-A', 2, 150, 300));
    const rb = upsert('order_items', childRow(childB, orderSync, 'Kid-B', 3, 120, 240));
    if (ra === 'insert' || rb === 'insert') { console.log('!! ROW_INSERTED_DURING_RACE i=' + i + ' ra=' + ra + ' rb=' + rb); }
  }

  // 3) الحقيقة من الملف: العد must be 1 for each
  const cA = countSync('order_items', childA);
  const cB = countSync('order_items', childB);
  const cO = countSync('orders', orderSync);
  chk('final counts A=1 B=1 order=1', cA === 1 && cB === 1 && cO === 1,
    'A=' + cA + ' B=' + cB + ' order=' + cO);

  // 4) إثبات القيد على مستوى التخزين الخام (INSERT خام مرتين -> استثناء فريد)
  const rawIn = () => {
    const kv = childRow(childA, orderSync, 'Kid-A-dup', 5, 99, 495);
    const colsArr = Object.keys(kv);
    return () => db.prepare(`INSERT INTO "order_items" (${colsArr.map(c => '`' + c + '`').join(',')}) VALUES (${colsArr.map(() => '?').join(',')})`).run(...colsArr.map(c => kv[c]));
  };
  let threw = false, msg = '';
  try {
    // (حذف مؤقت للصف المُدرَج للسماح باختبار الإدراج الخام الوحيد للطفل بعد تنظيف — داخل ترانزاكشن مُتراجع)
    db.prepare('DELETE FROM order_items WHERE syncId = ?').run(childA);
    db.prepare('DELETE FROM order_items WHERE syncId = ?').run(childB);
    db.prepare('DELETE FROM orders WHERE syncId = ?').run(orderSync);
    db.exec('BEGIN');
    db.prepare(`INSERT INTO "order_items" (${'``'.replace(/`/g, '')}syncId``, orderSyncId, productId, name, quantity, unitPrice, total, price, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(childA, orderSync, 700001, 'K', 1, 10, 10, 10, ts, ts, 1);
    db.prepare(`INSERT INTO "order_items" (syncId, orderSyncId, productId, name, quantity, unitPrice, total, price, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(childA, orderSync, 700001, 'K2', 1, 10, 10, 10, ts, ts, 1);
    db.exec('COMMIT');
  } catch (e) { threw = true; msg = e.message; }
  finally { try { db.exec('ROLLBACK'); } catch {} }
  chk('raw double-insert throws UNIQUE constraint', threw && /UNIQUE/i.test(msg), msg.split('\n')[0]);
  const cAfter = countSync('order_items', childA);
  chk('final A still 1 after txn rollback', cAfter === 1);

  db.close();
  console.log('---');
  console.log(fails === 0 ? 'RESULT=PASS' : 'RESULT=FAIL');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
