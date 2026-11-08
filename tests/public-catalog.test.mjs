import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCatalog } from '../scripts/public-catalog.mjs';

test('public payload excludes archive evidence while retaining display and server validation fields', () => {
  const source = {
    generatedAt: '2026-11-07', sourceReport: { internal: 'private-report' },
    categories: [{ id: 'sofas', slug: 'sofas', parentId: null, sourceReport: 'internal', translations: { ru: { title: 'Диваны', url: '/catalog/sofas/', description: 'internal-category-description' } } }],
    products: [{ id: 'p1', sku: '001', categoryIds: ['sofas'], active: false,
      price: 120, currency: 'GEL', availability: 'unknown', priceEvidence: 'internal-price-evidence', imageCandidates: ['unconfirmed-image'],
      translations: { ru: { title: 'Точное название', url: '/catalog/sofas/p1/', summary: '<p>Краткое описание</p>', description: 'internal-long-description', attributes: [{ name: 'Ширина', value: '120 см', source: 'internal-attribute-evidence' }] } },
      images: [{ src: '/images/p1.webp', alt: 'Диван', source: 'internal-image-evidence' }],
      variants: [{ id: 'v1', active: true, sku: 'v-001', title: 'Серый', price: 120, availability: 'on_order', priceEvidence: 'internal-variant-evidence' }],
    }],
  };
  const output = publicCatalog(source);
  const text = JSON.stringify(output);
  assert.doesNotMatch(text, /internal-|sourceReport|priceEvidence|imageCandidates|description/);
  assert.equal(output.products[0].translations.ru.title, 'Точное название');
  assert.equal(output.products[0].translations.ru.summary, 'Краткое описание');
  assert.equal(output.products[0].active, false);
  assert.equal(output.products[0].price, 120);
  assert.deepEqual(output.products[0].translations.ru.attributes, [{ name: 'Ширина', value: '120 см' }]);
  assert.deepEqual(output.products[0].images, [{ src: '/images/p1.webp', alt: 'Диван' }]);
  assert.equal(output.products[0].variants[0].id, 'v1');
  assert.equal(source.products[0].translations.ru.description, 'internal-long-description');
});

test('client summaries are bounded without shortening exact product titles', () => {
  const title = 'Model '.repeat(100);
  const result = publicCatalog({ categories: [], products: [{ id: 'p', categoryIds: [], translations: { en: { title, summary: 'word '.repeat(1000) } } }] });
  assert.equal(result.products[0].translations.en.title, title);
  assert.equal(result.products[0].translations.en.summary.length, 320);
});

test('test categories and their public filter links are excluded without changing source', () => {
  const source = { categories: [{ id: 'real', slug: 'real', translations: {} }, { id: 'test', slug: 'test', hidden: true, translations: {} }], products: [{ id: 'p', categoryIds: ['test', 'real'], translations: {} }] };
  const result = publicCatalog(source);
  assert.deepEqual(result.categories.map((category) => category.id), ['real']);
  assert.deepEqual(result.products[0].categoryIds, ['real']);
  assert.deepEqual(source.products[0].categoryIds, ['test', 'real']);
});
