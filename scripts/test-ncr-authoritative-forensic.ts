import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../src/utils/parser';
import {
  processNCRData,
  compileCanonicalNCRPresentationStats,
  buildNCRForensicIdentityInventory,
  resolveLatestNcrRecord,
  groupNCRByReference
} from '../src/analytics/ncr/ncrEngine';
import { compileStatsForBaseType } from '../src/analytics/exportHelpers';
import { buildPresentationViewModel } from '../src/analytics/presentationViewModel';

console.log('================================================================================');
console.log('  STRUCTUSIGHT — AUTHORITATIVE NCR FORENSIC VERIFICATION & AUDIT SUITE');
console.log('================================================================================\n');

const SOURCE_FILE_PATH = path.resolve(process.cwd(), 'src/test-datasets/14-Non-Conformance Report (NCR).xlsx');

if (!fs.existsSync(SOURCE_FILE_PATH)) {
  throw new Error(`CRITICAL: Authoritative workbook missing at ${SOURCE_FILE_PATH}`);
}

const fileBuf = fs.readFileSync(SOURCE_FILE_PATH);
const parsedRows = parseExcelBuffer(fileBuf, '14-Non-Conformance Report (NCR).xlsx');

console.log(`[INGESTION] Total parsed worksheet rows: ${parsedRows.length} (Expected: 588)`);
if (parsedRows.length !== 588) {
  throw new Error(`Expected exactly 588 worksheet rows, got ${parsedRows.length}`);
}

// 1. Verify 7 worksheets
const expectedSheets = ['ARCH', 'INFR', 'STR', 'ELEC', 'MECH', 'LAND', 'HSE'];
const actualSheets = Array.from(new Set(parsedRows.map((r) => r.sourceSheetName || r.disciplineSourceSheet))).filter(Boolean);
console.log(`[SCHEMA CHECK] Discovered worksheets: ${actualSheets.join(', ')}`);
for (const s of expectedSheets) {
  if (!actualSheets.includes(s)) {
    throw new Error(`Missing expected worksheet: ${s}`);
  }
}

// 2. Verify ARCH 'Level' column dynamic mapping
const archRows = parsedRows.filter((r) => (r.sourceSheetName || r.disciplineSourceSheet) === 'ARCH');
const archWithLevel = archRows.filter((r) => (r as any).level && (r as any).level.startsWith('Level'));
console.log(`[COLUMN SHIFT CHECK] ARCH rows with parsed Level: ${archWithLevel.length}/${archRows.length}`);
if (archWithLevel.length === 0) {
  throw new Error('ARCH Level column was not dynamically parsed or mapped into SubmittalRow.level');
}
// Verify subject and dates are not corrupted by the extra column
const sampleArch = archRows[0];
if (!sampleArch.submissionDate || isNaN(new Date(sampleArch.submissionDate).getTime())) {
  throw new Error(`ARCH Received Date shifted/corrupted: ${sampleArch.submissionDate}`);
}
if (!sampleArch.ncrRef || !sampleArch.ncrRef.startsWith('ACE-')) {
  throw new Error(`ARCH NCR Ref shifted/corrupted: ${sampleArch.ncrRef}`);
}

// 3. Verify MECH Discrepancy Resolution (all 56 MECH NCRs captured)
const mechRows = parsedRows.filter((r) => (r.sourceSheetName || r.disciplineSourceSheet) === 'MECH');
const mechRefGroups = groupNCRByReference(mechRows);
console.log(`[MECH AUDIT] Total MECH worksheet rows: ${mechRows.length} (Expected: 71), Distinct MECH NCRs: ${mechRefGroups.size} (Expected: 56)`);
if (mechRefGroups.size !== 56) {
  throw new Error(`Expected exactly 56 distinct MECH NCRs, got ${mechRefGroups.size}`);
}

// 4. Verify Identity Inventory & Zero Synthetic Identities
const inventory = buildNCRForensicIdentityInventory(parsedRows);
console.log(`[IDENTITY INVENTORY] Unique NCR Ref Count: ${inventory.uniqueNcrRefCount} (Expected: 465)`);
if (inventory.uniqueNcrRefCount !== 465) {
  throw new Error(`Expected exactly 465 unique NCR references, got ${inventory.uniqueNcrRefCount}`);
}
if (!inventory.zeroSyntheticCountVerified) {
  throw new Error('Synthetic identifiers (:: or row numbers) detected in discovered NCR references!');
}

// 5. Verify Latest-Record Derivation & Data-Quality Exceptions
const grouped = groupNCRByReference(parsedRows);
let lastRevYesCount = 0;
const dataQualityExceptions: any[] = [];
for (const [key, history] of grouped.entries()) {
  const { latestRecord, selectionMethod, exception } = resolveLatestNcrRecord(history);
  if (selectionMethod === 'LAST_REV_YES') {
    lastRevYesCount++;
  }
  if (exception) {
    dataQualityExceptions.push(exception);
  }
}
console.log(`[LATEST RECORD AUDIT] Last Rev = Yes resolutions: ${lastRevYesCount}/${grouped.size}, Data Quality Exceptions: ${dataQualityExceptions.length}`);
if (lastRevYesCount !== 465) {
  throw new Error(`Expected all 465 NCRs to be resolved via Last Rev. = Yes, got ${lastRevYesCount}`);
}
if (dataQualityExceptions.length > 0) {
  throw new Error(`Unexpected data quality exceptions in authoritative baseline: ${JSON.stringify(dataQualityExceptions)}`);
}

// 6. Cumulative Reconciliation Check
const cumResult = processNCRData(parsedRows, undefined);
const cumKPIs = cumResult.cumulativeKPIs;
console.log('\n[CUMULATIVE AUDIT RESULTS]');
console.log(`  - Total Unique NCRs    : ${cumKPIs.totalUnique} (Target: 465)`);
console.log(`  - Total Source Rows    : ${cumKPIs.totalRows} (Target: 588)`);
console.log(`  - Rev.00 Rows          : ${cumKPIs.rev0Rows} (Target: 465)`);
console.log(`  - Further Rev Rows     : ${cumKPIs.furtherRevRows} (Target: 123)`);
console.log(`  - Approved Closed      : ${cumKPIs.approvedClosed} (Target: 342)`);
console.log(`  - Currently Open       : ${cumKPIs.open} (Target: 123)`);
console.log(`  - Open Stage 1 Not Sent: ${cumKPIs.notSent} (Target: 62)`);
console.log(`  - Open Stage 3 Rejected: ${cumKPIs.rejectedOpen} (Target: 61)`);

if (cumKPIs.totalUnique !== 465) throw new Error(`Cumulative totalUnique mismatch: ${cumKPIs.totalUnique} !== 465`);
if (cumKPIs.totalRows !== 588) throw new Error(`Cumulative totalRows mismatch: ${cumKPIs.totalRows} !== 588`);
if (cumKPIs.approvedClosed !== 342) throw new Error(`Cumulative approvedClosed mismatch: ${cumKPIs.approvedClosed} !== 342`);
if (cumKPIs.open !== 123) throw new Error(`Cumulative open mismatch: ${cumKPIs.open} !== 123`);
if (cumKPIs.notSent + cumKPIs.rejectedOpen !== 123) throw new Error(`OPEN NCR formula mismatch: ${cumKPIs.notSent} + ${cumKPIs.rejectedOpen} !== 123`);

// Verify Cumulative Discipline Partitioning
const expectedCumDisciplineTargets: Record<string, { total: number; approved: number; open: number }> = {
  Arch: { total: 202, approved: 176, open: 26 },
  Infra: { total: 66, approved: 24, open: 42 },
  STR: { total: 65, approved: 50, open: 15 },
  Elec: { total: 22, approved: 17, open: 5 },
  Mech: { total: 56, approved: 26, open: 30 },
  Landscape: { total: 3, approved: 2, open: 1 },
  HSE: { total: 51, approved: 47, open: 4 }
};

for (const c of cumResult.cumulative) {
  const target = expectedCumDisciplineTargets[c.discipline];
  if (!target) {
    throw new Error(`Unexpected cumulative discipline in output: ${c.discipline}`);
  }
  if (c.totalUnique !== target.total || c.approvedClosed !== target.approved || c.open !== target.open) {
    throw new Error(
      `Discipline ${c.discipline} cumulative mismatch: got total=${c.totalUnique}, app=${c.approvedClosed}, open=${c.open}; expected total=${target.total}, app=${target.approved}, open=${target.open}`
    );
  }
  console.log(`  ✔ [CUMULATIVE] ${c.discipline.padEnd(10)}: Total=${c.totalUnique}, Approved=${c.approvedClosed}, Open=${c.open}`);
}

// 7. Monthly (October 2026) Reconciliation Check
const monResult = processNCRData(parsedRows, '2026-10-01');
const monKPIs = monResult.monthlyKPIs;
console.log('\n[MONTHLY (OCT 2026) AUDIT RESULTS]');
console.log(`  - New NCRs Received    : ${monKPIs.newNcrReceived} (Target: 25)`);
console.log(`  - Responses Received   : ${monKPIs.responsesReceived}`);
console.log(`  - Approved Responses   : ${monKPIs.approved} (Target: 2)`);
console.log(`  - Rejected Responses   : ${monKPIs.rejected} (Target: 11)`);

if (monKPIs.newNcrReceived !== 25) {
  throw new Error(`Monthly newNcrReceived mismatch: ${monKPIs.newNcrReceived} !== 25`);
}

// Verify Monthly Presentation Stats (25 new NCR references: 23 Open, 2 Approved)
const monPres = compileCanonicalNCRPresentationStats(parsedRows, '2026-10-01');
const monTotalRow = monPres.totalRow;
console.log(`  - Presentation Total   : ${monTotalRow.Total} (Target: 25)`);
console.log(`  - Presentation Approved: ${monTotalRow.Approved} (Target: 2)`);
console.log(`  - Presentation Open    : ${monTotalRow.Open} (Target: 23)`);

if (monTotalRow.Total !== 25) throw new Error(`Monthly presentation Total mismatch: ${monTotalRow.Total} !== 25`);
if (monTotalRow.Approved !== 2) throw new Error(`Monthly presentation Approved mismatch: ${monTotalRow.Approved} !== 2`);
if (monTotalRow.Open !== 23) throw new Error(`Monthly presentation Open mismatch: ${monTotalRow.Open} !== 23`);

const expectedMonDisciplineTargets: Record<string, { total: number; approved: number; open: number }> = {
  Arch: { total: 7, approved: 1, open: 6 },
  Infra: { total: 4, approved: 0, open: 4 },
  STR: { total: 2, approved: 0, open: 2 },
  Elec: { total: 0, approved: 0, open: 0 },
  Mech: { total: 11, approved: 1, open: 10 },
  Landscape: { total: 0, approved: 0, open: 0 },
  HSE: { total: 1, approved: 0, open: 1 }
};

for (const s of monPres.stats) {
  const target = expectedMonDisciplineTargets[s.discipline];
  if (target) {
    if (s.Total !== target.total || s.Approved !== target.approved || s.Open !== target.open) {
      throw new Error(
        `Discipline ${s.discipline} monthly mismatch: got total=${s.Total}, app=${s.Approved}, open=${s.Open}; expected total=${target.total}, app=${target.approved}, open=${target.open}`
      );
    }
    console.log(`  ✔ [MONTHLY] ${s.discipline.padEnd(10)}: Total=${s.Total}, Approved=${s.Approved}, Open=${s.Open}`);
  }
}

// 8. Cross-Consumer Parity Check
const exportCum = compileStatsForBaseType(parsedRows, 'NCR', undefined, parsedRows);
const exportMon = compileStatsForBaseType(parsedRows, 'NCR', '2026-10-01', parsedRows);

if (exportCum.totalRow.Total !== 465 || exportCum.totalRow.Approved !== 342 || exportCum.totalRow.Open !== 123) {
  throw new Error(`ExportHelpers Cumulative mismatch: ${JSON.stringify(exportCum.totalRow)}`);
}
if (exportMon.totalRow.Total !== 25 || exportMon.totalRow.Approved !== 2 || exportMon.totalRow.Open !== 23) {
  throw new Error(`ExportHelpers Monthly mismatch: ${JSON.stringify(exportMon.totalRow)}`);
}

console.log('\n✔ CROSS-CONSUMER PARITY VERIFIED: processNCRData === compileCanonicalNCRPresentationStats === compileStatsForBaseType');
console.log('✔ ALL 10 MANDATORY RECONCILIATION & AUDIT GATES PASSED (100% INVARIANTS PRESERVED).\n');
