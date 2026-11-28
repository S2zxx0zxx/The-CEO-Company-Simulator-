import type {prepareDispatch} from '../dispatch';
import {autoSettlementCommandId,checkClock,type OfflineClock,type OfflinePolicy} from './index';
type Controller=Awaited<ReturnType<Awaited<ReturnType<typeof prepareDispatch>>['open']>>;
const fail=(s:string):never=>{throw Error('R40: '+s);};
const due=(c:Controller)=>c.snapshot().pendingEvents.some(e=>e.simTimeS<=c.snapshot().simTimeS);
const arrived=(c:Controller)=>c.arrivedTripIds();
export const pending=(c:Controller,clock:OfflineClock)=>c.snapshot().simTimeS<clock.targetSimS||due(c)||(clock.policy.autoSettleArrivals&&arrived(c).length>0);
export async function runCatchupBatch(c:Controller,clock:OfflineClock,p:OfflinePolicy){
    checkClock(clock,p,c.snapshot().simTimeS);
    const start=c.snapshot().simTimeS, target=start+Math.min(p.maxBatchSimS,clock.targetSimS-start);
    let remaining=p.maxBatchEvents;const processed:string[]=[],settled:string[]=[];
    while(remaining>0){
      const s=c.snapshot(),next=s.pendingEvents[0];
      if(due(c)){
        const r=await c.advance(s.simTimeS,remaining,s.checksum);processed.push(...r.processed);remaining-=r.processed.length;
        if(!r.processed.length)fail('due event made no progress');
        continue;
      }
      if(p.autoSettleArrivals){
        const trip=arrived(c)[0];
        if(trip){
          // A legacy save may already contain the predictable base ID.
          // Choose the first unused ID deterministically, including fleet history.
          const occupied=new Set([...s.state.receipts,...s.state.closures,...s.state.fleetHistory].map(x=>x.commandId));
          await c.settle({commandId:autoSettlementCommandId(trip,occupied),tripId:trip},s.checksum);settled.push(trip);remaining--;continue;
        }
      }
      if(s.simTimeS>=target)break;
      // Stop at next actual event to settle at canonical arrival, independent of batch partition.
      const at=Math.min(target,next?.simTimeS??target),r=await c.advance(at,remaining,s.checksum);
      processed.push(...r.processed);remaining-=r.processed.length;
      if(r.snapshot.simTimeS===s.simTimeS&&!r.processed.length)fail('clock batch made no progress');
    }
    return {fromSimS:start,toSimS:c.snapshot().simTimeS,targetSimS:clock.targetSimS,processed,settled,complete:!pending(c,clock)};
  }
