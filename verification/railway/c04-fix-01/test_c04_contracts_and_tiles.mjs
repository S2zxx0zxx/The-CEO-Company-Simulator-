import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

const pkgRoot = process.env.C04_RENDERER_PKG || path.resolve('c04_renderer_pkg');
const { PMTiles, Protocol } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pmtiles/dist/esm/index.js')).href);
const { PbfReader } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pbf/index.js')).href);
const { inspectPMTilesFile } = await import(pathToFileURL(path.resolve('c04_tile_inspector.mjs')).href);

const { RailGraph } = await import(pathToFileURL(path.resolve('src/rail/graph/index.ts')).href);
const { RailSpatialIndex, verifyGraphTileCompatibility } = await import(pathToFileURL(path.resolve('src/rail/spatial/index.ts')).href);
const { buildRouteGeometryProfile } = await import(pathToFileURL(path.resolve('src/rail/geometry/index.ts')).href);
const { findRoute, profileHash, policyHash } = await import(pathToFileURL(path.resolve('src/rail/routing/index.ts')).href);
const { RollingStockCatalog } = await import(pathToFileURL(path.resolve('src/rail/catalog/index.ts')).href);
const { prepareMovement } = await import(pathToFileURL(path.resolve('src/rail/movement/index.ts')).href);
const {
  DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
  MemoryPMTilesSource,
  RAILWAY_CEO_STYLE_VERSION,
  RailwayMapRenderer,
  buildOfflineMapStyle,
  decodeBoundaryLayerContract,
  decodeC04TileManifest,
  detectWebGLSupport,
  isPermittedOfflineUrl,
  parseSafeOfflineFontPath,
  registerOfflineProtocols,
  resolveOfflinePMTilesArchiveId,
  validateOfflineStyleNoExternalUrls,
  verifyGraphTilesBundleMatch,
} = await import(pathToFileURL(path.resolve('src/rail/map/index.ts')).href);

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

function readGlyphPbfIds(pbfBytes) {
  const r = new PbfReader(pbfBytes);
  const glyphIds = [];
  let fontName = '';
  let range = '';
  r.readFields((tag, _, pbf) => {
    if (tag === 1) {
      pbf.readMessage((ftag, __, fp) => {
        if (ftag === 1) fontName = fp.readString();
        else if (ftag === 2) range = fp.readString();
        else if (ftag === 3) {
          fp.readMessage((gtag, ___, gp) => {
            if (gtag === 1) glyphIds.push(gp.readVarint());
          }, null);
        }
      }, null);
    }
  }, null);
  return { fontName, range, glyphIds };
}

const bundle = JSON.parse(readFileSync(path.resolve('fixtures/c04_synthetic_graph_bundle.json'), 'utf8'));
const pmtilesPath = path.resolve('fixtures/c04_synthetic_basemap.pmtiles');

await runCase('c04_01_pmtiles_generation_decoding_and_zero_boundary_layers', async () => {
  const info = await inspectPMTilesFile(pmtilesPath);
  assert(info.ok, 'PMTiles inspection succeeded');
  equal(info.minZoom, 0);
  equal(info.maxZoom, 14);
  assert(info.outOfBoundsEmpty, 'Out-of-bounds tile lookup safely returns empty');
  assert(!info.vectorLayerIds.includes('boundary'), 'No OSM boundary layer permitted in PMTiles');
  for (const required of ['water', 'waterway', 'landuse', 'transportation', 'place', 'poi_rail']) {
    assert(info.vectorLayerIds.includes(required), 'Missing expected basemap/rail layer: ' + required);
  }
  assert(info.decodedZooms.z6.layers.water >= 1 && info.decodedZooms.z9.layers.poi_rail >= 1);

  // Corrupt PMTiles rejection check
  const badBuf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  let badThrew = false;
  try {
    const badArc = new PMTiles(new MemoryPMTilesSource('bad', badBuf));
    await badArc.getHeader();
  } catch {
    badThrew = true;
  }
  assert(badThrew, 'Corrupted/truncated PMTiles header must fail cleanly');
  return { vectorLayerIds: info.vectorLayerIds, z9Layers: info.decodedZooms.z9.layers };
});

await runCase('c04_02_offline_sdf_glyphs_sprites_and_license_verification', async () => {
  const assetManifest = JSON.parse(readFileSync(path.resolve('C04_ASSET_LICENSE_MANIFEST.json'), 'utf8'));
  assert(assetManifest.externalCdnRequired === false);
  for (const f of assetManifest.fonts) {
    const raw = readFileSync(path.resolve(f.file));
    const digest = createHash('sha256').update(raw).digest('hex');
    equal(digest, f.sha256, 'Glyph PBF hash matches manifest: ' + f.file);
    const decoded = readGlyphPbfIds(raw);
    equal(decoded.glyphIds.length, f.glyphCount, 'Decoded PBF glyph count');
  }
  for (const s of assetManifest.sprites) {
    const raw = readFileSync(path.resolve(s.file));
    const digest = createHash('sha256').update(raw).digest('hex');
    equal(digest, s.sha256, 'Sprite hash matches manifest: ' + s.file);
    if (s.file.endsWith('.json')) {
      const parsed = JSON.parse(raw.toString('utf8'));
      for (const reqIcon of ['station-major', 'station-selected', 'train-loco', 'train-selected', 'yard-depot', 'direction-arrow', 'junction-node']) {
        assert(Boolean(parsed[reqIcon]), 'Missing required original sprite icon: ' + reqIcon);
      }
    }
  }
  assert(existsSync(path.resolve('assets/fonts/Inter Regular/0-255.pbf')));
  return { fontCount: assetManifest.fonts.length, spriteCount: assetManifest.sprites.length };
});

await runCase('c04_03_manifest_parity_style_offline_check_and_soi_boundary_gate', async () => {
  const graph = new RailGraph(bundle.graphPack);
  const manifest = decodeC04TileManifest(bundle.tileBuildManifest);
  equal(manifest.regionId, graph.regionId);

  const ok = verifyGraphTilesBundleMatch(graph, bundle.regionManifest, bundle.tileBuildManifest, RAILWAY_CEO_STYLE_VERSION);
  assert(ok.ok, 'Authoritative graph/region/tile/style bundle must match');

  // Mismatch checks: wrong PMTiles sha256, wrong styleVersion, placeholder zero sha256
  const badTile = { ...bundle.tileBuildManifest, pmtilesSha256: 'f'.repeat(64) };
  assert(!verifyGraphTilesBundleMatch(graph, bundle.regionManifest, badTile, RAILWAY_CEO_STYLE_VERSION).ok);
  assert(!verifyGraphTilesBundleMatch(graph, bundle.regionManifest, bundle.tileBuildManifest, 'wrong-style-v99').ok);
  const placeholderRegion = { ...bundle.regionManifest, tilesSha256: '0'.repeat(64) };
  assert(!verifyGraphTilesBundleMatch(graph, placeholderRegion, bundle.tileBuildManifest, RAILWAY_CEO_STYLE_VERSION).ok);

  // Offline style checks: zero external HTTP URLs allowed, approved boundaries require acquired SoI asset
  const styleOk = buildOfflineMapStyle({
    pmtilesSourceUrl: 'pmtiles://synthetic',
    spriteUrl: './assets/sprites/railway-sprites',
    glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
    attribution: manifest.attribution,
    boundaryContract: DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
  });
  assert(validateOfflineStyleNoExternalUrls(styleOk).ok);
  assert(!styleOk.sources['soi-boundary'], 'Unacquired SoI boundary source must remain absent');

  const styleBadCdn = buildOfflineMapStyle({
    pmtilesSourceUrl: 'https://external-cdn.invalid/tiles.json',
    spriteUrl: './assets/sprites/railway-sprites',
    glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
    attribution: manifest.attribution,
  });
  const extCheck = validateOfflineStyleNoExternalUrls(styleBadCdn);
  assert(!extCheck.ok && extCheck.violations.length === 1);

  // Survey of India contract must reject unacquired approval
  let soiThrew = false;
  try {
    decodeBoundaryLayerContract({
      schemaVersion: 1,
      sourceStandard: 'Survey of India',
      assetAcquired: false,
      approvedForPoliticalView: true,
      layerUrl: null,
      assetSha256: null,
      license: null,
      attribution: null,
    });
  } catch {
    soiThrew = true;
  }
  assert(soiThrew, 'Political boundary view cannot be approved without acquired SoI asset');
});

await runCase('c04_04_webgl_fallback_and_renderer_lifecycle_integration', async () => {
  // Verify detectWebGLSupport returns graceful failure when Canvas/WebGL absent
  const noGl = detectWebGLSupport(() => ({ getContext: () => null }));
  assert(!noGl.supported && noGl.reason === 'WEBGL_CONTEXT_UNAVAILABLE');

  // Verify registerOfflineProtocols binds pmtiles:// & offlinefont:// and cleans up on dispose()
  const registered = new Map();
  const fakeMapLibre = {
    addProtocol(name, fn) { registered.set(name, fn); },
    removeProtocol(name) { registered.delete(name); },
  };
  const pmBytes = readFileSync(pmtilesPath);
  const emptyFont = readFileSync(path.resolve('assets/fonts/_empty/0-255.pbf'));
  const regFont = readFileSync(path.resolve('assets/fonts/Inter Regular/0-255.pbf'));
  const registrar = registerOfflineProtocols(
    fakeMapLibre,
    Protocol,
    PMTiles,
    new Map([['synthetic', pmBytes]]),
    {
      ranges: new Map([['Inter Regular/0-255.pbf', regFont]]),
      fallbackEmptyRange: emptyFont,
    },
  );
  assert(registered.has('pmtiles') && registered.has('offlinefont'));
  const fontRes = await registered.get('offlinefont')({ url: 'offlinefont://Inter%20Regular/0-255.pbf' }, new AbortController());
  assert(fontRes.data.byteLength === regFont.byteLength);
  const fallbackRes = await registered.get('offlinefont')({ url: 'offlinefont://Inter%20Regular/256-511.pbf' }, new AbortController());
  assert(fallbackRes.data.byteLength === emptyFont.byteLength);
  registrar.dispose();
  assert(!registered.has('pmtiles') && !registered.has('offlinefont'));

  // Verify RailwayMapRenderer integration with C03 RailGraph, RailSpatialIndex & R33 prepareMovement without second clock
  const graph = new RailGraph(bundle.graphPack);
  const spatialIndex = new RailSpatialIndex(graph);
  const profile = { id: 'p-bg', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 500000, massKg: 100000 };
  const policy = { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [] };
  const stIds = graph.snapshot().stations.map((s) => s.id).filter((id) => id.startsWith('s:node:1'));
  // Route between WGT (n:1001) -> RBJ (n:1003) -> MVC (n:1005)
  const wgt = graph.snapshot().stations.find((s) => s.name === 'Westgate Terminal');
  const mvc = graph.snapshot().stations.find((s) => s.name === 'Midvalley Central');
  const req = {
    routeId: 'c04-r1',
    graphSha256: graph.graphSha256,
    trainProfileSha256: await profileHash(profile),
    policySha256: await policyHash(policy),
    profile,
    policy,
    stopIds: [wgt.id, mvc.id],
    objective: 'distance',
    initialOperating: { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 },
    maxLabels: 10000,
    maxWork: 50000,
  };
  const route = await findRoute(graph, req);
  assert(route.ok, 'C04 corridor route found cleanly on C03 graph');
  const routeProfile = buildRouteGeometryProfile(graph, route);

  // Mock minimal MapLibre Map to test RailwayMapRenderer with real R33 prepareMovement state & zoom simplification invariants
  const sourceData = new Map();
  const listeners = new Map();
  const layoutProps = new Map();
  let removed = false;
  let cam = { lng: 86.08, lat: 22.06, zoom: 10 };
  const origDoc = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => ({}) }),
  };
  try {
    class MockMap {
      constructor() {}
      on(ev, a, b) {
        const key = b ? `${ev}:${a}` : ev;
        const fn = b ?? a;
        const arr = listeners.get(key) ?? [];
        arr.push(fn);
        listeners.set(key, arr);
      }
      once(ev, fn) { this.on(ev, fn); }
      getSource(id) {
        return { setData: (d) => sourceData.set(id, d) };
      }
      getLayer(id) { return { id }; }
      setLayoutProperty(l, n, v) { layoutProps.set(`${l}:${n}`, v); }
      getBounds() { return { getWest: () => 85.85, getSouth: () => 21.85, getEast: () => 86.38, getNorth: () => 22.25 }; }
      getZoom() { return cam.zoom; }
      getCenter() { return { lng: cam.lng, lat: cam.lat }; }
      getBearing() { return 0; }
      getPitch() { return 0; }
      jumpTo(o) { if (o.center) { cam.lng = o.center[0]; cam.lat = o.center[1]; } if (o.zoom !== undefined) cam.zoom = o.zoom; }
      easeTo(o) { this.jumpTo(o); }
      zoomIn() { cam.zoom++; }
      zoomOut() { cam.zoom--; }
      resize() {}
      getCanvas() { return { addEventListener: () => {} }; }
      remove() { removed = true; }
    }

    const renderer = new RailwayMapRenderer({
      container: {},
      maplibregl: { Map: MockMap },
      graph,
      spatialIndex,
      regionManifest: bundle.regionManifest,
      tileManifest: bundle.tileBuildManifest,
      pmtilesSourceUrl: 'pmtiles://synthetic',
      spriteUrl: './assets/sprites/railway-sprites',
      glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
    });
    for (const fn of listeners.get('load') ?? []) fn({});
    equal(renderer.state, 'READY');

    // Run R33 single authoritative movement engine
    const fields = ['name', 'kind', 'traction', 'gaugesMm', 'voltagesV', 'frequenciesHz', 'maxSpeedKmh', 'rangeM', 'capacitySeats', 'cargoCapacityKg', 'purchasePriceMinor', 'massKg', 'energyPerKm'];
    const prov = { sourceUrl: 'urn:railway:synthetic:c04', sourceId: 'cat', sourceVersion: '1', license: 'ODbL-1.0', qualityFlags: ['SYNTHETIC_NOT_REAL_DATA'] };
    const cat = await RollingStockCatalog.prepare({
      schemaVersion: 1,
      id: 'c04-cat',
      revision: 1,
      currency: 'INR',
      entries: [{
        name: 'Electric Express',
        kind: 'locomotive',
        identity: 'fictional',
        modelRevision: 1,
        model: { ...profile, capacitySeats: 0, cargoCapacityKg: 0, purchasePriceMinor: '1000', provenance: prov },
        energyPerKm: [],
        fieldOrigins: fields.map((f) => ({ field: f, classification: 'game-balanced', evidenceId: null })),
      }],
    });
    const turnNodes = Array.from(new Set(route.steps.filter((s) => s.turnPenaltyS > 0).map((s) => s.from)));
    const edgeBindings = route.route.edgeIds.map((eid, idx) => ({ edgeId: eid, resourceId: `blk-e${idx}` }));
    const nodeBindings = turnNodes.map((nid, idx) => ({ nodeId: nid, resourceId: `blk-n${idx}` }));
    const infra = {
      schemaVersion: 1,
      resources: [
        ...edgeBindings.map((b) => ({ id: b.resourceId, capacity: 1 })),
        ...nodeBindings.map((b) => ({ id: b.resourceId, capacity: 1 })),
      ],
      edges: edgeBindings,
      nodes: nodeBindings,
    };
    const plan = { id: 'p1', catalogReference: cat.reference(profile.id), request: req, route, dynamics: { accelerationS: 20, brakingS: 20, dwellS: [] } };
    const originNode = route.stopAnchors[0];
    const mov = await prepareMovement(graph, cat, infra, [plan], [{ trainId: 't-100', catalogReference: cat.reference(profile.id), nodeId: originNode }], { maxTrips: 4, maxPending: 20 });
    let sim = await mov.initialize(0, 99);
    sim = await mov.reserve(sim, { tripId: 'trip-1', trainId: 't-100', planId: 'p1', departureSimS: 0 });
    const adv = await mov.advance(sim, 300, 100);
    const insp = await mov.inspect(adv.snapshot);

    const projected = renderer.updateTrainStates(new Map([['p1', routeProfile]]), insp);
    equal(projected.length, 1);
    const z10Pos = projected[0].coordinates;
    // Zoom changes simplification of rendered tracks WITHOUT changing simulated train position or edge distance!
    renderer.setZoom(5);
    const projectedZ5 = renderer.updateTrainStates(new Map([['p1', routeProfile]]), insp);
    equal(projectedZ5[0].coordinates, z10Pos, 'Train position invariant across zoom levels');
    // Boundary layer toggle rejected because boundary asset is not acquired
    renderer.setLayerGroupVisibility('boundary', true);
    assert(!layoutProps.has('soi-approved-boundary-line:visibility'), 'Unacquired SoI boundary cannot be toggled visible');
    renderer.dispose();
    assert(removed && renderer.state === 'DISPOSED');
  } finally {
    if (origDoc === undefined) delete globalThis.document;
    else globalThis.document = origDoc;
  }
});

await runCase('c04_05_adversarial_offline_url_and_protocol_blocking', async () => {
  const originOpts = {
    allowedOrigin: 'http://127.0.0.1:4173',
    allowedArchiveIds: ['synthetic', 'in-east-pilot'],
  };

  // 1. Preserve all legitimate offline URLs and exact same-origin URLs
  const allowedUrls = [
    './assets/sprites/railway-sprites',
    '../assets/sprites/railway-sprites',
    '/assets/sprites/railway-sprites',
    'pmtiles://synthetic',
    'pmtiles://synthetic/{z}/{x}/{y}',
    'pmtiles://in-east-pilot/12/3027/1790.pbf',
    'offlinefont://{fontstack}/{range}.pbf',
    'offlinefont://Inter%20Regular/0-255.pbf',
    'offlinefont://Inter%20Regular,Inter%20SemiBold/0-255.pbf',
    'localasset://boundaries/soi-v1.geojson',
    'http://127.0.0.1:4173/assets/sprites/railway-sprites',
  ];
  for (const u of allowedUrls) {
    assert(isPermittedOfflineUrl(u, originOpts), `Legitimate offline URL rejected: ${u}`);
  }

  // 2. Reject all 3 coordinator-identified negative bypass classes + adversarial vectors
  const blockedUrls = [
    // Class A: Scheme-relative external URLs
    '//evil.example/tiles',
    '///evil.example/tiles',
    '/\\evil.example/tiles',
    '\\evil.example\\tiles',
    '/.//evil.example/tiles',
    // Class B: PMTiles wrapping external URLs or unregistered archives
    'pmtiles://https://evil.example/tiles.pmtiles',
    'pmtiles://http://127.0.0.1:4173/tiles.pmtiles',
    'pmtiles:////evil.example/tiles.pmtiles',
    'pmtiles://https%3A%2F%2Fevil.example/tiles.pmtiles',
    'pmtiles://unregistered-pack',
    'pmtiles://synthetic/../../etc/passwd',
    'pmtiles://synthetic?url=https://evil.example',
    // Class C: Lookalike origins bypassing prefix checks
    'http://127.0.0.1:4173.evil.example/sprites',
    'http://127.0.0.1:4173@evil.example/sprites',
    'http://127.0.0.1:41730/sprites',
    'https://127.0.0.1:4173/sprites',
    'http://localhost:4173/sprites',
    // Malformed, control chars, nested protocols, encoded bypasses, backslashes, unsafe schemes
    '',
    '   ',
    ' ./assets/sprites',
    './assets/sprites\nhttps://evil.example',
    'pmtiles://synthetic\u0000',
    '.\\assets\\sprites',
    '/%2f/evil.example/x',
    '/%5c/evil.example/x',
    '/assets/%252e%252e/secret',
    '/assets/%ZZ/sprites',
    'offlinefont://https://evil.example/0-255.pbf',
    'offlinefont://Inter%20Regular/../0-255.pbf',
    'offlinefont://Inter%20Regular\\0-255.pbf',
    'offlinefont://https%3A%2F%2Fevil.example/0-255.pbf',
    'localasset://https://evil.example/x.json',
    'localasset://../secret.json',
    'localasset://a\\b.json',
    'javascript:alert(1)',
    'file:///C:/Windows/win.ini',
    'data:text/javascript,alert(1)',
    'blob:https://evil.example/1234',
    'evil.example/tiles.json',
  ];
  for (const u of blockedUrls) {
    assert(!isPermittedOfflineUrl(u, originOpts), `Adversarial URL was NOT blocked: ${JSON.stringify(u)}`);
  }

  // 3. validateOfflineStyleNoExternalUrls checks sprite arrays, tiles arrays, source data strings & invalid types
  const validSpriteArrayStyle = buildOfflineMapStyle({
    pmtilesSourceUrl: 'pmtiles://synthetic',
    spriteUrl: './assets/sprites/railway-sprites',
    glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
    attribution: 'Synthetic Test',
  });
  validSpriteArrayStyle.sprite = [
    { id: 'default', url: './assets/sprites/railway-sprites' },
    { id: 'local', url: 'http://127.0.0.1:4173/assets/sprites/extra' },
  ];
  assert(validateOfflineStyleNoExternalUrls(validSpriteArrayStyle, originOpts).ok, 'Valid offline sprite array should pass');

  const badSpriteArrayStyle = structuredClone(validSpriteArrayStyle);
  badSpriteArrayStyle.sprite = [
    { id: 'default', url: './assets/sprites/railway-sprites' },
    { id: 'cdn', url: '//evil.example/sprite' },
    { id: 'wrapped', url: 'pmtiles://https://evil.example/x' },
    { id: 'lookalike', url: 'http://127.0.0.1:4173.attacker.tld/sprite' },
    { badShape: true },
  ];
  const badSpriteRes = validateOfflineStyleNoExternalUrls(badSpriteArrayStyle, originOpts);
  assert(!badSpriteRes.ok && badSpriteRes.violations.length === 4, 'Must report all 4 external/malformed sprite array entries');

  const badTilesAndDataStyle = structuredClone(validSpriteArrayStyle);
  badTilesAndDataStyle.sources.basemap.tiles = ['pmtiles://unregistered/{z}/{x}/{y}', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
  badTilesAndDataStyle.sources['soi-boundary'] = { type: 'geojson', data: 'offlinefont://https://evil.example/b.geojson' };
  const badSrcRes = validateOfflineStyleNoExternalUrls(badTilesAndDataStyle, originOpts);
  assert(!badSrcRes.ok && badSrcRes.violations.length === 3, 'Must reject unregistered tile archive, external tile URL, and nested external data URL');

  // 4. Inspect PMTiles protocol adapter: prevent unregistered archive / external network fallback and forged archive keys
  equal(resolveOfflinePMTilesArchiveId('pmtiles://synthetic'), 'synthetic');
  equal(resolveOfflinePMTilesArchiveId('pmtiles://synthetic/12/3027/1790'), 'synthetic');
  equal(resolveOfflinePMTilesArchiveId('pmtiles://https://evil.example/a'), null);
  equal(resolveOfflinePMTilesArchiveId('pmtiles://https%3A%2F%2Fevil.example/a'), null);
  equal(parseSafeOfflineFontPath('offlinefont://Inter%20Regular/0-255.pbf'), 'Inter Regular/0-255.pbf');
  equal(parseSafeOfflineFontPath('offlinefont://Inter%20Regular/../0-255.pbf'), null);

  let badKeyThrew = false;
  try {
    new MemoryPMTilesSource('https://evil.example/a', new Uint8Array([1]));
  } catch {
    badKeyThrew = true;
  }
  assert(badKeyThrew, 'MemoryPMTilesSource must reject URL-like keys');

  let protocolCalls = 0;
  const handlers = new Map();
  class TrackingProtocol extends Protocol {
    async tile(params, ac) {
      protocolCalls++;
      return super.tile(params, ac);
    }
  }
  const pmBytes = readFileSync(pmtilesPath);
  const emptyFont = readFileSync(path.resolve('assets/fonts/_empty/0-255.pbf'));
  const registrar = registerOfflineProtocols(
    {
      addProtocol(name, fn) { handlers.set(name, fn); },
      removeProtocol(name) { handlers.delete(name); },
    },
    TrackingProtocol,
    PMTiles,
    new Map([['synthetic', pmBytes]]),
    { ranges: new Map(), fallbackEmptyRange: emptyFont },
  );

  for (const forbiddenPmtiles of [
    'pmtiles://https://evil.example/a/0/0/0',
    'pmtiles://unregistered-archive/0/0/0',
    'pmtiles://synthetic/../other',
    'pmtiles://http://127.0.0.1:4173/a/0/0/0',
  ]) {
    let blocked = false;
    try {
      await handlers.get('pmtiles')({ url: forbiddenPmtiles }, new AbortController());
    } catch {
      blocked = true;
    }
    assert(blocked, `PMTiles protocol failed to block: ${forbiddenPmtiles}`);
  }
  equal(protocolCalls, 0, 'Underlying pmtiles Protocol.tile (FetchSource fallback) must NEVER be invoked for forbidden or unregistered archives');

  for (const forbiddenFont of [
    'offlinefont://https://evil.example/0-255.pbf',
    'offlinefont://../secret/0-255.pbf',
    'offlinefont://Inter\\0-255.pbf',
  ]) {
    let blocked = false;
    try {
      await handlers.get('offlinefont')({ url: forbiddenFont }, new AbortController());
    } catch {
      blocked = true;
    }
    assert(blocked, `offlinefont protocol failed to block: ${forbiddenFont}`);
  }
  registrar.dispose();

  // 5. Verify RailwayMapRenderer blocks unauthorized resource URLs & unregistered archives fail-closed before Map instantiation
  let mapConstructed = false;
  const origDoc = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  try {
    const graph = new RailGraph(bundle.graphPack);
    const spatialIndex = new RailSpatialIndex(graph);
    for (const [label, patch] of [
      ['schemeRelative', { spriteUrl: '//evil.example/sprite' }],
      ['pmtilesExternal', { pmtilesSourceUrl: 'pmtiles://https://evil.example/t' }],
      ['lookalikeOrigin', { allowedOrigin: 'http://127.0.0.1:4173', spriteUrl: 'http://127.0.0.1:4173.evil.example/sprite' }],
      ['unregisteredArchive', { allowedArchiveIds: ['synthetic'], pmtilesSourceUrl: 'pmtiles://other-pack' }],
    ]) {
      const r = new RailwayMapRenderer({
        container: {},
        maplibregl: { Map: function () { mapConstructed = true; throw new Error('Should never construct Map'); } },
        graph,
        spatialIndex,
        regionManifest: bundle.regionManifest,
        tileManifest: bundle.tileBuildManifest,
        pmtilesSourceUrl: 'pmtiles://synthetic',
        spriteUrl: './assets/sprites/railway-sprites',
        glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
        ...patch,
      });
      assert(r.state === 'MANIFEST_MISMATCH' && r.statusReason.startsWith('EXTERNAL_URL_FORBIDDEN:'), `Renderer must reject ${label}`);
      r.dispose();
    }
    assert(!mapConstructed, 'MapLibre Map constructor must never be called on forbidden offline URL');
  } finally {
    if (origDoc === undefined) delete globalThis.document;
    else globalThis.document = origDoc;
  }

  return {
    allowedChecked: allowedUrls.length,
    blockedChecked: blockedUrls.length,
    protocolFallbackCallsBlocked: 4,
    rendererRejectionChecks: 4,
  };
});

const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(JSON.stringify({ suite: 'c04_contracts_and_tiles', nodeVersion: process.version, total: results.length, passed, failed, realPbfProcessed: false, results }, null, 2));
if (failed > 0) process.exit(1);
