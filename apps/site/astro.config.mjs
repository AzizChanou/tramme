// The project's site: a static Astro build. The landing page (src/pages)
// runs no engine: the examples are videos (src/videos, see
// components/Media.astro), loaded only near the screen. The docs (/docs/) are
// Starlight, over the repository's own Markdown (src/lib/docs.ts). With the
// site's address, Starlight writes the sitemap of every page.

import { fileURLToPath } from 'node:url';
import { defineConfig, fontProviders } from 'astro/config';
import starlight from '@astrojs/starlight';
import { sidebar } from './src/lib/docs.ts';
import { publishInstaller } from './src/lib/download.ts';
import { REPO } from './src/lib/links.ts';
import { SITE } from './src/lib/site.ts';

// the Windows installer, when built on this machine (src/lib/download.ts)
const download = publishInstaller(fileURLToPath(new URL('.', import.meta.url)), console.log);

export default defineConfig({
  // the public address, for the canonical links, the sitemap and the preview image
  site: process.env.SITE_URL ?? SITE.url,
  vite: { define: { __DOWNLOAD__: JSON.stringify(download) } },
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Geist', cssVariable: '--font-sans', weights: ['300 700'], styles: ['normal'] },
    { provider: fontProviders.fontsource(), name: 'Geist Mono', cssVariable: '--font-mono', weights: ['400 500'], styles: ['normal'] },
  ],
  integrations: [
    starlight({
      title: 'tramme',
      description: SITE.docs,
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      sidebar,
      customCss: ['./src/styles/docs.css'],
      // the landing page's brand, theme script and toggle, so both sides look and choose alike
      components: {
        Head: './src/components/docs/Head.astro',
        SiteTitle: './src/components/docs/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
      },
      // the pages come from the repository's root (docs/, README.md): Starlight's
      // Markdown transforms (heading anchors, asides) apply there too
      markdown: { processedDirs: ['../..'] },
    }),
  ],
});
