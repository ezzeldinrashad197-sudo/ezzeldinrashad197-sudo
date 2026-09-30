import { SubmittalRow } from '../types';
import { resolveRowDiscipline } from './calculationFoundation';
import { getStatusCodeCategory } from './statusResolver';
import { extractRevisionRaw, isRevision0, isFurtherRevision } from './revisionResolver';

export interface DisciplineReconciliationRecord {
  register: string;
  discipline: string;
  identityKey: string; // e.g. "SDW-STR"
  // Grain A: Historical Row Grain
  grainA: {
    rev00Rows: number;
    furtherRevRows: number;
    totalRows: number;
    totalRejectedRows: number;
    rejectedOpenRows: number;
    rejectedClosedRows: number;
    resolvedRejections: number;
    rawRowsByStatus: Record<string, number>;
  };
  // Grain B: Unique Submittal Grain (Register + Discipline + SUB Ref)
  grainB: {
    uniqueRev00: number;
    uniqueFurtherRev: number;
    totalUniqueSubmittals: number;
  };
  // Grain C: Current State Grain (Unique deliverable at latest state)
  grainC: {
    totalCurrentUnique: number;
    approved: number;
    rejectedOpen: number;
    rejectedClosed: number;
    totalRejected: number;
    pending: number;
    finalClosed: number;
    unclassified: number;
  };
  // Reconciliation Analysis
  reconciliation: {
    rawDifference: number; // Grain A Total Rows - Grain C Total Current Unique
    supersededHistoricalRows: number; // Historical revision rows superseded by higher revisions
    isMathematicallyBalanced: boolean;
    explanationEn: string;
    explanationAr: string;
  };
  rawRows: SubmittalRow[];
}

export interface ComprehensiveReconciliationReport {
  records: DisciplineReconciliationRecord[];
  grandTotal: {
    grainA: {
      rev00Rows: number;
      furtherRevRows: number;
      totalRows: number;
      totalRejectedRows: number;
      rejectedOpenRows: number;
      rejectedClosedRows: number;
      resolvedRejections: number;
    };
    grainB: {
      uniqueRev00: number;
      uniqueFurtherRev: number;
      totalUniqueSubmittals: number;
    };
    grainC: {
      totalCurrentUnique: number;
      approved: number;
      rejectedOpen: number;
      rejectedClosed: number;
      totalRejected: number;
      pending: number;
      finalClosed: number;
      unclassified: number;
    };
    totalDifference: number;
    totalSupersededRows: number;
    explanationEn: string;
    explanationAr: string;
  };
}

/**
 * Resolves register identity from row
 */
export function getRowRegister(r: SubmittalRow): string {
  const reg = (
    r.registerIdentity ||
    (r as any).sourceRegisterIdentity ||
    r.workflowFamily ||
    (r.documentType ? r.documentType.split('-')[0] : '') ||
    r.logType ||
    'DOC'
  ).trim().toUpperCase();
  return reg;
}

/**
 * Resolves submittal reference from row
 */
export function getRowSubmittalRef(r: SubmittalRow): string {
  return (
    r.submissionRef ||
    r.docNo ||
    (r as any).ncrRef ||
    (r as any).sorRef ||
    (r as any).rfiRef ||
    r.id ||
    ''
  ).trim().toUpperCase();
}

/**
 * Resolves deliverable / drawing key for current state
 */
export function getRowDeliverableKey(r: SubmittalRow, reg: string, disc: string): string {
  const subRef = getRowSubmittalRef(r);
  const dwgNo = (r.drawingNo || (r as any).drawingNumber || '').trim().toUpperCase();
  if (dwgNo) {
    return `${reg}|${disc}|${subRef}|DWG:${dwgNo}`;
  }
  return `${reg}|${disc}|${subRef}`;
}

/**
 * Generates the full 3-grain reconciliation across all Register + Discipline combinations.
 */
export function generateDisciplineReconciliationReport(
  rows: SubmittalRow[]
): ComprehensiveReconciliationReport {
  // Group rows strictly by Register + Discipline
  const groupMap = new Map<string, { register: string; discipline: string; rows: SubmittalRow[] }>();

  rows.forEach(r => {
    // Exclude NCR if handled separately or treat as its own register
    const reg = getRowRegister(r);
    const disc = (resolveRowDiscipline(r, reg) || 'GEN').toUpperCase();
    const identityKey = `${reg}-${disc}`;

    let grp = groupMap.get(identityKey);
    if (!grp) {
      grp = { register: reg, discipline: disc, rows: [] };
      groupMap.set(identityKey, grp);
    }
    grp.rows.push(r);
  });

  const records: DisciplineReconciliationRecord[] = [];

  groupMap.forEach((grp, identityKey) => {
    const groupRows = grp.rows;

    // GRAIN A: Historical Row Grain
    let rev00Rows = 0;
    let furtherRevRows = 0;
    let totalRejectedRows = 0;
    let rejectedOpenRows = 0;
    let rejectedClosedRows = 0;
    const rawRowsByStatus: Record<string, number> = {};

    groupRows.forEach(r => {
      const rawRev = extractRevisionRaw(r);
      const isR0 = isRevision0(rawRev, r.isRev0);
      const isFR = isFurtherRevision(rawRev, r.isRev0);

      if (isR0) rev00Rows++;
      else if (isFR) furtherRevRows++;

      const statusCat = getStatusCodeCategory(r);
      if (statusCat === 'REJECTED_OPEN') {
        totalRejectedRows++;
        rejectedOpenRows++;
      } else if (statusCat === 'REJECTED_CLOSED') {
        totalRejectedRows++;
        rejectedClosedRows++;
      }

      // Raw status tracking
      const rawStatus = (
        r.recordStatus ||
        r.status ||
        r.workflowStage ||
        (r as any).ncrStatus ||
        (r as any).sorStatus ||
        'UNCLASSIFIED'
      ).trim().toUpperCase();

      rawRowsByStatus[rawStatus] = (rawRowsByStatus[rawStatus] || 0) + 1;
    });

    const totalRows = groupRows.length;

    // GRAIN B: Unique Submittal Grain (Register + Discipline + SUB Ref)
    const uniqueSubMap = new Map<string, { rev0: boolean; furtherRev: boolean }>();
    groupRows.forEach(r => {
      const subRef = getRowSubmittalRef(r);
      const subKey = `${grp.register}|${grp.discipline}|${subRef}`;
      let entry = uniqueSubMap.get(subKey);
      if (!entry) {
        entry = { rev0: false, furtherRev: false };
        uniqueSubMap.set(subKey, entry);
      }
      const rawRev = extractRevisionRaw(r);
      if (isRevision0(rawRev, r.isRev0)) entry.rev0 = true;
      if (isFurtherRevision(rawRev, r.isRev0)) entry.furtherRev = true;
    });

    let uniqueRev00 = 0;
    let uniqueFurtherRev = 0;
    uniqueSubMap.forEach(e => {
      if (e.rev0) uniqueRev00++;
      if (e.furtherRev) uniqueFurtherRev++;
    });
    const totalUniqueSubmittals = uniqueSubMap.size;

    // GRAIN C: Current State Grain
    // Group by deliverable key to determine the latest state of each unique item
    const deliverableHistory = new Map<string, SubmittalRow[]>();
    groupRows.forEach(r => {
      const delKey = getRowDeliverableKey(r, grp.register, grp.discipline);
      if (!deliverableHistory.has(delKey)) {
        deliverableHistory.set(delKey, []);
      }
      deliverableHistory.get(delKey)!.push(r);
    });

    let approved = 0;
    let rejectedOpen = 0;
    let rejectedClosed = 0;
    let pending = 0;
    let finalClosed = 0;
    let unclassified = 0;
    let resolvedRejections = 0;
    let supersededHistoricalRows = 0;

    deliverableHistory.forEach((delRows) => {
      // If this deliverable has multiple rows, prior rows are superseded
      if (delRows.length > 1) {
        supersededHistoricalRows += (delRows.length - 1);
      }

      // Check if item had historical rejection and was subsequently resolved
      let hadRejection = false;
      delRows.forEach(r => {
        const cat = getStatusCodeCategory(r);
        if (cat === 'REJECTED_OPEN' || cat === 'REJECTED_CLOSED') {
          hadRejection = true;
        }
      });

      // Find latest row based on date or revision
      const sorted = [...delRows].sort((a, b) => {
        const tA = a.submissionDate ? new Date(a.submissionDate).getTime() : 0;
        const tB = b.submissionDate ? new Date(b.submissionDate).getTime() : 0;
        if (tA !== tB) return tB - tA;
        return (b.rev || '').localeCompare(a.rev || '');
      });
      const latestRow = sorted[0];
      const latestCat = getStatusCodeCategory(latestRow);

      switch (latestCat) {
        case 'APPROVED':
          approved++;
          if (hadRejection) resolvedRejections++;
          break;
        case 'REJECTED_OPEN':
          rejectedOpen++;
          break;
        case 'REJECTED_CLOSED':
          rejectedClosed++;
          break;
        case 'FINAL_CLOSED':
          finalClosed++;
          break;
        case 'PENDING':
          pending++;
          break;
        case 'UNCLASSIFIED':
        default:
          unclassified++;
          break;
      }
    });

    const totalCurrentUnique = deliverableHistory.size;
    const totalRejected = rejectedOpen + rejectedClosed;
    const rawDifference = totalRows - totalCurrentUnique;
    const isMathematicallyBalanced = totalCurrentUnique + supersededHistoricalRows === totalRows;

    const explanationEn = rawDifference === 0
      ? `Total Rows (${totalRows}) exactly match Current Unique Items (${totalCurrentUnique}) with 0 superseded historical revisions.`
      : `The difference of ${rawDifference} between Total Rows (${totalRows}) and Current Unique Items (${totalCurrentUnique}) represents ${supersededHistoricalRows} superseded prior revision rows (historical submission events that advanced to subsequent revisions), leaving ${totalCurrentUnique} active/latest unique deliverables (${approved} Approved, ${rejectedOpen} Rejected Open, ${rejectedClosed} Rejected Closed, ${pending} Pending/Under Review${finalClosed > 0 ? `, ${finalClosed} Final Closed` : ''}${unclassified > 0 ? `, ${unclassified} Unclassified` : ''}).`;

    const explanationAr = rawDifference === 0
      ? `إجمالي الصفوف (${totalRows}) يتطابق تماماً مع عدد البنود الفريدة الحالية (${totalCurrentUnique}) بدون أي مراجعات سابقة ملغاة.`
      : `الفارق البالغ ${rawDifference} بين إجمالي الصفوف (${totalRows}) والبنود الفريدة الحالية (${totalCurrentUnique}) يمثل ${supersededHistoricalRows} صفاً لمراجعات تاريخية سابقة تم استبدالها بمراجعات أحدث، ليتبقى ${totalCurrentUnique} بنداً فريداً بحالته الحالية (${approved} معتمد، ${rejectedOpen} مرفوض مفتوح، ${rejectedClosed} مرفوض مغلق، ${pending} معلق قيد المراجعة${finalClosed > 0 ? `، ${finalClosed} مغلق نهائياً` : ''}${unclassified > 0 ? `، ${unclassified} غير مصنف` : ''}).`;

    records.push({
      register: grp.register,
      discipline: grp.discipline,
      identityKey,
      grainA: {
        rev00Rows,
        furtherRevRows,
        totalRows,
        totalRejectedRows,
        rejectedOpenRows,
        rejectedClosedRows,
        resolvedRejections,
        rawRowsByStatus
      },
      grainB: {
        uniqueRev00,
        uniqueFurtherRev,
        totalUniqueSubmittals
      },
      grainC: {
        totalCurrentUnique,
        approved,
        rejectedOpen,
        rejectedClosed,
        totalRejected,
        pending,
        finalClosed,
        unclassified
      },
      reconciliation: {
        rawDifference,
        supersededHistoricalRows,
        isMathematicallyBalanced,
        explanationEn,
        explanationAr
      },
      rawRows: groupRows
    });
  });

  // Sort records logically: Register order, then discipline order
  const regOrder = ['SDW', 'SHD', 'ABD', 'MAR', 'DOC', 'WIR', 'MIR', 'RFI', 'NCR', 'SOR', 'LTR'];
  const discOrder = ['STR', 'STRUCTURAL', 'CIVIL', 'ARC', 'ARCH', 'ARCHITECTURAL', 'MEC', 'MECH', 'MECHANICAL', 'ELE', 'ELEC', 'ELECTRICAL', 'INFRA', 'INF', 'LAND', 'LND', 'LANDSCAPE', 'SUR', 'SURVEY', 'HSE', 'GEN', 'GENERAL'];

  records.sort((a, b) => {
    const regA = regOrder.indexOf(a.register);
    const regB = regOrder.indexOf(b.register);
    const effRegA = regA === -1 ? 999 : regA;
    const effRegB = regB === -1 ? 999 : regB;
    if (effRegA !== effRegB) return effRegA - effRegB;

    const discA = discOrder.indexOf(a.discipline);
    const discB = discOrder.indexOf(b.discipline);
    const effDiscA = discA === -1 ? 999 : discA;
    const effDiscB = discB === -1 ? 999 : discB;
    if (effDiscA !== effDiscB) return effDiscA - effDiscB;

    return a.identityKey.localeCompare(b.identityKey);
  });

  // Compute Grand Totals
  const sumA = {
    rev00Rows: records.reduce((acc, r) => acc + r.grainA.rev00Rows, 0),
    furtherRevRows: records.reduce((acc, r) => acc + r.grainA.furtherRevRows, 0),
    totalRows: records.reduce((acc, r) => acc + r.grainA.totalRows, 0),
    totalRejectedRows: records.reduce((acc, r) => acc + r.grainA.totalRejectedRows, 0),
    rejectedOpenRows: records.reduce((acc, r) => acc + r.grainA.rejectedOpenRows, 0),
    rejectedClosedRows: records.reduce((acc, r) => acc + r.grainA.rejectedClosedRows, 0),
    resolvedRejections: records.reduce((acc, r) => acc + r.grainA.resolvedRejections, 0),
  };

  const sumB = {
    uniqueRev00: records.reduce((acc, r) => acc + r.grainB.uniqueRev00, 0),
    uniqueFurtherRev: records.reduce((acc, r) => acc + r.grainB.uniqueFurtherRev, 0),
    totalUniqueSubmittals: records.reduce((acc, r) => acc + r.grainB.totalUniqueSubmittals, 0),
  };

  const sumC = {
    totalCurrentUnique: records.reduce((acc, r) => acc + r.grainC.totalCurrentUnique, 0),
    approved: records.reduce((acc, r) => acc + r.grainC.approved, 0),
    rejectedOpen: records.reduce((acc, r) => acc + r.grainC.rejectedOpen, 0),
    rejectedClosed: records.reduce((acc, r) => acc + r.grainC.rejectedClosed, 0),
    totalRejected: records.reduce((acc, r) => acc + r.grainC.totalRejected, 0),
    pending: records.reduce((acc, r) => acc + r.grainC.pending, 0),
    finalClosed: records.reduce((acc, r) => acc + r.grainC.finalClosed, 0),
    unclassified: records.reduce((acc, r) => acc + r.grainC.unclassified, 0),
  };

  const totalDifference = sumA.totalRows - sumC.totalCurrentUnique;
  const totalSupersededRows = records.reduce((acc, r) => acc + r.reconciliation.supersededHistoricalRows, 0);

  const grandExplanationEn = `Across all ${records.length} Register + Discipline groups, Total Historical Rows count is ${sumA.totalRows} against ${sumC.totalCurrentUnique} Total Current Unique Items, yielding a grand reconciliation difference of ${totalDifference}. This delta represents ${totalSupersededRows} superseded historical revision rows from prior iterations across project disciplines.`;
  const grandExplanationAr = `عبر كافة مجموعات السجلات والتخصصات البالغ عددها ${records.length} مجموعة، يبلغ إجمالي الصفوف التاريخية ${sumA.totalRows} مقابل ${sumC.totalCurrentUnique} بنداً فريداً بحالته الحالية، مما ينتج فارق تدقيق كلي قدره ${totalDifference}. يمثل هذا الفارق ${totalSupersededRows} صفاً لمراجعات تاريخية سابقة تم تطويرها عبر مراحل المشروع.`;

  return {
    records,
    grandTotal: {
      grainA: sumA,
      grainB: sumB,
      grainC: sumC,
      totalDifference,
      totalSupersededRows,
      explanationEn: grandExplanationEn,
      explanationAr: grandExplanationAr
    }
  };
}
