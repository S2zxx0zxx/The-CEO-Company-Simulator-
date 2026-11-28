import {object,text,sha256} from '../../domain/validation';
// Preserve the existing outer envelope size cap; validate before calling the save authority.
export const MAX_RECOVERY_FILE_BYTES=64000000;
const envelope=object({payload:text(64000000),tag:sha256});
export async function readRecoveryEnvelope(file:Pick<File,'size'|'arrayBuffer'>){
 if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_RECOVERY_FILE_BYTES)throw Error('Recovery file exceeds envelope limit or is empty');
 const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size||bytes.byteLength>MAX_RECOVERY_FILE_BYTES)throw Error('Recovery file size mismatch');
 let decoded:string;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Recovery file is not valid UTF-8');}
 let input:unknown;try{input=JSON.parse(decoded);}catch{throw Error('Recovery file is not valid JSON');}
 // No execution, object merging or trust of payload here. HMAC and current head checked by store.recover.
 return envelope(input,'recovery envelope');
}
