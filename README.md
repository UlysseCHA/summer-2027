# Summer 2027

Index des offres de **stage et graduate programs** en tech, finance et conseil pour la campagne
Summer 2027. Les annonces sont collectées depuis les API publiques des ATS (Greenhouse, Lever,
Ashby) des entreprises suivies, et chaque offre pointe vers l'annonce officielle.

## Démarrer

Il faut [Node.js](https://nodejs.org) ≥ 18. Aucune dépendance à installer.

```bash
npm start          # http://localhost:5273
npm run fetch      # recollecte les offres (2-3 min)
npm run check-links # vérifie les liens des portails entreprises
```

Sous Windows, `Lancer le site.cmd` et `Mettre a jour les offres.cmd` font la même chose en
double-clic.

> Ouvrir `index.html` directement (`file://`) ne marche pas : le navigateur y bloque `fetch()`,
> donc les données ne se chargent pas. Passe par `npm start`.

## Ce que fait l'app

- **Offres** : recherche plein texte, filtres par secteur, type de poste, métier, région,
  entreprise, campagne. Tri, export CSV, favoris.
- **Suivi de candidatures** : statut par offre (à postuler / postulé / entretien / offre /
  refusé), affiché en tableau. Stocké dans le `localStorage` du navigateur, exportable en JSON.
- **Portails entreprises** : les employeurs sans board public (Goldman Sachs, McKinsey, Google,
  Jane Street…), avec un lien vers leur page carrière étudiants officielle.
- Les filtres sont dans l'URL : une vue filtrée se partage par copier-coller du lien.

## Limites (à lire)

**Ce n'est pas exhaustif, et ça ne peut pas l'être.** Aucune source publique ne contient « toutes »
les offres. Concrètement :

| Situation | Ce que fait l'app |
|---|---|
| Entreprise sur Greenhouse / Lever / Ashby | Les offres sont listées une par une |
| Entreprise sur Workday, portail maison, SmartRecruiters fermé | Lien vers la page carrière, onglet *Portails* |
| Annonce sans année (« Quantitative Research Intern ») | Rattachée à Summer 2027 si publiée dans la fenêtre de recrutement, badge « année déduite » |
| Date limite de candidature | Pas extraite : rarement structurée. Un badge signale les annonces qui en mentionnent une |

## Ajouter une entreprise

1. Trouver son token ATS depuis l'URL de son board :
   - `boards.greenhouse.io/<token>` ou `job-boards.greenhouse.io/<token>`
   - `jobs.lever.co/<token>`
   - `jobs.ashbyhq.com/<token>`
2. Ajouter une ligne dans [`data/sources.json`](data/sources.json) :
   ```json
   { "company": "Nom", "ats": "greenhouse", "token": "letoken", "industry": "finance", "tags": ["quant"] }
   ```
   `industry` vaut `tech`, `finance` ou `consulting`.
3. `npm run fetch`

Si l'entreprise n'a pas de board public, l'ajouter à [`data/portals.json`](data/portals.json) puis
lancer `npm run check-links` pour valider l'URL.

## Structure

```
index.html              interface
assets/app.js           état, filtres, rendu (vanilla JS, zéro dépendance)
assets/styles.css       thème clair / sombre
data/sources.json       entreprises suivies + tokens ATS      (à éditer)
data/portals.json       employeurs sans board public          (à éditer)
data/offers.json        offres collectées                     (généré)
scripts/fetch.mjs       collecte, classification, dédoublonnage
scripts/check-links.mjs vérification des liens portails
scripts/serve.mjs       serveur statique local
```

### Comment une offre est classée

`scripts/fetch.mjs` filtre d'abord les titres qui ressemblent à du early-career, puis charge la
description de ces seules annonces pour en déduire :

- **type** : stage / graduate / junior
- **année et saison** : d'abord « Summer 2027 » dans le titre, sinon dans la description en
  ignorant les phrases qui parlent d'année de *diplôme* (« graduating in 2028 » n'est pas l'année du
  stage), sinon un vote sur les années citées près du mot « internship »
- **métier** : quant/trading, ingénierie, IA/ML, data, banque, conseil, produit, design, business
- **région** : à partir de la localisation

Le fetch est poli : 8 requêtes en parallèle max, retry exponentiel sur 429/5xx, user-agent explicite.
Aucun contenu d'annonce n'est republié : seulement un extrait de 320 caractères pour la recherche.
