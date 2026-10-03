// Settings of this machine: how much the preview may cost, how the
// assistant reaches Claude, the providers connected (their keys kept by the
// server). Opened from the top bar, the home screen or Ctrl+,.
// A menu of sections on the left (the editor's, the assistant's), the one
// chosen on the right; a search shows the settings matching it, whatever
// their section.

import { createContext, type ComponentChildren, type FunctionComponent } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { SoundEntry } from '@tramme/core';
import { api, type KeyedProvider, type KeyStatus } from '../api.ts';
import { EffortPicker, ModelPicker } from './ModelPicker.tsx';
import { aiSettings, aiStatus, connectProvider, disconnectProvider, ensureStatus, refreshStatus, removeCustomProvider, saveCustomProvider, setAiSettings, statusLabels } from '../ai/index.ts';
import { allowNotifications, notificationState } from '../notify.ts';
import { previewInfo } from '../preview.ts';
import { DEFAULT_PREFERENCES, prefs, resetPrefs, setLanguage, setPrefs, settingsOpen, settingsSection, type Preferences, type SettingsSection } from '../settings.ts';
import { S, toast } from '../state.ts';
import { Modal, NumberField, Select, Seg, Toggle } from './controls.tsx';
import { Icon } from './icons.tsx';
import { resetSeen, setAutoTours, toursState } from '../tours/index.ts';
import { LOCALES, m, t } from '../i18n/index.ts';

const MOTION: Record<Preferences['motion'], string> = {
  auto: m('settings.adaptsToTheMachine'),
  full: m('settings.alwaysTheStillResolution'),
  half: m('settings.halfOfTheStill'),
  quarter: m('settings.quarterOfTheStill'),
};
const STILL: Record<Preferences['still'], string> = {
  display: m('settings.theSizeOfThe'),
  full: m('settings.alwaysTheCompositionS'),
};
const BLUR: Record<Preferences['blur'], string> = {
  document: m('settings.theDocumentSSetting'),
  limited: m('settings.atMost4Sub'),
  off: m('settings.noMotionBlurIn'),
};

// ── the search: a row shows when its label or hint holds the words, a section entirely when its title does ──
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const Search = createContext<{ query: string; whole: boolean }>({ query: '', whole: true });

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  const { query } = useContext(Search);
  return (
    <Search.Provider value={{ query, whole: !query || norm(title).includes(query) }}>
      <section class="set-section"><h3>{title}</h3>{children}</section>
    </Search.Provider>
  );
}

/** a setting: its label (and a badge) and hint, its control; `below`, what goes under it (a list), found by the search with it */
function Row({ label, badge, hint, children, below }: { label: string; badge?: string; hint?: string; children: ComponentChildren; below?: ComponentChildren }) {
  const { query, whole } = useContext(Search);
  if (!whole && !norm(`${label} ${hint ?? ''}`).includes(query)) return null;
  return (
    <>
      <div class="set-row">
        <div class="set-label"><span>{label}{badge && <span class="set-badge">{badge}</span>}</span>{hint && <span class="faint">{hint}</span>}</div>
        <div class="set-control">{children}</div>
      </div>
      {below}
    </>
  );
}

const size = (k: number) => {
  const c = S.doc.peek()?.compositions[S.compId.peek()];
  return c ? `${Math.round(c.width * k)}×${Math.round(c.height * k)}` : `${Math.round(k * 100)} %`;
};

function Appearance() {
  const p = prefs.value;
  return (
    <Section title={t('settings.appearance')}>
      <Row label={t('settings.language')} hint={t('settings.automaticTheBrowserS')}>
        <Seg value={p.language} options={[['auto', t('common.automatic')], ...LOCALES]} onChange={(v) => setLanguage(v as Preferences['language'])} />
      </Row>
      <Row label={t('settings.theme')} hint={t('settings.systemFollowsTheComputer')}>
        <Seg value={p.theme} options={[['dark', t('settings.dark')], ['light', t('settings.lightGray')], ['system', t('settings.system')]]} onChange={(v) => setPrefs({ theme: v as Preferences['theme'] })} />
      </Row>
    </Section>
  );
}

function Preview() {
  const p = prefs.value, info = previewInfo.value, inEditor = S.ready.value;
  return (
    <Section title={t('common.preview')}>
      <p class="faint">{t('settings.settingsForThisComputer')}</p>
      <Row label={t('common.inMotion')} hint={t(MOTION[p.motion])}>
        <Seg value={p.motion} options={[['auto', t('common.automatic')], ['full', t('common.full')], ['half', t('common.half')], ['quarter', t('common.quarter')]]} onChange={(v) => setPrefs({ motion: v as Preferences['motion'] })} />
      </Row>
      <Row label={t('common.whenStill')} hint={t(STILL[p.still])}>
        <Seg value={p.still} options={[['display', t('common.displayedSize')], ['full', t('common.fullResolution')]]} onChange={(v) => setPrefs({ still: v as Preferences['still'] })} />
      </Row>
      <Row label={t('common.motionBlur')} hint={t(BLUR[p.blur])}>
        <Seg value={p.blur} options={[['document', t('common.document')], ['limited', t('settings.limited')], ['off', t('common.off')]]} onChange={(v) => setPrefs({ blur: v as Preferences['blur'] })} />
      </Row>
      <Row label={t('settings.playAtTheComposition')} hint={t('settings.likeTheExport24')}>
        <Toggle on={p.exactFrames} onChange={(v) => setPrefs({ exactFrames: v })} />
      </Row>
      {inEditor && (
        <div class="set-info">
          <Icon name="info" />
          <span>{p.motion === 'auto'
            ? t('settings.previewRenderStillWhen', { still: size(info.still), motion: size(info.motion) })
            : t('settings.previewRenderStillWhenStill', { still: size(info.still), motion: size(info.motion) })}</span>
        </div>
      )}
    </Section>
  );
}

/** a level in dB (or %), the same field everywhere in the section */
function Level({ value, min, max, step = 1, unit = 'dB', onChange }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return <div class="set-number"><NumberField value={value} min={min} max={max} step={step} unit={unit} onCommit={onChange} /></div>;
}

/** the sounds kept in the library shared by the projects: listened to, deleted */
function SoundLibrary() {
  const [list, setList] = useState<{ name: string; entry?: unknown }[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = () => api.sounds().then(setList).catch(() => setList([]));
  useEffect(() => { load(); return () => audio.current?.pause(); }, []);
  const play = (name: string) => {
    audio.current?.pause();
    if (playing === name) { setPlaying(null); return; }
    const a = new Audio(api.soundUrl(name));
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(name);
  };
  const remove = async (name: string) => {
    if (playing === name) { audio.current?.pause(); setPlaying(null); }
    await api.soundDelete(name).catch((e) => toast((e as Error).message, 'error'));
    setDoomed(null);
    load();
  };
  const sounds = (list ?? []).map((x) => ({ name: x.name, e: (x.entry ?? {}) as Partial<SoundEntry> }));
  return (
    <Row label={t('settings.soundLibrary')} hint={list === null ? t('common.searching') : list.length ? t('settings.soundLibraryN', { n: list.length }) : t('settings.soundLibraryEmpty')}
      below={sounds.length > 0 && (
        <ul class="set-list">
          {sounds.map(({ name, e }) => (
            <li key={name}>
              <button class="icon-btn sm" title={playing === name ? t('settings.stopListening') : t('settings.listen')} onClick={() => play(name)}><Icon name={playing === name ? 'stop' : 'play'} /></button>
              <span class="set-list-name">{e.title ?? name}</span>
              <span class="faint">{[e.kind, typeof e.duration === 'number' ? `${e.duration.toFixed(2)} s` : null].filter(Boolean).join(' · ')}</span>
              {doomed === name
                ? <><button class="btn sm" onClick={() => setDoomed(null)}>{t('common.cancel')}</button><button class="btn sm danger-solid" onClick={() => remove(name)}>{t('common.delete')}</button></>
                : <button class="icon-btn sm" title={t('common.delete')} onClick={() => setDoomed(name)}><Icon name="trash" /></button>}
            </li>
          ))}
        </ul>
      )}>
      <button class="btn sm" onClick={load}><Icon name="loop" />{t('settings.refresh')}</button>
    </Row>
  );
}

function Sound() {
  const p = prefs.value;
  return (
    <Section title={t('settings.sound')}>
      <Row label={t('settings.previewVolume')} hint={t('settings.previewVolumeHint')}>
        <Level value={Math.round(p.previewVolume * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setPrefs({ previewVolume: v / 100 })} />
      </Row>
      <Row label={t('settings.previewMuted')} hint={t('settings.previewMutedHint')}>
        <Toggle on={p.previewMuted} onChange={(v) => setPrefs({ previewMuted: v })} />
      </Row>
      <Row label={t('settings.effectsDb')} hint={t('settings.effectsDbHint')}>
        <Level value={p.effectsDb} min={-40} max={12} onChange={(v) => setPrefs({ effectsDb: v })} />
      </Row>
      <Row label={t('settings.musicDb')} hint={t('settings.musicDbHint')}>
        <Level value={p.musicDb} min={-40} max={12} onChange={(v) => setPrefs({ musicDb: v })} />
      </Row>
      <Row label={t('settings.duckDb')} hint={t('settings.duckDbHint')}>
        <Level value={p.duckDb} min={-40} max={-1} onChange={(v) => setPrefs({ duckDb: v })} />
      </Row>
      <Row label={t('settings.varySounds')} hint={t('settings.varySoundsHint')}>
        <Toggle on={p.varySounds} onChange={(v) => setPrefs({ varySounds: v })} />
      </Row>
      <Row label={t('settings.confirmPaid')} hint={t('settings.confirmPaidHint')}>
        <Toggle on={p.confirmPaid} onChange={(v) => setPrefs({ confirmPaid: v })} />
      </Row>
      <Row label={t('settings.voiceOver')} hint={t('settings.voiceOverHint')}>
        <div class="set-pair">
          <Select value={p.voiceProvider} options={[['auto', t('common.automatic')], ['elevenlabs', 'ElevenLabs'], ['openai', 'OpenAI'], ['gemini', 'Gemini']]} onChange={(v) => setPrefs({ voiceProvider: v as Preferences['voiceProvider'] })} />
          <div class="field"><input value={p.voice} placeholder={t('settings.voicePlaceholder')} onChange={(e) => setPrefs({ voice: (e.target as HTMLInputElement).value.trim() })} /></div>
        </div>
      </Row>
      <SoundLibrary />
    </Section>
  );
}

function Tours() {
  const st = toursState.value;
  return (
    <Section title={t('common.guidedTours')}>
      <Row label={t('settings.offerToursOnOpening')} hint={t('settings.theFirstTimeThe')}>
        <Toggle on={st.auto} onChange={setAutoTours} />
      </Row>
      <Row label={t('settings.replayAllTours')} hint={t('settings.nAlreadySeenIn', { n: Object.keys(st.seen).length })}>
        <button class="btn sm" disabled={!Object.keys(st.seen).length} onClick={resetSeen}><Icon name="undo" />{t('settings.replayAll')}</button>
      </Row>
    </Section>
  );
}

const NOTIFY_HINT: Record<ReturnType<typeof notificationState>, string> = {
  granted: m('settings.notifyHint'),
  default: m('settings.notifyHint'),
  denied: m('settings.notifyBlocked'),
  unsupported: m('settings.notifyBlocked'),
};

function Model() {
  return (
    <Section title={t('settings.model')}>
      <Row label={t('settings.model')} hint={t('settings.claudeOpusForThe')}>
        <ModelPicker wide />
      </Row>
      <Row label={t('settings.effort')} hint={t('settings.effortHint')}>
        <EffortPicker />
      </Row>
    </Section>
  );
}

// ── the providers: a key sent once to the server, which keeps it ──
interface ProviderInfo { id: KeyedProvider; name: string; hint: string; keys: string }
const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', hint: m('settings.providerAnthropic'), keys: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'OpenAI', hint: m('settings.providerOpenai'), keys: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Google Gemini', hint: m('settings.providerGemini'), keys: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', hint: m('settings.providerOpenrouter'), keys: 'https://openrouter.ai/keys' },
  { id: 'zai', name: 'Z.AI (GLM)', hint: m('settings.providerZai'), keys: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'elevenlabs', name: 'ElevenLabs', hint: m('settings.providerElevenlabs'), keys: 'https://elevenlabs.io/app/settings/api-keys' },
];
type CustomProvider = KeyStatus['custom'][number];

/** a custom provider's id, from its name, unlike the ones taken; it stays when the name changes (the models chosen keep it) */
function customId(label: string, taken: string[]): string {
  const base = norm(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'custom';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

interface FormField { name: string; label: string; secret?: boolean; optional?: boolean; initial?: string; placeholder?: string }

/** what is typed under a provider's row: sent on Save, the server's refusal shown in place */
function ProviderForm({ fields, link, onSave, onClose }: { fields: FormField[]; link?: string; onSave: (v: Record<string, string>) => Promise<void>; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = fields.every((f) => f.optional || values[f.name].trim());
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
      onClose();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <form class="set-confirm set-form" onSubmit={submit}>
      {fields.map((f, i) => (
        <label key={f.name} class="set-form-field">
          <span>{f.label}</span>
          <div class="field"><input type={f.secret ? 'password' : 'text'} autoComplete="off" spellcheck={false} autoFocus={i === 0} value={values[f.name]} placeholder={f.placeholder}
            onInput={(e) => setValues({ ...values, [f.name]: (e.target as HTMLInputElement).value })} /></div>
        </label>
      ))}
      {error && <span class="set-form-error">{error}</span>}
      <div class="set-confirm-actions">
        {link && <a class="btn ghost sm set-form-link" href={link} target="_blank" rel="noopener noreferrer">{t('settings.getAKey')}</a>}
        <button type="button" class="btn sm" onClick={onClose}>{t('common.cancel')}</button>
        <button type="submit" class="btn sm primary" disabled={!ready || busy}>{busy && <Icon name="spinner" />}{t('settings.save')}</button>
      </div>
    </form>
  );
}

/** a provider of the list: connected (`action` changes it, `remove` disconnects it), or offered with Connect; its form or question under it */
function ProviderRow({ name, badge, hint, action, remove, form }: { name: string; badge?: string; hint?: string; action?: string; remove?: () => Promise<void>; form: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState<'form' | 'remove' | null>(null);
  const close = () => setOpen(null);
  const toggleForm = () => setOpen(open === 'form' ? null : 'form');
  const below = open === 'form' ? form(close) : open === 'remove' && remove && (
    <div class="set-confirm" role="alertdialog" aria-label={t('settings.disconnect')}>
      <span>{t('settings.disconnectConfirm', { name })}</span>
      <div class="set-confirm-actions">
        <button class="btn sm" onClick={close}>{t('common.cancel')}</button>
        <button class="btn sm danger-solid" onClick={() => remove().then(close, (e) => toast((e as Error).message, 'error'))}>{t('settings.disconnect')}</button>
      </div>
    </div>
  );
  return (
    <Row label={name} badge={badge} hint={hint} below={below}>
      {action
        ? <div class="set-actions">
            <button class="btn ghost sm" onClick={toggleForm}>{action}</button>
            {remove && <button class="btn ghost sm" onClick={() => setOpen('remove')}>{t('settings.disconnect')}</button>}
          </div>
        : <button class="btn sm" onClick={toggleForm}><Icon name="plus" />{t('settings.connect')}</button>}
    </Row>
  );
}

function Providers() {
  useEffect(() => { ensureStatus(); }, []);
  const keys = aiStatus.value.keys;
  const source = (p: KeyedProvider) => keys?.providers[p] ?? null;
  const connected = PROVIDERS.filter((p) => source(p.id)), offered = PROVIDERS.filter((p) => !source(p.id));
  const custom = keys?.custom ?? [];
  const keyForm = (p: ProviderInfo) => (close: () => void) => (
    <ProviderForm link={p.keys} onClose={close} fields={[{ name: 'key', label: t('settings.apiKey'), secret: true, placeholder: t('settings.pasteTheKey') }]}
      onSave={async (v) => { await connectProvider(p.id, v.key); toast(t('settings.providerConnected', { name: p.name })); }} />
  );
  const customForm = (c?: CustomProvider) => (close: () => void) => (
    <ProviderForm onClose={close} fields={[
      { name: 'label', label: t('settings.providerName'), initial: c?.label, placeholder: 'DeepSeek' },
      { name: 'base', label: t('settings.baseUrl'), initial: c?.base, placeholder: 'https://api.deepseek.com/v1' },
      { name: 'key', label: t('settings.apiKey'), secret: true, optional: true, placeholder: c?.key ? t('settings.keepTheKey') : t('settings.keyOptional') },
    ]} onSave={async (v) => {
      await saveCustomProvider(c?.id ?? customId(v.label, custom.map((x) => x.id)), { label: v.label, base: v.base, key: v.key || undefined });
      if (!c) toast(t('settings.providerConnected', { name: v.label }));
    }} />
  );
  return (
    <>
      <Section title={t('settings.connectedProviders')}>
        <p class="faint">{t('settings.providersIntro')}</p>
        {keys === null
          ? <span class="faint">{t('common.searching')}</span>
          : !connected.length && !custom.length && <span class="faint">{t('settings.noProviderConnected')}</span>}
        {connected.map((p) => {
          const own = source(p.id) === 'settings';
          return (
            <ProviderRow key={p.id} name={p.name} badge={own ? t('settings.badgeApiKey') : t('settings.badgeServerSecret')} hint={own ? undefined : t('settings.serverSecretHint')}
              action={t('settings.changeKey')} form={keyForm(p)} remove={own ? async () => { await disconnectProvider(p.id); toast(t('settings.providerDisconnected', { name: p.name })); } : undefined} />
          );
        })}
        {custom.map((c) => (
          <ProviderRow key={c.id} name={c.label} badge={t('settings.badgeCustom')} hint={c.base} action={t('settings.editProvider')} form={customForm(c)}
            remove={async () => { await removeCustomProvider(c.id); toast(t('settings.providerDisconnected', { name: c.label })); }} />
        ))}
      </Section>
      <Section title={t('settings.addAProvider')}>
        {offered.map((p) => <ProviderRow key={p.id} name={p.name} hint={t(p.hint)} form={keyForm(p)} />)}
        <ProviderRow name={t('settings.customProvider')} badge={t('settings.badgeCustom')} hint={t('settings.providerCustom')} form={customForm()} />
      </Section>
    </>
  );
}

function Behavior() {
  const a = aiSettings.value;
  // the automatic application waits for the user's confirmation below its row
  const [confirming, setConfirming] = useState(false);
  const [permission, setPermission] = useState(notificationState);
  const notifyOn = (on: boolean) => {
    setAiSettings({ notify: on });
    // asked from the click: the browser shows its question only then
    if (on) allowNotifications().then(setPermission);
  };
  return (
    <Section title={t('settings.behavior')}>
      <Row label={t('settings.notifyDone')} hint={t(NOTIFY_HINT[permission])}>
        <Toggle on={a.notify} onChange={notifyOn} />
      </Row>
      <Row label={t('settings.autoApply')} hint={t('settings.autoApplyHint')}>
        <Toggle on={a.autoApply || confirming} onChange={(on) => (on ? setConfirming(true) : (setConfirming(false), setAiSettings({ autoApply: false })))} />
      </Row>
      {confirming && (
        <div class="set-confirm" role="alertdialog" aria-label={t('settings.autoApply')}>
          <span>{t('settings.autoApplyConfirm')}</span>
          <div class="set-confirm-actions">
            <button class="btn sm" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
            <button class="btn sm primary" onClick={() => { setAiSettings({ autoApply: true }); setConfirming(false); }}>{t('common.enable')}</button>
          </div>
        </div>
      )}
    </Section>
  );
}

function Connection() {
  const a = aiSettings.value;
  const [token, setToken] = useState(a.token);
  useEffect(() => { ensureStatus(); }, []);
  const labels = statusLabels(aiStatus.value);
  return (
    <Section title={t('settings.connection')}>
      <Row label={t('common.accessToClaude')} hint={t('settings.automaticTheLocalCompanion')}>
        <Seg value={a.prefer} options={[['auto', t('common.automatic')], ['companion', t('common.companion')], ['server', t('common.server')]]} onChange={(v) => setAiSettings({ prefer: v as typeof a.prefer })} />
      </Row>
      <Row label={t('settings.companionToken')} hint={t('settings.localCompanionCompanionServer', labels)}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div class="field" style={{ width: 200 }}><input type="password" value={token} placeholder={t('common.pairingToken')} onInput={(e) => setToken((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ token })} /></div>
          <button class="btn sm" onClick={() => { setAiSettings({ token }); refreshStatus(); }}><Icon name="loop" />{t('common.check')}</button>
        </div>
      </Row>
    </Section>
  );
}

// ── the menu ─────────────────────────────────────────────────
interface Pane { id: SettingsSection; icon: string; title: () => string; body: FunctionComponent }
const GROUPS: { title: () => string; panes: Pane[] }[] = [
  {
    title: () => t('settings.groupEditor'),
    panes: [
      { id: 'appearance', icon: 'palette', title: () => t('settings.appearance'), body: Appearance },
      { id: 'preview', icon: 'eye', title: () => t('common.preview'), body: Preview },
      { id: 'sound', icon: 'audio', title: () => t('settings.sound'), body: Sound },
      { id: 'tours', icon: 'help', title: () => t('common.guidedTours'), body: Tours },
    ],
  },
  {
    title: () => t('common.assistant'),
    panes: [
      { id: 'model', icon: 'wand', title: () => t('settings.model'), body: Model },
      { id: 'providers', icon: 'key', title: () => t('settings.providers'), body: Providers },
      { id: 'behavior', icon: 'chat', title: () => t('settings.behavior'), body: Behavior },
      { id: 'connection', icon: 'link', title: () => t('settings.connection'), body: Connection },
    ],
  },
];
const PANES = GROUPS.flatMap((g) => g.panes);

export function SettingsDialog() {
  const [query, setQuery] = useState('');
  if (!settingsOpen.value) return null;
  const close = () => { setQuery(''); settingsOpen.value = false; };
  const custom = JSON.stringify({ ...prefs.value, language: 'auto' }) !== JSON.stringify(DEFAULT_PREFERENCES);
  const q = norm(query.trim());
  const current = PANES.find((p) => p.id === settingsSection.value) ?? PANES[0];
  const show = (id: SettingsSection) => { setQuery(''); settingsSection.value = id; };
  return (
    <Modal title={t('common.settings')} onClose={close} wide>
      <div class="modal-body settings">
        <nav class="set-nav">
          <div class="field set-search"><Icon name="search" /><input type="search" value={query} placeholder={t('settings.searchSettings')} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} /></div>
          {GROUPS.map((g) => (
            <div key={g.title()} class="set-group">
              <div class="set-group-title">{g.title()}</div>
              {g.panes.map((p) => (
                <button key={p.id} class={`set-nav-item${!q && p.id === current.id ? ' on' : ''}`} aria-current={!q && p.id === current.id ? 'page' : undefined} onClick={() => show(p.id)}>
                  <Icon name={p.icon} /><span>{p.title()}</span>
                </button>
              ))}
            </div>
          ))}
          <span class="grow" />
          <button class="btn ghost sm" disabled={!custom} onClick={resetPrefs} title={t('settings.defaultSettings')}><Icon name="undo" /><span>{t('settings.defaultSettings')}</span></button>
        </nav>
        <Search.Provider value={{ query: q, whole: !q }}>
          {q
            // every section, each showing only its matching settings; the empty ones hide (CSS)
            ? <div class="set-pane set-results" data-empty={t('settings.noMatch', { query: query.trim() })}>{PANES.map((p) => <p.body key={p.id} />)}</div>
            : <div class="set-pane" key={current.id}><current.body /></div>}
        </Search.Provider>
      </div>
    </Modal>
  );
}
