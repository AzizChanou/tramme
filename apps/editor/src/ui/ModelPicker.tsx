// The model menu: Claude, then the providers with a key on the server
// (OpenAI, Gemini, OpenRouter), then the models of a local server (Ollama,
// LM Studio). A search narrows long lists (OpenRouter offers hundreds).

import { useEffect, useRef, useState } from 'preact/hooks';
import { MODELS, modelLabel, PROVIDER_LABEL, providerOf, REMOTE } from '@tramme/assistant';
import { aiModels, aiSettings, aiStatus, loadModels, setAiSettings, type ModelOption } from '../ai/index.ts';
import { toast } from '../state.ts';
import { Popover } from './controls.tsx';
import { Icon } from './icons.tsx';
import { t } from '../i18n/index.ts';

/** beyond this, a group asks for a narrower search */
const SHOWN = 40;

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
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast(t('common.commandCopied')));
  // a model typed in full (openai:gpt-x, local:qwen3:8b), for one the lists do not show
  const typed = /^(openai|gemini|openrouter|local):\S+$/.test(query.trim()) ? query.trim() : null;
  const providers = Object.keys(REMOTE) as (keyof typeof REMOTE)[];
  const configured = providers.filter((p) => st.remote[p]), missing = providers.filter((p) => !st.remote[p]);
  const firstVisible = () => (anchor ? (anchor.ownerDocument.querySelector('.models-pop .model-opt') as HTMLElement | null) : null);
  return (
    <>
      <button class={`model-pick${wide ? ' wide' : ''}`} data-tour={wide ? undefined : 'assistant-model'} title={t('models.modelProvider', { provider: t(PROVIDER_LABEL[providerOf(model)]) })} onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement))}>
        <span>{modelLabel(model)}</span><Icon name="chevronDown" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} class="models-pop" align="right">
          <div class="field"><Icon name="search" /><input ref={search} value={query} placeholder={t('models.searchForAModel')} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (typed) pick(typed); else firstVisible()?.click(); } }} /></div>
          <div class="models-list">
            {typed && <button class="model-opt" onClick={() => pick(typed)}><span>{t('models.useName', { name: typed })}</span></button>}
            <Group title="Claude" options={MODELS.map(([id, label]) => ({ id, label }))} current={model} query={query} pick={pick} />
            {configured.map((p) => {
              const list = models.remote[p];
              const options = list === undefined ? null : Array.isArray(list) ? list.map((o) => ({ id: `${p}:${o.id}`, label: o.label })) : [];
              return <Group key={p} title={REMOTE[p].label} options={options} current={model} query={query} pick={pick} note={list && !Array.isArray(list) ? t('models.listUnavailableErrorType', { error: list.error, provider: p }) : undefined} />;
            })}
            <Group title={t(PROVIDER_LABEL.local)} options={st.local === 'unknown' && !models.local.length ? null : models.local} current={model} query={query} pick={pick}
              note={st.local === 'absent' ? t('models.noServerAtUrl', { url: aiSettings.value.localUrl }) : undefined} />
            {missing.length > 0 && !query && (
              <details class="model-note">
                <summary>{t('models.noKeyOnThe', { list: missing.map((p) => REMOTE[p].label).join(', ') })}</summary>
                {missing.map((p) => { const cmd = `npx wrangler secret put ${REMOTE[p].secret} -c apps/worker/wrangler.jsonc`; return <code key={p} class="cmd" title={t('common.copy')} onClick={() => copy(cmd)}>{cmd}</code>; })}
              </details>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
