import { generateExpandedGoldenDataset } from '../src/utils/calculationVerificationEngine';
import { processRevisionEngine, getBusinessEntityKey } from '../src/analytics/calculationFoundation';
import { compareRevisionsCanonical, getStatusCodeCategory } from '../src/utils/calculations';
import { SubmittalRow } from '../src/types';

// Load actual fixture dataset
const dataset = generateExpandedGoldenDataset();

// Create terminal Code C Closed fixture item for Case 3 (Controlled Synthetic Fixture Executed Against the Canonical Engine)
const sampleCodeCClosedRow: SubmittalRow = {
  id: 'FIXTURE-CCLOSED-01',
  docNo: 'SDW-ARC-9999',
  documentType: 'SHD',
  logType: 'Shop Drawing Register',
  rev: '0',
  status: 'Code C',
  workflowStage: 'Closed',
  action: 'Closed',
  submissionDate: '2026-01-11',
  dueDate: '2026-01-25',
  responseDate: '2026-01-20',
  discipline: 'Architectural',
  trade: 'Architectural',
  contractor: 'MainContractor-A',
  consultant: 'SupervisionConsultant',
  isLatestRev: true,
  isRev0: true,
  delayDays: 0,
  overdue: false,
  sheetNo: '',
  remarks: '',
  area: 'Zone 1',
  tradeSystem: 'Architectural-System'
};

const extendedDataset = [...dataset, sampleCodeCClosedRow];
const engine = processRevisionEngine(extendedDataset);

console.log('================================================================================');
console.log('GATE C: PROVENANCE TRACE VERIFICATION ON CANONICAL ENGINE');
console.log('Timestamp:', new Date().toISOString());
console.log('================================================================================\n');

// 1. Resolved Rejection
const sdw1Key = getBusinessEntityKey(dataset.find(r => r.docNo === 'SDW-DWG-001')!);
const sdw1 = engine.get(sdw1Key)!;
const sdw1Pass = sdw1.hasRejection === true && sdw1.isResolved === true && sdw1.resolvedStatus === 'APPROVED';
console.log('[CASE 1: RESOLVED REJECTION]');
console.log('- Entity Key:           ', sdw1Key);
console.log('- Ingested Rows:         GOLDEN-1 (Rev 0, Code C) -> GOLDEN-2 (Rev 1, Code B)');
console.log('- Revision Ordering:     compareRevisionsCanonical("0", "1") =', compareRevisionsCanonical('0', '1'));
console.log('- Latest Revision:       Rev', sdw1.latest.rev, `(${sdw1.latest.status})`);
console.log('- Engine Flags:          hasRejection =', sdw1.hasRejection, ', isResolved =', sdw1.isResolved, ', resolvedStatus =', sdw1.resolvedStatus);
console.log('- Lifecycle Output:      RESOLVED REJECTION');
console.log('- Result:               ', sdw1Pass ? 'PASS' : 'FAIL');
console.log('');

// 2. Current Rejected Open
const mar76Key = getBusinessEntityKey(dataset.find(r => r.docNo === 'MAR-MAT-076')!);
const mar76 = engine.get(mar76Key)!;
const mar76Pass = mar76.hasRejection === true && mar76.isResolved === false && mar76.resolvedStatus === 'REJECTED_OPEN';
console.log('[CASE 2: CURRENT REJECTED OPEN]');
console.log('- Entity Key:           ', mar76Key);
console.log('- Ingested Rows:         GOLDEN-276 (Rev 0, Code C, Stage: Open)');
console.log('- Revision Sequence:     [Rev 0] (No subsequent resubmission)');
console.log('- Latest Revision:       Rev', mar76.latest.rev, `(${mar76.latest.status})`);
console.log('- Engine Flags:          hasRejection =', mar76.hasRejection, ', isResolved =', mar76.isResolved, ', resolvedStatus =', mar76.resolvedStatus);
console.log('- Lifecycle Output:      CURRENT REJECTED OPEN');
console.log('- Result:               ', mar76Pass ? 'PASS' : 'FAIL');
console.log('');

// 3. Rejected Closed
const docClosedKey = getBusinessEntityKey(sampleCodeCClosedRow);
const docClosed = engine.get(docClosedKey)!;
const docClosedPass = docClosed.hasRejection === true && docClosed.isResolved === false && docClosed.resolvedStatus === 'REJECTED_CLOSED';
console.log('[CASE 3: REJECTED CLOSED - Controlled Synthetic Fixture Executed Against the Canonical Engine]');
console.log('- Entity Key:           ', docClosedKey);
console.log('- Ingested Rows:         FIXTURE-CCLOSED-01 (Rev 0, Code C, Stage: Closed) [Controlled Synthetic Fixture]');
console.log('- Revision Sequence:     [Rev 0] (Terminal / Closed)');
console.log('- Latest Revision:       Rev', docClosed.latest.rev, `(${docClosed.latest.status})`);
console.log('- Engine Flags:          hasRejection =', docClosed.hasRejection, ', isResolved =', docClosed.isResolved, ', resolvedStatus =', docClosed.resolvedStatus);
console.log('- Lifecycle Output:      REJECTED CLOSED');
console.log('- Semantic Inequality:  Resolved Rejection != Rejected Closed ->', sdw1.resolvedStatus !== docClosed.resolvedStatus);
console.log('- Result:               ', docClosedPass ? 'PASS' : 'FAIL');
console.log('');

// 4. First-Pass Approved
const sdw51Key = getBusinessEntityKey(dataset.find(r => r.docNo === 'SDW-DWG-051')!);
const sdw51 = engine.get(sdw51Key)!;
const sdw51Pass = sdw51.hasRejection === false && sdw51.isResolved === false && sdw51.resolvedStatus === 'APPROVED';
console.log('[CASE 4: FIRST-PASS APPROVED]');
console.log('- Entity Key:           ', sdw51Key);
console.log('- Ingested Rows:         GOLDEN-101 (Rev 0, Code A, Stage: Approved)');
console.log('- Revision Sequence:     [Rev 0] (First submission)');
console.log('- Latest Revision:       Rev', sdw51.latest.rev, `(${sdw51.latest.status})`);
console.log('- Engine Flags:          hasRejection =', sdw51.hasRejection, ', isResolved =', sdw51.isResolved, ', resolvedStatus =', sdw51.resolvedStatus);
console.log('- Lifecycle Output:      FIRST-PASS APPROVED');
console.log('- Result:               ', sdw51Pass ? 'PASS' : 'FAIL');
console.log('');

const allPassed = sdw1Pass && mar76Pass && docClosedPass && sdw51Pass;
console.log('================================================================================');
console.log('OVERALL LIFECYCLE PROVENANCE VERDICT:', allPassed ? 'ALL 4 CASES PASSED (100% PROVENANCE INTEGRITY)' : 'FAILURES DETECTED');
console.log('================================================================================');

