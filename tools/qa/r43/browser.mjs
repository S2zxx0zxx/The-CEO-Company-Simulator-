import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const b=await chromium.launch({headless:true});
const context=await b.newContext({viewport:{width:360,height:800}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
mkdirSync('r43-evidence',{recursive:true});
const wait=async()=>{await page.getByRole('heading',{name:'Operations control'}).waitFor();await page.getByText('Available cash',{exact:true}).waitFor();};
const tab=async n=>{await page.getByRole('navigation').getByRole('button',{name:n==='catalog'?'Catalogue':n[0].toUpperCase()+n.slice(1),exact:true}).click();};
const select=async id=>page.getByRole('button',{name:new RegExp('^'+id+' · Fictional engine')}).click();
const read=()=>page.evaluate(()=>r43Qa.read()),backup=()=>page.evaluate(()=>r43Qa.export());
const refresh=()=>page.getByRole('button',{name:'Refresh saved operations'}).click();
async function apply(label){
 const before=await backup();
 await page.getByRole('button',{name:label,exact:true}).click();
 await page.getByRole('heading',{name:'Confirm '+label,exact:true}).waitFor();
 assert.deepEqual(await backup(),before,'preflight must not mutate durable save');
 await page.getByRole('button',{name:'Confirm commit',exact:true}).click();
 await page.getByRole('status').filter({hasText:/Committed:|Dispatched/}).waitFor();
 await page.waitForFunction(()=>document.querySelector('main')?.getAttribute('aria-busy')==='false');
}
try{
 await page.goto('http://127.0.0.1:4183/');await wait();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow');
 await select('t1');await page.getByText('REPAIR_DUE',{exact:true}).waitFor();await page.screenshot({path:'r43-evidence/fleet-360.png',fullPage:true});
 await tab('routes');await page.getByLabel('Configured compatible route').selectOption('service-template');
 const before=await backup();await page.getByRole('button',{name:'Issue departure quote',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/maintenance/);assert.deepEqual(await backup(),before);
 console.log('PASS unavailable maintenance blocks quote and durable state unchanged');
 await tab('yard');await page.getByLabel('Yard',{exact:true}).selectOption('yard-a');await apply('Park at actual location');await page.locator('.rf-state').filter({hasText:/^PARKED$/}).waitFor();await apply('Start service / repair');
 const servicing=await read();assert.equal(servicing.management.rows.find(x=>x.trainId==='t1').state,'SERVICE');assert.equal(servicing.management.rows.find(x=>x.trainId==='t1').maintenance.activeJob.job.costMinor,'200');
 await page.screenshot({path:'r43-evidence/service-360.png',fullPage:true});
 await page.evaluate(()=>r43Qa.advance(110));await refresh();await page.locator('.rf-state').filter({hasText:/^PARKED$/}).waitFor();await apply('Unpark');
 console.log('PASS park/service completion/unpark actual jobs and cash');
 await tab('routes');await select('t2');await page.getByLabel('Configured compatible route').selectOption('service-template');await apply('Issue departure quote');
 await select('t3');await page.getByLabel('Configured compatible route').selectOption('service-template');await apply('Issue departure quote');
 assert.equal((await read()).management.quotes.length,2);
 await page.reload();await wait();await tab('routes');await page.getByRole('checkbox',{name:/t2 · service-template/}).check();await page.getByRole('checkbox',{name:/t3 · service-template/}).check();await page.screenshot({path:'r43-evidence/bulk-360.png',fullPage:true});await apply('Depart selected trains');
 const active=await read();assert.equal(active.management.trips.length,2);assert.equal(active.management.rows.filter(r=>r.state==='RUNNING').length,2);
 console.log('PASS persisted quotes survive reload; actual bulk dispatch');
 await tab('fleet');await select('t2');assert.equal(await page.getByRole('button',{name:'Settle actual arrival',exact:true}).isDisabled(),true);
 await page.evaluate(()=>r43Qa.advance(220));await refresh();await page.locator('.rf-state').filter({hasText:/^ARRIVED$/}).waitFor();await apply('Settle actual arrival');await select('t3');await apply('Settle actual arrival');
 await tab('receipts');assert.equal((await read()).management.trips.filter(t=>t.closure?.outcome==='settled').length,2);await page.getByText('Actual accounting postings',{exact:true}).first().waitFor();await page.screenshot({path:'r43-evidence/receipts-360.png',fullPage:true});
 console.log('PASS actual arrival gates and itemized receipts');
 await tab('routes');await select('t2');await page.getByLabel('Configured compatible route').selectOption('relocate');await apply('Issue departure quote');await apply('Dispatch locked quote');await page.evaluate(()=>r43Qa.advance(330));await refresh();await tab('fleet');await select('t2');await apply('Settle actual arrival');const relocated=(await read()).management.rows.find(x=>x.trainId==='t2');assert.equal(relocated.yardId,'yard-a');assert.equal(relocated.nodeId,'a');
 console.log('PASS non-teleporting relocation to owned yard');
 // Confirm a preflight cannot commit after another durable writer changes the head.
 await tab('routes');await select('t1');await page.getByLabel('Configured compatible route').selectOption('service-template');
 await page.getByRole('button',{name:'Issue departure quote',exact:true}).click();await page.getByRole('heading',{name:'Confirm Issue departure quote',exact:true}).waitFor();
 const other=await context.newPage();await other.goto('http://127.0.0.1:4183/');await other.getByText('Available cash',{exact:true}).waitFor();await other.evaluate(()=>r43Qa.advance(331));await other.close();
 const staleBefore=await backup();await page.getByRole('button',{name:'Confirm commit',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/STALE_DURABLE_REVISION/);assert.deepEqual(await backup(),staleBefore);
 console.log('PASS stale confirmation after other tab commit is rejected without mutation');
 await tab('catalog');assert.equal(await page.getByRole('button',{name:'Choose starter / order or purchase'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Create company',exact:true}).isDisabled(),true);
 await page.setViewportSize({width:800,height:366});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'r43-evidence/catalog-800.png',fullPage:true});
 const d=await read(),seal=await backup();const invalid=await page.evaluate(e=>r43Qa.check({requestId:'qa:bad',kind:'fleet',input:{commandId:'bad',trainId:'t2',action:'park',yardId:'yard-b'}},e),{revision:d.view.revision,tag:d.view.tag});assert.equal(invalid.ok,false);assert.deepEqual(await backup(),seal);
 console.log('PASS unsupported acquisition disabled; invalid transition dry-run unchanged; portrait and landscape fit');
 assert.deepEqual(errors,[]);writeFileSync('r43-evidence/final.json',JSON.stringify({revision:d.view.revision,checksum:d.view.snapshot.checksum,receipts:d.management.trips.length,errors},null,2)+'\n');
 console.log('R43_BROWSER_ACCEPTANCE PASS');
}finally{await context.close();await b.close();}
