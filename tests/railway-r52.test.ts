import {describe,it,expect,vi,afterEach} from 'vitest';
import {readRecoveryEnvelope,MAX_RECOVERY_FILE_BYTES} from '../src/rail/persistence/import';
import {createRailwaySaveKey,sealRailwaySave,decodeRailwaySave} from '../src/rail/persistence';
import {initRailwayPwa} from '../src/rail/guest/pwa';
const file=(s:string)=>new Blob([s]);
const limits={maxJournalEntries:20,maxBytes:1000000};
const body={format:'railway-ceo-save' as const,schemaVersion:2 as const,companyId:'co',configurationSha256:'a'.repeat(64),revision:1,previousTag:null,limits,snapshot:{fixture:true},quotes:[],journal:[]};
afterEach(()=>vi.unstubAllGlobals());
describe('R52 recovery input boundary',()=>{
 it('preserves valid exact envelope for HMAC verification',async()=>{const key=await createRailwaySaveKey(),sealed=await sealRailwaySave(body,key);expect(await decodeRailwaySave(await readRecoveryEnvelope(file(JSON.stringify(sealed))),key,limits)).toEqual(body);});
 it.each(['','{','null','[]','{"payload":"{}","tag":"bad"}','{"payload":"{}","tag":"'+ 'a'.repeat(64)+'","extra":true}','{"payload":"{}","tag":"'+ 'a'.repeat(64)+'","__proto__":{"x":1}}'])('rejects malformed or extended file %s',async s=>{await expect(readRecoveryEnvelope(file(s))).rejects.toThrow();});
 it('rejects oversized input before read, size mismatch and invalid UTF8',async()=>{const arrayBuffer=vi.fn();await expect(readRecoveryEnvelope({size:MAX_RECOVERY_FILE_BYTES+1,arrayBuffer})).rejects.toThrow('limit');expect(arrayBuffer).not.toHaveBeenCalled();await expect(readRecoveryEnvelope({size:2,arrayBuffer:async()=>new ArrayBuffer(1)})).rejects.toThrow('size mismatch');await expect(readRecoveryEnvelope(new Blob([Uint8Array.of(0xff)]))).rejects.toThrow('UTF-8');});
 it('rejects extractable or non-256-bit HMAC and wrong usage',async()=>{for(const k of [await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},true,['sign','verify']),await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:128},false,['sign','verify']),await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign'])])await expect(sealRailwaySave(body,k)).rejects.toThrow('invalid installation key');});
});
describe('R52 foreign service worker boundary',()=>{
 it.each(['active','waiting','installing'])('does not replace foreign %s worker before it controls the page',async phase=>{const register=vi.fn();vi.stubGlobal('document',{baseURI:'https://rail.example/'});vi.stubGlobal('navigator',{serviceWorker:{controller:null,getRegistration:vi.fn(async()=>({scope:'https://rail.example/',[phase]:{scriptURL:'https://rail.example/sw.js'}})),register}});await expect(initRailwayPwa(()=>{})).rejects.toThrow('foreign service worker');expect(register).not.toHaveBeenCalled();});
});
