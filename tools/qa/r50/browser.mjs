import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const b=await chromium.launch({headless:true}),ctx=await b.newContext(),p=await ctx.newPage(),errors=[],external=[];
ctx.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&u.origin!=='http://127.0.0.1:4190')external.push(r.url());});
p.on('pageerror',e=>errors.push(String(e)));mkdirSync('r50-durable-evidence',{recursive:true});
const call=(name,...args)=>p.evaluate(([k,a])=>r50Qa[k](...a),[name,args]),backup=()=>call('export'),read=()=>call('read');
const samples=[];
try{
 await p.goto('http://127.0.0.1:4190/');await p.locator('body[data-cache-ready="yes"]').waitFor();
 const t=performance.now();await call('init');await call('run','anchor','catchup',{sample:{wallMs:1000,sessionId:'r50',monotonicMs:0}});
 for(let i=1;i<=8;i++)await call('run','quote'+i,'quote',{quoteId:'q'+i,trainId:'t'+i,templateId:'service-template'});
 const cmds=Array.from({length:8},(_,i)=>({commandId:'d'+(i+1),quoteId:'q'+(i+1)}));
 const bulk=await call('run','bulk','bulk',cmds);assert.equal(bulk.result.results.filter(r=>r.ok).length,8);
 const sample={wallMs:121000,sessionId:'r50',monotonicMs:120000};
 let v=await read();for(let i=0;i<16&&(i===0||v.catchupPending);i++){const start=performance.now();v=await call('worker',sample);samples.push(performance.now()-start);}
 assert.equal(v.catchupPending,false);assert.equal(v.snapshot.state.closures.length,8);
 const settled=await call('finance');assert.equal(settled.finance.accounting.liquidityView.reservedCashMinor,'0');
 const head=await read(),race=await p.evaluate(async expected=>Promise.allSettled(Array.from({length:8},(_,i)=>r50Qa.runAt('race-'+i,expected))).then(rs=>rs.map(r=>r.status==='rejected'?{status:r.status,reason:String(r.reason)}:{status:r.status})),{revision:head.revision,tag:head.tag});
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected'&&/STALE_DURABLE_REVISION/.test(x.reason)).length,7);
 const a=await backup(),body=JSON.parse(a.payload);assert.equal(body.snapshot.state.closures.length,8);assert.equal(new Set(body.journal.map(j=>j.requestId)).size,body.journal.length);
 // Exhaust explicit journal budget with bounded zero-credit checkpoint commands.
 for(let i=body.journal.length;i<32;i++)await call('run','fill-'+i,'catchup',{sample:null});
 const full=await backup();assert.equal(JSON.parse(full.payload).journal.length,32);
 await assert.rejects(call('run','over-cap','catchup',{sample:null}),/journal limit/);assert.deepEqual(await backup(),full);
 const replay=await call('run','bulk','bulk',cmds);assert.equal(replay.replayed,true);assert.deepEqual(await backup(),full);
 await assert.rejects(call('run','bulk','bulk',cmds.slice(1)),/command ID conflict/);assert.deepEqual(await backup(),full);
 // Cold page reopen while offline from local precache; authentic save must remain.
 await p.reload();await p.locator('body[data-cache-ready="yes"]').waitFor();for(let i=0;i<60;i++){if(await p.evaluate(()=>!!navigator.serviceWorker.controller))break;await new Promise(r=>setTimeout(r,250));}
 assert.equal(await p.evaluate(()=>!!navigator.serviceWorker.controller),true);await ctx.setOffline(true);await p.reload();await p.getByText('R50 SYNTHETIC QA ONLY').waitFor();assert.deepEqual(await backup(),full);
 await p.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('r47-qa-r50-stress');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,t=db.transaction('slots','readwrite'),s=t.objectStore('slots'),all=s.getAll();all.onsuccess=()=>{const a=all.result.find(x=>x.key.endsWith(':active'));if(!a){reject(Error('no active'));return;}s.put({...a,seal:{...a.seal,payload:'corrupt'}});};t.oncomplete=()=>{db.close();resolve(true);};t.onerror=()=>reject(t.error);};}));
 assert.equal((await read()).recoveryRequired,true);await call('recover');assert.deepEqual(await backup(),full);assert.equal((await read()).recoveryRequired,false);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={trains:8,settlements:8,journalEntries:32,sealPayloadBytes:Buffer.byteLength(full.payload),workerWakeMs:samples,elapsedMs:performance.now()-t,checksum:JSON.parse(full.payload).snapshot.checksum,offlineReload:true,limitRejected:true,idempotentAtLimit:true,competingWriters:8,staleRejected:7,mirrorRecovered:true,externalRequests:0};
 writeFileSync('r50-durable-evidence/durable.json',JSON.stringify(report,null,2)+'\n');console.log('R50_DURABLE PASS '+JSON.stringify(report));
}finally{await ctx.close();await b.close();}
