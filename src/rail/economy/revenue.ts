// R22 E04–E07. Pure revenue candidates, not cash postings or live railway prices.
import { integer, minor, signedMinor, basisPoints, metres, kilograms, seconds, MAX_INTEGER, type MinorUnits } from '../../domain/units';
import { object, list, distinct, id, sha256, refine, nullable, version1, type Decoded } from '../../domain/validation';
import { decodeDemandBook, type DemandBook } from './demand';
import type { ReadonlyTree } from '../graph';

const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const positive=refine(integer,n=>n>0,'must be positive');
const positiveM=refine(metres,n=>n>0,'positive distance required');
const positiveS=refine(seconds,n=>n>0,'positive duration required');
const positiveKg=refine(kilograms,n=>n>0,'positive mass required');
const fail=(s:string):never=>{throw new TypeError('Revenue: '+s);};
const money=(n:bigint):MinorUnits=>minor(String(n));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function freeze<T>(v:T):ReadonlyTree<T>{if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v as ReadonlyTree<T>;}
const farePolicy=object({baseMinor:minor,rateMinorPerKm:minor,discountBps:basisPoints,capMinor:minor});
const fareInput=object({distanceM:metres,policy:farePolicy});
/** E04: floor once in paise, discount then cap. Zero cap means free fare. */
export function calculateFare(input:unknown):MinorUnits{
  const q=fareInput(input),p=q.policy;
  const n=(BigInt(p.baseMinor)*1000n+BigInt(q.distanceM)*BigInt(p.rateMinorPerKm))*(10000n-BigInt(p.discountBps))/10000000n;
  return money(n>BigInt(p.capMinor)?BigInt(p.capMinor):n);
}
const cargoInput=object({deliveredKg:kilograms,paidDistanceM:metres,rateMinorPerTonneKm:minor,serviceFactorBps:basisPoints});
/** E06: kg * metres / 1e6 = tonne-km; exact rational with one final floor. */
export function calculateCargoRevenue(input:unknown):MinorUnits{
  const q=cargoInput(input);
  return money(BigInt(q.deliveredKg)*BigInt(q.paidDistanceM)*BigInt(q.rateMinorPerTonneKm)*BigInt(q.serviceFactorBps)/10000000000n);
}
const penaltyInput=object({actualDurationS:seconds,promisedDurationS:positiveS,rateMinorPerSecond:minor,capMinor:minor});
/** E07: never negative; explicit contractual cap applied before money decoding. */
export function calculateDelayPenalty(input:unknown):MinorUnits{
  const q=penaltyInput(input),n=BigInt(Math.max(0,q.actualDurationS-q.promisedDurationS))*BigInt(q.rateMinorPerSecond);
  return money(n>BigInt(q.capMinor)?BigInt(q.capMinor):n);
}
const passengerTerm=object({bucketId:id,classId:id,quantity:positive,policy:farePolicy});
const cargoTerm=object({bucketId:id,consignmentId:id,massKg:positiveKg,rateMinorPerTonneKm:minor,paidDistanceM:positiveM,serviceFactorBps:basisPoints});
const passengerKey=(x:{bucketId:string;classId:string})=>JSON.stringify([x.bucketId,x.classId]);
const terms=object({tripId:id,policySha256:sha256,segmentDistancesM:list(positiveM,1,31),promisedDurationS:positiveS,delayRateMinorPerSecond:minor,delayCapMinor:minor,passengers:distinct(list(passengerTerm,0,1024),passengerKey),cargo:distinct(list(cargoTerm,0,4096),x=>x.consignmentId)});
const binding=object({serviceId:id,dispatchSimS:seconds,stopIds:list(id,2,32),claims:distinct(list(object({bucketId:id,boardIndex:integer,alightIndex:integer,allocated:integer}),0,128),x=>x.bucketId)});
const passengerReceipt=object({bucketId:id,classId:id,paid:integer,unpaid:integer,refundMinor:minor});
const cargoReceipt=object({consignmentId:id,deliveredKg:positiveKg,finalDestinationId:id});
const settlement=object({arrivalSimS:nullable(seconds),passengers:distinct(list(passengerReceipt,0,1024),passengerKey),cargo:distinct(list(cargoReceipt,0,4096),x=>x.consignmentId)});
const totals=object({passengerGrossMinor:minor,passengerRefundMinor:minor,unpaidFaceValueMinor:minor,cargoGrossMinor:minor,delayPenaltyMinor:minor,netRevenueMinor:signedMinor});
const closed=object({evidence:settlement,totals});
const record=object({terms,binding,closed:nullable(closed)});
const book=object({schemaVersion:version1,revision:integer,records:distinct(list(record,0,10000),r=>r.terms.tripId)});
type Terms=Decoded<typeof terms>;type Binding=Decoded<typeof binding>;type Settlement=Decoded<typeof settlement>;type RecordRow=Decoded<typeof record>;type Book=Decoded<typeof book>;
export type RevenueBook=ReadonlyTree<Book>;
type DemandTrip=DemandBook['trips'][number];
function canonicalTerms(q:Terms):Terms{
  q.passengers.sort((a,b)=>order(a.bucketId,b.bucketId)||order(a.classId,b.classId));
  q.cargo.sort((a,b)=>order(a.consignmentId,b.consignmentId));return q;
}
function canonicalSettlement(q:Settlement):Settlement{
  q.passengers.sort((a,b)=>order(a.bucketId,b.bucketId)||order(a.classId,b.classId));
  q.cargo.sort((a,b)=>order(a.consignmentId,b.consignmentId));return q;
}
function tripBinding(t:DemandTrip):Binding{
  return binding({serviceId:t.serviceId,dispatchSimS:t.dispatchSimS,stopIds:t.stopIds,claims:t.claims.map(c=>({bucketId:c.bucketId,boardIndex:c.boardIndex,alightIndex:c.alightIndex,allocated:c.allocated}))});
}
function getTrip(d:DemandBook,id:string):DemandTrip{return d.trips.find(t=>t.tripId===id)??fail('unknown demand trip');}
function distance(q:Terms,b:Binding,bucketId:string):number{
  const c=b.claims.find(x=>x.bucketId===bucketId)??fail('unknown claim');
  const sum=q.segmentDistancesM.slice(c.boardIndex,c.alightIndex).reduce((a,v)=>a+BigInt(v),0n);
  if(sum>BigInt(MAX_INTEGER))fail('distance overflow');return Number(sum);
}
function validateTerms(q:Terms,b:Binding,d:DemandBook,t:DemandTrip){
  if(!same(b,tripBinding(t)))fail('locked allocation or stop identity mismatch');
  if(q.segmentDistancesM.length!==b.stopIds.length-1)fail('segment distance count mismatch');
  if(q.segmentDistancesM.reduce((a,v)=>a+BigInt(v),0n)>BigInt(MAX_INTEGER))fail('distance overflow');
  const kinds=new Map(d.buckets.map(x=>[x.bucket.id,x.kind]));
  const sums=new Map(b.claims.map(c=>[c.bucketId,0n]));
  for(const x of q.passengers){
    if(!sums.has(x.bucketId)||kinds.get(x.bucketId)!=='passenger')fail('passenger term does not match OD kind');
    sums.set(x.bucketId,sums.get(x.bucketId)!+BigInt(x.quantity));
    calculateFare({distanceM:distance(q,b,x.bucketId),policy:x.policy});
  }
  for(const x of q.cargo){
    if(!sums.has(x.bucketId)||kinds.get(x.bucketId)!=='freight')fail('cargo term does not match OD kind');
    if(x.paidDistanceM>distance(q,b,x.bucketId))fail('paid cargo distance exceeds locked OD path');
    sums.set(x.bucketId,sums.get(x.bucketId)!+BigInt(x.massKg));
    calculateCargoRevenue({deliveredKg:x.massKg,paidDistanceM:x.paidDistanceM,rateMinorPerTonneKm:x.rateMinorPerTonneKm,serviceFactorBps:x.serviceFactorBps});
  }
  for(const c of b.claims)if(sums.get(c.bucketId)!==BigInt(c.allocated))fail('terms do not reconcile allocated demand');
}
function compute(r:RecordRow,e:Settlement,d:DemandBook){
  const q=r.terms,b=r.binding,t=getTrip(d,q.tripId);
  let passenger=0n,refund=0n,unpaid=0n,cargo=0n,penalty=0n;
  if(t.status==='released'){
    // No prepayments collected by this module: cancelled trips have no realized revenue.
    if(e.arrivalSimS!==null||e.passengers.length||e.cargo.length)fail('released trip cannot recognize revenue');
  }else{
    if(t.status!=='served'||e.arrivalSimS===null||e.arrivalSimS<b.dispatchSimS)throw new TypeError('Revenue: trip has not completed delivery');
    if(e.passengers.length!==q.passengers.length||e.cargo.length!==q.cargo.length)fail('incomplete settlement evidence');
    const pmap=new Map(e.passengers.map(x=>[passengerKey(x),x]));
    for(const x of q.passengers){
      const p=pmap.get(passengerKey(x))??fail('missing ticket class evidence');
      if(BigInt(p.paid)+BigInt(p.unpaid)!==BigInt(x.quantity))fail('ticket counts do not reconcile');
      const fare=BigInt(calculateFare({distanceM:distance(q,b,x.bucketId),policy:x.policy}));
      const gross=BigInt(p.paid)*fare;
      if(BigInt(p.refundMinor)>gross)fail('refund exceeds paid revenue');
      passenger+=gross;refund+=BigInt(p.refundMinor);unpaid+=BigInt(p.unpaid)*fare;
    }
    const cmap=new Map(e.cargo.map(x=>[x.consignmentId,x])),bmap=new Map(d.buckets.map(x=>[x.bucket.id,x.bucket]));
    for(const x of q.cargo){
      const c=cmap.get(x.consignmentId)??fail('missing final consignment receipt');
      if(c.deliveredKg!==x.massKg||c.finalDestinationId!==bmap.get(x.bucketId)!.destination)fail('not full final delivery');
      cargo+=BigInt(calculateCargoRevenue({deliveredKg:c.deliveredKg,paidDistanceM:x.paidDistanceM,rateMinorPerTonneKm:x.rateMinorPerTonneKm,serviceFactorBps:x.serviceFactorBps}));
    }
    penalty=BigInt(calculateDelayPenalty({actualDurationS:e.arrivalSimS-b.dispatchSimS,promisedDurationS:q.promisedDurationS,rateMinorPerSecond:q.delayRateMinorPerSecond,capMinor:q.delayCapMinor}));
  }
  // Unpaid face value is a diagnostic, never deducted again as a cash expense.
  return totals({passengerGrossMinor:money(passenger),passengerRefundMinor:money(refund),unpaidFaceValueMinor:money(unpaid),cargoGrossMinor:money(cargo),delayPenaltyMinor:money(penalty),netRevenueMinor:signedMinor(String(passenger+cargo-refund-penalty))});
}
/** Reconcile immutable book with authoritative R21 snapshot; rejects inconsistent
 * restored receipts. This is consistency validation, not authentication of saves. */
export function decodeRevenueBook(input:unknown,demand:unknown):RevenueBook{
  const d=decodeDemandBook(demand),s=book(input),activeCargo=new Set<string>();
  s.records.sort((a,b)=>order(a.terms.tripId,b.terms.tripId));
  for(const r of s.records){
    const t=getTrip(d,r.terms.tripId);canonicalTerms(r.terms);validateTerms(r.terms,r.binding,d,t);
    if(r.closed){canonicalSettlement(r.closed.evidence);if(!same(compute(r,r.closed.evidence,d),r.closed.totals))fail('stored revenue totals mismatch');}
    // A released and closed reservation may be rebooked; delivered/active IDs cannot.
    if(!(t.status==='released'&&r.closed))for(const c of r.terms.cargo){
      if(activeCargo.has(c.consignmentId))fail('duplicate active or delivered consignment');activeCargo.add(c.consignmentId);
    }
  }
  return freeze(s);
}
export function createRevenueBook():RevenueBook{return freeze(book({schemaVersion:1,revision:0,records:[]}));}
const issueCommand=object({expectedRevision:integer,expectedDemandRevision:integer,terms});
const settleCommand=object({expectedRevision:integer,expectedDemandRevision:integer,tripId:id,evidence:settlement});
function current(input:unknown,demand:unknown,revision:number,demandRevision:number){
  const d=decodeDemandBook(demand),s=decodeRevenueBook(input,d);
  if(s.revision!==revision||d.revision!==demandRevision)fail('STALE_REVENUE_OR_DEMAND_REVISION');
  if(revision===MAX_INTEGER)fail('revision overflow');
  return {d,s:book(s)};
}
/** Lock fare policies, paid distances and final-consignment IDs against the R21
 * reservation. Segment distances and policy hash come from trusted R10/R34 caller. */
export function issueRevenueTerms(input:unknown,demand:unknown,command:unknown):RevenueBook{
  const q=issueCommand(command),{d,s}=current(input,demand,q.expectedRevision,q.expectedDemandRevision),t=getTrip(d,q.terms.tripId);
  if(t.status!=='reserved')fail('terms require reserved trip');
  if(s.records.some(r=>r.terms.tripId===t.tripId))fail('duplicate trip terms');
  s.records.push({terms:canonicalTerms(q.terms),binding:tripBinding(t),closed:null});s.revision++;
  return decodeRevenueBook(s,d);
}
/** Recognize a completed trip once. Final delivery evidence must come from
 * authoritative arrival/consignment events; no intermediate transfer payout.
 * R34/R35/R39 commit together with demand and journal via actual atomic CAS. */
export function settleRevenue(input:unknown,demand:unknown,command:unknown):RevenueBook{
  const q=settleCommand(command),{d,s}=current(input,demand,q.expectedRevision,q.expectedDemandRevision),r=s.records.find(x=>x.terms.tripId===q.tripId)??fail('missing locked terms');
  if(r.closed)fail('trip revenue already settled');
  const e=canonicalSettlement(q.evidence);r.closed={evidence:e,totals:compute(r,e,d)};s.revision++;
  return decodeRevenueBook(s,d);
}
