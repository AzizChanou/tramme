// The editor's vocabulary: the engine's nodes and effects, plus the editor's
// own tools (the ready-made dressings) and workflows. They reach the
// assistant (use_tool) and the chat's / menu the same way as those a
// project's plugins bring.

import type { PromptType, ToolContext, ToolType } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { CUTOUT_TOOLS } from './cutout.ts';
import { EVENT_TOOLS } from './events.ts';
import { IMAGE_TOOLS } from './images.ts';
import { LIBRARY_TOOLS } from './library.ts';
import { PERCEPTION_TOOLS } from './perception.ts';
import { EDITOR_PRESETS } from './presets.ts';
import { BUILTIN_KITS, RECIPE_TOOLS } from './recipes.ts';
import { REVIEW_TOOLS } from './review.ts';
import { SHORTS_TOOLS } from './shorts.ts';
import { SOUND_TOOLS } from './sound.ts';
import { TRACKING_TOOLS } from './tracking.ts';
import { TEMPLATES, type TemplateArgs } from './templates.ts';

const at = { type: 'number', minimum: 0, title: 'Start (s)', description: 'composition time; the current time by default' };
const duration = { type: 'number', minimum: 0.1, title: 'Duration (s)' };
const place = { enum: ['top', 'center', 'bottom'], title: 'Place' };

/** the transcript the captions read: the one of the edit when there is one */
function transcriptOf(ctx: ToolContext): string | undefined {
  const ids = Object.entries(ctx.doc.assets).filter(([id, a]) => a.type === 'json' && id.startsWith('transcription-')).map(([id]) => id);
  return ids.find((id) => id.endsWith('-edit')) ?? ids[0];
}

function templateTool(name: string, properties: Record<string, unknown>, required: string[] = []): ToolType<Partial<TemplateArgs>> {
  const tpl = TEMPLATES[name];
  return {
    name, title: tpl.title, description: tpl.description,
    input: { type: 'object', properties, required },
    run(input, ctx) {
      const transcript = name === 'captions' ? input.transcript ?? transcriptOf(ctx) : input.transcript;
      return tpl.build(ctx.doc, ctx.compId, { ...input, at: input.at ?? ctx.time, transcript });
    },
  };
}

export const EDITOR_TOOLS: ToolType[] = [
  templateTool('captions', { transcript: { type: 'string', format: 'asset', assetType: 'json', title: 'Transcript' }, at, duration, place }),
  templateTool('title', { text: { type: 'string', title: 'Text' }, subtitle: { type: 'string', title: 'Subtitle' }, at, duration, place }, ['text']),
  templateTool('keyword', { text: { type: 'string', title: 'Text' }, at, duration, place }, ['text']),
  templateTool('lower-third', { text: { type: 'string', title: 'Name' }, subtitle: { type: 'string', title: 'Role' }, at, duration }, ['text']),
];

export const EDITOR_PROMPTS: PromptType[] = [
  {
    name: 'dress', title: 'Dress a talking video', description: 'cuts, captions, titles and keywords on a video where someone speaks',
    prompt: 'Dress the talking video of this project, following your guide for talking videos: ask about the format and the tone if I have not said them, read the transcript, cut the silences and hesitations, add captions, section titles and keywords at the right moments, then check with frames.',
  },
  {
    name: 'review', title: 'Review the composition', description: 'checks the key moments and fixes what is wrong',
    prompt: 'Review the composition: run the check tool (use_tool "check") and read its issues and contact sheet, look closer at the entrances and transitions that matter with the motion tool, and judge what the checks cannot: contrast, hierarchy, rhythm, elements over a face. Propose fixes for what you find, then run check again.',
  },
  {
    name: 'polish', title: 'Polish the motion', description: 'brings the movement to standard: easings, durations, stagger, arcs, settles',
    prompt: 'Polish the motion of this composition, following your guide for motion: run the check tool (use_tool "check") and look at the entrances that matter with the motion tool (use_tool "motion"), then fix what they flag and what the guide asks for: entrances that ease in over about 300 ms and land softly, exits that leave faster, group entrances staggered by uneven gaps, arcs on the big diagonal travels, moves that pass their mark and settle instead of stopping dead. Define the curves once as ease tokens and reference them, keep what already reads well, then check again.',
  },
  {
    name: 'sound-design', title: 'Sound design', description: 'gives the video its sound: effects on the moments that matter, a bed if it needs one, levels under the voice',
    prompt: 'Give this video its sound, following your guide for sound: look at the key moments (check), say in a few lines which sounds go where and why, then search the library (sfx with a query) and place them on the moments (on: entrances, cuts, markers, beats), write the ones the library lacks (synth), duck any music under a voice (duck), and check the mix (check) before summing up.',
  },
  {
    name: 'shorts', title: 'Cut shorts from a long video', description: 'the strongest moments as shorts of the asked format, captions and titles included',
    prompt: 'Cut shorts from the long video of this project, following your guide for shorts: ask how many and which format if I have not said them, read the candidates (use_tool "shorts" without plan) and say which you would pick and why, build them (shorts with a plan), then check each short (check, after switching to it) and fix what matters before summing up.',
  },
];

/** the base vocabulary of the editor, before a document's plugins */
export function editorRegistry() {
  return builtinRegistry().registerTool(...EDITOR_TOOLS, ...RECIPE_TOOLS, ...EVENT_TOOLS, ...PERCEPTION_TOOLS, ...TRACKING_TOOLS, ...CUTOUT_TOOLS, ...REVIEW_TOOLS, ...SOUND_TOOLS, ...IMAGE_TOOLS, ...SHORTS_TOOLS, ...LIBRARY_TOOLS).registerPrompt(...EDITOR_PROMPTS).registerKit(...BUILTIN_KITS).registerPreset(...EDITOR_PRESETS);
}
