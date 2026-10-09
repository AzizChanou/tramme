import { describe, expect, it } from 'vitest';
import { newProject, pathIssue, mimeOf } from '@tramme/project';
import { pageRange } from '../src/pdf.ts';
import { kindOf, sourcesOf } from '../src/sources.ts';

describe('the sources of a project', () => {
  it('lists the pictures, videos and sounds brought in, and every document', () => {
    const { doc } = newProject({ name: 'Launch', width: 1920, height: 1080, fps: 30, duration: 30 });
    doc.assets = {
      logo: { type: 'image', src: 'assets/sources/logo.png', name: 'logo' },
      talk: { type: 'video', src: 'assets/video/talk.mp4', name: 'talk' },
      voice: { type: 'audio', src: 'assets/chat/voice.m4a' },
      made: { type: 'image', src: 'assets/images/sky.png' },
      whoosh: { type: 'audio', src: 'assets/sounds/whoosh.wav' },
      brief: { type: 'json', src: 'assets/brief.json' },
    };
    const files = [
      { path: 'assets/sources/logo.png', size: 2000 },
      { path: 'assets/sources/deck.pdf', size: 3_000_000 },
      { path: 'assets/chat/notes.pdf', size: 1000 },
      { path: 'assets/images/sky.png', size: 9 },
    ];
    const list = sourcesOf(doc, files);
    expect(list.map((s) => [s.ref, s.kind])).toEqual([
      ['logo', 'image'], ['talk', 'video'], ['voice', 'audio'],
      ['assets/sources/deck.pdf', 'document'], ['assets/chat/notes.pdf', 'document'],
    ]);
    expect(list[0].size).toBe(2000);
    expect(list[2].name).toBe('voice');
    expect(list[3].name).toBe('deck');
  });

  it('reads the pages asked, within the document', () => {
    expect(pageRange(undefined, 12, 4)).toEqual([1, 2, 3, 4]);
    expect(pageRange('', 2, 4)).toEqual([1, 2]);
    expect(pageRange('3', 12, 4)).toEqual([3]);
    expect(pageRange('2,5, 7', 12, 4)).toEqual([2, 5, 7]);
    expect(pageRange('10-', 12, 4)).toEqual([10, 11, 12]);
    expect(pageRange('5-30', 8, 4)).toEqual([5, 6, 7, 8]);
    expect(pageRange('2-3,3-4', 12, 4)).toEqual([2, 3, 4]);
    expect(pageRange('nonsense', 12, 4)).toEqual([1, 2, 3, 4]);
  });

  it('knows a file by its type or its extension', () => {
    expect(kindOf({ name: 'Brochure 2026.PDF' })).toBe('document');
    expect(kindOf({ name: 'scan', type: 'application/pdf' })).toBe('document');
    expect(kindOf({ name: 'logo.svg' })).toBe('image');
    expect(kindOf({ name: 'clip.mov' })).toBe('video');
    expect(kindOf({ name: 'voice.m4a' })).toBe('audio');
    expect(kindOf({ name: 'notes.docx' })).toBe('file');
  });

  it('a document is a file of the project', () => {
    expect(pathIssue('assets/sources/deck.pdf')).toBeNull();
    expect(mimeOf('assets/sources/deck.pdf')).toBe('application/pdf');
    expect(pathIssue('plugins/deck.pdf')).not.toBeNull();
  });
});
