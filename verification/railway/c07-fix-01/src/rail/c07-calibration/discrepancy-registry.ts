import type { C06DiscrepancyClass } from '../c06-oracle/contracts';
import type { C07Category } from './contracts';

export const ALL_C07_DISCREPANCY_CLASSES: readonly C06DiscrepancyClass[] = Object.freeze([
  'MATCH_VALID_ROUTE',
  'MATCH_NO_VALID_ROUTE',
  'EQUIVALENT_ALTERNATIVE_ROUTE',
  'DISTANCE_DISCREPANCY',
  'DURATION_DISCREPANCY',
  'ENDPOINT_MAPPING_DISCREPANCY',
  'METADATA_UNSUPPORTED',
  'STRICT_PROFILE_UNSUPPORTED',
  'GAME_FALSE_ACCEPT',
  'GAME_FALSE_REJECT',
  'ORACLE_FALSE_ACCEPT',
  'ORACLE_FALSE_REJECT',
  'STALE_IDENTITY',
  'INVALID_INPUT',
  'SEARCH_EXHAUSTION',
  'ORACLE_EXECUTION_ERROR',
  'INDETERMINATE',
]);

export type DiscrepancySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type DiscrepancyResolutionStatus =
  | 'RESOLVED_WITH_EVIDENCE'
  | 'EXPECTED_INFRASTRUCTURE_PROBE_VERIFIED'
  | 'EXPECTED_UPSTREAM_LIMITATION_DOCUMENTED'
  | 'OPEN_BLOCKING'
  | 'OPEN_NON_BLOCKING';

export interface DiscrepancyRecord {
  readonly discrepancyId: string;
  readonly caseId: string;
  readonly semanticRequestId: string;
  readonly category: C07Category;
  readonly discrepancyClass: C06DiscrepancyClass;
  readonly passedExpectation: boolean;
  readonly knownIncompatibleAccepted: boolean;
  readonly reproCommand: string;
  readonly expectedResult: string;
  readonly actualGameResult: string;
  readonly actualOracleResult: string;
  readonly independentSafetyResult: string;
  readonly rootCauseOrStatus: string;
  readonly severity: DiscrepancySeverity;
  readonly affectedComponent: string;
  readonly proposedRemediation: string;
  readonly resolutionStatus: DiscrepancyResolutionStatus;
  readonly regressionTestId: string;
  readonly remainingVerification: string;
}

export interface DiscrepancyRegistryReport {
  readonly schemaVersion: 1;
  readonly taxonomyCoverage: readonly C06DiscrepancyClass[];
  readonly totalCasesRecorded: number;
  readonly classCounts: Readonly<Record<string, number>>;
  readonly openBlockingCount: number;
  readonly openNonBlockingCount: number;
  readonly openCount: number;
  readonly resolvedCount: number;
  readonly discrepanciesRequiringDispositionCount: number;
  readonly records: readonly DiscrepancyRecord[];
}

export class DiscrepancyRegistry {
  readonly #records: DiscrepancyRecord[] = [];
  readonly #seenIds = new Set<string>();

  add(rec: DiscrepancyRecord): void {
    if (!rec.discrepancyId || this.#seenIds.has(rec.discrepancyId)) {
      throw new Error(`Duplicate or empty discrepancyId: ${rec.discrepancyId}`);
    }
    if (!ALL_C07_DISCREPANCY_CLASSES.includes(rec.discrepancyClass)) {
      throw new Error(`Unsupported discrepancy class: ${rec.discrepancyClass}`);
    }
    this.#seenIds.add(rec.discrepancyId);
    this.#records.push(rec);
  }

  getRecords(): readonly DiscrepancyRecord[] {
    return this.#records;
  }

  buildReport(): DiscrepancyRegistryReport {
    const classCounts: Record<string, number> = {};
    for (const cls of ALL_C07_DISCREPANCY_CLASSES) {
      classCounts[cls] = 0;
    }
    let openBlocking = 0;
    let openNonBlocking = 0;
    let resolved = 0;
    let nonMatchCount = 0;

    for (const r of this.#records) {
      classCounts[r.discrepancyClass] = (classCounts[r.discrepancyClass] ?? 0) + 1;
      if (r.discrepancyClass !== 'MATCH_VALID_ROUTE' && r.discrepancyClass !== 'MATCH_NO_VALID_ROUTE') {
        nonMatchCount++;
      }
      if (r.resolutionStatus === 'OPEN_BLOCKING') openBlocking++;
      else if (r.resolutionStatus === 'OPEN_NON_BLOCKING') openNonBlocking++;
      else resolved++;
    }

    return {
      schemaVersion: 1,
      taxonomyCoverage: ALL_C07_DISCREPANCY_CLASSES,
      totalCasesRecorded: this.#records.length,
      classCounts,
      openBlockingCount: openBlocking,
      openNonBlockingCount: openNonBlocking,
      openCount: openBlocking + openNonBlocking,
      resolvedCount: resolved,
      discrepanciesRequiringDispositionCount: nonMatchCount,
      records: [...this.#records],
    };
  }
}

export function assertDiscrepanciesDispositioned(
  report: DiscrepancyRegistryReport,
  expectedMinimumTotal: number,
): void {
  if (report.totalCasesRecorded < expectedMinimumTotal) {
    throw new Error(`Discrepancy suppression check failed: recorded ${report.totalCasesRecorded} < expected ${expectedMinimumTotal}`);
  }
  for (const r of report.records) {
    if (!r.reproCommand || !r.rootCauseOrStatus || !r.proposedRemediation || !r.regressionTestId) {
      throw new Error(`Incomplete disposition metadata on ${r.discrepancyId}`);
    }
    if (!r.passedExpectation && r.resolutionStatus !== 'OPEN_BLOCKING') {
      throw new Error(`Failed expectation case ${r.discrepancyId} must be OPEN_BLOCKING, got ${r.resolutionStatus}`);
    }
    if (r.knownIncompatibleAccepted && r.resolutionStatus !== 'OPEN_BLOCKING') {
      throw new Error(`Unresolved safety hazard case ${r.discrepancyId} must be OPEN_BLOCKING, got ${r.resolutionStatus}`);
    }
    if (r.resolutionStatus === 'EXPECTED_INFRASTRUCTURE_PROBE_VERIFIED' && (r.category !== 'D_IDENTITY_AND_INFRASTRUCTURE' || !r.passedExpectation)) {
      throw new Error(`Invalid EXPECTED_INFRASTRUCTURE_PROBE_VERIFIED on ${r.discrepancyId}`);
    }
    const isUnexpectedInfraOnRoute =
      r.category !== 'D_IDENTITY_AND_INFRASTRUCTURE' &&
      (r.discrepancyClass === 'ORACLE_EXECUTION_ERROR' ||
        r.discrepancyClass === 'STALE_IDENTITY' ||
        r.discrepancyClass === 'INVALID_INPUT' ||
        r.discrepancyClass === 'SEARCH_EXHAUSTION' ||
        r.discrepancyClass === 'INDETERMINATE');
    if (isUnexpectedInfraOnRoute && r.resolutionStatus !== 'OPEN_BLOCKING') {
      throw new Error(`Unexpected infrastructure failure on route ${r.discrepancyId} must remain OPEN_BLOCKING`);
    }
    const isFailureClass =
      r.discrepancyClass === 'GAME_FALSE_ACCEPT' ||
      r.discrepancyClass === 'ORACLE_FALSE_ACCEPT' ||
      r.discrepancyClass === 'GAME_FALSE_REJECT' ||
      r.discrepancyClass === 'ORACLE_FALSE_REJECT' ||
      r.discrepancyClass === 'DISTANCE_DISCREPANCY' ||
      r.discrepancyClass === 'DURATION_DISCREPANCY' ||
      r.discrepancyClass === 'ENDPOINT_MAPPING_DISCREPANCY' ||
      r.discrepancyClass === 'INDETERMINATE';
    if (isFailureClass && (r.resolutionStatus === 'RESOLVED_WITH_EVIDENCE' || r.resolutionStatus === 'EXPECTED_INFRASTRUCTURE_PROBE_VERIFIED')) {
      throw new Error(`Invalid resolved disposition for failure class ${r.discrepancyClass} on ${r.discrepancyId}`);
    }
  }
}
