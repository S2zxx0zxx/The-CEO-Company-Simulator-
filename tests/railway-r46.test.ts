import {describe,it,expect} from 'vitest';
import {fixture} from './fixtures/railway-r39';
import {RollingStockCatalog} from '../src/rail/catalog';
import {catalogCard,stockCategory,catalogReferenceKey} from '../src/rail/catalog/presentation';
describe('R46 catalogue presentation uses the R12 authority',()=>{
 it('projects exact identity, units and origin without mutating the catalogue',async()=>{
  const {authority,catalog}=await fixture(),m=await authority.inspectManagement(),e=m.models[0],before=JSON.stringify(catalog.snapshot()),c=catalogCard(m.catalogIdentity,e);
  expect(c.reference).toEqual(catalog.reference(e.model.id));expect(c.category).toBe('diesel');
  expect(c.rows.map(r=>r.field).sort()).toEqual(e.fieldOrigins.map(o=>o.field).sort());
  expect(c.rows.find(r=>r.field==='purchasePriceMinor')).toMatchObject({value:'₹10.00',classification:'game-balanced',evidenceId:null});
  expect(c.rows.find(r=>r.field==='energyPerKm')?.value).toBe('60 mL/km (diesel)');
  expect(JSON.stringify(catalog.snapshot())).toBe(before);
 });
 it('shows unknown nominal consumption without treating it as zero; exact reference changes',async()=>{
  const {catalog}=await fixture(),s=catalog.snapshot(),e=s.entries[0];if(!('energyPerKm' in e))throw Error('fixture');
  const modified={...e,name:'Synthetic electric QA',model:{...e.model,id:'qa-electric',traction:'electric',voltagesV:[25000],frequenciesHz:[0]},energyPerKm:[]};
  const next=await RollingStockCatalog.prepare({...s,revision:s.revision+1,entries:[modified]});
  const n=next.entry('qa-electric'),ref=next.reference('qa-electric'),card=catalogCard({catalogId:ref.catalogId,catalogRevision:ref.catalogRevision,catalogSha256:ref.catalogSha256},n);
  expect(stockCategory(n)).toBe('electric');expect(card.rows.find(x=>x.field==='energyPerKm')?.value).toBe('Not supplied');
  expect(card.rows.find(x=>x.field==='frequenciesHz')?.value).toBe('0 Hz (DC)');expect(card.key).not.toBe(catalogReferenceKey(catalog.reference(e.model.id)));
 });
 it('no independent traction/range values for an unpowered car',async()=>{
  const {catalog}=await fixture(),s=catalog.snapshot(),base=s.entries[0],m=base.model;
  const coach={name:'Synthetic coach QA',kind:'passenger-coach',identity:'fictional',modelRevision:1,model:{id:'qa-coach',gaugesMm:m.gaugesMm,maxSpeedKmh:m.maxSpeedKmh,capacitySeats:m.capacitySeats,cargoCapacityKg:0,purchasePriceMinor:m.purchasePriceMinor,massKg:m.massKg,provenance:m.provenance},fieldOrigins:base.fieldOrigins.filter(x=>!['traction','rangeM','voltagesV','frequenciesHz','energyPerKm'].includes(x.field))};
  const next=await RollingStockCatalog.prepare({...s,entries:[coach]}),e=next.entry('qa-coach'),ref=next.reference(e.model.id),c=catalogCard({catalogId:ref.catalogId,catalogRevision:ref.catalogRevision,catalogSha256:ref.catalogSha256},e);
  expect(c.category).toBe('passenger-coach');expect(c.rows.some(x=>x.field==='traction'||x.field==='rangeM'||x.field==='energyPerKm')).toBe(false);
 });
});
