// The repository's examples, read at build time: their names, sizes and
// lengths describe the video slots that show them (components/Media.astro).

interface Manifest { name: string; width: number; height: number; duration: number }

const manifests = import.meta.glob<Manifest>('../../../../examples/*/tramme.json', { eager: true, import: 'default' });

export interface Example extends Manifest { id: string }

export const examples: Record<string, Example> = Object.fromEntries(
  Object.entries(manifests).map(([path, m]) => {
    const id = path.split('/').at(-2)!;
    return [id, { id, name: m.name, width: m.width, height: m.height, duration: m.duration }];
  }),
);

export function example(id: string): Example {
  const e = examples[id];
  if (!e) throw new Error(`no example ${id}`);
  return e;
}
