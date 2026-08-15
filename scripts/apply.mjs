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
import { readFile, access } from 'node:fs/promises';
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

const cheminCv = profil.cv
  ? (isAbsolute(profil.cv) ? profil.cv : resolve(ROOT, profil.cv))
  : null;
let cvPret = false;
if (cheminCv) {
  try { await access(cheminCv); cvPret = true; }
  catch { console.log(`  ! CV introuvable : ${cheminCv}\n    Le reste sera rempli quand meme.\n`); }
}

/**
 * Correspondance entre l'intitule d'un champ et la valeur du profil.
 * L'ordre compte : les regles les plus specifiques d'abord, sinon « name » attrape
 * « first name ». Une valeur absente du profil laisse le champ vide, jamais invente.
 */
const REGLES = [
  [/first.?name|pr[eé]nom|given.?name/i, profil.prenom],
  [/last.?name|family.?name|surname|nom de famille/i, profil.nom],
  [/full.?name|nom complet|^name$|^nom$/i, [profil.prenom, profil.nom].filter(Boolean).join(' ')],
  [/e.?mail/i, profil.email],
  [/phone|t[eé]l[eé]phone|mobile|portable/i, profil.telephone],
  [/linked.?in/i, profil.linkedin],
  [/git.?hub/i, profil.github],
  [/portfolio|personal.?(web)?site|site.?web/i, profil.siteWeb],
  [/school|university|universit[eé]|[eé]cole|institution|establishment/i, profil.ecole],
  [/degree|dipl[oô]me/i, profil.diplome],
  [/discipline|major|field of study|sp[eé]cialit[eé]/i, profil.specialite],
  // « End date » dans un bloc formation = fin d'etudes. Le controle de coherence
  // garantit que l'annee n'atterrit pas dans le champ mois voisin.
  [/graduation|grad.?year|end.?date|ann[eé]e de dipl|fin d.?[eé]tudes/i, profil.anneeDiplome],
  [/postal|zip/i, profil.codePostal],
  [/address|adresse/i, profil.adresse],
  [/city|ville|town/i, profil.ville],
  [/country|pays/i, profil.pays],
];

/**
 * « Where is your hometown ? » n'est pas « dans quelle ville habites-tu ». Le premier
 * test y avait mis la ville actuelle : plausible, donc invisible a la relecture, et
 * potentiellement faux. On ne repond que si le profil donne explicitement la reponse.
 */
const AMBIGU = /hometown|ville natale|ville d.?origine|birth|naissance|nationality|nationalit[eé]|preferred name|pr[eé]nom d.?usage/i;

/**
 * Champs auxquels on ne touche jamais.
 *
 * Les questions de diversite, de handicap ou de statut de veteran sont personnelles et
 * facultatives : c'est a toi de decider si tu y reponds, jamais a un script.
 * Les questions d'autorisation de travail et de sponsorship engagent juridiquement,
 * une erreur de remplissage peut invalider la candidature.
 */
const JAMAIS = /gender|genre|race|ethnic|disability|handicap|veteran|sexual|orientation|diversity|diversit[eé]|pronoun|salary|salaire|r[eé]mun[eé]ration|authorized to work|sponsorship|visa|work permit|criminal|conviction/i;

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

const valeurPour = (etiquette) => {
  if (JAMAIS.test(etiquette) || AMBIGU.test(etiquette)) return null;
  for (const [re, val] of REGLES) {
    if (!val || !re.test(etiquette)) continue;
    const v = String(val);
    return valeurCoherente(etiquette, v) ? v : null;
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

const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let idMsg = 0;
const attentes = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && attentes.has(m.id)) { attentes.get(m.id)(m); attentes.delete(m.id); }
});
const envoyer = (methode, params = {}) => new Promise(r => {
  const i = ++idMsg;
  attentes.set(i, r);
  ws.send(JSON.stringify({ id: i, method: methode, params }));
});
const evaluer = async (expr) => {
  const r = await envoyer('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await envoyer('Page.enable');
await envoyer('Runtime.enable');
await envoyer('DOM.enable');

console.log(`\nOuverture de ${url}\n`);
await sleep(6000);

/* --------------------------------------------------------------- remplissage */

// Le script marque chaque champ pour pouvoir le retrouver ensuite cote CDP.
const champs = await evaluer(`(() => {
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
    out.push({
      i: n++,
      tag: el.tagName.toLowerCase(),
      type: (el.type || '').toLowerCase(),
      etiquette: etiquetteDe(el),
      requis: el.required || el.getAttribute('aria-required') === 'true',
      dejaRempli: Boolean(el.value),
      options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()).slice(0, 60) : null,
    });
  }
  return out;
})()`);

if (!champs || !champs.length) {
  console.log('Aucun champ de formulaire detecte sur cette page.');
  console.log('C est peut-etre une page de description : clique sur « Apply » puis relance la commande.');
  ws.close();
  process.exit(0);
}

const remplis = [];
const ignores = [];

for (const champ of champs) {
  if (champ.type === 'file') continue;

  const valeur = valeurPour(champ.etiquette);
  if (!valeur) { ignores.push(champ); continue; }
  if (champ.dejaRempli) continue;

  const ok = await evaluer(`(() => {
    const el = document.querySelector('[data-remplissage="${champ.i}"]');
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
  for (const el of document.querySelectorAll('[data-remplissage]')) {
    const i = el.getAttribute('data-remplissage');
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      const txt = o ? o.text.trim() : '';
      out[i] = (el.selectedIndex > 0 && txt && !/^(select|choisir|--)/i.test(txt)) ? txt : '';
    } else {
      out[i] = el.value || '';
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
const ouverts = dedupe(aFaire.filter(c => c.tag === 'textarea' && !c.dejaRempli && lisible(c)));

console.log('='.repeat(66));
console.log(`  ${vraimentRemplis.length} champ(s) rempli(s)${cvCharge ? ', CV joint' : cvPret ? ', CV NON joint' : ''}`);
vraimentRemplis.forEach(c => console.log(`    + ${court(c).padEnd(46)} = ${String(etatReel[String(c.i)]).slice(0, 32)}`));

if (manquantsRequis.length) {
  console.log(`\n  ${manquantsRequis.length} champ(s) OBLIGATOIRE(S) que tu dois remplir :`);
  manquantsRequis.forEach(c => console.log(`    ! ${court(c)}${c.options ? '   [liste deroulante]' : ''}`));
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
}

console.log('\n' + '='.repeat(64));
console.log('  Le navigateur reste ouvert. RELIS TOUT, complete ce qui manque,');
console.log('  puis clique toi-meme sur le bouton d envoi.');
console.log('  Ce script ne clique jamais sur « Submit ».');
console.log('='.repeat(64) + '\n');

ws.close();
