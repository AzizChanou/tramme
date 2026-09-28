// The export formats offered in the browser (the encoders load on first use).

import { m } from './i18n/index.ts';

export type WebFormat = 'mp4' | 'webm' | 'gif' | 'png' | 'lottie' | 'svg' | 'wav';

export const WEB_FORMATS: [WebFormat, string, string][] = [
  ['mp4', m('formats.mp4H264'), m('formats.videoAndSoundFor')],
  ['webm', m('formats.webmVp9'), m('formats.withAlphaForThe')],
  ['gif', m('formats.animatedGif'), m('formats.noSound50Fps')],
  ['png', m('formats.pngSequenceZip'), m('formats.oneImagePerFrame')],
  ['lottie', m('formats.lottieJson'), m('formats.vectorAnimationForApps')],
  ['svg', m('formats.svgOfTheCurrent'), m('formats.vectorImage')],
  ['wav', m('formats.soundWav'), m('formats.theMixOfThe')],
];
export const VIDEO = new Set<WebFormat>(['mp4', 'webm', 'gif', 'png']);
