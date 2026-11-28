import type { BoundaryLayerContract, MapLayerGroup } from './contracts';

export const RAILWAY_CEO_STYLE_VERSION = 'c04-rail-style-v1' as const;

export const LAYER_GROUP_MAP: Readonly<Record<MapLayerGroup, readonly string[]>> = Object.freeze({
  basemap: [
    'basemap-landuse-forest',
    'basemap-landuse-park',
    'basemap-landuse-urban',
    'basemap-water',
    'basemap-waterway-river',
    'basemap-waterway-stream',
    'basemap-roads-casing',
    'basemap-roads-major',
    'basemap-roads-local',
    'basemap-rail-pmtiles-context',
  ],
  railNetwork: ['c03-civilian-rail-casing', 'c03-civilian-rail-core'],
  companyRoutes: ['c03-company-routes-line', 'c03-company-route-arrows', 'c03-route-selected-casing', 'c03-route-selected-core'],
  routePreview: ['c03-route-preview-line'],
  stations: ['c03-station-markers', 'c03-station-labels', 'c03-station-selected-halo'],
  junctions: ['c03-junction-markers'],
  companyYards: ['c03-company-yards'],
  trains: ['c03-trains-markers', 'c03-train-selected', 'c03-train-labels'],
  places: ['basemap-place-city', 'basemap-place-town', 'basemap-place-village'],
  boundary: ['soi-approved-boundary-line'],
});

export interface OfflineStyleOptions {
  readonly pmtilesSourceUrl: string;
  readonly spriteUrl: string;
  readonly glyphsUrl: string;
  readonly attribution: string;
  readonly center?: readonly [number, number];
  readonly zoom?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly boundaryContract?: BoundaryLayerContract;
  readonly bounds?: readonly [number, number, number, number];
}

const emptyFeatureCollection = () => ({ type: 'FeatureCollection' as const, features: [] as unknown[] });

/**
 * Construct an offline-only MapLibre GL Style v8 specification integrating PMTiles basemap tiles,
 * all 11 C03 railway/simulation overlay layers, multi-zoom visibility, and gated SoI boundaries.
 */
export function buildOfflineMapStyle(opts: OfflineStyleOptions): Record<string, unknown> {
  const minzoom = opts.minZoom ?? 0;
  const maxzoom = opts.maxZoom ?? 14;
  const hasApprovedSoi = Boolean(
    opts.boundaryContract &&
    opts.boundaryContract.assetAcquired &&
    opts.boundaryContract.approvedForPoliticalView &&
    opts.boundaryContract.layerUrl,
  );

  const sources: Record<string, unknown> = {
    basemap: {
      type: 'vector',
      url: opts.pmtilesSourceUrl,
      minzoom,
      maxzoom,
      attribution: opts.attribution,
    },
    'c03-rail-network': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-route-preview': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-company-routes': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-route-selected': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-junctions': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-stations': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-station-selected': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-company-yards': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-trains': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-train-selected': { type: 'geojson', data: emptyFeatureCollection() },
    'c03-feedback': { type: 'geojson', data: emptyFeatureCollection() },
  };

  if (hasApprovedSoi && opts.boundaryContract?.layerUrl) {
    sources['soi-boundary'] = {
      type: 'geojson',
      data: opts.boundaryContract.layerUrl,
      attribution: opts.boundaryContract.attribution ?? 'Survey of India',
    };
  }

  const layers: Record<string, unknown>[] = [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f3efe6' },
    },
    {
      id: 'basemap-landuse-forest',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      minzoom: 6,
      filter: ['in', ['get', 'class'], ['literal', ['forest', 'meadow', 'grass']]],
      paint: { 'fill-color': '#dbead2', 'fill-opacity': 0.75 },
    },
    {
      id: 'basemap-landuse-park',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      minzoom: 8,
      filter: ['==', ['get', 'class'], 'park'],
      paint: { 'fill-color': '#cce5c0', 'fill-opacity': 0.85 },
    },
    {
      id: 'basemap-landuse-urban',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      minzoom: 6,
      filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial']]],
      paint: {
        'fill-color': ['match', ['get', 'class'], 'commercial', '#eadfd5', 'industrial', '#e4e2dc', '#ebe6db'],
        'fill-opacity': 0.7,
      },
    },
    {
      id: 'basemap-water',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      minzoom: 0,
      paint: { 'fill-color': '#a5d3f5' },
    },
    {
      id: 'basemap-waterway-river',
      type: 'line',
      source: 'basemap',
      'source-layer': 'waterway',
      minzoom: 5,
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7bc0ee',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 3.0, 14, 6.0],
      },
    },
    {
      id: 'basemap-waterway-stream',
      type: 'line',
      source: 'basemap',
      'source-layer': 'waterway',
      minzoom: 9,
      filter: ['==', ['get', 'class'], 'stream'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#8fcbf1',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2.2],
      },
    },
    {
      id: 'basemap-roads-casing',
      type: 'line',
      source: 'basemap',
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['==', ['get', 'kind'], 'road'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#d4cbc0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.2, 14, 7.0],
      },
    },
    {
      id: 'basemap-roads-major',
      type: 'line',
      source: 'basemap',
      'source-layer': 'transportation',
      minzoom: 4,
      filter: ['all', ['==', ['get', 'kind'], 'road'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'class'], 'motorway', '#f2b872', 'trunk', '#f5cb90', '#f9dfa9'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 10, 2.6, 14, 5.2],
      },
    },
    {
      id: 'basemap-roads-local',
      type: 'line',
      source: 'basemap',
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['all', ['==', ['get', 'kind'], 'road'], ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'residential']]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 3.6],
      },
    },
    {
      id: 'basemap-rail-pmtiles-context',
      type: 'line',
      source: 'basemap',
      'source-layer': 'transportation',
      minzoom: 4,
      filter: ['==', ['get', 'kind'], 'railway'],
      paint: {
        'line-color': '#cbd5e1',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.0, 12, 2.5],
        'line-dasharray': [2, 2],
      },
    },
    // Layer 1: Authoritative C03 Civilian Railway Network
    {
      id: 'c03-civilian-rail-casing',
      type: 'line',
      source: 'c03-rail-network',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0f172a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.6, 10, 4.6, 14, 6.4],
        'line-opacity': 0.55,
      },
    },
    {
      id: 'c03-civilian-rail-core',
      type: 'line',
      source: 'c03-rail-network',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'electrification'],
          'yes',
          '#1d4ed8',
          'no',
          '#475569',
          '#94a3b8',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 10, 2.8, 14, 4.0],
      },
    },
    // Layer 9: Route Preview Overlay
    {
      id: 'c03-route-preview-line',
      type: 'line',
      source: 'c03-route-preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f59e0b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3.0, 14, 6.0],
        'line-dasharray': [2, 1.5],
      },
    },
    // Layer 2: Company-Operated Routes + Direction Arrows
    {
      id: 'c03-company-routes-line',
      type: 'line',
      source: 'c03-company-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'colorHex'], '#059669'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.4, 10, 4.2, 14, 5.6],
      },
    },
    {
      id: 'c03-company-route-arrows',
      type: 'symbol',
      source: 'c03-company-routes',
      minzoom: 9,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'icon-image': 'direction-arrow',
        'icon-size': 0.75,
        'icon-allow-overlap': true,
      },
    },
    // Layer 3: Selected Route Highlight
    {
      id: 'c03-route-selected-casing',
      type: 'line',
      source: 'c03-route-selected',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5.5, 14, 9.5],
      },
    },
    {
      id: 'c03-route-selected-core',
      type: 'line',
      source: 'c03-route-selected',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#dc2626',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3.2, 14, 6.0],
      },
    },
    // Layer 5: Junction Indicators (detailed zoom >= 9)
    {
      id: 'c03-junction-markers',
      type: 'symbol',
      source: 'c03-junctions',
      minzoom: 9,
      layout: {
        'icon-image': 'junction-node',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1.0],
        'icon-allow-overlap': true,
      },
    },
    // Layer 8: Company-Generated Yards / Depots
    {
      id: 'c03-company-yards',
      type: 'symbol',
      source: 'c03-company-yards',
      minzoom: 10,
      layout: {
        'icon-image': 'yard-depot',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.1],
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'],
        'text-font': ['Inter Regular'],
        'text-size': 10,
        'text-offset': [0, 1.5],
        'text-optional': true,
      },
      paint: {
        'text-color': '#0f766e',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    },
    // Layer 4: Public Station Markers + Labels
    {
      id: 'c03-station-markers',
      type: 'symbol',
      source: 'c03-stations',
      minzoom: 4,
      layout: {
        'icon-image': ['case', ['>', ['get', 'anchorCount'], 1], 'station-major', 'station-major'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 10, 0.85, 14, 1.05],
        'icon-allow-overlap': true,
      },
    },
    {
      id: 'c03-station-labels',
      type: 'symbol',
      source: 'c03-stations',
      minzoom: 7,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Inter SemiBold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 12, 14, 13],
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-padding': 4,
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.8,
      },
    },
    // Layer 10: Selected Station / Base Halo
    {
      id: 'c03-station-selected-halo',
      type: 'symbol',
      source: 'c03-station-selected',
      layout: {
        'icon-image': 'station-selected',
        'icon-size': 1.15,
        'icon-allow-overlap': true,
      },
    },
    // Layer 11: Interaction Feedback Ring
    {
      id: 'c03-interaction-feedback',
      type: 'circle',
      source: 'c03-feedback',
      paint: {
        'circle-radius': 18,
        'circle-color': 'rgba(245, 158, 11, 0.18)',
        'circle-stroke-color': '#d97706',
        'circle-stroke-width': 2,
      },
    },
    // Layer 6 & 7: Simulated Trains & Selected Train Highlight
    {
      id: 'c03-trains-markers',
      type: 'symbol',
      source: 'c03-trains',
      layout: {
        'icon-image': 'train-loco',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 10, 0.95, 14, 1.15],
        'icon-rotate': ['coalesce', ['get', 'headingDeg'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: 'c03-train-selected',
      type: 'symbol',
      source: 'c03-train-selected',
      layout: {
        'icon-image': 'train-selected',
        'icon-size': 1.1,
        'icon-rotate': ['coalesce', ['get', 'headingDeg'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: 'c03-train-labels',
      type: 'symbol',
      source: 'c03-trains',
      minzoom: 9,
      layout: {
        'text-field': ['get', 'trainId'],
        'text-font': ['Inter SemiBold'],
        'text-size': 10,
        'text-offset': [0, -1.6],
        'text-optional': true,
      },
      paint: {
        'text-color': '#1e3a8a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
      },
    },
    // Geographic Places (Cities, Towns, Villages)
    {
      id: 'basemap-place-city',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: 3,
      filter: ['==', ['get', 'class'], 'city'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Inter SemiBold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 12, 10, 16],
        'text-padding': 6,
      },
      paint: { 'text-color': '#334155', 'text-halo-color': '#f8fafc', 'text-halo-width': 2 },
    },
    {
      id: 'basemap-place-town',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: 6,
      filter: ['==', ['get', 'class'], 'town'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Inter Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 13],
        'text-padding': 4,
      },
      paint: { 'text-color': '#475569', 'text-halo-color': '#f8fafc', 'text-halo-width': 1.6 },
    },
    {
      id: 'basemap-place-village',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: 10,
      filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb']]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Inter Regular'],
        'text-size': 11,
      },
      paint: { 'text-color': '#64748b', 'text-halo-color': '#f8fafc', 'text-halo-width': 1.4 },
    },
  ];

  if (hasApprovedSoi) {
    layers.push({
      id: 'soi-approved-boundary-line',
      type: 'line',
      source: 'soi-boundary',
      paint: { 'line-color': '#6b21a8', 'line-width': 2.0, 'line-dasharray': [4, 2] },
    });
  }

  return {
    version: 8,
    name: `Railway CEO Offline Map (${RAILWAY_CEO_STYLE_VERSION})`,
    metadata: { styleVersion: RAILWAY_CEO_STYLE_VERSION, boundaryApproved: hasApprovedSoi },
    center: opts.center ?? [86.08, 22.07],
    zoom: opts.zoom ?? 10,
    bounds: opts.bounds,
    sprite: opts.spriteUrl,
    glyphs: opts.glyphsUrl,
    sources,
    layers,
  };
}

function isPermittedOfflineUrl(rawUrl: string, allowedOrigin?: string): boolean {
  const s = rawUrl.trim();
  if (
    s.startsWith('./') ||
    s.startsWith('../') ||
    s.startsWith('/') ||
    s.startsWith('pmtiles://') ||
    s.startsWith('offlinefont://') ||
    s.startsWith('localasset://') ||
    s.startsWith('data:')
  ) {
    return true;
  }
  if (allowedOrigin && s.startsWith(allowedOrigin)) {
    return true;
  }
  return false;
}

/** Fail closed if any style resource (sprite, glyphs, source URLs/tiles) points to an external network URL. */
export function validateOfflineStyleNoExternalUrls(
  style: Record<string, unknown>,
  allowedOrigin?: string,
): Readonly<{ ok: true } | { ok: false; violations: readonly string[] }> {
  const violations: string[] = [];
  for (const field of ['sprite', 'glyphs']) {
    const val = style[field];
    if (typeof val === 'string' && !isPermittedOfflineUrl(val, allowedOrigin)) {
      violations.push(`${field}: ${val}`);
    }
  }
  const sources = (style.sources ?? {}) as Record<string, Record<string, unknown>>;
  for (const [sname, src] of Object.entries(sources)) {
    if (typeof src.url === 'string' && !isPermittedOfflineUrl(src.url, allowedOrigin)) {
      violations.push(`source.${sname}.url: ${src.url}`);
    }
    if (typeof src.data === 'string' && !isPermittedOfflineUrl(src.data, allowedOrigin)) {
      violations.push(`source.${sname}.data: ${src.data}`);
    }
    if (Array.isArray(src.tiles)) {
      for (const tu of src.tiles) {
        if (typeof tu === 'string' && !isPermittedOfflineUrl(tu, allowedOrigin)) {
          violations.push(`source.${sname}.tiles: ${tu}`);
        }
      }
    }
  }
  return violations.length === 0
    ? Object.freeze({ ok: true as const })
    : Object.freeze({ ok: false as const, violations: Object.freeze(violations) });
}
