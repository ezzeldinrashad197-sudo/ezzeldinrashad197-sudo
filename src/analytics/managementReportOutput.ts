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
  | 'items'
  | 'totalSubmittals'
  | 'rev00'
  | 'furtherRev'
  | 'approved'
  | 'rejected'
  | 'pending'
  | 'rawTotalRows'
  | 'rawRev00Rows'
  | 'rawFurtherRevRows'
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
  // PRIMARY OFFICIAL MANAGEMENT KPIs (100% UNIQUE ITEM GRAIN)
  items: number;            // Unique Document Items
  totalSubmittals: number;  // Unique Submittal Items (= rev00 + furtherRev at Unique Item Grain)
  rev00: number;            // Unique Items whose current resolved revision is Rev.00
  furtherRev: number;       // Unique Items whose current resolved revision is Further Revision (Rev.01+)
  approved: number;         // Current Unique Items in Approved state
  rejected: number;         // Current Unique Items in Rejected state (Open + Closed)
  pending: number;          // Current Unique Items in Pending state

  // AUDIT & RECONCILIATION METRICS (Distinguishing Unique Item Grain from Raw Excel Row Grain)
  uniqueSubmittalPackages: number; // Unique SUB Ref packages (getSubmissionIdentityKey)
  unclassifiedRevItems: number;    // Unique Items with blank/unclassified revision
  rejectedOpen: number;            // Current Unique Items in Rejected Open state
  rejectedClosed: number;          // Current Unique Items in Rejected Closed state
  rawTotalRows: number;            // Raw Excel rows in period (Rev.00 + Rev.01 + Rev.02 = 3 rows)
  rawRev00Rows: number;            // Raw Excel rows classified as Rev.00
  rawFurtherRevRows: number;       // Raw Excel rows classified as Further Revision
  supersededTotalRows: number;     // Raw rows collapsed into Unique Items (rawTotalRows - items)
  supersededRev00Rows: number;     // Historical Rev.00 rows superseded by later revisions (rawRev00Rows - rev00)
  supersededFurtherRevRows: number;// Historical Further Rev. rows superseded by higher revisions (rawFurtherRevRows - furtherRev)

  isUniqueGrainReconciled: boolean;
  isCurrentStateReconciled: boolean;
  isCrossGrainReconciled: boolean;
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
 * Dedicated Management Report Output Layer (UNIQUE ITEM GRAIN)
 *
 * Produces the official 8-column Management KPI Table at UNIQUE ITEM GRAIN:
 *   Discipline | Items | Total Submittals | Rev.00 | Further Rev. | Approved | Rejected | Pending
 * for required disciplines:
 *   STR, ARCH, MECH, ELEC, INFRA, LAND, GRAND TOTAL
 *
 * Explicit Unique Item Grain Rules:
 * - A document with Rev.00 + Rev.01 + Rev.02 remains ONE Unique Item.
 * - Items = Unique Document Items (resolved via canonical Document Identity / processRevisionEngine).
 * - Rev.00 = Unique Items whose resolved current revision is Rev.00.
 * - Further Rev. = Unique Items whose resolved current revision is Further Revision (Rev.01+).
 * - Total Submittals = Unique Submittal Items (Rev.00 + Further Rev. at Unique Item Grain).
 * - Approved / Rejected / Pending = Current Unique Items in Approved / Rejected / Pending state.
 * - Raw Excel row counts and Superseded rows are tracked separately for Audit & Reconciliation.
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
    const uniqueSubKeys = new Set<string>();
    for (let i = 0; i < discRows.length; i++) {
      targetDocKeys.add(getDocumentIdentityKey(discRows[i]));
      uniqueSubKeys.add(getSubmissionIdentityKey(discRows[i]));
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

    // 1. UNIQUE ITEM GRAIN KPIs (Official Management Report)
    const itemsRecords: ReconciledSourceRecord[] = [];
    const totalSubmittalsRecords: ReconciledSourceRecord[] = [];
    const rev00UniqueRecords: ReconciledSourceRecord[] = [];
    const furtherRevUniqueRecords: ReconciledSourceRecord[] = [];
    const approvedRecords: ReconciledSourceRecord[] = [];
    const rejectedRecords: ReconciledSourceRecord[] = [];
    const pendingRecords: ReconciledSourceRecord[] = [];

    let rejectedOpenCount = 0;
    let rejectedClosedCount = 0;
    let unclassifiedRevItemsCount = 0;

    targetDocKeys.forEach(docKey => {
      const group = revMap.get(docKey);
      if (!group) return;
      const latest = group.latest;
      const resolvedCat = group.resolvedStatus || getStatusCodeCategory(latest);
      const rec = toReconciledRecord(latest, disc, true, group.all, latest);
      rec.resolvedCategory = resolvedCat;

      itemsRecords.push(rec);

      // Unique Item Revision Classification (based on the winning current revision of the Unique Item)
      if (rec.isRev0) {
        rev00UniqueRecords.push(rec);
        totalSubmittalsRecords.push(rec);
      } else if (rec.isFurtherRev) {
        furtherRevUniqueRecords.push(rec);
        totalSubmittalsRecords.push(rec);
      } else {
        unclassifiedRevItemsCount++;
        totalSubmittalsRecords.push(rec);
      }

      // Unique Item Current Status Classification
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

    // 2. RAW EXCEL ROW GRAIN & SUPERSEDED ROWS (For Audit & Cross-Grain Reconciliation)
    const rawTotalRowsRecords: ReconciledSourceRecord[] = [];
    const rawRev00RowsRecords: ReconciledSourceRecord[] = [];
    const rawFurtherRevRowsRecords: ReconciledSourceRecord[] = [];
    const supersededRowsRecords: ReconciledSourceRecord[] = [];

    for (let i = 0; i < discRows.length; i++) {
      const r = discRows[i];
      const docKey = getDocumentIdentityKey(r);
      const group = revMap.get(docKey);
      const isLatest = group ? group.latest === r : Boolean(r.isLatestRev);
      const rec = toReconciledRecord(r, disc, isLatest, group?.all, group?.latest);

      rawTotalRowsRecords.push(rec);
      if (rec.isRev0) {
        rawRev00RowsRecords.push(rec);
      } else if (rec.isFurtherRev) {
        rawFurtherRevRowsRecords.push(rec);
      }
      if (!isLatest) {
        supersededRowsRecords.push(rec);
      }
    }

    // Official Unique-Item-Grain KPIs:
    const items = itemsRecords.length;
    const rev00 = rev00UniqueRecords.length;
    const furtherRev = furtherRevUniqueRecords.length;
    const totalSubmittals = rev00 + furtherRev + unclassifiedRevItemsCount;
    const approved = approvedRecords.length;
    const rejected = rejectedRecords.length;
    const pending = pendingRecords.length;

    // Audit Raw-Row Metrics:
    const rawTotalRows = rawTotalRowsRecords.length;
    const rawRev00Rows = rawRev00RowsRecords.length;
    const rawFurtherRevRows = rawFurtherRevRowsRecords.length;
    const supersededTotalRows = Math.max(0, rawTotalRows - items);
    const supersededRev00Rows = Math.max(0, rawRev00Rows - rev00);
    const supersededFurtherRevRows = Math.max(0, rawFurtherRevRows - furtherRev);

    const isUniqueGrainReconciled =
      items === ssotStats.totalUniqueDrawings &&
      totalSubmittals === rev00 + furtherRev + unclassifiedRevItemsCount &&
      totalSubmittals === items;

    const isCurrentStateReconciled =
      items === approved + rejected + pending &&
      approved === ssotStats.approved &&
      rejected === ssotStats.rejectedOpen + ssotStats.rejectedClosed &&
      pending === ssotStats.pending;

    const isCrossGrainReconciled =
      items + supersededTotalRows === rawTotalRows;

    return {
      discipline: disc,
      disciplineLabelEn: DISCIPLINE_LABELS[disc].en,
      disciplineLabelAr: DISCIPLINE_LABELS[disc].ar,
      items,
      totalSubmittals,
      rev00,
      furtherRev,
      approved,
      rejected,
      pending,
      uniqueSubmittalPackages: uniqueSubKeys.size,
      unclassifiedRevItems: unclassifiedRevItemsCount,
      rejectedOpen: rejectedOpenCount,
      rejectedClosed: rejectedClosedCount,
      rawTotalRows,
      rawRev00Rows,
      rawFurtherRevRows,
      supersededTotalRows,
      supersededRev00Rows,
      supersededFurtherRevRows,
      isUniqueGrainReconciled,
      isCurrentStateReconciled,
      isCrossGrainReconciled,
      reconciliation: {
        items: itemsRecords,
        totalSubmittals: totalSubmittalsRecords,
        rev00: rev00UniqueRecords,
        furtherRev: furtherRevUniqueRecords,
        approved: approvedRecords,
        rejected: rejectedRecords,
        pending: pendingRecords,
        rawTotalRows: rawTotalRowsRecords,
        rawRev00Rows: rawRev00RowsRecords,
        rawFurtherRevRows: rawFurtherRevRowsRecords,
        supersededRows: supersededRowsRecords
      }
    };
  };

  const rows: ManagementDisciplineRow[] = OFFICIAL_MANAGEMENT_DISCIPLINES.map(disc =>
    buildRowForDiscipline(disc, rowsByDisc.get(disc) || [])
  );

  const grandTotalReconciliation: Record<ManagementKpiColumnKey, ReconciledSourceRecord[]> = {
    items: [],
    totalSubmittals: [],
    rev00: [],
    furtherRev: [],
    approved: [],
    rejected: [],
    pending: [],
    rawTotalRows: [],
    rawRev00Rows: [],
    rawFurtherRevRows: [],
    supersededRows: []
  };

  let sumItems = 0;
  let sumTotalSubmittals = 0;
  let sumRev00 = 0;
  let sumFurtherRev = 0;
  let sumApproved = 0;
  let sumRejected = 0;
  let sumPending = 0;
  let sumUniquePackages = 0;
  let sumUnclassifiedRev = 0;
  let sumRejectedOpen = 0;
  let sumRejectedClosed = 0;
  let sumRawTotalRows = 0;
  let sumRawRev00Rows = 0;
  let sumRawFurtherRevRows = 0;
  let sumSupersededTotalRows = 0;
  let sumSupersededRev00Rows = 0;
  let sumSupersededFurtherRevRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    sumItems += r.items;
    sumTotalSubmittals += r.totalSubmittals;
    sumRev00 += r.rev00;
    sumFurtherRev += r.furtherRev;
    sumApproved += r.approved;
    sumRejected += r.rejected;
    sumPending += r.pending;
    sumUniquePackages += r.uniqueSubmittalPackages;
    sumUnclassifiedRev += r.unclassifiedRevItems;
    sumRejectedOpen += r.rejectedOpen;
    sumRejectedClosed += r.rejectedClosed;
    sumRawTotalRows += r.rawTotalRows;
    sumRawRev00Rows += r.rawRev00Rows;
    sumRawFurtherRevRows += r.rawFurtherRevRows;
    sumSupersededTotalRows += r.supersededTotalRows;
    sumSupersededRev00Rows += r.supersededRev00Rows;
    sumSupersededFurtherRevRows += r.supersededFurtherRevRows;

    grandTotalReconciliation.items.push(...r.reconciliation.items);
    grandTotalReconciliation.totalSubmittals.push(...r.reconciliation.totalSubmittals);
    grandTotalReconciliation.rev00.push(...r.reconciliation.rev00);
    grandTotalReconciliation.furtherRev.push(...r.reconciliation.furtherRev);
    grandTotalReconciliation.approved.push(...r.reconciliation.approved);
    grandTotalReconciliation.rejected.push(...r.reconciliation.rejected);
    grandTotalReconciliation.pending.push(...r.reconciliation.pending);
    grandTotalReconciliation.rawTotalRows.push(...r.reconciliation.rawTotalRows);
    grandTotalReconciliation.rawRev00Rows.push(...r.reconciliation.rawRev00Rows);
    grandTotalReconciliation.rawFurtherRevRows.push(...r.reconciliation.rawFurtherRevRows);
    grandTotalReconciliation.supersededRows.push(...r.reconciliation.supersededRows);
  }

  const grandTotal: ManagementDisciplineRow = {
    discipline: 'GRAND TOTAL',
    disciplineLabelEn: DISCIPLINE_LABELS['GRAND TOTAL'].en,
    disciplineLabelAr: DISCIPLINE_LABELS['GRAND TOTAL'].ar,
    items: sumItems,
    totalSubmittals: sumTotalSubmittals,
    rev00: sumRev00,
    furtherRev: sumFurtherRev,
    approved: sumApproved,
    rejected: sumRejected,
    pending: sumPending,
    uniqueSubmittalPackages: sumUniquePackages,
    unclassifiedRevItems: sumUnclassifiedRev,
    rejectedOpen: sumRejectedOpen,
    rejectedClosed: sumRejectedClosed,
    rawTotalRows: sumRawTotalRows,
    rawRev00Rows: sumRawRev00Rows,
    rawFurtherRevRows: sumRawFurtherRevRows,
    supersededTotalRows: sumSupersededTotalRows,
    supersededRev00Rows: sumSupersededRev00Rows,
    supersededFurtherRevRows: sumSupersededFurtherRevRows,
    isUniqueGrainReconciled:
      sumTotalSubmittals === sumRev00 + sumFurtherRev + sumUnclassifiedRev &&
      sumTotalSubmittals === sumItems,
    isCurrentStateReconciled: sumItems === sumApproved + sumRejected + sumPending,
    isCrossGrainReconciled: sumItems + sumSupersededTotalRows === sumRawTotalRows,
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
      rows.every(r => r.isUniqueGrainReconciled && r.isCurrentStateReconciled && r.isCrossGrainReconciled) &&
      grandTotal.isUniqueGrainReconciled &&
      grandTotal.isCurrentStateReconciled &&
      grandTotal.isCrossGrainReconciled
  };
}
