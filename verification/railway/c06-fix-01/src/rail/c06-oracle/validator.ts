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

function validateOperatingModeCompliance(
  train: TrainProfile,
  operating: OperatingMode,
  hazards: Set<SafetyHazardCode>,
  reasons: string[],
  contextLabel: string,
): void {
  if (!train.gaugesMm.includes(operating.gaugeMm)) {
    hazards.add('INCOMPATIBLE_GAUGE');
    reasons.push(`Train ${train.id} does not support operating gauge ${operating.gaugeMm}mm (${contextLabel})`);
  }

  const modeAllowed =
    train.traction === 'dual'
      ? operating.mode === 'diesel' || operating.mode === 'electric'
      : train.traction === operating.mode;

  if (!modeAllowed) {
    hazards.add(operating.mode === 'electric' || train.traction === 'electric' ? 'INVALID_ELECTRICAL_SYSTEM' : 'UNSUPPORTED_TRACTION_TRANSITION');
    reasons.push(`Train traction '${train.traction}' forbids operating mode '${operating.mode}' (${contextLabel})`);
  }

  if (operating.mode === 'electric') {
    if (train.voltagesV.length > 1 && train.frequenciesHz.length > 1) {
      hazards.add('UNKNOWN_CRITICAL_METADATA');
      reasons.push(`Ambiguous multi-voltage x multi-frequency train profile ${train.id} (${contextLabel})`);
    }
    if (
      operating.voltageV === null ||
      operating.frequencyHz === null ||
      !train.voltagesV.includes(operating.voltageV) ||
      !train.frequenciesHz.includes(operating.frequencyHz)
    ) {
      hazards.add('INVALID_ELECTRICAL_SYSTEM');
      reasons.push(
        `Electric operating (${operating.voltageV ?? 'null'}V/${operating.frequencyHz ?? 'null'}Hz) incompatible with train ${train.id} (${contextLabel})`,
      );
    }
  } else if (operating.voltageV !== null || operating.frequencyHz !== null) {
    hazards.add('INVALID_ELECTRICAL_SYSTEM');
    reasons.push(`Non-electric operating mode '${operating.mode}' cannot carry voltage/frequency (${contextLabel})`);
  }
}

function verifyOrderedStopAnchoring(
  truth: GroundTruthFixture,
  stopIds: readonly string[],
  traversedEdges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
  snappedWaypoints: ReadonlyArray<{ readonly lat: number; readonly lon: number }> | undefined,
  hazards: Set<SafetyHazardCode>,
  reasons: string[],
): void {
  if (stopIds.length < 2) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`At least 2 requested stops required, got ${stopIds.length}`);
    return;
  }
  for (const sid of stopIds) {
    if (!truth.stations[sid]) {
      hazards.add('INVALID_ENDPOINT_SNAPPING');
      reasons.push(`Unknown requested station ${sid}`);
    }
  }
  if (traversedEdges.length === 0) {
    hazards.add('DISCONTINUOUS_PATH');
    reasons.push('Empty traversed edge list');
    return;
  }

  const startStation = truth.stations[stopIds[0]];
  const startNode = traversedEdges[0].from;
  if (!startStation || !startStation.nodeIds.includes(startNode)) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`Origin node ${startNode} does not anchor to ${stopIds[0]}`);
  } else if (snappedWaypoints && snappedWaypoints[0]) {
    const nc = truth.nodes[startNode];
    const d = nc ? haversineDistanceM(snappedWaypoints[0].lat, snappedWaypoints[0].lon, nc[1], nc[0]) : Infinity;
    if (!Number.isFinite(d) || d > C06_COMPARISON_TOLERANCES.endpointSnapMaxM) {
      hazards.add('INVALID_ENDPOINT_SNAPPING');
      reasons.push(`Origin snapped waypoint ${Math.round(d)}m from traversed start node ${startNode}`);
    }
  }

  const endStation = truth.stations[stopIds[stopIds.length - 1]];
  const endNode = traversedEdges[traversedEdges.length - 1].to;
  if (!endStation || !endStation.nodeIds.includes(endNode)) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`Destination node ${endNode} does not anchor to ${stopIds[stopIds.length - 1]}`);
  } else if (snappedWaypoints && snappedWaypoints[stopIds.length - 1]) {
    const wp = snappedWaypoints[stopIds.length - 1];
    const nc = truth.nodes[endNode];
    const d = nc ? haversineDistanceM(wp.lat, wp.lon, nc[1], nc[0]) : Infinity;
    if (!Number.isFinite(d) || d > C06_COMPARISON_TOLERANCES.endpointSnapMaxM) {
      hazards.add('INVALID_ENDPOINT_SNAPPING');
      reasons.push(`Destination snapped waypoint ${Math.round(d)}m from traversed end node ${endNode}`);
    }
  }

  // Strictly match every intermediate stop in exact requested order along traversed edges
  let nextStopIdx = 1;
  for (let i = 0; i < traversedEdges.length && nextStopIdx < stopIds.length - 1; i++) {
    const targetStopId = stopIds[nextStopIdx];
    const st = truth.stations[targetStopId];
    const arrivedNode = traversedEdges[i].to;
    if (st && st.nodeIds.includes(arrivedNode)) {
      if (snappedWaypoints && snappedWaypoints[nextStopIdx]) {
        const wp = snappedWaypoints[nextStopIdx];
        const nc = truth.nodes[arrivedNode];
        const d = nc ? haversineDistanceM(wp.lat, wp.lon, nc[1], nc[0]) : Infinity;
        if (!Number.isFinite(d) || d > C06_COMPARISON_TOLERANCES.endpointSnapMaxM) {
          hazards.add('INVALID_ENDPOINT_SNAPPING');
          reasons.push(`Intermediate stop ${targetStopId} snapped waypoint ${Math.round(d)}m from traversed node ${arrivedNode}`);
        }
      }
      nextStopIdx++;
    }
  }

  if (nextStopIdx < stopIds.length - 1) {
    hazards.add('INVALID_ENDPOINT_SNAPPING');
    reasons.push(`Candidate path skipped or misordered requested stop ${stopIds[nextStopIdx]}`);
  }
}

function checkEdgeAgainstTrain(
  edge: GroundTruthEdge,
  train: TrainProfile,
  operating: OperatingMode,
  hazards: Set<SafetyHazardCode>,
  reasons: string[],
): void {
  validateOperatingModeCompliance(train, operating, hazards, reasons, `edge ${edge.id}`);
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
  } else if (!edge.gaugeMm.includes(operating.gaugeMm)) {
    hazards.add('INCOMPATIBLE_GAUGE');
    reasons.push(`Incompatible track gauge ${edge.gaugeMm.join(',')} vs operating ${operating.gaugeMm} on ${edge.id}`);
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
        if (operating.voltageV === null || !edge.voltageV.includes(operating.voltageV)) {
          hazards.add('INVALID_ELECTRICAL_SYSTEM');
          reasons.push(`Track voltage mismatch on ${edge.id}`);
        }
        if (operating.frequencyHz === null || !edge.frequencyHz.includes(operating.frequencyHz)) {
          hazards.add('INVALID_ELECTRICAL_SYSTEM');
          reasons.push(`Track frequency mismatch on ${edge.id}`);
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
    readonly initialOperating?: OperatingMode;
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

  if (params.initialOperating) {
    validateOperatingModeCompliance(params.train, params.initialOperating, hazards, reasons, 'initialOperating');
    const firstOp = params.steps[0].operating;
    if (
      firstOp.mode !== params.initialOperating.mode ||
      firstOp.gaugeMm !== params.initialOperating.gaugeMm ||
      firstOp.voltageV !== params.initialOperating.voltageV ||
      firstOp.frequencyHz !== params.initialOperating.frequencyHz
    ) {
      hazards.add('UNSUPPORTED_TRACTION_TRANSITION');
      reasons.push('First step operating mode disagrees with initialOperating');
    }
  }

  verifyOrderedStopAnchoring(truth, params.stopIds, params.steps, undefined, hazards, reasons);

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

  validateOperatingModeCompliance(params.train, params.initialOperating, hazards, reasons, 'oracle initialOperating');

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

    if (i > 0 && res.edges[i - 1].adjNode !== oe.baseNode) {
      hazards.add('DISCONTINUOUS_PATH');
      reasons.push(`Oracle GraphHopper internal node discontinuity ${res.edges[i - 1].adjNode} != ${oe.baseNode}`);
    }

    // Bind strictly to directed topology: origin station anchor on edge 0, strict node adjacency on edge i>0
    let chosen: GroundTruthEdge | undefined;
    if (i === 0) {
      const startSt = truth.stations[params.stopIds[0]];
      const startNodes = new Set(startSt?.nodeIds ?? []);
      chosen = matchingWays.find((m) => startNodes.has(m.from));
      if (!chosen) {
        hazards.add('INVALID_ENDPOINT_SNAPPING');
        reasons.push(`Oracle first edge way ${oe.osmWayId} does not anchor to origin ${params.stopIds[0]}`);
        continue;
      }
    } else if (resolvedCandidateEdges[i - 1]) {
      const prev = resolvedCandidateEdges[i - 1];
      chosen = matchingWays.find((m) => m.from === prev.to);
      if (!chosen) {
        hazards.add('DISCONTINUOUS_PATH');
        reasons.push(`Oracle discontinuity from ${prev.to} into way ${oe.osmWayId}`);
        continue;
      }
    } else {
      continue;
    }

    if (Number.isFinite(oe.distanceM) && oe.distanceM > 0) {
      const distTol = Math.max(100, 0.05 * chosen.lengthM);
      if (Math.abs(oe.distanceM - chosen.lengthM) > distTol) {
        hazards.add('DISCONTINUOUS_PATH');
        reasons.push(`Oracle edge way ${oe.osmWayId} distance ${oe.distanceM}m disagrees with truth ${chosen.lengthM}m`);
      }
    }

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

  if (resolvedCandidateEdges.length === res.edges.length) {
    verifyOrderedStopAnchoring(truth, params.stopIds, resolvedCandidateEdges, wps, hazards, reasons);
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
