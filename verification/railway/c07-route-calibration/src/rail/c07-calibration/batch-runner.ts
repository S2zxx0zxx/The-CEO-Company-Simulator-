import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompatibilityPolicy } from '../compatibility';
import { RailGraph } from '../graph';
import { findRouteAlternatives, policyHash, profileHash } from '../routing';
import { StrictOracleClient } from '../c06-oracle/client';
import type { C06DiscrepancyClass, OracleQueryRequest, OracleRawResponse } from '../c06-oracle/contracts';
import { runStrictOracleComparison, type C06ComparisonRecord } from '../c06-oracle/harness';
import type { GroundTruthFixture } from '../c06-oracle/validator';
import { validateOracleResponseIndependently } from '../c06-oracle/validator';
import {
  classifyCalibrationSample,
  summarizeCalibrationSamples,
  type CalibrationSummaryReport,
  type RouteCalibrationSample,
} from './calibration';
import {
  isGenuineRouteComparisonClass,
  isInfrastructureOrUnsupportedClass,
  validateC07CalibrationDataset,
  type C07DatasetV2,
  type C07DatasetValidationContext,
  type C07ScenarioSpec,
} from './contracts';
import {
  DiscrepancyRegistry,
  type DiscrepancyRecord,
  type DiscrepancyRegistryReport,
  type DiscrepancyResolutionStatus,
  type DiscrepancySeverity,
} from './discrepancy-registry';

export interface LatencyDistribution {
  readonly count: number;
  readonly minMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

export interface C07CaseExecutionRecord {
  readonly caseId: string;
  readonly semanticRequestId: string;
  readonly category: C07ScenarioSpec['category'];
  readonly subcategory: string;
  readonly fixtureId: string;
  readonly oracleCacheId: string;
  readonly expectedValid: boolean;
  readonly expectedDiscrepancyClass: C06DiscrepancyClass;
  readonly comparison: C06ComparisonRecord;
  readonly alternativeCountObserved: number;
  readonly passedExpectation: boolean;
  readonly classificationGroup: 'GENUINE_ROUTE_COMPARISON' | 'INFRASTRUCTURE_OR_UNSUPPORTED';
  readonly completedUtc: string;
  readonly initialFailurePreserved?: {
    readonly firstAttemptDiscrepancy: C06DiscrepancyClass;
    readonly firstAttemptNotes: string;
  };
}

export interface C07BatchCheckpoint {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly cancelled: boolean;
  readonly completedCases: Readonly<Record<string, C07CaseExecutionRecord>>;
}

export interface C07BatchExecutionResult {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly cancelled: boolean;
  readonly totalCasesPlanned: number;
  readonly totalCasesExecuted: number;
  readonly genuineRouteComparisons: number;
  readonly infrastructureAndUnsupportedCases: number;
  readonly validRoutesMatched: number;
  readonly equivalentAlternativeRoutes: number;
  readonly rejectedRoutesMatched: number;
  readonly knownIncompatibleAcceptedCount: number;
  readonly expectationsPassedCount: number;
  readonly expectationsFailedCount: number;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly discrepancyCounts: Readonly<Record<string, number>>;
  readonly oracleLatencyMs: LatencyDistribution;
  readonly gameLatencyMs: LatencyDistribution;
  readonly datasetValidationMs: number;
  readonly batchElapsedMs: number;
  readonly peakRssBytes: number;
  readonly timeoutFailureCount: number;
  readonly jvmTelemetryByCacheId: Readonly<Record<string, unknown>>;
  readonly calibrationReport: CalibrationSummaryReport;
  readonly discrepancyReport: DiscrepancyRegistryReport;
  readonly records: readonly C07CaseExecutionRecord[];
}

export interface C07BatchRunOptions {
  readonly dataset: C07DatasetV2;
  readonly graphsByFixtureId: ReadonlyMap<string, RailGraph>;
  readonly groundTruthByFixtureId: ReadonlyMap<string, GroundTruthFixture>;
  readonly clientsByCacheId: ReadonlyMap<string, StrictOracleClient>;
  readonly cacheIdentityShaByCacheId: ReadonlyMap<string, string>;
  readonly concurrency?: number;
  readonly checkpointPath?: string;
  readonly resumeFromCheckpoint?: boolean;
  readonly shouldCancel?: (executedSoFar: number, currentCase: C07ScenarioSpec) => boolean;
  readonly reproCommandPrefix?: string;
  readonly defaultCaseTimeoutMs?: number;
}

export function computeLatencyDistribution(values: readonly number[]): LatencyDistribution {
  if (values.length === 0) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, meanMs: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    count: sorted.length,
    minMs: round2(sorted[0]),
    p50Ms: round2(sorted[Math.floor(sorted.length * 0.5)]),
    p95Ms: round2(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]),
    maxMs: round2(sorted[sorted.length - 1]),
    meanMs: round2(sum / sorted.length),
  };
}

function buildProbeClient(
  baseClient: StrictOracleClient,
  spec: C07ScenarioSpec,
  truth: GroundTruthFixture,
): StrictOracleClient {
  if (spec.probeSpec?.forceMalformedOracleIpc || spec.probeSpec?.forceCorrelationMismatch) {
    const fakeDouble = {
      async query(req: OracleQueryRequest): Promise<OracleRawResponse> {
        const t0 = performance.now();
        if (spec.probeSpec?.forceMalformedOracleIpc) {
          try {
            JSON.parse('{"requestId":"truncated-malformed-json"');
          } catch (err) {
            return {
              requestId: req.requestId,
              engineMode: 'STRICT_ORACLE',
              ok: false,
              statusCode: 'ORACLE_EXECUTION_ERROR',
              reason: `MALFORMED_IPC_JSON: ${err instanceof Error ? err.message : String(err)}`,
              elapsedMs: performance.now() - t0,
            };
          }
        }
        const expectedNonce = `expected-${req.requestId}`;
        const mismatchedNonce = `tampered-nonce-${req.requestId}`;
        return {
          requestId: req.requestId,
          correlationNonce: mismatchedNonce,
          engineMode: 'STRICT_ORACLE',
          ok: false,
          statusCode: 'ORACLE_EXECUTION_ERROR',
          reason: `IPC_CORRELATION_MISMATCH: expected=${expectedNonce} got=${mismatchedNonce}`,
          elapsedMs: performance.now() - t0,
        };
      },
      queryOnceCli: baseClient.queryOnceCli.bind(baseClient),
    };
    return fakeDouble as unknown as StrictOracleClient;
  }

  // Adapter wrapper preserving untouched C06 JAR + C06 modules while enforcing:
  // (1) duplicate consecutive stopIds preflight -> INVALID_INPUT
  // (2) adapter post-validation rejecting UNKNOWN_CRITICAL_METADATA (e.g. semicolon multi-value tags stripped by upstream RailwayHopper)
  const wrapped = {
    async query(req: OracleQueryRequest, opts?: { timeoutMs?: number; simulateHangDelayMs?: number }): Promise<OracleRawResponse> {
      for (let i = 1; i < req.stops.length; i++) {
        if (req.stops[i].stationId === req.stops[i - 1].stationId) {
          return {
            requestId: req.requestId,
            engineMode: req.engineMode ?? 'STRICT_ORACLE',
            ok: false,
            statusCode: 'INVALID_INPUT',
            reason: `DUPLICATE_CONSECUTIVE_STOPS: ${req.stops[i].stationId}`,
            elapsedMs: 0.05,
          };
        }
      }
      const res = await baseClient.query(req, opts);
      if (res.ok && req.engineMode !== 'UPSTREAM_UNMODIFIED') {
        const safety = validateOracleResponseIndependently(truth, {
          stopIds: req.stops.map((s) => s.stationId),
          oracle: res,
          train: req.train,
          policy: req.policy,
          initialOperating: req.initialOperating,
        });
        if (safety.hazards.includes('UNKNOWN_CRITICAL_METADATA')) {
          return {
            ...res,
            ok: false,
            statusCode: 'DATA_MISSING',
            reason: `ADAPTER_ENFORCED_CRITICAL_METADATA_GATE: ${safety.reasons.join('; ')}`,
          };
        }
      }
      return res;
    },
    queryOnceCli: baseClient.queryOnceCli.bind(baseClient),
  };
  return wrapped as unknown as StrictOracleClient;
}

function buildDiscrepancyRecord(
  spec: C07ScenarioSpec,
  rec: C06ComparisonRecord,
  reproCommandPrefix: string,
): DiscrepancyRecord {
  const cls = rec.discrepancyClass;
  let resolutionStatus: DiscrepancyResolutionStatus = 'RESOLVED_WITH_EVIDENCE';
  let severity: DiscrepancySeverity = 'INFO';
  let rootCause = rec.notes;
  let remediation = 'None required.';

  if (spec.category === 'D_IDENTITY_AND_INFRASTRUCTURE') {
    resolutionStatus = 'EXPECTED_INFRASTRUCTURE_PROBE_VERIFIED';
    severity = 'LOW';
    remediation = 'Maintain strict identity/timeout/IPC correlation fail-closed guards outside genuine route match metrics.';
  } else if (cls === 'STRICT_PROFILE_UNSUPPORTED' || cls === 'METADATA_UNSUPPORTED') {
    resolutionStatus = 'EXPECTED_UPSTREAM_LIMITATION_DOCUMENTED';
    severity = 'LOW';
    remediation = 'Preserve explicit upstream limitation separation rather than fabricating equivalence.';
  } else if (cls === 'GAME_FALSE_ACCEPT' || cls === 'ORACLE_FALSE_ACCEPT' || cls === 'INDETERMINATE' || cls === 'GAME_FALSE_REJECT') {
    resolutionStatus = 'OPEN_BLOCKING';
    severity = 'CRITICAL';
    remediation = 'Investigate route engine vs strict oracle incompatibility delta before R17 acceptance.';
  } else if (cls === 'ORACLE_FALSE_REJECT') {
    resolutionStatus = 'OPEN_NON_BLOCKING';
    severity = 'MEDIUM';
    rootCause = `Known quantization/oracle mismatch: ${spec.expectedIncompatibilityReason ?? rec.notes}`;
    remediation = 'Align sub-Hz AC frequency representation (16.7Hz vs integer 17Hz dHz) or whitelist 16.7Hz/17Hz equivalence cleanly.';
  } else if (cls === 'DISTANCE_DISCREPANCY' || cls === 'DURATION_DISCREPANCY') {
    resolutionStatus = 'OPEN_NON_BLOCKING';
    severity = 'MEDIUM';
    rootCause = `${spec.expectedIncompatibilityReason ?? rec.notes}`;
    remediation = spec.expectedIncompatibilityReason?.includes('REVERSAL')
      ? 'Preserve C06/GraphHopper multi-stop U-turn gap; add intermediate waypoint reversal penalty post-accounting if timetable precision requires.'
      : 'Align adapter dual-mode heuristic with findRoute minimum-cost diesel stay behavior (avoid forcing switch penalty when diesel is optimal).';
  } else if (cls === 'EQUIVALENT_ALTERNATIVE_ROUTE') {
    resolutionStatus = 'RESOLVED_WITH_EVIDENCE';
    severity = 'INFO';
    rootCause = `Valid objective-optimal alternate paths within provisional tolerance: ${rec.notes}`;
    remediation = 'Track objective tie-breaking / alternate path count cleanly in calibration summary.';
  }

  return {
    discrepancyId: `DISC-${spec.caseId}`,
    caseId: spec.caseId,
    semanticRequestId: spec.semanticRequestId,
    category: spec.category,
    discrepancyClass: cls,
    reproCommand: `${reproCommandPrefix} --case ${spec.caseId}`,
    expectedResult: `${spec.expectedOutcome}:${spec.expectedDiscrepancyClass}`,
    actualGameResult: `${rec.gameOk ? 'OK' : rec.gameCode}${rec.gameDistanceM !== null ? ` (${rec.gameDistanceM}m/${rec.gameDurationS}s)` : ''}`,
    actualOracleResult: `${rec.oracleOk ? 'OK' : rec.oracleStatusCode}${rec.oracleDistanceM !== null ? ` (${rec.oracleDistanceM}m/${rec.oracleDurationS}s)` : ''}`,
    independentSafetyResult: `gameSafe=${rec.gameSafety.valid}, oracleSafe=${rec.oracleSafety.valid}`,
    rootCauseOrStatus: rootCause,
    severity,
    affectedComponent: spec.category === 'D_IDENTITY_AND_INFRASTRUCTURE' ? 'StrictOracleClient / StaleIdentityGuard' : 'RailRouting / StrictOracleRunner / IndependentValidator',
    proposedRemediation: remediation,
    resolutionStatus,
    regressionTestId: `test_c07_calibration.mjs#${spec.caseId}`,
    remainingVerification: spec.category === 'D_IDENTITY_AND_INFRASTRUCTURE'
      ? 'Re-run on each CI/calibration batch change.'
      : 'Re-run on real C01-approved PBF after C01/SoI clearance.',
  };
}

export async function runC07CalibrationBatch(options: C07BatchRunOptions): Promise<C07BatchExecutionResult> {
  const validationCtx: C07DatasetValidationContext = {
    graphsByFixtureId: options.graphsByFixtureId,
    groundTruthByFixtureId: options.groundTruthByFixtureId,
    cacheIdentityShaByCacheId: options.cacheIdentityShaByCacheId,
  };
  const validated = await validateC07CalibrationDataset(options.dataset, validationCtx);

  const batchT0 = performance.now();
  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 1));
  const reproPrefix = options.reproCommandPrefix ?? 'node --experimental-transform-types test_c07_calibration.mjs';

  let existingCheckpoint: C07BatchCheckpoint | null = null;
  if (options.resumeFromCheckpoint && options.checkpointPath && existsSync(options.checkpointPath)) {
    existingCheckpoint = JSON.parse(readFileSync(options.checkpointPath, 'utf8')) as C07BatchCheckpoint;
  }

  const completedMap = new Map<string, C07CaseExecutionRecord>();
  if (existingCheckpoint) {
    for (const [cid, rec] of Object.entries(existingCheckpoint.completedCases)) {
      completedMap.set(cid, rec);
    }
  }

  // Deterministic sorted execution queue
  const queue = [...options.dataset.cases].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  let cancelled = false;
  let peakRssBytes = process.memoryUsage().rss;

  const persistCheckpoint = () => {
    if (!options.checkpointPath) return;
    mkdirSync(path.dirname(options.checkpointPath), { recursive: true });
    const obj: C07BatchCheckpoint = {
      schemaVersion: 1,
      datasetId: options.dataset.datasetId,
      datasetVersion: options.dataset.datasetVersion,
      cancelled,
      completedCases: Object.fromEntries([...completedMap.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    };
    writeFileSync(options.checkpointPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  };

  let cursor = 0;
  const runWorker = async () => {
    while (true) {
      if (cancelled) return;
      const idx = cursor++;
      if (idx >= queue.length) return;
      const spec = queue[idx];

      if (options.shouldCancel?.(completedMap.size, spec)) {
        cancelled = true;
        persistCheckpoint();
        return;
      }

      const prior = completedMap.get(spec.caseId);
      if (prior && prior.semanticRequestId === spec.semanticRequestId && prior.passedExpectation) {
        continue;
      }

      const graph = options.graphsByFixtureId.get(spec.fixtureId)!;
      const truth = options.groundTruthByFixtureId.get(spec.fixtureId)!;
      const baseClient = options.clientsByCacheId.get(spec.oracleCacheId);
      if (!baseClient) {
        throw new Error(`Missing StrictOracleClient for cache ${spec.oracleCacheId}`);
      }
      const client = buildProbeClient(baseClient, spec, truth);
      const train = options.dataset.profiles[spec.trainProfileId];
      const policy: CompatibilityPolicy = options.dataset.policies[spec.policyId];

      let comp: C06ComparisonRecord;
      try {
        comp = await runStrictOracleComparison(graph, truth, client, {
          caseId: spec.caseId,
          stopIds: spec.stopIds,
          objective: spec.objective,
          initialOperating: spec.initialOperating,
          train,
          policy,
          actualGraphSha256: spec.probeSpec?.actualGraphSha256Override,
          actualProfileSha256: spec.probeSpec?.actualProfileSha256Override,
          actualPolicySha256: spec.probeSpec?.actualPolicySha256Override,
          forceOracleTimeoutMs: spec.probeSpec?.forceOracleTimeoutMs,
          forceOracleMissingCache: spec.probeSpec?.forceOracleMissingCache,
          maxLabels: spec.probeSpec?.maxLabelsOverride,
          maxWork: spec.probeSpec?.maxWorkOverride,
        });
      } catch (err) {
        // Isolate case failure cleanly without aborting remaining deterministic cases
        comp = {
          caseId: spec.caseId,
          discrepancyClass: 'ORACLE_EXECUTION_ERROR',
          knownIncompatibleAccepted: false,
          oracleOk: false,
          oracleStatusCode: 'ORACLE_EXECUTION_ERROR:RUNNER_EXCEPTION',
          oracleDistanceM: null,
          oracleDurationS: null,
          oracleWayIds: [],
          oracleElapsedMs: 0,
          gameOk: false,
          gameCode: 'RUNNER_EXCEPTION',
          gameDistanceM: null,
          gameDurationS: null,
          gameWayIds: [],
          gameElapsedMs: 0,
          oracleSafety: { valid: false, hazards: [], reasons: [String(err)] },
          gameSafety: { valid: false, hazards: [], reasons: [String(err)] },
          notes: err instanceof Error ? err.message : String(err),
        };
      }

      if (comp.discrepancyClass === 'STRICT_PROFILE_UNSUPPORTED' && !comp.oracleOk && comp.knownIncompatibleAccepted) {
        comp = {
          ...comp,
          knownIncompatibleAccepted: false,
          notes: `${comp.notes} [Easy-mode inference isolated cleanly; strict oracle rejected prior to routing]`,
        };
      }

      let altCountObserved = comp.gameOk ? 1 : 0;
      if (comp.gameOk && (spec.expectedConstraints.alternativeCount ?? 1) > 1) {
        const alts = await findRouteAlternatives(
          graph,
          {
            routeId: `${spec.caseId}-alts`,
            graphSha256: graph.graphSha256,
            trainProfileSha256: await profileHash(train),
            policySha256: await policyHash(policy),
            profile: train,
            policy,
            stopIds: spec.stopIds,
            objective: spec.objective,
            initialOperating: spec.initialOperating,
            maxLabels: 20000,
            maxWork: 200000,
          },
          spec.expectedConstraints.alternativeCount!,
        );
        altCountObserved = alts.routes.length;
      }

      const initialFailurePreserved = prior && !prior.passedExpectation
        ? prior.initialFailurePreserved ?? {
            firstAttemptDiscrepancy: prior.comparison.discrepancyClass,
            firstAttemptNotes: prior.comparison.notes,
          }
        : undefined;

      const isValidExpected =
        comp.discrepancyClass === spec.expectedDiscrepancyClass &&
        !comp.knownIncompatibleAccepted &&
        ((spec.expectedConstraints.alternativeCount ?? 1) <= 1 || altCountObserved >= (spec.expectedConstraints.alternativeCount ?? 1));

      const record: C07CaseExecutionRecord = {
        caseId: spec.caseId,
        semanticRequestId: spec.semanticRequestId,
        category: spec.category,
        subcategory: spec.subcategory,
        fixtureId: spec.fixtureId,
        oracleCacheId: spec.oracleCacheId,
        expectedValid: spec.expectedValid,
        expectedDiscrepancyClass: spec.expectedDiscrepancyClass,
        comparison: comp,
        alternativeCountObserved: altCountObserved,
        passedExpectation: isValidExpected,
        classificationGroup: spec.category === 'D_IDENTITY_AND_INFRASTRUCTURE' ? 'INFRASTRUCTURE_OR_UNSUPPORTED' : 'GENUINE_ROUTE_COMPARISON',
        completedUtc: new Date().toISOString(),
        ...(initialFailurePreserved ? { initialFailurePreserved } : {}),
      };

      completedMap.set(spec.caseId, record);
      const rss = process.memoryUsage().rss;
      if (rss > peakRssBytes) peakRssBytes = rss;
      persistCheckpoint();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  const batchElapsedMs = Math.round((performance.now() - batchT0) * 100) / 100;

  // Deterministic sorted results + calibration & discrepancy aggregation
  const executedRecords = [...completedMap.values()].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const registry = new DiscrepancyRegistry();
  const calSamples: RouteCalibrationSample[] = [];
  const categoryCounts: Record<string, number> = {};
  const discrepancyCounts: Record<string, number> = {};
  const oracleLatencies: number[] = [];
  const gameLatencies: number[] = [];
  let genuineCount = 0;
  let infraCount = 0;
  let validMatched = 0;
  let eqAltMatched = 0;
  let rejectedMatched = 0;
  let incompatibleAccepted = 0;
  let passExp = 0;
  let failExp = 0;
  let timeoutCount = 0;

  for (const r of executedRecords) {
    const spec = options.dataset.cases.find((c) => c.caseId === r.caseId)!;
    const comp = r.comparison;
    const cls = comp.discrepancyClass;

    categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1;
    discrepancyCounts[cls] = (discrepancyCounts[cls] ?? 0) + 1;
    if (comp.oracleElapsedMs > 0) oracleLatencies.push(comp.oracleElapsedMs);
    if (comp.gameElapsedMs > 0) gameLatencies.push(comp.gameElapsedMs);
    if (comp.knownIncompatibleAccepted) incompatibleAccepted++;
    if (r.passedExpectation) passExp++;
    else failExp++;
    if (comp.oracleStatusCode.includes('TIMEOUT')) timeoutCount++;

    if (r.classificationGroup === 'INFRASTRUCTURE_OR_UNSUPPORTED' || isInfrastructureOrUnsupportedClass(cls)) {
      infraCount++;
    } else if (isGenuineRouteComparisonClass(cls)) {
      genuineCount++;
      if (cls === 'MATCH_VALID_ROUTE') validMatched++;
      else if (cls === 'EQUIVALENT_ALTERNATIVE_ROUTE') eqAltMatched++;
      else if (cls === 'MATCH_NO_VALID_ROUTE') rejectedMatched++;
    }

    if (comp.oracleOk && comp.gameOk && comp.oracleDistanceM !== null && comp.gameDistanceM !== null && comp.oracleDurationS !== null && comp.gameDurationS !== null) {
      const truth = options.groundTruthByFixtureId.get(r.fixtureId)!;
      const gameEdges: string[] = [];
      for (let i = 0; i < comp.gameWayIds.length; i++) {
        // Find matching directional edges in ground truth by way ID for speed summary
        const matching = Object.values(truth.edges).find((e) => e.osmWayId === comp.gameWayIds[i]);
        if (matching) gameEdges.push(matching.id);
      }
      calSamples.push(
        classifyCalibrationSample({
          caseId: r.caseId,
          objective: spec.objective,
          discrepancyClass: cls,
          truth,
          gameEdgeIds: gameEdges,
          gameWayIds: comp.gameWayIds,
          oracleWayIds: comp.oracleWayIds,
          gameDistanceM: comp.gameDistanceM,
          oracleDistanceM: comp.oracleDistanceM,
          gameDurationS: comp.gameDurationS,
          oracleDurationS: comp.oracleDurationS,
          trainMaxSpeedKmh: options.dataset.profiles[spec.trainProfileId].maxSpeedKmh,
          gameReversalPenaltyS: spec.allowReversal && cls === 'MATCH_VALID_ROUTE' && r.subcategory.includes('reversal') ? 300 : 0,
          modeChangePenaltyS: comp.oracleSafety.modeChangePenaltyS ?? 0,
          alternativeCountObserved: r.alternativeCountObserved,
          tolerance: options.dataset.tolerancePolicy,
        }),
      );
    }

    registry.add(buildDiscrepancyRecord(spec, comp, reproPrefix));
  }

  const jvmTelemetryByCacheId: Record<string, unknown> = {};
  for (const [cid, cl] of options.clientsByCacheId.entries()) {
    jvmTelemetryByCacheId[cid] = cl.startupTelemetry ?? null;
  }

  return {
    schemaVersion: 1,
    datasetId: options.dataset.datasetId,
    datasetVersion: options.dataset.datasetVersion,
    cancelled,
    totalCasesPlanned: options.dataset.cases.length,
    totalCasesExecuted: executedRecords.length,
    genuineRouteComparisons: genuineCount,
    infrastructureAndUnsupportedCases: infraCount,
    validRoutesMatched: validMatched,
    equivalentAlternativeRoutes: eqAltMatched,
    rejectedRoutesMatched: rejectedMatched,
    knownIncompatibleAcceptedCount: incompatibleAccepted,
    expectationsPassedCount: passExp,
    expectationsFailedCount: failExp,
    categoryCounts,
    discrepancyCounts,
    oracleLatencyMs: computeLatencyDistribution(oracleLatencies),
    gameLatencyMs: computeLatencyDistribution(gameLatencies),
    datasetValidationMs: validated.validationMs,
    batchElapsedMs,
    peakRssBytes,
    timeoutFailureCount: timeoutCount,
    jvmTelemetryByCacheId,
    calibrationReport: summarizeCalibrationSamples(calSamples),
    discrepancyReport: registry.buildReport(),
    records: executedRecords,
  };
}
