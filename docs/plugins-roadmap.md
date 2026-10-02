# Plugins roadmap

Where the plugin system goes, and in what order. The goal is not only a richer vocabulary of layers: it is to give the built-in assistant what it needs to produce impressive videos on its own. The editor gets the same abilities, since the editor and the assistant share one API.

Status: steps 1 and 1b in progress (the core of both is done). Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

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
- [ ] An abort signal in `ctx`, so a long analysis stops with the turn.
- [x] A tool returns text, images (shown to the model and the user) and/or operations with a label. Operations join the pending proposal like any other, so they are validated and shown as a preview.
- [x] Assistant: one generic tool `use_tool { name, input }`; `list_nodes` lists the tools with their input schema; the system prompt explains when to use them.
- [x] `ai` notes (`when`, `avoid`, `example`) on nodes, effects, modifiers and tools, returned by `list_nodes`.
- [x] Docs (document.md, "Tools" under "Node plugins") with an example tool.
- [ ] `ai` notes on the built-in nodes and effects, so the assistant uses them with taste.
- [ ] An example project in `examples/` whose plugin brings a tool.

Done when: a project plugin exports a tool, the assistant finds it with `list_nodes`, calls it, and its operations show up as a proposal.

### Step 1b. The chat's `/` menu (brought forward from step 9)

- [x] Typing `/` in the chat lists the tools and workflows of the vocabulary (the editor's own and the project's plugins'), filtered as you type, keyboard and touch friendly.
- [x] A tool gets a form generated from its input schema (`format: 'asset'`, `format: 'layer'` for pickers). Required fields filled and nothing written after the command: it runs at once, without a model, and its changes come as a proposal. Words after the command: the request goes to the assistant, with the tool named and the fields already filled.
- [x] `prompts` export: workflows (instructions for the assistant for one kind of result) picked with `/name`.
- [x] Built-in: `/captions`, `/title`, `/keyword`, `/lower-third` (the templates as tools), `/dress` and `/review` (workflows). The editor's base vocabulary is `editorRegistry()` (`apps/editor/src/vocabulary.ts`).
- [x] A tool run alone is told to the assistant at the next message.
- [ ] More built-in commands as steps land: `/cut-silences`, `/transcript`, `/still`, `/beats`, `/cutout`.

### Step 2. Recipes and style kits

- [ ] Recipes are tools that return operations: they expand into ordinary layers and keyframes that stay editable (kinetic title, word-by-word reveal, chart from a CSV, map journey, transitions).
- [x] The built-in templates (captions, title, keyword, lower third) are also tools of the editor's vocabulary, with the same API. `apply_template` stays for the assistant.
- [ ] `kits` export: a motion language (colour and curve tokens, durations, stagger, fonts, transition style) that recipes read, so "in style X" stays consistent across a film.

### Step 3. Quality loop

- [ ] `checks` export: `check(doc, ctx) → issues` with a severity and the times and layers involved. Built-in checks: text too small or on screen too briefly to read, low contrast, outside the safe zones, over a detected face, two elements entering at once, empty stretches.
- [ ] `review` tool for the assistant: runs the checks and returns a contact sheet (frames at key times on one image) and a motion strip (several sub-steps of one movement), so motion can be judged.
- [ ] The system prompt asks for a review before summing up.

### Step 4. Perception

Built-in plugins whose tools analyse the material at authoring time and save the result as `json` assets. Nodes, expressions and recipes read them.

- [ ] Audio: beats, onsets, tempo, sections (verse, chorus), energy per band over time; phonemes from the transcript (lip sync).
- [ ] Video: shot changes, subject and face boxes over time, pose, segmentation masks (subject cut-out), depth.
- [ ] Image: palette, saliency, free space for text.
- [ ] Render-time access: `host.data(assetId)` for parsed data, expression helpers (`beat()`, `energy(band)`, `track(id)`) that read these assets deterministically.
- [ ] Models run in the browser (transformers.js, as speech does today) or through the companion; never during a render.

### Step 5. Rendering

- [ ] Error isolation: a node or effect that throws draws a red frame for its layer and reports the error; the rest of the frame renders.
- [ ] Finishing effects from plugins: a GLSL pass run by the compositor on the accumulated frame (linear light). Today a plugin effect with `stage: 'finish'` is ignored (`finishOf` only knows the built-in `look.*`).
- [ ] GPU layer effects: a GLSL pass on the layer's own texture, through a shared WebGL service (`host.gpu`) extracted from the `shader` node.
- [ ] Layer inputs: a `layer` property type; an effect or node receives another layer rendered. Unlocks track mattes (alpha, luma), displacement, refraction, "text behind the subject" with a mask sequence.
- [ ] Mask and depth sequences as assets, read per frame.

### Step 6. Time and state

- [ ] Deterministic simulations: a node declares `simulate(state, props, dt)`; the engine caches one state per frame with checkpoints, so any frame can be rendered in any order (ropes, cloth, flocks, trails, fluids).
- [ ] `host.layer(id)`: read-only evaluated props and transform of another layer (connectors, followers).

### Step 7. 3D and camera

- [ ] A WebGL node service for plugins (own context, drawn into the layer).
- [ ] glTF models with animation, studio lighting, turntables, exploded views.
- [ ] A virtual camera with depth for 2.5D: layers at a depth, parallax, depth of field; photo to 2.5D with a depth map from step 4.

### Step 8. Generated assets

- [ ] Tools that call providers through the Worker at authoring time: images and textures, voice (TTS), music beds, background removal. Results are saved in the project with their prompt and provider, so they can be regenerated.

### Step 9. Editor surfaces

- [x] Plugin tools in the editor: the chat's `/` menu runs the same tools (form generated from the input schema), see step 1b.
- [ ] Viewport handles declared by nodes (`handles(props)`: points, radii, angles), dragged in the viewport.
- [ ] Presets in the add menu (layers and effect stacks).
- [ ] Export hooks (`export.svg`, `export.lottie`) so plugin nodes are not dropped from vector exports.

### Step 10. Ecosystem

- [ ] `meta` manifest with an API version, checked at load.
- [ ] `@tramme/plugin`: the types and a `definePlugin()` helper; the assistant writes plugins against it.
- [ ] A user library of plugins shared between projects; a plugin is copied into the project when used, so `.tramme` archives stay self-contained.
- [ ] Isolation of untrusted plugins (worker with OffscreenCanvas) for projects from unknown sources.
- [ ] Audio processing (EQ, reverb, gain envelopes) mixed in the browser with an `OfflineAudioContext` for exports.

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
