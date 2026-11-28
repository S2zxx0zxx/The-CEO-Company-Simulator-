import {useEffect,useRef,useState,type ReactNode} from 'react';
import {TrainFront,Route,Warehouse,Wrench,ClipboardList,RefreshCw,ShieldCheck} from 'lucide-react';
import type {createRailwayStore} from '../../rail/persistence';
import {bindRailwayLifecycle,type createOfflineRunner} from '../../rail/offline/lifecycle';
import './fleet.css';
import {RailwayCatalogPanel} from './CatalogPanel';

type Store=ReturnType<typeof createRailwayStore>;
type Runner=ReturnType<typeof createOfflineRunner>;
type Data=Awaited<ReturnType<Store['management']>>;
type M=Data['management'];type Row=M['rows'][number];type Template=M['templates'][number];type Offer=M['quotes'][number];
type Kind='quote'|'dispatch'|'bulk'|'fleet'|'settle'|'cancel';
type Command={requestId:string;kind:Kind;input:unknown};
type Checked={command:Command;cursor:{revision:number;tag:string};label:string;result:unknown};
const cursor=(d:Data)=>({revision:d.view.revision,tag:d.view.tag});
const id=()=>crypto.randomUUID();
const command=(kind:Kind,input:unknown):Command=>({requestId:'ui:'+id(),kind,input});
const money=(v:string)=>{const n=BigInt(v),a=n<0n?-n:n;return (n<0n?'−':'')+'₹'+(a/100n).toLocaleString('en-IN')+'.'+String(a%100n).padStart(2,'0');};
const duration=(s:number)=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+'h ':'')+m+'m '+s%60+'s';};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const routeName=(t:Template)=>t.stations.map(s=>s.name).join(' → ');
const isLive=(o:Offer,m:M)=>o.quote.quote.stateVersion===m.stateRevision&&o.quote.quote.expiresAtSimS>m.simTimeS&&!m.trips.some(t=>t.receipt.quoteId===o.quote.quote.id);
function Pair({label,children}:{label:string;children:ReactNode}){return <div className="rf-pair"><span>{label}</span><strong>{children}</strong></div>;}
function Blocked({children}:{children:ReactNode}){return <p className="rf-blocked"><ShieldCheck size={16} aria-hidden="true"/>{children}</p>;}
function Disabled({label,reason}:{label:string;reason:string}){return <div className="rf-disabled"><button type="button" disabled>{label}</button><small>{reason}</small></div>;}
function QuoteCard({offer}:{offer:Offer}){
 const q=offer.quote.quote;
 return <section className="rf-card rf-quote"><h3>Locked departure quote</h3>
  <Pair label="Train">{q.trainId}</Pair><Pair label="Expected revenue">{money(q.expectedRevenueMinor)}</Pair>
  <Pair label="Expected cost">{money(q.expectedCostMinor)}</Pair><Pair label="Expected margin">{money(String(BigInt(q.expectedRevenueMinor)-BigInt(q.expectedCostMinor)))}</Pair>
  <Pair label="Cash reserve (not expense)">{money(q.reserveMinor)}</Pair><Pair label="Distance">{q.route.distanceM.toLocaleString()} m</Pair>
  <Pair label="Expires at simulation second">{q.expiresAtSimS}</Pair>
  <h4>Required energy</h4>{q.energy.length?q.energy.map(e=><Pair key={e.unit} label={e.unit}>{e.quantity}</Pair>):<p>No energy reservation in this quote.</p>}
  <h4>Demand buckets</h4><p>{q.demandBucketIds.join(', ')||'None — noncommercial route'}</p>
  {offer.quote.risks.map(r=><p className="rf-blocked" key={r.id}>{r.reason}</p>)}
  <details><summary>Quote verification</summary><p>State revision {q.stateVersion}</p><code>{offer.quoteSha256}</code><code>{q.route.graphSha256}</code><code>{q.policySha256}</code></details>
 </section>;
}
function TemplateCard({t}:{t:Template}){
 return <div className="rf-card"><h3>{t.relocationYardId?'Relocation':'Configured route'}</h3>
  <ol className="rf-stops">{t.stations.map((s,i)=><li key={i}>{s.name}<small>{s.id}</small></li>)}</ol>
  <Pair label="Distance">{t.route.distanceM.toLocaleString()} m</Pair><Pair label="Scheduled duration">{duration(t.durationS)}</Pair>
  <Pair label="Path">{t.route.edgeIds.join(' → ')}</Pair>
  {t.relocationYardId&&<Pair label="Authorized arrival yard">{t.relocationYardId}</Pair>}
  <h4>Ticketing & freight terms</h4>
  {t.claims.length===0?<p>No passenger or freight sale.</p>:t.claims.map(c=><div className="rf-sub" key={c.bucketId}><strong>{c.pricing.kind==='passenger'?c.pricing.classId:'Freight'} · {c.bucketId}</strong><Pair label="Requested units">{c.requested}</Pair><Pair label="Board / alight">{t.stations[c.boardIndex]?.name} → {t.stations[c.alightIndex]?.name}</Pair>{c.pricing.kind==='passenger'?<><Pair label="Base fare">{money(c.pricing.policy.baseMinor)}</Pair><Pair label="Per km">{money(c.pricing.policy.rateMinorPerKm)}</Pair><Pair label="Discount">{c.pricing.policy.discountBps/100}%</Pair><Pair label="Fare cap">{money(c.pricing.policy.capMinor)}</Pair></>:<><Pair label="Per tonne-km">{money(c.pricing.rateMinorPerTonneKm)}</Pair><Pair label="Service factor">{c.pricing.serviceFactorBps/100}%</Pair></>}</div>)}
  {t.inspection&&<><Pair label="Inspection">{t.inspection.inspectionMode}</Pair><Pair label="Checked / collected">{t.inspection.checkedBps/100}% / {t.inspection.collectedBps/100}%</Pair><Pair label="Subsidy programme">{t.inspection.subsidyProgramId??'None'}</Pair>{t.inspection.refunds.map(r=><Pair key={r.classId} label={'Refund / paid '+r.classId}>{money(r.minorPerPaid)}</Pair>)}</>}
  {t.inferences.map((r,i)=><p className="rf-blocked" key={i}>Route inference: {r.edgeId} / {r.field}</p>)}
  {t.risks.map(r=><p className="rf-blocked" key={r.id}>{r.reason}</p>)}
  <Disabled label="Edit stops, alternate tracks, name or colour" reason="Route creation and licensed configuration mutation are not yet available."/>
  <Disabled label="Edit fares / auto-set fares" reason="Fare policies are locked to the approved route template."/>
 </div>;
}
function TrainCard({row:r}:{row:Row}){
 const m=r.model.model;
 return <section className="rf-card"><h3>{r.model.name} <span className="rf-state">{r.state}</span></h3>
 <Pair label="Train ID">{r.trainId}</Pair><Pair label="Actual location">{r.nodeId===null?'Moving between nodes':r.location?.map(x=>x.name).join(', ')||r.nodeId}</Pair>
 <Pair label="Condition">{r.condition.conditionBps/100}%</Pair><progress aria-label="Train condition" max={10000} value={r.condition.conditionBps}/>
 <Pair label="Odometer">{r.condition.odometerM.toLocaleString()} m</Pair>
 <Pair label="Maintenance">{r.maintenance.availability}</Pair><Pair label="Yard">{r.yardId??'None'}</Pair>
 <Pair label="Reserved arrival yard">{r.inboundYardId??'None'}</Pair><Pair label="Assigned route">{r.routeId??'None'}</Pair>
 {r.trip&&<><Pair label="Departure simulation second">{r.trip.departureSimS}</Pair><Pair label="Expected arrival second">{r.trip.expectedArrivalSimS}</Pair></>}
 {r.maintenance.activeJob&&<><Pair label="Service ends at second">{r.maintenance.activeJob.job.endS}</Pair><Pair label="Locked service cost">{money(r.maintenance.activeJob.job.costMinor)}</Pair><Pair label="Target condition">{r.maintenance.activeJob.targetConditionBps/100}%</Pair></>}
 {'traction' in m&&<><Pair label="Traction">{m.traction}</Pair><Pair label="Speed ceiling">{m.maxSpeedKmh} km/h</Pair><Pair label="Seats">{m.capacitySeats}</Pair><Pair label="Cargo capacity">{m.cargoCapacityKg} kg</Pair><Pair label="Track gauge">{m.gaugesMm.join(', ')} mm</Pair><Pair label="Electrical supply">{m.voltagesV.length?m.voltagesV.join(', ')+' V / '+m.frequenciesHz.join(', ')+' Hz':'Not electric'}</Pair></>}
 </section>;
}
function TerminalCard({t}:{t:M['trips'][number]}){
 return <article className="rf-card"><h3>{t.receipt.trainId} · {t.closure?.outcome??'Open trip'}</h3><Pair label="Trip">{t.receipt.tripId}</Pair><Pair label="Template">{t.receipt.templateId}</Pair><Pair label="Departure second">{t.receipt.atSimS}</Pair>
 {t.closure?<><Pair label="Actual arrival second">{t.closure.arrivalSimS??'Cancelled'}</Pair><Pair label="Actual distance">{t.closure.distanceM} m</Pair><Pair label="Settled at second">{t.closure.atSimS}</Pair></>:<p>Revenue is not recognized until actual settlement.</p>}
 {t.revenue&&<><h4>Actual revenue</h4><Pair label="Passenger gross">{money(t.revenue.passengerGrossMinor)}</Pair><Pair label="Cargo gross">{money(t.revenue.cargoGrossMinor)}</Pair><Pair label="Refunds">{money(t.revenue.passengerRefundMinor)}</Pair><Pair label="Delay penalty">{money(t.revenue.delayPenaltyMinor)}</Pair><Pair label="Missed fare (not expense)">{money(t.revenue.unpaidFaceValueMinor)}</Pair><Pair label="Net ticket/cargo revenue">{money(t.revenue.netRevenueMinor)}</Pair></>}
 {t.energy?.closed&&<><h4>Actual energy</h4><Pair label="Energy cost">{money(t.energy.closed.totalCostMinor)}</Pair>{t.energy.closed.consumed.map((e,i)=><Pair key={i} label={e.unit+' · '+e.lotId}>{e.quantity} / {money(e.costMinor)}</Pair>)}</>}
 {t.postings.length>0&&<details open><summary>Actual accounting postings</summary>{t.postings.map((p,i)=><Pair key={i} label={p.accountId}>{p.debitMinor!=='0'?'Dr '+money(p.debitMinor):'Cr '+money(p.creditMinor)}</Pair>)}</details>}
 </article>;
}
export function RailwayFleetScreen({store,runner,onExit}:{store:Store;runner?:Runner;onExit?:()=>void}){
 const [data,setData]=useState<Data>(),[tab,setTab]=useState<'fleet'|'routes'|'yard'|'receipts'|'catalog'>('fleet'),[train,setTrain]=useState(''),[template,setTemplate]=useState(''),[yard,setYard]=useState(''),[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string[]>([]),[checked,setChecked]=useState<Checked>(),[retry,setRetry]=useState<Checked>(),[feedback,setFeedback]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const gate=useRef(false),mounted=useRef(false),refreshGeneration=useRef(0),wakeRef=useRef<(()=>void)|undefined>(undefined);
 const refresh=async()=>{const gen=++refreshGeneration.current;const d=await store.management();if(mounted.current&&gen===refreshGeneration.current){setData(d);setChecked(old=>old&&old.cursor.tag===d.view.tag?old:undefined);}return d;};
 useEffect(()=>{mounted.current=true;let disposed=false,cleanup:(()=>Promise<void>)|undefined;
  void refresh().catch(e=>{if(!disposed)setError(err(e));});
  if(runner)void bindRailwayLifecycle(runner,{onProgress:()=>{void refresh().catch(e=>{if(!disposed)setError(err(e));});},onError:e=>{if(!disposed)setError(err(e));}}).then(x=>{if(disposed)void x.dispose();else{cleanup=x.dispose;wakeRef.current=x.wake;}}).catch(e=>{if(!disposed)setError(err(e));});
  return()=>{disposed=true;mounted.current=false;refreshGeneration.current++;wakeRef.current=undefined;void cleanup?.();};
 },[store,runner]);
 const run=async(fn:()=>Promise<void>)=>{if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await fn();}catch(e){if(mounted.current)setError(err(e));}finally{gate.current=false;if(mounted.current)setBusy(false);}};
 const m=data?.management,r=m?.rows.find(x=>x.trainId===train),t=m?.templates.find(x=>x.id===template&&x.modelId===r?.model.model.id);
 const quote=m&&m.quotes.find(o=>o.templateId===template&&o.quote.quote.trainId===train&&isLive(o,m));
 const live=m?m.quotes.filter(o=>isLive(o,m)):[];
 const blocked=data?.view.recoveryRequired?'Save recovery required':data?.view.catchupPending?'Offline backlog must finish first':runner&&!data?.view.clock?'Waiting for offline clock anchor':'';
 const reset=()=>{setChecked(undefined);setFeedback('');};
 const chooseTrain=(v:string)=>{if(gate.current)return;reset();setTrain(v);setTemplate('');setYard('');};
 const preview=(label:string,cmd:Command)=>void run(async()=>{if(!data)return;setChecked(undefined);const e=cursor(data),result=await store.checkManagement(cmd,e);if(!result.ok){setError(result.reason);await refresh();return;}setChecked({label,command:cmd,cursor:e,result:result.result});setFeedback('Validation passed against saved revision '+e.revision+'. Confirm to commit.');});
 const commit=(p:Checked)=>void run(async()=>{setChecked(undefined);setRetry(p);
  try{const result=await store.execute(p.command,p.cursor);setRetry(undefined);const bulk=p.command.kind==='bulk'?(result.result as {results:{commandId:string;ok:boolean;reason?:string}[]}).results:null;
   setFeedback(bulk?bulk.map(x=>x.commandId+': '+(x.ok?'Dispatched':x.reason)).join('\n'):(result.replayed?'Already committed (replay): ':'Committed: ')+p.label);setSelected([]);await refresh();
  }catch(e){setError(err(e)+' — refresh and check the durable receipt before retrying.');try{await refresh();}catch{/* preserve original error */}}
 });
 const action=(label:string,kind:Kind,input:unknown,reason='')=><div className="rf-action"><button type="button" disabled={busy||!!blocked||!!reason} onClick={()=>preview(label,command(kind,input))}>{label}</button>{reason&&<small>{reason}</small>}</div>;
 const fleet=(label:string,a:'park'|'unpark'|'service',reason='')=>action(label,'fleet',{commandId:'ui:'+id(),trainId:train,action:a,yardId:a==='park'?yard:null},reason);
 const pick=(v:string)=>{if(gate.current)return;reset();setTemplate(v);};
 return <main className="rf" aria-busy={busy}>
  <header className="rf-top"><div><small>RAILWAY CEO</small><h1>Operations control</h1></div><button type="button" aria-label="Refresh saved operations" disabled={busy} onClick={()=>void run(async()=>{await refresh();})}><RefreshCw size={20}/></button>{onExit&&<button type="button" disabled={busy} onClick={onExit}>Back</button>}</header>
  {!data?<section className="rf-card"><p role="status">{error?'Unable to open saved railway company.':'Loading authenticated railway save…'}</p>{error&&<p role="alert">{error}</p>}</section>:<>
  <div className="rf-hud"><div><small>Available cash</small><strong>{money(m!.liquidity.availableCashMinor)}</strong></div><div><small>Fleet</small><strong>{m!.rows.length}</strong></div><div><small>Simulation second</small><strong>{m!.simTimeS.toLocaleString()}</strong></div></div>
  <nav className="rf-nav" aria-label="Operations sections">{([{id:'fleet',label:'Fleet',icon:TrainFront},{id:'routes',label:'Routes',icon:Route},{id:'yard',label:'Yard',icon:Warehouse},{id:'receipts',label:'Receipts',icon:ClipboardList},{id:'catalog',label:'Catalogue',icon:Wrench}] as const).map(n=><button type="button" key={n.id} aria-pressed={tab===n.id} disabled={busy} onClick={()=>{reset();setTab(n.id);}}><n.icon size={18}/>{n.label}</button>)}</nav>
  {blocked&&<Blocked>{blocked}{runner&&data.view.catchupPending&&<button type="button" disabled={busy} onClick={()=>wakeRef.current?.()}>Continue catch-up</button>}</Blocked>}
  {error&&<p className="rf-error" role="alert">{error}</p>}{feedback&&<p className="rf-feedback" role="status">{feedback}</p>}
  {retry&&<button type="button" disabled={busy} onClick={()=>commit(retry)}>Retry same request (idempotent)</button>}
  {(tab==='fleet'||tab==='routes'||tab==='yard')&&<section className="rf-card"><h2>Select train</h2>
   <div className="rf-form"><label>Search fleet<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Train ID or model"/></label><label>State<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All states</option>{[...new Set(m!.rows.map(x=>x.state))].sort().map(s=><option key={s}>{s}</option>)}</select></label></div>
   <div className="rf-fleet-list">{m!.rows.filter(x=>(filter==='all'||x.state===filter)&&(x.trainId+' '+x.model.name).toLowerCase().includes(query.toLowerCase())).map(x=><button type="button" key={x.trainId} aria-pressed={train===x.trainId} disabled={busy} onClick={()=>chooseTrain(x.trainId)}><TrainFront size={20}/><span><strong>{x.trainId} · {x.model.name}</strong><small>{x.state} · {x.condition.conditionBps/100}%</small></span></button>)}</div>
   {!m!.rows.length&&<p>No owned trains.</p>}
  </section>}
  {tab==='fleet'&&r&&<><TrainCard row={r}/><section className="rf-card"><h2>Train actions</h2>
   <button type="button" onClick={()=>{reset();setTab('routes');}}>Route & departure</button><button type="button" onClick={()=>{reset();setTab('yard');}}>Parking & service</button>
   {r.tripId&&<>{action('Settle actual arrival','settle',{commandId:'ui:'+id(),tripId:r.tripId},r.state!=='ARRIVED'?'Train has not arrived.':'')}{action('Cancel trip','cancel',{commandId:'ui:'+id(),tripId:r.tripId},r.state==='ARRIVED'?'Arrived trips must settle.':'')}</>}
   <Disabled label="Modify train / sell train" reason="No durable modification or ownership-transfer command is available."/>
  </section></>}
  {tab==='routes'&&<><section className="rf-card"><h2>Destination & route selection</h2>
   {!r?<p>Choose a train first.</p>:<label>Configured compatible route<select value={template} disabled={busy} onChange={e=>pick(e.target.value)}><option value="">Select a route</option>{m!.templates.filter(p=>p.modelId===r.model.model.id).map(p=><option key={p.id} value={p.id}>{routeName(p)}{p.relocationYardId?' · Relocation':''} · {p.id}</option>)}</select></label>}
   <Disabled label="Create named route / pay licence" reason="Atomic route creation, fee classification and approved map data are not available (R42 / DV-048)."/>
  </section>{t&&r&&<><TemplateCard t={t}/>{quote?<><QuoteCard offer={quote}/>{action('Dispatch locked quote','dispatch',{commandId:'ui:'+id(),quoteId:quote.quote.quote.id})}</>:action('Issue departure quote','quote',{quoteId:'ui:'+id(),trainId:r.trainId,templateId:t.id},r.nodeId!==t.origin?'Train is not at the configured route origin.':'')}</>}
  <section className="rf-card"><h2>Bulk departures</h2><p>{live.length} live saved quotes · configured limit {m!.maxBulk}</p>
   {live.map(o=><label className="rf-check" key={o.quote.quote.id}><input type="checkbox" checked={selected.includes(o.quote.quote.id)} disabled={busy||!selected.includes(o.quote.quote.id)&&(selected.length>=m!.maxBulk||selected.some(q=>live.find(x=>x.quote.quote.id===q)?.quote.quote.trainId===o.quote.quote.trainId))} onChange={e=>{reset();setSelected(prev=>e.target.checked?[...prev,o.quote.quote.id]:prev.filter(x=>x!==o.quote.quote.id));}}/>{o.quote.quote.trainId} · {o.templateId}</label>)}
   {action('Depart selected trains','bulk',selected.map(quoteId=>({commandId:'ui:'+id(),quoteId})),!selected.length?'Select saved live quotes.':selected.some(q=>!live.some(o=>o.quote.quote.id===q))?'A selected quote is stale.':'')}
  </section><section className="rf-card"><h2>Saved quote history</h2>{m!.quotes.map(o=><details key={o.quote.quote.id}><summary>{o.quote.quote.trainId} · {o.templateId} · {isLive(o,m!)?'Live':'Used or stale'}</summary><QuoteCard offer={o}/></details>)}</section></>}
  {tab==='yard'&&<><section className="rf-card"><h2>Owned and configured yards</h2>{m!.yards.map(y=><div className="rf-sub" key={y.id}><strong>{y.id} · {y.stationName}</strong><Pair label="Yard occupied / reserved">{y.occupied} / {y.capacity}</Pair><Pair label="Base occupied / reserved">{y.baseOccupied} / {y.base.capacity}</Pair><Pair label="Ownership">{y.owned?'Owned':'Not owned'}</Pair></div>)}
   <Disabled label="Buy base / expand yard" reason="Purchase and capacity expansion commands are not yet available."/>
  </section>{r&&<><TrainCard row={r}/><section className="rf-card"><h2>Parking & maintenance</h2>
   <label>Yard<select aria-label="Yard" value={yard} disabled={busy} onChange={e=>{reset();setYard(e.target.value);}}><option value="">Choose yard</option>{m!.yards.filter(y=>y.owned&&y.nodeId===r.nodeId).map(y=><option value={y.id} key={y.id}>{y.id} · {y.occupied}/{y.capacity}</option>)}</select></label>
   {fleet('Park at actual location','park',!yard?'Choose an owned yard at this location.':!['IDLE','ASSIGNED'].includes(r.state)?'Train is not idle or assigned.':'')}
   {fleet('Unpark','unpark',r.state!=='PARKED'?'Train is not parked.':'')}
   {fleet('Start service / repair','service',r.state!=='PARKED'?'Park at an owned yard first.':!['SERVICE_DUE','REPAIR_DUE'].includes(r.maintenance.availability)?'No scheduled service or repair is due.':'')}
   <button type="button" onClick={()=>{reset();setTab('routes');}}>Relocate using a validated route</button>
  </section></>}</>}
  {tab==='receipts'&&<section><h2>Departure and settlement history</h2>{m!.trips.length?m!.trips.map(t=><TerminalCard key={t.receipt.tripId} t={t}/>):<p className="rf-card">No dispatch receipts yet.</p>}</section>}
  {tab==='catalog'&&<section className="rf-card"><RailwayCatalogPanel models={m!.models} identity={m!.catalogIdentity}/><Disabled label="Choose starter / order or purchase" reason="Approved company onboarding and ownership acquisition authority are pending."/><Disabled label="Create company" reason="Approved region, base, difficulty and starter scenario are not yet available."/></section>}
  {checked&&<section className="rf-card rf-confirm" aria-label="Confirm validated action"><h2>Confirm {checked.label}</h2><p>Validated at durable revision {checked.cursor.revision}. No game state has changed.</p>
    {checked.command.kind==='quote'&&<QuoteCard offer={checked.result as Offer}/>}
    {checked.command.kind==='fleet'&&(()=>{const job=(checked.result as {job:Row['maintenance']['activeJob']}).job;return job?<div><Pair label="Actual service cost if committed">{money(job.job.costMinor)}</Pair><Pair label="Service duration">{duration(job.job.endS-job.job.startS)}</Pair><Pair label="Repair / scheduled cost">{money(job.repairCostMinor)} / {money(job.scheduledCostMinor)}</Pair></div>:null;})()}
    {checked.command.kind==='bulk'&&<div>{(checked.result as {commandId:string;ok:boolean;reason?:string}[]).map(x=><p key={x.commandId}>{x.commandId}: {x.ok?'Eligible':x.reason}</p>)}</div>}
    <button type="button" disabled={busy||!!blocked} onClick={()=>commit(checked)}>Confirm commit</button><button type="button" disabled={busy} onClick={()=>setChecked(undefined)}>Cancel preview</button>
  </section>}
  <footer>Saved revision {data.view.revision} · {m!.companyId} · {m!.governance.stage}. Route and financial authority remain in the simulation.</footer>
 </>}
 </main>;
}
