import * as maplibregl from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import { RailGraph } from './src/rail/graph';
import { buildRouteGeometryProfile } from './src/rail/geometry';
import { RailSpatialIndex } from './src/rail/spatial';
import { findRoute, profileHash, policyHash } from './src/rail/routing';
import { RollingStockCatalog } from './src/rail/catalog';
import { prepareMovement } from './src/rail/movement';
import {
  DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
  RAILWAY_CEO_STYLE_VERSION,
  RailwayMapRenderer,
  registerOfflineProtocols,
} from './src/rail/map';

declare global {
  interface Window {
    __c04Harness?: Record<string, unknown>;
  }
}

async function boot() {
  maplibregl.setWorkerUrl(new URL('./maplibre-gl-worker.js', window.location.href).href);
  const statusEl = document.getElementById('c04-status')!;
  const detailEl = document.getElementById('c04-detail')!;
  const mapEl = document.getElementById('map')!;

  const [bundleRes, pmtilesRes, fontRegRes, fontBoldRes, fontEmptyRes] = await Promise.all([
    fetch('./fixtures/c04_synthetic_graph_bundle.json'),
    fetch('./fixtures/c04_synthetic_basemap.pmtiles'),
    fetch('./assets/fonts/Inter Regular/0-255.pbf'),
    fetch('./assets/fonts/Inter SemiBold/0-255.pbf'),
    fetch('./assets/fonts/_empty/0-255.pbf'),
  ]);

  const bundle = await bundleRes.json();
  const pmBytes = new Uint8Array(await pmtilesRes.arrayBuffer());
  const regPbf = new Uint8Array(await fontRegRes.arrayBuffer());
  const boldPbf = new Uint8Array(await fontBoldRes.arrayBuffer());
  const emptyPbf = new Uint8Array(await fontEmptyRes.arrayBuffer());

  const registrar = registerOfflineProtocols(
    maplibregl as unknown as Parameters<typeof registerOfflineProtocols>[0],
    Protocol as unknown as Parameters<typeof registerOfflineProtocols>[1],
    PMTiles as unknown as Parameters<typeof registerOfflineProtocols>[2],
    new Map([['synthetic', pmBytes]]),
    {
      ranges: new Map([
        ['Inter Regular/0-255.pbf', regPbf],
        ['Inter SemiBold/0-255.pbf', boldPbf],
      ]),
      fallbackEmptyRange: emptyPbf,
    },
  );

  const graph = new RailGraph(bundle.graphPack);
  const spatialIndex = new RailSpatialIndex(graph);
  const interactions: unknown[] = [];
  const errors: string[] = [];

  const origin = window.location.origin;
  const mapProxyFactory = {
    Map: function WrappedMap(mopts: Record<string, unknown>) {
      const inst = new (maplibregl as unknown as { Map: new (o: Record<string, unknown>) => unknown }).Map(mopts);
      (window as unknown as { __mapRef?: unknown }).__mapRef = inst;
      return inst;
    },
  };
  const renderer = new RailwayMapRenderer({
    container: mapEl,
    maplibregl: mapProxyFactory as unknown as { Map: new (opts: Record<string, unknown>) => never },
    graph,
    spatialIndex,
    regionManifest: bundle.regionManifest,
    tileManifest: bundle.tileBuildManifest,
    pmtilesSourceUrl: 'pmtiles://synthetic',
    spriteUrl: `${origin}/assets/sprites/railway-sprites`,
    glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
    allowedOrigin: origin,
    boundaryContract: DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
    initialCenter: [86.09, 22.07],
    initialZoom: 10,
    onInteraction(ev) {
      interactions.push(ev);
      if (ev.type === 'tile_error') errors.push(ev.reason);
      if (ev.type === 'tap_station') {
        detailEl.textContent = `Station ${ev.name} (${ev.stationId})`;
      } else if (ev.type === 'tap_train') {
        detailEl.textContent = `Train ${ev.trainId} on ${ev.planId}`;
      }
    },
  });

  const readyState = await renderer.waitUntilReady(15000);
  statusEl.textContent = `${readyState} | ${RAILWAY_CEO_STYLE_VERSION}`;

  // Prepare 2 R09/R33 authoritative simulated routes on the C03 graph
  const elProfile = { id: 'loco-e1-bg', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 500000, massKg: 115000 };
  const dlProfile = { id: 'loco-d2-bg', traction: 'diesel', gaugesMm: [1676], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 90, rangeM: 500000, massKg: 108000 };
  const policy = { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [] };
  const pShaEl = await profileHash(elProfile);
  const pShaDl = await profileHash(dlProfile);
  const polSha = await policyHash(policy);

  const stByName = (name: string) => graph.snapshot().stations.find((s) => s.name === name)!;
  const wgt = stByName('Westgate Terminal');
  const rbj = stByName('Riverbend Junction');
  const mvc = stByName('Midvalley Central');
  const ept = stByName('Eastport Terminal');
  const hlt = stByName('Highland terminus');

  const req1 = {
    routeId: 'route-main-el',
    graphSha256: graph.graphSha256,
    trainProfileSha256: pShaEl,
    policySha256: polSha,
    profile: elProfile,
    policy,
    stopIds: [wgt.id, mvc.id, ept.id],
    objective: 'distance',
    initialOperating: { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 },
    maxLabels: 10000,
    maxWork: 50000,
  };
  const req2 = {
    routeId: 'route-branch-dl',
    graphSha256: graph.graphSha256,
    trainProfileSha256: pShaDl,
    policySha256: polSha,
    profile: dlProfile,
    policy,
    stopIds: [rbj.id, hlt.id],
    objective: 'time',
    initialOperating: { mode: 'diesel', gaugeMm: 1676, voltageV: null, frequencyHz: null },
    maxLabels: 10000,
    maxWork: 50000,
  };

  const r1 = await findRoute(graph, req1);
  const r2 = await findRoute(graph, req2);
  if (!r1.ok || !r2.ok) throw new Error(`Route setup failed: r1=${r1.ok} r2=${r2.ok}`);

  const rp1 = buildRouteGeometryProfile(graph, r1);
  const rp2 = buildRouteGeometryProfile(graph, r2);
  const profileMap = new Map([
    ['plan-el', rp1],
    ['plan-dl', rp2],
  ]);

  const toOverlay = (id: string, name: string, colorHex: string, prof: ReturnType<typeof buildRouteGeometryProfile>) => ({
    routeId: id,
    name,
    colorHex,
    edgeIds: prof.spans.map((s) => s.edgeId),
    coordinates: prof.spans.flatMap((s, idx) => (idx === 0 ? s.geometry : s.geometry.slice(1))),
  });

  renderer.setCompanyRoutes([
    toOverlay('route-main-el', 'East Corridor Express', '#059669', rp1),
    toOverlay('route-branch-dl', 'Highland Diesel Shuttle', '#0284c7', rp2),
  ]);
  renderer.setCompanyYards([
    {
      yardId: 'yard-rbj-1',
      baseId: 'base-rbj',
      stationId: rbj.id,
      name: 'Riverbend Yard (C26)',
      coordinates: [rbj.coordinates[0] + 0.002, rbj.coordinates[1] - 0.002],
    },
  ]);

  // R33 Single Authoritative Simulation Clock & Movement Preparation
  const fields = ['name', 'kind', 'traction', 'gaugesMm', 'voltagesV', 'frequenciesHz', 'maxSpeedKmh', 'rangeM', 'capacitySeats', 'cargoCapacityKg', 'purchasePriceMinor', 'massKg', 'energyPerKm'];
  const prov = { sourceUrl: 'urn:railway:synthetic:c04', sourceId: 'cat', sourceVersion: '1', license: 'ODbL-1.0', qualityFlags: ['SYNTHETIC_NOT_REAL_DATA'] };
  const mkEntry = (name: string, p: Record<string, unknown>) => ({
    name,
    kind: 'locomotive',
    identity: 'fictional',
    modelRevision: 1,
    model: { ...p, capacitySeats: 0, cargoCapacityKg: 0, purchasePriceMinor: '1000', provenance: prov },
    energyPerKm: [],
    fieldOrigins: fields.map((f) => ({ field: f, classification: 'game-balanced', evidenceId: null })),
  });
  const cat = await RollingStockCatalog.prepare({
    schemaVersion: 1,
    id: 'cat-c04-ui',
    revision: 1,
    currency: 'INR',
    entries: [mkEntry('Synth Electric Express', elProfile), mkEntry('Synth Diesel Branch', dlProfile)],
  });

  const allEdgeIds = Array.from(new Set([...r1.route.edgeIds, ...r2.route.edgeIds]));
  const corridors = new Map<string, string>();
  let corrIdx = 0;
  const infraEdges = allEdgeIds.map((eid) => {
    const e = graph.edge(eid);
    const pair = [e.from, e.to].sort().join('__');
    if (!corridors.has(pair)) corridors.set(pair, `blk-e${++corrIdx}`);
    return { edgeId: eid, resourceId: corridors.get(pair)! };
  });
  const waitNodes = Array.from(new Set([
    r1.stopAnchors[1],
    ...r1.steps.filter((s) => s.turnPenaltyS > 0).map((s) => s.from),
    ...r2.steps.filter((s) => s.turnPenaltyS > 0).map((s) => s.from),
  ]));
  const infraNodes = waitNodes.map((nid, idx) => ({ nodeId: nid, resourceId: `blk-n${idx + 1}` }));
  const infra = {
    schemaVersion: 1,
    resources: [
      ...Array.from(new Set(infraEdges.map((x) => x.resourceId))).map((rid) => ({ id: rid, capacity: 2 })),
      ...infraNodes.map((x) => ({ id: x.resourceId, capacity: 2 })),
    ],
    edges: infraEdges,
    nodes: infraNodes,
  };

  const mov = await prepareMovement(
    graph,
    cat,
    infra,
    [
      { id: 'plan-el', catalogReference: cat.reference(elProfile.id), request: req1, route: r1, dynamics: { accelerationS: 20, brakingS: 20, dwellS: [15] } },
      { id: 'plan-dl', catalogReference: cat.reference(dlProfile.id), request: req2, route: r2, dynamics: { accelerationS: 20, brakingS: 20, dwellS: [] } },
    ],
    [
      { trainId: 'TRAIN-E1', catalogReference: cat.reference(elProfile.id), nodeId: r1.stopAnchors[0] },
      { trainId: 'TRAIN-D2', catalogReference: cat.reference(dlProfile.id), nodeId: r2.stopAnchors[0] },
    ],
    { maxTrips: 10, maxPending: 40 },
  );

  let simSnap = await mov.initialize(0, 1337);
  simSnap = await mov.reserve(simSnap, { tripId: 'trip-e1', trainId: 'TRAIN-E1', planId: 'plan-el', departureSimS: 1 });
  simSnap = await mov.reserve(simSnap, { tripId: 'trip-d2', trainId: 'TRAIN-D2', planId: 'plan-dl', departureSimS: 1 });
  let simTimeS = 0;

  async function advanceAndProject(deltaS: number) {
    if (deltaS > 0) {
      simTimeS += deltaS;
      const adv = await mov.advance(simSnap, simTimeS, 100);
      simSnap = adv.snapshot;
    }
    const insp = await mov.inspect(simSnap);
    return renderer.updateTrainStates(profileMap, insp);
  }

  let latestProjected = await advanceAndProject(240);

  window.__c04Harness = {
    readyState: () => renderer.state,
    getErrors: () => [...errors],
    getInteractions: () => [...interactions],
    queryVisibleFeatureCounts: () => {
      const m = (renderer as unknown as Record<string, unknown>);
      const mapRef = (window as unknown as { __mapRef?: { queryRenderedFeatures(opts: unknown): { layer: { id: string } }[] } }).__mapRef;
      if (!mapRef) return {};
      const counts: Record<string, number> = {};
      for (const lid of ['basemap-water', 'basemap-waterway-river', 'basemap-roads-major', 'basemap-landuse-urban', 'c03-civilian-rail-core', 'c03-station-markers', 'c03-trains-markers', 'c03-company-routes-line']) {
        try {
          counts[lid] = mapRef.queryRenderedFeatures({ layers: [lid] }).length;
        } catch {
          counts[lid] = -1;
        }
      }
      return counts;
    },
    setZoomAndCenter: async (z: number, lon: number, lat: number) => {
      const m = (renderer as unknown as { ['#map']?: unknown });
      renderer.resetCamera();
      renderer.setZoom(z);
      // Center safely via public follow/locate or zoom jump
      const mapInst = mapEl as unknown as { __mapRef?: { jumpTo(o: unknown): void } };
      renderer.resize();
      await new Promise((r) => setTimeout(r, 400));
      return { zoom: z };
    },
    setCameraDirect: async (z: number, lon: number, lat: number) => {
      // Wait for tiles to settle via map idle/render frame
      renderer.setZoom(z);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await new Promise((r) => setTimeout(r, 350));
      return renderer.syncViewportLayers(true);
    },
    locateStation: async (name: string, z = 12) => {
      const s = stByName(name);
      renderer.locateBase(s.id, z);
      await new Promise((r) => setTimeout(r, 450));
      renderer.syncViewportLayers(true);
      return s.id;
    },
    selectRoute: (id: string | null) => renderer.selectRoute(id),
    setPreview: (on: boolean) => renderer.setPreviewRoute(on ? rp2 : null),
    selectAndFollowTrain: async (trainId: string | null, z = 14) => {
      renderer.setZoom(z);
      renderer.followTrain(trainId);
      await new Promise((r) => setTimeout(r, 450));
      renderer.syncViewportLayers(true);
    },
    stepSimulation: async (deltaS: number) => {
      latestProjected = await advanceAndProject(deltaS);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return latestProjected;
    },
    getProjectedTrains: () => latestProjected,
    toggleLayer: (group: Parameters<RailwayMapRenderer['setLayerGroupVisibility']>[0], v: boolean) => {
      renderer.setLayerGroupVisibility(group, v);
      return renderer.statusReason;
    },
    triggerCorruptedManifestCheck: () => {
      const badDiv = document.createElement('div');
      const badRenderer = new RailwayMapRenderer({
        container: badDiv,
        maplibregl: maplibregl as unknown as { Map: new (opts: Record<string, unknown>) => never },
        graph,
        spatialIndex,
        regionManifest: { ...bundle.regionManifest, tilesSha256: 'f'.repeat(64) },
        tileManifest: bundle.tileBuildManifest,
        pmtilesSourceUrl: 'pmtiles://synthetic',
        spriteUrl: `${origin}/assets/sprites/railway-sprites`,
        glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
      });
      const out = { state: badRenderer.state, reason: badRenderer.statusReason };
      badRenderer.dispose();
      return out;
    },
    triggerWebGLContextLossCheck: () => {
      const canvas = document.querySelector('#map canvas');
      if (!canvas) return { dispatched: false };
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      return {
        dispatched: true,
        lostSeen: interactions.some((i) => (i as { type?: string }).type === 'webgl_context_lost'),
        restoredSeen: interactions.some((i) => (i as { type?: string }).type === 'webgl_context_restored'),
      };
    },
    measureFramePerf: async (frames = 36) => {
      // 1. Measure pure WebGL rendering + C03 route-geometry interpolation frames (no R32 SHA-256 commit work)
      const pureDeltas: number[] = [];
      let prev = performance.now();
      const baseInsp = await mov.inspect(simSnap);
      for (let i = 0; i < frames; i++) {
        renderer.updateTrainStates(profileMap, baseInsp, new Map([['TRAIN-E1', i * 12], ['TRAIN-D2', i * 9]]));
        await new Promise((resolve) =>
          requestAnimationFrame((now) => {
            pureDeltas.push(now - prev);
            prev = now;
            resolve(null);
          }),
        );
      }
      const pureSorted = [...pureDeltas].sort((a, b) => a - b);
      const pureAvg = pureDeltas.reduce((a, b) => a + b, 0) / pureDeltas.length;
      const pureP95 = pureSorted[Math.min(pureSorted.length - 1, Math.floor(pureSorted.length * 0.95))];

      // 2. Measure coupled R33 mov.advance + projection + WebGL frame
      const coupledDeltas: number[] = [];
      prev = performance.now();
      for (let i = 0; i < 18; i++) {
        latestProjected = await advanceAndProject(i % 3 === 0 ? 5 : 0);
        await new Promise((resolve) =>
          requestAnimationFrame((now) => {
            coupledDeltas.push(now - prev);
            prev = now;
            resolve(null);
          }),
        );
      }
      const cAvg = coupledDeltas.reduce((a, b) => a + b, 0) / coupledDeltas.length;
      const cSorted = [...coupledDeltas].sort((a, b) => a - b);
      const cP95 = cSorted[Math.min(cSorted.length - 1, Math.floor(cSorted.length * 0.95))];
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
      return {
        pureRenderFrames: pureDeltas.length,
        pureRenderAvgFrameMs: Math.round(pureAvg * 100) / 100,
        pureRenderP95FrameMs: Math.round(pureP95 * 100) / 100,
        pureRenderApproxFps: pureAvg > 0 ? Math.round((1000 / pureAvg) * 10) / 10 : 0,
        coupledSimRenderFrames: coupledDeltas.length,
        coupledAvgFrameMs: Math.round(cAvg * 100) / 100,
        coupledP95FrameMs: Math.round(cP95 * 100) / 100,
        coupledApproxFps: cAvg > 0 ? Math.round((1000 / cAvg) * 10) / 10 : 0,
        usedJSHeapBytes: mem?.usedJSHeapSize ?? null,
        totalJSHeapBytes: mem?.totalJSHeapSize ?? null,
      };
    },
    dispose: () => {
      renderer.dispose();
      registrar.dispose();
      return renderer.state;
    },
  };
}

void boot().catch((err) => {
  const el = document.getElementById('c04-status');
  if (el) el.textContent = 'BOOT_ERROR: ' + String(err);
  window.__c04Harness = { bootError: String(err && err.stack ? err.stack : err) };
});
