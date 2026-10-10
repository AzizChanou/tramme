// Settings of this machine: how much the preview may cost, how the
// assistant reaches Claude, the providers connected (their keys kept by the
// server, by the desktop app in the system keychain, or in personal mode by
// the key vault, whose page shows here).
// Opened from the top bar, the home screen or Ctrl+,.
// A menu of sections on the left (the editor's, the assistant's), the one
// chosen on the right; a search shows the settings matching it, whatever
// their section.

import type { FunctionComponent } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { SoundEntry } from '@tramme/core';
import { ELEVEN_VOICE_MODELS } from '@tramme/api';
import { api, type Voice } from '../api.ts';
import { EffortPicker, ModelPicker } from './ModelPicker.tsx';
import { aiSettings, aiStatus, connectProvider, disconnectProvider, ensureStatus, providersChanged, refreshStatus, removeCustomProvider, saveCustomProvider, serverName, setAiSettings, statusLabels } from '../ai/index.ts';
import { allowNotifications, notificationState } from '../notify.ts';
import { previewInfo } from '../preview.ts';
import { DEFAULT_PREFERENCES, DISPLAYS, prefs, resetPrefs, setLanguage, setPrefs, settingsOpen, settingsSection, THEMES, type Preferences, type SettingsSection, type ThemeInfo } from '../settings.ts';
import { S, toast } from '../state.ts';
import { Modal, NumberField, Select, Seg, Toggle } from './controls.tsx';
import { Icon } from './icons.tsx';
import { resetSeen, setAutoTours, toursState } from '../tours/index.ts';
import { LOCALES, locale, m, t } from '../i18n/index.ts';
import { vaultOrigin } from '../mode.ts';
import { tauri } from '../tauri.ts';
import { fromVault } from '../vault/link.ts';
import { Providers as ProviderList, type ProviderActions } from './Providers.tsx';
import { Confirm, norm, Row, Search, Section } from './SettingsRows.tsx';

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

const size = (k: number) => {
  const c = S.doc.peek()?.compositions[S.compId.peek()];
  return c ? `${Math.round(c.width * k)}×${Math.round(c.height * k)}` : `${Math.round(k * 100)} %`;
};

/** the theme picker: a chip per theme, its three colours beside its name; system's first dot splits dark and light */
const THEME_NAME: Record<string, string> = {
  system: m('settings.themes.system'),
  studio: m('settings.themes.studio'),
  obsidian: m('settings.themes.obsidian'),
  carbon: m('settings.themes.carbon'),
  dusk: m('settings.themes.dusk'),
  paper: m('settings.themes.paper'),
};

const DISPLAY_NAME: Record<string, string> = {
  editor: m('app.displayEditor'),
  cinema: m('app.displayCinema'),
  conversation: m('app.displayConversation'),
};

function ThemeChips({ value, onPick }: { value: Preferences['theme']; onPick: (id: Preferences['theme']) => void }) {
  return (
    <div class="theme-chips">
      {THEMES.map((th: ThemeInfo) => (
        <button key={th.id} class={`theme-chip${value === th.id ? ' on' : ''}`} onClick={() => onPick(th.id)}>
          <span class="sw">
            <i style={th.id === 'system' ? { background: 'linear-gradient(90deg, #0b0f12 50%, #d8dde0 50%)' } : { background: th.bg }} />
            <i style={{ background: th.panel }} />
            <i style={{ background: th.accent }} />
          </span>
          {t(THEME_NAME[th.id] ?? th.id)}
        </button>
      ))}
    </div>
  );
}

function Appearance() {
  const p = prefs.value;
  return (
    <Section title={t('settings.appearance')}>
      <Row label={t('settings.language')} hint={t('settings.automaticTheBrowserS')}>
        <Seg value={p.language} options={[['auto', t('common.automatic')], ...LOCALES]} onChange={(v) => setLanguage(v as Preferences['language'])} />
      </Row>
      <Row label={t('settings.theme')} hint={t('settings.themeHint')} stack>
        <ThemeChips value={p.theme} onPick={(id) => setPrefs({ theme: id })} />
      </Row>
      <Row label={t('settings.display')} hint={t('settings.displayHint')}>
        <Seg value={p.display} options={DISPLAYS.map((id) => [id, t(DISPLAY_NAME[id])] as [Preferences['display'], string])} onChange={(v) => { setPrefs({ display: v as Preferences['display'] }); S.summon.value = 'none'; }} />
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

/** one sound listened to at a time: play(key, url) starts it, or stops it when it is the one playing */
function useListen() {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const stop = () => { audio.current?.pause(); setPlaying(null); };
  const play = (key: string, url: string) => {
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(key);
  };
  return { playing, play, stop };
}

/** the sounds kept in the library shared by the projects: listened to, deleted */
function SoundLibrary() {
  const [list, setList] = useState<{ name: string; entry?: unknown }[] | null>(null);
  const [doomed, setDoomed] = useState<string | null>(null);
  const { playing, play: listen, stop } = useListen();
  const load = () => api.sounds().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const play = (name: string) => listen(name, api.soundUrl(name));
  const remove = async (name: string) => {
    if (playing === name) stop();
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

/** the voices of the provider chosen, searched by words, language and accent, listened to, one taken for the voice-overs */
function VoicePicker() {
  const p = prefs.value;
  const provider = p.voiceProvider === 'auto' ? undefined : p.voiceProvider;
  const [q, setQ] = useState({ search: '', language: '', accent: '' });
  const [list, setList] = useState<Voice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { playing, play } = useListen();
  const find = () => {
    setBusy(true);
    api.voices({ provider, ...q }).then(setList, (e) => { toast((e as Error).message, 'error'); setList([]); }).finally(() => setBusy(false));
  };
  const field = (k: keyof typeof q, placeholder: string) => (
    <div class="field"><input value={q[k]} placeholder={placeholder} onInput={(e) => setQ({ ...q, [k]: (e.target as HTMLInputElement).value })} onKeyDown={(e) => { if (e.key === 'Enter') find(); }} /></div>
  );
  return (
    <Row label={t('settings.voicePicker')} hint={t('settings.voicePickerHint')} stack
      below={list !== null && (
        <ul class="set-list">
          {!list.length && <li class="faint">{t('sound.noVoice')}</li>}
          {list.map((v) => (
            <li key={v.id} class={p.voice === v.id ? 'on' : ''}>
              <button class="icon-btn sm" disabled={!v.preview} title={playing === v.id ? t('settings.stopListening') : t('settings.listen')} onClick={() => v.preview && play(v.id, v.preview)}><Icon name={playing === v.id ? 'stop' : 'play'} /></button>
              <span class="set-list-name" title={v.description}>{v.name}</span>
              <span class="faint">{[v.language, v.accent, v.gender, v.source === 'library' ? t('settings.voiceLibrary') : null].filter(Boolean).join(' · ')}</span>
              {p.voice === v.id
                ? <span class="set-badge">{t('settings.voiceChosen')}</span>
                : <button class="btn sm" onClick={() => setPrefs({ voice: v.id, voiceProvider: v.provider as Preferences['voiceProvider'] })}>{t('settings.voiceUse')}</button>}
            </li>
          ))}
        </ul>
      )}>
      <div class="set-pair">
        {field('search', t('settings.voiceSearch'))}
        {field('language', t('settings.voiceLanguage'))}
        {field('accent', t('settings.voiceAccent'))}
        <button class="btn sm" disabled={busy} onClick={find}><Icon name={busy ? 'spinner' : 'search'} />{t('settings.voiceFind')}</button>
      </div>
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
      <Row label={t('settings.paidPerTurn')} hint={t('settings.paidPerTurnHint')}>
        <Level value={p.paidPerTurn} min={0} max={100} unit="" onChange={(v) => setPrefs({ paidPerTurn: Math.round(v) })} />
      </Row>
      <Row label={t('settings.voiceOver')} hint={t('settings.voiceOverHint')}>
        <div class="set-pair">
          <Select value={p.voiceProvider} options={[['auto', t('common.automatic')], ['elevenlabs', 'ElevenLabs'], ['openai', 'OpenAI'], ['gemini', 'Gemini']]} onChange={(v) => setPrefs({ voiceProvider: v as Preferences['voiceProvider'] })} />
          <div class="field"><input value={p.voice} placeholder={t('settings.voicePlaceholder')} onChange={(e) => setPrefs({ voice: (e.target as HTMLInputElement).value.trim() })} /></div>
        </div>
      </Row>
      {(p.voiceProvider === 'auto' || p.voiceProvider === 'elevenlabs') && (
        <Row label={t('settings.voiceModel')} hint={t('settings.voiceModelHint')}>
          <Select value={p.voiceModel} options={Object.entries(ELEVEN_VOICE_MODELS).map(([id, name], i) => [i ? id : '', i ? name : t('settings.voiceModelDefault', { name })])} onChange={(v) => setPrefs({ voiceModel: v })} />
        </Row>
      )}
      <VoicePicker />
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

// ── the providers: a key sent once to the server, which keeps it; in personal mode, typed into the vault's page ──
const SERVER_KEYS: ProviderActions = {
  connect: connectProvider, disconnect: disconnectProvider, saveCustom: saveCustomProvider, removeCustom: removeCustomProvider,
  notify: (text, kind) => toast(text, kind),
};

/** the key vault's own page: the keys are typed there, out of the editor's reach; it tells what changed */
function VaultKeys() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const { query, whole } = useContext(Search);
  useEffect(() => {
    const heard = (e: MessageEvent) => {
      const msg = fromVault(e, frame.current?.contentWindow);
      if (msg?.type === 'tramme-vault-height') setHeight(Math.min(4000, Math.max(80, msg.height)));
      else if (msg?.type === 'tramme-vault-changed') providersChanged();
      else if (msg?.type === 'tramme-vault-toast') toast(String(msg.text).slice(0, 300), msg.kind === 'error' ? 'error' : 'info');
    };
    addEventListener('message', heard);
    return () => removeEventListener('message', heard);
  }, []);
  // the search cannot look into the vault's page: shown when the search names it
  if (!whole && ![t('settings.providers'), t('settings.apiKey')].some((w) => norm(w).includes(query))) return null;
  const theme = document.documentElement.dataset.theme ?? 'studio';
  // the settings' own breakpoint (styles.css): the frame cannot see the window's width
  const layout = matchMedia('(max-width: 760px)').matches ? 'compact' : 'wide';
  return <iframe ref={frame} class="vault-frame" title={t('settings.providers')} src={`${vaultOrigin}/settings?lang=${locale}&theme=${theme}&layout=${layout}`} style={{ height }} />;
}

function Providers() {
  useEffect(() => { if (!vaultOrigin) ensureStatus(); }, []);
  if (vaultOrigin) return <VaultKeys />;
  return <ProviderList keys={aiStatus.value.keys} actions={SERVER_KEYS} intro={tauri ? t('settings.providersIntroDesktop') : t('settings.providersIntro')} />;
}

function Behavior() {
  const a = aiSettings.value;
  // a mode that changes the document without asking waits for the user's confirmation below its row
  const [confirming, setConfirming] = useState<'turn' | 'all' | null>(null);
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
        <Seg value={confirming ?? a.apply}
          options={[['off', t('settings.autoApplyOff')], ['turn', t('settings.autoApplyTurn')], ['all', t('settings.autoApplyAll')]]}
          onChange={(v) => (v === 'off' ? (setConfirming(null), setAiSettings({ apply: 'off' })) : setConfirming(v as 'turn' | 'all'))} />
      </Row>
      {confirming && (
        <Confirm label={t('settings.autoApply')} question={t('settings.autoApplyConfirm')} action={t('common.enable')}
          onCancel={() => setConfirming(null)} onConfirm={() => { setAiSettings({ apply: confirming }); setConfirming(null); }} />
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
        <Seg value={a.prefer} options={[['auto', t('common.automatic')], ['companion', t('common.companion')], ['server', serverName()]]} onChange={(v) => setAiSettings({ prefer: v as typeof a.prefer })} />
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

// ── the desktop app's storage: where the projects live ───────

function Storage() {
  const [home, setHome] = useState('');
  useEffect(() => { tauri!.core.invoke('desktop_state').then((s) => setHome((s as { home: string }).home)); }, []);
  const pick = async () => {
    try {
      const next = await tauri!.core.invoke('desktop_pick_home') as string | null;
      if (!next) return;
      const state = await tauri!.core.invoke('desktop_set_home', { home: next }) as { home: string };
      setHome(state.home);
      // the lists answer from the new folder from now on: back to the projects
      if (location.pathname !== '/') location.assign('/');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Section title={t('settings.storage')}>
      <Row label={t('settings.projectsFolder')} hint={t('settings.projectsFolderHint')}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <span class="faint mono" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={home}>{home}</span>
          <button class="btn sm" onClick={pick}><Icon name="folder" />{t('settings.changeFolder')}</button>
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
      // the native app only: the projects live in a folder of this computer
      ...(tauri ? [{ id: 'storage' as SettingsSection, icon: 'folder', title: () => t('settings.storage'), body: Storage }] : []),
    ],
  },
  {
    title: () => t('common.assistant'),
    panes: [
      // an AI to talk with first: the model and the companion come after
      { id: 'providers', icon: 'key', title: () => t('settings.providers'), body: Providers },
      { id: 'model', icon: 'wand', title: () => t('settings.model'), body: Model },
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
