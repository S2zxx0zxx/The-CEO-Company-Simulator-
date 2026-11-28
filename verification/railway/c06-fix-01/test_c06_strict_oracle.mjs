import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const { findRouteAlternatives, profileHash, policyHash } = await import(pathToFileURL(path.resolve('src/rail/routing/index.ts')).href);
const {
  C06_COMPATIBILITY_MAPPING_MATRIX,
  C06_COMPARISON_TOLERANCES,
  C06_OPENRAILROUTING_PIN,
  StrictOracleClient,
  evaluateCrossRegionOracleJourney,
  runStrictOracleComparison,
  validateC07DatasetSchema,
  validateGameRouteIndependently,
  validateOracleResponseIndependently,
} = await import(pathToFileURL(path.resolve('src/rail/c06-oracle/index.ts')).href);
const {
  MemoryRegionStorageBackend,
  RegionInstallationManager,
} = await import(pathToFileURL(path.resolve('src/rail/regions/index.ts')).href);

function assert(cond, msg = '') {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}
function equal(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + ': ' : '') + sa + ' !== ' + sb);
}

const graphV1Json = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_graph_v1.json'), 'utf8'));
const graphV2Json = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_graph_v2.json'), 'utf8'));
const truthV1 = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_fixture_ground_truth.json'), 'utf8'));
const c02Audit = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_c02_metadata_audit.json'), 'utf8'));
const importMetrics = JSON.parse(readFileSync(path.resolve('c06_oracle/import_metrics.json'), 'utf8'));

const graphV1 = new RailGraph(graphV1Json);
const graphV2 = new RailGraph(graphV2Json);

const trainAc25k = {
  id: 'tr-c06-ac25k',
  traction: 'electric',
  gaugesMm: [1676],
  voltagesV: [25000],
  frequenciesHz: [50],
  maxSpeedKmh: 120,
  rangeM: 200000,
  massKg: 420000,
};
const trainAc15k167 = {
  id: 'tr-c06-ac15k-167',
  traction: 'electric',
  gaugesMm: [1676],
  voltagesV: [15000],
  frequenciesHz: [17],
  maxSpeedKmh: 140,
  rangeM: 200000,
  massKg: 400000,
};
const trainDc1500 = {
  id: 'tr-c06-dc1500',
  traction: 'electric',
  gaugesMm: [1676],
  voltagesV: [1500],
  frequenciesHz: [0],
  maxSpeedKmh: 100,
  rangeM: 200000,
  massKg: 380000,
};
const trainDc1500_WrongVolt25k = {
  id: 'tr-c06-25k-dc',
  traction: 'electric',
  gaugesMm: [1676],
  voltagesV: [25000],
  frequenciesHz: [0],
  maxSpeedKmh: 100,
  rangeM: 200000,
  massKg: 380000,
};
const trainDieselBroad = {
  id: 'tr-c06-diesel-1676',
  traction: 'diesel',
  gaugesMm: [1676],
  voltagesV: [],
  frequenciesHz: [],
  maxSpeedKmh: 100,
  rangeM: 200000,
  massKg: 130000,
};
const trainDiesel1435 = {
  id: 'tr-c06-diesel-1435',
  traction: 'diesel',
  gaugesMm: [1435],
  voltagesV: [],
  frequenciesHz: [],
  maxSpeedKmh: 100,
  rangeM: 200000,
  massKg: 130000,
};
const trainDieselNarrow1000 = {
  id: 'tr-c06-diesel-1000',
  traction: 'diesel',
  gaugesMm: [1000],
  voltagesV: [],
  frequenciesHz: [],
  maxSpeedKmh: 60,
  rangeM: 200000,
  massKg: 85000,
};
const trainDieselShortRange = {
  id: 'tr-c06-diesel-short',
  traction: 'diesel',
  gaugesMm: [1676],
  voltagesV: [],
  frequenciesHz: [],
  maxSpeedKmh: 100,
  rangeM: 5000,
  massKg: 110000,
};
const trainDual25k = {
  id: 'tr-c06-dual-25k',
  traction: 'dual',
  gaugesMm: [1676],
  voltagesV: [25000],
  frequenciesHz: [50],
  maxSpeedKmh: 100,
  rangeM: 200000,
  massKg: 390000,
};
const trainAmbiguousPower = {
  id: 'tr-c06-ambig',
  traction: 'electric',
  gaugesMm: [1676],
  voltagesV: [25000, 1500],
  frequenciesHz: [50, 0],
  maxSpeedKmh: 100,
  rangeM: 200000,
  massKg: 400000,
};

const policyStrictNoRev = { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [] };
const policyStrictRev = { schemaVersion: 1, mode: 'Realism', allowReversal: true, inferences: [], modeChanges: [] };
const policyStrictSwitchMix = {
  schemaVersion: 1,
  mode: 'Realism',
  allowReversal: false,
  inferences: [],
  modeChanges: [{ nodeId: 'n:106', penaltyS: 120 }],
};

const opAc25k = { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 };
const opDc1500 = { mode: 'electric', gaugeMm: 1676, voltageV: 1500, frequencyHz: 0 };
const opDieselBroad = { mode: 'diesel', gaugeMm: 1676, voltageV: null, frequencyHz: null };
const opDiesel1435 = { mode: 'diesel', gaugeMm: 1435, voltageV: null, frequencyHz: null };
const opDiesel1000 = { mode: 'diesel', gaugeMm: 1000, voltageV: null, frequencyHz: null };
const opAc167 = { mode: 'electric', gaugeMm: 1676, voltageV: 15000, frequencyHz: 17 };

const results = [];
const runCase = async (name, fn) => {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ case: name, passed: true, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, ...(detail || {}) });
  } catch (err) {
    results.push({ case: name, passed: false, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, error: String(err?.stack || err) });
  }
};

const client = new StrictOracleClient({
  strictCacheDir: path.resolve('c06_oracle/cache_strict'),
  upstreamCacheDir: path.resolve('c06_oracle/cache_upstream'),
});

const comparisons = [];
let perfReport = null;

try {
  // Warm up single persistent oracle process once (after capturing one-shot cold launch too)
  await runCase('c06_01_source_pin_import_and_c02_metadata_audit', async () => {
    equal(C06_OPENRAILROUTING_PIN.commit, 'e5112194fde4cc8ec36e2b0093e250df89ef4845');
    equal(C06_OPENRAILROUTING_PIN.licenseBlob, '5471dc10377b76db85a2feca7a99a7eef4980ba8');
    equal(C06_COMPATIBILITY_MAPPING_MATRIX.length, 18);
    assert(importMetrics.ok && importMetrics.graphNodes === 43 && importMetrics.graphEdges === 27);
    equal(c02Audit.discardedKeysStillPresentAfterC02, []);
    return {
      strictImportMs: importMetrics.strictImportDurationMs,
      upstreamImportMs: importMetrics.upstreamImportDurationMs,
      strictCacheBytes: importMetrics.strictCacheBytes,
      graphNodes: importMetrics.graphNodes,
      graphEdges: importMetrics.graphEdges,
    };
  });

  await runCase('c06_02_upstream_permissive_vs_strict_unknown_and_dc_resolution', async () => {
    // Demonstrate empirically with unmodified OpenRailRouting why raw upstream cannot distinguish unknown from DC or enforce strict R08
    const probeReq = async (id, stopA, stopB, upstreamProfile, engineMode) => ({
      requestId: id,
      engineMode,
      upstreamProfile,
      stops: [
        { stationId: stopA, lat: truthV1.stations[stopA].coordinates[1], lon: truthV1.stations[stopA].coordinates[0] },
        { stationId: stopB, lat: truthV1.stations[stopB].coordinates[1], lon: truthV1.stations[stopB].coordinates[0] },
      ],
      objective: 'time',
      allowReversal: false,
      train: trainAc25k,
      policy: policyStrictNoRev,
      expectedGraphSha256: graphV1.graphSha256,
      expectedProfileSha256: await profileHash(trainAc25k),
      expectedPolicySha256: await policyHash(policyStrictNoRev),
      actualGraphSha256: graphV1.graphSha256,
      actualProfileSha256: await profileHash(trainAc25k),
      actualPolicySha256: await policyHash(policyStrictNoRev),
      initialOperating: opAc25k,
    });

    // Upstream unmodified electric ALLOWS unknown frequency (w1008) because missing frequency == 0.0 == DC!
    const upUnkFreq = await client.query(await probeReq('up-unk-freq', 'st:110', 'st:111', 'upstream_electric', 'UPSTREAM_UNMODIFIED'));
    // Upstream unmodified ALLOWS access=private (w1013)!
    const upPriv = await client.query(await probeReq('up-priv', 'st:120', 'st:121', 'upstream_diesel', 'UPSTREAM_UNMODIFIED'));
    // Upstream unmodified diesel_1435 ALLOWS gauge == 0 unknown gauge (w1012)!
    const upUnkGauge = await client.query(await probeReq('up-unk-gauge', 'st:118', 'st:119', 'upstream_diesel_1435', 'UPSTREAM_UNMODIFIED'));

    equal(upUnkFreq.ok, true, 'Upstream unmodified falsely accepts missing frequency as DC');
    equal(upPriv.ok, true, 'Upstream unmodified falsely accepts access=private');
    equal(upUnkGauge.ok, true, 'Upstream unmodified diesel_1435 falsely accepts missing gauge');

    // Strict Oracle resolves KNOWN_DC (frequency=0, w1007) as valid for DC 1500V AND rejects missing frequency (w1008) EVEN FOR DC 1500V!
    const dcProfHash = await profileHash(trainDc1500);
    const polHash = await policyHash(policyStrictNoRev);
    const strictDcValid = await client.query({
      requestId: 'strict-dc-valid',
      engineMode: 'STRICT_ORACLE',
      stops: [
        { stationId: 'st:108', lat: truthV1.stations['st:108'].coordinates[1], lon: truthV1.stations['st:108'].coordinates[0] },
        { stationId: 'st:109', lat: truthV1.stations['st:109'].coordinates[1], lon: truthV1.stations['st:109'].coordinates[0] },
      ],
      objective: 'time',
      allowReversal: false,
      train: trainDc1500,
      policy: policyStrictNoRev,
      expectedGraphSha256: graphV1.graphSha256,
      expectedProfileSha256: dcProfHash,
      expectedPolicySha256: polHash,
      actualGraphSha256: graphV1.graphSha256,
      actualProfileSha256: dcProfHash,
      actualPolicySha256: polHash,
      initialOperating: opDc1500,
    });
    equal(strictDcValid.ok, true);
    equal(strictDcValid.edges[0].strictFreqState, 'known_dc');
    equal(strictDcValid.edges[0].strictFreqDhz, 0);

    const strictMissingFreqRejected = await client.query({
      requestId: 'strict-unk-freq-rejected',
      engineMode: 'STRICT_ORACLE',
      stops: [
        { stationId: 'st:110', lat: truthV1.stations['st:110'].coordinates[1], lon: truthV1.stations['st:110'].coordinates[0] },
        { stationId: 'st:111', lat: truthV1.stations['st:111'].coordinates[1], lon: truthV1.stations['st:111'].coordinates[0] },
      ],
      objective: 'time',
      allowReversal: false,
      train: trainDc1500,
      policy: policyStrictNoRev,
      expectedGraphSha256: graphV1.graphSha256,
      expectedProfileSha256: dcProfHash,
      expectedPolicySha256: polHash,
      actualGraphSha256: graphV1.graphSha256,
      actualProfileSha256: dcProfHash,
      actualPolicySha256: polHash,
      initialOperating: opDc1500,
    });
    equal(strictMissingFreqRejected.ok, false);

    return {
      upstreamFalseAcceptsProved: 3,
      strictDcKnownState: strictDcValid.edges[0].strictFreqState,
      strictUnknownFreqRejected: !strictMissingFreqRejected.ok,
    };
  });

  await runCase('c06_03_comprehensive_24_scenario_oracle_vs_game_comparison', async () => {
    const scenarios = [
      { caseId: '01_valid_ac_mainline', stopIds: ['st:101', 'st:102'], objective: 'distance', initialOperating: opAc25k, train: trainAc25k, policy: policyStrictNoRev, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '02_disconnected_island', stopIds: ['st:101', 'st:138'], objective: 'time', initialOperating: opAc25k, train: trainAc25k, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '03_wrong_gauge_1435_on_1676', stopIds: ['st:101', 'st:102'], objective: 'time', initialOperating: opDiesel1435, train: trainDiesel1435, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '04_narrow_gauge_1000_valid', stopIds: ['st:116', 'st:117'], objective: 'time', initialOperating: opDiesel1000, train: trainDieselNarrow1000, policy: policyStrictNoRev, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '05_unknown_gauge_rejected', stopIds: ['st:118', 'st:119'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '06_diesel_non_electrified_valid', stopIds: ['st:106', 'st:107'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '07_explicit_dc_valid', stopIds: ['st:108', 'st:109'], objective: 'time', initialOperating: opDc1500, train: trainDc1500, policy: policyStrictNoRev, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '08_unknown_frequency_rejected', stopIds: ['st:110', 'st:111'], objective: 'time', initialOperating: opDc1500, train: trainDc1500, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '09_missing_voltage_rejected', stopIds: ['st:112', 'st:113'], objective: 'time', initialOperating: opAc25k, train: trainAc25k, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '10_ac_frequency_mismatch', stopIds: ['st:143', 'st:144'], objective: 'time', initialOperating: opAc25k, train: trainAc25k, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '11_voltage_mismatch', stopIds: ['st:108', 'st:109'], objective: 'time', initialOperating: opAc25k, train: trainDc1500_WrongVolt25k, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '12_ambiguous_train_power_pairs', stopIds: ['st:101', 'st:102'], objective: 'time', initialOperating: opAc25k, train: trainAmbiguousPower, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '13_restricted_access_rejected', stopIds: ['st:120', 'st:121'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '14_unknown_access_rejected', stopIds: ['st:122', 'st:123'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '15_unknown_maxspeed_rejected', stopIds: ['st:124', 'st:125'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '16_inactive_track_rejected', stopIds: ['st:126', 'st:127'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '17_oneway_forward_valid', stopIds: ['st:128', 'st:129'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '18_oneway_backward_forbidden', stopIds: ['st:129', 'st:128'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '19_crossing_without_shared_node', stopIds: ['st:130', 'st:133'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '20_forbidden_acute_turn_no_rev', stopIds: ['st:134', 'st:136'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '21_headshunt_reversal_authorized', stopIds: ['st:134', 'st:136'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictRev, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '22_headshunt_reversal_unauthorized', stopIds: ['st:134', 'st:137', 'st:136'], objective: 'time', initialOperating: opDieselBroad, train: trainDieselBroad, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '23_mixed_traction_no_switch_rejected', stopIds: ['st:102', 'st:107'], objective: 'time', initialOperating: opAc25k, train: trainDual25k, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '24_mixed_traction_with_switch_valid', stopIds: ['st:102', 'st:107'], objective: 'time', initialOperating: opAc25k, train: trainDual25k, policy: policyStrictSwitchMix, expect: 'MATCH_VALID_ROUTE' },
      { caseId: '25_electrical_transition_ac_to_dc_forbidden', stopIds: ['st:101', 'st:105'], objective: 'time', initialOperating: opAc25k, train: trainAc25k, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '26_range_exceeded_rejected', stopIds: ['st:101', 'st:102'], objective: 'distance', initialOperating: opDieselBroad, train: trainDieselShortRange, policy: policyStrictNoRev, expect: 'MATCH_NO_VALID_ROUTE' },
      { caseId: '27_ambiguous_multi_node_station_valid', stopIds: ['st:multi', 'st:102'], objective: 'distance', initialOperating: opAc25k, train: trainAc25k, policy: policyStrictNoRev, expect: 'MATCH_VALID_ROUTE' },
    ];

    for (const sc of scenarios) {
      const rec = await runStrictOracleComparison(graphV1, truthV1, client, sc);
      comparisons.push(rec);
      assert(!rec.knownIncompatibleAccepted, `Known incompatible route accepted in ${sc.caseId}: ${rec.notes}`);
      equal(rec.discrepancyClass, sc.expect, `Mismatch on ${sc.caseId}: ${rec.notes}`);
    }

    // Verify alternative valid path discovery (w1001 vs parallel w1002 loop) is accepted & not misclassified
    const alts = await findRouteAlternatives(graphV1, {
      routeId: 'c06-alt-parallel',
      graphSha256: graphV1.graphSha256,
      trainProfileSha256: await profileHash(trainAc25k),
      policySha256: await policyHash(policyStrictNoRev),
      profile: trainAc25k,
      policy: policyStrictNoRev,
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      maxLabels: 10000,
      maxWork: 100000,
    }, 2);
    equal(alts.routes.length, 2, 'Parallel track loop yields 2 distinct valid routes');

    const knownIncompatibleAcceptedCount = comparisons.filter((c) => c.knownIncompatibleAccepted).length;
    equal(knownIncompatibleAcceptedCount, 0);

    return {
      totalScenarios: scenarios.length,
      knownIncompatibleAcceptedCount,
      discrepancyCounts: comparisons.reduce((acc, c) => {
        acc[c.discrepancyClass] = (acc[c.discrepancyClass] || 0) + 1;
        return acc;
      }, {}),
      parallelAlternativesFound: alts.routes.length,
    };
  });

  await runCase('c06_04_easy_isolation_stale_hashes_process_failure_and_timeout', async () => {
    const easyPolicy = {
      schemaVersion: 1,
      mode: 'Easy',
      allowReversal: false,
      inferences: [{ edgeId: 'e:1012:0:fwd', gaugeMm: 1676, electrification: null, voltageV: null, frequencyHz: null, maxSpeedKmh: null, reason: 'Synthetic Easy inference must stay isolated' }],
      modeChanges: [],
    };
    const easyComp = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'easy-isolation',
      stopIds: ['st:118', 'st:119'],
      objective: 'time',
      initialOperating: opDieselBroad,
      train: trainDieselBroad,
      policy: easyPolicy,
    });
    // Strict oracle rejects Easy mode BEFORE routing with STRICT_PROFILE_UNSUPPORTED while game Easy infers -> isolated!
    assert(easyComp.oracleOk === false && easyComp.oracleStatusCode.startsWith('STRICT_PROFILE_UNSUPPORTED'));
    equal(easyComp.discrepancyClass, 'STRICT_PROFILE_UNSUPPORTED');

    // Stale V2 graph hash vs V1 graph
    const staleGraph = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'stale-graph-v2',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      actualGraphSha256: graphV2.graphSha256,
    });
    assert(!staleGraph.oracleOk && staleGraph.oracleStatusCode.startsWith('STALE_GRAPH'));
    assert(!staleGraph.gameOk && staleGraph.gameCode.startsWith('STALE_GRAPH'));
    equal(staleGraph.discrepancyClass, 'STALE_IDENTITY');

    // Stale profile hash & policy hash
    const badHash = '0'.repeat(64);
    const staleProf = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'stale-profile',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      actualProfileSha256: badHash,
    });
    assert(!staleProf.oracleOk && staleProf.oracleStatusCode.startsWith('STALE_PROFILE'));
    equal(staleProf.discrepancyClass, 'STALE_IDENTITY');

    const stalePol = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'stale-policy',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      actualPolicySha256: badHash,
    });
    assert(!stalePol.oracleOk && stalePol.oracleStatusCode.startsWith('STALE_POLICY'));
    equal(stalePol.discrepancyClass, 'STALE_IDENTITY');

    // Malformed request (fewer than 2 stops)
    const malformed = await client.query({
      requestId: 'malformed-1-stop',
      engineMode: 'STRICT_ORACLE',
      stops: [{ stationId: 'st:101', lat: 12.1, lon: 42.1 }],
      objective: 'distance',
      allowReversal: false,
      train: trainAc25k,
      policy: policyStrictNoRev,
      expectedGraphSha256: graphV1.graphSha256,
      expectedProfileSha256: await profileHash(trainAc25k),
      expectedPolicySha256: await policyHash(policyStrictNoRev),
      actualGraphSha256: graphV1.graphSha256,
      actualProfileSha256: await profileHash(trainAc25k),
      actualPolicySha256: await policyHash(policyStrictNoRev),
      initialOperating: opAc25k,
    });
    equal(malformed.ok, false);
    equal(malformed.statusCode, 'INVALID_INPUT');

    // Oracle process failure (missing cache CLI run)
    const procFail = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'oracle-proc-fail',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      forceOracleMissingCache: true,
    });
    equal(procFail.discrepancyClass, 'ORACLE_EXECUTION_ERROR');

    // Genuine Java subprocess timeout -> SIGKILL & recovery for next query
    const timedOut = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'oracle-timeout',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      forceOracleTimeoutMs: 100,
    });
    equal(timedOut.discrepancyClass, 'ORACLE_EXECUTION_ERROR');
    assert(timedOut.oracleStatusCode.includes('ORACLE_TIMEOUT_EXCEEDED'));

    // Verify client cleanly restarts JVM after timeout kill on subsequent valid query
    const recoveredAfterKill = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'recovered-after-timeout',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
    });
    equal(recoveredAfterKill.discrepancyClass, 'MATCH_VALID_ROUTE');

    return {
      easyModeIsolated: true,
      staleChecksPassed: 3,
      malformedRejected: true,
      processFailureCaught: true,
      timeoutRecovered: true,
    };
  });

  await runCase('c06_05_independent_safety_validator_hazard_detection', async () => {
    // Feed intentionally poisoned/fabricated/discontinuous routes into Independent Safety Validator
    const disc = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:101', 'st:104'],
      steps: [
        { edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: opAc25k },
        { edgeId: 'e:1005:0:fwd', from: 'n:104', to: 'n:106', operating: opAc25k },
      ],
      train: trainAc25k,
      policy: policyStrictNoRev,
    });
    assert(!disc.valid && disc.hazards.includes('DISCONTINUOUS_PATH') && disc.hazards.includes('INVALID_ENDPOINT_SNAPPING'));

    const fabricated = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:101', 'st:102'],
      steps: [{ edgeId: 'e:999999:0:fwd', from: 'n:101', to: 'n:102', operating: opAc25k }],
      train: trainAc25k,
      policy: policyStrictNoRev,
    });
    assert(!fabricated.valid && fabricated.hazards.includes('FABRICATED_EDGE'));

    const privHazard = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:120', 'st:121'],
      steps: [{ edgeId: 'e:1013:0:fwd', from: 'n:120', to: 'n:121', operating: opDieselBroad }],
      train: trainDieselBroad,
      policy: policyStrictNoRev,
    });
    assert(!privHazard.valid && privHazard.hazards.includes('RESTRICTED_TRACK_ACCESS'));

    return { hazardsCaughtIndependently: true };
  });

  await runCase('c06_06_cross_region_c05_fix02_portal_continuity', async () => {
    const idxData = JSON.parse(readFileSync(path.resolve('fixtures/c05_regions/trusted_region_index.json'), 'utf8'));
    const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
    const installer = new RegionInstallationManager({ backend, authority: idxData.authority });
    const loadPkg = (slug) => {
      const dir = path.resolve('fixtures/c05_regions', slug);
      return {
        envelope: JSON.parse(readFileSync(path.join(dir, 'package_envelope.json'), 'utf8')),
        async getEntryBytes(rel) { return new Uint8Array(readFileSync(path.join(dir, rel))); },
      };
    };
    const rEast = await installer.installPackage(loadPkg('in_east_c05_v1'));
    assert(rEast.ok);
    const eastArts = await installer.openVersionArtifacts(rEast.versionKey);
    const stOrigin = eastArts.graph.snapshot().stations.find((s) => s.name === 'Eastside Origin');
    const c05Profile = { id: 'loco-e5', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 500000, massKg: 112000 };

    const missingDest = await evaluateCrossRegionOracleJourney(installer, {
      originStationId: stOrigin.id,
      destinationStationId: 'st:n:summit',
      profile: c05Profile,
      policy: policyStrictNoRev,
    });
    equal(missingDest.nativeMultiRegionOracleSupported, false);
    equal(missingDest.plan.ok, false);
    equal(missingDest.plan.portalResult.code, 'UNAVAILABLE_DESTINATION_REGION');

    const rNorth = await installer.installPackage(loadPkg('in_north_c05_v1'));
    assert(rNorth.ok);
    const northArts = await installer.openVersionArtifacts(rNorth.versionKey);
    const stSummit = northArts.graph.snapshot().stations.find((s) => s.name === 'Summit Terminal');

    const validCross = await evaluateCrossRegionOracleJourney(installer, {
      originStationId: stOrigin.id,
      destinationStationId: stSummit.id,
      profile: c05Profile,
      policy: policyStrictNoRev,
    });
    equal(validCross.nativeMultiRegionOracleSupported, false);
    equal(validCross.independentJavaSegmentVerificationExecuted, false);
    equal(validCross.verificationScope, 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY');
    equal(validCross.composedSegmentValidation, true);
    equal(validCross.fabricatedEdges, 0);
    equal(validCross.plan.ok, true);
    return {
      crossRegionDistanceM: validCross.plan.totalDistanceM,
      fabricatedEdges: 0,
      verificationScope: validCross.verificationScope,
    };
  });

  await runCase('c06_07_performance_benchmarks_and_c07_schema_preparation', async () => {
    // 1. One-shot cold JVM + cold query CLI measurement
    const tmpReqPath = path.resolve('c06_oracle/cold_req.json');
    writeFileSync(tmpReqPath, JSON.stringify({
      requestId: 'cold-cli-01',
      correlationNonce: 'cold-nonce-01',
      engineMode: 'STRICT_ORACLE',
      expectedGraphSha256: graphV1.graphSha256,
      actualGraphSha256: graphV1.graphSha256,
      stops: [
        { stationId: 'st:101', lat: truthV1.stations['st:101'].coordinates[1], lon: truthV1.stations['st:101'].coordinates[0] },
        { stationId: 'st:102', lat: truthV1.stations['st:102'].coordinates[1], lon: truthV1.stations['st:102'].coordinates[0] },
      ],
      objective: 'distance',
      allowReversal: false,
      train: trainAc25k,
    }));
    const coldCli = client.queryOnceCli(tmpReqPath);
    equal(coldCli.ok, true);

    // 2. 10x warm repeated queries for deterministic consistency + latency distribution
    const warmLatencies = [];
    const warmDistances = new Set();
    for (let i = 0; i < 10; i++) {
      const r = await runStrictOracleComparison(graphV1, truthV1, client, {
        caseId: `warm-consistency-${i}`,
        stopIds: ['st:101', 'st:104'],
        objective: 'time',
        initialOperating: opAc25k,
        train: trainAc25k,
        policy: policyStrictNoRev,
      });
      equal(r.discrepancyClass, 'MATCH_VALID_ROUTE');
      warmLatencies.push(r.oracleElapsedMs);
      warmDistances.add(r.oracleDistanceM);
    }
    equal(warmDistances.size, 1, 'Repeated oracle queries must be 100% deterministic');
    warmLatencies.sort((a, b) => a - b);

    // 3. C07 comparison dataset schema instantiation & validation (synthetic calibration only)
    const c07Template = {
      schemaVersion: 1,
      datasetId: 'C07-SYNTHETIC-CALIBRATION-V1',
      realDataUsed: false,
      c01ComplianceCleared: false,
      minimumRequiredRealCasesForC07: 100,
      syntheticOnly: true,
      cases: comparisons.slice(0, 10).map((c) => ({
        caseId: c.caseId,
        category: c.caseId.includes('valid') || c.caseId.includes('diesel') || c.caseId.includes('dc_valid') ? 'positive' : 'negative_power',
        dataProvenance: 'SYNTHETIC_C06',
        regionId: 'c06-synthetic-v1',
        graphSha256: graphV1.graphSha256,
        stopIds: ['st:101', 'st:102'],
        objective: 'time',
        allowReversal: false,
        trainProfileId: trainAc25k.id,
        expectedValid: c.oracleOk && c.gameOk,
        expectedGameCode: c.gameCode,
        expectedDiscrepancyClass: c.discrepancyClass,
        notes: 'Synthetic calibration entry for C07 schema readiness; NOT real Indian rail data.',
      })),
    };
    const validatedDs = validateC07DatasetSchema(c07Template);
    writeFileSync(path.resolve('fixtures/c06_oracle/c07_synthetic_calibration_template.json'), JSON.stringify(validatedDs, null, 2) + '\n');

    perfReport = {
      coldJvmLoadMs: coldCli.startupLoadMs,
      coldCliQueryMs: Math.round(coldCli.elapsedMs * 100) / 100,
      persistentJvmLoadMs: client.startupTelemetry?.startupLoadMs ?? null,
      jvmMaxHeapBytes: client.startupTelemetry?.jvmMaxHeapBytes ?? null,
      warmQueryP50Ms: warmLatencies[Math.floor(warmLatencies.length * 0.5)],
      warmQueryP95Ms: warmLatencies[Math.min(warmLatencies.length - 1, Math.ceil(warmLatencies.length * 0.95) - 1)],
      repeatedQueryDeterministic: true,
      c07TemplateCaseCount: validatedDs.cases.length,
    };
    return perfReport;
  });

  await runCase('c06_08_fix01_validator_traction_outcome_and_ipc_regressions', async () => {
    // Probe 1 (FIX-01-A): Game validator rejects skipped intermediate stop (A -> B when [A, C, B] requested)
    const gameSkippedStop = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:101', 'st:104', 'st:102'],
      steps: [{ edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: opAc25k }],
      train: trainAc25k,
      policy: policyStrictNoRev,
      initialOperating: opAc25k,
    });
    assert(!gameSkippedStop.valid && gameSkippedStop.hazards.includes('INVALID_ENDPOINT_SNAPPING'), 'Game validator must reject skipped intermediate stop');

    // Probe 2 (FIX-01-A): Game validator rejects wrong stop order / wrong destination (stops [101, 104, 102], path 101->102->104)
    const gameWrongOrder = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:101', 'st:104', 'st:102'],
      steps: [
        { edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: opAc25k },
        { edgeId: 'e:1003:0:fwd', from: 'n:102', to: 'n:104', operating: opAc25k },
      ],
      train: trainAc25k,
      policy: policyStrictNoRev,
      initialOperating: opAc25k,
    });
    assert(!gameWrongOrder.valid && gameWrongOrder.hazards.includes('INVALID_ENDPOINT_SNAPPING'), 'Game validator must reject misordered intermediate stop');

    // Probe 3 (FIX-01-A): Oracle validator rejects wrong destination edge with detached snapped waypoints claiming destination st:104
    const fakeDetachedWaypointsOracle = {
      requestId: 'probe-detached-wp',
      engineMode: 'STRICT_ORACLE',
      ok: true,
      statusCode: 'OK',
      distanceM: truthV1.edges['e:1001:0:fwd'].lengthM,
      durationS: 327,
      reversalCount: 0,
      snappedWaypoints: [
        { lat: truthV1.stations['st:101'].coordinates[1], lon: truthV1.stations['st:101'].coordinates[0] },
        { lat: truthV1.stations['st:104'].coordinates[1], lon: truthV1.stations['st:104'].coordinates[0] },
      ],
      edges: [
        {
          edgeKey: 8,
          edgeId: 4,
          osmWayId: 1001,
          baseNode: 3,
          adjNode: 34,
          distanceM: truthV1.edges['e:1001:0:fwd'].lengthM,
          upstreamGaugeMm: 1676,
          upstreamElectrified: 'contact_line',
          upstreamVoltageV: 25000,
          upstreamFrequencyHz: 50,
        },
      ],
      elapsedMs: 1,
    };
    const oracleDetached = validateOracleResponseIndependently(truthV1, {
      stopIds: ['st:101', 'st:104'],
      oracle: fakeDetachedWaypointsOracle,
      train: trainAc25k,
      policy: policyStrictNoRev,
      initialOperating: opAc25k,
    });
    assert(!oracleDetached.valid && oracleDetached.hazards.includes('INVALID_ENDPOINT_SNAPPING'), 'Oracle validator must bind endpoint anchors to actual traversed edge');

    // Probe 4 (FIX-01-A): Oracle validator rejects skipping/omitting intermediate stop C for [st:101, st:104, st:102]
    const oracleSkippedMid = validateOracleResponseIndependently(truthV1, {
      stopIds: ['st:101', 'st:104', 'st:102'],
      oracle: {
        ...fakeDetachedWaypointsOracle,
        snappedWaypoints: [
          { lat: truthV1.stations['st:101'].coordinates[1], lon: truthV1.stations['st:101'].coordinates[0] },
          { lat: truthV1.stations['st:104'].coordinates[1], lon: truthV1.stations['st:104'].coordinates[0] },
          { lat: truthV1.stations['st:102'].coordinates[1], lon: truthV1.stations['st:102'].coordinates[0] },
        ],
      },
      train: trainAc25k,
      policy: policyStrictNoRev,
      initialOperating: opAc25k,
    });
    assert(!oracleSkippedMid.valid && oracleSkippedMid.hazards.includes('INVALID_ENDPOINT_SNAPPING'), 'Oracle validator must reject skipped intermediate stop');

    // Probe 5 (FIX-01-B): Electric-only train running diesel operating mode MUST fail closed
    const dieselOnElectric = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:101', 'st:102'],
      steps: [{ edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: opDieselBroad }],
      train: trainAc25k,
      policy: policyStrictNoRev,
      initialOperating: opDieselBroad,
    });
    assert(!dieselOnElectric.valid && dieselOnElectric.hazards.includes('INVALID_ELECTRICAL_SYSTEM'), 'Electric-only train must reject diesel operating mode');

    // Probe 6 (FIX-01-C): Infrastructure/identity/exhaustion outcomes NEVER classify as MATCH_NO_VALID_ROUTE
    const fakeStaleClient = {
      async query(req) {
        return {
          requestId: req.requestId,
          engineMode: 'STRICT_ORACLE',
          ok: false,
          statusCode: 'STALE_GRAPH',
          reason: 'SYNTHETIC_STALE_GRAPH_IPC_PROBE',
          elapsedMs: 1,
        };
      },
    };
    const staleHarnessRes = await runStrictOracleComparison(graphV1, truthV1, fakeStaleClient, {
      caseId: 'fix01-c-stale-both',
      stopIds: ['st:101', 'st:102'],
      objective: 'distance',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      actualGraphSha256: graphV2.graphSha256,
    });
    equal(staleHarnessRes.discrepancyClass, 'STALE_IDENTITY');

    const exhaustHarnessRes = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'fix01-c-search-exhaustion',
      stopIds: ['st:101', 'st:104'],
      objective: 'time',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
      maxLabels: 1,
    });
    equal(exhaustHarnessRes.discrepancyClass, 'SEARCH_EXHAUSTION');

    // Probe 7 (Live Java cache identity + IPC correlation): Java itself rejects mismatched cache identity over live IPC
    const javaStaleResp = await client.query({
      requestId: 'java-live-cache-mismatch',
      correlationNonce: 'nonce-live-mismatch-01',
      engineMode: 'STRICT_ORACLE',
      stops: [
        { stationId: 'st:101', lat: truthV1.stations['st:101'].coordinates[1], lon: truthV1.stations['st:101'].coordinates[0] },
        { stationId: 'st:102', lat: truthV1.stations['st:102'].coordinates[1], lon: truthV1.stations['st:102'].coordinates[0] },
      ],
      objective: 'distance',
      allowReversal: false,
      train: trainAc25k,
      policy: policyStrictNoRev,
      expectedGraphSha256: graphV2.graphSha256,
      expectedProfileSha256: await profileHash(trainAc25k),
      expectedPolicySha256: await policyHash(policyStrictNoRev),
      actualGraphSha256: graphV2.graphSha256,
      actualProfileSha256: await profileHash(trainAc25k),
      actualPolicySha256: await policyHash(policyStrictNoRev),
      initialOperating: opAc25k,
    });
    equal(javaStaleResp.ok, false);
    equal(javaStaleResp.statusCode, 'STALE_GRAPH');
    equal(javaStaleResp.loadedGraphSha256, graphV1.graphSha256);
    equal(javaStaleResp.correlationNonce, 'nonce-live-mismatch-01');

    // Two Valid Controls: multi-stop ordered AC route [st:101, st:102, st:104] passes BOTH validators!
    const validGameMulti = validateGameRouteIndependently(truthV1, {
      stopIds: ['st:101', 'st:102', 'st:104'],
      steps: [
        { edgeId: 'e:1001:0:fwd', from: 'n:101', to: 'n:102', operating: opAc25k },
        { edgeId: 'e:1003:0:fwd', from: 'n:102', to: 'n:104', operating: opAc25k },
      ],
      train: trainAc25k,
      policy: policyStrictNoRev,
      initialOperating: opAc25k,
    });
    equal(validGameMulti.valid, true);

    const validLiveMulti = await runStrictOracleComparison(graphV1, truthV1, client, {
      caseId: 'fix01-valid-multi-stop-control',
      stopIds: ['st:101', 'st:102', 'st:104'],
      objective: 'time',
      initialOperating: opAc25k,
      train: trainAc25k,
      policy: policyStrictNoRev,
    });
    equal(validLiveMulti.discrepancyClass, 'MATCH_VALID_ROUTE');
    equal(validLiveMulti.oracleSafety.valid, true);
    equal(validLiveMulti.gameSafety.valid, true);

    return {
      negativeProbesRejected: 7,
      validControlsPassed: 2,
      javaCacheIdentityBoundSha256: javaStaleResp.loadedGraphSha256,
    };
  });
} finally {
  await client.close();
}

const passedAll = results.every((r) => r.passed);
const output = {
  suite: 'c06_strict_routing_oracle',
  passed: passedAll,
  total: results.length,
  passedCount: results.filter((r) => r.passed).length,
  failedCount: results.filter((r) => !r.passed).length,
  skippedCount: 0,
  realPbfProcessed: false,
  knownIncompatibleAcceptedCount: comparisons.filter((c) => c.knownIncompatibleAccepted).length,
  tolerances: C06_COMPARISON_TOLERANCES,
  openRailRoutingPin: C06_OPENRAILROUTING_PIN,
  perfReport,
  results,
  comparisonMatrixSummary: comparisons.map((c) => ({
    caseId: c.caseId,
    discrepancyClass: c.discrepancyClass,
    oracleOk: c.oracleOk,
    gameOk: c.gameOk,
    oracleDistanceM: c.oracleDistanceM,
    gameDistanceM: c.gameDistanceM,
    oracleDurationS: c.oracleDurationS,
    gameDurationS: c.gameDurationS,
    oracleElapsedMs: c.oracleElapsedMs,
    gameElapsedMs: c.gameElapsedMs,
  })),
};
writeFileSync(path.resolve('c06_oracle/c06_test_output.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
if (!passedAll) process.exitCode = 1;
