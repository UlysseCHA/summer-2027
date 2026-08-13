# Summer 2027

Index des offres de **stage et graduate programs** en tech, finance et conseil pour la campagne
Summer 2027. Les annonces sont collectées depuis les API publiques des ATS (Greenhouse, Lever,
Ashby) de **202 entreprises**, et chaque offre pointe vers l'annonce officielle.

**Site en ligne : <https://ulyssecha.github.io/summer-2027/>**
Dépôt : <https://github.com/UlysseCHA/summer-2027>

> Le site est public. La page de connexion sépare les profils d'Ulysse et de Rayan, elle
> **ne protège rien** : la vérification se fait dans le navigateur et se contourne en une ligne
> dans la console. Ce qui est exposé, ce sont des offres d'emploi déjà publiques. Les suivis de
> candidatures, eux, restent dans le navigateur de chacun et ne sont jamais envoyés.

## Démarrer

Il faut [Node.js](https://nodejs.org) >= 18. Aucune dépendance à installer.

```bash
npm start            # http://localhost:5273
npm run fetch        # recollecte complète (5-8 min)
npm run discover     # cherche les job boards de nouvelles entreprises
npm run check-links  # vérifie les liens des portails entreprises
```

Sous Windows, `Lancer le site.cmd` et `Mettre a jour les offres.cmd` font la même chose en
double-clic.

### Ouvrir depuis un favori Chrome

`Demarrage automatique.cmd` (une seule fois) met en place :

- le lancement du serveur en tâche de fond à chaque ouverture de session Windows, sans fenêtre ;
- un raccourci `Summer 2027` sur le Bureau.

Ensuite <http://localhost:5273/> répond en permanence, donc un favori Chrome suffit.
`Arreter le demarrage automatique.cmd` annule tout.

> Mettre en favori le fichier `index.html` (`file://`) ne marche pas : Chrome y bloque le
> chargement des données et des modules JavaScript. Il faut passer par `localhost`.

## Comment les nouvelles offres arrivent

Trois mécanismes, du plus immédiat au plus complet :

| Quand | Quoi | Profondeur |
|---|---|---|
| À chaque ouverture du site | La page réinterroge les 202 boards en direct depuis le navigateur (~30 s en fond). Les nouvelles offres sont signalées, celles qui ont été fermées disparaissent. | Titres seuls |
| Toutes les 20 min, onglet ouvert | Nouvelle vérification automatique, et immédiate au retour sur l'onglet. Rien ne tourne si l'onglet est en arrière-plan. | Titres seuls |
| Toutes les 6 h, même PC éteint | GitHub Actions relance la collecte complète, commite `data/offers.json` et redéploie le site. | Titres + descriptions |
| À la demande | `npm run fetch` | Titres + descriptions |

Le rafraîchissement navigateur est possible parce que Greenhouse, Lever et Ashby renvoient tous
`Access-Control-Allow-Origin: *`. Il ne lit que la liste des postes (1 requête par entreprise) :
sans les descriptions, l'année du programme est moins bien détectée pour les annonces qui ne la
mettent pas dans leur titre. Le collecteur Node reste la source de vérité.

## Comptes

Deux profils, `ulysse` et `rayan`, avec le même mot de passe. Chacun a ses favoris et son suivi de
candidatures, stockés séparément dans le navigateur.

**Ce n'est pas une sécurité.** Le site est statique : la vérification se fait dans le navigateur et
se contourne en ouvrant les outils de développement. Ça sert à séparer deux profils sur une même
page, rien de plus. Ne mets aucune information sensible dans ce projet en comptant dessus.

Pour changer le mot de passe, remplacer les empreintes dans [`assets/auth.js`](assets/auth.js) :

```bash
node -e "console.log(require('crypto').createHash('sha256').update('ulysse:NOUVEAU').digest('hex'))"
```

## Ce que fait l'app

- **Offres** : recherche plein texte, filtres par secteur, type de poste, métier, région,
  entreprise, campagne. Tri, export CSV, favoris, badge sur les nouveautés.
- **Suivi de candidatures** : statut par offre (à postuler / postulé / entretien / offre /
  refusé), affiché en tableau. Stocké en `localStorage`, exportable en JSON.
- **Portails entreprises** : les 82 employeurs sans board public (Goldman Sachs, McKinsey, Google,
  Jane Street...), avec un lien vers leur page carrière étudiants officielle.
- Les filtres sont dans l'URL : une vue filtrée se partage par copier-coller du lien.

## Limites (à lire)

**Ce n'est pas exhaustif, et ça ne peut pas l'être.** Aucune source publique ne contient « toutes »
les offres.

| Situation | Ce que fait l'app |
|---|---|
| Entreprise sur Greenhouse / Lever / Ashby | Les offres sont listées une par une |
| Entreprise sur Workday, portail maison, SmartRecruiters fermé | Lien vers la page carrière, onglet *Portails* |
| Annonce sans année (« Quantitative Research Intern ») | Rattachée à Summer 2027 si publiée dans la fenêtre de recrutement, badge « année déduite » |
| Date limite de candidature | Pas extraite : rarement structurée. Un badge signale les annonces qui en mentionnent une |

## Ajouter une entreprise

Le plus simple : ajouter son nom dans `CANDIDATES` dans
[`scripts/discover.mjs`](scripts/discover.mjs) et lancer `npm run discover`. Le script teste des
variantes de slug sur les trois ATS et écrit ce qu'il trouve dans `data/discovered.json`.

À la main : trouver le token depuis l'URL de son board (`boards.greenhouse.io/<token>`,
`jobs.lever.co/<token>`, `jobs.ashbyhq.com/<token>`), puis ajouter une ligne dans
[`data/sources.json`](data/sources.json) et lancer `npm run fetch` :

```json
{"company":"Nom","ats":"greenhouse","token":"letoken","industry":"finance","tags":["quant"]}
```

`industry` vaut `tech`, `finance` ou `consulting`.

Attention aux slugs courts et génériques (`applied`, `column`, `blue`) : ils appartiennent souvent
à une autre société. Vérifier l'URL d'une annonce avant de l'ajouter.

Si l'entreprise n'a pas de board public, l'ajouter à [`data/portals.json`](data/portals.json) puis
lancer `npm run check-links`.

## Structure

```
index.html               interface
assets/app.js            état, filtres, rendu
assets/classify.js       classification, partagée entre Node et navigateur
assets/live.js           rafraîchissement live et fusion avec la base
assets/auth.js           portillon à deux comptes
assets/styles.css        thème clair / sombre
data/sources.json        202 entreprises suivies + tokens ATS   (à éditer)
data/portals.json        82 employeurs sans board public        (à éditer)
data/offers.json         offres collectées                      (généré)
data/discovered.json     résultat de la dernière découverte     (généré)
scripts/fetch.mjs        collecte complète
scripts/discover.mjs     recherche de tokens ATS
scripts/check-links.mjs  vérification des liens portails
scripts/serve.mjs        serveur statique local
.github/workflows/       rafraîchissement automatique toutes les 6 h
```

### Comment une offre est classée

`assets/classify.js` filtre d'abord les titres qui ressemblent à du early-career, puis en déduit :

- **type** : stage / graduate / junior
- **année et saison** : d'abord « Summer 2027 » dans le titre, sinon dans la description en
  ignorant les phrases qui parlent d'année de *diplôme* (« graduating in 2028 » n'est pas l'année
  du stage), sinon un vote sur les années citées près du mot « internship »
- **métier** : quant/trading, ingénierie, IA/ML, data, banque, conseil, produit, design, business
- **région** : à partir de la localisation

Le fetch est poli : 8 requêtes en parallèle max, retry exponentiel sur 429/5xx, user-agent
explicite. Aucun contenu d'annonce n'est republié, seulement un extrait de 320 caractères pour la
recherche.
