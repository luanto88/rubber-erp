@echo off
chcp 65001 >nul
title HỆ THỐNG CHUYỂN ĐỔI KQKN CAO SU CSR
echo ============================================================
echo   HỆ THỐNG TỰ ĐỘNG CHUYỂN ĐỔI BIỂU KQKN CAO SU CSR SANG EXCEL
echo ============================================================
echo.
echo Đang mở trình duyệt tại: http://localhost:8000 ...
timeout /t 1 >nul
start http://localhost:8000
echo Đang khởi động máy chủ cục bộ...
python server.py
pause
