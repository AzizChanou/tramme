// The assistant's ways to a model, and the conversation kept with the
// project. Claude: the local companion (Claude Code login on this machine)
// first, the server's key as fallback. Other providers (OpenAI, Gemini,
// OpenRouter, Z.AI, custom ones) through the server, with the keys connected
// in the settings; local models (Ollama, LM Studio) straight from the
// browser. The conversation is shared by all of them.

import { computed, signal } from '@preact/signals';
import { COMPANION_PORT, DEFAULT_MODEL, EFFORTS, effortFor, effortLevels, LOCAL_URL, MODELS, PROVIDER_LABEL, providerOf, REMOTE, setTranslator, slotOf, systemPrompt, userPrompt, type Effort, type TurnContext } from '@tramme/assistant';
import { CHAT, CHAT_INDEX, chatPath } from '@tramme/project';
import type { TrammeDoc } from '@tramme/core';
import reference from '../../../../docs/document.md';
import { api, type AiEvent, type ChatItem, type KeyedProvider, type KeyStatus } from '../api.ts';
import { S } from '../state.ts';
import { companionTurn, pairCompanion, probeCompanion, stopCompanion } from './companion.ts';
import { ServerSession, type Message } from './server.ts';
import { ToolRunner } from './tools.ts';
import { runCall, uid } from './calls.ts';
import { clip } from '../model.ts';
import type { Command } from './commands.ts';
import { describe, imageBlocks, type Attachment } from '../attachments.ts';
import { locale, t } from '../i18n/index.ts';

export interface AiSettings {
  model: string;
  /** auto: the companion when it answers, the server otherwise */
  prefer: 'auto' | 'companion' | 'server';
  companionUrl: string;
  token: string;
  /** where local models answer (OpenAI format): Ollama by default, LM Studio on :1234 */
  localUrl: string;
  /** the effort level chosen for each model that has levels; none chosen: high for Claude, the model's own default for the others */
  efforts: Record<string, Effort>;
  /** tell the user when a turn is over (a notification when the editor is in the background) */
  notify: boolean;
  /** the proposals are applied as soon as the turn is over, without the preview step (confirmed once in the settings) */
  autoApply: boolean;
}

const KEY = 'tramme.assistant';
function loadSettings(): AiSettings {
  const d: AiSettings = { model: DEFAULT_MODEL, prefer: 'auto', companionUrl: `http://127.0.0.1:${COMPANION_PORT}`, token: '', localUrl: LOCAL_URL, efforts: {}, notify: true, autoApply: false };
  try {
    // the settings kept under the tool's former name (model, companion token) are taken over
    const s = { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem('emotion.assistant') ?? '{}') } as AiSettings;
    if (typeof s.model !== 'string' || (providerOf(s.model) === 'anthropic' && !MODELS.some(([id]) => id === s.model))) s.model = d.model;
    const efforts = s.efforts && typeof s.efforts === 'object' ? s.efforts : {};
    s.efforts = Object.fromEntries(Object.entries(efforts).filter(([, e]) => EFFORTS.includes(e)));
    s.notify = s.notify !== false;
    s.autoApply = s.autoApply === true;
    return s;
  } catch { return d; }
}

setTranslator(t);

export const aiSettings = signal<AiSettings>(loadSettings());
function keepSettings(patch: Partial<AiSettings>) {
  aiSettings.value = { ...aiSettings.peek(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(aiSettings.peek())); } catch { /* private mode */ }
}
export function setAiSettings(patch: Partial<AiSettings>) {
  keepSettings(patch);
  if ('companionUrl' in patch || 'token' in patch || 'localUrl' in patch || ('model' in patch && providerOf(patch.model!) === 'local')) refreshStatus();
}

interface Status {
  companion: 'checking' | 'ok' | 'unpaired' | 'absent';
  /** the server's Anthropic key */
  server: boolean | null;
  /** the other providers with a key, by slot (openai…, custom:<id>) */
  remote: Record<string, boolean>;
  /** the providers connected and where their keys come from (null until the server answered) */
  keys: KeyStatus | null;
  /** local models: looked for only when one is chosen or the model menu opens */
  local: 'unknown' | 'ok' | 'absent';
}
export const aiStatus = signal<Status>({ companion: 'checking', server: null, remote: {}, keys: null, local: 'unknown' });

/** the providers of the chat format reached through the server: the built-in ones, then the custom ones */
export const remoteProviders = computed(() => [
  ...(Object.keys(REMOTE) as (keyof typeof REMOTE)[]).map((p) => ({ slot: p as string, label: REMOTE[p].label })),
  ...(aiStatus.value.keys?.custom ?? []).map((c) => ({ slot: `custom:${c.id}`, label: c.label })),
]);

/** the provider's name as the user knows it (a custom one by the name they gave it) */
export const providerLabel = (model: string) => remoteProviders.value.find((p) => p.slot === slotOf(model))?.label ?? PROVIDER_LABEL[providerOf(model)];

/** effort: the provider says the model reasons, so it takes an effort level (OpenRouter) */
export interface ModelOption { id: string; label: string; effort?: boolean }
/** models offered by each provider besides Claude (filled when the model menu opens) */
export const aiModels = signal<{ remote: Record<string, ModelOption[] | { error: string }>; local: ModelOption[] }>({ remote: {}, local: [] });

/** whether OpenRouter's listing says this model reasons */
function reasons(model: string): boolean {
  if (providerOf(model) !== 'openrouter') return false;
  const list = aiModels.value.remote.openrouter;
  return Array.isArray(list) && !!list.find((o) => `openrouter:${o.id}` === model)?.effort;
}

/** the effort levels the model offers (none: no choice to show) */
export const modelEfforts = (model: string) => effortLevels(model, reasons(model));
/** the level the model works at; undefined: its own default */
export const currentEffort = (model: string) => effortFor(model, aiSettings.value.efforts, reasons(model));
/** the level chosen for a model; null: back to its default */
export function setEffort(model: string, effort: Effort | null) {
  const { [model]: _, ...rest } = aiSettings.peek().efforts;
  keepSettings({ efforts: effort ? { ...rest, [model]: effort } : rest });
}

export type Route = 'companion' | 'server' | 'remote' | 'local';

/** the path the next message takes, or null when none is available */
export const aiRoute = computed<Route | null>(() => {
  const { companion, server, remote, local } = aiStatus.value, { prefer, model } = aiSettings.value;
  const provider = providerOf(model);
  if (provider === 'local') return local === 'ok' ? 'local' : null;
  if (provider !== 'anthropic') return remote[slotOf(model)] ? 'remote' : null;
  if (prefer === 'companion') return companion === 'ok' ? 'companion' : null;
  if (prefer === 'server') return server ? 'server' : null;
  return companion === 'ok' ? 'companion' : server ? 'server' : null;
});

/** what the user reads about the companion and the server's key (the assistant's access panel, the settings) */
export function statusLabels(st: Status = aiStatus.value): { companion: string; server: string } {
  return {
    companion: { checking: t('common.searching'), ok: t('common.connected'), unpaired: t('common.tokenToPaste'), absent: t('common.notRunning') }[st.companion],
    server: st.server === null ? t('common.searching') : st.server ? t('common.keySet') : t('common.noKey'),
  };
}

/** the name of the path, for the assistant's header */
export function routeLabel(route: Route, model: string): string {
  if (route === 'companion') return t('common.companion');
  if (route === 'server') return t('common.server');
  if (route === 'local') return t('ai.local');
  return providerLabel(model);
}

const localBase = () => aiSettings.peek().localUrl.replace(/\/+$/, '');

/** the models a local server offers (OpenAI format), or null when none answers */
async function localModels(): Promise<ModelOption[] | null> {
  try {
    const r = await fetch(`${localBase()}/models`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const body = await r.json() as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean).map((id) => ({ id: `local:${id}`, label: id }));
  } catch { return null; }
}

/** the companion and the server looked for once if nothing did yet (the settings opened from the home page) */
export async function ensureStatus() { if (aiStatus.peek().server === null) await refreshStatus(true); }

/** the model menu opens: what each provider offers now */
export async function loadModels() {
  // which keys the server has, before asking it for their models
  await ensureStatus();
  const [remote, local] = await Promise.all([
    Object.values(aiStatus.peek().remote).some(Boolean) ? api.models().catch(() => ({})) : Promise.resolve({}),
    localModels(),
  ]);
  aiModels.value = { remote: remote as never, local: local ?? [] };
  aiStatus.value = { ...aiStatus.peek(), local: local ? 'ok' : 'absent' };
}

const link = () => ({ url: aiSettings.peek().companionUrl.replace(/\/+$/, ''), token: aiSettings.peek().token });
/** the companion's address and token (transcription, assistant) */
export const companionLink = link;

/** the companion, paired by itself when it was started for this editor's address */
async function reachCompanion(): Promise<'ok' | 'unpaired' | 'absent'> {
  const state = await probeCompanion(link());
  if (state !== 'unpaired') return state;
  const token = await pairCompanion(link().url);
  if (!token || token === link().token) return state;
  keepSettings({ token });
  return probeCompanion(link());
}

/** quiet: no "checking" state shown (the periodic look while the assistant is unavailable) */
export async function refreshStatus(quiet = false) {
  if (!quiet) aiStatus.value = { ...aiStatus.peek(), companion: 'checking' };
  const before = aiStatus.peek();
  const wantLocal = providerOf(aiSettings.peek().model) === 'local';
  const [companion, config, local] = await Promise.all([
    reachCompanion(),
    before.server !== null
      ? Promise.resolve({ server: before.server, remote: before.remote, keys: before.keys })
      : api.config().then((c) => ({ server: c.claude.server, remote: c.llm ?? {}, keys: c.keys ?? null })).catch(() => ({ server: false, remote: {}, keys: null })),
    wantLocal ? localModels() : Promise.resolve(undefined),
  ]);
  const next: Status = { companion, ...config, local: local === undefined ? before.local : local ? 'ok' : 'absent' };
  if (local) aiModels.value = { ...aiModels.peek(), local };
  if (quiet && JSON.stringify(next) === JSON.stringify(aiStatus.peek())) return;
  aiStatus.value = next;
  // an OpenRouter model: its listing says whether it takes an effort level
  if (providerOf(aiSettings.peek().model) === 'openrouter' && next.remote.openrouter && !aiModels.peek().remote.openrouter) loadModels().catch(() => {});
}

// ── conversations ────────────────────────────────────────────
// Each conversation is a file of the project (.tramme/chats/<id>.json); an
// index lists them for the history. "New conversation" keeps the others.

export interface ChatMeta { id: string; title: string; created: string; modified: string; count: number }

const runner = new ToolRunner();
let session: { companion?: string; server: ServerSession } = { server: new ServerSession() };
let created = '';

export const chat = signal<ChatItem[]>([]);
/** the conversations of the project, most recent first */
export const chats = signal<ChatMeta[]>([]);
/** the open conversation; null until its first message is saved */
export const chatId = signal<string | null>(null);

const pid = () => S.project.peek().id;
const newChatId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const sorted = (list: ChatMeta[]) => [...list].sort((a, b) => b.modified.localeCompare(a.modified));

/** a conversation file: its items and how to continue it */
function parse(text: string) {
  const j = JSON.parse(text);
  if (Array.isArray(j)) return { items: j as ChatItem[], companion: undefined, server: undefined, created: '' };
  return {
    items: (Array.isArray(j.items) ? j.items : []) as ChatItem[],
    companion: typeof j.companion === 'string' ? j.companion : undefined,
    server: Array.isArray(j.server) ? (j.server as Message[]) : undefined,
    created: typeof j.created === 'string' ? j.created : '',
  };
}

function titleOf(items: ChatItem[]): string {
  const first = items.find((it) => it.role === 'user' && it.text)?.text ?? t('ai.conversation');
  const line = first.replace(/\s+/g, ' ').trim();
  return clip(line, 69);
}

/** open the most recent conversation of the project; an older single chat.json becomes the first one */
export async function loadChats(files: { path: string }[]) {
  const has = (p: string) => files.some((f) => f.path === p);
  let list: ChatMeta[] = [];
  if (has(CHAT_INDEX)) {
    try { list = JSON.parse((await api.readText(pid(), CHAT_INDEX))?.text ?? '[]'); } catch { list = []; }
  }
  if (!list.length && has(CHAT)) {
    const old = await api.readText(pid(), CHAT);
    if (old) {
      try {
        const c = parse(old.text);
        if (c.items.length) {
          const now = new Date().toISOString(), id = newChatId();
          await api.write(pid(), chatPath(id), JSON.stringify({ version: 1, created: now, items: c.items, companion: c.companion, server: c.server }), { type: 'application/json' });
          list = [{ id, title: titleOf(c.items), created: now, modified: now, count: c.items.filter((it) => it.role === 'user').length }];
          await api.write(pid(), CHAT_INDEX, JSON.stringify(list), { type: 'application/json' });
        }
        await api.removeFile(pid(), CHAT).catch(() => {});
      } catch { /* unreadable: left as it is */ }
    }
  }
  chats.value = sorted(list);
  if (chats.peek().length) await openChat(chats.peek()[0].id);
  else newChat();
}

export async function openChat(id: string) {
  const f = await api.readText(pid(), chatPath(id));
  if (!f) {
    chats.value = chats.peek().filter((c) => c.id !== id);
    newChat();
    return;
  }
  const c = parse(f.text);
  runner.clear();
  session = { companion: c.companion, server: new ServerSession(c.server) };
  created = c.created || chats.peek().find((x) => x.id === id)?.created || new Date().toISOString();
  chatId.value = id;
  chat.value = c.items;
}

/** a fresh conversation; the previous one stays in the history */
export function newChat() {
  runner.clear();
  session = { server: new ServerSession() };
  created = '';
  chatId.value = null;
  chat.value = [];
}

export async function deleteChat(id: string) {
  await api.removeFile(pid(), chatPath(id)).catch(() => {});
  chats.value = chats.peek().filter((c) => c.id !== id);
  await api.write(pid(), CHAT_INDEX, JSON.stringify(chats.peek()), { type: 'application/json' });
  if (chatId.peek() === id) newChat();
}

/** the last few stills keep their picture; older ones keep their caption */
function lighter(items: ChatItem[]): ChatItem[] {
  let images = 0;
  return [...items].reverse().map((it) => {
    if (!it.image) return it;
    if (++images <= 12) return it;
    return { id: it.id, role: it.role, text: `(image : ${it.image.caption})` };
  }).reverse();
}

/** write the open conversation and its line in the index (nothing for an empty one) */
export async function saveChat(items: ChatItem[] = chat.peek()) {
  if (!items.length) return;
  const now = new Date().toISOString();
  let id = chatId.peek();
  if (!id) { id = newChatId(); chatId.value = id; created = now; }
  const data = { version: 1, created, items: lighter(items), companion: session.companion, server: session.server.toJSON() };
  await api.write(pid(), chatPath(id), JSON.stringify(data), { type: 'application/json' });
  const meta: ChatMeta = { id, title: titleOf(items), created, modified: now, count: items.filter((it) => it.role === 'user').length };
  chats.value = sorted([meta, ...chats.peek().filter((c) => c.id !== id)]);
  await api.write(pid(), CHAT_INDEX, JSON.stringify(chats.peek()), { type: 'application/json' });
}

export interface AskPayload { text: string; context: TurnContext; doc: TrammeDoc; decisions: { id: string; status: string }[]; attachments?: Attachment[]; command?: Command; commandInput?: Record<string, unknown> }

/** what the user did without the assistant (tools run from the / menu), told at the next message */
const ranAlone: string[] = [];

/** a tool run straight from the / menu, without a model: its activity, pictures and proposal in the conversation */
export async function* runTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<AiEvent> {
  const r = yield* runCall(runner, 'use_tool', { name, input }, signal);
  const said = r.content.map((c) => (c.type === 'text' ? c.text : '')).filter(Boolean).join('\n');
  if (r.isError) yield { type: 'error', message: said };
  else if (runner.notice) yield { type: 'item', item: { id: uid(), role: 'assistant', text: runner.notice } };
  ranAlone.push(`The user ran the tool "${name}" from the / menu with ${JSON.stringify(input)}${r.isError ? ', which failed' : ''}: ${said || 'no message'}`);
  yield { type: 'done' };
}

/** the note that tells the assistant which command the message comes with */
function commandNote(c: Command, input?: Record<string, unknown>): string {
  if (c.kind === 'prompt') return `The user picked the workflow "${c.title}" (/${c.name}). Follow it, adapted to what they add in their message:\n${c.prompt}`;
  const filled = input && Object.keys(input).length ? ` They already filled in: ${JSON.stringify(input)}.` : '';
  return `The user called the tool "${c.name}" (/${c.name}): run it with use_tool, its input taken from their message and the context (selection, time), then check the result.${filled}`;
}

/** one user message; yields the assistant's events */
export async function* ask(p: AskPayload, signal: AbortSignal): AsyncGenerator<AiEvent> {
  if (!aiRoute.peek()) await refreshStatus();
  const route = aiRoute.peek();
  if (!route) { yield { type: 'error', message: unavailableReason() }; return; }
  // a proposal neither applied nor refused is dropped at the next message
  const dropped = runner.pending && !p.decisions.some((d) => d.id === runner.pending!.id) ? runner.pending : null;
  runner.clear();
  const notes = [
    ...p.decisions.map((d) => `Your proposal ${d.id} was ${d.status === 'accepted' ? 'applied' : 'rejected'} by the user.`),
    ...(dropped ? [`Your previous proposal "${dropped.label}" got no answer; it is dropped.`] : []),
  ];
  notes.push(...ranAlone.splice(0));
  if (p.command) notes.push(commandNote(p.command, p.commandInput));
  notes.push(...describe(p.attachments ?? [], p.doc));
  // the interface's language is the user's: the answers, proposal titles and new layer names follow it
  notes.push(`The user's interface is in ${locale === 'fr' ? 'French' : 'English'}: reply in that language, including the titles of your proposals and the names of the layers you create.`);
  const images = await imageBlocks(p.attachments ?? []);
  // the companion keeps its own history: another model taking over the conversation reads what was said
  if (route !== 'companion' && !session.server.messages.length) notes.unshift(...earlier());
  const prompt = userPrompt(p.text, p.context, notes);
  // the project's brief, when there is one, rides in the system prompt: the assistant follows it from the first word
  let brief: string | null = null;
  try { brief = (await api.readText(S.project.peek().id, 'assets/brief.json'))?.text ?? null; } catch { brief = null; }
  const system = systemPrompt(reference, brief ?? undefined);
  const model = aiSettings.peek().model, effort = currentEffort(model);
  if (route === 'companion') yield* companionTurn(link(), { prompt, system, model, effort, sessionId: session.companion, images }, runner, signal, (id) => { session.companion = id; });
  else {
    const target = route === 'local' ? { url: localBase() } : route === 'remote' ? { url: `/api/llm/${encodeURIComponent(slotOf(model))}` } : undefined;
    yield* session.server.turn(prompt, model, system, runner, signal, { images, target, effort });
  }
  yield { type: 'done' };
}

/** the user decided on the proposal: the tools see the applied document from now on */
export function decided(id: string) { if (runner.pending?.id === id) runner.clear(); }

export function stop() { if (aiRoute.peek() === 'companion') stopCompanion(link()); }

/** the conversation so far, as text, for a model that did not take part in it */
function earlier(): string[] {
  const said = chat.peek().slice(0, -1).filter((it) => it.text && !it.thinking).map((it) => `${it.role === 'user' ? 'User' : 'Assistant'}: ${it.text}`);
  if (!said.length) return [];
  let text = said.join('\n');
  if (text.length > 8000) text = `…${text.slice(-8000)}`;
  return [`Earlier messages of this conversation (with another model):\n${text}`];
}

// ── the providers' keys, connected from the settings ─────────
/** the server's answer again (keys, models), after a provider was connected or removed */
async function providersChanged() {
  aiStatus.value = { ...aiStatus.peek(), server: null };
  aiModels.value = { ...aiModels.peek(), remote: {} };
  await refreshStatus(true);
}
export async function connectProvider(provider: KeyedProvider, key: string) { await api.setKey(provider, key); await providersChanged(); }
export async function disconnectProvider(provider: KeyedProvider) { await api.removeKey(provider); await providersChanged(); }
export async function saveCustomProvider(id: string, c: { label: string; base: string; key?: string }) { await api.setCustom(id, c); await providersChanged(); }
export async function removeCustomProvider(id: string) { await api.removeCustom(id); await providersChanged(); }

export function unavailableReason(): string {
  const { companion, server, remote, local } = aiStatus.peek(), { prefer, model } = aiSettings.peek();
  const provider = providerOf(model);
  if (provider === 'local') return local === 'unknown' ? t('ai.lookingForLocalModels') : t('ai.noLocalModelServer', { url: aiSettings.peek().localUrl });
  if (provider !== 'anthropic') return remote[slotOf(model)] ? '' : t('ai.providerNotConnected', { provider: providerLabel(model) });
  if (companion === 'checking') return t('ai.lookingForTheLocal');
  if (prefer === 'companion' || (prefer === 'auto' && !server)) {
    if (companion === 'unpaired') return t('ai.theLocalCompanionIs');
    return t('ai.noAccessToClaude');
  }
  return t('ai.providerNotConnected', { provider: 'Anthropic' });
}
