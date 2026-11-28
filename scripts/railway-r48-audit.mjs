import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const policy=JSON.parse(await readFile('docs/railway/R48_OPTIONAL_SCOPE.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8'));
const runtime=Object.entries(lock.packages).filter(([k,v])=>k&&!v.dev).map(([path,v])=>({path,version:v.version,license:v.license})).sort((a,b)=>a.path.localeCompare(b.path));
assert.deepEqual(runtime,policy.runtimePackages,'Runtime dependency changes require review');
const pkg=JSON.parse(await readFile('package.json','utf8'));assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);
const forbidden=/(?:google-mobile-ads|play-services-ads|com\.android\.billingclient|com\.google\.android\.gms\.ads|com\.google\.android\.gms\.permission\.AD_ID|com\.android\.vending\.BILLING|firebase-analytics|facebook-android-sdk|revenuecat|appsflyer|adjust-sdk|onesignal|stripe|razorpay|admob)/i;
assert.ok(!Object.keys(lock.packages).some(k=>forbidden.test(k)),'Unapproved SDK in lockfile');
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(src\/rail\/|src\/ui\/railway\/|src\/platform\/|railway-app\/)/.test(p)&&/\.(?:tsx?|html|css)$/.test(p));
for(const p of files){const t=await readFile(p,'utf8');assert.doesNotMatch(t,/\b(?:fetch|WebSocket|EventSource|sendBeacon)\s*\(\s*['"`](?:https?|wss?):/i,'Literal external runtime call '+p);}
for(const path of ['railway-dist','r47-qa-dist']){
 const html=await readFile(join(path,'index.html'),'utf8');assert.match(html,/Content-Security-Policy/);const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i);assert.ok(policy,'Missing CSP meta');
 const directives=new Map();for(const part of policy[1].split(';').map(s=>s.trim()).filter(Boolean)){const [name,...values]=part.split(/\s+/);assert.ok(!directives.has(name),'Duplicate CSP directive '+name);directives.set(name,values.join(' '));}
 for(const [name,values] of Object.entries({'default-src':"'none'",'script-src':"'self'",'connect-src':"'self'",'object-src':"'none'",'base-uri':"'none'",'form-action':"'none'",'frame-src':"'none'",'worker-src':"'self' blob:",'font-src':"'self'",'manifest-src':"'self'"}))assert.equal(directives.get(name),values,'Unexpected CSP '+name);
 assert.ok(!policy[1].includes("'unsafe-eval'")&&!policy[1].includes('https:')&&!policy[1].includes('*'),'Broad CSP allowance');
}
await mkdir('r47-evidence',{recursive:true});await writeFile('r47-evidence/r48-source-audit.json',JSON.stringify({runtime,sourceFiles:files.length,csp:true,limitations:'Pinned package and literal endpoint checks plus browser network tests; not proof against dynamic same-origin calls or malicious code. No final native release audit.'},null,2));
console.log('R48_SOURCE PASS '+runtime.length+' exact runtime dependencies; '+files.length+' source files; local-only CSP in both builds');
