/**
 * Lucca Knowledge Importer — ربط المعرفة بـ LuccaDB.KnowledgeBase
 * `
 *   - يزرع المعرفة المحاسبية في LuccaDB.KnowledgeBase (الوضعين: offline IndexedDB + online Supabase)
 *   - إذا غابت جداول المعرفة البعيدة (مثل PGRST205 قبل تنفيذ deploy/knowledge-base-schema.sql)
 *     ينتقل تلقائياً إلى مرآة محلية (IndexedDB مستقلة) بنفس الواجهة — لا تبطل المعرفة أبداً
 *   - يمنع التكرار عبر name + version (ver: مُخزّن في tags)
 *   - يسترجع المعرفة عبر بحث بسيط (searchChunks) لربط RAG
 *   - لا يلمس بيانات المطعم الحقيقية — المعرفة في مخازن معرفة فقط
 *
 *   API العام:
 *     window.LuccaKnowledge.ensure()      — إدراج/idempotent upsert ({ok, mode:'kb'|'local'})
 *     window.LuccaKnowledge.retrieve(query, opts) — استرجاع ({ok, results, context, sources, count})
 *     window.LuccaKnowledge.count()       — عدد المستندات المُضمّنة
 *     window.LuccaKnowledge.listTopics()  — قائمة العناوين
 *     window.LuccaKnowledge.reset()       — حذف كل المعرفة (for admin/testing)
 *     window.LuccaKnowledge.mode()        — الوضع النشط ('kb' عبر LuccaDB | 'local' عبر المرآة المحلية)
 */

window.LuccaKnowledge = (function () {
  'use strict';

  var PRIMARY = (window.LuccaDB && window.LuccaDB.KnowledgeBase) || null;
  var SEED = window.LUCCA_KNOWLEDGE_SEED || [];
  var _seeded = false;
  var _fallbackTried = false;
  var _local = null;

  // تذكُّر الوضع من الجلسة السابقة (نحضر 'local' مباشرة بدل محاولة بعيدة فاشلة في كل تحميل)
  var _modeHint = null;
  try { _modeHint = window.localStorage ? window.localStorage.getItem('luccaKnowMode') : null; } catch (e) { _modeHint = null; }
  var _mode = (_modeHint === 'local') ? 'local' : 'kb';

  if (!PRIMARY) {
    console.warn('[LuccaKnowledge] LuccaDB.KnowledgeBase not available — KB disabled.');
    return {
      ensure: function () { return { ok: false, mode: 'none' }; },
      retrieve: function () { return { ok: false, results: [], context: '', sources: [], count: 0 }; },
      count: function () { return 0; },
      listTopics: function () { return []; },
      reset: function () {},
      mode: function () { return 'none'; }
    };
  }

  /* ---------- helpers ---------- */
  function _parseVer(tags) {
    var m = (tags || '').match(/ver:([^\s]+)/);
    return m ? m[1] : null;
  }

  function _docName(d) { return d.name || d.title || ''; }

  function _verCmp(a, b) {
    var pa = a.split('.').map(Number);
    var pb = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) {
      var na = pa[i] || 0, nb = pb[i] || 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  function _kSet(k, v) {
    try { if (window.localStorage) window.localStorage.setItem(k, v); } catch (e) {}
  }

  /* ---------- المرآة المحلية (IndexedDB مستقلة، بلا أي اعتماد على Dexie) ---------- */
  function _chunkMini(text) {
    return (text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 5; });
  }

  function _chunker(text) {
    var f = window.chunkText || _chunkMini;
    try {
      var c = f(text);
      return Array.isArray(c) ? c : [];
    } catch (e) { return _chunkMini(text); }
  }

  function _idbReq(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('IDB error')); };
    });
  }

  function _openLocal() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('indexedDB unavailable'));
      var req = window.indexedDB.open('lucca_knowledge_local', 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('knowledge_documents')) {
          db.createObjectStore('knowledge_documents', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('knowledge_chunks')) {
          db.createObjectStore('knowledge_chunks', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('IDB open error')); };
    });
  }

  async function _buildLocal() {
    // حقن اختباري لعزل اختبارات Node عن IndexedDB
    if (window.__LUKA_LOCAL_KB__) return window.__LUKA_LOCAL_KB__;
    if (_local) return _local;
    var db = await _openLocal();

    function tx(store, mode) {
      var t = db.transaction(store, mode || 'readonly');
      return t.objectStore(store);
    }
    function getAllSt(store) {
      return _idbReq(tx(store).getAll());
    }
    function putSt(store, item) {
      return _idbReq(tx(store, 'readwrite').put(item));
    }
    function delSt(store, key) {
      return _idbReq(tx(store, 'readwrite').delete(key));
    }

    _local = {
      mode: 'local',
      async addDocument(doc) {
        var entry = {
          name: doc.name || 'Untitled',
          type: doc.type || 'text',
          content: doc.content || '',
          chunksCount: 0,
          tags: doc.tags || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        entry.id = await putSt('knowledge_documents', entry);
        var chunks = _chunker(entry.content);
        for (var i = 0; i < chunks.length; i++) {
          await putSt('knowledge_chunks', {
            documentId: entry.id,
            content: chunks[i],
            chunkIndex: i,
            tokensEstimate: Math.ceil(chunks[i].split(/\s+/).length * 1.3),
            createdAt: new Date().toISOString()
          });
        }
        entry.chunksCount = chunks.length;
        await putSt('knowledge_documents', entry);
        return entry;
      },
      async getAllDocuments() { return getAllSt('knowledge_documents'); },
      async getDocument(id) {
        var all = await getAllSt('knowledge_documents');
        return all.find(function (d) { return d.id === id; }) || null;
      },
      async removeDocument(id) {
        var all = await getAllSt('knowledge_chunks');
        for (var i = 0; i < all.length; i++) {
          if (all[i].documentId === id) await delSt('knowledge_chunks', all[i].id);
        }
        return delSt('knowledge_documents', id);
      },
      async searchChunks(query) {
        var all = await getAllSt('knowledge_chunks');
        var terms = query.toLowerCase().split(/[\s,.\-!?؟،()]+/).filter(function (t) { return t.length > 1; });
        if (!terms.length) return [];
        var lo = query.toLowerCase();
        var out = [];
        for (var i = 0; i < all.length; i++) {
          var content = (all[i].content || '').toLowerCase();
          var score = 0;
          for (var j = 0; j < terms.length; j++) {
            if (content.indexOf(terms[j]) >= 0) {
              score += 1;
              var re = new RegExp(terms[j].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
              var mm = content.match(re);
              if (mm && mm.length > 1) score += 0.5 * (mm.length - 1);
            }
          }
          if (content.indexOf(lo) >= 0) score += 5;
          if (score > 0) out.push({ id: all[i].id, documentId: all[i].documentId, content: all[i].content, score: score });
        }
        return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 20);
      },
      async getStats() {
        var docs = await getAllSt('knowledge_documents');
        var chunks = await getAllSt('knowledge_chunks');
        var tokens = 0;
        for (var i = 0; i < chunks.length; i++) tokens += (chunks[i].tokensEstimate || 0);
        return { documents: docs.length, chunks: chunks.length, tokens: tokens };
      }
    };
    return _local;
  }

  /* ---------- mode/active storage ---------- */
  function _activeKB() {
    if (_mode === 'local') return _buildLocal();
    return PRIMARY;
  }

  /* ---------- seed (idempotent upsert) ---------- */
  async function _seedInto(kb) {
    var existingDocs = await kb.getAllDocuments();
    var byName = {};
    (existingDocs || []).forEach(function (d) { byName[_docName(d)] = d; });

    for (var i = 0; i < SEED.length; i++) {
      var e = SEED[i];
      if (!e || !e.name || !e.content) continue;
      var old = byName[e.name];
      var oldVer = old ? _parseVer(old.tags || '') : null;
      var newVer = e.version || '1.0.0';

      // skip if same or older version exists
      if (old && oldVer && _verCmp(oldVer, newVer) >= 0) continue;

      // remove old version document if exists (to re-chunk cleanly)
      if (old && old.id != null) {
        try { await kb.removeDocument(old.id); } catch (erm) { /* non-critical */ }
      }

      var tags = 'ver:' + newVer + ' ' + (e.topic || '') + ' ' + (e.tags || '') + ' source:' + (e.source || 'internal');
      await kb.addDocument({
        name: e.name,
        type: 'knowledge',
        content: e.content,
        tags: tags.trim()
      });
    }
  }

  var _inflight = null;
  async function _doEnsure() {
    if (_seeded) return { ok: true, mode: _mode, count: await count() };
    if (!SEED.length) return { ok: false, mode: _mode, message: 'لا توجد وثائق معرفة' };
    try {
      var kb = await _activeKB();
      if (!kb) return { ok: false, mode: 'none', message: 'لا قاعدة معرفة متاحة' };
      await _seedInto(kb);
      _mode = (kb === PRIMARY) ? 'kb' : 'local';
      _seeded = true;
      _kSet('luccaKnowMode', _mode);
      return { ok: true, mode: _mode, count: await count() };
    } catch (err) {
      // الخطأ البعيد (مثل جداول المعرفة غير المنشأة) -> المرآة المحلية
      if (_mode === 'kb' && !_fallbackTried) {
        _fallbackTried = true;
        try {
          var lk = await _buildLocal();
          if (!lk) return { ok: false, mode: 'kb', message: err.message };
          await _seedInto(lk);
          _mode = 'local';
          _seeded = true;
          _kSet('luccaKnowMode', 'local');
          return { ok: true, mode: 'local', count: await count() };
        } catch (e2) {
          console.warn('[LuccaKnowledge] local fallback failed:', e2);
          return { ok: false, mode: 'kb', message: err.message, localFailed: (e2 && e2.message) };
        }
      }
      console.warn('[LuccaKnowledge] ensure() error:', err);
      return { ok: false, mode: _mode, message: err && err.message || String(err) };
    }
  }

  // حارس تضامن: استدعاءات concurrent تتشارك نفس التشغيل (لا بذر مزدوج)
  function ensure() {
    if (_seeded) return _doEnsure();
    if (_inflight) return _inflight;
    _inflight = _doEnsure();
    try { return _inflight; } finally { _inflight = null; }
  }

  /* ---------- retrieve (RAG) ---------- */
  var AR_STOP = /^(?:ال|في|من|عن|ما|هي|هو|هل|إلى|الى|على|أن|إن|ان|مع|بين|ثم|لكن|عند|عندما|عندها|كل|بعض|حتى|بعد|قبل|كان|كانت|هذا|هذه|ذلك|تلك|بشكل|بخصوص|حول|خلال|عليه|لها|له|حتى|ولا|سوف|قد|لقد|إنه|أنه|أو|او|ولا|لم|لن|فرد|آل|بما|فيما|مثل|منذ|ضمن|غير|نحو|بأن|لكي|حيث|إذ|اذا|أي|أيها|أيتها|ثقال|الذي|الذين|التي|وفي|وما|ومن|وهو|وهي|وأن|وأو|لأن|فقط|أيضا|أيضاً|بينما|إنما)$/;

  function _cleanQuery(q) {
    var tokens = q.toLowerCase().split(/[\s,.\-!?؟،()]+/).filter(function (t) {
      return t.length > 1 && !AR_STOP.test(t);
    });
    return tokens.join(' ');
  }

  async function retrieve(query, opts) {
    if (!query || !query.trim()) return { ok: false, results: [], context: '', sources: [], count: 0 };
    opts = opts || {};
    var topN = opts.top || 5;
    var clean = _cleanQuery(query);
    if (!clean) return { ok: true, results: [], context: '', sources: [], count: 0 };
    try {
      var kb = await _activeKB();
      if (!kb) return { ok: false, results: [], context: '', sources: [], count: 0 };
      var chunks = await kb.searchChunks(clean);
      if (!chunks || !chunks.length) return { ok: true, results: [], context: '', sources: [], count: 0 };

      var top = chunks.slice(0, topN);
      var context = top.map(function (c) { return c.content || ''; }).filter(Boolean).join('\n\n---\n\n');

      // collect unique doc names from chunks
      var docIds = [];
      top.forEach(function (c) {
        var did = c.documentId != null ? c.documentId : (c.document_id != null ? c.document_id : null);
        if (did != null && docIds.indexOf(did) < 0) docIds.push(did);
      });

      var sources = [];
      if (docIds.length) {
        try {
          var allDocs = await kb.getAllDocuments();
          var docMap = {};
          (allDocs || []).forEach(function (d) { docMap[d.id] = _docName(d); });
          docIds.forEach(function (did) {
            var n = docMap[did];
            if (n) sources.push(n);
          });
        } catch (ed) { /* sources optional */ }
      }

      return { ok: true, results: top, context: context, sources: sources, count: chunks.length };
    } catch (err) {
      return { ok: false, results: [], context: '', sources: [], count: 0 };
    }
  }

  /* ---------- metadata ---------- */
  async function count() {
    try {
      var kb = await _activeKB();
      if (!kb) return 0;
      var s = await kb.getStats();
      return (s && s.documents) || 0;
    } catch (e) { return 0; }
  }

  function listTopics() {
    return SEED.map(function (d) {
      return { name: d.name, title: d.title, topic: d.topic, version: d.version };
    });
  }

  async function reset() {
    try {
      var kb = await _activeKB();
      if (kb) {
        var docs = await kb.getAllDocuments();
        for (var i = 0; i < (docs || []).length; i++) {
          try { await kb.removeDocument(docs[i].id); } catch (er) {}
        }
      }
      _seeded = false;
      _kSet('luccaKnowMode', 'kb');
    } catch (e) {}
  }

  /* ---------- public ---------- */
  var api = {
    ensure: ensure,
    retrieve: retrieve,
    count: count,
    listTopics: listTopics,
    reset: reset,
    mode: function () { return _mode; }
  };

  // Auto-seed on DOM ready (non-blocking, safe to call multiple times)
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
        ensure().catch(function () {});
      }, 60); // after LuccaDB init (database.js runs on DOMContentLoaded)
    });
  }

  return api;
})();