import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const quarantined=/(^|\/)(?:private[-_]?evidence|quarantine|reference[-_]?checkouts|00_inventory|01_apk_extracted|02_resources|03_assets|04_code|05_agent_docs|06_tools|07_extended_audit|08_priority_research|09_final_agent_handoff)(\/|$)/i;
const forbidden= /\.(?:apk|apks|aab|dex|odex|vdex|smali|so|dll|exe|jar|aar|zip|7z|rar|tar|gz|pbf|pmtiles|mbtiles|jks|keystore|p12|pfx|pem|key|crt|prof|profm|bmnetwork)$/i;
const media=/\.(?:svg|png|jpe?g|webp|gif|ico|avif|ttf|otf|woff2?|mp3|wav|ogg|flac|mp4|webm|glb|gltf|fbx|blend)$/i;
const digest=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
export function registry(rows){
 if(!Array.isArray(rows))throw Error('Asset registry must be an array');
 const out=new Map();
 for(const row of rows){
  if(!row||typeof row.path!=='string'||out.has(row.path)||!/^[a-f0-9]{40}$/.test(row.gitBlob)||!['LEGACY_ORIGINAL_RETAINED','ORIGINAL_REVIEWED','LICENSED_REVIEWED'].includes(row.disposition)||typeof row.rightsEvidence!=='string'||!row.rightsEvidence.trim()||typeof row.sourceRevision!=='string'||!row.sourceRevision.trim())throw Error('Invalid or duplicate asset provenance row');
  if(row.disposition!=='LEGACY_ORIGINAL_RETAINED'&&row.releaseClearance!=='APPROVED')throw Error('New asset lacks explicit clearance: '+row.path);
  out.set(row.path,row);
 }
 return out;
}
export function inspect(path,bytes,mode,approved){
 const findings=[];
 const add=kind=>findings.push({path,kind});
 if(!['100644','100755'].includes(mode))add('nonregular-git-entry');
 if(quarantined.test(path)||/Train_Manager_Final_V4_Agent_Implementation_Pack|Railway_Manager_Master_Build_Pack|Railway_Manager_V5_R\d+_Checkpoint/i.test(path)||forbidden.test(path)||/(^|\/)\.env(?:\.|$)/i.test(path))add('quarantined-path-or-file-type');
 if(bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))||bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x05,0x06]))||bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x07,0x08]))||bytes.subarray(0,4).equals(Buffer.from('dex\n'))||bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))||bytes.subarray(0,2).equals(Buffer.from([0x1f,0x8b]))||bytes.subarray(0,2).equals(Buffer.from('MZ')))add('opaque-executable-or-archive-signature');
 if(media.test(path)||bytes.includes(0)){
  const row=approved.get(path);
  if(!media.test(path))add('unknown-binary');
  else if(!row||row.gitBlob!==digest(bytes))add('unregistered-or-changed-asset');
 }
 if(/^public\//.test(path)&&!media.test(path)&&!/^public\/(?:manifest\.webmanifest|privacy\.html|licenses\/[^/]+\.txt)$/.test(path))add('unreviewed-public-payload');
 return findings;
}
export async function main(){
 const approved=registry(JSON.parse(await readFile('docs/railway/ASSET_REGISTRY.json','utf8')));
 const entries=execFileSync('git',['ls-files','--stage','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
 const findings=[],seen=new Set();
 for(const entry of entries){
  const tab=entry.indexOf('\t'),[mode,,stage]=entry.slice(0,tab).split(' '),path=entry.slice(tab+1);
  if(stage!=='0'||seen.has(path)){findings.push({path,kind:'unmerged-or-duplicate-index-entry'});continue}
  seen.add(path);
  if(!['100644','100755'].includes(mode)||!(await lstat(path)).isFile()){findings.push({path,kind:'nonregular-git-entry'});continue}
  findings.push(...inspect(path,await readFile(path),mode,approved));
 }
 for(const [path] of approved)if(!seen.has(path))findings.push({path,kind:'stale-provenance-row'});
 await mkdir('audit-output',{recursive:true});
 await writeFile('audit-output/railway-quarantine.json',JSON.stringify({trackedFiles:seen.size,registeredAssets:approved.size,findings,limitations:'Path, signature and registered-content checks only; not proof of authorship, absence of transformed copies or all secrets. Private archive comparison and final package review separate.'},null,2));
 if(findings.length){console.error(findings.map(x=>x.kind+': '+x.path).join('\n'));process.exitCode=1}
 else console.log('Railway quarantine: '+seen.size+' tracked files, '+approved.size+' registered assets, zero findings.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
