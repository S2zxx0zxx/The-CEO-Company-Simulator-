import {describe,it,expect} from 'vitest';
import {createScheduler,nextRandomUint32,compareEvents,RNG_ALGORITHM,type SchedulerConfig,type EventRequest} from '../src/rail/scheduler';
import {integer} from '../src/domain/units';
import {object,list,id} from '../src/domain/validation';
import type {SimEvent} from '../src/domain/models';
type State={total:number;order:string[];rolls:number[];boundary:number};
const state=object({total:integer,order:list(id),rolls:list(integer),boundary:integer});
const payload=object({amount:integer});
const init={total:0,order:[],rolls:[],boundary:10};
const req=(simTimeS:number,kind='add',amount=1):EventRequest=>({simTimeS,kind,payload:{amount}});
const config=(override:Partial<SchedulerConfig<State>>={}):SchedulerConfig<State>=>({
 policySha256:'a'.repeat(64),graphSha256s:['c'.repeat(64),'b'.repeat(64)],maxPending:1000,decodeState:state,
 events:{add:payload,review:payload,chain:payload,explode:payload},
 reduce:(s,e,rand)=>{
   const a=payload(e.payload).amount;
   if(e.kind==='explode'){rand();throw Error('fixture failure');}
   return {state:{total:s.total+a,order:[...s.order,e.id],rolls:[...s.rolls,rand()],boundary:e.kind==='review'?s.boundary+10:s.boundary},schedule:e.kind==='chain'?[req(e.simTimeS,'add',2)]:[]};
 },...override});
const setup=async(override:Partial<SchedulerConfig<State>>={})=>{
 const engine=createScheduler(config(override));return {engine,s:await engine.initialize(0,123,init)};
};
const copy=(v:unknown):any=>JSON.parse(JSON.stringify(v));
describe('R32 deterministic clock and event ordering',()=>{
 it('known xorshift32 vector and version',()=>{let n=1;expect([n=nextRandomUint32(n),n=nextRandomUint32(n),n=nextRandomUint32(n)]).toEqual([270369,67634689,2647435461]);expect(RNG_ALGORITHM).toBe('xorshift32-v1');});
 it.each([0,-1,1.5,4294967296,NaN,'1'] )('rejects bad seed %s',v=>expect(()=>nextRandomUint32(v)).toThrow());
 it('orders by time then sequence then event ID',()=>{const a={simTimeS:5,sequence:1,id:'a'} as SimEvent,b={...a,id:'b'},c={...b,sequence:2},d={...a,simTimeS:6 as SimEvent['simTimeS']};expect([d,c,b,a].sort(compareEvents)).toEqual([a,b,c,d]);});
 it('heap orders out-of-time insertion and same-time insertion',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(30),req(10),req(10),req(5)]);const x=await engine.advance(q,30,20);expect(x.processed).toEqual(['event:3','event:1','event:2','event:0']);expect(x.snapshot.simTimeS).toBe(30);expect(x.complete).toBe(true);});
 it('never runs a future event on idle advancement',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(20)]);const x=await engine.advance(q,19,5);expect(x.processed).toEqual([]);expect(x.snapshot.simTimeS).toBe(19);expect(x.nextDueSimS).toBe(20);});
 it('same-time child receives a later sequence',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(5,'chain'),req(5)]);const x=await engine.advance(q,5,10);expect(x.processed).toEqual(['event:0','event:1','event:2']);expect(x.snapshot.state.total).toBe(4);});
 it('bounded batch cannot jump ahead of backlog',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(5),req(5),req(6)]);const x=await engine.advance(q,20,1);expect(x.complete).toBe(false);expect(x.snapshot.simTimeS).toBe(5);expect(x.nextDueSimS).toBe(5);});
 it('zero/negative/overflow budget and rollback rejected',async()=>{const {engine,s}=await setup();for(const n of [0,-1,1.2,100001])await expect(engine.advance(s,1,n)).rejects.toThrow();await expect(engine.advance(s,-1,1)).rejects.toThrow();});
 it('no past, unknown kind or malformed payload enqueue',async()=>{const {engine,s}=await setup();const x=(await engine.advance(s,10,1)).snapshot;for(const r of [req(9),req(10,'unknown'),req(10,'add',-1)])await expect(engine.enqueue(x,[r])).rejects.toThrow();});
 it('cancel removes only pending IDs and never reuses sequence',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(2),req(1)]);const c=await engine.cancel(q,['event:1']);const z=await engine.enqueue(c,[req(1)]);expect(z.pendingEvents.map(e=>e.id)).toEqual(['event:2','event:0']);await expect(engine.cancel(c,['event:1'])).rejects.toThrow();});
 it('indexed removal preserves heap order for many events',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,Array.from({length:100},(_,i)=>req((i*37)%17)));const cancelled=q.pendingEvents.filter(e=>e.sequence%3===0).map(e=>e.id);const c=await engine.cancel(q,cancelled);const x=await engine.advance(c,20,100);expect(x.processed).toEqual(q.pendingEvents.filter(e=>!cancelled.includes(e.id)).map(e=>e.id));});
 it('queue capacity and multi-request failure atomic',async()=>{const {engine,s}=await setup({maxPending:1});await expect(engine.enqueue(s,[req(1),req(2)])).rejects.toThrow();expect(s.sequence).toBe(0);expect(s.pendingEvents).toEqual([]);});
 it('handler rejection leaves original state, queue and seed intact',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(1),req(2,'explode')]);const before=JSON.stringify(q);await expect(engine.advance(q,3,5)).rejects.toThrow('fixture failure');expect(JSON.stringify(q)).toBe(before);});
 it('late retained RNG callback cannot mutate committed state',async()=>{let draw:(()=>number)|undefined;const {engine,s}=await setup({reduce:(s,_e,r)=>{draw=r;return {state:{...s}};}});const q=await engine.enqueue(s,[req(1)]);const x=await engine.advance(q,1,1);expect(()=>draw!()).toThrow();expect(x.snapshot.rngState).toBe(q.rngState);});
 it('frozen output and input isolation',async()=>{const {engine,s}=await setup();const r=req(1);const q=await engine.enqueue(s,[r]);(r.payload as {amount:number}).amount=999;expect(Object.isFrozen(q.state.order)).toBe(true);expect(Object.isFrozen(q.pendingEvents[0].payload)).toBe(true);expect((await engine.advance(q,1,1)).snapshot.state.total).toBe(1);});
});
describe('R32 replay and recovery',()=>{
 it('same seed, event inputs and target produce identical hashes across batch partitions and save reload',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(5,'chain'),req(7),req(5),req(10)]);const direct=(await engine.advance(q,20,100)).snapshot;let b=q;for(let i=0;i<10;i++){const r=await engine.advance(await engine.restore(copy(b)),20,1);b=r.snapshot;if(r.complete)break;}expect(b).toEqual(direct);expect(b.checksum).toMatch(/^[a-f0-9]{64}$/);});
 it('idle intermediate target does not alter final replay hash',async()=>{const {engine,s}=await setup();const q=await engine.enqueue(s,[req(10)]);const a=await engine.advance(q,20,3);const b=await engine.advance((await engine.advance(q,3,1)).snapshot,20,3);expect(b.snapshot).toEqual(a.snapshot);});
 it('genesis canonicalizes state keys and graph order',async()=>{const {engine,s}=await setup();const e=createScheduler(config({graphSha256s:['b'.repeat(64),'c'.repeat(64)]}));expect(await e.initialize(0,123,{boundary:10,rolls:[],order:[],total:0})).toEqual(s);});
 it('seed changes checksum and random history',async()=>{const {engine,s}=await setup();const b=await engine.initialize(0,124,init);const a1=await engine.advance(await engine.enqueue(s,[req(1)]),1,1);const b1=await engine.advance(await engine.enqueue(b,[req(1)]),1,1);expect(a1.snapshot.checksum).not.toBe(b1.snapshot.checksum);expect(a1.snapshot.state.rolls).not.toEqual(b1.snapshot.state.rolls);});
 it.each(['simTimeS','rngState','sequence','historySha256','policySha256','state','pendingEvents'])('rejects corrupted %s',async key=>{const {engine,s}=await setup();const q=copy(await engine.enqueue(s,[req(3)]));q[key]=({simTimeS:1,rngState:'124',sequence:2,historySha256:'d'.repeat(64),policySha256:'d'.repeat(64),state:{...init,total:2},pendingEvents:[]})[key as 'simTimeS'];await expect(engine.restore(q)).rejects.toThrow();});
 it('rejects changed graph identity and unsupported RNG',async()=>{const {engine,s}=await setup();await expect(createScheduler(config({graphSha256s:[]})).restore(s)).rejects.toThrow();await expect(engine.restore({...s,rngAlgorithm:'future'})).rejects.toThrow();});
 it('rejects non-JSON data at boundary',async()=>{const {engine,s}=await setup();for(const v of [undefined,NaN,Infinity,-0,1n,new Date(),[,1]])await expect(engine.enqueue(s,[{...req(1),payload:v}])).rejects.toThrow();});
 it('cancel history distinguishes different cancelled schedules',async()=>{const {engine,s}=await setup();const a=await engine.cancel(await engine.enqueue(s,[req(1)]),['event:0']);const b=await engine.cancel(await engine.enqueue(s,[req(2)]),['event:0']);expect(a.checksum).not.toBe(b.checksum);});
});
describe('R32 mandatory financial boundary ordering (adapter contract)',()=>{
 const guard:SchedulerConfig<State>['nextBoundary']=s=>({simTimeS:s.boundary,kind:'review'});
 it('cannot idle past missing review/deadline',async()=>{const {engine,s}=await setup({nextBoundary:guard});await expect(engine.advance(s,10,1)).rejects.toThrow('mandatory boundary');expect((await engine.advance(s,9,1)).snapshot.simTimeS).toBe(9);});
 it('review scheduled first executes before same-time ordinary command',async()=>{const {engine,s}=await setup({nextBoundary:guard});const q=await engine.enqueue(s,[req(10,'review',0),req(10),req(20,'review',0)]);const a=await engine.advance(q,20,3);expect(a.processed).toEqual(['event:0','event:1','event:2']);expect(a.snapshot.state.boundary).toBe(30);});
 it('wrong same-time sequence fails closed without silently reordering',async()=>{const {engine,s}=await setup({nextBoundary:guard});const q=await engine.enqueue(s,[req(10),req(10,'review',0)]);await expect(engine.advance(q,10,2)).rejects.toThrow('mandatory boundary');const fixed=await engine.enqueue(await engine.cancel(q,['event:0']),[req(10)]);expect((await engine.advance(fixed,10,2)).processed).toEqual(['event:1','event:2']);});
 it('budget exhaustion leaves boundary and later commands queued',async()=>{const {engine,s}=await setup({nextBoundary:guard});const q=await engine.enqueue(s,[req(1),req(10,'review',0),req(10)]);const a=await engine.advance(q,10,1);expect(a.complete).toBe(false);expect(a.snapshot.simTimeS).toBe(1);expect((await engine.advance(a.snapshot,10,2)).processed).toEqual(['event:1','event:2']);});
 it('async boundary lookup and reducer work without ambient clock',async()=>{const {engine,s}=await setup({nextBoundary:async x=>({simTimeS:x.boundary,kind:'review'}),reduce:async(s,e)=>({state:{...s,boundary:e.simTimeS+10}})});const q=await engine.enqueue(s,[req(10,'review',0)]);expect((await engine.advance(q,10,1)).snapshot.state.boundary).toBe(20);});
 it('boundary returned in past is rejected',async()=>{const {engine,s}=await setup({nextBoundary:()=>({simTimeS:0,kind:'review'})});const q=await engine.enqueue(s,[req(0,'review')]);await expect(engine.advance(q,1,3)).rejects.toThrow('mandatory boundary');});
});
