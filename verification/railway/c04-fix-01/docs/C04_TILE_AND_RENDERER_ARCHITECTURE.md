# Railway CEO — C04 (R18) Offline Map Tiles, Renderer & Manifest Architecture

Repository: `S2zxx0zxx/Railway-Ceo-` (PR `#2`, branch `feat/railway-manager-v5`)
Coordinator Checkpoint: `b2e9ba6385fd5b8635176ef5cfe91a3421b3c70a`
Status: **C04 Synthetic Pipeline, Pinned MapLibre v6.18.0 + PMTiles v4.5.0 WebGL Rendering Complete (Production Real-Data Tiles Gated on C01/C03)**

## 1. Pinned Stack (R03_SOURCE_LOCK.json)

| Resource ID | Tool / Package | Pinned Version / Commit | License | Role |
| --- | --- | --- | --- | --- |
| B05 | `maplibre-gl` | `6.18.0` | `BSD-3-Clause` | Offline WebGL map renderer |
| B06 | Planetiler | `v0.10.2` (`planetiler.jar`) | `Apache-2.0` | Build-time OSM PBF -> MVT PMTiles compiler |
| B07 | `pmtiles` | `4.5.0` (`aec8fa13...`, dep `fflate@0.8.3` MIT) | `BSD-3-Clause` / `CC0` | Range-capable offline PMTiles v3 archive protocol |
| FONT-01 | `@fontsource/inter` | `5.1.1` | `OFL-1.1` | Local SDF fontstack (`Inter Regular`, `Inter SemiBold`) |
| SPR-01 | Original geometric PNG atlas | `railway-sprites` (`1x`, `2x`) | `Original Project Asset` | Station, yard, direction arrow, junction & rotated train markers |

## 2. Offline Vector Tile Pipeline (`c04_tile_pipeline/`)

- **Schema:** `c04_tile_pipeline/railway_basemap_schema.yml` uses Planetiler `generate-custom` (`local_path`, zero internet downloads, `--exclude_layers=boundary`, `minzoom=0`, `maxzoom=14`).
- **Layers Emitted:** `landuse`, `water`, `waterway`, `transportation` (roads + civilian `railway`), `place` (city/town/village), and `poi_rail`. Restricted `military` and OSM `boundary` features are excluded fail-closed.
- **Manifest Binding:** `c04_tile_builder.py` wires the computed `pmtilesSha256` directly into `RegionManifest.tilesSha256` and `C04TileManifest`, rejecting placeholder all-zero tile digests (`verifyGraphTilesBundleMatch`).

## 3. MapLibre Renderer & Layer Stack (`src/rail/map/`)

1. **`contracts.ts`**: Decoders `decodeC04TileManifest` and `decodeBoundaryLayerContract` (Survey of India boundary layer strictly requires `assetAcquired === true`, non-zero SHA-256, and verified license before `approvedForPoliticalView` can be true).
2. **`style.ts`**: `buildOfflineMapStyle` produces MapLibre v8 JSON integrating basemap vector layers plus all 11 C03 railway/simulation overlay layers (`c03-civilian-rail-*`, `c03-route-preview-line`, `c03-company-routes-*`, `c03-route-selected-*`, `c03-junction-markers`, `c03-company-yards`, `c03-station-*`, `c03-trains-markers`, `c03-train-selected`, `c03-interaction-feedback`) plus `validateOfflineStyleNoExternalUrls`.
3. **`pmtiles-adapter.ts`**: `MemoryPMTilesSource` + `registerOfflineProtocols` binds `pmtiles://` and `offlinefont://` (with valid empty fallback PBF for unpopulated Unicode ranges).
4. **`renderer.ts`**: `RailwayMapRenderer` wraps MapLibre GL JS with graceful `detectWebGLSupport()`, portrait/touch viewport support, viewport-culled zoom simplification via C03 `RailSpatialIndex`, single-clock R33 train projection via `projectMovementInspection` + `interpolateRoutePosition` visual smoothing, selection/follow camera APIs, WebGL context-lost listeners, and clean `dispose()`.
