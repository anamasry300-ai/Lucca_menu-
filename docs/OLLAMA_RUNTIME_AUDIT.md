# OLLAMA_RUNTIME_AUDIT — تشغيل Ollama المحلي واستمرار اختيار النموذج

> Phase 4.5 | Checkpoint `8b30f43` | لا يُدفع/يُلتزم/يُعدَّل المرقم
> نطاق التحقيق: (B) عدم استقرار Ollama + استمرار النموذج المحدد عبر إعادة التشغيل

---

## 1. الجذر المثبَت (Root Cause B)

| العلة | التفصيل |
|---|---|
| الرابط ثابت | `ollama-adapter.js` كان يثبّت `OLLAMA_HOST = http://localhost:11434` و`DEFAULT_MODEL = 'qwen2.5:3b'` كثوابت IIFE تُقرأ **مرة واحدة عند التحميل**؛ لا توجد أي دالة `setOllamaModel`/`setOllamaHost` في الكود كله، ولا أي واجهة تكتب `luccaOllamaModel`/`luccaOllamaHost` في أي صفحة. |
| سلامتة الخلط | `health` (غير موجودة أصلاً كبشكل مُفصَّل) و`isAvailable` كانتا تخلطان «الخدمة ترد» مع «النموذج جاهز»؛ فالتحقق الإجمالي `llmReady` كان يعلن الجاهزية حتى لو كان النموذج المطلوب غير مثبّت. |
| الخطأ غير المفهوم | عند غياب النموذج لم يكن هناك رمز خطأ واضح — فقط failure جزء مفقود من رسالة Ollama. |

إثبات أحمر (قبل الإصلاح): `node scripts/test-ollama-runtime.cjs` انهار عند `AI.setOllamaModel is not a function` — التأكيتم أن لا دالة اختيار نموذج إطلاقاً.

## 2. ما تم تغييره

إعادة بناء `ollama-adapter.js` كاملة بقلم نظيف (كل الصادرات القديمة حُفظت، ولا صادرات محذوفة):

| القدرة الجديدة | الوصف |
|---|---|
| `getOllamaModel()` / `setOllamaModel(model)` | يقرأ/يكتب `localStorage['luccaOllamaModel']` حياً — **يستمر عبر إعادة التشغيل** |
| `getOllamaHost()` / `setOllamaHost(host)` | يقرأ/يكتب `localStorage['luccaOllamaHost']` حياً ويمسح ذاكرة التوفر القديمة |
| `health(force)` | يرجع `{state}` من بين: `disabled` / `unavailable` / `model-missing` / `ready` / `openai` (مع `host`, `model`, `installed`, `availableModels`) |
| مطابقة قاعدة بلا tag | **مقصودة**: إذا كان النموذج المحدد بلا `:` (مثل `qwen2.5`) يُعتبر مثبّتاً متى وُجد أي tag من نفس القاعدة (`qwen2.5:*`) — تناظر دلالة الـ untagged reference في Ollama؛ أما الاسم الكامل `name:tag` فيتطلب تطابقاً حرفياً. مقفل بفحصي 7b/7c. |
| `llmReady(force)` | الآن مقترنة بالصحة: «ready» فقط حين يكون النموذج المحدد مثبّتاً فعلاً (لا خدمة فقط) |
| رمز الخطأ | `chat()`/`generate()` مع ردّ يطابق `/model.*not found/` يرجع `code: 'MODEL_NOT_FOUND'` مشرّحاً |
| `host` / `model` | معلَّمتَين بصفتين (getter) في كائن الإرجاع — المتهمون القدامى `OllamaAI.model`/`host` يعملون بلا تغيير |
| `getConfig()` | ملخص الإعدادات الحية للواجهات (الوضع، العنوان، النموذج، حالة المفتاح، OPENAI BASE) |
| حداً زمنياً | فحوص الصحة/التوفر بحد زمني (AbortController 3000ms) حتى لا تُعلّق واجهات الباتمان |
| لا تنزيل تلقائي | لا يشغّل أي تنزيل للنماذج مطلقاً — فقط كشف/اختيار |

### تحسين الواجهات (التقليل من الطريق للمسخدم)

- **POS `index.html`** (معالج أوامر الباتمان):
  - أمر **«استخدم نموذج <الاسم>»** → `setOllamaModel` + حفظ محلي؛
  - أمر **«النماذج»/«قائمة النماذج»** → يعرض المثبّتة مع تمييز المحدد؛
  - «حالة الذكاء» → يقرأ `health()` فيميّز `ready`/`model-missing`/`unavailable`.
- **`admin/system-health.js`** — قسم Ollama يعرض الآن حالات متميزة (جاهز ✓ / النموذج غير مثبّت / لا استجابة / معطّل / وضع OpenAI) بدل «لا استجابة» فقط.

### التحقق من المحافظة على كل المستهلكين

البحث الشامل عن استدعاءات `OllamaAI.*` في `*.js`/`*.html` كلها موجودة قائمة بعد الإصلاح: `chat`, `generate`, `isAvailable`, `isEnabled`, `setEnabled`, `llmReady`, `llmEnabled`, `listModels`, `setProvider`, `hasOpenAI`, `getOpenAIModel`, `setOpenAIKey`, `model`, `providerInfo`, `registeredTools`, `getOllamaModel`, `setOllamaModel`, `health`. —
مستهلكون مجهريون مدققون: `batman-dashboard.js:1402`، `admin/index.html:4759/4765`، `batman-questions.js:682`، `admin/system-health.js`، `invoice-scanner.js:17`، محادثة الفاتورة في POS.

## 3. الاختبارات (أحمر → أخضر)

`scripts/test-ollama-runtime.cjs` — 17 فحصاً مع vdal مقعد (stub للشبكة):

| الفحص | النتيجة |
|---|---|
| استمرار النموذج: set → reload → get | ✓ |
| chat() يرسل النموذج المحدد في body | ✓ |
| health: daemon off → unavailable / مثبّت → ready / غير مثبّت → model-missing | ✓ |
| health: اسم النموذج بلا tag يطابق أي tag مثبّت بنفس القاعدة | ✓ (فحص 7b) |
| health: قاعدة غير مثبّتة بلا tag → model-missing | ✓ (فحص 7c) |
| `/model not found` → `MODEL_NOT_FOUND` | ✓ |
| `llmReady` = صح فقط عند ready | ✓ |
| استمرار العنوان وفحصه عند reload | ✓ |
| تعطيل/تفعيل يستمر | ✓ |
| listModels | ✓ |

**17/17** (قبل الإصلاح: انهيار عند `setOllamaModel is not a function`).

## 4. التحقق اليدوي الحقيقي (سيرفر Ollama فعلي)

في بيئة التحقق (Windows، Ollama مشغّل على 11434):

```
installed: qwen2.5:3b
health()  → { state:'ready', host:'http://localhost:11434', installed:['qwen2.5:3b'] }
llmReady()→ true
setOllamaModel('qwen2.5:3b') → getOllamaModel() → 'qwen2.5:3b'  (يتجاوز إعادة التحميل)
```

ملاحظة بيئة(): النموذج المثبّت فعلياً على هذا الجهاز هو **qwen2.5:3b** (وليس qwen2.5-coder:7b)؛ الكود لا يفترض أي منهما — يكشف القائمة في `health().availableModels` و«حالة الذكاء» تعرضها، وأمر «استخدم نموذج <الاسم>» يسمح بالاختيار. لا يوجد أي تنزيل تلقائي.

## 5. النطاق المستبعد عن عمد

- لا تغيير في schema/مخطط DB (الإعدادات محلية في localStorage — لا جيدة).
- لا تنزيل/سحب نماذج تلقائي.
- لا تغيير في نقاط نهاية السيرفر أو الـ SSRF guard أو فئة الطبقة/التوجيه المالية.
- لا `OLLAMA_KEEP_ALIVE`/`OLLAMA_NUM_THREADS` جديدة (لا توجد مراجع سابقة، خارج النطاق).