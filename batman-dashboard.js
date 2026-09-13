/*
╔══════════════════════════════════════════════════════════════╗
║        LUCCA Batman AI Dashboard — محقق/لوحة باتمان الذكية        ║
║   - قراءة-فقط (read-only) لا يعدّل قاعدة البيانات إطلاقاً       ║
║   - كل الأرقام الحية تُقرأ من قاعدة البيانات المحلية            ║
║   - SAFE (قراءة) بدون تأكيد — لا توجد أدوات كتابة هنا           ║
║   - يعمل بدون Ollama (تحليل محلي) ويدعم Ollama عند توافره      ║
╚══════════════════════════════════════════════════════════════╝
*/
window.BatmanDashboard = (function(){
    'use strict';

    var CSS = [
        '#bd-root{--bd-black:#0a0a0f;--bd-charcoal:#111118;--bd-dark:#18182a;--bd-gray:#222235;',
        '--bd-light:#2c2c42;--bd-accent:#c9a227;--bd-accent-dim:#a08020;--bd-text:#d8d8e8;',
        '--bd-text-dim:#7878a0;--bd-border:#252540;--bd-success:#2ecc71;--bd-danger:#e74c3c;',
        '--bd-info:#3498db;position:fixed;top:0;left:0;width:100%;height:100%;z-index:12000;',
        'display:none;align-items:center;justify-content:center;font-family:\'Tajawal\',\'Segoe UI\',Tahoma,sans-serif;}',
        '#bd-root.bd-open{display:flex;}',
        '#bd-overlay{position:absolute;inset:0;background:rgba(5,5,10,0.72);backdrop-filter:blur(3px);}',
        '#bd-panel{position:relative;width:min(940px,94vw);height:min(640px,92vh);display:flex;flex-direction:column;',
        'background:var(--bd-charcoal);border:1px solid var(--bd-border);border-radius:16px;overflow:hidden;',
        'box-shadow:0 20px 70px rgba(0,0,0,.75),0 0 90px rgba(201,162,39,.07);}',
        '#bd-head{background:linear-gradient(135deg,var(--bd-black),var(--bd-dark));padding:14px 18px;',
        'display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--bd-accent-dim);flex-shrink:0;}',
        '#bd-head .bd-badge{width:44px;height:44px;border-radius:50%;background:radial-gradient(circle,var(--bd-dark),var(--bd-black));',
        'border:2px solid var(--bd-accent);display:flex;align-items:center;justify-content:center;color:var(--bd-accent);',
        'font-size:1.4rem;box-shadow:0 0 14px rgba(201,162,39,.25);}',
        '#bd-head .bd-title{flex:1;}',
        '#bd-head .bd-title b{color:var(--bd-accent);letter-spacing:2px;font-size:1.05rem;}',
        '#bd-head .bd-title span{display:block;color:var(--bd-text-dim);font-size:.72rem;margin-top:2px;}',
        '#bd-x{background:transparent;border:1px solid var(--bd-border);color:var(--bd-text-dim);border-radius:8px;',
        'width:34px;height:34px;cursor:pointer;font-size:1rem;line-height:1;}',
        '#bd-x:hover{border-color:var(--bd-danger);color:var(--bd-danger);}',
        '#bd-body{flex:1;display:flex;min-height:0;}',
        '#bd-side{width:220px;flex-shrink:0;border-left:1px solid var(--bd-border);background:var(--bd-black);',
        'padding:14px 10px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;}',
        '#bd-main{flex:1;display:flex;flex-direction:column;min-width:0;}',
        '.bd-nav{padding:9px 13px;border-radius:9px;color:var(--bd-text-dim);cursor:pointer;font-size:.84rem;',
        'display:flex;align-items:center;gap:9px;border:1px solid transparent;transition:all .2s;background:transparent;width:100%;text-align:right;}',
        '.bd-nav:hover{background:var(--bd-dark);color:var(--bd-text);}',
        '.bd-nav.bd-active{background:linear-gradient(135deg,var(--bd-accent-dim),var(--bd-accent));color:var(--bd-black);font-weight:700;}',
        '.bd-nav.bd-active span{color:var(--bd-black);}',
        '.bd-nav span{width:20px;text-align:center;font-size:1rem;color:var(--bd-accent);}',
        '#bd-main-content{flex:1;overflow-y:auto;padding:18px;}',
        '.bd-h2{color:var(--bd-accent);font-size:.95rem;font-weight:800;margin:0 0 12px;letter-spacing:.5px;}',
        '.bd-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px;}',
        '.bd-card{background:var(--bd-dark);border:1px solid var(--bd-border);border-radius:12px;padding:14px;}',
        '.bd-card .k{color:var(--bd-text-dim);font-size:.72rem;margin-bottom:6px;}',
        '.bd-card .v{color:var(--bd-text);font-size:1.15rem;font-weight:800;font-family:\'Segoe UI\',Tahoma,sans-serif;}',
        '.bd-card .s{color:var(--bd-success);font-size:.68rem;margin-top:5px;}',
        '.bd-table{width:100%;border-collapse:collapse;font-size:.8rem;}',
        '.bd-table th{color:var(--bd-accent);text-align:right;padding:7px 9px;border-bottom:1px solid var(--bd-border);font-size:.7rem;text-transform:uppercase;letter-spacing:.3px;}',
        '.bd-table td{padding:7px 9px;border-bottom:1px solid var(--bd-border);color:var(--bd-text);}',
        '.bd-table tr:hover td{background:rgba(201,162,39,.05);}',
        '.bd-pill{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.68rem;font-weight:700;}',
        '.bd-pill.ok{background:rgba(46,204,113,.15);color:var(--bd-success);}',
        '.bd-pill.warn{background:rgba(231,76,60,.15);color:var(--bd-danger);}',
        '.bd-pill.info{background:rgba(52,152,219,.15);color:var(--bd-info);}',
        '.bd-mono{font-family:Consolas,monospace;font-size:.78rem;}',
        '.bd-chat{display:flex;flex-direction:column;height:100%;min-height:0;}',
        '#bd-log{flex:1;overflow-y:auto;background:var(--bd-black);border:1px solid var(--bd-border);',
        'border-radius:10px;padding:14px;margin-bottom:10px;display:flex;flex-direction:column;gap:9px;min-height:120px;}',
        '.bd-log-msg{max-width:82%;padding:9px 13px;border-radius:11px;font-size:.82rem;line-height:1.6;white-space:pre-wrap;}',
        '.bd-log-msg.bd-user{background:linear-gradient(135deg,var(--bd-accent-dim),var(--bd-accent));color:var(--bd-black);align-self:flex-end;border-bottom-right-radius:3px;font-weight:500;}',
        '.bd-log-msg.bd-bot{background:var(--bd-gray);color:var(--bd-text);align-self:flex-start;border-bottom-left-radius:3px;border:1px solid var(--bd-border);}',
        '.bd-log-msg.bd-sys{background:rgba(201,162,39,.08);color:var(--bd-text-dim);font-size:.72rem;align-self:center;border-radius:8px;max-width:96%;text-align:center;}',
        '.bd-log-msg b,.bd-log-msg strong{color:var(--bd-accent);}',
        '#bd-chat-inputrow{display:flex;gap:8px;}',
        '#bd-chat-in{flex:1;padding:11px 14px;border-radius:10px;border:1px solid var(--bd-border);background:var(--bd-dark);',
        'color:var(--bd-text);font-size:.85rem;outline:none;font-family:inherit;}',
        '#bd-chat-in:focus{border-color:var(--bd-accent);}',
        '#bd-chat-send{background:var(--bd-accent);color:var(--bd-black);border:none;border-radius:10px;padding:0 18px;font-weight:800;cursor:pointer;}',
        '.bd-reports{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;}',
        '.bd-report{background:var(--bd-dark);border:1px solid var(--bd-border);border-radius:12px;padding:15px;cursor:pointer;transition:all .2s;text-align:right;}',
        '.bd-report:hover{border-color:var(--bd-accent);transform:translateY(-2px);}',
        '.bd-report .emoji{font-size:1.5rem;}',
        '.bd-report .t{font-weight:800;color:var(--bd-text);margin:8px 0 4px;font-size:.88rem;}',
        '.bd-report .d{color:var(--bd-text-dim);font-size:.72rem;line-height:1.5;}',
        '.bd-status-line{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;}',
        '.bd-status-chip{display:flex;align-items:center;gap:8px;background:var(--bd-dark);border:1px solid var(--bd-border);border-radius:20px;padding:6px 14px;font-size:.75rem;color:var(--bd-text);}',
        '.bd-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}',
        '.bd-dot.on{background:var(--bd-success);box-shadow:0 0 8px var(--bd-success);}',
        '.bd-dot.off{background:var(--bd-danger);}',
        '.bd-dot.idle{background:var(--bd-text-dim);}',
        '.bd-err{background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);color:var(--bd-danger);border-radius:8px;padding:8px 12px;font-size:.75rem;margin:4px 0;}',
        '.bd-note{color:var(--bd-text-dim);font-size:.74rem;line-height:1.7;margin-top:8px;}',
        '#bd-fab{position:fixed;bottom:20px;right:88px;z-index:9990;width:52px;height:52px;border-radius:50%;',
        'background:var(--bd-charcoal);border:2px solid var(--bd-accent);color:var(--bd-accent);cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(201,162,39,.3);',
        'transition:transform .2s;font-size:1.3rem;line-height:1;}',
        '#bd-fab:hover{transform:scale(1.1);}',
        '#bd-fab.monitoring::after{content:\'\';position:absolute;top:0;right:0;width:14px;height:14px;border-radius:50%;'+
        'background:var(--bd-success);border:2px solid var(--bd-charcoal);box-shadow:0 0 8px var(--bd-success);}',
        '#bd-fab.monitoring{animation:bdPulse 2.4s infinite;}',
        '@keyframes bdPulse{0%,100%{box-shadow:0 4px 20px rgba(201,162,39,.3);}50%{box-shadow:0 4px 26px rgba(46,204,113,.5);}}',
        '@media(max-width:720px){#bd-side{display:none;}#bd-panel{width:100vw;height:100vh;border-radius:0;}}'
    ].join('\n');

    var _open = false;
    var _currentTab = 'status';
    var _chatLog = [];
    var _health = { ollama: false, model: null, engine: false, db: false, lastError: null };
    var _startTime = Date.now();
    // storage helper — آمن في كل البيئات (browser/headless)
    function kGet(k){
        try { return (typeof localStorage !== 'undefined' && localStorage) ? localStorage.getItem(k) : null; }
        catch(e){ return null; }
    }
    function kSet(k, v){
        try { if(typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(k, v); } catch(e){}
    }

    // ===== continuous monitor state =====
    var _monitor = { running:false, timer:null, intervalMs:300000, debounce:false, lastRun:null, alerts:[], lastAnalysis:null, checks:0 };
    var _monitorEnabled = kGet('luccaBatmanMonitor') !== '0';
    // تفضيلات التحليل: quick (سريع، سياق صغير) للاستخدام المستمر / deep (عميق) عند الطلب النادر
    var _aiMode = 'deep';           // default for user questions
    var _quickThrottle = {};        // لمنع طلبات متزامنة من نفس النوع

    // ===== سجل الإقفالات اليومية + الصوت + الإشعارات =====
    var _closings = []; // ملخصات الإقفال النهائية (تظهر في سجل المراقبة)
    try { _closings = JSON.parse(kGet('luccaBatmanClosings')||'[]')||[]; } catch(e){ _closings=[]; }
    var _voiceEnabled = kGet('luccaBatmanVoice') === '1' || kGet('luccaBatmanVoice') === null;
    var _lastNotifiedTime = {}; // منع تكرار الإشعارات لنفس التنبيه

    // نطق نص عربي (اختياري، يُفعَّل من الإعدادات)
    function speak(text){
        if(!_voiceEnabled || typeof window==='undefined' || !window.speechSynthesis) return;
        try {
            var clean = String(text||'').replace(/[*_#>|]/g,' ').replace(/[CW]:/g,'').replace(/\s{2,}/g,' ').trim();
            if(!clean || clean.length>320) clean = clean.slice(0,320);
            var u = new SpeechSynthesisUtterance(clean);
            u.lang = 'ar-SA'; u.rate = 0.95; u.pitch = 1;
            var vs = window.speechSynthesis.getVoices();
            var ar = vs.filter(function(v){ return /^ar/i.test(v.lang); });
            if(ar.length) u.voice = ar[0];
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
        } catch(e){}
    }
    function toggleVoice(){
        _voiceEnabled = !_voiceEnabled;
        kSet('luccaBatmanVoice', _voiceEnabled?'1':'0');
        if(_voiceEnabled){
            try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch(e){}
            speak('تم تفعيل الصوت');
        }
        return _voiceEnabled;
    }

    // إشعار نظام لسطح المكتب (لا يكسر شيئاً إذا غير مدعوم)
    function notify(title, body){
        try {
            if(typeof Notification === 'undefined') return;
            var key = String(title+':'+body).slice(0,60);
            var now = Date.now();
            if(_lastNotifiedTime[key] && now-_lastNotifiedTime[key] < 180000) return; // منع تكرار سريع
            var go = function(){
                try { new Notification(title, { body: body }); } catch(e){}
                _lastNotifiedTime[key] = now;
            };
            if(Notification.permission === 'granted') go();
            else if(Notification.permission !== 'denied'){
                Notification.requestPermission().then(function(p){ if(p==='granted') go(); }).catch(function(){});
            }
        } catch(e){}
    }

    // حفظ ملخص إقفال (يُحفظ محلياً ويُعرض في سجل المراقبة)
    function pushClosing(summaryText){
        _closings.unshift({ time: Date.now(), date: today(), text: summaryText });
        if(_closings.length > 14) _closings.pop();
        try { kSet('luccaBatmanClosings', JSON.stringify(_closings)); } catch(e){}
    }

    function el(html){
        var d = document.createElement('div');
        d.innerHTML = html.trim();
        return d.firstChild;
    }

    function money(n){ return (Number(n)||0).toLocaleString('ar-EG',{maximumFractionDigits:0}); }
    function today() { return new Date().toISOString().slice(0,10); }
    function startOfYearPrefix(d){ d = d||new Date(); return d.toISOString().slice(0,4); }

    // ============ READ-ONLY REAL-DATA TOOLS ============
    // كل هذه الأدوات قراءة-فقط (SAFE) — لا تُعدّل أي بيانات.
    var BMRuntimeTools = {
        // ---- SALES ----
        async salesToday(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) throw new Error('قاعدة البيانات غير متاحة');
            var orders = await db.getAll('orders');
            var refunds = await db.getAll('refunds');
            var p = today();
            var paid = (orders||[]).filter(o => String(o.paymentStatus||'').toLowerCase()==='paid' && (o.createdAt||o.date||'').slice(0,p.length)===p);
            var sales = paid.reduce(function(s,o){return s+Number(o.total||o.totalAmount||0);},0);
            var ref = (refunds||[]).filter(r=>(r.createdAt||r.updatedAt||r.date||'').slice(0,p.length)===p);
            var refundTotal = ref.reduce(function(s,r){return s+Number(r.amount||0);},0);
            return { sales: sales-refundTotal, gross: sales, count: paid.length, refunds: refundTotal };
        },
        async salesByPayment(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var orders = (await db.getAll('orders'))||[];
            var p = today();
            var paid = orders.filter(o => String(o.paymentStatus||'').toLowerCase()==='paid' && (o.createdAt||o.date||'').slice(0,p.length)===p);
            var map = {};
            paid.forEach(o=>{ var m = o.paymentMethod||'أخرى'; map[m]=(map[m]||0)+Number(o.total||o.totalAmount||0); });
            return Object.keys(map).map(function(k){return {method:k, value:map[k]};}).sort(function(a,b){return b.value-a.value;});
        },
        async productTotals(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var orders = (await db.getAll('orders'))||[];
            var p = today();
            var paid = orders.filter(o => String(o.paymentStatus||'').toLowerCase()==='paid' && (o.createdAt||o.date||'').slice(0,p.length)===p);
            var map = {};
            paid.forEach(function(o){
                (o.items||[]).forEach(function(it){
                    var n = it.name||it.productName||'متنوع';
                    map[n] = (map[n]||0) + Number(it.qty||it.quantity||1);
                });
            });
            var arr = Object.keys(map).map(function(k){return {name:k, qty:map[k]};}).sort(function(a,b){return b.qty-a.qty;});
            return arr.slice(0,8);
        },
        // ---- ORDERS / TABLES ----
        async tablesNow(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var tables = (await db.getAll('tables'))||[];
            return tables.filter(t => String(t.status)==='occupied' || String(t.status)==='open');
        },
        async openOrdersCount(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return 0;
            var orders = (await db.getAll('orders'))||[];
            return orders.filter(function(o){ var s=o.status||o.paymentStatus||''; return s!=='closed' && s!=='paid' && s!=='completed' && s!=='cancelled'; }).length;
        },
        // ---- FINANCIAL ----
        async expensesToday(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return { total:0, count:0 };
            var all = (await db.getAll('expenses'))||[];
            var p = today();
            var list = all.filter(function(x){ var d=x.date||x.createdAt||''; return d.slice(0,p.length)===p; });
            return { total: list.reduce(function(s,x){return s+Number(x.amount||0);},0), count: list.length };
        },
        async purchasesTotal(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return 0;
            var all = (await db.getAll('purchases'))||[];
            var p = today();
            var list = all.filter(function(x){ var d=x.date||x.createdAt||''; return d.slice(0,p.length)===p; });
            return list.reduce(function(s,x){ return s + Number(x.total||x.totalCost||x.amount||0); },0);
        },
        async yearSales(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return { sales:0, refunds:0, count:0 };
            var orders = (await db.getAll('orders'))||[];
            var refunds = (await db.getAll('refunds'))||[];
            var p = startOfYearPrefix();
            var paid = orders.filter(function(o){ return String(o.paymentStatus||'').toLowerCase()==='paid' && (o.createdAt||o.date||'').slice(0,p.length)===p; });
            var sales = paid.reduce(function(s,o){return s+Number(o.total||o.totalAmount||0);},0);
            var ref = (refunds||[]).filter(function(r){ return (r.createdAt||r.updatedAt||r.date||'').slice(0,p.length)===p; });
            var refundTotal = ref.reduce(function(s,r){return s+Number(r.amount||0);},0);
            return { sales: sales-refundTotal, gross: sales, count: paid.length, refunds: refundTotal };
        },
        // ---- EMPLOYEES ----
        async employeesActive(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var all = (await db.getAll('employees'))||[];
            return all.filter(function(e){ return e.active!==0 && String(e.status)!=='inactive'; });
        },
        async attendanceToday(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var all = (await db.getAll('attendance'))||[];
            var p = today();
            return all.filter(function(a){ return (a.date||a.createdAt||'').slice(0,p.length)===p; });
        },
        async shiftsToday(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var all = (await db.getAll('shifts'))||[];
            var p = today();
            return all.filter(function(s){ return (s.date||s.createdAt||'').slice(0,p.length)===p; });
        },
        // ---- SYSTEM ----
        async dbStatus(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return { ok:false };
            try { await db.getAll('settings'); return { ok:true }; }
            catch(e){ return { ok:false, error:e.message }; }
        },
        async lowStockCount(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return 0;
            try {
                var inv = (await db.getAll('inventory'))||[];
                var alerts = (await db.getAll('inventory_alerts'))||[];
                if(alerts.length) return alerts.length;
                // احتساب تقريبي: أصناف بكمية صفر/منخفضة
                return inv.filter(function(i){
                    var q = Number(i.stock||i.quantity||i.qty||0);
                    var th = Number(i.minStock||i.lowStock||i.threshold||5);
                    return q <= th;
                }).length;
            } catch(e){ return 0; }
        },
        async summary(){
            var s = await this.salesToday();
            var e = await this.expensesToday();
            var pur = await this.purchasesTotal();
            var tables = await this.tablesNow();
            var emp = await this.employeesActive();
            var open = await this.openOrdersCount();
            return {
                todaySales: s.sales,
                todayOrders: s.count,
                todayRefunds: s.refunds,
                todayExpenses: e.total,
                todayPurchases: pur,
                openTables: tables.length,
                openOrders: open,
                activeEmployees: emp.length,
                profit: s.sales - e.total
            };
        },
        // ---- ANALYSIS (قراءة-فقط) ----
        // مبيعات وأرقام ليوم محدد (YYYY-MM-DD)
        async salesOn(date){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return { sales:0, gross:0, count:0, refunds:0 };
            var orders = await db.getAll('orders');
            var refunds = await db.getAll('refunds');
            var p = String(date||today()).slice(0,10);
            var paid = (orders||[]).filter(o => String(o.paymentStatus||'').toLowerCase()==='paid' && (o.createdAt||o.date||'').slice(0,p.length)===p);
            var sales = paid.reduce(function(s,o){return s+Number(o.total||o.totalAmount||0);},0);
            var ref = (refunds||[]).filter(r=>(r.createdAt||r.updatedAt||r.date||'').slice(0,p.length)===p);
            var refundTotal = ref.reduce(function(s,r){return s+Number(r.amount||0);},0);
            return { sales: sales-refundTotal, gross: sales, count: paid.length, refunds: refundTotal };
        },
        // مصروفات ليوم محدد
        async expensesOn(date){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return { total:0, count:0 };
            var all = (await db.getAll('expenses'))||[];
            var p = String(date||today()).slice(0,10);
            var list = all.filter(function(x){ var d=x.date||x.createdAt||''; return d.slice(0,p.length)===p; });
            return { total: list.reduce(function(s,x){return s+Number(x.amount||0);},0), count: list.length };
        },
        // مشتريات ليوم محدد
        async purchasesOn(date){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return 0;
            var all = (await db.getAll('purchases'))||[];
            var p = String(date||today()).slice(0,10);
            var list = all.filter(function(x){ var d=x.date||x.createdAt||''; return d.slice(0,p.length)===p; });
            return list.reduce(function(s,x){ return s + Number(x.total||x.totalCost||x.amount||0); },0);
        },
        // اتجاه المبيعات لآخر n أيام (آخرها اليوم)
        async salesTrend(n){
            n = n||7;
            var out = [];
            for(var i=n-1;i>=0;i--){
                var d = new Date(); d.setDate(d.getDate()-i);
                var key = d.toISOString().slice(0,10);
                var s = await this.salesOn(key);
                out.push({ date:key, sales: s.sales, count: s.count });
            }
            return out;
        },
        // ساعات الذروة اليوم: عدد الفواتير لكل ساعة
        async peakHoursOn(date){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            var orders = (await db.getAll('orders'))||[];
            var p = String(date||today()).slice(0,10);
            var paid = orders.filter(function(o){ return String(o.paymentStatus||'').toLowerCase()==='paid' && (o.createdAt||o.date||'').slice(0,p.length)===p; });
            var map = {};
            paid.forEach(function(o){
                var ds = String(o.createdAt||o.date||'');
                var h = /T(\d{2}):/.test(ds) ? parseInt(ds.match(/T(\d{2}):/)[1],10) : null;
                if(h===null) { var m2 = ds.match(/(\d{2}):(\d{2})/); if(m2) h = parseInt(m2[1],10); }
                if(h!==null) map[h] = (map[h]||0) + 1;
            });
            var arr = Object.keys(map).map(function(k){ return { hour:+k, count:map[k] }; }).sort(function(a,b){ return b.count-a.count; });
            return arr.slice(0,5);
        },
        // تفاصيل أصناف المخزون المنخفض (اسم + كمية + حد)
        async lowStockItems(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            try {
                var inv = (await db.getAll('inventory'))||[];
                return inv.map(function(i){
                    return { name: i.name||i.itemName||i.productName||'صنف', qty: Number(i.stock||i.quantity||i.qty||0), threshold: Number(i.minStock||i.lowStock||i.threshold||5) };
                }).filter(function(i){ return i.qty <= i.threshold; });
            } catch(e){ return []; }
        },
        // ====== طبقة التبليغ الاستباقي: أدوات حية مدمجة ======
        // سجل الهدر ليوم (waste_log + حركات stock_movements من نوع waste) مع قيمة التكلفة
        async wasteToday(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return { count:0, qty:0, value:0, items:[], top:null };
            try {
                var p = today();
                var costMap = await this.inventoryCostMap();
                var rows = [];
                var wl = (await db.getAll('waste_log'))||[];
                wl.forEach(function(w){ var d=(w.date||w.createdAt||'').slice(0,10); if(d===p) rows.push({ name:w.name||'', ingredientId:w.ingredientId, quantity:Math.abs(Number(w.quantity||0)), reason:w.reason||w.cause||'' }); });
                var sm = (await db.getAll('stock_movements'))||[];
                sm.forEach(function(m){ var d=(m.date||m.createdAt||'').slice(0,10); if(d===p && String(m.type||'')==='waste') rows.push({ name:m.name||m.ingredientName||'', ingredientId:m.ingredientId, quantity:Math.abs(Number(m.quantity||0)), reason:m.notes||m.reason||'' }); });
                var totalQty=0, totalValue=0, byReason={};
                rows.forEach(function(r){
                    totalQty+=r.quantity;
                    totalValue+=(costMap[r.ingredientId]||0)*r.quantity;
                    var rk=r.reason||'بدون سبب';
                    byReason[rk]=(byReason[rk]||0)+r.quantity;
                });
                var reasons=Object.keys(byReason).map(function(k){return {reason:k, qty:byReason[k]};}).sort(function(a,b){return b.qty-a.qty;});
                return { count: rows.length, qty: totalQty, value: totalValue, items: rows.slice(0,4), top: reasons.length ? reasons[0].reason+' ('+reasons[0].qty+')' : null };
            } catch(e){ return { count:0, qty:0, value:0, items:[], top:null }; }
        },
        // خارطة تكلفة المخزون (id -> cost/costPrice) لاحتساب قيمة الهدر
        async inventoryCostMap(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return {};
            try {
                var inv = (await db.getAll('inventory'))||[];
                var map={};
                inv.forEach(function(i){ if(i && i.id!=null) map[i.id]=Number(i.cost||i.costPrice||0); });
                return map;
            } catch(e){ return {}; }
        },
        // اتجاه مصغّر لآخر n أيام بقراءة واحدة (سرعة بدل n استدعاءات)
        async salesTrendCompact(n){
            n = n||5;
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return [];
            try {
                var orders=(await db.getAll('orders'))||[];
                var refunds=(await db.getAll('refunds'))||[];
                var keys=[], i;
                for(i=n-1;i>=0;i--){ var dd=new Date(); dd.setDate(dd.getDate()-i); keys.push(dd.toISOString().slice(0,10)); }
                var byDay={};
                keys.forEach(function(k){ byDay[k]=0; });
                orders.forEach(function(o){ if(String(o.paymentStatus||'').toLowerCase()==='paid'){ var d=(o.createdAt||o.date||'').slice(0,10); if(byDay[d]!=null) byDay[d]+=Number(o.total||o.totalAmount||0); } });
                refunds.forEach(function(r){ var d=(r.createdAt||r.updatedAt||r.date||'').slice(0,10); if(byDay[d]!=null) byDay[d]-=Number(r.amount||0); });
                var trend=[];
                keys.forEach(function(k){ trend.push([k.slice(5), byDay[k]]); }); // MM-DD
                return trend;
            } catch(e){ return []; }
        },
        // لمحة التشغيل الموحّدة: هيكل صغير منظّم (Arrays بدل objects) يغذي Ollama والتقرير الاستباقي
        async efficiencySnapshot(){
            var db = window.LuccaDB && window.LuccaDB.db;
            if(!db) return null;
            var out={};
            try {
                var s=await this.salesToday();
                var e=await this.expensesToday();
                var pur=await this.purchasesTotal();
                var pay=await this.salesByPayment();
                var top=await this.productTotals();
                var low=[]; try{ low=await this.lowStockItems(); }catch(_e){}
                var w=await this.wasteToday();
                var emp=await this.employeesActive();
                var att=await this.attendanceToday();
                var shifts=await this.shiftsToday();
                var tables=await this.tablesNow();
                var open=await this.openOrdersCount();
                var trend=await this.salesTrendCompact(5);
                var now=new Date();
                out.date=today();
                out.time=('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2);
                var hh=now.getHours();
                out.period=(hh<12?'صباح':(hh<17?'ظهر':(hh<21?'مساء':'ليل')));
                out.sales={ today:Math.round(s.sales), orders:s.count, refunds:Math.round(s.refunds) };
                out.payments=(pay||[]).slice(0,3).map(function(x){ return [x.method, Math.round(x.value)]; });
                out.top=(top||[]).slice(0,3).map(function(x){ return [x.name, x.qty]; });
                out.profit={ net:Math.round(s.sales-e.total-pur), expenses:Math.round(e.total), purchases:Math.round(pur) };
                out.tables={ open:tables.length, ordersOpen:open };
                out.inventory={ count:low.length, items:low.slice(0,4).map(function(i){ return [i.name,i.qty,i.threshold]; }) };
                out.waste={ count:w.count, qty:w.qty, value:Math.round(w.value), top:w.top||'' };
                out.staff={ active:emp.length, attending:att.length, shifts:shifts.length };
                out.trend=trend||[];
            }catch(_e){}
            return out;
        },
        // البرومبت الإداري الاستباقي: يحوّل اللمحة الحية إلى تنبيهات مختصرة (قراءة-فقط) عند فتح الشيفت/طلب التقارير
        async proactiveBrief(){
            var sn = null;
            try { sn = await this.efficiencySnapshot(); } catch(_e){}
            if(!sn) return '⚠️ لا توجد بيانات حية لعرض التنبيهات الاستباقية.';
            var lines = ['🦇 **باتمان — رادار التشغيل** ('+sn.time+')'];
            var shown = 0;
            if(sn.inventory && sn.inventory.count > 0){
                var lv = ((sn.inventory.items||[]).map(function(it){ return it[0]+' ('+it[1]+')'; })).join('، ');
                lines.push('⚠️ مخزون منخفض: '+sn.inventory.count+' صنف'+(lv?' — '+lv:''));
                shown++;
            }
            if(sn.waste && sn.waste.value > 0){
                lines.push('🗑️ هدر اليوم: '+money(sn.waste.value)+' ل.س ('+sn.waste.qty+' وحدة)'+(sn.waste.top?' — السبب الأغلب: '+sn.waste.top:''));
                shown++;
            }
            if(sn.sales && sn.sales.orders === 0){
                lines.push('🔻 لا مبيعات مسجلة بعد اليوم.');
                shown++;
            }
            if(sn.profit && sn.profit.net < 0){
                lines.push('🔻 الربح اليوم سالب ('+money(sn.profit.net)+' ل.س) — راجع المصروفات/المرتجعات.');
                shown++;
            }
            if(sn.tables && sn.tables.ordersOpen > 3){
                lines.push('🕒 الطلبات المعلّقة: '+sn.tables.ordersOpen+' — راجع الدفع.');
                shown++;
            }
            if(sn.tables && sn.tables.open > 0){
                lines.push('🪑 '+sn.tables.open+' طاولة مفتوحة حالياً.');
            }
            if(shown === 0) lines.push('✅ كل المؤشرات ضمن الحدود الطبيعية.');
            return lines.join('\n');
        }
    };

    // ============ LIVE CONTEXT FOR OLLAMA ============
    async function buildContext(){
        // مسار سريع: لقطة موحّدة صغيرة (Arrays) بدل حقول متفرقة — سياق أصغر وأسرع لـ Ollama
        try {
            var sn = await BMRuntimeTools.efficiencySnapshot();
            if(sn) return JSON.stringify(sn);
        } catch(e){}
        // مسار احتياطي قديم يبقي السياق متاحاً لو فشلت اللقطة
        var ctx = {};
        try { ctx.summary = await BMRuntimeTools.summary(); } catch(e){ ctx.summary = null; }
        try { ctx.payment = await BMRuntimeTools.salesByPayment(); } catch(e){}
        try { ctx.top = await BMRuntimeTools.productTotals(); } catch(e){}
        try { ctx.year = await BMRuntimeTools.yearSales(); } catch(e){}
        try { ctx.expenses = await BMRuntimeTools.expensesToday(); } catch(e){}
        try { ctx.purchases = await BMRuntimeTools.purchasesTotal(); } catch(e){}
        try { ctx.inventoryLow = [{ count: await BMRuntimeTools.lowStockCount() }]; } catch(e){}
        try { ctx.employeesActive = (await BMRuntimeTools.employeesActive()).length; } catch(e){}
        try { ctx.attendanceToday = (await BMRuntimeTools.attendanceToday()).length; } catch(e){}
        return JSON.stringify(ctx);
    }

    // نبّذة سريعة آمنة للتنبيه الاستباقي (تُسبق التقارير وتبلغ عند فتح الشيفت)
    async function buildProactiveBrief(){
        try { return await BMRuntimeTools.proactiveBrief(); } catch(e){ return ''; }
    }

    // ===== OleamAI systematization =====
    // وضع quick: سياق صغير (2048)+ردّ قصير — للاستخدام المستمر/المراقبة (سريع ~4-8 ثانية)
    // وضع deep: سياق أكبر (4096)+تحليل أعمق — عند السؤال الإداري العميق (أبطأ لكن نادر)
    var SYS_MANAGER = 'أنت "باتمان"، المساعد الإداري الذكي لمطعم/مقهى لوكا (Lucca POS). تعمل محلياً دون إنترنت. ' +
        'ستحصل على بيانات حية حقيقية من قاعدة البيانات بصيغة JSON (مبيعات/مصروف/مشتريات/موظفين/طاولات/مخزون). ' +
        'أجب بالعربية باحترافية. استخدم الأرقام الحية حصرياً ولا تخترع أرقاماً أبداً. ' +
        'الربح = الإيرادات - المصروفات. عندما تطلب نصيحة إدارية، أعطِ خلاصة عملية واضحة. ' +
        'إذا لم تتوفر معلومة، قل ذلك بصراحة.';
    var SYS_MONITOR = 'أنت مراقب آلي لمقهى "لوكا". تفحص لقطة بيانات حية (JSON) وتصدر تقييماً مختصراً جداً. ' +
        'ردّك يجب أن يبدأ بحرف الإشارة: لو كل شيء طبيعي "C:"، لو يوجد خطر/إنذار "W:" ثم الخطر. ' +
        'ابدأ بجملة واحدة تذكر المبيعات والربح، ثم اسرد أبرز خطر (إن وجد) ثم إجراء واحد مقترح. ' +
        'لا تستعمل تنسيقات طويلة، رد ≤ 5 أسطر. لا تخترع أرقاماً.';

    // استدعاء Ollama مع وضع quick/deep: quick => ctx صغير + num_predict منخفض
    async function ollamaAnalyze(text, opts){
        opts = opts || {};
        var mode = opts.mode || _aiMode;
        var O = window.OllamaAI;
        if(!O) return { ok:false, local:false, text:null, reason:'no-ollama' };
        try {
            // بوابة موحّدة: Ollama أولاً (مجاني) أو OpenAI مرتّبة عند الحاجة
            var ready = (typeof O.llmReady === 'function') ? await O.llmReady() : await O.isAvailable();
            if(!ready) return { ok:false, local:true, text:null, reason:'unavailable' };
        } catch(e){ return { ok:false, local:true, text:null, reason:'unavailable' }; }
        try {
            var ctx = opts.context || await buildContext();
            var sys = opts.system || SYS_MANAGER;
            var user = (opts.snapshotOnly ? '' : 'بيانات حية من النظام:\n' + ctx + '\n\n') + (opts.fullPrompt || ('طلب:' + text));
            var chatOpts = { temperature: (opts.temperature!=null?opts.temperature:0.3), timeout: (mode==='quick'?40000:90000), numCtx: (mode==='quick'?2048:4096), keepAlive: -1 };
            // quick => حد أقصى لعدد المخرجات (num_predict) لتسريع الاستجابة
            // 7B يولّد ~4 توكن/ثانية: 70 توكن ≈ 18 ثانية للرد + حمل التقييم
            // المهلة 40 ثانية تتحمل توقفات النموذج العرضية دون تعطيل المراقبة (أبعد من 25s المرصودة)
            if(mode==='quick') chatOpts.numPredict = opts.numPredict || 70;
            var res = await O.chat(sys, user, chatOpts);
            if(res.ok && res.text) return { ok:true, local:(res.provider!=='openai'), text:res.text, mode:mode, provider:(res.provider||'ollama') };
            return { ok:false, local:true, text:null, error:(res && res.error) };
        } catch(e){
            return { ok:false, local:true, text:null, error:e.message };
        }
    }

    // لقطة مراقبة سريعة بسياق صغير — تُستدعى في الخلفية
    async function analyzeSnapshot(){
        // قيّد التزامن: لا تُشغّل فحصاً جديداً قبل انتهاء السابق
        if(_monitor.debounce) return null;
        _monitor.debounce = true;
        try {
            var sum = await BMRuntimeTools.summary();
            var low = [];
            try { low = await BMRuntimeTools.lowStockItems(); } catch(e){ low=[]; }
            var snapshot = 'مبيعات اليوم: '+sum.todaySales+' ل.س، فواتير مدفوعة: '+sum.todayOrders+
                '، مرتجعات: '+sum.todayRefunds+'، مصروف: '+sum.todayExpenses+'، مشتريات: '+sum.todayPurchases+
                '، طاولات مفتوحة: '+sum.openTables+'، طلبات مفتوحة: '+sum.openOrders+
                '، موظفون نشطون: '+sum.activeEmployees+'، الربح المحسوب: '+sum.profit+' ل.س'+
                '، أصناف مخزون منخفضة: '+low.length+'.';
            checkInventoryAlerts(low, sum);
            var r = await ollamaAnalyze('', { mode:'quick', snapshotOnly:true, context:snapshot, system:SYS_MONITOR, fullPrompt:snapshot, numPredict:70 });
            if(r && r.ok && r.text){
                _monitor.lastAnalysis = { time: Date.now(), text: r.text, summary: sum };
                _monitor.checks++;
                recordAlertFromAnalysis(r.text, sum);
                return r.text;
            }
            return null;
        } catch(e){
            return null;
        } finally {
            _monitor.debounce = false;
        }
    }

    // إنذار مخزون فعلي: أصناف حقيقية تحت الحد + إشعار + صوت (مع منع التكرار)
    function checkInventoryAlerts(low, sum){
        if(!low || !low.length) return;
        var names = low.slice(0,4).map(function(i){ return i.name + ' ('+i.qty+')'; }).join('، ');
        if(low.length>4) names += '… وغيرها '+(low.length-4)+' صنف';
        var text = 'W: مخزون منخفض: '+names+'. يُفضَّل إعادة التجهيز.';
        _monitor.alerts.unshift({ time: Date.now(), level: 'warn', text: text.slice(0,220), summary: sum });
        if(_monitor.alerts.length > 30) _monitor.alerts.pop();
        notify('🦇 باتمان — إنذار مخزون', text.replace(/^W:\s*/,''));
        speak('تنبيه من باتمان: '+text.replace(/^W:\s*/,'').slice(0,200));
    }

    // تقرير إقفال اليوم (أرقام حقيقية محلية) — يُدعى عند تغيّر اليوم
    async function closingSummaryFor(dateStr){
        var s = await BMRuntimeTools.salesOn(dateStr);
        var e = await BMRuntimeTools.expensesOn(dateStr);
        var pur = await BMRuntimeTools.purchasesOn(dateStr);
        var low = [];
        try { low = await BMRuntimeTools.lowStockItems(); } catch(e){}
        var lines = [];
        lines.push('🔒 **تقرير إقفال اليوم '+(dateStr||today())+'**');
        lines.push('· صافي المبيعات: **'+money(s.sales)+' ل.س** ('+s.count+' فاتورة)');
        lines.push('· المصروفات: '+money(e.total)+' — المشتريات: '+money(pur));
        lines.push('· صافي الربح (تقديري): **'+money(s.sales - e.total - pur)+' ل.س**');
        if(low.length) lines.push('⚠️ مخزون منخفض: '+low.slice(0,4).map(function(i){return i.name+' ('+i.qty+')';}).join('، '));
        else lines.push('✅ المخزون ضمن الحدود.');
        return lines.join('\n');
    }
    // ملخص الإقفال التلقائي: يُنفَّذ مرة واحدة كل يوم عند بدء المراقبة
    async function autoClosingCheck(){
        var last = kGet('luccaBatmanClosingDay') || '';
        var t = today();
        if(last && last !== t){
            var y = new Date(); y.setDate(y.getDate()-1);
            var prev = y.toISOString().slice(0,10);
            try {
                var txt = await closingSummaryFor(prev);
                if(txt){
                    pushClosing(txt);
                    notify('🦇 باتمان — إقفال اليوم', 'اكتمل ملخص إقفال '+prev);
                    speak('اكتمل تقرير إقفال أمس');
                }
            } catch(e){}
        }
        kSet('luccaBatmanClosingDay', t);
    }

    // تحويل نص المراقبة إلى إنذارات مثبتة محلياً دون كتابة في الداتابيز
    function recordAlertFromAnalysis(text, sum){
        if(!text) return;
        var sev = text.charAt(0).toUpperCase();
        var level = (sev==='W') ? 'warn' : 'ok';
        var msg = text.replace(/^\s*[CW]:\s*/i, '').trim() || text;
        _monitor.alerts.unshift({ time: Date.now(), level: level, text: msg.slice(0,220), summary: sum });
        if(_monitor.alerts.length > 30) _monitor.alerts.pop();
        if(level==='warn'){
            notify('🦇 باتمان — تنبيه', msg.slice(0,140));
            speak('تنبيه من باتمان: '+msg.slice(0,180));
        }
    }

    // ================== CONTINUOUS MONITOR LOOP ==================
    // إحماء النموذج قبل أول فحص: أول طلب بعد إقلاع Ollama يكون باردا (تحميل النموذج)
    // وقد يتجاوز مهلة quick. نرسل طلباً تدفئة صغيراً دون مهلة قصيرة ليُحمَّل النموذج مرة واحدة.
    function warmupOllama(){
        var O = window.OllamaAI;
        if(!O || !O.isEnabled()) return Promise.resolve(); // لا إحماء لو Ollama معطّل
        var mode = (typeof O.getProviderMode === 'function') ? O.getProviderMode() : 'auto';
        if(mode === 'openai') return Promise.resolve();    // لا حاجة لإحماء في وضع السحابة فقط
        return O.chat('', 'مرحبا', { numPredict: 1, timeout: 180000, keepAlive: -1, numCtx: 2048 })
            .catch(function(){ /* غير حرج: لنحاول الفحص بحالة باردة */ });
    }
    function monitorLoop(warmup){
        if(!_monitor.running) return;
        _monitor.lastRun = new Date();
        _monitor.monitoringStarted = true;
        // ننتظر الإحماء قبل أول فحص فقط
        Promise.resolve(warmup).then(function(){
            if(!_monitor.running) return;
            return Promise.all([ analyzeSnapshot(), autoClosingCheck() ]);
        }).then(function(){
            // جدولة الفحص التالي فقط بعد الانتهاء (لا تكديس)
            if(_monitor.running) _monitor.timer = setTimeout(monitorLoop, _monitor.intervalMs);
        });
    }
    function startMonitor(intervalMs){
        if(_monitor.running && _monitor.timer) return _monitor.running;
        _monitor.intervalMs = intervalMs || _monitor.intervalMs;
        _monitor.running = true;
        kSet('luccaBatmanMonitor','1');
        _monitor.lastRun = new Date();
        // أول فحص فوراً، ثم دورياً
        monitorLoop(_monitor.monitoringStarted ? undefined : warmupOllama());
        refreshFabStatus();
        return true;
    }
    function stopMonitor(){
        _monitor.running = false;
        if(_monitor.timer){ clearTimeout(_monitor.timer); _monitor.timer = null; }
        kSet('luccaBatmanMonitor','0');
        refreshFabStatus();
        return false;
    }
    function toggleMonitor(){
        return _monitor.running ? stopMonitor() : startMonitor();
    }
    function refreshFabStatus(){
        var fab = document.getElementById('bd-fab');
        if(fab){ fab.classList.toggle('monitoring', _monitor.running); }
    }

    // اختصار: هل المراقبة مفعّلة
    function monitorState(){
        return { running:_monitor.running, intervalMs:_monitor.intervalMs, lastRun:_monitor.lastRun, checks:_monitor.checks, alerts:_monitor.alerts, lastAnalysis:_monitor.lastAnalysis, enabled:_monitorEnabled };
    }

    // ============ SMART REPORTS (محلية، أرقام حقيقية) ============
    var REPORTS = {
        daily: {
            emoji:'📊', t:'تقرير المبيعات اليومي', d:'مبيعات اليوم صافي + حسب وسيلة الدفع + المنتجات الأكثر مبيعاً',
            run: async function(){
                var s = await BMRuntimeTools.salesToday();
                var pay = await BMRuntimeTools.salesByPayment();
                var top = await BMRuntimeTools.productTotals();
                var lines = [];
                lines.push('📊 **تقرير المبيعات اليوم** ('+today()+')');
                lines.push('· صافي المبيعات: **'+money(s.sales)+' ل.س**');
                lines.push('· الإجمالي: '+money(s.gross)+' — المرتجعات: '+money(s.refunds));
                lines.push('· عدد الفواتير المدفوعة: '+s.count);
                if(pay.length){ lines.push('\n**حسب وسيلة الدفع:**'); pay.forEach(function(x){ lines.push('· '+x.method+': '+money(x.value)+' ل.س'); }); }
                if(top.length){ lines.push('\n**المنتجات الأكثر مبيعاً:**'); top.forEach(function(x,i){ lines.push((i+1)+'. '+x.name+' — '+x.qty+' قطعة'); }); }
                return lines.join('\n');
            }
        },
        profit: {
            emoji:'💰', t:'تقرير الربح اليوم', d:'الربح = المبيعات - المصروفات - المشتريات',
            run: async function(){
                var s = await BMRuntimeTools.salesToday();
                var e = await BMRuntimeTools.expensesToday();
                var pur = await BMRuntimeTools.purchasesTotal();
                var lines = [];
                lines.push('💰 **تقرير الربح اليوم** ('+today()+')');
                lines.push('· الإيرادات (صافي المبيعات): **'+money(s.sales)+' ل.س**');
                lines.push('· المصروفات: '+money(e.total)+' ل.س ('+e.count+' حركة)');
                lines.push('· المشتريات: '+money(pur)+' ل.س');
                lines.push('\n· **صافي الربح (محسوب):** '+money(s.sales - e.total - pur)+' ل.س');
                lines.push('\n<sub>الربح تقديري يعتمد على البيانات المسجلة فقط.</sub>');
                return lines.join('\n');
            }
        },
        tables: {
            emoji:'🪑', t:'الطاولات المفتوحة حالياً', d:'عدد وحالة الطاولات المفتوحة + الطلبات المفتوحة',
            run: async function(){
                var tables = await BMRuntimeTools.tablesNow();
                var open = await BMRuntimeTools.openOrdersCount();
                var lines = [];
                lines.push('🪑 **الطاولات المفتوحة** الآن: '+tables.length);
                lines.push('· طلبات مفتوحة (غير مغلقة): '+open);
                if(tables.length){
                    lines.push('\n**القائمة:**');
                    tables.forEach(function(t){ var n=t.number||t.name||t.id||'?'; lines.push('· ترابيزة '+n+' — '+(t.status||'occupied')); });
                } else {
                    lines.push('لا توجد طاولات مفتوحة حالياً. ✅');
                }
                return lines.join('\n');
            }
        },
        employees: {
            emoji:'👥', t:'تقرير الموظفين والحضور', d:'الموظفون النشطون + حضور وانصراف اليوم',
            run: async function(){
                var emp = await BMRuntimeTools.employeesActive();
                var att = await BMRuntimeTools.attendanceToday();
                var sh = await BMRuntimeTools.shiftsToday();
                var lines = [];
                lines.push('👥 **الموظفون والحضور** ('+today()+')');
                lines.push('· الموظفون النشطون: '+emp.length);
                lines.push('· سجلات حضور اليوم: '+att.length);
                lines.push('· الورديات اليوم: '+sh.length);
                if(emp.length){ lines.push('\n**الموظفون:**'); emp.forEach(function(e){ lines.push('· '+(e.name||e.fullName||'موظف')+(e.role?' — '+e.role:'')); }); }
                return lines.join('\n');
            }
        },
        expenses: {
            emoji:'🧾', t:'تقرير المصروفات اليوم', d:'إجمالي مصروفات اليوم وعدد الحركات',
            run: async function(){
                var e = await BMRuntimeTools.expensesToday();
                var lines = [];
                lines.push('🧾 **مصروفات اليوم** ('+today()+')');
                lines.push('· إجمالي المصروفات: **'+money(e.total)+' ل.س**');
                lines.push('· عدد الحركات: '+e.count);
                return lines.join('\n');
            }
        },
        year: {
            emoji:'🗓️', t:'ملخص السنة', d:'إجمالي مبيعات العام (صافي) والمرتجعات',
            run: async function(){
                var y = await BMRuntimeTools.yearSales();
                var lines = [];
                lines.push('🗓️ **ملخص المبيعات لهذا العام**');
                lines.push('· صافي المبيعات: **'+money(y.sales)+' ل.س**');
                lines.push('· الإجمالي: '+money(y.gross)+' — المرتجعات: '+money(y.refunds));
                lines.push('· الفواتير المدفوعة: '+y.count);
                return lines.join('\n');
            }
        },
        health: {
            emoji:'🩺', t:'فحص سلامة النظام', d:'فحص Ollama + قاعدة البيانات + محرك باتمان',
            run: async function(){
                var H = await buildHealth();
                var lines = [];
                lines.push('🩺 **فحص سلامة النظام**');
                lines.push('· Ollama: '+ (H.ollama ? 'متصّل ✓' : 'غير متصل ✗'));
                if(H.model) lines.push('· النموذج: '+H.model);
                lines.push('· محرك باتمان: '+ (H.engine ? 'نشط ✓' : 'غير محمّل ✗'));
                lines.push('· قاعدة البيانات: '+ (H.db ? 'متاحة ✓' : 'غير متاحة ✗'));
                if(H.uptime) lines.push('· مدة التشغيل: '+H.uptime);
                if(H.lastError) lines.push('\n· آخر خطأ: '+H.lastError);
                return lines.join('\n');
            }
        },
        compare: {
            emoji:'🆚', t:'مقارنة اليوم مع الأمس', d:'مبيعات/ربح اليوم مقابل الأمس مع نسبة التغيّر',
            run: async function(){
                var p = today(); var y = new Date(); y.setDate(y.getDate()-1);
                var py = y.toISOString().slice(0,10);
                var s1 = await BMRuntimeTools.salesOn(p);
                var s2 = await BMRuntimeTools.salesOn(py);
                var e1 = await BMRuntimeTools.expensesOn(p); var e2 = await BMRuntimeTools.expensesOn(py);
                var pr1 = await BMRuntimeTools.purchasesOn(p); var pr2 = await BMRuntimeTools.purchasesOn(py);
                var pct = function(cur, prev){
                    if(prev<=0) return cur>0 ? 'جديد' : '—';
                    var d = ((cur-prev)/prev)*100;
                    return (d>=0?'▲ +':'▼ ')+d.toFixed(1)+'%';
                };
                return [
                    '🆚 **مقارنة اليوم مع الأمس**',
                    '· اليوم ('+p+'): صافي **'+money(s1.sales)+' ل.س**، مصروف '+money(e1.total)+'، مشتريات '+money(pr1)+'، ربح '+money(s1.sales-e1.total-pr1),
                    '· الأمس ('+py+'): صافي **'+money(s2.sales)+' ل.س**، مصروف '+money(e2.total)+'، مشتريات '+money(pr2)+'، ربح '+money(s2.sales-e2.total-pr2),
                    '\n· تغيّر المبيعات: '+pct(s1.sales, s2.sales),
                    '· تغيّر المصروفات: '+pct(e1.total, e2.total),
                    '· عدد الفواتير: اليوم '+s1.count+' مقابل '+s2.count+' بالأمس'
                ].join('\n');
            }
        },
        trend: {
            emoji:'📈', t:'اتجاه آخر 7 أيام', d:'مبيعات كل يوم من آخر أسبوع وأفضل يوم',
            run: async function(){
                var tr = await BMRuntimeTools.salesTrend(7);
                var lines = ['📈 **اتجاه المبيعات — آخر 7 أيام**'];
                tr.forEach(function(d){
                    lines.push('· '+d.date+': **'+money(d.sales)+' ل.س** ('+d.count+' فاتورة)');
                });
                var best = tr.reduce(function(a,b){ return (b.sales>a.sales)?b:a; }, {sales:-1});
                if(best.sales>=0) lines.push('\n· 🏆 أفضل يوم: '+best.date+' — '+money(best.sales)+' ل.س');
                var tot = tr.reduce(function(s,d){return s+d.sales;},0);
                lines.push('· مجموع الأسبوع: '+money(tot)+' ل.س');
                return lines.join('\n');
            }
        },
        peak: {
            emoji:'⏱️', t:'ساعات الذروة اليوم', d:'أكثر أوقات اليوم ازدحاماً بالفواتير',
            run: async function(){
                var ph = await BMRuntimeTools.peakHoursOn(today());
                var lines = ['⏱️ **ساعات الذروة — اليوم ('+today()+')**'];
                if(!ph.length){ lines.push('لا توجد فواتير مسجلة اليوم بعد.'); return lines.join('\n'); }
                ph.forEach(function(x,i){
                    var lbl = String(x.hour).padStart(2,'0')+':00';
                    lines.push((i+1)+'. '+lbl+' — '+x.count+' فاتورة');
                });
                lines.push('\n<sub>بناءً على توقيت إنشاء الفواتير المدفوعة النهائية داخل النظام.</sub>');
                return lines.join('\n');
            }
        },
        closing: {
            emoji:'🔒', t:'تقرير إقفال اليوم', d:'ملخص إقفال شامل: مبيعات/مصروف/مشتريات/ربح/مخزون',
            run: async function(){
                var t = today();
                var txt = await closingSummaryFor(t);
                pushClosing(txt);
                return txt;
            }
        }
    };

    // ============ HEALTH MONITOR ============
    async function buildHealth(){
        var h = { ollama:false, openai:false, model:null, engine:false, db:false, uptime:null, lastError: _health.lastError };
        var O = window.OllamaAI;
        if(O){
            try { h.ollama = await O.isAvailable(); } catch(e){}
            try { h.openai = (typeof O.hasOpenAI==='function') ? O.hasOpenAI() : false; } catch(e){}
            if(h.ollama){ try { var m = await O.listModels(); h.model = (m&&m[0])||O.model||null; } catch(e){} }
        }
        h.engine = !!(window.aiPosEngine);
        try { h.db = (await BMRuntimeTools.dbStatus()).ok; } catch(e){ h.db=false; }
        var sec = Math.floor((Date.now()-_startTime)/1000);
        h.uptime = (sec>=3600 ? Math.floor(sec/3600)+'س ' : '') + Math.floor((sec%3600)/60)+' د';
        _health.ollama = h.ollama; _health.model = h.model; _health.engine = h.engine; _health.db = h.db;
        return h;
    }

    // ============ UI RENDERING ============
    function renderStatus(){
        return Promise.resolve().then(buildHealth).then(function(h){
            return '<h2 class="bd-h2">🩺 الحالة العامة</h2>'+
            '<div class="bd-status-line">'+
            chip('Ollama', h.ollama?'متصل':'غير متصل', h.ollama?'on':'off')+
            chip('OpenAI', h.openai?'مضبوط':'غير مضبوط', h.openai?'on':'idle')+
            chip('النموذج', h.model||'—', h.model?'on':'idle')+
            chip('محرك باتمان', h.engine?'نشط':'معطّل', h.engine?'on':'off')+
            chip('قاعدة البيانات', h.db?'متاحة':'غير متاحة', h.db?'on':'off')+
            '</div>'+
            '<div class="bd-cards">'+
            statCard('المدة', h.uptime, 'منذ الفتح')+
            statCard('آخر خطأ', h.lastError?h.lastError:'لا توجد', null)+
            '</div>'+
            '<div class="bd-note">لوحة باتمان: كل التقارير للقراءة فقط وتُقرأ من قاعدة البيانات مباشرة دون تعديل. '+
            'الاستثناء الوحيد: رسالة كتابة منك مثل «سجل مصروف 500 مواصلات» تُحفظ فعلياً في قاعدة البيانات بعد التحقق من المبلغ والوصف، ولا يُقال «تم» إلا بعد نجاح الحفظ.</div>';
        });
    }

    function chip(label, val, state){
        var dot = state==='on' ? 'bd-dot on' : (state==='off' ? 'bd-dot off' : 'bd-dot idle');
        return '<div class="bd-status-chip"><span class="'+dot+'"></span><b>'+label+'</b> '+val+'</div>';
    }
    function statCard(k, v, s){
        return '<div class="bd-card"><div class="k">'+k+'</div><div class="v">'+v+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>';
    }

    function renderReports(){
        var html = '<h2 class="bd-h2">📈 التقارير الذكية</h2><div class="bd-reports">';
        Object.keys(REPORTS).forEach(function(key){
            var r = REPORTS[key];
            html += '<div class="bd-report" onclick="BatmanDashboard.runReport(\''+key+'\')">'+
                '<div class="emoji">'+r.emoji+'</div><div class="t">'+r.t+'</div><div class="d">'+r.d+'</div></div>';
        });
        html += '</div>';
        return html;
    }

    function renderChat(){
        var html = '<h2 class="bd-h2">💬 محادثة باتمان (تحليل بالأرقام الحية)</h2>'+
            '<div class="bd-chat"><div id="bd-log"></div>'+
            '<div id="bd-chat-inputrow"><input id="bd-chat-in" placeholder="اسأل عن المبيعات/الربح/الموظفين/المخزون... أو «سجل مصروف 500 مواصلات» لتسجيله" '+
            'onkeydown="if(event.key===\'Enter\')BatmanDashboard.sendChat()">'+
            '<button id="bd-chat-send" onclick="BatmanDashboard.sendChat()">➤</button></div></div>';
        return html;
    }

    function renderMonitor(){
        var m = monitorState();
        var last = m.lastAnalysis;
        var chips = [
            chip('المراقبة', m.running?'نشطة':'متوقفة', m.running?'on':'off'),
            chip('الدورة', (m.intervalMs/1000)+' ث', 'on'),
            chip('الفحوصات', String(m.checks), 'idle'),
            chip('الصوت', _voiceEnabled?'مفعّل 🔊':'متوقف 🔇', _voiceEnabled?'on':'idle')
        ].join('');
        var alertsHtml = '';
        if(m.alerts.length){
            alertsHtml = '<h3 class="bd-h2">🔔 آخر إنذارات المساعد</h3><div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
            m.alerts.slice(0,6).forEach(function(a){
                var lvl = a.level==='warn' ? 'warn' : 'ok';
                alertsHtml += '<div style="background:var(--bd-dark);border:1px solid var(--bd-border);border-radius:10px;padding:10px 12px;">'+
                    '<span class="bd-pill '+lvl+'">'+(lvl==='warn'?'⚠️ إنذار':'✅ طبيعي')+'</span> '+
                    '<span style="color:var(--bd-text);font-size:.78rem;">'+escHtml(a.text)+'</span>'+
                    '<div style="color:var(--bd-text-dim);font-size:.65rem;margin-top:4px;">'+new Date(a.time).toLocaleTimeString('ar-EG')+'</div></div>';
            });
            alertsHtml += '</div>';
        } else {
            alertsHtml = '<div class="bd-note">لا توجد إنذارات بعد. فعّل المراقبة ليصدر باتمان تنبيهات واقتراحات دورياً.</div>';
        }
        var analysisHtml = '';
        if(last && last.text){
            analysisHtml = '<h3 class="bd-h2">🧠 آخر تحليل للمساعد</h3>'+
                '<div style="background:var(--bd-dark);border:1px solid var(--bd-accent-dim);border-radius:10px;padding:12px 14px;">'+
                '<div style="color:var(--bd-text);font-size:.8rem;white-space:pre-wrap;">'+escHtml(last.text)+'</div>'+
                '<div style="color:var(--bd-text-dim);font-size:.65rem;margin-top:6px;">'+new Date(last.time).toLocaleString('ar-EG')+'</div></div>';
        }
        var btn = '<button class="ai-action-btn" style="padding:9px 20px;font-size:.85rem;margin-bottom:16px;" '+
            'onclick="BatmanDashboard.toggleMonitor()">'+(m.running?'⏸ إيقاف المراقبة':'▶ تشغيل المراقبة')+'</button>';
        var vbtn = '<button class="ai-action-btn" style="padding:9px 20px;font-size:.85rem;margin-bottom:16px;" '+
            'onclick="BatmanDashboard.toggleVoice()">'+( _voiceEnabled ? '🔊 إيقاف الصوت' : '🔇 تفعيل الصوت')+'</button>';
        var closingsHtml = '';
        if(_closings.length){
            closingsHtml = '<h3 class="bd-h2">🔒 سجل الإقفالات اليومية</h3><div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
            _closings.slice(0,4).forEach(function(c){
                closingsHtml += '<div style="background:var(--bd-dark);border:1px solid var(--bd-border);border-radius:10px;padding:10px 12px;">'+
                    '<div style="color:var(--bd-text);font-size:.75rem;white-space:pre-wrap;">'+escHtml(c.text)+'</div>'+
                    '<div style="color:var(--bd-text-dim);font-size:.65rem;margin-top:4px;">'+c.date+' — '+new Date(c.time).toLocaleTimeString('ar-EG')+'</div></div>';
            });
            closingsHtml += '</div>';
        }
        return '<h2 class="bd-h2">🛡️ المراقبة الذاتية المستمرة</h2>'+
            '<div class="bd-status-line">'+chips+'</div>'+
            '<p class="bd-note">باتمان يفحص بياناتك الحية في الخلفية كل فترة، ويحوّلها لإنذارات واقتراحات إدارية. '+
            'يتوقف تلقائياً لو Ollama غير متاح، وكل شيء قراءة-فقط (لا يعدّل بيانات). عند تغيّر اليوم يُحرَّر تقرير إقفال تلقائي.</p>'+
            btn + vbtn + alertsHtml + analysisHtml + closingsHtml;
    }

    function escHtml(s){
        return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ============ ROOT DOM BUILD ============
    function buildDom(){
        if(document.getElementById('bd-root')) return document.getElementById('bd-root');
        var root = el('<div id="bd-root"><div id="bd-overlay" onclick="BatmanDashboard.close()"></div>'+
            '<div id="bd-panel"><div id="bd-head">'+
            '<div class="bd-badge">🦇</div>'+
            '<div class="bd-title"><b>BATMAN AI</b><span>لوحة التحكم الذكية — محلل القراءة فقط</span></div>'+
            '<button id="bd-x" onclick="BatmanDashboard.close()">✕</button></div>'+
            '<div id="bd-body"><div id="bd-side"></div><div id="bd-main"><div id="bd-main-content"></div></div></div>'+
            '</div></div>');
        document.body.appendChild(root);
        var nav = [['status','🩺','الحالة'],['monitor','🛡️','المراقبة'],['reports','📈','التقارير'],['chat','💬','المحادثة']];
        var side = document.getElementById('bd-side');
        nav.forEach(function(n){
            var b = el('<button class="bd-nav" data-tab="'+n[0]+'"><span>'+n[1]+'</span>'+n[2]+'</button>');
            b.onclick = function(){ switchTab(n[0]); };
            side.appendChild(b);
        });
        return root;
    }

    function switchTab(tab){
        _currentTab = tab;
        var navs = document.querySelectorAll('#bd-side .bd-nav');
        navs.forEach(function(n){ n.classList.toggle('bd-active', n.getAttribute('data-tab')===tab); });
        var content = document.getElementById('bd-main-content');
        if(tab==='status'){ renderStatus().then(function(h){ content.innerHTML = h; }); }
        else if(tab==='monitor'){ content.innerHTML = renderMonitor(); }
        else if(tab==='reports'){ content.innerHTML = renderReports(); }
        else if(tab==='chat'){ content.innerHTML = renderChat(); restoreChat(); }
    }

    function open(){
        var root = buildDom();
        root.classList.add('bd-open');
        _open = true;
        switchTab(_currentTab);
        buildHealth();
    }

    function close(){
        var root = document.getElementById('bd-root');
        _open = false;
        if(root) root.classList.remove('bd-open');
    }
    function toggle(){ _open ? close() : open(); }

    // ============ CHAT ============
    function logMsg(text, type){
        var log = document.getElementById('bd-log');
        if(!log) return;
        var m = el('<div class="bd-log-msg bd-'+type+'"></div>');
        if(type==='user') m.textContent = text;
        else m.innerHTML = text.replace(/\n/g,'<br>');
        log.appendChild(m);
        log.scrollTop = log.scrollHeight;
        _chatLog.push({text:text, type:type});
    }
    function restoreChat(){
        var log = document.getElementById('bd-log');
        if(!log) return;
        log.innerHTML = '';
        if(!_chatLog.length){
            logMsg('🧠 باتمان المحلل جاهز. اسأل عن أي مؤشر (مبيعات/ربح/مصروف/موظفين/طاولات) وسأجيب بالأرقام الحية. '+
                   'ولتسجيل مصروف فعلياً اكتب: «سجل مصروف <المبلغ> <الوصف>» — سأحفظه في قاعدة البيانات بعد التحقق.', 'bot');
        } else {
            _chatLog.forEach(function(m){ 
                var mm = el('<div class="bd-log-msg bd-'+m.type+'"></div>');
                if(m.type==='user') mm.textContent = m.text; else mm.innerHTML = m.text.replace(/\n/g,'<br>');
                log.appendChild(mm); log.scrollTop = log.scrollHeight;
            });
        }
    }
    function addTyping(){
        var log = document.getElementById('bd-log');
        if(!log) return;
        var m = el('<div class="bd-log-msg bd-sys">🤔 باتمان يحلّل...</div>');
        m.id = 'bd-typing';
        log.appendChild(m); log.scrollTop = log.scrollHeight;
    }
    function removeTyping(){
        var t = document.getElementById('bd-typing');
        if(t) t.remove();
    }

    // ============ EXPORT (نسخ/حفظ محلي) ============
    // نسخ نص إلى الحافظة (ينجح داخل Electron والمتصفح)
    function copyReport(text){
        try {
            if(navigator.clipboard && navigator.clipboard.writeText){
                return navigator.clipboard.writeText(text||'').then(function(){ return true; }).catch(function(){ return legacyCopy(text); });
            }
        } catch(e){}
        return Promise.resolve(legacyCopy(text));
    }
    function legacyCopy(text){
        try {
            var ta = document.createElement('textarea');
            ta.value = text||'';
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch(e){ return false; }
    }
    // حفظ نص كملف نصي محلي (بدون إنترنت — يفتح حوار Save في الواجهة)
    function saveReportFile(text, name){
        return new Promise(function(resolve){
            try {
                var blob = new Blob([text||''], { type:'text/plain;charset=utf-8' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = (name||'lucca-batman-'+today()+'.txt');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function(){ URL.revokeObjectURL(url); resolve(true); }, 400);
            } catch(e){ resolve(false); }
        });
    }
    // إلحاق أزرار تصدير أسفل رد التقرير
    function exportButtons(key, text){
        var k = String(key||'report').replace(/[^a-zA-Z0-9]/g,'');
        return '<div style="display:flex;gap:8px;margin-top:10px;">'+
            '<button class="ai-action-btn" style="padding:6px 14px;font-size:.72rem;" onclick="BatmanDashboard.exportAction(\''+k+'\',\'copy\')">📋 نسخ</button>'+
            '<button class="ai-action-btn" style="padding:6px 14px;font-size:.72rem;" onclick="BatmanDashboard.exportAction(\''+k+'\',\'save\')">💾 حفظ ملف</button></div>';
    }
    var _exportStore = {}; // {key: text}
    async function exportAction(key, mode){
        var text = _exportStore[key];
        if(!text) return;
        if(mode==='copy'){
            var ok = await copyReport(text);
            logMsg(ok ? '📋 تم نسخ التقرير إلى الحافظة.' : '⚠️ تعذّر النسخ.', 'sys');
        } else {
            var s = await saveReportFile(text);
            logMsg(s ? '💾 بدأ الحفظ — اختر الموقع في نافذة الحفظ.' : '⚠️ تعذّر الحفظ.', 'sys');
        }
    }

    // ============ FALLBACK الذكي: إلغاء «مش عارف» نهائياً ============
    // كلمات غير معمَّمة تُستبعد عند بناء استعلام المعرفة
    var _STOP = /^(كم|كمي|ما|هو|هي|هل|عن|من|في|مع|على|متى|أين|اين|فين|شو|مين|ليه|ازاي|كيف|بخصوص|حول|معلومات|أريد|اريد|عايز|أنا|انا|أنت|لل|لي|دلوقت|بس)$/i;
    function _sigWords(text){
        return String(text||'').split(/\s+/).filter(function(w){ return w.length > 1 && !_STOP.test(w); });
    }
    // استرجاع معرفة بقناتين: النص كاملاً، ثم كلمات مفتاحية قصيرة، ثم استعلام موجّه لأسئلة الكافيه
    async function knowledgeRetrieveSmart(text){
        var K = window.LuccaKnowledge;
        if(!K || !K.retrieve) return { ok:false, context:'', sources:[], count:0 };
        var attempt = function(q){ return K.retrieve(q); };
        try { var r0 = await attempt(text); if(r0 && r0.ok && r0.count > 0) return r0; } catch(e){}
        var words = _sigWords(text);
        if(words.length > 1){
            try { var r1 = await attempt(words.slice(0,3).join(' ')); if(r1 && r1.ok && r1.count > 0) return r1; } catch(e){}
        }
        // أي سؤال عن كافيه لوكا: RAG مرجع أخير باستعلام موجّه قبل أي جواب سالب
        if(isCafeQuery(text)){
            try { var rc = await attempt('كافيه لوكا Lucca العنوان ساعات العمل مواعيد الإغلاق'); if(rc && rc.ok && rc.count > 0) return rc; } catch(e){}
        }
        return { ok:false, context:'', sources:[], count:0 };
    }
    // هل السؤال عن كافيه لوكا/بياناته؟
    function isCafeQuery(text){
        return /(كافيه|كفي|caffe|cafe|لوكا|lucca|عنوان|الموقع|فروع|فرع|مواعيد|ساعات العمل|ساعات|شغال|مفتوح|افتتاح|تليفون|هاتف|اتصال|تواصل|بورسعيد)/i.test(text||'');
    }
    // معلومات الكافيه الموثقة (تُقرأ من بيانات النظام — لا يُخترع رقم)
    function cafeInfoText(){
        return '☕ **معلومات كافيه لوكا:**\n' +
            '· الاسم: Lucca Caffè\n' +
            '· العنوان: بورسعيد — شارع محمد علي\n' +
            '· الهاتف: 01010058989\n' +
            '· ساعات العمل: تُستخرج حياً من الورديات/ساعات الذروة في التقارير — لا أخترع مواعيد غير مسجلة.';
    }
    // كشف الرد المتهرب من النموذج (مثل «مش عارف») لاعتباره جواباً ناقصاً تُستكمل السياسة بديلاً عنه
    function isDodgeReply(t){
        var head = String(t||'').replace(/\*\*/g,'').slice(0,160);
        return /(مش عارف|لا أعرف|لا اعرف|لا أعلم|لا يعرف|لا معلومات|غير متوفر|لا تتوفر معلومات|لا يوجد معلومات|ما عندي|ماعندي|لا استطيع|لا أستطيع|لا يمكنني|أسأل|اسأل بطريقة)/i.test(head);
    }
    // الرد الأخير الاستباقي: بيان القدرات بدل جواب سالب
    function proactiveFallback(text){
        var lines = ['🔎 لم أجد تطابقاً مباشراً في أوردرات/سجلات اليوم، لكن إليك ما يمكنني فعله الآن:'];
        lines.push('· 📊 بالأرقام الحية: المبيعات، الربح، المصروفات، المشتريات، الطاولات، الموظفين، المخزون، الحضور، مقارنة اليوم بالأمس.');
        lines.push('· 📚 أو من المعرفة الإدارية: مصطلحات محاسبية، تكلفة الطعام (Food Cost)، نقاط التعادل، سياسة المصروفات، إدارة المخزون والهدر.');
        if(isCafeQuery(text)) lines.push('\n' + cafeInfoText());
        lines.push('\n💡 جرّب صياغة أدق مثل: «كم مبيعات اليوم؟» / «ساعات عمل لوكا؟» / «إيه هو prime cost؟»');
        return lines.join('\n');
    }

    // حاول أولاً تحليلاً محلياً سريعاً للمؤشرات المعروفة؛ وإلا أرسل السؤال الإداري لـ Ollama (وضع deep).
    async function sendChat(){
        var input = document.getElementById('bd-chat-in');
        if(!input) return;
        var text = input.value.trim();
        if(!text) return;
        input.value = '';
        logMsg(text, 'user');
        addTyping();
        // طلبات الكتابة (تسجيل مصروف) تُنفَّذ فعلياً عبر الحارس الموحَّد قبل أي تحليل قراءة-فقط.
        // لا يعرض باتمان نجاحاً إلا بعد تأكيد الحفظ في قاعدة البيانات، ويسأل عن المبلغ/الوصف الناقصين.
        if(window.saveExpenseFromText && /(سجلت|سجّل|سجّلت|سجل|تسجيل|اضف|أضف|إضافة|عملية|عندي|هناك|اصرف|خصم)/i.test(text) &&
           /(مصروف|صرفية|صرف|هدر|مواد|مواصلات|صيانة|نظافة|كهرباء|ماء|غاز|إيجار|أجرة|نثريات|نثريا|رواتب)/i.test(text)){
            var er = await window.saveExpenseFromText(text);
            if(er && er.ok){
                removeTyping();
                logMsg('✅ **تم حفظ المصروف فعلياً في قاعدة البيانات:**\n· 📝 ' + er.description + '\n· 💰 المبلغ: ' + money(er.amount) + ' ل.س\n· 👤 بواسطة: ' + er.by + (er.linkNote ? '\n· ' + er.linkNote : ''), 'bot');
                return;
            }
            removeTyping();
            logMsg('⚠️ ' + ((er && er.message) || 'لم أتمكن من تسجيل المصروف.'), 'sys');
            return;
        }
        // ===== العقل المحاسبي: أدوات حساب برمجية من DB (قبل الردود السريعة والذكاء) =====
        if(window.aiPosEngine && window.aiPosEngine.accountingCommand){
            var acct = null;
            try { acct = await window.aiPosEngine.accountingCommand(text); } catch(e){ acct = null; }
            if(acct){
                removeTyping();
                logMsg(acct.success ? acct.message : ('⚠️ ' + acct.message), 'bot');
                return;
            }
        }
        // نظام الثقة [Truth-Trust]: 
        //   📊 = بيان حي من DB (LocalAnswer / Tools) | 📚 = معرفة (KnowledgeBase RAG)
        //   🧮 = حساب برمجي في JS من بيانات DB (Tools) | 🧠 = تفسير LLM (Ollama)
        var reply = null;
        var replySource = 'ai'; // 'data' | 'kb' | 'calc' | 'ai'
        try { reply = await localAnswer(text); if(reply && reply !== null) replySource = 'data'; } catch(e){ reply = null; }
        if(!reply){
            // 1) RAG: المعرفة المحلية أولاً (النص كاملاً، ثم كلمات مفتاحية، ثم استعلام موجّه لأسئلة الكافيه)
            var kb = await knowledgeRetrieveSmart(text);
            if(kb && kb.count > 0){
                // 1a) Ollama + سياق معرفة أرضي (Grounded RAG) — الأفضل
                var kbPrompt = 'طلب:' + text +
                    '\n\n📚 من قاعدة المعرفة المحلية (Lucca POS): استخدم هذه المعرفة كمرجع أساسي عند الاقتباس، واذكر المصدر.\n' +
                    kb.context +
                    '\n\nالمصادر: ' + (kb.sources.length ? kb.sources.join('، ') : 'قاعدة المعرفة');
                var r2 = null;
                try { r2 = await ollamaAnalyze(text, { mode:'deep', system:SYS_MANAGER, fullPrompt: kbPrompt }); } catch(e){ r2 = null; }
                if(r2 && r2.ok && r2.text && !isDodgeReply(r2.text)){
                    reply = '🧠 **تحليل باتمان (إداري):**\n\n' + r2.text;
                    replySource = 'ai';
                } else {
                    // 1b) Ollama غير متاح -> إجابة معرفية محلية أرضية (بدون أرقام حية مخترعة)
                    reply = '📚 **من قاعدة المعرفة المحلية (بدون ذكاء محلي):**\n\n' +
                        kb.context +
                        '\n\nالمصادر: ' + (kb.sources.length ? kb.sources.join('، ') : 'قاعدة المعرفة');
                    replySource = 'kb';
                }
            } else if(isCafeQuery(text)){
                // 2) سؤال كافيه بلا نتيجة RAG -> بيانات الكافيه الموثقة (آخر مرجع قبل أي جواب سالب)
                reply = cafeInfoText();
                replySource = 'kb';
            } else {
                // 3) لا معرفة ذات صلة -> Ollama بالسياق الحي الحقيقي
                var r = null;
                try { r = await ollamaAnalyze(text, { mode:'deep', system:SYS_MANAGER }); } catch(e){ r = null; }
                if(r && r.ok && r.text && !isDodgeReply(r.text)){ reply = '🧠 **تحليل باتمان (إداري):**\n\n' + r.text; replySource = 'ai'; }
            }
            // 4) لا جواب بعد كل فحص -> رد استباقي يوضح القدرات (إلغاء «مش عارف» نهائياً)
            if(!reply){ reply = proactiveFallback(text); replySource = 'ai'; }
        }
        removeTyping();
        if(reply){
            // ضع علامة الثقة لردود الأرقام الحية (data) إن لم تكن مميزة بالفعل
            if(replySource === 'data' && reply.indexOf('📊') !== 0){
                reply = '📊 **بيانات حية من النظام**\n\n' + reply;
            }
            logMsg(reply, 'bot');
            // نطق التحليل العميق الصادر عن Ollama فقط (لا نبعث صوتاً لردود الأرقام السريعة)
            if(reply.indexOf('🧠') === 0){
                var plain = reply.replace(/^\s*🧠\s*/, '').replace(/\*\*/g,'');
                speak(plain);
            }
        }
        else logMsg(proactiveFallback(text) + '\n\n⚠️ لم يصل ردٌّ من Ollama — دعني أساعدك بالمعرفة والأرقام المحلية المتاحة.', 'bot');
    }

    // إجابة محلية فورية للمؤشرات المعروفة (SAFE، أرقام حقيقية)
    async function localAnswer(text){
        var t = text.toLowerCase();
        var lines = [];
        var matched = false;
        if(/(مبيعات|ايراد|إيراد|دخل)/.test(t)){
            var s = await BMRuntimeTools.salesToday();
            lines.push('📊 **مبيعات اليوم** ('+today()+')');
            lines.push('· الصافي: **'+money(s.sales)+' ل.س** (الإجمالي '+money(s.gross)+' - مرتجعات '+money(s.refunds)+')');
            lines.push('· الفواتير المدفوعة: '+s.count);
            matched = true;
        }
        if(/(ربح|أرباح)/.test(t)){
            var s2 = await BMRuntimeTools.salesToday();
            var e = await BMRuntimeTools.expensesToday();
            var pur = await BMRuntimeTools.purchasesTotal();
            lines.push('\n💰 **الربح اليوم:** '+money(s2.sales - e.total - pur)+' ل.س');
            lines.push('(مبيعات '+money(s2.sales)+' − مصروف '+money(e.total)+' − مشتريات '+money(pur)+')');
            matched = true;
        }
        if(/(طاولة|طاولات)/.test(t)){
            var tb = await BMRuntimeTools.tablesNow();
            lines.push('\n🪑 **الطاولات المفتوحة:** '+tb.length);
            matched = true;
        }
        if(/(موظف|حضور)/.test(t)){
            var emp = await BMRuntimeTools.employeesActive();
            lines.push('\n👥 **الموظفون النشطون:** '+emp.length);
            matched = true;
        }
        if(/(مصروف)/.test(t)){
            var ex = await BMRuntimeTools.expensesToday();
            lines.push('\n🧾 **مصروفات اليوم:** '+money(ex.total)+' ل.س ('+ex.count+' حركة)');
            matched = true;
        }
        if(/(مخزون|انذار مخزون|stock|نقص)/.test(t)){
            var low = await BMRuntimeTools.lowStockCount();
            lines.push('\n📦 **أصناف المخزون المنخفضة/الإنذار:** '+low);
            matched = true;
        }
        if(/(سنة|العام|سنوي|year|الاداء|الأداء|ملخص العام)/.test(t)){
            var y = await BMRuntimeTools.yearSales();
            lines.push('\n🗓️ **ملخص العام:** صافي '+money(y.sales)+' ل.س (إجمالي '+money(y.gross)+' - مرتجعات '+money(y.refunds)+')، فواتير '+y.count);
            matched = true;
        }
        if(/(نشاط|إنتاجية|حضور)/.test(t)){
            var att = await BMRuntimeTools.attendanceToday();
            var emp = await BMRuntimeTools.employeesActive();
            lines.push('\n👥 **حضور اليوم:** '+att.length+' سجل • الموظفون النشطون: '+emp.length);
            matched = true;
        }
        return matched ? lines.join('\n') : null;
    }

    // ============ REPORTS EXECUTION ============
    async function runReport(key){
        var r = REPORTS[key];
        if(!r) return;
        switchTab('chat');
        // add typing after switch (log overlays)
        setTimeout(function(){
            logMsg('🖥️ طلب تقرير: '+r.t, 'user');
            addTyping();
            Promise.all([r.run(), buildProactiveBrief()]).then(function(res){
                removeTyping();
                var text = res[0], brief = res[1];
                var full = (brief && brief.trim()) ? brief + '\n\n' + text : text;
                var k = key+'_'+Date.now();
                _exportStore[k] = full;
                logMsg(full + exportButtons(k, full), 'bot');
            }).catch(function(err){
                removeTyping();
                logMsg('⚠️ تعذّر تنفيذ التقرير: '+(err&&err.message||'خطأ'), 'bot');
            });
        }, 120);
    }

    // ============ INIT ============
    function init(){
        if(!document.body){ document.addEventListener('DOMContentLoaded', init); return; }
        if(document.getElementById('bd-fab')) return;
        var fab = el('<div id="bd-fab" title="لوحة باتمان AI" onclick="BatmanDashboard.toggle()">🦇</div>');
        document.body.appendChild(fab);
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        // تشغيل تلقائي للمراقبة إن كانت مفعّلة سابقاً وأحد المزودات متاح (Ollama أو OpenAI)
        if(_monitorEnabled && window.OllamaAI){
            // فحص غير متزامن — لا يعطّل تحميل الصفحة أبداً
            var _rd = (typeof window.OllamaAI.llmReady === 'function') ? window.OllamaAI.llmReady() : window.OllamaAI.isAvailable();
            _rd.then(function(ok){
                if(ok && _monitorEnabled && !_monitor.running) startMonitor();
            }).catch(function(){});
        }
    }

    return {
        init: init,
        open: open,
        close: close,
        toggle: toggle,
        switchTab: switchTab,
        sendChat: sendChat,
        runReport: runReport,
        tools: BMRuntimeTools,
        buildContext: buildContext,
        health: function(){ return buildHealth(); },
        reports: REPORTS,
        // continuous monitor API
        toggleMonitor: toggleMonitor,
        startMonitor: startMonitor,
        stopMonitor: stopMonitor,
        monitorState: monitorState,
        analyzeSnapshot: analyzeSnapshot,
        setInterval: function(ms){ _monitor.intervalMs = ms||_monitor.intervalMs; },
        ollamaAnalyze: ollamaAnalyze,
        proactiveBrief: buildProactiveBrief,
        // new features: voice + export + closing
        toggleVoice: toggleVoice,
        exportAction: exportAction,
        closings: _closings
    };
})();

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function(){ window.BatmanDashboard.init(); });
    } else {
        window.BatmanDashboard.init();
    }
}
