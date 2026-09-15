import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../src/utils/parser';
import { normalizeData } from '../src/utils/calculations';

function createExcelWorkbookBuffer(
  sheets: { sheetName: string; rows: (string | number | null | undefined)[][] }[]
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function runRealWorld1854Verification() {
  console.log('================================================================================');
  console.log('STRUCTUSIGHT — FULL 1,854 RECORDS REAL-WORLD END-TO-END VERIFICATION');
  console.log('================================================================================\n');

  const headers = [
    'Submittal Ref.',
    'Rev.',
    'Discipline',
    'Date Received',
    'Target Return Date',
    'Actual Return Date',
    'Status Code',
    'Review Status',
  ];

  const rows: (string | number | null | undefined)[][] = [headers];

  // Generate 1854 unique items:
  // 1853 rows with discipline "STR"
  // Row 751 (index 751) with discipline "INFRA" (the real-world human input error)
  // Also add revisions for some items to match 2,134 workload
  let totalRowsCreated = 0;
  for (let i = 1; i <= 1854; i++) {
    const seqStr = String(i).padStart(5, '0');
    const docNo = `INN-ARC-WIR-STR-${seqStr}`;
    const disc = (i === 751) ? 'INFRA' : 'STR'; // Row 751 has accidental INFRA!

    rows.push([
      docNo,
      '00',
      disc,
      '2026-08-01',
      '2026-08-15',
      '2026-08-10',
      'A',
      'APPROVED'
    ]);
    totalRowsCreated++;

    // Add 280 further revisions distributed across the first 280 items to match 2,134 workload
    if (i <= 280) {
      rows.push([
        docNo,
        '01',
        disc,
        '2026-08-16',
        '2026-08-25',
        '2026-08-20',
        'A',
        'APPROVED'
      ]);
      totalRowsCreated++;
    }
  }

  console.log(`Generated synthetic dataset matching StructuSight Master Project Aug 2026:`);
  console.log(`- Total Ingested Physical Rows (Workload): ${totalRowsCreated} (2134 expected)`);
  console.log(`- Unique Entities: 1854`);
  console.log(`- Accidental INFRA Row: Item 00751\n`);

  const wirStrBuffer = createExcelWorkbookBuffer([{ sheetName: 'WIR-STR', rows }]);
  const parsedRows = parseExcelBuffer(wirStrBuffer, 'WIR-STR.xlsx');
  const normalizedRows = normalizeData(parsedRows);

  // Group by documentType to produce the "Primary Register Intelligence Summary" table
  const summary: Record<string, { uniqueEntities: Set<string>; workload: number; rev00: number; furtherRev: number }> = {};

  for (const row of normalizedRows) {
    const reg = row.documentType || 'UNCLASSIFIED';
    if (!summary[reg]) {
      summary[reg] = {
        uniqueEntities: new Set(),
        workload: 0,
        rev00: 0,
        furtherRev: 0,
      };
    }
    summary[reg].workload++;
    summary[reg].uniqueEntities.add(row.docNo);
    if (row.isRev0) {
      summary[reg].rev00++;
    } else {
      summary[reg].furtherRev++;
    }
  }

  console.log('--------------------------------------------------------------------------------');
  console.log('                     PRIMARY REGISTER INTELLIGENCE SUMMARY                     ');
  console.log('--------------------------------------------------------------------------------');
  console.log('Register         | Unique Items | Workload     | Rev 00       | Further Rev    ');
  console.log('-----------------+--------------+--------------+--------------+----------------');

  let grandUnique = 0;
  let grandWorkload = 0;
  let grandRev00 = 0;
  let grandFurther = 0;

  for (const [regName, data] of Object.entries(summary)) {
    const uCount = data.uniqueEntities.size;
    grandUnique += uCount;
    grandWorkload += data.workload;
    grandRev00 += data.rev00;
    grandFurther += data.furtherRev;
    console.log(
      `${regName.padEnd(16)} | ${String(uCount).padEnd(12)} | ${String(data.workload).padEnd(12)} | ${String(data.rev00).padEnd(12)} | ${String(data.furtherRev).padEnd(14)}`
    );
  }
  console.log('-----------------+--------------+--------------+--------------+----------------');
  console.log(
    `${'Grand Total'.padEnd(16)} | ${String(grandUnique).padEnd(12)} | ${String(grandWorkload).padEnd(12)} | ${String(grandRev00).padEnd(12)} | ${String(grandFurther).padEnd(14)}`
  );
  console.log('--------------------------------------------------------------------------------\n');

  // Assertions:
  const wirStrSummary = summary['WIR-STR'];
  const wirInfraSummary = summary['WIR-INFRA'];

  let passed = 0;
  let failed = 0;

  function test(name: string, condition: boolean, expected: any, actual: any) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} | Expected: ${expected}, Got: ${actual}`);
      failed++;
    }
  }

  test(
    'WIR-STR Unique Items count equals 1854',
    wirStrSummary?.uniqueEntities.size === 1854,
    1854,
    wirStrSummary?.uniqueEntities.size
  );

  test(
    'WIR-STR Workload count equals 2134',
    wirStrSummary?.workload === 2134,
    2134,
    wirStrSummary?.workload
  );

  test(
    'WIR-STR Rev 00 count equals 1854',
    wirStrSummary?.rev00 === 1854,
    1854,
    wirStrSummary?.rev00
  );

  test(
    'WIR-STR Further Revision count equals 280',
    wirStrSummary?.furtherRev === 280,
    280,
    wirStrSummary?.furtherRev
  );

  test(
    'WIR-INFRA does NOT exist in register intelligence summary',
    wirInfraSummary === undefined,
    'undefined (0 entries)',
    wirInfraSummary ? `${wirInfraSummary.workload} entries` : 'undefined'
  );

  test(
    'Grand Total Unique Items equals 1854',
    grandUnique === 1854,
    1854,
    grandUnique
  );

  test(
    'Grand Total Workload equals 2134',
    grandWorkload === 2134,
    2134,
    grandWorkload
  );

  const row751 = normalizedRows.find(r => r.docNo === 'INN-ARC-WIR-STR-00751');
  test(
    'Row 00751 has documentType === "WIR-STR"',
    row751?.documentType === 'WIR-STR',
    'WIR-STR',
    row751?.documentType
  );

  test(
    'Row 00751 has discipline === "Structural"',
    row751?.discipline === 'Structural',
    'Structural',
    row751?.discipline
  );

  test(
    'Row 00751 has trade === "Structural"',
    row751?.trade === 'Structural',
    'Structural',
    row751?.trade
  );

  test(
    'Row 00751 has isDisciplineLocked === true',
    row751?.isDisciplineLocked === true,
    true,
    row751?.isDisciplineLocked
  );

  test(
    'Row 00751 has disciplineEvidenceSource === "REGISTER_LOCK"',
    row751?.disciplineEvidenceSource === 'REGISTER_LOCK',
    'REGISTER_LOCK',
    row751?.disciplineEvidenceSource
  );

  console.log(`\n================================================================================`);
  console.log(`VERIFICATION RESULT: ${passed} passed, ${failed} failed.`);
  console.log(`================================================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runRealWorld1854Verification();
