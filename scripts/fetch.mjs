#!/usr/bin/env node
/**
 * Agrege les offres early-career depuis les job boards publics (Greenhouse, Lever, Ashby)
 * des entreprises listees dans data/sources.json, puis ecrit data/offers.json.
 *
 *   node scripts/fetch.mjs            # tout
 *   node scripts/fetch.mjs --only imc,optiverus
 *   node scripts/fetch.mjs --quiet
 *
 * Zero dependance : fetch natif Node >= 18.
 * La classification (type de poste, annee, metier, region) vit dans assets/classify.js,
 * partagee avec le rafraichissement live du navigateur pour eviter toute divergence.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET, listUrl, detailUrl, parseJobs, buildOffer, stripHtml } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'summer-internships-board/1.0 (aggregator; public job board APIs)';
const CONCURRENCY = 8;
const TIMEOUT = 20_000;

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i === -1 ? null : new Set(argv[i + 1].split(',').map(s => s.trim()));
})();

const log = (...a) => { if (!QUIET) console.log(...a); };

/* --------------------------------------------------------------- reseau */

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function pool(items, worker, concurrency = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); }
      catch { out[idx] = null; }
    }
  }));
  return out;
}

/**
 * Recupere les annonces early-career d'un board.
 * Greenhouse n'expose pas la description dans la liste : on la charge poste par poste,
 * mais uniquement pour les titres deja retenus (l'annee du programme y est souvent).
 */
async function fetchBoard(board) {
  const payload = await getJson(listUrl(board.ats, board.token));
  const raw = parseJobs(board.ats, payload, board);

  if (board.ats === 'greenhouse' && raw.length) {
    const details = await pool(raw, r => getJson(detailUrl(board.ats, board.token, r.externalId)), 6);
    raw.forEach((r, k) => {
      if (!details[k]) return;
      r.description = stripHtml(details[k].content || '');
      r.postedAt = details[k].first_published || r.postedAt;
      r.department ||= details[k].departments?.[0]?.name || '';
    });
  }

  return raw.map(r => buildOffer(board, r));
}

/* ----------------------------------------------------------------- main */

const { boards } = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));
const targets = ONLY ? boards.filter(b => ONLY.has(b.token) || ONLY.has(b.company)) : boards;

log(`-> ${targets.length} job boards a interroger...\n`);

const stats = [];
const offers = [];
let done = 0;

await pool(targets, async (board) => {
  try {
    const found = await fetchBoard(board);
    offers.push(...found.filter(o => o.url && o.title));
    stats.push({ company: board.company, token: board.token, ats: board.ats, found: found.length, ok: true });
    log(`  ok ${String(++done).padStart(3)}/${targets.length}  ${board.company.padEnd(26)} ${String(found.length).padStart(3)} offres early-career`);
  } catch (err) {
    stats.push({ company: board.company, token: board.token, ats: board.ats, found: 0, ok: false, error: String(err.message || err) });
    log(`  KO ${String(++done).padStart(3)}/${targets.length}  ${board.company.padEnd(26)} echec (${err.message})`);
  }
});

// Dedoublonnage par URL (certaines boites republient la meme annonce).
const seen = new Set();
const unique = offers.filter(o => (seen.has(o.url) ? false : seen.add(o.url)));

unique.sort((a, b) => {
  // La campagne visee d'abord, puis les annonces les plus fraiches.
  const ta = a.cycle === TARGET.year ? 0 : 1, tb = b.cycle === TARGET.year ? 0 : 1;
  if (ta !== tb) return ta - tb;
  return String(b.postedAt || '').localeCompare(String(a.postedAt || ''));
});

const tally = (fn) => unique.reduce((acc, o) => { const k = fn(o); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

const payload = {
  generatedAt: new Date().toISOString(),
  target: TARGET,
  counts: {
    total: unique.length,
    byYear: tally(o => o.year || 'non precisee'),
    byCycle: tally(o => o.cycle || 'non precisee'),
    byIndustry: tally(o => o.industry),
    byKind: tally(o => o.kind),
  },
  sources: stats.sort((a, b) => b.found - a.found),
  offers: unique,
};

await mkdir(resolve(ROOT, 'data'), { recursive: true });
await writeFile(resolve(ROOT, 'data/offers.json'), JSON.stringify(payload, null, 1), 'utf8');

log(`\nOK : ${unique.length} offres ecrites dans data/offers.json`);
log(`  par campagne : ${JSON.stringify(payload.counts.byCycle)}`);
log(`  par secteur  : ${JSON.stringify(payload.counts.byIndustry)}`);
log(`  par type     : ${JSON.stringify(payload.counts.byKind)}`);
const failed = stats.filter(s => !s.ok);
if (failed.length) log(`  ${failed.length} board(s) en echec : ${failed.map(f => f.token).join(', ')}`);
