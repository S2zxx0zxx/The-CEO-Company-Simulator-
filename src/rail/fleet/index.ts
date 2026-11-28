import { integer } from '../../domain/units';
import { object, list, distinct, id, nullable, enumeration, version1 } from '../../domain/validation';
import { decodeBase, decodeYard } from '../../domain/models';
import type { RailGraph } from '../graph';
import { freezeResult } from '../routing';

const fail=(m:string):never=>{throw Error('R36: '+m);};
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const limit=(v:unknown,p='limit')=>integer(v,p,1,100000);
const opening=object({trainId:id,yardId:nullable(id)});
const relocation=object({templateId:id,yardId:id});
const cfgDecoder=object({schemaVersion:version1,bases:distinct(list(decodeBase,1,10000),x=>x.id),yards:distinct(list(decodeYard,1,10000),x=>x.id),anchors:distinct(list(object({baseId:id,nodeId:id}),1,10000),x=>x.baseId),opening:distinct(list(opening,1,10000),x=>x.trainId),relocations:distinct(list(relocation,0,10000),x=>x.templateId),maxHistory:limit});
export const fleetCommand=object({commandId:id,trainId:id,action:enumeration(['park','unpark','service']),yardId:nullable(id)});
export const fleetCompletion=object({trainId:id,jobId:id});
export const fleetRecord=object({commandId:id,trainId:id,kind:enumeration(['dispatch','close','park','unpark','service','complete']),atSimS:integer,tripId:nullable(id),yardId:nullable(id),jobId:nullable(id)});
export type FleetRecord=ReturnType<typeof fleetRecord>;
type Start={trainId:string;nodeId:string;state:string;baseId:string|null;routeId:string|null};
type Row={trainId:string;nodeId:string;state:string;yardId:string|null;inboundYardId:string|null;routeId:string|null;tripId:string|null;jobId:string|null};
type Trip={commandId:string;trainId:string;tripId:string;atSimS:number;origin:string;routeId:string;templateId:string};
type Closure={commandId:string;tripId:string;atSimS:number;nodeId:string;outcome:string};
type Job={jobId:string;trainId:string;startS:number;endS:number;completedAtSimS:number|null};

export function prepareFleet(graph:RailGraph,companyId:string,input:unknown){
  const config=cfgDecoder(input);
  for(const key of ['bases','yards','anchors','opening','relocations'] as const){
    // Canonical configuration order is independent of insertion order.
    const rows=config[key] as {id?:string;baseId?:string;trainId?:string;templateId?:string}[];
    rows.sort((a,b)=>order(a.id??a.baseId??a.trainId??a.templateId!,b.id??b.baseId??b.trainId??b.templateId!));
  }
  const bases=new Map(config.bases.map(b=>[b.id,b])),yards=new Map(config.yards.map(y=>[y.id,y])),anchors=new Map(config.anchors.map(a=>[a.baseId,a.nodeId]));
  if(config.anchors.length!==bases.size)fail('base anchor coverage');
  for(const b of config.bases){
    const node=anchors.get(b.id)??fail('base anchor missing');
    if(!graph.station(b.stationId).nodeIds.includes(node))fail('base is not located on its station anchor');
  }
  for(const y of config.yards)if(!bases.has(y.baseId))fail('yard base missing');
  function yard(key:string){
    const y=yards.get(key)??fail('unknown yard'),b=bases.get(y.baseId)!;
    if(b.companyId!==companyId)fail('base not owned by company');
    return {yard:y,base:b,nodeId:anchors.get(b.id)!};
  }
  for(const r of config.relocations)yard(r.yardId);
  const destination=(templateId:string)=>config.relocations.find(x=>x.templateId===templateId)?.yardId??null;
  function capacity(rows:readonly Row[],yardId:string){
    const y=yard(yardId),occupants=rows.filter(r=>r.yardId!==null||r.inboundYardId!==null);
    const held=(r:Row)=>r.yardId??r.inboundYardId!;
    if(occupants.filter(r=>held(r)===yardId).length>=y.yard.capacity)fail('yard capacity exhausted');
    if(occupants.filter(r=>yards.get(held(r))?.baseId===y.base.id).length>=y.base.capacity)fail('base capacity exhausted');
    return y;
  }
  function project(starts:readonly Start[],history:readonly FleetRecord[],trips:readonly Trip[],closures:readonly Closure[],jobs:readonly Job[]){
    if(starts.length!==config.opening.length||history.length>config.maxHistory)fail('fleet opening or history limit');
    const rows:Row[]=[];
    for(const x of [...starts].sort((a,b)=>order(a.trainId,b.trainId))){
      const init=config.opening.find(i=>i.trainId===x.trainId)??fail('missing fleet opening');
      if(!['IDLE','ASSIGNED','PARKED','BLOCKED','OUT_OF_SERVICE'].includes(x.state))fail('unsupported opening train state');
      if(init.yardId!==null){
        const y=capacity(rows,init.yardId);
        if(x.state!=='PARKED'||x.nodeId!==y.nodeId||x.baseId!==y.base.id||x.routeId!==null)fail('opening parking mismatch');
      }else if(x.state==='PARKED'||x.baseId!==null)fail('unbound opening parking');
      rows.push({trainId:x.trainId,nodeId:x.nodeId,state:x.state,yardId:init.yardId,inboundYardId:null,routeId:x.routeId,tripId:null,jobId:null});
    }
    const used=new Set<string>(),started=new Set<string>(),finished=new Set<string>(),serviceStarted=new Set<string>(),serviceFinished=new Set<string>();
    let previous=-1;
    for(const e of history){
      if(e.atSimS<previous||used.has(e.commandId))fail('fleet history order or duplicate command');
      previous=e.atSimS;used.add(e.commandId);
      const r=rows.find(x=>x.trainId===e.trainId)??fail('unknown fleet train');
      if(e.kind==='dispatch'){
        const t=trips.find(t=>t.commandId===e.commandId&&t.tripId===e.tripId)??fail('missing dispatch evidence');
        if(t.trainId!==r.trainId||t.atSimS!==e.atSimS||t.origin!==r.nodeId||r.tripId||r.jobId||!['IDLE','ASSIGNED'].includes(r.state)||r.yardId!==null||e.jobId!==null||e.yardId!==destination(t.templateId)||started.has(t.tripId))fail('invalid fleet dispatch');
        if(e.yardId!==null)capacity(rows,e.yardId);
        r.inboundYardId=e.yardId;r.tripId=t.tripId;r.routeId=t.routeId;r.state='RESERVED';started.add(t.tripId);
      }else if(e.kind==='close'){
        const c=closures.find(c=>c.commandId===e.commandId&&c.tripId===e.tripId)??fail('missing terminal evidence');
        if(r.tripId!==c.tripId||c.atSimS!==e.atSimS||finished.has(c.tripId)||e.jobId!==null)fail('invalid terminal fleet transition');
        const dest=r.inboundYardId;
        if(e.yardId!==(c.outcome==='settled'?dest:null))fail('terminal yard mismatch');
        if(e.yardId!==null&&yard(e.yardId).nodeId!==c.nodeId)fail('relocation did not reach authorized base');
        r.nodeId=c.nodeId;r.state=e.yardId===null?'IDLE':'PARKED';r.yardId=e.yardId;r.inboundYardId=null;r.tripId=null;r.routeId=null;finished.add(c.tripId);
      }else{
        if(r.tripId||r.inboundYardId||e.tripId!==null)fail('train active or inbound');
        if(e.kind==='park'){
          if(!['IDLE','ASSIGNED'].includes(r.state)||r.yardId!==null||r.jobId||e.yardId===null||e.jobId!==null)fail('invalid parking transition');
          const y=capacity(rows,e.yardId??fail('yard required'));if(r.nodeId!==y.nodeId)fail('parking requires actual base location');
          r.yardId=e.yardId;r.state='PARKED';r.routeId=null;
        }else if(e.kind==='unpark'){
          if(r.state!=='PARKED'||r.yardId===null||r.jobId||e.yardId!==null||e.jobId!==null)fail('invalid unpark transition');
          r.yardId=null;r.state='IDLE';r.routeId=null;
        }else if(e.kind==='service'){
          const j=jobs.find(j=>j.jobId===e.jobId)??fail('missing service evidence');
          if(r.state!=='PARKED'||r.yardId===null||r.jobId||e.yardId!==r.yardId||j.trainId!==r.trainId||j.startS!==e.atSimS||serviceStarted.has(j.jobId))fail('invalid service transition');
          r.state='SERVICE';r.jobId=j.jobId;serviceStarted.add(j.jobId);
        }else{
          const j=jobs.find(j=>j.jobId===e.jobId)??fail('missing completion evidence');
          if(r.state!=='SERVICE'||r.jobId!==j.jobId||e.yardId!==r.yardId||j.trainId!==r.trainId||j.endS!==e.atSimS||j.completedAtSimS!==e.atSimS||serviceFinished.has(j.jobId))fail('invalid service completion');
          r.state='PARKED';r.jobId=null;serviceFinished.add(j.jobId);
        }
      }
    }
    if(started.size!==trips.length||finished.size!==closures.length||serviceStarted.size!==jobs.length||serviceFinished.size!==jobs.filter(j=>j.completedAtSimS!==null).length)fail('missing fleet transition evidence');
    return freezeResult(rows);
  }
  return Object.freeze({config:freezeResult(config),yard,capacity,destination,project});
}
