// The documentation: pages made from the repository's own Markdown (docs/
// and sections of the README), read at build time by lib/docs-loader.ts, so
// the site never holds a second copy. This list gives their addresses, their
// names and their order in the sidebar.

export interface DocPage {
  /** where it is served, under /docs/ ('' for /docs/ itself) */
  slug: string;
  /** its name in the sidebar */
  label: string;
  /** the file it comes from, from the repository's root */
  file: string;
  /** README only: the sections (## titles) it takes, '' for the text above the first one */
  sections?: string[];
  /** its title, when the file's own heading does not fit */
  title?: string;
}

export const DOCS: { label: string; collapsed?: boolean; pages: DocPage[] }[] = [
  {
    label: 'Start',
    pages: [
      { slug: '', label: 'Overview', file: 'README.md', sections: ['', 'Principles'], title: 'Overview' },
      { slug: 'getting-started', label: 'Getting started', file: 'README.md', sections: ['Getting started'] },
      { slug: 'deploy', label: 'Deploying', file: 'docs/deploy.md' },
    ],
  },
  {
    label: 'Using tramme',
    pages: [
      { slug: 'editor', label: 'The editor', file: 'README.md', sections: ['The editor'] },
      { slug: 'assistant', label: 'The assistant', file: 'README.md', sections: ['The assistant'] },
      { slug: 'cli', label: 'Command line', file: 'README.md', sections: ['Commands'], title: 'Command line' },
      { slug: 'limits', label: 'Known limits', file: 'README.md', sections: ['Known limits'] },
    ],
  },
  {
    label: 'Reference',
    pages: [
      { slug: 'document', label: 'Document format', file: 'docs/document.md' },
      { slug: 'project', label: 'Project format', file: 'docs/project.md' },
      { slug: 'i18n', label: 'Interface languages', file: 'docs/i18n.md' },
      { slug: 'tours', label: 'Guided tours', file: 'docs/tours.md' },
    ],
  },
  {
    label: 'Roadmaps',
    collapsed: true,
    pages: [
      { slug: 'roadmaps/plugins', label: 'Plugins', file: 'docs/plugins-roadmap.md' },
      { slug: 'roadmaps/motion', label: 'Motion', file: 'docs/motion-roadmap.md' },
      { slug: 'roadmaps/sound', label: 'Sound', file: 'docs/sound-roadmap.md' },
      { slug: 'roadmaps/generation', label: 'Generation', file: 'docs/generation-roadmap.md' },
      { slug: 'roadmaps/shorts', label: 'Shorts', file: 'docs/shorts-roadmap.md' },
      { slug: 'roadmaps/taste', label: 'Taste', file: 'docs/taste-roadmap.md' },
      { slug: 'roadmaps/apps', label: 'Desktop and mobile apps', file: 'docs/desktop-and-mobile-apps.md' },
    ],
  },
];

export const PAGES = DOCS.flatMap((g) => g.pages);

/** the page's entry in Starlight's collection, which is also its route */
export const docId = (slug: string) => (slug ? `docs/${slug}` : 'docs');

/** the page's address on the site */
export const docHref = (slug: string) => `/${docId(slug)}/`;

/** Starlight's sidebar, in the order above */
export const sidebar = DOCS.map(({ label, collapsed = false, pages }) => ({
  label,
  collapsed,
  items: pages.map((p) => ({ label: p.label, slug: docId(p.slug) })),
}));
