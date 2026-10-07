// The desktop storage against the reference suite: the same contract the R2
// bucket and the IndexedDB bucket pass, run on the folders the app writes to
// (through the little HTTP mirror of the Rust store).

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll } from 'vitest';
import { storageContract } from '../../../packages/api/test/contract.ts';
import { httpBucket } from './http-bucket.ts';

const TAURI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');
const EXE = path.join(TAURI, 'target', 'debug', process.platform === 'win32' ? 'tramme-storage-server.exe' : 'tramme-storage-server');

let server: ChildProcess | undefined;
let base = '';
let home = '';

beforeAll(async () => {
  const cargo = (...args: string[]) => {
    try {
      return execFileSync('cargo', args, { cwd: TAURI, stdio: 'pipe' });
    } catch (e) {
      if ((e as { code?: string }).code !== 'ENOENT') throw e;
      const fallback = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo', 'bin', 'cargo');
      return execFileSync(fallback, args, { cwd: TAURI, stdio: 'pipe' });
    }
  };
  cargo('build', '--bin', 'tramme-storage-server');

  home = mkdtempSync(path.join(tmpdir(), 'tramme-contract-'));
  server = spawn(EXE, { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((ok, err) => {
    let out = '';
    server!.stdout!.on('data', (c: Buffer) => {
      out += c.toString();
      const m = /PORT=(\d+)/.exec(out);
      if (m) ok(Number(m[1]));
    });
    server!.on('exit', (code) => err(new Error(`the storage server exited (${code})`)));
    setTimeout(() => err(new Error('the storage server printed no port')), 20000);
  });
  base = `http://127.0.0.1:${port}`;
  await fetch(`${base}/health`, { method: 'POST' });
}, 300000);

afterAll(() => {
  server?.kill();
  if (home) rmSync(home, { recursive: true, force: true });
});

// each bucket its own fresh root, as each visitor's browser has its own
let n = 0;
storageContract('folders (desktop)', () => httpBucket(base, path.join(home, `bucket-${++n}`)));
