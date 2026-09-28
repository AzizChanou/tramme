import { describe, expect, it } from 'vitest';
import { applyOps, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { TEMPLATES } from '../src/templates.ts';

/** a project made from a video, its transcript beside it */
function videoProject(width: number, height: number): TrammeDoc {
  const { doc } = newProject({ name: 'Video', width, height, fps: 30, duration: 12 });
  doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
  doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
  doc.compositions.main.layers.video = { type: 'video', transform: { position: [width / 2, height / 2] }, props: { video: 'talk', size: [width, height], fit: 'cover' } } as never;
  doc.compositions.main.order = ['video'];
  return doc;
}

describe('dressing templates', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    it(`each one gives a valid document (${w}×${h}), added above the video`, () => {
      let doc = videoProject(w, h);
      for (const [name, tpl] of Object.entries(TEMPLATES)) {
        const { ops } = tpl.build(doc, 'main', { at: 2, duration: 3, text: 'The title', subtitle: 'One line', transcript: 'transcription-talk' });
        doc = applyOps(doc, ops).doc;
        expect(validate(doc, builtinRegistry()), name).toEqual([]);
      }
      const c = doc.compositions.main;
      expect(c.order[0]).toBe('video');
      expect(c.order.length).toBeGreaterThan(Object.keys(TEMPLATES).length);
      expect(new Set(c.order).size).toBe(c.order.length);
    });
  }

  it('captions need a transcript', () => {
    expect(() => TEMPLATES.captions.build(videoProject(1920, 1080), 'main', { at: 0 })).toThrow(/transcription/);
  });
});
