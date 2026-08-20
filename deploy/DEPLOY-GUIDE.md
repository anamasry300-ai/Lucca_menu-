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

---

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
- **محتاجش** الـ Express backend تاني — Supabase بيعمل كل حاجة
- **محتاجش** SQLite — Supabase uses PostgreSQL
- **الـ Electron app** يقدر يفضل يشتغل offline مع IndexedDB + Supabase للـ sync

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
| البيانات ما بتظهرش | تأكد من RLS policies شغالة |
| الأزرار ما بتشتغلش | افتح Console (F12) وشوف الأخطاء |
| التحديث بطيء | تأكد من الـ internet + جرب page refresh |

---

## 📂 الملفات اللي أنشأناها

| الملف | الوظيفة |
|-------|---------|
| `deploy/supabase-schema.sql` | Database schema كامل لـ Supabase |
| `deploy/supabase-db.js` | بديل database.js يشتغل مع Supabase |
| `deploy/vercel.json` | إعدادات Vercel للنشر |

---

**باتمان جاهز للنشر!** 🦇

لو محتاج مساعدة في أي خطوة، قولي!
