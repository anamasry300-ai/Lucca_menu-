#!/usr/bin/env node
/**
 * P0 — CashRegister reconciliation (client-side drawer)
 *
 * Contract §1.3:  CashExpected = openingBalance + cashPayments − cashRefunds − cashExpenses
 * Canonical server equivalents (see repositories/ordersRepo.ts + expensesRepo.ts):
 *   cashPaymentsTotal -> payments.method   = 'cash' AND status = 'completed'
 *   cashRefundTotal   -> refunds.refundMethod = 'cash'
 *   cashExpensesTotal -> expenses.paymentMethod = 'cash'
 *
 * REGRESSION: the local drawer used the GROSS totalRefunds / totalExpenses
 * counters in expectedCash, so a CARD refund or a CARD expense wrongly reduced
 * expected cash and produced a false shortage/overage at drawer close.
 *
 * This test extracts the real `recordTransaction` / `closeDrawer` source from both
 * live implementations and executes it, so it validates shipped code, not a copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const pass = [];
const fail = [];
function check(name, cond, extra) {
  if (cond) pass.push(name);
  else fail.push(name + (extra ? '  ->  ' + extra : ''));
}

/** Pull one method's source text out of an object literal by brace matching. */
function extractMethod(src, name) {
  const start = src.indexOf(name + '(');
  if (start < 0) throw new Error('method not found: ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

/** Rebuild a CashRegister-like object from the real source, over a fake store. */
function buildFromSource(file, label) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const rec = extractMethod(src, 'async recordTransaction');
  const close = extractMethod(src, 'async closeDrawer');
  const open = extractMethod(src, 'async openDrawer');
  const active = extractMethod(src, 'async getActiveDrawer');

  // `db` is database.js's IndexedDB helper; supabase-db.js uses _dcAll/_dcSave/_dcNextId.
  const isSupa = /supabase-db\.js$/.test(file);
  const store = { rows: [] };
  const db = {
    async getAll() { return store.rows; },
    async get(_s, id) { return store.rows.find(r => String(r.id) === String(id)) || null; },
    async add(_s, obj) { obj.id = store.rows.length + 1; store.rows.push(obj); return obj.id; },
    async put(_s, obj) {
      const i = store.rows.findIndex(r => String(r.id) === String(obj.id));
      if (i < 0) store.rows.push(obj); else store.rows[i] = obj;
      return obj.id;
    },
  };
  const sandbox = isSupa
    ? { db, _dcAll: () => store.rows, _dcSave: (r) => { store.rows = r; }, _dcNextId: (r) => r.length + 1, window: {} }
    : { db, window: {} };

  const body = `
    const CashRegister = {
      ${active},
      ${open},
      ${close},
      ${rec},
    };
    return CashRegister;
  `;
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(sandbox), body);
  return { register: factory(...Object.values(sandbox)), store };
}

(async () => {
  for (const [file, label] of [['admin/database.js', 'database.js'], ['supabase-db.js', 'supabase-db.js']]) {
    const { register, store } = buildFromSource(file, label);

    // ---------- open drawer with 1000 opening cash ----------
    const opened = await register.openDrawer(1000, null, 'uat');
    const id = opened.drawer.id;
    check(`${label}: openDrawer starts at expectedCash=1000`, Number(opened.drawer.expectedCash) === 1000,
      `got ${opened.drawer.expectedCash}`);

    // ---------- POS UAT: cash sale, card sale, transfer sale ----------
    await register.recordTransaction(id, 'sale', 200, 'cash');     // cash
    await register.recordTransaction(id, 'sale', 250, 'card');     // card
    await register.recordTransaction(id, 'sale', 150, 'transfer');  // transfer
    let d = store.rows[0];
    check(`${label}: cash sale -> totalCashSales=200`, Number(d.totalCashSales) === 200, `got ${d.totalCashSales}`);
    // Card/transfer bucket label differs between the two files (supabase-db.js files
    // 'تحويل' as wallet, database.js as card). Neither is cash, so assert the bucket TOTAL
    // — that is what matters for reconciliation.
    const nonCash = Number(d.totalCardSales) + Number(d.totalWalletSales);
    check(`${label}: card+transfer both land in the non-cash bucket = 400`, nonCash === 400, `got ${nonCash}`);
    check(`${label}: transfer sale -> NOT counted as cash`, Number(d.totalCashSales) === 200, `got ${d.totalCashSales}`);

    // ---------- cash expense + card expense (the bug) ----------
    await register.recordTransaction(id, 'expense', 100, 'cash');
    await register.recordTransaction(id, 'expense', 500, 'card');   // must NOT touch cash
    d = store.rows[0];
    check(`${label}: gross totalExpenses counts both = 600`, Number(d.totalExpenses) === 600, `got ${d.totalExpenses}`);
    check(`${label}: expectedCash ignores CARD expense = 1100`, Number(d.expectedCash) === 1100, `got ${d.expectedCash}`);
    check(`${label}: currentCash ignores CARD expense = 1100`, Number(d.currentCash) === 1100, `got ${d.currentCash}`);

    // ---------- cash refund + card refund (the bug) ----------
    await register.recordTransaction(id, 'refund', 50, 'cash');
    await register.recordTransaction(id, 'refund', 75, 'card');    // must NOT touch cash
    d = store.rows[0];
    check(`${label}: gross totalRefunds counts both = 125`, Number(d.totalRefunds) === 125, `got ${d.totalRefunds}`);
    // 1000 + 200 − 100 − 50 = 1050
    check(`${label}: expectedCash ignores CARD refund = 1050`, Number(d.expectedCash) === 1050, `got ${d.expectedCash}`);
    check(`${label}: currentCash ignores CARD refund = 1050`, Number(d.currentCash) === 1050, `got ${d.currentCash}`);

    // ---------- close with balanced drawer ----------
    const closed = await register.closeDrawer(1050, 'uat close');
    const c = closed.drawer;
    check(`${label}: close expectedCash = 1050`, Number(c.expectedCash) === 1050, `got ${c.expectedCash}`);
    check(`${label}: close difference = 0`, Number(c.difference) === 0, `got ${c.difference}`);
    check(`${label}: close differenceType = balanced`, c.differenceType === 'balanced', `got ${c.differenceType}`);

    // ---------- TRUE shortage is still detected (guard against over-filtering) ----------
    const o2 = await register.openDrawer(500, null, 'uat2');
    await register.recordTransaction(o2.drawer.id, 'sale', 100, 'cash');
    await register.recordTransaction(o2.drawer.id, 'expense', 40, 'cash');
    const c2 = await register.closeDrawer(500, 'short 60');   // expected 560, actual 500
    check(`${label}: real shortage detected (-60)`, Number(c2.drawer.difference) === -60, `got ${c2.drawer.difference}`);
    check(`${label}: real shortage typed correctly`, c2.drawer.differenceType === 'shortage', `got ${c2.drawer.differenceType}`);
  }

  // ---------- back-compat: a drawer opened before the fix must not lose a cash match ----------
  {
    const { register, store } = buildFromSource('admin/database.js', 'legacy');
    await register.openDrawer(1000, null, 'legacy');
    const legacy = store.rows[0];
    delete legacy.totalCashRefunds;
    delete legacy.totalCashExpenses;
    legacy.totalRefunds = 50;     // pre-fix, assumed cash
    await register.recordTransaction(legacy.id, 'sale', 200, 'cash');
    // backfill must treat the legacy 50 as cash: 1000 + 200 − 50 = 1150
    check('legacy drawer: pre-fix cash refund is preserved after backfill',
      Number(store.rows[0].expectedCash) === 1150, `got ${store.rows[0].expectedCash}`);
  }

  console.log('');
  pass.forEach(t => console.log('  PASS  ' + t));
  if (fail.length) { console.log(''); fail.forEach(t => console.log('  FAIL  ' + t)); }
  console.log(`\n==== p0-cash-register-reconciliation: ${pass.length}/${pass.length + fail.length} passed, ${fail.length} failed ====`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
