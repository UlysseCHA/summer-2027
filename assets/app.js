/* Summer 2027 : index d'offres de stage tech / finance / conseil.
   Les donnees de base viennent de data/offers.json (genere par scripts/fetch.mjs),
   puis assets/live.js les rafraichit en direct depuis le navigateur. */

import { refreshLive, mergeLive } from './live.js';
import { login, logout, currentUser, knownUsers, scopeKey } from './auth.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* --------------------------------------------------------------- libelles */

const LABELS = {
  industry: { tech: 'Tech', finance: 'Finance', consulting: 'Conseil' },
  kind: { internship: 'Stage', graduate: 'Graduate / new grad', 'early-career': 'Junior' },
  track: {
    quant: 'Quant / trading', engineering: 'Ingenierie', 'ai-ml': 'IA / ML', data: 'Data',
    banking: 'Banque / marches', consulting: 'Conseil', product: 'Produit',
    design: 'Design', business: 'Business', other: 'Autre',
  },
  region: {
    us: 'Etats-Unis', uk: 'Royaume-Uni', europe: 'Europe', apac: 'Asie-Pacifique',
    canada: 'Canada', latam: 'Amerique latine', mena: 'Moyen-Orient', remote: 'Remote', other: 'Autre',
  },
  status: {
    todo: 'A postuler', applied: 'Postule', interview: 'Entretien',
    offer: 'Offre recue', rejected: 'Refuse',
  },
};

const label = (kind, key) => LABELS[kind]?.[key] || key;
const PAGE_SIZE = 40;
const REFRESH_COOLDOWN_MS = 20 * 60 * 1000;

/* ------------------------------------------------------------- stockage */

let USER = null; // defini apres connexion

const store = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* quota ou navigation privee : on continue sans persister */ }
  },
};

let favorites = new Set();
let statuses = {};
let seenIds = new Set();     // offres deja vues par ce compte
let newIds = new Set();      // nouveautes pas encore acquittees

const saveFavorites = () => store.write(scopeKey(USER.id, 'favorites'), [...favorites]);
const saveStatuses = () => store.write(scopeKey(USER.id, 'statuses'), statuses);
const saveSeen = () => {
  store.write(scopeKey(USER.id, 'seen'), [...seenIds]);
  store.write(scopeKey(USER.id, 'new'), [...newIds]);
};

function loadUserData() {
  favorites = new Set(store.read(scopeKey(USER.id, 'favorites'), []));
  statuses = store.read(scopeKey(USER.id, 'statuses'), {});
  seenIds = new Set(store.read(scopeKey(USER.id, 'seen'), []));
  newIds = new Set(store.read(scopeKey(USER.id, 'new'), []));
}

/* ----------------------------------------------------------------- etat */

const state = {
  view: 'offers',
  q: '',
  cycle: '2027',
  industry: new Set(),
  kind: new Set(),
  track: new Set(),
  region: new Set(),
  company: new Set(),
  onlyFav: false,
  onlyRecent: false,
  onlyNew: false,
  hideApplied: false,
  sort: 'recent',
  limit: PAGE_SIZE,
  portalIndustry: new Set(),
};

let DATA = { offers: [], sources: [], counts: {}, generatedAt: null, target: { year: 2027 } };
let PORTALS = { portals: [], _timing: {} };
let BOARDS = [];
let OFFERS = [];        // base + live fusionnes
let liveStatus = null;  // { at, added, closed, failed }

/* ------------------------------------------------------------- utilitaires */

const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY = 86_400_000;

function daysSince(iso) {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / DAY;
  return Number.isFinite(d) ? Math.floor(d) : null;
}

function relativeDate(iso) {
  const d = daysSince(iso);
  if (d === null) return '';
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return 'hier';
  if (d < 30) return `il y a ${d} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an${d >= 730 ? 's' : ''}`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function download(filename, content, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------- filtrage */

function matchesCycle(offer) {
  switch (state.cycle) {
    case 'all': return true;
    case 'unknown': return !offer.cycle;
    default: return String(offer.cycle) === state.cycle;
  }
}

function searchBlob(offer) {
  return offer._blob ??= [
    offer.company, offer.title, offer.location, offer.department,
    label('track', offer.track), ...(offer.tags || []),
  ].join(' ').toLowerCase();
}

function filterOffers() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);

  return OFFERS.filter(o => {
    if (!matchesCycle(o)) return false;
    if (state.industry.size && !state.industry.has(o.industry)) return false;
    if (state.kind.size && !state.kind.has(o.kind)) return false;
    if (state.track.size && !state.track.has(o.track)) return false;
    if (state.company.size && !state.company.has(o.company)) return false;
    if (state.region.size && !(o.regions || []).some(r => state.region.has(r))) return false;
    if (state.onlyFav && !favorites.has(o.id)) return false;
    if (state.onlyNew && !newIds.has(o.id)) return false;
    if (state.onlyRecent && !(daysSince(o.postedAt) !== null && daysSince(o.postedAt) <= 30)) return false;
    if (state.hideApplied && ['applied', 'interview', 'offer', 'rejected'].includes(statuses[o.id])) return false;
    if (terms.length) {
      const blob = searchBlob(o);
      if (!terms.every(t => blob.includes(t))) return false;
    }
    return true;
  });
}

const SORTERS = {
  recent: (a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')),
  company: (a, b) => a.company.localeCompare(b.company, 'fr') || a.title.localeCompare(b.title, 'fr'),
  title: (a, b) => a.title.localeCompare(b.title, 'fr'),
  location: (a, b) => a.location.localeCompare(b.location, 'fr'),
};

/* Compte les valeurs d'une facette en ignorant le filtre de cette meme facette,
   pour que les compteurs affiches restent utilisables une fois un choix fait. */
function facetCounts(key, valueOf) {
  const saved = state[key];
  state[key] = new Set();
  const counts = new Map();
  for (const offer of filterOffers()) {
    for (const v of valueOf(offer)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  state[key] = saved;
  return counts;
}

/* ---------------------------------------------------------------- rendu */

function renderChips(container, key, values, counts) {
  container.innerHTML = values.map(v => {
    const n = counts.get(v) || 0;
    const on = state[key].has(v);
    return `<button class="chip" role="switch" aria-pressed="${on}" data-facet="${key}" data-value="${escapeHtml(v)}"
      ${n === 0 && !on ? 'disabled style="opacity:.4;cursor:default"' : ''}>
      ${escapeHtml(label(key === 'portalIndustry' ? 'industry' : key, v))}<span class="n">${n}</span>
    </button>`;
  }).join('');
}

function renderFacets() {
  const byKey = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const industry = facetCounts('industry', o => [o.industry]);
  const kind = facetCounts('kind', o => [o.kind]);
  const track = facetCounts('track', o => [o.track]);
  const region = facetCounts('region', o => o.regions || []);
  const company = facetCounts('company', o => [o.company]);

  renderChips($('#f-industry'), 'industry', ['tech', 'finance', 'consulting'], industry);
  renderChips($('#f-kind'), 'kind', ['internship', 'graduate', 'early-career'], kind);
  renderChips($('#f-track'), 'track', byKey(track), track);
  renderChips($('#f-region'), 'region', byKey(region), region);

  const needle = $('#company-search').value.trim().toLowerCase();
  const companies = [...company.entries()]
    .filter(([name]) => !needle || name.toLowerCase().includes(needle))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));

  $('#f-company').innerHTML = companies.map(([name, n]) => `
    <label class="check">
      <input type="checkbox" data-facet="company" value="${escapeHtml(name)}" ${state.company.has(name) ? 'checked' : ''}>
      ${escapeHtml(name)} <span class="n" style="color:var(--text-3);font-size:11px">${n}</span>
    </label>`).join('') || '<p class="col-empty">Aucune entreprise.</p>';
}

function renderActiveFilters() {
  const pills = [];
  const add = (facet, value, text) =>
    pills.push(`<span class="pill">${escapeHtml(text)}<button data-clear-facet="${facet}" data-value="${escapeHtml(value)}" aria-label="Retirer">x</button></span>`);

  for (const facet of ['industry', 'kind', 'track', 'region', 'company']) {
    for (const v of state[facet]) add(facet, v, label(facet, v));
  }
  if (state.q) add('q', '', `« ${state.q} »`);
  if (state.onlyFav) add('onlyFav', '', 'Favoris');
  if (state.onlyNew) add('onlyNew', '', 'Nouveautes');
  if (state.onlyRecent) add('onlyRecent', '', 'Moins de 30 jours');
  if (state.hideApplied) add('hideApplied', '', 'Sans candidatures envoyees');

  $('#active-filters').innerHTML = pills.join('');
}

function offerHtml(offer) {
  const status = statuses[offer.id];
  const fav = favorites.has(offer.id);
  const age = daysSince(offer.postedAt);
  const applied = ['applied', 'interview', 'offer', 'rejected'].includes(status);

  const badges = [
    newIds.has(offer.id) ? '<span class="badge badge-new">Nouveau</span>' : '',
    `<span class="badge badge-${offer.industry}">${label('industry', offer.industry)}</span>`,
    offer.kind !== 'internship' ? `<span class="badge">${label('kind', offer.kind)}</span>` : '',
    age !== null && age <= 7 ? '<span class="badge badge-accent">Publiee cette semaine</span>' : '',
    offer.cycleSource === 'posting-date' ? '<span class="badge badge-soft" title="L\'annonce ne precise pas l\'annee ; elle est rattachee a la campagne d\'apres sa date de publication">annee deduite</span>' : '',
    offer.hasDeadlineHint ? '<span class="badge badge-soft" title="La description mentionne une date limite ou un recrutement au fil de l\'eau">deadline mentionnee</span>' : '',
  ].filter(Boolean).join('');

  const statusOptions = ['', 'todo', 'applied', 'interview', 'offer', 'rejected']
    .map(s => `<option value="${s}" ${status === s || (!status && !s) ? 'selected' : ''}>${s ? label('status', s) : 'suivi'}</option>`)
    .join('');

  return `
    <li class="offer${applied ? ' is-applied' : ''}${newIds.has(offer.id) ? ' is-new' : ''}" data-id="${escapeHtml(offer.id)}">
      <div class="offer-main">
        <div class="offer-company"><b>${escapeHtml(offer.company)}</b>${badges}</div>
        <h3 class="offer-title">
          <a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(offer.title)}</a>
        </h3>
        <div class="offer-meta">
          <span class="offer-loc" title="${escapeHtml(offer.location)}">${escapeHtml(offer.location)}</span>
          <span>${escapeHtml(label('track', offer.track))}</span>
          ${offer.postedAt ? `<span title="${escapeHtml(String(offer.postedAt).slice(0, 10))}">Publiee ${relativeDate(offer.postedAt)}</span>` : ''}
          ${offer.cycle ? `<span>${offer.season === 'summer' ? 'Summer' : ''} ${offer.cycle}</span>` : ''}
        </div>
      </div>
      <div class="offer-side">
        <div class="offer-actions">
          <button class="star" role="switch" aria-pressed="${fav}" data-fav="${escapeHtml(offer.id)}" title="Mettre en favori">${fav ? '★' : '☆'}</button>
          <a class="apply" href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">Postuler</a>
        </div>
        <select class="status-select" data-status="${escapeHtml(offer.id)}" title="Suivi de candidature">${statusOptions}</select>
      </div>
    </li>`;
}

function renderOffers() {
  const filtered = filterOffers().sort(SORTERS[state.sort]);
  const shown = filtered.slice(0, state.limit);

  $('#offer-list').innerHTML = shown.map(offerHtml).join('');
  $('#empty').hidden = filtered.length > 0;
  $('#load-more').hidden = filtered.length <= state.limit;
  $('#load-more').textContent = `Afficher plus (${filtered.length - shown.length} restantes)`;

  $('#results-count').innerHTML = `<strong>${filtered.length}</strong> offre${filtered.length > 1 ? 's' : ''}`
    + (filtered.length !== OFFERS.length ? ` sur ${OFFERS.length}` : '');
  $('#count-offers').textContent = filtered.length;

  renderFacets();
  renderActiveFilters();
  renderNewBanner();
  syncUrl();
}

function renderNewBanner() {
  const banner = $('#new-banner');
  const n = newIds.size;
  banner.hidden = n === 0;
  if (n === 0) return;
  banner.innerHTML = `
    <span><strong>${n}</strong> nouvelle${n > 1 ? 's' : ''} offre${n > 1 ? 's' : ''} depuis ta derniere visite</span>
    <span class="banner-actions">
      <button class="btn btn-sm" id="show-new">Les voir</button>
      <button class="btn btn-ghost btn-sm" id="mark-seen">Tout marquer comme vu</button>
    </span>`;
}

const PORTAL_GROUPS = [
  ['banking', "Banques d'affaires, private equity et asset management"],
  ['quant', 'Trading, hedge funds et prop shops'],
  ['consulting', 'Conseil'],
  ['tech', 'Tech'],
];

function renderPortals() {
  const list = PORTALS.portals.filter(p => !state.portalIndustry.size || state.portalIndustry.has(p.industry));

  const counts = new Map();
  for (const p of PORTALS.portals) counts.set(p.industry, (counts.get(p.industry) || 0) + 1);
  renderChips($('#f-portal-industry'), 'portalIndustry', ['tech', 'finance', 'consulting'], counts);

  const card = p => `
    <a class="portal" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
      <span class="portal-name">${escapeHtml(p.company)}</span>
      <span class="portal-tags">
        <span class="badge badge-${p.industry}">${label('industry', p.industry)}</span>
        ${(p.tags || []).filter(t => t !== 'france').slice(0, 2).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
      </span>
    </a>`;

  // La note de calendrier est propre au groupe : on l'affiche une fois, pas sur chaque carte.
  $('#portal-grid').innerHTML = PORTAL_GROUPS.map(([key, title]) => {
    const items = list.filter(p => p.timing === key);
    if (!items.length) return '';
    return `
      <section class="portal-group">
        <header class="portal-group-head">
          <h3>${escapeHtml(title)} <span class="tab-count">${items.length}</span></h3>
          <p>${escapeHtml(PORTALS._timing?.[key] || '')}</p>
        </header>
        <div class="portal-cards">${items.map(card).join('')}</div>
      </section>`;
  }).join('');

  $('#count-portals').textContent = PORTALS.portals.length;
}

function renderTracker() {
  const byId = new Map(OFFERS.map(o => [o.id, o]));
  const tracked = Object.entries(statuses).filter(([, s]) => s);
  $('#count-tracker').textContent = tracked.length;

  const columns = ['todo', 'applied', 'interview', 'offer', 'rejected'];
  $('#tracker-board').innerHTML = columns.map(col => {
    const items = tracked.filter(([, s]) => s === col).map(([id]) => byId.get(id)).filter(Boolean);
    return `
      <div class="col">
        <h3>${label('status', col)} &middot; ${items.length}</h3>
        <div class="col-items">
          ${items.map(o => `
            <a class="mini" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">
              <b>${escapeHtml(o.company)}</b>
              <span>${escapeHtml(o.title)}</span>
            </a>`).join('') || '<p class="col-empty">Rien ici.</p>'}
        </div>
      </div>`;
  }).join('');
}

function renderAbout() {
  const rows = DATA.sources
    .filter(s => s.found > 0)
    .map(s => {
      const industry = OFFERS.find(o => o.company === s.company)?.industry || '';
      return `<tr>
        <td>${escapeHtml(s.company)}</td>
        <td>${escapeHtml(industry ? label('industry', industry) : '')}</td>
        <td>${escapeHtml(s.ats)}</td>
        <td class="num">${s.found}</td>
      </tr>`;
    }).join('');
  $('#src-table-body').innerHTML = rows;
  $('#board-total').textContent = BOARDS.length;
}

/* ------------------------------------------------------------------ URL */

function syncUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.cycle !== '2027') params.set('cycle', state.cycle);
  for (const facet of ['industry', 'kind', 'track', 'region', 'company']) {
    if (state[facet].size) params.set(facet, [...state[facet]].join('|'));
  }
  if (state.sort !== 'recent') params.set('sort', state.sort);
  if (state.onlyFav) params.set('fav', '1');
  if (state.onlyNew) params.set('new', '1');
  if (state.view !== 'offers') params.set('view', state.view);

  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
}

function readUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.q = params.get('q') || '';
  state.cycle = params.get('cycle') || '2027';
  for (const facet of ['industry', 'kind', 'track', 'region', 'company']) {
    const raw = params.get(facet);
    state[facet] = new Set(raw ? raw.split('|') : []);
  }
  state.sort = params.get('sort') || 'recent';
  state.onlyFav = params.get('fav') === '1';
  state.onlyNew = params.get('new') === '1';
  state.view = params.get('view') || 'offers';

  $('#q').value = state.q;
  $('#cycle').value = state.cycle;
  $('#sort').value = state.sort;
  $('#only-fav').checked = state.onlyFav;
  $('#only-new').checked = state.onlyNew;
}

function showView(view) {
  state.view = view;
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${view}`));
  if (view === 'tracker') renderTracker();
  if (view === 'portals') renderPortals();
  syncUrl();
}

/* ------------------------------------------------------- rafraichissement */

function setLiveStatus(text, busy = false) {
  $('#live-status').textContent = text;
  $('#refresh').disabled = busy;
  $('#refresh').classList.toggle('is-busy', busy);
}

async function runRefresh({ manual = false } = {}) {
  const last = store.read('s27:lastRefresh', null);
  if (!manual && last && Date.now() - new Date(last).getTime() < REFRESH_COOLDOWN_MS) {
    setLiveStatus(`verifie ${relativeDate(last)}`);
    return;
  }

  setLiveStatus(`verification 0/${BOARDS.length}`, true);

  let live, merged;
  try {
    live = await refreshLive(BOARDS, (done, total) => {
      setLiveStatus(`verification ${done}/${total}`, true);
    });
    merged = mergeLive(DATA.offers, live);
  } catch (err) {
    setLiveStatus('verification impossible');
    if (manual) toast(`Echec du rafraichissement : ${err.message}`);
    return;
  }

  const { offers, added, closed } = merged;
  OFFERS = offers;
  liveStatus = { at: live.at, added: added.length, closed, failed: live.failed.length };
  store.write('s27:lastRefresh', live.at);

  // Premiere visite du compte : on prend l'etat actuel comme reference, sans tout marquer
  // comme nouveau (sinon les 350 offres existantes clignoteraient).
  const known = store.read(scopeKey(USER.id, 'seen'), null);
  if (known === null) {
    seenIds = new Set(OFFERS.map(o => o.id));
    newIds = new Set();
  } else {
    for (const o of added) if (!seenIds.has(o.id)) newIds.add(o.id);
    // On oublie les nouveautes dont l'annonce a ete fermee entre-temps.
    const open = new Set(OFFERS.map(o => o.id));
    newIds = new Set([...newIds].filter(id => open.has(id)));
  }
  saveSeen();

  const bits = [`${OFFERS.length} offres`, `verifie ${relativeDate(live.at)}`];
  if (live.failed.length) bits.push(`${live.failed.length} board(s) injoignable(s)`);
  setLiveStatus(bits.join(' · '));

  renderOffers();
  renderTracker();

  if (manual) {
    const parts = [];
    parts.push(added.length ? `${added.length} offre(s) ajoutee(s)` : 'aucune nouvelle offre');
    if (closed) parts.push(`${closed} fermee(s)`);
    toast(parts.join(', '));
  }
}

/* -------------------------------------------------------------- export */

function exportCsv() {
  const rows = filterOffers().sort(SORTERS[state.sort]);
  const header = ['Entreprise', 'Intitule', 'Secteur', 'Type', 'Metier', 'Localisation', 'Campagne', 'Publiee le', 'Suivi', 'Lien'];
  const cell = (v = '') => `"${String(v).replace(/"/g, '""')}"`;

  const csv = [
    header.map(cell).join(','),
    ...rows.map(o => [
      o.company, o.title, label('industry', o.industry), label('kind', o.kind), label('track', o.track),
      o.location, o.cycle || 'non precisee', (o.postedAt || '').slice(0, 10),
      statuses[o.id] ? label('status', statuses[o.id]) : '', o.url,
    ].map(cell).join(',')),
  ].join('\r\n');

  // BOM : sans lui, Excel casse les accents.
  download(`summer-2027-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  toast(`${rows.length} offres exportees`);
}

/* ------------------------------------------------------------ evenements */

function bindEvents() {
  $$('.tab').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.view)));

  let debounce;
  $('#q').addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = e.target.value.trim(); state.limit = PAGE_SIZE; renderOffers(); }, 160);
  });

  $('#company-search').addEventListener('input', renderFacets);
  $('#cycle').addEventListener('change', e => { state.cycle = e.target.value; state.limit = PAGE_SIZE; renderOffers(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderOffers(); });

  const toggles = [['#only-fav', 'onlyFav'], ['#only-new', 'onlyNew'], ['#only-recent', 'onlyRecent'], ['#hide-applied', 'hideApplied']];
  for (const [id, key] of toggles) {
    $(id).addEventListener('change', e => { state[key] = e.target.checked; state.limit = PAGE_SIZE; renderOffers(); });
  }

  // Chips de facette (delegation : ils sont re-rendus a chaque passe).
  document.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-facet]');
    if (!chip) return;
    const { facet, value } = chip.dataset;
    state[facet].has(value) ? state[facet].delete(value) : state[facet].add(value);
    state.limit = PAGE_SIZE;
    facet === 'portalIndustry' ? renderPortals() : renderOffers();
  });

  $('#f-company').addEventListener('change', e => {
    const box = e.target.closest('input[data-facet="company"]');
    if (!box) return;
    box.checked ? state.company.add(box.value) : state.company.delete(box.value);
    state.limit = PAGE_SIZE;
    renderOffers();
  });

  $('#active-filters').addEventListener('click', e => {
    const btn = e.target.closest('[data-clear-facet]');
    if (!btn) return;
    const facet = btn.dataset.clearFacet;
    if (state[facet] instanceof Set) {
      state[facet].delete(btn.dataset.value);
    } else if (facet === 'q') {
      state.q = ''; $('#q').value = '';
    } else {
      state[facet] = false;
      const box = { onlyFav: '#only-fav', onlyNew: '#only-new', onlyRecent: '#only-recent', hideApplied: '#hide-applied' }[facet];
      if (box) $(box).checked = false;
    }
    renderOffers();
  });

  $('#reset-filters').addEventListener('click', () => {
    Object.assign(state, {
      q: '', cycle: '2027', onlyFav: false, onlyNew: false, onlyRecent: false, hideApplied: false,
      sort: 'recent', limit: PAGE_SIZE,
    });
    for (const f of ['industry', 'kind', 'track', 'region', 'company']) state[f] = new Set();
    $('#q').value = ''; $('#cycle').value = '2027'; $('#sort').value = 'recent';
    $('#only-fav').checked = $('#only-new').checked = $('#only-recent').checked = $('#hide-applied').checked = false;
    renderOffers();
  });

  $('#offer-list').addEventListener('click', e => {
    const star = e.target.closest('[data-fav]');
    if (!star) return;
    const id = star.dataset.fav;
    favorites.has(id) ? favorites.delete(id) : favorites.add(id);
    saveFavorites();
    star.setAttribute('aria-pressed', favorites.has(id));
    star.textContent = favorites.has(id) ? '★' : '☆';
    if (state.onlyFav) renderOffers();
  });

  $('#offer-list').addEventListener('change', e => {
    const select = e.target.closest('[data-status]');
    if (!select) return;
    const id = select.dataset.status;
    select.value ? statuses[id] = select.value : delete statuses[id];
    saveStatuses();
    select.closest('.offer').classList.toggle('is-applied',
      ['applied', 'interview', 'offer', 'rejected'].includes(select.value));
    $('#count-tracker').textContent = Object.values(statuses).filter(Boolean).length;
    if (state.hideApplied) renderOffers();
  });

  $('#new-banner').addEventListener('click', e => {
    if (e.target.id === 'show-new') {
      state.onlyNew = true;
      $('#only-new').checked = true;
      state.limit = PAGE_SIZE;
      renderOffers();
    }
    if (e.target.id === 'mark-seen') {
      for (const o of OFFERS) seenIds.add(o.id);
      newIds.clear();
      state.onlyNew = false;
      $('#only-new').checked = false;
      saveSeen();
      renderOffers();
      toast('Nouveautes acquittees');
    }
  });

  $('#refresh').addEventListener('click', () => runRefresh({ manual: true }));
  $('#load-more').addEventListener('click', () => { state.limit += PAGE_SIZE; renderOffers(); });
  $('#toggle-filters').addEventListener('click', () => $('#filters').classList.toggle('is-open'));
  $('#export-csv').addEventListener('click', exportCsv);

  $('#export-tracker').addEventListener('click', () => {
    download(`summer-2027-suivi-${USER.id}.json`,
      JSON.stringify({ user: USER.id, favorites: [...favorites], statuses }, null, 2), 'application/json');
    toast('Suivi exporte');
  });

  $('#import-tracker').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      favorites = new Set(data.favorites || []);
      statuses = data.statuses || {};
      saveFavorites(); saveStatuses();
      renderOffers(); renderTracker();
      toast('Suivi importe');
    } catch {
      toast('Fichier illisible');
    }
    e.target.value = '';
  });

  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.write('s27:theme', next);
  });

  $('#logout').addEventListener('click', () => {
    logout();
    location.reload();
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|select|textarea/i.test(e.target.tagName)) {
      e.preventDefault();
      $('#q').focus();
    }
  });
}

/* ------------------------------------------------------------ connexion */

function showLogin() {
  const gate = $('#gate');
  gate.hidden = false;
  $('#app').hidden = true;

  $('#gate-users').textContent = knownUsers().map(u => u.label).join(' ou ');

  $('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('#gate-error');
    error.textContent = '';

    const res = await login($('#gate-user').value, $('#gate-pass').value);
    if (!res.ok) {
      error.textContent = res.error;
      $('#gate-pass').select();
      return;
    }
    gate.hidden = true;
    $('#app').hidden = false;
    start(res.user);
  });

  $('#gate-user').focus();
}

/* ------------------------------------------------------------------ init */

async function start(user) {
  USER = user;
  loadUserData();
  $('#user-chip').textContent = user.label;

  try {
    const [offers, portals, sources] = await Promise.all([
      fetch('data/offers.json').then(r => r.json()),
      fetch('data/portals.json').then(r => r.json()).catch(() => ({ portals: [], _timing: {} })),
      fetch('data/sources.json').then(r => r.json()).catch(() => ({ boards: [] })),
    ]);
    DATA = offers;
    PORTALS = portals;
    BOARDS = sources.boards || [];
    OFFERS = DATA.offers;
  } catch (err) {
    $('#offer-list').innerHTML = `
      <li class="empty">
        <p><strong>Impossible de charger data/offers.json.</strong></p>
        <p>Lance le site via <code>npm start</code> : ouvrir index.html en <code>file://</code> bloque les requetes.</p>
        <p style="color:var(--text-3);font-size:12px">${escapeHtml(err.message)}</p>
      </li>`;
    return;
  }

  readUrl();
  bindEvents();
  renderOffers();
  renderPortals();
  renderTracker();
  renderAbout();
  showView(state.view);

  // Rafraichissement en direct, en fond : la page est deja utilisable pendant ce temps.
  runRefresh().then(renderAbout);
}

function init() {
  document.documentElement.dataset.theme =
    store.read('s27:theme', null) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  const user = currentUser();
  if (user) {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    start(user);
  } else {
    showLogin();
  }
}

init();
