// R30 E24–E26. Fictional scenario inputs only; no live prices or investment advice.
import { decodeShareLedger } from '../../domain/models';
import { integer, minor, signedMinor, decimal, seconds, checkedAdd, scaleMinor } from '../../domain/units';
import { object, list, distinct, id, enumeration, refine, record, version1, nullable, type Decoded } from '../../domain/validation';
import { inspectAccountingBook, type AccountingSources } from './accounting';
import { decodeOperatingBook, inspectOperatingBook } from './operations';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Company economy: '+s);};
const money=(n:bigint)=>minor(String(n));
const signed=(n:bigint)=>signedMinor(String(n));
const ratioDecimal=decimal('signed-bps',true);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const clamp=(n:bigint,lo:bigint,hi:bigint)=>n<lo?lo:n>hi?hi:n;
const positiveS=refine(seconds,n=>n>0,'positive period required');
function freeze<T>(v:T):ReadonlyTree<T>{
  if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}
  return v as ReadonlyTree<T>;
}
const indexBps=(v:unknown,p?:string)=>integer(v,p,1,1000000000);
const changeBps=(v:unknown,p?:string)=>integer(v,p,-10000,10000);
const rounding=enumeration(['floor','ceil']);
const regionRule=refine(object({regionId:id,initialIndexBps:indexBps,minIndexBps:indexBps,maxIndexBps:indexBps,minChangeBps:changeBps,maxChangeBps:changeBps}),r=>r.minIndexBps<=r.initialIndexBps&&r.initialIndexBps<=r.maxIndexBps&&r.minChangeBps<=r.maxChangeBps,'invalid regional index bounds');
const inflationPolicy=object({id,startSimS:seconds,periodS:positiveS,regions:distinct(list(regionRule,1,1000),r=>r.regionId)});
const tick=object({type:enumeration(['advance']),atSimS:seconds,changes:distinct(list(object({regionId:id,changeBps}),1,1000),x=>x.regionId)});
const lock=object({type:enumeration(['lock-price']),atSimS:seconds,contractId:id,regionId:id,expectedIndexVersion:integer,baseMinor:minor,rounding,expiresAtSimS:seconds});
function inflationEvent(v:unknown,p='event'){
  const r=record(v,p);
  if(r.type==='advance')return tick(v,p);
  if(r.type==='lock-price')return lock(v,p);
  return fail('unknown inflation event');
}
const inflationEntry=object({commandId:id,event:inflationEvent});
const inflationBook=object({schemaVersion:version1,revision:integer,policy:inflationPolicy,entries:list(inflationEntry,0,10000)});
type Inflation=Decoded<typeof inflationBook>;
export type InflationBook=ReadonlyTree<Inflation>;
const inflationCommand=object({expectedRevision:integer,commandId:id,event:inflationEvent});
const priceInput=object({regionId:id,atSimS:seconds,baseMinor:minor,rounding});
type PriceInput=Decoded<typeof priceInput>;
type IndexPoint={regionId:string;indexVersion:number;effectiveSimS:number;indexBps:number;changeBps:number|null};
type LockedPrice={contractId:string;policyId:string;regionId:string;indexVersion:number;effectiveSimS:number;indexBps:number;issuedAtSimS:number;expiresAtSimS:number;baseMinor:string;rounding:'floor'|'ceil';priceMinor:string};
/** E24: exactly one complete regional update at each scheduled boundary.
 * Multiplicative fixed-point index, floor then clamp. All rates and bounds
 * are explicit policy; the 10000 denominator is a unit convention only. */
function inflationReplay(input:unknown){
  const s=inflationBook(input),p=s.policy;
  if(s.revision!==s.entries.length)fail('inflation revision mismatch');
  p.regions.sort((a,b)=>order(a.regionId,b.regionId));
  const rules=new Map(p.regions.map(r=>[r.regionId,r]));
  const history:IndexPoint[]=p.regions.map(r=>({regionId:r.regionId,indexVersion:0,effectiveSimS:p.startSimS,indexBps:r.initialIndexBps,changeBps:null}));
  const current=new Map(history.map(x=>[x.regionId,x]));
  const locked=new Map<string,LockedPrice>(),commands=new Set<string>();
  let version=0,now=Number(p.startSimS),boundary=BigInt(p.startSimS)+BigInt(p.periodS);
  for(const row of s.entries){
    const e=row.event;
    if(commands.has(row.commandId))fail('duplicate inflation command');commands.add(row.commandId);
    if(e.atSimS<now)fail('inflation time reversed');
    if(e.type==='advance'){
      if(BigInt(e.atSimS)!==boundary)fail('inflation tick must match next boundary');
      e.changes.sort((a,b)=>order(a.regionId,b.regionId));
      if(e.changes.length!==rules.size)fail('incomplete regional update');
      if(history.length+rules.size>100000)fail('inflation history point limit');
      version++;
      for(const x of e.changes){
        const r=rules.get(x.regionId)??fail('unknown region');
        if(x.changeBps<r.minChangeBps||x.changeBps>r.maxChangeBps)fail('regional rate outside policy');
        const prev=current.get(x.regionId)!;
        const n=BigInt(prev.indexBps)*BigInt(10000+x.changeBps)/10000n;
        const next={regionId:x.regionId,indexVersion:version,effectiveSimS:e.atSimS,indexBps:Number(clamp(n,BigInt(r.minIndexBps),BigInt(r.maxIndexBps))),changeBps:x.changeBps};
        current.set(x.regionId,next);history.push(next);
      }
      boundary+=BigInt(p.periodS);
    }else{
      if(BigInt(e.atSimS)>=boundary)fail('inflation update due before price lock');
      if(e.expectedIndexVersion!==version)fail('stale inflation index version');
      if(locked.has(e.contractId))fail('duplicate contract price lock');
      if(e.expiresAtSimS<=e.atSimS)fail('invalid contract expiry');
      const x=current.get(e.regionId)??fail('unknown region');
      locked.set(e.contractId,{contractId:e.contractId,policyId:p.id,regionId:e.regionId,indexVersion:x.indexVersion,effectiveSimS:x.effectiveSimS,indexBps:x.indexBps,issuedAtSimS:e.atSimS,expiresAtSimS:e.expiresAtSimS,baseMinor:e.baseMinor,rounding:e.rounding,priceMinor:scaleMinor(e.baseMinor,BigInt(x.indexBps),10000n,e.rounding)});
    }
    now=e.atSimS;
  }
  return {book:s,now,version,boundary,current,locked,view:{revision:s.revision,indexVersion:version,simTimeS:now,nextUpdateSimS:boundary>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(boundary),current:[...current.values()],history,lockedPrices:[...locked.values()]}};
}
export function createInflationBook(policy:unknown):InflationBook{return decodeInflationBook({schemaVersion:1,revision:0,policy,entries:[]});}
export function decodeInflationBook(input:unknown):InflationBook{return freeze(inflationReplay(input).book);}
export function inspectInflationBook(input:unknown){return freeze(inflationReplay(input).view);}
export function applyInflationEvent(input:unknown,cmd:unknown):InflationBook{
  const q=inflationCommand(cmd),s=inflationReplay(input).book;
  if(q.event.type==='advance')q.event.changes.sort((a,b)=>order(a.regionId,b.regionId));
  const prior=s.entries.find(x=>x.commandId===q.commandId);
  if(prior){if(!same(prior.event,q.event))fail('inflation command conflict');return freeze(s);}
  if(s.revision!==q.expectedRevision)fail('STALE_INFLATION_REVISION');
  s.entries.push({commandId:q.commandId,event:q.event});s.revision++;
  return decodeInflationBook(s);
}
/** Pure price quote for the current index interval; no implicit skipped ticks.
 * Explicit rounding per unit price, not a revaluation of existing contracts. */
export function quoteInflatedPrice(input:unknown,request:unknown){
  const s=inflationReplay(input),q:PriceInput=priceInput(request);
  if(q.atSimS<s.now||BigInt(q.atSimS)>=s.boundary)fail('price quote outside current interval');
  const x=s.current.get(q.regionId)??fail('unknown region');
  return freeze({policyId:s.book.policy.id,regionId:q.regionId,indexVersion:x.indexVersion,effectiveSimS:x.effectiveSimS,indexBps:x.indexBps,quotedAtSimS:q.atSimS,baseMinor:q.baseMinor,rounding:q.rounding,priceMinor:scaleMinor(q.baseMinor,BigInt(x.indexBps),10000n,q.rounding)});
}
/** Retain all historical locks, including expired contracts for audit.
 * The active price resolver never substitutes a newer index. */
export function resolveLockedPrice(input:unknown,contractId:unknown,atSimS:unknown){
  const s=inflationReplay(input),p=s.locked.get(id(contractId))??fail('unknown contract lock'),at=seconds(atSimS);
  if(at<p.issuedAtSimS||at>=p.expiresAtSimS)fail('contract price outside active window');
  return freeze(p);
}

const scenarioPeriod=object({durationS:positiveS,passengerRevenueMinor:minor,freightRevenueMinor:minor,subsidyRevenueMinor:minor,operatingCashCostMinor:minor,depreciationMinor:minor});
const expansion=object({scenarioId:id,capex:distinct(list(object({id,amountMinor:minor}),0,1000),x=>x.id),periods:list(scenarioPeriod,1,10000)});
/** E25: undiscounted, unlevered scenario cash recovery over explicit periods.
 * Revenue assumed collected and operating cash cost paid in each period.
 * No tax, financing, terminal sale, future extrapolation or guaranteed returns.
 * Accounting operating profit separately deducts noncash depreciation. */
export function evaluateExpansionScenario(input:unknown){
  const q=expansion(input),capex=q.capex.reduce((n,x)=>n+BigInt(x.amountMinor),0n);
  let elapsed=0,revenue=0n,cost=0n,dep=0n,cumulative=0n,payback:number|null=null;
  const periods=q.periods.map((p,index)=>{
    elapsed=checkedAdd(elapsed,p.durationS);
    const r=BigInt(p.passengerRevenueMinor)+BigInt(p.freightRevenueMinor)+BigInt(p.subsidyRevenueMinor),c=BigInt(p.operatingCashCostMinor),d=BigInt(p.depreciationMinor),margin=r-c;
    revenue+=r;cost+=c;dep+=d;cumulative+=margin;
    if(capex>0n&&payback===null&&cumulative>=capex)payback=elapsed;
    return {periodIndex:index,endElapsedS:elapsed,revenueMinor:money(r),operatingCashCostMinor:money(c),depreciationMinor:money(d),operatingMarginMinor:signed(margin),operatingProfitMinor:signed(margin-d),cumulativeCashReturnMinor:signed(cumulative),unrecoveredCapexMinor:money(capex>cumulative?capex-cumulative:0n)};
  });
  const net=cumulative-capex;
  return freeze({scenarioId:q.scenarioId,horizonS:elapsed,capexMinor:money(capex),revenueMinor:money(revenue),operatingCashCostMinor:money(cost),depreciationMinor:money(dep),operatingMarginMinor:signed(cumulative),operatingProfitMinor:signed(cumulative-dep),netReturnMinor:signed(net),roiBps:capex===0n?null:ratioDecimal(String(net*10000n/capex)),paybackS:payback,endsRecovered:capex>0n?net>=0n:null,periods});
}
function completeSources(v:Awaited<ReturnType<typeof inspectAccountingBook>>,c:AccountingSources){
  const p=v.pending;
  return !(p.energyLots.length||p.energyReservations.length||p.trips.length||p.operations||p.incentives||p.assets)&&!inspectOperatingBook(c.catalog,c.operations).maintenance.some(t=>t.asset===null);
}
export async function evaluatePurchase(input:unknown,c:AccountingSources,scenario:unknown){
  const x=await inspectAccountingBook(input,c),result=evaluateExpansionScenario(scenario),free=BigInt(x.liquidityView.availableCashMinor),cost=BigInt(result.capexMinor);
  const sourceReconciled=completeSources(x,c);
  return freeze({accountingRevision:x.revision,sourceVersions:x.sourceVersions,asOfSimS:x.liquidityView.simTimeS,sourceReconciled,availableCashMinor:x.liquidityView.availableCashMinor,affordableFromAvailableCash:sourceReconciled?free>=cost:null,cashShortfallMinor:sourceReconciled?money(cost>free?cost-free:0n):null,scenario:result});
}

const multiplier=(v:unknown,p?:string)=>integer(v,p,0,100000);
const impact=(v:unknown,p?:string)=>integer(v,p,-100000,100000);
const stockPolicy=refine(object({companyId:id,id,startSimS:seconds,initialMultiplierBps:multiplier,minMultiplierBps:multiplier,maxMultiplierBps:multiplier,maxEventImpactBps:multiplier}),p=>p.minMultiplierBps<=p.initialMultiplierBps&&p.initialMultiplierBps<=p.maxMultiplierBps,'invalid fictional valuation bounds');
const stockEvent=object({eventId:id,atSimS:seconds,impactBps:impact});
const stockBook=object({schemaVersion:version1,revision:integer,policy:stockPolicy,events:distinct(list(stockEvent,0,10000),x=>x.eventId)});
const stockCommand=object({expectedRevision:integer,event:stockEvent});
type Stock=Decoded<typeof stockBook>;
export type FictionalStockBook=ReadonlyTree<Stock>;
function stockReplay(input:unknown){
  const s=stockBook(input),p=s.policy;
  if(s.revision!==s.events.length)fail('stock revision mismatch');
  let value=BigInt(p.initialMultiplierBps),now=Number(p.startSimS);
  const history=s.events.map(e=>{
    if(e.atSimS<now)fail('stock event time reversed');
    if(Math.abs(e.impactBps)>p.maxEventImpactBps)fail('stock event exceeds policy');
    value=clamp(value+BigInt(e.impactBps),BigInt(p.minMultiplierBps),BigInt(p.maxMultiplierBps));now=e.atSimS;
    return {...e,multiplierBps:Number(value)};
  });
  return {book:s,now,multiplierBps:Number(value),history};
}
export function createFictionalStockBook(policy:unknown):FictionalStockBook{return decodeFictionalStockBook({schemaVersion:1,revision:0,policy,events:[]});}
export function decodeFictionalStockBook(input:unknown):FictionalStockBook{return freeze(stockReplay(input).book);}
export function inspectFictionalStockBook(input:unknown){const x=stockReplay(input);return freeze({revision:x.book.revision,companyId:x.book.policy.companyId,simTimeS:x.now,multiplierBps:x.multiplierBps,history:x.history});}
export function applyFictionalStockEvent(input:unknown,cmd:unknown):FictionalStockBook{
  const q=stockCommand(cmd),s=stockReplay(input).book,prior=s.events.find(x=>x.eventId===q.event.eventId);
  if(prior){if(!same(prior,q.event))fail('stock event conflict');return freeze(s);}
  if(q.expectedRevision!==s.revision)fail('STALE_STOCK_REVISION');
  s.events.push(q.event);s.revision++;
  return decodeFictionalStockBook(s);
}
const equityRequest=object({companyId:id,shares:nullable(decodeShareLedger),stock:nullable(stockBook)});
/** E26: derive carrying assets and recognized liabilities from the actual R29
 * replay, never arbitrary submitted balances. No price-based mark-up of assets.
 * Fail closed on unrecognized source receipts or missing asset basis.
 * Unrecognized interest is separately shown as payoff-adjusted equity.
 * Optional virtual price is informational only: no issuance/trading/cash change. */
export async function valueCompany(input:unknown,c:AccountingSources,request:unknown){
  const q=equityRequest(request),o=decodeOperatingBook(c.catalog,c.operations);
  if(o.companyId!==q.companyId)fail('company identity mismatch');
  const v=await inspectAccountingBook(input,c),p=v.pending,l=v.liquidityView;
  if(p.energyLots.length||p.energyReservations.length||p.trips.length||p.operations||p.incentives||p.assets)fail('unrecognized accounting sources');
  if(inspectOperatingBook(c.catalog,o).maintenance.some(t=>t.asset===null))fail('unconfigured asset basis');
  const bal=(accountId:string)=>BigInt(v.balances.find(x=>x.accountId===accountId)?.debitBalanceMinor??fail('missing ledger account'));
  const cash=bal('cash'),inventory=bal('energy-inventory'),basis=bal('train-assets'),accumulated=-bal('accumulated-depreciation'),principal=-bal('loan-principal'),interest=-bal('interest-payable');
  const netTrain=basis-accumulated,assets=cash+inventory+netTrain,liabilities=principal+interest,equity=assets-liabilities;
  if([cash,inventory,basis,accumulated,netTrain,principal,interest].some(n=>n<0n)||equity!==BigInt(v.equityMinor)||cash!==BigInt(l.cashMinor)||principal!==BigInt(l.principalOutstandingMinor)||interest!==BigInt(l.interestOutstandingMinor))fail('company balance reconciliation mismatch');
  const unrecognized=BigInt(l.totalPayoffMinor)-liabilities;
  if(unrecognized<0n)fail('payoff reconciliation mismatch');
  if(q.shares&&q.shares.companyId!==q.companyId)fail('share ledger company mismatch');
  if(q.stock&&!q.shares)fail('fictional price requires share ledger');
  let stock:null|{label:'FICTIONAL_GAME_ONLY';issued:number;multiplierBps:number;bookValuePerShareMinor:string;pricePerShareMinor:string;marketCapitalizationMinor:string;stockRevision:number}=null;
  if(q.stock){
    const s=stockReplay(q.stock);
    if(s.book.policy.companyId!==q.companyId||s.now>l.simTimeS)fail('stock identity or time mismatch');
    if(q.shares!.issued>0){
      const issued=BigInt(q.shares!.issued),positiveEquity=equity>0n?equity:0n,price=positiveEquity*BigInt(s.multiplierBps)/(10000n*issued);
      stock={label:'FICTIONAL_GAME_ONLY',issued:q.shares!.issued,multiplierBps:s.multiplierBps,bookValuePerShareMinor:signed(equity/issued),pricePerShareMinor:money(price),marketCapitalizationMinor:money(price*issued),stockRevision:s.book.revision};
    }
  }
  return freeze({companyId:q.companyId,accountingRevision:v.revision,sourceVersions:v.sourceVersions,asOfSimS:l.simTimeS,cashMinor:money(cash),reservedCashMinor:l.reservedCashMinor,availableCashMinor:l.availableCashMinor,energyInventoryMinor:money(inventory),grossTrainAssetsMinor:money(basis),accumulatedDepreciationMinor:money(accumulated),netTrainAssetsMinor:money(netTrain),totalAssetsMinor:money(assets),loanPrincipalMinor:money(principal),recognizedInterestPayableMinor:money(interest),totalLiabilitiesMinor:money(liabilities),netEquityMinor:signed(equity),unrecognizedInterestMinor:money(unrecognized),payoffAdjustedEquityMinor:signed(equity-unrecognized),shareCount:q.shares?.issued??null,stock});
}
