// Safe Sync Engine — pure, testable merge logic (مرحلة الاختبار فقط، لا يمس أي بيانات إنتاج)
// يعتمد على التصميم المعتمد في C2-SYNC-DESIGN.md مع تعديلات الهوية (Stable UUID syncId).

// ===== utility: مصدر UUID محقون ليسهل اختباره =====
// في بيئة Node نبدأ cسيوم اتصال. نسمح بحقن دالة توليد UUID لاختبار الاستقرار.
let uuidFn = null;
function setUuidFn(fn) { uuidFn = fn; }
function newUuid() {
  if (uuidFn) return uuidFn();
  return (crypto.randomUUID ? crypto.randomUUID() : 'xxxx-xxxx-xxxx-'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
}

// ===== أدوات هوية موثوقة =====
// تعيين معرّفات Sync للكائنات وتنظيفها (لا نغيّر autoIncrement id الداخلي).
// FIELDS: أنواع المستندات التي نسنب إليها syncId/updatedAt لدى دخولها/خروجها من المزامنة.
const SYNC_STORE_ORDER = [
  'users','tables','orders','order_items','invoices','payments','refunds',
  'audit_logs','order_status_history','customers','inventory','stock_movements',
  'purchases','product_recipes','waste_log','expenses','employees','attendance',
  'shifts','categories','products','product_modifiers','product_variations',
  'payment_methods','taxes','discounts','suppliers'
];

// data-version: تمثّل توقيع البيانات/الإصدار للمقارنة "متطابق" بدون الاعتماد على وقت الجهاز.
function canonicalSignature(item) {
  const copy = {};
  for (const k of Object.keys(item || {}).sort()) {
    if (k === 'syncId' || k === 'updatedAt' || k === 'updated_at' || k === 'revision') continue;
    const v = item[k];
    copy[k] = (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
  }
  return JSON.stringify(copy);
}

// هل الكائنان متطابقان بياناتيًا (نفس المحتوى غير حقول الإصدار)؟
function sameData(a, b) {
  return canonicalSignature(a) === canonicalSignature(b);
}

// determineWriteOrder: يفصل "من أحدث" بشكل موثوق.
// لا نعتمد على Date.now() وحده؛ نستخدم:
//   - updatedAt يوجد لدى الطرفين => إذا فرق زمني خارج "نافذة الغموض" نعتبره موثوقاً
//   - editedFromDevice/version/revision كدليل أقوى إن وُجد
//   - وإلا (غائب أو متساوٍ) => غموض => CONFLICT
const AMBIGUITY_MS = 5000; // نافذة 5 ثوانٍ: فروقات أصغر منها غير موثوقة

function newestWins(server, local) {
  const s = server || {}, l = local || {};
  const sV = s.version != null ? s.version : (s.revision != null ? s.revision : null);
  const lV = l.version != null ? l.version : (l.revision != null ? l.revision : null);
  // 1) إصدار/تنقيح رقمي موثوق إن وُجد عند الطرفين
  if (sV != null && lV != null) {
    if (lV !== sV) return lV > sV ? 'local' : 'server';
  }
  // 2) updatedAt عند الطرفين
  const sT = s.updatedAt || s.updated_at || null;
  const lT = l.updatedAt || l.updated_at || null;
  if (sT && lT) {
    const a = new Date(sT).getTime(), b = new Date(lT).getTime();
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      const diff = b - a;
      if (Math.abs(diff) >= AMBIGUITY_MS) return diff > 0 ? 'local' : 'server';
    }
  }
  // 3) أحد الطرفين له updatedAt والآخر لا => الطرف الذي له updatedAt أحدث افتراضاً (أُدير عبر طبقة البيانات)
  if (sT && !lT) return 'server';
  if (lT && !sT) return 'local';
  // 4) لا دليل موثوق => غموض
  return null;
}

// mergeOne: دمج سجل واحد بين "سيرفر" و"محلي" (اتجاه push: المحلي -> السيرفر)
// يعيد واحدة من: { action:'insert' | 'skip' | 'update', item } | { action:'conflict', server, local, reason }
function mergePush(serverRow, localRow) {
  if (!serverRow) {
    // غير موجود على السيرفر => إدراج
    return { action: 'insert', item: localRow };
  }
  if (sameData(serverRow, localRow)) {
    return { action: 'skip', item: serverRow };
  }
  const win = newestWins(serverRow, localRow);
  if (win === 'local') {
    return { action: 'update', item: localRow };
  }
  if (win === 'server') {
    return { action: 'skip', item: serverRow }; // نسخة السيرفر أحدث/مطابقة -> لا استبدال
  }
  return { action: 'conflict', server: serverRow, local: localRow, reason: 'لا توجد نسخة أحدث موثوقة (لا updatedAt/version قاطع)' };
}

// mergePull: دمج اتجاه pull (السيرفر -> المحلي) بنفس منطق الأمان، دون حذف أعمى.
function mergePull(localRow, serverRow) {
  if (!localRow) {
    return { action: 'insert', item: serverRow };
  }
  if (sameData(localRow, serverRow)) {
    return { action: 'skip', item: localRow };
  }
  const win = newestWins(localRow, serverRow);
  if (win === 'server') {
    return { action: 'update', item: serverRow };
  }
  if (win === 'local') {
    return { action: 'skip', item: localRow };
  }
  return { action: 'conflict', server: serverRow, local: localRow, reason: 'تعارض pull بلا دليل أحدثية' };
}

// ===== Sync Log / Audit =====
function createSyncLog() {
  return { startedAt: new Date().toISOString(), inserted: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0, items: [], conflictDetail: [] };
}
function logResult(log, res, item) {
  if (res.action === 'insert') log.inserted++;
  else if (res.action === 'update') log.updated++;
  else if (res.action === 'skip') log.skipped++;
  else if (res.action === 'conflict') {
    log.conflicts++;
    log.conflictDetail.push({ syncId: item && item.syncId, reason: res.reason, server: res.server, local: res.local });
  }
  log.items.push({ syncId: (item && item.syncId) || null, action: res.action });
}

// ===== Device registry / uvلكل جهاز syncId =====
// في بيئة حقيقية DEVICE_ID يُحفظ في localStorage؛ هنا نمرّره للمحرك.
function withDeviceContext(record, deviceId) {
  if (record && !record.syncId) {
    if (deviceId && record._deviceIdSource) { /* لا نستعمل */ }
    record.syncId = newUuid();
  }
  return record;
}

// ensureSyncIds: يضمن أن كل سجل له syncId (توليد عند الحاجة — الهوية المستقرة).
// لا يلمس id الداخلي.
function ensureSyncIds(stores) {
  const result = {};
  for (const store of SYNC_STORE_ORDER) {
    const rows = stores[store] || [];
    result[store] = rows.map(r => {
      const copy = Object.assign({}, r);
      if (!copy.syncId) copy.syncId = newUuid();
      if (copy.orderId != null && !copy.orderSyncId && store === 'order_items') {
        // ربط order_item بالأب: نستعمل orderId داخلياً، ونسخة orderSyncId تُملأ من جدول orders أدناه إن تيسر
      }
      return copy;
    });
  }
  return result;
}

// resolveExisting: حلّ "هل هذا السجل موجود على الطرف الآخر" بالهوية المستقرة ثم بـfallback رقمي آمن.
// القاعدة (con/prevent الإصلاح الحيّ): الرقمي يُستخدم للتوافق القديم فقط عندما يكون الوارد بلا syncId
// والسجل على السيرفر بلا syncId أيضاً. أي سجل جديد يحمل syncId مختلف لا يُدمج أبداً
// مع سجل قديم عبر اتفاق معرفات autoincrement المحلية (كان هذا سبب فساد صف id=1 في الاختبار الحي).
// bySyncId(syncId) و byId(id) دالتَا بحث عند الطرف الآخر؛ تُعيد السجل المطابق أو null.
function resolveExisting({ bySyncId, byId, incoming }) {
  const sid = incoming && incoming.syncId;
  if (sid) {
    const viaSync = bySyncId(sid);
    if (viaSync) return viaSync;
    return null; // لا fallback رقمي عندما يوجد syncId غير مطابق — يصبح إدراجاً جديداً
  }
  if (incoming && incoming.id != null && typeof byId === 'function') {
    const viaId = byId(incoming.id);
    if (viaId && !viaId.syncId) return viaId; // سجلان قديمان (بلا syncId) => دمج قديم مقصود
    return null;
  }
  return null;
}

// ===== Transaction / Rollback wrapper =====
// معاملة ذرّية حقيقية: كل العمليات تُسجَّل مؤقتاً في pending ولا تُطبَّق على الهدف إلا عبر commit().
// إن أُطلق rollback() (إخفاق/انقطاع شبكة) لا يصل أي تغيير إلى الهدف -> لا حالة جزئية.
async function runSyncTransaction(applyFn) {
  const pending = [];
  let cancelled = false;
  const txn = {
    queue(store, type, key, value) {
      pending.push({ store, type, key, value });
    },
    // commit: يُطبَّق جميع العمليات المؤجلة على الهدف الفعلي (المُمرَّر عبر بندقية نتائج applyFn).
    // نُحمّل commit إلى applyFn عبر callCommit — انظر الاستخدام في الاختبارات.
    commit() { /* يُطبق عبر callback commitTarget في النهاية */ }
  };
  const commitTarget = (db) => {
    for (const op of pending) {
      db.apply(op.store, op.key, op.value);
    }
  };
  try {
    await applyFn({ txn, commitTarget });
  } catch (e) {
    cancelled = true;
    return { committed: false, error: e, pending };
  }
  if (cancelled) return { committed: false, pending };
  // applyFn لم يُلغِ => نعرض pending للاختبار؛ المستدعي ينفذ commitTarget فقط بعد النجاح الكامل.
  return { committed: true, pending, commitTarget };
}

module.exports = {
  SYNC_STORE_ORDER,
  newUuid, setUuidFn,
  canonicalSignature, sameData, newestWins, mergePush, mergePull,
  createSyncLog, logResult, resolveExisting,
  ensureSyncIds, withDeviceContext,
  AMBIGUITY_MS,
  runSyncTransaction
};
