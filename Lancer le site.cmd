@echo off
REM Demarre le serveur local et ouvre le site dans le navigateur.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge-le sur https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)

start "" http://localhost:5273/
node scripts/serve.mjs 5273
pause
