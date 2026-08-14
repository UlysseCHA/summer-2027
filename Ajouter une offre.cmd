@echo off
REM Ajoute a la main une offre reperee ailleurs, chez un employeur dont l'app
REM ne peut pas lire les annonces (McKinsey, Goldman Sachs, Nomura...).
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js n'est pas installe. Voir https://nodejs.org
  pause
  exit /b 1
)

echo.
echo   Colle les informations de l'offre.
echo.
set /p LIEN="  Lien de candidature : "
if "%LIEN%"=="" ( echo   Aucun lien saisi. & pause & exit /b 1 )

set /p BOITE="  Entreprise          : "
set /p POSTE="  Intitule du poste   : "
set /p LIEU="  Lieu (facultatif)   : "

echo.
echo   Secteur ? 1 = finance, 2 = tech, 3 = conseil (defaut)
set /p CHOIX="  Ton choix : "
set SECTEUR=consulting
if "%CHOIX%"=="1" set SECTEUR=finance
if "%CHOIX%"=="2" set SECTEUR=tech

echo.
node scripts/add-offer.mjs "%BOITE%" "%POSTE%" "%LIEN%" "%SECTEUR%" "%LIEU%"

echo.
pause
