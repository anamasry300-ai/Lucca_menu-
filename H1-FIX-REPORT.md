# H1-FIX-REPORT — تلطيف كشف مفتاح API / تقوية Public Key
**التاريخ:** 2026-08-31
**المرجع:** `H1-SECURITY-AUDIT.md` (تشخيص ما قبل التعديل) + القرار المعتمد (محل Device Key مخصّص).
**النطاق:** تنفيذ H1 فقط. لم أبدأ H3/H5/H6 ولا منطق الضرائب، ولم أعدّل C2 Sync بإلا القدر اللازم للتوافق الأمني.
**المبدأ:** أي تغيير على قواعد/مخازن **مؤقتة** للاختبار فقط؛ بيانات الإنتاج لم تُمسّ؛ نسخة احتياطية كاملة قبل التعديل.

---

## 1) Root Cause (السبب الجذري)
النظام استخدم **مفتاح API ثابتاً مشتركاً** (`lucca-secret-key`) لحماية كل `/api/*`، وكان:
- **حرفياً** في الواجهة (`'lucca-secret-key'` مرجع احتياطي في `index.html` و `admin/database.js`).
- **مخزّناً** في `localStorage` (`luccaApiKey`) بعد جلبه من `/api/public-key`.
- **مكشوفاً سابقاً** عبر `GET /api/public-key` لغير المصادقين (أُوقف في H2).
- قابلاً للاستخراج من **كود المصدر** و **DevTools** (localStorage).

بعد H2 أصبح هذا المفتاح **device-scoped فقط** (لا إدارة مستخدمين/مدفوعات/استردادات)، لكنه بقي **سراً حرفياً في الواجهة** — مخالفة صريحة لمبدأ H1 (لا secret في المتصفح).

## 2) Current Exposure (قبل الإصلاح ضمن H1)
| المصدر | النوع |
|---|---|
| `index.html:2970,4839` | `localStorage.luccaApiKey \|\| 'lucca-secret-key'` (حرفي) |
| `admin/database.js:2552,2604,2719` | `localStorage.luccaApiKey \|\| 'lucca-secret-key'` (حرفي) |
| `admin/database.js:2737-2739` | جلب `public-key` وتخزين `data.apiKey` (ميت منذ H2) |
| `index.html:1714` | يعرض `data.apiKey` في `testServerConnection` (ميت) |
| الخادم | `API_KEY` default حرفي `lucca-secret-key` (index.ts, auth.ts) |

## 3) Authentication Flow (تدفق المصادقة النهائي)
1. **جلسة مستخدم (Bearer):** `POST /api/auth/login` → token لكل مستخدم (دور/صلاحيات + TTL). أولوية قصوى في `resolveIdentity`.
2. **مفتاح جهاز (device-scoped):** `x-api-key` أو `Bearer` يساوي **`DEVICE_API_KEY`** (مخصّص من البيئة) أو **legacy `API_KEY`** (نافذة هجرة). يُحلّ إلى دور `device` فقط.
3. الاعتماد النهائي: جلسة المستخدم > مفتاح الجهاز. من دون أي منهما → 401 للعمليات الحساسة.

## 4) Credential Types (أنواع الاعتمادات)
| الاعتماد | أين يُخزَّن | الصلاحيات | أين يُستعار |
|---|---|---|---|
| Server Session Token | في الذاكرة (خادم) | دور المستخدم | `/api/auth/login` |
| `DEVICE_API_KEY` (جديد) | بيئة الخادم فقط | device فقط | تزويد عبر admin |
| legacy `API_KEY` | بيئة الخادم (نافذة هجرة) | device فقط | — |
| لا secret في الواجهة | لا شيء | — | — |

> **لا يُخزَّن أي secret حرفياً في كود الواجهة.** جهاز الكشك يُزوَّد بمفتاح `DEVICE_API_KEY` مرة واحدة عبر استدعاء admin (`provision-device`)، ويُحفظ في localStorage **بعد التزويد فقط** (وهو اعتماد device‑scope منخفض الصلاحية، لا master).

## 5) Changes (التغييرات)

### الخادم
- **`backend/src/auth.ts`:** أضاف `getDeviceKeys()` (يقبل `DEVICE_API_KEY` + legacy `API_KEY`)، و`resolveIdentity` يحلّ أي منهما إلى دور `device` — لا master.
- **`backend/src/index.ts`:**
  - `/api/public-key` = public configuration فقط (`{configured,secure,name,auth}`) — **لا secret**.
  - أضاف `POST /api/auth/provision-device` (يتطلب جلسة **admin**) يعيد `deviceKey` لتزويد كشك الكاشير.
  - أضاف `GET /api/auth/device-status` (admin) — حالة بلا secret.
  - بَسّط `apiKeyCheck` ليعتمد `resolveIdentity` (أزال الفحص المكرر للمفتاح الحرفي).
- **`backend/.env.example`:** وثّق `DEVICE_API_KEY` (يُغيَّر لكل نشر) ورسم legacy `API_KEY` كنافذة هجرة.

### الواجهة (إزالة أي secret حرفي)
- **`admin/database.js`:** أزال كل `'lucca-secret-key'` الحرفية (2552/2604/2719 → `''`) وحذف جلب `public-key` الميت في `initSystem`.
- **`index.html`:** أزال الحرفية (2970/4839 → `''`)، أصلح `testServerConnection` (لا `data.apiKey`)، وأضاف حقل **مفتاح الجهاز** في الإعدادات العامة + `saveDeviceKey()` + `getDeviceKeyFromServer()` (يتطلب جلسة admin).
- **دوال المزامنة في الواجهة:** الدفع/قائمة الأعمال تفضّل **توكن الجلسة** (Bearer) عند وجوده، وإلا مفتاح الجهاز المركّب — فلا تُقفَل عمليات المستخدم المسجَّل، وتُحفظ مصادقة الجهاز.

## 6) Tests
`h1-security.cjs` (29 اختباراً، قاعدة/خادم مؤقت):
1. `GET /api/public-key` لا يعيد secret.
2. بدون auth → users/reports/sync 401.
3. جلسة صحيحة → allows permissions الصحيحة حسب الدور (cashier محدود، admin مميّز).
4. مفتاح الجهاز (المخصّص + legacy) → device فقط، لا admin (users/reports/dashboard/settings ممنوعة، checkout/orders مسموحة).
5. credential غير صالح → 401.
6. (انتهاء الصلاحية مغطّاة بـ `h2-expiry`).
7. تعديل جانب /عدة جلسة لن تمنح صلاحيات (الخادم يقرأ الدور من الجلسة).
8. لا يوجد secret حرفي في الواجهة (فحص ملفات الواجهة في الاختبار).
9. C2 sync يعمل عبر مفتاح الجهاز، ولا يضيف admin عبر sync.
- `provision-device`: بلا auth 401، device 403، admin 200.

## 7) PASS / FAIL ونتائج الانحدار
| المجموعة | النتيجة |
|---|---|
| **H1-SECURITY** | **29/29 PASS** |
| H2-SECURITY | 40/40 PASS |
| H2-EXPIRY | PASS |
| C2-AUDIT2 | 26/26 PASS |
| C2-SERVER-SMOKE | 6/6 PASS |
| C2-SAFE-SYNC | 15/15 PASS |
| backend tsc (`--noEmit`) | exit 0 |
| backend build (`dist`) | OK |
| الواجهة (inline scripts) | كل الكتل سليمة |
| `database.js` node --check | OK |

**لا يوجد أي regression.** Data production لم تُمسّ (كل الاختبارات على قواعد مؤقتة).

## 8) Remaining Risks / ملاحظات
- **نافذة الهجرة:** legacy `API_KEY` ما زال مقبولاً كجهاز scope حتى يُتاح `DEVICE_API_KEY` لكل النشر. للدوران بمفتاح الجهاز: اضبط `DEVICE_API_KEY` في بيئة الخادم ثم أعد تزويد الكشك — دون إعادة نشر للواجهة.
- **مفتاح الجهاز في localStorage:** ضروري لكشك بلا جلسة، لكنه اعتماد **device‑scope منخفض** (لا يمسّ المستخدمين/المدفوعات/الاستردادات/الإعدادات)، ويمكن تدويره.
- `API_KEY` الافتراضي الحرفي `lucca-secret-key` بقي **في الخادم فقط** (env fallback لنافذة الهجرة) — ليس في الواجهة.
- الجلسات في الذاكرة (تُصفّر عند إعادة التشغيل) — مقبولة لهذا التطبيق، وقد تُنقل إلى Supabase ضمن W3 لاحقاً.

---

## الخطوة التالية
أوقفت العمل عند اكتمال H1 بنتائج خضراء. **لم أبدأ H3** — أنتظر موافقتك قبل أي خطوة تالية (لا تُجرى أي عملية دوران للإنتاج قبل نجاح الاختبارات).
