// R23: deterministic game-energy contracts; no real-world coefficients supplied.
import { decodeEnergyAmount, decodeEnergyContract, decodeEnergyLot } from '../../domain/models';
import { integer, minor, energyQuantity, metres, seconds, basisPoints } from '../../domain/units';
import { object, list, distinct, enumeration, id, refine, nullable, record, version1, type Decoded } from '../../domain/validation';
import type { RollingStockCatalog } from '../catalog';
import type { ReadonlyTree } from '../graph';

const fail=(s:string):never=>{throw new TypeError('Energy: '+s);};
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const unit=enumeration(['Wh','mL','g']);
type Unit=Decoded<typeof unit>;
const mode=enumeration(['diesel','electric','steam']);
const positive=refine(energyQuantity,n=>n!=='0','positive quantity required');
const factor=(v:unknown,p?:string)=>integer(v,p,1,100000);
const qty=(v:bigint)=>energyQuantity(String(v));
const money=(v:bigint)=>minor(String(v));
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
const min=(a:bigint,b:bigint)=>a<b?a:b;
function freeze<T>(v:T):ReadonlyTree<T>{
  if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}
  return v as ReadonlyTree<T>;
}
const segment=object({mode,distanceM:metres,runningS:seconds,idleS:seconds,loadFactorBps:factor,gradeFactorBps:factor,idleQuantityPerHour:energyQuantity,auxQuantityPerHour:energyQuantity,requestedRegenWh:energyQuantity,maxRegenBps:basisPoints});
/** E08/E09: nominal per-km rate from exact catalog revision, explicit scenario
 * load/consist and grade factors, idle and auxiliary per-hour quantities.
 * Each segment rounds traction and combined stationary/aux draw up; regeneration
 * rounds down, bounded by requested recovery and fraction of traction only.
 * Missing nominal is an error, not zero. No sale/export of electricity. */
export function estimateEnergy(catalog:RollingStockCatalog,reference:unknown,input:unknown){
  const e=catalog.resolve(reference),segments=list(segment,1,100000)(input);
  if(!('energyPerKm' in e))return fail('unpowered stock has no independent energy model');
  const rows=segments.map(s=>{
    const nominal=e.energyPerKm.find(n=>n.mode===s.mode)??fail('missing nominal rate for mode');
    if(s.distanceM>0&&s.runningS===0)fail('moving segment requires running time');
    if(s.mode!=='electric'&&(s.requestedRegenWh!=='0'||s.maxRegenBps!==0))fail('regeneration requires electric mode');
    const traction=ceil(BigInt(nominal.quantityPerKm)*BigInt(s.distanceM)*BigInt(s.loadFactorBps)*BigInt(s.gradeFactorBps),100000000000n);
    const aux=ceil(BigInt(s.idleQuantityPerHour)*BigInt(s.idleS)+BigInt(s.auxQuantityPerHour)*(BigInt(s.runningS)+BigInt(s.idleS)),3600n);
    const regen=min(BigInt(s.requestedRegenWh),traction*BigInt(s.maxRegenBps)/10000n);
    return {mode:s.mode,unit:nominal.unit,traction:qty(traction),idleAndAux:qty(aux),regenerated:qty(regen),net:qty(traction+aux-regen)};
  });
  const sums=new Map<Unit,bigint>();
  for(const r of rows)sums.set(r.unit,(sums.get(r.unit)??0n)+BigInt(r.net));
  return freeze({segments:rows,energy:[...sums].filter(([,n])=>n>0n).sort((a,b)=>order(a[0],b[0])).map(([unit,n])=>decodeEnergyAmount({unit,quantity:qty(n)}))});
}
const amount=object({unit,quantity:positive});
const amounts=distinct(list(amount,0,3),v=>v.unit);
const source=refine(object({kind:enumeration(['spot','contract']),contractId:nullable(id),priceMinor:minor,priceQuantity:positive}),s=>(s.kind==='contract')===(s.contractId!==null),'source identity mismatch');
const registerContract=object({type:enumeration(['register-contract']),contract:decodeEnergyContract});
const purchase=object({type:enumeration(['purchase']),lotId:id,energy:amount,source,availableCashMinor:minor});
const reserve=object({type:enumeration(['reserve']),reservationId:id,requirements:amounts});
const close=refine(object({type:enumeration(['close']),reservationId:id,outcome:enumeration(['consumed','released']),actual:amounts}),e=>e.outcome!=='released'||e.actual.length===0,'release cannot consume energy');
function event(input:unknown,path='event'){
  const r=record(input,path);
  if(r.type==='register-contract')return registerContract(input,path);
  if(r.type==='purchase')return purchase(input,path);
  if(r.type==='reserve')return reserve(input,path);
  if(r.type==='close')return close(input,path);
  return fail('unknown inventory event');
}
const book=object({schemaVersion:version1,revision:integer,capacity:amounts,contracts:distinct(list(decodeEnergyContract,0,10000),c=>c.id),events:list(event,0,10000)});
type Book=Decoded<typeof book>;
type Event=Decoded<typeof event>;
type Source=Decoded<typeof source>;
type Allocation={lotId:string;unit:Unit;quantity:string};
type Consumption=Allocation&{costMinor:string};
type Lot={id:string;unit:Unit;original:bigint;cost:bigint;used:bigint;reserved:bigint;source:Source};
type Reservation={id:string;allocations:Allocation[];closed:null|{outcome:'consumed'|'released';consumed:Consumption[];totalCostMinor:string}};
export type EnergyBook=ReadonlyTree<Book>;
const command=object({expectedRevision:integer,event});
const orderedAmounts=<T extends {unit:Unit}>(a:T[])=>a.sort((x,y)=>order(x.unit,y.unit));
function canonical(s:Book){
  orderedAmounts(s.capacity);s.contracts.sort((a,b)=>order(a.id,b.id));
  for(const e of s.events){if(e.type==='reserve')orderedAmounts(e.requirements);if(e.type==='close')orderedAmounts(e.actual);}
  return s;
}
function replay(input:unknown){
  const s=canonical(book(input));
  if(s.revision!==s.events.length)fail('revision does not match event history');
  const capacities=new Map(s.capacity.map(x=>[x.unit,BigInt(x.quantity)]));
  const stock=new Map<Unit,bigint>();
  const contracts=new Map(s.contracts.map(c=>[c.id,{terms:c,drawn:0n}]));
  for(const c of s.contracts)if(c.remainingQuantity!==c.quantity)fail('opening contract must have full unused quantity');
  const lots=new Map<string,Lot>(),reservations=new Map<string,Reservation>();
  const unitLots=new Map<Unit,Lot[]>();
  for(const e of s.events){
    if(e.type==='register-contract'){
      const c=e.contract;
      if(contracts.has(c.id))fail('duplicate energy contract');
      if(c.remainingQuantity!==c.quantity)fail('new contract must have full unused quantity');
      if(contracts.size>=10000)fail('contract count limit');
      contracts.set(c.id,{terms:c,drawn:0n});
    }else if(e.type==='purchase'){
      if(lots.has(e.lotId))fail('duplicate energy lot');
      const n=BigInt(e.energy.quantity),u=e.energy.unit,cap=capacities.get(u)??0n,onHand=stock.get(u)??0n;
      if(onHand+n>cap)fail('inventory capacity exceeded');
      let cost:bigint;
      const p=BigInt(e.source.priceMinor),den=BigInt(e.source.priceQuantity);
      if(e.source.kind==='contract'){
        const c=contracts.get(e.source.contractId!)??fail('unknown energy contract');
        if(c.terms.unit!==u||c.terms.totalPriceMinor!==e.source.priceMinor||c.terms.quantity!==e.source.priceQuantity)fail('locked contract terms mismatch');
        if(c.drawn+n>den)fail('contract coverage exceeded');
        cost=(c.drawn+n)*p/den-c.drawn*p/den;c.drawn+=n;
      }else cost=ceil(n*p,den);
      money(cost);
      if(cost>BigInt(e.availableCashMinor))fail('insufficient purchase cash');
      const lot:Lot={id:e.lotId,unit:u,original:n,cost,used:0n,reserved:0n,source:e.source};
      lots.set(lot.id,lot);const group=unitLots.get(u)??[];group.push(lot);unitLots.set(u,group);stock.set(u,onHand+n);
    }else if(e.type==='reserve'){
      if(reservations.has(e.reservationId))fail('duplicate reservation');
      const allocations:Allocation[]=[];
      for(const a of e.requirements){
        let remaining=BigInt(a.quantity);
        for(const l of unitLots.get(a.unit)??[]){
          const take=min(remaining,l.original-l.used-l.reserved);
          if(take>0n){l.reserved+=take;allocations.push({lotId:l.id,unit:l.unit,quantity:qty(take)});remaining-=take;}
          if(remaining===0n)break;
        }
        if(remaining!==0n)fail('insufficient free energy');
      }
      reservations.set(e.reservationId,{id:e.reservationId,allocations,closed:null});
    }else{
      const r=reservations.get(e.reservationId)??fail('unknown reservation');
      if(r.closed)fail('reservation already closed');
      const pending=new Map(e.actual.map(a=>[a.unit,BigInt(a.quantity)]));
      const consumed:Consumption[]=[];let total=0n;
      for(const a of r.allocations){
        const l=lots.get(a.lotId)!,reserved=BigInt(a.quantity),remaining=pending.get(a.unit)??0n,n=min(remaining,reserved);
        l.reserved-=reserved;
        if(n>0n){
          // Cumulative carrying cost allocation: all paise eventually recognized,
          // even if a lot is split among many differently ordered reservations.
          const cost=(l.used+n)*l.cost/l.original-l.used*l.cost/l.original;
          l.used+=n;stock.set(l.unit,stock.get(l.unit)!-n);pending.set(a.unit,remaining-n);total+=cost;
          consumed.push({lotId:l.id,unit:l.unit,quantity:qty(n),costMinor:money(cost)});
        }
      }
      if([...pending.values()].some(n=>n!==0n))fail('actual draw exceeds reserved energy');
      r.closed={outcome:e.outcome,consumed,totalCostMinor:money(total)};
    }
  }
  const lotView=[...lots.values()].map(l=>({lot:decodeEnergyLot({id:l.id,energy:{unit:l.unit,quantity:qty(l.original-l.used)},reservedQuantity:qty(l.reserved),costMinor:money(l.cost-l.used*l.cost/l.original)}),originalQuantity:qty(l.original),originalCostMinor:money(l.cost),consumedQuantity:qty(l.used),consumedCostMinor:money(l.used*l.cost/l.original),source:l.source}));
  const contractView=[...contracts.values()].sort((a,b)=>order(a.terms.id,b.terms.id)).map(c=>decodeEnergyContract({...c.terms,remainingQuantity:qty(BigInt(c.terms.quantity)-c.drawn)}));
  const inventory=s.capacity.map(c=>{
    const group=unitLots.get(c.unit)??[],reserved=group.reduce((n,l)=>n+l.reserved,0n),onHand=stock.get(c.unit)??0n;
    const carryingCost=group.reduce((n,l)=>n+l.cost-l.used*l.cost/l.original,0n);
    return {unit:c.unit,capacity:c.quantity,onHand:qty(onHand),reserved:qty(reserved),available:qty(onHand-reserved),carryingCostMinor:money(carryingCost)};
  });
  return {book:s,view:{revision:s.revision,inventory,lots:lotView,contracts:contractView,reservations:[...reservations.values()]}};
}
/** Opening contracts are immutable full coverage terms. R24 may add a separate
 * authoritative contract acquisition lifecycle, not rewrite existing terms. */
export function createEnergyBook(capacity:unknown,contracts:unknown=[]):EnergyBook{
  return decodeEnergyBook({schemaVersion:1,revision:0,capacity,contracts,events:[]});
}
export function decodeEnergyBook(input:unknown):EnergyBook{return freeze(replay(input).book);}
export function inspectEnergyBook(input:unknown){return freeze(replay(input).view);}
/** E10 pure revision-checked event transition. Replay derives FIFO reserved
 * slices, actual cost, unused release, contract draw and stock; no cash mutation.
 * Caller supplies trusted locked spot rate/current cash and R34/R39 CAS.
 * No replay pruning yet; fails closed at 10k events. */
export function applyEnergyEvent(input:unknown,cmd:unknown):EnergyBook{
  const q=command(cmd),s=replay(input).book;
  if(s.revision!==q.expectedRevision)fail('STALE_ENERGY_REVISION');
  s.events.push(q.event);s.revision++;
  return decodeEnergyBook(s);
}
