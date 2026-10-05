// Layout: top bar; layers | viewport over transport and timeline | inspector over assistant.
// Under 760 px the panels become tabs below the viewport.

import { useEffect } from 'preact/hooks';
import { S, undo, redo, frameStep, setTime, comp, saveNow, toast, select } from '../state.ts';
import { Assistant } from './Assistant.tsx';
import { MenuHost, Modal, useSize } from './controls.tsx';
import { answer, question } from '../confirm.ts';
import { Icon } from './icons.tsx';
import { Inspector } from './Inspector.tsx';
import { deleteSelection, duplicateSelection, LeftPanel } from './LeftPanel.tsx';
import { Bottom, deleteKeys, Transport } from './Timeline.tsx';
import { TopBar } from './TopBar.tsx';
import { uploads } from '../files.ts';
import { transcriptions } from '../speech.ts';
import { SettingsDialog } from './Settings.tsx';
import { prefs, settingsOpen } from '../settings.ts';
import { Viewport } from './Viewport.tsx';
import { t } from '../i18n/index.ts';

function useShortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().catch((x) => toast(x.message, 'error')); return; }
      if (mod && e.key === ',') { e.preventDefault(); settingsOpen.value = !settingsOpen.value; return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (e.code === 'Space') { e.preventDefault(); S.playing.value = !S.playing.value; return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? comp.peek().fps : 1);
        S.playing.value = false; frameStep(n); return;
      }
      if (e.key === 'Home') { setTime(0); return; }
      if (e.key === 'End') { setTime(comp.peek().duration); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (!deleteKeys()) deleteSelection(); return; }
      if (e.key === 'Escape') { select([]); S.keys.value = []; S.assistantFull.value = false; }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
}

export function Toasts() {
  return (
    <div class="toasts">
      {transcriptions.value.map((j) => (
        <div key={`t${j.id}`} class="toast upload">
          <span>{t('common.transcriptOfName', { name: j.name })} · {t(j.stage)}{j.total > 1 ? ` · ${j.done} / ${j.total}` : ''}</span>
          <div class="progress"><i style={{ width: `${(100 * j.done) / Math.max(1, j.total)}%` }} /></div>
        </div>
      ))}
      {uploads.value.map((u) => (
        <div key={`u${u.id}`} class="toast upload">
          <span>{t('app.uploadingName', { name: u.name })} · {Math.round((100 * u.sent) / Math.max(1, u.total))} %</span>
          <div class="progress"><i style={{ width: `${(100 * u.sent) / Math.max(1, u.total)}%` }} /></div>
        </div>
      ))}
      {S.toasts.value.map((x) => <div key={x.id} class={`toast ${x.kind ?? ''}`}>{x.text}</div>)}
    </div>
  );
}

/** a question the editor waits an answer for (a sound that costs money) */
function QuestionDialog() {
  const q = question.value;
  if (!q) return null;
  return (
    <Modal title={q.title} onClose={() => answer(false)}>
      <div class="modal-body">
        <p>{q.text}</p>
        <div class="modal-foot">
          <button class="btn ghost" onClick={() => answer(false)}>{t('common.cancel')}</button>
          <button class="btn primary" onClick={() => answer(true)}>{q.yes}</button>
        </div>
      </div>
    </Modal>
  );
}

const TABS: [typeof S.mobileTab.value, string, string][] = [
  ['viewport', t('common.image'), 'image'], ['layers', t('common.layers'), 'layers'], ['timeline', t('common.timeline'), 'timeline'], ['inspector', t('app.properties'), 'sliders'], ['ai', t('common.assistant'), 'chat'],
];

export function App() {
  useShortcuts();
  const [leftW, leftHandle] = useSize('left', 248, 180, 440);
  const [rightW, rightHandle] = useSize('right', 320, 260, 520);
  const [bottomH, bottomHandle] = useSize('bottom', 300, 140, 640);
  const [aiH, aiHandle] = useSize('ai', 340, 160, 900);
  return (
    <div class="app" data-tab={S.mobileTab.value} data-summon={S.summon.value} data-chat={S.chatHidden.value ? 'hidden' : 'shown'}>
      <TopBar />
      <div class="workspace" style={{ gridTemplateColumns: `${leftW}px 1px minmax(0, 1fr) 1px ${rightW}px` }}>
        <aside class="col left" data-tour="left-panel"><LeftPanel /></aside>
        <div class="resizer v" {...leftHandle('x', 1)} />
        <main class="center">
          <Viewport />
          <div class="resizer h" {...bottomHandle('y', -1)} />
          <section class="bottom" style={{ height: bottomH }}>
            <Transport />
            <div class="timeline-wrap" style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}><Bottom /></div>
          </section>
        </main>
        <div class="resizer v" {...rightHandle('x', -1)} />
        <aside class="col right">
          <div class="inspector-wrap panel-body" data-tour="inspector" style={{ flex: 1 }}><Inspector /></div>
          <div class="resizer h" {...aiHandle('y', -1)} />
          <Assistant style={{ height: aiH, flex: 'none' }} />
        </aside>
      </div>
      {prefs.value.display !== 'editor' && (
        <nav class="summon">
          {prefs.value.display === 'cinema' && (
            <button class={`edge at-left${S.summon.value === 'left' ? ' on' : ''}`} title={t('common.layers')} onClick={() => { S.summon.value = S.summon.value === 'left' ? 'none' : 'left'; }}><Icon name="layers" /></button>
          )}
          {prefs.value.display === 'conversation' && (
            <button class={`edge at-left${S.chatHidden.value ? '' : ' on'}`} title={t('common.assistant')} onClick={() => { S.chatHidden.value = !S.chatHidden.value; }}><Icon name="chat" /></button>
          )}
          <button class={`edge at-bottom${S.summon.value === 'bottom' ? ' on' : ''}`} title={t('common.timeline')} onClick={() => { S.summon.value = S.summon.value === 'bottom' ? 'none' : 'bottom'; }}><Icon name="timeline" /></button>
          <button class={`edge at-right${S.summon.value === 'right' ? ' on' : ''}`} title={prefs.value.display === 'conversation' ? t('common.layers') : t('app.properties')} onClick={() => { S.summon.value = S.summon.value === 'right' ? 'none' : 'right'; }}><Icon name={prefs.value.display === 'conversation' ? 'layers' : 'sliders'} /></button>
        </nav>
      )}
      {prefs.value.display === 'conversation' && S.summon.value === 'props' && (
        <aside class="inspector-wrap panel-body summon-card"><Inspector /></aside>
      )}
      <nav class="mobile-tabs">
        {TABS.map(([id, label, icon]) => (
          <button key={id} class={S.mobileTab.value === id ? 'on' : ''} onClick={() => { S.mobileTab.value = id; }}><Icon name={icon} />{label}</button>
        ))}
      </nav>
      <SettingsDialog />
      <QuestionDialog />
      <MenuHost />
      <Toasts />
    </div>
  );
}
