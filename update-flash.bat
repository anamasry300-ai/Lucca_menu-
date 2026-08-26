@echo off
chcp 65001 >nul
echo ============================================
echo    LUCCA POS - تحديث الفلاشة
echo ============================================
echo.

REM Set paths
set SOURCE=%~dp0
set DEST=%SOURCE%dist\LuccaPOS-win32-x64\resources\app

echo جاري نسخ الملفات المحدثة...
echo.

REM Copy updated files
copy /Y "%SOURCE%index.html" "%DEST%\index.html" >nul
copy /Y "%SOURCE%styles.css" "%DEST%\styles.css" >nul
copy /Y "%SOURCE%main.js" "%DEST%\main.js" >nul
copy /Y "%SOURCE%preload.js" "%DEST%\preload.js" >nul
copy /Y "%SOURCE%ai-pos-engine.js" "%DEST%\ai-pos-engine.js" >nul
copy /Y "%SOURCE%supabase-db.js" "%DEST%\supabase-db.js" >nul
copy /Y "%SOURCE%sync-engine.js" "%DEST%\sync-engine.js" >nul
copy /Y "%SOURCE%menu-data.js" "%DEST%\menu-data.js" >nul
copy /Y "%SOURCE%report-export.js" "%DEST%\report-export.js" >nul
copy /Y "%SOURCE%forecasting.js" "%DEST%\forecasting.js" >nul
copy /Y "%SOURCE%knowledge-base.js" "%DEST%\knowledge-base.js" >nul
copy /Y "%SOURCE%package.json" "%DEST%\package.json" >nul
copy /Y "%SOURCE%version.json" "%DEST%\version.json" >nul

REM Copy admin folder
xcopy /Y /E "%SOURCE%admin" "%DEST%\admin\" >nul

echo ============================================
echo    تم التحديث بنجاح!
echo ============================================
echo.
echo الملفات جاهزة في:
echo %DEST%
echo.
echo انسخ مجلد LuccaPOS-win32-x64 على الفلاشة
echo.
pause
