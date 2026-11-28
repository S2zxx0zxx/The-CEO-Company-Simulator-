import { decodeTrainProfile } from '../../domain/models';
import { gaugeMm, volts, hertz, speedKmh, seconds, checkedAdd } from '../../domain/units';
import { object, id, enumeration, booleanValue, nullable, distinct, list, text, version1, refine, type Decoded } from '../../domain/validation';
import { RailGraph, type GraphEdge } from '../graph';

const mode = enumeration(['diesel','electric','steam']);
const operating = refine(object({mode,gaugeMm,voltageV:nullable(volts),frequencyHz:nullable(hertz)}),v=>v.mode==='electric'?(v.voltageV!==null&&v.frequencyHz!==null):(v.voltageV===null&&v.frequencyHz===null),'invalid operating power selection');
export type OperatingMode = Decoded<typeof operating>;
const inference = refine(object({edgeId:id,gaugeMm:nullable(gaugeMm),electrification:nullable(enumeration(['yes','no'])),voltageV:nullable(volts),frequencyHz:nullable(hertz),maxSpeedKmh:nullable(speedKmh),reason:text(240)}),v=>[v.gaugeMm,v.electrification,v.voltageV,v.frequencyHz,v.maxSpeedKmh].some(x=>x!==null),'empty inference');
const switchSite = object({nodeId:id,penaltyS:refine(seconds,n=>n>0,'positive switching time required')});
export const decodeCompatibilityPolicy = refine(object({schemaVersion:version1,mode:enumeration(['Realism','Easy']),allowReversal:booleanValue,inferences:distinct(list(inference),x=>x.edgeId),modeChanges:distinct(list(switchSite),x=>x.nodeId)}),p=>p.mode==='Easy'||p.inferences.length===0,'Realism cannot infer data');
export type CompatibilityPolicy = Decoded<typeof decodeCompatibilityPolicy>;
const traversal = object({edgeId:id,from:id,to:id,operating});
export type Traversal = Decoded<typeof traversal>;
const transition = object({incoming:traversal,outgoing:traversal});
const compare = (a:string,b:string)=>a<b?-1:a>b?1:0;
export type InferredField = 'gaugeMm'|'electrification'|'voltageV'|'frequencyHz'|'maxSpeedKmh';
export type InferenceNotice = Readonly<{edgeId:string;field:InferredField;value:number|string;reason:string}>;
export type Denial = Readonly<{ok:false;code:'DATA_MISSING'|'INCOMPATIBLE_PROFILE'|'INVALID_INPUT';reason:string}>;
export type EdgeAcceptance = Readonly<{ok:true;edgeId:string;speedLimitKmh:number;inferences:readonly InferenceNotice[]}>;
export type TurnAcceptance = Readonly<{ok:true;penaltyS:number;reversal:boolean;modeChanged:boolean;inferences:readonly InferenceNotice[];speedLimitKmh:number}>;
const deny=(code:Denial['code'],reason:string):Denial=>Object.freeze({ok:false,code,reason});
const missing=(reason:string)=>deny('DATA_MISSING',reason);
const incompatible=(reason:string)=>deny('INCOMPATIBLE_PROFILE',reason);
const bad=(reason:string)=>deny('INVALID_INPUT',reason);
const immutableNotices=(items:InferenceNotice[])=>Object.freeze(items.map(x=>Object.freeze(x)));

/** Pure policy bound to one immutable graph/profile. No graph copy, route search or state mutation. */
export class RailCompatibility {
  readonly #graph:RailGraph;
  readonly #profile:ReturnType<typeof decodeTrainProfile>;
  readonly #policy:CompatibilityPolicy;
  readonly #inferences:Map<string,CompatibilityPolicy['inferences'][number]>;
  readonly #switches:Map<string,number>;
  constructor(graph:RailGraph,profile:unknown,policy:unknown) {
    if (!(graph instanceof RailGraph)) throw new TypeError('Expected validated RailGraph');
    this.#graph=graph;this.#profile=decodeTrainProfile(profile);this.#policy=decodeCompatibilityPolicy(policy);
    this.#inferences=new Map();this.#switches=new Map();
    for(const row of this.#policy.inferences){
      const e=graph.edge(row.edgeId);
      if ((row.gaugeMm!==null&&e.gaugeMm!==null)||(row.electrification!==null&&e.electrification!=='unknown')||(row.voltageV!==null&&e.voltageV!==null)||(row.frequencyHz!==null&&e.frequencyHz!==null)||(row.maxSpeedKmh!==null&&e.maxSpeedKmh!==null)) throw new TypeError('Inference cannot override known edge data: '+e.id);
      const effective=row.electrification??e.electrification;
      if((effective!=='yes'&&(row.voltageV!==null||row.frequencyHz!==null))||(effective==='no'&&(e.voltageV!==null||e.frequencyHz!==null))) throw new TypeError('Inference requires affirmative electrification: '+e.id);
      this.#inferences.set(e.id,row);
    }
    for(const site of this.#policy.modeChanges){graph.node(site.nodeId);this.#switches.set(site.nodeId,site.penaltyS);}
    Object.freeze(this);
  }
  #profileAllows(o:OperatingMode):Denial|undefined{
    const p=this.#profile;
    if(!p.gaugesMm.some(x=>x===o.gaugeMm))return incompatible('TRAIN_GAUGE');
    if(p.traction==='dual'?(o.mode!=='diesel'&&o.mode!=='electric'):p.traction!==o.mode)return incompatible('TRAIN_TRACTION');
    if(o.mode==='electric'){
      // Independent lists cannot prove correlated pairs when both vary.
      if(p.voltagesV.length>1&&p.frequenciesHz.length>1)return missing('AMBIGUOUS_TRAIN_POWER_PAIRS');
      if(!p.voltagesV.some(x=>x===o.voltageV))return incompatible('TRAIN_VOLTAGE');
      if(!p.frequenciesHz.some(x=>x===o.frequencyHz))return incompatible('TRAIN_FREQUENCY');
    }
  }
  #edge(t:Traversal):EdgeAcceptance|Denial{
    let e:GraphEdge;
    try{e=this.#graph.edge(t.edgeId);}catch{return bad('UNKNOWN_EDGE');}
    if(e.from!==t.from||e.to!==t.to)return incompatible('DIRECTION');
    if(!e.active)return incompatible('INACTIVE_TRACK');
    if(e.lengthM>this.#profile.rangeM)return incompatible('EDGE_EXCEEDS_RANGE');
    if(e.access==='restricted')return incompatible('RESTRICTED_ACCESS');
    if(e.access==='unknown')return missing('UNKNOWN_ACCESS');
    const o=t.operating, profileFailure=this.#profileAllows(o);if(profileFailure)return profileFailure;
    const row=this.#inferences.get(e.id), notices:InferenceNotice[]=[];
    const infer=<K extends InferredField>(field:K):NonNullable<CompatibilityPolicy['inferences'][number][K]>|null=>{
      const value=row?.[field]??null;
      if(value!==null&&row)notices.push({edgeId:e.id,field,value,reason:row.reason});
      return value as NonNullable<CompatibilityPolicy['inferences'][number][K]>|null;
    };
    const inferredGauge=e.gaugeMm===null?infer('gaugeMm'):null;
    const gauges=e.gaugeMm??(inferredGauge===null?null:[inferredGauge]);
    if(gauges===null)return missing('UNKNOWN_GAUGE');
    if(!gauges.some(x=>x===o.gaugeMm))return incompatible('TRACK_GAUGE');
    if(o.mode==='electric'){
      const electrified=e.electrification==='unknown'?infer('electrification'):e.electrification;
      if(electrified===null)return missing('UNKNOWN_ELECTRIFICATION');
      if(electrified!=='yes')return incompatible('NO_ELECTRIFICATION');
      const iv=e.voltageV===null?infer('voltageV'):null, iff=e.frequencyHz===null?infer('frequencyHz'):null;
      const vs=e.voltageV??(iv===null?null:[iv]),fs=e.frequencyHz??(iff===null?null:[iff]);
      if(vs===null)return missing('UNKNOWN_VOLTAGE');
      if(fs===null)return missing('UNKNOWN_FREQUENCY');
      if(vs.length>1&&fs.length>1)return missing('AMBIGUOUS_TRACK_POWER_PAIRS');
      if(!vs.some(x=>x===o.voltageV))return incompatible('TRACK_VOLTAGE');
      if(!fs.some(x=>x===o.frequencyHz))return incompatible('TRACK_FREQUENCY');
    }
    const speed=e.maxSpeedKmh??infer('maxSpeedKmh');
    if(speed===null)return missing('UNKNOWN_SPEED');
    return Object.freeze({ok:true,edgeId:e.id,speedLimitKmh:Math.min(speed,this.#profile.maxSpeedKmh),inferences:immutableNotices(notices)});
  }
  evaluateEdge(input:unknown):EdgeAcceptance|Denial{
    let t:Traversal;try{t=traversal(input);}catch{return bad('INVALID_TRAVERSAL');}
    return this.#edge(t);
  }
  evaluateTurn(input:unknown):TurnAcceptance|Denial{
    let t:Decoded<typeof transition>;try{t=transition(input);}catch{return bad('INVALID_TRANSITION');}
    const a=this.#edge(t.incoming);if(!a.ok)return a;
    const b=this.#edge(t.outgoing);if(!b.ok)return b;
    const first=t.incoming, next=t.outgoing;
    if(first.to!==next.from)return incompatible('DISCONTINUOUS_TURN');
    const rule=this.#graph.turn(first.edgeId,next.edgeId);
    if(!rule)return missing('UNSPECIFIED_TURN');
    if(!rule.permitted)return incompatible('FORBIDDEN_TURN');
    const returns=first.from===next.to&&first.from!==first.to;
    if(returns&&!rule.reversal)return incompatible('UNDECLARED_REVERSAL');
    if(rule.reversal&&!this.#policy.allowReversal)return incompatible('REVERSAL_NOT_AUTHORIZED');
    if(first.operating.gaugeMm!==next.operating.gaugeMm)return incompatible('GAUGE_CHANGE');
    const changed=first.operating.mode!==next.operating.mode;
    let penalty=rule.penaltyS as number;
    if(changed){
      if(this.#profile.traction!=='dual')return incompatible('MODE_CHANGE_NOT_SUPPORTED');
      const switching=this.#switches.get(first.to);if(switching===undefined)return incompatible('MODE_CHANGE_NOT_AUTHORIZED');
      try{penalty=checkedAdd(penalty,switching);}catch{return bad('TURN_PENALTY_OVERFLOW');}
    }else if(first.operating.voltageV!==next.operating.voltageV||first.operating.frequencyHz!==next.operating.frequencyHz){
      // R06 has no approved electrical-system change sites; do not invent one.
      return incompatible('POWER_SYSTEM_CHANGE_NOT_SUPPORTED');
    }
    const unique=new Map<string,InferenceNotice>();for(const n of [...a.inferences,...b.inferences])unique.set(n.edgeId+'\0'+n.field,n);
    return Object.freeze({ok:true,penaltyS:penalty,reversal:rule.reversal,modeChanged:changed,speedLimitKmh:b.speedLimitKmh,inferences:immutableNotices([...unique.values()].sort((x,y)=>compare(x.edgeId,y.edgeId)||compare(x.field,y.field)))});
  }
}
