import {describe,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compareResearch,decodeResearch,PIN,TREE} from '../tools/calibration/altrios/compare';
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const cp=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const cases=[...([0,50,100] as const).map((loadedCars,i)=>({id:'f'+i,split:'fit',origin:'A',destination:'B',loadedCars,emptyCars:100-loadedCars,locomotives:9})),...([25,40,75] as const).map((loadedCars,i)=>({id:'h'+i,split:'holdout',origin:'B',destination:'A',loadedCars,emptyCars:100-loadedCars,locomotives:9}))];
const manifest={schemaVersion:1,status:'RESEARCH_ONLY',description:'Synthetic unit test only; no executed oracle evidence',cases};
const fake=()=>({schemaVersion:1,kind:'SYNTHETIC_HARNESS_TEST',commit:PIN,tree:TREE,manifestSha256:'a'.repeat(64),sourceSha256:{fixture:'b'.repeat(64)},nativeSha256:'c'.repeat(64),python:'synthetic',fuelJPerMl:1000,fuelSource:'Synthetic only',rows:cases.map(c=>({...c,inputSha256:'d'.repeat(64),traceSha256:'e'.repeat(64),distanceM:1000,durationS:200,fuelJ:(100+c.loadedCars)*1000,sourceSpeedKmh:23,ramp:{accelerationS:10,brakingS:20} as {accelerationS:number;brakingS:number}|null,massKg:1000000,maxSpeedMps:6.5,startSpeedMps:0,endSpeedMps:0}))});
describe('R37 research calibration harness (synthetic tests, never ALTRIOS results)',()=>{
 it('uses actual R23 and R33 functions; training-only interpolation yields expected fuel',async()=>{const x=await compareResearch(fake(),manifest);expect(x.kind).toBe('SYNTHETIC_HARNESS_TEST');expect(x.effectiveNominalMlPerKm).toBe('100');expect(x.rows.map(r=>r.estimatedMl)).toEqual(['125','140','175']);expect(x.energy?.medianAbsRelativeError).toBe(0);expect(x.ramps).toEqual({accelerationS:10,brakingS:20});expect(x.rows.every(r=>r.predictedDurationS===172)).toBe(true);expect(x.productionAccepted).toBe(false);});
 it('held-out measured fuel and duration do not affect fitted parameters or predictions',async()=>{const a=fake(),b=cp(a);for(const r of b.rows.filter(r=>r.split==='holdout')){r.fuelJ*=3;r.durationS*=2;r.ramp={accelerationS:999,brakingS:999};}const x=await compareResearch(a,manifest),y=await compareResearch(b,manifest);expect(x.fitPoints).toEqual(y.fitPoints);expect(x.ramps).toEqual(y.ramps);expect(x.rows.map(r=>[r.estimatedMl,r.predictedDurationS])).toEqual(y.rows.map(r=>[r.estimatedMl,r.predictedDurationS]));expect(y.energy?.medianAbsRelativeError).toBeGreaterThan(.5);});
 it('invalid training ramp blocks duration fit, not a guessed acceleration default',async()=>{const a=fake();a.rows[0].ramp=null;const r=await compareResearch(a,manifest);expect(r.ramps).toBeNull();expect(r.movement).toBeNull();expect(r.rows.every(x=>x.predictedDurationS===null)).toBe(true);});
 it('non-rest-to-rest holdout is not represented as a valid R33 duration comparison',async()=>{const a=fake();a.rows[3].startSpeedMps=2;const x=await compareResearch(a,manifest);expect(x.rows[0].predictedDurationS).toBeNull();expect(x.movement?.n).toBe(2);});
 it('rejects wrong pinned commit and tree',()=>{expect(()=>decodeResearch({...fake(),commit:'f'.repeat(40)},manifest)).toThrow('pin');expect(()=>decodeResearch({...fake(),tree:'f'.repeat(40)},manifest)).toThrow('pin');});
 it('rejects fabricated executed label in unsupported environment',()=>{expect(()=>decodeResearch({...fake(),kind:'EXECUTED_ALTRIOS_RESEARCH'},manifest)).toThrow('environment');});
 it('rejects absent or duplicated case IDs',()=>{const a=fake();a.rows.pop();expect(()=>decodeResearch(a,manifest)).toThrow();const b=fake();b.rows.push(b.rows[0]);expect(()=>decodeResearch(b,manifest)).toThrow();});
 it('rejects train/holdout load overlap even with matching manifest',()=>{const a=fake(),m=cp(manifest);a.rows[3].loadedCars=50;a.rows[3].emptyCars=50;m.cases[3].loadedCars=50;m.cases[3].emptyCars=50;expect(()=>decodeResearch(a,m)).toThrow('overlap');});
 it('rejects holdout reuse of training direction and mismatched locomotive count',()=>{const a=fake(),m=cp(manifest);a.rows[3].origin='A';a.rows[3].destination='B';m.cases[3].origin='A';m.cases[3].destination='B';expect(()=>decodeResearch(a,m)).toThrow('overlap');const b=fake(),n=cp(manifest);b.rows[3].locomotives=8;n.cases[3].locomotives=8;expect(()=>decodeResearch(b,n)).toThrow('unmatched');});
 it('rejects zero, negative and nonfinite measurements',()=>{for(const v of [0,-1,NaN,Infinity]){const a=fake();a.rows[3].fuelJ=v;expect(()=>decodeResearch(a,manifest)).toThrow();}});
 it('rejects unknown evidence fields',()=>{const a=fake();expect(()=>decodeResearch({...a,calibrated:true},manifest)).toThrow();});
 it('reports absolute error and conservative nearest-rank p95 on nonzero holdouts',async()=>{const a=fake();a.rows[5].fuelJ=350000;const r=await compareResearch(a,manifest);expect(r.energy?.n).toBe(3);expect(r.energy?.p95AbsRelativeError).toBe(.5);expect(r.rows[2].energyAbsErrorJ).toBe(175000);expect(r.proposedEnvelope?.p95Within30Percent).toBe(false);});
});
// Explicit artifact-only integration mode; normal mobile/game test runs do not
// pretend to execute the upstream binary.
const actualDir=process.env.R37_ORACLE_DIR;
if(actualDir){
 it('R37 actual upstream oracle artifact comparison',async()=>{
  const bytes=readFileSync(join(actualDir,'oracle.json')),o=JSON.parse(bytes.toString());
  const manifestBytes=readFileSync('tools/calibration/altrios/cases.json'),m=JSON.parse(manifestBytes.toString());
  expect(o.kind).toBe('EXECUTED_ALTRIOS_RESEARCH');expect(o.manifestSha256).toBe(hash(manifestBytes));
  const decoded=decodeResearch(o,m);
  for(const r of decoded.o.rows){
    const traceBytes=readFileSync(join(actualDir,r.id+'.trace.json'));expect(hash(traceBytes)).toBe(r.traceSha256);
    const t=JSON.parse(traceBytes.toString()) as {timeSeconds:number[];distanceMetres:number[];speedMps:number[]};
    expect(t.timeSeconds.length).toBeGreaterThan(2);expect(t.distanceMetres.length).toBe(t.timeSeconds.length);expect(t.speedMps.length).toBe(t.timeSeconds.length);
    expect(t.timeSeconds.every((x,i)=>Number.isFinite(x)&&(i===0||x>=t.timeSeconds[i-1]))).toBe(true);
    expect(t.distanceMetres.every((x,i)=>Number.isFinite(x)&&(i===0||x>=t.distanceMetres[i-1]))).toBe(true);
    expect(t.speedMps.every(Number.isFinite)).toBe(true);
    expect(Math.round(t.distanceMetres.at(-1)!-t.distanceMetres[0])).toBe(r.distanceM);
    expect(t.timeSeconds.at(-1)!-t.timeSeconds[0]).toBeCloseTo(r.durationS,8);
    expect(Math.max(...t.speedMps)).toBeCloseTo(r.maxSpeedMps,8);
    expect(t.speedMps[0]).toBeCloseTo(r.startSpeedMps,8);expect(t.speedMps.at(-1)).toBeCloseTo(r.endSpeedMps,8);
  }
  const result=await compareResearch(o,m),out=JSON.stringify({...result,oracleSha256:hash(bytes)},null,2)+'\n';
  writeFileSync(join(actualDir,'comparison.json'),out);console.log('R37_COMPARISON_SHA256',hash(out));console.log('R37_COMPARISON',out);
  expect(result.productionAccepted).toBe(false);
 });
}
