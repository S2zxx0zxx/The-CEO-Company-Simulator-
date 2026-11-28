import { decodeGraphPack, type Coord, type GraphPack, type RailNode, type Station, type TrackEdge, type TurnRule } from '../../domain/models';
import { checkedAdd, metres, type Unit } from '../../domain/units';
import { id } from '../../domain/validation';

/** A graph is a validated immutable snapshot, not a routing or compatibility policy. */
export type ReadonlyTree<T> = T extends string | number | boolean | bigint | null | undefined ? T : T extends readonly unknown[] ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T;
export type GraphSnapshot = ReadonlyTree<GraphPack>;
export type GraphNode = ReadonlyTree<RailNode>;
export type GraphStation = ReadonlyTree<Station>;
export type GraphEdge = ReadonlyTree<TrackEdge>;
export type GraphTurn = ReadonlyTree<TurnRule>;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byId = <T extends { id: string }>(a: T, b: T) => order(a.id, b.id);
const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
function freeze<T>(value: T): ReadonlyTree<T> {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value as ReadonlyTree<T>;
}
function fail(message: string): never { throw new TypeError('Rail graph: ' + message); }
function required<T>(map: ReadonlyMap<string, T>, key: string, label: string): T {
  const value = map.get(id(key, label));
  if (value === undefined) return fail('unknown ' + label + ': ' + key);
  return value;
}
const sortedStrings = (a: string[]) => a.sort(order);
const sortedNumbers = (a: number[] | null) => a?.sort((x, y) => x - y);
function normalize(pack: GraphPack): GraphPack {
  pack.nodes.sort(byId); pack.stations.sort(byId); pack.edges.sort(byId);
  pack.turnRules.sort((a,b) => order(a.incoming,b.incoming) || order(a.outgoing,b.outgoing));
  for (const row of [...pack.nodes, ...pack.stations, ...pack.edges]) sortedStrings(row.provenance.qualityFlags);
  for (const station of pack.stations) sortedStrings(station.nodeIds);
  for (const edge of pack.edges) { sortedNumbers(edge.gaugeMm); sortedNumbers(edge.voltageV); sortedNumbers(edge.frequencyHz); }
  return pack;
}

/** Only supplied node IDs connect edges. Geometry crossings and equal coordinates do not. */
export class RailGraph {
  readonly #pack: GraphSnapshot;
  readonly #nodes = new Map<string, GraphNode>();
  readonly #stations = new Map<string, GraphStation>();
  readonly #edges = new Map<string, GraphEdge>();
  readonly #out = new Map<string, readonly GraphEdge[]>();
  readonly #in = new Map<string, readonly GraphEdge[]>();
  readonly #stationIndex = new Map<string, readonly GraphStation[]>();
  readonly #turns = new Map<string, Map<string, GraphTurn>>();
  constructor(input: unknown) {
    // R06 decoder produces an independent copy; canonical sorting never changes caller data.
    const pack = normalize(decodeGraphPack(input));
    this.#pack = freeze(pack);
    const out = new Map<string, GraphEdge[]>(), incoming = new Map<string, GraphEdge[]>(), stations = new Map<string, GraphStation[]>();
    for (const node of this.#pack.nodes) { this.#nodes.set(node.id,node); out.set(node.id,[]); incoming.set(node.id,[]); stations.set(node.id,[]); }
    for (const station of this.#pack.stations) {
      this.#stations.set(station.id,station);
      for (const nodeId of station.nodeIds) {
        required(this.#nodes,nodeId,'station node');
        stations.get(nodeId)!.push(station);
      }
    }
    for (const edge of this.#pack.edges) {
      const from = required(this.#nodes,edge.from,'edge source'), to = required(this.#nodes,edge.to,'edge target');
      const geometry = edge.geometry;
      if (!sameCoord(geometry[0],from.coordinates) || !sameCoord(geometry[geometry.length-1],to.coordinates)) fail('geometry endpoints disagree with directed nodes: '+edge.id);
      for (let i=1;i<geometry.length;i++) if (sameCoord(geometry[i-1],geometry[i])) fail('zero-length geometry segment: '+edge.id);
      this.#edges.set(edge.id,edge); out.get(edge.from)!.push(edge); incoming.get(edge.to)!.push(edge);
    }
    for (const turn of this.#pack.turnRules) {
      const a = required(this.#edges,turn.incoming,'incoming edge'), b = required(this.#edges,turn.outgoing,'outgoing edge');
      if (a.to !== b.from) fail('non-contiguous turn: '+a.id+' -> '+b.id);
      let row = this.#turns.get(a.id);
      if (!row) { row = new Map(); this.#turns.set(a.id,row); }
      if (row.has(b.id)) fail('duplicate turn pair: '+a.id+' -> '+b.id);
      row.set(b.id,turn);
    }
    for (const [key,edges] of out) this.#out.set(key,Object.freeze(edges));
    for (const [key,edges] of incoming) this.#in.set(key,Object.freeze(edges));
    for (const [key,values] of stations) this.#stationIndex.set(key,Object.freeze(values));
    Object.freeze(this);
  }
  get regionId(): string { return this.#pack.regionId; }
  /** Declared pack identity; byte/hash authentication belongs to the pack loader. */
  get graphSha256(): string { return this.#pack.graphSha256; }
  get nodeCount(): number { return this.#nodes.size; }
  get edgeCount(): number { return this.#edges.size; }
  get stationCount(): number { return this.#stations.size; }
  snapshot(): GraphSnapshot { return this.#pack; }
  node(key: string): GraphNode { return required(this.#nodes,key,'node'); }
  edge(key: string): GraphEdge { return required(this.#edges,key,'edge'); }
  station(key: string): GraphStation { return required(this.#stations,key,'station'); }
  outgoing(key: string): readonly GraphEdge[] { return required(this.#out,key,'node'); }
  incoming(key: string): readonly GraphEdge[] { return required(this.#in,key,'node'); }
  stationsAt(key: string): readonly GraphStation[] { return required(this.#stationIndex,key,'node'); }
  edgesBetween(from: string,to: string): readonly GraphEdge[] {
    this.node(to); return Object.freeze(this.outgoing(from).filter(e=>e.to===to));
  }
  /** Undefined means unspecified, never an implicit permission. R08 decides movement policy. */
  turn(incoming: string,outgoing: string): GraphTurn | undefined {
    this.edge(incoming); this.edge(outgoing); return this.#turns.get(incoming)?.get(outgoing);
  }
  /** Validate continuity and sum declared canonical lengths; no compatibility decision. */
  pathLength(edgeIds: readonly string[]): Unit<'m'> {
    if (!Array.isArray(edgeIds) || edgeIds.length===0) fail('empty path');
    let total=0, previous: GraphEdge | undefined;
    for (const key of edgeIds) {
      const edge=this.edge(key);
      if (previous && previous.to!==edge.from) fail('discontinuous path at '+edge.id);
      total=checkedAdd(total,edge.lengthM); previous=edge;
    }
    return metres(total);
  }
  /** Weak components describe structural connectivity only, including inactive/unknown edges. */
  weakComponents(): readonly (readonly string[])[] {
    const visited=new Set<string>(), components: (readonly string[])[]=[];
    for (const root of this.#nodes.keys()) {
      if (visited.has(root)) continue;
      const queue=[root]; visited.add(root);
      for(let i=0;i<queue.length;i++) {
        const n=queue[i];
        for (const e of this.outgoing(n)) if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to); }
        for (const e of this.incoming(n)) if (!visited.has(e.from)) { visited.add(e.from); queue.push(e.from); }
      }
      components.push(Object.freeze(queue.sort(order)));
    }
    return Object.freeze(components);
  }
}
