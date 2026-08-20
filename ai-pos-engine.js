/*
╔══════════════════════════════════════════════════════════════╗
║              Lucca AI POS Controller Engine                   ║
║         Natural Language → Real POS Actions                   ║
╚══════════════════════════════════════════════════════════════╝
*/

class AIPosEngine {
    constructor() {
        this.context = {
            currentTable: null,
            currentOrderId: null,
            lastAction: null,
            lastIntent: null,
            pendingConfirmation: null,
            conversationHistory: []
        };
        this.pendingAction = null;
    }

    // ===== ENTITY EXTRACTION =====
    extractTableNumber(text) {
        const arabicNums = {'واحد':1,'اثنين':2,'اثنان':2,'-three':3,'ثلاث':3,'ثلاثة':3,'اربع':4,'اربعة':4,'خمس':5,'خمسة':5,'ست':6,'ستة':6,'سبع':7,'سبعة':7,'ثمان':8,'ثمانية':8,'تسع':9,'تسعة':9,'عشر':10,'عشرة':10};
        // Check arabic word numbers
        for (const [word, num] of Object.entries(arabicNums)) {
            if (text.includes('ترابيزة ' + word) || text.includes('طاولة ' + word) || text.includes('table ' + word)) return num;
        }
        // Check digit numbers
        const m = text.match(/(?:ترابيزة|طاولة|table| طاول| ترابيز)\s*(\d+)/i);
        if (m) return parseInt(m[1]);
        // Check standalone number after table context
        const m2 = text.match(/(?:على|من|في|لـ|ل)\s*(\d+)/);
        if (m2 && this.context.currentTable) return parseInt(m2[1]);
        // Check "افتح 7" pattern (number right after open verb)
        const m3 = text.match(/(?:افتح|فتح|open)\s+(\d+)/i);
        if (m3) return parseInt(m3[1]);
        // Check if context table exists and user just says "حط" without table
        if (this.context.currentTable) return this.context.currentTable;
        return null;
    }

    extractItems(text) {
        const items = [];
        // Arabic quantity patterns: "2 قهوة", "قهوة عدد 2", "قهوة × 2", "اتنين قهوة"
        const arabicQty = {'واحد':1,'واحدة':1,'اثنين':2,'اثنان':2,'ثلاث':3,'ثلاثة':3,'اربع':4,'اربعة':4,'خمس':5,'خمسة':5,'ست':6,'ستة':6,'سبع':7,'سبعة':7,'ثمان':8,'ثمانية':8,'تسع':9,'تسعة':9,'عشر':10,'عشرة':10,'اتنين':2,'تنين':2,'كوباية':1,'كوب':1,'حاجة':1};

        // Split by "و" (and) or commas
        const parts = text.split(/\s*و\s*|\s*,\s*|\s*،\s*/);

        for (const part of parts) {
            let qty = 1;
            let name = part.trim();

            // Pattern: "2 قهوة" or "3 مياه"
            const qtyFirst = part.match(/^(\d+)\s+(.+)/);
            if (qtyFirst) { qty = parseInt(qtyFirst[1]); name = qtyFirst[2].trim(); }

            // Pattern: "قهوة 2" or "قهوة عدد 2" or "قهوة × 2"
            const qtyLast = part.match(/(.+?)\s+(?:عدد\s+)?(\d+)\s*$/);
            if (qtyLast && !qtyFirst) { name = qtyLast[1].trim(); qty = parseInt(qtyLast[2]); }

            // Pattern: "اتنين قهوة" or "ثلاث قهوة"
            for (const [word, num] of Object.entries(arabicQty)) {
                if (name.startsWith(word + ' ')) { qty = num; name = name.substring(word.length).trim(); break; }
                if (name.endsWith(' ' + word)) { qty = num; name = name.substring(0, name.length - word.length).trim(); break; }
            }

            // Pattern: "قهوة مرتين"
            if (name.includes('مرة') || name.includes('مرات')) {
                const mTimes = name.match(/(.+?)\s+مر(?:ة|ات)\s+(\d+)?/);
                if (mTimes) { name = mTimes[1].trim(); qty = parseInt(mTimes[2] || 2); }
            }

            // Pattern: "x2" or "×2"
            const xMatch = name.match(/(.+?)\s*[x×]\s*(\d+)/i);
            if (xMatch) { name = xMatch[1].trim(); qty = parseInt(xMatch[2]); }

            // Pattern: "كابتشينو بدون سكر" (with modifier)
            let modifier = '';
            const modMatch = name.match(/(.+?)\s+(بلا|بدون|من غير|سادة|بحليب|بسكر|بدون سكر|with|without)\s*(.*)/i);
            if (modMatch) {
                name = modMatch[1].trim();
                modifier = modMatch[2].trim() + (modMatch[3] ? ' ' + modMatch[3].trim() : '');
            }

            // Clean up common prefixes
            name = name.replace(/^(حط|ضف|أضف|زود|اعمل|جيب| bring |add )\s*/i, '').trim();

            if (name && name.length > 0) {
                items.push({ name, quantity: qty, modifier: modifier || null });
            }
        }
        return items.filter(i => i.name.length > 0);
    }

    extractQuantity(text) {
        const arabicQty = {'واحد':1,'واحدة':1,'اثنين':2,'اثنان':2,'ثلاث':3,'ثلاثة':3,'اربع':4,'اربعة':4,'خمس':5,'خمسة':5,'اتنين':2,'تنين':2};
        for (const [word, num] of Object.entries(arabicQty)) {
            if (text.includes(word)) return num;
        }
        const m = text.match(/(\d+)/);
        if (m) return parseInt(m[1]);
        return 1;
    }

    extractPaymentMethod(text) {
        if (/كاش|نقدي|cash|فلوس/i.test(text)) return 'cash';
        if (/فيزا|كارت|visa|card|بطاقة/i.test(text)) return 'card';
        if (/تحويل|بنك|transfer|oneway/i.test(text)) return 'transfer';
        if (/واتساب|whatsapp/i.test(text)) return 'whatsapp';
        if (/آجل|دين|credit/i.test(text)) return 'credit';
        return null;
    }

    extractOrderType(text) {
        if (/تيك.?أواي|take.?away|TA|携带/i.test(text)) return 'takeaway';
        if (/ديلفري|delivery|توصيل/i.test(text)) return 'delivery';
        if (/استلام|pickup/i.test(text)) return 'pickup';
        return 'dine_in';
    }

    // ===== INTENT DETECTION =====
    detectIntent(text) {
        const t = text.toLowerCase().trim();

        // Table Operations
        if (/(?:افتح|فتح|open|otfrit)\s+(?:ترابيزة|طاولة|table)/i.test(t) || /(?:افتح|فتح)\s+\d+/i.test(t))
            return { intent: 'open_table', needsConfirmation: false };
        if (/(?:اقفل|قفل|close|sakir)\s+(?:ترابيزة|طاولة|table)/i.test(t) || /(?:اقفل|قفل)\s+\d+/i.test(t))
            return { intent: 'close_table', needsConfirmation: true, confirmType: 'payment' };
        if (/(?:انقل|نقل|transfer)\s+(?:ترابيزة|طاولة|table)/i.test(t))
            return { intent: 'transfer_table', needsConfirmation: false };
        if (/(?:ادمج|دمج|merge)/i.test(t))
            return { intent: 'merge_tables', needsConfirmation: false };
        if (/(?:قسم|تقسيم|split)\s+(?:حساب|فاتورة|bill)/i.test(t))
            return { intent: 'split_bill', needsConfirmation: false };

        // Order Operations
        if (/(?:حط|حطيت|ضف|اضف|أضف|add|zid|zawed|zod)\s/.test(t) && !/(?:شيل|احذف|امسح|حذف|remove|delete)/.test(t))
            return { intent: 'add_items', needsConfirmation: false };
        if (/(?:زود|زودت|extra|zid|zawed)\s/.test(t))
            return { intent: 'add_items', needsConfirmation: false };
        if (/(?:شيل|احذف|امسح|حذف|remove|delete|sheel|imsah)\s/.test(t))
            return { intent: 'remove_item', needsConfirmation: true, confirmType: 'delete' };
        if (/(?:خل|خلي|غير|badal|ghayar|change)\s+.+\s+(?:بدل|لـ|الـ|to)\s/.test(t))
            return { intent: 'change_quantity', needsConfirmation: false };
        if (/(?:امسح|شيل)\s+(?:آخر|الأخير|last)/i.test(t))
            return { intent: 'remove_last_item', needsConfirmation: true, confirmType: 'delete' };

        // Payment
        if (/(?:حساب|كم|total|price|cam)\s+(?:ترابيزة|طاولة|table|\d+)/i.test(t) || /(?:كم\s+الحساب|حساب\s+كم)/i.test(t))
            return { intent: 'get_total', needsConfirmation: false };
        if (/(?:ادفع|ادفع|دفع|pay|saddle)/.test(t) || /(?:اقفل.*كاش|اقفل.*فيزا|close.*cash|close.*card)/i.test(t))
            return { intent: 'process_payment', needsConfirmation: true, confirmType: 'payment' };
        if (/(?:تقسيم|split payment|ادفع.*و.*الباقي)/i.test(t))
            return { intent: 'split_payment', needsConfirmation: true, confirmType: 'payment' };

        // Status
        if (/(?:جاهز|ready| served|تقدم)/i.test(t))
            return { intent: 'set_ready', needsConfirmation: false };
        if (/(?:ابعت.*المطبخ|send.*kitchen|print.*order)/i.test(t))
            return { intent: 'send_to_kitchen', needsConfirmation: false };
        if (/(?:اطبع|print|طباعة)/i.test(t))
            return { intent: 'print_receipt', needsConfirmation: false };

        // Order Type
        if (/(?:تيك.?أواي|take.?away|TA)/i.test(t))
            return { intent: 'create_takeaway', needsConfirmation: false };
        if (/(?:ديلفري|delivery|توصيل)/i.test(t))
            return { intent: 'create_delivery', needsConfirmation: false };

        // Notes
        if (/(?:ملاحظة|note|اكتب|not)/.test(t))
            return { intent: 'add_note', needsConfirmation: false };

        // Query
        if (/(?:مين|أي|اي).*طلبات.*(مفتوحة|.open)/i.test(t))
            return { intent: 'get_open_orders', needsConfirmation: false };
        if (/(?: حالة|status)/i.test(t))
            return { intent: 'get_status', needsConfirmation: false };

        // Customer
        if (/(?:عميل|customer|client)/.test(t))
            return { intent: 'customer_operation', needsConfirmation: false };

        return { intent: 'unknown', needsConfirmation: false };
    }

    // ===== TOOL EXECUTION =====
    async executeTool(toolName, params) {
        const tools = {
            open_table: () => this.toolOpenTable(params),
            close_table: () => this.toolCloseTable(params),
            add_items: () => this.toolAddItems(params),
            remove_item: () => this.toolRemoveItem(params),
            remove_last_item: () => this.toolRemoveLastItem(params),
            change_quantity: () => this.toolChangeQuantity(params),
            get_total: () => this.toolGetTotal(params),
            process_payment: () => this.toolProcessPayment(params),
            split_payment: () => this.toolSplitPayment(params),
            split_bill: () => this.toolSplitBill(params),
            transfer_table: () => this.toolTransferTable(params),
            merge_tables: () => this.toolMergeTables(params),
            set_ready: () => this.toolSetReady(params),
            send_to_kitchen: () => this.toolSendToKitchen(params),
            print_receipt: () => this.toolPrintReceipt(params),
            create_takeaway: () => this.toolCreateTakeaway(params),
            create_delivery: () => this.toolCreateDelivery(params),
            add_note: () => this.toolAddNote(params),
            get_open_orders: () => this.toolGetOpenOrders(params),
            get_status: () => this.toolGetStatus(params),
            customer_operation: () => this.toolCustomerOp(params)
        };

        if (tools[toolName]) {
            return await tools[toolName]();
        }
        return { success: false, message: '❌ أمر غير معروف: ' + toolName };
    }

    // ===== PRODUCT SEARCH =====
    async searchProduct(query) {
        try {
            const products = await window.LuccaDB.Products.getActive();
            const q = query.toLowerCase().trim();

            // Exact match
            let matches = products.filter(p => {
                const name = (p.nameAr || p.name || '').toLowerCase();
                const nameEn = (p.nameEn || '').toLowerCase();
                return name === q || nameEn === q;
            });

            // Partial match
            if (matches.length === 0) {
                matches = products.filter(p => {
                    const name = (p.nameAr || p.name || '').toLowerCase();
                    const nameEn = (p.nameEn || '').toLowerCase();
                    return name.includes(q) || nameEn.includes(q) || q.includes(name);
                });
            }

            // Fuzzy: check if query words appear in product name
            if (matches.length === 0) {
                const words = q.split(/\s+/);
                matches = products.filter(p => {
                    const name = (p.nameAr || p.name || '').toLowerCase() + ' ' + (p.nameEn || '').toLowerCase();
                    return words.every(w => name.includes(w));
                });
            }

            // Fuzzy: transliteration matching (common Arabic-English mappings)
            if (matches.length === 0) {
                const translit = this.getTransliterations(q);
                matches = products.filter(p => {
                    const name = ((p.nameAr || '') + ' ' + (p.nameEn || '')).toLowerCase();
                    return translit.some(t => name.includes(t));
                });
            }

            return matches;
        } catch (e) {
            return [];
        }
    }

    getTransliterations(query) {
        const map = {
            'قهوة': ['coffee', 'qahwa', 'espresso', 'americano'],
            'لاتيه': ['latte', 'latte'],
            'كابتشينو': ['cappuccino', 'cappuccino'],
            'إسبريسو': ['espresso', 'expresso'],
            'سبانيش': ['spanish', 'spanish latte'],
            ' americano': ['americano'],
            'موكا': ['mocha'],
            'ميالتي': ['flat white', 'flatwhite'],
            'ميتي': ['milk', 'حليب'],
            'مياه': ['water', 'مياه', 'ماء'],
            'شاي': ['tea', 'شاي'],
            'عصير': ['juice', 'fresh'],
            'سحلب': ['sahlab'],
            'كراميل': ['caramel'],
            'فانيلا': ['vanilla'],
            'شوكولاتة': ['chocolate', 'mocha'],
            'آيس كريم': ['ice cream', 'icecream']
        };
        const results = [];
        for (const [ar, ens] of Object.entries(map)) {
            if (query.includes(ar) || ens.some(e => query.includes(e))) {
                results.push(ar, ...ens);
            }
        }
        return results.length > 0 ? results : [query];
    }

    // ===== TOOL IMPLEMENTATIONS =====

    async toolOpenTable(params) {
        const tableNum = params.tableNumber;
        if (!tableNum) return { success: false, message: '❌حدد رقم الطاولة' };

        try {
            const tables = await window.LuccaDB.Tables.getAll();
            let table = tables.find(t => String(t.number) === String(tableNum) || String(t.id) === String(tableNum));

            if (!table) {
                // Create table if not exists
                const newTable = { number: tableNum, capacity: 4, status: 'available' };
                const id = await window.LuccaDB.Tables.add(newTable);
                table = { ...newTable, id };
            }

            // Check if table already has open order
            const orders = await window.LuccaDB.Orders.getAll();
            const openOrder = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending' || o.paymentStatus !== 'paid'));

            if (openOrder) {
                this.context.currentTable = tableNum;
                this.context.currentOrderId = openOrder.id;
                return {
                    success: true,
                    message: '🔄 الطاولة ' + tableNum + ' فيها طلب مفتوح بالفعل (#' + (openOrder.orderNumber || openOrder.id) + ')\nالإجمالي: ' + (openOrder.total || 0) + ' ل.س',
                    table: tableNum,
                    orderId: openOrder.id,
                    alreadyOpen: true
                };
            }

            // Create new order
            const orderNumber = 'ORD-' + Date.now();
            const newOrder = {
                orderNumber,
                tableId: String(tableNum),
                orderType: params.orderType || 'dine_in',
                status: 'open',
                paymentStatus: 'unpaid',
                items: [],
                subtotal: 0,
                total: 0,
                totalAmount: 0,
                discount: 0,
                customerName: '',
                customerPhone: '',
                notes: '',
                createdAt: new Date().toISOString(),
                date: new Date().toISOString()
            };

            const orderId = await window.LuccaDB.Orders.add(newOrder);

            // Update table status
            await window.LuccaDB.Tables.update(table.id || tableNum, { status: 'occupied' });

            this.context.currentTable = tableNum;
            this.context.currentOrderId = orderId;

            // Log to audit
            await this.logAudit('open_table', { table: tableNum, orderId, orderNumber });

            return {
                success: true,
                message: '✅ تم فتح الطاولة ' + tableNum + '\nرقم الطلب: ' + orderNumber + '\nالنوع: ' + (params.orderType === 'takeaway' ? 'تيك أواي' : params.orderType === 'delivery' ? 'ديلفري' : 'صالة'),
                table: tableNum,
                orderId,
                orderNumber
            };
        } catch (e) {
            return { success: false, message: '❌ خطأ في فتح الطاولة: ' + e.message };
        }
    }

    async toolAddItems(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        const items = params.items || [];

        if (!tableNum) return { success: false, message: '❌ حدد رقم الطاولة. مثال: "حط قهوة على ترابيزة 7"' };
        if (items.length === 0) return { success: false, message: '❌ حدد المنتجات المطلوبة. مثال: "حط 2 قهوة ومياه"' };

        try {
            // Find or create order for this table
            let orderId = this.context.currentOrderId;
            let order = null;

            if (orderId) {
                order = await window.LuccaDB.Orders.get(orderId);
            }

            if (!order) {
                const orders = await window.LuccaDB.Orders.getAll();
                order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending') && o.paymentStatus !== 'paid');
                if (order) {
                    orderId = order.id;
                    this.context.currentOrderId = orderId;
                }
            }

            if (!order) {
                // Open table first
                const openResult = await this.toolOpenTable({ tableNumber: tableNum, orderType: params.orderType });
                if (!openResult.success) return openResult;
                orderId = openResult.orderId;
                order = await window.LuccaDB.Orders.get(orderId);
            }

            // Search and add each item
            const addedItems = [];
            const notFound = [];

            for (const item of items) {
                const products = await this.searchProduct(item.name);
                if (products.length === 0) {
                    notFound.push(item.name);
                } else if (products.length === 1) {
                    const p = products[0];
                    const unitPrice = Number(p.price) || 0;
                    addedItems.push({
                        productId: p.id,
                        name: p.nameAr || p.name,
                        nameEn: p.nameEn || '',
                        quantity: item.quantity,
                        unitPrice,
                        total: unitPrice * item.quantity,
                        modifier: item.modifier || null
                    });
                } else {
                    // Multiple matches - return options
                    return {
                        success: false,
                        needsClarification: true,
                        message: '🔍 وجدت ' + products.length + ' منتجات تطابق "' + item.name + '":',
                        options: products.slice(0, 5).map((p, i) => ({
                            index: i + 1,
                            name: p.nameAr || p.name,
                            price: p.price,
                            id: p.id
                        })),
                        pendingItem: item
                    };
                }
            }

            if (notFound.length > 0) {
                return { success: false, message: '❌ ما لقيت: ' + notFound.join('، ') + '\nجرّب تكتب الاسم بالعربي أو الإنجليزي' };
            }

            // Merge with existing items
            let currentItems = Array.isArray(order.items) ? [...order.items] : [];

            for (const newItem of addedItems) {
                const existingIdx = currentItems.findIndex(i =>
                    i.productId === newItem.productId && !i.modifier && !newItem.modifier
                );
                if (existingIdx >= 0) {
                    currentItems[existingIdx].quantity += newItem.quantity;
                    currentItems[existingIdx].total = currentItems[existingIdx].quantity * currentItems[existingIdx].unitPrice;
                } else {
                    currentItems.push(newItem);
                }
            }

            // Calculate totals
            const subtotal = currentItems.reduce((sum, i) => sum + (i.total || 0), 0);

            // Update order
            await window.LuccaDB.Orders.update(orderId, {
                items: currentItems,
                subtotal,
                total: subtotal - (order.discount || 0),
                totalAmount: subtotal - (order.discount || 0),
                updatedAt: new Date().toISOString()
            });

            this.context.lastAction = 'add_items';
            await this.logAudit('add_items', { table: tableNum, orderId, items: addedItems.map(i => i.name + ' ×' + i.quantity) });

            // Build response
            let msg = '✅ تم الإضافة على الطاولة ' + tableNum + ':\n';
            addedItems.forEach(i => {
                msg += '  • ' + i.name + ' ×' + i.quantity + ' = ' + i.total + ' ل.س\n';
            });
            msg += '\n📊 الإجمالي: ' + subtotal + ' ل.س';
            if (order.discount > 0) msg += '\n🔖 الخصم: ' + order.discount + ' ل.س';
            msg += '\n💰 الصافي: ' + (subtotal - (order.discount || 0)) + ' ل.س';

            return {
                success: true,
                message: msg,
                table: tableNum,
                orderId,
                items: addedItems,
                subtotal,
                total: subtotal - (order.discount || 0)
            };
        } catch (e) {
            return { success: false, message: '❌ خطأ في الإضافة: ' + e.message };
        }
    }

    async toolRemoveItem(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        const itemName = params.itemName;

        if (!tableNum) return { success: false, message: '❌ حدد الطاولة' };
        if (!itemName) return { success: false, message: '❌ حدد الصنف المراد حذفه' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending') && o.paymentStatus !== 'paid');
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            let items = Array.isArray(order.items) ? [...order.items] : [];
            const matches = items.filter(i => (i.name || '').toLowerCase().includes(itemName.toLowerCase()));

            if (matches.length === 0) return { success: false, message: '❌ الصنف "' + itemName + '" غير موجود في الطلب' };
            if (matches.length > 1 && !params.all) {
                return {
                    success: false,
                    needsConfirmation: true,
                    message: '🔍 في ' + matches.length + ' أصناف تطابق "' + itemName + '"\nكم تريد تحذف؟',
                    options: matches.map((m, i) => ({ index: i + 1, name: m.name, qty: m.quantity, total: m.total }))
                };
            }

            // Remove
            const matchIdx = items.findIndex(i => (i.name || '').toLowerCase().includes(itemName.toLowerCase()));
            const removed = items.splice(matchIdx, 1)[0];

            const subtotal = items.reduce((sum, i) => sum + (i.total || 0), 0);
            await window.LuccaDB.Orders.update(order.id, {
                items,
                subtotal,
                total: subtotal - (order.discount || 0),
                totalAmount: subtotal - (order.discount || 0),
                updatedAt: new Date().toISOString()
            });

            await this.logAudit('remove_item', { table: tableNum, orderId: order.id, item: removed.name });

            return {
                success: true,
                message: '✅ تم حذف ' + removed.name + ' من الطاولة ' + tableNum + '\n📊 الإجمالي الجديد: ' + subtotal + ' ل.س',
                table: tableNum,
                removedItem: removed
            };
        } catch (e) {
            return { success: false, message: '❌ خطأ في الحذف: ' + e.message };
        }
    }

    async toolRemoveLastItem(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            let items = Array.isArray(order.items) ? [...order.items] : [];
            if (items.length === 0) return { success: false, message: '❌ الطلب فاضي' };

            const removed = items.pop();
            const subtotal = items.reduce((sum, i) => sum + (i.total || 0), 0);

            await window.LuccaDB.Orders.update(order.id, {
                items, subtotal, total: subtotal - (order.discount || 0),
                totalAmount: subtotal - (order.discount || 0),
                updatedAt: new Date().toISOString()
            });

            return { success: true, message: '✅ تم حذف آخر صنف: ' + removed.name + '\n📊 الإجمالي: ' + subtotal + ' ل.س' };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolChangeQuantity(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        const itemName = params.itemName;
        const newQty = params.newQuantity;

        if (!tableNum || !itemName || !newQty) return { success: false, message: '❌ حدد الصنف والكمية الجديدة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            let items = Array.isArray(order.items) ? [...order.items] : [];
            const idx = items.findIndex(i => (i.name || '').toLowerCase().includes(itemName.toLowerCase()));
            if (idx < 0) return { success: false, message: '❌ "' + itemName + '" غير موجود في الطلب' };

            const oldQty = items[idx].quantity;
            items[idx].quantity = newQty;
            items[idx].total = newQty * items[idx].unitPrice;

            const subtotal = items.reduce((sum, i) => sum + (i.total || 0), 0);
            await window.LuccaDB.Orders.update(order.id, {
                items, subtotal, total: subtotal - (order.discount || 0),
                totalAmount: subtotal - (order.discount || 0),
                updatedAt: new Date().toISOString()
            });

            const diff = newQty - oldQty;
            return {
                success: true,
                message: '✅ تم تعديل ' + items[idx].name + ':\n  الكمية: ' + oldQty + ' → ' + newQty + (diff > 0 ? ' (+' + diff + ')' : ' (' + diff + ')') + '\n📊 الإجمالي: ' + subtotal + ' ل.س'
            };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolGetTotal(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        if (!tableNum) return { success: false, message: '❌ حدد رقم الطاولة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            const items = Array.isArray(order.items) ? order.items : [];
            let msg = '🧾 **حساب الطاولة ' + tableNum + '**\n\n';
            items.forEach(i => {
                msg += '  • ' + i.name + ' ×' + i.quantity + ' = ' + (i.total || 0) + ' ل.س\n';
            });
            msg += '\n━━━━━━━━━━━━━━━';
            msg += '\n  الإجمالي: ' + (order.subtotal || 0) + ' ل.س';
            if (order.discount > 0) msg += '\n  الخصم: -' + order.discount + ' ل.س';
            msg += '\n  💰 الصافي: ' + (order.total || order.totalAmount || 0) + ' ل.س';

            return { success: true, message: msg, table: tableNum, total: order.total || order.totalAmount || 0 };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolProcessPayment(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        const method = params.paymentMethod || 'cash';
        const amount = params.amount;

        if (!tableNum) return { success: false, message: '❌ حدد رقم الطاولة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending') && o.paymentStatus !== 'paid');
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            const total = order.total || order.totalAmount || 0;
            const payAmount = amount || total;

            // Record payment
            await window.LuccaDB.Orders.update(order.id, {
                status: 'paid',
                paymentStatus: 'paid',
                paymentMethod: method,
                totalPaid: payAmount,
                changeAmount: Math.max(0, payAmount - total),
                paidAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            // Release table
            const tables = await window.LuccaDB.Tables.getAll();
            const table = tables.find(t => String(t.number) === String(tableNum) || String(t.id) === String(tableNum));
            if (table) {
                await window.LuccaDB.Tables.update(table.id || tableNum, { status: 'available' });
            }

            this.context.currentTable = null;
            this.context.currentOrderId = null;

            await this.logAudit('process_payment', { table: tableNum, orderId: order.id, method, amount: payAmount, total });

            let msg = '✅ **تم الدفع بنجاح!**\n\n';
            msg += '  الطاولة: ' + tableNum + '\n';
            msg += '  المبلغ: ' + total + ' ل.س\n';
            msg += '  طريقة الدفع: ' + ({ cash: 'كاش', card: 'فيزا', transfer: 'تحويل', whatsapp: 'واتساب', credit: 'آجل' }[method] || method) + '\n';
            if (payAmount > total) msg += '  المدفوع: ' + payAmount + ' ل.س\n  الفرق: ' + (payAmount - total) + ' ل.س\n';
            msg += '\n🎉 تم إغلاق الطلب!';

            return { success: true, message: msg, table: tableNum, orderId: order.id, total, method };
        } catch (e) {
            return { success: false, message: '❌ خطأ في الدفع: ' + e.message };
        }
    }

    async toolSplitPayment(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        if (!tableNum) return { success: false, message: '❌ حدد رقم الطاولة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            const total = order.total || order.totalAmount || 0;
            return {
                success: true,
                message: '💸 **تقسيم الحساب - الطاولة ' + tableNum + '**\n\nالإجمالي: ' + total + ' ل.س\n\nاكتب المبلغ لكل طريقة دفع:\nمثال: "ادفع 200 كاش والباقي فيزا"',
                needsInput: true,
                awaitingSplitDetails: true
            };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolSplitBill(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        if (!tableNum) return { success: false, message: '❌ حدد رقم الطاولة' };

        const parts = params.parts || 2;
        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            const total = order.total || order.totalAmount || 0;
            const perPerson = Math.round(total / parts);

            let msg = '💸 **تقسيم الحساب على ' + parts + ' أشخاص:**\n\n';
            msg += '  الإجمالي: ' + total + ' ل.س\n';
            msg += '  لكل شخص: ' + perPerson + ' ل.س\n\n';
            msg += '⚠️ للدفع الفعلي، استخدم: "ادفع X كاش والباقي فيزا"';

            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolTransferTable(params) {
        const from = params.tableNumber || this.context.currentTable;
        const to = params.targetTable;
        if (!from || !to) return { success: false, message: '❌ حدد الطاولتين. مثال: "انقل طلب 7 لـ 10"' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(from) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب على الطاولة ' + from };

            await window.LuccaDB.Orders.update(order.id, { tableId: String(to), updatedAt: new Date().toISOString() });

            const tables = await window.LuccaDB.Tables.getAll();
            const fromTable = tables.find(t => String(t.number) === String(from));
            const toTable = tables.find(t => String(t.number) === String(to));

            if (fromTable) await window.LuccaDB.Tables.update(fromTable.id || from, { status: 'available' });
            if (toTable) await window.LuccaDB.Tables.update(toTable.id || to, { status: 'occupied' });
            else await window.LuccaDB.Tables.add({ number: to, capacity: 4, status: 'occupied' });

            await this.logAudit('transfer_table', { from, to, orderId: order.id });

            this.context.currentTable = to;

            return { success: true, message: '✅ تم نقل الطلب من الطاولة ' + from + ' إلى الطاولة ' + to };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolMergeTables(params) {
        const table1 = params.tableNumber || this.context.currentTable;
        const table2 = params.targetTable;
        if (!table1 || !table2) return { success: false, message: '❌ حدد الطاولتين المراد دمجهم' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order1 = orders.find(o => String(o.tableId) === String(table1) && (o.status === 'open' || o.status === 'pending'));
            const order2 = orders.find(o => String(o.tableId) === String(table2) && (o.status === 'open' || o.status === 'pending'));

            if (!order1 && !order2) return { success: false, message: '❌ ما في طلبات مفتوحة على الطاولتين' };
            if (!order1) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + table1 };
            if (!order2) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + table2 };

            // Merge order2 items into order1
            let items1 = Array.isArray(order1.items) ? [...order1.items] : [];
            let items2 = Array.isArray(order2.items) ? [...order2.items] : [];

            items1 = items1.concat(items2);
            const subtotal = items1.reduce((sum, i) => sum + (i.total || 0), 0);

            await window.LuccaDB.Orders.update(order1.id, {
                items: items1, subtotal,
                total: subtotal - (order1.discount || 0),
                totalAmount: subtotal - (order1.discount || 0),
                updatedAt: new Date().toISOString()
            });

            // Cancel order2
            await window.LuccaDB.Orders.update(order2.id, { status: 'cancelled', updatedAt: new Date().toISOString() });

            // Release table2
            const tables = await window.LuccaDB.Tables.getAll();
            const t2 = tables.find(t => String(t.number) === String(table2));
            if (t2) await window.LuccaDB.Tables.update(t2.id || table2, { status: 'available' });

            this.context.currentTable = table1;
            this.context.currentOrderId = order1.id;

            await this.logAudit('merge_tables', { table1, table2, orderId: order1.id });

            return { success: true, message: '✅ تم دمج طاولتي ' + table1 + ' و ' + table2 + '\n📊 الإجمالي: ' + subtotal + ' ل.س\nالطلب الآن على الطاولة ' + table1 };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolSetReady(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        if (!tableNum) return { success: false, message: '❌ حدد الطاولة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب على الطاولة ' + tableNum };

            await window.LuccaDB.Orders.update(order.id, { status: 'preparing', updatedAt: new Date().toISOString() });
            return { success: true, message: '✅ تم تحديث حالة الطلب ' + (order.orderNumber || order.id) + ' إلى "جاهز"' };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolSendToKitchen(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        if (!tableNum) return { success: false, message: '❌ حدد الطاولة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب على الطاولة ' + tableNum };

            await window.LuccaDB.Orders.update(order.id, { status: 'preparing', updatedAt: new Date().toISOString() });

            // Try to print if printer available
            try {
                if (window.PrinterManager && window.PrinterManager.connected) {
                    await window.PrinterManager.printOrder(order);
                }
            } catch(e) {}

            return { success: true, message: '👨‍🍳 تم إرسال طلب الطاولة ' + tableNum + ' للمطبخ\nرقم الطلب: ' + (order.orderNumber || order.id) };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolPrintReceipt(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        return { success: true, message: '🖨️ جاري طباعة فاتورة الطاولة ' + (tableNum || '') + '...\n(الطباعة متاحة عند توصيل الطابعة)' };
    }

    async toolCreateTakeaway(params) {
        params.orderType = 'takeaway';
        return await this.toolOpenTable(params);
    }

    async toolCreateDelivery(params) {
        params.orderType = 'delivery';
        return await this.toolOpenTable(params);
    }

    async toolAddNote(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        const note = params.note;
        if (!tableNum || !note) return { success: false, message: '❌ حدد الطاولة والملاحظة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending'));
            if (!order) return { success: false, message: '❌ ما في طلب على الطاولة ' + tableNum };

            const existingNotes = order.notes || '';
            await window.LuccaDB.Orders.update(order.id, {
                notes: existingNotes ? existingNotes + '\n' + note : note,
                updatedAt: new Date().toISOString()
            });

            return { success: true, message: '📝 تم إضافة ملاحظة على الطاولة ' + tableNum + ':\n"' + note + '"' };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolGetOpenOrders(params) {
        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const open = orders.filter(o => (o.status === 'open' || o.status === 'pending' || o.status === 'preparing') && o.paymentStatus !== 'paid');

            if (open.length === 0) return { success: true, message: '✅ ما في طلبات مفتوحة حالياً!' };

            let msg = '📋 **الطلبات المفتوحة (' + open.length + '):**\n\n';
            open.forEach(o => {
                const items = Array.isArray(o.items) ? o.items : [];
                msg += '🪑 طاولة ' + (o.tableId || '—') + ' | #' + (o.orderNumber || o.id) + '\n';
                msg += '  ' + items.length + ' أصناف | ' + (o.total || 0) + ' ل.س | ' + (o.status || 'open') + '\n\n';
            });

            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolGetStatus(params) {
        try {
            const tables = await window.LuccaDB.Tables.getAll();
            const orders = await window.LuccaDB.Orders.getAll();
            const open = orders.filter(o => (o.status === 'open' || o.status === 'pending') && o.paymentStatus !== 'paid');

            let msg = '📊 **حالة النظام:**\n\n';
            msg += '🪑 الطاولات: ' + tables.length + ' (' + tables.filter(t => t.status === 'available').length + ' فارغة، ' + tables.filter(t => t.status === 'occupied').length + ' مشغولة)\n';
            msg += '📋 الطلبات المفتوحة: ' + open.length + '\n';

            if (this.context.currentTable) {
                msg += '\n🎯 أنت الآن على: الطاولة ' + this.context.currentTable;
            }

            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolCustomerOp(params) {
        return { success: true, message: '👤 **إدارة العملاء:**\n\n• "عمل طلب للعميل [الاسم]"\n• "هات طلبات العميل [الاسم]"\n\n(إدارة العملاء متاحة من لوحة التحكم)' };
    }

    // ===== AUDIT LOGGING =====
    async logAudit(action, details) {
        try {
            await window.LuccaDB.AuditLogs.add({
                userId: 'ai_assistant',
                action: 'AI_' + action,
                details: JSON.stringify(details),
                timestamp: new Date().toISOString()
            });
        } catch (e) { /* audit log is non-critical */ }
    }

    // ===== MAIN PROCESSOR =====
    async process(userInput) {
        // Check for pending confirmation
        if (this.pendingConfirmation && this.pendingAction) {
            if (/^(نعم|yes|ok|تمام|أكيد|affirmative|confirm)/i.test(userInput.trim())) {
                const action = this.pendingAction;
                this.pendingConfirmation = null;
                this.pendingAction = null;
                return await this.executeTool(action.intent, action.params);
            } else if (/^(لا|cancel|إلغاء|no|تمام|blank)/i.test(userInput.trim())) {
                this.pendingConfirmation = null;
                this.pendingAction = null;
                return { success: true, message: '✅ تم الإلغاء.' };
            }
        }

        // ===== MULTI-COMMAND SUPPORT =====
        // Split compound commands: "افتح 7 و حط قهوة" -> ["افتح 7", "حط قهوة"]
        const splitResult = this.splitCompoundCommand(userInput);
        if (splitResult.length > 1) {
            return await this.executeMultiCommands(splitResult);
        }

        // Single command - detect and execute
        return await this.executeSingleCommand(userInput);
    }

    splitCompoundCommand(text) {
        // Split by "و" when it connects two actions (not inside product names)
        // Also split by "بعدين", "ثم", "،"
        let parts = text.split(/\s+(?:وبعد\s+دي?ن?|ثم|،|;\s*)/i).map(s => s.trim()).filter(Boolean);
        
        // Further split by "و" between verbs
        const verbPattern = '(?:افتح|فتح|اقفل|قفل|حط|حطيت|ضف|اضف|أضف|زود|شيل|احذف|امسح|ادفع|دفع|حساب|انقل|ادمج|قسم|اطبع|ابعت|خلي|غير)';
        const refined = [];
        for (const part of parts) {
            const subParts = part.split(new RegExp('\\s+و\\s+(?:' + verbPattern.replace(/[()]/g, '') + ')\\s', 'i'));
            if (subParts.length > 1) {
                refined.push(...subParts.map(s => s.trim()).filter(Boolean));
            } else {
                refined.push(part);
            }
        }
        return refined.length > 1 ? refined : [text];
    }

    async executeMultiCommands(parts) {
        const results = [];
        let sharedTable = this.context.currentTable;

        for (const part of parts) {
            // If this sub-part mentions a table, extract it
            const tNum = this.extractTableNumber(part);
            if (tNum) sharedTable = tNum;

            // Inject shared table number if not mentioned
            let enhancedText = part;
            if (!tNum && sharedTable && /(حط|ضف|اضف|احذف|شيل|حساب|ادفع|الطلب)/.test(part)) {
                enhancedText = part + ' على ترابيزة ' + sharedTable;
            }

            const result = await this.executeSingleCommand(enhancedText);
            results.push({ command: part, result });

            if (!result.success) {
                return {
                    success: false,
                    message: '❌ فشل في "' + part + '": ' + result.message,
                    results
                };
            }
        }

        if (results.length === 1) return results[0].result;

        // Build combined success message
        let msg = '✅ **تم تنفيذ ' + results.length + ' أوامر:**\n\n';
        results.forEach((r, i) => {
            msg += (i + 1) + '. ' + r.result.message.split('\n')[0] + '\n';
        });
        if (sharedTable) msg += '\n📋 الطاولة: ' + sharedTable;

        return { success: true, message: msg, table: sharedTable, results };
    }

    async executeSingleCommand(userInput) {
        // Detect intent
        const { intent, needsConfirmation, confirmType } = this.detectIntent(userInput);

        // Extract entities
        const tableNumber = this.extractTableNumber(userInput);
        const paymentMethod = this.extractPaymentMethod(userInput);
        const orderType = this.extractOrderType(userInput);

        // Build params based on intent
        let params = { tableNumber, paymentMethod, orderType };

        if (intent === 'add_items' || intent === 'create_takeaway' || intent === 'create_delivery') {
            params.items = this.extractItems(userInput);
            if (intent === 'create_takeaway') params.orderType = 'takeaway';
            if (intent === 'create_delivery') params.orderType = 'delivery';
        }

        if (intent === 'remove_item') {
            const cleanText = userInput.replace(/(?:شيل|احذف|امسح|حذف|remove|delete|sheel|imsah)\s*/i, '');
            params.itemName = cleanText.replace(/(?:من|على|-from)\s*(?:ترابيزة|طاولة|table)?\s*\d*/gi, '').trim();
            params.all = /كل|all|الكل|three|ثلاث/i.test(userInput);
        }

        if (intent === 'remove_last_item') {
            params.itemName = 'last';
        }

        if (intent === 'change_quantity') {
            const match = userInput.match(/(?:خل|خلي|غير)\s+(.+?)\s+(?:بدل|لـ|to)\s+(\d+)/i);
            if (match) {
                params.itemName = match[1].trim();
                params.newQuantity = parseInt(match[2]);
            }
        }

        if (intent === 'process_payment') {
            params.amount = this.extractQuantity(userInput);
            const amountMatch = userInput.match(/(\d+)\s*(?:ل.س|ل س|ر.س|EGP)/);
            if (amountMatch) params.amount = parseInt(amountMatch[1]);
        }

        if (intent === 'split_bill') {
            params.parts = this.extractQuantity(userInput) || 2;
        }

        if (intent === 'transfer_table') {
            const match = userInput.match(/(?:من|from)\s*(\d+)\s*(?:لـ|to|الـ)\s*(\d+)/);
            if (match) { params.tableNumber = parseInt(match[1]); params.targetTable = parseInt(match[2]); }
            else {
                const match2 = userInput.match(/(\d+)\s*(?:لـ|to)\s*(\d+)/);
                if (match2) { params.tableNumber = parseInt(match2[1]); params.targetTable = parseInt(match2[2]); }
            }
        }

        if (intent === 'merge_tables') {
            const match = userInput.match(/(\d+)\s*(?:مع|with)\s*(\d+)/);
            if (match) { params.tableNumber = parseInt(match[1]); params.targetTable = parseInt(match[2]); }
        }

        if (intent === 'add_note') {
            const match = userInput.match(/(?:ملاحظة|note|اكتب)\s*:?\s*(.+)/i);
            if (match) params.note = match[1].trim();
            else params.note = userInput.replace(/(?:حط|ضف|أضف)\s+ملاحظة\s*/i, '').trim();
        }

        // Check confirmation requirement
        if (needsConfirmation) {
            this.pendingConfirmation = true;
            this.pendingAction = { intent, params };
            const confirmMessages = {
                payment: '💰 تأكد الدفع على الطاولة ' + (tableNumber || this.context.currentTable || '?') + '?\n\nاكتب "نعم" للتأكيد أو "لا" للإلغاء',
                delete: '⚠️ تأكد الحذف؟\n\nاكتب "نعم" للتأكيد أو "لا" للإلغاء'
            };
            return { success: true, message: confirmMessages[confirmType] || '⚠️ تأكد العملية؟\n\nاكتب "نعم" أو "لا"', needsConfirmation: true };
        }

        // Execute
        return await this.executeTool(intent, params);
    }
}

// Global instance
window.aiPosEngine = new AIPosEngine();
