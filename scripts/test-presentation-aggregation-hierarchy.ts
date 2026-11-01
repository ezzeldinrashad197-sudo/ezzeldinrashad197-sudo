import { compileStatsForBaseType, getRegisterTitle } from '../src/analytics/exportHelpers';
import { resolveOfficialSubmittalRegister, resolveRowRegister } from '../src/analytics/managementReportOutput';
import { resolveRowRegisterFamily, resolveRegisterFamilyFromKey } from '../src/Presentation';
import { getPresentationRegisterLabel } from '../src/components/presentation/PresHelpers';
import { SubmittalRow } from '../src/types';

console.log('================================================================================');
console.log('STRUCTUSIGHT — PRESENTATION AGGREGATION & HIERARCHY REGRESSION SUITE');
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
// 1. Synthetic Real-World Sample Data for DOC Registers
// --------------------------------------------------------------------------------
console.log('\n--- TEST GROUP 1: Invariant Numerical Metrics for DOC-ELEC ---');

// Build 48 unique documents for DOC-ELEC:
// 48 documents total.
// Total sheets = 72.
// Rev00 rows = 51 (so 3 documents have multiple Rev00 or distinct sheets).
// Further Rev rows = 21 (so 21 revisions beyond Rev00).
// Approved = 47, Rejected = 1, Pending = 0.
const mockDocElecRows: SubmittalRow[] = [];

// 47 Approved documents (47 unique)
for (let i = 1; i <= 47; i++) {
  const docNo = `DOC-ELEC-${String(i).padStart(3, '0')}`;
  // Rev 00
  mockDocElecRows.push({
    id: `elec-${i}-00`,
    docNo,
    rawSourceIdentity: 'DOC-ELEC',
    logType: 'DOC-ELEC',
    documentType: 'DOC-ELEC',
    discipline: 'Elec',
    trade: 'Elec',
    status: i <= 21 ? 'Rev.01 Approved' : 'Approved',
    submissionDate: '2026-06-01',
    rev: '00',
    workflowStage: i <= 21 ? 'Superseded' : 'Approved',
    isLatestRev: i > 21,
    isRev0: true,
    delayDays: 0,
    overdue: false,
    revisionIndex: 0
  } as unknown as SubmittalRow);

  // If among the first 21, add Further Rev (Rev 01) which is Approved (latest)
  if (i <= 21) {
    mockDocElecRows.push({
      id: `elec-${i}-01`,
      docNo,
      rawSourceIdentity: 'DOC-ELEC',
      logType: 'DOC-ELEC',
      documentType: 'DOC-ELEC',
      discipline: 'Elec',
      trade: 'Elec',
      status: 'Approved',
      submissionDate: '2026-07-01',
      rev: '01',
      workflowStage: 'Approved',
      isLatestRev: true,
      isRev0: false,
      delayDays: 0,
      overdue: false,
      revisionIndex: 1
    } as unknown as SubmittalRow);
  }
}

// 1 Rejected document (document #48)
const rejectedDocNo = 'DOC-ELEC-048';
mockDocElecRows.push({
  id: 'elec-48-00',
  docNo: rejectedDocNo,
  rawSourceIdentity: 'DOC-ELEC',
  logType: 'DOC-ELEC',
  documentType: 'DOC-ELEC',
  discipline: 'Elec',
  trade: 'Elec',
  status: 'Code C',
  submissionDate: '2026-08-01',
  rev: '00',
  workflowStage: 'Rejected Open',
  isLatestRev: true,
  isRev0: true,
  delayDays: 5,
  overdue: true,
  revisionIndex: 0
} as unknown as SubmittalRow);

// Add 3 extra Rev 00 sheet rows to make Rev 00 total = 51 (48 + 3 = 51)
// and Total Sheets = 51 + 21 = 72
for (let s = 1; s <= 3; s++) {
  mockDocElecRows.push({
    id: `elec-sheet-extra-${s}`,
    docNo: `DOC-ELEC-00${s}`, // Multi-sheet item
    rawSourceIdentity: 'DOC-ELEC',
    logType: 'DOC-ELEC',
    documentType: 'DOC-ELEC',
    discipline: 'Elec',
    trade: 'Elec',
    status: 'Approved',
    submissionDate: '2026-06-01',
    rev: '00',
    workflowStage: 'Approved',
    isLatestRev: false,
    isRev0: true,
    delayDays: 0,
    overdue: false,
    revisionIndex: 0
  } as unknown as SubmittalRow);
}

// Also add sample DOC-ARCH, DOC-MECH, and DOC-GENERAL rows
const mockDocArchRows: SubmittalRow[] = [
  {
    id: 'arch-1-00',
    docNo: 'DOC-ARCH-001',
    rawSourceIdentity: 'DOC-ARCH',
    logType: 'DOC-ARCH',
    documentType: 'DOC-ARCH',
    discipline: 'Arch',
    trade: 'Arch',
    status: 'Approved',
    submissionDate: '2026-05-01',
    rev: '00',
    workflowStage: 'Approved',
    isLatestRev: true,
    isRev0: true
  } as unknown as SubmittalRow
];

const mockDocMechRows: SubmittalRow[] = [
  {
    id: 'mech-1-00',
    docNo: 'DOC-MECH-001',
    rawSourceIdentity: 'DOC-MECH',
    logType: 'DOC-MECH',
    documentType: 'DOC-MECH',
    discipline: 'Mech',
    trade: 'Mech',
    status: 'Approved',
    submissionDate: '2026-05-01',
    rev: '00',
    workflowStage: 'Approved',
    isLatestRev: true,
    isRev0: true
  } as unknown as SubmittalRow
];

const mockDocGeneralRows: SubmittalRow[] = [
  {
    id: 'gen-1-00',
    docNo: 'DOC-GEN-001',
    rawSourceIdentity: 'DOC-GENERAL',
    logType: 'DOC-GENERAL',
    documentType: 'DOC-GENERAL',
    discipline: 'GEN',
    trade: 'GEN',
    status: 'Approved',
    submissionDate: '2026-05-01',
    rev: '00',
    workflowStage: 'Approved',
    isLatestRev: true,
    isRev0: true
  } as unknown as SubmittalRow
];

const fullDocDataset = [
  ...mockDocElecRows,
  ...mockDocArchRows,
  ...mockDocMechRows,
  ...mockDocGeneralRows
];

// Test compileStatsForBaseType for 'DOC'
const docStats = compileStatsForBaseType(fullDocDataset, 'DOC');

assert(docStats.hasData === true, 'DOC Family hasData', 'Expected true');
assert(docStats.stats.length === 4, 'DOC Sub-Registers Count', `Expected 4 sub-registers, got ${docStats.stats.length}`);

const elecStatsRow = docStats.stats.find(s => s.discipline === 'DOC-ELEC');
assert(!!elecStatsRow, 'DOC-ELEC Present in Sub-Registers', 'Expected DOC-ELEC row to exist under DOC');

if (elecStatsRow) {
  assert(elecStatsRow.CurrentUnique === 48, 'DOC-ELEC Current Unique', `Expected 48, got ${elecStatsRow.CurrentUnique}`);
  assert(elecStatsRow.Rev00 === 51, 'DOC-ELEC Rev.00 Rows', `Expected 51, got ${elecStatsRow.Rev00}`);
  assert(elecStatsRow.FurtherRev === 21, 'DOC-ELEC Further Rev.', `Expected 21, got ${elecStatsRow.FurtherRev}`);
  assert(elecStatsRow.TotalSheets === 72, 'DOC-ELEC Total Sheets', `Expected 72, got ${elecStatsRow.TotalSheets}`);
  assert(elecStatsRow.Approved === 47, 'DOC-ELEC Approved', `Expected 47, got ${elecStatsRow.Approved}`);
  assert(elecStatsRow.Rejected === 1, 'DOC-ELEC Rejected', `Expected 1, got ${elecStatsRow.Rejected}`);
  assert(elecStatsRow.Pending === 0, 'DOC-ELEC Pending', `Expected 0, got ${elecStatsRow.Pending}`);
}

const genStatsRow = docStats.stats.find(s => s.discipline === 'DOC-GEN');
assert(!!genStatsRow, 'DOC-GEN Present with Concise Label', 'Expected DOC-GEN row to exist under DOC');
if (genStatsRow) {
  assert((genStatsRow as any).rawDiscipline === 'DOC-GENERAL', 'DOC-GEN preserves internal DOC-GENERAL identity', `Expected rawDiscipline to be DOC-GENERAL, got ${(genStatsRow as any).rawDiscipline}`);
}

const subRegLabels = docStats.stats.map(s => s.discipline);
assert(
  JSON.stringify(subRegLabels) === JSON.stringify(['DOC-ARCH', 'DOC-MECH', 'DOC-ELEC', 'DOC-GEN']),
  'DOC Sub-Registers use concise labels',
  `Expected ['DOC-ARCH', 'DOC-MECH', 'DOC-ELEC', 'DOC-GEN'], got ${JSON.stringify(subRegLabels)}`
);

// Verify exact requested acronym rules
assert(getPresentationRegisterLabel('DOC-GENERAL') === 'DOC-GEN', 'Label Mapping: DOC-GENERAL -> DOC-GEN', 'Verified');
assert(getPresentationRegisterLabel('General & HSE Document Submittals (DOC-GENERAL)') === 'DOC-GEN', 'Label Mapping: General & HSE -> DOC-GEN', 'Verified');
assert(getPresentationRegisterLabel('DOC-ARCH') === 'DOC-ARCH', 'Label Mapping: DOC-ARCH', 'Verified');
assert(getPresentationRegisterLabel('Architectural Document Submittals (DOC-ARCH)') === 'DOC-ARCH', 'Label Mapping: Arch long -> DOC-ARCH', 'Verified');
assert(getPresentationRegisterLabel('DOC-MECH') === 'DOC-MECH', 'Label Mapping: DOC-MECH', 'Verified');
assert(getPresentationRegisterLabel('Mechanical Document Submittals (DOC-MECH)') === 'DOC-MECH', 'Label Mapping: Mech long -> DOC-MECH', 'Verified');
assert(getPresentationRegisterLabel('DOC-ELEC') === 'DOC-ELEC', 'Label Mapping: DOC-ELEC', 'Verified');
assert(getPresentationRegisterLabel('Electrical Document Submittals (DOC-ELEC)') === 'DOC-ELEC', 'Label Mapping: Elec long -> DOC-ELEC', 'Verified');
assert(getPresentationRegisterLabel('DOC-STR') === 'DOC-STR', 'Label Mapping: DOC-STR', 'Verified');
assert(getPresentationRegisterLabel('DOC-LANDSCAPE') === 'DOC-LANDSCAPE', 'Label Mapping: DOC-LANDSCAPE', 'Verified');
assert(getPresentationRegisterLabel('DOC-INFRA') === 'DOC-INFRA', 'Label Mapping: DOC-INFRA', 'Verified');

// Verify main section title invariant: Document Submittals (DOC) Cumulative Status
const docMainTitle = getRegisterTitle('DOC', 'en');
assert(
  `${docMainTitle.name} Cumulative Status` === 'Document Submittals (DOC) Cumulative Status',
  'Main Section Title Invariant: Document Submittals (DOC) Cumulative Status',
  `Got: ${docMainTitle.name} Cumulative Status`
);

// --------------------------------------------------------------------------------
// 2. Elimination of Zero-Filled Rows for Non-DOC Registers
// --------------------------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Elimination of Zero-Filled Rows in Discipline Tables ---');

// Create a Shop Drawing dataset containing ONLY Structural rows
const sdwStrRows: SubmittalRow[] = [
  {
    id: 'sdw-1',
    docNo: 'SDW-STR-001',
    rawSourceIdentity: 'SDW',
    logType: 'SDW',
    documentType: 'SDW',
    discipline: 'STR',
    trade: 'STR',
    status: 'Approved',
    submissionDate: '2026-06-01',
    rev: '00',
    workflowStage: 'Approved',
    isLatestRev: true,
    isRev0: true
  } as unknown as SubmittalRow,
  {
    id: 'sdw-2',
    docNo: 'SDW-STR-002',
    rawSourceIdentity: 'SDW',
    logType: 'SDW',
    documentType: 'SDW',
    discipline: 'STR',
    trade: 'STR',
    status: 'Approved',
    submissionDate: '2026-06-01',
    rev: '00',
    workflowStage: 'Approved',
    isLatestRev: true,
    isRev0: true
  } as unknown as SubmittalRow
];

const sdwStats = compileStatsForBaseType(sdwStrRows, 'SDW');

assert(sdwStats.stats.length === 1, 'SDW Contains Only Active Disciplines', `Expected 1 discipline (STR), got ${sdwStats.stats.length}`);
assert(sdwStats.stats[0].discipline === 'STR', 'SDW Active Discipline is STR', `Got ${sdwStats.stats[0]?.discipline}`);

// Ensure other disciplines (Arch, Mech, Elec, Infra, Landscape) are NOT rendered with 0 rows
const absentDisciplines = sdwStats.stats.filter(s => ['Arch', 'Mech', 'Elec', 'Infra', 'Landscape'].includes(s.discipline));
assert(absentDisciplines.length === 0, 'No Zero Rows for Absent Disciplines', `Expected 0 ghost rows, got ${absentDisciplines.length}`);

// --------------------------------------------------------------------------------
// 3. Register Family Resolution (Level 2 vs Level 3)
// --------------------------------------------------------------------------------
console.log('\n--- TEST GROUP 3: Hierarchy Separation: Register Family vs Trade ---');

assert(
  resolveRowRegisterFamily(mockDocElecRows[0]) === 'DOC',
  'DOC-ELEC Register Family is DOC',
  `Expected DOC, got ${resolveRowRegisterFamily(mockDocElecRows[0])}`
);

assert(
  resolveOfficialSubmittalRegister(mockDocElecRows[0]) === 'DOC-ELEC',
  'DOC-ELEC Sub-Register is DOC-ELEC',
  `Expected DOC-ELEC, got ${resolveOfficialSubmittalRegister(mockDocElecRows[0])}`
);

assert(
  resolveRowRegister(mockDocElecRows[0]) === 'DOC',
  'DOC-ELEC Row Register is DOC (Parent Family)',
  `Expected DOC, got ${resolveRowRegister(mockDocElecRows[0])}`
);

// --------------------------------------------------------------------------------
// Summary
// --------------------------------------------------------------------------------
console.log('\n================================================================================');
console.log(`RESULTS: ${passedTests} Passed, ${failedTests} Failed.`);
if (failedTests > 0) {
  console.error('VERDICT: REGRESSION AUDIT FAILED');
  process.exit(1);
} else {
  console.log('VERDICT: ALL PRESENTATION AGGREGATION & HIERARCHY TESTS PASSED (100%)');
  process.exit(0);
}
