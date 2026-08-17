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
 * Les listes de mois des formulaires sont en anglais. Ecrire « Juin » dans le profil
 * est le reflexe naturel, et le champ restait vide sans que rien ne l'explique :
 * la traduction se fait donc ici plutot que de compter sur la memoire.
 */
const MOIS = {
  janvier: 'January', fevrier: 'February', mars: 'March', avril: 'April',
  mai: 'May', juin: 'June', juillet: 'July', aout: 'August',
  septembre: 'September', octobre: 'October', novembre: 'November', decembre: 'December',
};
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
  [/address|adresse/i, profil.adresse],
  [/city|ville|town/i, profil.ville],
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

/**
 * Rend la liste des valeurs a essayer pour ce champ, de la plus juste a la moins
 * probable, ou null s'il ne faut rien ecrire. Une seule valeur reste une liste
 * d'un element : les champs a liste deroulante en essaient plusieurs, les autres
 * ne prennent que la premiere.
 */
const valeurPour = (etiquette) => {
  if (JAMAIS.test(etiquette) || AMBIGU.test(etiquette)) return null;
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
      combobox: el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'true',
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
async function remplirCombobox(champ, valeurs, repli) {
  const sel = `document.querySelector('[data-remplissage="${champ.i}"]')`;
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
      let i = -1;
      for (const v of ${JSON.stringify(attendus)}.map(norme)) {
        i = options.findIndex(o => t(o) === v);
        if (i < 0) i = options.findIndex(o => t(o).startsWith(v + ' '));
        if (i >= 0) break;
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
  const requetes = [];
  for (const v of valeurs) {
    for (const q of [v.trim(), v.trim().split(/\s+/)[0]]) {
      if (q.length >= 3 && !requetes.some(r => r.toLowerCase() === q.toLowerCase())) requetes.push(q);
    }
  }

  // Huit requetes au plus. Six coupaient trop tot quand le profil declare deux
  // etablissements : les orthographes du second n'etaient jamais essayees.
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

const remplis = [];
const ignores = [];

for (const champ of champs) {
  if (champ.type === 'file') continue;

  const valeurs = valeurPour(champ.etiquette);
  if (!valeurs) { ignores.push(champ); continue; }
  const valeur = valeurs[0];
  if (champ.dejaRempli) continue;

  // Un vrai <select> se remplit par sa valeur, meme s'il porte aria-haspopup.
  if (champ.combobox && champ.tag !== 'select') {
    // Le repli ne vaut que pour l'etablissement, et seulement si tu l'as choisi
    // dans ton profil. Plusieurs valeurs separees par des virgules sont acceptees
    // et essayees dans l'ordre : le champ a ete compris comme une liste au premier
    // usage reel, et refuser cette lecture n'aurait servi personne.
    const repli = /school|university|universit[eé]|[eé]cole|institution/i.test(champ.etiquette)
      ? String(profil.ecoleSiAbsente || '').split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const r = await remplirCombobox(champ, valeurs, repli);
    if (r.ok) { champ.repli = r.repli ? valeur : null; remplis.push(champ); }
    // Les options proposees par la liste sont conservees : quand aucune ne
    // correspond, les afficher t'evite de rouvrir le menu pour rien.
    else { champ.candidats = r.candidats; ignores.push(champ); }
    continue;
  }

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
    } else if (el.value) {
      out[i] = el.value;
    } else {
      // Une liste a autocompletion vide son champ de saisie apres le choix et
      // n'affiche plus que le libelle retenu. Lire el.value declarerait vides des
      // champs pourtant remplis.
      const cont = el.closest('[class*="select__control"]') || el.closest('[class*="control"]');
      const sv = cont && cont.querySelector('[class*="single-value"], [class*="multi-value__label"]');
      const txt = sv ? sv.textContent.trim() : '';
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

if (manquantsRequis.length) {
  console.log(`\n  ${manquantsRequis.length} champ(s) OBLIGATOIRE(S) que tu dois remplir :`);
  manquantsRequis.forEach(c => {
    console.log(`    ! ${court(c)}${c.options ? '   [liste deroulante]' : ''}`);
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
