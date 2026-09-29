// P0 — توحيد حدود النطاق اليومي (canonical day-bound contract).
//
// القاعدة المرجعية (docs/CANONICAL_REPORTING_CONTRACT.md §1 + §3):
// كل تجميع مالي (مبيعات/مدفوعات/استردادات/مصروفات/صندوق) يفلتر بيوم — `YYYY-MM-DD`.
//
// لماذا هذا الملف؟ لأن أي استعلام يعتمد على حدود زمنية نصّية (string comparison)
// وهو هشّ أمام اختلاف صيغة الطابع المخزَّن في قاعدة البيانات:
//
//   payments.createdAt / refunds.createdAt  →  SQLite  datetime('now')  = 'YYYY-MM-DD HH:MM:SS'
//   orders.date / expenses.date            →  ISO-8601 من JS           = 'YYYY-MM-DDTHH:MM:SS.sssZ'
//
// مثال الفخ (كان يُسقط يوماً كاملاً منتقاطاً في daily_shifts):
//   '2026-05-10 10:05:00' >= '2026-05-10T00:00:00'            →  false  (المسافة 0x20 < 'T' 0x54)
//   date('2026-05-10T10:00:00.000Z') >= '2026-05-10T00:00:00' →  false  (bare day مقابل طابع ISO)
//
// الحل: أي حدّ نطاق — مهما كانت صيغته — يُختزل إلى `YYYY-MM-DD` قبل الوصول إلى SQL،
// ثم تُقارَن الأيام عبر `date(col)` أو `col <= day || 'T23:59:59'`.
// (ملاحظة: في SQLite عامل `||` أعلى أولوية من `<=`، فالتركيب `col <= ? || 'T23:59:59'` صحيح
//  ويعني "نهاية اليوم" — لا يُحاط بين قوسين.)
const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

/** يختزل أي مدخل (ISO، SQLite datetime، يوم، Date) إلى 'YYYY-MM-DD'. */
export function dayBound(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = DAY_RE.exec(s);
  return m ? m[0] : fallback;
}

/** يوحّد حدّي النطاق إلى أيام (من ≤ إلى). */
export function rangeDays(from: unknown, to: unknown, fallbackFrom = '0000-01-01', fallbackTo = '9999-12-31'): { from: string; to: string } {
  const f = dayBound(from, '');
  const t = dayBound(to, '');
  const lo = f || fallbackFrom;
  const hi = t || (f ? f : fallbackTo);
  return { from: lo, to: hi >= lo ? hi : lo };
}
