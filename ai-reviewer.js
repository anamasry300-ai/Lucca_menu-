#!/usr/bin/env node
/*
╔══════════════════════════════════════════════════════════════╗
║   LUCCA AI Code Reviewer — qwen2.5-coder local (Ollama)      ║
║   يقرأ ملفات الكود فعليًا → يحللها qwen محليًا → تقرير/تعديل  ║
║   السكريبت هو "اليد" و qwen هو "الدماغ" (يتجاوز tool calling) ║
║                                                              ║
║   Usage:                                                     ║
║     node ai-reviewer.js --report [--all|--file x.js]         ║
║     node ai-reviewer.js --watch [--interval 120] --all       ║
║     node ai-reviewer.js --status                             ║
╚══════════════════════════════════════════════════════════════╝
*/

const fs = require('fs');
const path = require('path');

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';
const WORKSPACE = path.resolve(__dirname);
const AUDIT_DIR = path.join(WORKSPACE, '.ai-review');
const REPORT_FILE = path.join(AUDIT_DIR, 'report.json');
const LOG_FILE = path.join(AUDIT_DIR, 'audit.log');
const RAW_DIR = path.join(AUDIT_DIR, 'raw');

// مهلة لكل طلب (ثواني) — main.js أخذ 174 ثانية فعلًا؛ نحتاج رفعها فوق أبطأ ملف
const REQUEST_TIMEOUT_MS = 300000;
// عدد الأسطر القصوى لكل ملف تدخل التحليل (حفاظًا على السرعة)
const MAX_LINES = 600;
// أقصى عدد أحرف للملف الواحد في التحليل
const MAX_CHARS = 12000;

// الملفات الأساسية (من الأهم نحو الأقل)
const SOURCES = [
  'main.js',
  'preload.js',
  'ollama-adapter.js',
  'ai-pos-engine.js',
  'forecasting.js',
  'report-export.js',
  'sync-engine.js',
  'supabase-db.js',
  'index.html',
  'admin/database.js',
  'styles.css'
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}
function ensureDirs() {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
}

async function available() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${OLLAMA}/api/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}

async function ollamaChat(system, user, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: String(user) }
        ],
        stream: false,
        // أبقِ الموديل محمّلًا في الذاكرة لتجنب إعادة التحميل (17ث) لكل طلب
        keep_alive: '30m',
        options: { temperature: opts.temperature ?? 0.2, num_ctx: opts.numCtx ?? 2048 }
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const j = await res.json();
    return (j.message && j.message.content || '').trim();
  } finally {
    clearTimeout(t);
  }
}

// استدعاء مع إعادة محاولة عند الفشل/المهلة
// ملاحظة: إعادة المحاولة قد تتزاحم خلف جيل مهجور من الطلب الملغي؛ الأفضل محاولة واحدة
async function ollamaChatWithRetry(system, user, opts = {}) {
  const attempts = opts.attempts ?? 1;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await ollamaChat(system, user, { ...opts, timeoutMs: opts.timeoutMs ?? 300000 });
      if (out) return out;
    } catch (e) { lastErr = e; }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 2000));
  }
  throw lastErr || new Error('لا رد من النموذج');
}

function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}
  const obj = text.match(/\{[\s\S]*\}/); if (obj) { try { return JSON.parse(obj[0]); } catch (e) {} }
  const arr = text.match(/\[[\s\S]*\]/); if (arr) { try { return JSON.parse(arr[0]); } catch (e) {} }
  return null;
}

// قراءة ملف: اقتطاع للأجزاء الأهم فقط
function readSourceSample(rel) {
  const full = path.join(WORKSPACE, rel);
  if (!fs.existsSync(full)) return null;
  let content = fs.readFileSync(full, 'utf8');
  const totalLines = content.split('\n').length;
  const lines = content.split('\n');
  if (lines.length > MAX_LINES) {
    // خذ البداية + النهاية (الأهم: استيراد + منطق رئيسي)
    const head = lines.slice(0, MAX_LINES).join('\n');
    content = head + `\n\n[!] مقتطع: إجمالي ${totalLines} سطرًا — يُحلل أول ${MAX_LINES} سطرًا فقط.\n`;
  }
  if (content.length > MAX_CHARS) content = content.substring(0, MAX_CHARS) + '\n\n[!] مقتطع (حد الحروف).';
  return { rel, totalLines, sampleLength: content.length, content };
}

const REVIEW_SYSTEM = `أنت "Lucca Reviewer" — محلل أكواد مختص لتطبيق POS (كافيه لوكا) المكتوب بالعربية.
افحص الكود المقدم وابحث عن مشاكل حقيقية فقط: أخطاء منطقية، ثغرات أمنية، مشاكل أداء، كود متكرر، أخطاء UTF-8/عربية، أخطاء حسابات (دفع/فواتير/مخزون/مصروفات).
لا تختلق أخطاء ولا تكرر ما هو سليم.
أنهِ ردك بكائن JSON واحد بهذا الشكل حرفيًا (بدون backticks):
{"summary":"ملخص قصير","issues":[{"file":"<اسم الملف>","severity":"critical|high|medium|low","title":"عنوان","detail":"تفاصيل ومكان","suggestion":"إصلاح محدد"}],"strengths":["نقطة قوة"]}
إن لم تجد مشاكل حقيقية، أعد issues=[] صريحًا. لا تكتب شيئًا بعد الـ JSON.`;

async function reviewFile(rel) {
  const f = readSourceSample(rel);
  if (!f) return { rel, skipped: 'غير موجود' };
  const user = `افحص الملف التالي:\n### FILE: ${f.rel} (totalLines: ${f.totalLines})\n\`\`\`javascript\n${f.content}\n\`\`\``;
  const raw = await ollamaChatWithRetry(REVIEW_SYSTEM, user, { numCtx: 2048 });
  fs.writeFileSync(path.join(RAW_DIR, rel.replace(/[\\/]/g, '_') + '.raw.txt'), raw, 'utf8');
  const data = extractJSON(raw) || { summary: '', issues: [], strengths: [] };
  return { rel, ...data };
}

async function doReport(files) {
  ensureDirs();
  if (!await available()) { console.log('❌ Ollama غير متصل. شغّل الخادم أولًا.'); process.exit(1); }

  const targets = files && files.length ? files.filter(f => SOURCES.includes(f)) : SOURCES;
  // تسلسلي + keep_alive: موديل 7B بطيء، وازي يُبطل استجابة الطلبات.
  const concurrency = 1;
  console.log(`🔍 فحص ${targets.length} ملف بالنموذج ${MODEL} (توازي ${concurrency})`);
  const results = [];
  let totalIssues = 0;

  async function worker(rel) {
    try {
      console.log(`  ... جارٍ تحليل ${rel}`);
      const r = await reviewFile(rel);
      const n = (r.issues || []).length;
      totalIssues += n;
      console.log(`     ✔ ${rel} → ${n} مشكلة`);
      return r;
    } catch (e) {
      console.log(`     ⚠ ${rel} → فشل: ${e.message}`);
      return { rel, error: e.message };
    }
  }

  const queue = [...targets];
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => {
      while (queue.length) {
        const rel = queue.shift();
        results.push(await worker(rel));
      }
    })());
  }
  await Promise.all(workers);
  results.sort((a, b) => targets.indexOf(a.rel) - targets.indexOf(b.rel));

  const report = { generatedAt: new Date().toISOString(), model: MODEL, files: results, totalIssues };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  log(`اكتمل الفحص: ${targets.length} ملف، ${totalIssues} مشكلة. التقرير: .ai-review/report.json`);

  printReport(report);
  return report;
}

function printReport(report) {
  console.log('\n=================== 📋 تقرير مراجعة الكود ===================');
  console.log(`🔍 النموذج: ${report.model} | ⏰ ${report.generatedAt}`);
  console.log(`📈 إجمالي المشاكل: ${report.totalIssues}`);
  report.files.forEach(f => {
    console.log(`\n────────── 📄 ${f.rel} ──────────`);
    if (f.skipped) { console.log('   (غير موجود)'); return; }
    if (f.error) { console.log('   ⚠ ' + f.error); return; }
    if (!(f.issues || []).length) { console.log('   ✅ لا توجد مشاكل واضحة'); return; }
    (f.issues || []).forEach(it => {
      const sev = { critical:'🔴', high:'🟠', medium:'🟡', low:'⚪' }[String(it.severity||'low').toLowerCase()] || '⚪';
      console.log(`\n${sev} ${it.title}`);
      console.log(`   خطورة: ${it.severity}`);
      console.log(`   تفاصيل: ${it.detail}`);
      if (it.suggestion) console.log(`   ✅ اقتراح: ${it.suggestion}`);
    });
  });
  console.log('\n════════════════════════════════════════════════════════════');
}

async function watchLoop(intervalSec, files, fullSweep) {
  ensureDirs();
  const targets = (files && files.length ? files.filter(f => SOURCES.includes(f)) : SOURCES);
  const full = !!fullSweep;
  console.log(`👁️ وضع المراقبة المستمر (${full ? 'الفحص الكامل لكل دورة' : 'ملف واحد متناوب'}، ${targets.length} ملف) — كل ${intervalSec} ثانية. Ctrl+C للإيقاف.`);
  let run = true;
  let idx = 0;
  const shutdown = () => { run = false; console.log('\n⏹ إيقاف المراقبة.'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (run) {
    const started = Date.now();
    try {
      if (!await available()) {
        console.log('⚠ Ollama غير متصل — إعادة المحاولة في الجولة القادمة.');
      } else if (full) {
        await doReport(null);
      } else {
        const rel = targets[idx % targets.length];
        idx++;
        console.log(`\n👁️ دورة ${idx}: تحليل ${rel}...`);
        const r = await reviewFile(rel);
        const tag = r.error ? '⚠ ' + r.error : (r.issues && r.issues.length ? `${r.issues.length} مشكلة` : 'نظيف');
        console.log(`   ✔ ${rel} → ${tag}`);
        // إلحاق النتائج الدورانية لسجل متراكم
        const entry = { at: new Date().toISOString(), rel, ...(r.error ? { error: r.error } : { issues: r.issues || [], summary: r.summary || '' }) };
        const histPath = path.join(AUDIT_DIR, 'history.jsonl');
        fs.appendFileSync(histPath, JSON.stringify(entry) + '\n', 'utf8');
      }
    } catch (e) {
      console.log('⚠ خطأ في دورة الفحص: ' + e.message);
    }
    const elapsed = (Date.now() - started) / 1000;
    const wait = Math.max(10, intervalSec - elapsed);
    console.log(`⏳ استراحة ${Math.round(wait)} ثانية...\n`);
    await new Promise(res => setTimeout(res, wait * 1000));
  }
}

function doStatus() {
  ensureDirs();
  const hasLog = fs.existsSync(LOG_FILE);
  console.log(`حالة الفاحص: ${hasLog ? 'سجل موجود' : 'لا يوجد سجل بعد'}`);
  if (fs.existsSync(REPORT_FILE)) {
    const d = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
    console.log(`آخر فحص: ${d.generatedAt} | ${d.totalIssues} مشكلة | ${d.files.length} ملف`);
    d.files.forEach(f => {
      if (f.error) console.log(`  - ${f.rel}: ⚠ ${f.error}`);
      else console.log(`  - ${f.rel}: ${(f.issues||[]).length} مشكلة (${(f.issues||[]).map(i=>i.severity).join(',') || 'نظيف'})`);
    });
  } else {
    console.log('لم يُنفَّذ فحص بعد. شغّل: node ai-reviewer.js --report');
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--status')) return doStatus();

  const iFile = args.indexOf('--file');
  const focus = iFile >= 0 ? [args[iFile + 1]] : [];
  const useAll = args.includes('--all');

  if (args.includes('--watch')) {
    const iv = args.indexOf('--interval');
    const sec = iv >= 0 ? (parseInt(args[iv + 1]) || 120) : 120;
    return watchLoop(sec, (focus.length ? focus : null), useAll);
  }
  return doReport(useAll ? null : (focus.length ? focus : null));
})().catch(e => { log('خطأ: ' + (e.stack || e.message)); process.exit(1); });
