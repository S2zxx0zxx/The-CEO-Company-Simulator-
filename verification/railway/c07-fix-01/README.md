# Railway CEO — C07 FIX-01 (R17 / MR-006, MR-044) Comparison Evidence Integrity

Repository: `S2zxx0zxx/Railway-Ceo-` (`PR #2`, branch `feat/railway-manager-v5`)
Coordinator Checkpoint Basis: `36c2128d6ea1a86cfebcc94d9886fbf535773354`
Pinned OpenRailRouting Upstream: `https://github.com/geofabrik/OpenRailRouting` @ `e5112194fde4cc8ec36e2b0093e250df89ef4845` (Apache-2.0)
Bundled Verified C06 Adapter JAR: `c06_oracle/java/c06-strict-oracle.jar` (`34e81249ceb940008fc87545608549e34e3201bd33e251f4405f8eedca7091eb`)

---

## Clean-Extraction Verification Scope (`RAILWAY_CEO_C07_FIX_01_VERIFICATION.zip`)

### 1. Bundled Standalone Contents Inside the ZIP
The single-ZIP deliverable includes all source modules (`src/`), upstream test suites (`tests/`), renderer assets (`assets/fonts/`, `assets/sprites/`, `assets/licenses/`), synthetic C02–C07 fixtures (`fixtures/`), C06 strict adapter JAR & Java sources (`c06_oracle/java/`), C06/C07 strict oracle cache identities & outputs, Python/Node verification scripts (`c02_*`, `c03_*`, `c04_*`, `c05_*`, `c06_*`, `c07_*`, `_run_upstream_cases.mjs`, `verify_downstream_graphpack.mjs`), documentation (`docs/` + `docs/railway/`), `SNAPSHOT_MANIFEST.json`, and `MANIFEST.sha256`.

From a freshly extracted ZIP directory (requiring only **Node.js `v24.10.0`** with `--experimental-transform-types` and **Python `3.13.0`**):
```powershell
python -I -B test_c03_topology_and_stations.py
python -I -B test_c02_prefilter_synthetic.py
node --experimental-transform-types test_c03_runtime_ts.mjs
node --experimental-transform-types _run_upstream_cases.mjs
node --experimental-transform-types verify_downstream_graphpack.mjs fixtures/c04_synthetic_graph_bundle.json
node --experimental-transform-types test_c04_contracts_and_tiles.mjs
node --experimental-transform-types test_c05_packages_install_and_portals.mjs
```

### 2. External Prerequisites (Not Bundled in Standalone ZIP)
Full live Java oracle calibration, C02 Osmium PBF pipeline, Maven compilation/tests, and browser WebGL tests require the following host prerequisites:

| Prerequisite | Version / Pin | Acquisition / Build Command | SHA-256 Lock |
|---|---|---|---|
| **Java JDK** | OpenJDK `21.0.8` | Install JDK 21 and set `JAVA_HOME` | Host JDK (`java -version`) |
| **Apache Maven** | `3.9.9` (`apache-maven-3.9.9-bin.zip`) + `$USERPROFILE/.m2/repository` | Apache 3.9.9 binary distribution + offline M2 repo | `4ec3f26fb1a692473aea0235c300bd20f0f9fe741947c82c1234cefd76ac3a3c` |
| **OpenRailRouting Thin JAR** | `railway_routing-1.2-thin.jar` | `mvn -f c04_c06_tools\openrailrouting\pom.xml -o package` | `1caebe94d5678cbff85d83f09c099e5f585d61c10234ff7f4114c1422f2de400` |
| **Java Runtime Classpath** | `c04_c06_tools/openrailrouting/target/runtime-classpath.txt` | `mvn -f c04_c06_tools\openrailrouting\pom.xml -o dependency:build-classpath -Dmdep.outputFile=target\runtime-classpath.txt` | `9adb31046779351bc26005039cc53f864e9c5a0ead71e48ec5676b83d2be3a75` |
| **Maven Dependency Lock** | `c04_c06_tools/openrailrouting_maven_dependencies.txt` | Resolved offline from `.m2/repository` | `091ded608cae513dd1357a121eb2851903275cdfcf420b16628b2286be7a47a8` |
| **Planetiler** (C04 tile rebuilds) | `v0.10.2` (`planetiler.jar`) | Upstream release `v0.10.2` | `f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d` |
| **Osmium Tool** | `1.19.0` (`libosmium 2.23.1`) | Conda `osmium-tool=1.19.0` (`OSMIUM_EXE`) | `6fb24c9f0859592d613c06628e19f00b7d081818d13183c25ef5274fcc77083b` |
| **Node.js Runtime** | `v24.10.0` (`--experimental-transform-types`) | Node.js `24.10.0` | Native TS execution (`tsc` not installed in standalone workspace; repo `package.json` specifies `typescript@^5.8.3`) |
| **npm Renderer / Browser Packages** | `maplibre-gl@6.18.0`, `pmtiles@4.5.0`, `fflate@0.8.3`, `@fontsource/inter@5.1.1`, `playwright@1.51.1` | Required only for `test_c04_browser_webgl.mjs` / `test_c05_browser_persistence.mjs` / `tsc` | Recorded in `DEPENDENCY_AND_TOOL_MANIFEST.json` |

---

## Reproducing Live C07 FIX-01 & All Regressions
```powershell
# 1. Regenerate dataset & validate raw fixture provenance
node --experimental-transform-types c07_dataset_generator.mjs

# 2. C07 Calibration + FIX-01 Regressions (8/8 groups, 137 scenarios, live Java 21)
node --experimental-transform-types test_c07_calibration.mjs

# 3. Preserved C02-C06 + Maven Offline Regressions
mvn -f c04_c06_tools\openrailrouting\pom.xml -o test
node --experimental-transform-types test_c06_strict_oracle.mjs
node --experimental-transform-types test_c05_packages_install_and_portals.mjs
node --experimental-transform-types test_c04_contracts_and_tiles.mjs
node --experimental-transform-types test_c03_runtime_ts.mjs
node --experimental-transform-types _run_upstream_cases.mjs
node --experimental-transform-types verify_downstream_graphpack.mjs fixtures/c04_synthetic_graph_bundle.json
python -I -B test_c03_topology_and_stations.py
python -I -B test_c02_prefilter_synthetic.py
OSMIUM_EXE=<path-to-osmium> python -I -B test_c02_pipeline_synthetic.py
```

Note on TypeScript compiler (`tsc`): `tsc` is not installed locally in the standalone execution workspace (`C:\RailwayCEO-Git` declares `"typescript": "^5.8.3"` in `package.json` without `node_modules` installed here), so all TypeScript sources are executed directly via Node.js `v24.10.0 --experimental-transform-types`.

## Compliance & Production Boundaries
- `realPbfProcessed`: `false`
- `realRouteComparisonsCompleted`: `0`
- `releaseAllowed`: `false`
- `actualC08MobileAcceptanceClaimed`: `false`
- Retained open calibration discrepancies (`OPEN_NON_BLOCKING`): `c07_a017`, `c07_a018` (`ORACLE_FALSE_REJECT` 16.7Hz dHz quantization) and `c07_a044`, `c07_a050`, `c07_c022` (`DURATION_DISCREPANCY`).
- `c07_05` preserves `GAME_ENGINE_PORTAL_COMPOSITION_ONLY` (`independentJavaSegmentVerificationExecuted: false`).
