import { decodeTrainProfile, type RouteError } from '../../domain/models';
import { gaugeMm, volts, hertz, integer, checkedAdd, secondsForDistance, speedKmh } from '../../domain/units';
import { object, id, sha256, enumeration, nullable, refine, list, type Decoded } from '../../domain/validation';
import { RailGraph, type GraphEdge, type ReadonlyTree } from '../graph';
import { RailCompatibility, decodeCompatibilityPolicy, type OperatingMode, type Traversal, type InferenceNotice } from '../compatibility';

export const decodeOperating = refine(object({mode:enumeration(['diesel','electric','steam']),gaugeMm,voltageV:nullable(volts),frequencyHz:nullable(hertz)}),o=>o.mode==='electric'?o.voltageV!==null&&o.frequencyHz!==null:o.voltageV===null&&o.frequencyHz===null,'invalid operating mode');
export const decodeRouteRequest = object({routeId:id,graphSha256:sha256,trainProfileSha256:sha256,policySha256:sha256,profile:decodeTrainProfile,policy:decodeCompatibilityPolicy,stopIds:refine(list(id,2,32),s=>s.every((x,i)=>i===0||s[i-1]!==x),'duplicate consecutive stops'),objective:enumeration(['distance','time']),initialOperating:decodeOperating,maxLabels:(v,p)=>integer(v,p,1,100000),maxWork:(v,p)=>integer(v,p,1,1000000)});
export type RouteRequest = Decoded<typeof decodeRouteRequest>;
export type RoutingError = RouteError|'STALE_PROFILE'|'STALE_POLICY'|'SEARCH_LIMIT'|'CANCELLED'|'WORKER_UNAVAILABLE';
export type RoutingFailure = Readonly<{ok:false;code:RoutingError;reason:string}>;
export type RouteStep = Readonly<{edgeId:string;from:string;to:string;geometry:GraphEdge['geometry'];operating:Readonly<OperatingMode>;distanceM:number;travelS:number;turnPenaltyS:number;reversal:boolean;modeChanged:boolean}>;
export type RouteSuccess = ReadonlyTree<{ok:true;route:{id:string;stopIds:string[];edgeIds:string[];distanceM:number;expectedDurationS:number;graphSha256:string;trainProfileSha256:string};policySha256:string;stopAnchors:string[];steps:RouteStep[];inferences:InferenceNotice[]}>;
export type RoutingResult = RouteSuccess|RoutingFailure;
export const failure=(code:RoutingError,reason:string):RoutingFailure=>Object.freeze({ok:false,code,reason});
export function freezeResult<T>(v:T):ReadonlyTree<T>{if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freezeResult(x);Object.freeze(v);}return v as ReadonlyTree<T>;}
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const num=(a:number,b:number)=>a<b?-1:a>b?1:0;
const modeKey=(o:OperatingMode)=>JSON.stringify([o.mode,o.gaugeMm,o.voltageV,o.frequencyHz]);
/** Hashes identify decoded canonical contract bytes, not a caller's unchecked label. */
export function canonicalProfile(value:unknown){const p=decodeTrainProfile(value);p.gaugesMm.sort(num);p.voltagesV.sort(num);p.frequenciesHz.sort(num);return p;}
export function canonicalPolicy(value:unknown){const p=decodeCompatibilityPolicy(value);p.inferences.sort((a,b)=>cmp(a.edgeId,b.edgeId));p.modeChanges.sort((a,b)=>cmp(a.nodeId,b.nodeId));return p;}
export async function digest(value:unknown):Promise<string>{const bytes=new TextEncoder().encode(JSON.stringify(value));const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
export const profileHash=(value:unknown)=>digest(canonicalProfile(value));
export const policyHash=(value:unknown)=>digest(canonicalPolicy(value));
export function canonicalRequest(value:unknown):RouteRequest{const q=decodeRouteRequest(value);q.profile=canonicalProfile(q.profile);q.policy=canonicalPolicy(q.policy);return q;}
interface Label {excludedPrefix:number;node:string;nextStop:number;operating:OperatingMode;distance:number;time:number;serial:number;previous?:Label;step?:RouteStep;traversal?:Traversal;notices:readonly InferenceNotice[];anchor?:string;dead:boolean}
class Heap {
  private a:Label[]=[];
  constructor(private readonly less:(a:Label,b:Label)=>boolean){}
  get size(){return this.a.length;}
  push(x:Label){const a=this.a;let i=a.length;a.push(x);while(i>0){const p=(i-1)>>1;if(!this.less(x,a[p]))break;a[i]=a[p];i=p;}a[i]=x;}
  pop():Label{const a=this.a,top=a[0],last=a.pop()!;if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&this.less(a[j+1],a[j]))j++;if(!this.less(a[j],last))break;a[i]=a[j];i=j;}a[i]=last;}return top;}
}
function modes(q:RouteRequest):OperatingMode[]{const p=q.profile,g=q.initialOperating.gaugeMm,out:OperatingMode[]=[];if(p.traction==='diesel'||p.traction==='dual')out.push({mode:'diesel',gaugeMm:g,voltageV:null,frequencyHz:null});if(p.traction==='steam')out.push({mode:'steam',gaugeMm:g,voltageV:null,frequencyHz:null});if((p.traction==='electric'||p.traction==='dual')&&(p.voltagesV.length===1||p.frequenciesHz.length===1))for(const v of p.voltagesV)for(const f of p.frequenciesHz)out.push({mode:'electric',gaugeMm:g,voltageV:v,frequencyHz:f});return out.sort((a,b)=>cmp(modeKey(a),modeKey(b)));}
function success(q:RouteRequest,end:Label):RouteSuccess{const steps:RouteStep[]=[],anchors:string[]=[],notices=new Map<string,InferenceNotice>();for(let p:Label|undefined=end;p;p=p.previous){if(p.step)steps.push(p.step);if(p.anchor!==undefined)anchors.push(p.anchor);for(const n of p.notices)notices.set(JSON.stringify([n.edgeId,n.field]),n);}steps.reverse();anchors.reverse();return freezeResult({ok:true as const,route:{id:q.routeId,stopIds:q.stopIds,edgeIds:steps.map(s=>s.edgeId),distanceM:end.distance,expectedDurationS:end.time,graphSha256:q.graphSha256,trainProfileSha256:q.trainProfileSha256},policySha256:q.policySha256,stopAnchors:anchors,steps,inferences:[...notices.values()].sort((a,b)=>cmp(a.edgeId,b.edgeId)||cmp(a.field,b.field))});}
/** Dijkstra on previous-edge, operating mode and ordered-stop state. Keep nondominated
 * time/distance labels: a faster but longer prefix must not prune a shorter feasible one. */
export async function findRoute(graph:RailGraph,input:unknown,cancel:()=>boolean=()=>false):Promise<RoutingResult>{
  return searchRoute(graph,input,cancel,[]);
}
interface Prefix { next:Map<string,number>; terminal:boolean }
/** Distinct complete edge sequences, not merely distinct traction choices. */
function exclusionTrie(paths:readonly (readonly string[])[]):Prefix[]{
  const trie:Prefix[]=[{next:new Map(),terminal:false}];
  for(const path of paths){let p=0;for(const edge of path){let next=trie[p].next.get(edge);if(next===undefined){next=trie.length;trie[p].next.set(edge,next);trie.push({next:new Map(),terminal:false});}p=next;}trie[p].terminal=true;}
  return trie;
}
async function searchRoute(graph:RailGraph,input:unknown,cancel:()=>boolean,excluded:readonly (readonly string[])[]):Promise<RoutingResult>{
  let q:RouteRequest;try{q=canonicalRequest(input);}catch{return failure('INVALID_INPUT','INVALID_REQUEST');}
  if(q.graphSha256!==graph.graphSha256)return failure('STALE_GRAPH','GRAPH_IDENTITY_MISMATCH');
  if(cancel())return failure('CANCELLED','CANCELLED');
  try{if(await profileHash(q.profile)!==q.trainProfileSha256)return failure('STALE_PROFILE','PROFILE_HASH_MISMATCH');if(await policyHash(q.policy)!==q.policySha256)return failure('STALE_POLICY','POLICY_HASH_MISMATCH');}catch{return failure('INVALID_INPUT','HASH_UNAVAILABLE');}
  if(cancel())return failure('CANCELLED','CANCELLED');
  let compat:RailCompatibility,stops:Set<string>[];try{compat=new RailCompatibility(graph,q.profile,q.policy);stops=q.stopIds.map(s=>new Set(graph.station(s).nodeIds));}catch{return failure('INVALID_INPUT','INVALID_STATION_OR_POLICY');}
  const choices=modes(q);if(!q.profile.gaugesMm.includes(q.initialOperating.gaugeMm)||!choices.some(m=>modeKey(m)===modeKey(q.initialOperating)))return failure(q.initialOperating.mode==='electric'&&q.profile.voltagesV.length>1&&q.profile.frequenciesHz.length>1?'DATA_MISSING':'INCOMPATIBLE_PROFILE','INITIAL_MODE_NOT_SUPPORTED');
  let serial=0,work=0,missing=false,incompatible=false,overflow=false;
  const less=(a:Label,b:Label)=>((q.objective==='time'?num(a.time,b.time)||num(a.distance,b.distance):num(a.distance,b.distance)||num(a.time,b.time))||num(a.serial,b.serial))<0;
  const heap=new Heap(less),fronts=new Map<string,Label[]>(),trie=exclusionTrie(excluded);
  function add(x:Omit<Label,'serial'|'dead'>):boolean{const key=JSON.stringify([x.node,x.nextStop,x.traversal?.edgeId??null,modeKey(x.operating),x.excludedPrefix]);const f=fronts.get(key)??[];if(f.some(y=>!y.dead&&y.distance<=x.distance&&y.time<=x.time))return true;if(serial>=q.maxLabels)return false;const label:Label={...x,serial:serial++,dead:false};const survivors=f.filter(y=>{if(x.distance<=y.distance&&x.time<=y.time){y.dead=true;return false;}return !y.dead;});survivors.push(label);fronts.set(key,survivors);heap.push(label);return true;}
  for(const node of [...stops[0]].sort(cmp))if(!add({excludedPrefix:excluded.length?0:-1,node,nextStop:1,operating:q.initialOperating,distance:0,time:0,notices:[],anchor:node}))return failure('SEARCH_LIMIT','LABEL_LIMIT');
  const rejected=(code:string,reason:string)=>{if(code==='DATA_MISSING')missing=true;else if(code==='INCOMPATIBLE_PROFILE')incompatible=true;else if(reason==='TURN_PENALTY_OVERFLOW')overflow=true;};
  while(heap.size){if(cancel())return failure('CANCELLED','CANCELLED');if(++work>q.maxWork)return failure('SEARCH_LIMIT','WORK_LIMIT');const cur=heap.pop();if(cur.dead)continue;if(cur.nextStop===stops.length&&cur.step){if(cur.excludedPrefix>=0&&trie[cur.excludedPrefix].terminal)continue;return success(q,cur);}
    for(const edge of graph.outgoing(cur.node))for(const o of cur.traversal?choices:[q.initialOperating]){if(cancel())return failure('CANCELLED','CANCELLED');if(++work>q.maxWork)return failure('SEARCH_LIMIT','WORK_LIMIT');
      const t:Traversal={edgeId:edge.id,from:edge.from,to:edge.to,operating:o};const a=cur.traversal?compat.evaluateTurn({incoming:cur.traversal,outgoing:t}):compat.evaluateEdge(t);if(!a.ok){rejected(a.code,a.reason);continue;}
      if(edge.lengthM>q.profile.rangeM-cur.distance){incompatible=true;continue;}
      let travel:number,time:number,distance:number;const penalty='penaltyS' in a?a.penaltyS:0;
      try{travel=secondsForDistance(edge.lengthM,speedKmh(a.speedLimitKmh),'ceil');time=checkedAdd(cur.time,checkedAdd(travel,penalty));distance=checkedAdd(cur.distance,edge.lengthM);}catch{overflow=true;continue;}
      const hit=stops[cur.nextStop].has(edge.to);const step:RouteStep={edgeId:edge.id,from:edge.from,to:edge.to,geometry:edge.geometry,operating:o,distanceM:edge.lengthM,travelS:travel,turnPenaltyS:penalty,reversal:'reversal' in a&&a.reversal,modeChanged:'modeChanged' in a&&a.modeChanged};
      const prefix=cur.excludedPrefix<0?-1:(trie[cur.excludedPrefix].next.get(edge.id)??-1);
      if(!add({excludedPrefix:prefix,node:edge.to,nextStop:cur.nextStop+(hit?1:0),operating:o,distance,time,previous:cur,step,traversal:t,notices:a.inferences,anchor:hit?edge.to:undefined}))return failure('SEARCH_LIMIT','LABEL_LIMIT');
    }
  }
  return overflow?failure('INVALID_INPUT','ROUTE_TIME_OVERFLOW'):missing?failure('DATA_MISSING','CRITICAL_DATA_MISSING_ON_EXPLORED_PATH'):incompatible?failure('INCOMPATIBLE_PROFILE','NO_COMPATIBLE_PATH'):failure('NO_ROUTE','NO_CONNECTED_PATH');
}

export type AlternativeResult = ReadonlyTree<{routes:RouteSuccess[];complete:boolean;stop:RoutingFailure|null}>;
/** At most five bounded searches; each excludes all earlier complete edge sequences.
 * Same graph, compatibility and Dijkstra; rankings are distance/time only. */
export async function findRouteAlternatives(graph:RailGraph,input:unknown,count:unknown,cancel:()=>boolean=()=>false):Promise<AlternativeResult>{
  const routes:RouteSuccess[]=[];let q:RouteRequest,k:number;
  try{q=canonicalRequest(input);k=integer(count,'alternative count',1,5);}catch{return freezeResult({routes,complete:false,stop:failure('INVALID_INPUT','INVALID_ALTERNATIVE_REQUEST')});}
  for(let i=0;i<k;i++){
    if(cancel())return freezeResult({routes,complete:false,stop:failure('CANCELLED','CANCELLED')});
    const result=await searchRoute(graph,q,cancel,routes.map(r=>r.route.edgeIds));
    if(!result.ok)return freezeResult({routes,complete:result.code==='NO_ROUTE',stop:result});
    routes.push(result);
  }
  return freezeResult({routes,complete:true,stop:null});
}
