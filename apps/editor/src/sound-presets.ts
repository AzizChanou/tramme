// Sounds written as code, for what the recorded library lacks in motion
// design: whooshes, risers, booms, swells. The same form as the synth tool's
// code (the body of an async function (ctx, kit), see renderSynth in
// @tramme/render), so the assistant reads them as examples to start from.

import type { SoundEntry } from '@tramme/core';

const preset = (id: string, title: string, kind: string, tags: string[], duration: number, peakAt: number, code: string): SoundEntry =>
  ({ id: `synth-${id}`, title, kind, tags: ['synth', ...tags], source: 'preset', code: code.trim(), duration, peakAt, license: 'CC0', author: 'tramme' });

export const SOUND_PRESETS: SoundEntry[] = [
  preset('whoosh', 'Whoosh', 'whoosh', ['transition', 'pass', 'air', 'smooth'], 0.9, 0.5, `
const d = kit.duration, n = kit.noise('pink');
const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 1.3;
kit.env(band.frequency, [[0, 280], [d * 0.55, 2400], [d, 450]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [d * 0.55, 1], [d, 0.001]], 'exp');
const pan = ctx.createStereoPanner(); kit.env(pan.pan, [[0, -0.7], [d, 0.7]]);
n.connect(band).connect(g).connect(pan).connect(ctx.destination); n.start(0);`),

  preset('swoosh', 'Swoosh, short', 'whoosh', ['transition', 'fast', 'swipe', 'air'], 0.4, 0.2, `
const d = kit.duration, n = kit.noise('white');
const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 2;
kit.env(band.frequency, [[0, 900], [d * 0.5, 5200], [d, 1500]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [d * 0.5, 1], [d, 0.001]], 'exp');
const pan = ctx.createStereoPanner(); kit.env(pan.pan, [[0, 0.6], [d, -0.6]]);
n.connect(band).connect(g).connect(pan).connect(ctx.destination); n.start(0);`),

  preset('riser', 'Riser', 'riser', ['build', 'tension', 'reveal', 'before'], 2.5, 2.45, `
const d = kit.duration;
const n = kit.noise('white'), hp = ctx.createBiquadFilter(); hp.type = 'highpass';
kit.env(hp.frequency, [[0, 200], [d, 7000]], 'exp');
const saw = ctx.createOscillator(); saw.type = 'sawtooth'; kit.env(saw.frequency, [[0, 110], [d, 880]], 'exp');
const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; kit.env(lp.frequency, [[0, 400], [d, 6000]], 'exp');
const tone = ctx.createGain(); tone.gain.value = 0.25;
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [d * 0.97, 1], [d, 0.001]], 'exp');
n.connect(hp).connect(g); saw.connect(lp).connect(tone).connect(g); g.connect(ctx.destination);
n.start(0); saw.start(0); saw.stop(d);`),

  preset('swell', 'Reverse swell', 'riser', ['reverse', 'cymbal', 'suck', 'build', 'transition'], 1.6, 1.55, `
const d = kit.duration, n = kit.noise('pink');
const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; kit.env(lp.frequency, [[0, 700], [d, 9000]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [d * 0.96, 1], [d, 0.001]], 'exp');
n.connect(lp).connect(g).connect(ctx.destination); n.start(0);`),

  preset('boom', 'Sub boom', 'boom', ['sub', 'bass', 'drop', 'impact', 'cinematic', 'deep'], 1.6, 0.02, `
const d = kit.duration, sine = ctx.createOscillator(); sine.type = 'sine';
kit.env(sine.frequency, [[0, 110], [d * 0.7, 32]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [0.01, 1], [d, 0.001]], 'exp');
const click = kit.noise('white', 0.03), cg = ctx.createGain(); kit.env(cg.gain, [[0, 0.6], [0.03, 0.001]], 'exp');
sine.connect(g).connect(ctx.destination); click.connect(cg).connect(ctx.destination);
sine.start(0); sine.stop(d); click.start(0);`),

  preset('impact', 'Cinematic impact', 'impact', ['cinematic', 'heavy', 'trailer', 'title', 'big', 'hit'], 2, 0.02, `
const d = kit.duration, sine = ctx.createOscillator(); kit.env(sine.frequency, [[0, 90], [0.6, 38]], 'exp');
const sg = ctx.createGain(); kit.env(sg.gain, [[0, 0.001], [0.008, 1], [d, 0.001]], 'exp');
const n = kit.noise('pink'), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; kit.env(lp.frequency, [[0, 6000], [0.5, 300]], 'exp');
const ng = ctx.createGain(); kit.env(ng.gain, [[0, 0.001], [0.005, 0.8], [1.2, 0.001]], 'exp');
sine.connect(sg).connect(ctx.destination); n.connect(lp).connect(ng).connect(ctx.destination);
sine.start(0); sine.stop(d); n.start(0);`),

  preset('thump', 'Soft thump', 'impact', ['soft', 'low', 'body', 'kick', 'beat'], 0.5, 0.01, `
const d = kit.duration, o = ctx.createOscillator(); kit.env(o.frequency, [[0, 140], [0.15, 50]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [0.005, 1], [d, 0.001]], 'exp');
o.connect(g).connect(ctx.destination); o.start(0); o.stop(d);`),

  preset('pop', 'Pop', 'pop', ['bubble', 'appear', 'light', 'playful'], 0.15, 0.03, `
const d = kit.duration, o = ctx.createOscillator(); o.type = 'sine';
kit.env(o.frequency, [[0, 420], [0.06, 1300]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [0.012, 1], [d, 0.001]], 'exp');
o.connect(g).connect(ctx.destination); o.start(0); o.stop(d);`),

  preset('tick', 'Tick', 'click', ['tick', 'clock', 'counter', 'light', 'dry'], 0.05, 0.002, `
const n = kit.noise('white', 0.05), hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3500; hp.Q.value = 4;
const g = ctx.createGain(); kit.env(g.gain, [[0, 1], [0.04, 0.001]], 'exp');
n.connect(hp).connect(g).connect(ctx.destination); n.start(0);`),

  preset('glitch', 'Glitch burst', 'glitch', ['digital', 'error', 'stutter', 'data', 'tech'], 0.5, 0.05, `
const d = kit.duration, o = ctx.createOscillator(); o.type = 'square';
const g = ctx.createGain(); g.gain.value = 0;
for (let t = 0; t < d; t += 0.03) {
  o.frequency.setValueAtTime(80 + kit.random() * 1800, t);
  g.gain.setValueAtTime(kit.random() < 0.7 ? 0.5 + kit.random() * 0.5 : 0, t);
}
g.gain.setValueAtTime(0, d - 0.01);
const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
o.connect(lp).connect(g).connect(ctx.destination); o.start(0); o.stop(d);`),

  preset('sparkle', 'Sparkle', 'chime', ['magic', 'shine', 'shimmer', 'reveal', 'bright', 'positive'], 1.2, 0.1, `
const d = kit.duration;
for (let i = 0; i < 14; i++) {
  const t = kit.random() * d * 0.6, f = 2000 + kit.random() * 4000;
  const o = ctx.createOscillator(); o.frequency.value = f;
  const g = ctx.createGain(); kit.env(g.gain, [[t, 0.001], [t + 0.005, 0.3], [t + 0.35, 0.001]], 'exp');
  const p = ctx.createStereoPanner(); p.pan.value = kit.random() * 1.6 - 0.8;
  o.connect(g).connect(p).connect(ctx.destination); o.start(t); o.stop(t + 0.4);
}`),

  preset('power-down', 'Power down', 'fall', ['tape stop', 'shutdown', 'end', 'slow', 'down'], 1, 0.05, `
const d = kit.duration, o = ctx.createOscillator(); o.type = 'sawtooth';
kit.env(o.frequency, [[0, 260], [d, 25]], 'exp');
const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; kit.env(lp.frequency, [[0, 4000], [d, 150]], 'exp');
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.8], [d, 0.001]], 'exp');
o.connect(lp).connect(g).connect(ctx.destination); o.start(0); o.stop(d);`),

  preset('ambience', 'Room tone', 'ambience', ['room', 'air', 'bed', 'background', 'texture', 'calm'], 8, 4, `
const d = kit.duration, n = kit.noise('brown');
const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
const g = ctx.createGain(); kit.env(g.gain, [[0, 0.001], [1, 0.5], [d - 1, 0.5], [d, 0.001]]);
n.connect(lp).connect(g).connect(ctx.destination); n.start(0);`),
];
