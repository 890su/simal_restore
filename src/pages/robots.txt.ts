import type { APIRoute } from 'astro';
export const GET: APIRoute = () =>
  new Response(
    import.meta.env.SITE_NOINDEX === 'true'
      ? 'User-agent: *\nAllow: /\n'
      : 'User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://simal.ge/sitemap.xml\n',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
