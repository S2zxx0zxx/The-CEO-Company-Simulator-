import {useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {App as NativeApp} from '@capacitor/app';
import {exportJson} from '../../platform/native';
import type {GuestSession} from '../../rail/guest';
import {bindRailwayLifecycle} from '../../rail/offline/lifecycle';
import {RailwayFleetScreen} from './FleetScreen';
import {RailwayFinanceScreen} from './FinanceScreen';
import {RailwayProgressionScreen} from './ProgressionScreen';
import './fleet.css';
import {OPTIONAL_SERVICES,OPTIONAL_SERVICE_REASON} from '../../rail/optional';
import {readRecoveryEnvelope} from '../../rail/persistence/import';
type View=Awaited<ReturnType<GuestSession['store']['open']>>;
type Tab='home'|'fleet'|'finance'|'progression';
export function RailwayGuestShell({session,qa=false,updateReady=false,offlineReady=false}:{session?:GuestSession;qa?:boolean;updateReady?:boolean;offlineReady?:boolean}){
 const [status,setStatus]=useState<'loading'|'absent'|'present'|'incomplete'|'unconfigured'>('loading'),[view,setView]=useState<View>(),[tab,setTab]=useState<Tab>('home'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [licenses,setLicenses]=useState(''),[licenseError,setLicenseError]=useState('');
 async function showLicenses(){setLicenseError('');try{const response=await fetch('./licenses/RUNTIME_LICENSES.txt');if(!response.ok)throw Error('Local license notices unavailable');setLicenses(await response.text());}catch(e){setLicenseError(String(e));}}
 const wakeRef=useRef<(()=>void)|undefined>(undefined);const activeRef=useRef(false),lock=useRef(false);
 const homeRef=useRef<()=>void>(()=>{});
 const acceptView=(v:View)=>setView(old=>!old||v.revision>=old.revision?v:old);
 const report=(e:unknown)=>setError(e instanceof Error?e.message:String(e));
 useEffect(()=>{let live=true;if(!session){setStatus('unconfigured');return;}
  session.store.presence().then(s=>{if(live)setStatus(s);},e=>{if(live){setStatus('incomplete');report(e);}});
  return()=>{live=false;};
 },[session]);
 const entered=!!view;
 useEffect(()=>{if(!session||!entered||view?.recoveryRequired)return;let gone=false;let stop:(()=>Promise<void>)|undefined;
  activeRef.current=true;
  void bindRailwayLifecycle(session.runner,{closeRunnerOnDispose:false,onProgress:v=>{if(!gone)acceptView(v);},onError:e=>{if(!gone)report(e);}}).then(b=>{if(gone)void b.dispose();else{stop=b.dispose;wakeRef.current=b.wake;}}).catch(e=>{if(!gone)report(e);});
  return()=>{gone=true;activeRef.current=false;wakeRef.current=undefined;if(stop)void stop();};
 },[session,entered,view?.recoveryRequired]);
 useEffect(()=>{if(!Capacitor.isNativePlatform())return;let gone=false;let h:Awaited<ReturnType<typeof NativeApp.addListener>>|undefined;
  void NativeApp.addListener('backButton',()=>{if(!document.querySelector('main[aria-busy="true"]'))homeRef.current();}).then(x=>{if(gone)void x.remove();else h=x;}).catch(report);
  return()=>{gone=true;void h?.remove();};
 },[]);
 async function run(f:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await f();}catch(e){report(e);}finally{lock.current=false;setBusy(false);}}
 const enter=(fresh:boolean)=>run(async()=>{if(!session)return;const v=await(fresh?session.startGuest():session.resume());setStatus('present');setView(v);});
 const recover=()=>run(async()=>{if(!session||!view)return;setView(await session.store.recover({revision:view.revision,tag:view.tag}));setNotice('Latest authenticated mirror restored.');});
 const exportSave=()=>run(async()=>{if(!session)return;await exportJson('railway-save.json',JSON.stringify(await session.store.exportLatest()));setNotice('Authenticated same-installation recovery export prepared.');});
 async function restoreFile(file:File){await run(async()=>{if(!session)throw Error('No configured guest company');const envelope=await readRecoveryEnvelope(file);const expected=await session.store.recoveryCursor(),restored=await session.store.recover(expected,envelope);setStatus('present');setView(restored);setNotice('Matching latest authenticated save restored.');});}
 const home=()=>{setTab('home');if(session&&entered)void session.store.open().then(acceptView).catch(report);};
 homeRef.current=home;
 const ready=!!session&&!!view&&!view.recoveryRequired&&!!view.clock&&!view.catchupPending;
 if(ready&&tab!=='home')return <>{error&&<p role="alert">{error}</p>}{tab==='fleet'?<RailwayFleetScreen store={session!.store} onExit={home}/>:tab==='finance'?<RailwayFinanceScreen store={session!.store} onExit={home}/>:<RailwayProgressionScreen store={session!.store} onExit={home}/>}</>;
 return <main className="rf" aria-label="Railway guest entry" aria-busy={busy}><header className="rf-top"><div><small>{qa?'SYNTHETIC QA — NOT RELEASE':'DEVELOPMENT BUILD'}</small><h1>Railway management</h1></div></header>
 <section className="rf-card"><h2>{entered?'Guest company':'Play offline as guest'}</h2><p>No login, account linking or network service required.</p>
 {status==='loading'&&<p>Checking local save…</p>}
 {status==='unconfigured'&&<p role="status">No approved railway starter scenario is installed. Company creation is unavailable; existing storage is not modified.</p>}
 {status==='incomplete'&&<p role="alert">Incomplete or inaccessible save. No replacement company will be created automatically.</p>}
 {!entered&&status==='absent'&&<button disabled={busy} onClick={()=>void enter(true)}>Start guest company</button>}
 {!entered&&status==='present'&&<button disabled={busy} onClick={()=>void enter(false)}>Resume guest company</button>}
 {entered&&view&&<><p>Company: {session?.companyId} · saved revision <span data-testid="revision">{view.revision}</span></p>
 <p>{view.recoveryRequired?'Save recovery required':!view.clock?'Anchoring offline clock':view.catchupPending?'Offline catch-up pending':'Guest company ready'}</p>
 {view.recoveryRequired&&<button disabled={busy} onClick={()=>void recover()}>Recover latest mirror</button>}
 {!view.recoveryRequired&&<button disabled={busy||!activeRef.current} onClick={()=>wakeRef.current?.()}>Continue offline catch-up</button>}
 <button disabled={!ready||busy} onClick={()=>setTab('fleet')}>Operations</button><button disabled={!ready||busy} onClick={()=>setTab('finance')}>Finance</button><button disabled={!ready||busy} onClick={()=>setTab('progression')}>Progression</button>
 <button disabled={busy} onClick={()=>void exportSave()}>Export recovery file</button>
 </>}
 {(status==='present'||status==='incomplete')&&<><label>Restore matching recovery file<input type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void restoreFile(f);}}/></label><p>Recovery is bound to this installation and latest trusted save. Cross-device transfer is not enabled.</p></>}
 </section><section className="rf-card"><h2>Offline availability</h2><p>{Capacitor.isNativePlatform()?'Bundled Android application':offlineReady?'Offline cache ready':'Offline cache not confirmed'}</p>
 {updateReady&&<p role="status">Update downloaded. Return to this screen, finish any active actions, close all railway tabs, then reopen. No forced reload.</p>}
 <h2>Optional services</h2><p>{OPTIONAL_SERVICE_REASON}</p><dl aria-label="Optional service availability">{Object.entries(OPTIONAL_SERVICES).map(([key,value])=><div key={key} className="rf-pair"><dt>{key}</dt><dd>{value?'Enabled':'Disabled'}</dd></div>)}</dl><p>No advertising or tracking consent is requested. Simulated company finances are not real-money purchases.</p><h2>Third-party software notices</h2><button onClick={()=>void showLicenses()}>Read offline licenses</button>{licenseError&&<p role="alert">{licenseError}</p>}{licenses&&<pre aria-label="Runtime license notices" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'20rem',overflow:'auto'}}>{licenses}</pre>}<h2>Local data and privacy</h2><p>Game progress is stored on this device. Saves are authenticated, not encrypted. Recovery files contain simulated company history; share only with a destination you trust. Clearing app or site data removes the local key and saves; exported copies remain in your chosen destination. Hosting may receive normal connection metadata when loading the web app. No remote account or gameplay tracking is configured in this development build.</p><h2>Help</h2><p>Use the guest company without signing in. Save recovery does not create a new company. Available language: English. Other languages and account linking are not configured.</p></section>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</main>;
}
