import { formatDate } from '../src/utils/parser';
import { calculateStats, normalizeData } from '../src/utils/calculations';
import { buildCompositeIdentity } from '../src/utils/classificationEngine';
import { SubmittalRow } from '../src/types';

console.log('================================================================================');
console.log('STRUCTUSIGHT — WIR-STR REAL-WORLD UAT MATRIX & REGRESSION SUITE');
console.log('================================================================================');

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail: string) {
  if (condition) {
    console.log(`[PASS] ${testName}: ${detail}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName}: ${detail}`);
    failedTests++;
  }
}

// --------------------------------------------------------------------------------
// CASE-STR-001: Classification Precedence Hierarchy (WIR-STR with INFRA row)
// --------------------------------------------------------------------------------
console.log('\n--- CASE-STR-001: Classification Precedence Hierarchy ---');

const mockSTRRowWithInfra = {
  id: 'row-1',
  docNo: 'INN-ARC-WIR-STR-00751',
  rawSourceIdentity: 'WIR-STR',
  logType: 'WIR-STR',
  discipline: 'INFRA',
  trade: 'INFRA',
  status: 'Code A',
  submissionDate: '2026-08-02',
  rev: '00',
  documentType: 'WIR-STR',
  workflowStage: 'Approved',
  isLatestRev: true,
  isRev0: true,
  delayDays: 0,
  overdue: false,
  revisionIndex: 0
} as unknown as SubmittalRow;

const normalized = normalizeData([mockSTRRowWithInfra]);
assert(
  normalized[0].documentType === 'WIR-STR',
  'CASE-STR-001.1 Document Type Resolution',
  `Expected documentType to be WIR-STR, got: ${normalized[0].documentType}`
);
assert(
  normalized[0].discipline === 'Structural' || normalized[0].discipline === 'STR',
  'CASE-STR-001.2 Discipline Field Locked to Structural',
  `Expected discipline to resolve to Structural, got: ${normalized[0].discipline}`
);
assert(
  normalized[0].disciplineEvidenceSource === 'REGISTER_LOCK',
  'CASE-STR-001.3 Audit Evidence Source',
  `Expected disciplineEvidenceSource to be REGISTER_LOCK, got: ${normalized[0].disciplineEvidenceSource}`
);
assert(
  normalized[0].isDisciplineLocked === true,
  'CASE-STR-001.4 Register Lock Invariant',
  `Expected isDisciplineLocked to be true, got: ${normalized[0].isDisciplineLocked}`
);

// --------------------------------------------------------------------------------
// CASE-STR-002: Date Parsing for DD/MM/YYYY format
// --------------------------------------------------------------------------------
console.log('\n--- CASE-STR-002: Date Parsing for DD/MM/YYYY Strings ---');

const dateStr1 = '02/08/2026';
const dateStr2 = '30/08/2026';

const parsedDate1 = formatDate(dateStr1);
const parsedDate2 = formatDate(dateStr2);

assert(
  parsedDate1 === '2026-08-02',
  'CASE-STR-002.1 Parse 02/08/2026 to 2026-08-02',
  `Expected 2026-08-02, got: ${parsedDate1}`
);
assert(
  parsedDate2 === '2026-08-30',
  'CASE-STR-002.2 Parse 30/08/2026 to 2026-08-30',
  `Expected 2026-08-30, got: ${parsedDate2}`
);

// --------------------------------------------------------------------------------
// CASE-STR-003: August 2026 Monthly Approval Rate Calculation
// --------------------------------------------------------------------------------
console.log('\n--- CASE-STR-003: August 2026 Monthly Approval Rate ---');

// 8 records: 6 Approved (Code A/B), 1 Rejected (Code C), 1 Pending (Under Review)
const augRecords = [
  { id: '1', docNo: 'WIR-001', documentType: 'WIR-STR', status: 'Approved', submissionDate: '2026-08-01', rev: '00', workflowStage: 'Approved', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '2', docNo: 'WIR-002', documentType: 'WIR-STR', status: 'Approved', submissionDate: '2026-08-02', rev: '00', workflowStage: 'Approved', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '3', docNo: 'WIR-003', documentType: 'WIR-STR', status: 'Code A', submissionDate: '2026-08-03', rev: '00', workflowStage: 'Approved', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '4', docNo: 'WIR-004', documentType: 'WIR-STR', status: 'Code B', submissionDate: '2026-08-04', rev: '00', workflowStage: 'Approved', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '5', docNo: 'WIR-005', documentType: 'WIR-STR', status: 'Code B', submissionDate: '2026-08-05', rev: '00', workflowStage: 'Approved', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '6', docNo: 'WIR-006', documentType: 'WIR-STR', status: 'Code B', submissionDate: '2026-08-06', rev: '00', workflowStage: 'Approved', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '7', docNo: 'WIR-007', documentType: 'WIR-STR', status: 'Rejected', submissionDate: '2026-08-10', rev: '00', workflowStage: 'Rejected', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
  { id: '8', docNo: 'WIR-008', documentType: 'WIR-STR', status: 'Under Review', submissionDate: '2026-08-12', rev: '00', workflowStage: 'Pending', isLatestRev: true, isRev0: true, delayDays: 0, overdue: false, revisionIndex: 0 },
] as unknown as SubmittalRow[];

const augNormalized = normalizeData(augRecords);
const augStats = calculateStats(augNormalized, {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  documentType: 'All',
  discipline: 'All',
  status: 'All',
  searchQuery: '',
  revisionFilter: 'All'
} as any);

assert(
  augStats.totalSubmittedSheets === 8,
  'CASE-STR-003.1 Total August Workload Count',
  `Expected 8, got: ${augStats.totalSubmittedSheets}`
);

assert(
  augStats.approved === 6,
  'CASE-STR-003.2 Total August Approved Items',
  `Expected 6, got: ${augStats.approved}`
);

assert(
  augStats.rejectedOpen + augStats.rejectedClosed === 1,
  'CASE-STR-003.3 Total August Rejected Items',
  `Expected 1, got: ${augStats.rejectedOpen + augStats.rejectedClosed}`
);

// Total = 8 submitted sheets (6 Approved + 1 Rejected + 1 Pending). Approval Rate = 6 / 8 = 75.00%
const expectedRate = (6 / 8) * 100; // 75.00%
assert(
  Math.abs(augStats.approvalRate - expectedRate) < 0.1,
  'CASE-STR-003.4 August Approval Rate Denominator Check',
  `Expected 75.00%, got: ${augStats.approvalRate.toFixed(2)}%`
);

// --------------------------------------------------------------------------------
// CASE-STR-004: Multi-Discipline Register Guard (WIR-ARCH-STR.xlsx -> MULTIDISCIPLINE & NOT REGISTER_LOCK)
// --------------------------------------------------------------------------------
console.log('\n--- CASE-STR-004: Multi-Discipline Register Guard ---');

const multiCompIdent = buildCompositeIdentity(
  'WIR',
  'WIR-ARCH-STR.xlsx',
  'WIR-ARCH-STR',
  ['WIR-ARCH-STR'],
  []
);

assert(
  multiCompIdent.discipline === 'MULTIDISCIPLINE',
  'CASE-STR-004.1 Multi-discipline register detected as MULTIDISCIPLINE',
  `Expected MULTIDISCIPLINE, got: ${multiCompIdent.discipline}`
);

assert(
  multiCompIdent.isRegisterLocked === false,
  'CASE-STR-004.2 Multi-discipline register is NOT register-locked',
  `Expected isRegisterLocked === false, got: ${multiCompIdent.isRegisterLocked}`
);

assert(
  multiCompIdent.disciplineEvidenceSource !== 'REGISTER_LOCK',
  'CASE-STR-004.3 Multi-discipline register evidence source is not REGISTER_LOCK',
  `Expected not REGISTER_LOCK, got: ${multiCompIdent.disciplineEvidenceSource}`
);

console.log(`\n================================================================================`);
console.log(`SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
console.log(`================================================================================`);
if (failedTests > 0) process.exit(1);
