// Presentation is derived from the validated R12 catalogue, never from reference screenshots.
import type {CatalogEntry,CatalogField,CatalogReference} from './index';
export type CatalogIdentity=Pick<CatalogReference,'catalogId'|'catalogRevision'|'catalogSha256'>;
export type StockCategory='diesel'|'electric'|'steam'|'dual'|'passenger-coach'|'freight-wagon';
export function stockCategory(e:CatalogEntry):StockCategory{
 return 'energyPerKm' in e?e.model.traction:e.kind;
}
export function catalogReferenceKey(r:CatalogReference){return JSON.stringify([r.catalogSha256,r.catalogId,r.catalogRevision,r.modelId,r.modelRevision]);}
export function catalogCard(identity:CatalogIdentity,e:CatalogEntry){
 const m=e.model,reference:CatalogReference={...identity,modelId:m.id,modelRevision:e.modelRevision};
 const rows:{field:CatalogField;label:string;value:string;classification:'game-balanced'|'verified-fact';evidenceId:string|null}[]=[];
 function add(field:CatalogField,label:string,value:string){
  const o=e.fieldOrigins.find(x=>x.field===field);if(!o)throw Error('R46: missing validated field origin');
  rows.push({field,label,value,classification:o.classification,evidenceId:o.evidenceId});
 }
 add('name','Model name',e.name);add('kind','Stock type',e.kind);
 if('energyPerKm' in e){
  add('traction','Traction',e.model.traction);
  add('rangeM','Configured range',e.model.rangeM+' m');
  add('voltagesV','Voltage',e.model.voltagesV.length?e.model.voltagesV.map(v=>v+' V').join(', '):'Not applicable');
  add('frequenciesHz','Frequency',e.model.frequenciesHz.length?e.model.frequenciesHz.map(v=>v===0?'0 Hz (DC)':v+' Hz').join(', '):'Not applicable');
  add('energyPerKm','Nominal consumption',e.energyPerKm.length?e.energyPerKm.map(x=>x.quantityPerKm+' '+x.unit+'/km ('+x.mode+')').join('; '):'Not supplied');
 }
 add('gaugesMm','Gauge',m.gaugesMm.map(v=>v+' mm').join(', '));
 add('maxSpeedKmh','Configured max speed',m.maxSpeedKmh+' km/h');
 add('capacitySeats','Seats',String(m.capacitySeats));add('cargoCapacityKg','Cargo capacity',m.cargoCapacityKg+' kg');
 add('massKg','Mass',m.massKg+' kg');
 const n=BigInt(m.purchasePriceMinor);
 add('purchasePriceMinor','Configured game purchase price','₹'+(n/100n).toLocaleString('en-IN')+'.'+String(n%100n).padStart(2,'0'));
 return {reference,key:catalogReferenceKey(reference),category:stockCategory(e),rows,identity:e.identity,source:m.provenance};
}
