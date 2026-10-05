import { SubmittalRow } from '../types';
import {
  calculateStats,
  getDocumentIdentityKey,
  getSubmissionIdentityKey,
  getStatusCodeCategory,
  processRevisionEngine,
  resolveCanonicalTrade,
  resolveRowDiscipline
} from '../utils/calculations';
import {
  extractRevisionRaw,
  isRevision0,
  isFurtherRevision
} from './revisionResolver';

export const OFFICIAL_MANAGEMENT_DISCIPLINES = [
  'STR',
  'ARCH',
  'MECH',
  'ELEC',
  'INFRA',
  'LAND'
] as const;

export type OfficialManagementDiscipline = typeof OFFICIAL_MANAGEMENT_DISCIPLINES[number];

export type ManagementKpiColumnKey =
  | 'uniqueItems'
  | 'rev00Rows'
  | 'furtherRevRows'
  | 'totalRows'
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'supersededRows';

export interface ReconciledSourceRecord {
  id: string;
  documentIdentityKey: string;
  submissionIdentityKey: string;
  registerIdentity: string;
  officialDiscipline: OfficialManagementDiscipline | 'OTHER';
  rawDiscipline: string;
  documentNo: string;
  drawingNo: string;
  subRef: string;
  rev: string;
  isRev0: boolean;
  isFurtherRev: boolean;
  rawCode: string;
  rawStatus: string;
  resolvedCategory: string;
  submissionDate: string;
  responseDate: string;
  sourceSheet: string;
  sourceFile: string;
  isWinningLatestRevision: boolean;
  revisionCountForDocument: number;
  supersededRevisionsCount: number;
  allRevisionsForDocument?: Array<{
    rev: string;
    subRef: string;
    rawCode: string;
    rawStatus: string;
    resolvedCategory: string;
    submissionDate: string;
    responseDate: string;
    sourceSheet: string;
    isWinningLatest: boolean;
  }>;
  rawRow: SubmittalRow;
}

export interface ManagementDisciplineRow {
  discipline: OfficialManagementDiscipline | 'GRAND TOTAL';
  disciplineLabelEn: string;
  disciplineLabelAr: string;

  // OFFICIAL MANAGEMENT REPORT COLUMNS:
  // Status | Unique Items | Rev.00 Rows | Further Rev. Rows | Total Rows | Approved | Rejected | Pending
  uniqueItems: number;    // UNIQUE ITEM GRAIN: Unique document/submittal identities after revision grouping
  rev00Rows: number;      // RAW EXCEL ROW GRAIN: Total actual Excel source rows classified as Rev.00
  furtherRevRows: number; // RAW EXCEL ROW GRAIN: Total actual Excel source rows classified as Further Revision
  totalRows: number;      // RAW EXCEL ROW GRAIN: Rev.00 Rows + Further Rev. Rows
  approved: number;       // UNIQUE ITEM GRAIN: Current Unique Items in Approved state
  rejected: number;       // UNIQUE ITEM GRAIN: Current Unique Items in Rejected state (Open + Closed)
  pending: number;        // UNIQUE ITEM GRAIN: Current Unique Items in Pending state

  // Audit & Reconciliation metadata (kept strictly for Audit / Reconciliation inspection)
  unclassifiedRawRows: number;
  rejectedOpen: number;
  rejectedClosed: number;
  supersededTotalRows: number;

  isWorkloadReconciled: boolean;
  isCurrentStateReconciled: boolean;
  reconciliation: Record<ManagementKpiColumnKey, ReconciledSourceRecord[]>;
}

export interface ManagementReportResult {
  registerFilter: string;
  availableRegisters: string[];
  rows: ManagementDisciplineRow[];
  grandTotal: ManagementDisciplineRow;
  otherDisciplineRowsCount: number;
  otherDisciplineRecords: ReconciledSourceRecord[];
  isFullyReconciled: boolean;
}

export const DISCIPLINE_LABELS: Record<OfficialManagementDiscipline | 'GRAND TOTAL', { en: string; ar: string }> = {
  STR: { en: 'STR', ar: 'إنشائي (STR)' },
  ARCH: { en: 'ARCH', ar: 'معماري (ARCH)' },
  MECH: { en: 'MECH', ar: 'ميكانيكا (MECH)' },
  ELEC: { en: 'ELEC', ar: 'كهرباء (ELEC)' },
  INFRA: { en: 'INFRA', ar: 'بنية تحتية (INFRA)' },
  LAND: { en: 'LAND', ar: 'لاندسكيب (LAND)' },
  'GRAND TOTAL': { en: 'GRAND TOTAL', ar: 'الإجمالي الكلي (GRAND TOTAL)' }
};

export function resolveRowRegisterCode(row: SubmittalRow): string {
  const raw = (
    row.registerIdentity ||
    (row as unknown as Record<string, string>).sourceRegisterIdentity ||
    row.workflowFamily ||
    (row.documentType ? row.documentType.split('-')[0] : '') ||
    'DOC'
  ).trim().toUpperCase();
  if (raw === 'SHD') return 'SDW';
  return raw;
}

/**
 * Deterministically maps a SubmittalRow to one of the 6 Official Management Report
 * disciplines (STR, ARCH, MECH, ELEC, INFRA, LAND) using the existing SSOT
 * resolveCanonicalTrade / resolveRowDiscipline functions without guessing.
 */
export function resolveOfficialManagementDiscipline(
  row: SubmittalRow
): OfficialManagementDiscipline | 'OTHER' {
  const canonical = resolveCanonicalTrade(row);
  const short = (canonical.tradeShort || '').trim().toUpperCase();
  const pres = (canonical.presentationDisc || '').trim().toUpperCase();

  if (short === 'STR' || pres === 'STR' || pres === 'STR/SUR') return 'STR';
  if (short === 'ARC' || pres === 'ARCH' || pres === 'ARC') return 'ARCH';
  if (short === 'MEC' || pres === 'MECH' || pres === 'MEC') return 'MECH';
  if (short === 'ELE' || pres === 'ELEC' || pres === 'ELE') return 'ELEC';
  if (short === 'INFRA' || pres === 'INFRA' || pres === 'INF') return 'INFRA';
  if (short === 'LAND' || pres === 'LANDSCAPE' || pres === 'LAND' || pres === 'LND') return 'LAND';

  const fallbackDisc = (resolveRowDiscipline(row) || '').trim().toUpperCase();
  if (fallbackDisc === 'STR' || fallbackDisc === 'STRUCTURAL' || fallbackDisc === 'CIVIL') return 'STR';
  if (fallbackDisc === 'ARCH' || fallbackDisc === 'ARC' || fallbackDisc === 'ARCHITECTURAL') return 'ARCH';
  if (fallbackDisc === 'MECH' || fallbackDisc === 'MEC' || fallbackDisc === 'MECHANICAL') return 'MECH';
  if (fallbackDisc === 'ELEC' || fallbackDisc === 'ELE' || fallbackDisc === 'ELECTRICAL') return 'ELEC';
  if (fallbackDisc === 'INFRA' || fallbackDisc === 'INF' || fallbackDisc === 'INFRASTRUCTURE') return 'INFRA';
  if (fallbackDisc === 'LAND' || fallbackDisc === 'LND' || fallbackDisc === 'LANDSCAPE') return 'LAND';

  return 'OTHER';
}

function toReconciledRecord(
  r: SubmittalRow,
  officialDisc: OfficialManagementDiscipline | 'OTHER',
  isWinningLatest: boolean,
  groupAllRows?: SubmittalRow[],
  winningRowRef?: SubmittalRow
): ReconciledSourceRecord {
  const anyR = r as unknown as Record<string, unknown>;
  const rawRev = extractRevisionRaw(r);
  const rev0 = isRevision0(rawRev, r.isRev0);
  const further = isFurtherRevision(rawRev, r.isRev0);
  const docNoVal = r.drawingNo || r.sheetNo || r.docNo || r.submissionRef || '-';
  const subRefVal = r.submissionRef || r.docNo || '-';
  const rawCodeVal = String(r.code ?? r.status ?? '-');
  const rawStatusVal = String(r.recordStatus ?? r.workflowStage ?? anyR.rawStatus ?? '-');
  const sourceSheetVal = r.sourceSheetName || r.disciplineSourceSheet || r.logType || '-';
  const sourceFileVal = r.sourceFile || r.sourceWorkbookName || r.sourceFileName || '-';
  const totalRevs = groupAllRows ? groupAllRows.length : 1;

  return {
    id: r.id,
    documentIdentityKey: getDocumentIdentityKey(r),
    submissionIdentityKey: getSubmissionIdentityKey(r),
    registerIdentity: resolveRowRegisterCode(r),
    officialDiscipline: officialDisc,
    rawDiscipline: r.discipline || r.trade || '-',
    documentNo: docNoVal,
    drawingNo: r.drawingNo || r.sheetNo || '',
    subRef: subRefVal,
    rev: r.rev || '00',
    isRev0: rev0,
    isFurtherRev: further,
    rawCode: rawCodeVal,
    rawStatus: rawStatusVal,
    resolvedCategory: getStatusCodeCategory(r),
    submissionDate: r.submissionDate || '-',
    responseDate: r.responseDate || '-',
    sourceSheet: sourceSheetVal,
    sourceFile: sourceFileVal,
    isWinningLatestRevision: isWinningLatest,
    revisionCountForDocument: totalRevs,
    supersededRevisionsCount: Math.max(0, totalRevs - 1),
    allRevisionsForDocument: groupAllRows
      ? groupAllRows.map(gr => ({
          rev: gr.rev || '00',
          subRef: gr.submissionRef || gr.docNo || '-',
          rawCode: String(gr.code ?? gr.status ?? '-'),
          rawStatus: String(gr.recordStatus ?? gr.workflowStage ?? '-'),
          resolvedCategory: getStatusCodeCategory(gr),
          submissionDate: gr.submissionDate || '-',
          responseDate: gr.responseDate || '-',
          sourceSheet: gr.sourceSheetName || gr.disciplineSourceSheet || gr.logType || '-',
          isWinningLatest: winningRowRef ? gr === winningRowRef : false
        }))
      : undefined,
    rawRow: r
  };
}

/**
 * Dedicated Management Report Output Layer
 *
 * Official Management Table:
 *   Status | Unique Items | Rev.00 Rows | Further Rev. Rows | Total Rows | Approved | Rejected | Pending
 *
 * Required Disciplines:
 *   STR, ARCH, MECH, ELEC, INFRA, LAND, GRAND TOTAL
 *
 * Explicit Dual-Grain Specification:
 * - Unique Items = number of unique document/submittal identities after revision grouping and current-item resolution.
 * - Rev.00 Rows = total actual Excel source rows classified as Rev.00 (RAW EXCEL ROW GRAIN).
 * - Further Rev. Rows = total actual Excel source rows classified as Further Revision (RAW EXCEL ROW GRAIN).
 * - Total Rows = Rev.00 Rows + Further Rev. Rows (RAW EXCEL ROW GRAIN).
 * - Approved / Rejected / Pending = current state of Unique Items (UNIQUE ITEM GRAIN).
 *
 * Therefore, a document with Rev.00 + Rev.01 + Rev.02:
 * - counts as ONE Unique Item
 * - contributes ONE Rev.00 row
 * - contributes TWO Further Rev. rows
 * - contributes THREE Total Rows.
 */
export function buildManagementReportOutput(
  periodRows: SubmittalRow[],
  fullContextDataset?: SubmittalRow[],
  registerFilter: string = 'ALL'
): ManagementReportResult {
  const validPeriodRows = (periodRows || []).filter(d => {
    const dt = (d.documentType || 'DOC').toUpperCase();
    return !dt.startsWith('NCR-') && dt !== 'NCR';
  });

  const registerSet = new Set<string>();
  validPeriodRows.forEach(r => {
    const reg = resolveRowRegisterCode(r);
    if (reg && reg !== 'UNCLASSIFIED') registerSet.add(reg);
  });
  const preferredRegOrder = ['SDW', 'WIR', 'MIR', 'MAR', 'DOC', 'ABD', 'RFI', 'SOR', 'LTR'];
  const availableRegisters = Array.from(registerSet).sort((a, b) => {
    const ia = preferredRegOrder.indexOf(a);
    const ib = preferredRegOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const scopedPeriodRows = registerFilter === 'ALL'
    ? validPeriodRows
    : validPeriodRows.filter(r => resolveRowRegisterCode(r) === registerFilter);

  const baseContext = (fullContextDataset && fullContextDataset.length > 0 ? fullContextDataset : validPeriodRows).filter(d => {
    const dt = (d.documentType || 'DOC').toUpperCase();
    if (dt.startsWith('NCR-') || dt === 'NCR') return false;
    if (registerFilter !== 'ALL' && resolveRowRegisterCode(d) !== registerFilter) return false;
    return true;
  });

  const contextByDocKey = new Map<string, SubmittalRow[]>();
  for (let i = 0; i < baseContext.length; i++) {
    const r = baseContext[i];
    const key = getDocumentIdentityKey(r);
    let bucket = contextByDocKey.get(key);
    if (!bucket) {
      bucket = [];
      contextByDocKey.set(key, bucket);
    }
    bucket.push(r);
  }

  const rowsByDisc = new Map<OfficialManagementDiscipline, SubmittalRow[]>();
  OFFICIAL_MANAGEMENT_DISCIPLINES.forEach(d => rowsByDisc.set(d, []));
  const otherRows: SubmittalRow[] = [];

  for (let i = 0; i < scopedPeriodRows.length; i++) {
    const r = scopedPeriodRows[i];
    const disc = resolveOfficialManagementDiscipline(r);
    if (disc === 'OTHER') {
      otherRows.push(r);
    } else {
      rowsByDisc.get(disc)!.push(r);
    }
  }

  const buildRowForDiscipline = (
    disc: OfficialManagementDiscipline,
    discRows: SubmittalRow[]
  ): ManagementDisciplineRow => {
    const targetDocKeys = new Set<string>();
    for (let i = 0; i < discRows.length; i++) {
      targetDocKeys.add(getDocumentIdentityKey(discRows[i]));
    }

    const scopedContextForDisc: SubmittalRow[] = [];
    targetDocKeys.forEach(k => {
      const bucket = contextByDocKey.get(k);
      if (bucket) {
        for (let j = 0; j < bucket.length; j++) {
          scopedContextForDisc.push(bucket[j]);
        }
      }
    });

    const effectiveContext = scopedContextForDisc.length > 0 ? scopedContextForDisc : discRows;
    const ssotStats = calculateStats(discRows, effectiveContext);
    const revMap = processRevisionEngine(effectiveContext);

    // 1. UNIQUE ITEM GRAIN: Unique Items + Approved / Rejected / Pending
    const uniqueItemsRecords: ReconciledSourceRecord[] = [];
    const approvedRecords: ReconciledSourceRecord[] = [];
    const rejectedRecords: ReconciledSourceRecord[] = [];
    const pendingRecords: ReconciledSourceRecord[] = [];

    let rejectedOpenCount = 0;
    let rejectedClosedCount = 0;

    targetDocKeys.forEach(docKey => {
      const group = revMap.get(docKey);
      if (!group) return;
      const latest = group.latest;
      const resolvedCat = group.resolvedStatus || getStatusCodeCategory(latest);
      const rec = toReconciledRecord(latest, disc, true, group.all, latest);
      rec.resolvedCategory = resolvedCat;

      uniqueItemsRecords.push(rec);

      if (resolvedCat === 'APPROVED' || resolvedCat === 'FINAL_CLOSED') {
        approvedRecords.push(rec);
      } else if (resolvedCat === 'REJECTED_OPEN') {
        rejectedRecords.push(rec);
        rejectedOpenCount++;
      } else if (resolvedCat === 'REJECTED_CLOSED') {
        rejectedRecords.push(rec);
        rejectedClosedCount++;
      } else {
        pendingRecords.push(rec);
      }
    });

    // 2. RAW EXCEL ROW GRAIN: Rev.00 Rows | Further Rev. Rows | Total Rows
    const rev00RowsRecords: ReconciledSourceRecord[] = [];
    const furtherRevRowsRecords: ReconciledSourceRecord[] = [];
    const totalRowsRecords: ReconciledSourceRecord[] = [];
    const supersededRowsRecords: ReconciledSourceRecord[] = [];
    let unclassifiedRawRowsCount = 0;

    for (let i = 0; i < discRows.length; i++) {
      const r = discRows[i];
      const docKey = getDocumentIdentityKey(r);
      const group = revMap.get(docKey);
      const isLatest = group ? group.latest === r : Boolean(r.isLatestRev);
      const rec = toReconciledRecord(r, disc, isLatest, group?.all, group?.latest);

      if (rec.isRev0) {
        rev00RowsRecords.push(rec);
        totalRowsRecords.push(rec);
      } else if (rec.isFurtherRev) {
        furtherRevRowsRecords.push(rec);
        totalRowsRecords.push(rec);
      } else {
        unclassifiedRawRowsCount++;
        totalRowsRecords.push(rec);
      }

      if (!isLatest) {
        supersededRowsRecords.push(rec);
      }
    }

    const uniqueItems = uniqueItemsRecords.length;
    const rev00Rows = rev00RowsRecords.length;
    const furtherRevRows = furtherRevRowsRecords.length;
    const totalRows = rev00Rows + furtherRevRows + unclassifiedRawRowsCount;
    const approved = approvedRecords.length;
    const rejected = rejectedRecords.length;
    const pending = pendingRecords.length;
    const supersededTotalRows = Math.max(0, totalRows - uniqueItems);

    const isWorkloadReconciled =
      totalRows === rev00Rows + furtherRevRows + unclassifiedRawRowsCount &&
      rev00Rows === ssotStats.totalSheetsRev0 &&
      furtherRevRows === ssotStats.totalSheetsFurtherRev &&
      totalRows === ssotStats.totalSubmittedSheets;

    const isCurrentStateReconciled =
      uniqueItems === approved + rejected + pending &&
      uniqueItems === ssotStats.totalUniqueDrawings &&
      approved === ssotStats.approved &&
      rejected === ssotStats.rejectedOpen + ssotStats.rejectedClosed &&
      pending === ssotStats.pending;

    return {
      discipline: disc,
      disciplineLabelEn: DISCIPLINE_LABELS[disc].en,
      disciplineLabelAr: DISCIPLINE_LABELS[disc].ar,
      uniqueItems,
      rev00Rows,
      furtherRevRows,
      totalRows,
      approved,
      rejected,
      pending,
      unclassifiedRawRows: unclassifiedRawRowsCount,
      rejectedOpen: rejectedOpenCount,
      rejectedClosed: rejectedClosedCount,
      supersededTotalRows,
      isWorkloadReconciled,
      isCurrentStateReconciled,
      reconciliation: {
        uniqueItems: uniqueItemsRecords,
        rev00Rows: rev00RowsRecords,
        furtherRevRows: furtherRevRowsRecords,
        totalRows: totalRowsRecords,
        approved: approvedRecords,
        rejected: rejectedRecords,
        pending: pendingRecords,
        supersededRows: supersededRowsRecords
      }
    };
  };

  const rows: ManagementDisciplineRow[] = OFFICIAL_MANAGEMENT_DISCIPLINES.map(disc =>
    buildRowForDiscipline(disc, rowsByDisc.get(disc) || [])
  );

  const grandTotalReconciliation: Record<ManagementKpiColumnKey, ReconciledSourceRecord[]> = {
    uniqueItems: [],
    rev00Rows: [],
    furtherRevRows: [],
    totalRows: [],
    approved: [],
    rejected: [],
    pending: [],
    supersededRows: []
  };

  let sumUniqueItems = 0;
  let sumRev00Rows = 0;
  let sumFurtherRevRows = 0;
  let sumTotalRows = 0;
  let sumApproved = 0;
  let sumRejected = 0;
  let sumPending = 0;
  let sumUnclassifiedRawRows = 0;
  let sumRejectedOpen = 0;
  let sumRejectedClosed = 0;
  let sumSupersededTotalRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    sumUniqueItems += r.uniqueItems;
    sumRev00Rows += r.rev00Rows;
    sumFurtherRevRows += r.furtherRevRows;
    sumTotalRows += r.totalRows;
    sumApproved += r.approved;
    sumRejected += r.rejected;
    sumPending += r.pending;
    sumUnclassifiedRawRows += r.unclassifiedRawRows;
    sumRejectedOpen += r.rejectedOpen;
    sumRejectedClosed += r.rejectedClosed;
    sumSupersededTotalRows += r.supersededTotalRows;

    grandTotalReconciliation.uniqueItems.push(...r.reconciliation.uniqueItems);
    grandTotalReconciliation.rev00Rows.push(...r.reconciliation.rev00Rows);
    grandTotalReconciliation.furtherRevRows.push(...r.reconciliation.furtherRevRows);
    grandTotalReconciliation.totalRows.push(...r.reconciliation.totalRows);
    grandTotalReconciliation.approved.push(...r.reconciliation.approved);
    grandTotalReconciliation.rejected.push(...r.reconciliation.rejected);
    grandTotalReconciliation.pending.push(...r.reconciliation.pending);
    grandTotalReconciliation.supersededRows.push(...r.reconciliation.supersededRows);
  }

  const grandTotal: ManagementDisciplineRow = {
    discipline: 'GRAND TOTAL',
    disciplineLabelEn: DISCIPLINE_LABELS['GRAND TOTAL'].en,
    disciplineLabelAr: DISCIPLINE_LABELS['GRAND TOTAL'].ar,
    uniqueItems: sumUniqueItems,
    rev00Rows: sumRev00Rows,
    furtherRevRows: sumFurtherRevRows,
    totalRows: sumTotalRows,
    approved: sumApproved,
    rejected: sumRejected,
    pending: sumPending,
    unclassifiedRawRows: sumUnclassifiedRawRows,
    rejectedOpen: sumRejectedOpen,
    rejectedClosed: sumRejectedClosed,
    supersededTotalRows: sumSupersededTotalRows,
    isWorkloadReconciled: sumTotalRows === sumRev00Rows + sumFurtherRevRows + sumUnclassifiedRawRows,
    isCurrentStateReconciled: sumUniqueItems === sumApproved + sumRejected + sumPending,
    reconciliation: grandTotalReconciliation
  };

  const otherDisciplineRecords = otherRows.map(r => toReconciledRecord(r, 'OTHER', Boolean(r.isLatestRev)));

  return {
    registerFilter,
    availableRegisters,
    rows,
    grandTotal,
    otherDisciplineRowsCount: otherRows.length,
    otherDisciplineRecords,
    isFullyReconciled:
      rows.every(r => r.isWorkloadReconciled && r.isCurrentStateReconciled) &&
      grandTotal.isWorkloadReconciled &&
      grandTotal.isCurrentStateReconciled
  };
}
