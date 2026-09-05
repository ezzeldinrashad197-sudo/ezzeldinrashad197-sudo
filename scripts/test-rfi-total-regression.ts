import { compileStatsForBaseType } from '../src/analytics/exportHelpers';
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
  { disc: 'STR', rev0: 12, further: 4, pending: 12, closed: 4 },
  { disc: 'Arch', rev0: 19, further: 6, pending: 19, closed: 6 },
  { disc: 'Mech', rev0: 5, further: 1, pending: 5, closed: 1 },
  { disc: 'Elec', rev0: 25, further: 3, pending: 25, closed: 3 },
  { disc: 'Infra', rev0: 4, further: 0, pending: 4, closed: 0 },
  { disc: 'Landscape', rev0: 1, further: 1, pending: 1, closed: 1 },
  { disc: 'SURVEY', rev0: 0, further: 0, pending: 0, closed: 0 },
];

const mockRfiRows: SubmittalRow[] = [];
let rowIdCounter = 1;

disciplinesConfig.forEach(({ disc, rev0, further, pending, closed }) => {
  // Create Rev00 items
  for (let i = 1; i <= rev0; i++) {
    // For RFI, if item index <= closed, mark as Closed (or status response received), otherwise Pending
    const isClosed = i <= closed && further === 0; // if no further rev, rev0 can be closed
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
      workflowStage: isClosed ? 'Approved' : 'Pending',
      status: isClosed ? 'CLOSED' : 'PENDING',
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
      workflowStage: i <= closed ? 'Approved' : 'Pending',
      status: i <= closed ? 'CLOSED' : 'PENDING',
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
  const sumRev = Number(row.Rev00) + Number(row.FurtherRev);
  const sumStatus = Number(row.Pending) + Number(row.Closed);
  const isValid = row.Total === sumRev && row.Total === sumStatus;

  console.log(
    `| ${String(row.discipline).padEnd(10)} | ${String(row.Rev00).padStart(5)} | ${String(row.FurtherRev).padStart(10)} | ${String(row.Total).padStart(5)} | ${String(row.Pending).padStart(7)} | ${String(row.Closed).padStart(6)} | ${isValid ? '✔ PASS' : '❌ FAIL'} |`
  );

  expect(row.Total).toBe(sumRev, `Discipline ${row.discipline}: Total must equal Rev00 + FurtherRev`);
  expect(row.Total).toBe(sumStatus, `Discipline ${row.discipline}: Total must equal Pending + Closed`);
});

const cumTotal = cumResult.totalRow;
const totalSumRev = Number(cumTotal.Rev00) + Number(cumTotal.FurtherRev);
const totalSumStatus = Number(cumTotal.Pending) + Number(cumTotal.Closed);

console.log('|------------|-------|------------|-------|---------|--------|------------------|');
console.log(
  `| ${'TOTAL'.padEnd(10)} | ${String(cumTotal.Rev00).padStart(5)} | ${String(cumTotal.FurtherRev).padStart(10)} | ${String(cumTotal.Total).padStart(5)} | ${String(cumTotal.Pending).padStart(7)} | ${String(cumTotal.Closed).padStart(6)} | ${cumTotal.Total === totalSumRev && cumTotal.Total === totalSumStatus ? '✔ PASS' : '❌ FAIL'} |`
);

expect(cumTotal.Total).toBe(totalSumRev, 'TotalRow: Total must equal Rev00 + FurtherRev');
expect(cumTotal.Total).toBe(totalSumStatus, 'TotalRow: Total must equal Pending + Closed');
expect(cumTotal.Total).toBe(81, 'TotalRow: Al-Burouj Total must equal exactly 81');
expect(cumTotal.Rev00).toBe(66, 'TotalRow: Al-Burouj Rev00 must equal exactly 66');
expect(cumTotal.FurtherRev).toBe(15, 'TotalRow: Al-Burouj FurtherRev must equal exactly 15');

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

console.log('\n================================================================================');
console.log(`RESULTS: ${passedTests} Passed, ${failedTests} Failed.`);
if (failedTests > 0) {
  console.error('VERDICT: FAILED');
  process.exit(1);
} else {
  console.log('VERDICT: ALL RFI TOTAL TESTS PASSED WITH 100% PARITY');
  console.log('================================================================================');
}
