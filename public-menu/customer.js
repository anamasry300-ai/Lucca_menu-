(function () {
  'use strict';

  var state = { data: null, query: '', activeCat: null };

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var PLACEHOLDER = '<div class="thumb-placeholder" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M2 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6H3zm0 4v2h2v-2H3zm0 4v2h2v-2H3zm4 4h12v-2.5l-3-3-2.5 2.5L18 16.5 18 18H7v-2.5l2-2 2 2 4-4 2 2V6H6.5v2H5V6H3v2h3V6H5z"/></svg></div>';

  function renderNav(categories) {
    var nav = el('catNav');
    nav.innerHTML = '';
    categories.forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'cat-chip' + (state.activeCat === c.id ? ' active' : '');
      btn.type = 'button';
      btn.textContent = (c.icon ? c.icon + ' ' : '') + (c.name_ar || c.name_en || '');
      btn.addEventListener('click', function () {
        state.activeCat = c.id;
        Array.prototype.forEach.call(nav.children, function (n) { n.classList.remove('active'); });
        btn.classList.add('active');
        var section = document.getElementById('cat-' + c.id);
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(btn);
    });
  }

  function itemCard(item, currency) {
    var hasImg = !!(item.thumb_path || item.image_path);
    var img = hasImg
      ? '<img src="' + escapeHtml(item.thumb_path || item.image_path) + '" alt="' + escapeHtml(item.name_ar) + '" loading="lazy" decoding="async" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.style.display=\'flex\')">' +
        '<div class="thumb-placeholder" style="display:none">' +
        '<svg viewBox="0 0 24 24"><path d="M2 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6H3zm0 4v2h2v-2H3zm0 4v2h2v-2H3zm4 4h12v-2.5l-3-3-2.5 2.5L18 16.5 18 18H7v-2.5l2-2 2 2 4-4 2 2V6H6.5v2H5V6H3v2h3V6H5z"/></svg></div>'
      : PLACEHOLDER;

    return '<article class="item-card' + (item.is_available ? '' : ' is-unavailable') + '">' +
      '<div class="item-thumb">' + img + '</div>' +
      '<div class="item-body">' +
        '<div class="item-head">' +
          '<div>' +
            '<div class="item-name">' + escapeHtml(item.name_ar) + '</div>' +
            (item.name_en ? '<div class="item-en">' + escapeHtml(item.name_en) + '</div>' : '') +
          '</div>' +
          '<div class="item-price">' + Number(item.price || 0).toLocaleString('ar-EG') +
            '<span class="cur">' + escapeHtml(currency || 'ج.م') + '</span></div>' +
        '</div>' +
        (item.description ? '<div class="item-desc">' + escapeHtml(item.description) + '</div>' : '') +
        (item.is_featured ? '<span class="badge-featured">الأكثر طلباً</span>' : '') +
        (!item.is_available ? '<span class="badge-unavailable">غير متاح حالياً</span>' : '') +
      '</div>' +
    '</article>';
  }

  function render() {
    var main = el('menuMain');
    if (!state.data) return;
    var categories = state.data.categories || [];
    var currency = (state.data.settings && state.data.settings.currency) || 'ج.م';
    var q = state.query.trim().toLowerCase();

    var html = '';
    var visibleCount = 0;
    categories.forEach(function (c) {
      var items = (c.items || []).filter(function (it) {
        if (!q) return true;
        return (it.name_ar || '').toLowerCase().indexOf(q) >= 0 ||
          (it.name_en || '').toLowerCase().indexOf(q) >= 0 ||
          (it.description || '').toLowerCase().indexOf(q) >= 0;
      });
      if (q && items.length === 0) return;
      visibleCount += items.length;
      html += '<section class="cat-section" id="cat-' + c.id + '">' +
        '<h2 class="cat-title">' + (c.icon ? '<span class="icon">' + escapeHtml(c.icon) + '</span>' : '') +
        escapeHtml(c.name_ar || c.name_en || '') + '</h2>' +
        '<div class="items-grid">' + items.map(function (it) { return itemCard(it, currency); }).join('') + '</div>' +
      '</section>';
    });

    if (visibleCount === 0) {
      main.innerHTML = '<div class="empty-state"><div class="big">☕</div>' +
        (q ? 'لا نتائج مطابقة للبحث' : 'المنيو قيد التحديث، جرّب لاحقاً') + '</div>';
      return;
    }
    main.innerHTML = html;
  }

  function applySettings() {
    if (!state.data || !state.data.settings) return;
    var s = state.data.settings;
    if (s.title) {
      var parts = String(s.title).trim().split(/\s+/);
      el('brandTitle').textContent = (parts[0] || 'LUCCA').toUpperCase();
      el('brandSubtitle').textContent = parts.slice(1).join(' ') || 'SPECIALTY COFFEE';
    }
    if (s.subtitle) el('footerNote').textContent = s.subtitle;
    if (s.whatsapp) {
      var fab = el('whatsappFab');
      fab.href = 'https://wa.me/' + String(s.whatsapp).replace(/[^\d]/g, '');
      fab.hidden = false;
    }
  }

  function showError() {
    el('menuMain').innerHTML = '<div class="error-state"><div class="big">⚠️</div>' +
      '<div>تعذّر تحميل المنيو. تأكد من الاتصال بالشبكة.</div>' +
      '<button class="retry-btn" id="retryBtn" type="button">إعادة المحاولة</button></div>';
    var rb = el('retryBtn');
    if (rb) rb.addEventListener('click', load);
  }

  function load() {
    el('menuMain').innerHTML = '<div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    fetch('/api/public/menu', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        state.data = data;
        state.activeCat = data.categories && data.categories[0] ? data.categories[0].id : null;
        applySettings();
        renderNav(data.categories || []);
        render();
      })
      .catch(showError);
  }

  el('searchInput').addEventListener('input', function (e) {
    state.query = e.target.value || '';
    render();
  });

  load();
})();
