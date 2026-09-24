@echo off
chcp 65001 > nul
echo ===================================================
echo 🔑 Chatcone Auto-Token Generator
echo ===================================================
echo.
node get-token.js --force
echo.
pause
