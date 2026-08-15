#!/usr/bin/env node
/**
 * Re-teste les entreprises de data/watchlist.json : celles qui n'avaient pas de job
 * board exploitable la derniere fois.
 *
 *   node scripts/watch.mjs            # teste et ajoute ce qui est trouve
 *   node scripts/watch.mjs --dry-run  # teste sans rien modifier
 *
 * Une entreprise peut ouvrir un board du jour au lendemain, ou migrer d'ATS. Ce script
 * tourne a chaque collecte : le jour ou l'une d'elles devient lisible, elle passe
 * automatiquement dans data/sources.json et ses offres entrent dans l'app.
 *
 * Il n'ajoute que ce qu'il peut rattacher a l'entreprise avec certitude : un slug
 * generique qui repond n'est pas une preuve.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJobs, isCandidate } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'summer-internships-board/1.0 (aggregator; public job board APIs)';
const NAVIGATEUR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DRY = process.argv.includes('--dry-run');

const urls = {
  greenhouse: t => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  lever: t => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: t => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=false`,
};

/** Mots trop communs pour prouver qu'un board appartient bien a l'entreprise. */
const VIDES = new Set(['the', 'group', 'capital', 'partners', 'management', 'company', 'holdings',
  'investment', 'investments', 'asset', 'global', 'international', 'and', 'advisors', 'securities',
  'associates', 'technologies', 'solutions', 'services']);

const motsCles = nom => nom.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter(w => w.length >= 4 && !VIDES.has(w));

function slugs(nom) {
  const base = nom.toLowerCase().replace(/[.'’&]/g, '').replace(/\s+/g, ' ').trim();
  const w = base.split(' ').filter(x => !['the', 'and'].includes(x));
  const j = w.join('');
  const out = [j, w.join('-')];
  if (w.length > 1) out.push(w.slice(0, 2).join(''));
  if (w[0].length >= 7) out.push(w[0]);
  out.push(j + 'careers');
  return [...new Set(out.filter(s => s.length >= 4))];
}

/**
 * Le board correspond-il vraiment a cette entreprise ?
 *
 * Ce script devine des slugs, donc il tombe forcement sur des homonymes. On exige que
 * TOUS les mots distinctifs du nom se retrouvent dans la cible, pas seulement un.
 * Sans cette severite : « Marshall Wace » attrapait le tenant de Marshall of Cambridge
 * (aeronautique), « American Express » celui d'American University, et « Chatham
 * Financial » celui de Chatham University.
 */
function correspond(nom, cible) {
  const mots = motsCles(nom);
  if (!mots.length) return false;
  const t = cible.toLowerCase();
  return mots.every(m => t.includes(m));
}

async function chercheBoard(nom, industry) {
  for (const token of slugs(nom)) {
    for (const ats of ['greenhouse', 'lever', 'ashby']) {
      try {
        const r = await fetch(urls[ats](token), {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) continue;
        const payload = await r.json();
        const jobs = ats === 'lever' ? payload : payload?.jobs;
        if (!Array.isArray(jobs) || !jobs.length) continue;

        const first = jobs[0] || {};
        const lien = first.absolute_url || first.hostedUrl || first.jobUrl || '';
        const orga = ats === 'ashby' ? payload?.organizationName || '' : '';
        if (!correspond(nom, `${lien} ${orga} ${token}`)) continue;

        const early = parseJobs(ats, payload, { company: nom, ats, token, industry, tags: [] });
        return { ats, token, total: jobs.length, early: early.length };
      } catch { /* on essaie la variante suivante */ }
    }
  }
  return null;
}

/** Workday : le robots.txt du tenant declare ses sites carriere. */
async function chercheWorkday(nom) {
  for (const tenant of slugs(nom).filter(s => !s.includes('-'))) {
    for (const wd of ['wd1', 'wd3', 'wd5', 'wd103']) {
      try {
        const r = await fetch(`https://${tenant}.${wd}.myworkdayjobs.com/robots.txt`, {
          headers: { 'user-agent': NAVIGATEUR }, signal: AbortSignal.timeout(9000),
        });
        if (!r.ok) continue;
        const txt = await r.text();
        if (!/myworkdayjobs\.com/i.test(txt)) continue;
        const sites = [...new Set([...txt.matchAll(/Sitemap:\s*https?:\/\/[^/]+\/([^/]+)\/siteMap\.xml/gi)].map(m => m[1]))]
          .filter(s => !/ghost|test|internal|confidential|invitation|restricted|private|referral/i.test(s));
        if (!sites.length) continue;

        const site = sites.find(s => /campus|student|university|graduate|early/i.test(s)) || sites[0];

        // Meme severite que pour les autres ATS : le tenant seul ne prouve rien.
        if (!correspond(nom, `${tenant} ${site}`)) continue;

        const jr = await fetch(`https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': NAVIGATEUR },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '2027' }),
          signal: AbortSignal.timeout(12000),
        });
        if (!jr.ok) continue;
        const j = await jr.json();
        if (typeof j?.total !== 'number') continue;
        const early = (j.jobPostings || []).filter(p => isCandidate(p.title || '')).length;
        return { ats: 'workday', tenant, wd, site, total: j.total, early };
      } catch { /* variante suivante */ }
    }
  }
  return null;
}

/* ------------------------------------------------------------------- main */

const watch = JSON.parse(await readFile(resolve(ROOT, 'data/watchlist.json'), 'utf8'));
const src = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));

const normal = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const dejaSuivies = new Set(src.boards.map(b => normal(b.company)));

const aTester = (watch.companies || []).filter(c => c.name && !dejaSuivies.has(normal(c.name)));
console.log(`Liste de surveillance : ${watch.companies?.length || 0} entreprises, ${aTester.length} encore sans board.\n`);

const trouves = [];
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < aTester.length) {
    const c = aTester[i++];
    const board = await chercheBoard(c.name, c.industry || 'finance') || await chercheWorkday(c.name);
    if (board) {
      trouves.push({ company: c.name, industry: c.industry || 'finance', tags: c.tags || [], ...board });
      console.log(`  NOUVEAU BOARD  ${c.name.padEnd(28)} ${board.ats}/${board.token || board.tenant + '/' + board.site}  ${board.early} offres early-career`);
    }
  }
}));

if (!trouves.length) {
  console.log('  Aucun nouveau board. Rien ne change.');
  process.exit(0);
}

if (DRY) {
  console.log(`\n${trouves.length} board(s) trouve(s). Mode --dry-run : data/sources.json n'est pas modifie.`);
  process.exit(0);
}

src.boards.push(...trouves.map(t => t.ats === 'workday'
  ? { company: t.company, ats: 'workday', tenant: t.tenant, wd: t.wd, site: t.site, industry: t.industry, tags: t.tags }
  : { company: t.company, ats: t.ats, token: t.token, industry: t.industry, tags: t.tags }));

const order = { finance: 0, consulting: 1, tech: 2 };
src.boards.sort((a, b) => order[a.industry] - order[b.industry] || a.company.localeCompare(b.company, 'fr'));

const line = b => '    ' + JSON.stringify(
  b.ats === 'workday'
    ? { company: b.company, ats: b.ats, tenant: b.tenant, wd: b.wd, site: b.site, industry: b.industry, tags: b.tags || [] }
    : { company: b.company, ats: b.ats, token: b.token, industry: b.industry, tags: b.tags || [] });

await writeFile(resolve(ROOT, 'data/sources.json'),
  `{\n  "_comment": ${JSON.stringify(src._comment)},\n  "boards": [\n${src.boards.map(line).join(',\n')}\n  ]\n}\n`, 'utf8');

console.log(`\n${trouves.length} entreprise(s) ajoutee(s) a data/sources.json. ${src.boards.length} boards suivis.`);
console.log('Leurs offres entreront dans l app a la prochaine collecte.');
