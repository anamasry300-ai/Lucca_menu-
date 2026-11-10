/*
 * Lucca Admin enhancements
 * تحليل الطلبات، تقدير تكلفة أولي، ونموذج طلب سريع.
 * كل أسعار السوق هنا مرجعية قابلة للتعديل وليست بديلاً عن عروض الموردين.
 */
(function (global) {
  'use strict';

  const MARKET_KEY = 'luccaEgyptMarketBenchmarksV1';
  const DEFAULT_MARKET = {
    coffee: { label: 'بن محوج/سادة', unit: 'كجم', price: 520 },
    milk: { label: 'لبن سائب/كامل الدسم', unit: 'لتر', price: 32 },
    sugar: { label: 'سكر أبيض', unit: 'كجم', price: 35 },
    cream: { label: 'كريمة/صوصات أساسية', unit: 'كجم', price: 120 },
    cup: { label: 'كوب وغطاء', unit: 'قطعة', price: 1.5 },
    water: { label: 'مياه/ثلج ومستهلكات', unit: 'حصة', price: 1 },
    foodCostPct: { label: 'نسبة تكلفة افتراضية عند غياب الوصفة', unit: '%', price: 30 }
  };

  const state = { quickLines: [], analysis: null };
  const money = (n) => Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
  const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0;
  const text = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (v) => String(v || '').slice(0, 10);
  const currentUser = () => global.LuccaDB && global.LuccaDB.Users && global.LuccaDB.Users.getCurrentUser ? global.LuccaDB.Users.getCurrentUser() : null;
  const serverApi = () => {
    try { return typeof ServerAPI !== 'undefined' ? ServerAPI : global.ServerAPI; } catch (_) { return global.ServerAPI; }
  };

  function marketProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(MARKET_KEY) || '{}');
      return Object.keys(DEFAULT_MARKET).reduce((out, key) => {
        out[key] = Object.assign({}, DEFAULT_MARKET[key], saved[key] || {});
        return out;
      }, {});
    } catch (_) { return JSON.parse(JSON.stringify(DEFAULT_MARKET)); }
  }

  function saveMarketProfile() {
    const profile = marketProfile();
    Object.keys(profile).forEach(key => {
      const input = document.getElementById('market-' + key);
      if (input && Number.isFinite(Number(input.value))) profile[key].price = Number(input.value);
    });
    localStorage.setItem(MARKET_KEY, JSON.stringify(profile));
    showToast('تم حفظ مرجع أسعار السوق المصري — راجعه دوريًا مع الموردين');
    loadOrderInsights();
  }

  function showToast(message, type) {
    if (typeof global.showToast === 'function') return global.showToast(message, type);
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  async function loadQuickOrderForm() {
    try {
      const products = await global.LuccaDB.Products.getAll();
      const tables = await global.LuccaDB.Tables.getAll();
      const productSelect = document.getElementById('quickOrderProduct');
      const tableSelect = document.getElementById('quickOrderTable');
      if (productSelect) productSelect.innerHTML = '<option value="">اختر منتجًا</option>' + products.filter(p => p.active !== 0 && p.available !== false).map(p => '<option value="' + text(p.id) + '">' + text(p.nameAr || p.name) + ' — ' + money(p.price || p.salePrice) + '</option>').join('');
      if (tableSelect) tableSelect.innerHTML = '<option value="">تيك أواي / بدون طاولة</option>' + tables.filter(t => t.status !== 'occupied').map(t => '<option value="' + text(t.id) + '">طاولة ' + text(t.number || t.id) + '</option>').join('');
      renderQuickOrderLines();
    } catch (e) { showToast('تعذر تحميل نموذج الطلب: ' + e.message, 'error'); }
  }

  async function addQuickOrderLine() {
    const select = document.getElementById('quickOrderProduct');
    const qtyInput = document.getElementById('quickOrderQty');
    if (!select || !select.value) return showToast('اختر منتجًا أولًا', 'error');
    const products = await global.LuccaDB.Products.getAll();
    const product = products.find(p => String(p.id) === String(select.value));
    const qty = Math.max(1, Math.floor(num(qtyInput && qtyInput.value) || 1));
    if (!product) return showToast('المنتج غير موجود', 'error');
    const price = num(product.price != null ? product.price : product.salePrice);
    const existing = state.quickLines.find(x => String(x.productId) === String(product.id));
    if (existing) existing.quantity += qty;
    else state.quickLines.push({ productId: product.id, name: product.nameAr || product.name || 'منتج', price, quantity: qty, total: price * qty });
    state.quickLines.forEach(x => { x.total = x.price * x.quantity; });
    if (qtyInput) qtyInput.value = 1;
    renderQuickOrderLines();
  }

  function removeQuickOrderLine(index) {
    state.quickLines.splice(index, 1);
    renderQuickOrderLines();
  }

  function renderQuickOrderLines() {
    const host = document.getElementById('quickOrderLines');
    const totalEl = document.getElementById('quickOrderTotal');
    if (!host) return;
    if (!state.quickLines.length) host.innerHTML = '<div class="empty-state"><div class="icon">🧾</div><p>أضف المنتجات ليظهر ملخص الطلب</p></div>';
    else host.innerHTML = '<table class="data-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th></th></tr></thead><tbody>' + state.quickLines.map((line, i) => '<tr><td>' + text(line.name) + '</td><td>' + line.quantity + '</td><td>' + money(line.price) + '</td><td>' + money(line.total) + '</td><td><button class="btn btn-ghost btn-sm" onclick="removeQuickOrderLine(' + i + ')" aria-label="حذف المنتج">🗑️</button></td></tr>').join('') + '</tbody></table>';
    const subtotal = state.quickLines.reduce((s, x) => s + x.total, 0);
    const discount = Math.max(0, num(document.getElementById('quickOrderDiscount') && document.getElementById('quickOrderDiscount').value));
    if (totalEl) totalEl.textContent = money(Math.max(0, subtotal - subtotal * discount / 100));
  }

  async function submitQuickOrder() {
    if (!state.quickLines.length) return showToast('أضف منتجًا واحدًا على الأقل', 'error');
    try {
      const table = document.getElementById('quickOrderTable').value || null;
      const name = (document.getElementById('quickOrderCustomer').value || '').trim();
      const phone = (document.getElementById('quickOrderPhone').value || '').trim();
      const discount = Math.min(100, Math.max(0, num(document.getElementById('quickOrderDiscount').value)));
      const order = await global.LuccaDB.Orders.create(table, state.quickLines.map(x => ({ ...x })), name, phone, { discount, orderType: table ? 'dine_in' : 'takeaway', status: 'pending' });
      state.quickLines = [];
      ['quickOrderCustomer', 'quickOrderPhone', 'quickOrderDiscount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      renderQuickOrderLines();
      showToast('تم إنشاء الطلب ' + (order.orderNumber || '#' + order.id), 'success');
      if (typeof global.loadOrders === 'function') global.loadOrders();
      loadOrderInsights();
    } catch (e) { showToast('فشل إنشاء الطلب: ' + e.message, 'error'); }
  }

  function renderMarketProfile() {
    const host = document.getElementById('marketBenchmarks');
    if (!host) return;
    const profile = marketProfile();
    host.innerHTML = Object.keys(profile).map(key => '<div class="market-input"><label for="market-' + key + '">' + text(profile[key].label) + ' <small>(' + text(profile[key].unit) + ')</small></label><input id="market-' + key + '" type="number" min="0" step="0.01" value="' + num(profile[key].price) + '"></div>').join('');
  }

  async function estimateProductCost(product, recipes, inventory, profile) {
    const own = recipes.filter(r => String(r.productId) === String(product.id));
    if (own.length) {
      const cost = own.reduce((sum, recipe) => {
        const ingredient = inventory.find(i => String(i.id) === String(recipe.ingredientId));
        return sum + num(ingredient && (ingredient.cost || ingredient.costPerUnit)) * num(recipe.quantityNeeded || recipe.quantity || 1);
      }, 0);
      if (cost > 0) return { cost, source: 'وصفة مسجلة' };
    }
    const direct = num(product.cost || product.costPrice);
    if (direct > 0) return { cost: direct, source: 'تكلفة المنتج' };
    return { cost: num(product.price || product.salePrice) * num(profile.foodCostPct.price) / 100, source: 'تقدير سوقي ' + profile.foodCostPct.price + '%' };
  }

  async function loadOrderInsights() {
    const root = document.getElementById('orderInsightsRoot');
    if (!root || !global.LuccaDB) return;
    try {
      renderMarketProfile();
      const [orders, products, recipes, inventory] = await Promise.all([global.LuccaDB.Orders.getAll(), global.LuccaDB.Products.getAll(), global.LuccaDB.ProductRecipes.getAll(), global.LuccaDB.Inventory.getAll()]);
      const profile = marketProfile();
      const productMap = {}; products.forEach(p => { productMap[p.id] = p; });
      const productCosts = {};
      for (const p of products) productCosts[p.id] = await estimateProductCost(p, recipes, inventory, profile);
      const from = (document.getElementById('dateFrom') && document.getElementById('dateFrom').value) || '';
      const to = (document.getElementById('dateTo') && document.getElementById('dateTo').value) || '';
      const completed = orders.filter(o => {
        if (!(['closed', 'completed'].includes(o.status) || o.paymentStatus === 'paid')) return false;
        const d = day(o.date || o.createdAt);
        return (!from || d >= from) && (!to || d <= to);
      });
      const revenue = completed.reduce((s, o) => s + num(o.total), 0);
      let estimatedCost = 0;
      const byProduct = {};
      const byHour = {};
      completed.forEach(o => {
        const hour = String(new Date(o.date || o.createdAt || Date.now()).getHours()).padStart(2, '0') + ':00';
        byHour[hour] = (byHour[hour] || 0) + 1;
        (Array.isArray(o.items) ? o.items : []).forEach(item => {
          const product = productMap[item.productId];
          const itemRevenue = num(item.total || (item.price || 0) * (item.quantity || 1));
          const pc = productCosts[item.productId] || { cost: itemRevenue * profile.foodCostPct.price / 100, source: 'تقدير سوقي' };
          const itemCost = product && num(product.price || product.salePrice) > 0 ? pc.cost * num(item.quantity || 1) : itemRevenue * profile.foodCostPct.price / 100;
          estimatedCost += itemCost;
          const key = item.productId || item.name || 'unknown';
          if (!byProduct[key]) byProduct[key] = { name: item.name || (product && (product.nameAr || product.name)) || 'غير معروف', qty: 0, revenue: 0, cost: 0, source: pc.source };
          byProduct[key].qty += num(item.quantity || 1); byProduct[key].revenue += itemRevenue; byProduct[key].cost += itemCost;
        });
      });
      const top = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
      const peak = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
      const margin = revenue ? ((revenue - estimatedCost) / revenue) * 100 : 0;
      const missingRecipes = products.filter(p => !(recipes.some(r => String(r.productId) === String(p.id))) && !num(p.cost || p.costPrice)).length;
      document.getElementById('oiKpis').innerHTML = '<div class="kpi-card blue"><div class="kpi-value">' + completed.length + '</div><div class="kpi-label">طلبات مكتملة</div></div><div class="kpi-card green"><div class="kpi-value">' + money(revenue) + '</div><div class="kpi-label">إيرادات محللة</div></div><div class="kpi-card orange"><div class="kpi-value">' + money(estimatedCost) + '</div><div class="kpi-label">تكلفة مبدئية</div></div><div class="kpi-card purple"><div class="kpi-value">' + margin.toFixed(1) + '%</div><div class="kpi-label">هامش تقديري</div></div>';
      document.getElementById('oiSummary').innerHTML = '<div class="insight-callout">' + (peak ? 'ساعة الذروة الحالية: <b>' + peak[0] + '</b> بعدد ' + peak[1] + ' طلب.' : 'لا توجد بيانات كافية لتحديد ساعة الذروة.') + '</div><div class="insight-callout">' + (missingRecipes ? 'يوجد <b>' + missingRecipes + '</b> منتجًا بلا وصفة أو تكلفة فعلية؛ النتيجة تقديرية.' : 'كل المنتجات المباعة مرتبطة بتكلفة أو وصفة مسجلة.') + '</div>';
      document.getElementById('oiProducts').innerHTML = top.length ? '<table class="data-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>الإيراد</th><th>التكلفة</th><th>الهامش</th><th>المصدر</th></tr></thead><tbody>' + top.map(row => '<tr><td>' + text(row.name) + '</td><td>' + row.qty + '</td><td>' + money(row.revenue) + '</td><td>' + money(row.cost) + '</td><td>' + (row.revenue ? (((row.revenue - row.cost) / row.revenue) * 100).toFixed(1) : '0') + '%</td><td><span class="badge badge-warning">' + text(row.source) + '</span></td></tr>').join('') + '</tbody></table>' : '<div class="empty-state"><div class="icon">📊</div><p>لا توجد طلبات مكتملة بعد</p></div>';
      state.analysis = { revenue, estimatedCost, margin, orders: completed.length, byProduct: top };
    } catch (e) { const el = document.getElementById('oiSummary'); if (el) el.innerHTML = '<div class="alert alert-danger">تعذر تحليل الطلبات: ' + text(e.message) + '</div>'; }
  }

  function filterEmployees(value) {
    const q = String(value || '').trim().toLowerCase();
    document.querySelectorAll('#employeesBody tr').forEach(row => { row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }

  function filterRoleUsers(value) {
    const q = String(value || '').trim().toLowerCase();
    document.querySelectorAll('#rolesBody tr').forEach(row => { row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }

  async function toggleRoleUser(id) {
    try {
      const users = await global.LuccaDB.Users.getAll();
      const user = users.find(x => String(x.id) === String(id));
      if (!user) return showToast('المستخدم غير موجود', 'error');
      const current = currentUser();
      if (current && String(current.id) === String(id)) return showToast('لا يمكن تعطيل المستخدم الحالي', 'error');
      user.active = user.active === false || user.active === 0;
      await global.LuccaDB.db.put('users', user);
      const api = serverApi();
      if (api) api.put('users', id, user).catch(() => {});
      if (typeof global.loadRoleUsers === 'function') global.loadRoleUsers();
      showToast(user.active ? 'تم تفعيل المستخدم' : 'تم تعطيل المستخدم');
    } catch (e) { showToast('تعذر تحديث حالة المستخدم: ' + e.message, 'error'); }
  }

  async function resetRolePassword(id) {
    const next = prompt('أدخل كلمة المرور الجديدة (6 أحرف على الأقل):');
    if (!next) return;
    if (next.length < 6) return showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
    try {
      const users = await global.LuccaDB.Users.getAll();
      const user = users.find(x => String(x.id) === String(id));
      if (!user) return showToast('المستخدم غير موجود', 'error');
      const salt = crypto.randomUUID();
      const hash = await global.LuccaDB.Users.pbkdf2Hash(next, salt);
      user.password = hash ? 'pbkdf2:' + salt + ':' + hash : next;
      user.mustChangePassword = true;
      await global.LuccaDB.db.put('users', user);
      const api = serverApi();
      if (api) api.put('users', id, { ...user, password: undefined }).catch(() => {});
      showToast('تم تغيير كلمة المرور وسيُطلب من المستخدم تحديثها عند الدخول');
    } catch (e) { showToast('تعذر تغيير كلمة المرور: ' + e.message, 'error'); }
  }

  global.AdminEnhancements = { loadQuickOrderForm, addQuickOrderLine, removeQuickOrderLine, renderQuickOrderLines, submitQuickOrder, loadOrderInsights, saveMarketProfile, filterEmployees, filterRoleUsers, toggleRoleUser, resetRolePassword };
  global.loadQuickOrderForm = loadQuickOrderForm;
  global.addQuickOrderLine = addQuickOrderLine;
  global.removeQuickOrderLine = removeQuickOrderLine;
  global.submitQuickOrder = submitQuickOrder;
  global.loadOrderInsights = loadOrderInsights;
  global.saveMarketProfile = saveMarketProfile;
  global.filterEmployees = filterEmployees;
  global.filterRoleUsers = filterRoleUsers;
  global.toggleRoleUser = toggleRoleUser;
  global.resetRolePassword = resetRolePassword;
})(typeof window !== 'undefined' ? window : globalThis);
