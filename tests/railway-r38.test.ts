import {describe,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeTrace,spacingConflict,buildMatchedMovement,compareCase,compareTimetable,compareCompatibility,PIN,TREE,FIXTURE_BLOB} from '../tools/calibration/osrd/compare';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const mock=(duration=600)=>({status:'success',final_output:{positions:[0,5200000,10400000],times:[0,duration*500,duration*1000],speeds:[0,16,0],spacing_requirements:[{zone:'a',begin_time:0,end_time:300000},{zone:'b',begin_time:300000,end_time:600000}]}});
const probes=[{shiftS:0,osrdSpacingConflict:true},{shiftS:299,osrdSpacingConflict:true},{shiftS:300,osrdSpacingConflict:false},{shiftS:634,osrdSpacingConflict:false},{shiftS:900,osrdSpacingConflict:false}];
const comp={thermalSimulationRequired:true,electricBlocked:true};
describe('R38 synthetic comparator regression, not executed OSRD evidence',()=>{
 it('decodes mm/ms separately and matches path length',()=>{expect(decodeTrace(mock())).toMatchObject({distanceM:10400,durationS:600});});
 it('rejects unsuccessful, mismatched path and corrupt axes',()=>{expect(()=>decodeTrace({status:'simulation_failed'})).toThrow();const x=mock();x.final_output.positions[2]=10400;expect(()=>decodeTrace(x)).toThrow();const y=mock();y.final_output.times=[0,400,200];expect(()=>decodeTrace(y)).toThrow();});
 it('rejects nonfinite and nonrest endpoints',()=>{const x=mock();x.final_output.speeds[2]=1;expect(()=>decodeTrace(x)).toThrow();x.final_output.speeds[2]=NaN;expect(()=>decodeTrace(x)).toThrow();});
 it('rejects empty or inverted native spacing evidence',()=>{const x=mock();x.final_output.spacing_requirements=[];expect(()=>decodeTrace(x)).toThrow();const y=mock();y.final_output.spacing_requirements[0].end_time=-1;expect(()=>decodeTrace(y)).toThrow();});
 it('half-open same-zone interval overlap matches explicit boundary cases',()=>{const t=decodeTrace(mock());expect(spacingConflict(t.spacing,299)).toBe(true);expect(spacingConflict(t.spacing,300)).toBe(false);});
 it('actual R33 duration and terminal arrival use explicit original synthetic ramps',async()=>{const r=await buildMatchedMovement(0);expect(r.plans[0].durationS).toBe(634);const d=await buildMatchedMovement(30);expect(d.plans[0].durationS).toBe(674);});
 it('actual R33 reservation rejects overlapping whole-path windows and accepts exact handoff',async()=>{const r=await compareCase(0,mock(),probes);expect(r.rows.find(x=>x.shiftS===0)?.gameConflict).toBe(true);expect(r.rows.find(x=>x.shiftS===634)?.gameConflict).toBe(false);expect(r.falsePositives).toBe(1);expect(r.falseNegatives).toBe(0);});
 it('native conflict claim must reconcile raw interval evidence',async()=>{await expect(compareCase(0,mock(),probes.map(x=>({...x,osrdSpacingConflict:false})))).rejects.toThrow('spacing evidence mismatch');});
 it('reports unsafe false negative and never marks research accepted',async()=>{const x=mock(900);x.final_output.spacing_requirements=[{zone:'a',begin_time:0,end_time:900000}];const p=[{shiftS:0,osrdSpacingConflict:true},{shiftS:634,osrdSpacingConflict:true},{shiftS:900,osrdSpacingConflict:false}];const r=await compareCase(0,x,p);expect(r.falseNegatives).toBe(1);});
 it('actual R08 rejects pure electric on explicitly unelectrified fixture',()=>{expect(compareCompatibility(comp)).toEqual({osrdElectricBlocked:true,gameElectricBlocked:true,gameThermalAllowed:true,knownIncompatibleAccepted:false});});
 it('rejects insufficient or duplicate conflict probes',async()=>{await expect(compareCase(0,mock(),probes.slice(0,1))).rejects.toThrow();await expect(compareCase(0,mock(),[...probes,probes[0]])).rejects.toThrow();});
 it('reports diagnostic median not production acceptance',async()=>{const r=await compareTimetable({trace0:mock(),trace30:mock(630),conflicts0:probes,conflicts30:probes,compatibility:comp});expect(r.productionAccepted).toBe(false);expect(r.cases).toHaveLength(2);expect(r.knownIncompatibleAccepted).toBe(0);});
});
const dir=process.env.R38_ORACLE_DIR;
if(dir)it('R38 actual pinned native artifact comparison',async()=>{
 const read=(n:string)=>readFileSync(join(dir,n));
 const metadata=JSON.parse(read('source.json').toString());
 expect(metadata.commit).toBe(PIN);expect(metadata.tree).toBe(TREE);expect(metadata.fixtureBlob).toBe(FIXTURE_BLOB);expect(metadata.railjsonVersion).toBe('3.5.3');
 const names=['simulation-0.json','simulation-30.json','conflicts-0.json','conflicts-30.json','compatibility.json'];
 const hashes=Object.fromEntries(names.map(n=>[n,hash(read(n))]));
 const [trace0,trace30,conflicts0,conflicts30,compatibility]=names.map(n=>JSON.parse(read(n).toString()));
 const result=await compareTimetable({trace0,trace30,conflicts0,conflicts30,compatibility});
 const out=JSON.stringify({...result,kind:'EXECUTED_OSRD_RESEARCH',sourceMetadataSha256:hash(read('source.json')),inputSha256:hashes},null,2)+'\n';
 writeFileSync(join(dir,'comparison.json'),out);console.log('R38_COMPARISON_SHA256',hash(out));console.log('R38_COMPARISON',out);
 // Report discrepancies; do not suppress them or treat the diagnostic as acceptance.
 expect(result.productionAccepted).toBe(false);
});
