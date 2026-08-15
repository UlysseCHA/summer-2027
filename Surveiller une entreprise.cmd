@echo off
REM Met une entreprise sous surveillance. Si elle n'a pas de job board aujourd'hui,
REM le robot la re-teste a chaque collecte et l'ajoute des qu'elle en ouvre un.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js n'est pas installe. Voir https://nodejs.org
  pause
  exit /b 1
)

echo.
set /p NOM="  Nom de l'entreprise : "
if "%NOM%"=="" ( echo   Aucun nom saisi. & pause & exit /b 1 )

echo.
echo   Secteur ? 1 = finance (defaut), 2 = tech, 3 = conseil
set /p CHOIX="  Ton choix : "
set SECTEUR=finance
if "%CHOIX%"=="2" set SECTEUR=tech
if "%CHOIX%"=="3" set SECTEUR=consulting

echo.
node scripts/add-watch.mjs "%NOM%" %SECTEUR%

echo.
pause
