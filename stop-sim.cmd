@echo off
cd /d "%~dp0"
echo Stopping STRATOS...
node tools\stop.mjs
echo.
pause
