// ==== اختبارات الوحدة لمنظومة LuccaKnowledge (importer + retrieve) ====
// بيئة اختبار منفصلة: لا تلمس أي بيانات إنتاج. تعمل بـ KnowledgeBase وهمية.
// التشغيل: node c2-tests/knowledge-unit.cjs
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
function eq(a, b, label) {
  if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ---- بيئة وهمية للـ window ----
let _docs = [];
let _chunks = [];
let _seq = 1;

const mockKB = {
  async getAllDocuments() { return _docs.slice(); },
  async addDocument(entry) {
    const id = _seq++;
    const doc = { id, name: entry.name, type: entry.type, content: entry.content || '', tags: entry.tags || '' };
    _docs.push(doc);
    const parts = (doc.content || '').split(/\n+/).filter(s => s.trim().length > 5);
    parts.forEach((p, i) => _chunks.push({ id: _seq++, documentId: id, content: p.trim(), chunkIndex: i }));
    return doc;
  },
  async getDocument(id) { return _docs.find(d => d.id === id) || null; },
  async removeDocument(id) {
    _docs = _docs.filter(d => d.id !== id);
    _chunks = _chunks.filter(c => c.documentId !== id);
  },
  async searchChunks(query) {
    const terms = query.toLowerCase().split(/[\s,.\-!?]+/).filter(t => t.length > 1);
    if (!terms.length) return [];
    return _chunks.filter(c => terms.some(t => (c.content || '').toLowerCase().includes(t)))
      .sort((a, b) => {
        const sa = terms.filter(t => (a.content || '').toLowerCase().includes(t)).length;
        const sb = terms.filter(t => (b.content || '').toLowerCase().includes(t)).length;
        return sb - sa;
      })
      .map(c => ({ ...c, score: terms.filter(t => (c.content || '').toLowerCase().includes(t)).length }));
  },
  async getStats() {
    const docs = _docs.length;
    const chunks = _chunks.length;
    return { documents: docs, chunks, tokens: chunks };
  }
};

function freshWindow() {
  const w = {};
  global.window = w;
  delete require.cache[path.join(ROOT, 'knowledge', 'data.js')];
  delete require.cache[path.join(ROOT, 'knowledge', 'importer.js')];
  return w;
}

function setup() {
  _docs = []; _chunks = []; _seq = 1;
  const w = freshWindow();
  w.LuccaDB = { KnowledgeBase: mockKB };
  require(path.join(ROOT, 'knowledge', 'data.js'));
  require(path.join(ROOT, 'knowledge', 'importer.js'));
  return w;
}

(async () => {
  try {
    // 1) تحميل وتجهيز
    const w = setup();
    eq(w.LUCCA_KNOWLEDGE_SEED.length, 8, 'عدد وثائق المعرفة');
    eq(typeof w.LuccaKnowledge.ensure, 'function', 'ensure موجود');
    record('1. تحميل الوثائق والـ importer', true, `${w.LUCCA_KNOWLEDGE_SEED.length} وثيقة`);

    // 2) البذر الأولي
    await w.LuccaKnowledge.ensure();
    eq(_docs.length, 8, 'عدد الوثائق بعد البذر');
    const c1 = await w.LuccaKnowledge.count();
    eq(c1, 8, 'العَدد حسب getStats');
    record('2. بذر المعرفة (8 وثائق)', true, `count=${c1}`);

    // 3) Idempotency: إعادة الاستدعاء لا تكرر
    await w.LuccaKnowledge.ensure();
    eq(_docs.length, 8, 'لا تكرار بعد البذر الثاني');
    record('3. منع التكرار (Idempotent)', true, `docs=${_docs.length}`);

    // 4) ترقية نسخة (version bump) تعيد البذر دون تكرار
    const seed = w.LUCCA_KNOWLEDGE_SEED;
    const oldV = seed[0].version;
    seed[0].version = '1.1.0';
    await w.LuccaKnowledge.reset();
    await w.LuccaKnowledge.ensure();
    eq(_docs.length, 8, 'العدد ثابت بعد الترقية');
    const doc0 = _docs.find(d => d.name === seed[0].name);
    const hasV = /ver:1\.1\.0/.test(doc0.tags || '');
    record('4. ترقية نسخة الوثيقة', hasV, `tags=${doc0.tags}`);
    seed[0].version = oldV;

    // 5) الاسترجاع بالعربية: استعلام معرفي
    const r1 = await w.LuccaKnowledge.retrieve('ما هي نسبة تكلفة الطعام food cost؟');
    let ok5 = r1.ok && r1.count > 0 && r1.context.length > 0 && r1.sources.length > 0;
    record('5. استرجاع RAG (استعلام عربي)', !!ok5, `count=${r1.count} sources=${r1.sources.length} context=${r1.context.length}ch`);

    // 6) استعلام بدون مطابقة
    const r2 = await w.LuccaKnowledge.retrieve('xyzzyzzzz بشكل كامل');
    let ok6 = r2.ok && r2.count === 0 && r2.context === '';
    record('6. لا مطابقة -> نتيجة فارغة آمنة', !!ok6, `count=${r2.count}`);

    // 7) المصادر تُستنتج من أسماء الوثائق
    const r3 = await w.LuccaKnowledge.retrieve('الوردية النقدية المصروفات');
    eq(r3.ok, true, 'r3.ok');
    const hasSource = r3.sources.some(s => s === 'expenses-classification' || s.includes('expense'));
    record('7. مصدر المقاطع يُذكر', hasSource, `sources=${r3.sources.join(',')}`);

    // 8) listTopics
    eq(w.LuccaKnowledge.listTopics().length, 8, 'فهرس الموضوعات');
    record('8. فهرس الموضوعات (8)', true, '');

    // 9) guard بدون LuccaDB (بيئة خالية من DB لا تنكسر)
    {
      const w2 = freshWindow(); // لا LuccaDB ولا KnowledgeBase
      require(path.join(ROOT, 'knowledge', 'data.js')); // ok even without DB
      require(path.join(ROOT, 'knowledge', 'importer.js'));
      const r = await w2.LuccaKnowledge.retrieve('أي سؤال');
      const safe = r.ok === false && r.count === 0 && typeof w2.LuccaKnowledge.count === 'function';
      record('9. الوضع الآمن عند غياب قاعدة المعرفة', !!safe, 'retrieve آمن بلا استثناء');
    }

    // 10) fallback محلي: عندما تفشل الجداول البعيدة (PGRST205) تنتقل المعرفة للمرآة المحلية تلقائياً
    {
      let lDocs = [];
      let lChunks = [];
      let lSeq = 101;
      const localFake = {
        async getAllDocuments() { return lDocs.slice(); },
        async addDocument(entry) {
          const id = lSeq++;
          const doc = { id, name: entry.name, type: entry.type, content: entry.content || '', tags: entry.tags || '' };
          lDocs.push(doc);
          (doc.content || '').split(/\n+/).filter(s => s.trim().length > 5).forEach((p, i) => {
            lChunks.push({ id: lSeq++, documentId: id, content: p.trim(), chunkIndex: i });
          });
          return doc;
        },
        async removeDocument(id) {
          lDocs = lDocs.filter(d => d.id !== id);
          lChunks = lChunks.filter(c => c.documentId !== id);
        },
        async searchChunks(query) {
          const terms = query.toLowerCase().split(/[\s,.\-!?]+/).filter(t => t.length > 1);
          if (!terms.length) return [];
          return lChunks.filter(c => terms.some(t => (c.content || '').toLowerCase().includes(t)))
            .sort((a, b) => {
              const sa = terms.filter(t => (a.content || '').toLowerCase().includes(t)).length;
              const sb = terms.filter(t => (b.content || '').toLowerCase().includes(t)).length;
              return sb - sa;
            })
            .map(c => ({ id: c.id, documentId: c.documentId, content: c.content, score: terms.filter(t => (c.content || '').toLowerCase().includes(t)).length }));
        },
        async getStats() { return { documents: lDocs.length, chunks: lChunks.length, tokens: lChunks.length }; }
      };

      const brokenKB = {
        async getAllDocuments() { throw new Error("Could not find the table 'public.knowledge_documents' in the schema cache"); },
        async addDocument() { throw new Error('schema missing'); },
        async searchChunks() { throw new Error('schema missing'); },
        async getStats() { throw new Error('schema missing'); }
      };

      const w3 = freshWindow();
      w3.LuccaDB = { KnowledgeBase: brokenKB };
      w3.__LUKA_LOCAL_KB__ = localFake;
      require(path.join(ROOT, 'knowledge', 'data.js'));
      require(path.join(ROOT, 'knowledge', 'importer.js'));

      const r = await w3.LuccaKnowledge.ensure();
      const ok10 = r.ok === true && r.mode === 'local' && lDocs.length === 8 && (await w3.LuccaKnowledge.count()) === 8;
      record('10. Fallback محلي عند غياب الجداول البعيدة', ok10, `mode=${r.mode} docs=${lDocs.length}`);

      const r4 = await w3.LuccaKnowledge.retrieve('دورة المشتريات والشراء من الموردين');
      const ok11 = r4.ok === true && r4.count > 0 && r4.context.length > 0;
      record('11. استرجاع عبر المرآة المحلية', ok11, `count=${r4.count} sources=${r4.sources.join(',')}`);

      const ok12 = w3.LuccaKnowledge.mode() === 'local';
      record('12. mode() يعكس الوضع المحلي', ok12, `mode=${w3.LuccaKnowledge.mode()}`);
    }
  } catch (err) {
    console.error('EXCEPTION:', err && err.stack || err);
    process.exitCode = 1;
    return;
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
  console.log('====================');
  process.exitCode = failed ? 1 : 0;
})();