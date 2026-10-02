# The `tramme-project/1` project format

A project is a set of files in fixed places. The same files live in storage (an R2 prefix, or a folder on disk) while you work, and in a `.tramme` archive (zip) to import or export. Any other file is refused: that is what makes it possible to check a project before accepting it.

```
tramme.json            manifest (required)
document.tramme.json   the document, schema tramme/1 (required, see document.md)
assets/               files used by the document
plugins/              JS modules declared in the document's "plugins"
thumbnail.webp        home screen thumbnail (or .png, .jpg; optional)
.tramme/chats/         the assistant's conversations (<id>.json) and their index (index.json)
.tramme/chat.json      single conversation of older projects (read, then moved into chats/)
renders/              exports kept in the project (never in an archive)
```

The format's code is in [packages/project](../packages/project/src/format.ts).

## Manifest

```json
{
  "format": "tramme-project/1",
  "id": "showcase-3n174m",
  "name": "Showcase",
  "created": "2026-10-01T12:17:40.210Z",
  "modified": "2026-10-01T13:02:11.032Z",
  "width": 1920, "height": 1080, "duration": 6,
  "thumbnail": "thumbnail.webp",
  "app": "tramme"
}
```

- `id`: lowercase letters, digits and hyphens, 3 to 64 characters. An imported project always gets a new id; nothing is overwritten.
- `width`, `height`, `duration`: the main composition, for the home screen. The server keeps them up to date each time the document is saved, along with `modified`.
- No other key is allowed.

## Allowed paths and files

- Relative paths, separated by `/`, without `.` or `..`, without control characters or `<>:"|?*`, 300 characters at most.
- `assets/`: images (png, jpg, webp, gif, avif, svg), fonts (ttf, otf, woff, woff2), sounds (wav, mp3, ogg, m4a, flac), videos (mp4, webm, mov), data (json), modules (js, mjs). Sounds and videos up to 4 GiB (uploaded in parts), other files 95 MB. The editor puts the video of a project made from a video in `assets/video/`, files attached to the assistant in `assets/chat/`, and transcripts in `assets/transcripts/`: `{ "version": 1, "duration", "language", "words": [{ "w", "s", "e" }] }`, times in seconds; the transcript of an edit also carries `keeps` (the passages kept) and its times are composition times.
- `plugins/`: js, mjs.
- `renders/`: mp4, webm, mov, gif, png, zip, json, svg, wav.
- 95 MB per file, 2000 files per project, 95 MB per archive.

## Checks

Before a project enters storage (archive import, `tramme unpack`, `tramme pack`):

1. **Structure**: allowed paths and extensions, sizes, a valid manifest, a document matching the `tramme/1` schema, every asset of the document present in the project (relative `src`, never leaving the project), every plugin declared by a `module` asset.
2. **Meaning**: the plugins are loaded, then the document is validated against the full vocabulary (node types, properties, references, expressions, nested compositions without cycles).

The server checks the document's structure again on every write.

## `.tramme` archive

A zip of the project's files, without `renders/`. Media that is already compressed is stored as is. On reading, entries that are too large are refused before decompression; an archive whose whole content sits in a single folder (a zip made by hand) is accepted.

```sh
tramme pack examples/showcase --out showcase.tramme
tramme unpack showcase.tramme --out showcase
```
