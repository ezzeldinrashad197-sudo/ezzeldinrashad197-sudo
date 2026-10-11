import * as XLSX from 'xlsx';
import {
  EI_LOG_CANONICAL_COLUMNS,
  buildBenchmarkCumulativeSDWWorkbook,
  generateEILogFromExcelBuffer,
  generateEILogFromWorkbook,
  compareWithReferenceEILog,
  buildEILogExportWorkbook
} from '../src/analytics/ei/eiLogEngine';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail: string) {
  if (condition) {
    console.log(`✔ [PASS] ${testName}: ${detail}`);
    passed++;
  } else {
    console.error(`✖ [FAIL] ${testName}: ${detail}`);
    failed++;
  }
}

function runEILogGeneratorSuite() {
  console.log('================================================================================');
  console.log('STRUCTUSIGHT — EI LOG GENERATOR VERIFICATION & REFERENCE PARITY SUITE');
  console.log('================================================================================');

  // --------------------------------------------------------------------------
  // TEST 1: Certified Multi-Discipline Benchmark vs Approved Reference EI Log
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Multi-Discipline Benchmark & Reference EI Log 100% Parity ---');
  const { buffer, expectedReferenceRecords } = buildBenchmarkCumulativeSDWWorkbook(false);
  const res = generateEILogFromExcelBuffer(buffer, 'Cumulative_SDW_Benchmark.xlsx');

  assert(
    res.summary.discoveredDisciplineSheetsCount === 4,
    'TEST-01.1 Discovered Discipline Sheets',
    `Expected 4 discipline sheets (ELEC, STR, ARCH, MECH), got ${res.summary.discoveredDisciplineSheetsCount} (${res.summary.disciplinesList.join(', ')})`
  );

  assert(
    res.discoveredSheets.some(s => s.sheetRole === 'REFERENCE_EI_LOG' && s.sheetName === 'EI Log'),
    'TEST-01.2 Auto-Detection of Reference EI Log Sheet',
    'Embedded "EI Log" reference sheet detected and isolated from discipline registers'
  );

  assert(
    res.records.length === 5 && res.summary.extractedSubmittalsCount === 5,
    'TEST-01.3 Unique SUB Ref. Consolidation',
    `Expected 5 unique submittals from 23 valid rows, got ${res.records.length}`
  );

  // Verify STR-0001: 5 Rev00 rows in sheet, but 1 is duplicate DWG STR-FD-001 -> Rev00.Total Sheets MUST be 4!
  // Also has 1 row with invalid Rev '-' -> Last Rev. MUST be '01', Code.1 = 'A', Date Return = '2026-06-02'
  const str001 = res.records.find(r => r.subRef === 'INN-ACE-SDW-STR-0001');
  assert(
    Boolean(
      str001 &&
        str001.rev00DateSent === '2026-05-10' &&
        str001.dateReturn === '2026-06-02' &&
        str001.lastRev === '01' &&
        str001.rev00TotalSheets === 4 &&
        str001.code1 === 'A' &&
        str001.duplicateRev00DrawingsCount === 1 &&
        str001.invalidRevisionRowsCount === 1
    ),
    'TEST-01.4 STR-0001 Distinct Rev00 DWG Count & Invalid Revision Resilience',
    `STR-0001 -> Rev00.DateSent=${str001?.rev00DateSent}, DateReturn=${str001?.dateReturn}, LastRev=${str001?.lastRev}, Rev00.TotalSheets=${str001?.rev00TotalSheets}, Code.1=${str001?.code1}`
  );

  // Verify Auto-Detected Reference Reconciliation Report (100% Parity)
  const refReport = res.autoDetectedReferenceReport;
  assert(
    Boolean(
      refReport &&
        refReport.is100PercentParity &&
        refReport.overallFieldMatchRatePct === 100 &&
        refReport.exactRowMatchesCount === 5 &&
        refReport.discrepancies.length === 0
    ),
    'TEST-01.5 100% Field-by-Field Parity with Approved Reference EI Log',
    `Match Rate=${refReport?.overallFieldMatchRatePct}%, Exact Rows=${refReport?.exactRowMatchesCount}/${expectedReferenceRecords.length}, Discrepancies=${refReport?.discrepancies.length}`
  );

  assert(
    Boolean(refReport && refReport.inspectedFormulas.length === 5),
    'TEST-01.6 Reference EI Model Formula Inspection',
    `Inspected ${refReport?.inspectedFormulas.length} Excel formulas from reference EI sheet`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Sheet Order Agnosticism (Reversing Sheet Order)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Sheet Order Independence ---');
  const wbReversed = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true });
  wbReversed.SheetNames = [...wbReversed.SheetNames].reverse();
  const resReversed = generateEILogFromWorkbook(wbReversed, 'Reversed_Sheets_SDW.xlsx');
  const parityReversed = compareWithReferenceEILog(
    resReversed.records,
    expectedReferenceRecords,
    'Expected Reference'
  );

  assert(
    parityReversed.is100PercentParity && parityReversed.overallFieldMatchRatePct === 100,
    'TEST-02.1 Sheet Order Independence',
    `Reversed sheet order [${wbReversed.SheetNames.join(', ')}] achieved 100% field parity`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Conflict Detection, Missing Values & Deterministic Resolution Modes
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Multi-Drawing Conflict Detection & Missing Data Handling ---');
  const { buffer: conflictBuf } = buildBenchmarkCumulativeSDWWorkbook(true);
  const resGoverning = generateEILogFromExcelBuffer(conflictBuf, 'Conflict_Audit.xlsx', {
    resolutionMode: 'GOVERNING_EI_RULE'
  });
  const resFirstMatch = generateEILogFromExcelBuffer(conflictBuf, 'Conflict_Audit.xlsx', {
    resolutionMode: 'EXCEL_FIRST_MATCH'
  });
  const resHold = generateEILogFromExcelBuffer(conflictBuf, 'Conflict_Audit.xlsx', {
    resolutionMode: 'HOLD_ON_CONFLICT'
  });

  const str002Gov = resGoverning.records.find(r => r.subRef === 'INN-ACE-SDW-STR-0002');
  const str002First = resFirstMatch.records.find(r => r.subRef === 'INN-ACE-SDW-STR-0002');
  const str002Hold = resHold.records.find(r => r.subRef === 'INN-ACE-SDW-STR-0002');

  assert(
    Boolean(
      str002Gov &&
        str002Gov.hasConflict &&
        str002Gov.conflictTypes.includes('LAST_REV_CODE_CONFLICT') &&
        str002Gov.conflictTypes.includes('LAST_REV_DATE_RETURN_CONFLICT') &&
        str002Gov.code1 === 'C' &&
        str002Gov.dateReturn === '2026-06-16'
    ),
    'TEST-03.1 Governing EI Rule on Conflicting Drawings',
    `STR-0002 flagged conflict and resolved worst-case Code.1='${str002Gov?.code1}', DateReturn='${str002Gov?.dateReturn}'`
  );

  assert(
    Boolean(str002First && str002First.code1 === 'A' && str002First.dateReturn === '2026-06-14'),
    'TEST-03.2 Excel First-Match Rule on Conflicting Drawings',
    `STR-0002 resolved first-row Code.1='${str002First?.code1}', DateReturn='${str002First?.dateReturn}'`
  );

  assert(
    Boolean(str002Hold && str002Hold.code1 === 'CONFLICT' && str002Hold.dateReturn === 'CONFLICT'),
    'TEST-03.3 Hold-on-Conflict Mode',
    `STR-0002 held conflicted fields as '${str002Hold?.code1}' / '${str002Hold?.dateReturn}'`
  );

  assert(
    resGoverning.unprocessedRecords.length === 1 &&
      resGoverning.unprocessedRecords[0].rawDwgNo === 'STR-ORPHAN-99',
    'TEST-03.4 Unprocessed Row Isolation (Missing SUB Ref.)',
    `Isolated ${resGoverning.unprocessedRecords.length} orphan row (Row ${resGoverning.unprocessedRecords[0]?.excelRowNumber}) without polluting valid submittals`
  );

  // --------------------------------------------------------------------------
  // TEST 4: Edge Cases (Missing Rev 00 Baseline, Conflicting Rev00.Date Sent, Cross-Sheet Duplicate)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Edge Cases: Missing Rev00 Baseline & Cross-Sheet Duplicate SUB Ref. ---');
  const edgeWb = XLSX.utils.book_new();
  const edgeArch = [
    ['SUB Ref.', 'DWG No.', 'Rev.', 'Date Sent', 'Date Return', 'Code'],
    // SUB-NO-REV00 only has Rev 01 (Missing Rev 00 baseline!)
    ['SUB-NO-REV00', 'A-100', '01', '2026-06-10', '2026-06-18', 'A'],
    // SUB-REV00-CONFLICT has two Rev 00 drawings with different Date Sent
    ['SUB-REV00-CONFLICT', 'A-201', '00', '2026-06-01', '2026-06-10', 'B'],
    ['SUB-REV00-CONFLICT', 'A-202', '00', '2026-06-04', '2026-06-10', 'B'],
    // SUB-CROSS-SHEET appears in both ARCH and INFRA
    ['SUB-CROSS-SHEET', 'A-301', '00', '2026-06-02', '2026-06-11', 'A']
  ];
  const edgeInfra = [
    ['SUB Ref.', 'DWG No.', 'Rev.', 'Date Sent', 'Date Return', 'Code'],
    ['SUB-CROSS-SHEET', 'INF-302', '00', '2026-06-02', '2026-06-11', 'A']
  ];
  XLSX.utils.book_append_sheet(edgeWb, XLSX.utils.aoa_to_sheet(edgeArch), 'ARCH');
  XLSX.utils.book_append_sheet(edgeWb, XLSX.utils.aoa_to_sheet(edgeInfra), 'INFRA');

  const edgeRes = generateEILogFromWorkbook(edgeWb, 'Edge_Cases.xlsx');
  const noRev00Rec = edgeRes.records.find(r => r.subRef === 'SUB-NO-REV00');
  const rev00ConflictRec = edgeRes.records.find(r => r.subRef === 'SUB-REV00-CONFLICT');
  const crossSheetRec = edgeRes.records.find(r => r.subRef === 'SUB-CROSS-SHEET');

  assert(
    Boolean(
      noRev00Rec &&
        noRev00Rec.rev00DateSent === '' &&
        noRev00Rec.rev00TotalSheets === 0 &&
        noRev00Rec.lastRev === '01' &&
        noRev00Rec.conflictTypes.includes('MISSING_REV00_BASELINE')
    ),
    'TEST-04.1 Missing Rev00 Baseline Detection',
    `SUB-NO-REV00 flagged MISSING_REV00_BASELINE, Rev00.DateSent='', Rev00.TotalSheets=0, LastRev='01'`
  );

  assert(
    Boolean(
      rev00ConflictRec &&
        rev00ConflictRec.conflictTypes.includes('REV00_DATE_SENT_CONFLICT') &&
        rev00ConflictRec.rev00TotalSheets === 2
    ),
    'TEST-04.2 Conflicting Rev00.Date Sent Detection',
    `SUB-REV00-CONFLICT flagged REV00_DATE_SENT_CONFLICT across 2 drawings`
  );

  assert(
    Boolean(
      crossSheetRec &&
        crossSheetRec.conflictTypes.includes('CROSS_SHEET_DUPLICATE_SUB_REF') &&
        crossSheetRec.sourceSheets.length === 2
    ),
    'TEST-04.3 Cross-Sheet Duplicate SUB Ref. Detection',
    `SUB-CROSS-SHEET detected across [${crossSheetRec?.sourceSheets.join(', ')}]`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Exported Excel Workbook Structure & Exact 6-Column Header Order
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Excel Export Structure & Exact 6-Column Order Verification ---');
  const exportedWb = buildEILogExportWorkbook(res, res.autoDetectedReferenceReport);
  const eiSheet = exportedWb.Sheets['EI Log'];
  const exportedRows = XLSX.utils.sheet_to_json(eiSheet, { header: 1, raw: false }) as string[][];

  assert(
    JSON.stringify(exportedRows[0]) === JSON.stringify(EI_LOG_CANONICAL_COLUMNS),
    'TEST-05.1 Exported Header Order Exact Match',
    `Headers: ${JSON.stringify(exportedRows[0])}`
  );

  assert(
    exportedRows.length === 6 &&
      exportedWb.SheetNames.includes('EI Log') &&
      exportedWb.SheetNames.includes('Traceability Audit') &&
      exportedWb.SheetNames.includes('Conflicts & Errors') &&
      exportedWb.SheetNames.includes('Verification Summary') &&
      exportedWb.SheetNames.includes('Reference Parity'),
    'TEST-05.2 Exported Workbook Completeness',
    `Exported ${exportedRows.length - 1} data rows across sheets: [${exportedWb.SheetNames.join(', ')}]`
  );

  console.log('\n================================================================================');
  console.log(`EI LOG GENERATOR TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');
  if (failed > 0) {
    process.exit(1);
  }
}

runEILogGeneratorSuite();
