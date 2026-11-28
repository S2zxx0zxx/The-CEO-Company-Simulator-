import {useState,type ReactNode} from 'react';
import {TrainFront} from 'lucide-react';
import {catalogCard,stockCategory,catalogReferenceKey,type CatalogIdentity,type StockCategory} from '../../rail/catalog/presentation';
import type {CatalogEntry} from '../../rail/catalog';
const categories:readonly StockCategory[]=['diesel','electric','steam','dual','passenger-coach','freight-wagon'];
const pageSize=24; // UI presentation bound, not a roster or economy limit.
export function RailwayCatalogPanel({models,identity,preview}:{models:readonly CatalogEntry[];identity:CatalogIdentity;preview?:(entry:CatalogEntry)=>ReactNode}){
 const [search,setSearch]=useState(''),[category,setCategory]=useState('all'),[page,setPage]=useState(0),[selected,setSelected]=useState('');
 const key=(e:CatalogEntry)=>catalogReferenceKey({...identity,modelId:e.model.id,modelRevision:e.modelRevision});
 const query=search.trim().toLowerCase();
 const filtered=models.filter(e=>(category==='all'||stockCategory(e)===category)&&(!query||(e.name+' '+e.model.id).toLowerCase().includes(query)));
 const maxPage=Math.max(0,Math.ceil(filtered.length/pageSize)-1),p=Math.min(page,maxPage),visible=filtered.slice(p*pageSize,(p+1)*pageSize);
 const entry=visible.find(e=>key(e)===selected)??visible[0],card=entry?catalogCard(identity,entry):null;
 return <div aria-label="Validated catalogue">
  <h2>Rolling stock catalogue</h2><p>Only models in the validated catalogue are listed. Game-balanced values are not real-world specifications.</p>
  <div className="rf-form"><label>Search catalogue<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);setSelected('');}}/></label>
  <label>Stock category<select value={category} onChange={e=>{setCategory(e.target.value);setPage(0);setSelected('');}}><option value="all">All categories</option>{categories.map(x=><option key={x} value={x}>{x}</option>)}</select></label></div>
  <p>{filtered.length} matching models · page {p+1} of {maxPage+1}</p>
  {maxPage>0&&<div><button disabled={p===0} onClick={()=>{setPage(p-1);setSelected('');}}>Previous models</button><button disabled={p===maxPage} onClick={()=>{setPage(p+1);setSelected('');}}>Next models</button></div>}
  {!entry||!card?<p role="status">No matching validated models.</p>:<>
   <label>Preview model<select value={key(entry)} onChange={e=>setSelected(e.target.value)}>{visible.map(x=><option key={key(x)} value={key(x)}>{x.name}</option>)}</select></label>
   <section className="rf-sub" aria-label="Model specifications">
    <h3>{entry.name}</h3>
    {preview?preview(entry):<div className="rf-pair"><TrainFront size={36} aria-hidden="true"/><span>Model artwork pending visual approval</span></div>}
    <p>{card.identity==='fictional'?'Fictional / game-balanced model':'Real-reference model with field-level review'} · {card.category}</p>
    {card.rows.map(x=><div key={x.field} className="rf-pair"><span>{x.label}<small style={{display:'block'}}>{x.classification==='verified-fact'?'Reviewed fact: '+x.evidenceId:'Game-balanced'}</small></span><strong>{x.value}</strong></div>)}
    <details><summary>Model identity and provenance</summary><p>Model: {card.reference.modelId} · revision {card.reference.modelRevision}</p><p>Catalogue: {card.reference.catalogId} · revision {card.reference.catalogRevision}</p><code>{card.reference.catalogSha256}</code><p>Source: {card.source.sourceId} · {card.source.sourceVersion}</p><p>License record: {card.source.license}</p><p>{card.source.qualityFlags.join(', ')}</p></details>
   </section>
  </>}
 </div>;
}
