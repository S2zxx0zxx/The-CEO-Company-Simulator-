// R29 E22/E23. Source-backed pure accounting candidates; no raw posting/mint API.
import { decodeJournalEntry, type JournalEntry } from '../../domain/models';
import { integer, minor, signedMinor, seconds } from '../../domain/units';
import { object, list, id, enumeration, record, sha256, version1, type Decoded } from '../../domain/validation';
import { decodeDemandBook } from './demand';
import { decodeRevenueBook } from './revenue';
import { decodeEnergyBook, inspectEnergyBook } from './energy';
import { decodeOperatingBook, inspectOperatingBook } from './operations';
import { decodeIncentiveBook, inspectIncentiveBook } from './incentives';
import { createLiquidityBook, applyLiquidityEvent, inspectLiquidityBook, type LiquidityBook } from './liquidity';
import { basisPoints } from '../../domain/units';
import type { RollingStockCatalog } from '../catalog';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Accounting: '+s);};
const money=(n:bigint)=>minor(String(n));
const signed=(n:bigint)=>signedMinor(String(n));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function freeze<T>(v:T):ReadonlyTree<T>{if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v as ReadonlyTree<T>;}
async function digest(v:unknown){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)));return sha256(Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''));}
const expenseAccounts=['track','terminal','crew','staff','maintenance','marketing','refund','delay','energy-expense'] as const;
const expenseAccount=enumeration(expenseAccounts);
type Expense=Decoded<typeof expenseAccount>;
const accounts=['cash','energy-inventory','train-assets','accumulated-depreciation','loan-principal','interest-payable','opening-equity','passenger-revenue','cargo-revenue','subsidy-revenue','fine-revenue',...expenseAccounts,'depreciation','interest','disposal-gain','disposal-loss'] as const;
type Account=typeof accounts[number];
const financingPolicy=object({creditLimitMinor:minor,maxInterestBps:basisPoints,interestPeriodS:seconds,maxTermS:seconds});
const advance=object({type:enumeration(['advance']),atSimS:seconds});
const borrow=object({type:enumeration(['borrow']),atSimS:seconds,loanId:id,principalMinor:minor,maturityS:seconds,interestBps:basisPoints});
const repay=object({type:enumeration(['repay']),atSimS:seconds,loanId:id,amountMinor:minor});
const reserve=object({type:enumeration(['reserve-trip']),atSimS:seconds,tripId:id,amountMinor:minor});
const settle=object({type:enumeration(['settle-trip']),atSimS:seconds,tripId:id});
const purchase=object({type:enumeration(['buy-energy']),atSimS:seconds,lotId:id});
const writeoff=object({type:enumeration(['write-off-energy']),atSimS:seconds,reservationId:id});
const asset=object({type:enumeration(['acquire-asset']),atSimS:seconds,trainId:id});
const overhead=object({type:enumeration(['overhead']),atSimS:seconds,periodIndex:integer});
const service=object({type:enumeration(['maintenance']),atSimS:seconds,jobId:id});
const depreciation=object({type:enumeration(['depreciation']),atSimS:seconds,trainId:id,throughSimS:seconds});
const dispose=object({type:enumeration(['disposal']),atSimS:seconds,trainId:id});
const subsidy=object({type:enumeration(['subsidy']),atSimS:seconds,tripId:id});
const fine=object({type:enumeration(['fine']),atSimS:seconds,tripId:id});
const campaign=object({type:enumeration(['campaign']),atSimS:seconds,campaignId:id});
const reclassify=object({type:enumeration(['reclassify']),atSimS:seconds,from:expenseAccount,to:expenseAccount,amountMinor:minor,reasonId:id});
const reverse=object({type:enumeration(['reverse']),atSimS:seconds,targetCommandId:id,reasonId:id});
function action(v:unknown,path='action'){
  switch(record(v,path).type){
    case 'advance':return advance(v,path);case 'borrow':return borrow(v,path);case 'repay':return repay(v,path);
    case 'reserve-trip':return reserve(v,path);case 'settle-trip':return settle(v,path);case 'buy-energy':return purchase(v,path);
    case 'write-off-energy':return writeoff(v,path);case 'acquire-asset':return asset(v,path);case 'overhead':return overhead(v,path);case 'maintenance':return service(v,path);
    case 'depreciation':return depreciation(v,path);case 'disposal':return dispose(v,path);case 'subsidy':return subsidy(v,path);
    case 'fine':return fine(v,path);case 'campaign':return campaign(v,path);case 'reclassify':return reclassify(v,path);case 'reverse':return reverse(v,path);
    default:return fail('unknown accounting action');
  }
}
const transaction=object({commandId:id,action,payloadSha256:sha256});
const book=object({schemaVersion:version1,revision:integer,openingCashMinor:minor,startSimS:seconds,policy:financingPolicy,transactions:list(transaction,0,10000)});
const versions=object({demand:integer,revenue:integer,energy:integer,operations:integer,incentives:integer});
const command=object({expectedRevision:integer,expectedSources:versions,commandId:id,action});
type Book=Decoded<typeof book>;
type Action=Decoded<typeof action>;
type Transaction=Decoded<typeof transaction>;
export type AccountingBook=ReadonlyTree<Book>;
/** Context is trusted authoritative aggregate state, not client-supplied receipts.
 * Caller must validate command authority and CAS all source revisions together
 * with the returned book (R34/R35/R39). Decoders validate every source history. */
export type AccountingSources={catalog:RollingStockCatalog;demand:unknown;revenue:unknown;energy:unknown;operations:unknown;incentives:unknown};
function sources(c:AccountingSources){
  const d=decodeDemandBook(c.demand),r=decodeRevenueBook(c.revenue,d),e=decodeEnergyBook(c.energy),o=decodeOperatingBook(c.catalog,c.operations),i=decodeIncentiveBook(c.incentives,d,r);
  return {d,r,e,o,i,energy:inspectEnergyBook(e),operations:inspectOperatingBook(c.catalog,o),incentives:inspectIncentiveBook(i,d,r),versions:{demand:d.revision,revenue:r.revision,energy:e.revision,operations:o.revision,incentives:i.revision}};
}
type Sources=ReturnType<typeof sources>;
type Leg={accountId:Account;debitMinor:string;creditMinor:string;currency:'INR'};
type AssetRuntime={basis:bigint;accumulated:bigint;disposed:boolean};
type LotRuntime={cost:bigint;quantity:bigint;usedCost:bigint;usedQuantity:bigint};
type Flow='operating'|'investing'|'financing';
const key=(...xs:(string|number)[])=>JSON.stringify(xs);
type FinancialSnapshot={atSimS:number;availableCashMinor:string;reservedCashMinor:string;activeReservations:number;payoffAdjustedEquityMinor:string;overdueLoans:number};
type FinancialPoint={revision:number;commandId:string;type:Action['type'];before:FinancialSnapshot;after:FinancialSnapshot;repaymentClosed:boolean|null};
async function replay(s:Book,c:Sources,append?:{commandId:string;action:Action},captureTimeline=false){
  if(s.revision!==s.transactions.length)fail('revision mismatch');
  let liquidity:LiquidityBook=createLiquidityBook(s.openingCashMinor,s.startSimS,s.policy);
  const balances=new Map<Account,bigint>(accounts.map(a=>[a,0n]));
  const journal:JournalEntry[]=[],claims=new Set<string>(),commands=new Map<string,Transaction>();
  const reversible=new Map<string,{from:Expense;to:Expense;amount:bigint;reversed:boolean}>();
  const assets=new Map<string,AssetRuntime>(),lots=new Map<string,LotRuntime>();
  const flows:Record<Flow,{in:bigint;out:bigint}>={operating:{in:0n,out:0n},investing:{in:0n,out:0n},financing:{in:0n,out:0n}};
  let now=Number(s.startSimS);
  const balance=(a:Account)=>balances.get(a)!;
  function post(legs:Leg[],dr:Account,cr:Account,n:bigint){
    if(n===0n)return;
    const x=money(n);legs.push({accountId:dr,debitMinor:x,creditMinor:'0',currency:'INR'},{accountId:cr,debitMinor:'0',creditMinor:x,currency:'INR'});
    balances.set(dr,balance(dr)+n);balances.set(cr,balance(cr)-n);
  }
  if(s.openingCashMinor!=='0'){
    const legs:Leg[]=[];post(legs,'cash','opening-equity',BigInt(s.openingCashMinor));
    journal.push(decodeJournalEntry({eventId:'r29-opening',commandId:'r29-opening',simTimeS:now,postings:legs,payloadSha256:await digest({openingCashMinor:s.openingCashMinor,startSimS:s.startSimS,policy:s.policy})}));
  }
  const timeline:FinancialPoint[]=[];
  function snapshot(l:ReturnType<typeof inspectLiquidityBook>):FinancialSnapshot{
    const carryingEquity=balance('cash')+balance('energy-inventory')+balance('train-assets')+balance('accumulated-depreciation')+balance('loan-principal')+balance('interest-payable');
    return {atSimS:l.simTimeS,availableCashMinor:l.availableCashMinor,reservedCashMinor:l.reservedCashMinor,activeReservations:l.reservations.filter(x=>!x.closed).length,payoffAdjustedEquityMinor:signed(carryingEquity+BigInt(l.totalDebtMinor)-BigInt(l.totalPayoffMinor)),overdueLoans:l.loans.filter(x=>x.status==='matured-unpaid').length};
  }
  const initial=captureTimeline?snapshot(inspectLiquidityBook(liquidity)):null;
  const rows=[...s.transactions,...(append?[{...append,payloadSha256:null}]:[])];
  for(let idx=0;idx<rows.length;idx++){
    const row=rows[idx],a=row.action;
    if(row.commandId==='r29-opening'||commands.has(row.commandId))fail('duplicate or reserved command ID');
    if(a.atSimS<now)fail('accounting time reversed');now=a.atSimS;
    const legs:Leg[]=[],evidence:unknown[]=[];
    let serial=0;
    function use(...parts:(string|number)[]){const k=key(...parts);if(claims.has(k))fail('source already recognized');claims.add(k);}
    function at(t:number){if(now<t)fail('recognition before source event');}
    // Each R28 subcommand uses a generated identity, never caller-supplied
    // receipt or cash amount. All automatic interest receipts are journaled once.
    function liquid(event:unknown){
      const before=inspectLiquidityBook(liquidity).receipts.length;
      liquidity=applyLiquidityEvent(liquidity,{expectedRevision:liquidity.revision,commandId:'r29-'+idx+'-'+serial++,event});
      const delta=inspectLiquidityBook(liquidity).receipts.slice(before);
      for(const r of delta)if(r.type==='interest')post(legs,'interest','interest-payable',BigInt(r.interestExpenseMinor));
      return delta;
    }
    function cashIn(account:Account,n:bigint,category:'earned-revenue'|'subsidy'|'fine'|'resale',flow:Flow='operating'){
      if(!n)return;
      liquid({type:'receipt',atSimS:now,sourceId:'r29-in-'+idx+'-'+serial,category,amountMinor:money(n)});
      post(legs,'cash',account,n);flows[flow].in+=n;
    }
    function cashOut(account:Account,n:bigint,flow:Flow='operating'){
      if(!n)return;
      liquid({type:'expense',atSimS:now,sourceId:'r29-out-'+idx+'-'+serial,amountMinor:money(n)});
      post(legs,account,'cash',n);flows[flow].out+=n;
    }
    // One advance per action; even zero-money commands accrue due interest.
    liquid({type:'advance',atSimS:now});
    const before=captureTimeline?snapshot(inspectLiquidityBook(liquidity)):null;
    if(a.type==='advance'){}
    else if(a.type==='borrow'){
      liquid(a);const n=BigInt(a.principalMinor);post(legs,'cash','loan-principal',n);flows.financing.in+=n;
    }else if(a.type==='repay'){
      const r=liquid(a).find(x=>x.type==='repay')??fail('missing repayment receipt');
      if(r.type!=='repay')return fail('invalid repayment receipt');
      const p=BigInt(r.principalPaidMinor),i=BigInt(r.interestPaidMinor);
      post(legs,'loan-principal','cash',p);post(legs,'interest-payable','cash',i);flows.financing.out+=p;flows.operating.out+=i;
    }else if(a.type==='reserve-trip'||a.type==='settle-trip'){
      const t=c.d.trips.find(x=>x.tripId===a.tripId)??fail('unknown demand trip');
      const r=c.r.records.find(x=>x.terms.tripId===a.tripId)??fail('missing revenue terms');
      const er=c.energy.reservations.find(x=>x.id===a.tripId)??fail('missing energy reservation');
      if(a.type==='reserve-trip'){
        if(now!==t.dispatchSimS)fail('reservation must match dispatch time');
        if(row.payloadSha256===null&&(t.status!=='reserved'||r.closed||er.closed))fail('new reservation requires active source reservations');
        use('reserve',a.tripId);evidence.push(r.terms,r.binding,er.allocations);
        liquid({type:'reserve',atSimS:now,reservationId:a.tripId,amountMinor:a.amountMinor});
      }else{
        use('trip',a.tripId);
        const closed=r.closed??fail('trip revenue not settled'),en=er.closed??fail('energy not reconciled');
        const op=c.operations.receipts.find(x=>x.type==='trip'&&x.tripId===a.tripId);
        evidence.push(r,er);
        if(t.status==='released'){
          if(closed.evidence.arrivalSimS!==null)fail('cancellation sources mismatch');
          if(en.outcome==='released'&&!op){
            liquid({type:'close',atSimS:now,reservationId:a.tripId,outcome:'released',actualMinor:'0'});
          }else{
            // R35 safe-node abort: no realized delivery/revenue, but actual
            // traveled prefix, energy, access and crew cannot be erased.
            const oe=c.o.events.find(x=>x.type==='trip'&&x.trip.tripId===a.tripId);
            if(en.outcome!=='consumed'||!op||op.type!=='trip'||!oe||oe.type!=='trip')return fail('partial cancellation sources mismatch');
            if(oe.trip.departureSimS!==t.dispatchSimS||oe.trip.arrivalSimS!==now||oe.trip.settledAtSimS!==now||!same(oe.trip.stopIds,t.stopIds)||BigInt(oe.trip.distanceM)>=r.terms.segmentDistancesM.reduce((n,x)=>n+BigInt(x),0n))fail('invalid partial cancellation evidence');
            const tr=assets.get(op.trainId);if(!tr||tr.disposed)fail('train asset not registered or disposed');
            evidence.push(op,oe);
            const costs:[Expense,bigint][]=[['track',BigInt(op.trackMinor)],['terminal',BigInt(op.terminalMinor)],['crew',BigInt(op.crewMinor)]];
            const actual=costs.reduce((n,x)=>n+x[1],0n);
            liquid({type:'close',atSimS:now,reservationId:a.tripId,outcome:'settled',actualMinor:money(actual)});
            for(const [account,n] of costs)post(legs,account,'cash',n);
            flows.operating.out+=actual;
            for(const x of en.consumed){
              const l=lots.get(x.lotId)??fail('consumed lot not purchased in journal');
              l.usedCost+=BigInt(x.costMinor);l.usedQuantity+=BigInt(x.quantity);
              if(l.usedCost>l.cost||l.usedQuantity>l.quantity)fail('inventory consumption exceeds carrying lot');
            }
            post(legs,'energy-expense','energy-inventory',BigInt(en.totalCostMinor));
          }
        }else{
          if(t.status!=='served'||en.outcome!=='consumed'||!op||op.type!=='trip'||closed.evidence.arrivalSimS===null)return fail('trip sources not completed');
          const oe=c.o.events.find(x=>x.type==='trip'&&x.trip.tripId===a.tripId);
          if(!oe||oe.type!=='trip')return fail('missing operating event');
          if(oe.trip.departureSimS!==t.dispatchSimS||oe.trip.arrivalSimS!==closed.evidence.arrivalSimS||!same(oe.trip.stopIds,t.stopIds)||BigInt(oe.trip.distanceM)!==r.terms.segmentDistancesM.reduce((n,x)=>n+BigInt(x),0n))fail('trip identity or distance mismatch');
          at(oe.trip.settledAtSimS);evidence.push(op,oe);
          const tr=assets.get(op.trainId);if(!tr||tr.disposed)fail('train asset not registered or disposed');
          const z=closed.totals;
          cashIn('passenger-revenue',BigInt(z.passengerGrossMinor),'earned-revenue');
          cashIn('cargo-revenue',BigInt(z.cargoGrossMinor),'earned-revenue');
          const costs:[Expense,bigint][]=[['track',BigInt(op.trackMinor)],['terminal',BigInt(op.terminalMinor)],['crew',BigInt(op.crewMinor)],['refund',BigInt(z.passengerRefundMinor)],['delay',BigInt(z.delayPenaltyMinor)]];
          const actual=costs.reduce((n,x)=>n+x[1],0n);
          liquid({type:'close',atSimS:now,reservationId:a.tripId,outcome:'settled',actualMinor:money(actual)});
          for(const [account,n] of costs)post(legs,account,'cash',n);
          flows.operating.out+=actual;
          for(const x of en.consumed){
            const l=lots.get(x.lotId)??fail('consumed lot not purchased in journal');
            l.usedCost+=BigInt(x.costMinor);l.usedQuantity+=BigInt(x.quantity);
            if(l.usedCost>l.cost||l.usedQuantity>l.quantity)fail('inventory consumption exceeds carrying lot');
          }
          post(legs,'energy-expense','energy-inventory',BigInt(en.totalCostMinor));
        }
      }
    }else if(a.type==='buy-energy'){
      use('energy-lot',a.lotId);
      const l=c.energy.lots.find(x=>x.lot.id===a.lotId)??fail('unknown energy lot');
      // Original lot identity only; later consumption does not change this receipt.
      evidence.push({id:l.lot.id,unit:l.lot.energy.unit,quantity:l.originalQuantity,cost:l.originalCostMinor,source:l.source});
      const n=BigInt(l.originalCostMinor);
      cashOut('energy-inventory',n);lots.set(a.lotId,{cost:n,quantity:BigInt(l.originalQuantity),usedCost:0n,usedQuantity:0n});
    }else if(a.type==='write-off-energy'){
      // R31 liquidation only; the aggregate controller authorizes this action.
      // Use an actual R23/R24 closed reservation, no invented disposal cash.
      if(!a.reservationId.startsWith('r31:stock:')||c.d.trips.some(t=>t.tripId===a.reservationId)||c.r.records.some(t=>t.terms.tripId===a.reservationId))fail('invalid nontrip writeoff identity');
      use('energy-writeoff',a.reservationId);
      const e=c.energy.reservations.find(x=>x.id===a.reservationId)??fail('missing writeoff reservation');
      const n=e.closed??fail('writeoff reservation not closed');
      if(n.outcome!=='consumed'||!n.consumed.length||e.allocations.length!==n.consumed.length)fail('invalid writeoff consumption');
      for(let k=0;k<e.allocations.length;k++){
        const a=e.allocations[k],x=n.consumed[k];
        if(a.lotId!==x.lotId||a.unit!==x.unit||a.quantity!==x.quantity)fail('writeoff must consume full reservation');
        const l=lots.get(x.lotId)??fail('writeoff lot not purchased');
        l.usedCost+=BigInt(x.costMinor);l.usedQuantity+=BigInt(x.quantity);
        if(l.usedCost>l.cost||l.usedQuantity>l.quantity)fail('writeoff exceeds carrying lot');
      }
      evidence.push(e);
      post(legs,'energy-expense','energy-inventory',BigInt(n.totalCostMinor));
    }else if(a.type==='acquire-asset'){
      use('asset',a.trainId);
      const opening=c.o.opening.find(x=>x.train.id===a.trainId)??fail('unknown train');
      const conf=c.o.events.find(x=>x.type==='configure-maintenance'&&x.trainId===a.trainId);
      if(!conf||conf.type!=='configure-maintenance')return fail('missing asset acquisition terms');
      at(conf.atSimS);evidence.push(opening,conf);
      const n=BigInt(conf.asset.purchaseMinor);
      cashOut('train-assets',n,'investing');assets.set(a.trainId,{basis:n,accumulated:0n,disposed:false});
    }else if(a.type==='overhead'){
      use('overhead',a.periodIndex);
      const r=c.operations.receipts.find(x=>x.type==='overhead'&&x.periodIndex===a.periodIndex);
      const e=c.o.events.find(x=>x.type==='overhead'&&x.period.periodIndex===a.periodIndex);
      if(!r||r.type!=='overhead'||!e||e.type!=='overhead')return fail('missing staff overhead');
      at(e.period.settledAtSimS);evidence.push(r,e);cashOut('staff',BigInt(r.totalCostMinor));
    }else if(a.type==='maintenance'){
      use('maintenance',a.jobId);
      const r=c.operations.receipts.find(x=>x.type==='service-start'&&x.job.id===a.jobId);
      if(!r||r.type!=='service-start')return fail('missing service receipt');
      const tr=assets.get(r.job.trainId);if(!tr||tr.disposed)fail('train asset not registered or disposed');
      at(r.job.startS);evidence.push(r);cashOut('maintenance',BigInt(r.totalCostMinor));
    }else if(a.type==='depreciation'||a.type==='disposal'){
      const tr=assets.get(a.trainId)??fail('asset not registered');
      if(tr.disposed)fail('asset already disposed');
      const r=a.type==='depreciation'?c.operations.receipts.find(x=>x.type==='depreciation'&&x.trainId===a.trainId&&x.throughSimS===a.throughSimS):c.operations.receipts.find(x=>x.type==='disposal'&&x.trainId===a.trainId);
      if(!r||(r.type!=='depreciation'&&r.type!=='disposal'))return fail('missing asset receipt');
      const through=r.type==='depreciation'?r.throughSimS:r.disposedAtSimS;
      use(r.type,a.trainId,through);at(through);evidence.push(r);
      const n=BigInt(r.noncashExpenseMinor);tr.accumulated+=n;
      if(tr.basis!==BigInt(r.purchaseMinor)||tr.accumulated!==BigInt(r.accumulatedDepreciationMinor)||tr.basis-tr.accumulated!==BigInt(r.bookValueMinor))fail('asset depreciation reconciliation mismatch');
      post(legs,'depreciation','accumulated-depreciation',n);
      if(r.type==='disposal'){
        const proceeds=BigInt(r.resaleProceedsMinor),bv=tr.basis-tr.accumulated;
        // Debit accumulated depreciation, remove original basis, recognize gain/loss.
        // Cash receipt is posted against train-assets first, then adjust the residual.
        cashIn('train-assets',proceeds,'resale','investing');
        post(legs,'accumulated-depreciation','train-assets',tr.accumulated);
        if(proceeds>bv)post(legs,'train-assets','disposal-gain',proceeds-bv);
        else post(legs,'disposal-loss','train-assets',bv-proceeds);
        if(BigInt(r.disposalGainLossMinor)!==proceeds-bv)fail('disposal gain mismatch');
        tr.disposed=true;
      }
    }else if(a.type==='subsidy'||a.type==='fine'){
      use(a.type,a.tripId);
      if(!claims.has(key('trip',a.tripId)))fail('trip must be settled first');
      if(a.type==='subsidy'){
        const r=c.incentives.receipts.find(x=>x.type==='subsidy'&&x.tripId===a.tripId),e=c.i.events.find(x=>x.type==='subsidy'&&x.tripId===a.tripId);
        if(!r||r.type!=='subsidy'||!e)return fail('missing subsidy receipt');
        at(e.atSimS);evidence.push(r,e);cashIn('subsidy-revenue',BigInt(r.subsidyRevenueMinor),'subsidy');
      }else{
        const r=c.incentives.receipts.find(x=>x.type==='inspection'&&x.tripId===a.tripId),e=c.i.events.find(x=>x.type==='inspection'&&x.tripId===a.tripId);
        if(!r||r.type!=='inspection'||!e)return fail('missing fine receipt');
        at(e.atSimS);evidence.push(r,e);cashIn('fine-revenue',BigInt(r.fineRevenueMinor),'fine');
      }
    }else if(a.type==='campaign'){
      use('campaign',a.campaignId);
      const r=c.incentives.receipts.find(x=>x.type==='campaign'&&x.campaignId===a.campaignId),e=c.i.events.find(x=>x.type==='campaign'&&x.campaign.id===a.campaignId);
      if(!r||r.type!=='campaign'||!e)return fail('missing campaign receipt');
      at(e.atSimS);evidence.push(r,e);cashOut('marketing',BigInt(r.cashExpenseMinor));
    }else if(a.type==='reclassify'){
      const n=BigInt(a.amountMinor);
      if(a.from===a.to||n===0n||n>balance(a.from))fail('invalid expense reclassification');
      use('correction',a.reasonId);post(legs,a.to,a.from,n);
      reversible.set(row.commandId,{from:a.from,to:a.to,amount:n,reversed:false});
    }else if(a.type==='reverse'){
      const r=reversible.get(a.targetCommandId)??fail('source-backed transaction requires compensating source event');
      if(r.reversed||r.amount>balance(r.to))fail('reversal already applied or insufficient classification balance');
      use('correction',a.reasonId);post(legs,r.from,r.to,r.amount);r.reversed=true;
    }else return fail('unsupported action');
    const digestValue=await digest({commandId:row.commandId,action:a,evidence,postings:legs});
    if(row.payloadSha256!==null&&row.payloadSha256!==digestValue)fail('historical transaction evidence changed');
    const tx={commandId:row.commandId,action:a,payloadSha256:digestValue};
    commands.set(row.commandId,tx);
    if(legs.length)journal.push(decodeJournalEntry({eventId:'r29-'+idx,commandId:row.commandId,simTimeS:now,postings:legs,payloadSha256:digestValue}));
    const l=inspectLiquidityBook(liquidity);
    if(before)timeline.push({revision:idx+1,commandId:row.commandId,type:a.type,before,after:snapshot(l),repaymentClosed:a.type==='repay'?l.loans.find(x=>x.loan.id===a.loanId)?.status==='repaid':null});
    if(balance('cash')!==BigInt(l.cashMinor)||-balance('loan-principal')!==BigInt(l.principalOutstandingMinor)||-balance('interest-payable')!==BigInt(l.interestOutstandingMinor))fail('liquidity and journal mismatch');
    if(balance('energy-inventory')!==[...lots.values()].reduce((n,x)=>n+x.cost-x.usedCost,0n))fail('energy carrying value mismatch');
    const active=[...assets.values()].filter(x=>!x.disposed);
    if(balance('train-assets')!==active.reduce((n,x)=>n+x.basis,0n)||-balance('accumulated-depreciation')!==active.reduce((n,x)=>n+x.accumulated,0n))fail('asset carrying value mismatch');
    for(const b of balances.values())signed(b);
    if([...balances.values()].reduce((n,x)=>n+x,0n)!==0n)fail('unbalanced journal');
  }
  const l=inspectLiquidityBook(liquidity);
  const revenues=-balance('passenger-revenue')-balance('cargo-revenue')-balance('subsidy-revenue')-balance('fine-revenue');
  const operatingCosts=expenseAccounts.reduce((n,x)=>n+balance(x),0n);
  const margin=revenues-operatingCosts,operating=margin-balance('depreciation'),profit=operating-balance('interest')-balance('disposal-gain')-balance('disposal-loss');
  const cashFlow=(['operating','investing','financing'] as const).map(category=>({category,cashInMinor:money(flows[category].in),cashOutMinor:money(flows[category].out),netMinor:signed(flows[category].in-flows[category].out)}));
  const cashDelta=Object.values(flows).reduce((n,x)=>n+x.in-x.out,0n);
  if(BigInt(s.openingCashMinor)+cashDelta!==BigInt(l.cashMinor))fail('cash flow mismatch');
  const equity=balance('cash')+balance('energy-inventory')+balance('train-assets')+balance('accumulated-depreciation')+balance('loan-principal')+balance('interest-payable');
  if(equity!==BigInt(s.openingCashMinor)+profit)fail('equity reconciliation mismatch');
  // Current upstream may be ahead of the ledger while preparing a pure
  // candidate. Explicit completeness flags, not false balance claims.
  const pendingEnergyLots=c.energy.lots.filter(x=>!lots.has(x.lot.id)).map(x=>x.lot.id);
  const pendingEnergyReservations=c.energy.reservations.filter(x=>x.closed&&!claims.has(key('trip',x.id))&&!claims.has(key('energy-writeoff',x.id))).map(x=>x.id);
  const pendingTrips=c.r.records.filter(x=>x.closed&&!claims.has(key('trip',x.terms.tripId))).map(x=>x.terms.tripId);
  const pendingOperations=c.operations.receipts.filter(x=>{
    switch(x.type){case 'trip':return !claims.has(key('trip',x.tripId));case 'overhead':return !claims.has(key('overhead',x.periodIndex));case 'service-start':return !claims.has(key('maintenance',x.job.id));case 'depreciation':return !claims.has(key('depreciation',x.trainId,x.throughSimS));case 'disposal':return !claims.has(key('disposal',x.trainId,x.disposedAtSimS));default:return false;}
  }).length;
  const pendingIncentives=c.incentives.receipts.filter(x=>x.type==='subsidy'?!claims.has(key('subsidy',x.tripId)):x.type==='inspection'?!claims.has(key('fine',x.tripId)):!claims.has(key('campaign',x.campaignId))).length;
  const pendingAssets=c.o.events.filter(x=>x.type==='configure-maintenance'&&!assets.has(x.trainId)).length;
  if(pendingEnergyLots.length===0&&pendingEnergyReservations.length===0){
    const sourceCost=c.energy.lots.reduce((n,x)=>n+BigInt(x.lot.costMinor),0n);
    if(sourceCost!==balance('energy-inventory'))fail('source energy carrying balance mismatch');
    for(const x of c.energy.lots){const l=lots.get(x.lot.id)!;if(l.usedCost!==BigInt(x.consumedCostMinor)||l.usedQuantity!==BigInt(x.consumedQuantity))fail('source energy lot consumption mismatch');}
  }
  if(pendingAssets===0&&pendingOperations===0){
    for(const x of c.operations.maintenance){if(!x.asset)continue;const l=assets.get(x.trainId)??fail('missing asset');if(l.disposed!==(x.asset.disposedAtSimS!==null)||l.basis!==BigInt(x.asset.purchaseMinor)||l.accumulated!==BigInt(x.asset.accumulatedDepreciationMinor))fail('source asset balance mismatch');}
  }
  const out={...s,revision:commands.size,transactions:[...commands.values()]};
  return {book:out,initial,timeline,view:{revision:out.revision,sourceVersions:c.versions,journal,liquidity,liquidityView:l,balances:accounts.map(accountId=>({accountId,debitBalanceMinor:signed(balance(accountId))})),revenueMinor:money(revenues),operatingCostsMinor:money(operatingCosts),operatingMarginMinor:signed(margin),operatingProfitMinor:signed(operating),accountingProfitMinor:signed(profit),equityMinor:signed(equity),cashFlow,pending:{energyLots:pendingEnergyLots,energyReservations:pendingEnergyReservations,trips:pendingTrips,operations:pendingOperations,incentives:pendingIncentives,assets:pendingAssets}}};
}
export async function createAccountingBook(openingCashMinor:unknown,startSimS:unknown,policy:unknown,c:AccountingSources):Promise<AccountingBook>{
  return decodeAccountingBook({schemaVersion:1,revision:0,openingCashMinor,startSimS,policy,transactions:[]},c);
}
export async function decodeAccountingBook(input:unknown,c:AccountingSources):Promise<AccountingBook>{return freeze((await replay(book(input),sources(c))).book);}
export async function inspectAccountingBook(input:unknown,c:AccountingSources){return freeze((await replay(book(input),sources(c))).view);}
/** R31 opt-in timeline, generated only from validated R29 replay.
 * Before = after the automatic R28 clock advance but before the action.
 * After = committed candidate effect. Never trusts externally supplied metrics. */
export async function inspectAccountingTimeline(input:unknown,c:AccountingSources){
  const x=await replay(book(input),sources(c),undefined,true);
  return freeze({book:x.book,initial:x.initial??fail('missing initial snapshot'),timeline:x.timeline,view:x.view});
}
export async function applyAccountingCommand(input:unknown,c:AccountingSources,cmd:unknown):Promise<AccountingBook>{
  const q=command(cmd),s=book(input),ctx=sources(c);
  const old=s.transactions.find(x=>x.commandId===q.commandId);
  if(old){if(!same(old.action,q.action))fail('command ID conflict');return decodeAccountingBook(s,c);}
  if(s.revision!==q.expectedRevision||!same(q.expectedSources,ctx.versions))fail('STALE_ACCOUNTING_OR_SOURCE_REVISION');
  if(s.transactions.length>=10000)fail('accounting history limit');
  return freeze((await replay(s,ctx,{commandId:q.commandId,action:q.action})).book);
}

/** Half-open simulation-time reporting: [start,end), independent of calendar
 * or modulo boundaries. Opening equity is not income. Same-time events all
 * belong to the same interval. R32 must schedule actual period/tax events;
 * this function does not invent a tax rule or reuse legacy CEO tax code. */
export async function reportAccountingPeriod(input:unknown,c:AccountingSources,range:unknown){
  const q=object({startSimS:seconds,endSimS:seconds})(range),s=book(input),x=await inspectAccountingBook(s,c);
  if(q.startSimS<s.startSimS||q.endSimS<=q.startSimS)fail('invalid reporting interval');
  const revenueAccounts=new Set<string>(['passenger-revenue','cargo-revenue','subsidy-revenue','fine-revenue']);
  const operatingAccounts=new Set<string>(expenseAccounts);
  let opening=BigInt(s.openingCashMinor),net=0n,revenue=0n,cost=0n,depreciation=0n,interest=0n,gainLoss=0n;
  for(const j of x.journal){
    if(j.eventId==='r29-opening')continue;
    if(j.simTimeS>=q.endSimS)continue;
    for(const p of j.postings){
      const n=BigInt(p.debitMinor)-BigInt(p.creditMinor);
      if(j.simTimeS<q.startSimS){if(p.accountId==='cash')opening+=n;continue;}
      if(p.accountId==='cash')net+=n;
      else if(revenueAccounts.has(p.accountId))revenue-=n;
      else if(operatingAccounts.has(p.accountId))cost+=n;
      else if(p.accountId==='depreciation')depreciation+=n;
      else if(p.accountId==='interest')interest+=n;
      else if(p.accountId==='disposal-gain'||p.accountId==='disposal-loss')gainLoss-=n;
    }
  }
  return freeze({...q,asOfSimS:x.liquidityView.simTimeS,complete:q.endSimS<=x.liquidityView.simTimeS,openingCashMinor:money(opening),closingCashMinor:money(opening+net),cashFlowNetMinor:signed(net),revenueMinor:signed(revenue),operatingCostsMinor:signed(cost),depreciationMinor:signed(depreciation),interestMinor:signed(interest),disposalGainLossMinor:signed(gainLoss),accountingProfitMinor:signed(revenue-cost-depreciation-interest+gainLoss)});
}
