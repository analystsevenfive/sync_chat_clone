@echo off
chcp 65001 > nul
title Chatcone to Google Sheets Sync
echo ================================================================
echo   🚀 กำลังดึงประวัติแชทและเวลาจาก Chatcone สู่ Google Sheets...
echo ================================================================
node sync-now.js
set "SYNC_EXIT_CODE=%ERRORLEVEL%"
echo.
echo ================================================================
if "%SYNC_EXIT_CODE%"=="0" (
	echo   ✅ ซิงค์ข้อมูลเรียบร้อยแล้ว! สามารถเปิดดูใน Google Sheets ได้เลย
) else (
	echo   ❌ ซิงค์ไม่สำเร็จ (Exit code %SYNC_EXIT_CODE%) กรุณาตรวจสอบ Error ด้านบน
)
echo ================================================================
echo.
pause
exit /b %SYNC_EXIT_CODE%
