import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function auditEnglish(catalog) {
  const rows = catalog.products.filter(product => product.translations?.en?.title).map(product => {
    const copy = product.translations.en;
    const issues = [];
    if (/\bbanquet\b|wrong purpose|purposeonly|onlyonly|rawer|bedside table bedside|sports hall/i.test([copy.title, copy.summary, copy.description].join(' '))) issues.push('suspicious_translation');
    if (/\b(cm|mm)\b/i.test(copy.title) && /\b(1600|1800|1400|900)\b/.test(copy.title)) issues.push('check_model_vs_dimension');
    if (/[А-Яа-яЁё]/.test(copy.title.replace(/МДК[\d\s.-]*/g, ''))) issues.push('cyrillic_title');
    if ((copy.attributes || []).some(attribute => /[А-Яа-яЁё]/.test(attribute.value) || /[А-Яа-яЁё]/.test(attribute.name))) issues.push('untranslated_attribute');
    return { id: product.id, active: product.active, title: copy.title, sourceTitle: product.translations.ru?.title || '', issues, description: copy.description, summary: copy.summary, attributes: copy.attributes };
  });
  return { productsWithEnglish: rows.length, productsWithDescription: rows.filter(row => row.description).length, productsWithIssues: rows.filter(row => row.issues.length).length, rows };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(await readFile(path.join(root, 'data/normalized-catalog.json'), 'utf8'));
  const audit = auditEnglish(catalog);
  const mode = process.argv[2] || 'summary';
  if (process.argv[3]) audit.rows = audit.rows.filter(row => process.argv[3].split(',').includes(row.id));
  if (mode === 'titles') for (const row of audit.rows) console.log(`${row.id}\t${row.title}\t${row.sourceTitle}`);
  else if (mode === 'descriptions') for (const row of audit.rows.filter(row => row.description)) console.log(JSON.stringify(row));
  else if (mode === 'issues') for (const row of audit.rows.filter(row => row.issues.length)) console.log(JSON.stringify(row));
  else if (mode === 'source') for (const row of audit.rows) console.log(JSON.stringify({ id: row.id, en: row, ru: catalog.products.find(product => product.id === row.id).translations.ru }));
  else if (mode === 'stats') for (const row of audit.rows.filter(row => row.description)) console.log(JSON.stringify({ id: row.id, title: row.title, length: row.description.length, sourceLength: catalog.products.find(product => product.id === row.id).translations.ru.description.length, excerpt: row.description.slice(0, 140) }));
  else if (mode === 'vocabulary') console.log(JSON.stringify({ names: [...new Set(catalog.products.flatMap(product => product.translations.ru.attributes.map(attribute => attribute.name)))].sort(), values: [...new Set(catalog.products.flatMap(product => product.translations.ru.attributes.map(attribute => attribute.value)).filter(value => /[А-Яа-яЁё]/.test(value) && !/^\d+[\d\s.,xх×*/–-]*(см|мм|кг|м|лет|месяцев)?\.?$/i.test(value)))].sort() }, null, 2));
  else console.log(JSON.stringify({ productsWithEnglish: audit.productsWithEnglish, productsWithDescription: audit.productsWithDescription, productsWithIssues: audit.productsWithIssues }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
