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

export interface OfflineUrlValidationOptions {
  readonly allowedOrigin?: string;
  readonly allowedArchiveIds?: readonly string[] | ReadonlySet<string>;
}

const ARCHIVE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._/{}-]+$/;
const CONTROL_OR_BACKSLASH_RE = /[\u0000-\u001f\u007f\\]/;
const ENCODED_SLASH_OR_BACKSLASH_RE = /%2f|%5c/i;
const ENCODED_COLON_RE = /%3a/i;
const CANARY_ORIGIN = 'https://offline-canary.invalid';
const CANARY_BASE = `${CANARY_ORIGIN}/app/index.html`;

function normalizeAllowedOrigin(allowedOrigin?: string): string | null {
  if (!allowedOrigin || typeof allowedOrigin !== 'string') return null;
  if (CONTROL_OR_BACKSLASH_RE.test(allowedOrigin) || /\s/.test(allowedOrigin) || allowedOrigin !== allowedOrigin.trim()) {
    return null;
  }
  try {
    const parsed = new URL(allowedOrigin);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.origin === 'null') {
      return null;
    }
    const stripped = allowedOrigin.replace(/\/+$/, '');
    if (parsed.origin !== stripped) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function safeDecodeSinglePass(raw: string): string | null {
  try {
    const once = decodeURIComponent(raw);
    const twice = decodeURIComponent(once);
    if (twice !== once) {
      return null;
    }
    return once;
  } catch {
    return null;
  }
}

function validateSafeResourceSubpath(remainder: string, allowTemplates: boolean): boolean {
  if (!remainder || remainder.startsWith('/') || remainder.includes('//') || CONTROL_OR_BACKSLASH_RE.test(remainder)) {
    return false;
  }
  if (remainder.includes('://') || remainder.includes(':') || remainder.includes('@') || remainder.includes('?') || remainder.includes('#')) {
    return false;
  }
  if (ENCODED_SLASH_OR_BACKSLASH_RE.test(remainder) || ENCODED_COLON_RE.test(remainder)) {
    return false;
  }
  const decoded = safeDecodeSinglePass(remainder);
  if (decoded === null || CONTROL_OR_BACKSLASH_RE.test(decoded) || decoded.includes('://') || decoded.includes(':') || decoded.includes('@') || decoded.includes('//')) {
    return false;
  }
  const segSource = allowTemplates ? decoded : decoded;
  const segments = segSource.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      return false;
    }
    const normalizedSeg = allowTemplates ? seg : seg;
    if (!/^[A-Za-z0-9 ._,/{}-]+$/.test(normalizedSeg)) {
      return false;
    }
    if (!allowTemplates && (normalizedSeg.includes('{') || normalizedSeg.includes('}'))) {
      return false;
    }
  }
  return true;
}

function toValidationOptions(originOrOptions?: string | OfflineUrlValidationOptions): OfflineUrlValidationOptions {
  if (typeof originOrOptions === 'string') {
    return { allowedOrigin: originOrOptions };
  }
  return originOrOptions ?? {};
}

function toArchiveSet(ids?: readonly string[] | ReadonlySet<string>): ReadonlySet<string> | null {
  if (!ids) return null;
  return ids instanceof Set ? ids : new Set(ids);
}

/**
 * Strictly validate that a URL uses an explicit approved offline scheme, relative path without
 * scheme-relative/backslash/traversal bypasses, or an exact parsed match for `allowedOrigin`.
 */
export function isPermittedOfflineUrl(
  rawUrl: string,
  originOrOptions?: string | OfflineUrlValidationOptions,
): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl !== rawUrl.trim() || CONTROL_OR_BACKSLASH_RE.test(rawUrl)) {
    return false;
  }
  if (ENCODED_SLASH_OR_BACKSLASH_RE.test(rawUrl) || ENCODED_COLON_RE.test(rawUrl)) {
    return false;
  }
  const decoded = safeDecodeSinglePass(rawUrl);
  if (decoded === null || CONTROL_OR_BACKSLASH_RE.test(decoded)) {
    return false;
  }

  const opts = toValidationOptions(originOrOptions);
  const allowedArchiveSet = toArchiveSet(opts.allowedArchiveIds);

  // Explicit scheme check on both raw and decoded forms to catch nested/encoded protocols.
  if (rawUrl.startsWith('pmtiles://')) {
    const rem = rawUrl.slice('pmtiles://'.length);
    const decodedRem = decoded.slice('pmtiles://'.length);
    if (!decoded.startsWith('pmtiles://') || rem !== decodedRem) {
      return false;
    }
    if (!rem || rem.startsWith('/') || rem.includes('://') || rem.includes(':') || rem.includes('@') || rem.includes('?') || rem.includes('#') || rem.includes('..')) {
      return false;
    }
    const parts = rem.split('/');
    const archiveId = parts[0];
    if (!ARCHIVE_ID_RE.test(archiveId) || archiveId === '.' || archiveId === '..') {
      return false;
    }
    if (allowedArchiveSet && !allowedArchiveSet.has(archiveId)) {
      return false;
    }
    if (parts.length === 1) {
      return true;
    }
    // Tile URL form: pmtiles://<archiveId>/{z}/{x}/{y} or numeric z/x/y(.pbf|.mvt)
    if (parts.length !== 4) {
      return false;
    }
    return parts.slice(1).every((seg) => /^(\{[zxy]\}|[0-9]+(\.(pbf|mvt))?)$/.test(seg));
  }

  if (rawUrl.startsWith('offlinefont://')) {
    if (!decoded.startsWith('offlinefont://')) return false;
    const rem = rawUrl.slice('offlinefont://'.length);
    if (!validateSafeResourceSubpath(rem, true)) {
      return false;
    }
    const decodedRem = decoded.slice('offlinefont://'.length);
    return /^[^/]+\/(\{range\}|[0-9]+-[0-9]+)\.pbf$/.test(decodedRem);
  }

  if (rawUrl.startsWith('localasset://')) {
    if (!decoded.startsWith('localasset://')) return false;
    const rem = rawUrl.slice('localasset://'.length);
    return validateSafeResourceSubpath(rem, false);
  }

  // Reject scheme-relative URLs (//, ///, /\) before checking relative paths.
  if (rawUrl.startsWith('//') || decoded.startsWith('//')) {
    return false;
  }

  // Relative same-origin offline paths: ./..., ../..., or single /...
  if (rawUrl.startsWith('./') || rawUrl.startsWith('../') || rawUrl.startsWith('/')) {
    if (rawUrl.includes('://') || rawUrl.includes(':') || decoded.includes('://') || decoded.includes(':')) {
      return false;
    }
    if (!SAFE_SEGMENT_RE.test(decoded.replace(/ /g, '_'))) {
      // Allow queryless safe path chars and spaces in asset filenames while rejecting ? # @
      if (decoded.includes('?') || decoded.includes('#') || decoded.includes('@')) {
        return false;
      }
    }
    try {
      const resolved = new URL(rawUrl, CANARY_BASE);
      if (resolved.origin !== CANARY_ORIGIN || resolved.username || resolved.password) {
        return false;
      }
      if (resolved.pathname.includes('//')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Only explicit exact-origin http(s) URLs are allowed when allowedOrigin is supplied.
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    const normalizedAllowed = normalizeAllowedOrigin(opts.allowedOrigin);
    if (!normalizedAllowed) {
      return false;
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.username || parsed.password) {
        return false;
      }
      if (parsed.origin !== normalizedAllowed) {
        return false;
      }
      if (parsed.pathname.includes('//')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/** Fail closed if any style resource (sprite, sprite arrays, glyphs, source URLs/tiles/data) points to an external or invalid URL. */
export function validateOfflineStyleNoExternalUrls(
  style: Record<string, unknown>,
  originOrOptions?: string | OfflineUrlValidationOptions,
): Readonly<{ ok: true } | { ok: false; violations: readonly string[] }> {
  const violations: string[] = [];

  if (style.sprite !== undefined) {
    if (typeof style.sprite === 'string') {
      if (!isPermittedOfflineUrl(style.sprite, originOrOptions)) {
        violations.push(`sprite: ${style.sprite}`);
      }
    } else if (Array.isArray(style.sprite)) {
      style.sprite.forEach((entry, idx) => {
        if (typeof entry === 'string') {
          if (!isPermittedOfflineUrl(entry, originOrOptions)) {
            violations.push(`sprite[${idx}]: ${entry}`);
          }
        } else if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' && typeof (entry as { url?: unknown }).url === 'string') {
          const urlVal = (entry as { url: string }).url;
          if (!isPermittedOfflineUrl(urlVal, originOrOptions)) {
            violations.push(`sprite[${idx}].url: ${urlVal}`);
          }
        } else {
          violations.push(`sprite[${idx}]: invalid sprite entry`);
        }
      });
    } else {
      violations.push('sprite: unsupported value type');
    }
  }

  if (style.glyphs !== undefined) {
    if (typeof style.glyphs !== 'string' || !isPermittedOfflineUrl(style.glyphs, originOrOptions)) {
      violations.push(`glyphs: ${String(style.glyphs)}`);
    }
  }

  const rawSources = style.sources;
  if (rawSources !== undefined) {
    if (!rawSources || typeof rawSources !== 'object' || Array.isArray(rawSources)) {
      violations.push('sources: invalid sources map');
    } else {
      const sources = rawSources as Record<string, unknown>;
      for (const [sname, rawSrc] of Object.entries(sources)) {
        if (!rawSrc || typeof rawSrc !== 'object' || Array.isArray(rawSrc)) {
          violations.push(`source.${sname}: invalid source definition`);
          continue;
        }
        const src = rawSrc as Record<string, unknown>;
        if (src.url !== undefined) {
          if (typeof src.url !== 'string' || !isPermittedOfflineUrl(src.url, originOrOptions)) {
            violations.push(`source.${sname}.url: ${String(src.url)}`);
          }
        }
        if (src.data !== undefined) {
          if (typeof src.data === 'string') {
            if (!isPermittedOfflineUrl(src.data, originOrOptions)) {
              violations.push(`source.${sname}.data: ${src.data}`);
            }
          } else if (typeof src.data !== 'object' || src.data === null || Array.isArray(src.data)) {
            violations.push(`source.${sname}.data: unsupported data value`);
          }
        }
        if (src.tiles !== undefined) {
          if (!Array.isArray(src.tiles)) {
            violations.push(`source.${sname}.tiles: expected array`);
          } else {
            src.tiles.forEach((tu, idx) => {
              if (typeof tu !== 'string' || !isPermittedOfflineUrl(tu, originOrOptions)) {
                violations.push(`source.${sname}.tiles[${idx}]: ${String(tu)}`);
              }
            });
          }
        }
      }
    }
  }

  return violations.length === 0
    ? Object.freeze({ ok: true as const })
    : Object.freeze({ ok: false as const, violations: Object.freeze(violations) });
}
