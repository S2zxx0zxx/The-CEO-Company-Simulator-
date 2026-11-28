import Dexie,{type Table} from 'dexie';
import {integer,checkedAdd} from '../../domain/units';
import {object,list,distinct,id,sha256,nullable,enumeration,record,text} from '../../domain/validation';
import type {prepareDispatch,DispatchSnapshot} from '../dispatch';
import {anchorClock,observeClock,checkClock,decodeOfflinePolicy,decodeOfflineClock,catchupInput,AUTO_SETTLEMENT_PREFIX,type OfflineClock,type OfflinePolicy} from '../offline';

import {runCatchupBatch,pending} from '../offline/batch';
import {achievementReceipts,projectAchievements,claimAchievement} from '../progression';

type Runtime=Awaited<ReturnType<typeof prepareDispatch>>;
type Controller=Awaited<ReturnType<Runtime['open']>>;
const fail=(s:string):never=>{throw Error('R39: '+s);};
const pos=(v:unknown,p='positive')=>integer(v,p,1);
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const bytes=(s:string)=>new TextEncoder().encode(s);
const raw=(v:unknown)=>v;
const dbName='railway-ceo-save-v1';
const kinds=['quote','dispatch','bulk','settle','cancel','fleet','advance','catchup','finance','achievement'] as const;
const kind=enumeration(kinds);
const request=object({requestId:id,kind,input:raw});
type Request=ReturnType<typeof request>;
const journalRow=object({requestId:id,kind,payload:text(1000000),committedRevision:pos,result:raw});
type Journal=ReturnType<typeof journalRow>;
type Limits={maxJournalEntries:number;maxBytes:number};
const limitDecoder=object({maxJournalEntries:(v,p)=>integer(v,p,1,100000),maxBytes:(v,p)=>integer(v,p,1024,64000000)});
const headDecoder=object({companyId:id,revision:pos,tag:sha256});
type Head=ReturnType<typeof headDecoder>;
const sealDecoder=object({payload:text(64000000),tag:sha256});
export type SealedRailwaySave=ReturnType<typeof sealDecoder>;
type Slot={key:string;seal:SealedRailwaySave};
type KeyRow={companyId:string;key:CryptoKey};
type Body={format:'railway-ceo-save';schemaVersion:2;companyId:string;configurationSha256:string;revision:number;previousTag:string|null;limits:Limits;snapshot:unknown;quotes:unknown;journal:Journal[]};
type OldBody=Omit<Body,'schemaVersion'|'previousTag'>&{schemaVersion:1};
type ClockBody=Omit<Body,'schemaVersion'>&{schemaVersion:3;clock:OfflineClock};
type SaveBody=Body|OldBody|ClockBody;
type CurrentBody=Body|ClockBody;
const bodyShape={format:enumeration(['railway-ceo-save']),companyId:id,configurationSha256:sha256,revision:pos,limits:limitDecoder,snapshot:raw,quotes:raw,journal:distinct(list(journalRow,0,100000),r=>r.requestId)};
const v1=object({...bodyShape,schemaVersion:(v:unknown)=>v===1?1 as const:fail('unsupported legacy schema')});
const v2=object({...bodyShape,schemaVersion:(v:unknown)=>v===2?2 as const:fail('unsupported schema'),previousTag:nullable(sha256)});
const v3=object({...bodyShape,schemaVersion:(v:unknown)=>v===3?3 as const:fail('unsupported clock schema'),previousTag:nullable(sha256),clock:decodeOfflineClock});
function canonical(v:unknown,depth=0):unknown{
  if(depth>128)fail('JSON nesting');
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0)||(Number.isInteger(v)&&!Number.isSafeInteger(v)))fail('invalid JSON number');return v;}
  if(Array.isArray(v))return list(x=>canonical(x,depth+1))(v);
  const r=record(v,'R39 JSON');return Object.fromEntries(Object.keys(r).sort().map(k=>[k,canonical(r[k],depth+1)]));
}
const fingerprint=(v:unknown)=>JSON.stringify(canonical(v));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function validKey(k:CryptoKey){
  if(!k||k.type!=='secret'||k.extractable||k.algorithm.name!=='HMAC'||(k.algorithm as HmacKeyAlgorithm).hash.name!=='SHA-256'||(k.algorithm as HmacKeyAlgorithm).length!==256||k.usages.length!==2||!k.usages.includes('sign')||!k.usages.includes('verify'))fail('missing or invalid installation key');
  return k;
}
export async function createRailwaySaveKey(){return crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);}
export async function sealRailwaySave(body:SaveBody,key:CryptoKey):Promise<SealedRailwaySave>{
  const payload=JSON.stringify(body);
  if(bytes(payload).length>body.limits.maxBytes)fail('save size limit; export/reconcile before continuing');
  return {payload,tag:hex(await crypto.subtle.sign('HMAC',validKey(key),bytes(payload)))};
}
export async function decodeRailwaySave(input:unknown,key:CryptoKey,limits:Limits){
  const s=sealDecoder(input);
  if(bytes(s.payload).length>limits.maxBytes)fail('save size limit');
  const sig=Uint8Array.from(s.tag.match(/../g)!,x=>parseInt(x,16));
  if(!await crypto.subtle.verify('HMAC',validKey(key),sig,bytes(s.payload)))fail('save authentication failed');
  const raw=JSON.parse(s.payload),version=record(raw,'save').schemaVersion;
  const b:SaveBody=version===1?v1(raw):version===2?v2(raw):v3(raw);
  if(!same(b.limits,limits)||b.journal.length>limits.maxJournalEntries)fail('save limits mismatch');
  let previous=0;
  for(const r of b.journal){
    if(r.committedRevision<=previous||r.committedRevision>b.revision)fail('invalid journal order');
    const parsed=JSON.parse(r.payload);if(fingerprint(parsed)!==r.payload)fail('invalid journal fingerprint');
    canonical(r.result);previous=r.committedRevision;
  }
  achievementReceipts(b.journal);
  if(b.schemaVersion!==1&&((b.revision===1)!==(b.previousTag===null)))fail('invalid previous commit link');
  return b;
}
class RailwayDB extends Dexie {
  heads!:Table<Head,string>;
  slots!:Table<Slot,string>;
  keys!:Table<KeyRow,string>;
  constructor(name:string){super(name);this.version(1).stores({heads:'companyId',slots:'key',keys:'companyId'});}
}
type Read={head:Head|undefined;active:Slot|undefined;mirror:Slot|undefined;key:KeyRow|undefined};
type View={revision:number;tag:string;snapshot:DispatchSnapshot;recoveryRequired:boolean;clock?:OfflineClock;catchupPending?:boolean};
type Loaded={read:Read;body:SaveBody;seal:SealedRailwaySave;controller:Controller;view:View};
const cursor=object({revision:pos,tag:sha256});
/** One authoritative railway namespace, not the manufacturing game's legacy DB.
 * Every proposal is computed with an isolated R34/R35/R36 controller outside IDB.
 * Only a read/write CAS transaction can publish it. Non-extractable local HMAC
 * detects untrusted imports and corruption, not a compromised same-origin script
 * or a full old database rollback. No remote anti-cheat claim. */
export function createRailwayStore(runtime:Runtime,limitsInput:unknown,options:{databaseName?:string;offlinePolicy?:unknown}={}){
  const limits=limitDecoder(limitsInput),companyId=id(runtime.companyId),configurationSha256=sha256(runtime.configurationSha256);
  const offline=options.offlinePolicy===undefined?null:decodeOfflinePolicy(options.offlinePolicy);
  if(offline?.autoSettleArrivals&&!runtime.supportsLifecycle)fail('automatic settlement requires R35 lifecycle');
  const db=new RailwayDB(options.databaseName??dbName),slot=(s:'active'|'mirror')=>companyId+':'+s;
  async function read():Promise<Read>{
    return db.transaction('r',db.heads,db.slots,db.keys,async()=>({head:await db.heads.get(companyId),active:await db.slots.get(slot('active')),mirror:await db.slots.get(slot('mirror')),key:await db.keys.get(companyId)}));
  }
  function checkHead(r:Read){if(!r.head||!r.key||r.key.companyId!==companyId)fail('no trusted save head or installation key');const h=headDecoder(r.head);if(h.companyId!==companyId)fail('wrong company head');return {head:h,key:validKey((r.key??fail('missing installation key')).key)};}
  async function decode(r:Read,s:unknown){
    const {head,key}=checkHead(r),seal=sealDecoder(s);
    if(seal.tag!==head.tag)fail('not latest committed save');
    const body=await decodeRailwaySave(seal,key,limits);
    if(body.companyId!==companyId||body.configurationSha256!==configurationSha256||body.revision!==head.revision)fail('save identity or revision mismatch');
    const controller=await runtime.openPersisted(body.snapshot,body.quotes);
    if(body.schemaVersion===3){if(!offline)fail('offline clock policy required');checkClock(body.clock,offline,controller.snapshot().simTimeS);}
    if(body.journal.some(r=>r.kind==='achievement')){const f=await controller.inspectFinance();projectAchievements(f.governance.missions,body.journal,f.governance.policySha256,f.simTimeS);}
    // A committed dispatch/terminal/fleet result is bound by the actual domain
    // history; the durable wrapper journal adds identity for quote/bulk/advance.
    return {body,seal,controller};
  }
  const viewFor=(body:SaveBody,seal:SealedRailwaySave,c:Controller,recoveryRequired=false):View=>({revision:body.revision,tag:seal.tag,snapshot:c.snapshot(),recoveryRequired,...(body.schemaVersion===3?{clock:structuredClone(body.clock),catchupPending:pending(c,body.clock)}:{})});
  async function load(r:Read):Promise<Loaded>{
    checkHead(r);
    let active:Awaited<ReturnType<typeof decode>>|undefined,mirror:Awaited<ReturnType<typeof decode>>|undefined;
    try{if(r.active?.key===slot('active'))active=await decode(r,r.active.seal);}catch{/* explicit mirror recovery, never older history */}
    try{if(r.mirror?.key===slot('mirror'))mirror=await decode(r,r.mirror.seal);}catch{/* explicit mirror repair */}
    const x=active??mirror??fail('no valid latest copy; authenticated export required');
    if(active&&mirror&&!same(active.seal,mirror.seal))fail('divergent authenticated latest copies');
    return {read:r,...x,view:viewFor(x.body,x.seal,x.controller,!active||!mirror)};
  }
  function checkExpected(v:View,e:unknown){const c=cursor(e);if(c.revision!==v.revision||c.tag!==v.tag)fail('STALE_DURABLE_REVISION');}
  async function publish(before:Read,body:CurrentBody,seal:SealedRailwaySave){
    await db.transaction('rw',db.heads,db.slots,db.keys,async()=>{
      const h=await db.heads.get(companyId),a=await db.slots.get(slot('active')),m=await db.slots.get(slot('mirror')),k=await db.keys.get(companyId);
      if(!k||!same(h,before.head)||!same(a,before.active)||!same(m,before.mirror))fail('STALE_DURABLE_REVISION');
      await db.slots.put({key:slot('active'),seal});
      await db.slots.put({key:slot('mirror'),seal});
      await db.heads.put({companyId,revision:body.revision,tag:seal.tag});
    });
  }
  const bodyFor=(l:Loaded,snapshot:unknown,quotes:unknown,journal:Journal[],clock?:OfflineClock):CurrentBody=>{
    const base:Body={format:'railway-ceo-save',schemaVersion:2,companyId,configurationSha256,revision:checkedAdd(l.body.revision,1),previousTag:l.seal.tag,limits,snapshot,quotes,journal};
    const current=clock??(l.body.schemaVersion===3?l.body.clock:undefined);
    return current?{...base,schemaVersion:3,clock:current}:base;
  };
  async function recoveryCursor(){const {head}=checkHead(await read());return {revision:head.revision,tag:head.tag};}
  async function presence(){const r=await read();return !r.head&&!r.active&&!r.mirror&&!r.key?'absent' as const:r.head&&r.key&&(r.active||r.mirror)?'present' as const:'incomplete' as const;}
  async function initialize(start:unknown,seed:unknown,opening:unknown):Promise<View>{
    const c=await runtime.initialize(start,seed,opening),key=await createRailwaySaveKey();
    const body:Body={format:'railway-ceo-save',schemaVersion:2,companyId,configurationSha256,revision:1,previousTag:null,limits,snapshot:c.snapshot(),quotes:[],journal:[]};
    const seal=await sealRailwaySave(body,key);
    await db.transaction('rw',db.heads,db.slots,db.keys,async()=>{
      if(await db.heads.get(companyId)||await db.keys.get(companyId)||await db.slots.get(slot('active'))||await db.slots.get(slot('mirror')))fail('save already exists or incomplete initialization');
      await db.keys.add({companyId,key});
      await db.slots.add({key:slot('active'),seal});
      await db.slots.add({key:slot('mirror'),seal});
      await db.heads.add({companyId,revision:1,tag:seal.tag});
    });
    return {revision:1,tag:seal.tag,snapshot:c.snapshot(),recoveryRequired:false};
  }
  async function open():Promise<View>{
    const l=await load(await read());
    if(l.body.schemaVersion===1&&!l.view.recoveryRequired){
      const body=bodyFor(l,l.body.snapshot,l.body.quotes,l.body.journal),seal=await sealRailwaySave(body,l.read.key!.key);
      await publish(l.read,body,seal);
      return {revision:body.revision,tag:seal.tag,snapshot:l.controller.snapshot(),recoveryRequired:false};
    }
    return l.view;
  }
  // Read one authenticated durable head and its projections; never publish a candidate.
  async function management(){
    const l=await load(await read());
    return {view:l.view,management:await l.controller.inspectManagement()};
  }
  async function progressionView(){
    const l=await load(await read()),f=await l.controller.inspectFinance();
    return {view:l.view,companyId:f.companyId,missions:projectAchievements(f.governance.missions,l.body.journal,f.governance.policySha256,f.simTimeS),unlocks:f.governance.unlocks,events:f.progressionEvents,eventEffectsEnabled:false,onlineEnabled:false};
  }
  async function financeView(){const l=await load(await read());return {view:l.view,finance:await l.controller.inspectFinance()};}
  async function checkManagement(input:unknown,expected:unknown){
    const q=request(input),captured:unknown=JSON.parse(fingerprint(q.input)),e=cursor(expected);
    const l=await load(await read());checkExpected(l.view,e);
    try{
      if(l.view.recoveryRequired||l.body.schemaVersion===1)fail('recover or migrate save first');
      if(l.body.journal.length>=limits.maxJournalEntries)fail('journal limit; export and reconciled checkpoint required');
      const c=l.controller,checksum=c.snapshot().checksum,clock=l.body.schemaVersion===3?l.body.clock:undefined;
      if(offline&&(!clock||pending(c,clock)))fail('offline clock requires catch-up before commands');
      if(q.kind==='dispatch'||q.kind==='bulk'||q.kind==='settle'||q.kind==='cancel'||q.kind==='fleet'){
        for(const value of q.kind==='bulk'?list(raw)(captured):[captured]){
          const row=record(value,'manual command');if(typeof row.commandId==='string'&&row.commandId.startsWith(AUTO_SETTLEMENT_PREFIX))fail('reserved automatic settlement command ID');
        }
      }
      let result:unknown;
      switch(q.kind){        case 'achievement':{
        if(c.snapshot().pendingEvents.some(e=>e.simTimeS<=c.snapshot().simTimeS))fail('process due events before achievement claim');
        const f=await c.inspectFinance();result=claimAchievement(f.governance.missions,l.body.journal,f.governance.policySha256,f.simTimeS,captured);break;
      }
      case 'finance':result=(await c.finance(captured,checksum)).result;break;
      case 'quote':result=await c.quoteTrip(captured,checksum);break;
        case 'dispatch':result=(await c.dispatch(captured,checksum)).receipt;break;
        case 'bulk':result=(await c.bulkDispatch(captured,checksum)).results;break;
        case 'fleet':{const r=await c.fleetCommand(captured,checksum);const m=await c.inspectManagement();result={receipt:r.receipt,job:m.rows.find(x=>x.trainId===r.receipt.trainId)?.maintenance.activeJob??null};break;}
        case 'settle':result=(await c.settle(captured,checksum)).receipt;break;
        case 'cancel':result=(await c.cancel(captured,checksum)).receipt;break;
        default:fail('not a management command');
      }
      return {ok:true as const,result};
    }catch(e){return {ok:false as const,reason:e instanceof Error?e.message:String(e)};}
  }
  async function execute(input:unknown,expected:unknown){
    const q:Request=request(input),payload=fingerprint(q.input),captured:unknown=JSON.parse(payload),expectedCursor=cursor(expected);
    if(payload.length>1000000)fail('command payload limit');
    const l=await load(await read());
    if(l.view.recoveryRequired||l.body.schemaVersion===1)fail('recover or migrate save first');
    const old=l.body.journal.find(r=>r.requestId===q.requestId);
    if(old){if(old.kind!==q.kind||old.payload!==payload)fail('durable command ID conflict');return {view:l.view,result:old.result,committedRevision:old.committedRevision,replayed:true};}
    checkExpected(l.view,expectedCursor);
    if(l.body.journal.length>=limits.maxJournalEntries)fail('journal limit; export and reconciled checkpoint required');
    if(q.kind==='dispatch'||q.kind==='bulk'||q.kind==='settle'||q.kind==='cancel'||q.kind==='fleet'){
      for(const value of q.kind==='bulk'?list(raw)(captured):[captured]){
        const row=record(value,'manual command');
        if(typeof row.commandId==='string'&&row.commandId.startsWith(AUTO_SETTLEMENT_PREFIX))fail('reserved automatic settlement command ID');
      }
    }
    const c=l.controller,checksum=c.snapshot().checksum;
    let clock=l.body.schemaVersion===3?l.body.clock:undefined;
    if(offline&&q.kind!=='catchup'&&(!clock||pending(c,clock)||q.kind==='advance'))fail('offline clock requires catch-up before commands; raw advance disabled');
    if(!offline&&q.kind==='catchup')fail('offline clock not configured');
    // Only explicit production commands, never a user-supplied snapshot or event.
    let result:unknown;
    switch(q.kind){
      case 'catchup':{
        const p=offline??fail('offline clock not configured'),a=catchupInput(captured),t=c.snapshot().simTimeS;
        if(!clock&&!a.sample)fail('clock anchor sample required');
        const observed=clock&&a.sample?observeClock(clock,a.sample,t):null;
        clock=observed?.clock??clock??anchorClock(p,a.sample,t);
        result={observation:observed?{creditedSimS:observed.creditedSimS,creditedWallMs:observed.creditedWallMs,discardedWallMs:observed.discardedWallMs,rollback:observed.rollback,monotonicAnomaly:observed.monotonicAnomaly}:null,...await runCatchupBatch(c,clock,p)};
        break;
      }
      case 'achievement':{
        if(c.snapshot().pendingEvents.some(e=>e.simTimeS<=c.snapshot().simTimeS))fail('process due events before achievement claim');
        const f=await c.inspectFinance();result=claimAchievement(f.governance.missions,l.body.journal,f.governance.policySha256,f.simTimeS,captured);break;
      }
      case 'finance':result=(await c.finance(captured,checksum)).result;break;
      case 'quote':result=await c.quoteTrip(captured,checksum);break;
      case 'dispatch':{const {snapshot,...r}=await c.dispatch(captured,checksum);result=r;break;}
      case 'bulk':{const {snapshot,...r}=await c.bulkDispatch(captured,checksum);result=r;break;}
      case 'settle':{const {snapshot,...r}=await c.settle(captured,checksum);result=r;break;}
      case 'cancel':{const {snapshot,...r}=await c.cancel(captured,checksum);result=r;break;}
      case 'fleet':{const {snapshot,...r}=await c.fleetCommand(captured,checksum);result=r;break;}
      case 'advance':{const a=object({target:integer,budget:pos})(captured),{snapshot,...r}=await c.advance(a.target,a.budget,checksum);result=r;break;}
    }
    const revision=checkedAdd(l.body.revision,1),journal=[...l.body.journal,{requestId:q.requestId,kind:q.kind,payload,committedRevision:revision,result}];
    if(q.kind==='achievement'){const f=await c.inspectFinance();projectAchievements(f.governance.missions,journal,f.governance.policySha256,f.simTimeS);}
    const body=bodyFor(l,c.snapshot(),c.issuedQuotes(),journal,clock),seal=await sealRailwaySave(body,l.read.key!.key);
    // Revalidate production state and persisted quote registry before publishing.
    await runtime.openPersisted(body.snapshot,body.quotes);
    await publish(l.read,body,seal);
    return {view:viewFor(body,seal,c),result,committedRevision:revision,replayed:false};
  }
  async function recover(expected:unknown,exported?:unknown):Promise<View>{
    const r=await read(),{head}=checkHead(r);checkExpected({revision:head.revision,tag:head.tag,snapshot:null as unknown as DispatchSnapshot,recoveryRequired:true},expected);
    const x=exported===undefined?await load(r):await decode(r,exported);
    // Restore identical latest authenticated payload only; no economic rollback,
    // duplicate reward, stale quote reactivation or silent receipt eviction.
    await db.transaction('rw',db.heads,db.slots,db.keys,async()=>{
      if(!same(await db.heads.get(companyId),r.head)||!same(await db.slots.get(slot('active')),r.active)||!same(await db.slots.get(slot('mirror')),r.mirror)||!await db.keys.get(companyId))fail('STALE_DURABLE_REVISION');
      await db.slots.put({key:slot('active'),seal:x.seal});await db.slots.put({key:slot('mirror'),seal:x.seal});
    });
    return viewFor(x.body,x.seal,x.controller);
  }
  async function exportLatest(){const l=await load(await read());return structuredClone(l.seal);}
  return Object.freeze({presence,recoveryCursor,initialize,open,management,financeView,progressionView,checkManagement,execute,recover,exportLatest,close:()=>db.close()});
}
