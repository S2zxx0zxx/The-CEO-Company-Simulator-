// Research-only adapter. No imports from production entrypoints into this tool.
import {prepareMovement} from '../../../src/rail/movement';
import {RailGraph} from '../../../src/rail/graph';
import {RailCompatibility} from '../../../src/rail/compatibility';
import {RollingStockCatalog,type CatalogField} from '../../../src/rail/catalog';
import {findRoute,profileHash,policyHash} from '../../../src/rail/routing';
import {edge,pack,turn,policy,train} from '../../../tests/fixtures/railway-synthetic';

export const PIN='6d6f1d84b6a132fd10c6556460eec2576eeeb916';
export const TREE='51bfa2c351297da0bfa382ed38e52a4f91c84043';
export const FIXTURE_BLOB='48673193942d4e24f9ff3abe0af0b161a1b6c2c6';
const fail=(m:string):never=>{throw Error('R38: '+m);};
const obj=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('expected object');
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:fail('invalid number');
const int=(v:unknown)=>{const n=num(v);return Number.isSafeInteger(n)&&n>=0?n:fail('invalid nonnegative integer');};
const str=(v:unknown)=>typeof v==='string'&&v.length>0?v:fail('invalid string');
const arr=(v:unknown)=>Array.isArray(v)?v:fail('expected array');
const flag=(v:unknown)=>typeof v==='boolean'?v:fail('invalid boolean');
export function decodeTrace(input:unknown){
  const root=obj(input);
  if(root.status!=='success')fail('OSRD simulation did not succeed');
  const r=obj(root.final_output),positions=arr(r.positions).map(int),times=arr(r.times).map(int),speeds=arr(r.speeds).map(num);
  if(positions.length<2||positions.length!==times.length||positions.length!==speeds.length||positions[0]!==0||times[0]!==0)fail('invalid trace axes');
  if(positions.some((v,i)=>i>0&&v<positions[i-1])||times.some((v,i)=>i>0&&v<times[i-1])||speeds.some(v=>v<0))fail('invalid trace order');
  const distanceM=positions.at(-1)!/1000,durationS=times.at(-1)!/1000;
  if(distanceM!==10400||durationS<=0||speeds[0]>.01||speeds.at(-1)!>.01)fail('unmatched path or endpoint speed');
  const spacing=arr(r.spacing_requirements).map(v=>{const x=obj(v),zone=str(x.zone),startMs=num(x.begin_time),endMs=num(x.end_time);if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||endMs<=startMs)fail('invalid spacing interval');return {zone,startMs,endMs};});
  if(!spacing.length)fail('missing native occupancy');
  return {distanceM,durationS,positions,times,speeds,spacing};
}
type Trace=ReturnType<typeof decodeTrace>;
export function spacingConflict(spacing:Trace['spacing'],shiftS:number){
  const delta=int(shiftS)*1000;if(!Number.isSafeInteger(delta))fail('shift overflow');
  return spacing.some(a=>spacing.some(b=>a.zone===b.zone&&a.startMs<b.endMs+delta&&b.startMs+delta<a.endMs));
}
const fields:CatalogField[]=['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm'];
// Conservative explicitly fictional abstraction: 60 km/h over whole route,
// rather than implying R33 models OSRD's spatial speed sections/rolling stock.
// 10s ramps from original R33 synthetic tests, not fitted coefficients.
export async function buildMatchedMovement(dwell:0|30){
  const g=new RailGraph(pack(dwell?{a:[0,0],b:[1,0],c:[2,0]}:{a:[0,0],b:[1,0]},dwell?[edge('ab','a','b',5200,60),edge('bc','b','c',5200,60)]:[edge('ab','a','b',10400,60)],dwell?[turn('ab','bc')]:[]));
  const c=await RollingStockCatalog.prepare({schemaVersion:1,id:'r38-research',revision:1,currency:'INR',entries:[{name:'Fictional comparison adapter',kind:'locomotive',identity:'fictional',modelRevision:1,model:{id:'r38',traction:'diesel',gaugesMm:[1676],voltagesV:[],frequenciesHz:[],maxSpeedKmh:60,rangeM:20000,capacitySeats:0,cargoCapacityKg:0,purchasePriceMinor:'0',massKg:1,provenance:{sourceUrl:'urn:railway:r38-research',sourceId:'r38',sourceVersion:'1',license:'original-fixture',qualityFlags:['SYNTHETIC_NOT_REAL_DATA']}},energyPerKm:[],fieldOrigins:fields.map(field=>({field,classification:'game-balanced',evidenceId:null}))}]});
  const ref=c.reference('r38'),profile=c.profile(ref),p=policy();
  const operating={mode:'diesel',gaugeMm:1676,voltageV:null,frequencyHz:null};
  const request={routeId:'matched',graphSha256:g.graphSha256,trainProfileSha256:await profileHash(profile),policySha256:await policyHash(p),profile,policy:p,stopIds:dwell?['s-a','s-b','s-c']:['s-a','s-b'],objective:'time',initialOperating:operating,maxLabels:10000,maxWork:100000};
  const route=await findRoute(g,request);if(!route.ok)throw Error(route.reason);
  return prepareMovement(g,c,{schemaVersion:1,resources:[{id:'whole-path',capacity:1}],edges:(dwell?['ab','bc']:['ab']).map(edgeId=>({edgeId,resourceId:'whole-path'})),nodes:dwell?[{nodeId:'b',resourceId:'whole-path'}]:[]},[{id:'matched',catalogReference:ref,request,route,dynamics:{accelerationS:10,brakingS:10,dwellS:dwell?[dwell]:[]}}],['a','b'].map(trainId=>({trainId,catalogReference:ref,nodeId:'a'})),{maxTrips:10,maxPending:20});
}
export async function compareCase(dwell:0|30,traceInput:unknown,conflictsInput:unknown){
  const trace=decodeTrace(traceInput),cases=arr(conflictsInput).map(v=>{const r=obj(v);return {shiftS:int(r.shiftS),osrdSpacingConflict:flag(r.osrdSpacingConflict)};});
  if(cases.length<3||new Set(cases.map(x=>x.shiftS)).size!==cases.length||!cases.some(x=>x.shiftS===0)||!cases.some(x=>x.shiftS>=Math.ceil(trace.durationS)))fail('incomplete conflict probe set');
  const runtime=await buildMatchedMovement(dwell),base=await runtime.initialize(0,123);
  const reserved=await runtime.reserve(base,{tripId:'first',trainId:'a',planId:'matched',departureSimS:10});
  const duration=runtime.plans[0].durationS,rows=[];
  for(const r of cases){
    if(spacingConflict(trace.spacing,r.shiftS)!==r.osrdSpacingConflict)fail('native spacing evidence mismatch');
    let gameConflict=false;
    try{await runtime.reserve(reserved,{tripId:'second',trainId:'b',planId:'matched',departureSimS:10+r.shiftS});}
    catch(e){if(!String(e).includes('capacity'))throw e;gameConflict=true;}
    rows.push({...r,gameConflict,falseNegative:r.osrdSpacingConflict&&!gameConflict,falsePositive:!r.osrdSpacingConflict&&gameConflict});
  }
  const done=await runtime.advance(reserved,10+duration,20);
  const actual=(await runtime.inspect(done.snapshot)).trips[0];
  if(actual.arrivalSimS!==10+duration||actual.distanceM!==trace.distanceM)fail('R33 arrival mismatch');
  return {dwellS:dwell,matchedDistanceM:trace.distanceM,oracleDurationS:trace.durationS,r33DurationS:duration,durationAbsRelativeError:Math.abs(duration-trace.durationS)/trace.durationS,oracleZoneCount:new Set(trace.spacing.map(x=>x.zone)).size,spacingWindows:trace.spacing.length,rows,falseNegatives:rows.filter(x=>x.falseNegative).length,falsePositives:rows.filter(x=>x.falsePositive).length};
}
export function compareCompatibility(input:unknown){
  const r=obj(input);if(!flag(r.thermalSimulationRequired))fail('missing thermal evidence requirement');
  const g=new RailGraph(pack({a:[0,0],b:[1,0]},[edge('ab','a','b',10400,60,{electrification:'no',voltageV:null,frequencyHz:null})]));
  const diesel=new RailCompatibility(g,train({maxSpeedKmh:60,rangeM:20000}),policy()).evaluateEdge({edgeId:'ab',from:'a',to:'b',operating:{mode:'diesel',gaugeMm:1676,voltageV:null,frequencyHz:null}});
  const electric=new RailCompatibility(g,train({traction:'electric',voltagesV:[25000],frequenciesHz:[50],maxSpeedKmh:60,rangeM:20000}),policy()).evaluateEdge({edgeId:'ab',from:'a',to:'b',operating:{mode:'electric',gaugeMm:1676,voltageV:25000,frequencyHz:50}});
  return {osrdElectricBlocked:flag(r.electricBlocked),gameElectricBlocked:!electric.ok,gameThermalAllowed:diesel.ok,knownIncompatibleAccepted:flag(r.electricBlocked)&&electric.ok};
}
export async function compareTimetable(inputs:{trace0:unknown;trace30:unknown;conflicts0:unknown;conflicts30:unknown;compatibility:unknown}){
  const cases=await Promise.all([compareCase(0,inputs.trace0,inputs.conflicts0),compareCase(30,inputs.trace30,inputs.conflicts30)]);
  const compatibility=compareCompatibility(inputs.compatibility),median=cases.reduce((n,r)=>n+r.durationAbsRelativeError,0)/cases.length;
  return {status:'RESEARCH_ONLY_NOT_CALIBRATED',sourceCommit:PIN,railjsonVersion:'3.5.3',cases,compatibility,medianAbsRelativeDurationError:median,proposedMedianWithin15Percent:median<=.15,knownIncompatibleAccepted:compatibility.knownIncompatibleAccepted?1:0,spacingFalseNegatives:cases.reduce((n,r)=>n+r.falseNegatives,0),productionAccepted:false,limitations:['Two cases on one pinned fictional French infrastructure; not independent Indian validation','Conservative whole-path 60 km/h abstraction and synthetic 10s ramps; not fitted physical dynamics','Native spacing zones versus whole-path reservation; routing conflicts and loading-gauge categories are not equivalent to track gauge','No Indian infrastructure, catenary/frequency or train mass mapping validated']};
}
