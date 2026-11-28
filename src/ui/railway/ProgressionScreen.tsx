import {useEffect,useState} from 'react';
import type {createRailwayStore} from '../../rail/persistence';
import './fleet.css';
type Store=ReturnType<typeof createRailwayStore>;
type Data=Awaited<ReturnType<Store['progressionView']>>;
export function RailwayProgressionScreen({store,onExit}:{store:Store;onExit?:()=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=async()=>{try{setData(await store.progressionView());}catch(e){setError(String(e));}};
 useEffect(()=>{let live=true;store.progressionView().then(x=>{if(live)setData(x);},e=>{if(live)setError(String(e));});return()=>{live=false;};},[store]);
 async function claim(missionId:string){
  if(!data||busy)return;
  setBusy(true);setError('');
  try{await store.execute({requestId:'r45:'+crypto.randomUUID(),kind:'achievement',input:{missionId}},{revision:data.view.revision,tag:data.view.tag});await refresh();}
  catch(e){setError(String(e));await refresh();}finally{setBusy(false);}
 }
 return <main className="rf" aria-label="Railway progression" aria-busy={busy}>
  <header><h1>Company progression</h1>{onExit&&<button disabled={busy} onClick={onExit}>Back</button>}<button disabled={busy} onClick={()=>void refresh()}>Refresh</button></header>
  {error&&<p role="alert">{error}</p>}
  {!data?<p>Loading verified milestones…</p>:<>
   <h2>Achievements</h2><p>Recognition only; no cash or research currency granted.</p>
   {data.missions.length===0&&<p>No approved milestones configured.</p>}
   {data.missions.map(m=><section className="rf-card" key={m.id}><h3>{m.id}</h3><p>{m.metric}: {m.progress} / {m.target}</p><progress value={m.progress} max={m.target}/><button disabled={busy||!m.claimable||data.view.recoveryRequired||data.view.catchupPending===true} onClick={()=>void claim(m.id)}>{m.claim?'Claimed':m.completed?'Claim recognition':'Incomplete'}</button></section>)}
   <h2>Expansion eligibility</h2>{data.unlocks.map(u=><section className="rf-card" key={u.id}><h3>{u.id}</h3><p>{u.eligible?'Eligible':u.missing.join(', ')}</p></section>)}
   <h2>Events</h2>{data.events.length===0&&<p>No approved event schedule configured.</p>}{data.events.map(e=><section key={e.id} className="rf-card"><h3>{e.id}</h3><p>{e.kind} · {e.status}</p><p>Simulation seconds {e.startSimS}–{e.endSimS}</p>{e.stationIds.length>0&&<p>Stations: {e.stationIds.join(", ")}</p>}</section>)}<p>Economic and speed effects disabled until approved.</p><h2>Rankings and IPO</h2><p>Offline rival dataset and fictional IPO policy pending; online alliances and investment disabled.</p>
  </>}
 </main>;
}
