import { decodeRoute, decodeTripQuote, decodeEnergyAmount } from '../../domain/models';
import { integer, metres, seconds, speedKmh, secondsForDistance, checkedAdd, minor } from '../../domain/units';
import { object, id, sha256, coord, list, distinct, text, enumeration, booleanValue, version1, refine, type Decoded } from '../../domain/validation';
import { RailGraph, type ReadonlyTree } from '../graph';
import { RailCompatibility, type Traversal, type InferenceNotice } from '../compatibility';
import { canonicalRequest, decodeOperating, digest, profileHash, policyHash, freezeResult, type RouteSuccess } from '../routing';

const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export class QuoteContractError extends Error {
  constructor(readonly code:string,reason:string){super(reason);this.name='QuoteContractError';}
}
const fail=(code:string,reason:string):never=>{throw new QuoteContractError(code,reason);};
const step=object({edgeId:id,from:id,to:id,geometry:list(coord,2),operating:decodeOperating,distanceM:metres,travelS:seconds,turnPenaltyS:seconds,reversal:booleanValue,modeChanged:booleanValue});
const inferredValue=(v:unknown,p='inference value')=>typeof v==='string'?text(240)(v,p):integer(v,p);
const notice=object({edgeId:id,field:enumeration(['gaugeMm','electrification','voltageV','frequencyHz','maxSpeedKmh']),value:inferredValue,reason:text(240)});
const trueValue=refine(booleanValue,v=>v,'expected successful route');
const snapshot=object({ok:trueValue,route:decodeRoute,policySha256:sha256,stopAnchors:list(id,2,32),steps:list(step,1),inferences:distinct(list(notice),n=>JSON.stringify([n.edgeId,n.field]))});

/** Reconstruct every claimed field from the immutable graph and approved request.
 * A path need not be the optimal path: alternative selection is allowed. */
export async function validateRouteSnapshot(graph:RailGraph,request:unknown,input:unknown):Promise<RouteSuccess>{
  const q=canonicalRequest(request),s=snapshot(input);
  if(q.graphSha256!==graph.graphSha256||s.route.graphSha256!==q.graphSha256)fail('STALE_GRAPH','Graph identity mismatch');
  if(await profileHash(q.profile)!==q.trainProfileSha256||s.route.trainProfileSha256!==q.trainProfileSha256)fail('STALE_PROFILE','Profile identity mismatch');
  if(await policyHash(q.policy)!==q.policySha256||s.policySha256!==q.policySha256)fail('STALE_POLICY','Policy identity mismatch');
  if(s.route.id!==q.routeId||!same(s.route.stopIds,q.stopIds)||!same(s.route.edgeIds,s.steps.map(x=>x.edgeId)))fail('INVALID_ROUTE','Route or stop identity mismatch');
  const compat=new RailCompatibility(graph,q.profile,q.policy),stops=q.stopIds.map(x=>new Set(graph.station(x).nodeIds));
  const anchors=[s.steps[0].from];if(!stops[0].has(anchors[0]))fail('INVALID_ROUTE','Invalid origin anchor');
  let next=1,distance=0,time=0,previous:Traversal|undefined;
  const notices=new Map<string,InferenceNotice>();
  for(const claimed of s.steps){
    if(next===stops.length)fail('INVALID_ROUTE','Track continues after final stop');
    const edge=graph.edge(claimed.edgeId),t:Traversal={edgeId:edge.id,from:claimed.from,to:claimed.to,operating:claimed.operating};
    if(!previous&&!same(t.operating,q.initialOperating))fail('INVALID_ROUTE','Initial operating state mismatch');
    if(previous&&previous.to!==t.from)fail('INVALID_ROUTE','Discontinuous edge');
    const a=previous?compat.evaluateTurn({incoming:previous,outgoing:t}):compat.evaluateEdge(t);
    if(!a.ok)throw new QuoteContractError(a.code,a.reason);
    const travel=secondsForDistance(edge.lengthM,speedKmh(a.speedLimitKmh),'ceil'),penalty='penaltyS' in a?a.penaltyS:0;
    const exact={edgeId:edge.id,from:edge.from,to:edge.to,geometry:edge.geometry,operating:t.operating,distanceM:edge.lengthM,travelS:travel,turnPenaltyS:penalty,reversal:'reversal' in a&&a.reversal,modeChanged:'modeChanged' in a&&a.modeChanged};
    if(!same(claimed,exact))fail('INVALID_ROUTE','Step geometry, direction, units or penalties mismatch');
    if(edge.lengthM>q.profile.rangeM-distance)fail('INCOMPATIBLE_PROFILE','Cumulative range exceeded');
    distance=checkedAdd(distance,edge.lengthM);time=checkedAdd(time,checkedAdd(travel,penalty));
    for(const n of a.inferences)notices.set(JSON.stringify([n.edgeId,n.field]),n);
    if(stops[next].has(edge.to)){anchors.push(edge.to);next++;}previous=t;
  }
  const expectedNotices=[...notices.values()].sort((a,b)=>order(a.edgeId,b.edgeId)||order(a.field,b.field));
  if(next!==stops.length||!same(s.stopAnchors,anchors)||distance!==s.route.distanceM||time!==s.route.expectedDurationS||!same(s.inferences,expectedNotices))fail('INVALID_ROUTE','Stop order, totals or inference mismatch');
  // R06 decoders copied all input before the asynchronous digest checks.
  return freezeResult({...s,ok:true as const});
}

const risk=object({id,reason:text(240)});
const terms=object({expectedRevenueMinor:minor,expectedCostMinor:minor,reserveMinor:minor,energy:distinct(list(decodeEnergyAmount,0,3),e=>e.unit),demandBucketIds:distinct(list(id),v=>v),risks:distinct(list(risk,0,128),r=>r.id)});
const issuance=refine(object({id,trainId:id,stateVersion:integer,issuedAtSimS:seconds,expiresAtSimS:seconds,configurationSha256:sha256,terms}),v=>v.expiresAtSimS>v.issuedAtSimS,'expiry must follow issue time');
const envelope=object({schemaVersion:version1,issuedAtSimS:seconds,configurationSha256:sha256,risks:distinct(list(risk,0,128),r=>r.id),routeSnapshot:snapshot,routeSnapshotSha256:sha256,quote:decodeTripQuote,quoteSha256:sha256});
const context=object({quoteSha256:sha256,trainId:id,stateVersion:integer,simTimeS:seconds,configurationSha256:sha256});
export type QuoteEnvelope=ReadonlyTree<Decoded<typeof envelope>>;
function canonicalTerms(input:Decoded<typeof terms>){input.energy.sort((a,b)=>order(a.unit,b.unit));input.demandBucketIds.sort(order);input.risks.sort((a,b)=>order(a.id,b.id));return input;}

/** Estimates are supplied by the trusted economy caller, not calculated here.
 * No state changes, reservation or debit. A caller must retain the issued digest. */
export async function createTripQuote(graph:RailGraph,request:unknown,route:unknown,input:unknown):Promise<QuoteEnvelope>{
  const i=issuance(input),t=canonicalTerms(i.terms),r=await validateRouteSnapshot(graph,request,route);
  const quote=decodeTripQuote({id:i.id,trainId:i.trainId,route:r.route,policySha256:r.policySha256,stateVersion:i.stateVersion,expiresAtSimS:i.expiresAtSimS,expectedRevenueMinor:t.expectedRevenueMinor,expectedCostMinor:t.expectedCostMinor,reserveMinor:t.reserveMinor,energy:t.energy,demandBucketIds:t.demandBucketIds});
  const routeSnapshot= snapshot(r),routeSnapshotSha256=await digest(routeSnapshot);
  const body={schemaVersion:1 as const,issuedAtSimS:i.issuedAtSimS,configurationSha256:i.configurationSha256,risks:t.risks,routeSnapshot,routeSnapshotSha256,quote};
  return freezeResult({...body,quoteSha256:await digest(body)});
}

/** Validate against trusted active request and issued quote identity. The untrusted
 * envelope cannot establish its own authority by recomputing a checksum. */
export async function validateTripQuote(graph:RailGraph,request:unknown,input:unknown,current:unknown):Promise<QuoteEnvelope>{
  const c=context(current),e=envelope(input),q=e.quote;
  if(q.trainId!==c.trainId)fail('STALE_TRAIN','Train mismatch');
  if(q.stateVersion!==c.stateVersion)fail('STALE_STATE','State version mismatch');
  if(e.configurationSha256!==c.configurationSha256)fail('STALE_CONFIGURATION','Fare/terms configuration mismatch');
  if(c.simTimeS<e.issuedAtSimS)fail('INVALID_QUOTE','Quote not yet issued');
  if(c.simTimeS>=q.expiresAtSimS)fail('EXPIRED_QUOTE','Quote expired');
  const expected=await createTripQuote(graph,request,e.routeSnapshot,{id:q.id,trainId:q.trainId,stateVersion:q.stateVersion,issuedAtSimS:e.issuedAtSimS,expiresAtSimS:q.expiresAtSimS,configurationSha256:e.configurationSha256,terms:{expectedRevenueMinor:q.expectedRevenueMinor,expectedCostMinor:q.expectedCostMinor,reserveMinor:q.reserveMinor,energy:q.energy,demandBucketIds:q.demandBucketIds,risks:e.risks}});
  if(!same(e,expected)||e.quoteSha256!==c.quoteSha256)fail('INVALID_QUOTE','Quote or trusted issuance digest mismatch');
  return expected;
}
