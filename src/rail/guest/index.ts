import {createRailwayStore} from '../persistence';
import {createOfflineRunner} from '../offline/lifecycle';
import type {prepareDispatch} from '../dispatch';
type Runtime=Awaited<ReturnType<typeof prepareDispatch>>;
export const RAILWAY_SAVE_NAMESPACE='railway-ceo-save-v1';
export type GuestScenario={runtime:Runtime;limits:unknown;offlinePolicy:unknown;startSimS:number;seed:number;opening:unknown;workerTimeoutMs:number};
export function createGuestSession(s:GuestScenario,options:{qaDatabaseName?:string}={}){
 const databaseName=options.qaDatabaseName??RAILWAY_SAVE_NAMESPACE;
 if(options.qaDatabaseName&&!/^r47-qa-[a-z0-9-]+$/.test(databaseName))throw Error('R47: invalid QA namespace');
 const store=createRailwayStore(s.runtime,s.limits,{databaseName,offlinePolicy:s.offlinePolicy});
 const runner=createOfflineRunner(s.runtime,s.limits,{databaseName,offlinePolicy:s.offlinePolicy,workerTimeoutMs:s.workerTimeoutMs,mode:'worker'});
 // Never initialize in response to arbitrary open failure. Only an explicit
 // guest action and a truly empty company slot can create a new save.
 async function startGuest(){const status=await store.presence();if(status!=='absent')throw Error('R47: existing or incomplete guest save; resume or recover instead');return store.initialize(s.startSimS,s.seed,s.opening);}
 async function resume(){if(await store.presence()!=='present')throw Error('R47: no complete guest save');return store.open();}
 return Object.freeze({store,runner,startGuest,resume,companyId:s.runtime.companyId,configurationSha256:s.runtime.configurationSha256,close(){runner.close();store.close();}});
}
export type GuestSession=ReturnType<typeof createGuestSession>;
