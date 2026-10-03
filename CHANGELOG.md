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
- Sound layers: volume animatable (fades, ducking), `fadeIn`, `fadeOut`, `lowCut`, `highCut`, `reverb`, and `rate` (speed and pitch) on audio layers; the same but `rate` on the sound of videos.
- The `check` tool reads the mix: clipping, a mix far too loud or quiet, two sounds starting together.
- Sound settings (Settings, Sound): the preview's volume and mute (the exports keep the mix), the level of effects and music beds the tools place, how much a music drops under a voice, varying repeated sounds, asking before a paid sound (a dialog; nothing is sent to the provider without a yes), the provider and voice for voice-overs, and your sound library (listen, delete).
- Guided tour "Give the video its sound" (help menu): the library, asking the assistant, the `/` sound tools, sound layers and their properties, checking the mix, exporting with the sound.
- Assistant effort levels, chosen for each model next to the model menu and in the settings: Claude Opus and Sonnet (low to max, `high` by default, where Opus 5.5 alone would run at `medium`), and the reasoning models of the other providers (OpenAI o-series and GPT-5, Gemini 2.5 and later, OpenRouter models that reason, gpt-oss on a local server: low, medium, high, or the model's own default). A model that refuses its level runs at its own.
- The assistant tells you when it is done (Settings, Assistant): a notification from the system when the editor is in the background, a message in the editor after a long task.
- Automatic application of the assistant's changes (Settings, Assistant), turned on after a confirmation: a proposal is applied as soon as the turn is over, still checked first, shown in the conversation and undone with Ctrl+Z.

### Changed

- Provider keys are connected in the editor, under Settings, Providers: Connect, Change key, Disconnect for Anthropic, OpenAI, Gemini, OpenRouter, Z.AI and ElevenLabs. The Worker keeps them in R2 and never sends them back; Cloudflare secrets still work, a key connected in the settings comes first.
- Custom providers: any service of the OpenAI chat format (DeepSeek, Groq, Mistral…) added by name, base URL and key; its models show in the model menu (`custom:<id>:model`).
- Settings in sections: a menu on the left (Editor: Appearance, Preview, Guided tours; Assistant: Model, Providers, Behavior, Connection) with a search that finds a setting whatever its section, the chosen section on the right; on a phone, the sections as tabs.
- The assistant's conversation with Claude is append-only: nothing already sent is rewritten, so the prompt cache stays warm and Claude's thinking stays valid. Old tool results are cleared by the API (context editing) once the conversation grows; the system prompt is cached for an hour.
- Lighter tool answers: `list_nodes` gives an index (properties as `name:type=default`, notes, tool inputs) and the full entries on demand (`types`), about 60% fewer tokens; `get_document` reads one part with `path`; `read_file` reads long files in parts (`offset`).
- Longer answers (64k tokens) on the server path; a request Claude declines goes to another model on the server (`fallbacks`), and the user is told when it is declined anyway.
- One mixer for the preview, the browser exports and the command line (`@tramme/render`): the command line mixes in its page and hands ffmpeg the finished track, instead of its own ffmpeg filter graphs.

### Fixed

- On phones, the assistant's message box no longer slips under the tab bar when the conversation is long.
- Counters: separators and units (`,` `%` `€`) take their own width instead of a digit's.
- MP4 export: the H.264 configuration (avcC) is written from the stream itself. The one some encoders give (Media Foundation under Windows) was malformed, so Windows, QuickTime and phones refused the file ("format not supported") while Chrome and VLC played it.
- Assistant, server path: stopping during several tool calls no longer breaks the next message; a tool call whose input is invalid or cut off is no longer run with an empty input (the model is told and calls again); inputs are checked against each tool's schema on every path.
- Assistant, server path: a request part the API refuses (thinking display, context editing, effort…) is dropped on its own instead of turning off the thinking summary; retries wait as long as the server asks (`retry-after`).
- Assistant: a server that does not answer, or an answer whose stream breaks before anything was shown, is tried again by itself (twice) instead of ending the turn.

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
