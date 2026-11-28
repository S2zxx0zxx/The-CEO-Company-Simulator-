# Railway CEO — C06-FIX-01 (R16 / MR-005) Strict Offline Routing Oracle Verification Bundle

Repository: `S2zxx0zxx/Railway-Ceo-` (PR `#2`, branch `feat/railway-manager-v5`)
Coordinator Checkpoint Basis: `3245216aee348c292257625fbefd3cb049611982`
Pinned OpenRailRouting Upstream: `https://github.com/geofabrik/OpenRailRouting` @ `e5112194fde4cc8ec36e2b0093e250df89ef4845` (Apache-2.0, license blob `5471dc10377b76db85a2feca7a99a7eef4980ba8`, GraphHopper `11.1-osm-reader-callbacks-1`)

---

## Reproducible C06 Build, Import, Classpath & Test Commands

### 1. External Toolchain Prerequisites (Not Bundled Inside This Archive)
- **Java JDK 21** (tested with JetBrains Runtime `21.0.8` via Android Studio `jbr`; set `JAVA_HOME`)
- **Apache Maven `3.9.9`** (used strictly offline `-o` against populated local Maven repo)
- **Node.js `v24.10.0`** (with `--experimental-transform-types`)
- **Python `3.13.0`** + `osmium-tool 1.19.0` (only needed to regenerate PBF fixtures or full C02 pipeline)
- **OpenRailRouting Pinned Source Checkout** (`commit e5112194fde4cc8ec36e2b0093e250df89ef4845`) at `c04_c06_tools/openrailrouting`

### 2. Rebuilding Pinned OpenRailRouting Thin JAR & Runtime Classpath
From the pinned OpenRailRouting checkout (`c04_c06_tools/openrailrouting`):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:PATH = "$env:JAVA_HOME\bin;<path-to-maven-3.9.9>\bin;$env:PATH"

# Verify pinned OpenRailRouting unit & integration suite offline (34 tests)
mvn -o test

# Compile and build thin JAR + offline runtime classpath
mvn -o compile dependency:build-classpath "-Dmdep.outputFile=target/runtime-classpath.txt"
jar --create --file target/railway_routing-1.2-thin.jar -C target/classes .
```

### 3. Recompiling `c06-strict-oracle.jar`
From the root of the extracted workspace:

```powershell
$runtimeCp = (Get-Content "c04_c06_tools\openrailrouting\target\runtime-classpath.txt").Trim()
$cpBuild = "c04_c06_tools\openrailrouting\target\railway_routing-1.2-thin.jar;$runtimeCp"

New-Item -ItemType Directory -Force c06_oracle\java\classes | Out-Null
javac -encoding UTF-8 -cp $cpBuild -d c06_oracle\java\classes c06_oracle\java\src\com\railwayceo\c06\*.java
jar cf c06_oracle\java\c06-strict-oracle.jar -C c06_oracle\java\classes .
```

### 4. Importing Synthetic PBF & Binding Cache Graph Identity (`c06_cache_identity.json`)
```powershell
$graphV1Sha = (Get-Content "fixtures/c06_oracle/c06_graph_v1.json" | ConvertFrom-Json).graphSha256
$cpRun = "c06_oracle\java\c06-strict-oracle.jar;$cpBuild"

java -Xmx256m -cp $cpRun com.railwayceo.c06.StrictOracleRunner import `
  --pbf fixtures/c06_oracle/c06_synthetic_network.osm.pbf `
  --graph-sha256 $graphV1Sha `
  --strict-cache c06_oracle/cache_strict `
  --upstream-cache c06_oracle/cache_upstream `
  --out c06_oracle/import_metrics.json
```
*(This writes `c06_oracle/cache_strict/c06_cache_identity.json` binding `graphSha256`, `pbfSha256`, `graphNodes`, and `graphEdges` verified at startup by `query-stdio` / `query-once`.)*

### 5. Running C06, Strict TypeScript Check & Preserved Regression Suites
```powershell
# C06 Strict Oracle Suite (8 test groups, 27 paired comparison scenarios, 9 FIX-01 negative probes + 2 controls)
node --experimental-transform-types test_c06_strict_oracle.mjs

# Strict TypeScript typechecking (tsc 5.9.3 with @types/node; 0 errors in src/rail/c06-oracle/*.ts; 2 pre-existing errors in preserved untouched C04/C05 files)
node <path-to-typescript-bin>/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --allowImportingTsExtensions --typeRoots <path-to-types> --types node src/rail/c06-oracle/contracts.ts src/rail/c06-oracle/validator.ts src/rail/c06-oracle/client.ts src/rail/c06-oracle/harness.ts

# Preserved & downstream regressions (437 total executed incl. 34/34 OpenRailRouting mvn -o test)
node --experimental-transform-types test_c05_packages_install_and_portals.mjs
node --experimental-transform-types test_c04_contracts_and_tiles.mjs
node --experimental-transform-types test_c03_runtime_ts.mjs
node --experimental-transform-types _run_upstream_cases.mjs
node --experimental-transform-types verify_downstream_graphpack.mjs fixtures/c04_synthetic_graph_bundle.json
python -I -B test_c03_topology_and_stations.py
python -I -B test_c02_prefilter_synthetic.py
OSMIUM_EXE=<path-to-osmium> python -I -B test_c02_pipeline_synthetic.py
```

---

## Dependency Locks, Build Artifacts & License Evidence

Exact pinned dependency manifests bundled or referenced in this deliverable:
- `DEPENDENCY_AND_TOOL_MANIFEST.json` — SHA-256 digests, versions, and SPDX licenses for OpenRailRouting, GraphHopper, Maven `3.9.9`, Osmium `1.19.0`, Planetiler `v0.10.2`, `maplibre-gl@6.18.0` (`BSD-3-Clause`), `pmtiles@4.5.0` (`BSD-3-Clause`), `fflate@0.8.3` (`MIT`), `@fontsource/inter@5.1.1` (`OFL-1.1`), `playwright@1.51.1` (`Apache-2.0`).
- `C06_DEPENDENCY_EVIDENCE.json` — exact SHA-256 checksums and byte sizes for `c06-strict-oracle.jar`, `railway_routing-1.2-thin.jar`, `runtime-classpath.txt`, `openrailrouting_maven_dependencies.txt`, `LICENSE.txt` (`Apache-2.0`), and renderer licenses under `assets/licenses/`.
- `osmium-tool` (`GPL-3.0`): invoked strictly out-of-process as a standalone CLI via `OSMIUM_EXE` for synthetic `.osm.pbf` smoke tests; zero GPL code is linked into TypeScript/Java/PWA runtime modules.

## Compliance & Production Boundaries
- `realPbfProcessed`: `false` (no real PBF processed or shipped)
- `releaseAllowed`: `false`
- `actualC08MobileAcceptanceClaimed`: `false`
- `c06_06` cross-region helper is **game-engine portal composition** (`verificationScope: "GAME_ENGINE_PORTAL_COMPOSITION_ONLY"`, `independentJavaSegmentVerificationExecuted: false`), not independent Java multi-region routing.
- Retained open gates: C01 DST/SoI/R51 compliance, real-geography C07 calibration, Windows dense 500-node routing `routeP95Ms > 300 ms` (`496.31 ms`), SwiftShader software WebGL FPS `< 30`, and physical Android device verification.
