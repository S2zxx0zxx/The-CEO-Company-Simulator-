// R24 E11: original seeded scenario market. All prices are game inputs, not live tariffs.
import { integer, minor, energyQuantity, seconds, basisPoints, MAX_INTEGER } from '../../domain/units';
import { object, list, distinct, enumeration, id, refine, nullable, record, version1, type Decoded } from '../../domain/validation';
import { decodeEnergyBook, inspectEnergyBook } from './energy';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Market: '+s);};
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const unit=enumeration(['Wh','mL','g']);
type Unit=Decoded<typeof unit>;
const positive=refine(energyQuantity,q=>q!=='0','positive quantity required');
const positiveSeconds=refine(seconds,n=>n>0,'positive period required');
const seed=(v:unknown,p?:string)=>integer(v,p,1,4294967295);
const money=(n:bigint)=>minor(String(n));
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
function freeze<T>(v:T):ReadonlyTree<T>{
  if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}
  return v as ReadonlyTree<T>;
}
const marketRule=refine(object({unit,priceQuantity:positive,minPriceMinor:minor,meanPriceMinor:minor,maxPriceMinor:minor,initialPriceMinor:minor,reversionBps:basisPoints,shockAmplitudeMinor:minor,contractDiscountBps:basisPoints}),r=>BigInt(r.minPriceMinor)<=BigInt(r.meanPriceMinor)&&BigInt(r.meanPriceMinor)<=BigInt(r.maxPriceMinor)&&BigInt(r.minPriceMinor)<=BigInt(r.initialPriceMinor)&&BigInt(r.initialPriceMinor)<=BigInt(r.maxPriceMinor),'price bounds inconsistent');
const config=object({startSimS:seconds,periodS:positiveSeconds,seed,maxContractDurationS:positiveSeconds,rules:distinct(list(marketRule,1,3),r=>r.unit)});
const amount=object({unit,quantity:positive});
const amounts=distinct(list(amount,0,3),a=>a.unit);
const advance=object({type:enumeration(['advance']),targetSimS:seconds});
const contract=object({type:enumeration(['contract']),contractId:id,unit,quantity:positive,expiresAtSimS:seconds});
const purchase=object({type:enumeration(['purchase']),lotId:id,unit,quantity:positive,contractId:nullable(id),availableCashMinor:minor});
const reserve=object({type:enumeration(['reserve']),reservationId:id,requirements:amounts});
const close=refine(object({type:enumeration(['close']),reservationId:id,outcome:enumeration(['consumed','released']),actual:amounts}),e=>e.outcome!=='released'||e.actual.length===0,'release cannot consume energy');
function action(input:unknown,path='action'){
  const r=record(input,path);
  if(r.type==='advance')return advance(input,path);
  if(r.type==='contract')return contract(input,path);
  if(r.type==='purchase')return purchase(input,path);
  if(r.type==='reserve')return reserve(input,path);
  if(r.type==='close')return close(input,path);
  return fail('unknown market action');
}
const book=object({schemaVersion:version1,revision:integer,config,capacity:amounts,actions:list(action,0,10000)});
const command=object({expectedRevision:integer,action});
type Book=Decoded<typeof book>;
type Rule=Decoded<typeof marketRule>;
type ContractTerms={id:string;unit:Unit;quantity:string;totalPriceMinor:string;issuedAtSimS:number;expiresAtSimS:number;spotPriceMinor:string;spotPriceQuantity:string;discountBps:number};
export type EnergyMarketBook=ReadonlyTree<Book>;
const sortUnits=<T extends {unit:Unit}>(a:T[])=>a.sort((x,y)=>order(x.unit,y.unit));
function canonical(s:Book){
  sortUnits(s.config.rules);sortUnits(s.capacity);
  for(const a of s.actions){if(a.type==='reserve')sortUnits(a.requirements);if(a.type==='close')sortUnits(a.actual);}
  return s;
}
/** Version-1 xorshift32, nonzero seed, stable unit order per scheduled tick.
 * A scaled uint32 maps to a bounded signed shock; no ambient time/random.
 * Reversion uses signed truncation toward zero; final result clamps exactly. */
function nextSeed(s:number):number{
  s^=s<<13;s^=s>>>17;s^=s<<5;return s>>>0;
}
function nextPrice(p:bigint,r:Rule,rng:number):bigint{
  const amp=BigInt(r.shockAmplitudeMinor),shock=BigInt(rng)*(amp*2n+1n)/4294967296n-amp;
  const x=p+(BigInt(r.meanPriceMinor)-p)*BigInt(r.reversionBps)/10000n+shock;
  const lo=BigInt(r.minPriceMinor),hi=BigInt(r.maxPriceMinor);
  return x<lo?lo:x>hi?hi:x;
}
function replay(input:unknown){
  const s=canonical(book(input)),c=s.config;
  if(s.revision!==s.actions.length)fail('revision does not match action history');
  const rules=new Map(c.rules.map(r=>[r.unit,r]));
  const prices=new Map(c.rules.map(r=>[r.unit,BigInt(r.initialPriceMinor)]));
  const history=c.rules.map(r=>({unit:r.unit,priceQuantity:r.priceQuantity,points:[{simTimeS:Number(c.startSimS),priceMinor:r.initialPriceMinor}]}));
  const terms=new Map<string,ContractTerms>();
  const events:unknown[]=[];
  let simTimeS=Number(c.startSimS),tick=0,rng=c.seed;
  const tickAt=(n:number)=>BigInt(c.startSimS)+BigInt(c.periodS)*BigInt(n);
  for(const a of s.actions){
    if(a.type==='advance'){
      if(a.targetSimS<=simTimeS)fail('simulation time must strictly advance');
      const targetTicks=(BigInt(a.targetSimS)-BigInt(c.startSimS))/BigInt(c.periodS);
      if(targetTicks>10000n)fail('market tick history limit');
      while(BigInt(tick)<targetTicks){
        tick++;const time=Number(tickAt(tick));
        for(let i=0;i<c.rules.length;i++){
          const r=c.rules[i];rng=nextSeed(rng);
          const price=nextPrice(prices.get(r.unit)!,r,rng);prices.set(r.unit,price);
          history[i].points.push({simTimeS:time,priceMinor:money(price)});
        }
      }
      simTimeS=a.targetSimS;
    }else if(a.type==='contract'){
      if(terms.has(a.contractId))fail('duplicate contract ID');
      if(a.expiresAtSimS<=simTimeS||a.expiresAtSimS-simTimeS>c.maxContractDurationS)fail('invalid contract expiry');
      const r=rules.get(a.unit)??fail('market unit unavailable');
      const p=prices.get(a.unit)!;
      const total=money(ceil(BigInt(a.quantity)*p*(10000n-BigInt(r.contractDiscountBps)),BigInt(r.priceQuantity)*10000n));
      const t:ContractTerms={id:a.contractId,unit:a.unit,quantity:a.quantity,totalPriceMinor:total,issuedAtSimS:simTimeS,expiresAtSimS:a.expiresAtSimS,spotPriceMinor:money(p),spotPriceQuantity:r.priceQuantity,discountBps:r.contractDiscountBps};
      terms.set(t.id,t);
      events.push({type:'register-contract',contract:{id:t.id,unit:t.unit,quantity:t.quantity,remainingQuantity:t.quantity,totalPriceMinor:t.totalPriceMinor}});
    }else if(a.type==='purchase'){
      const r=rules.get(a.unit)??fail('market unit unavailable');
      let source:unknown;
      if(a.contractId===null)source={kind:'spot',contractId:null,priceMinor:money(prices.get(a.unit)!),priceQuantity:r.priceQuantity};
      else{
        const t=terms.get(a.contractId)??fail('unknown contract');
        if(t.unit!==a.unit)fail('contract unit mismatch');
        if(simTimeS>=t.expiresAtSimS)fail('contract expired');
        source={kind:'contract',contractId:t.id,priceMinor:t.totalPriceMinor,priceQuantity:t.quantity};
      }
      events.push({type:'purchase',lotId:a.lotId,energy:{unit:a.unit,quantity:a.quantity},source,availableCashMinor:a.availableCashMinor});
    }else events.push(a);
  }
  // The only inventory and carrying-cost authority is R23. Do not duplicate its
  // quantity or monetary transition logic in market history. Every action replay
  // produces a single canonical energy book and validates the full event stream.
  const energy=decodeEnergyBook({schemaVersion:1,revision:events.length,capacity:s.capacity,contracts:[],events});
  const inventory=inspectEnergyBook(energy);
  const contracts=inventory.contracts.map(x=>{
    const t=terms.get(x.id)??fail('missing market contract');
    const status=x.remainingQuantity==='0'?'exhausted':simTimeS>=t.expiresAtSimS?'expired':'active';
    return {...t,remainingQuantity:x.remainingQuantity,drawableQuantity:status==='active'?x.remainingQuantity:'0',status};
  });
  const next=tickAt(tick+1);
  const nextUpdateSimS=next>BigInt(MAX_INTEGER)||tick===10000?null:Number(next);
  return {book:s,view:{revision:s.revision,simTimeS,tick,rngState:rng,nextUpdateSimS,secondsUntilUpdate:nextUpdateSimS===null?null:nextUpdateSimS-simTimeS,prices:c.rules.map(r=>({unit:r.unit,priceQuantity:r.priceQuantity,priceMinor:money(prices.get(r.unit)!)})),history,contracts,energy,inventory}};
}
/** Market book is the authoritative history of timed procurement actions; R23
 * inventory is a derived immutable projection. Contract activation is a locked
 * purchase commitment, not prepaid stock; actual draws pay the R23 lot cost.
 * Cash/obligation settlement and trusted simulation time are R29/R34/R39. */
export function createEnergyMarket(config:unknown,capacity:unknown):EnergyMarketBook{
  return decodeEnergyMarket({schemaVersion:1,revision:0,config,capacity,actions:[]});
}
export function decodeEnergyMarket(input:unknown):EnergyMarketBook{return freeze(replay(input).book);}
export function inspectEnergyMarket(input:unknown){return freeze(replay(input).view);}
export function applyMarketAction(input:unknown,cmd:unknown):EnergyMarketBook{
  const q=command(cmd),s=replay(input).book;
  if(s.revision!==q.expectedRevision)fail('STALE_MARKET_REVISION');
  s.actions.push(q.action);s.revision++;
  return decodeEnergyMarket(s);
}
