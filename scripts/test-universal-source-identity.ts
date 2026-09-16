import { parseExcelFile, parseExcelBuffer } from "../src/utils/parser";
import { normalizeData } from "../src/utils/calculations";
import { classifyRegisterSheet, buildCompositeIdentity, getAuthoritativeSourceRegisterName } from "../src/utils/classificationEngine";
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
// TEST CASE 1: GEN Register with HSE Content
// -----------------------------------------------------------------------------
console.log("\n--- [CASE 1: GEN / HSE — Preservation of Authoritative GEN Register] ---");

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
  normalizedGen.every(r => r.documentType === "GEN"),
  "Final Register Classification is strictly GEN for ALL rows (no split to HSE or GEN-HSE)",
  `Observed types: ${normalizedGen.map(r => r.documentType).join(", ")}`
);

assert(
  normalizedGen.every(r => r.logType === "GEN"),
  "logType is preserved as GEN",
  `Observed logTypes: ${normalizedGen.map(r => r.logType).join(", ")}`
);

assert(
  normalizedGen[0].hasAuthoritativeSourceIdentity === true,
  "Row 1 carries hasAuthoritativeSourceIdentity === true"
);

assert(
  normalizedGen[0].sourceRegisterIdentity === "GEN",
  "Row 1 sourceRegisterIdentity is strictly 'GEN'"
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
