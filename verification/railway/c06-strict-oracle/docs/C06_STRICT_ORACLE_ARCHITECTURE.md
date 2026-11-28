# C06 Strict Offline Routing Oracle Architecture (R16 / MR-005)

## 1. Purpose and Scope
This document specifies the C06 synthetic offline routing oracle harness connecting Railway CEO (`findRoute` / `findRouteAlternatives`, R07–R10) with an isolated, pinned offline Java subprocess wrapping **Geofabrik OpenRailRouting** (`commit e5112194fde4cc8ec36e2b0093e250df89ef4845`, Apache-2.0, GraphHopper `11.1-osm-reader-callbacks-1`).

- **Mode:** Production-first synthetic preparation (`realPbfProcessed: false`, `releaseAllowed: false`).
- **Real data boundary:** No Indian `eastern-zone-261101.osm.pbf` data is processed by C06. All C06 synthetic network corridors reside in `[12.00..12.46 N, 42.08..42.62 E]`.
- **Upstream preservation:** The pinned OpenRailRouting checkout (`c04_c06_tools/openrailrouting`) is unmodified; all strict C06 parsers and runner logic live separately in `c06_oracle/java/src/com/railwayceo/c06/`.

## 2. Java Strict Adapter (`StrictEnums`, `StrictParsers`, `StrictOracleRunner`)
Upstream OpenRailRouting is permissive on missing tags and quantized on decimals (`Frequency` defaults missing to `0.0` matching DC, `RailAccess` ignores `access=private`, `Electrified` allows `UNSET`, `RailwayMaxSpeed` is optional, `railway:active=no` is imported). To enforce strict Realism semantics without inventing metadata or modifying upstream sources:

- `StrictEnums` / `StrictParsers` record tri-state / exact encoded values alongside upstream values:
  - `strict_access` (`ALLOWED | RESTRICTED | UNKNOWN`)
  - `strict_active` (`boolean` from `railway:active`)
  - `strict_gauge_state` (`KNOWN | MISSING | INVALID`) + exact `strict_gauge_mm`
  - `strict_electrified_state` (`YES | NO | UNKNOWN`)
  - `strict_voltage_known` + exact 1 V `strict_voltage_v`
  - `strict_freq_state` (`KNOWN_DC | KNOWN_AC | MISSING | INVALID`) + exact 0.1 Hz `strict_freq_dhz`
  - `strict_maxspeed_known` + exact `strict_maxspeed_kmh`
  - `strict_oneway_dir` (directional permission from `oneway` / `railway:preferred_direction`)
- `StrictOracleRunner` redirects `System.out` to `System.err` at startup before GraphHopper initialization so GraphHopper/SLF4J logs never corrupt JSON-lines stdio IPC (`query-stdio`) or `query-once` output.
- Inter-stop U-turn reversals across multi-stop waypoints (where GraphHopper resets heading between stops) are detected from consecutive edge keys and rejected when `allowReversal=false` (`UNAUTHORIZED_REVERSAL_AT_STOP`).
- `SwitchTurnCostTask` enforces railway switch geometry (`angleDiff` within `[0.75*pi, 1.25*pi]`, +/-45 deg from straight continuation).

## 3. TypeScript Harness, Preflight, Safety Validator & C05 Portal Composition
- `src/rail/c06-oracle/contracts.ts`: Pinned OpenRailRouting identity, provisional comparison tolerances (`distanceMaxDeltaM: 50`, `distanceMaxRelDelta: 0.01`, `durationMaxDeltaS: 5`, `durationMaxRelDelta: 0.02`, `endpointSnapMaxM: 250`, `runtimeRoutingP95TargetMs: 300`), 18-rule compatibility mapping matrix, and C07 dataset schema validator (`validateC07DatasetSchema`).
- `src/rail/c06-oracle/client.ts`: Subprocess stdio/CLI client with Realism-only preflight gate (rejects Easy mode / non-empty inferences before spawning or querying), canonical SHA-256 identity checks (`STALE_GRAPH`, `STALE_PROFILE`, `STALE_POLICY`), bounded queue, timeout `SIGKILL` recovery (guarded against late exit events from killed processes), and JSON-line filtering.
- `src/rail/c06-oracle/validator.ts`: Independent Path Safety Validator (`validateGameRouteIndependently` and `validateOracleResponseIndependently`) operating directly against raw OSM ground-truth constraints (discontinuity, endpoint snapping, gauge, voltage/frequency, missing critical tags, restricted access, inactive track, oneway direction, forbidden turns, reversals, range limits, and authorized dual-mode switch sites + dwell penalties).
- `src/rail/c06-oracle/harness.ts`: Executes paired queries (`findRoute` vs `StrictOracleRunner`), enforces dual switch-site rules + authorized mode-change dwell penalties (`modeChangePenaltyS`), classifies outcomes into 14 discrepancy classes (`MATCH_VALID_ROUTE`, `MATCH_NO_VALID_ROUTE`, etc.), and provides `evaluateCrossRegionOracleJourney` composed cleanly on C05 FIX-02 `planCrossRegionPortalJourney` with zero fabricated border edges.

## 4. C02 Metadata Audit & C07 Calibration Readiness
- `c06_fixture_builder.py` verifies `CivilianRailPrefilter` (`c02_rail_prefilter.py`) strips discarded keys (`access`, `maxspeed`, `railway:active`, etc.) cleanly and outputs `fixtures/c06_oracle/c06_c02_metadata_audit.json` (`discardedKeysStillPresentAfterC02: []`).
- `test_c06_strict_oracle.mjs` emits schema-validated synthetic calibration template `fixtures/c06_oracle/c07_synthetic_calibration_template.json` (`realDataUsed: false`, `c01ComplianceCleared: false`, `syntheticOnly: true`, `minimumRequiredRealCasesForC07: 100`).
