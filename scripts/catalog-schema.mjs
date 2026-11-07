/** Shared, dependency-free contract for the published catalog. */
export const SCHEMA_VERSION = 1;
export const LANGUAGES = ['ru', 'en', 'ka'];
export const AVAILABILITIES = ['in_stock', 'on_order', 'out_of_stock', 'unknown'];

export function normalizeSitePath(value) {
  if (!value) return '';
  let raw = String(value).trim();
  if (/[\\\u0000-\u001f]/.test(raw)) throw new Error(`Unsafe site path: ${raw}`);
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!['simal.ge', 'www.simal.ge'].includes(url.hostname))
      throw new Error(`Foreign site URL: ${raw}`);
    raw = url.pathname;
  }
  if (!raw.startsWith('/') || raw.startsWith('//'))
    throw new Error(`Expected an absolute site path: ${raw}`);
  const path = raw.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`Invalid URL encoding: ${raw}`);
  }
  if (
    decoded.split('/').some((part) => part === '.' || part === '..') ||
    /[\\\u0000-\u001f]/.test(decoded)
  ) {
    throw new Error(`Unsafe site path: ${raw}`);
  }
  return path.replace(/\/{2,}/g, '/');
}

export function normalizePagePath(value) {
  const path = normalizeSitePath(value);
  if (!path) return '';
  const clean = path.replace(/index\.html$/i, '');
  return /\.[a-z0-9]+$/i.test(clean) ? clean : clean.replace(/\/?$/, '/');
}

export function parsePrice(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0 && value <= 1_000_000_000) return value;
    throw new Error(`Invalid price: ${value}`);
  }
  let text = String(value)
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '');
  // A comma is a decimal separator unless a dot is also present. Ambiguous
  // thousands notation (1,234) must be written as 1234 in the sheet.
  if (text.includes(',') && text.includes('.')) {
    if (!/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(text)) throw new Error(`Ambiguous price: ${value}`);
    text = text.replace(/,/g, '');
  } else {
    text = text.replace(',', '.');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error(`Invalid price: ${value}`);
  return parsePrice(Number(text));
}

export function normalizeCurrency(value) {
  return /^(GEL|₾|лари|ლარი)$/i.test(String(value || '').trim()) ? 'GEL' : null;
}

export function normalizeAvailability(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (AVAILABILITIES.includes(text)) return text;
  if (/^(в наличии|in stock|მარაგშია)$/.test(text)) return 'in_stock';
  if (/^(под заказ|на заказ|on order|preorder|შეკვეთით)$/.test(text)) return 'on_order';
  if (/^(нет в наличии|out of stock|unavailable|არ არის მარაგში)$/.test(text))
    return 'out_of_stock';
  return 'unknown';
}

export function validateCatalog(catalog) {
  const errors = [];
  if (catalog?.schemaVersion !== SCHEMA_VERSION) errors.push('Unsupported catalog schemaVersion');
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  if (!categories.length) errors.push('Catalog must contain categories');
  if (!products.length) errors.push('Catalog must contain products');
  const categoryIds = new Set();
  const productIds = new Set();
  const urlOwners = new Map();
  function page(value, owner) {
    if (!value) return;
    try {
      if (normalizePagePath(value) !== value) errors.push(`${owner}: non-normalized URL ${value}`);
      const previous = urlOwners.get(value);
      if (previous && previous !== owner)
        errors.push(`URL ${value} belongs to both ${previous} and ${owner}`);
      urlOwners.set(value, owner);
    } catch (error) {
      errors.push(`${owner}: ${error.message}`);
    }
  }
  for (const category of categories) {
    if (category.hidden !== undefined && typeof category.hidden !== 'boolean') errors.push(`Category ${category.id}: hidden must be boolean`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(category.id || ''))
      errors.push(`Invalid category id ${category.id}`);
    if (categoryIds.has(category.id)) errors.push(`Duplicate category id ${category.id}`);
    categoryIds.add(category.id);
    for (const url of category.legacyUrls || []) page(url, `category:${category.id}`);
    for (const copy of Object.values(category.translations || {}))
      page(copy.url, `category:${category.id}`);
  }
  for (const category of categories) {
    if (category.parentId && !categoryIds.has(category.parentId))
      errors.push(`Unknown parent ${category.parentId}`);
    let current = category;
    const visited = new Set();
    while (current?.parentId) {
      if (visited.has(current.id)) {
        errors.push(`Category cycle at ${category.id}`);
        break;
      }
      visited.add(current.id);
      current = categories.find((item) => item.id === current.parentId);
    }
  }
  for (const product of products) {
    const owner = `product:${product.id}`;
    if (typeof product.id !== 'string' || !/^[\w-]{1,100}$/.test(product.id))
      errors.push(`Invalid product id ${product.id}`);
    if (productIds.has(product.id)) errors.push(`Duplicate product id ${product.id}`);
    productIds.add(product.id);
    if (product.currency !== 'GEL') errors.push(`${owner}: currency must be GEL`);
    if (product.price !== null) {
      try {
        if (parsePrice(product.price) !== product.price)
          errors.push(`${owner}: price must be numeric`);
      } catch (error) {
        errors.push(`${owner}: ${error.message}`);
      }
    }
    if (!AVAILABILITIES.includes(product.availability))
      errors.push(`${owner}: invalid availability`);
    if (typeof product.active !== 'boolean') errors.push(`${owner}: active must be boolean`);
    if (!Array.isArray(product.categoryIds) || !product.categoryIds.length)
      errors.push(`${owner}: category required`);
    for (const id of product.categoryIds || [])
      if (!categoryIds.has(id)) errors.push(`${owner}: unknown category ${id}`);
    if (!LANGUAGES.some((lang) => product.translations?.[lang]?.title?.trim()))
      errors.push(`${owner}: title required`);
    for (const [lang, copy] of Object.entries(product.translations || {})) {
      if (!LANGUAGES.includes(lang)) errors.push(`${owner}: unsupported language ${lang}`);
      if (!Array.isArray(copy.attributes)) errors.push(`${owner}: attributes must be an array`);
      page(copy.url, owner);
    }
    for (const url of product.legacyUrls || []) page(url, owner);
    if (!Array.isArray(product.images)) errors.push(`${owner}: images must be an array`);
    for (const image of product.images || []) {
      try {
        const src = normalizeSitePath(image.src);
        if (!src || !/\.(avif|webp|png|jpe?g|gif)$/i.test(src))
          errors.push(`${owner}: invalid image ${image.src}`);
      } catch (error) {
        errors.push(`${owner}: ${error.message}`);
      }
    }
    if (!Array.isArray(product.variants)) errors.push(`${owner}: variants must be an array`);
  }
  return errors;
}

export function assertCatalog(catalog) {
  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error(`Catalog validation failed:\n${errors.join('\n')}`);
  return catalog;
}
