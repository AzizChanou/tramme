import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { filesRegistry } from '../src/plugins.ts';

/** a project folder as the files of an archive */
function read(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p); else files.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk('');
  return files;
}

// a project with its own plugin (a node, a tool, a workflow)
const NIGHT_SKY = path.resolve(import.meta.dirname, 'fixtures/night-sky');

describe('a project in memory (pack, unpack)', () => {
  it('is checked with its own plugins, not the built-in vocabulary alone', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    expect(validate(doc, builtinRegistry()).some((i) => /unknown node type/.test(i.message))).toBe(true);
    expect(validate(doc, await filesRegistry(doc, files))).toEqual([]);
  });

  it('names a plugin that is missing or does not load', async () => {
    const files = read(NIGHT_SKY);
    const doc = JSON.parse(new TextDecoder().decode(files.get('document.tramme.json'))) as TrammeDoc;
    const id = doc.plugins![0], file = doc.assets[id].src;
    const missing = new Map(files); missing.delete(file);
    await expect(filesRegistry(doc, missing)).rejects.toThrow(`plugin "${id}" not found`);
    const broken = new Map(files); broken.set(file, new TextEncoder().encode('export const nodes = [ {'));
    await expect(filesRegistry(doc, broken)).rejects.toThrow(`plugin "${id}" unreadable`);
  });
});
