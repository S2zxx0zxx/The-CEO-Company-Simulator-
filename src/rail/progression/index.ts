// R45: recognition only. Monetary rewards and event effects require approved policies.
import {integer} from '../../domain/units';
import {object,id,enumeration,list,distinct,refine,sha256} from '../../domain/validation';
import {decodeMission} from '../../domain/models';
const fail=(s:string):never=>{throw Error('R45: '+s);};
export const achievementInput=object({missionId:id});
const receipt=object({missionId:id,policySha256:sha256,atSimS:integer,reward:enumeration(['recognition'])});
type Receipt=ReturnType<typeof receipt>;
type JournalRow={kind:string;payload:string;result:unknown};
type Mission={id:string;target:number;progress:number;completed:boolean;metric:string};
export function achievementReceipts(rows:readonly JournalRow[]):Receipt[]{
 const claims:Receipt[]=[],seen=new Set<string>();
 for(const row of rows)if(row.kind==='achievement'){
  const q=achievementInput(JSON.parse(row.payload)),r=receipt(row.result);
  if(q.missionId!==r.missionId||seen.has(r.missionId))fail('duplicate or mismatched achievement receipt');
  seen.add(r.missionId);claims.push(r);
 }
 return claims;
}
export function projectAchievements(missions:readonly Mission[],rows:readonly JournalRow[],policy:unknown,now:unknown){
 const hash=sha256(policy),at=integer(now),claims=achievementReceipts(rows);
 for(const r of claims)if(r.policySha256!==hash||r.atSimS>at||!missions.some(m=>m.id===r.missionId&&m.completed&&m.progress===m.target))fail('achievement receipt not bound to current authoritative milestone');
 return missions.map(m=>{
  const x=decodeMission({id:m.id,target:m.target,progress:m.progress});
  if(m.completed!==(x.progress===x.target))fail('inconsistent mission');
  const claim=claims.find(r=>r.missionId===x.id)??null;
  return {...x,metric:m.metric,completed:m.completed,claim,claimable:m.completed&&!claim};
 });
}
export function claimAchievement(missions:readonly Mission[],rows:readonly JournalRow[],policy:unknown,now:unknown,input:unknown):Receipt{
 const q=achievementInput(input),m=projectAchievements(missions,rows,policy,now).find(x=>x.id===q.missionId);
 if(!m?.claimable)fail('unknown incomplete or already claimed achievement');
 return receipt({missionId:q.missionId,policySha256:policy,atSimS:now,reward:'recognition'});
}
// Scenario-provided windows, never wall time. No automatic economic multiplier,
// clock mutation, promotion price or real-player ranking is enabled by this module.
const event=refine(object({id,kind:enumeration(['seasonal-demand','speed-boost']),startSimS:integer,endSimS:integer,stationIds:distinct(list(id,0,10000),x=>x)}),x=>x.endSimS>x.startSimS&&(x.kind==='seasonal-demand'?x.stationIds.length>0:x.stationIds.length===0),'invalid event window or scope');
export const decodeEventWindows=(input:unknown)=>distinct(list(event,0,1000),x=>x.id)(input).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(x=>({...x,stationIds:[...x.stationIds].sort()}));
export function projectEventWindows(input:unknown,now:unknown,station?:unknown){
 const at=integer(now),sid=station===undefined?null:id(station);
 return decodeEventWindows(input).map(x=>({...x,status:at<x.startSimS?'upcoming' as const:at>=x.endSimS?'expired' as const:'active' as const,applies:at>=x.startSimS&&at<x.endSimS&&(x.kind==='speed-boost'||(sid!==null&&x.stationIds.includes(sid))),effectEnabled:false as const}));
}
