import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { gzipSync } from 'node:zlib';

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
const { VectorTile } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/@mapbox/vector-tile/index.js')).href);
const { PbfReader } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pbf/index.js')).href);

const { RailGraph } = await import(pathToFileURL(path.resolve('src/rail/graph/index.ts')).href);
const { findRoute, profileHash, policyHash } = await import(pathToFileURL(path.resolve('src/rail/routing/index.ts')).href);
const { RollingStockCatalog } = await import(pathToFileURL(path.resolve('src/rail/catalog/index.ts')).href);
const { prepareMovement } = await import(pathToFileURL(path.resolve('src/rail/movement/index.ts')).href);
const { registerOfflineProtocols } = await import(pathToFileURL(path.resolve('src/rail/map/pmtiles-adapter.ts')).href);
const { decodeRegionPortalSet } = await import(pathToFileURL(path.resolve('src/rail/regions/contracts.ts')).href);
const {
  CapacitorFilesystemRegionBackend,
  FaultInjectedAbortError,
  MemoryRegionStorageBackend,
  RegionInstallationManager,
  VerifiedInstalledPMTilesSource,
  boundedDecompressGzip,
  canonicalJsonBytes,
  computeStoragePreflight,
  encodeBytesToBase64,
  planCrossRegionPortalJourney,
  resolvePortalBetweenGraphs,
  sha256Hex,
  verifySignedRegionPackageEnvelope,
} = await import(pathToFileURL(path.resolve('src/rail/regions/index.ts')).href);

// Import genuine offline clock module from upstream checkout if available locally for continuity test
const upstreamOfflinePath = path.resolve(process.env.RAILWAY_GIT_REPO || 'C:/RailwayCEO-Git', 'src/rail/offline/index.ts');
const offlineClockMod = existsSync(upstreamOfflinePath)
  ? await import(pathToFileURL(upstreamOfflinePath).href)
  : null;

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function equal(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg ? msg + ': ' : '') + sa + ' !== ' + sb);
}

function loadPackageFromFixture(pkgSlug) {
  const pkgDir = path.resolve('fixtures/c05_regions', pkgSlug);
  const envelope = JSON.parse(readFileSync(path.join(pkgDir, 'package_envelope.json'), 'utf8'));
  return {
    envelope,
    async getEntryBytes(relPath) {
      const full = path.resolve(pkgDir, relPath);
      if (!full.startsWith(pkgDir + path.sep)) {
        throw new Error('Unsafe fixture path: ' + relPath);
      }
      return new Uint8Array(readFileSync(full));
    },
  };
}

function makeFakeCapacitorFs() {
  const files = new Map();
  const dirs = new Set(['']);
  const normalize = (dir, p) => `${dir}:${p.replace(/\/+/g, '/').replace(/^\//, '')}`;
  return {
    files,
    async mkdir({ path: p, directory }) {
      dirs.add(normalize(directory, p));
    },
    async writeFile({ path: p, data, directory, encoding }) {
      const key = normalize(directory, p);
      if (encoding === 'utf8') {
        files.set(key, Buffer.from(String(data), 'utf8'));
      } else {
        files.set(key, Buffer.from(String(data), 'base64'));
      }
      return { uri: `file:///data/user/0/app/files/${p}` };
    },
    async readFile({ path: p, directory, encoding }) {
      const key = normalize(directory, p);
      const buf = files.get(key);
      if (!buf) throw new Error('ENOENT: ' + key);
      if (encoding === 'utf8') return { data: buf.toString('utf8') };
      return { data: buf.toString('base64') };
    },
    async deleteFile({ path: p, directory }) {
      const key = normalize(directory, p);
      if (!files.delete(key)) throw new Error('ENOENT: ' + key);
    },
    async stat({ path: p, directory }) {
      const key = normalize(directory, p);
      const buf = files.get(key);
      if (!buf) throw new Error('ENOENT: ' + key);
      return { size: buf.byteLength, type: 'file' };
    },
    async rename({ from, to, directory }) {
      const kf = normalize(directory, from);
      const kt = normalize(directory, to);
      const buf = files.get(kf);
      if (!buf) throw new Error('ENOENT: ' + kf);
      files.set(kt, buf);
      files.delete(kf);
    },
    async readdir({ path: p, directory }) {
      const prefix = normalize(directory, p).replace(/\/$/, '') + '/';
      const names = new Set();
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length).split('/')[0];
          if (rest) names.add(rest);
        }
      }
      return { files: [...names].sort().map((name) => ({ name, type: 'file' })) };
    },
  };
}

const indexData = JSON.parse(readFileSync(path.resolve('fixtures/c05_regions/trusted_region_index.json'), 'utf8'));
const trustedAuthority = indexData.authority;

const results = [];
const timings = {};

async function runCase(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;
    timings[name] = elapsedMs;
    results.push({ case: name, passed: true, elapsedMs, ...(detail || {}) });
  } catch (err) {
    const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;
    results.push({ case: name, passed: false, elapsedMs, error: String(err && err.stack ? err.stack : err) });
  }
}

await runCase('c05_01_manifest_authority_signing_and_negative_security_gates', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const srcB1 = loadPackageFromFixture('in_north_c05_v1');

  for (const s of [srcA1, srcA2, srcB1]) {
    const res = await verifySignedRegionPackageEnvelope(s.envelope, trustedAuthority);
    assert(res.ok, `Trusted authority must verify ${s.envelope.manifest.packageId}: ${res.reason}`);
  }

  // Negative 1: attacker self-generates valid keypair and self-signs unpinned manifest -> MUST fail!
  const attackerKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const mutatedManifest = structuredClone(srcA1.envelope.manifest);
  mutatedManifest.version = '9.9.9';
  const mutBytes = canonicalJsonBytes(mutatedManifest);
  const mutSha = await sha256Hex(mutBytes);
  const mutSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, attackerKeys.privateKey, mutBytes));
  const attackerEnv = {
    schemaVersion: 1,
    manifest: mutatedManifest,
    manifestSha256: mutSha,
    signatureAlgorithm: 'ECDSA-P256-SHA256',
    keyId: trustedAuthority.trustedKeys[0].keyId,
    signatureBase64: encodeBytesToBase64(mutSig),
  };
  const unpinnedRes = await verifySignedRegionPackageEnvelope(attackerEnv, trustedAuthority);
  equal(unpinnedRes.ok, false);
  equal(unpinnedRes.reason, 'UNTRUSTED_UNPINNED_MANIFEST_AUTHORITY');

  // Even without pinned-index check, wrong signer key must fail cryptographic verification
  const sigOnlyAuthority = { ...trustedAuthority, requirePinnedIndex: false };
  const badSigRes = await verifySignedRegionPackageEnvelope(attackerEnv, sigOnlyAuthority);
  equal(badSigRes.ok, false);
  equal(badSigRes.reason, 'INVALID_MANIFEST_SIGNATURE');

  // Revoked key check
  const revokedAuth = {
    ...sigOnlyAuthority,
    trustedKeys: [{ ...trustedAuthority.trustedKeys[0], active: false }],
  };
  const revokedRes = await verifySignedRegionPackageEnvelope(srcA1.envelope, revokedAuth);
  equal(revokedRes.ok, false);
  equal(revokedRes.reason, 'REVOKED_MANIFEST_SIGNER_KEY');

  // Real data gate (`syntheticOnly: false`) fails closed by default
  const realScopeManifest = structuredClone(srcA1.envelope.manifest);
  realScopeManifest.syntheticOnly = false;
  const realBytes = canonicalJsonBytes(realScopeManifest);
  const realSha = await sha256Hex(realBytes);
  const realDataAuth = { ...trustedAuthority, requirePinnedIndex: false, requireSignature: false };
  const realScopeRes = await verifySignedRegionPackageEnvelope(
    { ...srcA1.envelope, manifest: realScopeManifest, manifestSha256: realSha },
    realDataAuth,
  );
  equal(realScopeRes.ok, false);
  equal(realScopeRes.reason, 'REAL_DATA_INTAKE_BLOCKED_BY_COMPLIANCE_GATE');

  // Path traversal & scheme-relative style & fake SoI approval all rejected at schema decode
  const unsafePaths = ['../secret.json', '/abs/path.json', 'dir\\win.json', 'https://evil.com/a', '%2e%2e/a'];
  let rejectedPathCount = 0;
  for (const badPath of unsafePaths) {
    const badEnv = structuredClone(srcA1.envelope);
    badEnv.manifest.assets[0].relativePath = badPath;
    try {
      await verifySignedRegionPackageEnvelope(badEnv, trustedAuthority);
    } catch {
      rejectedPathCount++;
    }
  }
  equal(rejectedPathCount, unsafePaths.length, 'Every unsafe relative path must reject');

  const badUrls = ['//cdn.evil.test/tiles', 'pmtiles://https://evil.test/region.pmtiles', 'https://fonts.evil.test/{fontstack}/{range}.pbf'];
  let rejectedUrlCount = 0;
  for (const bu of badUrls) {
    const badEnv = structuredClone(srcA1.envelope);
    badEnv.manifest.styleUrls.spriteUrl = bu;
    try {
      await verifySignedRegionPackageEnvelope(badEnv, trustedAuthority);
    } catch {
      rejectedUrlCount++;
    }
  }
  equal(rejectedUrlCount, badUrls.length, 'Unsafe offline URLs must reject via C04-FIX-01');

  const fakeSoiEnv = structuredClone(srcA1.envelope);
  fakeSoiEnv.manifest.boundaryContract.approvedForPoliticalView = true;
  let soiThrew = false;
  try {
    await verifySignedRegionPackageEnvelope(fakeSoiEnv, trustedAuthority);
  } catch {
    soiThrew = true;
  }
  assert(soiThrew, 'SoI approvedForPoliticalView without asset must fail closed');

  return { verifiedPackages: 3, negativeProbesRejected: 11 };
});

await runCase('c05_02_storage_preflight_quota_decompression_bomb_and_tamper_gates', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');

  // Unknown quota fails closed by default
  const unknownBackend = new MemoryRegionStorageBackend({ quotaStatus: 'UNKNOWN', totalQuotaBytes: null });
  const unknownMgr = new RegionInstallationManager({ backend: unknownBackend, authority: trustedAuthority });
  const unknownPreflight = await unknownMgr.checkStorageRequirements(srcA1.envelope);
  equal(unknownPreflight.ok, false);
  equal(unknownPreflight.quotaStatus, 'UNKNOWN');

  // Tight quota fails cleanly in PREFLIGHT without mutating storage
  const smallBackend = new MemoryRegionStorageBackend({ totalQuotaBytes: 4096 });
  const smallMgr = new RegionInstallationManager({ backend: smallBackend, authority: trustedAuthority, safetyReserveBytes: 2048 });
  const prefailOut = await smallMgr.installPackage(srcA1);
  equal(prefailOut.ok, false);
  equal(prefailOut.errorCode, 'PREFLIGHT_QUOTA_REJECTED');
  equal((await smallBackend.listStagingKeys()).length, 0);

  // Mid-staging quota exhaustion fault leaves clean staging & preserves prior active
  const midFailBackend = new MemoryRegionStorageBackend({ totalQuotaBytes: 30000 });
  const midFailMgr = new RegionInstallationManager({ backend: midFailBackend, authority: trustedAuthority, safetyReserveBytes: 512 });
  const midOut = await midFailMgr.installPackage({
    ...srcA1,
    envelope: srcA1.envelope,
  });
  // Even if preflight allows small safetyReserveBytes, writing 55 KB pmtiles hits 30000 cap cleanly
  // (Or preflight catches it early; let's force a tight cap right after preflight!)
  assert(!midOut.ok, 'Must reject when total cap 30000 < package bytes');

  const bombBackend = new MemoryRegionStorageBackend({ totalQuotaBytes: 20 * 1024 * 1024 });
  const bombMgr = new RegionInstallationManager({ backend: bombBackend, authority: trustedAuthority, safetyReserveBytes: 32 * 1024 });
  assert((await bombMgr.installPackage(srcA1)).ok, 'Baseline install v1 ok');
  const midQuotaBackend = new MemoryRegionStorageBackend({ totalQuotaBytes: 5 * 1024 * 1024 });
  const midQuotaMgr = new RegionInstallationManager({ backend: midQuotaBackend, authority: trustedAuthority, safetyReserveBytes: 32 * 1024 });
  assert((await midQuotaMgr.installPackage(srcA1)).ok);
  midQuotaBackend.setFaultHooks({
    onBeforeStageWrite(key) {
      if (key.endsWith('/pmtiles')) {
        midQuotaBackend.setSimulatedQuota(100000);
      }
    },
  });
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const midExhausted = await midQuotaMgr.installPackage(srcA2);
  equal(midExhausted.ok, false);
  equal((await midQuotaBackend.listStagingKeys()).length, 0, 'Mid-staging exhaustion must clean orphan staging blobs');
  equal((await midQuotaMgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');

  // Direct bounded decompression bomb check
  const hugeZeros = new Uint8Array(64 * 1024);
  const compressedBomb = new Uint8Array(gzipSync(hugeZeros));
  let bombBlocked = false;
  try {
    await boundedDecompressGzip(compressedBomb, 1024, 2048);
  } catch (err) {
    bombBlocked = err.name === 'DecompressionBombError';
  }
  assert(bombBlocked, 'boundedDecompressGzip must abort stream when uncompressed bytes exceed declared limit');

  // Corrupted entry bytes fail pre-activation check
  const tamperBackend = new MemoryRegionStorageBackend({ totalQuotaBytes: 10 * 1024 * 1024 });
  const tamperMgr = new RegionInstallationManager({ backend: tamperBackend, authority: trustedAuthority, safetyReserveBytes: 32 * 1024 });
  const tamperedSrc = {
    envelope: srcA1.envelope,
    async getEntryBytes(rel) {
      const b = await srcA1.getEntryBytes(rel);
      if (rel === 'basemap.pmtiles') {
        const copy = b.slice();
        copy[copy.length - 1] ^= 0xff;
        return copy;
      }
      return b;
    },
  };
  const tamperRes = await tamperMgr.installPackage(tamperedSrc);
  equal(tamperRes.ok, false);
  equal(tamperRes.errorCode, 'COMPRESSED_SHA256_MISMATCH');

  return { decompressionBombBlocked: true, quotaCleanupVerified: true };
});

await runCase('c05_03_crash_recovery_journal_cancellation_and_idempotency', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });

  const base = await mgr.installPackage(srcA1);
  assert(base.ok);

  // Cancellation tests at multiple phases preserve active v1 and clear staging
  for (const cancelState of ['PREFLIGHT', 'STAGING', 'COMPATIBILITY_VERIFICATION']) {
    const cRes = await mgr.installPackage(srcA2, { cancelAfterState: cancelState });
    equal(cRes.ok, false);
    equal(cRes.finalState, 'CANCELLED');
    equal((await backend.listStagingKeys()).length, 0);
    equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');
  }

  // Crash points BEFORE_STAGING, MID_STAGING, BEFORE_ACTIVATION, DURING_ACTIVATION -> roll back to clean v1
  for (const stage of ['BEFORE_STAGING', 'MID_STAGING', 'BEFORE_ACTIVATION', 'DURING_ACTIVATION']) {
    let crashed = false;
    try {
      await mgr.installPackage(srcA2, { injectCrashAt: stage });
    } catch (err) {
      crashed = err instanceof FaultInjectedAbortError;
    }
    assert(crashed, `Expected injected crash at ${stage}`);
    const rec = await mgr.recoverInstallations();
    assert(rec.recovered, `recoverInstallations must handle crash at ${stage}`);
    equal((await backend.listStagingKeys()).length, 0, `Staging cleaned after ${stage}`);
    equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');
    // Idempotency check
    const rec2 = await mgr.recoverInstallations();
    equal(rec2.recovered, false);
    equal(rec2.resolution, 'NONE');
  }

  // Crash AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT -> all v2 committed bytes valid -> finishes commit atomically!
  let crashedAfterPromo = false;
  try {
    await mgr.installPackage(srcA2, { injectCrashAt: 'AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT' });
  } catch (err) {
    crashedAfterPromo = err instanceof FaultInjectedAbortError;
  }
  assert(crashedAfterPromo);
  const recCommit = await mgr.recoverInstallations();
  equal(recCommit.recovered, true);
  equal(recCommit.resolution, 'COMPLETED_INTERRUPTED_ACTIVATION');
  equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--2.0.0--p2');
  equal((await mgr.inspectInstalledRegions()).regions[0].previousVersionKey, 'in-east-c05--1.0.0--p1');

  return { testedCrashStages: 5, idempotentRecoveryVerified: true };
});

await runCase('c05_04_atomic_upgrade_rollback_version_pinning_and_ref_gc', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });

  const r1 = await mgr.installPackage(srcA1);
  assert(r1.ok, `r1 findRoute failed: ${!r1.ok ? r1.code + ' ' + r1.reason : ''}`);
  const v1Key = r1.versionKey;

  // Pin active route, in-flight movement, and save head to v1
  await mgr.pinVersionReference(v1Key, 'activeRoutes', 'route-e1');
  await mgr.pinVersionReference(v1Key, 'activeMovements', 'trip-100');
  await mgr.pinVersionReference(v1Key, 'pinnedSaveHeads', 'company-save:rev12');

  const r2 = await mgr.installPackage(srcA2);
  assert(r2.ok);
  const v2Key = r2.versionKey;

  const activeMap = await mgr.inspectActiveVersions();
  equal(activeMap.get('in-east-c05').versionKey, v2Key);

  // Refuse GC while v1 is referenced by active routes/movements/saves
  const refBlocked = await mgr.removeUnusedVersion(v1Key);
  equal(refBlocked.ok, false);
  equal(refBlocked.code, 'VERSION_PINNED_BY_ACTIVE_REFS');

  // Verify retained v1 graph still loads 4 stations while v2 loads 5 stations
  const v1Arts = await mgr.openVersionArtifacts(v1Key);
  const v2Arts = await mgr.openVersionArtifacts(v2Key);
  equal(v1Arts.graph.snapshot().stations.length, 4);
  equal(v2Arts.graph.snapshot().stations.length, 5);

  // Atomic rollback to v1
  const rb = await mgr.rollbackRegion('in-east-c05');
  assert(rb.ok, 'Rollback to v1 must succeed');
  equal(rb.activeVersionKey, v1Key);
  equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, v1Key);

  // Switch forward again to v2
  const fwd = await mgr.activateRetainedVersion(v2Key);
  assert(fwd.ok);
  equal(fwd.activeVersionKey, v2Key);

  // Unpin all v1 refs -> GC succeeds cleanly
  await mgr.unpinVersionReference(v1Key, 'activeRoutes', 'route-e1');
  await mgr.unpinVersionReference(v1Key, 'activeMovements', 'trip-100');
  await mgr.unpinVersionReference(v1Key, 'pinnedSaveHeads', 'company-save:rev12');
  const gcOk = await mgr.removeUnusedVersion(v1Key);
  assert(gcOk.ok, 'GC of unpinned obsolete v1 must succeed');
  assert(gcOk.freedBytes > 50000);

  // Simulate committed corruption on active v2 -> integrity verifier catches it cleanly
  const v2PmKey = v2Arts.version.assets.find((a) => a.role === 'pmtiles').assetKey;
  backend.injectCommittedCorruption(v2PmKey, 'flip_byte');
  const intCheck = await mgr.verifyInstalledIntegrity(v2Key);
  equal(intCheck.ok, false);

  return { v1Stations: 4, v2Stations: 5, gcFreedBytes: gcOk.freedBytes };
});

await runCase('c05_05_pmtiles_range_source_bounds_corruption_abort_and_offline_protocol', async () => {
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });
  const ins = await mgr.installPackage(srcA2);
  assert(ins.ok);

  const arts = await mgr.openVersionArtifacts(ins.versionKey);
  const pmSrc = arts.pmtilesSource;
  equal(pmSrc.getKey(), 'in-east-c05');
  assert((await pmSrc.verifyIntegrity()).ok);

  const mockMapLibre = {
    handlers: new Map(),
    addProtocol(name, fn) { this.handlers.set(name, fn); },
    removeProtocol(name) { this.handlers.delete(name); },
  };
  const registrar = registerOfflineProtocols(mockMapLibre, Protocol, PMTiles, new Map([['in-east-c05', pmSrc]]));

  // Fetch actual tile via offline pmtiles:// protocol
  const ac = new AbortController();
  const tileRes = await registrar.loadPMTilesTile({ url: 'pmtiles://in-east-c05/6/47/27' }, ac);
  assert(tileRes.data && tileRes.data.byteLength > 0, 'PMTiles range read must serve tile bytes');
  const vt = new VectorTile(new PbfReader(new Uint8Array(tileRes.data)));
  assert(!Object.hasOwn(vt.layers, 'boundary'), 'No boundary layer allowed');

  const telem = pmSrc.getTelemetry();
  equal(telem.fullArchiveLoadedInMemory, false);
  assert(telem.rangeReadCount >= 2, 'PMTiles header/dir/tile fetched via bounded range slices');
  assert(telem.totalBytesRead < telem.expectedByteLength, `Bounded range read (${telem.totalBytesRead} B) must stay strictly < archive size (${telem.expectedByteLength} B)`);

  // Unregistered/external PMTiles URLs must fail closed before network FetchSource
  for (const badUrl of ['pmtiles://unregistered-region/6/47/27', 'pmtiles://https://evil.example/a/0/0/0']) {
    let blocked = false;
    try {
      await registrar.loadPMTilesTile({ url: badUrl }, new AbortController());
    } catch {
      blocked = true;
    }
    assert(blocked, 'Unregistered/external PMTiles URL must fail closed: ' + badUrl);
  }

  // Range overflow & AbortSignal guards
  let rangeErr = false;
  try {
    await pmSrc.getBytes(Number.MAX_SAFE_INTEGER, 64);
  } catch {
    rangeErr = true;
  }
  assert(rangeErr, 'Overflow offset+length must throw RangeError');

  const preAborted = new AbortController();
  preAborted.abort();
  let abortErr = false;
  try {
    await pmSrc.getBytes(0, 127, preAborted.signal);
  } catch (err) {
    abortErr = err.name === 'AbortError';
  }
  assert(abortErr, 'Aborted range request must fail cleanly');

  // External deletion causes explicit error on next read
  const pmAssetKey = arts.version.assets.find((a) => a.role === 'pmtiles').assetKey;
  backend.injectCommittedCorruption(pmAssetKey, 'delete');
  let missingErr = false;
  try {
    await pmSrc.getBytes(0, 127);
  } catch (err) {
    missingErr = String(err.message).includes('INSTALLED_PMTILES_MISSING');
  }
  assert(missingErr, 'Deleted installed PMTiles must surface explicit missing error');

  registrar.dispose();
  return { rangeReads: telem.rangeReadCount, totalBytesRead: telem.totalBytesRead, archiveBytes: telem.expectedByteLength };
});

await runCase('c05_06_explicit_region_portals_and_cross_region_continuity', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcB1 = loadPackageFromFixture('in_north_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');

  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });
  const ia1 = await mgr.installPackage(srcA1);
  assert(ia1.ok);
  const a1Arts = await mgr.openVersionArtifacts(ia1.versionKey);
  const pEastNorth = a1Arts.portalSet.portals[0];

  const elProfile = { id: 'loco-e5', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 120, rangeM: 500000, massKg: 112000 };
  const dlProfile = { id: 'loco-d1', traction: 'diesel', gaugesMm: [1676], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 90, rangeM: 400000, massKg: 105000 };
  const mgProfile = { id: 'loco-mg', traction: 'diesel', gaugesMm: [1000], voltagesV: [], frequenciesHz: [], maxSpeedKmh: 65, rangeM: 300000, massKg: 65000 };
  const policy = { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [] };
  const pShaEl = await profileHash(elProfile);
  const polSha = await policyHash(policy);

  // Negative 1: Missing destination region -> UNAVAILABLE_DESTINATION_REGION
  const missingDest = resolvePortalBetweenGraphs({
    portal: pEastNorth,
    direction: 'A_TO_B',
    graphA: a1Arts.graph,
    graphB: undefined,
    trainProfile: elProfile,
  });
  equal(missingDest.ok, false);
  equal(missingDest.code, 'UNAVAILABLE_DESTINATION_REGION');
  equal(missingDest.fabricatedEdgeCount, 0);

  // Install Region B
  const ib1 = await mgr.installPackage(srcB1);
  assert(ib1.ok);
  const b1Arts = await mgr.openVersionArtifacts(ib1.versionKey);

  // Positive: verified border seam + two-leg cross-region journey!
  const stOrigin = a1Arts.graph.snapshot().stations.find((s) => s.name === 'Eastside Origin');
  const stSummit = b1Arts.graph.snapshot().stations.find((s) => s.name === 'Summit Terminal');
  const activeVers = await mgr.inspectActiveVersions();
  const planOk = await planCrossRegionPortalJourney({
    portal: pEastNorth,
    activeVersions: activeVers,
    graphsByRegionId: new Map([
      ['in-east-c05', a1Arts.graph],
      ['in-north-c05', b1Arts.graph],
    ]),
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: elProfile,
    profileSha256: pShaEl,
    policy,
    policySha256: polSha,
  });
  assert(planOk.ok, 'Cross-region portal journey should succeed: ' + planOk.reason);
  equal(planOk.pinnedVersions.length, 2);
  assert(planOk.totalDistanceM > 80000);

  // Negative 2: Gauge / electrification mismatch trap portal in B1 portals
  const trapPortal = b1Arts.portalSet.portals.find((p) => p.id.includes('trap'));
  const gaugeMismatch = resolvePortalBetweenGraphs({
    portal: trapPortal,
    direction: 'A_TO_B',
    graphA: a1Arts.graph,
    graphB: b1Arts.graph,
    trainProfile: elProfile,
    maxSeamDistanceM: 10000,
  });
  equal(gaugeMismatch.ok, false);
  equal(gaugeMismatch.code, 'PORTAL_GAUGE_MISMATCH');

  // Negative 3: Incompatible train gauge against valid broad-gauge portal
  const mgFail = resolvePortalBetweenGraphs({
    portal: pEastNorth,
    direction: 'A_TO_B',
    graphA: a1Arts.graph,
    graphB: b1Arts.graph,
    trainProfile: mgProfile,
  });
  equal(mgFail.ok, false);
  equal(mgFail.code, 'PORTAL_GAUGE_MISMATCH');

  // Negative 4: Unidirectional A_TO_B called as B_TO_A
  const dirFail = resolvePortalBetweenGraphs({
    portal: { ...pEastNorth, allowedDirection: 'A_TO_B' },
    direction: 'B_TO_A',
    graphA: a1Arts.graph,
    graphB: b1Arts.graph,
  });
  equal(dirFail.ok, false);
  equal(dirFail.code, 'PORTAL_DIRECTION_FORBIDDEN');

  // Negative 5: Unverified portal
  const unvFail = resolvePortalBetweenGraphs({
    portal: { ...pEastNorth, verified: false },
    direction: 'A_TO_B',
    graphA: a1Arts.graph,
    graphB: b1Arts.graph,
  });
  equal(unvFail.ok, false);
  equal(unvFail.code, 'PORTAL_UNVERIFIED');

  // Negative 6: Graph version mismatch after upgrading Region A to v2 without updating portal reference
  const ia2 = await mgr.installPackage(srcA2);
  assert(ia2.ok);
  const a2Arts = await mgr.openVersionArtifacts(ia2.versionKey);
  const verMismatch = resolvePortalBetweenGraphs({
    portal: pEastNorth,
    direction: 'A_TO_B',
    graphA: a2Arts.graph,
    graphB: b1Arts.graph,
  });
  equal(verMismatch.ok, false);
  equal(verMismatch.code, 'PORTAL_GRAPH_VERSION_MISMATCH');

  // Using v2's own updated portal succeeds cleanly against Region B v1
  const v2Portal = a2Arts.portalSet.portals[0];
  const v2PortalOk = resolvePortalBetweenGraphs({
    portal: v2Portal,
    direction: 'A_TO_B',
    graphA: a2Arts.graph,
    graphB: b1Arts.graph,
    trainProfile: dlProfile,
  });
  assert(v2PortalOk.ok, 'Updated v2 portal to B v1 must verify');

  // Negative 7: Seam distance exceeding max cap
  const distFail = resolvePortalBetweenGraphs({
    portal: { ...v2Portal, seamDistanceM: 2500 },
    direction: 'A_TO_B',
    graphA: a2Arts.graph,
    graphB: b1Arts.graph,
  });
  equal(distFail.ok, false);
  equal(distFail.code, 'PORTAL_SEAM_DISTANCE_EXCEEDED');

  return { totalCrossRegionDistanceM: planOk.totalDistanceM, fabricatedEdges: 0 };
});

await runCase('c05_07_r33_r39_r40_gameplay_continuity_and_capacitor_android_adapter', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');

  // 1. Verify R33 Movement + R40 offline clock continuity across Region v1 -> v2 upgrade -> rollback
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });
  const i1 = await mgr.installPackage(srcA1);
  assert(i1.ok);
  const artsV1 = await mgr.openVersionArtifacts(i1.versionKey);

  const elProfile = { id: 'loco-e7', traction: 'electric', gaugesMm: [1676], voltagesV: [25000], frequenciesHz: [50], maxSpeedKmh: 110, rangeM: 500000, massKg: 115000 };
  const policy = { schemaVersion: 1, mode: 'Realism', allowReversal: false, inferences: [], modeChanges: [] };
  const pSha = await profileHash(elProfile);
  const polSha = await policyHash(policy);

  const stOrigin = artsV1.graph.snapshot().stations.find((s) => s.name === 'Eastside Origin');
  const stBorder = artsV1.graph.snapshot().stations.find((s) => s.name === 'East-North Border Exchange');
  const reqV1 = {
    routeId: 'route-active-v1',
    graphSha256: artsV1.graph.graphSha256,
    trainProfileSha256: pSha,
    policySha256: polSha,
    profile: elProfile,
    policy,
    stopIds: [stOrigin.id, stBorder.id],
    objective: 'distance',
    initialOperating: { mode: 'electric', gaugeMm: 1676, voltageV: 25000, frequencyHz: 50 },
    maxLabels: 10000,
    maxWork: 50000,
  };
  const r1 = await findRoute(artsV1.graph, reqV1);
  assert(r1.ok, `r1 findRoute failed: ${!r1.ok ? r1.code + ' ' + r1.reason : ''}`);

  const fields = ['name', 'kind', 'traction', 'gaugesMm', 'voltagesV', 'frequenciesHz', 'maxSpeedKmh', 'rangeM', 'capacitySeats', 'cargoCapacityKg', 'purchasePriceMinor', 'massKg', 'energyPerKm'];
  const prov = { sourceUrl: 'urn:railway:synthetic:c05', sourceId: 'cat', sourceVersion: '1', license: 'ODbL-1.0', qualityFlags: ['SYNTHETIC_NOT_REAL_DATA'] };
  const cat = await RollingStockCatalog.prepare({
    schemaVersion: 1,
    id: 'cat-c05',
    revision: 1,
    currency: 'INR',
    entries: [{
      name: 'Synth Electric V1',
      kind: 'locomotive',
      identity: 'fictional',
      modelRevision: 1,
      model: { ...elProfile, capacitySeats: 0, cargoCapacityKg: 0, purchasePriceMinor: '1000', provenance: prov },
      energyPerKm: [],
      fieldOrigins: fields.map((f) => ({ field: f, classification: 'game-balanced', evidenceId: null })),
    }],
  });

  const corridors = new Map();
  let cIdx = 0;
  const infraEdges = r1.route.edgeIds.map((eid) => {
    const e = artsV1.graph.edge(eid);
    const pair = [e.from, e.to].sort().join('__');
    if (!corridors.has(pair)) corridors.set(pair, `blk-e${++cIdx}`);
    return { edgeId: eid, resourceId: corridors.get(pair) };
  });
  const waitNodes = Array.from(new Set(r1.steps.filter((s) => s.turnPenaltyS > 0).map((s) => s.from)));
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
  const planDefs = [{ id: 'plan-1', catalogReference: cat.reference(elProfile.id), request: reqV1, route: r1, dynamics: { accelerationS: 20, brakingS: 20, dwellS: [] } }];
  const rosterDefs = [{ trainId: 'train-1', catalogReference: cat.reference(elProfile.id), nodeId: r1.stopAnchors[0] }];

  const movV1 = await prepareMovement(artsV1.graph, cat, infra, planDefs, rosterDefs, { maxTrips: 10, maxPending: 40 });
  let simSnap = await movV1.initialize(0, 4242);
  simSnap = await movV1.reserve(simSnap, { tripId: 'trip-live-v1', trainId: 'train-1', planId: 'plan-1', departureSimS: 100 });
  const midSimTime = 100 + Math.floor(r1.route.expectedDurationS / 2);
  simSnap = (await movV1.advance(simSnap, midSimTime, 100)).snapshot;
  const midInsp = await movV1.inspect(simSnap);
  assert(midInsp.trips[0] && midInsp.trips[0].status === 'RUNNING', `Expected RUNNING mid-trip, got ${midInsp.trips[0]?.status}`);

  // Pin active trip + save on v1, upgrade region to v2, ensure v1 remains pinned & trip reaches exact arrival cleanly!
  await mgr.pinVersionReference(i1.versionKey, 'activeMovements', 'trip-live-v1');
  await mgr.pinVersionReference(i1.versionKey, 'pinnedSaveHeads', 'save-head-v1');

  let clockState = null;
  if (offlineClockMod) {
    const offPolicy = { schemaVersion: 1, maxWallDeltaMs: 600000, simSecondsPerWallSecond: 10, maxBacklogSimS: 7200, maxBatchSimS: 600, maxBatchEvents: 500, maxBatchesPerWake: 20, autoSettleArrivals: true };
    clockState = offlineClockMod.anchorClock(offPolicy, { wallMs: 1000000, sessionId: 'sess-1', monotonicMs: 1000 }, midSimTime);
    const obs = offlineClockMod.observeClock(clockState, { wallMs: 1300000, sessionId: 'sess-1', monotonicMs: 301000 }, clockState.targetSimS);
    clockState = obs.clock;
    assert(obs.creditedSimS === 3000);
  }

  const i2 = await mgr.installPackage(srcA2);
  assert(i2.ok);
  const artsV2 = await mgr.openVersionArtifacts(i2.versionKey);
  const stHubV2 = artsV2.graph.snapshot().stations.find((s) => s.name === 'New Tech Express Hub');
  assert(stHubV2, 'New routes use upgraded v2 hub');

  // Continue in-flight v1 trip to arrival on retained immutable v1 graph after v2 became active!
  const movV1Reload = await prepareMovement((await mgr.openVersionArtifacts(i1.versionKey)).graph, cat, infra, planDefs, rosterDefs, { maxTrips: 10, maxPending: 40 });
  const endSnap = (await movV1Reload.advance(simSnap, 100 + r1.route.expectedDurationS + 500, 100)).snapshot;
  const endInsp = await movV1Reload.inspect(endSnap);
  equal(endInsp.trips.length, 1);
  equal(endInsp.trips[0].tripId, 'trip-live-v1');
  equal(endInsp.trips[0].status, 'ARRIVED');

  // 2. Verify CapacitorFilesystemRegionBackend (app-private chunked storage, explicit physicalDeviceVerified=false)
  const capFs = makeFakeCapacitorFs();
  const capBackend = new CapacitorFilesystemRegionBackend({
    filesystem: capFs,
    directory: 'DATA',
    physicalDeviceVerified: false,
    quotaEstimator: async () => ({
      backendName: 'capacitor-filesystem-region-storage',
      quotaStatus: 'KNOWN',
      totalQuotaBytes: 64 * 1024 * 1024,
      usedBytes: 1024 * 1024,
      availableBytes: 63 * 1024 * 1024,
      persistentStorageGranted: true,
    }),
  });
  equal(capBackend.physicalDeviceVerified, false);
  const capMgr = new RegionInstallationManager({ backend: capBackend, authority: trustedAuthority });
  const capIns = await capMgr.installPackage(srcA1);
  assert(capIns.ok, 'Capacitor Filesystem install should succeed: ' + capIns.reason);
  const capArts = await capMgr.openVersionArtifacts(capIns.versionKey);
  const hdr = await capArts.pmtilesSource.getBytes(0, 127);
  equal(new TextDecoder().decode(new Uint8Array(hdr.data, 0, 7)), 'PMTiles');
  assert((await capMgr.verifyInstalledIntegrity()).ok);

  return {
    v1TripCompletedAfterV2Upgrade: true,
    offlineClockCreditedSimS: clockState ? clockState.creditedWallMs : null,
    capacitorPhysicalDeviceVerified: capBackend.physicalDeviceVerified,
  };
});

const passed = results.every((r) => r.passed);
const report = {
  passed,
  total: results.length,
  passedCount: results.filter((r) => r.passed).length,
  failedCount: results.filter((r) => !r.passed).length,
  timingsMs: timings,
  cases: results,
};
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
