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

- Curves (`ease`): `"linear"` (default), `"hold"` (step), a CSS Bézier `[x1, y1, x2, y2]` (x between 0 and 1, y free to overshoot), or a curve token `"@swift"`. Four Béziers cover most moves; define them once as tokens and reference them: out `[0.16, 1, 0.3, 1]` for entrances, in `[0.7, 0, 0.84, 0]` for exits, standard `[0.4, 0, 0.2, 1]` for moves within the scene, emphasized `[0.2, 0, 0, 1]` for the expressive ones.
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

A single expression (`value + 10`) or a body with `return`. Available names: `t` (= `time`), `frame`, `fps`, `value`, `comp` (`width`, `height`, `duration`, `fps`), `prop('layer.prop')`, `token('name')`, `marker('id|kind|label')` (`{ t, frame }`), `ease(spec, x)`, `clamp`, `lerp`, `prog(t, a, b)`, `smoothstep`, `linear(t, t0, t1, v0, v1)`, `random(seed)`, `noise(x, y, z)`, `add`, `sub`, `mul`, `Math` (without `Math.random`), `audio(source)`, `events(source)` and `track(layer, name?)` (below), and the modifiers below. An expression must stay a pure function of `t`: no state, no unseeded randomness, no access to the browser.

### Camera (2.5D)

A composition may have a `camera`: `{ "pan": [x, y], "zoom": 1, "perspective": 1000, "focus": 0, "blur": 0 }`, all animatable. Each root layer then sits at its `transform.depth` (px behind the screen, negative in front): it is scaled by `zoom · perspective / (perspective + depth)` around the centre of the frame, so far layers move less when the camera pans (parallax), and blurred by `blur · |depth − focus| / 1000` px. A far layer looks smaller: scale it up to keep its size. Children follow their parent. Without a camera, depth does nothing.

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
| `react` | `source` (sound or video layer id, or asset), `signal` (`beat`, `bar`, `hit`, `rms`, `low`, `mid`, `high`), `amount`, `decay` (s) | adds `amount` times the music's signal: a pulse on each beat, bar or hit, or the loudness of a band |
| `near` | `source` (a layer, the pointer), `radius` (px), `amount` (in the property's unit), `axis` (`both`, `x`, `y`), `mode` (`lift`, `push`), `freq` (Hz), `damping` (0 to 1) | answers a moving layer: the value moves by `amount` as the pointer comes within `radius` (a smooth falloff), and springs back when it leaves. The layer and its pointer must sit in the same space (siblings, or a group at the origin); the layer's own rest position is the value the pointer moves |

### Following the music

Once a sound has an analysis (the `beats` tool saves it as the asset `analysis-<sound>`), expressions read it with `audio(source)`: `source` is the sound or video layer (times follow its in point and `start`), or the asset id. `audio('music').pulse(0.2)` is 1 on each beat and fades in 0.2 s; also `.barPulse(decay)`, `.hit(decay)`, `.energy('rms' | 'low' | 'mid' | 'high')` (0..1), `.beat`, `.bar` (ranks), `.phase` (0..1 inside the beat), `.section`. Without the analysis, every value is 0. For example a logo that kicks on each beat: `"scale": { "$v": [1, 1], "$mod": [{ "type": "react", "source": "music", "signal": "beat", "amount": 0.06, "decay": 0.18 }] }`.

### Event lists

A story that keeps score (money in any currency, laughs, points, kilometres, a weight, a time) keeps its events in one JSON asset, an event list, that several layers read: change the list and everything that tells the story follows. The `events` tool writes it (`assets/events/<name>.json`, asset `events-<name>`):

```json
{
  "version": 1, "kind": "events",
  "totals": { "cash": { "label": "Cash", "start": 23.67, "format": "£0.00" }, "weight": { "start": 75, "format": "0.0 kg" } },
  "events": [
    { "id": "petrol", "t": 3.1, "label": "Petrol", "detail": "Full tank", "values": { "cash": -18 } },
    { "id": "laugh", "t": 4.5, "label": "Laugh", "values": { "laughs": 1 } },
    { "id": "weigh-in", "t": 9, "label": "Weigh-in", "set": { "weight": 73.5 } }
  ]
}
```

- `t` is in seconds, in the time of the composition that reads the list. `values` add up: a running total is its `start` (0 by default) plus every change so far. `set` gives a total a value, whatever it was (a weight, a temperature); the change is the difference. A total that `totals` does not declare starts at 0.
- `format` writes a total: `0` is a digit always written, `#` one written when needed, the last `.` or `,` before digits is the decimal mark (a single `,` before three digits groups thousands): `£0.00`, `00`, `#,##0 pts`, `0,00 €`, `1 250 000 FCFA` from `# ##0 FCFA`. `0 day|0 days` gives the first form for one. `0:00` and `0:00:00` write seconds as a duration (`2:46`, `1:02:46`). Without a format, as many decimals as the values have. A loss gets a minus sign: `−£18.00`. Dates are not totals: put them in a label or a detail.

Expressions read it with `events(source)`, the asset id or the list's name: `.total('cash')`, `.text('cash', digits)` (written with its format, at least `digits` digits before the decimal mark), `.previous('cash')` (before its latest change), `.change('cash')` (that change), `.gains('cash')` and `.losses('cash')` (what it gained and lost so far), `.since(key?)` (seconds since the latest event, `Infinity` before the first), `.pulse(decay, key?)` (1 at each event, fading), `.last(key?)` and `.next(key?)` (the event, or null), `.find(id)`, `.count`, `.list`, `.keys`, `.format(value, key, { signed, digits })`, `.changes(event, key?)` (what an event of the list changed: `"−£18.00  +1"`), `.after(event, key?)` (the totals it left: `"£5.67"`), `.label(key)`. With a key, only the events that change that total count. Without the list, every value is neutral (0, `Infinity`, `"0"`). For example a logo that kicks at each event: `"scale": { "$expr": "add(value, mul([1, 1], 0.08 * events('events-main').pulse(0.25)))" }`; a title that names the latest event, a place or a mood rather than a number: `"text": { "$expr": "events('events-main').last()?.label ?? ''" }`.

Three tools show a list, each with layers that read it as they render: `event-counter` (the running totals in a corner: `text.counter` layers whose `from`, `to`, `progress` and `direction` are `events()` expressions), `event-tags` (an `events.tag` layer: a tag at each event, above the counters) and `event-receipt` (an `events.receipt` layer: every event, line by line, then the totals).

### Tracks

Where something filmed is over time. The `track` tool follows an object through a video once, framed by a rectangle drawn over it at the current time, a region of the picture, or its name for what the detector knows (person, car, dog, bicycle…), and saves a JSON asset `track-<video asset>-<name>` (`assets/tracks/…`):

```json
{ "version": 1, "kind": "track", "source": "clip", "name": "car", "width": 1920, "height": 1080,
  "frames": [{ "t": 3.2, "box": [0.479, 0.393, 0.068, 0.245] }, { "t": 3.3, "box": null }] }
```

Times are those of the file and boxes `[x, y, width, height]` fractions of its picture, `null` where the object was lost; a cut ends the track. Read through a video layer, a track follows that layer: moved, scaled or cut otherwise, the object stays under its callout. Expressions read it with `track(layer, name?)`, the video layer and the track's name (its first track without one): `.found` (0 to 1: 0 when lost, out of the track or out of the layer's frame), `.box` `[x, y, width, height]`, `.center` and `.size`, in the space the video layer sits in (the composition for a layer at the root). For example a dot that rides on the car: `"position": { "$expr": "track('video', 'car').center" }`. The `callout` tool adds a `callout` layer that reads the track: brackets around the object, a label beside them.

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
| `text.counter` | `from`, `to`, `progress` (0 to 1), `turns`, `direction` (`up`, or `down` to roll back for a value that goes down) + typography: a rolling counter |
| `events.tag` | `events` (event list asset), `key` (only the events that change this total), `show` (`change`, `total`: the total the event leaves, `label`), `hold` (s), `animation` (`pop`, `snap`, `rise`, `fade`), `uppercase`, `fill`, `padding`, `radius`, `gap` + typography: a tag at each event of the list, with what it changes |
| `callout` | `source` (the video layer), `track` (asset), `label`, `detail`, `side` (`auto`, `right`, `left`, `above`, `below`), `line`, `brackets` (`corners`, `box`, `none`), `padding`, `smooth` (s), `uppercase`, `fill`, `stroke`, `strokeWidth` + typography: brackets and a label that follow a tracked object, fading where it is lost; drawn in the space its video layer sits in (keep it beside the video, its transform at rest) |
| `events.receipt` | `events`, `title`, `subtitle`, `column` (`auto`, `detail`, `change`, `total`, `none`), `numbered`, `totals` (`"Spent: -cash; Change: cash"`: `-key` adds up the decreases, `+key` the increases), `interval` (s between lines), `typing`, `uppercase`, `lineHeight`, `paper`, `rule`, `highlight` (the last total), `width` (0: as wide as needed), `padding` + typography: every event on a receipt, typed line by line from the in point, then the totals; its origin is the middle, left or right of its top edge (`align`) |
| `group` | container: `children` |
| `comp` | `comp` (id of another composition), `time` (local time, animatable), `size`: nested composition |
| `particles` | deterministic emitter: `rate`, `life`, `speed`, `spread`, `gravity`, `size`, `color`, `seed` |
| `shader` | `shader` (fragment GLSL), `size`, `params`: an image made by a shader |
| `follow` | `target` (a layer), `frequency` (Hz), `damping`, `size`, `color`, `trail` (frames): a dot following another layer on a spring, drawn in composition space |
| `code` | `module` (JS asset), `entry`, `params`: free drawing by existing code |
| `audio` | `audio` (asset), `start`, `gain` (dB, animatable), `fadeIn`, `fadeOut` (s), `lowCut` (Hz, animatable), `highCut` (Hz, 0 for none), `reverb` (0 to 1), `rate` (speed and pitch, 1 as recorded), `role` (`effect`, `music`, `voice`, `ambience`), `weight` (`support`, `hero`), `visual` (what it underlines: `cut`, `move`, `land`, `appear`): a sound placed at the layer's in point |

The sound of a layer (an `audio` layer, or a `video` layer not `muted`) has the same properties but `rate`, `role`, `weight` and `visual`. `gain` moves (keyframes make fades and ducking: lower under a voice, back between sentences), and so does `lowCut` (a build: the music thinned out before a hit). A layer plays its file from `start` between its in and out points, inside those of its groups, the file going by `rate` seconds a second; filters, gain and fades apply in that order, the reverb beside them. `role` puts it on a bus: effects share the composition's room, music and ambience are the bed; unsaid, a video's sound is a voice, a sound named for music, an ambience or a voice is one, and any other an effect. `weight` and `visual` are read by the sound checks (a hero stands out more; an effect underlining a `move` should sit on one).

A composition's `sound` finishes its mix: `loudness` (LUFS, -14 by default: the master is brought to it, its true peak held under -1 dBTP; `null` leaves the mix as it is) and `room` (0 to 1, 0.15 by default: the share of one short room the effects have in common, so recordings from different places sound like one). The preview, the browser exports and the command line mix with one mixer (`@tramme/render`, `audio.ts`), so a sound is heard the same everywhere. Sounds are files: the editor's sound tools (library, sounds written as code, sounds made by a provider) save what they make under `assets/sounds/`, with what made it beside it (`<name>.sound.json`).

Composition finishing effects (`effects`): `look.vignette` (`amount`), `look.grain` (`amount`, `seed`), `look.bloom` (`amount`, `threshold`), `look.exposure` (`value`), `look.chromatic` (`amount` px), `look.grade` (`lift`, `gain`, `saturation`, `temperature`). Layer effects (`layer.effects`): `fx.blur` (`radius`), `fx.shadow` (`color`, `blur`, `offset`), `fx.glow` (`color`, `radius`, `strength`), `fx.color` (`brightness`, `contrast`, `saturation`, `hue`), `fx.tint` (`color`, `amount`), `fx.matte` (`source`: a layer, `mode`: `alpha`, `alpha-inverted`, `luma`, `luma-inverted`), `fx.displace` (`source`: a layer whose red and green push x and y, `amount` px).

A track matte: the layer shows only where `source` is. The matte layer is usually hidden (`visible: false`): it is still drawn for the effect, at the same instant, with its own animation. For example footage seen through a big title: the title hidden, the video with `{ "id": "m", "type": "fx.matte", "props": { "source": "title", "mode": "alpha" } }`.

Text behind a person works the other way round: the `cutout` tool saves the person's matte as a mask video (white where they are, timed like the file, under `assets/cutout/`), then adds two layers right above the video: the mask, hidden, and the same footage through it (`fx.matte` in `luma` mode). Both follow the video's frame and transform through links. Whatever sits between the video and these two in the stack passes behind the person.

## Node plugins

A plugin is a JavaScript module (asset `type: "module"`, listed in `plugins`) that exports `nodes`, `effects`, `modifiers`, `tools`, `prompts`, `checks` and/or `kits` (and, if it wants, `tours`: guided tours of its nodes in the editor, see [tours.md](tours.md)):

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

Property types: `number`, `vec2`, `bool`, `color`, `paint`, `enum` (`options`), `string`, `text`, `ease`, `path`, `asset` (`assetType`), `layer` (another layer of the composition, drawn alone for an effect: mattes, maps), `json`. Options: `default`, `label`, `group`, `min`, `max`, `step`, `unit` (`px`, `deg`, `%`, `em`, `s`, `x`, `dB`), `animatable: false`, `nullable`. Rendering receives the properties already evaluated at time `host.t`, in the layer's local space; it must stay a pure function of these values and of time.

A node may also simulate: `simulate: { init(props, host), step(state, props, dt, host) }` carries a state from frame to frame (springs, ropes, flocks, trails). The engine steps it in order from the layer's in point at the composition's frame rate and keeps checkpoints, so any frame renders in any order and always gives the same picture; `step` returns a new state and never changes the one it is given. Rendering reads it with `host.state()`. `host.layer(id)` gives another layer's evaluated props and transform at the same instant (connectors, followers). The built-in `follow` node is an example: a dot following another layer on a spring.

A plugin should say who it is: `export const meta = { name, version, description, api: 1 }`. `api` is the plugin API it was written for; a tramme with an older API refuses the plugin with a message rather than failing halfway. In TypeScript or with JSDoc, `@tramme/plugin` gives every type and `definePlugin()` for autocompletion.

A plugin can be kept in the library shared by the projects (`library-add` tool, `/library-add`) and used in another project (`library-use`): it is copied into the project's `plugins/`, so the project and its archive stay self-contained.

A node may declare `handles(props)`: points the viewport lets the user drag, in local space, each editing one property (`{ prop, at, kind: 'point' }` sets a vec2 to the point; `{ prop, at, kind: 'distance', from }` sets a number to the distance from `from`). Vector exports cannot run code: `export: { svg(props), lottie(props) }` gives SVG markup in local space and static Lottie shape items; without them the layer is left out with a warning.

A plugin may also export `presets`, ready-made layers offered in the add menu: `{ name, title, category, layer }` where `layer` is an ordinary layer (type, props, transform, effects), centred when it has no position.

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
    // assetUrl(id), readText(path), files(), fileUrl(path), writeFile(path, data), renderStill(t), transcript(assetId)
    const ops = [/* JSON Patch operations on ctx.doc */];
    return { text: `${count} stars`, ops, label: 'Star field' };
  },
}];
```

Effects can be written in GLSL: `gl: { code }` defines `vec4 effect(vec2 uv)`, reading `uImage` (premultiplied), `uRes` (pixels), `uScale` (pixels per composition pixel), `uTime`, and `u_<prop>` for each property (`float` for number, bool and enum (its rank), `vec2`, `vec4` for a colour, `sampler2D` for a `layer` prop). On a layer (`stage: 'layer'`) it runs on the layer drawn alone; as a finishing effect (`stage: 'finish'`), on the composed frame in linear light, before the glow and the grain.

```js
export const effects = [{
  type: 'demo.scanlines', title: 'Scanlines', category: 'Finishing', stage: 'finish',
  props: { amount: { type: 'number', default: 0.3, min: 0, max: 1 } },
  gl: { code: `vec4 effect(vec2 uv) { vec4 c = texture(uImage, uv); return c * (1.0 - u_amount * step(0.5, fract(uv.y * uRes.y / (3.0 * uScale)))); }` },
}];
```

In the editor's preview, a node or effect that fails is drawn as a red frame and named in the error bar; the rest of the frame renders. Exports and stills keep failing, so a broken film is never delivered.

`input` is a JSON Schema of an object; the input is checked against it before `run` (required keys, types, enums, bounds). `run` returns a string, or `{ text, images: [{ url, caption }], ops, label, reload }`: `images` are data URLs shown to the assistant and the user, `reload` lists assets whose files the tool rewrote.

Tools also appear in the chat's `/` menu, with a form generated from `input` (`title` as the label; `format: 'asset'` with `assetType` picks an asset, `format: 'layer'` a layer). Once the required fields are filled, the tool runs at once without a model; words written after the command send it to the assistant instead.

A plugin may also export `checks`: quality checks run by the `check` tool (assistant and `/check`) next to the built-in ones (text size, reading time, safe zone, overlapping text, text crossing an element, crowded entrances, still stretches). A check reads the composition sampled four times a second, each layer placed in composition space, and returns issues:

```js
export const checks = [{
  name: 'brand.logo', description: 'the logo stays on screen',
  run({ samples, comp }) {
    const missing = samples.filter((s) => !s.layers.some((p) => p.id === 'logo' && p.opacity > 0.5));
    return missing.length ? [{ check: 'brand.logo', severity: 'warning', t: missing[0].t, message: `the logo is missing at ${missing[0].t} s` }] : [];
  },
}];
```

Each sample is `{ t, layers }`; a placed layer has `id`, `layer`, `node`, `props`, `opacity` (with its parents'), `box` (composition pixels) and, for text, `text` and `textSize` (the height of the type on screen).

A plugin may also export `kits`: style kits applied by the `kit` tool, as design tokens. The recipes (`kinetic-title`, `bar-chart`, `stat`, `transition`) and the dressings read these token names: `plate`, `ink`, `accent`, `accent2` (colours), `enter`, `exit` (curves), `pace` (seconds of an entrance), `stagger` (seconds between siblings).

```js
export const kits = [{
  name: 'brand', title: 'Our brand', description: 'navy and coral, brisk',
  tokens: { plate: { type: 'color', value: '#0B1B3F' }, ink: { type: 'color', value: '#FFFFFF' }, accent: { type: 'color', value: '#FF6F59' },
    enter: { type: 'ease', value: [0.16, 1, 0.3, 1] }, pace: { type: 'number', value: 0.5 }, stagger: { type: 'number', value: 0.05 } },
}];
```

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
