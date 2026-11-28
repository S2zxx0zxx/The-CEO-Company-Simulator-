# C07 Synthetic Route Comparison & Calibration Architecture (R17 / MR-006, MR-044)

## 1. Authority & Scope
- Reuses unmodified **Geofabrik OpenRailRouting** (`e5112194fde4cc8ec36e2b0093e250df89ef4845`, Apache-2.0) and verified C06 FIX-01 Java adapter `c06-strict-oracle.jar` (`34e81249ceb940008fc87545608549e34e3201bd33e251f4405f8eedca7091eb`).
- Preserves Railway CEO's single authoritative runtime routing engine (`RailGraph`, `RailCompatibility`, `findRoute`, `findRouteAlternatives`) without introducing any replacement routing engine.
- Operates strictly in **synthetic preparation mode** (`realPbfProcessed: false`, `realRouteComparisonsCompleted: 0`, `releaseAllowed: false`, `actualC08MobileAcceptanceClaimed: false`).

## 2. Dataset Migration & 137-Scenario Matrix
- Replaced the 10 identical-stop/identical-profile placeholder requests in `fixtures/c06_oracle/c07_synthetic_calibration_template.json` with `fixtures/c07_calibration/c07_synthetic_calibration_dataset.json` (`schemaVersion: 2`, `137` distinct scenarios, zero duplicate `semanticRequestId` entries).
- Added a companion synthetic corridor `fixtures/c07_calibration/c07_synthetic_corridor.osm.pbf` (`c07-corridor-v1` at `[13.06..13.45 N, 43.10..43.70 E]`, imported into `c07_oracle/cache_strict`) covering `1435mm` standard gauge, `750V`/`3000V`/`1500V` DC, `25kV` AC high-speed vs short mainline bypass (`objective=time` vs `distance`), unknown electrification, dual switch at `n:224`, and switchback reversal.
- Verified category breakdown:
  - **123** genuine route comparisons (`50` Category A positive + `44` Category B negative compatibility + `29` Category C topology & operational restrictions)
  - **14** strictly separated Category D identity/infrastructure/unsupported probes (`5` `STALE_IDENTITY`, `2` `INVALID_INPUT`, `2` `SEARCH_EXHAUSTION`, `1` `STRICT_PROFILE_UNSUPPORTED`, `4` `ORACLE_EXECUTION_ERROR`)
  - **0** known incompatible routes accepted across all 137 scenarios.

## 3. Surfaced Cross-Engine Discrepancies (Open, Explicitly Dispositioned)
All five genuine cross-engine discrepancies revealed by live execution are retained openly in `C07_DISCREPANCY_REGISTRY.json`:
1. **`ORACLE_FALSE_REJECT` (2 cases — `c07_a017`, `c07_a018`):** C06 synthetic OSM defines `frequency="16.7"` (encoded `167` deci-Hz in Java `StrictFreqParser`), whereas Railway CEO domain integer `hertz(17)` checks `170` dHz in Java.
2. **`DURATION_DISCREPANCY` (2 cases — `c07_a044`, `c07_a050`):** `findRoute` lawfully remains in `diesel` across electrified track when `diesel` yields zero mode-switch penalty (`629s`/`922s`), whereas C06 adapter `inferOp` assumed electric mode on electrified track and added switch penalty (`+120s`/`+90s` -> `748s`/`1011s`).
3. **`DURATION_DISCREPANCY` (1 case — `c07_c022`):** Multi-stop reversal at intermediate stop `st:104` charges `+300s` turn penalty in Railway CEO (`1215s`), whereas GraphHopper multi-stop point-to-point routing resets leg turn costs (`913s`).

## 4. Provisional Tolerances & Real-Data Readiness
- Retained C06 provisional thresholds (`50 m / 1%`, `5 s / 2%`, `250 m` endpoint snap, `300 ms` target p95) with `approvedProductionToleranceLocked: false`.
- Added C01-gated real-data intake schema (`fixtures/c07_calibration/c07_real_data_readiness_schema.json`) planning `105` curated routes (`40` positive, `35` negative compat, `15` topology/turn, `15` multi-stop/alt) with `realRouteComparisonsCompleted: 0`.
