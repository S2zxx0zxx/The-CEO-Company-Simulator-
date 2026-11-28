import React from 'react';
import {createRoot} from 'react-dom/client';
import {fixture} from '../../../tests/fixtures/railway-r39';
import {createRailwayStore} from '../../../src/rail/persistence';
import {RailwayFinanceScreen} from '../../../src/ui/railway/FinanceScreen';
const f=await fixture({market:true,loan:true}),store=createRailwayStore(f.runtime,{maxJournalEntries:100,maxBytes:16000000},{databaseName:'r44-ui-qa'});
try{await store.open();}catch(e){if(!String(e).includes('no trusted save head'))throw e;await store.initialize(0,123,f.opening);}
Object.assign(globalThis,{r44Qa:{read:()=>store.financeView(),export:()=>store.exportLatest(),advance:async(target:number)=>{const v=await store.open();return store.execute({requestId:'qa:'+crypto.randomUUID(),kind:'advance',input:{target,budget:100}},{revision:v.revision,tag:v.tag});}}});
createRoot(document.getElementById('root')!).render(<RailwayFinanceScreen store={store}/>);
