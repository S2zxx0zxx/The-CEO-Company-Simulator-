import {describe,it,expect} from 'vitest';
import {achievementReceipts,claimAchievement,projectAchievements,projectEventWindows} from '../src/rail/progression';
import {fixture} from './fixtures/railway-r39';
import {createRailwaySaveKey,sealRailwaySave,decodeRailwaySave} from '../src/rail/persistence';
const hash='a'.repeat(64),mission={id:'first',target:1,progress:1,metric:'completed-trips',completed:true};
const claim=()=>claimAchievement([mission],[],hash,10,{missionId:'first'});
const row=()=>({kind:'achievement',payload:'{"missionId":"first"}',result:claim()});
describe('R45 deterministic recognition and event boundaries',()=>{
 it('uses R31 progress and refuses unknown or incomplete claims',async()=>{
  const {authority}=await fixture({governance:{milestones:[{id:'first',metric:'completed-trips',target:1}]}});
  const f=await authority.inspectFinance();
  expect(projectAchievements(f.governance.missions,[],f.governance.policySha256,f.simTimeS)[0].claimable).toBe(false);
  expect(()=>claimAchievement(f.governance.missions,[],f.governance.policySha256,f.simTimeS,{missionId:'first'})).toThrow();
  expect(()=>claimAchievement([mission],[],hash,10,{missionId:'other'})).toThrow();
 });
 it('rejects injected amounts, duplicates and altered policy or time',()=>{
  expect(claim()).toEqual({missionId:'first',policySha256:hash,atSimS:10,reward:'recognition'});
  expect(()=>claimAchievement([mission],[],hash,10,{missionId:'first',amountMinor:'999'})).toThrow();
  expect(()=>claimAchievement([mission],[row()],hash,11,{missionId:'first'})).toThrow();
  expect(()=>achievementReceipts([row(),row()])).toThrow();
  expect(()=>projectAchievements([mission],[row()],'b'.repeat(64),11)).toThrow();
  expect(()=>projectAchievements([mission],[row()],hash,9)).toThrow();
 });
 it('retains claim through authenticated save codec and rejects duplicate receipts',async()=>{
  const k=await createRailwaySaveKey(),limits={maxJournalEntries:20,maxBytes:1000000};
  const r={...row(),kind:'achievement' as const,requestId:'one',committedRevision:2};
  const body={format:'railway-ceo-save' as const,schemaVersion:2 as const,companyId:'co',configurationSha256:hash,revision:2,previousTag:hash,limits,snapshot:{},quotes:[],journal:[r]};
  const b=await decodeRailwaySave(await sealRailwaySave(body,k),k,limits);
  expect(projectAchievements([mission],b.journal,hash,11)[0].claimable).toBe(false);
  const invalid={...body,revision:3,journal:[r,{...r,requestId:'two',committedRevision:3}]};
  await expect(decodeRailwaySave(await sealRailwaySave(invalid,k),k,limits)).rejects.toThrow('duplicate');
 });
 it('scopes events to station and exact half-open interval, with no invented effects',()=>{
  const events=[{id:'season',kind:'seasonal-demand',startSimS:10,endSimS:20,stationIds:['s-a']},{id:'boost',kind:'speed-boost',startSimS:10,endSimS:20,stationIds:[]}];
  expect(projectEventWindows(events,9,'s-a').every(e=>e.status==='upcoming'&&!e.applies)).toBe(true);
  expect(projectEventWindows(events,10,'s-a').every(e=>e.applies&&!e.effectEnabled)).toBe(true);
  expect(projectEventWindows(events,19,'s-b').find(e=>e.id==='season')?.applies).toBe(false);
  expect(projectEventWindows(events,20,'s-a').every(e=>e.status==='expired'&&!e.applies)).toBe(true);
  expect(()=>projectEventWindows([{...events[0],endSimS:10}],10)).toThrow();
  expect(()=>projectEventWindows([events[0],events[0]],10)).toThrow();
 });
});
