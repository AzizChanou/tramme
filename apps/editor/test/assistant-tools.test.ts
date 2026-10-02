import { describe, expect, it } from 'vitest';
import { effortFor, effortLevels } from '@tramme/assistant';
import { builtinRegistry } from '@tramme/nodes';
import { inputIssues, vocabularyDetail, vocabularyIndex } from '../src/ai/answers.ts';
import { REVIEW_TOOLS } from '../src/review.ts';

describe('effort levels', () => {
  it('are offered by the models that have them, and only those', () => {
    expect(effortLevels('claude-opus-5-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortLevels('claude-haiku-4-5-20251001')).toEqual([]);
    expect(effortLevels('openai:gpt-5')).toEqual(['low', 'medium', 'high']);
    expect(effortLevels('openai:o4-mini')).toEqual(['low', 'medium', 'high']);
    expect(effortLevels('openai:gpt-5-chat-latest')).toEqual([]);
    expect(effortLevels('openai:gpt-4.1')).toEqual([]);
    expect(effortLevels('gemini:gemini-2.5-pro')).toEqual(['low', 'medium', 'high']);
    expect(effortLevels('gemini:models/gemini-3-flash')).toEqual(['low', 'medium', 'high']);
    expect(effortLevels('gemini:gemini-2.0-flash')).toEqual([]);
    expect(effortLevels('openrouter:deepseek/deepseek-r1')).toEqual([]);
    expect(effortLevels('openrouter:deepseek/deepseek-r1', true)).toEqual(['low', 'medium', 'high']);
    expect(effortLevels('local:gpt-oss:20b')).toEqual(['low', 'medium', 'high']);
    expect(effortLevels('local:qwen3:8b')).toEqual([]);
    expect(effortLevels('zai:glm-4-plus')).toEqual([]);
  });

  it('follow the choice made for each model; otherwise high for Claude, the model\'s own for the others', () => {
    const chosen = { 'claude-opus-5-5': 'max', 'openai:gpt-5': 'low', 'gemini:gemini-2.5-pro': 'xhigh' } as const;
    expect(effortFor('claude-opus-5-5', chosen)).toBe('max');
    expect(effortFor('claude-sonnet-5-5', chosen)).toBe('high');
    expect(effortFor('openai:gpt-5', chosen)).toBe('low');
    expect(effortFor('openai:o4-mini', chosen)).toBeUndefined();
    // a level the model does not have: its default
    expect(effortFor('gemini:gemini-2.5-pro', chosen)).toBeUndefined();
    expect(effortFor('claude-haiku-4-5-20251001', { 'claude-haiku-4-5-20251001': 'high' })).toBeUndefined();
  });
});

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
