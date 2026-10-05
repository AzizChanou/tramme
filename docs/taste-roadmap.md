# Taste roadmap

How tramme gains the taste of a motion designer: the rules of the craft, distilled from the public references of the field and encoded where the engine can act on them. The goal: a simple request produces a result that already moves well, without the user asking for it.

Status: steps 1 to 7 done. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

A model writes keyframes but tunes motion poorly: it cannot see what it animates, and left alone it defaults to linear moves, even staggers and hard stops, the tells of amateur motion. The remedy is not one big rule but the craft's own, in the places where they act: a guide for the voice (what the assistant aims for), checks for the ear (what fires when it misses), workflows for the hand (a procedure it can run on demand), and defaults in the reference (the numbers it starts from). The figures of `packages/core/src/motion.ts` make the measurable half of the craft checkable; the rest lives as advice, because taste that cannot be measured must still be said.

## Principles

- **Distill, never copy.** The sources are read, their rules and public numbers are rewritten in our own words; no text is reproduced. The sources are listed at the bottom to trace each rule.
- **Numbers over adjectives.** 200 to 400 ms, 30 to 60 ms, one bounce: a rule the model can act on, not "make it feel nice". The thresholds of the checks agree with the numbers of the guide.
- **Said once, used everywhere.** The curves and durations live in the guide, in `docs/document.md`, in the templates and in the checks; when one changes, all follow.
- **The checks say what to do**, as the motion roadmap puts it: "ease it in", "bend the move", "vary the gaps".

## Steps

### Step 1. The guide (the voice)

- [x] A "Motion" section in the assistant's system prompt (`packages/assistant/src/index.ts`), beside the ones for sound, pictures and shorts: space before time (an even speed is the missing ease), entrance and exit durations and curves, one moving subject at a time with uneven stagger, anticipation, arcs, settles and follow-through, springs versus curves, reading time of text, exaggeration with restraint, ease tokens named once and referenced everywhere, and the loop: look at an important entrance with the `motion` tool and read the figures.

### Step 2. The checks (the ear)

- [x] `abrupt-entrance` (warning): the first move after a layer appears runs at full speed (`evenness` ≥ 0.92, no turn) over a position, a scale or an opacity worth judging. A hard cut (`hold`) stays silent, a spinner stays silent (rotation left out, as in `linear-travel`), one issue per layer at most.
- [x] `straight-travel` (note): a diagonal travel of 12 % of the frame or more that keeps to the straight line between its ends (`pathDeviation` ≤ 2 % of the chord). A slide along one axis is straight on purpose; an already bent path stays silent.
- [x] `uniform-stagger` (note): three elements or more of a group (or of the composition) entering with even offsets (gaps equal within 30 ms, between 40 and 400 ms). The even metronome is the tell; the gaps themselves stay in the guide's range.

### Step 3. The workflow (the hand)

- [x] The `/polish` prompt: check and motion tools first, then the fixes the guide asks for (eased entrances, faster exits, uneven stagger, arcs, settles), curves defined once as tokens, what already reads well kept, check again. The mechanical half of a polish pass runs without invention; the judgment stays with the model.

### Step 4. The defaults (the reference)

- [x] `docs/document.md` names the four curves (out, in, standard, emphasized) with their Béziers, to define once as tokens. The built-in templates (`apps/editor/src/templates.ts`) were audited against the guide and already follow it: out and in curves, uneven offsets, a bounce on the keyword, reading-sized holds.

### Step 5. The per-node sense

- [x] Notes per node family on what its movement should be, in `packages/nodes/src/notes.ts`: text moves as a whole block or word by word and never letter by letter, a counter rolls with an ease out over 0.8 to 1.6 s, a bar draws along its x, a path draws itself over 0.4 to 0.8 s, a callout's brackets follow without lag and its label settles a beat after, captions pop on the spoken word, a group staggers its children 30 to 60 ms with uneven gaps, footage drifts or zooms slowly (never both), a shader drifts on a period of 5 s or more. The model picks the curve and the duration from the node instead of guessing.

### Step 6. The kits

- [x] The four kits expose `standard` and `emphasized` beside `enter` and `exit`, flavored per kit (punchy overshoots, calm rounds, neon cuts, editorial unhurried); `style()` reads them, so every recipe that follows a kit speaks its four curves, and a punchy project and a calm one differ by their tokens.

### Step 7. What the checks cannot judge

- [x] Optical flow between two rendered stills (block matching on a downsampled luma grid, `apps/editor/src/flow.ts`), read by the `motion` tool beside the property figures: the whole-frame move and its speed in px/s, and the blocks that move differently from the whole, with where they sit (a crossing, something holding against a pan). Shared with motion-roadmap step 4.

## Sources

The rules come from these public references; the numbers of durations and curves from the motion systems, the principles from the animators'.

- Richard Williams, The Animator's Survival Kit (timing and spacing, slow in and out): chapter walkthrough at https://hecodeit.github.io/the-animators-survival-kit/01-timing-and-spacing/
- Disney's twelve principles, applied to interface and motion: https://www.adobe.com/creativecloud/video/discover/principles-of-animation.html and https://uxdesign.cc/12-basic-principles-of-animation-the-best-of-disney-9f242a4ee299
- Material motion, durations and easing tokens: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs and https://m2.material.io/design/motion/speed.html
- Carbon motion, productive versus expressive: https://carbondesignsystem.com/guidelines/motion/
- Apple, Human Interface Guidelines, Motion (physics, purposeful motion, restraint): https://developer.apple.com/design/human-interface-guidelines/motion
- Kinetic typography, reading speed and word timing: https://trydemotion.com/blog/kinetic-typography-masterclass
- The canon of easing curves: https://easings.net
- Craft articles on timing and spacing: https://motioncircles.com/knowledge/timing-vs-spacing-in-motion-design-what-matters-most and https://www.schoolofmotion.com/blog
