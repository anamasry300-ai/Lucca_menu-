// ==== اختبارات العقل المحاسبي (13 أداة + موزّع) ====
// بيئة منفصلة: لا تلمس أي بيانات إنتاج. يعمل على معرفة وهمية في الذاكرة.
// التشغيل: node c2-tests/accounting-tools.cjs
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
function eq(a, b, label) { if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const T = () => new Date().toISOString();
const Y = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString(); };

(async () => {
  try {
    // ---------- بيانات وهمية ----------
    const orders = [
      { id: 1, orderNumber: 'O1', tableId: '1', total: 1000, status: 'completed', paymentStatus: 'paid', createdAt: T(), date: T() },
      { id: 2, orderNumber: 'O2', tableId: '2', total: 500, status: 'completed', paymentStatus: 'paid', createdAt: T(), date: T() },
      { id: 3, orderNumber: 'O3', tableId: '3', total: 300, status: 'pending', paymentStatus: 'unpaid', createdAt: T(), date: T() },
      { id: 4, orderNumber: 'O4', tableId: '4', total: 700, status: 'completed', paymentStatus: 'paid', createdAt: Y(), date: Y() }
    ];
    const refunds = [{ id: 1, amount: 200, createdAt: T(), date: T() }];
    const expenses = [
      { id: 1, description: 'كهرباء', amount: 120, category: 'utilities', paymentMethod: 'bank', createdAt: T(), date: T() },
      { id: 2, description: 'مواد تنظيف', amount: 80, category: 'operating', paymentMethod: 'cash', createdAt: T(), date: T() },
      { id: 3, description: 'رواتب الشيف', amount: 500, category: 'salaries', paymentMethod: 'bank', createdAt: T(), date: T() }
    ];
    const purchases = [
      { id: 1, supplier: 'مورد الخضار', total: 400, items: [{ name: 'طماطم', quantity: 10, price: 40 }], createdAt: T(), date: T() },
      { id: 2, supplier: 'مورد اللحوم', total: 600, items: [], createdAt: T(), date: T() }
    ];
    const inventory = [
      { id: 1, name: 'طماطم', quantity: 10, costPerUnit: 40, minStock: 5 },
      { id: 2, name: 'قهوة', quantity: 2, costPerUnit: 150, minStock: 5 },
      { id: 3, name: 'سكر', quantity: 20, costPerUnit: 20, minStock: 3 }
    ];
    const products = [
      { id: 101, name: 'قهوة تركي', nameAr: 'قهوة تركي', price: 400, cost: 150 },
      { id: 102, name: 'كابتشينو', nameAr: 'كابتشينو', price: 500, cost: 180 }
    ];
    const recipes = { 101: [{ ingredientId: 1, quantityNeeded: 0.5 }], 102: [{ ingredientId: 2, quantityNeeded: 1 }] };
    const recipeCosts = { 101: 20, 102: 150 };
    const drawer = { id: 5, openingCash: 1000, openedAt: T() };
    const todaySummary = { totalCashSales: 1000, totalCardSales: 300, totalExpenses: 300, totalRefunds: 0, transactionCount: 3, netCash: 700, drawersCount: 1 };

    const mockDB = {
      Orders: { async getAll() { return orders; } },
      Expenses: { async getAll() { return expenses; } },
      Purchases: { async getAll() { return purchases; } },
      Inventory: { async getAll() { return inventory; } },
      Products: { async getActive() { return products; } },
      ProductRecipes: {
        async getByProduct(id) { return recipes[id] || []; },
        async getRecipeCost(id) { return recipeCosts[id] || 0; }
      },
      CashRegister: {
        async getActiveDrawer() { return drawer; },
        async getTodaySummary() { return todaySummary; }
      },
      db: { async getAll(store) { return store === 'refunds' ? refunds : []; } }
    };

    global.window = { LuccaDB: mockDB };
    require(path.join(ROOT, 'ai-pos-engine.js'));
    const eng = window.aiPosEngine;
    eq(!!eng, true, 'engine instance');

    async function run(name, toolName, params, assert) {
      const r = await eng.executeTool(toolName, params || {});
      try {
        assert(r);
        record(name, true, (r.data ? JSON.stringify(r.data).slice(0, 90) : ''));
      } catch (err) {
        record(name, false, err.message);
      }
      return r;
    }

    // 1) تقرير المبيعات: اليوم صافي=1300 (1000+500 - 200 مرتجعات)
    await run('1. getSalesReport', 'sales_report', {},
      r => { eq(r.success, true, 's'); eq(r.data.net, 1300, 'net'); eq(r.data.count, 2, 'count'); eq(r.data.gross, 1500, 'gross'); });

    // 2) مصروفات اليوم: 120+80+500 = 700
    await run('2. getExpenses', 'expenses_report', {},
      r => { eq(r.success, true, 's'); eq(r.data.total, 700, 'total'); eq(r.data.count, 3, 'count'); });

    // 3) مشتريات اليوم: 1000
    await run('3. getPurchases', 'purchases_report', {},
      r => { eq(r.success, true, 's'); eq(r.data.total, 1000, 'total'); eq(r.data.count, 2, 'count'); });

    // 4) المخزون: قيمة = 10*40+2*150+20*20 = 400+300+400 = 1100
    await run('4. getInventory', 'inventory_value', {},
      r => { eq(r.success, true, 's'); eq(r.data.totalValue, 1100, 'value'); eq(r.data.lowCount, 1, 'low'); });

    // 5) تكلفة الصنف (من الوصفة)
    await run('5. getProductCost (وصفة)', 'product_cost', { productName: 'قهوة' },
      r => { eq(r.success, true, 's'); eq(r.data.cost, 20, 'cost'); eq(r.data.viaRecipe, true, 'recipe'); });
    await run('5b. getProductCost (غير موجود)', 'product_cost', { productName: 'غيرموجود' },
      r => { eq(r.success, false, 'fail'); });

    // 6) Food cost (فترة): مشتريات 1000 ÷ صافي 1300 = 76.9%
    await run('6. calculateFoodCost (فترة)', 'food_cost', {},
      r => { eq(r.success, true, 's'); eq(Math.round(r.data.foodCostPercent * 10) / 10, 76.9, 'pct'); });
    await run('6b. calculateFoodCost (صنف)', 'food_cost', { productName: 'قهوة' },
      r => { eq(r.success, true, 's'); eq(Math.round(r.data.foodCostPercent), 5, 'pct'); }); // 20/400*100 = 5%

    // 7) الربح الإجمالي = 1300 - 1000 = 300
    await run('7. calculateGrossProfit', 'gross_profit', {},
      r => { eq(r.success, true, 's'); eq(r.data.grossProfit, 300, 'gross'); });

    // 8) الهامش = 300/1300*100 = 23.08%
    await run('8. calculateGrossMargin', 'gross_margin', {},
      r => { eq(r.success, true, 's'); eq(Math.round(r.data.grossMargin * 100) / 100, 23.08, 'margin'); });

    // 9) Prime = 1000 (مشتريات) + 500 (رواتب) = 1500 → 115.4%
    await run('9. calculatePrimeCost', 'prime_cost', {},
      r => { eq(r.success, true, 's'); eq(r.data.primeCost, 1500, 'prime'); eq(r.data.laborCost, 500, 'labor'); });

    // 10) حالة الوردية
    await run('10. getCashRegisterStatus', 'drawer_status', {},
      r => { eq(r.success, true, 's'); eq(r.data.drawer.id, 5, 'drawer'); eq(r.data.summary.netCash, 700, 'net'); });

    // 11) الملخص اليومي: ربح = 1300-700-1000 = -400 (خسارة تقديرية)
    await run('11. getDailySummary', 'daily_summary', {},
      r => { eq(r.success, true, 's'); eq(r.data.profit, -400, 'profit'); eq(r.data.lowStock.length, 1, 'low'); });

    // 12) ربحية الأصناف: قهوة 20/400=95% ، كابتشينو 150/500=70%
    await run('12. getProductProfitability', 'product_profitability', {},
      r => { eq(r.success, true, 's'); eq(r.data.rows.length, 2, 'rows'); eq(r.data.rows[0].margin, 95, 'top margin'); });

    // 13) التصدير اليومي
    await run('13. exportAccountingReport (daily)', 'export_report', { report: 'daily', period: 'today' },
      r => {
        eq(r.success, true, 's');
        const csv = r.data.csv;
        eq(csv.charCodeAt(0), 0xFEFF, 'BOM');
        eq(csv.includes('net_sales'), true, 'metric presence');
        eq(csv.includes('1300'), true, 'value presence');
      });

    // استدعاء مباشر لجداول التصدير الأخرى
    const expCSV = (await eng.executeTool('export_report', { report: 'expenses', period: 'today' })).data;
    eq(expCSV.csv.includes('كهرباء'), true, 'expenses csv desc');

    // ---------- الموزّع (AccountingCommand) ----------
    const cases = [
      ['التكلفة الأولية اليوم', 'calculatePrimeCost'],
      ['ملخص اليوم الشامل', 'getDailySummary'],
      ['الربح الإجمالي', 'calculateGrossProfit'],
      ['هامش الربح', 'calculateGrossMargin'],
      ['حالة الوردية النقدية', 'getCashRegisterStatus'],
      ['قيمة المخزون', 'getInventory'],
      ['تصدير تقرير مصروفات', 'exportAccountingReport'],
      ['تقرير مبيعات', 'getSalesReport'],
      ['تقرير مصروفات', 'getExpenses'],
      ['تقرير مشتريات', 'getPurchases'],
      ['مرحباً كيف حالك', null]
    ];
    let cOk = true;
    for (const [q, expectTool] of cases) {
      const res = await eng.accountingCommand(q);
      const got = res ? res.tool : null;
      if (got !== expectTool) { cOk = false; record('AC map: ' + q, false, `expected ${expectTool}, got ${got}`); }
    }
    if (cOk) record('14. accountingCommand يوزّع الأوامر المحاسبية (8 حالات)', true, '');

    // ---------- نظام الثقة: وسوم في الرسالة ----------
    const dailyMsg = (await eng.executeTool('daily_summary', {})).message;
    record('15. وسوم الثقة [حساب/بيان] في الرد', /🧮|📊/.test(dailyMsg), '');
  } catch (err) {
    console.error('EXCEPTION:', err && err.stack || err);
    process.exitCode = 1;
    return;
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
  console.log('====================');
  process.exitCode = failed ? 1 : 0;
})();