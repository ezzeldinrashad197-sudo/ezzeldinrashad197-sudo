import { parseExcelFile, parseExcelBuffer } from "../src/utils/parser";
import { normalizeData } from "../src/utils/calculations";
import { classifyRegisterSheet, buildCompositeIdentity, getAuthoritativeSourceRegisterName } from "../src/utils/classificationEngine";
import { resolveOfficialSubmittalRegister, buildManagementReportOutput } from "../src/analytics/managementReportOutput";
import { generateDisciplineReconciliationReport } from "../src/analytics/reconciliationEngine";
import { resolveRowRegister as resolveRowRegisterPres } from "../src/Presentation";
import * as XLSX from "xlsx";

function createExcelWorkbookBuffer(sheets: { sheetName: string; rows: any[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
}

console.log("================================================================================");
console.log("  UNIVERSAL SOURCE IDENTITY RULE — VERIFICATION SUITE");
console.log("================================================================================");

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  \x1b[31m✘ FAIL\x1b[0m: ${testName}`);
    if (detail) console.error(`     Detail: ${detail}`);
    totalFailed++;
  }
}

const headers = [
  "Document Number",
  "Rev",
  "Discipline",
  "Submission Date",
  "Due Date",
  "Response Date",
  "Status",
  "Description",
  "Remarks"
];

// -----------------------------------------------------------------------------
// TEST CASE 1: GEN Register Sheet — Integration under Parent Register DOC
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 1: GEN / HSE — Integration of GEN Sheet under DOC Submittals] ---");

const genRows = [
  headers,
  ["GEN-001", "00", "HSE", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Site Safety Health & Environmental audit report", "HSE inspection passed"],
  ["GEN-002", "00", "GEN", "2026-08-02", "2026-08-11", "2026-08-09", "A", "General coordination meeting minutes", "All good"],
  ["GEN-003", "00", "HSE", "2026-08-03", "2026-08-12", "2026-08-10", "A", "HSE safety incident near-miss report", "Closed safety item"]
];

const genBuffer = createExcelWorkbookBuffer([{ sheetName: "GEN", rows: genRows }]);
const parsedGen = parseExcelBuffer(genBuffer, "Project_Registers.xlsx");
const normalizedGen = normalizeData(parsedGen);

assert(
  normalizedGen.length === 3,
  "All 3 rows parsed from GEN sheet"
);

assert(
  normalizedGen.every(r => r.registerIdentity === "DOC" || r.workflowFamily === "DOC"),
  "Final Register Classification treats GEN as nested inside DOC (not a rogue standalone register)",
  `Observed registerIdentities: ${normalizedGen.map(r => r.registerIdentity).join(", ")}`
);

const officialRegistersGen = normalizedGen.map(r => resolveOfficialSubmittalRegister(r));
assert(
  officialRegistersGen.every(reg => reg === "DOC-GENERAL"),
  "Rule: resolveOfficialSubmittalRegister resolves strictly to DOC-GENERAL (zero DOC-HSE or standalone HSE registers)",
  `Observed: ${officialRegistersGen.join(", ")}`
);

const genReport = buildManagementReportOutput(normalizedGen, normalizedGen, "ALL");
assert(
  genReport.availableParentRegisters.length === 1 && genReport.availableParentRegisters[0] === "DOC",
  "Management Report parent registers contains strictly 'DOC' (zero rogue standalone GEN registers)",
  `Observed parent registers: ${genReport.availableParentRegisters.join(", ")}`
);

// -----------------------------------------------------------------------------
// TEST CASE 1B: GEN Register Sheet inside DOC / Transmittal Workbook
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 1B: GEN / HSE inside DOC_Transmittals.xlsx — Parent Register DOC] ---");

const docGenBuffer = createExcelWorkbookBuffer([{ sheetName: "GEN", rows: genRows }]);
const parsedDocGen = parseExcelBuffer(docGenBuffer, "DOC_Transmittals_2026.xlsx");
const normalizedDocGen = normalizeData(parsedDocGen);

assert(
  normalizedDocGen.every(r => r.registerIdentity === "DOC" || r.workflowFamily === "DOC"),
  "Rule: GEN sheet inside DOC workbook preserved strictly as DOC parent register",
  `Observed types: ${normalizedDocGen.map(r => r.registerIdentity).join(", ")}`
);

const officialRegistersDocGen = normalizedDocGen.map(r => resolveOfficialSubmittalRegister(r));
assert(
  officialRegistersDocGen.every(reg => reg === "DOC-GENERAL"),
  "Rule: resolveOfficialSubmittalRegister resolves strictly to DOC-GENERAL for all rows under GEN sheet",
  `Observed: ${officialRegistersDocGen.join(", ")}`
);

const docGenReport = buildManagementReportOutput(normalizedDocGen, normalizedDocGen, "ALL");
assert(
  docGenReport.availableParentRegisters.length === 1 && docGenReport.availableParentRegisters[0] === "DOC",
  "Rule: Available parent registers strictly contains 'DOC' (zero leaked standalone GEN register)",
  `Observed parent registers: ${docGenReport.availableParentRegisters.join(", ")}`
);

// -----------------------------------------------------------------------------
// TEST CASE 1C: HSE Sheet in Project_Registers.xlsx — Parent Register DOC
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 1C: HSE Worksheet inside Project_Registers.xlsx — Parent Register DOC] ---");

const hseRows = [
  headers,
  ["HSE-001", "00", "HSE", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Site Safety Health & Environmental audit report", "HSE inspection passed"],
  ["HSE-002", "00", "SAFETY", "2026-08-02", "2026-08-11", "2026-08-09", "A", "Job site safety hazard mitigation submittal", "Approved"]
];

const hseBuffer = createExcelWorkbookBuffer([{ sheetName: "HSE", rows: hseRows }]);
const parsedHse = parseExcelBuffer(hseBuffer, "Project_Registers.xlsx");
const normalizedHse = normalizeData(parsedHse);

assert(
  normalizedHse.length === 2,
  "All 2 rows parsed from HSE sheet"
);

assert(
  normalizedHse.every(r => r.registerIdentity === "DOC" || r.workflowFamily === "DOC"),
  "Rule: HSE sheet inside generic workbook resolves to DOC parent register (never a rogue standalone HSE register)",
  `Observed types: ${normalizedHse.map(r => r.registerIdentity).join(", ")}`
);

const officialRegistersHse = normalizedHse.map(r => resolveOfficialSubmittalRegister(r));
assert(
  officialRegistersHse.every(reg => reg === "DOC-GENERAL"),
  "Rule: resolveOfficialSubmittalRegister resolves strictly to DOC-GENERAL (zero DOC-HSE or standalone HSE register)",
  `Observed: ${officialRegistersHse.join(", ")}`
);

const hseReport = buildManagementReportOutput(normalizedHse, normalizedHse, "ALL");
assert(
  hseReport.availableParentRegisters.length === 1 && hseReport.availableParentRegisters[0] === "DOC",
  "Rule: Management Report parent registers contains strictly 'DOC' (zero leaked standalone HSE register)",
  `Observed parent registers: ${hseReport.availableParentRegisters.join(", ")}`
);

// -----------------------------------------------------------------------------
// TEST CASE 1D: Compound Worksheet DOC-HSE — Parity Between Report & Presentation
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 1D: Compound Worksheet DOC-HSE — Strict DOC-GENERAL Parity] ---");

const docHseRows = [
  headers,
  ["DOC-HSE-001", "00", "HSE", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Health and Safety Audit Plan", "Approved"]
];

const docHseBuffer = createExcelWorkbookBuffer([{ sheetName: "DOC-HSE", rows: docHseRows }]);
const parsedDocHse = parseExcelBuffer(docHseBuffer, "Project_Registers.xlsx");
const normalizedDocHse = normalizeData(parsedDocHse);

assert(
  normalizedDocHse.length === 1,
  "All 1 row parsed from compound sheet DOC-HSE"
);

assert(
  normalizedDocHse.every(r => r.registerIdentity === "DOC-GENERAL" || r.workflowFamily === "DOC"),
  "Rule: Compound DOC-HSE sheet resolves canonically to DOC-GENERAL (family DOC)",
  `Observed registerIdentities: ${normalizedDocHse.map(r => r.registerIdentity).join(", ")}`
);

const officialRegistersDocHse = normalizedDocHse.map(r => resolveOfficialSubmittalRegister(r));
assert(
  officialRegistersDocHse.every(reg => reg === "DOC-GENERAL"),
  "Rule: resolveOfficialSubmittalRegister resolves strictly to DOC-GENERAL for compound DOC-HSE worksheet",
  `Observed: ${officialRegistersDocHse.join(", ")}`
);

const docHseReport = buildManagementReportOutput(normalizedDocHse, normalizedDocHse, "ALL");
assert(
  docHseReport.availableParentRegisters.length === 1 && docHseReport.availableParentRegisters[0] === "DOC",
  "Rule: Management Report availableParentRegisters strictly contains 'DOC'",
  `Observed: ${docHseReport.availableParentRegisters.join(", ")}`
);

// Full 146-row Reconciliation Audit: 1 DOC-HSE row + 145 DOC-GENERAL rows
const docGen145Rows = [headers];
for (let i = 1; i <= 145; i++) {
  const docIdx = i <= 122 ? i : (i - 122);
  const rev = i <= 122 ? "00" : "01";
  docGen145Rows.push([
    `DOC-GEN-${String(docIdx).padStart(4, "0")}`,
    rev,
    "General",
    "2026-08-01",
    "2026-08-10",
    "2026-08-08",
    "A",
    `General technical document ${docIdx}`,
    "Approved"
  ]);
}

const combinedBuffer = createExcelWorkbookBuffer([
  { sheetName: "DOC-HSE", rows: docHseRows },
  { sheetName: "DOC-GENERAL", rows: docGen145Rows }
]);
const parsedCombined = parseExcelBuffer(combinedBuffer, "Project_Registers.xlsx");
const normalizedCombined = normalizeData(parsedCombined);

assert(
  normalizedCombined.length === 146,
  "Rule: Combined dataset has exactly 146 rows (1 HSE + 145 GEN)"
);

const authenticHseRow = normalizedCombined.find(r => r.docNo === "DOC-HSE-001");
assert(
  authenticHseRow?.discipline === "HSE",
  "Rule: Authentic source row DOC-HSE-001 preserves raw discipline as 'HSE'",
  `Observed discipline: ${authenticHseRow?.discipline}`
);

assert(
  resolveOfficialSubmittalRegister(authenticHseRow!) === "DOC-GENERAL",
  "Rule: Authentic source row DOC-HSE-001 resolves canonical register as 'DOC-GENERAL'",
  `Observed: ${resolveOfficialSubmittalRegister(authenticHseRow!)}`
);

assert(
  resolveRowRegisterPres(authenticHseRow!) === "DOC-GENERAL",
  "Rule: Presentation resolveRowRegister resolves DOC-HSE-001 as 'DOC-GENERAL'",
  `Observed: ${resolveRowRegisterPres(authenticHseRow!)}`
);

const reconCombined = generateDisciplineReconciliationReport(normalizedCombined);
const docHseReconRecord = reconCombined.records.find(r => r.identityKey === "DOC-HSE");
assert(
  docHseReconRecord === undefined,
  "Rule: DOC-HSE independent register count = 0 in Reconciliation Report",
  `Found record: ${JSON.stringify(docHseReconRecord)}`
);

const docGenReconRecord = reconCombined.records.find(r => r.identityKey === "DOC-GENERAL");
assert(
  docGenReconRecord !== undefined && docGenReconRecord.grainA.totalRows === 146,
  "Rule: Historical Rows under DOC-GENERAL = 146 in Reconciliation Report",
  `Observed Historical Rows: ${docGenReconRecord?.grainA.totalRows}`
);

assert(
  docGenReconRecord !== undefined && docGenReconRecord.grainC.totalCurrentUnique === 123,
  "Rule: Current Unique under DOC-GENERAL = 123 in Reconciliation Report",
  `Observed Current Unique: ${docGenReconRecord?.grainC.totalCurrentUnique}`
);

assert(
  reconCombined.grandTotal.grainA.totalRows === 146 && reconCombined.grandTotal.grainC.totalCurrentUnique === 123,
  "Rule: Overall totals remain unchanged (146 rows = 123 unique + 23 superseded)",
  `Totals: ${reconCombined.grandTotal.grainA.totalRows} rows, ${reconCombined.grandTotal.grainC.totalCurrentUnique} unique`
);

// -----------------------------------------------------------------------------
// TEST CASE 2: STR Register with INFRA Content
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 2: STR / INFRA — Preservation of Authoritative STR Register] ---");

const strRows = [
  headers,
  ["STR-DWG-001", "00", "STR", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Structural Foundation Details", "Approved"],
  ["STR-DWG-002", "00", "INFRA", "2026-08-02", "2026-08-11", "2026-08-09", "A", "Deep sewer pipe infrastructure under slab", "Approved"]
];

const strBuffer = createExcelWorkbookBuffer([{ sheetName: "STR", rows: strRows }]);
const parsedStr = parseExcelBuffer(strBuffer, "Project_Registers.xlsx");
const normalizedStr = normalizeData(parsedStr);

assert(
  normalizedStr.every(r => r.documentType === "STR"),
  "Final Register Classification is strictly STR (no split to INFRA)",
  `Observed types: ${normalizedStr.map(r => r.documentType).join(", ")}`
);

// -----------------------------------------------------------------------------
// TEST CASE 3: ARC Register with INFRA Content
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 3: ARC / INFRA — Preservation of Authoritative ARC Register] ---");

const arcRows = [
  headers,
  ["ARC-001", "00", "ARC", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Architectural Façade", "Approved"],
  ["ARC-002", "00", "INFRA", "2026-08-02", "2026-08-11", "2026-08-09", "A", "Pedestrian walkway infrastructure", "Approved"]
];

const arcBuffer = createExcelWorkbookBuffer([{ sheetName: "ARC", rows: arcRows }]);
const parsedArc = parseExcelBuffer(arcBuffer, "Project_Registers.xlsx");
const normalizedArc = normalizeData(parsedArc);

assert(
  normalizedArc.every(r => r.documentType === "ARC"),
  "Final Register Classification is strictly ARC (no split to INFRA)",
  `Observed types: ${normalizedArc.map(r => r.documentType).join(", ")}`
);

// -----------------------------------------------------------------------------
// TEST CASE 4: WIR-STR and WIR-INFRA Separation
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 4: WIR-STR / WIR-INFRA — Preservation of Compound Register Names] ---");

const wirStrRows = [
  headers,
  ["WIR-STR-001", "00", "STR", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Column Rebar Inspection", "Approved"],
  ["WIR-STR-002", "00", "INFRA", "2026-08-02", "2026-08-11", "2026-08-09", "A", "Accidental Infrastructure Keyword", "Approved"]
];

const wirInfraRows = [
  headers,
  ["WIR-INF-001", "00", "INFRA", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Stormwater line inspection", "Approved"]
];

const multiBuffer = createExcelWorkbookBuffer([
  { sheetName: "WIR-STR", rows: wirStrRows },
  { sheetName: "WIR-INFRA", rows: wirInfraRows }
]);

const parsedMulti = parseExcelBuffer(multiBuffer, "Inspections.xlsx");
const normalizedMulti = normalizeData(parsedMulti);

const finalWirStr = normalizedMulti.filter(r => r.sourceRegisterIdentity === "WIR-STR");
const finalWirInfra = normalizedMulti.filter(r => r.sourceRegisterIdentity === "WIR-INFRA");

assert(
  finalWirStr.length === 2 && finalWirStr.every(r => r.documentType === "WIR-STR"),
  "WIR-STR rows all preserve WIR-STR documentType (zero leaking into WIR-INFRA)",
  `Observed: ${finalWirStr.map(r => r.documentType).join(", ")}`
);

assert(
  finalWirInfra.length === 1 && finalWirInfra[0].documentType === "WIR-INFRA",
  "WIR-INFRA sheet preserves WIR-INFRA documentType",
  `Observed: ${finalWirInfra[0]?.documentType}`
);

// -----------------------------------------------------------------------------
// TEST CASE 5: DOC-STR / DOC-ARC / DOC-MEC
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 5: DOC-STR / DOC-ARC / DOC-MEC Preservation] ---");

const docStrRows = [headers, ["DOC-STR-01", "00", "STR", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Structural Calculation", "Ok"]];
const docArcRows = [headers, ["DOC-ARC-01", "00", "ARC", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Architectural Spec", "Ok"]];
const docMecRows = [headers, ["DOC-MEC-01", "00", "MEC", "2026-08-01", "2026-08-10", "2026-08-08", "A", "HVAC Spec", "Ok"]];

const docBuffer = createExcelWorkbookBuffer([
  { sheetName: "DOC-STR", rows: docStrRows },
  { sheetName: "DOC-ARC", rows: docArcRows },
  { sheetName: "DOC-MEC", rows: docMecRows }
]);

const parsedDoc = parseExcelBuffer(docBuffer, "Documents.xlsx");
const normalizedDoc = normalizeData(parsedDoc);

assert(
  normalizedDoc.find(r => r.id.startsWith("DOC-STR"))?.documentType === "DOC-STR",
  "DOC-STR sheet preserved as DOC-STR (not generic DOC or DOC-GEN)"
);

assert(
  normalizedDoc.find(r => r.id.startsWith("DOC-ARC"))?.documentType === "DOC-ARC",
  "DOC-ARC sheet preserved as DOC-ARC"
);

assert(
  normalizedDoc.find(r => r.id.startsWith("DOC-MEC"))?.documentType === "DOC-MEC",
  "DOC-MEC sheet preserved as DOC-MEC"
);

// -----------------------------------------------------------------------------
// TEST CASE 6: Future / Custom Register (e.g. COMMISSIONING, QA-QC)
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 6: Future / Custom Arbitrary Register Names] ---");

const customRows = [headers, ["CX-001", "00", "GEN", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Testing and Commissioning", "Ok"]];
const customBuffer = createExcelWorkbookBuffer([{ sheetName: "COMMISSIONING", rows: customRows }]);
const parsedCustom = parseExcelBuffer(customBuffer, "Custom.xlsx");
const normalizedCustom = normalizeData(parsedCustom);

assert(
  normalizedCustom[0]?.documentType === "COMMISSIONING",
  "Custom register name 'COMMISSIONING' preserved identically without truncation or override",
  `Observed: ${normalizedCustom[0]?.documentType}`
);

// -----------------------------------------------------------------------------
// TEST CASE 7: Generic / Absent Sheet Name Fallback (Sheet1, Book1.xlsx)
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 7: Generic Sheet / File Graceful Inference Fallback] ---");

const genericRows = [
  headers,
  ["SDW-001", "00", "STR", "2026-08-01", "2026-08-10", "2026-08-08", "A", "Shop drawing structural steel", "Approved"]
];
const genericBuffer = createExcelWorkbookBuffer([{ sheetName: "Sheet1", rows: genericRows }]);
const parsedGeneric = parseExcelBuffer(genericBuffer, "Book1.xlsx");
const normalizedGeneric = normalizeData(parsedGeneric);

assert(
  parsedGeneric[0]?.hasAuthoritativeSourceIdentity === false,
  "Generic Sheet1 has hasAuthoritativeSourceIdentity === false (allows inference)"
);

assert(
  normalizedGeneric[0]?.documentType !== "SHEET1",
  "Generic Sheet1 correctly infers documentType instead of using 'SHEET1'",
  `Observed: ${normalizedGeneric[0]?.documentType}`
);

console.log("\n================================================================================");
console.log(`RESULTS: ${totalPassed} Passed, ${totalFailed} Failed.`);
console.log(`VERDICT: ${totalFailed === 0 ? "ALL UNIVERSAL SOURCE IDENTITY TESTS PASSED (100% INVARIANT)" : "TESTS FAILED"}`);
console.log("================================================================================");

if (totalFailed > 0) process.exit(1);
