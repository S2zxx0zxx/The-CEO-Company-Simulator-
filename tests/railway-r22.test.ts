import {describe,it,expect} from 'vitest';
import {calculateFare,calculateCargoRevenue,calculateDelayPenalty,createRevenueBook,decodeRevenueBook,issueRevenueTerms,settleRevenue} from '../src/rail/economy/revenue';
import {createDemandBook,reserveDemand,closeDemand,type DemandBook} from '../src/rail/economy/demand';
import {MAX_INTEGER} from '../src/domain/units';
const max='9'.repeat(30);
const fare=(extra:Record<string,unknown>={})=>({baseMinor:'1000',rateMinorPerKm:'100',discountBps:0,capMinor:'1000000',...extra});
const freight=(extra:Record<string,unknown>={})=>({deliveredKg:300,paidDistanceM:150000,rateMinorPerTonneKm:'2000',serviceFactorBps:8000,...extra});
const penalty=(extra:Record<string,unknown>={})=>({actualDurationS:110,promisedDurationS:100,rateMinorPerSecond:'50',capMinor:'300',...extra});
const copy=(x:unknown):any=>JSON.parse(JSON.stringify(x));
const bucket=(id:string,kind:string,origin:string,destination:string,total:number)=>({kind,bucket:{id,origin,destination,intervalStartS:0,intervalEndS:1000,total,available:total,reserved:0,served:0}});
const entries=()=>[bucket('ab','passenger','a','b',200),bucket('ac','freight','a','c',1000)];
const claim=(bucketId:string,alightIndex:number,requested:number)=>({bucketId,boardIndex:0,alightIndex,requested,outsideWeight:1,services:[{serviceId:'own',weight:999}]});
function reserve(d:DemandBook,tripId='t1'){return reserveDemand(d,{expectedRevision:d.revision,trip:{tripId,serviceId:'own',dispatchSimS:10,stopIds:['a','b','c'],capacitySeats:60,cargoCapacityKg:300,claims:[claim('ab',1,60),claim('ac',2,300)]}});}
const terms=(tripId='t1',consignmentId='c1')=>({tripId,policySha256:'a'.repeat(64),segmentDistancesM:[100000,50000],promisedDurationS:100,delayRateMinorPerSecond:'50',delayCapMinor:'300',passengers:[{bucketId:'ab',classId:'unreserved',quantity:40,policy:fare()},{bucketId:'ab',classId:'reserved',quantity:20,policy:fare({baseMinor:'2000',rateMinorPerKm:'200',discountBps:2500})}],cargo:[{bucketId:'ac',consignmentId,massKg:300,rateMinorPerTonneKm:'2000',paidDistanceM:150000,serviceFactorBps:8000}]});
const evidence=(consignmentId='c1')=>({arrivalSimS:120,passengers:[{bucketId:'ab',classId:'unreserved',paid:35,unpaid:5,refundMinor:'1000'},{bucketId:'ab',classId:'reserved',paid:18,unpaid:2,refundMinor:'2000'}],cargo:[{consignmentId,deliveredKg:300,finalDestinationId:'c'}]});
const emptyEvidence={arrivalSimS:null,passengers:[],cargo:[]};
const close=(d:DemandBook,tripId='t1',outcome:'served'|'released'='served')=>closeDemand(d,{expectedRevision:d.revision,tripId,outcome});
const setup=()=>{const d=reserve(createDemandBook(entries())),b=issueRevenueTerms(createRevenueBook(),d,{expectedRevision:0,expectedDemandRevision:d.revision,terms:terms()});return {d,b};};
const issue=(b:unknown,d:DemandBook,t:unknown=terms(),rev=0)=>issueRevenueTerms(b,d,{expectedRevision:rev,expectedDemandRevision:d.revision,terms:t});
const settle=(b:ReturnType<typeof createRevenueBook>,d:DemandBook,e:unknown=evidence(),tripId='t1')=>settleRevenue(b,d,{expectedRevision:b.revision,expectedDemandRevision:d.revision,tripId,evidence:e});
describe('R22 E04 exact ticket fares',()=>{
 for(const [name,distance,policy,expected] of [
  ['base only',0,fare(),'1000'],['100 km',100000,fare(),'11000'],['fractional km floor',15,fare(),'1001'],
  ['discount before cap',100000,fare({discountBps:1000,capMinor:'10000'}),'9900'],['cap',100000,fare({capMinor:'1000'}),'1000'],
  ['free class',100000,fare({discountBps:10000}),'0'],['zero cap',100000,fare({capMinor:'0'}),'0'],
  ['no premature overflow',MAX_INTEGER,fare({rateMinorPerKm:max,capMinor:'123'}),'123'],
  ['exact 30-digit price',0,fare({baseMinor:max,capMinor:max}),max],
  ['round once',9,fare({baseMinor:'1',rateMinorPerKm:'111',discountBps:5000}),'0']
 ] as [string,number,ReturnType<typeof fare>,string][])it(name,()=>expect(calculateFare({distanceM:distance,policy})).toBe(expected));
 for(const [name,distance,policy] of [
  ['negative distance',-1,fare()],['fractional distance',0.1,fare()],['overflow distance',MAX_INTEGER+1,fare()],
  ['negative price',1,fare({baseMinor:'-1'})],['fractional price',1,fare({rateMinorPerKm:'1.5'})],['numeric price',1,fare({baseMinor:1})],
  ['discount overflow',1,fare({discountBps:10001})],['negative cap',1,fare({capMinor:'-1'})],['unknown policy',1,fare({hidden:1})]
 ] as [string,number,ReturnType<typeof fare>][])it('rejects '+name,()=>expect(()=>calculateFare({distanceM:distance,policy})).toThrow());
});
describe('R22 E06 freight revenue and E07 delay penalty',()=>{
 for(const [name,input,expected] of [
  ['kg to tonne-km',freight(),'72000'],['zero delivered',freight({deliveredKg:0}),'0'],
  ['zero paid distance',freight({paidDistanceM:0}),'0'],['zero service',freight({serviceFactorBps:0}),'0'],
  ['floor once',freight({deliveredKg:1,paidDistanceM:999,rateMinorPerTonneKm:'1000',serviceFactorBps:10000}),'0'],
  ['full service',freight({serviceFactorBps:10000}),'90000']
 ] as [string,ReturnType<typeof freight>,string][])it(name,()=>expect(calculateCargoRevenue(input)).toBe(expected));
 for(const [name,extra] of [['negative mass',{deliveredKg:-1}],['fractional mass',{deliveredKg:0.5}],['negative distance',{paidDistanceM:-1}],['factor above cap',{serviceFactorBps:10001}],['unsafe rate',{rateMinorPerTonneKm:'9'.repeat(31)}],['revenue overflow',{deliveredKg:MAX_INTEGER,paidDistanceM:MAX_INTEGER,rateMinorPerTonneKm:max}]] as [string,Record<string,unknown>][])it('rejects '+name,()=>expect(()=>calculateCargoRevenue(freight(extra))).toThrow());
 for(const [name,extra,expected] of [['capped',{},'300'],['on time',{actualDurationS:100},'0'],['early',{actualDurationS:90},'0'],['one second late',{actualDurationS:101},'50'],['zero cap',{capMinor:'0'},'0'],['huge rate capped',{actualDurationS:MAX_INTEGER,rateMinorPerSecond:max},'300']] as [string,Record<string,unknown>,string][])it('delay '+name,()=>expect(calculateDelayPenalty(penalty(extra))).toBe(expected));
 for(const extra of [{promisedDurationS:0},{actualDurationS:-1},{rateMinorPerSecond:'-1'},{capMinor:'1.2'}])it('rejects invalid delay '+JSON.stringify(extra),()=>expect(()=>calculateDelayPenalty(penalty(extra))).toThrow());
});
describe('R22 E05/E06/E07 revenue lifecycle using R21 demand',()=>{
 it('locks terms and computes paid class totals, refunds, fraud, cargo and penalty',()=>{const {d,b}=setup(),a=close(d),out=settle(b,a);expect(out.records[0].closed?.totals).toEqual({passengerGrossMinor:'682000',passengerRefundMinor:'3000',unpaidFaceValueMinor:'88000',cargoGrossMinor:'72000',delayPenaltyMinor:'300',netRevenueMinor:'750700'});expect(out.revision).toBe(2);expect(b.records[0].closed).toBeNull();expect(decodeRevenueBook(copy(out),a)).toEqual(out);});
 it('immutable deep snapshots and terms independent of input',()=>{const d=reserve(createDemandBook(entries())),t=terms(),b=issue(createRevenueBook(),d,t);t.segmentDistancesM[0]=1;t.passengers[0].quantity=1;expect(b.records[0].terms.segmentDistancesM[0]).toBe(100000);expect(Object.isFrozen(b.records[0].terms.passengers[0].policy)).toBe(true);});
 it('canonical order of classes and evidence',()=>{const d=reserve(createDemandBook(entries())),a=issue(createRevenueBook(),d),q=terms();q.passengers.reverse();const b=issue(createRevenueBook(),d,q),delivered=close(d),e=evidence();e.passengers.reverse();expect(a).toEqual(b);expect(settle(a,delivered)).toEqual(settle(b,delivered,e));});
 it('unpaid is not deducted again and full refund may leave a net loss',()=>{const d=reserve(createDemandBook(entries())),q=terms();q.cargo[0].serviceFactorBps=0;const b=issue(createRevenueBook(),d,q),e=evidence();e.passengers=[{bucketId:'ab',classId:'unreserved',paid:0,unpaid:40,refundMinor:'0'},{bucketId:'ab',classId:'reserved',paid:20,unpaid:0,refundMinor:'330000'}];const x=settle(b,close(d),e).records[0].closed!.totals;expect(x.netRevenueMinor).toBe('-300');expect(x.unpaidFaceValueMinor).toBe('440000');});
 it('full cancellation releases demand without recognizing revenue',()=>{const {d,b}=setup(),a=close(d,'t1','released');expect(settle(b,a,emptyEvidence).records[0].closed?.totals.netRevenueMinor).toBe('0');expect(()=>settle(b,a)).toThrow('released');});
 it('no revenue before terminal delivery',()=>{const {d,b}=setup();expect(()=>settle(b,d)).toThrow('completed delivery');});
 it('one settlement per trip including stale or retried command',()=>{const {d,b}=setup(),a=close(d),x=settle(b,a);expect(()=>settle(x,a)).toThrow('already settled');expect(()=>settleRevenue(x,a,{expectedRevision:1,expectedDemandRevision:a.revision,tripId:'t1',evidence:evidence()})).toThrow('STALE');});
 it('cannot issue same trip twice',()=>{const {d,b}=setup();expect(()=>issue(b,d,terms(),1)).toThrow('duplicate trip');});
 it('stale demand revision and overflow revision',()=>{const {d,b}=setup();expect(()=>settleRevenue(b,close(d),{expectedRevision:1,expectedDemandRevision:d.revision,tripId:'t1',evidence:evidence()})).toThrow('STALE');expect(()=>issueRevenueTerms({...createRevenueBook(),revision:MAX_INTEGER},d,{expectedRevision:MAX_INTEGER,expectedDemandRevision:d.revision,terms:terms()})).toThrow('overflow');});
 it('cannot create terms after demand delivery',()=>{const {d}=setup();expect(()=>issue(createRevenueBook(),close(d))).toThrow('reserved trip');});
 it('duplicate consignment across active trips or after completed delivery',()=>{const {d,b}=setup(),d2=reserve(d,'t2');expect(()=>issue(b,d2,terms('t2'),1)).toThrow('duplicate active or delivered consignment');const a=close(d2),x=settle(b,a);expect(()=>issue(x,a,terms('t2'),2)).toThrow('duplicate active or delivered consignment');});
 it('released and finalized consignment can be rebooked once',()=>{const {d,b}=setup(),a=close(d,'t1','released'),x=settle(b,a,emptyEvidence),d2=reserve(a,'t2'),y=issue(x,d2,terms('t2'),2),z=settle(y,close(d2,'t2'),evidence(),'t2');expect(z.records.map(r=>r.closed?.totals.cargoGrossMinor)).toEqual(['0','72000']);});
 it('separate consignment IDs can settle independently',()=>{const {d,b}=setup(),d2=reserve(d,'t2'),y=issue(b,d2,terms('t2','c2'),1),a=close(d2),x=settle(y,a),a2=close(a,'t2'),z=settle(x,a2,evidence('c2'),'t2');expect(z.records.map(r=>r.closed?.totals.cargoGrossMinor)).toEqual(['72000','72000']);});
 it('stored revenue tampering detected on reload',()=>{const {d,b}=setup(),a=close(d),out=copy(settle(b,a));out.records[0].closed.totals.netRevenueMinor='1';expect(()=>decodeRevenueBook(out,a)).toThrow('totals mismatch');});
 it('binding tampering detected on reload',()=>{const {d,b}=setup(),x=copy(b);x.records[0].binding.claims[0].allocated++;expect(()=>decodeRevenueBook(x,d)).toThrow('identity mismatch');});
 const invalidTerms:[string,(t:any)=>void][]=[
 ['too many seats',t=>t.passengers[0].quantity++],['missing class allocation',t=>t.passengers.pop()],['wrong OD kind',t=>t.passengers[0].bucketId='ac'],['unknown bucket',t=>t.passengers[0].bucketId='unknown'],
 ['duplicate class',t=>t.passengers.push(t.passengers[0])],['cargo overclaim',t=>t.cargo[0].massKg++],['duplicate cargo',t=>t.cargo.push(t.cargo[0])],['paid distance exceeds path',t=>t.cargo[0].paidDistanceM=150001],
 ['missing segment',t=>t.segmentDistancesM.pop()],['unsafe path total',t=>t.segmentDistancesM=[MAX_INTEGER,1]],['bad policy hash',t=>t.policySha256='x'],['unknown term',t=>t.extra=1]
 ];
 for(const [n,mutate] of invalidTerms)it('rejects locked terms '+n,()=>{const d=reserve(createDemandBook(entries())),b=createRevenueBook(),q=copy(terms());mutate(q);expect(()=>issue(b,d,q)).toThrow();expect(b.records.length).toBe(0);});
 const invalidEvidence:[string,(e:any)=>void][]=[
 ['overpaid count',e=>e.passengers[0].paid++],['missing class',e=>e.passengers.pop()],['unknown class',e=>e.passengers[0].classId='x'],['refund over gross',e=>e.passengers[0].refundMinor='385001'],
 ['negative refund',e=>e.passengers[0].refundMinor='-1'],['missing cargo',e=>e.cargo=[]],['duplicate cargo receipt',e=>e.cargo.push(e.cargo[0])],['wrong delivery ID',e=>e.cargo[0].consignmentId='x'],
 ['intermediate destination',e=>e.cargo[0].finalDestinationId='b'],['partial cargo',e=>e.cargo[0].deliveredKg=299],['oversized cargo',e=>e.cargo[0].deliveredKg=301],['arrival before dispatch',e=>e.arrivalSimS=9],['missing arrival',e=>e.arrivalSimS=null]
 ];
 for(const [n,mutate] of invalidEvidence)it('rejects settlement '+n,()=>{const {d,b}=setup(),a=close(d),before=JSON.stringify(b),e=copy(evidence());mutate(e);expect(()=>settle(b,a,e)).toThrow();expect(JSON.stringify(b)).toBe(before);});
});
