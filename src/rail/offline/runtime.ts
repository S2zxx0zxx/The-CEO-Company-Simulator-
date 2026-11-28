import {RailGraph} from '../graph';
import {RollingStockCatalog} from '../catalog';
import {prepareMovement} from '../movement';
import {prepareDispatch} from '../dispatch';
type Runtime=Awaited<ReturnType<typeof prepareDispatch>>;
export type RailwayWorkerRecipe=Runtime['workerRecipe'];
/** Trusted application recipe, never imported from a player save. Every actual
 * graph/catalog/movement/dispatch validator runs again inside the worker. */
export async function rebuildRailwayRuntime(r:RailwayWorkerRecipe,expected:string){
 const graph=new RailGraph(r.graph),catalog=await RollingStockCatalog.prepare(r.catalog,r.reviewedEvidence),m=r.movement;
 const movement=await prepareMovement(graph,catalog,m.infrastructure,m.plans,m.roster,m.limits);
 const runtime=await prepareDispatch(graph,catalog,movement,r.config,r.lifecycle??undefined,r.fleet??undefined);
 if(runtime.configurationSha256!==expected)throw Error('R40: worker configuration mismatch');
 return runtime;
}
