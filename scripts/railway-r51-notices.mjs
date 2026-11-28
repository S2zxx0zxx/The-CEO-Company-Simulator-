import {readFile,readdir,lstat,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const digest=b=>createHash('sha256').update(b).digest('hex');
const allowed=new Set(['MIT','ISC','Apache-2.0','0BSD']);
export function validateRuntime(path,p,m){
 assert.ok(/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path)&&!path.includes('..'),'Invalid package path');
 assert.ok(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(p.integrity),'Runtime package integrity missing: '+path);
 assert.equal(new URL(p.resolved).origin,'https://registry.npmjs.org');
 assert.equal(m.version,p.version);assert.equal(m.license,p.license);assert.ok(allowed.has(m.license),'License requires review: '+path);
}
export async function collectRailwayNotices(){
 const lockBytes=await readFile('package-lock.json'),lock=JSON.parse(lockBytes),packages=[],sections=[];
 for(const [path,p] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))){
  if(!path||p.dev)continue;
  const dir=resolve(path),m=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));validateRuntime(path,p,m);
  const notices=[];
  for(const file of (await readdir(dir)).filter(n=>/^(licen[cs]e|copying|notice)([._-].*)?$/i.test(n)).sort()){
   const full=join(dir,file),s=await lstat(full);assert.ok(s.isFile()&&!s.isSymbolicLink(),'Nonregular notice '+full);
   const bytes=await readFile(full);assert.ok(bytes.length>0);notices.push({file,sha256:digest(bytes),bytes:bytes.length});sections.push(m.name+' '+m.version+' — '+m.license+' — '+file+'\n'+bytes.toString('utf8'));
  }
  assert.ok(notices.some(x=>/^(licen[cs]e|copying)/i.test(x.file)),'Missing license text: '+path);
  packages.push({path,name:m.name,version:m.version,licenseDeclared:m.license,integrity:p.integrity,resolved:p.resolved,notices});
 }
 assert.ok(packages.length>0);
 const legacy=await readFile('docs/third-party/idle-game-template-LICENSE.txt'),publicLegacy=await readFile('public/licenses/idle-game-template.txt');assert.deepEqual(legacy,publicLegacy,'Legacy attribution copies differ');
 const metadata={schemaVersion:1,scope:'Conservative npm runtime lock inventory; not exact tree-shaken or native Maven SBOM',lockSha256:digest(lockBytes),productionAccepted:false,packages,legacyAdaptation:{source:'ciefa/idle-game-template@a91cd5f8a26cdffd3f1803297c9a92c0a7f850c4',license:'MIT',sha256:digest(legacy)}};
 return {'RUNTIME_LICENSES.txt':'Railway application — installed runtime dependency notices\n\n'+sections.join('\n\n====================================\n\n')+'\n','DEPENDENCY_INVENTORY.json':JSON.stringify(metadata,null,2)+'\n','idle-game-template.txt':legacy,'README.txt':'These are local offline third-party software notices. The inventory conservatively includes npm runtime lock entries, not a verified native dependency SBOM. The legacy MIT adaptation notice is retained. No final brand or project license is asserted. No real OSM-derived data or regional tiles are included in this development build.\n'};
}
export async function writeRailwayNotices(out){
 const files=await collectRailwayNotices();await mkdir(join(out,'licenses'),{recursive:true});
 for(const [name,bytes] of Object.entries(files))await writeFile(join(out,'licenses',name),bytes);
}
export function verifyNoticePayload(expected,actual){assert.deepEqual(Buffer.from(actual),Buffer.from(expected),'Notice bytes mismatch');}
