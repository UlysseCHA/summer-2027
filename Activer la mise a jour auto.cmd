@echo off
REM Active le rafraichissement automatique des offres toutes les 6 heures sur GitHub,
REM meme quand ton PC est eteint. A ne lancer qu'une seule fois.
chcp 65001 >nul
cd /d "%~dp0"

where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI n'est pas installe. Voir https://cli.github.com
  pause
  exit /b 1
)

echo.
echo   Etape 1 sur 2 : autorisation GitHub.
echo   Une page va s'ouvrir dans ton navigateur, il faudra y coller un code
echo   affiche ci-dessous, puis confirmer.
echo.
pause

gh auth refresh -h github.com -s workflow
if errorlevel 1 (
  echo.
  echo   L'autorisation a echoue. Relance ce fichier.
  pause
  exit /b 1
)

echo.
echo   Etape 2 sur 2 : envoi du fichier d'automatisation.
echo.

git add .github
git commit -m "Rafraichissement automatique toutes les 6 heures"
git push

if errorlevel 1 (
  echo.
  echo   L'envoi a echoue.
  pause
  exit /b 1
)

echo.
echo   C'est actif. Les offres se rafraichiront toutes les 6 heures.
echo   Suivi des executions : https://github.com/UlysseCHA/summer-2027/actions
echo.
pause
