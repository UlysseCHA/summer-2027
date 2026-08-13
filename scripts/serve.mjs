#!/usr/bin/env node
/**
 * Petit serveur statique, sans dépendance.
 * Ouvrir index.html directement en file:// ne marche pas : fetch() y est bloqué.
 *
 *   node scripts/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;

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

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
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
    server.listen(next);
  } else {
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Summer 2027 → http://localhost:${server.address().port}\n  (Ctrl+C pour arrêter)\n`);
});
