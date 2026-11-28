// R21: original deterministic demand contracts. All inputs are scenario data,
// never inferred actual Indian Railway demand. No wall clock, RNG or writable singleton.
import { decodeDemandBucket } from '../../domain/models';
import { integer, minor, seconds, seats, kilograms, checkedAdd, MAX_INTEGER } from '../../domain/units';
import { object, list, distinct, enumeration, id, refine, version1, type Decoded } from '../../domain/validation';
import type { ReadonlyTree } from '../graph';

const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
function freeze<T>(v:T):ReadonlyTree<T>{
  if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}
  return v as ReadonlyTree<T>;
}
const positive=refine(integer,n=>n>0,'must be positive');
const positiveMinor=refine(minor,n=>n!=='0','positive reference fare required');
const factor=(v:unknown,p?:string)=>integer(v,p,0,100000);
const ratioBound=(v:unknown,p?:string)=>integer(v,p,100,1000000);
const elasticity=(v:unknown,p?:string)=>integer(v,p,-40000,0);
const kind=enumeration(['passenger','freight']);
const demandInput=refine(object({baseDemand:integer,fareMinor:minor,referenceFareMinor:positiveMinor,generalizedTimeS:positive,referenceTimeS:positive,fareElasticityBps:elasticity,timeElasticityBps:elasticity,seasonBps:factor,serviceQualityBps:factor,minRatioBps:ratioBound,maxRatioBps:ratioBound,maxDemand:integer}),x=>x.minRatioBps<=10000&&x.maxRatioBps>=10000,'ratio bounds must bracket one');
const SCALE=10n**12n;
function sqrt(n:bigint):bigint{
  if(n<2n)return n;
  let x=n,y=(x+1n)/2n;
  while(y<x){x=y;y=(x+n/x)/2n;}
  return x;
}
function ratio(n:bigint,d:bigint,lo:number,hi:number):bigint{
  const x=n*SCALE/d,min=BigInt(lo)*SCALE/10000n,max=BigInt(hi)*SCALE/10000n;
  return x<min?min:x>max?max:x;
}
// Fixed-point negative power: integer exponent plus 32 binary fractional bits.
// All intermediate rounding floors; no Math.pow/platform-specific floating rounding.
function negativePower(r:bigint,elasticityBps:number):bigint{
  const magnitude=-elasticityBps,base=SCALE*SCALE/r;
  let out=SCALE,root=base,rem=magnitude%10000;
  for(let i=0;i<Math.floor(magnitude/10000);i++)out=out*base/SCALE;
  for(let i=0;i<32&&rem!==0;i++){
    root=sqrt(root*SCALE);rem*=2;
    if(rem>=10000){out=out*root/SCALE;rem-=10000;}
  }
  return out;
}
/** E01: bounded D0*(fare/F0)^ef*(time/T0)^et*season*quality.
 * Counts are passengers or kg as chosen by the OD bucket kind.
 * Explicit scenario ratio bounds make free fare finite. Cap and floor once at output.
 * 1e12 fixed-point factors, 32 fractional exponent bits; balance/calibration is external. */
export function estimateDemand(input:unknown):number{
  const q=demandInput(input),f=ratio(BigInt(q.fareMinor),BigInt(q.referenceFareMinor),q.minRatioBps,q.maxRatioBps),t=ratio(BigInt(q.generalizedTimeS),BigInt(q.referenceTimeS),q.minRatioBps,q.maxRatioBps);
  const value=BigInt(q.baseDemand)*negativePower(f,q.fareElasticityBps)*negativePower(t,q.timeElasticityBps)*BigInt(q.seasonBps)*BigInt(q.serviceQualityBps)/(SCALE*SCALE*10000n*10000n);
  return Number(value>BigInt(q.maxDemand)?BigInt(q.maxDemand):value);
}
const weight=object({serviceId:id,weight:integer});
const market=object({available:integer,outsideWeight:positive,services:distinct(list(weight,0,10000),v=>v.serviceId)});
/** E02: exact Hamilton allocation of supplied nonnegative utility weights,
 * including the positive outside option. Equal remainders prefer outside,
 * then ASCII service ID; zero weights never receive a unit. */
export function allocateMarket(input:unknown){
  const q=market(input),rows=[{serviceId:null as string|null,weight:q.outsideWeight},...q.services.sort((a,b)=>order(a.serviceId,b.serviceId))];
  const sum=rows.reduce((a,b)=>a+BigInt(b.weight),0n);
  const shares=rows.map(r=>{const n=BigInt(q.available)*BigInt(r.weight);return {serviceId:r.serviceId,units:Number(n/sum),remainder:n%sum};});
  let left=q.available-shares.reduce((n,r)=>n+r.units,0);
  const ranked=[...shares].sort((a,b)=>a.remainder===b.remainder?order(a.serviceId??'',b.serviceId??''):a.remainder>b.remainder?-1:1);
  for(let i=0;i<left;i++)ranked[i].units++;
  return freeze({available:q.available,outside:shares[0].units,services:shares.slice(1).map(s=>({serviceId:s.serviceId,units:s.units}))});
}
const bucketEntry=object({kind,bucket:decodeDemandBucket});
const claimInput=object({bucketId:id,boardIndex:integer,alightIndex:integer,requested:positive,outsideWeight:positive,services:distinct(list(weight,1,10000),v=>v.serviceId)});
const tripSpec=object({tripId:id,serviceId:id,dispatchSimS:seconds,stopIds:list(id,2,32),capacitySeats:seats,cargoCapacityKg:kilograms,claims:distinct(list(claimInput,0,128),c=>c.bucketId)});
const claimResult=object({...{bucketId:id,boardIndex:integer,alightIndex:integer,requested:positive},allocated:integer,marketQuota:integer,unmet:integer});
const tripRecord=object({tripId:id,serviceId:id,dispatchSimS:seconds,stopIds:list(id,2,32),capacitySeats:seats,cargoCapacityKg:kilograms,status:enumeration(['reserved','served','released']),claims:distinct(list(claimResult,0,128),c=>c.bucketId)});
const book=object({schemaVersion:version1,revision:integer,buckets:distinct(list(bucketEntry,0,100000),e=>e.bucket.id),trips:distinct(list(tripRecord,0,10000),t=>t.tripId)});
type Book=Decoded<typeof book>;
type Bucket=Decoded<typeof bucketEntry>;
type Trip=Decoded<typeof tripRecord>;
type Claim=Decoded<typeof claimResult>;
export type DemandBook=ReadonlyTree<Book>;
const fail=(reason:string):never=>{throw new TypeError('Demand: '+reason);};
export const isRelocationService=(serviceId:string)=>serviceId.startsWith('r36:relocation:')&&serviceId.length>'r36:relocation:'.length;
function checkPurpose(t:{serviceId:string;claims:readonly unknown[]}){
  if(isRelocationService(t.serviceId)?t.claims.length!==0:t.claims.length===0)fail('only explicit empty relocation may omit demand claims');
}
function compareClaim(a:{boardIndex:number;alightIndex:number;bucketId:string},b:typeof a){return a.boardIndex-b.boardIndex||a.alightIndex-b.alightIndex||order(a.bucketId,b.bucketId);}
function checkClaim(c:{boardIndex:number;alightIndex:number},b:Bucket,t:Pick<Trip,'stopIds'|'dispatchSimS'>){
  if(c.boardIndex>=c.alightIndex||c.alightIndex>=t.stopIds.length||t.stopIds[c.boardIndex]!==b.bucket.origin||t.stopIds[c.alightIndex]!==b.bucket.destination)fail('OD does not match ordered stops');
  if(t.dispatchSimS<b.bucket.intervalStartS||t.dispatchSimS>=b.bucket.intervalEndS)fail('outside OD interval');
}
function sorted(s:Book):Book{
  s.buckets.sort((a,b)=>order(a.bucket.id,b.bucket.id));s.trips.sort((a,b)=>order(a.tripId,b.tripId));
  for(const t of s.trips)t.claims.sort(compareClaim);
  return s;
}
function indexes(s:Book){
  const byId=new Map(s.buckets.map(e=>[e.bucket.id,e]));
  const groups=new Map<string,Bucket[]>();
  for(const e of s.buckets){const k=JSON.stringify([e.kind,e.bucket.origin,e.bucket.destination]),a=groups.get(k)??[];a.push(e);groups.set(k,a);}
  for(const group of groups.values()){
    group.sort((a,b)=>a.bucket.intervalStartS-b.bucket.intervalStartS||order(a.bucket.id,b.bucket.id));
    for(let i=1;i<group.length;i++)if(group[i-1].bucket.intervalEndS>group[i].bucket.intervalStartS)fail('overlapping OD buckets');
  }
  return byId;
}
function lookup(byId:Map<string,Bucket>,key:string):Bucket{return byId.get(key)??fail('unknown bucket: '+key);}
function capacities(t:Pick<Trip,'stopIds'|'capacitySeats'|'cargoCapacityKg'>){
  return {passenger:Array<number>(t.stopIds.length-1).fill(t.capacitySeats),freight:Array<number>(t.stopIds.length-1).fill(t.cargoCapacityKg)};
}
function consumeCapacity(left:number[],c:{boardIndex:number;alightIndex:number},n:number){
  for(let i=c.boardIndex;i<c.alightIndex;i++){if(n>left[i])fail('segment capacity exceeded');left[i]-=n;}
}
/** Decode any restored book and reconcile all reserved/served balances against trip
 * claims; released claims retain historical identity but do not consume OD stock. */
export function decodeDemandBook(input:unknown):DemandBook{
  const s=sorted(book(input)),byId=indexes(s),sums=new Map(s.buckets.map(e=>[e.bucket.id,{reserved:0n,served:0n}]));
  for(const t of s.trips){
    checkPurpose(t);
    const left=capacities(t);
    for(const c of t.claims){
      const b=lookup(byId,c.bucketId);checkClaim(c,b,t);
      if(c.allocated>c.requested||c.allocated>c.marketQuota||c.unmet!==c.requested-c.allocated||c.marketQuota>b.bucket.total)fail('invalid claim quantities');
      consumeCapacity(left[b.kind],c,c.allocated);
      const sum=sums.get(c.bucketId)!;
      if(t.status==='reserved')sum.reserved+=BigInt(c.allocated);
      else if(t.status==='served')sum.served+=BigInt(c.allocated);
    }
  }
  for(const e of s.buckets){const sum=sums.get(e.bucket.id)!;if(sum.reserved!==BigInt(e.bucket.reserved)||sum.served!==BigInt(e.bucket.served))fail('OD claim reconciliation mismatch');}
  return freeze(s);
}
export function createDemandBook(entries:unknown):DemandBook{
  return decodeDemandBook({schemaVersion:1,revision:0,buckets:entries,trips:[]});
}
const reserveCommand=object({expectedRevision:integer,trip:tripSpec});
const closeCommand=object({expectedRevision:integer,tripId:id,outcome:enumeration(['served','released'])});
function current(input:unknown,revision:number):Book{
  const valid=decodeDemandBook(input);
  if(valid.revision!==revision)fail('STALE_DEMAND_REVISION');
  if(revision===MAX_INTEGER)fail('revision overflow');
  return book(valid);
}
/** E03: pure transaction candidate, no shared mutable book. Compute current
 * market quota for each OD, min(request, quota, available, all segment capacities).
 * Competing callers must commit with R34/R39 atomic CAS against authoritative revision.
 * Dispatch interval is checked at dispatch (not future boarding); no claim is a sale. */
export function reserveDemand(input:unknown,command:unknown):DemandBook{
  const q=reserveCommand(command),s=current(input,q.expectedRevision),t=q.trip;
  checkPurpose(t);
  if(s.trips.some(x=>x.tripId===t.tripId))fail('duplicate trip');
  const byId=indexes(s),left=capacities(t),claims:Claim[]=[];
  for(const c of [...t.claims].sort(compareClaim)){
    const b=lookup(byId,c.bucketId);checkClaim(c,b,t);
    const share=allocateMarket({available:b.bucket.available,outsideWeight:c.outsideWeight,services:c.services}).services.find(x=>x.serviceId===t.serviceId);
    if(!share)throw new TypeError('Demand: service absent from market');
    const capacity=left[b.kind].slice(c.boardIndex,c.alightIndex).reduce((n,v)=>Math.min(n,v),MAX_INTEGER);
    const allocated=Math.min(c.requested,share.units,b.bucket.available,capacity);
    consumeCapacity(left[b.kind],c,allocated);
    b.bucket.available-=allocated;b.bucket.reserved=checkedAdd(b.bucket.reserved,allocated);
    claims.push({bucketId:c.bucketId,boardIndex:c.boardIndex,alightIndex:c.alightIndex,requested:c.requested,allocated,marketQuota:share.units,unmet:c.requested-allocated});
  }
  s.trips.push({tripId:t.tripId,serviceId:t.serviceId,dispatchSimS:t.dispatchSimS,stopIds:t.stopIds,capacitySeats:t.capacitySeats,cargoCapacityKg:t.cargoCapacityKg,status:'reserved',claims});s.revision++;
  return decodeDemandBook(s);
}
/** One terminal transition per trip: deliver all reserved units or release all.
 * Partial stop events and atomic finance/energy settlement are R33–R35. */
export function closeDemand(input:unknown,command:unknown):DemandBook{
  const q=closeCommand(command),s=current(input,q.expectedRevision),t=s.trips.find(x=>x.tripId===q.tripId);
  if(!t||t.status!=='reserved')throw new TypeError('Demand: trip not reserved');
  const byId=indexes(s);
  for(const c of t.claims){const b=lookup(byId,c.bucketId).bucket;b.reserved-=c.allocated;
    if(q.outcome==='served')b.served=checkedAdd(b.served,c.allocated);else b.available=checkedAdd(b.available,c.allocated);}
  t.status=q.outcome;s.revision++;
  return decodeDemandBook(s);
}
