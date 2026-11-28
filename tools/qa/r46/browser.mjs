import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const b=await chromium.launch({headless:true}),ctx=await b.newContext({viewport:{width:360,height:800}}),page=await ctx.newPage(),errors=[],external=[],requests=[];
mkdirSync('r46-evidence',{recursive:true});page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{requests.push(r.url());if(!r.url().startsWith('http://127.0.0.1:4186/')&&!r.url().startsWith('data:'))external.push(r.url());});
try{
 await page.goto('http://127.0.0.1:4186/');await page.getByRole('heading',{name:'Rolling stock catalogue'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Choose starter / order or purchase'}).isDisabled(),true);
 const panel=page.getByRole('region',{name:'Model specifications'});
 await panel.getByRole('heading',{name:'Fictional engine',exact:true}).waitFor();
 assert.match(await panel.innerText(),/60 mL\/km/);assert.match(await panel.innerText(),/Game-balanced/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'r46-evidence/diesel-360.png',fullPage:true});
 const before=requests.length;await ctx.setOffline(true);
 const start=Date.now();await page.getByLabel('Stock category').selectOption('electric');await panel.getByRole('heading',{name:'Synthetic electric QA'}).waitFor();const switchMs=Date.now()-start;
 assert.match(await panel.innerText(),/Not supplied/);assert.match(await panel.innerText(),/25000 V/);
 assert.equal(await panel.getByRole('img',{name:/Generic electric concept/}).count(),1);
 await panel.getByText('Model identity and provenance').click();assert.match(await panel.innerText(),/r46-qa-catalog/);
 await page.screenshot({path:'r46-evidence/electric-360.png',fullPage:true});
 await page.getByLabel('Search catalogue').fill('does-not-exist');await page.getByText('No matching validated models.').waitFor();
 await page.getByLabel('Search catalogue').fill('');await panel.getByRole('heading',{name:'Synthetic electric QA'}).waitFor();
 await page.setViewportSize({width:800,height:366});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'r46-evidence/electric-800.png',fullPage:true});
 assert.equal(requests.length,before);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 writeFileSync('r46-evidence/metrics.json',JSON.stringify({switchMs,offlineInteractionRequests:requests.length-before,initialLocalRequests:before,external,errors,scope:'isolated Chromium QA; not cold-start PWA or Android'},null,2)+'\n');
 console.log('R46_BROWSER_ACCEPTANCE PASS: identity, provenance, synthetic filtering, offline interaction, original category art and responsive fit');
}finally{await ctx.close();await b.close();}
