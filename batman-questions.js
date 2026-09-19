/*
╔══════════════════════════════════════════════════════════════╗
║   LUCCA «اسأل باتمان» — طبقة قراءة فقط فوق batman_decisions     ║
║   Query Layer جاهزة (5 دوال محددة مسبقاً — لا SQL حر مطلق)     ║
║   عرض فقط: دور مدير/أدمن (نفس _canonicalRole في ai-pos)          ║
║   صارم للقراءة فقط: لا تنفيذ/موافقة/رفض/تعديل — هيكلياً ممنوع   ║
╚══════════════════════════════════════════════════════════════╝
*/
(function (root) {
    'use strict';

    // ═══════════════════════════════════════════════════════
    // CORE PURE FUNCTIONS —🛶 مُختبَر يدوياً وبوحدات
    // ═══════════════════════════════════════════════════════

    // --- أدوات زمنية (createdAt يُخزَّن بصيغة UTC 'YYYY-MM-DD HH:MM:SS') ---
    function parseDT(s) {
        if (s == null || s === '') return null;
        var t = String(s).replace(' ', 'T');
        if (!/[zZ]|[+-]\d\d:\d\d$/.test(t)) t += 'Z';
        var d = new Date(t);
        return isNaN(d.getTime()) ? null : d;
    }

    function iso(d) { return d instanceof Date && !isNaN(d) ? d.toISOString() : ''; }

    function dayStart(d) {
        var x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    }

    function dayKey(d) {
        return dayStart(d).getFullYear() + '-' +
            String(dayStart(d).getMonth() + 1).padStart(2, '0') + '-' +
            String(dayStart(d).getDate()).padStart(2, '0');
    }

    function addDays(d, n) {
        var x = new Date(d);
        x.setDate(x.getDate() + n);
        return x;
    }

    function normPeriod(period) {
        var p = String(period || 'all').toLowerCase().trim();
        if (['today', 'yesterday', 'week', 'prevWeek', 'month'].indexOf(p) >= 0) return p;
        return 'all';
    }

    function periodRange(period, now) {
        now = now instanceof Date ? now : new Date();
        var today = dayStart(now);
        var p = normPeriod(period);
        if (p === 'today') return { from: today, to: addDays(today, 1) };
        if (p === 'yesterday') return { from: addDays(today, -1), to: today };
        if (p === 'week') return { from: addDays(today, -6), to: addDays(today, 1) };
        if (p === 'prevWeek') return { from: addDays(today, -13), to: addDays(today, -6) };
        if (p === 'month') return { from: addDays(today, -29), to: addDays(today, 1) };
        return null; // all
    }

    function inRange(t, range) {
        if (!(t instanceof Date)) return false;
        if (!range) return true;
        return t >= range.from && t < range.to;
    }

    // تحويل صف خام من السيرفر إلى كائن موحّد (آمن — لا يرمي أبداً)
    function normalizeRow(r) {
        return {
            eventId: r.eventId != null ? String(r.eventId) : '',
            action: String(r.action || ''),
            requestText: r.requestText || '',
            requestJson: (function () {
                if (!r.requestJson) return null;
                if (typeof r.requestJson === 'string') try { return JSON.parse(r.requestJson); } catch (_) { return r.requestJson; }
                return r.requestJson;
            })(),
            decision: String(r.decision || ''),
            reason: r.reason || '',
            actorRole: r.actorRole || '',
            actorName: r.actorName || '',
            amount: Number(r.amount) || 0,
            createdAt: (r.createdAt instanceof Date && !isNaN(r.createdAt.getTime())) ? new Date(r.createdAt) : parseDT(r.createdAt)
        };
    }

    function normalizeRows(raw) {
        if (!Array.isArray(raw)) return [];
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var nr = normalizeRow(raw[i]);
            if (nr.createdAt) out.push(nr);
        }
        return out;
    }

    var FLAGGED = ['needs_approval', 'blocked'];

    function fullRow(r) {
        return {
            eventId: r.eventId,
            action: r.action,
            requestText: r.requestText || null,
            decision: r.decision,
            reason: r.reason || null,
            amount: r.amount,
            actorRole: r.actorRole || null,
            actorName: r.actorName || null,
            at: iso(r.createdAt)
        };
    }

    // ═══════════════════════════════════════════════════════
    // 5 READ-ONLY QUERY FUNCTIONS
    // ═══════════════════════════════════════════════════════

    function getFlaggedToday(rows, opts) {
        opts = opts || {};
        rows = normalizeRows(rows);
        var now = opts.now instanceof Date ? opts.now : new Date();
        var range = periodRange('today', now);
        var flagged = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (FLAGGED.indexOf(r.decision) >= 0 && inRange(r.createdAt, range)) flagged.push(r);
        }
        return {
            name: 'getFlaggedToday',
            date: dayKey(now),
            total: flagged.length,
            flagged: flagged.map(fullRow)
        };
    }

    function getTopRequestersByAction(rows, opts) {
        opts = opts || {};
        rows = normalizeRows(rows);
        var period = normPeriod(opts.period || 'week');
        var range = periodRange(period, opts.now instanceof Date ? opts.now : new Date());
        var flagged = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (FLAGGED.indexOf(r.decision) >= 0 && inRange(r.createdAt, range)) flagged.push(r);
        }
        // تجميع حسب الاسم ثم الإجراء
        var byActor = {};
        for (var j = 0; j < flagged.length; j++) {
            var rr = flagged[j];
            var actor = (rr.actorName && rr.actorName.trim()) || (rr.actorRole && rr.actorRole.trim()) || 'غير معروف';
            var key = actor + '|' + rr.action;
            if (!byActor[key]) byActor[key] = { actor: actor, role: rr.actorRole || '', action: rr.action, count: 0 };
            byActor[key].count++;
        }
        var list = [];
        for (var k in byActor) { if (byActor.hasOwnProperty(k)) list.push(byActor[k]); }
        list.sort(function (a, b) { return b.count - a.count; });
        // إجمالي حسب الدور فقط (للملخص السريع)
        var byRole = {};
        for (var ii = 0; ii < flagged.length; ii++) {
            var rr2 = flagged[ii];
            var roleKey = (rr2.actorName && rr2.actorName.trim()) || (rr2.actorRole && rr2.actorRole.trim()) || 'غير معروف';
            byRole[roleKey] = (byRole[roleKey] || 0) + 1;
        }
        var topRoles = [];
        for (var rk in byRole) { if (byRole.hasOwnProperty(rk)) topRoles.push({ actor: rk, count: byRole[rk] }); }
        topRoles.sort(function (a, b) { return b.count - a.count; });
        return {
            name: 'getTopRequestersByAction',
            period: period,
            total: flagged.length,
            top: topRoles.slice(0, 10),
            breakdown: list.slice(0, 30)
        };
    }

    function getBlockedAttempts(rows, opts) {
        opts = opts || {};
        rows = normalizeRows(rows);
        var period = normPeriod(opts.period || 'all');
        var actionType = opts.actionType || null;
        var range = periodRange(period, opts.now instanceof Date ? opts.now : new Date());
        var matched = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r.decision !== 'blocked') continue;
            if (!inRange(r.createdAt, range)) continue;
            if (actionType && r.action !== actionType) continue;
            matched.push(r);
        }
        return {
            name: 'getBlockedAttempts',
            period: period,
            actionType: actionType || null,
            count: matched.length,
            attempts: matched.map(fullRow)
        };
    }

    function getApprovalTrend(rows, opts) {
        opts = opts || {};
        rows = normalizeRows(rows);
        var days = Math.min(Math.max(Number(opts.days) || 7, 1), 90);
        var now = opts.now instanceof Date ? opts.now : new Date();
        var trend = [];
        for (var i = days - 1; i >= 0; i--) {
            var day = dayStart(addDays(now, -i));
            var from = day;
            var to = addDays(day, 1);
            var needs_approval = 0, blocked = 0, executed = 0, under_threshold = 0;
            for (var j = 0; j < rows.length; j++) {
                var dt = rows[j].createdAt;
                if (!(dt >= from && dt < to)) continue;
                var dec = rows[j].decision;
                if (dec === 'needs_approval') needs_approval++;
                else if (dec === 'blocked') blocked++;
                else if (dec === 'executed') executed++;
                else if (dec === 'under_threshold') under_threshold++;
            }
            trend.push({ date: dayKey(day), needs_approval: needs_approval, blocked: blocked, executed: executed, under_threshold: under_threshold });
        }
        return { name: 'getApprovalTrend', days: days, trend: trend };
    }

    function getActionsByType(rows, opts) {
        opts = opts || {};
        rows = normalizeRows(rows);
        var actionType = String(opts.actionType || '');
        var period = normPeriod(opts.period || 'all');
        var range = periodRange(period, opts.now instanceof Date ? opts.now : new Date());
        if (!actionType) return { name: 'getActionsByType', actionType: '', period: period, count: 0, decisionCounts: {}, decisions: [] };
        var matched = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r.action !== actionType) continue;
            if (!inRange(r.createdAt, range)) continue;
            matched.push(r);
        }
        var decisionCounts = {};
        for (var j = 0; j < matched.length; j++) {
            var d = matched[j].decision;
            decisionCounts[d] = (decisionCounts[d] || 0) + 1;
        }
        return {
            name: 'getActionsByType',
            actionType: actionType,
            period: period,
            count: matched.length,
            decisionCounts: decisionCounts,
            decisions: matched.map(fullRow).slice(0, 200)
        };
    }

    var TOOLS = {
        getFlaggedToday: { fn: getFlaggedToday },
        getTopRequestersByAction: { fn: getTopRequestersByAction },
        getBlockedAttempts: { fn: getBlockedAttempts },
        getApprovalTrend: { fn: getApprovalTrend },
        getActionsByType: { fn: getActionsByType }
    };

    var TOOL_SCHEMAS = [
        { name: 'getFlaggedToday', description: 'كل قرارات نظام الصلاحيات اليومية التي تحتاج موافقة (needs_approval) أو تُرِفض (blocked) — تشمل نوع الإجراء والسبب والمشغّل.', parameters: { type: 'object', properties: {} } },
        { name: 'getTopRequestersByAction', description: 'مَن أكثر طلباً لإجراءات محتاجة موافقة/رفض في فترة معينة (week/month/today/yesterday/prevWeek/all). يُرجع الترتيب حسب عدد المحاولات.', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'yesterday', 'week', 'prevWeek', 'month', 'all'] } } } },
        { name: 'getBlockedAttempts', description: 'كل المحاولات المرفوضة (blocked) في فترة معينة — يشمل نوع الإجراء والسبب والحدّ المخالف والمشغّل. يمكنك تحديد نوع الإجراء (actionType) لفلترة.', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'yesterday', 'week', 'prevWeek', 'month', 'all'] }, actionType: { type: 'string' } } } },
        { name: 'getApprovalTrend', description: 'اتجاه عدد قرارات الصلاحيات (موافقة/رفض/تنفيذ) عبر آخر X يوم — لمراقبة الحمل على المدير.', parameters: { type: 'object', properties: { days: { type: 'integer', default: 7, minimum: 1, maximum: 90 } } } },
        { name: 'getActionsByType', description: 'كل قرارات نوع إجراء معيّن (add_expense, add_purchase, record_invoice, update_price, delete_employee, …) في فترة معينة مع توزيع القرارات.', parameters: { type: 'object', properties: { actionType: { type: 'string' }, period: { type: 'string', enum: ['today', 'yesterday', 'week', 'prevWeek', 'month', 'all'] } } } }
    ];

    // ═══════════════════════════════════════════════════════
    // SECURITY: Role Gate + Write-intent Guard
    // ═══════════════════════════════════════════════════════

    function canonicalRole() {
        try {
            if (typeof window !== 'undefined' && window.aiPosEngine && typeof window.aiPosEngine._canonicalRole === 'function')
                return window.aiPosEngine._canonicalRole();
        } catch (_) { /* fail-closed */ }
        return 'cashier';
    }

    function isManagerIdentity() {
        var r = canonicalRole();
        return r === 'manager' || r === 'admin';
    }

    var WRITE_PREFIX = /^(?:افعل|نفّذ|نفذ|وافق|وافقي|اعتمد|اقبل|سجّل|سجّلت|سجل|أضف|اضف|احذف|امسح|حذف|عدّل|عدل|أرسل)(?=\s|$)/i;
    var WRITE_KEYWORDS = /(?:تمكين|approve|authorize|execute|permission\s+grant|تأكيد\s+القرار|تسجيل\s+(?:مصروف|فاتورة|مشتريات|قرار|حساب))/i;

    function detectWriteIntent(text) {
        var s = String(text || '').trim();
        if (!s) return false;
        if (WRITE_PREFIX.test(s)) return true;
        // طلب تنفيذ/موافقة صريح بالإنجليزية مع مفعول به
        if (/\b(?:Approve|Authorize|Execute|Confirm)\s+(?:it\s+|this\s+|the\s+)?(?:decision|expense|request|payment|invoice|permission)\b/i.test(s)) return true;
        if (WRITE_KEYWORDS.test(s)) return true;
        return false;
    }

    function denialMessage() {
        return '🔒 هذه الميزة قراءة فقط (Read-only). لا أستطيع تنفيذ أو البدء بإجراء ما.\nللإجراءات الفعلية (تسجيل/تعديل/حذف/approve) استخدم لوحة التحكم الرئيسية.';
    }

    // ═══════════════════════════════════════════════════════
    // FETCH from Server (HTTP مُعامَل فقط — لا SQL حر)
    // ═══════════════════════════════════════════════════════

    function serverBase() {
        try {
            if (typeof localStorage !== 'undefined' && localStorage.getItem('luccaServerUrl'))
                return String(localStorage.getItem('luccaServerUrl')).replace(/\/+$/, '');
        } catch (_) {}
        return 'http://localhost:3000';
    }

    function authHeaders() {
        var h = {};
        if (typeof window !== 'undefined' && window.ServerAPI && typeof window.ServerAPI.authHeaders === 'function')
            return window.ServerAPI.authHeaders('application/json') || {};
        h['Content-Type'] = 'application/json';
        try {
            var tok = sessionStorage.getItem('luccaToken');
            if (tok) { h['Authorization'] = 'Bearer ' + tok; return h; }
        } catch (_) {}
        try {
            var key = localStorage.getItem('luccaApiKey');
            if (key) h['x-api-key'] = key;
        } catch (_) {}
        return h;
    }

    async function fetchDecisions(limit) {
        var url = serverBase() + '/api/batman/decisions?limit=' + Math.min(Math.max(Number(limit) || 500, 1), 500);
        var ctrl = new AbortController();
        var timer = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 10000);
        try {
            var res = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
            clearTimeout(timer);
            if (res.status === 403) { var err = new Error('غير مصرح — يتطلب صلاحيات مدير/إدارة في الخادم.'); err.denied = true; throw err; }
            if (!res.ok) throw new Error('تعذر جلب سجل القرارات (HTTP ' + res.status + ')');
            var j = await res.json().catch(function () { return null; });
            return (j && Array.isArray(j.decisions)) ? j.decisions : [];
        } catch (e) {
            clearTimeout(timer);
            if (e && e.denied) throw e;
            var err2 = new Error('غير متصل بالسيرفر أو السيرفر غير متاح.');
            err2.offline = true;
            throw err2;
        }
    }

    // ═══════════════════════════════════════════════════════
    // LLM-Assisted Tool Selection & Summarization
    // ═══════════════════════════════════════════════════════

    function selectionSystem() {
        return 'أنت موجه أوامر (Function Router) في نظام Lucca POS. لديك أدوات قراءة فقط (سجل قرارات الصلاحيات batman_decisions وأرقام اللوحة الحقيقية) — لا توجد أدوات كتابة مطلقاً.\n' +
            'ردّ فوراً بصيغة JSON فقط (بدون أي نص خارجي أو markdown):\n' +
            '1) لاختيار أداة واحدة: {"calls":[{"tool":"<name>","params":{...}}]}\n' +
            '2) لأكثر من دالة/مقارنة: {"calls":[{"tool":"<name>","params":{...}},{"tool":"<name>","params":{...}}]}\n' +
            '3) إن لم يطابق السؤال بوضوح وبشكل مباشر أي أداة: {"answer":"<سبب بجملة مختصرة>"}\n' +
            'قاعدة صارمة: لا تختر أداة "الأقرب تقريباً" إذا لم تخدم السؤال مباشرة — أجب بالسبب بدلها.\n' +
            'لا تخترع أرقاماً أبداً ولا ترد SQL ولا تستخدم أداة غير موجودة.\n\n' +
            'أدوات قرارات الصلاحيات: getFlaggedToday, getTopRequestersByAction, getBlockedAttempts, getApprovalTrend, getActionsByType.\n' +
            'أدوات الأرقام الحقيقية (من لوحة الإدارة): getSalesToday, getExpensesToday, getLowStock, getTopProducts, getSystemHealth.';
    }

    function summarizeSystem() {
        return 'أنت "باتمان" — مساعد المدير في نظام Lucca POS.\n' +
            'لُخِّمت لك نتائج حقيقية مهيكلة (سجل قرارات الصلاحيات أو أرقام لوحة الإدارة — JSON) لخّمها بلغة عربية طبيعية إدارية.\n' +
            'قواعد صارمة: استخدم الأرقام الواردة في النتائج حرفياً — لا تجمع ولا تطرح ولا تقدّر ولا تخترع أي رقم، ولا تذكر عملة غير موجودة في النص.\n' +
            'المجاميع والصافي محسوبة مسبقاً في النظام، أنت تنقلها فقط. ركّز على الأهم واذكر الأسباب إن وُجدت.\n' +
            'لا تستخدم تنسيقات طويلة، ردّك فقرات منظمة.';
    }

    // ═══════════════════════════════════════════════════════
    // PLAIN-TEXT FALLBACK SUMMARY (بدون LLM)
    // ═══════════════════════════════════════════════════════

    function plainSummary(results) {
        var out = [];
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            if (r.error) { out.push('⚠️ ' + r.tool + ': ' + r.error); continue; }
            var d = r.data;
            if (!d) continue;
            if (r.tool === 'getFlaggedToday') {
                out.push('📌 **قرارات تحتاج نظرًا اليوم (' + d.date + '):** ' + d.total);
                for (var f = 0; f < d.flagged.length; f++) {
                    var x = d.flagged[f];
                    out.push('• ' + x.action + ' — ' + (x.decision === 'blocked' ? 'مرفوض' : 'يحتاج موافقة') + (x.reason ? ' (' + x.reason + ')' : '') + (x.actorName ? ' — بواسطة ' + x.actorName : ''));
                }
            } else if (r.tool === 'getTopRequestersByAction') {
                out.push('👥 **الأكثر طلباً لصلاحيات محتاجة موافقة (' + d.period + '):** ' + d.total);
                for (var t = 0; t < d.top.length; t++) out.push((t + 1) + '. ' + d.top[t].actor + ' — ' + d.top[t].count);
            } else if (r.tool === 'getBlockedAttempts') {
                out.push('🔒 **محاولات محظورة (' + d.period + (d.actionType ? ' — ' + d.actionType : '') + '):** ' + d.count);
                for (var a = 0; a < d.attempts.length; a++) {
                    var at = d.attempts[a];
                    out.push('• ' + at.action + ' — السبب: ' + (at.reason || '—'));
                }
            } else if (r.tool === 'getApprovalTrend') {
                out.push('📈 **اتجاه القرارات — آخر ' + d.days + ' أيام:**');
                for (var tr = 0; tr < d.trend.length; tr++) {
                    var day = d.trend[tr];
                    out.push('• ' + day.date + ': ' + day.needs_approval + ' بانتظار، ' + day.blocked + ' محظور، ' + day.executed + ' منفذ');
                }
            } else if (r.tool === 'getActionsByType') {
                out.push('🧾 **' + d.actionType + ' (' + d.period + '):** ' + d.count + ' قرار');
                var keys = Object.keys(d.decisionCounts);
                for (var k = 0; k < keys.length; k++) out.push('• ' + keys[k] + ': ' + d.decisionCounts[keys[k]]);
            } else if (r.tool === 'getSalesToday') {
                out.push('💵 **مبيعات اليوم (' + d.date + '):** صافي ' + d.income_net + ' — عدد الطلبات ' + d.orders_count + ' (متوسط الفاتورة ' + d.avg_order + ')');
                if (d.refunds_total) out.push('↩️ مرتجعات مطروحة: ' + d.refunds_total);
                if (d.discounts_total) out.push('🏷️ خصومات: ' + d.discounts_total);
                for (var tp = 0; tp < d.top_products.length; tp++) out.push('★ ' + d.top_products[tp].name + ' — ' + d.top_products[tp].revenue + ' (' + d.top_products[tp].qty + ' قطعة)');
            } else if (r.tool === 'getExpensesToday') {
                out.push('💸 **مصروفات اليوم (' + d.date + '):** ' + d.expenses_total + ' — عدد ' + d.expenses_count);
                for (var ec = 0; ec < d.by_category.length; ec++) out.push('• ' + d.by_category[ec].name + ': ' + d.by_category[ec].total + ' (' + d.by_category[ec].count + ')');
            } else if (r.tool === 'getLowStock') {
                out.push('📦 **المخزون:** ' + d.low_count + ' منخفض / ' + d.out_count + ' نافد — قيمة المخزون ' + d.inventory_value);
                for (var lw = 0; lw < d.low_items.length; lw++) out.push('🔻 ' + d.low_items[lw].name + ': ' + d.low_items[lw].quantity + ' (الحد الأدنى ' + d.low_items[lw].min + ')');
                for (var oo = 0; oo < d.out_items.length; oo++) out.push('⛔ ' + d.out_items[oo].name + ': نافد');
            } else if (r.tool === 'getTopProducts') {
                out.push('🏆 **أفضل المنتجات (' + d.period + '):**');
                for (var tp2 = 0; tp2 < d.top_products.length; tp2++) out.push((tp2 + 1) + '. ' + d.top_products[tp2].name + ' — ' + d.top_products[tp2].revenue + ' (' + d.top_products[tp2].qty + ' قطعة)');
            } else if (r.tool === 'getSystemHealth') {
                out.push('🩺 **حالة النظام:**');
                for (var hc = 0; hc < d.checks.length; hc++) out.push((d.checks[hc].ok ? '✅' : '❌') + ' ' + d.checks[hc].label + ': ' + (d.checks[hc].detail || ''));
            }
        }
        return out.join('\n') || '— لا توجد نتائج.';
    }

    // ═══════════════════════════════════════════════════════
    // FALLBACK LOCAL ANSWER (بدون LLM — مطابقات بسيطة)
    // ═══════════════════════════════════════════════════════

    async function fallbackAnswer(text, rows, now) {
        var t = String(text || '').toLowerCase();
        async function run(name, p) {
            try { return await TOOLS[name].fn(rows, p || {}); }
            catch (_) { return null; }
        }

        if (/(مبيعات|ايراد|إيراد|ايرادات|إيرادات|بيع|sales|revenue)/.test(t) && /(اليوم|النهارده|النهاردة|today)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getSalesToday', data: await run('getSalesToday', {}) }]) };

        if (/(مصروف|expense|صرف)/.test(t) && /(اليوم|النهارده|النهاردة|today)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getExpensesToday', data: await run('getExpensesToday', {}) }]) };

        if (/(مخزون|ناقص|نفد|low stock|stock)/.test(t) && /(منخفض|نفد|ناقص|الان|دلوقتي)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getLowStock', data: await run('getLowStock', {}) }]) };

        if (/(اعلي|أعلى|اكتر|أكثر|top|most)/.test(t) && /(منتج|مبيع|بيع|product)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getTopProducts', data: await run('getTopProducts', { period: 'today' }) }]) };

        if (/(حالة النظام|هل النظام|system health|health)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getSystemHealth', data: await run('getSystemHealth', {}) }]) };

        if (/(أكتر|الأكثر|مين|من هو|top|most|أكثر)\s.*?(approval|موافق|موافقه|صلاحيات|perm)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getTopRequestersByAction', data: await run('getTopRequestersByAction', { period: 'week' }) }]) };

        if (/(update.price|تعديل\s+السعر|تغيير\s+السعر|اسعار)/.test(t) && /(محظر|مرفوض|blocked|اتحظرت)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getBlockedAttempts', data: run('getBlockedAttempts', { period: 'all', actionType: 'update_price' }) }]) };

        if (/(قارن|مقارنة|compare)/.test(t) && /(مصروف|expense)/.test(t))
            return { ok: true, answer: plainSummary([
                { tool: 'getActionsByType', data: run('getActionsByType', { actionType: 'add_expense', period: 'week' }) },
                { tool: 'getActionsByType', data: run('getActionsByType', { actionType: 'add_expense', period: 'prevWeek' }) }
            ]) };

        if (/(اتجاه|trend|ترند| approves|refuses)/.test(t) && /(count|عدد|قرارات|approval)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getApprovalTrend', data: run('getApprovalTrend', { days: 7 }) }]) };

        if (/(اليوم|النهارده|النهاردة|today)/.test(t) && /(مصروف|expense|موافق|رفض|flag)/.test(t))
            return { ok: true, answer: plainSummary([{ tool: 'getFlaggedToday', data: run('getFlaggedToday', {}) }]) };

        return { ok: true, answer: 'ما أقدرش أجيب على النوع ده من الأسئلة دلوقتي — اسأل عن قرارات الصلاحيات (موافقات/رفض/مصروفات/تعديل أسعار).' };
    }

    // ═══════════════════════════════════════════════════════
    // MAIN API
    // ═══════════════════════════════════════════════════════

    function normalizeToolParams(toolName, p) {
        var params = (p && typeof p === 'object') ? p : {};
        if (toolName === 'getTopRequestersByAction' || toolName === 'getBlockedAttempts' || toolName === 'getActionsByType')
            params.period = normPeriod(params.period || (toolName === 'getBlockedAttempts' ? 'all' : 'week'));
        if (toolName === 'getApprovalTrend') params.days = Math.min(Math.max(Number(params.days) || 7, 1), 90);
        return params;
    }

    async function ask(question, opts) {
        opts = opts || {};
        // 1. Gate — هوية المدير فقط
        if (!isManagerIdentity()) return { ok: false, denied: true, message: '🔒 وصول مرفوض — هذه الميزة متاحة للهويات ذات دور إدارة (مدير/نظام) فقط.' };

        var text = String(question || '').trim();
        if (!text) return { ok: false, message: '✍️ اكتب سؤالك أولاً.' };

        // 2. Write-intent guard — منع أي طلب كتابة/تنفيذ حتى لو طلبه المستخدم صراحةً
        if (detectWriteIntent(text)) return { ok: false, readonly: true, message: denialMessage() };

        // 3. جلب البيانات من السيرفر (قراءة فقط — لا تعديل مطلقاً)
        var rows;
        try {
            rows = normalizeRows(await fetchDecisions(opts.limit || 500));
        } catch (e) {
            if (e && e.denied) return { ok: false, denied: true, message: '🔒 ' + (e.message || 'غير مصرح.') };
            if (e && e.offline) return { ok: false, offline: true, message: '⚠️ غير متصل بالسيرفر — لا يمكن جلب سجل القرارات الآن.' };
            return { ok: false, message: '⚠️ ' + (e && e.message || 'خطأ غير معروف.') };
        }

        // 4. اختيار أداة عبر LLM أو رد محلي
        var O = (typeof window !== 'undefined' && window.OllamaAI) ? window.OllamaAI : null;
        if (!O || typeof O.selectTool !== 'function') {
            return Object.assign({ source: 'batman_decisions' }, await fallbackAnswer(text, rows, new Date()));
        }
        try {
            var sel = await O.selectTool(TOOL_SCHEMAS, text, { temperature: 0.1, timeout: 90000, numCtx: 4096 });
            if (!sel || !sel.ok) return { ok: false, offline: true, message: '⚠️ تعذّر الاتصال بمحرك الذكاء الاصطناعي — تحقق من Ollama.' };
            if (sel.answer) return { ok: true, answer: sel.answer, source: 'batman_decisions' };
            var calls = (sel.calls || []).filter(Boolean);
            if (!calls.length) return { ok: true, answer: 'ما أقدرش أجيب على النوع ده من الأسئلة دلوقتي — اسأل عن قرارات الصلاحيات (موافقات/رفض/مصروفات/تعديل أسعار).', source: 'batman_decisions' };

            // تنفيذ الدوال المحملة (قراءة فقط — لا أي تعديل في البيانات)
            var results = [];
            for (var i = 0; i < calls.length; i++) {
                var c = calls[i];
                var toolName = String(c.tool || '');
                if (!TOOLS[toolName]) { results.push({ tool: toolName, error: 'أداة غير معروفة: ' + toolName }); continue; }
                var params = normalizeToolParams(toolName, c.params);
                try { results.push({ tool: toolName, params: params, data: await TOOLS[toolName].fn(rows, params) }); }
                catch (e) { results.push({ tool: toolName, params: params, error: String(e && e.message || e) }); }
            }

            // تلخيص النتائج بالعربية عبر LLM
            if (typeof O.summarizeToolResults === 'function') {
                var sum = await O.summarizeToolResults(summarizeSystem(), text, results, { temperature: 0.3, timeout: 90000, numCtx: 4096 });
                if (sum && sum.ok && sum.text) return { ok: true, answer: sum.text, data: results, source: 'batman_decisions' };
            }
            // تلخيص نصي بديل بدون LLM
            return { ok: true, answer: plainSummary(results), data: results, source: 'batman_decisions' };
        } catch (e) {
            return { ok: false, message: '⚠️ خطأ غير متوقع: ' + String(e && e.message || e) };
        }
    }

    // ═══════════════════════════════════════════════════════
    // ADMIN UI ( Firestore widget — قراءة فقط)
    // ═══════════════════════════════════════════════════════

    function denialHtml() {
        return '<div style="padding:24px;text-align:center;color:#e74c3c;background:#fdf0ef;border-radius:12px;border:1px solid #f5c6cb;">' +
            '🔒 هذه الميزة مخصصة فقط لدور <b>مدير/نظام</b> — لا تملك صلاحية الوصول.<br><br>' +
            'للإجراءات الفعلية استخدم لوحة التحكم الرئيسية.' +
            '</div>';
    }

    function widgetHtml() {
        return '<div id="baq-chat" style="max-width:700px;">' +
            '<div id="baq-log" style="max-height:60vh;min-height:200px;overflow-y:auto;padding:14px;background:#111118;border:1px solid #252540;border-radius:12px;display:flex;flex-direction:column;gap:10px;font-size:.86rem;color:#d8d8e8;font-family:\'Tajawal\',Tahoma,sans-serif;">' +
            '<div style="padding:10px 14px;background:#1d1d2f;border:1px solid #2a2a45;border-radius:10px;color:#aaa;border-bottom-left-radius:3px;">' +
            '🦇 <b style="color:#c9a227;">اسأل باتمان</b> — مساعد المدير الذكي (قراءة فقط).<br>' +
            'اسأل عن: مبيعات اليوم، المصروفات، المخزون المنخفض، أفضل المنتجات، حالة النظام، أو قرارات الصلاحيات (المعلّقة/المحظورة/الموافقات).<br>' +
            '<span style="font-size:.72rem;color:#666;">⚡ الأرقام من لوحة الإدارة وسجل <code style="color:#7878a0;">batman_decisions</code> — لا تخمين.</span></div></div>' +
            '<div style="display:flex;gap:8px;margin-top:10px;">' +
            '<input id="baq-input" type="text" placeholder="اسأل عن قرارات الصلاحيات (قراءة فقط)..." style="flex:1;padding:11px 14px;border-radius:10px;border:1px solid #252540;background:#18182a;color:#d8d8e8;font-size:.85rem;outline:none;font-family:\'Tajawal\',Tahoma,sans-serif;">' +
            '<button id="baq-send" style="background:#c9a227;color:#0a0a0f;border:none;border-radius:10px;padding:0 18px;font-weight:800;cursor:pointer;" onclick="BatmanQueries.sendAdmin()">➤</button></div>' +
            '<div id="baq-busy" style="display:none;margin-top:8px;font-size:.78rem;color:#7878a0;">🦇 جارٍ التحليل...</div></div>';
    }

    function logBubble(log, text, type) {
        if (!log) return;
        var m = document.createElement('div');
        m.style.padding = '9px 13px';
        m.style.borderRadius = '11px';
        m.style.maxWidth = '85%';
        m.style.lineHeight = '1.6';
        m.style.whiteSpace = 'pre-wrap';
        if (type === 'user') {
            m.style.background = 'linear-gradient(135deg,#a08020,#c9a227)';
            m.style.color = '#0a0a0f';
            m.style.alignSelf = 'flex-end';
            m.style.borderBottomRightRadius = '3px';
            m.style.fontWeight = '500';
            m.textContent = text;
        } else {
            m.style.background = '#1d1d2f';
            m.style.color = '#d8d8e8';
            m.style.alignSelf = 'flex-start';
            m.style.borderBottomLeftRadius = '3px';
            m.style.border = '1px solid #252540';
            m.innerHTML = String(text || '').replace(/\n/g, '<br>');
        }
        log.appendChild(m);
        log.scrollTop = log.scrollHeight;
    }

    function mountAdminWidget(mountId) {
        var mount = document.getElementById(mountId || 'batmanAskMount');
        if (!mount) return;
        if (!isManagerIdentity()) { mount.innerHTML = denialHtml(); return; }
        mount.innerHTML = widgetHtml();
        var input = document.getElementById('baq-input');
        if (input) input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); sendAdmin(); } });
    }

    function sendAdmin() {
        var input = document.getElementById('baq-input');
        var log = document.getElementById('baq-log');
        var busy = document.getElementById('baq-busy');
        if (!input || !log) return;
        var q = input.value.trim();
        if (!q) return;
        input.value = '';
        logBubble(log, q, 'user');
        if (busy) busy.style.display = 'block';
        ask(q).then(function (r) {
            if (busy) busy.style.display = 'none';
            var reply = (r && (r.answer || r.message)) || '— لا توجد نتيجة.';
            logBubble(log, reply, 'bot');
        }).catch(function (e) {
            if (busy) busy.style.display = 'none';
            logBubble(log, '⚠️ ' + String(e && e.message || e), 'bot');
        });
    }

    // إظهار/إخفاء رابط القائمة حسب الدور
    function gateAdminUI() {
        try {
            var show = isManagerIdentity();
            var link = document.getElementById('batmanAskLink');
            var nav = document.getElementById('batmanAskNav');
            if (link) link.style.display = show ? '' : 'none';
            if (nav) nav.style.display = show ? '' : 'none';
            if (!show) {
                var mount = document.getElementById('batmanAskMount');
                if (mount && !mount.dataset.gated) { mount.dataset.gated = '1'; mount.innerHTML = denialHtml(); }
            }
        } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════
    // BUSINESS TOOLS — أرقام حقيقية من AdminAnalytics/LuccaDB (قراءة فقط)
    // ═══════════════════════════════════════════════════════

    function adminCompute(opts) {
        if (typeof window === 'undefined') throw new Error('بيئة المتصفح غير متاحة');
        var db = window.LuccaDB || null;
        var ac = window.AdminAnalytics || null;
        if (!db || !ac || typeof ac.compute !== 'function') throw new Error('مصدر بيانات اللوحة غير متاح (AdminAnalytics/LuccaDB)');
        return ac.compute(db, opts || { from: dayKey(new Date()), to: dayKey(new Date()) });
    }

    function bizNum(n) { var x = Number(n); return Number.isFinite(x) ? x : 0; }

    function topProductsRange(p) {
        var today = dayStart(new Date());
        if (p === 'week') return { from: dayKey(addDays(today, -6)), to: dayKey(today) };
        if (p === 'all') return { from: '2000-01-01', to: dayKey(today) };
        return { from: dayKey(today), to: dayKey(today) };
    }

    function healthSignal(key, label, ok, detail) {
        return { key: key, label: label, ok: !!ok, detail: detail || '' };
    }

    async function lightHealthProbe() {
        var out = [];
        if (typeof window === 'undefined') return [healthSignal('frontend', 'الواجهة', false, 'لا بيئة متصفح')];
        out.push(healthSignal('frontend', 'الواجهة', true, 'الصفحة محمّلة'));
        if (window.LuccaDB && window.LuccaDB.db) {
            out.push(healthSignal('database', 'قاعدة البيانات', true, 'IndexedDB متاحة (v' + String(window.LuccaDB.db.version || '') + ')'));
        } else {
            out.push(healthSignal('database', 'قاعدة البيانات', false, 'LuccaDB غير محمّل'));
        }
        if (window.OllamaAI) {
            var okO = false, detO = 'غير متاح';
            try { okO = !!(await window.OllamaAI.isAvailable(true)); detO = okO ? ('النموذج: ' + (window.OllamaAI.model || '—')) : 'لا استجابة من Ollama'; }
            catch (e) { detO = String(e && e.message || e); }
            out.push(healthSignal('ollama', 'Ollama', okO, detO));
        } else {
            out.push(healthSignal('ollama', 'Ollama', false, 'المحول ollama-adapter.js غير محمّل'));
        }
        try {
            var c = new AbortController(); var t = setTimeout(function () { try { c.abort(); } catch (_) {} }, 4000);
            var res = await fetch(serverBase() + '/health', { signal: c.signal });
            clearTimeout(t);
            out.push(healthSignal('backend', 'الخادم الخلفي', res.ok, 'GET /health → HTTP ' + res.status));
        } catch (e) {
            out.push(healthSignal('backend', 'الخادم الخلفي', false, (e && e.name === 'AbortError') ? 'مهلة الاتصال' : 'غير متصل'));
        }
        return out;
    }

    async function btGetSalesToday(_rows) {
        var d = await adminCompute();
        return {
            date: d.to,
            income_net: bizNum(d.kpis.sales.value),
            orders_count: bizNum(d.kpis.orders.value),
            avg_order: bizNum(d.kpis.avgOrder.value),
            refunds_total: bizNum(d.refundsReport.refundTotal || 0),
            discounts_total: bizNum(d.discountsReport.totalDiscounts || 0),
            top_products: (d.topProducts || []).slice(0, 5).map(function (p) { return { name: p.name, revenue: bizNum(p.revenue), qty: bizNum(p.quantity) }; })
        };
    }

    async function btGetExpensesToday(_rows) {
        var d = await adminCompute();
        return {
            date: d.to,
            expenses_total: bizNum(d.expenses.total),
            expenses_count: bizNum(d.expenses.count),
            by_category: (d.expenses.byCategory || []).slice(0, 5).map(function (c) { return { name: c.name, total: bizNum(c.total), count: bizNum(c.count) }; })
        };
    }

    async function btGetLowStock(_rows) {
        var d = await adminCompute();
        return {
            low_count: bizNum(d.inventory.lowStock || 0),
            out_count: bizNum(d.inventory.outOfStock || 0),
            inventory_value: bizNum(d.inventory.inventoryValue),
            low_items: (d.inventory.items || []).filter(function (i) { return i.status === 'low'; }).slice(0, 10).map(function (i) { return { name: i.name, quantity: bizNum(i.quantity), min: bizNum(i.minStock) }; }),
            out_items: (d.inventory.items || []).filter(function (i) { return i.status === 'out'; }).slice(0, 10).map(function (i) { return { name: i.name, quantity: bizNum(i.quantity) }; })
        };
    }

    async function btGetTopProducts(_rows, opts) {
        var p = (opts && opts.period) || 'today';
        var rng = topProductsRange(p);
        var d = await adminCompute({ from: rng.from, to: rng.to });
        return {
            period: p === 'week' ? 'week' : (p === 'all' ? 'all' : 'today'),
            from: rng.from, to: rng.to,
            top_products: (d.topProducts || []).slice(0, 10).map(function (x) { return { rank: x.rank, name: x.name, revenue: bizNum(x.revenue), qty: bizNum(x.quantity) }; })
        };
    }

    async function btGetSystemHealth(_rows) {
        var checks = (typeof window !== 'undefined' && window.SystemHealth && typeof window.SystemHealth.probe === 'function')
            ? await window.SystemHealth.probe()
            : await lightHealthProbe();
        return { checked_at: iso(new Date()), checks: checks || [] };
    }

    // تسجيل الأدوات التجارية في القائمة ونماذج الاختيار (قراءة فقط — لا كتابة)
    var BUSINESS_SCHEMAS = [
        { name: 'getSalesToday', description: 'أرقام مبيعات اليوم الحقيقية من لوحة الإدارة: صافي الإيراد بعد خصم المرتجعات، عدد الطلبات، متوسط قيمة الفاتورة، قيمة الخصومات والمرتجعات، وأفضل 5 منتجات مبيعاً.', parameters: { type: 'object', properties: {} } },
        { name: 'getExpensesToday', description: 'مصروفات اليوم الحقيقية من لوحة الإدارة: الإجمالي، العدد، والتفصيل حسب الفئة (أعلى 5).', parameters: { type: 'object', properties: {} } },
        { name: 'getLowStock', description: 'المخزون المنخفض من لوحة الإدارة: عدد الأصناف المنخفضة والنافدة، أسماؤها وكمياتها، وقيمة المخزون الإجمالية.', parameters: { type: 'object', properties: {} } },
        { name: 'getTopProducts', description: 'أفضل المنتجات مبيعاً حسب الإيراد في فترة معينة (today/week/all) من لوحة الإدارة.', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'week', 'all'] } } } },
        { name: 'getSystemHealth', description: 'فحص حالة النظام الحقيقي: الواجهة، قاعدة البيانات، الخادم الخلفي، Ollama، المصادقة، المزامنة — كل مكوّن بحالة (ok) وتفصيل.', parameters: { type: 'object', properties: {} } }
    ];

    function registerBusinessTools() {
        for (var i = 0; i < BUSINESS_SCHEMAS.length; i++) {
            var s = BUSINESS_SCHEMAS[i];
            TOOL_SCHEMAS.push(s);
            var fn = s.name === 'getSalesToday' ? btGetSalesToday
                : s.name === 'getExpensesToday' ? btGetExpensesToday
                : s.name === 'getLowStock' ? btGetLowStock
                : s.name === 'getTopProducts' ? btGetTopProducts
                : btGetSystemHealth;
            TOOLS[s.name] = { fn: fn, business: true };
        }
    }
    registerBusinessTools();

    // ═══════════════════════════════════════════════════════
    // EXPORT + UMD
    // ═══════════════════════════════════════════════════════

    var api = {
        // Pure functions (للتجربة الوحدوية / tests)
        _core: {
            parseDT: parseDT,
            normalizeRow: normalizeRow,
            normalizeRows: normalizeRows,
            periodRange: periodRange,
            inRange: inRange,
            dayKey: dayKey,
            iso: iso,
            fullRow: fullRow,
            getFlaggedToday: getFlaggedToday,
            getTopRequestersByAction: getTopRequestersByAction,
            getBlockedAttempts: getBlockedAttempts,
            getApprovalTrend: getApprovalTrend,
            getActionsByType: getActionsByType,
            detectWriteIntent: detectWriteIntent,
            canonicalRole: canonicalRole,
            isManagerIdentity: isManagerIdentity
        },
        tools: function () { return TOOL_SCHEMAS; },
        ask: ask,
        sendAdmin: sendAdmin,
        mountAdminWidget: mountAdminWidget,
        gateAdminUI: gateAdminUI,
        denialHtml: denialHtml,
        plainSummary: plainSummary
    };

    // UMD — يعمل في المتصفح والـ Node
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) root.BatmanQueries = api;

    // تسجيل الأدوات في محرك Ollama (عند توافره)
    if (typeof window !== 'undefined') {
        (function registerBatmanToolsWithOllama() {
            var O = window.OllamaAI;
            if (!O || typeof O.registerTool !== 'function') return;
            for (var i = 0; i < TOOL_SCHEMAS.length; i++) {
                var s = TOOL_SCHEMAS[i];
                var toolName = s.name;
                (function (schema, name) {
                    O.registerTool(schema, function (params) {
                        var fn = TOOLS[name] && TOOLS[name].fn;
                        if (!fn) throw new Error('Tool not found: ' + name);
                        var p = normalizeToolParams(name, params || {});
                        if (fn.business) return fn(null, p);
                        return fetchDecisions(500).then(function (raw) {
                            var rows = normalizeRows(raw);
                            return fn(rows, p);
                        });
                    });
                })(s, toolName);
            }
        })();
    }

    // Init gating
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', gateAdminUI);
        else gateAdminUI();
    }

})(typeof window !== 'undefined' ? window : globalThis);
