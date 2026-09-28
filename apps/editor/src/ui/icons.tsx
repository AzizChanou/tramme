// Line icons on a 16 px grid, 1.6 stroke: one family for the whole editor.

const P: Record<string, string> = {
  play: 'M5 3.5v9l7.5-4.5z',
  attach: 'M10.6 4.6 5.9 9.3a1.4 1.4 0 0 0 2 2l5-5a2.9 2.9 0 0 0-4.1-4.1l-5 5a4.4 4.4 0 0 0 6.2 6.2l4.1-4.1',
  help: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.2 6.3a1.9 1.9 0 0 1 3.7.5c0 1.3-1.9 1.6-1.9 2.8M8 11.3h.01',
  gear: 'M12.35 6.50 L14.50 6.85 L14.50 9.15 L12.35 9.50 L12.13 10.02 L13.41 11.79 L11.79 13.41 L10.02 12.13 L9.50 12.35 L9.15 14.50 L6.85 14.50 L6.50 12.35 L5.98 12.13 L4.21 13.41 L2.59 11.79 L3.87 10.02 L3.65 9.50 L1.50 9.15 L1.50 6.85 L3.65 6.50 L3.87 5.98 L2.59 4.21 L4.21 2.59 L5.98 3.87 L6.50 3.65 L6.85 1.50 L9.15 1.50 L9.50 3.65 L10.02 3.87 L11.79 2.59 L13.41 4.21 L12.13 5.98Z M10.2 8a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z',
  home: 'M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5',
  upload: 'M8 10.5V3M5 6l3-3 3 3M3 10.5v2.5h10v-2.5',
  edit: 'M10.5 3 13 5.5 6 12.5H3.5V10zM9 4.5 11.5 7',
  grid4: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  start: 'M4 3.5v9M12.5 3.5 6.5 8l6 4.5z',
  end: 'M12 3.5v9M3.5 3.5 9.5 8l-6 4.5z',
  prev: 'M10 4 6 8l4 4',
  next: 'M6 4l4 4-4 4',
  loop: 'M3 7V6a2 2 0 0 1 2-2h7l-2-2M13 9v1a2 2 0 0 1-2 2H4l2 2',
  undo: 'M4 6h6a3 3 0 0 1 0 6H7M6.5 3.5 4 6l2.5 2.5',
  redo: 'M12 6H6a3 3 0 0 0 0 6h3M9.5 3.5 12 6 9.5 8.5',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  eyeOff: 'M2 2l12 12M6.6 6.6A2 2 0 0 0 9.4 9.4M4.2 4.7C2.6 5.8 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.4-.4 3.4-1M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.5.9-1.4 1.9',
  lock: 'M4.5 7.5h7v5.5h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2',
  unlock: 'M4.5 7.5h7v5.5h-7zM6 7.5V5.5a2 2 0 0 1 3.9-.6',
  chevron: 'M6 4l4 4-4 4',
  chevronDown: 'M4 6l4 4 4-4',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  layers: 'M8 2.5 14 5.5 8 8.5 2 5.5zM2 8.5l6 3 6-3M2 11l6 3 6-3',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.5h.01',
  text: 'M3.5 4V3h9v1M8 3v10M6 13h4',
  rect: 'M3 4h10v8H3z',
  ellipse: 'M8 3.5c3 0 5.5 2 5.5 4.5S11 12.5 8 12.5 2.5 10.5 2.5 8 5 3.5 8 3.5z',
  path: 'M3 12c2-7 7-1 10-8M3 12h.01M13 4h.01',
  group: 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z',
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13',
  audio: 'M6 11.5V3.5l7-1.5v8M6 11.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM13 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  counter: 'M3 3.5h10v9H3zM6.5 6v4M9.5 6v4M3 8h10',
  chat: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  frame: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M6 8h4',
  send: 'M8 13V3.5M3.8 7.5 8 3.3l4.2 4.2',
  stop: 'M4.5 4.5h7v7h-7z',
  expand: 'M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9',
  collapse: 'M13 6.5H9.5V3M3 9.5h3.5V13M9.5 6.5 14 2M6.5 9.5 2 14',
  grid: 'M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11',
  safe: 'M2.5 3.5h11v9h-11zM4.5 5.5h7v5h-7z',
  diamond: 'M5 1 9 5 5 9 1 5z',
  fx: 'M4 13c1.5 0 2-1 2.3-3l1-6C7.6 2.5 8.3 2 9.5 2M4.5 6.5h5M9.5 8.5l3.5 4M13 8.5l-3.5 4',
  link: 'M6.5 9.5l3-3M7.5 4.5 9 3a2.5 2.5 0 0 1 3.5 3.5L11 8M8.5 11.5 7 13a2.5 2.5 0 0 1-3.5-3.5L5 8',
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  search: 'M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zM10.6 10.6l3.4 3.4',
  download: 'M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10',
  palette: 'M8 2a6 6 0 1 0 0 12c1 0 1.5-.6 1.5-1.4 0-.9-.7-1.2-.7-2s.6-1.3 1.5-1.3H12a2 2 0 0 0 2-2C14 4.4 11.3 2 8 2zM5 7.5h.01M6.5 5h.01M9.5 5h.01',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  folder: 'M2 4.5h4.5L8 6h6v7H2z',
  film: 'M2.5 2.5h11v11h-11zM5 2.5v11M11 2.5v11M2.5 5.5H5M2.5 8H5M2.5 10.5H5M11 5.5h2.5M11 8h2.5M11 10.5h2.5',
  marker: 'M8 2 12 6v8H4V6z',
  wand: 'M3 13 11 5M10 2v2M13 4h-2M13 8h-1M6 2v1',
  spinner: 'M8 2a6 6 0 1 0 6 6',
  curve: 'M2.5 13.5c4 0 4-11 11-11M2.5 13.5h.01M13.5 2.5h.01',
  timeline: 'M2.5 4h7M5.5 8h8M2.5 12h5',
  sliders: 'M3 4h6M12 4h1M3 8h1M7 8h6M3 12h7M13 12h0M10.5 2.5v3M5.5 6.5v3M11.5 10.5v3',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  target: 'M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M8 8h.01',
  keyframe: 'M8 3l5 5-5 5-5-5z',
  bezier: 'M2.5 13.5 13.5 2.5M2.5 13.5c0-6 5-11 11-11',
  box: 'M8 1.5 14 4.5v7L8 14.5 2 11.5v-7zM2 4.5l6 3 6-3M8 7.5v7',
  zoomFit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.5V8l2.5 1.5',
  alert: 'M8 2 14.5 13.5h-13zM8 6.5v3M8 11.5h.01',
  info: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.5V11M8 5h.01',
  move: 'M8 2v12M2 8h12M8 2 6.5 3.5M8 2l1.5 1.5M8 14l-1.5-1.5M8 14l1.5-1.5M2 8l1.5-1.5M2 8l1.5 1.5M14 8l-1.5-1.5M14 8l-1.5 1.5',
  particles: 'M4 4h.01M8 3h.01M12 5h.01M5 9h.01M10 8.5h.01M13 11h.01M7 12.5h.01M3 13h.01',
  shader: 'M2.5 2.5h11v11h-11zM2.5 13.5 13.5 2.5M2.5 8 8 2.5M8 13.5 13.5 8',
  effects: 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  comp: 'M2.5 2.5h7v7h-7zM6.5 6.5h7v7h-7z',
};

export type IconName = keyof typeof P | string;

export function Icon({ name, class: cls = '', size }: { name: IconName; class?: string; size?: number }) {
  const d = P[name] ?? P.box;
  const filled = name === 'play' || name === 'diamond' || name === 'stop' || name === 'keyframe';
  return (
    <svg class={`i ${cls}`} viewBox="0 0 16 16" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      <path d={d} style={filled ? { fill: 'currentColor' } : undefined} />
    </svg>
  );
}

/** icon of a node type */
export function kindIcon(type: string): IconName {
  if (type.startsWith('shape.rect')) return 'rect';
  if (type.startsWith('shape.ellipse')) return 'ellipse';
  if (type.startsWith('shape')) return 'path';
  if (type === 'text.counter') return 'counter';
  if (type.startsWith('text') || type === 'captions') return 'text';
  if (type === 'image') return 'image';
  if (type === 'sequence' || type === 'video') return 'film';
  if (type === 'group') return 'group';
  if (type === 'code') return 'code';
  if (type === 'audio') return 'audio';
  if (type === 'comp') return 'comp';
  if (type.startsWith('particles')) return 'particles';
  if (type.startsWith('shader')) return 'shader';
  return 'box';
}

/** colour token of a node type (layer chips and clips) */
export function kindColor(type: string): string {
  if (type.startsWith('shape')) return 'var(--t-shape)';
  if (type.startsWith('text')) return 'var(--t-text)';
  if (type === 'image' || type === 'video' || type === 'sequence') return 'var(--t-image)';
  if (type === 'group' || type === 'comp') return 'var(--t-group)';
  if (type === 'audio') return 'var(--t-audio)';
  return 'var(--t-code)';
}
