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
- Plugins roadmap: `docs/plugins-roadmap.md`.

### Fixed

- On phones, the assistant's message box no longer slips under the tab bar when the conversation is long.

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
