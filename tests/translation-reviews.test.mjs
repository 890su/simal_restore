import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyTranslationReviews } from '../scripts/apply-translation-reviews.mjs';
import { runImport } from '../scripts/import-catalog.mjs';

function fixture() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-07T00:00:00.000Z',
    categories: [{ id: 'beds', slug: 'beds', parentId: null, translations: { ru: { title: 'Кровати', url: '/catalog/beds/' }, en: { title: 'Beds', url: '' }, ka: { title: '', url: '' } }, legacyUrls: ['/catalog/beds/'] }],
    products: [{ id: '123', sku: 'MODEL-1400', active: true, categoryIds: ['beds'], currency: 'GEL', price: 100,
      availability: 'unknown', images: [], variants: [], reviewFlags: ['translation_unverified_en'], legacyUrls: ['/catalog/beds/123/'],
      translations: {
        ru: { title: 'Кровать MODEL 1400', description: 'Описание', summary: '', url: '/catalog/beds/123/', attributes: [] },
        en: { title: 'Bed MODEL 1600', description: 'A readable original description.', summary: '', url: '', attributes: [] },
        ka: { title: '', description: '', summary: '', url: '', attributes: [] },
      } }],
    report: {},
  };
}
const review = products => ({ schemaVersion: 1, language: 'en', reviewedAt: '2026-11-07', products });

test('review changes only permitted translation fields and keeps stable identity and commercial values', () => {
  const input = fixture();
  const output = applyTranslationReviews(input, [review({ '123': { title: 'Bed MODEL 1400', reviewNote: 'Internal note must not enter public product.' } })]);
  assert.equal(output.products[0].translations.en.title, 'Bed MODEL 1400');
  assert.equal(input.products[0].translations.en.title, 'Bed MODEL 1600');
  assert.equal(output.products[0].id, '123');
  assert.equal(output.products[0].sku, 'MODEL-1400');
  assert.equal(output.products[0].price, 100);
  assert.ok(!JSON.stringify(output).includes('Internal note'));
});

test('a title-only review remains partial until every populated field is explicitly checked', () => {
  const partial = applyTranslationReviews(fixture(), [review({ '123': { title: 'Bed MODEL 1400' } })]);
  assert.ok(partial.products[0].reviewFlags.includes('translation_unverified_en'));
  assert.ok(partial.products[0].reviewFlags.includes('translation_review_partial_en'));
  const complete = applyTranslationReviews(fixture(), [review({ '123': { title: 'Bed MODEL 1400', reviewedFields: ['title', 'description'] } })]);
  assert.ok(!complete.products[0].reviewFlags.includes('translation_unverified_en'));
  assert.ok(complete.products[0].reviewFlags.includes('translation_reviewed_en'));
});

test('invalid IDs, language, duplicate language docs and commercial overrides are rejected', () => {
  for (const document of [review({ unknown: { title: 'Test' } }), review({ '123': { price: 1 } }), { ...review({}), language: 'xx' }, review({ '123': { reviewedFields: ['made_up'] } })]) {
    assert.throws(() => applyTranslationReviews(fixture(), [document]));
  }
  assert.throws(() => applyTranslationReviews(fixture(), [review({}), review({})]), /Duplicate review/);
});

test('prepared language URLs are stable and never generated without a title or for invalid inactive records', () => {
  const input = fixture();
  const invalid = structuredClone(input.products[0]);
  invalid.id = '13538'; invalid.active = false; invalid.legacyUrls = []; invalid.reviewFlags = ['invalid_title'];
  invalid.translations.ru.url = '/catalog/beds/invalid/';
  input.products.push(invalid);
  const output = applyTranslationReviews(input, []);
  assert.equal(output.products[0].translations.en.url, '/en/product/123/');
  assert.equal(output.products[0].translations.ka.url, '');
  assert.equal(output.products[1].translations.en.url, '');
  assert.equal(output.categories[0].translations.en.url, '/en/catalog/beds/');
  assert.equal(output.report.translations.en.urls, 1);
});

test('category review fills the checked title, preserves old routes and rejects unknown categories', () => {
  const document = { ...review({}), categories: { beds: { title: 'Beds and bed frames' } } };
  const output = applyTranslationReviews(fixture(), [document]);
  assert.equal(output.categories[0].translations.en.title, 'Beds and bed frames');
  assert.deepEqual(output.categories[0].legacyUrls, ['/catalog/beds/']);
  assert.throws(() => applyTranslationReviews(fixture(), [{ ...review({}), categories: { unknown: { title: 'Test' } } }]), /unknown category/);
});

test('review application is idempotent including metadata and preserves explicit existing canonical URLs', () => {
  const input = fixture();
  input.products[0].translations.en.url = '/en/catalog/beds/model/';
  const documents = [review({ '123': { title: 'Bed MODEL 1400', reviewedFields: ['title', 'description'] } })];
  const first = applyTranslationReviews(input, documents);
  assert.equal(first.products[0].translations.en.url, '/en/catalog/beds/model/');
  assert.deepEqual(applyTranslationReviews(first, documents), first);
});

test('prepared URLs cannot silently collide with another product', () => {
  const input = fixture();
  const other = structuredClone(input.products[0]);
  other.id = '456'; other.legacyUrls = []; other.translations.ru.url = '/catalog/beds/456/'; other.translations.en.url = '/en/product/123/';
  input.products.push(other);
  assert.throws(() => applyTranslationReviews(input, []), /belongs to both/);
});

test('Google Sheets text stays authoritative while missing locale URLs are still prepared', () => {
  const input = fixture();
  input.source = { type: 'csv', location: 'owner-sheet.csv' };
  input.products[0].translations.en.title = 'Owner edited title';
  input.categories[0].translations.en.title = 'Owner category';
  const document = { ...review({ '123': { title: 'Old archival title' }, deletedProduct: { title: 'Removed product' } }), categories: { beds: { title: 'Old category title' } } };
  const output = applyTranslationReviews(input, [document]);
  assert.equal(output.products[0].translations.en.title, 'Owner edited title');
  assert.equal(output.categories[0].translations.en.title, 'Owner category');
  assert.equal(output.products[0].translations.en.url, '/en/product/123/');
  assert.equal(output.report.translationReviews.en.skipped, 'csv_source_authoritative');
});

test('checked English overrides fix mismatched models, dimensions and bench translation without adding missing prose', async () => {
  const document = JSON.parse(await readFile(new URL('../data/translations-reviewed-en.json', import.meta.url), 'utf8'));
  assert.equal(document.products['9758'].title, 'Bed ODRI 1600');
  assert.equal(document.products['9759'].title, 'Bed PRIMA 1400 with a lift mechanism');
  assert.equal(document.products['9789'].title, 'Pillow LUX');
  assert.ok(!/topper|160×200/.test(document.products['9789'].description));
  assert.equal(document.products['10364'].title, 'Chest of drawers SIRIUS 4 (white)');
  assert.ok(document.products['10532'].description.includes('bench'));
  assert.ok(!/banquet|wrong purpose/.test(document.products['10532'].description));
  assert.deepEqual(document.products['9759'].attributes.find(attribute => attribute.name === 'Sleeping area'), { name: 'Sleeping area', value: '140×200 cm' });
  assert.equal(document.products['9756'].description, undefined);
  assert.equal(document.products['13538'], undefined);
  assert.equal(document.categories['banketki-i-pufy'].title, 'Benches and ottomans');
  const catalog = await runImport({ archive: true, check: true });
  for (const product of catalog.products) {
    const override = document.products[product.id];
    if (!override || !product.translations.ru.title) continue;
    assert.deepEqual(override.title.match(/\d+(?:\.\d+)?/g), product.translations.ru.title.match(/\d+(?:\.\d+)?/g), `Numeric model/size tokens changed for ${product.id}`);
  }
});
