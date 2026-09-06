# H5-FIX-REPORT — التقارير المالية / الطلبات المعلّقة (Financial Reporting)
**التاريخ:** 2026-08-31
**الحالة:** ✅ منفّذ ومختبر — Regression خضراء بالكامل (H5 ثم التوقف؛ لم أبدأ H6).

---

## 1) المشكلة (Root Cause)
النظام لم يكن يملك **تعريفاً مالياً واحداً متّسقاً للإيراد**. كان يعتمد على `orders.status` بفلتر `status NOT IN ('cancelled')` في الخادم، مما يجعل أي طلب بمجرّد وجوده (ولو `pending` غير مدفوع / `in_preparation` / `ready` / `served`) يُحتسب إيراداً. كما أن `getDailySales` كانت تضمّ `pending` صراحةً، ومساعد اليوم/P&L كان يجمع كل الطلبات بلا فلتر.

### المواقع المتأثرة (كانت تعدّ المعلّق إيراداً)
| الموقع | القديم | الجديد |
|---|---|---|
| خادم `analytics.ts` — KPIs / sales-by-day / sales-by-category / top-products / employees / discounts / insights / alerts / cogs / products / categories | `status NOT IN ('cancelled')` | `paymentStatus = 'paid'` |
| خادم `index.ts` — `/api/reports/summary` و sales-by-category | `status != 'cancelled'` | `paymentStatus = 'paid'` |
| `admin/database.js` — `Orders.getDailySales` | `closed / completed / pending` | `paymentStatus === 'paid'` |
| `index.html` — مساعد «مبيعات اليوم» و «تقرير يومي» و «حسابات/P&L» | كل الطلبات (بلا فلتر) | المدفوعة/المغلقة/المكتملة فقط |

> بقيت الأغراض التشخيصية على حالها (مقصود لا تغيير): `live-orders` (يعرض pending/prep/ready/served)، `orders-summary` (تفصيل حسب الحالة)، وعدّادات `cancelled`/voids.

---

## 2) التعريف المالي المُعتمد (الخيار أ — بموافقتك)
- **الإيراد (Gross Sales)** = مبالغ الطلبات ذات `paymentStatus='paid'` (مال مُحصَّل فعلاً — أياً كان الحالة: closed/completed/…).
- **استردادات (Refunds)** = من جدول `refunds`.
- **صافي المبيعات (Net Sales)** = الإيراد − الخصومات − الاستردادات.
- **المعلّق وغير المدفوع** (`pending`/`in_preparation`/`ready`/`served` غير المدفوع، و `partial`) → **لا يدخل إيراداً**.
- **المسترد/الملغى** (`cancelled` + `paymentStatus='refunded'`) → **لا يدخل إيراداً** (يُعالَج كاسترداد/صافي صفر).
- **COGS/GrossProfit**: يُحسب فقط على نفس مجموعة الطلبات المدفوعة، ويعرض `null` إن لم توجد بيانات تكلفة (لا ربح وهمي).

---

## 3) التغييرات (دون مساس بـ Tax / C2 sync / Schema / UI للمحاسبة)
- **`backend/src/routes/analytics.ts`**: استبدل فلتر الإيراد في كل استعلامات التحليلات إلى `paymentStatus = 'paid'` (عبر `o.` حيث يوجد join على orders). عولجت كل مواضعها.
- **`backend/src/index.ts`**: نفس الاستبدال في `/api/reports/summary` (orders / topItems / dailySales) و `/api/reports/sales-by-category`.
- **`admin/database.js` → `getDailySales`**: أصبح `paymentStatus === 'paid'` بدل قائمة الحالات.
- **`index.html`**: مساعد «مبيعات اليوم» و «تقرير يومي» و «حسابات/P&L» يفلتر الآن على المدفوع/المغلق/المكتمل.
- **لا تغيير** في: مخطط الجداول، tax logic، C2 sync architecture، مصادقة/صلاحيات، أو واجهات المحاسبة.

---

## 4) مصفوفة الحالات بعد الإصلاح
| الحالة | paymentStatus | إيراد؟ |
|---|---|---|
| pending / in_preparation / ready / served | unpaid | لا |
| pending / in_preparation | paid | نعم (مال محصَّل) |
| closed / completed | paid | نعم |
| closed | partial | لا (نصف مدفوع لا يُعدّ إيراداً كاملاً) |
| cancelled | refunded | لا (صافي صفر) |

---

## 5) الاختبارات والنتائج
### H5 (جديد — `h5-financial.cjs`، قاعدة مؤقتة)
السيناريو: بذر 7 طلبات اليوم (pending/في التحضير/جاهز/مغلق مدفوع/مكتمل مدفوع/ملغى/جزئي) + استرداد 40.
| حالة الاختبار | متوقع | فعلي |
|---|---|---|
| Net Sales = 400+500 − 40 | 860 | ✅ 860 |
| عدد الطلبات المدفوعة | 2 | ✅ 2 |
| الاسترداد | 40 | ✅ 40 |
| مبيعات اليوم (لا تشمل المعلّق) | 900 | ✅ 900 |
| تقرير summary إيراد/عدد | 900 / 2 | ✅ 900 / 2 |
| مبيعات الموظفين (empA=400, empB=500، بلا empC الملغى) | ✅ | ✅ |
| orders-summary يبقى تشخيصياً مُظهراً pending | pending=1 | ✅ |

**H5: 15/15 PASS**

### Regression (قبل وبعد — الكل أخضر)
| المجموعة | النتيجة |
|---|---|
| H1 | 29/29 PASS |
| H2 | 40/40 PASS |
| H2-expiry | PASS |
| H3 | 36/36 PASS |
| C2 audit2 | 26/26 PASS |
| C2 server smoke | 6/6 PASS |
| C2 safe sync (run-tests) | 15/15 PASS |
| tsc build | PASS (exit 0) |
| HTML inline-script syntax | PASS |

---

## 6) ملاحظات / قيود متبقية (خارج نطاق H5)
- **شرط تاريخ الاسترداد** في `analytics.ts` (`refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'`): بسبب ترتيب العمليات في SQLite يصبح النطاق العلوي غير مؤثِّر فعلياً (يساوي `createdAt >= from`). عيب محاسبي قائم لكنه **خارج نطاق مشكلة pending** ولم أغيّره لتجنّب كسر سلوك مقيَّد. يُنصح بتصحيحه لاحقاً كتحسين (وسأعود له في مرحلة التقارير بالجلسة القادمة إن أردت).
- **`partial` (دفع جزئي)**: حصراً لا يُعدّ إيراداً كاملاً في هذا الإصلاح. التقارير التفصيلية التي تعتمد على مبالغ الدفع الفعلية من جدول `payments` (المدفوع جزئياً) ستُعالَج في مرحلة التقارير القادمة (مرحلة 2).
- **عدم تغيير `netSales` fallback المحلي** في `admin` و POS (كانت صحيحة أصلاً: المدفوع/المغلق/المكتمل) — بقيت موحّدة مع الخادم بعد الإصلاح.

---

## 7) الخلاصة
وُحِّد تعريف الإيراد على «المدفوع فعلاً ناقص الاستردادات» عبر الخادم والتقارير والمساعد، وأُصلح `getDailySales`، مع بقاء كل التشخيصات سليمة، ومرور كل اختبارات H5 وكل Regression. **أوقفت هنا كما اتُّفق (لا H6).**

**الخطوة التالية (مرحلة 2 بجلسة قادمة):** إسناد العمليات للمستخدم الحالي + Audit تسجيلي + شاشة مصروف/مورد/تصنيف + تقارير الكاش والموردين والموظفين — ثم (مرحلة 3) Batman Agent.
