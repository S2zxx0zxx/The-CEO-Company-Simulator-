import type { CompatibilityPolicy, OperatingMode } from '../compatibility';
import type { TrainProfile } from '../../domain/models';
import { C06_COMPARISON_TOLERANCES, type OracleRawResponse } from './contracts';

export interface GroundTruthEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly osmWayId: number;
  readonly direction: 'fwd' | 'bwd';
  readonly lengthM: number;
  readonly gaugeMm: readonly number[] | null;
  readonly electrification: 'yes' | 'no' | 'unknown';
  readonly voltageV: readonly number[] | null;
  readonly frequencyHz: readonly number[] | null;
  readonly maxSpeedKmh: number | null;
  readonly active: boolean;
  readonly access: 'allowed' | 'restricted' | 'unknown';
  readonly geometry: ReadonlyArray<readonly [number, number]>;
  readonly rawTags: Readonly<Record<string, string>>;
}

export interface GroundTruthFixture {
  readonly schemaVersion: 1;
  readonly regionId: string;
  readonly graphSha256: string;
  readonly nodes: Readonly<Record<string, readonly [number, number]>>;
  readonly stations: Readonly<Record<string, { readonly name: string; readonly coordinates: readonly [number, number]; readonly nodeIds: readonly string[] }>>;
  readonly edges: Readonly<Record<string, GroundTruthEdge>>;
  readonly turnRules: Readonly<Record<string, { readonly incoming: string; readonly outgoing: string; readonly permitted: boolean; readonly penaltyS: number; readonly reversal: boolean }>>;
}

export type SafetyHazardCode =
  | 'DISCONTINUOUS_PATH'
  | 'INVALID_ENDPOINT_SNAPPING'
  | 'INCOMPATIBLE_GAUGE'
  | 'INVALID_ELECTRICAL_SYSTEM'
  | 'UNKNOWN_CRITICAL_METADATA'
  | 'RESTRICTED_TRACK_ACCESS'
  | 'INACTIVE_TRACK'
  | 'FORBIDDEN_DIRECTION'
  | 'FORBIDDEN_TURN'
  | 'UNAUTHORIZED_REVERSAL'
  | 'UNSUPPORTED_TRACTION_TRANSITION'
  | 'FABRICATED_EDGE'
  | 'RANGE_EXCEEDED';

export interface SafetyValidationResult {
  readonly valid: boolean;
  readonly hazards: readonly SafetyHazardCode[];
  readonly reasons: readonly string[];
  readonly modeChangePenaltyS?: number;
}

function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function checkEdgeAgainstTrain(
  edge: GroundTruthEdge,
  train: TrainProfile,
  operating: OperatingMode,
  hazards: Set<SafetyHazardCode>,
  reasons: string[],
): void {
  if (!edge.active) {
    hazards.add('INACTIVE_TRACK');
    reasons.push(`Inactive track ${edge.id}`);
  }
  if (edge.access === 'restricted') {
    hazards.add('RESTRICTED_TRACK_ACCESS');
    reasons.push(`Restricted access on ${edge.id}`);
  } else if (edge.access === 'unknown') {
    hazards.add('UNKNOWN_CRITICAL_METADATA');
    reasons.push(`Unknown access on ${edge.id}`);
  }
  if (edge.maxSpeedKmh === null) {
    hazards.add('UNKNOWN_CRITICAL_METADATA');
    reasons.push(`Unknown maxspeed on ${edge.id}`);
  }
  if (edge.gaugeMm === null || edge.gaugeMm.length === 0) {
    hazards.add('UNKNOWN_CRITICAL_METADATA');
    reasons.push(`Unknown gauge on ${edge.id}`);
  } else if (!edge.gaugeMm.includes(operating.gaugeMm) || !train.gaugesMm.includes(operating.gaugeMm)) {
    hazards.add('INCOMPATIBLE_GAUGE');
    reasons.push(`Incompatible gauge ${edge.gaugeMm.join(',')} vs train ${operating.gaugeMm} on ${edge.id}`);
  }

  if (operating.mode === 'electric') {
    if (edge.electrification === 'unknown') {
      hazards.add('UNKNOWN_CRITICAL_METADATA');
      reasons.push(`Unknown electrification on ${edge.id}`);
    } else if (edge.electrification !== 'yes') {
      hazards.add('INVALID_ELECTRICAL_SYSTEM');
      reasons.push(`Non-electrified track ${edge.id}`);
    } else {
      if (edge.voltageV === null || edge.frequencyHz === null) {
        hazards.add('UNKNOWN_CRITICAL_METADATA');
        reasons.push(`Missing voltage or frequency on ${edge.id}`);
      } else if (edge.voltageV.length > 1 && edge.frequencyHz.length > 1) {
        hazards.add('UNKNOWN_CRITICAL_METADATA');
        reasons.push(`Ambiguous multi-value electrical pairs on ${edge.id}`);
      } else {
        if (operating.voltageV === null || !edge.voltageV.includes(operating.voltageV) || !train.voltagesV.includes(operating.voltageV)) {
          hazards.add('INVALID_ELECTRICAL_SYSTEM');
          reasons.push(`Voltage mismatch on ${edge.id}`);
        }
        if (operating.frequencyHz === null || !edge.frequencyHz.includes(operating.frequencyHz) || !train.frequenciesHz.includes(operating.frequencyHz)) {
          hazards.add('INVALID_ELECTRICAL_SYSTEM');
          reasons.push(`Frequency mismatch on ${edge.id}`);
        }
      }
    }
  }
}

/**
 * Independent Safety Validator written directly from raw fixture truth without calling RailCompatibility.
 * Verifies Railway CEO candidate route steps independently.
 */
export function validateGameRouteIndependently(
  truth: GroundTruthFixture,
  params: {
    readonly stopIds: readonly string[];
    readonly steps: ReadonlyArray<{ readonly edgeId: string; readonly from: string; readonly to: string; readonly operating: OperatingMode }>;
    readonly train: TrainProfile;
    readonly policy: CompatibilityPolicy;
  },
): SafetyValidationResult {
  const hazards = new Set<SafetyHazardCode>();
  const reasons: string[] = [];

  if (params.policy.mode !== 'Realism' || params.policy.inferences.length > 0) {
    hazards.add('UNKNOWN_CRITICAL_METADATA');
    reasons.push('Non-Realism policy passed to strict validator');
  }

  if (params.steps.length === 0) {
    hazards.add('DISCONTINUOUS_PATH');
    reasons.push('Empty route steps');
    return { valid: false, hazards: [...hazards], reasons };
  }

  const startStation = truth.stations[params.stopIds[0]];
  const endStation = truth.stations[params.stopIds[params.stopIds.length - 1]];
  if (!startStation || !startStation.nodeIds.includes(params.steps[0].from)) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`Start node ${params.steps[0].from} does not anchor to ${params.stopIds[0]}`);
  }
  const lastStep = params.steps[params.steps.length - 1];
  if (!endStation || !endStation.nodeIds.includes(lastStep.to)) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`End node ${lastStep.to} does not anchor to ${params.stopIds[params.stopIds.length - 1]}`);
  }

  const modeSwitchNodes = new Set(params.policy.modeChanges.map((m) => m.nodeId));
  let totalDistM = 0;

  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];
    const gt = truth.edges[step.edgeId];
    if (!gt) {
      hazards.add('FABRICATED_EDGE');
      reasons.push(`Edge ${step.edgeId} absent from verified ground truth`);
      continue;
    }
    if (gt.from !== step.from || gt.to !== step.to) {
      hazards.add('FORBIDDEN_DIRECTION');
      reasons.push(`Edge ${step.edgeId} traversed opposite its directed orientation`);
    }
    totalDistM += gt.lengthM;
    checkEdgeAgainstTrain(gt, params.train, step.operating, hazards, reasons);

    if (i > 0) {
      const prev = params.steps[i - 1];
      if (prev.to !== step.from) {
        hazards.add('DISCONTINUOUS_PATH');
        reasons.push(`Discontinuity ${prev.to} != ${step.from}`);
      }
      const turn = truth.turnRules[`${prev.edgeId}->${step.edgeId}`];
      if (!turn) {
        hazards.add('FORBIDDEN_TURN');
        reasons.push(`Unspecified turn ${prev.edgeId}->${step.edgeId}`);
      } else {
        if (!turn.permitted) {
          hazards.add('FORBIDDEN_TURN');
          reasons.push(`Forbidden turn ${prev.edgeId}->${step.edgeId}`);
        }
        const isRet = prev.from === step.to && prev.from !== prev.to;
        if ((isRet && !turn.reversal) || (turn.reversal && !params.policy.allowReversal)) {
          hazards.add('UNAUTHORIZED_REVERSAL');
          reasons.push(`Unauthorized reversal at ${prev.to}`);
        }
      }
      if (prev.operating.gaugeMm !== step.operating.gaugeMm) {
        hazards.add('INCOMPATIBLE_GAUGE');
        reasons.push('Mid-route gauge change');
      }
      if (prev.operating.mode !== step.operating.mode) {
        if (params.train.traction !== 'dual' || !modeSwitchNodes.has(prev.to)) {
          hazards.add('UNSUPPORTED_TRACTION_TRANSITION');
          reasons.push(`Unauthorized mode change at ${prev.to}`);
        }
      } else if (
        prev.operating.voltageV !== step.operating.voltageV ||
        prev.operating.frequencyHz !== step.operating.frequencyHz
      ) {
        hazards.add('UNSUPPORTED_TRACTION_TRANSITION');
        reasons.push('Unsupported electrical-system transition');
      }
    }
  }

  if (totalDistM > params.train.rangeM) {
    hazards.add('RANGE_EXCEEDED');
    reasons.push(`Total distance ${totalDistM} > rangeM ${params.train.rangeM}`);
  }

  return { valid: hazards.size === 0, hazards: [...hazards], reasons };
}

/**
 * Independent Safety Validator checking OpenRailRouting candidate outputs directly against
 * raw fixture OSM way constraints, station anchor bounds, turn permissions, reversals, and transitions.
 */
export function validateOracleResponseIndependently(
  truth: GroundTruthFixture,
  params: {
    readonly stopIds: readonly string[];
    readonly oracle: OracleRawResponse;
    readonly train: TrainProfile;
    readonly policy: CompatibilityPolicy;
    readonly initialOperating: OperatingMode;
  },
): SafetyValidationResult {
  const hazards = new Set<SafetyHazardCode>();
  const reasons: string[] = [];
  const res = params.oracle;

  if (!res.ok || !res.edges || res.edges.length === 0) {
    hazards.add('DISCONTINUOUS_PATH');
    reasons.push('Oracle returned no route');
    return { valid: false, hazards: [...hazards], reasons };
  }

  // Validate waypoint snapping proximity against declared station coordinates
  const wps = res.snappedWaypoints ?? [];
  if (wps.length !== params.stopIds.length) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`Snapped waypoint count ${wps.length} !== stops ${params.stopIds.length}`);
  } else {
    for (let i = 0; i < params.stopIds.length; i++) {
      const st = truth.stations[params.stopIds[i]];
      if (!st) {
        hazards.add('INVALID_ENDPOINT_SNAPPING');
        reasons.push(`Unknown station ${params.stopIds[i]}`);
        continue;
      }
      // Station may have multiple nodeIds; distance to nearest station node must stay within snap tolerance
      const distMin = Math.min(
        ...st.nodeIds.map((nid) => {
          const c = truth.nodes[nid];
          return c ? haversineDistanceM(wps[i].lat, wps[i].lon, c[1], c[0]) : Infinity;
        }),
      );
      if (!Number.isFinite(distMin) || distMin > C06_COMPARISON_TOLERANCES.endpointSnapMaxM) {
        hazards.add('INVALID_ENDPOINT_SNAPPING');
        reasons.push(`Oracle stop ${params.stopIds[i]} snapped ${Math.round(distMin)}m away`);
      }
    }
  }

  if ((res.reversalCount ?? 0) > 0 && !params.policy.allowReversal) {
    hazards.add('UNAUTHORIZED_REVERSAL');
    reasons.push(`Oracle used ${res.reversalCount} U-turn reversals with allowReversal=false`);
  }

  const allTruthEdges = Object.values(truth.edges);
  const resolvedCandidateEdges: GroundTruthEdge[] = [];

  for (let i = 0; i < res.edges.length; i++) {
    const oe = res.edges[i];
    const matchingWays = allTruthEdges.filter((te) => te.osmWayId === oe.osmWayId);
    if (matchingWays.length === 0) {
      hazards.add('FABRICATED_EDGE');
      reasons.push(`Oracle returned unknown osmWayId=${oe.osmWayId}`);
      continue;
    }

    // Resolve directed edge by node adjacency or coordinate matching
    let chosen: GroundTruthEdge | undefined = matchingWays[0];
    if (i > 0 && resolvedCandidateEdges[i - 1]) {
      const prev = resolvedCandidateEdges[i - 1];
      const cont = matchingWays.find((m) => m.from === prev.to);
      if (!cont) {
        hazards.add('DISCONTINUOUS_PATH');
        reasons.push(`Oracle discontinuity from ${prev.to} into way ${oe.osmWayId}`);
      } else {
        chosen = cont;
      }
    } else if (truth.stations[params.stopIds[0]]) {
      const startNodes = new Set(truth.stations[params.stopIds[0]].nodeIds);
      const startMatch = matchingWays.find((m) => startNodes.has(m.from));
      if (startMatch) chosen = startMatch;
    }

    if (!chosen) continue;
    resolvedCandidateEdges.push(chosen);

    // Check raw fixture constraints on every edge returned by the oracle
    if (chosen.rawTags.oneway === 'yes' && chosen.direction !== 'fwd') {
      hazards.add('FORBIDDEN_DIRECTION');
      reasons.push(`Oracle traversed oneway way ${chosen.osmWayId} backwards`);
    }

    // For dual traction pick valid edge operating mode if compatible; otherwise inspect initialOperating
    let edgeOp: OperatingMode = params.initialOperating;
    if (params.train.traction === 'dual') {
      const canElec =
        chosen.electrification === 'yes' &&
        chosen.voltageV !== null &&
        chosen.frequencyHz !== null &&
        !(chosen.voltageV.length > 1 && chosen.frequencyHz.length > 1) &&
        !(params.train.voltagesV.length > 1 && params.train.frequenciesHz.length > 1) &&
        chosen.voltageV.some((v) => params.train.voltagesV.includes(v)) &&
        chosen.frequencyHz.some((f) => params.train.frequenciesHz.includes(f));
      if (!canElec) {
        edgeOp = { mode: 'diesel', gaugeMm: params.initialOperating.gaugeMm, voltageV: null, frequencyHz: null };
      } else {
        const vv = chosen.voltageV!.find((v) => params.train.voltagesV.includes(v))!;
        const ff = chosen.frequencyHz!.find((f) => params.train.frequenciesHz.includes(f))!;
        edgeOp = { mode: 'electric', gaugeMm: params.initialOperating.gaugeMm, voltageV: vv, frequencyHz: ff };
      }
    }
    checkEdgeAgainstTrain(chosen, params.train, edgeOp, hazards, reasons);

    if (i > 0 && resolvedCandidateEdges[i - 1]) {
      const prev = resolvedCandidateEdges[i - 1];
      const rule = truth.turnRules[`${prev.id}->${chosen.id}`];
      if (!rule || !rule.permitted) {
        hazards.add('FORBIDDEN_TURN');
        reasons.push(`Oracle used forbidden turn ${prev.id}->${chosen.id}`);
      }
      if (rule?.reversal && !params.policy.allowReversal) {
        hazards.add('UNAUTHORIZED_REVERSAL');
        reasons.push(`Oracle reversed at ${prev.to} without authorization`);
      }
    }
  }

  // Verify cumulative range constraint AND dual traction switch authorization across resolved steps
  if ((res.distanceM ?? 0) > params.train.rangeM) {
    hazards.add('RANGE_EXCEEDED');
    reasons.push(`Oracle path length ${res.distanceM} exceeds train range ${params.train.rangeM}`);
  }

  let modeChangePenaltyS = 0;
  if (params.train.traction === 'dual' && resolvedCandidateEdges.length > 0) {
    const modePenaltyMap = new Map(params.policy.modeChanges.map((m) => [m.nodeId, m.penaltyS]));
    const inferOp = (edge: GroundTruthEdge): 'electric' | 'diesel' => {
      const canElec =
        edge.electrification === 'yes' &&
        edge.voltageV !== null &&
        edge.frequencyHz !== null &&
        edge.voltageV.some((v) => params.train.voltagesV.includes(v)) &&
        edge.frequencyHz.some((f) => params.train.frequenciesHz.includes(f));
      return canElec ? 'electric' : 'diesel';
    };
    let prevM = params.initialOperating.mode;
    for (let i = 0; i < resolvedCandidateEdges.length; i++) {
      const curM = inferOp(resolvedCandidateEdges[i]);
      if (i > 0 && curM !== prevM) {
        const switchNode = resolvedCandidateEdges[i].from;
        const pen = modePenaltyMap.get(switchNode);
        if (pen === undefined) {
          hazards.add('UNSUPPORTED_TRACTION_TRANSITION');
          reasons.push(`Dual train switched ${prevM}->${curM} at non-switch node ${switchNode}`);
        } else {
          modeChangePenaltyS += pen;
        }
      }
      prevM = curM;
    }
  }

  return { valid: hazards.size === 0, hazards: [...hazards], reasons, modeChangePenaltyS };
}
