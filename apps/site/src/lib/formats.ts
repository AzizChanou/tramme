/** what tramme writes: `tramme render` (video, frames) and `tramme export`
 *  (vectors, sound); the editor writes them all in the browser but MOV */
export const FORMATS = [
  { name: 'MP4', what: 'H.264, with the sound' },
  { name: 'MOV', what: 'ProRes 4444, command line only' },
  { name: 'WebM', what: 'VP9, with alpha' },
  { name: 'GIF', what: 'Animated image' },
  { name: 'PNG', what: 'A still, or every frame' },
  { name: 'Lottie', what: 'Vectors, checked against lottie-web' },
  { name: 'SVG', what: 'A frame as vectors' },
  { name: 'WAV', what: 'The sound mix alone' },
];
