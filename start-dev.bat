@echo off
title GpsTrackX Fullstack Development Mode
echo Starting GpsTrackX Backend and Frontend...
start "GpsTrackX Backend (Port 5000)" cmd /k "cd /d "%~dp0\backend" && node server.js"
start "GpsTrackX Frontend (Port 5173)" cmd /k "cd /d "%~dp0\frontend" && npm run dev"
echo Both servers started!
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:5000

