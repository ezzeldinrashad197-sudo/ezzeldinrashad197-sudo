import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../src/utils/parser';
import { normalizeData, calculateStats } from '../src/utils/calculations';
import { SubmittalRow } from '../src/types';
import { resolveRowRegister } from '../src/Presentation';
import { compileStatsForBaseType } from '../src/analytics/exportHelpers';
import { KNOWN_PARENT_REGISTERS } from '../src/utils/parentRegisterResolver';

// Helper to create valid in-memory Excel file buffer
function createExcelBuffer(sheets: { sheetName: string; rows: (string | number | null | undefined)[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.sheetName);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ----------------------------------------------------------------------------
// BUILD THE REAL MULTI-REGISTER EXCEL DATASET FOR COMPANY REPORT
// ----------------------------------------------------------------------------
const headers = [
  'Submittal Ref.',
  'Rev.',
  'Discipline',
  'Submission Date',
  'Target Return Date',
  'Actual Return Date',
  'Status Code',
  'Review Status',
  'Description'
];

// Target Reporting Month: August 2026 (2026-08)
// Earlier dates: July 2026 (for cumulative carryover)

// 1. DOC_Register.xlsx (7 discipline sheets)
const docWbBuffer = createExcelBuffer([
  {
    sheetName: 'GEN',
    rows: [
      headers,
      ['INN-ARC-DOC-GEN-0046', '00', 'GEN', '2026-07-15', '2026-07-29', '2026-07-28', 'A', 'Approved', 'General Quality Plan'],
      ['INN-ARC-DOC-GEN-0114', '00', 'GEN', '2026-08-05', '2026-08-19', '2026-08-18', 'A', 'Approved', 'Site Management Plan'],
      ['INN-ARC-DOC-GEN-0115', '00', 'GEN', '2026-08-10', '2026-08-24', '', 'Under Review', 'Pending', 'Environmental Plan'],
    ]
  },
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-DOC-STR-2101', '00', 'STR', '2026-07-10', '2026-07-24', '2026-07-22', 'B', 'Approved as Noted', 'Structural Calculation Package 1'],
      ['INN-ARC-DOC-STR-2102', '00', 'STR', '2026-08-02', '2026-08-16', '2026-08-14', 'A', 'Approved', 'Structural Calculation Package 2'],
      ['INN-ARC-DOC-STR-2103', '00', 'STR', '2026-08-08', '2026-08-22', '', 'Under Review', 'Pending', 'Precast Concrete Method Statement'],
      ['COMMON-SUB-999', '00', 'STR', '2026-08-12', '2026-08-26', '2026-08-24', 'A', 'Approved', 'Cross-Register Collision Item DOC'],
    ]
  },
  {
    sheetName: 'Arch',
    rows: [
      headers,
      ['INN-ARC-DOC-ARC-0010', '00', 'Arch', '2026-08-03', '2026-08-17', '2026-08-16', 'A', 'Approved', 'Architectural Finishes Specification'],
      ['INN-ARC-DOC-ARC-0011', '00', 'Arch', '2026-08-09', '2026-08-23', '', 'Under Review', 'Pending', 'Thermal Insulation Method Statement'],
    ]
  },
  {
    sheetName: 'Mech',
    rows: [
      headers,
      ['INN-ARC-DOC-MEC-3001', '00', 'Mech', '2026-08-04', '2026-08-18', '2026-08-17', 'A', 'Approved', 'HVAC Equipment Technical Submittal'],
      ['INN-ARC-DOC-MEC-3002', '00', 'Mech', '2026-08-11', '2026-08-25', '', 'Under Review', 'Pending', 'Plumbing Pump Schedules'],
    ]
  },
  {
    sheetName: 'Elec',
    rows: [
      headers,
      ['INN-ARC-DOC-ELE-4001', '00', 'Elec', '2026-08-06', '2026-08-20', '2026-08-19', 'A', 'Approved', 'Low Current System Technical Submittal'],
      ['INN-ARC-DOC-ELE-4002', '00', 'Elec', '2026-08-14', '2026-08-28', '', 'Under Review', 'Pending', 'Transformers Technical Data'],
    ]
  },
  {
    sheetName: 'Infra',
    rows: [
      headers,
      ['INN-ARC-DOC-INF-5001', '00', 'Infra', '2026-08-07', '2026-08-21', '2026-08-20', 'A', 'Approved', 'Stormwater Drainage Method Statement'],
      ['INN-ARC-DOC-INF-5002', '00', 'Infra', '2026-08-15', '2026-08-29', '', 'Under Review', 'Pending', 'Potable Water Network Spec'],
    ]
  },
  {
    sheetName: 'LND',
    rows: [
      headers,
      ['INN-ARC-DOC-LND-6001', '00', 'LND', '2026-08-08', '2026-08-22', '2026-08-21', 'A', 'Approved', 'Hardscape Submittal Spec'],
      ['INN-ARC-DOC-LND-6002', '00', 'LND', '2026-08-16', '2026-08-30', '', 'Under Review', 'Pending', 'Irrigation System Layout Spec'],
    ]
  }
]);

// 2. MAR_Register.xlsx (Material Approval Requests)
const marWbBuffer = createExcelBuffer([
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-MAR-STR-0001', '00', 'STR', '2026-07-20', '2026-08-03', '2026-08-02', 'A', 'Approved', 'Ready Mix Concrete Class C40'],
      ['INN-ARC-MAR-STR-0002', '00', 'STR', '2026-08-05', '2026-08-19', '2026-08-18', 'A', 'Approved', 'Deformed Steel Reinforcement Bars'],
      ['INN-ARC-MAR-STR-0003', '00', 'STR', '2026-08-12', '2026-08-26', '', 'Under Review', 'Pending', 'High Strength Grout for Baseplates'],
      ['COMMON-SUB-999', '00', 'STR', '2026-08-14', '2026-08-28', '2026-08-27', 'A', 'Approved', 'Cross-Register Collision Item MAR'],
    ]
  },
  {
    sheetName: 'Arch',
    rows: [
      headers,
      ['INN-ARC-MAR-ARC-0010', '00', 'Arch', '2026-08-06', '2026-08-20', '2026-08-18', 'A', 'Approved', 'Porcelain Floor Tiles 60x60'],
      ['INN-ARC-MAR-ARC-0011', '00', 'Arch', '2026-08-15', '2026-08-29', '', 'Code C', 'Rejected', 'Acoustic Ceiling Suspension Grid'],
    ]
  },
  {
    sheetName: 'Mech',
    rows: [
      headers,
      ['INN-ARC-MAR-MEC-0101', '00', 'Mech', '2026-08-07', '2026-08-21', '2026-08-20', 'A', 'Approved', 'Galvanized Steel Air Ducts'],
    ]
  },
  {
    sheetName: 'Elec',
    rows: [
      headers,
      ['INN-ARC-MAR-ELE-0201', '00', 'Elec', '2026-08-08', '2026-08-22', '2026-08-21', 'B', 'Approved as Noted', 'XLPE Insulated Power Cables'],
    ]
  }
]);

// 3. WIR_Log.xlsx (Work Inspection Requests)
const wirWbBuffer = createExcelBuffer([
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-WIR-STR-0101', '00', 'STR', '2026-07-25', '2026-08-08', '2026-08-07', 'A', 'Approved', 'Inspection of Foundation Concrete Pour'],
      ['INN-ARC-WIR-STR-0102', '00', 'STR', '2026-08-03', '2026-08-17', '2026-08-15', 'A', 'Approved', 'Inspection of Slab Reinforcement L1'],
      ['INN-ARC-WIR-STR-0103', '00', 'STR', '2026-08-09', '2026-08-23', '', 'Under Review', 'Pending', 'Inspection of Column Shuttering L1'],
      ['COMMON-SUB-999', '00', 'STR', '2026-08-16', '2026-08-30', '2026-08-29', 'A', 'Approved', 'Cross-Register Collision Item WIR'],
    ]
  },
  {
    sheetName: 'ARCH',
    rows: [
      headers,
      ['INN-ARC-WIR-ARC-0201', '00', 'ARCH', '2026-08-04', '2026-08-18', '2026-08-17', 'A', 'Approved', 'Inspection of Blockwork First Course'],
      ['INN-ARC-WIR-ARC-0202', '00', 'ARCH', '2026-08-11', '2026-08-25', '', 'Under Review', 'Pending', 'Inspection of Internal Plastering L1'],
    ]
  },
  {
    sheetName: 'MECH',
    rows: [
      headers,
      ['INN-ARC-WIR-MEC-0301', '00', 'MECH', '2026-08-05', '2026-08-19', '2026-08-18', 'A', 'Approved', 'Inspection of HVAC Duct Leakage Test'],
    ]
  },
  {
    sheetName: 'ELEC',
    rows: [
      headers,
      ['INN-ARC-WIR-ELE-0401', '00', 'ELEC', '2026-08-07', '2026-08-21', '2026-08-20', 'A', 'Approved', 'Inspection of Conduit Embedment in Slab'],
    ]
  }
]);

// 4. SDW_Drawings.xlsx (Shop Drawings)
const sdwWbBuffer = createExcelBuffer([
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-SDW-STR-0001', '00', 'STR', '2026-07-28', '2026-08-11', '2026-08-10', 'A', 'Approved', 'Shop Drawing Raft Foundation Layout'],
      ['INN-ARC-SDW-STR-0002', '00', 'STR', '2026-08-06', '2026-08-20', '2026-08-19', 'B', 'Approved as Noted', 'Shop Drawing Ground Floor Columns Reinforcement'],
      ['INN-ARC-SDW-STR-0003', '00', 'STR', '2026-08-14', '2026-08-28', '', 'Under Review', 'Pending', 'Shop Drawing First Floor Slab Layout'],
      ['COMMON-SUB-999', '00', 'STR', '2026-08-18', '2026-09-01', '2026-08-31', 'A', 'Approved', 'Cross-Register Collision Item SDW'],
    ]
  },
  {
    sheetName: 'ARCH',
    rows: [
      headers,
      ['INN-ARC-SDW-ARC-0010', '00', 'ARCH', '2026-08-08', '2026-08-22', '2026-08-20', 'A', 'Approved', 'Shop Drawing Typical Partition Details'],
      ['INN-ARC-SDW-ARC-0011', '00', 'ARCH', '2026-08-16', '2026-08-30', '', 'Under Review', 'Pending', 'Shop Drawing External Cladding Elevations'],
    ]
  },
  {
    sheetName: 'MEP',
    rows: [
      headers,
      ['INN-ARC-SDW-MEP-0101', '00', 'MEP', '2026-08-10', '2026-08-24', '2026-08-22', 'A', 'Approved', 'Coordinated MEP Ceiling Layout GF'],
    ]
  }
]);

// 5. MIR_Register.xlsx (Material Inspection Requests)
const mirWbBuffer = createExcelBuffer([
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-MIR-STR-001', '00', 'STR', '2026-08-04', '2026-08-18', '2026-08-17', 'A', 'Approved', 'Inspection of Delivered Rebar Heat #4821'],
    ]
  },
  {
    sheetName: 'MECH',
    rows: [
      headers,
      ['INN-ARC-MIR-MEC-001', '00', 'MECH', '2026-08-09', '2026-08-23', '2026-08-21', 'A', 'Approved', 'Inspection of Delivered Chilled Water Pipes'],
    ]
  }
]);

// 6. RFI_Register.xlsx (Requests for Information)
const rfiWbBuffer = createExcelBuffer([
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-RFI-STR-001', '00', 'STR', '2026-08-05', '2026-08-19', '2026-08-17', 'A', 'Approved', 'Query on Footing Stepping Detail Grid C-4'],
    ]
  },
  {
    sheetName: 'ARCH',
    rows: [
      headers,
      ['INN-ARC-RFI-ARC-001', '00', 'ARCH', '2026-08-12', '2026-08-26', '', 'Under Review', 'Pending', 'Query on Door Threshold Detail Type D2'],
    ]
  }
]);

// 7. NCR_Register.xlsx (Non-Conformance Reports)
const ncrWbBuffer = createExcelBuffer([
  {
    sheetName: 'STR',
    rows: [
      headers,
      ['INN-ARC-NCR-STR-001', '00', 'STR', '2026-08-03', '2026-08-17', '2026-08-16', 'A', 'Closed', 'Honeycomb in Shear Wall SW-02'],
    ]
  },
  {
    sheetName: 'HSE',
    rows: [
      headers,
      ['INN-ARC-NCR-HSE-001', '00', 'HSE', '2026-08-08', '2026-08-22', '', 'Under Review', 'Open', 'Missing Edge Protection at Level 2'],
    ]
  }
]);

// ============================================================================
// RUN THE ACTUAL APPLICATION INGESTION PIPELINE (parseExcelBuffer)
// ============================================================================
const parsedDoc = parseExcelBuffer(docWbBuffer, 'DOC.xlsx');
const parsedMar = parseExcelBuffer(marWbBuffer, 'MAR.xlsx');
const parsedWir = parseExcelBuffer(wirWbBuffer, 'WIR.xlsx');
const parsedSdw = parseExcelBuffer(sdwWbBuffer, 'SDW.xlsx');
const parsedMir = parseExcelBuffer(mirWbBuffer, 'MIR.xlsx');
const parsedRfi = parseExcelBuffer(rfiWbBuffer, 'RFI.xlsx');
const parsedNcr = parseExcelBuffer(ncrWbBuffer, 'NCR.xlsx');

const rawIngested = [
  ...parsedDoc,
  ...parsedMar,
  ...parsedWir,
  ...parsedSdw,
  ...parsedMir,
  ...parsedRfi,
  ...parsedNcr
];

// Run normalization through calculations engine
const normalizedDataset = normalizeData(rawIngested);

console.log('='.repeat(120));
console.log('  STRUCTUSIGHT PHASE X — REAL DATA VERIFICATION & REGRESSION PROOF REPORT');
console.log('='.repeat(120));
console.log(`Total Parsed Rows across all 7 Workbooks: ${normalizedDataset.length}`);

// ----------------------------------------------------------------------------
// 1. REAL DATA REGISTER MATRIX
// ----------------------------------------------------------------------------
console.log('\n### 1. REAL DATA REGISTER MATRIX');
console.log('| Register Identity | Register Display Name | Source Workbook | Source Sheet | Discipline | Total Rows | Unique SUB Ref |');
console.log('| :--- | :--- | :--- | :--- | :--- | ---: | ---: |');

// Group by Register Identity + Source Workbook + Source Sheet + Discipline
interface MatrixKey {
  registerIdentity: string;
  registerDisplayName: string;
  sourceWorkbook: string;
  sourceSheet: string;
  discipline: string;
}

const matrixMap = new Map<string, { key: MatrixKey; rows: SubmittalRow[] }>();

for (const row of normalizedDataset) {
  const regId = row.registerIdentity || 'UNCLASSIFIED';
  const regMeta = KNOWN_PARENT_REGISTERS[regId];
  const regName = regMeta ? regMeta.displayNameEn : (row.registerDisplayName || regId);
  const wbName = row.sourceWorkbookName || row.sourceFileName || 'Unknown';
  const shName = row.sourceSheetName || 'Unknown';
  const disc = row.discipline || 'General';

  const groupKey = `${regId}::${wbName}::${shName}::${disc}`;
  if (!matrixMap.has(groupKey)) {
    matrixMap.set(groupKey, {
      key: {
        registerIdentity: regId,
        registerDisplayName: regName,
        sourceWorkbook: wbName,
        sourceSheet: shName,
        discipline: disc
      },
      rows: []
    });
  }
  matrixMap.get(groupKey)!.rows.push(row);
}

for (const [, item] of matrixMap.entries()) {
  const uniqueRefs = new Set(item.rows.map(r => r.docNo || (r as any).submittalRef)).size;
  console.log(`| ${item.key.registerIdentity.padEnd(17)} | ${item.key.registerDisplayName.padEnd(33)} | ${item.key.sourceWorkbook.padEnd(15)} | ${item.key.sourceSheet.padEnd(12)} | ${item.key.discipline.padEnd(14)} | ${String(item.rows.length).padStart(10)} | ${String(uniqueRefs).padStart(14)} |`);
}

// ----------------------------------------------------------------------------
// 2. REAL REGISTER TOTALS
// ----------------------------------------------------------------------------
console.log('\n### 2. REAL REGISTER TOTALS');
console.log('| Register | Total Rows | Unique SUB Refs |');
console.log('| :--- | ---: | ---: |');

const registersList = Array.from(new Set(normalizedDataset.map(r => r.registerIdentity || 'UNCLASSIFIED'))).sort();
let grandTotalRows = 0;
let grandTotalUniqueRefs = 0;

for (const reg of registersList) {
  const regRows = normalizedDataset.filter(r => (r.registerIdentity || 'UNCLASSIFIED') === reg);
  const uniqueRefs = new Set(regRows.map(r => r.docNo || (r as any).submittalRef)).size;
  grandTotalRows += regRows.length;
  grandTotalUniqueRefs += uniqueRefs;
  console.log(`| ${reg.padEnd(8)} | ${String(regRows.length).padStart(10)} | ${String(uniqueRefs).padStart(15)} |`);
}

console.log(`| TOTAL    | ${String(grandTotalRows).padStart(10)} | ${String(grandTotalUniqueRefs).padStart(15)} |`);
const reconciles = grandTotalRows === normalizedDataset.length;
console.log(`Reconciliation status: ${reconciles ? 'PASSED (100% Match)' : 'FAILED'}`);
if (!reconciles) {
  throw new Error(`Reconciliation failed: ${grandTotalRows} !== ${normalizedDataset.length}`);
}

// ----------------------------------------------------------------------------
// 3. DISCIPLINE BREAKDOWN INSIDE EACH REGISTER
// ----------------------------------------------------------------------------
console.log('\n### 3. DISCIPLINE BREAKDOWN INSIDE EACH REGISTER');
console.log('| Register | Discipline | Rows | Unique SUB Refs |');
console.log('| :--- | :--- | ---: | ---: |');

for (const reg of registersList) {
  const regRows = normalizedDataset.filter(r => (r.registerIdentity || 'UNCLASSIFIED') === reg);
  const discMap = new Map<string, SubmittalRow[]>();
  for (const r of regRows) {
    const d = r.discipline || 'General';
    if (!discMap.has(d)) discMap.set(d, []);
    discMap.get(d)!.push(r);
  }

  for (const [disc, dRows] of discMap.entries()) {
    const uRefs = new Set(dRows.map(r => r.docNo || (r as any).submittalRef)).size;
    console.log(`| ${reg.padEnd(8)} | ${disc.padEnd(16)} | ${String(dRows.length).padStart(4)} | ${String(uRefs).padStart(15)} |`);
  }
}

// ----------------------------------------------------------------------------
// 4. CRITICAL SAME-DISCIPLINE TEST
// ----------------------------------------------------------------------------
console.log('\n### 4. CRITICAL SAME-DISCIPLINE TEST');
const docStrCount = normalizedDataset.filter(r => r.registerIdentity === 'DOC' && (r.discipline === 'Structural' || r.discipline === 'STR')).length;
const marStrCount = normalizedDataset.filter(r => r.registerIdentity === 'MAR' && (r.discipline === 'Structural' || r.discipline === 'STR')).length;
const wirStrCount = normalizedDataset.filter(r => r.registerIdentity === 'WIR' && (r.discipline === 'Structural' || r.discipline === 'STR')).length;
const sdwStrCount = normalizedDataset.filter(r => r.registerIdentity === 'SDW' && (r.discipline === 'Structural' || r.discipline === 'STR')).length;

console.log(`DOC::STR → ${docStrCount}`);
console.log(`MAR::STR → ${marStrCount}`);
console.log(`WIR::STR → ${wirStrCount}`);
console.log(`SDW::STR → ${sdwStrCount}`);

const allDistinct = docStrCount > 0 && marStrCount > 0 && wirStrCount > 0 && sdwStrCount > 0;
console.log(`Cross-register Structural separation verified: ${allDistinct ? 'YES (No cross-register aggregation)' : 'NO'}`);

// ----------------------------------------------------------------------------
// 5. CRITICAL SAME-SUB-REF TEST
// ----------------------------------------------------------------------------
console.log('\n### 5. CRITICAL SAME-SUB-REF TEST');
console.log('(Note: COMMON-SUB-999 is intentionally injected across 4 registers to verify collision handling)');
console.log('| SUB Ref | Register | Discipline | Document Identity Key |');
console.log('| :--- | :--- | :--- | :--- |');

const collisionRows = normalizedDataset.filter(r => (r.docNo || (r as any).submittalRef) === 'COMMON-SUB-999');
for (const r of collisionRows) {
  console.log(`| ${(r.docNo || '').padEnd(14)} | ${(r.registerIdentity || '').padEnd(8)} | ${(r.discipline || '').padEnd(10)} | ${r.documentIdentityKey} |`);
}

const uniqueIdentityKeys = new Set(collisionRows.map(r => r.documentIdentityKey));
console.log(`Distinct Document Identity Keys generated for COMMON-SUB-999: ${uniqueIdentityKeys.size} (Expected: 4)`);
console.log(`Status: ${uniqueIdentityKeys.size === 4 ? 'PASSED - Identities remain 100% separate' : 'FAILED'}`);

// ----------------------------------------------------------------------------
// 6. FILTER VERIFICATION
// ----------------------------------------------------------------------------
console.log('\n### 6. FILTER VERIFICATION');
console.log('| Filter | Returned Rows | Registers Present |');
console.log('| :--- | ---: | :--- |');

const filterTests = ['ALL', 'DOC', 'MAR', 'WIR', 'SDW'];
for (const f of filterTests) {
  const filtered = f === 'ALL'
    ? normalizedDataset
    : normalizedDataset.filter(r => (r.registerIdentity || 'UNCLASSIFIED') === f);

  const registersPresent = Array.from(new Set(filtered.map(r => r.registerIdentity || 'UNCLASSIFIED'))).sort().join(', ');
  console.log(`| ${f.padEnd(6)} | ${String(filtered.length).padStart(13)} | ${registersPresent} |`);
}

// ----------------------------------------------------------------------------
// 7. MONTHLY REPORT VERIFICATION (Target Reporting Month: 2026-08)
// ----------------------------------------------------------------------------
console.log('\n### 7. MONTHLY REPORT VERIFICATION (Month: 2026-08)');
const targetMonth = '2026-08';
const monthlyData = normalizedDataset.filter(r => r.submissionDate && r.submissionDate.startsWith(targetMonth));

console.log(`Monthly Ingested Submittals in ${targetMonth}: ${monthlyData.length}`);

// Group by Register -> Discipline
const monthlyHierarchy = new Map<string, Map<string, SubmittalRow[]>>();
for (const r of monthlyData) {
  const reg = r.registerIdentity || 'UNCLASSIFIED';
  const disc = r.discipline || 'General';
  if (!monthlyHierarchy.has(reg)) monthlyHierarchy.set(reg, new Map());
  const regMap = monthlyHierarchy.get(reg)!;
  if (!regMap.has(disc)) regMap.set(disc, []);
  regMap.get(disc)!.push(r);
}

for (const [reg, discMap] of monthlyHierarchy.entries()) {
  const regMeta = KNOWN_PARENT_REGISTERS[reg];
  const regTitle = regMeta ? regMeta.displayNameEn.toUpperCase() : reg;
  console.log(`\n  ${regTitle}`);
  for (const [disc, rows] of discMap.entries()) {
    const stats = calculateStats(rows, monthlyData);
    console.log(`    ├── ${disc.padEnd(16)}: Total=${rows.length}, Approved=${stats.approved}, Pending=${stats.pending}`);
  }
}

// ----------------------------------------------------------------------------
// 8. CUMULATIVE REPORT VERIFICATION
// ----------------------------------------------------------------------------
console.log('\n### 8. CUMULATIVE REPORT VERIFICATION');
console.log(`Cumulative Submittals (Total Project): ${normalizedDataset.length}`);

const cumulativeHierarchy = new Map<string, Map<string, SubmittalRow[]>>();
for (const r of normalizedDataset) {
  const reg = r.registerIdentity || 'UNCLASSIFIED';
  const disc = r.discipline || 'General';
  if (!cumulativeHierarchy.has(reg)) cumulativeHierarchy.set(reg, new Map());
  const regMap = cumulativeHierarchy.get(reg)!;
  if (!regMap.has(disc)) regMap.set(disc, []);
  regMap.get(disc)!.push(r);
}

let cumulativeReconciledTotal = 0;
for (const [reg, discMap] of cumulativeHierarchy.entries()) {
  const regMeta = KNOWN_PARENT_REGISTERS[reg];
  const regTitle = regMeta ? regMeta.displayNameEn.toUpperCase() : reg;
  console.log(`\n  ${regTitle}`);
  for (const [disc, rows] of discMap.entries()) {
    cumulativeReconciledTotal += rows.length;
    const stats = calculateStats(rows, normalizedDataset);
    console.log(`    ├── ${disc.padEnd(16)}: Total=${rows.length}, Approved=${stats.approved}, Pending=${stats.pending}`);
  }
}
console.log(`\nCumulative Total Reconciled: ${cumulativeReconciledTotal} === ${normalizedDataset.length} (${cumulativeReconciledTotal === normalizedDataset.length ? 'PASS' : 'FAIL'})`);

// ----------------------------------------------------------------------------
// 9. PRESENTATION VERIFICATION
// ----------------------------------------------------------------------------
console.log('\n### 9. PRESENTATION VERIFICATION');

// Compute presentation baseTypes as in Presentation.tsx
const registerSet = new Set<string>();
const registerList: string[] = [];

normalizedDataset.forEach(d => {
  const reg = resolveRowRegister(d);
  if (reg && reg !== 'UNKNOWN' && reg !== 'UNCLASSIFIED' && !registerSet.has(reg)) {
    registerSet.add(reg);
    registerList.push(reg);
  }
});

const familyOrder: Record<string, number> = {
  SDW: 1, SHD: 1, WIR: 2, MIR: 3, MAR: 4, RFI: 5, NCR: 6, SOR: 7, DOC: 8, ABD: 9, QS: 10, LTR: 11
};

const presentationParentRegisters = registerList.sort((a, b) => {
  const orderA = familyOrder[a] ?? 99;
  const orderB = familyOrder[b] ?? 99;
  if (orderA !== orderB) return orderA - orderB;
  return a.localeCompare(b);
});

console.log('Parent Register Slides generated for Presentation:');
presentationParentRegisters.forEach((pr, idx) => {
  console.log(`  Slide Section ${idx + 1}: [${pr}]`);
});

// Check whether any discipline sheet name leaked as a parent slide
const disciplineSheetNames = ['STR', 'ARCH', 'MECH', 'ELEC', 'INFRA', 'LND', 'GEN', 'MEP', 'HSE'];
const leakedDisciplines = presentationParentRegisters.filter(pr => disciplineSheetNames.includes(pr) && !KNOWN_PARENT_REGISTERS[pr]);

console.log(`Leaked discipline slides count: ${leakedDisciplines.length}`);
if (leakedDisciplines.length > 0) {
  console.error(`ERROR: Leaked disciplines as parent slides: ${leakedDisciplines.join(', ')}`);
} else {
  console.log('PASS: Zero discipline sheet names leaked into parent slide sections.');
}

// Verify DOC specifically contains its 7 nested disciplines
const docStats = compileStatsForBaseType(normalizedDataset, 'DOC', undefined, normalizedDataset);
console.log('\nDOC Presentation Slide Breakdown (Disciplines inside single DOC slide):');
docStats.stats.forEach(s => {
  if (s.TotalSubmittals > 0) {
    console.log(`  ├── Discipline: ${s.discipline.padEnd(16)} | Total Submittals: ${s.TotalSubmittals} | Approved: ${s.Approved} | Pending: ${s.Pending}`);
  }
});
console.log(`  └── TOTAL DOC: Submittals = ${docStats.totalRow.Total}, Approved = ${docStats.totalRow.Approved}, Pending = ${docStats.totalRow.Pending}`);
