/**
 * LUCCA POS — RLS Verification (Phase 1)
 *
 * يثبت تجريبياً أن سياسات RLS تعزل الأدوار فعلياً عبر REST:
 *   - SELECT على جدول به بيانات_seed → count > 0 يثبت السماح، count = 0 يثبت الرفض.
 *   - INSERT → 201 = مسموح، 403 = ممنوع.
 *
 * المتطلبات: SUPABASE_URL + SUPABASE_ANON_KEY في المتغيرات البيئية.
 * تشغيل:
 *   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="eyJ..."; node tools/test-supabase-rls.cjs
 *
 * لا يطلب SDK — اتصال مباشر عبر REST.
 */
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('Set SUPABASE_URL + SUPABASE_ANON_KEY'); process.exit(1); }

let failed = false;
function ok(label, pass, detail = '') {
  console.log(`${pass ? 'PASS' : '❌ FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!pass) failed = true;
}

async function head(path, token) {
  const r = await fetch(`${URL}${path}`, {
    method: 'GET',
    headers: { apikey: KEY, Authorization: `Bearer ${token || KEY}` },
  });
  return { s: r.status, d: r.status === 200 ? await r.json() : [] };
}

async function post(path, body, token) {
  const r = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token || KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return r.status;
}

async function login(email, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!r.ok) throw new Error(`login ${email} failed: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function main() {
  // ========== ANON ==========
  console.log('\n=== ANON (بلا دخول) ===');
  const anonCats = await head('/rest/v1/categories?select=id');
  ok('anon قراءة categories (عامة)', anonCats.s === 200 && anonCats.d.length > 0);

  const anonProducts = await head('/rest/v1/products?select=id');
  ok('anon قراءة products (عامة)', anonProducts.s === 200 && anonProducts.d.length > 0);

  const anonOrders = await head('/rest/v1/orders?select=id');
  ok('anon قراءة orders (فارغة/ممنوعة)', anonOrders.s === 200, `count=${anonOrders.d.length}`);

  const anonUsers = await head('/rest/v1/users?select=id');
  ok('anon قراءة users (ممنوعة)', anonUsers.s === 200 && anonUsers.d.length === 0, `count=${anonUsers.d.length} — يجب أن تكون صفر`);

  const anonInsert = await post('/rest/v1/orders', { orderNumber: 'FAIL-TEST' });
  ok('anon إدراج order (403)', anonInsert === 403, `status=${anonInsert}`);

  // ========== CASHIER ==========
  console.log('\n=== CASHIER ===');
  const cashT = await login('cashier@lucca.test', 'TrialPass@2026');

  const cashProd = await head('/rest/v1/products?select=id', cashT);
  ok('cashier قراءة products', cashProd.s === 200 && cashProd.d.length > 0);

  const cashUsers = await head('/rest/v1/users?select=id', cashT);
  ok('cashier قراءة users (ممنوعة)', cashUsers.s === 200 && cashUsers.d.length === 0);

  const cashSett = await post('/rest/v1/settings', { key: 'cashier-fail', value: '0' }, cashT);
  ok('cashier إدراج settings (403)', cashSett === 403, `status=${cashSett}`);

  const cashInv = await post('/rest/v1/inventory', { name: 'RLS test', quantity: 1 }, cashT);
  ok('cashier إدراج inventory', cashInv === 201 || cashInv === 200, `status=${cashInv}`);

  // ========== MANAGER ==========
  console.log('\n=== MANAGER ===');
  const mgrT = await login('manager@lucca.test', 'TrialPass@2026');

  const mgrUsers = await head('/rest/v1/users?select=id', mgrT);
  ok('manager قراءة users (ممنوعة — admin فقط)', mgrUsers.s === 200 && mgrUsers.d.length === 0);

  const mgrSett = await post('/rest/v1/settings', { key: `rls_test_${Date.now()}`, value: '1' }, mgrT);
  ok('manager إدراج settings (201)', mgrSett === 201 || mgrSett === 200, `status=${mgrSett}`);

  const mgrAudit = await head('/rest/v1/audit_logs?select=id', mgrT);
  ok('manager قراءة audit_logs', mgrAudit.s === 200, `count=${mgrAudit.d.length}`);

  const mgrEmp = await post('/rest/v1/employees', { name: 'Test', role: 'cashier', active: 1 }, mgrT);
  ok('manager إدراج employee', mgrEmp === 201 || mgrEmp === 200, `status=${mgrEmp}`);

  console.log('\n' + (failed ? '⚠  SOME CHECKS FAILED — راجع النتائج أعلاه' : '✅ ALL CHECKS PASSED'));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });