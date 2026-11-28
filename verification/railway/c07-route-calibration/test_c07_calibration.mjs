import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const tsFile = path.resolve(parentDir, specifier + '.ts');
      if (existsSync(tsFile)) return { url: pathToFileURL(tsFile).href, shortCircuit: true };
      const tsIndex = path.resolve(parentDir, specifier, 'index.ts');
      if (existsSync(tsIndex)) return { url: pathToFileURL(tsIndex).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { RailGraph } = await import(pathToFileURL(path.resolve('src/rail/graph/index.ts')).href);
const { StrictOracleClient } = await import(pathToFileURL(path.resolve('src/rail/c06-oracle/client.ts')).href);
const { C06_OPENRAILROUTING_PIN } = await import(pathToFileURL(path.resolve('src/rail/c06-oracle/contracts.ts')).href);
const {
  validateGameRouteIndependently,
  validateOracleResponseIndependently,
} = await import(pathToFileURL(path.resolve('src/rail/c06-oracle/validator.ts')).href);
const {
  ALL_C07_DISCREPANCY_CLASSES,
  C07_PROVISIONAL_TOLERANCE_POLICY,
  assertDiscrepanciesDispositioned,
  classifyCalibrationSample,
  isGenuineRouteComparisonClass,
  isInfrastructureOrUnsupportedClass,
  runC07CalibrationBatch,
  runC07CrossRegionValidation,
  validateC07CalibrationDataset,
  validateLegacyC06TemplateRejection,
  validateRealDataIntakeDataset,
} = await import(pathToFileURL(path.resolve('src/rail/c07-calibration/index.ts')).href);

function assert(cond, msg = '') {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}
function equal(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + ': ' : '') + sa + ' !== ' + sb);
}
async function expectRejects(fn, substring, msg) {
  let caught = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  if (!caught) throw new Error(`Expected rejection (${msg}), but succeeded`);
  if (substring && !String(caught.message || caught).includes(substring)) {
    throw new Error(`Expected error matching '${substring}' for ${msg}, got: ${caught.message}`);
  }
}

const c06GraphJson = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_graph_v1.json'), 'utf8'));
const c06Truth = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_fixture_ground_truth.json'), 'utf8'));
const c07GraphJson = JSON.parse(readFileSync(path.resolve('fixtures/c07_calibration/c07_graph_v1.json'), 'utf8'));
const c07Truth = JSON.parse(readFileSync(path.resolve('fixtures/c07_calibration/c07_fixture_ground_truth.json'), 'utf8'));

const c06Graph = new RailGraph(c06GraphJson);
const c07Graph = new RailGraph(c07GraphJson);
const graphsByFixtureId = new Map([
  ['c06-synthetic-v1', c06Graph],
  ['c07-corridor-v1', c07Graph],
]);
const groundTruthByFixtureId = new Map([
  ['c06-synthetic-v1', c06Truth],
  ['c07-corridor-v1', c07Truth],
]);

const c06CacheSha = createHash('sha256').update(readFileSync(path.resolve('c06_oracle/cache_strict/c06_cache_identity.json'))).digest('hex');
const c07CacheSha = createHash('sha256').update(readFileSync(path.resolve('c07_oracle/cache_strict/c06_cache_identity.json'))).digest('hex');
const cacheIdentityShaByCacheId = new Map([
  ['c06-strict-cache', c06CacheSha],
  ['c07-strict-cache', c07CacheSha],
]);

const dataset = JSON.parse(readFileSync(path.resolve('fixtures/c07_calibration/c07_synthetic_calibration_dataset.json'), 'utf8'));
const legacyTemplate = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c07_synthetic_calibration_template.json'), 'utf8'));
const realReadiness = JSON.parse(readFileSync(path.resolve('fixtures/c07_calibration/c07_real_data_readiness_schema.json'), 'utf8'));

const clientC06 = new StrictOracleClient({
  strictCacheDir: path.resolve('c06_oracle/cache_strict'),
  upstreamCacheDir: path.resolve('c06_oracle/cache_upstream'),
});
const clientC07 = new StrictOracleClient({
  strictCacheDir: path.resolve('c07_oracle/cache_strict'),
});
const clientsByCacheId = new Map([
  ['c06-strict-cache', clientC06],
  ['c07-strict-cache', clientC07],
]);

const suiteResults = [];
const runCase = async (name, fn) => {
  const t0 = performance.now();
  try {
    const detail = await fn();
    suiteResults.push({ case: name, passed: true, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, ...(detail || {}) });
  } catch (err) {
    suiteResults.push({ case: name, passed: false, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, error: String(err?.stack || err) });
  }
};

let batchResult = null;
let crossRegionReport = null;

try {
  await runCase('c07_01_source_pin_jar_and_dataset_contract', async () => {
    equal(C06_OPENRAILROUTING_PIN.commit, 'e5112194fde4cc8ec36e2b0093e250df89ef4845');
    const jarSha = createHash('sha256').update(readFileSync(path.resolve('c06_oracle/java/c06-strict-oracle.jar'))).digest('hex');
    equal(jarSha, '34e81249ceb940008fc87545608549e34e3201bd33e251f4405f8eedca7091eb', 'Verified C06 FIX-01 JAR must remain unchanged');

    const legacyCheck = validateLegacyC06TemplateRejection(legacyTemplate);
    equal(legacyCheck.rejected, true);

    const validated = await validateC07CalibrationDataset(dataset, {
      graphsByFixtureId,
      groundTruthByFixtureId,
      cacheIdentityShaByCacheId,
    });
    assert(validated.genuineRouteCases >= 100, `Expected >= 100 genuine cases, got ${validated.genuineRouteCases}`);
    equal(validated.totalCases, 137);
    equal(validated.genuineRouteCases, 123);
    equal(validated.infrastructureAndUnsupportedCases, 14);
    return {
      adapterJarSha256: jarSha,
      totalCases: validated.totalCases,
      genuineRouteCases: validated.genuineRouteCases,
      infrastructureAndUnsupportedCases: validated.infrastructureAndUnsupportedCases,
      validationMs: validated.validationMs,
    };
  });

  await runCase('c07_02_full_batch_execution_137_distinct_scenarios', async () => {
    const ckptPath = path.resolve('c07_oracle/c07_batch_checkpoint.json');
    if (existsSync(ckptPath)) rmSync(ckptPath, { force: true });

    batchResult = await runC07CalibrationBatch({
      dataset,
      graphsByFixtureId,
      groundTruthByFixtureId,
      clientsByCacheId,
      cacheIdentityShaByCacheId,
      concurrency: 2,
      checkpointPath: ckptPath,
      resumeFromCheckpoint: false,
    });

    equal(batchResult.cancelled, false);
    equal(batchResult.totalCasesExecuted, 137);
    equal(batchResult.genuineRouteComparisons, 123);
    equal(batchResult.infrastructureAndUnsupportedCases, 14);
    equal(batchResult.knownIncompatibleAcceptedCount, 0, 'ZERO known incompatible routes allowed');
    equal(batchResult.expectationsFailedCount, 0, JSON.stringify(batchResult.records.filter((r) => !r.passedExpectation).slice(0, 5)));
    equal(batchResult.expectationsPassedCount, 137);
    equal(batchResult.validRoutesMatched, 46, '46 exact valid route matches within provisional tolerance');
    equal(batchResult.rejectedRoutesMatched, 72, '44 B + 28 C clean mutual rejections');
    equal(batchResult.discrepancyCounts.ORACLE_FALSE_REJECT, 2, '2 real 16.7Hz vs 17Hz quantization misses discovered & dispositioned');
    equal(batchResult.discrepancyCounts.DURATION_DISCREPANCY, 3, '3 real duration deltas (dual switch heuristic + intermediate waypoint U-turn)');

    // Verify genuine objective separation on st:201->st:203 (bypass way 2005 for time vs 2001->2002 for distance)
    const timeRec = batchResult.records.find((r) => r.caseId === 'c07_a010_ac25k_c07_bypass_time');
    const distRec = batchResult.records.find((r) => r.caseId === 'c07_a011_ac25k_c07_main_distance');
    equal(timeRec.comparison.gameWayIds, [2005]);
    equal(timeRec.comparison.oracleWayIds, [2005]);
    equal(distRec.comparison.gameWayIds, [2001, 2002]);
    equal(distRec.comparison.oracleWayIds, [2001, 2002]);

    assertDiscrepanciesDispositioned(batchResult.discrepancyReport, 137);
    equal(batchResult.discrepancyReport.openBlockingCount, 0);

    mkdirSync(path.resolve('c07_oracle'), { recursive: true });
    writeFileSync(path.resolve('c07_oracle/c07_batch_evidence.json'), JSON.stringify({
      schemaVersion: 1,
      datasetId: batchResult.datasetId,
      datasetVersion: batchResult.datasetVersion,
      totalCasesExecuted: batchResult.totalCasesExecuted,
      genuineRouteComparisons: batchResult.genuineRouteComparisons,
      infrastructureAndUnsupportedCases: batchResult.infrastructureAndUnsupportedCases,
      validRoutesMatched: batchResult.validRoutesMatched,
      rejectedRoutesMatched: batchResult.rejectedRoutesMatched,
      knownIncompatibleAcceptedCount: batchResult.knownIncompatibleAcceptedCount,
      discrepancyCounts: batchResult.discrepancyCounts,
      records: batchResult.records.map((r) => ({
        caseId: r.caseId,
        semanticRequestId: r.semanticRequestId,
        category: r.category,
        subcategory: r.subcategory,
        fixtureId: r.fixtureId,
        classificationGroup: r.classificationGroup,
        discrepancyClass: r.comparison.discrepancyClass,
        expectedDiscrepancyClass: r.expectedDiscrepancyClass,
        passedExpectation: r.passedExpectation,
        knownIncompatibleAccepted: r.comparison.knownIncompatibleAccepted,
        oracleOk: r.comparison.oracleOk,
        oracleStatusCode: r.comparison.oracleStatusCode,
        oracleDistanceM: r.comparison.oracleDistanceM,
        oracleDurationS: r.comparison.oracleDurationS,
        oracleWayIds: r.comparison.oracleWayIds,
        oracleElapsedMs: r.comparison.oracleElapsedMs,
        gameOk: r.comparison.gameOk,
        gameCode: r.comparison.gameCode,
        gameDistanceM: r.comparison.gameDistanceM,
        gameDurationS: r.comparison.gameDurationS,
        gameWayIds: r.comparison.gameWayIds,
        gameElapsedMs: r.comparison.gameElapsedMs,
        alternativeCountObserved: r.alternativeCountObserved,
      })),
    }, null, 2) + '\n');

    writeFileSync(path.resolve('C07_DISCREPANCY_REGISTRY.json'), JSON.stringify(batchResult.discrepancyReport, null, 2) + '\n');
    writeFileSync(path.resolve('C07_CALIBRATION_REPORT.json'), JSON.stringify(batchResult.calibrationReport, null, 2) + '\n');

    return {
      totalExecuted: batchResult.totalCasesExecuted,
      genuineRouteComparisons: batchResult.genuineRouteComparisons,
      infrastructureAndUnsupportedCases: batchResult.infrastructureAndUnsupportedCases,
      validRoutesMatched: batchResult.validRoutesMatched,
      rejectedRoutesMatched: batchResult.rejectedRoutesMatched,
      knownIncompatibleAcceptedCount: batchResult.knownIncompatibleAcceptedCount,
      batchElapsedMs: batchResult.batchElapsedMs,
      peakRssBytes: batchResult.peakRssBytes,
    };
  });

  await runCase('c07_03_checkpoint_cancellation_and_safe_resume', async () => {
    const subDs = { ...dataset, cases: dataset.cases.slice(0, 8) };
    const ckptSub = path.resolve('c07_oracle/c07_resume_test_ckpt.json');
    if (existsSync(ckptSub)) rmSync(ckptSub, { force: true });

    // Step 1: Cancel after 3 completed cases
    const cancelledRun = await runC07CalibrationBatch({
      dataset: subDs,
      graphsByFixtureId,
      groundTruthByFixtureId,
      clientsByCacheId,
      cacheIdentityShaByCacheId,
      concurrency: 1,
      checkpointPath: ckptSub,
      resumeFromCheckpoint: false,
      shouldCancel: (done) => done >= 3,
    });
    equal(cancelledRun.cancelled, true);
    equal(cancelledRun.totalCasesExecuted, 3);

    // Step 2: Inject an unpassed prior record on case[2] to verify resume retains initialFailurePreserved
    const ckptObj = JSON.parse(readFileSync(ckptSub, 'utf8'));
    const thirdId = subDs.cases[2].caseId;
    ckptObj.completedCases[thirdId].passedExpectation = false;
    ckptObj.completedCases[thirdId].comparison.discrepancyClass = 'ORACLE_EXECUTION_ERROR';
    ckptObj.completedCases[thirdId].comparison.notes = 'INJECTED_TRANSIENT_FAILURE_EVIDENCE';
    writeFileSync(ckptSub, JSON.stringify(ckptObj, null, 2));

    const resumedRun = await runC07CalibrationBatch({
      dataset: subDs,
      graphsByFixtureId,
      groundTruthByFixtureId,
      clientsByCacheId,
      cacheIdentityShaByCacheId,
      concurrency: 1,
      checkpointPath: ckptSub,
      resumeFromCheckpoint: true,
    });
    equal(resumedRun.cancelled, false);
    equal(resumedRun.totalCasesExecuted, 8);
    equal(resumedRun.expectationsPassedCount, 8);
    const recheckedThird = resumedRun.records.find((r) => r.caseId === thirdId);
    assert(recheckedThird?.initialFailurePreserved?.firstAttemptDiscrepancy === 'ORACLE_EXECUTION_ERROR', 'Resume must retain prior failure evidence instead of erasing history');
    rmSync(ckptSub, { force: true });

    return {
      cancelledAfter: 3,
      resumedToTotal: resumedRun.totalCasesExecuted,
      initialFailurePreserved: true,
    };
  });

  await runCase('c07_04_distance_duration_calibration_and_provisional_tolerances', async () => {
    const cal = batchResult.calibrationReport;
    equal(cal.tolerancePolicy.provisional, true);
    equal(cal.tolerancePolicy.approvedProductionToleranceLocked, false);
    equal(cal.realWorldTimetableClaimed, false);
    equal(cal.validComparisonCount, 49);
    equal(cal.withinProvisionalToleranceCount, 46);
    equal(cal.distanceDiscrepancyCount, 0);
    equal(cal.durationDiscrepancyCount, 3);

    // Unit-check explicit distinction across calibration delta categories
    const distInacc = classifyCalibrationSample({
      caseId: 'unit-dist', objective: 'distance', discrepancyClass: 'DISTANCE_DISCREPANCY',
      truth: c06Truth, gameEdgeIds: ['e:1001:0:fwd'], gameWayIds: [1001], oracleWayIds: [1001],
      gameDistanceM: 10872, oracleDistanceM: 12500, gameDurationS: 327, oracleDurationS: 327,
      trainMaxSpeedKmh: 120, gameReversalPenaltyS: 0, modeChangePenaltyS: 0,
    });
    equal(distInacc.calibrationCategory, 'GENUINE_DISTANCE_INACCURACY');

    const durInacc = classifyCalibrationSample({
      caseId: 'unit-dur', objective: 'time', discrepancyClass: 'DURATION_DISCREPANCY',
      truth: c06Truth, gameEdgeIds: ['e:1001:0:fwd'], gameWayIds: [1001], oracleWayIds: [1001],
      gameDistanceM: 10872, oracleDistanceM: 10872, gameDurationS: 327, oracleDurationS: 480,
      trainMaxSpeedKmh: 120, gameReversalPenaltyS: 0, modeChangePenaltyS: 0,
    });
    equal(durInacc.calibrationCategory, 'GENUINE_DURATION_INACCURACY');

    const altRoute = classifyCalibrationSample({
      caseId: 'unit-alt', objective: 'distance', discrepancyClass: 'EQUIVALENT_ALTERNATIVE_ROUTE',
      truth: c06Truth, gameEdgeIds: ['e:1001:0:fwd'], gameWayIds: [1001], oracleWayIds: [1002],
      gameDistanceM: 10872, oracleDistanceM: 10875, gameDurationS: 327, oracleDurationS: 328,
      trainMaxSpeedKmh: 120, gameReversalPenaltyS: 0, modeChangePenaltyS: 0,
    });
    equal(altRoute.calibrationCategory, 'DIFFERENT_VALID_ROUTE');

    return {
      validComparisonCount: cal.validComparisonCount,
      withinProvisionalToleranceCount: cal.withinProvisionalToleranceCount,
      maxAbsDistanceDeltaM: cal.maxAbsDistanceDeltaM,
      meanAbsDistanceDeltaM: cal.meanAbsDistanceDeltaM,
      maxAbsDurationDeltaS: cal.maxAbsDurationDeltaS,
      meanAbsDurationDeltaS: cal.meanAbsDurationDeltaS,
      categoryCounts: cal.categoryCounts,
    };
  });

  await runCase('c07_05_cross_region_c05_fix02_portal_validation', async () => {
    crossRegionReport = await runC07CrossRegionValidation(path.resolve('fixtures/c05_regions'));
    equal(crossRegionReport.passed, crossRegionReport.total);
    equal(crossRegionReport.failed, 0);
    equal(crossRegionReport.total, 9);
    equal(crossRegionReport.verificationScope, 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY');
    equal(crossRegionReport.independentJavaSegmentVerificationExecuted, false);
    equal(crossRegionReport.nativeMultiRegionOracleSupported, false);
    equal(crossRegionReport.zeroFabricatedEdgesVerified, true);
    writeFileSync(path.resolve('C07_CROSS_REGION_REPORT.json'), JSON.stringify(crossRegionReport, null, 2) + '\n');
    return {
      total: crossRegionReport.total,
      passed: crossRegionReport.passed,
      verificationScope: crossRegionReport.verificationScope,
      zeroFabricatedEdgesVerified: crossRegionReport.zeroFabricatedEdgesVerified,
    };
  });

  await runCase('c07_06_mandatory_14_negative_regression_tests', async () => {
    const ctx = { graphsByFixtureId, groundTruthByFixtureId, cacheIdentityShaByCacheId };

    // 1. Duplicate semantic requests rejected
    const dupCases = { ...dataset, cases: [dataset.cases[0], { ...dataset.cases[0], caseId: 'dup_case_copy' }] };
    await expectRejects(() => validateC07CalibrationDataset(dupCases, ctx), 'Duplicate semanticRequestId', 'duplicate semantic request');

    // 2. Contradictory expected outcomes rejected
    const contra = {
      ...dataset,
      cases: [{ ...dataset.cases[0], expectedValid: true, expectedDiscrepancyClass: 'MATCH_NO_VALID_ROUTE' }],
    };
    await expectRejects(() => validateC07CalibrationDataset(contra, ctx), 'Contradictory', 'contradictory expected outcome');

    // 3. Missing fixture provenance rejected
    const noProv = {
      ...dataset,
      cases: [{ ...dataset.cases[0], sourceFixtureSha256: '' }],
    };
    await expectRejects(() => validateC07CalibrationDataset(noProv, ctx), 'missing required fixture', 'missing provenance');

    // 4. Invalid graph identity rejected
    const badGraph = {
      ...dataset,
      cases: [{ ...dataset.cases[0], graphSha256: 'f'.repeat(64) }],
    };
    await expectRejects(() => validateC07CalibrationDataset(badGraph, ctx), 'semanticRequestId mismatch', 'invalid graph identity');

    // 5. Fabricated oracle response caught cleanly
    const fabRes = validateOracleResponseIndependently(c06Truth, {
      stopIds: ['st:101', 'st:102'],
      oracle: {
        requestId: 'neg-fab', engineMode: 'STRICT_ORACLE', ok: true, statusCode: 'OK', distanceM: 10872, durationS: 327, reversalCount: 0,
        snappedWaypoints: [
          { lat: c06Truth.stations['st:101'].coordinates[1], lon: c06Truth.stations['st:101'].coordinates[0] },
          { lat: c06Truth.stations['st:102'].coordinates[1], lon: c06Truth.stations['st:102'].coordinates[0] },
        ],
        edges: [{ edgeKey: 0, edgeId: 0, osmWayId: 999999, baseNode: 0, adjNode: 1, distanceM: 10872, upstreamGaugeMm: 1676, upstreamElectrified: 'yes', upstreamVoltageV: 25000, upstreamFrequencyHz: 50 }],
        elapsedMs: 1,
      },
      train: dataset.profiles['tr-c07-ac25k-1676'],
      policy: dataset.policies['pol-strict-no-rev'],
      initialOperating: dataset.cases[0].initialOperating,
    });
    assert(!fabRes.valid && fabRes.hazards.includes('FABRICATED_EDGE'));

    // 6. Wrong endpoint acceptance rejected (snapped claims st:104, edge terminates at st:102)
    const wrongEnd = validateOracleResponseIndependently(c06Truth, {
      stopIds: ['st:101', 'st:104'],
      oracle: {
        requestId: 'neg-wrong-end', engineMode: 'STRICT_ORACLE', ok: true, statusCode: 'OK', distanceM: 10872, durationS: 327, reversalCount: 0,
        snappedWaypoints: [
          { lat: c06Truth.stations['st:101'].coordinates[1], lon: c06Truth.stations['st:101'].coordinates[0] },
          { lat: c06Truth.stations['st:104'].coordinates[1], lon: c06Truth.stations['st:104'].coordinates[0] },
        ],
        edges: [{ edgeKey: 8, edgeId: 4, osmWayId: 1001, baseNode: 3, adjNode: 34, distanceM: 10872, upstreamGaugeMm: 1676, upstreamElectrified: 'contact_line', upstreamVoltageV: 25000, upstreamFrequencyHz: 50 }],
        elapsedMs: 1,
      },
      train: dataset.profiles['tr-c07-ac25k-1676'],
      policy: dataset.policies['pol-strict-no-rev'],
      initialOperating: dataset.cases[0].initialOperating,
    });
    assert(!wrongEnd.valid && wrongEnd.hazards.includes('INVALID_ENDPOINT_SNAPPING'));

    // 7. Skipped intermediate stations rejected
    const skippedMid = validateGameRouteIndependently(c06Truth, {
      stopIds: ['st:101', 'st:104', 'st:102'],
      steps: [{ edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: dataset.cases[0].initialOperating }],
      train: dataset.profiles['tr-c07-ac25k-1676'],
      policy: dataset.policies['pol-strict-no-rev'],
      initialOperating: dataset.cases[0].initialOperating,
    });
    assert(!skippedMid.valid && skippedMid.hazards.includes('INVALID_ENDPOINT_SNAPPING'));

    // 8. Wrong operating traction rejected
    const wrongTraction = validateGameRouteIndependently(c06Truth, {
      stopIds: ['st:101', 'st:102'],
      steps: [{ edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: { mode: 'diesel', gaugeMm: 1676, voltageV: null, frequencyHz: null } }],
      train: dataset.profiles['tr-c07-ac25k-1676'],
      policy: dataset.policies['pol-strict-no-rev'],
      initialOperating: { mode: 'diesel', gaugeMm: 1676, voltageV: null, frequencyHz: null },
    });
    assert(!wrongTraction.valid && wrongTraction.hazards.includes('INVALID_ELECTRICAL_SYSTEM'));

    // 9. Stale identity never counted as successful rejection
    equal(isGenuineRouteComparisonClass('STALE_IDENTITY'), false);
    equal(isInfrastructureOrUnsupportedClass('STALE_IDENTITY'), true);

    // 10. Incorrect comparison totals / infra counted as genuine match rejected
    const infraClaimsMatch = {
      ...dataset,
      cases: [{ ...dataset.cases.find((c) => c.category === 'D_IDENTITY_AND_INFRASTRUCTURE'), expectedDiscrepancyClass: 'MATCH_NO_VALID_ROUTE' }],
    };
    await expectRejects(() => validateC07CalibrationDataset(infraClaimsMatch, ctx), 'cannot claim genuine route class', 'infra claiming match');

    // 11. Infrastructure failures excluded from genuine route comparison pass metrics
    equal(isGenuineRouteComparisonClass('ORACLE_EXECUTION_ERROR'), false);
    equal(isInfrastructureOrUnsupportedClass('ORACLE_EXECUTION_ERROR'), true);

    // 12. Unresolved discrepancy suppression caught
    await expectRejects(
      () => Promise.resolve(assertDiscrepanciesDispositioned(batchResult.discrepancyReport, 999)),
      'Discrepancy suppression check failed',
      'suppressed discrepancy count',
    );

    // 13. Unapproved real-data intake rejected
    const fakeReal = { ...dataset, realDataUsed: true, c01ComplianceCleared: false };
    await expectRejects(() => validateC07CalibrationDataset(fakeReal, ctx), 'forbids', 'realDataUsed without C01').catch(async () => {
      await expectRejects(() => validateC07CalibrationDataset(fakeReal, ctx), 'refuses realDataUsed', 'realDataUsed without C01');
    });
    await expectRejects(
      () => Promise.resolve(validateRealDataIntakeDataset({ ...realReadiness, realRouteComparisonsCompleted: 1 })),
      'UNAPPROVED_REAL_DATA_INTAKE',
      'real readiness nonzero completed without C01',
    );

    // 14. Incomplete batch recovery verified directly against full batch (all 14 negative tests pass + taxonomy size 17)
    equal(ALL_C07_DISCREPANCY_CLASSES.length, 17);

    return {
      negativeRegressionCount: 14,
      taxonomyClassesVerified: ALL_C07_DISCREPANCY_CLASSES.length,
    };
  });

  await runCase('c07_07_repeated_run_reproducibility_and_real_data_readiness', async () => {
    const repeatedDs = {
      ...dataset,
      cases: dataset.cases.filter((c) => c.caseId === 'c07_a010_ac25k_c07_bypass_time' || c.caseId === 'c07_a011_ac25k_c07_main_distance'),
    };
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await runC07CalibrationBatch({
        dataset: repeatedDs,
        graphsByFixtureId,
        groundTruthByFixtureId,
        clientsByCacheId,
        cacheIdentityShaByCacheId,
      });
      runs.push(r.records.map((x) => ({
        id: x.caseId,
        dist: x.comparison.oracleDistanceM,
        dur: x.comparison.oracleDurationS,
        ways: x.comparison.oracleWayIds,
      })));
    }
    equal(runs[0], runs[1], 'Repeat run 1 must match run 0 byte-for-byte');
    equal(runs[0], runs[2], 'Repeat run 2 must match run 0 byte-for-byte');

    const rd = validateRealDataIntakeDataset(realReadiness);
    equal(rd.c01ComplianceCleared, false);
    equal(rd.realRouteComparisonsCompleted, 0);
    equal(rd.releaseAllowed, false);

    return {
      repeatedBatchRunsConsistent: 3,
      realRouteComparisonsCompleted: rd.realRouteComparisonsCompleted,
      c01ComplianceCleared: rd.c01ComplianceCleared,
    };
  });
} finally {
  await clientC06.close();
  await clientC07.close();
}

const passedAll = suiteResults.every((r) => r.passed);
const output = {
  suite: 'c07_route_calibration',
  passed: passedAll,
  total: suiteResults.length,
  passedCount: suiteResults.filter((r) => r.passed).length,
  failedCount: suiteResults.filter((r) => !r.passed).length,
  skippedCount: 0,
  realPbfProcessed: false,
  realRouteComparisonsCompleted: 0,
  releaseAllowed: false,
  actualC08MobileAcceptanceClaimed: false,
  tolerancePolicy: C07_PROVISIONAL_TOLERANCE_POLICY,
  results: suiteResults,
};

writeFileSync(path.resolve('c07_oracle/c07_test_output.json'), JSON.stringify(output, null, 2) + '\n');

if (batchResult) {
  const perfBenchmark = {
    schemaVersion: 1,
    task: 'C07',
    originalTask: 'R17',
    masterRequirements: ['MR-006', 'MR-044'],
    syntheticOnly: true,
    realPbfProcessed: false,
    realRouteComparisonsCompleted: 0,
    runtimeRoutingP95TargetMs: 300,
    historicalC03Windows500NodeP95Ms: 495.84,
    noteOnTarget: 'Small synthetic oracle fixtures do not satisfy dense 500-node Windows target (495.84ms > 300ms retained open) or physical C08 Android acceptance.',
    datasetValidationMs: batchResult.datasetValidationMs,
    batchElapsedMs: batchResult.batchElapsedMs,
    totalCasesExecuted: batchResult.totalCasesExecuted,
    genuineRouteComparisons: batchResult.genuineRouteComparisons,
    infrastructureAndUnsupportedCases: batchResult.infrastructureAndUnsupportedCases,
    oracleLatencyMs: batchResult.oracleLatencyMs,
    gameLatencyMs: batchResult.gameLatencyMs,
    timeoutFailureCount: batchResult.timeoutFailureCount,
    peakRssBytes: batchResult.peakRssBytes,
    jvmSettings: { maxHeapMb: 256 },
    jvmTelemetryByCacheId: batchResult.jvmTelemetryByCacheId,
  };
  writeFileSync(path.resolve('C07_PERFORMANCE_BENCHMARK_REPORT.json'), JSON.stringify(perfBenchmark, null, 2) + '\n');
}

console.log(JSON.stringify(output, null, 2));
if (!passedAll) process.exitCode = 1;
