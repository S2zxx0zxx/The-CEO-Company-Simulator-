import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve extensionless TypeScript relative imports (./foo -> ./foo.ts or ./foo/index.ts)
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

const repoRoot = process.env.RAILWAY_REPO_ROOT
  ? path.resolve(process.env.RAILWAY_REPO_ROOT)
  : __dirname;

const importTs = (rel) => import(pathToFileURL(path.resolve(repoRoot, rel)).href);

const { RailGraph } = await importTs('src/rail/graph/index.ts');
const { RailCompatibility } = await importTs('src/rail/compatibility/index.ts');
const { findRoute, findRouteAlternatives, profileHash, policyHash } = await importTs('src/rail/routing/index.ts');
const { validateRouteSnapshot } = await importTs('src/rail/quotes/index.ts');
const { RollingStockCatalog } = await importTs('src/rail/catalog/index.ts');
const { prepareMovement } = await importTs('src/rail/movement/index.ts');
const {
  analyzeTopology,
  auditCompatibility,
  computeCanonicalGraphSha256,
  deserializeGraphPack,
  serializeGraphPack,
  verifyGraphPackSha256,
} = await importTs('src/rail/topology/index.ts');
const { StationAttachmentRegistry, rankStationCandidates } = await importTs('src/rail/stations/index.ts');
const {
  bearingDeg,
  buildRouteGeometryProfile,
  geodesicDistanceM,
  interpolateEdgePosition,
  interpolateRoutePosition,
  projectMovementInspection,
  sampleRouteGeometry,
} = await importTs('src/rail/geometry/index.ts');
const {
  RailSpatialIndex,
  douglasPeuckerSimplify,
  simplifyEdgeForZoom,
  verifyGraphTileCompatibility,
} = await importTs('src/rail/spatial/index.ts');

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function equal(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + ': ' : '') + sa + ' !== ' + sb);
}

const results = [];
async function runCase(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ case: name, passed: true, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, ...(detail || {}) });
  } catch (err) {
    results.push({ case: name, passed: false, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, error: String(err && err.stack ? err.stack : err) });
  }
}

const prov = {
  sourceUrl: 'urn:railway:synthetic:c03-ts',
  sourceId: 'synthetic-fixture',
  sourceVersion: '1',
  license: 'ODbL-1.0',
  qualityFlags: ['SYNTHETIC_NOT_REAL_DATA'],
};

const mkNode = (id, lon, lat) => ({ id, coordinates: [lon, lat], regionId: 'in-east-pilot', provenance: prov });
const mkStation = (id, name, coord, nodeIds) => ({ id, name, coordinates: coord, regionId: 'in-east-pilot', nodeIds, provenance: prov });
const mkEdge = (id, from, to, geometry, lengthM, extra = {}) => ({
  id,
  from,
  to,
  geometry,
  lengthM,
  gaugeMm: [1676],
  electrification: 'yes',
  voltageV: [25000],
  frequencyHz: [50],
  maxSpeedKmh: 110,
  active: true,
  access: 'allowed',
  provenance: prov,
  ...extra,
});
const mkTurn = (incoming, outgoing, extra = {}) => ({ incoming, outgoing, permitted: true, penaltyS: 0, reversal: false, ...extra });

const baseProfile = {
  id: 'loco-dual-bg',
  traction: 'dual',
  gaugesMm: [1676],
  voltagesV: [25000],
  frequenciesHz: [50],
  maxSpeedKmh: 120,
  rangeM: 500000,
  massKg: 120000,
};

const basePolicy = {
  schemaVersion: 1,
  mode: 'Realism',
  allowReversal: false,
  inferences: [],
  modeChanges: [],
};

await runCase('c03_ts_01_topology_hash_roundtrip_and_tamper_detection', async () => {
  const pack = {
    schemaVersion: 1,
    regionId: 'in-east-pilot',
    graphSha256: '0'.repeat(64),
    nodes: [mkNode('n2', 86.1, 22.0), mkNode('n1', 86.0, 22.0), mkNode('n3', 86.2, 22.0)],
    stations: [mkStation('s1', 'Origin', [86.0, 22.0], ['n1']), mkStation('s2', 'End', [86.2, 22.0], ['n3'])],
    edges: [
      mkEdge('e1', 'n1', 'n2', [[86.0, 22.0], [86.05, 22.02], [86.1, 22.0]], 11500),
      mkEdge('e2', 'n2', 'n3', [[86.1, 22.0], [86.2, 22.0]], 10300, { electrification: 'no', voltageV: null, frequencyHz: null }),
    ],
    turnRules: [mkTurn('e1', 'e2')],
  };
  pack.graphSha256 = await computeCanonicalGraphSha256(pack);

  const check = await verifyGraphPackSha256(pack);
  assert(check.valid, 'Computed hash should match declared canonical hash');

  const g = new RailGraph(pack);
  const serialized = serializeGraphPack(g);
  const restored = await deserializeGraphPack(serialized, true);
  equal(restored.graphSha256, g.graphSha256, 'Roundtrip hash');

  const analysis = analyzeTopology(g);
  equal(analysis.counts.weakComponentCount, 1);
  equal(analysis.deadEndNodeIds, ['n1', 'n3']);
  equal(analysis.modeChangeCandidateNodeIds, ['n2']);

  // Tamper check fails closed
  const tampered = JSON.parse(serialized);
  tampered.edges[0].lengthM += 5;
  let threw = false;
  try {
    await deserializeGraphPack(JSON.stringify(tampered), true);
  } catch {
    threw = true;
  }
  assert(threw, 'Tampered graph JSON must fail hash verification');
  return { graphSha256: g.graphSha256 };
});

await runCase('c03_ts_02_compatibility_audit_unknown_gauge_power_turns', async () => {
  const pack = {
    schemaVersion: 1,
    regionId: 'in-east-pilot',
    graphSha256: '0'.repeat(64),
    nodes: [mkNode('n1', 86.0, 22.0), mkNode('n2', 86.1, 22.0), mkNode('n3', 86.2, 22.0), mkNode('n4', 86.3, 22.0)],
    stations: [mkStation('s1', 'A', [86.0, 22.0], ['n1']), mkStation('s4', 'D', [86.3, 22.0], ['n4'])],
    edges: [
      mkEdge('e_ok', 'n1', 'n2', [[86.0, 22.0], [86.1, 22.0]], 1000),
      mkEdge('e_metre', 'n2', 'n3', [[86.1, 22.0], [86.2, 22.0]], 1000, { gaugeMm: [1000] }),
      mkEdge('e_unknown_el', 'n3', 'n4', [[86.2, 22.0], [86.3, 22.0]], 1000, { electrification: 'unknown', voltageV: null, frequencyHz: null }),
    ],
    turnRules: [
      mkTurn('e_ok', 'e_metre', { permitted: true }),
      mkTurn('e_metre', 'e_unknown_el', { permitted: false }),
    ],
  };
  pack.graphSha256 = await computeCanonicalGraphSha256(pack);
  const g = new RailGraph(pack);

  const auditEl = auditCompatibility(g, baseProfile, basePolicy, { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 });
  equal(auditEl.acceptedEdges, 1);
  equal(auditEl.dataMissingEdges, 1); // unknown electrification NOT coerced to DC!
  equal(auditEl.incompatibleEdges, 1); // 1000mm gauge rejected
  assert(auditEl.edgeFailureReasons.UNKNOWN_ELECTRIFICATION === 1, 'Unknown electrification preserved as DATA_MISSING');
  assert(auditEl.edgeFailureReasons.TRACK_GAUGE === 1, 'Metre gauge rejected');

  // Verify Diesel fails on e_unknown_el only if access or gauge unknown; on e_unknown_el gauge=1676 and access='allowed'
  const auditDiesel = auditCompatibility(g, baseProfile, basePolicy, { mode: 'diesel', gaugeMm: 1676, voltageV: null, frequencyHz: null });
  equal(auditDiesel.acceptedEdges, 2); // e_ok + e_unknown_el
});

await runCase('c03_ts_03_station_registry_ranking_and_quarantine_isolation', async () => {
  const pack = {
    schemaVersion: 1,
    regionId: 'in-east-pilot',
    graphSha256: '0'.repeat(64),
    nodes: [mkNode('n1', 86.0, 22.0), mkNode('n2', 86.1, 22.0)],
    stations: [mkStation('s1', 'Main', [86.0, 22.0], ['n1'])],
    edges: [mkEdge('e1', 'n1', 'n2', [[86.0, 22.0], [86.1, 22.0]], 10000)],
    turnRules: [],
  };
  pack.graphSha256 = await computeCanonicalGraphSha256(pack);
  const g = new RailGraph(pack);

  const report = {
    schemaVersion: 1,
    regionId: 'in-east-pilot',
    maxAttachmentDistanceM: 250,
    ambiguityMarginM: 25,
    attachedCount: 1,
    quarantinedCount: 1,
    duplicateMergeCount: 0,
    attached: [
      {
        stationId: 's1',
        sourceId: 'osm:node:1',
        name: 'Main',
        status: 'ATTACHED',
        method: 'SHARED_TRACK_NODE',
        confidence: 1.0,
        attachmentDistanceM: 0,
        candidateCount: 1,
        nodeIds: ['n1'],
        sourceIds: ['osm:node:1'],
      },
    ],
    quarantined: [
      {
        stationId: 's_bad',
        sourceId: 'osm:node:99',
        name: 'Isolated',
        reason: 'DISCONNECTED_STATION',
        nonRoutable: true,
        candidateCount: 0,
        nearestDistanceM: null,
      },
    ],
  };

  const reg = new StationAttachmentRegistry(g, report);
  equal(reg.attachmentOf('s1').confidence, 1.0);
  equal(reg.quarantinedStations()[0].reason, 'DISCONNECTED_STATION');

  // Verify standalone ranking helper: unambiguous vs ambiguous vs disconnected
  const rankedOk = rankStationCandidates([86.0005, 22.0004], 'Solo', [
    { nodeId: 'n1', coordinates: [86.0005, 22.0], componentId: 'c1', wayIds: ['w1'], nameHint: 'Solo' },
  ]);
  equal(rankedOk.status, 'ATTACHED');
  assert(rankedOk.confidence > 0.5 && rankedOk.confidence < 1.0, 'Spatial confidence strictly in (0.5, 1)');

  const rankedAmbig = rankStationCandidates([86.0, 22.0001], 'Cross', [
    { nodeId: 'nA', coordinates: [86.0, 22.0], componentId: 'comp1', wayIds: ['w1'] },
    { nodeId: 'nB', coordinates: [86.0, 22.0002], componentId: 'comp2', wayIds: ['w2'] },
  ]);
  equal(rankedAmbig.status, 'QUARANTINED');
  equal(rankedAmbig.reason, 'AMBIGUOUS_CANDIDATES');

  const rankedFar = rankStationCandidates([86.5, 22.5], 'Far', [
    { nodeId: 'nA', coordinates: [86.0, 22.0], componentId: 'comp1', wayIds: ['w1'] },
  ]);
  equal(rankedFar.status, 'QUARANTINED');
  equal(rankedFar.reason, 'DISCONNECTED_STATION');
});

await runCase('c03_ts_04_curved_route_interpolation_continuity_and_r33_bridge', async () => {
  // Build curved 2-edge network integrated cleanly with findRoute + validateRouteSnapshot + R33 prepareMovement!
  const pack = {
    schemaVersion: 1,
    regionId: 'in-east-pilot',
    graphSha256: '0'.repeat(64),
    nodes: [mkNode('a', 86.0, 22.0), mkNode('b', 86.1, 22.05), mkNode('c', 86.2, 22.0)],
    stations: [
      mkStation('sa', 'Station A', [86.0, 22.0], ['a']),
      mkStation('sb', 'Station B', [86.1, 22.05], ['b']),
      mkStation('sc', 'Station C', [86.2, 22.0], ['c']),
    ],
    edges: [
      mkEdge('ab', 'a', 'b', [[86.0, 22.0], [86.05, 22.04], [86.1, 22.05]], 12000),
      mkEdge('bc', 'b', 'c', [[86.1, 22.05], [86.15, 22.01], [86.2, 22.0]], 12000),
    ],
    turnRules: [mkTurn('ab', 'bc', { permitted: true, penaltyS: 10, reversal: false })],
  };
  pack.graphSha256 = await computeCanonicalGraphSha256(pack);
  const g = new RailGraph(pack);

  const req = {
    routeId: 'route-curved-1',
    graphSha256: g.graphSha256,
    trainProfileSha256: await profileHash(baseProfile),
    policySha256: await policyHash(basePolicy),
    profile: baseProfile,
    policy: basePolicy,
    stopIds: ['sa', 'sb', 'sc'],
    objective: 'distance',
    initialOperating: { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 },
    maxLabels: 1000,
    maxWork: 10000,
  };

  const routeRes = await findRoute(g, req);
  assert(routeRes.ok, 'findRoute must succeed');
  await validateRouteSnapshot(g, req, routeRes);

  const profile = buildRouteGeometryProfile(g, routeRes);
  equal(profile.totalDistanceM, 24000);
  equal(profile.stopPositions.length, 3);
  equal(profile.stopPositions[1].distanceM, 12000);
  equal(profile.stopPositions[1].coordinates, [86.1, 22.05]);

  // Verify edge-transition continuity right before & after node b (distance 12000m)
  const beforeB = interpolateRoutePosition(profile, 11999);
  const atB = interpolateRoutePosition(profile, 12000);
  const afterB = interpolateRoutePosition(profile, 12001);
  assert(geodesicDistanceM(beforeB.coordinates, atB.coordinates) < 5, 'Continuous approaching edge transition');
  assert(geodesicDistanceM(atB.coordinates, afterB.coordinates) < 5, 'Continuous leaving edge transition');
  equal(atB.atNodeId, 'b');

  // Verify curved midpoint follows curved geometry (lat > 22.025 chord!)
  const midAb = interpolateEdgePosition(g.edge('ab'), 6000, false);
  const midAbRev = interpolateEdgePosition(g.edge('ab'), 6000, true);
  assert(midAb.coordinates[1] > 22.025, 'Forward position lies on curved track above chord');
  assert(geodesicDistanceM(midAb.coordinates, midAbRev.coordinates) < 2, 'Forward & reverse midpoints match');
  assert(Math.abs(bearingDeg([86.0, 22.0], [86.0, 22.1]) - 0) < 1e-6, 'North bearing ~ 0 deg');

  const samples = sampleRouteGeometry(profile, 4000);
  assert(samples.length === 7 && samples[0].routeDistanceM === 0 && samples[samples.length - 1].routeDistanceM === 24000);

  // R33 Single authoritative clock integration (prepareMovement -> advance -> inspect -> projectMovementInspection)
  const fields = ['name', 'kind', 'traction', 'gaugesMm', 'voltagesV', 'frequenciesHz', 'maxSpeedKmh', 'rangeM', 'capacitySeats', 'cargoCapacityKg', 'purchasePriceMinor', 'massKg', 'energyPerKm'];
  const cat = await RollingStockCatalog.prepare({
    schemaVersion: 1,
    id: 'cat-c03',
    revision: 1,
    currency: 'INR',
    entries: [{
      name: 'Dual Express',
      kind: 'locomotive',
      identity: 'fictional',
      modelRevision: 1,
      model: { ...baseProfile, capacitySeats: 0, cargoCapacityKg: 0, purchasePriceMinor: '1000', provenance: prov },
      energyPerKm: [],
      fieldOrigins: fields.map((f) => ({ field: f, classification: 'game-balanced', evidenceId: null })),
    }],
  });
  const infra = {
    schemaVersion: 1,
    resources: [{ id: 'blk-ab', capacity: 1 }, { id: 'blk-bc', capacity: 1 }, { id: 'node-b', capacity: 1 }],
    edges: [{ edgeId: 'ab', resourceId: 'blk-ab' }, { edgeId: 'bc', resourceId: 'blk-bc' }],
    nodes: [{ nodeId: 'b', resourceId: 'node-b' }],
  };
  const plan = { id: 'plan-1', catalogReference: cat.reference(baseProfile.id), request: req, route: routeRes, dynamics: { accelerationS: 20, brakingS: 20, dwellS: [30] } };
  const roster = [{ trainId: 't-1', catalogReference: cat.reference(baseProfile.id), nodeId: 'a' }];
  const mov = await prepareMovement(g, cat, infra, [plan], roster, { maxTrips: 5, maxPending: 20 });
  let snap = await mov.initialize(0, 42);
  snap = await mov.reserve(snap, { tripId: 'trip-1', trainId: 't-1', planId: 'plan-1', departureSimS: 0 });
  const adv = await mov.advance(snap, 200, 100);
  const inspected = await mov.inspect(adv.snapshot);
  const projected = projectMovementInspection(g, new Map([['plan-1', profile]]), inspected);
  assert(projected.length === 1 && projected[0].status === 'RUNNING', 'R33 train projected live onto curved track');
  assert(projected[0].routeProgress > 0 && projected[0].routeProgress < 1);
});

await runCase('c03_ts_05_spatial_index_simplification_invariants_and_scale_handoff', async () => {
  // Load Python-built 500+ node GraphPack + RegionManifest + StationAttachmentReport
  const bundlePath = path.join(__dirname, 'fixtures', 'c03_synthetic_scale_pack.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

  const hashCheck = await verifyGraphPackSha256(bundle.graphPack);
  assert(hashCheck.valid, 'Python canonical GraphPack SHA-256 must match TS WebCrypto SHA-256');

  const g = new RailGraph(bundle.graphPack);
  const reg = new StationAttachmentRegistry(g, bundle.attachmentReport);
  assert(reg.attachedCount === g.stationCount, 'All stations accounted for in attachment registry');

  const tileCompat = verifyGraphTileCompatibility(g, bundle.regionManifest);
  assert(tileCompat.ok, 'Manifest matches graph SHA & entity counts');
  const tileCompatMissingTiles = verifyGraphTileCompatibility(g, bundle.regionManifest, { requireBuiltTiles: true });
  assert(!tileCompatMissingTiles.ok && tileCompatMissingTiles.reason === 'TILES_NOT_BUILT');

  const tBuild0 = performance.now();
  const sindex = new RailSpatialIndex(g);
  const buildMs = performance.now() - tBuild0;

  // Verify exact parity between quadtree BBox query and brute-force scan
  const testBox = [85.15, 22.15, 85.45, 22.40];
  const qRes = sindex.queryBBox(testBox);
  const bruteEdgeIds = g.snapshot().edges
    .filter((e) => {
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const p of e.geometry) {
        if (p[0] < minLon) minLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] > maxLat) maxLat = p[1];
      }
      return minLon <= testBox[2] && maxLon >= testBox[0] && minLat <= testBox[3] && maxLat >= testBox[1];
    })
    .map((e) => e.id)
    .sort();
  equal([...qRes.edgeIds], bruteEdgeIds, 'Quadtree matches exact brute-force edge set');

  // Verify Douglas-Peucker zoom simplification NEVER alters authoritative lengthM or endpoints
  const beforeLenMap = new Map(g.snapshot().edges.map((e) => [e.id, e.lengthM]));
  const lowZoom = sindex.queryMapLibreFeatures(testBox, 5);
  const highZoom = sindex.queryMapLibreFeatures(testBox, 14);
  equal(lowZoom.stations.features.map((f) => f.id), highZoom.stations.features.map((f) => f.id), 'Stable station IDs across zooms');
  for (const feat of lowZoom.edges.features) {
    const auth = g.edge(feat.id);
    equal(feat.geometry.coordinates[0], auth.geometry[0], 'Simplified start endpoint invariant');
    equal(feat.geometry.coordinates[feat.geometry.coordinates.length - 1], auth.geometry[auth.geometry.length - 1], 'Simplified end endpoint invariant');
    equal(auth.lengthM, beforeLenMap.get(feat.id), 'Authoritative lengthM unchanged');
  }

  // Benchmarks: 200 viewport bbox queries, 50 MapLibre frame exports, 25 real Dijkstra routes, 5000 polyline interpolations
  const bboxTimes = [];
  for (let i = 0; i < 200; i++) {
    const x = 85.0 + (i % 10) * 0.08;
    const y = 22.0 + Math.floor(i / 10) * 0.03;
    const t0 = performance.now();
    sindex.queryBBox([x, y, x + 0.25, y + 0.20]);
    bboxTimes.push(performance.now() - t0);
  }
  bboxTimes.sort((a, b) => a - b);

  const mlTimes = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    sindex.queryMapLibreFeatures([85.1, 22.1, 85.6, 22.5], 8);
    mlTimes.push(performance.now() - t0);
  }
  mlTimes.sort((a, b) => a - b);

  const pSha = await profileHash(baseProfile);
  const polSha = await policyHash(basePolicy);
  const stIds = g.snapshot().stations.map((s) => s.id);
  const routeTimes = [];
  let lastSuccessRoute = null;
  for (let i = 0; i < 25; i++) {
    const sA = stIds[i * 3];
    const sB = stIds[Math.min(stIds.length - 1, i * 3 + 12)];
    const req = {
      routeId: 'bench-' + i,
      graphSha256: g.graphSha256,
      trainProfileSha256: pSha,
      policySha256: polSha,
      profile: baseProfile,
      policy: basePolicy,
      stopIds: [sA, sB],
      objective: i % 2 === 0 ? 'distance' : 'time',
      initialOperating: { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 },
      maxLabels: 20000,
      maxWork: 200000,
    };
    const t0 = performance.now();
    const res = await findRoute(g, req);
    routeTimes.push(performance.now() - t0);
    if (res.ok) lastSuccessRoute = res;
  }
  routeTimes.sort((a, b) => a - b);
  assert(lastSuccessRoute !== null, 'Benchmark route search produced valid routes');

  const routeProf = buildRouteGeometryProfile(g, lastSuccessRoute);
  const tInt0 = performance.now();
  for (let i = 0; i < 5000; i++) {
    interpolateRoutePosition(routeProf, ((i % 100) / 100) * routeProf.totalDistanceM);
  }
  const interp5000Ms = performance.now() - tInt0;

  return {
    graphNodes: g.nodeCount,
    graphEdges: g.edgeCount,
    graphStations: g.stationCount,
    spatialIndexBuildMs: Math.round(buildMs * 100) / 100,
    bboxQueryP95Ms: Math.round(bboxTimes[Math.floor(bboxTimes.length * 0.95)] * 1000) / 1000,
    mapLibreViewportP95Ms: Math.round(mlTimes[Math.floor(mlTimes.length * 0.95)] * 1000) / 1000,
    routeP95Ms: Math.round(routeTimes[Math.floor(routeTimes.length * 0.95)] * 100) / 100,
    interp5000TotalMs: Math.round(interp5000Ms * 100) / 100,
    syntheticBenchmarkOnly: true,
    actualC08MobileAcceptanceClaimed: false,
  };
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(JSON.stringify({ suite: 'c03_ts_runtime_and_integration', nodeVersion: process.version, total: results.length, passed, failed, realPbfProcessed: false, results }, null, 2));
if (failed > 0) process.exit(1);
