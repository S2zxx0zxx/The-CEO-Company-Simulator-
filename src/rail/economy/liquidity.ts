// R28 E20/E21: fictional game financing and cash liquidity, not bank products.
// The single replay projection is a pure transaction candidate for R29/R34/R39.
import { decodeLoan } from '../../domain/models';
import { integer, minor, seconds, basisPoints } from '../../domain/units';
import { object, list, id, enumeration, refine, record, version1, type Decoded } from '../../domain/validation';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Liquidity: '+s);};
const money=(n:bigint)=>minor(String(n));
const min=(a:bigint,b:bigint)=>a<b?a:b;
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const positive=refine(minor,n=>n!=='0','positive amount required');
const period=refine(seconds,n=>n>0,'positive period required');
function freeze<T>(v:T):ReadonlyTree<T>{
  if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}
  return v as ReadonlyTree<T>;
}
const policy=object({creditLimitMinor:minor,maxInterestBps:basisPoints,interestPeriodS:period,maxTermS:period});
const clock=object({type:enumeration(['advance']),atSimS:seconds});
const borrow=object({type:enumeration(['borrow']),atSimS:seconds,loanId:id,principalMinor:positive,maturityS:seconds,interestBps:basisPoints});
const repay=object({type:enumeration(['repay']),atSimS:seconds,loanId:id,amountMinor:positive});
const reserve=object({type:enumeration(['reserve']),atSimS:seconds,reservationId:id,amountMinor:minor});
const close=refine(object({type:enumeration(['close']),atSimS:seconds,reservationId:id,outcome:enumeration(['settled','released']),actualMinor:minor}),e=>e.outcome!=='released'||e.actualMinor==='0','release must not charge expense');
const receipt=object({type:enumeration(['receipt']),atSimS:seconds,sourceId:id,category:enumeration(['earned-revenue','subsidy','fine','resale','equity']),amountMinor:positive});
const expense=object({type:enumeration(['expense']),atSimS:seconds,sourceId:id,amountMinor:positive});
function event(input:unknown,path='event'){
  const r=record(input,path);
  if(r.type==='advance')return clock(input,path);
  if(r.type==='borrow')return borrow(input,path);
  if(r.type==='repay')return repay(input,path);
  if(r.type==='reserve')return reserve(input,path);
  if(r.type==='close')return close(input,path);
  if(r.type==='receipt')return receipt(input,path);
  if(r.type==='expense')return expense(input,path);
  return fail('unknown event');
}
const entry=object({commandId:id,event});
const book=object({schemaVersion:version1,revision:integer,openingCashMinor:minor,startSimS:seconds,policy,entries:list(entry,0,10000)});
const cmd=object({expectedRevision:integer,commandId:id,event});
type Book=Decoded<typeof book>;
type LoanTerms=Decoded<typeof decodeLoan>;
type RuntimeLoan={terms:LoanTerms;principal:bigint;interest:bigint;interestRecognized:bigint;interestPaid:bigint;principalPaid:bigint;cursor:number;lastBoundary:number;pendingNumerator:bigint;closedAtSimS:number|null};
type Reservation={id:string;amountMinor:string;closed:null|{outcome:'settled'|'released';actualMinor:string;releasedMinor:string;additionalMinor:string}};
export type LiquidityBook=ReadonlyTree<Book>;
// Explicit discriminated type includes accruals pushed by nested recognize().
export type LiquidityReceipt=
  | {type:'interest';commandId:string;loanId:string;throughSimS:number;interestExpenseMinor:string;cashExpenseMinor:string}
  | {type:'borrow';commandId:string;loanId:string;principalReceivedMinor:string}
  | {type:'repay';commandId:string;loanId:string;principalPaidMinor:string;interestPaidMinor:string;cashOutMinor:string}
  | {type:'reservation-close';commandId:string;reservationId:string;outcome:'settled'|'released';actualMinor:string;releasedMinor:string;additionalMinor:string;cashExpenseMinor:string}
  | {type:'receipt';commandId:string;sourceId:string;category:Decoded<typeof receipt>['category'];cashInMinor:string}
  | {type:'expense';commandId:string;sourceId:string;cashExpenseMinor:string};
/** E20 simple noncompounding interest per explicit scenario period, accrued on
 * outstanding principal-time, not on accrued interest. Accrual stops at maturity
 * (no invented default penalty). Carry fractional paise until the next recognition.
 * A repayment crystallizes the partial period through its timestamp. */
function replay(input:unknown){
  const s=book(input),p=s.policy;
  if(s.revision!==s.entries.length)fail('revision does not match history');
  const den=BigInt(p.interestPeriodS)*10000n;
  let cash=BigInt(s.openingCashMinor),locked=0n,now=Number(s.startSimS);
  const loans=new Map<string,RuntimeLoan>(),reservations=new Map<string,Reservation>();
  const commands=new Set<string>(),sources=new Set<string>();
  const receipts:LiquidityReceipt[]=[];
  function free(){return cash-locked;}
  function pay(n:bigint){if(n>free())fail('insufficient available cash');cash-=n;}
  function recognize(l:RuntimeLoan,to:number,commandId:string){
    if(to<l.cursor)fail('loan accrual time reversed');
    l.pendingNumerator+=l.principal*BigInt(l.terms.interestBps)*BigInt(to-l.cursor);
    l.cursor=to;
    const n=l.pendingNumerator/den;l.pendingNumerator%=den;
    l.interest+=n;l.interestRecognized+=n;
    money(l.interest);money(l.interestRecognized);
    if(n>0n)receipts.push({type:'interest' as const,commandId,loanId:l.terms.id,throughSimS:to,interestExpenseMinor:money(n),cashExpenseMinor:money(0n)});
  }
  function advance(at:number,commandId:string){
    if(at<now)fail('simulation time reversed');
    for(const l of loans.values()){
      if(l.closedAtSimS!==null)continue;
      const end=Math.min(at,l.terms.maturityS);
      const periods=(BigInt(end)-BigInt(l.terms.openedS))/BigInt(p.interestPeriodS);
      const boundary=end===l.terms.maturityS?end:Number(BigInt(l.terms.openedS)+periods*BigInt(p.interestPeriodS));
      if(boundary>l.lastBoundary){
        if(boundary>l.cursor)recognize(l,boundary,commandId);
        l.lastBoundary=boundary;
      }
    }
    now=at;
  }
  function principalTotal(){return [...loans.values()].reduce((n,l)=>n+l.principal,0n);}
  for(const x of s.entries){
    const e=x.event;
    if(commands.has(x.commandId))fail('duplicate command');
    commands.add(x.commandId);advance(e.atSimS,x.commandId);
    if(e.type==='advance')continue;
    if(e.type==='borrow'){
      if(loans.has(e.loanId))fail('duplicate loan');
      if(e.interestBps>p.maxInterestBps||e.maturityS<=now||e.maturityS-now>p.maxTermS)fail('loan terms exceed policy');
      if([...loans.values()].some(l=>l.closedAtSimS===null&&now>=l.terms.maturityS))fail('overdue debt blocks borrowing');
      const n=BigInt(e.principalMinor);
      if(principalTotal()+n>BigInt(p.creditLimitMinor))fail('credit limit exceeded');
      const terms=decodeLoan({id:e.loanId,principalMinor:e.principalMinor,remainingMinor:e.principalMinor,openedS:now,maturityS:e.maturityS,interestBps:e.interestBps});
      cash+=n;money(cash);
      loans.set(e.loanId,{terms,principal:n,interest:0n,interestRecognized:0n,interestPaid:0n,principalPaid:0n,cursor:now,lastBoundary:now,pendingNumerator:0n,closedAtSimS:null});
      receipts.push({type:'borrow' as const,commandId:x.commandId,loanId:e.loanId,principalReceivedMinor:e.principalMinor});
    }else if(e.type==='repay'){
      const l=loans.get(e.loanId)??fail('unknown loan');
      if(l.closedAtSimS!==null)fail('loan already repaid');
      const end=Math.min(now,l.terms.maturityS);
      recognize(l,end,x.commandId);
      const n=BigInt(e.amountMinor);
      if(n>l.principal+l.interest)fail('repayment exceeds debt');
      pay(n);
      const interest=min(n,l.interest),principal=n-interest;
      l.interest-=interest;l.principal-=principal;l.interestPaid+=interest;l.principalPaid+=principal;
      if(l.principal===0n&&l.interest===0n){l.closedAtSimS=now;l.pendingNumerator=0n;}
      receipts.push({type:'repay' as const,commandId:x.commandId,loanId:e.loanId,principalPaidMinor:money(principal),interestPaidMinor:money(interest),cashOutMinor:e.amountMinor});
    }else if(e.type==='reserve'){
      if(reservations.has(e.reservationId))fail('duplicate reservation');
      const n=BigInt(e.amountMinor);
      if(n>free())fail('insufficient available cash');
      locked+=n;
      reservations.set(e.reservationId,{id:e.reservationId,amountMinor:e.amountMinor,closed:null});
    }else if(e.type==='close'){
      const r=reservations.get(e.reservationId)??fail('unknown reservation');
      if(r.closed)fail('reservation already closed');
      const n=BigInt(e.actualMinor),reserved=BigInt(r.amountMinor);
      // Release this reservation only, never raid another reservation.
      locked-=reserved;pay(n);
      const released=reserved>n?reserved-n:0n,additional=n>reserved?n-reserved:0n;
      r.closed={outcome:e.outcome,actualMinor:e.actualMinor,releasedMinor:money(released),additionalMinor:money(additional)};
      receipts.push({type:'reservation-close' as const,commandId:x.commandId,reservationId:r.id,...r.closed,cashExpenseMinor:e.actualMinor});
    }else{
      // Source receipts are explicitly trusted candidates, not a mint endpoint.
      // R29 verifies corresponding unique journal event/earned receipt atomically.
      if(sources.has(e.sourceId))fail('duplicate cash source');
      sources.add(e.sourceId);
      if(e.type==='receipt'){
        cash+=BigInt(e.amountMinor);money(cash);
        receipts.push({type:'receipt' as const,commandId:x.commandId,sourceId:e.sourceId,category:e.category,cashInMinor:e.amountMinor});
      }else{
        pay(BigInt(e.amountMinor));
        receipts.push({type:'expense' as const,commandId:x.commandId,sourceId:e.sourceId,cashExpenseMinor:e.amountMinor});
      }
    }
    money(cash);money(locked);money(free());
  }
  const loanRows=[...loans.values()].sort((a,b)=>order(a.terms.id,b.terms.id)).map(l=>{
    const end=Math.min(now,l.terms.maturityS);
    // Unrecognized stub is an informational payoff estimate, not a second expense.
    const stub=l.closedAtSimS===null?(l.pendingNumerator+l.principal*BigInt(l.terms.interestBps)*BigInt(end-l.cursor))/den:0n;
    return {loan:decodeLoan({...l.terms,remainingMinor:money(l.principal)}),status:l.closedAtSimS!==null?'repaid':now>=l.terms.maturityS?'matured-unpaid':'active',interestOutstandingMinor:money(l.interest),interestRecognizedMinor:money(l.interestRecognized),interestPaidMinor:money(l.interestPaid),principalPaidMinor:money(l.principalPaid),unrecognizedInterestMinor:money(stub),payoffMinor:money(l.principal+l.interest+stub),closedAtSimS:l.closedAtSimS};
  });
  const principal=principalTotal(),interest=loans.size===0?0n:[...loans.values()].reduce((n,l)=>n+l.interest,0n);
  const payoff=loanRows.reduce((n,l)=>n+BigInt(l.payoffMinor),0n);
  return {book:s,view:{revision:s.revision,simTimeS:now,cashMinor:money(cash),reservedCashMinor:money(locked),availableCashMinor:money(free()),principalOutstandingMinor:money(principal),interestOutstandingMinor:money(interest),totalDebtMinor:money(principal+interest),totalPayoffMinor:money(payoff),remainingCreditMinor:money(BigInt(p.creditLimitMinor)-principal),loans:loanRows,reservations:[...reservations.values()],receipts}};
}
export function createLiquidityBook(openingCashMinor:unknown,startSimS:unknown,policyInput:unknown):LiquidityBook{
  return decodeLiquidityBook({schemaVersion:1,revision:0,openingCashMinor,startSimS,policy:policyInput,entries:[]});
}
export function decodeLiquidityBook(input:unknown):LiquidityBook{return freeze(replay(input).book);}
export function inspectLiquidityBook(input:unknown){return freeze(replay(input).view);}
/** Identical retry returns the prior immutable book even if revision is stale;
 * conflicting command ID rejects. An unseen command requires current revision.
 * This is pure replay, not actual persistent CAS or journal authorization. */
export function applyLiquidityEvent(input:unknown,command:unknown):LiquidityBook{
  const q=cmd(command),s=replay(input).book;
  const prior=s.entries.find(x=>x.commandId===q.commandId);
  if(prior){
    if(JSON.stringify(prior.event)!==JSON.stringify(q.event))fail('command ID conflict');
    return freeze(s);
  }
  if(q.expectedRevision!==s.revision)fail('STALE_LIQUIDITY_REVISION');
  s.entries.push({commandId:q.commandId,event:q.event});s.revision++;
  return decodeLiquidityBook(s);
}
