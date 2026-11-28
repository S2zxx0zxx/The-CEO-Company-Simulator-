import * as maplibregl from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import { RailSpatialIndex } from './src/rail/spatial';
import { findRoute, profileHash, policyHash } from './src/rail/routing';
import {
  DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
  RailwayMapRenderer,
  registerOfflineProtocols,
} from './src/rail/map';
import {
  IndexedDbOpfsRegionBackend,
  RegionInstallationManager,
  decodeTrustedRegionAuthority,
  planCrossRegionPortalJourney,
  type PackageArchiveSource,
  type RegionStorageBroadcastEvent,
} from './src/rail/regions';

declare global {
  interface Window {
    __c05Harness?: Record<string, unknown>;
  }
}

async function fetchPackageSource(pkgSlug: string): Promise<PackageArchiveSource> {
  const base = `./fixtures/c05_regions/${pkgSlug}`;
  const envRes = await fetch(`${base}/package_envelope.json`);
  if (!envRes.ok) throw new Error(`HTTP ${envRes.status} loading package_envelope.json`);
  const envelope = await envRes.json();
  return {
    envelope,
    async getEntryBytes(relPath: string): Promise<Uint8Array> {
      const r = await fetch(`${base}/${relPath}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} loading ${relPath}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

async function boot() {
  maplibregl.setWorkerUrl(new URL('./maplibre-gl-worker.js', window.location.href).href);
  const statusEl = document.getElementById('c05-status')!;
  const detailEl = document.getElementById('c05-detail')!;
  const mapEl = document.getElementById('map')!;

  const indexRes = await fetch('./fixtures/c05_regions/trusted_region_index.json');
  const indexJson = await indexRes.json();
  const authority = decodeTrustedRegionAuthority(indexJson.authority);

  const backend = new IndexedDbOpfsRegionBackend({
    dbName: 'railway-ceo-regions-v1',
    preferOpfs: true,
  });
  const mgr = new RegionInstallationManager({
    backend,
    authority,
    expectedStyleVersion: 'c04-rail-style-v1',
    safetyReserveBytes: 512 * 1024,
  });

  const receivedEvents: RegionStorageBroadcastEvent[] = [];
  backend.subscribeEvents((ev) => receivedEvents.push(ev));

  let activeRenderer: RailwayMapRenderer | null = null;
  let activeRegistrar: ReturnType<typeof registerOfflineProtocols> | null = null;

  const [fontRegRes, fontBoldRes, fontEmptyRes] = await Promise.all([
    fetch('./assets/fonts/Inter Regular/0-255.pbf'),
    fetch('./assets/fonts/Inter SemiBold/0-255.pbf'),
    fetch('./assets/fonts/_empty/0-255.pbf'),
  ]);
  const fontMap = {
    ranges: new Map([
      ['Inter Regular/0-255.pbf', new Uint8Array(await fontRegRes.arrayBuffer())],
      ['Inter SemiBold/0-255.pbf', new Uint8Array(await fontBoldRes.arrayBuffer())],
    ]),
    fallbackEmptyRange: new Uint8Array(await fontEmptyRes.arrayBuffer()),
  };

  async function renderRegionFromInstalledStorage(regionId: string) {
    if (activeRenderer) {
      activeRenderer.dispose();
      activeRenderer = null;
    }
    if (activeRegistrar) {
      activeRegistrar.dispose();
      activeRegistrar = null;
    }
    const activeMap = await mgr.inspectActiveVersions();
    const ver = activeMap.get(regionId);
    if (!ver) {
      throw new Error(`Region ${regionId} is not installed/activated`);
    }
    const arts = await mgr.openVersionArtifacts(ver.versionKey);
    const registrar = registerOfflineProtocols(
      maplibregl as unknown as Parameters<typeof registerOfflineProtocols>[0],
      Protocol as unknown as Parameters<typeof registerOfflineProtocols>[1],
      PMTiles as unknown as Parameters<typeof registerOfflineProtocols>[2],
      new Map([[ver.regionId, arts.pmtilesSource]]),
      fontMap,
    );
    activeRegistrar = registrar;

    const spatialIndex = new RailSpatialIndex(arts.graph);
    const origin = window.location.origin;
    const renderer = new RailwayMapRenderer({
      container: mapEl,
      maplibregl: maplibregl as unknown as { Map: new (opts: Record<string, unknown>) => never },
      graph: arts.graph,
      spatialIndex,
      regionManifest: arts.regionManifest,
      tileManifest: arts.tileManifest,
      pmtilesSourceUrl: `pmtiles://${ver.regionId}`,
      spriteUrl: `${origin}/assets/sprites/railway-sprites`,
      glyphsUrl: 'offlinefont://{fontstack}/{range}.pbf',
      allowedOrigin: origin,
      allowedArchiveIds: registrar.registeredArchiveIds,
      boundaryContract: DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
      initialCenter: [
        (ver.bounds[0] + ver.bounds[2]) / 2,
        (ver.bounds[1] + ver.bounds[3]) / 2,
      ],
      initialZoom: 10,
      onInteraction() {
        // event hook active
      },
    });
    activeRenderer = renderer;
    const mapState = await renderer.waitUntilReady(15000);
    // Pan slightly to ensure tile slices load via VerifiedInstalledPMTilesSource
    await new Promise((r) => setTimeout(r, 350));
    const telemetry = arts.pmtilesSource.getTelemetry();
    statusEl.textContent = `${regionId}@${ver.version} | ${mapState} | ${backend.activeBinaryStoreMode}`;
    detailEl.textContent = `stations=${arts.graph.snapshot().stations.length} rangeReads=${telemetry.rangeReadCount} bytes=${telemetry.totalBytesRead}/${telemetry.expectedByteLength}`;
    return {
      mapState,
      versionKey: ver.versionKey,
      stationCount: arts.graph.snapshot().stations.length,
      binaryStoreMode: backend.activeBinaryStoreMode,
      telemetry,
    };
  }

  window.__c05Harness = {
    getStatus: async () => {
      const quota = await backend.checkStorageQuota();
      const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
      return {
        storageNamespace: backend.storageNamespace,
        binaryStoreMode: backend.activeBinaryStoreMode,
        physicalDeviceVerified: backend.physicalDeviceVerified,
        quota,
        indexedDbNames: dbs.map((d) => d.name),
        hasSaveDbOverlap: dbs.some((d) => d.name === 'railway-ceo-save-v1'),
      };
    },
    installPackage: async (pkgSlug: string, opts: Record<string, unknown> = {}) => {
      const src = await fetchPackageSource(pkgSlug);
      const t0 = performance.now();
      try {
        const res = await mgr.installPackage(src, {
          allowUnknownQuota: false,
          ...(opts as object),
        });
        return {
          threwCrash: false,
          elapsedMs: Math.round((performance.now() - t0) * 100) / 100,
          result: res,
        };
      } catch (err) {
        return {
          threwCrash: true,
          errorName: err instanceof Error ? err.name : 'Error',
          errorMessage: err instanceof Error ? err.message : String(err),
          elapsedMs: Math.round((performance.now() - t0) * 100) / 100,
        };
      }
    },
    recoverInstallations: async () => {
      const t0 = performance.now();
      const res = await mgr.recoverInstallations();
      return { elapsedMs: Math.round((performance.now() - t0) * 100) / 100, ...res };
    },
    inspectInstalledRegions: async () => mgr.inspectInstalledRegions(),
    inspectActiveVersions: async () => Object.fromEntries(await mgr.inspectActiveVersions()),
    rollbackRegion: async (regionId: string, targetVk?: string) => {
      const t0 = performance.now();
      const res = await mgr.rollbackRegion(regionId, targetVk);
      return { elapsedMs: Math.round((performance.now() - t0) * 100) / 100, ...res };
    },
    pinRef: async (vk: string, kind: 'activeRoutes' | 'activeMovements' | 'pinnedSaveHeads', id: string) =>
      mgr.pinVersionReference(vk, kind, id),
    unpinRef: async (vk: string, kind: 'activeRoutes' | 'activeMovements' | 'pinnedSaveHeads', id: string) =>
      mgr.unpinVersionReference(vk, kind, id),
    removeUnusedVersion: async (vk: string) => mgr.removeUnusedVersion(vk),
    verifyIntegrity: async (vk?: string) => mgr.verifyInstalledIntegrity(vk),
    renderActiveRegionMap: renderRegionFromInstalledStorage,
    planCrossRegionPortal: async () => {
      const active = await mgr.inspectActiveVersions();
      const eastVer = active.get('in-east-c05');
      const northVer = active.get('in-north-c05');
      if (!eastVer || !northVer) return { ok: false, reason: 'BOTH_REGIONS_NOT_ACTIVE' };
      const [eastArts, northArts] = await Promise.all([
        mgr.openVersionArtifacts(eastVer.versionKey),
        mgr.openVersionArtifacts(northVer.versionKey),
      ]);
      const portal = eastArts.portalSet?.portals[0];
      if (!portal) return { ok: false, reason: 'PORTAL_MISSING' };
      const elProfile = {
        id: 'loco-e5-browser',
        traction: 'electric' as const,
        gaugesMm: [1676],
        voltagesV: [25000],
        frequenciesHz: [50],
        maxSpeedKmh: 120,
        rangeM: 500000,
        massKg: 112000,
      };
      const policy = { schemaVersion: 1 as const, mode: 'Realism' as const, allowReversal: false, inferences: [], modeChanges: [] };
      const [pSha, polSha] = await Promise.all([profileHash(elProfile), policyHash(policy)]);
      const originSt = eastArts.graph.snapshot().stations.find((s) => s.name === 'Eastside Origin')!;
      const destSt = northArts.graph.snapshot().stations.find((s) => s.name === 'Summit Terminal')!;
      return planCrossRegionPortalJourney({
        portal,
        activeVersions: active,
        graphsByRegionId: new Map([
          ['in-east-c05', eastArts.graph],
          ['in-north-c05', northArts.graph],
        ]),
        originStationId: originSt.id,
        destinationStationId: destSt.id,
        profile: elProfile,
        profileSha256: pSha,
        policy,
        policySha256: polSha,
      });
    },
    corruptCommittedPmtiles: async (versionKey: string) => {
      const reg = await mgr.inspectInstalledRegions();
      const ver = reg.versions.find((v) => v.versionKey === versionKey);
      if (!ver) throw new Error(`Unknown version: ${versionKey}`);
      const pmKey = ver.assets.find((a) => a.role === 'pmtiles')!.assetKey;
      await backend.deleteCommittedAsset(pmKey);
      return pmKey;
    },
    listStagingKeys: async () => backend.listStagingKeys(),
    getReceivedEvents: () => [...receivedEvents],
    concurrentLockStress: async (holdMs: number) => {
      return backend.withExclusiveLock('region-registry-op', async () => {
        const start = performance.now();
        await new Promise((r) => setTimeout(r, holdMs));
        const reg = await mgr.inspectInstalledRegions();
        return { revision: reg.revision, heldMs: Math.round(performance.now() - start) };
      });
    },
  };

  statusEl.textContent = 'C05_HARNESS_READY';
}

boot().catch((err) => {
  const el = document.getElementById('c05-status');
  if (el) el.textContent = `BOOT_ERROR: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
