// The deployed app: the editor's static build, and under /api the projects
// (R2) and the server side of the assistant.
//
//   GET    /api/config                          what this server offers
//   GET    /api/projects                        manifests, most recent first
//   POST   /api/projects                        new project {name, width, height, fps, duration, empty?}
//   GET    /api/projects/:id                    manifest and file list
//   PATCH  /api/projects/:id                    rename {name}, thumbnail
//   DELETE /api/projects/:id
//   POST   /api/projects/:id/duplicate          {name?}
//   GET    /api/projects/:id/export             the project as a .tramme archive
//   GET    /api/projects/:id/files/<path>       a file (ranges, ETag)
//   PUT    /api/projects/:id/files/<path>       write a file (If-Match to avoid overwriting another tab)
//   DELETE /api/projects/:id/files/<path>
//   POST   /api/projects/:id/uploads            large sound or video: {path, size} -> {uploadId, partSize}
//   PUT    /api/projects/:id/uploads/:upload?path&part   one part
//   POST   /api/projects/:id/uploads/:upload/complete    {path, parts}
//   DELETE /api/projects/:id/uploads/:upload?path
//   POST   /api/claude/v1/messages              Messages API with the server's key
//   POST   /api/llm/:provider/chat/completions  OpenAI, Gemini, OpenRouter with the server's keys
//   GET    /api/models                          the models of those providers
//   POST   /api/transcribe                      {audio: WAV base64, language?} -> words with their timing (Whisper)
//   GET    /api/library, /api/library/<name>.js the plugin library (GET, PUT, DELETE a plugin)
//   GET    /api/sounds, /api/sounds/<name>      the sound library (GET, PUT with x-tramme-entry, DELETE a sound)
//   POST   /api/generate                        {kind: sfx|music|voice, prompt, duration?, voice?, style?, provider?} -> audio

import { LIMITS, PROJECT_FORMAT } from '@tramme/project';
import { guard } from './access.ts';
import { claude, claudeConfig } from './claude.ts';
import { llm, llmConfig, models } from './llm.ts';
import { transcribe } from './speech.ts';
import { generate, soundConfig } from './generate.ts';
import { HttpError, json, type Env } from './http.ts';
import { abortUpload, completeUpload, startUpload, uploadPart, createProject, deleteFile, deleteProject, duplicateProject, exportProject, getFile, listProjects, projectInfo, putFile, updateProject } from './projects.ts';
import { deleteFromShelf, getFromShelf, listShelf, putOnShelf, SHELVES } from './library.ts';

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.slice('/api/'.length).split('/');
  const m = req.method;
  if (parts[0] === 'config' && m === 'GET') {
    return json({ format: PROJECT_FORMAT, limits: LIMITS, claude: claudeConfig(env), llm: llmConfig(env), transcribe: !!env.AI, sound: soundConfig(env) });
  }
  if (parts[0] === 'claude') return claude(req, env, parts.slice(1).join('/'));
  if (parts[0] === 'llm' && parts[1]) return llm(req, env, parts[1], parts.slice(2).join('/'));
  if (parts[0] === 'models' && m === 'GET') return models(env);
  if (parts[0] === 'transcribe' && m === 'POST') return transcribe(req, env);
  if (parts[0] === 'generate' && m === 'POST') return generate(req, env);
  if (parts[0] === 'library' || parts[0] === 'sounds') {
    const shelf = parts[0] === 'library' ? SHELVES.plugins : SHELVES.sounds;
    const [, name] = parts;
    if (!name && m === 'GET') return listShelf(env.FILES, shelf);
    if (name && (m === 'GET' || m === 'HEAD')) return getFromShelf(env.FILES, shelf, name);
    if (name && m === 'PUT') return putOnShelf(env.FILES, shelf, name, req);
    if (name && m === 'DELETE') return deleteFromShelf(env.FILES, shelf, name);
  }
  if (parts[0] === 'projects') {
    const bucket = env.FILES;
    const [, id, sub] = parts;
    if (!id) {
      if (m === 'GET') return json(await listProjects(bucket));
      if (m === 'POST') return createProject(bucket, req);
    } else if (!sub) {
      if (m === 'GET') return projectInfo(bucket, id);
      if (m === 'PATCH') return updateProject(bucket, id, req);
      if (m === 'DELETE') return deleteProject(bucket, id);
    } else if (sub === 'duplicate' && m === 'POST') return duplicateProject(bucket, id, req);
    else if (sub === 'export' && m === 'GET') return exportProject(bucket, id);
    else if (sub === 'uploads') {
      const [, , , uploadId, action] = parts;
      if (!uploadId && m === 'POST') return startUpload(bucket, id, req);
      if (uploadId && !action && m === 'PUT') return uploadPart(bucket, id, uploadId, req, url);
      if (uploadId && action === 'complete' && m === 'POST') return completeUpload(bucket, id, uploadId, req);
      if (uploadId && !action && m === 'DELETE') return abortUpload(bucket, id, uploadId, url);
    }
    else if (sub === 'files' && parts.length > 3) {
      const path = parts.slice(3).map(decodeURIComponent).join('/');
      if (m === 'GET' || m === 'HEAD') return getFile(bucket, id, path, req);
      if (m === 'PUT') return putFile(bucket, id, path, req);
      if (m === 'DELETE') return deleteFile(bucket, id, path);
    }
  }
  throw new HttpError(404, `unknown route: ${m} ${url.pathname}`);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return (await guard(req, env)) ?? (await route(req, env, url));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, issues: e.issues }, e.status);
      console.error(e);
      return json({ error: 'internal server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
