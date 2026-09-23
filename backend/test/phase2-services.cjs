'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const BACKEND = path.join(__dirname, '..');
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lucca-phase2-')), 'test.db');

process.env.DB_PATH = DB_FILE;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
function eq(a, b, label) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-6) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function approx(a, b, label) {
  if (Math.abs(a - b) > 1e-6) throw new Error(`${label}: expected ~${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const D = '2026-08-10';
const D2 = '2026-08-11';

(async () => {
  try {
    const dbMod = await import(pathToFileURL(path.join(BACKEND, 'dist', 'db.js')).href);
    await dbMod.initDb();

    const run = (sql, params = []) => dbMod.execute(sql, params);

    run('INSERT INTO inventory (id, name, quantity, unit, minStock, costPrice) VALUES (?, ?, ?, ?, ?, ?)', [1, 'قهوة بن', 10, 'كجم', 5, 40]);
    run('INSERT INTO products (id, name, price, cost) VALUES (?, ?, ?, ?)', [300, 'قهوة تركي (وصفة)', 200, 999]);
    run('INSERT INTO products (id, name, price, cost) VALUES (?, ?, ?, ?)', [301, 'كابتشينو (بلا وصفة)', 150, 30]);
    run('INSERT INTO products (id, name, price, cost) VALUES (?, ?, ?, ?)', [302, 'كوفي بارد (بلا تكلفة)', 60, 0]);
    run("INSERT INTO product_recipes (productId, ingredient, quantity, unit) VALUES (?, ?, ?, ?)", [300, 'قهوة بن', 0.5, 'كجم']);

    const orders = [
      [1, 'O1', 'completed', 'paid', 200, 0, 0, 'percent', 0, 200, 200, D, `${D}T10:00:00`],
      [2, 'O2', 'completed', 'paid', 150, 10, 15, 'percent', 0, 135, 135, D, `${D}T10:00:00`],
      [3, 'O3', 'completed', 'paid', 100, 0, 0, 'percent', 0, 100, 100, D, `${D}T10:00:00`],
      [4, 'O4', 'completed', 'paid', 120, 0, 0, 'percent', 0, 120, 120, D, `${D}T10:00:00`],
      [5, 'O5', 'cancelled', 'unpaid', 999, 0, 0, 'percent', 0, 999, 0, D, `${D}T10:00:00`],
      [6, 'O6', 'pending', 'unpaid', 400, 0, 0, 'percent', 0, 400, 0, D, `${D}T10:00:00`],
      [7, 'O7', 'completed', 'paid', 300, 0, 0, 'percent', 0, 300, 300, D, `${D}T10:00:00`],
      [8, 'O8', 'completed', 'paid', 80, 0, 0, 'percent', 0, 80, 80, D, `${D}T10:00:00`],
      [9, 'O9', 'completed', 'paid', 60, 0, 0, 'percent', 0, 60, 60, D2, `${D2}T10:00:00`],
    ];
    for (const o of orders) {
      run("INSERT INTO orders (id, orderNumber, status, paymentStatus, subtotal, discount, discountAmount, discountType, tax, total, totalPaid, date, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", o);
    }

    const items = [
      [1, 300, 'قهوة تركي (وصفة)', 2, 100, 200, 40],
      [2, 301, 'كابتشينو (بلا وصفة)', 1, 150, 150, 30],
      [3, 301, 'كابتشينو (بلا وصفة)', 1, 100, 100, 30],
      [4, 300, 'قهوة تركي (وصفة)', 1, 120, 120, 20],
      [7, 301, 'كابتشينو (بلا وصفة)', 2, 150, 300, 60],
      [8, 301, 'كابتشينو (بلا وصفة)', 1, 80, 80, 30],
      [9, 302, 'كوفي بارد (بلا تكلفة)', 1, 60, 60, 0],
    ];
    for (const it of items) {
      run("INSERT INTO order_items (orderId, productId, name, quantity, unitPrice, total, cost) VALUES (?,?,?,?,?,?,?)", it);
    }

    const payments = [
      [1, 'cash', 200, `${D}T10:05:00`],
      [2, 'card', 135, `${D}T10:10:00`],
      [3, 'cash', 100, `${D}T10:15:00`],
      [4, 'card', 120, `${D}T10:20:00`],
      [7, 'cash', 150, `${D}T10:25:00`],
      [7, 'card', 150, `${D}T10:26:00`],
      [8, 'cash', 80, `${D}T10:28:00`],
      [9, 'card', 60, `${D2}T10:00:00`],
    ];
    for (const p of payments) {
      run("INSERT INTO payments (orderId, amount, method, status, createdAt) VALUES (?,?,?,?,?)", [p[0], p[2], p[1], 'completed', p[3]]);
    }

    run("INSERT INTO refunds (orderId, amount, type, refundMethod, createdAt) VALUES (?,?,?,?,?)", [3, 100, 'full', 'cash', `${D}T10:30:00`]);
    run("INSERT INTO refunds (orderId, amount, type, refundMethod, createdAt) VALUES (?,?,?,?,?)", [4, 20, 'partial', 'cash', `${D}T10:35:00`]);

    run("INSERT INTO daily_shifts (date, openingBalance, actualCash, status) VALUES (?,?,?,?)", [D, 500, 840, 'closed']);

    run("INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)", ['كهرباء', 'utilities', 120, 'bank', `${D}T09:00:00`, `${D}T09:00:00`]);
    run("INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)", ['مواد تنظيف', 'operating', 80, 'cash', `${D}T09:30:00`, `${D}T09:30:00`]);
    run("INSERT INTO expenses (description, category, amount, paymentMethod, date, createdAt) VALUES (?,?,?,?,?,?)", ['رواتب الشيف', 'salaries', 500, 'bank', `${D}T12:00:00`, `${D}T12:00:00`]);

    run("INSERT INTO purchases (name, item, quantity, costPrice, total, supplier, date, createdBy) VALUES (?,?,?,?,?,?,?,?)", ['طماطم', 'طماطم', 10, 40, 400, 'مورد الخضار', `${D}T08:00:00`, 'admin']);

    const report = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'reportService.js')).href);
    const sales = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'salesService.js')).href);
    const inventory = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'inventoryService.js')).href);
    const expenses = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'expenseService.js')).href);
    const purchases = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'purchaseService.js')).href);
    const accounting = await import(pathToFileURL(path.join(BACKEND, 'dist', 'services', 'accountingService.js')).href);

    let t = sales.calculateOrderFinancials([{ quantity: 2, unitPrice: 100 }], 0, 'percent', 0);
    record('sales.calculateOrderFinancials (عادي)', t.subtotal === 200 && t.discountAmount === 0 && t.total === 200, '');

    t = sales.calculateOrderFinancials([{ quantity: 1, unitPrice: 150 }], 10, 'percent', 0);
    record('sales.calculateOrderFinancials (نسبة مئوية 10%)', t.subtotal === 150 && t.discountAmount === 15 && t.total === 135, '');

    t = sales.calculateOrderFinancials([{ quantity: 1, unitPrice: 150 }], 15, 'fixed', 0);
    record('sales.calculateOrderFinancials (مبلغ ثابت 15)', t.subtotal === 150 && t.discountAmount === 15 && t.total === 135, '');

    const o1 = sales.getOrder(1);
    record('sales.getOrder(1) مفصل', o1 && o1.id === 1 && o1.total === 200 && o1.items.length === 1 && o1.payments.length === 1, '');

    const allOrders = sales.getOrders({ from: D, to: D2 });
    record('sales.getOrders يشمل ملغي/معلق', allOrders.length === 9, '');

    record('sales.getOrderItems/getPayments/getRefunds', sales.getOrderItems(1).length === 1 && sales.getPayments({ orderId: 7 }).length === 2 && sales.getRefunds({ orderId: 3 }).length === 1, '');

    const net = report.getNetSales(D, D);
    const shape = ['value', 'currency', 'period', 'source', 'completeness', 'warnings'];
    const shapeOk = shape.every((k) => k in net) && net.currency === 'SYP' && net.completeness === 'complete';
    record('getNetSales شكل MetricResult', shapeOk, JSON.stringify(net));

    record('getNetSales = Σ total(935) − refunds(120) = 815', report.getNetSales(D, D).value === 815, '');
    record('getGrossSales = Σ subtotal = 950', report.getGrossSales(D, D).value === 950, '');
    record('getRefunds = 120', report.getRefunds(D, D).value === 120, '');
    record('getCancelledCount = 1', report.getCancelledCount(D, D).value === 1, '');
    record('getAOV = 935/6 (قبل الاسترداد)', Math.abs(report.getAOV(D, D).value - 935 / 6) < 1e-6, '');
    record('getCOGS = recipe(2×20) + product(30×5) = 210', report.getCOGS(D, D).value === 210 && report.getCOGS(D, D).completeness === 'complete', '');
    record('getGrossProfit = 815 − 210 = 605', report.getGrossProfit(D, D).value === 605, '');
    record('getOperatingExpenses = 120+80+500 = 700', report.getOperatingExpenses(D, D).value === 700, '');
    record('getOperatingProfit = 605 − 700 = −95', report.getOperatingProfit(D, D).value === -95, '');
    record('getCashExpected = 500 + 530 − 120 − 80 = 830', report.getCashExpected(D, D).value === 830, '');
    const cr = report.getCashReport(D, D);
    record('getCashReport = expected 830 / actual 840 / diff 10', cr.expected === 830 && cr.actual === 840 && cr.difference === 10, '');

    const u101 = inventory.getProductUnitCost(300);
    eq(u101.cost, 20, 'unit cost recipe'); eq(u101.source, 'recipe', 'source recipe');
    record('unitCost (1) recipe اكتملت → 0.5×40 = 20', u101.cost === 20 && u101.source === 'recipe', '');
    const u102 = inventory.getProductUnitCost(301);
    eq(u102.cost, 30, 'unit cost product'); eq(u102.source, 'product', 'source product');
    record('unitCost (2) بلا recipe → products.cost = 30', u102.cost === 30 && u102.source === 'product', '');
    const u103 = inventory.getProductUnitCost(302);
    eq(u103.cost, null, 'unit cost none'); eq(u103.source, 'none', 'source none');
    record('unitCost (3) لا recipe ولا cost → null', u103.cost === null && u103.source === 'none', '');
    const c11 = report.getCOGS(D2, D2);
    record('getCOGS(2026-08-11) cost ناقصة → null + unavailable', c11.value === null && c11.completeness === 'unavailable', JSON.stringify({ value: c11.value, completeness: c11.completeness }));

    record('inventory.getStock/getStockValue', inventory.getStock().length === 1 && inventory.getStockValue() === 400, '');
    record('inventory.getProductStock(300) عبر الوصفة', inventory.getProductStock(300).length === 1, '');

    const es = expenses.getExpenseSummary({ from: D, to: D });
    record('expenseSummary = 700 / كاش 80 / 3 بنود', es.total === 700 && es.cash === 80 && es.count === 3, '');

    const ps = purchases.getPurchaseSummary({ from: D, to: D });
    record('purchaseSummary = 400 / بند واحد (جدول مسطّح بلا purchase_items)', ps.total === 400 && ps.count === 1, '');

    const pl = accounting.getProfitAndLoss(D, D);
    record('accounting.getProfitAndLoss', pl.netSales === 815 && pl.cogs === 210 && pl.grossProfit === 605 && pl.operatingExpenses === 700 && pl.operatingProfit === -95, JSON.stringify(pl));

    const ss = accounting.getSalesSummary(D, D);
    record('accounting.getSalesSummary', ss.grossSales === 950 && ss.discounts === 15 && ss.netSales === 815 && ss.ordersCount === 6 && ss.cancelledCount === 1, JSON.stringify(ss));

    const cd = accounting.getCashDrawer(D, D);
    record('accounting.getCashDrawer', cd.expected === 830 && cd.actual === 840 && cd.difference === 10, JSON.stringify(cd));

    const invSum = accounting.getInventorySummary();
    record('accounting.getInventorySummary', invSum.totalValue === 400 && invSum.totalItems === 1, '');

    const fr = report.getFinancialReport(D, D);
    eq(fr.netSales, 815, 'fr net'); eq(fr.cogs, 210, 'fr cogs'); eq(fr.grossProfit, 605, 'fr gp'); eq(fr.operatingProfit, -95, 'fr opP'); eq(fr.expenses, 700, 'fr exp');
    eq(fr.paymentMethodTotals.cash, 530, 'fr cash total'); eq(fr.paymentMethodTotals.card, 405, 'fr card total');
    eq(fr.cash.expected, 830, 'fr cash exp'); eq(fr.cash.actual, 840, 'fr cash act'); eq(fr.cash.difference, 10, 'fr cash diff');
    eq(fr.discounts, 15, 'fr discounts'); eq(fr.cancelledCount, 1, 'fr cancelled'); eq(fr.currency, 'SYP', 'fr currency'); eq(fr.taxEnabled, false, 'fr tax');
    record('getFinancialReport (شكل العقد §4)', fr.netSales === 815 && fr.cogs === 210 && fr.grossProfit === 605 && fr.operatingProfit === -95 && fr.paymentMethodTotals.cash === 530 && fr.paymentMethodTotals.card === 405 && fr.cash.expected === 830 && fr.cash.difference === 10 && fr.currency === 'SYP' && fr.taxEnabled === false, '');

    const legacy = report.getSalesReport(D, D);
    record('PHASE4 تقارب التقارير: SalesReport = قياسي (subtotal→total بلا خصم مزدوج) = Σtotal(935) − refunds(120) = 815', legacy.netSales === 815, `netSales=${legacy.netSales}`);
    record('PHASE4 تقارب التقارير: Δ NEW − OLD = 0 (لا انحراف متبقٍ)', report.getNetSales(D, D).value - legacy.netSales === 0, `Δ=${report.getNetSales(D, D).value - legacy.netSales}`);

    const ceNext = report.getCashExpected(D2, D2);
    record('getCashExpected بلا shift → رصيد افتتاح 0 + تحذير', ceNext.value === 0 && ceNext.warnings.length === 1, JSON.stringify(ceNext));

    console.log('\n====================');
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('خطأ في التنفيذ:', e);
    process.exitCode = 1;
  }
})();