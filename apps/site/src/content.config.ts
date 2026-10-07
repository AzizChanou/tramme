// The docs, for Starlight: the repository's Markdown, loaded where it is
import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { repoDocs } from './lib/docs-loader';

export const collections = {
  docs: defineCollection({ loader: repoDocs(), schema: docsSchema() }),
};
