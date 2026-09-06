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
        this.pendingPurchaseDraft = null;
    }

    // ===== ENTITY EXTRACTION =====
    extractTableNumber(text) {
        const arabicNums = {'واحد':1,'اثنين':2,'اثنان':2,'ثلاث':3,'ثلاثة':3,'اربع':4,'اربعة':4,'خمس':5,'خمسة':5,'ست':6,'ستة':6,'سبع':7,'سبعة':7,'ثمان':8,'ثمانية':8,'تسع':9,'تسعة':9,'عشر':10,'عشرة':10};
        // Check arabic word numbers
        for (const [word, num] of Object.entries(arabicNums)) {
            if (text.includes('ترابيزة ' + word) || text.includes('طاولة ' + word) || text.includes('table ' + word)) return num;
        }
        // Check digit numbers
        const m = text.match(/(?:ترابيزة|طاولة|table| طاول| ترابيز)\s*(\d+)/i);
        if (m) return parseInt(m[1]);
        // Check standalone number after table context
        const m2 = text.match(/(?:على|من|في|لـ|ل)\s*(\d+)/);
        if (m2) return parseInt(m2[1]);
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

            // Clean up table references
            name = name.replace(/\s*(?:على|في|من)\s*(?:ترابيزة|طاولة|table)\s*\d+/gi, '').trim();
            name = name.replace(/\s*(?:ترابيزة|طاولة|table)\s*\d+/gi, '').trim();
            name = name.replace(/\s*(?:على|في|من)\s*\d+\s*$/gi, '').trim();

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

        // Sales / Reports
        if (/(?:مبيعات|sales|بيع)/.test(t))
            return { intent: 'view_sales', needsConfirmation: false };
        if (/(?:تقرير|report)/.test(t))
            return { intent: 'view_sales', needsConfirmation: false };

        // Product Management
        if (/(?:تعديل\s+سعر|غيّر\s+سعر|price\s+change|سعر\s+جديد)/.test(t))
            return { intent: 'update_price', needsConfirmation: true, confirmType: 'update' };
        if (/(?:اضف\s+منتج|منتج\s+جديد|add\s+product)/.test(t))
            return { intent: 'add_product', needsConfirmation: true, confirmType: 'create' };
        if (/(?:حذف\s+منتج|امسح\s+منتج|remove\s+product)/.test(t))
            return { intent: 'delete_product', needsConfirmation: true, confirmType: 'delete' };
        if (/(?:المنتجات|قائمة\s+المنتجات|products|menu)/.test(t))
            return { intent: 'view_products', needsConfirmation: false };

        // Employee Management
        if (/(?:حضور|attendance|حضو)/.test(t))
            return { intent: 'employee_attendance', needsConfirmation: false };
        if (/(?:انصراف|leave|离)/.test(t))
            return { intent: 'employee_leave', needsConfirmation: false };
        if (/(?:الموظفين|موظف|employees)/.test(t))
            return { intent: 'view_employees', needsConfirmation: false };
        if (/(?:وردية|shift)/.test(t))
            return { intent: 'manage_shift', needsConfirmation: false };

        // Expense
        if (/(?:مصروف|expense|مصروفات)/.test(t))
            return { intent: 'add_expense', needsConfirmation: true, confirmType: 'expense' };

        // Inventory
        if (/(?:مخزون|inventory|stock)/.test(t))
            return { intent: 'view_inventory', needsConfirmation: false };

        // Purchase
        if (/(?:اشتر(?:يت|ى|ي)|شراء|مشتريات|فاتورة\s+مورد|purchase|inv(?:oice)?)\s/.test(t) || /(?:اشتر(?:يت|ى|ي)|شراء|مشتريات)\s+(?:.+\s+)?بـ?\s*\d/.test(t) || /(?:اشتر(?:يت|ى|ي)|شراء|مشتريات)/.test(t))
            return { intent: 'add_purchase', needsConfirmation: false };

        // Tables overview
        if (/(?:الطاولات|طاولات|tables)/.test(t))
            return { intent: 'view_tables', needsConfirmation: false };

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
            customer_operation: () => this.toolCustomerOp(params),
            view_sales: () => this.toolViewSales(params),
            view_products: () => this.toolViewProducts(params),
            update_price: () => this.toolUpdatePrice(params),
            add_product: () => this.toolAddProduct(params),
            delete_product: () => this.toolDeleteProduct(params),
            view_employees: () => this.toolViewEmployees(params),
            employee_attendance: () => this.toolEmployeeAttendance(params),
            employee_leave: () => this.toolEmployeeLeave(params),
            manage_shift: () => this.toolManageShift(params),
            add_expense: () => this.toolAddExpense(params),
            add_purchase: () => this.toolAddPurchase(params),
            view_inventory: () => this.toolInventory(params),
            view_tables: () => this.toolViewTables(params)
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
                const baseName = (p.name || '').toLowerCase();
                return name === q || nameEn === q || baseName === q;
            });

            // Partial match
            if (matches.length === 0) {
                matches = products.filter(p => {
                    const name = (p.nameAr || p.name || '').toLowerCase();
                    const nameEn = (p.nameEn || '').toLowerCase();
                    const baseName = (p.name || '').toLowerCase();
                    return name.includes(q) || nameEn.includes(q) || baseName.includes(q) || q.includes(name) || q.includes(baseName);
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
            const openOrder = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'pending' || o.status === 'open') && o.paymentStatus !== 'paid');

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
            const newOrder = {
                tableId: String(tableNum),
                orderType: params.orderType || 'dine_in',
                status: 'pending',
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

            const created = await window.LuccaDB.Orders.create(newOrder.tableId, [], '', '', { orderType: newOrder.orderType });
            const orderId = created.id;
            const orderNumber = created.orderNumber;

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
                order = await window.LuccaDB.Orders.getById(orderId);
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
                order = await window.LuccaDB.Orders.getById(orderId);
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
                        name: p.name,
                        nameAr: p.nameAr || p.name,
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

    async toolCloseTable(params) {
        const tableNum = params.tableNumber || this.context.currentTable;
        const paymentMethod = params.paymentMethod || 'cash';
        if (!tableNum) return { success: false, message: '❌ حدد رقم الطاولة' };

        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const order = orders.find(o => String(o.tableId) === String(tableNum) && (o.status === 'open' || o.status === 'pending') && o.paymentStatus !== 'paid');
            if (!order) return { success: false, message: '❌ ما في طلب مفتوح على الطاولة ' + tableNum };

            const total = order.total || order.totalAmount || 0;

            // Process payment via Orders.checkout
            try {
                await window.LuccaDB.Orders.checkout(order.id, paymentMethod);
            } catch(checkoutErr) {
                // Fallback: update order status manually
                await window.LuccaDB.Orders.update(order.id, { status: 'completed', paymentStatus: 'paid' });
                await window.LuccaDB.Tables.update(tableNum, { status: 'available', currentOrder: null });
            }

            this.context.currentTable = null;
            this.context.currentOrderId = null;

            await this.logAudit('close_table', { table: tableNum, orderId: order.id, paymentMethod, total });

            return {
                success: true,
                message: '✅ تم إغلاق الطاولة ' + tableNum + '\n💰 الإجمالي: ' + total + ' ل.س\n💳 طريقة الدفع: ' + paymentMethod,
                table: tableNum
            };
        } catch (e) {
            return { success: false, message: '❌ خطأ في إغلاق الطاولة: ' + e.message };
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

    // ===== NEW TOOL IMPLEMENTATIONS =====
    async toolViewSales(params) {
        try {
            const orders = await window.LuccaDB.Orders.getAll();
            const today = new Date().toISOString().slice(0, 10);
            const todayOrders = orders.filter(o => {
                const d = (o.date || o.createdAt || '').slice(0, 10);
                return d === today;
            });
            const completed = todayOrders.filter(o => o.paymentStatus === 'paid' || o.status === 'completed' || o.status === 'closed');
            const totalSalesGross = completed.reduce((s, o) => s + (o.total || o.totalAmount || 0), 0);
            const todayRefunds = (await window.LuccaDB.db.getAll('refunds')).filter(r => (r.date||r.createdAt||r.updatedAt||'').slice(0,10) === today).reduce((s,r) => s + Number(r.amount||0), 0);
            const totalSales = totalSalesGross - todayRefunds;
            const totalOrders = todayOrders.length;

            let msg = '📊 **مبيعات اليوم (' + today + '):**\n\n';
            msg += '📋 إجمالي الطلبات: ' + totalOrders + '\n';
            msg += '💰 إجمالي المبيعات: ' + this._fmtMoney(totalSales) + ' ل.س\n';
            msg += '✅ مكتملة: ' + completed.length + '\n';
            msg += '⏳ قيد الانتظار: ' + (todayOrders.length - completed.length) + '\n';

            if (completed.length > 0) {
                msg += '\n📈 **الطلبات:**\n';
                completed.slice(-10).reverse().forEach(o => {
                    msg += '  • #' + (o.orderNumber || o.id) + ' | طاولة ' + (o.tableId || '—') + ' | ' + (o.total || 0) + ' ل.س\n';
                });
            }

            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolViewProducts(params) {
        try {
            const products = await window.LuccaDB.Products.getActive();
            let msg = '📦 **المنتجات (' + products.length + '):**\n\n';
            products.slice(0, 30).forEach((p, i) => {
                msg += (i + 1) + '. ' + (p.nameAr || p.name || '—') + ' | ' + (p.price || 0) + ' ل.س\n';
            });
            if (products.length > 30) msg += '\n... و ' + (products.length - 30) + ' منتج تاني';
            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolUpdatePrice(params) {
        const text = params._rawText || '';
        const m = text.match(/(?:سعر|price)\s+(.+?)\s+(\d+)/i) || text.match(/(\D+?)\s+(\d+)\s*(?:ل.س|جنيه|pound)?/i);
        if (!m) return { success: false, message: '❌ حدد المنتج والسعر الجديد.\nمثال: "تعديل سعر لاتيه 50"' };
        const prodName = m[1].trim();
        const newPrice = Number(m[2]);
        if (!newPrice) return { success: false, message: '❌ السعر غير صحيح' };

        try {
            const products = await window.LuccaDB.Products.getActive();
            const found = products.find(p => {
                const name = (p.nameAr || p.name || '').toLowerCase();
                return name.includes(prodName.toLowerCase()) || prodName.toLowerCase().includes(name);
            });
            if (!found) return { success: false, message: '❌ ما لقيت منتج اسمه "' + prodName + '"' };

            const oldPrice = found.price;
            await window.LuccaDB.Products.update(found.id, { price: newPrice });
            await this.logAudit('update_price', { product: found.nameAr || found.name, oldPrice, newPrice });

            return { success: true, message: '✅ تم تعديل السعر!\n📦 ' + (found.nameAr || found.name) + '\n💰 القديم: ' + this._fmtMoney(oldPrice) + ' ل.س\n💰 الجديد: **' + this._fmtMoney(newPrice) + ' ل.س**' };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolAddProduct(params) {
        return { success: true, message: '📦 **إضافة منتج جديد:**\n\nاكتب:\n"أضف منتج [الاسم] بسعر [السعر] في قسم [القسم]"\n\nمثال: "أضف منتج موكا بسعر 45 في قسم القهوة"' };
    }

    async toolDeleteProduct(params) {
        return { success: true, message: '🗑️ **حذف منتج:**\n\nاكتب:\n"احذف منتج [الاسم]"\n\nأو:\n"أخفِ منتج [الاسم]"' };
    }

    async toolViewEmployees(params) {
        try {
            const employees = await window.LuccaDB.Employees.getAll();
            if (!employees || employees.length === 0) return { success: true, message: '👥 ما في موظفين مسجلين حالياً.\n\nأضفهم من لوحة التحكم → الموظفين' };
            let msg = '👥 **الموظفين (' + employees.length + '):**\n\n';
            employees.forEach(e => {
                msg += '• ' + (e.name || '—') + ' | ' + (e.position || e.role || '—') + '\n';
            });
            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolEmployeeAttendance(params) {
        const text = params._rawText || '';
        const empName = text.replace(/حضور|attendance|حضر| تسجيل/gi, '').trim();
        try {
            const employees = await window.LuccaDB.Employees.getAll();
            if (!employees || employees.length === 0) return { success: true, message: '👥 ما في موظفين مسجلين' };
            const emp = employees.find(e => (e.name || '').includes(empName) || empName.includes(e.name || ''));
            if (!emp) return { success: true, message: '👥 **اختر موظف:**\n' + employees.map(e => '• ' + e.name).join('\n') };
            await window.LuccaDB.Attendance.checkIn(emp.id);
            return { success: true, message: '✅ تم تسجيل حضور ' + emp.name + '\n🕐 ' + new Date().toLocaleTimeString('ar-EG') };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolEmployeeLeave(params) {
        const text = params._rawText || '';
        const empName = text.replace(/انصراف|leave|安阳/gi, '').trim();
        try {
            const employees = await window.LuccaDB.Employees.getAll();
            if (!employees || employees.length === 0) return { success: true, message: '👥 ما في موظفين مسجلين' };
            const emp = employees.find(e => (e.name || '').includes(empName) || empName.includes(e.name || ''));
            if (!emp) return { success: true, message: '👥 **اختر موظف:**\n' + employees.map(e => '• ' + e.name).join('\n') };
            await window.LuccaDB.Attendance.checkOut(emp.id);
            return { success: true, message: '✅ تم تسجيل انصراف ' + emp.name + '\n🕐 ' + new Date().toLocaleTimeString('ar-EG') };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolManageShift(params) {
        return { success: true, message: '🕐 **إدارة الورديات:**\n\n• "ابدأ وردية [اسم الموظف]"\n• "أنهِ وردية [اسم الموظف]"\n\nأو من لوحة التحكم → الورديات' };
    }

    async toolAddExpense(params) {
        const text = params._rawText || '';
        const m = text.match(/(\d+(?:[.,]\d+)?)/);
        if (!m) return { success: false, message: '❌ حدد المبلغ.\nمثال: "مصروف 500 مشتريات خضار"' };
        const amount = Number(m[1].replace(',', '.'));
        // نزيل المبلغ وكلمات الأمر (سجل/مصروف/بمبلغ ...) لنبقي الوصف النظيف فقط،
        // فلا يتبقى فعل الأمر في الوصف (مثل "سجل حليب").
        const desc = text
            .replace(/سجلت|سجّل|سجل|سجّلت|تسجيل|مصروف|expense|بمبلغ|\d+/gi, ' ')
            .replace(/\s+/g, ' ').trim() || 'مصروف عام';
        try {
            // الهوية تُنبثق من مستخدم الجلسة داخل Expenses.add (createdBy/userId/employeeId)،
            // لا `ai_assistant` — فلا نتحكم فيها من نص المستخدم هنا.
            await window.LuccaDB.Expenses.add({
                amount,
                description: desc,
                category: 'general',
                date: new Date().toISOString()
            });
            let by = '—';
            try {
                const cu = window.LuccaDB && window.LuccaDB.Users && window.LuccaDB.Users.getCurrentUser && window.LuccaDB.Users.getCurrentUser();
                if (cu) by = (cu.name || cu.username || '—');
            } catch (e) { /* non-critical */ }
            return { success: true, message: '✅ تم تسجيل المصروف\n💰 المبلغ: ' + this._fmtMoney(amount) + ' ل.س\n📝 الوصف: ' + desc + '\n👤 بواسطة: ' + by };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    // ===== PURCHASE SYSTEM (Feature 5) =====

    async toolAddPurchase(params) {
        const text = params._rawText || '';
        if (!text || !text.trim()) {
            return { success: true, message: '🛒 **تسجيل مشتريات:**\n\nاكتب مثل:\n• "اشتريت لبن بـ210"\n• "اشتريت 10 كيلو لبن من شركة الأمل بـ2100"\n• "فاتورة مشتريات: لبن 10 × 210"' };
        }

        // Parse the purchase text
        const parseResult = await window.InvoiceScanner.parsePurchaseText(text);
        if (!parseResult || !parseResult.ok) {
            return { success: false, message: '❌ ' + (parseResult ? parseResult.error : 'لم أفهم المشتريات. حاول مثل: "اشتريت لبن بـ210"') };
        }

        const extracted = parseResult.data;

        // Validate items
        const validation = this._validatePurchaseItems(extracted.items);
        if (!validation.ok) {
            return { success: false, message: '❌ ' + validation.error };
        }

        // Look up supplier if mentioned
        let supplierInfo = null;
        if (extracted.supplier) {
            supplierInfo = await this._findSupplier(extracted.supplier);
        }

        // Infer category for each item
        for (const item of extracted.items) {
            item.category = item.category || this._inferPurchaseCategory(item.name);
        }

        // Resolve inventory item by name so Purchases.add can adjust stock on confirm
        let inventoryList = [];
        try {
            inventoryList = (await window.LuccaDB.Inventory.getAll()) || [];
        } catch (e) {
            console.error('[Batman] Failed to load inventory for purchase:', e);
        }
        const norm = s => String(s || '').trim().toLowerCase();
        for (const item of extracted.items) {
            if (!item.inventoryItemId) {
                const target = norm(item.name);
                const match = inventoryList.find(iv => norm(iv.name) === target) || inventoryList.find(iv => target && norm(iv.name).includes(target));
                if (match) item.inventoryItemId = match.id;
            }
        }

        // Check main category from first item (for display)
        const mainCategory = (extracted.items[0] && extracted.items[0].category) || 'أخرى';

        // Compute independent per-line totals: calculatedTotal = qty × unitPrice (financial rounding)
        // Never trust item.total as the sole truth; keep the invoice value as reportedTotal.
        const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
        let sumCalculated = 0;
        let sumReported = 0;
        const mismatchItems = [];
        for (const item of extracted.items) {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unitPrice) || 0;
            const calc = round2(qty * price);
            const rawReported = Number(item.total);
            const reported = (item.total != null && !isNaN(rawReported)) ? round2(rawReported) : calc;
            item.reportedTotal = reported;
            item.calculatedTotal = calc;
            sumCalculated += calc;
            sumReported += reported;
            const diff = round2(Math.abs(reported - calc));
            if (diff > 0.01) {
                item.totalDiscrepancy = true;
                item.diff = diff;
                mismatchItems.push({ name: item.name, qty, price, reported, calc, diff });
            }
        }

        // Build draft — final total is based on calculated totals, not reported.
        const draft = {
            type: 'purchase',
            items: extracted.items,
            supplier: extracted.supplier,
            supplierId: supplierInfo ? supplierInfo.id : null,
            supplierExists: supplierInfo ? true : false,
            invoiceNumber: extracted.invoiceNumber || null,
            invoiceDate: extracted.invoiceDate || null,
            tax: extracted.tax || 0,
            discount: extracted.discount || 0,
            total: round2(sumCalculated),
            reportedTotal: round2(sumReported),
            category: mainCategory,
            notes: extracted.notes || null,
            originalText: text,
            parseSource: parseResult.source || 'regex',
            createdAt: new Date().toISOString()
        };

        // Discrepancy review — a mismatch means the draft needs explicit review before saving.
        draft.needsReview = mismatchItems.length > 0;
        if (draft.needsReview) {
            let note = '⚠️ **يوجد تناقض في الفاتورة (NEEDS_REVIEW):**\n\n';
            for (const m of mismatchItems) {
                note += '• ' + m.name + ' × ' + m.qty + ' بسعر ' + this._fmtMoney(m.price) + '\n';
                note += '  — بالفاتورة: ' + this._fmtMoney(m.reported) + ' ل.س\n';
                note += '  — المحسوب (qty×price): ' + this._fmtMoney(m.calc) + ' ل.س\n';
                note += '  — فرق: ' + this._fmtMoney(m.diff) + ' ل.س\n';
            }
            note += '\nسيتم الحفظ بالإجمالي المحسوب (' + this._fmtMoney(draft.total) + ' ل.س) وليس المذكور (' + this._fmtMoney(draft.reportedTotal) + ' ل.س).';
            note += '\nأكّد صراحةً (نعم) للمتابعة أو (لا) للإلغاء.';
            draft.discrepancyNote = note;
            draft.hasDiscrepancy = true;
        }

        // Check if supplier needs creation prompt
        if (extracted.supplier && !supplierInfo) {
            draft.needsSupplierCreation = true;
        }

        // Manager approval for large purchases (>500)
        const cu = this._getCurrentUser();
        if (draft.total > 500 && cu && cu.role !== 'admin' && cu.role !== 'manager') {
            draft.needsManagerApproval = true;
        }

        // Log draft
        await this._logPurchaseAudit('BATMAN_PURCHASE_DRAFT', draft, 'draft');

        // Store draft and show confirmation
        this.pendingPurchaseDraft = draft;

        return this._formatPurchaseDraft(draft);
    }

    _formatPurchaseDraft(draft) {
        let msg = '📝 **مسودة مشتريات**\n\n';

        // Items — always show the calculated total (qty × price)
        for (const item of draft.items) {
            msg += '• ' + item.name;
            if (item.quantity > 1) msg += ' × ' + item.quantity;
            if (item.unit && item.unit !== 'قطعة') msg += ' (' + item.unit + ')';
            const shownTotal = (item.calculatedTotal != null && !isNaN(Number(item.calculatedTotal)))
                ? Number(item.calculatedTotal) : Number(item.total);
            msg += ' = ' + this._fmtMoney(shownTotal) + ' ل.س\n';
        }

        // Supplier
        if (draft.supplier) {
            if (draft.needsSupplierCreation) {
                msg += '\n🏭 المورد: **' + draft.supplier + '** (غير موجود — أنشئه عند التأكيد)';
            } else {
                msg += '\n🏭 المورد: **' + draft.supplier + '**';
            }
        } else {
            msg += '\n🏭 المورد: غير محدد';
        }

        // Category
        msg += '\n📂 التصنيف: ' + draft.category;

        // Invoice number
        if (draft.invoiceNumber) msg += '\n📋 رقم الفاتورة: ' + draft.invoiceNumber;

        // Discrepancy warning
        if (draft.needsReview) {
            msg += '\n\n🔻 **الحالة: NEEDS_REVIEW** (فارق غير متطابق)';
        }
        if (draft.hasDiscrepancy && draft.discrepancyNote) {
            msg += '\n\n' + draft.discrepancyNote;
        }

        // Manager approval needed
        if (draft.needsManagerApproval) {
            msg += '\n\n🔒 **هذه العملية تحتاج موافقة المدير.**';
        }

        msg += '\n\n💰 الإجمالي: **' + this._fmtMoney(draft.total) + ' ل.س**';
        msg += '\n\nهل أسجل المشتريات؟';

        return { success: true, message: msg, needsConfirmation: true, draftType: 'purchase' };
    }

    async _executePurchaseDraft(draft) {
        try {
            // Permission check
            const cu = this._getCurrentUser();
            if (!cu) {
                return { success: false, message: '❌ لا يوجد مستخدم مسجل. سجّل دخولك أولاً.' };
            }

            // Manager approval check
            if (draft.needsManagerApproval) {
                const canApprove = cu.role === 'admin' || cu.role === 'manager';
                if (!canApprove) {
                    await this._logPurchaseAudit('BATMAN_PURCHASE_CANCELLED', draft, 'manager_required');
                    return { success: true, message: '🔒 هذه العملية تحتاج موافقة المدير. تم حفظ المسودة للمراجعة.' };
                }
            }

            // Create supplier if needed
            if (draft.needsSupplierCreation && draft.supplier) {
                try {
                    const newSupplier = await window.LuccaDB.Suppliers.add({
                        name: draft.supplier,
                        active: 1,
                        createdBy: cu.name || 'batman'
                    });
                    draft.supplierId = newSupplier;
                    await this._logAudit('purchase_supplier_created', { supplier: draft.supplier, id: newSupplier });
                } catch (e) {
                    console.error('[Batman] Failed to create supplier:', e);
                }
            }

            // Execute purchase via Purchases.add (which handles inventory adjustment)
            // Final per-line total must be the CALCULATED total (qty × price), matching draft.total.
            const purchaseIds = [];
            for (const item of draft.items) {
                const calcTotal = (item.calculatedTotal != null && !isNaN(Number(item.calculatedTotal)))
                    ? Number(item.calculatedTotal)
                    : (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0);
                const purchaseData = {
                    name: item.name,
                    item: item.name,
                    quantity: item.quantity,
                    costPrice: item.unitPrice,
                    total: calcTotal,
                    supplier: draft.supplier || '',
                    supplierId: draft.supplierId || null,
                    category: item.category || draft.category || 'أخرى',
                    notes: (draft.notes || '') + (draft.invoiceNumber ? ' فاتورة #' + draft.invoiceNumber : ''),
                    inventoryItemId: item.inventoryItemId || null,
                    syncId: this._newSyncId()
                };
                const id = await window.LuccaDB.Purchases.add(purchaseData);
                purchaseIds.push(id);
            }

            // Log confirmation audit
            await this._logPurchaseAudit('BATMAN_PURCHASE_CONFIRMED', {
                ...draft,
                purchaseIds,
                confirmedBy: cu.name,
                userId: cu.userId || cu.id,
                employeeId: cu.employeeId
            }, 'confirmed');

            // Build success message (reflect the calculated totals actually saved)
            let msg = '✅ **تم تسجيل المشتريات**\n\n';
            for (const item of draft.items) {
                const calcTotal = (item.calculatedTotal != null && !isNaN(Number(item.calculatedTotal)))
                    ? Number(item.calculatedTotal) : Number(item.total);
                msg += '• ' + item.name + ' × ' + item.quantity + ' = ' + this._fmtMoney(calcTotal) + ' ل.س\n';
            }
            if (draft.supplier) msg += '\n🏭 المورد: ' + draft.supplier;
            msg += '\n💰 الإجمالي: **' + this._fmtMoney(draft.total) + ' ل.س**';
            msg += '\n📦 تم تحديث المخزون';

            return { success: true, message: msg };
        } catch (e) {
            console.error('[Batman] Purchase execution error:', e);
            return { success: false, message: '❌ فشل تسجيل المشتريات: ' + e.message };
        }
    }

    async _findSupplier(name) {
        try {
            const suppliers = await window.LuccaDB.Suppliers.getAll();
            const q = (name || '').toLowerCase();
            return suppliers.find(s => (s.name || '').toLowerCase().includes(q) || q.includes((s.name || '').toLowerCase()));
        } catch (e) { return null; }
    }

    _inferPurchaseCategory(itemName) {
        const name = (itemName || '').toLowerCase();
        const categories = {
            'خامات': ['لبن', 'حليب', 'قهوة', 'سكر', 'شاي', 'قمح', 'دقيق', 'بيض', 'زبدة', 'جبنة', 'كريمة', 'فراولة', 'مانجو', 'موز', 'تفاح', 'ليمون', 'نعناع', 'فواكه', 'خضار', 'لحوم', 'دجاج', 'سمك'],
            'مواد غذائية': ['أرز', 'معجون', 'صلصة', 'زيت', 'خل', 'ملح', 'فلفل', 'بهارات', 'تونة', 'عسل', 'مربى', 'شيبس', 'بسكويت', 'شوكولاتة', 'جبن'],
            'مشروبات': ['بيبسي', 'سفن', 'ماء', 'عصير', 'كولا', 'ميرندا', 'فيمتو', 'مشروب'],
            'مستلزمات تشغيل': ['أكياس', 'كلينكس', 'مناديل', 'صابون', 'معقم', 'قفازات', 'ورق', 'لفاف'],
        };
        for (const [cat, keywords] of Object.entries(categories)) {
            for (const kw of keywords) {
                if (name.includes(kw)) return cat;
            }
        }
        return 'خامات';
    }

    _validatePurchaseItems(items) {
        if (!items || !Array.isArray(items) || items.length === 0) {
            return { ok: false, error: 'لا توجد أصناف في المشتريات' };
        }
        for (const item of items) {
            if (!item.name || !item.name.trim()) {
                return { ok: false, error: 'اسم الصنف فارغ' };
            }
            if (Number(item.quantity) <= 0) {
                return { ok: false, error: 'الكمية يجب أن تكون أكبر من صفر: ' + item.name };
            }
            if (Number(item.unitPrice) < 0) {
                return { ok: false, error: 'السعر لا يمكن أن يكون سالبًا: ' + item.name };
            }
            // Verify total = qty × price (warn, don't hide the difference)
            const expected = Number(item.quantity) * Number(item.unitPrice);
            if (Number(item.total) > 0 && Math.abs(Number(item.total) - expected) > 0.01) {
                item.totalDiscrepancy = true;
                item.reportedTotal = Number(item.total);
                item.calculatedTotal = expected;
            } else if (Number(item.total) <= 0) {
                item.total = expected;
            }
        }
        return { ok: true };
    }

    _getCurrentUser() {
        try {
            const cu = window.LuccaDB && window.LuccaDB.Users && window.LuccaDB.Users.getCurrentUser && window.LuccaDB.Users.getCurrentUser();
            return cu || null;
        } catch (e) { return null; }
    }

    _newSyncId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    async _logAudit(action, data) {
        await this._logPurchaseAudit(action, data, '');
    }

    async _logPurchaseAudit(action, data, status) {
        try {
            const cu = this._getCurrentUser();
            const ld = window.LuccaDB && window.LuccaDB.AuditLogs;
            if (ld && typeof ld.log === 'function') {
                await ld.log(action, 'purchases', null, null, { ...data, status }, (cu && cu.name) || 'system');
            } else if (ld && typeof ld.add === 'function') {
                await ld.add({
                    userId: (cu && (cu.userId != null ? cu.userId : cu.id)) || null,
                    action: action,
                    objectType: 'purchases',
                    objectId: null,
                    oldValue: null,
                    newValue: JSON.stringify({ ...data, status }),
                    userName: (cu && cu.name) || 'batman',
                    createdAt: new Date().toISOString()
                });
            }
        } catch (e) { console.warn('[Batman] Audit log error:', e); }
    }

    // ===== END PURCHASE SYSTEM =====

    async toolInventory(params) {
        try {
            const inventory = await window.LuccaDB.Inventory.getAll();
            if (!inventory || inventory.length === 0) return { success: true, message: '📦 المخزون فاضي.\nأضف منتجات من لوحة التحكم → المخزون' };
            let msg = '📦 **المخزون (' + inventory.length + '):**\n\n';
            inventory.slice(0, 20).forEach(item => {
                const stock = item.quantity || item.currentStock || 0;
                const status = stock <= (item.minStock || 5) ? '⚠️' : '✅';
                msg += status + ' ' + (item.name || item.productName || '—') + ': ' + stock + '\n';
            });
            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    async toolViewTables(params) {
        try {
            const tables = await window.LuccaDB.Tables.getAll();
            const statusMap = { available: '🟢 فارغة', occupied: '🔴 مشغولة', reserved: '🔵 محجوزة', cleaning: '🟡 تنظيف' };
            let msg = '🪑 **الطاولات (' + tables.length + '):**\n\n';
            tables.sort((a, b) => a.number - b.number).forEach(t => {
                msg += (t.number) + '. ' + (statusMap[t.status] || t.status) + '\n';
            });
            return { success: true, message: msg };
        } catch (e) {
            return { success: false, message: '❌ ' + e.message };
        }
    }

    _fmtMoney(n) {
        return (Number(n) || 0).toLocaleString('ar-EG');
    }

    // ===== AUDIT LOGGING =====
    async logAudit(action, details) {
        try {
            let uid = 'ai_assistant';
            try {
                const cu = window.LuccaDB && window.LuccaDB.Users && window.LuccaDB.Users.getCurrentUser && window.LuccaDB.Users.getCurrentUser();
                if (cu) uid = (cu.userId != null ? cu.userId : cu.id) || uid;
            } catch (e) { /* non-critical */ }
            await window.LuccaDB.AuditLogs.log('AI_' + action, 'ai', null, null, details, uid);
        } catch (e) { /* audit log is non-critical */ }
    }

    // ===== MAIN PROCESSOR =====
    async process(userInput) {
        // ===== PURCHASE DRAFT CONFIRMATION =====
        if (this.pendingPurchaseDraft) {
            const t = (userInput || '').trim();
            if (/^(نعم|yes|ok|تمام|أكيد|confirm|تأكيد|سجّل|سجل)/i.test(t)) {
                const draft = this.pendingPurchaseDraft;
                this.pendingPurchaseDraft = null;
                return await this._executePurchaseDraft(draft);
            }
            if (/^(لا|cancel|إلغاء|no|تمام|blank| Hamel)/i.test(t)) {
                const draft = this.pendingPurchaseDraft;
                this.pendingPurchaseDraft = null;
                await this._logPurchaseAudit('BATMAN_PURCHASE_CANCELLED', draft, 'cancelled');
                return { success: true, message: '✅ تم إلغاء مسودة المشتريات.' };
            }
            // If user typed a new purchase command, parse it instead
            if (/(?:اشتر(?:يت|ى|ي)|شراء|مشتريات|فاتورة)/.test(t)) {
                this.pendingPurchaseDraft = null;
                // Fall through to normal processing
            } else {
                return { success: true, message: '⚠️ في مسودة مشتريات معلقة. اكتب "نعم" للتأكيد أو "لا" للإلغاء.' };
            }
        }

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
        // NOTE: verbPattern is already a full non-capturing group (?:افتح|...).
        // Wrapping it again (e.g. '(?:' + verbPattern + ')') or stripping its parens
        // produces '(?:?:...)' → "Nothing to repeat" SyntaxError in JS RegExp.
        const verbPattern = '(?:افتح|فتح|اقفل|قفل|حط|حطيت|ضف|اضف|أضف|زود|شيل|احذف|امسح|ادفع|دفع|حساب|انقل|ادمج|قسم|اطبع|ابعت|خلي|غير)';
        const refined = [];
        for (const part of parts) {
            const subParts = part.split(new RegExp('\\s+و\\s*' + verbPattern + '\\s', 'i'));
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

            // If no verb and no table → it's product names, prefix with "حط"
            let enhancedText = part;
            const hasVerb = /(حط|حطيت|ضف|اضف|أضف|شيل|احذف|امسح|ادفع|دفع|حساب|اقفل|افتح|انقل)/.test(part);
            if (!hasVerb && sharedTable) {
                enhancedText = 'حط ' + part + ' على ترابيزة ' + sharedTable;
            } else if (!tNum && sharedTable && hasVerb) {
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
        // بعض الأدوات تقرأ النص الأصلي (toolAddExpense وغيرها) — بدون هذا يصلها نص فارغ دائماً.
        params._rawText = userInput;

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
                delete: '⚠️ تأكد الحذف؟\n\nاكتب "نعم" للتأكيد أو "لا" للإلغاء',
                expense: (() => {
                    const amt = params._rawText ? (params._rawText.match(/(\d+(?:[.,]\d+)?)/) || [])[1] : null;
                    return '💸 **تأكيد تسجيل المصروف**\n💰 المبلغ: ' + (amt ? this._fmtMoney(Number(amt.replace(',', '.'))) : '?') + ' ل.س\n\nاكتب "نعم" للتأكيد أو "لا" للإلغاء';
                })()
            };
            return { success: true, message: confirmMessages[confirmType] || '⚠️ تأكد العملية؟\n\nاكتب "نعم" أو "لا"', needsConfirmation: true };
        }

        // Execute
        return await this.executeTool(intent, params);
    }
}

// Global instance
window.aiPosEngine = new AIPosEngine();
