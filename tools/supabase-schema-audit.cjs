/**
 * LUCCA POS — Safe Schema Audit (قراءة فقط — READ ONLY)
 * --------------------------------------------------------------------------
 * المرحلة 1: يفحص المخطط السحابي الحالي (Supabase) دون أي تعديل.
 *   - لا CREATE/ALTER/DROP/INSERT/UPDATE/DELETE.
 *   - الوصول فقط عبر: GET على PostgREST (قراءة) + POST على /rpc/ بجسم {} فارغ
 *     لاختبار وجود الدالة فقط (PostgREST يرفض قبل التنفيذ عند غياب المتطلب).
 *   - إذا تعذّر تحديد شيء: يُخرج UNKNOWN مع السبب ولا يخترع نتيجة.
 *
 * المصدر:
 *   - متغيرات SUPABASE_URL / SUPABASE_ANON_KEY إن وُجدت،
 *     وإلا تُستخرج تلقائياً من supabase-db.js (النسخة الحيّة المستخدمة).
 *
 * التشغيل:
 *   node tools/supabase-schema-audit.cjs
 *
 * الناتج (الصيغة المطلوبة):
 *   TABLE: orders
 *     PASS: id
 *     FAIL: void_reason
 *   ...
 *   SUMMARY: N جدول موجود / M جدول مفقود ...
 *
 * الحالة: تشخيصي فقط — exit code 0 حتى عند وجود FAIL (لا يمنع أي شيء).
 * دليل "فشل في الاتصال" يظهر كـ UNKNOWN ولا يمنع العرض.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');

// ---------- إعدادات Supabase ----------
let URL = process.env.SUPABASE_URL;
let ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  try {
    const src = fs.readFileSync(path.join(BASE, 'supabase-db.js'), 'utf8');
    const mUrl = src.match(/SUPABASE_URL\s*=\s*'([^']+)'/);
    const mKey = src.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
    URL = URL || (mUrl && mUrl[1]);
    ANON = ANON || (mKey && mKey[1]);
  } catch (_) {}
}
if (!URL || !ANON) {
  console.error('تعذر تحديد إعدادات Supabase (ضع SUPABASE_URL وSUPABASE_ANON_KEY أو ثبّتهما في supabase-db.js).');
  process.exit(2);
}
URL = String(URL).replace(/\/+$/, '');

const base = '/rest/v1';
function authHeaders(extra) {
  return Object.assign({ apikey: ANON, Authorization: 'Bearer ' + ANON }, extra || {});
}
async function rest(pathname, opts) {
  const r = await fetch(URL + base + pathname, Object.assign({ headers: authHeaders() }, opts || {}));
  return { status: r.status, body: await r.json().catch(() => {}) };
}
async function rpcProbe(fn) {
  // لا يُنفَّذ: PostgREST يرفض قبل الاستدعاء عند غياب الوسائط المطلوبة.
  const r = await fetch(URL + base + '/rpc/' + fn, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: '{}'
  });
  return r.status;
}

// ---------- المواصفة المطلوبة ----------
const SPEC = [
  {
    table: 'orders',
    columns: [
      'id','order_number','table_id','order_type','items','customer_name',
      'customer_phone','payment_method','payment_method_id','customer_notes',
      'invoice_delivery','marketing_opt_in','status','payment_status','subtotal',
      'discount','discount_amount','discount_type','discount_by','tax','total',
      'total_paid','change_amount','date','created_by','created_at','updated_at',
      'sync_id','void_reason','void_note','voided_at','voided_by','refund_amount','refunded_at'
    ]
  },
  { table: 'order_items', columns: ['id','order_id','product_id','name','quantity','unit_price','cost','discount','tax','modifiers','notes','status','created_at'] },
  { table: 'users', columns: ['id','username','password','name','display_name','role','active','must_change_password','created_at'] },
  { table: 'payments', columns: ['id','order_id','invoice_id','amount','method','payment_method_id','reference','status','created_by','created_at','sync_id','order_sync_id','updated_at'] },
  { table: 'refunds', columns: ['id','order_id','payment_id','amount','reason','type','created_by','created_at','note','refund_method','voided_by','sync_id','updated_at'] },
  { table: 'expenses', columns: null },          // وجود فقط
  { table: 'purchases', columns: null },
  { table: 'suppliers', columns: null },
  { table: 'expense_categories', columns: null },
  { table: 'stock_movements', columns: null },
  { table: 'product_recipes', columns: null },
  { table: 'daily_shifts', columns: null },
  { table: 'audit_logs', columns: null },
  { table: 'sync_log', columns: null }
];
const RPC_FNS = ['checkout_order','void_order','_lucca_compute_totals','_lucca_deduct_stock','_lucca_restore_stock'];

// ---------- الجرد عبر OpenAPI (يتطلب service_role — متوقع فشله بـ anon) ----------
async function openApiInventory() {
  try {
    const r = await fetch(URL + base + '/', { headers: authHeaders({ Accept: 'application/openapi+json' }) });
    if (!r.ok) { let body = null; try { body = await r.json(); } catch (_) {} return { ok: false, status: r.status, body: body }; }
    const doc = await r.json();
    const schemas = doc && doc.components && doc.components.schemas;
    if (!schemas || typeof schemas !== 'object') return { ok: false, status: r.status, note: 'openapi-no-schemas' };
    const tables = {};
    for (const [name, s] of Object.entries(schemas)) {
      const cols = Object.keys((s && s.properties) || {}).map(c => c.toLowerCase());
      tables[String(name).toLowerCase()] = new Set(cols);
    }
    const rpc = new Set();
    if (doc.paths) for (const p of Object.keys(doc.paths)) {
      const m = p.match(/^\/rpc\/([^/]+)$/);
      if (m) rpc.add(m[1].toLowerCase());
    }
    return { ok: true, tables, rpc };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- فحص بديل لكل جدول/عمود عبر REST (قراءة فقط) ----------
async function probeTable(table) {
  try {
    const r = await rest('/' + table + '?limit=1');
    if (r.status === 200) return { exists: true, readable: true };
    if (r.status === 401 || r.status === 403) return { exists: true, readable: false, why: 'blocked:' + r.status };
    const code = (r.body && r.body.code) || '';
    if (code === 'PGRST205' || code === '42P01' || r.status === 404) return { exists: false };
    return { exists: null, why: 'status:' + r.status + ' ' + (r.body && r.body.message || '') };
  } catch (e) {
    return { exists: null, why: 'net:' + String(e && e.message || e) };
  }
}
async function probeColumn(table, col) {
  try {
    const r = await rest('/' + table + '?limit=1&select=' + col);
    if (r.status === 200) return 'exists';
    if (r.status === 401 || r.status === 403) return 'blocked';
    const code = (r.body && r.body.code) || '';
    if (code === 'PGRST204' || code === '42703' || code === '42P01') return 'missing';
    if (code === 'PGRST205' || r.status === 404) return 'no-table';
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

// ---------- تشغيل ----------
(async function main() {
  console.log('== LUCCA POS — Safe Schema Audit (read-only) ==');
  console.log('Base: ' + URL + '  (anon key: ' + ANON.slice(0, 22) + '…)');
  console.log('');

  const inv = await openApiInventory();
  const mode = inv.ok ? 'openapi' : 'probe';
  console.log('Mode: ' + mode + (inv.ok ? ' (OpenAPI)' : ' (REST probing — ' + (inv.note || inv.error || 'fallback') + ', status=' + inv.status + ')'));
  console.log('');

  const tableStats = { exists: 0, missing: 0, unknown: 0 };
  const colStats = { pass: 0, fail: 0, unknown: 0, blocked: 0 };

  const colSetOf = (t) => (inv.ok && inv.tables && inv.tables[t.toLowerCase()]) || null;

  for (const spec of SPEC) {
    const t = spec.table;
    let exists;
    if (inv.ok && inv.tables) exists = inv.tables.has(t.toLowerCase());
    else { const p = await probeTable(t); exists = p.exists; }
    const eLabel = exists === true ? 'EXISTS' : (exists === false ? 'MISSING' : 'UNKNOWN');
    console.log('TABLE: ' + t + '  [' + eLabel + ']');

    if (spec.columns && spec.columns.length) {
      for (const c of spec.columns) {
        const cls = colSetOf(t);
        if (cls) {
          if (cls.has(c.toLowerCase())) { colStats.pass++; console.log('  PASS: ' + c); continue; }
          colStats.fail++; console.log('  FAIL: ' + c); continue;
        }
        // probe mode
        const st = (exists === false) ? 'missing-table' : await probeColumn(t, c);
        if (st === 'exists') { colStats.pass++; console.log('  PASS: ' + c); }
        else if (st === 'missing' || st === 'missing-table') { colStats.fail++; console.log('  FAIL: ' + c); }
        else if (st === 'blocked') { colStats.blocked++; console.log('  BLOCKED: ' + c + '  (خصم RLS/صلاحيات يمنع رؤية الـ ano)'); }
        else { colStats.unknown++; console.log('  UNKNOWN: ' + c + '  (لا يمكن تحديدها عبر anon — راجع deploy/supabase-schema-audit.sql)'); }
      }
    } else {
      console.log('  (تحقق وجود الجدول فقط — لا قائمة أعمدة مطلوبة)');
    }
    if (exists === true) tableStats.exists++;
    else if (exists === false) tableStats.missing++;
    else tableStats.unknown++;
    console.log('');
  }

  // ---------- دوال RPC ----------
  console.log('RPC FUNCTIONS:');
  for (const fn of RPC_FNS) {
    let st;
    if (inv.ok && inv.rpc) {
      st = inv.rpc.has(fn.toLowerCase()) ? 'PASS' : 'FAIL';
    } else {
      const s = await rpcProbe(fn);
      st = (s === 400 || s === 200 || s === 401 || s === 403) ? 'PASS' : (s === 404 ? 'FAIL' : 'UNKNOWN(state ' + s + ')');
    }
    console.log('  ' + st + ': ' + fn);
  }
  console.log('');

  console.log('SUMMARY: tables exists=' + tableStats.exists + ' missing=' + tableStats.missing + ' unknown=' + tableStats.unknown +
    ' | columns pass=' + colStats.pass + ' fail=' + colStats.fail + ' blocked=' + colStats.blocked + ' unknown=' + colStats.unknown);

  if (!inv.ok) {
    console.log('');
    console.log('ملاحظة: للتحقق الدقيق من أعمدة orders و دوال RPC، شغّل deploy/supabase-schema-audit.sql');
    console.log('في Supabase > SQL Editor وأعد ناتج الاستعلامين (2) و (3). هذا الملف لا يخترع النتائج.');
  }
})().catch((e) => {
  console.error('خطأ في تشغيل الفحص: ' + String(e && e.message || e));
  process.exit(1);
});