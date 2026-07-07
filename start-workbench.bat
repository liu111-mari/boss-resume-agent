@echo off
setlocal
title BOSS 求职助手 - 本地工作台
cd /d "%~dp0"

echo 正在启动 BOSS 求职助手本地工作台...
echo.
echo 访问地址: http://localhost:3000
echo 如果浏览器提示拒绝连接，请确认这个窗口里已经出现 Ready。
echo 关闭这个窗口会停止本地工作台。
echo.

npm run dev

echo.
echo 本地工作台已停止。
pause
