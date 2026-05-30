/*
╔══════════════════════════════════════════════════════════════════╗
║                    Lucca Caffè - نظام إدارة المقهى                  ║
║                         الإصدار 1.0                               ║
╚══════════════════════════════════════════════════════════════════╝
*/

// ==================== قاعدة البيانات المحلية ====================
const DB_NAME = 'lucca_caffe_db';
const DB_VERSION = 3;

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
            const timer = setTimeout(() => controller.abort(), 800);
            const res = await fetch(`${this.getBaseUrl()}/api/${store}`, { headers, signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) return await res.json();
            return null;
        } catch(e) { return null; }
    },

    // جلب بيانات السيرفر في الخلفية وتحديث المحلي بدون إبطاء
    async syncToLocal(store) {
        try {
            const serverData = await this.getAll(store);
            if (Array.isArray(serverData)) {
                await db.clear(store);
                for (const item of serverData) await db.add(store, item);
            }
        } catch(e) {}
    },

    async add(store, item) {
        try {
            const headers = { 'Content-Type': 'application/json', 'x-api-key': this.getApiKey() };
            const res = await fetch(`${this.getBaseUrl()}/api/${store}`, {
                method: 'POST', headers, body: JSON.stringify(item)
            });
            if (res.ok) return await res.json();
            return null;
        } catch(e) { return null; }
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
            localStorage.setItem('currentUser', JSON.stringify(user));
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

    async logout() {
        localStorage.removeItem('currentUser');
    },

    getCurrentUser() {
        const user = localStorage.getItem('currentUser');
        return user ? JSON.parse(user) : null;
    },

    async getAll() {
        const localData = await db.getAll('users');
        ServerAPI.syncToLocal('users');
        return localData;
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
            for (let i = 1; i <= 14; i++) {
                const t = { id: i, number: i, status: 'available', capacity: 4, currentOrder: null };
                await db.add('tables', t);
                ServerAPI.add('tables', t).catch(() => {});
            }
        }
    },

    async getAll() {
        const localData = await db.getAll('tables');
        ServerAPI.syncToLocal('tables');
        return localData;
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

        if (tableId) {
        if (tableId && !isNaN(tableId)) {
            await Tables.update(parseInt(tableId), { status: 'occupied', currentOrder: id });
        }
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

    async create(tableId, items, customerName = '', customerPhone = '', options = {}) {
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
        const serverResult = await ServerAPI.add('orders', order);
        if (serverResult && serverResult.id) {
            id = serverResult.id;
            await db.put('orders', { ...order, id });
        } else {
            id = await db.add('orders', order);
        }

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
        const localData = await db.getAll('orders');
        ServerAPI.syncToLocal('orders');
        return localData;
    },

    async getByTable(tableId) {
        const orders = await this.getAll();
        return orders.filter(o => o.tableId === tableId && o.status !== 'completed');
    },

    async updateStatus(orderId, status) {
        const serverOk = await ServerAPI.put('orders', orderId, { status });
        if (serverOk) {
            const order = await ServerAPI.get('orders', orderId);
            if (order) {
                await db.put('orders', order);
                if (status === 'completed' || status === 'cancelled') {
                    await Tables.update(order.tableId, { status: 'available', currentOrder: null });
                }
                return order;
            }
        }
        const orders = await db.getAll('orders');
        const order = orders.find(o => o.id === orderId);
        if (order) {
            order.status = status;
            await db.put('orders', order);
            if (status === 'completed' || status === 'cancelled') {
                await Tables.update(order.tableId, { status: 'available', currentOrder: null });
            }
            ServerAPI.put('orders', orderId, order).catch(() => {});
        }
        return order;
    },

    async updateOrder(orderId, updates) {
        const item = await db.get('orders', orderId);
        if (!item) return null;
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
        }
    },

    async getDailySales() {
        const orders = await this.getAll();
        const today = new Date().toISOString().split('T')[0];
        return orders.filter(o => o.date.startsWith(today) && (o.status === 'completed' || o.status === 'pending'));
    },

    async getByDateRange(startDate, endDate) {
        const orders = await this.getAll();
        return orders.filter(o => {
            const d = o.date.split('T')[0];
            return d >= startDate && d <= endDate;
        });
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
        const localData = await db.getAll('customers');
        ServerAPI.syncToLocal('customers');
        return localData;
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
        ServerAPI.syncToLocal('settings');
        return setting?.value;
    },

    async set(key, value) {
        await db.put('settings', { key, value });
        ServerAPI.add('settings', { key, value }).catch(() => {});
    },

    async getAll() {
        const localData = await db.getAll('settings');
        ServerAPI.syncToLocal('settings');
        return localData.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
    }
};

// ==================== إدارة المخزون ====================
const Inventory = {
    async getAll() {
        const localData = await db.getAll('inventory');
        ServerAPI.syncToLocal('inventory');
        return localData;
    },

    async add(item) {
        item.createdAt = new Date().toISOString();
        const serverResult = await ServerAPI.add('inventory', item);
        if (serverResult && serverResult.id) {
            await db.put('inventory', { ...item, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('inventory', item);
    },

    async update(id, data) {
        const item = await db.get('inventory', id);
        if (item) {
            Object.assign(item, data);
            await db.put('inventory', item);
            ServerAPI.put('inventory', id, item).catch(() => {});
        }
        return item;
    },

    async delete(id) {
        await db.delete('inventory', id);
        ServerAPI.remove('inventory', id).catch(() => {});
    },

    async adjustStock(id, quantity) {
        const item = await db.get('inventory', id);
        if (item) {
            item.quantity = (item.quantity || 0) + quantity;
            item.lastUpdated = new Date().toISOString();
            await db.put('inventory', item);
            ServerAPI.put('inventory', id, item).catch(() => {});
        }
        return item;
    }
};

// ==================== إدارة المشتريات ====================
const Purchases = {
    async getAll() {
        const localData = await db.getAll('purchases');
        ServerAPI.syncToLocal('purchases');
        return localData;
    },

    async add(purchase) {
        purchase.date = purchase.date || new Date().toISOString();
        const serverResult = await ServerAPI.add('purchases', purchase);
        if (serverResult && serverResult.id) {
            await db.put('purchases', { ...purchase, id: serverResult.id });
            return serverResult.id;
        }
        return db.add('purchases', purchase);
    },

    async delete(id) {
        await db.delete('purchases', id);
        ServerAPI.remove('purchases', id).catch(() => {});
    },

    async getTotalCost() {
        const purchases = await this.getAll();
        return purchases.reduce((sum, p) => sum + ((p.costPrice || 0) * (p.quantity || 1)), 0);
    }
};

// ==================== إدارة الموظفين ====================
const Employees = {
    async getAll() {
        const localData = await db.getAll('employees');
        ServerAPI.syncToLocal('employees');
        return localData;
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
        const localData = await db.getAll('attendance');
        ServerAPI.syncToLocal('attendance');
        return localData;
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
        const localData = await db.getAll('expenses');
        ServerAPI.syncToLocal('expenses');
        return localData;
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
        const localData = await db.getAll('shifts');
        ServerAPI.syncToLocal('shifts');
        return localData;
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
                    : undefined
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

    async syncFromMenuData(menuDataSource = []) {
        const existing = await this.getCatalog();
        if (!existing.length && menuDataSource.length) {
            return this.saveCatalog(menuDataSource);
        }
        return existing;
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
            exportDate: new Date().toISOString()
        };
        return JSON.stringify(data, null, 2);
    },

    async importAll(jsonString) {
        const data = JSON.parse(jsonString);
        const stores = ['users', 'tables', 'customers', 'orders', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts'];
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
                shifts: await db.getAll('shifts')
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
            const collections = ['users', 'tables', 'orders', 'customers', 'settings', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts'];
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

    // Push/pull server in background — don't block page load
    ServerSync.pushAll().catch(() => {});
    ServerSync.pullAll().catch(() => {});

    console.log('✅ تم تهيئة نظام Lucca Caffè');
}

// تصدير للاستخدام
window.LuccaDB = { db, Users, Tables, Orders, Customers, Settings, Inventory, Purchases, Employees, Attendance, Expenses, Shifts, MenuSync, DataSync, ServerSync, initSystem };
