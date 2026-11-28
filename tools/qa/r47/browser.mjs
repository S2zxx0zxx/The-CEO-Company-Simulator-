import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
const b=await chromium.launch({headless:true}),ctx=await b.newContext({viewport:{width:360,height:800}}),page=await ctx.newPage(),errors=[];
const external=[];ctx.on('request',r=>{const u=new URL(r.url());if(u.protocol==='http:'||u.protocol==='https:'){if(!['http://127.0.0.1:4187','http://127.0.0.1:4188'].includes(u.origin))external.push(r.url());}});
mkdirSync('r47-evidence',{recursive:true});page.on('pageerror',e=>errors.push(String(e)));
const origin='http://127.0.0.1:4187/',ready=()=>page.getByText('Guest company ready',{exact:true}).waitFor();
try{
 const blank=await ctx.newPage();await blank.goto('http://127.0.0.1:4188/');await blank.getByText(/No approved railway starter scenario/).waitFor();assert.equal(await blank.getByRole('button',{name:'Start guest company'}).count(),0);await blank.close();
 await page.goto(origin);await page.getByRole('button',{name:'Start guest company'}).waitFor();
 await page.getByText('Offline cache ready',{exact:true}).waitFor();
 // Place a sentinel legacy cache; update cleanup must not touch it.
 await page.evaluate(async()=>{const c=await caches.open('the-ceo-legacy-sentinel');await c.put(new Request(location.origin+'/legacy-test'),new Response('retained'));});
 await page.getByRole('button',{name:'Start guest company'}).click();await ready();
 const beforeQuote=await page.evaluate(()=>r47Qa.export());
 await page.evaluate(()=>r47Qa.quote());
 const optional=page.getByLabel('Optional service availability');assert.equal(await optional.getByText('Disabled',{exact:true}).count(),9);
 const pre=await page.evaluate(()=>r47Qa.export());
 for(const kind of ['reward-ad','purchase','billing','online-login','join-alliance','reward-callback'])await assert.rejects(page.evaluate(k=>r47Qa.rejectOptional(k),kind));
 assert.deepEqual(await page.evaluate(()=>r47Qa.export()),pre);
 // CSP must block external egress before a network request is attempted.
 const probe=await page.evaluate(async()=>{const violations=[];const on=e=>violations.push(e.effectiveDirective);document.addEventListener('securitypolicyviolation',on);let rejected=false;try{await fetch('https://r48-egress-probe.invalid/no-data');}catch{rejected=true;}await new Promise(r=>setTimeout(r,100));document.removeEventListener('securitypolicyviolation',on);return {rejected,violations};});
 assert.equal(probe.rejected,true);assert.ok(probe.violations.includes('connect-src'));assert.deepEqual(external,[]);
 console.log('R48_BROWSER PASS nine disabled services, six unauthorized commands rejected with unchanged authenticated save, external CSP probe blocked');
 await assert.rejects(page.evaluate(()=>r47Qa.duplicate()),/existing or incomplete/);
 const first=await page.evaluate(()=>r47Qa.export());assert.ok(JSON.parse(first.payload).journal.some(x=>x.requestId==='r47-qa-quote'));
 await page.getByRole('button',{name:'Operations',exact:true}).click();await page.getByRole('heading',{name:'Operations control'}).waitFor();
 await page.getByRole('button',{name:'Back',exact:true}).click();await ready();
 await page.getByRole('button',{name:'Finance',exact:true}).click();await page.getByRole('heading',{name:'Company & finance'}).waitFor();await page.getByRole('button',{name:'Back',exact:true}).click();await ready();
 await page.getByRole('button',{name:'Progression',exact:true}).click();await page.getByRole('heading',{name:'Company progression'}).waitFor();await page.getByRole('button',{name:'Back',exact:true}).click();await ready();
 await page.reload();await page.getByRole('button',{name:'Resume guest company'}).waitFor();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await ctx.setOffline(true);await page.reload();await page.getByRole('button',{name:'Resume guest company'}).click();await ready();
 await page.getByRole('button',{name:'Read offline licenses'}).click();const notices=page.getByLabel('Runtime license notices');await notices.waitFor();assert.match(await notices.innerText(),/Installed|installed runtime dependency notices/);assert.match(await notices.innerText(),/react 19\.3\.1/);console.log('R51_OFFLINE_NOTICES PASS local notice UI after offline reload');
 const saved=await page.evaluate(()=>r47Qa.export());assert.ok(JSON.parse(saved.payload).journal.some(x=>x.requestId==='r47-qa-quote'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'r47-evidence/guest-offline.png',fullPage:true});
 await ctx.setOffline(false);
 // Actual IDB corruption of both copies: retain the authenticated head and key.
 await page.close();const recovery=await ctx.newPage();await recovery.goto(origin);await recovery.getByRole('button',{name:'Resume guest company'}).waitFor();
 const latest=await recovery.evaluate(()=>r47Qa.export());
 // Actual import rejection with intact trusted head, then corruption and valid recovery below.
 const input=recovery.getByLabel('Restore matching recovery file');
 const invalid=[{label:'stale-authenticated',raw:JSON.stringify(beforeQuote)},{label:'malformed',raw:'{'},{label:'unknown-field',raw:JSON.stringify({...latest,extra:true})},{label:'tampered',raw:JSON.stringify({...latest,payload:latest.payload+' '})},{label:'wrong-tag',raw:JSON.stringify({...latest,tag:'0'.repeat(64)})}];
 for(const item of invalid){await input.setInputFiles({name:item.label+'.json',mimeType:'application/json',buffer:Buffer.from(item.raw)});await recovery.locator('main[aria-busy="false"]').waitFor();await recovery.getByRole('alert').waitFor();assert.deepEqual(await recovery.evaluate(()=>r47Qa.export()),latest);}
 // A separate browser context has a separate local key and storage.
 const foreign=await b.newContext();try{const fp=await foreign.newPage();await fp.goto(origin);await fp.getByRole('button',{name:'Start guest company'}).click();await fp.getByText('Guest company ready',{exact:true}).waitFor();const own=await fp.evaluate(()=>r47Qa.export());await assert.rejects(fp.evaluate(s=>r47Qa.recover(s),latest),/not latest|authentication/);assert.deepEqual(await fp.evaluate(()=>r47Qa.export()),own);
 // Deleting the installation key must not permit implicit initialization or recovery.
 const retained=await fp.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('r47-qa-guest');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,t=db.transaction(['heads','slots','keys'],'readwrite'),heads=t.objectStore('heads').getAll(),slots=t.objectStore('slots').getAll();t.objectStore('keys').clear();t.oncomplete=()=>{db.close();resolve({heads:heads.result,slots:slots.result});};t.onerror=()=>reject(t.error);};}));
 assert.equal(await fp.evaluate(()=>r47Qa.presence()),'incomplete');await assert.rejects(fp.evaluate(()=>r47Qa.duplicate()),/existing or incomplete/);await assert.rejects(fp.evaluate(s=>r47Qa.recover(s),own),/trusted save head|installation key/);
 const after=await fp.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('r47-qa-guest');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,t=db.transaction(['heads','slots','keys'],'readonly'),heads=t.objectStore('heads').getAll(),slots=t.objectStore('slots').getAll(),keys=t.objectStore('keys').count();t.oncomplete=()=>{db.close();resolve({heads:heads.result,slots:slots.result,keys:keys.result});};t.onerror=()=>reject(t.error);};}));assert.deepEqual(after,{...retained,keys:0});
 }finally{await foreign.close();}
 console.log('R52_IMPORT PASS five invalid or stale file imports, cross-install and missing-key recovery rejected; trusted saves unchanged');
 await recovery.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('r47-qa-guest');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('slots','readwrite'),store=tx.objectStore('slots'),rows=store.getAll();rows.onsuccess=()=>{for(const row of rows.result)store.put({...row,seal:{...row.seal,payload:'corrupt'}});};tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>reject(tx.error);};}));
 await recovery.getByRole('button',{name:'Resume guest company'}).click();await recovery.getByRole('alert').filter({hasText:/no valid latest copy/}).waitFor();
 await recovery.getByLabel('Restore matching recovery file').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(latest))});
 await recovery.getByText('Matching latest authenticated save restored.').waitFor();await recovery.getByText('Guest company ready',{exact:true}).waitFor();
 assert.ok(JSON.parse((await recovery.evaluate(()=>r47Qa.export())).payload).journal.some(x=>x.requestId==='r47-qa-quote'));
 cpSync('r47-update-dist','r47-qa-dist',{recursive:true});
 await recovery.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
 await recovery.getByText(/Update downloaded/).waitFor({timeout:60000});
 assert.equal(await recovery.evaluate(async()=> (await(await fetch('./build-id.json')).json()).buildId),'initial');
 await recovery.close();const next=await ctx.newPage();await next.goto(origin);await next.getByRole('button',{name:'Resume guest company'}).waitFor();
 await next.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return !r?.waiting&&r?.active?.state==='activated';});
 await next.reload();await next.getByRole('button',{name:'Resume guest company'}).click();await next.getByText('Guest company ready',{exact:true}).waitFor();
 const final=await next.evaluate(async()=>({body:JSON.parse((await r47Qa.export()).payload),build:(await(await fetch('./build-id.json')).json()).buildId,legacy:await caches.has('the-ceo-legacy-sentinel')}));
 assert.equal(final.build,'update');assert.equal(final.legacy,true);assert.ok(final.body.journal.some(x=>x.requestId==='r47-qa-quote'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 writeFileSync('r47-evidence/browser.json',JSON.stringify({initialRevision:JSON.parse(first.payload).revision,finalRevision:final.body.revision,build:final.build,legacyPreserved:final.legacy,externalRequests:external.length,optionalCommandsRejected:6,cspProbe:probe},null,2));
 console.log('R47_BROWSER PASS explicit guest creation and duplicate rejection, actual operations finance progression, offline reload and save retention, both-copy recovery, waiting update and legacy cache isolation');
}finally{await ctx.close();await b.close();}
