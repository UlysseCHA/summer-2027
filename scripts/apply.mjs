#!/usr/bin/env node
/**
 * Pre-remplit un formulaire de candidature depuis ton profil, puis te rend la main.
 *
 *   npm run apply "https://job-boards.greenhouse.io/xxx/jobs/123"
 *
 * Ce script N'ENVOIE JAMAIS. Il ouvre un navigateur visible, remplit ce qu'il peut,
 * liste ce qu'il n'a pas su remplir, et s'arrete. C'est toi qui relis et qui cliques
 * sur le bouton d'envoi.
 *
 * Aucune dependance : il pilote Edge via son protocole de debogage, comme le fait
 * n'importe quel outil de test. Le navigateur reste ouvert apres l'execution, et sa
 * session est conservee d'une fois sur l'autre (utile pour les portails a compte).
 */

import { spawn } from 'node:child_process';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFIL_NAV = resolve(ROOT, 'navigateur-profil');
const PORT = 9222;

const EDGE_CHEMINS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const url = process.argv[2];
if (!url || !/^https?:\/\//i.test(url)) {
  console.error('Usage : npm run apply "https://lien-de-l-offre"');
  process.exit(1);
}

/* ------------------------------------------------------------------ profil */

let profil;
try {
  profil = JSON.parse(await readFile(resolve(ROOT, 'data/profile.json'), 'utf8'));
} catch {
  console.error('Aucun profil trouve.');
  console.error('Copie data/profile.example.json en data/profile.json et remplis-le.');
  console.error('(data/profile.json est ignore par git : il ne partira pas sur GitHub.)');
  process.exit(1);
}

/**
 * Le CV, en tolerant le nom du fichier.
 *
 * Imposer « cv/CV.pdf » fait echouer le televersement au premier CV depose sous son
 * vrai nom, et le rapport se contente alors d'un avertissement discret alors que la
 * piece est obligatoire sur la plupart des formulaires. On prend donc le chemin du
 * profil s'il existe, sinon l'unique PDF du dossier cv/.
 */
async function trouverCv() {
  if (profil.cv) {
    const p = isAbsolute(profil.cv) ? profil.cv : resolve(ROOT, profil.cv);
    try { await access(p); return p; } catch { /* on cherche ailleurs */ }
  }
  try {
    const pdfs = (await readdir(resolve(ROOT, 'cv')))
      .filter(f => f.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 1) {
      const p = resolve(ROOT, 'cv', pdfs[0]);
      console.log(`  CV trouve sous un autre nom : ${pdfs[0]}\n`);
      return p;
    }
    if (pdfs.length > 1) {
      console.log(`  ! ${pdfs.length} PDF dans cv/ : precise lequel dans le champ « Chemin du CV » du profil.\n`);
    }
  } catch { /* pas de dossier cv/ */ }
  return null;
}

const cheminCv = await trouverCv();
const cvPret = Boolean(cheminCv);
if (!cvPret) {
  console.log('  ! Aucun CV trouve. Depose ton PDF dans le dossier cv/.\n    Le reste sera rempli quand meme.\n');
}

/**
 * Les listes de mois des formulaires sont en anglais. Ecrire « Juin » dans le profil
 * est le reflexe naturel, et le champ restait vide sans que rien ne l'explique :
 * la traduction se fait donc ici plutot que de compter sur la memoire.
 */
const MOIS = {
  janvier: 'January', fevrier: 'February', mars: 'March', avril: 'April',
  mai: 'May', juin: 'June', juillet: 'July', aout: 'August',
  septembre: 'September', octobre: 'October', novembre: 'November', decembre: 'December',
};
/** « +33 6 51 40 28 11 » -> « +33 ». Vide si le numero n'a pas d'indicatif. */
const indicatif = (tel) => (String(tel || '').match(/^\s*(\+\d{1,3})/) || [])[1] || '';

/**
 * Le numero sans son indicatif, quand le formulaire a un champ separe.
 * Le zero de tete francais ne se remet pas : avec un indicatif a part, la
 * convention internationale est le numero national sans son zero.
 */
const numeroSansIndicatif = (tel) => String(tel || '')
  .replace(/^\s*\+\d{1,3}\s*/, '').trim();

const moisAnglais = (m) => {
  const cle = String(m || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return MOIS[cle] || m;
};

/**
 * Correspondance entre l'intitule d'un champ et la valeur du profil.
 * L'ordre compte : les regles les plus specifiques d'abord, sinon « name » attrape
 * « first name ». Une valeur absente du profil laisse le champ vide, jamais invente.
 */
const REGLES = [
  // « Preferred name » = le prenom par lequel on veut etre appele. Pour la plupart
  // des gens c'est le prenom tout court, et le champ est souvent obligatoire.
  [/preferred.?name|pr[eé]nom d.?usage/i, profil.prenomUsage || profil.prenom],
  [/first.?name|pr[eé]nom|given.?name/i, profil.prenom],
  [/last.?name|family.?name|surname|nom de famille/i, profil.nom],
  [/full.?name|nom complet|^name$|^nom$/i, [profil.prenom, profil.nom].filter(Boolean).join(' ')],
  [/e.?mail/i, profil.email],
  // L'indicatif a son propre champ sur Workday. Sans cette regle, le numero complet
  // y atterrissait, et le « +33 » se retrouvait ecrit deux fois.
  // Le pays d'abord : la liste de Workday s'intitule « France (+33) », donc taper
  // « France » la trouve, taper « +33 » non.
  [/country.?phone.?code|country.?code|indicatif|dialling code|dial code/i,
    [profil.pays, indicatif(profil.telephone)].filter(Boolean)],
  [/phone|t[eé]l[eé]phone|mobile|portable/i, profil.telephone],
  [/linked.?in/i, profil.linkedin],
  [/git.?hub/i, profil.github],
  [/portfolio|personal.?(web)?site|site.?web/i, profil.siteWeb],
  // Un etablissement porte plusieurs noms selon les listes. Les variantes sont
  // essayees dans l'ordre, et seule une correspondance exacte est retenue.
  [/school|university|universit[eé]|[eé]cole|institution|establishment/i,
    [profil.ecole, ...(profil.ecoleAutresNoms || [])].filter(Boolean)],
  [/degree|dipl[oô]me/i, profil.diplome],
  [/discipline|major|field of study|sp[eé]cialit[eé]/i, profil.specialite],
  [/\bgpa\b|overall grade|grade point|moyenne g[eé]n[eé]rale/i, profil.gpa],
  // Disponibilite apres le diplome : une question de fait, pas d'autorisation de
  // travail. Les questions de visa et de sponsorship restent bloquees par JAMAIS.
  [/ready for full.?time|available for full.?time|disponible.*temps plein/i, profil.disponibleTempsPlein],

  // Dates de formation. Chaque case a sa regle : « Start date month » et « Start date
  // year » sont deux champs distincts, et la premiere regle qui correspond gagne. Une
  // regle trop large mettrait l'annee dans la case du mois, ce que le controle de
  // coherence rejetterait sans essayer la regle suivante : le champ resterait vide.
  [/start.?date.*\bmonth\b|\bmonth\b.*start.?date|d[eé]but.*mois/i, moisAnglais(profil.debutMois)],
  [/start.?date.*\byear\b|\byear\b.*start.?date|d[eé]but.*ann[eé]e/i, profil.debutAnnee],
  [/(end.?date|graduation).*\bmonth\b|\bmonth\b.*(end.?date|graduation)/i, moisAnglais(profil.finMois)],
  [/graduation|grad.?year|end.?date|ann[eé]e de dipl|fin d.?[eé]tudes/i, profil.finAnnee || profil.anneeDiplome],
  // Champ unique « Start date » sans decoupage mois / annee.
  [/start.?date|d[eé]but/i, [moisAnglais(profil.debutMois), profil.debutAnnee].filter(Boolean).join(' ')],
  [/postal|zip/i, profil.codePostal],
  [/state|province|region|r[eé]gion|d[eé]partement/i, profil.region],
  [/hometown|ville natale|ville d.?origine/i, profil.villeNatale],
  // La ville avant l'adresse : l'intitule « City or Town » de Workday contient
  // « address » dans son identifiant interne (address--city), et la regle d'adresse
  // y ecrivait la rue.
  [/city|ville|town/i, profil.ville],
  [/address|adresse/i, profil.adresse],
  [/country|pays/i, profil.pays],
];

/**
 * « Where is your hometown ? » n'est pas « dans quelle ville habites-tu ». Le premier
 * test y avait mis la ville actuelle : plausible, donc invisible a la relecture, et
 * potentiellement faux. On ne repond que si le profil donne explicitement la reponse.
 */
const AMBIGU = /birth|naissance|nationality|nationalit[eé]/i;

/**
 * Champs auxquels on ne touche jamais.
 *
 * Les questions de diversite, de handicap ou de statut de veteran sont personnelles et
 * facultatives : c'est a toi de decider si tu y reponds, jamais a un script.
 * Les questions d'autorisation de travail et de sponsorship engagent juridiquement,
 * une erreur de remplissage peut invalider la candidature.
 */
const JAMAIS = /gender|genre|race|ethnic|disability|handicap|veteran|sexual|orientation|diversity|diversit[eé]|pronoun|salary|salaire|r[eé]mun[eé]ration|criminal|conviction/i;

/**
 * Autorisation de travail et sponsorship.
 *
 * Ces reponses engagent juridiquement et le script les laissait vides. Tu as demande
 * qu'elles soient remplies selon une regle simple : autorise dans l'Union europeenne,
 * besoin d'un visa partout ailleurs. La regle est appliquee telle quelle, sans
 * interpretation, et uniquement quand le pays est nomme dans la question. Chaque
 * reponse est signalee a part dans le rapport : c'est une declaration, elle doit
 * etre relue.
 */
const AUTORISATION = /authoriz(?:ed|ation) to work|authoris(?:ed|ation) to work|right to work|legally (?:able|eligible) to work|need sponsorship|require sponsorship|sponsorship (?:from|to)|work (?:permit|visa)|autoris[eé].*travailler/i;
const DEMANDE_SPONSOR = /sponsor|visa|work permit/i;

/*
 * Pays ou un citoyen de l'Union europeenne travaille sans sponsor. L'Espace
 * economique europeen et la Suisse y figurent : ils ne sont pas dans l'Union, mais
 * la libre circulation s'y applique, et repondre « j'ai besoin d'un visa » pour Oslo
 * ou Zurich serait faux. La regle que tu as donnee vise l'absence de visa, pas
 * l'appartenance a l'Union.
 */
const PAYS_UE = [
  'austria', 'autriche', 'belgium', 'belgique', 'bulgaria', 'bulgarie', 'croatia', 'croatie',
  'cyprus', 'chypre', 'czech', 'tcheque', 'denmark', 'danemark', 'estonia', 'estonie',
  'finland', 'finlande', 'france', 'germany', 'allemagne', 'greece', 'grece',
  'hungary', 'hongrie', 'ireland', 'irlande', 'italy', 'italie', 'latvia', 'lettonie',
  'lithuania', 'lituanie', 'luxembourg', 'malta', 'malte', 'netherlands', 'pays-bas',
  'poland', 'pologne', 'portugal', 'romania', 'roumanie', 'slovakia', 'slovaquie',
  'slovenia', 'slovenie', 'spain', 'espagne', 'sweden', 'suede',
  'norway', 'norvege', 'iceland', 'islande', 'liechtenstein', 'switzerland', 'suisse',
  'european union', 'union europeenne', ' eu ', ' ue ', 'eea', 'eee', 'schengen',
];

/*
 * Pays hors de cette zone. La liste est explicite plutot que deduite : sans nom de
 * pays reconnu, la question reste sans reponse, ce qui vaut mieux qu'une declaration
 * au jugé. Taiwan manquait au premier essai reel, et le champ etait reste vide.
 */
const PAYS_HORS_UE = new RegExp([
  '\\bu\\.?s\\.?a?\\.?\\b', 'united states', 'america', '\\buk\\b', 'united kingdom', 'britain',
  'canada', 'mexico', 'brazil', 'bresil', 'argentina', 'chile', 'colombia', 'peru',
  'china', 'chine', 'hong kong', 'taiwan', 'taipei', 'japan', 'japon', 'korea', 'coree', 'seoul',
  'singapore', 'singapour', 'india', 'inde', 'indonesia', 'malaysia', 'philippines',
  'thailand', 'thailande', 'vietnam', 'australia', 'australie', 'new zealand',
  'uae', 'emirates', 'dubai', 'abu dhabi', 'qatar', 'saudi', 'kuwait', 'bahrain',
  'israel', 'turkey', 'turquie', 'egypt', 'south africa', 'nigeria', 'kenya', 'morocco', 'maroc',
].join('|'), 'i');

/**
 * Rend « Yes » ou « No » selon la question posee et le pays qu'elle nomme, ou null
 * quand le pays n'est pas identifiable : mieux vaut alors laisser vide que deviner.
 */
function reponseAutorisation(etiquette) {
  const t = ' ' + etiquette.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
  const ue = PAYS_UE.some(p => t.includes(p));
  if (!ue) {
    // Pays hors zone explicitement nomme : la reponse est l'inverse. Sans pays
    // reconnu, on ne peut rien affirmer, et le champ reste vide.
    if (!PAYS_HORS_UE.test(t)) return null;
    return DEMANDE_SPONSOR.test(etiquette) ? 'Yes' : 'No';
  }
  return DEMANDE_SPONSOR.test(etiquette) ? 'No' : 'Yes';
}

/**
 * Une valeur ne doit jamais atterrir dans un champ qui attend autre chose : le premier
 * test a ecrit « 2028 » dans un champ « End date month ». Remplir faux est pire que
 * laisser vide, parce que l'erreur passe inapercue a la relecture.
 */
function valeurCoherente(etiquette, valeur) {
  const mois = /\bmonth\b|\bmois\b/i.test(etiquette);
  const annee = /\byear\b|\bann[eé]e\b/i.test(etiquette);
  const ressembleAnnee = /^(19|20)\d{2}$/.test(valeur.trim());

  if (mois && !annee && ressembleAnnee) return false;   // une annee dans un champ mois
  if (annee && !mois && !ressembleAnnee) return false;  // autre chose dans un champ annee
  return true;
}

/**
 * Rend la liste des valeurs a essayer pour ce champ, de la plus juste a la moins
 * probable, ou null s'il ne faut rien ecrire. Une seule valeur reste une liste
 * d'un element : les champs a liste deroulante en essaient plusieurs, les autres
 * ne prennent que la premiere.
 */
/*
 * Champs volontairement laisses vides parce qu'aucune valeur du profil n'y a sa
 * place. « Phone Extension » attrapait la regle du telephone et recevait le numero
 * complet : un poste interne invente sur une candidature etudiante.
 */
const LAISSER_VIDE = /phone.?ext|\bextension\b|poste t[eé]l|middle.?name|second pr[eé]nom/i;

const valeurPour = (etiquette) => {
  if (JAMAIS.test(etiquette) || AMBIGU.test(etiquette) || LAISSER_VIDE.test(etiquette)) return null;
  for (const [re, val] of REGLES) {
    const liste = (Array.isArray(val) ? val : [val]).filter(Boolean).map(String);
    if (!liste.length || !re.test(etiquette)) continue;
    return valeurCoherente(etiquette, liste[0]) ? liste : null;
  }
  return null;
};

/* ------------------------------------------------------------- navigateur */

const edge = EDGE_CHEMINS.find(async () => true) && await (async () => {
  for (const c of EDGE_CHEMINS) { try { await access(c); return c; } catch {} }
  return null;
})();

if (!edge) {
  console.error('Ni Edge ni Chrome trouve. Installe l un des deux.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fenetre visible et session persistante : tu vois ce qui se passe et tu restes
// connecte aux portails d'une fois sur l'autre.
const nav = spawn(edge, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFIL_NAV}`,
  '--no-first-run',
  '--no-default-browser-check',
  url,
], { detached: true, stdio: 'ignore' });
nav.unref();

let cible = null;
for (let i = 0; i < 60 && !cible; i++) {
  await sleep(500);
  try {
    const liste = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    cible = liste.find(t => t.type === 'page' && !/^about:/.test(t.url));
  } catch { /* le navigateur demarre encore */ }
}
if (!cible) {
  console.error('Le navigateur n a pas repondu. Ferme toutes les fenetres Edge et relance.');
  process.exit(1);
}

/*
 * La connexion au navigateur est refaite a la demande.
 *
 * Sur les portails a compte, tu te connectes puis tu navigues, parfois dans un
 * nouvel onglet. Une socket ouverte une fois pour toutes sur l'onglet de depart
 * mourrait en route ; le script sait donc se rebrancher sur l'onglet actif.
 */
let ws, idMsg = 0;
const attentes = new Map();

async function connecter(cibleWs) {
  ws = new WebSocket(cibleWs);
  await new Promise((ok, ko) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', ko, { once: true });
  });
  attentes.clear();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && attentes.has(m.id)) { attentes.get(m.id)(m); attentes.delete(m.id); }
  });
  ws.addEventListener('close', () => { for (const r of attentes.values()) r({}); attentes.clear(); });
  await envoyer('Page.enable');
  await envoyer('Runtime.enable');
  await envoyer('DOM.enable');
}

const envoyer = (methode, params = {}) => new Promise(r => {
  if (!ws || ws.readyState !== 1) return r({});
  const i = ++idMsg;
  attentes.set(i, r);
  ws.send(JSON.stringify({ id: i, method: methode, params }));
});
const evaluer = async (expr) => {
  const r = await envoyer('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

/** Se rebranche sur l'onglet le plus plausible, en privilegiant le meme site. */
async function rebrancher() {
  try {
    const hote = new URL(url).hostname.split('.').slice(-2).join('.');
    const liste = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const pages = liste.filter(t => t.type === 'page' && !/^(about|chrome|edge):/.test(t.url));
    const choisie = pages.find(t => t.url.includes(hote)) || pages[0];
    if (!choisie) return false;
    await connecter(choisie.webSocketDebuggerUrl);
    return true;
  } catch { return false; }
}

await connecter(cible.webSocketDebuggerUrl);

console.log(`\nOuverture de ${url}\n`);

/*
 * Attendre que le formulaire existe, pas un delai arbitraire. Six secondes
 * suffisaient d'habitude et pas toujours : le script annoncait alors « aucun champ
 * detecte » sur une page qui en contenait vingt.
 */
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const n = await evaluer(`document.querySelectorAll('input:not([type=hidden]), textarea, select').length`);
  if (n >= 3) { await sleep(1500); break; }   // laisser le rendu se stabiliser
}

/* --------------------------------------------------------------- remplissage */

// Le script marque chaque champ pour pouvoir le retrouver ensuite cote CDP.
const scanner = () => evaluer(`(() => {
  const etiquetteDe = (el) => {
    const parts = [];
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) parts.push(l.textContent);
    }
    const parent = el.closest('label');
    if (parent) parts.push(parent.textContent);
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '',
               el.getAttribute('name') || '', el.id || '');
    const groupe = el.closest('div,fieldset,section');
    if (groupe) {
      const t = groupe.querySelector('label,legend,.label');
      if (t) parts.push(t.textContent);
    }
    return parts.join(' ').replace(/\\s+/g, ' ').trim().slice(0, 160);
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (el.type === 'hidden' || el.disabled || el.readOnly) continue;
    if (!visible(el) && el.type !== 'file') continue;
    el.setAttribute('data-remplissage', String(n));
    /*
     * Un selecteur stable en plus du repere.
     *
     * Workday redessine son formulaire entre le reperage et le remplissage :
     * l'attribut data-remplissage disparait avec les anciens noeuds, plus rien
     * n'est retrouve, et le rapport annonce zero champ rempli sur un formulaire
     * pourtant reconnu. L'identifiant ou le nom du champ, eux, survivent.
     */
    const sel = el.id ? '#' + CSS.escape(el.id)
      : el.name ? el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]'
      : '[data-remplissage="' + n + '"]';
    out.push({
      i: n++,
      sel,
      tag: el.tagName.toLowerCase(),
      type: (el.type || '').toLowerCase(),
      etiquette: etiquetteDe(el),
      requis: el.required || el.getAttribute('aria-required') === 'true',
      dejaRempli: Boolean(el.value),
      combobox: el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'true',
      // Workday n'utilise ni <select> ni role=combobox : ses listes sont des champs
      // « Search » reconnaissables a cet attribut maison. Sans lui, le script les
      // prenait pour du texte libre et y ecrivait la valeur telle quelle.
      prompt: el.getAttribute('data-uxi-widget-type') === 'selectinput',
      options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()).slice(0, 60) : null,
    });
  }
  return out;
})()`);

/*
 * Un formulaire suffisamment reel pour valoir un remplissage.
 *
 * Une page de description Workday contient une barre de recherche et un selecteur
 * de langue : compter les champs ne suffit pas, il faut au moins un champ de saisie
 * qu'on sache remplir. Sinon le script se declarait pret sur une page vide.
 */
const formulaireUtile = (liste) => Array.isArray(liste)
  && liste.filter(c => valeurPour(c.etiquette)).length >= 3;

let champs = await scanner();

/*
 * Les portails a compte (Workday, Avature, tal.net) montrent d'abord une page de
 * description, puis un ecran de connexion. Le script ouvrait la page et s'arretait
 * la, en te demandant de tout relancer une fois connecte. Il attend maintenant :
 * la fenetre est deja ouverte, tu te connectes, il repart tout seul.
 */
/**
 * Avance d'un ecran vers le formulaire, en cliquant « Apply » ou « Apply Manually ».
 *
 * Ces boutons ouvrent le formulaire, ils n'envoient rien : les franchir fait gagner
 * deux clics et ne t'engage pas. Tout ce qui ressemble a un envoi est exclu par une
 * liste noire, et le seul bouton que ce script ne cliquera jamais reste « Submit ».
 */
const DEJA_CLIQUE = new Set();
async function avancerVersFormulaire() {
  const libelle = await evaluer(`(() => {
    const ENVOI = /submit|send application|envoyer|soumettre|confirm|accept|agree|delete|withdraw/i;
    const OUVRE = /^(apply manually|apply now|apply|postuler|candidater|start application|continue|suivant|next|autofill with resume)$/i;
    const deja = ${JSON.stringify([...DEJA_CLIQUE])};

    const candidats = [...document.querySelectorAll('a, button, [role=button], [role=link]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 30) return false;
        if (ENVOI.test(t)) return false;              // jamais un envoi
        if (deja.includes(t.toLowerCase())) return false;
        return OUVRE.test(t);
      });

    // « Apply Manually » avant « Apply » : sur Workday, le premier mene droit au
    // formulaire, le second ouvre encore un menu.
    candidats.sort((a, b) => {
      const p = t => /manually|manuellement/i.test(t) ? 0 : /^apply|postuler|candidater/i.test(t) ? 1 : 2;
      return p(a.innerText || '') - p(b.innerText || '');
    });

    const cible = candidats[0];
    if (!cible) return null;
    const t = (cible.innerText || cible.textContent).replace(/\\s+/g, ' ').trim();
    cible.scrollIntoView({ block: 'center' });
    cible.click();
    return t;
  })()`);

  if (libelle) DEJA_CLIQUE.add(libelle.toLowerCase());
  return libelle;
}

if (!formulaireUtile(champs)) {
  console.log('Pas encore de formulaire sur cette page.');

  const premier = await avancerVersFormulaire();
  if (premier) {
    console.log(`  J ai clique sur « ${premier} » pour ouvrir le formulaire.`);
    await sleep(4000);
    const apres = await scanner();
    if (formulaireUtile(apres)) champs = apres;
  }
}

if (!formulaireUtile(champs)) {
  console.log('');
  console.log('  Dans la fenetre ouverte, il reste a :');
  console.log('    - te connecter ou creer le compte si le site le demande');
  console.log('    - te laisser porter jusqu au formulaire');
  console.log('');
  console.log('  Je clique sur « Apply » quand j en vois un, je surveille la page,');
  console.log('  et je remplis des que le formulaire apparait.');
  console.log('  (Ctrl+C pour abandonner. Abandon automatique apres 15 minutes.)\n');

  const limite = Date.now() + 15 * 60 * 1000;
  let dernierMot = '';
  while (Date.now() < limite) {
    await sleep(3000);

    // La connexion peut avoir change d'onglet, ou la socket etre morte pendant
    // une redirection : on se rebranche avant de conclure a l'absence de formulaire.
    let vu = await scanner();
    if (vu === undefined) { await rebrancher(); vu = await scanner(); }

    if (formulaireUtile(vu)) { champs = vu; break; }

    // Un « Apply » peut reapparaitre apres la connexion, ou un ecran intermediaire
    // proposer « Apply Manually ». On le franchit, sans jamais toucher a un envoi.
    const clique = await avancerVersFormulaire();
    if (clique) {
      console.log(`  clic sur « ${clique} »`);
      await sleep(3500);
      const suite = await scanner();
      if (formulaireUtile(suite)) { champs = suite; break; }
    }

    const ou = (await evaluer('location.hostname')) || '?';
    const mot = `  ... j attends sur ${ou}`;
    if (mot !== dernierMot) { console.log(mot); dernierMot = mot; }
  }

  if (!formulaireUtile(champs)) {
    console.log('\nToujours pas de formulaire apres 15 minutes.');
    console.log('Le navigateur reste ouvert. Relance la commande sur l URL du formulaire.');
    ws.close();
    process.exit(0);
  }

  console.log('\nFormulaire detecte, remplissage en cours...\n');
  await sleep(1200);
  champs = await scanner();   // relire apres stabilisation du rendu
}

/**
 * Champs a autocompletion (role=combobox).
 *
 * Greenhouse n'utilise pas de <select> pour Country, School, Degree ou Discipline,
 * mais un input qui ouvre une liste. Ces composants ignorent les evenements
 * fabriques en JavaScript : teste, le champ restait `aria-expanded=false` et la
 * valeur tapee etait effacee au blur.
 *
 * On passe donc par le protocole du navigateur, qui produit de vrais clics et de
 * vraies frappes, indiscernables d'un utilisateur.
 */
async function remplirCombobox(champ, valeurs, repli, strategie) {
  const sel = `document.querySelector(${JSON.stringify(champ.sel)})`;
  const echec = (candidats) => ({ ok: false, candidats: candidats || null });

  // Vraies frappes, envoyees au champ qui a le focus. Contrairement aux evenements
  // clavier fabriques en JavaScript, celles-ci portent isTrusted=true : c'est la
  // seule chose que ces composants acceptent.
  const touche = async (key, vk, texte) => {
    await envoyer('Input.dispatchKeyEvent', {
      type: 'keyDown', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      ...(texte ? { text: texte } : {}),
    });
    await envoyer('Input.dispatchKeyEvent', {
      type: 'keyUp', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  };

  const effacer = async () => {
    for (let n = 0; n < 60; n++) await touche('Backspace', 8);
    await sleep(300);
  };

  const abandonner = async (candidats) => {
    await effacer();
    await touche('Escape', 27);
    await evaluer(`${sel}?.blur()`);
    return echec(candidats);
  };

  // Le focus est donne par JavaScript, pas par un clic a des coordonnees.
  // Le clic etait la cause de la corruption du premier essai : la position etait
  // lue pendant le defilement, le clic tombait a cote, et la frappe partait dans
  // le champ precedemment actif (l'email etait devenu « ...@example.comFrance »).
  // Sans coordonnees, il n'y a plus rien a rater.
  await evaluer(`${sel}?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await evaluer(`(() => { const el = ${sel}; if (el) { el.focus(); el.click(); } })()`);
  await sleep(250);

  if (!await evaluer(`document.activeElement === ${sel}`)) return echec();

  // Le composant n'ouvre sa liste qu'a la premiere touche reelle : le focus seul
  // laisse aria-expanded a false, quoi qu'on lui envoie en JavaScript.
  await touche('ArrowDown', 40);
  await sleep(300);

  /**
   * Cherche `attendu` dans la liste, en tapant `requete`. Rend la position de
   * l'option a retenir, ou de quoi expliquer l'echec.
   *
   * La liste lue est uniquement celle que CE champ pilote (aria-controls). Le
   * premier essai ratissait tout le document et tombait sur les 244 indicatifs
   * telephoniques du champ voisin.
   */
  const chercher = async (requete, attendus) => {
    await effacer();
    await envoyer('Input.insertText', { text: requete });
    await sleep(1200);

    const lire = () => evaluer(`(() => {
      const el = ${sel};
      const box = document.getElementById(el.getAttribute('aria-controls') || '');
      if (!box) return { rien: true };
      const options = [...box.querySelectorAll('[role=option]')];
      if (!options.length) return { rien: true };

      const norme = s => s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
      const t = o => norme(o.textContent);

      /*
       * La liste renvoyee est confrontee a TOUTES les orthographes connues, pas
       * seulement a celle qu'on vient de taper : chercher « Ecole » remonte les
       * ENS, et l'une d'elles correspond peut-etre a une autre orthographe.
       *
       * Egalite, ou au plus un suffixe ajoute par le site (« France » -> « France +33 »).
       * Rien de plus permissif : accepter qu'une option CONTIENNE la valeur a fait
       * choisir « Human Resources Management » pour une specialite « Management ».
       * Une erreur de ce genre est invisible a la relecture, donc pire que le vide.
       */
      const strategie = ${JSON.stringify(strategie || null)};
      let i = -1;

      if (strategie && strategie.type === 'max') {
        /*
         * Aucune liste de mentions n'est libellee en GPA : « 4/4 » ne correspond a
         * rien dans « 70% and above - First class honours ». On retient l'option
         * dont le nombre le plus eleve est le plus grand, ce qui marche aussi bien
         * pour des pourcentages que pour des bornes 3.5-4.0. Les options sans
         * chiffre (« I'd rather not disclose ») sont ecartees.
         */
        let meilleur = -Infinity;
        options.forEach((o, n) => {
          const nombres = (o.textContent.match(/\\d+(?:[.,]\\d+)?/g) || []).map(x => parseFloat(x.replace(',', '.')));
          if (!nombres.length) return;
          const m = Math.max(...nombres);
          if (m > meilleur) { meilleur = m; i = n; }
        });
      } else if (strategie && strategie.type === 'libre') {
        /*
         * Reponse sans enjeu, mais jamais une reponse verifiable : cocher « ancien
         * employe » ou « recommandation » est un mensonge que le recruteur peut
         * controler. On prend la premiere option neutre de la liste de preferences.
         */
        const exclu = /employee|intern\\b|referr|friend|family|recruiter|employe|connaissance/i;
        const libres = options.map((o, n) => ({ n, txt: t(o), brut: o.textContent }))
          .filter(o => !exclu.test(o.brut));
        for (const pref of strategie.preferences.map(norme)) {
          const trouve = libres.find(o => o.txt.includes(pref));
          if (trouve) { i = trouve.n; break; }
        }
        if (i < 0 && libres.length) i = libres[0].n;
      } else {
        for (const v of ${JSON.stringify(attendus)}.map(norme)) {
          i = options.findIndex(o => t(o) === v);
          if (i < 0) i = options.findIndex(o => t(o).startsWith(v + ' '));
          if (i >= 0) break;
        }
      }

      if (i < 0) return { rien: true, candidats: options.slice(0, 4).map(o => o.textContent.trim()) };

      const actif = el.getAttribute('aria-activedescendant');
      return {
        position: i,
        depart: options.findIndex(o => o.id && o.id === actif),
        cibleId: options[i].id,
        libelle: options[i].textContent.trim(),
      };
    })()`);

    let etat = await lire();
    // Certaines listes se remplissent apres coup. Vue trop tot, une liste encore
    // vide faisait declarer « Finance » introuvable alors que l'option existe.
    if (etat?.rien && !etat.candidats) { await sleep(1000); etat = await lire(); }
    return etat;
  };

  /** Valide l'option reperee : on s'y deplace au clavier, puis Entree. */
  const valider = async (etat) => {
    // Sans option active, la premiere fleche selectionne la premiere de la liste,
    // d'ou le decalage de 1.
    const depart = etat.depart >= 0 ? etat.depart : -1;
    const ecart = etat.position - depart;
    for (let n = 0; n < Math.abs(ecart); n++) {
      await touche(ecart > 0 ? 'ArrowDown' : 'ArrowUp', ecart > 0 ? 40 : 38);
      await sleep(70);
    }

    /*
     * Verification AVANT de valider, pas apres : une fois l'option choisie, le
     * composant vide son champ de recherche et n'affiche plus que le libelle
     * retenu, parfois abrege (« France » devient « +33 »). Comparer apres coup
     * rejetterait une saisie pourtant juste. On s'assure donc que la ligne
     * surlignee est bien la bonne, puis Entree ne peut plus se tromper.
     */
    if (!await evaluer(`${sel}.getAttribute('aria-activedescendant') === ${JSON.stringify(etat.cibleId)}`)) {
      return null;
    }

    await touche('Enter', 13, '\r');
    await sleep(700);

    return evaluer(`(() => {
      const el = ${sel};
      if (!el) return '';
      if (el.value) return el.value;
      const cont = el.closest('[class*="select__control"]') || el.closest('[class*="control"]');
      const sv = cont && cont.querySelector('[class*="single-value"], [class*="multi-value__label"]');
      return sv ? sv.textContent.trim() : '';
    })()`);
  };

  /*
   * Un etablissement porte plusieurs noms (« emlyon business school », « EM Lyon »,
   * « ENS Paris-Saclay »...). Interroger le serveur une fois par orthographe le
   * sature : onze noms faisaient vingt-deux requetes, apres quoi il ne renvoyait
   * plus rien et les champs suivants du formulaire echouaient a leur tour.
   *
   * On interroge donc peu, et chaque liste renvoyee est confrontee a toutes les
   * orthographes. L'option retenue doit correspondre a un nom COMPLET : chercher
   * « lyon » remonte « Lyon College », etablissement de l'Arkansas.
   */
  const cle = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  // La valeur complete est toujours essayee, quelle que soit sa longueur : le seuil
  // de trois caracteres ne vaut que pour le premier mot, dont on se sert comme
  // requete large. Sans cette distinction, « No » n'etait jamais tape et la question
  // de sponsorship restait vide alors que « Yes » passait.
  const brutes = [];
  const ajouter = (q) => { if (q && !brutes.some(r => cle(r) === cle(q))) brutes.push(q); };
  for (const v of valeurs) {
    ajouter(v.trim());
    const premier = v.trim().split(/\s+/)[0];
    if (premier.length >= 3) ajouter(premier);
  }

  /*
   * Une orthographe longue ne trouve rien de plus que son propre debut : si
   * « emlyon » ne renvoie aucune option, « emlyon business school » n'en renverra
   * pas davantage. On ne garde donc que les requetes les plus courtes, celles qui
   * n'ont aucune autre requete pour prefixe, et on essaie quand meme toutes les
   * orthographes qui different vraiment (« ESC Lyon », « ENS Cachan »).
   */
  // Les strategies « max » et « libre » choisissent dans la liste entiere : il n'y a
  // rien a taper, il suffit de l'ouvrir.
  const requetes = strategie ? [''] : brutes.filter(q =>
    !brutes.some(p => p !== q && cle(q).startsWith(cle(p) + ' ')));

  let derniersCandidats = null;
  for (const requete of requetes.slice(0, 8)) {
    const etat = await chercher(requete, valeurs);
    if (!etat || etat.rien) { derniersCandidats = etat?.candidats || derniersCandidats; continue; }

    const choisi = await valider(etat);
    if (choisi) return { ok: true, valeur: etat.libelle, affiche: choisi };
    return abandonner(etat.candidats);
  }

  /*
   * Repli explicite, uniquement si le profil en definit un (« Other »). Aucune
   * valeur n'est inventee : c'est toi qui as decide, dans data/profile.json, ce
   * qu'il faut choisir quand ton etablissement est absent de la liste. Le rapport
   * le signale pour que tu completes le nom ailleurs dans le formulaire.
   */
  for (const r of repli) {
    const etat = await chercher(r, [r]);
    if (!etat || etat.rien) continue;
    const choisi = await valider(etat);
    if (choisi) return { ok: true, valeur: etat.libelle, affiche: choisi, repli: true };
  }

  return abandonner(derniersCandidats);
}

/**
 * Listes « Search » de Workday.
 *
 * Elles ne portent ni role=combobox ni aria-controls : impossible de lire leurs
 * options comme ailleurs. En revanche la selection au clavier fonctionne, et le
 * resultat s'affiche dans une etiquette voisine sous la forme « 1 item selected,
 * France (+33) ». On tape, on valide, puis on relit cette etiquette : si rien n'a
 * ete retenu, on efface plutot que de laisser une saisie libre dans un champ qui
 * attend un choix.
 */
async function remplirPromptWorkday(champ, valeurs, strategie) {
  const sel = `document.querySelector(${JSON.stringify(champ.sel)})`;
  const touche = async (key, vk, texte) => {
    await envoyer('Input.dispatchKeyEvent', {
      type: 'keyDown', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      ...(texte ? { text: texte } : {}),
    });
    await envoyer('Input.dispatchKeyEvent', {
      type: 'keyUp', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  };

  const choix = () => evaluer(`(() => {
    const el = ${sel};
    if (!el) return '';
    const bloc = el.closest('[data-automation-id="multiSelectContainer"]')
      || el.closest('[data-automation-id="multiselectInputContainer"]');
    const t = (bloc ? bloc.innerText : '').replace(/\\s+/g, ' ').trim();
    const m = t.match(/\\d+ items? selected,\\s*(.+?)(?:\\s*\\1)?$/i);
    return m ? m[1].trim() : '';
  })()`);

  const norme = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /*
   * Workday pre-remplit certains de ces champs avec un defaut a lui : le pays de
   * l'indicatif arrivait sur « United Kingdom (+44) ». Une valeur presente ne veut
   * donc pas dire une valeur juste. On ne s'arrete que si elle correspond deja a ce
   * qu'on voulait mettre ; sinon on la remplace, et le rapport le signale.
   */
  const initial = await choix();
  if (initial && valeurs.some(v => norme(initial).includes(norme(v)))) return { ok: true };
  let faux = null;   // valeur retenue par erreur, a signaler plutot qu'a taire

  await evaluer(`${sel}?.scrollIntoView({ block: 'center' })`);
  await sleep(400);

  // Quatre essais au plus : chacun coute quatre secondes, et marteler un widget
  // Workday finit par le laisser dans un etat incoherent.
  for (const valeur of valeurs.slice(0, 4)) {
    await evaluer(`(() => { const e = ${sel}; if (e) { e.focus(); e.click(); } })()`);
    await sleep(500);
    if (!await evaluer(`document.activeElement === ${sel}`)) continue;

    for (let n = 0; n < 40; n++) await touche('Backspace', 8);
    await sleep(250);
    await envoyer('Input.insertText', { text: valeur });
    await sleep(2200);   // le filtrage est distant : trop tot, la liste est encore entiere

    await touche('ArrowDown', 40);
    await sleep(500);
    await touche('Enter', 13, '\r');
    await sleep(1100);

    /*
     * On verifie que la ligne retenue correspond bien a ce qui a ete tape.
     *
     * Sans ce controle, une liste pas encore filtree fait valider sa premiere
     * entree : le script a choisi « Afghanistan (+93) » pour une recherche de
     * « France ». Un pays faux sur une candidature est pire qu'un champ vide,
     * parce qu'il a l'air rempli.
     */
    const retenu = await choix();
    if (retenu && norme(retenu).includes(norme(valeur))) {
      return { ok: true, affiche: retenu, remplace: initial && initial !== retenu ? initial : null };
    }
    if (retenu && retenu !== initial) faux = retenu;   // a signaler si rien de mieux ne vient
  }

  /*
   * Reponse sans enjeu dont aucune requete n'a rien donne : la recherche de Workday
   * compare au debut du libelle, et « career » ne trouve pas « Citi Jobs Career
   * Site ». On ouvre alors la liste sans rien taper et on prend la premiere ligne
   * acceptable, en refusant tout ce qui se verifie : ancien employe, cooptation.
   */
  if (strategie?.type === 'libre') {
    const EXCLU = /employee|referr|friend|family|recruiter|employe|cooptation/i;
    for (let rang = 1; rang <= 5; rang++) {
      await evaluer(`(() => { const e = ${sel}; if (e) { e.focus(); e.click(); } })()`);
      await sleep(600);
      for (let n = 0; n < rang; n++) { await touche('ArrowDown', 40); await sleep(180); }
      await touche('Enter', 13, '\r');
      await sleep(1000);

      const retenu = await choix();
      if (retenu && retenu !== initial && !EXCLU.test(retenu)) {
        return { ok: true, affiche: retenu, remplace: initial || null };
      }
    }
  }

  // Aucun essai n'a abouti : on ne laisse pas de texte libre derriere soi. Pas
  // d'Echap ici, qui sur Workday referme parfois plus que la liste ouverte.
  await evaluer(`(() => { const e = ${sel}; if (e) e.focus(); })()`);
  for (let n = 0; n < 40; n++) await touche('Backspace', 8);
  await evaluer(`${sel}?.blur()`);
  return { ok: false, faux };
}

const remplis = [];
const ignores = [];

/**
 * Choix qui ne viennent pas litteralement du profil : la mention convertie depuis
 * ton GPA, l'autorisation de travail deduite du pays, la provenance de l'annonce.
 * Le rapport les met a part, parce qu'une reponse deduite se relit autrement qu'une
 * reponse recopiee.
 */
const NOTE = /\bgpa\b|overall grade|grade point|classification|moyenne g[eé]n[eé]rale|mention/i;
const PROVENANCE = /how did you (?:hear|find|learn)|where did you (?:hear|find)|comment.*(?:connu|entendu parler)|source de la candidature/i;
/*
 * Requetes courtes plutot que libelles exacts : chaque entreprise nomme ses sources
 * a sa facon. Citi propose « Citi Jobs Career Site », que « job posting » ne trouve
 * pas et que « career » trouve. Un mot suffit a faire remonter la bonne ligne.
 */
const PREFERENCES_PROVENANCE = [
  'career', 'job board', 'linkedin', 'university', 'school', 'online', 'other',
];

function strategiePour(etiquette) {
  if (NOTE.test(etiquette) && profil.noteAuPlusHaut) {
    return { type: 'max', motif: `mention la plus haute, d apres un GPA de ${profil.gpa || '?'}` };
  }
  if (PROVENANCE.test(etiquette)) {
    return { type: 'libre', preferences: PREFERENCES_PROVENANCE, motif: 'reponse neutre, sans consequence' };
  }
  return null;
}

/*
 * Quand le formulaire separe l'indicatif du numero, le numero ne doit plus le
 * porter : « +33 » ecrit dans les deux cases donne un numero invalide.
 */
const INDICATIF_A_PART = /country.?phone.?code|country.?code|indicatif|dialling code|dial code/i;
const indicatifSepare = champs.some(c => INDICATIF_A_PART.test(c.etiquette));

for (const champ of champs) {
  if (champ.type === 'file') continue;

  const strategie = strategiePour(champ.etiquette);
  const auto = AUTORISATION.test(champ.etiquette) && !JAMAIS.test(champ.etiquette)
    ? reponseAutorisation(champ.etiquette) : null;

  // Une question d'autorisation dont le pays n'est pas nommable reste sans reponse.
  if (AUTORISATION.test(champ.etiquette) && !auto) { ignores.push(champ); continue; }

  let valeurs = auto ? [auto]
    : strategie ? (strategie.preferences || ['—'])
    : valeurPour(champ.etiquette);
  if (!valeurs) { ignores.push(champ); continue; }

  if (indicatifSepare && /phone|t[eé]l[eé]phone|mobile|portable/i.test(champ.etiquette)
      && !INDICATIF_A_PART.test(champ.etiquette)) {
    valeurs = valeurs.map(numeroSansIndicatif).filter(Boolean);
    if (!valeurs.length) { ignores.push(champ); continue; }
  }

  const valeur = valeurs[0];
  if (champ.dejaRempli) continue;
  if (auto || strategie) champ.deduit = auto ? 'autorisation de travail deduite du pays' : strategie.motif;

  // Liste « Search » de Workday : selection au clavier, verifiee sur l'etiquette.
  if (champ.prompt) {
    const r = await remplirPromptWorkday(champ, valeurs, strategie);
    if (r.ok) {
      // Un defaut du site qu'on ecrase merite d'etre dit : c'est le seul cas ou le
      // script modifie une valeur deja presente.
      if (r.remplace) champ.deduit = `remplace le defaut du site, « ${r.remplace} »`;
      remplis.push(champ);
    } else {
      // Le champ porte peut-etre une valeur fausse qu'on n'a pas su effacer :
      // le taire serait le plus dangereux des silences.
      champ.faux = r.faux || null;
      ignores.push(champ);
    }
    continue;
  }

  // Un vrai <select> se remplit par sa valeur, meme s'il porte aria-haspopup.
  if (champ.combobox && champ.tag !== 'select') {
    // Le repli ne vaut que pour l'etablissement, et seulement si tu l'as choisi
    // dans ton profil. Plusieurs valeurs separees par des virgules sont acceptees
    // et essayees dans l'ordre : le champ a ete compris comme une liste au premier
    // usage reel, et refuser cette lecture n'aurait servi personne.
    const repli = /school|university|universit[eé]|[eé]cole|institution/i.test(champ.etiquette)
      ? String(profil.ecoleSiAbsente || '').split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const r = await remplirCombobox(champ, valeurs, repli, strategie);
    if (r.ok) { champ.repli = r.repli ? valeur : null; remplis.push(champ); }
    // Les options proposees par la liste sont conservees : quand aucune ne
    // correspond, les afficher t'evite de rouvrir le menu pour rien.
    else { champ.candidats = r.candidats; ignores.push(champ); }
    continue;
  }

  const ok = await evaluer(`(() => {
    const el = document.querySelector(${JSON.stringify(champ.sel)});
    if (!el) return false;
    const v = ${JSON.stringify(valeur)};

    if (el.tagName === 'SELECT') {
      // On cherche l'option la plus proche, sans jamais en inventer une.
      const opt = [...el.options].find(o => o.text.trim().toLowerCase() === v.toLowerCase())
              || [...el.options].find(o => o.text.trim().toLowerCase().includes(v.toLowerCase()))
              || [...el.options].find(o => v.toLowerCase().includes(o.text.trim().toLowerCase()) && o.text.trim().length > 2);
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === opt.value;
    }

    // Greenhouse, Lever et Ashby sont ecrits en React. Ecrire directement dans
    // el.value ne previent pas React, qui reecrase le champ au rendu suivant :
    // le formulaire semble rempli une seconde, puis se vide. Il faut passer par le
    // setter natif pour que le onChange de React parte vraiment.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    el.focus();
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return el.value === v;
  })()`);

  (ok ? remplis : ignores).push(champ);
}

/* ------------------------------------------------------------------- CV */

let cvCharge = false;
if (cvPret) {
  const doc = await envoyer('DOM.getDocument', { depth: -1 });
  const racine = doc.result?.root?.nodeId;
  if (racine) {
    const fichiers = await envoyer('DOM.querySelectorAll', { nodeId: racine, selector: 'input[type=file]' });
    for (const nodeId of fichiers.result?.nodeIds || []) {
      const attrs = await envoyer('DOM.getAttributes', { nodeId });
      const texte = (attrs.result?.attributes || []).join(' ').toLowerCase();
      // On ne televerse le CV que dans un champ qui parle bien de CV.
      if (!/resume|cv|curriculum|attachment|file/.test(texte)) continue;
      try {
        await envoyer('DOM.setFileInputFiles', { files: [cheminCv], nodeId });
        cvCharge = true;
        break;
      } catch { /* champ inaccessible, on essaie le suivant */ }
    }
  }
}

/* ---------------------------------------------------------------- rapport */

/*
 * On relit l'etat REEL du formulaire avant de faire le rapport.
 *
 * Sans cela, le script annoncait « Country rempli » alors que la liste deroulante
 * affichait toujours « Select... » : ces composants React reprennent la main apres
 * coup. Un rapport qui decrit les intentions plutot que le resultat est pire
 * qu'inutile, puisqu'il donne confiance dans un champ vide.
 */
await sleep(1500);
const etatReel = await evaluer(`(() => {
  const out = {};
  // Relecture par selecteur stable : le repere data-remplissage ne survit pas a un
  // formulaire qui se redessine, et l'etat reel serait alors lu comme vide partout.
  for (const [i, sel] of ${JSON.stringify(champs.map(c => [String(c.i), c.sel]))}) {
    const el = document.querySelector(sel);
    if (!el) { out[i] = ''; continue; }
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      const txt = o ? o.text.trim() : '';
      out[i] = (el.selectedIndex > 0 && txt && !/^(select|choisir|--)/i.test(txt)) ? txt : '';
    } else if (el.value) {
      out[i] = el.value;
    } else {
      // Une liste a autocompletion vide son champ de saisie apres le choix et
      // n'affiche plus que le libelle retenu. Lire el.value declarerait vides des
      // champs pourtant remplis.
      const cont = el.closest('[class*="select__control"]') || el.closest('[class*="control"]');
      const sv = cont && cont.querySelector('[class*="single-value"], [class*="multi-value__label"]');
      let txt = sv ? sv.textContent.trim() : '';

      // Workday range son choix dans une etiquette voisine, pas dans le champ.
      if (!txt) {
        const bloc = el.closest('[data-automation-id="multiSelectContainer"]')
          || el.closest('[data-automation-id="multiselectInputContainer"]');
        const brut = (bloc ? bloc.innerText : '').replace(/\\s+/g, ' ').trim();
        const m = brut.match(/\\d+ items? selected,\\s*(.+?)(?:\\s*\\1)?$/i);
        if (m) txt = m[1].trim();
      }

      out[i] = /^(select|choisir|--)/i.test(txt) ? '' : txt;
    }
  }
  return out;
})()`) || {};

const vraimentRemplis = remplis.filter(c => etatReel[String(c.i)]);
const perdus = remplis.filter(c => !etatReel[String(c.i)]);

/* Un formulaire contient beaucoup de champs techniques sans etiquette lisible :
   on ne rapporte que ce sur quoi tu peux agir. */
const lisible = c => c.etiquette && c.etiquette.replace(/[\s*:]/g, '').length > 2;
const court = c => c.etiquette.replace(/\s+/g, ' ').slice(0, 58);

const vus = new Set();
const dedupe = liste => liste.filter(c => {
  const k = court(c).toLowerCase();
  return vus.has(k) ? false : vus.add(k);
});

// Un champ que le site a reecrase reste a faire, au meme titre qu'un champ jamais touche.
const aFaire = [...ignores, ...perdus];

// Les questions sensibles ont leur propre rubrique : elles ne sont pas « oubliees »,
// elles sont volontairement laissees de cote.
const sensibles = dedupe(aFaire.filter(c => lisible(c) && JAMAIS.test(c.etiquette)));
const ambigues = dedupe(aFaire.filter(c => lisible(c) && AMBIGU.test(c.etiquette) && !JAMAIS.test(c.etiquette)));
const manquantsRequis = dedupe(aFaire.filter(c =>
  c.requis && !c.dejaRempli && lisible(c) && !JAMAIS.test(c.etiquette) && !AMBIGU.test(c.etiquette)));
/*
 * Les questions ouvertes ne sont pas toujours des <textarea>. « Tell us something
 * about yourself that we can't find on your resume. » est un simple <input> sur ce
 * formulaire : filtrer sur la balise la laissait passer sous silence, alors que
 * c'est justement la question qui demande du travail. On se fie donc a l'intitule.
 */
const questionOuverte = (e) => /\?/.test(e) || e.replace(/\s+/g, ' ').trim().split(' ').length >= 8;
const ouverts = dedupe(aFaire.filter(c =>
  !c.dejaRempli && lisible(c) && !JAMAIS.test(c.etiquette) && !AMBIGU.test(c.etiquette)
  // Une liste deroulante n'est pas une question ouverte, meme quand son intitule
  // est une longue phrase interrogative : « Are you interested in our Women's
  // Winternship programme ? » se repond par oui ou non dans un menu. Proposer d'en
  // rediger un brouillon envoyait sur une fausse piste.
  && !c.combobox
  && (c.tag === 'textarea'
      || (c.tag === 'input' && ['', 'text'].includes(c.type) && questionOuverte(c.etiquette)))));

console.log('='.repeat(66));
console.log(`  ${vraimentRemplis.length} champ(s) rempli(s)${cvCharge ? ', CV joint' : cvPret ? ', CV NON joint' : ''}`);
vraimentRemplis.forEach(c => console.log(`    + ${court(c).padEnd(46)} = ${String(etatReel[String(c.i)]).slice(0, 32)}`));

// Un repli est un choix par defaut, pas la bonne reponse : il doit sauter aux yeux.
const replis = vraimentRemplis.filter(c => c.repli);
if (replis.length) {
  console.log(`\n  ${replis.length} champ(s) mis par defaut, A VERIFIER :`);
  replis.forEach(c => console.log(
    `    ~ ${court(c)} = « ${etatReel[String(c.i)]} », faute de trouver « ${c.repli} » dans la liste`));
}

/* Une reponse deduite n'a pas la meme valeur qu'une reponse recopiee du profil :
   celles-ci engagent, notamment l'autorisation de travail. */
const deduits = vraimentRemplis.filter(c => c.deduit);
if (deduits.length) {
  console.log(`\n  ${deduits.length} reponse(s) DEDUITE(S), a relire attentivement :`);
  deduits.forEach(c => console.log(
    `    > ${court(c)}\n        = « ${etatReel[String(c.i)]} »  (${c.deduit})`));
}

/*
 * Un site interroge peut cesser de repondre s'il est sollicite trop souvent : lors
 * des essais, une execution a vu TOUTES ses listes deroulantes echouer, puis la
 * suivante les a toutes remplies. Sans ce message, le rapport ressemble a un bug du
 * script alors qu'il suffit d'attendre une minute.
 */
const listes = champs.filter(c => c.combobox && c.tag !== 'select' && valeurPour(c.etiquette));
const listesRatees = listes.filter(c => !etatReel[String(c.i)]);
if (listes.length >= 3 && listesRatees.length > listes.length / 2) {
  console.log('\n  ! La plupart des listes deroulantes n ont rien renvoye.');
  console.log('    Le site limite probablement les requetes. Attends une minute et relance.');
}

if (manquantsRequis.length) {
  console.log(`\n  ${manquantsRequis.length} champ(s) OBLIGATOIRE(S) que tu dois remplir :`);
  manquantsRequis.forEach(c => {
    console.log(`    ! ${court(c)}${c.options ? '   [liste deroulante]' : ''}`);
    if (c.faux) console.log(`        ATTENTION : le champ affiche « ${c.faux} », qui est faux. Corrige-le.`);
    // Quand la liste ne propose pas ta valeur, autant montrer ce qu'elle propose.
    if (c.candidats?.length) {
      console.log(`        la liste propose : ${c.candidats.slice(0, 4).join(' | ').slice(0, 90)}`);
    }
  });
}

if (sensibles.length) {
  console.log(`\n  ${sensibles.length} question(s) volontairement NON remplie(s) :`);
  console.log('    (autorisation de travail, sponsorship, diversite : a toi seul d y repondre)');
  sensibles.forEach(c => console.log(`    - ${court(c)}`));
}

if (ambigues.length) {
  console.log(`\n  ${ambigues.length} question(s) laissee(s) vide(s) faute de certitude :`);
  console.log('    (« hometown » n est pas ta ville actuelle : mieux vaut vide que faux)');
  ambigues.forEach(c => console.log(`    ? ${court(c)}`));
}

if (ouverts.length) {
  console.log(`\n  ${ouverts.length} question(s) ouverte(s), a rediger :`);
  ouverts.forEach(c => console.log(`    ? ${court(c)}`));
  // L'intitule collecte concatene plusieurs sources : on ne garde que la premiere
  // phrase, sinon la commande proposee contient le libelle trois fois.
  const phrase = ouverts[0].etiquette.replace(/\s+/g, ' ').match(/^[^?.]*[?.]?/)[0].replace(/\*/g, '').trim();
  console.log('\n    Pour un brouillon appuye sur ton CV :');
  console.log(`      npm run draft -- "${phrase}"`);
}

console.log('\n' + '='.repeat(64));
console.log('  Le navigateur reste ouvert. RELIS TOUT, complete ce qui manque,');
console.log('  puis clique toi-meme sur le bouton d envoi.');
console.log('  Ce script ne clique jamais sur « Submit ».');
console.log('='.repeat(64) + '\n');

ws.close();
