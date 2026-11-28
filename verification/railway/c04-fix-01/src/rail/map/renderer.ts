import type { Coord, RegionManifest } from '../../domain/models';
import { RailGraph } from '../graph';
import {
  interpolateRoutePosition,
  projectMovementInspection,
  type MovementInspectionLike,
  type ProjectedTrainState,
  type RouteGeometryProfile,
} from '../geometry';
import { RailSpatialIndex, type BBox } from '../spatial';
import {
  DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT,
  type BoundaryLayerContract,
  type C04TileManifest,
  type CompanyRouteOverlay,
  type CompanyYardOverlay,
  type MapAvailabilityState,
  type MapInteractionEvent,
  type MapLayerGroup,
} from './contracts';
import { verifyGraphTilesBundleMatch } from './pmtiles-adapter';
import { LAYER_GROUP_MAP, RAILWAY_CEO_STYLE_VERSION, buildOfflineMapStyle, validateOfflineStyleNoExternalUrls } from './style';

export interface MapLibreGeoJsonSourceLike {
  setData(data: unknown): void;
}

export interface MapLibreMapLike {
  on(type: string, listener: (ev: unknown) => void): void;
  on(type: string, layerId: string, listener: (ev: unknown) => void): void;
  once(type: string, listener: (ev: unknown) => void): void;
  getSource(id: string): MapLibreGeoJsonSourceLike | undefined;
  getLayer(id: string): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getBearing(): number;
  getPitch(): number;
  jumpTo(opts: { center?: readonly [number, number]; zoom?: number; bearing?: number; pitch?: number }): void;
  easeTo(opts: { center?: readonly [number, number]; zoom?: number; bearing?: number; pitch?: number; duration?: number }): void;
  zoomIn(opts?: { duration?: number }): void;
  zoomOut(opts?: { duration?: number }): void;
  resize(): void;
  getCanvas(): HTMLCanvasElement;
  remove(): void;
}

export interface WebGLCheckResult {
  readonly supported: boolean;
  readonly reason: string | null;
}

/** Safely probe WebGL2/WebGL support without uncaught exceptions on constrained devices. */
export function detectWebGLSupport(
  canvasFactory: () => { getContext?(id: string): unknown } | null = () =>
    typeof document !== 'undefined' ? document.createElement('canvas') : null,
): WebGLCheckResult {
  try {
    const canvas = canvasFactory();
    if (!canvas || typeof canvas.getContext !== 'function') {
      return Object.freeze({ supported: false, reason: 'CANVAS_UNAVAILABLE' });
    }
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      return Object.freeze({ supported: false, reason: 'WEBGL_CONTEXT_UNAVAILABLE' });
    }
    return Object.freeze({ supported: true, reason: null });
  } catch {
    return Object.freeze({ supported: false, reason: 'WEBGL_PROBE_THREW' });
  }
}

export interface RendererOptions {
  readonly container: HTMLElement;
  readonly maplibregl: { readonly Map: new (opts: Record<string, unknown>) => MapLibreMapLike };
  readonly graph: RailGraph;
  readonly spatialIndex: RailSpatialIndex;
  readonly regionManifest: RegionManifest;
  readonly tileManifest: C04TileManifest;
  readonly pmtilesSourceUrl: string;
  readonly spriteUrl: string;
  readonly glyphsUrl: string;
  readonly allowedOrigin?: string;
  readonly allowedArchiveIds?: readonly string[] | ReadonlySet<string>;
  readonly boundaryContract?: BoundaryLayerContract;
  readonly initialCenter?: readonly [number, number];
  readonly initialZoom?: number;
  readonly expectedGraphSha256?: string;
  readonly expectedPmtilesSha256?: string;
  readonly onInteraction?: (ev: MapInteractionEvent) => void;
}

const emptyFc = () => ({ type: 'FeatureCollection', features: [] });

/**
 * Production C04 MapLibre Renderer controller bound to an authoritative C03 RailGraph & SpatialIndex
 * plus read-only R33 movement snapshots. Owns no simulation clock, routing authority, or save state.
 */
export class RailwayMapRenderer {
  #state: MapAvailabilityState = 'UNAVAILABLE_REGION';
  #statusReason = 'INITIALIZING';
  #map: MapLibreMapLike | null = null;
  readonly #graph: RailGraph;
  readonly #spatial: RailSpatialIndex;
  readonly #boundary: BoundaryLayerContract;
  readonly #initialCenter: readonly [number, number];
  readonly #initialZoom: number;
  readonly #onInteraction?: (ev: MapInteractionEvent) => void;

  #selectedStationId: string | null = null;
  #selectedRouteId: string | null = null;
  #selectedTrainId: string | null = null;
  #followingTrainId: string | null = null;
  #previewRoute: RouteGeometryProfile | null = null;
  #companyRoutes: readonly CompanyRouteOverlay[] = [];
  #companyYards: readonly CompanyYardOverlay[] = [];
  #lastTrains: readonly ProjectedTrainState[] = [];
  #lastViewportKey = '';
  #layerVisibility: Record<MapLayerGroup, boolean> = {
    basemap: true,
    railNetwork: true,
    companyRoutes: true,
    routePreview: true,
    stations: true,
    junctions: true,
    companyYards: true,
    trains: true,
    places: true,
    boundary: false,
  };

  constructor(opts: RendererOptions) {
    this.#graph = opts.graph;
    this.#spatial = opts.spatialIndex;
    this.#boundary = opts.boundaryContract ?? DEFAULT_UNACQUIRED_BOUNDARY_CONTRACT;
    this.#onInteraction = opts.onInteraction;
    this.#initialCenter = opts.initialCenter ?? [
      (opts.tileManifest.bounds[0] + opts.tileManifest.bounds[2]) / 2,
      (opts.tileManifest.bounds[1] + opts.tileManifest.bounds[3]) / 2,
    ];
    this.#initialZoom = opts.initialZoom ?? 10;

    // 1. Verify WebGL support cleanly
    const gl = detectWebGLSupport();
    if (!gl.supported) {
      this.#state = 'WEBGL_UNSUPPORTED';
      this.#statusReason = gl.reason ?? 'WEBGL_UNSUPPORTED';
      return;
    }

    // 2. Verify strict graph <-> RegionManifest <-> TileManifest parity fail-closed
    const match = verifyGraphTilesBundleMatch(
      opts.graph,
      opts.regionManifest,
      opts.tileManifest,
      RAILWAY_CEO_STYLE_VERSION,
      {
        expectedGraphSha256: opts.expectedGraphSha256,
        expectedPmtilesSha256: opts.expectedPmtilesSha256,
      },
    );
    if (!match.ok) {
      this.#state = 'MANIFEST_MISMATCH';
      this.#statusReason = match.reason;
      this.#onInteraction?.({ type: 'region_unavailable', regionId: opts.tileManifest?.regionId ?? 'unknown', reason: match.reason });
      return;
    }

    // 3. Build offline style and reject any external CDN references
    const style = buildOfflineMapStyle({
      pmtilesSourceUrl: opts.pmtilesSourceUrl,
      spriteUrl: opts.spriteUrl,
      glyphsUrl: opts.glyphsUrl,
      attribution: opts.tileManifest.attribution,
      center: this.#initialCenter,
      zoom: this.#initialZoom,
      minZoom: opts.tileManifest.minZoom,
      maxZoom: opts.tileManifest.maxZoom,
      bounds: opts.tileManifest.bounds,
      boundaryContract: this.#boundary,
    });
    const offlineCheck = validateOfflineStyleNoExternalUrls(style, {
      allowedOrigin: opts.allowedOrigin,
      allowedArchiveIds: opts.allowedArchiveIds,
    });
    if (!offlineCheck.ok) {
      this.#state = 'MANIFEST_MISMATCH';
      this.#statusReason = 'EXTERNAL_URL_FORBIDDEN:' + offlineCheck.violations.join(';');
      return;
    }

    this.#layerVisibility.boundary = Boolean(this.#boundary.assetAcquired && this.#boundary.approvedForPoliticalView);

    // 4. Initialize MapLibre GL JS Map with portrait-friendly touch defaults
    const map = new opts.maplibregl.Map({
      container: opts.container,
      style,
      center: this.#initialCenter,
      zoom: this.#initialZoom,
      minZoom: opts.tileManifest.minZoom,
      maxZoom: 16,
      touchZoomRotate: true,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    this.#map = map;

    map.on('load', () => {
      if (this.#state === 'DISPOSED') return;
      this.#state = 'READY';
      this.#statusReason = 'OK';
      this.syncViewportLayers(true);
      this.syncDynamicOverlays();
    });

    map.on('moveend', () => {
      if (this.#state === 'DISPOSED' || !this.#map) return;
      this.syncViewportLayers(false);
      const c = this.#map.getCenter();
      this.#onInteraction?.({
        type: 'camera_change',
        center: [c.lng, c.lat],
        zoom: this.#map.getZoom(),
        bearing: this.#map.getBearing(),
        pitch: this.#map.getPitch(),
      });
    });

    map.on('error', (ev) => {
      const msg = ev && typeof ev === 'object' && 'error' in ev ? String((ev as { error: unknown }).error) : String(ev);
      this.#onInteraction?.({ type: 'tile_error', reason: msg });
    });

    const canvas = map.getCanvas();
    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('webglcontextlost', (e) => {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        this.#onInteraction?.({ type: 'webgl_context_lost' });
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.#onInteraction?.({ type: 'webgl_context_restored' });
      });
    }

    // Bind MapLibre interactive tap handlers for stations, trains, and railway edges
    map.on('click', 'c03-station-markers', (ev) => {
      const feat = (ev as { features?: { properties?: { id?: string; name?: string }; geometry?: { coordinates?: Coord } }[] })?.features?.[0];
      if (!feat?.properties?.id) return;
      this.selectStation(feat.properties.id);
      this.#onInteraction?.({
        type: 'tap_station',
        stationId: feat.properties.id,
        name: feat.properties.name ?? feat.properties.id,
        coordinates: feat.geometry?.coordinates ?? this.#graph.station(feat.properties.id).coordinates,
      });
    });

    map.on('click', 'c03-trains-markers', (ev) => {
      const feat = (ev as { features?: { properties?: { tripId?: string; trainId?: string; planId?: string }; geometry?: { coordinates?: Coord } }[] })?.features?.[0];
      if (!feat?.properties?.trainId) return;
      this.selectTrain(feat.properties.trainId);
      this.#onInteraction?.({
        type: 'tap_train',
        tripId: feat.properties.tripId ?? '',
        trainId: feat.properties.trainId,
        planId: feat.properties.planId ?? '',
        coordinates: feat.geometry?.coordinates ?? [0, 0],
      });
    });

    map.on('click', 'c03-civilian-rail-core', (ev) => {
      const feat = (ev as { features?: { properties?: { id?: string; from?: string; to?: string } }[]; lngLat?: { lng: number; lat: number } })?.features?.[0];
      const lngLat = (ev as { lngLat?: { lng: number; lat: number } })?.lngLat;
      if (!feat?.properties?.id) return;
      this.#onInteraction?.({
        type: 'tap_rail_edge',
        edgeId: feat.properties.id,
        from: feat.properties.from ?? '',
        to: feat.properties.to ?? '',
        coordinates: lngLat ? [lngLat.lng, lngLat.lat] : [0, 0],
      });
    });
  }

  get state(): MapAvailabilityState {
    return this.#state;
  }

  get statusReason(): string {
    return this.#statusReason;
  }

  get graph(): RailGraph {
    return this.#graph;
  }

  get selectedStationId(): string | null {
    return this.#selectedStationId;
  }

  get selectedRouteId(): string | null {
    return this.#selectedRouteId;
  }

  get selectedTrainId(): string | null {
    return this.#selectedTrainId;
  }

  /** Wait until MapLibre fires load or returns immediately if unavailable/error. */
  waitUntilReady(timeoutMs = 15000): Promise<MapAvailabilityState> {
    if (this.#state !== 'UNAVAILABLE_REGION' || !this.#map) {
      return Promise.resolve(this.#state);
    }
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(this.#state), timeoutMs);
      this.#map!.once('load', () => {
        clearTimeout(t);
        resolve(this.#state);
      });
    });
  }

  /** Viewport-culled C03 spatial index update using zoom-simplified coordinates without altering RailGraph. */
  syncViewportLayers(force = false): { readonly edgeCount: number; readonly stationCount: number; readonly zoom: number } | null {
    if (!this.#map || this.#state === 'DISPOSED') return null;
    const b = this.#map.getBounds();
    const zoom = this.#map.getZoom();
    const bbox: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const tier = Math.floor(zoom);
    const key = `${tier}:${bbox.map((v) => v.toFixed(3)).join(',')}`;
    if (!force && key === this.#lastViewportKey) return null;
    this.#lastViewportKey = key;

    const bundle = this.#spatial.queryMapLibreFeatures(bbox, zoom);
    this.#map.getSource('c03-rail-network')?.setData(bundle.edges);
    this.#map.getSource('c03-stations')?.setData(bundle.stations);

    // Emit junction node indicators in viewport (degree in+out >= 3)
    const jFeatures: unknown[] = [];
    const snap = this.#graph.snapshot();
    for (const node of snap.nodes) {
      const [lon, lat] = node.coordinates;
      if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) {
        const deg = new Set([
          ...this.#graph.outgoing(node.id).map((e) => e.to),
          ...this.#graph.incoming(node.id).map((e) => e.from),
        ]).size;
        if (deg >= 3) {
          jFeatures.push({
            type: 'Feature',
            id: node.id,
            geometry: { type: 'Point', coordinates: node.coordinates },
            properties: { id: node.id, degree: deg },
          });
        }
      }
    }
    this.#map.getSource('c03-junctions')?.setData({ type: 'FeatureCollection', features: jFeatures });
    return { edgeCount: bundle.edges.features.length, stationCount: bundle.stations.features.length, zoom };
  }

  /** Update route preview polyline layer. */
  setPreviewRoute(profile: RouteGeometryProfile | null): void {
    this.#previewRoute = profile;
    if (!this.#map) return;
    if (!profile) {
      this.#map.getSource('c03-route-preview')?.setData(emptyFc());
      return;
    }
    const coords: Coord[] = [];
    for (const span of profile.spans) {
      for (let i = 0; i < span.geometry.length; i++) {
        if (i === 0 && coords.length > 0) continue;
        coords.push(span.geometry[i]);
      }
    }
    this.#map.getSource('c03-route-preview')?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: profile.routeId,
          geometry: { type: 'LineString', coordinates: coords },
          properties: { routeId: profile.routeId, totalDistanceM: profile.totalDistanceM },
        },
      ],
    });
  }

  /** Update company-owned routes and optional selected route highlight. */
  setCompanyRoutes(routes: readonly CompanyRouteOverlay[]): void {
    this.#companyRoutes = routes;
    this.syncDynamicOverlays();
  }

  /** Update game-generated company yards / depots layer. */
  setCompanyYards(yards: readonly CompanyYardOverlay[]): void {
    this.#companyYards = yards;
    this.syncDynamicOverlays();
  }

  selectStation(stationId: string | null): void {
    this.#selectedStationId = stationId;
    this.syncDynamicOverlays();
  }

  selectRoute(routeId: string | null): void {
    this.#selectedRouteId = routeId;
    this.syncDynamicOverlays();
  }

  selectTrain(trainId: string | null): void {
    this.#selectedTrainId = trainId;
    this.syncDynamicOverlays();
  }

  followTrain(trainId: string | null): void {
    this.#followingTrainId = trainId;
    if (trainId) {
      this.#selectedTrainId = trainId;
      const found = this.#lastTrains.find((t) => t.trainId === trainId);
      if (found && this.#map) {
        this.#map.easeTo({ center: found.coordinates, duration: 250 });
      }
    }
    this.syncDynamicOverlays();
  }

  locateBase(stationId: string, zoom = 12): void {
    const st = this.#graph.station(stationId);
    this.selectStation(stationId);
    this.#map?.easeTo({ center: st.coordinates, zoom, duration: 300 });
  }

  setZoom(zoom: number): void {
    this.#map?.jumpTo({ zoom });
    this.syncViewportLayers(true);
  }

  zoomIn(): void {
    this.#map?.zoomIn({ duration: 150 });
  }

  zoomOut(): void {
    this.#map?.zoomOut({ duration: 150 });
  }

  resetCamera(): void {
    this.#followingTrainId = null;
    this.#map?.jumpTo({ center: this.#initialCenter, zoom: this.#initialZoom, bearing: 0, pitch: 0 });
    this.syncViewportLayers(true);
  }

  resize(): void {
    this.#map?.resize();
  }

  setLayerGroupVisibility(group: MapLayerGroup, visible: boolean): void {
    // Reject enabling boundary view unless Survey of India contract is actually approved
    if (group === 'boundary' && visible && !(this.#boundary.assetAcquired && this.#boundary.approvedForPoliticalView)) {
      this.#layerVisibility.boundary = false;
      this.#onInteraction?.({ type: 'layer_toggle', group: 'boundary', visible: false });
      return;
    }
    this.#layerVisibility[group] = visible;
    if (this.#map) {
      const vis = visible ? 'visible' : 'none';
      for (const lid of LAYER_GROUP_MAP[group]) {
        if (this.#map.getLayer(lid)) {
          this.#map.setLayoutProperty(lid, 'visibility', vis);
        }
      }
    }
    this.#onInteraction?.({ type: 'layer_toggle', group, visible });
  }

  /**
   * Project authoritative R33 movement inspection snapshot onto curved track coordinates & headings,
   * optionally applying read-only visual delta (visualDeltaM) between simulation ticks without altering engine state.
   */
  updateTrainStates(
    profilesByPlanId: ReadonlyMap<string, RouteGeometryProfile>,
    inspection: MovementInspectionLike,
    visualDeltaByTrainId?: ReadonlyMap<string, number>,
  ): readonly ProjectedTrainState[] {
    const baseProjected = projectMovementInspection(this.#graph, profilesByPlanId, inspection);
    const visualStates = baseProjected.map((st) => {
      const deltaM = visualDeltaByTrainId?.get(st.trainId) ?? 0;
      const profile = profilesByPlanId.get(st.planId);
      if (st.status === 'RUNNING' && deltaM !== 0 && profile) {
        const clamped = Math.min(profile.totalDistanceM, Math.max(0, st.distanceM + deltaM));
        const pos = interpolateRoutePosition(profile, clamped);
        return Object.freeze({
          ...st,
          coordinates: pos.coordinates,
          headingDeg: pos.headingDeg,
          routeProgress: pos.progress,
        });
      }
      return st;
    });

    this.#lastTrains = visualStates;
    this.syncTrainLayers();

    if (this.#followingTrainId && this.#map) {
      const tracked = visualStates.find((t) => t.trainId === this.#followingTrainId);
      if (tracked) {
        this.#map.jumpTo({ center: tracked.coordinates });
      }
    }
    return Object.freeze(visualStates);
  }

  private syncTrainLayers(): void {
    if (!this.#map || this.#state === 'DISPOSED') return;
    const trainFeatures = this.#lastTrains.map((t) => ({
      type: 'Feature',
      id: t.trainId,
      geometry: { type: 'Point', coordinates: t.coordinates },
      properties: {
        tripId: t.tripId,
        trainId: t.trainId,
        planId: t.planId,
        status: t.status,
        headingDeg: t.headingDeg,
        routeProgress: t.routeProgress,
        speedMmPerS: t.speedMmPerS,
      },
    }));
    this.#map.getSource('c03-trains')?.setData({ type: 'FeatureCollection', features: trainFeatures });

    const sel = this.#selectedTrainId
      ? trainFeatures.filter((f) => f.properties.trainId === this.#selectedTrainId)
      : [];
    this.#map.getSource('c03-train-selected')?.setData({ type: 'FeatureCollection', features: sel });
  }

  private syncDynamicOverlays(): void {
    if (!this.#map || this.#state === 'DISPOSED') return;

    const routeFeatures = this.#companyRoutes.map((r) => ({
      type: 'Feature',
      id: r.routeId,
      geometry: { type: 'LineString', coordinates: r.coordinates },
      properties: { routeId: r.routeId, name: r.name, colorHex: r.colorHex },
    }));
    this.#map.getSource('c03-company-routes')?.setData({ type: 'FeatureCollection', features: routeFeatures });

    const selRoute = this.#selectedRouteId
      ? routeFeatures.filter((f) => f.properties.routeId === this.#selectedRouteId)
      : [];
    this.#map.getSource('c03-route-selected')?.setData({ type: 'FeatureCollection', features: selRoute });

    const yardFeatures = this.#companyYards.map((y) => ({
      type: 'Feature',
      id: y.yardId,
      geometry: { type: 'Point', coordinates: y.coordinates },
      properties: { yardId: y.yardId, baseId: y.baseId, stationId: y.stationId, name: y.name },
    }));
    this.#map.getSource('c03-company-yards')?.setData({ type: 'FeatureCollection', features: yardFeatures });

    if (this.#selectedStationId) {
      let stCoords: Coord | null = null;
      let stName = this.#selectedStationId;
      try {
        const st = this.#graph.station(this.#selectedStationId);
        stCoords = st.coordinates;
        stName = st.name;
      } catch {
        stCoords = null;
      }
      if (stCoords) {
        const stFeat = [{
          type: 'Feature',
          id: this.#selectedStationId,
          geometry: { type: 'Point', coordinates: stCoords },
          properties: { id: this.#selectedStationId, name: stName },
        }];
        this.#map.getSource('c03-station-selected')?.setData({ type: 'FeatureCollection', features: stFeat });
        this.#map.getSource('c03-feedback')?.setData({ type: 'FeatureCollection', features: stFeat });
      }
    } else {
      this.#map.getSource('c03-station-selected')?.setData(emptyFc());
      this.#map.getSource('c03-feedback')?.setData(emptyFc());
    }

    this.syncTrainLayers();
  }

  dispose(): void {
    if (this.#state === 'DISPOSED') return;
    this.#state = 'DISPOSED';
    this.#statusReason = 'DISPOSED';
    try {
      this.#map?.remove();
    } finally {
      this.#map = null;
    }
  }
}
