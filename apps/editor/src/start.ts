// A project made from a video, opened for the first time: the speech is
// transcribed, the video is joined to the next message and the assistant asks
// what the user wants (format, cuts, captions, emphasis) before doing anything.

import { chat } from './ai/index.ts';
import { pending } from './attachments.ts';
import { startKey } from './importer.ts';
import { transcribeAsset } from './speech.ts';
import { S, toast } from './state.ts';
import { t } from './i18n/index.ts';

const GREETING = () => [
  t('start.yourVideoIsOn'),
  '',
  t('start.theFinalFormatLandscape'),
  t('start.whatToCutSilences'),
  t('start.theStyleOfCaptions'),
  t('start.theOverallToneUnderstated'),
  '',
  t('start.iWillShowYou'),
].join('\n');

export function startFromVideo() {
  const id = S.project.peek().id;
  let start: { asset?: string; path?: string; name?: string; size?: number } | null = null;
  try {
    start = JSON.parse(sessionStorage.getItem(startKey(id)) ?? 'null');
    sessionStorage.removeItem(startKey(id));
  } catch { return; }
  const asset = start?.asset;
  if (!asset || !S.doc.peek().assets[asset]) return;
  transcribeAsset(asset).catch((e) => toast(t('common.couldNotTranscribeError', { error: (e as Error).message }), 'error', 9000));
  pending.value = [{ path: start!.path ?? S.doc.peek().assets[asset].src, name: start!.name ?? asset, kind: 'video', size: start!.size ?? 0, asset }];
  chat.value = [...chat.peek(), { id: `start-${Date.now().toString(36)}`, role: 'assistant', text: GREETING() }];
  // on a phone, the conversation in front
  S.mobileTab.value = 'ai';
}
