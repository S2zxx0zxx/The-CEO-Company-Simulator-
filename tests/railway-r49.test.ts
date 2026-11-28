import {describe,it,expect,vi,afterEach} from 'vitest';
import {bindRailwayLifecycle,type createOfflineRunner} from '../src/rail/offline/lifecycle';
type Runner=ReturnType<typeof createOfflineRunner>;
afterEach(()=>vi.unstubAllGlobals());
function fake(){
 const document=new EventTarget(),window=new EventTarget();vi.stubGlobal('document',document);vi.stubGlobal('window',window);
 const callbacks:((v:any)=>void)[]=[];
 const wake=vi.fn(async (_:unknown,onProgress:(v:any)=>void)=>{callbacks.push(onProgress);return {} as Awaited<ReturnType<Runner['open']>>;});
 const close=vi.fn();return {runner:{wake,close,open:vi.fn()} as unknown as Runner,wake,close,callbacks,document,window};
}
describe('R49 lifecycle ownership boundary',()=>{
 it('borrowed runner survives detach and rebind; disposed callback is suppressed',async()=>{
  const f=fake(),onProgress=vi.fn(),onError=vi.fn();
  const first=await bindRailwayLifecycle(f.runner,{onProgress,onError,closeRunnerOnDispose:false});expect(f.wake).toHaveBeenCalledTimes(1);
  await first.dispose();f.callbacks[0]({revision:1});f.document.dispatchEvent(new Event('visibilitychange'));expect(onProgress).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();expect(f.wake).toHaveBeenCalledTimes(1);
  const second=await bindRailwayLifecycle(f.runner,{onProgress,onError,closeRunnerOnDispose:false});expect(f.wake).toHaveBeenCalledTimes(2);f.callbacks[1]({revision:2});expect(onProgress).toHaveBeenCalledWith({revision:2});
  await second.dispose();f.runner.close();expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('existing owning listeners still close their runner on dispose',async()=>{
  const f=fake(),b=await bindRailwayLifecycle(f.runner,{onProgress:vi.fn(),onError:vi.fn()});await b.dispose();expect(f.close).toHaveBeenCalledTimes(1);
 });
});
