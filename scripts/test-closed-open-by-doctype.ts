import { getClosedOpenByDocType } from '../src/utils/calculations';

interface TestCase {
  docType: string;
  input: {
    totalSubmittedSheets?: number;
    pending?: number;
    approved?: number;
    rejectedOpen?: number;
    rejectedClosed?: number;
  };
  expected: { closed: number; open: number };
  reference: string;
}

const testCases: TestCase[] = [
  {
    docType: 'RFI',
    input: { totalSubmittedSheets: 80, pending: 15, approved: 65, rejectedOpen: 0, rejectedClosed: 0 },
    expected: { closed: 65, open: 15 },
    reference: 'RFI Domain Formula: Closed = Approved/Closed Current State (65), Open = Pending (15)'
  },
  {
    docType: 'NCR',
    input: { totalSubmittedSheets: 60, pending: 0, approved: 45, rejectedOpen: 15, rejectedClosed: 0 },
    expected: { closed: 45, open: 15 },
    reference: 'NCR Quality Rule: Closed = Approved (45), Open = RejectedOpen (15)'
  },
  {
    docType: 'SOR',
    input: { totalSubmittedSheets: 50, pending: 0, approved: 40, rejectedOpen: 10, rejectedClosed: 0 },
    expected: { closed: 40, open: 10 },
    reference: 'SOR Field Observation Rule: Closed = Approved (40), Open = RejectedOpen (10)'
  },
  {
    docType: 'SDW',
    input: { totalSubmittedSheets: 210, pending: 45, approved: 140, rejectedOpen: 15, rejectedClosed: 10 },
    expected: { closed: 150, open: 60 },
    reference: 'Standard Submittal Formula: Closed = Approved + RejClosed (140+10=150), Open = RejOpen + Pending (15+45=60)'
  },
  {
    docType: 'DWG',
    input: { totalSubmittedSheets: 100, pending: 20, approved: 70, rejectedOpen: 5, rejectedClosed: 5 },
    expected: { closed: 75, open: 25 },
    reference: 'Standard Drawing Formula: Closed = Approved + RejClosed (70+5=75), Open = RejOpen + Pending (5+20=25)'
  },
  {
    docType: 'ARCH',
    input: { totalSubmittedSheets: 120, pending: 25, approved: 85, rejectedOpen: 8, rejectedClosed: 2 },
    expected: { closed: 87, open: 33 },
    reference: 'Architectural Submittal: Closed = 85+2=87, Open = 8+25=33'
  },
  {
    docType: 'ELEC',
    input: { totalSubmittedSheets: 90, pending: 15, approved: 65, rejectedOpen: 6, rejectedClosed: 4 },
    expected: { closed: 69, open: 21 },
    reference: 'Electrical Submittal: Closed = 65+4=69, Open = 6+15=21'
  },
  {
    docType: 'MAR',
    input: { totalSubmittedSheets: 100, pending: 20, approved: 75, rejectedOpen: 5, rejectedClosed: 0 },
    expected: { closed: 75, open: 25 },
    reference: 'Material Approval Request: Closed = 75+0=75, Open = 5+20=25'
  },
  {
    docType: 'MIR',
    input: { totalSubmittedSheets: 80, pending: 0, approved: 70, rejectedOpen: 10, rejectedClosed: 0 },
    expected: { closed: 70, open: 10 },
    reference: 'Material Inspection Request: Closed = 70+0=70, Open = 10+0=10'
  },
  {
    docType: 'WIR',
    input: { totalSubmittedSheets: 80, pending: 0, approved: 80, rejectedOpen: 0, rejectedClosed: 0 },
    expected: { closed: 80, open: 0 },
    reference: 'Work Inspection Request: Closed = 80+0=80, Open = 0+0=0'
  },
  {
    docType: 'ABD',
    input: { totalSubmittedSheets: 50, pending: 0, approved: 50, rejectedOpen: 0, rejectedClosed: 0 },
    expected: { closed: 50, open: 0 },
    reference: 'Other Supported Type (As-Built Drawings): Closed = 50+0=50, Open = 0+0=0'
  },
  {
    docType: 'TRS',
    input: { totalSubmittedSheets: 40, pending: 10, approved: 28, rejectedOpen: 2, rejectedClosed: 0 },
    expected: { closed: 28, open: 12 },
    reference: 'Other Supported Type (Transmittals): Closed = 28+0=28, Open = 2+10=12'
  },
  {
    docType: 'LTR',
    input: { totalSubmittedSheets: 30, pending: 5, approved: 25, rejectedOpen: 0, rejectedClosed: 0 },
    expected: { closed: 25, open: 5 },
    reference: 'Other Supported Type (Letters / Correspondence): Closed = 25+0=25, Open = 0+5=5'
  }
];

console.log('================================================================================');
console.log('EXECUTING getClosedOpenByDocType DIRECT TEST SUITE');
console.log('Target Module: src/utils/calculations.ts');
console.log('Timestamp:', new Date().toISOString());
console.log('Total Test Cases:', testCases.length);
console.log('================================================================================\n');

let passedCount = 0;
let failedCount = 0;

for (const tc of testCases) {
  const actual = getClosedOpenByDocType(tc.docType, tc.input);
  const pass = actual.closed === tc.expected.closed && actual.open === tc.expected.open;
  
  if (pass) {
    passedCount++;
  } else {
    failedCount++;
  }

  const inputStr = `tot:${tc.input.totalSubmittedSheets || 0},app:${tc.input.approved || 0},pnd:${tc.input.pending || 0},ro:${tc.input.rejectedOpen || 0},rc:${tc.input.rejectedClosed || 0}`;
  const outStr = `{closed:${actual.closed},open:${actual.open}}`;
  const expStr = `{closed:${tc.expected.closed},open:${tc.expected.open}}`;

  console.log(`[${pass ? 'PASS' : 'FAIL'}] DocType: ${tc.docType.padEnd(5)} | Input: ${inputStr.padEnd(35)} | Output: ${outStr.padEnd(20)} | Expected: ${expStr.padEnd(20)} | Ref: ${tc.reference}`);
}

console.log('\n================================================================================');
console.log(`SUMMARY: ${passedCount} Passed, ${failedCount} Failed out of ${testCases.length} Test Cases.`);
console.log(`VERDICT: ${failedCount === 0 ? 'ALL TESTS PASSED WITH 100% PARITY' : 'TEST FAILURES DETECTED'}`);
console.log('================================================================================');

if (failedCount > 0) {
  process.exit(1);
}
