import { createHash } from 'node:crypto';
import type { TrainProfile } from '../../domain/models';
import type { CompatibilityPolicy, OperatingMode } from '../compatibility';
import { RailGraph } from '../graph';
import { canonicalPolicy, canonicalProfile, policyHash, profileHash } from '../routing';
import {
  C06_COMPARISON_TOLERANCES,
  type C06DiscrepancyClass,
} from '../c06-oracle/contracts';
import type { GroundTruthFixture } from '../c06-oracle/validator';

export type C07Category =
  | 'A_POSITIVE_ROUTE'
  | 'B_NEGATIVE_COMPATIBILITY'
  | 'C_TOPOLOGY_AND_OPERATIONS'
  | 'D_IDENTITY_AND_INFRASTRUCTURE';

export type C07OracleCapability =
  | 'STRICT_SINGLE_GRAPH'
  | 'STRICT_REVERSAL'
  | 'STRICT_DUAL_SWITCH_ADAPTER'
  | 'ALTERNATIVES'
  | 'VALIDATOR_NEGATIVE_PROBE'
  | 'INFRASTRUCTURE_PROBE';

export interface C07TolerancePolicy {
  readonly policyId: 'C07-PROVISIONAL-TOLERANCE-V1';
  readonly provisional: true;
  readonly approvedProductionToleranceLocked: false;
  readonly rationale: string;
  readonly distanceMaxDeltaM: number;
  readonly distanceMaxRelDelta: number;
  readonly durationMaxDeltaS: number;
  readonly durationMaxRelDelta: number;
  readonly endpointSnapMaxM: number;
  readonly runtimeRoutingP95TargetMs: number;
}

export const C07_PROVISIONAL_TOLERANCE_POLICY: C07TolerancePolicy = Object.freeze({
  policyId: 'C07-PROVISIONAL-TOLERANCE-V1',
  provisional: true,
  approvedProductionToleranceLocked: false,
  rationale: C06_COMPARISON_TOLERANCES.rationale,
  distanceMaxDeltaM: C06_COMPARISON_TOLERANCES.distanceMaxDeltaM,
  distanceMaxRelDelta: C06_COMPARISON_TOLERANCES.distanceMaxRelDelta,
  durationMaxDeltaS: C06_COMPARISON_TOLERANCES.durationMaxDeltaS,
  durationMaxRelDelta: C06_COMPARISON_TOLERANCES.durationMaxRelDelta,
  endpointSnapMaxM: C06_COMPARISON_TOLERANCES.endpointSnapMaxM,
  runtimeRoutingP95TargetMs: C06_COMPARISON_TOLERANCES.runtimeRoutingP95TargetMs,
});

export interface C07ValidatorTamperSpec {
  readonly target: 'game' | 'oracle';
  readonly mode: 'skipped_stop' | 'misordered_stop' | 'detached_waypoint' | 'wrong_traction_step' | 'fabricated_edge';
}

export interface C07InfrastructureProbeSpec {
  readonly actualGraphSha256Override?: string;
  readonly actualProfileSha256Override?: string;
  readonly actualPolicySha256Override?: string;
  readonly maxLabelsOverride?: number;
  readonly maxWorkOverride?: number;
  readonly forceOracleTimeoutMs?: number;
  readonly forceOracleMissingCache?: boolean;
  readonly forceMalformedOracleIpc?: boolean;
  readonly forceCorrelationMismatch?: boolean;
}

export interface C07ScenarioSpec {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly caseId: string;
  readonly semanticRequestId: string;
  readonly category: C07Category;
  readonly subcategory: string;
  readonly fixtureId: string;
  readonly dataProvenance: 'SYNTHETIC_C06' | 'SYNTHETIC_C07';
  readonly sourceUrl: string;
  readonly sourceVersion: string;
  readonly license: string;
  readonly syntheticOnly: true;
  readonly dataClass: 'SYNTHETIC';
  readonly graphSha256: string;
  readonly sourceFixtureSha256: string;
  readonly regionVersion: string;
  readonly oracleCacheId: string;
  readonly oracleCacheSha256: string;
  readonly originStationId: string;
  readonly destinationStationId: string;
  readonly intermediateStopIds: readonly string[];
  readonly stopIds: readonly string[];
  readonly stationAnchorNodeIds: Readonly<Record<string, readonly string[]>>;
  readonly trainProfileId: string;
  readonly profileSha256: string;
  readonly policyId: string;
  readonly policySha256: string;
  readonly initialOperating: OperatingMode;
  readonly objective: 'distance' | 'time';
  readonly allowReversal: boolean;
  readonly expectedValid: boolean;
  readonly expectedOutcome: 'VALID_ROUTE' | 'REJECTED_ROUTE' | 'CALIBRATION_DISCREPANCY' | 'VALIDATOR_REJECTED' | 'INFRASTRUCTURE_OR_UNSUPPORTED';
  readonly expectedDiscrepancyClass: C06DiscrepancyClass;
  readonly expectedGameCodePrefix: string;
  readonly expectedOracleStatusPrefix: string;
  readonly expectedIncompatibilityReason: string | null;
  readonly expectedConstraints: {
    readonly rationale: string;
    readonly expectedWayIds?: readonly number[];
    readonly alternativeCount?: number;
    readonly constraintCodes: readonly string[];
  };
  readonly requiredOracleCapability: C07OracleCapability;
  readonly tolerancePolicy: C07TolerancePolicy;
  readonly validatorTamper?: C07ValidatorTamperSpec;
  readonly probeSpec?: C07InfrastructureProbeSpec;
}

export interface C07DatasetV2 {
  readonly schemaVersion: 2;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly syntheticOnly: true;
  readonly realDataUsed: false;
  readonly c01ComplianceCleared: false;
  readonly minimumRequiredRealCasesForC07: number;
  readonly realRouteComparisonsCompleted: 0;
  readonly adapterJarSha256: string;
  readonly tolerancePolicy: C07TolerancePolicy;
  readonly profiles: Readonly<Record<string, TrainProfile>>;
  readonly policies: Readonly<Record<string, CompatibilityPolicy>>;
  readonly cases: readonly C07ScenarioSpec[];
}

export interface C07RealDataReadinessRecord {
  readonly caseId: string;
  readonly approvedSourceDataset: string;
  readonly sourceSnapshotDate: string;
  readonly datasetChecksumSha256: string;
  readonly territorialAllowlist: readonly string[];
  readonly sourceRights: string;
  readonly stationIdentityEvidence: string;
  readonly trackConnectivityEvidence: string;
  readonly trainCompatibilityEvidence: string;
  readonly expectedOutcomeJustification: string;
  readonly reviewerApproval: {
    readonly approved: boolean;
    readonly reviewerId: string | null;
    readonly approvedUtc: string | null;
  };
  readonly actualGraphVersion: string;
  readonly oracleResult: string | null;
  readonly runtimeResult: string | null;
  readonly discrepancyDisposition: string | null;
}

export interface C07RealDataDatasetV1 {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly c01ComplianceCleared: boolean;
  readonly minimumRequiredRealCases: number;
  readonly realRouteComparisonsCompleted: number;
  readonly releaseAllowed: boolean;
  readonly coveragePlanSummary: {
    readonly targetPositiveRoutes: number;
    readonly targetNegativeCompatibilityRoutes: number;
    readonly targetTopologyAndTurnRoutes: number;
    readonly targetMultiStopAndAlternativeRoutes: number;
  };
  readonly cases: readonly C07RealDataReadinessRecord[];
}

export function sha256HexString(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function computeSemanticRequestIdentity(input: {
  readonly fixtureId: string;
  readonly graphSha256: string;
  readonly stopIds: readonly string[];
  readonly objective: 'distance' | 'time';
  readonly allowReversal: boolean;
  readonly trainProfileId: string;
  readonly profileSha256: string;
  readonly policyId: string;
  readonly policySha256: string;
  readonly initialOperating: OperatingMode;
  readonly requiredOracleCapability: C07OracleCapability;
  readonly alternativeCount?: number;
  readonly validatorTamper?: C07ValidatorTamperSpec;
  readonly probeSpec?: C07InfrastructureProbeSpec;
}): string {
  const canonicalPayload = JSON.stringify({
    fixtureId: input.fixtureId,
    graphSha256: input.graphSha256,
    stopIds: input.stopIds,
    objective: input.objective,
    allowReversal: input.allowReversal,
    trainProfileId: input.trainProfileId,
    profileSha256: input.profileSha256,
    policyId: input.policyId,
    policySha256: input.policySha256,
    initialOperating: input.initialOperating,
    requiredOracleCapability: input.requiredOracleCapability,
    alternativeCount: input.alternativeCount ?? null,
    validatorTamper: input.validatorTamper ?? null,
    probeSpec: input.probeSpec ?? null,
  });
  return sha256HexString(canonicalPayload);
}

export interface C07DatasetValidationContext {
  readonly graphsByFixtureId: ReadonlyMap<string, RailGraph>;
  readonly groundTruthByFixtureId: ReadonlyMap<string, GroundTruthFixture>;
  readonly cacheIdentityShaByCacheId: ReadonlyMap<string, string>;
}

const GENUINE_CLASSES: ReadonlySet<C06DiscrepancyClass> = new Set([
  'MATCH_VALID_ROUTE',
  'MATCH_NO_VALID_ROUTE',
  'EQUIVALENT_ALTERNATIVE_ROUTE',
  'DISTANCE_DISCREPANCY',
  'DURATION_DISCREPANCY',
  'ENDPOINT_MAPPING_DISCREPANCY',
  'GAME_FALSE_ACCEPT',
  'GAME_FALSE_REJECT',
  'ORACLE_FALSE_ACCEPT',
  'ORACLE_FALSE_REJECT',
]);

const INFRA_AND_UNSUPPORTED_CLASSES: ReadonlySet<C06DiscrepancyClass> = new Set([
  'STALE_IDENTITY',
  'INVALID_INPUT',
  'SEARCH_EXHAUSTION',
  'METADATA_UNSUPPORTED',
  'STRICT_PROFILE_UNSUPPORTED',
  'ORACLE_EXECUTION_ERROR',
  'INDETERMINATE',
]);

export function isGenuineRouteComparisonClass(cls: C06DiscrepancyClass): boolean {
  return GENUINE_CLASSES.has(cls);
}

export function isInfrastructureOrUnsupportedClass(cls: C06DiscrepancyClass): boolean {
  return INFRA_AND_UNSUPPORTED_CLASSES.has(cls);
}

export async function validateC07CalibrationDataset(
  raw: unknown,
  context?: C07DatasetValidationContext,
): Promise<{
  readonly dataset: C07DatasetV2;
  readonly validationMs: number;
  readonly totalCases: number;
  readonly genuineRouteCases: number;
  readonly infrastructureAndUnsupportedCases: number;
}> {
  const t0 = performance.now();
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('C07 calibration dataset must be a non-null object');
  }
  const ds = raw as C07DatasetV2;
  if (ds.schemaVersion !== 2 || typeof ds.datasetId !== 'string' || !ds.datasetId.trim() || typeof ds.datasetVersion !== 'string' || !ds.datasetVersion.trim()) {
    throw new TypeError('C07 calibration dataset requires schemaVersion=2, datasetId, and datasetVersion');
  }
  if (ds.realDataUsed !== false || ds.syntheticOnly !== true) {
    throw new Error('Synthetic C07 preparation refuses realDataUsed=true or syntheticOnly=false while C01 compliance is pending');
  }
  if (ds.c01ComplianceCleared !== false || ds.realRouteComparisonsCompleted !== 0) {
    throw new Error('Synthetic C07 dataset must retain c01ComplianceCleared=false and realRouteComparisonsCompleted=0');
  }
  if (!Array.isArray(ds.cases) || ds.cases.length === 0) {
    throw new TypeError('C07 calibration dataset must contain at least one scenario');
  }
  if (!ds.profiles || typeof ds.profiles !== 'object' || !ds.policies || typeof ds.policies !== 'object') {
    throw new TypeError('C07 calibration dataset must include profiles and policies registries');
  }

  // Canonicalize & verify profile/policy hashes once
  const computedProfileHashes = new Map<string, string>();
  for (const [pid, prof] of Object.entries(ds.profiles)) {
    const can = canonicalProfile(prof);
    if (can.id !== pid) {
      throw new Error(`Profile registry key ${pid} mismatches profile.id ${can.id}`);
    }
    computedProfileHashes.set(pid, await profileHash(can));
  }
  const computedPolicyHashes = new Map<string, string>();
  for (const [polId, pol] of Object.entries(ds.policies)) {
    const can = canonicalPolicy(pol);
    computedPolicyHashes.set(polId, await policyHash(can));
  }

  const seenCaseIds = new Set<string>();
  const seenSemanticIds = new Set<string>();
  let genuineCount = 0;
  let infraCount = 0;

  for (const c of ds.cases) {
    if (!c.caseId || seenCaseIds.has(c.caseId)) {
      throw new Error(`Duplicate or missing caseId: ${String(c?.caseId)}`);
    }
    seenCaseIds.add(c.caseId);

    if (c.datasetId !== ds.datasetId || c.datasetVersion !== ds.datasetVersion) {
      throw new Error(`Case ${c.caseId} dataset identity mismatch`);
    }
    if (!c.fixtureId || !c.sourceFixtureSha256 || !c.graphSha256 || !c.oracleCacheId || !c.oracleCacheSha256 || !c.regionVersion) {
      throw new Error(`Case ${c.caseId} missing required fixture/graph/cache provenance metadata`);
    }
    if (c.syntheticOnly !== true || c.dataClass !== 'SYNTHETIC' || (c.dataProvenance !== 'SYNTHETIC_C06' && c.dataProvenance !== 'SYNTHETIC_C07')) {
      throw new Error(`Case ${c.caseId} has invalid synthetic provenance classification`);
    }
    if (!c.expectedConstraints || !c.expectedConstraints.rationale || !Array.isArray(c.expectedConstraints.constraintCodes) || c.expectedConstraints.constraintCodes.length === 0) {
      throw new Error(`Case ${c.caseId} missing independent constraint rationale`);
    }

    const expectedProfHash = computedProfileHashes.get(c.trainProfileId);
    if (!expectedProfHash || expectedProfHash !== c.profileSha256) {
      throw new Error(`Case ${c.caseId} profileSha256 mismatch or unknown profile ${c.trainProfileId}`);
    }
    const expectedPolHash = computedPolicyHashes.get(c.policyId);
    if (!expectedPolHash || expectedPolHash !== c.policySha256) {
      throw new Error(`Case ${c.caseId} policySha256 mismatch or unknown policy ${c.policyId}`);
    }

    const polObj = ds.policies[c.policyId];
    if (c.allowReversal !== polObj.allowReversal) {
      throw new Error(`Contradictory allowReversal vs policy ${c.policyId} in case ${c.caseId}`);
    }

    // Stop contract integrity (allow 1-stop invalid_input probe only when explicitly D_IDENTITY_AND_INFRASTRUCTURE + INVALID_INPUT)
    const isOneStopProbe = c.category === 'D_IDENTITY_AND_INFRASTRUCTURE' && c.expectedDiscrepancyClass === 'INVALID_INPUT' && c.stopIds.length < 2;
    if (!isOneStopProbe) {
      if (!Array.isArray(c.stopIds) || c.stopIds.length < 2) {
        throw new Error(`Case ${c.caseId} stopIds must contain at least origin and destination`);
      }
      if (c.stopIds[0] !== c.originStationId || c.stopIds[c.stopIds.length - 1] !== c.destinationStationId) {
        throw new Error(`Case ${c.caseId} stopIds endpoints disagree with originStationId/destinationStationId`);
      }
      const expectedMid = c.stopIds.slice(1, -1);
      if (JSON.stringify(expectedMid) !== JSON.stringify(c.intermediateStopIds)) {
        throw new Error(`Case ${c.caseId} intermediateStopIds disagrees with stopIds slice`);
      }
    }

    // Reject contradictory expected outcomes
    if (c.expectedValid) {
      if (c.expectedOutcome !== 'VALID_ROUTE') {
        throw new Error(`Contradictory expectedValid=true with expectedOutcome=${c.expectedOutcome} in ${c.caseId}`);
      }
      if (c.expectedDiscrepancyClass !== 'MATCH_VALID_ROUTE' && c.expectedDiscrepancyClass !== 'EQUIVALENT_ALTERNATIVE_ROUTE') {
        throw new Error(`Contradictory expectedValid=true with class ${c.expectedDiscrepancyClass} in ${c.caseId}`);
      }
      if (c.expectedIncompatibilityReason !== null) {
        throw new Error(`Contradictory expectedValid=true with non-null incompatibility reason in ${c.caseId}`);
      }
    } else if (c.expectedOutcome === 'CALIBRATION_DISCREPANCY') {
      const allowedCal = new Set<C06DiscrepancyClass>([
        'ORACLE_FALSE_REJECT',
        'GAME_FALSE_REJECT',
        'DISTANCE_DISCREPANCY',
        'DURATION_DISCREPANCY',
        'ENDPOINT_MAPPING_DISCREPANCY',
      ]);
      if (!allowedCal.has(c.expectedDiscrepancyClass)) {
        throw new Error(`Invalid calibration discrepancy class ${c.expectedDiscrepancyClass} in ${c.caseId}`);
      }
      if (!c.expectedIncompatibilityReason) {
        throw new Error(`Calibration discrepancy case ${c.caseId} must document expectedIncompatibilityReason`);
      }
    } else {
      if (c.expectedDiscrepancyClass === 'MATCH_VALID_ROUTE' || c.expectedDiscrepancyClass === 'EQUIVALENT_ALTERNATIVE_ROUTE') {
        throw new Error(`Contradictory expectedValid=false with positive discrepancy class in ${c.caseId}`);
      }
      if (!c.expectedIncompatibilityReason) {
        throw new Error(`Negative/infra case ${c.caseId} must document expectedIncompatibilityReason`);
      }
    }

    if (c.category === 'D_IDENTITY_AND_INFRASTRUCTURE') {
      if (!isInfrastructureOrUnsupportedClass(c.expectedDiscrepancyClass)) {
        throw new Error(`Infrastructure case ${c.caseId} cannot claim genuine route class ${c.expectedDiscrepancyClass}`);
      }
      infraCount++;
    } else {
      if (!isGenuineRouteComparisonClass(c.expectedDiscrepancyClass)) {
        throw new Error(`Route comparison case ${c.caseId} has non-route class ${c.expectedDiscrepancyClass}`);
      }
      genuineCount++;
    }

    const expectedSemantic = computeSemanticRequestIdentity({
      fixtureId: c.fixtureId,
      graphSha256: c.graphSha256,
      stopIds: c.stopIds,
      objective: c.objective,
      allowReversal: c.allowReversal,
      trainProfileId: c.trainProfileId,
      profileSha256: c.profileSha256,
      policyId: c.policyId,
      policySha256: c.policySha256,
      initialOperating: c.initialOperating,
      requiredOracleCapability: c.requiredOracleCapability,
      alternativeCount: c.expectedConstraints.alternativeCount,
      validatorTamper: c.validatorTamper,
      probeSpec: c.probeSpec,
    });
    if (c.semanticRequestId !== expectedSemantic) {
      throw new Error(`Case ${c.caseId} semanticRequestId mismatch`);
    }
    if (seenSemanticIds.has(c.semanticRequestId)) {
      throw new Error(`Duplicate semanticRequestId detected in ${c.caseId}: ${c.semanticRequestId}`);
    }
    seenSemanticIds.add(c.semanticRequestId);

    if (context) {
      const g = context.graphsByFixtureId.get(c.fixtureId);
      const truth = context.groundTruthByFixtureId.get(c.fixtureId);
      const cacheSha = context.cacheIdentityShaByCacheId.get(c.oracleCacheId);
      if (!g || !truth) {
        throw new Error(`Unknown fixtureId ${c.fixtureId} referenced by ${c.caseId}`);
      }
      if (g.graphSha256 !== c.graphSha256 || truth.graphSha256 !== c.graphSha256) {
        throw new Error(`Fixture ${c.fixtureId} graphSha256 mismatch for ${c.caseId}`);
      }
      if (!cacheSha || cacheSha !== c.oracleCacheSha256) {
        throw new Error(`Cache identity mismatch for ${c.oracleCacheId} in ${c.caseId}`);
      }
      const isUnknownStationProbe = c.expectedConstraints.constraintCodes.includes('UNKNOWN_STATION_ANCHOR');
      if (!isUnknownStationProbe) {
        for (const sid of c.stopIds) {
          const st = truth.stations[sid];
          if (!st) {
            throw new Error(`Unknown station ${sid} in ${c.caseId}`);
          }
          if (JSON.stringify(c.stationAnchorNodeIds[sid] ?? null) !== JSON.stringify(st.nodeIds)) {
            throw new Error(`Station anchor nodeIds mismatch for ${sid} in ${c.caseId}`);
          }
        }
      }
    }
  }

  return {
    dataset: ds,
    validationMs: Math.round((performance.now() - t0) * 100) / 100,
    totalCases: ds.cases.length,
    genuineRouteCases: genuineCount,
    infrastructureAndUnsupportedCases: infraCount,
  };
}

/**
 * Explicitly rejects legacy placeholder C06 template datasets containing duplicate semantic requests
 * or contradictory outcomes.
 */
export function validateLegacyC06TemplateRejection(rawLegacy: unknown): { rejected: true; reason: string } {
  if (!rawLegacy || typeof rawLegacy !== 'object') {
    return { rejected: true, reason: 'NON_OBJECT_DATASET' };
  }
  const cases = (rawLegacy as { cases?: Array<{ caseId?: string; stopIds?: string[]; trainProfileId?: string; objective?: string; allowReversal?: boolean }> }).cases ?? [];
  const seen = new Set<string>();
  for (const c of cases) {
    const key = JSON.stringify([c.stopIds, c.trainProfileId, c.objective, c.allowReversal]);
    if (seen.has(key)) {
      return {
        rejected: true,
        reason: `DUPLICATE_SEMANTIC_REQUEST: ${String(c.caseId)} reuses identical (stopIds, trainProfileId, objective, allowReversal)=${key}`,
      };
    }
    seen.add(key);
  }
  throw new Error('Legacy template unexpectedly contained no duplicate semantic requests');
}

export function validateRealDataIntakeDataset(raw: unknown): C07RealDataDatasetV1 {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('Real-data intake dataset must be an object');
  }
  const rd = raw as C07RealDataDatasetV1;
  if (rd.schemaVersion !== 1 || typeof rd.datasetId !== 'string' || !rd.datasetId.trim()) {
    throw new TypeError('Real-data intake dataset requires schemaVersion=1 and non-empty datasetId');
  }
  if (!rd.c01ComplianceCleared) {
    if (rd.cases.length > 0 || rd.realRouteComparisonsCompleted !== 0 || rd.releaseAllowed !== false) {
      throw new Error('UNAPPROVED_REAL_DATA_INTAKE: cannot populate real route cases before C01 compliance clearance');
    }
  } else {
    if (rd.cases.length < rd.minimumRequiredRealCases) {
      throw new Error(`Real R17 acceptance requires >= ${rd.minimumRequiredRealCases} curated routes`);
    }
    for (const r of rd.cases) {
      if (!r.approvedSourceDataset || !r.datasetChecksumSha256 || !r.sourceRights || !r.reviewerApproval?.approved) {
        throw new Error(`Real route ${r.caseId} missing source rights, checksum, or reviewer approval`);
      }
      if (!Array.isArray(r.territorialAllowlist) || r.territorialAllowlist.length === 0) {
        throw new Error(`Real route ${r.caseId} missing territorialAllowlist`);
      }
    }
  }
  return rd;
}
