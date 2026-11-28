import {fixture} from '../../tests/fixtures/railway-r39';
import {auditSnapshot} from '../balance/railway-lab';
import {anchorClock,observeClock} from '../../src/rail/offline';
import {pending,runCatchupBatch} from '../../src/rail/offline/batch';
import {performance} from 'node:perf_hooks';
import {strict as assert} from 'node:assert';
export async function stressFleet(n:number,eventBudget:number,seed=123){
 const started=performance.now(),f=await fixture({stressFleet:n,capacity:n,passengers:n*40+100,energy:String(n*60+300),cash:'1000000',maxPending:n*8+20,maxReceipts:n,maxQuotes:n,maxBulk:n,relocation:false});
 // R50 synthetic only: same model and corridor, explicit capacity, finite demand.
 const c=await f.runtime.initialize(0,seed,f.opening),t0=performance.now();
 let audits=0,peakPending=0,peakSnapshotBytes=0,peakHeapUsedBytes=0;const batchMs:number[]=[];
 async function audit(){const s=c.snapshot();peakPending=Math.max(peakPending,s.pendingEvents.length);peakSnapshotBytes=Math.max(peakSnapshotBytes,Buffer.byteLength(JSON.stringify(s)));peakHeapUsedBytes=Math.max(peakHeapUsedBytes,process.memoryUsage().heapUsed);const v=await auditSnapshot(f,s);audits++;return v;}
 await audit();
 for(let i=1;i<=n;i++)await c.quoteTrip({quoteId:'q'+i,trainId:'t'+i,templateId:'service-template'},c.snapshot().checksum);
 const quoteMs=performance.now()-t0,t1=performance.now(),commands=Array.from({length:n},(_,i)=>({commandId:'d'+(i+1),quoteId:'q'+(i+1)}));
 const bulk=await c.bulkDispatch(commands,c.snapshot().checksum);assert.equal(bulk.results.length,n);assert.ok(bulk.results.every(r=>r.ok),JSON.stringify(bulk.results.filter(r=>!r.ok)));const dispatchMs=performance.now()-t1;
 await audit();
 const policy={schemaVersion:1 as const,maxWallDeltaMs:120000,simSecondsPerWallSecond:1,maxBacklogSimS:120,maxBatchSimS:120,maxBatchEvents:eventBudget,maxBatchesPerWake:1,autoSettleArrivals:true};
 let clock=anchorClock(policy,{wallMs:1000,sessionId:'stress',monotonicMs:0},0);
 clock=observeClock(clock,{wallMs:1000000000,sessionId:'stress-new',monotonicMs:0},0).clock;assert.equal(clock.targetSimS,120);
 let batches=0,events=0,settlements=0;
 while(pending(c,clock)){
  assert.ok(++batches<=n*12+20,'bounded drain failed');const before=c.snapshot(),t=performance.now(),r=await runCatchupBatch(c,clock,policy);batchMs.push(performance.now()-t);
  assert.ok(r.processed.length+r.settled.length<=eventBudget,'event budget exceeded');assert.ok(r.toSimS>before.simTimeS||r.processed.length+r.settled.length>0,'no progress');events+=r.processed.length;settlements+=r.settled.length;await audit();
 }
 assert.equal(c.snapshot().simTimeS,120);assert.equal(settlements,n);assert.equal(c.snapshot().state.closures.length,n);
 const final=await audit();assert.equal(final.settled,n);assert.equal(final.reservedMinor,'0');assert.equal(final.inventory[0].reserved,'0');
 const snapshot=c.snapshot(),restored=await f.runtime.openPersisted(snapshot,c.issuedQuotes());assert.equal(restored.snapshot().checksum,snapshot.checksum);
 const first=snapshot.state.closures[0],replay=await restored.settle({commandId:first.commandId,tripId:first.tripId},'0'.repeat(64));assert.equal(replay.replayed,true);assert.equal(restored.snapshot().checksum,snapshot.checksum);
 await assert.rejects(restored.settle({commandId:'invalid-repeat',tripId:first.tripId},snapshot.checksum),/already closed/);assert.equal(restored.snapshot().checksum,snapshot.checksum);
 assert.equal(observeClock(clock,{wallMs:1000000000,sessionId:'stress-reload',monotonicMs:0},120).creditedSimS,0);
 const sorted=[...batchMs].sort((a,b)=>a-b);
 return {scope:'SYNTHETIC_NOT_PRODUCTION',n,seed,eventBudget,configurationSha256:f.runtime.configurationSha256,checksum:snapshot.checksum,metrics:final,audits,batches,events,settlements,peakPending,peakSnapshotBytes,peakHeapUsedBytes,quoteMs,dispatchMs,batchP95Ms:sorted[Math.ceil(sorted.length*.95)-1],elapsedMs:performance.now()-started};
}
