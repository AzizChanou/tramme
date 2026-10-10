// Pictures made at authoring time: a provider draws one (generate-image),
// the file lands in the project with what made it, and an image layer shows
// it. A tool of the editor's vocabulary: the assistant reaches it with
// use_tool, the user from the / menu. The model sees what was made — it
// judges the picture with its own eyes, and has it made again when it is off
// (docs/generation-roadmap.md).

import { pointer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { api } from './api.ts';
import { payFor } from './confirm.ts';
import { clip, freshId } from './model.ts';
import { jpegOf } from './perception.ts';
import { t } from './i18n/index.ts';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** the proportions the providers take, named as Gemini does */
const RATIOS = ['21:9', '16:9', '9:16', '5:4', '4:5', '3:2', '2:3', '4:3', '3:4', '1:1'] as const;
type Ratio = (typeof RATIOS)[number];

/** the ratio closest to the composition's proportions */
function ratioOf(w: number, h: number): Ratio {
  const r = w / h;
  let best: Ratio = '1:1', gap = Infinity;
  for (const c of RATIOS) {
    const [a, b] = c.split(':').map(Number);
    const d = Math.abs(Math.log(r / (a / b)));
    if (d < gap) { gap = d; best = c; }
  }
  return best;
}

/** a picture kept under assets/images/ and declared as an image asset (replaced when made again) */
async function keepImage(ctx: ToolContext, name: string, blob: Blob, made: unknown): Promise<{ asset: string; ops: Op[]; reload: string[] }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'picture';
  const asset = `image-${slug}`;
  const path = await ctx.writeFile(`assets/images/${slug}.${EXT[blob.type] ?? 'png'}`, blob);
  await ctx.writeFile(`assets/images/${slug}.image.json`, JSON.stringify(made, null, 1));
  const had = !!ctx.doc.assets[asset];
  return { asset, reload: had ? [asset] : [], ops: [{ op: had ? 'replace' : 'add', path: pointer('assets', asset), value: { type: 'image', src: path, name } }] };
}

/** what the model and the user see of the picture: a small JPEG, the size of a still */
async function preview(blob: Blob): Promise<string> {
  const img = await createImageBitmap(blob);
  try { return jpegOf(img, img.width, img.height, Math.min(1, 768 / img.width)); } finally { img.close(); }
}

/**
 * An image layer showing the picture: filling the frame (cover, cropped to
 * it) or showing it whole (contain, bands around it), over the whole
 * composition or from a time; a background goes under the other layers.
 */
function place(ctx: ToolContext, asset: string, name: string, o: { fit: 'cover' | 'contain'; at: number; duration?: number; background: boolean }): { ops: Op[]; layer: string } {
  const c = ctx.doc.compositions[ctx.compId];
  const id = freshId({ ...c.layers }, asset.replace(/^image-/, 'pic-'));
  const at = Math.max(0, o.at), out = Math.min(c.duration, at + (o.duration ?? c.duration));
  const ops: Op[] = [
    { op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { type: 'image', name, in: +at.toFixed(3), out: +out.toFixed(3), transform: { position: [c.width / 2, c.height / 2] }, props: { image: asset, size: [c.width, c.height], fit: o.fit } } },
    { op: 'add', path: pointer('compositions', ctx.compId, 'order', o.background ? '0' : '-'), value: id },
  ];
  return { ops, layer: id };
}

const generateImage: ToolType<{ prompt: string; name?: string; ratio?: Ratio | 'auto'; quality?: 'low' | 'medium' | 'high'; provider?: string; fit?: 'cover' | 'contain'; at?: number; duration?: number; background?: boolean }> = {
  name: 'generate-image', title: 'Have a picture made', description: "has a provider draw a picture (the server's keys), saves it in the project with what made it and places it as an image layer; answers with the picture",
  input: {
    type: 'object',
    properties: {
      prompt: { type: 'string', title: 'Prompt', description: 'what the picture shows, and how it is drawn: technique, palette, mood ("flat vector illustration of a lighthouse at dusk, muted blues and warm sand, lots of quiet sky", "seamless paper texture, soft light"). The words of the video go in text layers, never in the picture' },
      name: { type: 'string', title: 'Name', description: 'of the file, lower case; the same name makes the picture again' },
      ratio: { enum: ['auto', ...RATIOS], title: 'Proportions', description: "auto: the composition's" },
      quality: { enum: ['low', 'medium', 'high'], title: 'Quality', description: 'low costs less: a draft, a texture; high: a picture that stays on screen' },
      provider: { enum: ['openai', 'gemini', 'zai'], title: 'Provider', description: 'the first one the server has a key for by default' },
      fit: { enum: ['cover', 'contain'], title: 'Fit', description: 'cover: fills the frame, cropped to it (a background); contain: shown whole, bands around it (a prop, a logo)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: '0 by default: the whole composition' },
      duration: { type: 'number', minimum: 0.1, title: 'Length (s)', description: 'to the end of the composition by default' },
      background: { type: 'boolean', title: 'In the background', description: 'under the other layers' },
    },
    required: ['prompt'],
  },
  ai: {
    when: "the project has no picture for what a shot needs: a background a title reads over, a texture, an illustration in the project's colours, a prop. Describe it as drawn (technique, palette, mood) and keep quiet what the text layers will say",
    avoid: 'words in the picture (they come out crooked, and text layers can translate them); the face of a real person; a brand logo. It costs money: one picture per need, at low quality while searching, high once it is right',
    example: { prompt: 'flat vector illustration of a coastal road at dusk, muted blues and warm sand, large quiet sky over the sea, no text', name: 'road-dusk', background: true },
  },
  async run({ prompt, name, ratio = 'auto', quality, provider, fit = 'cover', at = 0, duration, background = false }, ctx) {
    // it costs money: the user says yes first, or the turn's allowance does (as for the sounds)
    await payFor(t('image.paidTitle'), t('image.paidText', { prompt: clip(prompt, 140) }), t('image.paidYes'), 'ask the user for a picture instead');
    const c = ctx.doc.compositions[ctx.compId];
    const r = ratio === 'auto' ? ratioOf(c.width, c.height) : ratio;
    const made = await api.generateImage({ prompt, ratio: r, quality, provider }, ctx.signal);
    const label = name ?? prompt.toLowerCase().split(/\s+/).slice(0, 4).join('-');
    const record = { prompt, provider: made.provider, model: made.model, ratio: r, ...(quality ? { quality } : {}) };
    const kept = await keepImage(ctx, label, made.blob, record);
    const placed = place(ctx, kept.asset, label, { fit, at, duration, background });
    return {
      ops: [...kept.ops, ...placed.ops], reload: kept.reload, label: `Picture ${label}`,
      text: `Picture made by ${made.provider} (${made.model}, ${r}), saved as asset ${kept.asset} with its prompt; layer ${placed.layer}${background ? ' in the background' : ''} from ${at.toFixed(2)} s. You see it: judge it (a background stays quiet under the titles) and have it made again with a sharper prompt when it is off.`,
      images: [{ url: await preview(made.blob), caption: `${label} · ${made.provider}` }],
      notice: t('image.made', { name: label, provider: made.provider }),
    };
  },
};

export const IMAGE_TOOLS: ToolType[] = [generateImage];
