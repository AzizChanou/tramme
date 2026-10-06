// The storage routes: projects, their files, and the libraries shared by the
// projects. The same routes answer from R2 on the Worker and from IndexedDB in
// the browser's service worker (personal mode), so the editor never knows
// which one it talks to.
//
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
//   GET    /api/library, /api/library/<name>.js the plugin library (GET, PUT, DELETE a plugin)
//   GET    /api/sounds, /api/sounds/<name>      the sound library (GET, PUT with x-tramme-entry, DELETE a sound)

import type { Bucket } from './bucket.ts';
import { json } from './http.ts';
import { deleteFromShelf, getFromShelf, listShelf, putOnShelf, SHELVES } from './library.ts';
import { abortUpload, completeUpload, createProject, deleteFile, deleteProject, duplicateProject, exportProject, getFile, listProjects, projectInfo, putFile, startUpload, updateProject, uploadPart } from './projects.ts';

/** the routes of storage, under /api/ */
export const STORAGE = ['projects', 'library', 'sounds'];

/** the answer of a storage route, or null when the request is not one */
export async function storageRoute(req: Request, bucket: Bucket, url: URL): Promise<Response | null> {
  const parts = url.pathname.slice('/api/'.length).split('/');
  const m = req.method;
  if (parts[0] === 'library' || parts[0] === 'sounds') {
    const shelf = parts[0] === 'library' ? SHELVES.plugins : SHELVES.sounds;
    const [, name] = parts;
    if (!name && m === 'GET') return listShelf(bucket, shelf);
    if (name && (m === 'GET' || m === 'HEAD')) return getFromShelf(bucket, shelf, name);
    if (name && m === 'PUT') return putOnShelf(bucket, shelf, name, req);
    if (name && m === 'DELETE') return deleteFromShelf(bucket, shelf, name);
  }
  if (parts[0] === 'projects') {
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
  return null;
}
