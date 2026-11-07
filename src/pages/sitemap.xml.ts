import type { APIRoute } from 'astro';
import { getRoutes } from '../lib/catalog';
const xml = (v: string) =>
  v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export const GET: APIRoute = () =>
  new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      (import.meta.env.SITE_NOINDEX === 'true' ? [] : getRoutes())
        .filter((r) => !r.noindex)
        .map((r) => '<url><loc>' + xml('https://simal.ge' + r.path) + '</loc></url>')
        .join('') +
      '</urlset>',
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
