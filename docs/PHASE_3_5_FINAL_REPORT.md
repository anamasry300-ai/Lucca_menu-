# التقرير النهائي — المرحلة 3.5: تقارب الإدارة والتحديث المعماري الآمن

> **المرحلة**: Phase 3.5 — Admin Convergence & Safe Architectural Modernization
> **التاريخ**: 2026-09-23 | **الفرع**: `main` (آخر commit مرجعي `5b1b047 fix(batman): repair decision too`)
> **المخرجات**: هذا التقرير + `docs/ADMIN_FEATURE_MIGRATION_MATRIX.md` + `docs/ADMIN_TARGET_ARCHITECTURE.md` + التغييرات الآمنة الموثّقة أدناه.
> **المنهج**: audit-first → خط أساس → خريطة معمارية → جرد ميزات → جرد التكرارات → عقدا المصفوفة والمعمارية → تغييرات آمنة فقط → انحدار كامل → هذا التقرير.

---

## 1) الملخص التنفيذي

- خريطة كاملة لموقع كل طبقة في منطقتي العمل (POS `index.html` الإدارية + `admin/*`) وتقاربها نحو معمارية واحدة: **غلاف موحّد (control-center) + محوّل API مشترك + قراءة/كتابة سيرفرية عبر `/api/cc/*`**.
- التغييرات المنفّذة في هذه المرحلة **ضمن نطاق الآمن فقط**: محوّل مشترك جديد `admin/admin-api.js` (إضافي)، تفويض صغير في `control-center.html` مع fallback صفري المخاطر، اختبار انحدار جديد، ومستندان عقدان للمراحل التالية. **لا حذف، لا إعادة كتابة، لا مخطط، لا صيغ مالية، لا صلاحيات.**
- الانحدار قبل/بعد: كل الأرقام خضراء وبلا تغيير (التفاصيل §2).

## 2) خط الأساس (قبل / بعد)

| المجموعة | قبل | بعد | ملاحظة |
|---|---|---|---|
| `npm run build` (tsc) | نظيف | نظيف | بلا errors/warnings |
| `backend npm test` (7 مجموعات) | **258/258** | **258/258** | guard 16 + idempotency 9 + runtime-smoke 13 + p0 57 + p1 67 + phase4 61 + phase5 35 |
| `c2-tests/run-tests.js` | 17/17 | 17/17 | safe-sync-engine |
| `c2-tests/accounting-tools.cjs` | PASS (17/17) | PASS (17/17) | |
| `c2-tests/knowledge-unit.cjs` | PASS (12/12) | PASS (12/12) | |
| `scripts/test-admin-analytics.cjs` | 32/32 | 32/32 | لم يُلمس |
| `scripts/test-shifts.cjs` | PASSED | PASSED | لم يُلمس |
| `scripts/test-employee-invite.cjs` | PASSED | PASSED | لم يُلمس |
| `c2-tests/rpc-v1-checkout-model.cjs` | 16/16 | — (مستقل) | يُشغَّل وحده |
| **`scripts/test-admin-api.cjs` (جديد)** | — | **21/21** | اختبار المحوّل الجديد |
| `scripts/test-supabase-adapter.cjs` | **FAIL** (بيزلين) | **FAIL** (نفسه) — بلا علاقة بالمرحلة | انظر §2.1 |
| `c2-tests/live-parity.cjs` + `server-smoke.cjs` | ECONNREFUSED | ECONNREFUSED | يحتاجان سيرفر حيّاً على localhost:3000 — لم يُشغَّلا عمدًا (تجنّب لمس قاعدة البيانات الحقيقية) |

### 2.1 شذوذ خط الأساس المُوثّق (قبلي — لا علاقة له بالمرحلة)

- **`scripts/test-supabase-adapter.cjs` يفشل عند السطر 72**: `L.Employees.invite must exist on Supabase adapter`.
- **السبب المُثبَت**: بوابة `supabase-db.js:16` — `if ((localStorage.getItem('luccaDataMode') || 'local') !== 'supabase') return;`. في Node بلا `localStorage` يرمي استثناءً فيتم العودة المبكرة (`supabase-db.js:19-21`) فلا يُضبط `window.LuccaDB` أبداً فيصبح `L` غير معرّف. عند حقن `localStorage` بقيمة `luccaDataMode='supabase'` يُحمَّل المحوّل وتوجد `Employees.invite` فعلاً.
- **القرار**: الاختبار أقدم من البوابة (مكتوب قبلها)، وطبقة الـ Supabase الماليّة السحابية خارج نطاق المرحلة الحالية (عدم تغيير طبقة سحابية مالية ممنوع صراحةً) — يُوثَّق ويُؤجَّل **دون إصلاح** (لا تعديل توقعات، لا تخفيف، لا تغيير للبوابة).

## 3) نتائج خريطة المعمارية

- **المسار الخلفي**: كل نقطة `/api/*` تمرّ بـ `requirePermission` → `services/*` → `repositories/*` → SQLite؛ الصلاحيات مركزة في `ROLE_PERMISSIONS` (`backend/src/auth.ts:119-150`)؛ الترقيم `pageResult` في `backend/src/pagination.ts`؛ الأخطاء `DomainError` في `backend/src/errors.ts` (الترتيب: validations → RBAC → DomainError → 500).
- **منطقة الإدارة موزّعة على ثلاثة أغلفة**: `admin/index.html` (20 شاشة تراثية عميلية)، `admin/dashboard.html` (لوحة رقمية سيرفرية منفصلة)، `admin/control-center.html` (الغلاف الموحّد الهدف — 16 قسماً، يتحدث حصراً `/api/cc/*` + `/api/auth/*`، بلا iframes).
- **ثلاث طبقات مالية متوازية موثّقة** (contract §2): حساب عميلية (`AdminAnalytics.compute` على IndexedDB)، موحّد سيرفري (`reportService`/`accountingService`)، ومحلي (`LuccaDB`) — افتراق معروف `gross`/`net`/AOV/خصومات/فلاتر، يُحسم في Phase 4 بعد parity (القاعدة D8/D9: لا نقل بصري قبل تطابق).
- **مزامنتان بصيغتين** (contract D7): `ServerSync`/`SyncQueue` vs `sync-engine` — توثيق فقط، لا تطبيق.

## 4) الوظائف المكرّرة (Duplicate Functionality)

| التكرار | المواضع | المصير |
|---|---|---|
| لوحة المؤشرات ×3 | `admin/index.html` + `dashboard.html` + `control-center.html` | تقارب نحو CC (مصفوفة §2.1) |
| حسابات KPIs مالية | `admin/admin-analytics.js` (عميل) ↔ `reportService` (سيرفر) | `DUPLICATED` — تطابق رقمي إلزامي في Phase 4 قبل أي نقل |
| قوائم الكتالوج/العمليات | وحدات `index.html` ↔ وحدات CC (Tier1/Tier2 مكتملة في السيرفر) | CC هي الهدف؛ الوحدات القديمة تبقى لوظائف `LEGACY` |
| فحص النظام | `admin/system-health.js` ↔ `renderSystem` في CC | CC معروضة؛ `system-health.js` تبقى مستخدمة من أداة LLM — بلا وحدة ثالثة |
| مسار الترقيم | `.slice` في الذاكرة (legacy) ↔ `pageResult` سيرفري (CC) | يُستبدل تدريجياً بنقل الصفحات |

## 5) ملخّص مصفوفة الهجرة (`ADMIN_FEATURE_MIGRATION_MATRIX.md`)

| الحالة | العدد | أبرز الأمثلة |
|---|---|---|
| MIGRATED | 12 | تقارير، كتابات Tier1/Tier2، حضور، شيفتات، مخزون، auth، صحة (CC) |
| DUPLICATED | 10 | لوحة KPIs، قوائم legacy، تقارير legacy |
| READY_TO_MIGRATE | 3 | طلبات مقسمة، سجل التدقيق، أداة باتمان |
| BLOCKED | 1 | إدارة المستخدمين/الأدوار (فجوة RBAC — Phase 6) |
| LEGACY | 5 | نسخ احتياطي، إعدادات، طابعة، KB، system-health.js |
| KEEP | 6 | checkout/void/refund، POS، مزامنة، أدوات باتمان، reset admin |

## 6) التغييرات المنفّذة (النطاق الآمن فقط)

1. **`admin/admin-api.js` (جديد — إضافي)**: محوّل الطلبات الموحّد `window.AdminApi` — `baseUrl()/token()/apiKey()/hasAuth()/authHeaders()/request()/write()` + واجهة حقن مخازن `use()` للاختبار؛ يمرّر المسار كما هو (بلا بادئة baseUrl → بلا أثر شبكي)، مظروف مطابق للإنيلاين `{ok,status,j}` + مظروف فشل `net:true` برسالة خطأ عربية، تسلسل مصادقة `Bearer` ثم `x-api-key`.
2. **`admin/control-center.html` (تفويض آمن)**: إضافة `<script src="admin-api.js">` في `<head>`؛ `api()` تفوّض إلى `AdminApi.request` إن وُجدت وإلا تستمر بنفس التنفيذ الإنيلاين — **fallback = سلوك مطابق قبل/بعد التعديل**.
3. **`scripts/test-admin-api.cjs` (جديد)**: 21 تحقق (عناوين/مصادقة/مظاريف نص وشبكة/تمرير المسار/الكتابة/العمل بلا مخازن).
4. **`docs/ADMIN_FEATURE_MIGRATION_MATRIX.md`**: عقد الهجرة (28 صف ميزة × 13 عمود).
5. **`docs/ADMIN_TARGET_ARCHITECTURE.md`**: العقد المعماري (16 محوراً + رسم ASCII + سجل تغيير).

## 7) الأمان و RBAC

- بلا إضعاف: لا تغيير في `requirePermission`/`ROLE_PERMISSIONS`/مصفوفة batman؛ لا حواجز أمامية بحتة (الواجهة تعتمد `scope` و `403` من السيرفر).
- المحوّل الجديد لا يكشف أسراراً ولا يضبط مفاتيح قابلة للضبط من الشات؛ يقرأ من storages فقط.
- نتائج مثبتة بلا تغيير: 401/403 لجميع النقاط الإدارية الحساسة (guard-regression 16/16)، `device` بلا `refunds.write` → 403، `cashier بلا tables.write` → 403، SSRF gates 400.

## 8) التكامل المالي

- **صفر تغيير**: لا صيغة مالية، لا `/api/orders/:id/checkout|void`، لا `reportService.calculateOrderFinancials`، لا حارس CRUD.
- الأرقام مثبتة بعد التغيير: p0 (57/57) + p1 (67/67) + checkout-idempotency (9/9) + runtime-smoke (13/13) + phase4 (61/61) — إجمالي 214 تحقّقاً مالياً/نقدية خضراء.

## 9) المزامنة و Supabase

- **بلا تغيير**: لا `DB_VERSION`، لا `POST /api/sync` سلوك، لا `deploy/supabase-*`، لا بوابة `index.html:5346` للوضع السحابي.
- `run-tests.js` 17/17 يؤكد تطابق safe-sync-engine (نافذة الغموض، newestWins، عدم حذف، rollback ذرّي) قبل/بعد.

## 10) باتمان

- **بلا تغيير**: لا `decisionService.ACTIONS`، لا مصفوفة، لا `phase5-decision-layer` (35/35 أخضر). المصفوفة/السجل تبقيان في `dashboard.html`؛ لا نسخ من الصلاحيات في الواجهة.

## 11) الانحدار (النتيجة)

- قبل: 258/258 backend + 17 + 17 + 12 + 32 + shifts + invite (+ rpc-v1 16 مستقلاً).
- بعد: **258/258 + 17 + 17 + 12 + 32 + shifts + invite + 21/21 (جديد)** — بلا تنزيل نقطة واحدة.
- بيزلين معروفان ومستقلان عن المرحلة: `test-supabase-adapter` (§2.1) و`live-parity`/`server-smoke` (يحتاجان سيرفر حيّاً).

## 12) المخاطر

| الخطر | الاحتمال/التأثير | التخفيف |
|---|---|---|
| تفويض `api()` يغيّر سلوك CC | منخفض | مظاريف/تمرير مسار متطابق مثبتاً بالاختبار + fallback إنيلاين محفوظ؛ اختبار يفحص المسار كما هو |
| `AdminApi` لا تقرأ توكن CC بعد `sessionExpired` | منخفض | CC تكتب/تحذف `sessionStorage.luccaToken` في كل مساراتها (login/401/logout) — المصدر نفسه |
| ازدواج مصدر للعنوان (`luccaServerUrl`) | منخفض | مصدر واحد موحّد داخل المحوّل (يُستهلك الآن فقط عند تفعيله) |
| فجوة الأدوار القديمة (كتابة IndexedDB) | عالٍ (قائم) | موثّقة `BLOCKED` — لا تُعالَج هنا، تُحسم Phase 6 |

## 13) المرحلة التالية المقترحة

**Phase 4 — تقارب الأرقام**: live-parity على `/api/reports` vs `AdminAnalytics`، توحيد `netSales`/خصومات (`Σ discountAmount`)/AOV/الهامش/الفلاتر، إعادة تسمية `gross`، ثم نقل قراءة لوحة `index.html` إلى `/api/cc/reports/:type` — بعد تثبيت التطبيق فقط، مع رفع شذوذ `test-supabase-adapter` بقرار منفصل (إصلاح هارنس الاختبار أو بوابة الوضع) خارج نطاق الأرقام.

---

## Changed Files

| الملف | التغيير | السبب | الخطر |
|---|---|---|---|
| `admin/admin-api.js` | **جديد** — محوّل API مشترك (إضافة خاملة) | أصل التقارب: مصدر واحد للعنوان/التوكن/المظاريف | منخفض (لا مستهلك إلزامي) |
| `admin/control-center.html` | إضافة وسْم سكربت + تفويض `api()` مع fallback إنيلاين | تبنّي المحوّل آمناً تدريجياً | منخفض (سلوك مطابق قبل/بعد) |
| `scripts/test-admin-api.cjs` | **جديد** — 21 تحقق | انحدار للمحوّل | منخفض (معزول) |
| `docs/ADMIN_FEATURE_MIGRATION_MATRIX.md` | **جديد** — عقد الهجرة | مخرَج المرحلة | لا رمز |
| `docs/ADMIN_TARGET_ARCHITECTURE.md` | **جديد** — العقد المعماري | مخرَج المرحلة | لا رمز |

(الملفات `M` الأخرى في `git status` — `backend/src/*`, `index.html`, `supabase-db.js`, `admin/database.js`, `admin/index.html`, `deploy/*`, وأغلب `??` — **من مراحل سابقة غير مُلتزمة** (uncommitted work للمستخدم): لم تُمسّ في هذه المرحلة؛ راجع `git diff` قبل أي التزام.)

## Untouched Critical Files

`backend/src/routes/*` (auth/controlCenter/sync/orders/payments), `backend/src/auth.ts` (RBAC), `backend/src/services/reportService.ts` + `accountingService.ts` + `salesService.ts` (صيغ مالية), `backend/src/repositories/*`, `backend/src/index.ts` (تعديلات المرحلة/المراحل السابقة كما هي), `backend/migrations/*`, `index.html` (POS + بوابة `:5346` السحابية), `admin/database.js` (IndexedDB v9 / 36 مخزناً), `admin/index.html`, `admin/dashboard.html`, `admin/admin-analytics.js`, `admin/system-health.js`, `supabase-db.js`, `deploy/supabase-*`, `scripts/test-admin-analytics.cjs`, `backend/test/*` (كل الاختبارات), `c2-tests/*`, `docs/*` الثمانية.

## Deferred Work

1. **إصلاح/إعادة كتابة `scripts/test-supabase-adapter.cjs`** — قرار منفصل (هارنس بلا `localStorage` مقابل بوابة `luccaDataMode`) — طبقة سحابية مالية.
2. **تشغيل `live-parity.cjs` + `server-smoke.cjs`** — يتطلب سيرفر حيّاً على localhost:3000 (6 نقاط قراءة فقط لـ server-smoke).
3. **Phase 4 تقارب الأرقام** (§13) ثم نقل قوائم legacy.
4. **Phase 6 RBAC** — إغلاق `BLOCKED` (إدارة أدوار/مستخدمين عبر `/api/users` بدل كتابة IndexedDB في `index.html:4309`).
5. **دمج `dashboard.html` في CC، سجل التدقيق في CC، أداة باتمان في CC، توحيد طابور المزامنة (D7)** — test-first.
6. **تفعيل `AdminApi` في بقية الأسطح** (`admin/index.html` / `dashboard.html`) — عندما يحين دور كل سطح، مع فحص توافق `ServerAPI` الحالي.

---

*نهاية التقرير — المرحلة 3.5 مكتملة بمخرجاتها الخمسة وكل الأرقام موثّقة أعلاه.*