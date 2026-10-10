// Phase 8 — Identity, Money-Sanity & Access Closures (D-01..D-08): verification.
// Boots the real compiled server against a seeded temp DB and proves the P1/P2 hardenings:
//   D-05 live user revalidation (disabled/revoked → 401 + session destroyed; role change applies live)
//   D-06 delete of users/audit_logs restricted to admin (manager → 403)
//   D-02 money sanity/ceiling on order items (negative qty/price, absurd price, discount flip → 409)
//   D-01 server-side order reopen (permission-gated, reason required, terminal-only)
//   D-08 batman /record restricted to admin
//   D-07 audit trail carries userId + IP for login/logout/reject events (+ account lockout)
//   D-03/D-04 source-level: void fail-closed in index.html; kitchen.html has no anon path
// Usage: node test/phase8-identity-access.cjs   (requires `npm run build` first)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const BACKEND = path.join(__dirname, '..');
const ROOT = path.join(BACKEND, '..');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}

function awaitFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let child;
  let tmp = null;
  try {
    const port = await awaitFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase8-'));
    const dbPath = path.join(tmp, 'p8.db');
    process.env.DB_PATH = dbPath;

    const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
    const authMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'auth.js')).href);
    await dbMod.initDb();
    const run = (sql, params = []) => dbMod.execute(sql, params);

    const ids = {};
    const mkUser = (key, username, role) => {
      const pw = authMod.hashPassword(username + '#2026');
      const info = run('INSERT INTO users (username, password, name, role, active, mustChangePassword) VALUES (?,?,?,?,?,?)', [username, pw, username, role, 1, 0]);
      ids[key] = Number(info.lastInsertRowid);
    };
    mkUser('root', 'root8', 'admin');
    mkUser('mgr', 'mgr8', 'manager');
    mkUser('csh', 'csh8', 'cashier');
    mkUser('dis', 'dis8', 'cashier');
    mkUser('adm', 'adm8', 'admin');

    // seed one product so a denied write has a target row
    run("INSERT INTO products (name, price, available) VALUES (?,?,?)", ['منتج اختبار', 50, 1]);

    dbMod.closeDb();

    child = spawn(process.execPath, ['dist/index.js'], {
      cwd: BACKEND,
      env: { ...process.env, DB_PATH: dbPath, PORT: String(port), BACKUP_DIR: path.join(tmp, 'backups') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });

    let up = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`${BASE}/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
      await sleep(250);
    }
    if (!up) throw new Error('server not up: ' + stderr.slice(0, 600));

    async function login(username, password) {
      const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, token: j && j.token || null, j };
    }

    async function api(method, p, body, token) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(BASE + p, { method, headers, body: (body !== undefined && method !== 'GET' && method !== 'HEAD') ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch { }
      return { status: res.status, j };
    }

    const root = (await login('root8', 'root8#2026')).token;
    const mgr = (await login('mgr8', 'mgr8#2026')).token;
    const csh = (await login('csh8', 'csh8#2026')).token;
    const dis = (await login('dis8', 'dis8#2026')).token;
    const adm = (await login('adm8', 'adm8#2026')).token;
    record('إعداد الأدوار والدخول (root/manager/cashier/disabled/admin)', !!(root && mgr && csh && dis && adm), `tokens=${!!root}/${!!mgr}/${!!csh}/${!!dis}/${!!adm}`);

    // ======================= D-05: live revalidation =======================
    let r = await api('GET', '/api/orders', undefined, dis);
    record('D-05: مستخدم فعّال يقرأ الطلبات → 200', r.status === 200, `status=${r.status}`);

    r = await api('PUT', `/api/users/${ids.dis}`, { active: 0 }, root);
    record('D-05: admin يعطّل مستخدماً → 200', r.status === 200 && r.j && r.j.success, `status=${r.status}`);

    r = await api('GET', '/api/orders', undefined, dis);
    record('D-05: الجلسة الحالية للمُعطَّل → 401 فوراً', r.status === 401, `status=${r.status}`);

    let sessionsLeftForDis = null;
    try {
      const Database = require('better-sqlite3');
      const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
      const c = ro.prepare('SELECT COUNT(*) AS c FROM sessions WHERE userId = ?').get(ids.dis);
      sessionsLeftForDis = Number(c && c.c);
      ro.close();
    } catch (e) { sessionsLeftForDis = 'read-error:' + (e && e.message); }
    record('D-05: صفر جلسات متبقية للمُعطَّل في جدول sessions', sessionsLeftForDis === 0, `sessions=${sessionsLeftForDis}`);

    r = await api('GET', '/api/users', undefined, adm);
    record('D-05: admin يقرأ المستخدمين → 200', r.status === 200, `status=${r.status}`);

    r = await api('PUT', `/api/users/${ids.adm}`, { role: 'cashier' }, root);
    record('D-05: admin يخفض دور admin → 200', r.status === 200, `status=${r.status}`);

    r = await api('GET', '/api/users', undefined, adm);
    record('D-05: الدور المخفَّض حيّاً يُرفض فوراً → 403', r.status === 403, `status=${r.status}`);

    // ======================= D-02: money sanity on create =======================
    const badBody = (items, extra) => Object.assign({ orderType: 'takeaway', items, paymentMethod: 'cash', createdBy: 'phase8' }, extra || {});
    r = await api('POST', '/api/orders', badBody([{ quantity: 1, price: -5 }]), root);
    record('D-02: سعر سالب → 409', r.status === 409, `status=${r.status}`);

    r = await api('POST', '/api/orders', badBody([{ quantity: -1, price: 50 }]), root);
    record('D-02: كمية سالبة → 409', r.status === 409, `status=${r.status}`);

    r = await api('POST', '/api/orders', badBody([{ quantity: 1, price: 2000000 }]), root);
    record('D-02: سعر يتجاوز السقف → 409', r.status === 409, `status=${r.status}`);

    r = await api('POST', '/api/orders', badBody([{ quantity: 1, price: 50 }], { discountType: 'fixed', discount: 999 }), root);
    record('D-02: خصم ثابت يقلب الإجمالي سالباً → 409', r.status === 409, `status=${r.status}`);

    r = await api('POST', '/api/orders', badBody([{ quantity: 1, price: 50 }], { discount: 10, discountType: 'percent' }), root);
    const oid = r.j && r.j.id;
    record('D-02: طلب صحيح يُنشأ → 201', r.status === 201 && !!oid, `status=${r.status} id=${oid}`);

    // ======================= D-01: server-side reopen =======================
    r = await api('POST', `/api/orders/${oid}/reopen`, { reason: 'test' }, csh);
    record('D-01: كاشير بلا صلاحية reopen → 403', r.status === 403, `status=${r.status}`);

    r = await api('POST', `/api/orders/${oid}/reopen`, {}, root);
    record('D-01: reopen بلا سبب → 400', r.status === 400, `status=${r.status}`);

    r = await api('POST', `/api/orders/${oid}/checkout`, { paymentMethodId: 1, amount: 45, paymentSyncId: 'p8-pay-1', orderSyncId: 'p8-ord-1', changeAmount: 0 }, root);
    record('D-01: تحصيل الطلب (تهيئة) → 200 مغلق', r.status === 200 && r.j && r.j.order && r.j.order.status === 'closed', `status=${r.status}`);

    r = await api('POST', `/api/orders/${oid}/reopen`, { reason: 'تصحيح ائتماني' }, root);
    record('D-01: admin reopen بسبب → 200 وحالة pending/unpaid',
      r.status === 200 && r.j && r.j.success && r.j.order && r.j.order.status === 'pending' && r.j.order.paymentStatus === 'unpaid',
      `status=${r.status} st=${r.j && r.j.order && r.j.order.status} pay=${r.j && r.j.order && r.j.order.paymentStatus}`);

    r = await api('POST', `/api/orders/${oid}/reopen`, { reason: 'مرة أخرى' }, root);
    record('D-01: reopen طلب غير مغلق → 409', r.status === 409, `status=${r.status}`);

    // ======================= D-08: batman /record admin-only =======================
    r = await api('POST', '/api/batman/record', { action: 'test', decision: 'approved' }, csh);
    record('D-08: كاشير يكتب سجل باتمان يدوياً → 403', r.status === 403, `status=${r.status}`);

    r = await api('POST', '/api/batman/record', { action: 'test', decision: 'approved' }, root);
    record('D-08: admin يكتب سجل باتمان → 200', r.status === 200 && r.j && r.j.success, `status=${r.status}`);

    // ======================= D-07: audit trail + lockout =======================
    await login('csh8', 'wrong-pass-8');
    await login('ghost8', 'nope#2026'); // non-existent account (counts toward lockout)

    r = await api('GET', '/api/audit_logs', undefined, root);
    const logs = Array.isArray(r.j) ? r.j : [];
    const failed = logs.find(l => l && l.action === 'login.failed');
    record('D-07: تدقيق login.failed يحمل IP', !!failed && !!String(failed.ipAddress || '').trim(), `ip=${failed && failed.ipAddress}`);

    const success = logs.find(l => l && l.action === 'login.success');
    record('D-07: تدقيق login.success يحمل userId + IP', !!success && success.userId != null && !!String(success.ipAddress || '').trim(), `userId=${success && success.userId} ip=${success && success.ipAddress}`);

    r = await api('PUT', '/api/products/1', { name: 'hack' }, csh);
    const rejectStatus = r.status;
    r = await api('GET', '/api/audit_logs', undefined, root);
    const logs2 = Array.isArray(r.j) ? r.j : [];
    const rejected = logs2.find(l => l && String(l.action || '').endsWith('.rejected') && l.userId != null && String(l.ipAddress || '').trim());
    record('D-07: رفض كتابة يُدوَّن بـ userId + IP', rejectStatus === 403 && !!rejected, `writeStatus=${rejectStatus} action=${rejected && rejected.action}`);

    r = await api('POST', '/api/auth/logout', {}, csh);
    const logoutStatus = r.status;
    r = await api('GET', '/api/audit_logs', undefined, root);
    const logs3 = Array.isArray(r.j) ? r.j : [];
    const logout = logs3.find(l => l && l.action === 'logout' && l.userId != null && String(l.ipAddress || '').trim());
    record('D-07: تدقيق logout يحمل userId + IP', logoutStatus === 200 && !!logout, `logoutStatus=${logoutStatus} found=${!!logout}`);

    // D-07 lockout moved to the very end (IP lockout must not block the cashier re-login in the F-* block below).

    // ======================= D-06: delete restricted to admin =======================
    r = await api('DELETE', `/api/users/${ids.csh}`, undefined, mgr);
    record('D-06: manager يحذف مستخدماً → 403', r.status === 403, `status=${r.status}`);

    r = await api('GET', '/api/audit_logs', undefined, root);
    const anyLogId = Array.isArray(r.j) && r.j.length ? r.j[r.j.length - 1].id : null;
    r = await api('DELETE', `/api/audit_logs/${anyLogId}`, undefined, mgr);
    record('D-06: manager يحذف سجل تدقيق → 403', r.status === 403, `status=${r.status}`);

    r = await api('DELETE', `/api/audit_logs/${anyLogId}`, undefined, root);
    record('D-06: admin يحذف سجل تدقيق → 200', r.status === 200, `status=${r.status} id=${anyLogId}`);

    // ======================= F-1 / F-2 / F-3 / P1: money & secret closures =======================
    // إعادة دخول الكاشير (جلسته السابقة أُغلقت بـ logout أعلاه) لاختبار المسارات المحدودة.
    const csh2 = (await login('csh8', 'csh8#2026')).token;
    record('F-init: إعادة دخول الكاشير للاختبارات المالية', !!csh2, `token=${!!csh2}`);

    // (1) F-2: GET /api/users لا يكشف أي حقل سرّي لأي دور
    r = await api('GET', '/api/users', undefined, mgr);
    const usersRows = Array.isArray(r.j) ? r.j : [];
    const anySecret = usersRows.some(u => u && ('password' in u || 'password_hash' in u || 'pin' in u || 'secret' in u || 'token' in u));
    record('F-2: GET /api/users يُخفي password/الأسرار', r.status === 200 && usersRows.length > 0 && !anySecret,
      `status=${r.status} rows=${usersRows.length} anySecret=${anySecret}`);

    // (2) F-2: حتى admin لا يرى أسرار المستخدم عبر /api/users/:id
    r = await api('GET', `/api/users/${ids.csh}`, undefined, root);
    const SECRET_KEYS = ['password', 'password_hash', 'passwordHash', 'pin', 'pinHash', 'secret', 'token', 'sessionToken'];
    const secretKeys = r.j ? SECRET_KEYS.filter(k => k in r.j) : ['<none>'];
    record('F-2: GET /api/users/:id (admin) بلا أسرار', r.status === 200 && secretKeys.length === 0, `secretKeys=${secretKeys.join(',')}`);

    // (3) F-1: مزامنة طلب بسعر سالب من كاشير → يُرفض ولا يُكتب على السيرفر
    const negSyncId = 'f1-neg-order-' + Date.now();
    r = await api('POST', '/api/sync', { orders: [{ syncId: negSyncId, status: 'pending', paymentStatus: 'unpaid', subtotal: -100, total: -100, discount: 0, tax: 0, orderType: 'takeaway', createdBy: 'csh8', items: [{ name: 'خبيث', quantity: 1, price: -100, unitPrice: -100, total: -100 }] }] }, csh2);
    record('F-1: /api/sync بسعر سالب → مرفوض (skipped/conflicts)', r.status === 200 && !!(r.j && r.j.log && (r.j.log.skipped >= 1 || r.j.log.conflicts >= 1)),
      `skipped=${r.j && r.j.log && r.j.log.skipped} conflicts=${r.j && r.j.log && r.j.log.conflicts}`);

    r = await api('GET', '/api/orders', undefined, root);
    const ordersAfterNeg = Array.isArray(r.j) ? r.j : [];
    record('F-1: الطلب السالب لم يُكتب على السيرفر', !ordersAfterNeg.some(o => o && o.syncId === negSyncId), `leaked=${ordersAfterNeg.some(o => o && o.syncId === negSyncId)}`);

    // (4) F-1: مزامنة طلب بإجمالي/تحت-إجمالي سالب → يُرفض
    const negTotalSyncId = 'f1-negtotal-' + Date.now();
    r = await api('POST', '/api/sync', { orders: [{ syncId: negTotalSyncId, status: 'pending', paymentStatus: 'unpaid', subtotal: -20, total: -20, discount: 0, tax: 0, orderType: 'takeaway', createdBy: 'csh8', items: '[]' }] }, csh2);
    record('F-1: /api/sync بإجمالي سالب → مرفوض', r.status === 200 && !!(r.j && r.j.log && (r.j.log.skipped >= 1 || r.j.log.conflicts >= 1)),
      `detail=${JSON.stringify(r.j && r.j.log && r.j.log.conflictDetail)}`);

    // (5) F-1: طلب سليم عبر المزامنة يبقى مقبولاً (لا كسر للتدفق)
    const okSyncId = 'f1-ok-order-' + Date.now();
    r = await api('POST', '/api/sync', { orders: [{ syncId: okSyncId, status: 'pending', paymentStatus: 'unpaid', subtotal: 20, total: 20, discount: 0, tax: 0, orderType: 'takeaway', createdBy: 'csh8', items: '[]' }] }, csh2);
    record('F-1: /api/sync طلب سليم → 200 ويُدمج', r.status === 200 && !!(r.j && r.j.log && r.j.log.inserted >= 1), `inserted=${r.j && r.j.log && r.j.log.inserted}`);

    // (6) F-1: بند order_items بسعر سالب عبر المزامنة → يُرفض
    r = await api('POST', '/api/sync', { order_items: [{ syncId: 'f1-neg-line-' + Date.now(), orderSyncId: okSyncId, name: 'بند سيئ', quantity: 1, unitPrice: -5, total: -5 }] }, csh2);
    record('F-1: /api/sync order_items بسعر سالب → مرفوض', r.status === 200 && !!(r.j && r.j.log && (r.j.log.skipped >= 1 || r.j.log.conflicts >= 1)),
      `detail=${JSON.stringify(r.j && r.j.log && r.j.log.conflictDetail)}`);

    // (7) F-3: منع تصفير سعر منتج مدفوع (productId=1 سعره 50) — الكاشير ممنوع والمدير مسموح
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ productId: 1, name: 'منتج اختبار', quantity: 1, price: 0, unitPrice: 0 }] }, csh2);
    record('F-3: كاشير يصفّر سعر منتج مدفوع → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.j || {})}`);

    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ productId: 1, name: 'منتج اختبار', quantity: 1, price: 0, unitPrice: 0 }] }, mgr);
    record('F-3: manager (price.override) يصفّر سعر منتج مدفوع → 201', r.status === 201 && !!(r.j && r.j.id), `status=${r.status}`);

    // (7b) F-3/P5: نفس الحماية على مسار المزامنة (حمولة الواجهة الحقيقية تحمل productId)
    r = await api('POST', '/api/sync', { orders: [{ syncId: 'f3-sync-' + Date.now(), status: 'pending', paymentStatus: 'unpaid', orderType: 'takeaway', createdBy: 'csh8', subtotal: 0, total: 0, discount: 0, tax: 0, items: [{ productId: 1, name: 'منتج اختبار', quantity: 1, price: 0, unitPrice: 0, total: 0 }] }] }, csh2);
    record('F-3/P5: /api/sync تصفير سعر منتج مدفوع (productId) → مرفوض', r.status === 200 && !!(r.j && r.j.log && (r.j.log.skipped >= 1 || r.j.log.conflicts >= 1)),
      `detail=${JSON.stringify(r.j && r.j.log && r.j.log.conflictDetail)}`);

    // (7c) P5: عنصر بلا productId بسعر 0 يبقى مسموحاً (أصناف حرة/غير مربوطة بالكتالوج — fail-open موثّق)
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ name: 'صنف حر', quantity: 1, price: 0, unitPrice: 0 }] }, csh2);
    record('F-3: عنصر بلا productId بسعر 0 مسموح (لا ربط كتالوجي)', r.status === 201, `status=${r.status}`);

    // (7d) P5: منتج مدفوع بسعر صحيح مع productId يمرّ عادياً (لا رفض زائف)
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ productId: 1, name: 'منتج اختبار', quantity: 1, price: 50, unitPrice: 50 }] }, csh2);
    record('F-3/P5: منتج مدفوع بسعر صحيح + productId → 201', r.status === 201, `status=${r.status}`);

    // (8) P1: الخادم يفرض الإجمالي من الأصناف ويتجاهل إجمالي العميل (2×30=60 لا 1)
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', subtotal: 1, total: 1, items: [{ name: 'بند', quantity: 2, price: 30, unitPrice: 30 }] }, root);
    record('P1: الخادم يفرض total من الأصناف (60 لا 1)', r.status === 201 && Number(r.j && r.j.total) === 60, `total=${r.j && r.j.total}`);

    // (9) F-5: تحصيل طلب بإجمالي صفر → 409 ولا دفعة
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: '[]', subtotal: 0, total: 0 }, root);
    const zeroId = r.j && r.j.id;
    r = await api('POST', `/api/orders/${zeroId}/checkout`, { paymentMethod: 'cash', paymentSyncId: 'p8-zero-' + Date.now() }, root);
    record('F-5: تحصيل طلب بإجمالي صفر → 409', r.status === 409, `status=${r.status} ${JSON.stringify(r.j || {})}`);
    r = await api('GET', '/api/payments', undefined, root);
    const paysZero = (Array.isArray(r.j) ? r.j : []).filter(p => String(p.orderId) === String(zeroId));
    record('F-5: لا دفعات لطلب بإجمالي صفر', paysZero.length === 0, `count=${paysZero.length}`);

    // (10) F-4: changeAmount سالب/فاحش → 409
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ name: 'بند', quantity: 1, price: 60, unitPrice: 60 }] }, root);
    const chgId = r.j && r.j.id;
    r = await api('POST', `/api/orders/${chgId}/checkout`, { paymentMethod: 'cash', paymentSyncId: 'p8-chg-' + Date.now(), changeAmount: -5 }, root);
    record('F-4: changeAmount سالب → 409 (لا يُخزَّن)', r.status === 409, `status=${r.status}`);
    r = await api('POST', `/api/orders/${chgId}/checkout`, { paymentMethod: 'cash', paymentSyncId: 'p8-chg2-' + Date.now(), changeAmount: 999999999 }, root);
    record('F-4: changeAmount فاحش → 409', r.status === 409, `status=${r.status}`);

    // (11) P1: دفع نقدي ناجح (amount 120 على إجمالي 100 → change 20، paid 100)
    const IDEM_PSID = 'p8-cash-idem-0001';
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ name: 'بند', quantity: 1, price: 100, unitPrice: 100 }] }, root);
    const cashId = r.j && r.j.id;
    r = await api('POST', `/api/orders/${cashId}/checkout`, { paymentMethod: 'cash', amount: 120, paymentSyncId: IDEM_PSID }, root);
    record('P1: دفعة نقدية ناجحة (change 20 / paid 100)',
      r.status === 200 && r.j && r.j.order && Number(r.j.order.changeAmount) === 20 && Number(r.j.order.totalPaid) === 100,
      `change=${r.j && r.j.order && r.j.order.changeAmount} paid=${r.j && r.j.order && r.j.order.totalPaid}`);

    // (12) P1: دفعة بطاقة ناجحة (change 0)
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'card', createdBy: 'phase8', items: [{ name: 'بند', quantity: 1, price: 40, unitPrice: 40 }] }, root);
    const cardId = r.j && r.j.id;
    r = await api('POST', `/api/orders/${cardId}/checkout`, { paymentMethod: 'card', paymentSyncId: 'p8-card-' + Date.now() }, root);
    record('P1: دفعة بطاقة ناجحة (change=0)', r.status === 200 && r.j && r.j.order && r.j.order.paymentMethod === 'card' && Number(r.j.order.changeAmount) === 0,
      `method=${r.j && r.j.order && r.j.order.paymentMethod} change=${r.j && r.j.order && r.j.order.changeAmount}`);

    // (13) P1: دفع مقسّم ناجح (cash 50 + card 30 = 80)
    r = await api('POST', '/api/orders', { orderType: 'takeaway', paymentMethod: 'cash', createdBy: 'phase8', items: [{ name: 'بند', quantity: 1, price: 80, unitPrice: 80 }] }, root);
    const splitId = r.j && r.j.id;
    r = await api('POST', `/api/orders/${splitId}/checkout`, { paymentMethod: 'split', payments: [{ method: 'cash', amount: 50, paymentSyncId: 'p8-s1-' + Date.now() }, { method: 'card', amount: 30, paymentSyncId: 'p8-s2-' + Date.now() }] }, root);
    record('P1: دفع مقسّم ناجح (cash 50 + card 30)', r.status === 200 && r.j && r.j.order && r.j.order.status === 'closed',
      `status=${r.status} st=${r.j && r.j.order && r.j.order.status}`);

    // (14) P1: استرداد مصرَّح (void) على طلب مدفوع
    r = await api('POST', `/api/orders/${cardId}/void`, { reason: 'استرداد اختباري' }, mgr);
    record('P1: استرداد مصرَّح لطلب مدفوع → 200', r.status === 200 && r.j && r.j.success, `status=${r.status} ${JSON.stringify(r.j || {})}`);

    // (15) H4: إعادة نفس دفعة checkout (نفس paymentSyncId) لا تُضاعف الدفعة
    r = await api('POST', `/api/orders/${cashId}/checkout`, { paymentMethod: 'cash', amount: 120, paymentSyncId: IDEM_PSID }, root);
    const idemOk = r.status === 200 && r.j && r.j.alreadyProcessed === true;
    r = await api('GET', '/api/payments', undefined, root);
    const paysCash = (Array.isArray(r.j) ? r.j : []).filter(p => String(p.orderId) === String(cashId));
    record('H4: إعادة الدفع بنفس syncId → alreadyProcessed + دفعة واحدة', idemOk && paysCash.length === 1, `count=${paysCash.length}`);

    // ======================= D-07 (cont.): account/IP lockout after repeated failures =======================
    let locked = false;
    for (let i = 0; i < 9; i++) {
      const a = await login('ghost8', 'nope#2026');
      if (a.status === 429) { locked = true; break; }
    }
    record('D-07: قفل الحساب بعد تكرار الفشل → 429', locked, `locked=${locked}`);

    // ======================= D-03 / D-04: source-level closures =======================
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const voidFailClosed = indexHtml.includes("await ServerAPI.post('/api/orders/' + _voidOrderId + '/void'")
      && /لا يمكن الإلغاء/.test(indexHtml)
      && !/LuccaDB\.db\.add\('refunds'/.test(indexHtml);
    record('D-03: index.html إلغاء fail-closed (لا مسار محلي/استرداد محلي)', voidFailClosed, `ok=${voidFailClosed}`);

    const kitchenHtml = fs.readFileSync(path.join(ROOT, 'kitchen.html'), 'utf8');
    const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const preloadJs = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    const kitchenNoAnon = !/createClient|SUPABASE_URL|SUPABASE_ANON|@supabase\//.test(kitchenHtml) && kitchenHtml.includes('kitchenApi');
    const ipcOpenKitchen = mainJs.includes("'open-kitchen'") && preloadJs.includes('openKitchen');
    record('D-04: kitchen.html بلا مسار anon + kitchenApi', kitchenNoAnon, `ok=${kitchenNoAnon}`);
    record('D-04: IPC open-kitchen موجود (main.js + preload.js)', ipcOpenKitchen, `main=${mainJs.includes("'open-kitchen'")} preload=${preloadJs.includes('openKitchen')}`);

    // F-3/P5: حمولة POS الحقيقية تُرسل productId (ربط الكتالوج) لعناصر المنتجات المربوطة
    const bpSrc = (indexHtml.match(/function buildOrderPayload\(\)[\s\S]*?\.filter\(Boolean\);/) || [''])[0];
    const payloadBindsCatalog = /_productId/.test(bpSrc) && /productId\s*:/.test(bpSrc);
    record('F-3/P5: buildOrderPayload يرسل productId (ربط الكتالوج)', payloadBindsCatalog, `ok=${payloadBindsCatalog}`);
  } catch (e) {
    results.push({ name: 'unexpected error', ok: false, detail: (e && e.stack) || String(e) });
    console.log('UNEXPECTED ERROR:', (e && e.stack) || e);
  }

  const failed = results.filter(x => !x.ok);
  console.log(`==== phase8-identity-access: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ====`);
  if (child) child.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  process.exit(failed.length ? 1 : 0);
})();
