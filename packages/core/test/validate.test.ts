import { describe, expect, it } from 'vitest';
import { documentJsonSchema, validate } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

const issuesOf = (mut: (d: any) => void) => {
  const doc: any = makeDoc();
  mut(doc);
  return validate(doc, registry());
};

describe('validation', () => {
  it('the test document is valid', () => {
    expect(validate(makeDoc(), registry())).toEqual([]);
  });

  it('structure: unknown field, version, type', () => {
    expect(issuesOf((d) => { d.schema = 'tramme/0'; })[0].path).toBe('/schema');
    expect(issuesOf((d) => { d.compositions.main.layers.bg.postion = 1; })[0].path).toBe('/compositions/main/layers/bg');
    expect(issuesOf((d) => { d.compositions.main.fps = -1; })[0].path).toBe('/compositions/main/fps');
  });

  it('tree: orphan layer, placed twice, unknown', () => {
    expect(issuesOf((d) => { d.compositions.main.layers.z = { type: 'box' }; })[0].message).toMatch(/missing from the tree/);
    expect(issuesOf((d) => { d.compositions.main.order.push('a'); })[0].message).toMatch(/twice/);
    expect(issuesOf((d) => { d.compositions.main.order.push('nope'); })[0].message).toMatch(/unknown/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.children = []; })[0].message).toMatch(/does not accept/);
  });

  it('properties: name, type, enum, asset, token, not animatable', () => {
    const p = '/compositions/main/layers/bg/props';
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.colour = '#fff'; })).toEqual([{ path: `${p}/colour`, message: 'unknown property "colour"' }]);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.size = [1]; })[0].message).toBe('[x, y] expected');
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.mode = 'c'; })[0].message).toMatch(/one of a, b/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.image = 'nope'; })[0].message).toMatch(/unknown asset/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.fill = '@nope'; })[0].message).toMatch(/unknown token/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.fill = '@swift'; })[0].message).toMatch(/not a color/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.entry = { $expr: '"y"' }; })[0].message).toMatch(/cannot be animated/);
    expect(issuesOf((d) => { d.compositions.main.layers.bg.props.fill = { type: 'linear', from: [0, 0], to: [1, 1], stops: [[0, '@ink'], [1, '#zzz']] }; })[0].message).toMatch(/unreadable/);
  });

  it('keyframes, curves, expressions, links', () => {
    const p = '/compositions/main/layers/a/props/radius';
    expect(issuesOf((d) => { d.compositions.main.layers.a.props.radius.$k.reverse(); })[0].path).toBe(`${p}/$k/1/t`);
    expect(issuesOf((d) => { d.compositions.main.layers.a.props.radius.$k[0].ease = [2, 0, 1, 1]; })[0].message).toMatch(/between 0 and 1/);
    expect(issuesOf((d) => { d.compositions.main.layers.a.props.radius = { $expr: 'value +' }; })[0].message).toMatch(/invalid expression/);
    expect(issuesOf((d) => { d.compositions.main.layers.b.props.radius = { $link: 'a.nope' }; })[0].message).toMatch(/has no property/);
    expect(issuesOf((d) => { d.compositions.main.layers.b.props.radius = { $link: 'zz.radius' }; })[0].message).toMatch(/unknown layer/);
  });

  it('effects and clips', () => {
    expect(issuesOf((d) => { d.compositions.main.effects[0].type = 'look.nope'; })[0].message).toMatch(/unknown effect/);
    expect(issuesOf((d) => { d.compositions.main.layers.a.clip = 'a'; })[0].message).toMatch(/itself/);
    expect(issuesOf((d) => { d.compositions.main.layers.a.clip = 'grp'; })[0].message).toMatch(/no outline/);
  });

  it('the JSON schema exports', () => {
    const s = documentJsonSchema() as any;
    expect(s.properties.schema.const).toBe('tramme/1');
    expect(s.required).toContain('compositions');
  });
});
