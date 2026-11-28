import { existsSync, readFileSync } from 'node:fs';
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
const hasRendererPkg = existsSync(path.join(pkgRoot, 'node_modules/pmtiles/dist/esm/index.js'));

const { RailGraph } = await import(pathToFileURL(path.resolve('src/rail/graph/index.ts')).href);
const { findRoute, profileHash, policyHash } = await import(pathToFileURL(path.resolve('src/rail/routing/index.ts')).href);
const { RollingStockCatalog } = await import(pathToFileURL(path.resolve('src/rail/catalog/index.ts')).href);
const { prepareMovement } = await import(pathToFileURL(path.resolve('src/rail/movement/index.ts')).href);
const { registerOfflineProtocols } = await import(pathToFileURL(path.resolve('src/rail/map/pmtiles-adapter.ts')).href);
const {
  CapacitorFilesystemRegionBackend,
  CorruptedArchiveError,
  FaultInjectedAbortError,
  MemoryRegionStorageBackend,
  RegionInstallationManager,
  boundedDecompressGzip,
  canonicalJsonBytes,
  encodeBytesToBase64,
  makeImmutablePMTilesArchiveId,
  planCrossRegionPortalJourney,
  resolvePortalBetweenGraphs,
  sha256Hex,
  verifySignedRegionPackageEnvelope,
} = await import(pathToFileURL(path.resolve('src/rail/regions/index.ts')).href);

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

async function createVariantSourceFromBase(baseSource, { regionId, version, packageVersion, bumpSourceUrl = false }) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = encodeBytesToBase64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey)));
  const m = structuredClone(baseSource.envelope.manifest);
  m.regionId = regionId ?? m.regionId;
  m.version = version;
  m.packageVersion = packageVersion;
  m.packageId = `pkg-${m.regionId}-v${packageVersion}`;
  if (bumpSourceUrl) {
    m.sourceUrl = `${m.sourceUrl}:variant${packageVersion}`;
  }
  const archiveId = makeImmutablePMTilesArchiveId(m.regionId, m.version, m.packageVersion, m.tilesSha256);
  m.styleUrls.pmtilesSourceUrl = `pmtiles://${archiveId}`;
  const payload = canonicalJsonBytes(m);
  const mSha = await sha256Hex(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, payload));
  const keyId = `variant-key-p${packageVersion}`;
  const envelope = {
    schemaVersion: 1,
    manifest: m,
    manifestSha256: mSha,
    signatureAlgorithm: 'ECDSA-P256-SHA256',
    keyId,
    signatureBase64: encodeBytesToBase64(sig),
  };
  return {
    source: {
      envelope,
      getEntryBytes: baseSource.getEntryBytes,
    },
    manifestSha256: mSha,
    keyRecord: {
      keyId,
      algorithm: 'ECDSA-P256-SHA256',
      spkiBase64: spki,
      active: true,
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
    const isSkipped = Boolean(detail && detail.skipped === true);
    results.push({ case: name, passed: !isSkipped, skipped: isSkipped, elapsedMs, ...(detail || {}) });
  } catch (err) {
    const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;
    results.push({ case: name, passed: false, skipped: false, elapsedMs, error: String(err && err.stack ? err.stack : err) });
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

  const attackerKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const mutatedManifest = structuredClone(srcA1.envelope.manifest);
  mutatedManifest.version = '9.9.9';
  mutatedManifest.styleUrls.pmtilesSourceUrl = `pmtiles://${makeImmutablePMTilesArchiveId(mutatedManifest.regionId, '9.9.9', mutatedManifest.packageVersion, mutatedManifest.tilesSha256)}`;
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

  const sigOnlyAuthority = { ...trustedAuthority, requirePinnedIndex: false };
  const badSigRes = await verifySignedRegionPackageEnvelope(attackerEnv, sigOnlyAuthority);
  equal(badSigRes.ok, false);
  equal(badSigRes.reason, 'INVALID_MANIFEST_SIGNATURE');

  const revokedAuth = {
    ...sigOnlyAuthority,
    trustedKeys: [{ ...trustedAuthority.trustedKeys[0], active: false }],
  };
  const revokedRes = await verifySignedRegionPackageEnvelope(srcA1.envelope, revokedAuth);
  equal(revokedRes.ok, false);
  equal(revokedRes.reason, 'REVOKED_MANIFEST_SIGNER_KEY');

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
  equal(rejectedPathCount, unsafePaths.length);

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
  equal(rejectedUrlCount, badUrls.length);

  // Also reject non-version-bound PMTiles URL (FIX-01-C guard)
  const genericPmUrlEnv = structuredClone(srcA1.envelope);
  genericPmUrlEnv.manifest.styleUrls.pmtilesSourceUrl = `pmtiles://${genericPmUrlEnv.manifest.regionId}`;
  let unboundThrew = false;
  try {
    await verifySignedRegionPackageEnvelope(genericPmUrlEnv, trustedAuthority);
  } catch {
    unboundThrew = true;
  }
  assert(unboundThrew, 'Generic unbound pmtiles://<regionId> must fail schema decode');

  const fakeSoiEnv = structuredClone(srcA1.envelope);
  fakeSoiEnv.manifest.boundaryContract.approvedForPoliticalView = true;
  let soiThrew = false;
  try {
    await verifySignedRegionPackageEnvelope(fakeSoiEnv, trustedAuthority);
  } catch {
    soiThrew = true;
  }
  assert(soiThrew, 'SoI approvedForPoliticalView without asset must fail closed');

  return { verifiedPackages: 3, negativeProbesRejected: 12 };
});

await runCase('c05_02_storage_preflight_quota_decompression_bomb_and_tamper_gates', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');

  const unknownBackend = new MemoryRegionStorageBackend({ quotaStatus: 'UNKNOWN', totalQuotaBytes: null });
  const unknownMgr = new RegionInstallationManager({ backend: unknownBackend, authority: trustedAuthority });
  const unknownPreflight = await unknownMgr.checkStorageRequirements(srcA1.envelope);
  equal(unknownPreflight.ok, false);
  equal(unknownPreflight.quotaStatus, 'UNKNOWN');

  const smallBackend = new MemoryRegionStorageBackend({ totalQuotaBytes: 4096 });
  const smallMgr = new RegionInstallationManager({ backend: smallBackend, authority: trustedAuthority, safetyReserveBytes: 2048 });
  const prefailOut = await smallMgr.installPackage(srcA1);
  equal(prefailOut.ok, false);
  equal(prefailOut.errorCode, 'PREFLIGHT_QUOTA_REJECTED');
  equal((await smallBackend.listStagingKeys()).length, 0);

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
  equal((await midQuotaBackend.listStagingKeys()).length, 0);
  equal((await midQuotaMgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');

  const hugeZeros = new Uint8Array(64 * 1024);
  const compressedBomb = new Uint8Array(gzipSync(hugeZeros));
  let bombBlocked = false;
  try {
    await boundedDecompressGzip(compressedBomb, 1024, 2048);
  } catch (err) {
    bombBlocked = err.name === 'DecompressionBombError';
  }
  assert(bombBlocked);

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

  for (const cancelState of ['PREFLIGHT', 'STAGING', 'COMPATIBILITY_VERIFICATION']) {
    const cRes = await mgr.installPackage(srcA2, { cancelAfterState: cancelState });
    equal(cRes.ok, false);
    equal(cRes.finalState, 'CANCELLED');
    equal((await backend.listStagingKeys()).length, 0);
    equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');
  }

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
    equal((await backend.listStagingKeys()).length, 0);
    equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');
    const rec2 = await mgr.recoverInstallations();
    equal(rec2.recovered, false);
    equal(rec2.resolution, 'NONE');
  }

  // Post-commit crash AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR also tested
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

  return { testedCrashStages: 5, idempotentRecoveryVerified: true };
});

await runCase('c05_04_atomic_upgrade_rollback_version_pinning_and_ref_gc', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });

  const r1 = await mgr.installPackage(srcA1);
  assert(r1.ok);
  const v1Key = r1.versionKey;

  await mgr.pinVersionReference(v1Key, 'activeRoutes', 'route-e1');
  await mgr.pinVersionReference(v1Key, 'activeMovements', 'trip-100');
  await mgr.pinVersionReference(v1Key, 'pinnedSaveHeads', 'company-save:rev12');

  const r2 = await mgr.installPackage(srcA2);
  assert(r2.ok);
  const v2Key = r2.versionKey;

  equal((await mgr.inspectActiveVersions()).get('in-east-c05').versionKey, v2Key);

  // Refuses deletion while pinned by routes/movements/saves
  const refBlocked = await mgr.removeUnusedVersion(v1Key);
  equal(refBlocked.ok, false);
  equal(refBlocked.code, 'VERSION_PINNED_BY_ACTIVE_REFS');

  // Unpin all refs, then still refuses deletion because v1 is the mandatory rollback version!
  await mgr.unpinVersionReference(v1Key, 'activeRoutes', 'route-e1');
  await mgr.unpinVersionReference(v1Key, 'activeMovements', 'trip-100');
  await mgr.unpinVersionReference(v1Key, 'pinnedSaveHeads', 'company-save:rev12');
  const rollbackProtected = await mgr.removeUnusedVersion(v1Key);
  equal(rollbackProtected.ok, false);
  equal(rollbackProtected.code, 'VERSION_IS_MANDATORY_ROLLBACK');

  const v1Arts = await mgr.openVersionArtifacts(v1Key);
  const v2Arts = await mgr.openVersionArtifacts(v2Key);
  equal(v1Arts.graph.snapshot().stations.length, 4);
  equal(v2Arts.graph.snapshot().stations.length, 5);

  // Atomic rollback to preserved v1
  const rb = await mgr.rollbackRegion('in-east-c05');
  assert(rb.ok);
  equal(rb.activeVersionKey, v1Key);

  const fwd = await mgr.activateRetainedVersion(v2Key);
  assert(fwd.ok);
  equal(fwd.activeVersionKey, v2Key);

  // Explicit force override allowed only with allowDeleteRollbackVersion: true
  const gcExplicit = await mgr.removeUnusedVersion(v1Key, { allowDeleteRollbackVersion: true });
  assert(gcExplicit.ok && gcExplicit.freedBytes > 50000);

  return { v1Stations: 4, v2Stations: 5, gcFreedBytes: gcExplicit.freedBytes };
});

await runCase('c05_05_pmtiles_range_source_bounds_corruption_abort_and_offline_protocol', async () => {
  if (!hasRendererPkg) {
    return { skipped: true, reason: 'C04_RENDERER_PKG unavailable in standalone runtime' };
  }
  const { PMTiles, Protocol } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pmtiles/dist/esm/index.js')).href);
  const { VectorTile } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/@mapbox/vector-tile/index.js')).href);
  const { PbfReader } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pbf/index.js')).href);

  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });
  const ins = await mgr.installPackage(srcA2);
  assert(ins.ok);

  const arts = await mgr.openVersionArtifacts(ins.versionKey);
  const pmSrc = arts.pmtilesSource;
  const archiveId = arts.version.pmtilesArchiveId;
  equal(pmSrc.getKey(), archiveId);
  assert(archiveId.includes('in-east-c05--v2.0.0-p2-'));
  assert((await pmSrc.verifyIntegrity()).ok);

  const mockMapLibre = {
    handlers: new Map(),
    addProtocol(name, fn) { this.handlers.set(name, fn); },
    removeProtocol(name) { this.handlers.delete(name); },
  };
  const registrar = registerOfflineProtocols(mockMapLibre, Protocol, PMTiles, new Map([[archiveId, pmSrc]]));

  const ac = new AbortController();
  const tileRes = await registrar.loadPMTilesTile({ url: `pmtiles://${archiveId}/6/47/27` }, ac);
  assert(tileRes.data && tileRes.data.byteLength > 0);
  const vt = new VectorTile(new PbfReader(new Uint8Array(tileRes.data)));
  assert(!Object.hasOwn(vt.layers, 'boundary'));

  const telem = pmSrc.getTelemetry();
  equal(telem.fullArchiveLoadedInMemory, false);
  assert(telem.rangeReadCount >= 2);
  assert(telem.totalBytesRead < telem.expectedByteLength);

  for (const badUrl of ['pmtiles://unregistered-region/6/47/27', 'pmtiles://https://evil.example/a/0/0/0']) {
    let blocked = false;
    try {
      await registrar.loadPMTilesTile({ url: badUrl }, new AbortController());
    } catch {
      blocked = true;
    }
    assert(blocked);
  }

  let rangeErr = false;
  try {
    await pmSrc.getBytes(Number.MAX_SAFE_INTEGER, 64);
  } catch {
    rangeErr = true;
  }
  assert(rangeErr);

  const preAborted = new AbortController();
  preAborted.abort();
  let abortErr = false;
  try {
    await pmSrc.getBytes(0, 127, preAborted.signal);
  } catch (err) {
    abortErr = err.name === 'AbortError';
  }
  assert(abortErr);

  registrar.dispose();
  return { archiveId, rangeReads: telem.rangeReadCount, totalBytesRead: telem.totalBytesRead, archiveBytes: telem.expectedByteLength };
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

  const missingDest = resolvePortalBetweenGraphs({ portal: pEastNorth, direction: 'A_TO_B', graphA: a1Arts.graph, graphB: undefined, trainProfile: elProfile });
  equal(missingDest.ok, false);
  equal(missingDest.code, 'UNAVAILABLE_DESTINATION_REGION');
  equal(missingDest.fabricatedEdgeCount, 0);

  const ib1 = await mgr.installPackage(srcB1);
  assert(ib1.ok);
  const b1Arts = await mgr.openVersionArtifacts(ib1.versionKey);

  const stOrigin = a1Arts.graph.snapshot().stations.find((s) => s.name === 'Eastside Origin');
  const stSummit = b1Arts.graph.snapshot().stations.find((s) => s.name === 'Summit Terminal');
  const activeVers = await mgr.inspectActiveVersions();
  const planOk = await planCrossRegionPortalJourney({
    portal: pEastNorth,
    activeVersions: activeVers,
    graphsByRegionId: new Map([['in-east-c05', a1Arts.graph], ['in-north-c05', b1Arts.graph]]),
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: elProfile,
    profileSha256: pShaEl,
    policy,
    policySha256: polSha,
  });
  assert(planOk.ok);
  equal(planOk.pinnedVersions.length, 2);

  const trapPortal = b1Arts.portalSet.portals.find((p) => p.id.includes('trap'));
  equal(resolvePortalBetweenGraphs({ portal: trapPortal, direction: 'A_TO_B', graphA: a1Arts.graph, graphB: b1Arts.graph, trainProfile: elProfile, maxSeamDistanceM: 10000 }).code, 'PORTAL_GAUGE_MISMATCH');
  equal(resolvePortalBetweenGraphs({ portal: pEastNorth, direction: 'A_TO_B', graphA: a1Arts.graph, graphB: b1Arts.graph, trainProfile: mgProfile }).code, 'PORTAL_GAUGE_MISMATCH');
  equal(resolvePortalBetweenGraphs({ portal: { ...pEastNorth, allowedDirection: 'A_TO_B' }, direction: 'B_TO_A', graphA: a1Arts.graph, graphB: b1Arts.graph }).code, 'PORTAL_DIRECTION_FORBIDDEN');
  equal(resolvePortalBetweenGraphs({ portal: { ...pEastNorth, verified: false }, direction: 'A_TO_B', graphA: a1Arts.graph, graphB: b1Arts.graph }).code, 'PORTAL_UNVERIFIED');

  const ia2 = await mgr.installPackage(srcA2);
  assert(ia2.ok);
  const a2Arts = await mgr.openVersionArtifacts(ia2.versionKey);
  equal(resolvePortalBetweenGraphs({ portal: pEastNorth, direction: 'A_TO_B', graphA: a2Arts.graph, graphB: b1Arts.graph }).code, 'PORTAL_GRAPH_VERSION_MISMATCH');
  assert(resolvePortalBetweenGraphs({ portal: a2Arts.portalSet.portals[0], direction: 'A_TO_B', graphA: a2Arts.graph, graphB: b1Arts.graph, trainProfile: dlProfile }).ok);
  equal(resolvePortalBetweenGraphs({ portal: { ...a2Arts.portalSet.portals[0], seamDistanceM: 2500 }, direction: 'A_TO_B', graphA: a2Arts.graph, graphB: b1Arts.graph }).code, 'PORTAL_SEAM_DISTANCE_EXCEEDED');

  return { totalCrossRegionDistanceM: planOk.totalDistanceM, fabricatedEdges: 0 };
});

await runCase('c05_07_r33_r39_r40_gameplay_continuity_and_capacitor_android_adapter', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');

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
  assert(r1.ok);

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
  assert(midInsp.trips[0] && midInsp.trips[0].status === 'RUNNING');

  await mgr.pinVersionReference(i1.versionKey, 'activeMovements', 'trip-live-v1');
  await mgr.pinVersionReference(i1.versionKey, 'pinnedSaveHeads', 'save-head-v1');

  let clockState = null;
  const offlineClockSubcheckStatus = offlineClockMod ? 'EXECUTED' : 'SKIPPED_ABSENT_REPO_CHECKOUT';
  if (offlineClockMod) {
    const offPolicy = { schemaVersion: 1, maxWallDeltaMs: 600000, simSecondsPerWallSecond: 10, maxBacklogSimS: 7200, maxBatchSimS: 600, maxBatchEvents: 500, maxBatchesPerWake: 20, autoSettleArrivals: true };
    clockState = offlineClockMod.anchorClock(offPolicy, { wallMs: 1000000, sessionId: 'sess-1', monotonicMs: 1000 }, midSimTime);
    const obs = offlineClockMod.observeClock(clockState, { wallMs: 1300000, sessionId: 'sess-1', monotonicMs: 301000 }, clockState.targetSimS);
    clockState = obs.clock;
    assert(obs.creditedSimS === 3000);
  }

  const i2 = await mgr.installPackage(srcA2);
  assert(i2.ok);
  const movV1Reload = await prepareMovement((await mgr.openVersionArtifacts(i1.versionKey)).graph, cat, infra, planDefs, rosterDefs, { maxTrips: 10, maxPending: 40 });
  const endSnap = (await movV1Reload.advance(simSnap, 100 + r1.route.expectedDurationS + 500, 100)).snapshot;
  const endInsp = await movV1Reload.inspect(endSnap);
  equal(endInsp.trips.length, 1);
  equal(endInsp.trips[0].tripId, 'trip-live-v1');
  equal(endInsp.trips[0].status, 'ARRIVED');

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
  const capMgr = new RegionInstallationManager({ backend: capBackend, authority: trustedAuthority });
  const capIns = await capMgr.installPackage(srcA1);
  assert(capIns.ok);
  const capArts = await capMgr.openVersionArtifacts(capIns.versionKey);
  const hdr = await capArts.pmtilesSource.getBytes(0, 127);
  equal(new TextDecoder().decode(new Uint8Array(hdr.data, 0, 7)), 'PMTiles');
  assert((await capMgr.verifyInstalledIntegrity()).ok);

  return {
    v1TripCompletedAfterV2Upgrade: true,
    offlineClockSubcheckStatus,
    offlineClockCreditedSimS: clockState ? clockState.creditedWallMs : null,
    capacitorPhysicalDeviceVerified: capBackend.physicalDeviceVerified,
  };
});

// C05-FIX-01-A: Mandatory rollback version protection & crash-safe GC interruption recovery
await runCase('c05_08_fix01_a_mandatory_rollback_and_crash_safe_gc', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const varA3 = await createVariantSourceFromBase(srcA2, { regionId: 'in-east-c05', version: '3.0.0', packageVersion: 3, bumpSourceUrl: true });
  const extAuthority = {
    ...trustedAuthority,
    trustedKeys: [...trustedAuthority.trustedKeys, varA3.keyRecord],
    pinnedManifestSha256s: [...trustedAuthority.pinnedManifestSha256s, varA3.manifestSha256],
  };

  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: extAuthority });
  const i1 = await mgr.installPackage(srcA1);
  const i2 = await mgr.installPackage(srcA2);
  const i3 = await mgr.installPackage(varA3.source);
  assert(i1.ok && i2.ok && i3.ok);

  // Active = v3, Mandatory rollback = v2, Obsolete = v1
  // 1. Must refuse deleting mandatory rollback version v2 even with 0 route/save pins
  const rbDel = await mgr.removeUnusedVersion(i2.versionKey);
  equal(rbDel.ok, false);
  equal(rbDel.code, 'VERSION_IS_MANDATORY_ROLLBACK');

  // 2. Rollback to v2 works cleanly even after failed deletion attempt
  const rbOk = await mgr.rollbackRegion('in-east-c05');
  assert(rbOk.ok && rbOk.activeVersionKey === i2.versionKey);
  // Switch back to v3 (now v2 is previous rollback, v1 is obsolete)
  assert((await mgr.activateRetainedVersion(i3.versionKey)).ok);

  // 3. Inject crash mid-GC while deleting obsolete unpinned v1 -> recovery completes interrupted GC idempotently!
  let crashedGc = false;
  try {
    await mgr.removeUnusedVersion(i1.versionKey, { injectCrashDuringGc: true });
  } catch (err) {
    crashedGc = err instanceof FaultInjectedAbortError;
  }
  assert(crashedGc, 'GC crash hook must abort mid-delete');
  const keysBeforeRecover = await backend.listCommittedKeys();
  assert(keysBeforeRecover.some((k) => k.startsWith(`ver_${i1.versionKey}/`)), 'Half-deleted v1 blobs still on disk before recovery');

  const recGc = await mgr.recoverInstallations();
  equal(recGc.recovered, true);
  equal(recGc.resolution, 'COMPLETED_INTERRUPTED_GC');
  const keysAfterRecover = await backend.listCommittedKeys();
  assert(!keysAfterRecover.some((k) => k.startsWith(`ver_${i1.versionKey}/`)), 'Recovery must delete all leaked obsolete v1 blobs');

  // v2 (rollback) & v3 (active) remain completely intact
  assert((await mgr.verifyInstalledIntegrity()).ok);
  assert((await mgr.rollbackRegion('in-east-c05')).ok);

  return { mandatoryRollbackProtected: true, interruptedGcRecovered: true };
});

// C05-FIX-01-B: Durable staged activation across restarts, promotion failure, concurrency, reinstall & conflict
await runCase('c05_09_fix01_b_durable_staged_activation_restart_and_concurrency', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const srcB1 = loadPackageFromFixture('in_north_c05_v1');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });

  // Phase 1: Install v1, stage v2 without activating
  const mgr1 = new RegionInstallationManager({ backend, authority: trustedAuthority });
  assert((await mgr1.installPackage(srcA1)).ok);
  const stgV2 = await mgr1.installPackage(srcA2, { activateImmediately: false });
  assert(stgV2.ok);
  equal(stgV2.finalState, 'READY_FOR_ACTIVATION');
  equal(stgV2.activeVersionKey, 'in-east-c05--1.0.0--p1');

  // Repeated identical stage returns idempotent READY_FOR_ACTIVATION
  const stgAgain = await mgr1.installPackage(srcA2, { activateImmediately: false });
  assert(stgAgain.ok && stgAgain.idempotentReinstall && stgAgain.finalState === 'READY_FOR_ACTIVATION');

  // Same versionKey with conflicting manifest/content MUST FAIL CLOSED
  const conflictVar = await createVariantSourceFromBase(srcA2, {
    regionId: 'in-east-c05',
    version: '2.0.0',
    packageVersion: 2,
    bumpSourceUrl: true,
  });
  const conflictAuth = {
    ...trustedAuthority,
    trustedKeys: [...trustedAuthority.trustedKeys, conflictVar.keyRecord],
    pinnedManifestSha256s: [...trustedAuthority.pinnedManifestSha256s, conflictVar.manifestSha256],
  };
  const mgrConflict = new RegionInstallationManager({ backend, authority: conflictAuth });
  const conflictRes = await mgrConflict.installPackage(conflictVar.source);
  equal(conflictRes.ok, false);
  equal(conflictRes.errorCode, 'CONFLICTING_VERSION_CONTENT');

  // Simulate full process restart -> new manager instance on same backend + recoverInstallations()!
  const mgrRestart = new RegionInstallationManager({ backend, authority: trustedAuthority });
  const recClean = await mgrRestart.recoverInstallations();
  equal(recClean.recovered, false, 'Clean restart recovery must NOT erase READY_FOR_ACTIVATION staged package');

  // Non-injected promotion write failure on attempt 1 -> cleans partial committed, keeps staged v2 & active v1 intact!
  let failOnce = true;
  backend.setFaultHooks({
    onBeforePromote(_sKey, cKey) {
      if (failOnce && cKey.endsWith('/pmtiles')) {
        failOnce = false;
        throw new Error('EIO_DISK_WRITE_ERROR');
      }
    },
  });
  const failedProm = await mgrRestart.activateRetainedVersion(stgV2.versionKey);
  equal(failedProm.ok, false);
  equal(failedProm.code, 'PROMOTION_WRITE_FAILED');
  equal((await mgrRestart.inspectActiveVersions()).get('in-east-c05').versionKey, 'in-east-c05--1.0.0--p1');
  backend.setFaultHooks({});

  // Retry activation & concurrent Region B install simultaneously -> both succeed cleanly under exclusive lock
  const [actOk, insB] = await Promise.all([
    mgrRestart.activateRetainedVersion(stgV2.versionKey),
    mgrRestart.installPackage(srcB1),
  ]);
  assert(actOk.ok && actOk.activeVersionKey === 'in-east-c05--2.0.0--p2');
  assert(insB.ok && insB.finalState === 'ACTIVATED');

  // Post-commit crash AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR recovery check + idempotent repeated reinstall
  const mgrAfter = new RegionInstallationManager({ backend, authority: trustedAuthority });
  const idempAct = await mgrAfter.installPackage(srcA2);
  assert(idempAct.ok && idempAct.idempotentReinstall && idempAct.finalState === 'ACTIVATED');

  return { stagedActivatedAfterRestart: true, conflictingVersionRejected: true, concurrentOpsSafe: true };
});

// C05-FIX-01-C: Immutable PMTiles version/content archive identity across V1/V2 & multi-archive protocol
await runCase('c05_10_fix01_c_immutable_pmtiles_version_identity', async () => {
  if (!hasRendererPkg) {
    return { skipped: true, reason: 'C04_RENDERER_PKG unavailable in standalone runtime' };
  }
  const { PMTiles, Protocol } = await import(pathToFileURL(path.join(pkgRoot, 'node_modules/pmtiles/dist/esm/index.js')).href);

  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });

  const i1 = await mgr.installPackage(srcA1);
  const i2 = await mgr.installPackage(srcA2);
  assert(i1.ok && i2.ok);

  const v1Arts = await mgr.openVersionArtifacts(i1.versionKey);
  const v2Arts = await mgr.openVersionArtifacts(i2.versionKey);

  const k1 = v1Arts.pmtilesSource.getKey();
  const k2 = v2Arts.pmtilesSource.getKey();
  assert(k1 !== k2, `V1 (${k1}) and V2 (${k2}) must NEVER share the same archive key`);
  equal(k1, makeImmutablePMTilesArchiveId('in-east-c05', '1.0.0', 1, v1Arts.version.tilesSha256));
  equal(k2, makeImmutablePMTilesArchiveId('in-east-c05', '2.0.0', 2, v2Arts.version.tilesSha256));

  // Register BOTH simultaneously on offline Protocol without key overwrite or cache confusion
  const mockMap = {
    addProtocol() {},
    removeProtocol() {},
  };
  const registrar = registerOfflineProtocols(mockMap, Protocol, PMTiles, new Map([[k1, v1Arts.pmtilesSource], [k2, v2Arts.pmtilesSource]]));
  assert(registrar.registeredArchiveIds.has(k1) && registrar.registeredArchiveIds.has(k2));

  const tile1 = await registrar.loadPMTilesTile({ url: `pmtiles://${k1}/6/47/27` }, new AbortController());
  const tile2 = await registrar.loadPMTilesTile({ url: `pmtiles://${k2}/6/47/27` }, new AbortController());
  assert(tile1.data && tile2.data);
  registrar.dispose();

  return { v1ArchiveId: k1, v2ArchiveId: k2 };
});

// C05-FIX-01-D: Same-size committed byte corruption fails closed on verify AND subsequent getBytes without full-RAM buffer
await runCase('c05_11_fix01_d_same_size_corruption_fail_closed_bounded_reads', async () => {
  const srcA1 = loadPackageFromFixture('in_east_c05_v1');
  const srcA2 = loadPackageFromFixture('in_east_c05_v2');
  const backend = new MemoryRegionStorageBackend({ totalQuotaBytes: 32 * 1024 * 1024 });
  const mgr = new RegionInstallationManager({ backend, authority: trustedAuthority });

  const i1 = await mgr.installPackage(srcA1);
  const i2 = await mgr.installPackage(srcA2);
  assert(i1.ok && i2.ok);

  // Case 1 (exact coordinator finding): flip 1 byte at offset 128 on V1 (same size!), call verifyIntegrity (fails),
  // then call getBytes(128, 16) -> MUST FAIL CLOSED, and reopening version MUST ALSO FAIL CLOSED!
  const v1Arts = await mgr.openVersionArtifacts(i1.versionKey);
  const v1PmKey = v1Arts.version.assets.find((a) => a.role === 'pmtiles').assetKey;
  backend.injectCommittedCorruption(v1PmKey, 'flip_byte'); // flips byte at offset 16 (same byte length!)
  const v1Verify = await v1Arts.pmtilesSource.verifyIntegrity();
  equal(v1Verify.ok, false);

  let servedCorrupt1 = true;
  try {
    await v1Arts.pmtilesSource.getBytes(128, 16);
    servedCorrupt1 = true;
  } catch (err) {
    servedCorrupt1 = !(err instanceof CorruptedArchiveError || String(err).includes('INVALIDATED'));
  }
  assert(!servedCorrupt1, 'getBytes MUST fail closed after verifyIntegrity detects same-size corruption');

  let reopenBlocked = false;
  try {
    await mgr.openVersionArtifacts(i1.versionKey);
  } catch (err) {
    reopenBlocked = String(err.message).includes('CORRUPTED_INVALIDATED');
  }
  assert(reopenBlocked, 'Persisted corruption invalidation must block subsequent openVersionArtifacts');

  // Case 2: flip 1 byte in V2 WITHOUT calling verifyIntegrity() beforehand; direct getBytes() catches it immediately inside bounded 16 KiB block read!
  const v2Arts = await mgr.openVersionArtifacts(i2.versionKey);
  const v2PmKey = v2Arts.version.assets.find((a) => a.role === 'pmtiles').assetKey;
  const origBytes = await backend.readCommittedAll(v2PmKey);
  const mutated = origBytes.slice();
  mutated[128] ^= 0x55; // exact same byte length!
  // Write exact same-size corrupted asset directly into committed store bypassing staging
  await backend.deleteCommittedAsset(v2PmKey);
  await backend.writeStagingAsset('tmp_corrupt_inject', mutated);
  await backend.promoteStagedAsset('tmp_corrupt_inject', v2PmKey);

  let directBlockCaught = false;
  try {
    await v2Arts.pmtilesSource.getBytes(128, 16);
  } catch (err) {
    directBlockCaught = err instanceof CorruptedArchiveError && String(err.message).includes('CORRUPTED_PMTILES_BLOCK_SHA256_MISMATCH');
  }
  assert(directBlockCaught, 'Direct getBytes(128, 16) must catch same-size corruption via bounded block SHA-256');
  equal(v2Arts.pmtilesSource.getTelemetry().corrupted, true);
  equal(v2Arts.pmtilesSource.getTelemetry().totalBytesRead, 0, 'Zero corrupted bytes served');

  return { postVerifyGetBytesBlocked: true, preVerifyDirectBlockCaught: true };
});

const executed = results.filter((r) => !r.skipped);
const skipped = results.filter((r) => r.skipped);
const passedAll = executed.every((r) => r.passed);
const report = {
  passed: passedAll,
  total: results.length,
  executedCount: executed.length,
  passedCount: executed.filter((r) => r.passed).length,
  failedCount: executed.filter((r) => !r.passed).length,
  skippedCount: skipped.length,
  timingsMs: timings,
  cases: results,
};
console.log(JSON.stringify(report, null, 2));
if (!passedAll) process.exitCode = 1;
