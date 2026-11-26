@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================================================
echo   6-DOF ROBOT KOL DIJITAL IKIZ + OPENCV + WI-FI CSI + UE5 HUB
echo   Tarayici aciliyor: http://localhost:8765
echo ====================================================================
start "" "http://localhost:8765"
".venv\Scripts\python.exe" backend\server.py
pause
