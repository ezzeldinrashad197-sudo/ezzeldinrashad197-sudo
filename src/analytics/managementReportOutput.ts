/**
 * DEDICATED MANAGEMENT REPORT OUTPUT LAYER
 *
 * Official KPI Table Schema (Dual-Grain):
 * Status | Total Submittals | Rev.00 | Further Rev. | Total Sheets | Approved | Rejected | Pending
 *
 * Required Disciplines:
 * STR, ARCH, MECH, ELEC, INFRA, LAND, GRAND TOTAL
 *
 * Explicit & Deterministic Dual-Grain Definitions (Strict Separation of Grains):
 *
 * 1. UNIQUE SUBMITTAL GRAIN (Total Submittals & Current Status Columns):
 *    - Total Submittals = Unique submitted items/submittals after grouping by canonical Submittal Identity
 *                         (`getSubmissionIdentityKey(row)` = Register + Discipline + SUB Ref).
 *                         This is NEVER the raw Excel row count and NEVER the 4,907 individual drawing-sheet grain.
 *    - Approved         = Unique Submittals currently in Approved / Closed state.
 *    - Rejected         = Unique Submittals currently in active Rejected (Open) state.
 *    - Pending          = Unique Submittals currently in Pending / Under Review state.
 *    - Invariant: Total Submittals = Approved + Rejected + Pending
 *
 * 2. RAW EXCEL ROW GRAIN (Revision Workload Columns):
 *    - Rev.00       = Total actual Excel source rows classified as Rev.00.
 *    - Further Rev. = Total actual Excel source rows classified as Further Revision.
 *    - Total Sheets = Rev.00 + Further Rev. (total actual Excel source rows).
 *    - Invariant: Total Sheets = Rev.00 + Further Rev.
 *
 * CRITICAL DISTINCTION:
 * A document/submittal with Rev.00 + Rev.01 + Rev.02:
 * - counts as ONE Total Submittal (and ONE in Approved / Rejected / Pending)
 * - contributes ONE Rev.00 row
 * - contributes TWO Further Rev. rows
 * - contributes THREE Total Sheets.
 *
 * Do NOT merge these two grains. Do NOT modify the Calculation SSOT.
 */

import { SubmittalRow } from '../types';
import {
  getDocumentIdentityKey,
  getSubmissionIdentityKey,
  parseDateTimestamp,
  resolveRowDiscipline
} from './calculationFoundation';
import {
  isRevision0,
  isFurtherRevision,
  extractRevisionRaw,
  getRevisionWeight,
  compareRevisionsCanonical as compareRevisions
} from './revisionResolver';
import { getStatusCodeCategory, CanonicalStatus } from './statusResolver';

export function isExcludedRow(row: SubmittalRow): boolean {
  if (!row) return true;
  if (row.excludeFromKPI === true || (row as any).isExcluded === true) return true;
  return false;
}

export function resolveRowRegister(d: SubmittalRow): string {
  if (!d) return 'UNCLASSIFIED';
  if (d.registerIdentity && d.registerIdentity !== 'UNCLASSIFIED') {
    const reg = d.registerIdentity.trim().toUpperCase();
    return reg === 'SHD' ? 'SDW' : reg === 'LETTER' ? 'LTR' : reg;
  }
  if (d.workflowFamily && d.workflowFamily !== 'UNKNOWN') {
    const wf = d.workflowFamily.toUpperCase().trim();
    if (wf === 'LETTER') return 'LTR';
    if (['SDW', 'SHD', 'ABD', 'MIR', 'WIR', 'MAR', 'QS', 'RFI', 'NCR', 'SOR', 'DOC', 'LTR', 'PQ', 'PRQ', 'TRS'].includes(wf)) {
      return wf === 'SHD' ? 'SDW' : wf;
    }
  }
  const pureDisciplines = new Set(['STR', 'ARCH', 'ARC', 'MECH', 'MEC', 'ELEC', 'ELE', 'INFRA', 'INF', 'LND', 'LAND', 'LANDSCAPE', 'GEN', 'GENERAL']);
  const srcId = (d.sourceRegisterIdentity || '').toUpperCase().trim();
  if (srcId && !pureDisciplines.has(srcId) && srcId !== 'UNCLASSIFIED') {
    if (srcId.startsWith('DOC') || srcId.includes('TECHNICAL') || srcId.includes('TRANSMITTAL') || srcId.includes('DOCUMENT')) return 'DOC';
    if (srcId.startsWith('WIR') || srcId.includes('WORK INSP')) return 'WIR';
    if (srcId.startsWith('MIR') || srcId.includes('MATERIAL INSP')) return 'MIR';
    if (srcId.startsWith('MAR') || srcId.includes('MATERIAL SUB') || srcId.includes('MATERIAL APP')) return 'MAR';
    if (srcId.startsWith('RFI') || srcId.includes('REQUEST FOR INFO')) return 'RFI';
    if (srcId.startsWith('NCR') || srcId.includes('NON CONFORM') || srcId.includes('NON-CONFORM')) return 'NCR';
    if (srcId.startsWith('SOR') || srcId.includes('SITE OBS') || srcId.includes('SITE-OBS')) return 'SOR';
    if (srcId.startsWith('ABD') || srcId.includes('AS-BUILT') || srcId.includes('AS BUILT')) return 'ABD';
    if (srcId.startsWith('LTR') || srcId.startsWith('LETTER') || srcId.includes('CORRES')) return 'LTR';
    if (srcId.startsWith('QS') || srcId.includes('QUANTITY')) return 'QS';
    if (srcId.startsWith('SDW') || srcId.startsWith('SHD') || srcId.includes('SHOP') || srcId.includes('DRAWING')) return 'SDW';
  }
  const docT = (d.documentType || '').toUpperCase().trim();
  const docNo = (d.docNo || '').toUpperCase().trim();
  const lt = (d.logType || '').toUpperCase().trim();
  const sf = (d.sourceFile || '').toUpperCase().trim();
  if (docT.startsWith('ABD') || docT.includes('AS-BUILT') || docT.includes('AS BUILT') || docNo.startsWith('ABD') || lt.includes('ABD') || sf.includes('ABD')) return 'ABD';
  if (docT.startsWith('WIR') || docT.includes('WIR') || docNo.startsWith('WIR') || lt.includes('WIR') || sf.includes('WIR')) return 'WIR';
  if (docT.startsWith('MIR') || docT.includes('MIR') || docNo.startsWith('MIR') || lt.includes('MIR') || sf.includes('MIR')) return 'MIR';
  if (docT.startsWith('MAR') || docT.includes('MAR') || docNo.startsWith('MAR') || lt.includes('MAR') || sf.includes('MAR')) return 'MAR';
  if (docT.startsWith('RFI') || docT.includes('RFI') || docNo.startsWith('RFI') || lt.includes('RFI') || sf.includes('RFI')) return 'RFI';
  if (docT.startsWith('NCR') || docT.includes('NCR') || docNo.startsWith('NCR') || lt.includes('NCR') || sf.includes('NCR')) return 'NCR';
  if (docT.startsWith('SOR') || docT.includes('SOR') || docNo.startsWith('SOR') || lt.includes('SOR') || sf.includes('SOR')) return 'SOR';
  if (docT.startsWith('LTR') || docT.includes('LETTER') || docT.includes('CORRES') || docNo.startsWith('LTR') || lt.includes('LTR') || sf.includes('LTR')) return 'LTR';
  if (docT.startsWith('QS') || docT.includes('QS') || docNo.startsWith('QS') || lt.includes('QS') || sf.includes('QS')) return 'QS';
  if (docT.startsWith('DOC') || docT.includes('DOCUMENT') || docT.includes('TECHNICAL') || docNo.startsWith('DOC') || lt.includes('DOC') || sf.includes('DOC')) return 'DOC';
  if (docT.startsWith('SDW') || docT.startsWith('SHD') || docT.includes('SHOP') || docT.includes('DRAWING') || docNo.startsWith('SDW') || docNo.startsWith('SHD') || lt.includes('SDW') || sf.includes('SDW')) return 'SDW';
  return 'UNCLASSIFIED';
}

export type ManagementDiscipline = 'STR' | 'ARCH' | 'MECH' | 'ELEC' | 'INFRA' | 'LAND';

export const OFFICIAL_MANAGEMENT_DISCIPLINES: ManagementDiscipline[] = [
  'STR',
  'ARCH',
  'MECH',
  'ELEC',
  'INFRA',
  'LAND'
];

export type ManagementKpiColumnKey =
  | 'totalSubmittals'
  | 'rev00'
  | 'furtherRev'
  | 'totalSheets'
  | 'uniqueItems'
  | 'rev00Rows'
  | 'furtherRevRows'
  | 'totalRows'
  | 'approved'
  | 'rejected'
  | 'pending';

/**
 * Exact read-only source record contributing to a Management Report KPI.
 * Contains only actual fields present on the loaded Excel row (no synthetic or inferred values).
 */
export interface ReconciledSourceRecord {
  id: string;
  rowId: string;
  registerIdentity: string;
  discipline: ManagementDiscipline;
  officialDiscipline: ManagementDiscipline;
  documentNo: string;
  subRef: string;
  drawingNo: string;
  rev: string;
  revision: string;
  isRev0: boolean;
  rawCode: string;
  rawStatus: string;
  resolvedCategory: CanonicalStatus;
  submissionDate: string;
  responseDate: string;
  sourceSheet: string;
  sourceFile: string;
  documentIdentityKey: string;
  submissionIdentityKey: string;
  isCurrentWinningRevision: boolean;
  revisionCountForItem: number;
  revisionCountForDocument: number;
  allRevisionsForItem: string[];
  allRevisionsForDocument?: { rev: string; rawCode: string }[];
}

export interface ManagementReportRow {
  discipline: ManagementDiscipline | 'GRAND TOTAL';
  /** Unique Submittal Grain: number of unique submitted items (Approved + Rejected + Pending) */
  totalSubmittals: number;
  /** Raw Excel Row Grain: total actual Excel source rows classified as Rev.00 */
  rev00: number;
  /** Raw Excel Row Grain: total actual Excel source rows classified as Further Revision */
  furtherRev: number;
  /** Raw Excel Row Grain: Rev.00 + Further Rev. */
  totalSheets: number;
  /** Backward-compatible aliases */
  uniqueItems: number;
  rev00Rows: number;
  furtherRevRows: number;
  totalRows: number;
  /** Unique Submittal Grain: current Unique Submittals in Approved state */
  approved: number;
  /** Unique Submittal Grain: current Unique Submittals in Rejected state */
  rejected: number;
  /** Breakdown of current Unique Submittals in Rejected state (Open vs Historical Closed) for audit visibility */
  rejectedOpen: number;
  rejectedClosed: number;
  /** Unique Submittal Grain: current Unique Submittals in Pending state */
  pending: number;
  /** Diagnostic count of superseded historical rows (raw rows - unique submittals) for audit reconciliation */
  supersededTotalRows: number;
  supersededRev00Rows: number;
  supersededFurtherRevRows: number;
}

export interface ManagementDisciplineRow extends ManagementReportRow {
  reconciliation: {
    totalSubmittals: ReconciledSourceRecord[];
    rev00: ReconciledSourceRecord[];
    furtherRev: ReconciledSourceRecord[];
    totalSheets: ReconciledSourceRecord[];
    uniqueItems: ReconciledSourceRecord[];
    rev00Rows: ReconciledSourceRecord[];
    furtherRevRows: ReconciledSourceRecord[];
    totalRows: ReconciledSourceRecord[];
    approved: ReconciledSourceRecord[];
    rejected: ReconciledSourceRecord[];
    pending: ReconciledSourceRecord[];
  };
}

export interface ManagementReportValidation {
  /** Verifies Total Submittals = Approved + Rejected + Pending for every discipline and GRAND TOTAL */
  totalSubmittalsEqualsStatusSum: boolean;
  /** Verifies Total Sheets = Rev.00 + Further Rev. for every discipline and GRAND TOTAL */
  totalSheetsEqualsRevisionRowSum: boolean;
  /** Backward-compatible aliases */
  uniqueItemsEqualsStatusSum: boolean;
  totalRowsEqualsRevisionRowSum: boolean;
  /** Verifies GRAND TOTAL equals the exact sum of the 6 official disciplines across all 7 columns */
  grandTotalEqualsDisciplineSum: boolean;
}

export interface ManagementReportOutput {
  registerFilter: string;
  availableRegisters: string[];
  rows: ManagementDisciplineRow[];
  grandTotal: ManagementDisciplineRow;
  excludedRowsCount: number;
  otherDisciplineRowsCount: number;
  isFullyReconciled: boolean;
  validation: ManagementReportValidation;
}

export interface UniqueSubmittalGroupResolution {
  submissionIdentityKey: string;
  latest: SubmittalRow;
  all: SubmittalRow[];
  latestSheets: SubmittalRow[];
  managementStatus: 'APPROVED' | 'REJECTED' | 'PENDING';
  resolvedCategory: CanonicalStatus;
  hasHistoricalClosedRejectionAtLatest: boolean;
}

/**
 * Resolves Unique Submittal groups by canonical Submission Identity Key (`getSubmissionIdentityKey(row)`).
 * Preserves existing SSOT revision precedence (`getRevisionWeight` / `compareRevisions`) and
 * status resolution (`getStatusCodeCategory`).
 *
 * Official Management Report Status Rule at Unique Submittal Grain:
 * - REJECTED: Any sheet at the latest revision of the submittal is actively rejected (`REJECTED_OPEN`).
 * - PENDING:  No sheet is `REJECTED_OPEN`, and at least one sheet at the latest revision is `PENDING` or `UNCLASSIFIED`.
 * - APPROVED: All sheets at the latest revision are closed/approved (`APPROVED`, `REJECTED_CLOSED`, `FINAL_CLOSED`).
 *   This guarantees `Total Submittals = Approved + Rejected + Pending` at Unique Submittal Grain.
 */
export function processUniqueSubmittalEngine(
  rows: SubmittalRow[],
  asOfDate?: Date | string
): Map<string, UniqueSubmittalGroupResolution> {
  const groups = new Map<string, SubmittalRow[]>();
  const cutoff = asOfDate ? parseDateTimestamp(asOfDate) : Infinity;

  rows.forEach(row => {
    if (isExcludedRow(row)) return;

    if (cutoff !== Infinity && row.submissionDate) {
      const subTime = parseDateTimestamp(row.submissionDate);
      if (subTime > cutoff) return;
    }

    const subKey = getSubmissionIdentityKey(row);
    let bucket = groups.get(subKey);
    if (!bucket) {
      bucket = [];
      groups.set(subKey, bucket);
    }
    bucket.push(row);
  });

  const result = new Map<string, UniqueSubmittalGroupResolution>();

  groups.forEach((groupRows, subKey) => {
    let maxWeight = -1;
    groupRows.forEach(r => {
      const w = getRevisionWeight(extractRevisionRaw(r));
      if (w > maxWeight) {
        maxWeight = w;
      }
    });

    const latestSheets = groupRows.filter(
      r => getRevisionWeight(extractRevisionRaw(r)) === maxWeight
    );

    const sorted = [...groupRows].sort((a, b) => {
      const revDiff = compareRevisions(extractRevisionRaw(a), extractRevisionRaw(b));
      if (revDiff !== 0) return revDiff;

      const timeA = parseDateTimestamp(a.submissionDate);
      const timeB = parseDateTimestamp(b.submissionDate);
      if (timeA !== timeB) return timeA - timeB;

      return (a.id || '').localeCompare(b.id || '');
    });

    const latest = latestSheets[0] || sorted[sorted.length - 1];
    const targetSheets = latestSheets.length > 0 ? latestSheets : [latest];
    const sheetCategories = targetSheets.map(r => getStatusCodeCategory(r));

    let managementStatus: 'APPROVED' | 'REJECTED' | 'PENDING' = 'APPROVED';
    let resolvedCategory: CanonicalStatus = 'APPROVED';
    let hasHistoricalClosedRejectionAtLatest = false;

    if (sheetCategories.includes('REJECTED_OPEN')) {
      managementStatus = 'REJECTED';
      resolvedCategory = 'REJECTED_OPEN';
    } else if (sheetCategories.includes('PENDING') || sheetCategories.includes('UNCLASSIFIED')) {
      managementStatus = 'PENDING';
      resolvedCategory = sheetCategories.includes('PENDING') ? 'PENDING' : 'UNCLASSIFIED';
    } else {
      managementStatus = 'APPROVED';
      if (sheetCategories.includes('REJECTED_CLOSED')) {
        hasHistoricalClosedRejectionAtLatest = true;
      }
      resolvedCategory = sheetCategories.includes('APPROVED')
        ? 'APPROVED'
        : sheetCategories.includes('REJECTED_CLOSED')
        ? 'REJECTED_CLOSED'
        : 'FINAL_CLOSED';
    }

    result.set(subKey, {
      submissionIdentityKey: subKey,
      latest,
      all: sorted,
      latestSheets: targetSheets,
      managementStatus,
      resolvedCategory,
      hasHistoricalClosedRejectionAtLatest
    });
  });

  return result;
}

/**
 * Helper to compute Dual-Grain Management Report KPIs for any subset of rows (e.g., a single register/discipline slice).
 */
export function resolveUniqueSubmittalStats(
  periodRows: SubmittalRow[],
  fullDataset?: SubmittalRow[]
): {
  totalSubmittals: number;
  rev00: number;
  furtherRev: number;
  totalSheets: number;
  approved: number;
  rejected: number;
  pending: number;
  rejectedOpen: number;
  rejectedClosed: number;
} {
  const validRows = (periodRows || []).filter(r => !isExcludedRow(r));
  let rev00 = 0;
  let furtherRev = 0;

  const targetSubKeys = new Set<string>();
  validRows.forEach(r => {
    const rawRev = extractRevisionRaw(r);
    const isRev0 = isRevision0(rawRev, r.isRev0);
    const isFurther = !isRev0 && isFurtherRevision(rawRev, r.isRev0);
    if (isRev0) {
      rev00++;
    } else if (isFurther) {
      furtherRev++;
    }
    targetSubKeys.add(getSubmissionIdentityKey(r));
  });

  const baseForRevisions =
    fullDataset && fullDataset.length > 0 ? fullDataset : validRows;
  const subMap = processUniqueSubmittalEngine(baseForRevisions);

  let approved = 0;
  let rejected = 0;
  let pending = 0;
  let rejectedOpen = 0;
  let rejectedClosed = 0;

  targetSubKeys.forEach(subKey => {
    const group = subMap.get(subKey);
    if (!group) return;
    if (group.managementStatus === 'REJECTED') {
      rejected++;
      rejectedOpen++;
    } else if (group.managementStatus === 'PENDING') {
      pending++;
    } else {
      approved++;
      if (group.hasHistoricalClosedRejectionAtLatest) {
        rejectedClosed++;
      }
    }
  });

  return {
    totalSubmittals: targetSubKeys.size,
    rev00,
    furtherRev,
    totalSheets: rev00 + furtherRev,
    approved,
    rejected,
    pending,
    rejectedOpen,
    rejectedClosed
  };
}

/**
 * Deterministic canonical discipline mapper to the 6 official Management Report rows:
 * STR, ARCH, MECH, ELEC, INFRA, LAND
 */
export function resolveManagementDiscipline(row: SubmittalRow): ManagementDiscipline | null {
  const reg = resolveRowRegister(row);
  const resolved = (resolveRowDiscipline(row, reg) || '').trim().toUpperCase();
  const candidates = [
    resolved,
    (row.disciplineCode || '').trim().toUpperCase(),
    (row.discipline || '').trim().toUpperCase(),
    (row.trade || '').trim().toUpperCase(),
    ((row as any).tradeShort || '').trim().toUpperCase()
  ];

  for (const token of candidates) {
    if (!token) continue;
    if (
      token === 'STR' ||
      token === 'STRUCTURAL' ||
      token === 'STRUCTURE' ||
      token === 'STR/SUR' ||
      token.startsWith('STR')
    ) {
      return 'STR';
    }
    if (
      token === 'ARCH' ||
      token === 'ARC' ||
      token === 'ARCHITECTURAL' ||
      token === 'ARCHITECTURE' ||
      token === 'ID' ||
      token === 'INTERIOR' ||
      token.startsWith('ARC')
    ) {
      return 'ARCH';
    }
    if (
      token === 'MECH' ||
      token === 'MEC' ||
      token === 'MECHANICAL' ||
      token === 'HVAC' ||
      token === 'PLU' ||
      token === 'PLUMBING' ||
      token === 'FIR' ||
      token === 'FF' ||
      token === 'FIRE' ||
      token === 'MEP' ||
      token.startsWith('MEC')
    ) {
      return 'MECH';
    }
    if (
      token === 'ELEC' ||
      token === 'ELE' ||
      token === 'ELECTRICAL' ||
      token === 'ELV' ||
      token === 'ICT' ||
      token.startsWith('ELE')
    ) {
      return 'ELEC';
    }
    if (
      token === 'INFRA' ||
      token === 'INF' ||
      token === 'INFR' ||
      token === 'INFRASTRUCTURE' ||
      token === 'CIVIL' ||
      token === 'ROADS' ||
      token === 'UTILITIES' ||
      token.startsWith('INF')
    ) {
      return 'INFRA';
    }
    if (
      token === 'LAND' ||
      token === 'LND' ||
      token === 'LANDSCAPE' ||
      token === 'IRR' ||
      token === 'IRRIGATION' ||
      token === 'HARDSCAPE' ||
      token === 'SOFTSCAPE' ||
      token.startsWith('LND') ||
      token.startsWith('LAN')
    ) {
      return 'LAND';
    }
  }

  return null;
}

function toReconciledRecord(
  r: SubmittalRow,
  discipline: ManagementDiscipline,
  resolvedCategory: CanonicalStatus,
  isCurrentWinningRevision: boolean,
  revisionCountForItem: number = 1,
  allRevisionsForItem: string[] = []
): ReconciledSourceRecord {
  const anyR = r as Record<string, any>;
  const reg = resolveRowRegister(r);
  const subRef = r.submissionRef || anyR.submittalRef || r.docNo || '-';
  const docNo = r.docNo || r.submissionRef || r.drawingNo || r.sheetNo || r.id || '-';
  const drawingNo = r.drawingNo || r.sheetNo || '-';
  const revision = extractRevisionRaw(r) || r.rev || '00';
  const isRev0Flag = isRevision0(revision, r.isRev0);
  const rawCode = String(r.code ?? r.status ?? '-');
  const rawStatus = String(r.recordStatus ?? r.workflowStage ?? anyR.rawStatus ?? '-');
  const sourceSheet = r.sourceSheetName || r.disciplineSourceSheet || r.logType || '-';
  const sourceFile = r.sourceFile || r.sourceWorkbookName || r.sourceFileName || '-';
  const revsList = allRevisionsForItem.length > 0 ? allRevisionsForItem : [revision];

  return {
    id: r.id || '-',
    rowId: r.id || '-',
    registerIdentity: reg,
    discipline,
    officialDiscipline: discipline,
    documentNo: docNo,
    subRef,
    drawingNo,
    rev: revision,
    revision,
    isRev0: isRev0Flag,
    rawCode,
    rawStatus,
    resolvedCategory,
    submissionDate: r.submissionDate || '-',
    responseDate: r.responseDate || '-',
    sourceSheet,
    sourceFile,
    documentIdentityKey: getDocumentIdentityKey(r),
    submissionIdentityKey: getSubmissionIdentityKey(r),
    isCurrentWinningRevision,
    revisionCountForItem,
    revisionCountForDocument: revisionCountForItem,
    allRevisionsForItem: revsList,
    allRevisionsForDocument: revsList.map(rv => ({ rev: rv, rawCode }))
  };
}

function createEmptyDisciplineRow(
  discipline: ManagementDiscipline | 'GRAND TOTAL'
): ManagementDisciplineRow {
  return {
    discipline,
    totalSubmittals: 0,
    rev00: 0,
    furtherRev: 0,
    totalSheets: 0,
    uniqueItems: 0,
    rev00Rows: 0,
    furtherRevRows: 0,
    totalRows: 0,
    approved: 0,
    rejected: 0,
    rejectedOpen: 0,
    rejectedClosed: 0,
    pending: 0,
    supersededTotalRows: 0,
    supersededRev00Rows: 0,
    supersededFurtherRevRows: 0,
    reconciliation: {
      totalSubmittals: [],
      rev00: [],
      furtherRev: [],
      totalSheets: [],
      uniqueItems: [],
      rev00Rows: [],
      furtherRevRows: [],
      totalRows: [],
      approved: [],
      rejected: [],
      pending: []
    }
  };
}

/**
 * Computes the official 8-column Dual-Grain Management Report KPI table:
 * Status | Total Submittals | Rev.00 | Further Rev. | Total Sheets | Approved | Rejected | Pending
 *
 * - Statuses (`Total Submittals`, `Approved`, `Rejected`, `Pending`) are computed at UNIQUE SUBMITTAL GRAIN
 *   using `getSubmissionIdentityKey(row)`.
 * - Revisions (`Rev.00`, `Further Rev.`, `Total Sheets`) are computed at RAW EXCEL ROW GRAIN.
 *
 * Both Monthly and Cumulative reports call this exact same function; only `periodRows` changes.
 */
export function buildManagementReportOutput(
  periodRows: SubmittalRow[],
  fullDataset?: SubmittalRow[],
  registerFilter: string = 'ALL'
): ManagementReportOutput {
  const registerSet = new Set<string>();
  let excludedRowsCount = 0;

  const validPeriodRows: SubmittalRow[] = [];
  for (let i = 0; i < periodRows.length; i++) {
    const r = periodRows[i];
    if (isExcludedRow(r)) {
      excludedRowsCount++;
      continue;
    }
    const reg = resolveRowRegister(r);
    if (reg && reg !== 'NCR' && reg !== 'SOR' && reg !== 'LTR' && reg !== 'UNCLASSIFIED') {
      registerSet.add(reg);
    }
    validPeriodRows.push(r);
  }

  const registerOrder = ['SDW', 'SHD', 'MAR', 'DOC', 'WIR', 'MIR', 'RFI', 'ABD', 'QS', 'PQ', 'PRQ', 'TRS'];
  const availableRegisters = Array.from(registerSet).sort((a, b) => {
    const idxA = registerOrder.indexOf(a);
    const idxB = registerOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const normalizedFilter = (registerFilter || 'ALL').trim().toUpperCase();
  const filteredRows =
    normalizedFilter === 'ALL'
      ? validPeriodRows
      : validPeriodRows.filter(r => resolveRowRegister(r) === normalizedFilter);

  const baseForRevisions =
    fullDataset && fullDataset.length > 0 ? fullDataset : filteredRows;
  const submittalMap = processUniqueSubmittalEngine(baseForRevisions);

  const disciplineMap = new Map<ManagementDiscipline, ManagementDisciplineRow>();
  OFFICIAL_MANAGEMENT_DISCIPLINES.forEach(d => {
    disciplineMap.set(d, createEmptyDisciplineRow(d));
  });

  let otherDisciplineRowsCount = 0;

  // Track unique submittal keys seen in the reporting period per discipline
  const periodSubKeysByDiscipline = new Map<ManagementDiscipline, Set<string>>();
  OFFICIAL_MANAGEMENT_DISCIPLINES.forEach(d => {
    periodSubKeysByDiscipline.set(d, new Set<string>());
  });

  // Track raw row counts per discipline for superseded audit calculation
  const rawRowStatsByDiscipline = new Map<
    ManagementDiscipline,
    { total: number; rev00: number; further: number }
  >();
  OFFICIAL_MANAGEMENT_DISCIPLINES.forEach(d => {
    rawRowStatsByDiscipline.set(d, { total: 0, rev00: 0, further: 0 });
  });

  // 1. RAW EXCEL ROW GRAIN PASS (Rev.00, Further Rev., Total Sheets) + Collect Unique Submittal Keys
  for (let i = 0; i < filteredRows.length; i++) {
    const row = filteredRows[i];
    const disc = resolveManagementDiscipline(row);
    if (!disc) {
      otherDisciplineRowsCount++;
      continue;
    }

    const acc = disciplineMap.get(disc)!;
    const rawStat = rawRowStatsByDiscipline.get(disc)!;
    const subKey = getSubmissionIdentityKey(row);
    const group = submittalMap.get(subKey);
    const isWinning = group ? group.latest === row : Boolean(row.isLatestRev);
    const rowCat = getStatusCodeCategory(row);
    const revCount = group ? group.all.length : 1;
    const allRevs = group
      ? group.all.map(item => extractRevisionRaw(item) || item.rev || '00')
      : [extractRevisionRaw(row) || row.rev || '00'];

    const rawRev = extractRevisionRaw(row);
    const isRev0 = isRevision0(rawRev, row.isRev0);
    const isFurther = !isRev0 && isFurtherRevision(rawRev, row.isRev0);

    const rec = toReconciledRecord(row, disc, rowCat, isWinning, revCount, allRevs);

    rawStat.total++;
    if (isRev0) {
      rawStat.rev00++;
      acc.rev00++;
      acc.rev00Rows++;
      acc.reconciliation.rev00.push(rec);
      acc.reconciliation.rev00Rows.push(rec);
      acc.totalSheets++;
      acc.totalRows++;
      acc.reconciliation.totalSheets.push(rec);
      acc.reconciliation.totalRows.push(rec);
    } else if (isFurther) {
      rawStat.further++;
      acc.furtherRev++;
      acc.furtherRevRows++;
      acc.reconciliation.furtherRev.push(rec);
      acc.reconciliation.furtherRevRows.push(rec);
      acc.totalSheets++;
      acc.totalRows++;
      acc.reconciliation.totalSheets.push(rec);
      acc.reconciliation.totalRows.push(rec);
    }

    periodSubKeysByDiscipline.get(disc)!.add(subKey);
  }

  // 2. UNIQUE SUBMITTAL GRAIN PASS (Total Submittals, Approved, Rejected, Pending)
  OFFICIAL_MANAGEMENT_DISCIPLINES.forEach(disc => {
    const acc = disciplineMap.get(disc)!;
    const rawStat = rawRowStatsByDiscipline.get(disc)!;
    const subKeys = periodSubKeysByDiscipline.get(disc)!;

    let uniqueRev00Submittals = 0;
    let uniqueFurtherSubmittals = 0;

    subKeys.forEach(subKey => {
      const group = submittalMap.get(subKey);
      if (!group) return;

      const latest = group.latest;
      const revCount = group.all.length;
      const allRevs = group.all.map(item => extractRevisionRaw(item) || item.rev || '00');
      const rec = toReconciledRecord(
        latest,
        disc,
        group.resolvedCategory,
        true,
        revCount,
        allRevs
      );

      // Unique Submittal count
      acc.totalSubmittals++;
      acc.uniqueItems++;
      acc.reconciliation.totalSubmittals.push(rec);
      acc.reconciliation.uniqueItems.push(rec);

      const rawRev = extractRevisionRaw(latest);
      if (isRevision0(rawRev, latest.isRev0)) {
        uniqueRev00Submittals++;
      } else if (isFurtherRevision(rawRev, latest.isRev0)) {
        uniqueFurtherSubmittals++;
      }

      // Unique Submittal Status classification: Total Submittals = Approved + Rejected + Pending
      if (group.managementStatus === 'REJECTED') {
        acc.rejected++;
        acc.rejectedOpen++;
        acc.reconciliation.rejected.push(rec);
      } else if (group.managementStatus === 'PENDING') {
        acc.pending++;
        acc.reconciliation.pending.push(rec);
      } else {
        acc.approved++;
        if (group.hasHistoricalClosedRejectionAtLatest) {
          acc.rejectedClosed++;
        }
        acc.reconciliation.approved.push(rec);
      }
    });

    acc.supersededTotalRows = Math.max(0, rawStat.total - acc.totalSubmittals);
    acc.supersededRev00Rows = Math.max(0, rawStat.rev00 - uniqueRev00Submittals);
    acc.supersededFurtherRevRows = Math.max(0, rawStat.further - uniqueFurtherSubmittals);
  });

  // 3. GRAND TOTAL PASS
  const grandTotal = createEmptyDisciplineRow('GRAND TOTAL');
  const rows: ManagementDisciplineRow[] = [];

  OFFICIAL_MANAGEMENT_DISCIPLINES.forEach(disc => {
    const r = disciplineMap.get(disc)!;
    rows.push(r);

    grandTotal.totalSubmittals += r.totalSubmittals;
    grandTotal.rev00 += r.rev00;
    grandTotal.furtherRev += r.furtherRev;
    grandTotal.totalSheets += r.totalSheets;

    grandTotal.uniqueItems += r.uniqueItems;
    grandTotal.rev00Rows += r.rev00Rows;
    grandTotal.furtherRevRows += r.furtherRevRows;
    grandTotal.totalRows += r.totalRows;

    grandTotal.approved += r.approved;
    grandTotal.rejected += r.rejected;
    grandTotal.rejectedOpen += r.rejectedOpen;
    grandTotal.rejectedClosed += r.rejectedClosed;
    grandTotal.pending += r.pending;
    grandTotal.supersededTotalRows += r.supersededTotalRows;
    grandTotal.supersededRev00Rows += r.supersededRev00Rows;
    grandTotal.supersededFurtherRevRows += r.supersededFurtherRevRows;

    grandTotal.reconciliation.totalSubmittals.push(...r.reconciliation.totalSubmittals);
    grandTotal.reconciliation.rev00.push(...r.reconciliation.rev00);
    grandTotal.reconciliation.furtherRev.push(...r.reconciliation.furtherRev);
    grandTotal.reconciliation.totalSheets.push(...r.reconciliation.totalSheets);
    grandTotal.reconciliation.uniqueItems.push(...r.reconciliation.uniqueItems);
    grandTotal.reconciliation.rev00Rows.push(...r.reconciliation.rev00Rows);
    grandTotal.reconciliation.furtherRevRows.push(...r.reconciliation.furtherRevRows);
    grandTotal.reconciliation.totalRows.push(...r.reconciliation.totalRows);
    grandTotal.reconciliation.approved.push(...r.reconciliation.approved);
    grandTotal.reconciliation.rejected.push(...r.reconciliation.rejected);
    grandTotal.reconciliation.pending.push(...r.reconciliation.pending);
  });

  const allCheckRows = [...rows, grandTotal];

  const totalSubmittalsEqualsStatusSum = allCheckRows.every(
    r =>
      r.totalSubmittals === r.approved + r.rejected + r.pending &&
      r.reconciliation.totalSubmittals.length === r.totalSubmittals &&
      r.reconciliation.approved.length === r.approved &&
      r.reconciliation.rejected.length === r.rejected &&
      r.reconciliation.pending.length === r.pending
  );

  const totalSheetsEqualsRevisionRowSum = allCheckRows.every(
    r =>
      r.totalSheets === r.rev00 + r.furtherRev &&
      r.reconciliation.rev00.length === r.rev00 &&
      r.reconciliation.furtherRev.length === r.furtherRev &&
      r.reconciliation.totalSheets.length === r.totalSheets
  );

  const sumTotalSubmittals = rows.reduce((s, r) => s + r.totalSubmittals, 0);
  const sumRev00 = rows.reduce((s, r) => s + r.rev00, 0);
  const sumFurtherRev = rows.reduce((s, r) => s + r.furtherRev, 0);
  const sumTotalSheets = rows.reduce((s, r) => s + r.totalSheets, 0);
  const sumApproved = rows.reduce((s, r) => s + r.approved, 0);
  const sumRejected = rows.reduce((s, r) => s + r.rejected, 0);
  const sumPending = rows.reduce((s, r) => s + r.pending, 0);

  const grandTotalEqualsDisciplineSum =
    grandTotal.totalSubmittals === sumTotalSubmittals &&
    grandTotal.rev00 === sumRev00 &&
    grandTotal.furtherRev === sumFurtherRev &&
    grandTotal.totalSheets === sumTotalSheets &&
    grandTotal.approved === sumApproved &&
    grandTotal.rejected === sumRejected &&
    grandTotal.pending === sumPending;

  const isFullyReconciled =
    totalSubmittalsEqualsStatusSum &&
    totalSheetsEqualsRevisionRowSum &&
    grandTotalEqualsDisciplineSum;

  return {
    registerFilter: normalizedFilter,
    availableRegisters,
    rows,
    grandTotal,
    excludedRowsCount,
    otherDisciplineRowsCount,
    isFullyReconciled,
    validation: {
      totalSubmittalsEqualsStatusSum,
      totalSheetsEqualsRevisionRowSum,
      uniqueItemsEqualsStatusSum: totalSubmittalsEqualsStatusSum,
      totalRowsEqualsRevisionRowSum: totalSheetsEqualsRevisionRowSum,
      grandTotalEqualsDisciplineSum
    }
  };
}
