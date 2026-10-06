import { memoryRecords, recordBucket } from '../src/index.ts';
import { storageContract } from './contract.ts';

storageContract('records in memory', () => recordBucket(memoryRecords()));
