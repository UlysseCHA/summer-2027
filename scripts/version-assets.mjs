#!/usr/bin/env node
/**
 * Estampille les fichiers du site avec la date du jour, pour que le navigateur
 * recharge la nouvelle version au lieu de servir l'ancienne.
 *
 *   node scripts/version-assets.mjs
 *
 * GitHub Pages met un cache de dix minutes sur chaque fichier, sans les
 * synchroniser entre eux. Un index.html neuf pouvait donc arriver avec un app.js
 * perime : la case « intitule contenant summer » s'affichait, et cocher ne faisait
 * rien puisque le code du filtre n'etait pas encore la. Le decalage est invisible
 * et donne l'impression d'un bug.
 *
 * On estampille aussi les imports entre modules : une version sur le seul point
 * d'entree ne rafraichit pas les fichiers qu'il importe.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const v = new Date().toISOString().slice(0, 10).replace(/-/g, '');

const estampiller = (texte, motifs) => motifs.reduce(
  (t, [re, remp]) => t.replace(re, remp.replace('{v}', v)), texte);

const fichiers = [
  ['index.html', [
    [/href="assets\/styles\.css(\?v=\d+)?"/g, 'href="assets/styles.css?v={v}"'],
    [/src="assets\/app\.js(\?v=\d+)?"/g, 'src="assets/app.js?v={v}"'],
  ]],
  ['assets/app.js', [
    [/from '\.\/live\.js(\?v=\d+)?'/g, "from './live.js?v={v}'"],
    [/from '\.\/auth\.js(\?v=\d+)?'/g, "from './auth.js?v={v}'"],
  ]],
  ['assets/live.js', [
    [/from '\.\/classify\.js(\?v=\d+)?'/g, "from './classify.js?v={v}'"],
  ]],
];

for (const [nom, motifs] of fichiers) {
  const chemin = resolve(ROOT, nom);
  const avant = await readFile(chemin, 'utf8');
  const apres = estampiller(avant, motifs);
  if (avant !== apres) await writeFile(chemin, apres, 'utf8');
  console.log(`  ${avant === apres ? 'inchange' : 'estampille'}  ${nom}`);
}
console.log(`\nVersion ${v}. A relancer apres chaque modification du site.`);
