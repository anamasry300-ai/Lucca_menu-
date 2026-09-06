/*
╔══════════════════════════════════════════════════════════════╗
║  Invoice Scanner — Pluggable Invoice Data Extraction        ║
║  Handles images via OCRAdapter + text via regex/AI.         ║
║  Does NOT store directly to DB or modify inventory.         ║
╚══════════════════════════════════════════════════════════════╝
*/
window.InvoiceScanner = (function () {

    // ===== Text-based parsing (no image) =====
    function parsePurchaseText(text) {
        if (!text || typeof text !== 'string') return null;
        const t = text.trim();
        if (!t) return null;

        // Try Ollama AI first (for complex multi-line invoices)
        if (window.OllamaAI && window.OllamaAI.isEnabled && window.OllamaAI.isEnabled()) {
            return _parseWithAI(t);
        }
        // Regex fallback (reliable, synchronous)
        return _parseWithRegex(t);
    }

    async function _parseWithAI(text) {
        try {
            const ollama = window.OllamaAI;
            const available = await ollama.isAvailable();
            if (!available) return _parseWithRegex(text);

            const categories = _getCategoryList();
            const systemPrompt = [
                'أنت محلل فواتير مشتريات لمقهى.',
                'استخرج البيانات من النص وأعد JSON فقط.',
                'أعد الكائن بهذا الشكل بالضبط:',
                '{"items":[{"name":"الصنف","quantity":1,"unit":"كيلو","unitPrice":0,"total":0}],"supplier":null,"invoiceNumber":null,"invoiceDate":null,"tax":0,"discount":0,"total":0,"notes":null}',
                'التصنيفات المتاحة: ' + categories.join(', '),
                'اختر التصنيف الأنسب من القائمة.',
                'إذا لم تكن المعلومة واضحة استخدم null.',
                'لا تخترع بيانات. الحساب النهائي يجب أن يكون quantity × unitPrice.',
            ].join('\n');

            const res = await ollama.chat(systemPrompt, text, { temperature: 0.1, timeout: 30000 });
            if (!res.ok) return _parseWithRegex(text);

            const parsed = ollama.extractJSON(res.text);
            if (!parsed || !parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
                return _parseWithRegex(text);
            }

            // Ensure numeric fields and recalculate totals
            for (const item of parsed.items) {
                item.quantity = Number(item.quantity) || 1;
                item.unitPrice = Number(item.unitPrice) || 0;
                if (!item.total || Number(item.total) === 0) {
                    item.total = item.quantity * item.unitPrice;
                }
            }
            parsed.total = Number(parsed.total) || parsed.items.reduce((s, i) => s + (Number(i.total) || 0), 0);
            parsed.tax = Number(parsed.tax) || 0;
            parsed.discount = Number(parsed.discount) || 0;
            parsed.supplier = parsed.supplier || null;
            parsed.invoiceNumber = parsed.invoiceNumber || null;
            parsed.invoiceDate = parsed.invoiceDate || null;

            return { ok: true, data: parsed, source: 'ai' };
        } catch (e) {
            console.error('[InvoiceScanner] AI parse error:', e);
            return _parseWithRegex(text);
        }
    }

    function _parseWithRegex(text) {
        const t = text.trim();
        const result = {
            items: [],
            supplier: null,
            invoiceNumber: null,
            invoiceDate: null,
            tax: 0,
            discount: 0,
            total: 0,
            notes: null
        };

        // Extract supplier: "من شركة X" or "من X"
        const supplierMatch = t.match(/(?:من|supplied?\s+by| אצל)\s+([\u0600-\u06FF\s]{2,30}?)(?:\s+بـ|\s+ب-price|\s+-price|\s*$)/i);
        if (supplierMatch) result.supplier = supplierMatch[1].trim();

        // Extract invoice number: "رقم فاتورة 1458" or "فاتورة #1458"
        const invNumMatch = t.match(/(?:رقم\s*(?:فاتورة| INV)|INV\s*#?|#)\s*(\d+)/i);
        if (invNumMatch) result.invoiceNumber = invNumMatch[1];

        // Extract invoice date: "بتاريخ 31/08/2026" or "تاريخ 31-08-2026"
        const dateMatch = t.match(/(?:بتاريخ|تاريخ|date)\s*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
        if (dateMatch) result.invoiceDate = dateMatch[1];

        // Extract tax: "ضريبة 140" or "tax 140"
        const taxMatch = t.match(/(?:ضريب(?:ة|ات)|tax)\s*(?:[:\s]*)?(\d+(?:[.,]\d+)?)/i);
        if (taxMatch) result.tax = Number(taxMatch[1].replace(',', '.'));

        // Extract discount: "خصم 50" or "discount 50"
        const discMatch = t.match(/(?:خصم|discount)\s*(?:[:\s]*)?(\d+(?:[.,]\d+)?)/i);
        if (discMatch) result.discount = Number(discMatch[1].replace(',', '.'));

        // Extract main amount: "بـ 210" or "بسعر 210" or standalone number
        const amountMatch = t.match(/بـ\s*(\d+(?:[.,]\d+)?)|بسعر\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:جنيه|ج\.م|EGP|ل.س|pound)/i);

        // Extract quantity patterns: "10 كيلو لبن" or "10 × 210"
        const qtyItemMatch = t.match(/(\d+(?:[.,]\d+)?)\s+(?:كيلو|كجم|لتر|لتر|litre|ltr|kg|g|piece|قطعة)\s+(.+?)(?:\s+بـ|\s+بسعر|\s+من|\s*$)/i);
        const qtyXPriceMatch = t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
        const itemQtyPriceMatch = t.match(/(.+?)\s+(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);

        if (itemQtyPriceMatch) {
            // "لبن 10 × 210" → item=لبن, qty=10, price=210
            result.items.push({
                name: _cleanItemName(itemQtyPriceMatch[1]),
                quantity: Number(itemQtyPriceMatch[2]) || 1,
                unit: 'قطعة',
                unitPrice: Number(itemQtyPriceMatch[3].replace(',', '.')) || 0,
                total: (Number(itemQtyPriceMatch[2]) || 1) * (Number(itemQtyPriceMatch[3].replace(',', '.')) || 0),
                discount: 0,
                tax: 0
            });
        } else if (qtyItemMatch) {
            // "10 كيلو لبن" → qty=10, item=لبن, price from amountMatch
            const price = amountMatch ? Number((amountMatch[1] || amountMatch[2] || amountMatch[3] || '0').replace(',', '.')) : 0;
            result.items.push({
                name: _cleanItemName(qtyItemMatch[2]),
                quantity: Number(qtyItemMatch[1]) || 1,
                unit: _detectUnit(qtyItemMatch[0]),
                unitPrice: price > 0 && Number(qtyItemMatch[1]) > 0 ? price / Number(qtyItemMatch[1]) : price,
                total: price || (Number(qtyItemMatch[1]) || 1) * price,
                discount: 0,
                tax: 0
            });
        } else {
            // Simple: "اشتريت لبن بـ210" → item=لبن, qty=1, price=210
            const itemName = t
                .replace(/اشتر(?:يت|ى|ي)|شراء|فاتورة|مشتريات|from|buy|purchase/gi, '')
                .replace(/بـ\s*\d|بسعر\s*\d|\d+\s*(?:جنيه|ج\.م|EGP|ل.س)/gi, '')
                .replace(/من\s+[\u0600-\u06FF\s]+/g, '')
                .replace(/\d+/g, '')
                .replace(/\s+/g, ' ').trim();
            const price = amountMatch ? Number((amountMatch[1] || amountMatch[2] || amountMatch[3] || '0').replace(',', '.')) : 0;
            const cleanedItem = _cleanItemName(itemName);
            // Do NOT invent items: only accept the simple form when a price is present.
            if (cleanedItem && price > 0) {
                result.items.push({
                    name: cleanedItem,
                    quantity: 1,
                    unit: 'قطعة',
                    unitPrice: price,
                    total: price,
                    discount: 0,
                    tax: 0
                });
            }
        }

        // Calculate total from items if not set
        result.total = result.items.reduce((s, i) => s + (Number(i.total) || 0), 0);

        if (result.items.length === 0) return { ok: false, error: 'لم يتم استخراج أي أصناف من النص' };
        return { ok: true, data: result, source: 'regex' };
    }

    function _cleanItemName(name) {
        if (!name) return '';
        return name
            .replace(/^[,\s]+|[,\s]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function _detectUnit(text) {
        if (/كيلو|كجم|kg|kilo/i.test(text)) return 'كيلو';
        if (/لتر|ltr|litre/i.test(text)) return 'لتر';
        if (/قطعة|piece/i.test(text)) return 'قطعة';
        if (/علبة|box/i.test(text)) return 'علبة';
        if (/كرتون/i.test(text)) return 'كرتون';
        return 'قطعة';
    }

    function _getCategoryList() {
        return [
            'خامات', 'مواد غذائية', 'مشروبات', 'مستلزمات تشغيل',
            'كهرباء', 'مياه', 'إيجار', 'صيانة', 'أخرى'
        ];
    }

    // ===== Image-based scanning =====
    async function scanImage(imageData) {
        if (!window.OCRAdapter) return { ok: false, error: 'OCR Adapter غير محمل' };
        const result = await window.OCRAdapter.extractFromImage(imageData);
        if (!result.ok) return result;
        if (result.raw && result.text) {
            return parsePurchaseText(result.text);
        }
        if (result.data) {
            return { ok: true, data: result.data, source: 'ocr' };
        }
        return { ok: false, error: 'لم يتم استخراج بيانات من الصورة' };
    }

    // ===== Public API =====
    return {
        parsePurchaseText,
        scanImage,
        getCategories: _getCategoryList
    };
})();
