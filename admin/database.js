/*
╔══════════════════════════════════════════════════════════════════╗
║                    Lucca Caffè - نظام إدارة المقهى                  ║
║                         الإصدار 1.0                               ║
╚══════════════════════════════════════════════════════════════════╝
*/

// ==================== قاعدة البيانات المحلية ====================
const DB_NAME = 'lucca_caffe_db';
const DB_VERSION = 9;

// ==================== C2: Stable Sync IDs & updatedAt ====================
// مخازن قابلة للمزامنة — سبقت كلها بـ syncId/updatedAt (الهوية المستقرة، لا autoincrement id).
const SYNC_STORES = [
    'users','tables','orders','order_items','invoices','payments','refunds',
    'audit_logs','order_status_history','customers','inventory','stock_movements',
    'purchases','product_recipes','waste_log','expenses','employees','attendance',
    'shifts','categories','products','product_modifiers','product_variations',
    'payment_methods','taxes','discounts','suppliers','cash_registers'
];

// توليد UUID v4 (يكفي للبيئة المحلية/CRDT، لا يتطلب سيرفر)
function newSyncId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// طابع زمني للبيانات — يُحدَّث في طبقة البيانات نفسها.
// (قرار التعارض يتم عبر نافذة غموض وليس Date.now() وحده — انظر newestWins أدناه.)
function newDataTimestamp() { return new Date().toISOString(); }

// إضافة/تحديث حقول الهوية المستقرة لسجل قيد الكتابة.
function stampSyncRecord(store, data, isNew) {
    if (!data || typeof data !== 'object') return data;
    const isSyncStore = SYNC_STORES.indexOf(store) !== -1;
    if (isSyncStore) {
        if (isNew && !data.syncId) data.syncId = newSyncId();
        if (store === 'order_items' && data.orderSyncId == null && data.orderId != null) {
            // يُملأ orderSyncId لاحقاً عند الربط (انظر ensureOrderSyncIds)
        }
        data.updatedAt = newDataTimestamp();
    }
    return data;
}

// backfill: إضافة syncId/updatedAt للسجلات القديمة أثناء upgrade (cursur في معاملة onupgradeneeded).
function backfillSyncStore(tx, storeName) {
    const store = tx.objectStore(storeName);
    if (!store) return;
    return new Promise((resolve) => {
        const req = store.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const v = cursor.value;
                let changed = false;
                if (v && typeof v === 'object') {
                    if (!v.syncId) { v.syncId = newSyncId(); changed = true; }
                    if (!v.updatedAt) { v.updatedAt = newDataTimestamp(); changed = true; }
                }
                if (changed) cursor.update(v);
                cursor.continue();
            } else resolve();
        };
        req.onerror = () => resolve();
    });
}

// بعد backfill، اربط order_items بأبائها عبر orderSyncId (عند توفر orderId → نبحث عن order.syncId من orders الجديد).
async function ensureOrderSyncIds(tx) {
    if (!tx.objectStore.contains || tx.objectStoreNames.contains('order_items')) {
        const orderIdx = {}; // orderId -> syncId
        const orderStore = tx.objectStore('orders');
        await new Promise((resolve) => {
            const req = orderStore.openCursor();
            req.onsuccess = (e) => {
                const c = e.target.result;
                if (c) { if (c.value && c.value.id != null && c.value.syncId) orderIdx[c.value.id] = c.value.syncId; c.continue(); }
                else resolve();
            };
            req.onerror = () => resolve();
        });
        const oiStore = tx.objectStore('order_items');
        await new Promise((resolve) => {
            const req = oiStore.openCursor();
            req.onsuccess = (e) => {
                const c = e.target.result;
                if (c) {
                    const v = c.value;
                    let changed = false;
                    if (v && v.orderId != null && !v.orderSyncId && orderIdx[v.orderId]) {
                        v.orderSyncId = orderIdx[v.orderId]; changed = true;
                    }
                    if (changed) c.update(v);
                    c.continue();
                } else resolve();
            };
            req.onerror = () => resolve();
        });
    }
}


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
                                t.zone = 'داخلي';
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

                // F4: الصندوق النقدي (ورديات الكاش) — سجل الوردية/الصندوق الواحد لكل جهاز
                if (!db.objectStoreNames.contains('cash_registers')) {
                    const crStore = db.createObjectStore('cash_registers', { keyPath: 'id', autoIncrement: true });
                    crStore.createIndex('status', 'status', { unique: false });
                    crStore.createIndex('openedAt', 'openedAt', { unique: false });
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
                // سجل مزامنة (audit للـ sync)
                if (!db.objectStoreNames.contains('sync_log')) {
                    db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
                }
                // صندوق نسخ احتياطي قبل المزامنة
                if (!db.objectStoreNames.contains('sync_backups')) {
                    db.createObjectStore('sync_backups', { keyPath: 'id', autoIncrement: true });
                }
                // دعوات الموظفين (حالة الدعوة محلياً لعرضها في إدارة الموظفين)
                if (!db.objectStoreNames.contains('invitations')) {
                    db.createObjectStore('invitations', { keyPath: 'id' });
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
        // C2: طبقة البيانات تضمن syncId/updatedAt لسجل جديد
        stampSyncRecord(storeName, data, true);
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async put(storeName, data) {
        // C2: طبقة البيانات تضمن updatedAt عند كل تحديث (ولا تُغيّر syncId القائم)
        stampSyncRecord(storeName, data, false);
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

    // C2: backfill بعد الإقلاع — يملأ syncId/updatedAt للسجلات القديمة ويربط order_items بأبائها
    async backfillSyncIds() {
        if (!this.db) return;
        const storeNames = Array.from(this.db.objectStoreNames);
        for (const store of SYNC_STORES) {
            if (storeNames.indexOf(store) === -1) continue;
            try { await this._backfillStoreSync(store); } catch (e) { console.warn('[sync-backfill]', store, e); }
        }
        try { await this._linkOrderItemsToOrders(); } catch (e) { console.warn('[sync-backfill-link]', e); }
    }

    _backfillStoreSync(storeName) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (cur) {
                    const v = cur.value;
                    let changed = false;
                    if (v && typeof v === 'object') {
                        if (!v.syncId) { v.syncId = newSyncId(); changed = true; }
                        if (!v.updatedAt) { v.updatedAt = newDataTimestamp(); changed = true; }
                    }
                    if (changed) cur.update(v);
                    cur.continue();
                } else resolve();
            };
            req.onerror = () => resolve();
            tx.oncomplete = () => resolve();
        });
    }

    _linkOrderItemsToOrders() {
        return new Promise((resolve) => {
            const tx = this.db.transaction(['orders', 'order_items'], 'readwrite');
            const orderMap = {};
            const oStore = tx.objectStore('orders');
            const oReq = oStore.openCursor();
            oReq.onsuccess = (e) => {
                const c = e.target.result;
                if (c) { if (c.value && c.value.id != null && c.value.syncId) orderMap[c.value.id] = c.value.syncId; c.continue(); }
                else {
                    const oiStore = tx.objectStore('order_items');
                    const oiReq = oiStore.openCursor();
                    oiReq.onsuccess = (ev) => {
                        const ci = ev.target.result;
                        if (ci) {
                            const v = ci.value;
                            if (v && v.orderId != null && !v.orderSyncId && orderMap[v.orderId]) {
                                v.orderSyncId = orderMap[v.orderId];
                                ci.update(v);
                            }
                            ci.continue();
                        } else resolve();
                    };
                    oiReq.onerror = () => resolve();
                }
            };
            oReq.onerror = () => resolve();
            tx.oncomplete = () => resolve();
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
    setToken(t) { if (t) sessionStorage.setItem('luccaToken', t); else sessionStorage.removeItem('luccaToken'); },
    // رؤوس المصادقة: توكن الجلسة (إن وُجد) + مفتاح الجهاز احتياطياً
    authHeaders(contentType) {
        const headers = {};
        if (contentType) headers['Content-Type'] = contentType;
        const token = this.getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;
        else headers['x-api-key'] = this.getApiKey();
        return headers;
    },

    // ===== Offline retry queue: يحفظ العمليات الفاشلة (انقطاع الشبكة) ويعيد محاولتها لاحقاً =====
    OFFLINE_KEY: 'lucca_offline_queue',
    MAX_OFFLINE: 200,
    _getOfflineQueue() {
        try { return JSON.parse(localStorage.getItem(this.OFFLINE_KEY) || '[]'); } catch(e) { return []; }
    },
    _setOfflineQueue(q) {
        const trimmed = Array.isArray(q) ? q.slice(-this.MAX_OFFLINE) : [];
        try { localStorage.setItem(this.OFFLINE_KEY, JSON.stringify(trimmed)); } catch(e) {}
    },
    _enqueueOffline(method, path, body) {
        const q = this._getOfflineQueue();
        q.push({ method, path, body, retries: 0, ts: new Date().toISOString() });
        this._setOfflineQueue(q);
        return q.length;
    },
    // يعيد محاولة كل عملية مؤجلة. مكالمة آمنة (لا ترمي) تعمل دون إنترنت.
    async flushOfflineQueue() {
        const q = this._getOfflineQueue();
        if (q.length === 0) return { flushed: 0, remained: 0 };
        const remaining = [];
        let flushed = 0;
        const batch = q.slice(0, 50);
        for (const op of batch) {
            try {
                const headers = this.authHeaders('application/json');
                const res = await fetch(`${this.getBaseUrl()}${op.path}`, {
                    method: op.method, headers, body: op.body ? JSON.stringify(op.body) : undefined
                });
                if (res.ok || res.status === 409 || res.status === 404) {
                    flushed++;
                } else {
                    op.retries = (op.retries || 0) + 1;
                    if (op.retries < 3) remaining.push(op);
                }
            } catch(e) {
                op.retries = (op.retries || 0) + 1;
                if (op.retries < 3) remaining.push(op);
            }
        }
        this._setOfflineQueue(remaining.concat(q.slice(50)));
        return { flushed, remained: remaining.length };
    },

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
            const headers = this.authHeaders('application/json');
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
            // فشل الشبكة (لا استجابة) — احفظ للـ offline queue ثم أعد null (رموز callers fire-and-forget)
            this._enqueueOffline('POST', '/api/' + store, item);
            return null;
        }
    },

    async put(store, id, item) {
        try {
            const headers = this.authHeaders('application/json');
            const res = await fetch(`${this.getBaseUrl()}/api/${store}/${id}`, {
                method: 'PUT', headers, body: JSON.stringify(item)
            });
            return res.ok;
        } catch(e) { this._enqueueOffline('PUT', '/api/' + store + '/' + id, item); return false; }
    },

    async remove(store, id) {
        try {
            const headers = this.authHeaders();
            const res = await fetch(`${this.getBaseUrl()}/api/${store}/${id}`, {
                method: 'DELETE', headers
            });
            return res.ok;
        } catch(e) { this._enqueueOffline('DELETE', '/api/' + store + '/' + id, null); return false; }
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
            const headers = this.authHeaders('application/json');
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
    },

    // استدعاء POST عام على مسار (يحمل رأس المصادقة إن وُجد). يستخدم لمسارات الدعوات/الموظفين المخصّصة.
    async post(path, body) {
        try {
            const headers = this.authHeaders('application/json');
            const res = await fetch(`${this.getBaseUrl()}${path}`, {
                method: 'POST', headers, body: JSON.stringify(body || {})
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok) return json;
            const err = new Error(json.error || 'فشل الطلب');
            err.status = res.status;
            throw err;
        } catch(e) {
            if (e && e.status) throw e;
            throw new Error('تعذر الاتصال بالخادم');
        }
    },

    // استدعاء GET عام على مسار (يحمل رأس المصادقة إن وُجد).
    async get(path) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            const token = this.getToken();
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const res = await fetch(`${this.getBaseUrl()}${path}`, { headers });
            const json = await res.json().catch(() => ({}));
            if (res.ok) return json;
            const err = new Error(json.error || 'فشل الطلب');
            err.status = res.status;
            throw err;
        } catch(e) {
            if (e && e.status) throw e;
            throw new Error('تعذر الاتصال بالخادم');
        }
    }
};

// ==================== إدارة المستخدمين ====================
const Users = {
    async login(username, password) {
        const search = String(username).trim().toLowerCase();
        const users = await db.getAll('users');
        // الدخول بالمستخدم أو البريد الإلكتروني (متوافق مع الخادم: WHERE username = ? OR email = ?)
        const user = users.find(u =>
            (u.username || '').toLowerCase() === search ||
            (u.email || '').toLowerCase() === search
        );
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
            // الهوية الكاملة تُحفظ محلياً (تعمل دون خادم). حقول الهوية (userId/employeeId/email)
            // مصدرها الخادم عند توفره — الخادم هو مصدر الحقيقة، لا نثق بهوية يرسلها العميل للعمليات.
            const safe = {
                id: user.id,
                userId: user.userId != null ? user.userId : user.id,
                employeeId: user.employeeId ?? null,
                email: user.email || null,
                username: user.username,
                name: user.name,
                role: user.role,
                active: user.active !== undefined ? user.active : true
            };
            localStorage.setItem('currentUser', JSON.stringify(safe));
            // الوصول الآمن للخادم: نسجّل دخولنا لدى الخادم للحصول على جلسة تُرفع صلاحيتنا الحقيقية.
            // لا يُعطِّل الدخول المحلي إن لم يصل السيرفر (نسقط إلى مفتاح الجهاز للمزامنة فقط).
            try {
                const url = localStorage.getItem('luccaServerUrl') || 'http://localhost:3000';
                const cr = await fetch(`${url}/api/auth/login`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                    signal: AbortSignal.timeout(4000)
                });
                // الخادم هو مصدر الحقيقة: إن سلّمنا جلسة، نستبدل حقول الهوية النسخة الموثوقة من الخادم.
                if (cr.ok) {
                    const cj = await cr.json();
                    if (cj.token) ServerAPI.setToken(cj.token);
                    const s = cj.user || cj;
                    if (s) {
                        safe.userId = s.userId != null ? s.userId : (s.id != null ? s.id : safe.userId);
                        safe.employeeId = s.employeeId != null ? s.employeeId : safe.employeeId;
                        safe.email = s.email != null ? s.email : safe.email;
                        if (s.username) safe.username = s.username;
                        if (s.role) safe.role = s.role;
                        safe.active = s.active !== undefined ? s.active : safe.active;
                        safe.mustChangePassword = s.mustChangePassword !== undefined ? s.mustChangePassword : false;
                        localStorage.setItem('currentUser', JSON.stringify(safe));
                    }
                }
            } catch(e) { /* السيرفر غير متاح — نكمل بدون جلسة خادم */ }
            return safe;
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
        if (userData.password && !String(userData.password).startsWith('pbkdf2:')) {
            const salt = crypto.randomUUID();
            const hashed = await this.pbkdf2Hash(userData.password, salt);
            if (hashed) userData.password = 'pbkdf2:' + salt + ':' + hashed;
        }
        const maxId = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0);
        userData.id = maxId + 1;
        const id = await db.add('users', userData);
        ServerAPI.add('users', userData).catch(() => {});
        return { ...userData, id };
    },

    async add(userData) {
        const users = await this.getAll();
        const maxId = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0);
        const id = maxId + 1;
        let hashed = null;
        const salt = crypto.randomUUID();
        if (userData.password && !String(userData.password).startsWith('pbkdf2:')) {
            const h = await this.pbkdf2Hash(userData.password, salt);
            if (h) hashed = 'pbkdf2:' + salt + ':' + h;
        }
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
        // إبطال جلسة الخادم إن وُجدت
        try {
            const url = localStorage.getItem('luccaServerUrl') || 'http://localhost:3000';
            const token = ServerAPI.getToken();
            if (token) await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        } catch(e) { /* best-effort */ }
        ServerAPI.setToken(null);
        localStorage.removeItem('currentUser');
        sessionStorage.removeItem('posAdminAuthed');
    },

    getCurrentUser() {
        const user = localStorage.getItem('currentUser');
        return user ? JSON.parse(user) : null;
    },

    // التحقق من دعوة الموظف (قبل التفعيل). عام — لا يتطلب جلسة ولا يعيد أية كلمة مرور/سر.
    async checkInvite(token) {
        if (!token) throw new Error('رمز الدعوة مطلوب');
        const res = await ServerAPI.get(`/api/invitations/${encodeURIComponent(token)}/check`);
        if (!res || res.valid === false) {
            const reason = (res && res.reason) || 'invalid';
            const msg = { not_found: 'رمز الدعوة غير صالح', expired: 'انتهت صلاحية الدعوة', used: 'تم تفعيل هذه الدعوة مسبقاً', revoked: 'تم إلغاء هذه الدعوة' }[reason] || 'رمز الدعوة غير صالح';
            const err = new Error(msg); err.code = reason; throw err;
        }
        return res;
    },

    // تنشيط الحساب: يختار الموظف بريده (يجب أن يطابق الدعوة) وكلمة مروره. الدور/الهوية من الخادم.
    async activateInvite(token, email, password) {
        if (!token || !email || !password) throw new Error('أكمل جميع الحقول');
        if (String(password).length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return ServerAPI.post(`/api/invitations/${encodeURIComponent(token)}/activate`, { email, password });
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
        const expectedZone = (num) => (num <= 7 ? 'خارجي' : 'داخلي');
        if (tables.length === 0) {
            for (let i = 1; i <= 14; i++) {
                const t = { id: i, number: i, status: 'available', capacity: i <= 7 ? 4 : 6, currentOrder: null, zone: expectedZone(i) };
                await db.put('tables', t);
            }
        } else {
            // تطبيع: خارجي 1-7 / داخلي 8+
            let changed = false;
            for (const t of tables) {
                if (t.zone !== expectedZone(t.number)) {
                    t.zone = expectedZone(t.number);
                    await db.put('tables', t);
                    changed = true;
                }
            }
            if (changed) console.log('[Tables] zones normalized: خارجي 1-7 / داخلي 8+');
        }
    },

    async getAll() {
        return db.getAll('tables');
    },

    // Find table by number OR id (handles mismatch after add/delete)
    async _findByRef(ref) {
        const all = await db.getAll('tables');
        const num = parseInt(ref);
        return all.find(t => t.number === num) || all.find(t => t.id === num) || null;
    },

    async add(tableData) {
        const all = await db.getAll('tables');
        const maxId = all.reduce((m, t) => Math.max(m, t.id || 0), 0);
        const table = { id: maxId + 1, number: tableData.number, status: 'available', capacity: tableData.capacity || 4, currentOrder: null, zone: tableData.zone || 'داخلي' };
        await db.put('tables', table);
        ServerAPI.put('tables', table.id, table).catch(() => {});
        return table;
    },

    async remove(id) {
        const table = await this._findByRef(id);
        if(table){
            await db.delete('tables', table.id);
            ServerAPI.delete('tables', table.id).catch(() => {});
        }
    },

    async delete(id) {
        return this.remove(id);
    },

    async update(id, data) {
        const table = await this._findByRef(id);
        if (table) {
            Object.assign(table, data);
            await db.put('tables', table);
            ServerAPI.put('tables', table.id, table).catch(() => {});
        }
        return table;
    },

    async getById(id) {
        return this._findByRef(id);
    },

    async getByNumber(number) {
        const all = await db.getAll('tables');
        return all.find(t => t.number === parseInt(number)) || null;
    },

    async getZones() {
        const all = await db.getAll('tables');
        return [...new Set(all.map(t => t.zone || 'داخلي'))].sort();
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
        // الضريبة ملغاة (قرار الإدارة) — لا تُحتسب منذ الآن
        const tax = 0;
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
        // الضريبة ملغاة (قرار الإدارة) — لا تُحتسب في الإجمالي ولا تُخزَّن في السجل
        order.tax = 0;
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
                const storedOrder = await db.get('orders', id);
                const osId = (storedOrder && storedOrder.syncId) || order.syncId || null;
                for (const item of (order.items || [])) {
                    await db.add('order_items', { orderId: id, orderSyncId: osId, ...item });
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

        // Best-effort: if a cash drawer is open, the sale is auto-recorded into it
        // (aligns Orders.checkout with CashRegister — silent & never blocks checkout).
        const _recordDrawerSale = async () => {
            try {
                if (typeof CashRegister === 'undefined' || !CashRegister.getActiveDrawer || !CashRegister.recordTransaction) return;
                const od = await CashRegister.getActiveDrawer();
                if (od) {
                    const amt = Number(localOrder.total) || Number(localOrder.totalAmount) ||
                        (localOrder.items || []).reduce((s, i) => s + (Number(i.total) || ((Number(i.price) || 0) * (Number(i.quantity) || 1))), 0);
                    await CashRegister.recordTransaction(od.id, 'sale', amt, paymentMethod || 'cash', 'فاتورة#' + localOrder.id);
                }
            } catch (_) {}
        };

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
            await _recordDrawerSale();
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
            orderSyncId: localOrder.syncId,
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
        const _payUser = Users.getCurrentUser && Users.getCurrentUser();
        const payment = {
            orderId: localOrder.id,
            orderSyncId: localOrder.syncId,
            invoiceId,
            amount: total,
            method: paymentMethod || 'cash',
            date: now,
            createdBy: _payUser?.name || 'unknown',
            userId: _payUser?.id != null ? _payUser.id : null
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

        // 4b. Save order_items individually (avoid duplicates: remove existing for this order first)
        try {
            if (db.db.objectStoreNames.contains('order_items')) {
                const allOI = await db.getAll('order_items');
                const existing = allOI.filter(r => String(r.orderId) === String(localOrder.id));
                for (const r of existing) { await db.delete('order_items', r.id); }
                for (const item of (localOrder.items || [])) {
                    await db.add('order_items', { orderId: localOrder.id, orderSyncId: localOrder.syncId, ...item });
                }
            }
        } catch(e) {}

        // 5. Free the table
        if (localOrder.tableId && !isNaN(parseInt(localOrder.tableId))) {
            await Tables.update(parseInt(localOrder.tableId), { status: 'available', currentOrder: null });
        }

        // 6. Sync to server in background
        ServerAPI.checkout(orderId, { paymentMethod: paymentMethod || 'cash' }).catch(() => {});

        await _recordDrawerSale();

        return { ...localOrder, _invoiceId: invoiceId };
    },

    async updateOrder(orderId, updates) {
        const item = await db.get('orders', orderId);
        if (!item) {
            return null;
        }
        if (item.status === 'closed') throw new Error('الطلب مغلق بالفعل');
        const prevTableId = item.tableId;
        Object.assign(item, updates);
        if (updates.items && !updates.subtotal) {
            item.subtotal = updates.items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
            const discount = item.discount || 0;
            const discountAmount = item.subtotal * (discount / 100);
            const afterDiscount = item.subtotal - discountAmount;
            // الضريبة ملغاة (قرار الإدارة)
            item.tax = 0;
            item.total = afterDiscount + item.tax;
        }
        await db.put('orders', item);

        // Table-state sync عند نقل الطلب إلى طاولة أخرى (أو تحريره): نُحدّث الطاولة القديمة
        // (نفرغها إن كان الطلب المفتوح عليها) ونشغّل الطاولة الجديدة بالطلب الحالي.
        if (!isNaN(parseInt(item.tableId)) && item.status === 'pending') {
            const newT = parseInt(item.tableId);
            if (prevTableId != null && String(prevTableId) !== String(newT) && !isNaN(parseInt(prevTableId))) {
                const oldRow = await Tables.getById(parseInt(prevTableId));
                if (oldRow) {
                    const freeOld = oldRow.currentOrder == null || String(oldRow.currentOrder) === String(orderId);
                    await Tables.update(parseInt(prevTableId), { status: freeOld ? 'available' : oldRow.status, currentOrder: freeOld ? null : oldRow.currentOrder });
                }
            }
            await Tables.update(newT, { status: 'occupied', currentOrder: orderId });
        }

        if (updates.items && db.db.objectStoreNames.contains('order_items')) {
            try {
                const allOI = await db.getAll('order_items');
                const existing = allOI.filter(r => r.orderId === orderId);
                for (const r of existing) { await db.delete('order_items', r.id); }
                for (const oi of (updates.items || [])) { await db.add('order_items', { orderId, orderSyncId: item.syncId, ...oi }); }
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
        return orders.filter(o => o.date.startsWith(today) && o.paymentStatus === 'paid');
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
        // تنبيهات المخزون: انخفاض تحت الحد يُنشئ تنبيهاً؛ إعادة التخزين فوق الحد تُحل التنبيهات
        const min = item.minStock != null ? item.minStock : (item.minQuantity || 0);
        if (min > 0) {
            if (item.quantity <= min) {
                InventoryAlerts.raise(item, type || 'adjustment').catch(() => {});
            } else {
                InventoryAlerts.resolveByItem(id, 'restocked').catch(() => {});
            }
        }
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
        // الإسناد التلقائي لمستخدم الجلسة — لا يقبل العمليات أبداً مساهمين من المستخدم مباشرة.
        const cu = Users.getCurrentUser && Users.getCurrentUser();
        p.createdBy = p.createdBy || (cu && cu.name) || 'system';
        p.userId = p.userId != null ? p.userId : (cu && (cu.userId != null ? cu.userId : cu.id)) || null;
        p.employeeId = p.employeeId != null ? p.employeeId : (cu && (cu.employeeId != null ? cu.employeeId : null)) || null;
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

// ==================== تنبيهات المخزون ====================
// تُنشأ لحظة انخفاض كمية صنف إلى ما دون الحد الأدنى (minStock) نتيجة بيع/مصروف/هالك،
// وتُحل تلقائياً عند إعادة التخزين فوق الحد. مخزن متزامن (inventory_alerts).
const InventoryAlerts = {
    _storeName: 'inventory_alerts',

    async getAll() { return db.getAll('inventory_alerts'); },

    async getActive() {
        const all = await this.getAll();
        return all.filter(a => a.status === 'active');
    },

    async countActive() {
        return (await this.getActive()).length;
    },

    // رفع تنبيه لصنف نزل تحت الحد. لا يُكرَّر تنبيه نشط لنفس الصنف والسبب.
    async raise(item, cause) {
        const all = await this.getAll();
        const open = all.find(a => a.status === 'active' && a.ingredientId == item.id && a.cause === (cause || 'sale'));
        if (open) {
            Object.assign(open, { quantity: item.quantity, minStock: item.minStock != null ? item.minStock : (item.minQuantity || 0), updatedAt: new Date().toISOString() });
            await db.put(this._storeName, open);
            return open;
        }
        const alert = {
            syncId: 'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            ingredientId: item.id,
            name: item.name || item.nameAr || '',
            quantity: item.quantity || 0,
            minStock: item.minStock != null ? item.minStock : (item.minQuantity || 0),
            cause: cause || 'sale',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            resolvedAt: null
        };
        const id = await db.add(this._storeName, alert);
        return { ...alert, id };
    },

    // حل تنبيه نشط يدوياً (إداري/مدير).
    async resolve(id, reason) {
        const a = await db.get(this._storeName, id);
        if (a && a.status === 'active') {
            a.status = 'resolved';
            a.resolvedAt = new Date().toISOString();
            if (reason) a.reason = reason;
            a.updatedAt = new Date().toISOString();
            await db.put(this._storeName, a);
        }
        return a;
    },

    // حل كل التنبيهات النشطة لصنف ما عند إعادة تخزينه فوق الحد تلقائياً.
    async resolveByItem(itemId, reason) {
        const all = await this.getAll();
        for (const a of all) {
            if (a.status === 'active' && a.ingredientId == itemId) {
                a.status = 'resolved';
                a.resolvedAt = new Date().toISOString();
                if (reason) a.reason = reason;
                a.updatedAt = new Date().toISOString();
                await db.put(this._storeName, a);
            }
        }
        return true;
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

        // هوية الجلسة فقط — لا قبول معرّف من المستخدم مباشرة (يُستثنى employeeId الاحتياطي).
        const cu = (typeof Users !== 'undefined' && Users.getCurrentUser) ? Users.getCurrentUser() : null;
        const identityName = (cu && (cu.name || cu.username)) || 'system';
        const identityId = (cu && (cu.id != null ? cu.id : cu.userId)) ?? null;

        const drawer = {
            status: 'open',
            startingCash: Number(startingCash) || 0,
            currentCash: Number(startingCash) || 0,
            openingCash: Number(startingCash) || 0,
            employeeId: (typeof Users !== 'undefined' && Users.getCurrentUser) ? (cu && (cu.employeeId != null ? cu.employeeId : identityId)) || null : (employeeId || null),
            openedBy: identityName,
            openedByUser: identityId,
            closedBy: null,
            closedByUser: null,
            openedAt: new Date().toISOString(),
            closedAt: null,
            closingCash: null,
            expectedCash: Number(startingCash) || 0,
            difference: 0,
            differenceType: 'balanced',
            totalCashSales: 0,
            totalCardSales: 0,
            totalWalletSales: 0,
            totalExpenses: 0,
            totalRefunds: 0,
            transactionCount: 0,
            version: 1,
            notes: notes || ''
        };
        drawer.id = await db.add(this._storeName, drawer);
        try {
            if (typeof AuditLogs !== 'undefined' && AuditLogs.log) {
                await AuditLogs.log('shift.open', this._storeName, drawer.id, null,
                    { openingCash: drawer.openingCash, openedBy: drawer.openedBy, shiftId: drawer.id }, identityName);
            }
        } catch (_) {}
        return { drawer };
    },

    async closeDrawer(closingCash, notes) {
        const drawer = await this.getActiveDrawer();
        if(!drawer) return { error: 'لا يوجد صندوق مفتوح' };

        // F4: منع إغلاق وردية مغلقة أصلاً
        if (drawer.status === 'closed') return { error: 'الصندوق مغلق بالفعل!' };
        const cu = (typeof Users !== 'undefined' && Users.getCurrentUser) ? Users.getCurrentUser() : null;
        const identityName = (cu && (cu.name || cu.username)) || 'system';
        const identityId = (cu && (cu.id != null ? cu.id : cu.userId)) ?? null;

        drawer.status = 'closed';
        drawer.closingCash = Number(closingCash) || 0;
        drawer.closedAt = new Date().toISOString();
        drawer.closedBy = identityName;
        drawer.closedByUser = identityId;
        // يعاد حساب المتوقع من الأرقام الحيّة للوردية — لا يتم ضبط مبيعات/مصروفات للموازنة
        drawer.expectedCash = Number(drawer.openingCash || drawer.startingCash || 0)
            + (Number(drawer.totalCashSales) || 0)
            - (Number(drawer.totalExpenses) || 0)
            - (Number(drawer.totalRefunds) || 0);
        drawer.difference = (Number(drawer.closingCash) || 0) - drawer.expectedCash;
        drawer.differenceType = drawer.difference > 0 ? 'overage' : (drawer.difference < 0 ? 'shortage' : 'balanced');
        drawer.version = (Number(drawer.version) || 1) + 1;
        if(notes) drawer.notes = (drawer.notes || '') + '\n' + notes;
        await db.put(this._storeName, drawer);
        try {
            if (typeof AuditLogs !== 'undefined' && AuditLogs.log) {
                await AuditLogs.log('shift.close', this._storeName, drawer.id, null,
                    { shiftId: drawer.id, openingCash: drawer.openingCash, expectedCash: drawer.expectedCash,
                      actualCash: drawer.closingCash, difference: drawer.difference, closedBy: drawer.closedBy }, identityName);
            }
        } catch (_) {}
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
        const m = String(method || '').toLowerCase();

        if(type === 'sale'){
            if(m === 'cash' || m === 'كاش' || m === 'نقدي'){
                drawer.totalCashSales += amount;
                drawer.currentCash += amount;
            } else if(m === 'wallet' || m === 'محفظة' || m === 'digital'){
                drawer.totalWalletSales = (drawer.totalWalletSales || 0) + amount;
            } else {
                drawer.totalCardSales += amount;
            }
        } else if(type === 'expense'){
            drawer.totalExpenses += amount;
            drawer.currentCash -= amount;
        } else if(type === 'refund'){
            drawer.totalRefunds = (drawer.totalRefunds || 0) + amount;
            if(m === 'cash' || m === 'كاش' || m === 'نقدي'){
                drawer.currentCash -= amount;
            }
        }

        drawer.expectedCash = (Number(drawer.openingCash || drawer.startingCash) || 0)
            + (Number(drawer.totalCashSales) || 0)
            - (Number(drawer.totalExpenses) || 0)
            - (Number(drawer.totalRefunds) || 0);
        drawer.version = (Number(drawer.version) || 1) + 1;
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
    },

    // F4: تقرير الإقفال اليومي — يعيد استخدام تعريف إيراد H5 (المدفوع - الاستردادات)
    // ومصدر الأصناف الأكثر مبيعاً من order_items المدفوعة، مع بيانات ورديات الصندوق.
    async getDailyClosingReport(dateStr) {
        const day = dateStr || new Date().toISOString().slice(0, 10);
        const drawers = await db.getAll(this._storeName);
        const dayDrawers = drawers.filter(d => {
            const d1 = (d.openedAt || '').slice(0, 10);
            const d2 = (d.closedAt || '').slice(0, 10);
            return d1 === day || d2 === day;
        });

        const allOrders = await db.getAll('orders');
        const paidOrders = allOrders.filter(o => String(o.paymentStatus || '').toLowerCase() === 'paid'
            && (o.date || o.createdAt || '').slice(0, 10) === day);
        let revenue = 0;
        paidOrders.forEach(o => { revenue += Number(o.total) || 0; });

        const allRefunds = await db.getAll('refunds');
        const dayRefunds = allRefunds.filter(r => (r.createdAt || r.updatedAt || r.date || '').slice(0, 10) === day);
        let refundTotal = 0;
        dayRefunds.forEach(r => { refundTotal += Number(r.amount) || 0; });
        const netRevenue = revenue - refundTotal;

        const orderIds = new Set(paidOrders.map(o => o.id));
        const allItems = await db.getAll('order_items');
        const itemCount = {};
        const itemRevenue = {};
        allItems.forEach(it => {
            if (!orderIds.has(it.orderId)) return;
            const name = it.name || 'غير محدد';
            itemCount[name] = (itemCount[name] || 0) + (Number(it.quantity) || 0);
            itemRevenue[name] = (itemRevenue[name] || 0) + (Number(it.total) || Number(it.quantity || 0) * (Number(it.price || it.unitPrice) || 0) || 0);
        });
        const topItems = Object.keys(itemCount).map(name => ({
            name, quantity: itemCount[name], revenue: itemRevenue[name]
        })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

        let totalCash = 0, totalCard = 0, totalWallet = 0, totalExp = 0, totalRef = 0;
        dayDrawers.forEach(d => {
            totalCash += Number(d.totalCashSales) || 0;
            totalCard += Number(d.totalCardSales) || 0;
            totalWallet += Number(d.totalWalletSales) || 0;
            totalExp += Number(d.totalExpenses) || 0;
            totalRef += Number(d.totalRefunds) || 0;
        });

        return {
            date: day,
            drawers: dayDrawers.map(d => ({
                id: d.id, syncId: d.syncId, status: d.status,
                openedBy: d.openedBy, closedBy: d.closedBy,
                openedAt: d.openedAt, closedAt: d.closedAt,
                openingCash: Number(d.openingCash || d.startingCash) || 0,
                expectedCash: Number(d.expectedCash) || 0,
                actualCash: Number(d.closingCash) || 0,
                difference: Number(d.difference) || 0,
                differenceType: d.differenceType || 'balanced',
                totalCashSales: Number(d.totalCashSales) || 0,
                totalCardSales: Number(d.totalCardSales) || 0,
                totalWalletSales: Number(d.totalWalletSales) || 0,
                totalExpenses: Number(d.totalExpenses) || 0,
                totalRefunds: Number(d.totalRefunds) || 0,
                transactionCount: d.transactionCount || 0
            })),
            revenue, refunds: refundTotal, netRevenue,
            totals: { cash: totalCash, card: totalCard, wallet: totalWallet, expenses: totalExp, refunds: totalRef },
            topItems
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
    },

    // إنشاء دعوة لموظف بالبريد (إداري/مدير). الخادم ينشئ الموظف + حساباً غير مفعّل + رمز دعوة.
    // الدور يُحدَّد بالنظام (داخل الدعوة) لا باختيار الموظف.
    async invite(payload) {
        let res;
        try {
            res = await ServerAPI.post('/api/employees/invite', payload);
        } catch (e) {
            // الخادم غير متاح (وضع منفصل/أوفلاين): نُنشئ الموظف محلياً فقط حتى لا تفشل الإضافة،
            // ونعيد علامة local ليُرافقها المتصل برسالة واضحة (الدعوة تتطلب تشغيل الخادم لاحقاً).
            const local = {
                name: payload.name,
                email: payload.email || null,
                employeeCode: payload.employeeCode || null,
                phone: payload.phone || '',
                role: payload.role || 'cashier',
                salary: payload.salary || 0,
                active: true,
                createdAt: new Date().toISOString()
            };
            await db.add('employees', local);
            return { local: true, name: payload.name };
        }
        if (!res || !res.inviteToken) throw new Error('لم يتم إنشاء الدعوة');
        // نسجّل الدعوة محلياً لعرض حالتها (Pending/Activated/Expired) في إدارة الموظفين.
        try {
            const existing = await db.get('invitations', res.inviteId);
            await db.put('invitations', {
                id: res.inviteId,
                token: res.inviteToken,
                email: res.email,
                name: res.name,
                role: res.role,
                employeeId: res.employeeId,
                status: 'pending',
                expiresAt: res.expiresAt,
                createdBy: Users.getCurrentUser()?.userId ?? null,
                createdAt: new Date().toISOString()
            });
        } catch (e) { /* تجاهل فشل التخزين المحلي */ }
        return res;
    },

    // تعطيل/إعادة تفعيل الموظف وكل حساب مستخدم مرتبط به (نقطة نهاية مخصّصة آمنة — ليست sync).
    async setStatus(id, active) {
        const res = await ServerAPI.post(`/api/employees/${Number(id)}/status`, { active: !!active });
        // نحدّث النسخة المحلية لتعكس الحالة الجديدة.
        try {
            const emp = await db.get('employees', Number(id));
            if (emp) { emp.active = active ? 1 : 0; await db.put('employees', emp); }
        } catch (e) { /* تجاهل */ }
        return res;
    },

    // حالة دعوة الموظف من السجل المحلي (إن وُجد) — Pending/Activated/Expired.
    async getInviteStatus(employeeId) {
        try {
            const all = await db.getAll('invitations');
            const inv = all.find(i => String(i.employeeId) === String(employeeId));
            if (!inv) return null;
            if (inv.status === 'used') return 'used';
            if (new Date(inv.expiresAt).getTime() < Date.now()) return 'expired';
            return 'pending';
        } catch (e) { return null; }
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
        const cu = Users.getCurrentUser && Users.getCurrentUser();
        expense.date = expense.date || new Date().toISOString();
        expense.createdAt = new Date().toISOString();
        expense.createdBy = expense.createdBy || (cu && cu.name) || 'system';
        expense.userId = expense.userId != null ? expense.userId : (cu && (cu.userId != null ? cu.userId : cu.id)) || null;
        expense.employeeId = expense.employeeId != null ? expense.employeeId : (cu && (cu.employeeId != null ? cu.employeeId : null)) || null;
        let id;
        // سندفع للخادم فقط أعمدة موجودة فعلاً في جدول expenses (يمنع فشل إدراج بسبب أعمدة محلية إضافية).
        const serverPayload = { description: expense.description, category: expense.category, amount: expense.amount, notes: expense.notes, date: expense.date, createdBy: expense.createdBy };
        const serverResult = await ServerAPI.add('expenses', serverPayload);
        if (serverResult && serverResult.id) {
            await db.put('expenses', { ...expense, id: serverResult.id });
            id = serverResult.id;
        } else {
            id = await db.add('expenses', expense);
        }
        // Record cash-drawer expense so reconciliation stays correct (never double-counted:
        // expenses are recorded only once here, regardless of payment method).
        try {
            const drawer = await CashRegister.getActiveDrawer();
            if (drawer) {
                await CashRegister.recordTransaction(drawer.id, 'expense', parseFloat(expense.amount || 0), expense.paymentMethod || 'cash', expense.description || 'مصروف');
            }
        } catch (e) { console.warn('[Expenses] drawer expense', e); }
        // Audit trail: no silent financial ops.
        try {
            await AuditLogs.log('expense.create', 'expenses', id, null, { amount: expense.amount, category: expense.category, supplier: expense.supplierId || expense.supplier || '', paymentMethod: expense.paymentMethod || 'cash', description: expense.description }, (cu && cu.name) || 'system');
        } catch (e) { console.warn('[Expenses] audit', e); }
        return id;
    },

    async update(id, data) {
        const item = await db.get('expenses', id);
        if (item) {
            Object.assign(item, data);
            await db.put('expenses', item);
            ServerAPI.put('expenses', id, { description: item.description, category: item.category, amount: item.amount, notes: item.notes, date: item.date, createdBy: item.createdBy }).catch(() => {});
        }
        return item;
    },

    async delete(id) {
        const cu = Users.getCurrentUser && Users.getCurrentUser();
        const existing = await db.get('expenses', id);
        await db.delete('expenses', id);
        ServerAPI.remove('expenses', id).catch(() => {});
        try {
            await AuditLogs.log('expense.delete', 'expenses', id, existing ? { amount: existing.amount, category: existing.category } : null, null, (cu && cu.name) || 'system');
        } catch (e) { console.warn('[Expenses] audit', e); }
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

    async start(employeeId, notes = '', options = {}) {
        const today = new Date().toISOString().split('T')[0];
        const existing = await this.getByEmployeeAndDate(employeeId, today);
        if (existing) throw new Error('تم تسجيل شيفت للموظف اليوم');
        const shift = {
            employeeId,
            date: today,
            startTime: new Date().toISOString(),
            endTime: null,
            notes,
            shiftType: options.shiftType || null,
            label: options.label || null,
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

// ===== مطابقة الوردية اليومية (Shift Reconciliation) =====
// فتح الوردية بفتح النقد + إغلاقها بالنقد المُحصى فعلياً + حساب الفرق (تقرير منفصل).
// يستخدم جدول السيرفر daily_shifts (إداري/مدير فقط) لحفظ الحالة والفرق.
const DailyShifts = {
    _storeName: 'daily_shifts',

    // قراءة كل الوديات اليومية (مسار مخصص، إداري/مدير فقط).
    async getAll() {
        const d = await ServerAPI.get('/api/daily-shifts');
        return Array.isArray(d) ? d : [];
    },

    async getOpen() {
        const all = await this.getAll();
        const today = new Date().toISOString().slice(0, 10);
        return all.find(s => s.status === 'open' && s.date === today) || null;
    },

    // فتح الوردية: يسجّل رصيد الافتتاح (النقد المُسلّم عند بدء الوردية).
    async open(openingCash = 0, notes = '') {
        const existing = await this.getOpen();
        if (existing) return { error: 'توجد وردية مفتوحة بالفعل', shift: existing };
        const today = new Date().toISOString().slice(0, 10);
        const payload = {
            date: today,
            openingBalance: Number(openingCash) || 0,
            status: 'open',
            openedAt: new Date().toISOString(),
            closedAt: null,
            actualCash: null,
            expectedCash: null,
            difference: null,
            cashSales: 0,
            cardSales: 0,
            totalSales: 0,
            totalExpenses: 0,
            orderCount: 0,
            notes: notes || ''
        };
        const res = await ServerAPI.post('/api/daily-shifts', payload);
        const shift = res && res.date ? res : payload;
        this._current = shift;
        return { shift };
    },

    // ربط البيع/المصروف بالوردية المفتوحة (حالة غير متصلة تُحدّث محلياً ثم تُرسل عند الاتصال).
    async record(type, amount, method = '') {
        let shift = this._current || await this.getOpen();
        if (!shift) return { error: 'لا توجد وردية مفتوحة' };
        amount = Number(amount) || 0;
        const updated = { ...shift };
        if (type === 'sale') {
            const isCash = (method === 'cash' || method === 'كاش');
            updated.cashSales = (updated.cashSales || 0) + (isCash ? amount : 0);
            updated.cardSales = (updated.cardSales || 0) + (isCash ? 0 : amount);
            updated.totalSales = (updated.totalSales || 0) + amount;
            updated.orderCount = (updated.orderCount || 0) + 1;
        } else if (type === 'expense') {
            updated.totalExpenses = (updated.totalExpenses || 0) + amount;
        }
        this._current = updated;
        if (shift.date) ServerAPI.put('/api/daily-shifts/' + shift.date, updated).catch(() => {});
        return { shift: updated };
    },

    // إغلاق الوردية: يتلقّى النقد المُحصى فعلياً ويحسب المتوقع والفرق.
    // المتوقع = رصيد الافتتاح + مبيعات الكاش − المصروفات النقدية.
    async close(actualCash = 0) {
        let shift = this._current || await this.getOpen();
        if (!shift) return { error: 'لا توجد وردية مفتوحة' };
        actualCash = Number(actualCash) || 0;
        const expected = (shift.openingBalance || 0) + (shift.cashSales || 0) - (shift.totalExpenses || 0);
        const difference = actualCash - expected;
        const closed = {
            ...shift,
            status: 'closed',
            actualCash,
            expectedCash: expected,
            difference,
            closedAt: new Date().toISOString()
        };
        this._current = null;
        if (shift.date) await ServerAPI.put('/api/daily-shifts/' + shift.date, closed);
        return { shift: closed };
    },

    // تقرير منفصل بالوديات المُغلقة وفرقها (المتوقع مقابل المُحصى).
    async getReconciliations(before = null) {
        const all = await this.getAll();
        const closed = all.filter(s => s.status === 'closed');
        closed.sort((a, b) => ((b.closedAt || b.date) || '').localeCompare((a.closedAt || a.date) || ''));
        if (before) return closed.filter(s => (s.closedAt || s.date) <= before);
        return closed;
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
            invoices: await db.getAll('invoices'),
            order_items: await db.getAll('order_items'),
            suppliers: await db.getAll('suppliers'),
            stock_movements: await db.getAll('stock_movements'),
            product_recipes: await db.getAll('product_recipes'),
            waste_log: await db.getAll('waste_log'),
            knowledge_documents: await db.getAll('knowledge_documents'),
            knowledge_chunks: await db.getAll('knowledge_chunks'),
            exportDate: new Date().toISOString()
        };
        return JSON.stringify(data, null, 2);
    },

    async importAll(jsonString) {
        const data = JSON.parse(jsonString);
        const stores = ['users', 'tables', 'customers', 'orders', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'categories', 'products', 'product_modifiers', 'product_variations', 'payment_methods', 'taxes', 'payments', 'refunds', 'audit_logs', 'order_status_history', 'discounts', 'settings', 'invoices', 'order_items', 'suppliers', 'stock_movements', 'product_recipes', 'waste_log', 'knowledge_documents', 'knowledge_chunks'];
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

    // ===== أدوات Safe Sync المحلية (مطابقة لـ safe-sync-engine في الاختبارات) =====

    // مقارنة "نفس البيانات" من منظور السجل الوارد فقط (b=الواردة من السيرفر، a=المحلي)
    // السجل المحلي/السيرفر قد يحملان أعمدة default إضافية لا يرسلها الآخر — نقارن حقول الوارد فقط.
    _sameData(a, b) {
        const skip = { id: 1, syncId: 1, updatedAt: 1, updated_at: 1, revision: 1, version: 1 };
        for (const k of Object.keys(b || {})) {
            if (skip[k]) continue;
            const bv = b[k];
            const av = a ? a[k] : undefined;
            const n = (x) => (x && typeof x === 'object') ? JSON.stringify(x) : String((x == null ? '' : x));
            if (n(bv) !== n(av)) return false;
        }
        return true;
    },

    // نافذة غموض: لا نعتمد على Date.now() وحده، أي فرق أصغر منه غير موثوق
    AMBIGUITY_MS: 5000,
    _newestLocal(localRow, serverRow) {
        const lv = localRow && (localRow.version != null ? localRow.version : localRow.revision);
        const sv = serverRow && (serverRow.version != null ? serverRow.version : serverRow.revision);
        if (lv != null && sv != null && lv !== sv) return lv > sv ? 'local' : 'server';
        const lt = localRow && (localRow.updatedAt || localRow.updated_at);
        const st = serverRow && (serverRow.updatedAt || serverRow.updated_at);
        if (lt && st) {
            const a = new Date(st).getTime(), b = new Date(lt).getTime();
            if (!Number.isNaN(a) && !Number.isNaN(b)) {
                const d = b - a;
                if (Math.abs(d) >= this.AMBIGUITY_MS) return d > 0 ? 'local' : 'server';
            }
        }
        if (st && !lt) return 'server';
        if (lt && !st) return 'local';
        return null;
    },

    // دمج local/single في اتجاه pull: لا حذف، لا استبدال أعمى.
    _mergeOne(localRow, serverRow) {
        if (!localRow) return { action: 'insert', item: serverRow };
        if (this._sameData(localRow, serverRow)) return { action: 'skip', item: localRow };
        const win = this._newestLocal(localRow, serverRow);
        if (win === 'server') return { action: 'update', item: serverRow };
        if (win === 'local') return { action: 'skip', item: localRow };
        return { action: 'conflict', server: serverRow, local: localRow };
    },

    // نسخة احتياطية قبل أي عملية sync (تُخزَّن سجل في sync_backups)
    async _preSyncBackup() {
        try {
            const json = await DataSync.exportAll();
            const rec = { createdAt: new Date().toISOString(), data: json };
            await db.add('sync_backups', rec);
            return rec.id;
        } catch (e) {
            console.warn('[sync-backup]', e);
            return null;
        }
    },

    // تسجيل سجل المزامنة في sync_log
    async _logSync(direction, result) {
        try {
            await db.add('sync_log', {
                direction: direction || 'unknown',
                startedAt: result.startedAt || new Date().toISOString(),
                inserted: result.inserted || 0,
                updated: result.updated || 0,
                skipped: result.skipped || 0,
                conflicts: result.conflicts || 0,
                errors: result.errors || 0,
                conflictDetail: result.conflictDetail || [],
                note: result.message || ''
            });
        } catch (e) { /* silent */ }
    },

    // جمع ملفات للرفع (كل مخازن المزامنة)
    async _collectAllData() {
        const data = {};
        for (const s of SYNC_STORES) {
            try { data[s] = await db.getAll(s); } catch (e) { data[s] = []; }
        }
        data.settings = await db.getAll('settings');
        return data;
    },

    async pushAll() {
        const url = this.getServerUrl();
        const apiKey = localStorage.getItem('luccaApiKey') || '';
        const result = { startedAt: new Date().toISOString(), inserted: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0, conflictDetail: [] };
        try {
            // 1) نسخة احتياطية قبل المزامنة
            await this._preSyncBackup();
            // 2) جمع البيانات المحلية
            const data = await this._collectAllData();
            // 3) إرسال — السيرفر ينفذ Safe Sync (لا DELETE). نرسل أيضاً النسخة المحلية للمقارنة.
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(`${url}/api/sync`, {
                method: 'POST',
                headers: ServerAPI.authHeaders('application/json'),
                body: JSON.stringify(data),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                result.errors++;
                result.message = body.message || 'فشل رفع البيانات';
                await this._logSync('push', result);
                return { success: false, message: result.message };
            }
            const parsed = await res.json().catch(() => ({}));
            if (parsed.log) {
                result.inserted = parsed.log.inserted || 0;
                result.updated = parsed.log.updated || 0;
                result.skipped = parsed.log.skipped || 0;
                result.conflicts = parsed.log.conflicts || 0;
                result.conflictDetail = parsed.log.conflictDetail || [];
                // السيرفر يُسجّل أخطاء الكتابة (فشل إدراج/تحديث) مع رسالة السبب — نميّزها عن التعارضات العادية.
                const writeFailures = (result.conflictDetail || []).filter(
                    d => d && d.reason && (/فشل إدراج|فشل تحديث/.test(d.reason))
                );
                result.errors = (result.errors || 0) + writeFailures.length;
            }
            result.message = (result.errors > 0)
                ? ('⚠️ تم الرفع مع ' + result.errors + ' خطأ كتابة — راجع sync_log')
                : '✅ تم رفع البيانات للسيرفر (دمج آمن)';
            await this._logSync('push', result);
            return { success: result.errors === 0, message: result.message, result };
        } catch (e) {
            result.errors++;
            result.message = '❌ فشل الاتصال بالسيرفر: ' + e.message;
            await this._logSync('push', result);
            return { success: false, message: result.message, result };
        }
    },

    async pullAll() {
        const url = this.getServerUrl();
        const apiKey = localStorage.getItem('luccaApiKey') || '';
        const result = { startedAt: new Date().toISOString(), inserted: 0, updated: 0, skipped: 0, conflicts: 0, errors: 0, conflictDetail: [] };
        try {
            // نسخة احتياطية قبل أي pull
            await this._preSyncBackup();
            // نسجل أيضاً نسخة محلية مضمّنة داخل sync_log (إشارة قبل الدمج)
            const collections = SYNC_STORES.concat('settings');
            for (const col of collections) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                const res = await fetch(`${url}/api/${col}`, {
                    headers: ServerAPI.authHeaders(),
                    signal: controller.signal
                });
                clearTimeout(timer);
                if (!res.ok) { continue; }
                const serverItems = (await res.json().catch(() => [])) || [];
                if (!Array.isArray(serverItems)) continue;
                const localItems = await db.getAll(col);
                // MERGE لا REPLACE: لا نمسح IndexedDB أبداً
                const bySync = {};
                for (const li of localItems) { if (li && li.syncId) bySync[li.syncId] = li; }
                for (const si of serverItems) {
                    if (!si || !si.syncId) { continue; }
                    const localRow = bySync[si.syncId];
                    const res2 = this._mergeOne(localRow, si);
                    if (res2.action === 'insert') {
                        const applied = await this._applyLocal(col, si, 'insert');
                        if (applied.ok) { result.inserted++; }
                        else { result.errors++; result.conflictDetail.push({ syncId: si.syncId, reason: 'فشل إدراج محلي: ' + applied.error, collection: col }); }
                    }
                    else if (res2.action === 'update') {
                        const applied = await this._applyLocal(col, si, 'update');
                        if (applied.ok) { result.updated++; }
                        else { result.errors++; result.conflictDetail.push({ syncId: si.syncId, reason: 'فشل تحديث محلي: ' + applied.error, collection: col }); }
                    }
                    else if (res2.action === 'skip') { result.skipped++; }
                    else if (res2.action === 'conflict') {
                        result.conflicts++;
                        result.conflictDetail.push({ syncId: si.syncId, reason: 'تعارض بلا نسخة أحدث موثوقة', server: si, local: localRow });
                    }
                }
            }
            result.message = (result.errors > 0)
                ? ('⚠️ تم التحميل من السيرفر مع ' + result.errors + ' خطأ — راجع sync_log')
                : '✅ تم تحميل البيانات من السيرفر (دمج لا مسح)';
            await this._logSync('pull', result);
            return { success: result.errors === 0, message: result.message, result };
        } catch (e) {
            result.errors++;
            result.message = '❌ فشل الاتصال بالسيرفر: ' + e.message;
            await this._logSync('pull', result);
            return { success: false, message: result.message, result };
        }
    },

    // كتابة دمج محلية آمنة لعمليات pull:
    //  - insert: نستبعد id الرقمي للسيرفر (قد يتعارض مع id محلي مختلف) ونترك IndexedDB يمنح id محلياً جديداً،
    //            مع الحفاظ على syncId/orderSyncId (الهوية المستقرة) وإعادة ربط الأبوين عبر syncId.
    //  - update: نحافظ على id المحلي (مفتاح autoincrement) ونمرر حقول السيرفر فوقه.
    // يُعيد { ok: true } عند النجاح، أو { ok: false, error } عند الفشل — لا يُبتلع الخطأ بصمت.
    async _applyLocal(col, item, kind) {
        try {
            const copy = Object.assign({}, item);
            if (kind !== 'update') {
                // إدراج جديد: لا نأخذ id السيرفر أبداً
                delete copy.id;
                // إعادة ربط الأبوين بالمعرّفات المحلية عبر syncId (عند نشوئها محلياً لأول مرة)
                const parentLink = this._parentLinkMap[col];
                if (parentLink) {
                    const parentCol = parentLink.parentStore;
                    const parentSync = copy[parentLink.syncField];
                    if (parentSync) {
                        const localParent = await this._localBySyncId(parentCol, parentSync);
                        if (localParent && localParent.id != null) copy[parentLink.fkField] = localParent.id;
                    }
                }
                await db.add(col, copy);
            } else {
                // تحديث: نحتفظ بمعرّف السجل المحلي الموجود
                if (copy.id == null) {
                    const local = await this._localBySyncId(col, item.syncId);
                    if (local) copy.id = local.id;
                }
                await db.put(col, copy);
            }
            return { ok: true };
        } catch (e) {
            // PT-applyLocal: لا نبتلع الخطأ بصمت — نسجّل المجموعة + syncId + السبب ونخبر المتصل بالفشل.
            const reason = e && e.message ? e.message : String(e);
            console.error('[sync-applyLocal] فشل', col, (item && item.syncId), reason);
            return { ok: false, error: reason };
        }
    },

    // خريطة علاقات الأبوين لإعادة ربط المفاتيح الخارجية عند الإدراج عبر المزامنة
    _parentLinkMap: {
        'order_items': { parentStore: 'orders', syncField: 'orderSyncId', fkField: 'orderId' },
        'payments': { parentStore: 'orders', syncField: 'orderSyncId', fkField: 'orderId' },
        'refunds': { parentStore: 'orders', syncField: 'orderSyncId', fkField: 'orderId' },
        'invoices': { parentStore: 'orders', syncField: 'orderSyncId', fkField: 'orderId' },
        'order_status_history': { parentStore: 'orders', syncField: 'orderSyncId', fkField: 'orderId' }
    },

    async _localBySyncId(col, syncId) {
        if (!syncId) return null;
        try {
            const all = await db.getAll(col);
            for (const r of all) { if (r && r.syncId === syncId) return r; }
        } catch (e) { }
        return null;
    },

    async testConnection() {
        const url = this.getServerUrl();
        const apiKey = localStorage.getItem('luccaApiKey') || '';
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

    // C2: بعد فتح قاعدة البيانات نسند syncId/updatedAt للسجلات القديمة ونربط order_items بأبائها
    try { await db.backfillSyncIds(); } catch(e) { console.warn('[sync-backfill]', e); }

    await Tables.init();
    await Users.createDefaultAdmin();
    await seedDefaultPaymentMethods();
    if (typeof menuData !== 'undefined' && Array.isArray(menuData) && menuData.length) {
        await MenuSync.syncFromMenuData(menuData);
    }

    // C2: مزامنة آمنة (Safe Sync) — لا مسح، دمج فقط.
    setTimeout(async () => {
        try {
            await ServerSync.pushAll();
        } catch(e) {}
        try {
            await ServerSync.pullAll();
        } catch(e) {}
    }, 500);

}

async function seedDefaultPaymentMethods() {
    try {
        const existing = await db.getAll('payment_methods');
        if (existing && existing.length > 0) return;
        const defaults = [
            { name_ar: 'كاش', name_en: 'cash', type: 'cash', icon: '💵', active: 1, sortOrder: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { name_ar: 'فيزا', name_en: 'card', type: 'card', icon: '💳', active: 1, sortOrder: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { name_ar: 'تحويل بنكي', name_en: 'transfer', type: 'bank', icon: '🏦', active: 1, sortOrder: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        ];
        for (const m of defaults) {
            // name مطلوب بالسيرفر (NOT NULL) — بخلافه يرفض INSERT كل sync لطرق الدفع
            await db.add('payment_methods', Object.assign({ name: m.name_ar }, m));
        }
    } catch(e) {}
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
window.LuccaDB = { db, Users, Tables, Orders, Customers, Settings, Inventory, Purchases, Employees, Attendance, Expenses, Shifts, DailyShifts, MenuSync, DataSync, ServerSync, PaymentMethods, Categories, Products, ProductModifiers, ProductVariations, Taxes, AuditLogs, OrderStatusHistory, BotMemory, KnowledgeBase, Suppliers, StockMovements, InventoryAlerts, ProductRecipes, WasteLog, CustomerLoyalty, CashRegister, ExpenseCategories, TableReservations, initSystem };

// ===== SYNC INTEGRATION =====
// When Supabase is available, enable auto-sync
window.LuccaDB.enableSync = function(supabaseClient, options){
    if(!window.SyncEngine) return;
    // Wrap DB operations to auto-enqueue
    window.SyncEngine.wrapDBOperations(db, supabaseClient);
    // Start auto sync
    const result = window.SyncEngine.startAutoSync(supabaseClient, db, {
        interval: (options && options.interval) || 30000,
        onStatusChange: (options && options.onStatusChange) || null
    });
    return result;
};

window.LuccaDB.getSyncStatus = function(){
    if(!window.SyncEngine) return null;
    return window.SyncEngine.getSyncStatus();
};

window.LuccaDB.triggerSync = function(){
    if(!window.SyncEngine) return Promise.resolve(null);
    return window.SyncEngine.triggerSync();
};

// تصدير تفريغ الـ offline queue يدوياً (زر "مزامنة الآن") ولأغراض التحقق.
window.LuccaDB.flushOfflineQueue = function(){
    return ServerAPI.flushOfflineQueue();
};

// ===== مزامنة ودّمم الـ offline queue عند التشغيل =====
(function bootSync(){
    // إعادة محاولة العمليات المؤجلة (انقطاعات سابقة) فوراً وبشكل دوري عند عودة الشبكة.
    const flushAll = () => { ServerAPI.flushOfflineQueue().catch(() => {}); };
    setTimeout(flushAll, 1500);
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('online', () => { setTimeout(flushAll, 1000); });
        // عند اتصال Supabase (إن وُجد) يُفعَّل التغليف والمزامنة التلقائية.
        window.addEventListener('lucca:sync-available', () => {
            window.LuccaDB.enableSync(window.LuccaDB._supabaseClient || null, { interval: 30000 });
        });
    }
})();
