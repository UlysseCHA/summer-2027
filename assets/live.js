/**
 * Rafraichissement live depuis le navigateur.
 *
 * Les API Greenhouse, Lever et Ashby renvoient toutes `Access-Control-Allow-Origin: *`,
 * donc la page peut les interroger directement, sans serveur intermediaire.
 *
 * Difference avec scripts/fetch.mjs : ici on ne charge QUE la liste de chaque board
 * (1 requete par entreprise au lieu de ~1300 au total). On se prive donc des
 * descriptions, ce qui rend la detection de l'annee moins fine pour les annonces qui
 * ne la mettent pas dans leur titre. C'est le prix d'un rafraichissement en ~15 s.
 * Le collecteur Node reste la source de verite, plus complete.
 */

import { parseJobs, buildOffer, listUrl, BROWSER_SAFE } from './classify.js';

const CONCURRENCY = 8;
const TIMEOUT = 15_000;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Interroge tous les boards et renvoie les offres trouvees.
 * `onProgress(fait, total, entreprise)` est appele apres chaque board.
 *
 * Renvoie aussi la liste des boards qui ont repondu : sans elle, impossible de
 * distinguer « cette offre a ete retiree » de « ce board n'a pas repondu », et on
 * supprimerait a tort des offres encore ouvertes.
 */
export async function refreshLive(allBoards, onProgress) {
  // Workday refuse les appels cross-origin : ses employeurs (Barclays, Citi, Deutsche
  // Bank...) ne sont joignables que par le collecteur Node. On ne les interroge donc
  // pas ici. Comme ils restent absents de `okCompanies`, mergeLive conserve leurs
  // offres au lieu de les croire fermees.
  const boards = allBoards.filter(b => BROWSER_SAFE.has(b.ats));

  const offers = [];
  const okCompanies = new Set();
  const failed = [];
  let done = 0;

  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, boards.length) }, async () => {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      try {
        const payload = await getJson(listUrl(board.ats, board.token));
        const raw = parseJobs(board.ats, payload, board);
        for (const r of raw) {
          if (r.url && r.title) offers.push(buildOffer(board, r));
        }
        okCompanies.add(board.company);
      } catch (err) {
        failed.push({ company: board.company, error: String(err.message || err) });
      }
      onProgress?.(++done, boards.length, board.company);
    }
  }));

  return { offers, okCompanies, failed, at: new Date().toISOString() };
}

/**
 * Fusionne l'instantane live avec la base generee par le collecteur Node.
 *
 * - une offre presente des deux cotes garde les donnees Node (plus riches : description,
 *   annee lue dans le corps de l'annonce) ;
 * - une offre vue seulement en live est ajoutee, marquee `shallow` ;
 * - une offre de la base absente du live est retiree SEULEMENT si son board a repondu,
 *   ce qui veut dire que l'annonce a ete fermee.
 */
export function mergeLive(baseOffers, live) {
  const liveByUrl = new Map(live.offers.map(o => [o.url, o]));
  const merged = [];
  let closed = 0;

  for (const base of baseOffers) {
    if (liveByUrl.has(base.url)) {
      merged.push(base);
      liveByUrl.delete(base.url);
    } else if (!live.okCompanies.has(base.company)) {
      merged.push(base); // board injoignable : on ne conclut rien
    } else {
      closed++;          // board joignable et annonce absente : elle est fermee
    }
  }

  const added = [...liveByUrl.values()].map(o => ({ ...o, shallow: true }));
  return { offers: [...merged, ...added], added, closed };
}
