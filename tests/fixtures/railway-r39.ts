import {prepareDispatch} from '../../src/rail/dispatch';
import {prepareMovement} from '../../src/rail/movement';
import {RailGraph} from '../../src/rail/graph';
import {RollingStockCatalog,type CatalogField} from '../../src/rail/catalog';
import {findRoute,profileHash,policyHash} from '../../src/rail/routing';
import {pack,edge,turn,policy,diesel} from './railway-synthetic';
import {createDemandBook} from '../../src/rail/economy/demand';
import {createRevenueBook} from '../../src/rail/economy/revenue';
import {createEnergyBook,applyEnergyEvent,inspectEnergyBook} from '../../src/rail/economy/energy';
import {createOperatingBook,applyOperatingEvent,inspectOperatingBook} from '../../src/rail/economy/operations';
import {createIncentiveBook,inspectIncentiveBook} from '../../src/rail/economy/incentives';
import {createAccountingBook,applyAccountingCommand,inspectAccountingBook,reportAccountingPeriod,type AccountingSources} from '../../src/rail/economy/accounting';
import {createEnergyMarket,applyMarketAction,inspectEnergyMarket,type EnergyMarketBook} from '../../src/rail/economy/market';

const fields:CatalogField[]=['name','kind','traction','gaugesMm','voltagesV','frequenciesHz','maxSpeedKmh','rangeM','capacitySeats','cargoCapacityKg','purchasePriceMinor','massKg','energyPerKm'];
const prov={sourceUrl:'urn:railway:r34-fixture',sourceId:'fictional',sourceVersion:'1',license:'original-fixture',qualityFlags:['SYNTHETIC_NOT_REAL_DATA']};
const cat=()=>RollingStockCatalog.prepare({schemaVersion:1,id:'fictional-r34',revision:1,currency:'INR',entries:[{name:'Fictional engine',kind:'mixed-train',identity:'fictional',modelRevision:1,model:{id:'engine',traction:'diesel',gaugesMm:[1676],voltagesV:[],frequenciesHz:[],maxSpeedKmh:72,rangeM:10000,capacitySeats:20,cargoCapacityKg:100,purchasePriceMinor:'1000',massKg:1000,provenance:prov},energyPerKm:[{mode:'diesel',unit:'mL',quantityPerKm:'60'}],fieldOrigins:fields.map(field=>({field,classification:'game-balanced',evidenceId:null}))}]});
const finance={creditLimitMinor:'100000',maxInterestBps:1000,interestPeriodS:100,maxTermS:1000};
const opsPolicy={id:'ops',trackRates:[{regionId:'synthetic-r11',trackClass:'main',minorPerKm:'100'}],terminalRates:[],crewRates:[],crew:[],staff:[],payrollOriginSimS:0,payrollPeriodS:100,wearRules:[{modelId:'engine',maintenanceIntervalM:1000000,agePeriodS:1000,ageIncrementBps:0,maxAgeFactorBps:10000,maxLoadFactorBps:10000,maxWornFactorBps:10000}]};
const service={intervalS:1000,repairThresholdBps:3000,restoreToBps:9000,scheduledCostMinor:'100',repairMinorPerBps:'2',scheduledDurationS:20,repairBaseDurationS:10,repairSecondsPerBps:1};
const asset={purchaseMinor:'1000',residualMinor:'100',usefulLifeS:3000};
const gov=(extra:Record<string,unknown>={})=>({id:'gov',companyId:'co',startSimS:0,reviewPeriodS:1000,gracePeriodS:20,minOperatingCashMinor:'0',minPayoffEquityMinor:'0',rescueBudgetMinor:'1000',maxRescues:2,rescueTermS:300,rescueInterestBps:0,liquidationRecoveryBps:5000,milestones:[],unlocks:[],...extra});
const factor={loadFactorBps:10000,gradeFactorBps:10000,idleQuantityPerHour:'0',auxQuantityPerHour:'0',requestedRegenWh:'0',maxRegenBps:0};
const fare={baseMinor:'100',rateMinorPerKm:'0',discountBps:0,capMinor:'1000'};
const claim=(bucketId:string,kind:string)=>({bucketId,boardIndex:0,alightIndex:1,requested:kind==='passenger'?20:10,outsideWeight:1,services:[{serviceId:'svc',weight:9999}],pricing:kind==='passenger'?{kind,classId:'std',policy:fare}:{kind,rateMinorPerTonneKm:'100000',serviceFactorBps:10000}});
const bucket=(id:string,kind:string,total:number)=>({kind,bucket:{id,origin:'s-a',destination:'s-b',intervalStartS:0,intervalEndS:1000,total,available:total,reserved:0,served:0}});
const copy=(v:unknown):any=>JSON.parse(JSON.stringify(v));
type Options={stressFleet?:number;lab?:{seed:number;periodS:number;demandWindowS:number;maintenanceIntervalS:number;assetLifeS:number;freight:number;marketShock:boolean;inspectionEvasionBps:number};yardCapacity?:number;baseCapacity?:number;repair?:boolean;parked?:boolean;foreign?:boolean;invalidAnchor?:boolean;relocation?:boolean;capacity?:number;passengers?:number;energy?:string;cash?:string;reserve?:string;ttl?:number;maxPending?:number;maxBulk?:number;maxQuotes?:number;maxReceipts?:number;blocked?:boolean;serviceJob?:boolean;market?:boolean;governance?:Record<string,unknown>;template?:Record<string,unknown>;loan?:boolean;multi?:boolean;earlyDelivery?:boolean;inspection?:boolean;subsidy?:boolean;refund?:string;staff?:string;crew?:boolean;sharedCrew?:boolean;loanMaturity?:number;interestBps?:number;rate?:string;life?:Record<string,unknown>;noLifecycle?:boolean};
export async function fixture(o:Options={}){
 const lab=o.lab,seed=lab?.seed??123,period=lab?.periodS??100;
 const catalog=await cat(),g=new RailGraph(o.multi?pack({a:[0,0],b:[1,0],c:[2,0]},[edge('ab','a','b'),edge('bc','b','c')],[turn('ab','bc',5)]):pack({a:[0,0],b:[1,0]},[edge('ab','a','b'),edge('ba','b','a')]));
 const stops=o.multi?['s-a','s-b','s-c']:['s-a','s-b'],destination=o.multi&&!o.earlyDelivery?'s-c':'s-b';
 const reference=catalog.reference('engine'),profile=catalog.profile(reference),pol=policy();
 const request={routeId:'route',graphSha256:g.graphSha256,trainProfileSha256:await profileHash(profile),policySha256:await policyHash(pol),profile,policy:pol,stopIds:stops,objective:'time',initialOperating:diesel,maxLabels:1000,maxWork:10000};
 const route=await findRoute(g,request);if(!route.ok)throw Error(route.reason);
 const backRequest={...request,routeId:'back',stopIds:['s-b','s-a']};const back=await findRoute(g,backRequest);if(!back.ok)throw Error(back.reason);
 const count=o.stressFleet??3;if(!Number.isSafeInteger(count)||count<1||count>128)throw Error('Synthetic fleet size out of bounds');
 const roster=Array.from({length:count},(_,i)=>'t'+(i+1)).map(trainId=>({trainId,catalogReference:reference,nodeId:'a'}));
 const movement=await prepareMovement(g,catalog,{schemaVersion:1,resources:[{id:'block',capacity:o.capacity??2},...(o.multi?[{id:'block2',capacity:2},{id:'station',capacity:2}]:[])],edges:[{edgeId:'ab',resourceId:'block'},{edgeId:'ba',resourceId:'block'},...(o.multi?[{edgeId:'bc',resourceId:'block2'}]:[])],nodes:o.multi?[{nodeId:'b',resourceId:'station'}]:[]},[{id:'move',catalogReference:reference,request,route,dynamics:{accelerationS:10,brakingS:10,dwellS:o.multi?[20]:[]}},{id:'back',catalogReference:reference,request:backRequest,route:back,dynamics:{accelerationS:10,brakingS:10,dwellS:[]}}],roster,{maxTrips:o.stressFleet??10,maxPending:o.stressFleet?o.stressFleet*8+20:20});
 const demand=createDemandBook([bucket('p','passenger',o.passengers??100),bucket('f','freight',lab?.freight??(o.stressFleet?o.stressFleet*20+100:100))].map(b=>({...b,bucket:{...b.bucket,destination,intervalEndS:lab?.demandWindowS??b.bucket.intervalEndS}}))),revenue=createRevenueBook();
 const cap=[{unit:'mL',quantity:o.stressFleet?String(o.stressFleet*100+1000):'1000'}],qty=o.energy??'300';
 let market:EnergyMarketBook|null=null,energy=createEnergyBook(cap);
 if(o.market){
  market=createEnergyMarket({startSimS:0,periodS:period,seed,maxContractDurationS:period,rules:[{unit:'mL',priceQuantity:'100',minPriceMinor:lab?.marketShock?'100':'200',meanPriceMinor:'200',maxPriceMinor:lab?.marketShock?'400':'200',initialPriceMinor:'200',reversionBps:lab?.marketShock?2500:0,shockAmplitudeMinor:lab?.marketShock?'100':'0',contractDiscountBps:0}]},cap);
  market=applyMarketAction(market,{expectedRevision:market.revision,action:{type:'purchase',lotId:'lot',unit:'mL',quantity:qty,contractId:null,availableCashMinor:o.stressFleet?'1000000':'10000'}});energy=inspectEnergyMarket(market).energy;
 }else energy=applyEnergyEvent(energy,{expectedRevision:energy.revision,event:{type:'purchase',lotId:'lot',energy:{unit:'mL',quantity:qty},source:{kind:'spot',contractId:null,priceMinor:'200',priceQuantity:'100'},availableCashMinor:'10000'}});
 let operations=createOperatingBook(catalog,'co',{...opsPolicy,payrollPeriodS:period,trackRates:[{regionId:'synthetic-r11',trackClass:'main',minorPerKm:o.rate??'100'}],terminalRates:[{stationId:'s-a',activity:'departure',chargeMinor:'10'},{stationId:'s-a',activity:'arrival',chargeMinor:'20'},{stationId:'s-b',activity:'departure',chargeMinor:'10'},{stationId:stops.at(-1),activity:'arrival',chargeMinor:'20'},...(o.multi?[{stationId:'s-b',activity:'transit',chargeMinor:'5'}]:[])],crew:o.crew?[{employeeId:'driver1',roleId:'driver'},{employeeId:'driver2',roleId:'driver'}]:[],crewRates:o.crew?[{roleId:'driver',minorPerHour:'3600'}]:[],staff:o.staff?[{employeeId:'staff',minorPerPeriod:o.staff}]:[]},roster.map(r=>({train:{id:r.trainId,companyId:'co',modelId:'engine',state:o.blocked&&r.trainId==='t1'?'BLOCKED':o.parked&&r.trainId==='t1'?'PARKED':'IDLE',conditionBps:(o.serviceJob||o.repair)&&r.trainId==='t1'?3000:10000,baseId:o.parked&&r.trainId==='t1'?'base-a':null,routeId:null},catalogReference:reference,acquiredAtSimS:0,ageAtAcquisitionS:0,odometerM:0})));
 for(const r of roster)operations=applyOperatingEvent(catalog,operations,{expectedRevision:operations.revision,event:{type:'configure-maintenance',trainId:r.trainId,atSimS:0,service:{...service,intervalS:lab?.maintenanceIntervalS??service.intervalS,...((o.serviceJob||o.repair)&&r.trainId==='t1'?{restoreToBps:3100}:{})},asset:{...asset,usefulLifeS:lab?.assetLifeS??asset.usefulLifeS}}});
 const incentives=createIncentiveBook({seed,programs:o.subsidy?[{program:{id:'grant',budgetMinor:'250',remainingMinor:'250',startS:0,endS:1000},serviceId:'svc',stopIds:stops,unit:'passenger',rateMinor:'20'}]:[],inspectionPolicies:o.inspection?[{serviceId:'svc',classId:'std',evasionBps:lab?.inspectionEvasionBps??10000,deterrenceBps:0,detectionBps:10000,fineMinor:'50',fineCapMinor:'30'}]:[],marketing:{budgetMinor:'1000',halfSaturationMinor:'100',maxLiftBps:5000}},demand,revenue);
 const context=()=>({catalog,demand,revenue,energy,operations,incentives});
 let accounting=await createAccountingBook(o.cash??'10000',0,{...finance,...(lab?{interestPeriodS:period,maxTermS:lab.demandWindowS}:{})},context());
 const apply=async(action:unknown)=>{const c=context();accounting=await applyAccountingCommand(accounting,c,{expectedRevision:accounting.revision,expectedSources:{demand:demand.revision,revenue:revenue.revision,energy:energy.revision,operations:operations.revision,incentives:incentives.revision},commandId:'opening-'+accounting.revision,action});};
 for(const r of roster)await apply({type:'acquire-asset',atSimS:0,trainId:r.trainId});
 await apply({type:'buy-energy',atSimS:0,lotId:'lot'});
 if(o.serviceJob){
  operations=applyOperatingEvent(catalog,operations,{expectedRevision:operations.revision,event:{type:'service-start',jobId:'job',trainId:'t1',atSimS:0,availableCashMinor:'1000'}});
  await apply({type:'maintenance',atSimS:0,jobId:'job'});
 }
 if(o.loan)await apply({type:'borrow',atSimS:0,loanId:'loan',principalMinor:'100',maturityS:o.loanMaturity??15,interestBps:o.interestBps??0});
 const config={schemaVersion:1,governance:gov({...((lab)?{reviewPeriodS:period}:{}),...o.governance}),templates:[{id:'service-template',movementPlanId:'move',serviceId:'svc',request,route,claims:[claim('p','passenger'),claim('f','freight')].map(c=>({...c,alightIndex:o.multi&&!o.earlyDelivery?2:1})),energyFactors:o.multi?[factor,factor]:[factor],expectedCostMinor:'300',reserveMinor:o.reserve??'500',quoteTtlS:o.ttl??30,delayRateMinorPerSecond:'2',delayCapMinor:'15',risks:[],...o.template}],maxPending:o.maxPending??20,maxQuotes:o.maxQuotes??20,maxReceipts:o.maxReceipts??20,maxBulk:o.maxBulk??5};
 const lifecycle={schemaVersion:1,templates:[{templateId:'service-template',trackClasses:o.multi?['main','main']:['main'],terminals:[{stopIndex:0,activity:'departure'},{stopIndex:stops.length-1,activity:'arrival'},...(o.multi?[{stopIndex:1,activity:'transit'}]:[])],loadFactorBps:10000,inspectionMode:o.inspection?'configured':'none',checkedBps:o.inspection?10000:0,collectedBps:o.inspection?10000:0,refunds:[{classId:'std',minorPerPaid:o.refund??'0'}],subsidyProgramId:o.subsidy?'grant':null}],crew:roster.map((r,i)=>({trainId:r.trainId,employeeIds:o.crew?[o.sharedCrew?'driver1':i===0?'driver1':'driver2']:[]})),...o.life};
 const backTemplate={...config.templates[0],id:'relocate',movementPlanId:'back',serviceId:'r36:relocation:back',request:backRequest,route:back,claims:[],energyFactors:[factor],delayRateMinorPerSecond:'0',delayCapMinor:'0'};
 const relocationPolicy={...lifecycle.templates[0],templateId:'relocate',trackClasses:['main'],terminals:[{stopIndex:0,activity:'departure'},{stopIndex:1,activity:'arrival'}],inspectionMode:'none',checkedBps:0,collectedBps:0,refunds:[],subsidyProgramId:null};
 const fleet={schemaVersion:1,bases:[{id:'base-a',companyId:'co',stationId:'s-a',capacity:o.baseCapacity??2},{id:'base-b',companyId:o.foreign?'other':'co',stationId:'s-b',capacity:2}],yards:[{id:'yard-a',baseId:'base-a',capacity:o.yardCapacity??2},{id:'yard-a2',baseId:'base-a',capacity:2},{id:'yard-b',baseId:'base-b',capacity:2}],anchors:[{baseId:'base-a',nodeId:o.invalidAnchor?'b':'a'},{baseId:'base-b',nodeId:'b'}],opening:roster.map(r=>({trainId:r.trainId,yardId:o.parked&&r.trainId==='t1'?'yard-a':null})),relocations:o.relocation===false?[]:[{templateId:'relocate',yardId:'yard-a'}],maxHistory:100};
 const runtime=await prepareDispatch(g,catalog,movement,{...config,templates:o.relocation===false?config.templates:[...config.templates,backTemplate]}, {...lifecycle,templates:o.relocation===false?lifecycle.templates:[...lifecycle.templates,relocationPolicy]},fleet);
 const opening={demand,revenue,energy,operations,incentives,accounting,market};
 const authority=await runtime.initialize(0,seed,opening);
 return {runtime,authority,g,catalog,movement,config,opening,lifecycle,fleet};
}
