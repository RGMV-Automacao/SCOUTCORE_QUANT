@echo off
setlocal
cd /d "%~dp0"
if "%SCOUT_DB%"=="" set "SCOUT_DB=data\scout_extraction.db"
echo [update-team-profiles] SCOUT_DB=%SCOUT_DB%
node scripts\rebuild-all-leagues.mjs %*
if errorlevel 1 (
  echo [update-team-profiles] FAILED
  exit /b %errorlevel%
)
echo [update-team-profiles] OK
endlocal