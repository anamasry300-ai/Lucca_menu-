/* =====================================================
   EXCEL REPORT GENERATOR
   Multi-sheet Excel export using SheetJS (xlsx)
   ===================================================== */
(function(){
    'use strict';

    const SheetSrc = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

    function loadSheetJS(){
        return new Promise((resolve, reject) => {
            if(window.XLSX) return resolve(window.XLSX);
            const s = document.createElement('script');
            s.src = SheetSrc;
            s.onload = () => resolve(window.XLSX);
            s.onerror = () => reject(new Error('Failed to load SheetJS'));
            document.head.appendChild(s);
        });
    }

    function formatDateAr(d){
        if(!d) return '';
        try { return new Date(d).toLocaleDateString('ar-EG',{year:'numeric',month:'short',day:'numeric'}); }
        catch(e){ return d; }
    }

    const ReportExport = {
        async generateFullReport(filename){
            const XLSX = await loadSheetJS();
            const wb = XLSX.utils.book_new();

            // Sheet 1: Sales Summary
            try {
                const orders = await window.LuccaDB.Orders.getAll();
                const salesData = [['التاريخ','رقم الطلب','الطاولة','الإجمالي','الحالة','ملاحظات']];
                orders.sort((a,b)=>(b.createdAt||b.date||'').localeCompare(a.createdAt||a.date||'')).forEach(o => {
                    salesData.push([
                        formatDateAr(o.createdAt||o.date),
                        o.orderNumber||o.id,
                        o.tableId||'',
                        Number(o.total||o.totalAmount||0),
                        o.status||'',
                        o.notes||''
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(salesData);
                ws['!cols'] = [{wch:15},{wch:12},{wch:10},{wch:15},{wch:12},{wch:20}];
                XLSX.utils.book_append_sheet(wb, ws, 'المبيعات');
            } catch(e){}

            // Sheet 2: Products
            try {
                const products = await window.LuccaDB.Products.getAll();
                const categories = await window.LuccaDB.Categories.getAll();
                const catMap = {}; categories.forEach(c => { catMap[c.id] = c.nameAr||c.name; });
                const prodData = [['المنتج','القسم','السعر','التكلفة','الربح','الشارة','الحالة']];
                products.forEach(p => {
                    prodData.push([
                        p.nameAr||p.name||'',
                        catMap[p.categoryId]||'',
                        Number(p.price||0),
                        Number(p.cost||0),
                        Number(p.price||0) - Number(p.cost||0),
                        p.badge||'',
                        p.available ? 'نشط' : 'معطل'
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(prodData);
                ws['!cols'] = [{wch:25},{wch:15},{wch:12},{wch:12},{wch:12},{wch:10},{wch:10}];
                XLSX.utils.book_append_sheet(wb, ws, 'المنتجات');
            } catch(e){}

            // Sheet 3: Expenses
            try {
                const expenses = await window.LuccaDB.Expenses.getAll();
                const expData = [['التاريخ','الوصف','المبلغ','الفئة','ملاحظات']];
                expenses.sort((a,b)=>(b.createdAt||b.date||'').localeCompare(a.createdAt||a.date||'')).forEach(e => {
                    expData.push([
                        formatDateAr(e.createdAt||e.date),
                        e.description||'',
                        Number(e.amount||0),
                        e.category||'',
                        e.notes||''
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(expData);
                ws['!cols'] = [{wch:15},{wch:25},{wch:12},{wch:15},{wch:20}];
                XLSX.utils.book_append_sheet(wb, ws, 'المصروفات');
            } catch(e){}

            // Sheet 4: Employees
            try {
                const employees = await window.LuccaDB.Employees.getAll();
                const empData = [['الاسم','الهاتف','الوظيفة','الراتب','الحالة']];
                employees.forEach(e => {
                    empData.push([
                        e.name||'',
                        e.phone||'',
                        e.role||'',
                        Number(e.salary||0),
                        e.active ? 'نشط' : 'معطل'
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(empData);
                ws['!cols'] = [{wch:20},{wch:15},{wch:12},{wch:12},{wch:10}];
                XLSX.utils.book_append_sheet(wb, ws, 'الموظفين');
            } catch(e){}

            // Sheet 5: Inventory
            try {
                const items = await window.LuccaDB.Inventory.getAll();
                const invData = [['الصنف','الكمية','الوحدة','التكلفة للوحدة','الحد الأدنى','الحالة']];
                items.forEach(i => {
                    const low = (i.quantity||0) <= (i.minStock||i.minQuantity||0);
                    invData.push([
                        i.name||'',
                        Number(i.quantity||0),
                        i.unit||'',
                        Number(i.cost||i.costPerUnit||0),
                        Number(i.minStock||i.minQuantity||0),
                        low ? 'منخفض' : 'متوفر'
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(invData);
                ws['!cols'] = [{wch:20},{wch:10},{wch:10},{wch:15},{wch:12},{wch:10}];
                XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
            } catch(e){}

            // Sheet 6: Cost Analysis
            try {
                const products = await window.LuccaDB.Products.getActive();
                const orderItems = await window.LuccaDB.db.getAll('order_items');
                const prodStats = {};
                orderItems.forEach(oi => {
                    const pid = oi.productId||oi.product_id;
                    if(!pid) return;
                    if(!prodStats[pid]) prodStats[pid]={sold:0,revenue:0};
                    prodStats[pid].sold+=oi.quantity||1;
                    prodStats[pid].revenue+=(oi.price||0)*(oi.quantity||1);
                });
                const costData = [['المنتج','السعر','التكلفة','% التكلفة','% الربح','الكمية المباعة','الإيراد']];
                products.forEach(p => {
                    const st = prodStats[p.id]||{sold:0,revenue:0};
                    const foodCost = (p.cost||0)*st.sold;
                    const fcp = st.revenue>0?((foodCost/st.revenue)*100):0;
                    costData.push([
                        p.nameAr||p.name||'',
                        Number(p.price||0),
                        Number(p.cost||0),
                        fcp.toFixed(1)+'%',
                        (100-fcp).toFixed(1)+'%',
                        st.sold,
                        st.revenue
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(costData);
                ws['!cols'] = [{wch:25},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:15}];
                XLSX.utils.book_append_sheet(wb, ws, 'تحليل التكاليف');
            } catch(e){}

            // Sheet 7: Payments
            try {
                const payments = await window.LuccaDB.db.getAll('payments');
                const payData = [['التاريخ','رقم الطلب','المبلغ','طريقة الدفع','الحالة']];
                payments.sort((a,b)=>(b.date||b.createdAt||'').localeCompare(a.date||a.createdAt||'')).forEach(p => {
                    payData.push([
                        formatDateAr(p.date||p.createdAt),
                        p.orderId||'',
                        Number(p.amount||0),
                        p.method||p.paymentMethod||'',
                        p.status||''
                    ]);
                });
                const ws = XLSX.utils.aoa_to_sheet(payData);
                ws['!cols'] = [{wch:15},{wch:12},{wch:12},{wch:15},{wch:10}];
                XLSX.utils.book_append_sheet(wb, ws, 'المدفوعات');
            } catch(e){}

            // Generate and download
            const today = new Date().toISOString().slice(0,10);
            const fname = (filename||'tacawiz_lucca') + '_' + today + '.xlsx';
            XLSX.writeFile(wb, fname);
            return fname;
        },

        async exportSheet(sheetName, filename){
            const XLSX = await loadSheetJS();
            const wb = XLSX.utils.book_new();

            if(sheetName === 'sales'){
                const orders = await window.LuccaDB.Orders.getAll();
                const data = [['التاريخ','رقم الطلب','الطاولة','الإجمالي','الحالة']];
                orders.sort((a,b)=>(b.createdAt||b.date||'').localeCompare(a.createdAt||a.date||'')).forEach(o => {
                    data.push([formatDateAr(o.createdAt||o.date),o.orderNumber||o.id,o.tableId||'',Number(o.total||o.totalAmount||0),o.status||'']);
                });
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'المبيعات');
            }

            if(sheetName === 'products'){
                const products = await window.LuccaDB.Products.getAll();
                const categories = await window.LuccaDB.Categories.getAll();
                const catMap = {}; categories.forEach(c => { catMap[c.id] = c.nameAr||c.name; });
                const data = [['المنتج','القسم','السعر','التكلفة','الربح','الحالة']];
                products.forEach(p => {
                    data.push([p.nameAr||p.name||'',catMap[p.categoryId]||'',Number(p.price||0),Number(p.cost||0),Number(p.price||0)-Number(p.cost||0),p.available?'نشط':'معطل']);
                });
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'المنتجات');
            }

            if(sheetName === 'cost'){
                const products = await window.LuccaDB.Products.getActive();
                const orderItems = await window.LuccaDB.db.getAll('order_items');
                const prodStats = {};
                orderItems.forEach(oi => { const pid=oi.productId||oi.product_id;if(!pid)return;if(!prodStats[pid])prodStats[pid]={sold:0,revenue:0};prodStats[pid].sold+=oi.quantity||1;prodStats[pid].revenue+=(oi.price||0)*(oi.quantity||1); });
                const data = [['المنتج','السعر','التكلفة','% التكلفة','% الربح','الكمية','الإيراد']];
                products.forEach(p => { const st=prodStats[p.id]||{sold:0,revenue:0};const fc=(p.cost||0)*st.sold;const fcp=st.revenue>0?((fc/st.revenue)*100):0;data.push([p.nameAr||p.name||'',Number(p.price||0),Number(p.cost||0),fcp.toFixed(1)+'%',(100-fcp).toFixed(1)+'%',st.sold,st.revenue]); });
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'تحليل التكاليف');
            }

            const today = new Date().toISOString().slice(0,10);
            const fname = (filename||sheetName) + '_' + today + '.xlsx';
            XLSX.writeFile(wb, fname);
            return fname;
        }
    };

    window.ReportExport = ReportExport;
})();
