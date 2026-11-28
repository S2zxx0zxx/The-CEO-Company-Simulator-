import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const b=await chromium.launch({headless:true}),ctx=await b.newContext({viewport:{width:360,height:800}}),page=await ctx.newPage(),errors=[];
mkdirSync('r45-evidence',{recursive:true});page.on('pageerror',e=>errors.push(String(e)));
const read=()=>page.evaluate(()=>r45Qa.read()),backup=()=>page.evaluate(()=>r45Qa.export());
const refresh=async()=>{await page.getByRole('button',{name:'Refresh',exact:true}).click();};
const first=p=>p.locator('section').filter({has:p.getByRole('heading',{name:'first-trip',exact:true})});
try{
 await page.goto('http://127.0.0.1:4185/');await first(page).waitFor();
 assert.equal(await first(page).getByRole('button',{name:'Incomplete'}).isDisabled(),true);
 assert.equal((await read()).events[0].status,'active');
 const initial=await backup();const v=await read(),cursor={revision:v.view.revision,tag:v.view.tag};
 await assert.rejects(page.evaluate(c=>r45Qa.claim('early','first-trip',c),cursor),/incomplete/);assert.deepEqual(await backup(),initial);
 await page.evaluate(()=>r45Qa.trip());await refresh();await first(page).getByRole('button',{name:'Claim recognition'}).waitFor();
 const earned=await read();assert.equal(earned.missions.find(m=>m.id==='first-trip').completed,true);assert.equal(earned.events[0].status,'expired');
 assert.equal(earned.missions.find(m=>m.id==='second-trip').completed,false);
 console.log('PASS actual trip settlement drives progress; deterministic event expiry; early claim rejected');
 const other=await ctx.newPage();await other.goto('http://127.0.0.1:4185/');await first(other).getByRole('button',{name:'Claim recognition'}).waitFor();
 const cursor2={revision:earned.view.revision,tag:earned.view.tag};
 const result=await page.evaluate(c=>r45Qa.claim('recognition','first-trip',c),cursor2);
 const after=await read();assert.equal(after.view.snapshot.checksum,earned.view.snapshot.checksum);assert.equal(after.missions.find(m=>m.id==='first-trip').claim.reward,'recognition');
 const replay=await page.evaluate(c=>r45Qa.claim('recognition','first-trip',c),cursor2);assert.equal(replay.replayed,true);assert.equal(replay.committedRevision,result.committedRevision);
 const sealed=await backup();await first(other).getByRole('button',{name:'Claim recognition'}).click();await other.getByRole('alert').waitFor();assert.match(await other.getByRole('alert').innerText(),/STALE_DURABLE_REVISION/);assert.deepEqual(await backup(),sealed);
 await assert.rejects(page.evaluate(c=>r45Qa.claim('different-id','first-trip',c),{revision:after.view.revision,tag:after.view.tag}),/already claimed/);assert.deepEqual(await backup(),sealed);
 await other.close();await page.reload();await first(page).getByRole('button',{name:'Claimed'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'r45-evidence/progression-360.png',fullPage:true});await page.setViewportSize({width:800,height:366});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);writeFileSync('r45-evidence/final.json',JSON.stringify({revision:after.view.revision,checksum:after.view.snapshot.checksum,mission:after.missions.find(m=>m.id==='first-trip')},null,2)+'\n');console.log('PASS durable claim replay, duplicate and stale rejection, unchanged simulation, reload and responsive layout');
}finally{await ctx.close();await b.close();}
