// Files joined to a message for the assistant. Each becomes a file of the
// project (assets/chat/), images, sounds and videos also an asset of the
// document so the assistant can place them. Images are shown to Claude;
// sounds and videos are transcribed (Claude reads what is said, with its
// timing, through its tools).

import { signal } from '@preact/signals';
import { pointer, type TrammeDoc } from '@tramme/core';
import { api } from './api.ts';
import { safeName, takenPaths, upload } from './files.ts';
import { freshId } from './model.ts';
import { transcribeAsset, transcriptIdOf, transcriptions } from './speech.ts';
import { commit, S, toast } from './state.ts';
import { t } from './i18n/index.ts';

export interface Attachment {
  path: string;
  name: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  size: number;
  /** its asset in the document (images, sounds, videos) */
  asset?: string;
}

/** files joined to the message being written */
export const pending = signal<Attachment[]>([]);
/** files still being sent */
export const attaching = signal(0);

const kindOf = (f: File): Attachment['kind'] => {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  if (f.type.startsWith('audio/') || ['wav', 'mp3', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (f.type.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  return 'file';
};

export async function attachFiles(files: File[]) {
  const taken = await takenPaths();
  for (const f of files) {
    const kind = kindOf(f);
    if (kind === 'file' && !/\.(json|svg|js|mjs)$/i.test(f.name)) { toast(t('attachments.nameImageSoundVideo', { name: f.name }), 'error'); continue; }
    attaching.value++;
    try {
      const path = await upload(taken, `assets/chat/${safeName(f.name)}`, f);
      let asset: string | undefined;
      if (kind !== 'file') {
        const doc = S.doc.peek();
        asset = freshId(doc.assets, safeName(f.name).replace(/\.[^.]+$/, '').slice(0, 40) || kind);
        commit(t('attachments.attachmentName', { name: f.name }), [{ op: 'add', path: pointer('assets', asset), value: { type: kind, src: path, name: f.name.replace(/\.[^.]+$/, '') } }]);
        // what is said, ready for the assistant
        if (kind === 'audio' || kind === 'video') {
          const id = asset;
          transcribeAsset(id).catch((e) => toast(t('attachments.couldNotTranscribeName', { name: f.name, error: (e as Error).message }), 'error', 9000));
        }
      }
      pending.value = [...pending.peek(), { path, name: f.name, kind, size: f.size, asset }];
    } catch (e) {
      toast(`${f.name} : ${(e as Error).message}`, 'error');
    } finally {
      attaching.value--;
    }
  }
}

export const removePending = (path: string) => { pending.value = pending.peek().filter((a) => a.path !== path); };

/** where a file of the project is served */
export const attachmentUrl = (a: Attachment) => api.fileUrl(S.project.peek().id, a.path);

/** the images of a message as Claude sees them: at most 1568 px, JPEG */
export async function imageBlocks(atts: Attachment[]): Promise<{ mediaType: string; data: string }[]> {
  const out: { mediaType: string; data: string }[] = [];
  for (const a of atts.filter((x) => x.kind === 'image')) {
    try {
      const img = new Image();
      img.src = attachmentUrl(a);
      await img.decode();
      const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      out.push({ mediaType: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.86).split(',')[1] });
    } catch (e) { console.warn('[tramme] image jointe :', (e as Error).message); }
  }
  return out;
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} Mo`;

/** the files of a message, told to the assistant */
export function describe(atts: Attachment[], doc: TrammeDoc): string[] {
  if (!atts.length) return [];
  const lines = ['Files attached to this message:'];
  for (const a of atts) {
    const where = a.asset ? `asset "${a.asset}", file ${a.path}` : `file ${a.path}`;
    if (a.kind === 'image') lines.push(`- image ${a.name} (${where}): attached above, you can see it.`);
    else if (a.kind === 'audio' || a.kind === 'video') {
      const t = a.asset ? transcriptIdOf(a.asset) : '';
      const state = t && doc.assets[t] ? `transcript ready (asset "${t}")` : transcriptions.peek().some((j) => j.id === a.asset) ? 'transcription in progress' : 'not transcribed yet';
      lines.push(`- ${a.kind === 'video' ? 'video' : 'sound'} ${a.name} (${where}, ${mb(a.size)}): ${state}. Read what is said with get_transcript, see the video with media_frame.`);
    } else lines.push(`- file ${a.name} (${where}): readable with read_file.`);
  }
  return lines;
}
