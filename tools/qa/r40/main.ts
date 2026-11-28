import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {fixture} from '../../../tests/fixtures/railway-r39';
import {createRailwayStore} from '../../../src/rail/persistence';
import {createOfflineRunner,bindRailwayLifecycle} from '../../../src/rail/offline/lifecycle';

const native=Capacitor.isNativePlatform(),name='r40-emulator-qa',limits={maxJournalEntries:100,maxBytes:16000000};
const policy={schemaVersion:1,maxWallDeltaMs:120000,simSecondsPerWallSecond:1,maxBacklogSimS:120,maxBatchSimS:30,maxBatchEvents:1,maxBatchesPerWake:1,autoSettleArrivals:true};
const sample=(wallMs:number,monotonicMs=wallMs,sessionId='one')=>({wallMs,monotonicMs,sessionId});
const cursor=(v:{revision:number;tag:string})=>({revision:v.revision,tag:v.tag});
const check=(ok:unknown,msg:string)=>{if(!ok)throw Error(msg);};
async function report(file:string,value:unknown){
 const text=JSON.stringify(value);
 document.body.dataset.phase=file;document.body.textContent=text;
 if(native)await Filesystem.writeFile({path:file+'.json',data:text,directory:Directory.Data,encoding:Encoding.UTF8});
 console.log('R40_DEVICE '+file+' '+text);
}
async function run(){
 const f=await fixture(),create=(databaseName:string,p=policy)=>createRailwayStore(f.runtime,limits,{databaseName,offlinePolicy:p});
 const runner=(databaseName:string,p=policy,mode:'direct'|'worker'='worker')=>createOfflineRunner(f.runtime,limits,{databaseName,offlinePolicy:p,mode,workerTimeoutMs:60000});
 async function seed(databaseName:string,p=policy){
  const s=create(databaseName,p);
  try{
   let v=await s.initialize(0,123,f.opening);
   v=(await s.execute({requestId:'anchor',kind:'catchup',input:{sample:sample(1000)}},cursor(v))).view;
   v=(await s.execute({requestId:'q',kind:'quote',input:{quoteId:'q1',trainId:'t1',templateId:'service-template'}},cursor(v))).view;
   return (await s.execute({requestId:'d',kind:'dispatch',input:{commandId:'c1',quoteId:'q1'}},cursor(v))).view;
  }finally{s.close();}
 }
 const s=create(name);
 let opened:Awaited<ReturnType<typeof s.open>>|undefined;
 try{opened=await s.open();}catch(e){if(!String(e).includes('no trusted save head'))throw e;}finally{s.close();}
 if(!opened){
  await seed(name);
  const r=runner(name);
  try{
   const v=await r.wake(sample(121000));
   check(v.catchupPending&&v.clock?.targetSimS===120&&v.clock.creditedWallMs===120000,'initial checkpoint/backlog');
   await report('r40-phase',{stage:'checkpoint',native,platform:Capacitor.getPlatform(),userAgent:navigator.userAgent,revision:v.revision,tag:v.tag,checksum:v.snapshot.checksum,simTimeS:v.snapshot.simTimeS,creditedWallMs:v.clock?.creditedWallMs});
  }finally{r.close();}
  return;
 }
 check(opened.catchupPending&&opened.clock?.targetSimS===120,'expected persisted interrupted backlog');
 const r=runner(name);
 try{
  let v=opened;
  for(let i=0;i<20&&v.catchupPending;i++)v=await r.wake(sample(121000,0,'reloaded'));
  check(!v.catchupPending&&v.snapshot.simTimeS===120&&v.snapshot.state.closures.length===1,'resumed complete');
  check(v.clock?.creditedWallMs===120000,'elapsed credit duplicated');
  const p={...policy,maxBatchEvents:100,maxBatchSimS:120,maxBatchesPerWake:2};
  await seed(name+'-direct',p);
  const direct=runner(name+'-direct',p,'direct');
  try{
   const baseline=await direct.wake(sample(121000));
   check(!baseline.catchupPending&&baseline.snapshot.checksum===v.snapshot.checksum,'worker/direct canonical checksum mismatch');
   await report('r40-final',{stage:'complete',native,platform:Capacitor.getPlatform(),userAgent:navigator.userAgent,checkpointTag:opened.tag,configurationSha256:f.runtime.configurationSha256,checksum:v.snapshot.checksum,directChecksum:baseline.snapshot.checksum,simTimeS:v.snapshot.simTimeS,creditedWallMs:v.clock?.creditedWallMs,closures:v.snapshot.state.closures.length});
  }finally{direct.close();}
 }finally{r.close();}
 if(native){
  // Separate lifecycle save: real App events must not perturb replay evidence.
  const lifecycleName=name+'-lifecycle',local=create(lifecycleName);
  await local.initialize(0,123,f.opening);local.close();
  const l=runner(lifecycleName);
  const events:boolean[]=[];let progress=0;
  let writes=Promise.resolve();
  const save=()=>{const value={stage:'lifecycle',native,events:[...events],progress};writes=writes.then(()=>report('r40-lifecycle',value));return writes;};
  await App.addListener('appStateChange',e=>{events.push(e.isActive);void save().catch(fatal);});
  await bindRailwayLifecycle(l,{onProgress:()=>{progress++;void save().catch(fatal);},onError:fatal});
 }
}
function fatal(e:unknown){void report('r40-error',{error:String(e),stack:e instanceof Error?e.stack:null});}
void run().catch(fatal);
