// Records in IndexedDB: what the personal mode keeps in the browser. The
// projects (through the service worker, sw.ts) and, in its own origin, the
// key vault's keys. A record holds its file as a Blob: the browser keeps it on
// disk, and a range reads only its part.

import type { RecordStore, StoredRecord } from '@tramme/api';

const STORE = 'records';

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transaction aborted'));
});

const result = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

function open(name: string): Promise<IDBDatabase> {
  const r = indexedDB.open(name, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'key' }); };
  return result(r);
}

/** the records of database `name` (one per origin is enough: the editor's and the vault's are apart) */
export function idbRecords(name = 'tramme'): RecordStore {
  let db: Promise<IDBDatabase> | null = null;
  const store = async (mode: IDBTransactionMode) => {
    db ??= open(name).catch((e) => { db = null; throw e; });
    const tx = (await db).transaction(STORE, mode);
    return { tx, store: tx.objectStore(STORE) };
  };
  return {
    async get(key) {
      const { store: s } = await store('readonly');
      return (await result(s.get(key))) as StoredRecord | undefined;
    },
    async put(record, check) {
      const { tx, store: s } = await store('readwrite');
      let written = true;
      // read and written in the same transaction: no other tab writes in between
      const current = s.get(record.key);
      current.onsuccess = () => {
        if (check && !check(current.result as StoredRecord | undefined)) written = false;
        else s.put(record);
      };
      await done(tx);
      return written;
    },
    async delete(keys) {
      if (!keys.length) return;
      const { tx, store: s } = await store('readwrite');
      for (const k of keys) s.delete(k);
      await done(tx);
    },
    async list(prefix) {
      const { store: s } = await store('readonly');
      const all = await result(prefix ? s.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)) : s.getAll());
      return all as StoredRecord[];
    },
  };
}
