import { RoutingClient, type RoutingPort } from './rail-routing';
/** Vite resolves the local module worker; no network service or synchronous fallback. */
export function createRoutingClient(timeoutMs?:number):RoutingClient{
  return new RoutingClient(()=>new Worker(new URL('./rail-routing.worker.ts',import.meta.url),{type:'module'}) as unknown as RoutingPort,timeoutMs);
}
