#!/usr/bin/env node
/**
 * Identifie quel logiciel de recrutement (ATS) se cache derriere chaque employeur de
 * data/portals.json, en suivant sa page carriere et en cherchant des signatures connues.
 *
 *   node scripts/sniff-ats.mjs
 *
 * Beaucoup d'ATS exposent une API JSON publique (Workday, Oracle, Phenom,
 * SmartRecruiters, SuccessFactors). En trouver la trace permet de lister les offres
 * une par une au lieu de se contenter d'un lien vers le portail.
 *
 * Ecrit data/ats-sniff.json.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/* Signatures : chacune extrait les identifiants utiles si elle correspond. */
const SIGNATURES = [
  {
    ats: 'workday',
    test: /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i,
    read: m => ({ tenant: m[1], wd: m[2], site: m[3] }),
  },
  {
    ats: 'oracle',
    test: /https?:\/\/([a-z0-9-]+)\.fa\.([a-z0-9]+)\.oraclecloud\.com\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_-]+)/i,
    read: m => ({ host: m[1], dc: m[2], site: m[3] }),
  },
  {
    ats: 'smartrecruiters',
    test: /(?:api\.smartrecruiters\.com\/v1\/companies\/|careers\.smartrecruiters\.com\/)([A-Za-z0-9_-]+)/i,
    read: m => ({ company: m[1] }),
  },
  {
    ats: 'successfactors',
    test: /https?:\/\/([a-z0-9-]+)\.(?:jobs\.)?(?:sapsf|successfactors)\.(?:com|eu)/i,
    read: m => ({ tenant: m[1] }),
  },
  {
    ats: 'phenom',
    test: /(?:phenompeople|phenom\.com|\/widgets\?|ph_search)/i,
    read: () => ({}),
  },
  {
    ats: 'avature',
    test: /https?:\/\/([a-z0-9-]+)\.avature\.net/i,
    read: m => ({ tenant: m[1] }),
  },
  {
    ats: 'taleo',
    test: /https?:\/\/([a-z0-9-]+)\.taleo\.net/i,
    read: m => ({ tenant: m[1] }),
  },
  {
    ats: 'icims',
    test: /https?:\/\/([a-z0-9-]+)\.icims\.com/i,
    read: m => ({ tenant: m[1] }),
  },
  {
    ats: 'eightfold',
    test: /https?:\/\/([a-z0-9.-]+)\/careers\?(?:.*)pid=|eightfold\.ai/i,
    read: () => ({}),
  },
  {
    ats: 'greenhouse',
    test: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/i,
    read: m => ({ token: m[1] }),
  },
  {
    ats: 'lever',
    test: /jobs\.lever\.co\/([A-Za-z0-9_-]+)/i,
    read: m => ({ token: m[1] }),
  },
  {
    ats: 'ashby',
    test: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/i,
    read: m => ({ token: m[1] }),
  },
];

async function grab(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(25_000),
  });
  const html = await res.text();
  return { status: res.status, finalUrl: res.url, html };
}

function detect(text) {
  const hits = [];
  for (const sig of SIGNATURES) {
    const m = text.match(sig.test);
    if (m) hits.push({ ats: sig.ats, ...sig.read(m) });
  }
  return hits;
}

const { portals } = JSON.parse(await readFile(resolve(ROOT, 'data/portals.json'), 'utf8'));

const results = [];
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < portals.length) {
    const p = portals[i++];
    try {
      const { status, finalUrl, html } = await grab(p.url);
      // L'URL finale compte autant que le HTML : beaucoup de pages redirigent vers l'ATS.
      const hits = detect(finalUrl + '\n' + html);
      results.push({ company: p.company, industry: p.industry, url: p.url, finalUrl, status, hits });
      const label = hits.length ? hits.map(h => h.ats).join(', ') : 'rien de detecte';
      console.log(`  ${p.company.padEnd(24)} ${String(status).padEnd(4)} ${label}`);
    } catch (err) {
      results.push({ company: p.company, industry: p.industry, url: p.url, error: String(err.message || err), hits: [] });
      console.log(`  ${p.company.padEnd(24)} KO   ${err.message}`);
    }
  }
}));

results.sort((a, b) => a.company.localeCompare(b.company, 'fr'));
await writeFile(resolve(ROOT, 'data/ats-sniff.json'), JSON.stringify({ sniffedAt: new Date().toISOString(), results }, null, 1), 'utf8');

const tally = {};
for (const r of results) for (const h of new Set(r.hits.map(x => x.ats))) tally[h] = (tally[h] || 0) + 1;
console.log(`\n${results.filter(r => r.hits.length).length}/${results.length} employeurs avec un ATS identifie`);
console.log(JSON.stringify(tally, null, 1));
