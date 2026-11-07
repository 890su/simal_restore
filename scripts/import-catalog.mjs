import { readFile, writeFile, mkdir, rename, unlink, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import {
  SCHEMA_VERSION, LANGUAGES, assertCatalog, normalizeSitePath, normalizePagePath,
  normalizeCurrency, normalizeAvailability, parsePrice,
} from './catalog-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORY_ALIASES = {
  'armchairs-and-armchair-beds': 'kresla-i-kresla-krovati', beds: 'krovati',
  'benches-poufs': 'banketki-i-pufy', 'cushioned-furniture': 'myagkaya-mebel',
  dressers: 'komody', mattresses: 'matrasy', nightstands: 'prikrovatnye-tumby',
  paintings: 'kartiny', shelving: 'stelazhi', 'shoe-cabinets': 'tumby-dlya-obuvi',
  'storage-cabinets-tbilisi': 'tumby', tables: 'stoly', textile: 'tekstil',
  'tv-cabinets': 'tumby-pod-televizor', wardrobes: 'shkafy',
  'sofa-beds': 'divan-krovati', 'corner-sofas': 'uglovye-divany',
  'wall-beds-fold-away-beds': 'krovat-transformer-krovat-shkaf',
  'single-bed': 'odnospalnye-krovati', 'mattress-toppers-': 'namatrasniki-i-toppery',
};

const unique = values => [...new Set(values.filter(value => value !== '' && value !== null && value !== undefined))];
const langOf = value => value === 'ge' ? 'ka' : LANGUAGES.includes(value) ? value : 'ru';
const blankCopy = () => ({ title: '', description: '', summary: '', url: '', attributes: [] });
const copies = () => Object.fromEntries(LANGUAGES.map(lang => [lang, blankCopy()]));
const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const categoryId = value => CATEGORY_ALIASES[value] || value;
const sortIds = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

/** Explicit offline recovery bypasses environment and public-sheet config. */
export function resolveSource({ source, archive = false, env = process.env, config } = {}) {
  if (archive) {
    if (source !== undefined) throw new Error('--archive and --source cannot be used together');
    return { source: undefined, selectedBy: 'archive-flag' };
  }
  if (source !== undefined) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('Explicit catalog source must not be empty');
    return { source: source.trim(), selectedBy: 'argument' };
  }
  const environmentSource = clean(env?.CATALOG_CSV_URL);
  if (environmentSource) return { source: environmentSource, selectedBy: 'environment' };
  if (config !== undefined && config !== null) {
    if (config.schemaVersion !== 1 || typeof config.enabled !== 'boolean') throw new Error('Invalid catalog.config.json schemaVersion/enabled');
    if (config.enabled) {
      let url;
      try { url = new URL(config.csvUrl); } catch { throw new Error('Catalog config requires an HTTPS Google Sheets CSV URL'); }
      if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password) throw new Error('Catalog config requires a public HTTPS Google Sheets URL without credentials');
      if (!/^[A-Za-z0-9_-]{10,}$/.test(config.spreadsheetId || '') || !/^\d+$/.test(String(config.gid ?? ''))) throw new Error('Catalog config has invalid spreadsheetId/gid');
      if (url.pathname !== `/spreadsheets/d/${config.spreadsheetId}/export` || url.searchParams.get('format') !== 'csv' || url.searchParams.get('gid') !== String(config.gid) || [...url.searchParams.keys()].some(key => !['format', 'gid'].includes(key))) throw new Error('Catalog config CSV URL must match spreadsheetId/gid and contain only public format/gid parameters');
      return { source: url.href, selectedBy: 'config' };
    }
  }
  return { source: undefined, selectedBy: 'archive-fallback' };
}

function decodeHtml(text) {
  return String(text || '').replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code) => {
    const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name]);
}

function stripHtml(text) {
  return decodeHtml(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attributes(specs) {
  return (Array.isArray(specs) ? specs : []).map(item => ({ name: clean(item.name), value: clean(item.value) }))
    .filter(item => item.name && item.value);
}

function pageFile(siteDir, url) {
  const safe = normalizePagePath(url);
  return path.join(siteDir, ...decodeURIComponent(safe).split('/').filter(Boolean), ...(safe.endsWith('/') ? ['index.html'] : []));
}

async function optionalText(file) {
  try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function htmlFiles(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const lists = await Promise.all(entries.map(entry => entry.isDirectory() ? htmlFiles(path.join(dir, entry.name))
    : entry.isFile() && entry.name === 'index.html' ? [path.join(dir, entry.name)] : []));
  return lists.flat().sort();
}

/** RFC 4180 records, including BOM, CRLF and embedded quoted newlines. */
export function parseCSV(source) {
  let text = String(source).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  function finishField() { row.push(field); field = ''; closed = false; }
  function finishRow() { finishField(); if (row.some(value => value !== '')) rows.push(row); row = []; }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
      continue;
    }
    if (ch === ',') { finishField(); continue; }
    if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; finishRow(); continue; }
    if (closed) throw new Error(`Unexpected character after CSV quote near offset ${i}`);
    if (ch === '"') {
      if (field) throw new Error(`Unexpected CSV quote near offset ${i}`);
      quoted = true;
    } else field += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quoted field');
  if (field !== '' || row.length || closed) finishRow();
  if (!rows.length) throw new Error('CSV is empty');
  const header = rows.shift().map(value => value.trim());
  if (header.some(value => !value) || new Set(header).size !== header.length) throw new Error('CSV has blank or duplicate headers');
  if (!header.includes('id')) throw new Error('CSV must contain the id column');
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${header.length}`);
    return Object.fromEntries(header.map((key, i) => [key, values[i].replace(/\r\n?/g, '\n')]));
  });
}

function parseSpecs(value) {
  const text = clean(value);
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Attributes JSON must be an array');
    return attributes(parsed);
  }
  return text.split(' | ').map(part => {
    const colon = part.indexOf(':');
    if (colon < 1) throw new Error(`Invalid attribute: ${part}`);
    return { name: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() };
  }).filter(item => item.name && item.value);
}

function splitList(value) { return clean(value).split(/\s*\|\s*/).filter(Boolean); }
function flag(product, value) { if (!product.reviewFlags.includes(value)) product.reviewFlags.push(value); }

/** Known damaged Bitrix test record: retain its evidence, never publish it. */
export function applyProductQualityRules(product) {
  if (product.id === '13538') {
    product.active = false;
    flag(product, 'invalid_title');
  }
  return product;
}

function makeProduct(id) {
  return {
    id: String(id), sku: '', categoryIds: [], translations: copies(), legacyUrls: [],
    price: null, currency: 'GEL', availability: 'unknown', images: [], variants: [],
    reviewFlags: [], active: true, provenance: [], archivedPrices: [], imageCandidates: [],
  };
}

function makeCategory(id, title = '') {
  return { id, slug: id, parentId: null, hidden: id === 'kresla-test', reviewFlags: id === 'kresla-test' ? ['test_category'] : [], translations: Object.fromEntries(LANGUAGES.map(lang => [lang, { title: lang === 'ru' ? title : '', url: '' }])), legacyUrls: [] };
}

/** Checks actual disk presence; the obsolete archive `file` flag is ignored. */
export async function localImage(siteDir, raw, alt, sourceType, sourceUrl) {
  let src;
  try { src = normalizeSitePath(decodeHtml(raw)); } catch { return null; }
  if (!src || !/\.(jpe?g|png|webp|avif|gif)$/i.test(src) || /(?:placeholder|no[-_]?(?:photo|image))/i.test(src)) return null;
  const file = path.join(siteDir, ...decodeURIComponent(src).split('/').filter(Boolean));
  try { const info = await stat(file); if (!info.isFile() || !info.size) return null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return { src, alt: alt || '', sourceUrl: sourceUrl || `https://simal.ge${src}`, sourceType };
}

/** Only this product's gallery/og:image, never recommendations or category icons. */
export function productImageCandidates(html) {
  const results = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (/\b(?:property|name)=["']og:image["']/i.test(tag)) {
      const match = tag.match(/\bcontent=["']([^"']+)["']/i);
      if (match) results.push(decodeHtml(match[1]));
    }
  }
  const start = html.indexOf('catalog-detail__top');
  const end = html.indexOf('catalog-detail__status-box', start);
  if (start >= 0) {
    const gallery = html.slice(start, end >= 0 ? end : start + 20_000);
    for (const tag of gallery.match(/<(?:a|img)\b[^>]*>/gi) || []) {
      const match = tag.match(/\b(?:href|src)=["']([^"']+)["']/i);
      if (match) results.push(decodeHtml(match[1]));
    }
  }
  return unique(results);
}

/** Exact product ID, name, route and price from an archived tile, no inference. */
export function listingProducts(html) {
  const starts = [...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bcatalog-section-tile__item\b[^"']*["'][^>]*>/gi)].map(match => match.index);
  return starts.flatMap((start, index) => {
    const card = html.slice(start, starts[index + 1] ?? html.length);
    const id = card.match(/\bdata-product=["']([^"']+)["']/i)?.[1];
    const anchor = (card.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []).find(tag => /class=["'][^"']*catalog-section-tile__title-link/.test(tag));
    if (!id || !anchor) return [];
    const url = decodeHtml(anchor.match(/\bhref=["']([^"']+)["']/i)?.[1]);
    const title = stripHtml(anchor.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, ''));
    const priceSection = card.match(/<div\b[^>]*class=["'][^"']*catalog-section-tile__price-now[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const price = stripHtml(priceSection.match(/<span\b[^>]*class=["'][^"']*pricespace[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const currency = stripHtml(priceSection.match(/<span\b[^>]*class=["'][^"']*catalog-section-tile__price-rub[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const availability = stripHtml(card.match(/<div\b[^>]*class=["'][^"']*catalog-section-tile__status-(?!box)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const images = [...card.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
      .filter(match => /\bclass=["'][^"']*catalog-section-tile__img-img/.test(match[0]))
      .map(match => decodeHtml(match[1]));
    return title && url ? [{ id, title, url, price, currency, availability, images }] : [];
  });
}

async function addImages(product, candidates, siteDir, sourceType, sourceUrl) {
  for (const raw of candidates) {
    let src;
    try { src = normalizeSitePath(raw); } catch { continue; }
    if (!src || !/\.(jpe?g|png|webp|avif|gif)$/i.test(src) || /(?:placeholder|no[-_]?(?:photo|image))/i.test(src)) continue;
    product.imageCandidates ||= [];
    if (!product.imageCandidates.some(item => item.src === src)) product.imageCandidates.push({ src, sourceUrl: `https://simal.ge${src}`, sourceType, pageUrl: sourceUrl || '' });
    const image = await localImage(siteDir, raw, product.translations.ru.title || product.translations.en.title, sourceType, sourceUrl);
    if (image && !product.images.some(item => item.src === image.src)) product.images.push(image);
  }
}

function reportFor(products, categories, extra = {}) {
  const flags = {};
  for (const product of products) for (const key of product.reviewFlags) flags[key] = (flags[key] || 0) + 1;
  return {
    productCount: products.length, activeProductCount: products.filter(item => item.active).length, categoryCount: categories.length,
    productsWithImages: products.filter(item => item.images.length).length,
    imageCandidateCount: products.reduce((sum, item) => sum + (item.imageCandidates?.length || 0), 0),
    recoveredImageCount: products.reduce((sum, item) => sum + item.images.filter(image => image.sourceType.startsWith('recovered-')).length, 0),
    missingImageIds: products.filter(item => !item.images.length).map(item => item.id),
    missingPriceIds: products.filter(item => item.price === null).map(item => item.id),
    reviewFlagCounts: flags, legacyUrlCount: products.reduce((sum, item) => sum + item.legacyUrls.length, 0),
    translations: Object.fromEntries(LANGUAGES.map(lang => [lang, {
      titles: products.filter(item => item.translations[lang]?.title).length,
      descriptions: products.filter(item => item.translations[lang]?.description).length,
      urls: products.filter(item => item.translations[lang]?.url).length,
    }])), ...extra,
  };
}

export async function normalizeArchive({ archive, publicCatalog = { products: [] }, imageRecovery = { entries: [] }, siteDir, now = new Date().toISOString() }) {
  if (imageRecovery.schemaVersion !== undefined && imageRecovery.schemaVersion !== 1) throw new Error('Unsupported image recovery manifest version');
  const categoryMap = new Map();
  const products = new Map();
  const pathOwners = new Map();
  const htmlCache = new Map();
  for (const row of archive.products || []) if (row.id && row.path) pathOwners.set(normalizePagePath(row.path), String(row.id));
  for (const row of archive.categories || []) {
    const id = categoryId(row.id);
    if (!categoryMap.has(id)) categoryMap.set(id, makeCategory(id));
    const category = categoryMap.get(id), lang = langOf(row.lang), url = normalizePagePath(row.path);
    category.translations[lang] = { title: clean(row.name), url };
    category.legacyUrls = unique([...category.legacyUrls, url]);
  }
  async function htmlFor(url) {
    if (!htmlCache.has(url)) htmlCache.set(url, await optionalText(pageFile(siteDir, url)));
    return htmlCache.get(url);
  }
  async function linkCategories(product, row, lang) {
    const baseId = categoryId(row.category || 'uncategorized');
    if (!categoryMap.has(baseId)) categoryMap.set(baseId, makeCategory(baseId, row.category || 'Каталог'));
    product.categoryIds.push(baseId);
    const url = normalizePagePath(row.path);
    const pieces = url.split('/').filter(Boolean);
    const catalogIndex = pieces.indexOf('catalog');
    if (catalogIndex < 0) return;
    let parentId = baseId;
    for (let i = catalogIndex + 2; i < pieces.length - 1; i++) {
      const subpath = '/' + pieces.slice(0, i + 1).join('/') + '/';
      const subHtml = await htmlFor(subpath);
      if (!subHtml) continue;
      const id = `${baseId}-${categoryId(pieces[i])}`;
      if (!categoryMap.has(id)) categoryMap.set(id, makeCategory(id));
      const category = categoryMap.get(id);
      category.slug = categoryId(pieces[i]); category.parentId = parentId;
      category.translations[lang] = { title: stripHtml(subHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || pieces[i], url: subpath };
      category.legacyUrls = unique([...category.legacyUrls, subpath]);
      product.categoryIds.push(id); parentId = id;
    }
  }
  for (const row of archive.products || []) {
    const id = clean(row.id);
    if (!id) continue;
    if (!products.has(id)) products.set(id, makeProduct(id));
    const product = products.get(id), lang = langOf(row.lang), url = normalizePagePath(row.path);
    const copy = product.translations[lang];
    const title = clean(row.name);
    if (copy.title && copy.title !== title) flag(product, `title_conflict_${lang}`);
    if (!copy.title) Object.assign(copy, { title, description: clean(row.description), summary: clean(row.summary || row.description).slice(0, 240), url, attributes: attributes(row.specs) });
    else {
      if (!copy.description) copy.description = clean(row.description);
      if (!copy.attributes.length) copy.attributes = attributes(row.specs);
    }
    product.legacyUrls.push(url);
    product.provenance.push({ source: 'archive', lang, url, title, availability: clean(row.availability) });
    let price = null;
    try { price = parsePrice(row.price); } catch { flag(product, 'invalid_archived_price'); }
    const currency = normalizeCurrency(row.currency);
    if (row.price || row.currency) product.archivedPrices.push({ value: price, rawValue: clean(row.price), currency: clean(row.currency), url });
    if (row.currency && !currency) flag(product, 'currency_review');
    if (price !== null && !currency) flag(product, 'currency_review');
    const availability = normalizeAvailability(row.availability);
    if (product.availability === 'unknown') product.availability = availability;
    else if (availability !== 'unknown' && availability !== product.availability) flag(product, 'availability_conflict');
    await linkCategories(product, row, lang);
    await addImages(product, (row.images || []).map(image => image.path), siteDir, 'archive-local', `https://simal.ge${url}`);
    if (url) await addImages(product, productImageCandidates(await htmlFor(url)), siteDir, 'html-local', `https://simal.ge${url}`);
  }
  for (const row of publicCatalog.products || []) {
    const product = products.get(String(row.id));
    if (!product) continue; // Archive is the identity authority, not heuristic matches.
    for (const lang of LANGUAGES) {
      const source = row.i18n?.[lang];
      if (!source) continue;
      const copy = product.translations[lang];
      const sourceUrl = normalizePagePath(source.path);
      const owner = pathOwners.get(sourceUrl);
      const safeUrl = sourceUrl && (!owner || owner === product.id) ? sourceUrl : '';
      if (sourceUrl && !safeUrl) flag(product, `translation_url_conflict_${lang}`);
      if (safeUrl) product.legacyUrls.push(safeUrl);
      if (!copy.title && source.name) {
        Object.assign(copy, { title: clean(source.name), description: clean(source.description), summary: clean(source.summary), url: safeUrl, attributes: attributes(source.specs) });
        flag(product, `translation_unverified_${lang}`);
      }
      if (copy.title === clean(source.name)) {
        if (!copy.description) copy.description = clean(source.description);
        if (!copy.summary) copy.summary = clean(source.summary);
        if (!copy.attributes.length) copy.attributes = attributes(source.specs);
      }
      const category = categoryMap.get(product.categoryIds[0]);
      if (category && !category.translations[lang].title && source.category) category.translations[lang].title = clean(source.category);
    }
    if (row.image) await addImages(product, [row.image], siteDir, 'catalog-local');
  }
  // Listing pages carry memberships that cannot be inferred from product URLs:
  // /krovati/dvuspalnye-krovati/ links products with /krovati/<product>/ URLs.
  const unknownProductReferences = new Set();
  const orphanDetailPaths = [];
  let categoryHtmlCount = 0;
  const listingFiles = [...await htmlFiles(path.join(siteDir, 'catalog')), ...await htmlFiles(path.join(siteDir, 'en/catalog')), ...await htmlFiles(path.join(siteDir, 'ge/catalog'))];
  for (const file of listingFiles) {
    const url = '/' + path.relative(siteDir, file).split(path.sep).join('/').replace(/index\.html$/, '');
    const html = await htmlFor(url);
    if (pathOwners.has(url)) continue;
    if (html.includes('catalog-detail__top')) { orphanDetailPaths.push(url); continue; }
    const pieces = url.split('/').filter(Boolean), index = pieces.indexOf('catalog');
    const slugs = pieces.slice(index + 1);
    if (!slugs.length || !/catalog-section(?:-tile|-list|__row)/.test(html)) continue;
    const lang = url.startsWith('/en/') ? 'en' : url.startsWith('/ge/') ? 'ka' : 'ru';
    const id = slugs.map(categoryId).join('-');
    const parentId = slugs.length > 1 ? slugs.slice(0, -1).map(categoryId).join('-') : null;
    if (parentId && !categoryMap.has(parentId)) categoryMap.set(parentId, makeCategory(parentId, slugs[slugs.length - 2]));
    if (!categoryMap.has(id)) categoryMap.set(id, makeCategory(id));
    const category = categoryMap.get(id);
    category.parentId = parentId;
    category.slug = categoryId(slugs.at(-1));
    category.translations[lang] = { title: stripHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || category.translations[lang].title, url };
    category.legacyUrls = unique([...category.legacyUrls, url]);
    categoryHtmlCount++;
    const records = listingProducts(html);
    for (const record of records) {
      const productUrl = normalizePagePath(record.url), owner = pathOwners.get(productUrl);
      if (owner && owner !== record.id) { unknownProductReferences.add(record.id); continue; }
      if (!products.has(record.id)) {
        const item = makeProduct(record.id);
        flag(item, 'detail_page_missing');
        products.set(record.id, item);
      }
      const product = products.get(record.id);
      const copy = product.translations[lang];
      if (copy.title && copy.title !== record.title) flag(product, `title_conflict_${lang}`);
      if (!copy.title) Object.assign(copy, { title: record.title, url: productUrl });
      product.legacyUrls.push(productUrl);
      pathOwners.set(productUrl, record.id);
      product.categoryIds.push(slugs.length > 1 ? slugs.slice(0, -1).map(categoryId).join('-') : id, id);
      product.provenance.push({ source: 'html-listing', lang, url, productUrl, title: record.title, availability: record.availability });
      let price = null;
      try { price = parsePrice(record.price); } catch { flag(product, 'invalid_archived_price'); }
      if (record.price || record.currency) product.archivedPrices.push({ value: price, rawValue: record.price, currency: record.currency, url });
      if ((record.price !== '' || record.currency) && !normalizeCurrency(record.currency)) flag(product, 'currency_review');
      const availability = normalizeAvailability(record.availability);
      if (product.availability === 'unknown') product.availability = availability;
      else if (availability !== 'unknown' && availability !== product.availability) flag(product, 'availability_conflict');
      await addImages(product, record.images, siteDir, 'html-listing-local', `https://simal.ge${url}`);
    }
    for (const match of html.matchAll(/\bdata-product=["']([^"']+)["']/g)) {
      if (!products.has(match[1])) unknownProductReferences.add(match[1]);
    }
  }
  for (const entry of imageRecovery.entries || []) {
    const product = products.get(String(entry.productId));
    if (!product) throw new Error(`Image recovery: unknown product ${entry.productId}`);
    const original = normalizeSitePath(entry.originalUrl);
    if (!(product.imageCandidates || []).some(item => item.src === original)) throw new Error(`Image recovery ${product.id}: originalUrl is not an exact source image candidate`);
    if (!['google-thumbnail', 'yandex-thumbnail', 'wayback', 'original-url'].includes(entry.method)) throw new Error(`Image recovery ${product.id}: unsupported recovery method`);
    const image = await localImage(siteDir, entry.src, product.translations.ru.title || product.translations.en.title, `recovered-${entry.method}`, entry.originalUrl);
    if (!image) throw new Error(`Image recovery ${product.id}: local image does not exist`);
    image.retrievedAt = entry.retrievedAt || '';
    image.cacheUrl = entry.cacheUrl || '';
    image.sourcePageUrl = entry.sourcePageUrl || '';
    if (entry.method.endsWith('-thumbnail')) image.resolution = 'thumbnail';
    if (!product.images.some(item => item.src === image.src)) product.images.push(image);
  }
  for (const product of products.values()) {
    const prices = unique(product.archivedPrices.filter(item => normalizeCurrency(item.currency) && item.value !== null).map(item => item.value));
    if (prices.length > 1) flag(product, 'price_conflict');
    product.price = prices.length === 1 && !product.reviewFlags.includes('currency_review') ? prices[0] : null;
    if (product.reviewFlags.includes('availability_conflict')) product.availability = 'unknown';
    if (!product.price && product.price !== 0) flag(product, 'price_missing');
    flag(product, 'commercial_data_unverified');
    if (!product.images.length) flag(product, 'image_missing');
    if (!product.translations.ru.title) flag(product, 'ru_translation_missing');
    product.categoryIds = unique(product.categoryIds);
    product.legacyUrls = unique(product.legacyUrls);
    applyProductQualityRules(product);
  }
  const resultProducts = [...products.values()].sort(sortIds), categories = [...categoryMap.values()].sort(sortIds);
  const result = { schemaVersion: SCHEMA_VERSION, generatedAt: now, source: { type: 'archive', files: ['data/catalog.json', 'site/data/catalog.json', 'site/**/*.html', 'data/image-recovery.json (optional)'] }, categories, products: resultProducts, report: reportFor(resultProducts, categories, { archiveRows: archive.products?.length || 0, categoryHtmlCount, listingOnlyProducts: resultProducts.filter(item => item.reviewFlags.includes('detail_page_missing')).length, unknownProductReferences: [...unknownProductReferences].filter(id => !products.has(id)).sort(), orphanDetailPaths }) };
  return assertCatalog(result);
}

export async function normalizeCSV(rows, { baseline, siteDir, source = 'CSV', now = new Date().toISOString() }) {
  const seen = new Set();
  const categoryMap = new Map(baseline.categories.map(item => [item.id, structuredClone(item)]));
  const categoryLabels = new Map();
  const products = [];
  for (const [index, row] of rows.entries()) {
    const id = clean(row.id);
    if (!id || !/^[\w-]{1,100}$/.test(id)) throw new Error(`CSV row ${index + 2}: invalid product id`);
    if (seen.has(id)) throw new Error(`CSV row ${index + 2}: duplicate product id ${id}`);
    seen.add(id);
    const previous = baseline.products.find(item => item.id === id);
    const product = previous ? structuredClone(previous) : makeProduct(id);
    // A sheet snapshot replaces commercial values, but copying a machine
    // translation into a sheet does not itself verify that translation.
    product.reviewFlags = (product.reviewFlags || []).filter(value => /^(translation_|title_conflict_|detail_page_missing|ru_translation_missing)/.test(value));
    product.provenance = [...(product.provenance || []), { source: 'sheet', row: index + 2 }];
    const active = clean(row.active).toLowerCase();
    if (!['', 'yes', 'true', '1', 'no', 'false', '0'].includes(active)) throw new Error(`CSV row ${index + 2}: active must be yes or no`);
    if ('active' in row) product.active = !['no', '0', 'false'].includes(active);
    product.sku = clean(row.sku || product.sku);
    product.price = parsePrice(row.price);
    if (row.currency && !normalizeCurrency(row.currency)) throw new Error(`CSV row ${index + 2}: currency must be GEL, not ${row.currency}`);
    if (product.price !== null && !normalizeCurrency(row.currency)) throw new Error(`CSV row ${index + 2}: price requires currency GEL`);
    product.currency = 'GEL';
    if (product.price === null) flag(product, 'price_missing');
    const ids = splitList(row.category_ids || row.category_id);
    if (ids.length) {
      product.categoryIds = unique(ids);
      for (const category of ids) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(category)) throw new Error(`CSV row ${index + 2}: invalid category id ${category}`);
        if (!categoryMap.has(category)) categoryMap.set(category, makeCategory(category, category === ids[0] ? clean(row.category_ru) : ''));
      }
    } else if (clean(row.category_ru)) {
      const category = [...categoryMap.values()].find(item => item.translations.ru.title === clean(row.category_ru));
      if (!category) throw new Error(`CSV row ${index + 2}: unknown category; provide category_ids`);
      product.categoryIds = unique([category.id, ...(previous?.categoryIds || [])]);
    }
    if (!product.categoryIds.length) throw new Error(`CSV row ${index + 2}: category_ids required for a new product`);
    for (const lang of LANGUAGES) {
      if (!(lang in product.translations)) product.translations[lang] = blankCopy();
      const copy = product.translations[lang];
      if (`name_${lang}` in row || `title_${lang}` in row) copy.title = clean(row[`title_${lang}`] ?? row[`name_${lang}`]);
      if (`description_${lang}` in row) copy.description = clean(row[`description_${lang}`]);
      if (`summary_${lang}` in row) copy.summary = clean(row[`summary_${lang}`]);
      if (`specs_${lang}` in row) copy.attributes = parseSpecs(row[`specs_${lang}`]);
      if (`path_${lang}` in row || `url_${lang}` in row) {
        const url = normalizePagePath(row[`url_${lang}`] ?? row[`path_${lang}`]);
        if (copy.url) product.legacyUrls.push(copy.url);
        copy.url = url;
        if (url) product.legacyUrls.push(url);
      }
      const primaryId = product.categoryIds[0];
      const category = categoryMap.get(primaryId);
      const categoryTitle = clean(row[`category_${lang}`]);
      if (category && categoryTitle) {
        const labelKey = `${primaryId}:${lang}`;
        const previousLabel = categoryLabels.get(labelKey);
        if (previousLabel !== undefined && previousLabel !== categoryTitle) throw new Error(`CSV row ${index + 2}: inconsistent ${lang} title for category ${primaryId}`);
        categoryLabels.set(labelKey, categoryTitle);
        category.translations[lang] ||= { title: '', url: '' };
        category.translations[lang].title = categoryTitle;
      }
    }
    product.availability = normalizeAvailability(row.availability || row.availability_ru || row.availability_en || row.availability_ka);
    if (product.availability === 'unknown') flag(product, 'availability_unknown');
    if ('images' in row || 'image' in row) {
      product.images = [];
      for (const raw of splitList(row.images || row.image)) {
        const image = await localImage(siteDir, raw, product.translations.ru.title || product.translations.en.title, 'sheet-local');
        if (!image) throw new Error(`CSV row ${index + 2}: image is not an existing local product file: ${raw}`);
        if (!product.images.some(item => item.src === image.src)) product.images.push(image);
      }
    }
    if (!product.images.length) flag(product, 'image_missing');
    product.legacyUrls = unique(product.legacyUrls);
    applyProductQualityRules(product);
    products.push(product);
  }
  const categories = [...categoryMap.values()].sort(sortIds);
  products.sort(sortIds);
  return assertCatalog({ schemaVersion: SCHEMA_VERSION, generatedAt: now, source: { type: 'csv', location: source, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }, categories, products, report: reportFor(products, categories) });
}

/** Write only after every check succeeds; never truncate the last good snapshot. */
export async function writeCatalogAtomic(output, catalog) {
  assertCatalog(catalog);
  await mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(catalog, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await rename(temp, output);
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function readSource(source) {
  if (!/^https?:\/\//i.test(source)) return readFile(path.resolve(source), 'utf8');
  const url = new URL(source);
  if (url.protocol !== 'https:') throw new Error('Remote catalog source must use HTTPS');
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'text/csv' } });
  if (!response.ok) throw new Error(`CSV download failed: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (length > 10_000_000) throw new Error('CSV exceeds 10 MB');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 10_000_000) throw new Error('CSV exceeds 10 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runImport({ root = ROOT, source, archive: archiveOnly = false, env = process.env, output = path.join(root, 'data', 'normalized-catalog.json'), now, check = false } = {}) {
  const needsConfig = !archiveOnly && source === undefined && !clean(env?.CATALOG_CSV_URL);
  const configText = needsConfig ? await optionalText(path.join(root, 'catalog.config.json')) : '';
  const selection = resolveSource({ source, archive: archiveOnly, env, config: configText ? JSON.parse(configText) : undefined });
  source = selection.source;
  const archive = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
  const publicText = await optionalText(path.join(root, 'site/data/catalog.json'));
  const recoveryText = await optionalText(path.join(root, 'data/image-recovery.json'));
  const baseline = await normalizeArchive({ archive, publicCatalog: publicText ? JSON.parse(publicText) : { products: [] }, imageRecovery: recoveryText ? JSON.parse(recoveryText) : { entries: [] }, siteDir: path.join(root, 'site'), now });
  let catalog = baseline;
  if (source) {
    // Products is authoritative for explicit primary-category labels; reviewed
    // nested labels and other locales survive from the last validated snapshot.
    const previousText = await optionalText(path.join(root, 'data/normalized-catalog.json'));
    if (previousText) {
      const previous = assertCatalog(JSON.parse(previousText));
      const merged = new Map(baseline.categories.map(category => [category.id, structuredClone(category)]));
      for (const category of previous.categories) {
        const restored = merged.get(category.id);
        const copy = structuredClone(category);
        copy.legacyUrls = unique([...(restored?.legacyUrls || []), ...(copy.legacyUrls || [])]);
        if (copy.id === 'kresla-test') { copy.hidden = true; copy.reviewFlags = unique([...(copy.reviewFlags || []), 'test_category']); }
        merged.set(copy.id, copy);
      }
      baseline.categories = [...merged.values()].sort(sortIds);
    }
    const text = await readSource(source);
    const location = /^https?:/i.test(source) ? new URL(source).origin + new URL(source).pathname : path.basename(source);
    catalog = await normalizeCSV(parseCSV(text), { baseline, siteDir: path.join(root, 'site'), source: location, now });
  }
  catalog.source.selectedBy = selection.selectedBy;
  if (!check) await writeCatalogAtomic(output, catalog);
  return catalog;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/import-catalog.mjs [--source <CSV path or HTTPS URL> | --archive] [--check] [--output <JSON path>]\nSource: --source > CATALOG_CSV_URL > enabled catalog.config.json > archive. --archive explicitly ignores environment/config. --check validates without writing.');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--archive') { options.archive = true; continue; }
    if (args[i] === '--check') { options.check = true; continue; }
    if (!['--source', '--output'].includes(args[i]) || !args[i + 1]) throw new Error(`Unknown or incomplete option ${args[i]}`);
    options[args[i].slice(2)] = args[++i];
  }
  const catalog = await runImport(options);
  console.log(JSON.stringify({ output: options.check ? null : options.output || 'data/normalized-catalog.json', checkOnly: Boolean(options.check), source: catalog.source.type, selectedBy: catalog.source.selectedBy, ...catalog.report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
