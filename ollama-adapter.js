/*
╔══════════════════════════════════════════════════════════════╗
║   LUCCA LLM Adapter — Ollama Local (Default) + OpenAI Optional ║
║   Ollama المحلي (qwen2.5:3b) هو الخيار الأساسي المجاني،       ║
║   ويُضاف OpenAI API (أو أي مزود متوافق chat/completions) كمزود ║
║   احتياطي "عند الحاجة" عبر إعدادات محلية مرنة (localStorage).  ║
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

    const OLLAMA_HOST = kGet('luccaOllamaHost') || 'http://localhost:11434';
    const DEFAULT_MODEL = kGet('luccaOllamaModel') || 'qwen2.5:3b';

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
    function getOpenAIKey() { return (kGet('luccaOpenAIKey') || '').trim(); }
    function hasOpenAI() { return !!getOpenAIKey(); }
    function setOpenAIKey(key) { kSet('luccaOpenAIKey', String(key || '').trim()); }
    function getOpenAIModel() { return (kGet('luccaOpenAIModel') || '').trim() || DEFAULT_OPENAI_MODEL; }
    function setOpenAIModel(m) { kSet('luccaOpenAIModel', String(m || '').trim()); }
    function getOpenAIBase() { return (kGet('luccaOpenAIBase') || '').trim() || DEFAULT_OPENAI_BASE; }
    function setOpenAIBase(b) { kSet('luccaOpenAIBase', String(b || '').trim()); }

    let _available = null; // cached

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
        if (mode === 'openai') return hasOpenAI();
        const ollamaOk = await isAvailable(force);
        if (ollamaOk) return true;
        if (mode === 'ollama') return false;
        return hasOpenAI(); // auto: فشل Ollama -> نستخدم OpenAI عند الحاجة
    }

    // هل المساعد مفعّل (أي مزود)؟ لتجاوز بوابة isEnabled القديمة في الواجهات
    function llmEnabled() {
        const mode = getProviderMode();
        if (mode === 'openai') return hasOpenAI();
        return isEnabled() || (mode === 'auto' && hasOpenAI());
    }

    function fmtModel(model) {
        return model || DEFAULT_MODEL;
    }

    // ============ OLLAMA: فحص المتاحين ============
    // فحص توفر Ollama (cached 10 ثواني)
    async function isAvailable(force) {
        if (_available !== null && !force) return _available;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3000);
            const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: ctrl.signal });
            clearTimeout(t);
            _available = res.ok;
        } catch(e) {
            _available = false;
        }
        return _available;
    }

    // قائمة النماذج (Ollama محلياً، أو OpenAI عند ضبط المفتاح ووضع البعيد)
    async function listModels() {
        const mode = getProviderMode();
        if (mode !== 'ollama' && hasOpenAI() && mode !== 'auto') {
            try {
                const base = getOpenAIBase().replace(/\/$/, '');
                const res = await fetch(`${base}/models`, {
                    headers: { 'Authorization': 'Bearer ' + getOpenAIKey() }
                });
                if (res.ok) {
                    const j = await res.json();
                    const names = (j.data || []).map(m => m.id);
                    if (names.length) return names;
                }
            } catch(e) {}
        }
        try {
            const res = await fetch(`${OLLAMA_HOST}/api/tags`);
            if (!res.ok) return [];
            const j = await res.json();
            return (j.models || []).map(m => m.name);
        } catch(e) { return []; }
    }

    // keep_alive = متى يبقى النموذج محمّلاً في الذاكرة بعد الاستخدام (تسريع التحميل البارد)
    function keepAliveFrom(opts) {
        const v = opts.keepAlive;
        if (v === undefined || v === null) return -1;   // افتراضياً: أبقِ النموذج محمّلاً دائماً (أسرع)
        return v;
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
            const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) return { ok: false, error: `Ollama HTTP ${res.status}` };
            const j = await res.json();
            return { ok: true, text: (j.response || '').trim(), provider: 'ollama' };
        } catch(e) {
            return { ok: false, error: e.name === 'AbortError' ? 'انتهت مهلة Ollama' : e.message };
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
            const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) return { ok: false, error: `Ollama HTTP ${res.status}` };
            const j = await res.json();
            const msg = j.message && j.message.content;
            return { ok: true, text: (msg || '').trim(), provider: 'ollama' };
        } catch(e) {
            return { ok: false, error: e.name === 'AbortError' ? 'انتهت مهلة Ollama' : e.message };
        }
    }

    // ============ OPENAI (أو أي مزود متوافق chat/completions) ============
    // H1: المسار المفضل — عبر بروكسي السيرفر (/api/proxy-llm) الذي يفك CORS ويخفي المفتاح.
    // عند تعذّر الوصول للسيرفر (غير مشغّل/غير مصرح) نلجأ للاتصال المباشر (السلوك القديم).
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
                    key: ctx.key,
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
                return { used: true, ok: true, text: (j.text || '').trim(), hardError: true };
            }
            // أخطاء مؤكدة من المزود/السيرفر لا فائدة من العودة للمباشر؛
            // 401 من السيرفر = غير مصرح (لا جلسة/مفتاح جهاز) أو غير مشغّل → ننزل للمباشر.
            const canRetry = res.status === 401 || res.status === 500 || res.status === 404;
            return { used: true, ok: false, hardError: !canRetry, error: (j && j.error) || '(api/proxy-llm HTTP ' + res.status + ')' };
        } catch(e) {
            if (e && e.name === 'AbortError') return { used: true, ok: false, hardError: false, error: 'انتهت مهلة بروكسي السيرفر' };
            return { used: true, ok: false, hardError: false, error: e && e.message ? e.message : String(e) };
        }
    }

    async function openaiChatRequest(payload, opts) {
        const key = getOpenAIKey();
        if (!key) return { ok: false, error: 'لا يوجد مفتاح OpenAI API مضبوط' };
        const base = getOpenAIBase().replace(/\/$/, '');
        const server = _serverBase();

        const viaProxy = await openaiViaProxy(payload, opts, { key, base, server });
        if (viaProxy.used && viaProxy.hardError) {
            return { ok: viaProxy.ok, text: viaProxy.text || '', provider: 'openai', error: viaProxy.error };
        }

        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
            const res = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: JSON.stringify(payload),
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) {
                let msg = 'OpenAI HTTP ' + res.status;
                try { const e = await res.json(); if (e && e.error && e.error.message) msg = e.error.message; } catch(_) {}
                return { ok: false, error: msg };
            }
            const j = await res.json();
            const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
            return { ok: !!text, text: text.trim(), provider: 'openai' };
        } catch(e) {
            return { ok: false, error: e.name === 'AbortError' ? 'انتهت مهلة OpenAI' : e.message };
        }
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
            if (res.ok || mode === 'ollama' || !hasOpenAI()) return res;
            // auto: Ollama فشل -> ننتقل لـ OpenAI
        } else if (mode === 'ollama') {
            return { ok: false, error: 'Ollama معطّل — فعّله من إعدادات الذكاء' };
        }

        // 2) OpenAI عند الحاجة (وضع openai أو auto مع فشل Ollama)
        if ((mode === 'openai' || mode === 'auto') && hasOpenAI()) {
            return await openaiChat(system, user, opts);
        }

        return { ok: false, error: mode === 'openai' ? 'لا يوجد مفتاح OpenAI API مضبوط' : 'لا مزود LLM متاح: Ollama غير متصل أو المفتاح غير مضبوط' };
    }

    async function generate(prompt, opts) {
        opts = opts || {};
        const mode = getProviderMode();
        if (mode !== 'openai' && isEnabled()) {
            const res = await ollamaGenerate(prompt, opts);
            if (res.ok || mode === 'ollama' || !hasOpenAI()) return res;
        } else if (mode === 'ollama') {
            return { ok: false, error: 'Ollama معطّل — فعّله من إعدادات الذكاء' };
        }
        if ((mode === 'openai' || mode === 'auto') && hasOpenAI()) {
            return await openaiGenerate(prompt, opts);
        }
        return { ok: false, error: 'لا مزود LLM متاح' };
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
            ollamaHost: OLLAMA_HOST,
            ollamaModel: DEFAULT_MODEL,
            ollamaEnabled: isEnabled(),
            openAIKeySet: hasOpenAI(),
            openAIKeyMasked: hasOpenAI() ? '••••' + getOpenAIKey().slice(-4) : '',
            openAIModel: getOpenAIModel(),
            openAIBase: getOpenAIBase()
        };
    }

    async function providerInfo() {
        const mode = getProviderMode();
        const ollamaUp = await isAvailable();
        const lines = [
            '🧠 **إعدادات مزود الذكاء**',
            '· الوضع: ' + (mode === 'auto' ? 'تلقائي (Ollama أولاً ثم OpenAI عند الحاجة)' : (mode === 'ollama' ? 'Ollama محلي فقط (مجاني)' : 'OpenAI سحابي فقط')),
            '· Ollama: ' + (isEnabled() ? 'مفعّل ✓ ' : 'معطّل ✗ ') + (ollamaUp ? '— متصل ✓' : '— غير متصل ✗') + ' (' + OLLAMA_HOST + ')',
            '· نموذج Ollama: ' + DEFAULT_MODEL,
            '· OpenAI: ' + (hasOpenAI() ? 'مضبوط — ' + getOpenAIModel() : 'غير مضبوط')
        ];
        return lines.join('\n') + '\n\n💡 أوامر: "استخدم ollama" / "استخدم openai" / "الوضع التلقائي" / "مفتاح openai: sk-..."';
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
        setOpenAIKey,
        getOpenAIModel,
        setOpenAIModel,
        getOpenAIBase,
        setOpenAIBase,
        getConfig,
        providerInfo,
        // أدوات القراءة (اسأل باتمان وغيرها)
        selectTool,
        summarizeToolResults,
        registerTool,
        registeredTools,
        runTool,
        host: OLLAMA_HOST,
        model: DEFAULT_MODEL
    };
})();