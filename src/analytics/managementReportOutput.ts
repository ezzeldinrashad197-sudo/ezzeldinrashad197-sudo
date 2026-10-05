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
  | 'pending';

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
  allRevisionsForDocument?: Array<{
    rev: string;
    subRef: string;
    rawCode: string;
    rawStatus: string;
    resolvedCategory: string;
    submissionDate: string;
    responseDate: string;
    sourceSheet: string;
  }>;
  rawRow: SubmittalRow;
}

export interface ManagementDisciplineRow {
  discipline: OfficialManagementDiscipline | 'GRAND TOTAL';
  disciplineLabelEn: string;
  disciplineLabelAr: string;
  items: number;
  totalSubmittals: number;
  rev00: number;
  furtherRev: number;
  approved: number;
  rejected: number;
  pending: number;
  // Detailed audit breakdown (for Analytics/Audit inspection only, not shown in primary table)
  rejectedOpen: number;
  rejectedClosed: number;
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
  groupAllRows?: SubmittalRow[]
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
    allRevisionsForDocument: groupAllRows
      ? groupAllRows.map(gr => ({
          rev: gr.rev || '00',
          subRef: gr.submissionRef || gr.docNo || '-',
          rawCode: String(gr.code ?? gr.status ?? '-'),
          rawStatus: String(gr.recordStatus ?? gr.workflowStage ?? '-'),
          resolvedCategory: getStatusCodeCategory(gr),
          submissionDate: gr.submissionDate || '-',
          responseDate: gr.responseDate || '-',
          sourceSheet: gr.sourceSheetName || gr.disciplineSourceSheet || gr.logType || '-'
        }))
      : undefined,
    rawRow: r
  };
}

/**
 * Dedicated Management Report Output Layer
 *
 * Produces the official 8-column Management KPI Table:
 *   Discipline | Items | Total Submittals | Rev.00 | Further Rev. | Approved | Rejected | Pending
 * for required disciplines:
 *   STR, ARCH, MECH, ELEC, INFRA, LAND, GRAND TOTAL
 *
 * with full read-only source-row reconciliation for every cell.
 */
export function buildManagementReportOutput(
  periodRows: SubmittalRow[],
  fullContextDataset?: SubmittalRow[],
  registerFilter: string = 'ALL'
): ManagementReportResult {
  // Exclude NCR rows from engineering submittal management table (consistent with ReportTable generalData)
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

  // Index context dataset by Document Identity Key in O(N)
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

  // Partition period rows by Official Management Discipline
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
    // Call official SSOT calculateStats and processRevisionEngine without modifying them
    const ssotStats = calculateStats(discRows, effectiveContext);
    const revMap = processRevisionEngine(effectiveContext);

    const rev00Records: ReconciledSourceRecord[] = [];
    const furtherRevRecords: ReconciledSourceRecord[] = [];
    const totalSubmittalsRecords: ReconciledSourceRecord[] = [];

    for (let i = 0; i < discRows.length; i++) {
      const r = discRows[i];
      const docKey = getDocumentIdentityKey(r);
      const group = revMap.get(docKey);
      const isLatest = group ? group.latest === r : Boolean(r.isLatestRev);
      const rec = toReconciledRecord(r, disc, isLatest, group?.all);

      if (rec.isRev0) {
        rev00Records.push(rec);
        totalSubmittalsRecords.push(rec);
      } else if (rec.isFurtherRev) {
        furtherRevRecords.push(rec);
        totalSubmittalsRecords.push(rec);
      }
    }

    const itemsRecords: ReconciledSourceRecord[] = [];
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
      const rec = toReconciledRecord(latest, disc, true, group.all);
      rec.resolvedCategory = resolvedCat;

      itemsRecords.push(rec);

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

    // Explicit deterministic KPI definitions:
    // - Items = current Unique Document Items using canonical Document Identity / revision resolution
    // - Rev.00 = actual source rows classified as Rev.00
    // - Further Rev. = actual source rows classified as Further Revision
    // - Total Submittals = Rev.00 + Further Rev.
    // - Approved / Rejected / Pending = current state of Unique Items
    const rev00 = rev00Records.length;
    const furtherRev = furtherRevRecords.length;
    const totalSubmittals = rev00 + furtherRev;
    const items = itemsRecords.length;
    const approved = approvedRecords.length;
    const rejected = rejectedRecords.length;
    const pending = pendingRecords.length;

    const isWorkloadReconciled =
      totalSubmittals === rev00 + furtherRev &&
      rev00 === ssotStats.totalSheetsRev0 &&
      furtherRev === ssotStats.totalSheetsFurtherRev;

    const isCurrentStateReconciled =
      items === approved + rejected + pending &&
      items === ssotStats.totalUniqueDrawings;

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
      rejectedOpen: rejectedOpenCount,
      rejectedClosed: rejectedClosedCount,
      isWorkloadReconciled,
      isCurrentStateReconciled,
      reconciliation: {
        items: itemsRecords,
        totalSubmittals: totalSubmittalsRecords,
        rev00: rev00Records,
        furtherRev: furtherRevRecords,
        approved: approvedRecords,
        rejected: rejectedRecords,
        pending: pendingRecords
      }
    };
  };

  const rows: ManagementDisciplineRow[] = OFFICIAL_MANAGEMENT_DISCIPLINES.map(disc =>
    buildRowForDiscipline(disc, rowsByDisc.get(disc) || [])
  );

  // Build GRAND TOTAL row from the 6 official disciplines
  const grandTotalReconciliation: Record<ManagementKpiColumnKey, ReconciledSourceRecord[]> = {
    items: [],
    totalSubmittals: [],
    rev00: [],
    furtherRev: [],
    approved: [],
    rejected: [],
    pending: []
  };

  let sumItems = 0;
  let sumTotalSubmittals = 0;
  let sumRev00 = 0;
  let sumFurtherRev = 0;
  let sumApproved = 0;
  let sumRejected = 0;
  let sumPending = 0;
  let sumRejectedOpen = 0;
  let sumRejectedClosed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    sumItems += r.items;
    sumTotalSubmittals += r.totalSubmittals;
    sumRev00 += r.rev00;
    sumFurtherRev += r.furtherRev;
    sumApproved += r.approved;
    sumRejected += r.rejected;
    sumPending += r.pending;
    sumRejectedOpen += r.rejectedOpen;
    sumRejectedClosed += r.rejectedClosed;

    grandTotalReconciliation.items.push(...r.reconciliation.items);
    grandTotalReconciliation.totalSubmittals.push(...r.reconciliation.totalSubmittals);
    grandTotalReconciliation.rev00.push(...r.reconciliation.rev00);
    grandTotalReconciliation.furtherRev.push(...r.reconciliation.furtherRev);
    grandTotalReconciliation.approved.push(...r.reconciliation.approved);
    grandTotalReconciliation.rejected.push(...r.reconciliation.rejected);
    grandTotalReconciliation.pending.push(...r.reconciliation.pending);
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
    rejectedOpen: sumRejectedOpen,
    rejectedClosed: sumRejectedClosed,
    isWorkloadReconciled: sumTotalSubmittals === sumRev00 + sumFurtherRev,
    isCurrentStateReconciled: sumItems === sumApproved + sumRejected + sumPending,
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
