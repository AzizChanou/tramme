// tramme bench <editor url> [--layer id] [--t s]: how the editor holds up,
// measured in Chrome. Loading, a still at full quality, playback, dragging a
// layer and hovering the viewport, each with the frames drawn and the time
// the interface was blocked (long tasks over 50 ms). The drag is undone.

import { launch } from './browser.ts';

interface Sample { frames: number; drawMs: number; longMs: number; longMax: number; wallMs: number }

export async function bench(url: string, { layer, t = 1, width = 1600, height = 1000, dpr = 1 }: { layer?: string; t?: number; width?: number; height?: number; dpr?: number } = {}) {
  const { browser, page } = await launch({ quiet: true });
  await page.setViewport({ width, height, deviceScaleFactor: dpr });
  await page.evaluateOnNewDocument(() => {
    (window as any).__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__tramme?.preview.stats.frames > 0, { timeout: 120000, polling: 50 });
  const loadMs = Date.now() - t0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const measure = async (action: () => Promise<void>): Promise<Sample> => {
    await sleep(800);
    await page.evaluate(() => { const e = (window as any).__tramme; e.preview.stats = { frames: 0, ms: 0 }; (window as any).__long = []; });
    const w0 = Date.now();
    await action();
    const wallMs = Date.now() - w0;
    return page.evaluate((wall) => {
      const e = (window as any).__tramme, long = (window as any).__long as number[];
      return { frames: e.preview.stats.frames, drawMs: e.preview.stats.ms / Math.max(1, e.preview.stats.frames), longMs: long.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...long), wallMs: wall };
    }, wallMs);
  };

  const still = await measure(async () => { await page.evaluate((x) => (window as any).__tramme.setTime(x), t); await sleep(1500); });
  const lastMs: number = await page.evaluate(() => (window as any).__tramme.preview.lastMs);
  const play = await measure(async () => {
    await page.evaluate(() => { (window as any).__tramme.S.playing.value = true; });
    await sleep(3000);
    await page.evaluate(() => { (window as any).__tramme.S.playing.value = false; });
  });

  // the layer to drag: given, or the topmost active one
  const target = await page.evaluate((id) => {
    const e = (window as any).__tramme, S = e.S;
    const c = S.doc.value.compositions[S.compId.value];
    const lid = id ?? [...c.order].reverse().find((x: string) => c.layers[x]?.transform?.position !== undefined);
    if (!lid) return null;
    e.select([lid]);
    const stage = document.querySelector('.viewport .stage')!.getBoundingClientRect();
    const box = document.querySelector('.gizmo-box')?.getBoundingClientRect();
    const cx = box ? box.x + box.width / 2 : stage.x + stage.width / 2, cy = box ? box.y + box.height / 2 : stage.y + stage.height / 2;
    return { lid, x: cx, y: cy };
  }, layer ?? null);
  let drag: Sample | null = null;
  if (target) {
    await sleep(500);
    drag = await measure(async () => {
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) { await page.mouse.move(target.x + i * 3, target.y + i * 2); await sleep(16); }
      await page.mouse.up();
      await sleep(300);
    });
    await page.evaluate(() => (window as any).__tramme.undo());
  }
  const stage = await page.evaluate(() => { const r = document.querySelector('.viewport .stage')!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const hover = await measure(async () => {
    for (let i = 0; i <= 40; i++) { await page.mouse.move(stage.x + (stage.w * i) / 40, stage.y + stage.h / 2); await sleep(16); }
  });
  await sleep(1500); // let the autosave of the undo land
  await browser.close();

  const row = (name: string, s: Sample | null, extra = '') => s
    ? console.log(`${name.padEnd(10)} ${String(s.frames).padStart(5)} fr   ${s.drawMs.toFixed(0).padStart(5)} ms/fr  blocked ${s.longMs.toFixed(0).padStart(6)} ms (max ${s.longMax.toFixed(0)})  wall ${s.wallMs} ms${extra}`)
    : console.log(`${name.padEnd(10)} (no layer to drag)`);
  console.log(`loading ${loadMs} ms`);
  row('still', still, `  last frame ${lastMs.toFixed(0)} ms`);
  row('playback', play, `  that is ${(play.frames / 3).toFixed(1)} fps`);
  row('drag', drag, target ? `  (${target.lid})` : '');
  row('hover', hover);
}
