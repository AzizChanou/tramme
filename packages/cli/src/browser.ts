// Headless Chrome with the GPU (ANGLE on D3D11 under Windows), sRGB forced,
// LCD text off: renders are identical from one machine to the next.

import fs from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));

export async function launch({ quiet = true } = {}): Promise<{ browser: Browser; page: Page }> {
  if (!CHROME) throw new Error('Chrome not found (set CHROME_PATH to point to it)');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 0,
    args: [
      '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--disable-lcd-text',
      '--window-size=1920,1080',
    ],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (!quiet || m.type() === 'error' || m.type() === 'warn') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[page error]', (e as Error).message));
  return { browser, page };
}

export interface DocInfo {
  title: string; comp: string; width: number; height: number; fps: number; duration: number; frames: number;
  markers: { id: string; t: number; kind?: string; label?: string }[];
}

/** open the runtime page on a document and wait until it is ready */
export async function openDoc(page: Page, port: number, docUrlPath: string, comp?: string): Promise<DocInfo> {
  const q = new URLSearchParams({ doc: docUrlPath });
  if (comp) q.set('comp', comp);
  await page.goto(`http://127.0.0.1:${port}/__tramme/?${q}`);
  await page.evaluate(() => (window as any).TRAMME.ready);
  return page.evaluate(() => (window as any).TRAMME.info());
}
