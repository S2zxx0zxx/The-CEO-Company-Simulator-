# C06-FIX-01 Strict Offline Routing Oracle Architecture (R16 / MR-005)

## 1. Purpose and Scope
This document specifies the C06 synthetic offline routing oracle harness connecting Railway CEO (`findRoute` / `findRouteAlternatives`, R07–R10) with an isolated, pinned offline Java subprocess wrapping **Geofabrik OpenRailRouting** (`commit e5112194fde4cc8ec36e2b0093e250df89ef4845`, Apache-2.0, GraphHopper `11.1-osm-reader-callbacks-1`).

- **Mode:** Production-first synthetic preparation (`realPbfProcessed: false`, `releaseAllowed: false`).
- **Real data boundary:** No Indian `eastern-zone-261101.osm.pbf` data is processed by C06. All C06 synthetic network corridors reside in `[12.00..12.46 N, 42.08..42.62 E]`.
- **Upstream preservation:** The pinned OpenRailRouting checkout (`c04_c06_tools/openrailrouting`) is unmodified; all strict C06 parsers and runner logic live separately in `c06_oracle/java/src/com/railwayceo/c06/`.

## 2. Java Strict Adapter, Loaded Cache Identity & IPC Correlation (`StrictEnums`, `StrictParsers`, `StrictOracleRunner`)
- `StrictEnums` / `StrictParsers` record tri-state / exact encoded values alongside upstream values (`strict_access`, `strict_active`, `strict_gauge_state`, `strict_gauge_mm`, `strict_electrified_state`, `strict_voltage_known`, `strict_voltage_v`, `strict_freq_state`, `strict_freq_dhz`, `strict_maxspeed_known`, `strict_maxspeed_kmh`, `strict_oneway_dir`).
- `StrictOracleRunner` redirects `System.out` to `System.err` at startup before GraphHopper initialization so GraphHopper/SLF4J logs never corrupt JSON-lines stdio IPC (`query-stdio`) or `query-once` output.
- **Loaded Cache Identity Binding:** `StrictOracleRunner import --graph-sha256 <sha>` computes the PBF SHA-256 and writes `c06_cache_identity.json` inside `cache_strict`. At startup (`query-stdio` / `query-once`), `StrictOracleRunner` verifies `c06_cache_identity.json` against loaded `BaseGraph` node/edge dimensions, emits `loadedGraphSha256` / `loadedPbfSha256` in the `ready` banner, and rejects mismatched `expectedGraphSha256` / `actualGraphSha256` directly inside Java (`STALE_GRAPH: CACHE_GRAPH_SHA256_MISMATCH`).
- **IPC Correlation:** Every request carries `requestId` + unique `correlationNonce`, echoed by Java and verified on receipt in `StrictOracleClient` (failing closed with `ORACLE_EXECUTION_ERROR: IPC_CORRELATION_MISMATCH` on mismatch).
- Inter-stop U-turn reversals across multi-stop waypoints are detected from consecutive edge keys and rejected when `allowReversal=false` (`UNAUTHORIZED_REVERSAL_AT_STOP`).

## 3. Hardened TypeScript Validator, Comparison Taxonomy & Portal Composition
- `src/rail/c06-oracle/contracts.ts`: Pinned OpenRailRouting identity, provisional comparison tolerances, 18-rule compatibility mapping matrix, extended outcome taxonomy (`STALE_IDENTITY`, `INVALID_INPUT`, `SEARCH_EXHAUSTION`, `STRICT_PROFILE_UNSUPPORTED`, `ORACLE_EXECUTION_ERROR`, `INDETERMINATE`, plus genuine match/rejection classes), and C07 schema validator.
- `src/rail/c06-oracle/validator.ts` (**FIX-01-A & FIX-01-B**):
  - Shared `verifyOrderedStopAnchoring()` validates origin anchor, strict monotonic intermediate stop progression, destination anchor, and snapped-waypoint distance binding against actual traversed edge nodes.
  - Shared `validateOperatingModeCompliance()` enforces train traction (`electric` vs `diesel` vs `steam` vs `dual`), operating gauge, initialOperating compatibility, electrical parameters, and non-electric null voltage/frequency invariants without permissive inference.
  - `validateOracleResponseIndependently()` also verifies GraphHopper `adjNode -> baseNode` continuity and edge length agreement against ground truth.
- `src/rail/c06-oracle/harness.ts` (**FIX-01-C & Honest Portal Labeling**):
  - Outcome taxonomy strictly separates genuine route matches/rejections from `STALE_IDENTITY`, `INVALID_INPUT`, `SEARCH_EXHAUSTION`, `STRICT_PROFILE_UNSUPPORTED`, `ORACLE_EXECUTION_ERROR`, and `INDETERMINATE`.
  - `evaluateCrossRegionOracleJourney()` is explicitly labeled `verificationScope: "GAME_ENGINE_PORTAL_COMPOSITION_ONLY"` with `independentJavaSegmentVerificationExecuted: false` and `nativeMultiRegionOracleSupported: false`.
