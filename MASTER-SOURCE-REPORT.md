# MASTER SOURCE REPORT — LUCCA POS (توحيد المشروع في نسخة رئيسية واحدة)

التاريخ: 2026-09-06
الحالة: **تم** — مصدر واحد معتمد، لا نسخ تطويرية متوازية، كل الاختبارات من الرئيسية.

---

## 1) المسار الكامل للنسخة الرئيسية المعتمدة

```
C:\Users\Acer\OneDrive\Desktop\Lucca_menu-
```

- Git repo محلي بمستودع GitHub الرسمي البعيد: `github.com/anamasry300-ai/Lucca_menu-` (branch: main)
- آخر commit مرفوع: `386d3f9` — "feat: v1.0.4 - Batman AI monitor, admin auth, OCR invoicing, hardened sync" (2026-09-06)
- سجلّ git يكشف أن **كل المراحل أُنجزت هنا أصلاً** (لا أدوات تحقق من نسخة أخرى قط):
  `ced8292 bump 1.2.1 | 79df0f6 self-updater | 6a87c79 thermal bold …` حتى الوصول إلى `386d3f9`.
- نسخ العميل القديمة في `dist/` وinstallers 1.0.1–1.0.4 كلها **داخل هذا المشروع نفسه**.
- الـ backend مركّز هنا: `backend/src/*` (auth، sync، analytics، crud، special) مع كل إصلاحات المراحل.

## 2) النسخ/المجلدات الأخرى الموجودة على القرص

| مسار | النوع | الوصف |
|---|---|---|
| `C:\Users\Acer\OneDrive\Desktop\Lucca-menu` | **نسخة code قديمة** (سلالة `Lucca_menu` بدون underscore) | مشروع منيو/POS قديم (آخر commit 2026-08-11)، له remote خاصة به `github.com/anamasry300-ai/Lucca_menu` |
| `C:\Users\Acer\OneDrive\Desktop\Lucca_menu-` | **الرئيسية** | المشروع الرسمي الحالي |
| `C:\Users\Acer\OneDrive\Desktop\Lucca_menu-.worktrees` | غير متعلق | مجلد لمشروع آخر (friendship-concept-exploration) |
| `D:\LUCCA` | بيانات أعمال | Excel فواتير ومنيو (ليست code) |
| `dist\LuccaPOS-win32-x64-OLD-0830` (داخل الرئيسية) | build قديم | نسخة exe (2026-08-30) — أُرشفت بعد استبدالها |

## 3) التعديلات الموجودة خارج النسخة الرئيسية

فحص حرفي (SHA256 + mtime لكل ملف مفتاحي، script `compare-ab.mjs`):

- **صفر** ملف في `Lucca-menu` أحدث من نظيره في الرئيسية. كل ملف مشترك: **DIFF** وB أحدث
  (مثال: `main.js` A=2026-06-23 / B=2026-09-01؛ `backend/src/index.ts` A=2026-05-30 / B=2026-09-06).
- ملفات توجد **فقط** في الرئيسية ولا وجود لها في القديمة: `sync-engine.js`, `ai-pos-engine.js`,
  `batman-dashboard.js`, `ollama-adapter.js`, `ocr-adapter.js`, `invoice-scanner.js`, `supabase-db.js`,
  `version.json`, `menu-data.js`, `ai-reviewer.js`, `update-engine.js`, `admin/index.html`, `admin/_script.html`,
  `backend/src/auth.ts`, `backend/src/routes/auth.ts`, `backend/src/routes/invitations.ts`,
  `backend/src/routes/analytics.ts`.
- محتوى **فريد في القديمة فقط** (منتجات، لا إصلاحات):
  - `menu/` — موقع المنيو الرقمي (صور منتجات + script) المنتج الرقمي المنفصل عن الـ POS.
  - `admin/*` القديم: `pos-engine.js`, `login.html`, `dashboard.html`, `firebase-config.js` (خطّ Firebase المهجور).
  - بنود منيو: Red Velvet (95 EGP)، croissant/ciabatta/baguette (من commits 2026-08-09/11) — **غير موجودة في منيو الـ POS الحالي**.

## 4) كيف تم دمج كل تعديل

- **قرار الدمج: لا تُصدَّر أي ملف من القديمة** — لأنها أقدم في كل ملف (لا فقدان لأي إصلاح أحدث؛ إن نقلنا
  كتباً كاملة لكنا **أسقطنا** تحسينات الرئيسية فعلاً).
- «الدمج» الصحيح كان: تجاهل القديمة كمصدر تطوير، وضمان بقاء الرئيسية **Superset** — وهو مؤكد جدولياً أعلاه.
- الميزة الوحيدة القابلة للنقل (رقمياً منويا وقديمة) بقيت محفوظة في الأرشيف وستضاف في المنيو الحي عبر
  لوحة الإدارة لو رغبت — كطلب محدد، لا استيراد أعمى.
- أُجري refresh بنائي من الرئيسية: `electron-builder --win` → exe جديد v1.0.4 في المسار الرسمي.

## 5) الملفات المعدَّلة داخل النسخة الرئيسية (بسبب الدمج)

- **لا شيء** — الفحص أثبت عدم الحاجة إلى نسخ؛ ملفات الرئيسية كانت الأحدث من البداية.
- الملفات التي عدّلت خلال هذه المهمة هي إجراءات النشر/التحقق فقط:
  - `dist/` (gitignored): build 1.0.4 جديد + أرشفة `LuccaPOS-win32-x64-OLD-0830`.
  - `backend/data/lucca.db` (gitignored): إزالة صفوف الاختبار id=1..6 محفوظة، عودة للحالة الحقيقية (5 مدفوع = 883.5).
  - `.gitignore`: إضافة `.ai-review/` (تم الالتزام بها ضمن `386d3f9`).

## 6) الملفات المنقولة/المدمجة

| العملية | من | إلى | واسطة |
|---|---|---|---|
| build الـ exe | السورس الحالي | `dist\LuccaPOS-win32-x64\LuccaPOS.exe` (رسمي) | electron-builder --win (2026-09-06 15:37) |
| أرشفة build قديم | `dist\LuccaPOS-win32-x64` | `dist\LuccaPOS-win32-x64-OLD-0830` | rename (احتفاظ كامل) |
| أرشفة نسخة قديمة | `Desktop\Lucca-menu` | `Desktop\Lucca-menu-ARCHIVE-2026-09-06` | rename (احتفاظ كامل، لا حذف) |

## 7) نتائج الاختبارات **بعد الدمج — من الرئيسية فقط**

| المجموعة | النتيجة | ملاحظات |
|---|---|---|
| c2-tests/run-tests.js (Safe Sync unit) | **17/17 PASS** | ذرّية، rollback، migration، idempotent |
| c2-tests/server-smoke.cjs | **6/6 PASS** | health 200، مفتاح صحيح 200، خاطئ/بدون 401، مسارات إدارية 403 |
| c2-tests/live-parity.cjs | **6/6 PASS** | insert/update/skip/conflict/حفظ النسخة الأولى/ربط orderSyncId |
| stage7-accounting-consistency (REST↔DB) | **8/8 PASS** | بعد التنظيف 5 مدفوع = 883.5 مطابقة حرفياً |
| final-verify (دورة POS كاملة) | **5/5 PASS** | إنشاء→تعديل→نقل طاولة→إغلاق paid (رقم تسلسلي فريد)→kpis +50 |
| final-verify (Batman حي) | **3/3 PASS** | salesToday == kpis حرفياً؛ salesByPayment حي؛ monitor API |
| final-verify (Ollama حي) | **3/3 PASS** | /api/tags يعمل؛ qwen2.5-coder:7b مثبّت؛ توليد رد فعلي |
| stage6-integrity (sql.js) | **ok** | بلا orphans، بلا duplicateSyncIds، بلا أعمدة ناقصة، بلا مكرر orderNumbers |
| مجمّع سابق (نفس المشروع أصلاً) | 12/12 + 12/12 + 33/33 + 18/18 + 16/16 | كلها أُجريت داخل `Lucca_menu-` ذاته |

**إجمالي فحوصات ما بعد الدمج: 48/48 PASS + فحص السلامة ok.**

## 8) تأكيد: Batman يعمل من النسخة الرئيسية

`batman-dashboard.js`/`ai-pos-engine.js` (ملفات الرئيسية) دُفعت ببيانات حية من سيرفر الرئيسية عبر
`window.LuccaDB.db.getAll('orders'|'refunds')`:
- `tools.salesToday()` أثناء جولة التحقق = **{sales: 1534.5, count: 15}** → **مطابق حرفياً لـ kpis** في نفس اللحظة (وبعد تنظيف بيانات الاختبار عادت الحالة الحقيقية إلى 883.5/5).
- `tools.salesByPayment()` = تفصيل دفعات حي (cash/card).
- `monitor`/`analyzeSnapshot`/`startMonitor` مطبوعة عبر API الصحيح.

## 9) تأكيد: Ollama يعمل من النسخة الرئيسية

- الخدمة المحلية `localhost:11434/api/tags` متصلة؛ النموذج **qwen2.5-coder:7b** مثبّت؛
  توليد رد **فعلي** عبر `/api/generate` نجح (وهو النموذج الذي يستخدمه engine المراقب).

## 10) تأكيد: المزامنة تعمل من النسخة الرئيسية

- `/api/sync` (سيرفر الرئيسية) خضع لـ 17 unit + 6 live-parity + 12/12 stage4 (سابقاً) + live e2e عبر
  المراحل: لا تكرار syncId، لا تضارب قبل أخذ نسخة أحدث، حفظ النسخة الأولى عند تعارض، ربط orderSyncId،
  تعامل أنيق مع فقدان الاتصال، إعادة رفع idempotent، و`normalizeOrderNumbers` يمنع تكرار أرقام الفواتير.
- بعد تنظيف بيانات الاختبار: صفر dup, صفر orphans, سجل sync نظيف.

## 11) حالة النسخ الأخرى بعد التنظيم

| المسار | الحالة الآن |
|---|---|
| `Desktop\Lucca-menu-ARCHIVE-2026-09-06` | نسخة احتياطية مجمّدة (لا تتطور) — احتفظ بها لأسبوع على الأقل ثم قرارك |
| `dist\LuccaPOS-win32-x64-OLD-0830` | build احتياطي داخل الرئيسية \\
| `Lucca_menu-.worktrees` | لم تُمس — غير مرتبطة بالمشروع |
| `D:\LUCCA` | بيانات أعمال، لم تُمس |
| بعيد `github.com/anamasry300-ai/Lucca_menu` | مستودع قديم مجمّد — لا استقبال dev جديد |

---

## قواعد المصدر الواحد (من الآن فصاعداً — إلزامية)

1. **المسار الرسمي الوحيد للمشروع هو:** `C:\Users\Acer\OneDrive\Desktop\Lucca_menu-`
2. أي إصلاح / feature / اختبار داخل هذا المسار فقط، أو Git Branch ملتصق به.
3. أي نسخة Production تُبنى من هذا المسار فقط (`dist` هنا).
4. لا يُنشأ مشروع LUCCA POS آخر، ولا مجلد تجريبي منفصل، ولا rebase/نقل للعمل خارجاً.
5. قبل تغيير كبير: **commit** واضح (الحالة الحالية: `386d3f9` نظيف ومرفوع لـ origin/main).
6. الملفات المخدومة من المفتاح/السير موجودة في `backend/.env` (gitignored) — لا تُشاركها.

### ملاحظات أمنية مرفقة (توصية، غير عاجلة)
- توكنات GitHub المضمّنة في `.git/config` لكل النسختين — ليست في git، لكن يُنصح بالانتقال إلى
  `gh auth login`/Windows Credential Manager و**تدوير التوكنات** عند توقف استعمال `Lucca_menu` القديم.
- مستودعا GitHub (`Lucca_menu` و`Lucca_menu-`) متوازيان تاريخياً؛ اعتمد **`Lucca_menu-`** كمرجع نهائي
  وقرر لاحقاً أرشفة أو نقل القديم على GitHub.

**المسار الرسمي الوحيد للمشروع هو: `C:\Users\Acer\OneDrive\Desktop\Lucca_menu-`**
**جميع التطويرات المستقبلية يجب أن تتم داخل هذا المسار فقط.**
**ممنوع إنشاء أو اعتماد نسخة مستقلة جديدة من المشروع.**