// The project's site: a static Astro build. The landing page (src/pages)
// runs no engine: the examples are videos (src/videos, see
// components/Media.astro), loaded only near the screen. The docs (/docs/) are
// Starlight, over the repository's own Markdown (src/lib/docs.ts).

import { defineConfig, fontProviders } from 'astro/config';
import starlight from '@astrojs/starlight';
import { sidebar } from './src/lib/docs.ts';
import { REPO } from './src/lib/links.ts';

export default defineConfig({
  // the public address (SITE_URL), for absolute links such as the preview image
  site: process.env.SITE_URL,
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Geist', cssVariable: '--font-sans', weights: ['300 700'], styles: ['normal'] },
    { provider: fontProviders.fontsource(), name: 'Geist Mono', cssVariable: '--font-mono', weights: ['400 500'], styles: ['normal'] },
  ],
  integrations: [
    starlight({
      title: 'tramme',
      description: 'Documentation of tramme, the open-source motion design engine and editor.',
      logo: { src: '../editor/icon.svg' },
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      sidebar,
      customCss: ['./src/styles/docs.css'],
      components: { Head: './src/components/docs/Head.astro' },
      // the pages come from the repository's root (docs/, README.md): Starlight's
      // Markdown transforms (heading anchors, asides) apply there too
      markdown: { processedDirs: ['../..'] },
    }),
  ],
});
