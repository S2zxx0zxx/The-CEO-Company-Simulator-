import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const review=JSON.parse(await readFile('docs/railway/R46_ART_REVIEW.json','utf8')),row=review.previewSource;
assert.equal(row.path,'tools/qa/r46/PreviewArt.tsx');assert.equal(row.releaseClearance,'PENDING_OWNER');assert.equal(row.disposition,'ORIGINAL_PREVIEW_ONLY');
const bytes=await readFile(row.path),art=bytes.toString('utf8'),blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(blob,row.gitBlob);assert.ok(art.includes('R46_DRAFT_ART_ONLY'));assert.doesNotMatch(art,/<image\b|<script\b|dangerouslySetInnerHTML|https?:\/\/|\bfetch\s*\(|url\s*\(/i);
async function files(dir){const out=[];for(const name of await readdir(dir)){const p=join(dir,name),s=await lstat(p);assert.ok(!s.isSymbolicLink());if(s.isDirectory())out.push(...await files(p));else out.push(p);}return out;}
for(const p of await files('src'))if(/\.(?:tsx?|jsx?|mjs|css)$/.test(p))assert.doesNotMatch(await readFile(p,'utf8'),/tools\/qa\/r46|PreviewArt|R46_DRAFT_ART_ONLY/);
for(const p of await files('dist'))assert.ok(!(await readFile(p)).includes(Buffer.from('R46_DRAFT_ART_ONLY')),'Draft art leaked into '+p);
console.log('R46 art source bytes '+bytes.length+'; git blob '+blob+'; SHA256 '+createHash('sha256').update(bytes).digest('hex')+'; QA-only source and production dist exclusion PASS');
