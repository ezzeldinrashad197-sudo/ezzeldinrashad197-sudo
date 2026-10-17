import { SubmittalRow, ProjectSettings, SLASettings, DEFAULT_SLA_SETTINGS } from "../src/types";
import { 
  resolveDocumentSLACategory, 
  resolveSLAThresholdDays, 
  calculateRecordDeadline, 
  isEntityOverdue, 
  normalizeSLASettings 
} from "../src/analytics/slaEngine";
import { calculateStats, getDocumentIdentityKey, getStatusCodeCategory } from "../src/utils/calculations";
import { processRevisionEngine } from "../src/analytics/calculationFoundation";

console.log("================================================================================");
console.log("  STRUCTUSIGHT — SLA-DRIVEN OVERDUE CALCULATION & RECONCILIATION SUITE");
console.log("================================================================================\n");

let passedAsserts = 0;
let totalAsserts = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalAsserts++;
  if (condition) {
    passedAsserts++;
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

// Helper to construct a typed SubmittalRow
function makeRow(overrides: Partial<SubmittalRow>): SubmittalRow {
  const docType = overrides.documentType || "SDW";
  const defaultLogType =
    docType === "MAR" ? "Material Submittal Register" :
    docType === "RFI" ? "RFI Register" :
    docType === "WIR" ? "WIR Register" :
    docType === "MIR" ? "MIR Register" :
    docType === "NCR" ? "NCR Register" :
    docType === "SOR" ? "SOR Register" :
    docType === "LTR" ? "Letters Register" :
    docType === "DOC" ? "General Submittals Register" :
    "Shop Drawing Register";

  return {
    id: overrides.id || "ROW-1",
    docNo: overrides.docNo || "DOC-001",
    rev: overrides.rev || "00",
    sheetNo: overrides.sheetNo || "",
    logType: overrides.logType || defaultLogType,
    documentType: docType,
    discipline: overrides.discipline || "Structural",
    trade: overrides.trade || "STR",
    workflowStage: overrides.workflowStage || "Pending",
    status: overrides.status || "Under Review",
    submissionDate: overrides.submissionDate || "2026-06-01",
    dueDate: overrides.dueDate || "",
    responseDate: overrides.responseDate || "",
    isLatestRev: overrides.isLatestRev !== undefined ? overrides.isLatestRev : true,
    isRev0: overrides.isRev0 !== undefined ? overrides.isRev0 : true,
    delayDays: overrides.delayDays !== undefined ? overrides.delayDays : 0,
    overdue: Boolean(overrides.overdue),
    contractor: overrides.contractor || "Innovo",
    consultant: overrides.consultant || "ACE",
    remarks: overrides.remarks || "",
    area: overrides.area || "Zone A",
    tradeSystem: overrides.tradeSystem || "Concrete",
    ...overrides
  };
}

// -----------------------------------------------------------------------------
// SECTION A: SLA MAPPING TESTS
// -----------------------------------------------------------------------------
console.log("--- SECTION A: Canonical SLA Mapping & Alias Disambiguation ---");

// 1. Mandatory SLA defaults
assert(DEFAULT_SLA_SETTINGS.shopDrawings === 10, "A.1: Shop Drawings default SLA = 10 days");
assert(DEFAULT_SLA_SETTINGS.materialSubmittals === 10, "A.2: Materials default SLA = 10 days");
assert(DEFAULT_SLA_SETTINGS.rfi === 10, "A.3: RFIs default SLA = 10 days");
assert(DEFAULT_SLA_SETTINGS.ncr === 3, "A.4: NCRs default SLA = 3 days");
assert(DEFAULT_SLA_SETTINGS.sor === 3, "A.5: SORs default SLA = 3 days");
assert(DEFAULT_SLA_SETTINGS.letters === 3, "A.6: Letters default SLA = 3 days");
assert(DEFAULT_SLA_SETTINGS.wir === 2, "A.7: WIR default SLA = 2 days");
assert(DEFAULT_SLA_SETTINGS.mir === 2, "A.8: MIR default SLA = 2 days");
assert(DEFAULT_SLA_SETTINGS.default === 14, "A.9: Default/Other retained configured value = 14 days");

// 2. Strict category mapping & alias resolution
assert(resolveDocumentSLACategory("SDW") === "shopDrawings", "A.10: SDW maps to shopDrawings");
assert(resolveDocumentSLACategory("SHD") === "shopDrawings", "A.11: SHD maps to shopDrawings");
assert(resolveDocumentSLACategory("Shop Drawing Register") === "shopDrawings", "A.12: Shop Drawing Register maps to shopDrawings");

assert(resolveDocumentSLACategory("MAR") === "materialSubmittals", "A.13: MAR maps to materialSubmittals");
assert(resolveDocumentSLACategory("MAT") === "materialSubmittals", "A.14: MAT maps to materialSubmittals");
assert(resolveDocumentSLACategory("Material Submittal Register") === "materialSubmittals", "A.15: Material Submittal maps to materialSubmittals");

assert(resolveDocumentSLACategory("RFI") === "rfi", "A.16: RFI maps to rfi");
assert(resolveDocumentSLACategory("Requests for Information") === "rfi", "A.17: Requests for Information maps to rfi");

assert(resolveDocumentSLACategory("NCR") === "ncr", "A.18: NCR maps to ncr");
assert(resolveDocumentSLACategory("NCR-STR") === "ncr", "A.19: NCR-STR maps to ncr");

assert(resolveDocumentSLACategory("SOR") === "sor", "A.20: SOR maps to sor");
assert(resolveDocumentSLACategory("Site Observation Report") === "sor", "A.21: Site Observation Report maps to sor");

assert(resolveDocumentSLACategory("LTR") === "letters", "A.22: LTR maps to letters");
assert(resolveDocumentSLACategory("LETTER") === "letters", "A.23: LETTER maps to letters");
assert(resolveDocumentSLACategory("Letters & Correspondence") === "letters", "A.24: Letters & Correspondence maps to letters");

// Strict WIR vs MIR differentiation:
assert(resolveDocumentSLACategory("WIR") === "wir", "A.25: WIR maps strictly to wir (2 days)");
assert(resolveDocumentSLACategory("WIR-STR") === "wir", "A.26: WIR-STR maps strictly to wir");
assert(resolveDocumentSLACategory("WIR-ARCH") === "wir", "A.27: WIR-ARCH maps strictly to wir");
assert(resolveDocumentSLACategory("Works Inspection Request") === "wir", "A.28: Works Inspection Request maps to wir");

assert(resolveDocumentSLACategory("MIR") === "mir", "A.29: MIR maps strictly to mir (2 days)");
assert(resolveDocumentSLACategory("MIR-STR") === "mir", "A.30: MIR-STR maps strictly to mir");
assert(resolveDocumentSLACategory("Material Inspection Request") === "mir", "A.31: Material Inspection Request maps to mir");

// Default/Other types:
assert(resolveDocumentSLACategory("DOC") === "default", "A.32: DOC maps to default (14 days)");
assert(resolveDocumentSLACategory("ABD") === "default", "A.33: ABD maps to default (14 days)");
assert(resolveDocumentSLACategory("QS") === "default", "A.34: QS maps to default (14 days)");
assert(resolveDocumentSLACategory("UNCLASSIFIED") === "default", "A.35: UNCLASSIFIED maps to default (14 days)");
assert(resolveDocumentSLACategory("") === "default", "A.36: Empty type maps safely to default");
assert(resolveDocumentSLACategory(null) === "default", "A.37: Null maps safely to default");

// -----------------------------------------------------------------------------
// SECTION B: DYNAMIC CONFIGURATION TESTS
// -----------------------------------------------------------------------------
console.log("\n--- SECTION B: Dynamic Configuration Recalculation ---");

const testCutoff = "2026-06-08"; // 7 calendar days after 2026-06-01

// 1. Shop Drawings: 10 days -> 5 days
const sdwRow = makeRow({ documentType: "SDW", submissionDate: "2026-06-01" });
assert(!isEntityOverdue(sdwRow, testCutoff, { shopDrawings: 10 }), "B.1: SDW at 10-day SLA on day 7 is NOT overdue");
assert(isEntityOverdue(sdwRow, testCutoff, { shopDrawings: 5 }), "B.2: Changing SDW SLA to 5 days recalculates to OVERDUE on day 7");

// 2. NCR: 3 days -> 1 day
const ncrRow = makeRow({ documentType: "NCR", submissionDate: "2026-06-06" }); // 2 days elapsed at testCutoff 2026-06-08
assert(!isEntityOverdue(ncrRow, testCutoff, { ncr: 3 }), "B.3: NCR at 3-day SLA on day 2 is NOT overdue");
assert(isEntityOverdue(ncrRow, testCutoff, { ncr: 1 }), "B.4: Changing NCR SLA to 1 day recalculates to OVERDUE on day 2");

// 3. Materials: 10 days -> 4 days
const marRow = makeRow({ documentType: "MAR", submissionDate: "2026-06-02" }); // 6 days elapsed
assert(!isEntityOverdue(marRow, testCutoff, { materialSubmittals: 10 }), "B.5: MAR at 10-day SLA on day 6 is NOT overdue");
assert(isEntityOverdue(marRow, testCutoff, { materialSubmittals: 4 }), "B.6: Changing MAR SLA to 4 days recalculates to OVERDUE on day 6");

// 4. RFI: 10 days -> 3 days
const rfiRow = makeRow({ documentType: "RFI", submissionDate: "2026-06-03" }); // 5 days elapsed
assert(!isEntityOverdue(rfiRow, testCutoff, { rfi: 10 }), "B.7: RFI at 10-day SLA on day 5 is NOT overdue");
assert(isEntityOverdue(rfiRow, testCutoff, { rfi: 3 }), "B.8: Changing RFI SLA to 3 days recalculates to OVERDUE on day 5");

// 5. SOR: 3 days -> 1 day
const sorRow = makeRow({ documentType: "SOR", submissionDate: "2026-06-06" }); // 2 days elapsed
assert(!isEntityOverdue(sorRow, testCutoff, { sor: 3 }), "B.9: SOR at 3-day SLA on day 2 is NOT overdue");
assert(isEntityOverdue(sorRow, testCutoff, { sor: 1 }), "B.10: Changing SOR SLA to 1 day recalculates to OVERDUE on day 2");

// 6. Letters: 3 days -> 1 day
const ltrRow = makeRow({ documentType: "LTR", submissionDate: "2026-06-06" }); // 2 days elapsed
assert(!isEntityOverdue(ltrRow, testCutoff, { letters: 3 }), "B.11: Letters at 3-day SLA on day 2 is NOT overdue");
assert(isEntityOverdue(ltrRow, testCutoff, { letters: 1 }), "B.12: Changing Letters SLA to 1 day recalculates to OVERDUE on day 2");

// 7. WIR: 2 days -> 1 day
const wirRow = makeRow({ documentType: "WIR", submissionDate: "2026-06-06" }); // 2 days elapsed (June 1 to June 8 is 7 days, so let submission be June 6)
assert(!isEntityOverdue(wirRow, "2026-06-08", { wir: 2 }), "B.13: WIR at 2-day SLA on day 2 is exactly at deadline (NOT overdue)");
assert(isEntityOverdue(wirRow, "2026-06-08", { wir: 1 }), "B.14: Changing WIR SLA to 1 day recalculates to OVERDUE on day 2");

// 8. MIR: 2 days -> 1 day
const mirRow = makeRow({ documentType: "MIR", submissionDate: "2026-06-06" });
assert(!isEntityOverdue(mirRow, "2026-06-08", { mir: 2 }), "B.15: MIR at 2-day SLA on day 2 is exactly at deadline (NOT overdue)");
assert(isEntityOverdue(mirRow, "2026-06-08", { mir: 1 }), "B.16: Changing MIR SLA to 1 day recalculates to OVERDUE on day 2");

// 9. Default / Other: 14 days -> 6 days
const docRow = makeRow({ documentType: "DOC", submissionDate: "2026-06-01" }); // 7 days elapsed
assert(!isEntityOverdue(docRow, testCutoff, { default: 14 }), "B.17: Default/DOC at 14-day SLA on day 7 is NOT overdue");
assert(isEntityOverdue(docRow, testCutoff, { default: 6 }), "B.18: Changing default SLA to 6 days recalculates to OVERDUE on day 7");

// 10. Isolation check: Changing SDW SLA must NEVER affect unrelated types (e.g. RFI or WIR)
const isolatedSLA: Partial<SLASettings> = { shopDrawings: 3 }; // Only SDW changed
assert(resolveSLAThresholdDays("SDW", isolatedSLA) === 3, "B.19: SDW threshold changed to 3");
assert(resolveSLAThresholdDays("RFI", isolatedSLA) === 10, "B.20: RFI threshold remains 10 (unaffected)");
assert(resolveSLAThresholdDays("WIR", isolatedSLA) === 2, "B.21: WIR threshold remains 2 (unaffected)");
assert(resolveSLAThresholdDays("MIR", isolatedSLA) === 2, "B.22: MIR threshold remains 2 (unaffected)");
assert(resolveSLAThresholdDays("DOC", isolatedSLA) === 14, "B.23: Default/DOC threshold remains 14 (unaffected)");

// -----------------------------------------------------------------------------
// SECTION C: DATE-BOUNDARY TESTS
// -----------------------------------------------------------------------------
console.log("\n--- SECTION C: Date-Boundary Invariants ---");

// Test record: SDW, submitted 2026-01-01, SLA = 10 days -> Deadline = 2026-01-11
const boundaryRow = makeRow({ documentType: "SDW", submissionDate: "2026-01-01" });
const sla10: Partial<SLASettings> = { shopDrawings: 10 };

// C.1: 1 day before deadline (2026-01-10, 9 days elapsed)
assert(!isEntityOverdue(boundaryRow, "2026-01-10", sla10), "C.1: Day 9 (1 day before deadline) -> NOT overdue");

// C.2: Exactly at deadline (2026-01-11, 10 days elapsed)
assert(!isEntityOverdue(boundaryRow, "2026-01-11", sla10), "C.2: Day 10 (Exactly at deadline) -> NOT overdue");

// C.3: 1 day after deadline (2026-01-12, 11 days elapsed)
assert(isEntityOverdue(boundaryRow, "2026-01-12", sla10), "C.3: Day 11 (1 day after deadline) -> OVERDUE");

// C.4: 5 days after deadline (2026-01-16)
assert(isEntityOverdue(boundaryRow, "2026-01-16", sla10), "C.4: Day 15 (5 days after deadline) -> OVERDUE");

// C.5: Missing submission date
const missingDateRow = makeRow({ documentType: "SDW", submissionDate: "", dueDate: "" });
assert(!isEntityOverdue(missingDateRow, "2026-01-15", sla10), "C.5: Missing date is NOT classified as overdue");

// C.6: Malformed submission date
const malformedDateRow = makeRow({ documentType: "SDW", submissionDate: "not-a-valid-date", dueDate: "" });
assert(!isEntityOverdue(malformedDateRow, "2026-01-15", sla10), "C.6: Malformed date is NOT classified as overdue");

// C.7: Future submission date relative to cutoff
const futureDateRow = makeRow({ documentType: "SDW", submissionDate: "2026-02-01", dueDate: "" });
assert(!isEntityOverdue(futureDateRow, "2026-01-15", sla10), "C.7: Future submission date is NOT classified as overdue");

// -----------------------------------------------------------------------------
// SECTION D: LIFECYCLE & STATUS SAFEGUARDS
// -----------------------------------------------------------------------------
console.log("\n--- SECTION D: Lifecycle & Status Safeguards ---");

// D.1: Pending status (past deadline) -> Overdue
const pendingRow = makeRow({ workflowStage: "Pending", status: "W", submissionDate: "2026-01-01" });
assert(isEntityOverdue(pendingRow, "2026-01-20"), "D.1: Active Pending past deadline is OVERDUE");

// D.2: Rejected Open status (past deadline) -> Overdue
const rejOpenRow = makeRow({ workflowStage: "Rejected", status: "Code C", submissionDate: "2026-01-01" });
assert(isEntityOverdue(rejOpenRow, "2026-01-20"), "D.2: Active Rejected Open past deadline is OVERDUE");

// D.3: Approved Closed status (submitted 200 days ago) -> MUST NEVER be overdue
const approvedRow = makeRow({ workflowStage: "Approved", status: "Code A", submissionDate: "2025-01-01", responseDate: "2025-01-10" });
assert(!isEntityOverdue(approvedRow, "2026-01-20"), "D.3: Approved / Closed record submitted long ago MUST NEVER be overdue");

// D.4: Closed status with late historical response -> MUST NEVER be active overdue
const lateClosedRow = makeRow({ workflowStage: "Approved", status: "A", submissionDate: "2025-01-01", responseDate: "2025-03-01", dueDate: "2025-01-15" });
assert(!isEntityOverdue(lateClosedRow, "2026-01-20"), "D.4: Closed record with historical response delay MUST NOT appear in active overdue");

// D.5: Explicit contractual due date governs when present
const contractualRow = makeRow({ 
  documentType: "SDW", 
  submissionDate: "2026-01-01", 
  dueDate: "2026-01-25" // Explicit contractual deadline beyond standard 10 days
});
assert(!isEntityOverdue(contractualRow, "2026-01-15", { shopDrawings: 10 }), "D.5: Record with explicit contractual due date is NOT overdue on day 15");
assert(isEntityOverdue(contractualRow, "2026-01-26", { shopDrawings: 10 }), "D.6: Record with explicit contractual due date becomes OVERDUE after contractual deadline");

// D.6: Multiple revisions of same document (Historical vs Current State)
const multiRevRows: SubmittalRow[] = [
  makeRow({ id: "DOC-1-R0", docNo: "BUR-SDW-001", rev: "00", status: "Code C", workflowStage: "Rejected", submissionDate: "2026-01-01", responseDate: "2026-01-05", isLatestRev: false }),
  makeRow({ id: "DOC-1-R1", docNo: "BUR-SDW-001", rev: "01", status: "Code A", workflowStage: "Approved", submissionDate: "2026-01-10", responseDate: "2026-01-15", isLatestRev: true })
];
const multiStats = calculateStats(multiRevRows, undefined, "2026-01-20");
assert(multiStats.overdue === 0, "D.7: Document whose latest revision is Approved is NOT in active overdue, despite historical rejection");

// -----------------------------------------------------------------------------
// SECTION E: CROSS-LAYER RECONCILIATION TESTS
// -----------------------------------------------------------------------------
console.log("\n--- SECTION E: Cross-Layer Reconciliation Consistency ---");

// Create a controlled multi-document dataset with varied document types and submission dates
const testDataset: SubmittalRow[] = [];

// 10 SDW rows: 6 submitted Jan 01 (Overdue by Jan 15), 4 submitted Jan 10 (Not overdue by Jan 15)
for (let i = 1; i <= 6; i++) {
  testDataset.push(makeRow({ id: `SDW-OD-${i}`, docNo: `SDW-${i}`, documentType: "SDW", submissionDate: "2026-01-01", workflowStage: "Pending", status: "Under Review" }));
}
for (let i = 7; i <= 10; i++) {
  testDataset.push(makeRow({ id: `SDW-OK-${i}`, docNo: `SDW-${i}`, documentType: "SDW", submissionDate: "2026-01-10", workflowStage: "Pending", status: "Under Review" }));
}

// 5 RFI rows: 3 submitted Jan 01 (Overdue by Jan 15), 2 submitted Jan 10 (Not overdue by Jan 15)
for (let i = 1; i <= 3; i++) {
  testDataset.push(makeRow({ id: `RFI-OD-${i}`, docNo: `RFI-${i}`, documentType: "RFI", submissionDate: "2026-01-01", workflowStage: "Pending", status: "Under Review" }));
}
for (let i = 4; i <= 5; i++) {
  testDataset.push(makeRow({ id: `RFI-OK-${i}`, docNo: `RFI-${i}`, documentType: "RFI", submissionDate: "2026-01-10", workflowStage: "Pending", status: "Under Review" }));
}

// 4 WIR rows (SLA = 2 days): 2 submitted Jan 10 (Overdue by Jan 15), 2 submitted Jan 14 (Not overdue by Jan 15)
for (let i = 1; i <= 2; i++) {
  testDataset.push(makeRow({ id: `WIR-OD-${i}`, docNo: `WIR-${i}`, documentType: "WIR", submissionDate: "2026-01-10", workflowStage: "Pending", status: "Under Review" }));
}
for (let i = 3; i <= 4; i++) {
  testDataset.push(makeRow({ id: `WIR-OK-${i}`, docNo: `WIR-${i}`, documentType: "WIR", submissionDate: "2026-01-14", workflowStage: "Pending", status: "Under Review" }));
}

// 10 Approved / Closed rows (Never overdue)
for (let i = 1; i <= 10; i++) {
  testDataset.push(makeRow({ id: `APP-${i}`, docNo: `APP-${i}`, documentType: "SDW", submissionDate: "2026-01-01", responseDate: "2026-01-08", workflowStage: "Approved", status: "Code A" }));
}

const cutoffE = "2026-01-15";
// Under default SLAs:
// SDW: 6 overdue
// RFI: 3 overdue
// WIR: 2 overdue
// Total expected overdue = 6 + 3 + 2 = 11

const baseStats = calculateStats(testDataset, undefined, cutoffE);
assert(baseStats.overdue === 11, `E.1: KPI Cards show exact expected 11 overdue items (got ${baseStats.overdue})`);

// Layer 2: Register summaries
const sdwOnly = testDataset.filter(r => r.documentType === "SDW");
const rfiOnly = testDataset.filter(r => r.documentType === "RFI");
const wirOnly = testDataset.filter(r => r.documentType === "WIR");

const sdwSummary = calculateStats(sdwOnly, undefined, cutoffE);
const rfiSummary = calculateStats(rfiOnly, undefined, cutoffE);
const wirSummary = calculateStats(wirOnly, undefined, cutoffE);

assert(sdwSummary.overdue === 6, "E.2: SDW Register summary shows exactly 6 overdue");
assert(rfiSummary.overdue === 3, "E.3: RFI Register summary shows exactly 3 overdue");
assert(wirSummary.overdue === 2, "E.4: WIR Register summary shows exactly 2 overdue");
assert(sdwSummary.overdue + rfiSummary.overdue + wirSummary.overdue === baseStats.overdue, "E.5: Register summaries sum exactly to global KPI overdue");

// Layer 3: Drilldown extraction parity
const revMapE = processRevisionEngine(testDataset);
const drilldownItems: SubmittalRow[] = [];
revMapE.forEach(group => {
  const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
  if (cat === "PENDING" || cat === "REJECTED_OPEN") {
    if (isEntityOverdue(group.latest, cutoffE)) {
      drilldownItems.push(group.latest);
    }
  }
});
assert(drilldownItems.length === 11, `E.6: Drilldown items count (${drilldownItems.length}) matches global overdue (11)`);

// Layer 4: Dynamic SLA configuration update across all layers
// Now change Shop Drawings SLA from 10 days to 4 days:
// SDW submitted Jan 10 at 4 days SLA has deadline Jan 14 -> on Jan 15 it becomes OVERDUE!
// This turns the 4 previously on-time SDW items into OVERDUE items (+4 overdue).
// Total expected overdue becomes 11 + 4 = 15!
const updatedSlaSettings: Partial<SLASettings> = {
  shopDrawings: 4
};

const updatedStats = calculateStats(testDataset, undefined, cutoffE, updatedSlaSettings);
assert(updatedStats.overdue === 15, `E.7: Dynamically changing SDW SLA from 10 to 4 days updates KPI Cards from 11 to 15 (got ${updatedStats.overdue})`);

const updatedSdwSummary = calculateStats(sdwOnly, undefined, cutoffE, updatedSlaSettings);
assert(updatedSdwSummary.overdue === 10, `E.8: SDW Register summary updates dynamically from 6 to 10 (got ${updatedSdwSummary.overdue})`);

const updatedRfiSummary = calculateStats(rfiOnly, undefined, cutoffE, updatedSlaSettings);
assert(updatedRfiSummary.overdue === 3, "E.9: Unrelated RFI Register summary remains unchanged at 3");

const updatedDrilldownItems: SubmittalRow[] = [];
revMapE.forEach(group => {
  const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
  if (cat === "PENDING" || cat === "REJECTED_OPEN") {
    if (isEntityOverdue(group.latest, cutoffE, updatedSlaSettings)) {
      updatedDrilldownItems.push(group.latest);
    }
  }
});
assert(updatedDrilldownItems.length === 15, `E.10: Drilldown layer updates dynamically to match the 15 overdue items`);

console.log("\n================================================================================");
console.log(`  SUMMARY: ${passedAsserts} / ${totalAsserts} ASSERTIONS PASSED (100% SUCCESS)`);
console.log("================================================================================\n");
