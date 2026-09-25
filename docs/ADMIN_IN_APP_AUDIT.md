# ADMIN_IN_APP_AUDIT — تدقيق إدماج الإدارة داخل تطبيق LuccaPOS Desktop (Phase 1)

> المستند: `docs/ADMIN_IN_APP_AUDIT.md` — مخرج **Phase 1 (تدقيق فقط)** لمشروع إعادة هندسة الإدارة داخل التطبيق.
> الفرع: `feature/admin-in-app-reengineering` (أنشئ من `main`).
> المراجع: `commit db5ea34`, `commit 99ab994`, `docs/ADMIN_TARGET_ARCHITECTURE.md`, `docs/ADMIN_LOGIN_FLOW_AUDIT.md`, `docs/ADMIN_REENGINEERING_PLAN.md`, `docs/RBAC_MATRIX.md`, `docs/CANONICAL_REPORTING_CONTRACT.md`, `docs/SYNC_CONTRACT.md`, `docs/BATMAN_ARCHITECTURE.md`, `docs/PHASE_5_AUDIT.md`, `docs/ADMIN_FEATURE_MIGRATION_MATRIX.md`.
> **لم يُعدَّل أي كود في هذه المرحلة.** الشهادة: سطر `—-1—-` نهاية المستند.

---

## 0) الحالة قبل البدء

| البند | الحالة | ملاحظة |
|---|---|---|
| الفرع | `feature/admin-in-app-reengineering` | أنشئ حديثاً من `main` |
| آخر commit على `main` | `db5ea34 docs(audit): add Phase 5 audit report` | و`99ab994` قبله: إغلاق مسارات الكتابة RBAC في Phase 5A |
| محتوى `99ab994` | 5 ملفات كود + `backend/test/phase5a-rbac-write-paths.cjs` + `docs/PHASE_5A_FINAL_REPORT.md` | — |
| محتوى `db5ea34` | `docs/PHASE_5_AUDIT.md` | — |
| تعديلات غير committed على Main | `admin/database.js` (معدَّل)، `admin/index.html` (معدَّل) | **بقايا جلسة دعم سابقة** (تجاوز أدمن مؤقت) — سيُعالَج بالاستبدال في Phase 2 ولا تُدمج هذه البقايا أبداً |
| ملف غير متتبع | ~~`backend/flip_admin.mjs`~~ **محذوف** | سكربت مؤقت متبقٍ من جلسة الدعم؛ فُحص كامل المشروع (imports، package scripts، tests، build، deploy، docs) فثبت أنه غير مستخدم، فحُذف بتاريخ 2026-09-25. سجل الحذف: §13 |
| **نقص حرج في التحكم بالمصدر** | **لا يوجد `package.json` ولا `main.js` في المستودع أصلاً** | نقطة دخول Electron **غير خاضعة لإدارة النسخ**؛ نسختها الوحيدة داخل `app.asar` الثنائي المُعبّأ. هذا يمثّل خللاً حقيقياً يجب تداركه في Phase 2 (إعادة إنشائها كمصدر) |
| خط الأساس الاختباري | `npm test` (backend) **كامل الأخضر** — 9 مجموعات بـ `&&`، آخرها `phase6` (28/28) و`phase5a` (34/34) | شُغّل على سيرفر حيّ مؤقتاً (أُطفئ بعدها)، مع نسخة احتياطية `backend/data/lucca.db.backup-before-audit-tests` |

---

## 1) المعمارية الحالية (كما هي في الكود المُشحَن فعلاً)

> المصدر الموثوق للوصف هو **الكود** + **محتويات الحزمة** (`dist/win-unpacked/resources/app.asar` v1.3.5 و`dist/LuccaPOS-win32-x64/resources/app.asar`)، لا الوثائق وحدها.

### 1.1 خريطة النافذتين (Electron)

| النافذة | source | الحجم | السكربتات المحمَّلة (أهمها) |
|---|---|---|---|
| الرئيسية (POS) | `main.js:53 → index.html` | 1400×900 | `index.html:11` يحمّل `admin/database.js` + أحزمة POS/Batman |
| الإدارة | `main.js:153 → admin/index.html` | 1200×800 | `<head>`: `database.js`, supabase.js, `supabase-db.js` (يستبدل `LuccaDB` في الوضع السحابي), `admin-analytics.js` — و`body`: `ollama-adapter`, `ai-pos-engine`, `batman-questions`, `system-health`, `forecasting`, `report-export`, `sync-engine` |

### 1.2 مخزنان متوازيان للبيانات

1. **IndexedDB محلي** `lucca_caffe_db` v9 (36 مخزناً، `admin/database.js:9`) — مصدر عرض POS والإدارة التراثية، ومرآة مزامنة.
2. **Backend SQLite** (`localhost:3000`) — **مصدر الحقيقة للمصادقة والماليات والكتابة** (checkout/void/refunds/stock حصراً سيرفراً حسب `DATA_OWNERSHIP_MATRIX`).
3. **Supabase** (وضع `luccaDataMode === 'supabase'`) — مرآة سحابية، غير مفعّلة افتراضياً، وثغراتها موثقة في `SECURITY-NOTES.md` و`docs/PHASE_5_AUDIT.md` (§11) — خارج نطاق هذه المرحلة إلا كمرجع أمني.

### 1.3 أربعة مداخل إلى «الإدارة» — ليست كلها واحدة

| المسار | الوصف | البوابة | الوضع |
|---|---|---|---|
| A. `openAdminDashboard()` ← `electronAPI.openAdmin()` ← `ipc` `open-admin` ← نافذة `admin/index.html` | **المدخل المقصود** | نافذة الإدارة تعرض شاشة دخول **خاصة بها** | **REACHABLE** (المخدوم في الحزمة) |
| B. `window.open('admin/index.html')` (في المتصفح/فشل A) | بديل المتصفح | شاشة دخول admin | متاح في المتصفح فقط |
| C. `openAdminPanel()` ← `#adminLoginModal` + `posAdminAuthed` | **لوحة سريعة** داخل POS (3 أقسام: cats/prods/pay) | **دخول مستقل ثانٍ داخل POS** | REACHABLE (`index.html:47`) — **مكرّر** |
| D. `admin/control-center.html` و`admin/dashboard.html` | واجهتان أخريان كاملتان | كلمة مرور/`sessionStorage.luccaToken` | **أيتام** — لا شيء يربطهما، وغير معبّأتان في الحزمة |

**النتيجة:** يوجد في الكود **ثلاث لوحات إدارة كاملة** (index / control-center / dashboard) **+ لوحة سريعة** في POS، و**خمس آليات مصادقة** مختلفة (جدول `1.4`) — وهذا هو «سبب كون الإدارة نظاماً منفصلاً».

### 1.4 خمس آليات مصادقة متوازية

| الواجهة | آلية المصادقة | التخزين | عند 401 |
|---|---|---|---|
| POS (`index.html`) | لا بوابة جلسة عامة؛ بوابة دخول `#adminLoginModal` فقط | `localStorage.currentUser`, `sessionStorage.posAdminAuthed` | — |
| `admin/index.html` | `Users.login` (server-first→offline) + استعادة جلسة محفوظة | `localStorage.currentUser` | يقع بديل محلي `localDashboardFallback` |
| `admin/control-center.html` | دخول خاص → `POST /api/auth/login` | `sessionStorage.luccaToken` | خروج صارم `sessionExpired()` |
| `admin/dashboard.html` | **بلا نموذج دخول**؛ يقرأ التوكن فقط | `sessionStorage.luccaToken` (مشترك!) | رسالة دخول |
| `kitchen.html` | **بلا مصادقة إطلاقاً** | — | — |

---

## 2) تدفق المصادقة الحالي

### 2.1 السيرفر («مصدر الحقيقة» وفقاً `backends`)

- `POST /api/auth/login` (`routes/auth.ts:21`) مع معدَّل 10/دقيقة/IP.
- تجهيز كلمة المرور: **PBKDF2-SHA512، 100,000 تكرار، 64 بايت** (`auth.ts:29-38`)؛ ترقية نص-صريح تراثي عند أول دخول (`routes/auth.ts:36`).
- الجلسة: صف `sessions` في SQLite، **TTL 12 ساعة** (`auth.ts:6`)، توكن 32 بايت hex (`auth.ts:74`)؛ **لا دوران، لا سقف لكل مستخدم، لا حذف الجلسات عند تغيير كلمة المرور/الدور**.
- البذرة الأولية: `admin / 123456` مع `mustChangePassword=1` (`db.ts:893-898`).
- الحواجز: `authRequired` → `requirePasswordChanged` → `requirePermission(perm)` (`auth.ts:246-257`).
  - **فجوة Fail-open**: `userMustChangePassword` يرجع `false` على أي خطأ DB (`auth.ts:232`).
  - **`active=1` غير مُنفَّذ**: الحساب المعطَّل يبقي جلسته ومفتاح جهازه (`db.ts:857`).
  - **`requirePermission('audit.read')`/`users.read` معرّفان لكن غير مستخدمين** — القراءة تحكمها `READ_RESTRICTED` البدائية (`crud.ts:25`).
- نسخ جلسة الجهاز: `apiKeyCheck` بـ `includes` (غير ثابت الزمن) (`index.ts:220-232`, `auth.ts:180-200`)؛ مفتاح الجهاز يعبر `mustChangePassword` ولا يقبل **أي** صفحة POS جلسة فعلية.

### 2.2 العميل (الطبقة المعطوبة)

- `admin/database.js — Users.login` كان server-first بعد إصلاح Phase 4.5 (`docs/ADMIN_LOGIN_FLOW_AUDIT.md`):
  `login → _serverLogin() → _offlineLogin() → _refreshLocalUser()`
- **لكن بقايا جلسة الدعم أدخلت خرقاً:** عند `username === 'admin'` (أو مرادفاته) يستدعي `_adminForceLogin()` (`admin/database.js:735-752`) **قبل** قبول `serverResult.decided`، فيُكتب `role:'admin'` و`mustChangePassword:false` في `localStorage.currentUser` **دون تجاوز سيرفري، ودون تحقق**. هذا **خرق RBAC** يجب إزالته في Phase 2 (المستخدم صرّح: «لا أريد إلغاء الحماية»، «ممنوع bypass»).
- إضافة إلى ذلك `createDefaultAdmin` يزرع `admin/123456` **نصاً صريحاً** (`:1078-1090`)، و`_offlineLogin` يقبل مقارنة نصّية صريحة (`:827-829`)، و`resetDefaultAdmin` يخفض `mustChangePassword=0` (`:1092-1117`).
- **الهوية الكاملة = `localStorage['currentUser']`** (JSON بلا توقيع/انتهاء) — **أي كتابة محلية تحرّض بأدمن** (`admin/database.js:1051`, `index.html:4156-4157`).

### 2.3 «مصدر الثقة» المطلوب

الـ **Main Process لا يملك أي نموذج مستخدم/جلسة**. لا يوجد `getCurrentUser` في preload ولا في main. الادعاء «نفس المستخدم ونفس الجلسة» اليوم يعتمد على قراءة renderer للـ localStorage نفسه — وهو بالضبط ما يُمنع في spec (لا تُثق بيانات renderer، التفعيل من main-process).

---

## 3) تدفق RBAC الحالي

- مصفوفة: `auth.ts:119-150` (مرآتها `docs/RBAC_MATRIX.md`): `admin:['*']`, `manager`, `cashier`, `kitchen`, `device` — تطابق حروف لا وراثة.
- **التطبيق سيرفري سليم** للعمليات (`requirePermission` على checkout/void/sync/cc/reports/batman management/admin) — موثق ومُختبر في `phase5a-rbac-write-paths` (34/34) و`phase6-accounting-convergence` (28/28) و`phase5-decision-layer`.
- **العطل اثنان أماميان:**
  1. `admin/index.html` — **لا أقسام موزّعة بالأدوار**: 20 تبويباً `hard-coded` (`:1688-1720`)، و`initTabs` بلا فحص دور (`:2676-2709`)؛ الفحص الوحيد يخفي «حذف مصروف» للكاشير (`:4075`)؛ و`enterApp` يفتح اللوحة **لأي دور** (`:2600-2611`).
  2. `index.html` (POS) — فحص وحيد `role==='admin'||'manager'` لبوابة الدخول السريعة (`:1274`) فقط؛ موظف/مطبخ يرى الأقسام السياقية بلا بوابة.
- **فجوة كتابة أمامية**: `editUserRole` يكتب دوراً **مباشرة في IndexedDB** (`admin/index.html:4313-4325`) بلا `Users` API ولا تحقق — معطَّل بمطابقة `docs/ADMIN_TARGET_ARCHITECTURE.md §13` (BLOCKED حتى Phase 6) لكنه **موجود في الكود المشحَن**.
- **سجل تدقيق مثقوب** (سيرفري): `audit_logs` قابلة للحذف من `manager` عبر `DELETE /api/audit_logs/:id` (`crud.ts:546,581-583` — مسار الحذف لا يستشير `WRITE_ADMIN_STORES`)؛ **تغييرات أدوار المستخدمين غير مُسجَّلة** (`recordAuditLog` يتغطى orders/order_items/payments فقط، `crud.ts:535-538`)؛ `userId`/`ipAddress` غير مملوءين أبداً (`index.ts:725`, `crud.ts:181`).

---

## 4) تدفق IPC في Electron الحالي

| القناة | المعالج | تحقق المرسل/الدور | ملاحظة |
|---|---|---|---|
| `open-admin` | `main.js:124-155` | **لا شيء** (لا `event`, لا دور) | يفتح نافذة الإدارة لأي renderer؛ البوابة الفعلية داخل الصفحة |
| `open-external` | `main.js:157-161` | تحقق بادئة http/https فحسب | آمن بادئياً |
| `save-image-clipboard` | `main.js:163-174` | لا شيء (لا حجم/لا نوع/لا limit) | كتابة حافظة+`%TEMP%`؛ مُستخدم في الفواتير |
| `update-check/download/install`, `get-update-state`, `get-version`, `check-remote-version` | `main.js:59-76` (داخل `createWindow`) | لا شيء | **أخطاء**: `check-remote-version` يحوّل `await` على خاصية (`main.js:74`); إعادة تسجيل `handle` عند كل `createWindow` (`activate`) → خطأ «second handler» |

- **نواة أمان نافذتي POS/Admin سليمة**: `nodeIntegration:false` + `contextIsolation:true` + preload محدد (لا `invoke` عام، ولا `ipcRenderer` مكشوف). نقطة الضعف الوحيدة المتعلقة بالإدماج: **لا يوجد IPC يسلّم الجلسة الموثوقة** من main إلى نافذة الإدارة — لذلك توسّطت الصفحة بقراءة `localStorage` نفسها.
- عيوب إضافية مؤثرة على تجربة الإدماج: **لا single-instance lock** (تَشغُّل نسخ متعددة يشارك IndexedDB ويسجّل `handle` مرتين)؛ **نافذة الإدارة أخت لا ابنة** — إغلاق POS يُبقي نافذة admin حية بصلاحياتها (`main.js:130`)؛ **F12 مفتوح دائماً في الإنتاج** (`main.js:107`)؛ **البديل `file://` للمطبخ مكسور** (`__dirname` غير معرّف في renderer مجزأ، `index.html:1350`).

---

## 5) الأنظمة المكررة / الميتة (مُثبَت)

| العنصر | الدليل | القرار المقترح في المراحل اللاحقة |
|---|---|---|
| `admin/control-center.html` (79KB) + `admin/admin-api.js` | **أيتام**: لا ربط من أي ملف؛ **غير معبّأ** في الحزمة؛ الوثائق تسمّيها «الغلاف الهدف» | لا حذف؛ اعتماد بنيتها (AdminApi + `/api/cc`) كقالب الإدماج |
| `admin/dashboard.html` (33KB) | أيتام (يُربط `index.html` خروجاً فقط)؛ معمّب في الحزمة كنسخةٍ متقادمة | لا حذف؛ دمج أقسامه حسب `ADMIN_TARGET_ARCHITECTURE §16` |
| `admin/admin-analytics.js` — `AdminAnalytics` | حسابات مالية **عميلية** موازية للـ `reportService` | تُستخدم كـ parity فقط؛ لا تُعتمد رقمياً (P5) |
| `admin/system-health.js` | مستهلك من `getSystemHealth` (LLM tool) + صفحة | يبقى وحيداً (لا نسخة ثالثة) |
| `index.html #adminPanelModal` (اللوحة السريعة) + `#adminLoginModal` + `posAdminAuthed` | بوابة دخول مستقل ثانٍ داخل POS، 3 أقسام | **يُدمج** ضمن وحدة إدارة واحدة (ميدأن موجات): بنية موحدة، لا «دخول سريع» |
| ستة SQL مضمّنة مكررة للتقارير | `analytics.ts:78,90,124,186,208` + `index.ts:1115` | تُوجَّه عبر `reportService` (Phase 4) |
| «التقارير» غير المدركة للاسترداد | `/api/dashboard/refunds-voids` (حسب 50 صفاً: `analytics.ts:164-179`) و`/api/reports/summary` و`/api/dashboard/insights` | تحسب `SUM(total)` بلا خصم استرداد — اختلف عن `netSales` الشرعي |
| `ordersRepo.cogsFor` | ميت (لا مستدعي) ويخالف سلم التكلفة `COALESCE(...,0)` | يُزال فقط بعد إثبات، ضمن التنظيف |
| dead preload: `getUpdateState`, `checkRemoteVersion`, `onUpdateStatus`, `onUpdateAvailable`, `onUpdateDownloaded`, `startUpdate` | بلا مستدعي؛ آخران يستمعان لقناة لا يُرسلها main قط | تنظيف أثناء إصلاح preload |
| `_offImageSaved` | مفقود في preload لكن مستدعى (`index.html:2827`) | تسريب مستمعات على كل إرسال فاتورة — إصلاح إجباري |

---

## 6) إجابات أسئلة التشخيص (الـ15)

1. **كيف يتم Login حالياً؟** POS لا يملك بوابة جلسة عامة؛ بوابة إدارية `#adminLoginModal`+`Users.login`؛ نافذة الإدارة لها `loginScreen` خاص (server-first ثم استعادة `localStorage.currentUser`).
2. **أين يُخزن session/current user؟** `localStorage['currentUser']` (هوية كاملة بلا توقيع/انتهاء) + `sessionStorage['luccaToken']` + `sessionStorage['posAdminAuthed']` (`admin/database.js:1051,500,936`).
3. **كيف يعرف التطبيق المستخدم الحالي؟** قراءة مباشرة من `localStorage.currentUser` في كل من POS (`index.html:4156`) والإدارة (`admin/index.html:4510`).
4. **كيف يُطبّق RBAC؟** سيرفرياً بإحكام على العمليات (`auth.ts`/`crud.ts`/`cc`)؛ أمامياً **لا** (لا توزيع أقسام بالإدارات). فجوة كتابة: `editUserRole` مكتوبة أمامية مباشرة.
5. **كيف يُفتح Admin من Electron؟** `index.html:1042 → electronAPI.openAdmin() → ipc 'open-admin' → loadFile admin/index.html`؛ والنوافذ `setWindowOpenHandler` يسمح بـ `window.open` كبديل.
6. **هل يوجد IPC خاص بـ open-admin؟** نعم: `ipcMain.on('open-admin')` (`main.js:124`) — **بلا تحقق مرسل/دور**.
7. **هل preload يعرض API لفتح Admin؟** نعم `preload.js:10 openAdmin() → send('open-admin')` بصفر وسائط بلا نتيجة.
8. **هل `window.electronAPI.openAdmin` موجود؟** نعم، مُستدعى في `index.html:1044,1046`؛ **`openAdminPanel` موجود أيضاً** وهو مدخل «اللوحة السريعة» المستقلة (`index.html:1240`) — تسميتان→ هدفان مختلفان.
9. **هل `openAdminPanel` موجود فعلاً؟** نعم — لكنه يفتح **لوحة داخلية أخرى** (cats/prods/pay) لا صفحة الإدارة الرئيسية، ببوابة دخول وراية جلسة مستقلتين.
10. **هل تعتمد Admin على authentication منفصل؟** نعم — نافذة الإدارة تعرض شاشة دخول مستقلة (`admin/index.html:1629-1648`) تميياً قبل الوصول؛ أي دور (حتى cashier) يدخل كل الأقسام.
11. **هل تستخدم Admin database layer مختلفاً؟** نعم تُرثّ: `admin/index.html` يقرأ IndexedDB (مخزن `LuccaDB`)، بينما الهدف (`control-center`) يقرأ `/api/cc` سيرفري؛ `supabase-db.js` يستبدل `LuccaDB` كلياً في الوضع السحابي.
12. **هل تستخدم reporting logic مختلفاً عن POS؟** نعم مرتين: نسخة عميلية (`admin-analytics.js`/`AdminAnalytics` + حسابات `dashboard.html`) ونسخة سيرفرية (`reportService` الموثّق)؛ وهناك **طبقتان سيرفريتان متعارضتان** على net/refunds (`analytics.ts` و`index.ts:1074`).
13. **هل يوجد duplicate business logic؟** نعم — ويُسيّس كما في §5 (AdminAnalytics، 6 SQL مضمّنة، لوحة سريعة، 3 واجهات إدارية).
14. **هل توجد APIs/functions قديمة؟** نعم — §5: `cogsFor`, dead preload، `audit.read`/`users.read` (معرّفان ومهجوران)، `SESSION_COOKIE` (مستورد بلا استخدام), `scopes` branch (`index.html:4914` لا يملؤه أحد).
15. **هل توجد صفحات Admin مكررة؟** نعم (§1.3): `index` (مشحونة) + `control-center` (يتيمة لكنها الهدف) + `dashboard.html` (يتيمة) + لوحة سريعة في POS (مكررة تحتاج اندماجاً). **لم تُستخدم أي حذف — «لا حذف لمجرد القدم»**؛ الإشارة هنا لتوثيق الإدماج فقط.

---

## 7) المشاكل المجمّعة (Severity)

| # | الحدة | المشكلة | الأدلة |
|---|---|---|---|
| P1 | **حرج** | دخول إدارة ثانٍ كامل مستقل + 5 آليات مصادقة → «الإدارة نظام منفصل» | §1.3, §1.4 |
| P2 | **حرج** | لا جلسة موثوقة من main-process؛ هوية localStorage قابلة للتزوير → لا «نفس المستخدم/الجلسة» الحقيقي | §2.2-2.3 |
| P3 | **حرج** | تسليم مؤقت `_adminForceLogin` (بقايا دعم، غير committ) = **bypass RBAC صريح** يجب حذفه في Phase 2 | `admin/database.js:735-752` |
| P4 | مرتفع | `open-admin` IPC بلا تحقق مرسل/دور؛ نافذة الأخت تبقى حية بعد إغلاق POS؛ لا single-instance | §4 |
| P5 | مرتفع | `admin/index.html` بلا توزيع أقسام بالدور؛ `enterApp` يقبل أي دور | §3 |
| P6 | مرتفع | سجل التدقيق: حذف بالـ `manager`، تغيير أدوار بلا تسجيل، `userId`/`ipAddress` فارغة | §3 |
| P7 | مرتفع | `editUserRole` كتابة أمامية مباشرة لدور | `admin/index.html:4313` |
| P8 | مرتفع | حسابات مالية موازية (AdminAnalytics + 6 SQL + refunds-unaware summary) ولا «الرقم من السيرفر» | §5 |
| P9 | متوسط | `requirePasswordChanged` fail-open على خطأ DB؛ `active` غير مُنفَّذ | §2.1 |
| P10 | متوسط | `control-center/dashboard.html` غير معمّبين رغم كونهما «الهدف» → شحنة الحزمة تخالف عقد المعمارية | §1.3, §6 |
| P11 | متوسط | المطبخ `kitchen.html` بلا مصادقة؛ وفتحه من POS مكسور | §1.4, §4 |
| P12 | متوسط | تسريب مستمعات `onImageSaved` (`_offImageSaved` مفقود) | §5 |

---

## 8) المعمارية الموصى بها (لتُعتمد قراراً تصميمياً، وستُنفَّذ في Phase 2 فما بعد)

تُبنى **على العقود القائمة ولا تنشئ نظاماً جديداً** — هدفها إغلاق P1–P12:

```
POS login (واجهة دخول وحيدة)
   │  Users.login (server-first, بلا أي bypass, mustChangePassword يُفرض)
   ▼
auth:established ──ipc ضـيّق──▶ Main Process = مصدر الثقة
   (المستخدم الحقيقي+الدور+التوكن+انتهاء) ── يحفظ appSession في الذاكرة ──▶ preload: getSession()
   ▼
لوحة الإدارة (admin/index.html أو خليفتها المبنية على /api/cc)
   │  enterApp() يستدعي getSession() (لا loginScreen، لا localStorage كحقيقة)
   │  الأقسام تُعرض حسب scope السيرفري (GET /api/cc) — لا فحص أدوار أمامي وحيد
   ▼
القراءة/الكتابة: AdminApi([AdminApi]) → /api/cc • /api/reports • /api/orders/checkout|void (سيرفر حصراً)
الرقم المالي: reportService فقط (+ parity للميراث)
سجل التدقيق: قراءة من /api/audit_logs — الكتابة/الحذف محظورة حضورها ما عدا سيرفرياً وعند الأدمن
Batman: أداة في لوحة الإدارة، tools عبر طبقة القرار (/api/batman/*) بتحقق دور+إذن+Audit
```

قرارات تصميمية مقترحة (تُؤخذ في Phase 2/3، وتُشرف عليها المراجعة):
- **D1** لا يوجد «loginScreen» في نافذة الإدارة: إن لم تُوجد جلسة حية → رسالة «يجب تسجيل الدخول من التطبيق» + زر عودة.
- **D2** الـ main-process يسلّم الهوية عبر `getSession()` المستدعى عند `DOMContentLoaded`؛ عند تعذر السيرفر (offline) يُعتمد **معلومة الجلسة الملتقطة** بشرط وسمها «خارج الاتصال» في الشريط، ولا يُسمح بالكتابة المالية.
- **D3** إزالة كاملة لـ `_adminForceLogin` والأسماء المستعارة و`resetDefaultAdmin` المخفِّض للزام؛ استبدال «استعادة كلمة الأدمن» بمسار **سيرفري موثّق** (يُسجَّل، ويتطلب تأكيداً) إن بقي مطلوباً.
- **D4** دمج «اللوحة السريعة» (`#adminPanelModal`/`posAdminAuthed`) في الوحدة الموحدة — نقطة دخول واحدة («الإدارة») من `index.html`.
- **D5** نافذة الإدارة تُعالج كـ **ابنة** للـ POS (إغلاقها عند إغلاق الرئيسية؛ لا أخت تعيش بعده).
- **D6** إرجاع `main.js` و`package.json` إلى المستودع كمصدر (المعيار لإعادة البناء الموثوقة)، مع إغلاق single-instance، وتثبيت F12 بالإنتاج، وتحقق مرسل القنوات الحساسة.

---

## 9) الملفات المتأثرة (مقترَح للمراحل — لا يُنفَّذ في دور هذه المرحلة)

| الملف | المرحلة | نوع التغيير المتوقع |
|---|---|---|
| `main.js` (مستعاد من الحزمة إلى المصدر) | 2/3/6 | إضافة إلى git؛ single-instance؛ `open-admin` بتحقق جلسة؛ نافذة ابنة؛ تعطيل F12 بإنتاج؛ إصلاح update channels |
| `preload.js` | 2 | +`getSession()` (invoke ضيّق)؛ إزالة الشفلالات الميتة؛ إصلاح `_offImageSaved` |
| `index.html` (POS) | 2/3 | بوابة دخول عامة؛ `auth:established` عند نجاح؛ توحيد زر «الإدارة»؛ إزالة لوحة سريعة/`posAdminAuthed` وتوحيد المسار |
| `admin/database.js` | 2/4 | **حذف `_adminForceLogin`+المرادفات**؛ إبقاء `Users.login` server-first سليماً؛ مساعدي جلسة عبر main؛ إزالة `scopes` الميت |
| `admin/index.html` | 2/5 | إزالة `loginScreen`؛ `enterApp` عبر `getSession()`؛ توزيع الأقسام بالـ scope السيرفري؛ دمج Batman؛ نظام صفحة الاستهداف (Sales/Orders/…/Health) |
| `admin/admin-analytics.js` | 4 | يبقى parity فقط — لا مصدر رقم للعرض |
| `admin/control-center.html`, `admin/dashboard.html` | 5 | لا حذف؛ تُدمج واجهاتها في الوحدة الموحدة |
| `admin/admin-api.js`, `admin/system-health.js` | 2-5 | اعتماد؛ نظام صفحة الاستهداف |
| `kitchen.html` | 2/4 | بوابة جلسة + إصلاح فتحه من POS |
| `backend/src/routes/crud.ts` | 2/4 | حذف audit_logs → admin-only؛ تسجيل `users`; ملوء `userId/ipAddress` |
| `backend/src/services/reportService.ts` (+ `analytics.ts`, `index.ts` التقارير المضمّنة) | 4 | قطع duplicate إلى canonical؛ `getCashExpected` للمدى المتعدد |
| `backend/src/auth.ts` | 2/4 | إنفاذ `active`؛ إغلاق fail-open عند الخطأ |
| `supabase-db.js` | 4 | نطاق (يُدار في مراحل لاحقة) |
| الحزمة/`dist` | — | لا بناء إنتاج في هذه المهمة (بند «الغاء» إلزامي) |

---

## 10) تقييم المخاطر

| الخطر | الشدة | التخفيف المقترح (لاحق) |
|---|---|---|
| إزالة شاشة دخول الإدارة تحدّ من العمل دون اتصال عند فقد السيرفر | متوسط | D2: معلومة جلسة ملتقطة + وسم «خارج الاتصال» وكتابة مالية ممنوعة |
| إزالة `_adminForceLogin` قد يمنع الدخول إن تلف السجل المحلي للأدمن | مرتفع | مسار استعادة سيرفري موثّق ومسجَّل بدل الباكدور؛ التأكيد على مصادقة «admin/123456» ثم فرض التغيير |
| تحويل «نافذة الإدارة إلى ابنة» وغلق التسجيل الثانوي سلوكياً | منخفض | البند D5؛ تغطية باختبارات IPC |
| اعتماد `getSession()` (main) قد يكسر مزامنة متعددة النوافذ أثناء التنفيذ | متوسط | جلسة واحدة إلزامية (single-instance) تُحسم قبل التطبيق |
| كسر POS (تغيّر بوابة الدخول العامة) | مرتفع | كل مرحلة بـ test-first؛ `npm test` (320) خضراء إلزامية + سيناريوهات يدوية |
| ترحيل التقارير إلى `reportService` يغيّر أرقام «الإجمالي» ظاهرياً | متوسط | parity أولاً (D8/D9): مقارنة قديم/جديد قبل أي عرض |
| `main.js` غير مُدار بالمصدر — إعادته قد تُدخل اختلافاً | مرتفع | استعادة البايت-حرف من الحزمة v1.3.5 الحالية ثم التحكم، قبل أي تعديل |
| الوضع السحابي (Supabase) خارج النطاق وقد يتعارض لاحقاً | متوسط | تجميد الوضع السحابي من تجربة الإدماج في Phase 2-5؛ توثيق كتمديد |

---

## 11) خطة الاختبارات (مفصّلة لكل مرحلة لاحقة)

- **خط الأساس (هذه المرحلة):** `npm test` backend **كامل الأخضر** (9 مجموعات، 320 فحصاً في القياس السابق) + `npm run build`.
- **Phase 2 (مصادقة موحدة):** مصفوفة أدوار (admin/manager/cashier/kitchen) × (سيرفر حيّ، معطّل، بلا شبكة) × (دخول POS → فتح إدارة بلا إعادة دخول)؛ رفض عند غياب جلسة؛ إثبات إزالة bypass؛ `active=0` يُمنَع؛ `mustChangePassword` يُفرض.
- **Phase 3 (Electron):** POS→Admin→POS بلا إعادة دخول؛ إغلاق النافذة الرئيسية يغلق admin؛ `open-admin` مرفوض بلا جلسة؛ single-instance؛ لا F12 بإنتاج؛ المحوّل `getSession` ضيّق.
- **Phase 4 (توحيد بنية/تقارير):** parity للداشبورد/المبيعات/المصروفات/المشتريات/المخزون بين القديم و`reportService`؛ إغلاق duplicate SQL؛ حذف audit → admin-only + تسجيل تغييرات الأدوار؛ `userId/ipAddress`.
- **Phase 5 (واجهة):** أقسام Dashboard/Sales/Orders/Expenses/Purchases/Inventory/Users/Reports/Audit/Health/Batman بأدوار؛ اختبار نقر لكل تبويب × دور؛ Batman ينفّذ إجراءً عبر الطبقة بقوائم صلاحياته.
- **Phase 6 (أداء/QA):** بدء وتنقّل مع مجموعات بيانات كبيرة؛ pagination (لا `.slice` ذاكرتية)؛ عدم تكرار الطلبات؛ تسريب مستمعات بعد إرسال فواتير؛ Lifecycle Electron؛ جلسات/انتهاء.

---

## 12) القيود الملزمة (تام المنع حتى طلب صريح)

لا رفع version، لا بناء إنتاج، لا deployment، لا تغيير schema، لا RPC، لا تغيير package version، لا reset/revert/حذف لأي commit (تم الالتزام بها في هذه المرحلة — لم يُجمَّع أي كود).

---

## 13) الخاتمة والوصايا العاجلة

1. الإدارة **ليست** نظاماً مستقلاً في الأصل — حاجز «لوحة دخول ثانية» و«جلسة localStorage» نقطتان في طبقة العرض المحلّية؛ **الأساس السيرفري (جلسات/RBAC/OTC/CC/`reportService`) سليم ومُختبر** ويصلح جاهزاً كمصدر الثقة.
2. أول إجراءات **Phase 2** ثلاثة: حذف الباكدور `_adminForceLogin`، ونقل هوية الجلسة إلى main-process عبر `getSession()`، ونزع `loginScreen` من نافذة الإدارة مع `enterApp` القائم على الجلسة — ويتبعها استعادة `main.js`/`package.json` إلى المستودع ثم الإغلاقات الأمنية في Phase 3.
3. كل تغيير لاحق **خلف Parity** و`npm test` الأخضر — ولا حذف لأي ملف دون إثبات أيتام (موثقاً في §5).
4. بقايا العمل غير الملتزم (`admin/database.js`, `admin/index.html`) **لا تُدمج** ولا يُعتمد عليها — `_adminForceLogin` (في `admin/database.js`) **مرفوض استخداماً/دمجاً/اعتماداً** وسيُزال في Phase 2 كإجراء RBAC إلزامي؛ تعديلا الواجهة المؤقتان يُعالَجان بالاستبدال في Phase 2.

---

### سجل الحذف (المنفَّذ في هذه المرحلة — Phase 1)

| العنصر | الحالة | السبب |
|---|---|---|
| `backend/flip_admin.mjs` | **حذف** (2026-09-25). لم يوجد له أي مستخدم في: imports، `package.json` scripts (backend)، الاختبارات (`backend/test/*`)، build (`build.bat`, backend `tsc`)، deployment (`deploy/*`, Dockerfile، .bat، vercel)، أو docs. المراجع الوحيدة كانت في `docs/ADMIN_IN_APP_AUDIT.md` نفسه مسجّلةً لهذا الحذف. | سكربت مؤقت من جلسة دعم سابقة أعاد تعيين `mustChangePassword`/كلمة أدمن مباشرة في SQLite — خطير/مصمَّم فعلاً للحذف بعد الاستخدام؛ لا يصلح للاستمرار في المصدر. |
| `admin/database.js` — `_adminForceLogin` (+ الأسماء المستعارة للدخول بلا كلمة) | **لم يُستخدم ولم يُدمج ولم يُعتمد عليه** — بقية غير ملتزَمة (غيّرتها جلسة دعم سابقة ضمن `admin/database.js` و`admin/index.html` غير الملتزَمة على فرع العمل). ستُزال في Phase 2 بنصّ صريح، ولن تُجدَّف لأي commit مرافق. | خرق RBAC صريح (تجاوز للمصادقة السيرفرية وإثبات دور `admin` من الواجهة) — منافٍ لقواعد المهمة: «ممنوع bypass، لا إلغاء حماية، لا قبول role من الواجهة كحقيقة». |

*انتهى التقرير — في انتظار تعليمات Phase 2.*