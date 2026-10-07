// Every page may be crawled; the sitemap (Starlight's, over the whole site)
// lists them

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', site)}\n`, {
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});
