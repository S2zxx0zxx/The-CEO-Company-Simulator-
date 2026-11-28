import React from 'react';
import {createRoot} from 'react-dom/client';
import {fixture} from '../../../tests/fixtures/railway-r39';
import {createRailwayStore} from '../../../src/rail/persistence';
import {prepareDispatch} from '../../../src/rail/dispatch';
import {RailwayProgressionScreen} from '../../../src/ui/railway/ProgressionScreen';
const f=await fixture({governance:{milestones:[{id:'first-trip',metric:'completed-trips',target:1},{id:'second-trip',metric:'completed-trips',target:2}]}});
const recipe=f.runtime.workerRecipe;
const runtime=await prepareDispatch(f.g,f.catalog,f.movement,{...recipe.config,progressionEvents:[{id:'fixture-season',kind:'seasonal-demand',startSimS:0,endSimS:1,stationIds:['s-a']}]},recipe.lifecycle??undefined,recipe.fleet??undefined);
const store=createRailwayStore(runtime,{maxJournalEntries:100,maxBytes:16000000},{databaseName:'r45-ui-qa'});
try{await store.open();}catch(e){if(!String(e).includes('no trusted save head'))throw e;await store.initialize(0,123,f.opening);}
async function run(kind:string,input:unknown){const v=await store.open();return store.execute({requestId:'qa:'+crypto.randomUUID(),kind,input},{revision:v.revision,tag:v.tag});}
Object.assign(globalThis,{r45Qa:{read:()=>store.progressionView(),export:()=>store.exportLatest(),claim:(requestId:string,missionId:string,cursor:unknown)=>store.execute({requestId,kind:'achievement',input:{missionId}},cursor),trip:async()=>{
 const m=await store.management(),t=m.management.templates.find(t=>t.id==='service-template')!;
 await run('quote',{quoteId:'first-quote',trainId:'t1',templateId:t.id});
 await run('dispatch',{commandId:'first-dispatch',quoteId:'first-quote'});
 await run('advance',{target:t.durationS,budget:100});
 const trip=(await store.management()).management.trips.find(t=>!t.closure)!;
 await run('settle',{commandId:'first-settlement',tripId:trip.receipt.tripId});
}}});
createRoot(document.getElementById('root')!).render(<RailwayProgressionScreen store={store}/>);
