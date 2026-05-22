@echo off
setlocal
cd /d "%~dp0"
echo Parando todos os servicos...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
endlocal
