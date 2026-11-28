import type { TrainProfile } from '../../domain/models';
import { RailGraph } from '../graph';
import { findRoute, type RouteResult } from '../routing';
import {
  decodeRegionPortal,
  decodeRegionPortalSet,
  type InstalledVersionRecord,
  type RegionPortal,
  type RegionPortalSet,
} from './contracts';

export const DEFAULT_MAX_PORTAL_SEAM_DISTANCE_M = 500;

export type PortalVerificationCode =
  | 'PORTAL_VERIFIED'
  | 'UNAVAILABLE_DESTINATION_REGION'
  | 'PORTAL_UNVERIFIED'
  | 'PORTAL_GRAPH_VERSION_MISMATCH'
  | 'PORTAL_ENDPOINT_MISSING'
  | 'PORTAL_DIRECTION_FORBIDDEN'
  | 'PORTAL_GAUGE_MISMATCH'
  | 'PORTAL_ELECTRIFICATION_MISMATCH'
  | 'PORTAL_SEAM_DISTANCE_EXCEEDED';

export interface PortalResolutionResult {
  readonly ok: boolean;
  readonly code: PortalVerificationCode;
  readonly reason: string;
  readonly portalId: string;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly sourceGraphSha256: string | null;
  readonly destinationGraphSha256: string | null;
  readonly fabricatedEdgeCount: 0;
}

function hasIntersection(a: readonly number[], b: readonly number[]): boolean {
  const setB = new Set(b);
  return a.some((v) => setB.has(v));
}

function checkPortalProfileCompatibility(portal: RegionPortal, profile?: TrainProfile): PortalResolutionResult | null {
  if (!profile) return null;
  if (!hasIntersection(profile.gaugesMm, portal.gaugesMm)) {
    return {
      ok: false,
      code: 'PORTAL_GAUGE_MISMATCH',
      reason: `Train gauges [${profile.gaugesMm.join(',')}] incompatible with portal gauges [${portal.gaugesMm.join(',')}]`,
      portalId: portal.id,
      fromRegionId: portal.regionAId,
      toRegionId: portal.regionBId,
      sourceGraphSha256: portal.graphASha256,
      destinationGraphSha256: portal.graphBSha256,
      fabricatedEdgeCount: 0,
    };
  }
  if (profile.traction === 'electric' && portal.electrification !== 'yes') {
    return {
      ok: false,
      code: 'PORTAL_ELECTRIFICATION_MISMATCH',
      reason: `Electric locomotive cannot cross non-electrified/unknown portal (${portal.electrification})`,
      portalId: portal.id,
      fromRegionId: portal.regionAId,
      toRegionId: portal.regionBId,
      sourceGraphSha256: portal.graphASha256,
      destinationGraphSha256: portal.graphBSha256,
      fabricatedEdgeCount: 0,
    };
  }
  if (profile.traction === 'electric' && portal.electrification === 'yes') {
    if (!hasIntersection(profile.voltagesV, portal.voltagesV) || !hasIntersection(profile.frequenciesHz, portal.frequenciesHz)) {
      return {
        ok: false,
        code: 'PORTAL_ELECTRIFICATION_MISMATCH',
        reason: `Electric voltage/frequency mismatch across portal ${portal.id}`,
        portalId: portal.id,
        fromRegionId: portal.regionAId,
        toRegionId: portal.regionBId,
        sourceGraphSha256: portal.graphASha256,
        destinationGraphSha256: portal.graphBSha256,
        fabricatedEdgeCount: 0,
      };
    }
  }
  return null;
}

/**
 * Strictly validate an explicit declared border portal between two authoritative RailGraph versions.
 * Never fabricates edges across nearby border stations without an explicit verified portal entry.
 */
export function resolvePortalBetweenGraphs(options: {
  readonly portal: RegionPortal;
  readonly direction: 'A_TO_B' | 'B_TO_A';
  readonly graphA: RailGraph | null | undefined;
  readonly graphB: RailGraph | null | undefined;
  readonly trainProfile?: TrainProfile;
  readonly maxSeamDistanceM?: number;
}): PortalResolutionResult {
  const portal = decodeRegionPortal(options.portal);
  const maxSeam = options.maxSeamDistanceM ?? DEFAULT_MAX_PORTAL_SEAM_DISTANCE_M;
  const fromRegion = options.direction === 'A_TO_B' ? portal.regionAId : portal.regionBId;
  const toRegion = options.direction === 'A_TO_B' ? portal.regionBId : portal.regionAId;

  if (!portal.verified) {
    return {
      ok: false,
      code: 'PORTAL_UNVERIFIED',
      reason: `Portal ${portal.id} is marked unverified`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: null,
      destinationGraphSha256: null,
      fabricatedEdgeCount: 0,
    };
  }

  if (portal.allowedDirection !== 'BOTH' && portal.allowedDirection !== options.direction) {
    return {
      ok: false,
      code: 'PORTAL_DIRECTION_FORBIDDEN',
      reason: `Portal ${portal.id} does not permit direction ${options.direction} (allowed=${portal.allowedDirection})`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: portal.graphASha256,
      destinationGraphSha256: portal.graphBSha256,
      fabricatedEdgeCount: 0,
    };
  }

  if (portal.seamDistanceM > maxSeam) {
    return {
      ok: false,
      code: 'PORTAL_SEAM_DISTANCE_EXCEEDED',
      reason: `Portal ${portal.id} seam distance ${portal.seamDistanceM}m exceeds cap ${maxSeam}m`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: portal.graphASha256,
      destinationGraphSha256: portal.graphBSha256,
      fabricatedEdgeCount: 0,
    };
  }

  if (!options.graphA || !options.graphB) {
    return {
      ok: false,
      code: 'UNAVAILABLE_DESTINATION_REGION',
      reason: `Cannot connect portal ${portal.id}: ${!options.graphA ? portal.regionAId : portal.regionBId} is not installed/activated`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: options.graphA?.graphSha256 ?? null,
      destinationGraphSha256: options.graphB?.graphSha256 ?? null,
      fabricatedEdgeCount: 0,
    };
  }

  if (
    options.graphA.regionId !== portal.regionAId ||
    options.graphB.regionId !== portal.regionBId ||
    options.graphA.graphSha256 !== portal.graphASha256 ||
    options.graphB.graphSha256 !== portal.graphBSha256
  ) {
    return {
      ok: false,
      code: 'PORTAL_GRAPH_VERSION_MISMATCH',
      reason: `Portal ${portal.id} expects graphs (${portal.regionAId}@${portal.graphASha256.slice(0, 8)}, ${portal.regionBId}@${portal.graphBSha256.slice(0, 8)}) but found (${options.graphA.regionId}@${options.graphA.graphSha256.slice(0, 8)}, ${options.graphB.regionId}@${options.graphB.graphSha256.slice(0, 8)})`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: options.graphA.graphSha256,
      destinationGraphSha256: options.graphB.graphSha256,
      fabricatedEdgeCount: 0,
    };
  }

  let stAOk = false;
  let stBOk = false;
  try {
    const stA = options.graphA.station(portal.stationAId);
    const nA = options.graphA.node(portal.nodeAId);
    stAOk = stA.nodeIds.includes(nA.id);
    const stB = options.graphB.station(portal.stationBId);
    const nB = options.graphB.node(portal.nodeBId);
    stBOk = stB.nodeIds.includes(nB.id);
  } catch {
    stAOk = false;
  }

  if (!stAOk || !stBOk) {
    return {
      ok: false,
      code: 'PORTAL_ENDPOINT_MISSING',
      reason: `Portal ${portal.id} endpoint station/node missing or unattached in target graph`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: options.graphA.graphSha256,
      destinationGraphSha256: options.graphB.graphSha256,
      fabricatedEdgeCount: 0,
    };
  }

  // Verify adjoining tracks near portal endpoints actually support the portal's declared gauges & electrification
  const adjA = [
    ...options.graphA.outgoing(portal.nodeAId),
    ...options.graphA.incoming(portal.nodeAId),
  ];
  const adjB = [
    ...options.graphB.outgoing(portal.nodeBId),
    ...options.graphB.incoming(portal.nodeBId),
  ];
  const aGaugeOk = adjA.some((e) => e.gaugeMm !== null && hasIntersection(e.gaugeMm, portal.gaugesMm));
  const bGaugeOk = adjB.some((e) => e.gaugeMm !== null && hasIntersection(e.gaugeMm, portal.gaugesMm));
  if (!aGaugeOk || !bGaugeOk) {
    return {
      ok: false,
      code: 'PORTAL_GAUGE_MISMATCH',
      reason: `Portal ${portal.id} endpoint track gauges do not intersect portal gauges [${portal.gaugesMm.join(',')}]`,
      portalId: portal.id,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
      sourceGraphSha256: options.graphA.graphSha256,
      destinationGraphSha256: options.graphB.graphSha256,
      fabricatedEdgeCount: 0,
    };
  }

  if (portal.electrification === 'yes') {
    const aElOk = adjA.some((e) => e.electrification === 'yes');
    const bElOk = adjB.some((e) => e.electrification === 'yes');
    if (!aElOk || !bElOk) {
      return {
        ok: false,
        code: 'PORTAL_ELECTRIFICATION_MISMATCH',
        reason: `Portal ${portal.id} declares electrification=yes but adjoining track edge is non-electrified/unknown`,
        portalId: portal.id,
        fromRegionId: fromRegion,
        toRegionId: toRegion,
        sourceGraphSha256: options.graphA.graphSha256,
        destinationGraphSha256: options.graphB.graphSha256,
        fabricatedEdgeCount: 0,
      };
    }
  }

  const profileIssue = checkPortalProfileCompatibility(portal, options.trainProfile);
  if (profileIssue) {
    return {
      ...profileIssue,
      fromRegionId: fromRegion,
      toRegionId: toRegion,
    };
  }

  return {
    ok: true,
    code: 'PORTAL_VERIFIED',
    reason: `Verified explicit portal ${portal.id} (${fromRegion} -> ${toRegion})`,
    portalId: portal.id,
    fromRegionId: fromRegion,
    toRegionId: toRegion,
    sourceGraphSha256: options.graphA.graphSha256,
    destinationGraphSha256: options.graphB.graphSha256,
    fabricatedEdgeCount: 0,
  };
}

export interface CrossRegionPlanResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly portalResult: PortalResolutionResult;
  readonly originLeg?: RouteResult;
  readonly destinationLeg?: RouteResult;
  readonly pinnedVersions?: readonly string[];
  readonly totalDistanceM?: number;
  readonly totalExpectedDurationS?: number;
}

/**
 * Plan a verified cross-region journey across an explicitly declared portal without stitching
 * raw graphs or inventing synthetic geometry edges across borders.
 */
export async function planCrossRegionPortalJourney(options: {
  readonly portal: RegionPortal;
  readonly activeVersions: ReadonlyMap<string, InstalledVersionRecord>;
  readonly graphsByRegionId: ReadonlyMap<string, RailGraph>;
  readonly originStationId: string;
  readonly destinationStationId: string;
  readonly profile: TrainProfile;
  readonly profileSha256: string;
  readonly policy: {
    readonly schemaVersion: 1;
    readonly mode: 'Easy' | 'Realism';
    readonly allowReversal: boolean;
    readonly inferences: readonly never[];
    readonly modeChanges: readonly never[];
  };
  readonly policySha256: string;
}): Promise<CrossRegionPlanResult> {
  const portal = decodeRegionPortal(options.portal);
  const graphA = options.graphsByRegionId.get(portal.regionAId);
  const graphB = options.graphsByRegionId.get(portal.regionBId);

  const portalResult = resolvePortalBetweenGraphs({
    portal,
    direction: 'A_TO_B',
    graphA,
    graphB,
    trainProfile: options.profile,
  });
  if (!portalResult.ok || !graphA || !graphB) {
    return {
      ok: false,
      reason: portalResult.reason,
      portalResult,
    };
  }

  const initialOp =
    options.profile.traction === 'electric'
      ? {
          mode: 'electric' as const,
          gaugeMm: options.profile.gaugesMm[0],
          voltageV: options.profile.voltagesV[0],
          frequencyHz: options.profile.frequenciesHz[0],
        }
      : {
          mode: 'diesel' as const,
          gaugeMm: options.profile.gaugesMm[0],
          voltageV: null,
          frequencyHz: null,
        };

  const legA = await findRoute(graphA, {
    routeId: `cross:${portal.id}:legA`,
    graphSha256: graphA.graphSha256,
    trainProfileSha256: options.profileSha256,
    policySha256: options.policySha256,
    profile: options.profile,
    policy: options.policy,
    stopIds: [options.originStationId, portal.stationAId],
    objective: 'distance',
    initialOperating: initialOp,
    maxLabels: 10000,
    maxWork: 50000,
  });
  if (!legA.ok) {
    return {
      ok: false,
      reason: `Origin leg route failed inside ${portal.regionAId}: ${legA.code} (${legA.reason})`,
      portalResult,
      originLeg: legA,
    };
  }

  const legB = await findRoute(graphB, {
    routeId: `cross:${portal.id}:legB`,
    graphSha256: graphB.graphSha256,
    trainProfileSha256: options.profileSha256,
    policySha256: options.policySha256,
    profile: options.profile,
    policy: options.policy,
    stopIds: [portal.stationBId, options.destinationStationId],
    objective: 'distance',
    initialOperating: initialOp,
    maxLabels: 10000,
    maxWork: 50000,
  });
  if (!legB.ok) {
    return {
      ok: false,
      reason: `Destination leg route failed inside ${portal.regionBId}: ${legB.code} (${legB.reason})`,
      portalResult,
      originLeg: legA,
      destinationLeg: legB,
    };
  }

  const verA = options.activeVersions.get(portal.regionAId);
  const verB = options.activeVersions.get(portal.regionBId);
  const pinnedVersions = [verA?.versionKey, verB?.versionKey].filter((v): v is string => Boolean(v));

  return {
    ok: true,
    reason: `Cross-region journey verified via ${portal.id}`,
    portalResult,
    originLeg: legA,
    destinationLeg: legB,
    pinnedVersions,
    totalDistanceM: legA.route.distanceM + legB.route.distanceM + portal.seamDistanceM,
    totalExpectedDurationS: legA.route.expectedDurationS + legB.route.expectedDurationS,
  };
}

/** Decode and filter portals belonging strictly to an installed region version. */
export function filterVerifiedPortalsForRegion(
  portalSetInput: unknown,
  regionId: string,
  graphSha256: string,
): RegionPortalSet {
  const decoded = decodeRegionPortalSet(portalSetInput);
  const matching = decoded.portals.filter(
    (p) => (p.regionAId === regionId && p.graphASha256 === graphSha256) || (p.regionBId === regionId && p.graphBSha256 === graphSha256),
  );
  return {
    schemaVersion: 1,
    portalSetId: decoded.portalSetId,
    portals: matching,
  };
}
