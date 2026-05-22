@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
if "%SCOUT_DB%"=="" set "SCOUT_DB=data\scout_extraction.db"

echo ========================================================
echo   SCOUTCORE - Extracao por Demanda (stats + odds)
echo ========================================================
echo   DB: %SCOUT_DB%
echo   Inicio: %date% %time%
echo ========================================================
echo.

echo [1/2] Extraindo estatisticas de partidas jogadas...
echo.
node apps/jobs/src/extract-statsline-matchstats.mjs --all --db=%SCOUT_DB% %*
set STATS_EXIT=!errorlevel!
echo.

if !STATS_EXIT! NEQ 0 (
  echo [AVISO] Estatisticas concluidas com erros exit=!STATS_EXIT!
  echo.
)

echo [2/2] Extraindo odds (bookline)...
echo.
node apps/jobs/src/extract-bookline-odds.mjs --db=%SCOUT_DB% --resolve-missing-events %*
set ODDS_EXIT=!errorlevel!
echo.

if !ODDS_EXIT! NEQ 0 (
  echo [AVISO] Odds concluidas com erros exit=!ODDS_EXIT!
  echo.
)

echo ========================================================
echo   Fim: %date% %time%
set STATUS=OK
if !STATS_EXIT! NEQ 0 set STATUS=CONCLUIDO COM AVISOS
if !ODDS_EXIT! NEQ 0 set STATUS=CONCLUIDO COM AVISOS
echo   Status: !STATUS!
echo ========================================================
endlocal
