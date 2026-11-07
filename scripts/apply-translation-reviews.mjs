import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCatalog, LANGUAGES } from './catalog-schema.mjs';
import { writeCatalogAtomic } from './import-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = ['title', 'summary', 'description', 'attributes'];
const optionalText = async file => { try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };

function checkedFields(review) {
  const fields = review.reviewedFields ?? FIELDS.filter(field => Object.hasOwn(review, field));
  if (!Array.isArray(fields) || fields.some(field => !FIELDS.includes(field)) || new Set(fields).size !== fields.length) throw new Error('Invalid reviewedFields');
  return fields;
}

function validateReview(review, id) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error(`Invalid translation review for ${id}`);
  const allowed = [...FIELDS, 'reviewedFields', 'reviewNote'];
  if (Object.keys(review).some(key => !allowed.includes(key))) throw new Error(`Unsupported translation review field for ${id}`);
  checkedFields(review);
  for (const field of FIELDS.slice(0, 3)) {
    if (Object.hasOwn(review, field) && (typeof review[field] !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(review[field]))) throw new Error(`Invalid ${field} review for ${id}`);
  }
  if (Object.hasOwn(review, 'attributes') && (!Array.isArray(review.attributes) || review.attributes.some(item => !item || typeof item.name !== 'string' || typeof item.value !== 'string' || !item.name.trim() || !item.value.trim()))) throw new Error(`Invalid attributes review for ${id}`);
}

/** Adds canonical routes only where that language actually has a title. */
export function prepareTranslatedUrls(catalog) {
  const created = { en: 0, ka: 0 };
  for (const product of catalog.products) {
    if (!product.active || product.reviewFlags?.includes('invalid_title')) continue;
    for (const [lang, prefix] of [['en', '/en/'], ['ka', '/ge/']]) {
      const copy = product.translations?.[lang];
      if (copy?.title?.trim() && !copy.url) { copy.url = `${prefix}product/${encodeURIComponent(product.id)}/`; created[lang]++; }
    }
  }
  for (const category of catalog.categories) {
    if (category.hidden) continue;
    for (const [lang, prefix] of [['en', '/en/'], ['ka', '/ge/']]) {
      const copy = category.translations?.[lang];
      if (copy?.title?.trim() && !copy.url) copy.url = `${prefix}catalog/${encodeURIComponent(category.id)}/`;
    }
  }
  return created;
}

/** Pure application; review notes stay in the review document, never products. */
export function applyTranslationReviews(input, documents = []) {
  const catalog = structuredClone(assertCatalog(input));
  const byId = new Map(catalog.products.map(product => [product.id, product]));
  const reports = {};
  const usedLanguages = new Set();
  for (const document of documents) {
    if (document?.schemaVersion !== 1 || !LANGUAGES.includes(document.language) || !document.products || typeof document.products !== 'object' || Array.isArray(document.products)) throw new Error('Invalid translation review document');
    const lang = document.language;
    if (usedLanguages.has(lang)) throw new Error(`Duplicate review document for ${lang}`);
    usedLanguages.add(lang);
    if (catalog.source?.type === 'csv') {
      reports[lang] = { reviewedAt: document.reviewedAt || '', skipped: 'csv_source_authoritative', appliedProducts: 0, appliedCategories: 0, appliedFields: 0 };
      continue;
    }
    let appliedFields = 0, completeProducts = 0, partialProducts = 0;
    for (const [id, review] of Object.entries(document.products)) {
      const product = byId.get(id);
      if (!product) throw new Error(`Translation review references unknown product ${id}`);
      validateReview(review, id);
      const copy = product.translations[lang] ||= { title: '', summary: '', description: '', attributes: [], url: '' };
      for (const field of FIELDS) if (Object.hasOwn(review, field)) {
        appliedFields++;
        copy[field] = structuredClone(review[field]);
      }
      const checked = checkedFields(review);
      const populated = FIELDS.filter(field => field === 'attributes' ? copy.attributes?.length : copy[field]?.trim());
      const complete = populated.length > 0 && populated.every(field => checked.includes(field));
      product.reviewFlags = (product.reviewFlags || []).filter(flag => flag !== `translation_reviewed_${lang}` && flag !== `translation_review_partial_${lang}` && !(complete && flag === `translation_unverified_${lang}`));
      product.reviewFlags.push(complete ? `translation_reviewed_${lang}` : `translation_review_partial_${lang}`);
      if (complete) completeProducts++; else partialProducts++;
    }
    let appliedCategories = 0;
    if (document.categories !== undefined && (!document.categories || typeof document.categories !== 'object' || Array.isArray(document.categories))) throw new Error(`Invalid category reviews for ${lang}`);
    for (const [id, review] of Object.entries(document.categories || {})) {
      const category = catalog.categories.find(item => item.id === id);
      if (!category) throw new Error(`Translation review references unknown category ${id}`);
      if (!review || typeof review !== 'object' || typeof review.title !== 'string' || !review.title.trim() || Object.keys(review).some(key => !['title', 'reviewedFields', 'reviewNote'].includes(key))) throw new Error(`Invalid category title review for ${id}`);
      category.translations[lang] ||= { title: '', url: '' };
      category.translations[lang].title = review.title;
      appliedCategories++;
    }
    reports[lang] = {
      reviewedAt: document.reviewedAt || '', appliedProducts: Object.keys(document.products).length,
      appliedFields, completeProducts, partialProducts, appliedCategories,
      remainingUnverifiedProducts: catalog.products.filter(product => product.reviewFlags?.includes(`translation_unverified_${lang}`)).length,
    };
  }
  prepareTranslatedUrls(catalog);
  const defaultUrls = Object.fromEntries([['en', '/en/'], ['ka', '/ge/']].map(([lang, prefix]) => [lang, catalog.products.filter(product => product.active && product.translations?.[lang]?.url === `${prefix}product/${encodeURIComponent(product.id)}/`).length]));
  catalog.report = { ...catalog.report, translationReviews: reports, generatedTranslationUrls: defaultUrls };
  catalog.report.translations = Object.fromEntries(LANGUAGES.map(lang => [lang, {
    titles: catalog.products.filter(product => product.translations[lang]?.title).length,
    descriptions: catalog.products.filter(product => product.translations[lang]?.description).length,
    urls: catalog.products.filter(product => product.translations[lang]?.url).length,
  }]));
  // Recount flags after partial/completed reviews. Other catalog statistics remain source-derived.
  catalog.report.reviewFlagCounts = {};
  for (const product of catalog.products) for (const flag of product.reviewFlags || []) catalog.report.reviewFlagCounts[flag] = (catalog.report.reviewFlagCounts[flag] || 0) + 1;
  return assertCatalog(catalog);
}

async function main() {
  const options = { input: path.join(ROOT, 'data/normalized-catalog.json'), output: '', reviews: [], check: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { console.log('Usage: node scripts/apply-translation-reviews.mjs [--check] [--input catalog.json] [--output catalog.json] [--review reviews.json ...]\nDefaults: read/write normalized catalog; apply existing EN and KA review files atomically. --check validates without writing. CSV text remains authoritative.'); return; }
    if (arg === '--check') { options.check = true; continue; }
    if (!['--input', '--output', '--review'].includes(arg) || !args[i + 1]) throw new Error(`Invalid review option ${arg}`);
    if (arg === '--review') options.reviews.push(path.resolve(args[++i]));
    else options[arg.slice(2)] = path.resolve(args[++i]);
  }
  const files = options.reviews.length ? options.reviews : ['en', 'ka'].map(lang => path.join(ROOT, `data/translations-reviewed-${lang}.json`));
  const documents = [];
  for (const file of files) {
    const text = await optionalText(file);
    if (!text && options.reviews.length) throw new Error(`Missing review document ${file}`);
    if (text) documents.push(JSON.parse(text));
  }
  const catalog = applyTranslationReviews(JSON.parse(await readFile(options.input, 'utf8')), documents);
  if (!options.check) await writeCatalogAtomic(options.output || options.input, catalog);
  console.log(JSON.stringify({ output: options.check ? null : options.output || options.input, checkOnly: options.check, reviews: catalog.report.translationReviews, generatedUrls: catalog.report.generatedTranslationUrls }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
