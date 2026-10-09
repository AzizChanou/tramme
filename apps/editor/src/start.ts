// A project opened for the first time after it was made from a video or from
// sources. From a video: the speech is transcribed, the video is joined to the
// next message and the assistant asks what the user wants (format, cuts,
// captions, emphasis) before doing anything. From sources: the sounds and
// videos are transcribed, the analysis waits in the message box (/analyze),
// and the assistant says how it will work: read everything, propose what the
// video should be, make the one the user picks.

import { srcPath } from '@tramme/project';
import { chat } from './ai/index.ts';
import { draft, pending } from './attachments.ts';
import { startKey } from './importer.ts';
import { SOURCES_DIR } from './sources.ts';
import { transcribeAsset } from './speech.ts';
import { S, toast } from './state.ts';
import { t } from './i18n/index.ts';

const VIDEO_GREETING = () => [
  t('start.yourVideoIsOn'),
  '',
  t('start.theFinalFormatLandscape'),
  t('start.whatToCutSilences'),
  t('start.theStyleOfCaptions'),
  t('start.theOverallToneUnderstated'),
  '',
  t('start.iWillShowYou'),
].join('\n');

const SOURCES_GREETING = (n: number, kit: boolean) => [
  t('start.sourcesAreIn', { n }),
  ...(kit ? ['', t('start.kitApplied')] : []),
  '',
  t('start.sourcesReadAll'),
  t('start.sourcesBrief'),
  t('start.sourcesDirections'),
  '',
  t('start.sourcesSend'),
].join('\n');

const transcribe = (asset: string) => transcribeAsset(asset).catch((e) => toast(t('common.couldNotTranscribeError', { error: (e as Error).message }), 'error', 9000));

function greet(text: string) {
  chat.value = [...chat.peek(), { id: `start-${Date.now().toString(36)}`, role: 'assistant', text }];
  // on a phone, the conversation in front
  S.mobileTab.value = 'ai';
}

export function startProject() {
  const id = S.project.peek().id;
  let start: { asset?: string; path?: string; name?: string; size?: number; sources?: number; kit?: boolean } | null = null;
  try {
    start = JSON.parse(sessionStorage.getItem(startKey(id)) ?? 'null');
    sessionStorage.removeItem(startKey(id));
  } catch { return; }
  if (!start) return;
  const doc = S.doc.peek();
  if (start.sources) {
    // what is said, ready by the time the assistant reads the sources
    for (const [asset, a] of Object.entries(doc.assets)) {
      if ((a.type === 'audio' || a.type === 'video') && srcPath(a.src)?.startsWith(SOURCES_DIR)) transcribe(asset);
    }
    draft.value = '/analyze ';
    greet(SOURCES_GREETING(start.sources, !!start.kit));
    return;
  }
  const asset = start.asset;
  if (!asset || !doc.assets[asset]) return;
  transcribe(asset);
  pending.value = [{ path: start.path ?? doc.assets[asset].src, name: start.name ?? asset, kind: 'video', size: start.size ?? 0, asset }];
  greet(VIDEO_GREETING());
}
