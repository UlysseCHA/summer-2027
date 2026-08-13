/**
 * Logique partagée entre le collecteur Node (scripts/fetch.mjs) et le rafraîchissement
 * live dans le navigateur (assets/live.js). Aucune I/O ici : que des fonctions pures,
 * pour que les deux côtés classent une offre exactement de la même façon.
 */

/**
 * Campagne visée. Beaucoup d'annonces ne mentionnent jamais l'année (« Quantitative
 * Research Intern » chez DRW) : si l'annonce est publiée pendant la fenêtre de
 * recrutement de la campagne, on la rattache à celle-ci et on le signale (source
 * « posting-date »), plutôt que de la laisser sans année.
 */
export const TARGET = { year: 2027, season: 'summer', windowStart: '2026-06-01', windowEnd: '2027-07-31' };

/* ------------------------------------------------------------------ filtres */

// « stage » à la française : évite « Growth Stage », « Series A stage », etc.
const STAGE_FR = /(^|[\s\-–—(])stage\s*(:|-|–|—|\bde\b|\ben\b|\bd'|\bf\/h|\bh\/f|\d{4})/i;

// Titres qui sentent le début de carrière (large : on affine ensuite).
export const EARLY = new RegExp(
  '\\b(intern|interns|internship|internships|summer analyst|summer associate|summer program|campus|graduate|grad program|new ?grad|university|undergrad|student|placement|co-?op|apprentice|apprenticeship|trainee|early career|early-career|off-?cycle|penultimate|spring week|insight (week|program|programme)|stagiaire|alternance|alternant|praktikum|working student)\\b'
  + '|' + STAGE_FR.source, 'i');

// Faux positifs : postes seniors qui parlent d'étudiants, et annonces qui ne sont pas des offres.
export const NOT_EARLY = /\b(recruit|recruiter|recruiting|talent acquisition|university relations|campus manager|head of|director|manager, campus|program manager|coordinator|partnerships|talent community|expression of interest|expressions of interest|sneak peek|challenge|connect with us|meet us|hiring event|info session|growth stage|early stage|late stage|stage manager)\b/i;

const INTERNSHIP = new RegExp(
  '\\b(intern|interns|internship|internships|summer analyst|summer associate|summer program|placement|co-?op|off-?cycle|spring week|insight (week|program|programme)|stagiaire|praktikum|working student|apprentice|apprenticeship)\\b'
  + '|' + STAGE_FR.source, 'i');
const GRADUATE = /\b(graduate|grad program|new ?grad|full-?time analyst|full time analyst|campus hire|trainee|rotational program)\b/i;

/** Un titre mérite-t-il qu'on s'y intéresse ? */
export const isCandidate = (title = '') => EARLY.test(title) && !NOT_EARLY.test(title);

const TRACKS = [
  ['quant',       /\b(quant|quantitative|trader|trading|researcher, systematic|market maker|market making|systematic)\b/i],
  ['ai-ml',       /\b(machine learning|deep learning|\bml\b|\bai\b|research scientist|research engineer|nlp|computer vision|llm)\b/i],
  ['engineering', /\b(software|engineer|engineering|developer|swe|backend|back-end|frontend|front-end|full-?stack|infrastructure|platform|systems|fpga|hardware|asic|security|devops|sre|mobile|ios|android)\b/i],
  ['data',        /\b(data scien|data engineer|data analy|analytics|business intelligence|\bbi\b)\b/i],
  ['banking',     /\b(investment banking|\bm&a\b|capital markets|equity research|coverage|leveraged finance|sales & trading|sales and trading|markets|wealth management|asset management|private equity|credit|risk|portfolio|investment)\b/i],
  ['consulting',  /\b(consultant|consulting|strategy|advisory|associate consultant|business analyst|transformation|restructuring)\b/i],
  ['product',     /\b(product manager|product management|\bpm\b, |technical program|program management)\b/i],
  ['design',      /\b(design|designer|\bux\b|\bui\b|user research)\b/i],
  ['business',    /\b(marketing|sales|business development|operations|finance|accounting|legal|people|hr|communications|recruit)\b/i],
];

const REGIONS = [
  ['us',     /\b(united states|usa|u\.s\.|new york|nyc|san francisco|bay area|chicago|austin|boston|seattle|los angeles|palo alto|menlo park|mountain view|sunnyvale|san jose|washington|d\.c\.|miami|dallas|houston|atlanta|denver|philadelphia|charlotte|jersey city|stamford|greenwich|princeton|pittsburgh|nashville|phoenix|portland|san diego|minneapolis|detroit|salt lake|remote - us|,\s*(ny|ca|il|tx|ma|wa|fl|ct|nj|pa|ga|co|nc|va|md|mi|mn|az|or|ut|oh|dc)\b)/i],
  ['uk',     /\b(united kingdom|london|bristol|edinburgh|manchester|glasgow|leeds|belfast|oxford|cambridge, uk|birmingham)\b/i],
  ['europe', /\b(amsterdam|paris|berlin|munich|frankfurt|hamburg|dublin|zurich|zug|geneva|lausanne|madrid|barcelona|milan|rome|lisbon|porto|warsaw|krakow|prague|budapest|stockholm|copenhagen|aarhus|oslo|helsinki|brussels|luxembourg|vienna|athens|bucharest|netherlands|germany|france|spain|italy|ireland|switzerland|sweden|denmark|norway|poland|portugal|belgium|austria|europe|emea)\b/i],
  ['apac',   /\b(singapore|hong kong|tokyo|osaka|shanghai|beijing|shenzhen|seoul|taipei|sydney|melbourne|brisbane|perth|auckland|mumbai|bangalore|bengaluru|hyderabad|delhi|gurgaon|pune|chennai|gift city|india|japan|china|australia|apac)\b/i],
  ['canada', /\b(toronto|montreal|montréal|vancouver|waterloo|ottawa|calgary|canada)\b/i],
  ['latam',  /\b(são paulo|sao paulo|mexico city|buenos aires|bogot|santiago|lima|brazil|mexico)\b/i],
  ['mena',   /\b(dubai|abu dhabi|riyadh|doha|tel aviv|israel|uae|saudi)\b/i],
];

const SEASONS = /\b(summer|spring|fall|autumn|winter|été|ete)\b/i;

/* ------------------------------------------------------------- année/saison */

// « graduating in 2028 », « Class of 2027 » : c'est l'année de DIPLÔME, pas celle du stage.
const GRAD_YEAR_CONTEXT = /\b(graduat\w*|class of|degree|diplom\w*|conferred|matriculat\w*|expected completion)\b/i;
const SEASON_YEAR = /\b(summer|spring|fall|autumn|winter)\s*(?:of\s+)?(20\d{2})\b|\b(20\d{2})\s+(summer|spring|fall|autumn|winter)\b/i;

const normSeason = s => s.toLowerCase().replace('autumn', 'fall').replace(/été|ete/, 'summer');

function matchSeasonYear(text) {
  const m = text.match(SEASON_YEAR);
  if (!m) return null;
  return m[1] ? { year: +m[2], season: normSeason(m[1]) } : { year: +m[3], season: normSeason(m[4]) };
}

/** Retire les phrases qui parlent d'année de diplôme avant de chercher une année. */
function dropGraduationSentences(text) {
  return text.split(/(?<=[.;!?])\s+|\n+/).filter(s => !GRAD_YEAR_CONTEXT.test(s)).join(' ');
}

/**
 * Détermine l'année et la saison du programme.
 * Priorité : saison+année dans le titre > année seule dans le titre >
 *            saison+année dans la description (hors phrases « diplôme ») >
 *            année citée juste à côté du mot « internship/summer » > rien.
 */
export function inferCycle(title, description, kind) {
  const t = title || '';

  const st = matchSeasonYear(t);
  if (st) return { ...st, yearSource: 'title' };

  // « (2028 Graduate) » = promo, « (2027 Start) » = démarrage du programme.
  const titleClean = t.replace(/\b20\d{2}\s*(graduate|grad|promo|promotion)\b/gi, ' ');
  const bareTitle = titleClean.match(/\b(202[5-9]|203\d)\b/);
  if (bareTitle) return { year: +bareTitle[1], season: kind === 'internship' ? 'summer' : null, yearSource: 'title' };

  const body = dropGraduationSentences((description || '').slice(0, 8000));
  const sb = matchSeasonYear(body);
  if (sb) return { ...sb, yearSource: 'description' };

  // Années mentionnées dans une fenêtre autour de « internship / summer / start date ».
  const votes = new Map();
  for (const m of body.matchAll(/\b(internship|intern program|summer program|summer|start date|program begins|cohort|placement)\b/gi)) {
    const window = body.slice(Math.max(0, m.index - 90), m.index + 90);
    for (const y of window.matchAll(/\b(202[5-9]|203\d)\b/g)) {
      votes.set(+y[1], (votes.get(+y[1]) || 0) + 1);
    }
  }
  if (votes.size) {
    const [year] = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const season = body.match(SEASONS);
    return { year, season: season ? normSeason(season[0]) : null, yearSource: 'description' };
  }

  const season = t.match(SEASONS) || body.slice(0, 1200).match(SEASONS);
  return { year: null, season: season ? normSeason(season[0]) : null, yearSource: null };
}

export function classify(title, description, board) {
  const t = title || '';
  const head = (description || '').slice(0, 8000);

  const kind = INTERNSHIP.test(t) ? 'internship'
             : GRADUATE.test(t) ? 'graduate'
             : INTERNSHIP.test(head.slice(0, 1500)) ? 'internship'
             : 'early-career';

  const { year, season, yearSource } = inferCycle(t, head, kind);
  const track = (TRACKS.find(([, re]) => re.test(t)) || TRACKS.find(([, re]) => re.test(head.slice(0, 600))) || ['other'])[0];

  return {
    kind,
    year,
    yearSource,
    season: season || (kind === 'internship' ? 'summer' : null),
    track,
    industry: board.industry,
    tags: board.tags || [],
  };
}

export function regionsOf(location) {
  const found = REGIONS.filter(([, re]) => re.test(location)).map(([k]) => k);
  if (!found.length && /\bremote\b/i.test(location)) return ['remote'];
  return found.length ? found : ['other'];
}

export function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------------------------------------- adaptateurs ATS */

export const listUrl = (ats, token) => ({
  greenhouse: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
  lever: `https://api.lever.co/v0/postings/${token}?mode=json`,
  ashby: `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`,
}[ats]);

export const detailUrl = (ats, token, id) =>
  ats === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}` : null;

/**
 * Normalise la réponse d'un board en annonces early-career.
 * Greenhouse ne renvoie pas la description dans la liste : elle reste vide ici et
 * scripts/fetch.mjs l'enrichit ensuite (le navigateur, lui, s'en passe).
 */
export function parseJobs(ats, payload, board) {
  if (ats === 'greenhouse') {
    return (payload?.jobs || [])
      .filter(j => isCandidate(j.title || ''))
      .map(j => ({
        id: `gh-${board.token}-${j.id}`,
        externalId: j.id,
        title: (j.title || '').trim(),
        location: (j.location?.name || '').trim(),
        url: j.absolute_url,
        postedAt: j.updated_at || null,
        description: '',
        department: j.departments?.[0]?.name || '',
      }));
  }

  if (ats === 'lever') {
    return (Array.isArray(payload) ? payload : [])
      .filter(j => isCandidate(j.text || ''))
      .map(j => ({
        id: `lv-${board.token}-${j.id}`,
        externalId: j.id,
        title: (j.text || '').trim(),
        location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).join('; '),
        url: j.hostedUrl || j.applyUrl,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        description: stripHtml(j.descriptionPlain || j.description || ''),
        department: j.categories?.team || j.categories?.department || '',
      }));
  }

  if (ats === 'ashby') {
    // On se fie au titre seulement. Le champ `employmentType` d'Ashby est rempli par
    // l'employeur et se revele peu fiable : Shield AI, par exemple, etiquette « Intern »
    // 63 postes seniors. Sur l'ensemble des boards Ashby suivis, ce champ n'apportait
    // aucune offre early-career que le titre ne detectait pas deja.
    return (payload?.jobs || [])
      .filter(j => isCandidate(j.title || ''))
      .map(j => ({
        id: `ab-${board.token}-${j.id}`,
        externalId: j.id,
        title: (j.title || '').trim(),
        location: [j.location, ...(j.secondaryLocations || []).map(l => l.location || l)].filter(Boolean).join('; '),
        url: j.jobUrl || j.applyUrl,
        postedAt: j.publishedAt || null,
        description: stripHtml(j.descriptionHtml || j.descriptionPlain || ''),
        department: j.department || j.team || '',
      }));
  }

  return [];
}

/** Assemble l'objet offre final, tel qu'il est stocké dans data/offers.json. */
export function buildOffer(board, raw) {
  const meta = classify(raw.title, raw.description, board);
  const location = raw.location || 'Non précisé';

  const posted = raw.postedAt ? String(raw.postedAt).slice(0, 10) : null;
  const inWindow = posted && posted >= TARGET.windowStart && posted <= TARGET.windowEnd;
  const cycle = meta.year ?? (inWindow ? TARGET.year : null);

  return {
    id: raw.id,
    company: board.company,
    ats: board.ats,
    title: raw.title,
    location,
    regions: regionsOf(`${location} ${raw.title}`),
    url: raw.url,
    postedAt: raw.postedAt,
    department: raw.department,
    ...meta,
    cycle,
    cycleSource: meta.year ? meta.yearSource : (cycle ? 'posting-date' : null),
    excerpt: (raw.description || '').slice(0, 320),
    hasDeadlineHint: /\b(deadline|apply by|applications close|closes on|rolling basis)\b/i.test((raw.description || '').slice(0, 4000)),
  };
}
