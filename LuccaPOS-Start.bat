@echo off
setlocal EnableDelayedExpansion
title LuccaPOS - Launcher
REM ============================================================
REM  Lucca Caffe POS - Cheap Fix Launcher (1 click)
REM  يبدأ: (1) Backend Express على http://localhost:3000
REM         (2) تطبيق Electron (POS)
REM  Byda3ammal من أي مكان (يستخدم مسار الملف نفسه)
REM ============================================================

cd /d "%~dp0"

echo ============================================
echo    LuccaPOS Launcher
echo ============================================

REM -- 1) التحقق من Node.js ---------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js غير مثبت على الجهاز.
  pause
  exit /b 1
)

REM -- 2) بناء الباك إند إن لم يكن dist موجودا ---
if exist "backend\dist\index.js" (
  echo [1/3] نسخة الباك إند جاهزة (backend\dist).
) else (
  echo [1/3] جاري بناء الباك إند لأول مرة...
  pushd backend
  call npm install --silent
  call npm run build
  popd
  if errorlevel 1 (
    echo [ERROR] فشل بناء الباك إند. راجع terminal.
    pause
    exit /b 1
  )
)

REM -- 3) هل الباك إند شغال فعلا على :3000 ؟ ---
set BACKEND_UP=0
for /f %%c in ('curl.exe -s -o nul -w "%%{http_code}" --max-time 2 http://127.0.0.1:3000/health 2^>nul') do set BACKEND_UP=%%c
if "%BACKEND_UP%"=="200" (
  echo [2/3] الباك إند شغال بالفعل على http://localhost:3000
) else (
  echo [2/3] جاري تشغيل الباك إند...
  start "LuccaPOS Backend" /min cmd /c "cd /d ""%~dp0backend"" && node dist/index.js 1>""%TEMP%\lucca-backend.log"" 2>&1"
  timeout /t 4 /nobreak >nul
  set BACKEND_UP=000
  for /f %%c in ('curl.exe -s -o nul -w "%%{http_code}" --max-time 2 http://127.0.0.1:3000/health 2^>nul') do set BACKEND_UP=%%c
  if "!BACKEND_UP!"=="200" (
    echo        الباك إند اشتغل. [OK]
  ) else (
    echo [WARN] الباك إند لم يستجب بعد 4 ثوان - راجع: %TEMP%\lucca-backend.log
  )
)

REM -- 4) تشغيل التطبيق -------------------------
echo [3/3] تشغيل LuccaPOS Electron...
start "" cmd /c "cd /d ""%~dp0"" && npm start"

echo.
echo تم التشغيل. اغلاق هذا الملف لا يغلق التطبيق.
echo ============================================
exit /b 0