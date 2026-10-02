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

/** every node, effect, modifier and tool in a line or two: properties as name:type=default, notes on when to use it */
export function vocabularyIndex(reg: Registry): string {
  const out: string[] = [];
  const entry = (head: string, props: string, ai?: AiNotes) => { out.push(`- ${head}${props ? `\n  props: ${props}` : ''}`); const n = notes(ai); if (n) out.push(n); };
  out.push('Nodes (type, title, category):');
  for (const n of reg.listNodes()) entry(`${n.type} "${n.title}" [${n.category}${n.container ? ', container' : ''}]`, propLine(n.props), n.ai);
  out.push('', 'Effects (type, title, stage):');
  for (const e of reg.listEffects()) entry(`${e.type} "${e.title}" [${e.stage}]`, propLine(e.props), e.ai);
  out.push('', 'Modifiers (type, title):');
  for (const m of reg.listModifiers()) entry(`${m.type} "${m.title}"${m.description ? `: ${m.description}` : ''}`, propLine(m.params), m.ai);
  const tools = reg.listTools();
  out.push('', tools.length ? 'Tools (run with use_tool; name(input), from):' : 'Tools: none.');
  for (const { tool: x, from } of tools) entry(`${x.name}(${inputLine(x.input)}) [${from}]${x.description ? `: ${x.description}` : ''}`, '', x.ai);
  out.push('', 'list_nodes with types gives the full entries: property labels, descriptions, ranges, examples, tool input schemas.');
  return out.join('\n');
}

/** the full entries of the names asked for (JSON), and the names not found */
export function vocabularyDetail(reg: Registry, types: string[]): string {
  const want = new Set(types);
  const nodes = reg.listNodes().filter((n) => want.has(n.type)).map((n) => ({ type: n.type, title: n.title, category: n.category, container: !!n.container, ...(n.ai ? { ai: n.ai } : {}), props: n.props }));
  const effects = reg.listEffects().filter((e) => want.has(e.type)).map((e) => ({ type: e.type, title: e.title, stage: e.stage, ...(e.ai ? { ai: e.ai } : {}), props: e.props }));
  const modifiers = reg.listModifiers().filter((m) => want.has(m.type)).map((m) => ({ type: m.type, title: m.title, description: m.description, ...(m.ai ? { ai: m.ai } : {}), params: m.params }));
  const tools = reg.listTools().filter(({ tool: x }) => want.has(x.name)).map(({ tool: x, from }) => ({ name: x.name, from, description: x.description, ...(x.ai ? { ai: x.ai } : {}), input: x.input ?? { type: 'object' } }));
  const found = new Set([...nodes, ...effects, ...modifiers].map((x) => x.type).concat(tools.map((x) => x.name)));
  const unknown = types.filter((x) => !found.has(x));
  return JSON.stringify({ nodes, effects, modifiers, tools, ...(unknown.length ? { unknown } : {}) });
}
