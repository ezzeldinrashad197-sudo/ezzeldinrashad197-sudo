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

// -----------------------------------------------------------------------------
// TEST SUITE 1: Baseline Not Established (The 3585 False Missing IDs Bug Fix)
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 1: Without Authoritative Baseline (Observation Only)] ---${colors.reset}`);

// Construct sample data where minSeq = 1 and maxSeq = 3742, but only 144 items exist
const rowsWithoutBaseline: SubmittalRow[] = [];
for (let i = 1; i <= 144; i++) {
  rowsWithoutBaseline.push({
    id: `row-${i}`,
    docNo: `WIR-SUR-${String(i === 144 ? 3742 : i).padStart(5, '0')}`,
    rev: '00',
    documentType: 'WIR-SUR',
    status: 'APPROVED',
    isRev0: true,
  });
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

assert('observedGapsCount records the sequence jump between 143 and 3742', 
  auditObsOnly.observedGapsCount > 0,
  `Actual observedGapsCount: ${auditObsOnly.observedGapsCount}`);

assert('sequenceGaps captures the discontinuity interval', 
  auditObsOnly.sequenceGaps.length > 0 && auditObsOnly.sequenceGaps[0].fromNumber === 144 && auditObsOnly.sequenceGaps[0].toNumber === 3741,
  `Actual: ${JSON.stringify(auditObsOnly.sequenceGaps[0])}`);

// Comprehensive audit check
const compAuditObsOnly = runComprehensiveSequenceAudit(rowsWithoutBaseline);

assert('Comprehensive audit baselineStatus is BASELINE_NOT_ESTABLISHED',
  compAuditObsOnly.baselineStatus === 'BASELINE_NOT_ESTABLISHED',
  `Actual: ${compAuditObsOnly.baselineStatus}`);

assert('Comprehensive audit totalExpectedPopulation is null',
  compAuditObsOnly.totalExpectedPopulation === null,
  `Actual: ${compAuditObsOnly.totalExpectedPopulation}`);

assert('Comprehensive audit totalMissingCount is strictly 0',
  compAuditObsOnly.totalMissingCount === 0,
  `Actual: ${compAuditObsOnly.totalMissingCount}`);

assert('Comprehensive audit overallStatus is OBSERVATION_ONLY',
  compAuditObsOnly.overallStatus === 'OBSERVATION_ONLY',
  `Actual: ${compAuditObsOnly.overallStatus}`);

assert('Comprehensive audit totalObservedGapsCount is > 0',
  compAuditObsOnly.totalObservedGapsCount > 0,
  `Actual: ${compAuditObsOnly.totalObservedGapsCount}`);

// -----------------------------------------------------------------------------
// TEST SUITE 2: With Explicit Authoritative Baseline
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 2: With Authoritative Contractual Baseline] ---${colors.reset}`);

const authoritativeExpectedIds = [
  'WIR-SUR-00001',
  'WIR-SUR-00002',
  'WIR-SUR-00003',
  'WIR-SUR-00004',
  'WIR-SUR-00005'
];

const sampleRowsWithBaseline: SubmittalRow[] = [
  { id: '1', docNo: 'WIR-SUR-00001', rev: '00', documentType: 'WIR-SUR', status: 'APPROVED', isRev0: true },
  { id: '2', docNo: 'WIR-SUR-00002', rev: '00', documentType: 'WIR-SUR', status: 'APPROVED', isRev0: true },
  { id: '3', docNo: 'WIR-SUR-00003', rev: '00', documentType: 'WIR-SUR', status: 'APPROVED', isRev0: true }
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
// TEST SUITE 3: Invariant Preservation - 0.000% KPI Variance
// -----------------------------------------------------------------------------
console.log(`\n${colors.bold}--- [SUITE 3: KPI & Calculation Foundation Invariant Check] ---${colors.reset}`);

// Calculate KPIs on sample data
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
