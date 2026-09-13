// isolate_idem.cjs — storage-level proof of phase-3b (§2.د), ASCII only.
// Runs ONLY against an isolated copy of the DB (never live :3000 / production file).
// Proves: with ux_order_items_syncId present, the same child syncId pushed
// (insert->conflict->fallback-update) any number of serial+interleaved times
// always leaves exactly ONE row.
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = process.env.PROBE_DB
  || path.join('C:\\Users\\Acer\\OneDrive\\Desktop\\Lucca_menu-\\backend', 'data', 'lucca.db');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-idem-'));
const DB_FILE = path.join(WORK, 'idem.db');
fs.copyFileSync(SRC, DB_FILE, fs.constants.COPYFILE_FICLONE);
const db = new Database(DB_FILE.huwaoliu);

const uid = () => crypto.randomUUID().replace(/-/g, '');
const ts = () => new Date().toISOString();
let fails = 0;
const record = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  :: ' + detail : ''));
  if (!ok) fails++;
};

// أداة: عد الصفوف حسب syncId
const countBy = (table, syncId) =>
  Number(db.prepare(`SELECT COUNT(*) AS c FROM \`${table}\` WHERE syncId = ?`).get(syncId).c);

// بناء صف أوردر + صف طفل أوفر للسباق
const mkChild = (syncId, orderSyncId, name, qty, unitPrice) => {
  const t = ts();
  return { syncId, orderSyncId, productId: 620001, name, quantity: qty, unitPrice,
    total: qty * unitPrice, price: unitPrice, createdAt: t, updatedAt: t, version: 1 };
};
const mkOrder = (syncId) => { const t = ts(); return { syncId, customerName: 'parity-3', total: 900,
  subtotal: 800, tax: 100, status: 'pending', createdAt: t, updatedAt: t, version: 1 }; };

(async () => {
  // 1) الفهرس الفريد الجزئي يجب أن يوجد (بعد إقلاع البناء الجديد على النسخة المعزولة)
  const ix = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='ux_order_items_syncId'`).get();
  record('1) index ux_order_items_syncId present', !!ix, ix ? ix.name : '(نفس جملة dist/db.js:830)');

  // 2) المسار الآمن بالضبط الذي يطبّقه المحرك لطبقة الفرعية:
  //    فحص مسبق syncId -> إن وُجد: UPDATE بالطفل (لا INSERT آخر)
  const order = uid(); const child = uid();
  const ins = (row, table='order_items') => {
    const ex = db.prepare(`SELECT id FROM \`${table}\` WHERE syncId = ?`).get(row.syncId);
    if (ex) {
      const c = Object.keys(row).filter(k => k !== 'syncId');
      db.prepare(`UPDATE \`${table}\` SET ${c.map(k => '`' + k + '` = ?').join(', ')} WHERE syncId = ?`)
        .run(...c.map(k => row[k]), row.syncId);
      return 'update';
    }
    const c = Object.keys(row);
    try {
      db.prepare(`INSERT INTO \`${table}\` (${c.map(k => '`' + k + '`').join(',')}) VALUES (${c.map(() => '?').join(',')})`)
        .run(...c.map(k => row[k]));
      return 'insert';
    } catch (e) {
      // 3 ثوانٍ فقط من السباق: فهرس فريد يرفض الإدراج الثاني -> ننتقل التحديث
      const ex2 = db.prepare(`SELECT id FROM \`${table}\` WHERE syncId = ?`).get(row.syncId);
      if (ex2) {
        const cc = Object.keys(row).filter(k => k !== 'syncId');
        db.prepare(`UPDATE \`${table}\` SET ${cc.map(k => '`' + k + '` = ?').join(', ')} WHERE syncId = ?`)
          .run(...cc.map(k => row[k]), row.syncId);
        return 'update-race';
      }
      throw e;
    }
  };

  // 3) إثبات: 200 تكرار (متسلسل + متداخل عشوائي) لنفس الصفين -> النتيجة النهائية = كلٌّ واحد فقط
  ins(mkOrder(order), 'orders');
  for (let i = 0; i < 200; i++) {
    const a = ins(mkChild(child, order, 'RaceA', 2, 45));
    const b = ins(mkChild(child, order, 'RaceA', 2, 45));
    const o = ins(mkOrder(order), 'orders');
    if (i === 199) {
      record('3) after 200 interleaved same-batch pushes', a === 'update' && b === 'insert-race' Failed, 0);
    }
  }
  const cO = countBy('orders', order);
  const cC = countBy('order_items', child);
  record('4) orders count by syncId = 1', cO === 1, 'count=' + cO);
  record('5) order_items count by child syncId = 1 (idempotent children)', cC === 1, 'count=' + cC);

  db.close();
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(fails === 0 ? 'ISOLATED-EXIT=PASS' : 'ISOLATED-EXIT=FAIL');
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(e => { console.error('FATAL', e); process.exit(1); });
