@echo off
cd /d "%~dp0"
echo Installing dependencies if needed...
npm install
echo.
echo Starting Big Striker Bowling Online...
npm start
pause
