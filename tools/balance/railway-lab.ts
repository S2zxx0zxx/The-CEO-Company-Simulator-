import {fixture} from '../../tests/fixtures/railway-r39';
import {inspectAccountingBook,type AccountingSources} from '../../src/rail/economy/accounting';
import {evaluateSolvency,applyRecoveryCommand} from '../../src/rail/economy/governance';
import {inspectEnergyBook} from '../../src/rail/economy/energy';
import {inspectEnergyMarket} from '../../src/rail/economy/market';
import {inspectOperatingBook} from '../../src/rail/economy/operations';
import {inspectIncentiveBook} from '../../src/rail/economy/incentives';
import {anchorClock,observeClock} from '../../src/rail/offline';
import {runCatchupBatch,pending} from '../../src/rail/offline/batch';
import {digest} from '../../src/rail/routing';
import type {DispatchSnapshot} from '../../src/rail/dispatch';

export const DAY=86400;
const PERIOD=30*DAY;
export const CASES=['new-player','mixed-service-fleet','expansion-eligibility','rural-low-demand','city-high-demand','energy-shock','cancellation','maintenance-disruption','bankruptcy','idle-offline'] as const;
type Case=typeof CASES[number];
export const PROFILE=Object.freeze({id:'r41-fictional-research-v1',approval:'NOT_APPROVED',currency:'INR-minor-fictional',horizonsDays:[30,90] as const,minimumSeedsPerHorizon:100,reviewPeriodS:PERIOD,scenarioCoverage:CASES,fixtureLimits:'Finite initial OD, stock and 3 same-model trains; no invented refresh, new assets or production prices'});
const fail=(s:string):never=>{throw Error('R41: '+s);};
function ensure(v:unknown,m:string):asserts v {if(!v)fail(m);}
const unique=(a:readonly string[])=>new Set(a).size===a.length;
const sum=(a:readonly string[])=>a.reduce((n,x)=>n+BigInt(x),0n);
type F=Awaited<ReturnType<typeof fixture>>;
const sources=(f:F,s:DispatchSnapshot):AccountingSources=>({catalog:f.catalog,demand:s.state.demand,revenue:s.state.revenue,energy:s.state.energy,operations:s.state.operations,incentives:s.state.incentives});

/** Independently recompute cross-book identities in addition to the production
 * decoders. Throw on any invariant failure; do not silently drop failed runs. */
export async function auditSnapshot(f:F,s:DispatchSnapshot){
 await f.runtime.verify(s);
 const c=sources(f,s),b=s.state,a=await inspectAccountingBook(b.accounting,c),e=inspectEnergyBook(b.energy),o=inspectOperatingBook(f.catalog,b.operations),i=inspectIncentiveBook(b.incentives,b.demand,b.revenue),g=await evaluateSolvency(b.accounting,c,f.config.governance);
 ensure(unique(a.journal.map(j=>j.eventId))&&unique(a.journal.map(j=>j.commandId)),'duplicate journal identity');
 for(const j of a.journal)ensure(sum(j.postings.map(p=>p.debitMinor))===sum(j.postings.map(p=>p.creditMinor)),'unbalanced posting');
 const cash=BigInt(a.liquidityView.cashMinor),reserve=BigInt(a.liquidityView.reservedCashMinor),free=BigInt(a.liquidityView.availableCashMinor);
 ensure(cash>=0n&&reserve>=0n&&free>=0n&&cash===reserve+free,'cash reservation reconciliation');
 ensure(BigInt(b.accounting.openingCashMinor)+sum(a.cashFlow.map(x=>x.netMinor))===cash,'cash conservation');
 ensure(BigInt(b.accounting.openingCashMinor)+BigInt(a.accountingProfitMinor)===BigInt(a.equityMinor),'equity conservation');
 ensure(a.pending.trips.length===0&&a.pending.energyLots.length===0&&a.pending.energyReservations.length===0&&!a.pending.operations&&!a.pending.incentives&&!a.pending.assets,'unposted sources');
 for(const x of e.inventory)ensure(BigInt(x.onHand)>=0n&&BigInt(x.reserved)>=0n&&BigInt(x.available)>=0n&&BigInt(x.onHand)===BigInt(x.reserved)+BigInt(x.available)&&BigInt(x.onHand)<=BigInt(x.capacity),'energy conservation');
 for(const {bucket:x} of b.demand.buckets)ensure(x.available>=0&&x.reserved>=0&&x.served>=0&&BigInt(x.total)===BigInt(x.available)+BigInt(x.reserved)+BigInt(x.served),'shared OD conservation');
 for(const x of o.trains)ensure(x.conditionBps>=0&&x.conditionBps<=10000&&x.odometerM>=0,'train condition');
 for(const x of i.programs)ensure(BigInt(x.remainingMinor)>=0n&&BigInt(x.remainingMinor)<=BigInt(x.budgetMinor),'subsidy cap');
 ensure(unique(b.receipts.map(x=>x.tripId))&&unique(b.closures.map(x=>x.tripId)),'duplicate trip or settlement');
 for(const x of b.closures){
  const r=b.receipts.find(y=>y.tripId===x.tripId),d=b.demand.trips.find(y=>y.tripId===x.tripId),v=b.revenue.records.find(y=>y.terms.tripId===x.tripId);
  ensure(r&&d&&v?.closed,'orphan terminal receipt');
  ensure(x.outcome==='settled'?x.arrivalSimS!==null&&x.arrivalSimS<=x.atSimS&&d.status==='served':x.arrivalSimS===null&&d.status==='released','terminal evidence');
  ensure(b.accounting.transactions.filter(y=>y.commandId===x.accountingCommandId).length===1,'missing or duplicate terminal accounting');
 }
 return {cashMinor:String(cash),reservedMinor:String(reserve),availableMinor:String(free),revenueMinor:a.revenueMinor,operatingCostsMinor:a.operatingCostsMinor,operatingMarginMinor:a.operatingMarginMinor,profitMinor:a.accountingProfitMinor,equityMinor:a.equityMinor,debtMinor:a.liquidityView.totalPayoffMinor,cashFlow:a.cashFlow,governance:g.stage,completedTrips:g.completedTrips,unlocks:g.unlocks,loans:a.liquidityView.loans,inventory:e.inventory,demand:b.demand.buckets,condition:o.trains,market:b.market?inspectEnergyMarket(b.market).history:null,settled:b.closures.filter(x=>x.outcome==='settled').length,cancelled:b.closures.filter(x=>x.outcome==='cancelled').length,active:b.movement.trips.length,simTimeS:s.simTimeS,accountingAsOfSimS:a.liquidityView.simTimeS,pendingEvents:s.pendingEvents.length,journalEntries:a.journal.length};
}
function scenario(seed:number,kind:Case){
 ensure(Number.isSafeInteger(seed)&&seed>=1&&seed<=4294967295,'seed range');
 ensure(CASES.includes(kind),'unknown scenario');
 // Fixture-only variation: seeded demand and inspection, not real-world data.
 const base={lab:{seed,periodS:PERIOD,demandWindowS:90*DAY+1,maintenanceIntervalS:90*DAY+1,assetLifeS:180*DAY,freight:100,marketShock:kind==='energy-shock',inspectionEvasionBps:1000+seed%4000},passengers:60+seed%41,inspection:kind==='city-high-demand',subsidy:kind==='city-high-demand',market:kind==='energy-shock',governance:{milestones:[{id:'first-trip',metric:'completed-trips',target:1}],unlocks:[{id:'expansion',minCompletedTrips:1,minReliabilityBps:10000,minAvailableCashMinor:'1',minEquityMinor:'1',requiredMilestones:['first-trip'],fleetLimit:4}]},maxReceipts:20,maxQuotes:20};
 switch(kind){
  case 'rural-low-demand':return {...base,passengers:1,lab:{...base.lab,freight:1},rate:'1500',reserve:'2000'};
  case 'maintenance-disruption':return {...base,blocked:true};
  case 'bankruptcy':return {...base,loan:true,loanMaturity:15,interestBps:100,governance:{...base.governance,minOperatingCashMinor:'0'}};
  case 'idle-offline':return {...base,staff:'50'};
  default:return base;
 }
}
export async function runScenario(seed:number,days:30|90,kind:Case,partition:'wide'|'narrow'='wide'){
 ensure(days===30||days===90,'unsupported horizon');
 const input=scenario(seed,kind),f=await fixture(input),c=f.authority;
 const policy={schemaVersion:1 as const,maxWallDeltaMs:90*DAY*1000,simSecondsPerWallSecond:1,maxBacklogSimS:90*DAY,maxBatchSimS:partition==='wide'?90*DAY:15*DAY,maxBatchEvents:partition==='wide'?100:1,maxBatchesPerWake:1,autoSettleArrivals:true};
 let clock=anchorClock(policy,{wallMs:1000,monotonicMs:0,sessionId:'lab'},0);
 const actions:{kind:string;atSimS:number;outcome:string;detail?:unknown;checksum:string}[]=[];
 let audits=0,firstPositiveMarginS:number|null=null,firstPositiveMarginMinor:string|null=null;
 const audit=async()=>{const v=await auditSnapshot(f,c.snapshot());audits++;if(firstPositiveMarginS===null&&BigInt(v.operatingMarginMinor)>0n){firstPositiveMarginS=v.simTimeS;firstPositiveMarginMinor=v.operatingMarginMinor;}return v;};
 const record=async(kind:string,outcome:string,detail?:unknown)=>{actions.push({kind,atSimS:c.snapshot().simTimeS,outcome,detail,checksum:c.snapshot().checksum});await audit();};
 async function rejected(kind:string,run:()=>Promise<unknown>,pattern:RegExp){
  const before=c.snapshot().checksum;let reason:string|null=null;
  try{await run();}catch(e){reason=String(e);}
  ensure(reason!==null&&pattern.test(reason),kind+' unexpected rejection '+reason);
  ensure(c.snapshot().checksum===before,kind+' mutated rejected state');
  await record(kind,'REJECTED_AS_EXPECTED',reason);
 }
 async function advance(to:number){
  clock=observeClock(clock,{wallMs:1000+to*1000,monotonicMs:to*1000,sessionId:'lab'},c.snapshot().simTimeS).clock;
  let batches=0;
  while(pending(c,clock)){
   ensure(++batches<=100,'batch bound exceeded');
   const result=await runCatchupBatch(c,clock,policy);
   await record('catchup','COMMITTED',result);
  }
  ensure(c.snapshot().simTimeS===to,'horizon mismatch');
 }
 const quote=(id:string,trainId:string)=>c.quoteTrip({quoteId:id,trainId,templateId:'service-template'},c.snapshot().checksum);
 const dispatch=(id:string,q:string)=>c.dispatch({commandId:id,quoteId:q},c.snapshot().checksum);
 await audit();
 if(kind==='bankruptcy'){
  await advance(15);
  // R31 recovery is intentionally isolated from the aggregate: it is not yet
  // a durable R35 command. Verify the loan is a liability, not free cash.
  const s=c.snapshot(),ctx=sources(f,s),v=await evaluateSolvency(s.state.accounting,ctx,f.config.governance);
  ensure(v.stage==='GRACE','expected overdue-loan grace');
  const recovery={expectedAccountingRevision:s.state.accounting.revision,expectedSources:v.sourceVersions};
  await rejected('overdue-rescue-guard',()=>applyRecoveryCommand(s.state.accounting,ctx,f.config.governance,{...recovery,id:'lab-rescue',action:{type:'rescue',principalMinor:'100'}}),/overdue debt/);
  const original=await inspectAccountingBook(s.state.accounting,ctx);
  const oldLoan=original.liquidityView.loans.find(x=>x.loan.id==='loan')??fail('missing overdue loan');
  const rec=await applyRecoveryCommand(s.state.accounting,ctx,f.config.governance,{...recovery,id:'lab-refi',action:{type:'refinance',loanId:'loan',replacementPrincipalMinor:'100'}});
  const restored=await inspectAccountingBook(rec.accounting,{...ctx,operations:rec.operations,energy:rec.energy});
  ensure(BigInt(restored.liquidityView.cashMinor)===BigInt(original.liquidityView.cashMinor)-BigInt(oldLoan.payoffMinor)+100n,'refinance cash');
  ensure(restored.liquidityView.loans.find(x=>x.loan.id==='loan')?.status==='repaid'&&restored.liquidityView.loans.find(x=>x.loan.id==='r31:loan:lab-refi')?.loan.remainingMinor==='100'&&restored.liquidityView.totalDebtMinor==='100','refinance debt');
  ensure(rec.governance.stage==='HEALTHY'&&c.snapshot().checksum===s.checksum,'isolated refinance authority');
  await record('isolated-r31-refinance','VERIFIED_NOT_COMMITTED',{cashMinor:restored.liquidityView.cashMinor,debtMinor:restored.liquidityView.totalPayoffMinor});
  await advance(35);
  await rejected('liquidation-dispatch',()=>quote('qblocked','t1'),/liquidation/);
 }else if(kind!=='idle-offline'){
  if(kind==='maintenance-disruption')await rejected('blocked-train',()=>quote('bad','t1'),/unavailable|state/);
  const trainId=kind==='maintenance-disruption'?'t2':'t1',q=await quote('q1',trainId);
  await record('quote','ISSUED',{id:q.quote.quote.id,terms:q.quote.quote});
  const r=await dispatch('d1','q1');await record('dispatch','COMMITTED',r.receipt);
  const before=c.snapshot().checksum,replay=await c.dispatch({commandId:'d1',quoteId:'q1'},'0'.repeat(64));
  ensure(replay.replayed&&c.snapshot().checksum===before,'dispatch replay duplicated state');
  await rejected('early-settlement',()=>c.settle({commandId:'early',tripId:r.receipt.tripId},c.snapshot().checksum),/arrival|arrived/i);
  if(kind==='cancellation'){
   const x=await c.cancel({commandId:'cancel',tripId:r.receipt.tripId},c.snapshot().checksum);await record('cancel','COMMITTED',x.receipt);
   const again=await c.cancel({commandId:'cancel',tripId:r.receipt.tripId},'0'.repeat(64));ensure(again.replayed,'cancel replay');
  }else{
   if(kind==='mixed-service-fleet'){
    const second=await quote('q2','t2');await record('quote','ISSUED',{id:second.quote.quote.id});
    await dispatch('d2','q2');await record('dispatch','COMMITTED');
    await rejected('duplicate-train',()=>quote('bad','t2'),/unavailable|dispatched|state/);
   }
   await advance(110);
   const closed=c.snapshot().state.closures.find(x=>x.tripId===r.receipt.tripId)??fail('missing auto settlement');
   ensure(closed.outcome==='settled','unexpected cancellation');
   const old=c.snapshot().checksum;const rr=await c.settle({commandId:closed.commandId,tripId:closed.tripId},'0'.repeat(64));
   ensure(rr.replayed&&old===c.snapshot().checksum,'settlement replay duplicated state');
   await rejected('duplicate-settlement',()=>c.settle({commandId:'duplicate',tripId:closed.tripId},c.snapshot().checksum),/already closed/);
  }
 }
 await advance(days*DAY);
 const metrics=await audit();
 if(kind==='bankruptcy')ensure(metrics.governance==='LIQUIDATION','expected liquidation');
 if(kind==='idle-offline')ensure(metrics.revenueMinor==='0'&&metrics.operatingCostsMinor!=='0','idle expense evidence');
 if(kind==='cancellation')ensure(metrics.settled===0&&metrics.cancelled===1&&metrics.revenueMinor==='0','cancellation revenue');
 const restored=await f.runtime.openPersisted(c.snapshot(),c.issuedQuotes());ensure(restored.snapshot().checksum===c.snapshot().checksum,'restore mismatch');
 return {profile:PROFILE.id,seed,days,kind,partition,policySha256:await digest(input),datasetSha256:f.g.graphSha256,configurationSha256:f.runtime.configurationSha256,clockPolicy:policy,clock,actions,audits,firstPositiveMarginS,firstPositiveMarginMinor,metrics,checksum:c.snapshot().checksum,productionAccepted:false};
}
type Result=Awaited<ReturnType<typeof runScenario>>;
export function summarize(rows:readonly Result[],days:30|90){
 const data=rows.filter(x=>x.days===days);
 ensure(data.length>0&&unique(data.map(x=>String(x.seed))),'duplicate or absent seeds');
 const quantile=(xs:string[],p:number)=>[...xs].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0)[Math.max(0,Math.ceil(xs.length*p)-1)];
 const moneyStats=(get:(r:Result)=>string)=>{const v=data.map(get);return {p05:quantile(v,.05),median:quantile(v,.5),p95:quantile(v,.95)};};
 return {days,runs:data.length,audits:data.reduce((n,r)=>n+r.audits,0),cashMinor:moneyStats(r=>r.metrics.cashMinor),profitMinor:moneyStats(r=>r.metrics.profitMinor),operatingMarginMinor:moneyStats(r=>r.metrics.operatingMarginMinor),positiveMarginRuns:data.filter(x=>BigInt(x.metrics.operatingMarginMinor)>0n).length,negativeMarginRuns:data.filter(x=>BigInt(x.metrics.operatingMarginMinor)<0n).length,liquidations:data.filter(x=>x.metrics.governance==='LIQUIDATION').length,expansionEligible:data.filter(x=>x.metrics.unlocks.some(u=>u.eligible)).length,coverage:CASES.map(kind=>({kind,count:data.filter(x=>x.kind===kind).length})),invariantFailures:0,productionAccepted:false};
}
