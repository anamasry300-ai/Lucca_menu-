(function (root) {
  'use strict';

  var injected = null;

  function stores() {
    if (injected) return injected;
    var s = {};
    try { s.local = (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { s.local = null; }
    try { s.session = (typeof sessionStorage !== 'undefined') ? sessionStorage : null; } catch (e) { s.session = null; }
    return s;
  }

  function getItem(store, key) {
    var s = stores();
    try { return (s[store] && s[store].getItem(key)) || ''; } catch (e) { return ''; }
  }

  function setItem(store, key, val) {
    var s = stores();
    try { if (!s[store]) return; s[store].setItem(key, val); } catch (e) {}
  }

  function removeItem(store, key) {
    var s = stores();
    try { if (!s[store]) return; s[store].removeItem(key); } catch (e) {}
  }

  function baseUrl() {
    return getItem('local', 'luccaServerUrl') || 'http://localhost:3000';
  }

  function token() {
    return getItem('session', 'luccaToken');
  }

  function apiKey() {
    return getItem('local', 'luccaApiKey');
  }

  function hasAuth() {
    return !!(token() || apiKey());
  }

  function authHeaders(extra) {
    var h = { 'Content-Type': 'application/json' };
    var t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    else if (apiKey()) h['x-api-key'] = apiKey();
    if (extra) {
      for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k]; }
    }
    return h;
  }

  function request(path, opt) {
    var o = opt || {};
    var cfg = { headers: authHeaders(o.headers) };
    if (o.method) cfg.method = o.method;
    if (o.body !== undefined) cfg.body = o.body;
    return fetch(path, cfg).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return (ct.indexOf('json') > -1 ? res.json() : res.text()).then(function (body) {
        return { ok: res.ok, status: res.status, j: body };
      });
    }).catch(function () {
      return { ok: false, status: 0, j: { error: 'تعذّر الاتصال بالخادم' }, net: true };
    });
  }

  function write(method, path, body) {
    return request(path, { method: method, body: JSON.stringify(body || {}) });
  }

  function use(storages) {
    injected = storages || null;
  }

  root.AdminApi = {
    baseUrl: baseUrl,
    token: token,
    apiKey: apiKey,
    hasAuth: hasAuth,
    authHeaders: authHeaders,
    request: request,
    write: write,
    use: use
  };
})(typeof window !== 'undefined' ? window : globalThis);