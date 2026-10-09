import { describe, expect, it } from 'vitest';
import { validate } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { applyKit, briefOfKit, namesOf, readKit, relink } from '../src/kit.ts';

// the brief.json the kit prompt has an agent write in a repository
const written = {
  version: 1, kind: 'tramme-kit',
  project: { name: 'Boulangerie Lemaire', tagline: 'Le pain du quartier' },
  about: 'Une boulangerie ouvre une deuxième boutique ; pour ses voisins.',
  tokens: {
    plate: { type: 'color', value: '#fbf6ee' },
    ink: { type: 'color', value: '#2B1D14' },
    accent: { type: 'color', value: '#C8102E' },
    enter: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    wrong: { type: 'color', value: 'red' },
    'bad name!': { type: 'color', value: '#000000' },
    curve: { type: 'ease', value: [2, 0, 0.3, 1] },
  },
  fonts: [{ family: 'Fraunces', weights: [400, 700], file: 'tramme/assets/Fraunces.woff2' }, { family: 'Missing', file: null }],
  tone: 'Chaleureux, simple.',
  rules: ['tutoyer', 'jamais de prix'],
  sources: ['tramme/assets/logo.svg : le logo, rouge sur crème'],
  videos: [{ title: 'Ouverture', scenes: [{ assets: ['tramme/assets/vitrine.jpg'] }] }],
};

describe('the kit of a project', () => {
  it('takes the tokens the document can hold, and nothing else', () => {
    const kit = readKit(written)!;
    expect(kit.name).toBe('Boulangerie Lemaire');
    expect(Object.keys(kit.tokens).sort()).toEqual(['accent', 'enter', 'ink', 'plate']);
    expect(kit.tokens.plate.value).toBe('#FBF6EE');
    expect(kit.fonts.map((f) => f.family)).toEqual(['Fraunces', 'Missing']);
    expect(readKit({ name: 'a Lottie', layers: [] })).toBeNull();
    expect(readKit([1, 2])).toBeNull();
  });

  it('points its paths at the files as imported', () => {
    expect(namesOf('tramme/assets/logo.svg')).toEqual(['tramme/assets/logo.svg', 'assets/logo.svg']);
    expect(namesOf('logo.svg')).toEqual([]);
    const moved = new Map([['tramme/assets/logo.svg', 'assets/sources/logo.svg'], ['assets/logo.svg', 'assets/sources/logo.svg'], ['tramme/assets/vitrine.jpg', 'assets/sources/vitrine.jpg']]);
    const out = relink(written, moved);
    expect(out.sources[0]).toBe('assets/sources/logo.svg : le logo, rouge sur crème');
    expect(out.videos[0].scenes[0].assets).toEqual(['assets/sources/vitrine.jpg']);
    // rewritten once: the new path is not taken for an old one
    expect(relink('see assets/logo.svg', moved)).toBe('see assets/sources/logo.svg');
  });

  it('gives the document its colours, curves and fonts, and the project its brief', () => {
    const { doc } = newProject({ name: 'x', width: 1920, height: 1080, fps: 30, duration: 30 });
    const kit = readKit(written)!;
    const moved = new Map([['tramme/assets/Fraunces.woff2', 'assets/sources/fraunces.woff2'], ['tramme/assets/logo.svg', 'assets/sources/logo.svg']]);
    applyKit(doc, kit, moved);
    expect(doc.tokens.background).toEqual({ type: 'color', value: '#FBF6EE' });
    expect(doc.tokens.text).toEqual({ type: 'color', value: '#2B1D14' });
    expect(doc.tokens.accent.value).toBe('#C8102E');
    expect(doc.assets['font-fraunces']).toEqual({ type: 'font', src: 'assets/sources/fraunces.woff2', family: 'Fraunces', name: 'Fraunces', weight: '400 700' });
    expect(doc.assets['font-missing']).toBeUndefined();
    expect(doc.meta.title).toBe('Boulangerie Lemaire');
    expect(validate(doc, builtinRegistry())).toEqual([]);
    const brief = briefOfKit(doc, kit, moved);
    expect(brief).toMatchObject({ kind: 'brief', about: written.about, tone: 'Chaleureux, simple.', rules: ['tutoyer', 'jamais de prix'], sources: ['assets/sources/logo.svg : le logo, rouge sur crème'] });
    expect(brief.look).toMatchObject({ fonts: ['Fraunces'] });
  });
});
