import { compileStatsForBaseType } from '../src/analytics/exportHelpers';
import { getStatusCodeCategory } from '../src/analytics/statusResolver';
import { SubmittalRow } from '../src/types';

console.log('================================================================================');
console.log('STRUCTUSIGHT — RFI TOTAL INVARIANT CROSS-LAYER REGRESSION TEST');
console.log('Testing: RFI Total = Rev.00 + Further Rev. & Total = Pending + Closed');
console.log('================================================================================\n');

let passedTests = 0;
let failedTests = 0;

function expect<T>(actual: T) {
  return {
    toBe(expected: T, message?: string) {
      if (actual === expected) {
        passedTests++;
      } else {
        failedTests++;
        console.error(`[FAIL] ${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
      }
    }
  };
}

// Generate the exact Al-Burouj RFI Distribution:
// STR: 12 Rev00, 4 FurtherRev (12 Pending, 4 Closed)
// Arch: 19 Rev00, 6 FurtherRev (19 Pending, 6 Closed)
// Mech: 5 Rev00, 1 FurtherRev (5 Pending, 1 Closed)
// Elec: 25 Rev00, 3 FurtherRev (25 Pending, 3 Closed)
// Infra: 4 Rev00, 0 FurtherRev (4 Pending, 0 Closed)
// Landscape: 1 Rev00, 1 FurtherRev (1 Pending, 1 Closed)
// Survey: 0 Rev00, 0 FurtherRev (0 Pending, 0 Closed)
// TOTAL: 66 Rev00, 15 FurtherRev = 81 Total (66 Pending, 15 Closed)

const disciplinesConfig = [
  { disc: 'STR', rev0: 12, further: 4, expectedPending: 8, expectedClosed: 4 },
  { disc: 'Arch', rev0: 19, further: 6, expectedPending: 13, expectedClosed: 6 },
  { disc: 'Mech', rev0: 5, further: 1, expectedPending: 4, expectedClosed: 1 },
  { disc: 'Elec', rev0: 25, further: 3, expectedPending: 22, expectedClosed: 3 },
  { disc: 'Infra', rev0: 4, further: 0, expectedPending: 4, expectedClosed: 0 },
  { disc: 'Landscape', rev0: 1, further: 1, expectedPending: 0, expectedClosed: 1 },
  { disc: 'SURVEY', rev0: 0, further: 0, expectedPending: 0, expectedClosed: 0 },
];

const mockRfiRows: SubmittalRow[] = [];
let rowIdCounter = 1;

disciplinesConfig.forEach(({ disc, rev0, further, expectedClosed }) => {
  // Create Rev00 items
  for (let i = 1; i <= rev0; i++) {
    // For RFI, if item index <= expectedClosed and no further rev, it is closed at Rev00
    const isClosedAtRev0 = i <= expectedClosed && further === 0;
    mockRfiRows.push({
      id: `RFI-${disc}-REV0-${i}`,
      docNo: `RFI-${disc}-${String(i).padStart(3, '0')}`,
      logType: 'RFI',
      documentType: 'RFI',
      discipline: disc,
      trade: disc,
      rev: '00',
      isRev0: true,
      isLatestRev: further === 0,
      workflowStage: isClosedAtRev0 ? 'Approved' : 'Pending',
      status: isClosedAtRev0 ? 'CLOSED' : 'PENDING',
      submissionDate: '2026-01-10',
      dueDate: '2026-01-24',
      delayDays: 0,
      overdue: false,
      sheetNo: '1',
      contractor: 'Main Contractor',
      consultant: 'Consultant',
      remarks: '',
      area: '',
      tradeSystem: '',
      stakeholder: 'Consultant'
    } as SubmittalRow);
  }

  // Create Further Rev items
  for (let i = 1; i <= further; i++) {
    const isClosedAtFurther = i <= expectedClosed;
    mockRfiRows.push({
      id: `RFI-${disc}-REV1-${i}`,
      docNo: `RFI-${disc}-${String(i).padStart(3, '0')}`, // Same business item as rev0
      logType: 'RFI',
      documentType: 'RFI',
      discipline: disc,
      trade: disc,
      rev: '01',
      isRev0: false,
      isLatestRev: true,
      workflowStage: isClosedAtFurther ? 'Approved' : 'Pending',
      status: isClosedAtFurther ? 'CLOSED' : 'PENDING',
      submissionDate: '2026-02-10',
      dueDate: '2026-02-24',
      delayDays: 0,
      overdue: false,
      sheetNo: '1',
      contractor: 'Main Contractor',
      consultant: 'Consultant',
      remarks: '',
      area: '',
      tradeSystem: '',
      stakeholder: 'Consultant'
    } as SubmittalRow);
  }
});

console.log(`[DATASET GENERATED] Total RFI Rows: ${mockRfiRows.length}`);

// -----------------------------------------------------------------------------
// TEST SUITE 1: compileStatsForBaseType (Cumulative Mode)
// -----------------------------------------------------------------------------
console.log('\n--- TEST 1: compileStatsForBaseType Cumulative Stats ---');
const cumResult = compileStatsForBaseType(mockRfiRows, 'RFI');

console.log('\n| Discipline | Rev00 | FurtherRev | Total | Pending | Closed | Invariant Status |');
console.log('|------------|-------|------------|-------|---------|--------|------------------|');

cumResult.stats.forEach((row) => {
  const cfg = disciplinesConfig.find(c => c.disc === row.discipline);
  const sumRev = Number(row.Rev00) + Number(row.FurtherRev);
  const sumStatus = Number(row.Pending) + Number(row.Closed);
  // Invariant 1: Total workload = Rev00 + FurtherRev
  // Invariant 2: Current state = Pending + Closed = Unique Entities (Rev00)
  const isValidWorkload = row.Total === sumRev;
  const isValidCurrentState = sumStatus === Number(row.Rev00);
  const isValid = isValidWorkload && isValidCurrentState;

  console.log(
    `| ${String(row.discipline).padEnd(10)} | ${String(row.Rev00).padStart(5)} | ${String(row.FurtherRev).padStart(10)} | ${String(row.Total).padStart(5)} | ${String(row.Pending).padStart(7)} | ${String(row.Closed).padStart(6)} | ${isValid ? '✔ PASS' : '❌ FAIL'} |`
  );

  // Workload Invariant: Total submissions = Rev00 + FurtherRev
  expect(row.Total).toBe(sumRev, `Discipline ${row.discipline}: Total must equal Rev00 + FurtherRev`);
  
  // Architectural Invariant: Pending + Closed = Total Unique RFI Business Entities
  // Dynamically derived from dataset / engine:
  const uniqueEntitiesForDiscipline = new Set(mockRfiRows.filter(r => r.discipline === row.discipline).map(r => r.docNo)).size;
  expect(sumStatus).toBe(uniqueEntitiesForDiscipline, `Discipline ${row.discipline} Architectural Invariant: Pending + Closed (${sumStatus}) must equal Total Unique Entities (${uniqueEntitiesForDiscipline}) derived dynamically`);
  expect(sumStatus).toBe(Number(row.Rev00), `Discipline ${row.discipline} Dataset-Specific Assertion: Pending + Closed must equal Rev00 in Al-Burouj`);

  if (cfg) {
    expect(row.Pending).toBe(cfg.expectedPending, `Discipline ${row.discipline}: Pending must match canonical actual pending entities`);
    expect(row.Closed).toBe(cfg.expectedClosed, `Discipline ${row.discipline}: Closed must match canonical actual closed entities`);

    // REGRESSION GUARD (User Requirement 9):
    // Explicitly prevent Pending === Rev00 and Closed === FurtherRev when data has closed revisions
    if (cfg.further > 0 && cfg.expectedClosed > 0) {
      expect(row.Pending !== row.Rev00).toBe(true, `Regression Guard: ${row.discipline} Pending (${row.Pending}) must NOT collapse into Rev00 (${row.Rev00})`);
    }
  }
});

const cumTotal = cumResult.totalRow;
const totalSumRev = Number(cumTotal.Rev00) + Number(cumTotal.FurtherRev);
const totalSumStatus = Number(cumTotal.Pending) + Number(cumTotal.Closed);

console.log('|------------|-------|------------|-------|---------|--------|------------------|');
console.log(
  `| ${'TOTAL'.padEnd(10)} | ${String(cumTotal.Rev00).padStart(5)} | ${String(cumTotal.FurtherRev).padStart(10)} | ${String(cumTotal.Total).padStart(5)} | ${String(cumTotal.Pending).padStart(7)} | ${String(cumTotal.Closed).padStart(6)} | ${cumTotal.Total === totalSumRev && totalSumStatus === Number(cumTotal.Rev00) ? '✔ PASS' : '❌ FAIL'} |`
);

// Workload Invariant
expect(cumTotal.Total).toBe(totalSumRev, 'TotalRow: Total must equal Rev00 + FurtherRev (81 = 66 + 15)');

// Architectural Invariant: Pending + Closed = Total Unique RFI Business Entities (dynamically derived from dataset)
const totalUniqueRfiEntitiesDerived = new Set(mockRfiRows.map(r => r.docNo)).size;
expect(totalSumStatus).toBe(totalUniqueRfiEntitiesDerived, `TotalRow Architectural Invariant: Pending + Closed (${totalSumStatus}) must equal Total Unique RFI Business Entities (${totalUniqueRfiEntitiesDerived}) derived from engine`);
// Dataset-Specific Assertion
expect(totalSumStatus).toBe(Number(cumTotal.Rev00), 'TotalRow Dataset-Specific Assertion: Pending + Closed must equal Rev00 in Al-Burouj (66)');

expect(cumTotal.Total).toBe(81, 'TotalRow: Al-Burouj Total must equal exactly 81');
expect(cumTotal.Rev00).toBe(66, 'TotalRow: Al-Burouj Rev00 must equal exactly 66');
expect(cumTotal.FurtherRev).toBe(15, 'TotalRow: Al-Burouj FurtherRev must equal exactly 15');
expect(cumTotal.Pending).toBe(51, 'TotalRow: Al-Burouj Pending must equal exactly 51 actual pending entities');
expect(cumTotal.Closed).toBe(15, 'TotalRow: Al-Burouj Closed must equal exactly 15 actual closed entities');

// REGRESSION GUARD (User Requirement 9) on Total Row:
expect(cumTotal.Pending !== cumTotal.Rev00).toBe(true, 'TotalRow Regression Guard: Pending (51) must NOT equal Rev00 (66)');

// -----------------------------------------------------------------------------
// TEST SUITE 2: compileStatsForBaseType (Monthly Mode)
// -----------------------------------------------------------------------------
console.log('\n--- TEST 2: compileStatsForBaseType Monthly Stats Invariant ---');
const monResult = compileStatsForBaseType(mockRfiRows, 'RFI', '2026-01-01');

monResult.stats.forEach((row) => {
  const sumRev = Number(row.Rev00) + Number(row.FurtherRev);
  expect(row.Total).toBe(sumRev, `Monthly Discipline ${row.discipline}: Total must equal Rev00 + FurtherRev`);
});

const monTotal = monResult.totalRow;
expect(monTotal.Total).toBe(
  Number(monTotal.Rev00) + Number(monTotal.FurtherRev),
  'Monthly TotalRow: Total must equal Rev00 + FurtherRev'
);

// -----------------------------------------------------------------------------
// TEST SUITE 3: Derived Invariant Assertions
// -----------------------------------------------------------------------------
console.log('\n--- TEST 3: Direct Invariant Assertions ---');
cumResult.stats.forEach((row) => {
  expect(row.Total).toBe(row.Rev00 + row.FurtherRev, `expect(row.total).toBe(row.rev00 + row.furtherRev) for ${row.discipline}`);
});
expect(cumTotal.Total).toBe(cumTotal.Rev00 + cumTotal.FurtherRev, 'expect(total.total).toBe(total.rev00 + total.furtherRev)');

// -----------------------------------------------------------------------------
// TEST SUITE 4: Canonical False Positive & Review Status Regression
// -----------------------------------------------------------------------------
console.log('\n--- TEST 4: Canonical False Positive & Review Status Regression ---');

// Critical test cases required by User:
// NOT APPROVED, WAITING FOR APPROVAL, PENDING APPROVAL, AWAITING APPROVAL must NOT become CLOSED!
import { CanonicalStatus } from '../src/analytics/statusResolver';

const canonicalStatusTestCases: { status: string; expected: CanonicalStatus; desc: string }[] = [
  { status: 'NOT APPROVED', expected: 'PENDING', desc: 'NOT APPROVED must stay PENDING, never CLOSED' },
  { status: 'WAITING FOR APPROVAL', expected: 'PENDING', desc: 'WAITING FOR APPROVAL must stay PENDING, never CLOSED' },
  { status: 'PENDING APPROVAL', expected: 'PENDING', desc: 'PENDING APPROVAL must stay PENDING, never CLOSED' },
  { status: 'AWAITING APPROVAL', expected: 'PENDING', desc: 'AWAITING APPROVAL must stay PENDING, never CLOSED' },
  { status: 'UNDER REVIEW', expected: 'PENDING', desc: 'UNDER REVIEW must stay PENDING' },
  { status: 'OPEN', expected: 'PENDING', desc: 'OPEN must stay PENDING' },
  { status: 'WAITING', expected: 'PENDING', desc: 'WAITING must stay PENDING' },
  { status: 'CLOSED', expected: 'APPROVED', desc: 'CLOSED must resolve to APPROVED (Closed in KPIs)' },
  { status: 'FINAL_CLOSED', expected: 'APPROVED', desc: 'FINAL_CLOSED must resolve to APPROVED' },
  { status: 'FINAL CLOSED', expected: 'APPROVED', desc: 'FINAL CLOSED must resolve to APPROVED' },
  { status: 'ANSWERED', expected: 'APPROVED', desc: 'ANSWERED must resolve to APPROVED' },
  { status: 'COMPLETED', expected: 'APPROVED', desc: 'COMPLETED must resolve to APPROVED' },
  { status: 'RESOLVED', expected: 'APPROVED', desc: 'RESOLVED must resolve to APPROVED' },
  { status: 'APPROVED', expected: 'APPROVED', desc: 'APPROVED must resolve to APPROVED' },
];

canonicalStatusTestCases.forEach((tc) => {
  const mockRow: SubmittalRow = {
    id: `RFI-MOCK-${tc.status.replace(/\s+/g, '_')}`,
    docNo: 'RFI-STR-001',
    logType: 'RFI',
    documentType: 'RFI',
    discipline: 'STR',
    trade: 'STR',
    status: tc.status,
    recordStatus: tc.status,
    workflowStage: tc.status,
    action: tc.status,
    rev: '00',
    isRev0: true,
    isLatestRev: true,
  } as any;

  const resolved = getStatusCodeCategory(mockRow);
  expect(resolved).toBe(tc.expected, tc.desc);
  if (tc.expected === 'PENDING') {
    expect(resolved !== 'APPROVED').toBe(true, `Strict Guard: "${tc.status}" must NOT resolve to APPROVED/CLOSED`);
  }
});

// Test Code C Rejection Semantics preservation on RFI:
// 1) Explicit rawCode 'C' + OPEN status -> REJECTED_OPEN
const rfiCodeCOpen: SubmittalRow = {
  id: 'RFI-CODE-C-OPEN',
  docNo: 'RFI-STR-002',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  trade: 'STR',
  status: 'OPEN',
  code: 'C',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(rfiCodeCOpen)).toBe('REJECTED_OPEN', 'RFI Code C with OPEN status must resolve to REJECTED_OPEN');

// 2) Explicit rawCode 'C' + CLOSED status -> REJECTED_CLOSED
const rfiCodeCClosed: SubmittalRow = {
  id: 'RFI-CODE-C-CLOSED',
  docNo: 'RFI-STR-003',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  trade: 'STR',
  status: 'CLOSED',
  code: 'C',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(rfiCodeCClosed)).toBe('REJECTED_CLOSED', 'RFI Code C with CLOSED status must resolve to REJECTED_CLOSED');

// 3) Non-Code C with generic "REJECTED" in text: must NOT be converted to Code C unless rawCode is C
const rfiNonCodeCWithRejectWord: SubmittalRow = {
  id: 'RFI-NON-CODE-C',
  docNo: 'RFI-STR-004',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  trade: 'STR',
  status: 'CLOSED',
  action: 'SUPERSEDED AND REJECTED PREVIOUS',
  code: '',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(rfiNonCodeCWithRejectWord)).toBe('APPROVED', 'RFI without rawCode C must NOT become Code C merely due to substring REJECTED in action');

// -----------------------------------------------------------------------------
// TEST SUITE 5: Canonical Field Precedence (recordStatus vs workflowStage)
// -----------------------------------------------------------------------------
console.log('\n--- TEST 5: Canonical Field Precedence (recordStatus vs workflowStage) ---');

// Precedence Case 1: recordStatus = 'CLOSED' + workflowStage = 'PENDING'
// Authoritative recordStatus takes precedence over workflowStage
const precRowRecordClosedWorkflowPending: SubmittalRow = {
  id: 'RFI-PREC-1',
  docNo: 'RFI-STR-101',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  recordStatus: 'CLOSED',
  workflowStage: 'PENDING',
  status: '',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(precRowRecordClosedWorkflowPending)).toBe(
  'APPROVED',
  'Precedence: recordStatus = CLOSED overrides workflowStage = PENDING -> resolves to APPROVED (Closed in KPI)'
);

// Precedence Case 2: recordStatus = 'OPEN' + workflowStage = 'CLOSED'
// Authoritative recordStatus takes precedence over workflowStage
const precRowRecordOpenWorkflowClosed: SubmittalRow = {
  id: 'RFI-PREC-2',
  docNo: 'RFI-STR-102',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  recordStatus: 'OPEN',
  workflowStage: 'CLOSED',
  status: '',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(precRowRecordOpenWorkflowClosed)).toBe(
  'PENDING',
  'Precedence: recordStatus = OPEN overrides workflowStage = CLOSED -> resolves to PENDING (Open in KPI)'
);

// Precedence Case 3: recordStatus is empty, workflowStage = 'CLOSED'
// Priority falls back to workflowStage
const precRowWorkflowClosed: SubmittalRow = {
  id: 'RFI-PREC-3',
  docNo: 'RFI-STR-103',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  recordStatus: '',
  workflowStage: 'CLOSED',
  status: '',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(precRowWorkflowClosed)).toBe(
  'APPROVED',
  'Precedence: empty recordStatus falls back to workflowStage = CLOSED -> resolves to APPROVED'
);

// Precedence Case 4: recordStatus is empty, workflowStage = 'PENDING'
// Priority falls back to workflowStage
const precRowWorkflowPending: SubmittalRow = {
  id: 'RFI-PREC-4',
  docNo: 'RFI-STR-104',
  logType: 'RFI',
  documentType: 'RFI',
  discipline: 'STR',
  recordStatus: '',
  workflowStage: 'PENDING',
  status: '',
  rev: '00',
  isRev0: true,
  isLatestRev: true,
} as any;
expect(getStatusCodeCategory(precRowWorkflowPending)).toBe(
  'PENDING',
  'Precedence: empty recordStatus falls back to workflowStage = PENDING -> resolves to PENDING'
);

console.log('\n================================================================================');
console.log(`RESULTS: ${passedTests} Passed, ${failedTests} Failed.`);
if (failedTests > 0) {
  console.error('VERDICT: FAILED');
  process.exit(1);
} else {
  console.log('VERDICT: ALL RFI TOTAL TESTS PASSED WITH 100% PARITY');
  console.log('================================================================================');
}
