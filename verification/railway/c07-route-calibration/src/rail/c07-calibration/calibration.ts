import type { C06DiscrepancyClass } from '../c06-oracle/contracts';
import type { GroundTruthFixture } from '../c06-oracle/validator';
import { C07_PROVISIONAL_TOLERANCE_POLICY, type C07TolerancePolicy } from './contracts';

export type CalibrationDeltaCategory =
  | 'EXACT_MATCH'
  | 'MEASUREMENT_PRECISION_DELTA'
  | 'DIFFERENT_VALID_ROUTE'
  | 'GENUINE_DISTANCE_INACCURACY'
  | 'GENUINE_DURATION_INACCURACY'
  | 'UNSUPPORTED_UPSTREAM_COST_SEMANTICS';

export interface RouteCalibrationSample {
  readonly caseId: string;
  readonly objective: 'distance' | 'time';
  readonly discrepancyClass: C06DiscrepancyClass;
  readonly sameWaySequence: boolean;
  readonly alternativeCountObserved: number;
  readonly oracleDistanceM: number;
  readonly gameDistanceM: number;
  readonly distanceDeltaM: number;
  readonly distanceRelDelta: number;
  readonly oracleDurationS: number;
  readonly gameDurationS: number;
  readonly durationDeltaS: number;
  readonly durationRelDelta: number;
  readonly minTrackSpeedKmh: number | null;
  readonly trainMaxSpeedKmh: number;
  readonly effectiveMaxSpeedKmh: number | null;
  readonly gameReversalPenaltyS: number;
  readonly modeChangePenaltyS: number;
  readonly calibrationCategory: CalibrationDeltaCategory;
  readonly withinProvisionalTolerance: boolean;
  readonly notes: string;
}

export interface CalibrationSummaryReport {
  readonly schemaVersion: 1;
  readonly tolerancePolicy: C07TolerancePolicy;
  readonly validComparisonCount: number;
  readonly exactPathMatches: number;
  readonly equivalentAlternativeRoutes: number;
  readonly withinProvisionalToleranceCount: number;
  readonly distanceDiscrepancyCount: number;
  readonly durationDiscrepancyCount: number;
  readonly maxAbsDistanceDeltaM: number;
  readonly meanAbsDistanceDeltaM: number;
  readonly maxAbsDurationDeltaS: number;
  readonly meanAbsDurationDeltaS: number;
  readonly categoryCounts: Readonly<Record<CalibrationDeltaCategory, number>>;
  readonly realWorldTimetableClaimed: false;
  readonly samples: readonly RouteCalibrationSample[];
}

export function classifyCalibrationSample(input: {
  readonly caseId: string;
  readonly objective: 'distance' | 'time';
  readonly discrepancyClass: C06DiscrepancyClass;
  readonly truth: GroundTruthFixture;
  readonly gameEdgeIds: readonly string[];
  readonly gameWayIds: readonly number[];
  readonly oracleWayIds: readonly number[];
  readonly gameDistanceM: number;
  readonly oracleDistanceM: number;
  readonly gameDurationS: number;
  readonly oracleDurationS: number;
  readonly trainMaxSpeedKmh: number;
  readonly gameReversalPenaltyS: number;
  readonly modeChangePenaltyS: number;
  readonly alternativeCountObserved?: number;
  readonly tolerance?: C07TolerancePolicy;
}): RouteCalibrationSample {
  const tol = input.tolerance ?? C07_PROVISIONAL_TOLERANCE_POLICY;
  const distDelta = Math.abs(input.oracleDistanceM - input.gameDistanceM);
  const distRel = distDelta / Math.max(Math.abs(input.oracleDistanceM), Math.abs(input.gameDistanceM), 1);
  const durDelta = Math.abs(input.oracleDurationS - input.gameDurationS);
  const durRel = durDelta / Math.max(Math.abs(input.oracleDurationS), Math.abs(input.gameDurationS), 1);

  const distOk = distDelta <= tol.distanceMaxDeltaM || distRel <= tol.distanceMaxRelDelta;
  const durOk = durDelta <= tol.durationMaxDeltaS || durRel <= tol.durationMaxRelDelta;
  const sameWays =
    input.gameWayIds.length === input.oracleWayIds.length &&
    input.gameWayIds.every((w, i) => w === input.oracleWayIds[i]);

  let minTrackSpeed: number | null = null;
  for (const eid of input.gameEdgeIds) {
    const sp = input.truth.edges[eid]?.maxSpeedKmh ?? null;
    if (sp !== null && (minTrackSpeed === null || sp < minTrackSpeed)) {
      minTrackSpeed = sp;
    }
  }
  const effectiveSpeed = minTrackSpeed === null ? null : Math.min(minTrackSpeed, input.trainMaxSpeedKmh);

  let category: CalibrationDeltaCategory;
  let notes: string;
  if (input.discrepancyClass === 'STRICT_PROFILE_UNSUPPORTED' || input.discrepancyClass === 'METADATA_UNSUPPORTED') {
    category = 'UNSUPPORTED_UPSTREAM_COST_SEMANTICS';
    notes = 'Upstream OpenRailRouting omits stateful mode-change/strict cost semantics handled separately';
  } else if (!distOk) {
    category = 'GENUINE_DISTANCE_INACCURACY';
    notes = `Distance delta ${distDelta}m exceeds provisional threshold ${tol.distanceMaxDeltaM}m/${tol.distanceMaxRelDelta * 100}%`;
  } else if (!durOk) {
    category = 'GENUINE_DURATION_INACCURACY';
    notes = `Duration delta ${durDelta}s exceeds provisional threshold ${tol.durationMaxDeltaS}s/${tol.durationMaxRelDelta * 100}%`;
  } else if (!sameWays) {
    category = 'DIFFERENT_VALID_ROUTE';
    notes = 'Valid distinct edge sequence with equal/within-tolerance cost';
  } else if (distDelta === 0 && durDelta === 0) {
    category = 'EXACT_MATCH';
    notes = 'Zero delta across length, duration, and OSM way sequence';
  } else {
    category = 'MEASUREMENT_PRECISION_DELTA';
    notes = `WGS84 vs spherical geodesic / integer ceil-second rounding (${distDelta}m, ${durDelta}s)`;
  }

  return {
    caseId: input.caseId,
    objective: input.objective,
    discrepancyClass: input.discrepancyClass,
    sameWaySequence: sameWays,
    alternativeCountObserved: input.alternativeCountObserved ?? 1,
    oracleDistanceM: input.oracleDistanceM,
    gameDistanceM: input.gameDistanceM,
    distanceDeltaM: distDelta,
    distanceRelDelta: Math.round(distRel * 100000) / 100000,
    oracleDurationS: input.oracleDurationS,
    gameDurationS: input.gameDurationS,
    durationDeltaS: durDelta,
    durationRelDelta: Math.round(durRel * 100000) / 100000,
    minTrackSpeedKmh: minTrackSpeed,
    trainMaxSpeedKmh: input.trainMaxSpeedKmh,
    effectiveMaxSpeedKmh: effectiveSpeed,
    gameReversalPenaltyS: input.gameReversalPenaltyS,
    modeChangePenaltyS: input.modeChangePenaltyS,
    calibrationCategory: category,
    withinProvisionalTolerance: distOk && durOk,
    notes,
  };
}

export function summarizeCalibrationSamples(samples: readonly RouteCalibrationSample[]): CalibrationSummaryReport {
  const counts: Record<CalibrationDeltaCategory, number> = {
    EXACT_MATCH: 0,
    MEASUREMENT_PRECISION_DELTA: 0,
    DIFFERENT_VALID_ROUTE: 0,
    GENUINE_DISTANCE_INACCURACY: 0,
    GENUINE_DURATION_INACCURACY: 0,
    UNSUPPORTED_UPSTREAM_COST_SEMANTICS: 0,
  };
  let sumDist = 0;
  let maxDist = 0;
  let sumDur = 0;
  let maxDur = 0;
  let withinCount = 0;
  let sameCount = 0;
  let eqAltCount = 0;
  let distDiscCount = 0;
  let durDiscCount = 0;

  for (const s of samples) {
    counts[s.calibrationCategory]++;
    sumDist += s.distanceDeltaM;
    sumDur += s.durationDeltaS;
    if (s.distanceDeltaM > maxDist) maxDist = s.distanceDeltaM;
    if (s.durationDeltaS > maxDur) maxDur = s.durationDeltaS;
    if (s.withinProvisionalTolerance) withinCount++;
    if (s.sameWaySequence) sameCount++;
    if (s.discrepancyClass === 'EQUIVALENT_ALTERNATIVE_ROUTE') eqAltCount++;
    if (s.discrepancyClass === 'DISTANCE_DISCREPANCY') distDiscCount++;
    if (s.discrepancyClass === 'DURATION_DISCREPANCY') durDiscCount++;
  }

  const n = samples.length || 1;
  return {
    schemaVersion: 1,
    tolerancePolicy: C07_PROVISIONAL_TOLERANCE_POLICY,
    validComparisonCount: samples.length,
    exactPathMatches: sameCount,
    equivalentAlternativeRoutes: eqAltCount,
    withinProvisionalToleranceCount: withinCount,
    distanceDiscrepancyCount: distDiscCount,
    durationDiscrepancyCount: durDiscCount,
    maxAbsDistanceDeltaM: maxDist,
    meanAbsDistanceDeltaM: Math.round((sumDist / n) * 100) / 100,
    maxAbsDurationDeltaS: maxDur,
    meanAbsDurationDeltaS: Math.round((sumDur / n) * 100) / 100,
    categoryCounts: counts,
    realWorldTimetableClaimed: false,
    samples,
  };
}
