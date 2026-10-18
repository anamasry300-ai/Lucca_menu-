/* Public Menu admin — integrated into the Electron admin panel (admin/index.html).
   Talks to the Lucca backend public-menu admin API using the same session token
   the rest of the panel uses (sessionStorage luccaToken / localStorage luccaApiKey). */
(function () {
  'use strict';

  var state = { categories: [], items: [], settings: {} };
  var current = { image_path: '', thumb_path: '' };

  function el(id) { return document.getElementById(id); }
  function serverUrl() {
    var u = (typeof getServerUrl === 'function' ? getServerUrl() : '') || 'http://localhost:3000';
    return String(u).replace(/\/+$/, '');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) { return (Number(n) || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 }); }
  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'success');
    else alert(msg);
  }

  function authHeaders(extra) {
    var h = extra || {};
    var t = '';
    try { t = sessionStorage.getItem('luccaToken') || ''; } catch (e) {}
    if (t) h['Authorization'] = 'Bearer ' + t;
    else {
      var k = '';
      try { k = localStorage.getItem('luccaApiKey') || ''; } catch (e) {}
      if (k) h['x-api-key'] = k;
    }
    return h;
  }

  function api(method, path, body) {
    var full = '/api/public/admin' + path;
    // تحت Electron: الريندرر لا يحمل التوكن — المرور عبر بروكسي العملية الرئيسية (JSON فقط).
    if (window.electronAPI && typeof window.electronAPI.apiRequest === 'function') {
      var pb = (body instanceof FormData) ? undefined : body;
      return window.electronAPI.apiRequest(method || 'GET', full, pb).then(function (r) {
        var status = r ? r.status : 0;
        var data = r ? r.json : null;
        if (status === 401) throw new Error('انتهت الجلسة أو لا يوجد تسجيل دخول — سجّل الدخول من جديد');
        if (status === 403) throw new Error('هذه العملية تتطلب حساب مالك (admin)');
        if (!(status >= 200 && status < 300)) throw new Error((data && data.error) || ('خطأ ' + status));
        return data;
      });
    }
    var cfg = { method: method || 'GET', headers: authHeaders({}) };
    if (body !== undefined && !(body instanceof FormData)) {
      cfg.headers['Content-Type'] = 'application/json';
      cfg.body = JSON.stringify(body || {});
    } else if (body instanceof FormData) {
      cfg.body = body;
    }
    return fetch(serverUrl() + full, cfg).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return (ct.indexOf('json') > -1 ? res.json() : res.text()).then(function (data) {
        if (res.status === 401) throw new Error('انتهت الجلسة — عُد إلى نقطة البيع وأعد تسجيل الدخول');
        if (res.status === 403) throw new Error('هذه العملية تتطلب حساب مالك (admin)');
        if (!res.ok) throw new Error((data && data.error) || ('خطأ ' + res.status));
        return data;
      });
    });
  }

  function isElectron() {
    return !!(window.electronAPI && typeof window.electronAPI.apiRequest === 'function');
  }

  // تحت Electron لا يدعم بروكسي الجلسة multipart → نصغّر الصورة محلياً ونرسلها base64 JSON.
  function fileToDownscaledBase64(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          var out = canvas.toDataURL('image/webp', quality);
          if (out.indexOf('image/webp') < 0) out = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          resolve(out.replace(/^data:[^,]+,/, ''));
        } catch (err) { URL.revokeObjectURL(url); reject(new Error('تعذّر معالجة الصورة')); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('تعذّر قراءة الصورة')); };
      img.src = url;
    });
  }

  function setOffline(on) {
    var n = el('menuOfflineNote');
    if (n) n.style.display = on ? '' : 'none';
  }

  // ===== load & render =====
  function loadPublicMenu() {
    if (!el('page-menu-page')) return;
    setOffline(false);
    setStatus('جارٍ التحميل…');
    return Promise.all([
      api('GET', '/categories'),
      api('GET', '/items'),
      api('GET', '/settings')
    ]).then(function (res) {
      state.categories = res[0] || [];
      state.items = res[1] || [];
      state.settings = res[2] || {};
      setOffline(false);
      renderMenuCategories();
      renderMenuItems();
      renderMenuCatFilter();
      setStatus(state.categories.length + ' قسم · ' + state.items.length + ' منتج');
    }).catch(function (err) {
      setOffline(true);
      setStatus('');
      toast(err.message, 'error');
    });
  }

  function setStatus(t) {
    var s = el('menuStatusLine');
    if (s) s.textContent = t || '';
  }

  function renderMenuCatFilter() {
    var sel = el('menuItemCatFilter');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">كل الأقسام</option>' + state.categories.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name_ar) + '</option>';
    }).join('');
    if (cur) sel.value = cur;
  }

  function renderMenuCategories() {
    var body = el('menuCatsBody');
    if (!body) return;
    if (!state.categories.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:20px">لا توجد أقسام بعد — أضف قسماً أو استورد من الكاشير.</td></tr>';
      return;
    }
    body.innerHTML = state.categories.map(function (c, i) {
      var count = state.items.filter(function (it) { return Number(it.category_id) === Number(c.id); }).length;
      var vis = Number(c.is_visible) ? 1 : 0;
      return '<tr>' +
        '<td style="font-size:1.2rem">' + esc(c.icon || '📂') + '</td>' +
        '<td>' + esc(c.name_ar) + '<div style="font-size:.75rem;color:var(--text-secondary)">' + count + ' منتج</div></td>' +
        '<td style="color:var(--text-secondary)">' + esc(c.name_en || '') + '</td>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><span class="badge ' + (vis ? 'badge-success' : 'badge-neutral') + '">' + (vis ? 'ظاهر' : 'مخفي') + '</span></td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-ghost btn-sm" onclick="menuMoveCategory(' + c.id + ',-1)" title="أعلى">▲</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuMoveCategory(' + c.id + ',1)" title="أسفل">▼</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuToggleCategory(' + c.id + ')" title="' + (vis ? 'إخفاء' : 'إظهار') + '">' + (vis ? '🔒' : '🔓') + '</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuEditCategory(' + c.id + ')" title="تعديل">✏️</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuDeleteCategory(' + c.id + ')" title="حذف">🗑️</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function renderMenuItems() {
    var body = el('menuItemsBody');
    if (!body) return;
    var q = (el('menuItemSearch') ? el('menuItemSearch').value : '').trim().toLowerCase();
    var catId = el('menuItemCatFilter') ? el('menuItemCatFilter').value : '';
    var list = state.items.filter(function (it) {
      if (catId && Number(it.category_id) !== Number(catId)) return false;
      if (q) {
        var hay = ((it.name_ar || '') + ' ' + (it.name_en || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px">لا توجد منتجات مطابقة.</td></tr>';
      return;
    }
    var cur = (state.settings && state.settings.currency) || '';
    body.innerHTML = list.map(function (it) {
      var cat = state.categories.filter(function (c) { return Number(c.id) === Number(it.category_id); })[0];
      var img = it.thumb_path || it.image_path;
      var thumb = img
        ? '<img src="' + esc(serverUrl() + img) + '" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px" onerror="this.style.visibility=\'hidden\'">'
        : '<div style="width:44px;height:44px;border-radius:8px;background:var(--border-light);display:flex;align-items:center;justify-content:center">🍽️</div>';
      var avail = Number(it.is_available) ? 1 : 0;
      var feat = Number(it.is_featured) ? 1 : 0;
      return '<tr>' +
        '<td>' + thumb + '</td>' +
        '<td>' + esc(it.name_ar) + (it.name_en ? '<div style="font-size:.75rem;color:var(--text-secondary)">' + esc(it.name_en) + '</div>' : '') + '</td>' +
        '<td style="color:var(--text-secondary)">' + esc(cat ? cat.name_ar : '—') + '</td>' +
        '<td>' + money(it.price) + ' ' + esc(cur) + '</td>' +
        '<td><span class="badge ' + (avail ? 'badge-success' : 'badge-danger') + '">' + (avail ? 'متاح' : 'غير متاح') + '</span></td>' +
        '<td>' + (feat ? '⭐' : '—') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-ghost btn-sm" onclick="menuToggleItem(' + it.id + ')" title="' + (avail ? 'تعطيل الإتاحة' : 'تفعيل الإتاحة') + '">' + (avail ? '🔒' : '🔓') + '</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuToggleFeatured(' + it.id + ')" title="تمييز">' + (feat ? '★' : '☆') + '</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuEditItem(' + it.id + ')" title="تعديل">✏️</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuDeleteItem(' + it.id + ')" title="حذف">🗑️</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  // ===== modal helper =====
  function fillModal(html) {
    var box = el('menuModalContent');
    if (box) box.innerHTML = html;
    if (typeof openModal === 'function') openModal('menuModal');
  }
  function closeMenuModal() { if (typeof closeModal === 'function') closeModal('menuModal'); }

  // ===== category actions =====
  function menuEditCategory(id) {
    var c = state.categories.filter(function (x) { return Number(x.id) === Number(id); })[0] ||
      { name_ar: '', name_en: '', icon: '' };
    fillModal(
      '<div class="modal-header"><h3>' + (id ? 'تعديل قسم' : 'قسم جديد') + '</h3>' +
        '<button class="modal-close" onclick="closeMenuModal()">✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="modal-field"><label>الاسم بالعربية *</label><input type="text" id="mcNameAr" value="' + esc(c.name_ar) + '"></div>' +
        '<div class="modal-field"><label>الاسم بالإنجليزية</label><input type="text" id="mcNameEn" value="' + esc(c.name_en) + '"></div>' +
        '<div class="modal-field"><label>أيقونة (إيموجي اختياري)</label><input type="text" id="mcIcon" value="' + esc(c.icon) + '" placeholder="☕"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-ghost" onclick="closeMenuModal()">إلغاء</button>' +
        '<button class="btn btn-primary" onclick="menuSaveCategory(' + (id || 0) + ')">' + (id ? 'حفظ' : 'إضافة') + '</button>' +
      '</div>'
    );
  }

  function menuSaveCategory(id) {
    var body = {
      name_ar: (el('mcNameAr').value || '').trim(),
      name_en: (el('mcNameEn').value || '').trim(),
      icon: (el('mcIcon').value || '').trim(),
    };
    if (!body.name_ar) { toast('اسم القسم بالعربية مطلوب', 'error'); return; }
    var p = id ? api('PUT', '/categories/' + id, body) : api('POST', '/categories', body);
    p.then(function () { closeMenuModal(); toast(id ? 'تم تعديل القسم' : 'تم إضافة القسم'); return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuToggleCategory(id) {
    var c = state.categories.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!c) return;
    api('PUT', '/categories/' + id, { is_visible: Number(c.is_visible) ? 0 : 1 })
      .then(function () { return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuDeleteCategory(id) {
    var c = state.categories.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!confirm('حذف القسم "' + (c ? c.name_ar : '') + '"؟ لا يمكن حذف قسم يحتوي منتجات.')) return;
    api('DELETE', '/categories/' + id)
      .then(function () { toast('تم حذف القسم'); return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuMoveCategory(id, dir) {
    var ids = state.categories.map(function (c) { return Number(c.id); });
    var i = ids.indexOf(Number(id)), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    api('PUT', '/categories/reorder', { ids: ids })
      .then(function () { return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  // ===== item actions =====
  function menuEditItem(id) {
    if (!state.categories.length) { toast('أضف قسماً أولاً', 'error'); return; }
    var it = (id && state.items.filter(function (x) { return Number(x.id) === Number(id); })[0]) ||
      { name_ar: '', name_en: '', description: '', price: '', category_id: state.categories[0].id, is_available: 1, is_featured: 0, image_path: '', thumb_path: '' };
    current = { image_path: it.image_path || '', thumb_path: it.thumb_path || '' };
    var catOpts = state.categories.map(function (c) {
      return '<option value="' + c.id + '"' + (Number(c.id) === Number(it.category_id) ? ' selected' : '') + '>' + esc(c.name_ar) + '</option>';
    }).join('');
    fillModal(
      '<div class="modal-header"><h3>' + (id ? 'تعديل منتج' : 'منتج جديد') + '</h3>' +
        '<button class="modal-close" onclick="closeMenuModal()">✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="modal-field-row">' +
          '<div class="modal-field"><label>الاسم بالعربية *</label><input type="text" id="miNameAr" value="' + esc(it.name_ar) + '"></div>' +
          '<div class="modal-field"><label>الاسم بالإنجليزية</label><input type="text" id="miNameEn" value="' + esc(it.name_en) + '"></div>' +
        '</div>' +
        '<div class="modal-field-row">' +
          '<div class="modal-field"><label>القسم *</label><select id="miCat">' + catOpts + '</select></div>' +
          '<div class="modal-field"><label>السعر *</label><input type="number" id="miPrice" min="0" step="0.5" value="' + esc(it.price) + '"></div>' +
        '</div>' +
        '<div class="modal-field"><label>الوصف</label><textarea id="miDesc" style="min-height:50px">' + esc(it.description) + '</textarea></div>' +
        '<div class="modal-field"><label>الصورة</label><div id="miImgArea"></div>' +
          '<input type="file" id="miFile" accept="image/jpeg,image/png,image/webp" style="display:none">' +
          '<div style="font-size:.75rem;color:var(--text-secondary);margin-top:6px">jpg / png / webp — حتى 5MB. تُحوَّل تلقائياً إلى webp بأحجام مناسبة.</div>' +
        '</div>' +
        '<label style="display:inline-flex;align-items:center;gap:8px;margin-inline-end:18px"><input type="checkbox" id="miAvail" ' + (Number(it.is_available) ? 'checked' : '') + '> متاح</label>' +
        '<label style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" id="miFeat" ' + (Number(it.is_featured) ? 'checked' : '') + '> مميّز (الأكثر طلباً)</label>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-ghost" onclick="closeMenuModal()">إلغاء</button>' +
        '<button class="btn btn-primary" onclick="menuSaveItem(' + (id || 0) + ')">' + (id ? 'حفظ' : 'إضافة') + '</button>' +
      '</div>'
    );
    renderMenuImageArea();
    var f = el('miFile');
    if (f) f.addEventListener('change', function (e) { menuUploadImage(e.target.files[0]); });
  }

  function renderMenuImageArea() {
    var area = el('miImgArea');
    if (!area) return;
    if (current.image_path || current.thumb_path) {
      area.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<img src="' + esc(serverUrl() + (current.thumb_path || current.image_path)) + '" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">' +
          '<div><button class="btn btn-ghost btn-sm" onclick="menuReplaceImage()">استبدال</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="menuRemoveImage()">إزالة</button></div>' +
        '</div>';
    } else {
      area.innerHTML =
        '<div id="miDrop" style="border:2px dashed var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--text-secondary);cursor:pointer">' +
          '🖼️ اسحب صورة هنا أو اضغط للاختيار</div>';
      var dz = el('miDrop');
      if (dz) {
        dz.addEventListener('click', function () { var f = el('miFile'); if (f) f.click(); });
        ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.style.borderColor = 'var(--primary)'; }); });
        ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.style.borderColor = 'var(--border)'; }); });
        dz.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) menuUploadImage(e.dataTransfer.files[0]); });
      }
    }
  }

  function menuRemoveImage() { current.image_path = ''; current.thumb_path = ''; renderMenuImageArea(); }

  function menuReplaceImage() { var f = el('miFile'); if (f) f.click(); }

  function menuUploadImage(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('حجم الصورة يتجاوز 5MB', 'error'); return; }
    var dz = el('miDrop');
    if (dz) dz.innerHTML = 'جارٍ الرفع…';
    var p;
    if (isElectron()) {
      p = fileToDownscaledBase64(file, 1400, 0.85).then(function (b64) {
        return api('POST', '/upload-base64', { data: b64 });
      });
    } else {
      var fd = new FormData();
      fd.append('image', file);
      p = api('POST', '/upload', fd);
    }
    p.then(function (stored) {
      current.image_path = stored.image_path || '';
      current.thumb_path = stored.thumb_path || '';
      toast('تم رفع الصورة');
      renderMenuImageArea();
    }).catch(function (err) { toast(err.message, 'error'); renderMenuImageArea(); });
  }

  function menuSaveItem(id) {
    var name_ar = (el('miNameAr').value || '').trim();
    var price = Number(el('miPrice').value);
    if (!name_ar) { toast('اسم المنتج مطلوب', 'error'); return; }
    if (!isFinite(price) || price < 0) { toast('السعر غير صالح', 'error'); return; }
    var body = {
      name_ar: name_ar,
      name_en: (el('miNameEn').value || '').trim(),
      category_id: Number(el('miCat').value),
      price: price,
      description: (el('miDesc').value || '').trim(),
      image_path: current.image_path,
      thumb_path: current.thumb_path,
      is_available: el('miAvail').checked ? 1 : 0,
      is_featured: el('miFeat').checked ? 1 : 0,
    };
    var p = id ? api('PUT', '/items/' + id, body) : api('POST', '/items', body);
    p.then(function () { closeMenuModal(); toast(id ? 'تم تعديل المنتج' : 'تم إضافة المنتج'); return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuToggleItem(id) {
    api('POST', '/items/' + id + '/toggle')
      .then(function () { return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuToggleFeatured(id) {
    var it = state.items.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!it) return;
    api('PUT', '/items/' + id, { is_featured: Number(it.is_featured) ? 0 : 1 })
      .then(function () { return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuDeleteItem(id) {
    var it = state.items.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!confirm('حذف المنتج "' + (it ? it.name_ar : '') + '"؟')) return;
    api('DELETE', '/items/' + id)
      .then(function () { toast('تم حذف المنتج'); return loadPublicMenu(); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  // ===== settings =====
  function menuOpenSettings() {
    var s = state.settings || {};
    fillModal(
      '<div class="modal-header"><h3>إعدادات المنيو العام</h3>' +
        '<button class="modal-close" onclick="closeMenuModal()">✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="modal-field"><label>عنوان المنيو</label><input type="text" id="msTitle" value="' + esc(s.title || '') + '"></div>' +
        '<div class="modal-field"><label>النص أسفل الصفحة</label><input type="text" id="msSubtitle" value="' + esc(s.subtitle || '') + '"></div>' +
        '<div class="modal-field-row">' +
          '<div class="modal-field"><label>رمز العملة</label><input type="text" id="msCurrency" value="' + esc(s.currency || '') + '"></div>' +
          '<div class="modal-field"><label>واتساب (اختياري)</label><input type="text" id="msWhatsapp" value="' + esc(s.whatsapp || '') + '" placeholder="201234567890"></div>' +
        '</div>' +
        '<label style="display:block;margin-bottom:8px"><input type="checkbox" id="msHide" ' + (s.hideUnavailable ? 'checked' : '') + '> إخفاء المنتجات غير المتاحة للعملاء</label>' +
        '<div style="font-size:12px;color:#888;margin-bottom:8px">أسعار المنيو العام تُدار يدوياً هنا، وهي مستقلة عن الكاشير (POS). زر «استيراد من الكاشير» يأخذ لقطة لمرة واحدة ولا تُزامَن الأسعار تلقائياً.</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-ghost" onclick="closeMenuModal()">إلغاء</button>' +
        '<button class="btn btn-primary" onclick="menuSaveSettings()">حفظ الإعدادات</button>' +
      '</div>'
    );
  }

  function menuSaveSettings() {
    var body = {
      title: (el('msTitle').value || '').trim(),
      subtitle: (el('msSubtitle').value || '').trim(),
      currency: (el('msCurrency').value || '').trim(),
      whatsapp: (el('msWhatsapp').value || '').trim(),
      hideUnavailable: el('msHide').checked,
    };
    api('PUT', '/settings', body)
      .then(function (s) { state.settings = s; closeMenuModal(); toast('تم حفظ الإعدادات'); })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  // ===== QR / preview / import =====
  function menuPreview() {
    var w = window.open(serverUrl() + '/menu', '_blank');
    if (!w) toast('تعذّر فتح المعاينة — تحقق من السماح بالنوافذ', 'error');
  }

  function menuShowQr() {
    var url = serverUrl() + '/menu';
    fillModal(
      '<div class="modal-header"><h3>رمز QR للمنيو</h3>' +
        '<button class="modal-close" onclick="closeMenuModal()">✕</button></div>' +
      '<div class="modal-body" style="text-align:center">' +
        '<div id="msQrHolder">جارٍ التوليد…</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
          '<input type="text" id="msQrUrl" value="' + esc(url) + '" readonly style="flex:1">' +
          '<button class="btn btn-secondary" onclick="menuCopyQrUrl()">نسخ</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer"><button class="btn btn-primary" onclick="closeMenuModal()">إغلاق</button></div>'
    );
    var qrPath = '/api/public/menu/qr';
    var qr;
    if (isElectron()) {
      // QR مقصور على admin، والريندرر بلا توكن — نمرّ عبر بروكسي الجلسة بصيغة JSON.
      qr = window.electronAPI.apiRequest('GET', qrPath + '?format=json').then(function (r) {
        if (!r || !(r.status >= 200 && r.status < 300) || !r.json || !r.json.svg) throw new Error('qr ' + (r && r.status));
        return r.json.svg;
      });
    } else {
      qr = fetch(serverUrl() + qrPath, { headers: authHeaders({}) })
        .then(function (r) { if (!r.ok) throw new Error('qr ' + r.status); return r.text(); });
    }
    qr.then(function (svg) { var h = el('msQrHolder'); if (h) h.innerHTML = svg; })
      .catch(function () { var h = el('msQrHolder'); if (h) h.textContent = 'تعذّر توليد الرمز — تأكد من تشغيل الخادم.'; });
  }

  function menuCopyQrUrl() {
    var i = el('msQrUrl');
    if (!i) return;
    i.select(); try { document.execCommand('copy'); } catch (e) {}
    toast('تم نسخ الرابط');
  }

  function menuImportPos() {
    if (!confirm('استيراد الأقسام والمنتجات من الكاشير (POS)؟ لن يتكرر الموجود مسبقاً ولن يمسّ بيانات الكاشير.')) return;
    api('POST', '/import')
      .then(function (r) {
        toast('تم الاستيراد: ' + r.importedCategories + ' قسم، ' + r.importedItems + ' منتج (تجاهل ' + r.skippedItems + ')');
        return loadPublicMenu();
      })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function menuRefresh() { loadPublicMenu(); }

  // ===== exports =====
  window.loadPublicMenu = loadPublicMenu;
  window.renderMenuItems = renderMenuItems;
  window.renderMenuCatFilter = renderMenuCatFilter;
  window.menuRefresh = menuRefresh;
  window.menuPreview = menuPreview;
  window.menuShowQr = menuShowQr;
  window.menuOpenSettings = menuOpenSettings;
  window.menuImportPos = menuImportPos;
  window.menuEditCategory = menuEditCategory;
  window.menuSaveCategory = menuSaveCategory;
  window.menuToggleCategory = menuToggleCategory;
  window.menuDeleteCategory = menuDeleteCategory;
  window.menuMoveCategory = menuMoveCategory;
  window.menuEditItem = menuEditItem;
  window.menuSaveItem = menuSaveItem;
  window.menuToggleItem = menuToggleItem;
  window.menuToggleFeatured = menuToggleFeatured;
  window.menuDeleteItem = menuDeleteItem;
  window.menuUploadImage = menuUploadImage;
  window.menuRemoveImage = menuRemoveImage;
  window.menuReplaceImage = menuReplaceImage;
  window.menuSaveSettings = menuSaveSettings;
  window.menuCopyQrUrl = menuCopyQrUrl;
  window.closeMenuModal = closeMenuModal;
})();
