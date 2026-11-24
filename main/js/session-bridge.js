/**
 * Lucca POS — Secure Session Bridge (main process)
 *
 * ينفّذ قنوات preload المعروضة والتي لم يكن لها معالجات:
 *   - session:login   ({ username, password, serverUrl }) → تسجيل دخول على السيرفر المحلي
 *   - session:get     () → الجلسة الحالية (بلا كلمة المرور)
 *   - session:logout  () → إبطال الجلسة على السيرفر ثم مسحها
 *   - session:refresh () → إعادة التحقق من /api/auth/me
 *   - api:request     ({ method, path, body }) → وسيط مصادق عليه نحو السيرفر المحلي
 *
 * مبادئ الأمان:
 *   - رمز الجلسة يعيش في ذاكرة العملية الرئيسية فقط، ولا يُحفَظ على القرص.
 *   - كلمة المرور تمر للسيرفر مرة واحدة عبر login ولا تُخزَّن إطلاقاً.
 *   - serverUrl فقط يُحفَظ في userData (غير سرّي) حتى يعمل api:request بعد إعادة التشغيل بجلسة جديدة.
 *   - لا أسرار تعبر حدود contextBridge (المصمَّم في preload.js).
 */

'use strict';

const fs = require('fs');
const path = require('path');

let _app = null;
let _session = null; // { token, user, serverUrl }
const DEFAULT_SERVER_URL = 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 15000;

function configPath() {
    const dir = _app ? _app.getPath('userData') : __dirname;
    return path.join(dir, 'lucca-server.json');
}

function loadSavedServerUrl() {
    try {
        const raw = fs.readFileSync(configPath(), 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data.serverUrl === 'string' && /^https?:\/\//.test(data.serverUrl)) {
            return data.serverUrl.replace(/\/+$/, '');
        }
    } catch (e) { /* لا ملف بعد */ }
    return null;
}

function saveServerUrl(url) {
    try {
        fs.writeFileSync(configPath(), JSON.stringify({ serverUrl: url }), 'utf8');
    } catch (e) { /* فشل الحفظ لا يكسر الجلسة */ }
}

function currentServerUrl() {
    if (_session && _session.serverUrl) return _session.serverUrl;
    return loadSavedServerUrl() || DEFAULT_SERVER_URL;
}

function publicSession() {
    if (!_session) return null;
    return { user: _session.user, serverUrl: _session.serverUrl, authenticated: !!_session.token };
}

async function request(method, apiPath, body) {
    const base = currentServerUrl();
    const url = base + apiPath;
    const headers = { 'Content-Type': 'application/json' };
    if (_session && _session.token) headers['Authorization'] = 'Bearer ' + _session.token;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
            signal: ctrl.signal
        });
        let json = null;
        try { json = await res.json(); } catch (e) { /* استجابة غير JSON */ }
        return { status: res.status, json };
    } finally {
        clearTimeout(timer);
    }
}

function init({ ipcMain, app }) {
    _app = app || null;

    ipcMain.handle('session:login', async (_event, creds) => {
        const username = String((creds && creds.username) || '').trim();
        const password = String((creds && creds.password) || '');
        const serverUrl = (creds && typeof creds.serverUrl === 'string' && /^https?:\/\//.test(creds.serverUrl))
            ? creds.serverUrl.replace(/\/+$/, '')
            : currentServerUrl();
        if (!username || !password) return { ok: false, error: 'missing-credentials' };
        try {
            const base = serverUrl;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
            let res, json;
            try {
                res = await fetch(base + '/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                    signal: ctrl.signal
                });
                json = await res.json().catch(() => null);
            } finally {
                clearTimeout(timer);
            }
            if (!res.ok || !json || !json.token) {
                return { ok: false, status: res.status, error: (json && json.error) || 'login-failed' };
            }
            _session = { token: json.token, user: json.user || { username }, serverUrl: base };
            saveServerUrl(base);
            return { ok: true, ...publicSession(), mustChangePassword: !!json.mustChangePassword };
        } catch (e) {
            return { ok: false, error: 'server-unreachable' };
        }
    });

    ipcMain.handle('session:get', async () => publicSession());

    ipcMain.handle('session:logout', async () => {
        if (_session && _session.token) {
            try { await request('POST', '/api/auth/logout'); } catch (e) { /* أفضل جهد */ }
        }
        _session = null;
        return { ok: true };
    });

    ipcMain.handle('session:refresh', async () => {
        if (!_session || !_session.token) return null;
        try {
            const r = await request('GET', '/api/auth/me');
            if (r.status === 401) { _session = null; return null; }
            if (r.json && r.json.user) _session.user = r.json.user;
            return publicSession();
        } catch (e) {
            return publicSession(); // الشبكة متعذرة — أبقِ الجلسة المحلية
        }
    });

    // وسيط مصادق عليه: يستخدمه kitchen.html وشاشات POS للحديث مع السيرفر المحلي.
    ipcMain.handle('api:request', async (_event, payload) => {
        const method = String((payload && payload.method) || 'GET').toUpperCase();
        const apiPath = String((payload && payload.path) || '');
        // قيّد الوسيط بمسارات /api/ فقط — لا وسيط عام لأي URL.
        if (!apiPath.startsWith('/api/') || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            return { status: 400, json: { error: 'invalid-request' } };
        }
        try {
            return await request(method, apiPath, payload && payload.body);
        } catch (e) {
            return { status: 0, json: null, error: 'server-unreachable' };
        }
    });
}

module.exports = { init };
