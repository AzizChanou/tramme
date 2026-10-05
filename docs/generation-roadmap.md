# Generation roadmap

How the assistant has pictures made, not only sounds: a background the project holds no asset for, a texture, an illustration, a prop — and, later, moving pictures. Before this the assistant composed what the vocabulary allows and what the project holds; when the project held no fitting picture, it could only point at the lack. Now it has one made, the way [generate-sound](sound-roadmap.md) has a sound made.

Status: steps 1 and 2 done. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

In tramme a picture is always a file: an `image` layer shows an asset of the project. There is no node that draws at render time, and there should not be one: rendering stays a pure function of time.

So making a picture means making a file. The sound tools showed the way: records first, code for what they lack, providers for what neither can make. Pictures have no library here and no code that draws one; the providers come first. A model cannot draw either — describing a picture well and judging what comes back is what it does, the way a motion designer works with a stock library or an illustrator.

## Principles

- **Authoring time and render time are separate**, as for the plugins ([plugins-roadmap.md](plugins-roadmap.md#principles)) and the sounds. A picture is made once, saved as an asset with what made it (`assets/images/<name>.image.json`: its prompt, its provider and model, its proportions), and shown by an `image` layer. The project stays self-contained and every render is reproducible.
- **One mechanism for the assistant and the editor.** The tool is called by the assistant with `use_tool` and by the user from the `/` menu. Document changes go through operations, so they are validated, previewed and undoable.
- **The model sees what was made.** The tool answers with the picture (a small JPEG, the size of a still), so the model judges it with its own eyes: a background must stay quiet under text, a prop must sit where it belongs. It has the picture made again with a sharper prompt when it is off.
- **It costs money, and the user says so first.** The same gate as the sounds: a picture made by a provider waits for the user's yes. The gate is shared with the sounds for now (Settings, Sound); a Pictures section comes when there is more to set.
- **The keys stay in the Worker.** OpenAI, Gemini and Z.AI draw through `/api/generate-image`; the editor never sees a key. Custom providers speak the chat format, which carries no pictures: they wait for a step of their own.

## Steps

### Step 1. The providers on the server

- [x] `POST /api/generate-image` (`apps/worker/src/images.ts`): `{prompt, ratio?, quality?, provider?}` → the picture file. Proportions named as Gemini does (`1:1`, `16:9`, `9:16`…), mapped per provider: OpenAI to its three sizes, Z.AI to the sizes CogView takes, Gemini as given (`imageConfig.aspectRatio`). The answer names the provider and model in headers, like `/api/generate` does.
- [x] OpenAI (`gpt-image-1`), Gemini (`gemini-3.8-flash-image`), Z.AI (`cogview-4`); the keys of the settings or Worker secrets (keys.ts); `/api/config` lists the providers that draw (`images`).
- [x] The providers' refusals read and named (`providerFailure`, shared with the sounds).

### Step 2. The generate-image tool

- [x] The tool (`apps/editor/src/images.ts`, registered in the editor's vocabulary): has a provider draw, saves the file and its record, proposes the layer. The proportions follow the composition (`auto`), the layer fills the frame (`cover`, cropped to it) or shows the picture whole (`contain`), spans the composition or a time (`at`, `duration`), and `background` puts it under the other layers.
- [x] The model and the user see the picture: the model to judge it, the user in the conversation.
- [x] The gate before paying, the record beside the file, and the notes on when to use it: backgrounds, textures, illustrations, props — never words inside the picture (they come out crooked, and text layers can translate them).
- [ ] A Pictures section in the settings: the provider by default, the quality, the size at most (a small picture costs less). For now the tool's input says it.

Done when: asked for "a night-sky background", the assistant has one made, proposes it as a layer filling the frame under the others, describes what it sees, and the export shows it. Checked: the file in `assets/images/` with its record, the layer editable in the inspector, the `/` menu runs it without a model.

### Step 3. Takes and variants

- [ ] `takes`: several pictures in one call (the providers take n), a contact sheet of them, the user keeps one — the others are not saved. The explore mode of the sounds applied to pictures: the assistant asks for the takes, the user picks.
- [ ] A picture made again reads its record and changes only what the user asked to change.

### Step 4. Changing an existing picture

- [ ] Image to image: a reference given (an asset, a frame of the video), the provider keeps what matters and changes the rest — the palette of the project sent along.
- [ ] Inpainting and outpainting: a mask (the cutout tool makes some) says what changes; a picture extended past its edges to fill a wider format.
- [ ] Upscale: a small picture brought to the size of the composition before it enters the frame.

### Step 5. Moving pictures

- [ ] Video providers (Veo, Kling, Runway…) as footage layers: the same record (`.video.json`), the same gate, seconds billed, the shots tool finding the cuts of what comes back. The providers are young and slow: this step waits for prices and latency worth building on.

### Step 6. What was made, checked

- [ ] Checks that read a picture asset: words drawn in it (the OCR of a coming perception step says so — text in pictures is untranslatable), a background too busy under the captions (the contrast check reads the picture), a picture smaller than the frame that shows it. The checks read the assets, so they hold for any picture, generated or not.
- [ ] The palette tool turns a generated picture into tokens, and the guide says so: a picture in the project's colours before a palette of its own.
