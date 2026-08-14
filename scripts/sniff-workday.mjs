#!/usr/bin/env node
/**
 * Cherche les employeurs heberges sur Workday, a partir d'une liste de noms.
 *
 *   node scripts/sniff-workday.mjs noms.json
 *   node scripts/sniff-workday.mjs noms.json --out data/workday-trouves.json
 *
 * Methode : chaque tenant Workday publie un robots.txt qui liste ses sites carriere
 * et autorise explicitement leur exploration. On devine le tenant a partir du nom de
 * l'entreprise, on lit son robots.txt, puis on interroge l'API publique du site.
 *
 * Rien n'est ajoute automatiquement a data/sources.json : le resultat est ecrit dans
 * un fichier a relire avant integration, car un slug court peut appartenir a une
 * autre societe.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCandidate } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ACCEPT = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const HOSTS = ['wd1', 'wd3', 'wd5', 'wd2', 'wd12', 'wd103'];
const CONCURRENCY = 12;

const [fichier, ...rest] = process.argv.slice(2);
if (!fichier) {
  console.error('Usage : node scripts/sniff-workday.mjs <fichier-de-noms.json> [--out chemin.json]');
  process.exit(1);
}
const outIdx = rest.indexOf('--out');
const OUT = outIdx === -1 ? resolve(ROOT, 'data/workday-trouves.json') : resolve(rest[outIdx + 1]);

const noms = JSON.parse(await readFile(resolve(fichier), 'utf8'));

/** Slugs de tenant plausibles. Workday utilise en general le nom accole, en minuscules. */
function tenants(nom) {
  const base = nom.toLowerCase().replace(/[.,'’&]/g, '').replace(/\s+/g, ' ').trim();
  const mots = base.split(' ').filter(w => !['the', 'group', 'and', 'of'].includes(w));
  const joint = mots.join('');
  const out = [joint];
  if (mots.length > 1) out.push(mots.slice(0, 2).join(''), mots[0]);
  else out.push(mots[0]);
  return [...new Set(out.filter(s => s.length >= 4 && s.length <= 28))];
}

/** Lit le robots.txt du tenant et en extrait les sites carriere declares. */
async function sitesDuTenant(tenant, wd) {
  try {
    const r = await fetch(`https://${tenant}.${wd}.myworkdayjobs.com/robots.txt`, { headers: ACCEPT, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const txt = await r.text();
    if (!/myworkdayjobs\.com/i.test(txt)) return null;
    const sites = [...txt.matchAll(/Sitemap:\s*https?:\/\/[^/]+\/([^/]+)\/siteMap\.xml/gi)].map(m => m[1]);
    // « Private » n'est pas un site candidat public.
    return [...new Set(sites)].filter(s => !/^private$/i.test(s));
  } catch { return null; }
}

async function compter(tenant, wd, site) {
  try {
    const r = await fetch(`https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '2027' }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j?.total !== 'number') return null;
    const postes = j.jobPostings || [];
    return {
      total: j.total,
      early: postes.filter(p => isCandidate(p.title || '')).length,
      exemple: postes.find(p => isCandidate(p.title || ''))?.title || postes[0]?.title || '',
    };
  } catch { return null; }
}

const taches = [];
for (const nom of noms) for (const t of tenants(nom)) for (const wd of HOSTS) taches.push({ nom, t, wd });

console.log(`${noms.length} entreprises, ${taches.length} tenants a sonder...\n`);

const trouves = new Map();
let i = 0, faits = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (i < taches.length) {
    const { nom, t, wd } = taches[i++];
    if (++faits % 2000 === 0) console.log(`  ${faits}/${taches.length} (${trouves.size} trouvees)`);
    if (trouves.has(nom)) continue;

    const sites = await sitesDuTenant(t, wd);
    if (!sites?.length) continue;

    for (const site of sites) {
      const c = await compter(t, wd, site);
      if (!c) continue;
      const prec = trouves.get(nom);
      if (!prec || c.early > prec.early) {
        trouves.set(nom, { company: nom, tenant: t, wd, site, ...c });
      }
    }
    if (trouves.has(nom)) {
      const f = trouves.get(nom);
      console.log(`+ ${nom.padEnd(30)} ${f.tenant}/${f.wd}/${f.site.slice(0, 28).padEnd(28)} ${String(f.total).padStart(4)} res., ${f.early} early | ${f.exemple.slice(0, 44)}`);
    }
  }
}));

const res = [...trouves.values()].sort((a, b) => b.early - a.early || b.total - a.total);
await writeFile(OUT, JSON.stringify({ sniffedAt: new Date().toISOString(), found: res.length, boards: res }, null, 1), 'utf8');

console.log(`\n${res.length} employeurs Workday trouves, dont ${res.filter(r => r.early > 0).length} avec des offres early-career.`);
console.log(`Resultat : ${OUT}`);
console.log('A relire avant integration : un slug court peut appartenir a une autre societe.');
