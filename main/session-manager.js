// ===== Security-critical session manager (pure Node, NO Electron dependency → unit-testable) =====
// Holds the authenticated user session (token + user) ONLY in main-process memory.
// Exposes narrow sanitized views to the renderer — NEVER the token.
// The renderer talks to the backend exclusively through apiRequest() which injects the token here.

const DEFAULT_TTL_MS = parseInt(process.env.SESSION_TTL_MS || String(12 * 60 * 60 * 1000), 10);

class SessionManager {
  constructor(opts = {}) {
    this.serverUrl = (opts.serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
    this._token = null;
    this._user = null;       // sanitized user: { id, username, name, email, employeeId, role, active, mustChangePassword }
    this._permissions = null; // { role, wildcard, permissions[] } from /api/auth/permissions
    this._lastTokenAt = 0;
    this._ttlMs = opts.ttl || DEFAULT_TTL_MS; // testable via opts.ttl
  }

  get authenticated() { return !!this._token && !!this._user && !this._expired(); }

  // K3 strict-deny: no cached identity once the token has expired (no offline fallback).
  _expired() {
    return this._lastTokenAt > 0 && (Date.now() - this._lastTokenAt) > this._ttlMs;
  }

  // ===== sanitized view for renderer — contains NO token/secret =====
  session() {
    if (!this.authenticated) return { authenticated: false, user: null, permissions: null };
    return {
      authenticated: true,
      user: this._user,
      permissions: this._permissions,
      expiresInMs: Math.max(0, this._ttlMs - (Date.now() - this._lastTokenAt)),
    };
  }

  // ===== login: posts to backend, stores token only here =====
  async login({ username, password, serverUrl }) {
    if (serverUrl && /^https?:\/\//i.test(String(serverUrl))) {
      this.serverUrl = String(serverUrl).replace(/\/+$/, '');
    }
    const body = { username: String(username || '').trim(), password: String(password || '') };
    const r = await this._request('POST', '/api/auth/login', body, null);
    if (!r || r.status !== 200) {
      return { ok: false, status: r ? r.status : 0, error: (r && r.json && r.json.error) || 'بيانات الدخول غير صحيحة' };
    }
    const j = r.json || {};
    if (!j.token || !j.user) return { ok: false, status: 500, error: 'استجابة غير مكتملة من الخادم' };
    this._token = j.token;
    this._user = this._sanitizeUser(j.user, j.mustChangePassword);
    this._lastTokenAt = Date.now();
    await this.refreshPermissions().catch(() => {});
    return { ok: true, ...this.session() };
  }

  // ===== revalidate identity against server, refresh permissions =====
  async refresh() {
    if (!this.authenticated) return { ok: false, ...this.session() };
    const r = await this._request('GET', '/api/auth/me', null, this._token);
    if (!r || r.status !== 200) {
      this.clear();
      return { ok: false, ...this.session() };
    }
    const me = r.json && r.json.user;
    if (!me) { this.clear(); return { ok: false, ...this.session() }; }
    this._user = this._sanitizeUser(me, !!me.mustChangePassword);
    await this.refreshPermissions().catch(() => {});
    return { ok: true, ...this.session() };
  }

  // ===== load role permissions (server-derived) for Admin tab gating =====
  async refreshPermissions() {
    if (!this.authenticated) return null;
    const r = await this._request('GET', '/api/auth/permissions', null, this._token).catch(() => null);
    if (r && r.status === 200 && r.json) {
      this._permissions = { role: r.json.role, wildcard: !!r.json.wildcard, permissions: Array.isArray(r.json.permissions) ? r.json.permissions : [] };
    } else {
      this._permissions = null;
    }
    return this._permissions;
  }

  // ===== logout: destroy server session, drop token =====
  async logout() {
    if (this._token) {
      await this._request('POST', '/api/auth/logout', null, this._token).catch(() => null);
    }
    this.clear();
    return { ok: true, ...this.session() };
  }

  clear() {
    this._token = null;
    this._user = null;
    this._permissions = null;
  }

  // ===== authenticated API proxy — injects Bearer token; path restricted to backend /api/* =====
  async apiRequest(method, path, body) {
    if (!this.authenticated) return { status: 401, json: { error: 'unauthorized' } };
    if (typeof path !== 'string' || !/^\/api\//.test(path)) return { status: 400, json: { error: 'bad path' } };
    const allowed = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']);
    const m = String(method || 'GET').toUpperCase();
    if (!allowed.has(m)) return { status: 405, json: { error: 'method not allowed' } };
    const r = await this._request(m, path, body, this._token);
    return { status: r ? r.status : 502, json: r && r.json };
  }

  // ===== low-level HTTP via Node http/https (no Electron, no global fetch dependency) =====
  _request(method, path, body, token) {
    return new Promise((resolve) => {
      let u;
      try { u = new URL(this.serverUrl + path); } catch (e) { resolve({ status: 0, json: { error: 'bad url' } }); return; }
      const lib = u.protocol === 'https:' ? require('https') : require('http');
      const payload = body === undefined || body === null ? null : JSON.stringify(body);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const req = lib.request(u, {
        method,
        headers,
        timeout: 8000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch (e) { json = null; }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ status: 0, json: { error: 'timeout' } }); });
      req.on('error', () => { resolve({ status: 0, json: { error: 'network error' } }); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  _sanitizeUser(u, mustChange) {
    return {
      id: u.id != null ? u.id : null,
      userId: u.id != null ? u.id : null,
      username: u.username || '',
      name: u.name || '',
      email: u.email != null ? u.email : null,
      employeeId: u.employeeId != null ? u.employeeId : null,
      role: u.role || 'cashier',
      active: u.active !== undefined ? Number(u.active) : 1,
      mustChangePassword: !!(u.mustChangePassword !== undefined ? u.mustChangePassword : mustChange),
    };
  }
}

module.exports = SessionManager;