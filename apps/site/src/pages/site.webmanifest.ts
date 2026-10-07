// The site's web manifest: its name and icons, for the browsers and search
// engines that read one

import type { APIRoute } from 'astro';
import icon from '../../../editor/icon.svg?url';
import { SITE } from '../lib/site';

export const GET: APIRoute = () => Response.json({
  name: SITE.name,
  short_name: SITE.name,
  description: SITE.description,
  start_url: '/',
  display: 'browser',
  background_color: '#0b0f12',
  theme_color: '#0b0f12',
  icons: [
    { src: icon, sizes: 'any', type: 'image/svg+xml' },
    { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
  ],
});
