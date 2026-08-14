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
import { TARGET, listUrl, detailUrl, parseJobs, buildOffer, stripHtml, workdayBase } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'summer-internships-board/1.0 (aggregator; public job board APIs)';
const CONCURRENCY = 8;
const TIMEOUT = 20_000;

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i === -1 ? null : new Set(argv[i + 1].split(',').map(s => s.trim().toLowerCase()));
})();

/** Un board est-il vise par --only ? On accepte le nom, le token ou le tenant. */
const isTargeted = (b) => !ONLY
  || [b.company, b.token, b.tenant].some(v => v && ONLY.has(String(v).toLowerCase()));

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

async function postJson(url, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
        body: JSON.stringify(body),
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

/*
 * Workday n'a pas de « liste complete » exploitable : certains employeurs ont des
 * milliers de postes. On lance donc quelques recherches ciblees et on dedoublonne.
 * Les termes couvrent les formulations vues chez les banques (« Summer Analyst »)
 * comme chez les entreprises tech (« intern »).
 */
const WORKDAY_QUERIES = ['2027', 'intern', 'summer analyst', 'graduate', 'campus', 'apprentice', 'placement'];
const WORKDAY_PAGE = 20;
const WORKDAY_MAX_PER_QUERY = 100;
const WORKDAY_MAX_SITES = 4;

/* Sites a ne jamais interroger : instances de test, portails internes, et les
   « ghost sites » que Workday cree pour chaque cabinet de recrutement partenaire. */
const SITE_IGNORE = /ghost|test|internal|confidential|invitation|restricted|contractor|private|referral/i;

/* Un stage se trouve rarement sur le site principal : les banques ont un site campus
   distinct. On les fait passer devant. */
const SITE_PRIORITAIRE = /campus|student|university|graduate|early|intern|school/i;

/**
 * Sites carriere declares par le tenant dans son robots.txt.
 * C'est ce qui a permis de trouver Blackstone_Campus_Careers, Moelis University-Hires
 * et PJT Students, invisibles depuis la page carriere publique.
 */
async function workdaySites(board) {
  const configure = board.site ? [board.site] : [];
  try {
    const res = await fetch(`${workdayBase(board)}/robots.txt`, {
      headers: { 'user-agent': UA, accept: 'text/plain,*/*' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return configure;
    const txt = await res.text();
    const declares = [...new Set([...txt.matchAll(/Sitemap:\s*https?:\/\/[^/]+\/([^/]+)\/siteMap\.xml/gi)].map(m => m[1]))]
      .filter(s => !SITE_IGNORE.test(s));

    const tries = [...new Set([
      ...declares.filter(s => SITE_PRIORITAIRE.test(s)),
      ...configure,
      ...declares,
    ])];
    return tries.slice(0, WORKDAY_MAX_SITES);
  } catch {
    return configure;
  }
}

async function fetchWorkday(board) {
  const sites = await workdaySites(board);
  const seen = new Map();

  for (const site of sites) {
    const base = `${workdayBase(board)}/wday/cxs/${board.tenant}/${site}`;
    for (const searchText of WORKDAY_QUERIES) {
      for (let offset = 0; offset < WORKDAY_MAX_PER_QUERY; offset += WORKDAY_PAGE) {
        const page = await postJson(`${base}/jobs`, { appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText });
        const postings = page?.jobPostings || [];
        // Le site sert a reconstruire l'URL publique de l'annonce.
        for (const j of postings) if (j.externalPath) seen.set(j.externalPath, { ...j, _site: site });
        if (postings.length < WORKDAY_PAGE || offset + WORKDAY_PAGE >= (page?.total ?? 0)) break;
      }
    }
  }

  // On ne garde que les titres early-career avant de charger les fiches detaillees.
  const candidates = parseJobs('workday', { jobPostings: [...seen.values()] }, board)
    .map((r, i) => ({ ...r, _site: [...seen.values()][i]?._site || board.site }));

  const details = await pool(candidates, r =>
    getJson(`${workdayBase(board)}/wday/cxs/${board.tenant}/${r._site}${r.externalId}`), 5);

  candidates.forEach((r, k) => {
    r.url = `${workdayBase(board)}/${r._site}${r.externalId}`;
    const info = details[k]?.jobPostingInfo;
    if (!info) return;
    r.description = stripHtml(info.jobDescription || '');
    r.postedAt = info.startDate || r.postedAt;
    r.url = info.externalUrl || r.url;
  });

  return candidates.map(r => buildOffer(board, r));
}

/**
 * Recupere les annonces early-career d'un board.
 * Greenhouse n'expose pas la description dans la liste : on la charge poste par poste,
 * mais uniquement pour les titres deja retenus (l'annee du programme y est souvent).
 */
async function fetchBoard(board) {
  if (board.ats === 'workday') return fetchWorkday(board);

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
const targets = boards.filter(isTargeted);

if (!targets.length) {
  console.error('Aucun board ne correspond a --only : rien a faire, data/offers.json est laisse intact.');
  process.exit(1);
}

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
if (failed.length) log(`  ${failed.length} board(s) en echec : ${failed.map(f => `${f.company} (${f.error})`).join(', ')}`);
