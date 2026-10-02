// Settings of this machine: how much the preview may cost, and how the
// assistant reaches Claude. Opened from the top bar, the home screen or Ctrl+,.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { EffortPicker, ModelPicker } from './ModelPicker.tsx';
import { aiSettings, aiStatus, ensureStatus, refreshStatus, setAiSettings, statusLabels } from '../ai/index.ts';
import { previewInfo } from '../preview.ts';
import { DEFAULT_PREFERENCES, prefs, resetPrefs, setLanguage, setPrefs, settingsOpen, type Preferences } from '../settings.ts';
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

function Row({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
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
    <section class="set-section">
      <h3>{t('settings.appearance')}</h3>
      <Row label={t('settings.language')} hint={t('settings.automaticTheBrowserS')}>
        <Seg value={p.language} options={[['auto', t('common.automatic')], ...LOCALES]} onChange={(v) => setLanguage(v as Preferences['language'])} />
      </Row>
      <Row label={t('settings.theme')} hint={t('settings.systemFollowsTheComputer')}>
        <Seg value={p.theme} options={[['dark', t('settings.dark')], ['light', t('settings.lightGray')], ['system', t('settings.system')]]} onChange={(v) => setPrefs({ theme: v as Preferences['theme'] })} />
      </Row>
    </section>
  );
}

function Preview() {
  const p = prefs.value, info = previewInfo.value, inEditor = S.ready.value;
  return (
    <section class="set-section">
      <h3>{t('common.preview')}</h3>
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
    </section>
  );
}

function Tours() {
  const st = toursState.value;
  return (
    <section class="set-section">
      <h3>{t('common.guidedTours')}</h3>
      <Row label={t('settings.offerToursOnOpening')} hint={t('settings.theFirstTimeThe')}>
        <Toggle on={st.auto} onChange={setAutoTours} />
      </Row>
      <Row label={t('settings.replayAllTours')} hint={t('settings.nAlreadySeenIn', { n: Object.keys(st.seen).length })}>
        <button class="btn sm" disabled={!Object.keys(st.seen).length} onClick={resetSeen}><Icon name="undo" />{t('settings.replayAll')}</button>
      </Row>
    </section>
  );
}

function Assistant() {
  const a = aiSettings.value, st = aiStatus.value;
  const [token, setToken] = useState(a.token);
  useEffect(() => { ensureStatus(); }, []);
  const labels = statusLabels(st);
  return (
    <section class="set-section">
      <h3>{t('common.assistant')}</h3>
      <Row label={t('settings.model')} hint={t('settings.claudeOpusForThe')}>
        <ModelPicker wide />
      </Row>
      <Row label={t('settings.effort')} hint={t('settings.effortHint')}>
        <EffortPicker />
      </Row>
      <Row label={t('common.accessToClaude')} hint={t('settings.automaticTheLocalCompanion')}>
        <Seg value={a.prefer} options={[['auto', t('common.automatic')], ['companion', t('common.companion')], ['server', t('common.server')]]} onChange={(v) => setAiSettings({ prefer: v as typeof a.prefer })} />
      </Row>
      <Row label={t('settings.companionToken')} hint={t('settings.localCompanionCompanionServer', labels)}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div class="field" style={{ width: 200 }}><input type="password" value={token} placeholder={t('common.pairingToken')} onInput={(e) => setToken((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ token })} /></div>
          <button class="btn sm" onClick={() => { setAiSettings({ token }); refreshStatus(); }}><Icon name="loop" />{t('common.check')}</button>
        </div>
      </Row>
    </section>
  );
}

export function SettingsDialog() {
  if (!settingsOpen.value) return null;
  const close = () => { settingsOpen.value = false; };
  const custom = JSON.stringify({ ...prefs.value, language: 'auto' }) !== JSON.stringify(DEFAULT_PREFERENCES);
  return (
    <Modal title={t('common.settings')} onClose={close} wide>
      <div class="modal-body settings">
        <Appearance />
        <Preview />
        <Tours />
        <Assistant />
        <div class="modal-foot">
          <button class="btn ghost" disabled={!custom} onClick={resetPrefs}><Icon name="undo" />{t('settings.defaultSettings')}</button>
          <span class="grow" />
          <button class="btn primary" onClick={close}>{t('common.close')}</button>
        </div>
      </div>
    </Modal>
  );
}
