# المعمارية المستهدفة لمنطقة الإدارة (Admin Target Architecture)

> المستند: `docs/ADMIN_TARGET_ARCHITECTURE.md` — مخرج Phase 3.5 (Admin Convergence & Safe Architectural Modernization).
> الحالة: **عقد تصميمي** يصف الشكل النهائي لمنطقة الإدارة وخطة التقارب الآمنة — القابل للتنفيذ في Phase 3.5 فقط (آمن/إضافي/قابل للتراجع).
> المراجع: `ADMIN_FEATURE_MIGRATION_MATRIX.md`, `CANONICAL_REPORTING_CONTRACT.md`, `RBAC_MATRIX.md`, `DATA_OWNERSHIP_MATRIX.md`, `SYNC_CONTRACT.md`, `BATMAN_ARCHITECTURE.md`, `ADMIN_REENGINEERING_PLAN.md`.

---

## 1) الهدف (Objective)

توحيد منطقة الإدارة — الموزّعة اليوم بين صفحات متعددة ومصادر بيانات متوازية — على معمارية واحدة:
**غلاف واحد (مركز التحكم) + محوّل API مشترك + قراءة/كتابة سيرفرية + تقارير من موصّد أرقام واحد**، دون كسر المسار المالي الساخن أو المخطط أو الصلاحيات، وبكل تغيير قابل للتراجع.

## 2) المبادئ الملزمة (Principles)

| # | المبدأ |
|---|---|
| P1 | كل تغيير **آمن**: إضافي أو استبدالي قابل للتراجع؛ لا حذف وظيفة قائمة. |
| P2 | **لا تغيير financial formula** في هذه المرحلة — اختلافات الصيغ موثقة في العقد وتُحسم في Phase 4 (`CANONICAL_REPORTING_CONTRACT.md §2`). |
| P3 | **لا تغيير schema** (IndexedDB v9 / SQLite migrations قائمة / Supabase) في Phase 3.5. |
| P4 | **لا إضعاف RBAC** — الواجهة تلتزم بالقرار السيرفري (scope/403) ولا تُنشئ حواجز أمامية خادعة. |
| P5 | **الرقم المالي من السيرفر** (`reportService`/`accountingService`) هو المرجع؛ الحساب الأمامي للعرض فقط. |
| P6 | الواجهة تعلّق على القرار السيرفري (`401/403/0`) — لا تحسم الصلاحيات في المتصفح. |
| P7 | أي مسار مالي/حارس في «لا تلمس» (`ADMIN_REENGINEERING_PLAN.md §14`) يبقى كما هو ما لم يُثبت خلاف ذلك. |
| P8 | كل نقل مدعوم بـ **اختبار تطابق (parity)** أولاً (عقيدة D8/D9). |

## 3) الرسم المعماري (ASCII)

```
                        ┌─────────────────────────────────────────────────────┐
                        │              Admin — Target Shape                    │
                        │                                                     │
   LEGACY (يُستبدل)     │   control-center.html  (الغلاف الموحّد — الهدف)       │
 ┌──────────────────┐   │   ┌───────────────┐  dashboard │ orders │ stock │    │
 │ admin/index.html │   │   │   AdminApi    │  categories │ cash │ reports     │
 │  (20 صفحة تراثية)│ ──▶│   │ (admin-api.js)│  system │ employees │ ...        │
 │ dashboard.html   │   │   └──────┬────────┘                                   │
 │ system-health.js │   │          │ fetch + Bearer / x-api-key                 │
 │ admin-analytics  │   │          ▼                                            │
 └──────────────────┘   │   ┌──────────────────────────────────┐                │
                        │   │  Backend (SQLite localhost:3000)  │               │
 DEAD/DUPLICATED:       │   │  ┌────────────────────────────┐   │               │
 Client money math     │   │  │ RBAC: requirePermission    │   │               │
 (AdminAnalytics) ─────▶│   │  │ / requireRole + scope      │   │               │
  يُقارب في P4          │   │  └──────────┬─────────────────┘   │               │
                        │   │             ▼                      │               │
                        │   │  ┌────────────────────────────┐   │               │
                        │   │  │ Services (Business Layer)  │   │               │
                        │   │  │ accounting/sales/inventory │   │               │
                        │   │  │ expense/purchase/shift/…   │   │               │
                        │   │  └──────────┬─────────────────┘   │               │
                        │   │             ▼                      │               │
                        │   │  ┌────────────────────────────┐   │               │
                        │   │  │ Repositories (queryAll/… ) │   │               │
                        │   │  └──────────┬─────────────────┘   │               │
                        │   │             ▼                      │               │
                        │   │        SQLite schema (قائم)       │               │
                        │   └──────────────────────────────────┘               │
                        │                                                     │
   Offline POS (index.html): IndexedDB lucca_caffe_db v9 ── sync (POST /api/sync)
   Supabase (وضع supabase): PostgREST + RPC — المرآة المحمية (لا Rest مالي محلي، D6)
                        └─────────────────────────────────────────────────────┘
```

## 4) نمط صفحة الإدارة (Admin Page Pattern)

كل صفحة إدارة في الغلاف الموحّد تعتمد نفس النمط:
- **قراءة**: `AdminApi.request('/api/cc/...')` → مسار مقسم صفحات (إن أمكن) → `escape` إلزامي للعرض (`textContent` أو `esc()`).
- **كتابة**: `AdminApi.write(method, path, body)` → toast feedback → `after(r.j)` on success.
- **خطأ موحّد**: `withErr`: `401` → sessionExpired (خروج + شاشة دخول)؛ `403` → رسالة صلاحية من `r.j.error`؛ `0` → رسالة اتصال. (نمط `control-center.html:304`).
- **لا رسم للصلاحيات عميلاً**: `scope` يصل من السيرفر (`GET /api/cc`)، والأرباح تُخفيها الواجهة حين `grossProfit == null` (`controlCenter.ts:131`).

## 5) طبقات العرض الحالية → الهدف

| الطبقة الحالية | الدور | المصير |
|---|---|---|
| `admin/control-center.html` | الغلاف الموحّد (16 قسماً) | **الهدف** — يتقارب عليه كل شيء؛ يستهلك `AdminApi` |
| `admin/index.html` | لوحة تراثية (20 صفحة، قراءة IndexedDB) | يبقى للوظائف LEGACY (طابعة، نسخ، إعدادات، باتمان widget، reset admin) حتى توجد نظائر CC؛ لا يُعاد كتابته جملةً |
| `admin/dashboard.html` | لوحة رقمية سيرفرية | تُندمج أقسامها في CC؛ تبقى كملف حتى اكتمال الدمج (لا حذف) |
| `admin/system-health.js` | فحوصات النظام | يبقى (مستهلكٌ من LLM tool `getSystemHealth`)؛ CC تعرض صحتها inline (`renderSystem`) — لا نسخة ثالثة |
| `admin/admin-analytics.js` | حساب موحّد عميل (IndexedDB) | المرجع محلي فقط؛ يتقارب على `reportService` رقمياً في Phase 4 (`ADMIN_REENGINEERING_PLAN.md §5`) — لا يُعدَّل ماله الآن |
| `admin/admin-api.js` | **جديد في Phase 3.5** — محوّل الطلبات المشترك | مصدر الاتصال الموحّد للواجهات الإدارية المستقبلية؛ يُتبنى تدريجياً مع fallback |

## 6) عقد الـ API الموحّد

- **الوثيقة**: `GET /api/cc` تعيد scope + version + قائمة النقاط (يستهلكها CC في `control-center.html:1267`).
- **المظروف (envelope)**: JSON؛ الأخطاء سيرفرية عبر `errors.ts` → `{error: "..."}` مع status صحيح (400/401/403/404/409).
- **الترقيم**: `pageResult { rows, total, page, pageSize, hasMore }` (`pagination.ts:13`)؛ المسارات المقسمة في `/api/cc/*`.
- **المحتوى**: `Content-Type: application/json`؛ المصادقة `Authorization: Bearer <token>` وإلا `x-api-key` (اتفاق `ServerAPI.authHeaders`).
- **القراءة الإدارية الحساسة**: `READ_RESTRICTED`/admin-only تُؤمَّن سيرفراً (`users/audit_logs/daily_shifts/shifts`, `crud.ts:51`).

## 7) المصادقة والنطاق

- جلسات SQLite (TTL 12h) عبر `lucca_session`/Bearer؛ `mustChangePassword` يمنع العمليات المميزة قبل التغيير (H2).
- `scope`: `admin` vs `reports-only` يستنتج **سيرفراً** من `GET /api/cc` (بفحص `isAdmin`, `controlCenter.ts:39`).
- الواجهة: 401 → انتهاء الجلسة (تسجيل خروج + إعادة دخول)؛ 403 → رسالة من `r.j.error`. لا «نفدت الأذونات» محلية محضة.
- الأدوار الخمسة الحالية + مصفوفة batman (طبقة ثانية) تبقى كما هي حتى Phase 6 (جدولة roles/permissions).

## 8) الخدمات والمرجع المالي

| الخدمة | المسؤوليات (الهدف) | المستهلكون |
|---|---|---|
| `accountingService` | sales/expenses/purchases/cash/profit — `getSalesSummary/getProfitAndLoss/getCashDrawer/…` | `/api/cc/dashboard` |
| `salesService` | `calculateOrderFinancials` (canonical money), `getOrdersPage` | checkout + CC orders |
| `inventoryService` | stock pages/movements/value + adjust/waste | `/api/cc/stock*` |
| `expenseService` / `purchaseService` | ملخصات + صفحات + write | `/api/cc/expenses|purchases` |
| `shiftService` | `openDailyShift/closeDailyShift` (expected/difference مشتقة سيرفراً) | `/api/cc/shifts/*`, `cash/daily` |
| `attendanceService` | check-in/out + ساعات | `/api/cc/attendance/*` |
| `catalogService` | categories/tables/paymentMethods/products/recipes | `/api/cc/*` Tier 1 |
| `reportService` | **موصّد الأرقام الوحيد** (net/gross/COGS/profit/AOV) | `/api/reports/*`, `/api/cc/reports/:type`, `dashboard.html` |

قاعدة: أي طبقة تعرض رقماً مالياً تقرأ من هذه الخدمات (أو تطابقها بدقة parity) — لا تعيد الحساب (P5/D8).

## 9) مسارات القراءة/الكتابة

- **القراءة**: سيرفر أولاً (`/api/cc/*`, `/api/reports/*`)؛ للعرض دون اتصال، مرآة IndexedDB (كما تفعل `localDashboardFallback` اليوم) بلا أي ادعاء بأنها السجِل.
- **الكتابة غير المالية** (كتالوج/مصروفات/مشتريات/حضور/شيفتات): عبر `/api/cc/*` المكتوبة بـ `requirePermission` (Tier1/Tier2) مع `wireWrite` (DomainError→status). تبقى الرسائل المحلية `ServerAPI` الحالية (دون تغيير) حتى اكتمال التقارب.
- **الكتابة المالية** (checkout/void/refunds/stock الفعلي): **سيرفر حصراً** عبر `/api/orders/:id/checkout|void` — لا مسار أمامي موازٍ (`DATA_OWNERSHIP_MATRIX §2/§5`).
- الدفع/الاسترداد/الفاتورة: كاتب واحد لكل وضع (D5)؛ لا كتابة دفع محلية (مثبت `p1-split`).

## 10) الوضع دون اتصال (Offline Model)

- عرض من IndexedDB `lucca_caffe_db` v9 يبقى متاحاً (كتالوج/طلبات مفتوحة) — لا يُفعَّل الدفع دون اتصال.
- `ServerAPI` توقف تشغيل `noQueue` بحساسية؛ طابور REST يبقى (دون تغيير في هذه المرحلة).
- لا تغيير في `DB_VERSION` أو مخازن IndexedDB (36 مخزناً قائماً) في Phase 3.5.

## 11) المزامنة (حسب `SYNC_CONTRACT`)

- تبقى الآليات الثلاث كما هي (ServerSync دفع/سحب، POS SyncQueue، sync-engine السحابي)؛ غطاء D6 ساري.
- التعارض غير الموثّق يُسجَّل ولا يُحذف؛ `newestWins` مع فترة غموض 5s؛ لا DELETE مالي.
- توحيد الطابور موثق في D7 → Phase 10 — لا تطبيق الآن.

## 12) المحوّل المشترك `admin/admin-api.js` (تصميم)

واجهة موجهة للمتصفح (خاملة في Node للاختبار — عبر `_use()` لحقن مخازن):

| الدالة | السلوك |
|---|---|
| `baseUrl()` | `localStorage.luccaServerUrl || 'http://localhost:3000'` (زوال التكرار الثماني للعنوان) |
| `token()` | `sessionStorage.luccaToken` |
| `apiKey()` | `localStorage.luccaApiKey` |
| `hasAuth()` | وجود توكن أو مفتاح |
| `authHeaders(extra)` | `Authorization: Bearer` وإلا `x-api-key` + `Content-Type: application/json` |
| `request(path, opt)` | `fetch` بتمرير المسار كما هو (لا إعادة بادئة → لا تغيير شبكي)؛ يحول الرد حسب content-type؛ على الخطأ `{ok:false,status:0,j:{error:'تعذّر الاتصال بالخادم'},net:true}` (نمط CC) |
| `write(method, path, body)` | `request` مع `JSON.stringify(body)` |

**نموذج التبني** (متدرّج آمن): يُحمَّل في الصفحة؛ `api()` الحالية في CC تفوض إليه إن وُجد وإلا تستمر inline (fallback صفري المخاطر)؛ الواجهات اللاحقة تعتمده مباشرة. اختبار: `scripts/test-admin-api.cjs`.

## 13) RBAC والنطاق في الواجهات

- الاعتماد على `scope` السيرفري (لا فحوص أدوار أمامية للتحكم في الأقسام) — الواجهة تعرض، السيرفر يحسم (403 مع رسالة).
- الأرباح/البيانات الإدارية تُخفيها الواجهة عندما يرجعها السيرفر `null` (نمط `profitRow`, `control-center.html:356`).
- فجوة معروفة: `editUserRole` في legacy يكتب IndexedDB محلياً (`index.html:4309`) — **BLOCKED** حتى Phase 6 (`RBAC_MATRIX §5`).

## 14) الأمان

- `esc()`/`textContent` إلزامي لكل قيمة غير ثابتة قبل العرض (إصلاح نمط `dashboard.html:325` — يُطبَّق في مرحلة دمج dashboard، لا الآن).
- لا SQL أمامي؛ لا مفاتيح API قابلة للضبط من الشات (قرار A4)؛ SSRF gate قائم (`p1-ssrf`).
- لا كشف أسرار في استجابات `/api/cc` (مثبت `phase4` — «لا تسريب أسرار»).

## 15) الترقيم القياسي

- القياس: `pageResult {rows,total,page,pageSize,hasMore}`؛ CC يلتزم (حالة `{page:1,size:50}` لكل قسم + `pageBar`).
- الممنوع: وصل صفحات غير محدود في الواجهة الجديدة (legacy يقطّع `.slice(0,100)` في الذاكرة — يُستبدل بالترقيم السيرفري عند النقل).
- تقييد `pageSize ≤ 200` (`pagination.ts:7`).

## 16) خارطة الهجرة + معايير النجاح + سجل التغيير

| المرحلة | المحتوى | الحالة |
|---|---|---|
| **Phase 3.5 (الحالية)** | تدقيق + مصفوفة + معمارية + `admin-api.js` + تفويض CC إليها (fallback) + اختبار `test-admin-api` | **مكتملة هنا** — فقط تغييرات آمنة/إضافية |
| Phase 3/4 | تقارب الأرقام: AdminAnalytics ↔ reportService (parity)؛ إعادة تسمية `gross`؛ توحيد netSales (`reportService.ts:73`)، discounts (`Σ discountAmount`), AOV، الهامش، الفلاتر | قبل أي نقل بصري — بعد parity |
| Phase 5/6 | مخزون موثّق + expense_categories/purchase_items (مخطط أعمال)؛ جداول roles/permissions والحارس الموحّد → إغلاق `BLOCKED` (أدوار/مستخدمون) | بعد موافقة المخطط والصلاحيات |
| Phase 7-10 | دمج dashboard.html في CC، سجل التدقيق في CC، أداة باتمان في CC، توحيد طابور المزامنة | بلاختبارات test-first |
| Phase 11/12 | تكامل كامل + بناء إنتاج | — |

**معايير النجاح (Phase 3.5):**
1. `npm run build` + `npm test` (258/258) خضراء بلا تغيير في اختبارات قائمة.
2. `scripts/test-admin-api.cjs` أخضر؛ `test-admin-analytics` 32/32 بلا تعديل.
3. لا تغيير schema / financial formula / sync / RBAC / version؛ لا حذف ملف.
4. `control-center.html` تعمل بنفس السلوك مع `AdminApi` (fallback يضمن ذلك).
5. وثيقتا الهجرة والمعمارية مرجعيتان للمراحل التالية.

**غير الهدف (Non-goals) في هذه المرحلة:** تعديل `admin-analytics.js` الحسابي، تغيير DB_VERSION، تطبيق جداول roles، توحيد الطابور، دمج dashboard.html، أي تغيير في `deploy/supabase-*`.

## سجل التغيير (Change Control — Phase 3.5)

| الملف | التغيير | السبب | الخطر |
|---|---|---|---|
| `admin/admin-api.js` | إضافة (جديد) | محوّل الطلبات المشترك هدفه التقارب؛ يزيل تكرار الرأس/المسار | منخفض (إضافي، لا مستهلك إلزامي) |
| `admin/control-center.html` | سطر تفويض في `api()` + وسْم سكربت | تبني المحوّل بـ fallback | منخفض (سلوك مطابق للإنيلاين) |
| `scripts/test-admin-api.cjs` | إضافة (جديد) | فحص الانحدار للمحوّل | منخفض (اختبار معزول) |
| `docs/ADMIN_FEATURE_MIGRATION_MATRIX.md` | إضافة (جديد) | عقد الهجرة المطلوب | لا رمز |
| `docs/ADMIN_TARGET_ARCHITECTURE.md` | إضافة (جديد) | عقد المعمارية المطلوب | لا رمز |
| `backend/*`, `docs/*`, `admin/database.js`, `admin/index.html`, `admin/dashboard.html`, `supabase-db.js`, مخطط IndexedDB | **بلا تغيير** | قيود المرحلة | — |

---

*نهاية المستند — كل مرحلة لاحقة تحدّث «سجل التغيير» وتعيد تقييم «معايير النجاح».*