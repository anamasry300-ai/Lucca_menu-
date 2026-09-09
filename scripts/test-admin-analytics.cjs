// LUCCA — اختبار طبقة الحسابات الموحدة (admin/admin-analytics.js)
// أرقام معروفة مسبقاً → تحقق من المخرجات بلا مزامنة ولا سيرفر.
const path = require('path');
require(path.join(__dirname, '..', 'admin', 'admin-analytics.js'));
const A = globalThis.AdminAnalytics;
if (!A) { console.error('FAIL: AdminAnalytics غير مضافة'); process.exit(1); }

const TODAY = new Date().toISOString().slice(0, 10);

const db = {
  Orders: {
    async getAll() {
      return [
        { id: 1, syncId: 's1', date: TODAY, total: 1000, paymentMethod: 'cash', paymentStatus: 'paid', status: 'closed', discount: 50, createdBy: 'user1', items: [{ productId: 1, nameAr: 'قهوة', quantity: 2, total: 400 }, { productId: 2, nameAr: 'كيك', quantity: 1, total: 600 }] },
        { id: 2, syncId: 's2', date: TODAY, total: 500, paymentMethod: 'card', paymentStatus: 'paid', status: 'closed', createdBy: 'user1', items: [{ productId: 1, nameAr: 'قهوة', quantity: 1, total: 200 }, { productId: 3, nameAr: 'عصير', quantity: 1, total: 300 }] },
        { id: 3, syncId: 's3', date: '2024-01-01', total: 300, paymentStatus: 'paid', status: 'closed', createdBy: 'user2', items: [] }
      ];
    }
  },
  Tables: { async getAll() { return [{ id: 1, number: 1, status: 'occupied', capacity: 4 }, { id: 2, number: 2, status: 'available', capacity: 2 }]; } },
  Products: { async getAll() { return [{ id: 1, nameAr: 'قهوة', price: 200, cost: 50, categoryId: 1 }, { id: 2, nameAr: 'كيك', price: 600, cost: 300, categoryId: 2 }, { id: 3, nameAr: 'عصير', price: 300, cost: 0, categoryId: 2 }]; } },
  Categories: { async getAll() { return [{ id: 1, nameAr: 'مشروبات' }, { id: 2, nameAr: 'حلويات' }]; } },
  Expenses: { async getAll() { return [{ id: 1, amount: 200, category: 'مواد خام', date: TODAY }, { id: 2, amount: 100, category: 'نقل', date: TODAY }, { id: 3, amount: 9999, category: 'قديم', date: '2024-01-01' }]; } },
  Inventory: { async getAll() { return [{ id: 1, name: 'سكر', quantity: 2, minStock: 5, cost: 100, unit: 'كج' }, { id: 2, name: 'شاي', quantity: 0, minStock: 2, cost: 50 }, { id: 3, name: 'اكياس', quantity: 10, minStock: 2, cost: 20 }]; } },
  CashRegister: { async getAllDrawers() { return [{ id: 1, openedAt: TODAY + 'T09:00', status: 'open', startingCash: 500, totalCashSales: 1000, totalCardSales: 500, totalExpenses: 100, totalRefunds: 0 }]; } },
  Employees: { async getAll() { return [{ id: 9, name: 'أحمد' }]; } },
  PaymentMethods: { async getAll() { return [{ id: 1, name: 'كاش' }]; } },
  db: {
    async getAll(store) {
      if (store === 'refunds') return [{ id: 1, orderId: 2, amount: 100, date: TODAY }];
      if (store === 'order_items') return [];
      return [];
    }
  }
};

let pass = 0, fail = 0;
function eq(name, actual, expected, tol) {
  const ok = tol ? Math.abs(actual - expected) < tol : actual === expected;
  if (ok) { pass++; console.log('  ✔ ' + name + ' = ' + actual); }
  else { fail++; console.log('  ✘ ' + name + ' = ' + actual + ' (متوقع ' + expected + ')'); }
}

(async () => {
  const r = await A.compute(db, { from: TODAY, to: TODAY });

  console.log('\nKPIs:');
  eq('صافي المبيعات', r.kpis.sales.value, 1400);
  eq('عدد الطلبات', r.kpis.orders.value, 2);
  eq('متوسط الطلب', r.kpis.avgOrder.value, 700);
  eq('الخصومات', r.kpis.discounts.value, 50);
  eq('المرتجعات', r.kpis.refunds.value, 100);

  console.log('\nمبيعات اليوم:');
  eq('إيراد اليوم', r.salesByDay[0].revenue, 1400);
  eq('طلبات اليوم', r.salesByDay[0].orders, 2);

  console.log('\nطرق الدفع:');
  const cash = r.payments.find(p => p.method === 'cash');
  const card = r.payments.find(p => p.method === 'card');
  eq('كاش نقدي', cash.total, 1000);
  eq('كارت', card.total, 500);
  eq('عدد كاش', cash.count, 1);
  eq('نسبة كاش %', cash.percentage, 66.666, 0.01);

  console.log('\nأفضل المنتجات:');
  eq('أعلى منتج', r.topProducts[0].name, 'قهوة');
  eq('إيراد قهوة', r.topProducts[0].revenue, 600);
  eq('كمية قهوة', r.topProducts[0].quantity, 3);

  console.log('\nالأقسام:');
  eq('أعلى قسم', r.salesByCategory[0].name, 'حلويات');
  eq('إيراد حلويات', r.salesByCategory[0].revenue, 900);

  console.log('\nالمصروفات (فترة اليوم فقط):');
  eq('إجمالي المصروفات', r.expenses.total, 300);
  eq('عدد المصروفات', r.expenses.count, 2);
  eq('فئة مواد خام', r.expenses.byCategory.find(c => c.name === 'مواد خام').total, 200);

  console.log('\nالربح (تقديري صادق):');
  eq('إجمالي الربح', r.profit.grossProfit, 750);
  eq('نقص بيانات تكلفة', r.profit.missingCost, true);
  eq('تغطية التكلفة %', r.profit.coverage, 80);

  console.log('\nالمخزون:');
  eq('منخفض', r.inventory.lowStock, 1);
  eq('نفد', r.inventory.outOfStock, 1);
  eq('قيمة المخزون', r.inventory.inventoryValue, 200 + 0 + 200);

  console.log('\nالطاولات:');
  eq('عدد الطاولات', r.tables.tables.length, 2);
  eq('مشغولة', r.tables.summary.find(s => s.status === 'occupied').count, 1);
  eq('متاحة', r.tables.summary.find(s => s.status === 'available').count, 1);

  console.log('\nالربح الهيكلي:');
  eq('GrossProfit - Expenses مصروفات الربح', r.profit.netProfit, 450);

  console.log('\nتنبيهات:');
  eq('تنبيه نفاد', r.alerts.some(a => a.severity === 'danger'), true);
  eq('تنبيه مخزون منخفض', r.alerts.some(a => a.title === 'مخزون منخفض'), true);

  console.log('\nالموظفون:');
  eq('موظف user1 - طلبات', r.employeesReport.find(e => e.name === 'user1').orders, 2);

  console.log('\n---');
  if (fail) { console.log('FAILED: ' + fail); process.exit(1); }
  console.log('PASSED: ' + pass + '/' + (pass + fail));
})();