/*
╔══════════════════════════════════════════════════════════════╗
║  OCR Adapter — Pluggable OCR/Vision Backend Interface        ║
║  Connect any OCR engine without rebuilding the scan system.  ║
╚══════════════════════════════════════════════════════════════╝
*/
window.OCRAdapter = (function () {
    const STORAGE_KEY = 'luccaOCRProvider';

    const providers = {
        none: {
            name: 'none',
            label: 'غير متاح',
            async extract(imageData) {
                return { ok: false, error: 'لا يوجد محرك OCR مُعدّ. اختر مزودًا من الإعدادات.' };
            }
        },
        ollama_vision: {
            name: 'ollama_vision',
            label: 'Ollama Vision (مستقبل)',
            async extract(imageData) {
                const ollama = window.OllamaAI;
                if (!ollama || !ollama.isAvailable) return { ok: false, error: 'Ollama غير متاح' };
                try {
                    const available = await ollama.isAvailable();
                    if (!available) return { ok: false, error: 'Ollama غير متاح — تأكد من تشغيل الخادم المحلي' };
                    const prompt = [
                        'أنت مستخرج بيانات فواتير. استخرج البيانات التالية من صورة الفاتورة:',
                        'supplierName, invoiceNumber, invoiceDate, items[{name, quantity, unit, unitPrice, discount, tax, total}], paymentMethod, total.',
                        'أعد JSON فقط بدون شرح. إذا كانت المعلومة غير واضحة استخدم null.',
                        'لا تخترع بيانات.',
                    ].join('\n');
                    const res = await ollama.generate(prompt, { model: 'llava', temperature: 0.1 });
                    if (!res.ok) return { ok: false, error: res.error };
                    const parsed = ollama.extractJSON(res.text);
                    if (!parsed) return { ok: false, error: 'لم يتم استخراج بيانات من الفاتورة' };
                    return { ok: true, data: parsed };
                } catch (e) { return { ok: false, error: e.message }; }
            }
        },
        tesseract: {
            name: 'tesseract',
            label: 'Tesseract OCR (محلي)',
            async extract(imageData) {
                if (typeof Tesseract === 'undefined') return { ok: false, error: 'Tesseract.js غير محمل. أضف المكتبة في HTML.' };
                try {
                    const result = await Tesseract.recognize(imageData, 'ara+eng');
                    const text = (result.data && result.data.text) || '';
                    if (!text.trim()) return { ok: false, error: 'لم يتم التعرف على أي نص في الصورة' };
                    return { ok: true, text: text.trim(), raw: true };
                } catch (e) { return { ok: false, error: e.message }; }
            }
        }
    };

    function getProvider() {
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && providers[stored]) return providers[stored];
        }
        return providers.none;
    }

    function setProvider(name) {
        if (!providers[name]) return false;
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, name);
        return true;
    }

    async function extractFromImage(imageData) {
        const provider = getProvider();
        return provider.extract(imageData);
    }

    async function extractFromText(text) {
        return { ok: true, text: text, raw: true };
    }

    return {
        providers: Object.keys(providers).filter(k => k !== 'none').map(k => ({ id: k, label: providers[k].label })),
        getProvider: () => getProvider().name,
        setProvider,
        extractFromImage,
        extractFromText
    };
})();
