/** Public UI/API payload. Keep restoration evidence and source reports server-side. */
const LANGUAGES = ['ru', 'en', 'ka'];
const image = ({ src, alt }) => ({ src, alt: alt ?? '' });
const attributes = (values) => (values ?? []).map(({ name, value }) => ({ name, value }));

function translations(source, product = false) {
  return Object.fromEntries(LANGUAGES.filter((lang) => source?.[lang]).map((lang) => {
    const entry = source[lang];
    return [lang, product ? {
      title: entry.title,
      summary: (entry.summary ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320),
      url: entry.url ?? '',
      attributes: attributes(entry.attributes),
    } : { title: entry.title, url: entry.url ?? '' }];
  }));
}

export function publicCatalog(source) {
  const categories = source.categories.filter((category) => !category.hidden);
  const categoryIds = new Set(categories.map((category) => category.id));
  return {
    schemaVersion: 1,
    generatedAt: source.generatedAt,
    categories: categories.map((category) => ({
      id: category.id, slug: category.slug, parentId: category.parentId,
      translations: translations(category.translations),
    })),
    products: source.products.map((product) => ({
      id: product.id, sku: product.sku, categoryIds: product.categoryIds.filter((id) => categoryIds.has(id)),
      translations: translations(product.translations, true),
      price: product.price, currency: product.currency, availability: product.availability,
      images: (product.images ?? []).map(image),
      variants: (product.variants ?? []).map((variant) => ({
        id: variant.id, sku: variant.sku,
        title: variant.title, price: variant.price, availability: variant.availability,
        attributes: attributes(variant.attributes),
        images: (variant.images ?? []).map(image), active: variant.active,
      })),
      active: product.active,
    })),
  };
}
