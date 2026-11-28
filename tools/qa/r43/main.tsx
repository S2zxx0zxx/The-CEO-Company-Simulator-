import React from 'react';
import {createRoot} from 'react-dom/client';
import {fixture} from '../../../tests/fixtures/railway-r39';
import {createRailwayStore} from '../../../src/rail/persistence';
import {RailwayFleetScreen} from '../../../src/ui/railway/FleetScreen';
const root=createRoot(document.getElementById('root')!);
const f=await fixture({repair:true,relocation:true}),limits={maxJournalEntries:100,maxBytes:16000000};
const store=createRailwayStore(f.runtime,limits,{databaseName:'r43-ui-qa'});
try{await store.open();}catch(e){if(!String(e).includes('no trusted save head'))throw e;await store.initialize(0,123,f.opening);}
Object.assign(globalThis,{r43Qa:{read:()=>store.management(),export:()=>store.exportLatest(),check:(q:unknown,e:unknown)=>store.checkManagement(q,e),advance:async(target:number)=>{const v=await store.open();return store.execute({requestId:'qa:'+crypto.randomUUID(),kind:'advance',input:{target,budget:100}},{revision:v.revision,tag:v.tag});}}});
root.render(<RailwayFleetScreen store={store}/>);
