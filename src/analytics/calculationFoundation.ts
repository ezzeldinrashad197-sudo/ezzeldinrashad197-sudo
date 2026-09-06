```typescript
import { SubmittalRow, KPIStats, RegisterSequenceAudit } from '../types';
import { compareRevisions, isValidRevision } from './analyticsCore';
import { getRevisionWeight } from './revisionResolver';
import {
  getStatusCodeCategory,
  classifyNcrStatus,
  normalizeCanonicalString,
  classifySubmission,
  classifyRow
} from './statusResolver';
import {
  auditRegisterSequence,
  runComprehensiveSequenceAudit,
  generateForensicLifecycleLedger
} from './sequenceAuditEngine';

export {
  getStatusCodeCategory,
  classifyNcrStatus,
  normalizeCanonicalString,
  classifySubmission,
  classifyRow,
  auditRegisterSequence,
  runComprehensiveSequenceAudit,
  generateForensicLifecycleLedger
};

export interface DataQualityIssue {
  id: string;
  businessEntityKey: string;
  issueType:
    | 'MISSING_DATE'
    | 'BLANK_STATUS'
    | 'FUTURE_DATE'
    | 'DUPLICATE_REVISION'
    | 'INVALID_REVISION';
  description: string;
  row: SubmittalRow;
}

export interface DataQualityLedger {
  issues: DataQualityIssue[];
  missingDatesCount: number;
  blankStatusCount: number;
  futureDatesCount: number;
  duplicateKeysCount: number;
  invalidRevisionsCount: number;
  totalIssuesCount: number;
}

export interface CanonicalRecord {
  id: string;
  originalRow: SubmittalRow;
  registerType: string;

  /**
   * Business/register identity.
   * This remains independent from physical drawing identity.
   */
  businessEntityKey: string;

  /**
   * Physical document identity.
   *
   * For engineering drawings:
   *   Business Entity + DWG No.
   *
   * For non-drawing registers:
   *   Business Entity.
   */
  documentIdentityKey: string;

  revision: string;
  submissionDate: string;
  responseDate: string;
  status: string;
  resolvedStatus:
    | 'APPROVED'
    | 'REJECTED_OPEN'
    | 'REJECTED_CLOSED'
    | 'FINAL_CLOSED'
    | 'PENDING'
    | 'UNCLASSIFIED';
  isLatestRevision: boolean;
  isRev0: boolean;
  isHistoricalRev0: boolean;
  hadRejectionHistory: boolean;
  isResolvedRejection: boolean;
  firstSubmissionDate: string;
  includeInSubmission: boolean;
  includeInPerformance: boolean;
}

export interface CanonicalKPIResult extends KPIStats {
  dataQuality: DataQualityLedger;
}

/**
 * Safely parse a date string into a timestamp.
 */
export function parseDateTimestamp(dateStr?: string): number {
  if (!dateStr) {
    return 0;
  }

  const parsed = new Date(dateStr).getTime();

  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Safely read an optional normalized field without requiring
 * an immediate change to the SubmittalRow TypeScript interface.
 */
function readRowField(
  row: SubmittalRow,
  ...keys: string[]
): string {
  const record =
    row as unknown as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return String(value).trim();
    }
  }

  return '';
}

/**
 * Resolve the submission / SUB reference independently
 * from the physical drawing number.
 */
export function getSubmissionReference(
  row: SubmittalRow
): string {
  return readRowField(
    row,
    'submissionRef',
    'submissionReference',
    'submittalRef',
    'submittalReference',
    'subRef',
    'subNo',
    'docNo',
    'docNumber',
    'documentNo',
    'documentNumber'
  );
}

/**
 * Resolve the physical drawing/document number.
 *
 * Priority:
 *   1. Explicit drawingNo / drawingNumber
 *   2. Explicit dwgNo / dwgNumber / dwg
 *   3. sheetNo / sheet only for engineering drawing registers
 *
 * We deliberately do NOT blindly treat docNo as DWG No.
 */
export function getDrawingNumber(
  row: SubmittalRow
): string {
  const explicitDrawing =
    readRowField(
      row,
      'drawingNo',
      'drawingNumber',
      'dwgNo',
      'dwgNumber',
      'dwg'
    );

  if (explicitDrawing) {
    return explicitDrawing;
  }

  const family =
    (row.workflowFamily || '')
      .toUpperCase()
      .trim();

  const type =
    (row.documentType || row.logType || '')
      .toUpperCase()
      .trim();

  const record =
    row as unknown as Record<string, unknown>;

  const recordType =
    String(
      record.recordType || ''
    )
      .toUpperCase()
      .trim();

  const isEngineeringDrawingRegister =
    family === 'SDW' ||
    type.includes('SDW') ||
    type.includes('SHD') ||
    type.includes('SHOP') ||
    type.includes('SHOP DRAWING') ||
    type.includes('SHOPDRAWING') ||
    recordType === 'SHD';

  if (isEngineeringDrawingRegister) {
    return readRowField(
      row,
      'sheetNo',
      'sheet'
    );
  }

  return '';
}

/**
 * 1. Business Entity Resolver
 *
 * This remains the register/business identity resolver.
 * It is intentionally NOT the physical revision identity.
 */
export function getBusinessEntityKey(
  row: SubmittalRow
): string {
  const family =
    (row.workflowFamily || '')
      .toUpperCase()
      .trim();

  const type =
    (
      row.documentType ||
      row.logType ||
      'DOC'
    )
      .toUpperCase()
      .trim();

  const r =
    row as unknown as Record<string, unknown>;

  const extractRef = (
    ...keys: string[]
  ): string => {
    for (const key of keys) {
      const value = r[key];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      ) {
        return String(value).trim();
      }
    }

    return '';
  };

  const commonRef =
    extractRef(
      'submissionRef',
      'submissionReference',
      'submittalRef',
      'submittalReference',
      'subRef',
      'subNo',
      'docNo',
      'docNumber',
      'documentNo',
      'documentNumber',
      'ref',
      'id'
    );

  const upperDocNo =
    extractRef(
      'docNo',
      'docNumber',
      'documentNo'
    ).toUpperCase();

  const upperLog =
    (row.logType || '')
      .toUpperCase();

  const upperSrc =
    String(
      r.sourceFile || ''
    ).toUpperCase();

  const isABD =
    family === 'ABD' ||
    type.startsWith('ABD') ||
    type.includes('AS-BUILT') ||
    type.includes('AS BUILT') ||
    type.includes('ASBUILT') ||
    upperDocNo.startsWith('ABD-') ||
    upperDocNo.includes('AS-BUILT') ||
    upperDocNo.includes('AS BUILT') ||
    upperDocNo.includes('ASBUILT') ||
    upperLog.includes('ABD') ||
    upperLog.includes('AS-BUILT') ||
    upperLog.includes('AS BUILT') ||
    upperLog.includes('ASBUILT') ||
    upperSrc.includes('ABD') ||
    upperSrc.includes('AS-BUILT') ||
    upperSrc.includes('AS BUILT') ||
    upperSrc.includes('ASBUILT');

  let baseRef =
    commonRef;

  /**
   * Only strip explicit trailing revision indicators.
   *
   * Examples:
   *   REF-REV01 -> REF
   *   REF-R01   -> REF
   *
   * Ordinary reference suffixes are preserved.
   */
  baseRef =
    baseRef
      .replace(
        /[-_/\\s]+(?:REV|REVISION|R)\.?(?:[-_/\\s]*)([0-9]{1,2}|[A-Z])$/i,
        ''
      )
      .trim() ||
    commonRef;

  if (isABD) {
    return `ABD:${baseRef.toUpperCase()}`;
  }

  if (
    family === 'NCR' ||
    type.includes('NCR') ||
    type === 'NCR'
  ) {
    const ref =
      extractRef(
        'ncrRef',
        'docNo',
        'docNumber',
        'documentNo',
        'id'
      );

    return `NCR:${ref.toUpperCase()}`;
  }

  if (
    family === 'SOR' ||
    type.includes('SOR') ||
    type === 'SOR'
  ) {
    const ref =
      extractRef(
        'sorRef',
        'docNo',
        'docNumber',
        'documentNo',
        'id'
      );

    return `SOR:${ref.toUpperCase()}`;
  }

  if (
    family === 'RFI' ||
    type.includes('RFI') ||
    type === 'RFI'
  ) {
    const ref =
      extractRef(
        'rfiRef',
        'docNo',
        'docNumber',
        'documentNo',
        'id'
      );

    return `RFI:${ref.toUpperCase()}`;
  }

  if (
    family === 'WIR' ||
    type.includes('WIR') ||
    type === 'WIR'
  ) {
    const ref =
      extractRef(
        'wirRef',
        'docNo',
        'docNumber',
        'id'
      );

    return `WIR:${ref.toUpperCase()}`;
  }

  if (
    family === 'MIR' ||
    type.includes('MIR') ||
    type === 'MIR'
  ) {
    const ref =
      extractRef(
        'mirRef',
        'docNo',
        'docNumber',
        'documentNo',
        'id'
      );

    return `MIR:${ref.toUpperCase()}`;
  }

  if (
    family === 'LETTER' ||
    type.includes('LT') ||
    type.includes('LETTER') ||
    type === 'LTR'
  ) {
    const ref =
      extractRef(
        'letterRef',
        'docNo',
        'subject',
        'id'
      );

    return `LTR:${ref.toUpperCase()}`;
  }

  if (
    family === 'SDW' ||
    type.includes('SDW') ||
    type.includes('SHD') ||
    type.includes('SHOP') ||
    upperDocNo.startsWith('SDW-') ||
    upperDocNo.startsWith('SHD-')
  ) {
    return `SDW:${baseRef.toUpperCase()}`;
  }

  if (
    family === 'MAR' ||
    type.includes('MAR') ||
    type.includes('MATERIAL') ||
    type === 'MAR'
  ) {
    const ref =
      extractRef(
        'materialRef',
        'marRef',
        'docNo',
        'docNumber',
        'id'
      );

    return `MAR:${ref.toUpperCase()}`;
  }

  if (
    family === 'QS' ||
    type.includes('QS') ||
    type === 'QS'
  ) {
    const ref =
      extractRef(
        'qsRef',
        'docNo',
        'docNumber',
        'id'
      );

    return `QS:${ref.toUpperCase()}`;
  }

  const disc =
    String(
      r.discipline || ''
    )
      .trim()
      .toUpperCase();

  const prefix =
    type.includes('-')
      ? type
      : disc
        ? `${type}-${disc}`
        : type;

  return `${prefix}:${baseRef.toUpperCase()}`;
}

/**
 * 2. Physical Document Identity Resolver
 *
 * CRITICAL IDENTITY RULE:
 *
 * Business identity:
 *   SUB Ref / register identity
 *
 * Physical engineering identity:
 *   Business identity + DWG No.
 *
 * Example:
 *
 *   SDW:SUB-001::DWG:200251
 *   SDW:SUB-001::DWG:200252
 *
 * are two independent physical documents.
 *
 * This prevents revision history for one drawing from affecting
 * another drawing under the same submission reference.
 */
export function getDocumentIdentityKey(
  row: SubmittalRow
): string {
  const businessKey =
    getBusinessEntityKey(row)
      .toUpperCase()
      .trim();

  const drawingNo =
    getDrawingNumber(row)
      .toUpperCase()
      .trim();

  if (drawingNo) {
    return `${businessKey}::DWG:${drawingNo}`;
  }

  /**
   * Non-drawing registers retain business identity.
   */
  if (businessKey) {
    return businessKey;
  }

  /**
   * FAIL-CLOSED FALLBACK.
   *
   * Never allow blank business identity to merge multiple rows.
   * Prefer the stable source row ID over a random value so that
   * the same row remains deterministic across repeated calculations.
   */
  const record =
    row as unknown as Record<string, unknown>;

  const rowId =
    String(
      row.id ||
      record.id ||
      ''
    )
      .trim()
      .toUpperCase();

  if (rowId) {
    return `ROW:${rowId}`;
  }

  /**
   * Final deterministic fallback.
   *
   * This branch should normally be unreachable because imported
   * records are expected to have an ID.
   */
  const submissionDate =
    String(
      row.submissionDate || ''
    )
      .trim();

  const revision =
    String(
      row.rev || ''
    )
      .trim()
      .toUpperCase();

  const status =
    String(
      row.status ||
      row.recordStatus ||
      row.workflowStage ||
      ''
    )
      .trim()
      .toUpperCase();

  return `ROW:FALLBACK:${submissionDate}:${revision}:${status}`;
}

/**
 * Determine whether a row contains a valid revision value.
 */
function hasValidRevision(
  row: SubmittalRow
): boolean {
  const revision =
    normalizeCanonicalString(
      row.rev ||
      (row as unknown as Record<string, unknown>).revision ||
      (row as unknown as Record<string, unknown>).revNo
    );

  return (
    revision !== '' &&
    isValidRevision(revision)
  );
}

/**
 * Return the normalized revision value.
 */
function getNormalizedRevision(
  row: SubmittalRow
): string {
  return normalizeCanonicalString(
    row.rev ||
    (row as unknown as Record<string, unknown>).revision ||
    (row as unknown as Record<string, unknown>).revNo
  );
}

/**
 * Sort rows according to canonical revision precedence.
 *
 * Revision precedence is primary.
 * Submission date is the deterministic tie-breaker.
 * Row ID is the final deterministic tie-breaker.
 */
function sortByRevisionPrecedence(
  rows: SubmittalRow[]
): SubmittalRow[] {
  return [...rows].sort(
    (a, b) => {
      const revDiff =
        compareRevisions(
          a.rev,
          b.rev
        );

      if (revDiff !== 0) {
        return revDiff;
      }

      const timeA =
        parseDateTimestamp(
          a.submissionDate
        );

      const timeB =
        parseDateTimestamp(
          b.submissionDate
        );

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      return (
        a.id || ''
      ).localeCompare(
        b.id || ''
      );
    }
  );
}

/**
 * 3. Revision & History Engine
 *
 * Revision history is partitioned by physical document identity.
 *
 * IMPORTANT:
 * Invalid / blank revisions are never allowed to compete with
 * valid revisions for latest-revision determination.
 *
 * Existing revision precedence is otherwise preserved.
 */
export function processRevisionEngine(
  rows: SubmittalRow[],
  asOfDate?: string
): Map<
  string,
  {
    latest: SubmittalRow;
    all: SubmittalRow[];
    latestSheets: SubmittalRow[];
    resolvedStatus:
      | 'APPROVED'
      | 'REJECTED_OPEN'
      | 'REJECTED_CLOSED'
      | 'FINAL_CLOSED'
      | 'PENDING'
      | 'UNCLASSIFIED';
    hasRejection: boolean;
    isResolved: boolean;
  }
> {
  const groups =
    new Map<
      string,
      SubmittalRow[]
    >();

  const cutoffTime =
    parseDateTimestamp(
      asOfDate
    );

  rows.forEach(
    row => {
      if (
        cutoffTime > 0 &&
        row.submissionDate
      ) {
        const subTime =
          parseDateTimestamp(
            row.submissionDate
          );

        if (
          subTime > cutoffTime
        ) {
          return;
        }
      }

      const key =
        getDocumentIdentityKey(row);

      if (!groups.has(key)) {
        groups.set(
          key,
          []
        );
      }

      groups
        .get(key)!
        .push(row);
    }
  );

  const result =
    new Map<
      string,
      {
        latest: SubmittalRow;
        all: SubmittalRow[];
        latestSheets: SubmittalRow[];
        resolvedStatus:
          | 'APPROVED'
          | 'REJECTED_OPEN'
          | 'REJECTED_CLOSED'
          | 'FINAL_CLOSED'
          | 'PENDING'
          | 'UNCLASSIFIED';
        hasRejection: boolean;
        isResolved: boolean;
      }
    >();

  groups.forEach(
    (groupRows, key) => {
      /**
       * Only valid revisions participate in latest-revision
       * precedence.
       */
      const validRevisionRows =
        groupRows.filter(
          row =>
            hasValidRevision(row)
        );

      let latestSheets:
        SubmittalRow[] = [];

      let latest:
        SubmittalRow;

      if (
        validRevisionRows.length > 0
      ) {
        let maxWeight =
          -1;

        validRevisionRows.forEach(
          row => {
            const revision =
              getNormalizedRevision(row);

            const weight =
              getRevisionWeight(
                revision
              );

            if (
              weight > maxWeight
            ) {
              maxWeight =
                weight;
            }
          }
        );

        latestSheets =
          validRevisionRows.filter(
            row =>
              getRevisionWeight(
                getNormalizedRevision(row)
              ) === maxWeight
          );

        const sortedValid =
          sortByRevisionPrecedence(
            validRevisionRows
          );

        latest =
          latestSheets.length > 0
            ? sortByRevisionPrecedence(
                latestSheets
              )[latestSheets.length - 1]
            : sortedValid[
                sortedValid.length - 1
              ];
      } else {
        /**
         * No valid revision exists.
         *
         * The row remains visible for data-quality/current-state
         * purposes, but no invalid revision is treated as Rev00
         * or as a valid revision competitor.
         */
        const sortedAll =
          [...groupRows].sort(
            (a, b) => {
              const timeA =
                parseDateTimestamp(
                  a.submissionDate
                );

              const timeB =
                parseDateTimestamp(
                  b.submissionDate
                );

              if (
                timeA !== timeB
              ) {
                return (
                  timeA - timeB
                );
              }

              return (
                a.id || ''
              ).localeCompare(
                b.id || ''
              );
            }
          );

        latest =
          sortedAll[
            sortedAll.length - 1
          ];

        latestSheets =
          [latest];
      }

      const sorted =
        sortByRevisionPrecedence(
          groupRows
        );

      let hasRejection =
        false;

      sorted.forEach(
        row => {
          const category =
            getStatusCodeCategory(
              row
            );

          if (
            category ===
              'REJECTED_OPEN' ||
            category ===
              'REJECTED_CLOSED'
          ) {
            hasRejection =
              true;
          }
        }
      );

      /**
       * Current-state status is evaluated only against the
       * selected latest revision.
       */
      const sheetClassifications =
        latestSheets.map(
          row =>
            getStatusCodeCategory(
              row
            )
        );

      const resolvedStatus =
        classifySubmission(
          sheetClassifications
        );

      const isResolved =
        hasRejection &&
        resolvedStatus ===
          'APPROVED';

      result.set(
        key,
        {
          latest,
          all: sorted,
          latestSheets,
          resolvedStatus,
          hasRejection,
          isResolved
        }
      );
    }
  );

  return result;
}

/**
 * Determine whether the current entity is overdue according to SLA.
 */
export const isEntityOverdue = (
  latest?: SubmittalRow | null,
  cutoffTime?: number
): boolean => {
  if (!latest) {
    return false;
  }

  const nowTime =
    cutoffTime &&
    cutoffTime > 0
      ? cutoffTime
      : Date.now();

  if (latest.dueDate) {
    const dueTime =
      parseDateTimestamp(
        latest.dueDate
      );

    if (
      dueTime > 0 &&
      nowTime > dueTime
    ) {
      return true;
    }
  } else if (
    latest.submissionDate
  ) {
    const subTime =
      parseDateTimestamp(
        latest.submissionDate
      );

    if (subTime > 0) {
      const diffDays =
        (
          nowTime -
          subTime
        ) /
        (1000 * 3600 * 24);

      if (
        diffDays > 14
      ) {
        return true;
      }
    }
  }

  return false;
};

/**
 * 4. Master Canonical KPI Calculation Engine
 *
 * Dimension 1:
 *   Workload / Events
 *   = physical source rows
 *
 * Dimension 2:
 *   Current State
 *   = unique physical documents at latest revision
 *
 * Dimension 3:
 *   Historical rejection events vs resolved current entities
 */
export function calculateCanonicalKPIs(
  data: SubmittalRow[],
  fullDataset?: SubmittalRow[],
  asOfDate?: string
): CanonicalKPIResult {
  const rowsToUse =
    data || [];

  const cutoffTime =
    parseDateTimestamp(
      asOfDate
    );

  const issues:
    DataQualityIssue[] = [];

  let missingDatesCount = 0;
  let blankStatusCount = 0;
  let futureDatesCount = 0;
  let duplicateKeysCount = 0;
  let invalidRevisionsCount = 0;

  const validRows:
    SubmittalRow[] = [];

  /**
   * Duplicate detection uses physical document identity.
   */
  const seenKeyRevs =
    new Set<string>();

  rowsToUse.forEach(
    row => {
      const businessKey =
        getBusinessEntityKey(
          row
        );

      const documentKey =
        getDocumentIdentityKey(
          row
        );

      const rev =
        (
          row.rev ||
          ''
        ).trim();

      const keyRev =
        `${documentKey}__REV__${rev}`;

      if (!row.submissionDate) {
        missingDatesCount++;

        issues.push({
          id: row.id,
          businessEntityKey:
            documentKey,
          issueType:
            'MISSING_DATE',
          description:
            'Missing Submission Date',
          row
        });
      }

      if (
        !row.status &&
        !row.recordStatus &&
        !row.workflowStage &&
        !(
          row as unknown as Record<
            string,
            unknown
          >
        ).ncrStatus &&
        !(
          row as unknown as Record<
            string,
            unknown
          >
        ).sorStatus
      ) {
        blankStatusCount++;

        issues.push({
          id: row.id,
          businessEntityKey:
            documentKey,
          issueType:
            'BLANK_STATUS',
          description:
            'Blank Status Code and Workflow Stage',
          row
        });
      }

      if (
        cutoffTime > 0 &&
        row.submissionDate
      ) {
        const subTime =
          parseDateTimestamp(
            row.submissionDate
          );

        if (
          subTime > cutoffTime
        ) {
          futureDatesCount++;

          issues.push({
            id: row.id,
            businessEntityKey:
              documentKey,
            issueType:
              'FUTURE_DATE',
            description:
              `Submission date (${row.submissionDate}) exceeds snapshot date (${asOfDate})`,
            row
          });

          return;
        }
      }

      if (
        seenKeyRevs.has(
          keyRev
        )
      ) {
        duplicateKeysCount++;

        issues.push({
          id: row.id,
          businessEntityKey:
            documentKey,
          issueType:
            'DUPLICATE_REVISION',
          description:
            `Duplicate submission for Document Key: ${documentKey} Rev: ${rev}`,
          row
        });
      } else {
        seenKeyRevs.add(
          keyRev
        );
      }

      if (
        rev &&
        !isValidRevision(rev)
      ) {
        invalidRevisionsCount++;

        issues.push({
          id: row.id,
          businessEntityKey:
            documentKey,
          issueType:
            'INVALID_REVISION',
          description:
            `Invalid revision format: ${rev}`,
          row
        });
      }

      void businessKey;

      validRows.push(
        row
      );
    }
  );

  const dataQuality:
    DataQualityLedger = {
    issues,
    missingDatesCount,
    blankStatusCount,
    futureDatesCount,
    duplicateKeysCount,
    invalidRevisionsCount,
    totalIssuesCount:
      issues.length
  };

  if (
    validRows.length === 0
  ) {
    return {
      totalSubmittedSheets: 0,
      totalRows: 0,
      totalSheetsRev0: 0,
      totalSheetsFurtherRev: 0,
      totalDrawingsRev0: 0,
      totalDrawingsFurtherRev: 0,
      rowApproved: 0,
      rowApprovedClosed: 0,
      rowRejectedOpen: 0,
      rowRejectedClosed: 0,
      rowPending: 0,
      totalRejectedRows: 0,
      rejectedOpenRows: 0,
      rejectedClosedRows: 0,
      totalUniqueDrawings: 0,
      totalUniqueItems: 0,
      currentApproved: 0,
      currentRejectedOpen: 0,
      currentRejectedClosed: 0,
      currentRejected: 0,
      currentPending: 0,
      currentOpen: 0,
      currentClosed: 0,
      approved: 0,
      rejectedOpen: 0,
      rejectedClosed: 0,
      totalRejected: 0,
      pending: 0,
      unclassified: 0,
      rejectionEvents: 0,
      rejectionEventsOpen: 0,
      rejectionEventsClosed: 0,
      resolvedRejections: 0,
      rejectionResolutionRate: 0,
      activeItems: 0,
      activeCurrentItems: 0,
      slaEligibleActiveItems: 0,
      overdue: 0,
      overduePending: 0,
      overdueRejectedOpen: 0,
      overdueRateOnActive: 0,
      avgResponseTime: 0,
      approvalRate: 0,
      rejectionOpenRate: 0,
      rejectionClosedRate: 0,
      delayRate: 0,
      isWorkloadReconciled: true,
      isCurrentStateReconciled: true,
      reconciliationPassed: true,
      dataQuality
    };
  }

  // 1. WORKLOAD / SUBMISSION LAYER
  // Physical source rows / record grain.

  const totalSubmittedSheets =
    validRows.length;

  let totalSheetsRev0 = 0;
  let totalSheetsFurtherRev = 0;
  let totalRejectedRows = 0;
  let rejectedOpenRows = 0;
  let rejectedClosedRows = 0;
  let finalClosedRows = 0;
  let rowApproved = 0;
  let rowPending = 0;

  validRows.forEach(
    row => {
      const revVal =
        normalizeCanonicalString(
          row.rev ||
          (
            row as unknown as Record<
              string,
              unknown
            >
          ).revision ||
          (
            row as unknown as Record<
              string,
              unknown
            >
          ).revNo
        );

      const weight =
        getRevisionWeight(
          revVal
        );

      /**
       * Preserve existing workload classification semantics.
       *
       * A valid revision with weight 0 is Rev00.
       * Existing explicit isRev0 remains supported.
       *
       * Invalid/blank revision does not become Rev00 merely
       * because getRevisionWeight() returns 0.
       */
      const isValidRev =
        isValidRevision(
          revVal
        );

      const isRev0 =
        (
          isValidRev &&
          weight === 0
        ) ||
        (
          row.isRev0 === true &&
          isValidRev &&
          weight === 0
        );

      if (isRev0) {
        totalSheetsRev0++;
      } else {
        totalSheetsFurtherRev++;
      }

      const rowStatusCat =
        getStatusCodeCategory(
          row
        );

      if (
        rowStatusCat ===
        'APPROVED'
      ) {
        rowApproved++;
      } else if (
        rowStatusCat ===
        'REJECTED_OPEN'
      ) {
        totalRejectedRows++;
        rejectedOpenRows++;
      } else if (
        rowStatusCat ===
        'REJECTED_CLOSED'
      ) {
        totalRejectedRows++;
        rejectedClosedRows++;
      } else if (
        rowStatusCat ===
        'FINAL_CLOSED'
      ) {
        finalClosedRows++;
      } else if (
        rowStatusCat ===
        'PENDING'
      ) {
        rowPending++;
      } else {
        rowPending++;
      }
    }
  );

  const rowApprovedClosed =
    rowApproved +
    rejectedClosedRows +
    finalClosedRows;

  // 2. CURRENT STATE LAYER

  const baseForRevisions =
    fullDataset &&
    fullDataset.length > 0
      ? fullDataset
      : validRows;

  const revisionMap =
    processRevisionEngine(
      baseForRevisions,
      asOfDate
    );

  /**
   * Restrict current-state population to physical documents
   * represented by the current dataset.
   */
  const targetDocumentKeys =
    new Set(
      validRows.map(
        row =>
          getDocumentIdentityKey(
            row
          )
      )
    );

  let approvedCurrent = 0;
  let rejectedOpenCurrent = 0;
  let rejectedClosedCurrent = 0;
  let finalClosedCurrent = 0;
  let pendingCurrent = 0;
  let unclassifiedCurrent = 0;
  let resolvedRejections = 0;
  let totalEntitiesWithRejectionHistory = 0;
  let overdueCurrent = 0;
  let overduePendingCurrent = 0;
  let overdueRejectedOpenCurrent = 0;
  let slaEligibleActiveCount = 0;
  let totalResponseDays = 0;
  let responseCount = 0;

  targetDocumentKeys.forEach(
    documentKey => {
      const groupInfo =
        revisionMap.get(
          documentKey
        );

      if (!groupInfo) {
        return;
      }

      if (
        groupInfo.hasRejection
      ) {
        totalEntitiesWithRejectionHistory++;

        if (
          groupInfo.isResolved
        ) {
          resolvedRejections++;
        }
      }

      const latest =
        groupInfo.latest;

      const cat =
        groupInfo.resolvedStatus ||
        getStatusCodeCategory(
          latest
        );

      switch (cat) {
        case 'APPROVED':
          approvedCurrent++;
          break;

        case 'REJECTED_OPEN':
          rejectedOpenCurrent++;
          break;

        case 'REJECTED_CLOSED':
          rejectedClosedCurrent++;
          break;

        case 'FINAL_CLOSED':
          finalClosedCurrent++;
          break;

        case 'PENDING':
          pendingCurrent++;
          break;

        case 'UNCLASSIFIED':
        default:
          unclassifiedCurrent++;
          break;
      }

      const isActive =
        cat === 'PENDING' ||
        cat === 'REJECTED_OPEN';

      if (isActive) {
        if (
          latest.dueDate
        ) {
          slaEligibleActiveCount++;
        }

        const isItemOverdue =
          isEntityOverdue(
            latest,
            cutoffTime
          );

        if (
          isItemOverdue
        ) {
          overdueCurrent++;

          if (
            cat ===
            'REJECTED_OPEN'
          ) {
            overdueRejectedOpenCurrent++;
          } else {
            overduePendingCurrent++;
          }
        }
      }

      if (
        latest.submissionDate &&
        latest.responseDate
      ) {
        const start =
          parseDateTimestamp(
            latest.submissionDate
          );

        const end =
          parseDateTimestamp(
            latest.responseDate
          );

        if (
          end >= start
        ) {
          const days =
            Math.round(
              (
                end - start
              ) /
              (1000 * 3600 * 24)
            );

          totalResponseDays +=
            days;

          responseCount++;
        }
      }
    }
  );

  const totalUniqueDrawings =
    targetDocumentKeys.size;

  const totalEligible =
    approvedCurrent +
    rejectedOpenCurrent +
    rejectedClosedCurrent +
    finalClosedCurrent +
    pendingCurrent +
    unclassifiedCurrent;

  const activeCurrentItems =
    pendingCurrent +
    rejectedOpenCurrent;

  const overduePendingFinal =
    Math.min(
      overduePendingCurrent,
      pendingCurrent
    );

  const overdueRejectedOpenFinal =
    Math.min(
      overdueRejectedOpenCurrent,
      rejectedOpenCurrent
    );

  const overdueFinal =
    Math.min(
      overdueCurrent,
      activeCurrentItems
    );

  const overdueRateOnActive =
    activeCurrentItems > 0
      ? Number(
          (
            (
              overdueFinal /
              activeCurrentItems
            ) *
            100
          ).toFixed(1)
        )
      : 0;

  const approvalRate =
    totalEligible > 0
      ? (
          approvedCurrent /
          totalEligible
        ) * 100
      : 0;

  const rejectionOpenRate =
    totalEligible > 0
      ? (
          rejectedOpenCurrent /
          totalEligible
        ) * 100
      : 0;

  const rejectionClosedRate =
    totalEligible > 0
      ? (
          rejectedClosedCurrent /
          totalEligible
        ) * 100
      : 0;

  const delayRate =
    totalEligible > 0
      ? (
          overdueFinal /
          totalEligible
        ) * 100
      : 0;

  const rejectionResolutionRate =
    totalEntitiesWithRejectionHistory > 0
      ? (
          resolvedRejections /
          totalEntitiesWithRejectionHistory
        ) * 100
      : 0;

  const avgResponseTime =
    responseCount > 0
      ? Number(
          (
            totalResponseDays /
            responseCount
          ).toFixed(1)
        )
      : 0;

  // Mathematical invariants.

  const isWorkloadReconciled =
    totalSubmittedSheets ===
    totalSheetsRev0 +
      totalSheetsFurtherRev;

  const isCurrentStateReconciled =
    totalUniqueDrawings ===
    totalEligible;

  const isOverdueValidSubset =
    overdueFinal <=
    activeCurrentItems;

  const reconciliationPassed =
    isWorkloadReconciled &&
    isCurrentStateReconciled &&
    isOverdueValidSubset;

  return {
    // 1. Workload / Physical Row Grain

    totalSubmittedSheets,

    totalRows:
      totalSubmittedSheets,

    totalSheetsRev0,

    totalSheetsFurtherRev,

    totalDrawingsRev0:
      totalSheetsRev0,

    totalDrawingsFurtherRev:
      totalSheetsFurtherRev,

    rowApproved,

    rowApprovedClosed,

    rowRejectedOpen:
      rejectedOpenRows,

    rowRejectedClosed:
      rejectedClosedRows,

    rowPending,

    totalRejectedRows,

    rejectedOpenRows,

    rejectedClosedRows,

    finalClosedRows,

    rejectionEvents:
      totalRejectedRows,

    rejectionEventsOpen:
      rejectedOpenRows,

    rejectionEventsClosed:
      rejectedClosedRows,

    resolvedRejections,

    rejectionResolutionRate,

    // 2. Current Unique Document/Drawing Grain

    totalUniqueDrawings,

    totalUniqueItems:
      totalUniqueDrawings,

    currentApproved:
      approvedCurrent,

    currentRejectedOpen:
      rejectedOpenCurrent,

    currentRejectedClosed:
      rejectedClosedCurrent,

    currentFinalClosed:
      finalClosedCurrent,

    currentRejected:
      rejectedOpenCurrent +
      rejectedClosedCurrent,

    currentPending:
      pendingCurrent +
      unclassifiedCurrent,

    currentOpen:
      pendingCurrent +
      rejectedOpenCurrent +
      unclassifiedCurrent,

    currentClosed:
      approvedCurrent +
      rejectedClosedCurrent +
      finalClosedCurrent,

    approved:
      approvedCurrent,

    rejectedOpen:
      rejectedOpenCurrent,

    rejectedClosed:
      rejectedClosedCurrent,

    finalClosed:
      finalClosedCurrent,

    totalRejected:
      rejectedOpenCurrent +
      rejectedClosedCurrent,

    pending:
      pendingCurrent,

    unclassified:
      unclassifiedCurrent,

    // 3. Overdue & Performance Metrics

    activeItems:
      activeCurrentItems,

    activeCurrentItems,

    slaEligibleActiveItems:
      slaEligibleActiveCount,

    overdue:
      overdueFinal,

    overduePending:
      overduePendingFinal,

    overdueRejectedOpen:
      overdueRejectedOpenFinal,

    overdueRateOnActive,

    avgResponseTime,

    approvalRate,

    rejectionOpenRate,

    rejectionClosedRate,

    delayRate,

    // 4. Mathematical Invariants

    isWorkloadReconciled,

    isCurrentStateReconciled,

    reconciliationPassed,

    dataQuality,

    // 5. Sequence Integrity & Population Control

    expectedPopulation:
      (() => {
        const primaryDocType =
          validRows[0]
            ?.documentType ||
          validRows[0]
            ?.logType ||
          'DOC-GEN';

        const seqAudit =
          auditRegisterSequence(
            primaryDocType,
            validRows
          );

        return seqAudit.expectedPopulation;
      })(),

    actualRev0Population:
      totalSheetsRev0,

    missingSequenceCount:
      (() => {
        const primaryDocType =
          validRows[0]
            ?.documentType ||
          validRows[0]
            ?.logType ||
          'DOC-GEN';

        const seqAudit =
          auditRegisterSequence(
            primaryDocType,
            validRows
          );

        return seqAudit.missingCount;
      })(),

    missingSequenceIds:
      (() => {
        const primaryDocType =
          validRows[0]
            ?.documentType ||
          validRows[0]
            ?.logType ||
          'DOC-GEN';

        const seqAudit =
          auditRegisterSequence(
            primaryDocType,
            validRows
          );

        return seqAudit.missingIds;
      })(),

    sequenceGapsCount:
      (() => {
        const primaryDocType =
          validRows[0]
            ?.documentType ||
          validRows[0]
            ?.logType ||
          'DOC-GEN';

        const seqAudit =
          auditRegisterSequence(
            primaryDocType,
            validRows
          );

        return seqAudit.sequenceGaps.length;
      })(),

    sequenceAuditReconciled:
      (() => {
        const primaryDocType =
          validRows[0]
            ?.documentType ||
          validRows[0]
            ?.logType ||
          'DOC-GEN';

        const seqAudit =
          auditRegisterSequence(
            primaryDocType,
            validRows
          );

        return seqAudit.isSequenceFullyReconciled;
      })()
  };
}

/**
 * 5. Canonical calculateStats wrapper.
 */
export function calculateStats(
  data: SubmittalRow[],
  fullDataset?: SubmittalRow[]
): KPIStats & {
  totalUniqueDrawings: number;
} {
  return calculateCanonicalKPIs(
    data,
    fullDataset
  );
}

/**
 * 6. Canonical Dataset Builder.
 *
 * Revision lookup is document-level.
 */
export function buildCanonicalDataset(
  rows: SubmittalRow[],
  fullCumulativeRows?: SubmittalRow[],
  cutoffDate?: string
): CanonicalRecord[] {
  const baseRows =
    fullCumulativeRows &&
    fullCumulativeRows.length > 0
      ? fullCumulativeRows
      : rows;

  const revisionMap =
    processRevisionEngine(
      baseRows,
      cutoffDate
    );

  const canonicalRecords:
    CanonicalRecord[] = [];

  const cutoffTime =
    parseDateTimestamp(
      cutoffDate
    );

  rows.forEach(
    row => {
      if (
        cutoffTime > 0 &&
        row.submissionDate
      ) {
        const subTime =
          parseDateTimestamp(
            row.submissionDate
          );

        if (
          subTime > cutoffTime
        ) {
          return;
        }
      }

      const businessEntityKey =
        getBusinessEntityKey(
          row
        );

      const documentIdentityKey =
        getDocumentIdentityKey(
          row
        );

      const groupInfo =
        revisionMap.get(
          documentIdentityKey
        );

      const isLatest =
        groupInfo
          ? groupInfo.latest.id ===
            row.id
          : true;

      const revVal =
        (
          row.rev ||
          ''
        ).trim();

      const isRev0 =
        isValidRevision(
          revVal
        ) &&
        getRevisionWeight(
          revVal
        ) === 0;

      const registerType =
        (
          row.documentType ||
          row.logType ||
          'DOC'
        )
          .toUpperCase()
          .trim();

      const resolvedStatus =
        getStatusCodeCategory(
          row
        );

      canonicalRecords.push({
        id:
          row.id,

        originalRow:
          row,

        registerType,

        businessEntityKey,

        documentIdentityKey,

        revision:
          revVal,

        submissionDate:
          row.submissionDate ||
          '',

        responseDate:
          row.responseDate ||
          '',

        status:
          row.status ||
          '',

        resolvedStatus,

        isLatestRevision:
          isLatest,

        isRev0,

        isHistoricalRev0:
          isRev0,

        hadRejectionHistory:
          groupInfo
            ? groupInfo.hasRejection
            : false,

        isResolvedRejection:
          groupInfo
            ? groupInfo.isResolved
            : false,

        firstSubmissionDate:
          groupInfo &&
          groupInfo.all.length > 0
            ? groupInfo.all[0]
                .submissionDate
            : row.submissionDate ||
              '',

        includeInSubmission:
          true,

        includeInPerformance:
          isLatest
      });
    }
  );

  return canonicalRecords;
}

export function evaluateSubmissionLayer(
  canonicalRecords: CanonicalRecord[],
  fullCumulativeRows?: SubmittalRow[]
) {
  const kpi =
    calculateCanonicalKPIs(
      canonicalRecords.map(
        record =>
          record.originalRow
      ),
      fullCumulativeRows
    );

  return {
    totalSubmitted:
      kpi.totalSubmittedSheets,

    rev00:
      kpi.totalSheetsRev0,

    furtherRevisions:
      kpi.totalSheetsFurtherRev
  };
}

export function evaluatePerformanceLayer(
  canonicalRecords: CanonicalRecord[]
) {
  const kpi =
    calculateCanonicalKPIs(
      canonicalRecords.map(
        record =>
          record.originalRow
      )
    );

  return {
    totalUniqueItems:
      kpi.totalUniqueDrawings ||
      0,

    approved:
      kpi.approved,

    rejectedOpen:
      kpi.rejectedOpen,

    rejectedClosed:
      kpi.rejectedClosed,

    pending:
      kpi.pending
  };
}

export interface EngineeringItemClassification {
  businessEntityKey: string;
  trade: string;
  drawingNo: string;
  sheetNo: string;
  submissionRef: string;
  firstSubmissionDate: string;
  firstRevision: string;
  invalidRevCount: number;
  classification:
    | 'Rev00'
    | 'Further Revision'
    | 'Missing Revision';
  ruleApplied: string;
  explanation: string;
  latestRevision: string;
  latestStatus: string;
  includeInPerformance: boolean;
}

export function evaluateEngineeringItemClassification(
  rows: SubmittalRow[]
): EngineeringItemClassification[] {
  const revisionMap =
    processRevisionEngine(
      rows
    );

  const results:
    EngineeringItemClassification[] =
    [];

  revisionMap.forEach(
    (groupInfo, key) => {
      const invalidRevCount =
        groupInfo.all.filter(
          row =>
            !isValidRevision(
              row.rev
            )
        ).length;

      const validRows =
        groupInfo.all.filter(
          row =>
            isValidRevision(
              row.rev
            )
        );

      const sorted =
        [...groupInfo.all].sort(
          (a, b) => {
            const timeA =
              parseDateTimestamp(
                a.submissionDate
              );

            const timeB =
              parseDateTimestamp(
                b.submissionDate
              );

            if (
              timeA !== timeB
            ) {
              return (
                timeA - timeB
              );
            }

            return (
              a.id || ''
            ).localeCompare(
              b.id || ''
            );
          }
        );

      if (
        sorted.length === 0
      ) {
        return;
      }

      const first =
        sorted[0];

      const latestOverall =
        groupInfo.latest ||
        sorted[
          sorted.length - 1
        ];

      const drawingNo =
        getDrawingNumber(
          latestOverall
        );

      const trade =
        latestOverall.trade ||
        'General';

      let classification:
        | 'Rev00'
        | 'Further Revision'
        | 'Missing Revision' =
        'Missing Revision';

      let latestRevStr =
        '(blank)';

      let ruleApplied =
        '';

      let explanation =
        '';

      /**
       * Classification is based on the canonical revision engine,
       * not on date-first sorting.
       */
      if (
        validRows.length > 0
      ) {
        latestRevStr =
          (
            latestOverall.rev ||
            ''
          ).trim();

        const latestIsValid =
          isValidRevision(
            latestRevStr
          );

        if (
          latestIsValid
        ) {
          const latestWeight =
            getRevisionWeight(
              latestRevStr
            );

          const isRev0 =
            latestWeight === 0;

          if (isRev0) {
            classification =
              'Rev00';

            ruleApplied =
              'Rev00 Baseline Rule: Canonical latest valid revision is 0, 00, or Rev0.';
          } else {
            classification =
              'Further Revision';

            ruleApplied =
              'Further Revision Rule: Canonical latest valid revision is greater than 0 (e.g., 01, Rev1).';
          }
        } else {
          classification =
            'Missing Revision';

          ruleApplied =
            'Missing Revision Rule: No valid canonical latest revision is available.';
        }

        explanation =
          `DocumentIdentityKey '${key}' has ${sorted.length} total submission(s). Latest resolved valid revision: '${latestRevStr}'.` +
          (
            invalidRevCount > 0
              ? ` (Ignored ${invalidRevCount} blank/invalid revision value(s) for revision precedence.)`
              : ''
          );
      } else {
        classification =
          'Missing Revision';

        ruleApplied =
          'Missing Revision Rule: Document has no valid revision values across all history rows.';

        explanation =
          `DocumentIdentityKey '${key}' has ${sorted.length} total submission(s), but all revision values are blank or invalid. Excluded from Rev00/Further Revision.`;
      }

      results.push({
        businessEntityKey:
          key,

        trade,

        drawingNo,

        sheetNo:
          latestOverall.sheetNo ||
          '',

        submissionRef:
          getSubmissionReference(
            latestOverall
          ) ||
          latestOverall.id,

        firstSubmissionDate:
          first.submissionDate ||
          'N/A',

        firstRevision:
          first.rev ||
          'N/A',

        invalidRevCount,

        classification,

        ruleApplied,

        explanation,

        latestRevision:
          latestRevStr,

        latestStatus:
          latestOverall.status ||
          'Pending',

        includeInPerformance:
          classification !==
          'Missing Revision'
      });
    }
  );

  return results;
}

export interface PerformanceValidationRow {
  businessEntityKey: string;
  latestRevision: string;
  latestSubmissionDate: string;
  latestStatus: string;
  resolvedStatus: string;
  includedInPerformance: boolean;
}

export function getPerformanceValidationRows(
  rows: SubmittalRow[]
): PerformanceValidationRow[] {
  const revisionMap =
    processRevisionEngine(
      rows
    );

  const result:
    PerformanceValidationRow[] =
    [];

  revisionMap.forEach(
    (groupInfo, key) => {
      const latest =
        groupInfo.latest;

      result.push({
        businessEntityKey:
          key,

        latestRevision:
          (
            latest.rev ||
            ''
          ).trim(),

        latestSubmissionDate:
          latest.submissionDate ||
          '',

        latestStatus:
          latest.status ||
          '',

        resolvedStatus:
          groupInfo.resolvedStatus,

        includedInPerformance:
          true
      });
    }
  );

  return result;
}

export interface CanonicalTradeResolution {
  trade: string;
  tradeShort: string;
  presentationDisc: string;
}

export function resolveCanonicalTrade(
  row: SubmittalRow
): CanonicalTradeResolution {
  if (!row) {
    return {
      trade:
        'General',

      tradeShort:
        '',

      presentationDisc:
        'GENERAL'
    };
  }

  const checkText = (
    text?: string
  ): CanonicalTradeResolution | null => {
    if (!text) {
      return null;
    }

    const clean =
      text
        .trim()
        .toUpperCase();

    if (
      !clean ||
      [
        'YES',
        'NO',
        'N/A',
        '-',
        'NONE',
        'NULL',
        'UNCLASSIFIED',
        'GENERAL',
        'GEN'
      ].includes(clean)
    ) {
      return null;
    }

    if (
      clean.includes('STR/SUR') ||
      clean.includes('STR-SUR')
    ) {
      return {
        trade:
          'Structural / Survey',

        tradeShort:
          'STR',

        presentationDisc:
          'STR/SUR'
      };
    }

    if (
      clean === 'INF' ||
      clean === 'INFRA' ||
      clean.startsWith('INFRA') ||
      clean === 'INFR' ||
      clean.includes(
        'INFRASTRUCTURE'
      ) ||
      clean.includes(
        'UTILITIES'
      ) ||
      clean.includes(
        'بنية تحتية'
      ) ||
      clean.includes(
        'طرق'
      ) ||
      clean.includes(
        'مرافق'
      )
    ) {
      return {
        trade:
          'Infrastructure',

        tradeShort:
          'INFRA',

        presentationDisc:
          'Infra'
      };
    }

    if (
      clean === 'STR' ||
      clean === 'STRUCT' ||
      clean.startsWith(
        'STRUCTUR'
      ) ||
      clean === 'CIVIL' ||
      clean === 'CVL' ||
      clean.startsWith(
        'CIVIL'
      ) ||
      clean.includes(
        'إنشائي'
      ) ||
      clean.includes(
        'انشائي'
      ) ||
      clean.includes(
        'مدني'
      ) ||
      clean.includes(
        'مدنى'
      )
    ) {
      return {
        trade:
          'Structural',

        tradeShort:
          'STR',

        presentationDisc:
          'STR'
      };
    }

    if (
      clean === 'ARC' ||
      clean === 'ARCH' ||
      clean.startsWith(
        'ARCHITECT'
      ) ||
      clean.includes(
        'معماري'
      ) ||
      clean.includes(
        'معمارى'
      )
    ) {
      return {
        trade:
          'Architectural',

        tradeShort:
          'ARC',

        presentationDisc:
          'Arch'
      };
    }

    if (
      clean === 'MEC' ||
      clean === 'MECH' ||
      clean.startsWith(
        'MECHANIC'
      ) ||
      clean === 'HVAC' ||
      clean.includes(
        'ميكانيك'
      ) ||
      clean.includes(
        'ميكانيكا'
      ) ||
      clean.includes(
        'تكييف'
      )
    ) {
      return {
        trade:
          'Mechanical',

        tradeShort:
          'MEC',

        presentationDisc:
          'Mech'
      };
    }

    if (
      clean === 'ELE' ||
      clean === 'ELEC' ||
      clean.startsWith(
        'ELECTR'
      ) ||
      clean.includes(
        'كهرباء'
      ) ||
      clean.includes(
        'كهربائي'
      ) ||
      clean.includes(
        'كهربائى'
      )
    ) {
      return {
        trade:
          'Electrical',

        tradeShort:
          'ELE',

        presentationDisc:
          'Elec'
      };
    }

    if (
      clean === 'MEP' ||
      clean === 'M.E.P' ||
      clean.includes(
        'كهروميكانيك'
      ) ||
      clean.includes(
        'اليكتروميكانيك'
      ) ||
      clean.includes(
        'الكتروميكانيك'
      )
    ) {
      return {
        trade:
          'MEP',

        tradeShort:
          'MEP',

        presentationDisc:
          'MEP'
      };
    }

    if (
      clean === 'LAND' ||
      clean === 'LND' ||
      clean.startsWith(
        'LANDSCAP'
      ) ||
      clean === 'LNDSCP' ||
      clean.includes(
        'لاندسكيب'
      ) ||
      clean.includes(
        'تنسيق مواقع'
      ) ||
      clean.includes(
        'تنسيق الموقع'
      ) ||
      clean.includes(
        'حدائق'
      ) ||
      clean.includes(
        'زراعة'
      )
    ) {
      return {
        trade:
          'Landscape',

        tradeShort:
          'LAND',

        presentationDisc:
          'Landscape'
      };
    }

    if (
      clean === 'SUR' ||
      clean === 'SURV' ||
      clean.startsWith(
        'SURVEY'
      ) ||
      clean.includes(
        'مساحة'
      ) ||
      clean.includes(
        'مساحه'
      )
    ) {
      return {
        trade:
          'Survey',

        tradeShort:
          'SUR',

        presentationDisc:
          'SURVEY'
      };
    }

    if (
      clean === 'HSE' ||
      clean === 'SAFETY' ||
      clean === 'HEALTH' ||
      clean === 'ENV' ||
      clean.includes(
        'سلامة'
      ) ||
      clean.includes(
        'سلامه'
      ) ||
      clean.includes(
        'بيئة'
      ) ||
      clean.includes(
        'بيئه'
      )
    ) {
      return {
        trade:
          'HSE',

        tradeShort:
          'HSE',

        presentationDisc:
          'HSE'
      };
    }

    if (
      clean === 'IRR' ||
      clean.startsWith(
        'IRRIGAT'
      ) ||
      clean.includes(
        'ري'
      ) ||
      clean.includes(
        'رى'
      )
    ) {
      return {
        trade:
          'Irrigation',

        tradeShort:
          'IRR',

        presentationDisc:
          'IRR'
      };
    }

    return null;
  };

  // 1. Explicit discipline
  const fromDisc =
    checkText(
      row.discipline
    );

  if (fromDisc) {
    return fromDisc;
  }

  // 2. Explicit trade
  const fromTrade =
    checkText(
      row.trade
    );

  if (fromTrade) {
    return fromTrade;
  }

  // 3. Context discipline / composite identity
  const rowRecord =
    row as unknown as Record<
      string,
      unknown
    >;

  const compositeIdentity =
    rowRecord.compositeIdentity as
      | Record<
          string,
          unknown
        >
      | undefined;

  const fromContext =
    checkText(
      String(
        rowRecord.contextDiscipline ||
        ''
      )
    ) ||
    checkText(
      String(
        compositeIdentity?.discipline ||
        ''
      )
    );

  if (fromContext) {
    return fromContext;
  }

  // 4. Trade short
  const fromTradeShort =
    checkText(
      String(
        rowRecord.tradeShort ||
        ''
      )
    );

  if (fromTradeShort) {
    return fromTradeShort;
  }

  // 5. Document type suffix
  if (row.documentType) {
    const parts =
      row.documentType.split(
        /[-_/ ]+/
      );

    if (
      parts.length > 1
    ) {
      const suffix =
        parts[
          parts.length - 1
        ];

      const fromDocType =
        checkText(
          suffix
        );

      if (fromDocType) {
        return fromDocType;
      }
    }
  }

  // 6. Strict token match in docNo
  if (row.docNo) {
    let tokens =
      row.docNo
        .split(
          /[-_ \/(),&.]+/
        )
        .filter(Boolean);

    if (
      tokens.length > 2 &&
      tokens[0].toUpperCase() ===
        'INN' &&
      (
        tokens[1].toUpperCase() ===
          'ARC' ||
        tokens[1].toUpperCase() ===
          'ACE'
      )
    ) {
      tokens =
        tokens.slice(2);
    }

    for (
      const token of tokens
    ) {
      const fromToken =
        checkText(
          token
        );

      if (fromToken) {
        return fromToken;
      }
    }
  }

  const rawD =
    (
      row.discipline ||
      row.trade ||
      ''
    ).trim();

  return {
    trade:
      rawD ||
      'General',

    tradeShort:
      '',

    presentationDisc:
      rawD ||
      'GENERAL'
  };
}

export function resolveRowDiscipline(
  row: SubmittalRow,
  baseType?: string
): string {
  void baseType;

  if (!row) {
    return 'GENERAL';
  }

  const resolved =
    resolveCanonicalTrade(
      row
    );

  return resolved.presentationDisc;
}

export function calculateNCRStats(
  data: SubmittalRow[],
  fullDataset?: SubmittalRow[] | boolean
): any {
  const dataset =
    Array.isArray(
      fullDataset
    )
      ? fullDataset
      : undefined;

  const kpi =
    calculateCanonicalKPIs(
      data,
      dataset
    );

  return {
    ...kpi,

    discipline:
      '',

    totalUnique:
      kpi.totalUniqueDrawings,

    notSent:
      0,

    underReview:
      kpi.pending,

    rejectedOpen:
      kpi.rejectedOpen,

    approvedClosed:
      kpi.approved,

    open:
      kpi.pending +
      kpi.rejectedOpen,

    closed:
      kpi.approved +
      kpi.rejectedClosed,

    approved:
      kpi.approved,

    rejected:
      kpi.rejectedOpen,

    waiting:
      kpi.pending
  };
}

export function calculateSORStats(
  data: SubmittalRow[],
  fullDataset?: SubmittalRow[] | boolean
): any {
  const dataset =
    Array.isArray(
      fullDataset
    )
      ? fullDataset
      : undefined;

  const kpi =
    calculateCanonicalKPIs(
      data,
      dataset
    );

  return {
    ...kpi,

    discipline:
      '',

    totalUnique:
      kpi.totalUniqueDrawings,

    notSent:
      0,

    underReview:
      kpi.pending,

    rejectedOpen:
      kpi.rejectedOpen,

    approvedClosed:
      kpi.approved,

    open:
      kpi.pending +
      kpi.rejectedOpen,

    closed:
      kpi.approved +
      kpi.rejectedClosed,

    approved:
      kpi.approved,

    rejected:
      kpi.rejectedOpen,

    waiting:
      kpi.pending
  };
}

export function calculateLTRStats(
  data: SubmittalRow[],
  fullDataset?: SubmittalRow[] | boolean
): any {
  const dataset =
    Array.isArray(
      fullDataset
    )
      ? fullDataset
      : undefined;

  const kpi =
    calculateCanonicalKPIs(
      data,
      dataset
    );

  let inCount = 0;
  let outCount = 0;

  (data || []).forEach(
    row => {
      const record =
        row as unknown as Record<
          string,
          unknown
        >;

      const dir =
        String(
          record.direction ||
          record.letterDirection ||
          ''
        ).toUpperCase();

      if (
        dir === 'IN' ||
        record.direction === 'IN'
      ) {
        inCount++;
      } else if (
        dir === 'OUT' ||
        record.direction === 'OUT'
      ) {
        outCount++;
      } else {
        inCount++;
      }
    }
  );

  return {
    ...kpi,

    totalDrawingsRev0:
      inCount,

    totalDrawingsFurtherRev:
      outCount,

    totalSheetsRev0:
      inCount,

    totalSheetsFurtherRev:
      outCount,

    stakeholder:
      '',

    totalUnique:
      kpi.totalUniqueDrawings,

    open:
      kpi.pending +
      kpi.rejectedOpen,

    closed:
      kpi.approved +
      kpi.rejectedClosed,

    approved:
      kpi.approved,

    rejected:
      kpi.rejectedOpen,

    pending:
      kpi.pending,

    overdue:
      kpi.overdue
  };
}

export function exportPerformanceValidationCsv(
  rows: SubmittalRow[]
): string {
  const perfRows =
    getPerformanceValidationRows(
      rows
    );

  let csv =
    'BusinessEntityKey,Latest Revision,Latest Submission Date,Latest Status,Resolved Status,Included In Performance\n';

  perfRows.forEach(
    row => {
      csv +=
        `"${row.businessEntityKey}","${row.latestRevision}","${row.latestSubmissionDate}","${row.latestStatus}","${row.resolvedStatus}","${row.includedInPerformance}"\n`;
    }
  );

  return csv;
}
```
