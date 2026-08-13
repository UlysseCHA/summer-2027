@echo off
REM Recollecte toutes les offres depuis les job boards publics (2 a 3 minutes).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge-le sur https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)

node scripts/fetch.mjs
echo.
echo Termine. Relance "Lancer le site.cmd" pour voir les nouvelles offres.
pause
