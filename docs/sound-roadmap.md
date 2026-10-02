# Sound roadmap

How the assistant comes to make the sound of a video, not only its picture: effects on the moments that matter (a whoosh on a transition, a hit on a title, a riser before a reveal), ambiences and short music beds. Today Claude does it when it works on a project from a terminal (Claude Code); the editor's assistant cannot.

Status: not started. Step 2 waits for one decision (code or recipe, see below). Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

In tramme a sound is always a file: an `audio` layer plays an asset from `start`, between its in and out points, at its `gain` (`packages/core/src/audio.ts`). There is no node that synthesises sound, and there should not be one: render time stays a pure function of time, and every export mixes files the same way.

So making a sound means making a file. From a terminal, Claude writes a script that computes the samples, saves a `.wav` under `assets/` and adds the layer. In the editor the assistant has no terminal, and none of its tools makes a sound:

- `write_file` writes text only: plugins (`plugins/*.js`, `*.mjs`) and data (`assets/*.json`, `*.svg`).
- The audio tools analyse or edit what is there (`beats`, `get_transcript`, `cut_media`); none creates audio.
- A detour exists (a plugin tool may write a binary file under `assets/` with `ctx.writeFile` and synthesise it with an `OfflineAudioContext`), but nothing tells the model, and it would be a hack.

What the editor already has covers most of the work: `OfflineAudioContext` mixing and a WAV encoder in `apps/editor/src/webexport.ts`, the editor tools mechanism (files under `assets/`, operations joining the proposal), the `audio` layer, and the `beats` analysis to land sounds on the music.

## Principles

- **Authoring time and render time are separate**, as for the plugins ([plugins-roadmap.md](plugins-roadmap.md#principles)). A sound is computed once, when the assistant or the user asks for it, saved as a WAV asset with what made it, and played by an `audio` layer. Rendering and exports do not change.
- **Reproducible.** What made a sound is kept next to it (its code or recipe, its seed), so it can be made again, changed and made again, and archives stay self-contained.
- **One mechanism for the assistant and the editor.** The sound tool is an editor tool like `beats` or `check`: the assistant calls it with `use_tool`, the user from the `/` menu. Its layer comes as a proposal: checked, previewed, undoable.
- **Nothing written twice.** The WAV encoder and the mixing move out of `webexport.ts` into a module the exports and the sound tool share.
- **The model hears with its eyes.** It cannot listen: the tool answers with a picture of the waveform and figures (peak, loudness, where the energy is), so it can judge levels and timing.

## Decision needed: code or recipe

How the model describes a sound to the tool.

| | Code | Recipe |
|---|---|---|
| What the model writes | A short function that builds the sound with Web Audio (oscillators, noise, envelopes, filters, notes) on an `OfflineAudioContext` | JSON: layers of oscillators and noise, envelopes, filters, notes, effects |
| What it can make | Anything Web Audio can, as in Claude Code | What the recipe format allows |
| Trust | The same as today's plugins, which the assistant already writes and the editor runs in the page | Nothing new runs |
| Cost to build | Small: run the code, encode, save | A format, its validation and its interpreter |

Recommendation: code, with a library of ready-made sounds (whoosh, hit, riser, click, pop, ambience) written once in that same form, so the model starts from good material. The recipe can come later as a safer mode for projects of unknown origin, together with plugin isolation (plugins roadmap, step 10).

## Steps

### Step 1. Shared audio plumbing

- [ ] Move the WAV encoder (`wav`) and the mixing (`mixAudio`) out of `apps/editor/src/webexport.ts` into a module of their own; the exports use it unchanged.
- [ ] A helper that saves a rendered `AudioBuffer` as a WAV asset and returns the operations adding the asset (and, when asked, its `audio` layer at a time, with a gain).

### Step 2. The `sound` tool

- [ ] Editor tool `sound` (vocabulary of the editor, `/sound` in the chat): input `{ name, duration, code | recipe, at?, gain?, seed? }`.
- [ ] Renders on an `OfflineAudioContext` (48 kHz, stereo), stopped by the turn's signal, with a time limit.
- [ ] Saves `assets/audio/<name>.wav` and what made it (`assets/audio/<name>.sound.json`), proposes the asset and the layer.
- [ ] Answers with a waveform picture and figures: peak, loudness, start and end of the energy.
- [ ] A sound made again (same name) replaces its file; the layers playing it reload.
- [ ] Library of ready-made sounds (whoosh, hit, riser, click, pop, ambience), each with its parameters.

Done when: asked for "a whoosh on each transition", the assistant makes one sound and proposes it at every transition, and the export plays it.

### Step 3. Sound in sync

- [ ] The tool places one sound at several times (`at` as a list), named by the document: layer entrances and exits, markers, cuts (`shots`), beats and bars (`beats`).
- [ ] Hits land on the frame: times rounded to the composition's frames.

### Step 4. Teaching the model

- [ ] System prompt, "Sound": when a video needs sound, which sounds for which moments, levels (effects under the voice, music beds low), no sound on every element.
- [ ] `ai` notes on the tool and on each ready-made sound.
- [ ] A `/sound-design` workflow: look at the key moments (`check`), propose a sound plan, make the sounds, place them, check the levels.

### Step 5. Checks

- [ ] Clipping and loudness of the mix (peak above 0 dBFS, a mix far too loud or too quiet).
- [ ] Sounds against picture: a hit far from the moment it belongs to, two hits on top of each other.

### Step 6. Mixing

Shared with the plugins roadmap (step 10, audio processing).

- [ ] Gain envelopes on `audio` layers (fades, ducking under a voice), mixed by the preview and the exports.
- [ ] EQ and reverb mixed with an `OfflineAudioContext` for exports.

### Step 7. Generated by providers

Shared with the plugins roadmap (step 8, generated assets): neither the terminal nor the editor can make these without a service.

- [ ] Voice-over from text (TTS) through the Worker, saved with its text, voice and provider.
- [ ] Music beds from a prompt through the Worker.

## Out of scope

- Sound synthesised at render time: the render stays a pure function of time, sounds are files.
- Editing recorded sound beyond cuts, gains and the mixing of step 6.

## Flagship results and what they need

| Result | Steps |
|---|---|
| Motion design with sound effects: whooshes on transitions, hits on titles, a riser before the reveal | 1, 2, 3 |
| Logo sting: a short designed sound on the logo's entrance | 1, 2 |
| Social clip with a music bed that ducks under the voice | 2, 6 |
| Explainer with voice-over and sound effects synced to the voice | 3, 6, 7 |
