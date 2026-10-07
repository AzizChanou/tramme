# Desktop and mobile apps with Tauri

Status: **steps 1 and 2 of the plan are done** (Windows, local mode complete). This note gathers what is needed to ship Tramme as a native app with [Tauri 2](https://v2.tauri.app/) (Windows, macOS, Linux, Android, iOS), so the work can start from here.

## Summary

The editor is a static single-page app, so Tauri can wrap it with little effort. The real work is elsewhere:

1. **There is no server in a Tauri app.** Everything the editor stores or loads goes through `/api`, served today by the Cloudflare Worker. A local replacement is needed.
2. **The webview differs per platform.** Video export relies on WebCodecs, and not every system webview has it.

Recommended order: **desktop first (Windows, then macOS), in local mode.** Mobile comes later, and only if offline use or local files matter: the installable web app (PWA) already covers phones.

## Already in place: the personal mode

The web's personal mode ([deploy.md](deploy.md), section 8) built most of what the app needs, behind interfaces a desktop app can implement differently:

| Need | Web, personal mode | Tauri |
|---|---|---|
| The `/api` storage routes, answered on the device | `storageRoute` of `packages/api` over IndexedDB, in a service worker | the same contract over folders, in the Rust protocol handler (below) |
| A check that a storage behaves as the editor expects | `packages/api/test/contract.ts`, run on memory and IndexedDB | run against the Rust handler too |
| Keys the editor never reads | the key vault, a page of another origin (`apps/editor/src/vault`) | a Rust command holding the keys in the OS keychain |
| Provider calls without a server | `providerRoute` with a `Reach` (keys and a fetch), direct from the browser | the same routes, the fetch done by Rust (no CORS: Z.AI and custom providers too) |
| The editor's side | `api.reach`: the vault in personal mode, the server otherwise | a third case of `api.reach` |

So the app's step 3 (assistant) is mostly a matter of answering `api.reach` from Rust.

## What the editor depends on today

| Dependency | Where | In a Tauri app |
|---|---|---|
| Projects and files (`/api/projects/...`), stored in R2 | `apps/worker/src/projects.ts`, called from `apps/editor/src/api.ts` | Must be replaced (see below) |
| Large uploads in parts (R2 multipart) | `api.writeAny` | Not needed with local files: write in one go |
| Assistant through the server (`/api/claude`, `/api/llm`, `/api/models`) | `apps/worker/src/claude.ts`, `llm.ts` | Call the providers directly, with keys stored on the device |
| Speech to text (`/api/transcribe`, Workers AI Whisper) | `apps/worker/src/speech.ts` | Provider API, or local Whisper (desktop only) |
| Local companion (`tramme agent`, Node + Claude Agent SDK) | `packages/cli/src/companion.ts` | Desktop: can stay a separate program. Mobile: not possible |
| Access control (Cloudflare Access) | `apps/worker/src/access.ts` | Not needed for a local app |
| Video export (WebCodecs), compositor (WebGL2) | `apps/editor/src/webexport.ts`, `packages/render` | Depends on the webview (see the table below) |
| Saving exports (`showSaveFilePicker`, downloads) | `apps/editor/src/download.ts` | Use Tauri's dialog and file system plugins |

## Storage: two options

### Option A: client of a deployed server

The app loads the editor and talks to an existing Worker over the network.

- Fast to build: the editor barely changes.
- No offline use, and Cloudflare Access login inside a webview is awkward (redirects, cookies).
- Little gain over opening the site in a browser.

### Option B: local mode (recommended)

Projects live in folders on the device. A project is already a folder (manifest, document, assets, plugins; see [project.md](project.md)), so the mapping is direct.

The least invasive way: **serve the same `/api` routes from Tauri, through a custom protocol**, instead of rewriting `api.ts`.

- Tauri can register a protocol handler (`register_asynchronous_uri_scheme_protocol`) that answers the editor's requests in Rust.
- The handler implements the subset of the API that `api.ts` uses: list, create, info, update, remove, duplicate, export (`.tramme` archive), and file read, write and delete.
- It must keep the behaviors the editor relies on:
  - **ETag and `If-Match`** on writes, so two windows cannot overwrite each other (412 on conflict).
  - **Byte ranges** on file reads: the video layer seeks with range requests.
  - **The same validation** as the Worker: allowed paths, project checks (`packages/project`), size limits.
- `api.ts` then only needs its base URL to change. Relative asset paths in documents keep resolving against the document's URL, so the engine is untouched.

Alternative to the Rust handler: a sidecar Node process reusing the TypeScript of `apps/worker/src/projects.ts` on top of the file system. It shares more code but bundles a Node runtime (heavier, desktop only).

Where the projects go: a `Tramme` folder in the user's documents by default, configurable in the settings. Opening a `.tramme` file from the system (file association) can come later.

## The assistant without a server

- **Keys on the device.** The user enters their own provider keys in the settings. Store them with the OS keychain (a Tauri plugin such as `tauri-plugin-stronghold` or a keyring plugin), never in plain files or `localStorage`.
- **Direct calls.** The editor already runs the tool loop in the page; only the transport changes, from the Worker relay to the provider's API. Check each provider's CORS rules for calls from a webview; if one refuses, route it through a Rust command.
- **Local models** (Ollama, LM Studio) already work from the browser and keep working.
- **Companion.** On desktop, `tramme agent` can keep running next to the app (it needs Node and a Claude Code login). Bundling it as a sidecar means shipping Node: decide later.
- **Transcription.** A provider API (OpenAI Whisper, for example), or on desktop the companion's local Whisper.

## The webview per platform

| Platform | Webview | Notes |
|---|---|---|
| Windows | WebView2 (Chromium) | Same as Chrome: WebCodecs, WebGL2, everything works |
| Android | Android System WebView (Chromium) | Works; export is heavy on a phone |
| macOS, iOS | WKWebView (Safari engine) | WebCodecs video encoding exists in recent versions; audio encoding is more recent: check per OS version. No `showSaveFilePicker`: save through Tauri |
| Linux | WebKitGTK | As far as known, no WebCodecs: MP4/WebM export fails without a native encoder |

Ways to cover the gaps:

- **Feature detection first.** `webexport.ts` already checks for `VideoEncoder`. Hide or explain the formats that cannot be encoded, instead of failing late.
- **Native encoding fallback (desktop).** Send rendered frames to a bundled ffmpeg (Tauri sidecar), as the CLI already does with `ffmpeg-static`. Mind ffmpeg's license (GPL or LGPL builds) when bundling.
- **Memory.** Export keeps the whole video in memory (`BufferTarget`). On phones, stream to a file instead (mediabunny supports stream targets), or limit length and resolution.

## Mobile specifics

- The touch work is done: tabbed panels, compact header, pinch to zoom, two-finger pan, larger targets (see the 0.1.0 entry in the [changelog](../CHANGELOG.md)).
- Still missing for touch: the keyframe context menu (curve, delete) only opens with a right click. Add a long press or a toolbar action.
- Safe areas: the CSS already uses `env(safe-area-inset-*)`; check them in a real notched device.
- Store requirements: app icons in PNG at the required sizes (today there is only an SVG icon), privacy labels (the assistant sends data to the chosen provider), and review rules on downloaded code (project plugins run JS).

## Plan

1. **Proof of concept (Windows) — done.** `apps/desktop` with Tauri 2, loading the built editor (`apps/editor/dist`). Projects served by the custom protocol from a local folder (`Documents/Tramme`, `TRAMME_HOME` to move it). One protocol handler (`tramme` scheme) answers the embedded assets, the editor's pages (`/p/<id>` → index.html) and the `/api` storage routes in Rust (`apps/desktop/src-tauri/src/{api,store,format}.rs`): projects CRUD, duplicate, export as a `.tramme` archive, file reads with ETag, `If-None-Match` and byte ranges, writes with `If-Match`, delete, the plugin and sound shelves, and `/api/config`. The editor of `apps/editor` is untouched.
2. **Local mode complete — done.** Multipart uploads (a sound or video over 95 MB goes through `POST /uploads`, parts of 32 MB, `complete`; assembled in part-number order on disk). The storage contract suite of `packages/api` runs against the Rust store: a little HTTP mirror of it (`src/bin/tramme-storage-server.rs`) spawned by `apps/desktop/test/local-store.test.ts`, with an HTTP `Bucket` reusing the same `conditionsHold` and `rangeOf` helpers as the other buckets. The projects folder is a setting of the app (Storage section of the editor's settings, a native folder picker, kept in `%APPDATA%/tramme/desktop.json`). A `.tramme` double-clicked in the file explorer lands in the running window (file association declared in the bundle, `tauri-plugin-single-instance` hands the path over, the editor imports it and opens the project). The window's drag-and-drop stays the editor's own (`disable_drag_drop_handler`). Exports saved to the computer go through the webview's own `showSaveFilePicker` (present in WebView2, nothing to add). Consciously left out, still: the document's full schema is not re-checked on write (only JSON), the providers and the transcription answer 501.
3. **Assistant.** Keys in the keychain, direct provider calls, transcription.
4. **macOS.** Signing and notarization, WKWebView checks (export formats, saving files).
5. **Linux.** Native encoding fallback or reduced export formats.
6. **Mobile (optional).** Android first (Chromium webview), then iOS. Streamed export, store assets.
7. **Release.** CI builds per platform (GitHub Actions with `tauri-action`), auto-update (Tauri updater plugin, signed updates).

## Open questions

- Keep a single codebase where the editor detects whether it runs in Tauri (`window.__TAURI__`), or build a separate entry point?
- Should a local project sync with a deployed server, or stay strictly local?
- Bundle the companion and ffmpeg (bigger app, licenses to review), or require them installed?
- Which license for the ffmpeg build if bundled (LGPL keeps distribution simpler than GPL)?

## References

- Tauri 2: https://v2.tauri.app/
- Custom protocols: `tauri::Builder::register_asynchronous_uri_scheme_protocol` in the Rust API docs (https://docs.rs/tauri)
- Sidecars: https://v2.tauri.app/develop/sidecar/
- Mobile: https://v2.tauri.app/start/prerequisites/#configure-for-mobile-targets
- WebCodecs support: https://caniuse.com/webcodecs
