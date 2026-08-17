@echo off
chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "团体标准管理系统后台" /min cmd.exe /c "cd /d ""%~dp0"" && node server.mjs"
  timeout /t 2 /nobreak >nul
)

start "" "http://127.0.0.1:3000/"
