import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML, decode } from './extract-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const issues = [];
const issue = (type, file, detail) =>
  issues.push({ type, file: path.relative(dist, file).split(path.sep).join('/'), detail });
if (!fs.existsSync(dist)) throw new Error('dist/ is missing; run Astro build first.');
const files = walk(dist);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const routeOf = (file) =>
  '/' +
  path
    .relative(dist, file)
    .split(path.sep)
    .join('/')
    .replace(/index\.html$/, '');
const pages = new Map();
const redirects = new Map();
if (fs.existsSync(path.join(dist, '_redirects')))
  for (const line of fs.readFileSync(path.join(dist, '_redirects'), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [from, to] = line.trim().split(/\s+/);
    redirects.set(decodeURI(from), decodeURI(to));
  }
function localURL(value, base) {
  if (!value || value.startsWith('#') || /^(?:data:|mailto:|tel:|blob:)/i.test(value)) return null;
  try {
    const url = new URL(decode(value), `https://simal.ge${base}`);
    if (!['simal.ge', 'www.simal.ge'].includes(url.hostname)) return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}
function exists(url, seen = new Set()) {
  if (url.startsWith('/api/')) return true;
  if (seen.has(url)) return false;
  seen.add(url);
  if (redirects.has(url)) return exists(redirects.get(url), seen);
  const file = path.resolve(dist, '.' + url);
  if (!file.startsWith(dist + path.sep) && file !== dist) return false;
  return (
    (fs.existsSync(file) && fs.statSync(file).isFile()) ||
    fs.existsSync(path.join(file, 'index.html')) ||
    fs.existsSync(file + '.html')
  );
}
const elements = (node) => [node, ...(node.children ?? []).flatMap(elements)];
const htmlNodes = (source) =>
  elements(parseHTML(source.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>')));
for (const file of htmlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const nodes = htmlNodes(source);
  const route = decodeURI(routeOf(file));
  const noindex = nodes.some(
    (n) => n.tag === 'meta' && n.attrs.name === 'robots' && /noindex/i.test(n.attrs.content),
  );
  const canonicals = nodes.filter((n) => n.tag === 'link' && n.attrs.rel === 'canonical');
  const lang = nodes.find((node) => node.tag === 'html')?.attrs.lang;
  const alternates = new Map(nodes
    .filter((node) => node.tag === 'link' && node.attrs.hreflang)
    .map((node) => [node.attrs.hreflang, localURL(node.attrs.href, route)]));
  pages.set(route, { noindex, file, lang, alternates });
  if (nodes.filter((n) => n.tag === 'h1').length !== 1)
    issue('h1', file, 'Expected exactly one h1.');
  if (route !== '/404.html' && canonicals.length !== 1)
    issue('canonical-count', file, `Found ${canonicals.length} canonical links.`);
  for (const canonical of canonicals) {
    let matches = false;
    try {
      const url = new URL(canonical.attrs.href);
      // Astro writes decoded directory names for encoded recovered URLs. A
      // canonical %20 and its on-disk space represent the same pathname.
      matches = url.origin === 'https://simal.ge' && !url.search && !url.hash && decodeURI(url.pathname) === decodeURI(route);
    } catch { /* Malformed canonical remains an audit defect. */ }
    if (!matches && route !== '/404.html')
      issue('canonical-path', file, canonical.attrs.href);
  }
  for (const node of nodes) {
    for (const name of ['href', 'src', 'poster']) {
      const url = localURL(node.attrs?.[name], route);
      if (url && !exists(url)) issue('missing-resource', file, `${name}=${url}`);
      if (node.tag === 'a' && name === 'href' && redirects.has(url))
        issue('internal-link-redirects', file, url);
      if (url?.startsWith('/bitrix/')) issue('bitrix-resource', file, url);
    }
    if (node.attrs?.srcset)
      for (const entry of node.attrs.srcset.split(',')) {
        const url = localURL(entry.trim().split(/\s+/)[0], route);
        if (url && !exists(url)) issue('missing-srcset', file, url);
      }
  }
  if (/\bBX\.(?:message|setJSList)|siteInclude\s*\(/.test(source))
    issue('legacy-code', file, 'Archived Bitrix/runtime include code remains.');
}
for (const [route, page] of pages) {
  for (const [lang, target] of page.alternates) {
    const alternate = pages.get(target);
    const expected = lang === 'x-default' ? 'ru' : lang;
    if (!alternate || alternate.noindex || alternate.lang !== expected || redirects.has(target))
      issue('invalid-hreflang', page.file, `${lang}: ${target}`);
    else if (alternate.alternates.get(page.lang) !== route)
      issue('hreflang-not-reciprocal', page.file, `${lang}: ${target}`);
  }
}
for (const file of files.filter((f) => f.endsWith('.css'))) {
  const source = fs.readFileSync(file, 'utf8');
  const base = '/' + path.relative(dist, file).split(path.sep).join('/');
  for (const m of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const url = localURL(m[1].trim(), base);
    if (url && !exists(url)) issue('missing-css-resource', file, url);
  }
}
const sitemapFile = path.join(dist, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) issue('sitemap-missing', sitemapFile, 'Expected sitemap.xml.');
else {
  for (const m of fs.readFileSync(sitemapFile, 'utf8').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
    const route = localURL(m[1], '/');
    if (!route || !pages.has(route)) issue('sitemap-target', sitemapFile, m[1]);
    else if (pages.get(route).noindex) issue('sitemap-noindex', sitemapFile, route);
  }
}
for (const [from, to] of redirects) {
  if (pages.has(from)) issue('redirect-shadows-page', path.join(dist, '_redirects'), from);
  if (from === to || redirects.has(to))
    issue('redirect-chain', path.join(dist, '_redirects'), `${from} -> ${to}`);
  if (!pages.has(to)) issue('redirect-target', path.join(dist, '_redirects'), `${from} -> ${to}`);
}
const uniqueIssues = [...new Map(issues.map((item) => [JSON.stringify(item), item])).values()];
fs.mkdirSync(path.join(root, '.work'), { recursive: true });
fs.writeFileSync(
  path.join(root, '.work/build-audit.json'),
  JSON.stringify(
    {
      htmlPages: htmlFiles.length,
      cssFiles: files.filter((f) => f.endsWith('.css')).length,
      redirects: redirects.size,
      issues: uniqueIssues,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Build audit: ${htmlFiles.length} pages, ${redirects.size} redirects, ${uniqueIssues.length} defects.`,
);
if (uniqueIssues.length) {
  for (const item of uniqueIssues.slice(0, 25))
    console.error(`${item.type}: ${item.file}: ${item.detail}`);
  process.exitCode = 1;
}
