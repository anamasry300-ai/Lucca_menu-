/**
 * LUCCA Admin — طبقة الحسابات الموحدة (Single Source of Truth)
 * مصدر البيانات الوحيد = window.LuccaDB (نفس المصدر الذي يعمل به POS أونلاين/أوفلاين).
 * لا تعتمد على أي سيرفر خارجي، وكل رقم هنا قابل للتحقق من مخازن LuccaDB مباشرة.
 * تستخدمها: لوحة التحكم، مركز التقارير، و Batman (نفس المنطق — لا حسابات متفرقة).
 */
(function (global) {
  'use strict';

  function day(d) { return String(d || '').slice(0, 10); }
  function num(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }
  function inRange(d, from, to) { return d >= from && d <= to; }
  function sum(arr, f) { return arr.reduce((s, x) => s + num(f(x)), 0); }
  function isPaidOrder(o) {
    return o.paymentStatus === 'paid' || o.status === 'completed' || o.status === 'closed';
  }
  function isOpenOrder(o) {
    return (o.status === 'open' || o.status === 'pending' || o.status === 'preparing' || o.status === 'in_preparation') && o.paymentStatus !== 'paid';
  }
  function orderTotal(o) {
    const t = num(o.total !== undefined && o.total !== null ? o.total : o.totalAmount);
    return t;
  }
  // ألوان/أسماء مستقرة لأنواع التنبيه
  function pct(part, total) { return total > 0 ? (part / total) * 100 : 0; }

  function formatMoneyLocal(n) {
    return (Number(n) || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  }

  // عناصر الطلب: إمّا مضمّنة في order.items أو مخزّنة في مخزن order_items (نفس البيانات عبر المزامنة).
  function itemsOf(o, orderItemsRows, productsById) {
    if (Array.isArray(o.items) && o.items.length) return o.items;
    const rows = orderItemsRows.filter(r => (r.orderId !== undefined && String(r.orderId) === String(o.id)) || (o.syncId && r.orderSyncId === o.syncId));
    if (rows.length) return rows;
    return o.items || [];
  }

  async function readAll(db) {
    try { return await db.Orders.getAll(); } catch (e) { return []; }
  }

  /**
   * الحساب الأساسي — كل قطاعات لوحة التحكم والتقارير.
   */
  async function compute(db, opts) {
    const opts2 = opts || {};
    const from = opts2.from || day(new Date().toISOString());
    const to = opts2.to || from;
    const today = day(new Date().toISOString());

    const orders = await readAll(db);
    const orderById = {};
    orders.forEach(o => { orderById[o.id] = o; if (o.syncId) orderById[o.syncId] = o; });
    const tables = await (async () => { try { return await db.Tables.getAll(); } catch (e) { return []; } })();
    const products = await (async () => { try { return await db.Products.getAll(); } catch (e) { return []; } })();
    const categories = await (async () => { try { return await db.Categories.getAll(); } catch (e) { return []; } })();
    const expenses = await (async () => { try { return await db.Expenses.getAll(); } catch (e) { return []; } })();
    const inventory = await (async () => { try { return await db.Inventory.getAll(); } catch (e) { return []; } })();
    const refunds = await (async () => { try { return await db.db.getAll('refunds'); } catch (e) { return []; } })();
    const orderItemsRows = await (async () => { try { return await db.db.getAll('order_items'); } catch (e) { return []; } })();
    const paymentMethods = await (async () => { try { return await db.PaymentMethods.getAll(); } catch (e) { return []; } })();
    const drawers = await (async () => { try { return await db.CashRegister.getAllDrawers(); } catch (e) { return []; } })();
    const employees = await (async () => { try { return await db.Employees.getAll(); } catch (e) { return []; } })();

    const productsById = {};
    products.forEach(p => { productsById[p.id] = p; });
    const catNames = {};
    categories.forEach(c => { catNames[c.id] = c.nameAr || c.name || c.id; });
    const empById = {};
    employees.forEach(e => { empById[e.id] = (e.name || e.username || ''); });

    // ===== الفترة الحالية والفترة السابقة (للمقارنة) =====
    const rangeOrders = orders.filter(o => inRange(day(o.date || o.createdAt), from, to));
    const completed = rangeOrders.filter(isPaidOrder);

    const rangeRefunds = refunds.filter(r => inRange(day(r.date || r.createdAt || r.updatedAt || r.voidedAt), from, to));
    const refundsTotal = sum(rangeRefunds, r => r.amount);

    const gross = sum(completed, orderTotal);
    const refundsDeduction = refundsTotal;
    const net = gross - refundsDeduction;
    const discounts = sum(rangeOrders, o => o.discount);
    const avgOrder = completed.length ? Math.round(net / completed.length) : 0;

    // الفترة السابقة لنفس الطول
    const span = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const prevEnd = new Date(new Date(from).getTime() - 1);
    const prevFrom = new Date(new Date(from).getTime() - span * 86400000);
    const pf = day(prevFrom.toISOString());
    const pt = day(prevEnd.toISOString());
    const prevCompleted = orders.filter(o => { const d = day(o.date || o.createdAt); return d >= pf && d <= pt && isPaidOrder(o); });
    const prevGross = sum(prevCompleted, orderTotal);
    const prevRefunds = sum(refunds.filter(r => { const d = day(r.date || r.createdAt || r.updatedAt); return d >= pf && d <= pt; }), r => r.amount);
    const prevNet = prevGross - prevRefunds;
    const prevCount = prevCompleted.length;
    const prevAvg = prevCount ? Math.round(prevNet / prevCount) : 0;

    const change = (cur, prev) => prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);
    const kpis = {
      sales: { value: net, change: change(net, prevNet) },
      orders: { value: completed.length, change: change(completed.length, prevCount) },
      avgOrder: { value: avgOrder, change: change(avgOrder, prevAvg) },
      discounts: { value: discounts },
      refunds: { value: refundsDeduction }
    };

    // ===== المبيعات حسب اليوم =====
    const dayMap = {};
    const dayOrders = {};
    completed.forEach(o => { const d = day(o.date || o.createdAt); dayMap[d] = (dayMap[d] || 0) + orderTotal(o); dayOrders[d] = (dayOrders[d] || 0) + 1; });
    const refundByDay = {};
    rangeRefunds.forEach(r => { const d = day(r.date || r.createdAt || r.updatedAt); refundByDay[d] = (refundByDay[d] || 0) + num(r.amount); });
    const salesByDay = Object.keys(dayMap).sort().map(d => ({
      date: d,
      orders: dayOrders[d] || 0,
      revenue: num(dayMap[d]) - num(refundByDay[d] || 0)
    }));

    // ===== المبيعات حسب القسم/المنتج (من عناصر الطلبات المدفوعة فقط) =====
    const catStat = {};
    const prodStat = {};
    const prodOrder = 0;
    completed.forEach(o => {
      itemsOf(o, orderItemsRows, productsById).forEach(i => {
        const revenue = num(i.total);
        const qty = num(i.quantity) || 1;
        const pid = i.productId || i.product_id;
        const p = pid != null ? productsById[pid] : null;
        const catId = i.categoryId || (p && p.categoryId) || 'uncategorized';
        if (!catStat[catId]) catStat[catId] = { categoryId: catId, revenue: 0, qtySold: 0 };
        catStat[catId].revenue += revenue;
        catStat[catId].qtySold += qty;
        const name = i.nameAr || i.name || (p && (p.nameAr || p.name)) || '—';
        if (!prodStat[name]) prodStat[name] = { name, quantity: 0, revenue: 0, category: catNames[catId] || '—' };
        prodStat[name].quantity += qty;
        prodStat[name].revenue += revenue;
      });
    });
    const salesByCategory = Object.values(catStat).map(c => ({ ...c, name: catNames[c.categoryId] || c.categoryId }))
      .sort((a, b) => b.revenue - a.revenue);
    const topProducts = Object.values(prodStat)
      .sort((a, b) => b.revenue - a.revenue)
      .map((p, idx) => ({ ...p, rank: idx + 1 }));
    const lowProducts = Object.values(prodStat)
      .filter(p => p.revenue > 0)
      .sort((a, b) => a.revenue - b.revenue);

    // ===== طرق الدفع =====
    const payMap = {};
    completed.forEach(o => { const m = o.paymentMethod || 'cash'; payMap[m] = (payMap[m] || 0) + orderTotal(o); payMap[m + '__c'] = (payMap[m + '__c'] || 0) + 1; });
    const paymentsTotal = Object.keys(payMap).reduce((s, k) => s + (k.endsWith('__c') ? 0 : payMap[k]), 0);
    const payments = Object.keys(payMap)
      .filter(k => !k.endsWith('__c'))
      .map(m => ({
        method: m,
        total: payMap[m],
        count: payMap[m + '__c'] || 0,
        percentage: paymentsTotal > 0 ? (payMap[m] / paymentsTotal) * 100 : 0
      }));

    // ===== المصروفات =====
    const rangeExpenses = expenses.filter(e => inRange(day(e.date || e.createdAt || e.updatedAt), from, to));
    const expensesByCat = {};
    const expensesByEmp = {};
    let expensesTotal = 0;
    rangeExpenses.forEach(e => {
      const amt = num(e.amount);
      expensesTotal += amt;
      const c = e.category || 'عام';
      if (!expensesByCat[c]) expensesByCat[c] = { name: c, count: 0, total: 0 };
      expensesByCat[c].count += 1;
      expensesByCat[c].total += amt;
      const who = e.employeeName || (e.createdBy && empById[e.createdBy]) || e.createdBy || '—';
      if (!expensesByEmp[who]) expensesByEmp[who] = { name: who, count: 0, total: 0 };
      expensesByEmp[who].count += 1;
      expensesByEmp[who].total += amt;
    });

    // ===== الخصومات / المرتجعات =====
    const discountedOrders = rangeOrders.filter(o => num(o.discount) > 0);
    const voided = rangeOrders.filter(o => o.status === 'cancelled');
    const voidTotal = sum(voided, orderTotal);

    // ===== المخزون =====
    const invItems = inventory.map(i => {
      const qty = num(i.quantity);
      const min = num(i.minStock !== undefined ? i.minStock : i.minQuantity);
      let status;
      if (qty <= 0) status = 'out';
      else if (qty <= min) status = 'low';
      else status = 'ok';
      return { name: i.name || i.title || '—', quantity: qty, unit: i.unit || '', cost: num(i.cost || i.costPrice), minStock: min, status, id: i.id };
    });
    const outOfStock = invItems.filter(i => i.status === 'out');
    const lowStock = invItems.filter(i => i.status === 'low');
    const inventoryValue = sum(invItems, i => i.cost * i.quantity);

    // ===== الربح (صادق): إيراد − تكلفة البضاعة للعناصر ذات تكلفة، مع علم تقديري =====
    let costedRevenue = 0, costedCost = 0, totalRevenueAll = 0, missingCost = false, missingProducts = 0;
    completed.forEach(o => {
      itemsOf(o, orderItemsRows, productsById).forEach(i => {
        const revenue = num(i.total);
        const qty = num(i.quantity) || 1;
        totalRevenueAll += revenue;
        const pid = i.productId || i.product_id;
        const p = pid != null ? productsById[pid] : null;
        if (p && num(p.cost) > 0) {
          costedRevenue += revenue;
          costedCost += num(p.cost) * qty;
        } else if (pid == null) {
          missingCost = true;
        } else {
          missingCost = true;
          missingProducts += 1;
        }
      });
    });
    const grossProfit = costedRevenue - costedCost;
    const profit = {
      grossProfit,
      costedCost,
      margin: costedRevenue > 0 ? (grossProfit / costedRevenue) * 100 : 0,
      expensesTotal,
      netProfit: grossProfit - expensesTotal,
      estimated: true,
      missingCost,
      missingProducts,
      coverage: totalRevenueAll > 0 ? (costedRevenue / totalRevenueAll) * 100 : 0
    };

    // ===== الصندوق =====
    const drawerRows = drawers
      .filter(d => inRange(day(d.openedAt || d.createdAt), from, to))
      .sort((a, b) => String(b.openedAt || b.createdAt).localeCompare(String(a.openedAt || a.createdAt)));
    const openDrawer = drawers.filter(d => d.status === 'open').sort((a, b) => String(b.openedAt || b.createdAt).localeCompare(String(a.openedAt || a.createdAt)))[0] || null;
    const drawerSummary = drawerRows.length ? {
      count: drawerRows.length,
      openingCash: sum(drawerRows, d => d.startingCash),
      cashSales: sum(drawerRows, d => d.totalCashSales),
      cardSales: sum(drawerRows, d => d.totalCardSales),
      expenses: sum(drawerRows, d => d.totalExpenses),
      refunds: sum(drawerRows, d => d.totalRefunds)
    } : null;

    // ===== الطاولات =====
    const tableRows = tables.map(t => ({ id: t.id, number: t.number, status: t.status || 'available', capacity: t.capacity || '' }));
    const tableSummary = {};
    tableRows.forEach(t => { tableSummary[t.status] = (tableSummary[t.status] || 0) + 1; });

    // ===== الطلبات النشطة =====
    const liveOrders = orders.filter(isOpenOrder)
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
      .slice(0, 30);

    // ===== التنبيهات (أرقام حقيقية + توصية) =====
    const alerts = [];
    if (outOfStock.length) alerts.push({
      severity: 'danger',
      title: 'منتجات نفدت من المخزون',
      message: outOfStock.length + ' منتج نفد، أبرزهم: ' + outOfStock.slice(0, 3).map(i => i.name).join('، '),
      numbers: 'عدد النفاد: ' + outOfStock.length,
      recommendation: 'أعد الطلب من المورد أو راقب حركة المخزون اليوم.'
    });
    if (lowStock.length) alerts.push({
      severity: 'warning',
      title: 'مخزون منخفض',
      message: lowStock.length + ' منتج قارب على النفاد: ' + lowStock.slice(0, 3).map(i => i.name + ' (' + i.quantity + ')').join('، '),
      numbers: 'عدد الأصناف المنخفضة: ' + lowStock.length,
      recommendation: 'خطط لإعادة الطلب قبل نفادها.'
    });
    if (refundsTotal > 0 && gross > 0 && pct(refundsTotal, gross) > 5) {
      alerts.push({
        severity: 'warning',
        title: 'مرتجعات مرتفعة',
        message: 'المرتجعات تمثل ' + pct(refundsTotal, gross).toFixed(1) + '% من إجمالي المبيعات',
        numbers: 'مرتجعات: ' + formatMoneyLocal(refundsTotal) + ' / إجمالي: ' + formatMoneyLocal(gross),
        recommendation: 'راجع أسباب الإلغاء/الاسترداد في سجل المرتجعات.'
      });
    }
    const salesExpRatio = pct(expensesTotal, net);
    if (expensesTotal > 0 && net > 0 && salesExpRatio > 40) {
      alerts.push({
        severity: 'warning',
        title: 'المصروفات مرتفعة مقابل المبيعات',
        message: 'المصروفات تمثل ' + salesExpRatio.toFixed(1) + '% من صافي المبيعات',
        numbers: 'مصروفات: ' + formatMoneyLocal(expensesTotal) + ' / صافي مبيعات: ' + formatMoneyLocal(net),
        recommendation: 'راجع أكبر بنود المصروفات وحلل أسباب الارتفاع.'
      });
    }
    if (net < 0) {
      alerts.push({
        severity: 'danger',
        title: 'صافي المبيعات سالب',
        message: 'المرتجعات تجاوزت الإيرادات في الفترة المحددة',
        numbers: 'صافي: ' + formatMoneyLocal(net),
        recommendation: 'افحص سجل المرتجعات اليوم.'
      });
    }
    const openOrdersCount = orders.filter(isOpenOrder).length;
    if (openOrdersCount > 5) {
      alerts.push({
        severity: 'info',
        title: 'طلبات مفتوحة كثيرة',
        message: 'هناك ' + openOrdersCount + ' طلب مفتوح لم تُدفع بعد',
        numbers: 'الطلبات المفتوحة: ' + openOrdersCount,
        recommendation: 'راجع صفحة الطلبات لدفع الطلبات المعلقة.'
      });
    }

    // ===== رؤى Batman (تحليل حقيقي مبني على الأرقام) =====
    const insights = [];
    if (topProducts.length) {
      const top = topProducts[0];
      insights.push({ severity: 'success', message: 'أعلى إيراد: ' + top.name + ' — ' + formatMoneyLocal(top.revenue) + ' (' + top.quantity + ' قطعة)' });
    }
    if (salesByCategory.length) {
      const topCat = salesByCategory[0];
      insights.push({ severity: 'info', message: 'القسم الأقوى: ' + topCat.name + ' بحصة ' + pct(topCat.revenue, gross).toFixed(1) + '% من إجمالي المبيعات' });
    }
    if (costedRevenue > 0) {
      insights.push({ severity: costedCost > 0 && pct(costedCost, costedRevenue) > 35 ? 'warning' : 'success', message: 'نسبة تكلفة الطعام: ' + pct(costedCost, costedRevenue).toFixed(1) + '%' + (costedRevenue < totalRevenueAll ? ' (تغطية جزئية ' + (totalRevenueAll ? Math.round(costedRevenue / totalRevenueAll * 100) : 0) + '%)' : '') });
    }
    if (completed.length > 0 && prevCount > 0) {
      const d = change(net, prevNet);
      insights.push({ severity: d >= 0 ? 'success' : 'warning', message: 'صافي المبيعات ' + (d >= 0 ? 'ارتفع' : 'انخفض') + ' ' + Math.abs(d).toFixed(1) + '% مقارنة بالفترة السابقة' });
    }
    if (lowProducts.length) {
      const slowest = lowProducts[0];
      insights.push({ severity: 'info', message: 'أقل المنتجات مبيعاً: ' + slowest.name + ' (' + formatMoneyLocal(slowest.revenue) + ') — راجع هل تبقيه في القائمة؟' });
    }
    const expenseDays = {};
    rangeExpenses.forEach(e => { const d = day(e.date || e.createdAt); expenseDays[d] = (expenseDays[d] || 0) + num(e.amount); });
    if (Object.keys(expenseDays).length) {
      const topDay = Object.entries(expenseDays).sort((a, b) => b[1] - a[1])[0];
      insights.push({ severity: 'warning', message: 'أعلى يوم مصروفات: ' + topDay[0] + ' بمبلغ ' + formatMoneyLocal(topDay[1]) });
    }

    // ===== تقارير الموظفين =====
    const empStat = {};
    completed.forEach(o => {
      let who = o.createdBy || o.employeeName || (o.userId != null ? empById[o.userId] : '');
      if (o.userId != null && empById[o.userId]) who = empById[o.userId];
      const key = who || 'غير معروف';
      if (!empStat[key]) empStat[key] = { name: key, orders: 0, sales: 0 };
      empStat[key].orders += 1;
      empStat[key].sales += orderTotal(o);
    });
    const employeesReport = Object.keys(empStat).map(k => ({
      name: empStat[k].name,
      orders: empStat[k].orders,
      sales: empStat[k].sales,
      avgOrder: empStat[k].orders ? Math.round(empStat[k].sales / empStat[k].orders) : 0
    })).sort((a, b) => b.sales - a.sales);

    // ===== تقرير المنتجات =====
    const productsReport = products.map(p => {
      const cat = catNames[p.categoryId] || '—';
      let qtySold = 0, revenue = 0;
      Object.keys(prodStat).forEach(name => {
        const st = prodStat[name];
        if (p.nameAr === name || p.name === name) { qtySold = st.quantity; revenue = st.revenue; }
      });
      // لو لم يتطابق الاسم، حاول بالـ productId
      if (!qtySold) {
        let q = 0, r = 0;
        for (let k = 0; k < orderItemsRows.length; k++) {
          const oi = orderItemsRows[k];
          if ((oi.productId || oi.product_id) !== undefined && String(oi.productId || oi.product_id) === String(p.id)) {
            const ord = orderById[oi.orderId] || orderById[oi.orderSyncId];
            if (!ord || !isPaidOrder(ord)) continue;
            const dd = day(ord.date || ord.createdAt);
            if (!inRange(dd, from, to)) continue;
            q += num(oi.quantity) || 1;
            r += num(oi.total);
          }
        }
        qtySold = q; revenue = r;
      }
      return { name: p.nameAr || p.name, categoryName: cat, price: num(p.price), costPrice: num(p.cost), qtySold, revenue };
    }).sort((a, b) => b.revenue - a.revenue);

    const categoriesReport = salesByCategory.map(c => ({ name: c.name, productCount: products.filter(p => p.categoryId === c.categoryId).length, qtySold: c.qtySold, revenue: c.revenue }));

    const result = {
      from, to,
      kpis,
      prev: { net: prevNet, orders: prevCount, avgOrder: prevAvg },
      salesByDay,
      salesByCategory,
      categoriesReport,
      payments,
      topProducts,
      lowProducts,
      expenses: { total: expensesTotal, count: rangeExpenses.length, avg: rangeExpenses.length ? Math.round(expensesTotal / rangeExpenses.length) : 0, byCategory: Object.values(expensesByCat).sort((a, b) => b.total - a.total), byEmployee: Object.values(expensesByEmp).sort((a, b) => b.total - a.total) },
      discountsReport: { totalOrders: rangeOrders.length, discountedOrders: discountedOrders.length, totalDiscounts: discounts },
      refundsReport: { refundCount: rangeRefunds.length, refundTotal: refundsTotal, voidCount: voided.length, voidTotal },
      inventory: { totalItems: invItems.length, lowStock: lowStock.length, outOfStock: outOfStock.length, inventoryValue, items: invItems },
      profit,
      drawer: drawerSummary,
      openDrawer,
      tables: { tables: tableRows, summary: Object.keys(tableSummary).map(s => ({ status: s, count: tableSummary[s] })) },
      liveOrders,
      alerts,
      insights,
      employeesReport,
      productsReport
    };
    return result;
  }

  function formatMoneyLocal(n) {
    return (Number(n) || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  }

  /**
   * أرقام اليوم للأداة السريعة في POS الرئيسي (تشترك في نفس المنطق).
   */
  async function todaySnapshot(db) {
    const t = day(new Date().toISOString());
    return compute(db, { from: t, to: t });
  }

  global.AdminAnalytics = { compute, todaySnapshot };
})(typeof window !== 'undefined' ? window : globalThis);