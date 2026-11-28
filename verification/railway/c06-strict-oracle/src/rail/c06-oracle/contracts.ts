import type { CompatibilityPolicy } from '../compatibility';
import type { TrainProfile } from '../../domain/models';
import type { OperatingMode } from '../compatibility';

export const C06_OPENRAILROUTING_PIN = Object.freeze({
  repoUrl: 'https://github.com/geofabrik/OpenRailRouting',
  commit: 'e5112194fde4cc8ec36e2b0093e250df89ef4845',
  license: 'Apache-2.0',
  licenseBlob: '5471dc10377b76db85a2feca7a99a7eef4980ba8',
  graphHopperVersion: '11.1-osm-reader-callbacks-1',
  docApiSubmodulePin: '4edcc9b85834a0ad75ff6ebe646e7a0c09e939d7',
} as const);

/**
 * Provisional comparison tolerances separating measurement rounding (WGS84 Haversine vs GraphHopper Earth radius,
 * ceil-second segment sum vs ms accumulation) from true semantic discrepancies.
 */
export const C06_COMPARISON_TOLERANCES = Object.freeze({
  provisional: true,
  rationale: 'No production tolerance is locked for C06 yet; provisional thresholds allow spherical vs ellipsoidal geodesic rounding and integer ceil-second rounding while catching topology or speed mismatches.',
  distanceMaxDeltaM: 50,
  distanceMaxRelDelta: 0.01,
  durationMaxDeltaS: 5,
  durationMaxRelDelta: 0.02,
  endpointSnapMaxM: 250,
  runtimeRoutingP95TargetMs: 300,
} as const);

export type C06DiscrepancyClass =
  | 'MATCH_VALID_ROUTE'
  | 'MATCH_NO_VALID_ROUTE'
  | 'EQUIVALENT_ALTERNATIVE_ROUTE'
  | 'DISTANCE_DISCREPANCY'
  | 'DURATION_DISCREPANCY'
  | 'ENDPOINT_MAPPING_DISCREPANCY'
  | 'METADATA_UNSUPPORTED'
  | 'STRICT_PROFILE_UNSUPPORTED'
  | 'ORACLE_FALSE_ACCEPT'
  | 'GAME_FALSE_ACCEPT'
  | 'ORACLE_FALSE_REJECT'
  | 'GAME_FALSE_REJECT'
  | 'ORACLE_EXECUTION_ERROR'
  | 'INDETERMINATE';

export interface CompatibilityMappingEntry {
  readonly rule: string;
  readonly r08Semantics: string;
  readonly upstreamOpenRailRoutingSupport: 'DIRECT' | 'PARTIAL_PERMISSIVE' | 'UNSUPPORTED';
  readonly strictOracleMechanism:
    | 'GH_CUSTOM_MODEL'
    | 'GH_STRICT_PARSER_AND_CUSTOM_MODEL'
    | 'ADAPTER_POST_VALIDATION'
    | 'UPSTREAM_UNSUPPORTED_ADAPTER_ENFORCED';
  readonly notes: string;
}

export const C06_COMPATIBILITY_MAPPING_MATRIX: readonly CompatibilityMappingEntry[] = Object.freeze([
  {
    rule: 'Track gauge (gaugeMm)',
    r08Semantics: 'Explicit mm array; null (unknown) fails closed in Realism with DATA_MISSING:UNKNOWN_GAUGE.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream gauge_1435.json permits gauge==0 (unknown). StrictGaugeStateParser records MISSING/KNOWN/INVALID + exact mm and rejects MISSING/INVALID.',
  },
  {
    rule: 'Train gauge (profile.gaugesMm)',
    r08Semantics: 'Every traversed edge must support the active operating gauge.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Per-request CustomModel checks strict_gauge_mm against allowed profile.gaugesMm without gauge switching mid-route.',
  },
  {
    rule: 'Traction mode (diesel/electric/steam/dual)',
    r08Semantics: 'Single-mode train must match; dual may switch between diesel and electric only at authorized sites.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'UPSTREAM_UNSUPPORTED_ADAPTER_ENFORCED',
    notes: 'Upstream CustomModel has no stateful mode-switching node check; Java GraphHopper routes candidate edges and C06 adapter enforces dual switch-site authorization.',
  },
  {
    rule: 'Electrification (yes/no/unknown)',
    r08Semantics: 'Electric mode requires explicit yes (contact_line/rail/3rd/4th rail); UNSET/unknown fails closed; diesel/steam ignore.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream RailwayProfiles allows electrified==UNSET. StrictElectrifiedParser enforces YES/NO/UNKNOWN so UNSET/unknown fails closed for electric mode.',
  },
  {
    rule: 'Voltage (voltageV)',
    r08Semantics: 'Exact volts; missing/null fails closed for electric mode with DATA_MISSING:UNKNOWN_VOLTAGE.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream Voltage quantized at 50V steps and conflates missing/0 with 0.0V. StrictVoltageParser separates strict_voltage_known and stores exact 1V integer resolution.',
  },
  {
    rule: 'Electrical frequency (frequencyHz vs explicit DC 0)',
    r08Semantics: 'frequency=0 explicitly denotes DC; positive value denotes AC; missing/null fails closed with DATA_MISSING:UNKNOWN_FREQUENCY; ambiguous V*F Cartesian pairs fail closed.',
    upstreamOpenRailRoutingSupport: 'UNSUPPORTED',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream DecimalEncodedValue defaults missing frequency to 0.0 (indistinguishable from DC) and quantizes 16.7Hz to 17.5Hz. StrictFreqParser encodes MISSING/KNOWN_DC/KNOWN_AC/INVALID + exact 0.1Hz deci-Hz.',
  },
  {
    rule: 'Track operational status (active)',
    r08Semantics: 'active===false fails closed with INACTIVE_TRACK.',
    upstreamOpenRailRoutingSupport: 'UNSUPPORTED',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream imports railway=* regardless of railway:active=no. StrictActiveParser enforces strict_active in CustomModel.',
  },
  {
    rule: 'Restricted and unknown access',
    r08Semantics: 'restricted fails with INCOMPATIBLE_PROFILE; unknown fails with DATA_MISSING:UNKNOWN_ACCESS.',
    upstreamOpenRailRoutingSupport: 'UNSUPPORTED',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream RailAccessParser ignores access=private/military/unknown. StrictAccessParser enforces ALLOWED/RESTRICTED/UNKNOWN.',
  },
  {
    rule: 'Direction restrictions (oneway)',
    r08Semantics: 'Missing backward edge fails with DIRECTION.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream preferred_direction applies soft *0.5 priority penalty. StrictOnewayParser sets 2-dir strict_oneway_dir to hard-forbid backward oneway traversal.',
  },
  {
    rule: 'Maximum track speed (maxSpeedKmh)',
    r08Semantics: 'Missing maxspeed fails closed in Realism with UNKNOWN_SPEED.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'GH_STRICT_PARSER_AND_CUSTOM_MODEL',
    notes: 'Upstream RailAverageSpeedParser guesses 25/50/100 km/h when maxspeed is absent. StrictMaxSpeedParser sets strict_maxspeed_known and hard-blocks missing speeds.',
  },
  {
    rule: 'Train speed limit (profile.maxSpeedKmh)',
    r08Semantics: 'Edge effective speed = min(trackMaxSpeed, trainMaxSpeedKmh).',
    upstreamOpenRailRoutingSupport: 'DIRECT',
    strictOracleMechanism: 'GH_CUSTOM_MODEL',
    notes: 'Directly supported via per-request CustomModel LIMIT.',
  },
  {
    rule: 'Turn permission',
    r08Semantics: 'Explicit TurnRule table per (inEdge, outEdge); unspecified or permitted=false fails.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'ADAPTER_POST_VALIDATION',
    notes: 'OpenRailRouting SwitchTurnCostTask computes geometric angle thresholds (<0.75π or >1.25π); non-geometric arbitrary turn bans require adapter/post-validation.',
  },
  {
    rule: 'Reversal restrictions (allowReversal)',
    r08Semantics: 'U-turn reversal requires rule.reversal===true and policy.allowReversal===true.',
    upstreamOpenRailRoutingSupport: 'DIRECT',
    strictOracleMechanism: 'GH_CUSTOM_MODEL',
    notes: 'Modeled directly via strict_no_rev (INFINITE_U_TURN_COSTS) vs strict_with_rev TurnCostsConfig and verified against reversalCount.',
  },
  {
    rule: 'Traction-mode changes (modeChanges)',
    r08Semantics: 'Allowed only for dual trains at declared switch node IDs with positive penaltyS.',
    upstreamOpenRailRoutingSupport: 'UNSUPPORTED',
    strictOracleMechanism: 'UPSTREAM_UNSUPPORTED_ADAPTER_ENFORCED',
    notes: 'Adapter inspects mode transitions across GraphHopper edge steps against policy.modeChanges.',
  },
  {
    rule: 'Unsupported electrical-system transitions',
    r08Semantics: 'Switching (voltageV, frequencyHz) mid-route without traction change is forbidden (POWER_SYSTEM_CHANGE_NOT_SUPPORTED).',
    upstreamOpenRailRoutingSupport: 'UNSUPPORTED',
    strictOracleMechanism: 'UPSTREAM_UNSUPPORTED_ADAPTER_ENFORCED',
    notes: 'Per-request CustomModel + adapter ensure pure electric profiles only traverse one non-ambiguous electrical specification per continuous journey.',
  },
  {
    rule: 'Graph connectivity (shared-node only)',
    r08Semantics: 'Intersecting lines without shared node cannot connect.',
    upstreamOpenRailRoutingSupport: 'DIRECT',
    strictOracleMechanism: 'GH_CUSTOM_MODEL',
    notes: 'Native GraphHopper topology connects only at shared tower nodes.',
  },
  {
    rule: 'Route continuity & station anchoring',
    r08Semantics: 'Ordered stops must be hit on exact station anchor nodes with continuous edge adjacency.',
    upstreamOpenRailRoutingSupport: 'PARTIAL_PERMISSIVE',
    strictOracleMechanism: 'ADAPTER_POST_VALIDATION',
    notes: 'GraphHopper snaps GHPoint lat/lon to LocationIndexTree; adapter verifies snapped coordinates remain within station tolerance and no stop anchor mismatch occurs.',
  },
  {
    rule: 'Range constraints (profile.rangeM)',
    r08Semantics: 'Each edge and cumulative route distance must be <= profile.rangeM.',
    upstreamOpenRailRoutingSupport: 'UNSUPPORTED',
    strictOracleMechanism: 'UPSTREAM_UNSUPPORTED_ADAPTER_ENFORCED',
    notes: 'Enforced in StrictOracleRunner (post-search distance gate -> INCOMPATIBLE_PROFILE:RANGE_EXCEEDED) and independent safety validator.',
  },
]);

export interface OracleStopPoint {
  readonly stationId: string;
  readonly lat: number;
  readonly lon: number;
}

export interface OracleQueryRequest {
  readonly requestId: string;
  readonly engineMode?: 'STRICT_ORACLE' | 'UPSTREAM_UNMODIFIED';
  readonly upstreamProfile?: string;
  readonly stops: readonly OracleStopPoint[];
  readonly objective: 'distance' | 'time';
  readonly allowReversal: boolean;
  readonly train: TrainProfile;
  readonly policy: CompatibilityPolicy;
  readonly expectedGraphSha256: string;
  readonly expectedProfileSha256: string;
  readonly expectedPolicySha256: string;
  readonly actualGraphSha256: string;
  readonly actualProfileSha256: string;
  readonly actualPolicySha256: string;
  readonly initialOperating: OperatingMode;
}

export interface OracleTraversedEdge {
  readonly edgeKey: number;
  readonly edgeId: number;
  readonly osmWayId: number;
  readonly baseNode: number;
  readonly adjNode: number;
  readonly distanceM: number;
  readonly upstreamGaugeMm: number;
  readonly upstreamElectrified: string;
  readonly upstreamVoltageV: number;
  readonly upstreamFrequencyHz: number;
  readonly strictAccess?: string;
  readonly strictActive?: boolean;
  readonly strictGaugeState?: string;
  readonly strictGaugeMm?: number;
  readonly strictElectrifiedState?: string;
  readonly strictVoltageKnown?: boolean;
  readonly strictVoltageV?: number;
  readonly strictFreqState?: string;
  readonly strictFreqDhz?: number;
  readonly strictMaxSpeedKnown?: boolean;
  readonly strictMaxSpeedKmh?: number;
  readonly strictOnewayAllowed?: boolean;
}

export interface OracleRawResponse {
  readonly requestId: string;
  readonly engineMode: string;
  readonly ok: boolean;
  readonly statusCode: string;
  readonly reason?: string;
  readonly distanceM?: number;
  readonly durationMs?: number;
  readonly durationS?: number;
  readonly visitedNodes?: number;
  readonly reversalCount?: number;
  readonly snappedWaypoints?: ReadonlyArray<{ readonly lat: number; readonly lon: number }>;
  readonly edges?: readonly OracleTraversedEdge[];
  readonly elapsedMs: number;
  readonly startupLoadMs?: number;
}

export interface C07ComparisonCase {
  readonly caseId: string;
  readonly category: 'positive' | 'negative_gauge' | 'negative_power' | 'negative_access' | 'negative_turn' | 'negative_topology' | 'cross_region';
  readonly dataProvenance: 'SYNTHETIC_C06' | 'APPROVED_REAL_C07';
  readonly regionId: string;
  readonly graphSha256: string;
  readonly stopIds: readonly string[];
  readonly objective: 'distance' | 'time';
  readonly allowReversal: boolean;
  readonly trainProfileId: string;
  readonly expectedValid: boolean;
  readonly expectedGameCode: string;
  readonly expectedDiscrepancyClass: C06DiscrepancyClass;
  readonly notes: string;
}

export interface C07ComparisonDatasetV1 {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly realDataUsed: boolean;
  readonly c01ComplianceCleared: boolean;
  readonly minimumRequiredRealCasesForC07: number;
  readonly syntheticOnly: boolean;
  readonly cases: readonly C07ComparisonCase[];
}

export function validateC07DatasetSchema(raw: unknown): C07ComparisonDatasetV1 {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('C07 dataset must be an object');
  }
  const ds = raw as C07ComparisonDatasetV1;
  if (ds.schemaVersion !== 1 || typeof ds.datasetId !== 'string' || !ds.datasetId.trim()) {
    throw new TypeError('C07 dataset requires schemaVersion=1 and non-empty datasetId');
  }
  if (ds.realDataUsed && !ds.c01ComplianceCleared) {
    throw new Error('C07 dataset with realDataUsed=true is forbidden while c01ComplianceCleared=false');
  }
  if (ds.realDataUsed && ds.cases.length < ds.minimumRequiredRealCasesForC07) {
    throw new Error(`C07 real comparison dataset requires at least ${ds.minimumRequiredRealCasesForC07} cases`);
  }
  if (!Array.isArray(ds.cases) || ds.cases.length === 0) {
    throw new TypeError('C07 dataset must contain at least one comparison case');
  }
  const seen = new Set<string>();
  for (const c of ds.cases) {
    if (!c.caseId || seen.has(c.caseId)) {
      throw new TypeError(`Duplicate or missing caseId: ${String(c?.caseId)}`);
    }
    seen.add(c.caseId);
    if (!ds.realDataUsed && c.dataProvenance !== 'SYNTHETIC_C06') {
      throw new TypeError(`Synthetic C06 dataset cannot label case ${c.caseId} as ${c.dataProvenance}`);
    }
  }
  return ds;
}
