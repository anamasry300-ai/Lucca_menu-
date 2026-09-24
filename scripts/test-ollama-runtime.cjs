// OLLAMA RUNTIME — deterministic adapter tests (no real Ollama daemon).
// Loads the real ollama-adapter.js with stubbed storage + fetch.
// Proves:
//   1) selected Ollama model + host are persistable across "reloads";
//   2) clear health states: unavailable / model-missing / ready;
//   3) generation uses the SELECTED model and surfaces MODEL_NOT_FOUND cleanly.
const assert = require('assert');
const path = require('path');
const Module = require('module');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
function finalize() {
  const failed = results.filter(r => !r.ok);
  const passed = results.length - failed.length;
  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed.length} فاشل`);
  console.log('====================');
  process.exitCode = failed.length === 0 ? 0 : 1;
}

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear()
  };
}
const localStore = memStorage();
const sessionStore = memStorage();

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body)
});

// Controllable fake Ollama daemon.
function makeOllama() {
  const state = {
    up: true,
    models: ['qwen2.5-coder:7b', 'llama3.1:8b'], // realistic installed models
    lastGenerateBody: null,
    lastTagsHost: '',
    generateFn: null // override to simulate model-not-found / errors
  };
  return {
    state,
    async fetchImpl(url, init) {
      const u = String(url);
      state.lastTagsHost = u;
      if (u.endsWith('/api/tags')) {
        if (!state.up) return Promise.reject(new TypeError('ECONNREFUSED (ollama off)'));
        return json(200, { models: state.models.map(m => ({ name: m, model: '', modified_at: '' })) });
      }
      if (u.endsWith('/api/chat') || u.endsWith('/api/generate')) {
        if (!state.up) return Promise.reject(new TypeError('ECONNREFUSED (ollama off)'));
        state.lastGenerateBody = JSON.parse((init && init.body) || '{}');
        if (state.generateFn) return state.generateFn(u, state.lastGenerateBody);
        return json(200, { model: state.lastGenerateBody.model, message: { content: 'ردّ تجريبي' }, response: 'ردّ تجريبي' });
      }
      return json(404, { error: 'not found' });
    }
  };
}

// (Re)load ollama-adapter.js — simulating cold boot / app reload.
function loadAdapter() {
  const file = path.join(__dirname, '..', 'ollama-adapter.js');
  const cached = require.cache[file];
  if (cached) delete require.cache[file];
  global.window = globalThis;
  global.localStorage = localStore;
  global.sessionStorage = sessionStore;
  global.fetch = ollama.fetchImpl;
  require(file);
  return global.window.OllamaAI;
}

const ollama = makeOllama();

(async () => {
  let AI = loadAdapter();

  // ===== 1) defaults =====
  record('1. adapter loads with defaults',
    typeof AI.getOllamaModel === 'function' ?
      AI.getOllamaModel() === 'qwen2.5:3b' :
      (AI.model === 'qwen2.5:3b'),
    'model default = qwen2.5:3b');

  // ===== 2) model selection persists =====
  AI.setOllamaModel('qwen2.5-coder:7b');
  record('2. setOllamaModel persists', localStore.getItem('luccaOllamaModel') === 'qwen2.5-coder:7b',
    localStore.getItem('luccaOllamaModel') || 'missing');

  // ===== 3) "reload": fresh module instance still sees the saved model =====
  AI = loadAdapter();
  record('3. reload keeps selected model', AI.getOllamaModel() === 'qwen2.5-coder:7b',
    AI.getOllamaModel() + (AI.getOllamaModel ? '' : ' (no getter)'));

  // ===== 4) generation body uses the SELECTED model =====
  await AI.chat('sys', 'user', {});
  record('4. chat() sends selected model', ollama.state.lastGenerateBody.model === 'qwen2.5-coder:7b',
    JSON.stringify(ollama.state.lastGenerateBody && ollama.state.lastGenerateBody.model));

  // ===== 5) health: unavailable when daemon off =====
  ollama.state.up = false;
  const hDown = await AI.health(true);
  record('5. health -> unavailable when daemon off', hDown.state === 'unavailable', JSON.stringify(hDown));
  ollama.state.up = true;

  // ===== 6) health: ready when selected model installed =====
  const hReady = await AI.health(true);
  record('6. health -> ready when model installed', hReady.state === 'ready' && hReady.installed === true,
    JSON.stringify(hReady));

  // ===== 7) health: model-missing when selected NOT installed =====
  AI.setOllamaModel('qwen2.5:3b'); // NOT in the fake installed list
  const hMissing = await AI.health(true);
  record('7. health -> model-missing when selected not installed',
    hMissing.state === 'model-missing' && Array.isArray(hMissing.availableModels) && hMissing.availableModels.indexOf('qwen2.5-coder:7b') !== -1,
    JSON.stringify(hMissing));

  // ===== 7b) no-tag model selection intentionally matches any installed tag of the same base =====
  // (mirrors Ollama untagged-reference semantics: "qwen2.5" -> latest "qwen2.5:*" tag)
  AI.setOllamaModel('qwen2.5-coder'); // no tag, base of qwen2.5-coder:7b
  const hNoTag = await AI.health(true);
  record('7b. no-tag model matches installed tag of same base -> ready',
    hNoTag.state === 'ready' && hNoTag.installed === true, JSON.stringify(hNoTag));
  AI.setOllamaModel('llama3'); // base not installed (only llama3.1:8b present)
  const hBaseMiss = await AI.health(true);
  record('7c. no-tag unknown base -> model-missing',
    hBaseMiss.state === 'model-missing' && hBaseMiss.installed === false, JSON.stringify(hBaseMiss));

  // ===== 8) chat surfaces MODEL_NOT_FOUND instead of a generic error =====
  ollama.state.generateFn = async () => json(404, { error: "model 'qwen2.5:3b' not found, try pulling it" });
  const nf = await AI.chat('sys', 'u', {});
  record('8. model-not-found -> controlled error', nf.ok === false && nf.code === 'MODEL_NOT_FOUND',
    JSON.stringify(nf));
  ollama.state.generateFn = null;

  // ===== 9) llmReady false when selected model missing =====
  record('9. llmReady=false when model missing', (await AI.llmReady(true)) === false, 'unexpected ready');
  AI.setOllamaModel('qwen2.5-coder:7b');
  record('9b. llmReady=true when model ready', (await AI.llmReady(true)) === true, 'not ready');
  ollama.state.up = false;
  record('9c. llmReady=false when daemon off (ollama-only)', (await AI.llmReady(true)) === false, 'not ready');
  ollama.state.up = true;

  // ===== 10) host change persists and is used =====
  AI.setOllamaHost('http://127.0.0.1:11435');
  record('10. setOllamaHost persists', localStore.getItem('luccaOllamaHost') === 'http://127.0.0.1:11435',
    localStore.getItem('luccaOllamaHost') || 'missing');
  AI = loadAdapter(); // reload -> getter path reads live storage
  await AI.isAvailable(true);
  record('10b. reloaded adapter checks the new host', String(ollama.state.lastTagsHost).indexOf('127.0.0.1:11435') !== -1,
    ollama.state.lastTagsHost);
  AI.setOllamaHost('http://localhost:11434');

  // ===== 11) enable/disable persists across reload =====
  AI.setEnabled(false);
  AI = loadAdapter();
  record('11. disabled state persists across reload', AI.isEnabled() === false, 'still enabled');
  AI.setEnabled(true);

  // ===== 12) listModels returns installed names =====
  const list = await AI.listModels();
  record('12. listModels returns installed models', Array.isArray(list) && list.indexOf('qwen2.5-coder:7b') !== -1,
    JSON.stringify(list));

  finalize();
})().catch(e => { console.error('ERROR:', e.stack); process.exitCode = 1; });