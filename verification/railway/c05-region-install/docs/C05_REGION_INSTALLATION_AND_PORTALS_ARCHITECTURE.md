# C05 — Offline Region Installation, Atomic Storage, Rollback & Verified Region Portals Architecture

- **Execution Task:** C05 (Original Task R19 / Master Requirement MR-008)
- **Coordinator Checkpoint Basis:** `e373e5548ed988788655ae0f0b17891f16543022`
- **Mode:** Production-first synthetic engineering preparation (`realPbfProcessed: false`, `releaseAllowed: false`)
- **Primary Source Modules:**
  - `src/rail/regions/contracts.ts`
  - `src/rail/regions/storage.ts`
  - `src/rail/regions/pmtiles-range-source.ts`
  - `src/rail/regions/portals.ts`
  - `src/rail/regions/installer.ts`
  - `src/rail/regions/index.ts`
  - `src/rail/map/pmtiles-adapter.ts` (extended cleanly for direct `PMTilesSourceLike` range adapters)

## 1. Storage Namespace Isolation & Concrete Backends

Region installation storage MUST remain strictly separate from Dexie company save storage (`railway-ceo-save-v1`) so upgrading, rolling back, cancelling, or corrupting map/region assets can never overwrite or wipe company gameplay state.

- **Web / PWA (`IndexedDbOpfsRegionBackend`):**
  - Dedicated IndexedDB database: `railway-ceo-regions-v1` (stores: `state`, `staging_blobs`, `committed_blobs`, `key_map`).
  - Browser OPFS directory: `railway-ceo-regions-v1/{staging,committed}` with zero-full-RAM `FileSystemFileHandle.getFile().slice(offset, offset + length)` bounded range reads. Falls back cleanly to chunk-sliced IndexedDB blobs only when OPFS is unavailable.
  - Exclusive coordination via Web Locks (`navigator.locks`) and live cross-tab synchronization via `BroadcastChannel('railway-ceo-regions-v1:events')`.
  - Quota preflight via `navigator.storage.estimate()` + `navigator.storage.persisted()`, explicitly distinguishing `KNOWN`, `UNKNOWN`, and `UNSUPPORTED` (never treating `UNKNOWN` as unlimited).
- **Android / Capacitor (`CapacitorFilesystemRegionBackend`):**
  - App-private storage under `Directory.Data` subpath `railway-ceo-regions-v1/{staging,committed,registry.json}`.
  - Committed assets partitioned into fixed 128 KiB binary chunks so PMTiles range reads touch only required byte ranges rather than buffering an entire `.pmtiles` archive inside WebView JS heap.
  - Explicitly records `physicalDeviceVerified: false` until verified on actual Android hardware in C08.

## 2. Package Verification, Security & Decompression Bomb Controls

1. **Trusted Authority Enforcement (`verifySignedRegionPackageEnvelope`):**
   - Rejects unpinned self-asserted manifests (`UNTRUSTED_UNPINNED_MANIFEST_AUTHORITY`), revoked/unknown keys, invalid ECDSA-P256-SHA256 signatures, and digest mismatches.
   - Enforces fail-closed scope gate: non-synthetic (`syntheticOnly: false`) packages are rejected (`REAL_DATA_INTAKE_BLOCKED_BY_COMPLIANCE_GATE`) unless explicit C01/R51 clearance sets `allowRealData: true`.
2. **Entry Path & Offline Style URL Safety:**
   - Asset `relativePath` values reject traversal (`..`), absolute paths, backslashes, URL schemes, colons, query/fragment delimiters, and encoded traversal sequences.
   - Style resource URLs and SoI boundary contracts validate through C04-FIX-01 (`isPermittedOfflineUrl`, `resolveOfflinePMTilesArchiveId`, `decodeBoundaryLayerContract`).
3. **Bounded Streaming Decompression (`boundedDecompressGzip`):**
   - Checks decompressed output byte counts on every Web Streams chunk and aborts immediately (`DecompressionBombError`) if output exceeds `min(entry.sizeBytes, manifest.maxSingleEntryBytes)`.

## 3. Transactional State Machine & Crash/Reload Recovery

States:
`DISCOVERED -> PREFLIGHT -> STAGING -> ASSET_VERIFICATION -> COMPATIBILITY_VERIFICATION -> READY_FOR_ACTIVATION -> ACTIVATED` (plus `FAILED`, `CANCELLED`, `RECOVERY_REQUIRED`).

1. **Staging & Double Verification:** Every asset is verified against compressed SHA-256 + byte length, safely decompressed, written to staging storage, re-read back from durable storage, and re-hashed against uncompressed SHA-256 before `COMPATIBILITY_VERIFICATION` validates `RailGraph`, `RegionManifest`, `TileBuildManifest`, canonical `graphSha256`, `PMTiles` v3 magic header, and `RegionPortalSet`.
2. **Journaled Atomic Activation:** `installJournal` writes `READY_FOR_ACTIVATION` with the target version snapshot prior to promoting staging blobs to immutable `ver_<versionKey>/<role>` keys, then performs a single monotonic CAS revision swap on `InstalledRegionRegistry`.
3. **Deterministic Idempotent Recovery (`recoverInstallations`):**
   - Interrupted before promotion or mid-promotion with incomplete target bytes -> wipes staging + partial target blobs and preserves the prior active version untouched (`ROLLED_BACK_INCOMPLETE_ACTIVATION` / `STAGING_CLEANED_PRIOR_ACTIVE_PRESERVED`).
   - Interrupted after full verified promotion or before clearing journal -> completes commit cleanly without losing data (`COMPLETED_INTERRUPTED_ACTIVATION`).
   - Repeated calls return `recovered: false, resolution: 'NONE'`.

## 4. Reference Pinning, Rollback & Explicit Verified Region Portals

- **Version Retention & Safe GC:** Active versions, retained rollback versions, active routes (`activeRoutes`), in-flight R33 train movements (`activeMovements`), and company saves (`pinnedSaveHeads`) pin immutable `versionKey` entries so `removeUnusedVersion` fails closed (`VERSION_PINNED_BY_ACTIVE_REFS`) until all references settle/unpin.
- **Explicit Region Portals (`resolvePortalBetweenGraphs`, `planCrossRegionPortalJourney`):**
  - Cross-region travel requires an explicit signed portal entry matching exact `regionAId`, `graphASha256`, `regionBId`, `graphBSha256`, attached endpoint stations/nodes, `allowedDirection`, intersecting `gaugesMm`, `electrification` + voltage/frequency, and `seamDistanceM <= maxSeamDistanceM`.
  - Missing destination regions return `UNAVAILABLE_DESTINATION_REGION`; zero geometric border edges are ever fabricated (`fabricatedEdgeCount: 0`).
