import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseCSV,
  normalizeArchive,
  normalizeCSV,
  writeCatalogAtomic,
  localImage,
  productImageCandidates,
  listingProducts,
} from '../scripts/import-catalog.mjs';
import { normalizeSitePath, parsePrice, validateCatalog } from '../scripts/catalog-schema.mjs';
import { exportCatalogCSV } from '../scripts/export-catalog-csv.mjs';

const date = '2026-11-07T00:00:00.000Z';
const row = (overrides) => ({
  id: '123',
  name: 'Стул',
  lang: 'ru',
  path: '/catalog/stulya/stul/',
  category: 'stulya',
  price: '100',
  currency: '₾',
  availability: 'В наличии',
  description: 'Описание',
  specs: [{ name: 'Высота', value: '80 см' }],
  images: [],
  ...overrides,
});
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'simal-catalog-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const siteDir = path.join(dir, 'site');
  await mkdir(siteDir);
  return { dir, siteDir };
}
async function baseline(siteDir, rows = [row({})], extra = {}) {
  return normalizeArchive({
    siteDir,
    archive: {
      categories: [{ id: 'stulya', name: 'Стулья', lang: 'ru', path: '/catalog/stulya/' }],
      products: rows,
    },
    now: date,
    ...extra,
  });
}

test('CSV handles BOM, quoted commas, escaped quotes and multiline descriptions', () => {
  const rows = parseCSV(
    '\uFEFFid,name_ru,description_ru\r\n123,"Стул, белый","Первая\r\nвторая ""строка"""\r\n',
  );
  assert.deepEqual(rows, [
    { id: '123', name_ru: 'Стул, белый', description_ru: 'Первая\nвторая "строка"' },
  ]);
});

test('CSV rejects malformed input instead of silently moving fields', () => {
  for (const source of [
    'id,id\n1,2',
    'id,name\n1',
    'id,name\n1,"unfinished',
    'id,name\n1,"value"junk',
  ])
    assert.throws(() => parseCSV(source));
});

test('price parser never turns a missing value into zero and rejects ambiguous text', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('1\u00a0234,50'), 1234.5);
  assert.equal(parsePrice('1,234.50'), 1234.5);
  assert.equal(parsePrice(0), 0);
  for (const value of ['1,234', '12р', '-20', 'NaN', 'Infinity', NaN])
    assert.throws(() => parsePrice(value));
});

test('archive deduplicates stable ID, preserves category links and flags conflicting prices', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(siteDir, [
    row({}),
    row({ path: '/catalog/komody/stul/', category: 'komody', price: '90' }),
  ]);
  assert.equal(catalog.products.length, 1);
  const product = catalog.products[0];
  assert.deepEqual(product.categoryIds, ['stulya', 'komody']);
  assert.deepEqual(product.legacyUrls, ['/catalog/stulya/stul/', '/catalog/komody/stul/']);
  assert.equal(product.price, null);
  assert.ok(product.reviewFlags.includes('price_conflict'));
  assert.equal(product.archivedPrices.length, 2);
  assert.deepEqual(product.variants, []);
});

test('uncertain archival currency is review-only, never converted to GEL numerically', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(siteDir, [row({ currency: 'р.' })]);
  assert.equal(catalog.products[0].price, null);
  assert.ok(catalog.products[0].reviewFlags.includes('currency_review'));
  assert.equal(catalog.products[0].archivedPrices[0].currency, 'р.');
});

test('zero price remains zero after deduplication', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(siteDir, [row({ price: '0' })]);
  assert.equal(catalog.products[0].price, 0);
});

test('archive file:false is ignored when the exact product photo actually exists', async (t) => {
  const { siteDir } = await fixture(t);
  await mkdir(path.join(siteDir, 'upload/iblock/a'), { recursive: true });
  await writeFile(path.join(siteDir, 'upload/iblock/a/chair.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  const catalog = await baseline(siteDir, [
    row({
      images: [
        { path: '/upload/iblock/a/chair.jpg', file: false },
        { path: '/upload/iblock/a/missing.jpg', file: true },
      ],
    }),
  ]);
  assert.equal(catalog.products[0].images.length, 1);
  assert.equal(catalog.products[0].images[0].src, '/upload/iblock/a/chair.jpg');
});

test('verified recovery accepts only a local photo with an exact original source candidate', async (t) => {
  const { siteDir } = await fixture(t);
  await mkdir(path.join(siteDir, 'images/recovered'), { recursive: true });
  await writeFile(path.join(siteDir, 'images/recovered/123.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  const rows = [row({ images: [{ path: '/upload/iblock/a/chair.jpg', file: false }] })];
  const imageRecovery = {
    entries: [
      {
        productId: '123',
        src: '/images/recovered/123.jpg',
        originalUrl: 'https://simal.ge/upload/iblock/a/chair.jpg',
        method: 'google-thumbnail',
        cacheUrl: 'https://encrypted-tbn0.gstatic.com/example',
        retrievedAt: date,
      },
    ],
  };
  const catalog = await baseline(siteDir, rows, { imageRecovery });
  assert.equal(catalog.products[0].images[0].sourceType, 'recovered-google-thumbnail');
  assert.equal(catalog.products[0].images[0].resolution, 'thumbnail');
  imageRecovery.entries[0].originalUrl =
    'https://simal.ge/upload/iblock/a/similar-but-different.jpg';
  await assert.rejects(() => baseline(siteDir, rows, { imageRecovery }), /not an exact source/);
});

test('product photo extraction excludes related products below the own gallery', () => {
  const candidates = productImageCandidates(
    '<div class="catalog-detail__top"><a href="/upload/own.jpg"><img src="/images/placeholder.png"></a><div class="catalog-detail__status-box"></div><img src="/upload/related.jpg">',
  );
  assert.ok(candidates.includes('/upload/own.jpg'));
  assert.ok(!candidates.includes('/upload/related.jpg'));
});

test('local image lookup blocks traversal, remote URLs and placeholder promotion', async (t) => {
  const { siteDir } = await fixture(t);
  for (const value of [
    'https://evil.example/photo.jpg',
    '/../../photo.jpg',
    '/upload/%2e%2e/%2e%2e/photo.jpg',
    '/upload/%5c..%5cphoto.jpg',
  ]) {
    assert.equal(await localImage(siteDir, value), null);
  }
  for (const value of ['javascript:alert(1)', '//evil.example/a', '/a/../b', '/%2e%2e/a'])
    assert.throws(() => normalizeSitePath(value));
});

test('public heuristic translations cannot steal a URL belonging to a different archive ID', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(
    siteDir,
    [row({}), row({ id: '456', lang: 'en', path: '/en/catalog/chairs/chair/', name: 'Chair' })],
    {
      publicCatalog: {
        products: [
          { id: '123', i18n: { en: { name: 'Chair', path: '/en/catalog/chairs/chair/' } } },
        ],
      },
    },
  );
  const product = catalog.products.find((item) => item.id === '123');
  assert.equal(product.translations.en.url, '');
  assert.ok(product.reviewFlags.includes('translation_url_conflict_en'));
  assert.ok(!product.legacyUrls.includes('/en/catalog/chairs/chair/'));
});

test('nested listing HTML preserves its route and product membership even with a flat product URL', async (t) => {
  const { siteDir } = await fixture(t);
  await mkdir(path.join(siteDir, 'catalog/stulya/dining'), { recursive: true });
  await writeFile(
    path.join(siteDir, 'catalog/stulya/dining/index.html'),
    '<h1>Обеденные стулья</h1><div class="catalog-section-tile"><div class="catalog-section-tile__item"><a href="/catalog/stulya/stul/" class="catalog-section-tile__title-link">Стул</a><button data-product="123"></button><button data-product="999"></button></div></div>',
  );
  const catalog = await baseline(siteDir);
  const category = catalog.categories.find((item) => item.id === 'stulya-dining');
  assert.equal(category.parentId, 'stulya');
  assert.equal(category.translations.ru.url, '/catalog/stulya/dining/');
  assert.ok(catalog.products[0].categoryIds.includes('stulya-dining'));
  assert.deepEqual(catalog.report.unknownProductReferences, ['999']);
});

test('listing-only products recover exact names, routes and current price, excluding crossed-out price', async (t) => {
  const { siteDir } = await fixture(t);
  await mkdir(path.join(siteDir, 'catalog/stulya'), { recursive: true });
  const html =
    '<h1>Стулья</h1><div class="catalog-section-tile"><div class="catalog-section-tile__item">' +
    '<img src="/images/placeholder.png"><div class="catalog-section-tile__status-nal">В наличии</div>' +
    '<a href="/catalog/stulya/new-chair/" class="catalog-section-tile__title-link">Новый &amp; белый</a>' +
    '<div class="catalog-section-tile__price-now"><span class="pricespace">200</span><span class="catalog-section-tile__price-rub">₾</span></div>' +
    '<div class="catalog-section-tile__price-old"><span class="pricespace">300</span></div><button data-product="999"></button></div></div>';
  await writeFile(path.join(siteDir, 'catalog/stulya/index.html'), html);
  assert.equal(listingProducts(html)[0].price, '200');
  const catalog = await baseline(siteDir);
  const product = catalog.products.find((item) => item.id === '999');
  assert.equal(product.translations.ru.title, 'Новый & белый');
  assert.equal(product.price, 200);
  assert.equal(product.availability, 'in_stock');
  assert.deepEqual(product.images, []);
  assert.equal(product.translations.ru.url, '/catalog/stulya/new-chair/');
  assert.ok(product.reviewFlags.includes('detail_page_missing'));
  assert.equal(catalog.report.listingOnlyProducts, 1);
});

test('CSV snapshot sets one numeric price everywhere and preserves old URLs on slug change', async (t) => {
  const { siteDir } = await fixture(t);
  const original = await baseline(siteDir);
  const catalog = await normalizeCSV(
    [
      {
        id: '123',
        name_ru: 'Стул новый',
        price: '125,50',
        currency: 'GEL',
        availability: 'on_order',
        path_ru: '/catalog/stulya/new-chair/',
      },
    ],
    { baseline: original, siteDir, now: date },
  );
  const product = catalog.products[0];
  assert.equal(product.price, 125.5);
  assert.equal(product.availability, 'on_order');
  assert.equal(product.translations.ru.title, 'Стул новый');
  assert.equal(product.translations.ru.url, '/catalog/stulya/new-chair/');
  assert.ok(product.legacyUrls.includes('/catalog/stulya/stul/'));
  assert.deepEqual(validateCatalog(catalog), []);
});

test('CSV duplicates and unsafe inputs fail before any valid snapshot is overwritten', async (t) => {
  const { dir, siteDir } = await fixture(t);
  const original = await baseline(siteDir),
    output = path.join(dir, 'catalog.json');
  await writeCatalogAtomic(output, original);
  const before = await readFile(output, 'utf8');
  for (const rows of [
    [{ id: '123' }, { id: '123' }],
    [{ id: '123', price: '125', currency: 'р.' }],
    [{ id: '123', price: '125' }],
    [{ id: '123', image: '/upload/missing.jpg' }],
    [{ id: '123', path_ru: 'https://evil.example/a/' }],
    [{ id: '123', active: 'maybe' }],
  ])
    await assert.rejects(() => normalizeCSV(rows, { baseline: original, siteDir, now: date }));
  const broken = structuredClone(original);
  broken.products.push(structuredClone(broken.products[0]));
  await assert.rejects(() => writeCatalogAtomic(output, broken));
  assert.equal(await readFile(output, 'utf8'), before);
});

test('clean Google Sheets CSV export round-trips multiline text, attributes, IDs and category links', async (t) => {
  const { siteDir } = await fixture(t);
  const original = await baseline(siteDir, [
    row({ description: 'Первая строка\nВторая, с "кавычками"' }),
  ]);
  const csv = exportCatalogCSV(original);
  const restored = await normalizeCSV(parseCSV(csv), { baseline: original, siteDir, now: date });
  assert.deepEqual(restored.products[0].translations, original.products[0].translations);
  assert.deepEqual(restored.products[0].categoryIds, original.products[0].categoryIds);
  assert.equal(restored.products[0].price, 100);
});

test('known damaged test product is retained with evidence but always inactive', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(siteDir, [row({ id: '13538', name: 'ллд', currency: 'р.' })]);
  const product = catalog.products[0];
  assert.equal(product.active, false);
  assert.ok(product.reviewFlags.includes('invalid_title'));
  assert.equal(product.translations.ru.title, 'ллд');
  assert.equal(product.archivedPrices[0].currency, 'р.');
  assert.equal(product.provenance[0].title, 'ллд');
  const imported = await normalizeCSV([{ id: '13538', active: 'TRUE', currency: 'GEL' }], { baseline: catalog, siteDir, now: date });
  assert.equal(imported.products[0].active, false);
  assert.ok(imported.products[0].reviewFlags.includes('invalid_title'));
});

test('test category stays in legacy data and is hidden without disabling its valid products', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await normalizeArchive({ siteDir, now: date, archive: {
    categories: [{ id: 'kresla-test', name: 'Кресла', lang: 'ru', path: '/catalog/kresla-test/' }],
    products: [row({ category: 'kresla-test' })],
  } });
  const category = catalog.categories.find((item) => item.id === 'kresla-test');
  assert.equal(category.hidden, true);
  assert.ok(category.reviewFlags.includes('test_category'));
  assert.ok(category.legacyUrls.includes('/catalog/kresla-test/'));
  assert.equal(catalog.products[0].active, true);
});

test('Google checkbox TRUE/FALSE controls active and omitted active preserves an inactive item', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(siteDir);
  for (const active of ['FALSE', ' false ', false, 'no', '0']) {
    const result = await normalizeCSV([{ id: '123', active }], { baseline: catalog, siteDir, now: date });
    assert.equal(result.products[0].active, false);
    const noColumn = await normalizeCSV([{ id: '123' }], { baseline: result, siteDir, now: date });
    assert.equal(noColumn.products[0].active, false);
  }
  for (const active of ['TRUE', ' true ', true, 'yes', '1']) {
    const result = await normalizeCSV([{ id: '123', active }], { baseline: catalog, siteDir, now: date });
    assert.equal(result.products[0].active, true);
  }
  const rows = parseCSV(exportCatalogCSV(await normalizeCSV([{ id: '123', active: 'FALSE' }], { baseline: catalog, siteDir, now: date })));
  assert.equal(rows[0].active, 'no');
});

test('schema detects URL collisions and category cycles', async (t) => {
  const { siteDir } = await fixture(t);
  const catalog = await baseline(siteDir, [
    row({}),
    row({ id: '456', path: '/catalog/stulya/other/' }),
  ]);
  catalog.products[1].legacyUrls.push('/catalog/stulya/stul/');
  catalog.categories[0].parentId = catalog.categories[0].id;
  const errors = validateCatalog(catalog);
  assert.ok(errors.some((error) => error.includes('belongs to both')));
  assert.ok(errors.some((error) => error.includes('cycle')));
});
