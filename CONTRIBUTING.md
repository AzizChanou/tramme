# Contributing to Tramme

Thank you for your interest. Bug reports, ideas, documentation and code are all welcome.

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.md). For a security problem, follow [SECURITY.md](SECURITY.md) rather than opening an issue.

## Before you start

- **Bugs:** open an issue with the steps to reproduce, what you expected, what happened, and your browser and OS. A small `.tramme` project that shows the problem helps a lot.
- **Features and larger changes:** open an issue first to discuss the idea. It avoids work that would not fit the project's direction.
- **Small fixes** (typos, obvious bugs): a pull request directly is fine.

## Setup

Node 22.18 or newer. Chrome is needed for command-line renders.

```sh
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run dev         # the editor on http://localhost:8787/
```

`npm run dev` runs the Worker locally with simulated storage in `.wrangler/state`. Model keys for the assistant go in `apps/worker/.dev.vars` (copy `apps/worker/.dev.vars.example`), which git ignores. More in [docs/deploy.md](docs/deploy.md).

## Where things are

| Folder | Content |
|---|---|
| `packages/core` | Document, properties, keyframes, expressions, modifiers, evaluation, operations, validation |
| `packages/nodes` | Native nodes and effects |
| `packages/render` | Canvas2D renderer, WebGL2 compositor, assets |
| `packages/interop` | Lottie and SVG export, Lottie import |
| `packages/project` | Project format and `.tramme` archives |
| `packages/assistant` | The assistant's models, prompt and tools |
| `packages/cli` | Command line: offline rendering, exports, local companion |
| `apps/editor` | The web editor (Preact) |
| `apps/worker` | The Cloudflare Worker: serves the editor, projects in R2, assistant relay |

The document format is described in [docs/document.md](docs/document.md), the project format in [docs/project.md](docs/project.md).

## Guidelines

- **The engine stays generic.** `packages/` must not depend on a particular brand, product or project. Project-specific behavior belongs in project plugins or in `examples/`.
- **Rendering stays deterministic.** Every frame must be a pure function of time: no `Math.random()` without a seed, no wall clock, no state carried between frames.
- **The editor and the assistant share one API.** Every change to the document goes through operations, so it can be undone and the assistant can make it too.
- **Interface text is translated.** The editor is written in English: every visible text goes through `t()` with a key defined in `apps/editor/src/i18n/en.json` and `fr.json`. A test checks it. See [docs/i18n.md](docs/i18n.md).
- **The interface works on small screens and touch.** Check layouts down to 360 px wide.
- **Match the surrounding code:** naming, comment density, formatting. Add tests for engine and format changes.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Make sure `npm test` and `npm run typecheck` pass.
4. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style (`feat(editor): …`, `fix(core): …`, `docs: …`).
5. Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) when the change is visible to users.
6. Describe what changed and why, and how you tested it. Add a screenshot for interface changes.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT license](LICENSE).
