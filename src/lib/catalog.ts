import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Catalog, Category, ContentPage, Language, Product, Route } from './types';
import { basePath, infoPath, localePath, messages } from './i18n.ts';

export const catalog: Catalog = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/normalized-catalog.json'), 'utf8'),
);
export const contentPages: ContentPage[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/pages.json'), 'utf8'),
).pages;
export const products = catalog.products.filter((p) => p.active);
export function productsForLanguage(lang: Language) {
  return products.filter((product) => Boolean(product.translations[lang]?.title));
}
const categoryOrder = [
  'myagkaya-mebel',
  'krovati',
  'matrasy',
  'shkafy',
  'komody',
  'stoly',
  'stelazhi',
  'prikrovatnye-tumby',
];
export const categories = catalog.categories
  .filter((c) => !c.hidden && products.some((p) => p.categoryIds.includes(c.id)))
  .sort((a, b) => {
    const x = categoryOrder.indexOf(a.id),
      y = categoryOrder.indexOf(b.id);
    return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
  });
export function textFor(product: Product, lang: Language) {
  return (
    product.translations[lang] ??
    product.translations.ru ??
    product.translations.en ??
    product.translations.ka ?? { title: product.sku || product.id }
  );
}
export function categoryTitle(category: Category, lang: Language) {
  return category.translations[lang]?.title || category.translations.ru?.title || category.slug;
}
export function productUrl(product: Product, lang: Language) {
  return (
    textFor(product, lang).url ||
    product.translations.ru?.url ||
    product.translations.en?.url ||
    product.translations.ka?.url ||
    `/product/${encodeURIComponent(product.id)}/`
  );
}
export function categoryUrl(category: Category, lang: Language) {
  return category.translations[lang]?.url || `${localePath(lang, 'catalog')}${category.slug}/`;
}
export function categoryProducts(category: Category, lang?: Language) {
  return (lang ? productsForLanguage(lang) : products).filter((p) => p.categoryIds.includes(category.id));
}
export function excerpt(value: string | undefined, max = 160) {
  const text = (value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}
export function routeAlternates(product: Product) {
  return (['ru', 'en', 'ka'] as const).flatMap((lang) =>
    product.translations[lang]?.url ? [{ lang, path: product.translations[lang]!.url! }] : [],
  );
}
function duplicateMetadata(routes: Route[], field: 'title' | 'description') {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const route of routes) {
    if (route.noindex) continue;
    const value = route[field];
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function productSeoDetail(product: Product, lang: Language) {
  const attributes = product.translations[lang]?.attributes ?? [];
  for (const pattern of [
    /^(спальное место|sleeping area|საძილე ადგილი)$/i,
    /^(размеры?|dimensions|size|ზომები|ზომა)$/i,
    /^(ширина|width|სიგანე)$/i,
    /^(цвет|colou?r|ფერი)$/i,
  ]) {
    const value = attributes.find(({ name }) => pattern.test(name.trim()))?.value.trim();
    if (value && value.length <= 28) return value;
  }
}

export function getRoutes(): Route[] {
  const routes = new Map<string, Route>();
  const add = (route: Route) => {
    if (!routes.has(route.path)) routes.set(route.path, route);
  };
  for (const lang of ['ru', 'en', 'ka'] as const) {
    const t = messages(lang);
    const common = { lang };
    const alts = (['ru', 'en', 'ka'] as const).map((l) => ({ lang: l, path: basePath(l) }));
    add({
      ...common,
      path: basePath(lang),
      kind: 'home',
      title:
        lang === 'ru'
          ? 'Мебель в Тбилиси и Батуми — диваны, кровати, матрасы | SIMAL'
          : `${t.heroEyebrow} — ${t.catalog}`,
      description: t.heroText,
      alternates: alts,
    });
    for (const kind of ['catalog', 'favorites', 'cart', 'search'] as const)
      add({
        ...common,
        path: localePath(lang, kind),
        kind,
        title: `${t[kind]} | SIMAL`,
        description: kind === 'catalog' ? t.catalogIntro : t.requestHelp,
        noindex: kind !== 'catalog',
        alternates: (['ru', 'en', 'ka'] as const).map((l) => ({
          lang: l,
          path: localePath(l, kind),
        })),
      });
    for (const kind of ['promotions', 'news'] as const)
      add({
        ...common,
        path: infoPath(lang, kind),
        kind,
        title: `${t[kind]} | SIMAL`,
        description: t[kind],
        noindex: true,
      });
    for (const category of categories) {
      const title = categoryTitle(category, lang);
      const sofaBeds = category.id === 'myagkaya-mebel-divan-krovati';
      add({
        ...common,
        path: categoryUrl(category, lang),
        kind: 'category',
        category,
        title: sofaBeds ? t.sofaBedsTitle : `${title} — ${lang === 'ru' ? 'мебель в Тбилиси и Батуми' : 'SIMAL'}`,
        description:
          sofaBeds ? t.sofaBedsGuide : lang === 'ru'
            ? `${title} в каталоге SIMAL. Размеры, характеристики и цены. Добавьте товары в корзину и уточните наличие и доставку у менеджера.`
            : `${title}. ${t.catalogIntro}`,
        alternates: (['ru', 'en', 'ka'] as const).map((l) => ({
          lang: l,
          path: categoryUrl(category, l),
        })),
        noindex: categoryProducts(category, lang).length === 0,
      });
    }
  }
  for (const product of products) {
    for (const lang of ['ru', 'en', 'ka'] as const) {
      const translation = product.translations[lang];
      if (!translation?.url) continue;
      const title = translation.title;
      add({
        path: translation.url,
        lang,
        kind: 'product',
        product,
        title: `${title} | SIMAL`,
        description:
          excerpt(translation.summary || translation.description) ||
          `${title}. ${messages(lang).requestHelp}`,
        alternates: routeAlternates(product),
        // Editorial translation flags never block indexing. Only an explicitly
        // flagged detail-page gap without actual descriptive data stays closed.
        noindex:
          product.reviewFlags.includes('detail_page_missing') &&
          !excerpt(translation.description || translation.summary) &&
          !translation.attributes?.length,
      });
    }
    if (!product.translations.ru?.url)
      add({
        path: productUrl(product, 'ru'),
        lang: 'ru',
        kind: 'product',
        product,
        title: `${textFor(product, 'ru').title} | SIMAL`,
        description: excerpt(textFor(product, 'ru').description),
        noindex: true,
      });
  }
  for (const content of contentPages) {
    if (content.path === infoPath(content.lang, 'contact') || content.path === infoPath(content.lang, 'delivery')) continue;
    if (
      ['/news/', '/en/news/', '/ge/news/', '/aktsii/', '/en/aktsii/', '/ge/aktsii/'].includes(
        content.path,
      )
    )
      continue;
    add({
      path: content.path,
      lang: content.lang,
      kind: 'content',
      content,
      title: content.title,
      description: excerpt(content.description) || content.heading,
      noindex:
        content.kind === 'promotion' ||
        (content.reviewReasons || []).some(
          (reason) => reason !== 'Translation recovered from archive; editorial review required.',
        ),
    });
  }
  // Contacts and delivery use reviewed storefront copy instead of conflicting archived terms.
  for (const lang of ['ru', 'en', 'ka'] as const)
    for (const kind of ['about', 'contact', 'delivery', 'privacy', 'cooperation'] as const) {
      const path = infoPath(lang, kind);
      if (!routes.has(path)) {
        const t = messages(lang);
        const reviewed = kind === 'contact' || kind === 'delivery';
        add({
          path,
          lang,
          kind: 'content',
          title: `${t[kind]} | SIMAL`,
          description: kind === 'contact' ? t.contactDescription : kind === 'delivery' ? t.deliveryPaymentHelp : t.deliveryText,
          noindex: !reviewed,
          content: {
            path,
            lang,
            title: t[kind],
            heading: t[kind],
            description: '',
            kind: 'information',
            html: '',
            images: [],
            needsReview: !reviewed,
            sourcePath: '',
          },
        });
      }
    }
  const values = [...routes.values()];
  const duplicateTitles = duplicateMetadata(values, 'title');
  const duplicateDescriptions = duplicateMetadata(values, 'description');
  const indexed = new Map(values.filter((r) => !r.noindex).map((r) => [r.path, r.lang]));
  return values.map((route) => {
    let { title, description } = route;
    if (route.product && !route.noindex && (duplicateTitles.has(title) || duplicateDescriptions.has(description))) {
      const name = textFor(route.product, route.lang).title;
      const detail = productSeoDetail(route.product, route.lang);
      const label = detail && !name.includes(detail) ? `${name}, ${detail}` : name;
      if (duplicateTitles.has(title)) title = `${label} | SIMAL`;
      if (duplicateDescriptions.has(description) && !description.startsWith(label)) {
        description = excerpt(`${label}. ${description}`);
      }
    }
    const informationKind = route.kind === 'content'
      ? (['about', 'contact', 'delivery', 'privacy', 'cooperation'] as const)
        .find((kind) => infoPath(route.lang, kind) === route.path)
      : undefined;
    const alternates = route.alternates || (informationKind
      ? (['ru', 'en', 'ka'] as const).map((lang) => ({ lang, path: infoPath(lang, informationKind) }))
      : undefined);
    return {
      ...route,
      title,
      description,
      alternates: alternates?.filter((alternate) => indexed.get(alternate.path) === alternate.lang),
    };
  });
}
