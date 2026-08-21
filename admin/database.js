/*
╔══════════════════════════════════════════════════════════════════╗
║                    Lucca Caffè - نظام إدارة المقهى                  ║
║                         الإصدار 1.0                               ║
╚══════════════════════════════════════════════════════════════════╝
*/

// ==================== قاعدة البيانات المحلية ====================
const DB_NAME = 'lucca_caffe_db';
const DB_VERSION = 8;

class LuccaDatabase {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // جدول المستخدمين
                if (!db.objectStoreNames.contains('users')) {
                    db.createObjectStore('users', { keyPath: 'id' });
                }
                
                // جدول الطابيزات
                if (!db.objectStoreNames.contains('tables')) {
                    db.createObjectStore('tables', { keyPath: 'id' });
                } else if (event.oldVersion < 5) {
                    const tx = event.target.transaction;
                    const store = tx.objectStore('tables');
                    store.openCursor().onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const t = cursor.value;
                            if (!t.zone) {
                                t.zone = 'صالة';
                                if (t.number >= 11) t.zone = 'VIP';
                                cursor.update(t);
                            }
                            cursor.continue();
                        }
                    };
                }
                
                // جدول الطلبات
                if (!db.objectStoreNames.contains('orders')) {
                    const orderStore = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
                    orderStore.createIndex('tableId', 'tableId', { unique: false });
                    orderStore.createIndex('date', 'date', { unique: false });
                    orderStore.createIndex('status', 'status', { unique: false });
                }
                
                // جدول العملاء
                if (!db.objectStoreNames.contains('customers')) {
                    const customerStore = db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
                    customerStore.createIndex('phone', 'phone', { unique: true });
                }
                
                // جدول الإعدادات
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // جدول المخزون
                if (!db.objectStoreNames.contains('inventory')) {
                    const invStore = db.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
                    invStore.createIndex('name', 'name', { unique: false });
                }

                // جدول المشتريات
                if (!db.objectStoreNames.contains('purchases')) {
                    const purStore = db.createObjectStore('purchases', { keyPath: 'id', autoIncrement: true });
                    purStore.createIndex('date', 'date', { unique: false });
                }

                // جدول الموظفين
                if (!db.objectStoreNames.contains('employees')) {
                    db.createObjectStore('employees', { keyPath: 'id', autoIncrement: true });
                }

                // جدول الحضور والانصراف
                if (!db.objectStoreNames.contains('attendance')) {
                    const attStore = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
                    attStore.createIndex('employeeId', 'employeeId', { unique: false });
                    attStore.createIndex('date', 'date', { unique: false });
                }

                // جدول المصروفات (الإيجار, الفواتير, الخ)
                if (!db.objectStoreNames.contains('expenses')) {
                    const expStore = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
                    expStore.createIndex('date', 'date', { unique: false });
                    expStore.createIndex('category', 'category', { unique: false });
                }

                // جدول الشيفتات
                if (!db.objectStoreNames.contains('shifts')) {
                    const shiftStore = db.createObjectStore('shifts', { keyPath: 'id', autoIncrement: true });
                    shiftStore.createIndex('date', 'date', { unique: false });
                    shiftStore.createIndex('employeeId', 'employeeId', { unique: false });
                }

                // جدول الفواتير — سجل دائم للمبيعات
                if (!db.objectStoreNames.contains('invoices')) {
                    const invStore = db.createObjectStore('invoices', { keyPath: 'id', autoIncrement: true });
                    invStore.createIndex('orderId', 'orderId', { unique: true });
                    invStore.createIndex('date', 'date', { unique: false });
                    invStore.createIndex('tableId', 'tableId', { unique: false });
                }

                // جدول المدفوعات
                if (!db.objectStoreNames.contains('payments')) {
                    const payStore = db.createObjectStore('payments', { keyPath: 'id', autoIncrement: true });
                    payStore.createIndex('invoiceId', 'invoiceId', { unique: false });
                    payStore.createIndex('date', 'date', { unique: false });
                    payStore.createIndex('orderId', 'orderId', { unique: false });
                }

                // جدول طرق الدفع
                if (!db.objectStoreNames.contains('payment_methods')) {
                    const pmStore = db.createObjectStore('payment_methods', { keyPath: 'id', autoIncrement: true });
                    pmStore.createIndex('active', 'active', { unique: false });
                }

                // جدول الأقسام
                if (!db.objectStoreNames.contains('categories')) {
                    const catStore = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
                    catStore.createIndex('sortOrder', 'sortOrder', { unique: false });
                    catStore.createIndex('active', 'active', { unique: false });
                }

                // جدول المنتجات
                if (!db.objectStoreNames.contains('products')) {
                    const prodStore = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
                    prodStore.createIndex('categoryId', 'categoryId', { unique: false });
                    prodStore.createIndex('sku', 'sku', { unique: false });
                    prodStore.createIndex('available', 'available', { unique: false });
                }

                // جدول تعديلات المنتجات
                if (!db.objectStoreNames.contains('product_modifiers')) {
                    const modStore = db.createObjectStore('product_modifiers', { keyPath: 'id', autoIncrement: true });
                    modStore.createIndex('productId', 'productId', { unique: false });
                }

                // جدول تنويعات المنتجات
                if (!db.objectStoreNames.contains('product_variations')) {
                    const varStore = db.createObjectStore('product_variations', { keyPath: 'id', autoIncrement: true });
                    varStore.createIndex('productId', 'productId', { unique: false });
                }

                // جدول الضرائب
                if (!db.objectStoreNames.contains('taxes')) {
                    const taxStore = db.createObjectStore('taxes', { keyPath: 'id', autoIncrement: true });
                    taxStore.createIndex('active', 'active', { unique: false });
                }

                // جدول سجلات المراجعة
                if (!db.objectStoreNames.contains('audit_logs')) {
                    const auditStore = db.createObjectStore('audit_logs', { keyPath: 'id', autoIncrement: true });
                    auditStore.createIndex('userId', 'userId', { unique: false });
                    auditStore.createIndex('action', 'action', { unique: false });
                    auditStore.createIndex('createdAt', 'createdAt', { unique: false });
                }

                // جدول سجل حالات الطلب
                if (!db.objectStoreNames.contains('order_status_history')) {
                    const oshStore = db.createObjectStore('order_status_history', { keyPath: 'id', autoIncrement: true });
                    oshStore.createIndex('orderId', 'orderId', { unique: false });
                }

                // جدول الاسترداد
                if (!db.objectStoreNames.contains('refunds')) {
                    const refStore = db.createObjectStore('refunds', { keyPath: 'id', autoIncrement: true });
                    refStore.createIndex('orderId', 'orderId', { unique: false });
                }

                // جدول أصناف الطلب
                if (!db.objectStoreNames.contains('order_items')) {
                    const oiStore = db.createObjectStore('order_items', { keyPath: 'id', autoIncrement: true });
                    oiStore.createIndex('orderId', 'orderId', { unique: false });
                }

                // جدول الخصومات
                if (!db.objectStoreNames.contains('discounts')) {
                    const discStore = db.createObjectStore('discounts', { keyPath: 'id', autoIncrement: true });
                    discStore.createIndex('active', 'active', { unique: false });
                }
                if (!db.objectStoreNames.contains('botMemory')) {
                    const bmStore = db.createObjectStore('botMemory', { keyPath: 'id', autoIncrement: true });
                    bmStore.createIndex('type', 'type', { unique: false });
                    bmStore.createIndex('keywords', 'keywords', { unique: false });
                }
                // قاعدة المعرفة (Knowledge Base)
                if (!db.objectStoreNames.contains('knowledge_documents')) {
                    const kdStore = db.createObjectStore('knowledge_documents', { keyPath: 'id', autoIncrement: true });
                    kdStore.createIndex('type', 'type', { unique: false });
                    kdStore.createIndex('name', 'name', { unique: false });
                }
                if (!db.objectStoreNames.contains('knowledge_chunks')) {
                    const kcStore = db.createObjectStore('knowledge_chunks', { keyPath: 'id', autoIncrement: true });
                    kcStore.createIndex('documentId', 'documentId', { unique: false });
                }
                // الموردين
                if (!db.objectStoreNames.contains('suppliers')) {
                    const supStore = db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
                    supStore.createIndex('name', 'name', { unique: false });
                }
                // حركات المخزون
                if (!db.objectStoreNames.contains('stock_movements')) {
                    const smStore = db.createObjectStore('stock_movements', { keyPath: 'id', autoIncrement: true });
                    smStore.createIndex('ingredientId', 'ingredientId', { unique: false });
                    smStore.createIndex('type', 'type', { unique: false });
                    smStore.createIndex('date', 'date', { unique: false });
                }
                // وصفات المنتجات
                if (!db.objectStoreNames.contains('product_recipes')) {
                    const prStore = db.createObjectStore('product_recipes', { keyPath: 'id', autoIncrement: true });
                    prStore.createIndex('productId', 'productId', { unique: false });
                    prStore.createIndex('ingredientId', 'ingredientId', { unique: false });
                }
                // سجل الهالك
                if (!db.objectStoreNames.contains('waste_log')) {
                    const wlStore = db.createObjectStore('waste_log', { keyPath: 'id', autoIncrement: true });
                    wlStore.createIndex('ingredientId', 'ingredientId', { unique: false });
                    wlStore.createIndex('date', 'date', { unique: false });
                }
            };
        });
    }

    // عمليات عامة
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async get(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async add(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// إنشاء مثيل واحد
const db = new LuccaDatabase();

// ==================== مزامنة مباشرة مع السيرفر ====================
const ServerAPI = {
    getBaseUrl() { return localStorage.getItem('luccaServerUrl') || 'http://localhost:3000'; },
    getApiKey() { return localStorage.getItem('luccaApiKey') || ''; },
    getToken() { return sessionStorage.getItem('luccaToken') || ''; },

    async getAll(store) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            const token = this.getToken();
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${this.getBaseUrl()}/api/${store}`, { headers, signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) return await res.json();
            return null;
        } catch(e) { return null; }
    },

    // Lock to prevent concurrent syncToLocal race conditions
    _syncLocks: {},

    // جلب بيانات السيرفر في الخلفية وتحديث المحلي بدون إبطاء
    async syncToLocal(store) {
        // Prevent concurrent sync on same store
        if (this._syncLocks[store]) return;
        this._syncLocks[store] = true;
        try {
            const serverData = await this.getAll(store);
            if (Array.isArray(serverData)) {
                // Use put (upsert) instead of clear+add to prevent race windows
                for (const item of serverData) {
                    try {
                        await db.put(store, item);
                    } catch(e) { /* skip individual item errors */ }
                }
            }
        } catch(e) { /* silent */ }
        finally {
            this._syncLocks[store] = false;
        }
    },

    async add(store, item) {
        try {
            const headers = { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() };
            const res = await fetch(`${this.getBaseUrl()}/api/${store}`, {
                method: 'POST', headers, body: JSON.stringify(item)
            });
            if (res.ok) return await res.json();
            if (res.status === 409) {
                const errBody = await res.json().catch(() => ({}));
                const err = new Error(errBody.error || 'الطاولة عليها طلب نشط بالفعل');
                err.status = 409;
                err.existingOrderId = errBody.existingOrderId;
                throw err;
            }
            return null;
        } catch(e) {
            if (e && e.status === 409) throw e;
            return null;
        }
    },

    async put(store, id, item) {
        try {
            const headers = { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() };
            const res = await fetch(`${this.getBaseUrl()}/api/${store}/${id}`, {
                method: 'PUT', headers, body: JSON.stringify(item)
            });
            return res.ok;
        } catch(e) { return false; }
    },

    async remove(store, id) {
        try {
            const headers = { 'x-api-key': this.getApiKey() };
            const res = await fetch(`${this.getBaseUrl()}/api/${store}/${id}`, {
                method: 'DELETE', headers
            });
            return res.ok;
        } catch(e) { return false; }
    },

    async get(store, id) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            const token = this.getToken();
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const res = await fetch(`${this.getBaseUrl()}/api/${store}/${id}`, { headers });
            if (res.ok) return await res.json();
            return null;
        } catch(e) { return null; }
    },

    async checkout(orderId, data) {
        try {
            const headers = { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() };
            const res = await fetch(`${this.getBaseUrl()}/api/orders/${orderId}/checkout`, {
                method: 'POST', headers, body: JSON.stringify(data || {})
            });
            if (res.ok) return await res.json();
            const errBody = await res.json().catch(() => ({}));
            if (res.status === 409) {
                const err = new Error(errBody.error || 'الطلب مغلق بالفعل');
                err.status = 409;
                throw err;
            }
            return null;
        } catch(e) {
            if (e && e.status === 409) throw e;
            return null;
        }
    }
};

// ==================== إدارة المستخدمين ====================
const Users = {
    async login(username, password) {
        const users = await db.getAll('users');
        const user = users.find(u => u.username === username);
        if (!user) throw new Error('اسم المستخدم أو كلمة المرور خطأ');

        let valid = false;
        // Support both hashed (pbkdf2:) and legacy plaintext passwords
        if (user.password && user.password.startsWith('pbkdf2:')) {
            // Hashed password from server - use Web Crypto API to verify
            try {
                const parts = user.password.split(':');
                const storedHash = parts[2];
                const computedHash = await this.pbkdf2Hash(password, parts[1]);
                valid = (computedHash === storedHash);
            } catch(e) {
                // Web Crypto not available, try server
                throw new Error('كلمة المرور مشفرة - استخدم تسجيل الدخول من الخادم');
            }
        } else {
            valid = (user.password === password);
        }

        if (valid) {
            const safe = { id: user.id, username: user.username, name: user.name, role: user.role };
            localStorage.setItem('currentUser', JSON.stringify(safe));
            return user;
        }
        throw new Error('اسم المستخدم أو كلمة المرور خطأ');
    },

    async pbkdf2Hash(password, salt) {
        if (!window.crypto?.subtle) return null;
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' }, keyMaterial, 512);
        return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async register(userData) {
        const users = await this.getAll();
        if (users.find(u => u.username === userData.username)) {
            throw new Error('اسم المستخدم موجود');
        }
        userData.createdAt = new Date().toISOString();
        userData.role = userData.role || 'cashier';
        const id = await db.add('users', userData);
        ServerAPI.add('users', userData).catch(() => {});
        return { ...userData, id };
    },

    async add(userData) {
        const users = await this.getAll();
        const maxId = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0);
        const id = maxId + 1;
        const salt = crypto.randomUUID();
        const hashed = await this.pbkdf2Hash(userData.password, salt);
        const user = {
            id,
            username: userData.username,
            name: userData.name || '',
            password: hashed || userData.password,
            role: userData.role || 'cashier',
            active: userData.active !== undefined ? userData.active : true,
            createdAt: new Date().toISOString()
        };
        await db.add('users', { ...user, password: hashed || userData.password });
        const { password, ...safe } = user;
        ServerAPI.add('users', { ...safe }).catch(() => {});
        return safe;
    },

    async logout() {
        localStorage.removeItem('currentUser');
    },

    getCurrentUser() {
        const user = localStorage.getItem('currentUser');
        return user ? JSON.parse(user) : null;
    },

    async getAll() {
        return db.getAll('users');
    },

    async createDefaultAdmin() {
        const users = await db.getAll('users');
        if (users.length === 0) {
            await db.add('users', {
                id: 1,
                username: 'admin',
                password: '123456',
                name: 'مدير النظام',
                role: 'admin',
                createdAt: new Date().toISOString()
            });
        }
    }
};

// ==================== إدارة الطابيزات ====================
const Tables = {
    async init() {
        const tables = await db.getAll('tables');
        if (tables.length === 0) {
            const zones = ['صالة', 'VIP', 'خارجي', 'أرجيلة'];
            const zoneMap = [null, 'صالة','صالة','صالة','صالة','صالة','صالة','صالة','VIP','VIP','VIP','VIP','خارجي','خارجي','أرجيلة'];
            for (let i = 1; i <= 14; i++) {
                const t = { id: i, number: i, status: 'available', capacity: i <= 7 ? 4 : 6, currentOrder: null, zone: zoneMap[i] || 'صالة' };
                await db.put('tables', t);
            }
        }
    },

    async getAll() {
        return db.getAll('tables');
    },

    async add(tableData) {
        const all = await db.getAll('tables');
        const maxId = all.reduce((m, t) => Math.max(m, t.id || 0), 0);
        const table = { id: maxId + 1, number: tableData.number, status: 'available', capacity: tableData.capacity || 4, currentOrder: null, zone: tableData.zone || 'صالة' };
        await db.put('tables', table);
        ServerAPI.put('tables', table.id, table).catch(() => {});
        return table;
    },

    async remove(id) {
        await db.delete('tables', id);
        ServerAPI.delete('tables', id).catch(() => {});
    },

    async delete(id) {
        return this.remove(id);
    },

    async update(id, data) {
        const table = await db.get('tables', id);
        if (table) {
            Object.assign(table, data);
            await db.put('tables', table);
            ServerAPI.put('tables', id, table).catch(() => {});
        }
        return table;
    },

    async getById(id) {
        return db.get('tables', id);
    },

    async getZones() {
        const all = await db.getAll('tables');
        return [...new Set(all.map(t => t.zone || 'صالة'))].sort();
    }
};

// ==================== إدارة الطلبات ====================
const Orders = {
    async createWithPayment(tableId, items, customerName, customerPhone, paymentMethod, options) {
        options = options || {};
        customerName = customerName || '';
        customerPhone = customerPhone || '';
        const subtotal = (items || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
        const discount = parseFloat(options.discount) || 0;
        const discountAmount = subtotal * (discount / 100);
        const afterDiscount = subtotal - discountAmount;
        const taxRate = parseFloat(await Settings.get('taxRate')) || 0;
        const tax = options.applyTax !== false ? afterDiscount * (taxRate / 100) : 0;
        const order = {
            tableId: tableId || null,
            items: items || [],
            customerName,
            customerPhone,
            paymentMethod: paymentMethod || 'cash',
            customerNotes: options.customerNotes || '',
            invoiceDelivery: options.invoiceDelivery || 'cashier',
            marketingOptIn: Boolean(options.marketingOptIn),
            wantsWhatsappInvoice: options.invoiceDelivery === 'whatsapp',
            status: options.status || 'completed',
            subtotal,
            discount,
            discountAmount,
            discountType: 'percent',
            tax,
            total: afterDiscount + tax,
            date: new Date().toISOString(),
            createdBy: Users.getCurrentUser()?.name || 'menu'
        };

        let id;
        const serverResult = await ServerAPI.add('orders', order);
        if (serverResult && serverResult.id) {
            id = serverResult.id;
            await db.put('orders', { ...order, id });
        } else {
            id = await db.add('orders', order);
        }

        if (tableId && !isNaN(tableId)) {
            const tableStatus = order.status === 'completed' ? 'available' : 'occupied';
            await Tables.update(parseInt(tableId), { status: tableStatus, currentOrder: order.status === 'pending' ? id : null });
        }
        if (customerPhone) {
            await Customers.add(customerPhone, customerName, {
                marketingOptIn: Boolean(options.marketingOptIn),
                preferredChannel: options.invoiceDelivery || 'cashier',
                lastOrderTotal: order.total
            });
        }
        return { ...order, id };
    },

    async generateOrderNumber() {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const prefix = 'ORD-' + today + '-';
        const allOrders = await db.getAll('orders');
        const todayOrders = allOrders.filter(o => (o.orderNumber || '').startsWith(prefix));
        const seq = todayOrders.length + 1;
        return prefix + String(seq).padStart(3, '0');
    },

    async create(tableId, items, customerName = '', customerPhone = '', options = {}) {
        // Check for existing pending order on this table before creating
        if (tableId && !isNaN(tableId)) {
            const existingOrders = await db.getAll('orders');
            const active = existingOrders.find(o =>
                String(o.tableId) === String(tableId) &&
                o.status === 'pending' &&
                o.id !== (options.existingOrderId || null)
            );
            if (active) {
                return active;
            }
        }

        const orderNumber = options.orderNumber || await this.generateOrderNumber();

        const order = {
            tableId,
            items,
            customerName,
            customerPhone,
            paymentMethod: options.paymentMethod || 'cash',
            customerNotes: options.customerNotes || '',
            invoiceDelivery: options.invoiceDelivery || 'cashier',
            marketingOptIn: Boolean(options.marketingOptIn),
            wantsWhatsappInvoice: options.invoiceDelivery === 'whatsapp',
            status: options.status || 'pending',
            orderNumber,
            orderType: options.orderType || 'dine_in',
            paymentStatus: 'unpaid',
            totalPaid: 0,
            changeAmount: 0,
            subtotal: 0,
            tax: 0,
            total: 0,
            date: new Date().toISOString(),
            createdBy: Users.getCurrentUser()?.name || 'unknown'
        };

        order.items.forEach(item => {
            order.subtotal += (item.price || 0) * (item.quantity || 1);
        });
        const discount = parseFloat(options.discount) || 0;
        order.discount = discount;
        order.discountType = options.discountType || 'percent';
        const discountAmount = order.discountType === 'percent' ? order.subtotal * (discount / 100) : discount;
        const afterDiscount = order.subtotal - discountAmount;
        const taxRate = parseFloat(await Settings.get('taxRate')) || 14;
        order.tax = afterDiscount * (taxRate / 100);
        order.total = afterDiscount + order.tax;

        let id;
        try {
            const serverResult = await ServerAPI.add('orders', order);
            if (serverResult && serverResult.id) {
                id = serverResult.id;
                await db.put('orders', { ...order, id });
            } else {
                id = await db.add('orders', order);
            }
        } catch(e) {
            if (e.status === 409 && e.existingOrderId) {
                const existing = (await db.getAll('orders')).find(o => o.id == e.existingOrderId || o.id === e.existingOrderId);
                if (existing) {
                    existing.items = items;
                    existing.customerName = customerName || existing.customerName;
                    existing.customerPhone = customerPhone || existing.customerPhone;
                    existing.subtotal = order.subtotal;
                    existing.discount = order.discount;
                    existing.total = order.total;
                    await db.put('orders', existing);
                    return existing;
                }
            }
            id = await db.add('orders', order);
        }

        try {
            if (db.db.objectStoreNames.contains('order_items')) {
                for (const item of (order.items || [])) {
                    await db.add('order_items', { orderId: id, ...item });
                }
            }
        } catch(e) {}

        if (tableId && !isNaN(tableId)) {
            await Tables.update(parseInt(tableId), { status: 'occupied', currentOrder: id });
        }

        if (customerPhone) {
            await Customers.add(customerPhone, customerName, {
                marketingOptIn: Boolean(options.marketingOptIn),
                preferredChannel: options.invoiceDelivery || 'cashier',
                lastOrderTotal: order.total
            });
        }

        return { ...order, id };
    },

    async getAll() {
        return db.getAll('orders');
    },

    async getByTable(tableId) {
        const orders = await this.getAll();
        return orders.filter(o => String(o.tableId) === String(tableId) && o.status === 'pending');
    },

    async closeOrder(orderId) {
        const orders = await db.getAll('orders');
        const localOrder = orders.find(o => o.id === orderId);
        if (!localOrder) throw new Error('الطلب غير موجود');
        if (localOrder.status === 'closed') throw new Error('الطلب مغلق بالفعل');

        localOrder.status = 'closed';
        await db.put('orders', localOrder);

        if (localOrder.tableId && !isNaN(parseInt(localOrder.tableId))) {
            await Tables.update(parseInt(localOrder.tableId), { status: 'available', currentOrder: null });
        }

        return localOrder;
    },

    async updateStatus(orderId, status) {
        const orders = await db.getAll('orders');
        const localOrder = orders.find(o => o.id === orderId);
        if (!localOrder) throw new Error('الطلب غير موجود');
        const oldStatus = localOrder.status;
        localOrder.status = status;
        await db.put('orders', localOrder);
        try { await OrderStatusHistory.add(orderId, status, null, 'status changed from ' + oldStatus); } catch(e) {}
        if (['cancelled', 'closed'].includes(status) && localOrder.tableId && !isNaN(parseInt(localOrder.tableId))) {
            await Tables.update(parseInt(localOrder.tableId), { status: 'available', currentOrder: null });
        }
        ServerAPI.put('orders', orderId, localOrder).catch(() => {});
        return localOrder;
    },

    // Professional checkout: closes order, saves invoice+payment, updates inventory, frees table
    async checkout(orderId, paymentMethod) {
        const orders = await db.getAll('orders');
        const localOrder = orders.find(o => o.id === orderId);
        if (!localOrder) throw new Error('الطلب غير موجود');
        if (localOrder.status === 'closed') throw new Error('الطلب مغلق بالفعل');

        // Try server checkout first (atomic)
        const serverResult = await ServerAPI.checkout(orderId, { paymentMethod: paymentMethod || 'cash' });
        if (serverResult && serverResult.success) {
            // Server handled it atomically — sync local state from server
            if (serverResult.order) {
                await db.put('orders', serverResult.order);
            }
            if (localOrder.tableId && !isNaN(parseInt(localOrder.tableId))) {
                await Tables.update(parseInt(localOrder.tableId), { status: 'available', currentOrder: null });
            }
            return { ...localOrder, status: 'closed' };
        }

        // Server unavailable — do local checkout atomically
        const now = new Date().toISOString();
        const subtotal = localOrder.subtotal || (localOrder.items || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
        const discountAmount = localOrder.discountAmount || (subtotal * (localOrder.discount || 0) / 100);
        const total = localOrder.total || (subtotal - discountAmount + (localOrder.tax || 0));

        // 1. Create invoice (immutable record of the sale)
        const invoice = {
            orderId: localOrder.id,
            tableId: localOrder.tableId,
            customerName: localOrder.customerName || '',
            customerPhone: localOrder.customerPhone || '',
            items: localOrder.items || [],
            subtotal,
            discount: localOrder.discount || 0,
            discountAmount,
            tax: localOrder.tax || 0,
            total,
            paymentMethod: paymentMethod || 'cash',
            date: now,
            createdBy: Users.getCurrentUser()?.name || 'unknown'
        };
        const invoiceId = await db.add('invoices', invoice);

        // 2. Record payment
        const payment = {
            invoiceId,
            amount: total,
            method: paymentMethod || 'cash',
            date: now
        };
        await db.add('payments', payment);

        // 3. Deduct inventory (work in background)
        Inventory.deductForCheckout(localOrder.items || []).catch(() => {});

        // 4. Close the order
        localOrder.status = 'closed';
        localOrder.paymentMethod = paymentMethod || 'cash';
        localOrder.paymentStatus = 'paid';
        localOrder.totalPaid = total;
        localOrder.changeAmount = 0;
        await db.put('orders', localOrder);

        // 4b. Save order_items individually
        try {
            if (db.db.objectStoreNames.contains('order_items')) {
                for (const item of (localOrder.items || [])) {
                    await db.add('order_items', { orderId: localOrder.id, ...item });
                }
            }
        } catch(e) {}

        // 5. Free the table
        if (localOrder.tableId && !isNaN(parseInt(localOrder.tableId))) {
            await Tables.update(parseInt(localOrder.tableId), { status: 'available', currentOrder: null });
        }

        // 6. Sync to server in background
        ServerAPI.checkout(orderId, { paymentMethod: paymentMethod || 'cash' }).catch(() => {});

        return { ...localOrder, _invoiceId: invoiceId };
    },

    async updateOrder(orderId, updates) {
        const item = await db.get('orders', orderId);
        if (!item) {
            return null;
        }
        Object.assign(item, updates);
        if (updates.items && !updates.subtotal) {
            item.subtotal = updates.items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
            const discount = item.discount || 0;
            const discountAmount = item.subtotal * (discount / 100);
            const afterDiscount = item.subtotal - discountAmount;
            const taxRate = parseFloat(await Settings.get('taxRate')) || 14;
            item.tax = afterDiscount * (taxRate / 100);
            item.total = afterDiscount + item.tax;
        }
        await db.put('orders', item);

        if (updates.items && db.db.objectStoreNames.contains('order_items')) {
            try {
                const allOI = await db.getAll('order_items');
                const existing = allOI.filter(r => r.orderId === orderId);
                for (const r of existing) { await db.delete('order_items', r.id); }
                for (const oi of (updates.items || [])) { await db.add('order_items', { orderId, ...oi }); }
            } catch(e) {}
        }

        ServerAPI.put('orders', orderId, item).catch(() => {});
        return item;
    },

    async delete(orderId) {
        const orders = await db.getAll('orders');
        const order = orders.find(o => o.id === orderId);
        if (order) {
            await Tables.update(order.tableId, { status: 'available', currentOrder: null });
            await db.delete('orders', orderId);
            ServerAPI.remove('orders', orderId).catch(() => {});
        } else {
        }
    },

    async getDailySales() {
        const orders = await this.getAll();
        const today = new Date().toISOString().split('T')[0];
        return orders.filter(o => o.date.startsWith(today) && (o.status === 'closed' || o.status === 'completed' || o.status === 'pending'));
    },

    async getByDateRange(startDate, endDate) {
        const orders = await this.getAll();
        return orders.filter(o => {
            const d = o.date.split('T')[0];
            return d >= startDate && d <= endDate;
        });
    },

    async getStatusHistory(orderId) {
        try {
            return await OrderStatusHistory.getByOrder(orderId);
        } catch(e) { return []; }
    }
};

// ==================== إدارة العملاء ====================
const Customers = {
    async add(phone, name = '', options = {}) {
        const customers = await this.getAll();
        const exists = customers.find(c => c.phone === phone);
        
        if (!exists) {
            const customer = {
                phone,
                name,
                visits: 1,
                lastVisit: new Date().toISOString(),
                totalSpent: options.lastOrderTotal || 0,
                marketingOptIn: Boolean(options.marketingOptIn),
                preferredChannel: options.preferredChannel || 'cashier',
                createdAt: new Date().toISOString()
            };
            const serverResult = await ServerAPI.add('customers', customer);
            if (serverResult && serverResult.id) {
                await db.put('customers', { ...customer, id: serverResult.id });
            } else {
                await db.add('customers', customer);
            }
        } else {
            exists.name = name || exists.name;
            exists.visits++;
            exists.lastVisit = new Date().toISOString();
            exists.totalSpent = (exists.totalSpent || 0) + (options.lastOrderTotal || 0);
            exists.marketingOptIn = Boolean(options.marketingOptIn);
            exists.preferredChannel = options.preferredChannel || exists.preferredChannel || 'cashier';
            await db.put('customers', exists);
            ServerAPI.put('customers', exists.id, exists).catch(() => {});
        }
    },

    async getAll() {
        return db.getAll('customers');
    },

    async search(phone) {
        const customers = await this.getAll();
        return customers.filter(c => c.phone.includes(phone));
    }
};

// ==================== إدارة الإعدادات ====================
const Settings = {
    async get(key) {
        const setting = await db.get('settings', key);
        return setting?.value;
    },

    async set(key, value) {
        await db.put('settings', { key, value });
        ServerAPI.add('settings', { key, value }).catch(() => {});
    },

    async getAll() {
        const localData = await db.getAll('settings');
        return localData.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
    }
};

// ==================== إدارة المخزون ====================
const Inventory = {
    async getAll() { return db.getAll('inventory'); },
    async get(id) { return db.get('inventory', id); },
    async add(item) {
        item.createdAt = new Date().toISOString();
        item.lastUpdated = new Date().toISOString();
        return db.add('inventory', item);
    },
    async update(id, data) {
        const item = await db.get('inventory', id);
        if (item) { Object.assign(item, data, { lastUpdated: new Date().toISOString() }); await db.put('inventory', item); }
        return item;
    },
    async delete(id) { await db.delete('inventory', id); },
    async adjustStock(id, qty, type, notes) {
        const item = await db.get('inventory', id);
        if (!item) return null;
        const oldQty = item.quantity || 0;
        item.quantity = Math.max(0, oldQty + qty);
        item.lastUpdated = new Date().toISOString();
        await db.put('inventory', item);
        // Record movement
        await StockMovements.add({ ingredientId: id, type: type || 'adjustment', quantity: qty, notes: notes || '' });
        return item;
    },
    async getLowStock() {
        const all = await this.getAll();
        return all.filter(i => (i.quantity || 0) <= (i.minStock || i.minQuantity || 0) && (i.active || 1) === 1);
    },
    async search(query) {
        const all = await this.getAll();
        const q = (query || '').toLowerCase();
        return all.filter(i => (i.name || '').toLowerCase().includes(q) || (i.nameAr || '').toLowerCase().includes(q));
    },
    async deductForCheckout(orderItems) {
        if (!orderItems || !orderItems.length) return;
        // Try recipe-based deduction first
        for (const oi of orderItems) {
            const productId = oi.productId || oi.product_id;
            if (productId) {
                const recipes = await ProductRecipes.getByProduct(productId);
                if (recipes.length > 0) {
                    for (const r of recipes) {
                        const deductQty = (r.quantityNeeded || 1) * (oi.quantity || 1);
                        await this.adjustStock(r.ingredientId, -deductQty, 'recipe_deduct', 'طلب #' + (oi.orderId || ''));
                    }
                    continue;
                }
            }
            // Fallback: name matching
            const name = (oi.name || '').trim().toLowerCase();
            if (!name) continue;
            const all = await this.getAll();
            const inv = all.find(i => (i.name || '').trim().toLowerCase() === name);
            if (inv && inv.quantity > 0) {
                await this.adjustStock(inv.id, -(oi.quantity || 1), 'sale', 'بيع مباشر');
            }
        }
    }
};

// ==================== المشتريات ====================
const Purchases = {
    async getAll() { return db.getAll('purchases'); },
    async add(p) {
        p.date = p.date || new Date().toISOString();
        p.createdAt = new Date().toISOString();
        const id = await db.add('purchases', p);
        // Auto-add to inventory
        if (p.inventoryItemId) {
            await Inventory.adjustStock(p.inventoryItemId, p.quantity || 1, 'purchase', 'مشتريات: ' + (p.item || p.name || ''));
        }
        return id;
    },
    async delete(id) { await db.delete('purchases', id); },
    async getTotalCost() {
        const p = await this.getAll();
        return p.reduce((s, x) => s + ((x.costPrice || x.cost || 0) * (x.quantity || 1)), 0);
    }
};

// ==================== الموردين ====================
const Suppliers = {
    async getAll() { return db.getAll('suppliers'); },
    async get(id) { return db.get('suppliers', id); },
    async add(s) { s.createdAt = new Date().toISOString(); return db.add('suppliers', s); },
    async update(id, d) { const s = await db.get('suppliers', id); if (s) { Object.assign(s, d); await db.put('suppliers', s); } return s; },
    async delete(id) { await db.delete('suppliers', id); },
    async getActive() { const all = await this.getAll(); return all.filter(s => s.active !== 0); }
};

// ==================== حركات المخزون ====================
const StockMovements = {
    async getAll() { return db.getAll('stock_movements'); },
    async getByIngredient(id) { const all = await this.getAll(); return all.filter(m => m.ingredientId === id); },
    async getByType(type) { const all = await this.getAll(); return all.filter(m => m.type === type); },
    async getByDateRange(from, to) {
        const all = await this.getAll();
        return all.filter(m => {
            const d = (m.date || m.createdAt || '').slice(0, 10);
            return d >= from && d <= to;
        });
    },
    async add(m) {
        m.date = m.date || new Date().toISOString();
        m.createdAt = new Date().toISOString();
        return db.add('stock_movements', m);
    },
    async getStats() {
        const all = await this.getAll();
        const purchases = all.filter(m => m.type === 'purchase').reduce((s, m) => s + Math.abs(m.quantity || 0), 0);
        const sales = all.filter(m => m.type === 'sale' || m.type === 'recipe_deduct').reduce((s, m) => s + Math.abs(m.quantity || 0), 0);
        const waste = all.filter(m => m.type === 'waste').reduce((s, m) => s + Math.abs(m.quantity || 0), 0);
        return { total: all.length, purchases, sales, waste };
    }
};

// ==================== وصفات المنتجات ====================
const ProductRecipes = {
    async getAll() { return db.getAll('product_recipes'); },
    async getByProduct(productId) { const all = await this.getAll(); return all.filter(r => r.productId == productId); },
    async getByIngredient(ingredientId) { const all = await this.getAll(); return all.filter(r => r.ingredientId == ingredientId); },
    async add(r) { r.createdAt = new Date().toISOString(); return db.add('product_recipes', r); },
    async update(id, d) { const r = await db.get('product_recipes', id); if (r) { Object.assign(r, d); await db.put('product_recipes', r); } return r; },
    async delete(id) { await db.delete('product_recipes', id); },
    async deleteByProduct(productId) {
        const all = await this.getByProduct(productId);
        for (const r of all) await db.delete('product_recipes', r.id);
    },
    async getRecipeCost(productId) {
        const recipes = await this.getByProduct(productId);
        let totalCost = 0;
        for (const r of recipes) {
            const ing = await db.get('inventory', r.ingredientId);
            if (ing) totalCost += (ing.cost || ing.costPerUnit || 0) * (r.quantityNeeded || 1);
        }
        return totalCost;
    }
};

// ==================== سجل الهالك ====================
const WasteLog = {
    async getAll() { return db.getAll('waste_log'); },
    async add(w) {
        w.date = w.date || new Date().toISOString();
        w.createdAt = new Date().toISOString();
        const id = await db.add('waste_log', w);
        if (w.ingredientId) {
            await Inventory.adjustStock(w.ingredientId, -(w.quantity || 0), 'waste', 'هالك: ' + (w.reason || ''));
        }
        return id;
    },
    async getByDateRange(from, to) {
        const all = await this.getAll();
        return all.filter(w => { const d = (w.date || w.createdAt || '').slice(0, 10); return d >= from && d <= to; });
    },
    async getStats() {
        const all = await this.getAll();
        const totalCost = all.reduce((s, w) => s + (w.cost || 0), 0);
        const totalQty = all.reduce((s, w) => s + (w.quantity || 0), 0);
        return { count: all.length, totalCost, totalQty };
    }
};

// ==================== ولاء العملاء ====================
const POINTS_PER_UNIT = 1; // نقطة لكل وحدة عملة
const REDEEM_RATE = 100; // 100 نقطة = 1 وحدة خصم

const CustomerLoyalty = {
    async getOrCreateByPhone(phone) {
        if (!phone) return null;
        const all = await db.getAll('customers');
        let customer = all.find(c => (c.phone || '').replace(/\D/g, '') === phone.replace(/\D/g, ''));
        if (!customer) {
            customer = { name: '', phone: phone, points: 0, totalSpent: 0, totalVisits: 0, tier: 'bronze', createdAt: new Date().toISOString() };
            customer.id = await db.add('customers', customer);
        }
        if (!customer.points) customer.points = 0;
        if (!customer.totalSpent) customer.totalSpent = 0;
        if (!customer.totalVisits) customer.totalVisits = 0;
        if (!customer.tier) customer.tier = 'bronze';
        return customer;
    },

    async addPoints(phone, amount, orderId) {
        const customer = await this.getOrCreateByPhone(phone);
        if (!customer) return null;
        const earned = Math.floor(amount * POINTS_PER_UNIT);
        customer.points += earned;
        customer.totalSpent += amount;
        customer.totalVisits += 1;
        customer.lastVisit = new Date().toISOString();
        customer.tier = this.calcTier(customer.totalSpent);
        await db.put('customers', customer);
        return { customer, earned, total: customer.points };
    },

    async redeemPoints(phone, points) {
        const customer = await this.getOrCreateByPhone(phone);
        if (!customer) return null;
        if (customer.points < points) return { error: 'النقاط غير كافية', available: customer.points };
        const discount = Math.floor(points / REDEEM_RATE);
        customer.points -= points;
        customer.redeemedTotal = (customer.redeemedTotal || 0) + discount;
        customer.lastRedeem = new Date().toISOString();
        await db.put('customers', customer);
        return { customer, discount, remaining: customer.points };
    },

    async getCustomer(phone) {
        return this.getOrCreateByPhone(phone);
    },

    async getAllCustomers() {
        const all = await db.getAll('customers');
        return all.filter(c => c.phone).sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
    },

    async getTopCustomers(limit) {
        const all = await this.getAllCustomers();
        return all.slice(0, limit || 10);
    },

    async getStats() {
        const all = await this.getAllCustomers();
        const totalPoints = all.reduce((s, c) => s + (c.points || 0), 0);
        const totalSpent = all.reduce((s, c) => s + (c.totalSpent || 0), 0);
        const tiers = { diamond: 0, gold: 0, silver: 0, bronze: 0 };
        all.forEach(c => { if (tiers[c.tier] !== undefined) tiers[c.tier]++; });
        return { customers: all.length, totalPoints, totalSpent, tiers };
    },

    calcTier(totalSpent) {
        if (totalSpent >= 50000) return 'diamond';
        if (totalSpent >= 25000) return 'gold';
        if (totalSpent >= 10000) return 'silver';
        return 'bronze';
    },

    tierName(tier) {
        const names = { diamond: '💎 ماسي', gold: '🥇 ذهبي', silver: '🥈 فضي', bronze: '🥉 برونزي' };
        return names[tier] || '🥉 برونزي';
    },

    tierColor(tier) {
        const colors = { diamond: '#00bfff', gold: '#ffd700', silver: '#c0c0c0', bronze: '#cd7f32' };
        return colors[tier] || '#cd7f32';
    }
};

// ==================== إدارة الصندوق ====================
const CashRegister = {
    _storeName: 'cash_registers',

    async openDrawer(startingCash, employeeId, notes) {
        const existing = await this.getActiveDrawer();
        if(existing) return { error: 'الصندوق مفتوح بالفعل! أغلقه أولاً.', drawer: existing };

        const drawer = {
            status: 'open',
            startingCash: Number(startingCash) || 0,
            currentCash: Number(startingCash) || 0,
            employeeId: employeeId || null,
            openedAt: new Date().toISOString(),
            closedAt: null,
            closingCash: null,
            expectedCash: 0,
            difference: 0,
            totalCashSales: 0,
            totalCardSales: 0,
            totalExpenses: 0,
            totalRefunds: 0,
            transactionCount: 0,
            notes: notes || ''
        };
        drawer.id = await db.add(this._storeName, drawer);
        return { drawer };
    },

    async closeDrawer(closingCash, notes) {
        const drawer = await this.getActiveDrawer();
        if(!drawer) return { error: 'لا يوجد صندوق مفتوح' };

        drawer.status = 'closed';
        drawer.closingCash = Number(closingCash) || 0;
        drawer.closedAt = new Date().toISOString();
        drawer.difference = drawer.closingCash - drawer.expectedCash;
        if(notes) drawer.notes = (drawer.notes || '') + '\n' + notes;
        await db.put(this._storeName, drawer);
        return { drawer };
    },

    async getActiveDrawer() {
        const all = await db.getAll(this._storeName);
        return all.find(d => d.status === 'open') || null;
    },

    async getAllDrawers() {
        return db.getAll(this._storeName);
    },

    async recordTransaction(drawerId, type, amount, method, description) {
        const drawer = await db.get(this._storeName, drawerId);
        if(!drawer) return null;

        amount = Number(amount) || 0;
        drawer.transactionCount = (drawer.transactionCount || 0) + 1;

        if(type === 'sale'){
            if(method === 'cash' || method === 'كاش'){
                drawer.totalCashSales += amount;
                drawer.currentCash += amount;
            } else {
                drawer.totalCardSales += amount;
            }
        } else if(type === 'expense'){
            drawer.totalExpenses += amount;
            drawer.currentCash -= amount;
        } else if(type === 'refund'){
            drawer.totalRefunds += amount;
            if(method === 'cash' || method === 'كاش'){
                drawer.currentCash -= amount;
            }
        }

        drawer.expectedCash = drawer.startingCash + drawer.totalCashSales - drawer.totalExpenses - drawer.totalRefunds;
        await db.put(this._storeName, drawer);
        return drawer;
    },

    async getDrawerStats(drawerId) {
        const drawer = await db.get(this._storeName, drawerId);
        if(!drawer) return null;
        return {
            startingCash: drawer.startingCash,
            currentCash: drawer.currentCash,
            expectedCash: drawer.expectedCash,
            difference: drawer.difference,
            totalCashSales: drawer.totalCashSales,
            totalCardSales: drawer.totalCardSales,
            totalExpenses: drawer.totalExpenses,
            totalRefunds: drawer.totalRefunds,
            transactionCount: drawer.transactionCount,
            totalSales: drawer.totalCashSales + drawer.totalCardSales
        };
    },

    async getTodaySummary() {
        const all = await db.getAll(this._storeName);
        const today = new Date().toISOString().slice(0, 10);
        const todayDrawers = all.filter(d => {
            const d1 = (d.openedAt || '').slice(0, 10);
            const d2 = (d.closedAt || '').slice(0, 10);
            return d1 === today || d2 === today;
        });
        let totalCash = 0, totalCard = 0, totalExpenses = 0, totalRefunds = 0, count = 0;
        todayDrawers.forEach(d => {
            totalCash += d.totalCashSales || 0;
            totalCard += d.totalCardSales || 0;
            totalExpenses += d.totalExpenses || 0;
            totalRefunds += d.totalRefunds || 0;
            count += d.transactionCount || 0;
        });
        return {
            drawersCount: todayDrawers.length,
            totalCashSales: totalCash,
            totalCardSales: totalCard,
            totalExpenses: totalExpenses,
            totalRefunds: totalRefunds,
            transactionCount: count,
            netCash: totalCash - totalExpenses - totalRefunds
        };
    }
};

// ==================== تصنيفات المصروفات ====================
const ExpenseCategories = {
    _storeName: 'expense_categories',
    _defaults: [
        { name: 'رواتب', nameEn: 'Salaries', icon: '👤', active: 1 },
        { name: 'إيجار', nameEn: 'Rent', icon: '🏠', active: 1 },
        { name: 'كهرباء', nameEn: 'Electricity', icon: '💡', active: 1 },
        { name: 'مياه', nameEn: 'Water', icon: '💧', active: 1 },
        { name: 'مواد خام', nameEn: 'Raw Materials', icon: '📦', active: 1 },
        { name: 'صيانة', nameEn: 'Maintenance', icon: '🔧', active: 1 },
        { name: 'تسويق', nameEn: 'Marketing', icon: '📢', active: 1 },
        { name: 'نقل', nameEn: 'Transport', icon: '🚗', active: 1 },
        { name: '其他', nameEn: 'Other', icon: '📋', active: 1 }
    ],

    async init() {
        const existing = await db.getAll(this._storeName);
        if(existing.length === 0){
            for(const cat of this._defaults){
                cat.createdAt = new Date().toISOString();
                await db.add(this._storeName, cat);
            }
        }
    },

    async getAll() { return db.getAll(this._storeName); },

    async add(cat) {
        cat.createdAt = new Date().toISOString();
        cat.active = 1;
        return db.add(this._storeName, cat);
    },

    async update(id, data) {
        const cat = await db.get(this._storeName, id);
        if(cat){
            Object.assign(cat, data);
            await db.put(this._storeName, cat);
            return cat;
        }
        return null;
    },

    async remove(id) {
        return db.delete(this._storeName, id);
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(c => c.active !== 0);
    }
};

// ==================== حجوزات الطاولات ====================
const TableReservations = {
    _storeName: 'table_reservations',

    async getAll() { return db.getAll(this._storeName); },

    async add(res) {
        res.createdAt = new Date().toISOString();
        res.status = 'confirmed';
        return db.add(this._storeName, res);
    },

    async cancel(id) {
        const res = await db.get(this._storeName, id);
        if(res){
            res.status = 'cancelled';
            await db.put(this._storeName, res);
            return res;
        }
        return null;
    },

    async complete(id) {
        const res = await db.get(this._storeName, id);
        if(res){
            res.status = 'completed';
            res.completedAt = new Date().toISOString();
            await db.put(this._storeName, res);
            return res;
        }
        return null;
    },

    async getToday() {
        const all = await this.getAll();
        const today = new Date().toISOString().slice(0, 10);
        return all.filter(r => (r.date || '').slice(0, 10) === today && r.status === 'confirmed');
    },

    async getByDate(date) {
        const all = await this.getAll();
        return all.filter(r => (r.date || '').slice(0, 10) === date && r.status === 'confirmed');
    },

    async getUpcoming() {
        const all = await this.getAll();
        const now = new Date();
        return all.filter(r => {
            if(r.status !== 'confirmed') return false;
            const dt = new Date(r.date + 'T' + (r.time || '00:00'));
            return dt >= now;
        }).sort((a,b) => {
            const da = new Date(a.date+'T'+(a.time||'00:00'));
            const db2 = new Date(b.date+'T'+(b.time||'00:00'));
            return da - db2;
        });
    },

    async isTableAvailable(tableId, date, time, excludeId) {
        const reservations = await this.getByDate(date);
        return !reservations.some(r => {
            if(excludeId && r.id === excludeId) return false;
            if(r.tableId != tableId) return false;
            // Check time overlap (2 hour window)
            const rTime = r.time || '00:00';
            const rEnd = addHours(rTime, r.duration || 2);
            const newEnd = addHours(time, 2);
            return time < rEnd && newEnd > rTime;
        });
    }
};

function addHours(timeStr, hours){
    const [h, m] = timeStr.split(':').map(Number);
    let totalMin = h * 60 + m + hours * 60;
    const nh = Math.floor(totalMin / 60) % 24;
    const nm = totalMin % 60;
    return String(nh).padStart(2,'0') + ':' + String(nm).padStart(2,'0');
}

// ==================== إدارة الموظفين ====================
const Employees = {
    async getAll() {
        return db.getAll('employees');
    },

    async add(employee) {
        employee.createdAt = new Date().toISOString();
        employee.active = true;
        const serverResult = await ServerAPI.add('employees', employee);
        if (serverResult && serverResult.id) {
            await db.put('employees', { ...employee, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('employees', employee);
    },

    async update(id, data) {
        const emp = await db.get('employees', id);
        if (emp) {
            Object.assign(emp, data);
            await db.put('employees', emp);
            ServerAPI.put('employees', id, emp).catch(() => {});
        }
        return emp;
    },

    async delete(id) {
        await db.delete('employees', id);
        ServerAPI.remove('employees', id).catch(() => {});
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(e => e.active);
    }
};

// ==================== الحضور والانصراف ====================
const Attendance = {
    async getAll() {
        return db.getAll('attendance');
    },

    async checkIn(employeeId, notes) {
        const today = new Date().toISOString().split('T')[0];
        const existing = await this.getByEmployeeAndDate(employeeId, today);
        if (existing) {
            throw new Error('تم تسجيل الحضور مسبقاً اليوم');
        }
        const record = {
            employeeId,
            date: today,
            checkIn: new Date().toISOString(),
            checkOut: null,
            notes: notes || ''
        };
        const serverResult = await ServerAPI.add('attendance', record);
        if (serverResult && serverResult.id) {
            await db.put('attendance', { ...record, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('attendance', record);
    },

    async checkOut(employeeId) {
        const today = new Date().toISOString().split('T')[0];
        const existing = await this.getByEmployeeAndDate(employeeId, today);
        if (!existing) {
            throw new Error('لم يتم تسجيل الحضور اليوم');
        }
        if (existing.checkOut) {
            throw new Error('تم تسجيل الانصراف مسبقاً');
        }
        existing.checkOut = new Date().toISOString();
        const diff = new Date(existing.checkOut) - new Date(existing.checkIn);
        existing.hoursWorked = Math.round(diff / 3600000 * 10) / 10;
        await db.put('attendance', existing);
        ServerAPI.put('attendance', existing.id, existing).catch(() => {});
        return existing;
    },

    async getByEmployeeAndDate(employeeId, date) {
        const all = await this.getAll();
        return all.find(a => a.employeeId === employeeId && a.date === date) || null;
    },

    async getToday() {
        const all = await this.getAll();
        const today = new Date().toISOString().split('T')[0];
        return all.filter(a => a.date === today);
    },

    async getByDateRange(startDate, endDate) {
        const all = await this.getAll();
        return all.filter(a => a.date >= startDate && a.date <= endDate);
    },

    async getByEmployee(employeeId) {
        const all = await this.getAll();
        return all.filter(a => a.employeeId === employeeId);
    }
};

// ==================== إدارة المصروفات ====================
const Expenses = {
    async getAll() {
        return db.getAll('expenses');
    },

    async add(expense) {
        expense.date = expense.date || new Date().toISOString();
        expense.createdAt = new Date().toISOString();
        const serverResult = await ServerAPI.add('expenses', expense);
        if (serverResult && serverResult.id) {
            await db.put('expenses', { ...expense, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('expenses', expense);
    },

    async update(id, data) {
        const item = await db.get('expenses', id);
        if (item) {
            Object.assign(item, data);
            await db.put('expenses', item);
            ServerAPI.put('expenses', id, item).catch(() => {});
        }
        return item;
    },

    async delete(id) {
        await db.delete('expenses', id);
        ServerAPI.remove('expenses', id).catch(() => {});
    },

    async getByDateRange(startDate, endDate) {
        const all = await this.getAll();
        return all.filter(e => {
            const d = (e.date || '').split('T')[0];
            return d >= startDate && d <= endDate;
        });
    },

    async getTotalByDateRange(startDate, endDate) {
        const items = await this.getByDateRange(startDate, endDate);
        return items.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
    },

    async getByCategory(category) {
        const all = await this.getAll();
        return all.filter(e => e.category === category);
    }
};

// ==================== إدارة الشيفتات ====================
const Shifts = {
    async getAll() {
        return db.getAll('shifts');
    },

    async start(employeeId, notes = '') {
        const today = new Date().toISOString().split('T')[0];
        const existing = await this.getByEmployeeAndDate(employeeId, today);
        if (existing) throw new Error('تم تسجيل شيفت للموظف اليوم');
        const shift = {
            employeeId,
            date: today,
            startTime: new Date().toISOString(),
            endTime: null,
            notes,
            status: 'active'
        };
        const serverResult = await ServerAPI.add('shifts', shift);
        if (serverResult && serverResult.id) {
            await db.put('shifts', { ...shift, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('shifts', shift);
    },

    async end(employeeId) {
        const today = new Date().toISOString().split('T')[0];
        const existing = await this.getByEmployeeAndDate(employeeId, today);
        if (!existing) throw new Error('لا يوجد شيفت نشط للموظف اليوم');
        if (existing.endTime) throw new Error('تم إنهاء الشيفت مسبقاً');
        existing.endTime = new Date().toISOString();
        existing.status = 'completed';
        const start = new Date(existing.startTime);
        const end = new Date(existing.endTime);
        existing.hoursWorked = Math.round((end - start) / 3600000 * 10) / 10;
        await db.put('shifts', existing);
        ServerAPI.put('shifts', existing.id, existing).catch(() => {});
        return existing;
    },

    async getByEmployeeAndDate(employeeId, date) {
        const all = await this.getAll();
        return all.find(s => s.employeeId === employeeId && s.date === date) || null;
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(s => s.status === 'active');
    },

    async getByDateRange(startDate, endDate) {
        const all = await this.getAll();
        return all.filter(s => s.date >= startDate && s.date <= endDate);
    },

    async getToday() {
        const all = await this.getAll();
        const today = new Date().toISOString().split('T')[0];
        return all.filter(s => s.date === today);
    },

    async getByEmployee(employeeId) {
        const all = await this.getAll();
        return all.filter(s => s.employeeId === employeeId);
    }
};

const MenuSync = {
    settingsKey: 'sharedMenuCatalog',

    normalizeCategory(category, index) {
        return {
            id: category.id || `category-${index + 1}`,
            title: category.title || `Category ${index + 1}`,
            icon: category.icon || '•',
            items: (category.items || []).map(item => ({
                ...item,
                price: typeof item.price === 'string' ? parseFloat(item.price) : item.price,
                prices: Array.isArray(item.prices)
                    ? item.prices.map(value => (typeof value === 'string' ? parseFloat(value) : value))
                    : undefined,
                origins: Array.isArray(item.origins)
                    ? item.origins.map(o => typeof o === 'object' && o !== null
                        ? { name: String(o.name || ''), price: o.price === undefined ? undefined : (typeof o.price === 'string' ? parseFloat(o.price) : o.price) }
                        : o)
                    : item.origins
            }))
        };
    },

    normalizeCatalog(catalog = []) {
        return catalog.map((category, index) => this.normalizeCategory(category, index));
    },

    async saveCatalog(catalog = []) {
        const normalized = this.normalizeCatalog(catalog);
        await Settings.set(this.settingsKey, normalized);
        return normalized;
    },

    async getCatalog() {
        return (await Settings.get(this.settingsKey)) || [];
    },

    fingerprint(menuDataSource = []) {
        try {
            return JSON.stringify(menuDataSource.map(category => ({
                title: category.title || '',
                items: (category.items || []).map(item => item.name || '')
            })));
        } catch (e) {
            return '';
        }
    },

    mergeCatalogs(stored = [], bundled = []) {
        const result = stored.map(category => ({ ...category, items: [...(category.items || [])] }));
        for (const bc of bundled) {
            const sc = result.find(category => (category.title || '').trim() === (bc.title || '').trim());
            if (!sc) {
                result.push(JSON.parse(JSON.stringify(bc)));
                continue;
            }
            for (const bi of (bc.items || [])) {
                const name = (bi.name || '').trim();
                if (!name) continue;
                const exists = (sc.items || []).some(item => (item.name || '').trim() === name);
                if (!exists) sc.items.push(JSON.parse(JSON.stringify(bi)));
            }
        }
        return result;
    },

    async syncFromMenuData(menuDataSource = []) {
        const existing = await this.getCatalog();
        if (!menuDataSource.length) return existing;
        if (!existing.length) {
            await Settings.set(this.settingsKey + 'Fingerprint', this.fingerprint(menuDataSource));
            return this.saveCatalog(menuDataSource);
        }
        const fingerprint = this.fingerprint(menuDataSource);
        const storedFingerprint = await Settings.get(this.settingsKey + 'Fingerprint');
        if (fingerprint === storedFingerprint) return existing;
        const merged = this.mergeCatalogs(existing, menuDataSource);
        await Settings.set(this.settingsKey + 'Fingerprint', fingerprint);
        return this.saveCatalog(merged);
    },

    async resetFromData(menuDataSource = []) {
        await Settings.set(this.settingsKey + 'Fingerprint', this.fingerprint(menuDataSource));
        return this.saveCatalog(menuDataSource);
    },

    async buildFromProducts() {
        const categories = await Categories.getActive();
        if (!categories.length) return null;
        const products = await Products.getActive();
        if (!products.length) return null;
        const iconMap = { coffee: '☕', drinks: '🥤', food: '🍽️', desserts: '🍰', hot: '🔥', cold: '🧊', juice: '🧃', milkshake: '🥤', soda: '🥤', pizza: '🍕', breakfast: '🥞', addons: '➕', winter: '❄️', specialty: '⭐' };
        return categories.map(cat => {
            const catProducts = products.filter(p => p.categoryId === cat.id || p.category === cat.name);
            return {
                id: cat.id || `cat-${cat.sortOrder || 0}`,
                icon: cat.icon || iconMap[cat.nameEn || ''] || '📂',
                title: cat.nameAr || cat.name || 'قسم',
                items: catProducts.map(p => ({
                    name: p.name,
                    price: parseFloat(p.price) || 0,
                    description: p.description || '',
                    badge: p.badge || null,
                    origins: (Array.isArray(p.origins) ? p.origins : []).map(o => typeof o === 'object' ? { name: o.name, price: o.price } : o),
                    _productId: p.id
                }))
            };
        });
    }
};

// ==================== إدارة طرق الدفع ====================
const PaymentMethods = {
    async getAll() {
        return db.getAll('payment_methods');
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(m => m.active !== 0).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async add(method) {
        method.active = method.active !== undefined ? method.active : 1;
        method.sortOrder = method.sortOrder || 0;
        method.createdAt = new Date().toISOString();
        method.updatedAt = new Date().toISOString();
        const serverResult = await ServerAPI.add('payment_methods', method);
        if (serverResult && serverResult.id) {
            await db.put('payment_methods', { ...method, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('payment_methods', method);
    },

    async update(id, data) {
        const item = await db.get('payment_methods', id);
        if (item) {
            Object.assign(item, data);
            item.updatedAt = new Date().toISOString();
            await db.put('payment_methods', item);
            ServerAPI.put('payment_methods', id, item).catch(() => {});
        }
        return item;
    },

    async delete(id) {
        await db.delete('payment_methods', id);
        ServerAPI.remove('payment_methods', id).catch(() => {});
    }
};

// ==================== إدارة الأقسام ====================
const Categories = {
    async getAll() {
        return db.getAll('categories');
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(c => c.active !== 0).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async add(category) {
        category.active = category.active !== undefined ? category.active : 1;
        category.sortOrder = category.sortOrder || 0;
        category.createdAt = new Date().toISOString();
        category.updatedAt = new Date().toISOString();
        const serverResult = await ServerAPI.add('categories', category);
        if (serverResult && serverResult.id) {
            await db.put('categories', { ...category, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('categories', category);
    },

    async update(id, data) {
        const item = await db.get('categories', id);
        if (item) {
            Object.assign(item, data);
            item.updatedAt = new Date().toISOString();
            await db.put('categories', item);
            ServerAPI.put('categories', id, item).catch(() => {});
        }
        return item;
    },

    async delete(id) {
        await db.delete('categories', id);
        ServerAPI.remove('categories', id).catch(() => {});
    },

    async reorder(orderedIds) {
        for (let i = 0; i < orderedIds.length; i++) {
            await this.update(orderedIds[i], { sortOrder: i + 1 });
        }
    }
};

// ==================== إدارة المنتجات ====================
const Products = {
    async getAll() {
        return db.getAll('products');
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(p => p.available !== 0).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async getByCategory(categoryId) {
        const all = await this.getAll();
        return all.filter(p => p.categoryId === categoryId && p.available !== 0)
                   .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async add(product) {
        product.available = product.available !== undefined ? product.available : 1;
        product.sortOrder = product.sortOrder || 0;
        product.productType = product.productType || 'standard';
        product.components = product.components || [];
        product.badge = product.badge || '';
        product.createdAt = new Date().toISOString();
        product.updatedAt = new Date().toISOString();
        const serverPayload = { ...product, components: JSON.stringify(product.components || []) };
        const serverResult = await ServerAPI.add('products', serverPayload);
        if (serverResult && serverResult.id) {
            await db.put('products', { ...product, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('products', product);
    },

    async update(id, data) {
        const item = await db.get('products', id);
        if (item) {
            Object.assign(item, data);
            item.updatedAt = new Date().toISOString();
            if (Array.isArray(item.components)) {
                await db.put('products', item);
                const serverData = { ...item, components: JSON.stringify(item.components) };
                ServerAPI.put('products', id, serverData).catch(() => {});
            } else {
                await db.put('products', item);
                ServerAPI.put('products', id, item).catch(() => {});
            }
        }
        return item;
    },

    async delete(id) {
        await db.delete('products', id);
        ServerAPI.remove('products', id).catch(() => {});
    },

    async search(query) {
        const all = await this.getAll();
        const q = query.toLowerCase();
        return all.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.name_ar || '').toLowerCase().includes(q) ||
            (p.name_en || '').toLowerCase().includes(q) ||
            (p.sku || '').toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q)
        );
    },

    getFoodCost(price, cost) {
        if (!price || price === 0) return 0;
        return ((cost || 0) / price) * 100;
    },

    getGrossProfit(price, cost) {
        return (price || 0) - (cost || 0);
    }
};

// ==================== إدارة تعديلات المنتجات ====================
const ProductModifiers = {
    async getByProduct(productId) {
        const all = await db.getAll('product_modifiers');
        return all.filter(m => m.productId === productId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async add(modifier) {
        modifier.sortOrder = modifier.sortOrder || 0;
        const serverResult = await ServerAPI.add('product_modifiers', modifier);
        if (serverResult && serverResult.id) {
            await db.put('product_modifiers', { ...modifier, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('product_modifiers', modifier);
    },

    async delete(id) {
        await db.delete('product_modifiers', id);
        ServerAPI.remove('product_modifiers', id).catch(() => {});
    }
};

// ==================== إدارة تنويعات المنتجات ====================
const ProductVariations = {
    async getByProduct(productId) {
        const all = await db.getAll('product_variations');
        return all.filter(v => v.productId === productId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async add(variation) {
        variation.sortOrder = variation.sortOrder || 0;
        const serverResult = await ServerAPI.add('product_variations', variation);
        if (serverResult && serverResult.id) {
            await db.put('product_variations', { ...variation, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('product_variations', variation);
    },

    async delete(id) {
        await db.delete('product_variations', id);
        ServerAPI.remove('product_variations', id).catch(() => {});
    }
};

// ==================== إدارة الضرائب ====================
const Taxes = {
    async getAll() {
        return db.getAll('taxes');
    },

    async getActive() {
        const all = await this.getAll();
        return all.filter(t => t.active !== 0);
    },

    async add(tax) {
        tax.active = tax.active !== undefined ? tax.active : 1;
        tax.appliesTo = tax.appliesTo || 'all';
        tax.createdAt = new Date().toISOString();
        tax.updatedAt = new Date().toISOString();
        const serverResult = await ServerAPI.add('taxes', tax);
        if (serverResult && serverResult.id) {
            await db.put('taxes', { ...tax, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('taxes', tax);
    },

    async update(id, data) {
        const item = await db.get('taxes', id);
        if (item) {
            Object.assign(item, data);
            item.updatedAt = new Date().toISOString();
            await db.put('taxes', item);
            ServerAPI.put('taxes', id, item).catch(() => {});
        }
        return item;
    },

    async delete(id) {
        await db.delete('taxes', id);
        ServerAPI.remove('taxes', id).catch(() => {});
    },

    async calculateTotal(subtotal, discountAmount) {
        const activeTaxes = await this.getActive();
        let totalTax = 0;
        const afterDiscount = subtotal - discountAmount;
        for (const tax of activeTaxes) {
            totalTax += afterDiscount * ((tax.rate || 0) / 100);
        }
        return totalTax;
    }
};

// ==================== سجلات المراجعة ====================
const AuditLogs = {
    async getAll() {
        return db.getAll('audit_logs');
    },

    async log(action, objectType, objectId, oldValue, newValue, userName) {
        const currentUser = Users.getCurrentUser();
        const logEntry = {
            userId: currentUser?.id || null,
            userName: userName || currentUser?.name || 'system',
            action,
            objectType: objectType || '',
            objectId: objectId || null,
            oldValue: oldValue ? JSON.stringify(oldValue) : '',
            newValue: newValue ? JSON.stringify(newValue) : '',
            ipAddress: '',
            createdAt: new Date().toISOString()
        };
        const serverResult = await ServerAPI.add('audit_logs', logEntry);
        if (serverResult && serverResult.id) {
            await db.put('audit_logs', { ...logEntry, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('audit_logs', logEntry);
    },

    async getByDateRange(startDate, endDate) {
        const all = await this.getAll();
        return all.filter(l => {
            const d = (l.createdAt || '').split('T')[0];
            return d >= startDate && d <= endDate;
        });
    },

    async getByAction(action) {
        const all = await this.getAll();
        return all.filter(l => l.action === action);
    },

    async getByUser(userId) {
        const all = await this.getAll();
        return all.filter(l => l.userId === userId);
    }
};

// ==================== سجل حالات الطلب ====================
const OrderStatusHistory = {
    async getByOrder(orderId) {
        const all = await db.getAll('order_status_history');
        return all.filter(h => h.orderId === orderId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    },

    async add(orderId, status, changedBy, notes) {
        const entry = {
            orderId,
            status,
            changedBy: changedBy || Users.getCurrentUser()?.name || 'system',
            notes: notes || '',
            createdAt: new Date().toISOString()
        };
        const serverResult = await ServerAPI.add('order_status_history', entry);
        if (serverResult && serverResult.id) {
            await db.put('order_status_history', { ...entry, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('order_status_history', entry);
    }
};

// ==================== تصدير/استيراد البيانات ====================
const DataSync = {
    async exportAll() {
        const data = {
            users: await db.getAll('users'),
            tables: await db.getAll('tables'),
            orders: await db.getAll('orders'),
            customers: await db.getAll('customers'),
            settings: await db.getAll('settings'),
            inventory: await db.getAll('inventory'),
            purchases: await db.getAll('purchases'),
            employees: await db.getAll('employees'),
            attendance: await db.getAll('attendance'),
            expenses: await db.getAll('expenses'),
            shifts: await db.getAll('shifts'),
            categories: await db.getAll('categories'),
            products: await db.getAll('products'),
            product_modifiers: await db.getAll('product_modifiers'),
            product_variations: await db.getAll('product_variations'),
            payment_methods: await db.getAll('payment_methods'),
            taxes: await db.getAll('taxes'),
            payments: await db.getAll('payments'),
            refunds: await db.getAll('refunds'),
            audit_logs: await db.getAll('audit_logs'),
            order_status_history: await db.getAll('order_status_history'),
            discounts: await db.getAll('discounts'),
            exportDate: new Date().toISOString()
        };
        return JSON.stringify(data, null, 2);
    },

    async importAll(jsonString) {
        const data = JSON.parse(jsonString);
        const stores = ['users', 'tables', 'customers', 'orders', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'categories', 'products', 'product_modifiers', 'product_variations', 'payment_methods', 'taxes', 'payments', 'refunds', 'audit_logs', 'order_status_history', 'discounts'];
        for (const store of stores) {
            if (data[store]) {
                await db.clear(store);
                for (const item of data[store]) {
                    await db.add(store, item);
                }
            }
        }
    },

    downloadBackup() {
        this.exportAll().then(json => {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lucca-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
        });
    }
};

// ==================== المزامنة مع السيرفر ====================
let SERVER_URL = localStorage.getItem('luccaServerUrl') || 'http://localhost:3000';

const ServerSync = {
    setServerUrl(url) {
        localStorage.setItem('luccaServerUrl', url);
        SERVER_URL = url;
    },

    getServerUrl() {
        return localStorage.getItem('luccaServerUrl') || 'http://localhost:3000';
    },

    async pushAll() {
        const url = this.getServerUrl();
        const apiKey = localStorage.getItem('luccaApiKey') || 'lucca-secret-key';
        try {
            const data = {
                users: await db.getAll('users'),
                tables: await db.getAll('tables'),
                orders: await db.getAll('orders'),
                customers: await db.getAll('customers'),
                settings: await db.getAll('settings'),
                inventory: await db.getAll('inventory'),
                purchases: await db.getAll('purchases'),
                employees: await db.getAll('employees'),
                attendance: await db.getAll('attendance'),
                expenses: await db.getAll('expenses'),
                shifts: await db.getAll('shifts'),
                categories: await db.getAll('categories'),
                products: await db.getAll('products'),
                payment_methods: await db.getAll('payment_methods'),
                taxes: await db.getAll('taxes'),
                payments: await db.getAll('payments'),
                refunds: await db.getAll('refunds'),
                audit_logs: await db.getAll('audit_logs'),
                discounts: await db.getAll('discounts'),
                order_status_history: await db.getAll('order_status_history'),
                product_modifiers: await db.getAll('product_modifiers'),
                product_variations: await db.getAll('product_variations'),
                order_items: await db.getAll('order_items')
            };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${url}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
                body: JSON.stringify(data),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error('فشل رفع البيانات');
            return { success: true, message: '✅ تم رفع البيانات للسيرفر' };
        } catch (e) {
            return { success: false, message: '❌ فشل الاتصال بالسيرفر: ' + e.message };
        }
    },

    async pullAll() {
        const url = this.getServerUrl();
        const apiKey = localStorage.getItem('luccaApiKey') || 'lucca-secret-key';
        try {
            const collections = ['users', 'tables', 'orders', 'customers', 'settings', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'categories', 'products', 'payment_methods', 'taxes', 'payments', 'refunds', 'audit_logs', 'discounts', 'order_status_history', 'product_modifiers', 'product_variations', 'order_items'];
            for (const col of collections) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(`${url}/api/${col}`, {
                    headers: { 'x-api-key': apiKey },
                    signal: controller.signal
                });
                clearTimeout(timer);
                if (!res.ok) continue;
                const items = await res.json();
                await db.clear(col);
                for (const item of items) {
                    await db.add(col, item);
                }
            }
            return { success: true, message: '✅ تم تحميل البيانات من السيرفر' };
        } catch (e) {
            return { success: false, message: '❌ فشل الاتصال بالسيرفر: ' + e.message };
        }
    },

    async testConnection() {
        const url = this.getServerUrl();
        const apiKey = localStorage.getItem('luccaApiKey') || 'lucca-secret-key';
        try {
            const res = await fetch(`${url}/api/tables`, { method: 'HEAD', cache: 'no-store', headers: { 'x-api-key': apiKey } });
            return res.ok;
        } catch {
            return false;
        }
    }
};

// ==================== تهيئة النظام ====================
async function initSystem() {
    await db.init();

    // Auto-fetch API key from server (short timeout, best-effort)
    ServerAPI.getAll('public-key').then(data => {
        if (data?.apiKey) localStorage.setItem('luccaApiKey', data.apiKey);
    }).catch(() => {});

    await Tables.init();
    await Users.createDefaultAdmin();
    if (typeof menuData !== 'undefined' && Array.isArray(menuData) && menuData.length) {
        await MenuSync.syncFromMenuData(menuData);
    }

    // Push/pull server sequentially to prevent race conditions
    setTimeout(async () => {
        try {
            await ServerSync.pushAll();
        } catch(e) {}
        try {
            await ServerSync.pullAll();
        } catch(e) {}
    }, 500);

}

// ===== Bot Memory (نظام تعلم البوت) =====
const BotMemory = {
    async add(type, data) {
        const entry = {
            type,
            keywords: data.keywords || '',
            question: data.question || '',
            answer: data.answer || '',
            action: data.action || '',
            context: data.context || '',
            usageCount: 0,
            createdAt: new Date().toISOString(),
            lastUsed: null
        };
        return db.add('botMemory', entry);
    },

    async getAll(type) {
        const all = await db.getAll('botMemory');
        if (type) return all.filter(e => e.type === type);
        return all;
    },

    async search(query) {
        const all = await db.getAll('botMemory');
        const q = query.toLowerCase();
        return all.filter(e =>
            (e.keywords || '').toLowerCase().includes(q) ||
            (e.question || '').toLowerCase().includes(q) ||
            (e.answer || '').toLowerCase().includes(q)
        );
    },

    async update(id, data) {
        const item = await db.get('botMemory', id);
        if (item) {
            Object.assign(item, data);
            item.lastUsed = new Date().toISOString();
            item.usageCount = (item.usageCount || 0) + 1;
            await db.put('botMemory', item);
        }
        return item;
    },

    async incrementUsage(id) {
        const item = await db.get('botMemory', id);
        if (item) {
            item.usageCount = (item.usageCount || 0) + 1;
            item.lastUsed = new Date().toISOString();
            await db.put('botMemory', item);
        }
    },

    async getMostUsed(limit) {
        const all = await db.getAll('botMemory');
        return all.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, limit || 10);
    },

    async getRecent(limit) {
        const all = await db.getAll('botMemory');
        return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit || 10);
    },

    async remove(id) {
        await db.delete('botMemory', id);
    },

    async logInteraction(userMsg, botReply, commandExecuted) {
        return db.add('botMemory', {
            type: 'interaction',
            keywords: userMsg,
            question: userMsg,
            answer: botReply,
            action: commandExecuted || '',
            context: 'chat',
            usageCount: 0,
            createdAt: new Date().toISOString(),
            lastUsed: null
        });
    },

    async getStats() {
        const all = await db.getAll('botMemory');
        const learned = all.filter(e => e.type === 'learned');
        const interactions = all.filter(e => e.type === 'interaction');
        const corrections = all.filter(e => e.type === 'correction');
        return {
            totalEntries: all.length,
            learned: learned.length,
            interactions: interactions.length,
            corrections: corrections.length,
            mostUsed: learned.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 5)
        };
    }
};

// ===== Knowledge Base Module =====
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

function chunkText(text, maxLen, overlap){
    maxLen = maxLen || CHUNK_SIZE;
    overlap = overlap || CHUNK_OVERLAP;
    if(!text || text.length === 0) return [];
    const chunks = [];
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    let current = '';
    for(const sentence of sentences){
        if((current + ' ' + sentence).length > maxLen && current.length > 0){
            chunks.push(current.trim());
            const words = current.split(/\s+/);
            const overlapWords = words.slice(-Math.ceil(overlap / 5));
            current = overlapWords.join(' ') + ' ' + sentence;
        } else {
            current = current ? current + ' ' + sentence : sentence;
        }
    }
    if(current.trim()) chunks.push(current.trim());
    return chunks;
}

function estimateTokens(text){
    return Math.ceil((text || '').split(/\s+/).length * 1.3);
}

const KnowledgeBase = {
    async addDocument(doc){
        const entry = {
            name: doc.name || 'Untitled',
            type: doc.type || 'text',
            content: doc.content || '',
            chunksCount: 0,
            tags: doc.tags || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        entry.id = await this._add('knowledge_documents', entry);
        const chunks = chunkText(entry.content);
        for(let i = 0; i < chunks.length; i++){
            await this._add('knowledge_chunks', {
                documentId: entry.id,
                content: chunks[i],
                chunkIndex: i,
                tokensEstimate: estimateTokens(chunks[i]),
                createdAt: new Date().toISOString()
            });
        }
        entry.chunksCount = chunks.length;
        await this._put('knowledge_documents', entry);
        return entry;
    },

    async getAllDocuments(){
        return this._getAll('knowledge_documents');
    },

    async getDocument(id){
        return this._get('knowledge_documents', id);
    },

    async removeDocument(id){
        const chunks = await this.getChunksByDocument(id);
        for(const c of chunks) await this._delete('knowledge_chunks', c.id);
        return this._delete('knowledge_documents', id);
    },

    async getChunksByDocument(documentId){
        const all = await this._getAll('knowledge_chunks');
        return all.filter(c => c.documentId === documentId);
    },

    async searchChunks(query){
        const all = await this._getAll('knowledge_chunks');
        const terms = query.toLowerCase().split(/[\s,.\-!?]+/).filter(t => t.length > 1);
        const scored = [];
        for(const chunk of all){
            const content = (chunk.content || '').toLowerCase();
            let score = 0;
            for(const term of terms){
                if(content.includes(term)){
                    score += 1;
                    const count = (content.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                    if(count > 1) score += 0.5 * (count - 1);
                }
            }
            if(content.includes(query.toLowerCase())) score += 5;
            if(score > 0) scored.push({...chunk, score});
        }
        return scored.sort((a,b) => b.score - a.score).slice(0, 20);
    },

    async search(query){
        const results = await this.searchChunks(query);
        if(results.length === 0) return null;
        let context = '';
        for(const r of results.slice(0, 3)){
            context += r.content + '\n---\n';
        }
        return { results, context: context.trim(), count: results.length };
    },

    async ingestText(name, text, tags){
        return this.addDocument({ name, type: 'text', content: text, tags: tags || '' });
    },

    async ingestFile(file){
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const doc = await this.addDocument({
                        name: file.name,
                        type: file.type || 'text/plain',
                        content: e.target.result,
                        tags: ''
                    });
                    resolve(doc);
                } catch(err) { reject(err); }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    },

    async getStats(){
        const docs = await this.getAllDocuments();
        let totalChunks = 0;
        let totalTokens = 0;
        for(const doc of docs){
            const chunks = await this.getChunksByDocument(doc.id);
            totalChunks += chunks.length;
            totalTokens += chunks.reduce((s,c) => s + (c.tokensEstimate||0), 0);
        }
        return { documents: docs.length, chunks: totalChunks, tokens: totalTokens };
    },

    // Generic DB helpers
    async _add(store, item){ return db.add(store, item); },
    async _put(store, item){ return db.put(store, item); },
    async _get(store, id){ return db.get(store, id); },
    async _getAll(store){ return db.getAll(store); },
    async _delete(store, id){ return db.delete(store, id); }
};

// تصدير للاستخدام
window.LuccaDB = { db, Users, Tables, Orders, Customers, Settings, Inventory, Purchases, Employees, Attendance, Expenses, Shifts, MenuSync, DataSync, ServerSync, PaymentMethods, Categories, Products, ProductModifiers, ProductVariations, Taxes, AuditLogs, OrderStatusHistory, BotMemory, KnowledgeBase, Suppliers, StockMovements, ProductRecipes, WasteLog, CustomerLoyalty, CashRegister, ExpenseCategories, TableReservations, initSystem };
