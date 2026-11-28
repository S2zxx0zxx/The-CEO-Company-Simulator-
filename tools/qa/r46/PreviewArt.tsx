// Original geometric category studies authored for R46 visual review only.
// No source images, model names, logos, external assets, traced silhouettes or real specifications.
// The marker below is checked against production dist; this file must never be imported by src/.
import type {StockCategory} from '../../../src/rail/catalog/presentation';
const shades:Record<StockCategory,string>={diesel:'#365d59',electric:'#42658a',steam:'#63504b',dual:'#745d86','passenger-coach':'#456e85','freight-wagon':'#8c6247'};
export function DraftRailArt({category}:{category:StockCategory}){
 const coach=category==='passenger-coach',wagon=category==='freight-wagon',steam=category==='steam',electric=category==='electric'||category==='dual';
 return <svg role="img" aria-label={'Generic '+category+' concept; not an actual model likeness'} data-art-scope="R46_DRAFT_ART_ONLY" viewBox="0 0 320 144" width="100%" style={{display:'block',maxHeight:180}}>
  <rect x="1" y="1" width="318" height="142" rx="12" fill="#e7e6dc"/>
  <path d="M24 113H296M31 121H289" stroke="#a39d8e" strokeWidth="2"/>
  <path d="M44 117L277 117" stroke="#374152" strokeWidth="3"/>
  {wagon?<><path d="M52 51H268L250 99H70Z" fill={shades[category]} stroke="#273342" strokeWidth="3"/><path d="M82 57V89M123 57V93M165 57V93M207 57V93M249 57V89" stroke="#bc9a79" strokeWidth="4"/></>:steam?<><rect x="62" y="63" width="166" height="36" rx="18" fill={shades[category]} stroke="#273342" strokeWidth="3"/><path d="M66 63L66 49H91V63M195 67V39H252V98H220V67Z" fill="#5b5350" stroke="#273342" strokeWidth="3"/><rect x="205" y="48" width="29" height="24" rx="3" fill="#b5c8cc"/><path d="M115 63V53H132V63" fill="#b78e63"/></>:<>
   <path d={coach?'M42 51Q42 43 52 43H268Q278 43 278 53V99H42Z':electric?'M40 60L61 43H245L279 71V99H40Z':'M42 66H150V48H237L274 67V99H42Z'} fill={shades[category]} stroke="#273342" strokeWidth="3"/>
   {coach?[56,91,126,161,196,231].map(x=><rect key={x} x={x} y="54" width="26" height="21" rx="3" fill="#c5d8d7"/>):<><path d={electric?'M230 52H248L264 68H230Z':'M204 56H231L253 70H204Z'} fill="#b8ced0" stroke="#273342" strokeWidth="2"/><path d="M60 69H126M60 75H126M60 81H126" stroke="#243c43" strokeWidth="2"/></>}
   <path d="M46 91H271" stroke="#c8a86b" strokeWidth="5"/>
   {electric&&<path d="M126 42L145 27H175L195 42M139 27H181M160 27V22" fill="none" stroke="#415365" strokeWidth="3" strokeLinecap="round"/>}
  </>}
  <rect x="48" y="98" width="225" height="8" rx="3" fill="#303843"/>
  {[78,110,216,248].map(x=><g key={x}><circle cx={x} cy="107" r="10" fill="#26313a"/><circle cx={x} cy="107" r="4" fill="#a2a5a2"/></g>)}
  {!coach&&!wagon&&<path d="M272 89H286V102H274" fill="#d6bc84" stroke="#273342" strokeWidth="2"/>}
 </svg>;
}
export function DraftRailMark(){return <svg data-art-scope="R46_DRAFT_ART_ONLY" role="img" aria-label="Unapproved original railway symbol concept" width="52" height="52" viewBox="0 0 52 52"><rect width="52" height="52" rx="12" fill="#24394f"/><path d="M13 38L21 15H31L39 38M17 29H35M15 34H37M24 15V9H28V15" fill="none" stroke="#d8b76c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
