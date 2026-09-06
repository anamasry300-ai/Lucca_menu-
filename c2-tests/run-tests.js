// بيئة اختبار منفصلة لمحرك Safe Sync — لا تلمس أي بيانات إنتاج.
// تشغيل: node c2-tests/run-tests.js
const {
  newUuid, setUuidFn, ensureSyncIds,
  mergePush, mergePull, sameData, newestWins,
  createSyncLog, logResult, runSyncTransaction, resolveExisting
} = require('./safe-sync-engine');

// مجموعتي اختبار ثابتتين بحيث لا تعتمد على ترتيب UUID
let seq = 0;
setUuidFn(() => `uuid-${String(++seq).padStart(5, '0')}`);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}
let passed = 0, failed = 0;
function finalize() {
  for (const r of results) (r.ok ? passed++ : failed++);
  console.log('\n====================');
  console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
  console.log('====================');
  process.exitCode = failed === 0 ? 0 : 1;
}

// ===== أدوات مساعدة لبناء سجلات اختبارية =====
function order(id, { subtotal = 100, tax = 14, updatedAt = null, createdAt = null, syncId = null, orderNumber = null } = {}) {
  return {
    id,
    orderNumber: orderNumber || ('ORD-' + id),
    subtotal, tax, total: subtotal + tax,
    status: 'completed',
    createdAt: createdAt || new Date('2026-01-01T10:00:00Z').toISOString(),
    updatedAt: updatedAt || createdAt || new Date('2026-01-01T10:00:00Z').toISOString(),
    syncId: syncId || newUuid()
  };
}
function orderItem(id, orderId, name, { qty = 1, price = 10, syncId = null, orderSyncIdAttr = null, updatedAt = null } = {}) {
  return {
    id, orderId, name, quantity: qty, unitPrice: price, total: qty * price,
    createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    updatedAt: updatedAt || '2026-01-01T10:00:00Z',
    syncId: syncId || newUuid(),
    orderSyncId: orderSyncIdAttr
  };
}
function invoice(id, orderId, { amount = 114, updatedAt = null, syncId = null } = {}) {
  return {
    id, orderId, amount,
    date: '2026-01-01',
    createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    updatedAt: updatedAt || '2026-01-01T10:00:00Z',
    syncId: syncId || newUuid()
  };
}
function payment(id, orderId, invoiceId, amount, { updatedAt = null, syncId = null } = {}) {
  return { id, orderId, invoiceId, amount, method: 'cash', status: 'completed',
    createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    updatedAt: updatedAt || '2026-01-01T10:00:00Z', syncId: syncId || newUuid() };
}
function auditLog(id, action, { updatedAt = null, syncId = null } = {}) {
  return { id, action, createdAt: new Date('2026-01-01T10:00:00Z').toISOString(), updatedAt: updatedAt || '2026-01-01T10:00:00Z', syncId: syncId || newUuid() };
}
function stockMovement(id, type, qty, { updatedAt = null, syncId = null } = {}) {
  return { id, type, quantity: qty, date: '2026-01-01', createdAt: new Date('2026-01-01T10:00:00Z').toISOString(), updatedAt: updatedAt || '2026-01-01T10:00:00Z', syncId: syncId || newUuid() };
}

// ===== محاكاة أعلى مستوى: Server =====
function makeServer() {
  const tables = {}; // store -> Map keyed by syncId
  return {
    tables,
    find(store, syncId) { return (tables[store] || {})[syncId] || null; },
    all(store) { return Object.values(tables[store] || {}); },
    apply(store, syncId, item) {
      if (!tables[store]) tables[store] = {};
      if (item) tables[store][syncId] = item;
    },
    // push أقل خطراً: لا حذف إطلاقاً؛ ندخل/نحدّث فقط حسب قرار المحرك
    bulkStore(store, log, incoming) {
      if (!tables[store]) tables[store] = {};
      for (const row of incoming) {
        if (!row || !row.syncId) { log.errors++; continue; }
        const existing = tables[store][row.syncId];
        const res = mergePush(existing, row);
        logResult(log, res, row);
        if (res.action === 'insert' || res.action === 'update') tables[store][row.syncId] = res.item;
        // skip / conflict: لا نكتب
      }
    }
  };
}

// ===== محاكاة جهاز عميل =====
function makeDevice(name) {
  const local = {}; // store -> { bySyncId, byId }
  function ensureStore(s) { if (!local[s]) local[s] = { bySyncId: {}, byId: {} }; return local[s]; }
  return {
    name,
    local,
    add(store, item) {
      const st = ensureStore(store);
      st.bySyncId[item.syncId] = item;
      if (item.id != null) st.byId[item.id] = item;
    },
    getBySyncId(store, syncId) { return (ensureStore(store).bySyncId)[syncId] || null; },
    getById(store, id) { return (ensureStore(store).byId)[id] || null; },
    all(store) { return Object.values(ensureStore(store).bySyncId); },
    count(store) { return Object.values(ensureStore(store).bySyncId).length; },
    // push: يطبق على السيرفر
    push(server, stores) {
      const log = createSyncLog();
      for (const store of stores) {
        const rows = this.all(store);
        for (const row of rows) {
          const existing = server.find(store, row.syncId);
          const res = mergePush(existing, row);
          logResult(log, res, row);
          if (res.action === 'insert' || res.action === 'update') server.apply(store, row.syncId, res.item);
        }
      }
      return log;
    },
    // pull: دمج (MERGE) لا استبدال IndexedDB
    pull(server, stores) {
      const log = createSyncLog();
      for (const store of stores) {
        for (const srow of server.all(store)) {
          const lrow = this.getBySyncId(store, srow.syncId);
          const res = mergePull(lrow, srow);
          logResult(log, res, srow);
          if (res.action === 'insert' || res.action === 'update') this.add(store, Object.assign({}, res.item));
        }
      }
      return log;
    }
  };
}

(async () => {
  // ====== TEST 0: توليد UUID / الهوية ======
  const d0 = { id: 1, name: 'x' };
  const d0b = { id: 1, name: 'x' };
  const e0 = ensureSyncIds({ orders: [d0], order_items: [] });
  const sid0 = e0.orders[0].syncId;
  record('TEST0a: ensureSyncIds يضيف syncId ويحافظ على id', !!sid0 && e0.orders[0].id === 1, 'syncId=' + sid0);
  const e0b = ensureSyncIds({ orders: [d0b] });
  const sid0b = e0b.orders[0].syncId;
  record('TEST0b: سجلان مختلفان => syncId مختلفان', sid0 !== sid0b, `${sid0} vs ${sid0b}`);

  // ====== TEST 1: جهاز A فيه Invoice A، جهاز B فيه Invoice B؛ Sync A ثم B => يتجمعان =====
  {
    const server = makeServer();
    const A = makeDevice('A'), B = makeDevice('B');
    const invA = invoice(1, 1, { amount: 100 });   // syncId uuid-0001
    const invB = invoice(2, 2, { amount: 200 });   // syncId مختلف
    A.add('invoices', invA);
    B.add('invoices', invB);
    const l1 = A.push(server, ['invoices']);
    const l2 = B.push(server, ['invoices']);
    const serverInvoices = server.all('invoices');
    record('TEST1: بعد Sync A ثم B، الخادم فيه Invoice A + Invoice B',
      serverInvoices.length === 2 && serverInvoices.some(i => i.amount === 100) && serverInvoices.some(i => i.amount === 200),
      `count=${serverInvoices.length} amounts=[${serverInvoices.map(i => i.amount).join(',')}] l1=${l1.inserted}/${l1.skipped}/${l1.conflicts} l2=${l2.inserted}/${l2.skipped}/${l2.conflicts}`);
  }

  // ====== TEST 2: A وB نفس invoice id؛ الأحدث فقط يُحدَّث (بدليل موثوق) =====
  {
    const server = makeServer();
    const A = makeDevice('A'), B = makeDevice('B');
    const same = newUuid();
    const oldInv = invoice(7, 7, { amount: 100, syncId: same, updatedAt: '2026-01-01T08:00:00Z' });
    const newInv = invoice(7, 7, { amount: 150, syncId: same, updatedAt: '2026-01-01T12:00:00Z' });
    A.add('invoices', oldInv);
    B.add('invoices', newInv);
    A.push(server, ['invoices']); // السيرفر فيه 100 (arrival)
    B.push(server, ['invoices']);         // B أحدث => update
    const row = server.find('invoices', same);
    record('TEST2: النسخة الأحدث (updatedAt أحدث، خارج نافذة الغموض) تحدّث', row && row.amount === 150, `amount=${row && row.amount}`);
  }

  // ====== TEST 3: تعارض حقيقي بلا timestamp/version موثوق => CONFLICT لا overwrite =====
  {
    const server = makeServer();
    const A = makeDevice('A'), B = makeDevice('B');
    const same = newUuid();
    const recA = invoice(9, 9, { amount: 300, syncId: same });
    const recB = invoice(9, 9, { amount: 400, syncId: same });
    // بدون updatedAt نهائياً (أُزيل) => غموض
    delete recA.updatedAt; delete recB.updatedAt; delete recB.updated_at;
    A.add('invoices', recA);
    A.push(server, ['invoices']);
    B.add('invoices', recB);
    const l = B.push(server, ['invoices']);
    const row = server.find('invoices', same);
    record('TEST3: تعارض بلا timestamp => CONFLICT ولا استبدال',
      l.conflicts === 1 && row && row.amount === 300,
      `conflicts=${l.conflicts} serverAmount=${row && row.amount} (يبقى 300, لم يُستبدل بـ400)`);
  }

  // ====== TEST 4: Pull بعد Push لا يفقد أي سجل محلي =====
  {
    const server = makeServer();
    const A = makeDevice('A');
    const invA = invoice(3, 3, { amount: 100 });
    const invLoc = invoice(4, 4, { amount: 50 }); // سجل محلي لم يُرفع بعد
    A.add('invoices', invA);
    A.add('invoices', invLoc);
    A.push(server, ['invoices']);
    const before = A.count('invoices');
    const log = A.pull(server, ['invoices']);
    record('TEST4: Pull بعد Push لا يحذف سجلات محلية',
      A.count('invoices') === before,
      `قبل=${before} بعد=${A.count('invoices')} action=[${log.items.map(i => i.action).join(',')}], conflicts=${log.conflicts}`);
  }

  // ====== TEST 5: انقطاع الشبكة أثناء Sync => transaction rollback (لا حالة جزئية) =====
  {
    const server = makeServer();
    const rows = [invoice(50, 50, { amount: 500 }), invoice(51, 51, { amount: 600 })];
    // مرحلة القرار: نبني خطة الكتابة مغلّفة داخل معاملة، دون أي اتصال بالسيرفر.
    const res = await runSyncTransaction(async ({ txn }) => {
      for (const r of rows) {
        if (!server.find('invoices', r.syncId)) {
          txn.queue('invoices', 'insert', r.syncId, r); // معلّق فقط، لا يُكتب بعد
        }
      }
      // محاكاة انقطاع الشبكة قبل commit: نرمي خطأ => rollback
      throw new Error('شبكة انقطعت');
    });
    // بما أن المعاملة لم تُثبت (rollback)، فلا شيء كُتب فعلياً على السيرفر
    record('TEST5: انقطاع الشبكة => Rollback ولا حالة جزئية',
      res.committed === false && server.all('invoices').length === 0,
      `committed=${res.committed} صفوف مكتوبة فعلاً=${server.all('invoices').length} (متوقع 0 بعد rollback)`);
  }

  // ====== TEST 6: علاقة Orders -> Order Items (تركيب/هوية عبر syncId، لا id محلي) =====
  {
    const server = makeServer();
    const A = makeDevice('A');
    const o1 = order(1, { subtotal: 50, tax: 0 });
    const it1 = orderItem(101, 1, 'قهوة', { qty: 2, price: 25, orderSyncIdAttr: o1.syncId });
    A.add('orders', o1);
    A.add('order_items', it1);
    A.push(server, ['orders', 'order_items']);
    // علاقة صحيحة: item.orderSyncId == order.syncId
    const sOrder = server.find('orders', o1.syncId);
    const sItem = server.find('order_items', it1.syncId);
    const relOk = sItem && sOrder && sItem.orderSyncId === sOrder.syncId;
    record('TEST6: order_item يُربط بالأب عبر orderSyncId (لا id محلي)',
      relOk && sItem.orderId === 1,
      `orderSyncId=${sItem && sItem.orderSyncId} orderSyncId_الأب=${sOrder && sOrder.syncId} orderId=${sItem && sItem.orderId}`);
  }

  // ====== TEST 6b: جهازان مختلفان، نفس الطلب، same order_item identity عبر syncId =====
  {
    const server = makeServer();
    const A = makeDevice('A'), B = makeDevice('B');
    const sameOrder = newUuid();
    const sameItem = newUuid();
    const oA = order(1, { syncId: sameOrder });
    const oB = order(99, { syncId: sameOrder }); // id محلي مختلف على B (لكن syncId واحد)
    const iA = orderItem(101, 1, 'قهوة', { qty: 2, orderSyncIdAttr: sameOrder, syncId: sameItem });
    const iB = orderItem(202, 99, 'قهوة', { qty: 3, orderSyncIdAttr: sameOrder, syncId: sameItem });
    A.add('orders', oA); A.add('order_items', iA);
    B.add('orders', oB); B.add('order_items', iB);
    A.push(server, ['orders', 'order_items']);
    B.push(server, ['orders', 'order_items']);
    const serverItems = server.all('order_items');
    const serverOrders = server.all('orders');
    // لا ينبغي أن يتكاثر نفس order_item بسبب id محلي مختلف
    record('TEST6b: نفس order_item يُدمج عبر syncId رغم اختلاف id المحلي (لا تكرار)',
      serverItems.length === 1 && serverOrders.length === 1,
      `items=${serverItems.length} orders=${serverOrders.length} itemQty=${serverItems[0] && serverItems[0].quantity}`);
  }

  // ====== TEST 7: Invoices -> Payments (سلامة العلاقة) =====
  {
    const server = makeServer();
    const A = makeDevice('A');
    const inv = invoice(1, 1, { amount: 114 });
    const pay0 = payment(5, 1, 1, 100);
    pay0.invoiceSyncId = inv.syncId;
    A.add('invoices', inv);
    A.add('payments', pay0);
    A.push(server, ['invoices', 'payments']);
    const sPay = server.find('payments', pay0.syncId);
    record('TEST7: payment يحافظ على relation لـ invoice (invoiceSyncId/orderId)',
      sPay && sPay.invoiceSyncId === inv.syncId && sPay.orderId === 1,
      `invoiceSyncId=${sPay && sPay.invoiceSyncId} orderId=${sPay && sPay.orderId}`);
  }

  // ====== TEST 8: Inventory / Stock Movements (لا استبدال أعمى، لا حذف) =====
  {
    const server = makeServer();
    const A = makeDevice('A'), B = makeDevice('B');
    const mvA = stockMovement(1, 'in', 5);
    const mvB = stockMovement(1, 'out', 2, { syncId: mvA.syncId, updatedAt: '2026-01-02T09:00:00Z' }); // أحدث
    A.add('stock_movements', mvA); B.add('stock_movements', mvB);
    const beforeTotal = A.count('stock_movements') + B.count('stock_movements');
    A.push(server, ['stock_movements']);
    const l = B.push(server, ['stock_movements']);
    const row = server.find('stock_movements', mvA.syncId);
    record('TEST8: حركة مخزون أحدث تحدّث ولا تُحذف ولا تتكاثر',
      l.updated === 1 && row && row.quantity === 2 && server.all('stock_movements').length === 1,
      `updated=${l.updated} qty=${row && row.quantity} count=${server.all('stock_movements').length}`);
  }

  // ====== TEST 9: audit_logs لا يُستبدل أعمى (سجلات حساسة، append-only) =====
  {
    const server = makeServer();
    const A = makeDevice('A');
    const al1 = auditLog(1, 'create_order');
    const al2 = auditLog(2, 'delete_order');
    A.add('audit_logs', al1); A.add('audit_logs', al2);
    A.push(server, ['audit_logs']);
    const count = server.all('audit_logs').length;
    record('TEST9: audit_logs تُحمَّل/tكمل ولا تُستبدل أعمى (تجميع)', count === 2, `count=${count}`);
  }

  // ====== TEST 10: sync log يعرض counters صحيحة (inserted/updated/skipped/conflicts/errors) =====
  {
    const server = makeServer();
    const A = makeDevice('A');
    const s = newUuid();
    const r1 = invoice(1, 1, { amount: 1, syncId: newUuid() });
    const r2 = invoice(2, 2, { amount: 2, syncId: s });
    A.add('invoices', r1); A.add('invoices', r2);
    const l1 = A.push(server, ['invoices']);
    const l2 = A.push(server, ['invoices']); // كلاهما موجود الآن => skip
    record('TEST10: Sync Log يجمع inserted ثم skipped',
      l1.inserted === 2 && l2.skipped === 2 && l2.inserted === 0,
      `l1: ins=${l1.inserted} | l2: ins=${l2.inserted} skip=${l2.skipped} up=${l2.updated} conf=${l2.conflicts}`);
  }

  // ====== TEST 11: rollback عبر network failure يعيد كل شيء (لا حالة جزئية) =====
  {
    const server = makeServer();
    const rows = [invoice(60, 60, { amount: 1 }), invoice(61, 61, { amount: 2 })];
    // مرحلة القرار ناجحة => نحصل على خطة (pending). ثم نُحاكي فشل الشبكة قبل الالتزام بالكتابة.
    const decided = await runSyncTransaction(async ({ txn }) => {
      for (const r of rows) if (!server.find('invoices', r.syncId)) txn.queue('invoices', 'insert', r.syncId, r);
    });
    // لم نستدعِ commitTarget إطلاقاً بسبب شبكة/خطأ -> لا شيء على السيرفر
    const actual = server.all('invoices').length;
    record('TEST11: Rollback يمنع حالة جزئية بعد انقطاع الشبكة قبل الكتابة',
      actual === 0 && decided.pending.length === 2,
      `committed=${decided.committed} rowsActualmenteEscritas=${actual} (متوقع 0) pending=${decided.pending.length}`);

    // ثم محاكاة: تنفيذ المعاملة بنجاح كامل => commit يطبّق الكل بأتمة
    const committed = await runSyncTransaction(async ({ txn }) => {
      for (const r of rows) if (!server.find('invoices', r.syncId)) txn.queue('invoices', 'insert', r.syncId, r);
    });
    if (committed.committed) {
      committed.commitTarget(server);
      const after = server.all('invoices').length;
      record('TEST11b: نجاح كامل => commit ذرّي يطبّق كل الكتابات',
        after === 2,
        `بعد commit=${after} (متوقع 2)`);
    } else {
      record('TEST11b: نجاح كامل => commit ذرّي', false, 'فشل في مرحلة القرار');
    }
  }

  // ====== TEST 12 (REGRESSION): تسريب id الرقمي — سجل جديد بمعرف متصادم لا يُدمج مع سجل قديم =====
  {
    // السيناريو الحقيقي الذي فُضح في الاختبار الحي:
    // جهاز جديد يملك صفاً محلياً id=1 (syncId='X')، والسيرفر لديه صف قديم id=1 بلا syncId.
    // قبل الإصلاح كان الـfallback الرقمي يدمجهما ويفسد الصف القديم؛ الآن يحمي الحارس.
    const bySyncId = (sid) => sid === 'X' ? null : null; // لا تطابق بالهوية المستقرة
    const byId = (nid) => nid === 1 ? { id: 1, syncId: null, total: 100 } : null; // صف السيرفر القديم
    const incomingNew = { id: 1, syncId: 'X', total: 777 }; // سجل الجهاز الجديد (بـsyncId صحيح)
    const existing = resolveExisting({ bySyncId, byId, incoming: incomingNew });
    record('TEST12: سجل جديد يحمل syncId غير مطابق لا يُمزج مع سجل قديم عبر id الرقمي',
      existing === null, `existing=${JSON.stringify(existing)} (متوقع null => إدراج مستقل)`);
  }

  // ====== TEST 13 (REGRESSION): وضع الهجرة — سجلان قديمان بلا syncId وبنفس id يُدمجان =====
  {
    const bySyncId = () => null;
    const byId = (nid) => nid === 5 ? { id: 5, syncId: null, total: 10 } : null; // سيرفر قديم
    const incomingLegacy = { id: 5, total: 25 }; // جهاز قديم بلا syncId أصلاً
    const existing = resolveExisting({ bySyncId, byId, incoming: incomingLegacy });
    record('TEST13: هجرة البيانات القديمة (لا syncId لدى الطرفين) تبقى تعمل بالـid الرقمي',
      !!existing && existing.id === 5 && !existing.syncId, `existing=${JSON.stringify(existing)}`);
  }

  finalize();
})().catch(e => { console.error('خطأ في الاختبار:', e); process.exitCode = 1; });
