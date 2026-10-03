# Sound roadmap

How the assistant makes the sound of a video, not only its picture: effects on the moments that matter (a whoosh on a transition, a hit on a title, a riser before a reveal), ambiences, music beds and voice-overs. Before this plan Claude did it from a terminal (Claude Code), writing scripts that computed WAV files; the editor's assistant could not.

Status: steps 1 to 8 done. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

In tramme a sound is always a file: an `audio` layer plays an asset from `start`, between its in and out points (`packages/core/src/audio.ts`). There is no node that synthesises sound at render time, and there should not be one: rendering stays a pure function of time.

So making a sound means making a file. From a terminal, Claude writes a script; the editor's assistant had no terminal, `write_file` writes text only, and its audio tools only analysed (`beats`, `get_transcript`, `cut_media`).

A model cannot hear. Designing a sound blind (synthesis) has a low ceiling for anything realistic; choosing among described recordings is what it does well, the way a motion designer works with a sound library. Hence the order: recordings first, code for what they lack, providers for what neither can make.

## Principles

- **Authoring time and render time are separate**, as for the plugins ([plugins-roadmap.md](plugins-roadmap.md#principles)). A sound is made once, saved as an asset with what made it (`assets/sounds/<name>.sound.json`: its code and seed, or its prompt and provider), and played by an `audio` layer.
- **One mixer.** The preview, the browser exports and the command line mix with the same code (`packages/render/src/audio.ts`): filters, gain curves, fades, reverb, speed sound the same everywhere. The command line mixes in its page and hands ffmpeg the finished track.
- **One mechanism for the assistant and the editor.** The sound tools are editor tools: the assistant calls them with `use_tool`, the user from the `/` menu. Their layers come as a proposal.
- **The model hears with its eyes.** Every sound carries measures (`soundFigures` in `@tramme/core`): length, the moment it lands on, peak, loudness, where its sound starts and ends. The tools answer with them, and with a waveform picture.
- **The landing moment goes on the frame.** A hit, the pass of a whoosh, the top of a riser: placed so that moment falls on the time asked for, not the file's start.

## Steps

### Step 1. Shared audio plumbing

- [x] The sound of a layer read once (`audioClips`): gain and its curve (animated `gain`), `fadeIn`, `fadeOut`, `rate`, `lowCut`, `highCut`, `reverb`, on audio layers and the sound of videos (`packages/nodes/src/sound.ts`).
- [x] One mixer (`clipChain`, `playClip`, `mixComposition`, `encodeWav`) used by the preview, the browser exports and the command line; the two ffmpeg filter graphs of the command line removed.
- [x] Measures of a sound (`soundFigures`): what the tools, the catalog and the checks read.

### Step 2. The sound library

- [x] 421 recordings from Kenney's packs (CC0, public domain): impacts, interface sounds, digital sounds, jingles, sci-fi, UI (`sounds/`, 5.2 MB), measured in Chrome by `scripts/sound-library.ts` into `sounds/catalog.json`, shipped with the editor.
- [x] Sounds written as code where the recordings lack (`apps/editor/src/sound-presets.ts`): whoosh, swoosh, riser, reverse swell, sub boom, cinematic impact, thump, pop, tick, glitch, sparkle, power down, room tone.
- [x] One format for every source (`SoundEntry`, `packages/core/src/sounds.ts`) and a search by words with the kinds' synonyms, one sound per family (`searchSounds`).
- [x] The user's own library shared by the projects (`/api/sounds`, R2 `library/sounds/`, a sound's description kept in its metadata), with the plugin library on one shelf mechanism; `sound-keep` puts a project's sound there.
- [x] `sfx` tool: search, then place a sound on moments, its variants alternating, a lone sound's speed varied slightly when it repeats; copied into the project.
- [ ] More recordings: whooshes and risers recorded rather than synthesised, foley (paper, cloth, footsteps), ambiences.

Done when: asked for "a whoosh on each transition", the assistant finds one and proposes it at every transition, and the export plays it. Checked in Chrome: hits placed on the frame, MP4 with its AAC track, WAV loud at the right instants.

### Step 3. Sound in sync

- [x] Moments named by the document (`momentsOf`): `now`, `entrances`, `exits` (of the layers given, or every visible one), `markers`, `cuts` (between video layers and from the `shots` analysis), `beats` and `bars` (from the `beats` analysis, where the music's layer plays it), on the composition's frames.
- [x] Aligned on the landing moment (`peak`) or the start (`start`, by default for music, voices, jingles, ambiences).

### Step 4. Sounds written as code

- [x] `synth` tool: Web Audio code on an `OfflineAudioContext` (`renderSynth`) with a kit: seeded `random`, `noise` (white, pink, brown), `env` (linear or exponential ramps); brought to a -1 dBFS peak; answers with its waveform and measures; the code and seed saved beside the file.

### Step 5. Teaching the model

- [x] System prompt, "Sound": which moments, the library first, code for what it lacks, a provider once, the levels, ducking, checking the mix.
- [x] `ai` notes on every sound tool; the `/sound-design` workflow.

### Step 6. Checks

- [x] The `check` tool reads the mix: clipping, a mix far too loud or too quiet, two short sounds starting together.
- [ ] Sounds against picture: a hit far from the moment it seems to belong to.

### Step 7. Mixing

Shared with the plugins roadmap (step 10, audio processing).

- [x] Gain curves (keyframes on `gain`), fades, low and high cut, reverb, speed: in the preview and every export.
- [x] `duck` tool: the music lowered under each stretch of a transcript's speech, back between sentences.
- [ ] Equaliser bands beyond the two cuts; a compressor on the mix.

### Step 8. Made by providers

Shared with the plugins roadmap (step 8, generated assets).

- [x] `generate-sound` tool through the Worker (`/api/generate`, keys kept on the server): sound effects and music beds (ElevenLabs), voice-overs (ElevenLabs, OpenAI, Gemini); saved with their prompt, provider, model and voice; optionally kept in the library.
- [ ] Tried against the real providers (the tests answer for them; it costs money on each).

## Out of scope

- Sound synthesised at render time: sounds are files.
- Editing recorded sound beyond cuts, gains, fades, filters and reverb.

## Flagship results and what they need

| Result | Steps |
|---|---|
| Motion design with sound effects: whooshes on transitions, hits on titles, a riser before the reveal | 2, 3 |
| Logo sting: a recorded jingle or a designed sound on the logo's entrance | 2, 4 |
| Social clip with a music bed that ducks under the voice | 7, 8 |
| Explainer with voice-over and sound effects on the cuts | 3, 7, 8 |
