import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeTrainProfile } from '../../domain/models';
import { metres } from '../../domain/units';
import type { OperatingMode } from '../compatibility';
import {
  evaluateCrossRegionOracleJourney,
} from '../c06-oracle/harness';
import {
  MemoryRegionStorageBackend,
  RegionInstallationManager,
  resolvePortalBetweenGraphs,
  type RegionPortal,
} from '../regions';

export interface C07CrossRegionCheckItem {
  readonly checkId: string;
  readonly passed: boolean;
  readonly expectedCode: string;
  readonly actualCode: string;
  readonly fabricatedEdges: number;
  readonly verificationScope: 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY';
  readonly independentJavaSegmentVerificationExecuted: false;
  readonly pinnedVersions: readonly string[];
  readonly totalDistanceM: number | null;
  readonly notes: string;
}

export interface C07CrossRegionValidationReport {
  readonly schemaVersion: 1;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly verificationScope: 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY';
  readonly nativeMultiRegionOracleSupported: false;
  readonly independentJavaSegmentVerificationExecuted: false;
  readonly zeroFabricatedEdgesVerified: boolean;
  readonly results: readonly C07CrossRegionCheckItem[];
}

export async function runC07CrossRegionValidation(fixturesRegionsDir = path.resolve('fixtures/c05_regions')): Promise<C07CrossRegionValidationReport> {
  const idxData = JSON.parse(readFileSync(path.join(fixturesRegionsDir, 'trusted_region_index.json'), 'utf8'));
  const loadPkg = (slug: string) => {
    const dir = path.join(fixturesRegionsDir, slug);
    return {
      envelope: JSON.parse(readFileSync(path.join(dir, 'package_envelope.json'), 'utf8')),
      async getEntryBytes(rel: string) {
        return new Uint8Array(readFileSync(path.join(dir, rel)));
      },
    };
  };

  const policyNoRev = {
    schemaVersion: 1 as const,
    mode: 'Realism' as const,
    allowReversal: false,
    inferences: [] as const,
    modeChanges: [] as const,
  };

  const trainAc25k = decodeTrainProfile({
    id: 'tr-c07-cr-ac25k',
    traction: 'electric',
    gaugesMm: [1676],
    voltagesV: [25000],
    frequenciesHz: [50],
    maxSpeedKmh: 120,
    rangeM: 500000,
    massKg: 420000,
  });
  const trainDiesel1676 = decodeTrainProfile({
    id: 'tr-c07-cr-diesel-1676',
    traction: 'diesel',
    gaugesMm: [1676],
    voltagesV: [],
    frequenciesHz: [],
    maxSpeedKmh: 100,
    rangeM: 500000,
    massKg: 130000,
  });
  const trainDiesel1435 = decodeTrainProfile({
    id: 'tr-c07-cr-diesel-1435',
    traction: 'diesel',
    gaugesMm: [1435],
    voltagesV: [],
    frequenciesHz: [],
    maxSpeedKmh: 100,
    rangeM: 500000,
    massKg: 120000,
  });
  const trainDc1500 = decodeTrainProfile({
    id: 'tr-c07-cr-dc1500',
    traction: 'electric',
    gaugesMm: [1676],
    voltagesV: [1500],
    frequenciesHz: [0],
    maxSpeedKmh: 100,
    rangeM: 500000,
    massKg: 350000,
  });

  const items: C07CrossRegionCheckItem[] = [];

  // 1. Unavailable destination region before north install
  const backend1 = new MemoryRegionStorageBackend({ totalQuotaBytes: 64 * 1024 * 1024 });
  const mgr1 = new RegionInstallationManager({ backend: backend1, authority: idxData.authority });
  const eastInst = await mgr1.installPackage(loadPkg('in_east_c05_v1'));
  if (!eastInst.ok) throw new Error('Failed to install in_east_c05_v1');
  const eastV1Arts = await mgr1.openVersionArtifacts(eastInst.versionKey);
  const stOrigin = eastV1Arts.graph.snapshot().stations.find((s) => s.name === 'Eastside Origin')!;
  const verifiedPortal: RegionPortal = eastV1Arts.portalSet!.portals[0];

  const missingDest = await evaluateCrossRegionOracleJourney(mgr1, {
    originStationId: stOrigin.id,
    destinationStationId: 'st:n:summit',
    profile: trainAc25k,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_01_unavailable_destination_region',
    passed: !missingDest.plan.ok && missingDest.plan.portalResult.code === 'UNAVAILABLE_DESTINATION_REGION' && missingDest.fabricatedEdges === 0,
    expectedCode: 'UNAVAILABLE_DESTINATION_REGION',
    actualCode: missingDest.plan.portalResult.code,
    fabricatedEdges: missingDest.fabricatedEdges,
    verificationScope: missingDest.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: missingDest.plan.reason,
  });

  // 2. Install north v1 and test verified A_TO_B AC electric crossing + active route version pinning
  const northInst = await mgr1.installPackage(loadPkg('in_north_c05_v1'));
  if (!northInst.ok) throw new Error('Failed to install in_north_c05_v1');
  const northV1Arts = await mgr1.openVersionArtifacts(northInst.versionKey);
  const stSummit = northV1Arts.graph.snapshot().stations.find((s) => s.name === 'Summit Terminal')!;

  const validAcForward = await evaluateCrossRegionOracleJourney(mgr1, {
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: trainAc25k,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_02_verified_regions_ac25k_a_to_b_pinned',
    passed:
      validAcForward.plan.ok &&
      validAcForward.plan.portalResult.code === 'PORTAL_VERIFIED' &&
      (validAcForward.plan.pinnedVersions?.length ?? 0) === 2 &&
      validAcForward.fabricatedEdges === 0,
    expectedCode: 'PORTAL_VERIFIED',
    actualCode: validAcForward.plan.portalResult.code,
    fabricatedEdges: validAcForward.fabricatedEdges,
    verificationScope: validAcForward.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: validAcForward.plan.pinnedVersions ?? [],
    totalDistanceM: validAcForward.plan.totalDistanceM ?? null,
    notes: 'Game-engine composed cross-region AC 25kV journey with seam continuity and version pinning',
  });

  // 3. Compatible diesel operating mode across electrified 1676mm portal
  const validDieselCross = await evaluateCrossRegionOracleJourney(mgr1, {
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: trainDiesel1676,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_03_compatible_diesel_across_electrified_portal',
    passed: validDieselCross.plan.ok && validDieselCross.plan.portalResult.code === 'PORTAL_VERIFIED' && validDieselCross.fabricatedEdges === 0,
    expectedCode: 'PORTAL_VERIFIED',
    actualCode: validDieselCross.plan.portalResult.code,
    fabricatedEdges: validDieselCross.fabricatedEdges,
    verificationScope: validDieselCross.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: validDieselCross.plan.pinnedVersions ?? [],
    totalDistanceM: validDieselCross.plan.totalDistanceM ?? null,
    notes: validDieselCross.plan.reason,
  });

  // 4. Reverse direction B_TO_A allowed on BOTH vs rejected on A_TO_B-only portal
  const revAllowed = resolvePortalBetweenGraphs({
    portal: verifiedPortal,
    direction: 'B_TO_A',
    graphA: eastV1Arts.graph,
    graphB: northV1Arts.graph,
    trainProfile: trainAc25k,
  });
  const dirRestrictedPortal: RegionPortal = { ...verifiedPortal, allowedDirection: 'A_TO_B' };
  const dirForbidden = resolvePortalBetweenGraphs({
    portal: dirRestrictedPortal,
    direction: 'B_TO_A',
    graphA: eastV1Arts.graph,
    graphB: northV1Arts.graph,
    trainProfile: trainAc25k,
  });
  items.push({
    checkId: 'cr_04_explicit_portal_direction_enforcement',
    passed: revAllowed.ok && revAllowed.code === 'PORTAL_VERIFIED' && !dirForbidden.ok && dirForbidden.code === 'PORTAL_DIRECTION_FORBIDDEN',
    expectedCode: 'PORTAL_DIRECTION_FORBIDDEN',
    actualCode: dirForbidden.code,
    fabricatedEdges: dirForbidden.fabricatedEdgeCount,
    verificationScope: 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY',
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: `B_TO_A on BOTH=${revAllowed.code}, on A_TO_B=${dirForbidden.code}`,
  });

  // 5. Gauge incompatibility across portal (1435mm vs 1676mm)
  const gaugeMismatch = await evaluateCrossRegionOracleJourney(mgr1, {
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: trainDiesel1435,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_05_portal_gauge_mismatch_1435_rejected',
    passed: !gaugeMismatch.plan.ok && gaugeMismatch.plan.portalResult.code === 'PORTAL_GAUGE_MISMATCH' && gaugeMismatch.fabricatedEdges === 0,
    expectedCode: 'PORTAL_GAUGE_MISMATCH',
    actualCode: gaugeMismatch.plan.portalResult.code,
    fabricatedEdges: gaugeMismatch.fabricatedEdges,
    verificationScope: gaugeMismatch.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: gaugeMismatch.plan.reason,
  });

  // 6. Electrical mode incompatibility across portal (1500V DC vs 25kV 50Hz AC)
  const elecMismatch = await evaluateCrossRegionOracleJourney(mgr1, {
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: trainDc1500,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_06_portal_electrification_mismatch_1500v_dc_rejected',
    passed: !elecMismatch.plan.ok && elecMismatch.plan.portalResult.code === 'PORTAL_ELECTRIFICATION_MISMATCH' && elecMismatch.fabricatedEdges === 0,
    expectedCode: 'PORTAL_ELECTRIFICATION_MISMATCH',
    actualCode: elecMismatch.plan.portalResult.code,
    fabricatedEdges: elecMismatch.fabricatedEdges,
    verificationScope: elecMismatch.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: elecMismatch.plan.reason,
  });

  // 7. Unverified portal rejected
  const unverified = await evaluateCrossRegionOracleJourney(mgr1, {
    portal: { ...verifiedPortal, verified: false },
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: trainAc25k,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_07_unverified_portal_rejected',
    passed: !unverified.plan.ok && unverified.plan.portalResult.code === 'PORTAL_UNVERIFIED' && unverified.fabricatedEdges === 0,
    expectedCode: 'PORTAL_UNVERIFIED',
    actualCode: unverified.plan.portalResult.code,
    fabricatedEdges: unverified.fabricatedEdges,
    verificationScope: unverified.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: unverified.plan.reason,
  });

  // 8. Region-version mismatch (upgrade in_east to v2 while portal expects v1 graphSha256)
  const eastV2Inst = await mgr1.installPackage(loadPkg('in_east_c05_v2'));
  if (!eastV2Inst.ok) throw new Error('Failed to install in_east_c05_v2');
  const versionMismatch = await evaluateCrossRegionOracleJourney(mgr1, {
    portal: verifiedPortal, // pinned to v1 graphASha256
    originStationId: stOrigin.id,
    destinationStationId: stSummit.id,
    profile: trainAc25k,
    policy: policyNoRev,
  });
  items.push({
    checkId: 'cr_08_region_version_mismatch_rejected',
    passed: !versionMismatch.plan.ok && versionMismatch.plan.portalResult.code === 'PORTAL_GRAPH_VERSION_MISMATCH' && versionMismatch.fabricatedEdges === 0,
    expectedCode: 'PORTAL_GRAPH_VERSION_MISMATCH',
    actualCode: versionMismatch.plan.portalResult.code,
    fabricatedEdges: versionMismatch.fabricatedEdges,
    verificationScope: versionMismatch.verificationScope,
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: versionMismatch.plan.reason,
  });

  // 9. Seam distance cap enforced
  const seamTooFar = resolvePortalBetweenGraphs({
    portal: { ...verifiedPortal, seamDistanceM: metres(1200) },
    direction: 'A_TO_B',
    graphA: eastV1Arts.graph,
    graphB: northV1Arts.graph,
    trainProfile: trainAc25k,
  });
  items.push({
    checkId: 'cr_09_seam_distance_exceeded_rejected',
    passed: !seamTooFar.ok && seamTooFar.code === 'PORTAL_SEAM_DISTANCE_EXCEEDED' && seamTooFar.fabricatedEdgeCount === 0,
    expectedCode: 'PORTAL_SEAM_DISTANCE_EXCEEDED',
    actualCode: seamTooFar.code,
    fabricatedEdges: seamTooFar.fabricatedEdgeCount,
    verificationScope: 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY',
    independentJavaSegmentVerificationExecuted: false,
    pinnedVersions: [],
    totalDistanceM: null,
    notes: seamTooFar.reason,
  });

  // Unused OperatingMode import guard check (type-level reference)
  const _opRef: OperatingMode['mode'] = 'electric';
  void _opRef;

  return {
    schemaVersion: 1,
    total: items.length,
    passed: items.filter((i) => i.passed).length,
    failed: items.filter((i) => !i.passed).length,
    verificationScope: 'GAME_ENGINE_PORTAL_COMPOSITION_ONLY',
    nativeMultiRegionOracleSupported: false,
    independentJavaSegmentVerificationExecuted: false,
    zeroFabricatedEdgesVerified: items.every((i) => i.fabricatedEdges === 0),
    results: items,
  };
}
