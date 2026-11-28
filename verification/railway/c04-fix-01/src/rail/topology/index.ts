import {
  decodeGraphPack,
  type GraphPack,
  type RailNode,
  type Station,
  type TrackEdge,
  type TurnRule,
} from '../../domain/models';
import { RailGraph } from '../graph';
import { RailCompatibility, type OperatingMode, type Traversal } from '../compatibility';

export interface TopologyCounts {
  readonly nodes: number;
  readonly edges: number;
  readonly stations: number;
  readonly turnRules: number;
  readonly weakComponentCount: number;
  readonly stronglyConnectedComponentCount: number;
  readonly deadEndNodeCount: number;
  readonly isolatedNodeCount: number;
  readonly junctionNodeCount: number;
  readonly selfLoopEdgeCount: number;
  readonly parallelCorridorCount: number;
  readonly modeChangeCandidateCount: number;
}

export interface CompatibilityCoverageSummary {
  readonly gaugeKnownEdges: number;
  readonly gaugeUnknownEdges: number;
  readonly electrifiedYesEdges: number;
  readonly electrifiedNoEdges: number;
  readonly electrifiedUnknownEdges: number;
  readonly speedKnownEdges: number;
  readonly speedUnknownEdges: number;
  readonly accessAllowedEdges: number;
  readonly accessRestrictedEdges: number;
  readonly accessUnknownEdges: number;
  readonly activeEdges: number;
  readonly inactiveEdges: number;
}

export interface TopologyAnalysis {
  readonly regionId: string;
  readonly graphSha256: string;
  readonly counts: TopologyCounts;
  readonly compatibilityCoverage: CompatibilityCoverageSummary;
  readonly weakComponents: readonly (readonly string[])[];
  readonly stronglyConnectedComponents: readonly (readonly string[])[];
  readonly deadEndNodeIds: readonly string[];
  readonly isolatedNodeIds: readonly string[];
  readonly junctionNodeIds: readonly string[];
  readonly selfLoopEdgeIds: readonly string[];
  readonly modeChangeCandidateNodeIds: readonly string[];
  readonly parallelCorridors: readonly Readonly<{ from: string; to: string; edgeIds: readonly string[] }>[];
}

export interface CompatibilityAuditSummary {
  readonly acceptedEdges: number;
  readonly deniedEdges: number;
  readonly dataMissingEdges: number;
  readonly incompatibleEdges: number;
  readonly invalidInputEdges: number;
  readonly acceptedTurns: number;
  readonly deniedTurns: number;
  readonly edgeFailureReasons: Readonly<Record<string, number>>;
  readonly turnFailureReasons: Readonly<Record<string, number>>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const numCmp = (a: number, b: number) => a - b;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(cmp);
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function sortProvenance(p: RailNode['provenance']): RailNode['provenance'] {
  return {
    sourceUrl: p.sourceUrl,
    sourceId: p.sourceId,
    sourceVersion: p.sourceVersion,
    license: p.license,
    qualityFlags: [...p.qualityFlags].sort(cmp),
  };
}

/** Return an exact normalized copy of a validated GraphPack matching RailGraph ASCII sorting. */
export function canonicalizeGraphPack(input: unknown): GraphPack {
  const pack = decodeGraphPack(input);
  const nodes: RailNode[] = pack.nodes
    .map((n) => ({
      id: n.id,
      coordinates: [n.coordinates[0], n.coordinates[1]] as [number, number],
      regionId: n.regionId,
      provenance: sortProvenance(n.provenance),
    }))
    .sort((a, b) => cmp(a.id, b.id));

  const stations: Station[] = pack.stations
    .map((s) => ({
      id: s.id,
      name: s.name,
      coordinates: [s.coordinates[0], s.coordinates[1]] as [number, number],
      regionId: s.regionId,
      nodeIds: [...s.nodeIds].sort(cmp),
      provenance: sortProvenance(s.provenance),
    }))
    .sort((a, b) => cmp(a.id, b.id));

  const edges: TrackEdge[] = pack.edges
    .map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      geometry: e.geometry.map((pt) => [pt[0], pt[1]] as [number, number]),
      lengthM: e.lengthM,
      gaugeMm: e.gaugeMm ? [...e.gaugeMm].sort(numCmp) : null,
      electrification: e.electrification,
      voltageV: e.voltageV ? [...e.voltageV].sort(numCmp) : null,
      frequencyHz: e.frequencyHz ? [...e.frequencyHz].sort(numCmp) : null,
      maxSpeedKmh: e.maxSpeedKmh,
      active: e.active,
      access: e.access,
      provenance: sortProvenance(e.provenance),
    }))
    .sort((a, b) => cmp(a.id, b.id));

  const turnRules: TurnRule[] = pack.turnRules
    .map((t) => ({
      incoming: t.incoming,
      outgoing: t.outgoing,
      permitted: t.permitted,
      penaltyS: t.penaltyS,
      reversal: t.reversal,
    }))
    .sort((a, b) => cmp(a.incoming, b.incoming) || cmp(a.outgoing, b.outgoing));

  return {
    schemaVersion: pack.schemaVersion,
    regionId: pack.regionId,
    graphSha256: pack.graphSha256,
    nodes,
    stations,
    edges,
    turnRules,
  };
}

/** Compute canonical SHA-256 over normalized GraphPack body (excluding graphSha256 field). */
export async function computeCanonicalGraphSha256(input: unknown): Promise<string> {
  const canonical = canonicalizeGraphPack(input);
  const body = {
    schemaVersion: canonical.schemaVersion,
    regionId: canonical.regionId,
    nodes: canonical.nodes,
    stations: canonical.stations,
    edges: canonical.edges,
    turnRules: canonical.turnRules,
  };
  const bytes = new TextEncoder().encode(canonicalJson(body));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Verify that GraphPack.graphSha256 equals the computed SHA-256 of canonical pack bytes. */
export async function verifyGraphPackSha256(input: unknown): Promise<{
  readonly valid: boolean;
  readonly declaredSha256: string;
  readonly computedSha256: string;
}> {
  const pack = canonicalizeGraphPack(input);
  const computedSha256 = await computeCanonicalGraphSha256(pack);
  return Object.freeze({
    valid: pack.graphSha256 === computedSha256,
    declaredSha256: pack.graphSha256,
    computedSha256,
  });
}

/** Canonical deterministic JSON serialization of a validated RailGraph. */
export function serializeGraphPack(graph: RailGraph): string {
  if (!(graph instanceof RailGraph)) {
    throw new TypeError('Expected validated RailGraph');
  }
  return canonicalJson(graph.snapshot());
}

/** Deserialize JSON string into a validated RailGraph, verifying canonical hash by default. */
export async function deserializeGraphPack(jsonText: string, verifyHash = true): Promise<RailGraph> {
  const parsed: unknown = JSON.parse(jsonText);
  if (verifyHash) {
    const check = await verifyGraphPackSha256(parsed);
    if (!check.valid) {
      throw new TypeError(
        `GraphPack SHA-256 verification failed: declared=${check.declaredSha256} computed=${check.computedSha256}`,
      );
    }
  }
  return new RailGraph(parsed);
}

/** Iterative Tarjan SCC computation for large directed railway graphs without stack overflow. */
function tarjanSccIterative(nodeIds: readonly string[], graph: RailGraph): readonly (readonly string[])[] {
  let indexCounter = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const sccStack: string[] = [];
  const sccs: (readonly string[])[] = [];

  for (const start of nodeIds) {
    if (indices.has(start)) continue;
    const callStack: { node: string; idx: number; outs: readonly GraphEdge[] }[] = [
      { node: start, idx: 0, outs: graph.outgoing(start) },
    ];
    indices.set(start, indexCounter);
    lowlink.set(start, indexCounter);
    indexCounter++;
    sccStack.push(start);
    onStack.add(start);

    while (callStack.length > 0) {
      const top = callStack[callStack.length - 1];
      if (top.idx < top.outs.length) {
        const w = top.outs[top.idx].to;
        top.idx++;
        if (!indices.has(w)) {
          indices.set(w, indexCounter);
          lowlink.set(w, indexCounter);
          indexCounter++;
          sccStack.push(w);
          onStack.add(w);
          callStack.push({ node: w, idx: 0, outs: graph.outgoing(w) });
        } else if (onStack.has(w)) {
          const curLow = lowlink.get(top.node)!;
          const wIdx = indices.get(w)!;
          if (wIdx < curLow) lowlink.set(top.node, wIdx);
        }
      } else {
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1].node;
          const childLow = lowlink.get(top.node)!;
          if (childLow < lowlink.get(parent)!) {
            lowlink.set(parent, childLow);
          }
        }
        if (lowlink.get(top.node) === indices.get(top.node)) {
          const comp: string[] = [];
          while (true) {
            const w = sccStack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === top.node) break;
          }
          comp.sort(cmp);
          sccs.push(Object.freeze(comp));
        }
      }
    }
  }

  sccs.sort((a, b) => b.length - a.length || cmp(a[0], b[0]));
  return Object.freeze(sccs);
}

/** Inspect structural topology, disconnected components, parallel corridors, and tag coverage. */
export function analyzeTopology(graph: RailGraph): TopologyAnalysis {
  if (!(graph instanceof RailGraph)) {
    throw new TypeError('Expected validated RailGraph');
  }
  const snap = graph.snapshot();
  const nodeIds = snap.nodes.map((n) => n.id);
  const weak = [...graph.weakComponents()]
    .map((c) => Object.freeze([...c].sort(cmp)))
    .sort((a, b) => b.length - a.length || cmp(a[0], b[0]));
  const sccs = tarjanSccIterative(nodeIds, graph);

  const deadEndNodeIds: string[] = [];
  const isolatedNodeIds: string[] = [];
  const junctionNodeIds: string[] = [];
  const modeChangeCandidateNodeIds: string[] = [];

  for (const nid of nodeIds) {
    const out = graph.outgoing(nid);
    const inc = graph.incoming(nid);
    const neighbors = new Set<string>();
    const elStates = new Set<string>();
    for (const e of out) {
      neighbors.add(e.to);
      elStates.add(e.electrification);
    }
    for (const e of inc) {
      neighbors.add(e.from);
      elStates.add(e.electrification);
    }
    if (out.length === 0 && inc.length === 0) isolatedNodeIds.push(nid);
    if (neighbors.size === 1) deadEndNodeIds.push(nid);
    if (neighbors.size >= 3) junctionNodeIds.push(nid);
    if (elStates.has('yes') && elStates.has('no')) modeChangeCandidateNodeIds.push(nid);
  }

  const selfLoopEdgeIds: string[] = [];
  const pairGroups = new Map<string, string[]>();
  let gaugeKnownEdges = 0;
  let gaugeUnknownEdges = 0;
  let electrifiedYesEdges = 0;
  let electrifiedNoEdges = 0;
  let electrifiedUnknownEdges = 0;
  let speedKnownEdges = 0;
  let speedUnknownEdges = 0;
  let accessAllowedEdges = 0;
  let accessRestrictedEdges = 0;
  let accessUnknownEdges = 0;
  let activeEdges = 0;
  let inactiveEdges = 0;

  for (const e of snap.edges) {
    if (e.from === e.to) selfLoopEdgeIds.push(e.id);
    const k = e.from + '\0' + e.to;
    const arr = pairGroups.get(k);
    if (arr) arr.push(e.id);
    else pairGroups.set(k, [e.id]);

    if (e.gaugeMm !== null) gaugeKnownEdges++;
    else gaugeUnknownEdges++;
    if (e.electrification === 'yes') electrifiedYesEdges++;
    else if (e.electrification === 'no') electrifiedNoEdges++;
    else electrifiedUnknownEdges++;
    if (e.maxSpeedKmh !== null) speedKnownEdges++;
    else speedUnknownEdges++;
    if (e.access === 'allowed') accessAllowedEdges++;
    else if (e.access === 'restricted') accessRestrictedEdges++;
    else accessUnknownEdges++;
    if (e.active) activeEdges++;
    else inactiveEdges++;
  }

  const parallelCorridors = [...pairGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([k, ids]) => {
      const [from, to] = k.split('\0');
      return Object.freeze({ from, to, edgeIds: Object.freeze([...ids].sort(cmp)) });
    })
    .sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));

  return Object.freeze({
    regionId: graph.regionId,
    graphSha256: graph.graphSha256,
    counts: Object.freeze({
      nodes: graph.nodeCount,
      edges: graph.edgeCount,
      stations: graph.stationCount,
      turnRules: snap.turnRules.length,
      weakComponentCount: weak.length,
      stronglyConnectedComponentCount: sccs.length,
      deadEndNodeCount: deadEndNodeIds.length,
      isolatedNodeCount: isolatedNodeIds.length,
      junctionNodeCount: junctionNodeIds.length,
      selfLoopEdgeCount: selfLoopEdgeIds.length,
      parallelCorridorCount: parallelCorridors.length,
      modeChangeCandidateCount: modeChangeCandidateNodeIds.length,
    }),
    compatibilityCoverage: Object.freeze({
      gaugeKnownEdges,
      gaugeUnknownEdges,
      electrifiedYesEdges,
      electrifiedNoEdges,
      electrifiedUnknownEdges,
      speedKnownEdges,
      speedUnknownEdges,
      accessAllowedEdges,
      accessRestrictedEdges,
      accessUnknownEdges,
      activeEdges,
      inactiveEdges,
    }),
    weakComponents: Object.freeze(weak),
    stronglyConnectedComponents: sccs,
    deadEndNodeIds: Object.freeze(deadEndNodeIds),
    isolatedNodeIds: Object.freeze(isolatedNodeIds),
    junctionNodeIds: Object.freeze(junctionNodeIds),
    selfLoopEdgeIds: Object.freeze(selfLoopEdgeIds),
    modeChangeCandidateNodeIds: Object.freeze(modeChangeCandidateNodeIds),
    parallelCorridors: Object.freeze(parallelCorridors),
  });
}

/** Audit all graph edges & declared turn rules through the single authoritative RailCompatibility engine. */
export function auditCompatibility(
  graph: RailGraph,
  profile: unknown,
  policy: unknown,
  operating: OperatingMode,
): CompatibilityAuditSummary {
  const compat = new RailCompatibility(graph, profile, policy);
  const snap = graph.snapshot();
  let acceptedEdges = 0;
  let deniedEdges = 0;
  let dataMissingEdges = 0;
  let incompatibleEdges = 0;
  let invalidInputEdges = 0;
  const edgeFailureReasons: Record<string, number> = {};

  for (const e of snap.edges) {
    const res = compat.evaluateEdge({ edgeId: e.id, from: e.from, to: e.to, operating });
    if (res.ok) {
      acceptedEdges++;
    } else {
      deniedEdges++;
      if (res.code === 'DATA_MISSING') dataMissingEdges++;
      else if (res.code === 'INCOMPATIBLE_PROFILE') incompatibleEdges++;
      else invalidInputEdges++;
      edgeFailureReasons[res.reason] = (edgeFailureReasons[res.reason] ?? 0) + 1;
    }
  }

  let acceptedTurns = 0;
  let deniedTurns = 0;
  const turnFailureReasons: Record<string, number> = {};
  for (const t of snap.turnRules) {
    const eIn = graph.edge(t.incoming);
    const eOut = graph.edge(t.outgoing);
    const incoming: Traversal = { edgeId: eIn.id, from: eIn.from, to: eIn.to, operating };
    const outgoing: Traversal = { edgeId: eOut.id, from: eOut.from, to: eOut.to, operating };
    const res = compat.evaluateTurn({ incoming, outgoing });
    if (res.ok) {
      acceptedTurns++;
    } else {
      deniedTurns++;
      turnFailureReasons[res.reason] = (turnFailureReasons[res.reason] ?? 0) + 1;
    }
  }

  return Object.freeze({
    acceptedEdges,
    deniedEdges,
    dataMissingEdges,
    incompatibleEdges,
    invalidInputEdges,
    acceptedTurns,
    deniedTurns,
    edgeFailureReasons: Object.freeze(edgeFailureReasons),
    turnFailureReasons: Object.freeze(turnFailureReasons),
  });
}
