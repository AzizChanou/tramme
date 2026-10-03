# Third-party notices

Tramme is released under the [MIT license](LICENSE). It relies on the open source packages below, which keep their own licenses. None of them is copied into this repository: npm installs them from the registry.

## Bundled into the editor

These packages end up in the editor's build (`apps/editor/dist`). The build also writes their license comments next to the bundle (`*.LEGAL.txt`).

| Package | License | Use |
|---|---|---|
| [preact](https://github.com/preactjs/preact) | MIT | Interface |
| [@preact/signals](https://github.com/preactjs/signals) | MIT | Editor state |
| [driver.js](https://github.com/kamranahmedse/driver.js) | MIT | Guided tours |
| [mediabunny](https://github.com/Vanilagy/mediabunny) | MPL-2.0 | Video decoding and encoding (MP4, WebM) |
| [gifenc](https://github.com/mattdesl/gifenc) | MIT | GIF export |
| [fflate](https://github.com/101arrowz/fflate) | MIT | `.tramme` archives, PNG sequences |

**About mediabunny (MPL-2.0).** The MPL is a file-level copyleft: if you modify mediabunny's own files and distribute the result, those files must stay under the MPL and their source must be available. Using it unmodified, as Tramme does, places no requirement on Tramme's own code.

## Command line and local tools

| Package | License | Use |
|---|---|---|
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Apache-2.0 | Headless Chrome for offline rendering |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0-or-later | Downloads an ffmpeg binary for video encoding |
| [ws](https://github.com/websockets/ws) | MIT | Frame transfer from the render page |
| [pngjs](https://github.com/pngjs/pngjs) | MIT | Image comparisons |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | Apache-2.0 | Local speech transcription (Whisper) |
| [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Proprietary (Anthropic) | The assistant's local companion (`tramme agent`) |

**About ffmpeg-static (GPL).** ffmpeg runs as a separate program, called by the CLI. It is not linked into Tramme, so the GPL does not extend to Tramme's code. If you redistribute the ffmpeg binary itself, follow the ffmpeg license.

**About the Claude Agent SDK.** It is not open source. Its use is subject to [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance). It is only needed for the local companion; the editor, the engine and the CLI renderers work without it.

## Development only

esbuild (MIT), TypeScript (Apache-2.0), Vitest (MIT), Wrangler (MIT OR Apache-2.0), lottie-web (MIT, used to check Lottie exports), and type packages.

## Fonts and media

The editor uses the system's fonts and bundles none. The example projects in `examples/` (drawings, thumbnails) are part of Tramme and under the same MIT license.

The sound library in `sounds/` (copied into the editor's build) holds recordings by [Kenney](https://www.kenney.nl) from the packs Impact Sounds, Interface Sounds, Digital Audio, UI Audio, Music Jingles and Sci-fi Sounds, released under [Creative Commons Zero (CC0 1.0)](http://creativecommons.org/publicdomain/zero/1.0/): public domain, free for any use, crediting welcome but not required (`sounds/LICENSE.txt`). The sounds written as code (`apps/editor/src/sound-presets.ts`) are part of Tramme.

## Services

The assistant can call third-party services (Anthropic, OpenAI, Google Gemini, OpenRouter, ElevenLabs, Cloudflare Workers AI), each under its own terms, with keys provided by whoever deploys Tramme. Sounds made by a provider fall under that provider's terms of use.
