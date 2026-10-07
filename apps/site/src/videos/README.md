# The site's videos

Each video slot on the page (`components/Media.astro`) shows a placeholder until its file is here. Drop the file in, rebuild, and the slot plays it: muted, in a loop, only while it is on screen, and nothing of it loads before it comes near.

| Slot | Files | Size |
|---|---|---|
| hero | `showcase.webm` and/or `showcase.mp4`, `showcase.webp` | 1920×1080 |
| examples | `anime`, `night-sky`, `hello`, `road-trip` (same extensions) | the example's own |
| assistant | `assistant.webm` and/or `assistant.mp4`, `assistant.webp` | 1600×1000 (16:10) |

- **WebM (VP9) first, MP4 (H.264) as a fallback**: the browser takes the first one it can play. One of the two is enough.
- **The poster** (`.webp`, or `.jpg`) shows before the clip loads: a frame of it, at the clip's size.
- **Keep them light**: no sound track, 2 to 4 Mb/s for 1080p, a few seconds that loop cleanly.

The examples render with the command line, for example:

```sh
npm run tramme -- render examples/showcase --format webm --mute
npm run tramme -- still examples/showcase --t 2.5
```
