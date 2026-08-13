#!/usr/bin/env node
/**
 * Vérifie que chaque URL de data/portals.json répond encore.
 * Les portails carrière bougent souvent : à relancer de temps en temps.
 *
 *   node scripts/check-links.mjs
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const { portals } = JSON.parse(await readFile(resolve(ROOT, 'data/portals.json'), 'utf8'));

async function check(url) {
  const opts = { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(25_000) };
  try {
    let res = await fetch(url, { ...opts, method: 'HEAD' });
    // Beaucoup de sites corporate refusent HEAD : on retente en GET.
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await fetch(url, { ...opts, method: 'GET' });
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    return { status: 0, error: String(err.message || err) };
  }
}

/**
 * Beaucoup de sites corporate (Citadel, Bloomberg, Uber…) sont derrière un WAF qui
 * renvoie 400/403 à tout client non-navigateur. Ce n'est pas un lien mort : on le
 * signale comme « non vérifiable » au lieu de le compter en échec.
 */
const verdict = (status) => {
  if (status >= 200 && status < 400) return 'ok';
  if (status === 404 || status === 410 || (status >= 500 && status < 600)) return 'cassé';
  return 'bloqué'; // 0 (réseau/TLS), 400, 401, 403, 429…
};

const results = [];
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < portals.length) {
    const p = portals[i++];
    const r = await check(p.url);
    const v = verdict(r.status);
    results.push({ ...p, ...r, verdict: v });
    const mark = v === 'ok' ? '✓' : v === 'bloqué' ? '~' : '✗';
    console.log(`  ${mark} ${String(r.status).padStart(3)}  ${p.company.padEnd(24)} ${p.url}`);
  }
}));

const broken = results.filter(r => r.verdict === 'cassé');
const blocked = results.filter(r => r.verdict === 'bloqué');
console.log(`\n${results.filter(r => r.verdict === 'ok').length}/${results.length} liens OK`
  + `, ${blocked.length} non vérifiables (anti-bot), ${broken.length} cassés`);

if (blocked.length) console.log(`\nNon vérifiables (à ouvrir à la main si besoin) : ${blocked.map(b => b.company).join(', ')}`);
if (broken.length) {
  console.log('\nÀ corriger dans data/portals.json :');
  for (const b of broken) console.log(`  ${b.company}  (${b.status})  ${b.url}`);
  process.exitCode = 1;
}
