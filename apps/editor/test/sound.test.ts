import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchSounds, variantsOf, type SoundEntry, type ToolContext, type Transcript, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { momentsOf, SOUND_TOOLS } from '../src/sound.ts';
import { SOUND_PRESETS } from '../src/sound-presets.ts';

const ROOT = path.resolve(__dirname, '../../..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'sounds/catalog.json'), 'utf8')).sounds as SoundEntry[];
const library = [...catalog, ...SOUND_PRESETS];
const tool = (name: string) => SOUND_TOOLS.find((x) => x.name === name)!;

describe('the sound library', () => {
  it('holds every file it lists, once, measured and described', () => {
    expect(catalog.length).toBeGreaterThan(300);
    expect(new Set(library.map((e) => e.id)).size).toBe(library.length);
    for (const e of catalog) {
      expect(fs.existsSync(path.join(ROOT, 'sounds', e.file!)), e.file).toBe(true);
      expect(e.duration).toBeGreaterThan(0);
      expect(e.peakAt).toBeLessThanOrEqual(e.duration);
      expect(e.license).toBe('CC0');
    }
    for (const p of SOUND_PRESETS) expect(p.code).toContain('ctx.destination');
  });

  it('finds sounds the way one asks for them, one per family', () => {
    expect(searchSounds(library, 'metal hit heavy')[0].id).toMatch(/^impact-impact-metal-heavy/);
    expect(searchSounds(library, 'whoosh').map((e) => e.id)).toContain('synth-whoosh');
    expect(searchSounds(library, 'logo sting')[0].kind).toBe('sting');
    expect(searchSounds(library, 'build tension')[0].kind).toBe('riser');
    const clicks = searchSounds(library, 'click', { limit: 50 });
    expect(new Set(clicks.map((e) => e.family ?? e.id)).size).toBe(clicks.length);
    expect(searchSounds(library, 'zzzz')).toEqual([]);
    const metal = catalog.find((e) => e.id === 'impact-impact-metal-heavy-000')!;
    expect(variantsOf(catalog, metal).length).toBe(5);
  });
});

/** a composition: a title entering at 1 s and leaving at 4 s, a card at 2.5 s, a music, a cut of a video at 3 s, a marker */
function project(): TrammeDoc {
  return {
    version: 1, meta: { title: 't' }, root: 'main',
    assets: {
      music: { type: 'audio', src: 'music.mp3' }, clip: { type: 'video', src: 'clip.mp4' },
      'analysis-music': { type: 'json', src: 'analysis.json' }, 'transcription-clip': { type: 'json', src: 't.json' },
    },
    compositions: {
      main: {
        name: 'main', width: 1920, height: 1080, fps: 30, duration: 10, markers: [{ t: 6, label: 'reveal' }],
        order: ['bed', 'v1', 'v2', 'title', 'card'],
        layers: {
          bed: { type: 'audio', in: 0, out: 10, props: { audio: 'music', start: 2, gain: -6 } },
          v1: { type: 'video', in: 0, out: 3, props: { video: 'clip', start: 0 } },
          v2: { type: 'video', in: 3, out: 8, props: { video: 'clip', start: 5 } },
          title: { type: 'text', in: 1, out: 4, props: { text: 'Hi' } },
          card: { type: 'shape.rect', in: 2.5, props: {} },
        },
      },
    },
  } as unknown as TrammeDoc;
}

function context(doc = project(), extra: Partial<ToolContext> = {}) {
  const written: Record<string, unknown> = {};
  const ctx = {
    doc, compId: 'main', time: 5.5, selection: [], registry: builtinRegistry(), signal: new AbortController().signal,
    assetUrl: (id: string) => `http://x/${id}`, readText: async () => null,
    writeFile: async (p: string, data: unknown) => { written[p] = data; return p; },
    renderStill: async () => '', transcript: async () => { throw new Error('no transcript'); },
    ...extra,
  } as unknown as ToolContext;
  return { ctx, written };
}

beforeEach(() => {
  vi.stubGlobal('location', { href: 'http://x/' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/sounds/catalog.json')) return Response.json({ sounds: catalog });
    if (u.endsWith('/api/sounds')) return Response.json([]);
    // the music's analysis: beats every 0.5 s of the file, bars every 2 s
    if (u.endsWith('/analysis-music')) return Response.json({ version: 1, kind: 'audio-analysis', source: 'music', duration: 20, rate: 50, envelope: { rms: [], low: [], mid: [], high: [] }, tempo: 120, beats: [2, 2.5, 3, 3.5, 4], downbeats: [2, 4, 6], onsets: [], sections: [] });
    return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('moments of a video', () => {
  it('names them from the document: entrances, exits, markers, cuts, beats and bars where the music plays, now', async () => {
    const { ctx } = context();
    expect(await momentsOf(ctx, undefined, 'entrances', undefined)).toEqual([1, 2.5, 3]);
    expect(await momentsOf(ctx, undefined, 'entrances', ['title'])).toEqual([1]);
    expect(await momentsOf(ctx, undefined, 'exits', undefined)).toEqual([3, 4, 8]);
    expect(await momentsOf(ctx, undefined, 'markers, now', undefined)).toEqual([5.5, 6]);
    expect(await momentsOf(ctx, undefined, 'cuts', undefined)).toEqual([3]);
    // the music starts 2 s into its file: its beats fall 2 s earlier in the composition
    expect(await momentsOf(ctx, undefined, 'bars', undefined)).toEqual([0, 2, 4]);
    expect(await momentsOf(ctx, [1.01, '2'], undefined, undefined)).toEqual([1, 2]);
    expect(await momentsOf(ctx, '7.5, 99', undefined, undefined)).toEqual([7.5]);
    await expect(momentsOf(ctx, undefined, 'sometimes', undefined)).rejects.toThrow('unknown moment');
  });
});

describe('the sfx tool', () => {
  it('lists what a search finds, with when each lands and how loud it is', async () => {
    const { ctx } = context();
    const out = await tool('sfx').run({ query: 'metal hit heavy' }, ctx) as { text: string; ops?: unknown };
    expect(out.text).toMatch(/impact-impact-metal-heavy-000: Impact metal heavy 1 \[impact\] .* lands at 0\.0\d s, loud -?\d/);
    expect(out.text).toContain('5 variants');
    expect(out.ops).toBeUndefined();
  });

  it('places a sound so its hit falls on each moment, its variants alternating, copied into the project', async () => {
    const { ctx, written } = context();
    const out = await tool('sfx').run({ sound: 'impact-impact-metal-heavy-000', on: 'entrances', gain: -10 }, ctx) as { ops: any[] };
    const metal = variantsOf(catalog, catalog.find((e) => e.id === 'impact-impact-metal-heavy-000')!);
    const layers = out.ops.filter((o) => o.op === 'add' && /\/layers\//.test(o.path)).map((o) => o.value);
    expect(layers.map((l) => l.props.audio)).toEqual(metal.slice(0, 3).map((e) => `sound-${e.id}`));
    layers.forEach((l, i) => {
      expect(l.in + metal[i].peakAt).toBeCloseTo([1, 2.5, 3][i], 3);
      expect(l.props.gain).toBe(-10);
    });
    expect(out.ops.filter((o) => o.path === '/compositions/main/order/-')).toHaveLength(3);
    expect(Object.keys(written)).toEqual(metal.slice(0, 3).map((e) => `assets/sounds/${e.id}.ogg`));
  });

  it('starts music and jingles on the moment, and a sound repeated alone varies its speed a little', async () => {
    const { ctx } = context();
    const out = await tool('sfx').run({ sound: 'jingle-hit00', at: [2, 6], vary: false }, ctx) as { ops: any[] };
    const layers = out.ops.filter((o) => /\/layers\//.test(o.path)).map((o) => o.value);
    expect(layers.map((l) => l.in)).toEqual([2, 6]);
    expect(layers.every((l) => l.props.rate === undefined)).toBe(true);
    const lone = { ...catalog.find((e) => e.id === 'interface-tick-001')!, family: undefined };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('catalog.json') ? Response.json({ sounds: [lone] }) : String(url).endsWith('/api/sounds') ? Response.json([]) : new Response(new Blob([new Uint8Array([1])], { type: 'audio/ogg' })))));
    // a fresh module: the library is read again
    vi.resetModules();
    const fresh = await import('../src/sound.ts');
    const again = await fresh.SOUND_TOOLS.find((x) => x.name === 'sfx')!.run({ sound: lone.id, at: [1, 2, 3] }, context().ctx) as { ops: any[] };
    const rates = again.ops.filter((o) => /\/layers\//.test(o.path)).map((o) => o.value.props.rate ?? 1);
    expect(new Set(rates).size).toBe(3);
    expect(rates.every((r) => r > 0.95 && r < 1.05)).toBe(true);
  });

  it('says where to place when nothing tells it', async () => {
    const { ctx } = context();
    const out = await tool('sfx').run({ sound: 'impact-impact-metal-heavy-000' }, ctx) as { text: string; ops: any[] };
    expect(out.text).toContain('Not placed');
    expect(out.ops.every((o) => o.path.startsWith('/assets/'))).toBe(true);
  });
});

describe('the duck tool', () => {
  it('lowers the music under each stretch of speech and brings it back between them', async () => {
    // the clip speaks at 1–2 s and 2.3–3 s of its file (one stretch), then at 6–7 s (in v2, played from 5 s: composition 4–5 s)
    const words: Transcript['words'] = [{ w: 'Hello', s: 1, e: 1.5 }, { w: 'there', s: 1.6, e: 2 }, { w: 'friend', s: 2.3, e: 3 }, { w: 'Later', s: 6, e: 7 }];
    const transcript: Transcript = { version: 1, source: 'clip', duration: 10, words };
    const { ctx } = context(project(), { transcript: async () => transcript });
    const out = await tool('duck').run({ depth: -12, attack: 0.2, release: 0.5 }, ctx) as { ops: any[] };
    expect(out.ops).toHaveLength(1);
    expect(out.ops[0]).toMatchObject({ op: 'replace', path: '/compositions/main/layers/bed/props/gain' });
    expect(out.ops[0].value.$k).toEqual([
      { t: 0.8, v: -6 }, { t: 1, v: -18 }, { t: 3, v: -18 }, { t: 3.5, v: -6 },
      { t: 3.8, v: -6 }, { t: 4, v: -18 }, { t: 5, v: -18 }, { t: 5.5, v: -6 },
    ]);
  });
});
