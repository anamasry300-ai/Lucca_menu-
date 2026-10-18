(function () {
  'use strict';

  var TOKEN_KEY = 'luccaToken';
  var USER_KEY = 'luccaUser';

  var state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    user: null,
    categories: [],
    items: [],
    settings: null,
    activeTab: 'categories',
    itemFilter: { q: '', categoryId: '' }
  };

  // ===== helpers =====
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    var v = Number(n || 0);
    return v.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function toast(msg, type) {
    var wrap = el('toastWrap');
    var t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function () { t.remove(); }, 300); }, 3000);
  }

  // ===== API =====
  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    if (opts.body && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    opts.headers = headers;
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { doLogout(true); throw new Error('انتهت الجلسة — سجّل الدخول مرة أخرى'); }
        if (!r.ok) throw new Error(data.error || ('خطأ ' + r.status));
        return data;
      });
    });
  }

  // ===== auth =====
  function showLogin() {
    el('loginScreen').classList.remove('hidden');
    el('app').classList.add('hidden');
  }
  function showApp() {
    el('loginScreen').classList.add('hidden');
    el('app').classList.remove('hidden');
    el('userLabel').textContent = (state.user && state.user.username) || '';
    refreshAll();
  }

  function doLogout(silent) {
    var hadToken = state.token;
    state.token = '';
    state.user = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    if (hadToken && !silent) api('/api/auth/logout', { method: 'POST' }).catch(function () {});
    showLogin();
  }

  el('logoutBtn').addEventListener('click', function () { doLogout(false); });

  el('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = el('loginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-inline"></span>';
    var body = { username: el('loginUser').value.trim(), password: el('loginPass').value };
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'فشل الدخول'); return d; }); })
      .then(function (d) {
        if (!d.user || d.user.role !== 'admin') throw new Error('هذا الحساب ليس حساب مالك (admin)');
        state.token = d.token;
        state.user = d.user;
        sessionStorage.setItem(TOKEN_KEY, d.token);
        sessionStorage.setItem(USER_KEY, JSON.stringify(d.user));
        el('loginPass').value = '';
        showApp();
        if (d.mustChangePassword) {
          toast('يُنصح بتغيير كلمة المرور من إعدادات الحساب', 'info');
          openChangePassword(true);
        }
      })
      .catch(function (err) { toast(err.message, 'error'); })
      .finally(function () { btn.disabled = false; btn.textContent = 'دخول'; });
  });

  function restoreSession() {
    if (!state.token) { showLogin(); return; }
    var cached = sessionStorage.getItem(USER_KEY);
    api('/api/auth/me').then(function (d) {
      if (!d.user || d.user.role !== 'admin') throw new Error('not admin');
      state.user = d.user;
      showApp();
    }).catch(function () {
      doLogout(true);
      showLogin();
    });
  }

  // ===== modals =====
  function closeModal() {
    var root = el('modalRoot');
    root.innerHTML = '';
  }
  function openModal(opts) {
    var root = el('modalRoot');
    root.innerHTML =
      '<div class="modal-overlay" id="modalOverlay"><div class="modal">' +
        '<div class="modal-head"><h3>' + esc(opts.title) + '</h3>' +
        '<button class="modal-close" type="button" aria-label="إغلاق">&times;</button></div>' +
        '<div class="modal-body">' + opts.body + '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" type="button" id="modalCancel">إلغاء</button>' +
          '<button class="btn btn-primary" type="button" id="modalConfirm">' + esc(opts.submitLabel || 'حفظ') + '</button>' +
        '</div>' +
      '</div></div>';
    var overlay = el('modalOverlay');
    function close() { closeModal(); }
    root.querySelector('.modal-close').addEventListener('click', close);
    el('modalCancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    if (opts.onMount) opts.onMount(close);
    el('modalConfirm').addEventListener('click', function () {
      if (opts.onConfirm) opts.onConfirm(close, el('modalConfirm'));
    });
  }

  // ===== tabs =====
  el('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    state.activeTab = b.dataset.tab;
    Array.prototype.forEach.call(el('tabs').children, function (t) { t.classList.toggle('active', t === b); });
    ['categories', 'items', 'settings'].forEach(function (t) {
      el('tab-' + t).classList.toggle('hidden', t !== state.activeTab);
    });
  });

  // ===== data =====
  function refreshAll() {
    Promise.all([
      api('/api/public/admin/categories'),
      api('/api/public/admin/items'),
      api('/api/public/admin/settings')
    ]).then(function (res) {
      state.categories = res[0] || [];
      state.items = res[1] || [];
      state.settings = res[2] || {};
      renderCategories();
      renderItems();
      renderCategoryFilter();
      fillSettings();
      el('publicUrlHint').textContent = 'رابط المنيو العام: ' + location.origin + '/menu';
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  // ===== categories =====
  function renderCategories() {
    var wrap = el('catList');
    if (!state.categories.length) {
      wrap.innerHTML = '<div class="empty">لا توجد تصنيفات بعد. أضف تصنيفاً أو استورد من الكاشير.</div>';
      return;
    }
    wrap.innerHTML = state.categories.map(function (c, i) {
      var count = state.items.filter(function (it) { return Number(it.category_id) === Number(c.id); }).length;
      return '<div class="cat-row' + (Number(c.is_visible) ? '' : ' hidden-cat') + '" draggable="true" data-id="' + c.id + '" data-index="' + i + '">' +
        '<span class="drag" title="اسحب">≡</span>' +
        '<div class="grow"><div class="name">' + (c.icon ? esc(c.icon) + ' ' : '') + esc(c.name_ar) + '</div>' +
        '<div class="meta">' + esc(c.name_en || '') + ' · ' + count + ' منتج · ' + (Number(c.is_visible) ? 'ظاهر' : 'مخفي') + '</div></div>' +
        '<div class="actions">' +
          '<button class="arrow-btn" data-act="up" title="أعلى">▲</button>' +
          '<button class="arrow-btn" data-act="down" title="أسفل">▼</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="toggle">' + (Number(c.is_visible) ? 'إخفاء' : 'إظهار') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="edit">تعديل</button>' +
          '<button class="btn btn-danger btn-sm" data-act="del">حذف</button>' +
        '</div></div>';
    }).join('');
    bindCategoryEvents();
  }

  function bindCategoryEvents() {
    var wrap = el('catList');
    wrap.querySelectorAll('.cat-row').forEach(function (row) {
      var id = Number(row.dataset.id);
      row.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.dataset.act;
          if (act === 'edit') editCategory(id);
          else if (act === 'del') delCategory(id);
          else if (act === 'toggle') toggleCategory(id);
          else if (act === 'up') moveCategory(id, -1);
          else if (act === 'down') moveCategory(id, 1);
        });
      });
    });
    // drag & drop
    var dragId = null;
    wrap.querySelectorAll('.cat-row').forEach(function (row) {
      row.addEventListener('dragstart', function () { dragId = Number(row.dataset.id); row.classList.add('dragging'); });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); wrap.querySelectorAll('.drop-target').forEach(function (r) { r.classList.remove('drop-target'); }); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', function () { row.classList.remove('drop-target'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var targetId = Number(row.dataset.id);
        if (dragId == null || dragId === targetId) return;
        var ids = state.categories.map(function (c) { return Number(c.id); });
        var from = ids.indexOf(dragId), to = ids.indexOf(targetId);
        ids.splice(from, 1); ids.splice(to, 0, dragId);
        saveCategoryOrder(ids);
      });
    });
  }

  function moveCategory(id, dir) {
    var ids = state.categories.map(function (c) { return Number(c.id); });
    var i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    saveCategoryOrder(ids);
  }

  function saveCategoryOrder(ids) {
    api('/api/public/admin/categories/reorder', { method: 'PUT', body: { ids: ids } })
      .then(function () { return api('/api/public/admin/categories'); })
      .then(function (cats) { state.categories = cats; renderCategories(); toast('تم تحديث الترتيب', 'success'); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function toggleCategory(id) {
    var c = state.categories.find(function (x) { return Number(x.id) === id; });
    if (!c) return;
    api('/api/public/admin/categories/' + id, { method: 'PUT', body: { is_visible: Number(c.is_visible) ? 0 : 1 } })
      .then(function () { return api('/api/public/admin/categories'); })
      .then(function (cats) { state.categories = cats; renderCategories(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function editCategory(id) {
    var c = state.categories.find(function (x) { return Number(x.id) === id; }) || { name_ar: '', name_en: '', icon: '' };
    openModal({
      title: id ? 'تعديل تصنيف' : 'تصنيف جديد',
      submitLabel: id ? 'حفظ' : 'إضافة',
      body:
        '<div class="field"><label>الاسم بالعربية *</label><input class="input" id="cNameAr" value="' + esc(c.name_ar) + '"></div>' +
        '<div class="field"><label>الاسم بالإنجليزية</label><input class="input" id="cNameEn" value="' + esc(c.name_en) + '"></div>' +
        '<div class="field"><label>أيقونة (إيموجي اختياري)</label><input class="input" id="cIcon" value="' + esc(c.icon) + '" placeholder="☕"></div>',
      onConfirm: function (close, btn) {
        var body = { name_ar: el('cNameAr').value.trim(), name_en: el('cNameEn').value.trim(), icon: el('cIcon').value.trim() };
        if (!body.name_ar) { toast('اسم التصنيف بالعربية مطلوب', 'error'); return; }
        btn.disabled = true;
        var p = id
          ? api('/api/public/admin/categories/' + id, { method: 'PUT', body: body })
          : api('/api/public/admin/categories', { method: 'POST', body: body });
        p.then(function () { close(); toast(id ? 'تم تعديل التصنيف' : 'تم إضافة التصنيف', 'success'); return refreshAll(); })
          .catch(function (err) { toast(err.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      }
    });
  }

  function delCategory(id) {
    var c = state.categories.find(function (x) { return Number(x.id) === id; });
    if (!confirm('حذف التصنيف "' + (c ? c.name_ar : '') + '"؟ لا يمكن حذف تصنيف يحتوي منتجات.')) return;
    api('/api/public/admin/categories/' + id, { method: 'DELETE' })
      .then(function () { toast('تم حذف التصنيف', 'success'); return refreshAll(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  el('addCatBtn').addEventListener('click', function () { editCategory(0); });

  // ===== items =====
  function renderCategoryFilter() {
    var sel = el('itemCatFilter');
    var cur = sel.value;
    sel.innerHTML = '<option value="">كل التصنيفات</option>' + state.categories.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name_ar) + '</option>';
    }).join('');
    if (cur) sel.value = cur;
  }

  function renderItems() {
    var wrap = el('itemsList');
    var q = state.itemFilter.q.trim().toLowerCase();
    var catId = state.itemFilter.categoryId;
    var list = state.items.filter(function (it) {
      if (catId && Number(it.category_id) !== Number(catId)) return false;
      if (q) {
        var hay = ((it.name_ar || '') + ' ' + (it.name_en || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!list.length) { wrap.innerHTML = '<div class="empty">لا توجد منتجات مطابقة.</div>'; return; }
    wrap.innerHTML = list.map(function (it) {
      var cat = state.categories.find(function (c) { return Number(c.id) === Number(it.category_id); });
      var img = it.thumb_path || it.image_path;
      var thumb = img
        ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<svg viewBox="0 0 24 24"><path d="M2 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6H3zm0 4v2h2v-2H3zm0 4v2h2v-2H3zm4 4h12v-2.5l-3-3-2.5 2.5L18 16.5 18 18H7v-2.5l2-2 2 2 4-4 2 2V6H6.5v2H5V6H3v2h3V6H5z"/></svg>';
      return '<div class="item-row' + (Number(it.is_available) ? '' : ' unavailable') + '">' +
        '<div class="thumb">' + thumb + '</div>' +
        '<div class="body">' +
          '<div class="nm">' + esc(it.name_ar) + (Number(it.is_featured) ? ' ⭐' : '') + '</div>' +
          '<div class="sub">' + esc(cat ? cat.name_ar : '—') + ' · <span class="price">' + money(it.price) + ' ' + esc((state.settings && state.settings.currency) || '') + '</span></div>' +
          '<div class="row-actions">' +
            '<label class="switch"><input type="checkbox" data-act="avail" ' + (Number(it.is_available) ? 'checked' : '') + '><span class="track"></span><span>متاح</span></label>' +
            '<button class="btn btn-ghost btn-sm" data-act="edit">تعديل</button>' +
            '<button class="btn btn-ghost btn-sm" data-act="feat">' + (Number(it.is_featured) ? 'إزالة التمييز' : 'تمييز') + '</button>' +
            '<button class="btn btn-danger btn-sm" data-act="del">حذف</button>' +
          '</div>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('.item-row').forEach(function (row, idx) {
      var it = list[idx];
      row.querySelectorAll('[data-act]').forEach(function (b) {
        var act = b.dataset.act;
        if (act === 'avail') {
          b.addEventListener('change', function () { toggleItem(it.id); });
        } else if (act === 'edit') {
          b.addEventListener('click', function () { editItem(it.id); });
        } else if (act === 'feat') {
          b.addEventListener('click', function () { updateItem(it.id, { is_featured: Number(it.is_featured) ? 0 : 1 }, 'تم تحديث التمييز'); });
        } else if (act === 'del') {
          b.addEventListener('click', function () { delItem(it.id); });
        }
      });
    });
  }

  el('itemSearch').addEventListener('input', function (e) { state.itemFilter.q = e.target.value; renderItems(); });
  el('itemCatFilter').addEventListener('change', function (e) { state.itemFilter.categoryId = e.target.value; renderItems(); });

  function toggleItem(id) {
    api('/api/public/admin/items/' + id + '/toggle', { method: 'POST' })
      .then(function () { return api('/api/public/admin/items'); })
      .then(function (items) { state.items = items; renderItems(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function updateItem(id, body, okMsg) {
    api('/api/public/admin/items/' + id, { method: 'PUT', body: body })
      .then(function () { toast(okMsg || 'تم الحفظ', 'success'); return api('/api/public/admin/items'); })
      .then(function (items) { state.items = items; renderItems(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function delItem(id) {
    var it = state.items.find(function (x) { return Number(x.id) === id; });
    if (!confirm('حذف المنتج "' + (it ? it.name_ar : '') + '"؟')) return;
    api('/api/public/admin/items/' + id, { method: 'DELETE' })
      .then(function () { toast('تم حذف المنتج', 'success'); return refreshAll(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function editItem(id) {
    if (!state.categories.length) { toast('أضف تصنيفاً أولاً', 'error'); return; }
    var it = id ? state.items.find(function (x) { return Number(x.id) === id; }) : null;
    it = it || { name_ar: '', name_en: '', description: '', price: '', category_id: state.categories[0].id, is_available: 1, is_featured: 0, image_path: '', thumb_path: '' };
    var current = { image_path: it.image_path || '', thumb_path: it.thumb_path || '' };
    var catOpts = state.categories.map(function (c) {
      return '<option value="' + c.id + '"' + (Number(c.id) === Number(it.category_id) ? ' selected' : '') + '>' + esc(c.name_ar) + '</option>';
    }).join('');

    openModal({
      title: id ? 'تعديل منتج' : 'منتج جديد',
      submitLabel: id ? 'حفظ' : 'إضافة',
      body:
        '<div class="field-row">' +
          '<div class="field"><label>الاسم بالعربية *</label><input class="input" id="iNameAr" value="' + esc(it.name_ar) + '"></div>' +
          '<div class="field"><label>الاسم بالإنجليزية</label><input class="input" id="iNameEn" value="' + esc(it.name_en) + '"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>التصنيف *</label><select class="select" id="iCat">' + catOpts + '</select></div>' +
          '<div class="field"><label>السعر *</label><input class="input" id="iPrice" type="number" min="0" step="0.5" value="' + esc(it.price) + '"></div>' +
        '</div>' +
        '<div class="field"><label>الوصف</label><textarea class="textarea" id="iDesc" rows="2">' + esc(it.description) + '</textarea></div>' +
        '<div class="field"><label>الصورة</label>' +
          '<div id="imgArea"></div>' +
          '<input type="file" id="iFile" accept="image/jpeg,image/png,image/webp" style="display:none">' +
          '<div class="hint">jpg / png / webp — حتى 5MB. تُحوَّل تلقائياً لصيغة webp بأحجام مناسبة.</div>' +
        '</div>' +
        '<label class="switch" style="margin-inline-end:16px"><input type="checkbox" id="iAvail" ' + (Number(it.is_available) ? 'checked' : '') + '><span class="track"></span><span>متاح</span></label>' +
        '<label class="switch"><input type="checkbox" id="iFeat" ' + (Number(it.is_featured) ? 'checked' : '') + '><span class="track"></span><span>مميّز (الأكثر طلباً)</span></label>',
      onMount: function () {
        renderImgArea();
        el('iFile').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
      },
      onConfirm: function (close, btn) {
        var name_ar = el('iNameAr').value.trim();
        var price = Number(el('iPrice').value);
        if (!name_ar) { toast('اسم المنتج مطلوب', 'error'); return; }
        if (!Number.isFinite(price) || price < 0) { toast('السعر غير صالح', 'error'); return; }
        var body = {
          name_ar: name_ar,
          name_en: el('iNameEn').value.trim(),
          category_id: Number(el('iCat').value),
          price: price,
          description: el('iDesc').value.trim(),
          image_path: current.image_path,
          thumb_path: current.thumb_path,
          is_available: el('iAvail').checked ? 1 : 0,
          is_featured: el('iFeat').checked ? 1 : 0,
        };
        btn.disabled = true;
        var p = id ? api('/api/public/admin/items/' + id, { method: 'PUT', body: body })
                   : api('/api/public/admin/items', { method: 'POST', body: body });
        p.then(function () { close(); toast(id ? 'تم تعديل المنتج' : 'تم إضافة المنتج', 'success'); return refreshAll(); })
          .catch(function (err) { toast(err.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      }
    });

    function renderImgArea() {
      var area = el('imgArea');
      if (current.image_path || current.thumb_path) {
        area.innerHTML =
          '<div class="image-preview">' +
            '<img id="imgPreview" src="' + esc(current.thumb_path || current.image_path) + '" alt="">' +
            '<div><button class="btn btn-ghost btn-sm" type="button" id="imgReplace">استبدال</button> ' +
            '<button class="btn btn-danger btn-sm" type="button" id="imgRemove">إزالة</button></div>' +
          '</div>';
        el('imgReplace').addEventListener('click', function () { el('iFile').click(); });
        el('imgRemove').addEventListener('click', function () { current.image_path = ''; current.thumb_path = ''; renderImgArea(); });
      } else {
        area.innerHTML = '<div class="dropzone" id="dz"><div class="big">🖼️</div><div>اسحب صورة هنا أو اضغط للاختيار</div></div>';
        var dz = el('dz');
        dz.addEventListener('click', function () { el('iFile').click(); });
        ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); }); });
        ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); }); });
        dz.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
      }
    }

    function handleFile(file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('حجم الصورة يتجاوز 5MB', 'error'); return; }
      var dz = el('dz'); if (dz) dz.innerHTML = '<div class="big"><span class="loading-inline loading-dark"></span></div><div>جارٍ الرفع…</div>';
      var fd = new FormData(); fd.append('image', file);
      api('/api/public/admin/upload', { method: 'POST', body: fd })
        .then(function (stored) {
          current.image_path = stored.image_path;
          current.thumb_path = stored.thumb_path;
          toast('تم رفع الصورة', 'success');
          renderImgArea();
        })
        .catch(function (err) { toast(err.message, 'error'); renderImgArea(); });
    }
  }

  el('addItemBtn').addEventListener('click', function () { editItem(0); });

  // ===== settings =====
  function fillSettings() {
    var s = state.settings || {};
    el('setTitle').value = s.title || '';
    el('setSubtitle').value = s.subtitle || '';
    el('setCurrency').value = s.currency || '';
    el('setWhatsapp').value = s.whatsapp || '';
    el('setHideUnavailable').checked = !!s.hideUnavailable;
  }

  el('saveSettingsBtn').addEventListener('click', function () {
    var body = {
      title: el('setTitle').value.trim(),
      subtitle: el('setSubtitle').value.trim(),
      currency: el('setCurrency').value.trim(),
      whatsapp: el('setWhatsapp').value.trim(),
      hideUnavailable: el('setHideUnavailable').checked,
    };
    var btn = el('saveSettingsBtn'); btn.disabled = true;
    api('/api/public/admin/settings', { method: 'PUT', body: body })
      .then(function (s) { state.settings = s; toast('تم حفظ الإعدادات', 'success'); })
      .catch(function (err) { toast(err.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  // ===== QR =====
  el('qrBtn').addEventListener('click', function () {
    var url = location.origin + '/menu';
    openModal({
      title: 'رمز QR للمنيو',
      submitLabel: 'إغلاق',
      body: '<div class="qr-box"><div id="qrHolder"><span class="loading-inline loading-dark"></span></div>' +
        '<div class="url-box"><input class="input" id="qrUrl" value="' + esc(url) + '" readonly>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="copyUrl">نسخ</button></div></div>',
      onMount: function () {
        el('copyUrl').addEventListener('click', function () {
          el('qrUrl').select(); document.execCommand('copy'); toast('تم نسخ الرابط', 'success');
        });
        var hdr = state.token ? { 'Authorization': 'Bearer ' + state.token } : {};
        fetch('/api/public/menu/qr', { headers: hdr })
          .then(function (r) { if (!r.ok) throw new Error('qr ' + r.status); return r.text(); })
          .then(function (svg) { var h = el('qrHolder'); if (h) h.innerHTML = svg; })
          .catch(function () { var h = el('qrHolder'); if (h) h.textContent = 'تعذّر توليد الرمز'; });
      },
      onConfirm: function (close) { close(); }
    });
  });

  // ===== import =====
  el('importBtn').addEventListener('click', function () {
    if (!confirm('استيراد التصنيفات والمنتجات من الكاشير (POS)؟ لن يتكرر الموجود مسبقاً، ولن يمسّ بيانات الكاشير.')) return;
    var btn = el('importBtn'); btn.disabled = true;
    btn.innerHTML = '<span class="loading-inline loading-dark"></span> جارٍ الاستيراد…';
    api('/api/public/admin/import', { method: 'POST' })
      .then(function (r) {
        toast('تم الاستيراد: ' + r.importedCategories + ' تصنيف، ' + r.importedItems + ' منتج (تجاهل ' + r.skippedItems + ')', 'success');
        return refreshAll();
      })
      .catch(function (err) { toast(err.message, 'error'); })
      .finally(function () { btn.disabled = false; btn.textContent = 'استيراد من الكاشير'; });
  });

  // ===== change password =====
  function openChangePassword(force) {
    openModal({
      title: 'تغيير كلمة المرور',
      submitLabel: 'تغيير',
      body:
        '<div class="field"><label>كلمة المرور الحالية</label><input class="input" id="cpOld" type="password"></div>' +
        '<div class="field"><label>كلمة المرور الجديدة (6 أحرف على الأقل)</label><input class="input" id="cpNew" type="password"></div>',
      onConfirm: function (close, btn) {
        var oldP = el('cpOld').value, newP = el('cpNew').value;
        if (!oldP || !newP) { toast('أدخل كلمتي المرور', 'error'); return; }
        if (newP.length < 6) { toast('كلمة المرور الجديدة قصيرة', 'error'); return; }
        btn.disabled = true;
        api('/api/auth/password', { method: 'PUT', body: { currentPassword: oldP, newPassword: newP } })
          .then(function () { close(); toast('تم تغيير كلمة المرور', 'success'); })
          .catch(function (err) { toast(err.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      }
    });
  }

  el('previewBtn').addEventListener('click', function () { window.open('/menu', '_blank'); });

  restoreSession();
})();
