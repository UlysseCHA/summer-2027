@echo off
REM Ajoute une entreprise reperee ailleurs (Trackr, LinkedIn, bouche a oreille)
REM et recolte ses offres dans la foulee.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js n'est pas installe. Voir https://nodejs.org
  pause
  exit /b 1
)

echo.
set /p NOM="  Nom de l'entreprise (ex: Wincent) : "
if "%NOM%"=="" (
  echo   Aucun nom saisi.
  pause
  exit /b 1
)

echo.
echo   Secteur ? 1 = finance (defaut), 2 = tech, 3 = conseil
set /p CHOIX="  Ton choix : "

set SECTEUR=finance
if "%CHOIX%"=="2" set SECTEUR=tech
if "%CHOIX%"=="3" set SECTEUR=consulting

echo.
node scripts/add-company.mjs "%NOM%" %SECTEUR%

echo.
echo   Si l'entreprise a ete ajoutee, publie la mise a jour avec :
echo     git add -A ^&^& git commit -m "Ajout de %NOM%" ^&^& git push
echo.
pause
