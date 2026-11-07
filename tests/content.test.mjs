import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHTML, extractPage, extractAll } from '../scripts/extract-content.mjs';

test('archive sanitizer removes executable markup and preserves useful semantic content', () => {
  const html = sanitizeHTML(
    '<h2 onclick="alert(1)">Размеры</h2><p style="color:red">Размер <b>90×200</b>. <a href="/catalog/" onclick="x()">Каталог</a></p><script>alert(1)</script><form><p>Старая форма</p><input></form><iframe src="https://tracker.test"></iframe>',
  );
  assert.match(html, /<h2>Размеры<\/h2>/);
  assert.match(html, /Размер <strong>90×200<\/strong>\./);
  assert.match(html, /href="\/catalog\/"/);
  assert.doesNotMatch(html, /onclick|style=|alert|Старая форма|iframe|input/);
});

test('encoded dangerous links and image handlers never enter output', () => {
  const html = sanitizeHTML(
    '<a href="java&#115;cript:alert(1)">first</a><a href="data:text/html,x">second</a><a href="//tracker.test">third</a><img src="/images/logo.png" onerror="alert(1)" alt="&quot; onload=&quot;x"><svg><a href="https://x.test">bad</a></svg><img src="https://tracker.test/pixel">',
  );
  assert.doesNotMatch(html, /href=|onerror|<svg|https:\/\/tracker/);
  assert.match(html, /src="\/images\/logo.png"/);
  assert.match(html, /alt="&quot; onload=&quot;x"/);
});

test('nested span and formatting boundaries preserve spaces', () => {
  assert.equal(
    sanitizeHTML(
      '<div><span>Оплата по </span><b>наличному</b><span> или </span><b>безналичному</b><span> расчету.</span></div>',
    ),
    'Оплата по <strong>наличному</strong> или <strong>безналичному</strong> расчету.',
  );
});

test('only main body is extracted and archive promotions require review', () => {
  const page = extractPage(
    '<title>Sale | SIMAL</title><meta name="description" content="Old promotion"><header>Navigation</header><main><h1>Sale</h1><p>Offer from archive</p></main><footer>Footer</footer>',
    '/en/aktsii/sale/',
    'archive.html',
  );
  assert.equal(page.heading, 'Sale');
  assert.equal(page.lang, 'en');
  assert.equal(page.kind, 'promotion');
  assert.equal(page.needsReview, true);
  assert.doesNotMatch(page.html, /Navigation|Footer|<h1/);
});

test('real archive yields core pages and explicit missing-route migration report', () => {
  const { pages, migration } = extractAll();
  for (const route of [
    '/kompaniya/',
    '/oplata-dostavka/',
    '/kontakty/',
    '/kontakty/politika-konfidentsialnosti/',
    '/sotrudnichestvo/',
    '/en/cooperation/',
  ])
    assert.ok(
      pages.some((p) => p.path === route),
      route,
    );
  assert.ok(pages.some((p) => p.kind === 'promotion' && p.needsReview));
  assert.ok(migration.garbageLinks.some((p) => p.path.includes('abonement-fitnes')));
  assert.ok(migration.missingLinkedRoutes.some((p) => p.path.startsWith('/news/')));
  for (const page of pages)
    assert.doesNotMatch(
      page.html,
      /<script|<iframe|<form|\bonclick=|\bstyle=|\bclass=/i,
      page.path,
    );
});
