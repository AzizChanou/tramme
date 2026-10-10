// The mix, balanced and checked. The assistant cannot hear: it reads the
// mix the way an engineer's meters do. Each effect is measured against the
// bed under it (the music, the ambience and the voice), band by band: a
// support sound has to stand out in one of its bands, a hero in its main
// one, without poking out of the bright band nor over the bed's peaks. The
// mix tool writes the gains that do that; the checks (read by the check
// tool beside the picture's) say what still does not: an effect off its cue,
// buried, a music too loud under the voice, a dip or a silence nobody
// planned, a master off its loudness. The picture of the mix shows the
// waveform, the spectrogram and the motion of the picture with a line at
// each effect, and five moments are given to check by ear: a human does the
// final listen.

import { audioClips, bandPowers, curveAt, Evaluator, integratedLoudness, loudnessSeries, pictureMotion, pointer, powerDb, soundFigures, soundMix, truePeak, type AudioClip, type Op, type QualityIssue, type SoundFigures, type ToolContext, type ToolType } from '@tramme/core';
import { mixComposition } from '@tramme/render';
import { channelsOf, cuesOf, measure } from './sound.ts';
import { canvas, caption, drawCurve, drawSpectrogram, drawWave, INK, mark } from './sound-pictures.ts';
import { prefs } from './settings.ts';
import { t } from './i18n/index.ts';

// ── the stems ────────────────────────────────────────────────
interface Stems {
  /** the effects, the music and ambience, the voice: summed as they are (no master) */
  effects: AudioBuffer | null;
  music: AudioBuffer | null;
  voice: AudioBuffer | null;
  /** the master, as the exports have it */
  final: AudioBuffer | null;
}

async function stems(ctx: ToolContext): Promise<Stems> {
  const mix = (only?: (c: AudioClip) => boolean, master = false) => mixComposition(ctx.doc, ctx.compId, ctx.assetUrl, { master, only });
  const [effects, music, voice, final] = await Promise.all([
    mix((c) => c.role === 'effect'), mix((c) => c.role === 'music' || c.role === 'ambience'), mix((c) => c.role === 'voice'), mix(undefined, true),
  ]);
  return { effects, music, voice, final };
}


/** the bed (music, ambience and voice) as channels: both stems summed, or the one there is */
function bedOf(s: Stems): Float32Array[] | null {
  const parts = [s.music, s.voice].filter((b): b is AudioBuffer => !!b);
  if (!parts.length) return null;
  if (parts.length === 1) return channelsOf(parts[0]);
  return [0, 1].map((c) => { const a = parts[0].getChannelData(c), b = parts[1].getChannelData(c), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + b[i]; return o; });
}

// ── each effect, as it sounds over the bed ───────────────────
export interface Effect {
  clip: AudioClip;
  name: string;
  /** composition time of its hit (the moment its file lands on), null when the clip starts after it */
  hit: number | null;
  figures: SoundFigures;
  /** its file's power in each band around its hit, at gain 0, dB */
  bands: number[];
  /** its share of its own energy in each band */
  share: number[];
  /** the bed's power in each band around its hit, dB; null when nothing is under it */
  bed: number[] | null;
  /** the bed's loudest sample around its hit (±0.15 s, ±1 s for a hero), dBFS */
  bedPeak: number;
}

const BED_SILENT = -100;

/** the effects of the composition, each measured against the bed around its hit */
async function effectsOf(ctx: ToolContext, s: Stems): Promise<Effect[]> {
  const c = ctx.doc.compositions[ctx.compId], bed = bedOf(s), rate = s.final?.sampleRate ?? 48000;
  const files = new Map<string, Promise<{ buffer: AudioBuffer; figures: SoundFigures } | null>>();
  const out: Effect[] = [];
  for (const clip of audioClips(ctx.doc, ctx.compId).filter((x) => x.role === 'effect')) {
    let p = files.get(clip.asset);
    if (!p) {
      p = fetch(ctx.assetUrl(clip.asset), { signal: ctx.signal }).then((r) => r.blob()).then(measure).catch(() => null);
      files.set(clip.asset, p);
    }
    const measured = await p;
    if (!measured) continue;
    const { buffer: file, figures } = measured;
    const hit = figures.peakAt >= clip.offset ? clip.at + (figures.peakAt - clip.offset) / clip.rate : null;
    const at = hit ?? clip.at, w = 0.15;
    const own = bandPowers(channelsOf(file), file.sampleRate, Math.max(0, figures.peakAt - w), figures.peakAt + w);
    const total = own.reduce((a, b) => a + b, 0) || 1;
    let bands: number[] | null = null, bedPeak = -120;
    if (bed) {
      const under = bandPowers(bed, rate, Math.max(0, at - w), at + w).map(powerDb);
      bands = under.every((v) => v < BED_SILENT) ? null : under;
      const span = clip.weight === 'hero' ? 1 : w, i0 = Math.max(0, Math.floor((at - span) * rate)), i1 = Math.min(bed[0].length, Math.ceil((at + span) * rate));
      let peak = 0;
      for (const ch of bed) for (let i = i0; i < i1; i++) peak = Math.max(peak, Math.abs(ch[i]));
      bedPeak = peak > 0 ? 20 * Math.log10(peak) : -120;
    }
    const layer = c.layers[clip.layerId];
    out.push({ clip, name: layer?.name ?? clip.layerId, hit, figures, bands: own.map(powerDb), share: own.map((v) => v / total), bed: bands, bedPeak });
  }
  return out;
}

/** the gain (dB) of a clip at its hit: its level, or its curve there */
const gainOf = (e: Effect) => (e.clip.envelope && e.hit !== null ? curveAt(e.clip.envelope, e.hit) : e.clip.gainDb);

/** how far it stands over the bed in each band at its gain, dB (Infinity where nothing is under it) */
const liftOf = (e: Effect, g = gainOf(e)) => e.bands.map((v, k) => (e.bed ? v + g - e.bed[k] : Infinity));

/** bands that carry at least a tenth of a sound: where it can be heard */
const carried = (e: Effect) => e.share.map((v, k) => (v >= 0.1 ? k : -1)).filter((k) => k >= 0);
/** its main band: where most of it is */
const mainBand = (e: Effect) => e.share.indexOf(Math.max(...e.share));
/** the bright bands (2 to 8 kHz), where a sound poking out hurts */
const BRIGHT = [4, 5];

/** what the mix aims at: a support sound stands this much over the bed in its easiest band, a hero in its main band */
const LIFT = { support: 3.5, hero: 5 }, BRIGHT_CAP = { support: 6, hero: 9 }, PEAK_CAP = { support: 6, hero: 8 };
/** the checks' thresholds: an effect is heard when it stands this much over the bed in a band that carries it, a hero's body this much in its main band */
const AUDIBLE = 1.5, HERO_BODY = 3;
/** a support sound right after another (within CLUSTER s) comes this much down */
const CLUSTER = 0.15, CLUSTER_DB = 4.4;

/**
 * The gain each effect needs: over the bed by its lift in the band that
 * carries it, capped in the bright band and under the bed's peak, a support
 * sound crowding the one before brought down, the same sound kept within
 * 2 dB of itself. Over silence, its loudness alone sets it.
 */
export function balance(list: Effect[]): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...list].filter((e) => !e.clip.envelope).sort((a, b) => (a.hit ?? a.clip.at) - (b.hit ?? b.clip.at));
  // what each sound may not go under (heard over the bed) nor over (its caps)
  const bounds = new Map<string, { floor: number; cap: number }>();
  let last = -Infinity;
  for (const e of sorted) {
    const w = e.clip.weight, at = e.hit ?? e.clip.at;
    let g: number, floor = -Infinity, cap = Infinity;
    if (!e.bed) g = prefs.peek().effectsDb + (w === 'hero' ? 4 : 0) - (e.figures.loudDb + 12);
    else {
      const over = (lift: number) => (k: number) => e.bed![k] + lift - e.bands[k];
      const bands = carried(e).length ? carried(e) : [mainBand(e)];
      g = w === 'hero' ? over(LIFT.hero)(mainBand(e)) : Math.min(...bands.map(over(LIFT.support)));
      // heard: over the check's thresholds, half a decibel kept for the rounding
      floor = Math.min(...bands.map(over(AUDIBLE + 0.5)));
      if (w === 'hero') floor = Math.max(floor, over(HERO_BODY + 0.5)(mainBand(e)));
      // a hit whose body sits under 2 kHz keeps its body: its bright edge is not held
      if (!(w === 'hero' && mainBand(e) < BRIGHT[0])) for (const k of BRIGHT) if (e.share[k] >= 0.05) cap = Math.min(cap, e.bed[k] + BRIGHT_CAP[w] - e.bands[k]);
      cap = Math.min(cap, e.bedPeak + PEAK_CAP[w] - e.figures.peakDb);
    }
    if (w === 'support' && at - last < CLUSTER) g -= CLUSTER_DB;
    last = at;
    out.set(e.clip.layerId, g);
    bounds.set(e.clip.layerId, { floor, cap });
  }
  // the same sound at the same weight stays within 2 dB of its median
  const groups = new Map<string, string[]>();
  for (const e of sorted) groups.set(`${e.clip.asset}|${e.clip.weight}`, [...(groups.get(`${e.clip.asset}|${e.clip.weight}`) ?? []), e.clip.layerId]);
  for (const ids of groups.values()) {
    const gs = ids.map((id) => out.get(id)!).sort((a, b) => a - b), med = gs[Math.floor(gs.length / 2)];
    for (const id of ids) out.set(id, Math.min(med + 2, Math.max(med - 2, out.get(id)!)));
  }
  // heard first, then never over its caps: a sound the caps keep under the bed needs room made for it (stop), the check says so
  for (const [id, g] of out) {
    const { floor, cap } = bounds.get(id)!;
    out.set(id, Math.round(Math.min(12, Math.max(-40, Math.min(cap, Math.max(floor, g)))) * 2) / 2);
  }
  return out;
}

const mix: ToolType<Record<string, never>> = {
  name: 'mix', title: 'Balance the effects', description: 'sets the volume of each effect against the music and voice under it, band by band: a support sound just over the bed, a hero clearly over it, nothing poking out of the bright band or over the bed\'s peaks',
  input: { type: 'object', properties: {} },
  ai: {
    when: 'after placing the effects and the bed (and ducking it), before checking: it writes the gains an engineer would; animated gains are left as they are',
    avoid: 'setting the effects\' volumes by hand afterwards without a reason the checks give',
  },
  async run(_, ctx) {
    const list = await effectsOf(ctx, await stems(ctx));
    if (!list.length) return { text: 'No effect to balance: place some first (sfx).', notice: t('sound.nothingToMix') };
    const gains = balance(list), ops: Op[] = [];
    const lines = list.map((e) => {
      const g = gains.get(e.clip.layerId);
      if (g === undefined) return `- ${e.name}: its volume is animated, left as it is`;
      ops.push({ op: e.clip.envelope === null && ctx.doc.compositions[ctx.compId].layers[e.clip.layerId].props?.gain === undefined ? 'add' : 'replace', path: pointer('compositions', ctx.compId, 'layers', e.clip.layerId, 'props', 'gain'), value: g });
      const over = e.bed ? `${Math.max(...carried(e).map((k) => liftOf(e, g)[k])).toFixed(1)} dB over the bed` : 'over silence';
      return `- ${e.name} (${e.clip.weight}${e.hit !== null ? ` at ${e.hit.toFixed(2)} s` : ''}): ${e.clip.gainDb} → ${g} dB, ${over}`;
    });
    return { ops, label: t('sound.mixLabel'), text: `Balanced ${ops.length} effect(s):\n${lines.join('\n')}\nCheck the mix now (check).`, notice: t('sound.mixed', { n: ops.length }) };
  },
};

export const MIXING_TOOLS: ToolType[] = [mix];

// ── the mix, checked ─────────────────────────────────────────
/** what the sound checks say, English templates translated where shown (and listed for the catalogs) */
export const SOUND_TEXTS = {
  clips: 'The sound clips (peak {db} dBFS around {t} s): lower the loudest layers',
  loudness: 'The master is at {lufs} LUFS, {target} asked: check the levels',
  peak: 'The master peaks at {db} dBTP, over -1: lower the loudest layers',
  quiet: 'The mix is very quiet ({db} dBFS over its loudest 400 ms)',
  together: 'Two sounds start together at {t} s: keep one, or move one',
  offCue: '"{name}" lands {frames} frame(s) off its {visual} ({t} s): move it onto the picture',
  noCue: '"{name}" underlines a {visual} at {t} s, and the picture does none there',
  buried: '"{name}" at {t} s is buried under the bed: raise it (mix) or make room',
  heroBody: 'The hero "{name}" at {t} s does not stand out where its body is: raise it or stop the bed before it',
  voice: 'The music is only {lu} LU under the voice (8 at least): duck it',
  dip: 'The music drops {lu} LU around {t} s, unplanned',
  silence: 'Silence from {from} to {to} s, unplanned (a marker of kind silence plans one)',
};

const say = (text: string, params: Record<string, string | number>) => ({ message: Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text), say: { text, params } });
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export interface SoundReport {
  issues: QualityIssue[];
  /** the master as measured, when the composition has sound */
  master?: { lufs: number; truePeak: number; target: number | null };
  /** moments to check by ear, the heroes first */
  listen: number[];
  /** the picture of the mix: waveform, spectrogram, motion, a line at each effect */
  image?: string;
}

/** what is wrong with the sound of a composition, measured (see the top of this file); none when it has no sound */
export async function soundReport(ctx: ToolContext, opts: { image?: boolean } = {}): Promise<SoundReport> {
  const c = ctx.doc.compositions[ctx.compId], fps = c.fps, clips = audioClips(ctx.doc, ctx.compId);
  if (!clips.length) return { issues: [], listen: [] };
  const s = await stems(ctx);
  if (!s.final) return { issues: [], listen: [] };
  const issues: QualityIssue[] = [], target = soundMix(c).loudness;
  const final = channelsOf(s.final), rate = s.final.sampleRate;
  const lufs = integratedLoudness(final, rate), tp = truePeak(final);
  // the master
  if (target !== null && Number.isFinite(lufs) && Math.abs(lufs - target) > 1) issues.push({ check: 'sound', severity: 'warning', ...say(SOUND_TEXTS.loudness, { lufs: lufs.toFixed(1), target }) });
  if (tp > -1) issues.push({ check: 'sound', severity: 'warning', ...say(target === null ? SOUND_TEXTS.clips : SOUND_TEXTS.peak, { db: tp.toFixed(1), t: soundFigures(final, rate).peakAt.toFixed(2) }) });
  const f = soundFigures(final, rate);
  if (f.loudDb < -30) issues.push({ check: 'sound', severity: 'info', ...say(SOUND_TEXTS.quiet, { db: f.loudDb }) });
  // each effect: on its cue, heard over the bed
  const effects = await effectsOf(ctx, s), cues = cuesOf(ctx);
  for (const e of effects) {
    if (e.hit === null) continue;
    const at = +e.hit.toFixed(2);
    if (e.clip.visual) {
      const tol = (e.clip.weight === 'hero' ? 1 : 2) / fps;
      const near = cues.filter((q) => q.kind === e.clip.visual && Math.abs(q.t - e.hit!) <= 0.25).sort((a, b) => Math.abs(a.t - e.hit!) - Math.abs(b.t - e.hit!))[0];
      if (!near) issues.push({ check: 'sound', severity: e.clip.weight === 'hero' ? 'warning' : 'info', t: at, layers: [e.clip.layerId], ...say(SOUND_TEXTS.noCue, { name: e.name, visual: e.clip.visual, t: at }) });
      else if (Math.abs(near.t - e.hit) > tol + 1e-6) issues.push({ check: 'sound', severity: 'warning', t: at, layers: [e.clip.layerId], ...say(SOUND_TEXTS.offCue, { name: e.name, frames: Math.round(Math.abs(near.t - e.hit) * fps), visual: e.clip.visual, t: near.t.toFixed(2) }) });
    }
    if (!e.bed) continue;
    const lift = liftOf(e);
    if (!carried(e).some((k) => lift[k] >= AUDIBLE)) issues.push({ check: 'sound', severity: 'warning', t: at, layers: [e.clip.layerId], ...say(SOUND_TEXTS.buried, { name: e.name, t: at }) });
    else if (e.clip.weight === 'hero' && lift[mainBand(e)] < HERO_BODY) issues.push({ check: 'sound', severity: 'warning', t: at, layers: [e.clip.layerId], ...say(SOUND_TEXTS.heroBody, { name: e.name, t: at }) });
  }
  // the voice over the music
  if (s.voice && s.music) {
    const v = loudnessSeries(channelsOf(s.voice), rate), m = loudnessSeries(channelsOf(s.music), rate);
    const gaps = v.flatMap((b, i) => (b.lufs > -40 && m[i] ? [b.lufs - m[i].lufs] : []));
    const gap = median(gaps);
    if (gaps.length && gap < 8) issues.push({ check: 'sound', severity: 'warning', ...say(SOUND_TEXTS.voice, { lu: gap.toFixed(1) }) });
  }
  // the music: no dip nobody planned (a stop before a hero is one)
  if (s.music) {
    const heroes = effects.filter((e) => e.clip.weight === 'hero' && e.hit !== null).map((e) => e.hit!);
    const bed = clips.filter((x) => x.role === 'music' || x.role === 'ambience');
    const from = Math.min(...bed.map((x) => x.at)) + 1.5, to = Math.max(...bed.map((x) => x.at + x.duration)) - 1.5;
    const short = loudnessSeries(channelsOf(s.music), rate, 'short-term').map((b) => ({ t: b.t + 1.5, lufs: b.lufs }));
    const inside = short.filter((b) => b.t >= from && b.t <= to), level = median(inside.map((b) => b.lufs));
    let reported = -Infinity;
    for (const b of inside) {
      if (level - b.lufs > 12 && b.t - reported > 3 && !heroes.some((h) => b.t >= h - 1.5 && b.t <= h + 0.5)) {
        issues.push({ check: 'sound', severity: 'info', t: +b.t.toFixed(2), ...say(SOUND_TEXTS.dip, { lu: (level - b.lufs).toFixed(0), t: b.t.toFixed(2) }) });
        reported = b.t;
      }
    }
  }
  // silences inside the sound nobody planned
  const planned = (c.markers ?? []).filter((m) => m.kind === 'silence').map((m) => [m.t - 0.1, m.t + (m.duration ?? 0) + 0.1]);
  const first = Math.min(...clips.map((x) => x.at)), lastEnd = Math.max(...clips.map((x) => x.at + x.duration));
  const env = loudnessSeries(final, rate).map((b) => ({ t: b.t + 0.2, quiet: b.lufs < -50 }));
  for (let i = 0; i < env.length;) {
    if (!env[i].quiet) { i++; continue; }
    let j = i;
    while (j < env.length && env[j].quiet) j++;
    const a = env[i].t, b = env[Math.min(env.length - 1, j - 1)].t;
    if (b - a >= 0.5 && a > first + 0.2 && b < lastEnd - 0.2 && !planned.some(([p, q]) => a >= p && b <= q)) {
      issues.push({ check: 'sound', severity: 'info', t: +a.toFixed(2), ...say(SOUND_TEXTS.silence, { from: a.toFixed(2), to: b.toFixed(2) }) });
    }
    i = j;
  }
  // short sounds starting together
  const short = clips.filter((x) => x.duration < 1.5).sort((a, b) => a.at - b.at);
  for (let i = 1; i < short.length; i++) {
    if (short[i].at - short[i - 1].at < 0.04) issues.push({ check: 'sound', severity: 'info', t: short[i].at, layers: [short[i - 1].layerId, short[i].layerId], ...say(SOUND_TEXTS.together, { t: short[i].at.toFixed(2) }) });
  }
  const listen = listenTimes(effects, issues, c.duration);
  return {
    issues, listen,
    master: { lufs: +lufs.toFixed(1), truePeak: +tp.toFixed(1), target },
    ...(opts.image ? { image: mixPicture(ctx, s.final, effects) } : {}),
  };
}

/** five moments to check by ear: the heroes, then the warnings, then where the effects crowd */
function listenTimes(effects: Effect[], issues: QualityIssue[], duration: number): number[] {
  const hits = effects.filter((e) => e.hit !== null);
  const crowd = hits.map((e) => ({ t: e.hit!, n: hits.filter((o) => Math.abs(o.hit! - e.hit!) <= 1).length })).sort((a, b) => b.n - a.n).map((x) => x.t);
  const order = [...hits.filter((e) => e.clip.weight === 'hero').map((e) => e.hit!), ...issues.filter((i) => i.severity === 'warning' && i.t !== undefined).map((i) => i.t!), ...crowd];
  const out: number[] = [];
  for (const x of order) if (x >= 0 && x < duration && out.every((y) => Math.abs(y - x) > 1) && out.length < 5) out.push(+x.toFixed(2));
  return out.sort((a, b) => a - b);
}

/** the mix drawn for the assistant: the master's waveform, its spectrogram, how much the picture moves, a line at each effect (heroes red, the others grey) */
function mixPicture(ctx: ToolContext, final: AudioBuffer, effects: Effect[]): string {
  const c = ctx.doc.compositions[ctx.compId], W = 1100, { el, g } = canvas(W, 400), x0 = 8, w = W - 16;
  const d = final.getChannelData(0), px = (time: number) => x0 + (time / c.duration) * w;
  caption(g, `${c.name ?? ctx.compId} · ${c.duration.toFixed(1)} s`, x0, 14);
  drawWave(g, d, x0, 22, w, 90, '#d6dde0');
  drawSpectrogram(g, d, final.sampleRate, x0, 118, w, 170);
  const motion = pictureMotion(new Evaluator(ctx.doc, ctx.registry), ctx.compId);
  drawCurve(g, motion.motion, x0, 296, w, 70);
  caption(g, 'picture motion', x0, 392, INK.motion, '11px system-ui, sans-serif');
  for (const e of effects) if (e.hit !== null) mark(g, px(e.hit), 22, 344, e.clip.weight === 'hero' ? INK.hero : INK.support, e.name.slice(0, 22));
  for (let s = 0; s <= c.duration; s += c.duration > 20 ? 5 : 1) caption(g, `${s}`, px(s) + 2, 392, INK.faint, '10px system-ui, sans-serif');
  return el.toDataURL('image/png');
}

/** the figures of the master, for a line of the check */
export const masterText = (m: NonNullable<SoundReport['master']>) => `Master: ${m.lufs} LUFS${m.target !== null ? ` (${m.target} asked)` : ''}, true peak ${m.truePeak} dBTP.`;
