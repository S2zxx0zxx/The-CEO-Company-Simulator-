import {App as NativeApp} from '@capacitor/app';
import {nativePlatform} from '../../platform/native';
import {integer} from '../../domain/units';
import {decodeOfflinePolicy,decodeClockSample,type ClockSample} from './index';
import {createRailwayStore} from '../persistence';
import type {prepareDispatch} from '../dispatch';
import type {CatchupWorkerRequest,CatchupWorkerReply} from './catchup.worker';
type Runtime=Awaited<ReturnType<typeof prepareDispatch>>;
type Store=ReturnType<typeof createRailwayStore>;
type View=Awaited<ReturnType<Store['open']>>;
type Result=Awaited<ReturnType<Store['execute']>>;
const cursor=(v:View)=>({revision:v.revision,tag:v.tag});
export function createOfflineRunner(runtime:Runtime,limits:unknown,options:{databaseName?:string;offlinePolicy:unknown;workerTimeoutMs:number;mode:'worker'|'direct'}){
 const policy=decodeOfflinePolicy(options.offlinePolicy),timeout=integer(options.workerTimeoutMs,'worker timeout',1,600000),mode=options.mode;
 if(mode!=='worker'&&mode!=='direct')throw Error('R40: invalid execution mode');
 const storeOptions={databaseName:options.databaseName,offlinePolicy:policy},savedLimits=structuredClone(limits);
 const store=createRailwayStore(runtime,savedLimits,storeOptions);
 let tail:Promise<unknown>=Promise.resolve(),closed=false,active:Worker|undefined,abort:(()=>void)|undefined;
 async function batch(command:unknown,expected:unknown):Promise<Result>{
  if(closed)throw Error('R40: runner closed');
  if(mode==='direct')return store.execute(command,expected);
  if(typeof Worker==='undefined')throw Error('R40: worker unavailable; save remains recoverable');
  const w=new Worker(new URL('./catchup.worker.ts',import.meta.url),{type:'module'});active=w;
  try{return await new Promise<Result>((resolve,reject)=>{
   const timer=setTimeout(()=>finish(Error('R40: worker timed out; reopen durable head before retry')),timeout);
   function finish(error?:Error,result?:Result){clearTimeout(timer);abort=undefined;w.terminate();if(error)reject(error);else resolve(result!);}
   abort=()=>finish(Error('R40: worker stopped; reopen durable head before retry'));
   w.onmessage=(e:MessageEvent<CatchupWorkerReply>)=>e.data.ok?finish(undefined,e.data.result):finish(Error(e.data.error));
   w.onerror=e=>finish(Error(e.message||'R40: worker failed; reopen durable head'));
   w.onmessageerror=()=>finish(Error('R40: invalid worker response'));
   const q:CatchupWorkerRequest={recipe:runtime.workerRecipe,configurationSha256:runtime.configurationSha256,limits:savedLimits,options:storeOptions,command,expected};
   try{w.postMessage(q);}catch(e){finish(e instanceof Error?e:Error(String(e)));}
  });}finally{active=undefined;w.terminate();}
 }
 /** One sample per wake; drain exact persisted target in bounded batches.
  * No automatic retries after unknown commit result. Reload durable head. */
 function wake(sampleInput:unknown,onProgress?:(view:View)=>void){
  const sample=decodeClockSample(sampleInput);
  const job=tail.then(async()=>{
   if(closed)throw Error('R40: runner closed');
   let view=await store.open();if(view.recoveryRequired)throw Error('R40: recover save first');
   for(let i=0;i<policy.maxBatchesPerWake;i++){
    if(closed)throw Error('R40: runner closed');
    if(i>0&&!view.catchupPending)break;
    const r=await batch({requestId:'r40:'+crypto.randomUUID(),kind:'catchup',input:{sample:i===0?sample:null}},cursor(view));
    view=r.view;onProgress?.(view);
   }
   return view;
  });tail=job.then(()=>undefined,()=>undefined);return job;
 }
 return Object.freeze({wake,open:()=>store.open(),close:()=>{closed=true;abort?.();active?.terminate();store.close();}});
}
export function createClockSampler(){
 const sessionId='clock:'+crypto.randomUUID();
 return ():ClockSample=>decodeClockSample({wallMs:Date.now(),sessionId,monotonicMs:Math.floor(performance.now())});
}
/** Host lifecycle adapter. Does not run a forced background service. Pause
 * checkpoint is best effort; durable watermark handles abrupt process death.
 * Call on foreground heartbeat with the same sampler; rendering is not authority. */
export async function bindRailwayLifecycle(runner:ReturnType<typeof createOfflineRunner>,hooks:{onProgress:(v:View)=>void;onError:(e:unknown)=>void;closeRunnerOnDispose?:boolean}){
 const sample=createClockSampler();let disposed=false;
 const wake=()=>{if(!disposed)void runner.wake(sample(),v=>{if(!disposed)hooks.onProgress(v);}).catch(e=>{if(!disposed)hooks.onError(e);});};
 const visibility=()=>wake(),pagehide=()=>wake(),pageshow=()=>wake();
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow);
 let native:Awaited<ReturnType<typeof NativeApp.addListener>>|undefined;
 try{if(nativePlatform)native=await NativeApp.addListener('appStateChange',()=>wake());}
 catch(e){document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);throw e;}
 wake();
 return {wake,dispose:async()=>{disposed=true;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);try{await native?.remove();}finally{if(hooks.closeRunnerOnDispose!==false)runner.close();}}};
}
