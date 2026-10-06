# Deploying tramme on Cloudflare

The same Worker deploys in one of two modes:

- **Private** (sections 1 to 7): one user behind Cloudflare Access. The Worker serves the editor (static files from `apps/editor/dist`), the projects API (`/api/projects`, R2 storage) and the assistant relay (`/api/claude`), and keeps the providers' keys. On top of Access, the Worker checks the Access token on every API call, which also covers the addresses Access does not sit in front of.
- **Personal** (section 8): a public deployment anyone uses without an account. The server keeps nothing: each visitor's projects stay in their browser, their keys in a key vault the editor cannot read, and their browser calls the providers itself.

Configuration: [apps/worker/wrangler.jsonc](../apps/worker/wrangler.jsonc) (the private mode at the top level, the personal mode in `env.personal`).

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

1. **Access, Applications, Add an application, Self-hosted.** Domain: the Worker's (a custom domain, or `tramme-private.<account>.workers.dev`). For `workers.dev`, the Worker's page also offers to enable Access directly (Settings, Domains & Routes).
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

- **Anthropic key on the server** (fallback, when the companion is not running): connect Anthropic in the editor's **Settings, Providers** (see section 5).

## 5. Providers and their keys

Optional: the assistant can also use OpenAI, Gemini, OpenRouter or Z.AI (GLM) models, and any service of the OpenAI chat format added as a **custom provider** (name, base URL such as `https://api.deepseek.com/v1`, key). ElevenLabs makes sounds (section 6).

Keys are connected in the editor: **Settings, Providers**, then *Connect* on a provider and paste its key. The editor sends it once to the Worker, which keeps it in R2 (`config/keys.json`, in the same bucket as the projects, behind Cloudflare Access) and adds it to each request to that provider. The browser never reads it back: it only learns which providers are connected. *Change key* replaces it, *Disconnect* deletes it.

Cloudflare secrets still work, for a deployment configured from the command line; a key connected in the settings comes first:

```sh
npx wrangler secret put ANTHROPIC_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put OPENAI_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put GEMINI_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put OPENROUTER_API_KEY -c apps/worker/wrangler.jsonc
npx wrangler secret put ZAI_API_KEY -c apps/worker/wrangler.jsonc
```

A provider set this way shows as *Server secret* in the settings: it cannot be disconnected from the editor, only replaced by a key connected there.

Only connected providers show up in the model menu. A custom provider is reached through the Worker, so its address must be public (a model on this machine goes through Local models instead). Local models (Ollama, LM Studio) need nothing on the server: the browser calls them directly; for the online editor, start Ollama with `OLLAMA_ORIGINS=https://<your editor's address>`.

## 6. Sounds made by a provider

Optional: the assistant's `generate-sound` tool makes sound effects, music beds and voice-overs at authoring time, saved in the project like any sound. ElevenLabs makes all three; a voice-over can also come from OpenAI or Gemini. Connect ElevenLabs in **Settings, Providers** like the others (or `npx wrangler secret put ELEVENLABS_API_KEY -c apps/worker/wrangler.jsonc`).

Without any of these keys the assistant still has the sound library (recorded sounds shipped with tramme, the user's own) and the sounds it writes as code. Each provider bills its own use.

## 7. Transcription

The Worker transcribes the speech of sounds and videos with Workers AI (`@cf/openai/whisper-large-v3-turbo`, the `AI` binding is already declared in `wrangler.jsonc`, about $0.0005 per minute of sound). Nothing more to configure. Without this binding, the editor goes through the local companion, which transcribes on the machine.

Locally, Workers AI still runs at Cloudflare (`wrangler dev` requires you to be logged in) and usage is billed.

## 8. Personal mode: a public deployment

Anyone opens the address and works at once: no account, nothing kept on the server, and no key ever stored by you.

### How it works

- **Projects in the browser.** A service worker (`apps/editor/src/sw.ts`) answers the editor's storage routes (`/api/projects`, `/api/library`, `/api/sounds`) from IndexedDB, with the same code the Worker runs on R2 (`packages/api`). The editor does not know the difference. A project is exported as a `.tramme` archive to back it up or move it to another device.
- **Keys in a vault.** The keys live in a page of another origin of your site (`cles.<your domain>`), framed by the editor. The browser keeps the two origins apart: the editor and the projects' plugins cannot read the vault's storage. The keys are typed into the vault's own page (shown in Settings, Providers), never into the editor.
- **Calls from the browser.** The editor asks the vault for a route (`/api/claude`, `/api/llm`, `/api/models`, `/api/generate`…); the vault adds the key and calls the provider itself, straight from the visitor's browser. Anthropic, OpenAI, Gemini, OpenRouter and ElevenLabs take calls from a page; the others (Z.AI, custom providers) go through the Worker's relay (`/relay` on the vault's address), which passes the request on and keeps nothing. The settings say which providers use the relay.
- **What the Worker does.** It serves the editor and the vault's page (with a Content-Security-Policy: framed by the editor only, reaching only the providers above and the relay), and the relay. No R2, no Access, no Workers AI: transcription goes through each visitor's local companion.
- **Costs.** The static files, and the relay's requests (Workers' free tier, then a few cents per million). Each visitor's provider bills them for their own use.

### Setting it up

1. **A domain of yours on Cloudflare.** The editor and the vault must be two addresses of the same site, for example `tramme.example.com` and `cles.tramme.example.com`. Two `workers.dev` addresses would not do: `workers.dev` is shared by every Cloudflare customer, so browsers treat the vault as a third party and may clear its storage (Safari first).
2. In [apps/worker/wrangler.jsonc](../apps/worker/wrangler.jsonc), under `env.personal`, set the two addresses and uncomment the routes:

   ```jsonc
   "vars": { "MODE": "personal", "APP_ORIGIN": "https://tramme.example.com", "VAULT_ORIGIN": "https://cles.tramme.example.com" },
   "routes": [
     { "pattern": "tramme.example.com", "custom_domain": true },
     { "pattern": "cles.tramme.example.com", "custom_domain": true }
   ],
   ```

3. Deploy:

   ```sh
   npm run deploy:personal   # builds the editor, then wrangler deploy --env personal
   ```

   The personal Worker is `tramme`, the private one `tramme-private`: both can live side by side. Deploying from the Git repository (Workers Builds, on the `tramme` Worker): build command `npm run build`, deploy command `npx wrangler deploy -c apps/worker/wrangler.jsonc --env personal`.

Any other address of this Worker (its `workers.dev` one, previews) sends to `APP_ORIGIN`. Until both addresses are set, it answers 503.

### What is kept, and where

| | Where | Who can read it |
|---|---|---|
| Projects, libraries | IndexedDB of the editor's address, in the visitor's browser | the visitor, the editor, the projects' plugins |
| Keys, custom providers | IndexedDB of the vault's address, in the visitor's browser | the vault only |
| A request through the relay | nowhere: passed on to the provider | the Worker, while it passes |

The relay's requests carry the key: the Worker's invocation logs are off in this mode (`observability.logs.invocation_logs: false`), and the relay logs nothing. A visitor may send 120 requests a minute through it (`ratelimits`, `RELAY_LIMIT`).

What a malicious plugin of a shared project could still do: spend the visitor's credit by asking the vault for requests, as the editor does. It cannot read a key, nor change one.

### Limits of the personal mode

- Projects belong to one browser on one device: clearing the site's data, or private browsing, loses them. The home screen says so; the browser is asked to keep them (`navigator.storage.persist()`).
- No service worker (some private windows): the editor says it cannot start.
- No transcription from the server: through the local companion only.

## Local development

```sh
npm run dev           # http://localhost:8787/
npm run dev:personal  # the personal mode: the editor on http://localhost:8787/, the vault on http://127.0.0.1:8787/
```

The assistant's companion starts along, paired with this editor (`TRAMME_NO_COMPANION=1` to go without it). The Worker runs in `wrangler dev`: R2 simulated in `.wrangler/state`, Access check lifted (the `DEV_OPEN` variable, honored only on `localhost`). Model keys, locally, are connected in **Settings, Providers** as on the deployed app (kept in the simulated R2), or go in `apps/worker/.dev.vars` (ignored by git; template to copy: `apps/worker/.dev.vars.example`). Fill in only the providers you use, then restart `npm run dev`:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
ZAI_API_KEY=
ELEVENLABS_API_KEY=
```

## Limits

Of the private mode (for the personal mode, see section 8):

- Files of 95 MB at most (the request size Workers accepts); heavier sounds and videos are uploaded in parts (R2 multipart, 32 MiB per part, 4 GiB per file); 2000 files per project.
- A single user: no accounts or sharing; Access decides who gets in.
- Video exports happen in the browser (WebCodecs). ProRes and long renders go through the command line (`tramme render`, with Chrome and ffmpeg) on a project folder (`tramme unpack` of a downloaded archive).
