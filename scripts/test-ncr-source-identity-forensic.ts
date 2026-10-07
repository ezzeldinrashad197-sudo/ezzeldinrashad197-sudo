import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../src/utils/parser';
import {
  buildNCRForensicIdentityInventory,
  processNCRData,
  compileCanonicalNCRPresentationStats
} from '../src/analytics/ncr/ncrEngine';
import { calculateNCRStats } from '../src/analytics/calculationFoundation';
import { compileStatsForBaseType } from '../src/analytics/exportHelpers';

const EXCEL_FILE_NAME = '16- Non-Conformance Report (NCR).xlsx';
const EXCEL_FILE_PATH = path.resolve(process.cwd(), 'src/test-datasets', EXCEL_FILE_NAME);

function ensureRealSourceWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const strSheetAoA = [
    [
      'NCR Ref',
      'Rev',
      'Last Rev',
      'Trade',
      'Received Date',
      'Sent Corrective Action',
      'Action',
      'Status',
      'Response Date',
      'Subject'
    ],
    [
      'ACE-INN-P1.03B-NCR-0001',
      '0',
      'Yes',
      'STR',
      '2026-05-23',
      '2026-07-06',
      'Under Review',
      'Waiting',
      '',
      'Concrete surface defect at Zone B'
    ],
    [
      '',
      '',
      '',
      'STR',
      '',
      '',
      'Under Review',
      'Waiting',
      '',
      'Continuation row 1 belonging to same NCR structure (blank NCR Ref)'
    ],
    [
      '',
      '',
      '',
      'STR',
      '',
      '',
      'Under Review',
      'Waiting',
      '',
      'Continuation row 2 belonging to same NCR structure (blank NCR Ref)'
    ]
  ];
  const ws = XLSX.utils.aoa_to_sheet(strSheetAoA);
  XLSX.utils.book_append_sheet(wb, ws, 'STR');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  fs.mkdirSync(path.dirname(EXCEL_FILE_PATH), { recursive: true });
  fs.writeFileSync(EXCEL_FILE_PATH, buf);
  return buf;
}

function runForensicAcceptanceTest() {
  console.log('================================================================================');
  console.log('  NCR SOURCE-BASED FORENSIC IDENTITY ACCEPTANCE TEST');
  console.log(`  Source File: ${EXCEL_FILE_NAME} | Sheet: STR`);
  console.log('================================================================================');

  const buffer = ensureRealSourceWorkbook();
  const parsedRows = parseExcelBuffer(buffer, EXCEL_FILE_NAME);

  const inventory = buildNCRForensicIdentityInventory(parsedRows);
  const engineOut = processNCRData(parsedRows, '2026-07-01');
  const presOut = compileCanonicalNCRPresentationStats(parsedRows);
  const exportOut = compileStatsForBaseType(parsedRows, 'NCR', undefined, parsedRows);
  const foundationOut = calculateNCRStats(parsedRows);

  console.log('\n1. EVERY ACTUAL NON-EMPTY NCR REF DISCOVERED:');
  console.log(JSON.stringify(inventory.discoveredNcrRefs, null, 2));

  console.log('\n2. UNIQUE NCR REF COUNT:');
  console.log(`   uniqueNcrRefCount = ${inventory.uniqueNcrRefCount}`);

  console.log('\n3. SOURCE ROWS ASSIGNED TO EACH NCR REF:');
  console.log(JSON.stringify(inventory.rowsByNcrRef, null, 2));

  console.log('\n4. BLANK NCR REF CONTINUATION ROWS IDENTIFIED SEPARATELY:');
  console.log(JSON.stringify(inventory.blankContinuationRows, null, 2));

  console.log('\n5. PROOF THAT NO SYNTHETIC NCR IDENTITY IS COUNTED AS A UNIQUE NCR:');
  console.log(`   - rejectedSyntheticIdentities   : ${JSON.stringify(inventory.rejectedSyntheticIdentities)}`);
  console.log(`   - zeroSyntheticCountVerified    : ${inventory.zeroSyntheticCountVerified}`);
  console.log(`   - processNCRData.totalUnique    : ${engineOut.cumulativeKPIs.totalUnique} (STR = ${engineOut.cumulative.find(c => c.discipline === 'STR')?.totalUnique ?? 0})`);
  console.log(`   - processNCRData.underReview    : ${engineOut.cumulativeKPIs.underReview} (Stage 2 — Waiting Consultant)`);
  console.log(`   - processNCRData.open           : ${engineOut.cumulativeKPIs.open}`);
  console.log(`   - processNCRData.closed         : ${engineOut.cumulativeKPIs.closed}`);
  console.log(`   - evidenceList refs             : ${JSON.stringify(engineOut.evidenceList.map(e => ({ ref: e.ref, stage: e.stage, actionCode: e.actionCode })))}`);
  console.log(`   - Presentation STR Total        : ${presOut.stats.find(s => s.discipline === 'STR')?.Total}`);
  console.log(`   - ExportHelpers STR Total       : ${exportOut.stats.find(s => s.discipline === 'STR')?.Total}`);
  console.log(`   - Foundation totalUniqueDrawings: ${foundationOut.totalUniqueDrawings}`);

  // Strict Assertions
  if (inventory.uniqueNcrRefCount !== 1 || inventory.discoveredNcrRefs[0] !== 'ACE-INN-P1.03B-NCR-0001') {
    throw new Error(`FAIL #1/#2: Expected uniqueNcrRefCount=1 with ['ACE-INN-P1.03B-NCR-0001'], got ${JSON.stringify(inventory.discoveredNcrRefs)}`);
  }
  const assignedRows = inventory.rowsByNcrRef['ACE-INN-P1.03B-NCR-0001'] || [];
  if (
    assignedRows.length !== 1 ||
    assignedRows[0].rev !== '0' ||
    assignedRows[0].lastRev !== 'Yes' ||
    assignedRows[0].trade !== 'STR' ||
    assignedRows[0].receivedDate !== '2026-05-23' ||
    assignedRows[0].sentCorrectiveDate !== '2026-07-06' ||
    assignedRows[0].action !== 'Under Review' ||
    assignedRows[0].status.toUpperCase() !== 'WAITING' ||
    assignedRows[0].responseDate !== ''
  ) {
    throw new Error(`FAIL #3: Assigned row metadata mismatch: ${JSON.stringify(assignedRows)}`);
  }
  if (inventory.blankContinuationRows.length !== 2) {
    throw new Error(`FAIL #4: Expected 2 blank continuation rows, got ${inventory.blankContinuationRows.length}`);
  }
  if (
    !inventory.rejectedSyntheticIdentities.includes('STR::16- NON-CONFORMANCE REPORT (NCR)::1') ||
    !inventory.rejectedSyntheticIdentities.includes('STR::16- NON-CONFORMANCE REPORT (NCR)::2')
  ) {
    throw new Error(`FAIL #5a: Expected rejected synthetic identities to include ::1 and ::2`);
  }
  if (
    engineOut.cumulativeKPIs.totalUnique !== 1 ||
    engineOut.cumulativeKPIs.underReview !== 1 ||
    engineOut.evidenceList.length !== 1 ||
    engineOut.evidenceList[0].ref !== 'ACE-INN-P1.03B-NCR-0001' ||
    engineOut.evidenceList[0].stage !== 'Stage 2: Waiting Consultant'
  ) {
    throw new Error(`FAIL #5b: Engine output mismatch: ${JSON.stringify(engineOut.cumulativeKPIs)}`);
  }

  console.log('\n✔ ALL 5 SOURCE-IDENTITY FORENSIC ACCEPTANCE CHECKS PASSED.');
}

runForensicAcceptanceTest();
