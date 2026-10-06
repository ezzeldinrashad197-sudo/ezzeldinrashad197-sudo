import { calculateCanonicalKPIs, calculateNCRStats, getBusinessEntityKey, getDocumentIdentityKey, getSubmissionIdentityKey, getStatusCodeCategory, processRevisionEngine, classifyRow } from '../calculationFoundation';
import {
  processNCRData,
  calculateCumulativeSnapshot,
  calculateMonthlyEvents,
  normalizeDiscipline,
  normalizeNCRData,
  getLatestRev,
  getRevisionActivityDateMs,
  normalizeNcrRevisionHistory,
  compileCanonicalNCRPresentationStats
} from '../ncr/ncrEngine';
import { calculateNCRStats as calculateLegacyAnalyticsNCRStats } from '../../utils/ncrAnalytics';
import {
  isValidRevision,
  getRevisionWeight,
  getNormalizedRevision,
  isRevision0,
  isFurtherRevision,
  assertRevisionInvariants,
  extractRevisionRaw
} from '../revisionResolver';
import { SubmittalRow } from '../../types';
import { normalizeData } from '../../utils/calculations';
import {
  buildManagementReportOutput,
  resolveOfficialSubmittalRegister,
  resolveRowRegister,
  auditOfficialSourcePopulation,
  exportOfficialManagementReportXlsx
} from '../managementReportOutput';
import { calculateExecutiveDashboardData, compileStatsForBaseType } from '../exportHelpers';

export function runCanonicalCalculationTests(): { name: string; passed: boolean; error?: string }[] {
  const testResults: { name: string; passed: boolean; error?: string }[] = [];

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      testResults.push({ name, passed: true });
    } catch (e: any) {
      testResults.push({ name, passed: false, error: e.message || String(e) });
    }
  };

  // Test 1: One SUB Ref with Rev0 rejected + Rev1 approved
  test('ER-001: Rev0 Rejected + Rev1 Approved -> Current Approved=1, Current Rejected=0, ResolvedRejections=1', () => {
    const rows: SubmittalRow[] = [
      {
        id: '1',
        docNo: 'DOC-STR-001',
        rev: '00',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        workflowStage: 'Rejected',
        status: 'C',
        submissionDate: '2026-01-01',
        dueDate: '2026-01-15',
        responseDate: '2026-01-10',
        logType: 'DOC',
        contractor: 'Main',
        consultant: 'Eng',
        remarks: '',
        area: '',
        tradeSystem: '',
        isLatestRev: false,
        isRev0: true,
        delayDays: 0,
        overdue: false
      },
      {
        id: '2',
        docNo: 'DOC-STR-001',
        rev: '01',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        workflowStage: 'Approved',
        status: 'A',
        submissionDate: '2026-01-20',
        dueDate: '2026-02-05',
        responseDate: '2026-01-25',
        logType: 'DOC',
        contractor: 'Main',
        consultant: 'Eng',
        remarks: '',
        area: '',
        tradeSystem: '',
        isLatestRev: true,
        isRev0: false,
        delayDays: 0,
        overdue: false
      }
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.totalSubmittedSheets !== 2) throw new Error(`Expected 2 sheets submitted, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected 1 unique drawing, got ${kpi.totalUniqueDrawings}`);
    if (kpi.approved !== 1) throw new Error(`Expected 1 Approved current item, got ${kpi.approved}`);
    if (kpi.rejectedOpen !== 0) throw new Error(`Expected 0 Rejected Open current items, got ${kpi.rejectedOpen}`);
    if (kpi.rejectedClosed !== 0) throw new Error(`Expected 0 Rejected Closed current items, got ${kpi.rejectedClosed}`);
    if (kpi.rejectionEvents !== 1) throw new Error(`Expected 1 Rejection Event, got ${kpi.rejectionEvents}`);
    if (kpi.resolvedRejections !== 1) throw new Error(`Expected 1 Resolved Rejection, got ${kpi.resolvedRejections}`);
    if (!kpi.reconciliationPassed) throw new Error(`Reconciliation equations failed`);
  });

  // Test 2: One SUB Ref with Rev0 rejected/open + Rev1 rejected/open
  test('ER-002: Rev0 Rejected/Open + Rev1 Rejected/Open -> Current Rejected Open=1, not 2', () => {
    const rows: SubmittalRow[] = [
      {
        id: '1',
        docNo: 'DOC-STR-002',
        rev: '00',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        workflowStage: 'Rejected',
        status: 'C',
        recordStatus: 'OPEN',
        submissionDate: '2026-01-01',
        dueDate: '2026-01-15',
        responseDate: '2026-01-10',
        logType: 'DOC',
        contractor: 'Main',
        consultant: 'Eng',
        remarks: '',
        area: '',
        tradeSystem: '',
        isLatestRev: false,
        isRev0: true,
        delayDays: 0,
        overdue: false
      },
      {
        id: '2',
        docNo: 'DOC-STR-002',
        rev: '01',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        workflowStage: 'Rejected',
        status: 'C',
        recordStatus: 'OPEN',
        submissionDate: '2026-01-20',
        dueDate: '2026-02-05',
        responseDate: '2026-01-25',
        logType: 'DOC',
        contractor: 'Main',
        consultant: 'Eng',
        remarks: '',
        area: '',
        tradeSystem: '',
        isLatestRev: true,
        isRev0: false,
        delayDays: 0,
        overdue: false
      }
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.totalSubmittedSheets !== 2) throw new Error(`Expected 2 sheets, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected 1 unique drawing, got ${kpi.totalUniqueDrawings}`);
    if (kpi.rejectedOpen !== 1) throw new Error(`Expected 1 Rejected Open item, got ${kpi.rejectedOpen}`);
    if (kpi.rejectionEvents !== 2) throw new Error(`Expected 2 Rejection Events, got ${kpi.rejectionEvents}`);
    if (kpi.resolvedRejections !== 0) throw new Error(`Expected 0 Resolved Rejections, got ${kpi.resolvedRejections}`);
  });

  // Test 3: Blank status is not Pending
  test('ER-003: Blank status is classified as UNCLASSIFIED and flagged in DataQualityLedger', () => {
    const rows: SubmittalRow[] = [
      {
        id: '1',
        docNo: 'DOC-STR-003',
        rev: '00',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        workflowStage: '',
        status: '',
        submissionDate: '2026-01-01',
        dueDate: '2026-01-15',
        responseDate: '',
        logType: 'DOC',
        contractor: 'Main',
        consultant: 'Eng',
        remarks: '',
        area: '',
        tradeSystem: '',
        isLatestRev: true,
        isRev0: true,
        delayDays: 0,
        overdue: false
      }
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.unclassified !== 1) throw new Error(`Expected 1 unclassified item, got ${kpi.unclassified}`);
    if (kpi.pending !== 0) throw new Error(`Blank status should not be Pending, got ${kpi.pending}`);
    if (kpi.dataQuality.blankStatusCount !== 1) throw new Error(`Expected 1 blank status issue in Data Quality Ledger`);
  });

  // Test 4: Survey (SUR) and Architectural (ARC) Separation
  test('ER-004: Survey and Architectural entities are resolved to distinct keys', () => {
    const rowArc: SubmittalRow = {
      id: '1',
      docNo: 'WIR-ARC-001',
      rev: '00',
      sheetNo: '01',
      documentType: 'WIR',
      discipline: 'ARC',
      trade: 'Architectural',
      workflowStage: 'Approved',
      status: 'A',
      submissionDate: '2026-01-01',
      dueDate: '',
      responseDate: '',
      logType: 'WIR',
      contractor: 'Main',
      consultant: 'Eng',
      remarks: '',
      area: '',
      tradeSystem: '',
      isLatestRev: true,
      isRev0: true,
      delayDays: 0,
      overdue: false
    };

    const rowSur: SubmittalRow = {
      id: '2',
      docNo: 'WIR-SUR-001',
      rev: '00',
      sheetNo: '01',
      documentType: 'WIR',
      discipline: 'SUR',
      trade: 'Survey',
      workflowStage: 'Approved',
      status: 'A',
      submissionDate: '2026-01-01',
      dueDate: '',
      responseDate: '',
      logType: 'WIR',
      contractor: 'Main',
      consultant: 'Eng',
      remarks: '',
      area: '',
      tradeSystem: '',
      isLatestRev: true,
      isRev0: true,
      delayDays: 0,
      overdue: false
    };

    const keyArc = getBusinessEntityKey(rowArc);
    const keySur = getBusinessEntityKey(rowSur);
    if (keyArc === keySur) throw new Error(`ARC and SUR collided on key: ${keyArc}`);
    if (!keyArc.includes('WIR') && !keyArc.includes('ARC')) throw new Error(`Unexpected key format for ARC: ${keyArc}`);
    if (!keySur.includes('WIR') && !keySur.includes('SUR')) throw new Error(`Unexpected key format for SUR: ${keySur}`);
  });

  // Test 5: Mathematical Reconciliation Invariants
  test('ER-005: Dual-dimension mathematical reconciliation invariant check', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'D-1', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'D-2', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
      { id: '3', docNo: 'D-3', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'D', recordStatus: 'CLOSED', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false },
      { id: '4', docNo: 'D-4', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Pending', status: 'W', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (!kpi.isWorkloadReconciled) throw new Error('Workload reconciliation failed');
    if (!kpi.isCurrentStateReconciled) throw new Error('Current-state reconciliation failed');
    if (!kpi.reconciliationPassed) throw new Error('Master reconciliation flag is false');
  });

  // Test 6: User Case A: Rev 0 (CLOSED/A) -> Rev 1 (OPEN/C)
  test('ER-006: Rev 0 (Closed/A) + Rev 1 (Open/C) -> Unique=1, Approved=0, RejectedOpen=1, RejectionEvents=1, ResolvedRejections=0', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'SUB-001', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'SUB-001', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-10', dueDate: '', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected Unique=1, got ${kpi.totalUniqueDrawings}`);
    if (kpi.approved !== 0) throw new Error(`Expected Approved=0, got ${kpi.approved}`);
    if (kpi.rejectedOpen !== 1) throw new Error(`Expected Rejected Open=1, got ${kpi.rejectedOpen}`);
    if (kpi.rejectedClosed !== 0) throw new Error(`Expected Rejected Closed=0, got ${kpi.rejectedClosed}`);
    if (kpi.pending !== 0) throw new Error(`Expected Pending=0, got ${kpi.pending}`);
    if (kpi.rejectionEvents !== 1) throw new Error(`Expected Rejection Events=1, got ${kpi.rejectionEvents}`);
    if (kpi.resolvedRejections !== 0) throw new Error(`Expected Resolved Rejections=0, got ${kpi.resolvedRejections}`);
  });

  // Test 7: User Case B: Rev 0 (CLOSED/A) -> Rev 1 (OPEN/C) -> Rev 2 (CLOSED/A)
  test('ER-007: Rev 0 (Closed/A) + Rev 1 (Open/C) + Rev 2 (Closed/A) -> Unique=1, Approved=1, RejectedOpen=0, RejectionEvents=1, ResolvedRejections=1', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'SUB-001', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'SUB-001', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-10', dueDate: '', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: false, delayDays: 0, overdue: false },
      { id: '3', docNo: 'SUB-001', rev: '02', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-20', dueDate: '', responseDate: '2026-01-25', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected Unique=1, got ${kpi.totalUniqueDrawings}`);
    if (kpi.approved !== 1) throw new Error(`Expected Approved=1, got ${kpi.approved}`);
    if (kpi.rejectedOpen !== 0) throw new Error(`Expected Rejected Open=0, got ${kpi.rejectedOpen}`);
    if (kpi.rejectedClosed !== 0) throw new Error(`Expected Rejected Closed=0, got ${kpi.rejectedClosed}`);
    if (kpi.pending !== 0) throw new Error(`Expected Pending=0, got ${kpi.pending}`);
    if (kpi.rejectionEvents !== 1) throw new Error(`Expected Rejection Events=1, got ${kpi.rejectionEvents}`);
    if (kpi.resolvedRejections !== 1) throw new Error(`Expected Resolved Rejections=1, got ${kpi.resolvedRejections}`);
  });

  // Test 8: User Case C: Rev 0 (OPEN/C) -> Rev 1 (CLOSED/D)
  test('ER-008: Rev 0 (Open/C) + Rev 1 (Closed/D) -> Unique=1, Approved=1, Closed=1, RejectedOpen=0, RejectedClosed=0', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'SUB-001', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'SUB-001', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Disapproved', status: 'D', recordStatus: 'CLOSED', submissionDate: '2026-01-10', dueDate: '', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected Unique=1, got ${kpi.totalUniqueDrawings}`);
    if (kpi.approved !== 1 || kpi.currentApproved !== 1) throw new Error(`Expected Approved=1 for Code D, got ${kpi.approved}`);
    if (kpi.rejectedClosed !== 0) throw new Error(`Expected Rejected Closed=0, got ${kpi.rejectedClosed}`);
    if (kpi.rejectedOpen !== 0) throw new Error(`Expected Rejected Open=0, got ${kpi.rejectedOpen}`);
    if (kpi.currentClosed !== 1) throw new Error(`Expected currentClosed=1, got ${kpi.currentClosed}`);
    if (kpi.currentOpen !== 0) throw new Error(`Expected currentOpen=0, got ${kpi.currentOpen}`);
  });

  // Test 9: Overdue Backlog Evaluation
  test('ER-009: Overdue Backlog strictly checks Active Items against Due Date vs As-Of Date', () => {
    const rows: SubmittalRow[] = [
      // 1. Active Pending past due date -> Overdue = 1
      { id: '1', docNo: 'SUB-OVERDUE-1', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Pending', status: 'W', submissionDate: '2026-01-01', dueDate: '2026-01-10', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 5, overdue: true },
      // 2. Active Pending NOT past due date -> Overdue = 0
      { id: '2', docNo: 'SUB-PENDING-OK', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Pending', status: 'W', submissionDate: '2026-01-10', dueDate: '2026-01-25', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
      // 3. Approved item with past due date -> NOT Overdue (it is closed)
      { id: '3', docNo: 'SUB-CLOSED-LATE', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-01', dueDate: '2026-01-10', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 5, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows, undefined, '2026-01-15');
    if (kpi.pending !== 2) throw new Error(`Expected 2 Pending items, got ${kpi.pending}`);
    if (kpi.approved !== 1) throw new Error(`Expected 1 Approved item, got ${kpi.approved}`);
    if (kpi.overdue !== 1) throw new Error(`Expected exactly 1 Overdue item, got ${kpi.overdue}`);
    if (kpi.activeCurrentItems !== 2) throw new Error(`Expected activeCurrentItems=2, got ${kpi.activeCurrentItems}`);
  });

  // Test 10: Overdue is strictly an attribute/flag on Active Population and never exceeds it
  test('ER-010: Overdue is guaranteed to be a strict subset of Active Population (Pending + Rejected Open)', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'SUB-1', rev: '00', sheetNo: '01', documentType: 'DOC-GEN', discipline: 'GEN', trade: 'General', workflowStage: 'Pending', status: 'W', submissionDate: '2026-01-01', dueDate: '2026-01-10', responseDate: '', logType: 'DOC-GEN', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 5, overdue: true },
      { id: '2', docNo: 'SUB-2', rev: '00', sheetNo: '01', documentType: 'DOC-GEN', discipline: 'GEN', trade: 'General', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '2026-01-10', responseDate: '', logType: 'DOC-GEN', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 5, overdue: true },
      { id: '3', docNo: 'SUB-3', rev: '00', sheetNo: '01', documentType: 'DOC-GEN', discipline: 'GEN', trade: 'General', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-01', dueDate: '2026-01-10', responseDate: '2026-01-15', logType: 'DOC-GEN', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 5, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows, undefined, '2026-01-20');
    if (kpi.activeCurrentItems !== 2) throw new Error(`Expected activeCurrentItems=2, got ${kpi.activeCurrentItems}`);
    if (kpi.overdue !== 2) throw new Error(`Expected overdue=2, got ${kpi.overdue}`);
    if (kpi.overdue > (kpi.activeCurrentItems || 0)) throw new Error('Overdue exceeded active population!');
    if (!kpi.reconciliationPassed) throw new Error('Master reconciliation flag failed');
  });

  // Test 11: CRITICAL is an attribute, never a distinct logType
  test('ER-011: CRITICAL does not corrupt Log Type taxonomy into DOC-GENCRITICAL', () => {
    const rawRow: SubmittalRow = {
      id: '1',
      docNo: 'DOC-GEN-001',
      rev: '00',
      sheetNo: '01',
      documentType: 'DOC',
      discipline: 'GENERAL CRITICAL',
      trade: 'General',
      workflowStage: 'Pending',
      status: 'W',
      submissionDate: '2026-01-01',
      dueDate: '',
      responseDate: '',
      logType: 'DOC-GEN CRITICAL',
      contractor: '',
      consultant: '',
      remarks: 'HIGHLY CRITICAL SUBMITTAL',
      area: '',
      tradeSystem: '',
      isLatestRev: true,
      isRev0: true,
      delayDays: 0,
      overdue: false
    };

    const norm = normalizeData([rawRow])[0];
    if (norm.documentType.includes('CRITICAL')) {
      throw new Error(`LogType corrupted with CRITICAL attribute: ${norm.documentType}`);
    }
    if (!norm.documentType.startsWith('DOC')) {
      throw new Error(`Expected DOC*, got ${norm.documentType}`);
    }
  });

  // Test 12: Dual Grain Validation: Historical Row-Level Rejection vs Current Unique Item Status
  test('ER-012: Historical Row Rejections are preserved independently from Current Unique Item Status', () => {
    const rows: SubmittalRow[] = [
      // Item 1: Rev 0 Rejected Open -> Rev 1 Approved
      { id: '1', docNo: 'ITEM-1', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'ITEM-1', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-10', dueDate: '', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false },
      // Item 2: Rev 0 Rejected Open -> Rev 1 Rejected Open -> Rev 2 Rejected Closed (C + Closed)
      { id: '3', docNo: 'ITEM-2', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '4', docNo: 'ITEM-2', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-08', dueDate: '', responseDate: '2026-01-12', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: false, delayDays: 0, overdue: false },
      { id: '5', docNo: 'ITEM-2', rev: '02', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'CLOSED', submissionDate: '2026-01-15', dueDate: '', responseDate: '2026-01-20', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false },
      // Item 3: Rev 0 Pending
      { id: '6', docNo: 'ITEM-3', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Pending', status: 'W', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
    ];

    const kpi = calculateCanonicalKPIs(rows);

    // 1. Workload / Row Grain Assertions
    if (kpi.totalSubmittedSheets !== 6) throw new Error(`Expected 6 total submitted sheets, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalRejectedRows !== 4) throw new Error(`Expected 4 total rejected rows, got ${kpi.totalRejectedRows}`);
    if (kpi.rejectedOpenRows !== 3) throw new Error(`Expected 3 rejected open rows, got ${kpi.rejectedOpenRows}`);
    if (kpi.rejectedClosedRows !== 1) throw new Error(`Expected 1 rejected closed row, got ${kpi.rejectedClosedRows}`);

    // 2. Current Unique Item Grain Assertions
    if (kpi.totalUniqueDrawings !== 3) throw new Error(`Expected 3 unique items, got ${kpi.totalUniqueDrawings}`);
        // FIX (2026-08-30): ITEM-2 is Code C, closed at Rev 02 — it was rejected and closed,
    // NEVER approved. It must count as REJECTED_CLOSED, not APPROVED. Only ITEM-1 (genuinely
    // approved via Code A) belongs in currentApproved.
    if (kpi.currentApproved !== 1 || kpi.approved !== 1) throw new Error(`Expected 1 current approved item (ITEM-1 only), got ${kpi.currentApproved}`);
    if (kpi.currentRejectedClosed !== 1 || kpi.rejectedClosed !== 1) throw new Error(`Expected 1 current rejected closed item (ITEM-2), got ${kpi.currentRejectedClosed}`);
    if (kpi.currentRejectedOpen !== 0 || kpi.rejectedOpen !== 0) throw new Error(`Expected 0 current rejected open items, got ${kpi.currentRejectedOpen}`);
    if (kpi.currentRejected !== 1) throw new Error(`Expected 1 current total rejected item, got ${kpi.currentRejected}`);
    
    // 3. Historical Rejection Resolution Assertions
    if (kpi.resolvedRejections !== 1) throw new Error(`Expected 1 resolved rejection (ITEM-1 only), got ${kpi.resolvedRejections}`);
  });

  // Test 13: Case Normalization across lower/upper/mixed strings ('c', 'C', 'closed', 'w')
  test('ER-013: Centralized case normalization handles lowercase, whitespace, and mixed strings flawlessly', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'SUB-LOWER-1', rev: '00', sheetNo: '01', documentType: 'doc', discipline: 'str', trade: 'structural', workflowStage: 'rejected', status: 'c', recordStatus: 'open', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'doc', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'SUB-LOWER-2', rev: '00', sheetNo: '01', documentType: 'doc', discipline: 'str', trade: 'structural', workflowStage: 'rejected', status: 'c closed', recordStatus: 'closed', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'doc', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
      { id: '3', docNo: 'SUB-LOWER-3', rev: '00', sheetNo: '01', documentType: 'doc', discipline: 'str', trade: 'structural', workflowStage: 'approved', status: 'a', recordStatus: 'closed', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'doc', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false },
      { id: '4', docNo: 'SUB-LOWER-4', rev: '00', sheetNo: '01', documentType: 'doc', discipline: 'str', trade: 'structural', workflowStage: 'pending', status: 'w', recordStatus: 'open', submissionDate: '2026-01-01', dueDate: '', responseDate: '', logType: 'doc', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false }
    ];

    const kpi = calculateCanonicalKPIs(rows);
    if (kpi.totalRejectedRows !== 2) throw new Error(`Expected 2 total rejected rows, got ${kpi.totalRejectedRows}`);
    if (kpi.rejectedOpenRows !== 1) throw new Error(`Expected 1 rejected open row, got ${kpi.rejectedOpenRows}`);
    if (kpi.rejectedClosedRows !== 1) throw new Error(`Expected 1 rejected closed row, got ${kpi.rejectedClosedRows}`);
        // FIX (2026-08-30): SUB-LOWER-2 is Code C, closed — rejected and closed, not approved.
    if (kpi.approved !== 1) throw new Error(`Expected 1 approved item in unique current grain, got ${kpi.approved}`);
    if (kpi.rejectedClosed !== 1) throw new Error(`Expected 1 rejected-closed item in unique current grain, got ${kpi.rejectedClosed}`);
    if (kpi.pending !== 1) throw new Error(`Expected 1 pending item, got ${kpi.pending}`);
  });

  // Test 14: Cross-Register Rejection Consistency (NCR, MIR, WIR, RFI, SOR)
  test('ER-014: Cross-register status categorization handles NCR, MIR, WIR, RFI, SOR uniformly', () => {
    // 1. NCR
    const ncrRow: any = { id: 'NCR-1', ncrRef: 'NCR-001', rev: '0', ncrStatus: 'open', ncrAction: 'rejected', logType: 'NCR' };
    if (getStatusCodeCategory(ncrRow) !== 'REJECTED_OPEN') throw new Error(`NCR Rejection failed: ${getStatusCodeCategory(ncrRow)}`);

    // 2. MIR
    const mirRow: SubmittalRow = { id: 'MIR-1', docNo: 'MIR-001', rev: '0', status: 'c', recordStatus: 'open', logType: 'MIR' } as any;
    if (getStatusCodeCategory(mirRow) !== 'REJECTED_OPEN') throw new Error(`MIR Rejection failed: ${getStatusCodeCategory(mirRow)}`);

    // 3. WIR
    const wirRow: SubmittalRow = { id: 'WIR-1', docNo: 'WIR-001', rev: '0', status: 'c', recordStatus: 'closed', logType: 'WIR' } as any;
    if (getStatusCodeCategory(wirRow) !== 'REJECTED_CLOSED') throw new Error(`WIR Rejection failed: ${getStatusCodeCategory(wirRow)}`);

    // 4. RFI
    const rfiRow: SubmittalRow = { id: 'RFI-1', docNo: 'RFI-001', rev: '0', status: 'c', recordStatus: 'open', logType: 'RFI' } as any;
    if (getStatusCodeCategory(rfiRow) !== 'REJECTED_OPEN') throw new Error(`RFI Rejection failed: ${getStatusCodeCategory(rfiRow)}`);

    // 5. SOR
    const sorRow: any = { id: 'SOR-1', sorRef: 'SOR-001', rev: '0', sorStatus: 'closed', sorAction: 'rejected', logType: 'SOR' };
    if (getStatusCodeCategory(sorRow) !== 'REJECTED_CLOSED') throw new Error(`SOR Rejection failed: ${getStatusCodeCategory(sorRow)}`);
  });

  // Test 15: Sequence: Rev 0 (Rejected Open) -> Rev 1 (Rejected Closed) -> Rev 2 (Approved)
  test('ER-015-SEQ: Sequence Rev0(Rej Open) -> Rev1(Rej Closed) -> Rev2(Approved) validates historical row counts vs unique current state', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'ITEM-SEQ-1', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'ITEM-SEQ-1', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'CLOSED', submissionDate: '2026-01-10', dueDate: '', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: false, delayDays: 0, overdue: false },
      { id: '3', docNo: 'ITEM-SEQ-1', rev: '02', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-20', dueDate: '', responseDate: '2026-01-25', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false }
    ];

    const kpi = calculateCanonicalKPIs(rows);

    // Row-level grain assertions
    if (kpi.totalSubmittedSheets !== 3) throw new Error(`Expected 3 submitted sheets, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalRejectedRows !== 2) throw new Error(`Expected totalRejectedRows=2, got ${kpi.totalRejectedRows}`);
    if (kpi.rejectedOpenRows !== 1) throw new Error(`Expected rejectedOpenRows=1, got ${kpi.rejectedOpenRows}`);
    if (kpi.rejectedClosedRows !== 1) throw new Error(`Expected rejectedClosedRows=1, got ${kpi.rejectedClosedRows}`);

    // Unique current item grain assertions
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected totalUniqueDrawings=1, got ${kpi.totalUniqueDrawings}`);
    if (kpi.currentApproved !== 1) throw new Error(`Expected currentApproved=1, got ${kpi.currentApproved}`);
    if (kpi.currentRejected !== 0) throw new Error(`Expected currentRejected=0, got ${kpi.currentRejected}`);
    if (kpi.resolvedRejections !== 1) throw new Error(`Expected resolvedRejections=1, got ${kpi.resolvedRejections}`);
    if (kpi.approvalRate !== 100) throw new Error(`Expected approvalRate=100, got ${kpi.approvalRate}`);
  });

  // Test 16: Sequence: Rev 0 (Rejected Open) -> Rev 1 (Rejected Open) -> Rev 2 (Approved)
  test('ER-016-SEQ: Sequence Rev0(Rej Open) -> Rev1(Rej Open) -> Rev2(Approved) tracks 2 Open rejection events and 1 current approved item', () => {
    const rows: SubmittalRow[] = [
      { id: '1', docNo: 'ITEM-SEQ-2', rev: '00', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-01', dueDate: '', responseDate: '2026-01-05', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: true, delayDays: 0, overdue: false },
      { id: '2', docNo: 'ITEM-SEQ-2', rev: '01', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Rejected', status: 'C', recordStatus: 'OPEN', submissionDate: '2026-01-10', dueDate: '', responseDate: '2026-01-15', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: false, isRev0: false, delayDays: 0, overdue: false },
      { id: '3', docNo: 'ITEM-SEQ-2', rev: '02', sheetNo: '01', documentType: 'DOC', discipline: 'STR', trade: 'Structural', workflowStage: 'Approved', status: 'A', recordStatus: 'CLOSED', submissionDate: '2026-01-20', dueDate: '', responseDate: '2026-01-25', logType: 'DOC', contractor: '', consultant: '', remarks: '', area: '', tradeSystem: '', isLatestRev: true, isRev0: false, delayDays: 0, overdue: false }
    ];

    const kpi = calculateCanonicalKPIs(rows);

    // Row-level grain assertions
    if (kpi.totalSubmittedSheets !== 3) throw new Error(`Expected 3 submitted sheets, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalRejectedRows !== 2) throw new Error(`Expected totalRejectedRows=2, got ${kpi.totalRejectedRows}`);
    if (kpi.rejectedOpenRows !== 2) throw new Error(`Expected rejectedOpenRows=2, got ${kpi.rejectedOpenRows}`);
    if (kpi.rejectedClosedRows !== 0) throw new Error(`Expected rejectedClosedRows=0, got ${kpi.rejectedClosedRows}`);

    // Unique current item grain assertions
    if (kpi.totalUniqueDrawings !== 1) throw new Error(`Expected totalUniqueDrawings=1, got ${kpi.totalUniqueDrawings}`);
    if (kpi.currentApproved !== 1) throw new Error(`Expected currentApproved=1, got ${kpi.currentApproved}`);
    if (kpi.currentRejected !== 0) throw new Error(`Expected currentRejected=0, got ${kpi.currentRejected}`);
    if (kpi.resolvedRejections !== 1) throw new Error(`Expected resolvedRejections=1, got ${kpi.resolvedRejections}`);
  });

  // Test 17: ER-017: Code D -> APPROVED (Closed=true, Approved=true, distinct from REJECTED_CLOSED)
  test('ER-017: Code D -> APPROVED maintains Closed=true, Approved=true, and distinct status from REJECTED_CLOSED', () => {
    // 1. Single row classification verification across all canonical codes
    const catA = classifyRow('A', 'CLOSED');
    const catB = classifyRow('B', 'CLOSED');
    const catCOpen = classifyRow('C', 'OPEN');
    const catCClsd = classifyRow('C', 'CLOSED');
    const catD = classifyRow('D', 'CLOSED');
    const catDDisappr = classifyRow('DISAPPROVED', 'CLOSED');

    if (catA !== 'APPROVED') throw new Error(`Expected A -> APPROVED, got ${catA}`);
    if (catB !== 'APPROVED') throw new Error(`Expected B -> APPROVED, got ${catB}`);
    if (catCOpen !== 'REJECTED_OPEN') throw new Error(`Expected C + Open -> REJECTED_OPEN, got ${catCOpen}`);
    if (catCClsd !== 'REJECTED_CLOSED') throw new Error(`Expected C + Closed -> REJECTED_CLOSED, got ${catCClsd}`);
    if (catD !== 'APPROVED') throw new Error(`Expected D -> APPROVED, got ${catD}`);
    if (catDDisappr !== 'APPROVED') throw new Error(`Expected DISAPPROVED -> APPROVED, got ${catDDisappr}`);

    // 2. Row grain & item grain validation for Code D
    const rowD: SubmittalRow = {
      id: 'D-01',
      docNo: 'ITEM-D-FINAL-01',
      rev: '00',
      sheetNo: '01',
      documentType: 'DOC',
      discipline: 'STR',
      trade: 'Structural',
      workflowStage: 'Disapproved',
      status: 'D',
      recordStatus: 'CLOSED',
      submissionDate: '2026-01-01',
      dueDate: '',
      responseDate: '2026-01-05',
      logType: 'DOC',
      contractor: '',
      consultant: '',
      remarks: '',
      area: '',
      tradeSystem: '',
      isLatestRev: true,
      isRev0: true,
      delayDays: 0,
      overdue: false
    };

    const statusCode = getStatusCodeCategory(rowD);
    if (statusCode !== 'APPROVED') throw new Error(`Expected getStatusCodeCategory(rowD) === APPROVED, got ${statusCode}`);

    const kpi = calculateCanonicalKPIs([rowD]);

    // Rigorous assertions
    if (kpi.totalSubmittedSheets !== 1) throw new Error(`Expected totalSubmittedSheets=1, got ${kpi.totalSubmittedSheets}`);
    if (kpi.approved !== 1 || kpi.currentApproved !== 1) throw new Error(`Expected Approved=1 for Code D, got ${kpi.approved}`);
    if (kpi.rowApproved !== 1) throw new Error(`Expected rowApproved=1 for Code D, got ${kpi.rowApproved}`);
    if (kpi.rejectedClosed !== 0 || kpi.rejectedClosedRows !== 0) throw new Error(`Expected RejectedClosed=0 for Code D, got ${kpi.rejectedClosed}`);
    if (kpi.rejectedOpen !== 0 || kpi.rejectedOpenRows !== 0) throw new Error(`Expected RejectedOpen=0 for Code D, got ${kpi.rejectedOpen}`);
    if (kpi.currentClosed !== 1) throw new Error(`Expected currentClosed=1 for Code D, got ${kpi.currentClosed}`);
    if (kpi.currentOpen !== 0) throw new Error(`Expected currentOpen=0 for Code D, got ${kpi.currentOpen}`);
    if (kpi.approvalRate !== 100) throw new Error(`Expected approvalRate=100% for Code D, got ${kpi.approvalRate}`);

    // 3. Validation for Code C + Closed: Single-row/Historical grain is REJECTED_CLOSED, Current-state grain is APPROVED (closed)
    const rowCClsd: SubmittalRow = {
      id: 'C-01',
      docNo: 'ITEM-C-CLOSED-01',
      rev: '00',
      sheetNo: '01',
      documentType: 'DOC',
      discipline: 'STR',
      trade: 'Structural',
      workflowStage: 'Rejected',
      status: 'C',
      recordStatus: 'CLOSED',
      submissionDate: '2026-01-01',
      dueDate: '',
      responseDate: '2026-01-05',
      logType: 'DOC',
      contractor: '',
      consultant: '',
      remarks: '',
      area: '',
      tradeSystem: '',
      isLatestRev: true,
      isRev0: true,
      delayDays: 0,
      overdue: false
    };

    const statusCodeC = getStatusCodeCategory(rowCClsd);
    if (statusCodeC !== 'REJECTED_CLOSED') throw new Error(`Expected getStatusCodeCategory(rowCClsd) === REJECTED_CLOSED, got ${statusCodeC}`);

    const kpiC = calculateCanonicalKPIs([rowCClsd]);
    if (kpiC.rejectedClosedRows !== 1) throw new Error(`Expected rejectedClosedRows=1 for Code C Closed in historical row grain, got ${kpiC.rejectedClosedRows}`);
        // FIX (2026-08-30): this line previously contradicted the assertion right above it —
    // getStatusCodeCategory correctly returns REJECTED_CLOSED for Code C + Closed, but this
    // line wrongly expected the same item to ALSO count as Approved. A rejected item that was
    // administratively closed was never approved; it must count as rejected-closed only.
    if (kpiC.rejectedClosed !== 1 || kpiC.currentRejectedClosed !== 1) throw new Error(`Expected RejectedClosed=1 for Code C Closed in unique item grain, got ${kpiC.rejectedClosed}`);
    if (kpiC.approved !== 0 || kpiC.currentApproved !== 0) throw new Error(`Expected Approved=0 for Code C Closed in unique item grain, got ${kpiC.approved}`);
    if (kpiC.currentClosed !== 1) throw new Error(`Expected currentClosed=1 for Code C Closed, got ${kpiC.currentClosed}`);
  });

  // Test 15: Revision SSOT Semantic Consistency & Required Exhaustive Value Matrix (Issue #4)
  test('ER-015: Issue #4 Mandatory Value Matrix & Revision Semantic Consistency', () => {
    interface RevisionTestCase {
      raw: string | number | null | undefined;
      expectedValid: boolean;
      expectedWeight: number;
      expectedNormalized: string;
      expectedIsRev0: boolean;
      expectedIsFurther: boolean;
    }

    const testMatrix: RevisionTestCase[] = [
      // Rev00 / Baseline Group
      { raw: '0', expectedValid: true, expectedWeight: 0, expectedNormalized: '0', expectedIsRev0: true, expectedIsFurther: false },
      { raw: '00', expectedValid: true, expectedWeight: 0, expectedNormalized: '0', expectedIsRev0: true, expectedIsFurther: false },
      { raw: 'REV0', expectedValid: true, expectedWeight: 0, expectedNormalized: '0', expectedIsRev0: true, expectedIsFurther: false },
      { raw: 'REV 0', expectedValid: true, expectedWeight: 0, expectedNormalized: '0', expectedIsRev0: true, expectedIsFurther: false },
      { raw: 'REV.00', expectedValid: true, expectedWeight: 0, expectedNormalized: '0', expectedIsRev0: true, expectedIsFurther: false },

      // Blank / Invalid / Null Group (Strictly Missing / Invalid Revision)
      { raw: '', expectedValid: false, expectedWeight: -1, expectedNormalized: 'Unknown', expectedIsRev0: false, expectedIsFurther: false },
      { raw: ' ', expectedValid: false, expectedWeight: -1, expectedNormalized: 'Unknown', expectedIsRev0: false, expectedIsFurther: false },
      { raw: null, expectedValid: false, expectedWeight: -1, expectedNormalized: 'Unknown', expectedIsRev0: false, expectedIsFurther: false },
      { raw: undefined, expectedValid: false, expectedWeight: -1, expectedNormalized: 'Unknown', expectedIsRev0: false, expectedIsFurther: false },
      { raw: 'N/A', expectedValid: false, expectedWeight: -1, expectedNormalized: 'Unknown', expectedIsRev0: false, expectedIsFurther: false },
      { raw: 'NONE', expectedValid: false, expectedWeight: -1, expectedNormalized: 'Unknown', expectedIsRev0: false, expectedIsFurther: false },

      // Further Revision Group
      { raw: '1', expectedValid: true, expectedWeight: 1, expectedNormalized: '1', expectedIsRev0: false, expectedIsFurther: true },
      { raw: 'REV1', expectedValid: true, expectedWeight: 3001, expectedNormalized: '1', expectedIsRev0: false, expectedIsFurther: true },
      { raw: '2', expectedValid: true, expectedWeight: 2, expectedNormalized: '2', expectedIsRev0: false, expectedIsFurther: true },
      { raw: 'REV2', expectedValid: true, expectedWeight: 3002, expectedNormalized: '2', expectedIsRev0: false, expectedIsFurther: true },
      { raw: 'IFC', expectedValid: true, expectedWeight: 90000, expectedNormalized: 'IFC', expectedIsRev0: false, expectedIsFurther: true },
      { raw: 'AS-BUILT', expectedValid: true, expectedWeight: 100000, expectedNormalized: 'AS-BUILT', expectedIsRev0: false, expectedIsFurther: true },
    ];

    console.log(`\n    --- [ER-015 EXECUTION EVIDENCE MATRIX] ---`);
    console.log(`    ${'Input'.padEnd(12)} | ${'isValid'.padEnd(7)} | ${'Weight'.padEnd(7)} | ${'Normalized'.padEnd(10)} | ${'isRev0'.padEnd(7)} | ${'isFurther'.padEnd(9)} | Status`);
    console.log(`    ${'-'.repeat(12)}-+-${'-'.repeat(7)}-+-${'-'.repeat(7)}-+-${'-'.repeat(10)}-+-${'-'.repeat(7)}-+-${'-'.repeat(9)}-+-------`);

    for (const tc of testMatrix) {
      const valid = isValidRevision(tc.raw);
      const weight = getRevisionWeight(tc.raw);
      const norm = getNormalizedRevision(tc.raw);
      const isR0 = isRevision0(tc.raw);
      const isFurther = isFurtherRevision(tc.raw);

      const label = tc.raw === null ? 'null' : tc.raw === undefined ? 'undefined' : tc.raw === '' ? `"" (empty)` : tc.raw === ' ' ? `" " (space)` : String(tc.raw);
      console.log(`    ${label.padEnd(12)} | ${String(valid).padEnd(7)} | ${String(weight).padEnd(7)} | ${norm.padEnd(10)} | ${String(isR0).padEnd(7)} | ${String(isFurther).padEnd(9)} | PASS`);

      if (valid !== tc.expectedValid) {
        throw new Error(`[ER-015] isValidRevision('${tc.raw}'): expected ${tc.expectedValid}, got ${valid}`);
      }
      if (weight !== tc.expectedWeight) {
        throw new Error(`[ER-015] getRevisionWeight('${tc.raw}'): expected ${tc.expectedWeight}, got ${weight}`);
      }
      if (norm !== tc.expectedNormalized) {
        throw new Error(`[ER-015] getNormalizedRevision('${tc.raw}'): expected '${tc.expectedNormalized}', got '${norm}'`);
      }
      if (isR0 !== tc.expectedIsRev0) {
        throw new Error(`[ER-015] isRevision0('${tc.raw}'): expected ${tc.expectedIsRev0}, got ${isR0}`);
      }
      if (isFurther !== tc.expectedIsFurther) {
        throw new Error(`[ER-015] isFurtherRevision('${tc.raw}'): expected ${tc.expectedIsFurther}, got ${isFurther}`);
      }

      // Assert Invariant verification
      assertRevisionInvariants(tc.raw);
    }

    // Explicit override test: when isRev0 === true is provided for a blank/null revision
    const normOverride = getNormalizedRevision(null, true);
    console.log(`    ${'null (isRev0)'.padEnd(12)} | ${String(isValidRevision(null)).padEnd(7)} | ${String(getRevisionWeight(null)).padEnd(7)} | ${normOverride.padEnd(10)} | ${String(isRevision0(null, true)).padEnd(7)} | ${String(isFurtherRevision(null, true)).padEnd(9)} | PASS (Explicit Override)`);
    if (normOverride !== '0') throw new Error(`Expected getNormalizedRevision(null, true) === '0', got '${normOverride}'`);
    const isR0Override = isRevision0(null, true);
    if (!isR0Override) throw new Error(`Expected isRevision0(null, true) === true`);
    const isFurtherOverride = isFurtherRevision(null, true);
    if (isFurtherOverride) throw new Error(`Expected isFurtherRevision(null, true) === false`);
    assertRevisionInvariants(null, true);
  });

  // Test 16: Multi-Row Aggregation with Blank Revisions Excluded from Rev00 & Further Rev
  test('ER-016: Blank & Invalid Revisions Excluded from Rev00 and Further Rev Counts in KPI Model', () => {
    const testRows: SubmittalRow[] = [
      // Valid Rev 00
      {
        id: 'ROW-1',
        docNo: 'DWG-001',
        rev: '00',
        sheetNo: '01',
        documentType: 'SDW',
        trade: 'Civil',
        status: 'A',
        submissionDate: '2026-01-01',
        logType: 'SDW',
        isRev0: true
      } as SubmittalRow,
      // Valid Further Rev
      {
        id: 'ROW-2',
        docNo: 'DWG-002',
        rev: '01',
        sheetNo: '01',
        documentType: 'SDW',
        trade: 'Civil',
        status: 'A',
        submissionDate: '2026-01-02',
        logType: 'SDW',
        isRev0: false
      } as SubmittalRow,
      // Blank Revision row
      {
        id: 'ROW-3',
        docNo: 'DWG-003',
        rev: '',
        sheetNo: '01',
        documentType: 'SDW',
        trade: 'Civil',
        status: 'C',
        submissionDate: '2026-01-03',
        logType: 'SDW'
      } as SubmittalRow,
      // N/A Revision row
      {
        id: 'ROW-4',
        docNo: 'DWG-004',
        rev: 'N/A',
        sheetNo: '01',
        documentType: 'SDW',
        trade: 'Civil',
        status: 'PENDING',
        submissionDate: '2026-01-04',
        logType: 'SDW'
      } as SubmittalRow
    ];

    const kpi = calculateCanonicalKPIs(testRows);

    console.log(`\n    --- [ER-016 BEFORE / AFTER KPI BREAKDOWN] ---`);
    console.log(`    Total Submitted Sheets  : ${kpi.totalSubmittedSheets}`);
    console.log(`    Rev00 Baseline Sheets   : ${kpi.totalSheetsRev0} (DWG-001)`);
    console.log(`    Further Revision Sheets : ${kpi.totalSheetsFurtherRev} (DWG-002)`);
    console.log(`    Excluded Blank/Invalid  : ${kpi.totalSubmittedSheets - (kpi.totalSheetsRev0 + kpi.totalSheetsFurtherRev)} (DWG-003, DWG-004)`);

    if (kpi.totalSubmittedSheets !== 4) throw new Error(`Expected totalSubmittedSheets=4, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalSheetsRev0 !== 1) throw new Error(`Expected totalSheetsRev0=1 (only ROW-1), got ${kpi.totalSheetsRev0}`);
    if (kpi.totalSheetsFurtherRev !== 1) throw new Error(`Expected totalSheetsFurtherRev=1 (only ROW-2), got ${kpi.totalSheetsFurtherRev}`);
  });

  // Test 17: Multi-Register SUB Ref collision safety
  test('ER-017: Multi-Register SUB Ref collision safety -> DOC, WIR, MIR, SDW sharing identical SUB Ref remain completely distinct and unmerged', () => {
    const commonSubRef = 'SUB-COMMON-REF-999';

    const multiRegisterRows: SubmittalRow[] = [
      // 1. DOC Submittal (Rev 00)
      {
        id: 'DOC-FILE::Sheet1::1',
        docNo: commonSubRef,
        submittalRef: commonSubRef,
        rev: '00',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        status: 'B',
        workflowStage: 'Approved with Comments',
        submissionDate: '2026-02-01',
        logType: 'DOC',
        sourceRegisterIdentity: 'DOC Technical Register',
        sourceFile: 'DOC_Register.xlsx',
        workflowFamily: 'DOC',
        isRev0: true
      } as unknown as SubmittalRow,

      // 2. WIR Submittal (Rev 00) - Identical SUB Ref
      {
        id: 'WIR-FILE::Sheet1::1',
        docNo: commonSubRef,
        submittalRef: commonSubRef,
        rev: '00',
        sheetNo: '01',
        documentType: 'WIR',
        discipline: 'STR',
        trade: 'Structural',
        status: 'A',
        workflowStage: 'Approved',
        submissionDate: '2026-02-02',
        logType: 'WIR',
        sourceRegisterIdentity: 'WIR Work Inspection Register',
        sourceFile: 'WIR_Register.xlsx',
        workflowFamily: 'WIR',
        isRev0: true
      } as unknown as SubmittalRow,

      // 3. MIR Submittal (Rev 00) - Identical SUB Ref
      {
        id: 'MIR-FILE::Sheet1::1',
        docNo: commonSubRef,
        submittalRef: commonSubRef,
        rev: '00',
        sheetNo: '01',
        documentType: 'MIR',
        discipline: 'MECH',
        trade: 'Mechanical',
        status: 'C',
        recordStatus: 'open',
        workflowStage: 'Rejected',
        submissionDate: '2026-02-03',
        logType: 'MIR',
        sourceRegisterIdentity: 'MIR Material Inspection Register',
        sourceFile: 'MIR_Register.xlsx',
        workflowFamily: 'MIR',
        isRev0: true
      } as unknown as SubmittalRow,

      // 4. SDW Submittal (Rev 00) - Identical SUB Ref with DWG
      {
        id: 'SDW-FILE::Sheet1::1',
        docNo: commonSubRef,
        submittalRef: commonSubRef,
        drawingNumber: 'DWG-STR-1001',
        rev: '00',
        sheetNo: '01',
        documentType: 'SDW',
        discipline: 'STR',
        trade: 'Structural',
        status: 'A',
        workflowStage: 'Approved',
        submissionDate: '2026-02-04',
        logType: 'SDW',
        sourceRegisterIdentity: 'Shop Drawings Technical Register',
        sourceFile: 'SDW_Register.xlsx',
        workflowFamily: 'SDW',
        isRev0: true
      } as unknown as SubmittalRow,

      // 5. DOC Revision (Rev 01) - Must ONLY attach to DOC and NOT WIR/MIR/SDW
      {
        id: 'DOC-FILE::Sheet1::2',
        docNo: commonSubRef,
        submittalRef: commonSubRef,
        rev: '01',
        sheetNo: '01',
        documentType: 'DOC',
        discipline: 'STR',
        trade: 'Structural',
        status: 'A',
        workflowStage: 'Approved',
        submissionDate: '2026-02-10',
        logType: 'DOC',
        sourceRegisterIdentity: 'DOC Technical Register',
        sourceFile: 'DOC_Register.xlsx',
        workflowFamily: 'DOC',
        isRev0: false
      } as unknown as SubmittalRow
    ];

    // Normalize through calculation pipeline
    const normalized = normalizeData(multiRegisterRows);

    // Assert that we preserve all distinct document entities
    const identityKeys = new Set(normalized.map(r => r.documentIdentityKey));
    if (identityKeys.size !== 4) {
      throw new Error(`Expected 4 distinct documentIdentityKeys across 4 registers, got ${identityKeys.size}. Keys: ${Array.from(identityKeys).join(', ')}`);
    }

    // Filter each register family from normalized data
    const docRows = normalized.filter(r => r.sourceRegisterIdentity === 'DOC Technical Register');
    const wirRows = normalized.filter(r => r.sourceRegisterIdentity === 'WIR Work Inspection Register');
    const mirRows = normalized.filter(r => r.sourceRegisterIdentity === 'MIR Material Inspection Register');
    const sdwRows = normalized.filter(r => r.sourceRegisterIdentity === 'Shop Drawings Technical Register');

    if (docRows.length !== 2) throw new Error(`Expected 2 DOC rows (Rev00 + Rev01), got ${docRows.length}`);
    if (wirRows.length !== 1) throw new Error(`Expected 1 WIR row, got ${wirRows.length}`);
    if (mirRows.length !== 1) throw new Error(`Expected 1 MIR row, got ${mirRows.length}`);
    if (sdwRows.length !== 1) throw new Error(`Expected 1 SDW row, got ${sdwRows.length}`);

    // Verify DOC revision progression: Rev01 is latest, Rev00 is not latest
    const docRev0 = docRows.find(r => r.rev === '00');
    const docRev1 = docRows.find(r => r.rev === '01');
    if (!docRev1?.isLatestRev) throw new Error(`DOC Rev 01 must be latest revision`);
    if (docRev0?.isLatestRev) throw new Error(`DOC Rev 00 must NOT be latest revision`);

    // Verify other registers were NOT touched by DOC Rev 01
    if (!wirRows[0].isLatestRev) throw new Error(`WIR Rev 00 must remain latest revision in its own register`);
    if (!mirRows[0].isLatestRev) throw new Error(`MIR Rev 00 must remain latest revision in its own register`);
    if (!sdwRows[0].isLatestRev) throw new Error(`SDW Rev 00 must remain latest revision in its own register`);

    // Verify KPIs calculated per register remain isolated
    const docKpi = calculateCanonicalKPIs(docRows);
    const wirKpi = calculateCanonicalKPIs(wirRows);
    const mirKpi = calculateCanonicalKPIs(mirRows);
    const sdwKpi = calculateCanonicalKPIs(sdwRows);

    if (docKpi.totalUniqueDrawings !== 1 || docKpi.approved !== 1) {
      throw new Error(`DOC KPI mismatch: expected unique=1, approved=1, got unique=${docKpi.totalUniqueDrawings}, approved=${docKpi.approved}`);
    }
    if (wirKpi.totalUniqueDrawings !== 1 || wirKpi.approved !== 1) {
      throw new Error(`WIR KPI mismatch: expected unique=1, approved=1, got unique=${wirKpi.totalUniqueDrawings}, approved=${wirKpi.approved}`);
    }
    if (mirKpi.totalUniqueDrawings !== 1 || mirKpi.rejectedOpen !== 1) {
      throw new Error(`MIR KPI mismatch: expected unique=1, rejectedOpen=1, got unique=${mirKpi.totalUniqueDrawings}, rejectedOpen=${mirKpi.rejectedOpen}`);
    }
    if (sdwKpi.totalUniqueDrawings !== 1 || sdwKpi.approved !== 1) {
      throw new Error(`SDW KPI mismatch: expected unique=1, approved=1, got unique=${sdwKpi.totalUniqueDrawings}, approved=${sdwKpi.approved}`);
    }
  });

  // Test 18: Three-Grain Identity: Raw Row vs Submission Grain vs Document Grain
  test('ER-018: 3-Grain Separation -> Raw Rows=3, Unique Submittals=2, Rev00 Submittals=2, Unique Drawings=3', () => {
    const sdwTestRows: SubmittalRow[] = [
      {
        id: 'ROW-1',
        registerIdentity: 'SDW',
        discipline: 'Structural',
        disciplineCode: 'STR',
        submissionRef: 'SUB-001',
        drawingNo: 'DWG-001',
        rev: '00',
        status: 'APPROVED',
        documentType: 'SDW'
      } as SubmittalRow,
      {
        id: 'ROW-2',
        registerIdentity: 'SDW',
        discipline: 'Structural',
        disciplineCode: 'STR',
        submissionRef: 'SUB-001',
        drawingNo: 'DWG-002',
        rev: '00',
        status: 'APPROVED',
        documentType: 'SDW'
      } as SubmittalRow,
      {
        id: 'ROW-3',
        registerIdentity: 'SDW',
        discipline: 'Structural',
        disciplineCode: 'STR',
        submissionRef: 'SUB-002',
        drawingNo: 'DWG-003',
        rev: '00',
        status: 'PENDING',
        documentType: 'SDW'
      } as SubmittalRow
    ];

    const kpi = calculateCanonicalKPIs(sdwTestRows);

    if (kpi.totalSubmittedSheets !== 3) {
      throw new Error(`Expected Raw Rows (totalSubmittedSheets)=3, got ${kpi.totalSubmittedSheets}`);
    }
    if (kpi.totalUniqueSubmittals !== 2) {
      throw new Error(`Expected Unique Submittals=2, got ${kpi.totalUniqueSubmittals}`);
    }
    if (kpi.totalSubmittalsRev0 !== 2) {
      throw new Error(`Expected Rev.00 Submittals=2, got ${kpi.totalSubmittalsRev0}`);
    }
    if (kpi.totalUniqueDrawings !== 3) {
      throw new Error(`Expected Unique Drawings=3, got ${kpi.totalUniqueDrawings}`);
    }
  });

  // Test 19: Submission Identity Key Isolation & Multi-drawing Submittal
  test('ER-019: Same SUB Ref with 2 Drawings -> Unique Submittals=1, Unique Drawings=2 + Cross-Register Isolation', () => {
    const multiDwgRows: SubmittalRow[] = [
      {
        id: 'ROW-A',
        registerIdentity: 'SDW',
        discipline: 'Structural',
        disciplineCode: 'STR',
        submissionRef: 'SUB-001',
        drawingNo: 'DWG-001',
        rev: '00',
        status: 'APPROVED',
        documentType: 'SDW'
      } as SubmittalRow,
      {
        id: 'ROW-B',
        registerIdentity: 'SDW',
        discipline: 'Structural',
        disciplineCode: 'STR',
        submissionRef: 'SUB-001',
        drawingNo: 'DWG-002',
        rev: '00',
        status: 'APPROVED',
        documentType: 'SDW'
      } as SubmittalRow
    ];

    const kpi = calculateCanonicalKPIs(multiDwgRows);
    if (kpi.totalSubmittedSheets !== 2) throw new Error(`Expected Raw Rows=2, got ${kpi.totalSubmittedSheets}`);
    if (kpi.totalUniqueSubmittals !== 1) throw new Error(`Expected Unique Submittals=1, got ${kpi.totalUniqueSubmittals}`);
    if (kpi.totalSubmittalsRev0 !== 1) throw new Error(`Expected Rev00 Submittals=1, got ${kpi.totalSubmittalsRev0}`);
    if (kpi.totalUniqueDrawings !== 2) throw new Error(`Expected Unique Drawings=2, got ${kpi.totalUniqueDrawings}`);

    // Verify submission identity keys across different registers remain distinct
    const keyDoc = getSubmissionIdentityKey({ registerIdentity: 'DOC', discipline: 'Structural', disciplineCode: 'STR', submissionRef: 'SUB-001' } as any);
    const keyMar = getSubmissionIdentityKey({ registerIdentity: 'MAR', discipline: 'Structural', disciplineCode: 'STR', submissionRef: 'SUB-001' } as any);
    const keyWir = getSubmissionIdentityKey({ registerIdentity: 'WIR', discipline: 'Structural', disciplineCode: 'STR', submissionRef: 'SUB-001' } as any);
    const keySdw = getSubmissionIdentityKey({ registerIdentity: 'SDW', discipline: 'Structural', disciplineCode: 'STR', submissionRef: 'SUB-001' } as any);

    if (keyDoc !== 'DOC|STR|SUB-001') throw new Error(`Expected DOC|STR|SUB-001, got ${keyDoc}`);
    if (keyMar !== 'MAR|STR|SUB-001') throw new Error(`Expected MAR|STR|SUB-001, got ${keyMar}`);
    if (keyWir !== 'WIR|STR|SUB-001') throw new Error(`Expected WIR|STR|SUB-001, got ${keyWir}`);
    if (keySdw !== 'SDW|STR|SUB-001') throw new Error(`Expected SDW|STR|SUB-001, got ${keySdw}`);

    const uniqueKeys = new Set([keyDoc, keyMar, keyWir, keySdw]);
    if (uniqueKeys.size !== 4) throw new Error(`Expected 4 distinct register submission keys, got ${uniqueKeys.size}`);
  });

  // Test 20: ALL REGISTERS Official Management Report Population (WIR-SURVEY = 73 + WIR-LANDSCAPE = 87 -> TOTAL = 160)
  test('ER-020: ALL REGISTERS Official Management Report includes WIR-SURVEY (73) + WIR-LANDSCAPE (87) = 160 Total Submittals / 161 Total Sheets', () => {
    const wirRows: SubmittalRow[] = [];

    // 1. WIR-SURVEY: 73 unique submittals (68 Rev.00 + 5 Further Rev. = 73 Total Sheets), all 73 Approved
    for (let i = 1; i <= 68; i++) {
      wirRows.push({
        id: `WIR-SUR-${i}`,
        registerIdentity: 'WIR',
        discipline: 'SURVEY',
        disciplineCode: 'SUR',
        submissionRef: `WIR-SUR-SUB-${i}`,
        docNo: `WIR-SUR-DOC-${i}`,
        rev: '00',
        status: 'APPROVED',
        documentType: 'WIR-SURVEY'
      } as SubmittalRow);
    }
    for (let i = 69; i <= 73; i++) {
      wirRows.push({
        id: `WIR-SUR-${i}`,
        registerIdentity: 'WIR',
        discipline: 'SURVEY',
        disciplineCode: 'SUR',
        submissionRef: `WIR-SUR-SUB-${i}`,
        docNo: `WIR-SUR-DOC-${i}`,
        rev: '01',
        status: 'APPROVED',
        documentType: 'WIR-SURVEY'
      } as SubmittalRow);
    }

    // 2. WIR-LANDSCAPE: 87 unique submittals (80 Rev.00 + 8 Further Rev. = 88 Total Sheets), 75 Approved, 8 Rejected, 4 Pending
    // Submittal 1 has Rev.00 (Rejected) + Rev.01 (Approved) -> 2 sheets (1 Rev.00, 1 Further Rev.), 1 Unique Approved
    wirRows.push({
      id: 'WIR-LND-1-R0',
      registerIdentity: 'WIR',
      discipline: 'Landscape',
      disciplineCode: 'LND',
      submissionRef: 'WIR-LND-SUB-1',
      docNo: 'WIR-LND-DOC-1',
      rev: '00',
      status: 'REJECTED_OPEN',
      documentType: 'WIR-LANDSCAPE'
    } as SubmittalRow);
    wirRows.push({
      id: 'WIR-LND-1-R1',
      registerIdentity: 'WIR',
      discipline: 'Landscape',
      disciplineCode: 'LND',
      submissionRef: 'WIR-LND-SUB-1',
      docNo: 'WIR-LND-DOC-1',
      rev: '01',
      status: 'APPROVED',
      documentType: 'WIR-LANDSCAPE'
    } as SubmittalRow);

    // Remaining 86 unique submittals (submittals 2..87): 79 at Rev.00, 7 at Rev.01 -> total 80 Rev.00, 8 Further Rev., 88 Total Sheets
    // Statuses across submittals 2..87: 74 Approved (making 75 total Approved), 8 Rejected, 4 Pending
    for (let i = 2; i <= 87; i++) {
      const isFurther = i > 80; // 81..87 = 7 items at Rev.01
      const status =
        i <= 75
          ? 'APPROVED'
          : i <= 83
          ? 'REJECTED_OPEN'
          : 'PENDING';
      wirRows.push({
        id: `WIR-LND-${i}`,
        registerIdentity: 'WIR',
        discipline: 'Landscape',
        disciplineCode: 'LND',
        submissionRef: `WIR-LND-SUB-${i}`,
        docNo: `WIR-LND-DOC-${i}`,
        rev: isFurther ? '01' : '00',
        status,
        documentType: 'WIR-LANDSCAPE'
      } as SubmittalRow);
    }

    // Verify Register Scope (ALL REGISTERS default)
    const regReport = buildManagementReportOutput(wirRows, wirRows, 'ALL', 'register');
    if (!regReport.isFullyReconciled) {
      throw new Error('Expected ALL REGISTERS report to be fully reconciled');
    }
    if (regReport.otherDisciplineRowsCount !== 0) {
      throw new Error(`Expected 0 excluded otherDisciplineRowsCount, got ${regReport.otherDisciplineRowsCount}`);
    }
    if (regReport.rows.length !== 2) {
      throw new Error(`Expected 2 official registers (WIR-SURVEY, WIR-LANDSCAPE), got ${regReport.rows.map(r => r.discipline).join(', ')}`);
    }

    const survRow = regReport.rows.find(r => r.discipline === 'WIR-SURVEY');
    const landRow = regReport.rows.find(r => r.discipline === 'WIR-LANDSCAPE');
    if (!survRow) throw new Error('WIR-SURVEY was dropped from ALL REGISTERS report');
    if (!landRow) throw new Error('WIR-LANDSCAPE missing from ALL REGISTERS report');

    if (
      survRow.totalSubmittals !== 73 ||
      survRow.rev00 !== 68 ||
      survRow.furtherRev !== 5 ||
      survRow.totalSheets !== 73 ||
      survRow.approved !== 73 ||
      survRow.rejected !== 0 ||
      survRow.pending !== 0
    ) {
      throw new Error(`WIR-SURVEY mismatch: ${JSON.stringify(survRow)}`);
    }

    if (
      landRow.totalSubmittals !== 87 ||
      landRow.rev00 !== 80 ||
      landRow.furtherRev !== 8 ||
      landRow.totalSheets !== 88 ||
      landRow.approved !== 75 ||
      landRow.rejected !== 8 ||
      landRow.pending !== 4
    ) {
      throw new Error(`WIR-LANDSCAPE mismatch: ${JSON.stringify(landRow)}`);
    }

    const gt = regReport.grandTotal;
    if (
      gt.totalSubmittals !== 160 ||
      gt.rev00 !== 148 ||
      gt.furtherRev !== 13 ||
      gt.totalSheets !== 161 ||
      gt.approved !== 148 ||
      gt.rejected !== 8 ||
      gt.pending !== 4
    ) {
      throw new Error(`GRAND TOTAL mismatch: ${JSON.stringify(gt)}`);
    }

    // Also verify Discipline Breakdown Layer preserves the exact same 160 population without dropping SURVEY
    const discReport = buildManagementReportOutput(wirRows, wirRows, 'ALL', 'discipline');
    if (
      discReport.grandTotal.totalSubmittals !== 160 ||
      discReport.grandTotal.totalSheets !== 161 ||
      discReport.grandTotal.approved !== 148 ||
      discReport.grandTotal.rejected !== 8 ||
      discReport.grandTotal.pending !== 4
    ) {
      throw new Error(`Discipline Breakdown Layer dropped rows: ${JSON.stringify(discReport.grandTotal)}`);
    }
  });

  test('ER-024: Final Source-Based Acceptance Audit (All 9 Acceptance Criteria, Executive Summary Parity, Monthly/Cumulative Parity, and PDF/PPTX/Excel Export Parity)', () => {
    const wirRows: SubmittalRow[] = [];

    for (let i = 1; i <= 68; i++) {
      wirRows.push({
        id: `WIR-SUR-${i}`,
        registerIdentity: 'WIR',
        discipline: 'SURVEY',
        disciplineCode: 'SUR',
        submissionRef: `WIR-SUR-SUB-${i}`,
        docNo: `WIR-SUR-DOC-${i}`,
        rev: '00',
        status: 'APPROVED',
        submissionDate: i <= 30 ? '2026-08-10' : '2026-09-12',
        documentType: 'WIR-SURVEY'
      } as SubmittalRow);
    }
    for (let i = 69; i <= 73; i++) {
      wirRows.push({
        id: `WIR-SUR-${i}`,
        registerIdentity: 'WIR',
        discipline: 'SURVEY',
        disciplineCode: 'SUR',
        submissionRef: `WIR-SUR-SUB-${i}`,
        docNo: `WIR-SUR-DOC-${i}`,
        rev: '01',
        status: 'APPROVED',
        submissionDate: '2026-09-18',
        documentType: 'WIR-SURVEY'
      } as SubmittalRow);
    }

    wirRows.push({
      id: 'WIR-LND-1-R0',
      registerIdentity: 'WIR',
      discipline: 'Landscape',
      disciplineCode: 'LND',
      submissionRef: 'WIR-LND-SUB-1',
      docNo: 'WIR-LND-DOC-1',
      rev: '00',
      status: 'REJECTED_OPEN',
      submissionDate: '2026-08-12',
      documentType: 'WIR-LANDSCAPE'
    } as SubmittalRow);
    wirRows.push({
      id: 'WIR-LND-1-R1',
      registerIdentity: 'WIR',
      discipline: 'Landscape',
      disciplineCode: 'LND',
      submissionRef: 'WIR-LND-SUB-1',
      docNo: 'WIR-LND-DOC-1',
      rev: '01',
      status: 'APPROVED',
      submissionDate: '2026-09-21',
      documentType: 'WIR-LANDSCAPE'
    } as SubmittalRow);

    for (let i = 2; i <= 87; i++) {
      const isFurther = i > 80;
      const status =
        i <= 75
          ? 'APPROVED'
          : i <= 83
          ? 'REJECTED_OPEN'
          : 'PENDING';
      wirRows.push({
        id: `WIR-LND-${i}`,
        registerIdentity: 'WIR',
        discipline: 'Landscape',
        disciplineCode: 'LND',
        submissionRef: `WIR-LND-SUB-${i}`,
        docNo: `WIR-LND-DOC-${i}`,
        rev: isFurther ? '01' : '00',
        status,
        submissionDate: i <= 40 ? '2026-08-12' : '2026-09-14',
        documentType: 'WIR-LANDSCAPE'
      } as SubmittalRow);
    }

    const filterMonthly = (r: SubmittalRow) => (r.submissionDate || '').startsWith('2026-09');
    const filterCumulative = (_r: SubmittalRow) => true;

    const audit = auditOfficialSourcePopulation(wirRows, wirRows, filterMonthly, filterCumulative);
    if (!audit.acceptanceChecks.allChecksPassed) {
      throw new Error(`Expected all 9 acceptance checks to pass: ${JSON.stringify(audit.acceptanceChecks)}`);
    }
    if (audit.unaccountedRowsCount !== 0 || audit.otherDisciplineExcludedCount !== 0) {
      throw new Error(`Expected 0 unaccounted/excluded rows, got unaccounted=${audit.unaccountedRowsCount}, otherExcluded=${audit.otherDisciplineExcludedCount}`);
    }

    // Check Executive Dashboard / PDF / PPTX data builder uses the exact same canonical registers
    const execDash = calculateExecutiveDashboardData(wirRows, wirRows, false, 'en');
    const execRegKeys = execDash.byDocType.map(d => d.documentType);
    if (!execRegKeys.includes('WIR-SURVEY') || !execRegKeys.includes('WIR-LANDSCAPE') || execRegKeys.length !== 2) {
      throw new Error(`Executive Dashboard / PDF / PPTX register mismatch: ${execRegKeys.join(', ')}`);
    }

    // Check PPTX / PDF per-register table compiler (compileStatsForBaseType) preserves both SURVEY and LANDSCAPE
    const wirCompiled = compileStatsForBaseType(wirRows, 'WIR', undefined, wirRows);
    const activeWirRows = wirCompiled.stats.filter((s: any) => (s.TotalSheets || 0) > 0);
    const totalCompiledSubmittals = activeWirRows.reduce((acc: number, s: any) => acc + (s.TotalSubmittals || 0), 0);
    const totalCompiledSheets = activeWirRows.reduce((acc: number, s: any) => acc + (s.TotalSheets || 0), 0);
    if (totalCompiledSubmittals !== 160 || totalCompiledSheets !== 161) {
      throw new Error(`compileStatsForBaseType dropped rows: submittals=${totalCompiledSubmittals}, sheets=${totalCompiledSheets}`);
    }

    // Check Excel (.xlsx) Official Export workbook preserves the exact same register population and figures
    const xlsxExport = exportOfficialManagementReportXlsx(wirRows, wirRows, { skipDownload: true });
    if (
      xlsxExport.registerReport.grandTotal.totalSubmittals !== 160 ||
      xlsxExport.registerReport.grandTotal.totalSheets !== 161 ||
      xlsxExport.workbook.SheetNames.length !== 4
    ) {
      throw new Error('Excel export failed to preserve 160/161 population and 4 sheets');
    }
  });

  test('ER-025: Source Population Audit confirms resolveOfficialSubmittalRegister never hides any official register or discipline', () => {
    const diverseSourceRows: SubmittalRow[] = [
      // Row where registerIdentity is UNCLASSIFIED, resolved from sourceSheetName / docNo
      {
        id: 'R-1',
        docNo: 'STS-WIR-SUR-0001',
        submissionRef: 'STS-WIR-SUR-0001',
        rev: '00',
        sheetNo: '1',
        documentType: 'GENERAL',
        registerIdentity: 'UNCLASSIFIED',
        sourceRegisterIdentity: 'UNCLASSIFIED',
        sourceSheetName: 'WIR-SURVEY',
        discipline: 'SURVEY',
        status: 'A',
        code: 'A',
        submissionDate: '2026-09-01',
        responseDate: '2026-09-05',
        delayDays: 2,
        isLatestRev: true,
        workflowStage: 'Approved'
      },
      // Row with non-standard discipline (GEOTECH) in MIR
      {
        id: 'R-2',
        docNo: 'STS-MIR-GEO-0001',
        submissionRef: 'STS-MIR-GEO-0001',
        rev: '00',
        sheetNo: '1',
        documentType: 'MIR',
        registerIdentity: 'MIR',
        discipline: 'GEOTECH',
        trade: 'GEOTECH',
        sourceSheetName: 'MIR-GEOTECH',
        status: 'B',
        code: 'B',
        submissionDate: '2026-09-02',
        responseDate: '2026-09-06',
        delayDays: 2,
        isLatestRev: true,
        workflowStage: 'Approved'
      },
      // Row with SHD alias normalized to SDW
      {
        id: 'R-3',
        docNo: 'STS-SDW-ARC-0001',
        submissionRef: 'STS-SDW-ARC-0001',
        rev: '00',
        sheetNo: '1',
        documentType: 'SHD-ARC',
        registerIdentity: 'SHD',
        discipline: 'ARCH',
        sourceSheetName: 'SHD-ARCH',
        status: 'UR',
        code: 'UR',
        submissionDate: '2026-09-03',
        responseDate: '',
        delayDays: 2,
        isLatestRev: true,
        workflowStage: 'Pending'
      }
    ];

    const reg1 = resolveOfficialSubmittalRegister(diverseSourceRows[0]);
    const reg2 = resolveOfficialSubmittalRegister(diverseSourceRows[1]);
    const reg3 = resolveOfficialSubmittalRegister(diverseSourceRows[2]);

    if (reg1 !== 'WIR-SURVEY') throw new Error(`Expected WIR-SURVEY, got ${reg1}`);
    if (reg2 !== 'MIR-GEOTECH') throw new Error(`Expected MIR-GEOTECH, got ${reg2}`);
    if (reg3 !== 'SDW-ARCH') throw new Error(`Expected SDW-ARCH, got ${reg3}`);

    const audit = auditOfficialSourcePopulation(diverseSourceRows, diverseSourceRows);
    if (!audit.acceptanceChecks.allChecksPassed || audit.canonicalRegisters.length !== 3 || audit.unaccountedRowsCount !== 0) {
      throw new Error(`Audit failed on diverse registers: ${JSON.stringify(audit)}`);
    }
  });

  // =========================================================================
  // NCR FORENSIC AUDIT REGRESSION SUITE (ER-026 to ER-032)
  // Covers Findings NCR-001 through NCR-013
  // =========================================================================

  test('ER-026 (NCR-001): Single-Count Monthly Critical Overdue — Never double-counted between Event 2 and Month-End Snapshot', () => {
    const rows: SubmittalRow[] = [
      {
        id: 'NCR-OVD-1',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-001',
        docNo: 'NCR-001',
        rev: '00',
        discipline: 'STR',
        submissionDate: '2026-06-01', // Issued June 1
        ncrSentDateCorrectiveAction: '2026-06-20', // Sent June 20 (19 days > 14 days)
        responseDate: '', // Still open at June 30 (29 days > 14 days)
        ncrStatus: 'Open',
        ncrAction: 'Under Review'
      } as SubmittalRow
    ];

    const res = processNCRData(rows, '2026-06-01');
    if (res.monthlyKPIs.criticalDelays !== 1) {
      throw new Error(`Expected Critical Overdue = 1 (single-counted), got ${res.monthlyKPIs.criticalDelays}`);
    }
    if (res.monthly[0]?.overdue !== 1) {
      throw new Error(`Expected discipline overdue = 1, got ${res.monthly[0]?.overdue}`);
    }
    if (!res.integrityReport.passed || !res.integrityReport.forensicChecks?.overdueSingleCountPassed) {
      throw new Error('Expected overdueSingleCountPassed forensic check to pass');
    }
  });

  test('ER-027 (NCR-002, NCR-003, NCR-004, NCR-005): Event Deduplication — Inherited dates across Rev00/Rev01/Rev02 never inflate New NCR, Corrective Submitted, or Consultant Responses', () => {
    const rows: SubmittalRow[] = [
      {
        id: 'NCR-INH-R0',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-100',
        docNo: 'NCR-100',
        rev: '00',
        discipline: 'Arch',
        submissionDate: '2026-06-03',
        ncrSentDateCorrectiveAction: '2026-06-10',
        responseDate: '2026-06-15',
        ncrAction: 'Rejected',
        ncrStatus: 'Open'
      } as SubmittalRow,
      // Rev01 inherits submissionDate=2026-06-03, sentDate=2026-06-10, responseDate=2026-06-15!
      {
        id: 'NCR-INH-R1-DUP',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-100',
        docNo: 'NCR-100',
        rev: '01',
        discipline: 'Arch',
        submissionDate: '2026-06-03',
        ncrSentDateCorrectiveAction: '2026-06-10',
        responseDate: '2026-06-15',
        ncrAction: 'Rejected',
        ncrStatus: 'Open'
      } as SubmittalRow,
      // Rev02 inherits submissionDate=2026-06-03, has genuine new sentDate=2026-06-22 and genuine new responseDate=2026-06-28 (Approved)
      {
        id: 'NCR-INH-R2',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-100',
        docNo: 'NCR-100',
        rev: '02',
        discipline: 'Arch',
        submissionDate: '2026-06-03',
        ncrSentDateCorrectiveAction: '2026-06-22',
        responseDate: '2026-06-28',
        ncrAction: 'Approved',
        ncrStatus: 'Closed'
      } as SubmittalRow
    ];

    const res = processNCRData(rows, '2026-06-01');
    // 1 unique NCR issued in June (NOT 3!)
    if (res.monthlyKPIs.newNcrReceived !== 1) {
      throw new Error(`Expected newNcrReceived = 1, got ${res.monthlyKPIs.newNcrReceived}`);
    }
    // 2 genuine corrective submissions (June 10 on Rev00 + June 22 on Rev02; Rev01 inherited June 10 is deduplicated)
    if (res.monthlyKPIs.correctiveSubmitted !== 2) {
      throw new Error(`Expected correctiveSubmitted = 2, got ${res.monthlyKPIs.correctiveSubmitted}`);
    }
    // 2 genuine consultant responses (June 15 Rejected + June 28 Approved; Rev01 inherited June 15 is deduplicated)
    if (res.monthlyKPIs.responsesReceived !== 2 || res.monthlyKPIs.rejected !== 1 || res.monthlyKPIs.approved !== 1) {
      throw new Error(
        `Expected responsesReceived=2 (1 Approved, 1 Rejected), got total=${res.monthlyKPIs.responsesReceived}, app=${res.monthlyKPIs.approved}, rej=${res.monthlyKPIs.rejected}`
      );
    }
    // Detail table grain parity: monthlySubmissions.length === correctiveSubmitted
    if (res.monthlySubmissions.length !== res.monthlyKPIs.correctiveSubmitted) {
      throw new Error(`Detail table grain mismatch: rows=${res.monthlySubmissions.length}, KPI=${res.monthlyKPIs.correctiveSubmitted}`);
    }
    if (!res.integrityReport.passed) {
      throw new Error(`Expected integrityReport.passed = true, got ${JSON.stringify(res.integrityReport)}`);
    }
  });

  test('ER-028 (NCR-006 & NCR-007): Temporal Month-End Snapshot & getLatestRev(upToDate) — Future revisions with inherited submissionDate never leak into prior month snapshot', () => {
    const rows: SubmittalRow[] = [
      {
        id: 'NCR-TMP-R0',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-200',
        docNo: 'NCR-200',
        rev: '00',
        discipline: 'STR',
        submissionDate: '2026-06-03',
        ncrSentDateCorrectiveAction: '2026-06-20',
        responseDate: '', // Still Waiting Consultant as of June 30!
        ncrAction: '',
        ncrStatus: 'Open'
      } as SubmittalRow,
      {
        id: 'NCR-TMP-R1',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-200',
        docNo: 'NCR-200',
        rev: '01',
        discipline: 'STR',
        submissionDate: '2026-06-03', // Inherited June 03 issue date!
        ncrSentDateCorrectiveAction: '2026-07-10', // Actual Rev01 activity in July!
        responseDate: '2026-07-18', // Closed in July!
        ncrAction: 'Approved',
        ncrStatus: 'Closed'
      } as SubmittalRow
    ];

    // 1. Check June 2026 report: As of June 30, only Rev00 existed -> Waiting Consultant = 1, Waiting Contractor = 0
    const juneRes = processNCRData(rows, '2026-06-01');
    if (juneRes.monthlyKPIs.waitingConsultant !== 1 || juneRes.monthlyKPIs.waitingContractor !== 0) {
      throw new Error(
        `June 30 Snapshot corrupted by July Rev01! Expected waitingConsultant=1, waitingContractor=0, got consultant=${juneRes.monthlyKPIs.waitingConsultant}, contractor=${juneRes.monthlyKPIs.waitingContractor}`
      );
    }

    // 2. Check getLatestRev(rows, new Date(2026, 5, 15)) -> must return Rev 00, NOT Rev 01
    const latestInJune = getLatestRev(rows, new Date(2026, 5, 15));
    if (!latestInJune || latestInJune.rev !== '00') {
      throw new Error(`Expected getLatestRev for June 2026 to return Rev 00, got ${latestInJune?.rev}`);
    }

    // 3. Check July 2026 report: Closed in July -> waitingConsultant = 0, waitingContractor = 0, approved = 1
    const julyRes = processNCRData(rows, '2026-07-01');
    if (julyRes.monthlyKPIs.waitingConsultant !== 0 || julyRes.monthlyKPIs.waitingContractor !== 0 || julyRes.monthlyKPIs.approved !== 1) {
      throw new Error(
        `July 31 Snapshot mismatch: got consultant=${julyRes.monthlyKPIs.waitingConsultant}, contractor=${julyRes.monthlyKPIs.waitingContractor}, approved=${julyRes.monthlyKPIs.approved}`
      );
    }
  });

  test('ER-029 (NCR-010): Discipline Normalization Isolation — SURVEY/SURV/SUR is preserved as SURVEY and never mapped to HSE', () => {
    const surv1 = normalizeDiscipline({ discipline: 'SURVEY' } as SubmittalRow);
    const surv2 = normalizeDiscipline({ discipline: 'SURV' } as SubmittalRow);
    const surv3 = normalizeDiscipline({ discipline: 'SUR' } as SubmittalRow);
    const strSur = normalizeDiscipline({ discipline: 'STR/SUR' } as SubmittalRow);
    const hse = normalizeDiscipline({ discipline: 'HSE' } as SubmittalRow);

    if (surv1 !== 'SURVEY' || surv2 !== 'SURVEY' || surv3 !== 'SURVEY') {
      throw new Error(`SURVEY discipline corrupted: surv1=${surv1}, surv2=${surv2}, surv3=${surv3}`);
    }
    if (strSur !== 'STR/SUR') {
      throw new Error(`Expected STR/SUR, got ${strSur}`);
    }
    if (hse !== 'HSE') {
      throw new Error(`Expected HSE, got ${hse}`);
    }
  });

  test('ER-030 (NCR-008, NCR-009, NCR-011): Single NCR SSOT Equivalence between processNCRData and calculateNCRStats & Canonical NCR Filter', () => {
    const mixedRows: SubmittalRow[] = [
      // Stage 1: Waiting Contractor (notSent)
      {
        id: 'NCR-S1',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-301',
        docNo: 'NCR-301',
        rev: '00',
        discipline: 'STR',
        submissionDate: '2026-06-05',
        ncrSentDateCorrectiveAction: '',
        responseDate: '',
        ncrStatus: 'Open'
      } as SubmittalRow,
      // Stage 2: Waiting Consultant (underReview)
      {
        id: 'NCR-S2',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-302',
        docNo: 'NCR-302',
        rev: '00',
        discipline: 'Arch',
        submissionDate: '2026-06-06',
        ncrSentDateCorrectiveAction: '2026-06-12',
        responseDate: '',
        ncrStatus: 'Under Review'
      } as SubmittalRow,
      // Stage 3: Rejected Open
      {
        id: 'NCR-S3-REJ',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-303',
        docNo: 'NCR-303',
        rev: '00',
        discipline: 'Mech',
        submissionDate: '2026-06-07',
        ncrSentDateCorrectiveAction: '2026-06-14',
        responseDate: '2026-06-19',
        ncrAction: 'Rejected',
        ncrStatus: 'Open'
      } as SubmittalRow,
      // Stage 3: Approved Closed
      {
        id: 'NCR-S3-APP',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-304',
        docNo: 'NCR-304',
        rev: '01',
        discipline: 'SURVEY',
        submissionDate: '2026-06-08',
        ncrSentDateCorrectiveAction: '2026-06-15',
        responseDate: '2026-06-21',
        ncrAction: 'Approved',
        ncrStatus: 'Closed'
      } as SubmittalRow,
      // Non-NCR row from SDW that happens to mention NCR in remarks — MUST be rejected by normalizeNCRData
      {
        id: 'SDW-NON-NCR',
        registerIdentity: 'SDW',
        documentType: 'SDW-STR',
        docNo: 'SDW-STR-001',
        rev: '00',
        discipline: 'STR',
        remarks: 'Related to NCR-301',
        submissionDate: '2026-06-10',
        status: 'Approved'
      } as SubmittalRow
    ];

    const filteredNcr = normalizeNCRData(mixedRows);
    if (filteredNcr.length !== 4) {
      throw new Error(`Expected normalizeNCRData to keep 4 NCR rows and exclude SDW row, got ${filteredNcr.length}`);
    }

    const engineOut = processNCRData(mixedRows, '2026-06-01');
    const foundationStats = calculateNCRStats(filteredNcr);

    if (
      engineOut.cumulativeKPIs.totalUnique !== 4 ||
      foundationStats.totalUnique !== engineOut.cumulativeKPIs.totalUnique ||
      foundationStats.notSent !== engineOut.cumulativeKPIs.notSent ||
      foundationStats.underReview !== engineOut.cumulativeKPIs.underReview ||
      foundationStats.rejectedOpen !== engineOut.cumulativeKPIs.rejectedOpen ||
      foundationStats.approvedClosed !== engineOut.cumulativeKPIs.approvedClosed ||
      foundationStats.open !== engineOut.cumulativeKPIs.open ||
      foundationStats.closed !== engineOut.cumulativeKPIs.closed
    ) {
      throw new Error(
        `SSOT Drift between processNCRData and calculateNCRStats: engine=${JSON.stringify(engineOut.cumulativeKPIs)}, foundation=${JSON.stringify(foundationStats)}`
      );
    }

    if (!engineOut.integrityReport.passed) {
      throw new Error(`Expected all 10 forensic & mathematical checks to pass: ${JSON.stringify(engineOut.integrityReport)}`);
    }
  });

  test('ER-031 (Defect #1 Mandatory Regression — NCR-TEMP-001): Revision with ONLY inherited dates has NULL activityDate and NEVER leaks different state into historical snapshot', () => {
    const rows: SubmittalRow[] = [
      {
        id: 'NCR-TEMP-001-R0',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-TEMP-001',
        docNo: 'NCR-TEMP-001',
        rev: '00',
        discipline: 'STR',
        submissionDate: '2026-06-03',
        ncrSentDateCorrectiveAction: '2026-06-20',
        responseDate: '2026-06-25',
        ncrAction: 'Rejected',
        ncrStatus: 'Open'
      } as SubmittalRow,
      {
        id: 'NCR-TEMP-001-R1',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-TEMP-001',
        docNo: 'NCR-TEMP-001',
        rev: '01',
        discipline: 'STR',
        submissionDate: '2026-06-03', // inherited
        ncrSentDateCorrectiveAction: '2026-06-20', // inherited
        responseDate: '2026-06-25', // inherited
        ncrAction: 'Approved',
        ncrStatus: 'Closed'
      } as SubmittalRow
    ];

    const sorted = normalizeNcrRevisionHistory(rows);
    const rev00Act = getRevisionActivityDateMs(sorted[0], 0, sorted);
    const rev01Act = getRevisionActivityDateMs(sorted[1], 1, sorted);

    if (rev00Act === null) {
      throw new Error('Expected Rev00 to have a valid activityDate');
    }
    if (rev01Act !== null) {
      throw new Error(`Expected Rev01 with only inherited dates to have NO genuine activity date (null), got ${rev01Act}`);
    }

    const selectedForJune = getLatestRev(rows, new Date(2026, 5, 30));
    if (!selectedForJune || selectedForJune.rev !== '00') {
      throw new Error(`Expected June 30 snapshot to select Rev00, got ${selectedForJune?.rev}`);
    }

    const juneReport = processNCRData(rows, '2026-06-01');
    // At June 30, selected revision MUST be Rev00 (Rejected/Open -> waitingContractor = 1, overdue = 1), NOT Rev01 (Approved/Closed)
    if (juneReport.monthlyKPIs.waitingContractor !== 1 || juneReport.monthlyKPIs.criticalDelays !== 1) {
      throw new Error(
        `Temporal Revision Leakage detected! Expected June 30 state = Rejected/Open (waitingContractor=1, criticalDelays=1), got waitingContractor=${juneReport.monthlyKPIs.waitingContractor}, criticalDelays=${juneReport.monthlyKPIs.criticalDelays}`
      );
    }
    // Also verify inherited June 20 & June 25 on Rev01 did not double-count June events
    if (
      juneReport.monthlyKPIs.newNcrReceived !== 1 ||
      juneReport.monthlyKPIs.correctiveSubmitted !== 1 ||
      juneReport.monthlyKPIs.responsesReceived !== 1 ||
      juneReport.monthlyKPIs.rejected !== 1 ||
      juneReport.monthlyKPIs.approved !== 0
    ) {
      throw new Error(
        `Inherited dates on Rev01 corrupted June events: ${JSON.stringify(juneReport.monthlyKPIs)}`
      );
    }
  });

  test('ER-032: Genuine same-day resubmission vs inherited duplicate & Cross-Consumer SSOT Parity (Presentation / ExportHelpers / ncrAnalytics)', () => {
    const sameDayResubRows: SubmittalRow[] = [
      {
        id: 'NCR-SD-R0',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-SD-001',
        docNo: 'NCR-SD-001',
        rev: '00',
        discipline: 'SURVEY',
        submissionDate: '2026-06-02',
        ncrSentDateCorrectiveAction: '2026-06-10',
        responseDate: '2026-06-10', // Same-day rejection on Rev00
        ncrAction: 'Rejected',
        ncrStatus: 'Open'
      } as SubmittalRow,
      {
        id: 'NCR-SD-R1',
        registerIdentity: 'NCR',
        documentType: 'NCR',
        ncrRef: 'NCR-SD-001',
        docNo: 'NCR-SD-001',
        rev: '01',
        discipline: 'SURVEY',
        submissionDate: '2026-06-02', // inherited
        ncrSentDateCorrectiveAction: '2026-06-10', // Genuine same-day resubmission on Rev01 initiating new cycle!
        responseDate: '2026-06-18', // Responded 8 days later
        ncrAction: 'Approved',
        ncrStatus: 'Closed'
      } as SubmittalRow
    ];

    const res = processNCRData(sameDayResubRows, '2026-06-01');
    if (res.monthlyKPIs.correctiveSubmitted !== 2 || res.monthlyKPIs.responsesReceived !== 2) {
      throw new Error(
        `Expected 2 corrective submissions and 2 responses for genuine same-day resubmission cycle, got sub=${res.monthlyKPIs.correctiveSubmitted}, resp=${res.monthlyKPIs.responsesReceived}`
      );
    }

    const presCum = compileCanonicalNCRPresentationStats(sameDayResubRows, undefined);
    const exportCum = compileStatsForBaseType(sameDayResubRows, 'NCR', undefined, sameDayResubRows);
    const utilStats = calculateLegacyAnalyticsNCRStats(sameDayResubRows);

    if (
      presCum.totalRow.Total !== 1 ||
      presCum.totalRow.Closed !== 1 ||
      exportCum.totalRow.Total !== presCum.totalRow.Total ||
      exportCum.totalRow.Closed !== presCum.totalRow.Closed ||
      utilStats.ncrRaised !== 1 ||
      utilStats.ncrClosed !== 1
    ) {
      throw new Error(
        `Cross-consumer SSOT mismatch: pres=${JSON.stringify(presCum.totalRow)}, export=${JSON.stringify(exportCum.totalRow)}, util=${JSON.stringify(utilStats)}`
      );
    }
  });

  return testResults;
}
