import { describe, expect, it } from 'vitest';
import { Registry, toolInputIssues, toolOutput, type ToolType } from '../src/index.ts';

const stars: ToolType = {
  name: 'demo.stars', description: 'scatters stars',
  input: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 200 }, shape: { enum: ['star', 'dot'] } }, required: ['count'] },
  run: ({ count }) => `${count} stars`,
};

describe('plugin tools', () => {
  it('come with a plugin, in a copy of the registry only', () => {
    const base = new Registry();
    const reg = base.clone().use({ tools: [stars] }, 'sky');
    expect(reg.hasTool('demo.stars')).toBe(true);
    expect(reg.tool('demo.stars').from).toBe('sky');
    expect(reg.listTools().map((e) => e.tool.name)).toEqual(['demo.stars']);
    expect(base.hasTool('demo.stars')).toBe(false);
    expect(reg.clone().hasTool('demo.stars')).toBe(true);
  });

  it('refuses a malformed tool', () => {
    expect(() => new Registry().use({ tools: [{ ...stars, run: undefined as never }] }, 'sky')).toThrow(/malformed tool "demo.stars"/);
    expect(() => new Registry().use({ tools: [{ ...stars, name: 'two words' }] }, 'sky')).toThrow(/malformed tool/);
    expect(() => new Registry().use({ tools: [{ ...stars, description: undefined as never }] }, 'sky')).toThrow(/malformed tool/);
  });

  it('lets a plugin replace its earlier version, but not a built-in register twice', () => {
    const reg = new Registry().use({ tools: [stars] }, 'sky').use({ tools: [{ ...stars, title: 'v2' }] }, 'sky');
    expect(reg.tool('demo.stars').tool.title).toBe('v2');
    expect(() => new Registry().registerTool(stars).registerTool(stars)).toThrow(/already registered/);
  });

  it('checks an input against the schema', () => {
    expect(toolInputIssues(stars.input, { count: 12 })).toEqual([]);
    expect(toolInputIssues(stars.input, {})).toEqual(['count: required']);
    expect(toolInputIssues(stars.input, { count: 1.5 })).toEqual(['count: integer expected']);
    expect(toolInputIssues(stars.input, { count: 500 })).toEqual(['count: at most 200']);
    expect(toolInputIssues(stars.input, { count: 3, shape: 'moon' })).toEqual(['shape: one of "star", "dot"']);
    expect(toolInputIssues({ type: 'object', properties: {}, additionalProperties: false }, { x: 1 })).toEqual(['x: unknown']);
    expect(toolInputIssues({ type: 'object', properties: { r: { type: 'number' } } }, { r: 2 })).toEqual([]);
    expect(toolInputIssues(undefined, [])).toEqual(['the input must be an object']);
    expect(toolInputIssues(undefined, { anything: true })).toEqual([]);
  });

  it('reads any result in one shape', () => {
    expect(toolOutput('done')).toEqual({ text: 'done' });
    expect(toolOutput(undefined)).toEqual({});
    const ops = [{ op: 'add', path: '/meta/x', value: 1 }];
    expect(toolOutput({ text: 'ok', ops, label: 'Stars', reload: ['a', 3], images: [{ url: 'data:image/png;base64,AA', caption: 'c' }, { nope: 1 }] }))
      .toEqual({ text: 'ok', ops, label: 'Stars', reload: ['a'], images: [{ url: 'data:image/png;base64,AA', caption: 'c' }] });
  });
});

describe('plugin manifest', () => {
  it('refuses a plugin written for a newer plugin API, with the way out', () => {
    expect(() => new Registry().use({ meta: { name: 'future', api: 2 }, tools: [stars] }, 'sky')).toThrow(/sky \(future\) needs the plugin API 2; this tramme has 1: update tramme/);
    expect(new Registry().use({ meta: { name: 'now', api: 1 }, tools: [stars] }, 'sky').hasTool('demo.stars')).toBe(true);
    expect(new Registry().use({ tools: [stars] }, 'sky').hasTool('demo.stars')).toBe(true);
  });
});
