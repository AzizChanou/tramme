# Plugins roadmap

Where the plugin system goes, and in what order. The goal is not only a richer vocabulary of layers: it is to give the built-in assistant what it needs to produce impressive videos on its own. The editor gets the same abilities, since the editor and the assistant share one API.

Status: steps 1 to 3, 6 and 9 done; steps 4, 5, 7 and 10 mostly done (masks, depth maps, phonemes, mask sequences, glTF, plugin isolation and audio processing left); steps 7b and 8 wait for decisions (a 3D library, the providers). Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

Today a plugin adds nodes, effects, modifiers, guided tours and translations (see [document.md](document.md#node-plugins)). The assistant writes the document as JSON Patch and checks it with stills. That is enough for simple motion design, not for striking results, because a model:

- composes building blocks and writes code well, but tunes pixels poorly and judges motion badly from one still;
- cannot see what matters in the material: where the face is, where the beats fall, where there is room for a title;
- has one feedback loop (`render_still`), with no way to measure what went wrong.

So the plugin system must extend three things, not one:

1. **What the assistant can perceive**: analyses of sound, video and images, saved as data.
2. **What it can build in one move**: high-level tools and recipes with good taste built in.
3. **How it checks its work**: quality checks and richer previews.

The renderer gains what those need (GPU effects, layer inputs, simulations, 3D).

## Principles

- **Authoring time and render time are separate.** Rendering stays a pure function of time (no network, no randomness, no state between frames). At authoring time a plugin may do anything the editor can: run a model, analyse a video, call a provider. What it computes is saved as project files (`assets/...json`, masks, depth maps, audio) and read by the render. The project stays self-contained and every render is reproducible.
- **One mechanism for the assistant and the editor.** A plugin tool is callable by the assistant and, later, from the editor's menus. Document changes always go through operations, so they are validated, previewed and undoable.
- **Plugins describe themselves to the model.** Every node, effect, modifier and tool can carry notes for the assistant: when to use it, what to avoid, values that look good.
- **The assistant's tool list stays fixed.** Plugin tools are reached through one generic tool (`use_tool`) and listed by `list_nodes`. The tool definitions sent to the model do not change with the project, which keeps prompt caching working on every path (companion, server, other providers).
- **Built-in features dogfood the system.** Templates, analyses and checks that ship with tramme are written as built-in plugins, with the same API as project plugins.

## The plugin module, once complete

```js
export const nodes = [...];       // layer types (render time)
export const effects = [...];     // layer and finishing effects (render time)
export const modifiers = [...];   // value modifiers (render time)
export const tools = [...];       // authoring tools for the assistant and the editor (step 1)
export const checks = [...];      // quality checks run after a change (step 3)
export const kits = [...];        // style kits: tokens, curves, recipe defaults (step 2)
export const tours = [...];       // guided tours (exists)
export const messages = {...};    // translations (exists)
export const meta = { name, version, api: 1 };   // manifest (step 10)
```

## Steps

### Step 1. Tools for the assistant, notes for the model

- [x] `tools` export: `{ name, title?, description, input (JSON Schema), ai?, run(input, ctx) }` (`packages/core/src/tools.ts`, registered by `Registry.use`).
- [x] `ctx` (authoring context): the live document (pending proposal included), composition, time and selection of the editor, the registry, `assetUrl`, `readText`, `writeFile` (under `assets/`), `renderStill`, `transcript`.
- [x] An abort signal in `ctx` (`ctx.signal`), so a long analysis stops with the turn.
- [x] A tool returns text, images (shown to the model and the user) and/or operations with a label. Operations join the pending proposal like any other, so they are validated and shown as a preview.
- [x] Assistant: one generic tool `use_tool { name, input }`; `list_nodes` lists the tools with their input schema; the system prompt explains when to use them.
- [x] `ai` notes (`when`, `avoid`, `example`) on nodes, effects, modifiers and tools, returned by `list_nodes`.
- [x] Docs (document.md, "Tools" under "Node plugins") with an example tool.
- [x] `ai` notes on the built-in nodes, effects and modifiers (`packages/nodes/src/notes.ts`, `packages/core/src/modifiers.ts`).
- [x] An example project, `examples/night-sky`: its plugin brings a node (`sky.moon`), a tool (`sky.stars`), a workflow (`sky.night`) and French names.

Done when: a project plugin exports a tool, the assistant finds it with `list_nodes`, calls it, and its operations show up as a proposal.

### Step 1b. The chat's `/` menu (brought forward from step 9)

- [x] Typing `/` in the chat lists the tools and workflows of the vocabulary (the editor's own and the project's plugins'), filtered as you type, keyboard and touch friendly.
- [x] A tool gets a form generated from its input schema (`format: 'asset'`, `format: 'layer'` for pickers). Required fields filled and nothing written after the command: it runs at once, without a model, and its changes come as a proposal. Words after the command: the request goes to the assistant, with the tool named and the fields already filled.
- [x] `prompts` export: workflows (instructions for the assistant for one kind of result) picked with `/name`.
- [x] Built-in: `/captions`, `/title`, `/keyword`, `/lower-third` (the templates as tools), `/dress` and `/review` (workflows). The editor's base vocabulary is `editorRegistry()` (`apps/editor/src/vocabulary.ts`).
- [x] A tool run alone is told to the assistant at the next message.
- [ ] More built-in commands as steps land: `/cut-silences`, `/transcript`, `/still`, `/beats`, `/cutout`.

### Step 2. Recipes and style kits

- [x] Recipes are tools that return operations, expanded into ordinary layers and keyframes that stay editable (`apps/editor/src/recipes.ts`): `kinetic-title` (rise, pop, slide, blur), `bar-chart`, `stat` (rolling figure), `transition` (wipe, circle, bars, flash).
- [ ] More recipes: map journey, word-by-word quote, logo reveal, list, timeline, split screen.
- [x] The built-in templates (captions, title, keyword, lower third) are also tools of the editor's vocabulary, with the same API. `apply_template` stays for the assistant.
- [x] `kits` export: a motion language as tokens (`plate`, `ink`, `accent`, `accent2`, `enter`, `exit`, `pace`, `stagger`) applied by the `kit` tool and read by the recipes. Built-in kits: editorial, punchy, calm, neon.
- [ ] Fonts in kits (a font file per kit, loaded with the project).

### Step 3. Quality loop

- [x] `checks` export: `run(ctx) → issues` with a severity, the times and layers involved; `ctx.samples` is the composition sampled 4 times a second, each layer placed in composition space (`packages/core/src/checks.ts`). Built-in: text size, reading time, safe zone, overlapping text, text crossing an element, crowded entrances, still stretches.
- [ ] Checks that need pixels or perception: low contrast behind text, text over a detected face (step 4).
- [x] `check` tool: runs the checks and returns a contact sheet of the key moments; `motion` tool: a strip of frames to judge a movement (`apps/editor/src/review.ts`). Both in the `/` menu too.
- [x] The system prompt asks for `check` before summing up; the `/review` workflow uses both tools.

### Step 4. Perception

Built-in plugins whose tools analyse the material at authoring time and save the result as `json` assets. Nodes, expressions and recipes read them.

- [x] Audio (`beats` tool, `analyseAudio` in `packages/core/src/analysis.ts`): tempo, beats, bars, onsets, sections, loudness of the whole and of three bands at 50 Hz. Pure DSP, deterministic, tested on synthetic grooves.
- [ ] Phonemes from the transcript (lip sync of drawn characters).
- [x] Video: shot changes (`shots` tool, colour histograms), people boxes over time (`subjects` tool, YOLOS tiny through transformers.js, loaded on demand).
- [ ] Video: pose, segmentation masks (subject cut-out), depth (they need step 5's layer inputs and mask sequences).
- [x] Image: main colours as tokens (`palette` tool: plate, ink, accent).
- [ ] Image: saliency and free space as data (the `subjects` text gives the free sides for now).
- [x] Render-time access: nodes read JSON assets with `host.asset(id)`; expressions with `audio(source)` (`pulse`, `barPulse`, `hit`, `energy`, `beat`, `bar`, `phase`, `section`), mapped to the time of a sound layer; the `react` modifier for the same without code. The renderer gives the evaluator the loaded analyses.
- [x] Checks read analyses: `text-over-subject` warns when text covers a face.
- [x] Models run in the browser at authoring time, never during a render; the system prompt says when to use each tool.

### Step 5. Rendering

- [x] Error isolation: in the preview (`isolate` renderer option), a node or effect that throws draws a red frame for its layer and is named in the error bar; the rest renders. Exports keep failing (checked with the CLI). The live preview test is still to do.
- [x] Finishing effects in GLSL (`gl: { code }`, `stage: 'finish'`): run by the compositor on the accumulated frame in linear light, before glow and grain (ping-pong targets). Built-in: `look.chromatic`, `look.grade`.
- [x] Layer effects in GLSL: a pass on the layer drawn alone, through one shared WebGL2 canvas (`packages/render/src/gpu.ts`); uniforms generated from the props schema, `uScale` for the preview size.
- [x] Layer inputs: the `layer` property type (validated, picked in the inspector); GLSL effects get it as a texture of that layer drawn alone, hidden or not; `host.drawLayer(ctx, id)` for nodes. Built-in: `fx.matte` (alpha, luma, inverted), `fx.displace`.
- [ ] Mask and depth sequences as assets, read per frame ("text behind the subject").

### Step 6. Time and state

- [x] Deterministic simulations: `simulate: { init, step }` on a node; the renderer steps from the in point, keeps a checkpoint every 10 frames and the last frame, and starts over after any change of the document. A frame rendered directly is byte-identical to the same frame reached after others (checked with the CLI).
- [x] `host.layer(id)`: evaluated props and transform of another layer; `host.state()` for the simulation.
- [x] Built-in `follow` node: a dot following another layer on a spring, with a trail.
- [ ] More simulated nodes: rope, cloth, flock, fluid, physics of rigid shapes.

### Step 7. 3D and camera

- [ ] A WebGL node service for plugins (own context, drawn into the layer).
- [ ] glTF models with animation, studio lighting, turntables, exploded views.
- [x] A virtual camera for 2.5D: `camera` on the composition (pan, zoom, perspective, focus, blur) and `transform.depth` on layers: parallax and depth blur, in the inspector and the schema.
- [ ] Photo to 2.5D from a depth map (step 4's depth).

### Step 8. Generated assets

- [x] Voice (TTS), music beds and sound effects through the Worker at authoring time, saved with their prompt and provider: the `generate-sound` tool ([sound-roadmap.md](sound-roadmap.md), step 8).
- [ ] Images and textures, background removal, the same way.

### Step 9. Editor surfaces

- [x] Plugin tools in the editor: the chat's `/` menu runs the same tools (form generated from the input schema), see step 1b.
- [x] Viewport handles declared by nodes (`handles(props)`: points and distances in local space), drawn as accent diamonds and dragged like the frame's handles (a key at the current time when animated). Built-in: the rectangle's corner radius; the example's moon radius.
- [x] Presets in the add menu (`presets` export, ready-made layers with effects and motion). Built-in: neon title, frosted card, light leak, spotlight.
- [ ] Effect-stack presets (several effects applied to the selection at once).
- [x] Export hooks (`export.svg`, `export.lottie`) so plugin nodes are not dropped from vector exports.

### Step 10. Ecosystem

- [x] `meta` manifest (`name`, `version`, `description`, `api`), the API version checked at load (`PLUGIN_API`): a newer plugin is refused with a clear message.
- [x] `@tramme/plugin` (`packages/plugin`): every type a plugin exports and `definePlugin()`.
- [x] A library of plugins shared between projects (`/api/library` in the Worker, R2 `library/plugins/`); tools `library-add` and `library-use` (assistant and `/` menu); a plugin is copied into the project when used, so archives stay self-contained.
- [ ] Isolation of untrusted plugins (worker with OffscreenCanvas) for projects from unknown sources.
- [x] Audio processing (gain curves, fades, low and high cut, reverb, speed) with one mixer for the preview and every export ([sound-roadmap.md](sound-roadmap.md), step 7); equaliser bands and a compressor left.

## Flagship results and what they need

| Result | Steps |
|---|---|
| Talking video turned into a clip: word-level karaoke captions, keywords punched in, auto zoom on the speaker, b-roll on topics | 1, 2, 3, 4 (faces) |
| Title behind the subject: the person cut out of the video, the title between them and the background | 1, 4 (segmentation), 5 (layer inputs, mask sequences) |
| Music video: cuts on beats, audio-reactive shaders, lyrics in kinetic type, mood change on each chorus | 1, 2, 4 (audio), 5 (GLSL) |
| Photo to 2.5D: depth map, camera moving into the picture, particles at several depths, depth of field | 4 (depth), 7 |
| Drawn character lip sync: phonemes drive the `drawing` property of a `sequence` | 1, 4 (phonemes) |
| Product in 3D: glTF turntable, studio light, exploded view, camera moves | 7 |
| Data story: CSV to animated charts, voice-over, highlights synced to the voice | 1, 2, 8 (voice) |
| Tracked callouts: a label or circle following an object in the video | 4 (tracking), 6 (`host.layer`) |
| Matter and transitions: shape morphs, liquid transitions, cloth, torn paper | 5, 6 |
