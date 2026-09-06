# H5-SECURITY-AUDIT — تدقيق التقارير المالية / الطلبات المعلّقة (Financial Reporting)
**التاريخ:** 2026-08-31
**النطاق:** كل دوال احتساب المبيعات/الإيراد/الكاش/المدفوعات/التقارير — لم أُعدّل أي كود (مرحلة تشخيص فقط).
**التحذير:** المشكلة **أعمق من مجرد `pending`** — تعددت التعريفات المالية وغير متسقة بين المصادر. أنتظر قرارك في المعيار المالي قبل التعديل (وفق تعليماتك).

---

## 1) المصادر المالية وقاعدة البيانات الحالية

### مخطط الطلب (`backend/src/db.ts`)
- `orders.status CHECK IN ('pending','in_preparation','ready','served','completed','cancelled','closed')` — الافتراضي `pending`.
- `orders.paymentStatus CHECK IN ('unpaid','partial','paid','refunded')` — الافتراضي `unpaid`.
- **`invoices`** و **`payments`** و **`refunds`** جداول مستقلة تُكتب عند الأحداث المالية.

### دورة الطلب ودورة الدفع (من الرمز)
1. **إنشاء الطلب** (`Orders.create`): `status='pending'`, `paymentStatus='unpaid'`, `totalPaid=0` → **لا دخل**.
2. **دفع جزئي/مقسَّط** (`confirmSplitPayment`): يُكتب سجل في `payments`, ويُضبط `paymentStatus='paid'` (إن بلغ المجموع) أو `'partial'`.
   - إن `paid` → يستدعي `checkout()` → `status='closed'`.
3. **إقفال/كاش أوت** (`checkout`، الخادم `index.ts` + محلي `database.js`): `status='closed'`, `paymentStatus='paid'`, `totalPaid=total`, ويُنشأ **`invoice`** + سجل **`payment`**، ويُحدَّث **`daily_shifts`** (cashSales/cardSales) و **الدرج (drawer)** عبر `recordTransaction('sale')`.
4. **إلغاء/استرداد كامل** (Void، `index.html` ~4640): `status='cancelled'`, `paymentStatus='refunded'`, يُكتب سجل **`refunds`**، يُحرَّر الطاولة. → لا يعيد دخلاً.
5. **تغيير الحالة** (`updateStatus`): `in_preparation`/`ready`/`served`/`completed`/`cancelled`/`closed`.

> **النقطة المالية**: النظام يُنشئ `payment` + `invoice` **عند الإقفال فقط** (المال المُحصَّل فعلاً). لذا **جدول `payments` والمبلغ `paymentStatus='paid'` هما المرجع الأقوى للإيراد**، وليس `orders.status` وحده.

---

## 2) جميع دوال/مصادر احتساب المبيعات والإيرادات

| # | المصدر | العامل المالي | يعدّ `pending` (غير مدفوع) إيراداً؟ |
|---|---|---|---|
| B1 | خادم **`analytics.ts`** KPIs/revenue | `status NOT IN ('cancelled')` | **نعم — يعدّ `pending/unpaid/partial`** |
| B2 | خادم **`analytics.ts`** sales-by-day | `status NOT IN ('cancelled')` | **نعم** |
| B3 | خادم **`analytics.ts`** sales-by-category/top-products/insights/alerts | `o.status NOT IN ('cancelled')` | **نعم** |
| B4 | خادم **`index.ts`** `/api/reports/summary` و sales-by-category | `status != 'cancelled'` | **نعم** |
| B5 | خادم **`analytics.ts`** orders-summary | `GROUP BY status` (كل الحالات) | — (تفصيلي حسب الحالة) |
| C1 | **Admin** `localDashboardFallback` (admin/index.html:2220) | `paymentStatus==='paid' \|\| completed \|\| closed` | لا |
| C2 | **POS** `buildLiveContext` (index.html:6708/6725) | `paymentStatus==='paid' \|\| completed \|\| closed` | لا |
| C3 | **POS** `showAnalytics` (index.html:1506) | `completed \|\| closed` | لا |
| C4 | **POS** AI «مبيعات اليوم» (5784) و «تقرير يومي» (5808) | كل الطلبات (بلا فلتر) | **نعم — يعدّ `pending`** |
| C5 | **POS** AI «حسابات/P&L» (6580/6585) | كل الطلبات (بلا فلتر) | **نعم — يعدّ `pending`** |
| C6 | Admin `Orders.getDailySales` (database.js:1130) | `closed \|\| completed \|\| pending` | **نعم — يتضمن `pending`** |
| C7 | **الدرج (Drawer/CashRegister)** (database.js) + `daily_shifts` | يُسجَّل فقط عند `checkout` | لا (البند لا يدخل إلا عند الإقفال) |

---

## 3) العلاقة بين المصادر (التناقض الجوهري)
- **لوحة القيادة (Dashboard) عبر الخادم** (`/api/dashboard/*`) تعرض إيراداً يتضمن الطلبات المعلّقة غير المدفوعة (B1–B3).
- **نفس اللوحة عند تعذّر الخادم** (fallback C1) تعرض إيراداً «المدفوع فقط» → **رقمان مختلفان لنفس اليوم**.
- **التقارير** (`/api/reports/summary` B4) أيضاً تشمل `pending`.
- **مبيعات اليوم/P&L في المساعد** (C4/C5) تشمل كل الطلبات.
- **الدرج والـ daily_shifts والدخل من `payment`** يعكسون المال الفعلي فقط (لا `pending`).

> إذن: **Dashboard ≠ Reports ≠ Daily Sales ≠ Cash/Payment** — لا يوجد معيار مالي واحد متّسق.

---

## 4) مصفوفة الحالات (حسب الحالة الحالية للرمز)

| الحالة | paymentStatus | سجل Invoice | سجل Payment | Refund | يدخل Revenue؟ | يدخل Cash؟ |
|---|---|---|---|---|---|---|
| `pending` | `unpaid` | لا | لا | لا | **لا** | لا |
| `pending` | `paid` (دفع كامل دون إقفال) | مؤقتاً لا | نعم | لا | **نعم** (مال مُحصَّل) | بحسب الطريقة |
| `in_preparation`/`ready`/`served` | `unpaid` | لا | لا | لا | **لا** | لا |
| `completed` | `paid` | (نادراً) | نعم | لا | **نعم** | بحسب الطريقة |
| `closed` | `paid` | نعم | نعم | لا | **نعم** | نعم |
| `closed` | `partial` | نعم | نعم (جزئي) | لا | **جزئي فقط** | جزئي (ما دُفع فعلاً) |
| `cancelled` | `refunded` (void) | — | (سابقاً) | نعم | **لا** (صافي صفر) | يُخصم إن كان قد دُفع ثم أُرجع |
| `closed`/`completed` ثم استرداد جزئي | `paid`/`partial` | نعم | نعم | نعم (جزيئاً) | **الصافي بعد الاسترداد** | بحسب الاسترداد |

> المبدأ المالي المقترح: **الإيراد = الطلبات المدفوعة فعلاً (`paymentStatus='paid'`) ناقص الاستردادات (`refunds`)**، والمبالغ الجزئية تُحسب بما دُفع (من `payments`). الطلبات المعلّقة غير المدفوعة **لا** تدخل أي إيراد.

---

## 5) المشكلة الأساسية (Root Cause) والسياق
- الجذر: **نمذجة الإيراد على أساس `orders.status` فقط بفلتر `NOT IN ('cancelled')`** في الخادم، وعدم وجود تعريف موحّد «للطلب المكتمل مالياً». هذا يجعل أي طلب بمجرّد وجوده (ولو `pending` غير مدفوع) يُعدّ إيراداً.
- كما أن `getDailySales` (المذكورة في مشروع H5 أصلاً) تتضمن `pending` صراحةً.

---

## 6) نطاق H5 + القرار المطلوب منك
قبل أي تعديل، أحتاج قرارك في **المعيار المالي** (الخيارات):

- **الخيار أ (موصى به): الإيراد من الدفع الفعلي.** عرّف «الإيراد» بأنه الطلبات ذات `paymentStatus='paid'` (أو `closed`/`completed` المدفوعة)، والاسترداد يُسجَّل كخصم (`refunds`). يوحّد الخادم والتقارير والمبيعات اليومية والرسم البياني على هذا المعيار، ويلغي `pending/unpaid` من كل الحسابات. (يستخدم وحدة نمطية واحدة لتصفية الإيراد على الخادم في `analytics.ts` و`index.ts`، وعلى الواجهة في C4/C5/C6.)
- **الخيار ب: الإيراد من جدول `payments`.** يستخدم جدول `payments` (المال المُحصَّل فعلاً) كمصدر وحيد، مع تضمين `refunds` كخصم. أدق مالياً لكنه أكبر تغييراً على مخططات W1 التي تعتمد على orders.
- **الخيار ج: الإصلاح الأدنى.** فقط أزل `pending` من `getDailySales` واجعل الخادم يستثني `pending` (بدل `NOT IN ('cancelled')`)، دون التوحيد الكامل.

ملاحظة: لا أُغيّر منطق الضرائب ولا C2 sync ولا مخطط **invoices/payments** ولا UI، إلا بضرورة مباشرة.

**في انتظار قرارك (أ/ب/ج) قبل أي تعديل للمحاسبة.**

---

## خلاصة
النظام لا يملك تعريفاً مالياً واحداً متّسقاً للإيراد: الخادم والتقارير يعدّون الطلبات المعلّقة غير المدفوعة إيراداً، بينما الواجهة/الدرج/الفواتير لا. `getDailySales` مضبوطة على `pending` كما ورد في المشكلة، لكنها أعراض لداء أعمق (بلا معيار موحّد). عليه، **أوقفت قبل تغيير منطق المحاسبة وأنتظر قرارك في المعيار المالي** (أ/ب/ج).
