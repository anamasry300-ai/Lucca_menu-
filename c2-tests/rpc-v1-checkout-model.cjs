// ═══════════════════════════════════════════════════════════════════════════
// rpc-v1-checkout-model.cjs — اختبارات منطقية لسلوك checkout_order (Phase 2B)
//
//   لا تحتاج Supabase. هو نَموذج in-memory يطابق دلالات SQL الموثّقة في
//   deploy/supabase-rpc-v1.sql (تدقيق أفضل-case للخوارزمية): التحقق من المبلغ،
//   قيد idempotency (order_id + sync_id)، حماية "الطلب مغلق"، خصم المخزون
//   (وصفة/1:1)، وقيود allowNegativeStock، مع rollback ذري على أي فشل.
//
//   كما يفحص ثبات مخطط paymentSyncId المُشتق في ai-pos-engine.js و index.html
//   والتحقق الساكن من src/المعدّلات (لا randomUUID، لا inventory.updated_at).
//
//   التشغيل:   node c2-tests/rpc-v1-checkout-model.cjs
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS  ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL  ' + name + ' — ' + (e && e.message));
  }
}

// ─────────────────────────── أدوات الـ model ───────────────────────────────
const round2 = n => Math.round(n * 100) / 100;

function makeStore() {
  return {
    orders: new Map(),
    inventory: new Map(),
    recipes: new Map(),          // productId -> [{ingredient, quantity}]
    payments: [],                // {order_id, sync_id, method, amount}
    movements: [],               // {order_id, product_id, quantity, type, notes}
  };
}

function seedOrder(s, id, total, items) {
  s.orders.set(id, { id, status: 'open', paymentStatus: 'unpaid', total: round2(total), items });
}
function seedInventory(s, name, quantity) {
  s.inventory.set(name, { id: name, name, quantity, last_updated: null });
}
function seedRecipe(s, productId, rows) {
  s.recipes.set(productId, rows);
}

function snapshot(s) {
  return JSON.parse(JSON.stringify({
    orders: Array.from(s.orders),
    inventory: Array.from(s.inventory),
    payments: s.payments,
    movements: s.movements,
  }));
}
function restore(s, snap) {
  s.orders = new Map(snap.orders);
  s.inventory = new Map(snap.inventory);
  s.payments = snap.payments;
  s.movements = snap.movements;
}

// قيد فريد (order_id, sync_id) — duplicate يرفع خطأ (يحاكي unique index)
function insertPayment(s, orderId, sync, method, amount) {
  if (sync && s.payments.some(p => p.order_id === orderId && p.sync_id === sync)) {
    const e = new Error('duplicate key violates unique constraint (order_id, sync_id)');
    e.unique = true;
    throw e;
  }
  s.payments.push({ order_id: orderId, sync_id: sync || null, method, amount });
}

// خصم المخزون — مطابق لـ _lucca_deduct_stock
function deductStock(s, order, allowNegativeStock) {
  let shortfall = '';
  (order.items || []).forEach(item => {
    const recipe = s.recipes.get(Number(item.productId));
    if (recipe && recipe.length) {
      recipe.forEach(ing => {
        const inv = s.inventory.get(ing.ingredient);
        const wanted = ing.quantity * Number(item.quantity || 1);
        if (inv) {
          if (!allowNegativeStock && inv.quantity < wanted) {
            shortfall += ing.ingredient + ' (المتاح ' + inv.quantity + ' — المطلوب ' + wanted + ')، ';
            return;
          }
          inv.quantity = inv.quantity - wanted;
          inv.last_updated = new Date().toISOString();
          s.movements.push({ order_id: order.id, product_id: Number(item.productId), quantity: -wanted, type: 'sale', notes: 'طلب #' + order.id + ' :: ' + ing.ingredient });
        } else {
          shortfall += ing.ingredient + ' (لا يوجد صنف مخزون)، ';
        }
      });
    } else {
      const name = String(item.name || '');
      const inv = s.inventory.get(name);
      const wanted = Number(item.quantity || 1);
      if (inv) {
        if (!allowNegativeStock && inv.quantity < wanted) {
          shortfall += name + ' (المتاح ' + inv.quantity + ' — المطلوب ' + wanted + ')، ';
          return;
        }
        inv.quantity = inv.quantity - wanted;
        inv.last_updated = new Date().toISOString();   // last_updated فقط — لا updated_at (كما في fix 2B)
        s.movements.push({ order_id: order.id, product_id: Number(item.productId), quantity: -wanted, type: 'sale', notes: 'طلب #' + order.id + ' :: ' + name });
      } else {
        s.movements.push({ order_id: order.id, product_id: Number(item.productId), quantity: -wanted, type: 'sale', notes: 'طلب #' + order.id + ' :: ' + name + ' (بدون صنف مخزون مقابل)' });
      }
    }
  });
  return shortfall;
}

function checkoutOrder(s, { orderId, parts, allowNegativeStock }) {
  const order = s.orders.get(orderId);
  if (!order) return { status: 404, message: 'الطلب غير موجود' };

  if (order.paymentStatus === 'paid') {
    const allMatch = parts.every(p =>
      p.sync && s.payments.some(pm => pm.order_id === orderId && pm.sync_id === p.sync));
    return allMatch
      ? { status: 200, alreadyProcessed: true, message: 'مكرر — سبق تسجيل الدفع' }
      : { status: 409, message: 'الطلب مغلق بالفعل — معرّف دفع مختلف' };
  }

  const sum = round2(parts.reduce((t, p) => t + round2(p.amount), 0));
  if (Math.abs(sum - order.total) > 0.01) {
    return { status: 409, message: 'مبلغ الدفعات لا يطابق إجمالي الطلب' };
  }

  const snap = snapshot(s);
  try {
    parts.forEach(p => insertPayment(s, orderId, p.sync, p.method, round2(p.amount)));
    const shortfall = deductStock(s, order, !!allowNegativeStock);
    if (shortfall) {
      const msg = 'عجز مخزون: ' + shortfall;
      restore(s, snap);
      return { status: 409, message: msg };
    }
    order.status = 'closed';
    order.paymentStatus = 'paid';
    return { status: 200, alreadyProcessed: false, message: 'تم الإغلاق' };
  } catch (e) {
    restore(s, snap);
    if (e && e.unique) return { status: 409, unique: true, message: e.message };
    throw e;
  }
}

// ─────────────────── مخطط paymentSyncId المُشتق (يعكس التعديلات) ───────────
const deriveSingle = (orderId, method) => 'pay-' + orderId + '-' + String(method || 'cash');
const deriveSplit = (orderId, parts) => parts.map((p, i) =>
  'split-' + orderId + '-' + String(p.method || 'cash') + '-' + (i + 1));

// ═══════════════════════════ السيناريوهات A—H ══════════════════════════════
console.log('--- A) checkout جديد ---');
check('A1: إغلاق ناجح + دفع واحد + خصم مخزون 1:1', () => {
  const s = makeStore();
  seedOrder(s, 1, 100, [{ productId: 10, name: 'شاورما', quantity: 2 }]);
  seedInventory(s, 'شاورما', 10);
  const r = checkoutOrder(s, { orderId: 1, parts: [{ method: 'cash', amount: 100, sync: deriveSingle(1, 'cash') }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.alreadyProcessed, false);
  assert.strictEqual(s.orders.get(1).status, 'closed');
  assert.strictEqual(s.orders.get(1).paymentStatus, 'paid');
  assert.strictEqual(s.payments.length, 1);
  assert.strictEqual(s.inventory.get('شاورما').quantity, 8);
  assert.strictEqual(s.movements.length, 1);
});

console.log('--- B) retry بنفس paymentSyncId ---');
check('B1: نفس المعرّف بعد النجاح → alreadyProcessed، لا دفع مزدوج', () => {
  const s = makeStore();
  seedOrder(s, 2, 50, [{ productId: 11, name: 'كافه', quantity: 1 }]);
  seedInventory(s, 'كافه', 20);
  const sync = deriveSingle(2, 'cash');
  checkoutOrder(s, { orderId: 2, parts: [{ method: 'cash', amount: 50, sync }] });
  const r2 = checkoutOrder(s, { orderId: 2, parts: [{ method: 'cash', amount: 50, sync }] });
  assert.strictEqual(r2.alreadyProcessed, true);
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(s.payments.length, 1);
  assert.strictEqual(s.movements.length, 1);
  assert.strictEqual(s.inventory.get('كافه').quantity, 19);
});

console.log('--- C) retry بعد نجاح لكن معرّف مختلف ---');
check('C1: معرّف مختلف بعد الإغلاق → 409 ولا شيء يتغير (مشهد الـ bug القديم)', () => {
  const s = makeStore();
  seedOrder(s, 3, 60, [{ productId: 12, name: 'بيتزا', quantity: 1 }]);
  seedInventory(s, 'بيتزا', 5);
  checkoutOrder(s, { orderId: 3, parts: [{ method: 'cash', amount: 60, sync: deriveSingle(3, 'cash') }] });
  const r2 = checkoutOrder(s, { orderId: 3, parts: [{ method: 'card', amount: 60, sync: deriveSingle(3, 'card') }] });
  assert.strictEqual(r2.status, 409);
  assert.match(r2.message, /مغلق/);
  assert.strictEqual(s.payments.length, 1);
  assert.strictEqual(s.movements.length, 1);
  assert.strictEqual(s.inventory.get('بيتزا').quantity, 4);
});

console.log('--- D) duplicate paymentSyncId داخل نفس التقسيم ---');
check('D1: تكرار المعرّف في الأجزاء → 409 + rollback كامل', () => {
  const s = makeStore();
  seedOrder(s, 4, 200, [{ productId: 13, name: 'منقوشة', quantity: 4 }]);
  seedInventory(s, 'منقوشة', 20);
  const dupe = 'split-4-cash-1';
  const r = checkoutOrder(s, { orderId: 4, parts: [{ method: 'cash', amount: 100, sync: dupe }, { method: 'card', amount: 100, sync: dupe }] });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.unique, true);
  assert.strictEqual(s.orders.get(4).status, 'open');
  assert.strictEqual(s.payments.length, 0);
  assert.strictEqual(s.movements.length, 0);
  assert.strictEqual(s.inventory.get('منقوشة').quantity, 20);
});

console.log('--- E) منتج مع وصفة ---');
check('E1: خصم حسب مكونات الوصفة (مكونان) + حركات لكل مكوّن', () => {
  const s = makeStore();
  seedOrder(s, 5, 120, [{ productId: 30, name: 'تشيز برغر', quantity: 2 }]);
  seedRecipe(s, 30, [{ ingredient: 'لحم', quantity: 0.5 }, { ingredient: 'صامولي', quantity: 1 }]);
  seedInventory(s, 'لحم', 10);
  seedInventory(s, 'صامولي', 5);
  const r = checkoutOrder(s, { orderId: 5, parts: [{ method: 'cash', amount: 120, sync: deriveSingle(5, 'cash') }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(s.orders.get(5).status, 'closed');
  assert.strictEqual(s.inventory.get('لحم').quantity, 9);
  assert.strictEqual(s.inventory.get('صامولي').quantity, 3);
  assert.strictEqual(s.movements.length, 2);
});

console.log('--- F) منتج بدون وصفة + صف مخزون مقابل ---');
check('F1: خصم 1:1 + last_updated بدون أي عمود updated_at', () => {
  const s = makeStore();
  seedOrder(s, 6, 40, [{ productId: 14, name: 'شاهي', quantity: 1 }]);
  seedInventory(s, 'شاهي', 7);
  const r = checkoutOrder(s, { orderId: 6, parts: [{ method: 'card', amount: 40, sync: deriveSingle(6, 'card') }] });
  assert.strictEqual(r.status, 200);
  const inv = s.inventory.get('شاهي');
  assert.strictEqual(inv.quantity, 6);
  assert.ok(inv.last_updated !== null && inv.last_updated !== undefined, 'last_updated يجب أن يتحدث');
  assert.strictEqual('updated_at' in inv, false, 'المخطط الحي لا يملك inventory.updated_at — لا يُشار إليه');
});

console.log('--- G) منتج بدون وصفة + بلا صف مخزون ---');
check('G1: ينجح مع حركة (بدون صنف مخزون مقابل) بلا خصم', () => {
  const s = makeStore();
  seedOrder(s, 7, 25, [{ productId: 15, name: 'عصير', quantity: 2 }]);
  const r = checkoutOrder(s, { orderId: 7, parts: [{ method: 'cash', amount: 25, sync: deriveSingle(7, 'cash') }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(s.orders.get(7).status, 'closed');
  assert.strictEqual(s.movements.length, 1);
  assert.match(s.movements[0].notes, /بدون صنف مخزون مقابل/);
});

console.log('--- H) فشل خصم المخزون → rollback ---');
check('H1: عجز + allowNegativeStock=false → 409 وكل شيء يعود كما كان', () => {
  const s = makeStore();
  seedOrder(s, 8, 500, [{ productId: 16, name: 'فلافل', quantity: 50 }]);
  seedInventory(s, 'فلافل', 3);
  const r = checkoutOrder(s, { orderId: 8, parts: [{ method: 'cash', amount: 500, sync: deriveSingle(8, 'cash') }] });
  assert.strictEqual(r.status, 409);
  assert.match(r.message, /عجز/);
  assert.strictEqual(s.orders.get(8).status, 'open');
  assert.strictEqual(s.payments.length, 0);
  assert.strictEqual(s.movements.length, 0);
  assert.strictEqual(s.inventory.get('فلافل').quantity, 3);
});

check('H2: نفس السيناريو مع allowNegativeStock=true → ينجح ويسمح بالعجز', () => {
  const s = makeStore();
  seedOrder(s, 9, 500, [{ productId: 16, name: 'فلافل', quantity: 50 }]);
  seedInventory(s, 'فلافل', 3);
  const r = checkoutOrder(s, { orderId: 9, parts: [{ method: 'cash', amount: 500, sync: deriveSingle(9, 'cash') }], allowNegativeStock: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(s.inventory.get('فلافل').quantity, -47);
});

console.log('--- ثبات مخطط paymentSyncId (يعكس تعديلات ai-pos/index.html) ---');
check('T1: single — نفس (orderId, method) دائماً نفس المعرّف (retry ثابت)', () => {
  assert.strictEqual(deriveSingle(7, 'cash'), deriveSingle(7, 'cash'));
  assert.strictEqual(deriveSingle(7, 'cash'), 'pay-7-cash');
});
check('T2: single — طريقة مختلفة → معرّف مختلف (محاولة جديدة مشروعة)', () => {
  assert.notStrictEqual(deriveSingle(7, 'cash'), deriveSingle(7, 'card'));
});
check('T3: split — نفس الطلبات/الترتيب → نفس السلسلة عند retry', () => {
  const a = deriveSplit(4, [{ method: 'cash', amount: 100 }, { method: 'card', amount: 100 }]);
  const b = deriveSplit(4, [{ method: 'cash', amount: 100 }, { method: 'card', amount: 100 }]);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a, ['split-4-cash-1', 'split-4-card-2']);
});
check('T4: split — أمر مختلف (يغيّر الترتيب/المبلغ بأي شكل) يغيّر المعرّفات بإزاحة index', () => {
  const a = deriveSplit(4, [{ method: 'card', amount: 100 }, { method: 'cash', amount: 100 }]);
  assert.deepStrictEqual(a, ['split-4-card-1', 'split-4-cash-2']);
});

console.log('--- تحقق ساكن من الملفات المعدّلة (Phase 2B) ---');
const root = path.join(__dirname, '..');

check('S1: ai-pos-engine.js — لا randomUUID لدفعة split، ويستخدم التسلسل المشتق', () => {
  const src = fs.readFileSync(path.join(root, 'ai-pos-engine.js'), 'utf8');
  const start = src.indexOf('async _executeSplitDetails');
  assert.ok(start > -1, 'موجود تعريف toolSplitPayment');
  const block = src.slice(start, start + 3000);
  assert.ok(!/randomUUID\s*\(/.test(block), 'لا استدعاء randomUUID داخل _executeSplitDetails');
  assert.match(block, /paymentSyncId: 'split-' \+ sp\.orderId/);
  assert.match(src, /checkoutToServer\(order\.id, \{ paymentMethod, paymentSyncId: 'pay-'/);
  assert.match(src, /checkoutToServer\(order\.id, \{ paymentMethod: method, paymentSyncId: 'pay-'/);
});

check('S2: index.html — confirmSplitPayment يستخدم المعرّف المشتق الثابت', () => {
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const start = src.indexOf('async function confirmSplitPayment');
  assert.ok(start > -1, 'موجود تعريف confirmSplitPayment');
  const block = src.slice(start, start + 1400);
  assert.ok(!/randomUUID\s*\(/.test(block), 'لا استدعاء randomUUID داخل confirmSplitPayment');
  assert.match(block, /'split-' \+ currentOrderId \+ '-' \+ String\(p\.method/);
});

// عدّاد مراجع "inventory.updated_at" — مسموح فقط داخل تعليقات SQL (توثيق) وليس كوداً
check('S3: deploy/supabase-rpc-v1.sql — لا إشارة كود لـ inventory.updated_at (الإصلاح #1)', () => {
  const src = fs.readFileSync(path.join(root, 'deploy', 'supabase-rpc-v1.sql'), 'utf8');
  assert.ok(!/updated_at = COALESCE\(updated_at, NOW\(\)\)/.test(src), 'الإزالة تمت');
  assert.ok(!/last_updated = NOW\(\), updated_at/.test(src), 'لا سطر تحديث يجمع last_updated مع updated_at');
  assert.strictEqual((src.match(/inventory\.updated_at/g) || []).length, 0, 'لا إشارة inventory.updated_at أبداً (حتى في الكود)');
  assert.ok((src.match(/last_updated = NOW\(\)/g) || []).length >= 3, 'last_updated = NOW() موجودة في مسارات الخصم/الاستعادة');
});

console.log('--------------------------------------------------------------');
console.log('النتيجة: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);