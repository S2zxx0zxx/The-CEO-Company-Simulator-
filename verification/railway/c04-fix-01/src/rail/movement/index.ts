import { integer, checkedAdd } from '../../domain/units';
import { id, object, list, distinct, version1, sha256, type Decoder, type Registry } from '../../domain/validation';
import type { SimEvent } from '../../domain/models';
import { RailGraph } from '../graph';
import { RollingStockCatalog } from '../catalog';
import { RailCompatibility, type Traversal } from '../compatibility';
import { canonicalRequest, profileHash, digest, freezeResult } from '../routing';
import { validateRouteSnapshot } from '../quotes';
import { createScheduler, type EventRequest, type EventTransition, type SchedulerSnapshot } from '../scheduler';

const fail=(s:string):never=>{throw new Error('R33: '+s);};
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const positive=(v:unknown,p='positive')=>integer(v,p,1);
const bounded=(v:unknown,p='limit')=>integer(v,p,1,100000);
const add=checkedAdd;
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
const safe=(n:bigint)=>integer(Number(n));
const copy=(x:unknown)=>JSON.stringify(x);
const freeze=freezeResult;

const resource=object({id,capacity:bounded});
const edgeBinding=object({edgeId:id,resourceId:id});
const nodeBinding=object({nodeId:id,resourceId:id});
const infrastructure=object({schemaVersion:version1,resources:distinct(list(resource,1,100000),x=>x.id),edges:distinct(list(edgeBinding,1,1000000),x=>x.edgeId),nodes:distinct(list(nodeBinding,0,1000000),x=>x.nodeId)});
const dynamics=object({accelerationS:positive,brakingS:positive,dwellS:list(integer,0,30)});
const planInput=object({id,catalogReference:(v:unknown)=>v,request:(v:unknown)=>v,route:(v:unknown)=>v,dynamics});
const rosterEntry=object({trainId:id,catalogReference:(v:unknown)=>v,nodeId:id});
const technical=object({maxTrips:bounded,maxPending:bounded});
const reservePayload=object({tripId:id,trainId:id,planId:id,departureSimS:integer});
const stepPayload=object({tripId:id,phaseIndex:integer});
const tripDecoder=object({tripId:id,trainId:id,planId:id,departureSimS:integer,phaseIndex:(v,p)=>integer(v,p,-1),lanes:list(integer)});
const bookDecoder=object({schemaVersion:version1,trips:distinct(list(tripDecoder),t=>t.tripId)});
type Trip=ReturnType<typeof tripDecoder>;
export type MovementBook=ReturnType<typeof bookDecoder>;
type Phase={kind:'MOVE'|'TURN'|'DWELL';from:string;to:string;edgeId:string|null;stationId:string|null;resourceId:string;startS:number;endS:number;distanceM:number;speedLimitKmh:number;accelerationS:number;brakingS:number;distanceBeforeM:number};
type Plan={id:string;modelId:string;catalogSha256:string;profileSha256:string;routeId:string;routeSha256:string;policySha256:string;origin:string;destination:string;distanceM:number;durationS:number;phases:Phase[]};
type Window={resourceId:string;lane:number;start:number;end:number};
const overlap=(a:Window,b:Window)=>a.resourceId===b.resourceId&&a.lane===b.lane&&a.start<b.end&&b.start<a.end;

// Explicit stop-to-stop approximation per directed edge. Acceleration and braking
// durations are supplied, not fitted defaults. Stretch cruise time to stay below
// the R08 speed ceiling. All authoritative distances and seconds are integers.
export function segmentDuration(distanceInput:unknown,speedInput:unknown,accInput:unknown,brakeInput:unknown):number {
  const d=BigInt(positive(distanceInput)),v=BigInt(positive(speedInput)),a=BigInt(positive(accInput)),b=BigInt(positive(brakeInput));
  const minimum=ceil(18n*d,5n*v)+ceil(a+b,2n);
  const T=minimum>a+b?minimum:a+b;
  // Reject unrepresentable peak velocity at plan time, not during inspection.
  safe(2000n*d/(2n*T-a-b));
  return safe(T);
}
export function segmentPosition(distanceInput:unknown,speedInput:unknown,accInput:unknown,brakeInput:unknown,elapsedInput:unknown){
  const duration=segmentDuration(distanceInput,speedInput,accInput,brakeInput);
  const t=BigInt(integer(elapsedInput,'elapsed',0,duration)),T=BigInt(duration),D=BigInt(positive(distanceInput)),a=BigInt(positive(accInput)),b=BigInt(positive(brakeInput)),den=2n*T-a-b;
  let position:bigint,velocityNumerator:bigint,velocityDenominator:bigint;
  if(t<a){position=D*t*t/(a*den);velocityNumerator=2000n*D*t;velocityDenominator=a*den;}
  else if(t<=T-b){position=D*(2n*t-a)/den;velocityNumerator=2000n*D;velocityDenominator=den;}
  else {const left=T-t;position=(D*b*den-D*left*left)/(b*den);velocityNumerator=2000n*D*left;velocityDenominator=b*den;}
  return {distanceM:safe(position),speedMmPerS:safe(velocityNumerator/velocityDenominator),durationS:duration};
}

/** A trusted scenario supplies graph, catalog, track/node resources, validated
 * route candidates and initial owned train identities. No real-data capacity
 * or physical signalling is inferred. R34/R35 must call this reducer within
 * the authoritative aggregate, not run an independent simulation clock. */
export async function prepareMovement(graph:RailGraph,catalog:RollingStockCatalog,infraInput:unknown,planInputs:unknown,rosterInputs:unknown,limitsInput:unknown){
  const infra=infrastructure(infraInput),limits=technical(limitsInput);
  infra.resources.sort((a,b)=>cmp(a.id,b.id));infra.edges.sort((a,b)=>cmp(a.edgeId,b.edgeId));infra.nodes.sort((a,b)=>cmp(a.nodeId,b.nodeId));
  const capacities=new Map(infra.resources.map(x=>[x.id,x.capacity]));
  const edgeResources=new Map(infra.edges.map(x=>[x.edgeId,x.resourceId]));
  const nodeResources=new Map(infra.nodes.map(x=>[x.nodeId,x.resourceId]));
  const requireResource=(r:string|undefined)=>r!==undefined&&capacities.has(r)?r:fail('missing or unknown infrastructure resource');
  const corridors=new Map<string,string>();
  for(const e of infra.edges){
    const edge=graph.edge(e.edgeId),r=requireResource(e.resourceId);
    // Conservative: opposing and parallel edges with the same endpoints share
    // a declared block. Capacity is abstract independent slots, not a signal model.
    const pair=JSON.stringify([edge.from,edge.to].sort(cmp));
    if(corridors.has(pair)&&corridors.get(pair)!==r)fail('opposing/parallel edges split across resources');
    corridors.set(pair,r);
  }
  for(const n of infra.nodes){graph.node(n.nodeId);requireResource(n.resourceId);}
  const roster=distinct(list(rosterEntry,1,100000),r=>r.trainId)(rosterInputs).map(r=>{
    const profile=catalog.profile(r.catalogReference);graph.node(r.nodeId);
    return {trainId:r.trainId,modelId:profile.id,nodeId:r.nodeId,reference:catalog.reference(profile.id)};
  }).sort((a,b)=>cmp(a.trainId,b.trainId));
  const trains=new Map(roster.map(x=>[x.trainId,x]));
  const rawPlans=distinct(list(planInput,1,100000),x=>x.id)(planInputs);
  const plans:Plan[]=[];
  for(const raw of rawPlans){
    const q=canonicalRequest(raw.request),profile=catalog.profile(raw.catalogReference);
    if(await profileHash(profile)!==q.trainProfileSha256)fail('route profile does not match exact catalog model');
    const route=await validateRouteSnapshot(graph,q,raw.route);
    if(raw.dynamics.dwellS.length!==route.route.stopIds.length-2)fail('explicit dwell required for each intermediate stop');
    const compat=new RailCompatibility(graph,q.profile,q.policy);
    const phases:Phase[]=[];let time=0,distance=0,nextStop=1;let previous:Traversal|undefined;
    const append=(x:Omit<Phase,'startS'|'endS'|'distanceBeforeM'>,duration:number)=>{
      const end=add(time,duration);
      phases.push({...x,startS:time,endS:end,distanceBeforeM:distance});
      time=end;distance=add(distance,x.distanceM);
    };
    const wait=(kind:'TURN'|'DWELL',node:string,stationId:string|null,duration:number)=>{
      if(duration===0)return;
      append({kind,from:node,to:node,edgeId:null,stationId,resourceId:requireResource(nodeResources.get(node)),distanceM:0,speedLimitKmh:0,accelerationS:0,brakingS:0},duration);
    };
    for(const s of route.steps){
      const t:Traversal={edgeId:s.edgeId,from:s.from,to:s.to,operating:{...s.operating}};
      const a=previous?compat.evaluateTurn({incoming:previous,outgoing:t}):compat.evaluateEdge(t);
      if(!a.ok)throw new Error('R33: route compatibility lost');
      const cap=a.speedLimitKmh;
      wait('TURN',s.from,null,s.turnPenaltyS);
      const duration=segmentDuration(s.distanceM,cap,raw.dynamics.accelerationS,raw.dynamics.brakingS);
      append({kind:'MOVE',from:s.from,to:s.to,edgeId:s.edgeId,stationId:null,resourceId:requireResource(edgeResources.get(s.edgeId)),distanceM:s.distanceM,speedLimitKmh:cap,accelerationS:raw.dynamics.accelerationS,brakingS:raw.dynamics.brakingS},duration);
      if(s.to===route.stopAnchors[nextStop]){
        if(nextStop<route.stopAnchors.length-1)wait('DWELL',s.to,route.route.stopIds[nextStop],raw.dynamics.dwellS[nextStop-1]);
        nextStop++;
      }
      previous=t;
    }
    if(nextStop!==route.stopAnchors.length||distance!==route.route.distanceM||time<route.route.expectedDurationS)fail('movement plan continuity or totals mismatch');
    plans.push({id:raw.id,modelId:profile.id,catalogSha256:catalog.sha256,profileSha256:q.trainProfileSha256,routeId:route.route.id,routeSha256:await digest(route),policySha256:q.policySha256,origin:route.stopAnchors[0],destination:route.stopAnchors[route.stopAnchors.length-1],distanceM:distance,durationS:time,phases});
  }
  plans.sort((a,b)=>cmp(a.id,b.id));
  freeze(plans);freeze(roster);freeze(infra);
  const planIndex=new Map(plans.map(p=>[p.id,p]));
  const getPlan=(key:string)=>planIndex.get(key)??fail('unknown movement plan');
  const getTrain=(key:string)=>trains.get(key)??fail('unknown owned train');
  const scenarioSha256=await digest({schemaVersion:1,graphSha256:graph.graphSha256,catalogSha256:catalog.sha256,infrastructure:infra,plans,roster,limits});
  const window=(t:Trip,p:Phase,lane:number):Window=>({resourceId:p.resourceId,lane,start:add(t.departureSimS,p.startS),end:add(t.departureSimS,p.endS)});
  const windows=(t:Trip)=>getPlan(t.planId).phases.map((p,i)=>window(t,p,t.lanes[i]));
  // Per-resource/lane interval index. Sorting validates all conflicts, including
  // historical records, without quadratic pairwise validation.
  function index(rows:readonly Trip[]){
    const groups=new Map<string,Window[]>();
    for(const t of rows)for(const w of windows(t)){
      const k=JSON.stringify([w.resourceId,w.lane]);const group=groups.get(k)??[];group.push(w);groups.set(k,group);
    }
    for(const group of groups.values()){
      group.sort((a,b)=>a.start-b.start||a.end-b.end);
      for(let i=1;i<group.length;i++)if(overlap(group[i-1],group[i]))fail('track or node capacity conflict');
    }
    return groups;
  }
  const decodeInternal=(input:unknown,path='movement book',fleet=false):MovementBook=>{
    const b=bookDecoder(input,path);
    if(b.trips.length>limits.maxTrips)fail('movement history capacity exceeded');
    if(new Set(b.trips.map(t=>t.trainId)).size!==b.trips.length)fail('train already reserved or awaiting settlement');
    for(const t of b.trips){
      const p=getPlan(t.planId),train=getTrain(t.trainId);
      if(train.modelId!==p.modelId||(!fleet&&train.nodeId!==p.origin)||t.phaseIndex>p.phases.length||t.lanes.length!==p.phases.length)fail('invalid trip identity, origin or phase');
      add(t.departureSimS,p.durationS);
      for(let i=0;i<t.lanes.length;i++)if(t.lanes[i]>=capacities.get(p.phases[i].resourceId)!)fail('invalid resource lane');
    }
    b.trips.sort((a,b)=>cmp(a.tripId,b.tripId));index(b.trips);return b;
  };
  const decodeBook:Decoder<MovementBook>=(v,p)=>decodeInternal(v,p);
  const decodeFleetBook:Decoder<MovementBook>=(v,p)=>decodeInternal(v,p,true);
  const events:Registry=Object.freeze({'movement.reserve':reservePayload,'movement.phase':stepPayload});
  const due=(t:Trip):EventRequest|null=>{
    const p=getPlan(t.planId),i=t.phaseIndex+1;
    if(i>p.phases.length)return null;
    return {kind:'movement.phase',simTimeS:add(t.departureSimS,i===p.phases.length?p.durationS:p.phases[i].startS),payload:{tripId:t.tripId,phaseIndex:i}};
  };
  function transition(input:Readonly<MovementBook>,event:Readonly<SimEvent>,fleet:boolean,origin?:string):EventTransition<MovementBook>{
    const decode=fleet?decodeFleetBook:decodeBook,b=decode(input),at=integer(event.simTimeS);
    if(event.kind==='movement.reserve'){
      const r=reservePayload(event.payload),p=getPlan(r.planId),train=getTrain(r.trainId);
      if(r.departureSimS<at)fail('departure in the past');
      if(b.trips.length>=limits.maxTrips||b.trips.some(t=>t.tripId===r.tripId||t.trainId===r.trainId))fail('duplicate trip or train already reserved');
      if(train.modelId!==p.modelId||(fleet?origin:train.nodeId)!==p.origin)fail('train model or origin mismatch');
      add(r.departureSimS,p.durationS);
      const t:Trip={...r,phaseIndex:-1,lanes:[]},groups=index(b.trips);
      for(const phase of p.phases){
        let lane=0;
        for(;lane<capacities.get(phase.resourceId)!;lane++){
          const w=window(t,phase,lane),k=JSON.stringify([w.resourceId,w.lane]);
          if(!(groups.get(k)??[]).some(x=>overlap(x,w)))break;
        }
        if(lane>=capacities.get(phase.resourceId)!)fail('track or node capacity exhausted');
        t.lanes.push(lane);
        const w=window(t,phase,lane),k=JSON.stringify([w.resourceId,w.lane]),group=groups.get(k)??[];group.push(w);groups.set(k,group);
      }
      b.trips.push(t);const next=due(t)!;
      return {state:decode(b),schedule:[next]};
    }
    if(event.kind!=='movement.phase')return fail('unknown movement event');
    const r=stepPayload(event.payload),t=b.trips.find(x=>x.tripId===r.tripId)??fail('unknown trip');
    const expected=due(t);
    if(!expected||expected.simTimeS!==at||copy(expected.payload)!==copy(r))fail('stale duplicate or out-of-order movement phase');
    t.phaseIndex=r.phaseIndex;
    const next=due(t);
    return {state:decode(b),schedule:next?[next]:[]};
  }
  function reduce(input:Readonly<MovementBook>,event:Readonly<SimEvent>){return transition(input,event,false);}
  // Only an aggregate that verifies terminal history may supply the current origin.
  function reduceFleet(input:Readonly<MovementBook>,event:Readonly<SimEvent>,origin?:string){return transition(input,event,true,origin);}
  // R32 is the only clock/event queue. The aggregate in R34 can use the
  // exported registry/decoder/reducer directly on its own R32 instance.
  const scheduler=createScheduler<MovementBook>({policySha256:scenarioSha256,graphSha256s:[graph.graphSha256],maxPending:limits.maxPending,decodeState:decodeBook,events,reduce});
  async function restore(input:unknown){
    const s=await scheduler.restore(input),expected=new Map<string,EventRequest>();
    for(const t of s.state.trips){
      const p=getPlan(t.planId);
      if(t.phaseIndex>=0){
        const start=add(t.departureSimS,t.phaseIndex===p.phases.length?p.durationS:p.phases[t.phaseIndex].startS);
        if(start>s.simTimeS)fail('phase is in the future');
      }
      const next=due(t);
      if(next){if(next.simTimeS<s.simTimeS)fail('movement phase overdue');expected.set(t.tripId,next);}
    }
    for(const e of s.pendingEvents){
      if(e.kind!=='movement.phase')fail('unexpected pending movement command');
      const r=stepPayload(e.payload),x=expected.get(r.tripId);
      if(!x||x.simTimeS!==e.simTimeS||copy(x.payload)!==copy(r))fail('missing or duplicate pending phase');
      expected.delete(r.tripId);
    }
    if(expected.size)fail('missing pending movement phase');
    return s;
  }
  async function initialize(startSimS:unknown,seed:unknown){return scheduler.initialize(startSimS,seed,{schemaVersion:1,trips:[]});}
  // Reservation is a same-clock R32 event, not a direct mutation. Any due
  // movement event must be processed first. Failed reservation returns no new
  // snapshot and leaves the caller's state and RNG unchanged.
  async function reserve(input:unknown,request:unknown){
    const r=reservePayload(request),s=await restore(input);
    if(s.pendingEvents.some(e=>e.simTimeS<=s.simTimeS))fail('process due movement events before reserving');
    const q=await scheduler.enqueue(s,[{kind:'movement.reserve',simTimeS:s.simTimeS,payload:r}]);
    const out=await scheduler.advance(q,s.simTimeS,1);
    return restore(out.snapshot);
  }
  async function advance(input:unknown,target:unknown,budget:unknown){
    const s=await restore(input),out=await scheduler.advance(s,target,budget);
    return Object.freeze({...out,snapshot:await restore(out.snapshot)});
  }
  async function inspect(input:unknown){
    const s=await restore(input);
    const trips=s.state.trips.map(t=>{
      const p=getPlan(t.planId),elapsed=s.simTimeS-t.departureSimS;
      if(t.phaseIndex<0)return {tripId:t.tripId,trainId:t.trainId,planId:t.planId,status:'RESERVED',nodeId:p.origin,edgeId:null,stationId:null,distanceM:0,edgeDistanceM:0,speedMmPerS:0,geometry:null,resourceId:null,lane:null,arrivalSimS:null};
      if(t.phaseIndex===p.phases.length)return {tripId:t.tripId,trainId:t.trainId,planId:t.planId,status:'ARRIVED',nodeId:p.destination,edgeId:null,stationId:null,distanceM:p.distanceM,edgeDistanceM:0,speedMmPerS:0,geometry:null,resourceId:null,lane:null,arrivalSimS:add(t.departureSimS,p.durationS)};
      const phase=p.phases[t.phaseIndex],dt=integer(Math.min(elapsed-phase.startS,phase.endS-phase.startS));
      const motion=phase.kind==='MOVE'?segmentPosition(phase.distanceM,phase.speedLimitKmh,phase.accelerationS,phase.brakingS,dt):{distanceM:0,speedMmPerS:0};
      // Geometry is a trusted ordered reference; rendering interpolation is R42.
      return {tripId:t.tripId,trainId:t.trainId,planId:t.planId,status:phase.kind==='MOVE'?'RUNNING':'DWELL',nodeId:phase.kind==='MOVE'?(dt===phase.endS-phase.startS?phase.to:dt===0?phase.from:null):phase.from,edgeId:phase.edgeId,stationId:phase.stationId,distanceM:add(phase.distanceBeforeM,motion.distanceM),edgeDistanceM:motion.distanceM,speedMmPerS:motion.speedMmPerS,geometry:phase.edgeId?graph.edge(phase.edgeId).geometry:null,resourceId:phase.resourceId,lane:t.lanes[t.phaseIndex],arrivalSimS:null};
    });
    const reservations=s.state.trips.flatMap(t=>windows(t).map((w,i)=>({...w,tripId:t.tripId,phaseIndex:i}))).filter(w=>w.end>s.simTimeS);
    const occupied=reservations.filter(w=>w.start<=s.simTimeS&&s.state.trips.some(t=>t.tripId===w.tripId&&t.phaseIndex===w.phaseIndex));
    return freeze({simTimeS:s.simTimeS,trips,reservations,occupied});
  }
  const workerRecipe=freeze(structuredClone({infrastructure:infra,plans:rawPlans,roster:roster.map(r=>({trainId:r.trainId,nodeId:r.nodeId,catalogReference:r.reference})),limits}));
  return Object.freeze({workerRecipe,scenarioSha256,plans:freeze(plans),roster:freeze(roster),events,decodeBook,decodeFleetBook,reduce,reduceFleet,initialize,restore,reserve,advance,inspect});
}
