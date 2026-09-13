/*
╔══════════════════════════════════════════════════════════════╗
║  Unit tests — LUCCA «اسأل باتمان» Query Layer (قراءة فقط)      ║
║  تشغيل: node tests/batman-questions.test.js                   ║
╚══════════════════════════════════════════════════════════════╝
*/
'use strict';
const assert = require('node:assert');
const Q = require('../batman-questions.js');

// صف سطر محدد نعرف نتيجته لكل دالة (بيانات تجريبية ثابتة)
function dt(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

// لحظة "الآن" الثابتة: 10 يونيو 2026، منتصف النهار (توقيت محلي)
const NOW = new Date(2026, 5, 10, 15, 0, 0);
const today = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 12, 0, 0);
const yesterday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 12, 0, 0);
const sixDaysAgo = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 6, 12, 0, 0);
const tenDaysAgo = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 10, 12, 0, 0);

function row(eventId, action, decision, reason, actorRole, actorName, amount, createdAt) {
    return { eventId, action, decision, reason, actorRole, actorName, amount, createdAt: dt(createdAt) };
}

const ROWS = [
    row('evt-1', 'add_expense', 'needs_approval', 'المبلغ يتجاوز الحد — يتطلب موافقة', 'cashier', 'حسام', 1200, today),
    row('evt-2', 'update_price', 'blocked', 'يتطلب دور manager على الأقل', 'cashier', 'حسام', 0, yesterday),
    row('evt-3', 'add_expense', 'executed', 'ضمن الحد التلقائي', 'cashier', 'سارة', 120, today),
    row('evt-4', 'record_invoice', 'needs_approval', 'غير تلقائي للكاشير', 'cashier', 'سارة', 2000, sixDaysAgo),
    row('evt-5', 'add_purchase', 'blocked', 'دور أدنى من minRole', 'cashier', 'حسام', 0, tenDaysAgo),
    row('evt-6', 'add_expense', 'executed', 'ضمن الحد', 'manager', 'أحمد', 50, sixDaysAgo),
    row('evt-7', 'update_price', 'blocked', 'يتطلب موافقة إدارية', 'cashier', 'محمد', 0, today),
];

let passed = 0;
const pending = [];
function test(name, fn) {
    pending.push({ name, fn });
}
async function runAll() {
    for (const t of pending) {
        try { await t.fn(); passed++; console.log('OK  ' + t.name); }
        catch (e) { console.error('FAIL ' + t.name + ' :: ' + e.message); process.exitCode = 1; }
    }
}
function ids(res) { return (res.flagged || res.attempts || res.decisions || []).map((x) => x.eventId).sort(); }

test('normalizeRows يحوّل الصفوف ويحافظ على الحقول', () => {
    const arr = Q._core.normalizeRows(ROWS.map((r) => ({ ...r, requestJson: '{"a":1}' })));
    assert.strictEqual(arr.length, 7);
    assert.strictEqual(arr[0].action, 'add_expense');
    assert.deepStrictEqual(arr[0].requestJson, { a: 1 });
    assert.strictEqual(arr[0].createdAt instanceof Date, true);
});

test('getFlaggedToday: القرارات المعلّقة/المرفوضة "اليوم" فقط', () => {
    const r = Q._core.getFlaggedToday(ROWS, { now: NOW });
    assert.strictEqual(r.total, 2);
    assert.deepStrictEqual(ids(r).sort(), ['evt-1', 'evt-7']);
});

test('getTopRequestersByAction: تجميع وترتيب حسب المطلوبين في الأسبوع', () => {
    const r = Q._core.getTopRequestersByAction(ROWS, { period: 'week', now: NOW });
    assert.strictEqual(r.period, 'week');
    assert.strictEqual(r.total, 4); // evt-1, evt-2, evt-4, evt-7
    assert.strictEqual(r.top[0].actor, 'حسام');
    assert.strictEqual(r.top[0].count, 2);
});

test('getBlockedAttempts: عدّ المرفوضات + فلترة actionType', () => {
    const all = Q._core.getBlockedAttempts(ROWS, { period: 'all', now: NOW });
    assert.strictEqual(all.count, 3); // evt-2, evt-5, evt-7
    assert.deepStrictEqual(ids(all).sort(), ['evt-2', 'evt-5', 'evt-7']);
    all.attempts.forEach((a) => assert.ok(a.reason && a.reason.length > 0, 'السبب مطلوب'));

    const up = Q._core.getBlockedAttempts(ROWS, { period: 'all', actionType: 'update_price', now: NOW });
    assert.strictEqual(up.count, 2);
    assert.deepStrictEqual(ids(up).sort(), ['evt-2', 'evt-7']);
});

test('getApprovalTrend: التوزيع اليومي عبر 3 أيام', () => {
    const r = Q._core.getApprovalTrend(ROWS, { days: 3, now: NOW });
    assert.strictEqual(r.days, 3);
    assert.strictEqual(r.trend.length, 3);
    const last = r.trend[2]; // 10 يونيو
    assert.strictEqual(last.needs_approval, 1); // evt-1
    assert.strictEqual(last.blocked, 1);        // evt-7
    assert.strictEqual(last.executed, 1);       // evt-3
});

test('getApprovalTrend: حد أقصى لـ days (90)', () => {
    const r = Q._core.getApprovalTrend(ROWS, { days: 500, now: NOW });
    assert.strictEqual(r.days, 90);
});

test('getActionsByType: كل قرارات add_expense في الأسبوع', () => {
    const r = Q._core.getActionsByType(ROWS, { actionType: 'add_expense', period: 'week', now: NOW });
    assert.strictEqual(r.count, 3); // evt-1, evt-3, evt-6
    assert.strictEqual(r.decisionCounts.needs_approval, 1);
    assert.strictEqual(r.decisionCounts.executed, 2);
    assert.deepStrictEqual(ids(r).sort(), ['evt-1', 'evt-3', 'evt-6']);
});

test('getActionsByType بدون actionType يُرجع صفراً بأمان', () => {
    const r = Q._core.getActionsByType(ROWS, { period: 'all', now: NOW });
    assert.strictEqual(r.count, 0);
});

test('detectWriteIntent: طلبات التنفيذ/الكتابة تُمنع بوضوح', () => {
    assert.strictEqual(Q._core.detectWriteIntent('وافق على المصروف ده'), true);
    assert.strictEqual(Q._core.detectWriteIntent('سجّل مصروف 500 كهرباء'), true);
    assert.strictEqual(Q._core.detectWriteIntent('نفّذ القرار'), true);
    assert.strictEqual(Q._core.detectWriteIntent('نفّذ تعديل سعر لاتيه'), true);
});

test('detectWriteIntent: أسئلة القراءة لا تُرفض خطأً', () => {
    assert.strictEqual(Q._core.detectWriteIntent('ايه المصروفات اللي احتاجت موافقتي النهاردة؟'), false);
    assert.strictEqual(Q._core.detectWriteIntent('مين أكتر حد طلب صلاحيات محتاجة approval الأسبوع ده؟'), false);
    assert.strictEqual(Q._core.detectWriteIntent('فيه محاولات update_price اتحظرت؟ ليه؟'), false);
    assert.strictEqual(Q._core.detectWriteIntent('قارن مصروفات الأسبوع ده بالي قبله'), false);
    assert.strictEqual(Q._core.detectWriteIntent('مين سجّل المصروف النهاردة؟'), false);
});

test('canonicalRole في بيئة Node (بلا window) = fail-closed cashier', () => {
    assert.strictEqual(Q._core.canonicalRole(), 'cashier');
    assert.strictEqual(Q._core.isManagerIdentity(), false);
});

test('ask يرفض غير المدير مسبقاً (بدون أي طلب شبكة)', async () => {
    const r = await Q.ask('ايه المصروفات اللي احتاجت موافقتي النهاردة؟');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.denied, true);
});

// استدعاء القرار الحتمي (بلا window) — يمر بمسار الرفض/لا شبكة بحكم fail-closed
test('plainSummary ينتج نصاً مقروءاً من نتائج مهيكلة', () => {
    const res = [{ tool: 'getFlaggedToday', data: Q._core.getFlaggedToday(ROWS, { now: NOW }) }];
    const text = Q.plainSummary(res);
    assert.ok(text.includes('evt-1') || text.includes('add_expense'));
    assert.ok(text.length > 10);
});

runAll().then(() => {
    console.log(passed + ' اختبارات ناجحة.');
    if (process.exitCode) console.error('يوجد اختبارات فاشلة.');
});