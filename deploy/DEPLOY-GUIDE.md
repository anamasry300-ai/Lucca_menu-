# 🚀 LUCCA POS — خطوات النشر على Vercel + Supabase
# Lucca Caffè POS — Live Deployment Guide

---

## 📋 المعمارية الجديدة

```
┌─────────────────────────────────────────────────────────┐
│                    Vercel (Frontend)                     │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │  index.html   │    │ admin/index  │                   │
│  │  (POS Screen) │    │  (Dashboard) │                   │
│  └──────┬───────┘    └──────┬───────┘                   │
│         │                    │                            │
│         └────────┬───────────┘                            │
│                  │                                        │
│         ┌───────┴────────┐                               │
│         │ supabase-db.js │  ← بديل database.js           │
│         │ (Supabase SDK) │                               │
│         └───────┬────────┘                               │
└─────────────────┼────────────────────────────────────────┘
                  │ HTTPS
┌─────────────────┴────────────────────────────────────────┐
│                Supabase (Backend + DB)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Postgres │  │   Auth   │  │ Realtime │               │
│  │ Database │  │  (Login) │  │  (Sync)  │               │
│  └──────────┘  └──────────┘  └──────────┘               │
└──────────────────────────────────────────────────────────┘
```

> ## ⚠️ الخطوة الأهم الآن: طبقة المال الذرية (RPC) — إلزامية قبل التحصيل/الإلغاء في الوضع السحابي
>
> الواجهة تشتغل على GitHub Pages/Vercel وتقدر **تقرأ وتكتب** الجداول من كل الأجهزة، لكن التحصيل/الإلغاء
> (money) كان **ناقصاً في الوضع السحابي**: لا معاملة ذرية، لا خصم مخزون، لا منع استرداد مزدوج.
> الحل: دالتان PostgreSQL بـ `SECURITY DEFINER` تنفذان التحصيل والإلغاء **في معاملة واحدة** داخل قاعدة البيانات:
>
> 1. من **Supabase Dashboard** → **SQL Editor** → **New query**.
> 2. افتح ملف **`deploy/supabase-rpc-v1.sql`** والصقه بالكامل ثم **Run** (مرة واحدة؛ آمن لإعادة التشغيل).
> 3. تظهر رسالة نجاح: `LUCCA RPC v1 applied: checkout_order + void_order ready`.
> 4. الملف يضيف: أعمدة `sync_id`/بيانات الـ void، إنشاء `stock_movements` و `product_recipes`،
>    إنشاء `checkout_order(...)` و `void_order(...)`، ومنح anon حق التنفيذ.
>
> **لا حاجة لأي سيرفر إضافي** — كل جهاز يستدعي الدالة عبر `POST /rest/v1/rpc/checkout_order` بـ anon key.
> بدون تنفيذ الملف يظهر خطأ واضح يوجّهك للتشغيل وتظل الطلبات مفتوحة (لا خسارة ولا دفع مزيف).
>
> **التحقق بعد التنفيذ** (لو مشروعك الحالي `uudimvcdkaacqaxgajbk.supabase.co`):
> ```powershell
> $k='<anon key من supabase-db.js (SUPABASE_ANON_KEY)>'
> $h=@{apikey=$k;Authorization="Bearer $k"}
> # 1) الدالة موجودة ومتاحة:
> Invoke-RestMethod -Method Post -Uri "https://uudimvcdkaacqaxgajbk.supabase.co/rest/v1/rpc/checkout_order" -Headers $h -ContentType 'application/json' -Body '{"p_order_id":-1,"p_payment_method":"cash"}'
> # رد متوقع: JSON فيه "Order not found" (وليس خطأ "function does not exist").
> # 2) تحصيل سليم: أنشئ طلباً بـ items[{name,price,quantity}] عبر POST orders ثم استدعِ الدالة بمعرف الصف:
> Invoke-RestMethod -Method Post -Uri "https://uudimvcdkaacqaxgajbk.supabase.co/rest/v1/rpc/checkout_order" -Headers $h -ContentType 'application/json' -Body '{"p_order_id":<id>,"p_payment_method":"cash","p_change_amount":0}'
> # رد: {"success":true,"order":{... status:"closed", payment_status:"paid", total=مجموع items}}
> # 3) تكرار النداء بنفس p_payment_sync_id → {"already_processed":true} بلا دفعة مكررة.
> ```

## 📝 الخطوة 1: إنشاء حساب Supabase

1. ادخل على **https://supabase.com** وعمل **Sign Up**
2. اضغط **"New Project"**
3. اختار:
   - **Organization**: اعمل organization جديد باسم "Lucca"
   - **Project Name**: `lucca-pos`
   - **Database Password**: اختر كلمة سر قوية (احفظها!)
   - **Region**: اختار أقرب منطقة (EU West أو US East)
4. اضغط **"Create new project"**
5. **انتظر** 2-3 دقيقة لتجهيز المشروع

---

## 📝 الخطوة 2: إنشاء Database Schema

1. من Dashboard → اضغط **"SQL Editor"** (بالشريط الجانبي)
2. اضغط **"New query"**
3. افتح ملف `deploy/supabase-schema.sql` وانسخ محتواه بالكامل
4. الصق الكود في SQL Editor
5. اضغط **"Run"** (أزرق في الأسفل)
6. **تأكد** من عدم وجود أخطاء (أخضر ✅)

**بعد التنفيذ:**
- هتلاقي **25 جدول** جاهزة
- **Admin user** افتراضي: `admin / 123456`
- **14 طاولة** جاهزة
- **4 طرق دفع** جاهزة

---

## 📝 الخطوة 3: الحصول على Supabase Keys

1. من Dashboard → اضغط **"Settings"** (الإطار⚙️) → **"API"**
2. هتلاقي:
   - **Project URL**: `https://xxxxxxxx.supabase.co`
   - **anon public key**: `eyJhbG...` (طويلة)
3. **احتفظ** بهاتين القيمتين

---

## 📝 الخطوة 4: تعديل supabase-db.js

افتح ملف `deploy/supabase-db.js` وعدّل السطر الأول والثاني:

```javascript
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';  // ← حط Project URL بتاعك
const SUPABASE_ANON_KEY = 'eyJhbG...';                 // ← حط anon key بتاعك
```

---

## 📝 الخطوة 5: إعداد المشروع لـ Vercel

### أ. تجهيز المجلد

```
lucca-pos-web/
├── index.html              ← نسخة POS المعدلة
├── admin/
│   └── index.html          ← نسخة Dashboard المعدلة
├── ai-pos-engine.js
├── supabase-db.js          ← ملف Database الجديد
├── vercel.json
└── assets/                 ← أي صور أو ملفات ثابتة
```

### ب. تعديل index.html

في `index.html`، استبدل:
```html
<!-- القديم -->
<script src="admin/database.js"></script>

<!-- الجديد -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-db.js"></script>
```

### ج. تعديل admin/index.html

في `admin/index.html`، استبدل:
```html
<!-- القديم -->
<script src="database.js"></script>

<!-- الجديد -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../supabase-db.js"></script>
```

---

## 📝 الخطوة 6: نشر على Vercel

### الطريقة 1: Vercel CLI
```bash
# تثبيت Vercel CLI
npm i -g vercel

# الدخول على Vercel
vercel login

# نشر المشروع
cd lucca-pos-web
vercel

# نشر للـ Production
vercel --prod
```

### الطريقة 2: GitHub + Vercel (مُوصى به)
1. اعمل **GitHub repo** جديد باسم `lucca-pos-web`
2. ارفع الملفات عليه
3. ادخل على **https://vercel.com** وعمل **Sign In with GitHub**
4. اضغط **"New Project"**
5. اختار الـ repo بتاعك
6. Vercel هيكشف تلقائياً إنه **Static Site**
7. اضغط **"Deploy"**
8. **بعد دقيقة** هتلاقي المشروع شغال على رابط زي:
   `https://lucca-pos-web.vercel.app`

---

## 📝 الخطوة 7: اختبار المشروع لايف

1. افتح `https://lucca-pos-web.vercel.app`
2. سجل دخول بـ: `admin / 123456`
3. جرّب:
   - ✅ عرض المنتجات
   - ✅ فتح طاولة
   - ✅ إضافة منتجات
   - ✅ الدفع
   - ✅ التقارير
   - ✅ البوت

---

## 📝 الخطوة 8: النطاق المخصص (Domain)

1. من Vercel Dashboard → اضغط على المشروع
2. اذهب لـ **"Settings"** → **"Domains"**
3. اكتب النطاق بتاعك مثل: `pos.luccacaffe.com`
4. Vercel هيدلك على إعدادات **DNS**:
   - أضف **CRecord** أو **A Record** حسب تعليماتهم
5. **انتظر** لحد ما يتشيك (minutes to hours)
6. هيشتغل على: `https://pos.luccacaffe.com` ✅

---

## ⚡ ملاحظات مهمة

### الأمان
- **RLS مفعّل** على كل الجداول (بس policies مفتوحة حالياً)
- **انصح** تضيف auth policies أقوى لو هtbui المستخدمين كتير
- **_supabase_anon_key** آمنة للـ client (مصممة للـ frontend)
- **Database Password** متستخدمش في الكود — ده للـ Supabase Dashboard بس

### الـ Backend القديم
- **محتاجش** الـ Express backend تاني — Supabase بيعمل كل حاجة (بعد تنفيذ `supabase-rpc-v1.sql`)
- **محتاجش** SQLite — Supabase uses PostgreSQL
- **الـ Electron app** يقدر يفضل يشتغل offline مع IndexedDB + Supabase للـ sync

### التبديل بين الوضعين (محلي / سحابي)
- من **لوحة التحكم** → صفحة "إعدادات الخادم" → "مصدر البيانات" (المبدّل الجديد)، أو يدوياً:
  - `localStorage.setItem('luccaDataMode','local')` → البيانات عبر IndexedDB + خادم localhost/SQLite
  - `localStorage.setItem('luccaDataMode','supabase')` → البيانات والمال عبر Supabase أونلاين
- في الوضع **السحابي**: التحصيل/الإلغاء عبر RPC ذري — محظور أي كتابة نقدية محلية/يدوية (مثل الوضع المحلي تماماً).

### التكاليف (Pricing)
| Plan | Price | يكفي؟ |
|------|-------|--------|
| **Free** | $0/شهر | ✅ يكفي للمقاهي الصغيرة (500MB DB, 1GB bandwidth) |
| **Pro** | $25/شهر | ✅ للمقاهي الكبيرة (8GB DB, 100GB bandwidth) |

### السرعة
- **Supabase**: سيرفرات في أوروبا وأمريكا — سريع جداً
- **Vercel**: CDN عالمي — الصفحة تفتح في أقل من ثانية
- **Realtime**: التحديثات تظهر فوراً على كل الأجهزة

---

## 🔧 troubleshooting (حل المشاكل)

| المشكلة | الحل |
|---------|------|
| الصفحة ما بتفتحش | تأكد إن `supabase-db.js` فيه URL و Key صحيحين |
| "Failed to fetch" | تأكد من internet + إن Supabase project شغال |
| رسالة "function does not exist"/"checkout_order غير موجودة" | لم تنفّذ `deploy/supabase-rpc-v1.sql` — نفّذه من SQL Editor ثم أعد المحاولة |
| التحصيل رُفض بـ 409 "لا يطابق إجمالي الطلب" | مبلغ الدفعات ≠ مجموع الأصناف — تأكد من الأصناف في الطلب |
| عجز مخزون عند التحصيل | خصص $allowNegativeStock لـ true (أو وفّر الكميات) |
| البيانات ما بتظهرش | تأكد من RLS policies شغالة |
| الأزرار ما بتشتغلش | افتح Console (F12) وشوف الأخطاء |
| التحديث بطيء | تأكد من الـ internet + جرب page refresh |

---

## 📂 الملفات اللي أنشأناها

| الملف | الوظيفة |
|-------|---------|
| `deploy/supabase-schema.sql` | Database schema كامل (النسخة المطبقة فعلياً في القاعدة الحالية — snake_case) |
| `deploy/supabase-rpc-v1.sql` | **طبقة المال الذرية (إلزامي)**: `checkout_order` + `void_order` + أعمدة/جداول ناقصة + GRANT anon |
| `deploy/supabase-schema-v2.sql` | مخطط v2 الأحدث (لم يُطبَّق على القاعدة الحالية) |
| `deploy/supabase-db.js` | نسخة قديمة من الـ adapter (النسخة الفعّالة في الجذر الآن: `supabase-db.js`) |
| `deploy/vercel.json` | إعدادات Vercel للنشر |

---

**باتمان جاهز للنشر!** 🦇

لو محتاج مساعدة في أي خطوة، قولي!
