import {rebuildRailwayRuntime,type RailwayWorkerRecipe} from './runtime';
import {createRailwayStore} from '../persistence';
export type CatchupWorkerRequest={recipe:RailwayWorkerRecipe;configurationSha256:string;limits:unknown;options:{databaseName?:string;offlinePolicy:unknown};command:unknown;expected:unknown};
export type CatchupWorkerReply={ok:true;result:Awaited<ReturnType<ReturnType<typeof createRailwayStore>['execute']>>}|{ok:false;error:string};
const scope=self as unknown as {onmessage:((e:MessageEvent<CatchupWorkerRequest>)=>void)|null;postMessage:(v:CatchupWorkerReply)=>void};
scope.onmessage=async e=>{
 let store:ReturnType<typeof createRailwayStore>|undefined;
 try{
  const q=e.data,runtime=await rebuildRailwayRuntime(q.recipe,q.configurationSha256);
  store=createRailwayStore(runtime,q.limits,q.options);
  const result=await store.execute(q.command,q.expected);
  scope.postMessage({ok:true,result});
 }catch(err){scope.postMessage({ok:false,error:err instanceof Error?err.message:String(err)});}
 finally{store?.close();}
};
