# عقد التقارير المالي المرجعي (Canonical Reporting Contract)

> المستند: `docs/CANONICAL_REPORTING_CONTRACT.md` — مخرج Phase 1.
> الحالة: **عقد ملزم** — كل طبقة (POS bar، AdminAnalytics، reportService، analytics، batman-dashboard، ai-pos-engine) يجب أن تتقارب عليه في Phase 4+.
> هذا المستند لا يعدّل كودًا: التباعدات الموثّقة هنا قرارات ترحيل مُعلَّمة بـ `مُرجَّح في Phase 4`.

---

## 1) المفاهيم وصيغها المرجعية

العملة: ل.س. الضريبة `tax = 0` بقرار إداري (موثّق في `serverOrderTotals` و `crud.ts:159`) — إن فُعّلت لاحقًا تُضاف إلى الإيراد ولا تُخصم من صافي المبيعات قبل الضريبة.

حقل الخصم في الطلب: `total = subtotal − discountAmount + tax` (مصدر: `backend/src/routes/crud.ts:159 serverOrderTotals`).

### 1.1 تعريفات المبيعات

| المفهوم | الصيغة المرجعية | مصدر الحقول |
|---|---|---|
| **Gross Sales** | `Σ orders.subtotal` لطلبات الفترة | `subtotal` |
| **Discounts** | `Σ orders.discountAmount` لطلبات الفترة | `discountAmount` (لا `discount`!) |
| **Net Sales (قبل الاسترداد)** | `Σ orders.total` لطلبات الفترة = Gross − Discounts (ضريبة 0) | `total` |
| **Refunds** | `Σ refunds.amount` لفترة الاسترداد | `refunds.amount` |
| **Net Sales (المرجعي)** | `Σ orders.total − Σ refunds.amount` | — |
| **AOV (متوسط قيمة الطلب)** | `Σ orders.total ÷ عدد الطلبات المدفوعة` (ما قبل الاسترداد — معنى «حجم التذكرة») | — |
| **Cancelled Orders** | `count(status='cancelled')` — تُحصى منفصلة ولا تدخل أي مؤشر مبيعات | `status` |

**شرط الإدراج (المرجعي):** `paymentStatus = 'paid'` حصراً (مصدر: `ordersRepo.paidOrdersSummary`). الاستثناءات:

- الطلبات `pending / in_preparation / ready / served` (غير المدفوعة): **مستبعدة** من كل المؤشرات المالية — القرار: المبيعات تُحتسب عند الدفع لا عند الإنشاء.
- الطلبات `cancelled/voided`: مستبعدة ويُحصى عددها `cancelledCount`.
- `status ∈ {completed, closed}` بدون `paymentStatus='paid'`: **غير مدرج** في العقد (تنبيه: `ai-pos-engine._salesStats:2131` يضمّ `completed/closed` مهما كانت حالة الدفع — مُرجَّح في Phase 4).

### 1.2 تعريفات الربح

| المفهوم | الصيغة المرجعية | شرط |
|---|---|---|
| **COGS** | `Σ (order_item.quantity × unitCost)` لطلبات الفترة المدفوعة، و`unitCost` من: (1) `product_recipes × inventory.costPerUnit` إن اكتملت الوصفة، وإلا (2) `products.cost` | إن تعذّرت الكلتاه → **COGS = null (unavailable/incomplete)** — لا يُخمَّن |
| **Gross Profit** | `Net Sales − COGS` | `null` إن كان COGS = null (`hasCostData` النمط الحالي) |
| **Operating Expenses** | `Σ expenses.amount` للفترة | — |
| **Operating Profit (الربح التشغيلي)** | `Gross Profit − Operating Expenses` | `null` إن كان Gross Profit = null |
| **Food Cost %** | `COGS ÷ Net Sales × 100` | — |
| **Gross Margin %** | `Gross Profit ÷ Net Sales × 100` | — |

**قرار صريح: المشتريات (purchases) ليست مصروفًا.** إنها تحويل أصول (نقد → مخزون)، وتدخل الربح عبر COGS عند البيع فقط. أي صيغة تطرح `purchases` من الربح **غير مرجعية**:

- `batman-dashboard.js` ~486: `net = s.sales − e.total − pur` → **غير مرجعية**.
- `ai-pos-engine.getDailySummary:2432`: `profit = s.net − ex.total − p.total` → **غير مرجعية**.
- `batman-dashboard.js` ~330: `profit = s.sales − e.total` (بلا COGS) → تبسيط مقبول فقط لو COGS غير متاح، ويجب وسمه «قبل تكلفة البضاعة».

### 1.3 مؤشرات الصندوق (Cash Drawer)

| المفهوم | الصيغة المرجعية |
|---|---|
| **Cash Expected** | `openingBalance + cash payments للفترة − cash refunds للفترة − cash expenses للفترة` — يُشتق **سيرفرًا** من جداول `payments/refunds/expenses`، لا من عدّادات متصفح |
| **Cash Actual** | المبلغ المعدود ماديًا عند الإغلاق (إدخال بشري في `daily_shifts`) |
| **Cash Difference** | `Cash Actual − Cash Expected` |

تنبيه مُثبَّت (ليس قرار phase 1): `admin/database.js:1927-1931` يحسب expected من عدّادات محلية — مسار معروف في C3-AUDIT، توحيد الاشتقاق في Phase 4/6.

### 1.4 إجماليات طرق الدفع

`Payment Method Totals = Σ payments.amount` مجمّعة حسب `method` لطلبات الفترة المدفوعة. المصدر الوحيد للدفعات جدول `payments` المكتوب عبر checkout فقط (قيد: لا كتابة دفعات محلية في POS — مثبت باختبارات p1-followup).

---

## 2) خريطة التطابق: السلوكيات الحالية مقابل العقد

| الطبقة | الصيغة الحالية | حالة مقابل العقد |
|---|---|---|
| `reportService.ts:73` | `netSales = revenue − discounts − refunds` حيث `revenue = Σ total` | **مزدوج الخصم**: `total` بعد الخصم أصلًا ثم تُطرح `discounts` ثانية. صيغة صحيحة = `Σ total − refunds`. مُرجَّح في Phase 4 |
| `reportService.ts:74` | `prevNetSales = prev.revenue − prevRefunds` (بلا خصومات) | **غير متناسقة** مع السطر 73 داخل نفس الملف — الفترة الحالية تُخصم فيها الخصومات وال سابقة لا. توحيد على `Σ total − refunds` |
| `reportService.ts:75-77` | `avgOrder = AVG(total)`؛ `paidCount` شرط `paymentStatus='paid'`؛ `cancelledCount` منفصل | **مطابق** للعقد (مع ملاحظة: AOV مرجعي ما قبل الاسترداد) |
| `reportService.ts:81` | `grossProfit = netSales − cogs` شرط `hasCostData` وإلا `null` | النمط مطابق، لكن netSales المدخل معوب (أعلاه) |
| `ordersRepo.paidOrdersSummary` | `paymentStatus='paid'` حصراً | **مطابق** |
| `admin-analytics.js` | `net = gross − refunds` (خصومات تُعرض ولا تُطرح) | **مطابق** (لأن `total` بعد الخصم) — لكن تسمية `gross` تعني `Σ total` لا `Σ subtotal` — إعادة تسمية في Phase 4 |
| `admin-analytics.js:83` | `discounts = Σ o.discount` (يجمع **النسبة** لا المبلغ) | **وحدة خاطئة** — يجب `Σ discountAmount`. مُرجَّح في Phase 4 |
| `admin-analytics.js` avgOrder | `net ÷ count` (بعد الاسترداد) | **يختلف** عن AOV المرجعي (قبل الاسترداد). مُرجَّح |
| `ai-pos-engine._salesStats:2131` | `net = gross − refunds`؛ فلتر `paid \|\| completed \|\| closed` | الصيغة مطابقة، الفلتر أوسع من العقد (يضم غير المدفوع المغلق). مُرجَّح |
| `ai-pos-engine.getDailySummary:2432` | `profit = net − expenses − purchases` | **غير مرجعية** (شراء ليس مصروفًا). مُرجَّح |
| `ai-pos-engine:1499` | `totalSales = gross − refunds` | مطابق لـ Net Sales |
| `batman-dashboard.js` ~330 | `profit = sales − expenses` (بلا COGS) | تبسيط مشروط — يُشترط بغياب COGS ويُوسَم |
| `batman-dashboard.js` ~486 | `net = sales − expenses − purchases` | **غير مرجعية**. مُرجَّح |
| شريط POS (index.html) | يضمّ الطلبات pending | **غير مرجعي** — المؤشر المالي يبدأ عند paid. مُرجَّح |
| `database.js` cash expected | عدّادات محلية | مخالفة لصيغة العقد (اشتقاق سيرفري). مُرجَّح |

---

## 3) قواعد معاملات صريحة

1. **الخصم يُطرح مرّة واحدة فقط** — داخل `orders.total`. أي طبقة تطرح `discountAmount` فوق `Σ total` مخالفة.
2. **الاسترداد يُخصم من صافي المبيعات** في تاريخ الاسترداد (`refunds.createdAt`)، ولا يُلغى الطلب الأصلي.
3. **الاسترداد لا يتجاوز المدفوع** (قيد سيرفري قائم + مثبت p1-followup: تكرار الاسترداد → 409).
4. **AOV ما قبل الاسترداد** — الاستردادات تُخصم من Net Sales لا من «حجم التذكرة».
5. **المشتريات خارج معادلة الربح**؛ تدخل عبر COGS فقط.
6. **COGS بلا بيانات = null لا صفر ولا تقدير** — لا fake data.
7. **المصدر الوحيد المُستهدف**: `backend/src/services/reportService.ts` — كل الطبقات تتحول إليه/تطابقه في Phase 3-4. هذا العقد هو المرجع عند التعارض حتى ذلك الحين.

---

## 4) حقول التقرير الإلزامية (Result Schema)

أي دالة تقرير مالي تُرجع على الأقل:

```
{ period: {from, to},
  grossSales, discounts, refunds,
  netSales,               // = Σ total − Σ refunds
  ordersCount,            // paymentStatus='paid'
  aov,                    // = Σ total / ordersCount
  cancelledCount,
  cogs: number|null,      // null = unavailable/incomplete
  grossProfit: number|null,
  expenses,
  operatingProfit: number|null,
  paymentMethodTotals: {cash, card, transfer, whatsapp, ...},
  cash: {expected, actual, difference},
  currency: 'SYP', taxEnabled: false }
```

عدم إرجاع حقل = فشل في العقد. القيم `null` يُعرض «غير متاح» لا صفر.
