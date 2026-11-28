import { eventDecoder, type SimEvent } from '../../domain/models';
import { integer, checkedAdd } from '../../domain/units';
import { id, list, object, record, sha256, version1, type Decoder, type Registry } from '../../domain/validation';

// R32: one immutable simulation clock. R39 supplies authentication and CAS;
// this SHA-256 checksum detects corruption, not malicious save replacement.
export const RNG_ALGORITHM = 'xorshift32-v1' as const;
const uint32 = (v:unknown,p='uint32') => integer(v,p,0,0xffffffff);
const seed = (v:unknown,p='seed') => integer(v,p,1,0xffffffff);
const rngAlgorithm:Decoder<typeof RNG_ALGORITHM> = (v,p='rngAlgorithm') => {
  if(v!==RNG_ALGORITHM) throw new TypeError(p+': unsupported algorithm'); return RNG_ALGORITHM;
};
const rngState:Decoder<string> = (v,p='rngState') => {
  if(typeof v!=='string'||! /^[1-9][0-9]{0,9}$/.test(v)) throw new TypeError(p+': noncanonical seed');
  seed(Number(v),p);return v;
};
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const num=(a:number,b:number)=>a<b?-1:a>b?1:0;
export function compareEvents(a:Readonly<SimEvent>,b:Readonly<SimEvent>):number {
  return num(a.simTimeS,b.simTimeS)||num(a.sequence,b.sequence)||cmp(a.id,b.id);
}
function fail(message:string):never {throw new Error('R32: '+message);}
type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
// Reject non-JSON objects, sparse arrays, accessors, cycles, -0 and unsafe
// integral values. Sort by code-unit order, never locale or insertion order.
function canonical(v:unknown,depth=0):Json {
  if(depth>128) return fail('JSON nesting limit');
  if(v===null||typeof v==='string'||typeof v==='boolean') return v;
  if(typeof v==='number'){
    if(!Number.isFinite(v)||Object.is(v,-0)||(Number.isInteger(v)&&!Number.isSafeInteger(v))) return fail('invalid JSON number');
    return v;
  }
  if(Array.isArray(v)) return list(x=>canonical(x,depth+1))(v);
  const r=record(v,'canonical JSON');
  return Object.fromEntries(Object.keys(r).sort(cmp).map(k=>[k,canonical(r[k],depth+1)]));
}
function freeze<T>(v:T):T {
  if(v!==null&&typeof v==='object') {
    for(const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }return v;
}
function clone<T>(v:T):T {return canonical(v) as T;}
async function hash(v:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(canonical(v)));
  const out=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(out),x=>x.toString(16).padStart(2,'0')).join('');
}
export function nextRandomUint32(previous:unknown):number {
  let x=seed(previous);x^=x<<13;x^=x>>>17;x^=x<<5;return uint32(x>>>0);
}
export interface EventRequest {simTimeS:number;kind:string;payload:unknown}
export interface Boundary {simTimeS:number;kind:string}
export interface EventTransition<S> {
  state:S;
  schedule?:readonly EventRequest[];
  cancel?:readonly string[];
}
export interface SchedulerConfig<S> {
  readonly policySha256:string;
  readonly graphSha256s:readonly string[];
  readonly maxPending:number; // explicit technical limit; not gameplay calibration
  readonly decodeState:Decoder<S>;
  readonly events:Registry;
  // Trusted pure transition: no IO, wall clock, external mutation, or ambient RNG.
  readonly reduce:(state:Readonly<S>,event:Readonly<SimEvent>,randomUint32:()=>number)=>EventTransition<S>|Promise<EventTransition<S>>;
  // Trusted accounting/aggregate adapter supplies the earliest required review,
  // grace deadline, maturity or report boundary. Null means none. The scheduler
  // fails closed rather than skipping/reordering a missing mandatory event.
  readonly nextBoundary?:(state:Readonly<S>,simTimeS:number)=>Boundary|null|Promise<Boundary|null>;
}
export interface SchedulerSnapshot<S>{
  readonly schemaVersion:1;
  readonly simTimeS:number;
  readonly rngAlgorithm:typeof RNG_ALGORITHM;
  readonly rngState:string;
  readonly policySha256:string;
  readonly graphSha256s:readonly string[];
  readonly sequence:number; // next never-used sequence, starting at zero
  readonly state:S;
  readonly pendingEvents:readonly Readonly<SimEvent>[];
  readonly historySha256:string;
  readonly checksum:string;
}
type Body<S>=Omit<SchedulerSnapshot<S>,'checksum'>;
const eventRequest=object({simTimeS:integer,kind:id,payload:(v:unknown)=>canonical(v)});
const boundaryDecoder=object({simTimeS:integer,kind:id});
const eventId=(sequence:number)=>'event:'+sequence;
class Heap {
  private a:SimEvent[]=[];
  private positions=new Map<string,number>();
  get size(){return this.a.length;}
  peek(){return this.a[0];}
  private swap(i:number,j:number){const x=this.a[i];this.a[i]=this.a[j];this.a[j]=x;this.positions.set(this.a[i].id,i);this.positions.set(this.a[j].id,j);}
  private up(i:number){while(i>0){const p=Math.floor((i-1)/2);if(compareEvents(this.a[p],this.a[i])<=0)break;this.swap(p,i);i=p;}return i;}
  private down(i:number){while(true){let j=i,l=i*2+1,r=l+1;if(l<this.size&&compareEvents(this.a[l],this.a[j])<0)j=l;if(r<this.size&&compareEvents(this.a[r],this.a[j])<0)j=r;if(j===i)break;this.swap(i,j);i=j;}}
  push(v:SimEvent){if(this.positions.has(v.id))fail('duplicate event');this.positions.set(v.id,this.size);this.a.push(v);this.up(this.size-1);}
  remove(key:string){const i=this.positions.get(key);if(i===undefined)return fail('unknown or already consumed event '+key);const v=this.a[i],last=this.a.pop()!;this.positions.delete(key);if(i<this.size){this.a[i]=last;this.positions.set(last.id,i);this.down(this.up(i));}return v;}
  pop(){return this.remove(this.a[0].id);}
  sorted(){return [...this.a].sort(compareEvents);}
}
function graphIds(v:unknown):string[]{
  const a=list(sha256)(v);if(new Set(a).size!==a.length)fail('duplicate graph hash');return a.sort(cmp);
}
function same(a:unknown,b:unknown){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
export function createScheduler<S>(cfg:SchedulerConfig<S>){
  const policySha256=sha256(cfg.policySha256),graphSha256s=graphIds(cfg.graphSha256s);
  const maxPending=integer(cfg.maxPending,'maxPending',1,100000);
  const decodeState=cfg.decodeState,reduce=cfg.reduce,nextBoundary=cfg.nextBoundary;
  const decodeEvent=eventDecoder(Object.freeze({...cfg.events}));
  const state=(v:unknown)=>freeze(clone(decodeState(canonical(v),'scheduler state')));
  const decode=object({
    schemaVersion:version1,simTimeS:integer,rngAlgorithm,rngState,
    policySha256:sha256,graphSha256s:graphIds,sequence:integer,state,
    pendingEvents:list(decodeEvent,0,maxPending),historySha256:sha256,checksum:sha256
  });
  async function seal(body:Body<S>):Promise<SchedulerSnapshot<S>>{
    const normalized=clone(body);return freeze({...normalized,checksum:await hash(normalized)});
  }
  async function restore(input:unknown):Promise<SchedulerSnapshot<S>>{
    const original=canonical(input),v=decode(original);
    if(v.policySha256!==policySha256||!same(v.graphSha256s,graphSha256s))fail('policy or graph version mismatch');
    const seen=new Set<number>();
    for(let i=0;i<v.pendingEvents.length;i++){
      const e=v.pendingEvents[i];
      if(e.id!==eventId(e.sequence)||e.sequence>=v.sequence||seen.has(e.sequence)||e.simTimeS<v.simTimeS||(i>0&&compareEvents(v.pendingEvents[i-1],e)>=0))fail('invalid pending event identity/time/order');
      seen.add(e.sequence);
    }
    const {checksum,...body}=v;
    // The stored form must already be canonical semantically, not repaired
    // silently by a decoder during recovery.
    if(!same(original,v)||await hash(body)!==checksum)fail('checkpoint checksum or canonical schema mismatch');
    return freeze(clone(v));
  }
  function heapFor(s:SchedulerSnapshot<S>){const h=new Heap();for(const e of s.pendingEvents)h.push(clone(e) as SimEvent);return h;}
  function add(h:Heap,seq:number,now:number,request:unknown){
    if(h.size>=maxPending)fail('pending event capacity exceeded');
    const r=eventRequest(request);
    if(r.simTimeS<now)fail('cannot schedule in the past');
    const next=checkedAdd(seq,1);
    const e=freeze(clone(decodeEvent({schemaVersion:1,id:eventId(seq),sequence:seq,...r})));
    h.push(e);return {e,next};
  }
  async function initialize(startSimS:unknown,initialSeed:unknown,initialState:unknown){
    const body={schemaVersion:1 as const,simTimeS:integer(startSimS),rngAlgorithm:RNG_ALGORITHM,rngState:String(seed(initialSeed)),policySha256,graphSha256s,sequence:0,state:state(initialState),pendingEvents:[]};
    return seal({...body,historySha256:await hash({type:'genesis',body})});
  }
  async function enqueue(input:unknown,requests:readonly EventRequest[]){
    const captured=list(eventRequest,0,maxPending)(requests);
    const s=await restore(input),h=heapFor(s);let sequence=s.sequence;
    const added:SimEvent[]=[];
    for(const req of captured){const a=add(h,sequence,s.simTimeS,req);sequence=a.next;added.push(a.e);}
    const {checksum:_,...body}=s;
    return seal({...body,sequence,pendingEvents:h.sorted(),historySha256:added.length?await hash({previous:s.historySha256,type:'enqueue',at:s.simTimeS,added}):s.historySha256});
  }
  async function cancel(input:unknown,ids:readonly string[]){
    const captured=list(id,0,maxPending)(ids);
    const s=await restore(input),h=heapFor(s),removed:SimEvent[]=[];
    for(const key of captured)removed.push(h.remove(key));
    const {checksum:_,...body}=s;
    return seal({...body,pendingEvents:h.sorted(),historySha256:removed.length?await hash({previous:s.historySha256,type:'cancel',at:s.simTimeS,removed}):s.historySha256});
  }
  async function advance(input:unknown,targetInput:unknown,limitInput:unknown){
    const s=await restore(input),target=integer(targetInput,'target',s.simTimeS),limit=integer(limitInput,'event budget',1,100000);
    const h=heapFor(s);let sequence=s.sequence,now=s.simTimeS,random=Number(s.rngState),current=s.state,historySha256=s.historySha256;
    const processed:string[]=[];
    while(true){
      const head=h.peek();
      if(processed.length>=limit&&head&&head.simTimeS<=target)break;
      // This preflight also runs before idle advancement. The boundary is
      // assigned an ordinary event sequence in advance; no hidden priorities.
      if(nextBoundary){
        const raw=await nextBoundary(current,now);
        if(raw!==null){
          const b=boundaryDecoder(raw);
          if(b.simTimeS<now)fail('overdue mandatory boundary');
          if(b.simTimeS<=target&&(!head||head.simTimeS>b.simTimeS||(head.simTimeS===b.simTimeS&&head.kind!==b.kind)))fail('mandatory boundary must precede ordinary events at '+b.simTimeS+': '+b.kind);
        }
      }
      if(!head||head.simTimeS>target){now=target;break;}
      const e=freeze(h.pop());now=e.simTimeS;
      let active=true;
      let result:EventTransition<S>;
      try{result=await reduce(current,e,()=>{if(!active)return fail('RNG outside active transition');random=nextRandomUint32(random);return random;});}
      finally{active=false;}
      const next=state(result.state),removed:SimEvent[]=[],added:SimEvent[]=[];
      for(const key of list(id,0,maxPending)(result.cancel??[]))removed.push(h.remove(key));
      for(const req of list(eventRequest,0,maxPending)(result.schedule??[])){const a=add(h,sequence,now,req);sequence=a.next;added.push(a.e);}
      historySha256=await hash({previous:historySha256,type:'event',event:e,state:next,rngState:String(random),added,removed});
      current=next;processed.push(e.id);
    }
    const {checksum:_,...body}=s;
    const snapshot=await seal({...body,simTimeS:now,rngState:String(random),sequence,state:current,pendingEvents:h.sorted(),historySha256});
    const next=h.peek();
    return freeze({snapshot,processed,complete:!(next&&next.simTimeS<=target),nextDueSimS:next?.simTimeS??null});
  }
  return Object.freeze({initialize,restore,enqueue,cancel,advance});
}
