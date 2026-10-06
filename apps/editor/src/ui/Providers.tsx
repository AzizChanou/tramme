// The providers connected and those offered, each with its key. The same list
// in both modes: in the settings dialog on the private server (the key sent
// once to the server, which keeps it), and in the key vault's page in
// personal mode (the key typed into the vault itself, which the editor never
// sees). `actions` says where a key goes.

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { KeyedProvider, KeyStatus } from '@tramme/api';
import { Confirm, Row, Section, norm } from './SettingsRows.tsx';
import { Icon } from './icons.tsx';
import { m, t } from '../i18n/index.ts';

export interface ProviderActions {
  connect(provider: KeyedProvider, key: string): Promise<void>;
  disconnect(provider: KeyedProvider): Promise<void>;
  saveCustom(id: string, c: { label: string; base: string; key?: string }): Promise<void>;
  removeCustom(id: string): Promise<void>;
  notify(text: string, kind?: 'info' | 'error'): void;
}

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

/** what is typed under a provider's row: sent on Save, the refusal shown in place */
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
function ProviderRow({ name, badge, hint, action, remove, form, notify }: { name: string; badge?: string; hint?: string; action?: string; remove?: () => Promise<void>; form: (close: () => void) => ComponentChildren; notify: ProviderActions['notify'] }) {
  const [open, setOpen] = useState<'form' | 'remove' | null>(null);
  const close = () => setOpen(null);
  const toggleForm = () => setOpen(open === 'form' ? null : 'form');
  const below = open === 'form' ? form(close) : open === 'remove' && remove && (
    <Confirm danger label={t('settings.disconnect')} question={t('settings.disconnectConfirm', { name })} action={t('settings.disconnect')} onCancel={close}
      onConfirm={() => remove().then(close, (e) => notify((e as Error).message, 'error'))} />
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

/**
 * keys: what is connected (null while it is looked for); intro: where the keys are kept;
 * relayed: in personal mode, the providers reached through the relay, which the user is told about
 */
export function Providers({ keys, actions, intro, relayed, forget }: { keys: KeyStatus | null; actions: ProviderActions; intro: string; relayed?: (p: KeyedProvider | 'custom') => boolean; forget?: () => Promise<void> }) {
  const [forgetting, setForgetting] = useState(false);
  const source = (p: KeyedProvider) => keys?.providers[p] ?? null;
  const connected = PROVIDERS.filter((p) => source(p.id)), offered = PROVIDERS.filter((p) => !source(p.id));
  const custom = keys?.custom ?? [];
  /** a hint, and the relay's note when the provider is reached through it */
  const via = (p: KeyedProvider | 'custom', hint?: string) => (relayed?.(p) ? [hint, t('personal.viaRelay')].filter(Boolean).join(' · ') : hint);
  const keyForm = (p: ProviderInfo) => (close: () => void) => (
    <ProviderForm link={p.keys} onClose={close} fields={[{ name: 'key', label: t('settings.apiKey'), secret: true, placeholder: t('settings.pasteTheKey') }]}
      onSave={async (v) => { await actions.connect(p.id, v.key); actions.notify(t('settings.providerConnected', { name: p.name })); }} />
  );
  const customForm = (c?: CustomProvider) => (close: () => void) => (
    <ProviderForm onClose={close} fields={[
      { name: 'label', label: t('settings.providerName'), initial: c?.label, placeholder: 'DeepSeek' },
      { name: 'base', label: t('settings.baseUrl'), initial: c?.base, placeholder: 'https://api.deepseek.com/v1' },
      { name: 'key', label: t('settings.apiKey'), secret: true, optional: true, placeholder: c?.key ? t('settings.keepTheKey') : t('settings.keyOptional') },
    ]} onSave={async (v) => {
      await actions.saveCustom(c?.id ?? customId(v.label, custom.map((x) => x.id)), { label: v.label, base: v.base, key: v.key || undefined });
      if (!c) actions.notify(t('settings.providerConnected', { name: v.label }));
    }} />
  );
  const anything = connected.length + custom.length > 0;
  return (
    <>
      <Section title={t('settings.connectedProviders')}>
        <p class="faint">{intro}</p>
        {keys === null
          ? <span class="faint">{t('common.searching')}</span>
          : !anything && <span class="faint">{t('settings.noProviderConnected')}</span>}
        {connected.map((p) => {
          const own = source(p.id) === 'settings';
          return (
            <ProviderRow key={p.id} name={p.name} badge={own ? t('settings.badgeApiKey') : t('settings.badgeServerSecret')} hint={via(p.id, own ? undefined : t('settings.serverSecretHint'))} notify={actions.notify}
              action={t('settings.changeKey')} form={keyForm(p)} remove={own ? async () => { await actions.disconnect(p.id); actions.notify(t('settings.providerDisconnected', { name: p.name })); } : undefined} />
          );
        })}
        {custom.map((c) => (
          <ProviderRow key={c.id} name={c.label} badge={t('settings.badgeCustom')} hint={via('custom', c.base)} action={t('settings.editProvider')} form={customForm(c)} notify={actions.notify}
            remove={async () => { await actions.removeCustom(c.id); actions.notify(t('settings.providerDisconnected', { name: c.label })); }} />
        ))}
        {forget && anything && (forgetting
          ? <Confirm danger label={t('personal.forgetKeys')} question={t('personal.forgetKeysConfirm')} action={t('personal.forgetKeys')} onCancel={() => setForgetting(false)}
              onConfirm={() => forget().then(() => setForgetting(false), (e) => actions.notify((e as Error).message, 'error'))} />
          : <div class="set-actions"><button class="btn ghost sm" onClick={() => setForgetting(true)}><Icon name="trash" />{t('personal.forgetKeys')}</button></div>)}
      </Section>
      <Section title={t('settings.addAProvider')}>
        {offered.map((p) => <ProviderRow key={p.id} name={p.name} hint={via(p.id, t(p.hint))} form={keyForm(p)} notify={actions.notify} />)}
        <ProviderRow name={t('settings.customProvider')} badge={t('settings.badgeCustom')} hint={via('custom', t('settings.providerCustom'))} form={customForm()} notify={actions.notify} />
      </Section>
    </>
  );
}
