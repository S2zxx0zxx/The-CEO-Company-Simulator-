// R27 E17–E19: explicit fictional scenario policy, no real grant or evasion rates.
import { decodeSubsidyProgram, decodeCampaign } from '../../domain/models';
import { integer, minor, seconds, basisPoints, MAX_INTEGER } from '../../domain/units';
import { object, list, distinct, id, enumeration, refine, record, version1, type Decoded } from '../../domain/validation';
import { decodeDemandBook, estimateDemand } from './demand';
import { decodeRevenueBook } from './revenue';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Incentives: '+s);};
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const key=(...v:string[])=>JSON.stringify(v);
const min=(a:bigint,b:bigint)=>a<b?a:b;
const money=(n:bigint)=>minor(String(n));
const positiveMoney=refine(minor,n=>n!=='0','positive money required');
const kind=enumeration(['passenger','freight']);
const program=object({program:decodeSubsidyProgram,serviceId:id,stopIds:list(id,2,32),unit:enumeration(['trip','passenger','kg']),rateMinor:minor});
const inspectionPolicy=object({serviceId:id,classId:id,evasionBps:basisPoints,deterrenceBps:basisPoints,detectionBps:basisPoints,fineMinor:minor,fineCapMinor:minor});
const marketingPolicy=object({budgetMinor:minor,halfSaturationMinor:positiveMoney,maxLiftBps:basisPoints});
const config=object({seed:(v:unknown,p?:string)=>integer(v,p,1,4294967295),programs:distinct(list(program,0,10000),x=>x.program.id),inspectionPolicies:distinct(list(inspectionPolicy,0,10000),x=>key(x.serviceId,x.classId)),marketing:marketingPolicy});
const claim=object({type:enumeration(['subsidy']),tripId:id,programId:id,atSimS:seconds});
const inspectionRow=object({bucketId:id,classId:id,checked:integer,collected:integer});
const inspection=object({type:enumeration(['inspection']),tripId:id,atSimS:seconds,classes:distinct(list(inspectionRow,0,1024),x=>key(x.bucketId,x.classId))});
const campaign=object({type:enumeration(['campaign']),atSimS:seconds,campaign:decodeCampaign,kind,origin:id,destination:id,availableCashMinor:minor});
function event(input:unknown,path='event'){
  const r=record(input,path);
  if(r.type==='subsidy')return claim(input,path);
  if(r.type==='inspection')return inspection(input,path);
  if(r.type==='campaign')return campaign(input,path);
  return fail('unknown event');
}
const book=object({schemaVersion:version1,revision:integer,config,events:list(event,0,10000)});
const command=object({expectedRevision:integer,expectedDemandRevision:integer,expectedRevenueRevision:integer,event});
type Book=Decoded<typeof book>;
type Config=Decoded<typeof config>;
type Policy=Decoded<typeof inspectionPolicy>;
type Campaign=Decoded<typeof campaign>;
export type IncentiveBook=ReadonlyTree<Book>;
type Demand=ReturnType<typeof decodeDemandBook>;
type Revenue=ReturnType<typeof decodeRevenueBook>;
function freeze<T>(v:T):ReadonlyTree<T>{if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v as ReadonlyTree<T>;}
function canonical(s:Book){
  s.config.programs.sort((a,b)=>order(a.program.id,b.program.id));
  s.config.inspectionPolicies.sort((a,b)=>order(key(a.serviceId,a.classId),key(b.serviceId,b.classId)));
  for(const e of s.events)if(e.type==='inspection')e.classes.sort((a,b)=>order(key(a.bucketId,a.classId),key(b.bucketId,b.classId)));
  return s;
}
function tripRecord(d:Demand,r:Revenue,tripId:string){
  const t=d.trips.find(x=>x.tripId===tripId)??fail('unknown demand trip');
  const v=r.records.find(x=>x.terms.tripId===tripId)??fail('missing locked revenue terms');
  return {t,v};
}
function completed(d:Demand,r:Revenue,tripId:string,at:number){
  const {t,v}=tripRecord(d,r,tripId);
  const closed=v.closed??fail('trip revenue not settled');
  const arrival=closed.evidence.arrivalSimS;
  if(t.status!=='served'||arrival===null)throw new TypeError('Incentives: trip not served');
  if(at<arrival)fail('claim before arrival');
  return {t,v,closed,arrival};
}
// Stable per-trip/class stream: UTF-16 hash then xorshift32. ID decoder is ASCII.
// No reroll from book revision, event time, row order or caller-supplied seed.
function stream(seed:number,identity:string){
  let state=seed>>>0;
  for(let i=0;i<identity.length;i++)state=Math.imul(state^identity.charCodeAt(i),16777619)>>>0;
  if(state===0)state=1;
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;return Number(BigInt(state)*10000n/4294967296n);};
}
function model(seed:number,tripId:string,bucketId:string,classId:string,quantity:number,checked:number,p:Policy){
  if(checked>quantity)fail('inspection exceeds passengers');
  if(quantity>100000)fail('inspection passenger work limit');
  const coverage=Number(BigInt(checked)*10000n/BigInt(quantity));
  const evasion=Math.max(0,p.evasionBps-Number(BigInt(p.deterrenceBps)*BigInt(coverage)/10000n));
  const rng=stream(seed,key(tripId,bucketId,classId));let unpaid=0,detected=0;
  for(let i=0;i<quantity;i++){
    const evades=rng()<evasion,detect=rng()<p.detectionBps;
    if(evades){unpaid++;if(i<checked&&detect)detected++;}
  }
  return {bucketId,classId,quantity,checked,evasionBps:evasion,paid:quantity-unpaid,unpaid,detected};
}
const checkPlan=distinct(list(object({bucketId:id,classId:id,checked:integer}),0,1024),x=>key(x.bucketId,x.classId));
function inspectionProjection(c:Config,d:Demand,r:Revenue,tripId:string,plan:unknown){
  const {t,v}=tripRecord(d,r,tripId),rows=checkPlan(plan);
  if(t.status==='released'||t.serviceId.startsWith('r36:relocation:'))fail('released or relocation trip cannot inspect');
  if(rows.length!==v.terms.passengers.length)fail('inspection plan must cover every passenger class');
  if(v.terms.passengers.reduce((n,x)=>n+BigInt(x.quantity),0n)>100000n)fail('inspection passenger work limit');
  const byKey=new Map(rows.map(x=>[key(x.bucketId,x.classId),x]));
  const policies=new Map(c.inspectionPolicies.map(x=>[key(x.serviceId,x.classId),x]));
  return v.terms.passengers.map(x=>{
    const row=byKey.get(key(x.bucketId,x.classId))??fail('missing inspection class');
    const p=policies.get(key(t.serviceId,x.classId))??fail('missing inspection policy');
    return {...model(c.seed,tripId,x.bucketId,x.classId,x.quantity,row.checked,p),finePerDetectionMinor:money(min(BigInt(p.fineMinor),BigInt(p.fineCapMinor)))};
  });
}
/** E18 deterministic projection from actual checked counts supplied by trusted
 * inspection events. Paid/unpaid counts must be used in R22 settlement.
 * Aggregate cohort, not individual real people. No missed fare as expense. */
export function projectInspection(input:unknown,demand:unknown,revenue:unknown,tripId:unknown,plan:unknown){
  const d=decodeDemandBook(demand),r=decodeRevenueBook(revenue,d),s=canonical(book(input)),tid=id(tripId);
  // Validate existing history, not just its configuration.
  replay(s,d,r);
  if(s.events.some(e=>e.type==='inspection'&&e.tripId===tid))fail('inspection already settled');
  return freeze(inspectionProjection(s.config,d,r,tid,plan));
}
function replay(input:unknown,d:Demand,r:Revenue){
  const s=canonical(book(input)),c=s.config;
  if(s.revision!==s.events.length)fail('revision does not match event history');
  const programs=new Map(c.programs.map(x=>[x.program.id,{terms:x,remaining:BigInt(x.program.remainingMinor)}]));
  for(const p of programs.values())if(p.remaining!==BigInt(p.terms.program.budgetMinor))fail('opening subsidy budget must be unused');
  const grants=new Set<string>(),inspections=new Set<string>(),campaigns=new Map<string,Campaign>();
  let remainingMarketing=BigInt(c.marketing.budgetMinor),last=-1;
  const receipts=[];
  for(const e of s.events){
    if(e.atSimS<last)fail('event time reversed');last=e.atSimS;
    if(e.type==='campaign'){
      const p=e.campaign;
      if(campaigns.has(p.id))fail('duplicate campaign');
      if(e.origin===e.destination||p.startS!==e.atSimS||p.budgetMinor==='0')fail('invalid campaign target or start');
      const cost=BigInt(p.budgetMinor);
      if(cost>remainingMarketing||cost>BigInt(e.availableCashMinor))fail('insufficient marketing budget or cash');
      remainingMarketing-=cost;campaigns.set(p.id,e);
      receipts.push({type:'campaign' as const,campaignId:p.id,cashExpenseMinor:p.budgetMinor});
    }else if(e.type==='subsidy'){
      if(grants.has(e.tripId))fail('trip subsidy already claimed');
      const p=programs.get(e.programId)??fail('unknown subsidy program'),q=p.terms;
      const {t,v,arrival}=completed(d,r,e.tripId,e.atSimS);
      if(t.serviceId.startsWith('r36:relocation:')||t.serviceId!==q.serviceId||JSON.stringify(t.stopIds)!==JSON.stringify(q.stopIds))fail('ineligible route');
      if(t.dispatchSimS<q.program.startS||arrival>=q.program.endS||e.atSimS>=q.program.endS)fail('outside subsidy window');
      const units=q.unit==='trip'?1n:q.unit==='passenger'?v.terms.passengers.reduce((n,x)=>n+BigInt(x.quantity),0n):v.terms.cargo.reduce((n,x)=>n+BigInt(x.massKg),0n);
      const grant=min(p.remaining,units*BigInt(q.rateMinor));
      p.remaining-=grant;grants.add(e.tripId);
      receipts.push({type:'subsidy' as const,tripId:e.tripId,programId:e.programId,unit:q.unit,serviceUnits:units.toString(),subsidyRevenueMinor:money(grant)});
    }else{
      if(inspections.has(e.tripId))fail('inspection already settled');
      const {closed}=completed(d,r,e.tripId,e.atSimS);
      const rows=inspectionProjection(c,d,r,e.tripId,e.classes.map(x=>({bucketId:x.bucketId,classId:x.classId,checked:x.checked})));
      const evidence=new Map(closed.evidence.passengers.map(x=>[key(x.bucketId,x.classId),x]));
      const reported=new Map(e.classes.map(x=>[key(x.bucketId,x.classId),x]));
      let fine=0n;
      const classes=rows.map(x=>{
        const v=evidence.get(key(x.bucketId,x.classId))??fail('missing passenger receipt');
        const q=reported.get(key(x.bucketId,x.classId))!;
        if(v.paid!==x.paid||v.unpaid!==x.unpaid)fail('inspection counts disagree with R22 settlement');
        if(q.collected>x.detected)fail('fine collection exceeds detections');
        const amount=BigInt(q.collected)*BigInt(x.finePerDetectionMinor);fine+=amount;
        return {...x,collected:q.collected,fineRevenueMinor:money(amount)};
      });
      inspections.add(e.tripId);
      receipts.push({type:'inspection' as const,tripId:e.tripId,classes,fineRevenueMinor:money(fine),unpaidFaceValueMinor:closed.totals.unpaidFaceValueMinor});
    }
  }
  return {book:s,last,campaigns,view:{revision:s.revision,programs:[...programs.values()].map(p=>decodeSubsidyProgram({...p.terms.program,remainingMinor:money(p.remaining)})),remainingMarketingMinor:money(remainingMarketing),receipts}};
}
export function createIncentiveBook(config:unknown,demand:unknown,revenue:unknown):IncentiveBook{
  return decodeIncentiveBook({schemaVersion:1,revision:0,config,events:[]},demand,revenue);
}
export function decodeIncentiveBook(input:unknown,demand:unknown,revenue:unknown):IncentiveBook{
  const d=decodeDemandBook(demand),r=decodeRevenueBook(revenue,d);
  return freeze(replay(input,d,r).book);
}
export function inspectIncentiveBook(input:unknown,demand:unknown,revenue:unknown){
  const d=decodeDemandBook(demand),r=decodeRevenueBook(revenue,d);
  return freeze(replay(input,d,r).view);
}
export function applyIncentiveEvent(input:unknown,demand:unknown,revenue:unknown,cmd:unknown):IncentiveBook{
  const q=command(cmd),d=decodeDemandBook(demand),r=decodeRevenueBook(revenue,d),s=replay(input,d,r).book;
  if(q.expectedRevision!==s.revision||q.expectedDemandRevision!==d.revision||q.expectedRevenueRevision!==r.revision)fail('STALE_INCENTIVE_OR_ECONOMY_REVISION');
  s.events.push(q.event);s.revision++;
  return decodeIncentiveBook(s,d,r);
}
const bucketInput=object({bucketId:id,kind,origin:id,destination:id,intervalStartS:seconds,intervalEndS:seconds,asOfSimS:seconds,populationCap:integer,expectedRevision:integer,expectedDemandRevision:integer,expectedRevenueRevision:integer,demandModel:(v:unknown)=>estimateDemand(v)});
/** E19 generate a NEW R21 bucket only. Saturating lift = maxLift*spend/(half+spend).
 * Match directed OD and kind; only campaigns covering the entire new interval.
 * Existing total/reserved/served cannot be rewritten. CAS all revisions in R34/R39.
 * No campaign-specific service allocation, population is explicit scenario ceiling. */
export function createMarketedDemand(input:unknown,demand:unknown,revenue:unknown,cmd:unknown){
  const q=bucketInput(cmd),d=decodeDemandBook(demand),r=decodeRevenueBook(revenue,d),s=replay(input,d,r);
  if(q.expectedRevision!==s.book.revision||q.expectedDemandRevision!==d.revision||q.expectedRevenueRevision!==r.revision)fail('STALE_INCENTIVE_OR_ECONOMY_REVISION');
  if(q.asOfSimS<s.last||q.intervalStartS<q.asOfSimS||q.intervalEndS<=q.intervalStartS||q.origin===q.destination)fail('invalid future demand window');
  if(d.revision===MAX_INTEGER)fail('demand revision overflow');
  if(d.buckets.some(x=>x.bucket.id===q.bucketId))fail('demand bucket already exists');
  const eligible=[...s.campaigns.values()].filter(x=>x.atSimS<=q.asOfSimS&&x.kind===q.kind&&x.origin===q.origin&&x.destination===q.destination&&x.campaign.startS<=q.intervalStartS&&x.campaign.endS>=q.intervalEndS);
  const spend=eligible.reduce((n,x)=>n+BigInt(x.campaign.budgetMinor),0n),p=s.book.config.marketing;
  const lift=BigInt(p.maxLiftBps)*spend/(BigInt(p.halfSaturationMinor)+spend);
  const base=min(BigInt(q.demandModel),BigInt(q.populationCap));
  const total=Number(min(BigInt(q.populationCap),base+base*lift/10000n));
  const next=decodeDemandBook({...d,revision:d.revision+1,buckets:[...d.buckets,{kind:q.kind,bucket:{id:q.bucketId,origin:q.origin,destination:q.destination,intervalStartS:q.intervalStartS,intervalEndS:q.intervalEndS,total,available:total,reserved:0,served:0}}]});
  return freeze({demand:next,baseDemand:Number(base),liftBps:Number(lift),total,campaignIds:eligible.map(x=>x.campaign.id).sort(order)});
}
