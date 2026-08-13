@echo off
REM Annule tout ce qu'a fait "Demarrage automatique.cmd".
chcp 65001 >nul

set "DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if exist "%DEMARRAGE%\Summer 2027.vbs" (
  del "%DEMARRAGE%\Summer 2027.vbs"
  echo   Demarrage automatique supprime.
) else (
  echo   Il n'y avait pas de demarrage automatique.
)

if exist "%USERPROFILE%\Desktop\Summer 2027.url" (
  del "%USERPROFILE%\Desktop\Summer 2027.url"
  echo   Raccourci du Bureau supprime.
)

REM Arrete le serveur en cours, s'il tourne.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5273" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>nul
  echo   Serveur arrete.
)

echo.
echo   Le dossier du projet n'a pas ete touche : "Lancer le site.cmd" marche toujours.
echo.
pause
