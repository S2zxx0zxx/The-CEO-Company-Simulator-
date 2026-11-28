import {describe,it,expect} from 'vitest';
import {fixture} from './fixtures/railway-r39';
import {createGuestSession,RAILWAY_SAVE_NAMESPACE} from '../src/rail/guest';
describe('R47 guest boundary',()=>{
 it('retains the exact separate R39 database identity',()=>expect(RAILWAY_SAVE_NAMESPACE).toBe('railway-ceo-save-v1'));
 it('rejects a legacy or arbitrary QA namespace before creating a store',async()=>{const f=await fixture();expect(()=>createGuestSession({runtime:f.runtime,opening:f.opening,startSimS:0,seed:123,limits:{},offlinePolicy:{},workerTimeoutMs:1},{qaDatabaseName:'the-ceo'})).toThrow('invalid QA namespace');});
});
