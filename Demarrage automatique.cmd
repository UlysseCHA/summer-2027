@echo off
REM Fait demarrer le site tout seul a chaque ouverture de session Windows,
REM et cree un raccourci sur le Bureau.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge-le sur https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)

set "DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

REM Un lanceur qui pointe vers ce dossier, place dans le dossier Demarrage.
> "%DEMARRAGE%\Summer 2027.vbs" echo Set shell = CreateObject("WScript.Shell")
>>"%DEMARRAGE%\Summer 2027.vbs" echo shell.CurrentDirectory = "%~dp0"
>>"%DEMARRAGE%\Summer 2027.vbs" echo shell.Run "node scripts\serve.mjs 5273", 0, False

REM Raccourci sur le Bureau vers l'adresse du site.
> "%USERPROFILE%\Desktop\Summer 2027.url" echo [InternetShortcut]
>>"%USERPROFILE%\Desktop\Summer 2027.url" echo URL=http://localhost:5273/

REM Demarrage immediat, sans attendre le prochain redemarrage.
start "" /min wscript.exe "%DEMARRAGE%\Summer 2027.vbs"

echo.
echo   C'est fait.
echo.
echo   - Le site demarre tout seul a chaque ouverture de session.
echo   - Un raccourci "Summer 2027" est sur ton Bureau.
echo   - Adresse a mettre en favori dans Chrome : http://localhost:5273/
echo.
echo   Pour annuler : lancer "Arreter le demarrage automatique.cmd".
echo.
pause
