// The link preview's address: the card shared with the editor's page
// (apps/editor/og.jpg, made by scripts/og-image.ts), served by the site

import og from '../../../editor/og.jpg?url';

export const previewUrl = (site: URL | undefined) => new URL(og, site).href;
