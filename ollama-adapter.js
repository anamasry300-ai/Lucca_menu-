/*
╔══════════════════════════════════════════════════════════════╗
║        LUCCA Ollama Adapter — Local Qwen AI Engine           ║
║   يربط البرنامج بـ Ollama المحلي (qwen2.5-coder:7b)           ║
║   يعمل بدون إنترنت، بدون تكلفة API، وبيتم التطوير عليه        ║
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
    const DEFAULT_MODEL = kGet('luccaOllamaModel') || 'qwen2.5-coder:7b';

    let _available = null; // cached

    // حالة التفعيل (افتراضية مفعّلة)
    function isEnabled() {
        const v = kGet('luccaOllamaEnabled');
        return v === null ? true : (v === '1' || v === 'true');
    }
    function setEnabled(on) {
        kSet('luccaOllamaEnabled', on ? '1' : '0');
    }

    function fmtModel(model) {
        return model || DEFAULT_MODEL;
    }

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

    // قائمة النماذج المثبتة
    async function listModels() {
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

    // توليد نص (non-stream)
    async function generate(prompt, opts = {}) {
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
            return { ok: true, text: (j.response || '').trim() };
        } catch(e) {
            return { ok: false, error: e.name === 'AbortError' ? 'انتهت مهلة Ollama' : e.message };
        }
    }

    // توليد بمساعدة (system prompt + user)
    async function chat(system, user, opts = {}) {
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
            return { ok: true, text: (msg || '').trim() };
        } catch(e) {
            return { ok: false, error: e.name === 'AbortError' ? 'انتهت مهلة Ollama' : e.message };
        }
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

    return {
        isAvailable,
        listModels,
        generate,
        chat,
        extractJSON,
        isEnabled,
        setEnabled,
        host: OLLAMA_HOST,
        model: DEFAULT_MODEL
    };
})();
