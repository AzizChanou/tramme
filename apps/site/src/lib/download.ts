// The desktop app, as the site offers it: the installers of the latest release
// on GitHub (.github/workflows/desktop.yml), looked up once at each site build
// (astro.config.mjs) and handed to the pages as __RELEASE__. The links go to
// GitHub's address of the latest release under each file's stable name
// (apps/desktop/downloads.ts), so a newer release is offered before the site
// is built again. Without a release, or with GitHub out of reach, the links
// stay out and the download page says so.

import { INSTALLERS, type Installer } from '../../../desktop/downloads.ts';
import { REPO, REPO_NAME } from './links';

export interface Offered extends Installer {
  href: string;
  /** in bytes */
  size: number;
}

export interface Release {
  version: string;
  /** the release's page, with its notes */
  page: string;
  installers: Offered[];
}

interface GitHubRelease { tag_name: string; html_url: string; assets: { name: string; size: number }[] }

export async function latestRelease(log: (s: string) => void): Promise<Release | null> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'tramme-site' };
  // GitHub's limit without a token is 60 requests an hour per address
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_NAME}/releases/latest`, { headers, signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) {
      log('site: no release of the desktop app yet: the download links are left out');
      return null;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const release = (await r.json()) as GitHubRelease;
    const installers = INSTALLERS.flatMap((i): Offered[] => {
      const asset = release.assets.find((a) => a.name === i.file);
      return asset ? [{ ...i, href: `${REPO}/releases/latest/download/${i.file}`, size: asset.size }] : [];
    });
    if (!installers.length) {
      log(`site: the release ${release.tag_name} has no installer: the download links are left out`);
      return null;
    }
    return { version: release.tag_name.replace(/^v/, ''), page: release.html_url, installers };
  } catch (e) {
    log(`site: the latest release could not be read (${(e as Error).message}): the download links are left out`);
    return null;
  }
}
