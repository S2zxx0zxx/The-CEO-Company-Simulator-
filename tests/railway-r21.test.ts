import {describe,it,expect} from 'vitest';
import {estimateDemand,allocateMarket,createDemandBook,decodeDemandBook,reserveDemand,closeDemand} from '../src/rail/economy/demand';
import {MAX_INTEGER} from '../src/domain/units';

const demand=(extra:Record<string,unknown>={})=>({baseDemand:1000,fareMinor:'10000',referenceFareMinor:'10000',generalizedTimeS:100,referenceTimeS:100,fareElasticityBps:-10000,timeElasticityBps:-10000,seasonBps:10000,serviceQualityBps:10000,minRatioBps:100,maxRatioBps:1000000,maxDemand:1000000,...extra});
const bucket=(id:string,origin:string,destination:string,total=100,kind='passenger',start=0,end=100)=>({kind,bucket:{id,origin,destination,intervalStartS:start,intervalEndS:end,available:total,reserved:0,served:0,total}});
const entries=()=>[bucket('ab','a','b'),bucket('ac','a','c'),bucket('bc','b','c'),bucket('cargo','a','c',1000,'freight')];
const claim=(bucketId:string,boardIndex=0,alightIndex=1,requested=100,extra:Record<string,unknown>={})=>({bucketId,boardIndex,alightIndex,requested,outsideWeight:1,services:[{serviceId:'own',weight:999}],...extra});
const trip=(tripId='trip1',claims=[claim('ab')],extra:Record<string,unknown>={})=>({tripId,serviceId:'own',dispatchSimS:10,stopIds:['a','b','c'],capacitySeats:60,cargoCapacityKg:300,claims,...extra});
const reserve=(s:ReturnType<typeof createDemandBook>,t:unknown=trip(),revision=s.revision)=>reserveDemand(s,{expectedRevision:revision,trip:t});
const values=(s:ReturnType<typeof createDemandBook>,id:string)=>{const b=s.buckets.find(x=>x.bucket.id===id)!.bucket;return [b.available,b.reserved,b.served,b.total];};
const allocation=(s:ReturnType<typeof createDemandBook>,id:string)=>s.trips[0].claims.find(c=>c.bucketId===id)!.allocated;
describe('R21 E01 bounded elastic demand',()=>{
  const examples:[string,Record<string,unknown>,number][]=[
    ['reference',{},1000],['double fare',{fareMinor:'20000'},500],['double time',{generalizedTimeS:200},500],
    ['both double',{fareMinor:'20000',generalizedTimeS:200},250],['half fare',{fareMinor:'5000'},2000],
    ['season and quality',{seasonBps:12500,serviceQualityBps:8000},1000],
    ['zero season',{seasonBps:0},0],['zero quality',{serviceQualityBps:0},0],['zero base',{baseDemand:0},0],
    ['zero fare bounded',{fareMinor:'0',minRatioBps:5000},2000],['time ratio capped',{generalizedTimeS:100000,maxRatioBps:20000},500],
    ['zero elasticity',{fareMinor:'90000',fareElasticityBps:0},1000],['elasticity minus two',{fareMinor:'20000',fareElasticityBps:-20000},250],
    ['half elasticity perfect square',{fareMinor:'40000',fareElasticityBps:-5000},500],
    ['fractional floor',{baseDemand:3,fareMinor:'20000'},1],['maximum demand cap',{fareMinor:'0',maxDemand:77},77],
    ['maximum integer demand',{baseDemand:MAX_INTEGER,maxDemand:MAX_INTEGER},MAX_INTEGER],
    ['large precise money',{fareMinor:'999999999999999999999999999999',referenceFareMinor:'999999999999999999999999999999'},1000]
  ];
  for(const [label,extra,expected] of examples)it(label,()=>expect(estimateDemand(demand(extra))).toBe(expected));
  for(const [label,extra] of [
    ['reference zero',{referenceFareMinor:'0'}],['time zero',{referenceTimeS:0}],['generalized zero',{generalizedTimeS:0}],
    ['positive elasticity',{fareElasticityBps:1}],['elasticity overflow',{timeElasticityBps:-40001}],['negative base',{baseDemand:-1}],
    ['fractional base',{baseDemand:1.5}],['money numeric',{fareMinor:100}],['factor overflow',{seasonBps:100001}],
    ['ratio inverted',{minRatioBps:20000}],['max below reference',{maxRatioBps:5000}],['unknown field',{junk:true}]
  ] as [string,Record<string,unknown>][])it('rejects '+label,()=>expect(()=>estimateDemand(demand(extra))).toThrow());
  it('monotone on synthetic fare/time grid and repeatable',()=>{let last=Infinity;for(let f=100;f<=30000;f+=100){const q=demand({fareMinor:String(f),fareElasticityBps:-3700,timeElasticityBps:-6200});const n=estimateDemand(q);expect(n).toBeLessThanOrEqual(last);expect(estimateDemand(q)).toBe(n);last=n;}});
});
describe('R21 E02 conserved market share',()=>{
  it('normalized weights including outside',()=>expect(allocateMarket({available:100,outsideWeight:1,services:[{serviceId:'b',weight:1},{serviceId:'a',weight:2}]})).toEqual({available:100,outside:25,services:[{serviceId:'a',units:50},{serviceId:'b',units:25}]}));
  it('stable remainder tie outside then ASCII',()=>expect(allocateMarket({available:2,outsideWeight:1,services:[{serviceId:'z',weight:1},{serviceId:'a',weight:1}]})).toEqual({available:2,outside:1,services:[{serviceId:'a',units:1},{serviceId:'z',units:0}]}));
  it('no services means outside gets everything',()=>expect(allocateMarket({available:20,outsideWeight:1,services:[]}).outside).toBe(20));
  it('zero weight never gets allocated',()=>expect(allocateMarket({available:10,outsideWeight:1,services:[{serviceId:'a',weight:0}]}).services[0].units).toBe(0));
  it('integer maximum conservation with BigInt weights',()=>{const q=allocateMarket({available:MAX_INTEGER,outsideWeight:MAX_INTEGER,services:[{serviceId:'a',weight:MAX_INTEGER},{serviceId:'b',weight:MAX_INTEGER}]});expect(q.outside+q.services.reduce((s,v)=>s+v.units,0)).toBe(MAX_INTEGER);});
  it('deterministic permutation and all quantities conserved',()=>{for(let available=0;available<150;available++){const services=[{serviceId:'a',weight:17},{serviceId:'b',weight:2},{serviceId:'c',weight:0}];const a=allocateMarket({available,outsideWeight:11,services});expect(allocateMarket({available,outsideWeight:11,services:[...services].reverse()})).toEqual(a);expect(a.outside+a.services.reduce((n,x)=>n+x.units,0)).toBe(available);}});
  for(const q of [{available:-1,outsideWeight:1,services:[]},{available:1,outsideWeight:0,services:[]},{available:1,outsideWeight:1,services:[{serviceId:'a',weight:-1}]},{available:1,outsideWeight:1,services:[{serviceId:'a',weight:1},{serviceId:'a',weight:1}]}])it('rejects invalid market '+JSON.stringify(q),()=>expect(()=>allocateMarket(q)).toThrow());
});
describe('R21 E03 shared OD and capacity',()=>{
  it('atomic reservation caps demand by seats',()=>{const a=createDemandBook(entries()),b=reserve(a);expect(values(a,'ab')).toEqual([100,0,0,100]);expect(values(b,'ab')).toEqual([40,60,0,100]);expect(b.trips[0].claims[0].unmet).toBe(40);expect(b.revision).toBe(1);});
  it('market quota and outside limit the reservation',()=>{const b=reserve(createDemandBook(entries()),trip('t',[claim('ab',0,1,100,{outsideWeight:1,services:[{serviceId:'own',weight:1}]})]));expect(allocation(b,'ab')).toBe(50);});
  it('shared bucket across competing dispatches and stale revision rejection',()=>{const a=createDemandBook(entries()),b=reserve(a);expect(()=>reserve(b,trip('trip2'),0)).toThrow('STALE_DEMAND_REVISION');const c=reserve(b,trip('trip2'));expect(values(c,'ab')).toEqual([0,100,0,100]);expect(c.trips[1].claims[0].allocated).toBe(40);});
  it('seats reused after alighting on adjacent segment',()=>{const b=reserve(createDemandBook(entries()),trip('t',[claim('ab'),claim('bc',1,2)]));expect(allocation(b,'ab')).toBe(60);expect(allocation(b,'bc')).toBe(60);});
  it('overlapping OD claims share segment capacity',()=>{const b=reserve(createDemandBook(entries()),trip('t',[claim('ac',0,2),claim('ab'),claim('bc',1,2)]));expect(allocation(b,'ab')).toBe(60);expect(allocation(b,'ac')).toBe(0);expect(allocation(b,'bc')).toBe(60);});
  it('through passengers occupy all segments',()=>{const b=reserve(createDemandBook(entries()),trip('t',[claim('ac',0,2,40),claim('bc',1,2)]));expect(allocation(b,'ac')).toBe(40);expect(allocation(b,'bc')).toBe(20);});
  it('freight kg and passenger seats are independent',()=>{const b=reserve(createDemandBook(entries()),trip('t',[claim('ab'),claim('cargo',0,2,1000)]));expect(allocation(b,'ab')).toBe(60);expect(allocation(b,'cargo')).toBe(300);expect(values(b,'cargo')).toEqual([700,300,0,1000]);});
  it('zero capacity gives zero allocation',()=>{const b=reserve(createDemandBook(entries()),trip('t',[claim('ab')],{capacitySeats:0}));expect(allocation(b,'ab')).toBe(0);});
  it('settle once conserves demand and rejects repeated delivery',()=>{const a=reserve(createDemandBook(entries())),b=closeDemand(a,{expectedRevision:1,tripId:'trip1',outcome:'served'});expect(values(b,'ab')).toEqual([40,0,60,100]);expect(()=>closeDemand(b,{expectedRevision:2,tripId:'trip1',outcome:'served'})).toThrow();});
  it('cancellation releases reservation and rejects repeated release',()=>{const a=reserve(createDemandBook(entries())),b=closeDemand(a,{expectedRevision:1,tripId:'trip1',outcome:'released'});expect(values(b,'ab')).toEqual([100,0,0,100]);expect(()=>closeDemand(b,{expectedRevision:2,tripId:'trip1',outcome:'released'})).toThrow();});
  it('duplicate trip ID cannot reserve again even after release',()=>{const a=reserve(createDemandBook(entries())),b=closeDemand(a,{expectedRevision:1,tripId:'trip1',outcome:'released'});expect(()=>reserve(b)).toThrow('duplicate trip');});
  it('input order does not change state or allocation',()=>{const a=createDemandBook(entries()),b=createDemandBook(entries().reverse());const claims=[claim('ac',0,2),claim('ab'),claim('bc',1,2)];expect(reserve(a,trip('t',claims))).toEqual(reserve(b,trip('t',[...claims].reverse())));});
  it('interval half-open and no reservation at expiry',()=>{const a=createDemandBook(entries());expect(reserve(a,trip('t',[claim('ab')],{dispatchSimS:0})).revision).toBe(1);expect(()=>reserve(a,trip('t',[claim('ab')],{dispatchSimS:100}))).toThrow('outside OD interval');});
  it('overlapping same kind OD rejected, adjacent and separate kind allowed',()=>{expect(()=>createDemandBook([bucket('x','a','b',100,'passenger',0,20),bucket('y','a','b',100,'passenger',10,30)])).toThrow('overlapping');expect(createDemandBook([bucket('x','a','b',100,'passenger',0,20),bucket('y','a','b',100,'passenger',20,30),bucket('z','a','b',100,'freight',0,20)]).buckets.length).toBe(3);});
  it('invalid second claim leaves input untouched',()=>{const a=createDemandBook(entries()),before=JSON.stringify(a);expect(()=>reserve(a,trip('t',[claim('ab'),claim('missing',1,2)]))).toThrow();expect(JSON.stringify(a)).toBe(before);});
  it('wrong OD order, reversed indices, missing service and duplicate claims rejected',()=>{const a=createDemandBook(entries());for(const c of [[claim('ab',1,2)],[claim('ab',1,0)],[claim('ab',0,1,1,{services:[{serviceId:'other',weight:1}]})],[claim('ab'),claim('ab')]])expect(()=>reserve(a,trip('t',c))).toThrow();});
  it('immutable nested snapshot and valid restore',()=>{const a=reserve(createDemandBook(entries()));expect(Object.isFrozen(a.buckets[0].bucket)).toBe(true);expect(Object.isFrozen(a.trips[0].claims[0])).toBe(true);expect(decodeDemandBook(JSON.parse(JSON.stringify(a)))).toEqual(a);});
  it('restored book rejects orphan reserved quantities and tampered claim',()=>{const a=reserve(createDemandBook(entries()));const b=JSON.parse(JSON.stringify(a));b.trips=[];expect(()=>decodeDemandBook(b)).toThrow('reconciliation');const c=JSON.parse(JSON.stringify(a));c.trips[0].claims[0].allocated=61;c.trips[0].claims[0].unmet=39;expect(()=>decodeDemandBook(c)).toThrow();});
  it('invalid bucket conservation rejected by R06 decoder',()=>{const b=bucket('ab','a','b');b.bucket.total=99;expect(()=>createDemandBook([b])).toThrow();});
  it('revision overflow rejected',()=>{const a=createDemandBook(entries());expect(()=>reserveDemand({...a,revision:MAX_INTEGER},{expectedRevision:MAX_INTEGER,trip:trip()})).toThrow('revision overflow');});
});
