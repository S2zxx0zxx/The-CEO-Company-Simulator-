import type { Coord } from '../../domain/models';
import { RailGraph, type GraphEdge, type ReadonlyTree } from '../graph';
import type { RouteSuccess } from '../routing';

export interface EdgeDistances {
  readonly segmentDistancesM: readonly number[];
  readonly cumulativeGeomM: readonly number[];
  readonly totalGeomM: number;
}

export interface EdgePosition {
  readonly coordinates: readonly [number, number];
  readonly headingDeg: number;
  readonly distanceAlongEdgeM: number;
  readonly segmentIndex: number;
  readonly progress: number;
}

export interface RouteStopPosition {
  readonly stopIndex: number;
  readonly stationId: string;
  readonly nodeId: string;
  readonly distanceM: number;
  readonly coordinates: readonly [number, number];
  readonly headingDeg: number;
}

export interface RouteSegmentSpan {
  readonly stepIndex: number;
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly startDistanceM: number;
  readonly endDistanceM: number;
  readonly lengthM: number;
  readonly geometry: readonly Coord[];
  readonly cumulativeGeomM: readonly number[];
  readonly totalGeomM: number;
}

export interface RouteGeometryProfile {
  readonly routeId: string;
  readonly graphSha256: string;
  readonly totalDistanceM: number;
  readonly spans: readonly RouteSegmentSpan[];
  readonly stopPositions: readonly RouteStopPosition[];
}

export interface RouteInterpolatedPosition {
  readonly coordinates: readonly [number, number];
  readonly headingDeg: number;
  readonly routeDistanceM: number;
  readonly edgeDistanceM: number;
  readonly progress: number;
  readonly edgeId: string;
  readonly stepIndex: number;
  readonly segmentIndex: number;
  readonly atNodeId: string | null;
}

export interface MovementInspectionTripLike {
  readonly tripId: string;
  readonly trainId: string;
  readonly planId: string;
  readonly status: 'RESERVED' | 'RUNNING' | 'DWELL' | 'ARRIVED';
  readonly nodeId: string | null;
  readonly edgeId: string | null;
  readonly stationId: string | null;
  readonly distanceM: number;
  readonly edgeDistanceM: number;
  readonly speedMmPerS: number;
  readonly arrivalSimS: number | null;
}

export interface MovementInspectionLike {
  readonly simTimeS: number;
  readonly trips: readonly MovementInspectionTripLike[];
}

export interface ProjectedTrainState {
  readonly tripId: string;
  readonly trainId: string;
  readonly planId: string;
  readonly status: 'RESERVED' | 'RUNNING' | 'DWELL' | 'ARRIVED';
  readonly coordinates: readonly [number, number];
  readonly headingDeg: number;
  readonly distanceM: number;
  readonly edgeDistanceM: number;
  readonly routeProgress: number;
  readonly speedMmPerS: number;
  readonly edgeId: string | null;
  readonly nodeId: string | null;
  readonly stationId: string | null;
  readonly arrivalSimS: number | null;
}

const EARTH_RADIUS_M = 6371000.0;
const RAD = Math.PI / 180.0;

/** WGS84 spherical Haversine geodesic distance in metres between [lon, lat] points. */
export function geodesicDistanceM(a: Coord, b: Coord): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

/** Forward compass bearing in degrees [0, 360) from [lon, lat] a to b. */
export function bearingDeg(a: Coord, b: Coord): number {
  if (a[0] === b[0] && a[1] === b[1]) return 0;
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Compute segment & cumulative geodesic distances along an ordered polyline. */
export function polylineCumulativeDistances(geometry: readonly Coord[]): EdgeDistances {
  if (!Array.isArray(geometry) || geometry.length < 2) {
    throw new TypeError('Route geometry: polyline must have at least 2 points');
  }
  const segs: number[] = [];
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < geometry.length; i++) {
    const d = geodesicDistanceM(geometry[i - 1], geometry[i]);
    if (d <= 0) {
      throw new TypeError('Route geometry: zero-length polyline segment');
    }
    segs.push(d);
    total += d;
    cum.push(total);
  }
  return Object.freeze({
    segmentDistancesM: Object.freeze(segs),
    cumulativeGeomM: Object.freeze(cum),
    totalGeomM: total,
  });
}

function interpolateOnPolyline(
  geometry: readonly Coord[],
  cumulativeGeomM: readonly number[],
  totalGeomM: number,
  declaredLengthM: number,
  distanceAlongM: number,
): { coordinates: readonly [number, number]; headingDeg: number; segmentIndex: number; progress: number } {
  if (distanceAlongM < 0 || distanceAlongM > declaredLengthM || !Number.isFinite(distanceAlongM)) {
    throw new RangeError(`Distance ${distanceAlongM} out of bounds [0, ${declaredLengthM}]`);
  }
  const progress = declaredLengthM === 0 ? 0 : distanceAlongM / declaredLengthM;
  if (distanceAlongM === 0) {
    return {
      coordinates: [geometry[0][0], geometry[0][1]] as const,
      headingDeg: bearingDeg(geometry[0], geometry[1]),
      segmentIndex: 0,
      progress: 0,
    };
  }
  if (distanceAlongM === declaredLengthM) {
    const last = geometry.length - 1;
    return {
      coordinates: [geometry[last][0], geometry[last][1]] as const,
      headingDeg: bearingDeg(geometry[last - 1], geometry[last]),
      segmentIndex: last - 1,
      progress: 1,
    };
  }

  const targetGeomM = progress * totalGeomM;
  // Binary search cumulativeGeomM
  let lo = 0;
  let hi = geometry.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulativeGeomM[mid + 1] < targetGeomM) lo = mid + 1;
    else hi = mid;
  }

  const segStart = cumulativeGeomM[lo];
  const segEnd = cumulativeGeomM[lo + 1];
  const segLen = segEnd - segStart;
  const frac = segLen <= 0 ? 0 : Math.min(1, Math.max(0, (targetGeomM - segStart) / segLen));
  const p0 = geometry[lo];
  const p1 = geometry[lo + 1];
  const lon = p0[0] + (p1[0] - p0[0]) * frac;
  const lat = p0[1] + (p1[1] - p0[1]) * frac;
  return {
    coordinates: [lon, lat] as const,
    headingDeg: bearingDeg(p0, p1),
    segmentIndex: lo,
    progress,
  };
}

/** Interpolate coordinate and compass heading along a single GraphEdge (forward or logical reverse). */
export function interpolateEdgePosition(
  edge: GraphEdge,
  distanceAlongEdgeM: number,
  reverse = false,
): EdgePosition {
  const geom: readonly Coord[] = reverse ? [...edge.geometry].reverse() : edge.geometry;
  const { cumulativeGeomM, totalGeomM } = polylineCumulativeDistances(geom);
  const res = interpolateOnPolyline(geom, cumulativeGeomM, totalGeomM, edge.lengthM, distanceAlongEdgeM);
  return Object.freeze({
    coordinates: res.coordinates,
    headingDeg: res.headingDeg,
    distanceAlongEdgeM,
    segmentIndex: res.segmentIndex,
    progress: res.progress,
  });
}

/** Build an ordered, edge-continuous route geometry profile from an immutable RailGraph and RouteSuccess. */
export function buildRouteGeometryProfile(graph: RailGraph, route: RouteSuccess): RouteGeometryProfile {
  if (!(graph instanceof RailGraph)) {
    throw new TypeError('Expected validated RailGraph');
  }
  if (!route || !route.ok || route.route.graphSha256 !== graph.graphSha256) {
    throw new TypeError('Route profile: stale or invalid RouteSuccess');
  }
  if (route.steps.length === 0) {
    throw new TypeError('Route profile: empty route steps');
  }

  const spans: RouteSegmentSpan[] = [];
  const stopPositions: RouteStopPosition[] = [];
  let cumulativeM = 0;

  // Origin stop at distance 0
  const firstStep = route.steps[0];
  const firstEdge = graph.edge(firstStep.edgeId);
  stopPositions.push(
    Object.freeze({
      stopIndex: 0,
      stationId: route.route.stopIds[0],
      nodeId: firstStep.from,
      distanceM: 0,
      coordinates: [firstEdge.geometry[0][0], firstEdge.geometry[0][1]] as const,
      headingDeg: bearingDeg(firstEdge.geometry[0], firstEdge.geometry[1]),
    }),
  );

  let nextStopIdx = 1;
  for (let i = 0; i < route.steps.length; i++) {
    const step = route.steps[i];
    const edge = graph.edge(step.edgeId);
    if (edge.from !== step.from || edge.to !== step.to) {
      throw new TypeError(`Route profile: edge endpoint mismatch at step ${i}`);
    }
    if (i > 0 && spans[i - 1].to !== edge.from) {
      throw new TypeError(`Route profile: discontinuous edge transition at step ${i}`);
    }
    const { cumulativeGeomM, totalGeomM } = polylineCumulativeDistances(edge.geometry);
    const startM = cumulativeM;
    const endM = startM + edge.lengthM;
    spans.push(
      Object.freeze({
        stepIndex: i,
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
        startDistanceM: startM,
        endDistanceM: endM,
        lengthM: edge.lengthM,
        geometry: edge.geometry,
        cumulativeGeomM,
        totalGeomM,
      }),
    );
    cumulativeM = endM;

    if (nextStopIdx < route.stopAnchors.length && edge.to === route.stopAnchors[nextStopIdx]) {
      const lastPtIdx = edge.geometry.length - 1;
      stopPositions.push(
        Object.freeze({
          stopIndex: nextStopIdx,
          stationId: route.route.stopIds[nextStopIdx],
          nodeId: edge.to,
          distanceM: cumulativeM,
          coordinates: [edge.geometry[lastPtIdx][0], edge.geometry[lastPtIdx][1]] as const,
          headingDeg: bearingDeg(edge.geometry[lastPtIdx - 1], edge.geometry[lastPtIdx]),
        }),
      );
      nextStopIdx++;
    }
  }

  if (cumulativeM !== route.route.distanceM) {
    throw new TypeError(`Route profile: total distance mismatch (${cumulativeM} vs ${route.route.distanceM})`);
  }
  if (nextStopIdx !== route.stopAnchors.length) {
    throw new TypeError('Route profile: missing stop anchor along route steps');
  }

  return Object.freeze({
    routeId: route.route.id,
    graphSha256: route.route.graphSha256,
    totalDistanceM: cumulativeM,
    spans: Object.freeze(spans),
    stopPositions: Object.freeze(stopPositions),
  });
}

/** Interpolate exact position, heading, active edge, and route progress for any distance along route. */
export function interpolateRoutePosition(
  profile: RouteGeometryProfile,
  routeDistanceM: number,
): RouteInterpolatedPosition {
  if (!Number.isFinite(routeDistanceM) || routeDistanceM < 0 || routeDistanceM > profile.totalDistanceM) {
    throw new RangeError(
      `Route distance ${routeDistanceM} out of bounds [0, ${profile.totalDistanceM}]`,
    );
  }

  const spans = profile.spans;
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].endDistanceM < routeDistanceM) lo = mid + 1;
    else hi = mid;
  }

  const span = spans[lo];
  const localDist = Math.min(span.lengthM, Math.max(0, routeDistanceM - span.startDistanceM));
  const res = interpolateOnPolyline(
    span.geometry,
    span.cumulativeGeomM,
    span.totalGeomM,
    span.lengthM,
    localDist,
  );
  const atNodeId = localDist === 0 ? span.from : localDist === span.lengthM ? span.to : null;

  return Object.freeze({
    coordinates: res.coordinates,
    headingDeg: res.headingDeg,
    routeDistanceM,
    edgeDistanceM: localDist,
    progress: profile.totalDistanceM === 0 ? 1 : routeDistanceM / profile.totalDistanceM,
    edgeId: span.edgeId,
    stepIndex: span.stepIndex,
    segmentIndex: res.segmentIndex,
    atNodeId,
  });
}

/** Deterministically sample route geometry at regular metre intervals (including exact endpoints). */
export function sampleRouteGeometry(
  profile: RouteGeometryProfile,
  intervalM: number,
): readonly RouteInterpolatedPosition[] {
  if (!Number.isFinite(intervalM) || intervalM <= 0) {
    throw new RangeError('sampleRouteGeometry requires positive intervalM');
  }
  const samples: RouteInterpolatedPosition[] = [];
  let d = 0;
  while (d < profile.totalDistanceM) {
    samples.push(interpolateRoutePosition(profile, d));
    d += intervalM;
  }
  samples.push(interpolateRoutePosition(profile, profile.totalDistanceM));
  return Object.freeze(samples);
}

/**
 * Project R33 prepareMovement().inspect() snapshots onto curved polyline coordinates without
 * creating an alternate simulation clock or altering integer physics authority.
 */
export function projectMovementInspection(
  graph: RailGraph,
  profilesByPlanId: ReadonlyMap<string, RouteGeometryProfile>,
  inspection: MovementInspectionLike,
): ReadonlyTree<readonly ProjectedTrainState[]> {
  if (!(graph instanceof RailGraph)) {
    throw new TypeError('Expected validated RailGraph');
  }
  const out: ProjectedTrainState[] = [];
  for (const trip of inspection.trips) {
    const profile = profilesByPlanId.get(trip.planId);
    if (profile && trip.distanceM >= 0 && trip.distanceM <= profile.totalDistanceM) {
      const pos = interpolateRoutePosition(profile, trip.distanceM);
      out.push(
        Object.freeze({
          tripId: trip.tripId,
          trainId: trip.trainId,
          planId: trip.planId,
          status: trip.status,
          coordinates: pos.coordinates,
          headingDeg: pos.headingDeg,
          distanceM: trip.distanceM,
          edgeDistanceM: trip.edgeDistanceM,
          routeProgress: pos.progress,
          speedMmPerS: trip.speedMmPerS,
          edgeId: trip.edgeId,
          nodeId: trip.nodeId,
          stationId: trip.stationId,
          arrivalSimS: trip.arrivalSimS,
        }),
      );
      continue;
    }

    if (trip.edgeId) {
      const edge = graph.edge(trip.edgeId);
      const pos = interpolateEdgePosition(edge, trip.edgeDistanceM);
      out.push(
        Object.freeze({
          tripId: trip.tripId,
          trainId: trip.trainId,
          planId: trip.planId,
          status: trip.status,
          coordinates: pos.coordinates,
          headingDeg: pos.headingDeg,
          distanceM: trip.distanceM,
          edgeDistanceM: trip.edgeDistanceM,
          routeProgress: pos.progress,
          speedMmPerS: trip.speedMmPerS,
          edgeId: trip.edgeId,
          nodeId: trip.nodeId,
          stationId: trip.stationId,
          arrivalSimS: trip.arrivalSimS,
        }),
      );
      continue;
    }

    if (!trip.nodeId) {
      throw new TypeError(`Cannot project movement trip without nodeId or edgeId: ${trip.tripId}`);
    }
    const node = graph.node(trip.nodeId);
    out.push(
      Object.freeze({
        tripId: trip.tripId,
        trainId: trip.trainId,
        planId: trip.planId,
        status: trip.status,
        coordinates: [node.coordinates[0], node.coordinates[1]] as const,
        headingDeg: 0,
        distanceM: trip.distanceM,
        edgeDistanceM: 0,
        routeProgress: trip.status === 'ARRIVED' ? 1 : 0,
        speedMmPerS: trip.speedMmPerS,
        edgeId: null,
        nodeId: trip.nodeId,
        stationId: trip.stationId,
        arrivalSimS: trip.arrivalSimS,
      }),
    );
  }
  return Object.freeze(out);
}
