# Deploying tramme on Cloudflare

A single Worker serves everything: the editor (static files from `apps/editor/dist`), the projects API (`/api/projects`, R2 storage) and the assistant relay (`/api/claude`). Cloudflare Access protects the application; on top of that, the Worker checks the Access token on every API call, which also covers the addresses Access does not sit in front of.

Configuration: [apps/worker/wrangler.jsonc](../apps/worker/wrangler.jsonc).

## 1. Account and storage

```sh
npx wrangler login
npx wrangler r2 bucket create tramme-projects
```

The bucket name is the one in `r2_buckets` in `wrangler.jsonc`. Each project takes the prefix `projects/<id>/`.

## 2. First deployment

```sh
npm run deploy        # builds the editor, then wrangler deploy
```

Until Cloudflare Access is configured, the API answers 503 ("access not configured"): the editor shows up but reads and writes no project. That is on purpose: nothing is open by default.

## 3. Cloudflare Access

In the Cloudflare dashboard, Zero Trust:

1. **Access, Applications, Add an application, Self-hosted.** Domain: the Worker's (a custom domain, or `tramme.<account>.workers.dev`). For `workers.dev`, the Worker's page also offers to enable Access directly (Settings, Domains & Routes).
2. **Policy**: Allow, Include, Emails: your address. Sign in with a code sent by email (One-time PIN) or with the identity provider of your choice.
3. Note the application's **Application Audience (AUD) Tag**, and the **team domain** (Settings, Custom Pages: `<team>.cloudflareaccess.com`).

Put them in `apps/worker/wrangler.jsonc`:

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
  "ACCESS_AUD": "<AUD tag>"
}
```

then `npm run deploy`. The Worker then checks the signature (the team's public keys), the audience, the issuer and the expiry of the `Cf-Access-Jwt-Assertion` token, and refuses write requests coming from another origin.

## 4. The assistant

Two paths, chosen in the editor (Assistant, settings):

- **Local companion** (recommended): on your machine, with your Claude Code login, no key.

  ```sh
  npm run tramme -- agent --origin https://<your editor's address>
  ```

  The editor at that address pairs by itself, with no token to copy. The companion listens on `127.0.0.1` only and refuses pages from other origins; another local page must be given the pairing token it prints, by hand. Chrome may ask for permission to access the local network the first time.

- **Key on the server** (fallback, when the companion is not running):

  ```sh
  npx wrangler secret put ANTHROPIC_API_KEY -c apps/worker/wrangler.jsonc
  ```

  The value is typed at the prompt; it shows up neither in the command nor in files. It stays in the Worker; the browser never has access to it.

## 5. Other models

Optional: the assistant can also use OpenAI, Gemini, OpenRouter or Z.AI (GLM) models. One key per provider, as a secret:

```sh
npx wrangler secret put OPENAI_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put GEMINI_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put OPENROUTER_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put ZAI_API_KEY -c apps/worker/wrangler.jsonc
```

Only providers with a key show up in the model menu. Locally, the same names go in `apps/worker/.dev.vars`. Local models (Ollama, LM Studio) need nothing on the server: the browser calls them directly; for the online editor, start Ollama with `OLLAMA_ORIGINS=https://<your editor's address>`.

## 6. Sounds made by a provider

Optional: the assistant's `generate-sound` tool makes sound effects, music beds and voice-overs at authoring time, saved in the project like any sound. ElevenLabs makes all three; a voice-over can also come from OpenAI or Gemini with the keys of section 5.

```sh
npx wrangler secret put ELEVENLABS_API_KEY -c apps/worker/wrangler.jsonc
```

Without any of these keys the assistant still has the sound library (recorded sounds shipped with tramme, the user's own) and the sounds it writes as code. Each provider bills its own use.

## 7. Transcription

The Worker transcribes the speech of sounds and videos with Workers AI (`@cf/openai/whisper-large-v3-turbo`, the `AI` binding is already declared in `wrangler.jsonc`, about $0.0005 per minute of sound). Nothing more to configure. Without this binding, the editor goes through the local companion, which transcribes on the machine.

Locally, Workers AI still runs at Cloudflare (`wrangler dev` requires you to be logged in) and usage is billed.

## Local development

```sh
npm run dev           # http://localhost:8787/
```

The assistant's companion starts along, paired with this editor (`TRAMME_NO_COMPANION=1` to go without it). The Worker runs in `wrangler dev`: R2 simulated in `.wrangler/state`, Access check lifted (the `DEV_OPEN` variable, honored only on `localhost`). Model keys, locally, go in `apps/worker/.dev.vars` (ignored by git; template to copy: `apps/worker/.dev.vars.example`). Fill in only the providers you use, then restart `npm run dev`:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
ZAI_API_KEY=
ELEVENLABS_API_KEY=
```

## Limits

- Files of 95 MB at most (the request size Workers accepts); heavier sounds and videos are uploaded in parts (R2 multipart, 32 MiB per part, 4 GiB per file); 2000 files per project.
- A single user: no accounts or sharing; Access decides who gets in.
- Video exports happen in the browser (WebCodecs). ProRes and long renders go through the command line (`tramme render`, with Chrome and ffmpeg) on a project folder (`tramme unpack` of a downloaded archive).
