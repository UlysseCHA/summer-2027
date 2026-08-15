#!/usr/bin/env node
/**
 * Met une ou plusieurs entreprises sous surveillance.
 *
 *   npm run watch-add "Qatalyst Partners" finance
 *   npm run watch-add --file mes-entreprises.txt finance
 *
 * Si l'entreprise a deja un board, elle est ajoutee directement a data/sources.json
 * et ses offres arrivent des la prochaine collecte. Sinon elle entre dans
 * data/watchlist.json et le robot la re-teste a chaque collecte.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const SECTEURS = ['finance', 'tech', 'consulting'];
const industry = SECTEURS.find(s => args.includes(s)) || 'finance';

let noms = [];
const iFile = args.indexOf('--file');
if (iFile !== -1) {
  const brut = await readFile(resolve(args[iFile + 1]), 'utf8');
  noms = brut.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
} else {
  noms = args.filter(a => !SECTEURS.includes(a));
}

if (!noms.length) {
  console.error('Usage : npm run watch-add "Nom" [finance|tech|consulting]');
  console.error('        npm run watch-add --file liste.txt finance');
  process.exit(1);
}

const path = resolve(ROOT, 'data/watchlist.json');
const watch = JSON.parse(await readFile(path, 'utf8'));
const src = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));

const normal = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const dejaBoard = new Set(src.boards.map(b => normal(b.company)));
const dejaWatch = new Set((watch.companies || []).map(c => normal(c.name)));

const ajoutes = [];
const ignores = [];

for (const nom of noms) {
  const k = normal(nom);
  if (dejaBoard.has(k)) { ignores.push(`${nom} (deja un board suivi)`); continue; }
  if (dejaWatch.has(k)) { ignores.push(`${nom} (deja sous surveillance)`); continue; }
  watch.companies.push({ name: nom, industry });
  dejaWatch.add(k);
  ajoutes.push(nom);
}

watch.companies.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
await writeFile(path, JSON.stringify(watch, null, 2), 'utf8');

console.log(`${ajoutes.length} entreprise(s) mise(s) sous surveillance.`);
ajoutes.forEach(n => console.log(`  + ${n}`));
if (ignores.length) {
  console.log(`\n${ignores.length} ignoree(s) :`);
  ignores.forEach(n => console.log(`  - ${n}`));
}

if (!ajoutes.length) process.exit(0);

console.log('\nTest immediat : ont-elles deja un board ?\n');
spawnSync(process.execPath, [resolve(ROOT, 'scripts/watch.mjs')], { stdio: 'inherit' });
