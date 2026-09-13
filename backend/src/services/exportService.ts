import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';

export type ExportFormat = 'xlsx' | 'pdf';

export interface SheetData {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

export function buildXlsx(sheets: SheetData[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa: (string | number)[][] = [s.headers, ...s.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildPdf(title: string, sections: { heading: string; table: SheetData }[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text(title, { align: 'center' });
    doc.moveDown();

    for (const sec of sections) {
      doc.font('Helvetica-Bold').fontSize(13).text(sec.heading, { underline: true });
      doc.moveDown(0.4);

      const { headers, rows } = sec.table;
      const nCols = headers.length;
      if (nCols === 0) { doc.text('—'); doc.moveDown(); continue; }
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colW = pageWidth / nCols;

      doc.font('Helvetica-Bold').fontSize(9);
      let x = doc.page.margins.left;
      const y0 = doc.y;
      headers.forEach((h, i) => {
        doc.text(String(h), x, y0, { width: colW - 2, height: 18 });
        x += colW;
      });
      doc.moveDown();

      doc.font('Helvetica').fontSize(8);
      for (const row of rows) {
        if (doc.y > doc.page.height - 60) { doc.addPage(); }
        x = doc.page.margins.left;
        const yy = doc.y;
        for (let i = 0; i < nCols; i++) {
          doc.text(String(row[i] ?? ''), x, yy, { width: colW - 2, height: 16 });
          x += colW;
        }
        doc.moveDown();
      }
      doc.moveDown();
    }
    doc.end();
  });
}

// بناء أوراق التقرير حسب نوعه: sales / expenses / inventory / employees / suppliers
export function reportSheets(
  type: string,
  data: Record<string, any>,
): { title: string; sheets: SheetData[] } {
  if (type === 'sales') return salesSheets(data);
  if (type === 'expenses') return expensesSheets(data);
  if (type === 'inventory') return inventorySheets(data);
  if (type === 'employees') return employeesSheets(data);
  if (type === 'suppliers') return suppliersSheets(data);
  return { title: type, sheets: [] };
}

function salesSheets(d: Record<string, any>) {
  const title = `تقرير المبيعات ${d.range?.from || ''} → ${d.range?.to || ''}`;
  const sheets: SheetData[] = [
    {
      name: 'ملخص',
      headers: ['المؤشر', 'القيمة'],
      rows: [
        ['إجمالي المبيعات (صافي)', d.netSales ?? 0],
        ['الإيراد الخام', d.revenue ?? 0],
        ['عدد الطلبات', d.orders ?? 0],
        ['متوسط الطلب', d.avgOrder ?? 0],
        ['الخصومات', d.discounts ?? 0],
        ['الاستردادات', d.refunds ?? 0],
        ['الإلغاءات', d.cancelled ?? 0],
        ...(d.grossProfit != null ? [['إجمالي الربح', d.grossProfit], ['هامش الربح %', d.grossMargin ?? 0]] : []),
        ['مقارنة الفترة السابقة — المبيعات %', d.change?.netSales ?? 0],
        ['مقارنة الفترة السابقة — الطلبات %', d.change?.orders ?? 0],
      ],
    },
    {
      name: 'المبيعات حسب اليوم',
      headers: ['التاريخ', 'الطلبات', 'الإيراد', 'الخصومات'],
      rows: (d.byDay || []).map((r: any) => [r.date, Number(r.orders) || 0, Number(r.revenue) || 0, Number(r.discounts) || 0]),
    },
    {
      name: 'الفئات',
      headers: ['القسم', 'الكمية', 'الإيراد', 'النسبة %'],
      rows: (d.byCategory || []).map((r: any) => [String(r.name || ''), Number(r.quantity) || 0, Number(r.revenue) || 0, r.percentage != null ? r.percentage : 0]),
    },
    {
      name: 'الأكثر مبيعاً',
      headers: ['الصنف', 'القسم', 'الكمية', 'الإيراد', 'التكلفة', 'الربح'],
      rows: (d.topProducts || []).map((r: any) => [String(r.name || ''), String(r.category || ''), Number(r.quantity) || 0, Number(r.revenue) || 0, Number(r.cost) || 0, Number(r.profit) || 0]),
    },
    {
      name: 'طرق الدفع',
      headers: ['الطريقة', 'العمليات', 'الإجمالي', 'النسبة %'],
      rows: (d.payments || []).map((r: any) => [String(r.method || ''), Number(r.count) || 0, Number(r.total) || 0, r.percentage != null ? r.percentage : 0]),
    },
  ];

  if (d.cogs != null) {
    sheets.splice(2, 0, {
      name: 'التكلفة والربح',
      headers: ['الإيراد الصافي', 'تكلفة البضاعة COGS', 'إجمالي الربح', 'الهامش %'],
      rows: [[d.netSales ?? 0, d.cogs ?? 0, d.grossProfit ?? 0, d.grossMargin ?? 0]],
    });
  }
  return { title, sheets };
}

function expensesSheets(d: Record<string, any>) {
  const title = `تقرير المصروفات ${d.range?.from || ''} → ${d.range?.to || ''}`;
  const sheets: SheetData[] = [
    {
      name: 'ملخص',
      headers: ['المؤشر', 'القيمة'],
      rows: [
        ['إجمالي المصروفات', d.total ?? 0],
        ['عدد العمليات', d.count ?? 0],
        ['مقارنة الفترة السابقة %', d.change?.total ?? 0],
        ['مصروفات الفترة السابقة', d.previous?.total ?? 0],
      ],
    },
    {
      name: 'حسب الفئة',
      headers: ['الفئة', 'الإجمالي', 'العدد'],
      rows: (d.byCategory || []).map((r: any) => [String(r.name || ''), Number(r.total) || 0, Number(r.count) || 0]),
    },
    {
      name: 'حسب الموظف',
      headers: ['الموظف', 'الإجمالي', 'العدد'],
      rows: (d.byEmployee || []).map((r: any) => [String(r.name || ''), Number(r.total) || 0, Number(r.count) || 0]),
    },
    {
      name: 'أحدث المصروفات',
      headers: ['المبلغ', 'الوصف', 'الفئة', 'التاريخ'],
      rows: (d.recent || []).map((r: any) => [Number(r.amount) || 0, String(r.description || ''), String(r.category || ''), String(r.date || '')]),
    },
  ];
  return { title, sheets };
}

function inventorySheets(d: Record<string, any>) {
  const title = `تقرير المخزون`;
  const sheets: SheetData[] = [
    {
      name: 'المخزون',
      headers: ['الصنف', 'الكمية', 'الوحدة', 'الحد الأدنى', 'تكلفة الوحدة', 'القيمة', 'الحالة'],
      rows: (d.items || []).map((r: any) => [String(r.name || ''), Number(r.quantity) || 0, String(r.unit || ''), Number(r.minStock) || 0, Number(r.costPrice) || 0, Number(r.quantity) * Number(r.costPrice), String(r.status || 'ok')]),
    },
    {
      name: 'ملخص',
      headers: ['المؤشر', 'القيمة'],
      rows: [
        ['إجمالي قيمة المخزون', d.totalValue ?? 0],
        ['أصناف', d.totalItems ?? 0],
        ['مخزون منخفض', d.lowStock ?? 0],
        ['نفد', d.outOfStock ?? 0],
      ],
    },
    {
      name: 'حركات',
      headers: ['الصنف', 'الكمية', 'النوع', 'ملاحظات', 'التاريخ'],
      rows: (d.movements || []).map((r: any) => [String(r.productName || ''), Number(r.quantity) || 0, String(r.type || ''), String(r.notes || ''), String(r.createdAt || '')]),
    },
  ];
  return { title, sheets };
}

function employeesSheets(d: Record<string, any>) {
  const title = `تقرير أداء الموظفين ${d.range?.from || ''} → ${d.range?.to || ''}`;
  const sheets: SheetData[] = [
    {
      name: 'الأداء',
      headers: ['الموظف', 'الطلبات', 'المبيعات', 'متوسط الطلب'],
      rows: (d.performance || []).map((r: any) => [String(r.name || ''), Number(r.orders) || 0, Number(r.sales) || 0, Number(r.avgOrder) || 0]),
    },
    {
      name: 'الموظفون',
      headers: ['الاسم', 'الدور', 'الراتب', 'الهاتف', 'النشاط'],
      rows: (d.employees || []).map((r: any) => [String(r.name || ''), String(r.role || ''), Number(r.salary) || 0, String(r.phone || ''), r.active ? 'نشط' : 'موقوف']),
    },
    {
      name: 'الحضور',
      headers: ['الموظف', 'التاريخ', 'دخول', 'خروج', 'نوع'],
      rows: (d.attendance || []).map((r: any) => r?.employeeName ? [String(r.employeeName), String(r.date || ''), String(r.timeIn || r.checkIn || ''), String(r.timeOut || r.checkOut || ''), String(r.type || r.status || '')] : []).filter((r: any[]) => r.length > 0),
    },
  ];
  return { title, sheets };
}

function suppliersSheets(d: Record<string, any>) {
  const title = `تقرير الموردين`;
  const sheets: SheetData[] = [
    {
      name: 'الموردون',
      headers: ['الاسم', 'الهاتف', 'جهة الاتصال'],
      rows: (d.suppliers || []).map((r: any) => [String(r.name || ''), String(r.phone || ''), String(r.contact || '')]),
    },
    {
      name: 'إجمالي المشتريات',
      headers: ['المورد', 'العمليات', 'الإجمالي'],
      rows: (d.totals || []).map((r: any) => [String(r.name || ''), Number(r.count) || 0, Number(r.total) || 0]),
    },
    {
      name: 'أحدث المشتريات',
      headers: ['المورد', 'الإجمالي', 'التاريخ', 'ملاحظات'],
      rows: (d.recent || []).map((r: any) => [String(r.supplier || ''), Number(r.total) || 0, String(r.date || ''), String(r.notes || '')]),
    },
  ];
  return { title, sheets };
}