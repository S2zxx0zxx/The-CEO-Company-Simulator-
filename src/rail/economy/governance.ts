// R31 E27/E28: pure scenario governance over existing financial authority.
// All thresholds are explicit game-policy inputs. No paid dependency or mint.
import { decodeMission } from '../../domain/models';
import { integer, minor, seconds, basisPoints, MAX_INTEGER } from '../../domain/units';
import { object, list, distinct, id, enumeration, refine, record, type Decoded } from '../../domain/validation';
import { inspectAccountingTimeline, applyAccountingCommand, type AccountingSources, type AccountingBook } from './accounting';
import { valueCompany } from './company';
import { decodeDemandBook } from './demand';
import { decodeRevenueBook } from './revenue';
import { decodeOperatingBook, inspectOperatingBook, applyOperatingEvent, calculateDepreciation } from './operations';
import { decodeEnergyBook, inspectEnergyBook, applyEnergyEvent } from './energy';
import { decodeEnergyMarket, inspectEnergyMarket, applyMarketAction, type EnergyMarketBook } from './market';
import { inspectIncentiveBook } from './incentives';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Governance: '+s);};
const money=(n:bigint)=>minor(String(n));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const min=(a:bigint,b:bigint)=>a<b?a:b;
const positiveS=refine(seconds,x=>x>0,'positive duration required');
const positiveCount=refine(integer,x=>x>0,'positive count required');
const positiveMoney=refine(minor,x=>x!=='0','positive money required');
const shortId=refine(id,x=>x.length<=64&&!x.includes(':'),'short recovery ID required');
function freeze<T>(v:T):ReadonlyTree<T>{if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v as ReadonlyTree<T>;}
const metric=enumeration(['completed-trips','on-time-trips','served-routes','service-completions','subsidy-claims']);
const milestone=object({id,metric,target:positiveCount});
const unlock=object({id,minCompletedTrips:integer,minReliabilityBps:basisPoints,minAvailableCashMinor:minor,minEquityMinor:minor,requiredMilestones:distinct(list(id,0,1000),x=>x),fleetLimit:integer});
const policy=object({id,companyId:id,startSimS:seconds,reviewPeriodS:positiveS,gracePeriodS:positiveS,minOperatingCashMinor:minor,minPayoffEquityMinor:minor,rescueBudgetMinor:minor,maxRescues:integer,rescueTermS:positiveS,rescueInterestBps:basisPoints,liquidationRecoveryBps:basisPoints,milestones:distinct(list(milestone,0,1000),x=>x.id),unlocks:distinct(list(unlock,0,1000),x=>x.id)});
type Policy=Decoded<typeof policy>;
export type GovernancePolicy=ReadonlyTree<Policy>;
export function decodeGovernancePolicy(input:unknown):GovernancePolicy{
  const p=policy(input);p.milestones.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);p.unlocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  for(const u of p.unlocks){u.requiredMilestones.sort();if(u.requiredMilestones.some(id=>!p.milestones.some(m=>m.id===id)))fail('unknown required milestone');}
  return freeze(p);
}
type Timeline=Awaited<ReturnType<typeof inspectAccountingTimeline>>;
type Snapshot=Timeline['initial'];
type Stage='HEALTHY'|'GRACE'|'LIQUIDATION'|'RESTART_AUTHORIZED';
const safeTime=(n:bigint)=>n>BigInt(MAX_INTEGER)?null:Number(n);
const tag=(kind:string,id:string)=>'r31:'+kind+':'+id;
function parseTag(commandId:string){
  if(!commandId.startsWith('r31:'))return null;
  const parts=commandId.split(':');
  if(parts.length!==3)fail('invalid recovery command identity');
  return {kind:parts[1],id:shortId(parts[2])};
}
function reasons(p:GovernancePolicy,x:Snapshot){
  return [BigInt(x.availableCashMinor)<BigInt(p.minOperatingCashMinor)?'LOW_LIQUIDITY':null,BigInt(x.payoffAdjustedEquityMinor)<BigInt(p.minPayoffEquityMinor)?'LOW_EQUITY':null,x.overdueLoans?'OVERDUE_DEBT':null].filter((x):x is string=>x!==null);
}
const graceBlocked=new Set(['acquire-asset','campaign','borrow','write-off-energy','disposal']);
const liquidationAllowed=new Set(['advance','repay','settle-trip','overhead','maintenance','depreciation','subsidy','fine','reclassify','reverse']);
/** Replay the actual journal, not caller-submitted insolvency observations.
 * Require every periodic review boundary to be represented by an accounting
 * timestamp. Evaluate after automatic interest advance and after each action.
 * Grace ends exclusively: a recovery at its deadline cannot undo liquidation.
 * Scheduler R32 must emit due boundaries before subsequent commands. */
function lifecycle(p:GovernancePolicy,x:Timeline,c:AccountingSources,policyHash:string){
  if(x.book.startSimS!==p.startSimS)fail('policy start does not match accounting');
  let stage:Stage='HEALTHY',since:number|null=null,deadline:bigint|null=null,liquidatedAt:number|null=null;
  let boundary=BigInt(p.startSimS)+BigInt(p.reviewPeriodS),used=0n,count=0,restartId:string|null=null,policyBound=false;
  const recoveryIds=new Set<string>(),history:{atSimS:number;state:Stage;reasons:string[]}[]=[];
  function change(next:Stage,at:number,why:string[]){stage=next;history.push({atSimS:at,state:next,reasons:why});}
  function assess(s:Snapshot){
    if(stage==='LIQUIDATION'||stage==='RESTART_AUTHORIZED')return;
    if(deadline!==null&&BigInt(s.atSimS)>=deadline){liquidatedAt=Number(deadline);change('LIQUIDATION',liquidatedAt,reasons(p,s));return;}
    const r=reasons(p,s);
    if(r.length&&stage==='HEALTHY'){since=s.atSimS;deadline=BigInt(s.atSimS)+BigInt(p.gracePeriodS);change('GRACE',s.atSimS,r);}
    else if(!r.length&&stage==='GRACE'){since=null;deadline=null;change('HEALTHY',s.atSimS,r);}
  }
  const state=()=>stage as Stage;
  function consume(id:string,n:bigint){
    if(recoveryIds.has(id))fail('recovery ID already used');
    recoveryIds.add(id);used+=n;count++;
    if(used>BigInt(p.rescueBudgetMinor)||count>p.maxRescues)fail('rescue authorization exhausted');
  }
  function unique(id:string){if(recoveryIds.has(id))fail('recovery ID already used');recoveryIds.add(id);}
  const operations=inspectOperatingBook(c.catalog,c.operations);
  const energy=inspectEnergyBook(c.energy);
  assess(x.initial);
  for(let j=0;j<x.timeline.length;j++){
    const point=x.timeline[j],a=x.book.transactions[j].action,t=parseTag(point.commandId),at=point.before.atSimS;
    if(state()==='RESTART_AUTHORIZED')fail('archived company history cannot advance');
    if(BigInt(at)>boundary)fail('missing periodic solvency review boundary');
    if(BigInt(at)===boundary)boundary+=BigInt(p.reviewPeriodS);
    assess(point.before);
    if(t?.kind==='policy'){
      if(policyBound||t.id!==policyHash||a.type!=='advance')fail('governance policy binding mismatch');policyBound=true;
    }else if(t&&!policyBound)fail('recovery requires bound governance policy');
    else if(t?.kind==='rescue'||t?.kind==='refinance'){
      if(state()!=='GRACE')fail('recovery loan requires grace state');
      let borrow=a;
      if(t.kind==='refinance'){
        const next=x.book.transactions[j+1],nextPoint=x.timeline[j+1];
        if(a.type!=='repay'||!next||!nextPoint||next.commandId!==tag('refinance-loan',t.id)||next.action.type!=='borrow'||next.action.atSimS!==at)return fail('refinance must be an atomic payoff and replacement loan');
        const old=x.view.liquidityView.loans.find(l=>l.loan.id===a.loanId);
        const payment=x.view.liquidityView.receipts.find(r=>r.type==='repay'&&r.commandId.startsWith('r29-'+j+'-'));
        if(point.repaymentClosed!==true||!old||old.closedAtSimS!==at||!payment||payment.type!=='repay'||BigInt(next.action.principalMinor)>BigInt(payment.principalPaidMinor)||next.action.maturityS<=old.loan.maturityS)fail('refinance must close debt and extend maturity without principal increase');
        borrow=next.action;j++;
      }
      if(borrow.type!=='borrow'||borrow.loanId!==tag('loan',t.id)||borrow.interestBps!==p.rescueInterestBps||BigInt(borrow.maturityS)!==BigInt(at)+BigInt(p.rescueTermS)||borrow.principalMinor==='0')return fail('recovery terms not authorized');
      consume(t.id,BigInt(borrow.principalMinor));
    }else if(t?.kind==='train'){
      if(state()!=='LIQUIDATION'||point.before.activeReservations!==0||a.type!=='disposal')return fail('train liquidation not authorized');
      const r=operations.receipts.find(r=>r.type==='disposal'&&r.trainId===a.trainId);
      if(!r||r.type!=='disposal'||r.disposedAtSimS!==at||BigInt(r.resaleProceedsMinor)!==BigInt(r.bookValueMinor)*BigInt(p.liquidationRecoveryBps)/10000n)fail('liquidation proceeds outside policy');
      unique(t.id);
    }else if(t?.kind==='stock'){
      if(state()!=='LIQUIDATION'||point.before.activeReservations!==0||a.type!=='write-off-energy'||a.reservationId!==tag('stock',t.id))return fail('stock liquidation not authorized');
      const r=energy.reservations.find(r=>r.id===a.reservationId);
      if(!r?.closed||r.closed.outcome!=='consumed')fail('missing stock writeoff');unique(t.id);
    }else if(t?.kind==='restart'){
      if(state()!=='LIQUIDATION'||point.before.activeReservations!==0||a.type!=='advance')fail('restart not authorized');
      unique(t.id);restartId=t.id;change('RESTART_AUTHORIZED',at,[]);
    }else if(t)fail('unknown or unpaired recovery action');
    else if(state()==='LIQUIDATION'&&!liquidationAllowed.has(a.type))fail('action prohibited during liquidation');
    else if(state()==='LIQUIDATION'&&a.type==='maintenance'){
      const r=operations.receipts.find(r=>r.type==='service-start'&&r.job.id===a.jobId);
      if(!r||r.type!=='service-start'||liquidatedAt===null||r.job.startS>=liquidatedAt)fail('new maintenance prohibited during liquidation');
    }
    else if(state()==='GRACE'&&graceBlocked.has(a.type))fail('action prohibited during grace');
    else if(a.type==='write-off-energy')fail('writeoff requires controlled liquidation');
    assess(x.timeline[j].after);
  }
  return {stage:state(),policyBound,since,deadline:deadline===null?null:safeTime(deadline),liquidatedAt,nextReviewSimS:state()==='RESTART_AUTHORIZED'?null:safeTime(boundary),nextActionDueSimS:state()==='RESTART_AUTHORIZED'?null:safeTime(deadline!==null&&state()==='GRACE'?min(boundary,deadline):boundary),rescueUsedMinor:money(used),rescueRemainingMinor:money(BigInt(p.rescueBudgetMinor)-used),rescueCount:count,restartId,history};
}
async function evaluate(input:unknown,c:AccountingSources,policyInput:unknown){
  const p=decodeGovernancePolicy(policyInput),x=await inspectAccountingTimeline(input,c);
  const v=await valueCompany(input,c,{companyId:p.companyId,shares:null,stock:null});
  const d=decodeDemandBook(c.demand),r=decodeRevenueBook(c.revenue,d),o=decodeOperatingBook(c.catalog,c.operations),op=inspectOperatingBook(c.catalog,o),energy=inspectEnergyBook(c.energy),inc=inspectIncentiveBook(c.incentives,d,r),l=x.view.liquidityView;
  // Active trip IDs must agree across all three reservation authorities.
  const active=d.trips.filter(t=>t.status==='reserved').map(t=>t.tripId).sort();
  const sets=[r.records.filter(t=>!t.closed).map(t=>t.terms.tripId).sort(),energy.reservations.filter(t=>!t.closed).map(t=>t.id).sort(),l.reservations.filter(t=>!t.closed).map(t=>t.id).sort()];
  if(sets.some(s=>!same(s,active)))fail('active reservations not reconciled');
  if(o.events.some(e=>(e.type==='trip'?e.trip.settledAtSimS:e.type==='overhead'?e.period.settledAtSimS:e.atSimS)>l.simTimeS))fail('operations ahead of accounting clock');
  if(d.trips.some(t=>t.dispatchSimS>l.simTimeS)||r.records.some(t=>t.closed!==null&&t.closed.evidence.arrivalSimS!==null&&t.closed.evidence.arrivalSimS>l.simTimeS))fail('trip ahead of accounting clock');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p)));
  const policyHash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  const life=lifecycle(p,x,c,policyHash);
  const commercial=r.records.filter(t=>!t.binding.serviceId.startsWith('r36:relocation:'));
  const completed=commercial.filter(t=>t.closed&&t.closed.evidence.arrivalSimS!==null),closed=commercial.filter(t=>t.closed!==null);
  const onTime=completed.filter(t=>BigInt(t.closed!.evidence.arrivalSimS!)-BigInt(t.binding.dispatchSimS)<=BigInt(t.terms.promisedDurationS)).length;
  const reliability=closed.length?Number(BigInt(onTime)*10000n/BigInt(closed.length)):null;
  const fleet=op.maintenance.filter(t=>t.asset?.disposedAtSimS===null).length;
  const activeJobs=op.maintenance.filter(t=>t.activeJob!==null).length;
  const counts:Record<Decoded<typeof metric>,number>={'completed-trips':completed.length,'on-time-trips':onTime,'served-routes':new Set(completed.map(t=>JSON.stringify(t.binding.stopIds))).size,'service-completions':op.receipts.filter(t=>t.type==='service-complete').length,'subsidy-claims':inc.receipts.filter(t=>t.type==='subsidy'&&t.subsidyRevenueMinor!=='0').length};
  const missions=p.milestones.map(m=>({...decodeMission({id:m.id,target:m.target,progress:Math.min(m.target,counts[m.metric])}),metric:m.metric,completed:counts[m.metric]>=m.target}));
  const unlocks=p.unlocks.map(u=>{
    const missing:string[]=[];
    if(life.stage!=='HEALTHY')missing.push('SOLVENCY');
    if(completed.length<u.minCompletedTrips)missing.push('COMPLETED_TRIPS');
    if(u.minReliabilityBps>0&&(reliability===null||reliability<u.minReliabilityBps))missing.push('RELIABILITY');
    if(BigInt(v.availableCashMinor)<BigInt(u.minAvailableCashMinor))missing.push('LIQUIDITY');
    if(BigInt(v.payoffAdjustedEquityMinor)<BigInt(u.minEquityMinor))missing.push('EQUITY');
    if(u.requiredMilestones.some(id=>!missions.some(m=>m.id===id&&m.completed)))missing.push('MILESTONES');
    return {id:u.id,eligible:missing.length===0,missing,fleetLimit:u.fleetLimit,canExpand:missing.length===0&&fleet<u.fleetLimit,remainingFleetCapacity:missing.length===0?Math.max(0,u.fleetLimit-fleet):0};
  });
  const stockEmpty=energy.inventory.every(t=>t.onHand==='0'),debt=BigInt(l.totalPayoffMinor),cash=BigInt(l.cashMinor);
  const terminal=fleet===0&&activeJobs===0&&active.length===0&&l.reservedCashMinor==='0'&&stockEmpty&&(debt===0n||cash===0n);
  if(life.stage==='RESTART_AUTHORIZED'&&!terminal)fail('restart cannot abandon live assets or payable cash');
  return {p,x,v,o,energy,life,policyHash,view:freeze({companyId:p.companyId,accountingRevision:x.book.revision,sourceVersions:x.view.sourceVersions,atSimS:l.simTimeS,...life,policySha256:policyHash,currentReasons:reasons(p,x.timeline.at(-1)?.after??x.initial),completedTrips:completed.length,closedTrips:closed.length,onTimeTrips:onTime,reliabilityBps:reliability,activeFleet:fleet,activeJobs,activeTripIds:active,missions,unlocks,availableCashMinor:v.availableCashMinor,netEquityMinor:v.netEquityMinor,payoffAdjustedEquityMinor:v.payoffAdjustedEquityMinor,remainingDebtMinor:l.totalPayoffMinor,stockEmpty,liquidationComplete:life.stage==='LIQUIDATION'&&terminal,restart:life.stage==='RESTART_AUTHORIZED'?{archivedCompanyId:p.companyId,authorizationId:life.restartId,archivedCashMinor:l.cashMinor,archivedDebtMinor:l.totalPayoffMinor,newOpeningCashMinor:'0',requiresSeparateScenarioAuthorization:true}:null})};
}
export async function evaluateSolvency(input:unknown,c:AccountingSources,policy:unknown){return (await evaluate(input,c,policy)).view;}
export async function evaluateUnlock(input:unknown,c:AccountingSources,policy:unknown,unlockId:unknown){
  const v=await evaluateSolvency(input,c,policy);return v.unlocks.find(x=>x.id===id(unlockId))??fail('unknown unlock');
}
const rescue=object({type:enumeration(['rescue']),principalMinor:positiveMoney});
const refinance=object({type:enumeration(['refinance']),loanId:id,replacementPrincipalMinor:positiveMoney});
const train=object({type:enumeration(['liquidate-train']),trainId:id});
const stock=object({type:enumeration(['liquidate-stock'])});
const restart=object({type:enumeration(['restart'])});
function recovery(v:unknown,path='recovery'){
  switch(record(v,path).type){case 'rescue':return rescue(v,path);case 'refinance':return refinance(v,path);case 'liquidate-train':return train(v,path);case 'liquidate-stock':return stock(v,path);case 'restart':return restart(v,path);default:return fail('unknown recovery action');}
}
const versions=object({demand:integer,revenue:integer,energy:integer,operations:integer,incentives:integer});
const command=object({id:shortId,expectedAccountingRevision:integer,expectedSources:versions,action:recovery});
/** Pure aggregate candidate. Policy is trusted immutable scenario authority,
 * not editable client input. R35/R39 must enforce the gate on all actions and
 * atomically CAS the returned accounting + source books. A restart marker
 * archives the old company and never creates or transfers funds. */
export async function applyRecoveryCommand(input:unknown,c:AccountingSources,policy:unknown,cmd:unknown,marketInput?:unknown){
  const q=command(cmd),s=await evaluate(input,c,policy),p=s.p,at=s.view.atSimS;
  if(q.expectedAccountingRevision!==s.x.book.revision||!same(q.expectedSources,s.x.view.sourceVersions))fail('STALE_RECOVERY_REVISION');
  const a=q.action;
  let accounting:AccountingBook=s.x.book,operations=s.o,energy=decodeEnergyBook(c.energy),market:EnergyMarketBook|null=null;
  if(marketInput!==undefined){
    market=decodeEnergyMarket(marketInput);const v=inspectEnergyMarket(market);
    if(v.simTimeS!==at||!same(v.energy,energy))fail('market projection or clock mismatch');
  }
  const sources=()=>({...c,operations,energy});
  const apply=async(commandId:string,action:unknown)=>{
    if(accounting.transactions.some(t=>t.commandId===commandId))fail('recovery command already used');
    accounting=await applyAccountingCommand(accounting,sources(),{expectedRevision:accounting.revision,expectedSources:{...s.x.view.sourceVersions,operations:operations.revision,energy:energy.revision},commandId,action});
  };
  if(!s.life.policyBound)await apply(tag('policy',s.policyHash),{type:'advance',atSimS:at});
  if(a.type==='rescue'||a.type==='refinance'){
    if(s.life.stage!=='GRACE')fail('recovery loan requires grace state');
    const n=a.type==='rescue'?a.principalMinor:a.replacementPrincipalMinor,maturity=BigInt(at)+BigInt(p.rescueTermS);
    if(maturity>BigInt(MAX_INTEGER)||BigInt(n)>BigInt(s.life.rescueRemainingMinor)||s.life.rescueCount>=p.maxRescues)fail('rescue authorization exhausted or maturity overflow');
    const b={type:'borrow',atSimS:at,loanId:tag('loan',q.id),principalMinor:n,maturityS:Number(maturity),interestBps:p.rescueInterestBps};
    if(a.type==='refinance'){
      const old=s.x.view.liquidityView.loans.find(t=>t.loan.id===a.loanId)??fail('unknown refinance loan');
      if(old.status==='repaid'||BigInt(n)>BigInt(old.loan.remainingMinor)||maturity<=BigInt(old.loan.maturityS))fail('invalid refinance principal or maturity');
      // Pay off first: overdue debt cannot be waived and reserved cash cannot
      // be used. Both commands are returned together or neither is committed.
      await apply(tag('refinance',q.id),{type:'repay',atSimS:at,loanId:a.loanId,amountMinor:old.payoffMinor});
      await apply(tag('refinance-loan',q.id),b);
    }else await apply(tag('rescue',q.id),b);
  }else{
    if(s.life.stage!=='LIQUIDATION')fail('liquidation action requires liquidation state');
    if(s.view.activeTripIds.length||s.view.activeJobs||s.view.availableCashMinor!==s.v.cashMinor)fail('settle active reservations and jobs before liquidation');
    if(a.type==='liquidate-train'){
      const conf=operations.events.find(e=>e.type==='configure-maintenance'&&e.trainId===a.trainId),opening=operations.opening.find(e=>e.train.id===a.trainId);
      if(!conf||conf.type!=='configure-maintenance'||!opening)return fail('unknown liquidation asset');
      const asset=inspectOperatingBook(c.catalog,operations).maintenance.find(t=>t.trainId===a.trainId)?.asset;
      if(!asset||asset.disposedAtSimS!==null)fail('asset already disposed or missing');
      const v=calculateDepreciation({asset:conf.asset,fromElapsedS:0,toElapsedS:at-opening.acquiredAtSimS});
      const proceeds=money(BigInt(v.bookValueMinor)*BigInt(p.liquidationRecoveryBps)/10000n);
      operations=applyOperatingEvent(c.catalog,operations,{expectedRevision:operations.revision,event:{type:'dispose',trainId:a.trainId,atSimS:at,proceedsMinor:proceeds}});
      await apply(tag('train',q.id),{type:'disposal',atSimS:at,trainId:a.trainId});
    }else if(a.type==='liquidate-stock'){
      const requirements=s.energy.inventory.filter(x=>x.onHand!=='0').map(x=>({unit:x.unit,quantity:x.onHand}));
      if(!requirements.length)fail('no inventory to write off');
      const reservationId=tag('stock',q.id),events=[{type:'reserve',reservationId,requirements},{type:'close',reservationId,outcome:'consumed',actual:requirements}];
      for(const event of events){
        if(market){market=applyMarketAction(market,{expectedRevision:market.revision,action:event});energy=inspectEnergyMarket(market).energy;}
        else energy=applyEnergyEvent(energy,{expectedRevision:energy.revision,event});
      }
      await apply(tag('stock',q.id),{type:'write-off-energy',atSimS:at,reservationId});
    }else{
      if(!s.view.liquidationComplete)fail('liquidation not complete');
      await apply(tag('restart',q.id),{type:'advance',atSimS:at});
    }
  }
  const next=await evaluate(accounting,sources(),p);
  return freeze({accounting,operations,energy,market,governance:next.view});
}

/** Ordinary finance candidate gate, including prepared upstream settlement
 * candidates. The aggregate controller must call this instead of raw R29.
 * Recovery identities are reserved for applyRecoveryCommand. */
export async function applyGovernedAccountingCommand(input:unknown,c:AccountingSources,policy:unknown,cmd:unknown){
  const r=record(cmd,'command');
  if(id(r.commandId).startsWith('r31:'))fail('reserved recovery command identity');
  let accounting=await applyAccountingCommand(input,c,cmd);
  let next=await evaluate(accounting,c,policy);
  if(!next.life.policyBound){
    accounting=await applyAccountingCommand(accounting,c,{expectedRevision:accounting.revision,expectedSources:next.x.view.sourceVersions,commandId:tag('policy',next.policyHash),action:{type:'advance',atSimS:next.view.atSimS}});
    next=await evaluate(accounting,c,policy);
  }
  return freeze({accounting,governance:next.view});
}
