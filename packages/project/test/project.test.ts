import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { checkProject, DOCUMENT, LEGACIES, MANIFEST, newProject, packProject, parseDocument, pathIssue, srcPath, unpackProject } from '../src/index.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const json = (v: unknown) => enc(JSON.stringify(v));

function sample() {
  const { manifest, doc } = newProject({ name: 'Essai', width: 1080, height: 1920, fps: 30, duration: 5 });
  doc.assets.photo = { type: 'image', src: 'assets/photo.png' };
  return new Map<string, Uint8Array>([[MANIFEST, json(manifest)], [DOCUMENT, json(doc)], ['assets/photo.png', new Uint8Array([0x89, 0x50, 1, 2])]]);
}

describe('project format', () => {
  it('allowed and refused paths', () => {
    expect(pathIssue('assets/photo.png')).toBeNull();
    expect(pathIssue('plugins/etoile.js')).toBeNull();
    expect(pathIssue('thumbnail.webp')).toBeNull();
    expect(pathIssue('.tramme/chats/mfz1k2-ab12.json')).toBeNull();
    expect(pathIssue('.tramme/chats/index.json')).toBeNull();
    expect(pathIssue('.tramme/chats/Autre.txt')).not.toBeNull();
    expect(pathIssue('.tramme/notes.json')).not.toBeNull();
    expect(pathIssue('../secret')).toMatch(/invalid/);
    expect(pathIssue('/etc/passwd')).toMatch(/absolute/);
    expect(pathIssue('assets/virus.exe')).toMatch(/extension/);
    expect(pathIssue('elsewhere/x.png')).toMatch(/not allowed/);
    expect(srcPath('assets/./a/../b.png')).toBe('assets/b.png');
    expect(srcPath('../hors.png')).toBeNull();
    expect(srcPath('/pubs/x.png')).toBeNull();
  });

  it('a new project is valid; a missing asset or a missing manifest is not', () => {
    expect(checkProject(sample()).issues).toEqual([]);
    const missing = sample(); missing.delete('assets/photo.png');
    expect(checkProject(missing).issues[0].message).toMatch(/missing file/);
    const noManifest = sample(); noManifest.delete(MANIFEST);
    expect(checkProject(noManifest).issues[0].message).toMatch(/manifest missing/);
    const badDoc = sample(); badDoc.set(DOCUMENT, enc('{"schema":"autre"}'));
    expect(checkProject(badDoc).issues.length).toBeGreaterThan(0);
  });

  it('archive: round trip without renders, wrapping folder removed, non-zip refused', () => {
    const files = sample();
    files.set('renders/film.mp4', new Uint8Array(10));
    const back = unpackProject(packProject(files));
    expect([...back.keys()].sort()).toEqual([DOCUMENT, 'assets/photo.png', MANIFEST].sort());
    expect(checkProject(back).issues).toEqual([]);
    const wrapped = zipSync(Object.fromEntries([...sample()].map(([k, v]) => [`My project/${k}`, v])));
    expect(checkProject(unpackProject(wrapped)).issues).toEqual([]);
    expect(() => unpackProject(enc('not a zip'))).toThrow(/archive/);
  });

  for (const [name, l] of [['trame', LEGACIES[0]], ['emotion', LEGACIES[1]]] as const) {
    it(`an archive under a former name (${name}) is read as today`, () => {
      const { manifest, doc } = newProject({ name: 'Old', width: 640, height: 360, fps: 24, duration: 2 });
      const old = zipSync({
        [l.manifest]: json({ ...manifest, format: l.format }),
        [l.document]: json({ ...doc, schema: `${name}/1` }),
        [`${l.dir}chats/index.json`]: json([]),
      });
      const files = unpackProject(old);
      expect([...files.keys()].sort()).toEqual(['.tramme/chats/index.json', DOCUMENT, MANIFEST]);
      const r = checkProject(files);
      expect(r.issues).toEqual([]);
      expect(r.manifest!.format).toBe('tramme-project/1');
      expect(r.doc!.schema).toBe('tramme/1');
      expect(parseDocument(JSON.stringify({ ...doc, schema: `${name}/1` })).schema).toBe('tramme/1');
    });
  }
});
