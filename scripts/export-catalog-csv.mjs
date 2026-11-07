import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCatalog, LANGUAGES } from './catalog-schema.mjs';

export function exportCatalogCSV(catalog) {
  assertCatalog(catalog);
  const columns = [
    'id',
    'active',
    'sku',
    'price',
    'currency',
    'availability',
    'category_ids',
    'images',
    ...LANGUAGES.flatMap((lang) => [
      `category_${lang}`,
      `name_${lang}`,
      `description_${lang}`,
      `summary_${lang}`,
      `specs_${lang}`,
      `path_${lang}`,
    ]),
  ];
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = catalog.products.map((product) => {
    const category = catalog.categories.find((item) => item.id === product.categoryIds[0]);
    const row = {
      id: product.id,
      active: product.active ? 'yes' : 'no',
      sku: product.sku,
      price: product.price ?? '',
      currency: 'GEL',
      availability: product.availability,
      category_ids: product.categoryIds.join(' | '),
      images: product.images.map((image) => image.src).join(' | '),
    };
    for (const lang of LANGUAGES) {
      const copy = product.translations[lang];
      Object.assign(row, {
        [`category_${lang}`]: category?.translations[lang]?.title || '',
        [`name_${lang}`]: copy?.title || '',
        [`description_${lang}`]: copy?.description || '',
        [`summary_${lang}`]: copy?.summary || '',
        [`specs_${lang}`]: JSON.stringify(copy?.attributes || []),
        [`path_${lang}`]: copy?.url || '',
      });
    }
    return columns.map((key) => escape(row[key])).join(',');
  });
  return '\uFEFF' + [columns.join(','), ...rows].join('\r\n') + '\r\n';
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output'))
    throw new Error('Usage: node scripts/export-catalog-csv.mjs [--output path.csv]');
  const catalog = JSON.parse(
    await readFile(path.join(root, 'data/normalized-catalog.json'), 'utf8'),
  );
  const csv = exportCatalogCSV(catalog);
  if (args[1]) await writeFile(path.resolve(args[1]), csv, 'utf8');
  else process.stdout.write(csv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
