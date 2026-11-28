import { decodeRegionManifest, type Coord, type RegionManifest } from '../../domain/models';
import { RailGraph, type GraphEdge, type GraphStation } from '../graph';

/** Axis-aligned bounding box [minLon, minLat, maxLon, maxLat]. */
export type BBox = readonly [number, number, number, number];

export interface MapLibreEdgeFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly geometry: Readonly<{ type: 'LineString'; coordinates: readonly Coord[] }>;
  readonly properties: Readonly<{
    id: string;
    from: string;
    to: string;
    lengthM: number;
    electrification: GraphEdge['electrification'];
    access: GraphEdge['access'];
    active: boolean;
    gaugeMm: readonly number[] | null;
    maxSpeedKmh: number | null;
    authoritativePointCount: number;
    renderedPointCount: number;
  }>;
}

export interface MapLibreStationFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly geometry: Readonly<{ type: 'Point'; coordinates: Coord }>;
  readonly properties: Readonly<{
    id: string;
    name: string;
    regionId: string;
    anchorCount: number;
    nodeIds: readonly string[];
  }>;
}

export interface MapLibreViewportBundle {
  readonly graphSha256: string;
  readonly regionId: string;
  readonly zoom: number;
  readonly toleranceDeg: number;
  readonly edges: Readonly<{ type: 'FeatureCollection'; features: readonly MapLibreEdgeFeature[] }>;
  readonly stations: Readonly<{ type: 'FeatureCollection'; features: readonly MapLibreStationFeature[] }>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function edgeBBox(geometry: readonly Coord[]): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const pt of geometry) {
    if (pt[0] < minLon) minLon = pt[0];
    if (pt[1] < minLat) minLat = pt[1];
    if (pt[0] > maxLon) maxLon = pt[0];
    if (pt[1] > maxLat) maxLat = pt[1];
  }
  return [minLon, minLat, maxLon, maxLat] as const;
}

export function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function pointInBBox(pt: Coord, bbox: BBox): boolean {
  return pt[0] >= bbox[0] && pt[0] <= bbox[2] && pt[1] >= bbox[1] && pt[1] <= bbox[3];
}

function perpDistDeg(pt: Coord, start: Coord, end: Coord): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(pt[0] - start[0], pt[1] - start[1]);
  }
  const num = Math.abs(dy * pt[0] - dx * pt[1] + end[0] * start[1] - end[1] * start[0]);
  return num / Math.hypot(dx, dy);
}

/**
 * Iterative stack-safe Douglas-Peucker simplification for rendering geometry ONLY.
 * Strictly preserves exact first and last endpoints and never alters authoritative graph length/routing.
 */
export function douglasPeuckerSimplify(geometry: readonly Coord[], toleranceDeg: number): readonly Coord[] {
  if (geometry.length <= 2 || toleranceDeg <= 0) {
    return Object.freeze(geometry.map((p) => Object.freeze([p[0], p[1]] as const)));
  }
  const keep = new Uint8Array(geometry.length);
  keep[0] = 1;
  keep[geometry.length - 1] = 1;

  const stack: [number, number][] = [[0, geometry.length - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx - startIdx <= 1) continue;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
      const d = perpDistDeg(geometry[i], geometry[startIdx], geometry[endIdx]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceDeg && maxIdx > startIdx) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx], [maxIdx, endIdx]);
    }
  }

  const out: Coord[] = [];
  for (let i = 0; i < geometry.length; i++) {
    if (keep[i]) out.push(Object.freeze([geometry[i][0], geometry[i][1]] as const));
  }
  return Object.freeze(out);
}

/** Deterministic zoom-to-tolerance schedule (authoritative zoom >= 13 uses zero simplification). */
export function zoomSimplificationTolerance(zoom: number): number {
  if (!Number.isFinite(zoom)) throw new RangeError('zoom must be finite');
  if (zoom >= 13) return 0;
  if (zoom >= 10) return 0.0001;
  if (zoom >= 7) return 0.0005;
  if (zoom >= 4) return 0.002;
  return 0.01;
}

/** Compute simplified rendering coordinates without touching authoritative edge geometry or lengthM. */
export function simplifyEdgeForZoom(edge: GraphEdge, zoom: number): readonly Coord[] {
  return douglasPeuckerSimplify(edge.geometry, zoomSimplificationTolerance(zoom));
}

interface IndexedEdge {
  readonly edge: GraphEdge;
  readonly bbox: BBox;
}

interface IndexedStation {
  readonly station: GraphStation;
}

class QuadNode {
  readonly bounds: BBox;
  readonly depth: number;
  edges: IndexedEdge[] = [];
  stations: IndexedStation[] = [];
  children: [QuadNode, QuadNode, QuadNode, QuadNode] | null = null;

  constructor(bounds: BBox, depth: number) {
    this.bounds = bounds;
    this.depth = depth;
  }

  private subdivide(): void {
    const [minLon, minLat, maxLon, maxLat] = this.bounds;
    const midLon = (minLon + maxLon) / 2;
    const midLat = (minLat + maxLat) / 2;
    const d = this.depth + 1;
    this.children = [
      new QuadNode([minLon, minLat, midLon, midLat], d),
      new QuadNode([midLon, minLat, maxLon, midLat], d),
      new QuadNode([minLon, midLat, midLon, maxLat], d),
      new QuadNode([midLon, midLat, maxLon, maxLat], d),
    ];
    const oldEdges = this.edges;
    const oldStations = this.stations;
    this.edges = [];
    this.stations = [];
    for (const ie of oldEdges) {
      let placed = false;
      for (const ch of this.children) {
        if (
          ie.bbox[0] >= ch.bounds[0] &&
          ie.bbox[2] <= ch.bounds[2] &&
          ie.bbox[1] >= ch.bounds[1] &&
          ie.bbox[3] <= ch.bounds[3]
        ) {
          ch.insertEdge(ie);
          placed = true;
          break;
        }
      }
      if (!placed) this.edges.push(ie);
    }
    for (const is of oldStations) {
      for (const ch of this.children) {
        if (pointInBBox(is.station.coordinates, ch.bounds)) {
          ch.insertStation(is);
          break;
        }
      }
    }
  }

  insertEdge(ie: IndexedEdge): void {
    if (this.children) {
      for (const ch of this.children) {
        if (
          ie.bbox[0] >= ch.bounds[0] &&
          ie.bbox[2] <= ch.bounds[2] &&
          ie.bbox[1] >= ch.bounds[1] &&
          ie.bbox[3] <= ch.bounds[3]
        ) {
          ch.insertEdge(ie);
          return;
        }
      }
      this.edges.push(ie);
      return;
    }
    this.edges.push(ie);
    if (this.depth < 12 && this.edges.length + this.stations.length > 16) {
      this.subdivide();
    }
  }

  insertStation(is: IndexedStation): void {
    if (this.children) {
      for (const ch of this.children) {
        if (pointInBBox(is.station.coordinates, ch.bounds)) {
          ch.insertStation(is);
          return;
        }
      }
    }
    this.stations.push(is);
  }

  query(bbox: BBox, outEdges: GraphEdge[], outStations: GraphStation[]): void {
    if (!bboxesOverlap(this.bounds, bbox)) return;
    for (const ie of this.edges) {
      if (bboxesOverlap(ie.bbox, bbox)) outEdges.push(ie.edge);
    }
    for (const is of this.stations) {
      if (pointInBBox(is.station.coordinates, bbox)) outStations.push(is.station);
    }
    if (this.children) {
      for (const ch of this.children) ch.query(bbox, outEdges, outStations);
    }
  }
}

/**
 * Deterministic 2D Quadtree spatial index and MapLibre render layer adapter for a single immutable RailGraph.
 * Separates zoom-simplified rendering coordinates cleanly from authoritative routing geometry.
 */
export class RailSpatialIndex {
  readonly #graph: RailGraph;
  readonly #root: QuadNode;
  readonly #worldBounds: BBox;

  constructor(graph: RailGraph) {
    if (!(graph instanceof RailGraph)) {
      throw new TypeError('Expected validated RailGraph');
    }
    this.#graph = graph;
    const snap = graph.snapshot();
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const n of snap.nodes) {
      const [lon, lat] = n.coordinates;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    for (const s of snap.stations) {
      const [lon, lat] = s.coordinates;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    for (const e of snap.edges) {
      const bb = edgeBBox(e.geometry);
      if (bb[0] < minLon) minLon = bb[0];
      if (bb[1] < minLat) minLat = bb[1];
      if (bb[2] > maxLon) maxLon = bb[2];
      if (bb[3] > maxLat) maxLat = bb[3];
    }
    if (!Number.isFinite(minLon)) {
      minLon = -180;
      minLat = -90;
      maxLon = 180;
      maxLat = 90;
    }
    const padLon = Math.max(0.01, (maxLon - minLon) * 0.01);
    const padLat = Math.max(0.01, (maxLat - minLat) * 0.01);
    this.#worldBounds = Object.freeze([minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat] as const);
    this.#root = new QuadNode(this.#worldBounds, 0);

    for (const e of snap.edges) {
      this.#root.insertEdge({ edge: e, bbox: edgeBBox(e.geometry) });
    }
    for (const s of snap.stations) {
      this.#root.insertStation({ station: s });
    }
    Object.freeze(this);
  }

  get worldBounds(): BBox {
    return this.#worldBounds;
  }

  get graphSha256(): string {
    return this.#graph.graphSha256;
  }

  /** Deterministically query all edges and stations intersecting bbox in ascending ASCII ID order. */
  queryBBox(bbox: BBox): Readonly<{
    edges: readonly GraphEdge[];
    stations: readonly GraphStation[];
    edgeIds: readonly string[];
    stationIds: readonly string[];
  }> {
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      throw new TypeError('Invalid BBox [minLon, minLat, maxLon, maxLat]');
    }
    if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) {
      throw new RangeError('Inverted BBox coordinates');
    }
    const edges: GraphEdge[] = [];
    const stations: GraphStation[] = [];
    this.#root.query(bbox, edges, stations);
    edges.sort((a, b) => cmp(a.id, b.id));
    stations.sort((a, b) => cmp(a.id, b.id));
    return Object.freeze({
      edges: Object.freeze(edges),
      stations: Object.freeze(stations),
      edgeIds: Object.freeze(edges.map((e) => e.id)),
      stationIds: Object.freeze(stations.map((s) => s.id)),
    });
  }

  /** Produce MapLibre-compatible GeoJSON FeatureCollections with zoom-simplified render geometry. */
  queryMapLibreFeatures(bbox: BBox, zoom: number): MapLibreViewportBundle {
    const tol = zoomSimplificationTolerance(zoom);
    const visible = this.queryBBox(bbox);
    const edgeFeatures: MapLibreEdgeFeature[] = visible.edges.map((e) => {
      const simplified = tol === 0 ? e.geometry : douglasPeuckerSimplify(e.geometry, tol);
      return Object.freeze({
        type: 'Feature' as const,
        id: e.id,
        geometry: Object.freeze({
          type: 'LineString' as const,
          coordinates: simplified,
        }),
        properties: Object.freeze({
          id: e.id,
          from: e.from,
          to: e.to,
          lengthM: e.lengthM,
          electrification: e.electrification,
          access: e.access,
          active: e.active,
          gaugeMm: e.gaugeMm,
          maxSpeedKmh: e.maxSpeedKmh,
          authoritativePointCount: e.geometry.length,
          renderedPointCount: simplified.length,
        }),
      });
    });

    const stationFeatures: MapLibreStationFeature[] = visible.stations.map((s) =>
      Object.freeze({
        type: 'Feature' as const,
        id: s.id,
        geometry: Object.freeze({
          type: 'Point' as const,
          coordinates: Object.freeze([s.coordinates[0], s.coordinates[1]] as const),
        }),
        properties: Object.freeze({
          id: s.id,
          name: s.name,
          regionId: s.regionId,
          anchorCount: s.nodeIds.length,
          nodeIds: s.nodeIds,
        }),
      }),
    );

    return Object.freeze({
      graphSha256: this.#graph.graphSha256,
      regionId: this.#graph.regionId,
      zoom,
      toleranceDeg: tol,
      edges: Object.freeze({ type: 'FeatureCollection' as const, features: Object.freeze(edgeFeatures) }),
      stations: Object.freeze({ type: 'FeatureCollection' as const, features: Object.freeze(stationFeatures) }),
    });
  }
}

/** Verify RegionManifest matches immutable RailGraph version and optional built tile bundle SHA-256. */
export function verifyGraphTileCompatibility(
  graph: RailGraph,
  manifestInput: unknown,
  options: { readonly expectedTilesSha256?: string; readonly requireBuiltTiles?: boolean } = {},
): Readonly<{ ok: true; regionId: string; graphSha256: string; tilesSha256: string } | { ok: false; reason: string }> {
  if (!(graph instanceof RailGraph)) {
    return Object.freeze({ ok: false as const, reason: 'INVALID_GRAPH' });
  }
  let manifest: RegionManifest;
  try {
    manifest = decodeRegionManifest(manifestInput);
  } catch {
    return Object.freeze({ ok: false as const, reason: 'INVALID_MANIFEST' });
  }
  if (manifest.id !== graph.regionId) {
    return Object.freeze({ ok: false as const, reason: 'REGION_MISMATCH' });
  }
  if (manifest.graphSha256 !== graph.graphSha256) {
    return Object.freeze({ ok: false as const, reason: 'GRAPH_VERSION_MISMATCH' });
  }
  if (manifest.stationCount !== graph.stationCount || manifest.edgeCount !== graph.edgeCount) {
    return Object.freeze({ ok: false as const, reason: 'ENTITY_COUNT_MISMATCH' });
  }
  const zeroSha = '0'.repeat(64);
  if (options.requireBuiltTiles && manifest.tilesSha256 === zeroSha) {
    return Object.freeze({ ok: false as const, reason: 'TILES_NOT_BUILT' });
  }
  if (options.expectedTilesSha256 && manifest.tilesSha256 !== options.expectedTilesSha256) {
    return Object.freeze({ ok: false as const, reason: 'TILES_HASH_MISMATCH' });
  }
  return Object.freeze({
    ok: true as const,
    regionId: graph.regionId,
    graphSha256: graph.graphSha256,
    tilesSha256: manifest.tilesSha256,
  });
}
