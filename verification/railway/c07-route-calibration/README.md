# Railway CEO — C07 (R17 / MR-006, MR-044) Route Comparison & Calibration Framework

Repository: `S2zxx0zxx/Railway-Ceo-` (`PR #2`, branch `feat/railway-manager-v5`)
Coordinator Checkpoint Basis: `00088cd6b1416adfc6822f4896813ef24e15d49b`
Pinned OpenRailRouting Upstream: `https://github.com/geofabrik/OpenRailRouting` @ `e5112194fde4cc8ec36e2b0093e250df89ef4845` (Apache-2.0)
Reused Verified C06 Adapter JAR: `c06_oracle/java/c06-strict-oracle.jar` (`34e81249ceb940008fc87545608549e34e3201bd33e251f4405f8eedca7091eb`)

---

## Reproducing C07 Build, Cache Import & Verification

### 1. External Prerequisites
- **Java JDK 21** (`JAVA_HOME`) & **Apache Maven 3.9.9** (`-o` offline)
- **Node.js `v24.10.0`** (`--experimental-transform-types`)
- **Python 3.13.0** + **Osmium 1.19.0** (`OSMIUM_EXE`)

### 2. Rebuilding Supplementary C07 Corridor & Importing Cache
*(Preserves existing C06 fixture, `c06-strict-oracle.jar`, and `c06_oracle/cache_strict` untouched.)*
```powershell
python -I c07_fixture_builder.py
node --experimental-transform-types c07_dataset_generator.mjs
```

### 3. Executing C07 Suite, Strict TypeScript Check & All Regressions
```powershell
# C07 Calibration Suite (137 scenarios across 2 live Java caches, cross-region portals, 14 negative tests)
node --experimental-transform-types test_c07_calibration.mjs

# Strict TypeScript check on C06/C07 modules (0 errors in src/rail/c06-oracle/* and src/rail/c07-calibration/*; 2 pre-existing errors preserved in pmtiles-adapter.ts & portals.ts)
node <path-to-typescript-bin>/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --allowImportingTsExtensions --typeRoots <path-to-types> --types node src/rail/c06-oracle/contracts.ts src/rail/c06-oracle/validator.ts src/rail/c06-oracle/client.ts src/rail/c06-oracle/harness.ts src/rail/c07-calibration/contracts.ts src/rail/c07-calibration/discrepancy-registry.ts src/rail/c07-calibration/calibration.ts src/rail/c07-calibration/batch-runner.ts src/rail/c07-calibration/cross-region.ts src/rail/c07-calibration/index.ts

# Preserved upstream & C02-C06 regressions (444/444 executed checks passing)
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

## Compliance & Production Boundaries
- `realPbfProcessed`: `false`
- `realRouteComparisonsCompleted`: `0`
- `releaseAllowed`: `false`
- `actualC08MobileAcceptanceClaimed`: `false`
- `c07_05` cross-region checks preserve `GAME_ENGINE_PORTAL_COMPOSITION_ONLY` (`independentJavaSegmentVerificationExecuted: false`).
- Open blockers: C01 DST/SoI/R51 clearance for mandatory R17 real-geography 100+ routes, Windows 500-node p95 (`447.83 ms` latest / `495.84 ms` historical > `300 ms`), WebGL FPS < 30 on SwiftShader, physical Android C08 benchmarks, and locked production tolerances.
