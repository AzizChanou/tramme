import { describe, expect, it } from 'vitest';
import { applyOps, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { fieldsOf, inputOf, listCommands, matchCommands, parseCommand, ready } from '../src/ai/commands.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const sky = {
  tools: [{
    name: 'demo.stars', title: 'Star field', description: 'scatters stars',
    input: { type: 'object', properties: { count: { type: 'integer', minimum: 1, title: 'Count' }, layer: { type: 'string', format: 'layer' }, glow: { type: 'boolean' } }, required: ['count'] },
    run: () => 'ok',
  }],
  prompts: [{ name: 'night', title: 'Night sky', description: 'a whole night scene', prompt: 'Make a night sky.' }],
};

function project(): TrammeDoc {
  const { doc } = newProject({ name: 'Talk', width: 1080, height: 1920, fps: 30, duration: 10 });
  doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
  doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
  doc.assets['transcription-talk-edit'] = { type: 'json', src: 'assets/transcripts/talk-edit.json' };
  return doc;
}

const ctxOf = (doc: TrammeDoc, time = 0): ToolContext => ({ doc, compId: doc.root, time, selection: [], registry: editorRegistry() } as unknown as ToolContext);

describe('the / menu', () => {
  const reg = editorRegistry().clone().use(sky, 'sky');
  const list = listCommands(reg);

  it('lists the editor\'s tools and workflows with the plugins\' ones', () => {
    expect(list.filter((c) => c.kind === 'tool').map((c) => c.name)).toEqual(['captions', 'title', 'keyword', 'lower-third', 'kinetic-title', 'bar-chart', 'stat', 'transition', 'kit', 'beats', 'shots', 'subjects', 'palette', 'check', 'motion', 'library-add', 'library-use', 'demo.stars']);
    expect(list.filter((c) => c.kind === 'prompt').map((c) => `${c.name}:${c.from}`)).toEqual(['dress:tramme', 'review:tramme', 'night:sky']);
  });

  it('finds commands by name first, then by title or description', () => {
    expect(matchCommands(list, 'ti').map((c) => c.name)[0]).toBe('title');
    expect(matchCommands(list, 'star').map((c) => c.name)).toEqual(['demo.stars']);
    expect(matchCommands(list, 'night scene').map((c) => c.name)).toEqual(['night']);
    expect(matchCommands(list, '').length).toBe(list.length);
  });

  it('reads a message written as a command', () => {
    expect(parseCommand('/demo.stars', list)).toMatchObject({ cmd: { name: 'demo.stars' }, rest: '' });
    expect(parseCommand('/demo.stars  denser at the top ', list)).toMatchObject({ cmd: { name: 'demo.stars' }, rest: 'denser at the top' });
    expect(parseCommand('/nothing here', list)).toBeNull();
    expect(parseCommand('make a title', list)).toBeNull();
  });

  it('builds a form from the input schema and reads it back', () => {
    const doc = project();
    const fields = fieldsOf(reg.tool('demo.stars').tool.input, doc, doc.root);
    expect(fields.map((f) => `${f.key}:${f.kind}${f.required ? '*' : ''}`)).toEqual(['count:integer*', 'layer:layer', 'glow:boolean']);
    expect(ready(fields, inputOf(fields, {}))).toBe(false);
    expect(inputOf(fields, { count: '12,4', layer: '', glow: true })).toEqual({ count: 12, glow: true });
    const captions = fieldsOf(reg.tool('captions').tool.input, doc, doc.root);
    expect(captions.find((f) => f.key === 'transcript')?.options?.map(([id]) => id)).toEqual(['transcription-talk', 'transcription-talk-edit']);
  });
});

describe('the dressings as tools', () => {
  it('lay out at the current time and stay valid', () => {
    const reg = editorRegistry();
    let doc = project();
    for (const [name, input] of [['title', { text: 'Hello' }], ['keyword', { text: 'now' }], ['lower-third', { text: 'Ada', subtitle: 'Engineer' }]] as const) {
      const out = reg.tool(name).tool.run(input, ctxOf(doc, 2.5)) as { ops: never[] };
      doc = applyOps(doc, out.ops).doc;
    }
    expect(validate(doc, reg)).toEqual([]);
    const c = doc.compositions[doc.root];
    expect(Object.values(c.layers).every((l) => (l.in ?? 0) >= 2.5)).toBe(true);
  });

  it('put the captions on the transcript of the edit when none is given', () => {
    const doc = project();
    const out = editorRegistry().tool('captions').tool.run({}, ctxOf(doc)) as { ops: { value?: { props?: { transcript?: string } } }[] };
    expect(out.ops.find((o) => o.value?.props?.transcript)?.value?.props?.transcript).toBe('transcription-talk-edit');
  });
});
