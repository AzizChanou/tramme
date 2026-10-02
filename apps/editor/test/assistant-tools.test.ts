import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { inputIssues, vocabularyDetail, vocabularyIndex } from '../src/ai/answers.ts';
import { REVIEW_TOOLS } from '../src/review.ts';

describe("the assistant's tools", () => {
  it('refuses an input that does not match the tool, saying what is wrong', () => {
    expect(inputIssues('render_still', { t: 1 })).toEqual([]);
    expect(inputIssues('render_still', {})[0]).toMatch(/^t: /);
    expect(inputIssues('propose_changes', { label: 'x', ops: [] })[0]).toMatch(/^ops: /);
    expect(inputIssues('get_document', { path: 3 })[0]).toMatch(/^path: /);
    // an unknown tool is answered by the runner itself
    expect(inputIssues('nope', {})).toEqual([]);
  });

  it('gives the vocabulary as an index, a fraction of the full entries', () => {
    const reg = builtinRegistry().registerTool(...REVIEW_TOOLS);
    const index = vocabularyIndex(reg);
    const types = reg.listNodes().map((n) => n.type);
    const full = vocabularyDetail(reg, [...types, ...reg.listEffects().map((e) => e.type), ...reg.listModifiers().map((m) => m.type), 'check', 'motion']);
    for (const type of types) expect(index).toContain(`- ${type} "`);
    // a tool with its input: required, optional
    expect(index).toContain('motion(t:number, span?:number, steps?:integer)');
    expect(index.length).toBeLessThan(full.length / 2);
  });

  it('gives the full entries asked for, and names the ones it does not know', () => {
    const reg = builtinRegistry().registerTool(...REVIEW_TOOLS);
    const type = reg.listNodes()[0].type;
    const detail = JSON.parse(vocabularyDetail(reg, [type, 'check', 'nothing-like-it']));
    expect(detail.nodes.map((n: { type: string }) => n.type)).toEqual([type]);
    expect(detail.nodes[0].props).toEqual(reg.listNodes()[0].props);
    expect(detail.tools[0]).toMatchObject({ name: 'check', input: { type: 'object' } });
    expect(detail.unknown).toEqual(['nothing-like-it']);
  });
});
