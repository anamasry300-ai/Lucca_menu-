/**
 * AI Bot Comprehensive Test Script
 * Tests: Pattern matching, Entity extraction, Intent detection, Product search
 */

console.log('🤖 ===== AI BOT TEST SUITE =====\n');

// ===== 1. TEST matchAny =====
console.log('📝 [1/6] Testing matchAny() pattern matching...');

function matchAny(text, keywords) {
    const t = text.toLowerCase();
    return keywords.some(k => t.includes(k.toLowerCase()));
}

const matchTests = [
    { text: 'افتح الطاولة 3', keywords: ['افتح', 'فتح', 'open'], expected: true },
    { text: 'اضف قهوة', keywords: ['اضف', 'أضف', 'add'], expected: true },
    { text: 'اعرض لي التقارير', keywords: ['تقرير', 'reports'], expected: true },
    { text: 'كيف حالك', keywords: ['كيف حالك', 'اهلا', 'مرحبا'], expected: true },
    { text: 'xyz random', keywords: ['فتح', 'اضف'], expected: false },
    { text: 'غلطت', keywords: ['غلطت', 'خطا', 'صححني'], expected: true },
    { text: 'علّمني ان الاتي يساوي 2 قهوة', keywords: ['علّمني', 'علم'], expected: true },
];

let matchPassed = 0;
matchTests.forEach((test, i) => {
    const result = matchAny(test.text, test.keywords);
    const pass = result === test.expected;
    matchPassed += pass ? 1 : 0;
    console.log(`  ${pass ? '✅' : '❌'} "${test.text}" => ${result} (expected ${test.expected})`);
});
console.log(`  Result: ${matchPassed}/${matchTests.length} passed\n`);

// ===== 2. TEST Entity Extraction (from ai-pos-engine.js logic) =====
console.log('📝 [2/6] Testing Entity Extraction...');

const arabicNumbers = { 'واحد':1, 'واحدة':1, 'اثنين':2, 'اثنان':2, 'اثنتين':2, 'ثلاث':3, 'ثلاثة':3, 'اربع':4, 'اربعة':4, 'خمس':5, 'خمسة':5, 'ست':6, 'ستة':6, 'سبع':7, 'سبعة':7, 'ثمان':8, 'ثمانية':8, 'تسع':9, 'تسعة':9, 'عشر':10, 'عشرة':10 };

function extractNumber(text) {
    // digit patterns
    const m3 = text.match(/(\d+)/);
    if(m3) return parseInt(m3[1]);
    // Arabic number words
    const words = text.split(/\s+/);
    for(const w of words) {
        if(arabicNumbers[w]) return arabicNumbers[w];
    }
    // special patterns
    if(text.includes('كوبايتين') || text.includes('اتينين') || text.includes('اتنين')) return 2;
    if(text.includes('3 اكواب') || text.includes('ثلاث اكواب')) return 3;
    return 1;
}

function extractQuantity(text) {
    // "2 قهوة" or "قهوة عدد 2"
    let m = text.match(/(\d+)\s*(?: cups?| قهوة| اكواب| حبات| pieces?)?/i);
    if(m && parseInt(m[1]) <= 20) return parseInt(m[1]);
    // "قهوة عدد X"
    m = text.match(/عدد\s*(\d+)/);
    if(m) return parseInt(m[1]);
    return extractNumber(text);
}

const entityTests = [
    { text: '2 قهوة', expectedQty: 2 },
    { text: '3 اكواب لاتيه', expectedQty: 3 },
    { text: 'اتنين موكا', expectedQty: 2 },
    { text: 'قهوة عدد 5', expectedQty: 5 },
    { text: 'واحد اسبريسو', expectedQty: 1 },
    { text: '×4 كابتشينو', expectedQty: 4 },
    { text: 'شاي', expectedQty: 1 },
];

let entityPassed = 0;
entityTests.forEach((test) => {
    const qty = extractQuantity(test.text);
    const pass = qty === test.expectedQty;
    entityPassed += pass ? 1 : 0;
    console.log(`  ${pass ? '✅' : '❌'} "${test.text}" => qty=${qty} (expected ${test.expectedQty})`);
});
console.log(`  Result: ${entityPassed}/${entityTests.length} passed\n`);

// ===== 3. TEST Intent Detection =====
console.log('📝 [3/6] Testing Intent Detection...');

function detectIntent(text) {
    const t = text.toLowerCase();
    if(matchAny(t, ['افتح طاولة', 'افتح طاوله', 'فتح طاولة', 'open table'])) return 'open_table';
    if(matchAny(t, ['اضف صنف', 'أضف صنف', 'add item', 'أضف', 'اضف'])) return 'add_items';
    if(matchAny(t, ['احذف صنف', 'احذف', '.remove', 'شيل', 'امسح الصنف'])) return 'remove_item';
    if(matchAny(t, ['المجموع', 'الحساب', 'كم يساوي', 'total', 'get total'])) return 'get_total';
    if(matchAny(t, ['ادفع', 'ادفعي', 'دفع', 'payment', ' pays'])) return 'process_payment';
    if(matchAny(t, ['اغلق الطاولة', 'اغلق طاولة', 'close table'])) return 'close_table';
    if(matchAny(t, ['转移', 'انقل', 'نقل طاولة', 'transfer'])) return 'transfer_table';
    if(matchAny(t, ['atl', 'تيك اواي', 'take away'])) return 'create_takeaway';
    if(matchAny(t, ['ديلفري', 'توصيل', 'delivery'])) return 'create_delivery';
    if(matchAny(t, ['جاهز', 'ready', 'เสร็จ'])) return 'set_ready';
    if(matchAny(t, ['المطبخ', 'kitchen', 'ابعث للمطبخ'])) return 'send_to_kitchen';
    if(matchAny(t, ['ملاحظة', 'note', 'اضف ملاحظة'])) return 'add_note';
    if(matchAny(t, ['الطلبات', 'orders', 'الحالية', 'فواتير'])) return 'get_open_orders';
    if(matchAny(t, ['حالة', 'status'])) return 'get_status';
    if(matchAny(t, ['تقرير يومي', 'daily report', 'يومي'])) return 'daily_report';
    if(matchAny(t, ['تقرير اسبوعي', 'weekly report', 'اسبوعي'])) return 'weekly_report';
    if(matchAny(t, ['فواتير', 'invoices'])) return 'invoices_list';
    if(matchAny(t, ['الحضور', 'attendance', 'حضور'])) return 'attendance';
    if(matchAny(t, ['盘点', 'جردة', 'inventory', 'المخزون'])) return 'inventory';
    if(matchAny(t, ['موظفين', 'employees', 'staff'])) return 'manage_employees';
    if(matchAny(t, ['الذاكرة', 'امسح', 'clear memory'])) return 'clear_memory';
    if(matchAny(t, ['ماذا تعلم', 'ما تعلمته', ' learned'])) return 'show_learned';
    return 'unknown';
}

const intentTests = [
    { text: 'افتح الطاولة 3', expected: 'open_table' },
    { text: 'اضف قهوة', expected: 'add_items' },
    { text: 'احذف الصنف الثاني', expected: 'remove_item' },
    { text: 'كم المجموع', expected: 'get_total' },
    { text: 'ادفع كاش', expected: 'process_payment' },
    { text: 'اغلق الطاولة', expected: 'close_table' },
    { text: 'انقل على 5', expected: 'transfer_table' },
    { text: 'تيك اواي 2 قهوة', expected: 'create_takeaway' },
    { text: 'تقرير يومي', expected: 'daily_report' },
    { text: 'الحضور', expected: 'attendance' },
    { text: 'امسح الذاكرة', expected: 'clear_memory' },
    { text: 'ماذا تعلمته', expected: 'show_learned' },
    { text: 'هلا', expected: 'unknown' },
];

let intentPassed = 0;
intentTests.forEach((test) => {
    const intent = detectIntent(test.text);
    const pass = intent === test.expected;
    intentPassed += pass ? 1 : 0;
    console.log(`  ${pass ? '✅' : '❌'} "${test.text}" => ${intent} (expected ${test.expected})`);
});
console.log(`  Result: ${intentPassed}/${intentTests.length} passed\n`);

// ===== 4. TEST Product Fuzzy Search =====
console.log('📝 [4/6] Testing Product Fuzzy Search...');

const sampleProducts = [
    { id: 1, nameAr: 'إسبريسو', nameEn: 'Espresso', price: 3000, category: 'قهوة' },
    { id: 2, nameAr: 'لاتيه', nameEn: 'Latte', price: 4000, category: 'قهوة' },
    { id: 3, nameAr: 'كابتشينو', nameEn: 'Cappuccino', price: 4000, category: 'قهوة' },
    { id: 4, nameAr: 'موكا', nameEn: 'Mocha', price: 4500, category: 'قهوة' },
    { id: 5, nameAr: 'فرابتشينو', nameEn: 'Frappuccino', price: 5000, category: 'مشروبات باردة' },
    { id: 6, nameAr: 'شاي أخضر', nameEn: 'Green Tea', price: 2500, category: 'شاي' },
    { id: 7, nameAr: 'شاي بالنعناع', nameEn: 'Mint Tea', price: 2500, category: 'شاي' },
];

const translitMap = { 'قهوة':'coffee', 'لاتيه':'latte', 'كابتشينو':'cappuccino', 'موكا':'mocha', 'اسبريسو':'espresso', 'شاي':'tea' };

function searchProducts(query, products) {
    const q = query.toLowerCase().trim();
    // Exact match
    let found = products.filter(p => p.nameAr.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q));
    if(found.length > 0) return found;
    // Transliteration
    const eng = translitMap[q];
    if(eng) {
        found = products.filter(p => p.nameEn.toLowerCase().includes(eng));
        if(found.length > 0) return found;
    }
    // Word fuzzy
    const qWords = q.split(/\s+/);
    return products.filter(p => {
        const allText = (p.nameAr + ' ' + p.nameEn + ' ' + p.category).toLowerCase();
        return qWords.some(w => w.length > 1 && allText.includes(w));
    });
}

const searchTests = [
    { query: 'قهوة', expectIds: [1] }, // should find via transliteration
    { query: 'لاتيه', expectIds: [2] },
    { query: 'latte', expectIds: [2] },
    { query: 'موكا', expectIds: [4] },
    { query: 'mocha', expectIds: [4] },
    { query: 'شاي', expectIds: [6, 7] },
    { query: 'كابوتشينو', expectIds: [3] }, // transliteration variant
    { query: 'فراب', expectIds: [5] }, // partial match
];

let searchPassed = 0;
searchTests.forEach((test) => {
    const results = searchProducts(test.query, sampleProducts);
    const foundIds = results.map(p => p.id);
    const pass = test.expectIds.every(id => foundIds.includes(id));
    searchPassed += pass ? 1 : 0;
    const names = results.map(p => p.nameAr).join(', ') || 'لا شيء';
    console.log(`  ${pass ? '✅' : '❌'} "${test.query}" => [${foundIds}] "${names}" (expected [${test.expectIds}])`);
});
console.log(`  Result: ${searchPassed}/${searchTests.length} passed\n`);

// ===== 5. TEST Learning System =====
console.log('📝 [5/6] Testing Learning Command Detection...');

const learnTests = [
    { text: 'علّمني ان الاتي يساوي 2 قهوة', type: 'teach_qa' },
    { text: 'تعلم من هذا النص: القهوة العربية مشروب تقليدي', type: 'learn_text' },
    { text: 'ماذا تعلمّت', type: 'show_learned' },
    { text: 'امسح الذاكرة', type: 'clear_memory' },
    { text: 'غلطت', type: 'correction' },
    { text: 'صححني', type: 'correction' },
    { text: 'اضف قهوة', type: 'not_learn' },
];

let learnPassed = 0;
learnTests.forEach((test) => {
    const t = test.text;
    let detectedType = 'not_learn';
    if(matchAny(t, ['علّمني', 'علم ان', 'اعلم ان'])) detectedType = 'teach_qa';
    else if(matchAny(t, ['تعلم من', 'اقرأ النص'])) detectedType = 'learn_text';
    else if(matchAny(t, ['ماذا تعلم', 'ما تعلمته', 'ما الذي تعلمته'])) detectedType = 'show_learned';
    else if(matchAny(t, ['امسح الذاكرة', 'امسح المحفوظات'])) detectedType = 'clear_memory';
    else if(matchAny(t, ['غلطت', 'خطا', 'صححني'])) detectedType = 'correction';

    const pass = detectedType === test.type;
    learnPassed += pass ? 1 : 0;
    console.log(`  ${pass ? '✅' : '❌'} "${test.text}" => ${detectedType} (expected ${test.type})`);
});
console.log(`  Result: ${learnPassed}/${learnTests.length} passed\n`);

// ===== 6. TEST Payment Split Calculation =====
console.log('📝 [6/6] Testing Payment Logic...');

function splitPayment(total, parts) {
    const each = Math.floor(total / parts);
    const remainder = total - (each * parts);
    return { each, remainder, parts };
}

const paymentTests = [
    { total: 10000, parts: 2, expectedEach: 5000, expectedRemainder: 0 },
    { total: 10000, parts: 3, expectedEach: 3333, expectedRemainder: 1 },
    { total: 15500, parts: 4, expectedEach: 3875, expectedRemainder: 0 },
    { total: 7000, parts: 3, expectedEach: 2333, expectedRemainder: 1 },
];

let paymentPassed = 0;
paymentTests.forEach((test) => {
    const result = splitPayment(test.total, test.parts);
    const pass = result.each === test.expectedEach && result.remainder === test.expectedRemainder;
    paymentPassed += pass ? 1 : 0;
    console.log(`  ${pass ? '✅' : '❌'} ${test.total}÷${test.parts} = ${result.each} (${result.remainder} remainder)`);
});
console.log(`  Result: ${paymentPassed}/${paymentTests.length} passed\n`);

// ===== SUMMARY =====
const totalTests = matchTests.length + entityTests.length + intentTests.length + searchTests.length + learnTests.length + paymentTests.length;
const totalPassed = matchPassed + entityPassed + intentPassed + searchPassed + learnPassed + paymentPassed;
const totalFailed = totalTests - totalPassed;

console.log('========================================');
console.log(`📊 RESULTS: ${totalPassed}/${totalTests} passed, ${totalFailed} failed`);
console.log('========================================');

if(totalFailed === 0) {
    console.log('🎉 ALL TESTS PASSED! البوت يعمل بشكل ممتاز!');
} else {
    console.log(`⚠️  ${totalFailed} اختبار فشل - يحتاج إصلاح`);
}

process.exit(totalFailed > 0 ? 1 : 0);
