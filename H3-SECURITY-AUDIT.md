# H3-SECURITY-AUDIT — تدقيق تفويض الصلاحيات (Authorization) على الخادم
**التاريخ:** 2026-08-31
**النطاق:** تفويض الصلاحيات (Authorization) لكل مسارات `/api/*` على الخادم — تنظيف وتوحيد وتحصين التطبيق الفعلي لخريطة الصلاحيات `ROLE_PERMISSIONS`.
**المبدأ:** لم أُعدّل أي كود بعد — هذه المرحلة تشخيص فقط قبل التغيير (H3).

---

## 1) ما أُنجز في H2 (الخلفية)
- أُنشئت خريطة صلاحيات `ROLE_PERMISSIONS` في `auth.ts` (admin/manager/cashier/kitchen/device) مع `roleHas`/`requirePermission`/`requireRole`.
- كل الأدوار المعرّفة تنفّذ الصلاحيات على نطاق الدور.

## 2) الفجوات في التطبيق الفعلي للتفويض (Authorization Enforcement)

### G1 — `crud.ts` يعيد اختراع التفويض خارج إطار `ROLE_PERMISSIONS`
- `readDenied`/`writeDenied`/`deleteDenied` (سطور 28-47) تستخدم قوائم صلاحيات `ADMIN_ONLY_STORES`/`WRITE_ADMIN_STORES` مكتوبة يدوياً، **لا** `roleHas` ولا `ROLE_PERMISSIONS`.
- **نتيجة خطيرة:** `WRITE_ADMIN_STORES` لا تتضمن `inventory`/`products`/`categories`/`customers`.
  - `ROLE_PERMISSIONS.device` يملك **`inventory.read` فقط** (بلا `inventory.write`)، لكن `writeDenied` لا يمنع مفتاح الجهاز (device) من `POST/PUT /api/inventory` → **تصعيد: يمكن لمفتاح الجهاز تعديل المخزون** رغم أن النموذج يمنعه.
  - بالمثل device يكتب `products`/`categories` عبر CRUD رغم أنه يملك قراءةً فقط (`products.read`/`categories.read`).
- **مخالفة لمبدأ `ROLE_PERMISSIONS`:** قوائم H2 المحذرة (`ADMIN_ONLY_STORES`) أضيق من خريطة الصلاحيات → فجوات كتابة لكل الأدوار غير الإدارية.

### G2 — تناقض قراءة `settings` بين مسارين
- `crud.ts GET /api/settings` (مخزن) → يمنع device (`ADMIN_ONLY_STORES.settings` + ليس adminish) → **403**.
- `special.ts GET /api/settings` → `requireSettingsRead` يسمح device → **200**.
- نفس البيانات بإجابتين مختلفتين بحسب المسار. سلوك غير متناسق.

### G3 — تناقض قراءة `daily_shifts` بين مسارين
- `ROLE_PERMISSIONS.device` يملك `daily-shifts.read`، لكن هدف مخزن `daily_shifts` في `crud.ts` محظور على device (`ADMIN_ONLY_STORES`).
- `special.ts GET /daily-shifts` → `requireAdminish` يمنع device (أيضاً 403). تناقض ثالث.

### G4 — `CORS allowedHeaders` ينقص `x-session-token`
- `auth.ts:168` يقبل `x-session-token` كتضمين جلسة، لكن `index.ts:76` `allowedHeaders: ['Content-Type','x-api-key','Authorization']` لا يذكره → قد يُحجب من بعض الأنماط عبر CORS.

### G5 — التطبيق اليدوي المتعدد (لا مرجع واحد)
- `crud.ts` (`readDenied/writeDenied/deleteDenied`)، `special.ts` (`requireAdminish`/`requireSettingsRead`)، `analytics.ts` (`requirePermission('reports.read')`)، `index.ts` (`apiKeyCheck` + `requirePermission` يدوياً) — أنماط متفرقة معرّضة للتملّك/الانحراف مستقبلاً.
- الهدف من H3: **توحيد تطبيق التفويض على `ROLE_PERMISSIONS`** (مصدر حقيقة واحد) بدل قوائم مبعثرة.

## 3) مخاطر محدّدة ناتجة عن الفجوات
| # | السيناريو | الدور المتضرر | الشدة |
|---|---|---|---|
| R1 | مفتاح جهاز (device) يعدّل المخزون/المنتجات/الأصناف عبر `POST/PUT /api/inventory|products|categories` رغم أنه يملك قراءةً فقط | device (كشك/نقل) | عالية |
| R2 | كاشير (cashier) يكتب مخزناً/منتجات/أصناف رغم أنه يملك قراءةً فقط | cashier | عالية |
| R3 | قراءة settings/فروق يومية بإجابات متناقضة بين المسارات | device | متوسطة |
| R4 | `x-session-token` قد يُحجب عبر CORS | أي مستخدم يستخدم التضمين | منخفضة |

## 4) نطاق H3 (المقترح)
1. **إعادة بناء تفويض `crud.ts` على خريطة `ROLE_PERMISSIONS`**: لكل store، تحديد صلاحية قراءة/كتابة/حذف للمخزن من خريطة الصلاحيات (مصدر حقيقة واحد) بدل `WRITE_ADMIN_STORES` اليدوية.
2. **إصلاح G2/G3**: جعل قراءة settings/daily-shifts متسقة مع خريطة الصلاحيات عبر كل المسارات (device يقرأ ما يملكه فقط).
3. **إضافة `x-session-token`** إلى `allowedHeaders` CORS.
4. **حذف الحذف العام غير التفصيلي** لا يتغيّر (يبقى admin/manager فقط) — تأكيد عبر `ROLE_PERMISSIONS` حيث لا دور غير الإداري يملك إزالة.
5. **اختبارات H3** على قاعدة مؤقتة تغطي G1-G5 مع إعادة الاختبارات السابقة (H2/C2).

## 5) خارج النطاق (لعدم المساس)
- لا تغيير على منطق الضرائب.
- لا تغيير على جوهر H1/H2 (المصادقة/الجلسات/المفتاح).
- لا معالجة على منطق `sync` (يديره `ADMIN_ONLY_STORES` + `isAdminish` في H2 — خارج هذه المرحلة إلا ما يندرج تحت توحيد القراءة/الكتابة للمخازن).
- لا إعادة تصميم للأدوار نفسها، بل توحيد تطبيقها.

---

## خلاصة
التفويض الأساسي (H2) قائم ويمنع الأدوار الضعيفة من كثير من العمليات، لكن **تطبيقه على CRUD العام مبعثر وقابل للانحراف**: `writeDenied` يسمح لمفتاح الجهاز/الكاشير بكتابة مخازن يفترض النموذج أنها للقراءة فقط (المخزون/المنتجات/الأصناف)، وقراءة settings/daily-shifts متناقضة بين المسارات. H3 يوحّد كل تطبيق التفويض على مصدر حقيقة واحد (`ROLE_PERMISSIONS`) ويقفل هذه الفجوات، مع اختبارات.

**الخطوة التالية قبل أي تعديل:** اعتماد نطاق H3 أعلاه منك، ثم تنفيذ + اختبارات + تقرير `H3-FIX-REPORT.md`. أنتظر موافقتك.
