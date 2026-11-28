import {fixture} from '../../../tests/fixtures/railway-r39';
import {createGuestSession} from '../../../src/rail/guest';
import {initRailwayPwa} from '../../../src/rail/guest/pwa';
const n=8,limit=32,f=await fixture({stressFleet:n,capacity:n,passengers:n*40+100,energy:String(n*60+300),cash:'1000000',maxPending:n*8+20,maxReceipts:n,maxQuotes:n,maxBulk:n,relocation:false});
const s=createGuestSession({runtime:f.runtime,opening:f.opening,startSimS:0,seed:123,limits:{maxJournalEntries:limit,maxBytes:16000000},offlinePolicy:{schemaVersion:1,maxWallDeltaMs:120000,simSecondsPerWallSecond:1,maxBacklogSimS:120,maxBatchSimS:120,maxBatchEvents:8,maxBatchesPerWake:1,autoSettleArrivals:true},workerTimeoutMs:60000},{qaDatabaseName:'r47-qa-r50-stress'});
const cursor=(v:{revision:number;tag:string})=>({revision:v.revision,tag:v.tag});
async function run(requestId:string,kind:string,input:unknown){const v=await s.store.open();return s.store.execute({requestId,kind,input},cursor(v));}
Object.assign(globalThis,{r50Qa:{n,limit,init:()=>s.startGuest(),read:()=>s.store.open(),export:()=>s.store.exportLatest(),run,runAt:(requestId:string,expected:unknown)=>s.store.execute({requestId,kind:'catchup',input:{sample:null}},expected),recover:async()=>s.store.recover(await s.store.recoveryCursor()),worker:(sample:unknown)=>s.runner.wake(sample),management:()=>s.store.management(),finance:()=>s.store.financeView()}});
document.getElementById('root')!.textContent='R50 SYNTHETIC QA ONLY';
void initRailwayPwa(state=>{if(state.offlineReady)document.body.dataset.cacheReady='yes';});
