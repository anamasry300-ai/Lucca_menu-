# Batman Architecture (Contract)

> المستند: `docs/BATMAN_ARCHITECTURE.md` — مخرج Phase 1.
> الحالة: عقد تصميمي إلزامي لـ Phase 7-9. لا تعديل كود هنا.

---

## 1) سلسلة التنفيذ الإلزامية

```
User (بطاقة دردشة/أداة)
  → Batman (Interpretation Layer — نية فقط)
    → Intent (نية منظمة: action + params + actor)
      → Permission (permissionService.decide(actorRole, action, amount))
        → Tool Registry (أداة مسجّلة وموصفة فقط — لا كود ديناميكي)
          → Business Service (AccountingService / SalesService / InventoryService / …)
            → Repository (_ordersRepo / inventoryRepo / …)
              → Database (SQLite محلياً أو RPC سحابياً)
                → Validated Result (نتيجة مُتحقَّق منها + audit eventId)
                  → Batman (تلميح للعرض فقط)
                    → User
```

**باتمان منطَّق تفسيري غير موثوق (untrusted reasoning layer)** — لا سلطة مباشرة على البيانات إطلاقاً.

---

## 2) الممنوعات (Never Rules)

1. **لا LLM → SQL مباشرة** — لا توليد استعلام، لا نص SQL يُبنى من مخرجات النموذج.
2. **لا كتابة مباشرة من أداة** — كل كتابة تمرّ Business Service → Repository → حارس الصلاحيات.
3. **لا تخطّي RBAC** — `permissionService.decide()` تُستدعى قبل أي أداة كتابة، وقرار `blocked` نهائي.
4. **لا أداة غير مسجّلة** — الأدوات تُعرَّف في Registry ثابت (compile-time)، والنموذج يختار من القائمة فقط.
5. **لا تخزين بيانات مستقل لباتمان** — يقرأ من جداول النظام (batman_decisions، …) عبر خدمات موحّدة، ولا يمتلك نسخة إرقام خاصة.
6. **لا مفاتيح API من الشات** — لا ضبط `OPENAI_KEY`/`OpenAI` من غرفة الدردشة (قرار أمان P8).
7. **لا اعتماد على مخرجات LLM كحقيقة** — الأرقام تُشتق من Query منظمة دائمًا، والنموذج يُلخّص ولا يحسب (قواعد `summarizeSystem` الحالية).
8. **لا prompt يكتب إلى DB** — كل مدخل خارجي (نص المستخدم، محتوى RAG، ردّ النموذج) يُعامَل untrusted: تُنقّى قبل العرض (escHtml) ولا تدخل سياق الأوامر كتعليمات.

---

## 3) عقد الأداة (Tool Contract)

كل أداة في الـ Registry تُعرَّف بهذا الشكل الإلزامي:

```json
{
  "name": "snake_case فريد",
  "description": "وصف دقيق ما تفعله — بالعربية",
  "inputSchema": { "type": "object", "properties": {…}, "required": [...] },
  "permission": "sales.create | expenses.create | reports.view | …",
  "readOnly": true | false,
  "requiresConfirmation": true | false,
  "handler": "BusinessService.method",
  "auditAction": "اسم مسجل في batman_decisions.action",
  "resultSchema": { "type": "object", "properties": {…} }
}
```

- **readOnly: true** → تُستدعى مباشرة بعد فحص `permission`.
- **readOnly: false** → تمرّ: `permissionService.decide()` → (إن `needs_approval` أو `high_value_explicit_confirm`: تأكيد صريح من المستخدم يُسجَّل) → Business Service → `logDecision()` بـ `eventId` idempotent.
- **resultSchema** إلزامي: نتيجة غير مطابقة = خطأ أداة، لا تُمرَّر للنموذج.

---

## 4) سجل الأدوات الحالي (المادة الخام للـ Registry)

### 4.1 أدوات POS التنفيذية (`ai-pos-engine.js:296-322` — BMRuntimeTools/listTools)

| الأداة | نوع | تأكيد | ملاحظة عقدية |
|---|---|---|---|
| open_table | كتابة (طاولة) | لا | tables.write |
| add_items | كتابة (طلب) | لا | orders.write |
| remove_item | كتابة | **نعم** | orders.write |
| close_table | كتابة مالية | **نعم** | checkout → SalesService |
| process_payment | كتابة مالية | **نعم** | checkout → SalesService |
| split_payment | كتابة مالية | **نعم** | paymentSyncId ثابت إلزامي |
| get_open_tables / get_open_orders / view_expenses / view_employees / view_inventory / drawer_status | قراءة | لا | permission قراءة مطابق |
| send_to_kitchen / set_ready / add_note / transfer_table / merge_tables | كتابة تشغيلية | نقل/دمج: تأكيد | orders.write |
| add_expense | كتابة مالية | **نعم** (> 500 explicit) | batman_permissions: ≤500 تلقائي للكاشير |
| record_invoice | كتابة مالية | **نعم** | ≤1000 تلقائي (recordManualInvoice → checkout) |
| add_purchase | كتابة | **نعم** | ≥1000 موافقة manager |
| add_employee / employee_attendance / employee_leave | كتابة موظفين | إضافة: نعم | employees.write |
| update_price | كتابة تسعير | **نعم** | minRole manager دائمًا |
| sales_report / expenses_report / daily_summary | قراءة | لا | reports.read (+financial للأرباح) |

### 4.2 أدوات قرارات الصلاحيات (`batman-questions.js:263-269` — TOOLS/TOOL_SCHEMAS)

`getFlaggedToday`, `getTopRequestersByAction`, `getBlockedAttempts`, `getApprovalTrend`, `getActionsByType` — **كلها readOnly** وتقرأ `GET /api/batman/decisions` (403 لغير manager). حارس موجود: `detectWriteIntent()` يمنع أي نية كتابة في الشات (`denialMessage`).

### 4.3 أرقام اللوحة (selectionSystem الحالية)

`getSalesToday, getExpensesToday, getLowStock, getTopProducts, getSystemHealth` — readOnly من ReportingService.

**الانتقال (Phase 7):** كل ما سبق يُعاد تسجيله في Registry واحد بالعقد §3 — لا تُحذف أداة، تُوسَم وتُربط بـ permission/handler/auditAction.

---

## 5) قرارات أمان (إلزامية)

| # | التهديد | القرار |
|---|---|---|
| A1 | XSS عبر `innerHTML` لنصوص LLM/RAG (`batman-dashboard.js:1085,1100`, `batman-questions.js:596`) | **escHtml إلزامي** على كل نص غير ثابت قبل أي إدراج — Phase 7 |
| A2 | Prompt injection عبر سياق DB الخام (buildContext/buildLiveContext) | بيانات DB تُحقن كـ **بيانات غير موثوقة** بين وسوم، لا كتعليمات؛ تعليمات النظام في system prompt ثابت منفصل |
| A3 | LLM يدّعي تنفيذ أمر | النموذج يخرج Intent/JSON فقط؛ التنفيذ يتحقق عبر Permission + Tool Registry؛ الرد «نُفِّذ» بلا eventId = كذبة تُرفض عرضيًا |
| A4 | مفتاح OpenAI في localStorage وقابل للضبط من الشات | المفاتيح env/backend فقط؛ لا قناة ضبط من الدردشة — Phase 8 |
| A5 | SSRF عبر proxy-llm | القارس الحالي (قائمة مضيفين + منع private/metadata) مُثبَّت بالاختبارات p1-followup — يبقى |
| A6 | تنفيذ مزدوج (retry) | `eventId` idempotent في audit/actions — نفس نمط paymentSyncId |
| A7 | عدم توفّر LLM (llmReady false) | fallback قواعد محلية حالية يبقى — Batman لا يتعطّل لغياب النموذج |

---

## 6) طبقتا الصلاحيات (تكامل مع RBAC)

```
الأداة الكتابية
  ├─ الطبقة 1: RBAC خام — roleHas(role, tool.permission)  → إن فاشل: blocked
  └─ الطبقة 2: مصفوفة batman_permissions — decide(role, action, amount)
        blocked | under_threshold | needs_approval | high_value_explicit_confirm | executed
        → needs_approval: ينتظر موافقة manager عبر لوحة القرارات
        → كل محاولة تُسجَّل في batman_decisions (stat + مدخل batman-questions)
```

الحارسان مستقلتان ومتتاليتان (كلاهما يمنع) — إزالة أي منهما مخالفة للعقد.
