import { integer, checkedAdd, minor, energyQuantity, basisPoints } from '../../domain/units';
import { object, list, distinct, id, sha256, text, version1, nullable, enumeration, record, type Decoder, type Registry } from '../../domain/validation';
import type { SimEvent } from '../../domain/models';
import type { RailGraph } from '../graph';
import type { RollingStockCatalog } from '../catalog';
import { canonicalRequest, digest, freezeResult } from '../routing';
import { validateRouteSnapshot, createTripQuote, validateTripQuote, type QuoteEnvelope } from '../quotes';
import type { prepareMovement, MovementBook } from '../movement';
import { createScheduler, type EventTransition, type SchedulerSnapshot } from '../scheduler';
import { decodeDemandBook, reserveDemand, closeDemand, isRelocationService, type DemandBook } from '../economy/demand';
import { decodeRevenueBook, issueRevenueTerms, settleRevenue, calculateFare, calculateCargoRevenue, type RevenueBook } from '../economy/revenue';
import { decodeEnergyBook, estimateEnergy, applyEnergyEvent, inspectEnergyBook, type EnergyBook } from '../economy/energy';
import { decodeOperatingBook, inspectOperatingBook, inspectMaintenanceAvailability, applyOperatingEvent, type OperatingBook } from '../economy/operations';
import { decodeIncentiveBook, projectInspection, applyIncentiveEvent, type IncentiveBook } from '../economy/incentives';
import { decodeAccountingBook, inspectAccountingBook, reportAccountingPeriod, type AccountingBook } from '../economy/accounting';
import { decodeGovernancePolicy, evaluateSolvency, applyGovernedAccountingCommand, applyRecoveryCommand } from '../economy/governance';
import {valueCompany} from '../economy/company';
import { decodeEnergyMarket, inspectEnergyMarket, applyMarketAction, type EnergyMarketBook } from '../economy/market';

import {decodeEventWindows,projectEventWindows} from '../progression';
import {prepareFleet,fleetCommand,fleetCompletion,fleetRecord,type FleetRecord} from '../fleet';

type Movement=Awaited<ReturnType<typeof prepareMovement>>;
const fail=(s:string):never=>{throw new Error('R34: '+s);};
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const freeze=freezeResult;
const positive=(v:unknown,p='positive')=>integer(v,p,1);
const limit=(v:unknown,p='limit')=>integer(v,p,1,10000);
const factor=(v:unknown,p='factor')=>integer(v,p,1,100000);
const raw=(v:unknown)=>v;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const weight=object({serviceId:id,weight:integer});
const fare=object({baseMinor:minor,rateMinorPerKm:minor,discountBps:basisPoints,capMinor:minor});
const passengerPrice=object({kind:enumeration(['passenger']),classId:id,policy:fare});
const cargoPrice=object({kind:enumeration(['freight']),rateMinorPerTonneKm:minor,serviceFactorBps:basisPoints});
const pricing=(v:unknown,p='pricing')=>record(v,p).kind==='passenger'?passengerPrice(v,p):cargoPrice(v,p);
const claim=object({bucketId:id,boardIndex:integer,alightIndex:integer,requested:positive,outsideWeight:positive,services:distinct(list(weight,1,10000),x=>x.serviceId),pricing});
const energyFactor=object({loadFactorBps:factor,gradeFactorBps:factor,idleQuantityPerHour:energyQuantity,auxQuantityPerHour:energyQuantity,requestedRegenWh:energyQuantity,maxRegenBps:basisPoints});
const risk=object({id,reason:text(240)});
const template=object({id,movementPlanId:id,serviceId:id,request:raw,route:raw,claims:distinct(list(claim,0,128),x=>x.bucketId),energyFactors:list(energyFactor,1,100000),expectedCostMinor:minor,reserveMinor:minor,quoteTtlS:positive,delayRateMinorPerSecond:minor,delayCapMinor:minor,risks:distinct(list(risk,0,128),x=>x.id)});
const config=object({schemaVersion:version1,governance:decodeGovernancePolicy,templates:distinct(list(template,1,10000),x=>x.id),maxPending:limit,maxQuotes:limit,maxReceipts:limit,maxBulk:limit});
const procurementUnit=enumeration(['mL','Wh','g']);
const financePurchase=object({type:enumeration(['purchase']),unit:procurementUnit,quantity:energyQuantity,contractId:nullable(id)});
const financeContract=object({type:enumeration(['contract']),unit:procurementUnit,quantity:energyQuantity,expiresAtSimS:integer});
const financeRepay=object({type:enumeration(['repay']),loanId:id,amountMinor:minor});
const financeRescue=object({type:enumeration(['rescue']),principalMinor:minor});
const financeRefinance=object({type:enumeration(['refinance']),loanId:id,replacementPrincipalMinor:minor});
const financeAction=(v:unknown,p='finance action')=>{
  switch(record(v,p).type){
    case 'purchase':return financePurchase(v,p);case 'contract':return financeContract(v,p);
    case 'repay':return financeRepay(v,p);case 'rescue':return financeRescue(v,p);
    case 'refinance':return financeRefinance(v,p);default:return fail('unsupported finance action');
  }
};
const financeCommand=object({commandId:id,action:financeAction});
const quoteInput=object({quoteId:id,trainId:id,templateId:id});
const command=object({commandId:id,quoteId:id});
const executeInput=object({commandId:id,templateId:id,quote:(v:unknown)=>record(v,'quote') as unknown as QuoteEnvelope,quoteSha256:sha256,allocationSha256:sha256,baseVersion:integer});
const receiptDecoder=object({commandId:id,quoteId:id,templateId:id,trainId:id,tripId:id,atSimS:integer,quote:(v:unknown)=>record(v,'quote') as unknown as QuoteEnvelope,quoteSha256:sha256,allocationSha256:sha256,accountingCommandId:id});
export type DispatchReceipt=ReturnType<typeof receiptDecoder>;
const activity=enumeration(['departure','arrival','transit','handling']);
const settlementPolicy=object({templateId:id,trackClasses:list(id,1,100000),terminals:distinct(list(object({stopIndex:integer,activity}),0,128),x=>JSON.stringify([x.stopIndex,x.activity])),loadFactorBps:factor,inspectionMode:enumeration(['none','configured']),checkedBps:basisPoints,collectedBps:basisPoints,refunds:distinct(list(object({classId:id,minorPerPaid:minor}),0,1024),x=>x.classId),subsidyProgramId:nullable(id)});
const lifecycleConfig=object({schemaVersion:version1,templates:distinct(list(settlementPolicy,1,10000),x=>x.templateId),crew:distinct(list(object({trainId:id,employeeIds:distinct(list(id,0,1000),x=>x)}),1,10000),x=>x.trainId)});
const terminalCommand=object({commandId:id,tripId:id});
const terminalEvent=object({commandId:id,tripId:id,outcome:enumeration(['settled','cancelled']),cancelEventId:nullable(id)});
const terminalReceipt=object({commandId:id,tripId:id,outcome:enumeration(['settled','cancelled']),atSimS:integer,arrivalSimS:nullable(integer),nodeId:id,phaseIndex:(v,p)=>integer(v,p,-1),distanceM:integer,accountingCommandId:id});
export type TerminalReceipt=ReturnType<typeof terminalReceipt>;
type Opening={demand:DemandBook;revenue:RevenueBook;energy:EnergyBook;operations:OperatingBook;incentives:IncentiveBook;accounting:AccountingBook;market:EnergyMarketBook|null};
export type DispatchState=Opening&{schemaVersion:1;revision:number;movement:MovementBook;receipts:DispatchReceipt[];closures:TerminalReceipt[];fleetHistory:FleetRecord[]};
export type Offer={templateId:string;quote:QuoteEnvelope;quoteSha256:string;allocationSha256:string};
export type DispatchSnapshot=SchedulerSnapshot<DispatchState>;
type Snapshot=DispatchSnapshot;
const persistedOffer=object({templateId:id,quote:(v:unknown)=>record(v,'quote') as unknown as QuoteEnvelope,quoteSha256:sha256,allocationSha256:sha256});
const versionMap=(s:Opening)=>({demand:s.demand.revision,revenue:s.revenue.revision,energy:s.energy.revision,operations:s.operations.revision,incentives:s.incentives.revision});
const sortedIds=(xs:readonly string[])=>[...xs].sort(cmp);
const allocationKey=(claims:DemandBook['trips'][number]['claims'])=>claims.map(c=>({bucketId:c.bucketId,boardIndex:c.boardIndex,alightIndex:c.alightIndex,requested:c.requested,allocated:c.allocated,unmet:c.unmet}));
const reason=(e:unknown)=>e instanceof Error?e.message:String(e);

/** R34 is the local authoritative command instance. Its only event queue is R32.
 * Trusted scenario configuration supplies approved estimates, OD weights, fares,
 * energy coefficients and the R33 infrastructure. User commands carry IDs only.
 * The controller serializes commands and uses a snapshot checksum CAS. Durable
 * multi-process/tab CAS, authentication and quote registry persistence are R39. */
export async function prepareDispatch(graph:RailGraph,catalog:RollingStockCatalog,movement:Movement,configInput:unknown,lifecycleInput?:unknown,fleetInput?:unknown){
  const {progressionEvents,...baseConfig}=record(configInput,'dispatch configuration');
  const eventWindows=progressionEvents===undefined?null:decodeEventWindows(progressionEvents);
  if(eventWindows)for(const e of eventWindows)for(const stationId of e.stationIds)graph.station(stationId);
  const cfg=config(baseConfig),life=lifecycleInput===undefined?null:lifecycleConfig(lifecycleInput);
  if(life){if(cfg.maxPending<2)fail('lifecycle requires queue capacity for boundary and command');life.templates.sort((a,b)=>cmp(a.templateId,b.templateId));life.crew.sort((a,b)=>cmp(a.trainId,b.trainId));for(const c of life.crew)c.employeeIds.sort(cmp);for(const t of life.templates){t.terminals.sort((a,b)=>a.stopIndex-b.stopIndex||cmp(a.activity,b.activity));t.refunds.sort((a,b)=>cmp(a.classId,b.classId));}freeze(life);}
  const fleet=fleetInput===undefined?null:prepareFleet(graph,cfg.governance.companyId,fleetInput);
  if(fleet&&!life)fail('fleet requires lifecycle configuration');
  const movementDecoder=fleet?movement.decodeFleetBook:movement.decodeBook;
  const src=(s:Opening)=>({catalog,demand:s.demand,revenue:s.revenue,energy:s.energy,operations:s.operations,incentives:s.incentives});
  const openingDecoder=object({demand:decodeDemandBook,revenue:raw,energy:decodeEnergyBook,operations:(v:unknown)=>decodeOperatingBook(catalog,v),incentives:raw,accounting:(v:unknown)=>record(v,'accounting') as unknown as AccountingBook,market:nullable(decodeEnergyMarket)});
  function opening(v:unknown):Opening{
    const b=openingDecoder(v),revenue=decodeRevenueBook(b.revenue,b.demand),incentives=decodeIncentiveBook(b.incentives,b.demand,revenue);
    if(b.market&&!same(inspectEnergyMarket(b.market).energy,b.energy))fail('market energy projection mismatch');
    return {...b,revenue,incentives};
  }
  const stateRaw=object({schemaVersion:version1,revision:integer,movement:movementDecoder,receipts:distinct(list(receiptDecoder,0,cfg.maxReceipts),r=>r.commandId),closures:distinct(list(terminalReceipt,0,cfg.maxReceipts),r=>r.tripId),fleetHistory:list(fleetRecord,0,fleet?.config.maxHistory??0),demand:raw,revenue:raw,energy:raw,operations:raw,incentives:raw,accounting:raw,market:raw});
  const decodeState:Decoder<DispatchState>=v=>{
    const b=stateRaw(v),{schemaVersion,revision,movement:m,receipts,closures,fleetHistory,...books}=b;
    if(new Set(receipts.map(r=>r.quoteId)).size!==receipts.length||new Set(receipts.map(r=>r.tripId)).size!==receipts.length||(!fleet&&new Set(receipts.map(r=>r.trainId)).size!==receipts.length))fail('duplicate dispatch receipt identity');
    if(!life&&closures.length)fail('lifecycle not configured');
    const commands=[...receipts.map(r=>r.commandId),...closures.map(r=>r.commandId)];
    if(new Set(commands).size!==commands.length)fail('duplicate aggregate command ID');
    return {schemaVersion,revision,movement:m,receipts:receipts.sort((a,b)=>cmp(a.commandId,b.commandId)),closures:closures.sort((a,b)=>cmp(a.tripId,b.tripId)),fleetHistory,...opening(books)};
  };
  const plans=await Promise.all(cfg.templates.map(async t=>{
    const q=canonicalRequest(t.request),r=await validateRouteSnapshot(graph,q,t.route);
    const m=movement.plans.find(p=>p.id===t.movementPlanId)??fail('unknown movement plan');
    if(m.routeId!==r.route.id||m.routeSha256!==await digest(r)||m.profileSha256!==q.trainProfileSha256||m.policySha256!==q.policySha256||m.catalogSha256!==catalog.sha256)fail('movement and route identity mismatch');
    const ref=catalog.reference(m.modelId),model=catalog.resolve(ref).model;
    if(BigInt(t.reserveMinor)<BigInt(t.expectedCostMinor))fail('configured reserve below expected cost');
    t.claims.sort((a,b)=>cmp(a.bucketId,b.bucketId));t.risks.sort((a,b)=>cmp(a.id,b.id));
    for(const c of t.claims)c.services.sort((a,b)=>cmp(a.serviceId,b.serviceId));
    if(t.energyFactors.length!==r.steps.length)fail('explicit energy factors required for every route edge');
    const segments:number[]=[];let distance=0,stop=1;
    for(const s of r.steps){distance=checkedAdd(distance,s.distanceM);if(s.to===r.stopAnchors[stop]){segments.push(distance);distance=0;stop++;}}
    if(distance!==0||segments.length!==r.route.stopIds.length-1)fail('route OD distance mismatch');
    let idle=0,step=0;
    const energyInputs=m.phases.flatMap(p=>{
      if(p.kind!=='MOVE'){idle=checkedAdd(idle,p.endS-p.startS);return [];}
      const s=r.steps[step],f=t.energyFactors[step++];
      if(!s||!f||s.edgeId!==p.edgeId||s.distanceM!==p.distanceM)fail('movement energy segment mismatch');
      const out={...f,mode:s.operating.mode,distanceM:p.distanceM,runningS:p.endS-p.startS,idleS:idle};idle=0;return [out];
    });
    if(idle||step!==r.steps.length)fail('incomplete energy path');
    const requirements=estimateEnergy(catalog,ref,energyInputs).energy;
    const {request:_,route:__,...settings}=t;
    return {settings,request:q,route:r,movement:m,reference:ref,capacitySeats:model.capacitySeats,cargoCapacityKg:model.cargoCapacityKg,segments,requirements,energyInputs};
  }));
  plans.sort((a,b)=>cmp(a.settings.id,b.settings.id));freeze(plans);
  const planMap=new Map(plans.map(p=>[p.settings.id,p]));
  const plan=(key:string)=>planMap.get(key)??fail('unknown dispatch template');
  const terminalPolicy=(key:string)=>life?.templates.find(t=>t.templateId===key)??fail('missing lifecycle template');
  if(life){
    if(life.templates.length!==plans.length)fail('lifecycle template coverage mismatch');
    for(const p of plans){
      const t=terminalPolicy(p.settings.id);
      if(t.trackClasses.length!==p.route.steps.length)fail('track class coverage mismatch');
      if(t.terminals.some(x=>x.stopIndex>=p.route.route.stopIds.length))fail('terminal stop outside route');
      if(t.inspectionMode==='none'&&(t.checkedBps!==0||t.collectedBps!==0))fail('inspection disabled but inspection fractions set');
      const classes=new Set(p.settings.claims.flatMap(c=>c.pricing.kind==='passenger'?[c.pricing.classId]:[]));
      if(t.refunds.length!==classes.size||t.refunds.some(x=>!classes.has(x.classId)))fail('explicit refund policy required per fare class');
    }
  }
  if(fleet){
    for(const x of fleet.config.relocations){
      const p=plan(x.templateId),tp=terminalPolicy(x.templateId);
      if(!isRelocationService(p.settings.serviceId)||p.settings.claims.length||p.movement.destination!==fleet.yard(x.yardId).nodeId||tp.subsidyProgramId!==null||tp.inspectionMode!=='none'||p.settings.delayRateMinorPerSecond!=='0'||p.settings.delayCapMinor!=='0')fail('invalid relocation template');
    }
  }
  for(const p of plans){
    const relocation=fleet?.destination(p.settings.id)??null;
    if(relocation===null?(isRelocationService(p.settings.serviceId)||!p.settings.claims.length):!isRelocationService(p.settings.serviceId))fail('invalid commercial or relocation demand policy');
  }
  function projectFleet(s:DispatchState){
    if(!fleet)throw Error('R36: fleet not configured');
    if(s.operations.opening.length!==movement.roster.length)fail('fleet roster mismatch');
    const starts=movement.roster.map(r=>{
      const own=s.operations.opening.find(o=>o.train.id===r.trainId)??fail('missing owned roster train');
      if(!same(own.catalogReference,r.reference)||own.train.companyId!==cfg.governance.companyId)fail('fleet opening model/company mismatch');
      return {trainId:r.trainId,nodeId:r.nodeId,state:own.train.state,baseId:own.train.baseId,routeId:own.train.routeId};
    });
    const op=inspectOperatingBook(catalog,s.operations);
    const jobs=op.receipts.flatMap(x=>x.type==='service-start'?[{jobId:x.job.id,trainId:x.job.trainId,startS:x.job.startS,endS:x.job.endS,completedAtSimS:op.receipts.flatMap(y=>y.type==='service-complete'&&y.jobId===x.job.id?[y.completedAtSimS]:[])[0]??null}]:[]);
    return fleet.project(starts,s.fleetHistory,s.receipts.map(r=>({...r,origin:plan(r.templateId).movement.origin,routeId:plan(r.templateId).movement.routeId})),s.closures,jobs);
  }
  const fleetRow=(s:DispatchState,trainId:string)=>projectFleet(s).find(x=>x.trainId===trainId)??fail('unknown fleet train');
  const fleetLog=(s:DispatchState,e:FleetRecord)=>fleet?[...s.fleetHistory,fleetRecord(e)]:s.fleetHistory;
  const configurationSha256=await digest({schemaVersion:1,graphSha256:graph.graphSha256,catalogSha256:catalog.sha256,movementSha256:movement.scenarioSha256,governance:cfg.governance,plans,lifecycle:life,fleet:fleet?.config??null,...(eventWindows===null?{}:{progressionEvents:eventWindows}),limits:{maxPending:cfg.maxPending,maxQuotes:cfg.maxQuotes,maxReceipts:cfg.maxReceipts,maxBulk:cfg.maxBulk}});
  const tripId=async(quoteId:string)=>'r34:trip:'+await digest({configurationSha256,quoteId});
  const accountingId=async(commandId:string)=>'r34:dispatch:'+await digest({configurationSha256,commandId});
  async function financialBoundary(s:DispatchState){
    const [g,a]=await Promise.all([evaluateSolvency(s.accounting,src(s),cfg.governance),inspectAccountingBook(s.accounting,src(s))]);
    let due=g.nextActionDueSimS;
    for(const x of a.liquidityView.loans)if(x.status==='active')due=due===null?x.loan.maturityS:Math.min(due,x.loan.maturityS);
    let payroll:{periodIndex:number;at:number}|null=null;
    if(life){
      const now=Number(a.liquidityView.simTimeS);
      for(const x of a.liquidityView.loans)if(x.status==='active'){
        const origin=Number(x.loan.openedS),period=Number(s.accounting.policy.interestPeriodS);
        if(period<=0)fail('invalid interest period');
        const next=BigInt(origin)+(((BigInt(now)-BigInt(origin))/BigInt(period))+1n)*BigInt(period);
        const boundary=Number(next<BigInt(x.loan.maturityS)?next:BigInt(x.loan.maturityS));
        due=due===null?boundary:Math.min(due,boundary);
      }
      const p=s.operations.policy;
      if(p.staff.length){
        const prior=s.operations.events.filter(e=>e.type==='overhead').map(e=>e.period.periodIndex).sort((a,b)=>a-b);
        if(prior.some((v,i)=>v!==i))fail('payroll periods must be contiguous');
        const end=BigInt(p.payrollOriginSimS)+(BigInt(prior.length)+1n)*BigInt(p.payrollPeriodS);
        const at=integer(Number(end));payroll={periodIndex:prior.length,at};
        if(at<=now)fail('overdue unposted payroll period');
        due=due===null?at:Math.min(due,at);
      }
      if(s.market){const m=inspectEnergyMarket(s.market).nextUpdateSimS;if(m!==null)due=due===null?m:Math.min(due,m);}
    }
    return {g,a,due,payroll};
  }
  async function ready(s:DispatchState,at:number,trainId:string,p:ReturnType<typeof plan>){
    if(fleet){
      const row=fleetRow(s,trainId);
      if(!['IDLE','ASSIGNED'].includes(row.state)||row.tripId||row.yardId||row.jobId)fail('train unavailable in fleet state');
      if(row.nodeId!==p.movement.origin)fail('train not at actual route origin');
      const dest=fleet.destination(p.settings.id);if(dest!==null)fleet.capacity(projectFleet(s),dest);
    }else if(s.receipts.some(t=>t.trainId===trainId)||s.movement.trips.some(t=>t.trainId===trainId))fail('train already dispatched or awaiting settlement');
    const own=s.operations.opening.find(x=>x.train.id===trainId)??fail('unknown owned train');
    if(!same(own.catalogReference,p.reference)||(!fleet&&!['IDLE','ASSIGNED'].includes(own.train.state)))fail('train model or availability state mismatch');
    if(inspectMaintenanceAvailability(catalog,s.operations,trainId,at)!=='AVAILABLE')fail('train unavailable for maintenance');
    const runtime=inspectOperatingBook(catalog,s.operations).trains.find(x=>x.trainId===trainId)??fail('unknown train state');
    if(runtime.conditionBps===0)fail('train has zero condition');
    const {g,a,due}=await financialBoundary(s);
    if(g.stage==='LIQUIDATION'||g.stage==='RESTART_AUTHORIZED')fail('company cannot dispatch during liquidation or after restart');
    if(a.liquidityView.simTimeS>at||(due!==null&&at>=due))fail('mandatory financial boundary must be processed before dispatch');
    if(a.pending.assets||a.pending.operations||a.pending.incentives||a.pending.energyLots.length||a.pending.energyReservations.length||a.pending.trips.length)fail('unreconciled accounting sources');
    if(!s.accounting.transactions.some(t=>t.action.type==='acquire-asset'&&t.action.trainId===trainId))fail('train asset not booked');
    if(life){
      const crew=life.crew.find(c=>c.trainId===trainId)??fail('missing explicit train crew assignment');
      const tp=terminalPolicy(p.settings.id),op=s.operations.policy;
      if(crew.employeeIds.some(x=>!op.crew.some(c=>c.employeeId===x)))fail('unknown crew member');
      if(p.route.steps.some((x,i)=>!op.trackRates.some(r=>r.regionId===graph.regionId&&r.trackClass===tp.trackClasses[i])))fail('missing configured track rate');
      if(tp.terminals.some(x=>!op.terminalRates.some(r=>r.stationId===p.route.route.stopIds[x.stopIndex]&&r.activity===x.activity)))fail('missing configured terminal rate');
      const end=checkedAdd(at,p.movement.durationS);
      for(const r of s.receipts.filter(r=>!s.closures.some(c=>c.tripId===r.tripId))){
        const other=life.crew.find(c=>c.trainId===r.trainId);
        if(other?.employeeIds.some(x=>crew.employeeIds.includes(x))&&at<checkedAdd(r.atSimS,plan(r.templateId).movement.durationS)&&r.atSimS<end)fail('crew already reserved');
      }
      for(const e of s.operations.events)if(e.type==='trip'&&e.trip.shifts.some(x=>crew.employeeIds.includes(x.employeeId)&&at<x.endSimS&&x.startSimS<end))fail('crew history overlap');
    }
  }
  async function preview(s:DispatchState,at:number,trainId:string,templateId:string,quoteId:string){
    const p=plan(templateId),t=p.settings;await ready(s,at,trainId,p);
    const tid=await tripId(quoteId);
    const demand=reserveDemand(s.demand,{expectedRevision:s.demand.revision,trip:{tripId:tid,serviceId:t.serviceId,dispatchSimS:at,stopIds:p.route.route.stopIds,capacitySeats:p.capacitySeats,cargoCapacityKg:p.cargoCapacityKg,claims:t.claims.map(({pricing:_,...c})=>c)}});
    const allocated=demand.trips.find(x=>x.tripId===tid)??fail('missing candidate OD trip');
    const passengers:unknown[]=[],cargo:unknown[]=[];let expected=0n;
    for(const c of allocated.claims){
      const rule=t.claims.find(x=>x.bucketId===c.bucketId)??fail('unknown claim policy');
      const kind=demand.buckets.find(x=>x.bucket.id===c.bucketId)?.kind;
      if(kind!==rule.pricing.kind)fail('OD pricing kind mismatch');
      if(!c.allocated)continue;
      const metres=p.segments.slice(c.boardIndex,c.alightIndex).reduce((n,x)=>checkedAdd(n,x),0);
      if(rule.pricing.kind==='passenger'){
        passengers.push({bucketId:c.bucketId,classId:rule.pricing.classId,quantity:c.allocated,policy:rule.pricing.policy});
        expected+=BigInt(c.allocated)*BigInt(calculateFare({distanceM:metres,policy:rule.pricing.policy}));
      }else{
        const term={bucketId:c.bucketId,consignmentId:tid+':'+cargo.length,massKg:c.allocated,paidDistanceM:metres,rateMinorPerTonneKm:rule.pricing.rateMinorPerTonneKm,serviceFactorBps:rule.pricing.serviceFactorBps};
        cargo.push(term);expected+=BigInt(calculateCargoRevenue({deliveredKg:c.allocated,paidDistanceM:metres,rateMinorPerTonneKm:term.rateMinorPerTonneKm,serviceFactorBps:term.serviceFactorBps}));
      }
    }
    const revenue=issueRevenueTerms(s.revenue,demand,{expectedRevision:s.revenue.revision,expectedDemandRevision:demand.revision,terms:{tripId:tid,policySha256:configurationSha256,segmentDistancesM:p.segments,promisedDurationS:p.movement.durationS,delayRateMinorPerSecond:t.delayRateMinorPerSecond,delayCapMinor:t.delayCapMinor,passengers,cargo}});
    const terms={expectedRevenueMinor:minor(String(expected)),expectedCostMinor:t.expectedCostMinor,reserveMinor:t.reserveMinor,energy:p.requirements,demandBucketIds:t.claims.map(c=>c.bucketId),risks:t.risks};
    return {p,tid,demand,revenue,terms,allocationSha256:await digest(allocationKey(allocated.claims))};
  }
  async function makeOffer(s:DispatchState,at:number,q:ReturnType<typeof quoteInput>):Promise<Offer>{
    const v=await preview(s,at,q.trainId,q.templateId,q.quoteId);
    const envelope=await createTripQuote(graph,v.p.request,v.p.route,{id:q.quoteId,trainId:q.trainId,stateVersion:s.revision,issuedAtSimS:at,expiresAtSimS:checkedAdd(at,v.p.settings.quoteTtlS),configurationSha256,terms:v.terms});
    return freeze({templateId:q.templateId,quote:envelope,quoteSha256:envelope.quoteSha256,allocationSha256:v.allocationSha256});
  }
  const events:Registry=Object.freeze({...movement.events,'fleet.command':fleetCommand,'fleet.complete':fleetCompletion,'dispatch.execute':executeInput,'dispatch.terminal':terminalEvent,'dispatch.financial-boundary':object({atSimS:integer}),'finance.command':financeCommand});
  async function post(s:DispatchState,action:unknown,commandId:string){
    return (await applyGovernedAccountingCommand(s.accounting,src(s),cfg.governance,{expectedRevision:s.accounting.revision,expectedSources:versionMap(s),commandId,action})).accounting;
  }
  const terminalId=async(commandId:string,kind:string)=>'r35:'+kind+':'+await digest({configurationSha256,commandId,kind});
  const financeId=async(q:string)=>'r44:'+await digest({configurationSha256,commandId:q});
  async function runFinance(s:DispatchState,q:ReturnType<typeof financeCommand>,at:number){
    if(!life)fail('financial lifecycle not configured');
    const {g,a,due}=await financialBoundary(s);
    if(a.liquidityView.simTimeS>at||(due!==null&&at>=due))fail('mandatory financial boundary first');
    if(g.stage==='RESTART_AUTHORIZED')fail('archived company');
    const aid=await financeId(q.commandId),action=q.action;
    if(s.accounting.transactions.some(t=>t.commandId===aid))fail('finance command already used; replay via durable request ID');
    if(a.pending.assets||a.pending.operations||a.pending.incentives||a.pending.energyLots.length||a.pending.energyReservations.length||a.pending.trips.length)fail('unreconciled accounting sources');
    let next:DispatchState={...s};
    if(action.type==='purchase'||action.type==='contract'){
      if(g.stage!=='HEALTHY')fail('energy procurement requires healthy company');
      let market=s.market??fail('energy market not configured');
      if(action.quantity==='0')fail('positive energy quantity required');
      if(inspectEnergyMarket(market).simTimeS<at)market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'advance',targetSimS:at}});
      if(action.type==='purchase'){
        market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'purchase',unit:action.unit,quantity:action.quantity,contractId:action.contractId,lotId:aid,availableCashMinor:a.liquidityView.availableCashMinor}});
        next={...next,market,energy:inspectEnergyMarket(market).energy};
        next={...next,accounting:await post(next,{type:'buy-energy',atSimS:at,lotId:aid},aid)};
      }else{
        market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'contract',contractId:aid,unit:action.unit,quantity:action.quantity,expiresAtSimS:action.expiresAtSimS}});
        next={...next,market,energy:inspectEnergyMarket(market).energy};
        next={...next,accounting:await post(next,{type:'advance',atSimS:at},aid)};
      }
    }else if(action.type==='repay'){
      next={...next,accounting:await post(next,{type:'repay',atSimS:at,loanId:action.loanId,amountMinor:action.amountMinor},aid)};
    }else{
      // R31 owns recovery terms. Advance the same accounting clock first,
      // never grant a loan or alter fleet/stock liquidation from the UI.
      next={...next,accounting:await post(next,{type:'advance',atSimS:at},aid)};
      let market=next.market;
      if(market&&inspectEnergyMarket(market).simTimeS<at)market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'advance',targetSimS:at}});
      next={...next,market,energy:market?inspectEnergyMarket(market).energy:next.energy};
      const recovered=await applyRecoveryCommand(next.accounting,src(next),cfg.governance,{id:aid.slice('r44:'.length),expectedAccountingRevision:next.accounting.revision,expectedSources:versionMap(next),action},market??undefined);
      next={...next,accounting:recovered.accounting,operations:recovered.operations,energy:recovered.energy,market:recovered.market};
    }
    return decodeState({...next,revision:checkedAdd(s.revision,1)});
  }
  async function runBoundary(s:DispatchState,at:number){
    if(!life)throw new Error('R35: lifecycle not configured');
    const b=await financialBoundary(s);
    if(b.due!==at)fail('stale financial boundary event');
    // R31 assesses grace expiry before any ordinary same-time event. Payroll,
    // interest and market are all posted against the same canonical timestamp.
    let next:DispatchState={...s,accounting:await post(s,{type:'advance',atSimS:at},await terminalId(String(at),'boundary'))};
    if(b.payroll?.at===at){
      const periodIndex=b.payroll.periodIndex;
      const operations=applyOperatingEvent(catalog,next.operations,{expectedRevision:next.operations.revision,event:{type:'overhead',period:{periodIndex,settledAtSimS:at}}});
      next={...next,operations};next={...next,accounting:await post(next,{type:'overhead',atSimS:at,periodIndex},await terminalId(String(periodIndex),'payroll'))};
    }
    if(next.market&&inspectEnergyMarket(next.market).simTimeS<at){
      const market=applyMarketAction(next.market,{expectedRevision:next.market.revision,action:{type:'advance',targetSimS:at}});
      next={...next,market,energy:inspectEnergyMarket(market).energy};
    }
    return decodeState({...next,revision:checkedAdd(s.revision,1)});
  }
  /** Terminal evidence derives from canonical movement, not user-supplied
   * arrival, passenger counts, consumption, rates or costs. */
  async function closeTrip(s:DispatchState,q:ReturnType<typeof terminalEvent>,at:number):Promise<EventTransition<DispatchState>>{
    if(!life)throw new Error('R35: lifecycle not configured');
    if(s.receipts.some(r=>r.commandId===q.commandId)||s.closures.some(r=>r.commandId===q.commandId||r.tripId===q.tripId))fail('duplicate terminal command or trip');
    const r=s.receipts.find(x=>x.tripId===q.tripId)??fail('unknown dispatch receipt'),p=plan(r.templateId),tp=terminalPolicy(r.templateId);
    const m=s.movement.trips.find(x=>x.tripId===q.tripId)??fail('missing movement trip');
    const elapsed=at-m.departureSimS,phases=p.movement.phases,arrived=m.phaseIndex===phases.length;
    const arrival=checkedAdd(m.departureSimS,p.movement.durationS);
    if(q.outcome==='settled'&&(!arrived||at<arrival||q.cancelEventId!==null))fail('settlement requires actual arrival');
    if(q.outcome==='cancelled'&&(arrived||elapsed<0||q.cancelEventId===null))fail('cannot cancel arrived or missing active trip');
    let node=p.movement.destination,distance=p.movement.distanceM,stopIndex=p.route.route.stopIds.length-1,actualAt=arrival;
    const completed=phases.filter(x=>x.kind==='MOVE'&&x.endS<=elapsed);
    if(q.outcome==='cancelled'){
      actualAt=at;
      if(m.phaseIndex<0){node=p.movement.origin;distance=0;stopIndex=0;}
      else{
        const phase=phases[m.phaseIndex];if(!phase||phase.kind==='MOVE'&&elapsed!==phase.startS)fail('cancel only at a safe station boundary');
        node=phase.from;distance=phase.distanceBeforeM;
        // Match stop occurrence by cumulative path distance, not node alone.
        let total=0;stopIndex=node===p.route.stopAnchors[0]&&distance===0?0:-1;
        for(let i=0;i<p.segments.length;i++){total=checkedAdd(total,p.segments[i]);if(total===distance&&p.route.stopAnchors[i+1]===node)stopIndex=i+1;}
        if(stopIndex<0)fail('cancel only at a scheduled station');
      }
      const d=s.demand.trips.find(t=>t.tripId===q.tripId)!;
      if(d.claims.some(c=>c.allocated>0&&c.alightIndex<=stopIndex))fail('partial delivered OD requires explicit partial-delivery contract');
      if(distance===0&&elapsed!==0)fail('unmodeled origin idle cancellation cost');
    }
    const term=s.revenue.records.find(x=>x.terms.tripId===q.tripId)??fail('missing locked revenue');
    const inspection=q.outcome==='settled'&&tp.inspectionMode==='configured'&&term.terms.passengers.length>0;
    const projected=inspection?projectInspection(s.incentives,s.demand,s.revenue,q.tripId,term.terms.passengers.map(x=>({bucketId:x.bucketId,classId:x.classId,checked:Number(BigInt(x.quantity)*BigInt(tp.checkedBps)/10000n)}))):[];
    const passengers=q.outcome==='settled'?term.terms.passengers.map(x=>{
      const row=projected.find(y=>y.bucketId===x.bucketId&&y.classId===x.classId),paid=row?.paid??x.quantity,unpaid=row?.unpaid??0;
      const refund=tp.refunds.find(y=>y.classId===x.classId)??fail('missing refund policy');
      return {bucketId:x.bucketId,classId:x.classId,paid,unpaid,refundMinor:minor(String(BigInt(paid)*BigInt(refund.minorPerPaid)))};
    }):[];
    const cargo=q.outcome==='settled'?term.terms.cargo.map(x=>({consignmentId:x.consignmentId,deliveredKg:x.massKg,finalDestinationId:s.demand.buckets.find(b=>b.bucket.id===x.bucketId)!.bucket.destination})):[];
    const demand=closeDemand(s.demand,{expectedRevision:s.demand.revision,tripId:q.tripId,outcome:q.outcome==='settled'?'served':'released'});
    const revenue=settleRevenue(s.revenue,demand,{expectedRevision:s.revenue.revision,expectedDemandRevision:demand.revision,tripId:q.tripId,evidence:{arrivalSimS:q.outcome==='settled'?arrival:null,passengers,cargo}});
    let requirements:unknown=p.requirements;
    if(q.outcome==='cancelled'){
      const inputs=p.energyInputs.slice(0,completed.length);
      const next=p.energyInputs[completed.length],last=completed.at(-1)?.endS??0,wait=elapsed-last;
      if(wait>0&&next)inputs.push({...next,distanceM:0,runningS:0,idleS:wait,requestedRegenWh:energyQuantity('0'),maxRegenBps:basisPoints(0)});
      requirements=inputs.length?estimateEnergy(catalog,p.reference,inputs).energy:[];
    }
    const energyEvent={type:'close',reservationId:q.tripId,outcome:q.outcome==='cancelled'&&distance===0?'released':'consumed',actual:requirements};
    let market=s.market,energy:EnergyBook;
    if(market){if(inspectEnergyMarket(market).simTimeS<at)market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'advance',targetSimS:at}});
      market=applyMarketAction(market,{expectedRevision:market.revision,action:energyEvent});energy=inspectEnergyMarket(market).energy;
    }else energy=applyEnergyEvent(s.energy,{expectedRevision:s.energy.revision,event:energyEvent});
    let operations=s.operations,incentives=s.incentives;
    if(distance>0){
      const segments=p.route.steps.slice(0,completed.length).map((x,i)=>({edgeId:x.edgeId,regionId:graph.regionId,trackClass:tp.trackClasses[i],distanceM:x.distanceM}));
      const crew=life.crew.find(c=>c.trainId===r.trainId)??fail('missing crew assignment');
      const terminals=tp.terminals.filter(x=>q.outcome==='settled'||x.stopIndex<=stopIndex&&x.activity!=='arrival');
      operations=applyOperatingEvent(catalog,operations,{expectedRevision:operations.revision,event:{type:'trip',trip:{tripId:q.tripId,trainId:r.trainId,departureSimS:r.atSimS,arrivalSimS:actualAt,settledAtSimS:at,stopIds:p.route.route.stopIds,distanceM:distance,segments,terminals,shifts:crew.employeeIds.map((employeeId,i)=>({shiftId:q.tripId+':crew:'+i,employeeId,startSimS:r.atSimS,endSimS:actualAt})),loadFactorBps:tp.loadFactorBps}}});
    }
    let next:DispatchState={...s,demand,revenue,energy,market,operations,incentives};
    const aid=await terminalId(q.commandId,'close');
    next={...next,accounting:await post(next,{type:'settle-trip',atSimS:at,tripId:q.tripId},aid)};
    if(inspection){
      incentives=applyIncentiveEvent(next.incentives,demand,revenue,{expectedRevision:next.incentives.revision,expectedDemandRevision:demand.revision,expectedRevenueRevision:revenue.revision,event:{type:'inspection',tripId:q.tripId,atSimS:at,classes:projected.map(x=>({bucketId:x.bucketId,classId:x.classId,checked:x.checked,collected:Number(BigInt(x.detected)*BigInt(tp.collectedBps)/10000n)}))}});
      next={...next,incentives};next={...next,accounting:await post(next,{type:'fine',atSimS:at,tripId:q.tripId},await terminalId(q.commandId,'fine'))};
    }
    if(q.outcome==='settled'&&tp.subsidyProgramId!==null){
      const program=next.incentives.config.programs.find(x=>x.program.id===tp.subsidyProgramId)??fail('unknown subsidy program');
      if(program.serviceId===p.settings.serviceId&&same(program.stopIds,p.route.route.stopIds)&&r.atSimS>=program.program.startS&&arrival<program.program.endS&&at<program.program.endS){
        incentives=applyIncentiveEvent(next.incentives,demand,revenue,{expectedRevision:next.incentives.revision,expectedDemandRevision:demand.revision,expectedRevenueRevision:revenue.revision,event:{type:'subsidy',tripId:q.tripId,programId:tp.subsidyProgramId,atSimS:at}});
        next={...next,incentives};next={...next,accounting:await post(next,{type:'subsidy',atSimS:at,tripId:q.tripId},await terminalId(q.commandId,'subsidy'))};
      }
    }
    const asset=inspectOperatingBook(catalog,next.operations).maintenance.find(x=>x.trainId===r.trainId)?.asset;
    if(asset&&asset.disposedAtSimS===null&&asset.depreciatedThroughSimS<at){
      operations=applyOperatingEvent(catalog,next.operations,{expectedRevision:next.operations.revision,event:{type:'depreciate',trainId:r.trainId,atSimS:at}});
      next={...next,operations};next={...next,accounting:await post(next,{type:'depreciation',atSimS:at,trainId:r.trainId,throughSimS:at},await terminalId(q.commandId,'depreciation'))};
    }
    const closure=terminalReceipt({commandId:q.commandId,tripId:q.tripId,outcome:q.outcome,atSimS:at,arrivalSimS:q.outcome==='settled'?arrival:null,nodeId:node,phaseIndex:m.phaseIndex,distanceM:distance,accountingCommandId:aid});
    const movementBook=fleet||q.outcome==='cancelled'?movementDecoder({...next.movement,trips:next.movement.trips.filter(x=>x.tripId!==q.tripId)}):next.movement;
    return {state:decodeState({...next,movement:movementBook,closures:[...s.closures,closure],fleetHistory:fleetLog(s,{commandId:q.commandId,trainId:r.trainId,kind:'close',atSimS:at,tripId:q.tripId,yardId:q.outcome==='settled'?fleet?.destination(r.templateId)??null:null,jobId:null}),revision:checkedAdd(s.revision,1)}),cancel:q.cancelEventId?[q.cancelEventId]:[]};
  }
  const fleetId=async(commandId:string,kind:string)=>'r36:'+kind+':'+await digest({configurationSha256,commandId,kind});
  async function fleetAction(s:DispatchState,event:Readonly<SimEvent>,at:number):Promise<EventTransition<DispatchState>>{
    if(!fleet)throw Error('R36: fleet not configured');
    const done=event.kind==='fleet.complete';
    if(done){
      const q=fleetCompletion(event.payload),r=fleetRow(s,q.trainId);
      const job=inspectOperatingBook(catalog,s.operations).maintenance.find(x=>x.trainId===q.trainId)?.activeJob;
      if(r.state!=='SERVICE'||r.jobId!==q.jobId||!job||job.job.id!==q.jobId||job.job.endS!==at)fail('invalid service completion time or identity');
      const operations=applyOperatingEvent(catalog,s.operations,{expectedRevision:s.operations.revision,event:{type:'service-complete',trainId:q.trainId,jobId:q.jobId,atSimS:at}});
      const commandId=await fleetId(q.jobId,'complete');
      const candidate={...s,operations};
      const accounting=await post(candidate,{type:'advance',atSimS:at},await fleetId(q.jobId,'completion-clock'));
      const next=decodeState({...candidate,accounting,fleetHistory:fleetLog(s,{commandId,trainId:q.trainId,kind:'complete',atSimS:at,tripId:null,yardId:r.yardId,jobId:q.jobId}),revision:checkedAdd(s.revision,1)});
      projectFleet(next);return {state:next};
    }
    const q=fleetCommand(event.payload),row=fleetRow(s,q.trainId);
    if(q.commandId.startsWith('r36:')||s.fleetHistory.some(x=>x.commandId===q.commandId)||s.receipts.some(x=>x.commandId===q.commandId)||s.closures.some(x=>x.commandId===q.commandId))fail('duplicate or reserved fleet command ID');
    if(row.tripId||row.inboundYardId||row.jobId)fail('train active or in service');
    const {g,a,due}=await financialBoundary(s);
    if(due!==null&&at>=due)fail('mandatory financial boundary must run first');
    if(g.stage==='RESTART_AUTHORIZED')fail('company archived');
    const av=inspectMaintenanceAvailability(catalog,s.operations,q.trainId,at);
    if(av==='DISPOSED'||av==='UNCONFIGURED'||av==='SERVICE')fail('invalid asset availability');
    let next=s;
    let jobId:string|null=null;
    let schedule:EventTransition<DispatchState>['schedule']=[];
    if(q.action==='service'){
      if(q.yardId!==null||row.state!=='PARKED'||row.yardId===null||g.stage==='LIQUIDATION')fail('service requires owned parked train and active company');
      if(av!=='REPAIR_DUE'&&av!=='SERVICE_DUE')fail('service not due');
      jobId=await fleetId(q.commandId,'job');
      const operations=applyOperatingEvent(catalog,s.operations,{expectedRevision:s.operations.revision,event:{type:'service-start',trainId:q.trainId,jobId,atSimS:at,availableCashMinor:a.liquidityView.availableCashMinor}});
      const active=inspectOperatingBook(catalog,operations).maintenance.find(x=>x.trainId===q.trainId)?.activeJob??fail('missing active service');
      next={...s,operations};next={...next,accounting:await post(next,{type:'maintenance',atSimS:at,jobId},await fleetId(q.commandId,'maintenance'))};
      schedule=[{kind:'fleet.complete',simTimeS:active.job.endS,payload:{trainId:q.trainId,jobId}}];
    }else if(q.action==='park'){
      if(q.yardId===null)fail('yard required');
      if(!['IDLE','ASSIGNED'].includes(row.state))fail('invalid parking transition');
      const target=fleet.capacity(projectFleet(s),q.yardId??fail('yard required'));if(target.nodeId!==row.nodeId)fail('parking requires actual base location');
    }else {
      if(q.yardId!==null||row.state!=='PARKED')fail('invalid unpark transition');
      if(av!=='AVAILABLE')fail('train requires service before unpark');
      if(g.stage==='LIQUIDATION')fail('company cannot unpark during liquidation');
    }
    const item=fleetRecord({commandId:q.commandId,trainId:q.trainId,kind:q.action,atSimS:at,tripId:null,yardId:q.action==='service'?row.yardId:q.yardId,jobId});
    const out=decodeState({...next,fleetHistory:fleetLog(s,item),revision:checkedAdd(s.revision,1)});
    projectFleet(out);return {state:out,schedule};
  }
  async function reduce(input:Readonly<DispatchState>,event:Readonly<SimEvent>):Promise<EventTransition<DispatchState>>{
    const s=decodeState(input),at=integer(event.simTimeS);
    if(event.kind==='fleet.command'||event.kind==='fleet.complete')return fleetAction(s,event,at);
    if(event.kind==='dispatch.financial-boundary'){if(object({atSimS:integer})(event.payload).atSimS!==at)fail('boundary time mismatch');return {state:await runBoundary(s,at)};}
    if(event.kind==='finance.command')return {state:await runFinance(s,financeCommand(event.payload),at)};
    if(event.kind==='dispatch.terminal')return closeTrip(s,terminalEvent(event.payload),at);
    if(event.kind==='movement.phase'){
      const out=fleet?movement.reduceFleet(s.movement,event):movement.reduce(s.movement,event);
      return {state:{...s,movement:out.state,revision:checkedAdd(s.revision,1)},schedule:out.schedule,cancel:out.cancel};
    }
    if(event.kind!=='dispatch.execute')return fail('unknown aggregate event');
    const q=executeInput(event.payload),p=plan(q.templateId),offer=q.quote;
    if(q.baseVersion>s.revision||offer.quote.stateVersion!==q.baseVersion)fail('stale quote revision');
    if(s.receipts.length>=cfg.maxReceipts||s.receipts.some(r=>r.commandId===q.commandId||r.quoteId===offer.quote.id)||s.closures.some(r=>r.commandId===q.commandId)||s.fleetHistory.some(r=>r.commandId===q.commandId))fail('duplicate dispatch or receipt limit');
    await validateTripQuote(graph,p.request,offer,{quoteSha256:q.quoteSha256,trainId:offer.quote.trainId,stateVersion:q.baseVersion,simTimeS:at,configurationSha256});
    const v=await preview(s,at,offer.quote.trainId,q.templateId,offer.quote.id);
    if(v.allocationSha256!==q.allocationSha256)fail('quoted demand allocation changed');
    const recalculated=await createTripQuote(graph,p.request,p.route,{id:offer.quote.id,trainId:offer.quote.trainId,stateVersion:q.baseVersion,issuedAtSimS:offer.issuedAtSimS,expiresAtSimS:offer.quote.expiresAtSimS,configurationSha256,terms:v.terms});
    if(recalculated.quoteSha256!==q.quoteSha256)fail('quoted terms changed');
    // All following calls are pure candidates. No assignment to committed state
    // until R32 and the controller validate the entire resulting snapshot.
    const moveEvent={...event,kind:'movement.reserve',payload:{tripId:v.tid,trainId:offer.quote.trainId,planId:p.movement.id,departureSimS:at}};
    const m=fleet?movement.reduceFleet(s.movement,moveEvent,fleetRow(s,offer.quote.trainId).nodeId):movement.reduce(s.movement,moveEvent);
    let market=s.market,energy:EnergyBook;
    if(market){
      const mv=inspectEnergyMarket(market);
      if(mv.simTimeS>at)fail('market clock ahead of simulation');
      if(mv.simTimeS<at)market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'advance',targetSimS:at}});
      market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'reserve',reservationId:v.tid,requirements:p.requirements}});
      energy=inspectEnergyMarket(market).energy;
    }else energy=applyEnergyEvent(s.energy,{expectedRevision:s.energy.revision,event:{type:'reserve',reservationId:v.tid,requirements:p.requirements}});
    const books={...s,demand:v.demand,revenue:v.revenue,energy,market};
    const aid=await accountingId(q.commandId);
    if(s.accounting.transactions.some(x=>x.commandId===aid))fail('accounting command identity already used');
    const accounting=(await applyGovernedAccountingCommand(s.accounting,src(books),cfg.governance,{expectedRevision:s.accounting.revision,expectedSources:versionMap(books),commandId:aid,action:{type:'reserve-trip',atSimS:at,tripId:v.tid,amountMinor:offer.quote.reserveMinor}})).accounting;
    const receipt=receiptDecoder({commandId:q.commandId,quoteId:offer.quote.id,templateId:q.templateId,trainId:offer.quote.trainId,tripId:v.tid,atSimS:at,quote:offer,quoteSha256:q.quoteSha256,allocationSha256:q.allocationSha256,accountingCommandId:aid});
    return {state:decodeState({...books,accounting,movement:m.state,revision:checkedAdd(s.revision,1),receipts:[...s.receipts,receipt],fleetHistory:fleetLog(s,{commandId:q.commandId,trainId:offer.quote.trainId,kind:'dispatch',atSimS:at,tripId:v.tid,yardId:fleet?.destination(q.templateId)??null,jobId:null})}),schedule:m.schedule,cancel:m.cancel};
  }
  const scheduler=createScheduler<DispatchState>({policySha256:configurationSha256,graphSha256s:[graph.graphSha256],maxPending:cfg.maxPending,decodeState,events,reduce,nextBoundary:async s=>{
    const {due}=await financialBoundary(s);return due===null?null:{simTimeS:due,kind:'dispatch.financial-boundary'};
  }});
  async function verify(input:unknown):Promise<Snapshot>{
    const s=await scheduler.restore(input),b=s.state;
    await decodeAccountingBook(b.accounting,src(b));
    const a=await inspectAccountingBook(b.accounting,src(b)),energy=inspectEnergyBook(b.energy);
    const {due}=await financialBoundary(b);
    if(a.liquidityView.simTimeS>s.simTimeS||(due!==null&&(life?s.simTimeS>due:s.simTimeS>=due)))fail('unreconciled financial clock');
    if(b.market&&inspectEnergyMarket(b.market).simTimeS>s.simTimeS)fail('market clock ahead of simulation');
    if(fleet){
      projectFleet(b);
      for(const h of b.fleetHistory){
        if(h.atSimS>s.simTimeS)fail('future fleet record');
        if(h.kind==='service'){
          if(h.jobId!==await fleetId(h.commandId,'job'))fail('service job identity mismatch');
          const aid=await fleetId(h.commandId,'maintenance'),tx=b.accounting.transactions.find(x=>x.commandId===aid);
          if(!tx||tx.action.type!=='maintenance'||tx.action.jobId!==h.jobId||tx.action.atSimS!==h.atSimS)fail('service accounting mismatch');
        }
        if(h.kind==='complete'){
          if(h.commandId!==await fleetId(h.jobId!,'complete'))fail('service completion identity mismatch');
          const aid=await fleetId(h.jobId!,'completion-clock'),tx=b.accounting.transactions.find(x=>x.commandId===aid);
          if(!tx||tx.action.type!=='advance'||tx.action.atSimS!==h.atSimS)fail('service completion accounting clock mismatch');
        }
      }
    }
    const ids=sortedIds(b.receipts.filter(r=>!b.closures.some(c=>c.tripId===r.tripId)).map(r=>r.tripId));
    for(const actual of [b.movement.trips.filter(t=>!b.closures.some(c=>c.tripId===t.tripId)).map(t=>t.tripId),b.demand.trips.filter(t=>t.status==='reserved').map(t=>t.tripId),b.revenue.records.filter(r=>!r.closed).map(r=>r.terms.tripId),energy.reservations.filter(r=>!r.closed).map(r=>r.id),a.liquidityView.reservations.filter(r=>!r.closed).map(r=>r.id)])if(!same(ids,sortedIds(actual)))fail('orphan or missing active reservation');
    const expected=new Map<string,{phaseIndex:number;simTimeS:number}>();
    for(const r of b.receipts){
      const p=plan(r.templateId),m=b.movement.trips.find(t=>t.tripId===r.tripId)!,d=b.demand.trips.find(t=>t.tripId===r.tripId)!,rev=b.revenue.records.find(t=>t.terms.tripId===r.tripId)!,er=energy.reservations.find(t=>t.id===r.tripId)!,cash=a.liquidityView.reservations.find(t=>t.id===r.tripId)!;
      const closure=b.closures.find(c=>c.tripId===r.tripId);
      if(!d||!rev||!er||!cash)fail('missing dispatch source history');
      if(r.atSimS>s.simTimeS||r.tripId!==await tripId(r.quoteId)||r.accountingCommandId!==await accountingId(r.commandId)||(!closure||(!fleet&&closure.outcome==='settled'))&&(!m||m.trainId!==r.trainId||m.planId!==p.movement.id||m.departureSimS!==r.atSimS)||d.dispatchSimS!==r.atSimS||rev.terms.policySha256!==configurationSha256||r.quote.quote.id!==r.quoteId||r.quote.quote.stateVersion>=b.revision||cash.amountMinor!==r.quote.quote.reserveMinor||await digest(allocationKey(d.claims))!==r.allocationSha256)fail('dispatch receipt binding mismatch');
      await validateTripQuote(graph,p.request,r.quote,{quoteSha256:r.quoteSha256,trainId:r.trainId,stateVersion:r.quote.quote.stateVersion,simTimeS:r.atSimS,configurationSha256});
      const tx=b.accounting.transactions.find(x=>x.commandId===r.accountingCommandId);
      if(!tx||tx.action.type!=='reserve-trip'||tx.action.tripId!==r.tripId||tx.action.atSimS!==r.atSimS||tx.action.amountMinor!==cash.amountMinor)fail('missing accounting reservation transaction');
      const sums=new Map<string,bigint>();for(const x of er.allocations)sums.set(x.unit,(sums.get(x.unit)??0n)+BigInt(x.quantity));
      if(!same([...sums].sort((x,y)=>cmp(x[0],y[0])).map(([unit,n])=>({unit,quantity:String(n)})),r.quote.quote.energy.map(x=>({unit:x.unit,quantity:x.quantity})).sort((x,y)=>cmp(x.unit,y.unit))))fail('locked energy quantities mismatch');
      if(closure){
        const tx=b.accounting.transactions.find(x=>x.commandId===closure.accountingCommandId);
        if(closure.accountingCommandId!==await terminalId(closure.commandId,'close')||closure.atSimS<r.atSimS||closure.atSimS>s.simTimeS||!tx||tx.action.type!=='settle-trip'||tx.action.tripId!==r.tripId||tx.action.atSimS!==closure.atSimS||!rev.closed||!er.closed||!cash.closed)fail('terminal receipt binding mismatch');
        const op=b.operations.events.find(e=>e.type==='trip'&&e.trip.tripId===r.tripId);
        if(closure.outcome==='settled'){
          if(d.status!=='served'||er.closed?.outcome!=='consumed'||(!fleet&&(!m||m.phaseIndex!==p.movement.phases.length))||(fleet&&!!m)||closure.phaseIndex!==p.movement.phases.length||closure.nodeId!==p.movement.destination||closure.distanceM!==p.movement.distanceM||closure.arrivalSimS!==checkedAdd(r.atSimS,p.movement.durationS)||rev.closed?.evidence.arrivalSimS!==closure.arrivalSimS||!op||op.type!=='trip'||op.trip.distanceM!==closure.distanceM||op.trip.arrivalSimS!==closure.arrivalSimS)fail('settled trip evidence mismatch');
        }else if(m||d.status!=='released'||closure.arrivalSimS!==null||rev.closed?.evidence.arrivalSimS!==null||closure.distanceM>=p.movement.distanceM||(closure.distanceM===0?(er.closed?.outcome!=='released'||!!op||closure.nodeId!==p.movement.origin||closure.atSimS!==r.atSimS):(er.closed?.outcome!=='consumed'||!op||op.type!=='trip'||op.trip.distanceM!==closure.distanceM||op.trip.arrivalSimS!==closure.atSimS)))fail('cancelled trip evidence mismatch');
        if(closure.outcome==='cancelled'){
          const elapsed=closure.atSimS-r.atSimS,phases=p.movement.phases;
          if(closure.phaseIndex===-1){
            if(elapsed!==0||closure.distanceM!==0||closure.nodeId!==p.movement.origin)fail('invalid predeparture cancellation position');
          }else{
            const phase=phases[closure.phaseIndex];
            if(!phase||elapsed<phase.startS||elapsed>=phase.endS||phase.kind==='MOVE'&&elapsed!==phase.startS||phase.from!==closure.nodeId||phase.distanceBeforeM!==closure.distanceM)fail('cancelled position does not match actual phase');
            let distance=0,stopIndex=closure.nodeId===p.route.stopAnchors[0]&&closure.distanceM===0?0:-1;
            for(let i=0;i<p.segments.length;i++){distance=checkedAdd(distance,p.segments[i]);if(distance===closure.distanceM&&p.route.stopAnchors[i+1]===closure.nodeId)stopIndex=i+1;}
            if(stopIndex<0||d.claims.some(c=>c.allocated>0&&c.alightIndex<=stopIndex))fail('cancelled station or partial-delivery mismatch');
          }
        }
        continue;
      }
      const phase=m.phaseIndex+1,phases=p.movement.phases;
      if(m.phaseIndex>=0){const t=checkedAdd(m.departureSimS,m.phaseIndex===phases.length?p.movement.durationS:phases[m.phaseIndex].startS);if(t>s.simTimeS)fail('movement phase in future');}
      if(phase<=phases.length){const t=checkedAdd(m.departureSimS,phase===phases.length?p.movement.durationS:phases[phase].startS);if(t<s.simTimeS)fail('overdue movement phase');expected.set(r.tripId,{phaseIndex:phase,simTimeS:t});}
    }
    const servicePending=new Map<string,{trainId:string;at:number}>();
    if(fleet)for(const x of inspectOperatingBook(catalog,b.operations).maintenance)if(x.activeJob){
      if(x.activeJob.job.endS<s.simTimeS)fail('overdue service completion');
      servicePending.set(x.activeJob.job.id,{trainId:x.trainId,at:x.activeJob.job.endS});
    }
    if(b.closures.some(c=>!b.receipts.some(r=>r.tripId===c.tripId)))fail('orphan terminal receipt');
    const boundary=s.pendingEvents.filter(e=>e.kind==='dispatch.financial-boundary');
    if(life){
      if(due===null?boundary.length!==0:boundary.length!==1||boundary[0].simTimeS!==due||s.pendingEvents.some(e=>e.simTimeS===due&&e.sequence<boundary[0].sequence))fail('invalid mandatory boundary queue');
    }else if(boundary.length)fail('unexpected financial boundary');
    for(const e of s.pendingEvents){
      if(e.kind==='dispatch.financial-boundary')continue;
      if(e.kind==='fleet.complete'){const q=fleetCompletion(e.payload),j=servicePending.get(q.jobId);if(!j||j.trainId!==q.trainId||j.at!==e.simTimeS)fail('invalid service completion queue');servicePending.delete(q.jobId);continue;}
      if(e.kind!=='movement.phase')fail('unexpected pending aggregate event');
      const p=object({tripId:id,phaseIndex:integer})(e.payload),x=expected.get(p.tripId);
      if(!x||x.phaseIndex!==p.phaseIndex||x.simTimeS!==e.simTimeS)fail('invalid or duplicate pending phase');
      expected.delete(p.tripId);
    }
    if(expected.size||servicePending.size)fail('missing movement or service phase');
    return s;
  }
  // Keep exactly one next mandatory event in the single R32 queue. Explicit
  // resequencing of same-time ordinary events guarantees boundary first without
  // adding a hidden comparator priority or partition-dependent idle timestamps.
  async function syncBoundary(s:Snapshot):Promise<Snapshot>{
    if(!life)return s;
    const {due}=await financialBoundary(s.state);
    const old=s.pendingEvents.filter(e=>e.kind==='dispatch.financial-boundary');
    if(due!==null&&due<s.simTimeS)fail('overdue financial boundary');
    if(due===null)return old.length?scheduler.cancel(s,old.map(e=>e.id)):s;
    const ordinary=s.pendingEvents.filter(e=>e.kind!=='dispatch.financial-boundary'&&e.simTimeS===due);
    if(old.length===1&&old[0].simTimeS===due&&ordinary.every(e=>e.sequence>old[0].sequence))return s;
    const remove=[...old,...ordinary];let out=remove.length?await scheduler.cancel(s,remove.map(e=>e.id)):s;
    return scheduler.enqueue(out,[{kind:'dispatch.financial-boundary',simTimeS:due,payload:{atSimS:due}},...ordinary.map(e=>({kind:e.kind,simTimeS:e.simTimeS,payload:e.payload}))]);
  }
  function controller(initial:Snapshot,restored:Offer[]=[]){
    let current=initial,tail:Promise<unknown>=Promise.resolve();
    const issued=new Map<string,Offer>(restored.map(o=>[o.quote.quote.id,o]));
    function serial<T>(fn:()=>Promise<T>):Promise<T>{const run=tail.then(fn);tail=run.then(()=>undefined,()=>undefined);return run;}
    function cas(value:unknown){if(sha256(value)!==current.checksum)fail('STALE_SNAPSHOT');}
    async function quoteTrip(input:unknown,expectedChecksum:unknown){
      const q=quoteInput(input),expected=sha256(expectedChecksum);
      return serial(async()=>{
        cas(expected);const old=issued.get(q.quoteId);
        if(old){if(old.templateId!==q.templateId||old.quote.quote.trainId!==q.trainId)fail('quote ID conflict');return old;}
        if(current.state.receipts.some(r=>r.quoteId===q.quoteId)||issued.size>=cfg.maxQuotes)fail('quote ID used or registry limit');
        const offer=await makeOffer(current.state,current.simTimeS,q);issued.set(q.quoteId,offer);return offer;
      });
    }
    function prior(s:Snapshot,q:ReturnType<typeof command>){
      const r=s.state.receipts.find(x=>x.commandId===q.commandId);
      if(r&&r.quoteId!==q.quoteId)fail('command ID conflict');return r;
    }
    async function run(s:Snapshot,q:ReturnType<typeof command>,base:Snapshot){
      const old=prior(s,q);if(old)return {snapshot:s,receipt:old,replayed:true};
      const offer=issued.get(q.quoteId)??fail('unknown trusted quote');
      const p=plan(offer.templateId);
      if(s.state.receipts.some(r=>r.quoteId===q.quoteId))fail('quote already used');
      await validateTripQuote(graph,p.request,offer.quote,{quoteSha256:offer.quoteSha256,trainId:offer.quote.quote.trainId,stateVersion:base.state.revision,simTimeS:s.simTimeS,configurationSha256});
      if(s.pendingEvents.some(e=>e.simTimeS<=s.simTimeS))fail('process due movement events first');
      const queued=await scheduler.enqueue(s,[{kind:'dispatch.execute',simTimeS:s.simTimeS,payload:{commandId:q.commandId,...offer,baseVersion:base.state.revision}}]);
      const out=await scheduler.advance(queued,s.simTimeS,2);
      if(!out.complete)fail('dispatch event budget exhausted');
      const snapshot=await verify(await syncBoundary(out.snapshot)),receipt=prior(snapshot,q)??fail('missing dispatch receipt');
      return {snapshot,receipt,replayed:false};
    }
    async function dispatch(input:unknown,expectedChecksum:unknown){
      const q=command(input),expected=sha256(expectedChecksum);
      return serial(async()=>{
        const old=prior(current,q);if(old)return freeze({snapshot:current,receipt:old,replayed:true});
        cas(expected);const out=await run(current,q,current);current=out.snapshot;return freeze(out);
      });
    }
    async function bulkDispatch(input:unknown,expectedChecksum:unknown){
      const qs=distinct(list(command,1,cfg.maxBulk),q=>q.commandId)(input),expected=sha256(expectedChecksum);
      return serial(async()=>{
        cas(expected);const base=current;
        const train=(q:typeof qs[number])=>base.state.receipts.find(r=>r.commandId===q.commandId)?.trainId??issued.get(q.quoteId)?.quote.quote.trainId??'~';
        qs.sort((a,b)=>cmp(train(a),train(b))||cmp(a.commandId,b.commandId));
        const results=[];
        for(const q of qs){try{const out=await run(current,q,base);current=out.snapshot;results.push({commandId:q.commandId,ok:true as const,receipt:out.receipt,replayed:out.replayed});}catch(e){results.push({commandId:q.commandId,ok:false as const,reason:reason(e)});}}
        return freeze({snapshot:current,results});
      });
    }
    async function terminal(input:unknown,expectedChecksum:unknown,outcome:'settled'|'cancelled'){
      const q=terminalCommand(input),expected=sha256(expectedChecksum);
      return serial(async()=>{
        if(!life)throw new Error('R35: lifecycle not configured');
        const prior=current.state.closures.find(r=>r.commandId===q.commandId);
        if(prior){if(prior.tripId!==q.tripId||prior.outcome!==outcome)fail('terminal command ID conflict');return freeze({snapshot:current,receipt:prior,replayed:true});}
        cas(expected);
        if(current.state.closures.some(r=>r.tripId===q.tripId))fail('trip already closed');
        if(current.pendingEvents.some(e=>e.simTimeS<=current.simTimeS))fail('process due events before terminal command');
        const pending=current.pendingEvents.find(e=>e.kind==='movement.phase'&&record(e.payload,'phase').tripId===q.tripId);
        const queued=await scheduler.enqueue(current,[{kind:'dispatch.terminal',simTimeS:current.simTimeS,payload:{...q,outcome,cancelEventId:outcome==='cancelled'?pending?.id??null:null}}]);
        const out=await scheduler.advance(queued,current.simTimeS,1);
        if(!out.complete)fail('terminal event budget exhausted');
        const snapshot=await verify(await syncBoundary(out.snapshot)),receipt=snapshot.state.closures.find(r=>r.commandId===q.commandId)??fail('missing terminal receipt');
        current=snapshot;return freeze({snapshot,receipt,replayed:false});
      });
    }
    async function fleetCommandRun(input:unknown,expectedChecksum:unknown){
      const q=fleetCommand(input),expected=sha256(expectedChecksum);
      return serial(async()=>{
        if(!fleet)fail('fleet not configured');
        const prior=current.state.fleetHistory.find(r=>r.commandId===q.commandId);
        if(prior){
          if(prior.kind!==q.action||prior.trainId!==q.trainId||(q.action==='service'?q.yardId!==null:prior.yardId!==q.yardId))fail('fleet command ID conflict');
          return freeze({snapshot:current,receipt:prior,replayed:true});
        }
        cas(expected);
        if(current.pendingEvents.some(e=>e.simTimeS<=current.simTimeS))fail('process due events before fleet command');
        const queued=await scheduler.enqueue(current,[{kind:'fleet.command',simTimeS:current.simTimeS,payload:q}]);
        const out=await scheduler.advance(queued,current.simTimeS,1);
        if(!out.complete)fail('fleet command event budget exhausted');
        const snapshot=await verify(await syncBoundary(out.snapshot)),receipt=snapshot.state.fleetHistory.find(r=>r.commandId===q.commandId)??fail('missing fleet receipt');
        current=snapshot;return freeze({snapshot,receipt,replayed:false});
      });
    }
    function inspectFleet(){
      const rows=projectFleet(current.state);
      return freeze(rows.map(r=>{
        const m=current.state.movement.trips.find(x=>x.tripId===r.tripId);
        if(!m)return r;
        const p=movement.plans.find(x=>x.id===m.planId)!;
        return {...r,nodeId:m.phaseIndex===p.phases.length?p.destination:m.phaseIndex<0?p.origin:p.phases[m.phaseIndex].kind==='MOVE'?null:p.phases[m.phaseIndex].from,state:m.phaseIndex===p.phases.length?'ARRIVED':m.phaseIndex<0?'RESERVED':p.phases[m.phaseIndex].kind==='MOVE'?'RUNNING':'DWELL'};
      }));
    }
    async function finance(input:unknown,expectedChecksum:unknown){
      const q=financeCommand(input),expected=sha256(expectedChecksum);
      return serial(async()=>{
        cas(expected);if(current.pendingEvents.some(e=>e.simTimeS<=current.simTimeS))fail('process due events before finance command');
        const before=await inspectAccountingBook(current.state.accounting,src(current.state)),aid=await financeId(q.commandId);
        const queued=await scheduler.enqueue(current,[{kind:'finance.command',simTimeS:current.simTimeS,payload:q}]);
        const out=await scheduler.advance(queued,current.simTimeS,1);if(!out.complete)fail('finance event budget exhausted');
        const snapshot=await verify(await syncBoundary(out.snapshot)),s=snapshot.state;
        const after=await inspectAccountingBook(s.accounting,src(s)),market=s.market?inspectEnergyMarket(s.market):null;
        const result=freeze({commandId:q.commandId,accountingCommandId:aid,action:q.action,atSimS:snapshot.simTimeS,cashBeforeMinor:before.liquidityView.cashMinor,cashAfterMinor:after.liquidityView.cashMinor,availableAfterMinor:after.liquidityView.availableCashMinor,debtBeforeMinor:before.liquidityView.totalPayoffMinor,debtAfterMinor:after.liquidityView.totalPayoffMinor,lot:market?.inventory.lots.find(x=>x.lot.id===aid)??null,contract:market?.contracts.find(x=>x.id===aid)??null,governance:await evaluateSolvency(s.accounting,src(s),cfg.governance),journal:after.journal.slice(before.journal.length)});
        current=snapshot;return freeze({snapshot,result});
      });
    }
    async function inspectFinance(){return serial(async()=>{
      const s=current.state,accounting=await inspectAccountingBook(s.accounting,src(s)),governance=await evaluateSolvency(s.accounting,src(s),cfg.governance);
      const end=Number(accounting.liquidityView.simTimeS),start=Number(s.accounting.startSimS);
      const period=end>start?await reportAccountingPeriod(s.accounting,src(s),{startSimS:Math.max(start,end-7*86400),endSimS:end}):null;
      let valuation:Awaited<ReturnType<typeof valueCompany>>|null=null,valuationError:string|null=null;
      try{valuation=await valueCompany(s.accounting,src(s),{companyId:cfg.governance.companyId,shares:null,stock:null});}catch(e){valuationError=reason(e);}
      return freeze({companyId:cfg.governance.companyId,simTimeS:current.simTimeS,accounting,governance,valuation,valuationError,period,policy:s.accounting.policy,governancePolicy:cfg.governance,progressionEvents:projectEventWindows(eventWindows??[],current.simTimeS),market:s.market?inspectEnergyMarket(s.market):null,marketPolicy:s.market?.config??null,energy:inspectEnergyBook(s.energy),supportsFinance:life!==null});
    });}
    async function inspectManagement(){return serial(async()=>{
      const s=current.state,energyView=inspectEnergyBook(s.energy),op=inspectOperatingBook(catalog,s.operations),accounting=await inspectAccountingBook(s.accounting,src(s)),governance=await evaluateSolvency(s.accounting,src(s),cfg.governance);
      const rows=inspectFleet().map(r=>{
        const own=s.operations.opening.find(t=>t.train.id===r.trainId)??fail('missing owned train');
        const model=catalog.resolve(own.catalogReference),condition=op.trains.find(t=>t.trainId===r.trainId)??fail('missing condition');
        const maintenance=op.maintenance.find(t=>t.trainId===r.trainId)??fail('missing maintenance');
        const trip=s.movement.trips.find(t=>t.tripId===r.tripId);
        const plan=trip?movement.plans.find(p=>p.id===trip.planId):undefined;
        return {...r,model,condition,maintenance:{...maintenance,availability:inspectMaintenanceAvailability(catalog,s.operations,r.trainId,current.simTimeS)},location:r.nodeId===null?null:graph.stationsAt(r.nodeId).map(t=>({id:t.id,name:t.name})),trip:trip&&plan?{departureSimS:trip.departureSimS,expectedArrivalSimS:checkedAdd(trip.departureSimS,plan.durationS),phaseIndex:trip.phaseIndex,distanceM:plan.distanceM}:null};
      });
      const templates=plans.map(p=>({id:p.settings.id,serviceId:p.settings.serviceId,modelId:p.reference.modelId,origin:p.movement.origin,destination:p.movement.destination,route:p.route.route,stations:p.route.route.stopIds.map(id=>({id,name:graph.station(id).name})),durationS:p.movement.durationS,relocationYardId:fleet?.destination(p.settings.id)??null,claims:p.settings.claims,requirements:p.requirements,risks:p.settings.risks,inferences:p.route.inferences,inspection:life?terminalPolicy(p.settings.id):null}));
      const yards=(fleet?.config.yards??[]).map(y=>{
        const base=fleet!.config.bases.find(b=>b.id===y.baseId)!,nodeId=fleet!.config.anchors.find(a=>a.baseId===base.id)!.nodeId;
        const occupied=rows.filter(r=>r.yardId===y.id||r.inboundYardId===y.id).length;
        const baseOccupied=rows.filter(r=>fleet!.config.yards.some(z=>z.baseId===base.id&&(z.id===r.yardId||z.id===r.inboundYardId))).length;
        return {...y,base,nodeId,stationName:graph.station(base.stationId).name,owned:base.companyId===cfg.governance.companyId,occupied,baseOccupied};
      });
      const trips=s.receipts.map(r=>{
        const closure=s.closures.find(c=>c.tripId===r.tripId)??null;
        const revenue=s.revenue.records.find(t=>t.terms.tripId===r.tripId)?.closed?.totals??null;
        const energy=energyView.reservations.find(t=>t.id===r.tripId)??null;
        const postings=closure?accounting.journal.filter(j=>j.commandId===closure.accountingCommandId).flatMap(j=>j.postings):[];
        return {receipt:r,closure,revenue,energy,postings};
      });
      return freeze({companyId:cfg.governance.companyId,simTimeS:current.simTimeS,stateRevision:s.revision,maxBulk:cfg.maxBulk,maxQuotes:cfg.maxQuotes,rows,templates,yards,trips,models:catalog.snapshot().entries,catalogIdentity:{catalogId:catalog.snapshot().id,catalogRevision:catalog.snapshot().revision,catalogSha256:catalog.sha256},quotes:[...issued.values()],governance,liquidity:accounting.liquidityView,inventory:energyView.inventory});
    });}
    async function advance(target:unknown,budget:unknown,expectedChecksum:unknown){
      const t=integer(target),n=limit(budget),expected=sha256(expectedChecksum);
      return serial(async()=>{
        cas(expected);
        if(!life){const out=await scheduler.advance(current,t,n);const s=await verify(out.snapshot);current=s;return freeze({...out,snapshot:s});}
        if(t<current.simTimeS)fail('clock rollback');
        let s=current;const processed:string[]=[];
        while(processed.length<n){
          const head=s.pendingEvents[0];
          if(!head||head.simTimeS>t){const out=await scheduler.advance(s,t,1);s=out.snapshot;break;}
          const out=await scheduler.advance(s,head.simTimeS,1);processed.push(...out.processed);s=await syncBoundary(out.snapshot);
        }
        const next=s.pendingEvents[0],complete=!next||next.simTimeS>t;
        if(complete&&s.simTimeS<t){const out=await scheduler.advance(s,t,1);s=out.snapshot;}
        s=await verify(s);current=s;return freeze({snapshot:s,processed,complete,nextDueSimS:next?.simTimeS??null});
      });
    }
    return Object.freeze({snapshot:()=>current,arrivedTripIds:()=>freeze(current.state.movement.trips.filter(t=>!current.state.closures.some(c=>c.tripId===t.tripId)&&t.phaseIndex===movement.plans.find(p=>p.id===t.planId)?.phases.length).map(t=>t.tripId).sort(cmp)),issuedQuotes:()=>freeze([...issued.values()]),quoteTrip,dispatch,bulkDispatch,advance,fleetCommand:fleetCommandRun,inspectFleet,inspectManagement,inspectFinance,finance,settle:(q:unknown,c:unknown)=>terminal(q,c,'settled'),cancel:(q:unknown,c:unknown)=>terminal(q,c,'cancelled')});
  }
  async function initialize(start:unknown,seed:unknown,input:unknown){
    const b=opening(input);
    const a=await inspectAccountingBook(b.accounting,src(b));
    if(a.liquidityView.simTimeS!==integer(start))fail('opening accounting clock mismatch');
    const s=await scheduler.initialize(start,seed,{...b,schemaVersion:1,revision:0,movement:{schemaVersion:1,trips:[]},receipts:[],closures:[],fleetHistory:[]});
    return controller(await verify(await syncBoundary(s)));
  }
  async function open(input:unknown){return controller(await verify(input));}
  // R39 calls this ONLY after verifying the authenticated local save envelope.
  // The caller must never pass untrusted imported quote digests as authority.
  async function openPersisted(input:unknown,quotes:unknown){
    const s=await verify(input),offers=distinct(list(persistedOffer,0,cfg.maxQuotes),o=>id(o.quote.quote.id))(quotes);
    for(const o of offers){
      const p=plan(o.templateId),q=o.quote.quote;
      if(o.quote.issuedAtSimS>s.simTimeS||q.stateVersion>s.state.revision)fail('future persisted quote');
      await validateTripQuote(graph,p.request,o.quote,{quoteSha256:o.quoteSha256,trainId:q.trainId,stateVersion:q.stateVersion,simTimeS:o.quote.issuedAtSimS,configurationSha256});
      const used=s.state.receipts.find(r=>r.quoteId===q.id);
      if(used){
        if(used.templateId!==o.templateId||used.quoteSha256!==o.quoteSha256||used.allocationSha256!==o.allocationSha256)fail('persisted consumed quote mismatch');
      }else if(q.stateVersion===s.state.revision){
        const regenerated=await makeOffer(s.state,o.quote.issuedAtSimS,{quoteId:q.id,trainId:q.trainId,templateId:o.templateId});
        if(!same(o,regenerated))fail('persisted live quote differs from trusted terms');
      }
    }
    return controller(s,offers);
  }
  const workerRecipe=freeze(structuredClone({graph:graph.snapshot(),catalog:catalog.snapshot(),reviewedEvidence:catalog.reviewedEvidence(),movement:movement.workerRecipe,config:{...cfg,...(eventWindows===null?{}:{progressionEvents:eventWindows})},lifecycle:life,fleet:fleet?.config??null}));
  return Object.freeze({workerRecipe,configurationSha256,companyId:cfg.governance.companyId,supportsLifecycle:life!==null,initialize,open,openPersisted,verify,events,decodeState,reduce});
}
