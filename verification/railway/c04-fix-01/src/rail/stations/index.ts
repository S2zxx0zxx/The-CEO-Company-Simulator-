import type { Coord } from '../../domain/models';
import { integer } from '../../domain/units';
import {
  distinct,
  enumeration,
  id,
  list,
  nullable,
  object,
  refine,
  text,
  version1,
  type Decoded,
} from '../../domain/validation';
import { RailGraph } from '../graph';
import { geodesicDistanceM } from '../geometry';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const attachmentMethod = enumeration([
  'SHARED_TRACK_NODE',
  'STATION_WAY_ANCHOR',
  'STOP_AREA_RELATION',
  'MULTI_PLATFORM_COMBINED',
  'SPATIAL_CANDIDATE_RANKED',
]);

const confidenceDecoder = refine(
  (v: unknown, p = 'confidence'): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1) {
      throw new RangeError(p + ': confidence must be in (0, 1]');
    }
    return v;
  },
  () => true,
  'invalid confidence',
);

const nonNegNumber = (v: unknown, p = 'number'): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new RangeError(p + ': expected finite non-negative number');
  }
  return v;
};

const attachedRowDecoder = object({
  stationId: id,
  sourceId: text(256),
  name: text(160),
  status: enumeration(['ATTACHED']),
  method: attachmentMethod,
  confidence: confidenceDecoder,
  attachmentDistanceM: nonNegNumber,
  candidateCount: (v, p) => integer(v, p, 1),
  nodeIds: distinct(list(id, 1, 1024), (x) => x),
  sourceIds: distinct(list(text(256), 1, 1024), (x) => x),
});

const quarantinedRowDecoder = object({
  stationId: id,
  sourceId: text(256),
  name: text(160),
  reason: text(160),
  nonRoutable: refine(
    (v: unknown, p = 'nonRoutable'): true => {
      if (v !== true) throw new TypeError(p + ': quarantined station must be nonRoutable=true');
      return true;
    },
    () => true,
    'nonRoutable required',
  ),
  candidateCount: (v, p) => integer(v, p, 0),
  nearestDistanceM: nullable(nonNegNumber),
});

export const decodeStationAttachmentReport = object({
  schemaVersion: version1,
  regionId: id,
  maxAttachmentDistanceM: nonNegNumber,
  ambiguityMarginM: nonNegNumber,
  attachedCount: (v, p) => integer(v, p, 0),
  quarantinedCount: (v, p) => integer(v, p, 0),
  duplicateMergeCount: (v, p) => integer(v, p, 0),
  attached: distinct(list(attachedRowDecoder, 0, 100000), (x) => x.stationId),
  quarantined: list(quarantinedRowDecoder, 0, 100000),
});

export type AttachedStationRecord = Decoded<typeof attachedRowDecoder>;
export type QuarantinedStationRecord = Decoded<typeof quarantinedRowDecoder>;
export type StationAttachmentReport = Decoded<typeof decodeStationAttachmentReport>;

export interface SpatialTrackCandidate {
  readonly nodeId: string;
  readonly coordinates: Coord;
  readonly componentId: string;
  readonly wayIds: readonly string[];
  readonly nameHint?: string;
}

export type StationRankDecision =
  | Readonly<{
      status: 'ATTACHED';
      nodeId: string;
      distanceM: number;
      confidence: number;
      candidateCount: number;
      method: 'SPATIAL_CANDIDATE_RANKED';
    }>
  | Readonly<{
      status: 'QUARANTINED';
      reason: 'DISCONNECTED_STATION' | 'AMBIGUOUS_CANDIDATES';
      candidateCount: number;
      nearestDistanceM: number | null;
      competingNodeIds: readonly string[];
    }>;

/**
 * Deterministic spatial candidate ranker for standalone stations located separately from track geometry.
 * Never fabricates edges; rejects ambiguous multi-component/unrelated-way candidates and distant stops.
 */
export function rankStationCandidates(
  stationCoord: Coord,
  stationName: string,
  candidates: readonly SpatialTrackCandidate[],
  options: { readonly maxDistanceM?: number; readonly ambiguityMarginM?: number } = {},
): StationRankDecision {
  const maxDistanceM = options.maxDistanceM ?? 250;
  const ambiguityMarginM = options.ambiguityMarginM ?? 25;
  const stLow = stationName.trim().toLowerCase();

  const scored = candidates
    .map((c) => {
      const distanceM = geodesicDistanceM(stationCoord, c.coordinates);
      const nameMatch = stLow && c.nameHint && c.nameHint.toLowerCase().includes(stLow) ? 0 : 1;
      return { candidate: c, distanceM, nameMatch };
    })
    .filter((s) => s.distanceM <= maxDistanceM)
    .sort((a, b) => {
      const da = Math.round(a.distanceM * 1000);
      const db = Math.round(b.distanceM * 1000);
      if (da !== db) return da - db;
      if (a.nameMatch !== b.nameMatch) return a.nameMatch - b.nameMatch;
      return cmp(a.candidate.nodeId, b.candidate.nodeId);
    });

  if (scored.length === 0) {
    return Object.freeze({
      status: 'QUARANTINED',
      reason: 'DISCONNECTED_STATION',
      candidateCount: 0,
      nearestDistanceM: null,
      competingNodeIds: Object.freeze([]),
    });
  }

  const best = scored[0];
  const nearBest = scored.filter((s) => s.distanceM <= best.distanceM + ambiguityMarginM);
  const comps = new Set(nearBest.map((s) => s.candidate.componentId));
  const bestWays = new Set(best.candidate.wayIds);
  const competingWays = nearBest
    .slice(1)
    .some(
      (s) =>
        s.nameMatch === best.nameMatch &&
        Math.abs(s.distanceM - best.distanceM) <= ambiguityMarginM &&
        !s.candidate.wayIds.some((w) => bestWays.has(w)),
    );

  if (comps.size > 1 || competingWays) {
    return Object.freeze({
      status: 'QUARANTINED',
      reason: 'AMBIGUOUS_CANDIDATES',
      candidateCount: scored.length,
      nearestDistanceM: Math.round(best.distanceM * 100) / 100,
      competingNodeIds: Object.freeze(nearBest.map((s) => s.candidate.nodeId)),
    });
  }

  const confidence = Math.round(Math.max(0.5, 1.0 - best.distanceM / (maxDistanceM * 2)) * 10000) / 10000;
  return Object.freeze({
    status: 'ATTACHED',
    nodeId: best.candidate.nodeId,
    distanceM: Math.round(best.distanceM * 100) / 100,
    confidence,
    candidateCount: scored.length,
    method: 'SPATIAL_CANDIDATE_RANKED',
  });
}

/**
 * Immutable runtime registry verifying that every routable station in RailGraph has audited
 * attachment provenance and that quarantined stations remain non-routable.
 */
export class StationAttachmentRegistry {
  readonly #report: StationAttachmentReport;
  readonly #attachedById = new Map<string, AttachedStationRecord>();

  constructor(graph: RailGraph, reportInput: unknown) {
    if (!(graph instanceof RailGraph)) {
      throw new TypeError('Expected validated RailGraph');
    }
    const report = decodeStationAttachmentReport(reportInput);
    if (report.regionId !== graph.regionId) {
      throw new TypeError(`Station attachment region mismatch: ${report.regionId} vs ${graph.regionId}`);
    }
    if (report.attachedCount !== report.attached.length || report.quarantinedCount !== report.quarantined.length) {
      throw new TypeError('Station attachment count mismatch');
    }
    for (const row of report.attached) {
      const station = graph.station(row.stationId);
      if (JSON.stringify([...station.nodeIds].sort(cmp)) !== JSON.stringify([...row.nodeIds].sort(cmp))) {
        throw new TypeError(`Station anchor mismatch for ${row.stationId}`);
      }
      this.#attachedById.set(row.stationId, Object.freeze({ ...row }));
    }
    for (const q of report.quarantined) {
      let exists = true;
      try {
        graph.station(q.stationId);
      } catch {
        exists = false;
      }
      if (exists) {
        throw new TypeError(`Quarantined station leaked into routable RailGraph: ${q.stationId}`);
      }
    }
    if (this.#attachedById.size !== graph.stationCount) {
      throw new TypeError('Not all RailGraph stations have attachment provenance');
    }
    this.#report = Object.freeze(report);
    Object.freeze(this);
  }

  get regionId(): string {
    return this.#report.regionId;
  }

  get attachedCount(): number {
    return this.#attachedById.size;
  }

  get quarantinedCount(): number {
    return this.#report.quarantinedCount;
  }

  attachmentOf(stationId: string): AttachedStationRecord {
    const rec = this.#attachedById.get(stationId);
    if (!rec) throw new TypeError('Unknown attached station: ' + stationId);
    return rec;
  }

  quarantinedStations(): readonly QuarantinedStationRecord[] {
    return Object.freeze(this.#report.quarantined.map((q) => Object.freeze({ ...q })));
  }
}
