import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext(),page=await ctx.newPage(),other=await ctx.newPage();
 await Promise.all([page.goto('http://127.0.0.1:4173/'),other.goto('http://127.0.0.1:4173/')]);
 const setup=async p=>p.evaluate(async()=>{
  const {fixture}=await import('/tests/fixtures/railway-r39.ts'),{createRailwayStore}=await import('/src/rail/persistence/index.ts'),{createOfflineRunner,bindRailwayLifecycle}=await import('/src/rail/offline/lifecycle.ts');
  const f=await fixture(),limits={maxJournalEntries:100,maxBytes:16000000};
  const policy={schemaVersion:1,maxWallDeltaMs:120000,simSecondsPerWallSecond:1,maxBacklogSimS:120,maxBatchSimS:30,maxBatchEvents:1,maxBatchesPerWake:1,autoSettleArrivals:true};
  const sample=(wallMs,monotonicMs=wallMs,sessionId='one')=>({wallMs,monotonicMs,sessionId});
  const cursor=v=>({revision:v.revision,tag:v.tag}),cmd=(requestId,kind,input)=>({requestId,kind,input});
  const create=(databaseName,p=policy)=>createRailwayStore(f.runtime,limits,{databaseName,offlinePolicy:p});
  const runner=(databaseName,p=policy,mode='worker')=>createOfflineRunner(f.runtime,limits,{databaseName,offlinePolicy:p,mode,workerTimeoutMs:30000});
  const check=(v,m)=>{if(!v)throw Error(m);},rejects=async(fn,pattern)=>{try{await fn();}catch(e){if(!pattern||String(e).includes(pattern))return;throw e;}throw Error('expected rejection '+pattern);};
  async function seed(name,p=policy){const s=create(name,p);let v=await s.initialize(0,123,f.opening);await rejects(()=>s.execute(cmd('raw','advance',{target:5,budget:1}),cursor(v)),'offline clock');v=(await s.execute(cmd('anchor','catchup',{sample:sample(1000)}),cursor(v))).view;v=(await s.execute(cmd('q','quote',{quoteId:'q1',trainId:'t1',templateId:'service-template'}),cursor(v))).view;v=(await s.execute(cmd('d','dispatch',{commandId:'c1',quoteId:'q1'}),cursor(v))).view;s.close();return v;}
  globalThis.r40={f,limits,policy,sample,cursor,cmd,create,runner,seed,check,rejects,bindRailwayLifecycle};
 });
 await setup(page);await setup(other);
 const baseline=await page.evaluate(async()=>{const x=r40,p={...x.policy,maxBatchEvents:100,maxBatchSimS:120,maxBatchesPerWake:2};await x.seed('r40-baseline',p);const runner=x.runner('r40-baseline',p,'direct'),v=await runner.wake(x.sample(121000));x.check(!v.catchupPending&&v.snapshot.simTimeS===120&&v.snapshot.state.closures.length===1,'baseline complete');runner.close();return v.snapshot;});
 const initial=await page.evaluate(async()=>{const x=r40;return x.cursor(await x.seed('r40-worker'));});
 await page.evaluate(async()=>{const x=r40,s=x.create('r40-worker'),v=await s.open(),before=await s.exportLatest();const tripId=v.snapshot.state.receipts[0].tripId;await x.rejects(()=>s.execute(x.cmd('poison','cancel',{commandId:'r40:settle:'+tripId,tripId}),x.cursor(v)),'reserved automatic settlement command ID');x.check(JSON.stringify(await s.exportLatest())===JSON.stringify(before),'reserved namespace attack must leave durable state unchanged');s.close();});
 console.log('PASS reserved automatic settlement ID cannot be claimed by manual command');
 const race=await Promise.all([page,other].map((p,i)=>p.evaluate(async({initial,i})=>{const x=r40,s=x.create('r40-worker');try{const r=await s.execute(x.cmd('race-'+i,'catchup',{sample:x.sample(121000)}),initial);return {ok:true,view:r.view};}catch(e){return {ok:false,error:String(e)};}finally{s.close();}},{initial,i})));
 assert.equal(race.filter(x=>x.ok).length,1);assert.match(race.find(x=>!x.ok).error,/STALE_DURABLE_REVISION/);
 const won=race.find(x=>x.ok).view;assert.equal(won.clock.targetSimS,120);assert.equal(won.clock.creditedWallMs,120000);assert.equal(won.catchupPending,true);
 console.log('PASS cross-tab offline credit and persistent bounded backlog');
 await page.evaluate(async()=>{const x=r40,s=x.create('r40-worker'),v=await s.open(),before=await s.exportLatest();await x.rejects(()=>s.execute(x.cmd('park','fleet',{commandId:'park',trainId:'t2',action:'park',yardId:'yard-a'}),x.cursor(v)),'catch-up');
 const put=IDBObjectStore.prototype.put;let attempted=false;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='slots'&&value.key==='co:active')attempted=true;if(this.name==='slots'&&value.key==='co:mirror')throw new DOMException('interrupted','AbortError');return put.call(this,value,...args);};
 try{await x.rejects(()=>s.execute(x.cmd('abort','catchup',{sample:null}),x.cursor(v)));}finally{IDBObjectStore.prototype.put=put;}
 x.check(attempted&&JSON.stringify(await s.exportLatest())===JSON.stringify(before),'offline batch rollback');s.close();
 });
 console.log('PASS interrupted catch-up preserves previous head and blocks commands during backlog');
 await other.reload();await setup(other);
 const resumed=await other.evaluate(async()=>{const x=r40,runner=x.runner('r40-worker');let v=await runner.open();for(let i=0;i<20&&v.catchupPending;i++)v=await runner.wake(x.sample(121000,0,'reloaded'));x.check(!v.catchupPending,'bounded resume eventually completes');x.check(v.clock.creditedWallMs===120000,'no elapsed duplication after reload');runner.close();return v;});
 assert.deepEqual(resumed.snapshot,baseline);
 console.log('PASS actual module worker and direct execution partition equivalence including arrival settlement');
 await page.evaluate(async()=>{const x=r40,s=x.create('r40-worker'),v=await s.open(),a=await s.execute(x.cmd('rollback','catchup',{sample:x.sample(110000,1,'reloaded')}),x.cursor(v));x.check(a.view.clock.rollbackCount===1&&a.view.snapshot.checksum===v.snapshot.checksum,'rollback no simulation');const replay=await s.execute(x.cmd('rollback','catchup',{sample:x.sample(110000,1,'reloaded')}),x.cursor(v));x.check(replay.replayed&&replay.view.clock.rollbackCount===1,'idempotent clock replay');const b=await s.execute(x.cmd('same','catchup',{sample:x.sample(121000,2,'reloaded')}),x.cursor(a.view));x.check(b.view.snapshot.checksum===v.snapshot.checksum&&b.view.snapshot.state.closures.length===1,'restored wall does not repeat settlement');
 const wrong=x.create('r40-worker',{...x.policy,maxBatchSimS:31});await x.rejects(()=>wrong.open(),'no valid latest');wrong.close();s.close();});
 console.log('PASS rollback, replay, policy mismatch and no duplicate settlement');
 await page.evaluate(async()=>{const x=r40,s=x.create('r40-lifecycle');await s.initialize(0,123,x.f.opening);s.close();const r=x.runner('r40-lifecycle',x.policy,'direct');let calls=0;const errors=[];const h=await x.bindRailwayLifecycle(r,{onProgress:()=>calls++,onError:e=>errors.push(String(e))});globalThis.life40={h,get calls(){return calls},errors};});
 await page.waitForFunction(()=>life40.calls>=1);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await page.waitForFunction(()=>life40.calls>=2);
 await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
 await page.waitForFunction(()=>life40.calls>=3);
 await page.evaluate(async()=>{if(life40.errors.length)throw Error(life40.errors.join(';'));await life40.h.dispose();});
 console.log('PASS actual page lifecycle adapter checkpoints and resumes');
 console.log('R40_BROWSER_ACCEPTANCE PASS');
 await ctx.close();
}finally{await browser.close();}
