import {describe,it,expect} from 'vitest';
import {createAccountingBook,applyAccountingCommand,inspectAccountingBook,type AccountingBook,type AccountingSources} from '../src/rail/economy/accounting';
import {createDemandBook,reserveDemand,closeDemand,type DemandBook} from '../src/rail/economy/demand';
import {createRevenueBook,issueRevenueTerms,settleRevenue,type RevenueBook} from '../src/rail/economy/revenue';
import {createEnergyBook,applyEnergyEvent,type EnergyBook} from '../src/rail/economy/energy';
import {createOperatingBook,applyOperatingEvent,type OperatingBook} from '../src/rail/economy/operations';
import {createIncentiveBook,applyIncentiveEvent,type IncentiveBook} from '../src/rail/economy/incentives';
import {RollingStockCatalog,type CatalogField} from '../src/rail/catalog';
type Context=AccountingSources&{demand:DemandBook;revenue:RevenueBook;energy:EnergyBook;operations:OperatingBook;incentives:IncentiveBook};
const fields:CatalogField[]=['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm'];
const catalog=()=>RollingStockCatalog.prepare({schemaVersion:1,id:'r29-synthetic',revision:1,currency:'INR',entries:[{name:'Fictional engine',kind:'mixed-train',identity:'fictional',modelRevision:1,model:{id:'engine',traction:'diesel',gaugesMm:[1676],voltagesV:[],frequenciesHz:[],maxSpeedKmh:72,rangeM:100000,massKg:1000,capacitySeats:20,cargoCapacityKg:100,purchasePriceMinor:'1000',provenance:{sourceUrl:'urn:railway:r29-fixture',sourceId:'fictional',sourceVersion:'1',license:'original-fixture',qualityFlags:['SYNTHETIC_NOT_REAL_DATA']}},energyPerKm:[],fieldOrigins:fields.map(field=>({field,classification:'game-balanced',evidenceId:null}))}]});
const policy={creditLimitMinor:'100000',maxInterestBps:1000,interestPeriodS:100,maxTermS:1000};
const bucket=(id:string,kind:string)=>({kind,bucket:{id,origin:'a',destination:'b',intervalStartS:0,intervalEndS:1000,total:100,available:100,reserved:0,served:0}});
const claim=(bucketId:string,requested:number)=>({bucketId,boardIndex:0,alightIndex:1,requested,outsideWeight:1,services:[{serviceId:'svc',weight:9999}]});
const opsPolicy={id:'op',trackRates:[{regionId:'r',trackClass:'main',minorPerKm:'100'}],terminalRates:[{stationId:'a',activity:'departure',chargeMinor:'10'},{stationId:'b',activity:'arrival',chargeMinor:'20'}],crewRates:[{roleId:'driver',minorPerHour:'3600'}],crew:[{employeeId:'e1',roleId:'driver'}],staff:[{employeeId:'s1',minorPerPeriod:'50'}],payrollOriginSimS:0,payrollPeriodS:100,wearRules:[{modelId:'engine',maintenanceIntervalM:1000000,agePeriodS:1000,ageIncrementBps:0,maxAgeFactorBps:10000,maxLoadFactorBps:10000,maxWornFactorBps:10000}]};
const service={intervalS:100,repairThresholdBps:3000,restoreToBps:9000,scheduledCostMinor:'100',repairMinorPerBps:'2',scheduledDurationS:20,repairBaseDurationS:10,repairSecondsPerBps:1};
const asset={purchaseMinor:'1000',residualMinor:'100',usefulLifeS:300};
const cfg=(evade=false)=>({seed:123,programs:[{program:{id:'g1',budgetMinor:'300',remainingMinor:'300',startS:0,endS:1000},serviceId:'svc',stopIds:['a','b'],unit:'passenger',rateMinor:'10'}],inspectionPolicies:[{serviceId:'svc',classId:'std',evasionBps:evade?10000:0,deterrenceBps:0,detectionBps:10000,fineMinor:'50',fineCapMinor:'30'}],marketing:{budgetMinor:'1000',halfSaturationMinor:'100',maxLiftBps:5000}});
const op=(c:Context,event:unknown):Context=>({...c,operations:applyOperatingEvent(c.catalog,c.operations,{expectedRevision:c.operations.revision,event})});
const en=(c:Context,event:unknown):Context=>({...c,energy:applyEnergyEvent(c.energy,{expectedRevision:c.energy.revision,event})});
const inc=(c:Context,event:unknown):Context=>({...c,incentives:applyIncentiveEvent(c.incentives,c.demand,c.revenue,{expectedRevision:c.incentives.revision,expectedDemandRevision:c.demand.revision,expectedRevenueRevision:c.revenue.revision,event})});
const conf={type:'configure-maintenance',trainId:'train',atSimS:0,service,asset};
const purchase={type:'purchase',lotId:'lot',energy:{unit:'mL',quantity:'100'},source:{kind:'spot',contractId:null,priceMinor:'200',priceQuantity:'100'},availableCashMinor:'10000'};
async function initial(evade=false):Promise<Context>{
 const cat=await catalog(),d=createDemandBook([bucket('p','passenger'),bucket('f','freight')]),r=createRevenueBook(),e=createEnergyBook([{unit:'mL',quantity:'1000'}]);
 const o=createOperatingBook(cat,'co',opsPolicy,[{train:{id:'train',companyId:'co',modelId:'engine',state:'IDLE',conditionBps:10000,baseId:null,routeId:null},catalogReference:cat.reference('engine'),acquiredAtSimS:0,ageAtAcquisitionS:0,odometerM:0}]);
 return en(op({catalog:cat,demand:d,revenue:r,energy:e,operations:o,incentives:createIncentiveBook(cfg(evade),d,r)},conf),purchase);
}
const versions=(c:Context)=>({demand:c.demand.revision,revenue:c.revenue.revision,energy:c.energy.revision,operations:c.operations.revision,incentives:c.incentives.revision});
const apply=(b:AccountingBook,c:Context,action:unknown,commandId='cmd'+b.revision,expectedRevision=b.revision,expectedSources=versions(c))=>applyAccountingCommand(b,c,{expectedRevision,expectedSources,commandId,action});
const view=inspectAccountingBook;
const timed=(type:string,atSimS:number,extra:Record<string,unknown>={})=>({type,atSimS,...extra});
const create=(c:Context,cash='10000')=>createAccountingBook(cash,0,policy,c);
const copy=(x:unknown):any=>JSON.parse(JSON.stringify(x));
function dispatch(c:Context,baseMinor='100'):Context{
 const d=reserveDemand(c.demand,{expectedRevision:c.demand.revision,trip:{tripId:'trip',serviceId:'svc',dispatchSimS:10,stopIds:['a','b'],capacitySeats:20,cargoCapacityKg:10,claims:[claim('p',20),claim('f',10)]}});
 const r=issueRevenueTerms(c.revenue,d,{expectedRevision:c.revenue.revision,expectedDemandRevision:d.revision,terms:{tripId:'trip',policySha256:'a'.repeat(64),segmentDistancesM:[1000],promisedDurationS:10,delayRateMinorPerSecond:'2',delayCapMinor:'15',passengers:[{bucketId:'p',classId:'std',quantity:20,policy:{baseMinor,rateMinorPerKm:'0',discountBps:0,capMinor:'1000'}}],cargo:[{bucketId:'f',consignmentId:'cargo',massKg:10,paidDistanceM:1000,rateMinorPerTonneKm:'100000',serviceFactorBps:10000}]}});
 return en({...c,demand:d,revenue:r},{type:'reserve',reservationId:'trip',requirements:[{unit:'mL',quantity:'60'}]});
}
function finish(c:Context,evade=false,released=false):Context{
 const d=closeDemand(c.demand,{expectedRevision:c.demand.revision,tripId:'trip',outcome:released?'released':'served'});
 const r=settleRevenue(c.revenue,d,{expectedRevision:c.revenue.revision,expectedDemandRevision:d.revision,tripId:'trip',evidence:released?{arrivalSimS:null,passengers:[],cargo:[]}:{arrivalSimS:30,passengers:[{bucketId:'p',classId:'std',paid:evade?0:20,unpaid:evade?20:0,refundMinor:evade?'0':'100'}],cargo:[{consignmentId:'cargo',deliveredKg:10,finalDestinationId:'b'}]}});
 const e=en({...c,demand:d,revenue:r},{type:'close',reservationId:'trip',outcome:released?'released':'consumed',actual:released?[]:[{unit:'mL',quantity:'40'}]});
 if(released)return e;
 return op(e,{type:'trip',trip:{tripId:'trip',trainId:'train',departureSimS:10,arrivalSimS:30,settledAtSimS:30,stopIds:['a','b'],distanceM:1000,segments:[{edgeId:'ab',regionId:'r',trackClass:'main',distanceM:1000}],terminals:[{stopIndex:0,activity:'departure'},{stopIndex:1,activity:'arrival'}],shifts:[{shiftId:'s',employeeId:'e1',startSimS:10,endSimS:20}],loadFactorBps:10000}});
}
const acquired=async(evade=false,cash='10000')=>{
 const c=await initial(evade);let b=await create(c,cash);
 b=await apply(b,c,timed('acquire-asset',0,{trainId:'train'}));
 b=await apply(b,c,timed('buy-energy',0,{lotId:'lot'}));
 return {c,b};
};
const reserved=async(evade=false)=>{
 const {c,b}=await acquired(evade),d=dispatch(c);
 return {c:d,b:await apply(b,d,timed('reserve-trip',10,{tripId:'trip',amountMinor:'300'}))};
};
const settled=async(evade=false)=>{
 const a=await reserved(evade),c=finish(a.c,evade);
 return {c,b:await apply(a.b,c,timed('settle-trip',30,{tripId:'trip'}))};
};
const bal=(v:Awaited<ReturnType<typeof view>>,accountId:string)=>v.balances.find(x=>x.accountId===accountId)?.debitBalanceMinor;

import {decodeGovernancePolicy,evaluateSolvency,evaluateUnlock,applyRecoveryCommand,applyGovernedAccountingCommand} from '../src/rail/economy/governance';
import {inspectAccountingTimeline} from '../src/rail/economy/accounting';
import {createEnergyMarket,applyMarketAction,inspectEnergyMarket} from '../src/rail/economy/market';
const gp=(x:Record<string,unknown>={})=>({id:'governance-v1',companyId:'co',startSimS:0,reviewPeriodS:100,gracePeriodS:20,minOperatingCashMinor:'0',minPayoffEquityMinor:'0',rescueBudgetMinor:'1000',maxRescues:2,rescueTermS:300,rescueInterestBps:0,liquidationRecoveryBps:5000,milestones:[{id:'first',metric:'completed-trips',target:1},{id:'service',metric:'service-completions',target:1},{id:'grant',metric:'subsidy-claims',target:1}],unlocks:[{id:'expansion',minCompletedTrips:1,minReliabilityBps:0,minAvailableCashMinor:'1000',minEquityMinor:'1000',requiredMilestones:['first'],fleetLimit:2}],...x});
const distress=()=>gp({minOperatingCashMinor:'9000'});
const gov=evaluateSolvency;
const recover=(b:AccountingBook,c:Context,p:unknown,action:unknown,id='recover',rev=b.revision,sourceVersions=versions(c),market?:unknown)=>applyRecoveryCommand(b,c,p,{id,expectedAccountingRevision:rev,expectedSources:sourceVersions,action},market);
const governed=(b:AccountingBook,c:Context,p:unknown,action:unknown,commandId='gov'+b.revision)=>applyGovernedAccountingCommand(b,c,p,{expectedRevision:b.revision,expectedSources:versions(c),commandId,action});
const clock=(atSimS:number)=>timed('advance',atSimS);
const loan=(principalMinor='1000',atSimS=0,maturityS=10,loanId='old',interestBps=0)=>timed('borrow',atSimS,{loanId,principalMinor,maturityS,interestBps});
const repayLoan=(amountMinor:string,atSimS:number,loanId='old')=>timed('repay',atSimS,{loanId,amountMinor});
const rescue=(principalMinor='200')=>({type:'rescue',principalMinor});
const refinance=(replacementPrincipalMinor='1000')=>({type:'refinance',loanId:'old',replacementPrincipalMinor});
const sale={type:'liquidate-train',trainId:'train'},writeoff={type:'liquidate-stock'},restart={type:'restart'};
async function liquidating(){
 const a=await acquired(),p=distress(),b=await apply(a.b,a.c,clock(20));return {...a,b,p};
}
async function overdue(){
 const a=await acquired(),p=gp(),b=await apply(await apply(a.b,a.c,loan()),a.c,clock(10));return {...a,b,p};
}
function context(c:Context,x:Awaited<ReturnType<typeof recover>>):Context{return {...c,operations:x.operations,energy:x.energy};}
describe('R31 E27 verified progression and dynamic unlocks',()=>{
 it('no completed service means no earned milestones or reliability',async()=>{const {c,b}=await acquired(),x=await gov(b,c,gp());expect(x).toMatchObject({stage:'HEALTHY',completedTrips:0,closedTrips:0,reliabilityBps:null,activeFleet:1});expect(x.missions.every(m=>!m.completed)).toBe(true);expect(x.unlocks[0]).toMatchObject({eligible:false,missing:['COMPLETED_TRIPS','MILESTONES'],canExpand:false});});
 it('actual settled trip earns milestone once, no cash reward or new ledger event',async()=>{const {c,b}=await settled(),before=JSON.stringify(b),x=await gov(b,c,gp());expect(x).toMatchObject({completedTrips:1,onTimeTrips:0,closedTrips:1,reliabilityBps:0});expect(x.missions.find(m=>m.id==='first')).toMatchObject({progress:1,target:1,completed:true});expect(x.unlocks[0]).toMatchObject({eligible:true,canExpand:true,remainingFleetCapacity:1});expect(await gov(b,c,gp())).toEqual(x);expect(JSON.stringify(b)).toBe(before);});
 it('late service does not meet positive reliability threshold',async()=>{const {c,b}=await settled(),p=gp(),u={...p.unlocks[0],minReliabilityBps:1};expect(await evaluateUnlock(b,c,gp({unlocks:[u]}),'expansion')).toMatchObject({eligible:false,missing:['RELIABILITY']});});
 it('cancelled trip counts in denominator, not completion or reward',async()=>{const a=await reserved(),c=finish(a.c,false,true),b=await apply(a.b,c,timed('settle-trip',30,{tripId:'trip'})),x=await gov(b,c,gp());expect(x).toMatchObject({completedTrips:0,onTimeTrips:0,closedTrips:1,reliabilityBps:0});expect(x.missions.find(m=>m.id==='first')?.completed).toBe(false);});
 it('fleet capacity, available cash and equity thresholds independent',async()=>{const {c,b}=await settled(),p=gp(),u=p.unlocks[0];expect(await evaluateUnlock(b,c,gp({unlocks:[{...u,fleetLimit:1}]}),'expansion')).toMatchObject({eligible:true,canExpand:false,remainingFleetCapacity:0});expect(await evaluateUnlock(b,c,gp({unlocks:[{...u,minAvailableCashMinor:'999999',minEquityMinor:'999999'}]}),'expansion')).toMatchObject({eligible:false,missing:['LIQUIDITY','EQUITY']});});
 it('cash reserved is unavailable to satisfy an unlock',async()=>{const {c,b}=await reserved(),p=gp({unlocks:[{id:'u',minCompletedTrips:0,minReliabilityBps:0,minAvailableCashMinor:'8600',minEquityMinor:'0',requiredMilestones:[],fleetLimit:2}]});expect(await evaluateUnlock(b,c,p,'u')).toMatchObject({eligible:false,missing:['LIQUIDITY']});});
 it('completed R26 service and posted R27 grant drive milestones',async()=>{const a=await settled(),d=inc(a.c,{type:'subsidy',tripId:'trip',programId:'g1',atSimS:30});let b=await apply(a.b,d,timed('subsidy',30,{tripId:'trip'}));let c=op(d,{type:'service-start',jobId:'job',trainId:'train',atSimS:100,availableCashMinor:'10000'});b=await apply(b,c,timed('maintenance',100,{jobId:'job'}));c=op(c,{type:'service-complete',jobId:'job',trainId:'train',atSimS:120});b=await apply(b,c,clock(120));const x=await gov(b,c,gp());expect(x.missions.every(m=>m.completed)).toBe(true);});
 it('unposted reward or mismatched active trip state blocks progression',async()=>{const a=await settled(),c=inc(a.c,{type:'subsidy',tripId:'trip',programId:'g1',atSimS:30});await expect(gov(a.b,c,gp())).rejects.toThrow('unrecognized');const d=await acquired(),e=dispatch(d.c);await expect(gov(d.b,e,gp())).rejects.toThrow('active reservations');});
 it('unknown milestones, duplicate IDs, invalid rates and durations reject',()=>{for(const p of [gp({gracePeriodS:0}),gp({reviewPeriodS:0}),gp({liquidationRecoveryBps:10001}),gp({milestones:[{id:'x',metric:'completed-trips',target:0}]}),gp({milestones:[]}),gp({unlocks:[gp().unlocks[0],gp().unlocks[0]]})])expect(()=>decodeGovernancePolicy(p)).toThrow();});
 it('unknown company, start time and unlock ID rejected',async()=>{const {c,b}=await acquired();await expect(gov(b,c,gp({companyId:'other'}))).rejects.toThrow('identity');await expect(gov(b,c,gp({startSimS:1}))).rejects.toThrow('start');await expect(evaluateUnlock(b,c,gp(),'missing')).rejects.toThrow('unknown unlock');});
});
describe('R31 E28 grace, review boundaries and financed rescue',()=>{
 it('low liquidity starts grace from actual transaction at zero',async()=>{const {c,b}=await acquired(),x=await gov(b,c,distress());expect(x).toMatchObject({stage:'GRACE',since:0,deadline:20,nextActionDueSimS:20,currentReasons:['LOW_LIQUIDITY']});expect(x.unlocks[0].missing).toContain('SOLVENCY');});
 it('exact deadline irreversible, even with later balance improvement',async()=>{const a=await liquidating(),x=await gov(a.b,a.c,a.p);expect(x).toMatchObject({stage:'LIQUIDATION',liquidatedAt:20,liquidationComplete:false});const r=await recover(a.b,a.c,a.p,sale);expect(r.governance.stage).toBe('LIQUIDATION');expect(r.governance.currentReasons).not.toContain('LOW_LIQUIDITY');});
 it('review boundary cannot be silently skipped',async()=>{const {c,b}=await acquired(),p=gp({reviewPeriodS:10});await expect(gov(await apply(b,c,clock(11)),c,p)).rejects.toThrow('missing periodic');const a=await apply(b,c,clock(10));expect(await gov(a,c,p)).toMatchObject({nextReviewSimS:20});const d=await apply(a,c,clock(20));expect(await gov(d,c,p)).toMatchObject({nextReviewSimS:30});});
 it('pre-action snapshot detects overdue before same-time repayment',async()=>{const {c,b}=await acquired(),a=await apply(b,c,loan()),d=await apply(a,c,repayLoan('1000',10)),x=await gov(d,c,gp());expect(x.stage).toBe('HEALTHY');expect(x.history.map(h=>h.state)).toEqual(['GRACE','HEALTHY']);expect(x.history[0].atSimS).toBe(10);});
 it('rescue actually posts loan principal and liability, not income',async()=>{const {c,b}=await acquired(),r=await recover(b,c,distress(),rescue()),v=await view(r.accounting,c);expect(r.governance).toMatchObject({stage:'HEALTHY',rescueUsedMinor:'200',rescueRemainingMinor:'800',rescueCount:1});expect(v.liquidityView).toMatchObject({cashMinor:'9000',principalOutstandingMinor:'200'});expect(v.equityMinor).toBe('10000');expect(v.accountingProfitMinor).toBe('0');expect((await gov(b,c,distress())).stage).toBe('GRACE');});
 it('rescue cumulative budget and count cannot be bypassed by ID changes',async()=>{const {c,b}=await acquired(),p=gp({minOperatingCashMinor:'9000',rescueBudgetMinor:'150',maxRescues:1}),a=await recover(b,c,p,rescue('100'),'one');expect(a.governance.stage).toBe('GRACE');await expect(recover(a.accounting,c,p,rescue('50'),'two')).rejects.toThrow('exhausted');});
 it('no ordinary borrow in grace, no rescue after liquidation or while healthy',async()=>{const {c,b}=await acquired();await expect(governed(b,c,distress(),loan())).rejects.toThrow('prohibited during grace');await expect(recover(b,c,gp(),rescue())).rejects.toThrow('requires grace');const a=await liquidating();await expect(recover(a.b,a.c,a.p,rescue())).rejects.toThrow('requires grace');});
 it('rescue respects R28 credit limit and rejects forged terms and recovery tags',async()=>{const {c,b}=await acquired();await expect(recover(b,c,gp({minOperatingCashMinor:'9000',rescueBudgetMinor:'200000'}),rescue('100001'))).rejects.toThrow('credit limit');const bound=await governed(b,c,distress(),clock(0));const a=await apply(bound.accounting,c,loan('200',0,300,'forged'),'r31:rescue:bad');await expect(gov(a,c,distress())).rejects.toThrow('terms not authorized');await expect(governed(b,c,distress(),clock(0),'r31:restart:bad')).rejects.toThrow('reserved recovery');});
 it('overdue loan refinancing pays actual debt and replaces it with extended maturity',async()=>{const a=await overdue(),r=await recover(a.b,a.c,a.p,refinance()),v=await view(r.accounting,a.c);expect(r.governance).toMatchObject({stage:'HEALTHY',rescueCount:1,rescueUsedMinor:'1000'});expect(v.liquidityView.loans.find(x=>x.loan.id==='old')?.status).toBe('repaid');expect(v.liquidityView.loans.find(x=>x.loan.id==='r31:loan:recover')).toMatchObject({loan:{remainingMinor:'1000',maturityS:310}});expect(v.liquidityView.cashMinor).toBe('9800');expect(v.equityMinor).toBe('10000');});
 it('refinance cannot increase principal, shorten term or leave unpaired command',async()=>{const a=await overdue();await expect(recover(a.b,a.c,gp({rescueBudgetMinor:'2000'}),refinance('1001'))).rejects.toThrow('invalid refinance');await expect(recover(a.b,a.c,gp({rescueTermS:1}),refinance('1001'))).rejects.toThrow();const bound=await governed(a.b,a.c,a.p,clock(10));const b=await apply(bound.accounting,a.c,repayLoan('1000',10),'r31:refinance:bad');await expect(gov(b,a.c,a.p)).rejects.toThrow('atomic payoff');});
 it('ordinary rescue cannot bypass overdue debt policy',async()=>{const a=await overdue();await expect(recover(a.b,a.c,a.p,rescue())).rejects.toThrow('overdue debt');});
 it('stale command and source revision fail without mutation',async()=>{const {c,b}=await acquired(),before=JSON.stringify(b);await expect(recover(b,c,distress(),rescue(),'stale',0)).rejects.toThrow('STALE');await expect(recover(b,c,distress(),rescue(),'stale',b.revision,{...versions(c),energy:0})).rejects.toThrow('STALE');expect(JSON.stringify(b)).toBe(before);});
 it('negative payoff-adjusted equity enters grace even with cash',async()=>{const a=await acquired(false,'1200'),b=await apply(a.b,a.c,loan('10000',0,300,'l',1000)),d=await apply(b,a.c,clock(100)),e=await apply(d,a.c,clock(200)),x=await gov(e,a.c,gp());expect(x.stage).toBe('GRACE');expect(x.currentReasons).toContain('LOW_EQUITY');expect(x.payoffAdjustedEquityMinor).toBe('-800');});
 it('timeline captures before and after state from same actual journal',async()=>{const {c,b}=await acquired(),x=await inspectAccountingTimeline(b,c);expect(x.initial.availableCashMinor).toBe('10000');expect(x.timeline.at(-1)?.before.availableCashMinor).toBe('9000');expect(x.timeline.at(-1)?.after.availableCashMinor).toBe('8800');expect(Object.isFrozen(x.timeline)).toBe(true);});
});
describe('R31 controlled liquidation and archive-only restart',()=>{
 it('train sale derives proceeds from depreciated carrying value and policy',async()=>{const a=await liquidating(),r=await recover(a.b,a.c,a.p,sale),c=context(a.c,r),x=await view(r.accounting,c);expect(r.governance.activeFleet).toBe(0);expect(x.liquidityView.cashMinor).toBe('9270');expect(bal(x,'train-assets')).toBe('0');expect(bal(x,'depreciation')).toBe('60');expect(bal(x,'disposal-loss')).toBe('470');expect(r.governance.liquidationComplete).toBe(false);await expect(recover(r.accounting,c,a.p,sale,'repeat')).rejects.toThrow('disposed');});
 it('stock writeoff is noncash with exact lot conservation',async()=>{const a=await liquidating(),r=await recover(a.b,a.c,a.p,writeoff,'stock'),c=context(a.c,r),x=await view(r.accounting,c);expect(r.governance.stockEmpty).toBe(true);expect(bal(x,'energy-inventory')).toBe('0');expect(bal(x,'energy-expense')).toBe('200');expect(x.liquidityView.cashMinor).toBe('8800');expect(x.pending.energyReservations).toEqual([]);await expect(recover(r.accounting,c,a.p,writeoff,'again')).rejects.toThrow('no inventory');});
 it('R24 authoritative market projection is preserved during stock writeoff',async()=>{const a=await liquidating();let m=createEnergyMarket({startSimS:0,periodS:100,seed:123,maxContractDurationS:100,rules:[{unit:'mL',priceQuantity:'100',minPriceMinor:'200',meanPriceMinor:'200',maxPriceMinor:'200',initialPriceMinor:'200',reversionBps:0,shockAmplitudeMinor:'0',contractDiscountBps:0}]},[{unit:'mL',quantity:'1000'}]);m=applyMarketAction(m,{expectedRevision:m.revision,action:{type:'purchase',lotId:'lot',unit:'mL',quantity:'100',contractId:null,availableCashMinor:'10000'}});m=applyMarketAction(m,{expectedRevision:m.revision,action:{type:'advance',targetSimS:20}});const r=await recover(a.b,a.c,a.p,writeoff,'market',a.b.revision,versions(a.c),m);expect(r.market).not.toBeNull();expect(inspectEnergyMarket(r.market).energy).toEqual(r.energy);expect(r.governance.stockEmpty).toBe(true);});
 it('mismatched market or clock rejects stock writeoff',async()=>{const a=await liquidating();const m=createEnergyMarket({startSimS:0,periodS:100,seed:123,maxContractDurationS:100,rules:[{unit:'mL',priceQuantity:'100',minPriceMinor:'200',meanPriceMinor:'200',maxPriceMinor:'200',initialPriceMinor:'200',reversionBps:0,shockAmplitudeMinor:'0',contractDiscountBps:0}]},[{unit:'mL',quantity:'1000'}]);await expect(recover(a.b,a.c,a.p,writeoff,'m',a.b.revision,versions(a.c),m)).rejects.toThrow('market projection or clock');});
 it('active trip and cash reservations block liquidation until reconciled',async()=>{const a=await reserved(),p=distress(),b=await apply(a.b,a.c,clock(20));await expect(recover(b,a.c,p,sale)).rejects.toThrow('active reservations');const c=finish(a.c),d=await governed(b,c,p,timed('settle-trip',30,{tripId:'trip'}));expect(d.governance.stage).toBe('LIQUIDATION');expect(d.governance.activeTripIds).toEqual([]);});
 it('forged proceeds cannot pass controlled sale policy',async()=>{const a=await liquidating(),bound=await governed(a.b,a.c,a.p,clock(20)),c=op(a.c,timed('dispose',20,{trainId:'train',proceedsMinor:'1000000'})),b=await apply(bound.accounting,c,timed('disposal',20,{trainId:'train'}),'r31:train:fake');await expect(gov(b,c,a.p)).rejects.toThrow('outside policy');});
 it('restart requires liquidation and all assets reconciled',async()=>{const a=await liquidating();await expect(recover(a.b,a.c,a.p,restart)).rejects.toThrow('not complete');const r=await recover(a.b,a.c,a.p,sale,'sale'),c=context(a.c,r);await expect(recover(r.accounting,c,a.p,restart)).rejects.toThrow('not complete');});
 it('one terminal restart archives cash and debt without funding new company',async()=>{const a=await liquidating(),r=await recover(a.b,a.c,a.p,sale,'sale'),c=context(a.c,r),s=await recover(r.accounting,c,a.p,writeoff,'stock'),d=context(c,s);expect(s.governance.liquidationComplete).toBe(true);const z=await recover(s.accounting,d,a.p,restart,'archive');expect(z.governance).toMatchObject({stage:'RESTART_AUTHORIZED',nextReviewSimS:null,restart:{archivedCompanyId:'co',authorizationId:'archive',archivedCashMinor:'9270',archivedDebtMinor:'0',newOpeningCashMinor:'0',requiresSeparateScenarioAuthorization:true}});expect((await view(z.accounting,d)).liquidityView.cashMinor).toBe('9270');await expect(recover(z.accounting,d,a.p,restart,'again')).rejects.toThrow('liquidation state');await expect(governed(z.accounting,d,a.p,clock(21))).rejects.toThrow('archived company');});
 it('restart leaves unresolved debt visible when no assets or cash remain',async()=>{const a=await acquired(false,'1200'),p=gp({gracePeriodS:20,liquidationRecoveryBps:0}),b=await apply(a.b,a.c,loan('1000',0,10,'old',1000)),c=await apply(b,a.c,clock(10)),d=await apply(c,a.c,clock(30));const r=await recover(d,a.c,p,sale,'sale'),e=context(a.c,r),s=await recover(r.accounting,e,p,writeoff,'stock'),f=context(e,s);expect(s.governance.liquidationComplete).toBe(false);const z=await governed(s.accounting,f,p,repayLoan('1000',30));expect(z.governance.liquidationComplete).toBe(true);const archived=await recover(z.accounting,f,p,restart,'archive');expect(archived.governance.restart).toMatchObject({archivedCashMinor:'0',archivedDebtMinor:'10',newOpeningCashMinor:'0'});});
 it('governance rejects ordinary expansion and dispatch during liquidation',async()=>{const a=await liquidating();await expect(governed(a.b,a.c,a.p,loan('1',20,300,'new'))).rejects.toThrow('prohibited during liquidation');await expect(governed(a.b,a.c,a.p,timed('buy-energy',20,{lotId:'lot'}))).rejects.toThrow();});
 it('duplicate recovery IDs across types rejected without mutating original',async()=>{const a=await liquidating(),r=await recover(a.b,a.c,a.p,sale,'same'),c=context(a.c,r),before=JSON.stringify(r.accounting);await expect(recover(r.accounting,c,a.p,writeoff,'same')).rejects.toThrow('already used');expect(JSON.stringify(r.accounting)).toBe(before);});
});

describe('R31 immutable policy binding',()=>{
 it('first governed command binds canonical policy and later edits reject',async()=>{const {c,b}=await acquired(),p=gp(),a=await governed(b,c,p,clock(1));expect(a.governance.policyBound).toBe(true);expect(a.governance.policySha256).toMatch(/^[a-f0-9]{64}$/);await expect(gov(a.accounting,c,gp({gracePeriodS:21}))).rejects.toThrow('policy binding mismatch');expect((await gov(a.accounting,c,p)).policySha256).toBe(a.governance.policySha256);});
 it('recovery cannot reset a bound budget or grace clock by editing policy',async()=>{const {c,b}=await acquired(),p=gp({minOperatingCashMinor:'9000',rescueBudgetMinor:'150'}),a=await recover(b,c,p,rescue('100'));await expect(recover(a.accounting,c,gp({minOperatingCashMinor:'9000',rescueBudgetMinor:'10000'}),rescue('100'),'second')).rejects.toThrow('policy binding mismatch');await expect(gov(a.accounting,c,gp({minOperatingCashMinor:'9000',gracePeriodS:1000,rescueBudgetMinor:'150'}))).rejects.toThrow('policy binding mismatch');});
 it('same policy with reordered milestone and unlock input canonicalizes',async()=>{const {c,b}=await acquired(),p=gp(),a=await governed(b,c,p,clock(1));const q=gp();q.milestones.reverse();expect((await gov(a.accounting,c,q)).policySha256).toBe(a.governance.policySha256);});
});

describe('R31 recovery exploit layers',()=>{
 it('raw unbound recovery marker cannot authorize a loan',async()=>{const {c,b}=await acquired(),a=await apply(b,c,loan('200',0,300,'r31:loan:raw'),'r31:rescue:raw');await expect(gov(a,c,distress())).rejects.toThrow('bound governance policy');});
 it('raw unpaired replacement loan rejected even with valid bound policy',async()=>{const {c,b}=await acquired(),a=await governed(b,c,distress(),clock(0)),d=await apply(a.accounting,c,loan('100',0,300,'r31:loan:raw'),'r31:refinance-loan:raw');await expect(gov(d,c,distress())).rejects.toThrow('unpaired');});
 it('cumulative rescue budget exhausted even when count remains',async()=>{const {c,b}=await acquired(),p=gp({minOperatingCashMinor:'9000',rescueBudgetMinor:'150',maxRescues:5}),a=await recover(b,c,p,rescue('100'),'first');await expect(recover(a.accounting,c,p,rescue('51'),'second')).rejects.toThrow('exhausted');});
});

describe('R31 exact refinance closure and time-boundary invariants',()=>{
 it('later same-time payoff cannot validate an earlier partial refinance',async()=>{
   const c=await initial(),p=gp({minOperatingCashMinor:'9900'});let b=await create(c);
   b=await apply(b,c,loan('1000',0,100,'old'));b=await apply(b,c,timed('acquire-asset',0,{trainId:'train'}));b=await apply(b,c,timed('buy-energy',0,{lotId:'lot'}));
   const bound=await governed(b,c,p,clock(0));expect(bound.governance.stage).toBe('GRACE');
   b=await apply(bound.accounting,c,repayLoan('500',0),'r31:refinance:attack');
   b=await apply(b,c,loan('500',0,300,'r31:loan:attack'),'r31:refinance-loan:attack');
   b=await apply(b,c,repayLoan('500',0),'later-payoff');
   expect((await view(b,c)).liquidityView.loans.find(l=>l.loan.id==='old')?.closedAtSimS).toBe(0);
   await expect(gov(b,c,p)).rejects.toThrow('close debt');
 });
 it('explicit grace duration boundary grid remains deterministic',async()=>{
   const {c,b}=await acquired();for(const n of [1,2,10,20,99,100]){
     const p=gp({minOperatingCashMinor:'9000',gracePeriodS:n});
     expect((await gov(await apply(b,c,clock(n-1)),c,p)).stage).toBe('GRACE');
     expect((await gov(await apply(b,c,clock(n)),c,p)).stage).toBe('LIQUIDATION');
   }
 });
});

import {createScheduler} from '../src/rail/scheduler';
import {record} from '../src/domain/validation';
describe('R32 scheduler integration with real R31 governance',()=>{
 it('exclusive grace deadline runs before same-time rescue; failed batch leaves old book intact',async()=>{
  const {c,b}=await acquired(),p=distress();
  const engine=createScheduler<{book:AccountingBook}>({
   policySha256:'a'.repeat(64),graphSha256s:[],maxPending:20,
   decodeState:v=>record(v,'fixture state') as {book:AccountingBook},events:{review:v=>v,rescue:v=>v},
   nextBoundary:async s=>{const v=await gov(s.book,c,p);return v.nextActionDueSimS===null?null:{simTimeS:v.nextActionDueSimS,kind:'review'};},
   reduce:async(s,e)=>({state:{book:e.kind==='review'?(await governed(s.book,c,p,clock(e.simTimeS),e.id)).accounting:(await recover(s.book,c,p,rescue(),e.id)).accounting}})
  });
  const start=await engine.initialize(0,1,{book:b});
  const wrong=await engine.enqueue(start,[{simTimeS:20,kind:'rescue',payload:null},{simTimeS:20,kind:'review',payload:null}]);
  await expect(engine.advance(wrong,20,2)).rejects.toThrow('mandatory boundary');
  const q=await engine.enqueue(start,[{simTimeS:20,kind:'review',payload:null},{simTimeS:20,kind:'rescue',payload:null}]);
  const pre=JSON.stringify(q);
  await expect(engine.advance(q,20,2)).rejects.toThrow();
  expect(JSON.stringify(q)).toBe(pre);
  const first=await engine.advance(q,20,1);
  expect(first.complete).toBe(false);
  expect(await gov(first.snapshot.state.book,c,p)).toMatchObject({stage:'LIQUIDATION',liquidatedAt:20});
  await expect(engine.advance(first.snapshot,20,1)).rejects.toThrow();
 });
 it('actual review boundary cannot be crossed by idle scheduler clock',async()=>{
  const {c,b}=await acquired(),p=gp({reviewPeriodS:10});
  const engine=createScheduler<{book:AccountingBook}>({policySha256:'a'.repeat(64),graphSha256s:[],maxPending:20,decodeState:v=>record(v,'fixture') as {book:AccountingBook},events:{review:v=>v},
   nextBoundary:async s=>{const v=await gov(s.book,c,p);return v.nextActionDueSimS===null?null:{simTimeS:v.nextActionDueSimS,kind:'review'};},
   reduce:async(s,e)=>({state:{book:(await governed(s.book,c,p,clock(e.simTimeS),e.id)).accounting}})});
  const s=await engine.initialize(0,1,{book:b});await expect(engine.advance(s,11,1)).rejects.toThrow('mandatory boundary');
  const q=await engine.enqueue(s,[{simTimeS:10,kind:'review',payload:null}]);
  const x=await engine.advance(q,11,1);expect(await gov(x.snapshot.state.book,c,p)).toMatchObject({nextReviewSimS:20});
 });
});
