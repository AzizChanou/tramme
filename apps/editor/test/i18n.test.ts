import { describe, expect, it } from 'vitest';
import EN from '../src/i18n/en.json' with { type: 'json' };
import FR from '../src/i18n/fr.json' with { type: 'json' };
import { flatten } from '../src/i18n/index.ts';
import { contentKeys, sourceKeys } from './i18n-keys.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const en = flatten(EN), fr = flatten(FR), content: Record<string, string> = FR.content;

describe('interface languages', () => {
  const used = [...sourceKeys()];

  it('finds the keys of the interface', () => {
    expect(used.length).toBeGreaterThan(500);
    expect(en[used.find((k) => en[k] === 'New project')!]).toBe('New project');
  });

  it('has every key used in English and in French, and no key left unused', () => {
    expect(used.filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(en).filter((k) => !(k in fr))).toEqual([]);
    expect(Object.keys(en).filter((k) => !used.includes(k))).toEqual([]);
    expect(Object.keys(fr).filter((k) => !(k in en))).toEqual([]);
  });

  it('translates every text defined outside the editor', () => {
    expect([...contentKeys()].filter((k) => !(k in content))).toEqual([]);
  });

  it('keeps the same {placeholders} in each translation', () => {
    expect(Object.keys(en).filter((k) => placeholders(en[k]) !== placeholders(fr[k]))).toEqual([]);
    expect(Object.keys(content).filter((k) => placeholders(k) !== placeholders(content[k]))).toEqual([]);
  });

  it('writes no em dash', () => {
    expect([...Object.values(en), ...Object.values(fr), ...Object.values(content)].filter((s) => s.includes('—'))).toEqual([]);
  });
});
