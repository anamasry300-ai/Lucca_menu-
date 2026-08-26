@echo off
chcp 65001 >nul
title LUCCA POS - تحديث البرنامج
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║     LUCCA POS - تحديث البرنامج       ║
echo  ╚═══════════════════════════════════════╝
echo.

REM ═══════════════════════════════════════
REM  الطريقة 1: لو عندك مسار الواي فاي / الشبكة
REM  اكتب المسار هنا ومثلا: \\LAPTOP-NAME\shared\LuccaPOS
REM ═══════════════════════════════════════
set NETWORK_PATH=

REM ═══════════════════════════════════════
REM  الطريقة 2: لو عايز تنسخ على فلاشة
REM  حط الفلاشة واكتب حرفها (مثلا E:)
REM ═══════════════════════════════════════
set USB_DRIVE=

set SOURCE=%~dp0

REM ════════ تحديد مسار الوجهة ════════
if defined NETWORK_PATH (
    set DEST=%NETWORK_PATH%
    goto :found
)
if defined USB_DRIVE (
    set DEST=%USB_DRIVE%\LuccaPOS-update
    goto :found
)

REM لو مفيش مسار، اسأل المستخدم
echo  أدخل مسار الجهاز التاني:
echo  مثال: \\DESKTOP-ABC\LuccaPOS
echo  أو حرف الفلاشة: E:
echo.
set /p DEST="المسار: "

if "%DEST%"=="" (
    echo  ❌ مفيش مسار! اخرج.
    pause
    exit /b 1
)

:found

echo.
echo  📁 المصدر: %SOURCE%
echo  📁 الوجهة: %DEST%
echo.

REM ════════ نسخ الملفات الأساسية ════════
echo  📋 جاري نسخ الملفات الأساسية...
if not exist "%DEST%" mkdir "%DEST%"

copy /Y "%SOURCE%index.html" "%DEST%\index.html" >nul 2>&1
copy /Y "%SOURCE%styles.css" "%DEST%\styles.css" >nul 2>&1
copy /Y "%SOURCE%main.js" "%DEST%\main.js" >nul 2>&1
copy /Y "%SOURCE%preload.js" "%DEST%\preload.js" >nul 2>&1
copy /Y "%SOURCE%ai-pos-engine.js" "%DEST%\ai-pos-engine.js" >nul 2>&1
copy /Y "%SOURCE%supabase-db.js" "%DEST%\supabase-db.js" >nul 2>&1
copy /Y "%SOURCE%sync-engine.js" "%DEST%\sync-engine.js" >nul 2>&1
copy /Y "%SOURCE%report-export.js" "%DEST%\report-export.js" >nul 2>&1
copy /Y "%SOURCE%forecasting.js" "%DEST%\forecasting.js" >nul 2>&1
copy /Y "%SOURCE%knowledge-base.js" "%DEST%\knowledge-base.js" >nul 2>&1
copy /Y "%SOURCE%package.json" "%DEST%\package.json" >nul 2>&1
copy /Y "%SOURCE%version.json" "%DEST%\version.json" >nul 2>&1

REM ════════ نسخ مجلد admin ════════
echo  📂 جاري نسخ مجلد admin...
if not exist "%DEST%\admin" mkdir "%DEST%\admin"
xcopy /Y /E /Q "%SOURCE%admin\*.*" "%DEST%\admin\" >nul 2>&1

REM ════════ لو الوجهة مجلد dist ════════
if exist "%DEST%\resources\app\index.html" (
    echo  🔄 تحديث portable build...
    set APP_DEST=%DEST%\resources\app
    copy /Y "%SOURCE%index.html" "!APP_DEST!\index.html" >nul 2>&1
    copy /Y "%SOURCE%styles.css" "!APP_DEST!\styles.css" >nul 2>&1
    copy /Y "%SOURCE%main.js" "!APP_DEST!\main.js" >nul 2>&1
    copy /Y "%SOURCE%ai-pos-engine.js" "!APP_DEST!\ai-pos-engine.js" >nul 2>&1
    copy /Y "%SOURCE%supabase-db.js" "!APP_DEST!\supabase-db.js" >nul 2>&1
    copy /Y "%SOURCE%sync-engine.js" "!APP_DEST!\sync-engine.js" >nul 2>&1
    copy /Y "%SOURCE%report-export.js" "!APP_DEST!\report-export.js" >nul 2>&1
    copy /Y "%SOURCE%forecasting.js" "!APP_DEST!\forecasting.js" >nul 2>&1
    copy /Y "%SOURCE%knowledge-base.js" "!APP_DEST!\knowledge-base.js" >nul 2>&1
    xcopy /Y /E /Q "%SOURCE%admin\*.*" "!APP_DEST!\admin\" >nul 2>&1
)

echo.
echo  ╔═══════════════════════════════════════╗
echo  ║       ✅ تم التحديث بنجاح!           ║
echo  ╚═══════════════════════════════════════╝
echo.
echo  الملفات المحدثة:
echo    • index.html          - الصفحة الرئيسية
echo    • styles.css          - التصميم
echo    • main.js             - Electron
echo    • ai-pos-engine.js    - Batman AI
echo    • supabase-db.js      - قاعدة البيانات
echo    • admin/database.js   - لوحة التحكم
echo    • admin/index.html    - لوحة التحكم
echo    • phone → 01010058989
echo    • فاتورة حرارية جديدة
echo    • أزرار الدفع
echo.
echo  🔄 أعد تشغيل LuccaPOS على الجهاز التاني.
echo.
pause
