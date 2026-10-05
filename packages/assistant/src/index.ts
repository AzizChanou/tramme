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

/** how hard a model works on a turn: thinking depth, care, checks (Opus 5.5 alone would run at medium) */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = typeof EFFORTS[number];
/** Claude's level when none is chosen; the other models keep their own default */
export const DEFAULT_EFFORT: Effort = 'high';

// ── other models ─────────────────────────────────────────────
// Claude goes through the companion or the server's Anthropic key. The others
// speak the OpenAI chat format: OpenAI, Gemini, OpenRouter, Z.AI (GLM) and the
// custom providers through the server (their keys are connected in the
// settings, or Worker secrets), local models (Ollama, LM Studio) straight from
// the browser to this machine. A model of another provider is written
// `provider:model` (`openai:gpt-5`, `zai:glm-4-plus`, `local:llama3.1:8b`), of
// a custom provider `custom:<id>:model` (`custom:deepseek:deepseek-chat`).

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'zai' | 'custom' | 'local';
/** the providers built in that are reached through the server */
export const REMOTE: Record<Exclude<Provider, 'anthropic' | 'custom' | 'local'>, { label: string }> = {
  openai: { label: 'OpenAI' },
  gemini: { label: 'Gemini' },
  openrouter: { label: 'OpenRouter' },
  zai: { label: 'Z.AI (GLM)' },
};
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', openrouter: 'OpenRouter', zai: 'Z.AI (GLM)', custom: 'Custom provider', local: 'Local models' };
/** where Ollama answers by default (LM Studio: http://127.0.0.1:1234/v1) */
export const LOCAL_URL = 'http://127.0.0.1:11434/v1';

export function providerOf(model: string): Provider {
  const i = model.indexOf(':');
  const p = i > 0 ? model.slice(0, i) : '';
  if (p === 'glm') return 'zai';
  return p === 'openai' || p === 'gemini' || p === 'openrouter' || p === 'zai' || p === 'custom' || p === 'local' ? p : 'anthropic';
}
/** where the server finds the model: its provider, or custom:<id> for a custom one */
export function slotOf(model: string): string {
  if (providerOf(model) !== 'custom') return providerOf(model);
  const i = model.indexOf(':', 'custom:'.length);
  return i > 0 ? model.slice(0, i) : model;
}
/** the model's name for its provider */
export const modelName = (model: string) => (providerOf(model) === 'anthropic' ? model : model.slice(slotOf(model).length + 1));
/** a short name to show */
export const modelLabel = (model: string) => MODELS.find(([id]) => id === model)?.[1] ?? modelName(model).replace(/^models\//, '');

/** the levels the providers of the chat format share (reasoning_effort, OpenRouter's reasoning.effort) */
const CHAT_EFFORTS: Effort[] = ['low', 'medium', 'high'];

/**
 * The effort levels a model offers, none when it has no such setting. Claude
 * Opus and Sonnet: all five. In the chat format, the reasoning models: OpenAI's
 * o-series and GPT-5 (not their chat variants), Gemini 2.5 and later, the
 * OpenRouter models whose listing says they reason (`reasons`), gpt-oss on a
 * local server. Haiku, Z.AI and the other models: none.
 */
export function effortLevels(model: string, reasons = false): Effort[] {
  const name = modelName(model).toLowerCase().replace(/^models\//, '');
  switch (providerOf(model)) {
    case 'anthropic': return ADAPTIVE.has(model) ? [...EFFORTS] : [];
    case 'openai': return /^(o\d|gpt-5)/.test(name) && !/chat/.test(name) ? CHAT_EFFORTS : [];
    case 'gemini': return /^gemini-(2\.5|[3-9])/.test(name) ? CHAT_EFFORTS : [];
    case 'openrouter': return reasons ? CHAT_EFFORTS : [];
    case 'local': return /gpt-oss/.test(name) ? CHAT_EFFORTS : [];
    default: return [];
  }
}

/** the level a model works at: the one chosen for it, otherwise high for Claude and nothing for the others (their own default) */
export function effortFor(model: string, chosen: Record<string, Effort | undefined>, reasons = false): Effort | undefined {
  const levels = effortLevels(model, reasons);
  if (!levels.length) return undefined;
  const c = chosen[model];
  if (c && levels.includes(c)) return c;
  return providerOf(model) === 'anthropic' ? DEFAULT_EFFORT : undefined;
}

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
    description: 'The current document (JSON), with your pending proposal applied if there is one. With path, only that part (e.g. /compositions/main/layers/title, /tokens): lighter when you know where to look.',
    schema: z.object({
      path: z.string().optional().describe('JSON Pointer of the part to read; the whole document without it'),
    }),
    label: (i) => (i.path ? t('Reading {path} in the document', { path: i.path }) : t('Reading the document')),
  },
  {
    name: 'list_nodes',
    description: "The vocabulary of the project: node, effect and modifier types (built-in and the project's plugins) and the tools they bring (run them with use_tool). Without types: an index, each entry with its properties as name:type=default and notes on when to use it, each tool with its input as name:type (? when optional). With types: the full entries of these names (property labels, descriptions, ranges, options, examples; a tool's input schema).",
    schema: z.object({
      types: z.array(z.string()).optional().describe('node, effect or modifier types and tool names to give in full'),
    }),
    label: (i) => (Array.isArray(i.types) && i.types.length ? t('Reading the details of {types}', { types: i.types.join(', ') }) : t('Reading the node vocabulary')),
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
    description: 'The text content of a project file (.js/.mjs plugin, .json data, .svg). A long file comes in parts: the answer says the offset to read the next one from.',
    schema: z.object({
      path: z.string().describe('path in the project, e.g. plugins/star.js'),
      offset: z.number().int().min(0).optional().describe('character to start from (0 by default)'),
    }),
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
- Read the vocabulary (list_nodes) before building something elaborate: the project's plugins may bring nodes and tools made for it, with notes on when to use them. Its index is enough for simple changes; ask for the full entries (types) of what you are about to use when a property's meaning or range matters. When a tool fits (use_tool), prefer it to writing many operations by hand.
- Read only the part of the document you need (get_document with a path) once you know its layout.
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
- Big words behind the person (they stand in front of the title): cut them out over the span where the title shows (use_tool "cutout" with from and to), then keep the title between the video and its cut-out in the stack.
- To name or point at something that moves in the footage (a car, a person, a product): track it (use_tool "track", with the object's name or its region in % of the picture at a moment where it shows clearly), check the strip it returns, then add a callout (use_tool "callout").
- Check (use_tool "check"), fix, then sum up what you propose.

With music: analyse it first (use_tool "beats"), then put cuts, entrances and transitions on its bars and beats, and make a few elements follow it (the react modifier or audio() in an expression). Strong moments land on section changes. Footage edited elsewhere: find its cuts (use_tool "shots") and land titles and transitions on them.

A story that keeps score (money spent, laughs, points): write its events once as an event list (use_tool "events"), then show it with "event-counter" (the running totals in a corner), "event-tags" (a tag at each event) and "event-receipt" (every event at the end), and read it in expressions with events(). These layers read the list: to move or change an event, save the list again rather than editing them.

Sound: a video without sound feels unfinished, one with a sound on everything feels cheap.
- Sound the moments that matter: a whoosh on a transition, a hit when a title lands, a riser before a reveal, clicks for an interface, a sting on the logo. Not every entrance.
- Search the library first (use_tool "sfx" with a query): it lists each sound with when it lands and how loud it is. Place one with sound and at (times) or on (entrances, exits, markers, cuts, beats, bars, now): its hit falls on the frame, its variants alternate when it repeats.
- What the library lacks, write it as code (use_tool "synth", the presets of the library are examples) and read its waveform; what neither can make (a music bed, a voice-over, a realistic sound), have it made (use_tool "generate-sound"), once, as it costs money.
- Levels: effects around -8 dB, under a voice or a music; music under a voice is ducked (use_tool "duck"). Fades, filters and reverb are properties of the audio layer (fadeIn, fadeOut, lowCut, highCut, reverb, rate).
- You cannot hear: trust the measures (when it lands, peak, loudness) and check the mix (use_tool "check") before summing up.

Pictures: when the project has no picture for what a shot needs (a background a title reads over, a texture, an illustration, a prop), have one made (use_tool "generate-image"): describe what it shows and how it is drawn — technique, palette of the tokens, mood — in the proportions of the composition. You see what comes back: judge it (a background stays quiet under the titles), and have it made again once with a sharper prompt when it is off — it costs money, not drafts. Words are never drawn in the picture: text layers say them, so they stay editable and translatable.

Shorts: to cut a long video into shorts (use_tool "shorts"), read the candidates first and say which you would pick and why: a short stands alone, hooks in its first sentence and ends on a point — one that starts mid-idea is skipped, not rescued. Build with a plan (one passage per short, its title in a few words), then check each composition (use_tool "check", after switching to it) and fix what matters. The frame follows the speaker when a subjects analysis of the video exists: run subjects first (use_tool "subjects") when the format crops the picture, and the build keeps them centred.

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
