import { describe, expect, it } from 'vitest';
import type { AudioClip, SoundFigures } from '@tramme/core';
import { balance, type Effect } from '../src/mixing.ts';

const figures = (o: Partial<SoundFigures> = {}): SoundFigures => ({ duration: 1, peakAt: 0.01, peakDb: -1, loudDb: -10, rmsDb: -20, start: 0, end: 1, ...o });
/** an effect whose energy is all in one band (dB at gain 0), over a bed given band by band */
function effect(id: string, o: { at: number; band: number; level: number; bed?: number[] | null; weight?: 'hero' | 'support'; asset?: string; bedPeak?: number }): Effect {
  const share = Array(7).fill(0); share[o.band] = 1;
  const bands = Array(7).fill(-120); bands[o.band] = o.level;
  const clip = { layerId: id, asset: o.asset ?? id, at: o.at, duration: 1, offset: 0, gainDb: 0, envelope: null, role: 'effect', weight: o.weight ?? 'support', rate: 1 } as unknown as AudioClip;
  return { clip, name: id, hit: o.at, figures: figures(), bands, share, bed: o.bed === undefined ? Array(7).fill(-40) : o.bed, bedPeak: o.bedPeak ?? -10 };
}

describe('the balance of the effects', () => {
  it('puts a support sound 3.5 dB over the bed in its band, a hero 5 dB', () => {
    const g = balance([effect('a', { at: 1, band: 3, level: -20 }), effect('h', { at: 5, band: 1, level: -20, weight: 'hero' })]);
    expect(g.get('a')).toBe(-16.5);
    expect(g.get('h')).toBe(-15);
  });

  it('holds a bright sound under its cap', () => {
    // all in 4 kHz: the cap (6 dB) is over the lift (3.5): the lift sets it; a bed peaking low caps it
    expect(balance([effect('b', { at: 1, band: 5, level: -30 })]).get('b')).toBe(-6.5);
  });

  it('brings down a support sound crowding the one before, never under the bed', () => {
    // -16.5 needed, 4.4 dB down for the crowding: -20.9, held at -18 so it stays 2 dB over the bed
    const g = balance([effect('a', { at: 1, band: 3, level: -20 }), effect('b', { at: 1.1, band: 3, level: -20, asset: 'other' })]);
    expect(g.get('b')).toBe(-18);
  });

  it('keeps one sound within 2 dB of itself', () => {
    // the louder file would go 10 dB under the others: it comes up to 2 dB under them
    const same = balance([effect('x', { at: 1, band: 3, level: -20, asset: 's' }), effect('y', { at: 3, band: 3, level: -10, asset: 's' }), effect('z', { at: 5, band: 3, level: -20, asset: 's' })]);
    expect([same.get('x'), same.get('y'), same.get('z')]).toEqual([-16.5, -18.5, -16.5]);
  });

  it("holds a sound under the bed's peak even when that leaves it unheard: the check says so", () => {
    expect(balance([effect('p', { at: 1, band: 3, level: -40, bedPeak: -30 })]).get('p')).toBe(-23);
  });

  it('sets a sound over silence by its loudness', () => {
    expect(balance([effect('s', { at: 1, band: 3, level: -20, bed: null })]).get('s')).toBe(-10);
  });
});
