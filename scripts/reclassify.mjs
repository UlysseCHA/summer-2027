#!/usr/bin/env node
/**
 * Recalcule l'annee de campagne des offres deja collectees, sans refaire le reseau.
 *
 *   node scripts/reclassify.mjs
 *
 * Utile apres une correction dans assets/classify.js : evite d'attendre une collecte
 * complete pour voir l'effet. Seules les offres dont l'annee venait du TITRE sont
 * retouchees : celles deduites de la description ne peuvent pas etre recalculees ici,
 * l'extrait conserve etant trop court.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET, inferCycle } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(ROOT, 'data/offers.json');
const data = JSON.parse(await readFile(path, 'utf8'));

let modifiees = 0;
const exemples = [];

for (const o of data.offers) {
  if (o.yearSource && o.yearSource !== 'title') continue;

  const avant = { year: o.year, cycle: o.cycle };
  const { year, season, yearSource } = inferCycle(o.title, '', o.kind);

  const posted = o.postedAt ? String(o.postedAt).slice(0, 10) : null;
  const dansFenetre = posted && posted >= TARGET.windowStart && posted <= TARGET.windowEnd;
  const cycle = year ?? (dansFenetre ? TARGET.year : null);

  if (avant.year !== year || avant.cycle !== cycle) {
    if (exemples.length < 12) exemples.push(`  ${String(avant.cycle).padEnd(6)} -> ${String(cycle).padEnd(6)} ${o.company.padEnd(18)} ${o.title.slice(0, 52)}`);
    modifiees++;
  }

  o.year = year;
  o.season = season || (o.kind === 'internship' ? 'summer' : null);
  o.yearSource = yearSource;
  o.cycle = cycle;
  o.cycleSource = year ? yearSource : (cycle ? 'posting-date' : null);
}

const tally = fn => data.offers.reduce((a, o) => { const k = fn(o); a[k] = (a[k] || 0) + 1; return a; }, {});
data.counts.byYear = tally(o => o.year || 'non precisee');
data.counts.byCycle = tally(o => o.cycle || 'non precisee');

await writeFile(path, JSON.stringify(data, null, 1), 'utf8');

console.log(`${modifiees} offres reclassees\n`);
exemples.forEach(e => console.log(e));
console.log(`\npar campagne : ${JSON.stringify(data.counts.byCycle)}`);
