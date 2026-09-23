import * as XLSX from 'xlsx';

// ============================================================================
// CANONICAL PARENT REGISTER RESOLUTION SPECIFICATION
// ============================================================================

export interface RegisterMetadata {
  identity: string;       // e.g. 'DOC', 'MAR', 'WIR', 'SDW', 'MIR', 'RFI', 'NCR', 'SOR', 'LTR', 'ABD', 'QS'
  displayNameEn: string;  // e.g. 'Document Submittals (DOC)'
  displayNameAr: string;  // e.g. 'المستندات الفنية (DOC)'
  workflowFamily: string; // e.g. 'DOC'
}

export const KNOWN_PARENT_REGISTERS: Record<string, RegisterMetadata> = {
  DOC: {
    identity: 'DOC',
    displayNameEn: 'Document Submittals (DOC)',
    displayNameAr: 'سجل تقديم المستندات الفنية (DOC)',
    workflowFamily: 'DOC',
  },
  MAR: {
    identity: 'MAR',
    displayNameEn: 'Material Approval Requests (MAR)',
    displayNameAr: 'سجل اعتمادات المواد (MAR)',
    workflowFamily: 'MAR',
  },
  SDW: {
    identity: 'SDW',
    displayNameEn: 'Shop Drawings (SDW)',
    displayNameAr: 'سجل المخططات التنفيذية (SDW)',
    workflowFamily: 'SDW',
  },
  SHD: {
    identity: 'SDW',
    displayNameEn: 'Shop Drawings (SDW)',
    displayNameAr: 'سجل المخططات التنفيذية (SDW)',
    workflowFamily: 'SDW',
  },
  WIR: {
    identity: 'WIR',
    displayNameEn: 'Work Inspection Requests (WIR)',
    displayNameAr: 'سجل طلبات فحص واستلام الأعمال (WIR)',
    workflowFamily: 'WIR',
  },
  MIR: {
    identity: 'MIR',
    displayNameEn: 'Material Inspection Requests (MIR)',
    displayNameAr: 'سجل طلبات فحص المواد (MIR)',
    workflowFamily: 'MIR',
  },
  RFI: {
    identity: 'RFI',
    displayNameEn: 'Requests for Information (RFI)',
    displayNameAr: 'سجل طلبات الاستفسار والمعلومات (RFI)',
    workflowFamily: 'RFI',
  },
  NCR: {
    identity: 'NCR',
    displayNameEn: 'Non-Conformance Reports (NCR)',
    displayNameAr: 'سجل تقارير عدم المطابقة (NCR)',
    workflowFamily: 'NCR',
  },
  SOR: {
    identity: 'SOR',
    displayNameEn: 'Site Observation Reports (SOR)',
    displayNameAr: 'سجل ملاحظات الموقع والسلامة (SOR)',
    workflowFamily: 'SOR',
  },
  LTR: {
    identity: 'LTR',
    displayNameEn: 'Letters & Correspondence (LTR)',
    displayNameAr: 'سجل المراسلات والخطابات (LTR)',
    workflowFamily: 'LETTER',
  },
  ABD: {
    identity: 'ABD',
    displayNameEn: 'As-Built Drawings (ABD)',
    displayNameAr: 'سجل مخططات كما تم التنفيذ (ABD)',
    workflowFamily: 'ABD',
  },
  QS: {
    identity: 'QS',
    displayNameEn: 'Quantity Survey (QS)',
    displayNameAr: 'سجل حصر الكميات والمستخلصات (QS)',
    workflowFamily: 'QS',
  },
};

const DISCIPLINE_SHEET_NAMES = new Set([
  'GEN', 'GENERAL', 'GEN.', 'COMMON',
  'STR', 'STRUCT', 'STRUCTURAL', 'CIVIL', 'STRUCTURE',
  'ARC', 'ARCH', 'ARCHITECTURAL', 'ARCHITECTURE',
  'MEC', 'MECH', 'MECHANICAL', 'HVAC', 'PLUMBING',
  'ELE', 'ELEC', 'ELECTRICAL', 'LOW VOLTAGE',
  'INF', 'INFR', 'INFRA', 'INFRASTRUCTURE', 'UTILITIES', 'ROADS',
  'LND', 'LAND', 'LANDSCAPE', 'IRR', 'IRRIGATION',
  'SUR', 'SURV', 'SURVEY',
  'HSE', 'SAFETY',
  'MEP'
]);

export function isDisciplineSheet(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toUpperCase();
  return DISCIPLINE_SHEET_NAMES.has(clean);
}

export function normalizeDisciplineName(name: string): { normalized: string; code: string } {
  const clean = (name || '').trim().toUpperCase();
  if (['STR', 'STRUCT', 'STRUCTURAL', 'CIVIL', 'STRUCTURE'].includes(clean)) {
    return { normalized: 'Structural', code: 'STR' };
  }
  if (['ARC', 'ARCH', 'ARCHITECTURAL', 'ARCHITECTURE'].includes(clean)) {
    return { normalized: 'Architectural', code: 'ARCH' };
  }
  if (['MEC', 'MECH', 'MECHANICAL', 'HVAC', 'PLUMBING'].includes(clean)) {
    return { normalized: 'Mechanical', code: 'MECH' };
  }
  if (['ELE', 'ELEC', 'ELECTRICAL'].includes(clean)) {
    return { normalized: 'Electrical', code: 'ELEC' };
  }
  if (['INF', 'INFR', 'INFRA', 'INFRASTRUCTURE', 'UTILITIES', 'ROADS'].includes(clean)) {
    return { normalized: 'Infrastructure', code: 'INFRA' };
  }
  if (['LND', 'LAND', 'LANDSCAPE'].includes(clean)) {
    return { normalized: 'Landscape', code: 'LAND' };
  }
  if (['IRR', 'IRRIGATION'].includes(clean)) {
    return { normalized: 'Irrigation', code: 'IRR' };
  }
  if (['SUR', 'SURV', 'SURVEY'].includes(clean)) {
    return { normalized: 'Survey', code: 'SURV' };
  }
  if (['HSE', 'SAFETY'].includes(clean)) {
    return { normalized: 'HSE', code: 'HSE' };
  }
  if (['MEP'].includes(clean)) {
    return { normalized: 'MEP', code: 'MEP' };
  }
  return { normalized: 'General', code: 'GEN' };
}

/**
 * Resolves the parent register for a Workbook/File context.
 * Strict Precedence:
 * 1. Explicit metadata / user selection
 * 2. File/Workbook name register token (e.g. DOC_Register.xlsx -> DOC, WIR_Log -> WIR)
 * 3. Inspection of document references (SUB Refs) across sheets
 * 4. Compound sheet names (e.g. WIR-STR -> WIR)
 * 5. Return UNKNOWN / UNCLASSIFIED (NEVER default to SDW!)
 */
export function resolveParentRegister(params: {
  fileName: string;
  sheetNames: string[];
  sampleDocRefs?: string[];
  explicitRegister?: string;
}): RegisterMetadata {
  const { fileName, sheetNames, sampleDocRefs = [], explicitRegister } = params;

  // 1. Explicit register
  if (explicitRegister && KNOWN_PARENT_REGISTERS[explicitRegister.toUpperCase()]) {
    return KNOWN_PARENT_REGISTERS[explicitRegister.toUpperCase()];
  }

  // 2. File name token
  const cleanFileName = (fileName || '').replace(/\.[^/.]+$/, '').toUpperCase();
  const fileTokens = cleanFileName.split(/[-_ .()\\[\\]]+/);

  for (const token of fileTokens) {
    if (KNOWN_PARENT_REGISTERS[token]) {
      return KNOWN_PARENT_REGISTERS[token];
    }
  }

  // Check phrase matches in file name
  if (cleanFileName.includes('SHOP DRAWING') || cleanFileName.includes('SHOP-DRAWING')) return KNOWN_PARENT_REGISTERS['SDW'];
  if (cleanFileName.includes('AS-BUILT') || cleanFileName.includes('AS BUILT')) return KNOWN_PARENT_REGISTERS['ABD'];
  if (cleanFileName.includes('MATERIAL APPROVAL') || cleanFileName.includes('MATERIAL SUBMITTAL')) return KNOWN_PARENT_REGISTERS['MAR'];
  if (cleanFileName.includes('MATERIAL INSPECTION')) return KNOWN_PARENT_REGISTERS['MIR'];
  if (cleanFileName.includes('WORK INSPECTION') || cleanFileName.includes('SITE INSPECTION')) return KNOWN_PARENT_REGISTERS['WIR'];
  if (cleanFileName.includes('REQUEST FOR INFORMATION') || cleanFileName.includes('TECHNICAL QUERY')) return KNOWN_PARENT_REGISTERS['RFI'];
  if (cleanFileName.includes('NON CONFORMANCE') || cleanFileName.includes('NON-CONFORMANCE')) return KNOWN_PARENT_REGISTERS['NCR'];
  if (cleanFileName.includes('SITE OBSERVATION')) return KNOWN_PARENT_REGISTERS['SOR'];
  if (cleanFileName.includes('QUANTITY SURVEY')) return KNOWN_PARENT_REGISTERS['QS'];
  if (cleanFileName.includes('LETTER') || cleanFileName.includes('CORRESPONDENCE')) return KNOWN_PARENT_REGISTERS['LTR'];
  if (cleanFileName.includes('DOCUMENT') || cleanFileName.includes('DOCUMENTS') || cleanFileName.includes('TRANSMITTAL')) return KNOWN_PARENT_REGISTERS['DOC'];

  // 3. Inspect sample document references across the workbook
  if (sampleDocRefs.length > 0) {
    const hits: Record<string, number> = {
      DOC: 0, SDW: 0, MAR: 0, WIR: 0, MIR: 0, RFI: 0, NCR: 0, SOR: 0, ABD: 0, LTR: 0, QS: 0
    };
    for (const ref of sampleDocRefs) {
      const upperRef = ref.toUpperCase();
      if (/\b(?:DOC|TECHNICAL)\b|[-_]DOC[-_]/i.test(upperRef)) hits.DOC++;
      if (/\b(?:SDW|SHD|DWG)\b|[-_]SDW[-_]|[-_]SHD[-_]/i.test(upperRef)) hits.SDW++;
      if (/\bMAR\b|[-_]MAR[-_]/i.test(upperRef)) hits.MAR++;
      if (/\bWIR\b|[-_]WIR[-_]/i.test(upperRef)) hits.WIR++;
      if (/\bMIR\b|[-_]MIR[-_]/i.test(upperRef)) hits.MIR++;
      if (/\bRFI\b|[-_]RFI[-_]/i.test(upperRef)) hits.RFI++;
      if (/\bNCR\b|[-_]NCR[-_]/i.test(upperRef)) hits.NCR++;
      if (/\bSOR\b|[-_]SOR[-_]/i.test(upperRef)) hits.SOR++;
      if (/\bABD\b|[-_]ABD[-_]/i.test(upperRef)) hits.ABD++;
    }

    let topHit = '';
    let maxCount = 0;
    for (const [k, v] of Object.entries(hits)) {
      if (v > maxCount) {
        maxCount = v;
        topHit = k;
      }
    }
    if (topHit && maxCount >= 2 && KNOWN_PARENT_REGISTERS[topHit]) {
      return KNOWN_PARENT_REGISTERS[topHit];
    }
  }

  // 4. Inspect sheet names for compound register indicators (e.g. WIR-STR, DOC-GEN)
  for (const sName of sheetNames) {
    const upperSheet = sName.toUpperCase().trim();
    const parts = upperSheet.split(/[-_ ]+/);
    if (parts.length > 1 && KNOWN_PARENT_REGISTERS[parts[0]]) {
      return KNOWN_PARENT_REGISTERS[parts[0]];
    }
    if (KNOWN_PARENT_REGISTERS[upperSheet] && !isDisciplineSheet(upperSheet)) {
      return KNOWN_PARENT_REGISTERS[upperSheet];
    }
  }

  // 5. Default is UNKNOWN / UNCLASSIFIED (Absolute safety rule: NEVER default to SDW!)
  return {
    identity: 'UNCLASSIFIED',
    displayNameEn: 'Unclassified Register',
    displayNameAr: 'سجل غير مصنف',
    workflowFamily: 'UNKNOWN',
  };
}

// ============================================================================
// DIAGNOSTIC SUITE RUNNER
// ============================================================================

console.log('='.repeat(120));
console.log('  STRUCTUSIGHT — PARENT REGISTER vs DISCIPLINE GRAIN DIAGNOSTIC');
console.log('='.repeat(120));

interface MockWorkbook {
  fileName: string;
  sheets: {
    sheetName: string;
    sampleRefs: string[];
  }[];
}

const mockWorkbooks: MockWorkbook[] = [
  // Test 1: Real-world DOC workbook with 7 discipline sub-sheets
  {
    fileName: 'DOC_Register.xlsx',
    sheets: [
      { sheetName: 'GEN', sampleRefs: ['INN-ARC-DOC-GEN-0114', 'INN-ARC-DOC-GEN-0115'] },
      { sheetName: 'STR', sampleRefs: ['INN-ARC-DOC-STR-2102', 'INN-ARC-DOC-STR-2103'] },
      { sheetName: 'Arch', sampleRefs: ['INN-ARC-DOC-ARC-0010', 'INN-ARC-DOC-ARC-0011'] },
      { sheetName: 'Mech', sampleRefs: ['INN-ARC-DOC-MEC-3001', 'INN-ARC-DOC-MEC-3002'] },
      { sheetName: 'Elec', sampleRefs: ['INN-ARC-DOC-ELE-4001', 'INN-ARC-DOC-ELE-4002'] },
      { sheetName: 'Infra', sampleRefs: ['INN-ARC-DOC-INF-5001', 'INN-ARC-DOC-INF-5002'] },
      { sheetName: 'LND', sampleRefs: ['INN-ARC-DOC-LND-6001', 'INN-ARC-DOC-LND-6002'] },
    ]
  },
  // Test 2: MAR Register
  {
    fileName: 'MAR_Register.xlsx',
    sheets: [
      { sheetName: 'STR', sampleRefs: ['INN-ARC-MAR-STR-001', 'INN-ARC-MAR-STR-002'] },
      { sheetName: 'Arch', sampleRefs: ['INN-ARC-MAR-ARC-010', 'INN-ARC-MAR-ARC-011'] },
      { sheetName: 'Mech', sampleRefs: ['INN-ARC-MAR-MEC-101'] },
      { sheetName: 'Elec', sampleRefs: ['INN-ARC-MAR-ELE-201'] },
      { sheetName: 'Infra', sampleRefs: ['INN-ARC-MAR-INF-301'] },
      { sheetName: 'LND', sampleRefs: ['INN-ARC-MAR-LND-401'] },
    ]
  },
  // Test 3: WIR Register
  {
    fileName: 'WIR_Log.xlsx',
    sheets: [
      { sheetName: 'STR', sampleRefs: ['INN-ARC-WIR-STR-0101', 'INN-ARC-WIR-STR-0102'] },
      { sheetName: 'ARCH', sampleRefs: ['INN-ARC-WIR-ARC-0201', 'INN-ARC-WIR-ARC-0202'] },
      { sheetName: 'MECH', sampleRefs: ['INN-ARC-WIR-MEC-0301'] },
      { sheetName: 'ELEC', sampleRefs: ['INN-ARC-WIR-ELE-0401'] },
    ]
  },
  // Test 4: Shop Drawings Register
  {
    fileName: 'STS-P1.17_ShopDrawings_Master.xlsx',
    sheets: [
      { sheetName: 'STR', sampleRefs: ['INN-ARC-SDW-STR-0001', 'INN-ARC-SDW-STR-0002'] },
      { sheetName: 'ARCH', sampleRefs: ['INN-ARC-SDW-ARC-0010'] },
    ]
  },
  // Test 5: Generic file name, but sample refs clearly reveal DOC
  {
    fileName: 'Master_Submittals.xlsx',
    sheets: [
      { sheetName: 'GEN', sampleRefs: ['INN-ARC-DOC-GEN-0046', 'INN-ARC-DOC-GEN-0112'] },
      { sheetName: 'STR', sampleRefs: ['INN-ARC-DOC-STR-0500'] },
    ]
  },
  // Test 6: Unknown file with no patterns - MUST NEVER DEFAULT TO SDW!
  {
    fileName: 'Miscellaneous_Data.xlsx',
    sheets: [
      { sheetName: 'Sheet1', sampleRefs: ['XYZ-999', 'XYZ-1000'] }
    ]
  }
];

interface DiagnosticRow {
  sourceFile: string;
  sourceSheet: string;
  registerIdentity: string;
  registerDisplayName: string;
  workflowFamily: string;
  discipline: string;
  disciplineCode: string;
  subRef: string;
  documentIdentityKey: string;
}

const allDiagnosticRows: DiagnosticRow[] = [];

mockWorkbooks.forEach(wb => {
  const allWorkbookRefs = wb.sheets.flatMap(s => s.sampleRefs);
  const sheetNames = wb.sheets.map(s => s.sheetName);

  const parentReg = resolveParentRegister({
    fileName: wb.fileName,
    sheetNames,
    sampleDocRefs: allWorkbookRefs,
  });

  wb.sheets.forEach(sh => {
    // Discipline resolution for the sheet
    const discInfo = normalizeDisciplineName(sh.sheetName);

    sh.sampleRefs.forEach(subRef => {
      // Document Identity Key is register-scoped: ${registerIdentity}::${subRef}
      const documentIdentityKey = `${parentReg.identity}::${subRef}`;

      allDiagnosticRows.push({
        sourceFile: wb.fileName,
        sourceSheet: sh.sheetName,
        registerIdentity: parentReg.identity,
        registerDisplayName: parentReg.displayNameEn,
        workflowFamily: parentReg.workflowFamily,
        discipline: discInfo.normalized,
        disciplineCode: discInfo.code,
        subRef,
        documentIdentityKey
      });
    });
  });
});

console.log('\nDIAGNOSTIC MATRIX:\n');
console.log(
  'Source File'.padEnd(35) + ' | ' +
  'Sheet'.padEnd(7) + ' | ' +
  'Reg ID'.padEnd(8) + ' | ' +
  'Register Display Name'.padEnd(34) + ' | ' +
  'Workflow'.padEnd(9) + ' | ' +
  'Discipline'.padEnd(14) + ' | ' +
  'SUB Ref'.padEnd(23) + ' | ' +
  'Document Identity Key'
);
console.log('-'.repeat(165));

allDiagnosticRows.forEach(r => {
  console.log(
    r.sourceFile.padEnd(35) + ' | ' +
    r.sourceSheet.padEnd(7) + ' | ' +
    r.registerIdentity.padEnd(8) + ' | ' +
    r.registerDisplayName.padEnd(34) + ' | ' +
    r.workflowFamily.padEnd(9) + ' | ' +
    r.discipline.padEnd(14) + ' | ' +
    r.subRef.padEnd(23) + ' | ' +
    r.documentIdentityKey
  );
});

// ============================================================================
// AGGREGATION & REPORTING GRAIN SIMULATION
// ============================================================================
console.log('\n' + '='.repeat(120));
console.log('  REPORTING GRAIN VERIFICATION');
console.log('='.repeat(120));

// Level 1: Register Breakdown
const registers = Array.from(new Set(allDiagnosticRows.map(r => r.registerIdentity)));
console.log(`\nLEVEL 1 — REGISTER LEVEL (Count: ${registers.length}):`);
registers.forEach(regId => {
  const regRows = allDiagnosticRows.filter(r => r.registerIdentity === regId);
  const sample = regRows[0];
  console.log(`  📁 Register: [${regId}] ${sample.registerDisplayName} (Workload Rows: ${regRows.length})`);
  
  // Level 2: Discipline Breakdown INSIDE each Register
  const disciplines = Array.from(new Set(regRows.map(r => r.discipline)));
  console.log(`     └── Disciplines inside ${regId} (${disciplines.length}):`);
  disciplines.forEach(disc => {
    const discRows = regRows.filter(r => r.discipline === disc);
    const sheets = Array.from(new Set(discRows.map(r => r.sourceSheet))).join(', ');
    console.log(`         ├── Discipline: ${disc.padEnd(14)} (Sheets: [${sheets}], Items: ${discRows.length})`);
  });
});

// Invariant Assertions Check
console.log('\n' + '='.repeat(120));
console.log('  HARD INVARIANTS VALIDATION');
console.log('='.repeat(120));

let passCount = 0;
let failCount = 0;
function check(condition: boolean, name: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${name}`);
    passCount++;
  } else {
    console.error(`  \x1b[31m✘ FAIL\x1b[0m: ${name}`);
    failCount++;
  }
}

// 1. DOC_Register has 1 Parent Register = DOC, NOT 7 registers!
const docRegs = Array.from(new Set(allDiagnosticRows.filter(r => r.sourceFile === 'DOC_Register.xlsx').map(r => r.registerIdentity)));
check(docRegs.length === 1 && docRegs[0] === 'DOC', 'DOC_Register.xlsx resolves to exactly 1 Parent Register = DOC (NOT 7 registers)');

// 2. Sheets in DOC_Register are disciplines, not registers
const docDiscs = Array.from(new Set(allDiagnosticRows.filter(r => r.sourceFile === 'DOC_Register.xlsx').map(r => r.discipline)));
check(docDiscs.length === 7, 'DOC_Register.xlsx disciplines count is 7 (GEN, STR, Arch, Mech, Elec, Infra, Landscape)');

// 3. DOC must NEVER become SDW
const docAsSdw = allDiagnosticRows.filter(r => r.sourceFile.includes('DOC') && r.registerIdentity === 'SDW');
check(docAsSdw.length === 0, 'DOC submittals never become SDW or Shop Drawings');

// 4. Same SUB Ref across different registers does not collide in documentIdentityKey
const docStrKey = allDiagnosticRows.find(r => r.sourceFile === 'DOC_Register.xlsx' && r.subRef === 'INN-ARC-DOC-STR-2102')?.documentIdentityKey;
check(docStrKey === 'DOC::INN-ARC-DOC-STR-2102', 'Document identity key is strictly register-scoped: DOC::INN-ARC-DOC-STR-2102');

// 5. MAR has parent register MAR
const marRegs = Array.from(new Set(allDiagnosticRows.filter(r => r.sourceFile === 'MAR_Register.xlsx').map(r => r.registerIdentity)));
check(marRegs.length === 1 && marRegs[0] === 'MAR', 'MAR_Register.xlsx resolves to exactly 1 Parent Register = MAR');

// 6. Unknown file does not default to SDW
const unkRegs = allDiagnosticRows.filter(r => r.sourceFile === 'Miscellaneous_Data.xlsx');
check(unkRegs[0].registerIdentity === 'UNCLASSIFIED', 'Unknown workbook classifies as UNCLASSIFIED, never silently defaulting to SDW');

console.log(`\nDiagnostic Invariant Verification: ${passCount} Passed, ${failCount} Failed.\n`);
