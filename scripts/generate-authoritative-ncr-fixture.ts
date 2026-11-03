import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

interface DisciplineSpec {
  sheet: string;
  discipline: string;
  hasLevelCol: boolean;
  totalUnique: number;
  approvedCount: number;
  openCount: number;
  furtherRevCount: number;
  octNewCount: number;
  octApprovedCount: number;
  octOpenCount: number;
}

const SPECS: DisciplineSpec[] = [
  {
    sheet: 'ARCH',
    discipline: 'Architectural',
    hasLevelCol: true,
    totalUnique: 202,
    approvedCount: 176,
    openCount: 26,
    furtherRevCount: 52,
    octNewCount: 7,
    octApprovedCount: 1,
    octOpenCount: 6
  },
  {
    sheet: 'INFR',
    discipline: 'Infrastructure',
    hasLevelCol: false,
    totalUnique: 66,
    approvedCount: 24,
    openCount: 42,
    furtherRevCount: 18,
    octNewCount: 4,
    octApprovedCount: 0,
    octOpenCount: 4
  },
  {
    sheet: 'STR',
    discipline: 'Structural',
    hasLevelCol: false,
    totalUnique: 65,
    approvedCount: 50,
    openCount: 15,
    furtherRevCount: 17,
    octNewCount: 2,
    octApprovedCount: 0,
    octOpenCount: 2
  },
  {
    sheet: 'ELEC',
    discipline: 'Electrical',
    hasLevelCol: false,
    totalUnique: 22,
    approvedCount: 17,
    openCount: 5,
    furtherRevCount: 6,
    octNewCount: 0,
    octApprovedCount: 0,
    octOpenCount: 0
  },
  {
    sheet: 'MECH',
    discipline: 'Mechanical',
    hasLevelCol: false,
    totalUnique: 56,
    approvedCount: 26,
    openCount: 30,
    furtherRevCount: 15,
    octNewCount: 11,
    octApprovedCount: 1,
    octOpenCount: 10
  },
  {
    sheet: 'LAND',
    discipline: 'Landscape',
    hasLevelCol: false,
    totalUnique: 3,
    approvedCount: 2,
    openCount: 1,
    furtherRevCount: 1,
    octNewCount: 0,
    octApprovedCount: 0,
    octOpenCount: 0
  },
  {
    sheet: 'HSE',
    discipline: 'HSE',
    hasLevelCol: false,
    totalUnique: 51,
    approvedCount: 47,
    openCount: 4,
    furtherRevCount: 14,
    octNewCount: 1,
    octApprovedCount: 0,
    octOpenCount: 1
  }
];

export function buildAuthoritativeNcrWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  for (const spec of SPECS) {
    const rows: (string | number)[][] = [];

    // Headers
    if (spec.hasLevelCol) {
      rows.push([
        'NCR Ref',
        'Rev',
        'Last Rev',
        'Level',
        'Discipline',
        'Subject',
        'Received Date',
        'Sent Corrective Action',
        'Response Date',
        'Action',
        'Status'
      ]);
    } else {
      rows.push([
        'NCR Ref',
        'Rev',
        'Last Rev',
        'Discipline',
        'Subject',
        'Received Date',
        'Sent Corrective Action',
        'Response Date',
        'Action',
        'Status'
      ]);
    }

    const preOctCount = spec.totalUnique - spec.octNewCount;
    const preOctApproved = spec.approvedCount - spec.octApprovedCount;
    const preOctOpen = spec.openCount - spec.octOpenCount;

    let furtherLeft = spec.furtherRevCount;

    // 1. Generate Pre-October Entities
    for (let i = 1; i <= preOctCount; i++) {
      const isApp = i <= preOctApproved;
      const ref = `ACE-INN-P1.03B-NCR-${spec.sheet}-${String(i).padStart(4, '0')}`;
      const hasFurther = furtherLeft > 0;
      if (hasFurther) furtherLeft--;

      const issueMonth = 1 + (i % 8); // Jan to Aug 2026
      const issueDay = 1 + (i % 25);
      const issueDate = `2026-${String(issueMonth).padStart(2, '0')}-${String(issueDay).padStart(2, '0')}`;
      const sentDate = `2026-${String(issueMonth).padStart(2, '0')}-${String(Math.min(28, issueDay + 5)).padStart(2, '0')}`;
      const respDate = `2026-${String(issueMonth).padStart(2, '0')}-${String(Math.min(28, issueDay + 12)).padStart(2, '0')}`;

      // Diverse trade text in MECH to test discipline lock
      let tradeLabel = spec.sheet;
      if (spec.sheet === 'MECH') {
        const trades = ['HVAC', 'PLUMBING', 'DRAINAGE', 'FIRE FIGHTING', 'WATER SUPPLY', 'MECH'];
        tradeLabel = trades[i % trades.length];
      }

      if (hasFurther) {
        // Rev 00 (Rejected)
        const rowR0: (string | number)[] = [
          ref,
          '0',
          'No',
          ...(spec.hasLevelCol ? [`Level ${(i % 5) + 1}`] : []),
          tradeLabel,
          `${spec.discipline} issue ${ref} Rev 00`,
          issueDate,
          sentDate,
          respDate,
          'Rejected',
          'Open'
        ];
        rows.push(rowR0);

        // Rev 01 (Latest)
        const resendDate = `2026-${String(issueMonth + 1).padStart(2, '0')}-05`;
        const finalRespDate = isApp ? `2026-${String(issueMonth + 1).padStart(2, '0')}-15` : (i % 2 === 0 ? `2026-${String(issueMonth + 1).padStart(2, '0')}-18` : '');
        const action = isApp ? 'Approved' : (finalRespDate ? 'Rejected' : '');
        const status = isApp ? 'Closed' : 'Open';

        const rowR1: (string | number)[] = [
          ref,
          '1',
          'Yes',
          ...(spec.hasLevelCol ? [`Level ${(i % 5) + 1}`] : []),
          tradeLabel,
          `${spec.discipline} issue ${ref} Rev 01`,
          issueDate,
          isApp || finalRespDate ? resendDate : '',
          finalRespDate,
          action,
          status
        ];
        rows.push(rowR1);
      } else {
        // Single revision Rev 00
        const action = isApp ? 'Approved' : (i % 2 === 0 ? 'Rejected' : '');
        const status = isApp ? 'Closed' : 'Open';
        const finalSent = isApp || (i % 2 === 0) ? sentDate : '';
        const finalResp = isApp ? respDate : (i % 2 === 0 ? respDate : '');

        const rowR0: (string | number)[] = [
          ref,
          '0',
          'Yes',
          ...(spec.hasLevelCol ? [`Level ${(i % 5) + 1}`] : []),
          tradeLabel,
          `${spec.discipline} issue ${ref} Rev 00`,
          issueDate,
          finalSent,
          finalResp,
          action,
          status
        ];
        rows.push(rowR0);
      }
    }

    // 2. Generate October 2026 Entities
    for (let j = 1; j <= spec.octNewCount; j++) {
      const idx = preOctCount + j;
      const ref = `ACE-INN-P1.03B-NCR-${spec.sheet}-${String(idx).padStart(4, '0')}`;
      const isApp = j <= spec.octApprovedCount;
      const hasFurther = furtherLeft > 0;
      if (hasFurther) furtherLeft--;

      const issueDay = 1 + (j * 2); // 3, 5, 7, ... in Oct 2026
      const issueDate = `2026-10-${String(issueDay).padStart(2, '0')}`;
      const sentDate = `2026-10-${String(Math.min(28, issueDay + 4)).padStart(2, '0')}`;
      const respDate = `2026-10-${String(Math.min(28, issueDay + 10)).padStart(2, '0')}`;

      let tradeLabel = spec.sheet;
      if (spec.sheet === 'MECH') {
        const trades = ['HVAC', 'PLUMBING', 'DRAINAGE', 'FIRE FIGHTING', 'WATER SUPPLY', 'MECH'];
        tradeLabel = trades[j % trades.length];
      }

      if (hasFurther) {
        // Rev 00
        const rowR0: (string | number)[] = [
          ref,
          '0',
          'No',
          ...(spec.hasLevelCol ? [`Level ${(j % 5) + 1}`] : []),
          tradeLabel,
          `${spec.discipline} Oct issue ${ref} Rev 00`,
          issueDate,
          sentDate,
          respDate,
          'Rejected',
          'Open'
        ];
        rows.push(rowR0);

        // Rev 01
        const resendDate = `2026-10-${String(Math.min(29, issueDay + 14)).padStart(2, '0')}`;
        const finalRespDate = isApp ? `2026-10-${String(Math.min(31, issueDay + 20)).padStart(2, '0')}` : (j % 2 === 0 ? `2026-10-${String(Math.min(31, issueDay + 20)).padStart(2, '0')}` : '');
        const action = isApp ? 'Approved' : (finalRespDate ? 'Rejected' : '');
        const status = isApp ? 'Closed' : 'Open';

        const rowR1: (string | number)[] = [
          ref,
          '1',
          'Yes',
          ...(spec.hasLevelCol ? [`Level ${(j % 5) + 1}`] : []),
          tradeLabel,
          `${spec.discipline} Oct issue ${ref} Rev 01`,
          issueDate,
          isApp || finalRespDate ? resendDate : '',
          finalRespDate,
          action,
          status
        ];
        rows.push(rowR1);
      } else {
        // Single revision Rev 00
        const action = isApp ? 'Approved' : (j % 2 === 0 ? 'Rejected' : '');
        const status = isApp ? 'Closed' : 'Open';
        const finalSent = isApp || (j % 2 === 0) ? sentDate : '';
        const finalResp = isApp ? respDate : (j % 2 === 0 ? respDate : '');

        const rowR0: (string | number)[] = [
          ref,
          '0',
          'Yes',
          ...(spec.hasLevelCol ? [`Level ${(j % 5) + 1}`] : []),
          tradeLabel,
          `${spec.discipline} Oct issue ${ref} Rev 00`,
          issueDate,
          finalSent,
          finalResp,
          action,
          status
        ];
        rows.push(rowR0);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, spec.sheet);
  }

  return wb;
}

// Generate files if executed directly
const targetDir = path.resolve(process.cwd(), 'src/test-datasets');
const file14 = path.resolve(targetDir, '14-Non-Conformance Report (NCR).xlsx');
const file16 = path.resolve(targetDir, '16- Non-Conformance Report (NCR).xlsx');
const fixturePath = path.resolve(targetDir, 'fixtures', 'ncr-source-identity-synthetic-fixture.xlsx');

const wb = buildAuthoritativeNcrWorkbook();
XLSX.writeFile(wb, file14);
XLSX.writeFile(wb, file16);
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
XLSX.writeFile(wb, fixturePath);

console.log('✔ Authoritative NCR Workbooks generated successfully:');
console.log('  -', file14);
console.log('  -', file16);
console.log('  -', fixturePath);
