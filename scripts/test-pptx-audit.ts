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
  
  const createRow = (partial: Partial<SubmittalRow>): SubmittalRow => ({
    logType: 'Submittals',
    trade: partial.discipline || 'General',
    isLatestRev: true,
    isRev0: true,
    overdue: false,
    sheetNo: '1',
    contractor: 'Contractor',
    consultant: 'Consultant',
    remarks: '',
    ...partial
  } as SubmittalRow);

  let id = 1;
  // 1. Approved items across all doc types
  for (const dt of docTypes) {
    for (const disc of disciplines) {
      rows.push(createRow({
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
      }));
    }
  }

  // 2. Large set of Rejected items to test multi-slide pagination
  for (let i = 1; i <= numRejected; i++) {
    const dt = docTypes[i % docTypes.length];
    const disc = disciplines[i % disciplines.length];
    rows.push(createRow({
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
    }));
  }

  // 3. Large set of Pending items to test multi-slide pagination
  for (let i = 1; i <= numPending; i++) {
    const dt = docTypes[i % docTypes.length];
    const disc = disciplines[i % disciplines.length];
    rows.push(createRow({
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
    }));
  }

  return rows;
}

export function computeDatasetKPIs(rows: SubmittalRow[]) {
  const dashData = calculateExecutiveDashboardData(rows, rows, false);
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

export function runExecutiveNarrativeIntegrityAudit(): boolean {
  console.log("=== RUNNING EXECUTIVE NARRATIVE INTEGRITY & AUDIT TEST SUITE ===");

  // 1. Cumulative Mock Dataset with high SLA exposure (376 overdue / 388 active = 96.9%, PPI = 95)
  const cumulativeMockRows: SubmittalRow[] = [];
  // 8328 Approved
  for (let i = 0; i < 8328; i++) {
    cumulativeMockRows.push({
      id: `APP-${i}`,
      docNo: `DOC-STR-APP-${i}`,
      rev: '00',
      status: 'A',
      discipline: 'STR',
      documentType: 'DOC',
      workflowStage: 'Approved',
      submissionDate: '2025-10-01',
      dueDate: '2025-10-15',
      responseDate: '2025-10-10',
      overdue: false,
      isLatestRev: true,
      trade: 'STR'
    } as SubmittalRow);
  }
  // 373 Rejected/Open (372 Overdue, 1 On-time)
  for (let i = 0; i < 373; i++) {
    const isOd = i < 372;
    cumulativeMockRows.push({
      id: `REJ-${i}`,
      docNo: `DOC-STR-REJ-${i}`,
      rev: '00',
      status: 'C',
      discipline: 'STR',
      documentType: 'DOC',
      workflowStage: 'Rejected',
      submissionDate: isOd ? '2025-10-01' : '2026-09-20',
      dueDate: isOd ? '2025-10-15' : '2026-10-15',
      responseDate: isOd ? '2025-10-25' : '2026-09-22',
      overdue: isOd,
      delayDays: isOd ? 15 : 2,
      isLatestRev: true,
      trade: 'STR'
    } as SubmittalRow);
  }
  // 15 Pending (4 Overdue, 11 On-time)
  for (let i = 0; i < 15; i++) {
    const isOd = i < 4;
    cumulativeMockRows.push({
      id: `PND-${i}`,
      docNo: `DOC-STR-PND-${i}`,
      rev: '00',
      status: 'W',
      discipline: 'STR',
      documentType: 'DOC',
      workflowStage: 'Pending',
      submissionDate: isOd ? '2025-10-01' : '2026-09-20',
      dueDate: isOd ? '2025-10-15' : '2026-10-15',
      responseDate: '',
      overdue: isOd,
      delayDays: isOd ? 20 : 5,
      isLatestRev: true,
      trade: 'STR'
    } as SubmittalRow);
  }

  const cumData = calculateExecutiveDashboardData(cumulativeMockRows, cumulativeMockRows, false);

  // Assertion 1: Narrative must decouple PPI from SLA Exposure
  if (cumData.executiveSummaryBrief.en.includes("minimal backlog overdue")) {
    throw new Error("P0 Critical Defect Failed: High overdue cumulative narrative still says 'minimal backlog overdue'!");
  }
  if (!cumData.executiveSummaryBrief.en.includes("significant operational SLA exposure remains") || !cumData.executiveSummaryBrief.en.includes("376 of 388 active items currently overdue")) {
    throw new Error(`P0 Critical Defect Failed: Cumulative narrative did not accurately state 376 of 388 active items overdue! Output was: ${cumData.executiveSummaryBrief.en}`);
  }
  console.log("✔ Passed: Cumulative Executive Health Narrative correctly flags SLA exposure without 'minimal backlog overdue'");

  // Assertion 2: Recommendation must call out exact breakdown (372 Rejected/Open and 4 Pending Review)
  const overdueRec = cumData.priorityRecommendations.find(r => r.id === 'rec-overdue');
  if (!overdueRec) {
    throw new Error("P0 Critical Defect Failed: Overdue recommendation missing from priorityRecommendations!");
  }
  if (!overdueRec.en.includes("376 active items currently exceeding the applicable SLA") || !overdueRec.en.includes("372 Rejected/Open items and 4 Pending Review items")) {
    throw new Error(`P0 Critical Defect Failed: Overdue recommendation text mismatch! Expected 372 Rejected/Open and 4 Pending Review items. Got: ${overdueRec.en}`);
  }
  console.log("✔ Passed: Cumulative Overdue Recommendation accurately specifies 372 Rejected/Open and 4 Pending Review items");

  // 2. Monthly Mock Dataset (82 total, 67 Approved, 2 Rejected Open, 13 Pending, 4 Overdue = 26.7%)
  const monthlyMockRows: SubmittalRow[] = [];
  for (let i = 0; i < 67; i++) {
    monthlyMockRows.push({
      id: `M-APP-${i}`,
      docNo: `DOC-STR-MAPP-${i}`,
      rev: '00',
      status: 'A',
      discipline: 'STR',
      documentType: 'DOC',
      workflowStage: 'Approved',
      submissionDate: '2026-08-01',
      dueDate: '2026-08-15',
      responseDate: '2026-08-10',
      overdue: false,
      isLatestRev: true,
      trade: 'STR'
    } as SubmittalRow);
  }
  for (let i = 0; i < 2; i++) {
    monthlyMockRows.push({
      id: `M-REJ-${i}`,
      docNo: `DOC-STR-MREJ-${i}`,
      rev: '00',
      status: 'C',
      discipline: 'STR',
      documentType: 'DOC',
      workflowStage: 'Rejected',
      submissionDate: '2026-08-01',
      dueDate: '2026-08-15',
      responseDate: '2026-08-12',
      overdue: false,
      isLatestRev: true,
      trade: 'STR'
    } as SubmittalRow);
  }
  for (let i = 0; i < 13; i++) {
    const isOd = i < 4;
    monthlyMockRows.push({
      id: `M-PND-${i}`,
      docNo: `DOC-STR-MPND-${i}`,
      rev: '00',
      status: 'W',
      discipline: 'STR',
      documentType: 'DOC',
      workflowStage: 'Pending',
      submissionDate: isOd ? '2025-10-01' : '2026-09-20',
      dueDate: isOd ? '2025-10-15' : '2026-10-15',
      responseDate: '',
      overdue: isOd,
      delayDays: isOd ? 18 : 3,
      isLatestRev: true,
      trade: 'STR'
    } as SubmittalRow);
  }

  const monthlyData = calculateExecutiveDashboardData(monthlyMockRows, monthlyMockRows, false);
  if (monthlyData.executiveSummaryBrief.en.includes("minimal backlog overdue")) {
    throw new Error("P1 Finding Failed: Monthly report narrative with 26.7% overdue items used 'minimal backlog overdue'!");
  }
  if (!monthlyData.executiveSummaryBrief.en.includes("4 of 15 active items (26.7%) are currently overdue and require focused SLA follow-up")) {
    throw new Error(`P1 Finding Failed: Monthly report narrative text mismatch! Got: ${monthlyData.executiveSummaryBrief.en}`);
  }
  console.log("✔ Passed: Monthly Narrative correctly quantifies 4 of 15 active items (26.7%) overdue");

  return true;
}

// Automatically execute audit suite when run directly via tsx
runExecutiveNarrativeIntegrityAudit();

