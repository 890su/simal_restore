import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveSource, normalizeArchive, normalizeCSV, runImport } from '../scripts/import-catalog.mjs';

const config = {
  schemaVersion: 1, enabled: true, spreadsheetId: '1public_sheet_identifier', gid: '391044452',
  csvUrl: 'https://docs.google.com/spreadsheets/d/1public_sheet_identifier/export?format=csv&gid=391044452',
};

test('explicit source beats environment and config; environment beats enabled config', () => {
  assert.deepEqual(resolveSource({ source: 'local.csv', env: { CATALOG_CSV_URL: 'https://example.test/env.csv' }, config }), { source: 'local.csv', selectedBy: 'argument' });
  assert.deepEqual(resolveSource({ env: { CATALOG_CSV_URL: ' https://example.test/env.csv ' }, config }), { source: 'https://example.test/env.csv', selectedBy: 'environment' });
  assert.equal(resolveSource({ env: {}, config }).selectedBy, 'config');
});

test('enabled public Google config is selected without any secret or environment variable', () => {
  assert.equal(resolveSource({ env: {}, config }).source, config.csvUrl);
  assert.equal(resolveSource({ env: { CATALOG_CSV_URL: '   ' }, config }).selectedBy, 'config');
  assert.deepEqual(resolveSource({ env: {}, config: { ...config, enabled: false } }), { source: undefined, selectedBy: 'archive-fallback' });
  assert.equal(resolveSource({ env: {} }).selectedBy, 'archive-fallback');
});

test('archive is an explicit offline bypass even with configured environment and invalid config', () => {
  assert.deepEqual(resolveSource({ archive: true, env: { CATALOG_CSV_URL: 'https://example.test/env.csv' }, config: { enabled: true } }), { source: undefined, selectedBy: 'archive-flag' });
  assert.throws(() => resolveSource({ archive: true, source: 'local.csv', env: {} }), /cannot be used together/);
});

test('public config rejects HTTP, credentials, secret parameters and mismatched sheet identity', () => {
  for (const csvUrl of [
    config.csvUrl.replace('https:', 'http:'),
    config.csvUrl.replace('https://', 'https://user:password@'),
    config.csvUrl + '&access_token=secret',
    config.csvUrl.replace('gid=391044452', 'gid=1'),
    config.csvUrl.replace('1public_sheet_identifier/export', 'another_sheet/export'),
    'https://evil.example/export?format=csv&gid=391044452',
  ]) assert.throws(() => resolveSource({ env: {}, config: { ...config, csvUrl } }));
  assert.throws(() => resolveSource({ env: {}, config: { ...config, enabled: 'true' } }));
  assert.throws(() => resolveSource({ env: {}, source: '' }));
});

async function categoryFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'simal-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'data'));
  await mkdir(path.join(root, 'site'));
  const archive = { categories: [{ id: 'chairs', name: 'Стулья', lang: 'ru', path: '/catalog/chairs/' }], products: [
    { id: '123', name: 'Стул', lang: 'ru', category: 'chairs', path: '/catalog/chairs/123/', price: '10', currency: 'GEL' },
    { id: '456', name: 'Стул 2', lang: 'ru', category: 'chairs', path: '/catalog/chairs/456/', price: '20', currency: 'GEL' },
  ] };
  const baseline = await normalizeArchive({ archive, siteDir: path.join(root, 'site') });
  baseline.categories[0].translations.en = { title: 'Reviewed chairs', url: '/en/catalog/chairs/' };
  baseline.categories[0].translations.ka = { title: 'Reviewed KA label', url: '/ge/catalog/chairs/' };
  const nested = structuredClone(baseline.categories[0]);
  nested.id = 'chairs-dining'; nested.slug = 'dining'; nested.parentId = 'chairs'; nested.legacyUrls = [];
  nested.translations = { ru: { title: 'Обеденные стулья', url: '/catalog/chairs/dining/' }, en: { title: 'Reviewed dining chairs', url: '/en/catalog/dining-chairs/' }, ka: { title: '', url: '' } };
  baseline.categories.push(nested);
  baseline.products[0].categoryIds.push(nested.id);
  return { root, archive, baseline };
}

test('CSV edits primary category labels while preserving nested labels, other locales and old URLs', async t => {
  const { root, baseline } = await categoryFixture(t);
  const result = await normalizeCSV([{ id: '123', category_ids: 'chairs | chairs-dining', category_ru: 'Стулья новые', category_en: 'Owner seating', price: '10', currency: 'GEL' }], { baseline, siteDir: path.join(root, 'site') });
  const category = result.categories.find(item => item.id === 'chairs');
  assert.equal(category.translations.en.title, 'Owner seating');
  assert.equal(category.translations.ka.title, 'Reviewed KA label');
  assert.equal(category.translations.en.url, '/en/catalog/chairs/');
  assert.equal(result.categories.find(item => item.id === 'chairs-dining').translations.en.title, 'Reviewed dining chairs');
});

test('conflicting repeated category labels abort a CSV snapshot', async t => {
  const { root, baseline } = await categoryFixture(t);
  const rows = [{ id: '123', category_ids: 'chairs', category_en: 'Chairs' }, { id: '456', category_ids: 'chairs', category_en: 'Seats' }];
  await assert.rejects(() => normalizeCSV(rows, { baseline, siteDir: path.join(root, 'site') }), /inconsistent en title/);
  rows[1].category_en = 'Chairs';
  const result = await normalizeCSV(rows, { baseline, siteDir: path.join(root, 'site') });
  assert.equal(result.categories.find(item => item.id === 'chairs').translations.en.title, 'Chairs');
});

test('real importer reads last validated category snapshot and check mode never overwrites it', async t => {
  const { root, archive, baseline } = await categoryFixture(t);
  await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify(archive));
  const previous = JSON.stringify(baseline);
  await writeFile(path.join(root, 'data/normalized-catalog.json'), previous);
  const csvFile = path.join(root, 'source.csv');
  await writeFile(csvFile, 'id,price,currency,category_ids\n123,10,GEL,chairs | chairs-dining\n456,20,GEL,chairs\n');
  const result = await runImport({ root, source: csvFile, env: {}, check: true });
  assert.equal(result.source.type, 'csv');
  assert.equal(result.source.selectedBy, 'argument');
  assert.equal(result.categories.find(item => item.id === 'chairs').translations.en.title, 'Reviewed chairs');
  assert.equal(result.categories.find(item => item.id === 'chairs-dining').translations.en.title, 'Reviewed dining chairs');
  assert.equal(await readFile(path.join(root, 'data/normalized-catalog.json'), 'utf8'), previous);
  await assert.rejects(() => runImport({ root, source: path.join(root, 'does-not-exist.csv'), env: {} }));
  assert.equal(await readFile(path.join(root, 'data/normalized-catalog.json'), 'utf8'), previous);
});
