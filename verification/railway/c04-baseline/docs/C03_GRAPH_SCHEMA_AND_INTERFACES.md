# Railway CEO — C03 (R15) Graph Schema and Runtime Interfaces

Repository: `S2zxx0zxx/Railway-Ceo-` (PR `#2`, branch `feat/railway-manager-v5`)
Coordinator Checkpoint: `e2a4dd4315e91255c20a40426b2cd03595cf9d44`
Status: **C03 Engineering Preparation Complete on Synthetic Fixtures (Real PBF Extraction Gated on C01/C02)**

## 1. Architecture Overview

C03 extends existing accepted R06–R10 and R32–R33 railway modules cleanly without duplicating `RailGraph`, `RailCompatibility`, `findRoute`, or `createScheduler`:

- **Build-Time / Offline Compiler (`Python 3.13`):**
  - `c03_station_attachment.py` (`attach_stations`): Station nodes, station ways, `public_transport=stop_area` / `route` relations, multi-platform anchor merging, deterministic spatial candidate ranking (`max_attachment_distance_m`, `ambiguity_margin_m`), disconnected & conflicting-duplicate quarantine (never fabricating edges).
  - `c03_topology_builder.py` (`build_c03_topology_from_records`, `build_c03_topology_from_jsonl`, optional SQLite disk-backed staging): Shared-node-only directed multigraph compilation, parallel edge preservation, one-way support, circular non-degenerate loops, zero-length/missing-ref/duplicate quarantine, conservative compatibility normalization (unknown gauge/power/access preserved explicitly), explicit junction/switch & restriction `TurnRule` generation, weak + iterative Tarjan SCC component analysis, ECMA-262 float normalization for cross-language SHA-256 parity, and compact gzip serialization.
- **Runtime Modules (`TypeScript`, `src/rail/*`, erasable TS syntax compatible with both `tsc --strict` and Node `--experimental-strip-types`):**
  - `src/rail/topology/index.ts`: `canonicalizeGraphPack`, `computeCanonicalGraphSha256`, `verifyGraphPackSha256`, `serializeGraphPack`, `deserializeGraphPack`, `analyzeTopology`, `auditCompatibility`.
  - `src/rail/stations/index.ts`: `decodeStationAttachmentReport`, `rankStationCandidates`, `StationAttachmentRegistry`.
  - `src/rail/geometry/index.ts`: `geodesicDistanceM`, `bearingDeg`, `polylineCumulativeDistances`, `interpolateEdgePosition`, `buildRouteGeometryProfile`, `interpolateRoutePosition`, `sampleRouteGeometry`, `projectMovementInspection` (direct read-only projection from R33 `prepareMovement().inspect()`).
  - `src/rail/spatial/index.ts`: `RailSpatialIndex` (2D Quadtree bbox query engine), `douglasPeuckerSimplify`, `zoomSimplificationTolerance`, `simplifyEdgeForZoom`, `queryMapLibreFeatures` (MapLibre GeoJSON `FeatureCollection` builder), `verifyGraphTileCompatibility`.

## 2. Authoritative GraphPack & Sidecar Guarantees

1. **Connectivity Invariant:** Visual polyline intersections and coincident distinct OSM node coordinates never create edges or merge components; all edges connect strictly via explicit node IDs matching `RailGraph` R07.
2. **Station Quarantine Invariant:** Ambiguous, unresolved, conflicting-duplicate, or distant disconnected stations (`> maxAttachmentDistanceM`) are quarantined (`nonRoutable: true`) inside `StationAttachmentReport` and never injected into `GraphPack.stations`.
3. **Compatibility Strictness:** Missing OSM `gauge`, `electrified`, `voltage`, `frequency`, `maxspeed`, and `access` are stored as `null` / `'unknown'`. Realism mode rejects missing attributes via `RailCompatibility` (`DATA_MISSING`); only explicit `Easy` policy inferences may fill missing values with labeled `InferenceNotice` records.
4. **Rendering vs Routing Separation:** `RailSpatialIndex.queryMapLibreFeatures(bbox, zoom)` applies zoom-dependent Douglas-Peucker simplification while strictly keeping start/end node coordinates identical and leaving `RailGraph.edge(id).geometry` and `lengthM` immutable.
5. **Single Clock Integrity:** `src/rail/geometry/index.ts` reads `edgeDistanceM` / `distanceM` directly from `R32`/`R33` movement inspection snapshots via `projectMovementInspection`; no second simulation loop or clock exists.
