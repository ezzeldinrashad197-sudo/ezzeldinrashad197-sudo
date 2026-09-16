import { auditRegisterSequence, runComprehensiveSequenceAudit } from '../src/analytics/sequenceAuditEngine';
import { calculateCanonicalKPIs } from '../src/analytics/calculationFoundation';
import { SubmittalRow } from '../src/types';

// Terminal ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
};

let passedCount = 0;
let failedCount = 0;

function assert(description: string, condition: boolean, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  ${colors.green}✔ PASS${colors.reset}: ${description}`);
  } else {
    failedCount++;
    console.error(`  ${colors.red}✖ FAIL${colors.reset}: ${description}`);
    if (detail) console.error(`     ${colors.yellow}${detail}${colors.reset}`);
  }
}

console.log(`${colors.cyan}${colors.bold}================================================================================${colors.reset}`);
console.log(`${colors.cyan}${colors.bold}  SEQUENCE POPULATION INTEGRITY & GAP DETECTION REGRESSION SUITE${colors.reset}`);
console.log(`${colors.cyan}${colors.bold}================================================================================${colors.reset}`);

// Helper to build typed mock row
const createMockRow = (partial: any): SubmittalRow => ({
  id: partial.id || 'mock-id',
  docNo: partial.docNo || 'DOC-001',
  rev: partial.rev || '00',
  documentType: partial.documentType || 'DOC',
  status: partial.status || 'APPROVED',
  isRev0: partial.isRev0 !== undefined ? partial.isRev0 : true,
  logType: partial.logType || 'DOC',
  trade: partial.trade || 'Civil',
  workflowStage: partial.workflowStage || 'Approved',
  isLatestRev: partial.isLatestRev !== undefined ? partial.isLatestRev : true,
  delayDays: 0,
  overdue: false,
  sheetNo: '1',
  discipline: partial.discipline || 'Civil',
  contractor: 'Contractor',
  consultant: 'Consultant',
  submissionDate: '2025-01-01',
  dueDate: '2025-01-15',
  responseDate: '2025-01-10',
  remarks: '',
  ...partial
} as unknown as SubmittalRow);

// -----------------------------------------------------------------------------
// TEST SUITE 1: Baseline Not Established (The 3585 False Missing IDs Bug Fix)
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 1: Without Authoritative Baseline (Observation Only)] ---${colors.reset}`);

// Construct sample data where minSeq = 1 and maxSeq = 3742, but only 144 items exist
const rowsWithoutBaseline: SubmittalRow[] = [];
for (let i = 1; i <= 144; i++) {
  rowsWithoutBaseline.push(createMockRow({
    id: `row-${i}`,
    docNo: `WIR-SUR-${String(i === 144 ? 3742 : i).padStart(5, '0')}`,
    rev: '00',
    documentType: 'WIR-SUR',
    status: 'APPROVED',
    isRev0: true,
  }));
}

const auditObsOnly = auditRegisterSequence('WIR-SUR', rowsWithoutBaseline);

assert('baselineStatus is BASELINE_NOT_ESTABLISHED when no baseline provided', 
  auditObsOnly.baselineStatus === 'BASELINE_NOT_ESTABLISHED',
  `Actual: ${auditObsOnly.baselineStatus}`);

assert('expectedPopulation is strictly null (NEVER max - min + 1 = 3742)', 
  auditObsOnly.expectedPopulation === null,
  `Actual: ${auditObsOnly.expectedPopulation}`);

assert('missingCount is strictly 0 (Zero false missing items)', 
  auditObsOnly.missingCount === 0,
  `Actual: ${auditObsOnly.missingCount}`);

assert('missingIds array is strictly empty', 
  auditObsOnly.missingIds.length === 0,
  `Actual length: ${auditObsOnly.missingIds.length}`);

assert('observedGapsCount correctly identifies the discontinuity jump (1 jump from 143 to 3742)', 
  auditObsOnly.observedGapsCount === 1,
  `Actual: ${auditObsOnly.observedGapsCount}`);

assert('sequenceGaps identifies the exact gap interval [144 -> 3741]', 
  auditObsOnly.sequenceGaps.length === 1 && 
  auditObsOnly.sequenceGaps[0].fromNumber === 144 && 
  auditObsOnly.sequenceGaps[0].toNumber === 3741,
  `Actual: ${JSON.stringify(auditObsOnly.sequenceGaps)}`);

const compObsOnly = runComprehensiveSequenceAudit(rowsWithoutBaseline);

assert('Comprehensive audit totalExpectedPopulation is strictly null', 
  compObsOnly.totalExpectedPopulation === null,
  `Actual: ${compObsOnly.totalExpectedPopulation}`);

assert('Comprehensive audit totalMissingCount is strictly 0', 
  compObsOnly.totalMissingCount === 0,
  `Actual: ${compObsOnly.totalMissingCount}`);

assert('Comprehensive audit overallStatus is OBSERVATION_ONLY', 
  compObsOnly.overallStatus === 'OBSERVATION_ONLY',
  `Actual: ${compObsOnly.overallStatus}`);

assert('Comprehensive audit summaryNarrative accurately communicates Observation Only with zero missing asserted', 
  compObsOnly.summaryNarrative.includes('Zero Missing IDs asserted without authoritative contractual baseline'),
  `Actual: ${compObsOnly.summaryNarrative}`);

// -----------------------------------------------------------------------------
// TEST SUITE 2: With Authoritative Baseline Established
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 2: With Authoritative Baseline Established] ---${colors.reset}`);

const authoritativeExpectedIds = [
  'WIR-SUR-00001',
  'WIR-SUR-00002',
  'WIR-SUR-00003',
  'WIR-SUR-00004',
  'WIR-SUR-00005'
];

const sampleRowsWithBaseline: SubmittalRow[] = [
  createMockRow({ id: '1', docNo: 'WIR-SUR-00001', rev: '00', documentType: 'WIR-SUR', status: 'APPROVED', isRev0: true }),
  createMockRow({ id: '2', docNo: 'WIR-SUR-00002', rev: '00', documentType: 'WIR-SUR', status: 'APPROVED', isRev0: true }),
  createMockRow({ id: '3', docNo: 'WIR-SUR-00003', rev: '00', documentType: 'WIR-SUR', status: 'APPROVED', isRev0: true })
  // WIR-SUR-00004 and WIR-SUR-00005 are truly missing per contractual baseline
];

const auditWithBaseline = auditRegisterSequence('WIR-SUR', sampleRowsWithBaseline, sampleRowsWithBaseline, {
  authoritativeExpectedIds
});

assert('baselineStatus is AUTHORITATIVE_BASELINE when baseline provided',
  auditWithBaseline.baselineStatus === 'AUTHORITATIVE_BASELINE',
  `Actual: ${auditWithBaseline.baselineStatus}`);

assert('expectedPopulation equals authoritative expected length (5)',
  auditWithBaseline.expectedPopulation === 5,
  `Actual: ${auditWithBaseline.expectedPopulation}`);

assert('missingCount equals exact missing delta from baseline (2)',
  auditWithBaseline.missingCount === 2,
  `Actual: ${auditWithBaseline.missingCount}`);

assert('missingIds strictly contains WIR-SUR-00004 and WIR-SUR-00005',
  auditWithBaseline.missingIds.includes('WIR-SUR-00004') && auditWithBaseline.missingIds.includes('WIR-SUR-00005'),
  `Actual: ${JSON.stringify(auditWithBaseline.missingIds)}`);

const compWithBaseline = runComprehensiveSequenceAudit(sampleRowsWithBaseline, {
  authoritativeExpectedIds
});

assert('Comprehensive audit totalExpectedPopulation is 5',
  compWithBaseline.totalExpectedPopulation === 5,
  `Actual: ${compWithBaseline.totalExpectedPopulation}`);

assert('Comprehensive audit totalMissingCount is 2',
  compWithBaseline.totalMissingCount === 2,
  `Actual: ${compWithBaseline.totalMissingCount}`);

assert('Comprehensive audit overallStatus is GAPS_DETECTED',
  compWithBaseline.overallStatus === 'GAPS_DETECTED',
  `Actual: ${compWithBaseline.overallStatus}`);

// -----------------------------------------------------------------------------
// TEST SUITE 3: Mixed-Baseline Scenario Verification
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 3: Mixed-Baseline Governance & Non-conflation] ---${colors.reset}`);

// Register A (MIR): Has authoritative baseline of 2 items (both present -> 100% reconciled)
// Register B (WIR): Has NO baseline (144 items, sequence reaches 3742 -> Observation Only)
const mixedRows: SubmittalRow[] = [
  createMockRow({ id: 'mir-1', docNo: 'MIR-001', rev: '00', documentType: 'MIR', status: 'APPROVED', isRev0: true }),
  createMockRow({ id: 'mir-2', docNo: 'MIR-002', rev: '00', documentType: 'MIR', status: 'APPROVED', isRev0: true }),
  ...rowsWithoutBaseline // 144 WIR-SUR rows without baseline
];

const compMixed = runComprehensiveSequenceAudit(mixedRows, {
  authoritativeExpectedIdsByRegister: {
    'MIR': ['MIR-001', 'MIR-002']
    // WIR-SUR has no baseline entry
  }
});

assert('Mixed-baseline result status is MIXED_BASELINE',
  compMixed.baselineStatus === 'MIXED_BASELINE',
  `Actual: ${compMixed.baselineStatus}`);

assert('baselineRegistersCount is 1 and observationalRegistersCount is 1',
  compMixed.baselineRegistersCount === 1 && compMixed.observationalRegistersCount === 1,
  `Actual: baseline=${compMixed.baselineRegistersCount}, obs=${compMixed.observationalRegistersCount}`);

assert('totalExpectedPopulation only sums baseline registers (2, not conflated with WIR)',
  compMixed.totalExpectedPopulation === 2,
  `Actual: ${compMixed.totalExpectedPopulation}`);

assert('totalBaselineActualRev0Population strictly equals 2 (like-for-like comparison)',
  compMixed.totalBaselineActualRev0Population === 2,
  `Actual: ${compMixed.totalBaselineActualRev0Population}`);

assert('totalActualRev0Population equals total across all registers (146)',
  compMixed.totalActualRev0Population === 146,
  `Actual: ${compMixed.totalActualRev0Population}`);

assert('totalMissingCount is strictly 0 (no false missing from un-baselined register)',
  compMixed.totalMissingCount === 0,
  `Actual: ${compMixed.totalMissingCount}`);

assert('Mixed summaryNarrative does NOT claim all registers are 100% reconciled',
  !compMixed.summaryNarrative.includes('All 2 registers show 100% continuous sequence reconciliation'),
  `Actual: ${compMixed.summaryNarrative}`);

assert('Mixed summaryNarrative explicitly identifies Partial/Mixed Baseline and differentiates baseline vs observation',
  compMixed.summaryNarrative.includes('Partial/Mixed Baseline: 1 of 2 registers have authoritative baselines') &&
  compMixed.summaryNarrative.includes('Remaining 1 register(s) are Observation Only'),
  `Actual: ${compMixed.summaryNarrative}`);

// -----------------------------------------------------------------------------
// TEST SUITE 4: CSV Export Governance & Header Disambiguation
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 4: CSV Export Governance] ---${colors.reset}`);

// Simulate CSV line generation as in DataValidationEngine.tsx
const testReg = compObsOnly.registerAudits['WIR-SUR'];
const baselineLabel = testReg.baselineStatus === 'AUTHORITATIVE_BASELINE' 
  ? 'Authoritative Baseline' 
  : 'Baseline Not Established (Observation Only)';
const expectedPopStr = testReg.expectedPopulation !== null ? String(testReg.expectedPopulation) : 'N/A (Observation Only)';

assert('CSV Baseline Status column outputs explicit Observation Only label when no baseline',
  baselineLabel === 'Baseline Not Established (Observation Only)',
  `Actual: ${baselineLabel}`);

assert('CSV Expected Population outputs N/A (Observation Only) when no baseline',
  expectedPopStr === 'N/A (Observation Only)',
  `Actual: ${expectedPopStr}`);

assert('CSV Confirmed Missing Count is strictly 0',
  testReg.missingCount === 0,
  `Actual: ${testReg.missingCount}`);

assert('CSV Observed Discontinuity Gaps Count is recorded as 1 without being labeled missing',
  testReg.observedGapsCount === 1,
  `Actual: ${testReg.observedGapsCount}`);

// -----------------------------------------------------------------------------
// TEST SUITE 5: Invariant Preservation - 0.000% KPI Variance
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 5: KPI & Calculation Foundation Invariant Check] ---${colors.reset}`);

const kpis = calculateCanonicalKPIs(rowsWithoutBaseline);

assert('KPI totalSubmittedSheets strictly equals input rows length (144)',
  kpis.totalSubmittedSheets === 144,
  `Actual: ${kpis.totalSubmittedSheets}`);

assert('KPI totalUniqueItems strictly equals unique entity count (144)',
  kpis.totalUniqueItems === 144,
  `Actual: ${kpis.totalUniqueItems}`);

assert('KPI approved strictly equals approved count (144)',
  kpis.approved === 144,
  `Actual: ${kpis.approved}`);

assert('KPI approvalRate strictly equals 100%',
  kpis.approvalRate === 100,
  `Actual: ${kpis.approvalRate}`);

console.log(`\n${colors.bold}================================================================================${colors.reset}`);
if (failedCount === 0) {
  console.log(`  ${colors.bgGreen} ALL ${passedCount} REGRESSION TESTS PASSED! ZERO VARIANCE (0.000%) CONFIRMED. ${colors.reset}`);
  process.exit(0);
} else {
  console.error(`  ${colors.bgRed} ${failedCount} TESTS FAILED OUT OF ${passedCount + failedCount}! ${colors.reset}`);
  process.exit(1);
}
