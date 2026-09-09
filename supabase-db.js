/**
 * LUCCA POS — Supabase Database Adapter
 * Drop-in replacement for admin/database.js (IndexedDB)
 * Only activates when Supabase SDK is loaded (online)
 * Falls back to IndexedDB when offline
 */
(function() {
  if (!window.supabase) {
    return;
  }

  const SUPABASE_URL = 'https://uudimvcdkaacqaxgajbk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1ZGltdmNka2FhY3FheGdhamJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzQ4MTYsImV4cCI6MjEwMjgxMDgxNn0.WrwCUlqWW2ib7D8T41DNzUbybo4FHnNQ1AIBTZr2ZlM';

  const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function toSnake(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(toSnake);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const sk = k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
      if (Array.isArray(v) || (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof RegExp))) {
        out[sk] = JSON.stringify(v);
      } else {
        out[sk] = v;
      }
    }
    return out;
  }

  function toCamel(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(toCamel);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (typeof v === 'string' && v.length > 1 && ((v[0] === '[' && v[v.length-1] === ']') || (v[0] === '{' && v[v.length-1] === '}'))) {
        try { out[ck] = JSON.parse(v); } catch(e) { out[ck] = v; }
      } else {
        out[ck] = (v && typeof v === 'object' && !Array.isArray(v)) ? toCamel(v) : v;
      }
    }
    return out;
  }

  const _db = {
    async getAll(table) {
      const { data, error } = await _supabase.from(table).select('*');
      if (error) throw error;
      return (data || []).map(toCamel);
    },
    async get(table, id) {
      const { data, error } = await _supabase.from(table).select('*').eq('id', id).single();
      if (error) throw error;
      return toCamel(data);
    },
    async add(table, row) {
      const { data, error } = await _supabase.from(table).insert(toSnake(row)).select().single();
      if (error) throw error;
      return data.id;
    },
    async put(table, row) {
      const id = row.id;
      const { error } = await _supabase.from(table).update(toSnake(row)).eq('id', id);
      if (error) throw error;
      return row;
    },
    async delete(table, id) {
      const { error } = await _supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },
    async query(sql, params) {
      return [];
    }
  };

  const Users = {
    async _hashPassword(password, salt){
      if(!window.crypto || !window.crypto.subtle) return null;
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-512' }, keyMaterial, 512);
      return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    },
    async login(username, password) {
      const { data, error } = await _supabase.from('users').select('*').eq('username', username).single();
      if (error || !data) throw new Error('بيانات الدخول غير صحيحة');
      const user = toCamel(data);
      let valid = false;
      const stored = user.password;
      if (stored && String(stored).startsWith('pbkdf2:')) {
        try {
          const parts = String(stored).split(':');
          const computed = await this._hashPassword(password, parts[1]);
          valid = (computed === parts[2]);
        } catch(e) { valid = false; }
      } else {
        valid = (String(stored) === String(password));
      }
      if (!valid) throw new Error('بيانات الدخول غير صحيحة');
      if (!user.active) throw new Error('الحساب معطل');
      localStorage.setItem('currentUser', JSON.stringify(user));
      return user;
    },
    logout() { localStorage.removeItem('currentUser'); },
    getCurrentUser() {
      const u = localStorage.getItem('currentUser');
      return u ? JSON.parse(u) : null;
    },
    async getAll() { return _db.getAll('users'); },
    async add(user) {
      let row = user;
      if (user && user.password && !String(user.password).startsWith('pbkdf2:')) {
        const salt = crypto.randomUUID();
        const h = await this._hashPassword(user.password, salt);
        if (h) row = { ...user, password: 'pbkdf2:' + salt + ':' + h };
      }
      return _db.add('users', row);
    },
    async update(id, data) { return _db.put('users', { ...data, id }); },
    async delete(id) { return _db.delete('users', id); },
    async createDefaultAdmin() {
      const users = await this.getAll();
      if (users.length === 0) {
        await this.add({ username: 'admin', password: '123456', name: 'مدير النظام', role: 'admin' });
      }
    }
  };

  const Tables = {
    async init() {
      const tables = await this.getAll();
      const expectedZone = (num) => (num <= 7 ? 'خارجي' : 'داخلي');
      if (tables.length === 0) {
        for (let i = 1; i <= 14; i++) {
          await _db.add('tables_store', { id: i, number: i, status: 'available', capacity: i <= 7 ? 4 : 6, zone: expectedZone(i) });
        }
      } else {
        let changed = false;
        for (const t of tables) {
          if (t.zone !== expectedZone(t.number)) {
            t.zone = expectedZone(t.number);
            await _db.put('tables_store', t);
            changed = true;
          }
        }
        if (changed) console.log('[Tables] zones normalized: خارجي 1-7 / داخلي 8+');
      }
    },
    async getAll() { return _db.getAll('tables_store'); },
    async getByNumber(num) {
      const all = await this.getAll();
      return all.find(t => t.number === parseInt(num)) || null;
    },
    async _findByRef(ref) {
      const all = await this.getAll();
      const num = parseInt(ref);
      return all.find(t => t.number === num) || all.find(t => t.id === num) || null;
    },
    async getById(id) { return this._findByRef(id); },
    async add(t) { return _db.add('tables_store', { status: 'available', capacity: 4, zone: 'داخلي', ...t }); },
    async update(id, data) {
      const table = await this._findByRef(id);
      if(table){ Object.assign(table, data); return _db.put('tables_store', table); }
      return null;
    },
    async remove(id) {
      const table = await this._findByRef(id);
      if(table) return _db.delete('tables_store', table.id);
    },
    async delete(id) { return this.remove(id); }
  };

  const Categories = {
    async getAll() { return _db.getAll('categories'); },
    async getActive() {
      const all = await this.getAll();
      return all.filter(c => c.active !== 0).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    },
    async add(cat) { return _db.add('categories', { active: 1, sort_order: 0, ...cat }); },
    async update(id, data) { return _db.put('categories', { ...data, id }); },
    async delete(id) { return _db.delete('categories', id); }
  };

  const Products = {
    async getAll() { return _db.getAll('products'); },
    async getActive() {
      const all = await this.getAll();
      return all.filter(p => p.available !== 0).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    },
    async getByCategory(categoryId) {
      const all = await this.getAll();
      return all.filter(p => p.category_id === categoryId && p.available !== 0);
    },
    async add(product) {
      product.available = product.available !== undefined ? product.available : 1;
      product.sort_order = product.sort_order || 0;
      product.product_type = product.product_type || 'standard';
      product.components = product.components || '[]';
      product.badge = product.badge || '';
      return _db.add('products', product);
    },
    async update(id, data) { return _db.put('products', { ...data, id }); },
    async delete(id) { return _db.delete('products', id); },
    async search(query) {
      const all = await this.getAll();
      const q = query.toLowerCase();
      return all.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.name_ar || '').toLowerCase().includes(q) ||
        (p.name_en || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
      );
    },
    getFoodCost(price, cost) { return price > 0 ? ((cost || 0) / price) * 100 : 0; }
  };

  const Orders = {
    async getAll() { return _db.getAll('orders'); },
    async getById(id) { return _db.get('orders', id); },
    async getByTable(tableId) {
      const { data, error } = await _supabase.from('orders').select('*').eq('table_id', String(tableId)).eq('status', 'pending');
      if (error) throw error;
      return (data || []).map(toCamel);
    },
    async create(tableId, items, customerName, customerPhone, options = {}) {
      const order = {
        tableId: tableId,
        items: items || [],
        customerName: customerName || '',
        customerPhone: customerPhone || '',
        paymentMethod: options.paymentMethod || 'cash',
        customerNotes: options.customerNotes || '',
        invoiceDelivery: options.invoiceDelivery || 'cashier',
        status: options.status || 'pending',
        orderType: options.orderType || 'dine_in',
        paymentStatus: 'unpaid',
        totalPaid: 0,
        changeAmount: 0,
        subtotal: 0,
        tax: 0,
        total: 0,
        date: new Date().toISOString(),
        createdBy: (window.LuccaDB && window.LuccaDB.Users && window.LuccaDB.Users.getCurrentUser && window.LuccaDB.Users.getCurrentUser()?.name) || 'unknown'
      };
      (order.items || []).forEach(item => {
        order.subtotal += (item.price || 0) * (item.quantity || 1);
      });
      order.total = order.subtotal;
      order.orderNumber = 'ORD-' + Date.now();
      const id = await _db.add('orders', order);
      return { ...order, id };
    },
    async add(order) { return _db.add('orders', order); },
    async update(id, data) { return _db.put('orders', { ...data, id }); },
    async updateOrder(orderId, updates) {
      const item = await _db.get('orders', orderId);
      if (!item) return null;
      Object.assign(item, updates);
      if (updates.items && !updates.subtotal) {
        item.subtotal = updates.items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
        const discount = item.discount || 0;
        const discountAmount = item.subtotal * (discount / 100);
        const afterDiscount = item.subtotal - discountAmount;
        item.total = afterDiscount;
      }
      await _db.put('orders', { ...item, id: orderId });
      return item;
    },
    async delete(id) { return _db.delete('orders', id); },
    async getByDateRange(from, to) {
      const { data, error } = await _supabase.from('orders').select('*').gte('created_at', from).lte('created_at', to);
      if (error) throw error;
      return (data || []).map(toCamel);
    },
    async updateStatus(orderId, status) { return this.update(orderId, { status }); },
    async checkout(orderId, paymentMethod) {
      const order = await _db.get('orders', orderId);
      if (!order) throw new Error('الطلب غير موجود');
      if (order.status === 'closed') throw new Error('الطلب مغلق بالفعل');
      const now = new Date().toISOString();
      const updates = {
        status: 'closed',
        paymentMethod: paymentMethod || 'cash',
        paymentStatus: 'paid',
        totalPaid: order.total || 0,
        changeAmount: 0
      };
      await _db.put('orders', { ...order, ...updates, id: orderId });
      if (order.tableId && !isNaN(parseInt(order.tableId))) {
        await Tables.update(parseInt(order.tableId), { status: 'available', currentOrder: null });
      }
      return { ...order, ...updates };
    }
  };

  const PaymentMethods = {
    async getAll() { return _db.getAll('payment_methods'); },
    async getActive() {
      const all = await this.getAll();
      return all.filter(m => m.active !== 0).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    },
    async add(m) { return _db.add('payment_methods', { active: 1, sort_order: 0, ...m }); },
    async update(id, data) { return _db.put('payment_methods', { ...data, id }); },
    async delete(id) { return _db.delete('payment_methods', id); }
  };

  const Employees = {
    async getAll() { return _db.getAll('employees'); },
    async getActive() {
      const all = await this.getAll();
      return all.filter(e => e.active);
    },
    async add(emp) { return _db.add('employees', { active: true, ...emp }); },
    async update(id, data) { return _db.put('employees', { ...data, id }); },
    async delete(id) { return _db.delete('employees', id); },
    // الدعوة عبر البريد: نفس سلوك الطبقة المحلية — الخادم أولاً، ثم إنشاء محلي/بعيد عند تعذر الخادم.
    async invite(payload) {
      let res = null;
      if (window.ServerAPI && typeof window.ServerAPI.post === 'function') {
        try {
          res = await window.ServerAPI.post('/api/employees/invite', payload);
        } catch (e) { res = null; }
      }
      if (res && res.inviteToken) {
        try {
          await _db.add('invitations', {
            id: res.inviteId, token: res.inviteToken, email: res.email, name: res.name,
            role: res.role, employeeId: res.employeeId, status: 'pending',
            expiresAt: res.expiresAt, createdAt: new Date().toISOString()
          });
        } catch (e) { /* تجاهل فشل تخزين سجل الدعوة */ }
        return res;
      }
      // الخادم غير متاح → ننشئ الموظف مباشرة (لا ادعاء نجاح زائف: إن فشل الإدراج ستُرمى الأخطاء للواجهة).
      const empId = await _db.add('employees', {
        name: payload.name, email: payload.email || null, employeeCode: payload.employeeCode || null,
        phone: payload.phone || '', role: payload.role || 'cashier', salary: payload.salary || 0,
        active: true, createdAt: new Date().toISOString()
      });
      return { local: true, name: payload.name, id: empId };
    },
    async setStatus(id, active) {
      try {
        if (window.ServerAPI && typeof window.ServerAPI.post === 'function') {
          await window.ServerAPI.post('/api/employees/' + Number(id) + '/status', { active: !!active });
        }
      } catch (e) { /* نبقي الحالة المحلية */ }
      try { await _db.put('employees', { id, active: active ? 1 : 0 }); } catch (e) {}
      return true;
    },
    async getInviteStatus(employeeId) {
      try {
        const all = await _db.getAll('invitations');
        const inv = (all || []).find(i => String(i.employeeId) === String(employeeId));
        if (!inv) return null;
        if (inv.status === 'used') return 'used';
        if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) return 'expired';
        return 'pending';
      } catch (e) { return null; }
    }
  };

  const Attendance = {
    async getAll() { return _db.getAll('attendance'); },
    async checkIn(employeeId) {
      return _db.add('attendance', {
        employee_id: employeeId,
        date: new Date().toISOString().slice(0, 10),
        check_in: new Date().toISOString()
      });
    },
    async checkOut(employeeId) {
      const all = await this.getAll();
      const today = new Date().toISOString().slice(0, 10);
      const record = all.find(a => a.employee_id == employeeId && a.date === today && !a.check_out);
      if (record) {
        const checkOut = new Date().toISOString();
        const hours = Math.round((new Date(checkOut) - new Date(record.check_in)) / 3600000 * 10) / 10;
        return _db.put('attendance', { ...record, check_out: checkOut, hours_worked: hours });
      }
    }
  };

  const Expenses = {
    async getAll() { return _db.getAll('expenses'); },
    async add(exp) {
      // جدول expenses المتصل لا يحتوي عمود payment_method حالياً (سحبة المخطط ترفض الإدراج به).
      // نحافظ على payment_method داخلياً للربط المحاسبي في الوردية، وننزعه من حمولة الإدراج.
      const payload = { ...exp };
      delete payload.paymentMethod;
      const id = await _db.add('expenses', { created_by: 'admin', ...payload });
      // ربط محاسبي بالمصروفات: كل مصروف يُسجَّل مرة واحدة، ويُحتسب في الوردية النقدية (الشيفت)
      // إذا كانت هناك وردية مفتوحة — مثل الوضع غير المتصل تماماً. لا يُمنع المصروف هنا.
      try {
        const drawer = await CashRegister.getActiveDrawer();
        if (drawer) await CashRegister.recordTransaction(drawer.id, 'expense', parseFloat(exp.amount || 0), exp.paymentMethod || 'cash', exp.description || 'مصروف');
      } catch (e) { console.warn('[Expenses] drawer expense', e); }
      return id;
    },
    async delete(id) { return _db.delete('expenses', id); }
  };

  const Shifts = {
    async getAll() { return _db.getAll('shifts'); },
    async start(employeeId, notes = '', options = {}) {
      const now = new Date().toISOString();
      const today = now.split('T')[0];
      const existing = await this.getByEmployeeAndDate(employeeId, today);
      if (existing) throw new Error('تم تسجيل شيفت للموظف اليوم');
      return _db.add('shifts', {
        employeeId, date: today,
        startTime: now, endTime: null,
        notes,
        shiftType: options.shiftType || null,
        label: options.label || null,
        status: 'active'
      });
    },
    async end(employeeId) {
      const all = await this.getAll();
      const today = new Date().toISOString().split('T')[0];
      const shift = all.find(s => (s.employeeId == employeeId || s.employee_id == employeeId) && s.date === today && s.status === 'active');
      if (!shift) throw new Error('لا يوجد شيفت نشط للموظف اليوم');
      const endTime = new Date().toISOString();
      const startTs = shift.startTime || shift.start_time;
      const hours = Math.round((new Date(endTime) - new Date(startTs)) / 3600000 * 10) / 10;
      return _db.put('shifts', { ...shift, endTime, status: 'completed', hoursWorked: hours });
    },
    async getByEmployeeAndDate(employeeId, date) {
      const all = await this.getAll();
      return all.find(s => (s.employeeId == employeeId || s.employee_id == employeeId) && s.date === date) || null;
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
      return all.filter(s => s.employeeId == employeeId || s.employee_id == employeeId);
    }
  };

  const Inventory = {
    async getAll() { return _db.getAll('inventory'); },
    async add(item) { return _db.add('inventory', { last_updated: new Date().toISOString(), ...item }); },
    async adjustStock(id, delta) {
      const item = await _db.get('inventory', id);
      if (item) {
        return _db.put('inventory', { ...item, quantity: (item.quantity || 0) + delta, last_updated: new Date().toISOString() });
      }
    },
    async delete(id) { return _db.delete('inventory', id); }
  };

  const Purchases = {
    async getAll() { return _db.getAll('purchases'); },
    async add(p) { return _db.add('purchases', { created_by: 'admin', ...p }); },
    async delete(id) { return _db.delete('purchases', id); }
  };

  const Settings = {
    async get(key) {
      const { data } = await _supabase.from('settings').select('value').eq('key', key).single();
      return data?.value || null;
    },
    async set(key, value) {
      const { error } = await _supabase.from('settings').upsert({ key, value });
      if (error) throw error;
    }
  };

  const BotMemory = {
    async add(entry) { return _db.add('bot_memory', entry); },
    async getAll(type) {
      const all = await _db.getAll('bot_memory');
      return type ? all.filter(m => m.type === type) : all;
    },
    async search(query) {
      const all = await this.getAll();
      const q = query.toLowerCase();
      return all.filter(m =>
        (m.question || '').toLowerCase().includes(q) ||
        (m.answer || '').toLowerCase().includes(q) ||
        (m.keywords || '').toLowerCase().includes(q)
      );
    },
    async update(id, data) { return _db.put('bot_memory', { ...data, id }); },
    async incrementUsage(id) {
      const item = await _db.get('bot_memory', id);
      if (item) return _db.put('bot_memory', { ...item, usage_count: (item.usage_count || 0) + 1 });
    },
    async remove(id) { return _db.delete('bot_memory', id); },
    async getMostUsed(limit = 10) {
      const all = await this.getAll();
      return all.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)).slice(0, limit);
    },
    async logInteraction(text, type, response) {
      return this.add({ type: 'interaction', question: text, answer: response, keywords: type });
    }
  };

  const AuditLogs = {
    async getAll() { return _db.getAll('audit_logs'); },
    async add(log) { return _db.add('audit_logs', { created_at: new Date().toISOString(), ...log }); }
  };

  const MenuSync = {
    async getCatalog() {
      const settings = await _db.getAll('settings');
      const s = settings.find(x => x.key === 'sharedMenuCatalog');
      return s ? (typeof s.value === 'string' ? JSON.parse(s.value) : s.value) : [];
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

  const DataSync = {
    async exportAll() {
      const tables = ['users','categories','products','orders','payments','expenses','employees','attendance','shifts','inventory','purchases','settings','payment_methods','bot_memory','audit_logs','tables_store','discounts','customers','daily_shifts'];
      const data = {};
      for (const t of tables) { data[t] = await _db.getAll(t); }
      return JSON.stringify(data);
    },
    async importAll(jsonString) {
      const data = JSON.parse(jsonString);
      for (const [table, rows] of Object.entries(data)) {
        for (const row of rows) { await _db.put(table, row); }
      }
    }
  };

  const ServerSync = {
    serverUrl: '',
    setServerUrl(url) { this.serverUrl = url; },
    async testConnection() {
      const { error } = await _supabase.from('users').select('id').limit(1);
      return !error;
    },
    async pushAll() {},
    async pullAll() {}
  };

  const KnowledgeBase = {
    async addDocument(doc) {
      const entry = { name: doc.name || 'Untitled', type: doc.type || 'text', content: doc.content || '', tags: doc.tags || '', chunks_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const id = await _db.add('knowledge_documents', entry);
      const chunks = (doc.content || '').split(/(?<=[.!?\n])\s+/).filter(c => c.trim().length > 5);
      for (let i = 0; i < chunks.length; i++) {
        await _db.add('knowledge_chunks', { document_id: id, content: chunks[i].trim(), chunk_index: i, tokens_estimate: Math.ceil(chunks[i].split(/\s+/).length * 1.3) });
      }
      entry.chunks_count = chunks.length;
      entry.id = id;
      await _db.put('knowledge_documents', entry);
      return entry;
    },
    async getAllDocuments() { return _db.getAll('knowledge_documents'); },
    async getDocument(id) { return _db.get('knowledge_documents', id); },
    async removeDocument(id) {
      const chunks = await _db.getAll('knowledge_chunks');
      for (const c of chunks.filter(c => c.document_id === id)) await _db.delete('knowledge_chunks', c.id);
      return _db.delete('knowledge_documents', id);
    },
    async searchChunks(query) {
      const all = await _db.getAll('knowledge_chunks');
      const terms = query.toLowerCase().split(/[\s,.\-!?]+/).filter(t => t.length > 1);
      return all.filter(chunk => {
        const content = (chunk.content || '').toLowerCase();
        return terms.some(t => content.includes(t));
      }).sort((a, b) => {
        const scoreA = terms.filter(t => (a.content || '').toLowerCase().includes(t)).length;
        const scoreB = terms.filter(t => (b.content || '').toLowerCase().includes(t)).length;
        return scoreB - scoreA;
      }).slice(0, 20);
    },
    async search(query) {
      const results = await this.searchChunks(query);
      if (results.length === 0) return null;
      return { results, context: results.slice(0, 3).map(r => r.content).join('\n---\n'), count: results.length };
    },
    async ingestText(name, text, tags) { return this.addDocument({ name, type: 'text', content: text, tags }); },
    async getStats() {
      const docs = await this.getAllDocuments();
      let totalChunks = 0;
      for (const doc of docs) {
        const chunks = await _db.getAll('knowledge_chunks');
        totalChunks += chunks.filter(c => c.document_id === doc.id).length;
      }
      return { documents: docs.length, chunks: totalChunks, tokens: 0 };
    }
  };

  // ===== Enhanced Inventory Modules =====
  const Suppliers = {
    async getAll() { return _db.getAll('suppliers'); },
    async get(id) { return _db.get('suppliers', id); },
    async add(s) { s.created_at = new Date().toISOString(); return _db.add('suppliers', s); },
    async update(id, d) { return _db.put('suppliers', { id, ...d }); },
    async delete(id) { return _db.delete('suppliers', id); },
    async getActive() { const all = await this.getAll(); return all.filter(s => s.active !== 0); }
  };

  const StockMovements = {
    async getAll() { return _db.getAll('stock_movements'); },
    async getByIngredient(id) { const all = await this.getAll(); return all.filter(m => m.ingredient_id === id); },
    async getByType(type) { const all = await this.getAll(); return all.filter(m => m.type === type); },
    async add(m) { m.date = m.date || new Date().toISOString(); m.created_at = new Date().toISOString(); return _db.add('stock_movements', m); },
    async getStats() {
      const all = await this.getAll();
      const purchases = all.filter(m => m.type === 'purchase').reduce((s, m) => s + Math.abs(m.quantity || 0), 0);
      const sales = all.filter(m => m.type === 'sale' || m.type === 'recipe_deduct').reduce((s, m) => s + Math.abs(m.quantity || 0), 0);
      const waste = all.filter(m => m.type === 'waste').reduce((s, m) => s + Math.abs(m.quantity || 0), 0);
      return { total: all.length, purchases, sales, waste };
    }
  };

  const ProductRecipes = {
    async getAll() { return _db.getAll('product_recipes'); },
    async getByProduct(productId) { const all = await this.getAll(); return all.filter(r => r.product_id == productId); },
    async getByIngredient(ingredientId) { const all = await this.getAll(); return all.filter(r => r.ingredient_id == ingredientId); },
    async add(r) { r.created_at = new Date().toISOString(); return _db.add('product_recipes', r); },
    async delete(id) { return _db.delete('product_recipes', id); },
    async deleteByProduct(productId) {
      const all = await this.getByProduct(productId);
      for (const r of all) await _db.delete('product_recipes', r.id);
    },
    async getRecipeCost(productId) {
      const recipes = await this.getByProduct(productId);
      let totalCost = 0;
      for (const r of recipes) {
        const ing = await _db.get('inventory_items', r.ingredient_id);
        if (ing) totalCost += (ing.cost_per_unit || 0) * (r.quantity_needed || 1);
      }
      return totalCost;
    }
  };

  const WasteLog = {
    async getAll() { return _db.getAll('waste_log'); },
    async add(w) {
      w.date = w.date || new Date().toISOString();
      w.created_at = new Date().toISOString();
      const id = await _db.add('waste_log', w);
      if (w.ingredient_id) {
        const item = await _db.get('inventory_items', w.ingredient_id);
        if (item) {
          await _db.put('inventory_items', { ...item, quantity: Math.max(0, (item.quantity || 0) - (w.quantity || 0)), updated_at: new Date().toISOString() });
        }
      }
      return id;
    },
    async getStats() {
      const all = await this.getAll();
      return { count: all.length, totalCost: all.reduce((s, w) => s + (w.cost || 0), 0), totalQty: all.reduce((s, w) => s + (w.quantity || 0), 0) };
    }
  };

  // Enhanced Inventory with recipe support
  const InventoryEnhanced = {
    async adjustStock(id, qty, type, notes) {
      const item = await _db.get('inventory_items', id);
      if (!item) return null;
      const oldQty = item.quantity || 0;
      item.quantity = Math.max(0, oldQty + qty);
      item.updated_at = new Date().toISOString();
      await _db.put('inventory_items', item);
      await StockMovements.add({ ingredient_id: id, type: type || 'adjustment', quantity: qty, notes: notes || '' });
      return item;
    },
    async getLowStock() {
      const all = await _db.getAll('inventory_items');
      return all.filter(i => (i.quantity || 0) <= (i.min_quantity || 5) && (i.active || 1) === 1);
    },
    async deductForCheckout(orderItems) {
      if (!orderItems || !orderItems.length) return;
      for (const oi of orderItems) {
        const pid = oi.productId || oi.product_id;
        if (pid) {
          const recipes = await ProductRecipes.getByProduct(pid);
          if (recipes.length > 0) {
            for (const r of recipes) {
              await this.adjustStock(r.ingredient_id, -(r.quantity_needed || 1) * (oi.quantity || 1), 'recipe_deduct', 'Order deduction');
            }
            continue;
          }
        }
      }
    }
  };

  // ===== Customer Loyalty =====
  const REDEEM_RATE = 100;
  const CustomerLoyalty = {
    async getOrCreateByPhone(phone) {
      if (!phone) return null;
      const all = await _db.getAll('customers');
      let customer = all.find(c => (c.phone || '').replace(/\D/g, '') === phone.replace(/\D/g, ''));
      if (!customer) {
        customer = { name: '', phone, points: 0, totalSpent: 0, totalVisits: 0, tier: 'bronze', createdAt: new Date().toISOString() };
        customer.id = await _db.add('customers', customer);
      }
      return customer;
    },
    async addPoints(phone, amount, orderId) {
      const customer = await this.getOrCreateByPhone(phone);
      if (!customer) return null;
      const earned = Math.floor(amount * 1);
      customer.points = (customer.points || 0) + earned;
      customer.totalSpent = (customer.totalSpent || 0) + amount;
      customer.totalVisits = (customer.totalVisits || 0) + 1;
      customer.lastVisit = new Date().toISOString();
      customer.tier = this.calcTier(customer.totalSpent);
      await _db.put('customers', customer);
      return { customer, earned, total: customer.points };
    },
    async redeemPoints(phone, points) {
      const customer = await this.getOrCreateByPhone(phone);
      if (!customer) return null;
      if ((customer.points || 0) < points) return { error: 'النقاط غير كافية', available: customer.points };
      const discount = Math.floor(points / REDEEM_RATE);
      customer.points -= points;
      await _db.put('customers', customer);
      return { customer, discount, remaining: customer.points };
    },
    async getCustomer(phone) { return this.getOrCreateByPhone(phone); },
    async getAllCustomers() {
      const all = await _db.getAll('customers');
      return all.filter(c => c.phone).sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
    },
    async getStats() {
      const all = await this.getAllCustomers();
      const totalPoints = all.reduce((s, c) => s + (c.points || 0), 0);
      const totalSpent = all.reduce((s, c) => s + (c.totalSpent || 0), 0);
      return { customers: all.length, totalPoints, totalSpent, tiers: { diamond: 0, gold: 0, silver: 0, bronze: 0 } };
    },
    calcTier(s) { return s >= 50000 ? 'diamond' : s >= 25000 ? 'gold' : s >= 10000 ? 'silver' : 'bronze'; },
    tierName(t) { return { diamond: '💎 ماسي', gold: '🥇 ذهبي', silver: '🥈 فضي' }[t] || '🥉 برونزي'; },
    tierColor(t) { return { diamond: '#00bfff', gold: '#ffd700', silver: '#c0c0c0' }[t] || '#cd7f32'; }
  };

  // ===== Cash Register (Online Adapter) =====
  // الوردية النقدية (الشيفت/الصندوق) تُخزَّن محلياً (localStorage) حتى تعمل في الظرف المتصل
  // بنفس سلوكها في الظرف غير المتصل (IndexedDB). لماذا محلياً؟ جدول cash_registers غير مضمون
  // في قاعدة supabase ولم يتمّ تزويدها ببيانات — فلا نعتمد على مخطط غير مؤكد.
  // سياسة الإدارة الجديدة: لا شرط لفتح وردية نقدية — العمليات النقدية مسموحة دائماً.
  // إن كانت وردية مفتوحة تُربَط بها المعاملات تلقائياً للتدقيق (best-effort) ولا تُحجب أي عملية.
  const _dcKey = 'lucca.cash_registers';
  const _dcAll = () => { try { return JSON.parse(localStorage.getItem(_dcKey) || '[]'); } catch (e) { return []; } };
  const _dcSave = (rows) => { try { localStorage.setItem(_dcKey, JSON.stringify(rows)); } catch (e) {} };
  const _dcNextId = (rows) => (rows.reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0) + 1);
  const CashRegister = {
    async getActiveDrawer() {
      const rows = _dcAll();
      return rows.find(d => d.status === 'open') || null;
    },
    async openDrawer(startingCash, employeeId, notes) {
      const rows = _dcAll();
      const existing = rows.find(d => d.status === 'open');
      if (existing) return { error: 'الصندوق مفتوح بالفعل! أغلقه أولاً.', drawer: existing };
      let by = 'system';
      try {
        const cu = window.LuccaDB && window.LuccaDB.Users && window.LuccaDB.Users.getCurrentUser && window.LuccaDB.Users.getCurrentUser();
        if (cu) by = (cu.name || cu.username || 'system');
      } catch (e) {}
      const drawer = {
        id: _dcNextId(rows),
        status: 'open',
        startingCash: Number(startingCash) || 0,
        currentCash: Number(startingCash) || 0,
        openingCash: Number(startingCash) || 0,
        employeeId: employeeId || null,
        openedBy: by,
        openedByUser: null,
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
      rows.push(drawer);
      _dcSave(rows);
      return { drawer };
    },
    async closeDrawer(closingCash, notes) {
      const rows = _dcAll();
      const drawer = rows.find(d => d.status === 'open');
      if (!drawer) return { error: 'لا يوجد صندوق مفتوح' };
      drawer.status = 'closed';
      drawer.closingCash = Number(closingCash) || 0;
      drawer.closedAt = new Date().toISOString();
      drawer.expectedCash = (Number(drawer.openingCash || drawer.startingCash) || 0)
        + (Number(drawer.totalCashSales) || 0)
        - (Number(drawer.totalExpenses) || 0)
        - (Number(drawer.totalRefunds) || 0);
      drawer.difference = (Number(drawer.closingCash) || 0) - drawer.expectedCash;
      drawer.differenceType = drawer.difference > 0 ? 'overage' : (drawer.difference < 0 ? 'shortage' : 'balanced');
      drawer.version = (Number(drawer.version) || 1) + 1;
      if (notes) drawer.notes = (drawer.notes || '') + '\n' + notes;
      _dcSave(rows);
      return { drawer };
    },
    async recordTransaction(drawerId, type, amount, method, description) {
      const rows = _dcAll();
      const drawer = rows.find(d => String(d.id) === String(drawerId) || Number(d.id) === Number(drawerId));
      if (!drawer) return null;
      amount = Number(amount) || 0;
      drawer.transactionCount = (drawer.transactionCount || 0) + 1;
      const m = String(method || '').toLowerCase();
      if (type === 'sale') {
        if (m === 'cash' || m === 'كاش' || m === 'نقدي') {
          drawer.totalCashSales = (drawer.totalCashSales || 0) + amount;
          drawer.currentCash = (Number(drawer.currentCash) || 0) + amount;
        } else if (m === 'wallet' || m === 'محفظة' || m === 'digital' || m === 'تحويل') {
          drawer.totalWalletSales = (drawer.totalWalletSales || 0) + amount;
        } else {
          drawer.totalCardSales = (drawer.totalCardSales || 0) + amount;
        }
      } else if (type === 'expense') {
        drawer.totalExpenses = (drawer.totalExpenses || 0) + amount;
        drawer.currentCash = (Number(drawer.currentCash) || 0) - amount;
      } else if (type === 'refund') {
        drawer.totalRefunds = (drawer.totalRefunds || 0) + amount;
        if (m === 'cash' || m === 'كاش' || m === 'نقدي') drawer.currentCash = (Number(drawer.currentCash) || 0) - amount;
      }
      drawer.expectedCash = (Number(drawer.openingCash || drawer.startingCash) || 0)
        + (Number(drawer.totalCashSales) || 0)
        - (Number(drawer.totalExpenses) || 0)
        - (Number(drawer.totalRefunds) || 0);
      _dcSave(rows);
      return true;
    },
    async getDrawerStats(drawerId) {
      const rows = _dcAll();
      const drawer = rows.find(d => String(d.id) === String(drawerId) || Number(d.id) === Number(drawerId));
      if (!drawer) return null;
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
        totalSales: (Number(drawer.totalCashSales) || 0) + (Number(drawer.totalCardSales) || 0)
      };
    },
    async getAllDrawers() {
      return _dcAll();
    },
    async getTodaySummary() {
      const rows = _dcAll();
      const today = new Date().toISOString().slice(0, 10);
      const todayDrawers = rows.filter(d => (d.openedAt || '').slice(0, 10) === today || (d.closedAt || '').slice(0, 10) === today);
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
    async getDailyClosingReport(dateStr) {
      const day = dateStr || new Date().toISOString().slice(0, 10);
      const rows = _dcAll();
      const dayDrawers = rows.filter(d => (d.openedAt || '').slice(0, 10) === day || (d.closedAt || '').slice(0, 10) === day);
      let totalCash = 0, totalCard = 0, totalWallet = 0, totalExp = 0, totalRef = 0;
      dayDrawers.forEach(d => {
        totalCash += Number(d.totalCashSales) || 0;
        totalCard += Number(d.totalCardSales) || 0;
        totalWallet += Number(d.totalWalletSales) || 0;
        totalExp += Number(d.totalExpenses) || 0;
        totalRef += Number(d.totalRefunds) || 0;
      });
      let revenue = 0, refundTotal = 0;
      try {
        const allOrders = await _db.getAll('orders');
        const paidOrders = allOrders.filter(o => String(o.paymentStatus || '').toLowerCase() === 'paid' && (o.date || o.createdAt || '').slice(0, 10) === day);
        revenue = paidOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      } catch (e) {}
      try {
        const allRefunds = await _db.getAll('refunds');
        const dayRefs = allRefunds.filter(r => (r.createdAt || r.updatedAt || r.date || '').slice(0, 10) === day);
        refundTotal = dayRefs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      } catch (e) {}
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
        revenue, refunds: refundTotal, netRevenue: revenue - refundTotal,
        totals: { cash: totalCash, card: totalCard, wallet: totalWallet, expenses: totalExp, refunds: totalRef },
        topItems: []
      };
    }
  };

  // ===== Expense Categories =====
  const ExpenseCategories = {
    async init() {},
    async getAll() { return _db.getAll('expenses'); },
    async getActive() { return _db.getAll('expenses'); },
    async add(cat) { return _db.add('expenses', cat); },
    async update(id, data) { const c = await _db.get('expenses', id); if(c){ Object.assign(c, data); await _db.put('expenses', c); } return c; },
    async remove(id) { return _db.delete('expenses', id); }
  };

  // ===== Table Reservations =====
  const TableReservations = {
    async getAll() { return _db.getAll('tables'); },
    async add(res) { res.status = 'confirmed'; return _db.add('tables', res); },
    async cancel(id) { return true; },
    async complete(id) { return true; },
    async getToday() { return []; },
    async getUpcoming() { return []; },
    async isTableAvailable() { return true; }
  };

  async function initSystem() {
    await Users.createDefaultAdmin();
    await Tables.init();
  }

  window.LuccaDB = {
    db: _db, Users, Tables, Categories, Products, Orders,
    Customers: { async getAll() { return _db.getAll('customers'); }, async add(phone, name, opts) { return _db.add('customers', { phone, name, ...opts }); } },
    Settings, Inventory, Purchases, Employees, Attendance,
    Expenses, Shifts, MenuSync, DataSync, ServerSync,
    PaymentMethods, Categories, Products, ProductModifiers: { async getAll() { return _db.getAll('product_modifiers'); } },
    ProductVariations: { async getAll() { return _db.getAll('product_variations'); } },
    Taxes: { async getAll() { return _db.getAll('taxes'); } },
    AuditLogs, OrderStatusHistory: { async getAll() { return _db.getAll('order_status_history'); } },
    BotMemory, KnowledgeBase, Suppliers, StockMovements, ProductRecipes, WasteLog, CustomerLoyalty, CashRegister, ExpenseCategories, TableReservations, initSystem,
    // Sync methods
    enableSync: function(opts){
      if(!window.SyncEngine) return;
      // غلف عمليات db.put/add/delete لتدخل في queue المزامنة (كانت تُتخطى سابقاً → لا شيء يُزامَن)
      window.SyncEngine.wrapDBOperations(_db, _supabase);
      window.SyncEngine.startAutoSync(_supabase, _db, {
        interval: (opts && opts.interval) || 30000,
        onStatusChange: (opts && opts.onStatusChange) || null
      });
    },
    getSyncStatus: function(){ return window.SyncEngine ? window.SyncEngine.getSyncStatus() : null; },
    triggerSync: function(){ return window.SyncEngine ? window.SyncEngine.triggerSync() : Promise.resolve(); },
    _supabaseClient: _supabase
  };

  // إعلام طبقة التشغيل (database.js) بجاهزية Supabase لتفعيل enableSync تلقائياً
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new Event('lucca:sync-available'));
  }
})();
