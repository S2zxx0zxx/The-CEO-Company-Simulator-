import {describe,it,expect} from 'vitest';
import {prepareDispatch} from '../src/rail/dispatch';
import {prepareMovement} from '../src/rail/movement';
import {RailGraph} from '../src/rail/graph';
import {RollingStockCatalog,type CatalogField} from '../src/rail/catalog';
import {findRoute,profileHash,policyHash} from '../src/rail/routing';
import {pack,edge,policy,diesel} from './fixtures/railway-synthetic';
import {createDemandBook} from '../src/rail/economy/demand';
import {createRevenueBook} from '../src/rail/economy/revenue';
import {createEnergyBook,applyEnergyEvent,inspectEnergyBook} from '../src/rail/economy/energy';
import {createOperatingBook,applyOperatingEvent} from '../src/rail/economy/operations';
import {createIncentiveBook} from '../src/rail/economy/incentives';
import {createAccountingBook,applyAccountingCommand,inspectAccountingBook,type AccountingSources} from '../src/rail/economy/accounting';
import {createEnergyMarket,applyMarketAction,inspectEnergyMarket,type EnergyMarketBook} from '../src/rail/economy/market';

const fields:CatalogField[]=['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm'];
const prov={sourceUrl:'urn:railway:r34-fixture',sourceId:'fictional',sourceVersion:'1',license:'original-fixture',qualityFlags:['SYNTHETIC_NOT_REAL_DATA']};
const cat=()=>RollingStockCatalog.prepare({schemaVersion:1,id:'fictional-r34',revision:1,currency:'INR',entries:[{name:'Fictional engine',kind:'mixed-train',identity:'fictional',modelRevision:1,model:{id:'engine',traction:'diesel',gaugesMm:[1676],voltagesV:[],frequenciesHz:[],maxSpeedKmh:72,rangeM:10000,capacitySeats:20,cargoCapacityKg:100,purchasePriceMinor:'1000',massKg:1000,provenance:prov},energyPerKm:[{mode:'diesel',unit:'mL',quantityPerKm:'60'}],fieldOrigins:fields.map(field=>({field,classification:'game-balanced',evidenceId:null}))}]});
const finance={creditLimitMinor:'100000',maxInterestBps:1000,interestPeriodS:100,maxTermS:1000};
const opsPolicy={id:'ops',trackRates:[{regionId:'synthetic-r11',trackClass:'main',minorPerKm:'100'}],terminalRates:[],crewRates:[],crew:[],staff:[],payrollOriginSimS:0,payrollPeriodS:100,wearRules:[{modelId:'engine',maintenanceIntervalM:1000000,agePeriodS:1000,ageIncrementBps:0,maxAgeFactorBps:10000,maxLoadFactorBps:10000,maxWornFactorBps:10000}]};
const service={intervalS:1000,repairThresholdBps:3000,restoreToBps:9000,scheduledCostMinor:'100',repairMinorPerBps:'2',scheduledDurationS:20,repairBaseDurationS:10,repairSecondsPerBps:1};
const asset={purchaseMinor:'1000',residualMinor:'100',usefulLifeS:3000};
const gov=(extra:Record<string,unknown>={})=>({id:'gov',companyId:'co',startSimS:0,reviewPeriodS:1000,gracePeriodS:20,minOperatingCashMinor:'0',minPayoffEquityMinor:'0',rescueBudgetMinor:'1000',maxRescues:2,rescueTermS:300,rescueInterestBps:0,liquidationRecoveryBps:5000,milestones:[],unlocks:[],...extra});
const factor={loadFactorBps:10000,gradeFactorBps:10000,idleQuantityPerHour:'0',auxQuantityPerHour:'0',requestedRegenWh:'0',maxRegenBps:0};
const fare={baseMinor:'100',rateMinorPerKm:'0',discountBps:0,capMinor:'1000'};
const claim=(bucketId:string,kind:string)=>({bucketId,boardIndex:0,alightIndex:1,requested:kind==='passenger'?20:10,outsideWeight:1,services:[{serviceId:'svc',weight:9999}],pricing:kind==='passenger'?{kind,classId:'std',policy:fare}:{kind,rateMinorPerTonneKm:'100000',serviceFactorBps:10000}});
const bucket=(id:string,kind:string,total:number)=>({kind,bucket:{id,origin:'s-a',destination:'s-b',intervalStartS:0,intervalEndS:1000,total,available:total,reserved:0,served:0}});
const copy=(v:unknown):any=>JSON.parse(JSON.stringify(v));
type Options={capacity?:number;passengers?:number;energy?:string;cash?:string;reserve?:string;ttl?:number;maxPending?:number;maxBulk?:number;maxQuotes?:number;maxReceipts?:number;blocked?:boolean;serviceJob?:boolean;market?:boolean;governance?:Record<string,unknown>;template?:Record<string,unknown>;loan?:boolean};
async function fixture(o:Options={}){
 const catalog=await cat(),g=new RailGraph(pack({a:[0,0],b:[1,0]},[edge('ab','a','b')]));
 const reference=catalog.reference('engine'),profile=catalog.profile(reference),pol=policy();
 const request={routeId:'route',graphSha256:g.graphSha256,trainProfileSha256:await profileHash(profile),policySha256:await policyHash(pol),profile,policy:pol,stopIds:['s-a','s-b'],objective:'time',initialOperating:diesel,maxLabels:1000,maxWork:10000};
 const route=await findRoute(g,request);if(!route.ok)throw Error(route.reason);
 const roster=['t1','t2','t3'].map(trainId=>({trainId,catalogReference:reference,nodeId:'a'}));
 const movement=await prepareMovement(g,catalog,{schemaVersion:1,resources:[{id:'block',capacity:o.capacity??2}],edges:[{edgeId:'ab',resourceId:'block'}],nodes:[]},[{id:'move',catalogReference:reference,request,route,dynamics:{accelerationS:10,brakingS:10,dwellS:[]}}],roster,{maxTrips:10,maxPending:20});
 const demand=createDemandBook([bucket('p','passenger',o.passengers??100),bucket('f','freight',100)]),revenue=createRevenueBook();
 const cap=[{unit:'mL',quantity:'1000'}],qty=o.energy??'300';
 let market:EnergyMarketBook|null=null,energy=createEnergyBook(cap);
 if(o.market){
  market=createEnergyMarket({startSimS:0,periodS:100,seed:123,maxContractDurationS:100,rules:[{unit:'mL',priceQuantity:'100',minPriceMinor:'200',meanPriceMinor:'200',maxPriceMinor:'200',initialPriceMinor:'200',reversionBps:0,shockAmplitudeMinor:'0',contractDiscountBps:0}]},cap);
  market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'purchase',lotId:'lot',unit:'mL',quantity:qty,contractId:null,availableCashMinor:'10000'}});energy=inspectEnergyMarket(market).energy;
 }else energy=applyEnergyEvent(energy,{expectedRevision:energy.revision,event:{type:'purchase',lotId:'lot',energy:{unit:'mL',quantity:qty},source:{kind:'spot',contractId:null,priceMinor:'200',priceQuantity:'100'},availableCashMinor:'10000'}});
 let operations=createOperatingBook(catalog,'co',opsPolicy,roster.map(r=>({train:{id:r.trainId,companyId:'co',modelId:'engine',state:o.blocked&&r.trainId==='t1'?'BLOCKED':'IDLE',conditionBps:o.serviceJob&&r.trainId==='t1'?3000:10000,baseId:null,routeId:null},catalogReference:reference,acquiredAtSimS:0,ageAtAcquisitionS:0,odometerM:0})));
 for(const r of roster)operations=applyOperatingEvent(catalog,operations,{expectedRevision:operations.revision,event:{type:'configure-maintenance',trainId:r.trainId,atSimS:0,service:o.serviceJob&&r.trainId==='t1'?{...service,restoreToBps:3100}:service,asset}});
 const incentives=createIncentiveBook({seed:123,programs:[],inspectionPolicies:[],marketing:{budgetMinor:'1000',halfSaturationMinor:'100',maxLiftBps:5000}},demand,revenue);
 const context=()=>({catalog,demand,revenue,energy,operations,incentives});
 let accounting=await createAccountingBook(o.cash??'10000',0,finance,context());
 const apply=async(action:unknown)=>{const c=context();accounting=await applyAccountingCommand(accounting,c,{expectedRevision:accounting.revision,expectedSources:{demand:demand.revision,revenue:revenue.revision,energy:energy.revision,operations:operations.revision,incentives:incentives.revision},commandId:'opening-'+accounting.revision,action});};
 for(const r of roster)await apply({type:'acquire-asset',atSimS:0,trainId:r.trainId});
 await apply({type:'buy-energy',atSimS:0,lotId:'lot'});
 if(o.serviceJob){
  operations=applyOperatingEvent(catalog,operations,{expectedRevision:operations.revision,event:{type:'service-start',jobId:'job',trainId:'t1',atSimS:0,availableCashMinor:'1000'}});
  await apply({type:'maintenance',atSimS:0,jobId:'job'});
 }
 if(o.loan)await apply({type:'borrow',atSimS:0,loanId:'loan',principalMinor:'100',maturityS:15,interestBps:0});
 const config={schemaVersion:1,governance:gov(o.governance),templates:[{id:'service-template',movementPlanId:'move',serviceId:'svc',request,route,claims:[claim('p','passenger'),claim('f','freight')],energyFactors:[factor],expectedCostMinor:'300',reserveMinor:o.reserve??'500',quoteTtlS:o.ttl??30,delayRateMinorPerSecond:'2',delayCapMinor:'15',risks:[],...o.template}],maxPending:o.maxPending??20,maxQuotes:o.maxQuotes??20,maxReceipts:o.maxReceipts??20,maxBulk:o.maxBulk??5};
 const runtime=await prepareDispatch(g,catalog,movement,config);
 const opening={demand,revenue,energy,operations,incentives,accounting,market};
 const authority=await runtime.initialize(0,123,opening);
 return {runtime,authority,g,catalog,movement,config,opening};
}
type Authority=Awaited<ReturnType<typeof fixture>>['authority'];
const quote=(a:Authority,quoteId='q1',trainId='t1')=>a.quoteTrip({quoteId,trainId,templateId:'service-template'},a.snapshot().checksum);
const dispatch=(a:Authority,commandId='c1',quoteId='q1')=>a.dispatch({commandId,quoteId},a.snapshot().checksum);
const financial=(a:Authority,catalog:RollingStockCatalog)=>{const s=a.snapshot().state;return inspectAccountingBook(s.accounting,{catalog,demand:s.demand,revenue:s.revenue,energy:s.energy,operations:s.operations,incentives:s.incentives});};
const unchanged=(a:Authority,before:string)=>expect(JSON.stringify(a.snapshot())).toBe(before);

describe('R34 trusted immutable quote and integrated dispatch',()=>{
 it('quote preview is pure, exact R21 allocation and R22/R23 estimate, no mutation',async()=>{
  const {authority:a}=await fixture(),before=JSON.stringify(a.snapshot()),q=await quote(a);
  expect(q.quote.quote).toMatchObject({id:'q1',trainId:'t1',stateVersion:0,expectedRevenueMinor:'3000',expectedCostMinor:'300',reserveMinor:'500',energy:[{unit:'mL',quantity:'60'}],expiresAtSimS:30});
  expect(Object.isFrozen(q.quote.routeSnapshot)).toBe(true);unchanged(a,before);
 });
 it('single atomic dispatch binds all sources, starts real movement, cash reserved not spent',async()=>{
  const {authority:a,catalog}=await fixture();await quote(a);const before=await financial(a,catalog),r=await dispatch(a),s=r.snapshot.state,id=r.receipt.tripId,after=await financial(a,catalog);
  expect(r.replayed).toBe(false);expect(s.movement.trips[0]).toMatchObject({tripId:id,trainId:'t1',phaseIndex:0,departureSimS:0});
  expect(s.demand.trips[0]).toMatchObject({tripId:id,status:'reserved'});expect(s.demand.buckets.find(x=>x.kind==='passenger')?.bucket).toMatchObject({available:80,reserved:20,served:0});
  expect(s.revenue.records[0]).toMatchObject({terms:{tripId:id,promisedDurationS:110,segmentDistancesM:[1000]},closed:null});
  expect(inspectEnergyBook(s.energy).reservations[0]).toMatchObject({id,allocations:[{lotId:'lot',quantity:'60',unit:'mL'}],closed:null});
  expect(after.liquidityView).toMatchObject({cashMinor:before.liquidityView.cashMinor,reservedCashMinor:'500',reservations:[{id,amountMinor:'500',closed:null}]});
  expect(after.revenueMinor).toBe(before.revenueMinor);expect(after.accountingProfitMinor).toBe(before.accountingProfitMinor);expect(r.snapshot.pendingEvents).toHaveLength(1);
 });
 it('quote is immutable and duplicate issue returns the same trusted offer',async()=>{const {authority:a}=await fixture();const q=await quote(a);expect(await quote(a)).toEqual(q);await expect(quote(a,'q1','t2')).rejects.toThrow('quote ID conflict');});
 it('unknown or externally fabricated quote never accepted',async()=>{const {authority:a}=await fixture(),before=JSON.stringify(a.snapshot());await expect(dispatch(a,'c','unknown')).rejects.toThrow('unknown trusted quote');await expect(a.dispatch({commandId:'c',quoteId:'unknown',quote:{}},a.snapshot().checksum)).rejects.toThrow();unchanged(a,before);});
 it('idempotent command retry returns original receipt even with stale CAS',async()=>{const {authority:a}=await fixture();await quote(a);const old=a.snapshot().checksum,r=await dispatch(a),before=JSON.stringify(a.snapshot());const retry=await a.dispatch({commandId:'c1',quoteId:'q1'},old);expect(retry.replayed).toBe(true);expect(retry.receipt).toEqual(r.receipt);unchanged(a,before);});
 it('conflicting command ID and reused quote rejected',async()=>{const {authority:a}=await fixture();await quote(a);await dispatch(a);const before=JSON.stringify(a.snapshot());await expect(dispatch(a,'c1','q2')).rejects.toThrow('command ID conflict');await expect(dispatch(a,'c2','q1')).rejects.toThrow('quote already used');unchanged(a,before);});
 it('stale state version and stale CAS reject without mutation',async()=>{const {authority:a}=await fixture();await quote(a);await quote(a,'q2','t2');const stale=a.snapshot().checksum;await dispatch(a);const before=JSON.stringify(a.snapshot());await expect(a.dispatch({commandId:'c2',quoteId:'q2'},stale)).rejects.toThrow('STALE_SNAPSHOT');await expect(dispatch(a,'c2','q2')).rejects.toThrow('State version mismatch');unchanged(a,before);});
 it('expiry is exclusive; idle advance before expiry retains feasible quote',async()=>{const {authority:a}=await fixture();await quote(a);await a.advance(29,20,a.snapshot().checksum);expect((await dispatch(a)).receipt.atSimS).toBe(29);const {authority:b}=await fixture();await quote(b);await b.advance(30,20,b.snapshot().checksum);await expect(dispatch(b)).rejects.toThrow('expired');});
 it('arrival never credits revenue or releases cash/demand before R35',async()=>{const {authority:a,catalog}=await fixture();await quote(a);await dispatch(a);const r=await a.advance(110,20,a.snapshot().checksum),s=r.snapshot.state;expect(s.movement.trips[0].phaseIndex).toBe(1);expect(s.demand.trips[0].status).toBe('reserved');expect(s.revenue.records[0].closed).toBeNull();expect((await financial(a,catalog)).liquidityView.reservedCashMinor).toBe('500');await expect(quote(a,'q2','t1')).rejects.toThrow('already dispatched');});
 it('replay after restore preserves receipts; uncommitted quote registry must be reissued',async()=>{const {authority:a,runtime}=await fixture();await quote(a);await dispatch(a);await quote(a,'q2','t2');const b=await runtime.open(copy(a.snapshot())),before=JSON.stringify(b.snapshot());expect((await dispatch(b)).replayed).toBe(true);await expect(dispatch(b,'c2','q2')).rejects.toThrow('unknown trusted quote');unchanged(b,before);});
});
describe('R34 rollback and concurrency',()=>{
 it('cash failure rolls back track, demand, revenue and energy candidates',async()=>{const {authority:a}=await fixture({cash:'4000'});await quote(a);const before=JSON.stringify(a.snapshot());await expect(dispatch(a)).rejects.toThrow();unchanged(a,before);expect(a.snapshot().state.movement.trips).toEqual([]);});
 it('energy shortage rolls back all earlier candidates',async()=>{const {authority:a}=await fixture({energy:'50'});await quote(a);const before=JSON.stringify(a.snapshot());await expect(dispatch(a)).rejects.toThrow();unchanged(a,before);});
 it('track conflict rejects second dispatch after fresh quote without consuming other resources',async()=>{const {authority:a}=await fixture({capacity:1});await quote(a);await dispatch(a);await quote(a,'q2','t2');const before=JSON.stringify(a.snapshot());await expect(dispatch(a,'c2','q2')).rejects.toThrow('capacity');unchanged(a,before);});
 it('same train cannot issue or commit second trip',async()=>{const {authority:a}=await fixture();await quote(a);await dispatch(a);await expect(quote(a,'q2','t1')).rejects.toThrow('already dispatched');});
 it('unknown, blocked and service-locked trains rejected before quote',async()=>{const {authority:a}=await fixture();await expect(quote(a,'q','missing')).rejects.toThrow('unknown owned train');const {authority:b}=await fixture({blocked:true});await expect(quote(b)).rejects.toThrow('availability');const {authority:c}=await fixture({serviceJob:true});await expect(quote(c)).rejects.toThrow('maintenance');});
 it('two concurrent commands with same CAS allow one commit',async()=>{const {authority:a}=await fixture();await quote(a);await quote(a,'q2','t2');const c=a.snapshot().checksum,results=await Promise.allSettled([a.dispatch({commandId:'c1',quoteId:'q1'},c),a.dispatch({commandId:'c2',quoteId:'q2'},c)]);expect(results.map(x=>x.status)).toEqual(['fulfilled','rejected']);expect(a.snapshot().state.receipts).toHaveLength(1);});
 it('concurrent identical retries reserve only once',async()=>{const {authority:a}=await fixture();await quote(a);const c=a.snapshot().checksum,r=await Promise.all([a.dispatch({commandId:'c1',quoteId:'q1'},c),a.dispatch({commandId:'c1',quoteId:'q1'},c)]);expect(r.map(x=>x.replayed)).toEqual([false,true]);expect(a.snapshot().state.receipts).toHaveLength(1);});
 it('bulk sorts by train ID and commits eligible separate transactions',async()=>{const {authority:a}=await fixture();await quote(a,'q2','t2');await quote(a,'q1','t1');const r=await a.bulkDispatch([{commandId:'c2',quoteId:'q2'},{commandId:'c1',quoteId:'q1'}],a.snapshot().checksum);expect(r.results.map(x=>[x.commandId,x.ok])).toEqual([['c1',true],['c2',true]]);expect(r.snapshot.state.receipts).toHaveLength(2);expect(r.snapshot.state.movement.trips.map(x=>x.lanes[0]).sort()).toEqual([0,1]);});
 it('shared OD contention cannot silently change quoted allocation in bulk',async()=>{const {authority:a}=await fixture({passengers:25});await quote(a,'q2','t2');await quote(a);const r=await a.bulkDispatch([{commandId:'c2',quoteId:'q2'},{commandId:'c1',quoteId:'q1'}],a.snapshot().checksum);expect(r.results.map(x=>[x.commandId,x.ok])).toEqual([['c1',true],['c2',false]]);expect(r.snapshot.state.demand.buckets.find(x=>x.kind==='passenger')?.bucket.reserved).toBe(20);expect(r.snapshot.state.receipts).toHaveLength(1);});
 it('bulk partial capacity failure preserves successful train only',async()=>{const {authority:a}=await fixture({capacity:1});await quote(a);await quote(a,'q2','t2');const r=await a.bulkDispatch([{commandId:'c2',quoteId:'q2'},{commandId:'c1',quoteId:'q1'}],a.snapshot().checksum);expect(r.results.map(x=>[x.commandId,x.ok])).toEqual([['c1',true],['c2',false]]);expect(r.snapshot.state.receipts).toHaveLength(1);});
 it('bulk cap explicit and duplicate command rejected before any transaction',async()=>{const {authority:a}=await fixture({maxBulk:1});await quote(a);const before=JSON.stringify(a.snapshot());await expect(a.bulkDispatch([{commandId:'a',quoteId:'q1'},{commandId:'b',quoteId:'q1'}],a.snapshot().checksum)).rejects.toThrow();unchanged(a,before);const {authority:b}=await fixture();await quote(b);await expect(b.bulkDispatch([{commandId:'a',quoteId:'q1'},{commandId:'a',quoteId:'q1'}],b.snapshot().checksum)).rejects.toThrow();});
 it('receipt and quote caps are explicit and do not prune history',async()=>{const {authority:a}=await fixture({maxReceipts:1,maxQuotes:2});await quote(a);await dispatch(a);await quote(a,'q2','t2');const before=JSON.stringify(a.snapshot());await expect(dispatch(a,'c2','q2')).rejects.toThrow('receipt limit');await expect(quote(a,'q3','t3')).rejects.toThrow('registry limit');unchanged(a,before);});
 it('event queue cap failure atomic',async()=>{const {authority:a}=await fixture({maxPending:1});await quote(a);await dispatch(a);await quote(a,'q2','t2');const before=JSON.stringify(a.snapshot());await expect(dispatch(a,'c2','q2')).rejects.toThrow();unchanged(a,before);});
});
describe('R34 aggregate authority, versioned policy and recovery',()=>{
 it('R24 market projection preserved when reserving existing locked lots',async()=>{const {authority:a}=await fixture({market:true});await quote(a);await a.advance(5,20,a.snapshot().checksum);await dispatch(a);const s=a.snapshot().state;expect(inspectEnergyMarket(s.market).energy).toEqual(s.energy);expect(inspectEnergyMarket(s.market).simTimeS).toBe(5);});
 it('loan maturity and periodic governance boundary cannot be crossed before R35',async()=>{const {authority:a}=await fixture({loan:true});const before=JSON.stringify(a.snapshot());await expect(a.advance(15,20,a.snapshot().checksum)).rejects.toThrow('mandatory boundary');unchanged(a,before);const {authority:b}=await fixture({governance:{reviewPeriodS:10}});await expect(b.advance(10,20,b.snapshot().checksum)).rejects.toThrow('mandatory boundary');});
 it('company grace deadline blocks clock bypass and no artificial rescue',async()=>{const {authority:a}=await fixture({governance:{minOperatingCashMinor:'6900',gracePeriodS:5}});await expect(a.advance(5,20,a.snapshot().checksum)).rejects.toThrow('mandatory boundary');});
 it('wrong route or energy policy rejected while preparing trusted template',async()=>{await expect(fixture({template:{energyFactors:[]}})).rejects.toThrow();await expect(fixture({template:{reserveMinor:'1'}})).rejects.toThrow('reserve');await expect(fixture({template:{movementPlanId:'missing'}})).rejects.toThrow('unknown movement plan');});
 it('configuration change invalidates old snapshots',async()=>{const a=await fixture(),b=await fixture({reserve:'600'});expect(a.runtime.configurationSha256).not.toBe(b.runtime.configurationSha256);await expect(b.runtime.open(a.authority.snapshot())).rejects.toThrow();});
 it('missing receipt, missing pending phase and edited balance reject restoration',async()=>{const {authority:a,runtime}=await fixture();await quote(a);await dispatch(a);const s=a.snapshot();await expect(runtime.open({...s,pendingEvents:[]})).rejects.toThrow();const t=copy(s);t.state.receipts=[];await expect(runtime.open(t)).rejects.toThrow();const u=copy(s);u.state.accounting.openingCashMinor='999999';await expect(runtime.open(u)).rejects.toThrow();});
 it('same commands and clock produce identical aggregate replay hashes',async()=>{const x=await fixture(),y=await fixture();for(const a of [x.authority,y.authority]){await quote(a);await dispatch(a);}await x.authority.advance(200,20,x.authority.snapshot().checksum);await y.authority.advance(50,20,y.authority.snapshot().checksum);await y.authority.advance(200,20,y.authority.snapshot().checksum);expect(x.authority.snapshot()).toEqual(y.authority.snapshot());});
});
