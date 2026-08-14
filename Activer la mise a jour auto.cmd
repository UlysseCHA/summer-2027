@echo off
REM Active le rafraichissement automatique des offres toutes les 6 heures sur GitHub,
REM meme quand ton PC est eteint. A ne lancer qu'une seule fois.
chcp 65001 >nul
cd /d "%~dp0"

where gh >nul 2>nul
if errorlevel 1 (
  echo   GitHub CLI n'est pas installe. Voir https://cli.github.com
  pause
  exit /b 1
)

echo.
echo   ETAPE 1 sur 3 : autoriser GitHub.
echo.
echo   Un code va s'afficher. Note-le, appuie sur Entree, colle-le dans la page
echo   qui s'ouvre, puis valide. Reviens ensuite ici.
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
echo   ETAPE 2 sur 3 : dire a git d'utiliser cette autorisation.
echo.
REM Sans ceci, git passe par le gestionnaire d'identifiants Windows et n'a pas
REM connaissance de la nouvelle autorisation : l'envoi echouerait.
gh auth setup-git
if errorlevel 1 (
  echo   Echec de la configuration de git.
  pause
  exit /b 1
)

echo.
echo   ETAPE 3 sur 3 : envoi du fichier d'automatisation.
echo.

git add .github
git diff --staged --quiet
if not errorlevel 1 (
  echo   Rien a envoyer : c'etait peut-etre deja fait.
) else (
  git commit -m "Rafraichissement automatique toutes les 6 heures"
  git push
  if errorlevel 1 (
    echo.
    echo   L'envoi a echoue. Verifie ta connexion et relance ce fichier.
    pause
    exit /b 1
  )
)

echo.
echo   C'est actif.
echo.
echo   Je lance une premiere collecte tout de suite pour verifier...
gh workflow run "Rafraichir les offres" 2>nul
if errorlevel 1 (
  echo   (Le declenchement immediat a echoue, ce n'est pas grave :
  echo    la premiere execution automatique aura lieu dans moins de 6 heures.)
) else (
  echo   Lancee. Suis-la ici :
  echo   https://github.com/UlysseCHA/summer-2027/actions
)

echo.
pause
