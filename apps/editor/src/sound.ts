// The sound of a video, made at authoring time: sounds of the library placed
// on the moments that matter (sfx), sounds written as code (synth), sounds
// made by a provider (generate-sound), the music ducked under a voice (duck),
// a sound kept in the library shared by the projects (sound-keep). Tools of the
// editor's vocabulary: the assistant reaches them with use_tool, the user from
// the / menu. Every sound ends as a file of the project played by an audio
// layer; the mixer of @tramme/render plays it the same in the preview and
// the exports.

import { audioClips, isAudioAnalysis, pointer, searchSounds, soundFigures, staticValue, variantsOf, type Layer, type Op, type QualityIssue, type SoundEntry, type SoundFigures, type ToolContext, type ToolType } from '@tramme/core';
import { encodeWav, mixComposition, renderSynth, SYNTH_MAX } from '@tramme/render';
import { api } from './api.ts';
import { freshId } from './model.ts';
import { analyses } from './perception.ts';
import { SOUND_PRESETS } from './sound-presets.ts';
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

export const MOMENTS = ['now', 'entrances', 'exits', 'markers', 'cuts', 'beats', 'bars'] as const;

/**
 * Composition times named by the document, on its frames: numbers as they
 * are; now (the editor's time); entrances and exits of layers (the ones
 * given, or every visible layer not a sound); markers; cuts (between video
 * layers, and the shots found by the shots tool); beats and bars (of a music
 * analysed by the beats tool, where its layer plays it).
 */
export async function momentsOf(ctx: ToolContext, at: unknown, on: unknown, layers: unknown): Promise<number[]> {
  const c = ctx.doc.compositions[ctx.compId], fps = c.fps;
  const times: number[] = listOf(at).map(Number).filter(Number.isFinite);
  const words = listOf(on).map((w) => w.toLowerCase());
  const named = listOf(layers).filter((id) => c.layers[id]);
  const visual = (Object.entries(c.layers) as [string, Layer][]).filter(([id, l]) => (named.length ? named.includes(id) : l.type !== 'audio' && l.visible !== false));
  // where a layer plays a file: composition time of a time in that file
  const playing = (asset: string) => (Object.values(c.layers) as Layer[]).filter((l) => (l.type === 'audio' || l.type === 'video') && staticValue(l.props?.[l.type]) === asset);
  const inFile = (asset: string, fileTimes: number[]) => playing(asset).flatMap((l) => {
    const start = Number(staticValue(l.props?.start) ?? 0), from = l.in ?? 0, to = l.out ?? c.duration;
    return fileTimes.map((x) => from + (x - start)).filter((x) => x >= from && x < to);
  });
  const read = words.some((w) => ['cuts', 'beats', 'bars'].includes(w)) ? await analyses(ctx) : () => undefined;
  const assets = Object.keys(ctx.doc.assets);
  for (const w of words) {
    if (w === 'now') times.push(ctx.time);
    else if (w === 'entrances') times.push(...visual.map(([, l]) => l.in ?? 0).filter((x) => named.length || x > 0));
    else if (w === 'exits') times.push(...visual.map(([, l]) => l.out ?? c.duration).filter((x) => x < c.duration));
    else if (w === 'markers') times.push(...(c.markers ?? []).map((m) => m.t));
    else if (w === 'cuts') {
      const videos = (Object.values(c.layers) as Layer[]).filter((l) => l.type === 'video').map((l) => l.in ?? 0).filter((x) => x > 0);
      times.push(...videos);
      for (const id of assets.filter((a) => a.startsWith('shots-'))) {
        const s = read(id) as { source?: string; cuts?: number[] } | undefined;
        if (s?.source && Array.isArray(s.cuts)) times.push(...inFile(s.source, s.cuts));
      }
    } else if (w === 'beats' || w === 'bars') {
      for (const id of assets.filter((a) => a.startsWith('analysis-'))) {
        const a = read(id);
        if (isAudioAnalysis(a) && a.source) times.push(...inFile(a.source, w === 'bars' ? a.downbeats : a.beats));
      }
    } else throw new Error(`unknown moment "${w}": ${MOMENTS.join(', ')}, or times in seconds`);
  }
  const snapped = [...new Set(times.map((x) => Math.round(x * fps) / fps))].filter((x) => x >= 0 && x < c.duration);
  return snapped.sort((a, b) => a - b);
}

// ── a sound in the project, placed ───────────────────────────
interface ProjectSound { asset: string; ops: Op[]; figures: SoundFigures; reload: string[] }

/** a file kept under assets/sounds/ and declared as an audio asset (replaced when made again) */
async function keepFile(ctx: ToolContext, name: string, data: Blob, title: string, figures: SoundFigures, made?: unknown): Promise<ProjectSound> {
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'sound';
  const asset = `sound-${slug}`;
  const path = await ctx.writeFile(`assets/sounds/${slug}.${extOf(data.type)}`, data);
  if (made) await ctx.writeFile(`assets/sounds/${slug}.sound.json`, JSON.stringify(made, null, 1));
  const had = !!ctx.doc.assets[asset];
  return { asset, figures, reload: had ? [asset] : [], ops: [{ op: had ? 'replace' : 'add', path: pointer('assets', asset), value: { type: 'audio', src: path, name: title } }] };
}

/** the measures of a sound file: decoded the way the mixer will */
async function measure(data: Blob): Promise<{ buffer: AudioBuffer; figures: SoundFigures }> {
  const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await data.arrayBuffer());
  return { buffer, figures: soundFigures(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), buffer.sampleRate) };
}

const wavBlob = (b: AudioBuffer) => new Blob([encodeWav(b) as BlobPart], { type: 'audio/wav' });

/** a sound of the library brought into the project: its file copied, or its code rendered */
async function bring(ctx: ToolContext, e: SoundEntry): Promise<ProjectSound> {
  if (e.code) {
    const buffer = await renderSynth(e.code, { duration: e.duration, signal: ctx.signal });
    const figures = soundFigures(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), buffer.sampleRate);
    return keepFile(ctx, e.id, wavBlob(buffer), e.title, figures, { code: e.code, duration: e.duration, from: e.id });
  }
  const asset = `sound-${e.id}`.slice(0, 64);
  const figures: SoundFigures = { duration: e.duration, peakAt: e.peakAt, peakDb: e.peakDb ?? 0, loudDb: e.loudDb ?? 0, rmsDb: 0, start: 0, end: e.duration };
  if (ctx.doc.assets[asset]) return { asset, figures, ops: [], reload: [] };
  const r = await fetch(fileUrl(e), { signal: ctx.signal });
  if (!r.ok) throw new Error(`sound ${e.id} not found (HTTP ${r.status})`);
  const blob = await r.blob();
  return keepFile(ctx, e.id, new Blob([blob], { type: TYPE[ext(e.file!)] ?? blob.type }), e.title, figures);
}

/** sounds whose moment is their start: music, voices, beds, jingles */
const FROM_START = new Set(['music', 'voice', 'ambience', 'sting']);

interface Placement { asset: string; title: string; figures: SoundFigures; kind: string }

/**
 * Audio layers playing each sound so its moment falls on each time: the
 * moment it lands on (a hit, the pass of a whoosh, the top of a riser), or
 * its start for music and voices. Several sounds alternate (variants); rates
 * vary a little when one sound repeats, so it does not sound copied.
 */
function place(ctx: ToolContext, sounds: Placement[], times: number[], o: { gain: number; rate?: number; align?: 'peak' | 'start'; vary: boolean }): { ops: Op[]; layers: string[] } {
  const c = ctx.doc.compositions[ctx.compId], taken: Record<string, unknown> = { ...c.layers };
  const ops: Op[] = [], layers: string[] = [];
  times.forEach((time, i) => {
    const s = sounds[i % sounds.length];
    const nudge = o.vary && sounds.length === 1 && times.length > 1 ? 1 + ((((i * 0.618034) % 1) - 0.5) * 0.08) : 1;
    const rate = +((o.rate ?? 1) * nudge).toFixed(3);
    const align = o.align ?? (FROM_START.has(s.kind) ? 'start' : 'peak');
    const lead = (align === 'peak' ? s.figures.peakAt : 0) / rate;
    let at = time - lead, start = 0;
    if (at < 0) { start = -at * rate; at = 0; }
    const out = Math.min(c.duration, at + (s.figures.duration - start) / rate);
    if (out <= at) return;
    const id = freshId(taken, s.asset.replace(/^sound-/, 'sfx-'));
    taken[id] = true;
    layers.push(id);
    const props: Record<string, unknown> = { audio: s.asset, start: +start.toFixed(4), gain: o.gain };
    if (rate !== 1) props.rate = rate;
    ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { type: 'audio', name: `${s.title} · ${time.toFixed(2)} s`, in: +at.toFixed(4), out: +out.toFixed(4), props } });
    ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'order', '-'), value: id });
  });
  return { ops, layers };
}

const ALIGN = { enum: ['peak', 'start'], title: 'Align', description: 'peak: the moment the sound lands on falls on the time (hits, whooshes, risers); start: its beginning does (music, voices, jingles)' };
const PLACING = {
  at: { type: ['array', 'number', 'string'], title: 'At (s)', description: 'composition times, e.g. [1.2, 3.5] or "1.2, 3.5"' },
  on: { type: 'string', title: 'On', description: `moments named by the document, comma separated: ${MOMENTS.join(', ')}` },
  layers: { type: ['array', 'string'], format: 'layer', title: 'Layers', description: 'whose entrances or exits (every visible layer when empty)' },
  gain: { type: 'number', minimum: -40, maximum: 12, title: 'Volume (dB)', description: '-8 by default: under a voice or music' },
  align: ALIGN,
};

/** where a tool places its sound: the times asked for; none asked, nowhere (the sound only joins the project) */
const timesOf = (ctx: ToolContext, input: { at?: unknown; on?: unknown; layers?: unknown }) => momentsOf(ctx, input.at, input.on, input.layers);

const placedText = (p: { layers: string[] }, times: number[]) => (p.layers.length ? `Placed at ${times.map((x) => x.toFixed(2)).join(', ')} s (layers ${p.layers.join(', ')}).` : 'Not placed (no time given): the asset is in the project, place it with at or on.');

// ── what a sound looks like ──────────────────────────────────
/** its waveform, the moment it lands on marked: the assistant cannot hear, it reads this */
function waveform(buffer: AudioBuffer, figures: SoundFigures, caption: string): string {
  const W = 720, H = 150, canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!, d = buffer.getChannelData(0), per = Math.max(1, Math.floor(d.length / W));
  g.fillStyle = '#0b0f12'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1f282e'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.fillStyle = '#4cc38a';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    for (let i = x * per; i < Math.min(d.length, (x + 1) * per); i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    g.fillRect(x, H / 2 - hi * (H / 2 - 8), 1, Math.max(1, (hi - lo) * (H / 2 - 8)));
  }
  const px = (s: number) => (s / Math.max(1e-6, figures.duration)) * W;
  g.fillStyle = '#ff6b5e'; g.fillRect(px(figures.peakAt), 0, 2, H);
  g.font = '600 12px system-ui, sans-serif'; g.fillStyle = '#e6edf0';
  g.fillText(`${caption} · ${figures.duration.toFixed(2)} s · lands at ${figures.peakAt.toFixed(2)} s · peak ${figures.peakDb} dB · loud ${figures.loudDb} dB`, 8, 16);
  return canvas.toDataURL('image/png');
}

const figuresText = (f: SoundFigures) => `${f.duration.toFixed(2)} s, lands at ${f.peakAt.toFixed(2)} s, sound from ${f.start.toFixed(2)} to ${f.end.toFixed(2)} s, peak ${f.peakDb} dBFS, loud ${f.loudDb} dBFS (average ${f.rmsDb})`;

// ── the tools ────────────────────────────────────────────────
const sfx: ToolType<{ query?: string; sound?: string; at?: unknown; on?: string; layers?: unknown; gain?: number; rate?: number; vary?: boolean; align?: 'peak' | 'start' }> = {
  name: 'sfx', title: 'Sound effects', description: 'searches the sound library (recorded sounds, sounds written as code, your own) and places a sound on moments of the video, its hit on the frame',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', title: 'Search', description: 'what it should sound like: "metal hit heavy", "whoosh", "riser", "click", "glitch", "logo sting"' },
      sound: { type: 'string', title: 'Sound', description: 'id of a sound found by a search, to place it' },
      ...PLACING,
      rate: { type: 'number', minimum: 0.25, maximum: 4, title: 'Speed', description: 'under 1 lower and longer, over 1 higher and shorter' },
      vary: { type: 'boolean', title: 'Vary', description: 'alternate its variants on repeated moments (yes by default)' },
    },
  },
  ai: {
    when: 'to give the video its sound: a whoosh on each transition, a hit on a title, a riser before a reveal, clicks on a UI, a sting on the logo. Search first (query), listen with your eyes (the list says when each lands and how loud), then place one (sound, with at or on)',
    avoid: 'a sound on every element; two hits at the same instant; sounds louder than the voice (keep them around -8 dB under it)',
  },
  async run({ query, sound, at, on, layers, gain = -8, rate, vary = true, align }, ctx) {
    const all = await soundLibrary();
    if (!sound) {
      const found = searchSounds(all, query ?? '', { limit: 15 });
      if (!found.length) return { text: `No sound for "${query}". Kinds in the library: ${[...new Set(all.map((e) => e.kind))].join(', ')}. Or write one with the synth tool, or have one made with generate-sound.`, notice: t('sound.nothingFound') };
      return {
        text: [`Sounds for "${query ?? ''}" (${all.length} in the library):`, ...found.map((e) => line(e, all)), 'Place one: sfx with sound (its id) and at (times) or on (entrances, exits, markers, cuts, beats, bars, now). Its variants alternate on repeated moments.'].join('\n'),
        notice: t('sound.foundN', { n: found.length }),
      };
    }
    const e = all.find((x) => x.id === sound);
    if (!e) throw new Error(`no sound "${sound}" in the library: search first (query)`);
    const times = await timesOf(ctx, { at, on, layers });
    const pick = vary && times.length > 1 ? variantsOf(all, e) : [e];
    const brought = [];
    for (const x of pick.slice(0, Math.max(1, times.length))) brought.push({ ...(await bring(ctx, x)), title: x.title, kind: x.kind });
    const placed = place(ctx, brought.map((b) => ({ asset: b.asset, title: b.title, figures: b.figures, kind: b.kind })), times, { gain, rate, align, vary });
    return {
      ops: [...brought.flatMap((b) => b.ops), ...placed.ops], reload: brought.flatMap((b) => b.reload), label: `${e.title}`,
      text: `${e.title}${brought.length > 1 ? ` (${brought.length} variants)` : ''}: ${placedText(placed, times)} Gain ${gain} dB.`,
      notice: t('sound.placed', { name: e.title, n: placed.layers.length }),
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
  async run({ name, code, duration, seed = 1, at, on, layers, gain = -8, align }, ctx) {
    const buffer = await renderSynth(code, { duration, seed, signal: ctx.signal });
    const figures = soundFigures(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), buffer.sampleRate);
    const kept = await keepFile(ctx, name, wavBlob(buffer), name, figures, { code, duration, seed });
    const times = await timesOf(ctx, { at, on, layers });
    const placed = place(ctx, [{ asset: kept.asset, title: name, figures, kind: 'synth' }], times, { gain, align, vary: false });
    return {
      ops: [...kept.ops, ...placed.ops], reload: kept.reload, label: `Sound ${name}`,
      text: `Sound "${name}" saved as asset ${kept.asset}: ${figuresText(figures)}. ${placedText(placed, times)}`,
      images: [{ url: waveform(buffer, figures, name), caption: name }],
      notice: t('sound.written', { name }),
    };
  },
};

const generateSound: ToolType<{ kind: 'sfx' | 'music' | 'voice'; prompt: string; name?: string; duration?: number; voice?: string; style?: string; provider?: string; at?: unknown; on?: string; layers?: unknown; gain?: number; align?: 'peak' | 'start'; keep?: boolean }> = {
  name: 'generate-sound', title: 'Have a sound made', description: 'has a provider make a sound effect, a music bed or a voice-over (the server\'s keys), saves it in the project with what made it and places it',
  input: {
    type: 'object',
    properties: {
      kind: { enum: ['sfx', 'music', 'voice'], title: 'Kind' },
      prompt: { type: 'string', title: 'Prompt', description: 'sfx and music: what it sounds like ("deep cinematic boom with a long tail", "calm lo-fi piano bed, 80 bpm"); voice: the text to say' },
      name: { type: 'string', title: 'Name', description: 'of the file, lower case' },
      duration: { type: 'number', minimum: 0.5, maximum: 600, title: 'Length (s)', description: 'sfx up to 30 s; music from 3 s' },
      voice: { type: 'string', title: 'Voice', description: 'voice-over: a voice of the provider (Gemini: Kore, Puck, Charon…; OpenAI: alloy, coral, sage…)' },
      style: { type: 'string', title: 'Style', description: 'voice-over: how it is said ("warm and calm", "energetic")' },
      provider: { enum: ['elevenlabs', 'openai', 'gemini'], title: 'Provider', description: 'the first one the server has a key for by default' },
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
    const made = await api.generate({ kind, prompt, duration, voice, style, provider }, ctx.signal);
    const { buffer, figures } = await measure(made.blob);
    const label = name ?? `${kind}-${prompt.toLowerCase().split(/\s+/).slice(0, 4).join('-')}`;
    const record = { kind, prompt, provider: made.provider, model: made.model, voice: made.voice, style, duration };
    const kept = await keepFile(ctx, label, made.blob, label, figures, record);
    const times = await timesOf(ctx, { at, on: on ?? (at === undefined ? 'now' : undefined), layers });
    const placed = place(ctx, [{ asset: kept.asset, title: label, figures, kind: kind === 'sfx' ? 'sfx' : kind }], times, { gain: gain ?? (kind === 'music' ? -14 : kind === 'voice' ? 0 : -8), align, vary: false });
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
async function keepInLibrary(title: string, data: Blob, d: { kind: string; title: string; tags: string[]; figures: SoundFigures; prompt?: string; provider?: string }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'sound';
  const file = `${id}.${extOf(data.type)}`;
  const entry: SoundEntry = {
    id: `mine-${id}`, title: d.title, kind: d.kind, tags: d.tags, source: 'library', file,
    duration: d.figures.duration, peakAt: d.figures.peakAt, peakDb: d.figures.peakDb, loudDb: d.figures.loudDb,
    ...(d.prompt ? { prompt: d.prompt.slice(0, 400) } : {}), ...(d.provider ? { provider: d.provider } : {}),
  };
  await api.soundPut(file, data, entry);
  return file;
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
    const file = await keepInLibrary(name, typed, { kind, title: name, tags: listOf(tags), figures });
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
      depth: { type: 'number', minimum: -40, maximum: -1, title: 'Depth (dB)', description: '-12 by default' },
      attack: { type: 'number', minimum: 0.02, maximum: 2, title: 'Down in (s)', description: '0.15 by default' },
      release: { type: 'number', minimum: 0.05, maximum: 4, title: 'Back in (s)', description: '0.5 by default' },
    },
  },
  ai: { when: 'music or an ambience plays under someone speaking: always, so the voice stays clear' },
  async run({ layers, under, depth = -12, attack = 0.15, release = 0.5 }, ctx) {
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

export const SOUND_TOOLS: ToolType[] = [sfx, synth, generateSound, duck, soundKeep];

// ── the mix, checked ─────────────────────────────────────────
/** what the sound checks say, English templates translated where shown (and listed for the catalogs) */
export const SOUND_TEXTS = {
  clips: 'The sound clips (peak {db} dBFS around {t} s): lower the loudest layers',
  loud: 'The mix is very loud ({db} dBFS over its loudest 400 ms): lower the effects and the music',
  quiet: 'The mix is very quiet ({db} dBFS over its loudest 400 ms)',
  together: 'Two sounds start together at {t} s: keep one, or move one',
};

/**
 * What is wrong with the sound of a composition: a mix that clips, one far
 * too loud or too quiet, two sounds landing on the same instant. Read by the
 * check tool beside the picture's checks.
 */
export async function soundIssues(ctx: ToolContext): Promise<QualityIssue[]> {
  const clips = audioClips(ctx.doc, ctx.compId);
  if (!clips.length) return [];
  const mix = await mixComposition(ctx.doc, ctx.compId, ctx.assetUrl);
  if (!mix) return [];
  const f = soundFigures([mix.getChannelData(0), mix.getChannelData(1)], mix.sampleRate);
  const issues: QualityIssue[] = [];
  const say = (text: string, params: Record<string, string | number>) => ({ message: Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text), say: { text, params } });
  if (f.peakDb > -0.3) issues.push({ check: 'sound', severity: 'warning', t: f.peakAt, ...say(SOUND_TEXTS.clips, { db: f.peakDb, t: f.peakAt.toFixed(2) }) });
  if (f.loudDb > -6) issues.push({ check: 'sound', severity: 'warning', ...say(SOUND_TEXTS.loud, { db: f.loudDb }) });
  else if (f.loudDb < -30) issues.push({ check: 'sound', severity: 'info', ...say(SOUND_TEXTS.quiet, { db: f.loudDb }) });
  // short sounds starting together
  const short = clips.filter((c) => c.duration < 1.5).sort((a, b) => a.at - b.at);
  for (let i = 1; i < short.length; i++) {
    if (short[i].at - short[i - 1].at < 0.04) issues.push({ check: 'sound', severity: 'info', t: short[i].at, layers: [short[i - 1].layerId, short[i].layerId], ...say(SOUND_TEXTS.together, { t: short[i].at.toFixed(2) }) });
  }
  return issues;
}
