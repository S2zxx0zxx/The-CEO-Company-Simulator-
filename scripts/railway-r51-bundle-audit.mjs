import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {collectRailwayNotices,verifyNoticePayload} from './railway-r51-notices.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const expected=await collectRailwayNotices(),lock=JSON.parse(await readFile('package-lock.json','utf8')),registry=JSON.parse(await readFile('docs/railway/ASSET_REGISTRY.json','utf8')),review=JSON.parse(await readFile('docs/railway/R46_ART_REVIEW.json','utf8')),source=JSON.parse(await readFile('docs/railway/R03_SOURCE_LOCK.json','utf8')),licenses=JSON.parse(await readFile('docs/railway/LICENSE_REGISTER.json','utf8'));
assert.equal(source.resources.length,21);assert.equal(licenses.resources.length,21);
assert.deepEqual(source.resources.map(x=>x.id).sort(),licenses.resources.map(x=>x.id).sort());
for(const x of source.resources){const y=licenses.resources.find(y=>y.id===x.id);if(x.licenseBlob){assert.equal(y.licenseBlob,x.licenseBlob);assert.equal(y.pin,x.pin);}}
const registered=[];
for(const row of [...registry,review.previewSource]){const b=await readFile(row.path);assert.equal(blob(b),row.gitBlob);assert.equal(row.releaseClearance,'PENDING_OWNER');registered.push({path:row.path,sha256:sha(b),gitBlob:blob(b),bytes:b.length,releaseClearance:row.releaseClearance});}
const privateHashes=new Set(registered.map(x=>x.sha256));
const inventory=Object.entries(lock.packages).filter(([path])=>path).map(([path,p])=>({path,version:p.version,licenseDeclared:p.license??'NOASSERTION',integrity:p.integrity??null,resolved:p.resolved??null,scope:p.dev?'development':'runtime'}));
async function walk(dir){const all=[];for(const name of (await readdir(dir)).sort()){const p=join(dir,name),s=await lstat(p);assert.ok(!s.isSymbolicLink());if(s.isDirectory())all.push(...await walk(p));else{assert.ok(s.isFile());all.push(p);}}return all;}
const bundles=[];
for(const root of ['railway-dist','r47-qa-dist','r50-qa-dist']){
 const qa=root!=='railway-dist',files=[];
 const build=JSON.parse(await readFile(join(root,'build-id.json'),'utf8'));assert.equal(build.qa,qa);
 for(const [name,bytes] of Object.entries(expected))verifyNoticePayload(bytes,await readFile(join(root,'licenses',name)));
 for(const path of await walk(root)){
  const name=relative(root,path).split(sep).join('/'),bytes=await readFile(path),hash=sha(bytes);
  assert.ok(/^(?:index\.html|build-id\.json|railway\.webmanifest|railway-sw\.js|assets\/[^/]+\.(?:js|css)|licenses\/(?:RUNTIME_LICENSES\.txt|DEPENDENCY_INVENTORY\.json|idle-game-template\.txt|README\.txt))$/.test(name)||(qa&&/^qa-icon-(192|512)\.png$/.test(name)),'Unreviewed bundle payload '+path);
  assert.ok(!privateHashes.has(hash),'Pending-rights asset leaked '+path);
  if(/\.(js|html|css)$/.test(name)){
   assert.ok(!bytes.includes(Buffer.from('R46_DRAFT_ART_ONLY')),'R46 draft art leaked '+path);
   if(!qa)assert.doesNotMatch(bytes.toString('utf8'),/r47Qa|r49Qa|r50Qa|SYNTHETIC_NOT_REAL_DATA|r47-qa-guest|r47-qa-r50-stress/,'QA fixture leaked '+path);
  }
  files.push({name,bytes:bytes.length,sha256:hash});
 }
 const sw=await readFile(join(root,'railway-sw.js'),'utf8'),m=sw.match(/const FILES=(\[[^\n]*?\]);/);assert.ok(m,'Missing precache list');
 assert.deepEqual(JSON.parse(m[1]).sort(),files.filter(f=>f.name!=='railway-sw.js').map(f=>'./'+f.name).sort());
 bundles.push({root,qa,files});
}
await mkdir('r51-evidence',{recursive:true});
const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),productionAccepted:false,scope:'npm inventory, exact generated notices, tracked art and actual isolated web/QA bundles; native Maven and owner clearance remain blocked',inventory,registered,bundles,sourceResources:source.resources.map(x=>({id:x.id,pin:x.pin,licenseBlob:x.licenseBlob,decision:x.decision}))};
await writeFile('r51-evidence/release-inventory.json',JSON.stringify(report,null,2)+'\n');
console.log('R51_BUNDLE PASS '+JSON.stringify({lockPackages:inventory.length,runtimePackages:inventory.filter(x=>x.scope==='runtime').length,sourceResources:21,registeredAssets:registered.length,bundles:bundles.map(x=>({root:x.root,files:x.files.length,bytes:x.files.reduce((a,b)=>a+b.bytes,0)})),productionAccepted:false}));
