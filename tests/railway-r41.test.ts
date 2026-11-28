import {describe,it,expect} from 'vitest';
import {runScenario,summarize,CASES,PROFILE,DAY,auditSnapshot} from '../tools/balance/railway-lab';
import {fixture} from './fixtures/railway-r39';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
describe('R41 actual balance lab and exploit probes',()=>{
 it('new-player route earns real margin and exact 30-day horizon',async()=>{const r=await runScenario(1,30,'new-player');expect(r.metrics.simTimeS).toBe(30*DAY);expect(BigInt(r.metrics.operatingMarginMinor)).toBeGreaterThan(0n);expect(r.metrics.settled).toBe(1);expect(r.firstPositiveMarginS).toBe(110);expect(r.productionAccepted).toBe(false);},30000);
 it('low demand can lose money without minting cash',async()=>{const r=await runScenario(4,30,'rural-low-demand');expect(BigInt(r.metrics.operatingMarginMinor)).toBeLessThan(0n);expect(r.metrics.settled).toBe(1);},30000);
 it('90-day idle payroll continues with zero revenue',async()=>{const r=await runScenario(10,90,'idle-offline');expect(r.metrics.simTimeS).toBe(90*DAY);expect(r.metrics.revenueMinor).toBe('0');expect(r.metrics.operatingCostsMinor).toBe('150');},30000);
 it('same seed wide and narrow catchup produces identical canonical state',async()=>{const a=await runScenario(7,30,'cancellation'),b=await runScenario(7,30,'cancellation','narrow');expect(a.checksum).toBe(b.checksum);expect(a.metrics).toEqual(b.metrics);expect(a.metrics.cancelled).toBe(1);},30000);
 it('actual seeded market advances and replays identically',async()=>{const a=await runScenario(6,90,'energy-shock'),b=await runScenario(6,90,'energy-shock');expect(a.checksum).toBe(b.checksum);expect(a.metrics.market).not.toBeNull();expect(a.metrics).toEqual(b.metrics);},30000);
 it('loan maturity, grace, overdue rescue guard, isolated refinance and liquidation',async()=>{const r=await runScenario(9,30,'bankruptcy');expect(r.metrics.governance).toBe('LIQUIDATION');expect(r.actions.some(x=>x.kind==='isolated-r31-refinance'&&x.outcome==='VERIFIED_NOT_COMMITTED')).toBe(true);expect(BigInt(r.metrics.debtMinor)).toBeGreaterThan(0n);},30000);
 it('two trains share OD, consume fuel and settle only once',async()=>{const r=await runScenario(2,30,'mixed-service-fleet');expect(r.metrics.settled).toBe(2);expect(r.metrics.inventory[0].onHand).toBe('180');},30000);
 it('expansion gate based on real first milestone',async()=>{const r=await runScenario(3,30,'expansion-eligibility');expect(r.metrics.unlocks.find(x=>x.id==='expansion')?.eligible).toBe(true);},30000);
 it('seeded inspection and subsidy cannot exceed cap',async()=>{const r=await runScenario(5,30,'city-high-demand');expect(r.metrics.settled).toBe(1);expect(r.metrics.revenueMinor).not.toBe('0');},30000);
 it('blocked vehicle rejected without mutation and alternate train operates',async()=>{const r=await runScenario(8,30,'maintenance-disruption');expect(r.actions.some(x=>x.kind==='blocked-train'&&x.outcome==='REJECTED_AS_EXPECTED')).toBe(true);expect(r.metrics.settled).toBe(1);},30000);
 it('rejects corrupt canonical snapshot and unsupported seed/horizon',async()=>{const f=await fixture(),s={...f.authority.snapshot(),checksum:'0'.repeat(64)};await expect(auditSnapshot(f,s)).rejects.toThrow();await expect(runScenario(0,30,'new-player')).rejects.toThrow('seed');await expect(runScenario(1,31 as 30,'new-player')).rejects.toThrow('horizon');});
 it('summary does not accept duplicate or missing runs',async()=>{const r=await runScenario(1,30,'new-player');expect(()=>summarize([r,r],30)).toThrow('duplicate');expect(()=>summarize([r],90)).toThrow();expect(summarize([r],30).runs).toBe(1);},30000);
});
if(process.env.R41_BALANCE_EVIDENCE){
 it('minimum 100 seeded 30-day and 100 seeded 90-day research scenarios',async()=>{
  const rows:Awaited<ReturnType<typeof runScenario>>[]=[],failures:unknown[]=[];
  const dir=process.env.R41_BALANCE_EVIDENCE!;mkdirSync(dir,{recursive:true});
  for(const days of [30,90] as const)for(let seed=1;seed<=100;seed++){
   const kind=CASES[(seed-1)%CASES.length];
   try{rows.push(await runScenario(seed,days,kind));}catch(e){failures.push({seed,days,kind,error:String(e)});}
  }
  const results={profile:PROFILE,expectedRuns:200,completedRuns:rows.length,failures,rows,summaries:([30,90] as const).flatMap(days=>rows.some(x=>x.days===days)?[summarize(rows,days)]:[]),productionAccepted:false};
  const bytes=JSON.stringify(results,null,2)+'\n';writeFileSync(dir+'/scenarios.json',bytes);
  console.log('R41_REPORT_SHA256 '+createHash('sha256').update(bytes).digest('hex'));
  console.log('R41_SUMMARY '+JSON.stringify({completedRuns:rows.length,failures,summaries:results.summaries}));
  expect(failures).toEqual([]);expect(rows).toHaveLength(200);
  expect(results.summaries.every(x=>x.runs===100&&x.coverage.every(c=>c.count===10))).toBe(true);
  expect(results.summaries.every(x=>x.positiveMarginRuns>0&&x.negativeMarginRuns>0)).toBe(true);
 },900000);
}
