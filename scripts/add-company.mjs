#!/usr/bin/env node
/**
 * Ajoute une entreprise a l'app en une commande.
 *
 *   npm run add "Wincent"
 *   npm run add "Wincent" finance
 *   npm run add "Maven Securities" finance trading,quant
 *
 * Cherche son job board (Greenhouse, Lever, Ashby), et a defaut identifie son ATS
 * depuis sa page carriere. Si un board est trouve, l'entreprise est ajoutee a
 * data/sources.json et ses offres sont collectees immediatement.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseJobs } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'summer-internships-board/1.0 (aggregator; public job board APIs)';

const [name, industryArg, tagsArg] = process.argv.slice(2);

if (!name) {
  console.error('Usage : npm run add "Nom de l entreprise" [finance|tech|consulting] [tag1,tag2]');
  process.exit(1);
}

const industry = ['finance', 'tech', 'consulting'].includes(industryArg) ? industryArg : 'finance';
const tags = tagsArg ? tagsArg.split(',').map(s => s.trim()).filter(Boolean) : [];

/* Variantes de slug, identiques a celles de scripts/discover.mjs. */
function slugVariants(label) {
  const base = label.toLowerCase().replace(/[.'’]/g, '').trim();
  const words = base.split(/\s+/);
  const joined = words.join('');
  return [...new Set([
    joined, words.join('-'), words[0],
    joined + 'inc', joined + 'llc', joined + 'careers', joined + 'jobs',
    words.join('-') + '-inc', words[0] + 'hq', joined + 'hq',
    words.length > 1 ? words.slice(0, 2).join('') : null,
    joined.replace(/(and|&)/g, ''),
  ].filter(Boolean))];
}

async function probe(ats, token) {
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
    lever: `https://api.lever.co/v0/postings/${token}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`,
  };
  try {
    const res = await fetch(urls[ats], { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const payload = await res.json();
    const jobs = ats === 'lever' ? payload : payload?.jobs;
    if (!Array.isArray(jobs) || !jobs.length) return null;
    const board = { company: name, ats, token, industry, tags };
    return { ats, token, total: jobs.length, early: parseJobs(ats, payload, board).length };
  } catch { return null; }
}

console.log(`Recherche du job board de « ${name} »...\n`);

const tasks = [];
for (const token of slugVariants(name)) for (const ats of ['greenhouse', 'lever', 'ashby']) tasks.push({ ats, token });

const hits = [];
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < tasks.length) {
    const t = tasks[i++];
    const r = await probe(t.ats, t.token);
    if (r) { hits.push(r); console.log(`  trouve : ${r.ats} / ${r.token} (${r.total} postes, ${r.early} early-career)`); }
  }
}));

if (!hits.length) {
  console.log('\nAucun board public trouve sur Greenhouse, Lever ou Ashby.');
  console.log('Cette entreprise utilise sans doute Workday, Oracle ou un portail maison.');
  console.log('Piste : ajoute sa page carriere a data/portals.json, puis lance `npm run sniff`');
  console.log('pour identifier son ATS et recuperer les identifiants Workday si c en est un.');
  process.exit(2);
}

// On garde le board qui a le plus d'offres early-career.
hits.sort((a, b) => b.early - a.early || b.total - a.total);
const best = hits[0];

const path = resolve(ROOT, 'data/sources.json');
const src = JSON.parse(await readFile(path, 'utf8'));

if (src.boards.some(b => b.ats === best.ats && b.token === best.token)) {
  console.log(`\n« ${name} » est deja suivie (${best.ats} / ${best.token}).`);
  process.exit(0);
}

src.boards.push({ company: name, ats: best.ats, token: best.token, industry, tags });

const order = { finance: 0, consulting: 1, tech: 2 };
src.boards.sort((a, b) => order[a.industry] - order[b.industry] || a.company.localeCompare(b.company, 'fr'));

const line = b => '    ' + JSON.stringify(
  b.ats === 'workday'
    ? { company: b.company, ats: b.ats, tenant: b.tenant, wd: b.wd, site: b.site, industry: b.industry, tags: b.tags || [] }
    : { company: b.company, ats: b.ats, token: b.token, industry: b.industry, tags: b.tags || [] }
);

await writeFile(path, `{\n  "_comment": ${JSON.stringify(src._comment)},\n  "boards": [\n${src.boards.map(line).join(',\n')}\n  ]\n}\n`, 'utf8');

console.log(`\nAjoutee : ${name} (${best.ats} / ${best.token}, secteur ${industry}).`);
console.log(`${src.boards.length} boards suivis desormais.\n`);
console.log('Collecte de ses offres...\n');

// --only ne touche que cette entreprise, mais fetch.mjs reecrit tout le fichier :
// on relance donc une collecte complete pour ne rien perdre.
const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/fetch.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 0);
