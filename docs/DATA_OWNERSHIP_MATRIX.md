# مصفوفة ملكية البيانات (Data Ownership Matrix)

> المستند: `docs/DATA_OWNERSHIP_MATRIX.md` — مخرج Phase 1.
> الحالة: عقد. يحسم «أين يُكتب كل كيان، وأين يُقرأ، ومن السلطة». نُبني حصراً من الكود الموجود، لا من تخمين.

---

## 1) مبدأ الحسم (من الكود الموجود)

- **الوضع المحلي (local)**: السلطة الوحيدة هي الـ backend المحلي (`SQLite على localhost:3000`) للعمليات المالية (checkout/void/refunds/stock), و`IndexedDB` للكتالوج/الإعدادات/الطلبات المفتوحة عبر `LuccaDB`. سوف تظهر متزايدة: كل كيان له طاولة سيطرة واحدة.
- **الوضع السحابي (supabase)**: السلطة الوحيدة `Supabase` (PostgREST + RPC). الـ local إن وُجد يعكس/مؤقت فقط.
- **القاعدة الأبدية**: الكيان المالي الواحد له كاتب واحد في كل وضع (انظر القسم 2) — كانت معلومة عيبًا في P2/P3، تُحسم هنا.

---

## 2) الجداول التنظيمية: الماليات (كتابة واحدة)

| الكيان | محلي (الوضع local) | سحابي (الوضع supabase) | كاتب وحيد | ملاحظات |
|---|---|---|---|---|
| `orders` | backend POST + PUT من POS عبر REST (وضع local فقط) + checkout server-side | **Supabase فقط** — لا REST محلي	new | order writer واحد per وضع | P3 مُعالج في PHASE1_DECISIONS: غطاء cloud-only |
| `order_items` | يُكتب من POS مع الـ order، عبر server-side | Supabase عبر RPC/upsert | مع الـ order | relation عبر orderSyncId (مثبت TEST6) |
| `payments` | **backend checkout فقط** (لا كتابة مصدر أمامي) | Supabase RPC `checkout_order` + paymentSyncId | checkout identical | مثبت p1-followup P1-split: لا دفعات محلية |
| `refunds` | **backend `/void` + `/refunds`** فقط | Supabase RPC void | backend/RPC | double-refund guard موجود (409) |
| `stock_movements` | **backend كتابة حصرية** (checkout/void/purchase) | Supabase RPC (RPC-V1 مثبت) | backend/RPC | inventory.updated_at إصلاح 2B |
| `inventory` | backend (nصفحة) + قراءة admin | Supabase (RPC) | backend/RPC | — |
| `cash_registers` | backend daily-shifts endpoints + مقدرة محلية للمعروض (لا كتابة لوحة غير مدفوعة) | Supabase | backend/RPC | expected يُشتق server-side (عقد التقارير) |
| `purchases` | backend CRUD (ofer خراج) + Admin UI محلي | CRUD/Supabase | backend أو LuccaDB حسب الوضع | — |
| `expenses` | backend CRUD specialty | CRUD/Supabase | حسب الوضع | حدود batman add_expense |

> **نتيجة مستقيمة**: في أي وضع، أي أداة تتوجه للكتابة المالية **لا تستخدم مسارين بديلين**. الاختراق الوحيد المعروف (P3) مُعالج بالغطاء.

---

## 3) الكتالوج والعمليات

| الكيان | محلي | سحابي | السلطة | ملاحظات |
|---|---|---|---|---|
| `categories` / `products` / `product_modifiers` / `product_variations` / `product_recipes` | IndexedDB (LuccaDB) — مصدر العرض الأصلي | Supabase | IndexedDB محليًا، Supabase سحابيًا | كتبهُ Admin UI؛ backend يعكس عبر sync |
| `payment_methods` / `taxes` / `discounts` / `tables` / `tables_store` | IndexedDB | Supabase | كالتالي | — |
| `employees` / `users` / `attendance` / `shifts` / `invitations` | IndexedDB (employees) + backend (users/attendance) | Supabase | كالتالي | users الإدارة عبر backend auth فقط |
| `settings` | IndexedDB + special endpoints (backend) | Supabase | — | device يقرأ، admin يكتب (RBAC) |
| `customers` | IndexedDB + backend CRUD | Supabase | — | — |

---

## 4) الملكية والقراءة للماليات (من الجهة المصدرية المستهدفة)

كل كيان مالي يُقرأ عبر **back end مفرد** ثم يُعرض في كل الواجهات (Admin، POS، Batman، dashboard) عبر ReportingService وفي المحلي أولًا عبر AdminAnalytics المحلي — مع الاتفاق الصارم في CANONICAL_REPORTING_CONTRACT أن المصدر الوحيد للقراءة المالية هو backend reportService (أو RPC المطابق في supabase).

---

## 5) ما لا يُمسّ (Ownership غير قابلة للتفاوض وقت الحالة الحالية)

- **لا inventory write من POS sidebar مباشرة** — POS فقط checkout/void عبر backend.
- **لا payments write من Admin UI** — عبر backend/RPC checkout.
- **لا refunds write إلا عبر /void أو /refunds backend** — مثبت 409 guard و p1-followup.
- **لا sync write للماليات في وضع supabase** — الحماية P3.

هذه القيود تُنقل كما هي إلى عقد التنفيذ Phase 2+. أي تغيير يتطلب عقد انتشار جديد موثّق (وأولًا تشغيل الاختبارات الست baseline، ثم تأكيد).