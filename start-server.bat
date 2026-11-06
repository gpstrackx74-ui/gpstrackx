@echo off
title GpsTrackX Server
echo ========================================================
echo Starting GpsTrackX Fleet Management & Route Platform...
echo ========================================================
cd /d "%~dp0\backend"
node server.js
pause

