// A night sky, as a project plugin: a node (the moon), a tool the assistant
// and the chat's / menu can run (a star field), a workflow, and the French
// names of all three. Rendering stays a pure function of time.

export const meta = { name: 'sky', version: '1.0.0', description: 'a moon, a star field and a night scene', api: 1 };

/** a seeded random sequence: the same seed gives the same sky */
const random = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export const nodes = [{
  type: 'sky.moon', title: 'Moon', category: 'Shapes',
  description: 'a moon whose phase is a property',
  ai: { when: 'night scenes; animate phase for the passing of time', example: { radius: 90, phase: 0.3 } },
  props: {
    radius: { type: 'number', default: 90, min: 1, unit: 'px', label: 'Radius' },
    phase: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, label: 'Phase', description: '0: new moon, 0.5: full moon, 1: new moon again' },
    color: { type: 'color', default: '#F3EBD3', label: 'Color' },
    glow: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'Glow' },
  },
  path(p) { const s = new Path2D(); s.arc(0, 0, p.radius, 0, Math.PI * 2); return s; },
  bounds: (p) => ({ x: -p.radius, y: -p.radius, w: 2 * p.radius, h: 2 * p.radius }),
  // the radius, dragged in the viewport
  handles: (p) => [{ prop: 'radius', kind: 'distance', at: [p.radius, 0] }],
  // in SVG exports: the lit disc only, without its shadow
  export: { svg: (p) => `<circle cx="0" cy="0" r="${p.radius}" fill="${p.color}"/>` },
  render: {
    canvas2d(ctx, p) {
      const r = p.radius;
      if (p.glow > 0) {
        const g = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 3);
        g.addColorStop(0, `rgba(243,235,211,${0.28 * p.glow})`);
        g.addColorStop(1, 'rgba(243,235,211,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-r * 3, -r * 3, r * 6, r * 6);
      }
      // the lit part: the disc outside a second disc, the shadow, which slides
      // off to the left while waxing and comes back from the right while waning
      const shift = 2 * r * (1 - Math.abs(1 - 2 * p.phase));
      const outside = new Path2D();
      outside.rect(-2 * r, -2 * r, 4 * r, 4 * r);
      outside.arc(p.phase <= 0.5 ? -shift : shift, 0, r * 1.02, 0, Math.PI * 2);
      ctx.save();
      ctx.clip(outside, 'evenodd');
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    },
  },
}];

export const tools = [{
  name: 'sky.stars', title: 'Star field', description: 'scatters twinkling stars over the composition, under the other layers',
  input: {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, maximum: 300, title: 'Count' },
      seed: { type: 'integer', title: 'Seed' },
      top: { type: 'number', minimum: 0.1, maximum: 1, title: 'Height', description: 'part of the height covered, from the top (1: all of it)' },
    },
    required: ['count'],
  },
  ai: { when: 'a night sky, space, a festive background', avoid: 'more than 80 stars on a small format' },
  run({ count, seed = 7, top = 1 }, ctx) {
    const c = ctx.doc.compositions[ctx.compId], r = random(seed);
    const taken = new Set(Object.keys(c.layers)), ops = [], ids = [];
    for (let i = 0; ids.length < count; i++) {
      const id = `star-${i + 1}`;
      if (taken.has(id)) continue;
      const s = 2 + r() * r() * 7;
      ids.push(id);
      ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${id}`, value: {
        type: 'shape.ellipse', name: `Star ${ids.length}`,
        transform: {
          position: [Math.round(r() * c.width), Math.round(r() * c.height * top)],
          opacity: { $v: 0.55 + r() * 0.35, $mod: [{ type: 'wiggle', freq: 0.6 + r(), amp: 0.25, seed: i }] },
        },
        props: { size: [+s.toFixed(1), +s.toFixed(1)], fill: '#FFFFFF' },
      } });
    }
    ops.push({ op: 'replace', path: `/compositions/${ctx.compId}/order`, value: [...ids, ...c.order] });
    return { text: `${count} stars under the existing layers (seed ${seed}).`, ops, label: 'Star field' };
  },
}];

export const prompts = [{
  name: 'sky.night', title: 'Night scene', description: 'a whole night sky: gradient, stars, a rising moon',
  prompt: 'Build a calm night scene in this composition: a deep blue gradient background (a shape.rect covering the frame), a star field with the sky.stars tool, a sky.moon that rises slowly along an arc with its glow, and a short title if the user gives one. Check the result at the start and at the end.',
}];

export const messages = {
  fr: {
    Moon: 'Lune', 'a moon whose phase is a property': 'une lune dont la phase est une propriété',
    Radius: 'Rayon', Phase: 'Phase', Color: 'Couleur', Glow: 'Halo',
    '0: new moon, 0.5: full moon, 1: new moon again': '0 : nouvelle lune, 0,5 : pleine lune, 1 : de nouveau nouvelle lune',
    'Star field': "Champ d'étoiles", 'scatters twinkling stars over the composition, under the other layers': 'parsème des étoiles scintillantes sur la composition, sous les autres calques',
    Count: 'Nombre', Seed: 'Graine', Height: 'Hauteur', 'part of the height covered, from the top (1: all of it)': 'part de la hauteur couverte, depuis le haut (1 : toute)',
    'Night scene': 'Scène de nuit', 'a whole night sky: gradient, stars, a rising moon': 'tout un ciel de nuit : dégradé, étoiles, lune qui se lève',
  },
};
