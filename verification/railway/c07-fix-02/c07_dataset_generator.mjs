import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const { policyHash, profileHash } = await import(pathToFileURL(path.resolve('src/rail/routing/index.ts')).href);
const {
  C07_PROVISIONAL_TOLERANCE_POLICY,
  buildTrustedFixtureProvenance,
  computeSemanticRequestIdentity,
  sha256HexString,
  validateC07CalibrationDataset,
  validateRealDataIntakeDataset,
} = await import(pathToFileURL(path.resolve('src/rail/c07-calibration/index.ts')).href);

const DATASET_ID = 'C07-SYNTHETIC-CALIBRATION-V2';
const DATASET_VERSION = '2.0.0';

const c06GraphRaw = readFileSync(path.resolve('fixtures/c06_oracle/c06_graph_v1.json'), 'utf8');
const c06GraphV2Raw = readFileSync(path.resolve('fixtures/c06_oracle/c06_graph_v2.json'), 'utf8');
const c06Truth = JSON.parse(readFileSync(path.resolve('fixtures/c06_oracle/c06_fixture_ground_truth.json'), 'utf8'));
const c06CacheId = JSON.parse(readFileSync(path.resolve('c06_oracle/cache_strict/c06_cache_identity.json'), 'utf8'));
const c06Graph = new RailGraph(JSON.parse(c06GraphRaw));
const c06GraphV2 = JSON.parse(c06GraphV2Raw);

const c07GraphRaw = readFileSync(path.resolve('fixtures/c07_calibration/c07_graph_v1.json'), 'utf8');
const c07GraphV2Raw = readFileSync(path.resolve('fixtures/c07_calibration/c07_graph_v2.json'), 'utf8');
const c07Truth = JSON.parse(readFileSync(path.resolve('fixtures/c07_calibration/c07_fixture_ground_truth.json'), 'utf8'));
const c07CacheId = JSON.parse(readFileSync(path.resolve('c07_oracle/cache_strict/c06_cache_identity.json'), 'utf8'));
const c07Graph = new RailGraph(JSON.parse(c07GraphRaw));
const c07GraphV2 = JSON.parse(c07GraphV2Raw);

const jarSha256 = sha256HexString('jar-placeholder-replaced-below');
void jarSha256;
import { createHash } from 'node:crypto';
const actualJarSha256 = createHash('sha256').update(readFileSync(path.resolve('c06_oracle/java/c06-strict-oracle.jar'))).digest('hex');

const fixtures = {
  'c06-synthetic-v1': {
    dataProvenance: 'SYNTHETIC_C06',
    sourceUrl: 'https://synthetic.railway-ceo.local/c06-oracle-v1',
    sourceVersion: '1.0.0',
    license: 'Synthetic-QA-Only',
    regionVersion: 'c06-synthetic-v1@1.0.0',
    oracleCacheId: 'c06-strict-cache',
    oracleCacheSha256: createHash('sha256').update(readFileSync(path.resolve('c06_oracle/cache_strict/c06_cache_identity.json'))).digest('hex'),
    graphSha256: c06Graph.graphSha256,
    sourceFixtureSha256: createHash('sha256').update(c06GraphRaw).digest('hex'),
    graph: c06Graph,
    truth: c06Truth,
    cacheIdentity: c06CacheId,
  },
  'c07-corridor-v1': {
    dataProvenance: 'SYNTHETIC_C07',
    sourceUrl: 'https://synthetic.railway-ceo.local/c07-corridor-v1',
    sourceVersion: '1.0.0',
    license: 'Synthetic-QA-Only',
    regionVersion: 'c07-corridor-v1@1.0.0',
    oracleCacheId: 'c07-strict-cache',
    oracleCacheSha256: createHash('sha256').update(readFileSync(path.resolve('c07_oracle/cache_strict/c06_cache_identity.json'))).digest('hex'),
    graphSha256: c07Graph.graphSha256,
    sourceFixtureSha256: createHash('sha256').update(c07GraphRaw).digest('hex'),
    graph: c07Graph,
    truth: c07Truth,
    cacheIdentity: c07CacheId,
  },
};

const profiles = {
  'tr-c07-ac25k-1676': { id: 'tr-c07-ac25k-1676', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 200000, massKg: 420000 },
  'tr-c07-ac25k-1676-fast': { id: 'tr-c07-ac25k-1676-fast', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 160, rangeM: 200000, massKg: 410000 },
  'tr-c07-ac25k-1676-slow': { id: 'tr-c07-ac25k-1676-slow', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 80, rangeM: 200000, massKg: 440000 },
  'tr-c07-ac25k-1676-short': { id: 'tr-c07-ac25k-1676-short', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 15000, massKg: 400000 },
  'tr-c07-ac25k-1676-midrange': { id: 'tr-c07-ac25k-1676-midrange', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 35000, massKg: 400000 },
  'tr-c07-ac25k-1435': { id: 'tr-c07-ac25k-1435', traction: 'electric', gaugesMm: [1435], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 140, rangeM: 200000, massKg: 360000 },
  'tr-c07-ac15k17-1676': { id: 'tr-c07-ac15k17-1676', traction: 'electric', gaugesMm: [1676], voltagesV: [15000], frequenciesHz: [17], maxSpeedKmh: 140, rangeM: 200000, massKg: 400000 },
  'tr-c07-dc1500-1676': { id: 'tr-c07-dc1500-1676', traction: 'electric', gaugesMm: [1676], voltagesV: [1500], frequenciesHz: [0], maxSpeedKmh: 100, rangeM: 200000, massKg: 380000 },
  'tr-c07-dc750-1435': { id: 'tr-c07-dc750-1435', traction: 'electric', gaugesMm: [1435], voltagesV: [750], frequenciesHz: [0], maxSpeedKmh: 80, rangeM: 200000, massKg: 280000 },
  'tr-c07-dc3000-1435': { id: 'tr-c07-dc3000-1435', traction: 'electric', gaugesMm: [1435], voltagesV: [3000], frequenciesHz: [0], maxSpeedKmh: 100, rangeM: 200000, massKg: 320000 },
  'tr-c07-dc25k-1676': { id: 'tr-c07-dc25k-1676', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [0], maxSpeedKmh: 100, rangeM: 200000, massKg: 380000 },
  'tr-c07-ac1500-1676': { id: 'tr-c07-ac1500-1676', traction: 'electric', gaugesMm: [1676], voltagesV: [1500], frequenciesHz: [50], maxSpeedKmh: 100, rangeM: 200000, massKg: 380000 },
  'tr-c07-ambig-1676': { id: 'tr-c07-ambig-1676', traction: 'electric', gaugesMm: [1676], voltagesV: [25000, 1500], frequenciesHz: [50, 0], maxSpeedKmh: 100, rangeM: 200000, massKg: 400000 },
  'tr-c07-diesel-1676': { id: 'tr-c07-diesel-1676', traction: 'diesel', gaugesMm: [1676], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 100, rangeM: 200000, massKg: 130000 },
  'tr-c07-diesel-1676-short': { id: 'tr-c07-diesel-1676-short', traction: 'diesel', gaugesMm: [1676], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 100, rangeM: 5000, massKg: 110000 },
  'tr-c07-diesel-1435': { id: 'tr-c07-diesel-1435', traction: 'diesel', gaugesMm: [1435], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 100, rangeM: 200000, massKg: 120000 },
  'tr-c07-diesel-1435-fast': { id: 'tr-c07-diesel-1435-fast', traction: 'diesel', gaugesMm: [1435], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 140, rangeM: 200000, massKg: 125000 },
  'tr-c07-diesel-1000': { id: 'tr-c07-diesel-1000', traction: 'diesel', gaugesMm: [1000], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 60, rangeM: 200000, massKg: 85000 },
  'tr-c07-steam-1676': { id: 'tr-c07-steam-1676', traction: 'steam', gaugesMm: [1676], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 75, rangeM: 150000, massKg: 145000 },
  'tr-c07-steam-1435': { id: 'tr-c07-steam-1435', traction: 'steam', gaugesMm: [1435], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 75, rangeM: 150000, massKg: 140000 },
  'tr-c07-steam-1000': { id: 'tr-c07-steam-1000', traction: 'steam', gaugesMm: [1000], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 50, rangeM: 150000, massKg: 75000 },
  'tr-c07-dual-25k-1676': { id: 'tr-c07-dual-25k-1676', traction: 'dual', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 100, rangeM: 200000, massKg: 390000 },
  'tr-c07-dual-dc1500-1676': { id: 'tr-c07-dual-dc1500-1676', traction: 'dual', gaugesMm: [1676], voltagesV: [1500], frequenciesHz: [0], maxSpeedKmh: 90, rangeM: 200000, massKg: 375000 },
};

const policies = {
  'pol-strict-no-rev': { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [] },
  'pol-strict-rev': { schemaVersion: 1, mode: 'Realism', allowReversal: true, inferences: [], modeChanges: [] },
  'pol-strict-switch-n106': { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [{ nodeId: 'n:106', penaltyS: 120 }] },
  'pol-strict-switch-n224': { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [{ nodeId: 'n:224', penaltyS: 90 }] },
  'pol-easy-isolated': {
    schemaVersion: 1,
    mode: 'Easy',
    allowReversal: false,
    inferences: [{ edgeId: 'e:1012:0:fwd', gaugeMm: 1676, electrification: null, voltageV: null, frequencyHz: null, maxSpeedKmh: null, reason: 'Synthetic Easy inference must remain isolated from strict oracle' }],
    modeChanges: [],
  },
};

const profileHashes = {};
for (const [k, v] of Object.entries(profiles)) profileHashes[k] = await profileHash(v);
const policyHashes = {};
for (const [k, v] of Object.entries(policies)) policyHashes[k] = await policyHash(v);

const opAc25k = { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 };
const opAc25k1435 = { mode: 'electric', gaugeMm: 1435, voltageV: 25000, frequencyHz: 50 };
const opAc167 = { mode: 'electric', gaugeMm: 1676, voltageV: 15000, frequencyHz: 17 };
const opDc1500 = { mode: 'electric', gaugeMm: 1676, voltageV: 1500, frequencyHz: 0 };
const opDc750_1435 = { mode: 'electric', gaugeMm: 1435, voltageV: 750, frequencyHz: 0 };
const opDc3000_1435 = { mode: 'electric', gaugeMm: 1435, voltageV: 3000, frequencyHz: 0 };
const opDc25k = { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 0 };
const opAc1500 = { mode: 'electric', gaugeMm: 1676, voltageV: 1500, frequencyHz: 50 };
const opDiesel1676 = { mode: 'diesel', gaugeMm: 1676, voltageV: null, frequencyHz: null };
const opDiesel1435 = { mode: 'diesel', gaugeMm: 1435, voltageV: null, frequencyHz: null };
const opDiesel1000 = { mode: 'diesel', gaugeMm: 1000, voltageV: null, frequencyHz: null };
const opSteam1676 = { mode: 'steam', gaugeMm: 1676, voltageV: null, frequencyHz: null };
const opSteam1435 = { mode: 'steam', gaugeMm: 1435, voltageV: null, frequencyHz: null };
const opSteam1000 = { mode: 'steam', gaugeMm: 1000, voltageV: null, frequencyHz: null };

function makeCase(cfg) {
  const fx = fixtures[cfg.fixtureId];
  const pol = policies[cfg.policyId];
  const anchorMap = {};
  for (const sid of cfg.stopIds) {
    const st = fx.truth.stations[sid];
    if (st) anchorMap[sid] = st.nodeIds;
  }
  const capability = cfg.requiredOracleCapability ?? 'STRICT_SINGLE_GRAPH';
  const expectedConstraints = {
    rationale: cfg.rationale,
    constraintCodes: cfg.constraintCodes,
    ...(cfg.expectedWayIds ? { expectedWayIds: cfg.expectedWayIds } : {}),
    ...(cfg.alternativeCount ? { alternativeCount: cfg.alternativeCount } : {}),
  };
  const semanticRequestId = computeSemanticRequestIdentity({
    fixtureId: cfg.fixtureId,
    graphSha256: fx.graphSha256,
    stopIds: cfg.stopIds,
    objective: cfg.objective,
    allowReversal: pol.allowReversal,
    trainProfileId: cfg.trainProfileId,
    profileSha256: profileHashes[cfg.trainProfileId],
    policyId: cfg.policyId,
    policySha256: policyHashes[cfg.policyId],
    initialOperating: cfg.initialOperating,
    requiredOracleCapability: capability,
    alternativeCount: cfg.alternativeCount,
    probeSpec: cfg.probeSpec,
  });

  return {
    datasetId: DATASET_ID,
    datasetVersion: DATASET_VERSION,
    caseId: cfg.caseId,
    semanticRequestId,
    category: cfg.category,
    subcategory: cfg.subcategory,
    fixtureId: cfg.fixtureId,
    dataProvenance: fx.dataProvenance,
    sourceUrl: fx.sourceUrl,
    sourceVersion: fx.sourceVersion,
    license: fx.license,
    syntheticOnly: true,
    dataClass: 'SYNTHETIC',
    graphSha256: fx.graphSha256,
    sourceFixtureSha256: fx.sourceFixtureSha256,
    regionVersion: fx.regionVersion,
    oracleCacheId: fx.oracleCacheId,
    oracleCacheSha256: fx.oracleCacheSha256,
    originStationId: cfg.stopIds[0],
    destinationStationId: cfg.stopIds[cfg.stopIds.length - 1],
    intermediateStopIds: cfg.stopIds.length > 2 ? cfg.stopIds.slice(1, -1) : [],
    stopIds: cfg.stopIds,
    stationAnchorNodeIds: anchorMap,
    trainProfileId: cfg.trainProfileId,
    profileSha256: profileHashes[cfg.trainProfileId],
    policyId: cfg.policyId,
    policySha256: policyHashes[cfg.policyId],
    initialOperating: cfg.initialOperating,
    objective: cfg.objective,
    allowReversal: pol.allowReversal,
    expectedValid: cfg.expectedValid,
    expectedOutcome: cfg.expectedOutcome,
    expectedDiscrepancyClass: cfg.expectedDiscrepancyClass,
    expectedGameCodePrefix: cfg.expectedGameCodePrefix,
    expectedOracleStatusPrefix: cfg.expectedOracleStatusPrefix,
    expectedIncompatibilityReason: cfg.expectedIncompatibilityReason ?? null,
    expectedConstraints,
    requiredOracleCapability: capability,
    tolerancePolicy: C07_PROVISIONAL_TOLERANCE_POLICY,
    ...(cfg.probeSpec ? { probeSpec: cfg.probeSpec } : {}),
  };
}

const rawCases = [];
const add = (c) => rawCases.push(makeCase(c));

// ===========================================================================
// CATEGORY A — POSITIVE RAILWAY ROUTES (45 distinct scenarios)
// ===========================================================================
const addPos = (caseId, subcategory, fixtureId, stopIds, objective, trainProfileId, policyId, initialOperating, rationale, extra = {}) =>
  add({
    caseId,
    category: 'A_POSITIVE_ROUTE',
    subcategory,
    fixtureId,
    stopIds,
    objective,
    trainProfileId,
    policyId,
    initialOperating,
    expectedValid: true,
    expectedOutcome: 'VALID_ROUTE',
    expectedDiscrepancyClass: 'MATCH_VALID_ROUTE',
    expectedGameCodePrefix: 'OK',
    expectedOracleStatusPrefix: 'OK',
    expectedIncompatibilityReason: null,
    rationale,
    constraintCodes: extra.constraintCodes ?? ['POSITIVE_VALID_ROUTE'],
    requiredOracleCapability: extra.capability ?? 'STRICT_SINGLE_GRAPH',
    alternativeCount: extra.alternativeCount,
  });

// Migrated & properly bound template positive cases + broad gauge AC 25kV 50Hz
addPos('c07_a001_ac25k_mainline_dist', 'ac_25kv_broad', 'c06-synthetic-v1', ['st:101', 'st:102'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'Migrated baseline 01: direct 25kV 50Hz AC mainline shortest distance');
addPos('c07_a002_ac25k_mainline_time', 'ac_25kv_broad', 'c06-synthetic-v1', ['st:101', 'st:102'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, '25kV 50Hz AC mainline fastest path (120 km/h direct beats 100 km/h loop)');
addPos('c07_a003_ac25k_mainline_rev_dir', 'ac_25kv_broad', 'c06-synthetic-v1', ['st:102', 'st:101'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'Bidirectional 25kV AC corridor backward orientation');
addPos('c07_a004_ac25k_slow_loco_speed_cap', 'ac_25kv_broad', 'c06-synthetic-v1', ['st:101', 'st:104'], 'time', 'tr-c07-ac25k-1676-slow', 'pol-strict-no-rev', opAc25k, 'Train speed cap (80 km/h) overrides higher track speed (120 km/h)');
addPos('c07_a005_ac25k_multi_stop_3', 'multi_stop', 'c06-synthetic-v1', ['st:101', 'st:102', 'st:104'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'Ordered 3-stop broad-gauge 25kV journey');
addPos('c07_a006_ac25k_multi_stop_4', 'multi_stop', 'c06-synthetic-v1', ['st:101', 'st:102', 'st:104', 'st:106'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'Ordered 4-stop broad-gauge 25kV trunk journey');
addPos('c07_a007_ac25k_multinode_st_multi', 'multi_stop', 'c06-synthetic-v1', ['st:multi', 'st:102'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'Multi-node station st:multi anchors via n:140 on 1676mm 25kV edge');
addPos('c07_a008_ac25k_multinode_3stop', 'multi_stop', 'c06-synthetic-v1', ['st:multi', 'st:101', 'st:102'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, '3-stop multi-node origin through st:101 to st:102');
addPos('c07_a009_ac25k_c07_3stop_dist', 'ac_25kv_broad', 'c07-corridor-v1', ['st:201', 'st:202', 'st:203'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'C07 corridor distance-preferred intermediate corridor');
addPos('c07_a010_ac25k_c07_bypass_time', 'ac_25kv_broad', 'c07-corridor-v1', ['st:201', 'st:203'], 'time', 'tr-c07-ac25k-1676-fast', 'pol-strict-no-rev', opAc25k, '160 km/h high-speed bypass (w2005) beats shorter 60 km/h mainline on time objective');
addPos('c07_a011_ac25k_c07_main_distance', 'ac_25kv_broad', 'c07-corridor-v1', ['st:201', 'st:203'], 'distance', 'tr-c07-ac25k-1676-fast', 'pol-strict-no-rev', opAc25k, 'Shorter 60 km/h mainline (w2001+w2002) beats high-speed bypass on distance objective');
addPos('c07_a012_ac25k_c07_4stop', 'multi_stop', 'c07-corridor-v1', ['st:201', 'st:203', 'st:204', 'st:205'], 'time', 'tr-c07-ac25k-1676-fast', 'pol-strict-no-rev', opAc25k, 'Ordered 4-stop C07 25kV AC trunk run using bypass + fast east main');
addPos('c07_a013_ac25k_c07_reverse_5stop', 'multi_stop', 'c07-corridor-v1', ['st:205', 'st:204', 'st:203', 'st:202', 'st:201'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, '5-stop full west-bound broad-gauge mainline');

// Parallel alternatives
addPos('c07_a014_parallel_c06_25k_alts', 'parallel_alternatives', 'c06-synthetic-v1', ['st:101', 'st:102'], 'distance', 'tr-c07-ac25k-1676-fast', 'pol-strict-no-rev', opAc25k, 'Verify 2 parallel 25kV tracks (w1001 & w1002) in findRouteAlternatives', { constraintCodes: ['POSITIVE_VALID_ROUTE', 'PARALLEL_ALTERNATIVES_2'], capability: 'ALTERNATIVES', alternativeCount: 2 });
addPos('c07_a015_parallel_c07_1435_alts', 'parallel_alternatives', 'c07-corridor-v1', ['st:210', 'st:211'], 'time', 'tr-c07-ac25k-1435', 'pol-strict-no-rev', opAc25k1435, 'Verify 2 parallel 1435mm standard-gauge 25kV tracks (w2010 & w2014)', { constraintCodes: ['POSITIVE_VALID_ROUTE', 'PARALLEL_ALTERNATIVES_2'], capability: 'ALTERNATIVES', alternativeCount: 2 });
addPos('c07_a016_parallel_c07_3paths_alts', 'parallel_alternatives', 'c07-corridor-v1', ['st:201', 'st:203'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'Verify 3 parallel routes between st:201 and st:203 (bypass, mainline, branch)', { constraintCodes: ['POSITIVE_VALID_ROUTE', 'PARALLEL_ALTERNATIVES_3'], capability: 'ALTERNATIVES', alternativeCount: 3 });

// Explicit AC 15kV 17Hz (discovers genuine 16.7Hz dHz=167 vs integer 17Hz quantization mismatch!) & DC 1500V/750V/3000V
add({
  caseId: 'c07_a017_ac15k17_fwd',
  category: 'A_POSITIVE_ROUTE',
  subcategory: 'ac_15kv_17hz',
  fixtureId: 'c06-synthetic-v1',
  stopIds: ['st:143', 'st:144'],
  objective: 'time',
  trainProfileId: 'tr-c07-ac15k17-1676',
  policyId: 'pol-strict-no-rev',
  initialOperating: opAc167,
  expectedValid: false,
  expectedOutcome: 'CALIBRATION_DISCREPANCY',
  expectedDiscrepancyClass: 'ORACLE_FALSE_REJECT',
  expectedGameCodePrefix: 'OK',
  expectedOracleStatusPrefix: 'NO_ROUTE',
  expectedIncompatibilityReason: 'QUANTIZATION_16_7HZ_VS_17HZ',
  rationale: 'Calibration discovery: R08 integer hertz(17) accepts way 1026 (frequencyHz:[17]), while Java StrictFreqParser stores exact deci-Hz 167 (16.7Hz) so 170 dHz misses 167 dHz',
  constraintCodes: ['CALIBRATION_DISCREPANCY_16_7HZ'],
  requiredOracleCapability: 'STRICT_SINGLE_GRAPH',
});
add({
  caseId: 'c07_a018_ac15k17_bwd',
  category: 'A_POSITIVE_ROUTE',
  subcategory: 'ac_15kv_17hz',
  fixtureId: 'c06-synthetic-v1',
  stopIds: ['st:144', 'st:143'],
  objective: 'distance',
  trainProfileId: 'tr-c07-ac15k17-1676',
  policyId: 'pol-strict-no-rev',
  initialOperating: opAc167,
  expectedValid: false,
  expectedOutcome: 'CALIBRATION_DISCREPANCY',
  expectedDiscrepancyClass: 'ORACLE_FALSE_REJECT',
  expectedGameCodePrefix: 'OK',
  expectedOracleStatusPrefix: 'NO_ROUTE',
  expectedIncompatibilityReason: 'QUANTIZATION_16_7HZ_VS_17HZ',
  rationale: 'Reverse 16.7Hz vs integer 17Hz quantization calibration discrepancy',
  constraintCodes: ['CALIBRATION_DISCREPANCY_16_7HZ'],
  requiredOracleCapability: 'STRICT_SINGLE_GRAPH',
});
addPos('c07_a019_dc1500_c06_valid', 'dc_explicit', 'c06-synthetic-v1', ['st:108', 'st:109'], 'time', 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'Migrated baseline 07: explicit frequency=0 DC 1500V route');
addPos('c07_a020_dc1500_c06_rev', 'dc_explicit', 'c06-synthetic-v1', ['st:109', 'st:108'], 'distance', 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'Explicit DC 1500V reverse direction');
addPos('c07_a021_dc1500_c06_east_d', 'dc_explicit', 'c06-synthetic-v1', ['st:102', 'st:105'], 'time', 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'Explicit DC 1500V branch corridor w1004');
addPos('c07_a022_dc1500_c07_branch', 'dc_explicit', 'c07-corridor-v1', ['st:205', 'st:224'], 'time', 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'C07 corridor explicit DC 1500V segment w2023');

// Standard Gauge (1435mm) positive routes
addPos('c07_a023_sg1435_ac25k_fwd', 'standard_gauge', 'c07-corridor-v1', ['st:210', 'st:211'], 'distance', 'tr-c07-ac25k-1435', 'pol-strict-no-rev', opAc25k1435, 'Standard-gauge 1435mm 25kV 50Hz AC valid route');
addPos('c07_a024_sg1435_dc750_fwd', 'standard_gauge', 'c07-corridor-v1', ['st:211', 'st:212'], 'time', 'tr-c07-dc750-1435', 'pol-strict-no-rev', opDc750_1435, 'Standard-gauge 1435mm third-rail 750V DC valid route');
addPos('c07_a025_sg1435_dc3000_fwd', 'standard_gauge', 'c07-corridor-v1', ['st:211', 'st:214'], 'time', 'tr-c07-dc3000-1435', 'pol-strict-no-rev', opDc3000_1435, 'Standard-gauge 1435mm 3000V DC valid route');
addPos('c07_a026_sg1435_diesel_nonelec', 'standard_gauge', 'c07-corridor-v1', ['st:212', 'st:213'], 'time', 'tr-c07-diesel-1435', 'pol-strict-no-rev', opDiesel1435, 'Standard-gauge 1435mm non-electrified diesel valid route');
addPos('c07_a027_sg1435_diesel_multi', 'standard_gauge', 'c07-corridor-v1', ['st:210', 'st:211', 'st:212', 'st:213', 'st:226'], 'time', 'tr-c07-diesel-1435-fast', 'pol-strict-no-rev', opDiesel1435, 'Standard-gauge 1435mm 5-stop diesel across AC/DC/non-elec/oneway');
addPos('c07_a028_sg1435_steam_nonelec', 'steam_valid', 'c07-corridor-v1', ['st:212', 'st:213'], 'distance', 'tr-c07-steam-1435', 'pol-strict-no-rev', opSteam1435, 'Standard-gauge 1435mm valid steam route on non-electrified track');
addPos('c07_a029_sg1435_steam_oneway', 'steam_valid', 'c07-corridor-v1', ['st:213', 'st:226'], 'time', 'tr-c07-steam-1435', 'pol-strict-no-rev', opSteam1435, 'Standard-gauge 1435mm steam valid forward on oneway speed-limited branch w2025');

// Narrow gauge (1000mm) diesel & steam
addPos('c07_a030_mg1000_diesel_fwd', 'narrow_gauge', 'c06-synthetic-v1', ['st:116', 'st:117'], 'time', 'tr-c07-diesel-1000', 'pol-strict-no-rev', opDiesel1000, 'Migrated baseline 04: 1000mm narrow-gauge diesel route');
addPos('c07_a031_mg1000_diesel_bwd', 'narrow_gauge', 'c06-synthetic-v1', ['st:117', 'st:116'], 'distance', 'tr-c07-diesel-1000', 'pol-strict-no-rev', opDiesel1000, '1000mm narrow-gauge diesel reverse direction');
addPos('c07_a032_mg1000_steam_fwd', 'steam_valid', 'c06-synthetic-v1', ['st:116', 'st:117'], 'time', 'tr-c07-steam-1000', 'pol-strict-no-rev', opSteam1000, '1000mm narrow-gauge valid steam route');

// Broad gauge (1676mm) diesel & steam
addPos('c07_a033_bg1676_diesel_nonelec', 'diesel_valid', 'c06-synthetic-v1', ['st:106', 'st:107'], 'time', 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'Migrated baseline 06: 1676mm diesel on non-electrified w1006');
addPos('c07_a034_bg1676_diesel_trunk', 'diesel_valid', 'c06-synthetic-v1', ['st:101', 'st:102', 'st:104', 'st:106', 'st:107'], 'time', 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, '5-stop diesel across electrified & non-electrified broad gauge');
addPos('c07_a035_bg1676_diesel_oneway_fwd', 'diesel_valid', 'c06-synthetic-v1', ['st:128', 'st:129'], 'time', 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'Diesel forward on oneway track w1017');
addPos('c07_a036_bg1676_diesel_cross_ew', 'diesel_valid', 'c06-synthetic-v1', ['st:130', 'st:131'], 'time', 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'Diesel along unbroken east-west track of grade crossing');
addPos('c07_a037_bg1676_diesel_c07_branch', 'diesel_valid', 'c07-corridor-v1', ['st:224', 'st:225'], 'time', 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'C07 corridor broad-gauge diesel valid branch');
addPos('c07_a038_bg1676_steam_nonelec', 'steam_valid', 'c06-synthetic-v1', ['st:106', 'st:107'], 'time', 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, '1676mm steam locomotive valid on non-electrified branch');
addPos('c07_a039_bg1676_steam_c07_3stop', 'steam_valid', 'c07-corridor-v1', ['st:205', 'st:224', 'st:225'], 'time', 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, '1676mm 3-stop steam locomotive across DC & non-electrified segments');
addPos('c07_a040_bg1676_steam_main_c07', 'steam_valid', 'c07-corridor-v1', ['st:201', 'st:203', 'st:205'], 'distance', 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, '1676mm steam valid distance route on mainline');

// Authorized reversals
addPos('c07_a041_auth_rev_c06_diesel', 'authorized_reversal', 'c06-synthetic-v1', ['st:134', 'st:136'], 'time', 'tr-c07-diesel-1676', 'pol-strict-rev', opDiesel1676, 'Authorized headshunt U-turn reversal with +300s turn penalty', { capability: 'STRICT_REVERSAL' });
addPos('c07_a042_auth_rev_c07_steam', 'authorized_reversal', 'c07-corridor-v1', ['st:220', 'st:222'], 'time', 'tr-c07-steam-1676', 'pol-strict-rev', opSteam1676, 'Authorized C07 switchback U-turn reversal for steam train', { capability: 'STRICT_REVERSAL' });

// Authorized dual-mode transitions
addPos('c07_a043_dual_ac_to_diesel_n106', 'authorized_dual_mode', 'c06-synthetic-v1', ['st:102', 'st:107'], 'time', 'tr-c07-dual-25k-1676', 'pol-strict-switch-n106', opAc25k, 'Dual locomotive starts 25kV AC and switches to diesel at authorized n:106 (+120s)', { capability: 'STRICT_DUAL_SWITCH_ADAPTER' });
add({
  caseId: 'c07_a044_dual_diesel_to_ac_n106',
  category: 'A_POSITIVE_ROUTE',
  subcategory: 'authorized_dual_mode',
  fixtureId: 'c06-synthetic-v1',
  stopIds: ['st:107', 'st:104'],
  objective: 'time',
  trainProfileId: 'tr-c07-dual-25k-1676',
  policyId: 'pol-strict-switch-n106',
  initialOperating: opDiesel1676,
  expectedValid: false,
  expectedOutcome: 'CALIBRATION_DISCREPANCY',
  expectedDiscrepancyClass: 'DURATION_DISCREPANCY',
  expectedGameCodePrefix: 'OK',
  expectedOracleStatusPrefix: 'OK',
  expectedIncompatibilityReason: 'DUAL_DIESEL_STAY_VS_ADAPTER_SWITCH_HEURISTIC_120S',
  rationale: 'Calibration discovery: findRoute optimally stays in diesel across electrified w1005 (0s switch penalty, 629s) whereas C06 adapter heuristic assumes electric switch (+120s, 748s)',
  constraintCodes: ['CALIBRATION_DURATION_DELTA_MODE_PENALTY'],
  requiredOracleCapability: 'STRICT_DUAL_SWITCH_ADAPTER',
});
addPos('c07_a045_dual_dc_to_diesel_n224', 'authorized_dual_mode', 'c07-corridor-v1', ['st:205', 'st:225'], 'time', 'tr-c07-dual-dc1500-1676', 'pol-strict-switch-n224', opDc1500, 'Dual locomotive starts 1500V DC and switches to diesel at authorized n:224 (+90s)', { capability: 'STRICT_DUAL_SWITCH_ADAPTER' });

// ===========================================================================
// CATEGORY B — NEGATIVE COMPATIBILITY ROUTES (36 distinct scenarios)
// ===========================================================================
const addNegB = (caseId, subcategory, fixtureId, stopIds, trainProfileId, policyId, initialOperating, expectedIncompatibilityReason, rationale, objective = 'time', extra = {}) =>
  add({
    caseId,
    category: 'B_NEGATIVE_COMPATIBILITY',
    subcategory,
    fixtureId,
    stopIds,
    objective,
    trainProfileId,
    policyId,
    initialOperating,
    expectedValid: false,
    expectedOutcome: 'REJECTED_ROUTE',
    expectedDiscrepancyClass: 'MATCH_NO_VALID_ROUTE',
    expectedGameCodePrefix: extra.gameCodePrefix ?? 'INCOMPATIBLE_PROFILE',
    expectedOracleStatusPrefix: extra.oracleCodePrefix ?? 'NO_ROUTE',
    expectedIncompatibilityReason,
    rationale,
    constraintCodes: extra.constraintCodes ?? ['NEGATIVE_COMPATIBILITY'],
    requiredOracleCapability: extra.capability ?? 'STRICT_SINGLE_GRAPH',
  });

// Wrong track gauge (6)
addNegB('c07_b001_wrong_gauge_1435_on_1676', 'wrong_gauge', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-diesel-1435', 'pol-strict-no-rev', opDiesel1435, 'TRACK_GAUGE', 'Migrated baseline 03: 1435mm train rejected on 1676mm broad gauge');
addNegB('c07_b002_wrong_gauge_1000_on_1676', 'wrong_gauge', 'c06-synthetic-v1', ['st:106', 'st:107'], 'tr-c07-diesel-1000', 'pol-strict-no-rev', opDiesel1000, 'TRACK_GAUGE', '1000mm narrow-gauge train rejected on 1676mm non-electrified track');
addNegB('c07_b003_wrong_gauge_1676_on_1000', 'wrong_gauge', 'c06-synthetic-v1', ['st:116', 'st:117'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'TRACK_GAUGE', '1676mm broad-gauge diesel rejected on 1000mm narrow-gauge track');
addNegB('c07_b004_wrong_gauge_1435_on_1000', 'wrong_gauge', 'c06-synthetic-v1', ['st:116', 'st:117'], 'tr-c07-steam-1435', 'pol-strict-no-rev', opSteam1435, 'TRACK_GAUGE', '1435mm steam train rejected on 1000mm narrow-gauge track');
addNegB('c07_b005_wrong_gauge_1676_on_1435_ac', 'wrong_gauge', 'c07-corridor-v1', ['st:210', 'st:211'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'TRACK_GAUGE', '1676mm 25kV AC train rejected on 1435mm 25kV AC standard-gauge track');
addNegB('c07_b006_wrong_gauge_steam1000_on_1435', 'wrong_gauge', 'c07-corridor-v1', ['st:212', 'st:213'], 'tr-c07-steam-1000', 'pol-strict-no-rev', opSteam1000, 'TRACK_GAUGE', '1000mm steam rejected on 1435mm track');

// Unknown gauge (3)
addNegB('c07_b007_unknown_gauge_diesel', 'unknown_gauge', 'c06-synthetic-v1', ['st:118', 'st:119'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'UNKNOWN_GAUGE', 'Migrated baseline 05: missing gauge tag fails closed for diesel', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegB('c07_b008_unknown_gauge_steam', 'unknown_gauge', 'c06-synthetic-v1', ['st:118', 'st:119'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'UNKNOWN_GAUGE', 'Missing gauge fails closed for steam', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegB('c07_b009_unknown_gauge_electric', 'unknown_gauge', 'c06-synthetic-v1', ['st:118', 'st:119'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'UNKNOWN_GAUGE', 'Missing gauge fails closed for electric train', 'time', { gameCodePrefix: 'DATA_MISSING' });

// Non-electrified track for electric-only (3)
addNegB('c07_b010_nonelec_ac25k_c06', 'non_electrified_electric', 'c06-synthetic-v1', ['st:106', 'st:107'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'NO_ELECTRIFICATION', 'Electric 25kV AC train rejected on non-electrified broad gauge');
addNegB('c07_b011_nonelec_dc1500_c06', 'non_electrified_electric', 'c06-synthetic-v1', ['st:106', 'st:107'], 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'NO_ELECTRIFICATION', 'Electric 1500V DC train rejected on non-electrified broad gauge');
addNegB('c07_b012_nonelec_1435_ac25k_c07', 'non_electrified_electric', 'c07-corridor-v1', ['st:212', 'st:213'], 'tr-c07-ac25k-1435', 'pol-strict-no-rev', opAc25k1435, 'NO_ELECTRIFICATION', 'Standard-gauge 1435mm electric rejected on non-electrified track');

// Unknown electrification (2)
addNegB('c07_b013_unknown_elec_ac25k', 'unknown_electrification', 'c07-corridor-v1', ['st:227', 'st:228'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'UNKNOWN_ELECTRIFICATION', 'Missing electrification tag fails closed for 25kV AC train', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegB('c07_b014_unknown_elec_dc1500', 'unknown_electrification', 'c07-corridor-v1', ['st:227', 'st:228'], 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'UNKNOWN_ELECTRIFICATION', 'Missing electrification tag fails closed for 1500V DC train', 'time', { gameCodePrefix: 'DATA_MISSING' });

// Missing voltage (2)
addNegB('c07_b015_missing_voltage_ac25k', 'missing_voltage', 'c06-synthetic-v1', ['st:112', 'st:113'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'UNKNOWN_VOLTAGE', 'Migrated baseline 09: electrified=contact_line + frequency=50 without voltage fails closed', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegB('c07_b016_missing_voltage_dc1500', 'missing_voltage', 'c06-synthetic-v1', ['st:112', 'st:113'], 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'UNKNOWN_VOLTAGE', 'Missing voltage fails closed for 1500V DC train too', 'time', { gameCodePrefix: 'DATA_MISSING' });

// Incorrect voltage (4)
addNegB('c07_b017_wrong_voltage_25k_on_1500v', 'incorrect_voltage', 'c06-synthetic-v1', ['st:108', 'st:109'], 'tr-c07-dc25k-1676', 'pol-strict-no-rev', opDc25k, 'TRACK_VOLTAGE', '25kV DC train rejected on 1500V DC track');
addNegB('c07_b018_wrong_voltage_1500_on_25k', 'incorrect_voltage', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-ac1500-1676', 'pol-strict-no-rev', opAc1500, 'TRACK_VOLTAGE', '1500V 50Hz AC train rejected on 25000V 50Hz AC track');
addNegB('c07_b019_wrong_voltage_750_on_3000', 'incorrect_voltage', 'c07-corridor-v1', ['st:211', 'st:214'], 'tr-c07-dc750-1435', 'pol-strict-no-rev', opDc750_1435, 'TRACK_VOLTAGE', '750V DC train rejected on 3000V DC standard-gauge corridor');
addNegB('c07_b020_wrong_voltage_3000_on_750', 'incorrect_voltage', 'c07-corridor-v1', ['st:211', 'st:212'], 'tr-c07-dc3000-1435', 'pol-strict-no-rev', opDc3000_1435, 'TRACK_VOLTAGE', '3000V DC train rejected on 750V DC standard-gauge corridor');

// Missing frequency (2)
addNegB('c07_b021_missing_freq_dc1500', 'missing_frequency', 'c06-synthetic-v1', ['st:110', 'st:111'], 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'UNKNOWN_FREQUENCY', 'Migrated baseline 08: missing frequency must NEVER be treated as DC 0Hz', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegB('c07_b022_missing_freq_ac1500', 'missing_frequency', 'c06-synthetic-v1', ['st:110', 'st:111'], 'tr-c07-ac1500-1676', 'pol-strict-no-rev', opAc1500, 'UNKNOWN_FREQUENCY', 'Missing frequency rejected for 1500V AC train as well', 'time', { gameCodePrefix: 'DATA_MISSING' });

// Incorrect AC frequency (2)
addNegB('c07_b023_wrong_ac_freq_50_on_17', 'incorrect_ac_frequency', 'c06-synthetic-v1', ['st:143', 'st:144'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'TRACK_FREQUENCY', 'Migrated baseline 10: 50Hz AC train rejected on 16.7/17Hz corridor');
addNegB('c07_b024_wrong_ac_freq_17_on_50', 'incorrect_ac_frequency', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-ac15k17-1676', 'pol-strict-no-rev', opAc167, 'TRACK_FREQUENCY', '15kV 17Hz AC train rejected on 25kV 50Hz track');

// Explicit DC vs AC/unknown distinction (2)
addNegB('c07_b025_dc0_train_on_ac50_track', 'explicit_dc_vs_ac', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-dc25k-1676', 'pol-strict-no-rev', opDc25k, 'TRACK_FREQUENCY', '25kV 0Hz DC train rejected on 25kV 50Hz AC track (explicit DC vs AC separation)');
addNegB('c07_b026_ac50_train_on_dc0_track', 'explicit_dc_vs_ac', 'c06-synthetic-v1', ['st:108', 'st:109'], 'tr-c07-ac1500-1676', 'pol-strict-no-rev', opAc1500, 'TRACK_FREQUENCY', '1500V 50Hz AC train rejected on 1500V 0Hz DC track');

// Ambiguous voltage/frequency combinations (3)
addNegB('c07_b027_ambig_track_25k_ac', 'ambiguous_electrical_pairs', 'c06-synthetic-v1', ['st:114', 'st:115'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'AMBIGUOUS_TRACK_POWER_PAIRS', 'Multi-value track voltage=25000;1500 & frequency=50;0 fails closed', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegB('c07_b028_ambig_train_on_ac_track', 'ambiguous_electrical_pairs', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-ambig-1676', 'pol-strict-no-rev', opAc25k, 'AMBIGUOUS_TRAIN_POWER_PAIRS', 'Multi-voltage/multi-frequency train fails closed without inferring pairs', 'time', { gameCodePrefix: 'DATA_MISSING', oracleCodePrefix: 'DATA_MISSING' });
addNegB('c07_b029_ambig_train_on_dc_track', 'ambiguous_electrical_pairs', 'c06-synthetic-v1', ['st:108', 'st:109'], 'tr-c07-ambig-1676', 'pol-strict-no-rev', opDc1500, 'AMBIGUOUS_TRAIN_POWER_PAIRS', 'Ambiguous train fails closed on DC corridor as well', 'time', { gameCodePrefix: 'DATA_MISSING', oracleCodePrefix: 'DATA_MISSING' });

// Unsupported traction & initialOperating mismatch (3)
addNegB('c07_b030_diesel_op_on_electric_train', 'unsupported_traction', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opDiesel1676, 'TRAIN_TRACTION', 'Electric-only train running in diesel operating mode fails closed in both game & Java', 'time', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });
addNegB('c07_b031_electric_op_on_diesel_train', 'unsupported_traction', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opAc25k, 'TRAIN_TRACTION', 'Diesel-only train running in electric operating mode fails closed in both game & Java', 'time', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });
addNegB('c07_b032_electric_op_on_steam_train', 'unsupported_traction', 'c07-corridor-v1', ['st:201', 'st:203'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opAc25k, 'TRAIN_TRACTION', 'Steam-only train running in electric operating mode fails closed', 'time', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });

// Unauthorized mode changes (2)
addNegB('c07_b033_dual_unauth_switch_c06', 'unauthorized_mode_change', 'c06-synthetic-v1', ['st:102', 'st:107'], 'tr-c07-dual-25k-1676', 'pol-strict-no-rev', opAc25k, 'UNSUPPORTED_TRACTION_TRANSITION', 'Dual train without switch site permission at n:106 fails closed', 'time', { capability: 'STRICT_DUAL_SWITCH_ADAPTER', oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });
addNegB('c07_b034_dual_unauth_switch_c07', 'unauthorized_mode_change', 'c07-corridor-v1', ['st:205', 'st:225'], 'tr-c07-dual-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'UNSUPPORTED_TRACTION_TRANSITION', 'Dual train without switch site permission at n:224 fails closed', 'time', { capability: 'STRICT_DUAL_SWITCH_ADAPTER', oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });

// Unsupported power-system transitions (2)
addNegB('c07_b035_power_transition_ac_to_dc_c06', 'unsupported_power_transition', 'c06-synthetic-v1', ['st:101', 'st:105'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'TRACK_VOLTAGE', '25kV 50Hz AC train cannot cross into 1500V 0Hz DC without dual-system support');
addNegB('c07_b036_power_transition_25k_to_750dc_1435', 'unsupported_power_transition', 'c07-corridor-v1', ['st:210', 'st:212'], 'tr-c07-ac25k-1435', 'pol-strict-no-rev', opAc25k1435, 'TRACK_VOLTAGE', 'Standard-gauge 25kV 50Hz AC train cannot continue onto 750V DC segment');

// ===========================================================================
// CATEGORY C — TOPOLOGY & OPERATIONAL RESTRICTIONS (29 distinct scenarios)
// ===========================================================================
const addNegC = (caseId, subcategory, fixtureId, stopIds, trainProfileId, policyId, initialOperating, expectedIncompatibilityReason, rationale, objective = 'time', extra = {}) =>
  add({
    caseId,
    category: 'C_TOPOLOGY_AND_OPERATIONS',
    subcategory,
    fixtureId,
    stopIds,
    objective,
    trainProfileId,
    policyId,
    initialOperating,
    expectedValid: false,
    expectedOutcome: 'REJECTED_ROUTE',
    expectedDiscrepancyClass: 'MATCH_NO_VALID_ROUTE',
    expectedGameCodePrefix: extra.gameCodePrefix ?? 'INCOMPATIBLE_PROFILE',
    expectedOracleStatusPrefix: extra.oracleCodePrefix ?? 'NO_ROUTE',
    expectedIncompatibilityReason,
    rationale,
    constraintCodes: extra.constraintCodes ?? ['NEGATIVE_TOPOLOGY_OR_OPS'],
    requiredOracleCapability: extra.capability ?? 'STRICT_SINGLE_GRAPH',
  });

// Disconnected networks (4)
addNegC('c07_c001_disconnected_island_c06', 'disconnected_network', 'c06-synthetic-v1', ['st:101', 'st:138'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'NO_CONNECTED_PATH', 'Migrated baseline 02: disconnected island unreachable from st:101', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c002_disconnected_island_rev', 'disconnected_network', 'c06-synthetic-v1', ['st:138', 'st:101'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'NO_CONNECTED_PATH', 'Island st:138 disconnected from st:101 for steam as well', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c003_disconnected_1676_vs_1435_sub', 'disconnected_network', 'c07-corridor-v1', ['st:201', 'st:210'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'NO_CONNECTED_PATH', 'Disconnected 1676mm & 1435mm subnetworks in C07 corridor', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c004_disconnected_narrow_multi_dest', 'disconnected_network', 'c06-synthetic-v1', ['st:101', 'st:142'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'NO_CONNECTED_PATH', 'Narrow-gauge branch st:142 physically disconnected from st:101 despite shared multi-node station metadata', 'time', { gameCodePrefix: 'INCOMPATIBLE_PROFILE' });

// Geometric crossings without connected nodes (2)
addNegC('c07_c005_crossing_no_node_w_to_n', 'crossing_no_shared_node', 'c06-synthetic-v1', ['st:130', 'st:133'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'NO_CONNECTED_PATH', 'Orthogonal crossing edges without shared tower node reject W->N jump', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c006_crossing_no_node_s_to_e', 'crossing_no_shared_node', 'c06-synthetic-v1', ['st:132', 'st:131'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'NO_CONNECTED_PATH', 'Orthogonal crossing edges without shared tower node reject S->E jump', 'time', { gameCodePrefix: 'NO_ROUTE' });

// Restricted access (2)
addNegC('c07_c007_restricted_access_diesel', 'restricted_access', 'c06-synthetic-v1', ['st:120', 'st:121'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'RESTRICTED_ACCESS', 'access=private track fails closed for diesel');
addNegC('c07_c008_restricted_access_steam', 'restricted_access', 'c06-synthetic-v1', ['st:120', 'st:121'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'RESTRICTED_ACCESS', 'access=private track fails closed for steam');

// Unknown access (2)
addNegC('c07_c009_unknown_access_diesel', 'unknown_access', 'c06-synthetic-v1', ['st:122', 'st:123'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'UNKNOWN_ACCESS', 'Missing access tag fails closed with DATA_MISSING for diesel', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegC('c07_c010_unknown_access_steam', 'unknown_access', 'c06-synthetic-v1', ['st:122', 'st:123'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'UNKNOWN_ACCESS', 'Missing access tag fails closed for steam', 'time', { gameCodePrefix: 'DATA_MISSING' });

// Inactive railway segments (2)
addNegC('c07_c011_inactive_track_diesel', 'inactive_segment', 'c06-synthetic-v1', ['st:126', 'st:127'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'INACTIVE_TRACK', 'railway:active=no rejected for diesel');
addNegC('c07_c012_inactive_track_steam', 'inactive_segment', 'c06-synthetic-v1', ['st:126', 'st:127'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'INACTIVE_TRACK', 'railway:active=no rejected for steam');

// Forbidden direction (3)
addNegC('c07_c013_oneway_bwd_diesel_c06', 'forbidden_direction', 'c06-synthetic-v1', ['st:129', 'st:128'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'DIRECTION', 'Backward traversal on oneway=yes broad gauge forbidden', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c014_oneway_bwd_diesel_c07', 'forbidden_direction', 'c07-corridor-v1', ['st:226', 'st:213'], 'tr-c07-diesel-1435', 'pol-strict-no-rev', opDiesel1435, 'DIRECTION', 'Backward traversal on oneway=yes 1435mm branch w2025 forbidden', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c015_oneway_bwd_steam_c07', 'forbidden_direction', 'c07-corridor-v1', ['st:226', 'st:213'], 'tr-c07-steam-1435', 'pol-strict-no-rev', opSteam1435, 'DIRECTION', 'Backward traversal on oneway=yes 1435mm branch w2025 forbidden for steam', 'time', { gameCodePrefix: 'NO_ROUTE' });

// Forbidden junction transition (2)
addNegC('c07_c016_forbidden_acute_turn_c06', 'forbidden_junction_turn', 'c06-synthetic-v1', ['st:134', 'st:136'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'TURN_FORBIDDEN', 'Acute V-junction forbids direct st:134->st:136 without headshunt reversal', 'time', { gameCodePrefix: 'NO_ROUTE' });
addNegC('c07_c017_forbidden_acute_turn_c07', 'forbidden_junction_turn', 'c07-corridor-v1', ['st:220', 'st:222'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'TURN_FORBIDDEN', 'C07 acute V-junction forbids st:220->st:222 when allowReversal=false', 'time', { gameCodePrefix: 'NO_ROUTE' });

// Unauthorized reversal (4)
addNegC('c07_c018_unauth_rev_stub_c06', 'unauthorized_reversal', 'c06-synthetic-v1', ['st:134', 'st:137', 'st:136'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'UNAUTHORIZED_REVERSAL', 'Multi-stop headshunt reversal rejected when allowReversal=false');
addNegC('c07_c019_unauth_rev_stub_c07', 'unauthorized_reversal', 'c07-corridor-v1', ['st:220', 'st:223', 'st:222'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'UNAUTHORIZED_REVERSAL', 'C07 headshunt reversal rejected when allowReversal=false');
addNegC('c07_c020_unauth_mid_order_rev_c06', 'incorrect_station_order_reversal', 'c06-synthetic-v1', ['st:101', 'st:104', 'st:102'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'UNAUTHORIZED_REVERSAL', 'Ordered [101, 104, 102] requires reversing at st:104; rejected with allowReversal=false');
addNegC('c07_c021_unauth_mid_order_rev_c07', 'incorrect_station_order_reversal', 'c07-corridor-v1', ['st:201', 'st:205', 'st:204'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'UNAUTHORIZED_REVERSAL', 'Ordered [201, 205, 204] requires reversing at dead-end st:205; rejected with allowReversal=false');

// Authorized ordered intermediate-stop reversal control (discovers GraphHopper waypoint U-turn penalty omission: 913s vs 1215s!)
add({
  caseId: 'c07_c022_auth_mid_return_valid',
  category: 'C_TOPOLOGY_AND_OPERATIONS',
  subcategory: 'authorized_intermediate_reversal',
  fixtureId: 'c06-synthetic-v1',
  stopIds: ['st:101', 'st:104', 'st:102'],
  objective: 'time',
  trainProfileId: 'tr-c07-ac25k-1676',
  policyId: 'pol-strict-rev',
  initialOperating: opAc25k,
  expectedValid: false,
  expectedOutcome: 'CALIBRATION_DISCREPANCY',
  expectedDiscrepancyClass: 'DURATION_DISCREPANCY',
  expectedGameCodePrefix: 'OK',
  expectedOracleStatusPrefix: 'OK',
  expectedIncompatibilityReason: 'ORACLE_MULTI_STOP_WAYPOINT_REVERSAL_PENALTY_OMITTED_300S',
  rationale: 'Calibration discovery: findRoute enforces +300s reversal penalty at intermediate waypoint st:104 (1215s), whereas GraphHopper multi-stop query resets legs without applying U-turn penalty at st:104 (913s)',
  constraintCodes: ['CALIBRATION_DURATION_DELTA_REVERSAL_PENALTY'],
  requiredOracleCapability: 'STRICT_REVERSAL',
});

// Range exhaustion (4)
addNegC('c07_c023_range_exhaust_edge_c06', 'range_exhaustion', 'c06-synthetic-v1', ['st:101', 'st:102'], 'tr-c07-diesel-1676-short', 'pol-strict-no-rev', opDiesel1676, 'RANGE_EXCEEDED', '5km train range < 10.87km edge fails closed', 'distance', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });
addNegC('c07_c024_range_exhaust_edge_c06_ac', 'range_exhaustion', 'c06-synthetic-v1', ['st:101', 'st:102', 'st:104'], 'tr-c07-ac25k-1676-short', 'pol-strict-no-rev', opAc25k, 'RANGE_EXCEEDED', '15km electric train passes edge 1001 (10.87km) but fails cumulative 20.64km journey', 'time', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });
addNegC('c07_c025_range_exhaust_cumulative_c07', 'range_exhaustion', 'c07-corridor-v1', ['st:201', 'st:203', 'st:204', 'st:205'], 'tr-c07-ac25k-1676-midrange', 'pol-strict-no-rev', opAc25k, 'RANGE_EXCEEDED', '35km range exhausted before completing ~43km 4-stop C07 mainline', 'distance', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });
addNegC('c07_c026_range_exhaust_bypass_c07', 'range_exhaustion', 'c07-corridor-v1', ['st:201', 'st:204'], 'tr-c07-ac25k-1676-midrange', 'pol-strict-no-rev', opAc25k, 'RANGE_EXCEEDED', '35km range permits 32km slow mainline? Wait: check bypass (~25km+10.8km > 35km) on time', 'time', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });

// Wait: let's check c07_c026 carefully! If 201->202->203 (21.6km) + 203->204 (10.8km) = 32.4km <= 35km!! So with range 35km and objective='time', GraphHopper might try 201->206->203->204 (~25.4 + 10.8 = 36.2km) while `findRoute` might take slower 32.4km!
// Instead use st:201 -> st:205 with tr-c07-ac25k-1676-short (15km) so BOTH strictly exceed range on single/cumulative edges! Let's make sure every single case in C is deterministic with zero accidental ambiguity.

// Unknown maximum speed (3)
addNegC('c07_c027_unknown_maxspeed_diesel', 'unknown_maxspeed', 'c06-synthetic-v1', ['st:124', 'st:125'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'UNKNOWN_SPEED', 'Missing maxspeed fails closed in Realism with DATA_MISSING for diesel', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegC('c07_c028_unknown_maxspeed_steam', 'unknown_maxspeed', 'c06-synthetic-v1', ['st:124', 'st:125'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opSteam1676, 'UNKNOWN_SPEED', 'Missing maxspeed fails closed in Realism with DATA_MISSING for steam', 'time', { gameCodePrefix: 'DATA_MISSING' });
addNegC('c07_c029_unknown_maxspeed_dist_obj', 'unknown_maxspeed', 'c06-synthetic-v1', ['st:124', 'st:125'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'UNKNOWN_SPEED', 'Missing maxspeed fails closed even when routing objective is distance', 'distance', { gameCodePrefix: 'DATA_MISSING' });

// ===========================================================================
// ADDITIONAL GENUINE ROUTE COMPARISONS TO REACH 110+ GENUINE SCENARIOS (Category A/B/C diversity)
// ===========================================================================
// Adding distinct multi-stop, direction, train-profile, and cross-corridor negative/positive routes across c07-corridor-v1 & c06-synthetic-v1:
addPos('c07_a046_bg1676_ac25k_c07_fast_to_port', 'ac_25kv_broad', 'c07-corridor-v1', ['st:203', 'st:204', 'st:205'], 'time', 'tr-c07-ac25k-1676-fast', 'pol-strict-no-rev', opAc25k, 'Eastern C07 25kV 3-stop high-speed corridor');
addPos('c07_a047_sg1435_ac25k_loop_bwd', 'standard_gauge', 'c07-corridor-v1', ['st:211', 'st:210'], 'time', 'tr-c07-ac25k-1435', 'pol-strict-no-rev', opAc25k1435, 'Reverse direction on 1435mm 25kV AC');
addPos('c07_a048_sg1435_dc750_bwd', 'standard_gauge', 'c07-corridor-v1', ['st:212', 'st:211'], 'distance', 'tr-c07-dc750-1435', 'pol-strict-no-rev', opDc750_1435, 'Reverse direction on 1435mm 750V DC');
addPos('c07_a049_sg1435_dc3000_bwd', 'standard_gauge', 'c07-corridor-v1', ['st:214', 'st:211'], 'distance', 'tr-c07-dc3000-1435', 'pol-strict-no-rev', opDc3000_1435, 'Reverse direction on 1435mm 3000V DC');
add({
  caseId: 'c07_a050_dual_diesel_c07_dc',
  category: 'A_POSITIVE_ROUTE',
  subcategory: 'authorized_dual_mode',
  fixtureId: 'c07-corridor-v1',
  stopIds: ['st:225', 'st:224', 'st:205'],
  objective: 'time',
  trainProfileId: 'tr-c07-dual-dc1500-1676',
  policyId: 'pol-strict-switch-n224',
  initialOperating: opDiesel1676,
  expectedValid: false,
  expectedOutcome: 'CALIBRATION_DISCREPANCY',
  expectedDiscrepancyClass: 'DURATION_DISCREPANCY',
  expectedGameCodePrefix: 'OK',
  expectedOracleStatusPrefix: 'OK',
  expectedIncompatibilityReason: 'DUAL_DIESEL_STAY_VS_ADAPTER_SWITCH_HEURISTIC_90S',
  rationale: 'Calibration discovery: findRoute optimally stays in diesel across 1500V DC w2023 (0s switch penalty, 922s) whereas C06 adapter heuristic assumes electric switch (+90s, 1011s)',
  constraintCodes: ['CALIBRATION_DURATION_DELTA_MODE_PENALTY'],
  requiredOracleCapability: 'STRICT_DUAL_SWITCH_ADAPTER',
});

// Negative pairs in C07 corridor for completeness (different stations/profiles, unique semanticRequestId)
addNegB('c07_b037_c07_dc1500_on_25k_hub', 'incorrect_voltage', 'c07-corridor-v1', ['st:201', 'st:202'], 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'TRACK_VOLTAGE', '1500V DC train rejected on C07 25kV AC mainline');
addNegB('c07_b038_c07_25k_on_dc1500_tail', 'incorrect_voltage', 'c07-corridor-v1', ['st:205', 'st:224'], 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'TRACK_VOLTAGE', '25kV AC train rejected on C07 1500V DC segment');
addNegB('c07_b039_c07_dc1500_on_diesel_tail', 'non_electrified_electric', 'c07-corridor-v1', ['st:224', 'st:225'], 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'NO_ELECTRIFICATION', '1500V DC train rejected on non-electrified C07 tail');
addNegB('c07_b040_c07_ac167_on_1435', 'wrong_gauge', 'c07-corridor-v1', ['st:210', 'st:211'], 'tr-c07-ac15k17-1676', 'pol-strict-no-rev', opAc167, 'TRACK_GAUGE', '1676mm 15kV 17Hz AC rejected on 1435mm 25kV corridor');
addNegB('c07_b041_c07_diesel1676_on_1435', 'wrong_gauge', 'c07-corridor-v1', ['st:212', 'st:213'], 'tr-c07-diesel-1676', 'pol-strict-no-rev', opDiesel1676, 'TRACK_GAUGE', '1676mm diesel rejected on 1435mm non-electrified track');
addNegB('c07_b042_c07_dc750_on_1676', 'wrong_gauge', 'c07-corridor-v1', ['st:205', 'st:224'], 'tr-c07-dc750-1435', 'pol-strict-no-rev', opDc750_1435, 'TRACK_GAUGE', '1435mm 750V DC train rejected on 1676mm 1500V DC track');
addNegB('c07_b043_c07_power_switch_dc750_to_3000', 'unsupported_power_transition', 'c07-corridor-v1', ['st:212', 'st:211', 'st:214'], 'tr-c07-dc750-1435', 'pol-strict-no-rev', opDc750_1435, 'TRACK_VOLTAGE', '750V DC train cannot continue onto 3000V DC branch at st:211');
addNegB('c07_b044_c07_unkelec_steam_vs_elec_op', 'unsupported_traction', 'c07-corridor-v1', ['st:227', 'st:228'], 'tr-c07-steam-1676', 'pol-strict-no-rev', opDc1500, 'TRAIN_TRACTION', 'Steam train running with DC electric initialOperating fails closed', 'time', { oracleCodePrefix: 'INCOMPATIBLE_PROFILE' });

// Replace c07_c026 with deterministic st:201->st:205 under 15km range!
const idxC026 = rawCases.findIndex((c) => c.caseId === 'c07_c026_range_exhaust_bypass_c07');
rawCases[idxC026] = makeCase({
  caseId: 'c07_c026_range_exhaust_15km_201_to_205',
  category: 'C_TOPOLOGY_AND_OPERATIONS',
  subcategory: 'range_exhaustion',
  fixtureId: 'c07-corridor-v1',
  stopIds: ['st:201', 'st:205'],
  objective: 'time',
  trainProfileId: 'tr-c07-ac25k-1676-short',
  policyId: 'pol-strict-no-rev',
  initialOperating: opAc25k,
  expectedValid: false,
  expectedOutcome: 'REJECTED_ROUTE',
  expectedDiscrepancyClass: 'MATCH_NO_VALID_ROUTE',
  expectedGameCodePrefix: 'INCOMPATIBLE_PROFILE',
  expectedOracleStatusPrefix: 'INCOMPATIBLE_PROFILE',
  expectedIncompatibilityReason: 'RANGE_EXCEEDED',
  rationale: '15km train range exhausted across ~43km st:201->st:205 C07 mainline',
  constraintCodes: ['NEGATIVE_TOPOLOGY_OR_OPS', 'RANGE_EXCEEDED'],
});

// ===========================================================================
// CATEGORY D — IDENTITY & INFRASTRUCTURE FAILURES (14 distinct scenarios — reported separately!)
// ===========================================================================
const addInfraD = (caseId, subcategory, fixtureId, stopIds, objective, trainProfileId, policyId, initialOperating, expectedDiscrepancyClass, expectedGameCodePrefix, expectedOracleStatusPrefix, expectedIncompatibilityReason, rationale, probeSpec = undefined) =>
  add({
    caseId,
    category: 'D_IDENTITY_AND_INFRASTRUCTURE',
    subcategory,
    fixtureId,
    stopIds,
    objective,
    trainProfileId,
    policyId,
    initialOperating,
    expectedValid: false,
    expectedOutcome: 'INFRASTRUCTURE_OR_UNSUPPORTED',
    expectedDiscrepancyClass,
    expectedGameCodePrefix,
    expectedOracleStatusPrefix,
    expectedIncompatibilityReason,
    rationale,
    constraintCodes: ['INFRASTRUCTURE_OR_UNSUPPORTED', ...(probeSpec?.unknownStationAnchor ? ['UNKNOWN_STATION_ANCHOR'] : [])],
    requiredOracleCapability: 'INFRASTRUCTURE_PROBE',
    probeSpec: probeSpec ? { ...probeSpec, unknownStationAnchor: undefined } : undefined,
  });

addInfraD('c07_d001_stale_graph_hash_c06', 'stale_graph_hash', 'c06-synthetic-v1', ['st:101', 'st:102'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'STALE_IDENTITY', 'STALE_GRAPH', 'STALE_GRAPH', 'GRAPH_SHA256_MISMATCH', 'Stale C06 V2 graph SHA-256 against loaded V1 graph', { actualGraphSha256Override: c06GraphV2.graphSha256 });
addInfraD('c07_d002_stale_graph_hash_c07', 'stale_graph_hash', 'c07-corridor-v1', ['st:201', 'st:203'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'STALE_IDENTITY', 'STALE_GRAPH', 'STALE_GRAPH', 'GRAPH_SHA256_MISMATCH', 'Stale C07 V2 graph SHA-256 against loaded C07 V1 graph', { actualGraphSha256Override: c07GraphV2.graphSha256 });
addInfraD('c07_d003_stale_train_profile', 'stale_train_profile', 'c06-synthetic-v1', ['st:101', 'st:104'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'STALE_IDENTITY', 'STALE_PROFILE', 'STALE_PROFILE', 'PROFILE_HASH_MISMATCH', 'Mismatched train profile SHA-256 must classify STALE_IDENTITY', { actualProfileSha256Override: '1'.repeat(64) });
addInfraD('c07_d004_stale_compat_policy', 'stale_compatibility_policy', 'c06-synthetic-v1', ['st:102', 'st:104'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'STALE_IDENTITY', 'STALE_POLICY', 'STALE_POLICY', 'POLICY_HASH_MISMATCH', 'Mismatched compatibility policy SHA-256 must classify STALE_IDENTITY', { actualPolicySha256Override: '2'.repeat(64) });
addInfraD('c07_d005_wrong_cache_identity_hash', 'incorrect_oracle_cache_identity', 'c06-synthetic-v1', ['st:108', 'st:109'], 'time', 'tr-c07-dc1500-1676', 'pol-strict-no-rev', opDc1500, 'STALE_IDENTITY', 'STALE_GRAPH', 'STALE_GRAPH', 'CACHE_IDENTITY_MISMATCH', 'Cross-fixture graph SHA-256 submitted against c06 cache identity classifies STALE_IDENTITY', { actualGraphSha256Override: c07Graph.graphSha256 });
addInfraD('c07_d006_invalid_input_single_stop', 'invalid_request', 'c06-synthetic-v1', ['st:101'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT', 'AT_LEAST_2_STOPS_REQUIRED', 'Single-stop route request rejects with INVALID_INPUT');
addInfraD('c07_d007_invalid_input_dup_stops', 'invalid_request', 'c06-synthetic-v1', ['st:101', 'st:101'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'INVALID_INPUT', 'INVALID_INPUT', 'OK', 'DUPLICATE_CONSECUTIVE_STOPS', 'Duplicate consecutive stopIds rejects with INVALID_INPUT rather than MATCH_NO_VALID_ROUTE');
addInfraD('c07_d008_search_exhaustion_labels', 'search_exhaustion', 'c06-synthetic-v1', ['st:101', 'st:106'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'SEARCH_EXHAUSTION', 'SEARCH_LIMIT', 'OK', 'LABEL_LIMIT', 'maxLabels=1 triggers game SEARCH_LIMIT -> SEARCH_EXHAUSTION', { maxLabelsOverride: 1 });
addInfraD('c07_d009_search_exhaustion_work', 'search_exhaustion', 'c07-corridor-v1', ['st:201', 'st:205'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'SEARCH_EXHAUSTION', 'SEARCH_LIMIT', 'OK', 'WORK_LIMIT', 'maxWork=2 triggers game WORK_LIMIT -> SEARCH_EXHAUSTION', { maxWorkOverride: 2 });
addInfraD('c07_d010_easy_mode_unsupported', 'easy_mode_isolation', 'c06-synthetic-v1', ['st:118', 'st:119'], 'time', 'tr-c07-diesel-1676', 'pol-easy-isolated', opDiesel1676, 'STRICT_PROFILE_UNSUPPORTED', 'OK', 'STRICT_PROFILE_UNSUPPORTED', 'EASY_MODE_INFERENCE_FORBIDDEN_IN_STRICT_ORACLE', 'Easy-mode inference isolated into STRICT_PROFILE_UNSUPPORTED');
addInfraD('c07_d011_oracle_timeout_kill', 'oracle_timeout', 'c06-synthetic-v1', ['st:101', 'st:104'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'ORACLE_EXECUTION_ERROR', 'OK', 'ORACLE_EXECUTION_ERROR', 'ORACLE_TIMEOUT_EXCEEDED', 'Forced oracle timeout kills JVM cleanly and recovers on subsequent cases', { forceOracleTimeoutMs: 100 });
addInfraD('c07_d012_oracle_process_failure', 'oracle_process_failure', 'c06-synthetic-v1', ['st:104', 'st:106'], 'distance', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'ORACLE_EXECUTION_ERROR', 'OK', 'ORACLE_EXECUTION_ERROR', 'STRICT_CACHE_MISSING', 'Missing cache directory triggers CLI ORACLE_EXECUTION_ERROR', { forceOracleMissingCache: true });
addInfraD('c07_d013_malformed_ipc_response', 'malformed_ipc_response', 'c07-corridor-v1', ['st:203', 'st:204'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'ORACLE_EXECUTION_ERROR', 'OK', 'ORACLE_EXECUTION_ERROR', 'MALFORMED_IPC_JSON', 'Corrupted JSON IPC payload triggers fail-closed ORACLE_EXECUTION_ERROR', { forceMalformedOracleIpc: true });
addInfraD('c07_d014_ipc_correlation_mismatch', 'ipc_correlation_mismatch', 'c07-corridor-v1', ['st:204', 'st:205'], 'time', 'tr-c07-ac25k-1676', 'pol-strict-no-rev', opAc25k, 'ORACLE_EXECUTION_ERROR', 'OK', 'ORACLE_EXECUTION_ERROR', 'IPC_CORRELATION_MISMATCH', 'Mismatched correlationNonce rejects response with ORACLE_EXECUTION_ERROR', { forceCorrelationMismatch: true });

const dataset = {
  schemaVersion: 2,
  datasetId: DATASET_ID,
  datasetVersion: DATASET_VERSION,
  syntheticOnly: true,
  realDataUsed: false,
  c01ComplianceCleared: false,
  minimumRequiredRealCasesForC07: 100,
  realRouteComparisonsCompleted: 0,
  adapterJarSha256: actualJarSha256,
  tolerancePolicy: C07_PROVISIONAL_TOLERANCE_POLICY,
  profiles,
  policies,
  cases: rawCases,
};

const validation = await validateC07CalibrationDataset(dataset, {
  graphsByFixtureId: new Map(Object.entries(fixtures).map(([k, v]) => [k, v.graph])),
  groundTruthByFixtureId: new Map(Object.entries(fixtures).map(([k, v]) => [k, v.truth])),
  cacheIdentityShaByCacheId: new Map(Object.entries(fixtures).map(([, v]) => [v.oracleCacheId, v.oracleCacheSha256])),
  sourceFixtureProvenanceByFixtureId: new Map(
    Object.entries(fixtures).map(([k, v]) => [
      k,
      buildTrustedFixtureProvenance({
        fixtureId: k,
        rawGraphBytes: k === 'c06-synthetic-v1' ? c06GraphRaw : c07GraphRaw,
        graph: v.graph,
        dataProvenance: v.dataProvenance,
        sourceUrl: v.sourceUrl,
        sourceVersion: v.sourceVersion,
        license: v.license,
        regionVersion: v.regionVersion,
      }),
    ]),
  ),
  adapterJarSha256: actualJarSha256,
});

mkdirSync(path.resolve('fixtures/c07_calibration'), { recursive: true });
writeFileSync(path.resolve('fixtures/c07_calibration/c07_synthetic_calibration_dataset.json'), JSON.stringify(dataset, null, 2) + '\n', 'utf8');

// Section 12 — Real-Data Calibration Readiness Schema (empty, strictly C01-gated!)
const realReadiness = {
  schemaVersion: 1,
  datasetId: 'C07-REAL-DATA-READINESS-SCHEMA-V1',
  c01ComplianceCleared: false,
  minimumRequiredRealCases: 100,
  realRouteComparisonsCompleted: 0,
  releaseAllowed: false,
  coveragePlanSummary: {
    targetPositiveRoutes: 40,
    targetNegativeCompatibilityRoutes: 35,
    targetTopologyAndTurnRoutes: 15,
    targetMultiStopAndAlternativeRoutes: 15,
  },
  cases: [],
};
validateRealDataIntakeDataset(realReadiness);
writeFileSync(path.resolve('fixtures/c07_calibration/c07_real_data_readiness_schema.json'), JSON.stringify(realReadiness, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  datasetId: dataset.datasetId,
  totalCases: validation.totalCases,
  genuineRouteCases: validation.genuineRouteCases,
  infrastructureAndUnsupportedCases: validation.infrastructureAndUnsupportedCases,
  positiveCount: dataset.cases.filter((c) => c.category === 'A_POSITIVE_ROUTE').length,
  negativeCompatCount: dataset.cases.filter((c) => c.category === 'B_NEGATIVE_COMPATIBILITY').length,
  topologyAndOpsCount: dataset.cases.filter((c) => c.category === 'C_TOPOLOGY_AND_OPERATIONS').length,
  infraCount: dataset.cases.filter((c) => c.category === 'D_IDENTITY_AND_INFRASTRUCTURE').length,
  validationMs: validation.validationMs,
}, null, 2));
