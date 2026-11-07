import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const catalog = JSON.parse(fs.readFileSync(new URL('../data/normalized-catalog.json', import.meta.url), 'utf8'));
const review = JSON.parse(fs.readFileSync(new URL('../data/translations-reviewed-ka.json', import.meta.url), 'utf8'));
const numbers = (text) => String(text).match(/\d+(?:[.,]\d+)?/g) ?? [];

test('Georgian review covers factual existing titles and preserves model measurements', () => {
  assert.equal(review.language, 'ka');
  assert.equal(Object.keys(review.products).length, 255);
  assert.equal(Object.keys(review.categories).length, 37);
  assert.equal(review.products['13538'], undefined);
  for (const [id, entry] of Object.entries(review.products)) {
    const source = catalog.products.find((product) => product.id === id);
    assert.ok(source, id);
    assert.ok(/[\u10a0-\u10ff]/u.test(entry.title), id);
    assert.deepEqual(numbers(entry.title), numbers(source.translations.ru.title), `Title dimensions/model code: ${id}`);
    assert.doesNotMatch(entry.title, /ბანკეტი|ორსაძინებელი|прикроват|угловой|компьютерный|\d\s*(?:см|мм|кг)/i, id);
    if (entry.attributes) {
      assert.equal(entry.attributes.length, source.translations.ka.attributes.length, id);
      entry.attributes.forEach((attribute, index) => {
        assert.deepEqual(numbers(attribute.value), numbers(source.translations.ka.attributes[index].value), `Attribute values: ${id}/${index}`);
        assert.doesNotMatch(attribute.name + ' ' + attribute.value, /[а-яё]/i, id);
      });
    }
  }
});

test('bench and topper terminology follows the factual source and completed descriptions are real sentences', () => {
  assert.match(review.products['10530'].title, /^ბენჩი /);
  assert.match(review.products['9771'].title, /^ტოპერი /);
  for (const id of ['9771', '10381', '10382', '10383', '10668', '10669', '10670', '10694']) {
    assert.match(catalog.products.find((product) => product.id === id).translations.ru.description, /топпер/i);
    assert.match(review.products[id].title, /^ტოპერი /);
  }
  assert.match(review.products['13514'].title, /დამცავი/);
  assert.equal(review.products['11922'].attributes.find((attribute) => attribute.name === 'ფეხების სიმაღლე').value, '12 სმ');
  assert.equal(review.products['13182'].attributes.find((attribute) => attribute.name === 'გვერდითი ჩარჩოს სიმაღლე').value, '375 მმ');
  for (const id of ['10530', '10532', '13447']) {
    assert.ok(review.products[id].description.endsWith('.'));
    assert.ok(review.products[id].summary.endsWith('.'));
    assert.doesNotMatch(review.products[id].description, /ბანკეტი|არასწორ მიზანს|კომფორტსა და კომფორტს/);
  }
});
