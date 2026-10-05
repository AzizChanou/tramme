# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until 1.0.0, the document format and the APIs may still change between minor versions.

## [Unreleased]

### Added

- Plugin tools: a project plugin can export `tools` that the assistant runs with `use_tool` (analyses, layouts, generators). A tool answers with text and images and may propose changes, which join the assistant's proposal.
- Notes for the assistant (`ai: { when, avoid, example }`) on nodes, effects, modifiers and tools; `list_nodes` and `tramme nodes` now list modifiers and tools too.
- Chat commands: typing `/` lists the tools and workflows (`/captions`, `/title`, `/keyword`, `/lower-third`, `/dress`, `/review`, and those of the project's plugins). A tool with its form filled runs at once, without a model; words after the command hand it to the assistant.
- Plugin workflows: a project plugin can export `prompts`, instructions for the assistant picked from the `/` menu.
- Quality checks: text too small, too brief or past the safe zone, overlapping text, text crossing an element, crowded entrances, still stretches. The `check` tool (assistant and `/check`) runs them and shows a contact sheet of the key moments; `motion` shows a strip of frames to judge a movement. Plugins add their own `checks`.
- Recipes: `kinetic-title`, `bar-chart`, `stat` and `transition` lay out whole animated pieces as editable layers; style kits (editorial, punchy, calm, neon) set the colours, curves and pace they follow. Plugins add their own `kits`.
- Perception tools: `beats` analyses music (tempo, beats, bars, sections, loudness per band), `shots` finds the cuts of a video, `subjects` finds the people in a video or an image (a small model run in the browser), `palette` turns the colours of a picture into tokens.
- Following the music: the `react` modifier and `audio()` in expressions make any property move with the beats, bars, hits or loudness of an analysed sound.
- Check `text-over-subject`: warns when text covers a face, once the people are known.
- Text behind the subject: the `cutout` tool (assistant and `/cutout`) cuts the person, or the main subject, out of a video layer with a small model run in the browser, saves the matte as a mask video timed like the file, and adds the same footage through that mask above the video. Titles placed between the two pass behind the person, in the preview and in every export.
- GPU effects: plugins write layer and finishing effects in GLSL; new built-in effects `fx.matte` (track matte from another layer), `fx.displace` (displacement map), `look.chromatic` (chromatic aberration), `look.grade` (colour grade in linear light). New property type `layer`.
- In the preview, a layer or effect that fails is drawn as a red frame and named in the error bar instead of blanking the whole picture.
- 2.5D camera: a composition can have a camera (pan, zoom, perspective, focus, depth blur) and layers a depth, for parallax and depth of field.
- Viewport handles declared by nodes (the rectangle's corner radius, plugin nodes' own points).
- Presets in the add menu: neon title, frosted card, light leak, spotlight; plugins add their own `presets`.
- Plugin nodes can say how they export to SVG and Lottie (`export.svg`, `export.lottie`).
- Plugin manifest (`meta` with the plugin API version, checked at load) and the `@tramme/plugin` package (types, `definePlugin()`).
- Plugin library shared by the projects: keep a project's plugin there and use it in another (`/library-add`, `/library-use`).
- Simulations: a node can carry a state from frame to frame (`simulate`), stepped deterministically with checkpoints; nodes read other layers with `host.layer()`. New `follow` node: a dot following a layer on a spring, with a trail.
- The assistant knows when each built-in node, effect and modifier fits (notes in `list_nodes`).
- Example project "Night sky": a project plugin with a node, a tool and a workflow.
- Plugins roadmap: `docs/plugins-roadmap.md`.
- Sound roadmap: `docs/sound-roadmap.md` (sound effects, ambiences and music made by the assistant in the editor).
- Sound library: 421 recorded sounds (Kenney's packs, CC0: impacts, interface, digital, jingles, sci-fi) measured and described in `sounds/catalog.json`, and 13 sounds written as code (whoosh, riser, sub boom, cinematic impact, glitch, sparkle…); your own sounds in a library shared by the projects (`/api/sounds`).
- Sound tools for the assistant and the `/` menu: `sfx` searches the library and places a sound on the moments the document names (entrances, exits, markers, cuts, beats, bars), its hit on the frame, its variants alternating; `synth` makes a sound from Web Audio code and answers with its waveform and measures; `duck` lowers music under a voice; `sound-keep` keeps a sound in the library; `generate-sound` has a provider make a sound effect, a music bed (ElevenLabs) or a voice-over (ElevenLabs, OpenAI, Gemini). The `/sound-design` workflow, and the assistant's guide for sound.
- The `generate-image` tool (assistant and `/generate-image`): a provider (OpenAI, Gemini, Z.AI) draws a picture the project lacks — a background a title reads over, a texture, an illustration, a prop — from its prompt, in the proportions of the composition; the file and what made it (`assets/images/<name>.image.json`: prompt, provider, model, proportions) join the project, the picture is proposed as an image layer (filling the frame or whole, over the whole composition or from a time, in the background on demand), and the tool answers with the picture so the assistant judges what was made. The keys stay in the Worker (`/api/generate-image`, `/api/config` lists the providers that draw); nothing is sent without the user's yes (the same setting as the paid sounds). The assistant's guide says when to have a picture made and why words never go in one (text layers say them).
- Generation roadmap: `docs/generation-roadmap.md` (pictures made by a provider, then takes, image to image, moving pictures, and what checks read in a picture).
- Motion figures: what the numbers of an animated property say (`packages/core/src/motion.ts`), sampled from the same evaluation the render uses — how far it travels, peak speed and when, evenness of the speed (1 is the linear tell), direction changes, how far it overshoots its end value, and when it settles. The `motion` tool answers with the figures of the span's biggest travels beside its strip of frames, so the assistant judges a movement with its numbers, not only the spacing. New checks that read them: `linear-travel` (a position or scale at constant speed for 0.3 s or more: ease it; a spring, a wiggle or any turn stays silent), `spring-settle` (a spring still moving when its layer leaves: more damping or more time; or overshooting its mark by more than 30%: one bounce is lively, more is nervous) and `twin-motion` (two layers whose positions follow the same series: offset, stagger or vary one). Motion roadmap: `docs/motion-roadmap.md`.
- Motion taste: the craft's rules, distilled from the public references of the field (the Animator's Survival Kit, Disney's twelve principles, the Material, Carbon and Apple motion systems, kinetic typography) and encoded where the engine acts on them. A "Motion" section in the assistant's guide: space before time (an even speed is the missing ease), entrances of 200 to 400 ms eased out and exits faster, one moving subject at a time with an uneven stagger, anticipation, arcs on the long travels, settles instead of hard stops, springs for what lands and curves for what intends, the reading time of text, and curves defined once as ease tokens (out, in, standard, emphasized, also named in `docs/document.md`). Three checks that read the figures: `abrupt-entrance` (the first move after a layer appears runs at full speed: ease it in), `straight-travel` (a big diagonal travel that keeps to its straight line: bend the move) and `uniform-stagger` (a group entering with even offsets: vary the gaps). The `/polish` workflow runs the whole loop on a composition: check and motion tools, the fixes the guide asks for, check again. The `bar-chart` recipe's fades now ease with the kit's curve. Taste roadmap and sources: `docs/taste-roadmap.md`.
- The `shorts` tool (assistant and `/shorts`): a long video as shorts, in two calls. First the candidates: the transcript grouped on pauses and sentence ends into passages that stand alone (15 to 45 s by default), each with its times and what is said. Then a plan of passages built into one composition per short: the video filling the asked format (vertical 1080×1920, square, horizontal) and starting at the passage's `start`, the transcript remapped to the short, saved as its own asset and captioned (the `captions` template), the title with its bar (the `title` template). Each short is an ordinary composition: editable, checked and exported like any other. The frame follows the speaker: `focus` on the video layer (the point of the picture kept at the centre of the frame, as the image layer had; animated, it follows the subject in a cropped frame), which the build animates across each short from the subjects analysis of the video when there is one — the biggest person of each analysed frame, held when nobody is found, drifts under 4 % of the picture ignored. The `/shorts` workflow, and the assistant's guide for shorts (a short stands alone, hooks in its first sentence, ends on a point). `transcriptIdOf` moved to `@tramme/core` with the rest of the transcript domain. Shorts roadmap: `docs/shorts-roadmap.md`.
- Sound layers: volume animatable (fades, ducking), `fadeIn`, `fadeOut`, `lowCut`, `highCut`, `reverb`, and `rate` (speed and pitch) on audio layers; the same but `rate` on the sound of videos.
- The `check` tool reads the mix: clipping, a mix far too loud or quiet, two sounds starting together.
- Sound settings (Settings, Sound): the preview's volume and mute (the exports keep the mix), the level of effects and music beds the tools place, how much a music drops under a voice, varying repeated sounds, asking before a paid sound (a dialog; nothing is sent to the provider without a yes), the provider and voice for voice-overs, and your sound library (listen, delete).
- Guided tour "Give the video its sound" (help menu): the library, asking the assistant, the `/` sound tools, sound layers and their properties, checking the mix, exporting with the sound.
- Assistant effort levels, chosen for each model next to the model menu and in the settings: Claude Opus and Sonnet (low to max, `high` by default, where Opus 5.5 alone would run at `medium`), and the reasoning models of the other providers (OpenAI o-series and GPT-5, Gemini 2.5 and later, OpenRouter models that reason, gpt-oss on a local server: low, medium, high, or the model's own default). A model that refuses its level runs at its own.
- The assistant tells you when it is done (Settings, Assistant): a notification from the system when the editor is in the background, a message in the editor after a long task.
- Automatic application of the assistant's changes (Settings, Assistant), turned on after a confirmation: a proposal is applied as soon as the turn is over, still checked first, shown in the conversation and undone with Ctrl+Z.
- Event lists: a JSON asset of timed events (`{ id, t, label, detail?, values, set? }`) that keep running totals: changes that add up (money in any currency, laughs, points, kilometres) or values an event sets (a weight, a temperature). Written by the `events` tool (assistant and `/events`) from lines such as `3.1 Petrol cash -18 | full tank` or `9 Weigh-in weight =72.5`, and totals written as they should look: `Cash: £23.67`, `0,00 €`, `Days: 0 day|0 days`, `Time: 0:00`. Expressions read it with `events()` (`.total()`, `.text()`, `.since()`, `.pulse()`, `.last()`…). `event-counter` puts the running totals in a corner, counters that roll at each change; `event-tags` a tag at each event (`PETROL −£18.00`, or the total it leaves; new `events.tag` node); `event-receipt` every event on a receipt typed line by line, then its totals (new `events.receipt` node). Every one of these layers reads the list as it renders: save the list again and they all follow. Example project "Road trip".
- Counters: `direction`, `down` rolls the digits back, for a value that goes down.
- Tracked callouts: the `track` tool (assistant and `/track`) follows something filmed through a video, framed by a rectangle drawn over it, a region of the picture or its name (person, car, dog… found by the detector), and saves where it is over time (`track-<video>-<name>`); a cut ends the track. The `callout` tool puts brackets and a label on it (new `callout` node) that stay on it, even when the video layer is moved or retimed. Expressions read where it is with `track(layer, name?)`.

### Changed

- Provider keys are connected in the editor, under Settings, Providers: Connect, Change key, Disconnect for Anthropic, OpenAI, Gemini, OpenRouter, Z.AI and ElevenLabs. The Worker keeps them in R2 and never sends them back; Cloudflare secrets still work, a key connected in the settings comes first.
- Custom providers: any service of the OpenAI chat format (DeepSeek, Groq, Mistral…) added by name, base URL and key; its models show in the model menu (`custom:<id>:model`).
- Settings in sections: a menu on the left (Editor: Appearance, Preview, Guided tours; Assistant: Model, Providers, Behavior, Connection) with a search that finds a setting whatever its section, the chosen section on the right; on a phone, the sections as tabs.
- The assistant's conversation with Claude is append-only: nothing already sent is rewritten, so the prompt cache stays warm and Claude's thinking stays valid. Old tool results are cleared by the API (context editing) once the conversation grows; the system prompt is cached for an hour.
- Lighter tool answers: `list_nodes` gives an index (properties as `name:type=default`, notes, tool inputs) and the full entries on demand (`types`), about 60% fewer tokens; `get_document` reads one part with `path`; `read_file` reads long files in parts (`offset`).
- Longer answers (64k tokens) on the server path; a request Claude declines goes to another model on the server (`fallbacks`), and the user is told when it is declined anyway.
- One mixer for the preview, the browser exports and the command line (`@tramme/render`): the command line mixes in its page and hands ffmpeg the finished track, instead of its own ffmpeg filter graphs.

### Fixed

- Expressions that read an analysis (`audio()`) or an event list (`events()`) now have their values in the inspector, the curves, the viewport's boxes and the assistant's `evaluate`, instead of neutral ones.
- On phones, the assistant's message box no longer slips under the tab bar when the conversation is long.
- Counters: separators and units (`,` `%` `€`) take their own width instead of a digit's.
- MP4 export: the H.264 configuration (avcC) is written from the stream itself. The one some encoders give (Media Foundation under Windows) was malformed, so Windows, QuickTime and phones refused the file ("format not supported") while Chrome and VLC played it.
- Assistant, server path: stopping during several tool calls no longer breaks the next message; a tool call whose input is invalid or cut off is no longer run with an empty input (the model is told and calls again); inputs are checked against each tool's schema on every path.
- Assistant, server path: a request part the API refuses (thinking display, context editing, effort…) is dropped on its own instead of turning off the thinking summary; retries wait as long as the server asks (`retry-after`).
- Assistant: a server that does not answer, or an answer whose stream breaks before anything was shown, is tried again by itself (twice) instead of ending the turn.
- 2.5D camera: a nested composition is drawn through its own camera (parallax and depth of field); it was ignored everywhere but in the root composition.
- Check `stillness`: a nested composition counts as playing, as a video does, instead of making its parent look frozen; its own still stretches are found when it is checked.
- Counters: digits share one cell again, as wide as the widest digit (the test looked for the letter "d", so each digit took its own width and the number shifted as it rolled); the `stat` and `bar-chart` recipes measure them the same way.
- `tramme pack` and `tramme unpack` check a project with its own plugins loaded, as the editor's import does; a project using plugin nodes (the night-sky example) was refused with "unknown node type".

## [0.1.0] - 2026-10-02

First public release.

### Engine

- JSON document as the source of truth: nested compositions, layers, groups, assets, design tokens, markers and sound. Format `tramme/1`, described in `docs/document.md`, with a JSON schema in `schema/tramme-1.schema.json`.
- Deterministic rendering: every frame is a pure function of time.
- Every property can be static, keyframed, an expression or a link, with an optional modifier stack (wiggle, loop, spring, offset, variation, smoothing).
- Open vocabulary: each layer type is a node that declares its property schema. The inspector and the validator are generated from it.
- Native nodes: shapes, path, image, text, counter, group, composition, particles, GLSL shader, code, sound, image sequence, video, captions.
- Layer effects: blur, shadow, glow, color, tint.
- Canvas2D layer renderer and WebGL2 compositor (motion blur, linear color, finishing).
- Project plugins: projects can add their own nodes, effects and modifiers as JS modules.

### Projects

- Project format `tramme-project/1` (manifest, allowed paths, checks), exchanged as `.tramme` archives. Projects created under the former names ("trame", "emotion") are still read.

### Editor

- Projects home: recent projects with thumbnails, new project (formats, frame rate, duration), project from a video, opening a `.tramme` file or a Lottie animation, examples.
- Viewport with zoom, pan, safe zones, grid, and direct manipulation (move, scale, rotate).
- Timeline (layer bars, keyframes, markers), Bézier curve editor, inspector generated from the schemas.
- Undo and redo for every change, autosave with conflict detection across tabs.
- Hand-drawn animation: image sequences held on twos or driven by an exposure sheet.
- Video layers decoded frame by frame with WebCodecs, speech transcription to timed captions.
- In-browser export: MP4 (H.264), WebM (VP9 with alpha), GIF, PNG sequence, Lottie, SVG still, WAV.
- Guided tours, settings (theme, preview quality), English and French interface.
- Mobile and touch support: tabbed panels under 760 px, a compact header with a "more" menu, pinch to zoom and two-finger pan in the viewport, larger touch targets, installable as a web app.

### Assistant

- AI assistant that edits the document through the same operations as the editor: proposals are previewed, then applied or rejected, and can be undone.
- Claude through a local companion (`tramme agent`, Claude Agent SDK) or through the server with an API key.
- Other providers: OpenAI, Gemini and OpenRouter through the server, local models (Ollama, LM Studio) from the browser.
- Image, sound and video attachments; video dressing (cuts, captions, templates).

### Command line

- `tramme` CLI: validate, still frames, offline rendering (MP4, MOV ProRes 4444, WebM with alpha, GIF, PNG, WAV) with headless Chrome and ffmpeg, Lottie and SVG export, Lottie import, pack and unpack, comparisons and benchmarks.

### Deployment

- Cloudflare Worker serving the editor and the API, projects stored in R2, access protected by Cloudflare Access.

[Unreleased]: ../../compare/v0.1.0...HEAD
[0.1.0]: ../../releases/tag/v0.1.0
