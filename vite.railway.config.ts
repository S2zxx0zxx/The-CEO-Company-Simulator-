import {defineConfig,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const stress=process.env.R50_QA==='1',qa=stress||process.env.R47_QA==='1',buildId=process.env.R47_BUILD_ID??'development';
if(!/^[a-z0-9-]{1,48}$/.test(buildId))throw Error('Invalid build ID');
const out=resolve(stress?'r50-qa-dist':qa?'r47-qa-dist':'railway-dist');
async function walk(dir:string):Promise<string[]>{const result:string[]=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())result.push(...await walk(p));else if(e.isFile())result.push(p);else throw Error('Unexpected build entry');}return result;}
function offline():Plugin{return {name:'railway-isolated-offline',apply:'build',enforce:'post',async closeBundle(){
 const {writeRailwayNotices}=await import('./scripts/railway-r51-notices.mjs');await writeRailwayNotices(out);
 await writeFile(resolve(out,'build-id.json'),JSON.stringify({buildId,qa}));
 // QA icons are generated locally by the build helper; no final brand asserted.
 if(qa){const {qaIcon}=await import('./tools/qa/r47/icon.mjs');for(const n of [192,512])await writeFile(resolve(out,'qa-icon-'+n+'.png'),qaIcon(n));}
 await writeFile(resolve(out,'railway.webmanifest'),JSON.stringify({name:qa?'Railway QA only':'Railway development shell',short_name:qa?'Rail QA':'Railway',id:'./railway-guest',start_url:'./',scope:'./',display:'standalone',orientation:'portrait',background_color:'#211513',theme_color:'#211513',icons:qa?[192,512].map(n=>({src:'qa-icon-'+n+'.png',sizes:n+'x'+n,type:'image/png',purpose:'any'})):[]}));
 const paths=(await walk(out)).sort(),hash=createHash('sha256'),files:string[]=[];
 for(const p of paths){const name=relative(out,p).split(sep).join('/');if(name==='railway-sw.js')continue;hash.update(name+'\0');hash.update(await readFile(p));files.push('./'+name);}
 const version=hash.digest('hex');
 const source='const VERSION='+JSON.stringify(version)+';const FILES='+JSON.stringify(files)+';\n'+
 `const SCOPE=self.registration.scope,PREFIX='railway-guest-v1:'+SCOPE+':',CACHE=PREFIX+VERSION;
 const url=p=>new URL(p,SCOPE).href;const known=new Set(FILES.map(url));
 self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);try{await c.addAll(FILES.map(p=>new Request(url(p),{cache:'reload'})));for(const p of FILES)if(!await c.match(url(p)))throw Error('Missing asset');}catch(err){await caches.delete(CACHE);throw err;}})()));
 self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith(PREFIX)&&k!==CACHE)await caches.delete(k);})()));
 self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin||!u.href.startsWith(SCOPE))return;
 if(r.mode==='navigate'&&(u.href===SCOPE||u.href===url('./index.html'))){e.respondWith(caches.open(CACHE).then(c=>c.match(url('./index.html'))).then(x=>x||Response.error()));return;}
 if(known.has(u.href))e.respondWith(caches.open(CACHE).then(c=>c.match(r)).then(x=>x||Response.error()));
 });`;
 await writeFile(resolve(out,'railway-sw.js'),source);
}};}
export default defineConfig({root:resolve(stress?'tools/qa/r50':qa?'tools/qa/r47':'railway-app'),publicDir:false,base:'./',plugins:[react(),offline()],build:{outDir:out,emptyOutDir:true,target:'esnext'}});
