# Shorts roadmap

How a long video becomes shorts: an hour of someone speaking holds its best moments out of order, and cutting them by hand is an evening of scrubbing, reframing and re-titling. Here the assistant reads the transcript, picks the passages that stand alone, and the tool builds one composition per short — the video framed for the format, the captions on it, a title. Each short is an ordinary composition of the project: editable, checked, exported like any other.

Status: step 1 done. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

Cutting a short is mechanical (a time range, a format, a reframe, captions, a title) wrapped around one decision that is not: which forty seconds are worth watching. The model reads a transcript well — finding the self-contained idea with a hook in its first sentence is what it is good at — and judges badly what it cannot see. So the split of work: the tool groups the transcript into passages and builds; the model chooses among the passages, and says why. No energy heuristics decide in its place in step 1; they come later, for videos nobody speaks in.

## Principles

- **The model picks, the tool builds.** The candidates call answers with times and what is said — never builds. The build call takes an explicit plan (from, to, title) and does the rest. Taste stays with the model, mechanics with the code, and the user sees both (the candidates in the conversation, the build as one proposal).
- **A short is a composition, not an export.** Nothing is rendered by the tool: the ops add a composition with ordinary layers. The user can move the frame, reword the title, change the captions; `check` runs on it; the export is the normal one.
- **The transcript rides along.** Each short gets the source transcript remapped to its passage (`remapTranscript`, file time to composition time), saved as its own asset, and the captions read that — so a re-cut of the source does not silently desynchronise a short.
- **One mechanism.** The tool is reached with `use_tool` and from the `/` menu like the others; document changes go through operations.

## Steps

### Step 1. The shorts tool

- [x] Candidates (`apps/editor/src/shorts.ts`): the transcript grouped on pauses and sentence ends into passages of a asked span (15 to 45 s by default), each with its times, what is said and a little air on both sides. The answer names the trade: a short that starts mid-idea is skipped, not rescued.
- [x] Build: one passage of the plan → one composition in the asked format (vertical 1080×1920, square, horizontal), the source composition's frame rate, the video layer filling the frame (`cover`) and starting at the passage's `start`, the transcript remapped, written and captioned (the `captions` template), the title with its bar (the `title` template). The templates build against the document as the proposal will make it, so their layers stack in the right order.
- [x] The `/shorts` workflow and the assistant's guide: read the candidates, pick with a reason, build, then check each short.

Done when: asked to cut 3 shorts from a long talk, the assistant lists the candidates with what is said, picks three and says why, and the proposal adds three compositions — video filling a 9:16 frame, captions on the remapped transcript, title on top — each of which exports as it is.

### Step 2. The frame follows the subject

- [x] `focus` on the video layer (the image layer had it; the video node kept a centred cover): the point of the picture kept at the centre of the frame, animatable, the edges never shown.
- [x] The build reads the subjects analysis of the video (`subjects-<asset>`) when there is one and animates the focus across the short: the biggest person of each analysed frame, held when nobody is found, drifts under 4 % of the picture ignored (a nervous pan is worse than a slow one).
- [ ] The zoom settling on the subject when the picture allows it (a face small in the frame gains from a gentle push-in), and the cutout matte as the fallback when the boxes jump.

### Step 3. The hook

- [ ] The first two seconds decide whether a short is watched: the title lands while the first sentence is still starting, a keyword pops on the strong word, the guide says what a good short opens with (a claim, a number, a question — never "in this video"). A progress bar and an end card where the project has a brand.

### Step 4. The batch

- [ ] A contact sheet of the shorts side by side (the check tool's sheet, one cell per short), the checks run on each composition, and an export queue: all the shorts, in one go, named after their titles.

### Step 5. Candidates without speech

- [ ] A match, a ride, a build-up: videos nobody speaks in get their candidates from the beats analysis (loud moments, section changes) and the shots tool (cuts), described the same way so the model picks among them unchanged.
