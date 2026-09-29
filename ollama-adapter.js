/*
╔══════════════════════════════════════════════════════════════╗
║   LUCCA LLM Adapter — Ollama Local (Default) + OpenAI Optional ║
║   Ollama المحلي (qwen2.5:3b) هو الخيار الأساسي المجاني،       ║
║   ويُضاف OpenAI API (أو أي مزود متوافق chat/completions) كمزود ║
║   احتياطي "عند الحاجة" عبر إعدادات محلية مرنة (localStorage).  ║
║                                                               ║
║   النموذج/العنوان يُقرآن حياً من الإعدادات (luccaOllamaModel / ║
║   luccaOllamaHost) — selection يُحفظ ويصمد أمام إعادة التشغيل. ║
║                                                               ║
║   أوضاع المزود luccaAIProvider:                                ║
║     auto    -> Ollama أولاً؛ OpenAI احتياطي عند تعذّر Ollama     ║
║     ollama  -> Ollama فقط (الافتراضي الفردي المجاني)            ║
║     openai  -> OpenAI فقط                                       ║
╚══════════════════════════════════════════════════════════════╝
*/

window.OllamaAI = (function() {
    // وصول آمن لـ localStorage في كل البيئات
    function kGet(k) {
        try { return (typeof localStorage !== 'undefined' && localStorage) ? localStorage.getItem(k) : null; }
        catch(e) { return null; }
    }
    function kSet(k, v) {
        try { if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(k, v); } catch(e) {}
    }

    const DEFAULT_HOST = 'http://localhost:11434';
    const DEFAULT_MODEL = 'qwen2.5:3b';

    // ===== إعدادات Ollama النشطة (تُقرأ حياً من الإعدادات المحلية — تدوم عبر إعادة التشغيل) =====
    function oHost() {
        const h = kGet('luccaOllamaHost');
        if (!h || !String(h).trim()) return DEFAULT_HOST;
        return String(h).trim().replace(/[\/\s]+$/, '') || DEFAULT_HOST;
    }
    function oModel() {
        const m = kGet('luccaOllamaModel');
        return (m && String(m).trim()) ? String(m).trim() : DEFAULT_MODEL;
    }
    function setOllamaHost(h) {
        kSet('luccaOllamaHost', String(h || '').trim().replace(/\/+$/, ''));
        _available = null; // تجاهل ذاكرة التوفر القديمة
    }
    function getOllamaHost() { return oHost(); }
    function setOllamaModel(m) { kSet('luccaOllamaModel', String(m || '').trim()); }
    function getOllamaModel() { return oModel(); }

    // ============ H1: عنوان السيرفر والمصادقة (لبروكسي LLM) ============
    // نفس اصطلاح الواجهات: luccaServerUrl + (session luccaToken أو device x-api-key)
    function sGet(k) {
        try { return (typeof sessionStorage !== 'undefined' && sessionStorage) ? sessionStorage.getItem(k) : null; }
        catch(e) { return null; }
    }
    function _serverBase() {
        return (kGet('luccaServerUrl') || 'http://localhost:3000').replace(/\/+$/, '');
    }
    function _authHeaders() {
        const h = { 'Content-Type': 'application/json' };
        const tok = sGet('luccaToken');
        if (tok) { h['x-session-token'] = tok; return h; }
        const key = kGet('luccaApiKey');
        if (key) h['x-api-key'] = key;
        return h;
    }

    // ============ إعدادات OpenAI (بيئة محلية — اختيارية مرنة) ============
    const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
    const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

    function getProviderMode() {
        const v = kGet('luccaAIProvider');
        return (v === 'openai' || v === 'ollama') ? v : 'auto'; // auto افتراضياً
    }
    function setProvider(mode) {
        kSet('luccaAIProvider', (mode === 'openai' || mode === 'ollama') ? mode : 'auto');
    }
    function getOpenAIModel() { return (kGet('luccaOpenAIModel') || '').trim() || DEFAULT_OPENAI_MODEL; }
    function setOpenAIModel(m) { kSet('luccaOpenAIModel', String(m || '').trim()); }
    function getOpenAIBase() { return (kGet('luccaOpenAIBase') || '').trim() || DEFAULT_OPENAI_BASE; }
    function setOpenAIBase(b) { kSet('luccaOpenAIBase', String(b || '').trim()); }

    // ===== P0 عزل السر: لا مفتاح OpenAI في المتصفح إطلاقاً =====
    // المصدر الوحيد: متغير البيئة OPENAI_API_KEY على الخادم.
    // أي مفتاح قديم مخزّن في المتصفح يُمحى عند التحميل.
    try {
        if (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem('luccaOpenAIKey')) {
            localStorage.removeItem('luccaOpenAIKey');
        }
    } catch(e) {}
    function getOpenAIKey() { return ''; }                       // لا تُعدّ سرّاً في الواجهة إطلاقاً
    function setOpenAIKey() { return false; }                   // رفض صريح: لا يُحفظ من الواجهة

    let _openaiRemote = null;                                  // null = لم يُفحص بعد
    let _openaiProbeAt = 0;
    const OPENAI_PROBE_TTL = 60000;

    // فحص جاهزية OpenAI على الخادم (bool فقط — بلا أسرار) مع كاش 60 ثانية
    async function openaiStatus(force) {
        if (_openaiRemote !== null && !force && (Date.now() - _openaiProbeAt) < OPENAI_PROBE_TTL) return _openaiRemote;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 4000);
            const res = await fetch(`${_serverBase()}/api/proxy-llm/status`, { headers: _authHeaders(), signal: ctrl.signal });
            clearTimeout(t);
            const j = await res.json().catch(() => null);
            _openaiRemote = !!(res.ok && j && j.openaiConfigured);
        } catch(e) {
            _openaiRemote = false;
        }
        _openaiProbeAt = Date.now();
        return _openaiRemote;
    }
    function hasOpenAI() { return _openaiRemote === true; }      // قراءة من الكاش فقط (متزامن)

    let _available = null; // cached (يُصفَّر عند تغيير العنوان/الوضع)

    // حالة التفعيل (افتراضية مفعّلة) — تخص Ollama المحلي
    function isEnabled() {
        const v = kGet('luccaOllamaEnabled');
        return v === null ? true : (v === '1' || v === 'true');
    }
    function setEnabled(on) {
        kSet('luccaOllamaEnabled', on ? '1' : '0');
    }

    // هل هناك أي مزود قابل للاستخدام حالياً؟ (البوابة الموحّدة للعبارات)
    async function llmReady(force) {
        const mode = getProviderMode();
        if (mode === 'openai') return await openaiStatus(force);
        if (!isEnabled()) return mode === 'auto' ? await openaiStatus(force) : false;
        const h = await health(force);
        // Ollama جاهز فقط إذا كان النموذج المحدد مثبّتاً فعلاً (لا "الخدمة متصلة" فقط).
        if (h.state === 'ready' || h.state === 'openai') return true;
        if (mode === 'ollama') return false;
        return await openaiStatus(force); // auto: Ollama غير جاهز -> OpenAI عند الحاجة
    }

    // هل المساعد مفعّل (أي مزود)؟ لتجاوز بوابة isEnabled القديمة في الواجهات
    function llmEnabled() {
        const mode = getProviderMode();
        if (mode === 'openai') return hasOpenAI();
        return isEnabled() || (mode === 'auto' && hasOpenAI());
    }

    function fmtModel(model) {
        return model || oModel();
    }

    // ============ OLLAMA: فحص المتاحين ============
    // فحص توفر خدمة Ollama (cached 10 ثواني) — استناداً إلى العنوان النشط
    async function isAvailable(force) {
        if (_available !== null && !force) return _available;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3000);
            const res = await fetch(`${oHost()}/api/tags`, { signal: ctrl.signal });
            clearTimeout(t);
            _available = res.ok;
        } catch(e) {
            _available = false;
        }
        return _available;
    }

    // باعث إلغاء بفاصل زمني (لحدود فحوص الشبكة دون ترك تعليق مفتوح)
    function abortSignal(ms) {
        try { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return c.signal; } catch(e) { return undefined; }
    }

    // قائمة النماذج — Ollama المحلي فقط (لا اتصال مباشر بأي مزود سحابي)
    async function listModels() {
        try {
            const res = await fetch(`${oHost()}/api/tags`);
            if (!res.ok) return [];
            const j = await res.json();
            return (j.models || []).map(m => m.name);
        } catch(e) { return []; }
    }

    // ====== حالات صحّة Ollama (إفصاح صريح للواجهات/باتمان) ======
    //   disabled        : معطّل من الإعدادات
    //   unavailable     : الخدمة غير متصلة (المسدس المنفصل)
    //   model-missing   : الخدمة متصلة لكن النموذج المحدد غير مثبّت (لا تنزيل تلقائي)
    //   ready           : الخدمة متصلة والنموذج المحدد مثبّت
    //   openai          : وضع OpenAI فقط
    async function health(force) {
        const enabled = isEnabled();
        const mode = getProviderMode();
        const model = getOllamaModel();
        const host = getOllamaHost();
        if (mode === 'openai') return { state: 'openai', model, enabled: await openaiStatus(), host };
        if (!enabled) return { state: 'disabled', model, enabled: false, host };
        let tags = null;
        try {
            const res = await fetch(`${host}/api/tags`, { signal: abortSignal(3000) });
            if (res.ok) { const j = await res.json(); tags = (j.models || []).map(m => m.name); }
        } catch(e) { tags = null; }
        if (tags === null) return { state: 'unavailable', model, enabled, host };
        const selectedBase = model.indexOf(':') > -1 ? null : model;
        const installed = tags.some(n => {
            if (!n) return false;
            if (n === model) return true;
            return selectedBase !== null && n.split(':')[0] === selectedBase;
        });
        return {
            state: installed ? 'ready' : 'model-missing',
            model,
            enabled,
            host,
            installed,
            availableModels: tags
        };
    }

    // keep_alive = متى يبقى النموذج محمّلاً في الذاكرة بعد الاستخدام (تسريع التحميل البارد)
    function keepAliveFrom(opts) {
        const v = opts.keepAlive;
        if (v === undefined || v === null) return -1;   // افتراضياً: أبقِ النموذج محمّلاً دائماً (أسرع)
        return v;
    }

    // تصنيف أخطاء Ollama: نَمط "model not found" => MODEL_NOT_FOUND (للإفصاح لا للتسبب)
    function classifyOllamaError(status, detail) {
        const result = { ok: false, provider: 'ollama' };
        if (!detail) detail = 'Ollama HTTP ' + status;
        if (/model.*(not found|doesn.t exist|missing)/i.test(detail) || /not found.*model/i.test(detail)) {
            result.code = 'MODEL_NOT_FOUND';
        } else {
            result.code = 'OLLAMA_ERROR';
        }
        result.error = detail;
        return result;
    }

    // ============ OLLAMA: التوليد ============
    async function ollamaGenerate(prompt, opts) {
        const body = {
            model: fmtModel(opts.model),
            prompt: String(prompt),
            stream: false,
            keep_alive: keepAliveFrom(opts),
            options: {
                temperature: opts.temperature !== undefined ? opts.temperature : 0.3,
                num_ctx: opts.numCtx || 4096,
                num_predict: opts.numPredict || -1
            }
        };
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), opts.timeout || 60000);
            const res = await fetch(`${oHost()}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) {
                let detail = '';
                try { const b = await res.json(); detail = (b && b.error) || ''; } catch(_) {}
                return classifyOllamaError(res.status, detail);
            }
            const j = await res.json();
            return { ok: true, text: (j.response || '').trim(), provider: 'ollama' };
        } catch(e) {
            return { ok: false, provider: 'ollama', code: 'OLLAMA_UNREACHABLE', error: e.name === 'AbortError' ? 'انتهت مهلة Ollama' : e.message };
        }
    }

    async function ollamaChat(system, user, opts) {
        const body = {
            model: fmtModel(opts.model),
            messages: [
                { role: 'system', content: system || '' },
                { role: 'user', content: String(user) }
            ],
            stream: false,
            keep_alive: keepAliveFrom(opts),
            options: {
                temperature: opts.temperature !== undefined ? opts.temperature : 0.3,
                num_ctx: opts.numCtx || 4096,
                num_predict: opts.numPredict || -1
            }
        };
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
            const res = await fetch(`${oHost()}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) {
                let detail = '';
                try { const b = await res.json(); detail = (b && b.error) || ''; } catch(_) {}
                return classifyOllamaError(res.status, detail);
            }
            const j = await res.json();
            const msg = j.message && j.message.content;
            return { ok: true, text: (msg || '').trim(), provider: 'ollama' };
        } catch(e) {
            return { ok: false, provider: 'ollama', code: 'OLLAMA_UNREACHABLE', error: e.name === 'AbortError' ? 'انتهت مهلة Ollama' : e.message };
        }
    }

    // ============ OPENAI (أو أي مزود متوافق chat/completions) ============
    // P0 عزل السر: المسار الوحيد هو بروكسي السيرفر (/api/proxy-llm) — لا مفتاح، ولا اتصال مباشر.
    async function openaiViaProxy(payload, opts, ctx) {
        const timeout = (opts.timeout || 90000) + 10000;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), timeout);
            const res = await fetch(`${ctx.server}/api/proxy-llm`, {
                method: 'POST',
                headers: _authHeaders(),
                body: JSON.stringify({
                    target: 'openai',
                    base: ctx.base,
                    model: payload.model,
                    messages: payload.messages,
                    temperature: payload.temperature,
                    max_tokens: payload.max_tokens,
                    timeoutMs: timeout
                }),
                signal: ctrl.signal
            });
            clearTimeout(t);
            const j = await res.json().catch(() => null);
            if (res.ok && j && j.ok) {
                return { used: true, ok: true, text: (j.text || '').trim() };
            }
            const msg = (j && j.error) || ('/api/proxy-llm HTTP ' + res.status);
            if (res.status === 401 || res.status === 403) {
                return { used: true, ok: false, code: 'SESSION_REQUIRED', error: 'OpenAI عبر السيرفر يتطلب جلسة صالحة على هذا الجهاز.' };
            }
            if (res.status === 400) {
                return { used: true, ok: false, code: 'OPENAI_NOT_CONFIGURED', error: msg };
            }
            return { used: true, ok: false, code: 'PROXY_ERROR', error: msg };
        } catch(e) {
            const msg = (e && e.name === 'AbortError') ? 'انتهت مهلة بروكسي السيرفر' : (e && e.message ? e.message : String(e));
            return { used: true, ok: false, code: 'PROXY_UNREACHABLE', error: 'تعذّر الوصول لبروكسي السيرفر — OpenAI يعمل عبر الخادم فقط (متغير البيئة OPENAI_API_KEY). (' + msg + ')' };
        }
    }

    async function openaiChatRequest(payload, opts) {
        const res = await openaiViaProxy(payload, opts, { base: getOpenAIBase().replace(/\/$/, ''), server: _serverBase() });
        if (res.ok) return { ok: true, text: res.text || '', provider: 'openai' };
        return { ok: false, provider: 'openai', code: res.code, error: res.error || 'تعذّر تنفيذ طلب OpenAI' };
    }

    async function openaiChat(system, user, opts) {
        return openaiChatRequest({
            model: opts.openAIModel || opts.model || getOpenAIModel(),
            messages: [
                { role: 'system', content: String(system || '') },
                { role: 'user', content: String(user) }
            ],
            temperature: opts.temperature !== undefined ? opts.temperature : 0.3,
            max_tokens: opts.numPredict || opts.maxTokens || 500
        }, opts);
    }

    async function openaiGenerate(prompt, opts) {
        return openaiChatRequest({
            model: opts.openAIModel || opts.model || getOpenAIModel(),
            messages: [{ role: 'user', content: String(prompt) }],
            temperature: opts.temperature !== undefined ? opts.temperature : 0.3,
            max_tokens: opts.numPredict || opts.maxTokens || 500
        }, opts);
    }

    // ============ الموجّه (Router): Ollama أولاً مجانياً ============
    async function chat(system, user, opts) {
        opts = opts || {};
        const mode = getProviderMode();

        // 1) Ollama المحلي أولاً (الخيار الأساسي والمجاني)
        if (mode !== 'openai' && isEnabled()) {
            const res = await ollamaChat(system, user, opts);
            if (res.ok || mode === 'ollama' || !(await openaiStatus())) return res;
            // auto: Ollama فشل -> ننتقل لـ OpenAI عبر السيرفر
        } else if (mode === 'ollama') {
            return { ok: false, code: 'OLLAMA_DISABLED', error: 'Ollama معطّل — فعّله من إعدادات الذكاء' };
        }

        // 2) OpenAI عند الحاجة (وضع openai أو auto مع فشل Ollama) — عبر السيرفر فقط
        if (mode === 'openai' || mode === 'auto') {
            if (await openaiStatus()) return await openaiChat(system, user, opts);
        }

        if (mode === 'openai') return { ok: false, code: 'OPENAI_NOT_CONFIGURED', error: 'OpenAI اختياري وغير مُهيّأ على الخادم: يُضبط المفتاح في متغير البيئة OPENAI_API_KEY على الخادم فقط.' };
        return { ok: false, code: 'NO_PROVIDER', error: 'لا مزود LLM متاح: Ollama غير متصل (شغّل خدمة Ollama محلياً)' };
    }

    async function generate(prompt, opts) {
        opts = opts || {};
        const mode = getProviderMode();
        if (mode !== 'openai' && isEnabled()) {
            const res = await ollamaGenerate(prompt, opts);
            if (res.ok || mode === 'ollama' || !(await openaiStatus())) return res;
        } else if (mode === 'ollama') {
            return { ok: false, code: 'OLLAMA_DISABLED', error: 'Ollama معطّل — فعّله من إعدادات الذكاء' };
        }
        if (mode === 'openai' || mode === 'auto') {
            if (await openaiStatus()) return await openaiGenerate(prompt, opts);
        }
        return { ok: false, code: 'NO_PROVIDER', error: 'لا مزود LLM متاح' };
    }

    // 🔍 استخراج JSON آمن من رد النموذج
    function extractJSON(text) {
        if (!text) return null;
        try { return JSON.parse(text); } catch(e) {}
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
        const arr = text.match(/\[[\s\S]*\]/);
        if (arr) { try { return JSON.parse(arr[0]); } catch(e) {} }
        return null;
    }

    // ============ إعدادات/حالة المزود للواجهات ============
    function getConfig() {
        return {
            provider: getProviderMode(),
            ollamaHost: getOllamaHost(),
            ollamaModel: getOllamaModel(),
            ollamaEnabled: isEnabled(),
            openAIKeySet: hasOpenAI(),
            openAIKeyMasked: '',                    // لا مقطع مفتاح في الواجهة إطلاقاً
            openAIKeySource: 'server:OPENAI_API_KEY',
            openAIModel: getOpenAIModel(),
            openAIBase: getOpenAIBase()
        };
    }

    async function providerInfo() {
        const mode = getProviderMode();
        const h = await health();
        const openaiReady = await openaiStatus();
        const stateText = (h.state === 'ready') ? 'النموذج المحدد جاهز ✓'
            : (h.state === 'model-missing') ? '⚠️ النموذج المحدد غير مثبّت — اختر من القائمة: «النماذج»'
            : (h.state === 'unavailable') ? 'غير متصل ✗'
            : (h.state === 'disabled') ? 'معطّل ✗'
            : (h.state === 'openai') ? 'وضع OpenAI'
            : '—';
        const lines = [
            '🧠 **إعدادات مزود الذكاء**',
            '· الوضع: ' + (mode === 'auto' ? 'تلقائي (Ollama أولاً ثم OpenAI عند الحاجة)' : (mode === 'ollama' ? 'Ollama محلي فقط (مجاني)' : 'OpenAI سحابي فقط')),
            '· Ollama: ' + (isEnabled() ? 'مفعّل ✓ ' : 'معطّل ✗ ') + '— ' + stateText + ' (' + getOllamaHost() + ')',
            '· النموذج المحدد: ' + getOllamaModel() + (Array.isArray(h.availableModels) && h.availableModels.length ? ' — المثبّت: ' + h.availableModels.join('، ') : ''),
            '· OpenAI: ' + (openaiReady ? 'مُهيّأ على الخادم ✓ (' + getOpenAIModel() + ')' : 'غير مُهيّأ على الخادم (اختياري)')
        ];
        return lines.join('\n') + '\n\n💡 أوامر: "استخدم ollama" / "استخدم openai" / "الوضع التلقائي" / "استخدم نموذج <الاسم>"\n🔐 مفتاح OpenAI لا يُدخل من الواجهة — يُضبط في متغير البيئة OPENAI_API_KEY على الخادم فقط.';
    }

    // ============ TOOL SELECTION (قراءة فقط — يختار من قائمة معطاة فقط) ============
    // يُستخدَم لأدوات "اسأل باتمان": اختيار أداة قراءة من قائمة مقدَّمة، مع إنكار كل ما لا يطابقها.
    const _registeredTools = {}; // الاسم -> {schema, handler}

    function registerTool(schema, handler) {
        const name = schema && schema.name;
        if (!name || typeof handler !== 'function') return false;
        _registeredTools[name] = { schema, handler };
        return true;
    }
    function registeredTools() {
        return Object.keys(_registeredTools).map(n => _registeredTools[n].schema);
    }
    async function runTool(name, params, opts) {
        const reg = _registeredTools[name];
        if (!reg) throw new Error('Tool not registered: ' + name);
        return reg.handler(params || {}, opts || {});
    }

    // يختار أداة/أدوات من القائمة المعطاة فقط → {ok:true,calls:[...]} | {ok:true,answer}
    async function selectTool(tools, text, opts) {
        opts = opts || {};
        const byName = {};
        (Array.isArray(tools) ? tools : []).forEach(t => { if (t && t.name) byName[t.name] = t; });
        if (Object.keys(byName).length === 0) return { ok: false, error: 'قائمة الأدوات فارغة' };
        const listJson = JSON.stringify(Object.keys(byName).map(n => {
            const t = byName[n];
            return { name: t.name, description: t.description, parameters: t.parameters || {} };
        }), null, 1);
        const system = 'أنت موجّه أدوات صارم. ستُعرض عليك قائمة JSON لأدوات قراءة فقط، ومهمتك اختيار ما يناسب السؤال.\n' +
            'لا تكتب SQL، ولا تنفّذ، ولا تكتب بيانات — أدواتك قراءة فقط، ولا يوجد أي أداة كتابة.\n' +
            'ردّ فوراً بصيغة JSON فقط (بدون markdown أو أي نص إضافي):\n' +
            '1) {"calls":[{"tool":"<الاسم>","params":{...}}]}\n' +
            '2) {"calls":[{"tool":"الأول","params":{}},{"tool":"الثاني","params":{}}]} إن كان السؤال يحتاج أكثر من أداة (مقارنة/متعدد)\n' +
            '3) {"answer":"سبب مختصر بجملة واحدة"} إن لم يطابق السؤال أي أداة\n' +
            'استخدم أسماء الأدوات من القائمة فقط، ولا تخترع معاملات خارج مخطط (parameters) الأداة، ولا تعتمد على أرقام بشكل تخميني.\n\nالأدوات المتاحة:\n' + listJson;
        const res = await chat(system, text, opts);
        if (!res.ok) return { ok: false, error: res.error || 'تعذر الحصول على اختيار الأداة' };
        const obj = extractJSON(res.text);
        if (!obj || typeof obj !== 'object') return { ok: false, error: 'استجابة اختيار الأداة ليست JSON صالحاً' };
        if (obj.answer) return { ok: true, answer: String(obj.answer) };

        const rawCalls = Array.isArray(obj.calls) ? obj.calls
            : (Array.isArray(obj.tool) ? obj.tool.map(t => ({ tool: t, params: obj.params })) : []);
        if (!rawCalls.length && obj.tool && typeof obj.tool === 'string') rawCalls.push({ tool: obj.tool, params: obj.params });
        const calls = [];
        for (const c of rawCalls) {
            if (!c || typeof c !== 'object') continue;
            const name = String(c.tool || '').trim();
            if (!byName[name]) continue; // أمان: لا ندعو أداة خارج القائمة أبداً
            calls.push({ tool: name, params: (c.params && typeof c.params === 'object') ? c.params : {} });
        }
        if (!calls.length) return { ok: true, answer: 'لم يطابق السؤال أي أداة ضمن القائمة المتاحة.' };
        return { ok: true, calls };
    }

    // لخّص نتائج القراءة المهيكلة بلغة عربية إدارية مناسبة للمدير (قراءة فقط)
    async function summarizeToolResults(system, userText, results, opts) {
        opts = opts || {};
        const payload = 'سؤال المستخدم:\n' + String(userText || '') + '\n\nنتائج القراءة (JSON حقيقي من السجل، لا تُعدّلها):\n' + JSON.stringify(results || []);
        const res = await chat(system, payload, opts);
        if (!res.ok) return { ok: false, error: res.error || 'تعذر إنتاج الملخص' };
        return { ok: true, text: res.text };
    }

    return {
        isAvailable,
        llmReady,
        llmEnabled,
        listModels,
        health,
        generate,
        chat,
        extractJSON,
        isEnabled,
        setEnabled,
        // إعدادات المزود المرنة (Ollama + OpenAI)
        getProviderMode,
        setProvider,
        getOpenAIKey,
        hasOpenAI,
        openaiStatus,
        setOpenAIKey,
        getOpenAIModel,
        setOpenAIModel,
        getOpenAIBase,
        setOpenAIBase,
        // إعدادات Ollama الدائمة (النموذج/العنوان) — تُحفظ في localStorage
        getOllamaHost,
        setOllamaHost,
        getOllamaModel,
        setOllamaModel,
        getConfig,
        providerInfo,
        // أدوات القراءة (اسأل باتمان وغيرها)
        selectTool,
        summarizeToolResults,
        registerTool,
        registeredTools,
        runTool,
        get host() { return oHost(); },
        get model() { return oModel(); }
    };
})();