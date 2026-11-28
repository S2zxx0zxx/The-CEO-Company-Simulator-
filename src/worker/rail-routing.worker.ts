import { executeRoutingWork, type RoutingReply } from './rail-routing';
const scope=self as unknown as {onmessage:((event:MessageEvent<unknown>)=>void)|null;postMessage:(reply:RoutingReply)=>void};
scope.onmessage=async event=>{const reply=await executeRoutingWork(event.data);scope.postMessage(reply);};
