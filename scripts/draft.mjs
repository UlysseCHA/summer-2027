#!/usr/bin/env node
/**
 * Redige un BROUILLON de reponse a une question ouverte de formulaire, a partir de
 * ton CV, de ton profil et, si tu le donnes, du texte de l'offre.
 *
 *   npm run draft -- "Tell us something about yourself we can't find on your resume"
 *   npm run draft -- "Why this firm ?" --offre "https://job-boards.greenhouse.io/xxx/jobs/123"
 *   npm run draft -- "Why this firm ?" --mots 120
 *
 * Le texte s'affiche dans le terminal. Rien n'est colle dans le formulaire et rien
 * n'est envoye : tu relis, tu corriges, tu copies si ca te convient.
 *
 * Ce script est le seul du projet a avoir besoin d'une cle API et d'une dependance
 * npm. Tout le reste marche sans.
 */

import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { stripHtml } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELE = 'claude-opus-5';

/* ------------------------------------------------------------------ arguments */

const args = process.argv.slice(2);
const lire = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : null;
};
const offre = lire('--offre');
const mots = Number(lire('--mots')) || 150;
const question = args.filter((a, i) =>
  !a.startsWith('--') && args[i - 1] !== '--offre' && args[i - 1] !== '--mots').join(' ').trim();

if (!question) {
  console.error('Usage : npm run draft -- "la question posee par le formulaire" [--offre URL] [--mots 150]');
  process.exit(1);
}

/* -------------------------------------------------------------------- profil */

let profil;
try {
  profil = JSON.parse(await readFile(resolve(ROOT, 'data/profile.json'), 'utf8'));
} catch {
  console.error('Aucun profil trouve. Copie data/profile.example.json en data/profile.json.');
  process.exit(1);
}

/**
 * Le CV part tel quel : un PDF est envoye comme document, l'API le lit page par page.
 * Un CV en texte est simplement colle. Sans CV, on continue avec le seul profil, en
 * le disant au modele pour qu'il ne comble pas les trous tout seul.
 */
async function blocCv() {
  if (!profil.cv) return null;
  const chemin = isAbsolute(profil.cv) ? profil.cv : resolve(ROOT, profil.cv);
  try { await access(chemin); } catch {
    console.log(`  ! CV introuvable (${chemin}) : le brouillon s appuiera sur le seul profil.\n`);
    return null;
  }
  const ext = extname(chemin).toLowerCase();
  if (ext === '.pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: (await readFile(chemin)).toString('base64') },
      title: basename(chemin),
    };
  }
  return { type: 'text', text: `CV :\n${(await readFile(chemin, 'utf8')).slice(0, 20000)}` };
}

/**
 * Le texte de l'offre, quand tu donnes son lien. Un echec de recuperation n'arrete
 * rien : la question se repond sans, simplement de facon moins ciblee.
 */
async function texteOffre() {
  if (!offre) return null;
  try {
    const r = await fetch(offre, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(String(r.status));
    return stripHtml(await r.text()).slice(0, 12000);
  } catch (e) {
    console.log(`  ! Offre non lisible (${e.message}) : le brouillon ignorera le contexte de l entreprise.\n`);
    return null;
  }
}

const cv = await blocCv();
const description = await texteOffre();

const notes = [
  profil.ecole && `Ecole : ${profil.ecole}`,
  profil.programme && `Programme : ${profil.programme}`,
  profil.specialite && `Specialite : ${profil.specialite}`,
  (profil.debutMois || profil.finMois) &&
    `Etudes : ${profil.debutMois || ''} ${profil.debutAnnee || ''} - ${profil.finMois || ''} ${profil.finAnnee || profil.anneeDiplome || ''}`.trim(),
  profil.langues?.length && `Langues : ${profil.langues.join(', ')}`,
  profil.aProposDeMoi && `Hors CV : ${profil.aProposDeMoi}`,
  profil.reponsesTypes?.pourquoiNous && `Motivation habituelle : ${profil.reponsesTypes.pourquoiNous}`,
].filter(Boolean).join('\n');

/* ------------------------------------------------------------------- redaction */

/*
 * Le risque, sur ce genre de tache, n'est pas que le texte soit mauvais : c'est qu'il
 * soit bon et faux. Un stage invente ou un chiffre plausible passe la relecture et se
 * paie en entretien. D'ou la consigne : rien qui ne vienne du CV ou des notes, et un
 * marqueur explicite partout ou il manque quelque chose.
 */
const SYSTEME = `Tu rediges un brouillon de reponse a une question de formulaire de candidature, a la premiere personne, pour le candidat dont tu recois le CV.

Regles absolues :
- N'invente aucun fait. Chaque experience, chiffre, entreprise, date ou competence citee doit venir du CV ou des notes fournies.
- S'il manque un element pour bien repondre, ecris [A COMPLETER : ce qui manque] a l'endroit voulu plutot que de combler.
- Reponds dans la langue de la question.
- Environ ${mots} mots. Du texte suivi, pas de listes a puces, pas de formule d'appel ni de signature : c'est un champ de formulaire.
- Concret et sobre. Pas de superlatifs, pas de "je suis passionne par", pas de reformulation de la question.
- Ne produis que la reponse elle-meme, sans introduction ni commentaire.`;

const contenu = [
  ...(cv ? [cv] : []),
  {
    type: 'text',
    text: [
      cv ? null : 'Aucun CV disponible : appuie-toi uniquement sur les notes ci-dessous.',
      notes && `Notes sur le candidat :\n${notes}`,
      description && `Offre visee :\n${description}`,
      `Question posee par le formulaire :\n${question}`,
    ].filter(Boolean).join('\n\n'),
  },
];

const client = new Anthropic();

console.log('='.repeat(66));
console.log(`  Question : ${question.slice(0, 58)}`);
console.log(`  Sources  : ${[cv ? 'CV' : null, notes ? 'profil' : null, description ? 'offre' : null].filter(Boolean).join(' + ') || 'aucune'}`);
console.log('='.repeat(66) + '\n');

try {
  const flux = client.messages.stream({
    model: MODELE,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: SYSTEME,
    messages: [{ role: 'user', content: contenu }],
  });

  flux.on('text', (bout) => process.stdout.write(bout));
  const message = await flux.finalMessage();

  if (message.stop_reason === 'refusal') {
    console.log('\n\nLe modele a refuse de repondre a cette question. Redige-la toi-meme.');
  }

  console.log('\n\n' + '-'.repeat(66));
  console.log('  Brouillon. Relis-le, corrige les [A COMPLETER], reecris ce qui ne');
  console.log('  te ressemble pas, puis colle-le toi-meme dans le formulaire.');
  console.log('-'.repeat(66) + '\n');
} catch (e) {
  // Cle absente : le SDK leve avant meme la requete, avec une erreur generique.
  // Cle presente mais invalide : le serveur repond 401. Meme cause cote utilisateur,
  // meme marche a suivre.
  const sansCle = /resolve authentication method|apiKey/i.test(e.message || '');
  if (sansCle || e instanceof Anthropic.AuthenticationError) {
    console.error('\nAucune cle API valide.');
    console.error('Cree une cle sur https://console.anthropic.com/settings/keys puis, dans ce terminal :');
    console.error('  setx ANTHROPIC_API_KEY "sk-ant-..."');
    console.error('Ferme et rouvre le terminal, puis relance la commande.');
  } else if (e instanceof Anthropic.RateLimitError) {
    console.error('\nTrop de requetes. Attends une minute et relance.');
  } else {
    console.error(`\nEchec de la redaction : ${e.message}`);
  }
  process.exit(1);
}
