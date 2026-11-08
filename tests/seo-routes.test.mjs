import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);

// Exercise the actual TypeScript route builder with isolated catalogue/content
// fixtures. Transpilation only removes types; no application logic is copied.
function routesFor(catalog, pages = []) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const require = specifier => {
      if (specifier === 'node:fs') return { readFileSync: name => {
        if (String(name).endsWith('normalized-catalog.json')) return JSON.stringify(catalog);
        if (String(name).endsWith('pages.json')) return JSON.stringify({ pages });
        throw new Error('Unexpected route-builder filesystem access');
      } };
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(filename), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
      return nativeRequire(specifier);
    };
    new Function('require', 'module', 'exports', 'process', outputText)(require, module, module.exports, { cwd: () => root });
    return module.exports;
  }
  return load(path.join(root, 'src/lib/catalog.ts')).getRoutes();
}

function fixture() {
  const translations = prefix => Object.fromEntries(['ru', 'en', 'ka'].map(lang => [lang, {
    title: `${prefix} ${lang}`,
    description: `Verified dimensions and material of ${prefix}.`,
    url: `${lang === 'ru' ? '' : lang === 'ka' ? '/ge' : '/en'}/product/${prefix}/`,
    attributes: [],
  }]));
  return {
    schemaVersion: 1,
    categories: [{ id: 'beds', slug: 'beds', translations: { ru: { title: 'Кровати', url: '/catalog/beds/' }, en: { title: 'Beds', url: '' }, ka: { title: 'საწოლები', url: '/ge/catalog/beds/' } }, legacyUrls: [] }],
    products: [
      { id: 'bed-1', active: true, categoryIds: ['beds'], translations: translations('bed-1'), reviewFlags: ['translation_unverified_en', 'translation_unverified_ka'], images: [], price: null, currency: 'GEL', availability: 'unknown', variants: [], legacyUrls: [] },
      { id: 'bed-gap', active: true, categoryIds: ['beds'], translations: Object.fromEntries(Object.entries(translations('bed-gap')).map(([lang, copy]) => [lang, { ...copy, description: '' }])), reviewFlags: ['detail_page_missing'], images: [], price: null, currency: 'GEL', availability: 'unknown', variants: [], legacyUrls: [] },
    ],
  };
}

const translationReason = 'Translation recovered from archive; editorial review required.';
function information(lang, route, reasons = []) {
  return { path: route, lang, title: `About ${lang}`, heading: `About ${lang}`, description: 'Company information', kind: 'information', html: '<p>Actual translated company description.</p>', images: [], needsReview: reasons.length > 0, reviewReasons: reasons, sourcePath: route };
}

test('RU EN KA homes, catalogues and translated products remain indexable despite translation flags', () => {
  const routes = routesFor(fixture());
  for (const lang of ['ru', 'en', 'ka']) {
    for (const kind of ['home', 'catalog']) {
      const route = routes.find(entry => entry.lang === lang && entry.kind === kind);
      assert.ok(route, `${lang} ${kind} exists`);
      assert.ok(!route.noindex, `${lang} ${kind} is indexable`);
    }
    const product = routes.find(entry => entry.lang === lang && entry.product?.id === 'bed-1');
    assert.ok(product && !product.noindex, `${lang} translated product is indexable`);
    assert.deepEqual(product.alternates.map(alternate => alternate.lang), ['ru', 'en', 'ka']);
    for (const alternate of product.alternates) {
      const target = routes.find(entry => entry.path === alternate.path);
      assert.ok(target?.alternates.some(back => back.path === product.path && back.lang === lang), 'hreflang is reciprocal');
    }
  }
});

test('missing archived locale URL or description alone does not disable indexing', () => {
  const data = fixture();
  data.products[0].translations.en.description = '';
  const routes = routesFor(data);
  assert.ok(!routes.find(route => route.lang === 'en' && route.product?.id === 'bed-1').noindex);
  assert.ok(!routes.find(route => route.lang === 'en' && route.kind === 'category').noindex);
});

test('translation-only content review is indexable and has reciprocal language alternates', () => {
  const pages = [information('ru', '/kompaniya/'), information('en', '/en/kompaniya/', [translationReason]), information('ka', '/ge/kompaniya/', [translationReason])];
  const routes = routesFor(fixture(), pages);
  for (const page of pages) {
    const route = routes.find(entry => entry.path === page.path);
    assert.ok(!route.noindex);
    assert.deepEqual(route.alternates.map(alternate => alternate.lang), ['ru', 'en', 'ka']);
  }
});

test('cart, wishlist, search, archived promotions and actual content gaps keep noindex', () => {
  const pages = [
    { ...information('ka', '/ge/aktsii/old-promotion/', [translationReason]), kind: 'promotion' },
    information('en', '/en/kompaniya/', [translationReason, 'Recovered company details and terms; check current addresses, policy and delivery conditions.']),
  ];
  const routes = routesFor(fixture(), pages);
  for (const route of routes.filter(entry => ['cart', 'favorites', 'search'].includes(entry.kind) || entry.product?.id === 'bed-gap')) assert.equal(route.noindex, true);
  assert.equal(routes.find(route => route.path === pages[0].path).noindex, true);
  assert.equal(routes.find(route => route.path === pages[1].path).noindex, true);
});

test('reviewed contacts and delivery override archived terms and have reciprocal language alternatives', () => {
  const archived = information('en', '/en/oplata-dostavka/', ['Unverified archived terms.']);
  const routes = routesFor(fixture(), [archived]);
  for (const path of ['kontakty', 'oplata-dostavka']) {
    for (const prefix of ['', '/en', '/ge']) {
      const route = routes.find(entry => entry.path === `${prefix}/${path}/`);
      assert.equal(route.noindex, false);
      assert.equal(route.content.needsReview, false);
      assert.equal(route.content.html, '');
      assert.deepEqual(route.alternates.map(alternate => alternate.lang), ['ru', 'en', 'ka']);
    }
  }
});

test('verified sleeping area differentiates duplicate product metadata without moving the URL', () => {
  const data = fixture();
  const original = data.products[0];
  original.translations.ru.attributes = [{ name: 'Спальное место', value: '140×200 см' }];
  const variant = structuredClone(original);
  variant.id = 'bed-2';
  variant.translations.ru.url = '/product/bed-2/';
  variant.translations.ru.attributes[0].value = '160×200 см';
  variant.translations.en = undefined;
  variant.translations.ka = undefined;
  data.products.push(variant);
  const routes = routesFor(data);
  for (const [path, size] of [['/product/bed-1/', '140×200 см'], ['/product/bed-2/', '160×200 см']]) {
    const route = routes.find(entry => entry.path === path);
    assert.ok(route.title.includes(size));
    assert.ok(route.description.includes(size));
  }
});

test('detail gap flag ceases to block indexing once real descriptive data is supplied', () => {
  const data = fixture();
  data.products[1].translations.ka.attributes = [{ name: 'სიგანე', value: '160 cm' }];
  const routes = routesFor(data);
  assert.ok(!routes.find(route => route.lang === 'ka' && route.product?.id === 'bed-gap').noindex);
});
