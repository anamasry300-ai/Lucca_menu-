/*
╔══════════════════════════════════════════════════════════════╗
║   LUCCA Admin — فحص حالة النظام (Health Checks)                ║
║   كل فحص حقيقي عبر الواجهات الفعلية: LuccaDB, ServerAPI,      ║
║   OllamaAI, AdminAnalytics — لا قيم افتراضية ثابتة إطلاقاً.    ║
║   يُستخدم من: صفحة «حالة النظام» + أداة getSystemHealth لدى    ║
║   باتمان (نفس المصدر — لا منطق مكرر).                          ║
╚══════════════════════════════════════════════════════════════╝
*/
(function (global) {
  'use strict';

  function nowISO() { return new Date().toISOString(); }
  function sig(key, label, ok, detail, state) {
    return { key: key, label: label, ok: !!ok, state: state || (ok ? 'ok' : 'bad'), detail: detail || '', ts: nowISO() };
  }

  function fetchTimeout(url, opts) {
    var ms = (opts && opts.timeout) || 4000;
    var c = new AbortController();
    var t = setTimeout(function () { try { c.abort(); } catch (_) {} }, ms);
    var headers = (opts && opts.headers) || undefined;
    return fetch(url, { signal: c.signal, headers: headers }).then(function (r) {
      clearTimeout(t);
      return r;
    }).catch(function (e) {
      clearTimeout(t);
      var err = e || new Error('fetch failed');
      err.timedOut = (err.name === 'AbortError');
      throw err;
    });
  }

  async function probe() {
    var out = [];
    var mode = 'local';
    try { mode = String(localStorage.getItem('luccaDataMode') || 'local'); } catch (_) {}
    out.push(sig('mode', 'مصدر البيانات',
      mode === 'local' || mode === 'supabase',
      mode === 'supabase' ? 'سحابي (Supabase OLTP + CRDT)' : 'محلي (خادم خارجي + SQLite/MultiSync)', 'info'));

    // 1) الواجهة الأمامية (Frontend)
    var libs = [];
    if (global.LuccaDB) libs.push('LuccaDB');
    if (global.AdminAnalytics) libs.push('AdminAnalytics');
    if (global.OllamaAI) libs.push('OllamaAI');
    if (global.BatmanQueries) libs.push('BatmanQueries');
    if (global.SystemHealth) libs.push('SystemHealth');
    if (global.ServerAPI) libs.push('ServerAPI');
    var lastMod = (global.document && document.lastModified) ? (' — آخر تحديث ملف: ' + document.lastModified) : '';
    out.push(sig('frontend', 'الواجهة الأمامية', libs.length >= 5,
      'المكتبات المحمّلة: ' + (libs.join('، ') || '—') + lastMod));

    // 2) قاعدة البيانات المحلية (IndexedDB / SQLite)
    try {
      var ldb = global.LuccaDB;
      if (!ldb || !ldb.db || typeof ldb.db.getAll !== 'function') throw new Error('LuccaDB غير محمّل (db غير متاح)');
      var ordersCount = (await ldb.db.getAll('orders')).length;
      var productsCount = (await ldb.db.getAll('products')).length;
      var expCount = (await ldb.db.getAll('expenses')).length;
      var ver = '';
      if (ldb.db.version) ver = ' v' + String(ldb.db.version);
      var stores = '';
      if (ldb.db.objectStoreNames) stores = ' — ' + String(ldb.db.objectStoreNames.length) + ' مخزن';
      out.push(sig('database', 'قاعدة البيانات', true,
        'متاحة' + ver + ' — طلبات: ' + ordersCount + '، منتجات: ' + productsCount + '، مصروفات: ' + expCount + stores));
    } catch (e) {
      out.push(sig('database', 'قاعدة البيانات', false, String(e && e.message || e)));
    }

    // 3) الخادم الخلفي (Backend)
    var base = 'http://localhost:3000';
    try { base = global.ServerAPI ? global.ServerAPI.getBaseUrl() : (localStorage.getItem('luccaServerUrl') || base); } catch (_) {}
    var baseH = String(base).replace(/\/+$/, '');
    try {
      var hr = await fetchTimeout(baseH + '/health');
      var hj = null; try { hj = await hr.clone().json(); } catch (_) {}
      out.push(sig('backend', 'الخادم الخلفي', hr.ok && (!hj || hj.status === 'ok'),
        baseH + ' → GET /health HTTP ' + hr.status + (hj && hj.status === 'ok' ? ' (ok)' : '')));
    } catch (e) {
      out.push(sig('backend', 'الخادم الخلفي', false, baseH + ' — ' + (e && e.timedOut ? 'مهلة الاتصال' : 'غير متصل')));
    }

    // 4) API والمصادقة
    try {
      var tok = global.ServerAPI ? global.ServerAPI.getToken() : '';
      var apiKey = '';
      try { apiKey = localStorage.getItem('luccaApiKey') || ''; } catch (_) {}
      if (tok) {
        var me = await fetchTimeout(baseH + '/api/auth/me', { headers: global.ServerAPI.authHeaders('application/json') });
        out.push(sig('api', 'API والمصادقة', me.ok,
          me.ok ? 'جلسة فعّالة (الحساب صالح)' : ('HTTP ' + me.status)));
      } else if (apiKey) {
        out.push(sig('api', 'API والمصادقة', true, 'وضع مفتاح جهاز مفعّل (device key)', 'info'));
      } else {
        out.push(sig('api', 'API والمصادقة', false, 'لا جلسة نشطة ولا مفتاح جهاز — سجّل الدخول'));
      }
    } catch (e) {
      out.push(sig('api', 'API والمصادقة', false, String(e && e.message || e)));
    }

    // 5) Ollama المحلي
    if (global.OllamaAI) {
      try {
        var okO = await global.OllamaAI.isAvailable(true);
        var models = [];
        try { var lm = await global.OllamaAI.listModels(true); models = Array.isArray(lm) ? lm : (Array.isArray(lm && lm.models) ? lm.models : []); } catch (_) {}
        out.push(sig('ollama', 'Ollama (الذكاء المحلي)', !!okO,
          okO ? ('النموذج: ' + (global.OllamaAI.model || '—') + (models.length ? ' — متاح: ' + models.map(function (m) { return (m.name || m.id || m.model || m); }).join('، ') : '')) : 'لا استجابة من Ollama'));
      } catch (e) {
        out.push(sig('ollama', 'Ollama (الذكاء المحلي)', false, String(e && e.message || e)));
      }
    } else {
      out.push(sig('ollama', 'Ollama (الذكاء المحلي)', false, 'المحول ollama-adapter.js غير محمّل'));
    }

    // 6) محرك النص / باتمان (قراءة فقط)
    if (global.OllamaAI && typeof global.OllamaAI.llmReady === 'function') {
      try {
        var ready = await global.OllamaAI.llmReady();
        var tools = [];
        try { tools = global.OllamaAI.registeredTools() || []; } catch (_) {}
        out.push(sig('ai', 'الذكاء النصي (باتمان)',
          !!ready && tools.length > 0,
          ready ? ('جاهز — ' + (global.OllamaAI.model || '—') + ' — ' + tools.length + ' أداة قراءة مسجلة') : 'محرك الذكاء غير جاهز'));
      } catch (e) {
        out.push(sig('ai', 'الذكاء النصي (باتمان)', false, String(e && e.message || e)));
      }
    } else {
      out.push(sig('ai', 'الذكاء النصي (باتمان)', false, 'محرك الذكاء غير محمّل'));
    }

    // 7) المزامنة
    try {
      var pending = 0;
      var offKey = '';
      if (global.ServerAPI && typeof global.ServerAPI._getOfflineQueue === 'function') {
        try { pending = global.ServerAPI._getOfflineQueue().length; } catch (_) {}
      }
      if (global.LuccaDB && typeof global.LuccaDB.getSyncStatus === 'function') {
        try {
          var st = await global.LuccaDB.getSyncStatus();
          pending = (st && Number(st.pending || st.queue || 0)) || pending;
        } catch (_) {}
      }
      var lastSync = null;
      try {
        var logs = await global.LuccaDB.db.getAll('sync_log');
        if (Array.isArray(logs) && logs.length) {
          var last = logs[logs.length - 1];
          lastSync = last.startedAt || last.ts || null;
        }
      } catch (_) {}
      var det = 'معلّق الآن: ' + pending;
      if (lastSync) det += ' — آخر مزامنة: ' + String(lastSync).replace('T', ' ').slice(0, 19) + ' UTC';
      else det += ' — لا سجل مزامنة بعد';
      out.push(sig('sync', 'المزامنة', pending === 0, det, pending === 0 ? 'ok' : (pending > 0 ? 'warn' : 'info')));
    } catch (e) {
      out.push(sig('sync', 'المزامنة', false, String(e && e.message || e)));
    }

    // 8) البنية / الإصدار
    var dbv = 'الإصدار 1.0';
    try { if (global.LuccaDB && global.LuccaDB.db && global.LuccaDB.db.version) dbv += ' — مخطط بيانات v' + global.LuccaDB.db.version; } catch (_) {}
    out.push(sig('version', 'البنية والإصدار', true,
      dbv + ' — إدارة الكود عبر git في المستودع (لا تُفحص مباشرة من المتصفح)', 'info'));

    return out;
  }

  function render(results) {
    var host = global.document;
    if (!host) return;
    var grid = host.getElementById('systemHealthGrid');
    if (!grid) return;
    grid.innerHTML = (results || []).map(function (c) {
      var dot = c.state === 'ok' ? '🟢' : (c.state === 'warn' ? '🟠' : (c.state === 'info' ? '🔵' : '🔴'));
      var border = c.state === 'ok' ? '1px solid #2ecc71' : (c.state === 'warn' ? '1px solid #f39c12' : (c.state === 'info' ? '1px solid #3498db' : '1px solid #e74c3c'));
      var bg = c.state === 'bad' ? 'rgba(231,76,60,.08)' : (c.state === 'warn' ? 'rgba(243,156,18,.08)' : 'rgba(255,255,255,.04)');
      return '<div class="panel" style="border:0;border-left:4px solid ' + border + ';background:' + bg + ';margin-bottom:10px">' +
        '<div class="panel-body" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
        '<div style="font-size:1.3rem">' + dot + '</div>' +
        '<div style="flex:1;min-width:200px">' +
        '<div style="font-weight:800;margin-bottom:2px">' + c.label + '</div>' +
        '<div style="font-size:.82rem;color:var(--text-muted);direction:ltr;text-align:left">' + c.detail + '</div>' +
        '</div></div></div>';
    }).join('') || '<div class="panel"><div class="panel-body">⚠️ لا توجد نتائج.</div></div>';
  }

  async function run() {
    var grid = global.document && global.document.getElementById('systemHealthGrid');
    if (grid) grid.innerHTML = '<div class="panel"><div class="panel-body">🔍 جارٍ فحص المكونات…</div></div>';
    var rows;
    try { rows = await probe(); }
    catch (e) { rows = [sig('runner', 'الفحص', false, String(e && e.message || e))]; }
    render(rows);
    return rows;
  }

  global.SystemHealth = { probe: probe, render: render, run: run, _sig: sig };
})(typeof window !== 'undefined' ? window : globalThis);