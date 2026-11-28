import { decodeTrainModel, decodeTrainProfile, decodeProvenance } from '../../domain/models';
import { integer, gaugeMm, speedKmh, kilograms, seats, minor, energyQuantity } from '../../domain/units';
import { object, record, id, text, sha256, utc, version1, enumeration, distinct, list, nullable, refine, type Decoded } from '../../domain/validation';
import { digest, freezeResult } from '../routing';
import type { ReadonlyTree } from '../graph';

const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const numeric=(a:number,b:number)=>a-b;
const positive=(v:unknown,p?:string)=>integer(v,p,1);
const poweredKind=enumeration(['locomotive','passenger-train','freight-train','mixed-train']);
const unpoweredKind=enumeration(['passenger-coach','freight-wagon']);
const field=enumeration(['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm']);
export type CatalogField=Decoded<typeof field>;
const origin=refine(object({field,classification:enumeration(['game-balanced','verified-fact']),evidenceId:nullable(id)}),o=>(o.classification==='verified-fact')===(o.evidenceId!==null),'classification and evidence disagree');
const nominal=refine(object({mode:enumeration(['diesel','electric','steam']),unit:enumeration(['Wh','mL','g']),quantityPerKm:refine(energyQuantity,q=>q!=='0','positive nominal consumption required')}),x=>x.unit===({diesel:'mL',electric:'Wh',steam:'g'} as const)[x.mode],'traction energy unit mismatch');
const unpoweredModel=object({id,gaugesMm:distinct(list(gaugeMm,1,32),x=>x),maxSpeedKmh:speedKmh,capacitySeats:seats,cargoCapacityKg:kilograms,purchasePriceMinor:minor,massKg:refine(kilograms,x=>x>0,'positive mass required'),provenance:decodeProvenance});
const common={name:text(160),modelRevision:positive,identity:enumeration(['fictional','real-reference']),fieldOrigins:distinct(list(origin,1,13),x=>x.field)};
const powered=object({...common,kind:poweredKind,model:decodeTrainModel,energyPerKm:distinct(list(nominal,0,2),x=>x.mode)});
const unpowered=object({...common,kind:unpoweredKind,model:unpoweredModel});
type Entry=Decoded<typeof powered>|Decoded<typeof unpowered>;
const poweredFields:CatalogField[]=['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm'];
const unpoweredFields:CatalogField[]=['name','kind','gaugesMm','maxSpeedKmh','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg'];
function fail(reason:string):never{throw new TypeError('Catalog: '+reason);}
function normalizeEntry(input:unknown,path='entry'):Entry{
  const raw=record(input,path),isPowered=['locomotive','passenger-train','freight-train','mixed-train'].includes(typeof raw.kind==='string'?raw.kind:'');
  const e=isPowered?powered(input,path):unpowered(input,path),m=e.model;
  m.gaugesMm.sort(numeric);m.provenance.qualityFlags.sort(order);
  if('energyPerKm' in e){
    e.model.voltagesV.sort(numeric);e.model.frequenciesHz.sort(numeric);e.energyPerKm.sort((a,b)=>order(a.mode,b.mode));
    if(e.model.voltagesV.length>1&&e.model.frequenciesHz.length>1)fail('ambiguous voltage-frequency pairs: '+m.id);
    const modes=e.model.traction==='dual'?['diesel','electric']:[e.model.traction];
    if(e.energyPerKm.some(x=>!modes.includes(x.mode)))fail('nominal consumption incompatible with traction: '+m.id);
  }
  const passenger=e.kind==='passenger-train'||e.kind==='passenger-coach',freight=e.kind==='freight-train'||e.kind==='freight-wagon';
  if((passenger&&!(m.capacitySeats>0&&m.cargoCapacityKg===0))||(freight&&!(m.capacitySeats===0&&m.cargoCapacityKg>0))||(e.kind==='locomotive'&&(m.capacitySeats!==0||m.cargoCapacityKg!==0))||(e.kind==='mixed-train'&&!(m.capacitySeats>0&&m.cargoCapacityKg>0)))fail('capacity does not match stock kind: '+m.id);
  const fields='energyPerKm' in e?poweredFields:unpoweredFields;
  if(e.fieldOrigins.length!==fields.length||fields.some(f=>!e.fieldOrigins.some(o=>o.field===f)))fail('every field must have exactly one origin: '+m.id);
  if(e.fieldOrigins.some(o=>o.field==='purchasePriceMinor'&&o.classification!=='game-balanced'))fail('purchase price is game balance, not a factual claim');
  const facts=e.fieldOrigins.filter(o=>o.classification==='verified-fact');
  if(e.identity==='fictional'&&facts.length!==0)fail('fictional stock cannot assert real-world facts');
  if(e.identity==='real-reference'&&(!facts.some(o=>o.field==='name')||!facts.some(o=>o.field!=='name'&&o.field!=='kind')))fail('real-reference requires reviewed identity and at least one specification');
  e.fieldOrigins.sort((a,b)=>order(a.field,b.field));return e;
}
export const decodeCatalog=object({schemaVersion:version1,id,revision:positive,currency:enumeration(['INR']),entries:distinct(list(normalizeEntry,1,10000),x=>x.model.id)});
const evidence=object({id,modelId:id,modelRevision:positive,field,valueSha256:sha256,documentSha256:sha256,reviewedAtUtc:utc,provenance:decodeProvenance});
const evidenceList=distinct(list(evidence,0,130000),x=>x.id);
const reference=object({catalogId:id,catalogRevision:positive,catalogSha256:sha256,modelId:id,modelRevision:positive});
export type CatalogReference=Decoded<typeof reference>;
export type CatalogEntry=ReadonlyTree<Entry>;
export type CatalogSnapshot=ReadonlyTree<Decoded<typeof decodeCatalog>>;
export type ReviewedEvidence=Decoded<typeof evidence>;
/** Hash exactly the canonical field value and model revision. Evidence review itself is external. */
export async function catalogClaimHash(input:unknown,fieldName:unknown):Promise<string>{
  const e=normalizeEntry(input),f=field(fieldName);
  if(!e.fieldOrigins.some(o=>o.field===f))fail('field not present');
  const value=f==='name'?e.name:f==='kind'?e.kind:f==='energyPerKm'&&'energyPerKm' in e?e.energyPerKm:(e.model as unknown as Record<string,unknown>)[f];
  return digest({modelId:e.model.id,modelRevision:e.modelRevision,field:f,value});
}
/** Trusted review entries must be obtained independently of the untrusted catalog. */
export class RollingStockCatalog {
  readonly #snapshot:CatalogSnapshot;readonly #hash:string;readonly #index:ReadonlyMap<string,CatalogEntry>;readonly #reviews:readonly ReadonlyTree<ReviewedEvidence>[];
  private constructor(snapshot:CatalogSnapshot,hash:string,reviews:readonly ReadonlyTree<ReviewedEvidence>[]){this.#snapshot=snapshot;this.#hash=hash;this.#reviews=reviews;this.#index=new Map(snapshot.entries.map(e=>[e.model.id,e]));Object.freeze(this);}
  static async prepare(input:unknown,trustedEvidence:unknown=[]):Promise<RollingStockCatalog>{
    const c=decodeCatalog(input),reviews=new Map(evidenceList(trustedEvidence).map(e=>[e.id,e]));c.entries.sort((a,b)=>order(a.model.id,b.model.id));
    const used:ReviewedEvidence[]=[];
    for(const e of c.entries)for(const o of e.fieldOrigins){if(o.classification==='verified-fact'){
      const r=reviews.get(o.evidenceId!);
      if(!r||r.modelId!==e.model.id||r.modelRevision!==e.modelRevision||r.field!==o.field||r.valueSha256!==await catalogClaimHash(e,o.field))return fail('missing or mismatched trusted factual evidence: '+e.model.id+'/'+o.field);
      r.provenance.qualityFlags.sort(order);used.push(r);
    }}
    used.sort((a,b)=>order(a.id,b.id));
    return new RollingStockCatalog(freezeResult(c),await digest({catalog:c,reviewedEvidence:used}),freezeResult(used));
  }
  static async open(input:unknown,expectedSha256:unknown,trustedEvidence:unknown=[]):Promise<RollingStockCatalog>{
    const hash=sha256(expectedSha256),c=await RollingStockCatalog.prepare(input,trustedEvidence);if(c.sha256!==hash)fail('catalog digest mismatch');return c;
  }
  get sha256():string{return this.#hash;}
  snapshot():CatalogSnapshot{return this.#snapshot;}
  reviewedEvidence():readonly ReadonlyTree<ReviewedEvidence>[]{return this.#reviews;}
  entry(modelId:unknown):CatalogEntry{const key=id(modelId),e=this.#index.get(key);return e??fail('unknown model: '+key);}
  reference(modelId:unknown):Readonly<CatalogReference>{const e=this.entry(modelId);return Object.freeze({catalogId:this.#snapshot.id,catalogRevision:this.#snapshot.revision,catalogSha256:this.#hash,modelId:e.model.id,modelRevision:e.modelRevision});}
  resolve(input:unknown):CatalogEntry{const r=reference(input);if(r.catalogId!==this.#snapshot.id||r.catalogRevision!==this.#snapshot.revision||r.catalogSha256!==this.#hash)fail('stale catalog reference');const e=this.entry(r.modelId);if(e.modelRevision!==r.modelRevision)fail('stale model revision');return e;}
  /** Powered model profile only. Unpowered cars require a future consist calculation. */
  profile(input:unknown){const e=this.resolve(input);if(!('energyPerKm' in e))return fail('unpowered rolling stock has no independent routing profile');const m=e.model;return freezeResult(decodeTrainProfile({id:m.id,traction:m.traction,gaugesMm:m.gaugesMm,voltagesV:m.voltagesV,frequenciesHz:m.frequenciesHz,maxSpeedKmh:m.maxSpeedKmh,rangeM:m.rangeM,massKg:m.massKg}));}
}
