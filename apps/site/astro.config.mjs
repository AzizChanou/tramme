// The project's site: a static Astro build. It runs no engine: the examples
// are videos (src/videos, see components/Media.astro), loaded only near the
// screen, and the page's only scripts drive them and the copy button.

import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  // the public address (SITE_URL), for absolute links such as the preview image
  site: process.env.SITE_URL,
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Geist', cssVariable: '--font-sans', weights: ['300 700'], styles: ['normal'] },
    { provider: fontProviders.fontsource(), name: 'Geist Mono', cssVariable: '--font-mono', weights: ['400 500'], styles: ['normal'] },
  ],
});
