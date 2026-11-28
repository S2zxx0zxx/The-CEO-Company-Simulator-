import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true});
try{
 const page=await b.newPage();
 await page.goto('http://127.0.0.1:4180/');
 async function result(name){
  await page.waitForFunction(n=>[n,'r40-error'].includes(document.body.dataset.phase),name,{timeout:120000});
  const r=JSON.parse(await page.locator('body').innerText());
  assert.ok(!r.error,JSON.stringify(r));return r;
 }
 const phase=await result('r40-phase');
 assert.equal(phase.native,false);assert.equal(phase.creditedWallMs,120000);
 await page.reload();
 const final=await result('r40-final');
 assert.equal(final.checkpointTag,phase.tag);assert.equal(final.checksum,final.directChecksum);
 writeFileSync('r40-evidence/web.json',JSON.stringify({phase,final},null,2)+'\n');
 console.log('R40_WEB_REFERENCE '+JSON.stringify(final));
}finally{await b.close();}
