// The desktop app's installers, as each release on GitHub carries them
// (.github/workflows/desktop.yml, gathered by scripts/desktop-release.ts): one
// stable name per file, so the site links to the latest release's files
// without knowing its version (apps/site/src/lib/download.ts).

export type Os = 'windows' | 'mac' | 'linux';

export interface Installer {
  os: Os;
  /** its name on the release */
  file: string;
  /** where `tauri build` writes it, under src-tauri/target, and how its name ends */
  built: string;
  suffix: string;
  /** what it is, and what it runs on, as the download page says it */
  kind: string;
  runs: string;
}

/** each system's first installer is the one its download button offers */
export const INSTALLERS: Installer[] = [
  { os: 'windows', file: 'tramme-windows-x64-setup.exe', built: 'release/bundle/nsis', suffix: '-setup.exe', kind: 'Installer', runs: 'Windows 10 and 11, 64-bit' },
  { os: 'mac', file: 'tramme-macos-universal.dmg', built: 'universal-apple-darwin/release/bundle/dmg', suffix: '.dmg', kind: 'Disk image', runs: 'Apple silicon and Intel' },
  { os: 'linux', file: 'tramme-linux-x86_64.AppImage', built: 'release/bundle/appimage', suffix: '.AppImage', kind: 'AppImage', runs: 'Most distributions, x86-64' },
  { os: 'linux', file: 'tramme-linux-amd64.deb', built: 'release/bundle/deb', suffix: '.deb', kind: 'Debian package', runs: 'Debian, Ubuntu and their kin, x86-64' },
];

/** the systems, in the order they are offered, by their names */
export const SYSTEMS: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
