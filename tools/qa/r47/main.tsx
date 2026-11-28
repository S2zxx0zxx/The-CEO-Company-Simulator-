import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Capacitor} from '@capacitor/core';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {App as NativeApp} from '@capacitor/app';
import {fixture} from '../../../tests/fixtures/railway-r39';
import {createGuestSession} from '../../../src/rail/guest';
import {RailwayGuestShell} from '../../../src/ui/railway/GuestShell';
import {initRailwayPwa} from '../../../src/rail/guest/pwa';
const integrated=import.meta.env.VITE_R49_QA==='1';
const f=await fixture(integrated?{market:true,loan:true,governance:{milestones:[{id:'first-trip',metric:'completed-trips',target:1}]}}:{});
const session=createGuestSession({runtime:f.runtime,opening:f.opening,startSimS:0,seed:123,limits:{maxJournalEntries:100,maxBytes:16000000},offlinePolicy:{schemaVersion:1,maxWallDeltaMs:120000,simSecondsPerWallSecond:1,maxBacklogSimS:120,maxBatchSimS:30,maxBatchEvents:100,maxBatchesPerWake:5,autoSettleArrivals:true},workerTimeoutMs:60000},{qaDatabaseName:'r47-qa-guest'});
const cursor=(v:{revision:number;tag:string})=>({revision:v.revision,tag:v.tag});
Object.assign(globalThis,{r47Qa:{read:()=>session.store.open(),presence:()=>session.store.presence(),export:()=>session.store.exportLatest(),duplicate:()=>session.startGuest(),recover:async(input:unknown)=>session.store.recover(await session.store.recoveryCursor(),input),rejectOptional:async(kind:string)=>{const v=await session.store.open();return session.store.execute({requestId:'r48-forbidden-'+kind,kind,input:{amount:'9999999',verified:true}},cursor(v));},quote:async()=>{const v=await session.store.open();return session.store.execute({requestId:'r47-qa-quote',kind:'quote',input:{quoteId:'q47',trainId:'t1',templateId:'service-template'}},cursor(v));}}});
if(integrated)Object.assign(globalThis,{r49Qa:{management:()=>session.store.management(),finance:()=>session.store.financeView(),progression:()=>session.store.progressionView(),advanceTrip:async()=>{const v=await session.store.open();if(!v.clock)throw Error('QA clock missing');const sample={wallMs:v.clock.wallHighMs+120000,sessionId:'r49-synthetic-clock',monotonicMs:120000};let result=await session.runner.wake(sample);for(let i=0;i<5&&result.catchupPending;i++)result=await session.runner.wake(sample);return result;}}});
function Entry(){const [state,setState]=useState({offlineReady:false,updateReady:false}),[error,setError]=useState('');useEffect(()=>{void initRailwayPwa(setState).catch(e=>setError(String(e)));},[]);return <>{error&&<p role="alert">{error}</p>}<RailwayGuestShell session={session} qa {...state}/></>;}
createRoot(document.getElementById('root')!).render(<Entry/>);
// Native QA records the actual UI-driven guest save and relaunch, not a mocked bridge.
if(Capacitor.isNativePlatform()){
 const events:boolean[]=[];await NativeApp.addListener('appStateChange',e=>events.push(e.isActive));
 const report=async(name:string,value:unknown)=>Filesystem.writeFile({path:name+'.json',data:JSON.stringify(value),directory:Directory.Data,encoding:Encoding.UTF8});
 const stage=await session.store.presence();
 let recorded=false,writing=false;
 setInterval(()=>{if(writing)return;writing=true;void (async()=>{try{
  if(!document.body.innerText.includes('Guest company ready')||await session.store.presence()!=='present')return;
  const v=await session.store.open();if(!v.clock||v.catchupPending)return;
  if(!recorded){if(stage==='absent'){const r=await (globalThis as any).r47Qa.quote();await report('r47-phase',{native:true,platform:Capacitor.getPlatform(),configuration:session.configurationSha256,revision:r.view.revision,tag:r.view.tag,quote:r.result});}else{const seal=await session.store.exportLatest(),body=JSON.parse(seal.payload);if(!body.journal.some((x:any)=>x.requestId==='r47-qa-quote'))throw Error('missing persisted QA quote');await report('r47-final',{native:true,platform:Capacitor.getPlatform(),configuration:session.configurationSha256,revision:v.revision,tag:v.tag,quote:body.journal.find((x:any)=>x.requestId==='r47-qa-quote').result});}recorded=true;}
  await report('r47-lifecycle',{events:[...events],revision:v.revision});
 }catch(e){if(!String(e).includes('STALE_DURABLE_REVISION'))await report('r47-error',{error:String(e)});}finally{writing=false;}})();},1000);
}
