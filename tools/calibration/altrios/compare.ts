import {RollingStockCatalog,type CatalogField} from '../../../src/rail/catalog';
import {estimateEnergy} from '../../../src/rail/economy/energy';
import {segmentDuration} from '../../../src/rail/movement';
import {object,list,distinct,id,enumeration,sha256,nullable,version1,text} from '../../../src/domain/validation';
import {integer} from '../../../src/domain/units';

export const PIN='aecad5e702403c3a39947e7668af54ebfaefddd5';
export const TREE='d05bc45192ce2f2fafa5719df467db793419fa22';
const fail=(s:string):never=>{throw Error('R37: '+s);};
const positive=(v:unknown,p='positive')=>integer(v,p,1);
const numeric=(v:unknown,p='number')=>typeof v==='number'&&Number.isFinite(v)?v:fail(p+' invalid');
const pos=(v:unknown,p='positive')=>{const n=numeric(v,p);return n>0?n:fail(p+' not positive');};
const caseShape={id,split:enumeration(['fit','holdout']),origin:enumeration(['A','B']),destination:enumeration(['A','B']),loadedCars:integer,emptyCars:integer,locomotives:positive};
const caseDecoder=object(caseShape);
const ramp=object({accelerationS:positive,brakingS:positive});
const rowDecoder=object({...caseShape,inputSha256:sha256,traceSha256:sha256,distanceM:positive,durationS:pos,fuelJ:pos,sourceSpeedKmh:positive,ramp:nullable(ramp),massKg:pos,maxSpeedMps:pos,startSpeedMps:numeric,endSpeedMps:numeric});
const sourceDecoder=(v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('source hashes');const r=v as Record<string,unknown>;return Object.fromEntries(Object.entries(r).map(([k,x])=>[k,sha256(x)]));};
const oracleDecoder=object({schemaVersion:version1,kind:enumeration(['EXECUTED_ALTRIOS_RESEARCH','SYNTHETIC_HARNESS_TEST']),commit:sha256Like40,tree:sha256Like40,manifestSha256:sha256,sourceSha256:sourceDecoder,nativeSha256:sha256,python:text(40),fuelJPerMl:pos,fuelSource:text(240),rows:distinct(list(rowDecoder,1,1000),r=>r.id)});
function sha256Like40(v:unknown){return text(40,/^[a-f0-9]{40}$/)(v);}
const manifestDecoder=object({schemaVersion:version1,status:enumeration(['RESEARCH_ONLY']),description:text(1000),cases:distinct(list(caseDecoder,1,1000),r=>r.id)});
type Row=ReturnType<typeof rowDecoder>;
const median=(a:number[])=>{const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2;};
const nearestRank=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.ceil(p*a.length)-1];
const summarize=(xs:number[])=>xs.length?{n:xs.length,medianAbsRelativeError:median(xs),p95AbsRelativeError:nearestRank(xs,.95),maxAbsRelativeError:Math.max(...xs)}:null;
const error=(prediction:number,observed:number)=>Math.abs(prediction-observed)/observed;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const fields:CatalogField[]=['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm'];
const conversion=42.6*1000*3206/3785.411784;
export function decodeResearch(oracle:unknown,manifest:unknown){
  const o=oracleDecoder(oracle),m=manifestDecoder(manifest);
  if(o.commit!==PIN||o.tree!==TREE)fail('wrong oracle pin');
  if(o.rows.length!==m.cases.length||!m.cases.every(c=>o.rows.some(r=>same(caseDecoder(Object.fromEntries(Object.keys(caseShape).map(k=>[k,r[k as keyof Row]]))),c))))fail('oracle/manifest mismatch');
  const fit=o.rows.filter(r=>r.split==='fit').sort((a,b)=>a.loadedCars-b.loadedCars),hold=o.rows.filter(r=>r.split==='holdout').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(fit.length<3||hold.length<3)fail('insufficient fit or holdout cases');
  if(o.kind==='EXECUTED_ALTRIOS_RESEARCH'&&(!/^3\.(10|11)\./.test(o.python)||Object.keys(o.sourceSha256).length<6||Math.abs(o.fuelJPerMl/conversion-1)>1e-12))fail('unverified oracle environment or conversion');
  const first=fit[0];
  const loads=new Set(fit.map(r=>r.loadedCars));
  if(loads.size!==fit.length||hold.some(r=>loads.has(r.loadedCars)||r.origin!==first.destination||r.destination!==first.origin||r.loadedCars<fit[0].loadedCars||r.loadedCars>fit.at(-1)!.loadedCars))fail('holdout overlap or extrapolation');
  if(fit.some(r=>r.origin!==first.origin||r.destination!==first.destination)||o.rows.some(r=>r.loadedCars+r.emptyCars!==first.loadedCars+first.emptyCars||r.locomotives!==first.locomotives||r.sourceSpeedKmh!==first.sourceSpeedKmh||r.origin===r.destination))fail('unmatched consist or speed family');
  return {o,m,fit,hold};
}
/** Fit only effective aggregate mL/km by load. No separate grade, idle, regen
 * or auxiliary estimates are inferred from total fuel. R23 is exercised through
 * its actual catalog and estimator. R33 comparison conditions on the measured
 * path length and source speed limit, not on held-out journey time. */
export async function compareResearch(oracle:unknown,manifest:unknown){
  const {o,fit,hold}=decodeResearch(oracle,manifest);
  const points=fit.map(r=>({loadedCars:r.loadedCars,mlPerKm:r.fuelJ/o.fuelJPerMl*1000/r.distanceM}));
  const nominal=positive(Math.ceil(points[0].mlPerKm));
  const r33Fit=fit.filter(r=>r.ramp!==null);
  const ramps=r33Fit.length===fit.length?{accelerationS:Math.ceil(median(r33Fit.map(r=>r.ramp!.accelerationS))),brakingS:Math.ceil(median(r33Fit.map(r=>r.ramp!.brakingS)))}:null;
  const catalog=await RollingStockCatalog.prepare({schemaVersion:1,id:'r37-research-only',revision:1,currency:'INR',entries:[{name:'Synthetic adapter only',kind:'locomotive',identity:'fictional',modelRevision:1,model:{id:'r37-adapter',traction:'diesel',gaugesMm:[1435],voltagesV:[],frequenciesHz:[],maxSpeedKmh:fit[0].sourceSpeedKmh,rangeM:1000000,capacitySeats:0,cargoCapacityKg:0,purchasePriceMinor:'0',massKg:1,provenance:{sourceUrl:'urn:railway:r37-research-adapter',sourceId:'r37',sourceVersion:'1',license:'original-fixture',qualityFlags:['RESEARCH_ONLY','NOT_INDIAN_CALIBRATION']}},energyPerKm:[{mode:'diesel',unit:'mL',quantityPerKm:String(nominal)}],fieldOrigins:fields.map(field=>({field,classification:'game-balanced',evidenceId:null}))}]});
  const ref=catalog.reference('r37-adapter');
  const factor=(load:number)=>{
    const i=points.findIndex(p=>p.loadedCars>=load);
    if(i<1)fail('unsupported holdout interpolation');
    const a=points[i-1],b=points[i],rate=a.mlPerKm+(b.mlPerKm-a.mlPerKm)*(load-a.loadedCars)/(b.loadedCars-a.loadedCars);
    return integer(Math.round(rate/nominal*10000),'effective load factor',1,100000);
  };
  const rows=hold.map(r=>{
    const loadFactorBps=factor(r.loadedCars);
    // No separate idle or auxiliary coefficient is fitted. Effective aggregate
    // rate includes both. Running time only satisfies R23 moving-segment contract.
    const duration=ramps&&Math.abs(r.startSpeedMps)<=.01&&Math.abs(r.endSpeedMps)<=.01?segmentDuration(r.distanceM,r.sourceSpeedKmh,ramps.accelerationS,ramps.brakingS):null;
    const energy=estimateEnergy(catalog,ref,[{mode:'diesel',distanceM:r.distanceM,runningS:duration??1,idleS:0,loadFactorBps,gradeFactorBps:10000,idleQuantityPerHour:'0',auxQuantityPerHour:'0',requestedRegenWh:'0',maxRegenBps:0}]);
    const quantity=energy.energy.find(x=>x.unit==='mL')?.quantity??fail('missing R23 fuel');
    const predictedJ=Number(quantity)*o.fuelJPerMl;
    if(!Number.isFinite(predictedJ))fail('nonfinite prediction');
    return {id:r.id,loadedCars:r.loadedCars,matchedDistanceM:r.distanceM,sourceSpeedKmh:r.sourceSpeedKmh,loadFactorBps,estimatedMl:quantity,observedFuelJ:r.fuelJ,predictedFuelJ:predictedJ,energyAbsErrorJ:Math.abs(predictedJ-r.fuelJ),energyRelativeError:error(predictedJ,r.fuelJ),observedDurationS:r.durationS,predictedDurationS:duration,durationRelativeError:duration===null?null:error(duration,r.durationS)};
  });
  const energy=summarize(rows.map(r=>r.energyRelativeError)),movement=summarize(rows.flatMap(r=>r.durationRelativeError===null?[]:[r.durationRelativeError]));
  return {schemaVersion:1,status:'RESEARCH_ONLY_NOT_CALIBRATED',kind:o.kind,sourceCommit:o.commit,manifestSha256:o.manifestSha256,nativeSha256:o.nativeSha256,catalogSha256:catalog.sha256,fitCaseIds:fit.map(r=>r.id),holdoutCaseIds:hold.map(r=>r.id),effectiveNominalMlPerKm:String(nominal),fitPoints:points,ramps,rows,energy,movement,proposedEnvelope:energy?{medianWithin15Percent:energy.medianAbsRelativeError<=.15,p95Within30Percent:energy.p95AbsRelativeError<=.30}:null,productionAccepted:false,limitations:['Unapproved experimental US freight corridor; reverse-direction holdout same corridor family','Conditional on measured path distance, integer km/h ceiling; no independent topology validation','Effective aggregate rate cannot identify separate idle, grade, auxiliary or regen','No electric, steam, passenger or Indian fleet/railway validation','Three holdouts are not a robust p95 or approved scenario range']};
}
