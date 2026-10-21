@echo off
rem Double-click to start PIXEL KART ENDURANCE and share it on the internet.
chcp 65001 >nul
cd /d "%~dp0"
title PIXEL KART ENDURANCE - share
if exist "%~dp0.node-portable\node-v24.22.1-win-x64\node.exe" set "PATH=%~dp0.node-portable\node-v24.22.1-win-x64;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing packages ^(npm install^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node share.js
pause
