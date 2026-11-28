/** Original, fictional R11 fixtures. No geographic or rolling-stock claims.
 * Expected paths and costs are declared independently of production routing. */
export type Point = [number,number];
const regionId='synthetic-r11';
const provenance={sourceUrl:'urn:railway:r11-fixture',sourceId:'synthetic-only',sourceVersion:'1',license:'original-test-fixture',qualityFlags:['SYNTHETIC_NOT_REAL_DATA']};
export const diesel={mode:'diesel',gaugeMm:1676,voltageV:null,frequencyHz:null};
export const ac={mode:'electric',gaugeMm:1676,voltageV:25000,frequencyHz:50};
export const dc={mode:'electric',gaugeMm:1676,voltageV:750,frequencyHz:0};
export const train=(extra:Record<string,unknown>={})=>({id:'fixture-train',traction:'diesel',gaugesMm:[1676],voltagesV:[],frequenciesHz:[],maxSpeedKmh:72,rangeM:10000,massKg:1000,...extra});
export const policy=(extra:Record<string,unknown>={})=>({schemaVersion:1,mode:'Realism',allowReversal:false,inferences:[],modeChanges:[],...extra});
export interface EdgeSpec {id:string;from:string;to:string;lengthM:number;speed:number;extra?:Record<string,unknown>}
export interface TurnSpec {incoming:string;outgoing:string;permitted:boolean;penaltyS:number;reversal:boolean}
export const edge=(id:string,from:string,to:string,lengthM=1000,speed=36,extra:Record<string,unknown>={}):EdgeSpec=>({id,from,to,lengthM,speed,extra});
export const turn=(incoming:string,outgoing:string,penaltyS=0,permitted=true,reversal=false):TurnSpec=>({incoming,outgoing,penaltyS,permitted,reversal});
export function pack(points:Record<string,Point>,edges:EdgeSpec[],turnRules:TurnSpec[]=[],anchors:Record<string,string[]>=Object.fromEntries(Object.keys(points).map(x=>['s-'+x,[x]]))){
  return structuredClone({schemaVersion:1,regionId,graphSha256:'1'.repeat(64),nodes:Object.entries(points).map(([id,coordinates])=>({id,coordinates,regionId,provenance})),stations:Object.entries(anchors).map(([id,nodeIds])=>({id,name:'Fictional '+id,coordinates:points[nodeIds[0]],nodeIds,regionId,provenance})),edges:edges.map(e=>({id:e.id,from:e.from,to:e.to,geometry:[points[e.from],points[e.to]],lengthM:e.lengthM,gaugeMm:[1676],electrification:'yes',voltageV:[25000],frequencyHz:[50],maxSpeedKmh:e.speed,active:true,access:'allowed',provenance,...e.extra})),turnRules});
}
export type Pack=ReturnType<typeof pack>;
export type Expected={edges:string[];metres:number;seconds:number;anchors:string[]}|{code:string};
export interface Fixture {id:string;purpose:string;pack:Pack;stops:string[];expected:Expected;profile?:ReturnType<typeof train>;policy?:ReturnType<typeof policy>;operating?:Record<string,unknown>;objective?:'distance'|'time'}
const path=(edges:string[],metres:number,seconds:number,anchors=['a','c']):Expected=>({edges,metres,seconds,anchors});
const no=(code:string):Expected=>({code});
const p:Record<string,Point>={a:[0,0],b:[1,0],c:[2,0],d:[1,1],x:[1,-1],y:[1,1],z:[1,0]};
export function diamond(){return pack(p,[edge('ab','a','b',1000,36),edge('bc','b','c',1000,36),edge('ad','a','d',1500,72),edge('dc','d','c',1500,72),edge('ab2','a','b',1000,36)],[turn('ab','bc',5),turn('ab2','bc',5),turn('ad','dc',10)]);}
const line=(extra:Record<string,unknown>={})=>pack({a:[0,0],b:[1,0],c:[2,0]},[edge('ab','a','b',1000,36,extra),edge('bc','b','c')],[turn('ab','bc',5)]);
const one=(extra:Record<string,unknown>={})=>pack({a:[0,0],b:[1,0]},[edge('ab','a','b',1000,36,extra)]);
export function fixtures():Fixture[]{
  const make=(id:string,purpose:string,graph:Pack,expected:Expected,extra:Partial<Fixture>={}):Fixture=>structuredClone({id,purpose,pack:graph,stops:['s-a','s-c'],expected,...extra});
  const single=(id:string,purpose:string,e:Record<string,unknown>,expected:Expected,extra:Partial<Fixture>={})=>make(id,purpose,one(e),expected,{stops:['s-a','s-b'],...extra});
  const good=path(['ab'],1000,100,['a','b']);
  const electricProfile=train({traction:'electric',voltagesV:[25000],frequenciesHz:[50]});
  const dcProfile=train({traction:'electric',voltagesV:[750],frequenciesHz:[0]});
  const infer=policy({mode:'Easy',inferences:[{edgeId:'ab',gaugeMm:1676,electrification:null,voltageV:null,frequencyHz:null,maxSpeedKmh:null,reason:'Fictional explicit assumption'}]});
  const crossing=pack(p,[edge('ab','a','b'),edge('bc','b','c'),edge('xy','x','y',1000,36,{geometry:[p.x,p.z,p.y]})],[turn('ab','bc')]);
  const forbidden=diamond();forbidden.turnRules=forbidden.turnRules.map(t=>t.incoming==='ab'?{...t,permitted:false}:t);
  const reverse=pack({a:[0,0],b:[1,0]},[edge('ab','a','b'),edge('ba','b','a')],[turn('ab','ba',20,true,true)]);
  const dual=pack({a:[0,0],b:[1,0],c:[2,0]},[edge('ab','a','b'),edge('bc','b','c',1000,36,{electrification:'no',voltageV:null,frequencyHz:null})],[turn('ab','bc',5)]);
  const dualProfile=train({traction:'dual',voltagesV:[25000],frequenciesHz:[50]});
  return [
    make('connected','Two edges plus 5 second turn',line(),path(['ab','bc'],2000,205)),
    make('shortest','Parallel tie broken by stable edge ID',diamond(),path(['ab','bc'],2000,205)),
    make('fastest','Longer route: 75+75+10 seconds',diamond(),path(['ad','dc'],3000,160),{objective:'time'}),
    make('parallel-prior','Forbidden first parallel track cannot prune allowed second',forbidden,path(['ab2','bc'],2000,205)),
    make('disconnected','Isolated source',diamond(),no('NO_ROUTE'),{stops:['s-x','s-c']}),
    make('reverse-direction','No implicit reverse track',line(),no('NO_ROUTE'),{stops:['s-c','s-a']}),
    make('crossing-isolated','Visual bridge/tunnel crossing without shared node',crossing,no('NO_ROUTE'),{stops:['s-x','s-c']}),
    make('crossing-along-track','Crossing does not interrupt original track',crossing,path(['xy'],1000,100,['x','y']),{stops:['s-x','s-y']}),
    make('coincident-node','Equal coordinates with separate node IDs',crossing,no('NO_ROUTE'),{stops:['s-z','s-b']}),
    make('ordered-stops','Explicit intermediate station',diamond(),path(['ad','dc'],3000,160,['a','d','c']),{stops:['s-a','s-d','s-c']}),
    make('range-exact','Cumulative range inclusive',line(),path(['ab','bc'],2000,205),{profile:train({rangeM:2000})}),
    make('range-below','Each edge fits but cumulative range fails',line(),no('INCOMPATIBLE_PROFILE'),{profile:train({rangeM:1999})}),
    make('range-pareto','Fastest feasible route under range',diamond(),path(['ab','bc'],2000,205),{objective:'time',profile:train({rangeM:2000})}),
    single('gauge-match','Multi-gauge track contains selected gauge',{gaugeMm:[1000,1676]},good),
    single('gauge-wrong','Wrong track gauge',{gaugeMm:[1435]},no('INCOMPATIBLE_PROFILE')),
    single('gauge-unknown','Strict unknown gauge',{gaugeMm:null},no('DATA_MISSING')),
    single('gauge-easy','Explicit Easy inference',{gaugeMm:null},good,{policy:infer}),
    single('gauge-easy-missing','Easy alone is not inference',{gaugeMm:null},no('DATA_MISSING'),{policy:policy({mode:'Easy'})}),
    single('ac-match','Known AC matching profile',{},good,{profile:electricProfile,operating:ac}),
    single('dc-match','Known 0 Hz DC differs from unknown',{voltageV:[750],frequencyHz:[0]},good,{profile:dcProfile,operating:dc}),
    single('dc-unknown','Unknown DC frequency is not zero',{voltageV:[750],frequencyHz:null},no('DATA_MISSING'),{profile:dcProfile,operating:dc}),
    single('voltage-wrong','Wrong voltage',{voltageV:[15000]},no('INCOMPATIBLE_PROFILE'),{profile:electricProfile,operating:ac}),
    single('frequency-wrong','Wrong known frequency',{frequencyHz:[0]},no('INCOMPATIBLE_PROFILE'),{profile:electricProfile,operating:ac}),
    single('power-ambiguous','Uncorrelated voltage-frequency lists',{voltageV:[750,25000],frequencyHz:[0,50]},no('DATA_MISSING'),{profile:electricProfile,operating:ac}),
    single('electric-no-power','Electric on unelectrified track',{electrification:'no',voltageV:null,frequencyHz:null},no('INCOMPATIBLE_PROFILE'),{profile:electricProfile,operating:ac}),
    single('diesel-no-power','Diesel does not require electrification',{electrification:'no',voltageV:null,frequencyHz:null},good),
    single('access-restricted','Restricted track',{access:'restricted'},no('INCOMPATIBLE_PROFILE')),
    single('access-unknown','Unknown access even Easy',{access:'unknown'},no('DATA_MISSING'),{policy:policy({mode:'Easy'})}),
    single('inactive','Inactive lifecycle',{active:false},no('INCOMPATIBLE_PROFILE')),
    single('speed-cap','Train speed lower than track speed',{maxSpeedKmh:72},path(['ab'],1000,100,['a','b']),{profile:train({maxSpeedKmh:36})}),
    single('speed-unknown','Unknown speed strict',{maxSpeedKmh:null},no('DATA_MISSING')),
    make('turn-unknown','No explicit through-turn',{...line(),turnRules:[]},no('DATA_MISSING')),
    make('turn-forbidden','Explicit prohibited switch',{...line(),turnRules:[turn('ab','bc',0,false)]},no('INCOMPATIBLE_PROFILE')),
    make('reversal-denied','Explicit reversal needs policy permission',reverse,no('INCOMPATIBLE_PROFILE'),{stops:['s-a','s-b','s-a']}),
    make('reversal-allowed','Two 100s edges plus 20s reversal',reverse,path(['ab','ba'],2000,220,['a','b','a']),{stops:['s-a','s-b','s-a'],policy:policy({allowReversal:true})}),
    make('dual-denied','No automatic fallback on unelectrified segment',dual,no('INCOMPATIBLE_PROFILE'),{profile:dualProfile,operating:ac}),
    make('dual-allowed','Explicit mode change at b adds 15s',dual,path(['ab','bc'],2000,220),{profile:dualProfile,operating:ac,policy:policy({modeChanges:[{nodeId:'b',penaltyS:15}]})})
  ];
}
/** Enumerated single-edge combinations; expected table independent of search. */
export function accessGaugePowerMatrix():Fixture[]{
  const results:Fixture[]=[];
  for(const [access,accessCode] of [['allowed',null],['restricted','INCOMPATIBLE_PROFILE'],['unknown','DATA_MISSING']] as const)
    for(const [gaugeMm,gaugeCode,gaugeLabel] of [[[1676],null,'match'],[[1435],'INCOMPATIBLE_PROFILE','wrong'],[null,'DATA_MISSING','unknown']] as const)
      for(const [frequencyHz,powerCode,powerLabel] of [[[50],null,'ac'],[[0],'INCOMPATIBLE_PROFILE','dc'],[null,'DATA_MISSING','unknown']] as const)
        for(const active of [true,false]){
          const code=!active?'INCOMPATIBLE_PROFILE':accessCode??gaugeCode??powerCode;
          results.push({id:`matrix-${access}-${gaugeLabel}-${powerLabel}-${active}`,purpose:'Single-edge independent decision table',pack:one({access,gaugeMm,frequencyHz,active}),stops:['s-a','s-b'],profile:train({traction:'electric',voltagesV:[25000],frequenciesHz:[50]}),operating:ac,expected:code?no(code):path(['ab'],1000,100,['a','b'])});
        }
  return results;
}
