import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicCatalog } from './public-catalog.mjs';
import { getRoutes } from '../src/lib/catalog.ts';
import { migrationPath } from '../src/lib/locale-routing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const publicDir = path.join(root, 'public');
const catalog = readJSON('data/normalized-catalog.json');
fs.mkdirSync(publicDir, { recursive: true });
for (const directory of ['images', 'upload']) {
  const source = path.join(root, 'site', directory);
  if (fs.existsSync(source))
    fs.cpSync(source, path.join(publicDir, directory), { recursive: true });
}
const favicon = path.join(root, 'site/favicon.png');
if (fs.existsSync(favicon)) fs.copyFileSync(favicon, path.join(publicDir, 'favicon.png'));
fs.mkdirSync(path.join(publicDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(publicDir, 'data/catalog.json'), JSON.stringify(publicCatalog(catalog)) + '\n');
fs.writeFileSync(
  path.join(publicDir, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=0, must-revalidate
`,
);

const languages = ['ru', 'en', 'ka'];
const language = (url) => (url.startsWith('/en/') ? 'en' : url.startsWith('/ge/') ? 'ka' : 'ru');
const validRoute = (url) => typeof url === 'string' && /^\/(?!\/)[^\s?#*]*\/$/.test(url);
const owners = new Map();
const collisions = [];
const register = (url, owner) => {
  if (!validRoute(url)) return;
  if (owners.has(url) && owners.get(url) !== owner)
    collisions.push({ path: url, owners: [owners.get(url), owner] });
  else owners.set(url, owner);
};
for (const prefix of ['/', '/en/', '/ge/']) {
  for (const suffix of [
    '',
    'catalog/',
    'izbrannoe/',
    'favorites/',
    'zayavka/',
    'request/',
    'poisk/',
    'search/',
    'aktsii/',
    'news/',
  ])
    register(`${prefix}${suffix}`, 'system');
}
for (const page of readJSON('data/pages.json').pages) {
  if (!owners.has(page.path)) register(page.path, 'content');
}
const products = catalog.products.filter((p) => p.active);
const retiredProducts = readJSON('data/catalog-retired-products.json');
const retiredPaths = new Map();
for (const product of catalog.products) {
  if (product.active || !Object.hasOwn(retiredProducts, product.id)) continue;
  const destinationId = retiredProducts[product.id];
  const aliases = retiredPaths.get(destinationId) ?? [];
  retiredPaths.set(destinationId, [
    ...aliases,
    ...product.legacyUrls,
    ...Object.values(product.translations).map((translation) => translation.url),
  ]);
}
const categories = catalog.categories.filter((c) =>
  products.some((p) => p.categoryIds.includes(c.id)),
);
for (const p of products)
  for (const lang of languages) register(p.translations[lang]?.url, `product:${p.id}`);
for (const c of categories)
  for (const lang of languages)
    register(
      c.translations[lang]?.url ||
        `${lang === 'ru' ? '/' : lang === 'en' ? '/en/' : '/ge/'}catalog/${c.slug}/`,
      `category:${c.id}`,
    );

const redirects = new Map();
const skipped = [];
const conflictingAliases = new Set();
for (const [kind, entries] of [
  ['product', products],
  ['category', categories],
]) {
  for (const entry of entries) {
    const aliases = new Set([...(entry.legacyUrls ?? []), ...(kind === 'product' ? retiredPaths.get(entry.id) ?? [] : [])]);
    for (const source of aliases) {
      if (!validRoute(source)) continue;
      const lang = language(source);
      const destination = entry.translations[lang]?.url;
      if (!validRoute(destination) || source === destination) continue;
      if (conflictingAliases.has(source)) continue;
      if (owners.has(source)) {
        skipped.push({ source, destination, reason: 'existing-route-owner' });
        continue;
      }
      if (owners.get(destination) !== `${kind}:${entry.id}`) {
        skipped.push({ source, destination, reason: 'target-owner-conflict' });
        continue;
      }
      if (redirects.has(source) && redirects.get(source) !== destination) {
        skipped.push({ source, destination, reason: 'alias-conflict' });
        conflictingAliases.add(source);
        redirects.delete(source);
        continue;
      }
      redirects.set(source, destination);
    }
  }
}
const routes = getRoutes();
const canonicalPaths = new Set(routes.map((route) => decodeURI(route.path)));
const productsById = new Map(products.map((product) => [product.id, product]));
function recoverAlias(source, target) {
  if (!validRoute(source) || !target || !canonicalPaths.has(decodeURI(target))) {
    throw new Error(`Invalid recovered alias: ${source} -> ${target}`);
  }
  for (const spelling of [source, source.slice(0, -1)]) {
    const existing = redirects.get(spelling);
    if (canonicalPaths.has(decodeURI(spelling)) || (existing && existing !== target)) {
      skipped.push({ source: spelling, destination: target, reason: 'existing-route-owner' });
      continue;
    }
    redirects.set(spelling, target);
  }
}
for (const [source, id] of Object.entries(readJSON('data/november-1-url-aliases.json'))) {
  const product = productsById.get(id);
  if (!product) {
    skipped.push({ source, reason: 'product-not-published', id });
    continue;
  }
  recoverAlias(source, product.translations[language(source)]?.url);
}
for (const [source, target] of Object.entries({
  '/ge/catalog/krovati/oradgiliani-sawoli/': '/ge/catalog/krovati-dvuspalnye-krovati/',
  '/ge/catalog/matrasy/leibi/': '/ge/catalog/matrasy-namatrasniki-i-toppery/',
  '/ge/catalog/matrasy/-oradgiliani-matrasi-georgia/': '/ge/catalog/matrasy-dvuspalnye-matrasy/',
  '/en/catalog/beds/single-bed/': '/en/catalog/krovati-odnospalnye-krovati/',
  '/en/catalog/mattresses/double-mattresses/': '/en/catalog/matrasy-dvuspalnye-matrasy/',
})) {
  recoverAlias(source, target);
}
recoverAlias('/ru/', '/');

// Serve the restored HTML at migration URLs. A reverse redirect could loop for
// visitors whose browsers cached the earlier 301. HTML canonicals use restored URLs.
const rewrites = new Map();
for (const route of routes) {
  const alias = migrationPath(route.path, route.lang);
  if (canonicalPaths.has(decodeURI(alias)) || redirects.has(alias)) continue;
  rewrites.set(alias, route.path);
}
for (const [source, target] of [...redirects, ...rewrites]) {
  if (canonicalPaths.has(decodeURI(source)) || !canonicalPaths.has(decodeURI(target))) {
    throw new Error(`Redirect conflicts with a published URL: ${source} -> ${target}`);
  }
}
if (redirects.size + rewrites.size > 2000)
  throw new Error('Cloudflare Pages allows at most 2,000 exact routing rules.');

// Every target is a real canonical route, never another redirect: no chains or loops.
const lines = [
  ...[...redirects].map(([source, target]) => `${source} ${target} 301`),
  ...[...rewrites].map(([source, target]) => `${source} ${target} 200`),
].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(
  path.join(publicDir, '_redirects'),
  '# Historical redirects and migration compatibility. Generated by scripts/prepare-public.mjs.\n' +
    lines.join('\n') +
    '\n',
);
fs.mkdirSync(path.join(root, '.work'), { recursive: true });
fs.writeFileSync(
  path.join(root, '.work/public-manifest.json'),
  JSON.stringify(
    {
      redirects: Object.fromEntries(redirects),
      rewrites: Object.fromEntries(rewrites),
      skipped,
      collisions,
      productCount: products.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Public assets ready: ${products.length} products, ${redirects.size} redirects, ${rewrites.size} compatibility rewrites, ${collisions.length} route collisions.`,
);
