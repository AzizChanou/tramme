import 'fake-indexeddb/auto';
import { recordBucket } from '@tramme/api';
import { storageContract } from '../../../packages/api/test/contract.ts';
import { idbRecords } from '../src/local/idb.ts';

// each test its own database, as each visitor's browser has its own
let n = 0;
storageContract('IndexedDB (personal mode)', () => recordBucket(idbRecords(`tramme-test-${++n}`)));
