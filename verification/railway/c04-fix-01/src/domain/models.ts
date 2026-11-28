// Original railway domain contracts; adapted from private V4/V5 planning interfaces.
import { basisPoints, energyQuantity, gaugeMm, hertz, integer, kilograms, metres, minor, seats, seconds, speedKmh, volts, MAX_DECIMAL } from './units';
import { booleanValue, coord, distinct, enumeration, id, list, nullable, object, refine, sha256, sourceUrl, text, utc, version1, registered, type Decoder, type Decoded, type Registry } from './validation';
const count: Decoder<number> = integer;
const positiveCount = refine(count, n => n > 0, 'must be positive');
const positiveMetres = refine(metres, n => n > 0, 'must be positive');
const positiveSeconds = refine(seconds, n => n > 0, 'must be positive');
const positiveKg = refine(kilograms, n => n > 0, 'must be positive');
const ids = distinct(list(id), v => v);
const nonemptyIds = refine(ids, v => v.length > 0, 'required IDs');
const gauges = distinct(list(gaugeMm, 1, 32), v => v);
const voltages = distinct(list(volts, 0, 32), v => v);
const frequencies = distinct(list(hertz, 0, 32), v => v);
const traction = enumeration(['diesel','electric','steam','dual']);
const currency = enumeration(['INR']);
export const decodeProvenance = object({sourceUrl, sourceId:text(256), sourceVersion:text(128), license:text(128), qualityFlags:distinct(list(text(128),0,128),v=>v)});
export const decodeStation = object({id,name:text(160),coordinates:coord,regionId:id,nodeIds:nonemptyIds,provenance:decodeProvenance});
export const decodeRailNode = object({id,coordinates:coord,regionId:id,provenance:decodeProvenance});
export const decodeTrackEdge = refine(object({id,from:id,to:id,geometry:list(coord,2),lengthM:positiveMetres,gaugeMm:nullable(gauges),electrification:enumeration(['yes','no','unknown']),voltageV:nullable(refine(voltages,v=>v.length>0,'empty voltage list')),frequencyHz:nullable(refine(frequencies,v=>v.length>0,'empty frequency list')),maxSpeedKmh:nullable(speedKmh),active:booleanValue,access:enumeration(['allowed','restricted','unknown']),provenance:decodeProvenance}),e=>e.electrification!=='no'||(e.voltageV===null&&e.frequencyHz===null),'non-electrified edge has electrical data');
export const decodeTurnRule = object({incoming:id,outgoing:id,permitted:booleanValue,penaltyS:seconds,reversal:booleanValue});
export const decodeTrainModel = refine(object({id,traction,gaugesMm:gauges,voltagesV:voltages,frequenciesHz:frequencies,maxSpeedKmh:speedKmh,rangeM:positiveMetres,capacitySeats:seats,cargoCapacityKg:kilograms,purchasePriceMinor:minor,massKg:positiveKg,provenance:decodeProvenance}),m=>(m.traction==='electric'||m.traction==='dual')?(m.voltagesV.length>0&&m.frequenciesHz.length>0):(m.voltagesV.length===0&&m.frequenciesHz.length===0),'traction and electrical profile disagree');
export const decodeTrainProfile = refine(object({id,traction,gaugesMm:gauges,voltagesV:voltages,frequenciesHz:frequencies,maxSpeedKmh:speedKmh,rangeM:positiveMetres,massKg:positiveKg}),m=>(m.traction==='electric'||m.traction==='dual')?(m.voltagesV.length>0&&m.frequenciesHz.length>0):(m.voltagesV.length===0&&m.frequenciesHz.length===0),'traction and electrical profile disagree');
export const decodeRegionManifest = object({id,schemaVersion:version1,sourceUrl,snapshotUtc:utc,sourceSha256:sha256,graphSha256:sha256,tilesSha256:sha256,license:text(128),attribution:text(512),stationCount:positiveCount,edgeCount:positiveCount,qualityReportSha256:sha256});
export const decodeGraphPack = refine(object({schemaVersion:version1,regionId:id,graphSha256:sha256,nodes:distinct(list(decodeRailNode,1,1000000),v=>v.id),stations:distinct(list(decodeStation,1,1000000),v=>v.id),edges:distinct(list(decodeTrackEdge,1,1000000),v=>v.id),turnRules:list(decodeTurnRule,0,1000000)}),g=>g.nodes.every(n=>n.regionId===g.regionId)&&g.stations.every(s=>s.regionId===g.regionId),'region mismatch');
// Connectivity, gauge compatibility, edge geometry and route sums belong to R07–R10.
export const decodeRoute = object({id,stopIds:list(id,2),edgeIds:list(id,1),distanceM:positiveMetres,expectedDurationS:positiveSeconds,graphSha256:sha256,trainProfileSha256:sha256});
export const decodeRouteError = enumeration(['NO_ROUTE','DATA_MISSING','INCOMPATIBLE_PROFILE','INVALID_INPUT','STALE_GRAPH']);
export const decodeDemandBucket = refine(object({id,origin:id,destination:id,intervalStartS:seconds,intervalEndS:seconds,available:count,reserved:count,served:count,total:count}),d=>d.origin!==d.destination&&d.intervalEndS>d.intervalStartS&&BigInt(d.available)+BigInt(d.reserved)+BigInt(d.served)===BigInt(d.total),'invalid OD interval or demand conservation');
export const decodeEnergyAmount = object({unit:enumeration(['Wh','mL','g']),quantity:energyQuantity});
export function addEnergy(a: EnergyAmount,b: EnergyAmount): EnergyAmount {
  a=decodeEnergyAmount(a);b=decodeEnergyAmount(b);
  if(a.unit!==b.unit) throw new TypeError('Cannot mix energy units');
  return decodeEnergyAmount({unit:a.unit,quantity:String(BigInt(a.quantity)+BigInt(b.quantity))});
}
export const decodeTripQuote = object({id,trainId:id,route:decodeRoute,policySha256:sha256,stateVersion:count,expiresAtSimS:seconds,expectedRevenueMinor:minor,expectedCostMinor:minor,reserveMinor:minor,energy:distinct(list(decodeEnergyAmount,0,3),v=>v.unit),demandBucketIds:ids});
export const decodeJournalPosting = refine(object({accountId:id,debitMinor:minor,creditMinor:minor,currency}),p=>(p.debitMinor==='0')!==(p.creditMinor==='0'),'exactly one nonzero debit or credit required');
export const decodeJournalEntry = refine(object({eventId:id,commandId:id,simTimeS:seconds,postings:list(decodeJournalPosting,2),payloadSha256:sha256}),e=>{const dr=e.postings.reduce((n,p)=>n+BigInt(p.debitMinor),0n),cr=e.postings.reduce((n,p)=>n+BigInt(p.creditMinor),0n);return dr===cr&&dr<=MAX_DECIMAL;},'unbalanced or overflowing journal entry');
export const decodeTrainState = enumeration(['IDLE','ASSIGNED','RESERVED','RUNNING','DWELL','ARRIVED','SETTLED','SERVICE','PARKED','OUT_OF_SERVICE','BLOCKED']);
// V5 supplemental entity shapes are schema v1 foundations, not balance or state-transition policy.
export const decodeCompany = object({id,name:text(160),difficulty:enumeration(['Easy','Realism']),baseIds:ids});
export const decodeBase = object({id,companyId:id,stationId:id,capacity:positiveCount});
export const decodeYard = object({id,baseId:id,capacity:positiveCount});
export const decodeOwnedTrain = object({id,companyId:id,modelId:id,state:decodeTrainState,conditionBps:basisPoints,baseId:nullable(id),routeId:nullable(id)});
export const decodeConsist = object({id,trainId:id,capacitySeats:seats,cargoCapacityKg:kilograms,massKg:positiveKg});
export const decodeRouteDraft = object({id,trainId:id,stopIds:list(id,2),graphSha256:sha256});
export const decodeTrip = object({id,trainId:id,quoteId:id,route:decodeRoute,state:enumeration(['RESERVED','RUNNING','DWELL','ARRIVED','SETTLED','CANCELLED','BLOCKED']),departureSimS:seconds});
export const decodePassengerAllocation = object({id,tripId:id,demandBucketId:id,passengers:positiveCount});
export const decodeFreightConsignment = refine(object({id,origin:id,destination:id,massKg:positiveKg}),c=>c.origin!==c.destination,'same freight origin and destination');
export const decodeTrackSlot = refine(object({id,edgeId:id,tripId:id,startS:seconds,endS:seconds}),s=>s.endS>s.startS,'invalid slot interval');
export const decodeEnergyLot = refine(object({id,energy:decodeEnergyAmount,reservedQuantity:energyQuantity,costMinor:minor}),l=>BigInt(l.reservedQuantity)<=BigInt(l.energy.quantity),'energy over-reservation');
export const decodeEnergyContract = refine(object({id,unit:enumeration(['Wh','mL','g']),quantity:energyQuantity,remainingQuantity:energyQuantity,totalPriceMinor:minor}),c=>BigInt(c.quantity)>0n&&BigInt(c.remainingQuantity)<=BigInt(c.quantity),'invalid contract quantity');
export const decodeStaff = object({id,companyId:id,roleId:id,wageMinor:minor});
export const decodeServiceJob = refine(object({id,trainId:id,startS:seconds,endS:seconds,costMinor:minor}),j=>j.endS>j.startS,'invalid service interval');
export const decodeLoan = refine(object({id,principalMinor:minor,remainingMinor:minor,openedS:seconds,maturityS:seconds,interestBps:basisPoints}),l=>BigInt(l.principalMinor)>0n&&BigInt(l.remainingMinor)<=BigInt(l.principalMinor)&&l.maturityS>l.openedS,'invalid loan');
export const decodeSubsidyProgram = refine(object({id,budgetMinor:minor,remainingMinor:minor,startS:seconds,endS:seconds}),p=>BigInt(p.remainingMinor)<=BigInt(p.budgetMinor)&&p.endS>p.startS,'invalid subsidy budget or interval');
export const decodeCampaign = refine(object({id,budgetMinor:minor,startS:seconds,endS:seconds}),c=>c.endS>c.startS,'invalid campaign interval');
export const decodeMission = refine(object({id,target:positiveCount,progress:count}),m=>m.progress<=m.target,'mission progress exceeds target');
export const decodeClaimReceipt = object({id,missionId:id,commandId:id,simTimeS:seconds});
export const decodeShareLedger = refine(object({companyId:id,issued:count,holdings:distinct(list(object({ownerId:id,shares:positiveCount})),v=>v.ownerId)}),s=>s.holdings.reduce((n,h)=>n+BigInt(h.shares),0n)===BigInt(s.issued),'share conservation failure');
const rawPayload: Decoder<unknown> = value => value; // only used inside registry-validated envelopes
const eventBase = object({id,simTimeS:seconds,sequence:count,kind:id,payload:rawPayload,schemaVersion:version1});
const commandBase = object({id,type:id,expectedStateVersion:count,payload:rawPayload});
export function eventDecoder(registry: Registry): Decoder<SimEvent> {
  return (value,path='event')=>{const e=eventBase(value,path);return {...e,payload:registered(registry,e.kind,e.payload,path+'.payload')};};
}
export function commandDecoder(registry: Registry): Decoder<Command> {
  return (value,path='command')=>{const c=commandBase(value,path);return {...c,payload:registered(registry,c.type,c.payload,path+'.payload')};};
}
export function saveEnvelopeDecoder<S>(state: Decoder<S>,events: Registry,rng: Registry): Decoder<SaveEnvelope<S>> {
  const base=object({schemaVersion:version1,simTimeS:seconds,rngAlgorithm:id,rngState:text(256),policySha256:sha256,graphSha256s:distinct(list(sha256),v=>v),sequence:count,state,pendingEvents:distinct(list(eventDecoder(events)),v=>v.id),checksum:sha256});
  return (value,path='save')=>{const s=base(value,path);registered(rng,s.rngAlgorithm,s.rngState,path+'.rngState');if(new Set(s.pendingEvents.map(e=>e.sequence)).size!==s.pendingEvents.length||s.pendingEvents.some(e=>e.simTimeS<s.simTimeS))throw new TypeError(path+': invalid pending event sequence/time');return s;};
}
export type Id = Decoded<typeof id>;
export type Sha256 = Decoded<typeof sha256>;
export type Coord = Decoded<typeof coord>;
export type Traction = Decoded<typeof traction>;
export type Provenance = Decoded<typeof decodeProvenance>;
export type Station = Decoded<typeof decodeStation>;
export type RailNode = Decoded<typeof decodeRailNode>;
export type TrackEdge = Decoded<typeof decodeTrackEdge>;
export type TurnRule = Decoded<typeof decodeTurnRule>;
export type TrainModel = Decoded<typeof decodeTrainModel>;
export type LocomotiveModel = TrainModel;
export type TrainProfile = Decoded<typeof decodeTrainProfile>;
export type RegionManifest = Decoded<typeof decodeRegionManifest>;
export type GraphPack = Decoded<typeof decodeGraphPack>;
export type Route = Decoded<typeof decodeRoute>;
export type RouteError = Decoded<typeof decodeRouteError>;
export type DemandBucket = Decoded<typeof decodeDemandBucket>;
export type EnergyAmount = Decoded<typeof decodeEnergyAmount>;
export type TripQuote = Decoded<typeof decodeTripQuote>;
export type JournalPosting = Decoded<typeof decodeJournalPosting>;
export type JournalEntry = Decoded<typeof decodeJournalEntry>;
export type TrainState = Decoded<typeof decodeTrainState>;
export type Company = Decoded<typeof decodeCompany>;
export type Base = Decoded<typeof decodeBase>;
export type Yard = Decoded<typeof decodeYard>;
export type OwnedTrain = Decoded<typeof decodeOwnedTrain>;
export type Consist = Decoded<typeof decodeConsist>;
export type RouteDraft = Decoded<typeof decodeRouteDraft>;
export type Trip = Decoded<typeof decodeTrip>;
export type PassengerAllocation = Decoded<typeof decodePassengerAllocation>;
export type FreightConsignment = Decoded<typeof decodeFreightConsignment>;
export type TrackSlot = Decoded<typeof decodeTrackSlot>;
export type EnergyLot = Decoded<typeof decodeEnergyLot>;
export type EnergyContract = Decoded<typeof decodeEnergyContract>;
export type Staff = Decoded<typeof decodeStaff>;
export type ServiceJob = Decoded<typeof decodeServiceJob>;
export type Loan = Decoded<typeof decodeLoan>;
export type SubsidyProgram = Decoded<typeof decodeSubsidyProgram>;
export type Campaign = Decoded<typeof decodeCampaign>;
export type Mission = Decoded<typeof decodeMission>;
export type ClaimReceipt = Decoded<typeof decodeClaimReceipt>;
export type ShareLedger = Decoded<typeof decodeShareLedger>;
export type SimEvent = Decoded<typeof eventBase>;
export type Command = Decoded<typeof commandBase>;
export interface SaveEnvelope<S=unknown> {schemaVersion:1;simTimeS:Decoded<typeof seconds>;rngAlgorithm:string;rngState:string;policySha256:string;graphSha256s:string[];sequence:number;state:S;pendingEvents:SimEvent[];checksum:string}
