@echo off
title Lucca Caffè POS - تشغيل سريع

:: التحقق من وجود Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [خطأ] Node.js غير مثبت. قم بتثبيته من https://nodejs.org
    pause
    exit /b 1
)

:: التحقق من تثبيت Electron
if not exist "node_modules\.bin\electron.cmd" (
    echo [خطأ] Electron غير مثبت. قم بتشغيل build.bat أولاً
    pause
    exit /b 1
)

echo جاري تشغيل Lucca Caffè POS...
start "" cmd /c "npx electron ." 
exit
