# The tramme document (`tramme/1`)

A project is a JSON file `*.tramme.json`. It is the source of truth: the editor, the AI and the renderer read and change this file, nothing else. The JSON schema is in `schema/tramme-1.schema.json`.

## Structure

```jsonc
{
  "schema": "tramme/1",
  "meta": { "title": "Title", "description": "…" },
  "tokens": { "ink": { "type": "color", "value": "#1C1917" }, "swift": { "type": "ease", "value": [0.16, 1, 0.3, 1] } },
  "assets": { "photo": { "type": "image", "src": "img/photo.png", "box": [40, 225, 990, 960] } },
  "plugins": ["myNodes"],
  "root": "main",
  "compositions": {
    "main": {
      "name": "Film", "width": 1080, "height": 1920, "fps": 30, "duration": 12,
      "background": "@ink",
      "motionBlur": { "samples": 8, "shutter": 0.5 },
      "markers": [{ "id": "m1", "t": 3, "label": "Title", "kind": "scene" }],
      "effects": [{ "id": "grain", "type": "look.grain", "props": { "amount": 0.02 } }],
      "layers": { "title": { "type": "text", "props": { "text": "Hello" } } },
      "order": ["title"]
    }
  }
}
```

- Editable collections (`tokens`, `assets`, `compositions`, `layers`) are maps keyed by id (letters, digits, `_`, `-`). A patch path therefore stays valid when other items are added or removed.
- Order lives in arrays: `order` (root stack) and `children` (groups), **from bottom to top**: the last id is drawn on top.
- Each layer appears exactly once in the tree.
- Time is in seconds (composition time), space in composition pixels, rotations in degrees (clockwise), scale as a factor (1 = 100%), opacity from 0 to 1.

## Layers

```jsonc
{
  "type": "shape.rect",          // node type from the registry
  "name": "Background",
  "in": 2, "out": 6,             // visible from in (included) to out (excluded); default: the whole composition
  "visible": false,              // hidden; can still be used as a clip
  "clip": "mask",                // id of a layer with an outline that clips this one (same parent)
  "blend": "multiply",           // normal multiply screen overlay darken lighten add
  "transform": { "anchor": [0, 0], "position": [540, 960], "scale": [1, 1], "rotation": 0, "opacity": 1 },
  "props": { "size": [1080, 1920], "fill": "@ink" },
  "children": []                 // groups only
}
```

Local matrix: `translate(position) · rotate(rotation) · scale(scale) · translate(-anchor)`. A group's children are drawn in the group's local space. Rectangles, ellipses and image frames are **centered on the layer's origin**; text has its origin on the baseline.

## Properties: four forms

| Form | Example | Meaning |
|---|---|---|
| static | `12`, `[540, 960]`, `"#1C1917"` | the JSON value itself |
| keyframes | `{ "$k": [{ "t": 0, "v": 0, "ease": "@swift" }, { "t": 1, "v": 100 }] }` | interpolation; `ease` applies to the segment starting at the keyframe |
| expression | `{ "$expr": "value + Math.sin(t * 2) * 10" }` | pure JavaScript, evaluated at each time |
| link | `{ "$link": "title.size" }` or `{ "$link": "@ink" }` | the value of another property or of a token |

- Curves (`ease`): `"linear"` (default), `"hold"` (step), a CSS Bézier `[x1, y1, x2, y2]` (x between 0 and 1, y free to overshoot), or a curve token `"@swift"`.
- Keyframes are sorted by time. Outside the keyframe range, the value is that of the nearest keyframe.
- An expression can sit on top of keyframes: `{ "$k": [...], "$expr": "value * 2" }` (`value` is the interpolated value).
- Property address: `layerId.propName`, `layerId.transform.position`, `$comp.background`, `$comp.motionBlur.samples`, `$comp.effects.<effectId>.<prop>`.
- Keys starting with `$` are reserved.

### Colors and tokens

Wherever a color is expected (gradient stops included), `"@name"` refers to the color token `name`. Use tokens rather than hard-coded values: changing a token changes the whole film. A fill (`paint`) is a color, `null`, or a gradient in local coordinates:

```json
{ "type": "linear", "from": [-540, -960], "to": [-162, 960], "stops": [[0, "@goldA"], [1, "@goldB"]] }
{ "type": "radial", "center": [0, 0], "radius": 300, "stops": [[0, "#FFFFFF"], [1, "#00000000"]] }
```

### Expressions

A single expression (`value + 10`) or a body with `return`. Available names: `t` (= `time`), `frame`, `fps`, `value`, `comp` (`width`, `height`, `duration`, `fps`), `prop('layer.prop')`, `token('name')`, `marker('id|kind|label')` (`{ t, frame }`), `ease(spec, x)`, `clamp`, `lerp`, `prog(t, a, b)`, `smoothstep`, `linear(t, t0, t1, v0, v1)`, `random(seed)`, `noise(x, y, z)`, `add`, `sub`, `mul`, `Math` (without `Math.random`), and the modifiers below. An expression must stay a pure function of `t`: no state, no unseeded randomness, no access to the browser.

### Modifiers

An animated property (keyframes, expression or link) can get a stack of modifiers, applied in order: `"$mod": [{ "type": "wiggle", "freq": 2, "amp": 12 }]`. A modified fixed value is written `{ "$v": value, "$mod": [...] }`.

| Type | Parameters | Effect |
|---|---|---|
| `wiggle` | `freq` (Hz), `amp`, `seed`, `octaves` | adds smooth noise, different per component |
| `loop` | `mode`: `cycle`, `pingpong`, `offset`; `start`, `end` | repeats the keyframe animation beyond the last keyframe |
| `spring` | `freq` (Hz), `damping` (0 to 1) | each keyframe change becomes a spring's response (bounces when `damping` < 1) |
| `stagger` | `delay` (s), `from`: `first` or `last` | offsets the animation by the layer's rank among its siblings |
| `noise` | `amp`, `scale`, `seed` | fractal noise fixed in time (value texture) |
| `smooth` | `window` (s) | smooths the curve with a moving average |

## Built-in nodes

Each layer type declares its property schema; the inspector and the validator use it. Full list with defaults: the assistant's `list_nodes` tool, or `tramme nodes`.

| Type | Main properties |
|---|---|
| `shape.rect` | `size`, `radius`, `fill`, `stroke`, `strokeWidth` |
| `shape.ellipse` | `size`, `fill`, `stroke`, `strokeWidth` |
| `shape.path` | `path` `{ v, i?, o?, closed? }` (vertices, relative tangents), `fill`, `stroke`, `strokeWidth`, `lineCap`, `lineJoin` |
| `image` | `image` (asset), `size` (frame), `fit` (`cover`, `contain`, `fill`, `none`), `focus`, `zoom`, `offset`, `crop`, `box` |
| `sequence` | `frames` (list of image assets: the drawings in order), `hold` (frames per drawing, 2 = "on twos"), `sheet` (exposure sheet, e.g. `"1-4/2, 5/6, 4-1/2, x/3"`: drawings 1 to 4 held 2 frames, 5 held 6, then 4 to 1, then 3 blank frames; empty = every drawing held `hold`), `loop` (`loop`, `once`, `pingpong`), `offset` (frames of offset), `drawing` (0, or a forced drawing number: animate it with `hold` keyframes for a mouth), `size`, `fit`: frame by frame drawn animation, counted from the layer's in point |
| `text` | `text`, `font` (asset), `size`, `weight` (animatable), `italic`, `tracking` (em), `color`, `align`, `lineHeight`, `baseline` |
| `text.counter` | `from`, `to`, `progress` (0 to 1), `turns` + typography: a rolling counter |
| `group` | container: `children` |
| `comp` | `comp` (id of another composition), `time` (local time, animatable), `size`: nested composition |
| `particles` | deterministic emitter: `rate`, `life`, `speed`, `spread`, `gravity`, `size`, `color`, `seed` |
| `shader` | `shader` (fragment GLSL), `size`, `params`: an image made by a shader |
| `code` | `module` (JS asset), `entry`, `params`: free drawing by existing code |
| `audio` | `audio` (asset), `gain` (dB), `start`: a sound placed at the layer's in point |

Composition finishing effects (`effects`): `look.vignette` (`amount`), `look.grain` (`amount`, `seed`), `look.bloom` (`amount`, `threshold`), `look.exposure` (`value`). Layer effects (`layer.effects`): `fx.blur` (`radius`), `fx.shadow` (`color`, `blur`, `offset`), `fx.glow` (`color`, `radius`, `strength`), `fx.color` (`brightness`, `contrast`, `saturation`, `hue`), `fx.tint` (`color`, `amount`).

## Node plugins

A plugin is a JavaScript module (asset `type: "module"`, listed in `plugins`) that exports `nodes`, `effects`, `modifiers`, `tools` and/or `prompts` (and, if it wants, `tours`: guided tours of its nodes in the editor, see [tours.md](tours.md)):

```js
export const nodes = [{
  type: 'demo.star', title: 'Star', category: 'Shapes',
  props: {
    points: { type: 'number', default: 5, min: 3, step: 1, label: 'Points' },
    radius: { type: 'number', default: 200, unit: 'px', label: 'Radius' },
    fill: { type: 'paint', default: '#FFFFFF', label: 'Fill' },
  },
  // local outline: makes the layer selectable and usable as a clip
  path(p) { const s = new Path2D(); /* ... */ return s; },
  bounds(p) { return { x: -p.radius, y: -p.radius, w: 2 * p.radius, h: 2 * p.radius }; },
  render: {
    canvas2d(ctx, p, host) {
      // host.t (time), host.frame, host.width, host.height, host.asset(id), host.assetInfo(id)
      ctx.fillStyle = p.fill;
      ctx.fill(this.path(p));
    },
  },
}];
```

Property types: `number`, `vec2`, `bool`, `color`, `paint`, `enum` (`options`), `string`, `text`, `ease`, `path`, `asset` (`assetType`), `json`. Options: `default`, `label`, `group`, `min`, `max`, `step`, `unit` (`px`, `deg`, `%`, `em`, `s`, `x`, `dB`), `animatable: false`, `nullable`. Rendering receives the properties already evaluated at time `host.t`, in the layer's local space; it must stay a pure function of these values and of time.

Nodes, effects, modifiers and tools may carry notes for the assistant, returned by `list_nodes`: `ai: { when, avoid, example }` (when to use it, what looks bad, an example of props or input).

### Tools

A plugin may also export `tools`: actions the assistant runs with `use_tool`, at authoring time (never during a render). A tool may analyse the media, compute data and lay out whole dressings. It saves what it computes as files under `assets/`, and changes the document only by returning operations, which join the assistant's proposal (validated, previewed, undoable).

```js
export const tools = [{
  name: 'demo.stars', title: 'Star field', description: 'scatters stars over the composition',
  input: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['count'] },
  ai: { when: 'a night sky or a festive background', avoid: 'more than 60 stars on a small format' },
  async run({ count }, ctx) {
    // ctx: doc (with the pending proposal), compId, time, selection, registry,
    // assetUrl(id), readText(path), writeFile(path, data), renderStill(t), transcript(assetId)
    const ops = [/* JSON Patch operations on ctx.doc */];
    return { text: `${count} stars`, ops, label: 'Star field' };
  },
}];
```

`input` is a JSON Schema of an object; the input is checked against it before `run` (required keys, types, enums, bounds). `run` returns a string, or `{ text, images: [{ url, caption }], ops, label, reload }`: `images` are data URLs shown to the assistant and the user, `reload` lists assets whose files the tool rewrote.

Tools also appear in the chat's `/` menu, with a form generated from `input` (`title` as the label; `format: 'asset'` with `assetType` picks an asset, `format: 'layer'` a layer). Once the required fields are filled, the tool runs at once without a model; words written after the command send it to the assistant instead.

A plugin may also export `prompts`: workflows the user picks in the `/` menu, whose instructions guide the assistant for one kind of result.

```js
export const prompts = [{
  name: 'night', title: 'Night sky', description: 'a whole night scene',
  prompt: 'Build a night sky: a gradient background, a star field (demo.stars), a moon that rises slowly. Check the result at 0 s and at the end.',
}];
```

## Operations

Every change is a list of JSON Patch operations (RFC 6902) on JSON Pointer paths: `add`, `remove`, `replace`, `move`, `test`. For example, animating a layer's opacity:

```json
[{ "op": "add", "path": "/compositions/main/layers/title/transform/opacity",
   "value": { "$k": [{ "t": 0, "v": 0 }, { "t": 0.4, "v": 1, "ease": "@swift" }] } }]
```

`add` on an existing object key replaces it; on an array, it inserts at the index (`-` for the end). To add a layer: add `/compositions/<c>/layers/<id>`, then insert the id in `order` or in its group's `children`. To delete it: remove it from its array, then delete the entry (and its descendants). A batch is applied all or nothing, then validated; each batch is undone in one step.
