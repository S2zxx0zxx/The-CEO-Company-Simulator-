import { gaugeMm, hertz, integer, metres, speedKmh, volts } from '../../domain/units';
import {
  booleanValue,
  distinct,
  enumeration,
  id,
  list,
  nullable,
  object,
  refine,
  sha256,
  sourceUrl,
  text,
  utc,
  version1,
  type Decoded,
} from '../../domain/validation';
import { decodeBoundaryLayerContract, decodeBBox } from '../map/contracts';
import { isValidArchiveKey, resolveOfflinePMTilesArchiveId } from '../map/pmtiles-adapter';
import { isPermittedOfflineUrl } from '../map/style';

export const REGION_PACKAGE_DEFAULT_MAX_SINGLE_ENTRY_BYTES = 256 * 1024 * 1024;
export const REGION_PACKAGE_DEFAULT_SAFETY_RESERVE_BYTES = 16 * 1024 * 1024;
export const PMTILES_INTEGRITY_BLOCK_BYTES = 16 * 1024;

export const INSTALL_STATES = [
  'DISCOVERED',
  'PREFLIGHT',
  'STAGING',
  'ASSET_VERIFICATION',
  'COMPATIBILITY_VERIFICATION',
  'READY_FOR_ACTIVATION',
  'ACTIVATED',
  'FAILED',
  'CANCELLED',
  'RECOVERY_REQUIRED',
] as const;

export type InstallState = (typeof INSTALL_STATES)[number];

export const REGION_ASSET_ROLES = [
  'region-manifest',
  'graph-pack',
  'tile-manifest',
  'pmtiles',
  'portals',
  'attribution',
] as const;

export type RegionAssetRole = (typeof REGION_ASSET_ROLES)[number];

/** Deterministic immutable PMTiles archive identity bound to region, package version, and tile SHA-256. */
export function makeImmutablePMTilesArchiveId(
  regionId: string,
  version: string,
  packageVersion: number,
  tilesSha256: string,
): string {
  const safeRegion = regionId.replace(/[^A-Za-z0-9._-]/g, '-');
  const safeVer = version.replace(/[^A-Za-z0-9._-]/g, '-');
  const key = `${safeRegion}--v${safeVer}-p${packageVersion}-${tilesSha256.slice(0, 12)}`;
  if (!isValidArchiveKey(key)) {
    throw new TypeError(`Cannot derive valid immutable PMTiles archive ID: ${key}`);
  }
  return key;
}

/** Validate relative asset paths inside region packages against traversal, drives, or URL schemes. */
export function isSafePackageRelativePath(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 240) {
    return false;
  }
  if (relPath !== relPath.trim() || /[\u0000-\u001f\u007f\\]/.test(relPath)) {
    return false;
  }
  if (relPath.startsWith('/') || relPath.includes('://') || relPath.includes(':') || relPath.includes('?') || relPath.includes('#') || relPath.includes('@')) {
    return false;
  }
  if (/%2e|%2f|%5c|%3a/i.test(relPath)) {
    return false;
  }
  const segments = relPath.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || !/^[A-Za-z0-9._-]+$/.test(s))) {
    return false;
  }
  return true;
}

const safeRelativePath = refine(text(240), isSafePackageRelativePath, 'unsafe package relative asset path');
const positiveInt = (v: unknown, p = 'positiveInt') => integer(v, p, 1);
const nonNegInt = (v: unknown, p = 'nonNegInt') => integer(v, p, 0);
const semverTag = text(64, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/);

export const decodeRegionPackageEntry = refine(
  object({
    role: enumeration(REGION_ASSET_ROLES),
    relativePath: safeRelativePath,
    encoding: enumeration(['raw', 'gzip']),
    sha256,
    compressedSha256: sha256,
    sizeBytes: positiveInt,
    compressedSizeBytes: positiveInt,
  }),
  (e) =>
    e.sizeBytes <= 512 * 1024 * 1024 &&
    e.compressedSizeBytes <= 256 * 1024 * 1024 &&
    (e.encoding !== 'raw' || (e.sizeBytes === e.compressedSizeBytes && e.sha256 === e.compressedSha256)),
  'invalid region asset entry sizes or compression invariant',
);

export type RegionPackageEntry = Decoded<typeof decodeRegionPackageEntry>;

export const decodeRegionStyleUrls = refine(
  object({
    pmtilesSourceUrl: text(256),
    spriteUrl: text(256),
    glyphsUrl: text(256),
  }),
  (u) =>
    resolveOfflinePMTilesArchiveId(u.pmtilesSourceUrl) !== null &&
    isPermittedOfflineUrl(u.pmtilesSourceUrl, { allowedArchiveIds: [resolveOfflinePMTilesArchiveId(u.pmtilesSourceUrl)!] }) &&
    isPermittedOfflineUrl(u.spriteUrl, {}) &&
    isPermittedOfflineUrl(u.glyphsUrl, {}),
  'region style URLs violate C04-FIX-01 offline URL rules',
);

export const decodeRegionPackageManifest = refine(
  object({
    schemaVersion: version1,
    packageId: id,
    regionId: id,
    version: semverTag,
    packageVersion: positiveInt,
    syntheticOnly: booleanValue,
    sourceUrl,
    snapshotUtc: utc,
    createdAtUtc: utc,
    license: text(128),
    attribution: text(512),
    styleVersion: id,
    bounds: decodeBBox,
    graphSha256: sha256,
    graphFileSha256: sha256,
    tilesSha256: sha256,
    regionManifestSha256: sha256,
    tileManifestSha256: sha256,
    portalSetSha256: nullable(sha256),
    totalUncompressedBytes: positiveInt,
    totalCompressedBytes: positiveInt,
    maxSingleEntryBytes: positiveInt,
    estimatedDecodePeakBytes: positiveInt,
    boundaryContract: decodeBoundaryLayerContract,
    styleUrls: decodeRegionStyleUrls,
    assets: distinct(list(decodeRegionPackageEntry, 5, 16), (a) => a.role),
  }),
  (m) => {
    const paths = new Set(m.assets.map((a) => a.relativePath));
    if (paths.size !== m.assets.length) return false;
    const roles = new Set(m.assets.map((a) => a.role));
    for (const req of ['region-manifest', 'graph-pack', 'tile-manifest', 'pmtiles', 'attribution'] as const) {
      if (!roles.has(req)) return false;
    }
    const sumRaw = m.assets.reduce((acc, a) => acc + a.sizeBytes, 0);
    const sumComp = m.assets.reduce((acc, a) => acc + a.compressedSizeBytes, 0);
    if (sumRaw !== m.totalUncompressedBytes || sumComp !== m.totalCompressedBytes) return false;
    if (m.assets.some((a) => a.sizeBytes > m.maxSingleEntryBytes)) return false;
    const portalAsset = m.assets.find((a) => a.role === 'portals');
    if (portalAsset && m.portalSetSha256 !== portalAsset.sha256) return false;
    if (!portalAsset && m.portalSetSha256 !== null) return false;
    const expectedArchiveId = makeImmutablePMTilesArchiveId(m.regionId, m.version, m.packageVersion, m.tilesSha256);
    if (m.styleUrls.pmtilesSourceUrl !== `pmtiles://${expectedArchiveId}`) return false;
    return true;
  },
  'invalid region package manifest totals, roles, hashes, or version-bound archive identity',
);

export type RegionPackageManifest = Decoded<typeof decodeRegionPackageManifest>;

export const decodeSignedRegionPackageEnvelope = object({
  schemaVersion: version1,
  manifest: decodeRegionPackageManifest,
  manifestSha256: sha256,
  signatureAlgorithm: enumeration(['ECDSA-P256-SHA256']),
  keyId: id,
  signatureBase64: text(512),
});

export type SignedRegionPackageEnvelope = Decoded<typeof decodeSignedRegionPackageEnvelope>;

export const decodeTrustedPublicKeyRecord = object({
  keyId: id,
  algorithm: enumeration(['ECDSA-P256-SHA256']),
  spkiBase64: text(1024),
  active: booleanValue,
});

export const decodeTrustedRegionAuthority = object({
  schemaVersion: version1,
  trustedKeys: distinct(list(decodeTrustedPublicKeyRecord, 0, 32), (k) => k.keyId),
  pinnedManifestSha256s: nullable(distinct(list(sha256, 0, 1024), (s) => s)),
  requireSignature: booleanValue,
  requirePinnedIndex: booleanValue,
  allowSyntheticOnly: booleanValue,
  allowRealData: booleanValue,
});

export type TrustedRegionAuthority = Decoded<typeof decodeTrustedRegionAuthority>;

export const decodeRegionPortal = refine(
  object({
    id,
    regionAId: id,
    graphASha256: sha256,
    stationAId: id,
    nodeAId: id,
    regionBId: id,
    graphBSha256: sha256,
    stationBId: id,
    nodeBId: id,
    allowedDirection: enumeration(['A_TO_B', 'B_TO_A', 'BOTH']),
    gaugesMm: distinct(list(gaugeMm, 1, 16), (v) => v),
    electrification: enumeration(['yes', 'no', 'unknown']),
    voltagesV: distinct(list(volts, 0, 16), (v) => v),
    frequenciesHz: distinct(list(hertz, 0, 16), (v) => v),
    maxSpeedKmh: nullable(speedKmh),
    seamDistanceM: metres,
    verified: booleanValue,
    provenance: sourceUrl,
  }),
  (p) =>
    p.regionAId !== p.regionBId &&
    (p.electrification !== 'no' || (p.voltagesV.length === 0 && p.frequenciesHz.length === 0)),
  'invalid region portal endpoint or electrical contract',
);

export type RegionPortal = Decoded<typeof decodeRegionPortal>;

export const decodeRegionPortalSet = object({
  schemaVersion: version1,
  portalSetId: id,
  portals: distinct(list(decodeRegionPortal, 0, 512), (p) => p.id),
});

export type RegionPortalSet = Decoded<typeof decodeRegionPortalSet>;

export const decodeStoredAssetRef = object({
  role: enumeration(REGION_ASSET_ROLES),
  assetKey: text(240),
  sha256,
  sizeBytes: positiveInt,
});

export type StoredAssetRef = Decoded<typeof decodeStoredAssetRef>;

export const decodeInstalledVersionRecord = object({
  versionKey: id,
  packageId: id,
  regionId: id,
  version: semverTag,
  packageVersion: positiveInt,
  syntheticOnly: booleanValue,
  graphSha256: sha256,
  graphFileSha256: sha256,
  tilesSha256: sha256,
  pmtilesArchiveId: id,
  pmtilesBlockSizeBytes: positiveInt,
  pmtilesBlockSha256s: list(sha256, 1, 65536),
  regionManifestSha256: sha256,
  tileManifestSha256: sha256,
  portalSetSha256: nullable(sha256),
  packageManifestSha256: sha256,
  styleVersion: id,
  bounds: decodeBBox,
  installedAtUtc: utc,
  totalStoredBytes: positiveInt,
  corrupted: booleanValue,
  corruptionReason: nullable(text(512)),
  assets: distinct(list(decodeStoredAssetRef, 5, 16), (a) => a.role),
});

export type InstalledVersionRecord = Decoded<typeof decodeInstalledVersionRecord>;

export const decodeVersionReferenceCounts = object({
  versionKey: id,
  activeRoutes: distinct(list(id, 0, 100000), (x) => x),
  activeMovements: distinct(list(id, 0, 100000), (x) => x),
  pinnedSaveHeads: distinct(list(id, 0, 10000), (x) => x),
});

export type VersionReferenceRecord = Decoded<typeof decodeVersionReferenceCounts>;

export const decodeRegionSlotState = object({
  regionId: id,
  activeVersionKey: nullable(id),
  previousVersionKey: nullable(id),
  retainedVersionKeys: distinct(list(id, 0, 32), (x) => x),
  updatedAtUtc: utc,
});

export type RegionSlotState = Decoded<typeof decodeRegionSlotState>;

export const decodeInstallJournalRecord = object({
  operationId: id,
  kind: enumeration(['INSTALL', 'STAGE_ONLY', 'ACTIVATE', 'ROLLBACK', 'REMOVE_VERSION']),
  state: enumeration(INSTALL_STATES),
  packageId: id,
  regionId: id,
  version: semverTag,
  targetVersionKey: id,
  previousActiveVersionKey: nullable(id),
  stagingPrefix: text(160),
  stagedAssetKeys: list(text(240), 0, 32),
  committedVersionSnapshot: nullable(decodeInstalledVersionRecord),
  failureReason: nullable(text(512)),
  startedAtUtc: utc,
  updatedAtUtc: utc,
});

export type InstallJournalRecord = Decoded<typeof decodeInstallJournalRecord>;

export const decodeInstalledRegionRegistry = object({
  schemaVersion: version1,
  revision: nonNegInt,
  regions: distinct(list(decodeRegionSlotState, 0, 1024), (r) => r.regionId),
  versions: distinct(list(decodeInstalledVersionRecord, 0, 4096), (v) => v.versionKey),
  stagedPackages: distinct(list(decodeInstalledVersionRecord, 0, 1024), (v) => v.versionKey),
  references: distinct(list(decodeVersionReferenceCounts, 0, 4096), (r) => r.versionKey),
  activeJournal: nullable(decodeInstallJournalRecord),
  lastRecoveredOperationId: nullable(id),
  updatedAtUtc: utc,
});

export type InstalledRegionRegistry = Decoded<typeof decodeInstalledRegionRegistry>;

export interface StorageQuotaReport {
  readonly backendName: string;
  readonly quotaStatus: 'KNOWN' | 'UNKNOWN' | 'UNSUPPORTED';
  readonly totalQuotaBytes: number | null;
  readonly usedBytes: number | null;
  readonly availableBytes: number | null;
  readonly persistentStorageGranted: boolean | null;
}

export interface StoragePreflightReport {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly quotaStatus: StorageQuotaReport['quotaStatus'];
  readonly availableBytes: number | null;
  readonly incomingCompressedBytes: number;
  readonly extractedUncompressedBytes: number;
  readonly stagingWorkingBytes: number;
  readonly existingActiveBytes: number;
  readonly rollbackRetainedBytes: number;
  readonly safetyReserveBytes: number;
  readonly totalRequiredBytes: number;
}

/** Deterministic sorted-key JSON serialization matching Python canonical_json_bytes(). */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(rec[k])).join(',') +
      '}'
    );
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonStringify(value));
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const slice = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', slice);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** Partition binary bytes into fixed block hashes so range reads verify touched blocks without full-RAM load. */
export async function computeBlockSha256s(
  bytes: Uint8Array,
  blockSizeBytes = PMTILES_INTEGRITY_BLOCK_BYTES,
): Promise<string[]> {
  if (!Number.isSafeInteger(blockSizeBytes) || blockSizeBytes <= 0) {
    throw new TypeError(`Invalid blockSizeBytes: ${blockSizeBytes}`);
  }
  const digests: string[] = [];
  for (let off = 0; off < bytes.byteLength; off += blockSizeBytes) {
    const end = Math.min(bytes.byteLength, off + blockSizeBytes);
    digests.push(await sha256Hex(bytes.subarray(off, end)));
  }
  return digests;
}

export function decodeBase64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const Buf = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (Buf) {
    return new Uint8Array(Buf.from(b64, 'base64'));
  }
  throw new Error('Base64 decoder unavailable');
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  const Buf = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (Buf) {
    return Buf.from(bytes).toString('base64');
  }
  throw new Error('Base64 encoder unavailable');
}

export interface ManifestAuthorityVerificationResult {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly manifestSha256: string;
}

/**
 * Fail-closed verification of package scope, canonical manifest digest, pinned authority index,
 * and WebCrypto ECDSA P-256 signature. Never trusts self-asserted unpinned manifests.
 */
export async function verifySignedRegionPackageEnvelope(
  rawEnvelope: unknown,
  authorityInput: unknown,
): Promise<ManifestAuthorityVerificationResult> {
  const envelope = decodeSignedRegionPackageEnvelope(rawEnvelope);
  const authority = decodeTrustedRegionAuthority(authorityInput);

  if (envelope.manifest.syntheticOnly && !authority.allowSyntheticOnly) {
    return { ok: false, reason: 'SYNTHETIC_PACKAGE_NOT_PERMITTED', manifestSha256: envelope.manifestSha256 };
  }
  if (!envelope.manifest.syntheticOnly && !authority.allowRealData) {
    return { ok: false, reason: 'REAL_DATA_INTAKE_BLOCKED_BY_COMPLIANCE_GATE', manifestSha256: envelope.manifestSha256 };
  }

  const computedManifestSha = await sha256Hex(canonicalJsonBytes(envelope.manifest));
  if (computedManifestSha !== envelope.manifestSha256) {
    return { ok: false, reason: 'MANIFEST_DIGEST_MISMATCH', manifestSha256: computedManifestSha };
  }

  if (authority.requirePinnedIndex) {
    const pinned = authority.pinnedManifestSha256s;
    if (!pinned || !pinned.includes(computedManifestSha)) {
      return { ok: false, reason: 'UNTRUSTED_UNPINNED_MANIFEST_AUTHORITY', manifestSha256: computedManifestSha };
    }
  }

  if (authority.requireSignature) {
    const keyRec = authority.trustedKeys.find((k) => k.keyId === envelope.keyId);
    if (!keyRec) {
      return { ok: false, reason: 'UNTRUSTED_MANIFEST_SIGNER_KEY', manifestSha256: computedManifestSha };
    }
    if (!keyRec.active) {
      return { ok: false, reason: 'REVOKED_MANIFEST_SIGNER_KEY', manifestSha256: computedManifestSha };
    }
    try {
      const spki = decodeBase64ToBytes(keyRec.spkiBase64);
      const spkiBuf = spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength) as ArrayBuffer;
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        spkiBuf,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      const sigBytes = decodeBase64ToBytes(envelope.signatureBase64);
      const sigBuf = sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer;
      const payloadBytes = canonicalJsonBytes(envelope.manifest);
      const payloadBuf = payloadBytes.buffer.slice(payloadBytes.byteOffset, payloadBytes.byteOffset + payloadBytes.byteLength) as ArrayBuffer;
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        sigBuf,
        payloadBuf,
      );
      if (!valid) {
        return { ok: false, reason: 'INVALID_MANIFEST_SIGNATURE', manifestSha256: computedManifestSha };
      }
    } catch {
      return { ok: false, reason: 'MANIFEST_SIGNATURE_VERIFICATION_ERROR', manifestSha256: computedManifestSha };
    }
  }

  return { ok: true, reason: null, manifestSha256: computedManifestSha };
}

export function createEmptyRegistry(nowUtc = new Date().toISOString()): InstalledRegionRegistry {
  return decodeInstalledRegionRegistry({
    schemaVersion: 1,
    revision: 0,
    regions: [],
    versions: [],
    stagedPackages: [],
    references: [],
    activeJournal: null,
    lastRecoveredOperationId: null,
    updatedAtUtc: nowUtc,
  });
}

export function makeVersionKey(regionId: string, version: string, packageVersion: number): string {
  return `${regionId}--${version}--p${packageVersion}`;
}
