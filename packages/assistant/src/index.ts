// What the assistant knows and can do, the same whichever way it reaches
// Claude (the local companion with the Agent SDK, or the server's key):
// the models offered, the system prompt, the tools. The tools themselves run
// in the editor, where the document, the renderer and the files are.

import { z } from 'zod';

export const MODELS: [id: string, label: string][] = [
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** models that think when they need to (adaptive thinking) */
export const ADAPTIVE = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

// ── other models ─────────────────────────────────────────────
// Claude goes through the companion or the server's Anthropic key. The others
// speak the OpenAI chat format: OpenAI, Gemini and OpenRouter through the
// server (their keys are Worker secrets), local models (Ollama, LM Studio)
// straight from the browser to this machine. A model of another provider is
// written `provider:model` (`openai:gpt-5`, `local:llama3.1:8b`).

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'local';
/** providers reached through the server, with the secret holding their key */
export const REMOTE: Record<Exclude<Provider, 'anthropic' | 'local'>, { label: string; secret: string }> = {
  openai: { label: 'OpenAI', secret: 'OPENAI_API_KEY' },
  gemini: { label: 'Gemini', secret: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter', secret: 'OPENROUTER_API_KEY' },
};
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', openrouter: 'OpenRouter', local: 'Local models' };
/** where Ollama answers by default (LM Studio: http://127.0.0.1:1234/v1) */
export const LOCAL_URL = 'http://127.0.0.1:11434/v1';

export function providerOf(model: string): Provider {
  const i = model.indexOf(':');
  const p = i > 0 ? model.slice(0, i) : '';
  return p === 'openai' || p === 'gemini' || p === 'openrouter' || p === 'local' ? p : 'anthropic';
}
/** the model's name for its provider */
export const modelName = (model: string) => (providerOf(model) === 'anthropic' ? model : model.slice(model.indexOf(':') + 1));
/** a short name to show */
export const modelLabel = (model: string) => MODELS.find(([id]) => id === model)?.[1] ?? modelName(model).replace(/^models\//, '');

/** default port of the local companion (tramme agent) */
export const COMPANION_PORT = 4317;

const Op = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'test']),
  path: z.string().describe('JSON Pointer, e.g. /compositions/main/layers/title/props/text'),
  value: z.any().optional(),
  from: z.string().optional(),
});

export interface ToolDef { name: string; description: string; schema: z.ZodObject<any>; label: (input: any) => string }

// The activity lines (tool labels) are shown to the user: written in English,
// they go through a translator the interface sets (setTranslator), {name}
// replaced by params.name. The descriptions and the prompts stay as they are
// (read by the model).
type Translate = (text: string, params?: Record<string, string | number>) => string;
let translate: Translate = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text);
export function setTranslator(fn: Translate) { translate = fn; }
const t: Translate = (text, params) => translate(text, params);

export const TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    description: 'The current document (JSON), with your pending proposal applied if there is one.',
    schema: z.object({}),
    label: () => t('Reading the document'),
  },
  {
    name: 'list_nodes',
    description: "The vocabulary of the project: node, effect and modifier types (built-in and the project's plugins) with their property schemas, default values and notes on when to use them, and the tools the plugins bring (run them with use_tool).",
    schema: z.object({}),
    label: () => t('Reading the node vocabulary'),
  },
  {
    name: 'evaluate',
    description: 'The value of a property at a given time, as the engine computes it (your proposal included).',
    schema: z.object({
      address: z.string().describe("e.g. 'title.transform.position', 'background.fill', '$comp.background'"),
      t: z.number().describe('time in seconds'),
      compId: z.string().optional(),
    }),
    label: (i) => t('Value of {address} at {t} s', { address: i.address, t: Number(i.t).toFixed(2) }),
  },
  {
    name: 'render_still',
    description: 'Renders the composition at time t (your proposal included) and shows you the frame. The user sees it too.',
    schema: z.object({
      t: z.number().describe('time in seconds'),
      compId: z.string().optional(),
      caption: z.string().optional().describe('what you are checking, in a few words'),
    }),
    label: (i) => t("Rendering the frame at {t} s", { t: Number(i.t).toFixed(2) }),
  },
  {
    name: 'propose_changes',
    description: 'Proposes changes to the document: JSON Patch operations (RFC 6902) on JSON Pointer paths. They add up to your pending proposal; the whole is validated, then shown to the user, who applies or rejects it.',
    schema: z.object({
      label: z.string().describe("short title of the change, in the user's language (also used in the undo history)"),
      ops: z.array(Op).min(1),
    }),
    label: (i) => t('Proposal: {label}', { label: i.label }),
  },
  {
    name: 'discard_proposal',
    description: 'Drops your pending proposal.',
    schema: z.object({}),
    label: () => t('Dropping the proposal'),
  },
  {
    name: 'list_files',
    description: "The project's files (path, size): assets, plugins, renders.",
    schema: z.object({}),
    label: () => t('Listing the project\'s files'),
  },
  {
    name: 'read_file',
    description: 'The text content of a project file (.js/.mjs plugin, .json data, .svg).',
    schema: z.object({ path: z.string().describe('path in the project, e.g. plugins/star.js') }),
    label: (i) => t('Reading {path}', { path: i.path }),
  },
  {
    name: 'write_file',
    description: 'Writes a text file of the project: a plugin in plugins/ (.js or .mjs), or data in assets/ (.json, .svg). The document is never written this way: it changes through propose_changes. A plugin already in use is reloaded in the preview.',
    schema: z.object({
      path: z.string().describe('e.g. plugins/star.js'),
      content: z.string(),
    }),
    label: (i) => t('Writing {path}', { path: i.path }),
  },
];

// ── video dressing: what is said, what is seen, cuts, ready-made dressings ──
TOOLS.push(
  {
    name: 'get_transcript',
    description: 'What is said in a sound or video of the project (asset), sentence by sentence with start and end times, long pauses and hesitations (candidates for cuts). words: true also gives each word with its time. Starts the transcription if it does not exist yet, and waits for it. Times are those of the file; after cut_media, use the transcript of the edit (composition time).',
    schema: z.object({
      asset: z.string().describe('id of the sound or video asset, or of its transcript (json asset)'),
      from: z.number().optional().describe('start (s)'),
      to: z.number().optional().describe('end (s)'),
      words: z.boolean().optional().describe('word by word detail'),
    }),
    label: (i) => t('Reading what is said in {asset}', { asset: i.asset }),
  },
  {
    name: 'media_frame',
    description: 'The frame of a project video (asset) at time t of its file, or an image (image asset). To see what is filmed and place elements without getting in the way (face, hands, object).',
    schema: z.object({ asset: z.string(), t: z.number().optional().describe('time in the file (s), 0 by default') }),
    label: (i) => (i.t !== undefined ? t('Frame of {asset} at {t} s', { asset: i.asset, t: Number(i.t).toFixed(2) }) : t('Frame of {asset}', { asset: i.asset })),
  },
  {
    name: 'cut_media',
    description: 'Edits a sound or video: keeps only the given passages (file time), placed end to end in the composition from `at`. Replaces the existing layers of this media, creates the transcript of the edit (asset "transcription-<asset>-edit", composition time) and reconnects the captions to it. Adds up to your pending proposal. Used to remove silences, hesitations, failed takes.',
    schema: z.object({
      asset: z.string(),
      keeps: z.array(z.object({ from: z.number(), to: z.number() })).min(1).describe('passages kept, in order, file time'),
      at: z.number().optional().describe('composition time where the edit starts (0 by default)'),
      compId: z.string().optional(),
      fitDuration: z.boolean().optional().describe('the composition takes the length of the edit (yes by default)'),
    }),
    label: (i) => t('Editing {asset} ({n} passages)', { asset: i.asset, n: Array.isArray(i.keeps) ? i.keeps.length : 0 }),
  },
  {
    name: 'apply_template',
    description: 'Adds a ready-made dressing in the project colors and font, adapted to the format: "captions" (transcript required: the transcript of the edit or of the file), "title" (text, subtitle), "keyword" (text, at the moment it is said), "lower-third" (text = name, subtitle = role). Adds up to your pending proposal; each layer stays editable afterwards.',
    schema: z.object({
      template: z.enum(['captions', 'title', 'keyword', 'lower-third']),
      at: z.number().describe('composition time (s)'),
      duration: z.number().optional(),
      text: z.string().optional(),
      subtitle: z.string().optional(),
      transcript: z.string().optional().describe('captions: transcript asset'),
      place: z.enum(['top', 'center', 'bottom']).optional(),
      compId: z.string().optional(),
    }),
    label: (i) => (i.text ? t('Dressing: {template} "{text}"', { template: i.template, text: i.text }) : t('Dressing: {template}', { template: i.template })),
  },
);

// ── tools brought by the project's plugins ──
// One generic tool, so the definitions sent to the model stay the same
// whatever the project holds (prompt caching keeps working); list_nodes
// gives each plugin tool with its input schema.
TOOLS.push({
  name: 'use_tool',
  description: "Runs a tool brought by the project's plugins (list_nodes lists them, with their input schema and when to use them): analyses of the media, ready-made layouts, generators. A tool may answer with text and images, and may propose changes, which add up to your pending proposal like propose_changes.",
  schema: z.object({
    name: z.string().describe('name of the tool, as list_nodes gives it'),
    input: z.record(z.string(), z.any()).optional().describe("the tool's input, matching its schema"),
  }),
  label: (i) => t('Tool: {name}', { name: i.name }),
});

/** tools whose activity is shown as a proposal card rather than a line */
export const SILENT = new Set(['propose_changes', 'discard_proposal']);

/** the system prompt; reference is docs/document.md */
export function systemPrompt(reference: string): string {
  return `You are the assistant built into tramme, a motion design editor. You work on a project: a JSON document (described below) and its files (assets/, plugins/, renders/).

Rules:
- Every change to the document goes through the propose_changes tool (JSON Patch operations). The user sees your proposal as a preview, then applies or rejects it.
- propose_changes adds up to your pending proposal (operations chain on the validated document plus your previous operations of this turn). discard_proposal starts over.
- When the request is about "this", "this layer", "here", "now": it means the selection and the current time given in the message context.
- Check your work: after a proposal, run the check tool (use_tool "check": quality checks and a contact sheet of the key moments) and fix the warnings that matter; use the motion tool to judge an entrance or a transition, render_still for one precise frame. Be thrifty: no more pictures than needed.
- Use the existing design tokens (colors, curves) rather than hard-coded values, and follow the style already in the document.
- Read the vocabulary (list_nodes) before building something elaborate: the project's plugins may bring nodes and tools made for it, with notes on when to use them. When a tool fits (use_tool), prefer it to writing many operations by hand.
- For what the existing nodes cannot do, write a node plugin (write_file, for example plugins/my-node.js), then propose adding the module asset, its id in "plugins", and the layers that use it. Rendering must stay a pure function of time. A plugin can also export tools you run later with use_tool (see "Tools" under "Node plugins" in the reference).
- Reply in the user's language, briefly: what you changed and why, without repeating the list of operations.

Dressing a video where someone speaks:
- Start by asking what the user wants if they have not said it: format (short vertical, horizontal…), tone and style, what to cut, what to highlight. One short question, with suggestions.
- Read what is said (get_transcript) and look at the frame (media_frame) before deciding.
- Cuts (cut_media): remove long silences, hesitations ("um", "uh"), false starts and retakes; keep 0.1 to 0.2 s of air around sentences. Then place everything on the transcript of the edit.
- Captions (apply_template "captions") on the transcript of the edit, placed so they do not cover the face.
- Section titles when the subject changes, keywords at the exact moment they are said (the word's time in the transcript), a name and role lower third at the start if the person introduces themselves. Not too much: one strong element every few seconds at most, never two overlapping.
- Fit the composition to the requested format (size, video framed as "cover") before dressing.
- Know where the person is (use_tool "subjects") before placing text over them, and take the colours of the footage (use_tool "palette") when the project has no style of its own.
- Check (use_tool "check"), fix, then sum up what you propose.

With music: analyse it first (use_tool "beats"), then put cuts, entrances and transitions on its bars and beats, and make a few elements follow it (the react modifier or audio() in an expression). Strong moments land on section changes. Footage edited elsewhere: find its cuts (use_tool "shots") and land titles and transitions on them.

${reference}`;
}

export interface TurnContext {
  compId?: string;
  time?: number;
  frame?: number;
  selection?: { id: string; name: string; type: string }[];
}

/** the user's message with what it is about */
export function userPrompt(text: string, ctx: TurnContext, notes: string[]): string {
  const lines = [
    `Composition: ${ctx.compId} · time ${ctx.time} s (frame ${ctx.frame})`,
    `Selection: ${ctx.selection?.length ? ctx.selection.map((s) => `${s.name} (${s.id}, ${s.type})`).join(', ') : 'none'}`,
    ...notes,
  ];
  return `<context>\n${lines.join('\n')}\n</context>\n\n${text}`;
}

/** a tool's result, the same shape on both paths */
export interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}
