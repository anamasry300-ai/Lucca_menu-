# H3-FIX-REPORT — تحصين تفويض الصلاحيات (Authorization) على الخادم
**التاريخ:** 2026-08-31
**المرجع:** `H3-SECURITY-AUDIT.md` (تشخيص الفجوات) + اعتمادك «توحيد CRUD كاملاً على ROLE_PERMISSIONS».
**النطاق:** تنفيذ H3 فقط (توحيد/تحصين التفويض داخل CRUD العام + إصلاح G2/G3/G4). لم أبدأ H5/H6 ولا أي تعديل على منطق الضرائب.
**المبدأ:** تعديلاتي على القواعد/المخازن مؤقتة للاختبار فقط؛ بيانات الإنتاج لم تُمسّ؛ نسخة احتياطية كاملة قبل التعديل.

---

## 1) الفجوات المغلقة (من H3-SECURITY-AUDIT)
| # | الفجوة | الحل |
|---|---|---|
| G1 | `crud.ts` يعيد اختراع التفويض (`WRITE_ADMIN_STORES` يدوية بلا `ROLE_PERMISSIONS`) → مفتاح الجهاز/الكاشير يكتب مخازن للقراءة فقط (inventory/products/categories) | تفويض كتابة لكل مخزن من `ROLE_PERMISSIONS` للأدوار المحدودة |
| G2 | قراءة `settings` متناقضة (crud 403 لـ device مقابل special 200) | device يقرأ settings عبر crud أيضاً (200) — متّسق مع special |
| G3 | قراءة `daily_shifts` متناقضة بين crud و special | crud يمنع device عن daily_shifts (إداري/مدير فقط) كـ special — متّسق |
| G4 | CORS `allowedHeaders` ينقص `x-session-token` | أُضيف إلى `allowedHeaders` |

---

## 2) التغييرات

### `backend/src/routes/crud.ts`
- استُبدل `readDenied`/`writeDenied` المستقلّان بخريطة تفويض منسجمة مع `ROLE_PERMISSIONS` عبر `roleHas` (مصدر حقيقة واحد).
- **القراءة (readDenied):** القراءة الوظيفية (POS/المزامنة pull) تبقى لكل هوية موثَّقة كما في وضع H2/C2؛ تُقيَّد فقط المخازن الحساسة للإداري/المدير: `users` (تسريب hashes كلمات المرور)، `audit_logs` (سجل نشاط)، `daily_shifts` و `shifts` (إدارة كاش). `device` يقرأ `settings` (كـ special) — إصلاح G2/G3.
- **الكتابة (writeDenied):**
  - `admin`: كل شيء.
  - `manager` (إداري/مدير غير admin): يُمنع فقط عن المخازن الإدارية الحساسة (`WRITE_ADMIN_STORES`) — **يحتفظ بسير عمله، لا إقفال**.
  - `device`/`cashier`/`kitchen`: يُقيَّدون بصلاحية كتابة المخزن من `STORE_WRITE_PERM`/`ROLE_PERMISSIONS` → **لا يستطيعون كتابة مخازن للقراءة فقط** (inventory/products/categories...) — إصلاح R1/R2.
- `STORE_WRITE_PERM`: خريطة كل مخزن → صلاحية كتابته من `ROLE_PERMISSIONS` (orders/customers/tables/inventory/employees/attendance/expenses/shifts/daily_shifts/categories/products/product_modifiers/product_variations/product_recipes/payment_methods/payments/purchases/refunds).
- الحذف (deleteDenied): بقي إداري/مدير فقط (لا دور محدود يملك إزالة) — دون تغيير.

### `backend/src/index.ts`
- أُضيف `'x-session-token'` إلى `allowedHeaders` الخاص بـ CORS (إصلاح G4 — يطابق ما يقبله `resolveIdentity`).

### ملفات لم تُلمس
- لم تُغيّر خريطة الأدوار/الصلاحيات نفسها (`ROLE_PERMISSIONS`) ولا `ADMIN_ONLY_STORES` الخاصة بالمزامنة (خارج نطاق H3).
- لا ملاحظة على الواجهة (Frontend) — H3 خادم فقط.

---

## 3) اختبارات (قواعد/مخازن مؤقتة فقط)
`C:\...\Temp\opencode\h3-authz.cjs` (**36 اختباراً**):
- **G1 (إصلاح R1/R2):** device لا يُنشئ/يعدّل inventory/products/categories (403)؛ cashier لا يُنشئها (403)؛ manager إنشاء inventory (201)؛ admin إنشاء categories (201).
- **G2:** device يقرأ settings من crud **و** special (200/200 متسقان)؛ cashier لا يقرأ settings (403).
- **G3:** device لا يقرأ daily_shifts (403)؛ admin يقرأها (200).
- **قراءة حساسة:** device لا يقرأ users/audit_logs (403).
- **قراءة وظيفية (C2 pull):** device يقرأ invoices/suppliers/waste_log/taxes/stock_movements (200) — لا تكسر المزامنة؛ لكن device **لا يكتب** taxes/invoices/discounts (403).
- **إيجابيات التشغيل (لا قفل):** device يُنشئ/يحدّث orders ويُنشئ customers ويقرأ products (200/201).
- **لا إقفال للمدير:** manager يقرأ ويُكتب taxes (200/201) وينفّذ tables (لا 401/403)؛ cashier لا يكتب taxes (403).
- **حذف:** device لا يحذف (403)؛ admin يحذف (200).

**إعادة اختبارات عدم الانحدار (كلها خضراء):**
| المجموعة | النتيجة |
|---|---|
| H3-AUTHZ | 36/36 PASS |
| H2-SECURITY | 40/40 PASS |
| H2-EXPIRY | PASS |
| C2-AUDIT2 | 26/26 PASS |
| C2-SERVER-SMOKE | 6/6 PASS |
| C2-SAFE-SYNC | 15/15 PASS |
| H1-SECURITY | 29/29 PASS |
| tsc/build (backend) | exit 0 |
| check-html-syntax | exit 0 |

> ملاحظة توافق: أثناء التطوير، تبيّن أن تقييد القراءة لكل المخازن المالية (invoices/suppliers/waste_log...) كان سيكسر **المزامنة (C2 pull)** — فالأجهزة (kiosk) تحتاج قراءتها. لذلك أبقيتُ القراءة الوظيفية كما هي (لا escalation في القراءة) وشدّدتُ **الكتابة** فقط، حيث الخطر الحقيقي (R1/R2). `.js` الاختبار عُدّل ليعكس ذلك.

---

## 4) المخاطر المتبقية / الملاحظات
- **مرجعية manager vs خريطة الأدوار:** `manager` يحتفظ بسلوك H2 (يكتب ما عدا المخازن الإدارية الحساسة) رغم أن `ROLE_PERMISSIONS` لا يذكر صراحةً `tables.write`/`taxes`... هذا قرار متعمّد لتفادي إقفال سير عمل المدير. لو أراد المستخدم لاحقاً تطبيق `ROLE_PERMISSIONS` حرفياً على manager، فسيُضاف `tables.write` وغيرها لخريطة المدير أولاً.
- **device يقرأ ضرائب/فواتير/موردين (200):** قراءة وظيفية متعمّدة للـ POS/المزامنة؛ لا يكتبها. إن أُريد إغلاقها يجب أولاً تغيير نموذج المزامنة (خارج H3).
- **المخازن الإدارية الحساسة للكتابة** (users/settings/audit_logs/daily_shifts/shifts/refunds/suppliers/stock_movements) تبقى إداري/مدير فقط للأدوار المحدودة.

---

## الخطوة التالية
أوقفت العمل عند اكتمال H3 (كل الاختبارات خضراء) انتظاراً لموافقتك قبل البدء بأي مرحلة تالية. لم أبدأ H5/H6 ولا أي تعديل على منطق الضرائب.
