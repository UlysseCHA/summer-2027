#!/usr/bin/env node
/**
 * Petit serveur statique, sans dépendance.
 * Ouvrir index.html directement en file:// ne marche pas : fetch() y est bloqué.
 *
 *   node scripts/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;
const PROFIL = resolve(ROOT, 'data/profile.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const json = (res, code, obj) =>
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj));

/**
 * Le profil, lisible et modifiable depuis l'onglet « Mon profil ».
 *
 * C'est le seul chemin en ecriture du serveur, et il est en dur : aucune valeur
 * envoyee par la page ne decide du fichier touche. Le serveur n'ecoute que sur
 * 127.0.0.1, donc rien de tout ceci n'est joignable depuis le reseau.
 *
 * Le site publie sur GitHub Pages n'a pas ces routes, et data/profile.json n'y est
 * pas deploye : tes informations restent sur ta machine.
 */
async function api(req, res) {
  if (req.method === 'GET') {
    try { return json(res, 200, JSON.parse(await readFile(PROFIL, 'utf8'))); }
    catch { return json(res, 200, {}); }   // pas encore de profil, ce n'est pas une erreur
  }

  if (req.method !== 'PUT') return json(res, 405, { erreur: 'methode non autorisee' });

  let brut = '';
  for await (const bout of req) {
    brut += bout;
    if (brut.length > 262144) { req.destroy(); return json(res, 413, { erreur: 'corps trop volumineux' }); }
  }

  let recu;
  try { recu = JSON.parse(brut); } catch { return json(res, 400, { erreur: 'JSON invalide' }); }
  if (!recu || typeof recu !== 'object' || Array.isArray(recu)) {
    return json(res, 400, { erreur: 'objet attendu' });
  }

  // Fusion et non remplacement : les cles que le formulaire ne gere pas
  // (commentaires du modele, champs ajoutes a la main) survivent a un
  // enregistrement. Ecraser le fichier ferait disparaitre du travail sans prevenir.
  let existant = {};
  try { existant = JSON.parse(await readFile(PROFIL, 'utf8')); } catch { /* premier enregistrement */ }

  await writeFile(PROFIL, JSON.stringify({ ...existant, ...recu }, null, 2) + '\n', 'utf8');
  return json(res, 200, { ok: true });
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (urlPath === '/api/profil') return await api(req, res);

    let filePath = resolve(ROOT, '.' + normalize(urlPath));

    // Interdit de sortir du dossier du projet.
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) filePath = join(filePath, 'index.html');

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      // Les données changent à chaque `npm run fetch` : on ne veut pas de cache.
      'cache-control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 : fichier introuvable');
  }
});

// Si le port est déjà pris (autre projet en cours), on essaie le suivant.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && server.address() === null) {
    const next = (server._triedPort ?? PORT) + 1;
    if (next > PORT + 20) { console.error(`Aucun port libre entre ${PORT} et ${next}.`); process.exit(1); }
    server._triedPort = next;
    console.log(`  port ${next - 1} occupé, essai sur ${next}…`);
    server.listen(next, '127.0.0.1');
  } else {
    console.error(err);
    process.exit(1);
  }
});

// Uniquement sur la boucle locale : le serveur sait ecrire data/profile.json,
// il n'a rien a faire sur le reseau.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Summer 2027 → http://localhost:${server.address().port}\n  (Ctrl+C pour arrêter)\n`);
});
