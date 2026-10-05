# Motion roadmap

How the assistant judges a movement from the document's numbers, not only from a strip of frames: how far a property travels, how fast at the peak, whether the speed is even (the linear tell), how often it turns, how far it overshoots and when it settles. Before this the `motion` tool showed the spacing of frames — enough to see that a movement feels wrong, not to say why, and the checks read positions at 4 samples a second, too coarse for an easing. Now the figures say it, and the checks use them.

Status: steps 1 to 3 and 5 done. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

A model composes keyframes well but tunes motion poorly: it cannot see the movement, one still says nothing about it, and a strip of frames must be read as spacing — a skill the models only approximate. What it does read well is numbers: "612 px over 0.6 s, peak 1620 px/s, speed even at 0.95" is a diagnosis it can act on (ease it, shorten it, add a bounce). The same figures make checks possible that no picture would reveal: a linear travel, a spring that never settles, two layers moving identically.

The figures come from the document, not from rendered pixels: the Evaluator samples the animated properties over the span (it is the same evaluation the render uses, so the figures are exact), and pure functions turn each series into figures. Rendering stays a pure function of time; the measures are computed at authoring time, when the tools run.

## Principles

- **Pure functions of the sampled series.** `packages/core/src/motion.ts` holds the figures (travel, peak speed, evenness, turns, overshoot, settle) and the sampling of a composition's animated addresses. No rendering, no state: the command line, the editor and the checks read the same numbers.
- **The figures serve two readers.** The `motion` tool shows them beside the strip of frames (the model judges with its eyes and its numbers); the quality checks read them (`linear-travel`, `spring-settle`, `twin-motion`). One sampling, one vocabulary.
- **Noise gates before verdicts.** A direction change under 5 % of the peak speed is not a turn; a travel under 8 % of the frame is not a movement worth judging. The thresholds live with the figures, so the checks and the tool agree.
- **The checks say what to do, not what is wrong.** "ease it (ease out on an entrance, ease in on an exit)", "more damping, or more time", "offset, stagger or vary one".

## Steps

### Step 1. The figures of a movement

- [x] `motionFigures` (scalar series: numbers or `[x, y]`, the component that travels most): span, change, travel, peak speed and when, evenness (mean speed over peak — 1 is the linear tell), turns (direction changes over the noise gate), overshoot (how far it passes its end value and comes back), settle (when it stays within 1 % of its travel from its end value from then on).
- [x] `animatedSlots` / `animatedAddresses`: the numeric properties of a composition that move (keyframes, an expression, a link or a modifier) — transform, node properties, layer and composition effects, the camera — with their definitions, so a caller can sample them.
- [x] `sampleAddress` and `motionReport`: one series, or the figures of every animated address over a span, biggest travels first.

### Step 2. The motion tool answers with its numbers

- [x] The strip of frames keeps its place (the eye judges the spacing); the answer adds the figures of the span's biggest travels, in the order the model should read them: how far, how fast, even or eased, turns, overshoot, settled or still moving. The guide line says what each figure is for.

### Step 3. The checks that read the figures

- [x] `linear-travel` (warning): a position or a scale travelling at a constant speed for 0.3 s or more over 8 % of the frame — ease it. Rotation is left out (a spinner is linear on purpose); a spring, a wiggle or any turn brings the evenness down and stays silent.
- [x] `spring-settle` (warning and note): a property with a spring modifier that has not settled when its layer leaves (more damping, or more time), or that overshoots its mark by more than 30 % (one bounce is lively, more is nervous).
- [x] `twin-motion` (note): two layers whose positions follow the same series over half a second or more — offset, stagger or vary one.

Done when: asked to make an entrance livelier, the assistant runs `motion` before and after, reads that the evenness went from 0.95 to 0.62 and the overshoot from 0 to one bounce of 12 %, and says so. Checked: the checks fire on a linear entrance and stay silent on an eased one, on a loose spring and not on a damped one, and the `/check` answer carries them.

### Step 4. What the properties miss

- [ ] Optical flow between the frames of the render: the movement of pixels catches what property figures cannot see — a crossing, a smear, a background moving when it should hold. It reads rendered stills (authoring time), so the render stays pure.

### Step 5. The judgment loop

- [x] The guide for motion: when to run `motion` (every entrance it writes), what good numbers look like per kind of move (an entrance eases out and settles before its layer's first word; a bounce overshoots 8 to 15 %, once), and when to stop (the figures improved, the strip confirms). Encoded as the assistant's "Motion" section, with the checks that fire when it misses and the `/polish` workflow that runs the loop on a whole composition: `docs/taste-roadmap.md`.

### Step 6. Motion sense per node

- [ ] Notes per node family on what its movement should be (a counter rolls, a receipt types line by line, a callout follows without lag): the assistant picks the curve and the duration from the node's `ai` notes instead of guessing.
