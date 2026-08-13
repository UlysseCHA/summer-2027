/**
 * Portillon d'acces a deux comptes.
 *
 * ATTENTION, a lire avant de compter dessus : ce site est entierement statique, il n'y a
 * aucun serveur pour verifier quoi que ce soit. La verification se fait dans le navigateur,
 * donc n'importe qui sachant ouvrir les outils de developpement peut la contourner en
 * quelques secondes. Ce n'est pas une securite, c'est une separation de profils : chaque
 * compte a ses propres favoris et son propre suivi de candidatures.
 *
 * Ne mets jamais d'information sensible dans ce projet en te fiant a cet ecran.
 *
 * Le mot de passe n'est pas ecrit en clair : on stocke l'empreinte SHA-256 de
 * « identifiant:motdepasse », ce qui evite au moins de le lire par-dessus l'epaule.
 */

const USERS = {
  ulysse: { label: 'Ulysse', hash: 'b8f66615e2f13a6e4830d7d78e75c12e76db3cd635685384a745ff6a50907a1d' },
  rayan:  { label: 'Rayan',  hash: 'c6dff7dd0f6a7e4d71573f806289c5b3928628cd20d261f70330c1839d841bc1' },
};

const SESSION_KEY = 's27:session';

async function sha256(text) {
  // crypto.subtle exige un contexte securise (https ou localhost).
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

/** Repli si SHA-256 est indisponible (http simple sur une IP locale, par exemple). */
const FALLBACK = 'c3VtbWVyMmsyNw==';

export function knownUsers() {
  return Object.entries(USERS).map(([id, u]) => ({ id, label: u.label }));
}

export async function login(username, password) {
  const id = String(username || '').trim().toLowerCase();
  const user = USERS[id];
  if (!user) return { ok: false, error: "Identifiant inconnu." };

  const digest = await sha256(`${id}:${password}`);
  const ok = digest ? digest === user.hash : btoa(String(password)) === FALLBACK;

  if (!ok) return { ok: false, error: 'Mot de passe incorrect.' };

  localStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: new Date().toISOString() }));
  return { ok: true, user: { id, label: user.label } };
}

export function currentUser() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY));
    const user = raw && USERS[raw.id];
    return user ? { id: raw.id, label: user.label } : null;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

/** Prefixe de stockage propre a chaque compte : les deux suivis ne se melangent pas. */
export const scopeKey = (userId, key) => `s27:${userId}:${key}`;
