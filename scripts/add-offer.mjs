#!/usr/bin/env node
/**
 * Ajoute une offre a la main dans data/manual.json, pour les employeurs dont aucune
 * source publique n'est listable.
 *
 *   npm run add-offer "McKinsey" "Business Analyst Intern" "https://..." consulting "Paris"
 *
 * L'offre apparait ensuite dans l'app avec un badge « ajoutee a la main », et le
 * rafraichissement ne la supprime jamais.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [company, title, url, industry = 'consulting', location = ''] = process.argv.slice(2);

if (!company || !title || !url) {
  console.error('Usage : npm run add-offer "Entreprise" "Intitule" "https://lien" [finance|tech|consulting] ["Lieu"]');
  process.exit(1);
}
if (!/^https?:\/\//i.test(url)) {
  console.error('Le lien doit commencer par http:// ou https://');
  process.exit(1);
}

const path = resolve(ROOT, 'data/manual.json');
const data = JSON.parse(await readFile(path, 'utf8'));

if ((data.offers || []).some(o => o.url === url)) {
  console.log('Cette offre est deja enregistree.');
  process.exit(0);
}

/* Devine le metier depuis l'intitule, comme le fait le collecteur. */
const track =
  /quant|trading|trader/i.test(title) ? 'quant'
  : /machine learning|\bml\b|\bai\b|research scientist/i.test(title) ? 'ai-ml'
  : /software|engineer|developer/i.test(title) ? 'engineering'
  : /data/i.test(title) ? 'data'
  : /banking|m&a|markets|analyst/i.test(title) && industry === 'finance' ? 'banking'
  : /consult|strategy|business analyst/i.test(title) ? 'consulting'
  : 'other';

const kind = /intern|stage|summer/i.test(title) ? 'internship'
  : /graduate|new grad/i.test(title) ? 'graduate'
  : 'internship';

data.offers.push({
  company, title, url, industry,
  location: location || 'Non precise',
  cycle: 2027,
  kind,
  track,
  addedAt: new Date().toISOString().slice(0, 10),
});

await writeFile(path, JSON.stringify(data, null, 2), 'utf8');

console.log(`Ajoutee : ${company} - ${title}`);
console.log(`${data.offers.length} offre(s) saisie(s) a la main au total.\n`);
console.log('Pour la voir dans l app : npm run fetch');
console.log('Pour la publier en ligne : git add -A && git commit -m "Ajout offre" && git push');
