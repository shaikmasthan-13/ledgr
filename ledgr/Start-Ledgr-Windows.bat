@echo off
title Ledgr Server
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed on this computer.
  echo Please install it first from https://nodejs.org (choose the LTS version),
  echo then double-click this file again.
  pause
  exit /b
)

if not exist "node_modules" (
  echo Setting things up for the first time - this only happens once...
  call npm install
)

echo.
echo Starting Ledgr...
echo Once you see "Ledgr server running", open this in your browser:
echo   http://localhost:3000
echo.
echo Leave this window open while you use the app. Closing it stops the server.
echo.

start "" http://localhost:3000
call npm start

pause
