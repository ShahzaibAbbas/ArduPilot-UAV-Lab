@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Windows.ps1"
if errorlevel 1 (
  echo.
  echo Launcher failed. Review the message above.
  pause
)
