@echo off
title بناء برنامج Lucca Caffè POS

echo.
echo ========================================
echo    بناء برنامج Lucca Caffè POS
echo ========================================
echo.

:: التحقق من وجود Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [خطأ] Node.js غير مثبت. قم بتثبيته من https://nodejs.org
    pause
    exit /b 1
)

:: تثبيت الاعتماديات
echo [1/3] جاري تثبيت الاعتماديات...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [خطأ] فشل تثبيت الاعتماديات
    pause
    exit /b 1
)

:: توليد الأيقونة
echo [2/3] جاري توليد الأيقونة...
call npm run icon
if %ERRORLEVEL% neq 0 (
    echo [خطأ] فشل توليد الأيقونة
    pause
    exit /b 1
)

:: بناء البرنامج
echo [3/3] جاري بناء البرنامج...
call npx electron-packager . LuccaPOS --platform=win32 --arch=x64 --out=dist --overwrite --asar --icon=icon --ignore=node_modules --ignore=\.git$ --ignore=README\.md$ --ignore=backend --ignore=dist --ignore=scripts --ignore=\.bat$ --ignore=\.md$ --ignore=icon\.svg$ --ignore=icon-tmp
if %ERRORLEVEL% neq 0 (
    echo [خطأ] فشل بناء البرنامج
    pause
    exit /b 1
)

echo.
echo ========================================
echo    تم البناء بنجاح!
echo.
echo ========================================
echo    تم إنشاء البرنامج في المجلد:
echo    dist\LuccaPOS-win32-x64\
echo.
echo    شغّل البرنامج من:
echo    dist\LuccaPOS-win32-x64\LuccaPOS.exe
echo ========================================
echo.
pause
