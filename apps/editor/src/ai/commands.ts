// The chat's commands: typing / lists the tools and workflows of the
// vocabulary (the editor's own and those of the project's plugins). A tool
// whose required fields are filled runs at once, without a model; with words
// after it, or a workflow, the request goes to the assistant.

import type { JsonSchema, Registry, TrammeDoc } from '@tramme/core';
import { libraryList } from '../library.ts';

export interface Command {
  kind: 'tool' | 'prompt';
  name: string;
  title: string;
  description: string;
  /** 'tramme', or the plugin's id */
  from: string;
  /** tools: the input schema */
  input?: JsonSchema;
  /** workflows: the instructions for the assistant */
  prompt?: string;
}

export function listCommands(reg: Registry): Command[] {
  return [
    ...reg.listTools().map(({ tool, from }): Command => ({ kind: 'tool', name: tool.name, title: tool.title ?? tool.name, description: tool.description, from, input: tool.input })),
    ...reg.listPrompts().map(({ prompt, from }): Command => ({ kind: 'prompt', name: prompt.name, title: prompt.title ?? prompt.name, description: prompt.description, from, prompt: prompt.prompt })),
  ];
}

/** commands matching what follows the /: name first, then title and description */
export function matchCommands(list: Command[], query: string, label: (s: string) => string = (s) => s): Command[] {
  const q = query.toLowerCase();
  if (!q) return list;
  const rank = (c: Command) => (c.name.toLowerCase().startsWith(q) ? 0 : c.name.toLowerCase().includes(q) ? 1 : label(c.title).toLowerCase().includes(q) ? 2 : label(c.description).toLowerCase().includes(q) ? 3 : 9);
  return list.map((c) => ({ c, r: rank(c) })).filter((x) => x.r < 9).sort((a, b) => a.r - b.r).map((x) => x.c);
}

/** a message written as a command: /name, then what the user adds */
export function parseCommand(text: string, list: Command[]): { cmd: Command; rest: string } | null {
  const m = /^\/([A-Za-z][\w.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const cmd = m && list.find((c) => c.name === m[1]);
  return cmd ? { cmd, rest: (m[2] ?? '').trim() } : null;
}

export type FieldKind = 'number' | 'integer' | 'boolean' | 'enum' | 'asset' | 'layer' | 'kit' | 'plugin' | 'library' | 'string';
export interface Field { key: string; kind: FieldKind; label: string; description?: string; required: boolean; options?: [string, string][]; min?: number; max?: number; default?: unknown }

/**
 * The form of a tool, from its input schema: one field per top-level
 * property. `format: 'asset'` (with `assetType`, one type or a list) picks an asset of the
 * document, `format: 'layer'` a layer of the composition (with `layerType`,
 * one type or a list, only those, the selected one or the only one filled in
 * already), `format: 'kit'` a
 * style kit of the vocabulary, `format: 'plugin'` a plugin of the project,
 * `format: 'library'` a plugin of the shared library.
 */
export function fieldsOf(schema: JsonSchema | undefined, doc: TrammeDoc, compId: string, reg?: Registry, selection: string[] = []): Field[] {
  const props = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema?.required ?? []) as string[]);
  return Object.entries(props).map(([key, p]) => {
    const type = Array.isArray(p.type) ? (p.type as string[]).find((x) => x !== 'null') : (p.type as string | undefined);
    const base = { key, label: typeof p.title === 'string' ? p.title : key, required: required.has(key), ...(typeof p.description === 'string' ? { description: p.description } : {}), ...(p.default !== undefined ? { default: p.default } : {}) };
    if (Array.isArray(p.enum)) return { ...base, kind: 'enum', options: p.enum.map((v) => [String(v), String(v)] as [string, string]) };
    if (p.format === 'asset') {
      const types = p.assetType === undefined ? null : ([] as unknown[]).concat(p.assetType);
      const options = Object.entries(doc.assets).filter(([, a]) => !types || types.includes(a.type)).map(([id, a]) => [id, a.name ?? id] as [string, string]);
      return { ...base, kind: 'asset', options };
    }
    if (p.format === 'layer') {
      const types = p.layerType === undefined ? null : ([] as unknown[]).concat(p.layerType);
      const options = Object.entries(doc.compositions[compId]?.layers ?? {}).filter(([, l]) => !types || types.includes(l.type)).map(([id, l]) => [id, l.name ?? id] as [string, string]);
      // a typed pick needs no answer when it is plain: the selected layer of that type, or the only one
      const auto = types && base.default === undefined ? (selection.find((id) => options.some(([o]) => o === id)) ?? (options.length === 1 ? options[0][0] : undefined)) : undefined;
      return { ...base, kind: 'layer', options, ...(auto ? { default: auto } : {}) };
    }
    if (p.format === 'plugin') return { ...base, kind: 'plugin', options: (doc.plugins ?? []).filter((id) => doc.assets[id]?.type === 'module').map((id) => [id, doc.assets[id].name ?? id] as [string, string]) };
    if (p.format === 'library') return { ...base, kind: 'library', options: libraryList.value.map((x) => [x.name, x.name] as [string, string]) };
    if (p.format === 'kit') return { ...base, kind: 'kit', options: (reg?.listKits() ?? []).map(({ kit }) => [kit.name, kit.title ?? kit.name] as [string, string]) };
    if (type === 'number' || type === 'integer') return { ...base, kind: type, ...(typeof p.minimum === 'number' ? { min: p.minimum } : {}), ...(typeof p.maximum === 'number' ? { max: p.maximum } : {}) };
    if (type === 'boolean') return { ...base, kind: 'boolean' };
    return { ...base, kind: 'string' };
  });
}

/** the form's values as the tool's input: empty fields left out, numbers read */
export function inputOf(fields: Field[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key] ?? f.default;
    if (v === undefined || v === '') continue;
    if (f.kind === 'number' || f.kind === 'integer') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (Number.isFinite(n)) out[f.key] = f.kind === 'integer' ? Math.round(n) : n;
    } else out[f.key] = v;
  }
  return out;
}

/** every required field has a value */
export const ready = (fields: Field[], input: Record<string, unknown>) => fields.every((f) => !f.required || input[f.key] !== undefined);

/** the input in a few words, for the message line */
export const inputLine = (input: Record<string, unknown>) => Object.entries(input).map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ');
