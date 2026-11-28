import { decodeGraphPack, decodeRegionManifest, type GraphPack, type RegionManifest } from '../../domain/models';
import { RailGraph } from '../graph';
import { verifyGraphTilesBundleMatch } from '../map/pmtiles-adapter';
import {
  REGION_PACKAGE_DEFAULT_MAX_SINGLE_ENTRY_BYTES,
  REGION_PACKAGE_DEFAULT_SAFETY_RESERVE_BYTES,
  canonicalJsonBytes,
  createEmptyRegistry,
  decodeInstalledRegionRegistry,
  decodeRegionPortalSet,
  makeVersionKey,
  sha256Hex,
  verifySignedRegionPackageEnvelope,
  type InstallJournalRecord,
  type InstallState,
  type InstalledRegionRegistry,
  type InstalledVersionRecord,
  type RegionPackageEntry,
  type RegionPackageManifest,
  type RegionPortalSet,
  type RegionSlotState,
  type SignedRegionPackageEnvelope,
  type StoragePreflightReport,
  type StorageQuotaReport,
  type StoredAssetRef,
  type TrustedRegionAuthority,
  type VersionReferenceRecord,
} from './contracts';
import { VerifiedInstalledPMTilesSource } from './pmtiles-range-source';
import {
  FaultInjectedAbortError,
  type RegionStorageBackend,
} from './storage';

export type CrashStageHook =
  | 'NONE'
  | 'BEFORE_STAGING'
  | 'MID_STAGING'
  | 'BEFORE_ACTIVATION'
  | 'DURING_ACTIVATION'
  | 'AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT'
  | 'AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR';

export interface PackageArchiveSource {
  readonly envelope: SignedRegionPackageEnvelope | unknown;
  /** Map from entry.relativePath -> raw or gzip-compressed exact wire bytes matching compressedSha256/compressedSizeBytes */
  getEntryBytes(relativePath: string): Promise<Uint8Array>;
}

export interface InstallPackageOptions {
  readonly activateImmediately?: boolean;
  readonly cancelAfterState?: InstallState;
  readonly injectCrashAt?: CrashStageHook;
  readonly allowUnknownQuota?: boolean;
  readonly rollbackRetainedCount?: number;
  readonly safetyReserveBytes?: number;
}

export interface InstallPackageOutcome {
  readonly ok: boolean;
  readonly finalState: InstallState;
  readonly operationId: string;
  readonly regionId: string;
  readonly versionKey: string;
  readonly activeVersionKey: string | null;
  readonly previousVersionKey: string | null;
  readonly recoveredFromPriorCrash: boolean;
  readonly preflight: StoragePreflightReport;
  readonly errorCode: string | null;
  readonly reason: string;
}

export class DecompressionBombError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecompressionBombError';
  }
}

function nowUtc(): string {
  return new Date().toISOString();
}

/**
 * Bound-checked gzip decompression guarding against zip/decompression bombs: aborts immediately
 * when decompressed output exceeds `min(declaredUncompressedBytes, maxSingleEntryBytes)`.
 */
export async function boundedDecompressGzip(
  compressedBytes: Uint8Array,
  declaredUncompressedBytes: number,
  maxSingleEntryBytes = REGION_PACKAGE_DEFAULT_MAX_SINGLE_ENTRY_BYTES,
): Promise<Uint8Array> {
  const limit = Math.min(declaredUncompressedBytes, maxSingleEntryBytes);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Web Streams DecompressionStream("gzip") unavailable in runtime');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const writePromise = (async () => {
    try {
      const slice = compressedBytes.buffer.slice(
        compressedBytes.byteOffset,
        compressedBytes.byteOffset + compressedBytes.byteLength,
      ) as ArrayBuffer;
      await writer.write(new Uint8Array(slice));
      await writer.close();
    } catch {
      // ignore stream abort on bomb termination
    }
  })();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel('DECOMPRESSION_SIZE_LIMIT_EXCEEDED').catch(() => undefined);
          throw new DecompressionBombError(
            `Decompressed payload exceeded declared limit (${total} > ${limit} bytes)`,
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    await writePromise;
  }

  if (total !== declaredUncompressedBytes) {
    throw new Error(
      `DECOMPRESSED_SIZE_MISMATCH: expected=${declaredUncompressedBytes} actual=${total}`,
    );
  }

  const out = new Uint8Array(total);
  let pos = 0;
  for (const ch of chunks) {
    out.set(ch, pos);
    pos += ch.byteLength;
  }
  return out;
}

function stagingAssetKey(operationId: string, role: string): string {
  return `op_${operationId}/${role}`;
}

function committedAssetKey(versionKey: string, role: string): string {
  return `ver_${versionKey}/${role}`;
}

/**
 * Pure storage preflight calculator accounting for incoming archive, decoded/extracted working copy,
 * staging workspace, currently active data, retained rollback slot, and mandatory safety reserve.
 */
export function computeStoragePreflight(options: {
  readonly quota: StorageQuotaReport;
  readonly manifest: RegionPackageManifest;
  readonly registry: InstalledRegionRegistry;
  readonly allowUnknownQuota?: boolean;
  readonly safetyReserveBytes?: number;
}): StoragePreflightReport {
  const reserve = options.safetyReserveBytes ?? REGION_PACKAGE_DEFAULT_SAFETY_RESERVE_BYTES;
  const regionSlot = options.registry.regions.find((r) => r.regionId === options.manifest.regionId);
  const activeVer = regionSlot?.activeVersionKey
    ? options.registry.versions.find((v) => v.versionKey === regionSlot.activeVersionKey)
    : undefined;
  const rollbackVer = regionSlot?.previousVersionKey
    ? options.registry.versions.find((v) => v.versionKey === regionSlot.previousVersionKey)
    : undefined;

  const incomingCompressedBytes = options.manifest.totalCompressedBytes;
  const extractedUncompressedBytes = options.manifest.totalUncompressedBytes;
  const stagingWorkingBytes = Math.max(options.manifest.estimatedDecodePeakBytes, incomingCompressedBytes);
  const existingActiveBytes = activeVer?.totalStoredBytes ?? 0;
  const rollbackRetainedBytes = rollbackVer?.totalStoredBytes ?? 0;

  // Incremental storage required beyond already-saved existing versions + safety headroom:
  // Need space for staged working copy + promoted final version + reserve margin.
  const totalRequiredBytes =
    stagingWorkingBytes + extractedUncompressedBytes + reserve;

  if (options.quota.quotaStatus !== 'KNOWN' || options.quota.availableBytes === null) {
    const allowed = Boolean(options.allowUnknownQuota);
    return {
      ok: allowed,
      reason: allowed
        ? 'STORAGE_QUOTA_UNKNOWN_EXPLICIT_ALLOW'
        : `STORAGE_QUOTA_${options.quota.quotaStatus}_FAIL_CLOSED`,
      quotaStatus: options.quota.quotaStatus,
      availableBytes: null,
      incomingCompressedBytes,
      extractedUncompressedBytes,
      stagingWorkingBytes,
      existingActiveBytes,
      rollbackRetainedBytes,
      safetyReserveBytes: reserve,
      totalRequiredBytes,
    };
  }

  if (options.quota.availableBytes < totalRequiredBytes) {
    return {
      ok: false,
      reason: `INSUFFICIENT_STORAGE_QUOTA: available=${options.quota.availableBytes} required=${totalRequiredBytes} (incoming+extracted+staging+reserve)`,
      quotaStatus: 'KNOWN',
      availableBytes: options.quota.availableBytes,
      incomingCompressedBytes,
      extractedUncompressedBytes,
      stagingWorkingBytes,
      existingActiveBytes,
      rollbackRetainedBytes,
      safetyReserveBytes: reserve,
      totalRequiredBytes,
    };
  }

  return {
    ok: true,
    reason: null,
    quotaStatus: 'KNOWN',
    availableBytes: options.quota.availableBytes,
    incomingCompressedBytes,
    extractedUncompressedBytes,
    stagingWorkingBytes,
    existingActiveBytes,
    rollbackRetainedBytes,
    safetyReserveBytes: reserve,
    totalRequiredBytes,
  };
}

/**
 * Production-grade atomic Region Package Installation, Crash Recovery, Version Pinning & Rollback Manager.
 */
export class RegionInstallationManager {
  readonly #backend: RegionStorageBackend;
  readonly #authority: TrustedRegionAuthority;
  readonly #expectedStyleVersion: string;
  readonly #safetyReserveBytes: number;

  constructor(options: {
    readonly backend: RegionStorageBackend;
    readonly authority: TrustedRegionAuthority;
    readonly expectedStyleVersion?: string;
    readonly safetyReserveBytes?: number;
  }) {
    this.#backend = options.backend;
    this.#authority = options.authority;
    this.#expectedStyleVersion = options.expectedStyleVersion ?? 'c04-rail-style-v1';
    this.#safetyReserveBytes = options.safetyReserveBytes ?? REGION_PACKAGE_DEFAULT_SAFETY_RESERVE_BYTES;
  }

  get backend(): RegionStorageBackend {
    return this.#backend;
  }

  async #loadOrInitRegistry(): Promise<InstalledRegionRegistry> {
    const cur = await this.#backend.readState();
    if (cur) return cur;
    const init = createEmptyRegistry(nowUtc());
    await this.#backend.compareAndSwapState(null, init);
    return (await this.#backend.readState()) ?? init;
  }

  async #casUpdate(expectedRevision: number, next: InstalledRegionRegistry): Promise<InstalledRegionRegistry> {
    const validated = decodeInstalledRegionRegistry({
      ...next,
      revision: expectedRevision + 1,
      updatedAtUtc: nowUtc(),
    });
    const ok = await this.#backend.compareAndSwapState(expectedRevision, validated);
    if (!ok) {
      throw new Error(`CAS_CONFLICT: expected revision ${expectedRevision} was stale`);
    }
    return validated;
  }

  async checkStorageRequirements(
    manifestInput: RegionPackageManifest | unknown,
    options: { allowUnknownQuota?: boolean } = {},
  ): Promise<StoragePreflightReport> {
    const authorityEnv = (manifestInput as { manifest?: unknown })?.manifest ?? manifestInput;
    const quota = await this.#backend.checkStorageQuota();
    const reg = await this.#loadOrInitRegistry();
    return computeStoragePreflight({
      quota,
      manifest: authorityEnv as RegionPackageManifest,
      registry: reg,
      allowUnknownQuota: options.allowUnknownQuota,
      safetyReserveBytes: this.#safetyReserveBytes,
    });
  }

  async inspectInstalledRegions(): Promise<InstalledRegionRegistry> {
    return this.#loadOrInitRegistry();
  }

  async inspectActiveVersions(): Promise<ReadonlyMap<string, InstalledVersionRecord>> {
    const reg = await this.#loadOrInitRegistry();
    const out = new Map<string, InstalledVersionRecord>();
    for (const slot of reg.regions) {
      if (slot.activeVersionKey) {
        const ver = reg.versions.find((v) => v.versionKey === slot.activeVersionKey);
        if (ver) out.set(slot.regionId, ver);
      }
    }
    return out;
  }

  async inspectVersionReferences(versionKey: string): Promise<VersionReferenceRecord | null> {
    const reg = await this.#loadOrInitRegistry();
    return reg.references.find((r) => r.versionKey === versionKey) ?? null;
  }

  /**
   * Recover from an interrupted install, activation, or rollback journal deterministically and idempotently.
   * Safe to invoke on every app startup/tab reload or multiple times in a row.
   */
  async recoverInstallations(): Promise<{
    readonly recovered: boolean;
    readonly operationId: string | null;
    readonly resolution: 'NONE' | 'STAGING_CLEANED_PRIOR_ACTIVE_PRESERVED' | 'COMPLETED_INTERRUPTED_ACTIVATION' | 'ROLLED_BACK_INCOMPLETE_ACTIVATION';
    readonly registry: InstalledRegionRegistry;
  }> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      let reg = await this.#loadOrInitRegistry();
      const j = reg.activeJournal;
      if (!j) {
        // Also sweep any unreferenced orphaned staging blobs if no active journal exists.
        const leftoverStaging = await this.#backend.listStagingKeys();
        for (const k of leftoverStaging) {
          await this.#backend.deleteStagingAsset(k).catch(() => undefined);
        }
        return { recovered: false, operationId: null, resolution: 'NONE', registry: reg };
      }

      const cleanupStaging = async () => {
        for (const k of j.stagedAssetKeys) {
          await this.#backend.deleteStagingAsset(k).catch(() => undefined);
        }
        const remaining = await this.#backend.listStagingKeys();
        for (const k of remaining) {
          if (k.startsWith(j.stagingPrefix) || k.includes(j.operationId)) {
            await this.#backend.deleteStagingAsset(k).catch(() => undefined);
          }
        }
      };

      // Case 1: Journal crashed AFTER committed state already updated to targetVersionKey, only activeJournal wasn't cleared yet.
      if (j.committedVersionSnapshot && j.state === 'ACTIVATED') {
        const hasVersion = reg.versions.some((v) => v.versionKey === j.targetVersionKey);
        const slot = reg.regions.find((r) => r.regionId === j.regionId);
        if (hasVersion && slot?.activeVersionKey === j.targetVersionKey) {
          await cleanupStaging();
          reg = await this.#casUpdate(reg.revision, {
            ...reg,
            activeJournal: null,
            lastRecoveredOperationId: j.operationId,
          });
          return {
            recovered: true,
            operationId: j.operationId,
            resolution: 'COMPLETED_INTERRUPTED_ACTIVATION',
            registry: reg,
          };
        }
      }

      // Case 2: Interrupted during READY_FOR_ACTIVATION promotion (some or all committed assets may exist).
      if (j.committedVersionSnapshot && j.state === 'READY_FOR_ACTIVATION') {
        let allCommittedIntact = true;
        for (const asset of j.committedVersionSnapshot.assets) {
          const st = await this.#backend.committedStat(asset.assetKey);
          if (!st.exists || st.byteLength !== asset.sizeBytes) {
            allCommittedIntact = false;
            break;
          }
          const raw = await this.#backend.readCommittedAll(asset.assetKey);
          const actualSha = await sha256Hex(raw);
          if (actualSha !== asset.sha256) {
            allCommittedIntact = false;
            break;
          }
        }

        if (allCommittedIntact) {
          const existingVersions = reg.versions.filter((v) => v.versionKey !== j.targetVersionKey);
          const nextVersions = [...existingVersions, j.committedVersionSnapshot];
          const slot = reg.regions.find((r) => r.regionId === j.regionId);
          const prevActive = slot?.activeVersionKey ?? j.previousActiveVersionKey ?? null;
          const retained = new Set(slot?.retainedVersionKeys ?? []);
          if (prevActive && prevActive !== j.targetVersionKey) retained.add(prevActive);
          retained.add(j.targetVersionKey);
          const nextSlot: RegionSlotState = {
            regionId: j.regionId,
            activeVersionKey: j.targetVersionKey,
            previousVersionKey: prevActive && prevActive !== j.targetVersionKey ? prevActive : slot?.previousVersionKey ?? null,
            retainedVersionKeys: [...retained].sort(),
            updatedAtUtc: nowUtc(),
          };
          const nextRegions = [...reg.regions.filter((r) => r.regionId !== j.regionId), nextSlot].sort((a, b) =>
            a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
          );
          const hasRef = reg.references.some((r) => r.versionKey === j.targetVersionKey);
          const nextRefs = hasRef
            ? reg.references
            : [...reg.references, { versionKey: j.targetVersionKey, activeRoutes: [], activeMovements: [], pinnedSaveHeads: [] }];
          await cleanupStaging();
          reg = await this.#casUpdate(reg.revision, {
            ...reg,
            regions: nextRegions,
            versions: nextVersions,
            references: nextRefs,
            activeJournal: null,
            lastRecoveredOperationId: j.operationId,
          });
          return {
            recovered: true,
            operationId: j.operationId,
            resolution: 'COMPLETED_INTERRUPTED_ACTIVATION',
            registry: reg,
          };
        }

        // Committed artifacts were only partially written: delete partial target assets and preserve prior active!
        for (const asset of j.committedVersionSnapshot.assets) {
          await this.#backend.deleteCommittedAsset(asset.assetKey).catch(() => undefined);
        }
        await cleanupStaging();
        reg = await this.#casUpdate(reg.revision, {
          ...reg,
          activeJournal: null,
          lastRecoveredOperationId: j.operationId,
        });
        return {
          recovered: true,
          operationId: j.operationId,
          resolution: 'ROLLED_BACK_INCOMPLETE_ACTIVATION',
          registry: reg,
        };
      }

      // Case 3: Interrupted in any earlier stage -> wipe staging and leave active/rollback untouched.
      await cleanupStaging();
      reg = await this.#casUpdate(reg.revision, {
        ...reg,
        activeJournal: null,
        lastRecoveredOperationId: j.operationId,
      });
      return {
        recovered: true,
        operationId: j.operationId,
        resolution: 'STAGING_CLEANED_PRIOR_ACTIVE_PRESERVED',
        registry: reg,
      };
    });
  }

  /**
   * Transactional region package install with trusted authority check, quota preflight,
   * bounded decompression, per-file SHA-256 verification, C03+C04 compatibility verification,
   * crash recovery journal, and single atomic CAS activation.
   */
  async installPackage(
    source: PackageArchiveSource,
    options: InstallPackageOptions = {},
  ): Promise<InstallPackageOutcome> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      const recovery = await this.#recoverUnlocked();
      let reg = recovery.registry;

      let authCheck;
      let signedEnv: SignedRegionPackageEnvelope;
      try {
        authCheck = await verifySignedRegionPackageEnvelope(source.envelope, this.#authority);
        signedEnv = source.envelope as SignedRegionPackageEnvelope;
      } catch (err) {
        return {
          ok: false,
          finalState: 'FAILED',
          operationId: 'op-invalid-envelope',
          regionId: 'unknown',
          versionKey: 'unknown',
          activeVersionKey: null,
          previousVersionKey: null,
          recoveredFromPriorCrash: recovery.recovered,
          preflight: {
            ok: false,
            reason: `MALFORMED_ENVELOPE: ${err instanceof Error ? err.message : String(err)}`,
            quotaStatus: 'UNKNOWN',
            availableBytes: null,
            incomingCompressedBytes: 0,
            extractedUncompressedBytes: 0,
            stagingWorkingBytes: 0,
            existingActiveBytes: 0,
            rollbackRetainedBytes: 0,
            safetyReserveBytes: this.#safetyReserveBytes,
            totalRequiredBytes: this.#safetyReserveBytes,
          },
          errorCode: 'MALFORMED_ENVELOPE',
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      const m = signedEnv.manifest;
      const versionKey = makeVersionKey(m.regionId, m.version, m.packageVersion);
      const operationId = `install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const currentSlot = reg.regions.find((r) => r.regionId === m.regionId);
      const prevActive = currentSlot?.activeVersionKey ?? null;
      const quota = await this.#backend.checkStorageQuota();
      const preflight = computeStoragePreflight({
        quota,
        manifest: m,
        registry: reg,
        allowUnknownQuota: options.allowUnknownQuota,
        safetyReserveBytes: options.safetyReserveBytes ?? this.#safetyReserveBytes,
      });

      const makeFail = async (
        state: InstallState,
        errorCode: string,
        reason: string,
        stagedKeys: string[] = [],
      ): Promise<InstallPackageOutcome> => {
        for (const sk of stagedKeys) {
          await this.#backend.deleteStagingAsset(sk).catch(() => undefined);
        }
        if (reg.activeJournal && reg.activeJournal.operationId === operationId) {
          reg = await this.#casUpdate(reg.revision, {
            ...reg,
            activeJournal: null,
          });
        }
        this.#backend.broadcastEvent({
          type: 'INSTALL_FAILED',
          regionId: m.regionId,
          revision: reg.revision,
          activeVersionKey: prevActive,
          timestampUtc: nowUtc(),
        });
        return {
          ok: false,
          finalState: state,
          operationId,
          regionId: m.regionId,
          versionKey,
          activeVersionKey: prevActive,
          previousVersionKey: currentSlot?.previousVersionKey ?? null,
          recoveredFromPriorCrash: recovery.recovered,
          preflight,
          errorCode,
          reason,
        };
      };

      if (!authCheck.ok) {
        return makeFail('FAILED', authCheck.reason ?? 'UNTRUSTED_MANIFEST', `Authority verification failed: ${authCheck.reason}`);
      }
      if (!preflight.ok) {
        return makeFail('FAILED', 'PREFLIGHT_QUOTA_REJECTED', preflight.reason ?? 'Storage preflight failed');
      }

      const writeJournal = async (patch: Partial<InstallJournalRecord> & { state: InstallState }): Promise<void> => {
        const base: InstallJournalRecord = reg.activeJournal ?? {
          operationId,
          kind: 'INSTALL',
          state: 'DISCOVERED',
          packageId: m.packageId,
          regionId: m.regionId,
          version: m.version,
          targetVersionKey: versionKey,
          previousActiveVersionKey: prevActive,
          stagingPrefix: `op_${operationId}/`,
          stagedAssetKeys: [],
          committedVersionSnapshot: null,
          failureReason: null,
          startedAtUtc: nowUtc(),
          updatedAtUtc: nowUtc(),
        };
        const updated: InstallJournalRecord = {
          ...base,
          ...patch,
          updatedAtUtc: nowUtc(),
        };
        reg = await this.#casUpdate(reg.revision, {
          ...reg,
          activeJournal: updated,
        });
      };

      const stagedKeys: string[] = [];
      const decodedAssetCache = new Map<string, Uint8Array>();

      try {
        await writeJournal({ state: 'PREFLIGHT' });
        if (options.injectCrashAt === 'BEFORE_STAGING') {
          throw new FaultInjectedAbortError('Simulated crash BEFORE_STAGING');
        }
        if (options.cancelAfterState === 'PREFLIGHT') {
          return makeFail('CANCELLED', 'USER_CANCELLED', 'Installation cancelled at PREFLIGHT', stagedKeys);
        }

        // STAGING phase
        await writeJournal({ state: 'STAGING' });
        for (let i = 0; i < m.assets.length; i++) {
          const entry = m.assets[i];
          if (options.injectCrashAt === 'MID_STAGING' && i === Math.floor(m.assets.length / 2)) {
            throw new FaultInjectedAbortError(`Simulated crash MID_STAGING at entry ${entry.relativePath}`);
          }
          const wireBytes = await source.getEntryBytes(entry.relativePath);
          if (wireBytes.byteLength !== entry.compressedSizeBytes) {
            return makeFail(
              'FAILED',
              'COMPRESSED_SIZE_MISMATCH',
              `Entry ${entry.relativePath} compressed size mismatch: expected=${entry.compressedSizeBytes} actual=${wireBytes.byteLength}`,
              stagedKeys,
            );
          }
          const wireSha = await sha256Hex(wireBytes);
          if (wireSha !== entry.compressedSha256) {
            return makeFail(
              'FAILED',
              'COMPRESSED_SHA256_MISMATCH',
              `Entry ${entry.relativePath} compressed SHA-256 mismatch`,
              stagedKeys,
            );
          }

          let rawBytes: Uint8Array;
          if (entry.encoding === 'gzip') {
            rawBytes = await boundedDecompressGzip(wireBytes, entry.sizeBytes, m.maxSingleEntryBytes);
          } else {
            if (wireBytes.byteLength !== entry.sizeBytes) {
              return makeFail(
                'FAILED',
                'RAW_ENTRY_SIZE_MISMATCH',
                `Raw entry ${entry.relativePath} size mismatch`,
                stagedKeys,
              );
            }
            rawBytes = wireBytes;
          }

          const sKey = stagingAssetKey(operationId, entry.role);
          await this.#backend.writeStagingAsset(sKey, rawBytes);
          stagedKeys.push(sKey);
          decodedAssetCache.set(entry.role, rawBytes);
          await writeJournal({ state: 'STAGING', stagedAssetKeys: [...stagedKeys] });
        }

        if (options.cancelAfterState === 'STAGING') {
          return makeFail('CANCELLED', 'USER_CANCELLED', 'Installation cancelled after STAGING', stagedKeys);
        }

        // ASSET_VERIFICATION phase: re-read from durable storage & verify every SHA-256!
        await writeJournal({ state: 'ASSET_VERIFICATION' });
        for (const entry of m.assets) {
          const sKey = stagingAssetKey(operationId, entry.role);
          const persisted = await this.#backend.readStagingAsset(sKey);
          if (!persisted || persisted.byteLength !== entry.sizeBytes) {
            return makeFail('FAILED', 'STAGED_ASSET_MISSING_OR_TRUNCATED', `Staged asset ${sKey} missing or size mismatch`, stagedKeys);
          }
          const actualSha = await sha256Hex(persisted);
          if (actualSha !== entry.sha256) {
            return makeFail(
              'FAILED',
              'ASSET_SHA256_MISMATCH',
              `Verified asset ${entry.role} SHA-256 mismatch: expected=${entry.sha256} actual=${actualSha}`,
              stagedKeys,
            );
          }
          decodedAssetCache.set(entry.role, persisted);
        }

        // COMPATIBILITY_VERIFICATION phase: GraphPack + RegionManifest + TileManifest + Portals + SoI + PMTiles header
        await writeJournal({ state: 'COMPATIBILITY_VERIFICATION' });
        const td = new TextDecoder();
        const regionManifestRaw = JSON.parse(td.decode(decodedAssetCache.get('region-manifest')!));
        const tileManifestRaw = JSON.parse(td.decode(decodedAssetCache.get('tile-manifest')!));
        const graphPackRaw = JSON.parse(td.decode(decodedAssetCache.get('graph-pack')!));
        const graphPackSha = await sha256Hex(decodedAssetCache.get('graph-pack')!);
        if (graphPackSha !== m.graphFileSha256) {
          return makeFail('FAILED', 'GRAPH_FILE_SHA_MISMATCH', 'Graph file SHA-256 does not match manifest.graphFileSha256', stagedKeys);
        }

        const regionManifest = decodeRegionManifest(regionManifestRaw);
        const graphPack = decodeGraphPack(graphPackRaw);
        const railGraph = new RailGraph(graphPack);

        if (railGraph.regionId !== m.regionId || railGraph.graphSha256 !== m.graphSha256) {
          return makeFail('FAILED', 'GRAPH_IDENTITY_MISMATCH', 'GraphPack regionId or canonical graphSha256 mismatch', stagedKeys);
        }

        const bundleMatch = verifyGraphTilesBundleMatch(
          railGraph,
          regionManifest,
          tileManifestRaw,
          this.#expectedStyleVersion,
          {
            expectedGraphSha256: m.graphSha256,
            expectedPmtilesSha256: m.tilesSha256,
          },
        );
        if (!bundleMatch.ok) {
          return makeFail('FAILED', bundleMatch.reason, `Bundle parity failed: ${bundleMatch.reason}`, stagedKeys);
        }

        // Verify canonical GraphPack digest strictly equals embedded graphSha256
        const { graphSha256: _ignored, ...canonicalBody } = graphPack;
        const recomputedCanonicalGraphSha = await sha256Hex(canonicalJsonBytes({
          schemaVersion: canonicalBody.schemaVersion,
          regionId: canonicalBody.regionId,
          nodes: canonicalBody.nodes,
          stations: canonicalBody.stations,
          edges: canonicalBody.edges,
          turnRules: canonicalBody.turnRules,
        }));
        if (recomputedCanonicalGraphSha !== graphPack.graphSha256) {
          return makeFail('FAILED', 'CANONICAL_GRAPH_HASH_TAMPERED', 'Recomputed canonical GraphPack SHA-256 mismatch', stagedKeys);
        }

        // Check PMTiles v3 magic header on staged PMTiles asset
        const pmBytes = decodedAssetCache.get('pmtiles')!;
        const pmMagic = td.decode(pmBytes.subarray(0, 7));
        if (pmMagic !== 'PMTiles') {
          return makeFail('FAILED', 'INVALID_PMTILES_MAGIC', 'Staged PMTiles missing PMTiles header magic', stagedKeys);
        }

        // Optional portals asset validation
        const portalsBytes = decodedAssetCache.get('portals');
        if (portalsBytes) {
          const decodedPortals = decodeRegionPortalSet(JSON.parse(td.decode(portalsBytes)));
          if (decodedPortals.portals.some((p) => p.regionAId !== m.regionId && p.regionBId !== m.regionId)) {
            return makeFail('FAILED', 'UNRELATED_PORTAL_ENTRY', 'Portal set contains portal unrelated to packaged regionId', stagedKeys);
          }
        }

        if (options.injectCrashAt === 'BEFORE_ACTIVATION') {
          throw new FaultInjectedAbortError('Simulated crash BEFORE_ACTIVATION');
        }
        if (options.cancelAfterState === 'COMPATIBILITY_VERIFICATION') {
          return makeFail('CANCELLED', 'USER_CANCELLED', 'Installation cancelled prior to READY_FOR_ACTIVATION', stagedKeys);
        }

        // Prepare committed asset descriptors & snapshot in journal BEFORE promoting files
        const committedRefs: StoredAssetRef[] = m.assets.map((e: RegionPackageEntry) => ({
          role: e.role,
          assetKey: committedAssetKey(versionKey, e.role),
          sha256: e.sha256,
          sizeBytes: e.sizeBytes,
        }));
        const committedVersion: InstalledVersionRecord = {
          versionKey,
          packageId: m.packageId,
          regionId: m.regionId,
          version: m.version,
          packageVersion: m.packageVersion,
          syntheticOnly: m.syntheticOnly,
          graphSha256: m.graphSha256,
          graphFileSha256: m.graphFileSha256,
          tilesSha256: m.tilesSha256,
          regionManifestSha256: m.regionManifestSha256,
          tileManifestSha256: m.tileManifestSha256,
          portalSetSha256: m.portalSetSha256,
          packageManifestSha256: authCheck.manifestSha256,
          styleVersion: m.styleVersion,
          bounds: [...m.bounds] as [number, number, number, number],
          installedAtUtc: nowUtc(),
          totalStoredBytes: m.totalUncompressedBytes,
          assets: committedRefs,
        };

        await writeJournal({
          state: 'READY_FOR_ACTIVATION',
          committedVersionSnapshot: committedVersion,
        });

        if (options.activateImmediately === false) {
          return {
            ok: true,
            finalState: 'READY_FOR_ACTIVATION',
            operationId,
            regionId: m.regionId,
            versionKey,
            activeVersionKey: prevActive,
            previousVersionKey: currentSlot?.previousVersionKey ?? null,
            recoveredFromPriorCrash: recovery.recovered,
            preflight,
            errorCode: null,
            reason: `Region ${versionKey} staged and verified in READY_FOR_ACTIVATION`,
          };
        }

        // Promote staged files into immutable committed paths (with optional mid-promotion crash test)
        for (let i = 0; i < m.assets.length; i++) {
          const entry = m.assets[i];
          if (options.injectCrashAt === 'DURING_ACTIVATION' && i === Math.floor(m.assets.length / 2)) {
            throw new FaultInjectedAbortError(`Simulated crash DURING_ACTIVATION promoting ${entry.role}`);
          }
          await this.#backend.promoteStagedAsset(
            stagingAssetKey(operationId, entry.role),
            committedAssetKey(versionKey, entry.role),
          );
        }

        if (options.injectCrashAt === 'AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT') {
          throw new FaultInjectedAbortError('Simulated crash AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT');
        }

        // Atomic CAS pointer swap
        const retained = new Set(currentSlot?.retainedVersionKeys ?? []);
        if (prevActive && prevActive !== versionKey) {
          retained.add(prevActive);
        }
        retained.add(versionKey);
        const newPrev = prevActive && prevActive !== versionKey ? prevActive : currentSlot?.previousVersionKey ?? null;

        const nextSlot: RegionSlotState = {
          regionId: m.regionId,
          activeVersionKey: versionKey,
          previousVersionKey: newPrev,
          retainedVersionKeys: [...retained].sort(),
          updatedAtUtc: nowUtc(),
        };
        const nextRegions = [...reg.regions.filter((r) => r.regionId !== m.regionId), nextSlot].sort((a, b) =>
          a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
        );
        const nextVersions = [...reg.versions.filter((v) => v.versionKey !== versionKey), committedVersion];
        const hasRef = reg.references.some((r) => r.versionKey === versionKey);
        const nextRefs = hasRef
          ? reg.references
          : [...reg.references, { versionKey, activeRoutes: [], activeMovements: [], pinnedSaveHeads: [] }];

        reg = await this.#casUpdate(reg.revision, {
          ...reg,
          regions: nextRegions,
          versions: nextVersions,
          references: nextRefs,
          activeJournal: {
            ...reg.activeJournal!,
            state: 'ACTIVATED',
            updatedAtUtc: nowUtc(),
          },
        });

        if (options.injectCrashAt === 'AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR') {
          throw new FaultInjectedAbortError('Simulated crash AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR');
        }

        reg = await this.#casUpdate(reg.revision, {
          ...reg,
          activeJournal: null,
        });

        this.#backend.broadcastEvent({
          type: 'REGISTRY_UPDATED',
          regionId: m.regionId,
          revision: reg.revision,
          activeVersionKey: versionKey,
          timestampUtc: nowUtc(),
        });

        return {
          ok: true,
          finalState: 'ACTIVATED',
          operationId,
          regionId: m.regionId,
          versionKey,
          activeVersionKey: versionKey,
          previousVersionKey: newPrev,
          recoveredFromPriorCrash: recovery.recovered,
          preflight,
          errorCode: null,
          reason: `Region ${versionKey} installed and atomically activated`,
        };
      } catch (err) {
        if (err instanceof FaultInjectedAbortError) {
          throw err;
        }
        return makeFail(
          'FAILED',
          err instanceof Error && err.name === 'DecompressionBombError' ? 'DECOMPRESSION_SIZE_LIMIT_EXCEEDED' : 'INSTALL_ERROR',
          err instanceof Error ? err.message : String(err),
          stagedKeys,
        );
      }
    });
  }

  /** Internal helper used inside lock when starting another mutation. */
  async #recoverUnlocked() {
    let reg = await this.#loadOrInitRegistry();
    const j = reg.activeJournal;
    if (!j) return { recovered: false, registry: reg };

    for (const k of j.stagedAssetKeys) {
      await this.#backend.deleteStagingAsset(k).catch(() => undefined);
    }
    if (j.committedVersionSnapshot && j.state === 'READY_FOR_ACTIVATION') {
      for (const a of j.committedVersionSnapshot.assets) {
        // Only remove if incomplete or unactivated
        if (!reg.versions.some((v) => v.versionKey === j.targetVersionKey)) {
          await this.#backend.deleteCommittedAsset(a.assetKey).catch(() => undefined);
        }
      }
    }
    reg = await this.#casUpdate(reg.revision, {
      ...reg,
      activeJournal: null,
      lastRecoveredOperationId: j.operationId,
    });
    return { recovered: true, registry: reg };
  }

  /** Atomically rollback region's active pointer to its retained prior version after full integrity verification. */
  async rollbackRegion(
    regionId: string,
    targetVersionKey?: string,
  ): Promise<Readonly<{ ok: true; activeVersionKey: string; previousVersionKey: string | null } | { ok: false; code: string; reason: string }>> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      let reg = await this.#loadOrInitRegistry();
      const slot = reg.regions.find((r) => r.regionId === regionId);
      if (!slot) {
        return { ok: false, code: 'UNKNOWN_REGION', reason: `Region ${regionId} is not installed` };
      }
      const chosenKey = targetVersionKey ?? slot.previousVersionKey;
      if (!chosenKey) {
        return { ok: false, code: 'NO_ROLLBACK_VERSION', reason: `Region ${regionId} has no retained rollback version` };
      }
      if (!slot.retainedVersionKeys.includes(chosenKey)) {
        return { ok: false, code: 'VERSION_NOT_RETAINED', reason: `Version ${chosenKey} is not retained for ${regionId}` };
      }
      const targetVer = reg.versions.find((v) => v.versionKey === chosenKey);
      if (!targetVer) {
        return { ok: false, code: 'ROLLBACK_RECORD_MISSING', reason: `Version metadata missing for ${chosenKey}` };
      }
      for (const asset of targetVer.assets) {
        const st = await this.#backend.committedStat(asset.assetKey);
        if (!st.exists || st.byteLength !== asset.sizeBytes) {
          return { ok: false, code: 'ROLLBACK_ASSET_CORRUPTED', reason: `Rollback asset ${asset.assetKey} missing or truncated` };
        }
        const bytes = await this.#backend.readCommittedAll(asset.assetKey);
        const actualSha = await sha256Hex(bytes);
        if (actualSha !== asset.sha256) {
          return { ok: false, code: 'ROLLBACK_ASSET_HASH_MISMATCH', reason: `Rollback asset ${asset.assetKey} hash mismatch` };
        }
      }

      const oldActive = slot.activeVersionKey;
      const nextSlot: RegionSlotState = {
        ...slot,
        activeVersionKey: chosenKey,
        previousVersionKey: oldActive && oldActive !== chosenKey ? oldActive : slot.previousVersionKey,
        updatedAtUtc: nowUtc(),
      };
      const nextRegions = [...reg.regions.filter((r) => r.regionId !== regionId), nextSlot].sort((a, b) =>
        a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
      );
      reg = await this.#casUpdate(reg.revision, { ...reg, regions: nextRegions });
      this.#backend.broadcastEvent({
        type: 'ROLLBACK_EXECUTED',
        regionId,
        revision: reg.revision,
        activeVersionKey: chosenKey,
        timestampUtc: nowUtc(),
      });
      return { ok: true, activeVersionKey: chosenKey, previousVersionKey: nextSlot.previousVersionKey };
    });
  }

  /** Activate a previously retained version (e.g. switch forward again after rollback). */
  async activateRetainedVersion(versionKey: string): Promise<Readonly<{ ok: true; activeVersionKey: string } | { ok: false; code: string; reason: string }>> {
    const reg = await this.#loadOrInitRegistry();
    const ver = reg.versions.find((v) => v.versionKey === versionKey);
    if (!ver) {
      return { ok: false, code: 'VERSION_NOT_FOUND', reason: `Installed version not found: ${versionKey}` };
    }
    const res = await this.rollbackRegion(ver.regionId, versionKey);
    return res.ok ? { ok: true, activeVersionKey: res.activeVersionKey } : res;
  }

  /** Pin active routes, in-flight train movements, or saves to a specific installed graph versionKey. */
  async pinVersionReference(
    versionKey: string,
    kind: 'activeRoutes' | 'activeMovements' | 'pinnedSaveHeads',
    refId: string,
  ): Promise<void> {
    await this.#backend.withExclusiveLock('region-registry-op', async () => {
      const reg = await this.#loadOrInitRegistry();
      if (!reg.versions.some((v) => v.versionKey === versionKey)) {
        throw new Error(`Cannot pin unknown installed versionKey: ${versionKey}`);
      }
      const existing = reg.references.find((r) => r.versionKey === versionKey) ?? {
        versionKey,
        activeRoutes: [],
        activeMovements: [],
        pinnedSaveHeads: [],
      };
      const nextSet = new Set(existing[kind]);
      nextSet.add(refId);
      const updatedRef: VersionReferenceRecord = {
        ...existing,
        [kind]: [...nextSet].sort(),
      };
      const nextRefs = [...reg.references.filter((r) => r.versionKey !== versionKey), updatedRef];
      await this.#casUpdate(reg.revision, { ...reg, references: nextRefs });
    });
  }

  async unpinVersionReference(
    versionKey: string,
    kind: 'activeRoutes' | 'activeMovements' | 'pinnedSaveHeads',
    refId: string,
  ): Promise<void> {
    await this.#backend.withExclusiveLock('region-registry-op', async () => {
      const reg = await this.#loadOrInitRegistry();
      const existing = reg.references.find((r) => r.versionKey === versionKey);
      if (!existing) return;
      const updatedRef: VersionReferenceRecord = {
        ...existing,
        [kind]: existing[kind].filter((x) => x !== refId),
      };
      const nextRefs = [...reg.references.filter((r) => r.versionKey !== versionKey), updatedRef];
      await this.#casUpdate(reg.revision, { ...reg, references: nextRefs });
    });
  }

  /**
   * Garbage-collect an obsolete region version ONLY if zero active pointers, rollback pointers,
   * active routes, active train movements, or pinned save heads reference it.
   */
  async removeUnusedVersion(
    versionKey: string,
  ): Promise<Readonly<{ ok: true; removedVersionKey: string; freedBytes: number } | { ok: false; code: string; reason: string }>> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      let reg = await this.#loadOrInitRegistry();
      const ver = reg.versions.find((v) => v.versionKey === versionKey);
      if (!ver) {
        return { ok: false, code: 'VERSION_NOT_FOUND', reason: `Version ${versionKey} not installed` };
      }
      const slot = reg.regions.find((r) => r.regionId === ver.regionId);
      if (slot?.activeVersionKey === versionKey) {
        return { ok: false, code: 'VERSION_IS_ACTIVE', reason: `Cannot delete active version ${versionKey}` };
      }
      const ref = reg.references.find((r) => r.versionKey === versionKey);
      if (ref && (ref.activeRoutes.length > 0 || ref.activeMovements.length > 0 || ref.pinnedSaveHeads.length > 0)) {
        return {
          ok: false,
          code: 'VERSION_PINNED_BY_ACTIVE_REFS',
          reason: `Cannot delete ${versionKey}: pinned by routes=${ref.activeRoutes.length}, movements=${ref.activeMovements.length}, saves=${ref.pinnedSaveHeads.length}`,
        };
      }

      for (const asset of ver.assets) {
        await this.#backend.deleteCommittedAsset(asset.assetKey);
      }
      const nextVersions = reg.versions.filter((v) => v.versionKey !== versionKey);
      const nextRefs = reg.references.filter((r) => r.versionKey !== versionKey);
      const nextRegions = slot
        ? [
            ...reg.regions.filter((r) => r.regionId !== ver.regionId),
            {
              ...slot,
              previousVersionKey: slot.previousVersionKey === versionKey ? null : slot.previousVersionKey,
              retainedVersionKeys: slot.retainedVersionKeys.filter((k) => k !== versionKey),
              updatedAtUtc: nowUtc(),
            },
          ]
        : reg.regions;

      reg = await this.#casUpdate(reg.revision, {
        ...reg,
        regions: nextRegions,
        versions: nextVersions,
        references: nextRefs,
      });
      this.#backend.broadcastEvent({
        type: 'VERSION_REMOVED',
        regionId: ver.regionId,
        revision: reg.revision,
        activeVersionKey: slot?.activeVersionKey ?? null,
        timestampUtc: nowUtc(),
      });
      return { ok: true, removedVersionKey: versionKey, freedBytes: ver.totalStoredBytes };
    });
  }

  /** Load immutable RailGraph, manifests, portals, and bounded PMTiles range source for any retained or active version. */
  async openVersionArtifacts(versionKey: string): Promise<{
    readonly version: InstalledVersionRecord;
    readonly graph: RailGraph;
    readonly regionManifest: RegionManifest;
    readonly tileManifest: unknown;
    readonly portalSet: RegionPortalSet | null;
    readonly pmtilesSource: VerifiedInstalledPMTilesSource;
  }> {
    const reg = await this.#loadOrInitRegistry();
    const ver = reg.versions.find((v) => v.versionKey === versionKey);
    if (!ver) {
      throw new Error(`Installed region version not found: ${versionKey}`);
    }
    const findAsset = (role: string) => {
      const a = ver.assets.find((x) => x.role === role);
      if (!a) throw new Error(`Missing role ${role} in installed version ${versionKey}`);
      return a;
    };

    const td = new TextDecoder();
    const graphAsset = findAsset('graph-pack');
    const rmAsset = findAsset('region-manifest');
    const tmAsset = findAsset('tile-manifest');
    const pmAsset = findAsset('pmtiles');

    const [graphBytes, rmBytes, tmBytes] = await Promise.all([
      this.#backend.readCommittedAll(graphAsset.assetKey),
      this.#backend.readCommittedAll(rmAsset.assetKey),
      this.#backend.readCommittedAll(tmAsset.assetKey),
    ]);

    if ((await sha256Hex(graphBytes)) !== graphAsset.sha256) {
      throw new Error(`CORRUPTED_COMMITTED_ASSET: ${graphAsset.assetKey}`);
    }
    if ((await sha256Hex(rmBytes)) !== rmAsset.sha256) {
      throw new Error(`CORRUPTED_COMMITTED_ASSET: ${rmAsset.assetKey}`);
    }
    if ((await sha256Hex(tmBytes)) !== tmAsset.sha256) {
      throw new Error(`CORRUPTED_COMMITTED_ASSET: ${tmAsset.assetKey}`);
    }

    const graphPack: GraphPack = decodeGraphPack(JSON.parse(td.decode(graphBytes)));
    const graph = new RailGraph(graphPack);
    const regionManifest = decodeRegionManifest(JSON.parse(td.decode(rmBytes)));
    const tileManifest = JSON.parse(td.decode(tmBytes));

    let portalSet: RegionPortalSet | null = null;
    const pAsset = ver.assets.find((x) => x.role === 'portals');
    if (pAsset) {
      const pBytes = await this.#backend.readCommittedAll(pAsset.assetKey);
      if ((await sha256Hex(pBytes)) !== pAsset.sha256) {
        throw new Error(`CORRUPTED_COMMITTED_ASSET: ${pAsset.assetKey}`);
      }
      portalSet = decodeRegionPortalSet(JSON.parse(td.decode(pBytes)));
    }

    const pmtilesSource = new VerifiedInstalledPMTilesSource({
      archiveId: ver.regionId,
      backend: this.#backend,
      committedKey: pmAsset.assetKey,
      expectedByteLength: pmAsset.sizeBytes,
      expectedSha256: pmAsset.sha256,
    });

    return {
      version: ver,
      graph,
      regionManifest,
      tileManifest,
      portalSet,
      pmtilesSource,
    };
  }

  /** Verify full on-storage SHA-256 and byte lengths for every committed asset in a version or all versions. */
  async verifyInstalledIntegrity(versionKey?: string): Promise<Readonly<{ ok: true; checkedAssets: number } | { ok: false; reason: string; versionKey: string }>> {
    const reg = await this.#loadOrInitRegistry();
    const targets = versionKey ? reg.versions.filter((v) => v.versionKey === versionKey) : reg.versions;
    let checked = 0;
    for (const ver of targets) {
      for (const a of ver.assets) {
        const st = await this.#backend.committedStat(a.assetKey);
        if (!st.exists || st.byteLength !== a.sizeBytes) {
          return {
            ok: false,
            versionKey: ver.versionKey,
            reason: `INSTALLED_ASSET_MISSING_OR_SIZE_MISMATCH: ${a.assetKey} exists=${st.exists} size=${st.byteLength}/${a.sizeBytes}`,
          };
        }
        const bytes = await this.#backend.readCommittedAll(a.assetKey);
        const actualSha = await sha256Hex(bytes);
        if (actualSha !== a.sha256) {
          return {
            ok: false,
            versionKey: ver.versionKey,
            reason: `INSTALLED_ASSET_SHA256_MISMATCH: ${a.assetKey} actual=${actualSha} expected=${a.sha256}`,
          };
        }
        checked += 1;
      }
    }
    return { ok: true, checkedAssets: checked };
  }
}
