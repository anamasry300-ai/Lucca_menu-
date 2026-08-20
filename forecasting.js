/* =====================================================
   FORECASTING ENGINE
   Simple demand prediction based on historical data
   Uses moving average + trend analysis
   ===================================================== */
(function(){
    'use strict';

    const Forecasting = {
        // Calculate moving average for daily sales
        async getDailySalesForecast(days = 7) {
            const orders = await window.LuccaDB.Orders.getAll();
            const dailySales = {};
            orders.forEach(o => {
                const date = (o.createdAt || o.date || '').slice(0, 10);
                if (!date) return;
                dailySales[date] = (dailySales[date] || 0) + Number(o.total || o.totalAmount || 0);
            });
            const dates = Object.keys(dailySales).sort();
            if (dates.length < 3) return { forecast: 0, confidence: 'low', data: [] };

            // Calculate moving average (last 7 days)
            const last7 = dates.slice(-7);
            const avg = last7.reduce((s, d) => s + dailySales[d], 0) / last7.length;

            // Calculate trend (slope of last 14 days)
            const last14 = dates.slice(-14);
            if (last14.length >= 5) {
                const n = last14.length;
                const xMean = (n - 1) / 2;
                const yMean = last14.reduce((s, d) => s + dailySales[d], 0) / n;
                let num = 0, den = 0;
                last14.forEach((d, i) => {
                    num += (i - xMean) * (dailySales[d] - yMean);
                    den += (i - xMean) * (i - xMean);
                });
                const slope = den !== 0 ? num / den : 0;
                const forecast = Math.max(0, avg + slope);
                return {
                    forecast: Math.round(forecast),
                    avg: Math.round(avg),
                    trend: slope > 100 ? 'increasing' : slope < -100 ? 'decreasing' : 'stable',
                    slope: Math.round(slope),
                    confidence: dates.length >= 14 ? 'high' : dates.length >= 7 ? 'medium' : 'low',
                    data: last7.map(d => ({ date: d, sales: dailySales[d] }))
                };
            }
            return { forecast: Math.round(avg), avg: Math.round(avg), trend: 'stable', slope: 0, confidence: 'medium', data: last7.map(d => ({ date: d, sales: dailySales[d] })) };
        },

        // Product demand forecast
        async getProductDemandForecast(topN = 10) {
            const orderItems = await window.LuccaDB.db.getAll('order_items');
            const products = await window.LuccaDB.Products.getActive();
            const dailyDemand = {};

            orderItems.forEach(oi => {
                const pid = oi.productId || oi.product_id;
                const date = (oi.createdAt || oi.date || '').slice(0, 10);
                if (!pid || !date) return;
                const key = pid + '_' + date;
                dailyDemand[key] = (dailyDemand[key] || 0) + (oi.quantity || 1);
            });

            const prodMap = {};
            products.forEach(p => { prodMap[p.id] = p; });

            const forecasts = products.map(p => {
                const dailyData = {};
                Object.keys(dailyDemand).forEach(key => {
                    if (key.startsWith(p.id + '_')) {
                        const date = key.split('_')[1];
                        dailyData[date] = dailyDemand[key];
                    }
                });
                const days = Object.keys(dailyData);
                if (days.length === 0) return null;
                const avg = days.reduce((s, d) => s + dailyData[d], 0) / days.length;
                return {
                    product: p.nameAr || p.name,
                    productId: p.id,
                    avgDailyDemand: Math.round(avg * 10) / 10,
                    daysWithSales: days.length,
                    totalSold: days.reduce((s, d) => s + dailyData[d], 0),
                    forecast7days: Math.round(avg * 7),
                    forecast30days: Math.round(avg * 30),
                    cost7days: Math.round(avg * 7 * (p.cost || 0))
                };
            }).filter(Boolean).sort((a, b) => b.forecast7days - a.forecast7days).slice(0, topN);

            return forecasts;
        },

        // Inventory reorder recommendations
        async getReorderRecommendations() {
            const inventory = await window.LuccaDB.Inventory.getAll();
            const recommendations = [];
            for (const item of inventory) {
                if ((item.quantity || 0) <= (item.minStock || item.minQuantity || 0)) {
                    const reorderQty = (item.maxQuantity || item.max_quantity || (item.minStock || 5) * 3) - (item.quantity || 0);
                    recommendations.push({
                        name: item.name,
                        currentStock: item.quantity || 0,
                        minStock: item.minStock || item.minQuantity || 0,
                        reorderQty: Math.max(0, reorderQty),
                        unit: item.unit || '',
                        cost: (item.cost || item.costPerUnit || 0) * Math.max(0, reorderQty),
                        urgency: (item.quantity || 0) === 0 ? 'critical' : (item.quantity || 0) < (item.minStock || 5) / 2 ? 'high' : 'medium'
                    });
                }
            }
            return recommendations.sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2 };
                return (order[a.urgency] || 3) - (order[b.urgency] || 3);
            });
        },

        // Day-of-week analysis
        async getDayOfWeekAnalysis() {
            const orders = await window.LuccaDB.Orders.getAll();
            const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const stats = {};
            days.forEach((d, i) => { stats[i] = { name: d, totalSales: 0, count: 0, avg: 0 }; });
            orders.forEach(o => {
                const d = new Date(o.createdAt || o.date);
                const dow = d.getDay();
                stats[dow].totalSales += Number(o.total || o.totalAmount || 0);
                stats[dow].count++;
            });
            Object.values(stats).forEach(s => {
                s.avg = s.count > 0 ? Math.round(s.totalSales / s.count) : 0;
            });
            return Object.values(stats);
        },

        // Get all forecasts as a summary
        async getSummary() {
            const salesForecast = await this.getDailySalesForecast();
            const productForecast = await this.getProductDemandForecast(5);
            const reorderRecs = await this.getReorderRecommendations();
            const dayAnalysis = await this.getDayOfWeekAnalysis();
            const bestDay = dayAnalysis.reduce((best, d) => d.avg > best.avg ? d : best, dayAnalysis[0]);
            const worstDay = dayAnalysis.reduce((worst, d) => d.avg < worst.avg && d.count > 0 ? d : worst, dayAnalysis[0]);

            return {
                salesForecast,
                topProducts: productForecast,
                reorderRecommendations: reorderRecs,
                dayAnalysis,
                bestDay: bestDay.name,
                worstDay: worstDay.name,
                totalReorderCost: reorderRecs.reduce((s, r) => s + r.cost, 0)
            };
        }
    };

    window.Forecasting = Forecasting;
})();
