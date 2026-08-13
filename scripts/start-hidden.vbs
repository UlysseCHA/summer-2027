' Lance le serveur du site en tache de fond, sans fenetre de console.
' Ce fichier est copie dans le dossier Demarrage de Windows par
' "Demarrage automatique.cmd", pour que http://localhost:5273 reponde
' des l'ouverture de la session.
'
' Pour arreter : "Arreter le demarrage automatique.cmd".

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Dossier du projet = dossier parent de ce script.
projet = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

shell.CurrentDirectory = projet
' Le 0 signifie fenetre masquee, le False signifie qu'on n'attend pas la fin.
shell.Run "node scripts\serve.mjs 5273", 0, False
