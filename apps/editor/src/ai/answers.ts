// What the tools answer the assistant, kept lean, and the inputs they refuse.
// Pure functions of the vocabulary and the tool definitions: the runner
// (tools.ts) uses them in the editor, the tests without a browser.

import type { AiNotes, JsonSchema, PropSchema, Registry } from '@tramme/core';
import { TOOLS } from '@tramme/assistant';

/** what is wrong with a tool's input against its schema, one line per problem */
export function inputIssues(name: string, input: unknown): string[] {
  const def = TOOLS.find((x) => x.name === name);
  if (!def) return [];
  const r = def.schema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(input)'}: ${i.message}`);
}

// ── the vocabulary's index: each entry in a line or two, its full schema on demand ──
const short = (v: unknown) => { const s = JSON.stringify(v); return s.length > 40 ? `${s.slice(0, 37)}…` : s; };
const propLine = (props: PropSchema) => Object.entries(props).map(([k, d]) => `${k}:${d.options ? d.options.join('|') : d.type}=${short(d.default)}`).join(', ');
const notes = (ai?: AiNotes) => [ai?.when && `  when: ${ai.when}`, ai?.avoid && `  avoid: ${ai.avoid}`].filter(Boolean).join('\n');
function inputLine(schema?: JsonSchema): string {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const required = new Set((schema?.required ?? []) as string[]);
  return Object.entries(props).map(([k, p]) => `${k}${required.has(k) ? '' : '?'}:${p.enum ? p.enum.join('|') : p.type ?? 'any'}`).join(', ');
}

/** an entry of the vocabulary: its name, its line in the index, its full description */
interface Entry { name: string; head: string; props: string; ai?: AiNotes; full: Record<string, unknown> }
type Section = 'nodes' | 'effects' | 'modifiers' | 'tools';
const HEADINGS: Record<Section, string> = {
  nodes: 'Nodes (type, title, category):',
  effects: 'Effects (type, title, stage):',
  modifiers: 'Modifiers (type, title):',
  tools: 'Tools (run with use_tool; name(input), from):',
};
const withNotes = (ai?: AiNotes) => (ai ? { ai } : {});

/** the vocabulary by section, each entry once, for the index and the details alike */
function entries(reg: Registry): Record<Section, Entry[]> {
  return {
    nodes: reg.listNodes().map((n) => ({
      name: n.type, head: `${n.type} "${n.title}" [${n.category}${n.container ? ', container' : ''}]`, props: propLine(n.props), ai: n.ai,
      full: { type: n.type, title: n.title, category: n.category, container: !!n.container, ...withNotes(n.ai), props: n.props },
    })),
    effects: reg.listEffects().map((e) => ({
      name: e.type, head: `${e.type} "${e.title}" [${e.stage}]`, props: propLine(e.props), ai: e.ai,
      full: { type: e.type, title: e.title, stage: e.stage, ...withNotes(e.ai), props: e.props },
    })),
    modifiers: reg.listModifiers().map((m) => ({
      name: m.type, head: `${m.type} "${m.title}"${m.description ? `: ${m.description}` : ''}`, props: propLine(m.params), ai: m.ai,
      full: { type: m.type, title: m.title, description: m.description, ...withNotes(m.ai), params: m.params },
    })),
    tools: reg.listTools().map(({ tool: x, from }) => ({
      name: x.name, head: `${x.name}(${inputLine(x.input)}) [${from}]${x.description ? `: ${x.description}` : ''}`, props: '', ai: x.ai,
      full: { name: x.name, from, description: x.description, ...withNotes(x.ai), input: x.input ?? { type: 'object' } },
    })),
  };
}

/** every node, effect, modifier and tool in a line or two: properties as name:type=default, notes on when to use it */
export function vocabularyIndex(reg: Registry): string {
  const out: string[] = [];
  for (const [section, list] of Object.entries(entries(reg)) as [Section, Entry[]][]) {
    if (out.length) out.push('');
    out.push(section === 'tools' && !list.length ? 'Tools: none.' : HEADINGS[section]);
    for (const e of list) {
      out.push(`- ${e.head}${e.props ? `\n  props: ${e.props}` : ''}`);
      const n = notes(e.ai);
      if (n) out.push(n);
    }
  }
  out.push('', 'list_nodes with types gives the full entries: property labels, descriptions, ranges, examples, tool input schemas.');
  return out.join('\n');
}

/** the full entries of the names asked for (JSON), and the names not found */
export function vocabularyDetail(reg: Registry, types: string[]): string {
  const want = new Set(types), all = entries(reg);
  const pick = (list: Entry[]) => list.filter((e) => want.has(e.name));
  const found = new Set(Object.values(all).flatMap(pick).map((e) => e.name));
  const unknown = types.filter((x) => !found.has(x));
  const full = (s: Section) => pick(all[s]).map((e) => e.full);
  return JSON.stringify({ nodes: full('nodes'), effects: full('effects'), modifiers: full('modifiers'), tools: full('tools'), ...(unknown.length ? { unknown } : {}) });
}
