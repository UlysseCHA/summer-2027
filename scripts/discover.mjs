#!/usr/bin/env node
/**
 * Cherche le token de job board d'une liste d'entreprises, en testant des variantes
 * de slug sur Greenhouse, Lever et Ashby. Sert a etendre data/sources.json.
 *
 *   node scripts/discover.mjs                 # teste la liste integree
 *   node scripts/discover.mjs "Deel" "Rippling"
 *
 * Ecrit le resultat dans data/discovered.json ; les tokens confirmes sont a recopier
 * dans data/sources.json (avec le secteur), puis `npm run fetch`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCandidate, parseJobs } from '../assets/classify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'summer-internships-board/1.0 (aggregator; public job board APIs)';
const CONCURRENCY = 14;

/* Entreprises a tester, par secteur. Les tokens sont devines a partir du nom. */
const CANDIDATES = {
  finance: [
    // Market makers crypto et prop shops : categorie ou l'app etait la plus incomplete.
    'Wincent', 'Wintermute', 'GSR', 'B2C2', 'Cumberland', 'Amber Group', 'Auros', 'Keyrock',
    'Flowdesk', 'Kaiko', 'Talos', 'FalconX', 'Hidden Road', 'Blockchain com', 'Bitstamp',
    'Bitpanda', 'Deribit', 'Bybit', 'OKX', 'Crypto com', 'Copper', 'Zodia', 'Archax',
    'Maven Securities', 'Eclipse Trading', 'Grasshopper', 'Da Vinci Derivatives', 'Mako',
    'Liquid Capital', 'Vivienne Court', 'Tibra', 'Cutler Group', 'Blackedge', 'Aquatic Capital',
    'Millburn', 'XR Trading', 'Simplex Trading', 'Consolidated Trading', 'Allston Trading',
    'Teza Technologies', 'Hehmeyer', 'Volant Trading', 'Spot Trading', '3Red Partners',
    'Valkyrie Trading', 'Transmarket Group', 'Marquette Partners', 'Nico Trading',
    // Hedge funds
    'Aspect Capital', 'Cantab Capital', 'Florin Court', 'Quadrature Capital', 'Brevan Howard',
    'Rokos Capital', 'Caxton Associates', 'Element Capital', 'Tudor Investment', 'Moore Capital',
    'Hudson Bay Capital', 'Eisler Capital', 'Astaris Capital', 'Kintbury Capital', 'Man AHL',
    // Banques et boutiques britanniques
    'Numis', 'Peel Hunt', 'Investec', 'Panmure Liberum', 'Canaccord Genuity', 'Robey Warshaw',
    'Gleacher Shacklock', 'DC Advisory', 'Alantra', 'Rothschild and Co',
    // Gestion d'actifs
    'Baillie Gifford', 'Schroders', 'abrdn', 'Legal and General', 'M and G', 'Janus Henderson',
    'Fidelity International', 'Capital Group', 'T Rowe Price', 'Ninety One', 'Jupiter Asset',
    'Polar Capital', 'Lindsell Train', 'Ruffer', 'Insight Investment', 'Redburn',
    'Susquehanna', 'SIG Susquehanna', 'Hudson River Trading', 'HRT', 'Two Sigma', 'Citadel',
    'Citadel Securities', 'DE Shaw', 'Millennium', 'Point72', 'Balyasny', 'Verition', 'Walleye',
    'ExodusPoint', 'Brevan Howard', 'Marshall Wace', 'Winton', 'Qube Research', 'XTX Markets',
    'GSA Capital', 'Quadrature', 'Aspect Capital', 'Systematica', 'Capula', 'Rokos',
    'Wolverine Trading', 'Peak6', 'Belvedere Trading', 'Group One Trading', 'CTC Trading',
    'Chicago Trading Company', 'Transmarket', 'Geneva Trading', 'Volant Trading', 'Radix Trading',
    'Headlands Technologies', 'Vatic Labs', 'Quantlab', 'Engineers Gate', 'Voleon', 'Cubist',
    'Arrowstreet Capital', 'Acadian Asset', 'Dimensional Fund Advisors', 'Bridgewater',
    'AllianceBernstein', 'Wellington Management', 'PIMCO', 'Invesco', 'Fidelity', 'Vanguard',
    'State Street', 'Northern Trust', 'Nuveen', 'Neuberger Berman', 'Lord Abbett',
    'Jefferies', 'Guggenheim', 'Baird', 'Raymond James', 'Stifel', 'Piper Sandler', 'Lincoln International',
    'Harris Williams', 'Perella Weinberg', 'Greenhill', 'Solomon Partners', 'Ducera',
    'Nomura', 'Macquarie', 'Mizuho', 'MUFG', 'SMBC', 'Standard Chartered', 'ING', 'Rabobank',
    'Santander', 'BBVA', 'UniCredit', 'Intesa', 'Danske Bank', 'SEB', 'Nordea',
    'Robinhood', 'Betterment', 'Wealthfront', 'Public', 'eToro', 'Interactive Brokers',
    'Kraken', 'Gemini', 'Circle', 'Ripple', 'Fireblocks', 'Chainalysis', 'Paxos', 'Galaxy Digital',
    'Plaid', 'Modern Treasury', 'Mercury', 'Column', 'Unit', 'Lithic', 'Increase',
    'Klarna', 'Checkout', 'Mollie', 'Trade Republic', 'Scalable Capital', 'Raisin', 'Solaris',
    'Nubank', 'Nu Holdings', 'PayPal', 'Visa', 'Mastercard', 'Fiserv', 'FIS', 'Global Payments',
  ],
  consulting: [
    'Oliver Wyman', 'Kearney', 'LEK Consulting', 'Analysis Group', 'Cornerstone Research',
    'NERA', 'Brattle Group', 'Compass Lexecon', 'Keystone Strategy', 'Bates White',
    'Charles River Associates', 'Putnam Associates', 'Trinity Life Sciences', 'ClearView Healthcare',
    'Health Advances', 'Back Bay Life Science', 'Blue Matter', 'Prescient Healthcare',
    'ZS Associates', 'Simon Kucher', 'Roland Berger', 'Arthur D Little', 'Strategy and',
    'Alvarez and Marsal', 'AlixPartners', 'FTI Consulting', 'Berkeley Research Group',
    'Huron Consulting', 'Navigant', 'Guidehouse', 'Slalom', 'West Monroe', 'Point B',
    'Thoughtworks', 'Publicis Sapient', 'Capgemini', 'Infosys Consulting', 'Wavestone',
    'Sia Partners', 'Eleven Strategy', 'Circle Strategy', 'Advancy', 'Estin and Co',
    'Third Bridge', 'GLG', 'AlphaSights', 'Guidepoint', 'Coleman Research', 'Dialectica',
    'Bain', 'BCG', 'McKinsey', 'Accenture', 'Deloitte', 'PwC', 'EY', 'KPMG', 'Grant Thornton',
  ],
  tech: [
    'Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Netflix', 'Nvidia', 'Tesla', 'SpaceX',
    'Uber', 'Lyft', 'Airbnb', 'DoorDash', 'Instacart', 'Snap', 'Spotify', 'Shopify', 'Atlassian',
    'Salesforce', 'Workday', 'ServiceNow', 'Snowflake', 'MongoDB', 'Elastic', 'Confluent',
    'HashiCorp', 'Grafana Labs', 'Sentry', 'PagerDuty', 'Twilio', 'Okta', 'Auth0', 'Cloudflare',
    'Fastly', 'DigitalOcean', 'Linode', 'Render', 'Railway', 'Netlify', 'Vercel', 'Retool',
    'Notion', 'Figma', 'Canva', 'Miro', 'Airtable', 'Asana', 'Monday', 'ClickUp', 'Linear',
    'Slack', 'Zoom', 'Dropbox', 'Box', 'Docusign', 'Intercom', 'Zendesk', 'Freshworks',
    'Datadog', 'New Relic', 'Dynatrace', 'Splunk', 'Sumo Logic', 'Chronosphere', 'Honeycomb',
    'Databricks', 'Palantir', 'Scale AI', 'Anthropic', 'OpenAI', 'Cohere', 'Mistral',
    'Hugging Face', 'Perplexity', 'Anysphere', 'Cursor', 'Sierra', 'Harvey', 'Abridge',
    'Glean', 'Writer', 'Runway', 'Luma AI', 'Pika', 'Suno', 'ElevenLabs', 'Synthesia',
    'Together AI', 'Fireworks AI', 'Baseten', 'Modal Labs', 'Replicate', 'Lambda Labs',
    'Weights and Biases', 'LangChain', 'LlamaIndex', 'Pinecone', 'Weaviate', 'Chroma',
    'Duolingo', 'Coursera', 'Udemy', 'Khan Academy', 'Chegg', 'Quizlet', 'Roblox', 'Unity',
    'Epic Games', 'Riot Games', 'Discord', 'Twitch', 'Reddit', 'Pinterest', 'Quora',
    'Stripe', 'Square', 'Block', 'Adyen', 'Affirm', 'Marqeta', 'Brex', 'Ramp', 'Navan',
    'Rippling', 'Deel', 'Gusto', 'Justworks', 'Remote', 'Oyster', 'Vanta', 'Drata', 'Secureframe',
    'Wiz', 'Snyk', 'Tailscale', 'Crowdstrike', 'SentinelOne', 'Palo Alto Networks', 'Zscaler',
    'Samsara', 'Verkada', 'Motive', 'Flexport', 'Convoy', 'project44', 'Anduril', 'Shield AI',
    'Applied Intuition', 'Waymo', 'Zoox', 'Cruise', 'Nuro', 'Aurora', 'Rivian', 'Lucid',
    'Doctolib', 'Alan', 'Qonto', 'Swile', 'Payfit', 'Contentsquare', 'Dataiku', 'Algolia',
    'Criteo', 'BlaBlaCar', 'Back Market', 'ManoMano', 'Ledger', 'Sorare', 'Ankorstore',
    'Revolut', 'Monzo', 'Starling Bank', 'Wise', 'GoCardless', 'Zopa', 'Marshmallow',
    'Personio', 'Celonis', 'N26', 'GetYourGuide', 'Zalando', 'Delivery Hero', 'HelloFresh',
    'Spendesk', 'Pennylane', 'Younited', 'Lydia', 'Shine', 'Agicap', 'Mirakl', 'Veepee',
  ],
};

/* Variantes de slug testees pour chaque nom. */
function slugVariants(name) {
  const base = name.toLowerCase().replace(/[.'’]/g, '').trim();
  const words = base.split(/\s+/);
  const joined = words.join('');
  const hyphen = words.join('-');
  const first = words[0];

  return [...new Set([
    joined, hyphen, first,
    joined + 'inc', joined + 'llc', joined + 'careers', joined + 'jobs',
    hyphen + '-inc', first + 'hq', joined + 'hq',
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
    const res = await fetch(urls[ats], {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const jobs = ats === 'lever' ? payload : payload?.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return null;

    const early = parseJobs(ats, payload, { token, ats, company: token, industry: 'tech', tags: [] });
    return { ats, token, total: jobs.length, early: early.length };
  } catch {
    return null;
  }
}

async function pool(items, worker, concurrency = CONCURRENCY) {
  let i = 0;
  const out = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const r = await worker(items[i++]);
      if (r) out.push(r);
    }
  }));
  return out;
}

/* ------------------------------------------------------------------- main */

const cliNames = process.argv.slice(2);
const entries = cliNames.length
  ? cliNames.map(n => ({ name: n, industry: 'tech' }))
  : Object.entries(CANDIDATES).flatMap(([industry, names]) => names.map(name => ({ name, industry })));

// On ne re-teste pas ce qui est deja suivi.
const { boards } = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));
const known = new Set(boards.map(b => `${b.ats}:${b.token}`));
const knownNames = new Set(boards.map(b => b.company.toLowerCase()));

const tasks = [];
for (const { name, industry } of entries) {
  for (const token of slugVariants(name)) {
    for (const ats of ['greenhouse', 'lever', 'ashby']) {
      if (known.has(`${ats}:${token}`)) continue;
      tasks.push({ name, industry, token, ats });
    }
  }
}

console.log(`Test de ${tasks.length} combinaisons (${entries.length} entreprises)...\n`);

let done = 0;
const hits = await pool(tasks, async (task) => {
  const r = await probe(task.ats, task.token);
  if (++done % 250 === 0) console.log(`  ${done}/${tasks.length}`);
  if (!r) return null;
  console.log(`  + ${task.name.padEnd(26)} ${r.ats.padEnd(11)} ${r.token.padEnd(24)} ${String(r.total).padStart(4)} postes, ${r.early} early-career`);
  return { company: task.name, industry: task.industry, ...r };
});

// Une entreprise peut matcher plusieurs variantes : on garde la plus fournie.
const best = new Map();
for (const h of hits) {
  const prev = best.get(h.company);
  if (!prev || h.early > prev.early || (h.early === prev.early && h.total > prev.total)) best.set(h.company, h);
}

const results = [...best.values()]
  .filter(h => !knownNames.has(h.company.toLowerCase()))
  .sort((a, b) => b.early - a.early || b.total - a.total);

await writeFile(resolve(ROOT, 'data/discovered.json'), JSON.stringify({
  discoveredAt: new Date().toISOString(),
  found: results.length,
  boards: results.map(r => ({
    company: r.company, ats: r.ats, token: r.token,
    industry: r.industry, tags: [], _total: r.total, _early: r.early,
  })),
}, null, 1), 'utf8');

console.log(`\n${results.length} nouveaux boards trouves, ecrits dans data/discovered.json`);
console.log(`dont ${results.filter(r => r.early > 0).length} avec des offres early-career ouvertes maintenant.`);
