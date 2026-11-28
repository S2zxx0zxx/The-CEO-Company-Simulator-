import { RailGraph, type GraphSnapshot } from '../rail/graph';
import { canonicalRequest, findRoute, failure, freezeResult, type RouteRequest, type RoutingResult } from '../rail/routing';
import { integer } from '../domain/units';
import { record } from '../domain/validation';
export type RoutingWork = {type:'route';epoch:number;sequence:number;graph:GraphSnapshot;request:RouteRequest};
export type RoutingReply = {type:'result';epoch:number;sequence:number;result:RoutingResult};
export interface RoutingPort {
  onmessage:((event:MessageEvent<unknown>)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
  onmessageerror:((event:MessageEvent<unknown>)=>void)|null;
  postMessage(value:RoutingWork):void;
  terminate():void;
}
export type RoutingFactory=()=>RoutingPort;
/** Worker receives a read-only projection of the authoritative pack. No saves or simulation writes. */
export async function executeRoutingWork(value:unknown):Promise<RoutingReply>{
  const raw=record(value,'routing work');
  if(Object.keys(raw).length!==5||raw.type!=='route'||!Object.hasOwn(raw,'graph')||!Object.hasOwn(raw,'request'))throw new TypeError('Invalid routing work');
  const epoch=integer(raw.epoch,'epoch',1),sequence=integer(raw.sequence,'sequence',1);
  let result:RoutingResult;try{result=await findRoute(new RailGraph(raw.graph),raw.request);}catch{result=failure('INVALID_INPUT','INVALID_GRAPH_OR_REQUEST');}
  return {type:'result',epoch,sequence,result};
}
interface Pending {port:RoutingPort;epoch:number;sequence:number;timer:ReturnType<typeof setTimeout>;resolve:(v:RoutingResult)=>void}
/** One query at a time. Supersession hard-terminates the old worker, including synchronous graph
 * decoding/search. A cached result is scoped to the active immutable graph and exact canonical query. */
export class RoutingClient {
  #graph:RailGraph|null=null;#epoch=0;#sequence=0;#pending:Pending|null=null;
  #cache=new Map<string,{value:RoutingResult;bytes:number}>();#cacheBytes=0;
  constructor(private readonly factory:RoutingFactory,private readonly timeoutMs=30000){integer(timeoutMs,'timeoutMs',1,120000);}
  activate(graph:RailGraph){if(!(graph instanceof RailGraph))throw new TypeError('Expected validated graph');this.cancel();this.#epoch=integer(this.#epoch+1);this.#graph=graph;this.#cache.clear();this.#cacheBytes=0;}
  cancel(){const p=this.#pending;if(p)this.#finish(p,failure('CANCELLED','SUPERSEDED_OR_CANCELLED'));}
  dispose(){this.cancel();this.#graph=null;this.#cache.clear();this.#cacheBytes=0;}
  #finish(p:Pending,result:RoutingResult){if(this.#pending!==p)return;this.#pending=null;clearTimeout(p.timer);p.port.onmessage=null;p.port.onerror=null;p.port.onmessageerror=null;try{p.port.terminate();}finally{p.resolve(result);}}
  #remember(key:string,result:RoutingResult){if(!result.ok)return;const bytes=new TextEncoder().encode(key+JSON.stringify(result)).length;if(bytes>4000000)return;while(this.#cache.size>=16||this.#cacheBytes+bytes>4000000){const first=this.#cache.keys().next().value;if(first===undefined)break;this.#cacheBytes-=this.#cache.get(first)!.bytes;this.#cache.delete(first);}this.#cache.set(key,{value:result,bytes});this.#cacheBytes+=bytes;}
  route(input:unknown):Promise<RoutingResult>{
    this.cancel();const graph=this.#graph;if(!graph)return Promise.resolve(failure('STALE_GRAPH','NO_ACTIVE_GRAPH'));
    let q:RouteRequest;try{q=canonicalRequest(input);}catch{return Promise.resolve(failure('INVALID_INPUT','INVALID_REQUEST'));}
    if(q.graphSha256!==graph.graphSha256)return Promise.resolve(failure('STALE_GRAPH','GRAPH_IDENTITY_MISMATCH'));
    const key=JSON.stringify(q),cached=this.#cache.get(key);if(cached)return Promise.resolve(cached.value);
    let port:RoutingPort;try{port=this.factory();}catch{return Promise.resolve(failure('WORKER_UNAVAILABLE','WORKER_CREATION_FAILED'));}
    const epoch=this.#epoch,sequence=this.#sequence=integer(this.#sequence+1);
    return new Promise(resolve=>{
      const p:Pending={port,epoch,sequence,resolve,timer:setTimeout(()=>this.#finish(p,failure('WORKER_UNAVAILABLE','WORKER_TIMEOUT')),this.timeoutMs)};this.#pending=p;
      port.onmessage=event=>{
        if(this.#pending!==p||this.#epoch!==epoch)return;
        try{const reply=record(event.data,'reply');if(reply.type!=='result'||reply.epoch!==epoch||reply.sequence!==sequence)return;
          const result=reply.result as RoutingResult;
          if(!result||typeof result!=='object'||typeof result.ok!=='boolean')throw new TypeError('Malformed result');
          if(result.ok&&(result.route.graphSha256!==q.graphSha256||result.route.trainProfileSha256!==q.trainProfileSha256||result.policySha256!==q.policySha256||result.route.id!==q.routeId||JSON.stringify(result.route.stopIds)!==JSON.stringify(q.stopIds)))throw new TypeError('Mismatched result identity');
          const frozen=freezeResult(result);this.#remember(key,frozen);this.#finish(p,frozen);
        }catch{this.#finish(p,failure('WORKER_UNAVAILABLE','INVALID_WORKER_REPLY'));}
      };
      port.onerror=()=>this.#finish(p,failure('WORKER_UNAVAILABLE','WORKER_ERROR'));
      port.onmessageerror=()=>this.#finish(p,failure('WORKER_UNAVAILABLE','WORKER_MESSAGE_ERROR'));
      try{port.postMessage({type:'route',epoch,sequence,graph:graph.snapshot(),request:q});}catch{this.#finish(p,failure('WORKER_UNAVAILABLE','WORKER_POST_FAILED'));}
    });
  }
}
