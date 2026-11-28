// R25 E12–E14: original, scenario-configured operating cost and wear contracts.
// No actual railway tariffs, employee wages or calibrated wear constants.
import { decodeOwnedTrain, decodeServiceJob } from '../../domain/models';
import { integer, metres, seconds, basisPoints, minor, signedMinor, checkedAdd, MAX_INTEGER } from '../../domain/units';
import { object, list, distinct, id, sha256, enumeration, refine, version1, record, type Decoded } from '../../domain/validation';
import type { RollingStockCatalog } from '../catalog';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Operations: '+s);};
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const key=(...a:(string|number)[])=>JSON.stringify(a);
const positiveM=refine(metres,x=>x>0,'positive distance required');
const positiveS=refine(seconds,x=>x>0,'positive time required');
const factor=(v:unknown,p?:string)=>integer(v,p,10000,100000);
const money=(n:bigint)=>minor(String(n));
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
const min=(a:bigint,b:bigint)=>a<b?a:b;
function freeze<T>(v:T):ReadonlyTree<T>{
  if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}
  return v as ReadonlyTree<T>;
}
const trackRate=object({regionId:id,trackClass:id,minorPerKm:minor});
const activity=enumeration(['departure','arrival','transit','handling']);
const terminalRate=object({stationId:id,activity,chargeMinor:minor});
const crewRate=object({roleId:id,minorPerHour:minor});
const crewMember=object({employeeId:id,roleId:id});
const staffMember=object({employeeId:id,minorPerPeriod:minor});
const wearRule=object({modelId:id,maintenanceIntervalM:positiveM,agePeriodS:positiveS,ageIncrementBps:basisPoints,maxAgeFactorBps:factor,maxLoadFactorBps:factor,maxWornFactorBps:factor});
const policy=object({id,trackRates:distinct(list(trackRate,0,10000),x=>key(x.regionId,x.trackClass)),terminalRates:distinct(list(terminalRate,0,10000),x=>key(x.stationId,x.activity)),crewRates:distinct(list(crewRate,0,10000),x=>x.roleId),crew:distinct(list(crewMember,0,10000),x=>x.employeeId),staff:distinct(list(staffMember,0,10000),x=>x.employeeId),payrollOriginSimS:seconds,payrollPeriodS:positiveS,wearRules:distinct(list(wearRule,1,10000),x=>x.modelId)});
const segment=object({edgeId:id,regionId:id,trackClass:id,distanceM:positiveM});
const terminal=object({stopIndex:integer,activity});
const shift=refine(object({shiftId:id,employeeId:id,startSimS:seconds,endSimS:seconds}),s=>s.endSimS>s.startSimS,'empty shift');
const trip=refine(object({tripId:id,trainId:id,departureSimS:seconds,arrivalSimS:seconds,settledAtSimS:seconds,stopIds:list(id,2,32),distanceM:positiveM,segments:list(segment,1,100000),terminals:distinct(list(terminal,0,128),x=>key(x.stopIndex,x.activity)),shifts:distinct(list(shift,0,1000),x=>x.shiftId),loadFactorBps:factor}),t=>t.departureSimS<t.arrivalSimS&&t.arrivalSimS<=t.settledAtSimS,'invalid trip time');
const overhead=object({periodIndex:integer,settledAtSimS:seconds});
const ref=object({catalogId:id,catalogRevision:refine(integer,n=>n>0,'positive revision'),catalogSha256:sha256,modelId:id,modelRevision:refine(integer,n=>n>0,'positive revision')});
const opening=object({train:decodeOwnedTrain,catalogReference:ref,acquiredAtSimS:seconds,ageAtAcquisitionS:seconds,odometerM:metres});
// R26 E15/E16: explicit scenario service terms and actual acquisition basis.
const serviceRule=object({intervalS:positiveS,repairThresholdBps:basisPoints,restoreToBps:basisPoints,scheduledCostMinor:minor,repairMinorPerBps:minor,scheduledDurationS:positiveS,repairBaseDurationS:positiveS,repairSecondsPerBps:seconds});
const assetTerms=object({purchaseMinor:minor,residualMinor:minor,usefulLifeS:positiveS});
const serviceTerms=refine(serviceRule,x=>x.restoreToBps>x.repairThresholdBps,'restoration must exceed repair threshold');
const configureEvent=object({type:enumeration(['configure-maintenance']),trainId:id,atSimS:seconds,service:serviceTerms,asset:assetTerms});
const startEvent=object({type:enumeration(['service-start']),jobId:id,trainId:id,atSimS:seconds,availableCashMinor:minor});
const finishEvent=object({type:enumeration(['service-complete']),jobId:id,trainId:id,atSimS:seconds});
const depreciationEvent=object({type:enumeration(['depreciate']),trainId:id,atSimS:seconds});
const disposalEvent=object({type:enumeration(['dispose']),trainId:id,atSimS:seconds,proceedsMinor:minor});
const tripEvent=object({type:enumeration(['trip']),trip});
const payrollEvent=object({type:enumeration(['overhead']),period:overhead});
function event(input:unknown,path='event'){
  const r=record(input,path);
  if(r.type==='trip')return tripEvent(input,path);
  if(r.type==='overhead')return payrollEvent(input,path);
  if(r.type==='configure-maintenance')return configureEvent(input,path);
  if(r.type==='service-start')return startEvent(input,path);
  if(r.type==='service-complete')return finishEvent(input,path);
  if(r.type==='depreciate')return depreciationEvent(input,path);
  if(r.type==='dispose')return disposalEvent(input,path);
  return fail('unknown operating event');
}
const book=object({schemaVersion:version1,revision:integer,companyId:id,policy,opening:distinct(list(opening,1,10000),x=>x.train.id),events:list(event,0,10000)});
type Book=Decoded<typeof book>;
type Policy=Decoded<typeof policy>;
type Trip=Decoded<typeof trip>;
type Rule=Decoded<typeof wearRule>;
export type OperatingBook=ReadonlyTree<Book>;
const command=object({expectedRevision:integer,event});
function canonical(s:Book){
  const p=s.policy;
  p.trackRates.sort((a,b)=>order(key(a.regionId,a.trackClass),key(b.regionId,b.trackClass)));
  p.terminalRates.sort((a,b)=>order(key(a.stationId,a.activity),key(b.stationId,b.activity)));
  p.crewRates.sort((a,b)=>order(a.roleId,b.roleId));p.crew.sort((a,b)=>order(a.employeeId,b.employeeId));
  p.staff.sort((a,b)=>order(a.employeeId,b.employeeId));p.wearRules.sort((a,b)=>order(a.modelId,b.modelId));
  s.opening.sort((a,b)=>order(a.train.id,b.train.id));
  for(const e of s.events)if(e.type==='trip'){
    e.trip.terminals.sort((a,b)=>a.stopIndex-b.stopIndex||order(a.activity,b.activity));
    e.trip.shifts.sort((a,b)=>order(a.employeeId,b.employeeId)||a.startSimS-b.startSimS||order(a.shiftId,b.shiftId));
  }
  return s;
}
/** E12: aggregate exact distance by region/class; ceil each rate group once.
 * Terminal occurrences are separate fixed costs; repeated edge traversal is
 * legitimate and charged each time. Caller supplies authoritative route facts. */
function access(p:Policy,t:Trip){
  const rates=new Map(p.trackRates.map(r=>[key(r.regionId,r.trackClass),r]));
  const groups=new Map<string,bigint>();let sum=0n;
  for(const s of t.segments){const k=key(s.regionId,s.trackClass);if(!rates.has(k))fail('missing regional track rate');groups.set(k,(groups.get(k)??0n)+BigInt(s.distanceM));sum+=BigInt(s.distanceM);}
  if(sum!==BigInt(t.distanceM))fail('track distance mismatch');
  const track=[...groups].sort((a,b)=>order(a[0],b[0])).map(([k,n])=>{const r=rates.get(k)!;return {regionId:r.regionId,trackClass:r.trackClass,distanceM:Number(n),costMinor:money(ceil(n*BigInt(r.minorPerKm),1000n))};});
  const terminalRates=new Map(p.terminalRates.map(r=>[key(r.stationId,r.activity),r]));
  const terminals=t.terminals.map(x=>{
    const stationId=t.stopIds[x.stopIndex]??fail('terminal stop index outside trip');
    if((x.activity==='departure'&&x.stopIndex!==0)||(x.activity==='arrival'&&x.stopIndex!==t.stopIds.length-1)||(x.activity==='transit'&&(x.stopIndex===0||x.stopIndex===t.stopIds.length-1)))fail('terminal activity does not match stop occurrence');
    const r=terminalRates.get(key(stationId,x.activity))??fail('missing terminal rate');
    return {...x,stationId,costMinor:r.chargeMinor};
  });
  return {track,terminals,trackMinor:money(track.reduce((n,r)=>n+BigInt(r.costMinor),0n)),terminalMinor:money(terminals.reduce((n,r)=>n+BigInt(r.costMinor),0n))};
}
/** E14: age factor grows by explicit increments at age-period boundaries;
 * load factor is trusted actual consist input, condition multiplier increases
 * with existing wear. All factors in bps. Round deterioration up once per trip,
 * saturating at remaining condition. No cash expense for wear itself. */
function wear(r:Rule,distanceM:number,ageS:bigint,load:number,condition:number){
  if(load>r.maxLoadFactorBps)fail('load factor exceeds configured bound');
  const ageFactor=min(BigInt(r.maxAgeFactorBps),10000n+ageS/BigInt(r.agePeriodS)*BigInt(r.ageIncrementBps));
  const conditionFactor=10000n+BigInt(10000-condition)*BigInt(r.maxWornFactorBps-10000)/10000n;
  const raw=ceil(BigInt(distanceM)*10000n*ageFactor*BigInt(load)*conditionFactor,BigInt(r.maintenanceIntervalM)*1000000000000n);
  const loss=Number(min(BigInt(condition),raw));
  return {beforeConditionBps:condition,ageFactorBps:Number(ageFactor),loadFactorBps:load,conditionFactorBps:Number(conditionFactor),wearBps:loss,afterConditionBps:condition-loss};
}
export function estimateTrainWear(input:unknown){
  const q=object({rule:wearRule,distanceM:metres,ageS:seconds,loadFactorBps:factor,conditionBps:basisPoints})(input);
  return freeze(wear(q.rule,q.distanceM,BigInt(q.ageS),q.loadFactorBps,q.conditionBps));
}
type ServicePolicy=Decoded<typeof serviceTerms>;
type AssetTerms=Decoded<typeof assetTerms>;
type ServiceRecord={job:Decoded<typeof decodeServiceJob>;scheduled:boolean;repair:boolean;conditionBeforeBps:number;targetConditionBps:number;scheduledCostMinor:string;repairCostMinor:string};
type MaintenanceRuntime={service:ServicePolicy;asset:AssetTerms;lastServiceSimS:number;lastServiceOdometerM:number;active:ServiceRecord|null;depreciatedThroughSimS:number;disposedAtSimS:number|null};
type TrainRuntime={opening:Decoded<typeof opening>;conditionBps:number;odometerM:number;lastArrivalSimS:number;lastActivitySimS:number;maintenance:MaintenanceRuntime|null};
function cumulative(a:AssetTerms,elapsed:bigint){
  const purchase=BigInt(a.purchaseMinor),residual=min(purchase,BigInt(a.residualMinor)),life=BigInt(a.usefulLifeS);
  return (purchase-residual)*min(elapsed,life)/life;
}
function assetView(a:AssetTerms,elapsed:bigint){
  const accumulated=cumulative(a,elapsed);
  return {purchaseMinor:a.purchaseMinor,residualMinor:a.residualMinor,effectiveResidualMinor:money(min(BigInt(a.purchaseMinor),BigInt(a.residualMinor))),accumulatedDepreciationMinor:money(accumulated),bookValueMinor:money(BigInt(a.purchaseMinor)-accumulated)};
}
/** E16 straight-line noncash expense, difference of cumulative floors.
 * Final useful-life boundary reconciles every paise. No resale price inference. */
export function calculateDepreciation(input:unknown){
  const q=object({asset:assetTerms,fromElapsedS:seconds,toElapsedS:seconds})(input);
  if(q.toElapsedS<q.fromElapsedS)fail('depreciation time reversed');
  return freeze({...assetView(q.asset,BigInt(q.toElapsedS)),noncashExpenseMinor:money(cumulative(q.asset,BigInt(q.toElapsedS))-cumulative(q.asset,BigInt(q.fromElapsedS)))});
}
function due(tr:TrainRuntime,r:Rule,at:number){
  const m=tr.maintenance??fail('maintenance not configured');
  return {scheduled:tr.odometerM-m.lastServiceOdometerM>=r.maintenanceIntervalM||at-m.lastServiceSimS>=m.service.intervalS,repair:tr.conditionBps<=m.service.repairThresholdBps};
}
function availability(tr:TrainRuntime,r:Rule,at:number){
  const m=tr.maintenance;
  if(!m)return 'UNCONFIGURED' as const;
  if(m.disposedAtSimS!==null)return 'DISPOSED' as const;
  if(m.active)return 'SERVICE' as const;
  const d=due(tr,r,at);
  if(d.repair)return 'REPAIR_DUE' as const;
  if(d.scheduled)return 'SERVICE_DUE' as const;
  return 'AVAILABLE' as const;
}
function replay(catalog:RollingStockCatalog,input:unknown){
  const s=canonical(book(input)),p=s.policy;
  if(s.revision!==s.events.length)fail('revision does not match event history');
  const crew=new Map(p.crew.map(x=>[x.employeeId,x.roleId])),rates=new Map(p.crewRates.map(x=>[x.roleId,x.minorPerHour]));
  for(const x of p.crew)if(!rates.has(x.roleId))fail('missing crew role rate');
  for(const x of p.staff)if(crew.has(x.employeeId))fail('crew and overhead roster overlap');
  const rules=new Map(p.wearRules.map(r=>[r.modelId,r]));
  for(const r of p.wearRules)catalog.entry(r.modelId);
  const trains=new Map<string,TrainRuntime>(s.opening.map((x):[string,TrainRuntime]=>{
    const m=catalog.resolve(x.catalogReference);
    if(!('energyPerKm' in m)||m.model.id!==x.train.modelId||x.train.companyId!==s.companyId||!rules.has(x.train.modelId))fail('opening train identity or wear rule mismatch');
    return [x.train.id,{opening:x,conditionBps:Number(x.train.conditionBps),odometerM:Number(x.odometerM),lastArrivalSimS:Number(x.acquiredAtSimS),lastActivitySimS:Number(x.acquiredAtSimS),maintenance:null}];
  }));
  const tripIds=new Set<string>(),shiftIds=new Set<string>(),periodIds=new Set<number>(),jobIds=new Set<string>();
  const shifts=new Map<string,{start:number;end:number}[]>();
  const receipts=[];
  let lastSettlement=-1;
  for(const e of s.events){
    const at=e.type==='trip'?e.trip.settledAtSimS:e.type==='overhead'?e.period.settledAtSimS:e.atSimS;
    if(at<lastSettlement)fail('settlement time moved backward');lastSettlement=at;
    if(e.type==='overhead'){
      const q=e.period;
      if(periodIds.has(q.periodIndex))fail('duplicate payroll period');
      const start=BigInt(p.payrollOriginSimS)+BigInt(q.periodIndex)*BigInt(p.payrollPeriodS),end=start+BigInt(p.payrollPeriodS);
      if(end>BigInt(q.settledAtSimS))fail('payroll period not complete');
      periodIds.add(q.periodIndex);
      const staff=p.staff.map(x=>({employeeId:x.employeeId,costMinor:x.minorPerPeriod}));
      receipts.push({type:'overhead' as const,periodIndex:q.periodIndex,startSimS:Number(start),endSimS:Number(end),staff,totalCostMinor:money(staff.reduce((n,x)=>n+BigInt(x.costMinor),0n))});
      continue;
    }
    if(e.type!=='trip'){
      const tr=trains.get(e.trainId)??fail('unknown owned train');
      const r=rules.get(tr.opening.train.modelId)!;
      if(e.atSimS<tr.lastActivitySimS)fail('maintenance event before train activity');
      if(e.type==='configure-maintenance'){
        if(tr.maintenance)fail('maintenance already configured');
        // Opening baseline is acquisition, not an invented prior maintenance.
        // Existing R25 history is retained; depreciation begins at acquisition.
        tr.maintenance={service:e.service,asset:e.asset,lastServiceSimS:Number(tr.opening.acquiredAtSimS),lastServiceOdometerM:Number(tr.opening.odometerM),active:null,depreciatedThroughSimS:Number(tr.opening.acquiredAtSimS),disposedAtSimS:null};
        tr.lastActivitySimS=e.atSimS;
        continue;
      }
      const m=tr.maintenance??fail('maintenance not configured');
      if(m.disposedAtSimS!==null)fail('train already disposed');
      if(e.type==='service-start'){
        if(m.active)fail('train already in service');
        if(jobIds.has(e.jobId))fail('duplicate service job');
        const d=due(tr,r,e.atSimS);
        if(!d.scheduled&&!d.repair)fail('service or repair not due');
        const target=Math.max(tr.conditionBps,m.service.restoreToBps),deficit=target-tr.conditionBps;
        const scheduledCost=d.scheduled?BigInt(m.service.scheduledCostMinor):0n;
        const repairCost=d.repair?BigInt(deficit)*BigInt(m.service.repairMinorPerBps):0n;
        const duration=(d.scheduled?BigInt(m.service.scheduledDurationS):0n)+(d.repair?BigInt(m.service.repairBaseDurationS)+BigInt(deficit)*BigInt(m.service.repairSecondsPerBps):0n);
        const end=BigInt(e.atSimS)+duration,cost=money(scheduledCost+repairCost);
        if(end>BigInt(MAX_INTEGER))fail('service time overflow');
        if(BigInt(cost)>BigInt(e.availableCashMinor))fail('insufficient maintenance cash');
        const job=decodeServiceJob({id:e.jobId,trainId:e.trainId,startS:e.atSimS,endS:Number(end),costMinor:cost});
        const locked={job,scheduled:d.scheduled,repair:d.repair,conditionBeforeBps:tr.conditionBps,targetConditionBps:target,scheduledCostMinor:money(scheduledCost),repairCostMinor:money(repairCost)};
        m.active=locked;jobIds.add(e.jobId);tr.lastActivitySimS=e.atSimS;
        receipts.push({type:'service-start' as const,...locked,totalCostMinor:cost});
      }else if(e.type==='service-complete'){
        const a=m.active??fail('no active service job');
        if(a.job.id!==e.jobId)fail('service job identity mismatch');
        if(e.atSimS<a.job.endS)fail('service not complete');
        tr.conditionBps=a.targetConditionBps;tr.lastActivitySimS=e.atSimS;
        if(a.scheduled){m.lastServiceSimS=e.atSimS;m.lastServiceOdometerM=tr.odometerM;}
        m.active=null;
        receipts.push({type:'service-complete' as const,jobId:e.jobId,trainId:e.trainId,completedAtSimS:e.atSimS,conditionBeforeBps:a.conditionBeforeBps,conditionAfterBps:tr.conditionBps,totalCostMinor:money(0n)});
      }else{
        if(e.type==='dispose'&&m.active)fail('cannot dispose train in service');
        if(e.type==='depreciate'&&e.atSimS<=m.depreciatedThroughSimS)fail('depreciation interval already recognized');
        const from=BigInt(m.depreciatedThroughSimS)-BigInt(tr.opening.acquiredAtSimS),to=BigInt(e.atSimS)-BigInt(tr.opening.acquiredAtSimS);
        const expense=money(cumulative(m.asset,to)-cumulative(m.asset,from)),value=assetView(m.asset,to);
        m.depreciatedThroughSimS=e.atSimS;
        if(e.type==='dispose')tr.lastActivitySimS=e.atSimS;
        if(e.type==='depreciate')receipts.push({type:'depreciation' as const,trainId:e.trainId,throughSimS:e.atSimS,...value,noncashExpenseMinor:expense,cashExpenseMinor:money(0n)});
        else{
          m.disposedAtSimS=e.atSimS;
          receipts.push({type:'disposal' as const,trainId:e.trainId,disposedAtSimS:e.atSimS,...value,noncashExpenseMinor:expense,resaleProceedsMinor:e.proceedsMinor,disposalGainLossMinor:signedMinor(String(BigInt(e.proceedsMinor)-BigInt(value.bookValueMinor)))});
        }
      }
      continue;
    }
    const t=e.trip,tr=trains.get(t.trainId)??fail('unknown owned train');
    if(tripIds.has(t.tripId))fail('duplicate trip cost');
    if(t.departureSimS<tr.lastArrivalSimS)fail('overlapping or backward train trip');
    if(tr.maintenance){
      // Financial recognition during a trip need not block that trip: only
      // service/config/disposal chronology and service eligibility matter.
      const m=tr.maintenance;
      if(m.disposedAtSimS!==null)fail('train disposed');
      if(m.active)fail('train locked in service');
      if(t.departureSimS<tr.lastActivitySimS)fail('trip before maintenance activity');
      if(availability(tr,rules.get(tr.opening.train.modelId)!,t.departureSimS)!=='AVAILABLE')fail('train requires maintenance');
    }
    if(tr.conditionBps===0)fail('zero condition train cannot operate');
    const a=access(p,t),durations=new Map<string,bigint>();
    for(const x of t.shifts){
      if(shiftIds.has(x.shiftId))fail('duplicate shift ID');
      const role=crew.get(x.employeeId)??fail('worker not on crew roster');
      if(x.startSimS<t.departureSimS||x.endSimS>t.arrivalSimS)fail('shift outside trip');
      const prior=shifts.get(x.employeeId)??[];
      if(prior.some(v=>x.startSimS<v.end&&v.start<x.endSimS))fail('overlapping crew shift');
      prior.push({start:x.startSimS,end:x.endSimS});shifts.set(x.employeeId,prior);shiftIds.add(x.shiftId);
      durations.set(x.employeeId,(durations.get(x.employeeId)??0n)+BigInt(x.endSimS-x.startSimS));
      if(!rates.has(role))fail('missing crew rate');
    }
    // E13: group each employee's disjoint shifts and round once per trip.
    const payroll=[...durations].sort((a,b)=>order(a[0],b[0])).map(([employeeId,n])=>{const roleId=crew.get(employeeId)!;return {employeeId,roleId,durationS:Number(n),costMinor:money(ceil(n*BigInt(rates.get(roleId)!),3600n))};});
    const crewMinor=money(payroll.reduce((n,x)=>n+BigInt(x.costMinor),0n));
    const age=BigInt(tr.opening.ageAtAcquisitionS)+BigInt(t.departureSimS-tr.opening.acquiredAtSimS);
    const w=wear(rules.get(tr.opening.train.modelId)!,t.distanceM,age,t.loadFactorBps,tr.conditionBps);
    tr.conditionBps=w.afterConditionBps;tr.odometerM=checkedAdd(tr.odometerM,t.distanceM);tr.lastArrivalSimS=t.arrivalSimS;tr.lastActivitySimS=t.arrivalSimS;
    tripIds.add(t.tripId);
    receipts.push({type:'trip' as const,tripId:t.tripId,trainId:t.trainId,...a,payroll,crewMinor,wear:w,odometerM:tr.odometerM,totalCostMinor:money(BigInt(a.trackMinor)+BigInt(a.terminalMinor)+BigInt(crewMinor))});
  }
  const maintenance=[...trains].map(([trainId,t])=>{
    const m=t.maintenance,at=Math.max(lastSettlement,t.lastActivitySimS),r=rules.get(t.opening.train.modelId)!;
    return {trainId,availability:availability(t,r,at),lastServiceSimS:m?.lastServiceSimS??null,lastServiceOdometerM:m?.lastServiceOdometerM??null,activeJob:m?.active??null,asset:m?{...assetView(m.asset,BigInt(m.depreciatedThroughSimS)-BigInt(t.opening.acquiredAtSimS)),depreciatedThroughSimS:m.depreciatedThroughSimS,disposedAtSimS:m.disposedAtSimS}:null};
  });
  return {book:s,trains,rules,lastSettlement,view:{revision:s.revision,receipts,trains:[...trains].map(([trainId,t])=>({trainId,conditionBps:t.conditionBps,odometerM:t.odometerM,lastArrivalSimS:t.lastArrivalSimS})),maintenance}};
}
/** Pure revisioned candidates, not journal postings. R26 service restoration,
 * R29 journal and R34 actual trip/crew event authority integrate downstream. */
export function createOperatingBook(catalog:RollingStockCatalog,companyId:unknown,policyInput:unknown,openingInput:unknown):OperatingBook{
  return decodeOperatingBook(catalog,{schemaVersion:1,revision:0,companyId,policy:policyInput,opening:openingInput,events:[]});
}
export function decodeOperatingBook(catalog:RollingStockCatalog,input:unknown):OperatingBook{return freeze(replay(catalog,input).book);}
export function inspectOperatingBook(catalog:RollingStockCatalog,input:unknown){return freeze(replay(catalog,input).view);}
/** Explicit simulation-time gate for R34 dispatch. Never unlock on clock alone. */
export function inspectMaintenanceAvailability(catalog:RollingStockCatalog,input:unknown,trainId:unknown,atSimS:unknown){
  const q=replay(catalog,input),t=q.trains.get(id(trainId))??fail('unknown owned train'),at=seconds(atSimS);
  if(at<Math.max(q.lastSettlement,t.lastActivitySimS))fail('availability time before current history');
  return availability(t,q.rules.get(t.opening.train.modelId)!,at);
}
export function applyOperatingEvent(catalog:RollingStockCatalog,input:unknown,cmd:unknown):OperatingBook{
  const q=command(cmd),s=replay(catalog,input).book;
  if(q.expectedRevision!==s.revision)fail('STALE_OPERATING_REVISION');
  s.events.push(q.event);s.revision++;
  return decodeOperatingBook(catalog,s);
}
