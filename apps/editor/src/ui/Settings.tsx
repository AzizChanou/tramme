// Settings of this machine: how much the preview may cost, and how the
// assistant reaches Claude. Opened from the top bar, the home screen or Ctrl+,.
// A menu of sections on the left (the editor's, the assistant's), the one
// chosen on the right; a search shows the settings matching it, whatever
// their section.

import { createContext, type ComponentChildren, type FunctionComponent } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { EffortPicker, ModelPicker } from './ModelPicker.tsx';
import { aiSettings, aiStatus, ensureStatus, refreshStatus, setAiSettings, statusLabels } from '../ai/index.ts';
import { allowNotifications, notificationState } from '../notify.ts';
import { previewInfo } from '../preview.ts';
import { DEFAULT_PREFERENCES, prefs, resetPrefs, setLanguage, setPrefs, settingsOpen, settingsSection, type Preferences, type SettingsSection } from '../settings.ts';
import { S } from '../state.ts';
import { Modal, Select, Seg, Toggle } from './controls.tsx';
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

function Row({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  const { query, whole } = useContext(Search);
  if (!whole && !norm(`${label} ${hint ?? ''}`).includes(query)) return null;
  return (
    <div class="set-row">
      <div class="set-label"><span>{label}</span>{hint && <span class="faint">{hint}</span>}</div>
      <div class="set-control">{children}</div>
    </div>
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
      { id: 'tours', icon: 'help', title: () => t('common.guidedTours'), body: Tours },
    ],
  },
  {
    title: () => t('common.assistant'),
    panes: [
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
