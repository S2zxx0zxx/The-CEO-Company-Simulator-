import type { Coord } from '../../domain/models';
import { integer } from '../../domain/units';
import {
  booleanValue,
  enumeration,
  id,
  list,
  nullable,
  object,
  refine,
  sha256,
  sourceUrl,
  text,
  version1,
  type Decoded,
} from '../../domain/validation';

const finiteNumber = (v: unknown, path = 'number'): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(path + ': expected finite number');
  }
  return v;
};

export const decodeBBox = refine(
  list(finiteNumber, 4, 4),
  (b) => b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90 && b[0] < b[2] && b[1] < b[3],
  'invalid WGS84 [minLon, minLat, maxLon, maxLat] bbox',
);

export const decodeC04TileManifest = refine(
  object({
    schemaVersion: version1,
    regionId: id,
    syntheticOnly: booleanValue,
    sourceUrl,
    sourcePbfBytes: (v, p) => integer(v, p, 1),
    sourcePbfSha256: sha256,
    planetilerVersion: text(64),
    schemaYamlSha256: sha256,
    graphSha256: sha256,
    pmtilesFile: text(256),
    pmtilesBytes: (v, p) => integer(v, p, 1),
    pmtilesSha256: sha256,
    styleVersion: id,
    minZoom: (v, p) => integer(v, p, 0, 16),
    maxZoom: (v, p) => integer(v, p, 0, 16),
    bounds: decodeBBox,
    boundaryLayersExcluded: booleanValue,
    attribution: text(512),
    buildDurationSeconds: nullable(finiteNumber),
  }),
  (m) => m.minZoom <= m.maxZoom && m.boundaryLayersExcluded === true,
  'invalid zoom range or unexcluded OSM boundary layers',
);

export type C04TileManifest = Decoded<typeof decodeC04TileManifest>;

const zeroSha = '0'.repeat(64);

/**
 * Separate Survey of India boundary layer contract per C01_CIVILIAN_MAP_SCOPE.json.
 * Political map boundary views MUST fail closed unless an approved asset is actually acquired.
 */
export const decodeBoundaryLayerContract = refine(
  object({
    schemaVersion: version1,
    sourceStandard: enumeration(['Survey of India']),
    assetAcquired: booleanValue,
    approvedForPoliticalView: booleanValue,
    layerUrl: nullable(text(1024)),
    assetSha256: nullable(sha256),
    license: nullable(text(160)),
    attribution: nullable(text(512)),
  }),
  (b) =>
    !b.approvedForPoliticalView ||
    (b.assetAcquired && b.layerUrl !== null && b.assetSha256 !== null && b.assetSha256 !== zeroSha && b.license !== null),
  'political boundary display cannot be approved without an acquired verified asset and license',
);

export type BoundaryLayerContract = Decoded<typeof decodeBoundaryLayerContract>;

export type MapAvailabilityState =
  | 'READY'
  | 'UNAVAILABLE_REGION'
  | 'WEBGL_UNSUPPORTED'
  | 'MANIFEST_MISMATCH'
  | 'TILE_ERROR'
  | 'DISPOSED';

export type MapLayerGroup =
  | 'basemap'
  | 'railNetwork'
  | 'companyRoutes'
  | 'routePreview'
  | 'stations'
  | 'junctions'
  | 'companyYards'
  | 'trains'
  | 'places'
  | 'boundary';

export interface CompanyRouteOverlay {
  readonly routeId: string;
  readonly name: string;
  readonly colorHex: string;
  readonly coordinates: readonly Coord[];
  readonly edgeIds: readonly string[];
}

export interface CompanyYardOverlay {
  readonly yardId: string;
  readonly baseId: string;
  readonly stationId: string;
  readonly name: string;
  readonly coordinates: Coord;
}

export type MapInteractionEvent =
  | { readonly type: 'tap_station'; readonly stationId: string; readonly name: string; readonly coordinates: Coord }
  | { readonly type: 'tap_train'; readonly tripId: string; readonly trainId: string; readonly planId: string; readonly coordinates: Coord }
  | { readonly type: 'tap_rail_edge'; readonly edgeId: string; readonly from: string; readonly to: string; readonly coordinates: Coord }
  | { readonly type: 'camera_change'; readonly center: Coord; readonly zoom: number; readonly bearing: number; readonly pitch: number }
  | { readonly type: 'layer_toggle'; readonly group: MapLayerGroup; readonly visible: boolean }
  | { readonly type: 'region_unavailable'; readonly regionId: string; readonly reason: string }
  | { readonly type: 'tile_error'; readonly reason: string }
  | { readonly type: 'webgl_context_lost' }
  | { readonly type: 'webgl_context_restored' };

export const DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT: BoundaryLayerContract = Object.freeze({
  schemaVersion: 1,
  sourceStandard: 'Survey of India',
  assetAcquired: false,
  approvedForPoliticalView: false,
  layerUrl: null,
  assetSha256: null,
  license: null,
  attribution: null,
});
