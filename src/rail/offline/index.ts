import {integer,checkedAdd} from '../../domain/units';
import {object,id,booleanValue,nullable,enumeration} from '../../domain/validation';

const fail=(s:string):never=>{throw Error('R40: '+s);};
const positive=(v:unknown,p='positive')=>integer(v,p,1);
export const decodeOfflinePolicy=object({
 schemaVersion:(v:unknown)=>v===1?1 as const:fail('unsupported clock policy'),
 maxWallDeltaMs:positive,simSecondsPerWallSecond:positive,maxBacklogSimS:positive,maxBatchSimS:positive,
 maxBatchEvents:(v,p)=>integer(v,p,1,10000),maxBatchesPerWake:(v,p)=>integer(v,p,1,1000),
 autoSettleArrivals:booleanValue
});
export type OfflinePolicy=ReturnType<typeof decodeOfflinePolicy>;
export const decodeClockSample=object({wallMs:integer,sessionId:id,monotonicMs:integer});
export type ClockSample=ReturnType<typeof decodeClockSample>;
export const decodeOfflineClock=object({
 policy:decodeOfflinePolicy,wallHighMs:integer,sessionId:id,monotonicHighMs:integer,
 targetSimS:integer,remainderMilliSimS:(v,p)=>integer(v,p,0,999),creditedWallMs:integer,discardedWallMs:integer,
 rollbackCount:integer,monotonicAnomalyCount:integer,cappedCount:integer
});
export type OfflineClock=ReturnType<typeof decodeOfflineClock>;
export function anchorClock(policyInput:unknown,sampleInput:unknown,simTime:unknown):OfflineClock{
 const policy=decodeOfflinePolicy(policyInput),s=decodeClockSample(sampleInput),t=integer(simTime);
 return {policy,wallHighMs:s.wallMs,sessionId:s.sessionId,monotonicHighMs:s.monotonicMs,targetSimS:t,remainderMilliSimS:0,creditedWallMs:0,discardedWallMs:0,rollbackCount:0,monotonicAnomalyCount:0,cappedCount:0};
}
export function checkClock(input:unknown,policyInput:unknown,simTime:unknown){
 const c=decodeOfflineClock(input),p=decodeOfflinePolicy(policyInput),t=integer(simTime);
 if(JSON.stringify(c.policy)!==JSON.stringify(p)||c.targetSimS<t||c.targetSimS-t>p.maxBacklogSimS)fail('clock policy or backlog mismatch');
 return c;
}
/** Wall high-watermark is never lowered. Monotonic time is comparable only
 * within the same session. Excess/anomalous time is consumed, never queued
 * as future credit. A capped backlog cannot be multiplied by reloading. */
export function observeClock(input:unknown,sampleInput:unknown,simTime:unknown){
 const original=decodeOfflineClock(input),c=checkClock(original,original.policy,simTime),s=decodeClockSample(sampleInput),t=integer(simTime),p=c.policy;
 const wall=Math.max(0,s.wallMs-c.wallHighMs),same=s.sessionId===c.sessionId;
 const mono=same?Math.max(0,s.monotonicMs-c.monotonicHighMs):wall;
 const rollback=s.wallMs<c.wallHighMs,monoAnomaly=same&&(s.monotonicMs<c.monotonicHighMs||mono<wall);
 const eligible=Math.min(wall,mono,p.maxWallDeltaMs);
 const capacity=BigInt(p.maxBacklogSimS-(c.targetSimS-t))*1000n+999n-BigInt(c.remainderMilliSimS);
 const allowed=Number(BigInt(eligible)<capacity/BigInt(p.simSecondsPerWallSecond)?BigInt(eligible):capacity/BigInt(p.simSecondsPerWallSecond));
 const total=BigInt(allowed)*BigInt(p.simSecondsPerWallSecond)+BigInt(c.remainderMilliSimS);
 const credited=Number(total/1000n),remainder=Number(total%1000n);
 if(!Number.isSafeInteger(credited))fail('simulation credit overflow');
 return {clock:decodeOfflineClock({...c,wallHighMs:Math.max(c.wallHighMs,s.wallMs),sessionId:s.sessionId,monotonicHighMs:same?Math.max(c.monotonicHighMs,s.monotonicMs):s.monotonicMs,targetSimS:checkedAdd(c.targetSimS,credited),remainderMilliSimS:remainder,creditedWallMs:checkedAdd(c.creditedWallMs,allowed),discardedWallMs:checkedAdd(c.discardedWallMs,wall-allowed),rollbackCount:checkedAdd(c.rollbackCount,rollback?1:0),monotonicAnomalyCount:checkedAdd(c.monotonicAnomalyCount,monoAnomaly?1:0),cappedCount:checkedAdd(c.cappedCount,allowed<Math.min(wall,mono)?1:0)}),creditedSimS:credited,creditedWallMs:allowed,discardedWallMs:wall-allowed,rollback,monotonicAnomaly:monoAnomaly};
}
export const catchupInput=object({sample:nullable(decodeClockSample)});

// Keep deterministic automatic settlement identifiers outside manual command space.
export const AUTO_SETTLEMENT_PREFIX='r40:settle:';
export function autoSettlementCommandId(tripId:unknown,occupied:ReadonlySet<string>){
 const base=AUTO_SETTLEMENT_PREFIX+id(tripId);
 let candidate=base,index=0;
 while(occupied.has(candidate)){index=checkedAdd(index,1);candidate=base+':'+index;}
 return id(candidate);
}
