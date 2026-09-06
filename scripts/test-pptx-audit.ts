import { generatePptxReport } from '../src/analytics/exportEngine';
import { calculateExecutiveDashboardData } from '../src/analytics/exportHelpers';
import { SubmittalRow, ProjectSettings } from '../src/types';

export interface PPTXAuditSnapshot {
  slideCount: number;
  rejectedSlideCount: number;
  pendingSlideCount: number;
  registerBreakdownSlideCount: number;
  rejectedRowCount: number;
  pendingRowCount: number;
  byDocTypeRowCount: number;
  kpis: {
    totalSubmissions: number;
    approved: number;
    rejectedOpen: number;
    rejectedClosed: number;
    pending: number;
    approvalRate: number;
  };
}

export function generateTestDataset(numRejected: number = 45, numPending: number = 30): SubmittalRow[] {
  const rows: SubmittalRow[] = [];
  const docTypes = ['SDW', 'ABD', 'MAR', 'DOC', 'MIR', 'WIR', 'RFI', 'NCR', 'SOR', 'TRS', 'LTR'];
  const disciplines = ['STR', 'Arch', 'Mech', 'Elec', 'Infra', 'Landscape'];
  
  let id = 1;
  // 1. Approved items across all doc types
  for (const dt of docTypes) {
    for (const disc of disciplines) {
      rows.push({
        id: `ROW-${id++}`,
        docNo: `${dt}-${disc}-APP-001`,
        rev: '00',
        submissionDate: '2026-07-01',
        dueDate: '2026-07-15',
        responseDate: '2026-07-10',
        status: 'A',
        discipline: disc,
        documentType: dt,
        workflowStage: 'Approved',
        delayDays: 0
      });
    }
  }

  // 2. Large set of Rejected items to test multi-slide pagination
  for (let i = 1; i <= numRejected; i++) {
    const dt = docTypes[i % docTypes.length];
    const disc = disciplines[i % disciplines.length];
    rows.push({
      id: `ROW-${id++}`,
      docNo: `${dt}-${disc}-REJ-${String(i).padStart(3, '0')}`,
      rev: '00',
      submissionDate: '2026-06-01',
      dueDate: '2026-06-15',
      responseDate: '2026-06-20',
      status: 'C',
      discipline: disc,
      documentType: dt,
      workflowStage: 'Rejected',
      delayDays: 10 + (i % 30)
    });
  }

  // 3. Large set of Pending items to test multi-slide pagination
  for (let i = 1; i <= numPending; i++) {
    const dt = docTypes[i % docTypes.length];
    const disc = disciplines[i % disciplines.length];
    rows.push({
      id: `ROW-${id++}`,
      docNo: `${dt}-${disc}-PND-${String(i).padStart(3, '0')}`,
      rev: '00',
      submissionDate: '2026-06-10',
      dueDate: '2026-06-24',
      responseDate: '',
      status: 'W',
      discipline: disc,
      documentType: dt,
      workflowStage: 'Pending',
      delayDays: 5 + (i % 25)
    });
  }

  return rows;
}

export function computeDatasetKPIs(rows: SubmittalRow[]) {
  const dashData = calculateExecutiveDashboardData(rows, false);
  return {
    totalSubmissions: dashData.globalStats.totalSubmissions,
    approved: dashData.globalStats.approved,
    rejectedOpen: dashData.globalStats.rejectedOpen,
    rejectedClosed: dashData.globalStats.rejectedClosed,
    pending: dashData.globalStats.pending,
    approvalRate: dashData.globalStats.approvalRate,
    byDocTypeCount: dashData.byDocType.length
  };
}
