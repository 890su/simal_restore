import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const DROP = new Set([
  'script',
  'style',
  'form',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'input',
  'button',
  'select',
  'textarea',
]);
const ALLOWED = new Set([
  'p',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'br',
  'hr',
  'img',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  copy: '©',
  trade: '™',
  hellip: '…',
};

export function decode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);?/gi, (all, name) => {
    if (name[0] === '#') {
      const num =
        name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return num > 0 && num <= 0x10ffff ? String.fromCodePoint(num) : '';
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}
const escape = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A small source parser, not a browser DOM: unknown syntax is emitted only as escaped text.
export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+|</gi) ?? []) {
    if (token.startsWith('<!')) continue;
    const closing = token.match(/^<\/([a-z][\w-]*)[^>]*>/i);
    if (closing) {
      const index = stack.map((n) => n.tag).lastIndexOf(closing[1].toLowerCase());
      if (index > 0) stack.length = index;
      continue;
    }
    const opening = token.match(/^<([a-z][\w-]*)\b([\s\S]*?)\/?\s*>$/i);
    if (!opening) {
      stack.at(-1).children.push({ text: decode(token) });
      continue;
    }
    const tag = opening[1].toLowerCase();
    const attrs = {};
    for (const m of opening[2].matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    ))
      attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!VOID.has(tag) && !token.endsWith('/>')) stack.push(node);
  }
  return root;
}
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
const textOf = (node) => ('text' in node ? node.text : (node.children ?? []).map(textOf).join(' '));
const cleanText = (value) => value.replace(/\s+/g, ' ').trim();

function safeURL(raw, image = false) {
  const value = decode(raw ?? '').trim();
  if (!value || /[\u0000-\u0020\u007f\\<>]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) {
    const pathname = new URL(value, 'https://simal.ge').pathname;
    if (
      image &&
      (!fs.existsSync(path.join(ROOT, 'site', pathname)) || pathname.includes('placeholder'))
    )
      return null;
    return value;
  }
  if (image) return null; // no tracking pixels or hotlinked third-party media
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (url.hostname === 'simal.ge' || url.hostname === 'www.simal.ge')
        return `${url.pathname}${url.search}${url.hash}`;
      return url.href;
    }
    if (url.protocol === 'tel:' || url.protocol === 'mailto:') return value;
  } catch {
    /* invalid URL */
  }
  return null;
}

function render(node) {
  if ('text' in node) return escape(node.text.replace(/\s+/g, ' '));
  if (DROP.has(node.tag) || node.tag === 'h1') return '';
  if (
    node.attrs?.class?.split(/\s+/).some((c) => ['breadcrumb', 'contacts_form', 'map'].includes(c))
  )
    return '';
  const children = (node.children ?? []).map(render).join('');
  let tag = node.tag === 'b' ? 'strong' : node.tag === 'i' ? 'em' : node.tag;
  if (tag === 'img') {
    const src = safeURL(node.attrs.src, true);
    return src
      ? `<img src="${escape(src)}" alt="${escape(node.attrs.alt ?? '')}" loading="lazy" decoding="async">`
      : '';
  }
  if (tag === 'a') {
    const href = safeURL(node.attrs.href);
    return href && children
      ? `<a href="${escape(href)}"${href.startsWith('http') ? ' rel="noopener noreferrer"' : ''}>${children}</a>`
      : children;
  }
  if (!children.trim() && tag !== 'br' && tag !== 'hr') return '';
  if (!ALLOWED.has(tag))
    return children ? (tag === 'div' || tag === 'section' ? `${children}\n` : children) : '';
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  return `<${tag}>${children}</${tag}>`;
}

export function sanitizeHTML(html) {
  return render(parseHTML(html))
    .replace(/(?:\s*<br>\s*){3,}/g, '<br><br>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const routeOf = (file, site) =>
  '/' +
  path.relative(site, file).split(path.sep).slice(0, -1).join('/') +
  (file === path.join(site, 'index.html') ? '' : '/');

export function extractPage(source, route, sourcePath) {
  const tree = parseHTML(source);
  const main = find(tree, (n) => n.tag === 'main');
  if (!main) return null;
  const heading = cleanText(textOf(find(main, (n) => n.tag === 'h1') ?? { text: '' }));
  if (!heading) return null;
  const title = cleanText(textOf(find(tree, (n) => n.tag === 'title') ?? { text: heading }));
  const description =
    find(tree, (n) => n.tag === 'meta' && n.attrs.name?.toLowerCase() === 'description')?.attrs
      .content ?? '';
  const lang = route.startsWith('/en/') ? 'en' : route.startsWith('/ge/') ? 'ka' : 'ru';
  const kind = /\/aktsii\//.test(route)
    ? 'promotion'
    : /\/news\//.test(route)
      ? 'news'
      : 'information';
  const html = render(main).trim();
  const images = [];
  for (const m of html.matchAll(/<img src="([^"]+)" alt="([^"]*)"/g))
    images.push({ src: decode(m[1]), alt: decode(m[2]) });
  const reviewReasons = [];
  if (lang !== 'ru')
    reviewReasons.push('Translation recovered from archive; editorial review required.');
  if (kind === 'promotion')
    reviewReasons.push('Archived promotion; dates and commercial terms must be reapproved.');
  if (/\/(kompaniya|oplata-dostavka|kontakty)(\/|$)/.test(route))
    reviewReasons.push(
      'Recovered company details and terms; check current addresses, policy and delivery conditions.',
    );
  return {
    path: route,
    lang,
    title,
    description: cleanText(description),
    heading,
    kind,
    html,
    images,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    sourcePath,
  };
}

export function extractAll(root = ROOT) {
  const site = path.join(root, 'site');
  const files = walk(site).filter(
    (f) => f.endsWith('.html') && !f.includes(`${path.sep}includes${path.sep}`),
  );
  const routes = new Set(
    files.filter((f) => path.basename(f) === 'index.html').map((f) => routeOf(f, site)),
  );
  const selected = files.filter((f) =>
    /^(?:en\/|ge\/)?(?:kompaniya|oplata-dostavka|kontakty|sotrudnichestvo|cooperation|aktsii|news)\//.test(
      path.relative(site, f).split(path.sep).join('/'),
    ),
  );
  const pages = selected
    .map((f) =>
      extractPage(
        fs.readFileSync(f, 'utf8'),
        routeOf(f, site),
        path.relative(root, f).split(path.sep).join('/'),
      ),
    )
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));
  const missing = new Map();
  const garbage = new Map();
  const canonicalIssues = [];
  const hreflangIssues = [];
  const suspicious =
    /abonement-fitnes|wwcheckmetrics|\/bitrix\/(admin|tools|services|spread)|\/bitrix\/rk\.php/i;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const route = routeOf(file, site);
    for (const m of source.matchAll(/href=["']([^"']+)["']/gi)) {
      let url;
      try {
        url = new URL(decode(m[1]), `https://simal.ge${route}`);
      } catch {
        continue;
      }
      if (!['simal.ge', 'www.simal.ge'].includes(url.hostname)) continue;
      if (suspicious.test(url.pathname)) {
        const entry = garbage.get(url.pathname) ?? new Set();
        entry.add(route);
        garbage.set(url.pathname, entry);
        continue;
      }
      if (!url.pathname.endsWith('/') || routes.has(url.pathname)) continue;
      const entry = missing.get(url.pathname) ?? new Set();
      entry.add(route);
      missing.set(url.pathname, entry);
    }
    const links = [...source.matchAll(/<link\b[^>]*>/gi)].map(
      (m) => parseHTML(m[0]).children[0]?.attrs ?? {},
    );
    const canonical = links.find((a) => a.rel === 'canonical')?.href;
    if (!canonical || canonical !== `https://simal.ge${route}`)
      canonicalIssues.push({ path: route, canonical: canonical ?? null });
    for (const link of links.filter((a) => a.hreflang)) {
      let url;
      try {
        url = new URL(link.href);
      } catch {
        hreflangIssues.push({
          path: route,
          lang: link.hreflang,
          href: link.href,
          reason: 'invalid-url',
        });
        continue;
      }
      if (!routes.has(url.pathname))
        hreflangIssues.push({
          path: route,
          lang: link.hreflang,
          href: link.href,
          reason: 'target-not-in-local-archive',
        });
    }
  }
  const serialize = (map) =>
    [...map]
      .map(([route, sources]) => ({
        path: route,
        occurrences: sources.size,
        sourceExamples: [...sources].slice(0, 3),
      }))
      .sort((a, b) => b.occurrences - a.occurrences || a.path.localeCompare(b.path));
  const migration = {
    sourceHTMLCount: files.length,
    preservedContentPaths: pages.map((p) => p.path),
    missingLinkedRoutes: serialize(missing),
    garbageLinks: serialize(garbage),
    canonicalIssues,
    hreflangIssues,
    policy: {
      preserveExistingRoutes: true,
      redirectOnlyExactMatches: true,
      unpublishedTranslationsExcludedFromHreflang: true,
      archivedPromotionsNoindex: true,
      missingPages:
        '404 until recovered or matched; do not redirect every missing product to homepage',
    },
  };
  return { pages, migration };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = extractAll();
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'data/pages.json'),
    JSON.stringify({ pages: result.pages }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(ROOT, 'data/seo-migration.json'),
    JSON.stringify(result.migration, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      pages: result.pages.length,
      missingRoutes: result.migration.missingLinkedRoutes.length,
      garbageLinks: result.migration.garbageLinks.length,
      canonicalIssues: result.migration.canonicalIssues.length,
      hreflangIssues: result.migration.hreflangIssues.length,
    }),
  );
}
