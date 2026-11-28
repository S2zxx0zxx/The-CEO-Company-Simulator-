import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const b=await chromium.launch({headless:true}),context=await b.newContext({viewport:{width:360,height:800}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));mkdirSync('r44-evidence',{recursive:true});
const read=()=>page.evaluate(()=>r44Qa.read()),backup=()=>page.evaluate(()=>r44Qa.export());
const tab=n=>page.getByRole('navigation').getByRole('button',{name:n,exact:true}).click();
const wait=()=>page.getByRole('heading',{name:'Cash is not profit'}).waitFor();
async function prepare(label,kind){const before=await backup();await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('heading',{name:'Confirm '+kind,exact:true}).waitFor();assert.deepEqual(await backup(),before);}
async function commit(){await page.getByRole('button',{name:'Confirm financial commit',exact:true}).click();await page.getByRole('status').filter({hasText:/Committed:/}).waitFor();await page.waitForFunction(()=>document.querySelector('main')?.getAttribute('aria-busy')==='false');}
try{
 await page.goto('http://127.0.0.1:4184/');await wait();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'r44-evidence/summary-360.png',fullPage:true});
 const original=await read();assert.equal(original.finance.accounting.accountingProfitMinor,'0');await tab('Energy');await page.getByLabel('Energy unit',{exact:true}).selectOption('mL');await page.getByLabel('Energy quantity',{exact:true}).fill('100');await prepare('Preview energy purchase','purchase');await commit();
 const bought=await read();assert.equal(BigInt(original.finance.accounting.liquidityView.cashMinor)-BigInt(bought.finance.accounting.liquidityView.cashMinor),200n);assert.equal(bought.finance.energy.inventory[0].onHand,'400');assert.equal(bought.finance.accounting.accountingProfitMinor,'0');
 console.log('PASS actual inventory purchase, cash and profit distinction; immutable preview');
 await page.getByLabel('Contract expiry',{exact:true}).fill('90');await prepare('Preview price-lock contract','contract');await commit();const locked=await read();assert.equal(locked.finance.accounting.liquidityView.cashMinor,bought.finance.accounting.liquidityView.cashMinor);assert.equal(locked.finance.market.contracts.length,1);
 await page.getByLabel('Price source',{exact:true}).selectOption(locked.finance.market.contracts[0].id);await prepare('Preview energy purchase','purchase');await commit();assert.equal((await read()).finance.market.contracts[0].status,'exhausted');await page.screenshot({path:'r44-evidence/energy-360.png',fullPage:true});
 console.log('PASS contract lock and draw');
 await page.reload();await wait();await tab('Bank');await page.getByLabel('Loan to repay',{exact:true}).selectOption('loan');await page.getByRole('button',{name:'Use recorded payoff amount'}).click();await prepare('Preview repayment','repay');await commit();assert.equal((await read()).finance.accounting.liquidityView.totalPayoffMinor,'0');
 console.log('PASS persisted reload and actual repayment');
 await tab('Ledger');await page.getByLabel('Journal account',{exact:true}).selectOption('energy-inventory');await page.getByText(/matching entries/).waitFor();await page.screenshot({path:'r44-evidence/ledger-360.png',fullPage:true});
 await tab('Company');assert.equal(await page.getByRole('button',{name:'Issue IPO / buy or sell virtual shares'}).isDisabled(),true);await page.getByRole('heading',{name:'Company value',exact:true}).waitFor();await page.setViewportSize({width:800,height:366});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'r44-evidence/company-800.png',fullPage:true});
 await tab('Energy');await page.getByLabel('Energy unit',{exact:true}).selectOption('mL');await page.getByLabel('Price source',{exact:true}).selectOption('');await page.getByLabel('Energy quantity',{exact:true}).fill('1');await prepare('Preview energy purchase','purchase');const other=await context.newPage();await other.goto('http://127.0.0.1:4184/');await other.getByRole('heading',{name:'Cash is not profit'}).waitFor();await other.evaluate(()=>r44Qa.advance(1));await other.close();
 const stale=await backup();await page.getByRole('button',{name:'Confirm financial commit'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/STALE_DURABLE_REVISION/);assert.deepEqual(await backup(),stale);
 console.log('PASS cross-tab stale financial preview rejected; unsupported IPO disabled; mobile and landscape fit');
 assert.deepEqual(errors,[]);const final=await read();writeFileSync('r44-evidence/final.json',JSON.stringify({revision:final.view.revision,checksum:final.view.snapshot.checksum,errors},null,2)+'\n');console.log('R44_BROWSER_ACCEPTANCE PASS');
}finally{await context.close();await b.close();}
