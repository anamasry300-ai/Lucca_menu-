@echo off
setlocal EnableDelayedExpansion
REM ============================================================
REM  LuccaPOS - GitHub Backup (git commit + push للأصل)
REM  الاستخدام:  من مجلد المشروع نفّذ
REM      scripts\backup-github.cmd
REM  - يستثني: test.txt (ملف مذاكرة مؤقت)
REM  - لا يرفع: dist\ , node_modules\ , backend\data\ , .env
REM  (مضمونة في .gitignore)
REM ============================================================

cd /d "%~dp0.."

echo ============================================
echo    GitHub Backup - %date% %time%
echo ============================================

for /f "tokens=1-3 delims=/ " %%a in ('echo %date%') do set D=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('echo %time%') do set T=%%a%%b
set MSG=backup: auto save %D% %T%

echo [1/4] git add (مع استثناء test.txt) ...
git add -A -- . ":(exclude)test.txt" || goto :err

git diff --cached --quiet
if %errorlevel% == 0 (
  echo [2/4] لا توجد تغييرات جديدة - لا حاجة لـ commit.
  goto :end
)

echo [2/4] commit: "%MSG%"
git commit -m "%MSG%" || goto :err

echo [3/4] push إلى origin/main ...
git push origin main || goto :err

echo [4/4] تم الرفع بنجاح.
goto :end

:err
echo.
echo [ERROR] فشلت العملية - راجع المستودع.
exit /b 1

:end
echo ============================================
echo    تم - الحالة:
git log --oneline -1
echo ============================================
exit /b 0