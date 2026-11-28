import { decodeGraphPack, decodeRegionManifest, type GraphPack, type RegionManifest } from '../../domain/models';
import { RailGraph } from '../graph';
import { verifyGraphTilesBundleMatch } from '../map/pmtiles-adapter';
import {
  PMTILES_INTEGRITY_BLOCK_BYTES,
  REGION_PACKAGE_DEFAULT_MAX_SINGLE_ENTRY_BYTES,
  REGION_PACKAGE_DEFAULT_SAFETY_RESERVE_BYTES,
  canonicalJsonBytes,
  computeBlockSha256s,
  createEmptyRegistry,
  decodeInstalledRegionRegistry,
  decodeRegionPortalSet,
  makeImmutablePMTilesArchiveId,
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
  isStorageNotFoundError,
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
  getEntryBytes(relativePath: string): Promise<Uint8Array>;
}

export interface InstallPackageOptions {
  readonly activateImmediately?: boolean;
  readonly cancelAfterState?: InstallState;
  readonly injectCrashAt?: CrashStageHook;
  readonly allowUnknownQuota?: boolean;
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
  readonly idempotentReinstall?: boolean;
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

function durableStagedAssetKey(versionKey: string, role: string): string {
  return `staged_${versionKey}/${role}`;
}

function committedAssetKey(versionKey: string, role: string): string {
  return `ver_${versionKey}/${role}`;
}

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
  const totalRequiredBytes = stagingWorkingBytes + extractedUncompressedBytes + reserve;

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
      reason: `INSUFFICIENT_STORAGE_QUOTA: available=${options.quota.availableBytes} required=${totalRequiredBytes}`,
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
 * Production-grade atomic Region Package Installation, Crash Recovery, Version Pinning,
 * Mandatory Rollback Retention & Corrupted-Asset Fail-Closed Manager.
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

  /** Verify every asset of a record on storage (staging or committed). */
  async #verifyRecordAssetsOnStorage(
    ver: InstalledVersionRecord,
    mode: 'committed' | 'staging',
  ): Promise<Readonly<{ ok: true } | { ok: false; reason: string }>> {
    if (ver.corrupted) {
      return { ok: false, reason: ver.corruptionReason ?? `VERSION_INVALIDATED_CORRUPTED: ${ver.versionKey}` };
    }
    for (const asset of ver.assets) {
      if (mode === 'committed') {
        const st = await this.#backend.committedStat(asset.assetKey);
        if (!st.exists || st.byteLength !== asset.sizeBytes) {
          return {
            ok: false,
            reason: `INSTALLED_ASSET_MISSING_OR_SIZE_MISMATCH: ${asset.assetKey} exists=${st.exists} size=${st.byteLength}/${asset.sizeBytes}`,
          };
        }
        const bytes = await this.#backend.readCommittedAll(asset.assetKey);
        const actualSha = await sha256Hex(bytes);
        if (actualSha !== asset.sha256) {
          return {
            ok: false,
            reason: `INSTALLED_ASSET_SHA256_MISMATCH: ${asset.assetKey} actual=${actualSha} expected=${asset.sha256}`,
          };
        }
      } else {
        const bytes = await this.#backend.readStagingAsset(asset.assetKey);
        if (!bytes || bytes.byteLength !== asset.sizeBytes) {
          return {
            ok: false,
            reason: `STAGED_ASSET_MISSING_OR_SIZE_MISMATCH: ${asset.assetKey}`,
          };
        }
        const actualSha = await sha256Hex(bytes);
        if (actualSha !== asset.sha256) {
          return {
            ok: false,
            reason: `STAGED_ASSET_SHA256_MISMATCH: ${asset.assetKey}`,
          };
        }
      }
    }
    return { ok: true };
  }

  /** Persist corruption invalidation flag onto durable registry metadata so future reads fail closed. */
  async #markVersionCorruptedUnlocked(versionKey: string, reason: string): Promise<void> {
    const reg = await this.#loadOrInitRegistry();
    const ver = reg.versions.find((v) => v.versionKey === versionKey);
    if (!ver || ver.corrupted) return;
    const updated: InstalledVersionRecord = {
      ...ver,
      corrupted: true,
      corruptionReason: reason.slice(0, 500),
    };
    const nextVersions = [...reg.versions.filter((v) => v.versionKey !== versionKey), updated];
    await this.#casUpdate(reg.revision, {
      ...reg,
      versions: nextVersions,
    });
  }

  /**
   * Recover from an interrupted install, staged activation, rollback, or GC journal idempotently.
   * Preserves valid durable READY_FOR_ACTIVATION stagedPackages and unconfirmed REMOVE_VERSION retry journals!
   */
  async recoverInstallations(options: { injectCrashDuringGc?: boolean } = {}): Promise<{
    readonly recovered: boolean;
    readonly operationId: string | null;
    readonly resolution:
      | 'NONE'
      | 'STAGING_CLEANED_PRIOR_ACTIVE_PRESERVED'
      | 'COMPLETED_INTERRUPTED_ACTIVATION'
      | 'ROLLED_BACK_INCOMPLETE_ACTIVATION'
      | 'COMPLETED_INTERRUPTED_GC'
      | 'GC_RETRY_PENDING';
    readonly freedBytes?: number;
    readonly remainingAssetKeys?: readonly string[];
    readonly alreadyAbsentAssetKeys?: readonly string[];
    readonly registry: InstalledRegionRegistry;
  }> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      return this.#recoverUnlockedDetailed(options);
    });
  }

  async #cleanupTempStagingUnlocked(reg: InstalledRegionRegistry, operationId?: string): Promise<void> {
    const durableStagedKeys = new Set(reg.stagedPackages.flatMap((s) => s.assets.map((a) => a.assetKey)));
    const allStaging = await this.#backend.listStagingKeys();
    for (const k of allStaging) {
      if (durableStagedKeys.has(k)) continue;
      if (!operationId || k.startsWith(`op_${operationId}/`) || k.includes(operationId) || k.startsWith('op_')) {
        await this.#backend.deleteStagingAsset(k).catch(() => undefined);
      }
    }
  }

  async #recoverUnlockedDetailed(options: { injectCrashDuringGc?: boolean } = {}): Promise<{
    readonly recovered: boolean;
    readonly operationId: string | null;
    readonly resolution:
      | 'NONE'
      | 'STAGING_CLEANED_PRIOR_ACTIVE_PRESERVED'
      | 'COMPLETED_INTERRUPTED_ACTIVATION'
      | 'ROLLED_BACK_INCOMPLETE_ACTIVATION'
      | 'COMPLETED_INTERRUPTED_GC'
      | 'GC_RETRY_PENDING';
    readonly freedBytes?: number;
    readonly remainingAssetKeys?: readonly string[];
    readonly alreadyAbsentAssetKeys?: readonly string[];
    readonly registry: InstalledRegionRegistry;
  }> {
    let reg = await this.#loadOrInitRegistry();
    const j = reg.activeJournal;
    if (!j) {
      await this.#cleanupTempStagingUnlocked(reg);
      return { recovered: false, operationId: null, resolution: 'NONE', registry: reg };
    }

    // Interrupted or failed GC: retain unconfirmed keys in journal until EVERY asset is confirmed absent.
    if (j.kind === 'REMOVE_VERSION') {
      const gcRes = await this.#executeGcDeletesUnlocked(reg, j, {
        injectCrashDuringGc: options.injectCrashDuringGc,
        isRecoveryPass: true,
      });
      if (!gcRes.completed) {
        return {
          recovered: false,
          operationId: j.operationId,
          resolution: 'GC_RETRY_PENDING',
          freedBytes: gcRes.reclaimedBytes,
          remainingAssetKeys: gcRes.remainingAssetKeys,
          alreadyAbsentAssetKeys: gcRes.alreadyAbsentAssetKeys,
          registry: gcRes.registry,
        };
      }
      const slot = gcRes.registry.regions.find((r) => r.regionId === j.regionId);
      this.#backend.broadcastEvent({
        type: 'VERSION_REMOVED',
        regionId: j.regionId,
        revision: gcRes.registry.revision,
        activeVersionKey: slot?.activeVersionKey ?? j.previousActiveVersionKey ?? null,
        timestampUtc: nowUtc(),
      });
      return {
        recovered: true,
        operationId: j.operationId,
        resolution: 'COMPLETED_INTERRUPTED_GC',
        freedBytes: gcRes.reclaimedBytes,
        remainingAssetKeys: [],
        alreadyAbsentAssetKeys: gcRes.alreadyAbsentAssetKeys,
        registry: gcRes.registry,
      };
    }

    // Interrupted AFTER committed registry already pointed to targetVersionKey; finish clearing temp staging & journal.
    if (j.committedVersionSnapshot && j.state === 'ACTIVATED') {
      const hasVersion = reg.versions.some((v) => v.versionKey === j.targetVersionKey);
      const slot = reg.regions.find((r) => r.regionId === j.regionId);
      if (hasVersion && slot?.activeVersionKey === j.targetVersionKey) {
        await this.#cleanupTempStagingUnlocked(reg, j.operationId);
        if (j.kind === 'ACTIVATE') {
          for (const role of j.committedVersionSnapshot.assets.map((a) => a.role)) {
            await this.#backend.deleteStagingAsset(durableStagedAssetKey(j.targetVersionKey, role)).catch(() => undefined);
          }
        }
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

    // Interrupted DURING_ACTIVATION or AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT
    if (j.committedVersionSnapshot && j.state === 'READY_FOR_ACTIVATION') {
      const committedCheck = await this.#verifyRecordAssetsOnStorage(j.committedVersionSnapshot, 'committed');
      if (committedCheck.ok) {
        const existingVersions = reg.versions.filter((v) => v.versionKey !== j.targetVersionKey);
        const nextVersions = [...existingVersions, j.committedVersionSnapshot];
        const nextStaged = reg.stagedPackages.filter((s) => s.versionKey !== j.targetVersionKey);
        const slot = reg.regions.find((r) => r.regionId === j.regionId);
        const prevActive = slot?.activeVersionKey ?? j.previousActiveVersionKey ?? null;
        const retained = new Set(slot?.retainedVersionKeys ?? []);
        if (prevActive && prevActive !== j.targetVersionKey) retained.add(prevActive);
        retained.add(j.targetVersionKey);
        const nextSlot: RegionSlotState = {
          regionId: j.regionId,
          activeVersionKey: j.targetVersionKey,
          previousVersionKey:
            prevActive && prevActive !== j.targetVersionKey ? prevActive : slot?.previousVersionKey ?? null,
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
        await this.#cleanupTempStagingUnlocked(reg, j.operationId);
        // Also remove any durable staged blobs now promoted into committed
        for (const role of j.committedVersionSnapshot.assets.map((a) => a.role)) {
          await this.#backend.deleteStagingAsset(durableStagedAssetKey(j.targetVersionKey, role)).catch(() => undefined);
        }
        reg = await this.#casUpdate(reg.revision, {
          ...reg,
          regions: nextRegions,
          versions: nextVersions,
          stagedPackages: nextStaged,
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

      // Incomplete committed promotion: wipe partial committed files for targetVersionKey!
      for (const asset of j.committedVersionSnapshot.assets) {
        await this.#backend.deleteCommittedAsset(asset.assetKey).catch(() => undefined);
      }
      await this.#cleanupTempStagingUnlocked(reg, j.operationId);
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

    // Interrupted earlier in staging/preflight: clean temp staging and preserve prior active + durable staged packages
    await this.#cleanupTempStagingUnlocked(reg, j.operationId);
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
  }

  /**
   * Install a verified region package atomically, supporting BOTH immediate activation (`activateImmediately !== false`)
   * and durable install-only staging (`activateImmediately: false` -> persisted `READY_FOR_ACTIVATION` across restarts).
   */
  async installPackage(
    source: PackageArchiveSource,
    options: InstallPackageOptions = {},
  ): Promise<InstallPackageOutcome> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      const recovery = await this.#recoverUnlockedDetailed();
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

      if (reg.activeJournal?.kind === 'REMOVE_VERSION') {
        return makeFail(
          'RECOVERY_REQUIRED',
          'GC_RECOVERY_PENDING',
          reg.activeJournal.failureReason ?? `Pending GC removal for ${reg.activeJournal.targetVersionKey} must complete before installing`,
        );
      }

      if (!authCheck.ok) {
        return makeFail('FAILED', authCheck.reason ?? 'UNTRUSTED_MANIFEST', `Authority verification failed: ${authCheck.reason}`);
      }

      // Check repeated install / conflicting content for existing committed OR durable staged versions
      const existingCommitted = reg.versions.find((v) => v.versionKey === versionKey);
      const existingStaged = reg.stagedPackages.find((v) => v.versionKey === versionKey);
      const existingAny = existingCommitted ?? existingStaged;
      if (existingAny) {
        const contentMatch =
          existingAny.packageManifestSha256 === authCheck.manifestSha256 &&
          existingAny.graphSha256 === m.graphSha256 &&
          existingAny.tilesSha256 === m.tilesSha256 &&
          existingAny.packageId === m.packageId;
        if (!contentMatch) {
          return makeFail(
            'FAILED',
            'CONFLICTING_VERSION_CONTENT',
            `Version ${versionKey} already installed/staged with different manifest or content hashes`,
          );
        }
        if (existingCommitted) {
          const checkIntact = await this.#verifyRecordAssetsOnStorage(existingCommitted, 'committed');
          if (!checkIntact.ok) {
            await this.#markVersionCorruptedUnlocked(versionKey, checkIntact.reason);
            return makeFail('FAILED', 'INSTALLED_ASSET_CORRUPTED', `Existing ${versionKey} is corrupted: ${checkIntact.reason}`);
          }
          if (options.activateImmediately !== false && currentSlot?.activeVersionKey !== versionKey) {
            const actRes = await this.#activateCommittedUnlocked(versionKey);
            return {
              ok: actRes.ok,
              finalState: actRes.ok ? 'ACTIVATED' : 'FAILED',
              operationId,
              regionId: m.regionId,
              versionKey,
              activeVersionKey: actRes.ok ? actRes.activeVersionKey : prevActive,
              previousVersionKey: actRes.ok ? actRes.previousVersionKey : currentSlot?.previousVersionKey ?? null,
              recoveredFromPriorCrash: recovery.recovered,
              idempotentReinstall: true,
              preflight,
              errorCode: actRes.ok ? null : actRes.code,
              reason: actRes.ok ? `Activated already-installed immutable version ${versionKey}` : actRes.reason,
            };
          }
          return {
            ok: true,
            finalState: options.activateImmediately === false ? 'READY_FOR_ACTIVATION' : 'ACTIVATED',
            operationId,
            regionId: m.regionId,
            versionKey,
            activeVersionKey: currentSlot?.activeVersionKey ?? null,
            previousVersionKey: currentSlot?.previousVersionKey ?? null,
            recoveredFromPriorCrash: recovery.recovered,
            idempotentReinstall: true,
            preflight,
            errorCode: null,
            reason: `Idempotent reinstall verified for ${versionKey}`,
          };
        }
        if (existingStaged) {
          const checkStaged = await this.#verifyRecordAssetsOnStorage(existingStaged, 'staging');
          if (checkStaged.ok) {
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
                idempotentReinstall: true,
                preflight,
                errorCode: null,
                reason: `Package ${versionKey} already durably staged in READY_FOR_ACTIVATION`,
              };
            }
            const actRes = await this.#activateStagedUnlocked(versionKey, options.injectCrashAt);
            return {
              ok: actRes.ok,
              finalState: actRes.ok ? 'ACTIVATED' : 'FAILED',
              operationId,
              regionId: m.regionId,
              versionKey,
              activeVersionKey: actRes.ok ? actRes.activeVersionKey : prevActive,
              previousVersionKey: actRes.ok ? actRes.previousVersionKey : currentSlot?.previousVersionKey ?? null,
              recoveredFromPriorCrash: recovery.recovered,
              idempotentReinstall: true,
              preflight,
              errorCode: actRes.ok ? null : actRes.code,
              reason: actRes.ok ? `Activated previously staged ${versionKey}` : actRes.reason,
            };
          }
        }
      }

      if (!preflight.ok) {
        return makeFail('FAILED', 'PREFLIGHT_QUOTA_REJECTED', preflight.reason ?? 'Storage preflight failed');
      }

      const writeJournal = async (patch: Partial<InstallJournalRecord> & { state: InstallState }): Promise<void> => {
        const base: InstallJournalRecord = reg.activeJournal ?? {
          operationId,
          kind: options.activateImmediately === false ? 'STAGE_ONLY' : 'INSTALL',
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

        // STAGING
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
              `Entry ${entry.relativePath} compressed size mismatch`,
              stagedKeys,
            );
          }
          const wireSha = await sha256Hex(wireBytes);
          if (wireSha !== entry.compressedSha256) {
            return makeFail('FAILED', 'COMPRESSED_SHA256_MISMATCH', `Entry ${entry.relativePath} compressed SHA-256 mismatch`, stagedKeys);
          }

          let rawBytes: Uint8Array;
          if (entry.encoding === 'gzip') {
            rawBytes = await boundedDecompressGzip(wireBytes, entry.sizeBytes, m.maxSingleEntryBytes);
          } else {
            if (wireBytes.byteLength !== entry.sizeBytes) {
              return makeFail('FAILED', 'RAW_ENTRY_SIZE_MISMATCH', `Raw entry ${entry.relativePath} size mismatch`, stagedKeys);
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

        // ASSET_VERIFICATION
        await writeJournal({ state: 'ASSET_VERIFICATION' });
        for (const entry of m.assets) {
          const sKey = stagingAssetKey(operationId, entry.role);
          const persisted = await this.#backend.readStagingAsset(sKey);
          if (!persisted || persisted.byteLength !== entry.sizeBytes) {
            return makeFail('FAILED', 'STAGED_ASSET_MISSING_OR_TRUNCATED', `Staged asset ${sKey} missing or size mismatch`, stagedKeys);
          }
          const actualSha = await sha256Hex(persisted);
          if (actualSha !== entry.sha256) {
            return makeFail('FAILED', 'ASSET_SHA256_MISMATCH', `Verified asset ${entry.role} SHA-256 mismatch`, stagedKeys);
          }
          decodedAssetCache.set(entry.role, persisted);
        }

        // COMPATIBILITY_VERIFICATION
        await writeJournal({ state: 'COMPATIBILITY_VERIFICATION' });
        const td = new TextDecoder();
        const regionManifestRaw = JSON.parse(td.decode(decodedAssetCache.get('region-manifest')!));
        const tileManifestRaw = JSON.parse(td.decode(decodedAssetCache.get('tile-manifest')!));
        const graphPackRaw = JSON.parse(td.decode(decodedAssetCache.get('graph-pack')!));
        const graphPackSha = await sha256Hex(decodedAssetCache.get('graph-pack')!);
        if (graphPackSha !== m.graphFileSha256) {
          return makeFail('FAILED', 'GRAPH_FILE_SHA_MISMATCH', 'Graph file SHA-256 mismatch', stagedKeys);
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

        const expectedArchiveId = makeImmutablePMTilesArchiveId(m.regionId, m.version, m.packageVersion, m.tilesSha256);
        if (m.styleUrls.pmtilesSourceUrl !== `pmtiles://${expectedArchiveId}`) {
          return makeFail('FAILED', 'PMTILES_ARCHIVE_IDENTITY_MISMATCH', 'Manifest styleUrls.pmtilesSourceUrl not bound to immutable archive ID', stagedKeys);
        }

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

        const pmBytes = decodedAssetCache.get('pmtiles')!;
        if (td.decode(pmBytes.subarray(0, 7)) !== 'PMTiles') {
          return makeFail('FAILED', 'INVALID_PMTILES_MAGIC', 'Staged PMTiles missing PMTiles header magic', stagedKeys);
        }
        const pmtilesBlockSha256s = await computeBlockSha256s(pmBytes, PMTILES_INTEGRITY_BLOCK_BYTES);

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
          pmtilesArchiveId: expectedArchiveId,
          pmtilesBlockSizeBytes: PMTILES_INTEGRITY_BLOCK_BYTES,
          pmtilesBlockSha256s,
          regionManifestSha256: m.regionManifestSha256,
          tileManifestSha256: m.tileManifestSha256,
          portalSetSha256: m.portalSetSha256,
          packageManifestSha256: authCheck.manifestSha256,
          styleVersion: m.styleVersion,
          bounds: [...m.bounds] as [number, number, number, number],
          installedAtUtc: nowUtc(),
          totalStoredBytes: m.totalUncompressedBytes,
          corrupted: false,
          corruptionReason: null,
          assets: committedRefs,
        };

        // Durable staged install-only path (C05-FIX-01-B): persist verified bytes under staged_<versionKey>/
        if (options.activateImmediately === false) {
          const durableStagedRefs: StoredAssetRef[] = [];
          for (const entry of m.assets) {
            const dKey = durableStagedAssetKey(versionKey, entry.role);
            await this.#backend.writeStagingAsset(dKey, decodedAssetCache.get(entry.role)!);
            await this.#backend.deleteStagingAsset(stagingAssetKey(operationId, entry.role)).catch(() => undefined);
            durableStagedRefs.push({
              role: entry.role,
              assetKey: dKey,
              sha256: entry.sha256,
              sizeBytes: entry.sizeBytes,
            });
          }
          const durableStagedRec: InstalledVersionRecord = {
            ...committedVersion,
            assets: durableStagedRefs,
          };
          const checkStaged = await this.#verifyRecordAssetsOnStorage(durableStagedRec, 'staging');
          if (!checkStaged.ok) {
            return makeFail('FAILED', 'DURABLE_STAGING_VERIFICATION_FAILED', checkStaged.reason, []);
          }
          const nextStagedList = [...reg.stagedPackages.filter((s) => s.versionKey !== versionKey), durableStagedRec];
          reg = await this.#casUpdate(reg.revision, {
            ...reg,
            stagedPackages: nextStagedList,
            activeJournal: null,
          });
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
            reason: `Region ${versionKey} durably staged and verified in READY_FOR_ACTIVATION`,
          };
        }

        // Immediate atomic activation path
        await writeJournal({
          state: 'READY_FOR_ACTIVATION',
          committedVersionSnapshot: committedVersion,
        });

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
        const nextStaged = reg.stagedPackages.filter((s) => s.versionKey !== versionKey);
        const hasRef = reg.references.some((r) => r.versionKey === versionKey);
        const nextRefs = hasRef
          ? reg.references
          : [...reg.references, { versionKey, activeRoutes: [], activeMovements: [], pinnedSaveHeads: [] }];

        reg = await this.#casUpdate(reg.revision, {
          ...reg,
          regions: nextRegions,
          versions: nextVersions,
          stagedPackages: nextStaged,
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

  async #activateStagedUnlocked(
    versionKey: string,
    injectCrashAt?: CrashStageHook,
  ): Promise<Readonly<{ ok: true; activeVersionKey: string; previousVersionKey: string | null } | { ok: false; code: string; reason: string }>> {
    let reg = await this.#loadOrInitRegistry();
    const staged = reg.stagedPackages.find((s) => s.versionKey === versionKey);
    if (!staged) {
      return { ok: false, code: 'VERSION_NOT_FOUND', reason: `Staged version not found: ${versionKey}` };
    }
    const verifyStaged = await this.#verifyRecordAssetsOnStorage(staged, 'staging');
    if (!verifyStaged.ok) {
      return { ok: false, code: 'STAGED_ASSET_CORRUPTED', reason: verifyStaged.reason };
    }

    const opId = `activate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slot = reg.regions.find((r) => r.regionId === staged.regionId);
    const prevActive = slot?.activeVersionKey ?? null;

    const committedRefs: StoredAssetRef[] = staged.assets.map((a) => ({
      role: a.role,
      assetKey: committedAssetKey(versionKey, a.role),
      sha256: a.sha256,
      sizeBytes: a.sizeBytes,
    }));
    const committedVer: InstalledVersionRecord = {
      ...staged,
      assets: committedRefs,
      corrupted: false,
      corruptionReason: null,
    };

    const journal: InstallJournalRecord = {
      operationId: opId,
      kind: 'ACTIVATE',
      state: 'READY_FOR_ACTIVATION',
      packageId: staged.packageId,
      regionId: staged.regionId,
      version: staged.version,
      targetVersionKey: versionKey,
      previousActiveVersionKey: prevActive,
      stagingPrefix: `staged_${versionKey}/`,
      stagedAssetKeys: staged.assets.map((a) => a.assetKey),
      committedVersionSnapshot: committedVer,
      failureReason: null,
      startedAtUtc: nowUtc(),
      updatedAtUtc: nowUtc(),
    };
    reg = await this.#casUpdate(reg.revision, { ...reg, activeJournal: journal });

    const tempKeysCreated: string[] = [];
    try {
      for (let i = 0; i < staged.assets.length; i++) {
        if (injectCrashAt === 'DURING_ACTIVATION' && i === Math.floor(staged.assets.length / 2)) {
          throw new FaultInjectedAbortError(`Simulated crash DURING_ACTIVATION on staged ${staged.assets[i].role}`);
        }
        const stagedBytes = await this.#backend.readStagingAsset(staged.assets[i].assetKey);
        if (!stagedBytes || stagedBytes.byteLength !== staged.assets[i].sizeBytes) {
          throw new Error(`STAGED_ASSET_UNREADABLE_FOR_ACTIVATION: ${staged.assets[i].assetKey}`);
        }
        // Stage an ephemeral per-op copy so durable staged_<versionKey>/* remains untouched until CAS commit succeeds.
        const tmpKey = `op_${opId}/${staged.assets[i].role}`;
        tempKeysCreated.push(tmpKey);
        await this.#backend.writeStagingAsset(tmpKey, stagedBytes);
        await this.#backend.promoteStagedAsset(tmpKey, committedRefs[i].assetKey);
      }
      if (injectCrashAt === 'AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT') {
        throw new FaultInjectedAbortError('Simulated crash AFTER_PROMOTION_BEFORE_REGISTRY_COMMIT');
      }
    } catch (err) {
      if (err instanceof FaultInjectedAbortError) {
        throw err;
      }
      // Cleanup partial temp/committed assets on non-injected promotion write failure, leaving durable staged intact!
      for (const tmpKey of tempKeysCreated) {
        await this.#backend.deleteStagingAsset(tmpKey).catch(() => undefined);
      }
      for (const a of committedRefs) {
        await this.#backend.deleteCommittedAsset(a.assetKey).catch(() => undefined);
      }
      reg = await this.#casUpdate(reg.revision, { ...reg, activeJournal: null });
      return {
        ok: false,
        code: 'PROMOTION_WRITE_FAILED',
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const newPrev = prevActive && prevActive !== versionKey ? prevActive : slot?.previousVersionKey ?? null;
    const retained = new Set(slot?.retainedVersionKeys ?? []);
    if (prevActive && prevActive !== versionKey) retained.add(prevActive);
    retained.add(versionKey);

    const nextSlot: RegionSlotState = {
      regionId: staged.regionId,
      activeVersionKey: versionKey,
      previousVersionKey: newPrev,
      retainedVersionKeys: [...retained].sort(),
      updatedAtUtc: nowUtc(),
    };
    const nextRegions = [...reg.regions.filter((r) => r.regionId !== staged.regionId), nextSlot].sort((a, b) =>
      a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
    );
    const nextVersions = [...reg.versions.filter((v) => v.versionKey !== versionKey), committedVer];
    const nextStaged = reg.stagedPackages.filter((s) => s.versionKey !== versionKey);
    const hasRef = reg.references.some((r) => r.versionKey === versionKey);
    const nextRefs = hasRef
      ? reg.references
      : [...reg.references, { versionKey, activeRoutes: [], activeMovements: [], pinnedSaveHeads: [] }];

    reg = await this.#casUpdate(reg.revision, {
      ...reg,
      regions: nextRegions,
      versions: nextVersions,
      stagedPackages: nextStaged,
      references: nextRefs,
      activeJournal: { ...journal, state: 'ACTIVATED', updatedAtUtc: nowUtc() },
    });

    if (injectCrashAt === 'AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR') {
      throw new FaultInjectedAbortError('Simulated crash AFTER_REGISTRY_COMMIT_BEFORE_JOURNAL_CLEAR');
    }

    for (const a of staged.assets) {
      await this.#backend.deleteStagingAsset(a.assetKey).catch(() => undefined);
    }
    reg = await this.#casUpdate(reg.revision, { ...reg, activeJournal: null });
    this.#backend.broadcastEvent({
      type: 'REGISTRY_UPDATED',
      regionId: staged.regionId,
      revision: reg.revision,
      activeVersionKey: versionKey,
      timestampUtc: nowUtc(),
    });
    return { ok: true, activeVersionKey: versionKey, previousVersionKey: newPrev };
  }

  async #activateCommittedUnlocked(
    targetVersionKey: string,
  ): Promise<Readonly<{ ok: true; activeVersionKey: string; previousVersionKey: string | null } | { ok: false; code: string; reason: string }>> {
    let reg = await this.#loadOrInitRegistry();
    const targetVer = reg.versions.find((v) => v.versionKey === targetVersionKey);
    if (!targetVer) {
      return { ok: false, code: 'VERSION_NOT_FOUND', reason: `Version ${targetVersionKey} not found` };
    }
    if (targetVer.corrupted) {
      return {
        ok: false,
        code: 'VERSION_CORRUPTED_INVALIDATED',
        reason: targetVer.corruptionReason ?? `Version ${targetVersionKey} is invalidated due to corruption`,
      };
    }
    const intact = await this.#verifyRecordAssetsOnStorage(targetVer, 'committed');
    if (!intact.ok) {
      await this.#markVersionCorruptedUnlocked(targetVersionKey, intact.reason);
      return { ok: false, code: 'ROLLBACK_ASSET_CORRUPTED', reason: intact.reason };
    }
    const slot = reg.regions.find((r) => r.regionId === targetVer.regionId);
    const oldActive = slot?.activeVersionKey ?? null;
    const retained = new Set(slot?.retainedVersionKeys ?? []);
    if (oldActive && oldActive !== targetVersionKey) retained.add(oldActive);
    retained.add(targetVersionKey);
    const newPrev = oldActive && oldActive !== targetVersionKey ? oldActive : slot?.previousVersionKey ?? null;
    const nextSlot: RegionSlotState = {
      regionId: targetVer.regionId,
      activeVersionKey: targetVersionKey,
      previousVersionKey: newPrev,
      retainedVersionKeys: [...retained].sort(),
      updatedAtUtc: nowUtc(),
    };
    const nextRegions = [...reg.regions.filter((r) => r.regionId !== targetVer.regionId), nextSlot].sort((a, b) =>
      a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0,
    );
    reg = await this.#casUpdate(reg.revision, { ...reg, regions: nextRegions });
    this.#backend.broadcastEvent({
      type: 'ROLLBACK_EXECUTED',
      regionId: targetVer.regionId,
      revision: reg.revision,
      activeVersionKey: targetVersionKey,
      timestampUtc: nowUtc(),
    });
    return { ok: true, activeVersionKey: targetVersionKey, previousVersionKey: newPrev };
  }

  /** Atomically rollback region's active pointer to its retained prior version after full integrity check. */
  async rollbackRegion(
    regionId: string,
    targetVersionKey?: string,
  ): Promise<Readonly<{ ok: true; activeVersionKey: string; previousVersionKey: string | null } | { ok: false; code: string; reason: string }>> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      const recovery = await this.#recoverUnlockedDetailed();
      const reg = recovery.registry;
      if (reg.activeJournal?.kind === 'REMOVE_VERSION') {
        return {
          ok: false,
          code: 'GC_RECOVERY_PENDING',
          reason: reg.activeJournal.failureReason ?? `Pending GC deletion for ${reg.activeJournal.targetVersionKey} must complete before rollback`,
        };
      }
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
      return this.#activateCommittedUnlocked(chosenKey);
    });
  }

  /**
   * Explicitly activate ANY previously staged (READY_FOR_ACTIVATION) OR retained committed version (C05-FIX-01-B).
   * Serialized under exclusive lock so concurrent activation calls stay conflict-free across restarts.
   */
  async activateRetainedVersion(
    versionKey: string,
    options: { injectCrashAt?: CrashStageHook } = {},
  ): Promise<Readonly<{ ok: true; activeVersionKey: string; previousVersionKey: string | null } | { ok: false; code: string; reason: string }>> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      const recovery = await this.#recoverUnlockedDetailed();
      const reg = recovery.registry;
      if (reg.activeJournal?.kind === 'REMOVE_VERSION') {
        return {
          ok: false,
          code: 'GC_RECOVERY_PENDING',
          reason: reg.activeJournal.failureReason ?? `Pending GC deletion for ${reg.activeJournal.targetVersionKey} must complete before activation`,
        };
      }
      if (reg.stagedPackages.some((s) => s.versionKey === versionKey)) {
        return this.#activateStagedUnlocked(versionKey, options.injectCrashAt);
      }
      if (reg.versions.some((v) => v.versionKey === versionKey)) {
        return this.#activateCommittedUnlocked(versionKey);
      }
      return { ok: false, code: 'VERSION_NOT_FOUND', reason: `Installed or staged version not found: ${versionKey}` };
    });
  }

  /** Explicit alias for activating a durably staged READY_FOR_ACTIVATION package. */
  async activateStagedPackage(
    versionKey: string,
    options: { injectCrashAt?: CrashStageHook } = {},
  ) {
    return this.activateRetainedVersion(versionKey, options);
  }

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

  /** Execute durable, verification-enforced GC asset deletions without clearing the journal until ALL targets are confirmed absent. */
  async #executeGcDeletesUnlocked(
    reg: InstalledRegionRegistry,
    journal: InstallJournalRecord,
    options: { injectCrashDuringGc?: boolean; isRecoveryPass?: boolean } = {},
  ): Promise<{
    readonly completed: boolean;
    readonly reclaimedBytes: number;
    readonly pendingBytes: number;
    readonly deletedAssetKeys: readonly string[];
    readonly alreadyAbsentAssetKeys: readonly string[];
    readonly remainingAssetKeys: readonly string[];
    readonly failureSummary: string | null;
    readonly registry: InstalledRegionRegistry;
  }> {
    const assetSizeByKey = new Map<string, number>();
    for (const a of journal.committedVersionSnapshot?.assets ?? []) {
      assetSizeByKey.set(a.assetKey, a.sizeBytes);
    }

    const targets = [...journal.stagedAssetKeys];
    const deletedAssetKeys: string[] = [];
    const alreadyAbsentAssetKeys: string[] = [];
    const remainingAssetKeys: string[] = [];
    const failures: string[] = [];
    let reclaimedBytes = 0;
    let pendingBytes = 0;

    for (let i = 0; i < targets.length; i++) {
      if (options.injectCrashDuringGc && i === Math.floor(targets.length / 2)) {
        throw new FaultInjectedAbortError(`Simulated crash DURING_GC deleting ${targets[i]}`);
      }
      const assetKey = targets[i];
      let existedBefore: boolean | null = null;
      let observedBytes = assetSizeByKey.get(assetKey) ?? 0;

      try {
        const stBefore = await this.#backend.committedStat(assetKey);
        existedBefore = stBefore.exists;
        if (stBefore.exists && observedBytes === 0) {
          observedBytes = stBefore.byteLength;
        }
      } catch (err) {
        if (isStorageNotFoundError(err)) {
          existedBefore = false;
        } else {
          remainingAssetKeys.push(assetKey);
          pendingBytes += observedBytes;
          failures.push(`${assetKey}: pre-delete stat failed (${err instanceof Error ? err.message : String(err)})`);
          continue;
        }
      }

      if (existedBefore === false) {
        // Distinguish already-absent asset from genuine I/O failure; reclaimedBytes remains accurate (0 freed now).
        alreadyAbsentAssetKeys.push(assetKey);
        continue;
      }

      try {
        await this.#backend.deleteCommittedAsset(assetKey);
      } catch (err) {
        if (!isStorageNotFoundError(err)) {
          remainingAssetKeys.push(assetKey);
          pendingBytes += observedBytes;
          failures.push(`${assetKey}: delete failed (${err instanceof Error ? err.message : String(err)})`);
          continue;
        }
      }

      try {
        const stAfter = await this.#backend.committedStat(assetKey);
        if (stAfter.exists) {
          remainingAssetKeys.push(assetKey);
          pendingBytes += observedBytes > 0 ? observedBytes : stAfter.byteLength;
          failures.push(`${assetKey}: asset still exists after deleteCommittedAsset`);
        } else {
          deletedAssetKeys.push(assetKey);
          reclaimedBytes += observedBytes;
        }
      } catch (err) {
        if (isStorageNotFoundError(err)) {
          deletedAssetKeys.push(assetKey);
          reclaimedBytes += observedBytes;
        } else {
          remainingAssetKeys.push(assetKey);
          pendingBytes += observedBytes;
          failures.push(`${assetKey}: post-delete verification failed (${err instanceof Error ? err.message : String(err)})`);
        }
      }
    }

    if (remainingAssetKeys.length === 0) {
      const nextReg = await this.#casUpdate(reg.revision, {
        ...reg,
        activeJournal: null,
        lastRecoveredOperationId: options.isRecoveryPass ? journal.operationId : reg.lastRecoveredOperationId,
      });
      return {
        completed: true,
        reclaimedBytes,
        pendingBytes: 0,
        deletedAssetKeys,
        alreadyAbsentAssetKeys,
        remainingAssetKeys: [],
        failureSummary: null,
        registry: nextReg,
      };
    }

    const failureSummary = `GC_DELETE_INCOMPLETE: ${remainingAssetKeys.length}/${targets.length} unconfirmed (${failures.join('; ')})`.slice(0, 500);
    const nextReg = await this.#casUpdate(reg.revision, {
      ...reg,
      activeJournal: {
        ...journal,
        state: 'RECOVERY_REQUIRED',
        stagedAssetKeys: remainingAssetKeys,
        failureReason: failureSummary,
        updatedAtUtc: nowUtc(),
      },
    });
    return {
      completed: false,
      reclaimedBytes,
      pendingBytes,
      deletedAssetKeys,
      alreadyAbsentAssetKeys,
      remainingAssetKeys,
      failureSummary,
      registry: nextReg,
    };
  }

  /**
   * Crash-consistent garbage collection (C05-FIX-01-A & C05-FIX-02-GC):
   * - ALWAYS protects activeVersionKey.
   * - ALWAYS protects previousVersionKey (mandatory rollback version) unless explicit
   *   `allowDeleteRollbackVersion: true` policy override is requested.
   * - ALWAYS protects versions pinned by activeRoutes, activeMovements, or pinnedSaveHeads.
   * - Writes durable journal intent & removes metadata pointers first, verifies every targeted
   *   asset absent on storage before clearing journal or reporting final reclaimed bytes, and retains
   *   unconfirmed keys across restart/recovery on genuine I/O failures.
   */
  async removeUnusedVersion(
    versionKey: string,
    options: { allowDeleteRollbackVersion?: boolean; injectCrashDuringGc?: boolean } = {},
  ): Promise<
    Readonly<
      | {
          ok: true;
          removedVersionKey: string;
          freedBytes: number;
          alreadyAbsentAssetKeys?: readonly string[];
        }
      | {
          ok: false;
          code: string;
          reason: string;
          freedBytes?: number;
          pendingBytes?: number;
          remainingAssetKeys?: readonly string[];
          alreadyAbsentAssetKeys?: readonly string[];
        }
    >
  > {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      const recovery = await this.#recoverUnlockedDetailed();
      let reg = recovery.registry;
      if (reg.activeJournal?.kind === 'REMOVE_VERSION') {
        const isSameTarget = reg.activeJournal.targetVersionKey === versionKey;
        return {
          ok: false,
          code: isSameTarget ? 'GC_DELETE_INCOMPLETE' : 'GC_RECOVERY_PENDING',
          reason:
            reg.activeJournal.failureReason ??
            `Pending GC removal for ${reg.activeJournal.targetVersionKey} has unconfirmed asset deletions`,
          freedBytes: recovery.freedBytes ?? 0,
          remainingAssetKeys: recovery.remainingAssetKeys ?? reg.activeJournal.stagedAssetKeys,
          alreadyAbsentAssetKeys: recovery.alreadyAbsentAssetKeys ?? [],
        };
      }
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
      if (slot?.previousVersionKey === versionKey && !options.allowDeleteRollbackVersion) {
        return {
          ok: false,
          code: 'VERSION_IS_MANDATORY_ROLLBACK',
          reason: `Cannot delete mandatory rollback version ${versionKey} while it is the retained previousVersionKey`,
        };
      }

      const gcOpId = `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const assetKeysToDelete = ver.assets.map((a) => a.assetKey);
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

      const journal: InstallJournalRecord = {
        operationId: gcOpId,
        kind: 'REMOVE_VERSION',
        state: 'READY_FOR_ACTIVATION',
        packageId: ver.packageId,
        regionId: ver.regionId,
        version: ver.version,
        targetVersionKey: versionKey,
        previousActiveVersionKey: slot?.activeVersionKey ?? null,
        stagingPrefix: `ver_${versionKey}/`,
        stagedAssetKeys: assetKeysToDelete,
        committedVersionSnapshot: ver,
        failureReason: null,
        startedAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };

      reg = await this.#casUpdate(reg.revision, {
        ...reg,
        regions: nextRegions,
        versions: nextVersions,
        references: nextRefs,
        activeJournal: journal,
      });

      const gcRes = await this.#executeGcDeletesUnlocked(reg, journal, {
        injectCrashDuringGc: options.injectCrashDuringGc,
        isRecoveryPass: false,
      });
      if (!gcRes.completed) {
        return {
          ok: false,
          code: 'GC_DELETE_INCOMPLETE',
          reason: gcRes.failureSummary ?? `Failed to confirm deletion of ${gcRes.remainingAssetKeys.length} assets`,
          freedBytes: gcRes.reclaimedBytes,
          pendingBytes: gcRes.pendingBytes,
          remainingAssetKeys: gcRes.remainingAssetKeys,
          alreadyAbsentAssetKeys: gcRes.alreadyAbsentAssetKeys,
        };
      }

      this.#backend.broadcastEvent({
        type: 'VERSION_REMOVED',
        regionId: ver.regionId,
        revision: gcRes.registry.revision,
        activeVersionKey: slot?.activeVersionKey ?? null,
        timestampUtc: nowUtc(),
      });
      return {
        ok: true,
        removedVersionKey: versionKey,
        freedBytes: gcRes.reclaimedBytes,
        alreadyAbsentAssetKeys: gcRes.alreadyAbsentAssetKeys,
      };
    });
  }

  /** Load immutable RailGraph, manifests, portals, and bounded integrity-enforced PMTiles range source. */
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
    if (ver.corrupted) {
      throw new Error(`INSTALLED_VERSION_CORRUPTED_INVALIDATED: ${ver.corruptionReason ?? versionKey}`);
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
      await this.#markVersionCorruptedUnlocked(versionKey, `CORRUPTED_COMMITTED_ASSET: ${graphAsset.assetKey}`);
      throw new Error(`CORRUPTED_COMMITTED_ASSET: ${graphAsset.assetKey}`);
    }
    if ((await sha256Hex(rmBytes)) !== rmAsset.sha256) {
      await this.#markVersionCorruptedUnlocked(versionKey, `CORRUPTED_COMMITTED_ASSET: ${rmAsset.assetKey}`);
      throw new Error(`CORRUPTED_COMMITTED_ASSET: ${rmAsset.assetKey}`);
    }
    if ((await sha256Hex(tmBytes)) !== tmAsset.sha256) {
      await this.#markVersionCorruptedUnlocked(versionKey, `CORRUPTED_COMMITTED_ASSET: ${tmAsset.assetKey}`);
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
        await this.#markVersionCorruptedUnlocked(versionKey, `CORRUPTED_COMMITTED_ASSET: ${pAsset.assetKey}`);
        throw new Error(`CORRUPTED_COMMITTED_ASSET: ${pAsset.assetKey}`);
      }
      portalSet = decodeRegionPortalSet(JSON.parse(td.decode(pBytes)));
    }

    const pmtilesSource = new VerifiedInstalledPMTilesSource({
      versionKey: ver.versionKey,
      archiveId: ver.pmtilesArchiveId,
      backend: this.#backend,
      committedKey: pmAsset.assetKey,
      expectedByteLength: pmAsset.sizeBytes,
      expectedSha256: pmAsset.sha256,
      blockSizeBytes: ver.pmtilesBlockSizeBytes,
      blockSha256s: ver.pmtilesBlockSha256s,
      initialCorrupted: ver.corrupted,
      initialCorruptionReason: ver.corruptionReason,
      onCorruptionDetected: async (reason) => {
        await this.#markVersionCorruptedUnlocked(ver.versionKey, reason);
      },
      isExternallyInvalidated: async () => {
        const curReg = await this.#backend.readState();
        const curVer = curReg?.versions.find((v) => v.versionKey === ver.versionKey);
        if (!curVer) return `VERSION_REMOVED: ${ver.versionKey}`;
        return curVer.corrupted ? (curVer.corruptionReason ?? `VERSION_INVALIDATED: ${ver.versionKey}`) : null;
      },
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

  /**
   * Verify on-storage SHA-256 and byte lengths across installed versions.
   * Persists durable invalidation when corruption is found so subsequent reads/activations fail closed.
   */
  async verifyInstalledIntegrity(
    versionKey?: string,
  ): Promise<Readonly<{ ok: true; checkedAssets: number } | { ok: false; reason: string; versionKey: string }>> {
    return this.#backend.withExclusiveLock('region-registry-op', async () => {
      const reg = await this.#loadOrInitRegistry();
      const targets = versionKey ? reg.versions.filter((v) => v.versionKey === versionKey) : reg.versions;
      let checked = 0;
      for (const ver of targets) {
        if (ver.corrupted) {
          return {
            ok: false,
            versionKey: ver.versionKey,
            reason: ver.corruptionReason ?? `INSTALLED_VERSION_CORRUPTED_INVALIDATED: ${ver.versionKey}`,
          };
        }
        const check = await this.#verifyRecordAssetsOnStorage(ver, 'committed');
        if (!check.ok) {
          await this.#markVersionCorruptedUnlocked(ver.versionKey, check.reason);
          return {
            ok: false,
            versionKey: ver.versionKey,
            reason: check.reason,
          };
        }
        checked += ver.assets.length;
      }
      return { ok: true, checkedAssets: checked };
    });
  }
}
