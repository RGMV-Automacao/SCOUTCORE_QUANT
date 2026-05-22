@echo off
setlocal
cd /d "%~dp0"
echo Iniciando servicos (API + Web + Sidecar)...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0dev.ps1" -Api -Web -Sidecar
endlocal
