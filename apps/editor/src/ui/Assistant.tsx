// The AI assistant: a conversation saved with the project. The agent sees
// the selection and the current time, reads the document, renders stills to
// check itself, and proposes its edits as a batch of ops: previewed in the
// viewport, applied or refused here, undoable like any edit.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AiEvent, ChatItem } from '../api.ts';
import { ENGINE_MODELS, ENGINES, engineOf, providerOf } from '@tramme/assistant';
import { ModelPicker } from './ModelPicker.tsx';
import { aiRoute, aiSettings, aiStatus, ask, CLI_SETUP, cliUnavailable, routeLabel, chat, chatId, chats, decided, deleteChat, newChat, openChat, providerLabel, refreshStatus, remoteProviders, runTool, saveChat, serverName, setAiSettings, statusLabels, stop as stopAi, type ChatMeta } from '../ai/index.ts';
import { openSettings } from '../settings.ts';
import { fieldsOf, inputLine, inputOf, listCommands, matchCommands, parseCommand, ready, type Command, type Field } from '../ai/commands.ts';
import { uid } from '../ai/calls.ts';
import { refreshLibrary } from '../library.ts';
import { acceptProposal, comp, propose, rejectProposal, S, toast, uiTime } from '../state.ts';
import { ago, clip, describeOp, layerName, timecode } from '../model.ts';
import { away, notify } from '../notify.ts';
import { answer, chatShown, question, turnBegins, turnEnds } from '../confirm.ts';
import { Icon } from './icons.tsx';
import { attachFiles, attaching, attachmentUrl, draft, pending, removePending, type Attachment } from '../attachments.ts';
import { Popover, Seg, Select, Toggle } from './controls.tsx';
import { preview } from '../preview.ts';
import { m, t, tr } from '../i18n/index.ts';

export { chat };
const running = signal(false);
/** the text item receiving words right now (no activity line under it meanwhile) */
const streaming = signal<string | null>(null);
/** when the current turn started, for the activity line */
const turnStart = signal(0);
const lightbox = signal<string | null>(null);
let controller: AbortController | null = null;
/** decisions on proposals not yet reported to the agent */
const decisions = new Map<string, string>();

/** what the message is about; reactive when called during render */
function contextLine(live = false): { text: string; data: Record<string, unknown> } {
  const c = live ? comp.value : comp.peek(), now = live ? uiTime.value : S.time.peek();
  const ids = (live ? S.selection.value : S.selection.peek()).filter((id) => c.layers[id]);
  const names = ids.map((id) => layerName(id, c.layers[id]));
  const text = `${names.length ? names.join(', ') : t('common.composition')} · ${timecode(now, c.fps)}`;
  return {
    text,
    data: {
      compId: S.compId.peek(), time: +now.toFixed(4), frame: Math.round(now * c.fps), fps: c.fps,
      selection: ids.map((id) => ({ id, name: c.layers[id].name ?? id, type: c.layers[id].type })),
    },
  };
}

function update(id: string, fn: (it: ChatItem) => ChatItem) {
  chat.value = chat.value.map((it) => (it.id === id ? fn(it) : it));
}

/** a message for the assistant; command: the tool or workflow it was written with (/name) */
export async function send(text: string, command?: { cmd: Command; input?: Record<string, unknown> }) {
  const atts = pending.peek();
  if ((!text.trim() && !atts.length) || running.peek() || attaching.peek()) return;
  if (!text.trim()) text = atts.length > 1 ? t('assistant.hereAreSomeFiles') : t('assistant.hereIsAFile');
  pending.value = [];
  const ctx = contextLine();
  chat.value = [...chat.value, { id: uid(), role: 'user', text, context: ctx.text, ...(atts.length ? { attachments: atts.map(({ path, name, kind, asset }) => ({ path, name, kind, asset })) } : {}) }];
  const ds = [...decisions].map(([id, status]) => ({ id, status }));
  decisions.clear();
  // changes applied without the user: the turn works on its own, nothing is asked
  const auto = aiSettings.peek().apply !== 'off';
  await consume((signal) => ask({ text, context: { ...ctx.data, autonomous: auto }, doc: S.doc.peek(), decisions: ds, attachments: atts, command: command?.cmd, commandInput: command?.input }, signal), auto);
}

/** a tool of the / menu run at once, without the assistant */
export async function runCommand(cmd: Command, input: Record<string, unknown>) {
  if (running.peek()) return;
  const line = inputLine(input);
  chat.value = [...chat.value, { id: uid(), role: 'user', text: `/${cmd.name}${line ? ` · ${line}` : ''}`, context: contextLine().text }];
  await consume((signal) => runTool(cmd.name, input, signal), false);
}

/** shows the events of a turn (the assistant's, or a tool run alone) as they come, then saves the conversation */
async function consume(start: (signal: AbortSignal) => AsyncGenerator<AiEvent>, auto: boolean) {
  running.value = true;
  turnBegins(auto);
  turnStart.value = Date.now();
  streaming.value = null;
  controller = new AbortController();
  const from = chat.peek().length, signal = controller.signal;
  let error = '';
  try {
    for await (const ev of start(controller.signal)) {
      if (ev.type === 'item') { chat.value = [...chat.value, ev.item]; streaming.value = ev.item.text !== undefined ? ev.item.id : null; }
      else if (ev.type === 'text') { update(ev.id, (it) => ({ ...it, text: (it.text ?? '') + ev.delta })); streaming.value = ev.id; }
      else if (ev.type === 'thinking') update(ev.id, (it) => ({ ...it, thinking: it.thinking && { ...it.thinking, text: it.thinking.text + ev.delta } }));
      else if (ev.type === 'thinking-done') update(ev.id, (it) => ({ ...it, thinking: it.thinking && { ...it.thinking, done: true, ms: Date.now() - (it.thinking.start ?? Date.now()) } }));
      else if (ev.type === 'tool-done') update(ev.id, (it) => ({ ...it, tool: it.tool && { ...it.tool, done: true, error: ev.error, progress: undefined } }));
      else if (ev.type === 'tool-progress') update(ev.id, (it) => ({ ...it, tool: it.tool && { ...it.tool, progress: ev.progress } }));
      else if (ev.type === 'proposal') {
        propose({ id: ev.id, label: ev.label, ops: ev.ops });
        const card = { id: ev.id, label: ev.label, count: ev.ops.length, status: 'pending' as const, lines: ev.ops.slice(0, 40).map((o) => `${o.op}\t${describeOp(S.doc.peek(), o)}`) };
        // the agent refines its proposal: the card updates in place
        if (chat.value.some((it) => it.proposal?.id === ev.id)) chat.value = chat.value.map((it) => (it.proposal?.id === ev.id ? { ...it, proposal: card } : it));
        else chat.value = [...chat.value, { id: uid(), role: 'assistant', proposal: card }];
        // apply everything, as it comes: the document moves while the assistant works
        if (aiSettings.peek().apply === 'all') decide(true);
      } else if (ev.type === 'proposal-clear') {
        if (S.proposal.peek()?.id === ev.id) S.proposal.value = null;
        chat.value = chat.value.filter((it) => it.proposal?.id !== ev.id);
      } else if (ev.type === 'reload') {
        preview.reload(ev.assets).catch((e) => toast(t('assistant.pluginError', { error: (e as Error).message }), 'error'));
      } else if (ev.type === 'error') { error = ev.message; chat.value = [...chat.value, { id: uid(), role: 'assistant', text: t('assistant.errorError', { error }) }]; }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') { error = (e as Error).message; chat.value = [...chat.value, { id: uid(), role: 'assistant', text: t('assistant.errorError', { error }) }]; }
  } finally {
    turnEnds();
    running.value = false;
    streaming.value = null;
    controller = null;
    chat.value = chat.value.map((it) => (it.tool && !it.tool.done ? { ...it, tool: { ...it.tool, done: true } }
      : it.thinking && !it.thinking.done ? { ...it, thinking: { ...it.thinking, done: true, ms: Date.now() - (it.thinking.start ?? Date.now()) } } : it));
    // stopped by the user: nothing applied, nothing to tell
    if (!signal.aborted) finished(from, error, Date.now() - turnStart.peek());
    saveChat(chat.value).catch(() => {});
  }
}

/** a turn longer than this is told even when the user stayed in the editor */
const LONG_TURN = 15_000;

/**
 * The turn is over: its proposal applied when the user chose so, then the
 * user told (a notification in the background, a message after a long turn,
 * always when something was applied without them).
 */
function finished(from: number, error: string, ms: number) {
  const { notify: tell, apply } = aiSettings.peek();
  const turn = chat.peek().slice(from);
  const p = S.proposal.peek();
  const proposal = p?.status === 'pending' && turn.some((it) => it.proposal?.id === p.id) ? p : null;
  const applied = !error && !!proposal && apply === 'turn' && decide(true);
  const said = turn.filter((it) => it.role === 'assistant' && it.text).at(-1)?.text?.replace(/\s+/g, ' ').trim();
  const body = error ? t('assistant.doneError', { error })
    : applied ? t('assistant.doneApplied', { label: proposal!.label })
    : proposal ? t('assistant.doneProposal', { label: proposal.label })
    : said ? clip(said, 140) : t('assistant.doneReply');
  if (tell && (away() || ms >= LONG_TURN)) notify(t('assistant.doneTitle', { name: S.project.peek().name }), body, error ? 'error' : 'info');
  else if (applied) toast(body);
}

function stop() {
  stopAi();
  controller?.abort();
}

/**
 * The user (or the automatic application) applies or refuses the proposal:
 * the cards follow, the decision is told to the agent. False when it could
 * not be applied.
 */
export function decide(accept: boolean): boolean {
  const p = S.proposal.peek();
  if (!p) return false;
  const ok = accept ? acceptProposal() : (rejectProposal(), true);
  if (!ok) return false;
  const status = accept ? 'accepted' : 'rejected';
  decisions.set(p.id, status);
  decided(p.id);
  chat.value = chat.value.map((it) => (it.proposal?.id === p.id ? { ...it, proposal: { ...it.proposal, status } } : it));
  saveChat(chat.value).catch(() => {});
  return true;
}

// ── light markdown: paragraphs, lists, code, bold, inline code ──
function inline(s: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[0][0] === '`' ? <code>{m[0].slice(1, -1)}</code> : <strong>{m[0].slice(2, -2)}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function Markdown({ text }: { text: string }) {
  const blocks: ComponentChildren[] = [];
  const parts = text.split(/```[\w-]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2) { blocks.push(<pre key={i}>{part.replace(/\n$/, '')}</pre>); return; }
    for (const [j, para] of part.split(/\n{2,}/).entries()) {
      const lines = para.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) blocks.push(<ul key={`${i}.${j}`}>{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</li>)}</ul>);
      else blocks.push(<p key={`${i}.${j}`}>{lines.map((l, k) => <>{k > 0 && <br />}{inline(l)}</>)}</p>);
    }
  });
  return <div class="text">{blocks}</div>;
}

function ProposalCard({ p }: { p: NonNullable<ChatItem['proposal']> }) {
  const live = S.proposal.value?.id === p.id ? S.proposal.value.status : p.status;
  return (
    <div class={`proposal${live !== 'pending' ? ' done' : ''}`}>
      <div class="proposal-head">
        <Icon name="wand" />
        <span class="ptitle">{p.label}</span>
        <span class={`ptag${live === 'accepted' ? ' ok' : live === 'rejected' ? ' no' : ''}`}>
          {live === 'pending' ? (p.count > 1 ? t('assistant.nChanges', { n: p.count }) : t('assistant.n1Change')) : live === 'accepted' ? t('assistant.applied') : t('assistant.declined')}
        </span>
      </div>
      <ul>
        {p.lines.map((l, i) => { const [op, what] = l.split('\t'); return <li key={i}><span class={`op ${op}`}>{op === 'add' ? '+' : op === 'remove' ? '−' : '~'}</span><span class="what" title={what}>{what}</span></li>; })}
        {p.count > p.lines.length && <li class="faint">{t('assistant.nMore', { n: p.count - p.lines.length })}</li>}
      </ul>
      {live === 'pending' && S.proposal.value?.id === p.id && (
        <div class="proposal-actions">
          <button class="btn sm ghost" onClick={() => { S.showProposal.value = !S.showProposal.value; }}><Icon name={S.showProposal.value ? 'eye' : 'eyeOff'} />{S.showProposal.value ? t('common.preview') : t('assistant.original')}</button>
          <span class="grow" />
          <button class="btn sm" onClick={() => decide(false)}>{t('common.decline')}</button>
          <button class="btn sm primary" onClick={() => decide(true)}><Icon name="check" />{t('common.apply')}</button>
        </div>
      )}
    </div>
  );
}

/** a question asked during the turn (a generation that costs money): answered here */
function QuestionCard() {
  const q = question.value;
  useEffect(() => { chatShown.value++; return () => { chatShown.value--; }; }, []);
  if (!q?.inChat) return null;
  return (
    <div class="proposal question">
      <div class="proposal-head"><Icon name="alert" /><span class="ptitle">{q.title}</span></div>
      <p class="question-text">{q.text}</p>
      <div class="proposal-actions">
        <span class="grow" />
        <button class="btn sm" onClick={() => answer(false)}>{t('common.cancel')}</button>
        <button class="btn sm primary" onClick={() => answer(true)}><Icon name="check" />{q.yes}</button>
      </div>
    </div>
  );
}

/** seconds since a moment, refreshed every second while shown */
function useElapsed(since: number, live: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, Math.round((Date.now() - since) / 1000));
}

/** what the assistant thinks: live while it thinks, folded once done */
function Thinking({ th }: { th: NonNullable<ChatItem['thinking']> }) {
  const live = !th.done && running.value;
  const [open, setOpen] = useState(false);
  const secs = useElapsed(th.start ?? Date.now(), live);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = body.current; if (el && live) el.scrollTop = el.scrollHeight; }, [th.text, live]);
  const took = th.ms !== undefined ? Math.max(1, Math.round(th.ms / 1000)) : secs;
  const text = th.text.trim();
  return (
    <div class={`thinking${live ? ' live' : ''}${open ? ' open' : ''}`}>
      <button class="thinking-head" disabled={!text} onClick={() => setOpen(!open)}>
        <Icon name={live ? 'spinner' : 'more'} />
        <span>{live ? t('assistant.thinking') : t('assistant.thought')}</span>
        <span class="faint mono">{live ? `${secs} s` : `${took} s`}</span>
        {text && !live && <Icon name={open ? 'chevronDown' : 'chevron'} />}
      </button>
      {text && (live || open) && <div class="thinking-body" ref={body}>{text}</div>}
    </div>
  );
}

/** the turn goes on but nothing shows it yet (waiting for the model, between two steps) */
function Working() {
  const secs = useElapsed(turnStart.value, true);
  return <div class="activity running"><Icon name="spinner" />{t('assistant.thinking2')}<span class="faint mono">{secs} s</span></div>;
}

/** a file joined to a message: a thumbnail for an image, its kind and name otherwise */
function FileChip({ a, onRemove }: { a: { path: string; name: string; kind: string }; onRemove?: () => void }) {
  const url = attachmentUrl(a as Attachment);
  return (
    <span class={`file-chip ${a.kind}`} title={a.path}>
      {a.kind === 'image'
        ? <img src={url} alt="" onClick={() => { lightbox.value = url; }} />
        : <Icon name={a.kind === 'video' ? 'film' : a.kind === 'audio' ? 'audio' : a.kind === 'document' ? 'doc' : 'code'} />}
      <span class="file-name">{a.name}</span>
      {onRemove && <button class="icon-btn xs" title={t('common.remove')} onClick={onRemove}><Icon name="x" /></button>}
    </span>
  );
}

function Item({ it }: { it: ChatItem }) {
  if (it.thinking) return <Thinking th={it.thinking} />;
  if (it.role === 'user') return (
    <div class="msg user">
      {it.attachments?.length ? <div class="msg-files">{it.attachments.map((a) => <FileChip key={a.path} a={a} />)}</div> : null}
      <div class="bubble">{it.text}</div>
      {it.context && <div class="ctx">{it.context}</div>}
    </div>
  );
  if (it.tool) {
    const run = !it.tool.done;
    const p = run ? it.tool.progress : undefined, pct = p ? Math.min(100, Math.round((100 * p.done) / Math.max(p.total, 1e-9))) : 0;
    return (
      <div class={`activity${run ? ' running' : ''}`}>
        <Icon name={run ? 'spinner' : it.tool.error ? 'alert' : 'check'} />{it.tool.summary}
        {p && <span class="tool-progress"><span class="progress"><i style={{ width: `${pct}%` }} /></span><span class="mono">{p.step ? `${p.step} ` : ''}{pct} %</span></span>}
      </div>
    );
  }
  if (it.image) return <div class="msg assistant"><div class="shot" onClick={() => { lightbox.value = it.image!.url; }}><img src={it.image.url} alt={it.image.caption} loading="lazy" /></div><div class="shot-cap">{it.image.caption}</div></div>;
  if (it.proposal) return <ProposalCard p={it.proposal} />;
  return <div class="msg assistant"><Markdown text={it.text ?? ''} /></div>;
}

/** an item that already shows the assistant at work */
const active = (it: ChatItem | undefined) => !!it && ((it.tool && !it.tool.done) || (it.thinking && !it.thinking.done) || (it.text !== undefined && it.id === streaming.value));

const SUGGESTIONS = [
  t('assistant.describeTheSceneAt'),
  t('assistant.makeTheSelectedLayer'),
  t('assistant.addATitleThat'),
  t('assistant.checkTheCompositionS'),
];

/** the project's conversations: reopen one to continue it, or delete it */
function History({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const list = chats.value, current = chatId.value;
  const [confirm, setConfirm] = useState<string | null>(null);
  const open = async (c: ChatMeta) => {
    try { await openChat(c.id); onClose(); } catch (e) { toast(t('assistant.unreadableConversationError', { error: (e as Error).message }), 'error'); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} class="chat-history" align="right">
      <div class="history-head">
        <span style={{ fontWeight: 600 }}>{t('common.conversations')}</span>
        <button class="btn sm" onClick={() => { newChat(); onClose(); }}><Icon name="plus" />{t('assistant.new')}</button>
      </div>
      {!list.length && <div class="faint" style={{ padding: '6px 2px' }}>{t('assistant.noConversationSavedIn')}</div>}
      <div class="history-list">
        {list.map((c) => (
          <div key={c.id} class={`history-item${c.id === current ? ' on' : ''}`} role="button" tabIndex={0}
            onClick={() => open(c)} onKeyDown={(e) => e.key === 'Enter' && open(c)}>
            <div class="history-text">
              <span class="history-title" title={c.title}>{c.title}</span>
              <span class="faint">{ago(c.modified)} · {c.count} message{c.count > 1 ? 's' : ''}</span>
            </div>
            {confirm === c.id
              ? <button class="btn sm danger-solid" onClick={(e) => { e.stopPropagation(); deleteChat(c.id).catch((x) => toast((x as Error).message, 'error')); setConfirm(null); }}>{t('common.delete')}</button>
              : <button class="icon-btn sm" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); setConfirm(c.id); }}><Icon name="trash" /></button>}
          </div>
        ))}
      </div>
    </Popover>
  );
}

/** a phone or a tablet: nothing to start a companion with */
const handheld = () => matchMedia('(pointer: coarse)').matches;

/** a command to type in a terminal, copied on click */
function Command({ text }: { text: string }) {
  return <code class="cmd" onClick={() => navigator.clipboard?.writeText(text).then(() => toast(t('common.commandCopied')))} title={t('common.copy')}>{text}</code>;
}

/** the command that starts the local companion for this editor */
const CompanionCommand = () => <Command text={/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'npm run dev' : `npm run tramme -- agent --origin ${location.origin}`} />;

/** where the assistant runs: the AI accounts connected first, then the local companion and local models for those who run them */
function Settings({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const st = aiStatus.value, set = aiSettings.value;
  const [token, setToken] = useState(set.token);
  const [url, setUrl] = useState(set.companionUrl);
  const [localUrl, setLocalUrl] = useState(set.localUrl);
  const labels = statusLabels(st);
  const account = (on: boolean) => (on ? t('common.keySet') : t('common.noKey'));
  return (
    <Popover anchor={anchor} onClose={onClose} class="ai-settings" align="right">
      <div style={{ fontWeight: 600 }}>{t('assistant.aiAccess')}</div>
      <div class="ai-line"><span class={`dot ${st.server ? 'ok' : 'off'}`} /><b>Claude (Anthropic)</b><span class="faint">{account(!!st.server)}</span></div>
      {remoteProviders.value.map((p) => <div key={p.slot} class="ai-line"><span class={`dot ${st.remote[p.slot] ? 'ok' : 'off'}`} /><b>{p.label}</b><span class="faint">{account(!!st.remote[p.slot])}</span></div>)}
      <button class="btn sm" onClick={() => { onClose(); openSettings('providers'); }}><Icon name="link" />{t('assistant.manageProviders')}</button>
      <details open={set.prefer === 'companion' || st.companion === 'ok' || st.companion === 'unpaired'}>
        <summary class="faint">{t('assistant.companionAdvanced')}</summary>
        <div class="ai-more">
          <div class="ai-line"><span class={`dot ${st.companion === 'ok' ? 'ok' : st.companion === 'checking' ? '' : 'off'}`} /><b>{t('assistant.localCompanion')}</b><span class="faint">{labels.companion}</span></div>
          {st.companion === 'ok' && <div class="faint">{t('assistant.companionAgents', { list: ENGINES.filter((e) => st.engines[e]).map((e) => ENGINE_MODELS[e].label).join(', ') })}</div>}
          <Seg value={set.prefer} options={[['auto', t('common.automatic')], ['companion', t('common.companion')], ['server', serverName()]]} onChange={(v) => setAiSettings({ prefer: v as typeof set.prefer })} />
          <div class="faint">{t('assistant.automaticTheLocalCompanion')}</div>
          {st.companion !== 'ok' && <div class="faint">{t('assistant.inTheTrammeFolder')} <CompanionCommand /></div>}
          <label class="lbl">{t('assistant.tokenShownByThe')}</label>
          <div class="field"><input type="password" value={token} placeholder={t('common.pairingToken')} onInput={(e) => setToken((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ token })} /></div>
          <label class="lbl">{t('assistant.companionAddress')}</label>
          <div class="field"><input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ companionUrl: url })} /></div>
        </div>
      </details>
      <details open={providerOf(set.model) === 'local'}>
        <summary class="faint">{t('assistant.localModelsOllamaLm')}</summary>
        <div class="ai-more">
          <div class="field"><input value={localUrl} placeholder="http://127.0.0.1:11434/v1" onInput={(e) => setLocalUrl((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ localUrl })} /></div>
          <div class="faint">{t('assistant.ollama11434LmStudio')}</div>
        </div>
      </details>
      <button class="btn sm" onClick={() => { setAiSettings({ token, companionUrl: url, localUrl }); refreshStatus(); }}><Icon name="loop" />{t('common.check')}</button>
    </Popover>
  );
}

const ROUTE_TITLE = {
  companion: m('assistant.localCompanionYourClaude'),
  server: m('assistant.serverTheDeploymentS'),
  remote: m('assistant.throughTheServerWith'),
  local: m('assistant.localModelOnThis'),
};

/** how to reach a model, right in the panel when the assistant cannot answer: an AI account first, the companion for those who run one */
function Access() {
  const st = aiStatus.value, set = aiSettings.value;
  const [token, setToken] = useState('');
  if (st.companion === 'checking') return null;
  const provider = providerOf(set.model);
  if (provider === 'local') {
    if (st.local === 'unknown') return null;
    const online = !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    return (
      <div class="access">
        <b>{t('assistant.noLocalModelFound', { url: set.localUrl })}</b>
        <span>{t('assistant.startOllamaOrLm')}</span>
        {online && <span>{t('assistant.ollamaMustAcceptThis')} <Command text={`OLLAMA_ORIGINS=${location.origin}`} /></span>}
        <span class="faint">{t('assistant.theAddressCanBe')}</span>
      </div>
    );
  }
  const connect = <button class="btn sm primary" onClick={() => openSettings('providers')}><Icon name="link" />{t('assistant.connectAnAi')}</button>;
  // Codex or the Gemini CLI: the companion, the command line installed and signed in
  const engine = engineOf(set.model);
  if (engine && engine !== 'claude') {
    const setup = CLI_SETUP[engine];
    return (
      <div class="access">
        <b>{cliUnavailable(set.model)}</b>
        {st.companion !== 'ok' ? <CompanionCommand /> : <><Command text={setup.install} /><Command text={setup.login} /></>}
        <button class="btn sm" onClick={() => refreshStatus()}><Icon name="loop" />{t('assistant.retry')}</button>
      </div>
    );
  }
  if (provider !== 'anthropic' || set.prefer === 'server') return (
    <div class="access">
      <b>{t('ai.providerNotConnected', { provider: provider === 'anthropic' ? 'Anthropic' : providerLabel(set.model) })}</b>
      {connect}
    </div>
  );
  if (st.companion === 'unpaired') return (
    <form class="access" onSubmit={(e) => { e.preventDefault(); if (token) setAiSettings({ token }); }}>
      <b>{t('assistant.theLocalCompanionIs')}</b>
      <span>{t('assistant.inTheCompanionS')}</span>
      <div class="access-row">
        <div class="field"><input type="password" value={token} placeholder={t('common.pairingToken')} onInput={(e) => setToken((e.target as HTMLInputElement).value.trim())} /></div>
        <button class="btn sm primary" type="submit" disabled={!token}>{t('assistant.connect')}</button>
      </div>
    </form>
  );
  return (
    <div class="access">
      <b>{t('assistant.noAiConnected')}</b>
      <span>{t('assistant.connectAnAiHint')}</span>
      {connect}
      {!handheld() && (
        <details class="access-more">
          <summary>{t('assistant.orTheCompanion')}</summary>
          <span>{t('assistant.itRunsClaudeWith')}</span>
          <CompanionCommand />
          <span class="faint">{t('assistant.itConnectsToThisEditor')}</span>
          <button class="btn sm" onClick={() => refreshStatus()}><Icon name="loop" />{t('assistant.retry')}</button>
        </details>
      )}
    </div>
  );
}

/** the commands matching what follows the /, tools first then workflows (the order the keys move in) */
function CommandMenu({ list, hi, onHover, onPick }: { list: Command[]; hi: number; onHover: (i: number) => void; onPick: (c: Command) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.querySelector('.command-row.on')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const row = (c: Command, i: number) => (
    <button key={c.name} role="option" aria-selected={i === hi} class={`command-row${i === hi ? ' on' : ''}`}
      onMouseDown={(e) => { e.preventDefault(); onPick(c); }} onMouseEnter={() => onHover(i)}>
      <span class="command-icon"><Icon name={c.kind === 'tool' ? 'wand' : 'chat'} /></span>
      <span class="command-text">
        <span class="command-line"><span class="command-title">{tr(c.title)}</span><span class="command-name">/{c.name}</span></span>
        <span class="command-desc">{tr(c.description)}</span>
      </span>
      {c.from !== 'tramme' && <span class="command-from" title={c.from}>{c.from}</span>}
    </button>
  );
  const tools = list.filter((c) => c.kind === 'tool').length;
  return (
    <div class="command-menu">
      <div class="command-list" role="listbox" ref={ref}>
        {tools > 0 && <div class="command-section">{t('assistant.tools')}</div>}
        {list.slice(0, tools).map((c, i) => row(c, i))}
        {tools < list.length && <div class="command-section">{t('assistant.workflows')}</div>}
        {list.slice(tools).map((c, i) => row(c, tools + i))}
      </div>
      <div class="command-keys"><span><kbd>↑</kbd><kbd>↓</kbd> {t('assistant.keysMove')}</span><span><kbd>↵</kbd> {t('assistant.keysPick')}</span><span><kbd>Esc</kbd> {t('assistant.keysClose')}</span></div>
    </div>
  );
}

/** a field of a tool's form */
function CommandField({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const shown = value ?? f.default;
  let control;
  if (f.kind === 'boolean') control = <Toggle on={!!shown} onChange={onChange} />;
  else if (f.options) control = <Select value={shown === undefined ? '' : String(shown)} options={[...(f.required ? [] : [['', '—'] as [string, string]]), ...f.options.map(([v, l]) => [v, f.kind === 'enum' || f.kind === 'kit' ? tr(l) : l] as [string, string])]} onChange={(v) => onChange(v || undefined)} />;
  else {
    const num = f.kind === 'number' || f.kind === 'integer';
    control = (
      <div class={`field${num ? ' num' : ''}`}>
        <input value={shown === undefined ? '' : String(shown)} inputMode={num ? 'decimal' : undefined} spellcheck={false} placeholder={f.required ? undefined : t('assistant.auto')}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
      </div>
    );
  }
  return <label class="command-field" title={f.description ? tr(f.description) : undefined}><span class="lbl">{tr(f.label)}{f.required ? ' *' : ''}</span>{control}</label>;
}

/** the command written in the message box: its form (tools) or what it does (workflows) */
function CommandCard({ cmd, fields, values, onChange, onRun, canRun, busy }: { cmd: Command; fields: Field[]; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void; onRun: () => void; canRun: boolean; busy: boolean }) {
  return (
    <div class="command-card">
      <div class="command-head"><Icon name={cmd.kind === 'tool' ? 'wand' : 'chat'} /><b>{tr(cmd.title)}</b><span class="faint">{tr(cmd.description)}</span></div>
      {fields.length > 0 && <div class="command-fields">{fields.map((f) => <CommandField key={f.key} f={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />)}</div>}
      <div class="command-actions">
        <span class="faint">{cmd.kind === 'tool' ? t('assistant.commandHint') : t('assistant.workflowHint')}</span>
        {cmd.kind === 'tool' && <button class="btn sm primary" disabled={!canRun || busy} onClick={onRun}><Icon name="check" />{t('assistant.run')}</button>}
      </div>
    </div>
  );
}

export function Assistant({ style }: { style?: Record<string, string | number> }) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const items = chat.value, busy = running.value, full = S.assistantFull.value;
  const route = aiRoute.value, model = aiSettings.value.model;
  const available = route !== null;
  const [settings, setSettings] = useState<HTMLElement | null>(null);
  useEffect(() => { refreshStatus(); }, []);
  // unavailable: look again now and then, the companion may have just started
  useEffect(() => {
    if (available) return;
    const id = setInterval(() => refreshStatus(true), 4000);
    return () => clearInterval(id);
  }, [available]);
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [items.length, items.at(-1)?.text]);
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(180, el.scrollHeight)}px`; } }, [text]);
  // words prepared for the user (a project made from sources: the analysis)
  const prepared = draft.value;
  useEffect(() => { if (prepared) { setText(prepared); draft.value = ''; } }, [prepared]);
  const ctx = contextLine(true);
  // the / menu: the tools and workflows of the vocabulary (the editor's and the project's plugins)
  const reg = S.registry.value;
  const commands = useMemo(() => listCommands(reg), [reg]);
  const [hi, setHi] = useState(0);
  const [menuOff, setMenuOff] = useState(false);
  const [form, setForm] = useState<{ name: string; values: Record<string, unknown> }>({ name: '', values: {} });
  const typing = /^\/([\w.-]*)$/.exec(text);
  const found = typing && !menuOff ? matchCommands(commands, typing[1], tr).slice(0, 30) : [];
  const matches = [...found.filter((c) => c.kind === 'tool'), ...found.filter((c) => c.kind === 'prompt')];
  const menu = matches.length > 0;
  // the library's plugins, fresh for its pickers whenever the menu opens
  useEffect(() => { if (menu) refreshLibrary(); }, [menu]);
  const parsed = menu ? null : parseCommand(text, commands);
  const cmd = parsed?.cmd ?? null;
  const values = cmd && form.name === cmd.name ? form.values : {};
  const fields = cmd?.kind === 'tool' ? fieldsOf(cmd.input, S.doc.value, S.compId.value, reg, S.selection.value) : [];
  const input = inputOf(fields, values);
  const direct = cmd?.kind === 'tool' && !parsed!.rest && ready(fields, input);
  const pick = (c: Command) => { setText(`/${c.name} `); setHi(0); setForm({ name: c.name, values: {} }); area.current?.focus(); };
  const run = () => { if (!cmd || !direct || busy) return; setText(''); runCommand(cmd, input); };
  const submit = () => {
    const v = text.trim();
    if (!v && !pending.peek().length) return;
    if (direct) { run(); return; }
    if (cmd?.kind === 'tool' && !parsed!.rest) { toast(t('assistant.fillRequired')); return; }
    if (/^\/[\w.-]+$/.test(v) && !cmd) { toast(t('assistant.noCommand')); return; }
    if (!available) return;
    setText('');
    send(v, cmd ? { cmd, input } : undefined);
  };
  const keyDown = (e: KeyboardEvent) => {
    if (menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pick(matches[Math.min(hi, matches.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenuOff(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  const files = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const join = (list: FileList | File[] | null | undefined) => { const f = Array.from(list ?? []); if (f.length) attachFiles(f); };
  const [history, setHistory] = useState<HTMLElement | null>(null);
  const fresh = () => { if (!busy) newChat(); };
  return (
    <div class={`assistant${full ? ' full' : ''}${dropping ? ' dropping' : ''}`} data-tour="assistant" style={full ? undefined : style}
      onDragOver={(e) => { if (available && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDropping(false); }}
      onDrop={(e) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); e.stopPropagation(); setDropping(false); join(e.dataTransfer.files); }}>
      <div class="panel-head">
        <span style={{ color: 'var(--accent)', display: 'grid', paddingLeft: 2 }}><Icon name="chat" /></span>
        <span class="title">{t('common.assistant')}</span>
        {route && <span class={`route ${route}`} title={t(ROUTE_TITLE[route])}>{routeLabel(route, model)}</span>}
        <span class="grow" />
        <ModelPicker />
        <button data-tour="assistant-access" class={`icon-btn sm${available ? '' : ' on'}`} title={t('common.accessToClaude')} onClick={(e) => setSettings(settings ? null : (e.currentTarget as HTMLElement))}><Icon name="sliders" /></button>
        <button data-tour="assistant-history" class={`icon-btn sm${history ? ' on' : ''}`} title={t('common.conversations')} disabled={busy} onClick={(e) => setHistory(history ? null : (e.currentTarget as HTMLElement))}><Icon name="clock" /></button>
        <button class="icon-btn sm" title={t('assistant.newConversationTheOthers')} disabled={busy || !items.length} onClick={fresh}><Icon name="plus" /></button>
        <button class="icon-btn sm" title={full ? t('assistant.collapse') : t('assistant.fullScreen')} onClick={() => { S.assistantFull.value = !full; }}><Icon name={full ? 'collapse' : 'expand'} /></button>
      </div>
      <div class="chat-scroll" ref={scroller}>
        <div class="chat">
          {!items.length && (
            <div class="empty" style={{ gap: 12 }}>
              {/* unavailable: how to reach Claude comes first */}
              {available && <Icon name="chat" />}
              {available && <div>{t('assistant.askForAChange')}</div>}
              {available && <div class="suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
              {commands.length > 0 && <div class="faint">{t('assistant.slashHint')}</div>}
              {chats.value.length > 0 && (
                <div class="recent-chats">
                  <span class="faint">{t('assistant.resumeAConversation')}</span>
                  {chats.value.slice(0, 3).map((c) => <button key={c.id} onClick={() => openChat(c.id)}><Icon name="clock" /><span>{c.title}</span><span class="faint">{ago(c.modified)}</span></button>)}
                </div>
              )}
              {!available && <Access />}
            </div>
          )}
          {items.map((it) => <Item key={it.id} it={it} />)}
          {items.length > 0 && !available && !busy && <Access />}
          <QuestionCard />
          {busy && !active(items.at(-1)) && !question.value && <Working />}
        </div>
      </div>
      <div class="composer-wrap">
        {menu && <CommandMenu list={matches} hi={Math.min(hi, matches.length - 1)} onHover={setHi} onPick={pick} />}
        <div class="composer" data-tour="assistant-composer">
          {cmd && <CommandCard cmd={cmd} fields={fields} values={values} busy={busy} canRun={direct} onRun={run}
            onChange={(k, v) => setForm({ name: cmd.name, values: { ...values, [k]: v } })} />}
          {(pending.value.length > 0 || attaching.value > 0) && (
            <div class="pending-files">
              {pending.value.map((a) => <FileChip key={a.path} a={a} onRemove={() => removePending(a.path)} />)}
              {attaching.value > 0 && <span class="file-chip"><Icon name="spinner" /><span class="file-name">{t('assistant.uploading')}</span></span>}
            </div>
          )}
          <textarea ref={area} rows={1} value={text}
            onPaste={(e) => { const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); join(imgs); } }} placeholder={available ? t('assistant.askForAChange2') : t('assistant.unavailableSlash')}
            role="combobox" aria-expanded={menu} aria-autocomplete="list"
            onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); setMenuOff(false); setHi(0); }}
            onKeyDown={keyDown} />
          <div class="bar">
            <button class="icon-btn sm" title={t('assistant.attachImagesSoundsOr')} disabled={!available} onClick={() => files.current?.click()}><Icon name="attach" /></button>
            <input ref={files} type="file" multiple hidden accept="image/*,audio/*,video/*,.pdf,application/pdf,.json,.svg" onChange={(e) => { join((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
            <div class="grow"><span class="chip" title={t('assistant.contextSentWithThe')}><Icon name="target" />{ctx.text}</span></div>
            {busy
              ? <button class="send stop" title={t('assistant.stop')} onClick={stop}><Icon name="stop" /></button>
              : <button class="send" title={t('assistant.sendEnter')} disabled={(!text.trim() && !pending.value.length) || attaching.value > 0 || (!available && !direct)} onClick={submit}><Icon name="send" /></button>}
          </div>
        </div>
      </div>
      {settings && <Settings anchor={settings} onClose={() => setSettings(null)} />}
      {history && <History anchor={history} onClose={() => setHistory(null)} />}
      {lightbox.value && <div class="lightbox" onClick={() => { lightbox.value = null; }}><img src={lightbox.value} alt="" /></div>}
    </div>
  );
}
