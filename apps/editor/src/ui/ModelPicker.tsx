// The model menu: Claude, then the command lines the local companion found on
// this computer (Codex, the Gemini CLI), the providers connected in the
// settings (OpenAI, Gemini, OpenRouter, Z.AI, custom ones), then the models of
// a local server (Ollama, LM Studio). A search narrows long lists (OpenRouter
// offers hundreds).

import { useEffect, useRef, useState } from 'preact/hooks';
import { CLI_DEFAULT, ENGINE_MODELS, MODELS, modelLabel, PROVIDER_LABEL, providerOf, type Effort } from '@tramme/assistant';
import { aiModels, aiSettings, aiStatus, currentEffort, loadModels, modelEfforts, providerLabel, remoteProviders, setAiSettings, setEffort, type ModelOption } from '../ai/index.ts';
import { openSettings } from '../settings.ts';
import { Popover, Seg } from './controls.tsx';
import { Icon } from './icons.tsx';
import { t } from '../i18n/index.ts';

/** beyond this, a group asks for a narrower search */
const SHOWN = 40;

const EFFORT_LABEL: Record<Effort, () => string> = {
  low: () => t('settings.effortLow'),
  medium: () => t('settings.effortMedium'),
  high: () => t('settings.effortHigh'),
  xhigh: () => t('settings.effortXhigh'),
  max: () => t('settings.effortMax'),
};

/** the model's effort, for the model button's tooltip ('' when it has no levels) */
function effortTitle(model: string): string {
  const options = effortOptions(model), current = currentEffort(model) ?? '';
  return options.length ? t('settings.effortIs', { level: options.find(([v]) => v === current)?.[1] ?? '' }) : '';
}

/** the levels offered for a model, with its own default for the models other than Claude */
function effortOptions(model: string): [string, string][] {
  const levels = modelEfforts(model);
  if (!levels.length) return [];
  return [...(providerOf(model) === 'anthropic' ? [] : [['', t('settings.effortDefault')] as [string, string]]), ...levels.map((l): [string, string] => [l, EFFORT_LABEL[l]()])];
}

/**
 * The effort level of the chosen model, for the models that have levels:
 * in the settings, and at the top of the model menu. Claude's levels start
 * at high; the other models also offer their own default.
 */
export function EffortPicker({ inMenu = false }: { inMenu?: boolean }) {
  const model = aiSettings.value.model;
  const options = effortOptions(model);
  if (!options.length) return inMenu ? null : <span class="faint">{t('settings.effortNone')}</span>;
  const seg = <Seg value={currentEffort(model) ?? ''} options={options} onChange={(v) => setEffort(model, (v || null) as Effort | null)} />;
  if (!inMenu) return seg;
  return (
    <div class="model-group model-effort" title={t('settings.effortHint')}>
      <div class="model-group-title">{t('settings.effortOfName', { name: modelLabel(model) })}</div>
      {seg}
    </div>
  );
}

function Group({ title, options, current, query, pick, note }: { title: string; options: ModelOption[] | null; current: string; query: string; pick: (id: string) => void; note?: preact.ComponentChildren }) {
  const q = query.trim().toLowerCase();
  const found = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
  if (q && !found.length) return null;
  return (
    <div class="model-group">
      <div class="model-group-title">{title}</div>
      {options === null && <div class="model-note"><Icon name="spinner" />{t('models.loading')}</div>}
      {found.slice(0, SHOWN).map((o) => (
        <button key={o.id} class={`model-opt${o.id === current ? ' on' : ''}`} onClick={() => pick(o.id)} title={o.id}>
          <span>{o.label}</span>{o.id === current && <Icon name="check" />}
        </button>
      ))}
      {found.length > SHOWN && <div class="model-note">{t('models.andNMoreRefine', { n: found.length - SHOWN })}</div>}
      {note && !q && <div class="model-note">{note}</div>}
    </div>
  );
}

export function ModelPicker({ wide = false }: { wide?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const model = aiSettings.value.model, st = aiStatus.value, models = aiModels.value;
  useEffect(() => {
    if (!anchor) return;
    setQuery('');
    loadModels();
    setTimeout(() => search.current?.focus(), 0);
  }, [anchor]);
  const pick = (id: string) => { setAiSettings({ model: id }); setAnchor(null); };
  // a model typed in full (openai:gpt-x, zai:glm-4-plus, custom:deepseek:deepseek-chat, local:qwen3:8b), for one the lists do not show
  const typed = /^(openai|gemini|openrouter|zai|glm|local|codex|gemini-cli|custom:[a-z0-9-]+):\S+$/.test(query.trim()) ? query.trim() : null;
  // the command lines of this computer: their own default, and the model typed for them if it is the one chosen
  const clis = (['codex', 'gemini'] as const).filter((engine) => st.engines[engine]).map((engine) => {
    const p = ENGINE_MODELS[engine].provider;
    return {
      engine, title: ENGINE_MODELS[engine].label,
      options: [{ id: `${p}:${CLI_DEFAULT}`, label: t('models.cliDefault') }, ...(providerOf(model) === p && !model.endsWith(`:${CLI_DEFAULT}`) ? [{ id: model, label: modelLabel(model) }] : [])],
    };
  });
  const providers = remoteProviders.value;
  // the server's keys are known once its configuration answered (server no longer null)
  const configured = providers.filter((p) => st.remote[p.slot]), missing = st.server === null ? [] : providers.filter((p) => !st.remote[p.slot]);
  const firstVisible = () => (anchor ? (anchor.ownerDocument.querySelector('.models-pop .model-opt') as HTMLElement | null) : null);
  return (
    <>
      <button class={`model-pick${wide ? ' wide' : ''}`} data-tour={wide ? undefined : 'assistant-model'} title={[t('models.modelProvider', { provider: t(providerLabel(model)) }), effortTitle(model)].filter(Boolean).join(' · ')} onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement))}>
        <span>{modelLabel(model)}</span><Icon name="chevronDown" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} class="models-pop" align="right">
          <div class="field"><Icon name="search" /><input ref={search} value={query} placeholder={t('models.searchForAModel')} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (typed) pick(typed); else firstVisible()?.click(); } }} /></div>
          <EffortPicker inMenu />
          <div class="models-list">
            {typed &&<button class="model-opt" onClick={() => pick(typed)}><span>{t('models.useName', { name: typed })}</span></button>}
            <Group title="Claude" options={MODELS.map(([id, label]) => ({ id, label }))} current={model} query={query} pick={pick} />
            {clis.map((c) => <Group key={c.engine} title={c.title} options={c.options} current={model} query={query} pick={pick} />)}
            {configured.map(({ slot, label }) => {
              const list = models.remote[slot];
              const options = list === undefined ? null : Array.isArray(list) ? list.map((o) => ({ id: `${slot}:${o.id}`, label: o.label })) : [];
              return <Group key={slot} title={label} options={options} current={model} query={query} pick={pick} note={list && !Array.isArray(list) ? t('models.listUnavailableErrorType', { error: list.error, provider: slot }) : undefined} />;
            })}
            <Group title={t(PROVIDER_LABEL.local)} options={st.local === 'unknown' && !models.local.length ? null : models.local} current={model} query={query} pick={pick}
              note={st.local === 'absent' ? t('models.noServerAtUrl', { url: aiSettings.value.localUrl }) : undefined} />
            {missing.length > 0 && !query && (
              <div class="model-note">
                <span>{t('models.noKeyOnThe', { list: missing.map((p) => p.label).join(', ') })}</span>
                <button class="btn sm" onClick={() => { setAnchor(null); openSettings('providers'); }}><Icon name="link" />{t('models.connectProviders')}</button>
              </div>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
