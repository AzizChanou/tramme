// Every change to a document is a list of JSON Patch operations (RFC 6902)
// on JSON Pointer paths (RFC 6901). Applying them never mutates: containers
// along each path are copied, the rest is shared. Each application returns
// the inverse operations, which is all undo needs. The editor and the AI use
// this same API; an AI proposal is a transaction waiting to be applied.

export type Op =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

export interface Transaction {
  label: string;
  /** who made it: 'user', 'ai', a tool name */
  source?: string;
  ops: Op[];
}

export class OpError extends Error {
  readonly op: Op;
  constructor(op: Op, message: string) {
    super(`${op.op} ${op.path} : ${message}`);
    this.op = op;
  }
}

// ── pointers ─────────────────────────────────────────────────
export function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (path[0] !== '/') throw new Error(`invalid JSON Pointer path: ${path}`);
  return path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}
export const pointer = (...parts: (string | number)[]) =>
  parts.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');

type Json = any;
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object';

export function getAt(doc: Json, path: string): Json {
  let v = doc;
  for (const k of parsePointer(path)) {
    if (!isObj(v)) return undefined;
    v = Array.isArray(v) ? v[Number(k)] : v[k];
  }
  return v;
}

const clone = (v: unknown): Json => (v === undefined ? undefined : structuredClone(v));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function arrayIndex(arr: Json[], key: string, op: Op, forAdd: boolean): number {
  if (forAdd && key === '-') return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(key)) throw new OpError(op, `invalid array index "${key}"`);
  const i = Number(key);
  if (i > arr.length || (!forAdd && i === arr.length)) throw new OpError(op, `index ${i} out of the array (${arr.length})`);
  return i;
}

/**
 * Copy-on-write edit of the container holding the last key of `parts`.
 * fn receives the copied parent and the last key and performs the change.
 */
function edit(root: Json, parts: string[], op: Op, fn: (parent: Json, key: string) => void): Json {
  if (parts.length === 0) throw new OpError(op, 'the root cannot be changed');
  const rec = (node: Json, depth: number): Json => {
    if (!isObj(node)) throw new OpError(op, `path does not exist at "${parts.slice(0, depth).join('/') || '/'}"`);
    const copy: Json = Array.isArray(node) ? node.slice() : { ...node };
    const key = parts[depth];
    if (depth === parts.length - 1) { fn(copy, key); return copy; }
    const childKey = Array.isArray(copy) ? arrayIndex(copy, key, op, false) : key;
    if (!Array.isArray(copy) && !(key in copy)) throw new OpError(op, `path does not exist at "${key}"`);
    copy[childKey] = rec(copy[childKey], depth + 1);
    return copy;
  };
  return rec(root, 0);
}

function applyOne(doc: Json, op: Op): { doc: Json; inverse: Op[] } {
  switch (op.op) {
    case 'test': {
      if (!sameJson(getAt(doc, op.path), op.value)) throw new OpError(op, 'value differs from the expected one');
      return { doc, inverse: [] };
    }
    case 'add': {
      let inverse: Op[] = [];
      const next = edit(doc, parsePointer(op.path), op, (parent, key) => {
        if (Array.isArray(parent)) {
          const i = arrayIndex(parent, key, op, true);
          parent.splice(i, 0, clone(op.value));
          inverse = [{ op: 'remove', path: replaceLast(op.path, String(i)) }];
        } else {
          inverse = key in parent ? [{ op: 'replace', path: op.path, value: parent[key] }] : [{ op: 'remove', path: op.path }];
          parent[key] = clone(op.value);
        }
      });
      return { doc: next, inverse };
    }
    case 'remove': {
      let old: Json;
      const next = edit(doc, parsePointer(op.path), op, (parent, key) => {
        if (Array.isArray(parent)) {
          const i = arrayIndex(parent, key, op, false);
          old = parent.splice(i, 1)[0];
        } else {
          if (!(key in parent)) throw new OpError(op, 'nothing to remove');
          old = parent[key];
          delete parent[key];
        }
      });
      return { doc: next, inverse: [{ op: 'add', path: op.path, value: old }] };
    }
    case 'replace': {
      let old: Json;
      const next = edit(doc, parsePointer(op.path), op, (parent, key) => {
        if (Array.isArray(parent)) {
          const i = arrayIndex(parent, key, op, false);
          old = parent[i];
          parent[i] = clone(op.value);
        } else {
          if (!(key in parent)) throw new OpError(op, 'nothing to replace');
          old = parent[key];
          parent[key] = clone(op.value);
        }
      });
      return { doc: next, inverse: [{ op: 'replace', path: op.path, value: old }] };
    }
    case 'move': {
      if (op.path.startsWith(op.from + '/')) throw new OpError(op, 'move into its own content');
      const value = getAt(doc, op.from);
      if (value === undefined) throw new OpError(op, `source not found ${op.from}`);
      const a = applyOne(doc, { op: 'remove', path: op.from });
      const b = applyOne(a.doc, { op: 'add', path: op.path, value });
      return { doc: b.doc, inverse: [...b.inverse, ...a.inverse] };
    }
  }
}

const replaceLast = (path: string, key: string) => path.slice(0, path.lastIndexOf('/') + 1) + key;

/** apply ops in order; all or nothing. Returns the new document and the ops that undo them. */
export function applyOps<T>(doc: T, ops: Op[]): { doc: T; inverse: Op[] } {
  let cur: Json = doc;
  const inverses: Op[][] = [];
  for (const op of ops) {
    const r = applyOne(cur, op);
    cur = r.doc;
    inverses.push(r.inverse);
  }
  return { doc: cur, inverse: inverses.reverse().flat() };
}

// ── history ──────────────────────────────────────────────────
interface Entry { tx: Transaction; inverse: Op[] }

/**
 * Undo/redo over transactions. `check` validates the document after each
 * change and returns error messages; a transaction producing errors is refused.
 */
export class History<T> {
  doc: T;
  private done: Entry[] = [];
  private undone: Entry[] = [];
  private check: (doc: T) => string[];
  private listeners = new Set<(doc: T, tx: Transaction | null) => void>();

  constructor(doc: T, check: (doc: T) => string[] = () => []) {
    this.doc = doc;
    this.check = check;
  }

  /** the document as it would be after tx, without committing (previews of AI proposals) */
  preview(tx: Transaction): T {
    return this.tryApply(tx).doc;
  }

  apply(tx: Transaction): T {
    const r = this.tryApply(tx);
    this.done.push({ tx, inverse: r.inverse });
    this.undone = [];
    return this.set(r.doc, tx);
  }

  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
  get undoLabel() { return this.done.at(-1)?.tx.label ?? null; }
  get redoLabel() { return this.undone.at(-1)?.tx.label ?? null; }

  undo(): T {
    const e = this.done.pop();
    if (!e) return this.doc;
    const r = applyOps(this.doc, e.inverse);
    this.undone.push({ tx: e.tx, inverse: r.inverse });
    return this.set(r.doc, { ...e.tx, label: `annuler : ${e.tx.label}`, ops: e.inverse });
  }

  redo(): T {
    const e = this.undone.pop();
    if (!e) return this.doc;
    const r = applyOps(this.doc, e.inverse);
    this.done.push({ tx: e.tx, inverse: r.inverse });
    return this.set(r.doc, e.tx);
  }

  subscribe(fn: (doc: T, tx: Transaction | null) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private tryApply(tx: Transaction) {
    const r = applyOps(this.doc, tx.ops);
    const errors = this.check(r.doc);
    if (errors.length) throw new Error(`"${tx.label}" refused:\n  ${errors.join('\n  ')}`);
    return r;
  }

  private set(doc: T, tx: Transaction | null): T {
    this.doc = doc;
    for (const fn of this.listeners) fn(doc, tx);
    return doc;
  }
}
