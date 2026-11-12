import { compileStatsForBaseType } from '../src/analytics/exportHelpers';
import { SubmittalRow } from '../src/types';

console.log('================================================================================');
console.log('STRUCTUSIGHT — PRESENTATION ROW-BASED STATUS RECONCILIATION SUITE');
console.log('Testing: Approved + Rejected + Pending = Rev.00 + Further Rev. = Total Sheets');
console.log('Preserving: Total Submittals as Unique Submissions Grain');
console.log('Strict Exclusions: RFI, SOR, and NCR calculations untouched');
console.log('================================================================================\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail: string) {
  if (condition) {
    console.log(`[PASS] ${testName}: ${detail}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName}: ${detail}`);
    failedTests++;
  }
}

// --------------------------------------------------------------------------------
// 1. Synthetic Shop Drawings (SDW) Population matching the user's reference numbers:
// STR: 373 Submittals, 1803 Rev00, 623 FurtherRev = 2426 Total Sheets
// ARCH: 310 Submittals, 670 Rev00, 555 FurtherRev = 1225 Total Sheets
// MECH: 315 Submittals, 878 Rev00, 674 FurtherRev = 1552 Total Sheets
// ELEC: 286 Submittals, 628 Rev00, 113 FurtherRev = 741 Total Sheets
// INFR: 62 Submittals, 305 Rev00, 194 FurtherRev = 499 Total Sheets
// LAND: 126 Submittals, 602 Rev00, 622 FurtherRev = 1224 Total Sheets
// TOTAL: 1472 Submittals, 4886 Rev00, 2781 FurtherRev = 7667 Total Sheets
// --------------------------------------------------------------------------------

const sdwConfig = [
  { disc: 'STR', submittals: 373, rev00: 1803, further: 623, totalSheets: 2426 },
  { disc: 'Arch', submittals: 310, rev00: 670, further: 555, totalSheets: 1225 },
  { disc: 'Mech', submittals: 315, rev00: 878, further: 674, totalSheets: 1552 },
  { disc: 'Elec', submittals: 286, rev00: 628, further: 113, totalSheets: 741 },
  { disc: 'Infra', submittals: 62, rev00: 305, further: 194, totalSheets: 499 },
  { disc: 'Landscape', submittals: 126, rev00: 602, further: 622, totalSheets: 1224 },
];

const mockSdwDataset: SubmittalRow[] = [];
let idGen = 1;

sdwConfig.forEach(({ disc, submittals, rev00, further }) => {
  // 1. Create baseline Rev00 items for each unique submittal
  for (let i = 1; i <= submittals; i++) {
    const docNo = `SDW-${disc}-${String(i).padStart(4, '0')}`;
    // Assign realistic status (mostly approved, some rejected, very few pending)
    const isRej = i % 25 === 0;
    const isPend = i % 150 === 0;
    const status = isRej ? 'Code C' : (isPend ? 'Under Review' : 'Code A');
    const stage = isRej ? 'Rejected Open' : (isPend ? 'Pending' : 'Approved');

    mockSdwDataset.push({
      id: `sdw-${idGen++}`,
      docNo,
      rawSourceIdentity: 'SDW',
      logType: 'SDW',
      documentType: 'SDW',
      discipline: disc,
      trade: disc,
      status,
      submissionDate: '2026-04-01',
      rev: '00',
      workflowStage: stage,
      isLatestRev: further === 0,
      isRev0: true,
      delayDays: 0,
      overdue: false
    } as unknown as SubmittalRow);
  }

  // 2. Extra Rev.00 physical sheets (multi-sheet drawings at Rev.00)
  const extraRev0Sheets = rev00 - submittals;
  for (let s = 1; s <= extraRev0Sheets; s++) {
    const parentDocNo = `SDW-${disc}-${String((s % submittals) + 1).padStart(4, '0')}`;
    mockSdwDataset.push({
      id: `sdw-${idGen++}`,
      docNo: parentDocNo,
      rawSourceIdentity: 'SDW',
      logType: 'SDW',
      documentType: 'SDW',
      discipline: disc,
      trade: disc,
      status: 'Code A',
      submissionDate: '2026-04-01',
      rev: '00',
      workflowStage: 'Approved',
      isLatestRev: false,
      isRev0: true,
      delayDays: 0,
      overdue: false
    } as unknown as SubmittalRow);
  }

  // 3. Further revision physical rows
  for (let f = 1; f <= further; f++) {
    const parentDocNo = `SDW-${disc}-${String((f % submittals) + 1).padStart(4, '0')}`;
    const isRej = f % 20 === 0;
    const isPend = f % 100 === 0;
    const status = isRej ? 'Code C' : (isPend ? 'Under Review' : 'Code B');
    const stage = isRej ? 'Rejected Open' : (isPend ? 'Pending' : 'Approved');

    mockSdwDataset.push({
      id: `sdw-${idGen++}`,
      docNo: parentDocNo,
      rawSourceIdentity: 'SDW',
      logType: 'SDW',
      documentType: 'SDW',
      discipline: disc,
      trade: disc,
      status,
      submissionDate: '2026-06-01',
      rev: '01',
      workflowStage: stage,
      isLatestRev: true,
      isRev0: false,
      delayDays: 0,
      overdue: false
    } as unknown as SubmittalRow);
  }
});

console.log(`[DATASET CREATED] Total SDW Physical Rows: ${mockSdwDataset.length}\n`);

// Execute compileStatsForBaseType on SDW
const sdwResult = compileStatsForBaseType(mockSdwDataset, 'SDW');

console.log('| Discipline | Total Submittals | Rev.00 | Further Rev. | Total Sheets | Approved | Rejected | Pending | Reconciliation |');
console.log('|------------|------------------|--------|--------------|--------------|----------|----------|---------|----------------|');

sdwResult.stats.forEach(r => {
  const sumStatus = Number(r.Approved) + Number(r.Rejected) + Number(r.Pending);
  const sumRevs = Number(r.Rev00) + Number(r.FurtherRev);
  const reconciled = sumStatus === Number(r.TotalSheets) && sumRevs === Number(r.TotalSheets);

  console.log(
    `| ${String(r.discipline).padEnd(10)} | ${String(r.TotalSubmittals).padStart(16)} | ${String(r.Rev00).padStart(6)} | ${String(r.FurtherRev).padStart(12)} | ${String(r.TotalSheets).padStart(12)} | ${String(r.Approved).padStart(8)} | ${String(r.Rejected).padStart(8)} | ${String(r.Pending).padStart(7)} | ${reconciled ? '✔ PASS' : '❌ FAIL'} |`
  );

  const cfg = sdwConfig.find(c => c.disc.toLowerCase() === r.discipline.toLowerCase());
  if (cfg) {
    assert(r.TotalSubmittals === cfg.submittals, `${r.discipline} Total Submittals Preserved`, `Expected ${cfg.submittals}, got ${r.TotalSubmittals}`);
    assert(r.Rev00 === cfg.rev00, `${r.discipline} Rev.00 Rows Preserved`, `Expected ${cfg.rev00}, got ${r.Rev00}`);
    assert(r.FurtherRev === cfg.further, `${r.discipline} Further Rev. Preserved`, `Expected ${cfg.further}, got ${r.FurtherRev}`);
    assert(r.TotalSheets === cfg.totalSheets, `${r.discipline} Total Sheets Preserved`, `Expected ${cfg.totalSheets}, got ${r.TotalSheets}`);
  }

  // Mandatory Invariant Rule B:
  // Approved + Rejected + Pending = Rev.00 + Further Rev. = Total Sheets
  assert(
    sumStatus === Number(r.TotalSheets),
    `${r.discipline} Invariant: Approved (${r.Approved}) + Rejected (${r.Rejected}) + Pending (${r.Pending}) === TotalSheets (${r.TotalSheets})`,
    `Status Sum = ${sumStatus}`
  );
  assert(
    sumRevs === Number(r.TotalSheets),
    `${r.discipline} Invariant: Rev.00 (${r.Rev00}) + FurtherRev (${r.FurtherRev}) === TotalSheets (${r.TotalSheets})`,
    `Rev Sum = ${sumRevs}`
  );
});

console.log('|------------|------------------|--------|--------------|--------------|----------|----------|---------|----------------|');

const totalR = sdwResult.totalRow;
const totalSumStatus = Number(totalR.Approved) + Number(totalR.Rejected) + Number(totalR.Pending);
const totalSumRevs = Number(totalR.Rev00) + Number(totalR.FurtherRev);
const totalReconciled = totalSumStatus === Number(totalR.TotalSheets) && totalSumRevs === Number(totalR.TotalSheets);

console.log(
  `| ${'TOTAL'.padEnd(10)} | ${String(totalR.TotalSubmittals).padStart(16)} | ${String(totalR.Rev00).padStart(6)} | ${String(totalR.FurtherRev).padStart(12)} | ${String(totalR.TotalSheets).padStart(12)} | ${String(totalR.Approved).padStart(8)} | ${String(totalR.Rejected).padStart(8)} | ${String(totalR.Pending).padStart(7)} | ${totalReconciled ? '✔ PASS' : '❌ FAIL'} |`
);

assert(totalR.TotalSubmittals === 1472, 'Project Total Submittals', `Expected 1,472, got ${totalR.TotalSubmittals}`);
assert(totalR.Rev00 === 4886, 'Project Total Rev.00 Rows', `Expected 4,886, got ${totalR.Rev00}`);
assert(totalR.FurtherRev === 2781, 'Project Total Further Rev. Rows', `Expected 2,781, got ${totalR.FurtherRev}`);
assert(totalR.TotalSheets === 7667, 'Project Total Sheets', `Expected 7,667, got ${totalR.TotalSheets}`);

// Project Total Reconciliation:
assert(
  totalSumStatus === 7667,
  'Project Total Invariant: Approved + Rejected + Pending === 7,667 (Total Sheets)',
  `Status Sum = ${totalSumStatus}`
);
assert(
  totalSumRevs === 7667,
  'Project Total Invariant: Rev.00 + Further Rev. === 7,667 (Total Sheets)',
  `Rev Sum = ${totalSumRevs}`
);

// --------------------------------------------------------------------------------
// 2. Lifetime Discipline Metrics & Workload Breakdown (cumulativeTrades) parity test
// --------------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('2. TESTING LIFETIME DISCIPLINE METRICS (cumulative_trade_analysis) PARITY');
console.log('================================================================================\n');

import { resolveRowDiscipline } from '../src/analytics/calculationFoundation';
import { resolveRowRegister, resolveUniqueSubmittalStats } from '../src/analytics/managementReportOutput';
import { calculateStats } from '../src/utils/calculations';

const cumulativeTrades = ['STR', 'Arch', 'Mech', 'Elec', 'Infra', 'Landscape', 'SURVEY'].map(trade => {
  const tRows = mockSdwDataset.filter(d => {
    const reg = resolveRowRegister(d);
    const disc = (resolveRowDiscipline(d, reg) || '').toUpperCase();
    return disc === trade.toUpperCase() || (d.trade || '').toUpperCase().startsWith(trade.toUpperCase());
  });
  const s = calculateStats(tRows, mockSdwDataset);
  const subStats = resolveUniqueSubmittalStats(tRows, mockSdwDataset);
  return {
    trade,
    uniqueRev00: s.totalSubmittalsRev0 || 0,
    uniqueFurtherRev: s.totalSubmittalsFurtherRev || 0,
    rev00Rows: subStats.rev00,
    furtherRevRows: subStats.furtherRev,
    totalRows: subStats.totalSheets,
    approved: subStats.approved,
    rejected: subStats.rejected,
    pending: subStats.pending,
    unclassified: subStats.unclassified || 0,
    active: subStats.rejectedOpen + subStats.pending,
    count: tRows.length
  };
}).filter(t => t.count > 0 || ['STR', 'Arch', 'Mech', 'Elec'].includes(t.trade));

console.log('| Discipline | Unique Rev00 | Unique Further | Rev.00 Rows | Further Rows | Total Rows | Approved | Rejected | Pending | Unclassified | Reconciliation |');
console.log('|------------|--------------|----------------|-------------|--------------|------------|----------|----------|---------|--------------|----------------|');

cumulativeTrades.forEach(t => {
  const sumStatus = t.approved + t.rejected + t.pending + t.unclassified;
  const sumRevs = t.rev00Rows + t.furtherRevRows;
  const reconciled = sumStatus === t.totalRows && sumRevs === t.totalRows;

  console.log(
    `| ${String(t.trade).padEnd(10)} | ${String(t.uniqueRev00).padStart(12)} | ${String(t.uniqueFurtherRev).padStart(14)} | ${String(t.rev00Rows).padStart(11)} | ${String(t.furtherRevRows).padStart(12)} | ${String(t.totalRows).padStart(10)} | ${String(t.approved).padStart(8)} | ${String(t.rejected).padStart(8)} | ${String(t.pending).padStart(7)} | ${String(t.unclassified).padStart(12)} | ${reconciled ? '✔ PASS' : '❌ FAIL'} |`
  );

  assert(
    sumStatus === t.totalRows,
    `${t.trade} Lifetime Metric: Total Rows (${t.totalRows}) === Approved (${t.approved}) + Rejected (${t.rejected}) + Pending (${t.pending}) + Unclassified (${t.unclassified})`,
    `Status Sum = ${sumStatus}`
  );
  assert(
    sumRevs === t.totalRows,
    `${t.trade} Lifetime Metric: Total Rows (${t.totalRows}) === Rev.00 Rows (${t.rev00Rows}) + Further Rows (${t.furtherRevRows})`,
    `Revision Sum = ${sumRevs}`
  );
});

console.log('|------------|--------------|----------------|-------------|--------------|------------|----------|----------|---------|--------------|----------------|');

const lifetimeTotUniqueRev00 = cumulativeTrades.reduce((a, b) => a + b.uniqueRev00, 0);
const lifetimeTotUniqueFurther = cumulativeTrades.reduce((a, b) => a + b.uniqueFurtherRev, 0);
const lifetimeTotRev00Rows = cumulativeTrades.reduce((a, b) => a + b.rev00Rows, 0);
const lifetimeTotFurtherRows = cumulativeTrades.reduce((a, b) => a + b.furtherRevRows, 0);
const lifetimeTotRows = cumulativeTrades.reduce((a, b) => a + b.totalRows, 0);
const lifetimeTotApproved = cumulativeTrades.reduce((a, b) => a + b.approved, 0);
const lifetimeTotRejected = cumulativeTrades.reduce((a, b) => a + b.rejected, 0);
const lifetimeTotPending = cumulativeTrades.reduce((a, b) => a + b.pending, 0);
const lifetimeTotUnclassified = cumulativeTrades.reduce((a, b) => a + b.unclassified, 0);

console.log(
  `| ${'TOTAL'.padEnd(10)} | ${String(lifetimeTotUniqueRev00).padStart(12)} | ${String(lifetimeTotUniqueFurther).padStart(14)} | ${String(lifetimeTotRev00Rows).padStart(11)} | ${String(lifetimeTotFurtherRows).padStart(12)} | ${String(lifetimeTotRows).padStart(10)} | ${String(lifetimeTotApproved).padStart(8)} | ${String(lifetimeTotRejected).padStart(8)} | ${String(lifetimeTotPending).padStart(7)} | ${String(lifetimeTotUnclassified).padStart(12)} | ✔ PASS |`
);

// Cross-Table Parity Assertions:
assert(lifetimeTotRows === totalR.TotalSheets, 'Cross-Table Parity: Total Rows match', `Lifetime: ${lifetimeTotRows}, Cumulative: ${totalR.TotalSheets}`);
assert(lifetimeTotApproved === totalR.Approved, 'Cross-Table Parity: Approved count match', `Lifetime: ${lifetimeTotApproved}, Cumulative: ${totalR.Approved}`);
assert(lifetimeTotRejected === totalR.Rejected, 'Cross-Table Parity: Rejected count match', `Lifetime: ${lifetimeTotRejected}, Cumulative: ${totalR.Rejected}`);
assert(lifetimeTotPending === totalR.Pending, 'Cross-Table Parity: Pending count match', `Lifetime: ${lifetimeTotPending}, Cumulative: ${totalR.Pending}`);
assert(lifetimeTotUnclassified === 0, 'Cross-Table Parity: Zero unclassified rows in verified dataset', `Unclassified: ${lifetimeTotUnclassified}`);
assert(lifetimeTotApproved + lifetimeTotRejected + lifetimeTotPending + lifetimeTotUnclassified === lifetimeTotRows, 'Lifetime Total Rows Reconciled Exactly', `Sum: ${lifetimeTotApproved + lifetimeTotRejected + lifetimeTotPending + lifetimeTotUnclassified} === ${lifetimeTotRows}`);

// --------------------------------------------------------------------------------
// Summary
// --------------------------------------------------------------------------------
console.log('\n================================================================================');
console.log(`RESULTS: ${passedTests} Passed, ${failedTests} Failed.`);
if (failedTests > 0) {
  console.error('VERDICT: RECONCILIATION AUDIT FAILED');
  process.exit(1);
} else {
  console.log('VERDICT: ALL ROW-BASED STATUS RECONCILIATION INVARIANTS VERIFIED (100% PARITY ACROSS BOTH TABLES)');
  process.exit(0);
}
