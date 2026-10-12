@echo off
chcp 65001 >nul
title 一键部署「今天吃什么」到 Cloudflare Pages
cd /d "%~dp0"
echo.
echo   把本站部署到 Cloudflare Pages
echo   ================================
echo   第一次跑会要求登录 Cloudflare（免费账号），会打开浏览器让你点授权。
echo   部署完链接形如 https://chishenme.pages.dev
echo.
echo   想换链接名字：本文件里第一行 set PROJECT= 改成你想要的名字，
echo   同时要在 Cloudflare Dashboard 上把 Pages 项目名改成一样的。
echo.
set PROJECT=chishenme
echo   项目名：%PROJECT%
echo.
pause
node tools\deploy-cloudflare.mjs %PROJECT%
echo.
echo   跑完了。按任意键关闭窗口。
pause >nul
