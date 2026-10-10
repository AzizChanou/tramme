// The sound of a video, made at authoring time: sounds of the library placed
// on the moments that matter (sfx), sounds written as code (synth), sounds
// made by a provider (generate-sound), the music ducked under a voice (duck),
// a sound kept in the library shared by the projects (sound-keep). Tools of the
// editor's vocabulary: the assistant reaches them with use_tool, the user from
// the / menu. Every sound ends as a file of the project played by an audio
// layer; the mixer of @tramme/render plays it the same in the preview and
// the exports.

import { audioClips, Evaluator, isAudioAnalysis, pointer, searchSounds, soundCues, soundFigures, soundFlaws, staticValue, variantsOf, type Layer, type Op, type SoundCue, type SoundEntry, type SoundFigures, type SoundRole, type SoundVisual, type ToolContext, type ToolType } from '@tramme/core';
import { encodeWav, renderSynth, SYNTH_MAX } from '@tramme/render';
import { api } from './api.ts';
import { payFor } from './confirm.ts';
import { clip, freshId, SOUND_GROUP, soundGroupOf } from './model.ts';
import { prefs } from './settings.ts';
import { analyses } from './perception.ts';
import { SOUND_PRESETS } from './sound-presets.ts';
import { canvas, caption, drawSpectrogram, drawWave, INK, mark } from './sound-pictures.ts';
import { t } from './i18n/index.ts';

// ── the library ──────────────────────────────────────────────
let shipped: Promise<SoundEntry[]> | null = null;

/** every sound at hand: recorded ones shipped with tramme, the presets written as code, the user's library */
export async function soundLibrary(): Promise<SoundEntry[]> {
  shipped ??= fetch(new URL('/sounds/catalog.json', location.href)).then((r) => (r.ok ? r.json() : { sounds: [] })).then((j: { sounds: SoundEntry[] }) => j.sounds).catch(() => []);
  const mine = await api.sounds().then((list) => list.flatMap((x) => (x.entry ? [{ ...(x.entry as SoundEntry), source: 'library' as const, file: x.name }] : []))).catch(() => []);
  return [...(await shipped), ...SOUND_PRESETS, ...mine];
}

const fileUrl = (e: SoundEntry) => (e.source === 'library' ? api.soundUrl(e.file!) : new URL(`/sounds/${e.file}`, location.href).href);
const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? 'wav';
const TYPE: Record<string, string> = { mp3: 'audio/mpeg', mpeg: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', mp4: 'audio/mp4' };
const extOf = (type: string) => Object.entries(TYPE).find(([, m]) => type.startsWith(m))?.[0] ?? 'wav';

/** what the assistant reads of a sound in a list */
const line = (e: SoundEntry, all: SoundEntry[]) => {
  const n = variantsOf(all, e).length;
  return `- ${e.id}: ${e.title} [${e.kind}] ${e.duration.toFixed(2)} s, lands at ${e.peakAt.toFixed(2)} s${e.loudDb !== undefined ? `, loud ${e.loudDb} dB` : ''}${n > 1 ? `, ${n} variants` : ''}${e.source === 'preset' ? ', written as code' : e.source === 'library' ? ', your library' : ''} (${e.tags.slice(0, 6).join(', ')})`;
};

// ── moments ──────────────────────────────────────────────────
/** a list of times or ids given as an array, a number, or text ("1.5, 3") from the / menu */
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'number' ? [String(v)] : typeof v === 'string' ? v.split(/[\s,;]+/) : []).filter(Boolean);

export const MOMENTS = ['cues', 'heroes', 'cuts', 'moves', 'lands', 'appears', 'now', 'entrances', 'exits', 'markers', 'beats', 'bars'] as const;

/** a time to sound, with what the picture does there when a cue says so */
export interface Moment { t: number; visual?: SoundVisual; weight?: 'hero' | 'support' }

const cueCache = new WeakMap<object, Map<string, SoundCue[]>>();
/** the cues of the composition, read from the timing of its picture (once per document) */
export function cuesOf(ctx: ToolContext): SoundCue[] {
  let byComp = cueCache.get(ctx.doc);
  if (!byComp) { byComp = new Map(); cueCache.set(ctx.doc, byComp); }
  let list = byComp.get(ctx.compId);
  if (!list) { list = soundCues(new Evaluator(ctx.doc, ctx.registry), ctx.compId); byComp.set(ctx.compId, list); }
  return list;
}

/** the cue words: which cues each one names */
const CUE_WORDS: Record<string, (c: SoundCue) => boolean> = {
  cues: () => true, heroes: (c) => c.weight === 'hero', moves: (c) => c.kind === 'move', lands: (c) => c.kind === 'land', appears: (c) => c.kind === 'appear',
};

/**
 * Composition times named by the document, on its frames: numbers as they
 * are; the cues of the picture (cues, heroes, moves, lands, appears: what the
 * animation does, see the cues tool); cuts (where the picture changes, between
 * video layers, and the shots found by the shots tool); now (the editor's
 * time); entrances and exits of layers (the ones given, or every visible layer
 * not a sound); markers; beats and bars (of a music analysed by the beats
 * tool, where its layer plays it). A moment from a cue carries what it
 * underlines and its weight.
 */
export async function momentsOf(ctx: ToolContext, at: unknown, on: unknown, layers: unknown): Promise<Moment[]> {
  const c = ctx.doc.compositions[ctx.compId], fps = c.fps;
  const found: Moment[] = listOf(at).map(Number).filter(Number.isFinite).map((t) => ({ t }));
  const push = (times: number[]) => found.push(...times.map((t) => ({ t })));
  const words = listOf(on).map((w) => w.toLowerCase());
  const named = listOf(layers).filter((id) => c.layers[id]);
  const visual = (Object.entries(c.layers) as [string, Layer][]).filter(([id, l]) => (named.length ? named.includes(id) : l.type !== 'audio' && l.visible !== false));
  const cued = (keep: (x: SoundCue) => boolean) => found.push(...cuesOf(ctx).filter((x) => keep(x) && (!named.length || named.includes(x.layer))).map((x) => ({ t: x.t, visual: x.kind, weight: x.weight })));
  // where a layer plays a file: composition time of a time in that file
  const playing = (asset: string) => (Object.values(c.layers) as Layer[]).filter((l) => (l.type === 'audio' || l.type === 'video') && staticValue(l.props?.[l.type]) === asset);
  const inFile = (asset: string, fileTimes: number[]) => playing(asset).flatMap((l) => {
    const start = Number(staticValue(l.props?.start) ?? 0), from = l.in ?? 0, to = l.out ?? c.duration;
    return fileTimes.map((x) => from + (x - start)).filter((x) => x >= from && x < to);
  });
  const read = words.some((w) => ['cuts', 'beats', 'bars'].includes(w)) ? await analyses(ctx) : () => undefined;
  const assets = Object.keys(ctx.doc.assets);
  for (const w of words) {
    if (CUE_WORDS[w]) cued(CUE_WORDS[w]);
    else if (w === 'now') push([ctx.time]);
    else if (w === 'entrances') push(visual.map(([, l]) => l.in ?? 0).filter((x) => named.length || x > 0));
    else if (w === 'exits') push(visual.map(([, l]) => l.out ?? c.duration).filter((x) => x < c.duration));
    else if (w === 'markers') push((c.markers ?? []).map((m) => m.t));
    else if (w === 'cuts') {
      cued((x) => x.kind === 'cut');
      push((Object.values(c.layers) as Layer[]).filter((l) => l.type === 'video').map((l) => l.in ?? 0).filter((x) => x > 0));
      for (const id of assets.filter((a) => a.startsWith('shots-'))) {
        const s = read(id) as { source?: string; cuts?: number[] } | undefined;
        if (s?.source && Array.isArray(s.cuts)) push(inFile(s.source, s.cuts));
      }
    } else if (w === 'beats' || w === 'bars') {
      for (const id of assets.filter((a) => a.startsWith('analysis-'))) {
        const a = read(id);
        if (isAudioAnalysis(a) && a.source) push(inFile(a.source, w === 'bars' ? a.downbeats : a.beats));
      }
    } else throw new Error(`unknown moment "${w}": ${MOMENTS.join(', ')}, or times in seconds`);
  }
  // one moment a frame, the one a cue describes first
  const byFrame = new Map<number, Moment>();
  for (const m of found) {
    const f = Math.round(m.t * fps), had = byFrame.get(f);
    if (f < 0 || f / fps >= c.duration) continue;
    if (!had || (!had.visual && m.visual)) byFrame.set(f, { ...m, t: +(f / fps).toFixed(4) });
  }
  return [...byFrame.values()].sort((a, b) => a.t - b.t);
}

// ── a sound in the project, placed ───────────────────────────
interface ProjectSound { asset: string; ops: Op[]; figures: SoundFigures; reload: string[] }

/** a file kept under assets/sounds/ and declared as an audio asset (replaced when made again); `made`: what made it, or where it comes from and its license */
async function keepFile(ctx: ToolContext, name: string, data: Blob, title: string, figures: SoundFigures, made?: unknown): Promise<ProjectSound> {
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'sound';
  const asset = `sound-${slug}`;
  const path = await ctx.writeFile(`assets/sounds/${slug}.${extOf(data.type)}`, data);
  if (made) await ctx.writeFile(`assets/sounds/${slug}.sound.json`, JSON.stringify(made, null, 1));
  const had = !!ctx.doc.assets[asset];
  return { asset, figures, reload: had ? [asset] : [], ops: [{ op: had ? 'replace' : 'add', path: pointer('assets', asset), value: { type: 'audio', src: path, name: title } }] };
}

/** the measures of a sound file: decoded the way the mixer will */
export async function measure(data: Blob): Promise<{ buffer: AudioBuffer; figures: SoundFigures }> {
  const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await data.arrayBuffer());
  return { buffer, figures: soundFigures(channelsOf(buffer), buffer.sampleRate) };
}

export const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
const wavBlob = (b: AudioBuffer) => new Blob([encodeWav(b) as BlobPart], { type: 'audio/wav' });

/** a sound of the library brought into the project: its file copied (with where it comes from and its license), or its code rendered */
async function bring(ctx: ToolContext, e: SoundEntry): Promise<ProjectSound> {
  if (e.code) {
    const buffer = await renderSynth(e.code, { duration: e.duration, signal: ctx.signal });
    return keepFile(ctx, e.id, wavBlob(buffer), e.title, soundFigures(channelsOf(buffer), buffer.sampleRate), { code: e.code, duration: e.duration, from: e.id });
  }
  const asset = `sound-${e.id}`.slice(0, 64);
  const figures: SoundFigures = { duration: e.duration, peakAt: e.peakAt, peakDb: e.peakDb ?? 0, loudDb: e.loudDb ?? 0, rmsDb: 0, start: 0, end: e.duration };
  if (ctx.doc.assets[asset]) return { asset, figures, ops: [], reload: [] };
  return keepFile(ctx, e.id, await fileOf(e, ctx.signal), e.title, figures, creditOf(e));
}

/** the file of a recorded sound of the library, typed by its extension */
async function fileOf(e: SoundEntry, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(fileUrl(e), { signal });
  if (!r.ok) throw new Error(`sound ${e.id} not found (HTTP ${r.status})`);
  const blob = await r.blob();
  return new Blob([blob], { type: TYPE[ext(e.file!)] ?? blob.type });
}

/** where a sound of the library comes from, kept beside its file for the credits */
const creditOf = (e: SoundEntry) => ({ from: e.id, title: e.title, ...(e.license ? { license: e.license } : {}), ...(e.author ? { author: e.author } : {}), ...(e.url ? { url: e.url } : {}) });

/** sounds whose moment is their start: music, voices, beds, jingles */
const FROM_START = new Set(['music', 'voice', 'ambience', 'sting']);
/** the bus of a kind of sound (effects are the default) */
const ROLE: Record<string, SoundRole> = { music: 'music', voice: 'voice', ambience: 'ambience' };
/** each sound stacked on a hero comes this much under the one before (dB) */
const STACK_DB = 4;

interface Placement { asset: string; title: string; figures: SoundFigures; kind: string }

/** the group the sounds are kept in, at the bottom of the stack; made the first time */
function soundGroup(ctx: ToolContext, taken: Record<string, unknown>, ops: Op[]): string {
  const found = soundGroupOf(ctx.doc.compositions[ctx.compId]);
  if (found) return found;
  const id = freshId(taken, 'sound');
  taken[id] = true;
  ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { type: 'group', name: SOUND_GROUP, children: [] } });
  ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'order', 0), value: id });
  return id;
}

/**
 * Audio layers playing each sound so its moment falls on each moment: the
 * moment it lands on (a hit, the pass of a whoosh, the top of a riser), or
 * its start for music and voices. Each entry of `sounds` is a stack played
 * together, peaks aligned, each layer 4 dB under the one before (a hero:
 * hit+boom); several entries alternate (variants), and rates vary a little
 * when one sound repeats, so it does not sound copied. A moment from a cue
 * gives the layer what it underlines and its weight. The layers go in the
 * Sound group.
 */
function place(ctx: ToolContext, sounds: Placement[][], moments: Moment[], o: { gain: number; rate?: number; align?: 'peak' | 'start'; vary: boolean; weight?: 'hero' | 'support' }): { ops: Op[]; layers: string[] } {
  const c = ctx.doc.compositions[ctx.compId], taken: Record<string, unknown> = { ...c.layers };
  const ops: Op[] = [], layers: string[] = [];
  if (!moments.length) return { ops, layers };
  const group = soundGroup(ctx, taken, ops);
  moments.forEach((m, i) => {
    const stack = sounds[i % sounds.length];
    const nudge = o.vary && sounds.length === 1 && moments.length > 1 ? 1 + ((((i * 0.618034) % 1) - 0.5) * 0.08) : 1;
    const rate = +((o.rate ?? 1) * nudge).toFixed(3);
    const weight = o.weight ?? m.weight;
    stack.forEach((s, k) => {
      const align = o.align ?? (FROM_START.has(s.kind) ? 'start' : 'peak');
      const lead = (align === 'peak' ? s.figures.peakAt : 0) / rate;
      let at = m.t - lead, start = 0;
      if (at < 0) { start = -at * rate; at = 0; }
      const out = Math.min(c.duration, at + (s.figures.duration - start) / rate);
      if (out <= at) return;
      const id = freshId(taken, s.asset.replace(/^sound-/, 'sfx-'));
      taken[id] = true;
      layers.push(id);
      const props: Record<string, unknown> = { audio: s.asset, start: +start.toFixed(4), gain: +(o.gain - STACK_DB * k).toFixed(1) };
      if (rate !== 1) props.rate = rate;
      if (ROLE[s.kind]) props.role = ROLE[s.kind];
      if (weight === 'hero') props.weight = 'hero';
      if (m.visual) props.visual = m.visual;
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { type: 'audio', name: `${s.title} · ${m.t.toFixed(2)} s`, in: +at.toFixed(4), out: +out.toFixed(4), props } });
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', group, 'children', '-'), value: id });
    });
  });
  return { ops, layers };
}

// ── the bed makes room for a hero ────────────────────────────
/** the music and ambience layers: the bed the effects sound over */
const bedLayers = (ctx: ToolContext) => audioClips(ctx.doc, ctx.compId).filter((x) => x.role === 'music' || x.role === 'ambience').map((x) => x.layerId);

/**
 * Keys written into an animated property of layers, over spans: the value it
 * had at each span's edges kept, the keys inside a span replaced. How a stop
 * before a hero and a build into it are written over a ducking already there.
 */
function shapeOps(ctx: ToolContext, ids: string[], prop: string, spans: { from: number; to: number; keys: (base: (t: number) => number) => { t: number; v: number }[] }[], rest: number): Op[] {
  const c = ctx.doc.compositions[ctx.compId], ev = new Evaluator(ctx.doc, ctx.registry);
  return ids.flatMap((id) => {
    const l = c.layers[id];
    if (!l) return [];
    const base = (t: number) => { const v = ev.value(`${id}.${prop}`, t, ctx.compId); return typeof v === 'number' ? v : rest; };
    const raw = l.props?.[prop] as { $k?: { t: number; v: number }[] } | number | undefined;
    let keys = (typeof raw === 'object' && raw?.$k ? raw.$k : []).map((k) => ({ ...k }));
    const added: { t: number; v: number }[] = [];
    for (const s of spans) {
      added.push({ t: +s.from.toFixed(3), v: base(s.from) }, ...s.keys(base).map((k) => ({ t: +k.t.toFixed(3), v: +k.v.toFixed(2) })), { t: +s.to.toFixed(3), v: base(s.to) });
      keys = keys.filter((k) => k.t < s.from || k.t > s.to);
    }
    const merged = [...keys, ...added].sort((a, b) => a.t - b.t).filter((k, i, all) => i === 0 || k.t > all[i - 1].t);
    return [{ op: l.props?.[prop] === undefined ? 'add' : 'replace', path: pointer('compositions', ctx.compId, 'layers', id, 'props', prop), value: { $k: merged } } as Op];
  });
}

/** a dead stop before each moment: the bed falls 24 dB over the 0.4 s before it, so the hit lands in silence, and comes back after */
const stopOps = (ctx: ToolContext, times: number[]) => shapeOps(ctx, bedLayers(ctx), 'gain', times.map((t) => ({
  from: Math.max(0, t - 0.4), to: t + 0.35, keys: (base) => [{ t: t - 0.05, v: base(t - 0.4) - 24 }, { t, v: base(t - 0.4) - 24 }],
})), 0);

/** a build into each moment: the bed thins out (its low end cut, 40 to 300 Hz) over the 2 s before it, whole again right after */
const buildOps = (ctx: ToolContext, times: number[]) => shapeOps(ctx, bedLayers(ctx), 'lowCut', times.map((t) => ({
  from: Math.max(0, t - 2), to: t + 0.05, keys: (base) => [{ t: Math.max(0, t - 2) + 0.01, v: Math.max(40, base(t - 2)) }, { t: t - 0.01, v: Math.max(300, base(t)) }],
})), 0);

const ALIGN = { enum: ['peak', 'start'], title: 'Align', description: 'peak: the moment the sound lands on falls on the time (hits, whooshes, risers); start: its beginning does (music, voices, jingles)' };
const PLACING = {
  at: { type: ['array', 'number', 'string'], title: 'At (s)', description: 'composition times, e.g. [1.2, 3.5] or "1.2, 3.5"' },
  on: { type: 'string', title: 'On', description: `moments named by the document, comma separated: ${MOMENTS.join(', ')} (cues, heroes, moves, lands, appears: what the animation does, see the cues tool)` },
  layers: { type: ['array', 'string'], format: 'layer', title: 'Layers', description: 'whose cues, entrances or exits (every visible layer when empty)' },
  gain: { type: 'number', minimum: -40, maximum: 12, title: 'Volume (dB)', description: 'the level of the Sound settings by default (-8 dB unless changed): under a voice or music; the mix tool balances it against the bed' },
  align: ALIGN,
};

/** where a tool places its sound: the moments asked for; none asked, nowhere (the sound only joins the project) */
const timesOf = (ctx: ToolContext, input: { at?: unknown; on?: unknown; layers?: unknown }) => momentsOf(ctx, input.at, input.on, input.layers);

const placedText = (p: { layers: string[] }, moments: Moment[]) => (p.layers.length ? `Placed at ${moments.map((m) => `${m.t.toFixed(2)}${m.visual ? ` (${m.weight === 'hero' ? 'hero ' : ''}${m.visual})` : ''}`).join(', ')} s (layers ${p.layers.join(', ')}).` : 'Not placed (no time given): the asset is in the project, place it with at or on.');

// ── what a sound looks like ──────────────────────────────────
/** its waveform, the moment it lands on marked: the assistant cannot hear, it reads this */
function waveform(buffer: AudioBuffer, figures: SoundFigures, label: string): string {
  const W = 720, H = 150, { el, g } = canvas(W, H);
  drawWave(g, buffer.getChannelData(0), 0, 20, W, H - 24);
  mark(g, (figures.peakAt / Math.max(1e-6, figures.duration)) * W, 0, H, INK.hero);
  caption(g, `${label} · ${figures.duration.toFixed(2)} s · lands at ${figures.peakAt.toFixed(2)} s · peak ${figures.peakDb} dB · loud ${figures.loudDb} dB`, 8, 14);
  return el.toDataURL('image/png');
}

/** a sound of the library as samples: its file decoded, or its code rendered */
async function samplesOf(e: SoundEntry, signal?: AbortSignal): Promise<AudioBuffer> {
  if (e.code) return renderSynth(e.code, { duration: e.duration, signal });
  return (await measure(await fileOf(e, signal))).buffer;
}

/** candidates side by side, each its waveform over its spectrogram, the moment it lands on marked: how the assistant picks one */
async function soundSheet(ctx: ToolContext, entries: SoundEntry[]): Promise<string> {
  const W = 380, H = 190, cols = 2, rows = Math.ceil(entries.length / cols), { el, g } = canvas(W * cols, H * rows);
  for (const [i, e] of entries.entries()) {
    const x = (i % cols) * W, y = Math.floor(i / cols) * H;
    const b = await samplesOf(e, ctx.signal).catch(() => null);
    caption(g, `${e.id}`, x + 6, y + 13, INK.text, '600 11px system-ui, sans-serif');
    if (!b) { caption(g, 'could not be read', x + 6, y + 30, INK.faint); continue; }
    const d = b.getChannelData(0);
    drawWave(g, d, x + 4, y + 18, W - 8, 52);
    drawSpectrogram(g, d, b.sampleRate, x + 4, y + 74, W - 8, H - 80);
    mark(g, x + 4 + (e.peakAt / Math.max(1e-6, b.duration)) * (W - 8), y + 18, H - 24, INK.hero);
  }
  return el.toDataURL('image/png');
}

const figuresText = (f: SoundFigures) => `${f.duration.toFixed(2)} s, lands at ${f.peakAt.toFixed(2)} s, sound from ${f.start.toFixed(2)} to ${f.end.toFixed(2)} s, peak ${f.peakDb} dBFS, loud ${f.loudDb} dBFS (average ${f.rmsDb})`;

// ── the tools ────────────────────────────────────────────────
/** kinds a recording always beats code for: a hit, a click, a whoosh written as code sounds cheap */
const RECORDED_FIRST = new Set(['impact', 'hit', 'boom', 'thump', 'tap', 'click', 'tick', 'pop', 'whoosh', 'swish', 'transition', 'ui', 'key']);

const sfx: ToolType<{ query?: string; sound?: string; at?: unknown; on?: string; layers?: unknown; gain?: number; rate?: number; vary?: boolean; align?: 'peak' | 'start'; weight?: 'hero' | 'support'; stop?: boolean; build?: boolean }> = {
  name: 'sfx', title: 'Sound effects', description: 'searches the sound library (recorded sounds, sounds written as code, your own) and places a sound on moments of the video, its hit on the frame; a hero stacks sounds and makes the bed stop before it',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', title: 'Search', description: 'what it should sound like: "metal hit heavy", "whoosh", "riser", "click", "glitch", "logo sting"' },
      sound: { type: 'string', title: 'Sound', description: 'id of a sound found by a search, to place it; several joined with + play together, peaks aligned, each 4 dB under the one before (a hero: "boom-id+hit-id", a soft one: "thump-id+tap-id")' },
      ...PLACING,
      rate: { type: 'number', minimum: 0.25, maximum: 4, title: 'Speed', description: 'under 1 lower and longer, over 1 higher and shorter' },
      vary: { type: 'boolean', title: 'Vary', description: 'alternate its variants on repeated moments (as the Sound settings say by default)' },
      weight: { enum: ['hero', 'support'], title: 'Weight', description: 'hero: one of the few moments the film is built around; the cues say it by default' },
      stop: { type: 'boolean', title: 'Stop before', description: 'the music and ambience fall 24 dB over the 0.4 s before each moment, so a hero lands in silence' },
      build: { type: 'boolean', title: 'Build', description: 'the music thins out (its low end cut) over the 2 s before each moment, into a hero' },
    },
  },
  ai: {
    when: 'to give the video its sound. Read the cues first (cues tool), then sound the cuts with a whoosh or transition, the lands with a thump or tap, the appears with a pop or click, the moves with a swish; the heroes with a stack (sound "a+b") and stop. Search (query): the list says when each lands and how loud, the sheet shows each waveform and spectrogram: reject a clip with two events in it, a steady noise, clicks inside a whoosh, clean sine lines on a physical sound. Then place one (sound, with at or on)',
    avoid: 'a hit, a click or a whoosh written as code when a recording exists; meme sounds; a sound on every element; two hits at the same instant; sounds louder than the voice. After placing, balance them (mix) and check',
  },
  async run({ query, sound, at, on, layers, gain = prefs.peek().effectsDb, rate, vary = prefs.peek().varySounds, align, weight, stop, build }, ctx) {
    const all = await soundLibrary();
    if (!sound) {
      const hits = searchSounds(all, query ?? '', { limit: 15 });
      // recordings first for what code makes cheap, unless code is asked for
      const found = /synth|code/i.test(query ?? '') ? hits : [...hits.filter((e) => !(e.code && RECORDED_FIRST.has(e.kind))), ...hits.filter((e) => e.code && RECORDED_FIRST.has(e.kind))];
      if (!found.length) return { text: `No sound for "${query}". Kinds in the library: ${[...new Set(all.map((e) => e.kind))].join(', ')}. Or find recordings (sound-find), write one with the synth tool, or have one made with generate-sound.`, notice: t('sound.nothingFound') };
      const sheet = await soundSheet(ctx, found.slice(0, 6)).catch(() => null);
      return {
        text: [`Sounds for "${query ?? ''}" (${all.length} in the library):`, ...found.map((e) => line(e, all)), 'Place one: sfx with sound (its id, or ids joined with + for a stack) and at (times) or on (cues, heroes, cuts, moves, lands, appears, entrances, exits, markers, beats, bars, now). Its variants alternate on repeated moments.'].join('\n'),
        ...(sheet ? { images: [{ url: sheet, caption: t('sound.sheet') }] } : {}),
        notice: t('sound.foundN', { n: found.length }),
      };
    }
    const ids = sound.split('+').map((s) => s.trim()).filter(Boolean);
    const entries = ids.map((id) => all.find((x) => x.id === id) ?? null);
    const missing = ids.filter((_, i) => !entries[i]);
    if (missing.length) throw new Error(`no sound ${missing.map((m) => `"${m}"`).join(', ')} in the library: search first (query)`);
    const moments = await timesOf(ctx, { at, on, layers });
    // one stack per variant: a single sound alternates its variants, a stack stays as asked
    const picks: SoundEntry[][] = ids.length === 1 && vary && moments.length > 1 ? variantsOf(all, entries[0]!).slice(0, Math.max(1, moments.length)).map((e) => [e]) : [entries as SoundEntry[]];
    const brought = new Map<string, ProjectSound>();
    for (const e of picks.flat()) if (!brought.has(e.id)) brought.set(e.id, await bring(ctx, e));
    const stacks = picks.map((stack) => stack.map((e) => ({ asset: brought.get(e.id)!.asset, title: e.title, figures: brought.get(e.id)!.figures, kind: e.kind })));
    const placed = place(ctx, stacks, moments, { gain, rate, align, vary, weight });
    // the bed makes room: on every moment asked for, or on the heroes among them
    const room = moments.filter((m) => (weight ?? m.weight) === 'hero' || (weight === undefined && !m.weight)).map((m) => m.t);
    const bed = [...(stop ? stopOps(ctx, room) : []), ...(build ? buildOps(ctx, room) : [])];
    const title = entries.map((e) => e!.title).join(' + ');
    return {
      ops: [...[...brought.values()].flatMap((b) => b.ops), ...placed.ops, ...bed], reload: [...brought.values()].flatMap((b) => b.reload), label: title,
      text: `${title}${picks.length > 1 ? ` (${picks.length} variants)` : ''}: ${placedText(placed, moments)} Gain ${gain} dB.${bed.length ? ` The bed ${[stop && 'stops', build && 'builds'].filter(Boolean).join(' and ')} before ${room.length} moment(s).` : stop || build ? ' No music or ambience layer to stop or build.' : ''} Balance it against the bed with the mix tool.`,
      notice: t('sound.placed', { name: title, n: placed.layers.length }),
    };
  },
};

const synth: ToolType<{ name: string; code: string; duration: number; seed?: number; at?: unknown; on?: string; layers?: unknown; gain?: number; align?: 'peak' | 'start' }> = {
  name: 'synth', title: 'Write a sound', description: 'makes a sound from Web Audio code (oscillators, noise, filters, envelopes), saves it in the project and places it; answers with its waveform and measures',
  input: {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Name', description: 'lower case, e.g. "logo-whoosh"; the same name makes the sound again' },
      code: { type: 'string', title: 'Code', description: 'body of an async function (ctx, kit): ctx is an OfflineAudioContext (stereo, 48 kHz, `duration` long); connect to ctx.destination and start the sources. kit: duration, seed, random() (seeded), noise(color?, seconds?) (white, pink, brown; a source to start), env(param, [[t, v], …], "linear" | "exp"). The result is brought to a -1 dBFS peak.' },
      duration: { type: 'number', minimum: 0.05, maximum: SYNTH_MAX, title: 'Length (s)' },
      seed: { type: 'integer', title: 'Seed', description: 'another seed, another take of the same code' },
      ...PLACING,
    },
    required: ['name', 'code', 'duration'],
  },
  ai: {
    when: 'when no sound of the library fits: a sound in the rhythm of the music, a tone in its key, a riser of an exact length, a designed logo sound. Start from a preset of the library (search "synth": its code is the example), look at the waveform, adjust',
    example: { name: 'logo-whoosh', duration: 0.9, code: "const n = kit.noise('pink'), f = ctx.createBiquadFilter(); f.type = 'bandpass'; kit.env(f.frequency, [[0, 300], [0.5, 2500], [0.9, 500]], 'exp'); const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [0.5, 1], [0.9, 0.001]], 'exp'); n.connect(f).connect(g).connect(ctx.destination); n.start(0);", on: 'entrances' },
  },
  async run({ name, code, duration, seed = 1, at, on, layers, gain = prefs.peek().effectsDb, align }, ctx) {
    const buffer = await renderSynth(code, { duration, seed, signal: ctx.signal });
    const figures = soundFigures(channelsOf(buffer), buffer.sampleRate);
    const kept = await keepFile(ctx, name, wavBlob(buffer), name, figures, { code, duration, seed });
    const times = await timesOf(ctx, { at, on, layers });
    const placed = place(ctx, [[{ asset: kept.asset, title: name, figures, kind: 'synth' }]], times, { gain, align, vary: false });
    return {
      ops: [...kept.ops, ...placed.ops], reload: kept.reload, label: `Sound ${name}`,
      text: `Sound "${name}" saved as asset ${kept.asset}: ${figuresText(figures)}. ${placedText(placed, times)}`,
      images: [{ url: waveform(buffer, figures, name), caption: name }],
      notice: t('sound.written', { name }),
    };
  },
};

/** what the user is asked to pay for, in their words */
const KIND_LABEL: Record<'sfx' | 'music' | 'voice', () => string> = { sfx: () => t('sound.kindSfx'), music: () => t('sound.kindMusic'), voice: () => t('sound.kindVoice') };

const generateSound: ToolType<{ kind: 'sfx' | 'music' | 'voice'; prompt: string; name?: string; duration?: number; voice?: string; style?: string; provider?: string; at?: unknown; on?: string; layers?: unknown; gain?: number; align?: 'peak' | 'start'; keep?: boolean }> = {
  name: 'generate-sound', title: 'Have a sound made', description: 'has a provider make a sound effect, a music bed or a voice-over (the server\'s keys), saves it in the project with what made it and places it',
  input: {
    type: 'object',
    properties: {
      kind: { enum: ['sfx', 'music', 'voice'], title: 'Kind' },
      prompt: { type: 'string', title: 'Prompt', description: 'sfx and music: what it sounds like ("deep cinematic boom with a long tail", "calm lo-fi piano bed, 80 bpm"); voice: the text to say' },
      name: { type: 'string', title: 'Name', description: 'of the file, lower case' },
      duration: { type: 'number', minimum: 0.5, maximum: 600, title: 'Length (s)', description: 'sfx up to 30 s; music from 3 s' },
      voice: { type: 'string', title: 'Voice', description: 'voice-over: a voice of the provider, as the voices tool lists it (ElevenLabs: its id; Gemini: Kore, Puck, Charon…; OpenAI: alloy, coral, sage…)' },
      style: { type: 'string', title: 'Style', description: 'voice-over: how it is said ("warm and calm", "energetic"); with ElevenLabs v4 or v3 it becomes an audio tag, an accent included ("said warmly in a Beninese French accent", "whispers")' },
      provider: { enum: ['elevenlabs', 'openai', 'gemini'], title: 'Provider', description: 'voice-over: the one of the Sound settings by default; otherwise the first one the server has a key for' },
      ...PLACING,
      keep: { type: 'boolean', title: 'Keep in the library', description: 'also keep it in the library shared by the projects' },
    },
    required: ['kind', 'prompt'],
  },
  ai: {
    when: 'when the library and code cannot do it: a music bed, a voice-over, a realistic sound (rain, crowd, a car door). It costs money on the provider: one sound per need, not drafts',
    avoid: 'music under a voice without ducking it (duck); a voice-over text the user did not approve',
  },
  async run({ kind, prompt, name, duration, voice, style, provider, at, on, layers, gain, align, keep }, ctx) {
    const p = prefs.peek();
    // a voice-over in the voice chosen in the settings, unless the call names one
    if (kind === 'voice') {
      provider ??= p.voiceProvider === 'auto' ? undefined : p.voiceProvider;
      voice ??= p.voice || undefined;
    }
    // the ElevenLabs voice model of the settings (the newest by default); the others have one model
    const model = kind === 'voice' && p.voiceModel ? p.voiceModel : undefined;
    // it costs money: the user says yes first, or the turn's allowance does (Sound settings)
    await payFor(t('sound.paidTitle'), t('sound.paidText', { kind: KIND_LABEL[kind](), prompt: clip(prompt, 140) }), t('sound.paidYes'), 'use the library or synth');
    const made = await api.generate({ kind, prompt, duration, voice, style, model, provider }, ctx.signal);
    const { buffer, figures } = await measure(made.blob);
    const label = name ?? `${kind}-${prompt.toLowerCase().split(/\s+/).slice(0, 4).join('-')}`;
    const record = { kind, prompt, provider: made.provider, model: made.model, voice: made.voice, style, duration };
    const kept = await keepFile(ctx, label, made.blob, label, figures, record);
    const times = await timesOf(ctx, { at, on: on ?? (at === undefined ? 'now' : undefined), layers });
    const placed = place(ctx, [[{ asset: kept.asset, title: label, figures, kind: kind === 'sfx' ? 'sfx' : kind }]], times, { gain: gain ?? (kind === 'music' ? p.musicDb : kind === 'voice' ? 0 : p.effectsDb), align, vary: false });
    if (keep) await keepInLibrary(label, made.blob, { kind: kind === 'sfx' ? 'sfx' : kind, title: label, tags: prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).slice(0, 8), figures, prompt, provider: made.provider });
    return {
      ops: [...kept.ops, ...placed.ops], reload: kept.reload, label: `Sound ${label}`,
      text: `${kind} made by ${made.provider} (${made.model}${made.voice ? `, voice ${made.voice}` : ''}), saved as asset ${kept.asset} with its prompt: ${figuresText(figures)}. ${placedText(placed, times)}${keep ? ' Kept in the library.' : ''}${kind === 'music' ? ' Duck it under a voice with duck.' : ''}`,
      images: [{ url: waveform(buffer, figures, label), caption: label }],
      notice: t('sound.made', { name: label, provider: made.provider }),
    };
  },
};

/** a sound kept in the library shared by the projects, with its description */
async function keepInLibrary(title: string, data: Blob, d: { kind: string; title: string; tags: string[]; figures: SoundFigures; prompt?: string; provider?: string } & Pick<SoundEntry, 'license' | 'author' | 'url'>): Promise<SoundEntry> {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'sound';
  const file = `${id}.${extOf(data.type)}`;
  const entry: SoundEntry = {
    id: `mine-${id}`, title: d.title, kind: d.kind, tags: d.tags, source: 'library', file,
    duration: d.figures.duration, peakAt: d.figures.peakAt, peakDb: d.figures.peakDb, loudDb: d.figures.loudDb,
    ...(d.prompt ? { prompt: d.prompt.slice(0, 400) } : {}), ...(d.provider ? { provider: d.provider } : {}),
    ...(d.license ? { license: d.license } : {}), ...(d.author ? { author: d.author } : {}), ...(d.url ? { url: d.url } : {}),
  };
  await api.soundPut(file, data, entry);
  return entry;
}

const soundKeep: ToolType<{ asset: string; title?: string; kind?: string; tags?: unknown }> = {
  name: 'sound-keep', title: 'Keep a sound in the library', description: 'copies a sound of this project into the library shared by the projects, described so a search finds it',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: 'audio', title: 'Sound' },
      title: { type: 'string', title: 'Title' },
      kind: { type: 'string', title: 'Kind', description: 'impact, whoosh, riser, click, sting, music, voice…' },
      tags: { type: ['array', 'string'], title: 'Tags', description: 'words it is found by' },
    },
    required: ['asset'],
  },
  ai: { when: 'the user wants to reuse a sound (their brand sting, a sound they made) in other projects' },
  async run({ asset, title, kind = 'sfx', tags }, ctx) {
    const a = ctx.doc.assets[asset];
    if (!a || a.type !== 'audio') throw new Error(`${asset} is not a sound of this project`);
    const r = await fetch(ctx.assetUrl(asset), { signal: ctx.signal });
    if (!r.ok) throw new Error(`file not found: ${a.src}`);
    const blob = await r.blob(), typed = new Blob([blob], { type: TYPE[ext(a.src)] ?? blob.type });
    const { figures } = await measure(typed);
    const name = title ?? a.name ?? asset;
    const { file } = await keepInLibrary(name, typed, { kind, title: name, tags: listOf(tags), figures });
    return { text: `Sound ${asset} kept in the library as ${file} (${kind}); other projects find it with sfx.`, notice: t('sound.kept', { name }) };
  },
};

const duck: ToolType<{ layers?: unknown; under?: string; depth?: number; attack?: number; release?: number }> = {
  name: 'duck', title: 'Duck under the voice', description: 'lowers music or ambience while someone speaks and brings it back between sentences (an animated volume)',
  input: {
    type: 'object',
    properties: {
      layers: { type: ['array', 'string'], format: 'layer', title: 'Layers', description: 'the sounds to lower (every audio layer that is not the voice by default)' },
      under: { type: 'string', format: 'asset', assetType: 'json', title: 'Voice', description: 'the transcript of the voice (the one of the edit by default)' },
      depth: { type: 'number', minimum: -40, maximum: -1, title: 'Depth (dB)', description: 'the depth of the Sound settings by default (-12 dB unless changed)' },
      attack: { type: 'number', minimum: 0.02, maximum: 2, title: 'Down in (s)', description: '0.15 by default' },
      release: { type: 'number', minimum: 0.05, maximum: 4, title: 'Back in (s)', description: '0.5 by default' },
    },
  },
  ai: { when: 'music or an ambience plays under someone speaking: always, so the voice stays clear' },
  async run({ layers, under, depth = prefs.peek().duckDb, attack = 0.15, release = 0.5 }, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const transcripts = Object.entries(ctx.doc.assets).filter(([id, a]) => a.type === 'json' && id.startsWith('transcription-')).map(([id]) => id);
    const voiceId = under ?? transcripts.find((id) => id.endsWith('-edit')) ?? transcripts[0];
    if (!voiceId) throw new Error('no transcript of a voice: read one first (get_transcript), or give under');
    const tr = await ctx.transcript(voiceId);
    // composition times of the speech: the edit's transcript is in composition time, a file's goes through its layers
    const source = tr.source && !tr.keeps ? tr.source : null;
    const toComp = (s: number) => {
      if (!source) return [s];
      return (Object.values(c.layers) as Layer[]).filter((l) => (l.type === 'audio' || l.type === 'video') && staticValue(l.props?.[l.type]) === source).flatMap((l) => {
        const at = (l.in ?? 0) + (s - Number(staticValue(l.props?.start) ?? 0));
        return at >= (l.in ?? 0) && at < (l.out ?? c.duration) ? [at] : [];
      });
    };
    // sentences: words closer than 0.6 s make one stretch of speech
    const spans: [number, number][] = [];
    for (const w of tr.words) {
      for (const s of toComp(w.s)) {
        const e = s + (w.e - w.s), last = spans.at(-1);
        if (last && s - last[1] < 0.6 && s >= last[0]) last[1] = Math.max(last[1], e);
        else spans.push([s, e]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const voiceLayers = new Set((Object.entries(c.layers) as [string, Layer][]).filter(([, l]) => source && staticValue(l.props?.[l.type]) === source).map(([id]) => id));
    const targets = listOf(layers).length ? listOf(layers) : (Object.entries(c.layers) as [string, Layer][]).filter(([id, l]) => l.type === 'audio' && !voiceLayers.has(id)).map(([id]) => id);
    if (!targets.length) throw new Error('no sound to duck: give its layers');
    const ops: Op[] = [];
    for (const id of targets) {
      const l = c.layers[id];
      if (!l || (l.type !== 'audio' && l.type !== 'video')) throw new Error(`${id} is not a sound layer`);
      const base = Number(audioClips(ctx.doc, ctx.compId).find((x) => x.layerId === id)?.gainDb ?? 0);
      const keys: { t: number; v: number }[] = [];
      for (const [s, e] of spans) {
        const down = Math.max(0, s - attack), up = e + release;
        if (keys.length && keys.at(-1)!.t >= down) keys.splice(-1, 1);
        else keys.push({ t: +down.toFixed(3), v: base });
        keys.push({ t: +s.toFixed(3), v: base + depth }, { t: +e.toFixed(3), v: base + depth }, { t: +up.toFixed(3), v: base });
      }
      keys.sort((a, b) => a.t - b.t);
      ops.push({ op: l.props?.gain === undefined ? 'add' : 'replace', path: pointer('compositions', ctx.compId, 'layers', id, 'props', 'gain'), value: { $k: keys } });
    }
    return {
      ops, label: 'Ducking',
      text: `Ducked ${targets.join(', ')} by ${depth} dB under ${spans.length} stretch(es) of speech (${voiceId}), down in ${attack} s, back in ${release} s.`,
      notice: t('sound.ducked', { n: spans.length }),
    };
  },
};

const voices: ToolType<{ provider?: string; search?: string; language?: string; accent?: string; gender?: string; age?: string }> = {
  name: 'voices', title: 'Voices', description: "lists the voices a voice-over can take: the account's and the shared library's for ElevenLabs (filtered by language, accent, gender, age), the fixed sets of OpenAI and Gemini",
  input: {
    type: 'object',
    properties: {
      provider: { enum: ['elevenlabs', 'openai', 'gemini'], title: 'Provider', description: 'the one of the Sound settings by default' },
      search: { type: 'string', title: 'Search', description: 'words of its name or description: "narrator", "warm", "deep"' },
      language: { type: 'string', title: 'Language', description: 'ISO code: fr, en, es…' },
      accent: { type: 'string', title: 'Accent', description: '"african", "parisian", "british"…' },
      gender: { enum: ['male', 'female', 'neutral'], title: 'Gender' },
      age: { enum: ['young', 'middle_aged', 'old'], title: 'Age' },
    },
  },
  ai: {
    when: 'before a voice-over, to choose its voice yourself (language, accent, tone of the brief) rather than asking the user for an id; then pass its id as voice to generate-sound',
    avoid: 'asking the user for a voice id: pick one that fits and say which',
  },
  async run({ provider, ...filters }, ctx) {
    const p = prefs.peek();
    provider ??= p.voiceProvider === 'auto' ? undefined : p.voiceProvider;
    const list = await api.voices({ provider, ...filters }, ctx.signal);
    if (!list.length) return { text: `No voice for ${JSON.stringify(filters)}: loosen the filters (accent first), or search other words.`, notice: t('sound.noVoice') };
    const say = (v: (typeof list)[number]) => `- ${v.id}: ${v.name} [${v.source}]${[v.language, v.accent, v.gender, v.age].filter(Boolean).length ? ` ${[v.language, v.accent, v.gender, v.age].filter(Boolean).join(', ')}` : ''}${v.description ? ` — ${clip(v.description, 120)}` : ''}`;
    return {
      text: [`${list.length} voices of ${list[0].provider}:`, ...list.slice(0, 40).map(say), 'Pass the id as voice to generate-sound; with ElevenLabs v4 or v3, say the accent and tone in style too.'].join('\n'),
      notice: t('sound.voicesN', { n: list.length }),
    };
  },
};

/** what sounds right on each kind of cue: where a search starts */
const FITS: Record<SoundVisual, string> = {
  cut: 'whoosh or transition (or a reverse peaking on the cut)',
  move: 'swish or short whoosh, on its fastest frame',
  land: 'thump, tap or soft hit, as it comes to rest',
  appear: 'pop, click or tap; a chime for a reveal',
};

const cues: ToolType<{ layers?: unknown }> = {
  name: 'cues', title: 'Cues of the picture', description: 'reads the moments the sound lands on from the timing of the animation: cuts, moves at their fastest, landings, appearances, and the heroes among them (about one in four seconds)',
  input: { type: 'object', properties: { layers: { type: ['array', 'string'], format: 'layer', title: 'Layers', description: 'only the cues these layers make' } } },
  ai: {
    when: 'first, before placing any effect: the sound follows the picture\'s own timing, never typed times. Sound the cues that matter (all the heroes, the cuts, a few lands and appears), then place with on: heroes, cuts, moves, lands, appears or cues (with layers to narrow)',
    avoid: 'a sound on every cue: about one support sound a second at most, never two hits on the same frame',
  },
  async run({ layers }, ctx) {
    const c = ctx.doc.compositions[ctx.compId], named = listOf(layers);
    const list = cuesOf(ctx).filter((x) => !named.length || named.includes(x.layer));
    if (!list.length) return { text: 'No cue: nothing moves, appears or cuts in the picture. Place sounds on times (at) or markers.', notice: t('sound.noCue') };
    const heroes = list.filter((x) => x.weight === 'hero').length;
    const name = (id: string) => (id && c.layers[id] ? c.layers[id].name ?? id : 'the frame');
    return {
      text: [
        `${list.length} cues (${heroes} hero) over ${c.duration} s, read from the animation:`,
        ...list.map((x) => `- ${x.t.toFixed(2)} s ${x.weight === 'hero' ? 'HERO ' : ''}${x.kind}: ${name(x.layer)} (strength ${x.strength})`),
        'What fits: ' + (Object.entries(FITS) as [SoundVisual, string][]).map(([k, v]) => `${k}: ${v}`).join('; ') + '. A hero: a stack (sfx sound "boom+hit" hard, "thump+tap" soft) with stop, a riser or reverse peaking on the same frame.',
      ].join('\n'),
      notice: t('sound.cuesN', { n: list.length, heroes }),
    };
  },
};

/** the free recordings of Openverse (Freesound, CC0 only): found, judged, the good ones kept with their credit. Without a key it answers 20 results a page at most */
const OPENVERSE = 'https://api.openverse.org/v1/audio/';

const soundFind: ToolType<{ query: string; kind?: string; count?: number }> = {
  name: 'sound-find', title: 'Find recordings', description: 'searches free recordings (CC0 from Freesound, through Openverse) for what the library lacks, judges each one (two events in one clip, a steady noise, clicks, a clipped take) and keeps the good ones in your library with their credit',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', title: 'Search', description: 'what it sounds like, as a sound designer would tag it: "wood tap", "paper swish", "deep boom"' },
      kind: { type: 'string', title: 'Kind', description: 'impact, whoosh, riser, click, tap, pop, thump, boom, chime, ambience…: how it is judged and found later' },
      count: { type: 'integer', minimum: 1, maximum: 8, title: 'How many', description: '4 by default' },
    },
    required: ['query'],
  },
  ai: {
    when: 'when the library has no good recording for a cue (a material, a texture, a real whoosh): find some, look at the sheet, then place one with sfx (its id starts with mine-)',
    avoid: 'writing a hit or a whoosh as code instead; meme sounds',
  },
  async run({ query, kind = 'sfx', count = 4 }, ctx) {
    const r = await fetch(`${OPENVERSE}?${new URLSearchParams({ q: query, license: 'cc0', source: 'freesound', page_size: '20' })}`, { signal: ctx.signal });
    if (!r.ok) throw new Error(`Openverse: HTTP ${r.status}`);
    const found = ((await r.json()) as { results?: { id: string; title: string; url: string; duration?: number; creator?: string; foreign_landing_url?: string; tags?: { name: string }[] }[] }).results ?? [];
    // short sounds only: a motion effect, not a recording session
    const short = found.filter((x) => x.url && (x.duration ?? 0) > 0 && (x.duration ?? 0) <= 12000);
    const kept: SoundEntry[] = [], refused: string[] = [];
    for (const x of short) {
      if (kept.length >= count) break;
      ctx.progress?.(kept.length, count, x.title);
      const res = await fetch(x.url, { signal: ctx.signal }).catch(() => null);
      if (!res?.ok) continue;
      const blob = await res.blob();
      const sound = await measure(new Blob([blob], { type: blob.type || 'audio/mpeg' })).catch(() => null);
      if (!sound) continue;
      const flaws = soundFlaws(channelsOf(sound.buffer), sound.buffer.sampleRate, kind);
      if (flaws.length) { refused.push(`${x.title} (${flaws.join(', ')})`); continue; }
      const title = x.title.replace(/\.(wav|mp3|ogg|flac|m4a|aiff?)$/i, '').slice(0, 60);
      const tags = [...new Set([...query.toLowerCase().split(/\s+/), ...(x.tags ?? []).map((g) => g.name.toLowerCase())])].slice(0, 12);
      kept.push(await keepInLibrary(title, blob, { kind, title, tags, figures: sound.figures, license: 'CC0', author: x.creator, url: x.foreign_landing_url }));
    }
    if (!kept.length) return { text: `No clean recording for "${query}"${refused.length ? ` (refused: ${refused.slice(0, 6).join('; ')})` : ''}. Try other words, or have one made (generate-sound).`, notice: t('sound.nothingFound') };
    const sheet = await soundSheet(ctx, kept).catch(() => null);
    const all = await soundLibrary();
    return {
      text: [`Kept in your library (CC0, credited):`, ...kept.map((e) => line(e, all)), ...(refused.length ? [`Refused: ${refused.slice(0, 6).join('; ')}.`] : []), 'Place one with sfx (sound: its id).'].join('\n'),
      ...(sheet ? { images: [{ url: sheet, caption: t('sound.sheet') }] } : {}),
      notice: t('sound.keptN', { n: kept.length }),
    };
  },
};

const credits: ToolType<Record<string, never>> = {
  name: 'credits', title: 'Sound credits', description: 'lists where each sound of the composition comes from and its license (assets/sounds/CREDITS.md), to ship with the video',
  input: { type: 'object', properties: {} },
  ai: { when: 'when the sound is done, before an export: the credits go with the video' },
  async run(_, ctx) {
    const c = ctx.doc.compositions[ctx.compId], all = await soundLibrary();
    const assets = [...new Set(audioClips(ctx.doc, ctx.compId).map((x) => x.asset))];
    const lines: string[] = [];
    for (const id of assets) {
      const a = ctx.doc.assets[id];
      // what was kept beside the file when it came in: the library entry, or what made it
      const side = await ctx.readText(a.src.replace(/\.[a-z0-9]+$/i, '.sound.json')).then((s) => (s ? JSON.parse(s) as Record<string, string> : null)).catch(() => null);
      const e = side?.from ? all.find((x) => x.id === side.from) : all.find((x) => `sound-${x.id}`.slice(0, 64) === id);
      const name = a.name ?? id;
      if (side?.provider) lines.push(`- ${name}: made by ${side.provider}${side.model ? ` (${side.model})` : ''}`);
      else if (side?.code || e?.code) lines.push(`- ${name}: written as code (tramme)`);
      else if (e || side?.license) lines.push(`- ${name}: ${e?.title ?? side?.title ?? name}, ${side?.author ?? e?.author ?? 'unknown author'}, ${side?.license ?? e?.license ?? 'license unknown'}${side?.url ?? e?.url ? ` <${side?.url ?? e?.url}>` : ''}`);
      else lines.push(`- ${name}: brought by the user (${a.src})`);
    }
    if (!lines.length) return { text: 'No sound in this composition.', notice: t('sound.noCredits') };
    const text = `# Sound credits: ${c.name ?? ctx.compId}\n\n${lines.join('\n')}\n`;
    await ctx.writeFile('assets/sounds/CREDITS.md', text);
    return { text: `${text}\nWritten to assets/sounds/CREDITS.md.`, notice: t('sound.credits', { n: lines.length }) };
  },
};

export const SOUND_TOOLS: ToolType[] = [cues, sfx, soundFind, synth, generateSound, voices, duck, soundKeep, credits];
