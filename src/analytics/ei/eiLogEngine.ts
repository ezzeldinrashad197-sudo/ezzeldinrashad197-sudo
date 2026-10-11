import * as XLSX from 'xlsx';
import { SubmittalRow } from '../../types';
import { formatDate } from '../../utils/parser';
import {
  isValidRevision,
  getRevisionWeight,
  compareRevisionsCanonical,
  isRevision0,
  getNormalizedRevision
} from '../revisionResolver';
import {
  cleanSheetDisciplineToken,
  isDisciplineSheet,
  normalizeDisciplineName
} from '../../utils/parentRegisterResolver';

// ============================================================================
// 1. CANONICAL 6-COLUMN EI LOG CONTRACT
// ============================================================================

export const EI_LOG_CANONICAL_COLUMNS = [
  'SUB Ref.',
  'Rev00.Date Sent',
  'Date Return',
  'Last Rev.',
  'Rev00.Total Sheets',
  'Code.1'
] as const;

export type EILogColumnHeader = (typeof EI_LOG_CANONICAL_COLUMNS)[number];

export type EIConflictResolutionMode =
  | 'GOVERNING_EI_RULE'
  | 'EXCEL_FIRST_MATCH'
  | 'EXCEL_LAST_MATCH'
  | 'HOLD_ON_CONFLICT';

export type EIConflictType =
  | 'REV00_DATE_SENT_CONFLICT'
  | 'LAST_REV_DATE_RETURN_CONFLICT'
  | 'LAST_REV_CODE_CONFLICT'
  | 'PARTIAL_RETURN_IN_LAST_REV'
  | 'MISSING_REV00_BASELINE'
  | 'MISSING_REV00_DATE_SENT'
  | 'PARTIAL_MISSING_REV00_DATE_SENT'
  | 'MISSING_DWG_NO_IN_REV00'
  | 'DUPLICATE_DWG_IN_REV00'
  | 'INVALID_OR_MISSING_REVISION'
  | 'ALL_REVISIONS_INVALID'
  | 'CROSS_SHEET_DUPLICATE_SUB_REF'
  | 'MISSING_SUB_REF'
  | 'MISSING_REQUIRED_SHEET_COLUMNS';

export interface EISourceRowEvidence {
  sheetName: string;
  discipline: string;
  excelRowNumber: number; // 1-based Excel row index
  rawSubRef: string;
  normalizedSubRef: string;
  rawDwgNo: string;
  normalizedDwgNo: string;
  rawRev: string;
  normalizedRev: string;
  revisionWeight: number;
  isValidRev: boolean;
  isRev0: boolean;
  dateSent: string;
  dateReturn: string;
  rawCode: string;
  normalizedCode: string;
  rawStatus: string;
  drawingTitle: string;
}

export interface EILogRecord {
  /** 1. SUB Ref. */
  subRef: string;
  /** 2. Rev00.Date Sent */
  rev00DateSent: string;
  /** 3. Date Return */
  dateReturn: string;
  /** 4. Last Rev. */
  lastRev: string;
  /** 5. Rev00.Total Sheets */
  rev00TotalSheets: number;
  /** 6. Code.1 */
  code1: string;

  // Traceability & Provenance Metadata (preserved for audit & drill-down)
  discipline: string;
  sourceSheets: string[];
  excelRowNumbers: string[]; // e.g. ["ARCH!R12", "ARCH!R13"]
  totalSourceRows: number;
  rev00RowCount: number;
  rev00DistinctDrawings: string[];
  duplicateRev00DrawingsCount: number;
  lastRevRowCount: number;
  allRevisionsFound: string[];
  invalidRevisionRowsCount: number;
  hasConflict: boolean;
  conflictTypes: EIConflictType[];
  conflictDetails: string[];
  resolutionRuleApplied: string;
  sourceRows: EISourceRowEvidence[];
}

export interface EIValidationIssue {
  id: string;
  severity: 'ERROR' | 'CONFLICT' | 'WARNING';
  type: EIConflictType;
  sheetName: string;
  excelRowNumbers: number[];
  subRef: string;
  dwgNo?: string;
  messageEn: string;
  messageAr: string;
  conflictingValues?: string[];
  resolutionApplied?: string;
}

export interface EIUnprocessedRecord {
  sheetName: string;
  excelRowNumber: number;
  reasonEn: string;
  reasonAr: string;
  rawSubRef: string;
  rawDwgNo: string;
  rawRev: string;
  rawDateSent: string;
  rawDateReturn: string;
  rawCode: string;
}

export interface EIColumnMappingStatus {
  fieldKey: 'subRef' | 'dwgNo' | 'rev' | 'dateSent' | 'dateReturn' | 'code';
  fieldLabel: string;
  required: boolean;
  matchedHeader: string | null;
  columnIndex: number; // -1 if not found
}

export interface EIDiscoveredSheet {
  sheetIndex: number;
  sheetName: string;
  sheetRole: 'DISCIPLINE_REGISTER' | 'REFERENCE_EI_LOG' | 'IGNORED_NON_REGISTER';
  detectedDiscipline: string;
  disciplineLabel: string;
  headerRowNumber: number; // 1-based, -1 if not found
  totalDataRows: number;
  validSubmittalRows: number;
  unprocessedRows: number;
  columnMappings: EIColumnMappingStatus[];
  missingRequiredColumns: string[];
  isSelectedByDefault: boolean;
  statusMessageEn: string;
  statusMessageAr: string;
}

export interface EIInspectedFormulaPattern {
  columnName: string;
  sampleFormula: string;
  detectedMechanism: string;
}

export interface EIReferenceRecord {
  excelRowNumber: number;
  subRef: string;
  rev00DateSent: string;
  dateReturn: string;
  lastRev: string;
  rev00TotalSheets: number;
  code1: string;
}

export interface EIReferenceDiscrepancy {
  subRef: string;
  field: EILogColumnHeader | 'SUB_REF_PRESENCE';
  expectedValue: string;
  actualValue: string;
  explanationEn: string;
  explanationAr: string;
  sourceTrace: string;
}

export interface EIReferenceReconciliationReport {
  referenceSourceName: string;
  referenceSubmittalCount: number;
  generatedSubmittalCount: number;
  matchedSubmittalCount: number;
  missingInGenerated: string[];
  extraInGenerated: string[];
  exactRowMatchesCount: number;
  overallFieldMatchRatePct: number;
  is100PercentParity: boolean;
  inspectedFormulas: EIInspectedFormulaPattern[];
  perColumnStats: Record<
    Exclude<EILogColumnHeader, 'SUB Ref.'>,
    { matched: number; total: number; matchPct: number }
  >;
  discrepancies: EIReferenceDiscrepancy[];
}

export interface EIVerificationSummary {
  totalSheetsInWorkbook: number;
  discoveredDisciplineSheetsCount: number;
  disciplinesList: string[];
  totalRawRowsScanned: number;
  validRowsProcessed: number;
  extractedSubmittalsCount: number;
  consolidatedDuplicateRowsCount: number; // Raw rows merged into unique SUB Ref. + duplicate DWG No.
  duplicateRev00DrawingsCount: number;
  conflictedSubmittalsCount: number;
  cleanSubmittalsCount: number;
  unprocessedRecordsCount: number;
  validationErrorsCount: number;
  validationConflictsCount: number;
  validationWarningsCount: number;
  byDisciplineBreakdown: Array<{
    discipline: string;
    sheetNames: string[];
    rawRows: number;
    uniqueSubmittals: number;
    rev00TotalSheetsSum: number;
    conflictedSubmittals: number;
    unprocessedRows: number;
  }>;
}

export interface EILogGenerationResult {
  fileName: string;
  generatedAt: string;
  resolutionMode: EIConflictResolutionMode;
  discoveredSheets: EIDiscoveredSheet[];
  records: EILogRecord[];
  validationIssues: EIValidationIssue[];
  unprocessedRecords: EIUnprocessedRecord[];
  summary: EIVerificationSummary;
  autoDetectedReferenceReport?: EIReferenceReconciliationReport;
}

// ============================================================================
// 2. COLUMN & DISCIPLINE DETECTION HELPERS
// ============================================================================

const SUB_REF_ALIASES = [
  'sub ref.',
  'sub ref',
  'sub. ref.',
  'sub. ref',
  'submittal ref.',
  'submittal ref',
  'submittal reference',
  'submission ref.',
  'submission ref',
  'submission reference',
  'sub reference',
  'submittal no.',
  'submittal no',
  'document no.',
  'document no',
  'doc no.',
  'doc no',
  'رقم التقديم',
  'مرجع التقديم'
];

const DWG_NO_ALIASES = [
  'dwg no.',
  'dwg no',
  'dwg. no.',
  'dwg. no',
  'dwg number',
  'dwg #',
  'drawing no.',
  'drawing no',
  'drawing number',
  'drawing ref',
  'sheet no.',
  'sheet no',
  'رقم اللوحة',
  'رقم الرسم'
];

const REV_ALIASES = [
  'rev.',
  'rev',
  'revision',
  'revision no.',
  'revision no',
  'rev no.',
  'rev no',
  'رقم المراجعة',
  'المراجعة'
];

const DATE_SENT_ALIASES = [
  'rev00.date sent',
  'date sent',
  'sent date',
  'submission date',
  'submit date',
  'submittal date',
  'date submitted',
  'date of submission',
  'received date',
  'issue date',
  'date issued',
  'تاريخ التقديم',
  'تاريخ الإرسال'
];

const DATE_RETURN_ALIASES = [
  'date return',
  'return date',
  'date returned',
  'returned date',
  'response date',
  'consultant response date',
  'consultant return date',
  'reply date',
  'date replied',
  'action date',
  'approval date',
  'actual return date',
  'date of return',
  'تاريخ الرد',
  'تاريخ الإرجاع',
  'تاريخ الاعتماد'
];

const CODE_ALIASES = [
  'code.1',
  'code',
  'status code',
  'approval code',
  'code status',
  'consultant code',
  'review code',
  'action code',
  'action',
  'status',
  'كود الاعتماد',
  'الكود',
  'الحالة'
];

const TITLE_ALIASES = [
  'title',
  'drawing title',
  'dwg title',
  'description',
  'subject',
  'عنوان الرسم',
  'الوصف'
];

const NON_REGISTER_SHEET_NAMES = new Set([
  'SUMMARY',
  'DASHBOARD',
  'COVER',
  'INDEX',
  'TOC',
  'CHARTS',
  'CHART',
  'KPI',
  'KPIS',
  'INSTRUCTIONS',
  'NOTES',
  'LEGEND',
  'SETTINGS',
  'CONFIG'
]);

const EI_REFERENCE_SHEET_NAMES = new Set([
  'EI',
  'EI LOG',
  'EI_LOG',
  'EI-LOG',
  'EILOG',
  'EI SUMMARY',
  'ENGINEERING ITEM LOG'
]);

export function detectSheetDisciplineCode(sheetName: string): {
  code: string;
  label: string;
  isRecognizedDiscipline: boolean;
} {
  const rawUpper = (sheetName || '').trim().toUpperCase();
  const clean = cleanSheetDisciplineToken(rawUpper)
    .replace(/^(?:SDW|SHD|SHOP\s*DRAWING[S]?|CUMULATIVE|REGISTER|LOG|\d+)[-_:\s.]+/i, '')
    .replace(/[-_:\s.]+(?:SDW|SHD|SHOP\s*DRAWING[S]?|CUMULATIVE|REGISTER|LOG)$/i, '')
    .trim();

  const candidates = [clean, rawUpper];
  for (const token of candidates) {
    if (!token) continue;
    if (isDisciplineSheet(token)) {
      const info = normalizeDisciplineName(token);
      if (info.code && info.code !== 'GEN') {
        return { code: info.code, label: info.normalized, isRecognizedDiscipline: true };
      }
    }
    if (/\b(?:ARC|ARCH|ARCHITECTURAL|ARCHITECTURE|ID|INTERIOR)\b/.test(token)) {
      return { code: 'ARCH', label: 'Architectural', isRecognizedDiscipline: true };
    }
    if (/\b(?:STR|STRUCT|STRUCTURAL|STRUCTURE|CIVIL|CVL)\b/.test(token)) {
      return { code: 'STR', label: 'Structural', isRecognizedDiscipline: true };
    }
    if (/\b(?:MEC|MECH|MECHANICAL|HVAC|PLUMBING|FIRE|FF)\b/.test(token)) {
      return { code: 'MECH', label: 'Mechanical', isRecognizedDiscipline: true };
    }
    if (/\b(?:ELE|ELEC|ELECTRICAL|ELV|ICT)\b/.test(token)) {
      return { code: 'ELEC', label: 'Electrical', isRecognizedDiscipline: true };
    }
    if (/\b(?:INF|INFR|INFRA|INFRASTRUCTURE|UTILITIES|ROADS)\b/.test(token)) {
      return { code: 'INFRA', label: 'Infrastructure', isRecognizedDiscipline: true };
    }
    if (/\b(?:LND|LAND|LANDSCAPE|HARDSCAPE|SOFTSCAPE|IRR|IRRIGATION)\b/.test(token)) {
      return { code: 'LAND', label: 'Landscape', isRecognizedDiscipline: true };
    }
    if (/\b(?:SUR|SURV|SURVEY|SURVEYING)\b/.test(token)) {
      return { code: 'SURVEY', label: 'Survey', isRecognizedDiscipline: true };
    }
    if (/\b(?:HSE|SAFETY|ENVIRONMENT)\b/.test(token)) {
      return { code: 'HSE', label: 'HSE', isRecognizedDiscipline: true };
    }
    if (/\b(?:MEP)\b/.test(token)) {
      return { code: 'MEP', label: 'MEP', isRecognizedDiscipline: true };
    }
    if (/\b(?:GEN|GENERAL)\b/.test(token)) {
      return { code: 'GEN', label: 'General', isRecognizedDiscipline: true };
    }
  }

  return {
    code: clean || rawUpper || 'GEN',
    label: sheetName.trim() || 'General',
    isRecognizedDiscipline: false
  };
}

function normalizeHeaderCell(val: unknown): string {
  return String(val ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findMatchingColumnIndex(
  headers: string[],
  aliases: string[],
  exclusions: string[] = [],
  usedIndices: Set<number> = new Set()
): { index: number; matchedHeader: string | null } {
  // Pass 1: Exact match
  for (const alias of aliases) {
    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue;
      const h = normalizeHeaderCell(headers[i]);
      if (!h) continue;
      if (exclusions.some(ex => h.includes(ex))) continue;
      if (h === alias) {
        return { index: i, matchedHeader: String(headers[i]).trim() };
      }
    }
  }

  // Pass 2: Substring match
  for (const alias of aliases) {
    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue;
      const h = normalizeHeaderCell(headers[i]);
      if (!h) continue;
      if (exclusions.some(ex => h.includes(ex))) continue;
      if (h.includes(alias)) {
        return { index: i, matchedHeader: String(headers[i]).trim() };
      }
    }
  }

  return { index: -1, matchedHeader: null };
}

function isEIReferenceSheetHeader(headers: string[]): boolean {
  const normHeaders = headers.map(normalizeHeaderCell);
  const hasSubRef = normHeaders.some(h => h.includes('sub ref'));
  const hasRev00DateSent = normHeaders.some(
    h => h.includes('rev00.date sent') || h.includes('rev00 date sent') || h.includes('rev.00 date sent')
  );
  const hasRev00TotalSheets = normHeaders.some(
    h => h.includes('rev00.total sheets') || h.includes('rev00 total sheets') || h.includes('rev.00 total sheets')
  );
  const hasLastRev = normHeaders.some(h => h.includes('last rev'));
  return hasSubRef && (hasRev00DateSent || hasRev00TotalSheets) && hasLastRev;
}

/**
 * Formats a valid revision string into canonical 2-digit EI format ('00', '01', '02', ...)
 * while preserving alphabetic or milestone tokens ('A', 'B', 'IFC', 'AS-BUILT').
 */
export function formatCanonicalEIRevision(rawRev: string | number | null | undefined, isRev0Flag?: boolean): string {
  if (isRevision0(rawRev, isRev0Flag)) {
    return '00';
  }
  if (!isValidRevision(rawRev)) {
    return '';
  }
  const norm = getNormalizedRevision(rawRev, isRev0Flag);
  if (norm === 'Unknown') return '';
  if (/^\d+$/.test(norm)) {
    const num = parseInt(norm, 10);
    return num < 10 ? `0${num}` : String(num);
  }
  return norm.toUpperCase();
}

/**
 * Normalizes consultant return / status codes according to EI Log rules.
 * Preserves standard codes ('A', 'B', 'C', 'D', 'UR') and never invents a code when blank.
 */
export function normalizeEICode(
  rawCode: unknown,
  rawStatus?: unknown,
  dateReturn?: string
): string {
  const codeStr = String(rawCode ?? '').trim();
  const statusStr = String(rawStatus ?? '').trim();
  const combinedSource = codeStr || statusStr;
  const upper = combinedSource.toUpperCase().replace(/\s+/g, ' ').trim();

  if (!upper || upper === '-' || upper === 'N/A' || upper === 'NONE') {
    return '';
  }

  // Exact single letter or "CODE X"
  if (upper === 'A' || upper === 'CODE A' || upper === 'CODE (A)' || upper === '1' || upper === 'APPROVED') {
    return 'A';
  }
  if (
    upper === 'B' ||
    upper === 'CODE B' ||
    upper === 'CODE (B)' ||
    upper === '2' ||
    upper === 'APPROVED AS NOTED' ||
    upper === 'APPROVED WITH COMMENTS'
  ) {
    return 'B';
  }
  if (
    upper === 'C' ||
    upper === 'CODE C' ||
    upper === 'CODE (C)' ||
    upper === '3' ||
    upper === 'REVISE & RESUBMIT' ||
    upper === 'REVISE AND RESUBMIT' ||
    upper === 'REJECTED'
  ) {
    return 'C';
  }
  if (upper === 'D' || upper === 'CODE D' || upper === 'CODE (D)' || upper === '4') {
    return 'D';
  }
  if (
    upper === 'UR' ||
    upper === 'U.R' ||
    upper === 'U.R.' ||
    upper === 'UNDER REVIEW' ||
    upper === 'PENDING' ||
    upper === 'OPEN' ||
    upper === 'W' ||
    upper === 'WAITING'
  ) {
    return 'UR';
  }

  // Pattern prefix match e.g. "A - Approved" or "Code B - Approved as Noted"
  const prefixMatch = upper.match(/^(?:CODE\s*)?([ABCD])\b/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  if (upper.includes('UNDER REVIEW') || upper.includes('PENDING')) {
    return 'UR';
  }
  if (upper.includes('APPROVED AS NOTED') || upper.includes('WITH COMMENT')) {
    return 'B';
  }
  if (upper.includes('APPROV')) {
    return 'A';
  }
  if (upper.includes('REJECT') || upper.includes('REVISE')) {
    return 'C';
  }

  // If dateReturn is empty and status indicates open/waiting, return UR; otherwise return cleaned token
  if (!dateReturn && (upper === 'OPEN' || upper === 'SUBMITTED')) {
    return 'UR';
  }

  return codeStr.toUpperCase();
}

/**
 * Severity rank for governing submittal status resolution across multiple drawings in Last Rev.
 * Higher rank governs package status when drawings within the same submittal have mixed codes:
 *   UR (Under Review / Incomplete Return) -> 50
 *   D (Rejected)                          -> 40
 *   C (Revise & Resubmit)                 -> 30
 *   B (Approved as Noted)                 -> 20
 *   A (Approved)                          -> 10
 *   Blank                                 -> 0
 */
function getEICodeGoverningSeverity(code: string, hasReturnDate: boolean): number {
  const upper = (code || '').trim().toUpperCase();
  if (upper === 'UR' || (!upper && !hasReturnDate)) return 50;
  if (upper === 'D') return 40;
  if (upper === 'C') return 30;
  if (upper === 'B') return 20;
  if (upper === 'A') return 10;
  return 5;
}

// ============================================================================
// 3. REFERENCE EI SHEET INSPECTOR (FORMULAS & VALUES)
// ============================================================================

export function extractReferenceEISheetFromWorksheet(
  ws: XLSX.WorkSheet,
  sheetName: string
): {
  records: EIReferenceRecord[];
  inspectedFormulas: EIInspectedFormulaPattern[];
} {
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as unknown[][];
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(25, rawRows.length); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    const headers = row.map(c => String(c ?? ''));
    if (isEIReferenceSheetHeader(headers)) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return { records: [], inspectedFormulas: [] };
  }

  const headers = (rawRows[headerRowIdx] || []).map(c => String(c ?? '').trim());
  const used = new Set<number>();

  const subRefMatch = findMatchingColumnIndex(headers, SUB_REF_ALIASES, [], used);
  if (subRefMatch.index >= 0) used.add(subRefMatch.index);

  const rev00DateMatch = findMatchingColumnIndex(
    headers,
    ['rev00.date sent', 'rev00 date sent', 'rev.00 date sent', ...DATE_SENT_ALIASES],
    ['return', 'response'],
    used
  );
  if (rev00DateMatch.index >= 0) used.add(rev00DateMatch.index);

  const dateReturnMatch = findMatchingColumnIndex(headers, DATE_RETURN_ALIASES, ['sent', 'submit'], used);
  if (dateReturnMatch.index >= 0) used.add(dateReturnMatch.index);

  const lastRevMatch = findMatchingColumnIndex(
    headers,
    ['last rev.', 'last rev', 'latest rev', ...REV_ALIASES],
    ['date', 'sheets'],
    used
  );
  if (lastRevMatch.index >= 0) used.add(lastRevMatch.index);

  const totalSheetsMatch = findMatchingColumnIndex(
    headers,
    ['rev00.total sheets', 'rev00 total sheets', 'rev.00 total sheets', 'total sheets', 'sheets'],
    ['date'],
    used
  );
  if (totalSheetsMatch.index >= 0) used.add(totalSheetsMatch.index);

  const code1Match = findMatchingColumnIndex(headers, ['code.1', ...CODE_ALIASES], ['date', 'sheets'], used);

  // Inspect worksheet formulas on the first few data rows if present
  const inspectedFormulas: EIInspectedFormulaPattern[] = [];
  const colChecks: Array<{ label: string; colIdx: number }> = [
    { label: 'SUB Ref.', colIdx: subRefMatch.index },
    { label: 'Rev00.Date Sent', colIdx: rev00DateMatch.index },
    { label: 'Date Return', colIdx: dateReturnMatch.index },
    { label: 'Last Rev.', colIdx: lastRevMatch.index },
    { label: 'Rev00.Total Sheets', colIdx: totalSheetsMatch.index },
    { label: 'Code.1', colIdx: code1Match.index }
  ];

  for (const colCheck of colChecks) {
    if (colCheck.colIdx < 0) continue;
    for (let r = headerRowIdx + 1; r < Math.min(headerRowIdx + 15, rawRows.length); r++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c: colCheck.colIdx });
      const cell = ws[cellAddr] as XLSX.CellObject | undefined;
      if (cell && cell.f) {
        const fUpper = cell.f.toUpperCase();
        let mechanism = 'Custom Formula';
        if (fUpper.includes('COUNTIFS') || fUpper.includes('COUNTIF')) {
          mechanism = 'Conditional Sheet Count (COUNTIFS on SUB Ref. & Rev 00)';
        } else if (fUpper.includes('MAXIFS') || fUpper.includes('MAX')) {
          mechanism = 'Maximum Revision / Date Aggregation (MAXIFS)';
        } else if (fUpper.includes('MINIFS') || fUpper.includes('MIN')) {
          mechanism = 'Earliest Date Aggregation (MINIFS)';
        } else if (fUpper.includes('XLOOKUP')) {
          mechanism = 'Direct Key Lookup (XLOOKUP)';
        } else if (fUpper.includes('INDEX') && fUpper.includes('MATCH')) {
          mechanism = 'Composite Key Lookup (INDEX/MATCH)';
        } else if (fUpper.includes('VLOOKUP')) {
          mechanism = 'First-Row Key Lookup (VLOOKUP)';
        }
        inspectedFormulas.push({
          columnName: colCheck.label,
          sampleFormula: `=${cell.f}`,
          detectedMechanism: mechanism
        });
        break;
      }
    }
  }

  const records: EIReferenceRecord[] = [];
  for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    const rawSubRef = subRefMatch.index >= 0 ? String(row[subRefMatch.index] ?? '').trim() : '';
    if (!rawSubRef || rawSubRef.toUpperCase() === 'TOTAL' || rawSubRef.toUpperCase() === 'SUB REF.') {
      continue;
    }

    const rev00DateSent =
      rev00DateMatch.index >= 0 ? formatDate(row[rev00DateMatch.index]) : '';
    const dateReturn =
      dateReturnMatch.index >= 0 ? formatDate(row[dateReturnMatch.index]) : '';
    const rawLastRev =
      lastRevMatch.index >= 0 ? String(row[lastRevMatch.index] ?? '').trim() : '';
    const lastRev = formatCanonicalEIRevision(rawLastRev, isRevision0(rawLastRev)) || rawLastRev;
    const rawSheets =
      totalSheetsMatch.index >= 0 ? Number(String(row[totalSheetsMatch.index] ?? '0').trim()) : 0;
    const rev00TotalSheets = isNaN(rawSheets) ? 0 : rawSheets;
    const rawCode1 = code1Match.index >= 0 ? String(row[code1Match.index] ?? '').trim() : '';
    const code1 = normalizeEICode(rawCode1, '', dateReturn);

    records.push({
      excelRowNumber: r + 1,
      subRef: rawSubRef,
      rev00DateSent,
      dateReturn,
      lastRev,
      rev00TotalSheets,
      code1
    });
  }

  return { records, inspectedFormulas };
}

// ============================================================================
// 4. WORKBOOK SHEET DISCOVERY & COLUMN VALIDATION
// ============================================================================

interface ParsedWorksheetInternal {
  discovered: EIDiscoveredSheet;
  validRows: EISourceRowEvidence[];
  unprocessed: EIUnprocessedRecord[];
  referenceData?: {
    records: EIReferenceRecord[];
    inspectedFormulas: EIInspectedFormulaPattern[];
  };
}

function inspectAndParseWorksheet(
  ws: XLSX.WorkSheet,
  sheetName: string,
  sheetIndex: number
): ParsedWorksheetInternal {
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as unknown[][];
  const upperName = sheetName.trim().toUpperCase();
  const discInfo = detectSheetDisciplineCode(sheetName);

  // Check if this sheet is a Reference EI Log sheet
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(30, rawRows.length); i++) {
    const r = rawRows[i];
    if (!Array.isArray(r)) continue;
    const rowStrs = r.map(c => String(c ?? ''));
    if (EI_REFERENCE_SHEET_NAMES.has(upperName) || isEIReferenceSheetHeader(rowStrs)) {
      const refData = extractReferenceEISheetFromWorksheet(ws, sheetName);
      if (refData.records.length > 0 || EI_REFERENCE_SHEET_NAMES.has(upperName)) {
        return {
          discovered: {
            sheetIndex,
            sheetName,
            sheetRole: 'REFERENCE_EI_LOG',
            detectedDiscipline: 'EI_REF',
            disciplineLabel: 'Reference EI Log',
            headerRowNumber: i + 1,
            totalDataRows: refData.records.length,
            validSubmittalRows: refData.records.length,
            unprocessedRows: 0,
            columnMappings: [],
            missingRequiredColumns: [],
            isSelectedByDefault: false,
            statusMessageEn: `Detected as Reference EI Log (${refData.records.length} reference submittals)`,
            statusMessageAr: `تم اكتشافه كسجل EI مرجعي (${refData.records.length} تقديم مرجعي)`
          },
          validRows: [],
          unprocessed: [],
          referenceData: refData
        };
      }
    }
  }

  // Check if explicitly non-register summary/cover tab
  if (NON_REGISTER_SHEET_NAMES.has(upperName)) {
    return {
      discovered: {
        sheetIndex,
        sheetName,
        sheetRole: 'IGNORED_NON_REGISTER',
        detectedDiscipline: discInfo.code,
        disciplineLabel: discInfo.label,
        headerRowNumber: -1,
        totalDataRows: 0,
        validSubmittalRows: 0,
        unprocessedRows: 0,
        columnMappings: [],
        missingRequiredColumns: [],
        isSelectedByDefault: false,
        statusMessageEn: 'Non-register summary/cover sheet (skipped)',
        statusMessageAr: 'شيت ملخص أو غلاف غير تابع لسجلات الرسومات (تم تخطيه)'
      },
      validRows: [],
      unprocessed: []
    };
  }

  // Locate header row in discipline sheet
  for (let i = 0; i < Math.min(30, rawRows.length); i++) {
    const r = rawRows[i];
    if (!Array.isArray(r)) continue;
    const joined = r.map(c => normalizeHeaderCell(c)).join(' | ');
    const hasRefSignal =
      joined.includes('sub ref') ||
      joined.includes('submittal ref') ||
      joined.includes('submission ref') ||
      joined.includes('dwg no') ||
      joined.includes('drawing no') ||
      joined.includes('document no') ||
      joined.includes('doc no');
    const hasRevOrDateSignal =
      joined.includes('rev') ||
      joined.includes('date sent') ||
      joined.includes('submission date') ||
      joined.includes('date return') ||
      joined.includes('response date');

    if (hasRefSignal && hasRevOrDateSignal) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      discovered: {
        sheetIndex,
        sheetName,
        sheetRole: 'IGNORED_NON_REGISTER',
        detectedDiscipline: discInfo.code,
        disciplineLabel: discInfo.label,
        headerRowNumber: -1,
        totalDataRows: rawRows.length,
        validSubmittalRows: 0,
        unprocessedRows: 0,
        columnMappings: [],
        missingRequiredColumns: ['SUB Ref.', 'DWG No.', 'Rev.', 'Date Sent'],
        isSelectedByDefault: false,
        statusMessageEn: 'No valid Shop Drawing Register header row detected',
        statusMessageAr: 'لم يتم العثور على صف عناوين صالح لسجل الرسومات'
      },
      validRows: [],
      unprocessed: []
    };
  }

  const headers = (rawRows[headerRowIdx] || []).map(c => String(c ?? '').trim());
  const usedIndices = new Set<number>();

  const subRefCol = findMatchingColumnIndex(headers, SUB_REF_ALIASES, ['dwg', 'drawing'], usedIndices);
  if (subRefCol.index >= 0) usedIndices.add(subRefCol.index);

  const dwgNoCol = findMatchingColumnIndex(headers, DWG_NO_ALIASES, ['sub ref', 'submittal ref', 'title'], usedIndices);
  if (dwgNoCol.index >= 0) usedIndices.add(dwgNoCol.index);

  const revCol = findMatchingColumnIndex(headers, REV_ALIASES, ['date', 'last', 'sheet'], usedIndices);
  if (revCol.index >= 0) usedIndices.add(revCol.index);

  const dateSentCol = findMatchingColumnIndex(
    headers,
    DATE_SENT_ALIASES,
    ['return', 'response', 'reply', 'action', 'consultant', 'corrective'],
    usedIndices
  );
  if (dateSentCol.index >= 0) usedIndices.add(dateSentCol.index);

  const dateReturnCol = findMatchingColumnIndex(
    headers,
    DATE_RETURN_ALIASES,
    ['sent', 'submit', 'issue'],
    usedIndices
  );
  if (dateReturnCol.index >= 0) usedIndices.add(dateReturnCol.index);

  const codeCol = findMatchingColumnIndex(
    headers,
    CODE_ALIASES,
    ['date', 'time', 'duration', 'project', 'area', 'wbs'],
    usedIndices
  );
  if (codeCol.index >= 0) usedIndices.add(codeCol.index);

  const statusCol = findMatchingColumnIndex(headers, ['status', 'workflow status'], ['code'], usedIndices);
  const titleCol = findMatchingColumnIndex(headers, TITLE_ALIASES, [], usedIndices);

  const columnMappings: EIColumnMappingStatus[] = [
    {
      fieldKey: 'subRef',
      fieldLabel: 'SUB Ref.',
      required: true,
      matchedHeader: subRefCol.matchedHeader,
      columnIndex: subRefCol.index
    },
    {
      fieldKey: 'dwgNo',
      fieldLabel: 'DWG No.',
      required: true,
      matchedHeader: dwgNoCol.matchedHeader,
      columnIndex: dwgNoCol.index
    },
    {
      fieldKey: 'rev',
      fieldLabel: 'Rev.',
      required: true,
      matchedHeader: revCol.matchedHeader,
      columnIndex: revCol.index
    },
    {
      fieldKey: 'dateSent',
      fieldLabel: 'Date Sent',
      required: true,
      matchedHeader: dateSentCol.matchedHeader,
      columnIndex: dateSentCol.index
    },
    {
      fieldKey: 'dateReturn',
      fieldLabel: 'Date Return',
      required: true,
      matchedHeader: dateReturnCol.matchedHeader,
      columnIndex: dateReturnCol.index
    },
    {
      fieldKey: 'code',
      fieldLabel: 'Code',
      required: true,
      matchedHeader: codeCol.matchedHeader,
      columnIndex: codeCol.index
    }
  ];

  const missingRequiredColumns = columnMappings
    .filter(m => m.required && m.columnIndex === -1)
    .map(m => m.fieldLabel);

  const validRows: EISourceRowEvidence[] = [];
  const unprocessed: EIUnprocessedRecord[] = [];
  let totalDataRows = 0;

  // Critical columns needed to extract at least SUB Ref. and Rev.
  const canExtract = subRefCol.index >= 0 && revCol.index >= 0 && dateSentCol.index >= 0;

  for (let rIdx = headerRowIdx + 1; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    if (!Array.isArray(row)) continue;

    const rawSubRef = subRefCol.index >= 0 ? String(row[subRefCol.index] ?? '').trim() : '';
    const rawDwgNo = dwgNoCol.index >= 0 ? String(row[dwgNoCol.index] ?? '').trim() : '';
    const rawRev = revCol.index >= 0 ? String(row[revCol.index] ?? '').trim() : '';
    const rawDateSent = dateSentCol.index >= 0 ? String(row[dateSentCol.index] ?? '').trim() : '';
    const rawDateReturn = dateReturnCol.index >= 0 ? String(row[dateReturnCol.index] ?? '').trim() : '';
    const rawCode = codeCol.index >= 0 ? String(row[codeCol.index] ?? '').trim() : '';
    const rawStatus = statusCol.index >= 0 ? String(row[statusCol.index] ?? '').trim() : '';
    const drawingTitle = titleCol.index >= 0 ? String(row[titleCol.index] ?? '').trim() : '';

    // Completely blank row check
    if (!rawSubRef && !rawDwgNo && !rawRev && !rawDateSent && !rawDateReturn && !rawCode) {
      continue;
    }

    // Header repetition or total footer check
    if (
      rawSubRef.toUpperCase() === 'SUB REF.' ||
      rawSubRef.toUpperCase() === 'SUB REF' ||
      rawSubRef.toUpperCase() === 'TOTAL' ||
      rawSubRef.toUpperCase() === 'GRAND TOTAL'
    ) {
      continue;
    }

    totalDataRows++;
    const excelRowNumber = rIdx + 1;

    if (!canExtract) {
      unprocessed.push({
        sheetName,
        excelRowNumber,
        reasonEn: `Sheet '${sheetName}' is missing required column(s): ${missingRequiredColumns.join(', ')}`,
        reasonAr: `الشيت '${sheetName}' يفتقد الأعمدة الإلزامية: ${missingRequiredColumns.join(', ')}`,
        rawSubRef,
        rawDwgNo,
        rawRev,
        rawDateSent,
        rawDateReturn,
        rawCode
      });
      continue;
    }

    if (!rawSubRef || ['-', 'N/A', 'NONE', 'NULL'].includes(rawSubRef.toUpperCase())) {
      unprocessed.push({
        sheetName,
        excelRowNumber,
        reasonEn: 'Missing or invalid SUB Ref. on non-empty register row',
        reasonAr: 'قيمة SUB Ref. مفقودة أو غير صالحة في صف يحتوي على بيانات',
        rawSubRef,
        rawDwgNo,
        rawRev,
        rawDateSent,
        rawDateReturn,
        rawCode
      });
      continue;
    }

    const dateSent = formatDate(row[dateSentCol.index]);
    const dateReturn = dateReturnCol.index >= 0 ? formatDate(row[dateReturnCol.index]) : '';
    const validRev = isValidRevision(rawRev);
    const rev0Flag = isRevision0(rawRev);
    const revWeight = getRevisionWeight(rawRev);
    const normalizedRev = formatCanonicalEIRevision(rawRev, rev0Flag);
    const normalizedCode = normalizeEICode(rawCode, rawStatus, dateReturn);

    validRows.push({
      sheetName,
      discipline: discInfo.code,
      excelRowNumber,
      rawSubRef,
      normalizedSubRef: rawSubRef.toUpperCase().replace(/\s+/g, ' ').trim(),
      rawDwgNo,
      normalizedDwgNo: rawDwgNo.toUpperCase().replace(/\s+/g, ' ').trim(),
      rawRev,
      normalizedRev,
      revisionWeight: revWeight,
      isValidRev: validRev,
      isRev0: rev0Flag,
      dateSent,
      dateReturn,
      rawCode,
      normalizedCode,
      rawStatus,
      drawingTitle
    });
  }

  const isSelectedByDefault = canExtract && totalDataRows > 0;
  const statusMessageEn =
    missingRequiredColumns.length === 0
      ? `Verified all 6 required columns (${validRows.length} valid rows)`
      : canExtract
      ? `Partial columns matched (missing: ${missingRequiredColumns.join(', ')})`
      : `Cannot extract: missing critical columns (${missingRequiredColumns.join(', ')})`;

  const statusMessageAr =
    missingRequiredColumns.length === 0
      ? `تم التحقق من جميع الأعمدة الـ 6 المطلوبة (${validRows.length} صف صالح)`
      : canExtract
      ? `مطابقة جزئية للأعمدة (مفقود: ${missingRequiredColumns.join('، ')})`
      : `تعذر الاستخراج: أعمدة أساسية مفقودة (${missingRequiredColumns.join('، ')})`;

  return {
    discovered: {
      sheetIndex,
      sheetName,
      sheetRole: 'DISCIPLINE_REGISTER',
      detectedDiscipline: discInfo.code,
      disciplineLabel: discInfo.label,
      headerRowNumber: headerRowIdx + 1,
      totalDataRows,
      validSubmittalRows: validRows.length,
      unprocessedRows: unprocessed.length,
      columnMappings,
      missingRequiredColumns,
      isSelectedByDefault,
      statusMessageEn,
      statusMessageAr
    },
    validRows,
    unprocessed
  };
}

// ============================================================================
// 5. CORE EI LOG AGGREGATION & CONFLICT DETECTION ENGINE
// ============================================================================

export function compileEILogFromEvidenceRows(
  allValidRows: EISourceRowEvidence[],
  discoveredSheets: EIDiscoveredSheet[],
  initialUnprocessed: EIUnprocessedRecord[],
  fileName: string,
  resolutionMode: EIConflictResolutionMode = 'GOVERNING_EI_RULE',
  selectedSheetNames?: string[],
  autoReferenceData?: {
    sheetName: string;
    records: EIReferenceRecord[];
    inspectedFormulas: EIInspectedFormulaPattern[];
  }
): EILogGenerationResult {
  const activeSheetSet = selectedSheetNames
    ? new Set(selectedSheetNames)
    : new Set(
        discoveredSheets
          .filter(s => s.sheetRole === 'DISCIPLINE_REGISTER' && s.isSelectedByDefault)
          .map(s => s.sheetName)
      );

  const filteredRows = allValidRows.filter(r => activeSheetSet.has(r.sheetName));
  const unprocessedRecords: EIUnprocessedRecord[] = [
    ...initialUnprocessed.filter(u => activeSheetSet.has(u.sheetName))
  ];
  const validationIssues: EIValidationIssue[] = [];
  let issueCounter = 1;
  const nextIssueId = () => `EI-ISS-${String(issueCounter++).padStart(4, '0')}`;

  // Log any discipline sheet with missing required columns
  for (const s of discoveredSheets) {
    if (s.sheetRole === 'DISCIPLINE_REGISTER' && s.missingRequiredColumns.length > 0) {
      validationIssues.push({
        id: nextIssueId(),
        severity: s.validSubmittalRows === 0 ? 'ERROR' : 'WARNING',
        type: 'MISSING_REQUIRED_SHEET_COLUMNS',
        sheetName: s.sheetName,
        excelRowNumbers: s.headerRowNumber > 0 ? [s.headerRowNumber] : [],
        subRef: '-',
        messageEn: `Sheet '${s.sheetName}' is missing required column(s): ${s.missingRequiredColumns.join(', ')}`,
        messageAr: `الشيت '${s.sheetName}' يفتقد الأعمدة المطلوبة: ${s.missingRequiredColumns.join('، ')}`
      });
    }
  }

  // Log unprocessed rows (e.g. missing SUB Ref.) as validation errors
  for (const unp of unprocessedRecords) {
    if (!unp.rawSubRef || ['-', 'N/A', 'NONE', 'NULL'].includes(unp.rawSubRef.toUpperCase())) {
      validationIssues.push({
        id: nextIssueId(),
        severity: 'ERROR',
        type: 'MISSING_SUB_REF',
        sheetName: unp.sheetName,
        excelRowNumbers: [unp.excelRowNumber],
        subRef: '(Missing SUB Ref.)',
        dwgNo: unp.rawDwgNo || undefined,
        messageEn: `Row ${unp.excelRowNumber} in sheet '${unp.sheetName}' has drawing/revision data (${unp.rawDwgNo || 'No DWG'}, Rev: ${unp.rawRev || 'blank'}) but is missing SUB Ref.`,
        messageAr: `الصف رقم ${unp.excelRowNumber} في شيت '${unp.sheetName}' يحتوي على بيانات رسم (${unp.rawDwgNo || 'بدون رقم رسم'}) ولكنه يفتقد رقم التقديم SUB Ref.`
      });
    }
  }

  // Group valid rows by normalized SUB Ref.
  const subGroups = new Map<string, EISourceRowEvidence[]>();
  for (const row of filteredRows) {
    const key = row.normalizedSubRef;
    let group = subGroups.get(key);
    if (!group) {
      group = [];
      subGroups.set(key, group);
    }
    group.push(row);
  }

  const records: EILogRecord[] = [];
  let totalDuplicateRev00DrawingsCount = 0;

  subGroups.forEach(groupRows => {
    const firstRow = groupRows[0];
    const displaySubRef = firstRow.rawSubRef;
    const discipline = firstRow.discipline;
    const sourceSheets = Array.from(new Set(groupRows.map(r => r.sheetName)));
    const excelRowNumbers = groupRows.map(r => `${r.sheetName}!R${r.excelRowNumber}`);

    const conflictTypes: EIConflictType[] = [];
    const conflictDetails: string[] = [];
    const resolutionNotes: string[] = [];

    // Check 1: Cross-Sheet Duplicate SUB Ref.
    if (sourceSheets.length > 1) {
      conflictTypes.push('CROSS_SHEET_DUPLICATE_SUB_REF');
      const detailEn = `SUB Ref. '${displaySubRef}' appears across multiple discipline sheets: ${sourceSheets.join(', ')}`;
      conflictDetails.push(detailEn);
      validationIssues.push({
        id: nextIssueId(),
        severity: 'CONFLICT',
        type: 'CROSS_SHEET_DUPLICATE_SUB_REF',
        sheetName: sourceSheets.join(', '),
        excelRowNumbers: groupRows.map(r => r.excelRowNumber),
        subRef: displaySubRef,
        conflictingValues: sourceSheets,
        messageEn: detailEn,
        messageAr: `رقم التقديم '${displaySubRef}' مكرر بين أكثر من شيت تخصص: ${sourceSheets.join('، ')}`
      });
    }

    // Check 2: Invalid or Missing Revisions within the Submittal
    const invalidRevRows = groupRows.filter(r => !r.isValidRev);
    const validRevRows = groupRows.filter(r => r.isValidRev);

    if (invalidRevRows.length > 0) {
      conflictTypes.push('INVALID_OR_MISSING_REVISION');
      const rowList = invalidRevRows.map(r => `${r.sheetName}!R${r.excelRowNumber}`).join(', ');
      const detailEn = `${invalidRevRows.length} row(s) have missing/invalid Rev. (${rowList}) and were excluded from Last Rev. determination`;
      conflictDetails.push(detailEn);
      validationIssues.push({
        id: nextIssueId(),
        severity: validRevRows.length === 0 ? 'ERROR' : 'WARNING',
        type: 'INVALID_OR_MISSING_REVISION',
        sheetName: invalidRevRows[0].sheetName,
        excelRowNumbers: invalidRevRows.map(r => r.excelRowNumber),
        subRef: displaySubRef,
        conflictingValues: invalidRevRows.map(r => r.rawRev || '(blank)'),
        messageEn: detailEn,
        messageAr: `يوجد ${invalidRevRows.length} صف بدون رقم مراجعة صالح (${rowList}) وتم استبعادها عند تحديد Last Rev.`
      });
    }

    // Check 3: Revision 00 Analysis (Rev00.Date Sent & Rev00.Total Sheets)
    const rev00Rows = validRevRows.filter(r => r.isRev0);
    let rev00DateSent = '';
    let rev00TotalSheets = 0;
    const rev00DistinctDrawings: string[] = [];
    let duplicateRev00DrawingsForSub = 0;

    if (rev00Rows.length === 0) {
      conflictTypes.push('MISSING_REV00_BASELINE');
      const detailEn = `SUB Ref. '${displaySubRef}' has no Revision 00 rows (found revisions: ${Array.from(new Set(validRevRows.map(r => r.normalizedRev))).join(', ') || 'none'})`;
      conflictDetails.push(detailEn);
      validationIssues.push({
        id: nextIssueId(),
        severity: 'ERROR',
        type: 'MISSING_REV00_BASELINE',
        sheetName: firstRow.sheetName,
        excelRowNumbers: groupRows.map(r => r.excelRowNumber),
        subRef: displaySubRef,
        messageEn: detailEn,
        messageAr: `التقديم '${displaySubRef}' لا يحتوي على أي صف للمراجعة الأساسية Rev 00`
      });
    } else {
      // 3a. Rev00.Date Sent
      const nonEmptyRev00Dates = rev00Rows.map(r => r.dateSent).filter(Boolean);
      const distinctRev00Dates = Array.from(new Set(nonEmptyRev00Dates)).sort();

      if (distinctRev00Dates.length === 0) {
        conflictTypes.push('MISSING_REV00_DATE_SENT');
        const detailEn = `Rev 00 rows for '${displaySubRef}' have missing Date Sent`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: 'ERROR',
          type: 'MISSING_REV00_DATE_SENT',
          sheetName: rev00Rows[0].sheetName,
          excelRowNumbers: rev00Rows.map(r => r.excelRowNumber),
          subRef: displaySubRef,
          messageEn: detailEn,
          messageAr: `صفوف Rev 00 للتقديم '${displaySubRef}' لا تحتوي على تاريخ إرسال (Date Sent)`
        });
      } else if (distinctRev00Dates.length === 1) {
        rev00DateSent = distinctRev00Dates[0];
        if (nonEmptyRev00Dates.length < rev00Rows.length) {
          conflictTypes.push('PARTIAL_MISSING_REV00_DATE_SENT');
          const blankDateRows = rev00Rows.filter(r => !r.dateSent).map(r => r.excelRowNumber);
          validationIssues.push({
            id: nextIssueId(),
            severity: 'WARNING',
            type: 'PARTIAL_MISSING_REV00_DATE_SENT',
            sheetName: rev00Rows[0].sheetName,
            excelRowNumbers: blankDateRows,
            subRef: displaySubRef,
            messageEn: `Some Rev 00 rows in '${displaySubRef}' have blank Date Sent (rows: ${blankDateRows.join(', ')}); used consistent date '${rev00DateSent}'`,
            messageAr: `بعض صفوف Rev 00 للتقديم '${displaySubRef}' بدون تاريخ إرسال؛ تم اعتماد التاريخ المتطابق '${rev00DateSent}'`
          });
        }
      } else {
        // Multiple distinct Rev00.Date Sent values across drawings in Rev 00!
        conflictTypes.push('REV00_DATE_SENT_CONFLICT');
        const dateBreakdown = rev00Rows
          .map(r => `${r.rawDwgNo || 'Row ' + r.excelRowNumber}: ${r.dateSent || '(blank)'}`)
          .join('; ');
        if (resolutionMode === 'HOLD_ON_CONFLICT') {
          rev00DateSent = 'CONFLICT';
          resolutionNotes.push(`Rev00.Date Sent held due to conflict (${distinctRev00Dates.join(' vs ')})`);
        } else if (resolutionMode === 'EXCEL_LAST_MATCH') {
          rev00DateSent = nonEmptyRev00Dates[nonEmptyRev00Dates.length - 1];
          resolutionNotes.push(`Rev00.Date Sent resolved via Last-Row Match (${rev00DateSent})`);
        } else {
          // Both GOVERNING_EI_RULE and EXCEL_FIRST_MATCH deterministically take first Rev00 row date (or earliest)
          rev00DateSent = nonEmptyRev00Dates[0];
          resolutionNotes.push(
            `Rev00.Date Sent conflict (${distinctRev00Dates.join(' vs ')}) -> Applied deterministic First-Rev00 Row Rule: ${rev00DateSent}`
          );
        }
        const detailEn = `Conflicting Rev00.Date Sent across drawings of '${displaySubRef}': [${distinctRev00Dates.join(', ')}] (${dateBreakdown})`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: 'CONFLICT',
          type: 'REV00_DATE_SENT_CONFLICT',
          sheetName: rev00Rows[0].sheetName,
          excelRowNumbers: rev00Rows.map(r => r.excelRowNumber),
          subRef: displaySubRef,
          conflictingValues: distinctRev00Dates,
          resolutionApplied: rev00DateSent,
          messageEn: detailEn,
          messageAr: `تعارض في تاريخ إرسال المراجعة الصفرية Rev00.Date Sent بين رسومات التقديم '${displaySubRef}': [${distinctRev00Dates.join('، ')}]`
        });
      }

      // 3b. Rev00.Total Sheets (Strictly from distinct DWG No. in Revision 00)
      const seenDwgSet = new Set<string>();
      let missingDwgCount = 0;

      for (const r of rev00Rows) {
        const dwgKey = r.normalizedDwgNo;
        if (!dwgKey || ['-', 'N/A', 'NONE', 'NULL'].includes(dwgKey)) {
          missingDwgCount++;
        } else if (seenDwgSet.has(dwgKey)) {
          duplicateRev00DrawingsForSub++;
          totalDuplicateRev00DrawingsCount++;
        } else {
          seenDwgSet.add(dwgKey);
          rev00DistinctDrawings.push(r.rawDwgNo);
        }
      }

      if (missingDwgCount > 0) {
        conflictTypes.push('MISSING_DWG_NO_IN_REV00');
        const missingRows = rev00Rows
          .filter(r => !r.normalizedDwgNo || ['-', 'N/A', 'NONE', 'NULL'].includes(r.normalizedDwgNo))
          .map(r => r.excelRowNumber);
        const detailEn = `${missingDwgCount} Rev 00 row(s) in '${displaySubRef}' have missing DWG No. (rows: ${missingRows.join(', ')})`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: seenDwgSet.size === 0 ? 'ERROR' : 'WARNING',
          type: 'MISSING_DWG_NO_IN_REV00',
          sheetName: rev00Rows[0].sheetName,
          excelRowNumbers: missingRows,
          subRef: displaySubRef,
          messageEn: detailEn,
          messageAr: `يوجد ${missingDwgCount} صف في Rev 00 للتقديم '${displaySubRef}' بدون رقم رسم DWG No. (الصفوف: ${missingRows.join('، ')})`
        });
      }

      if (duplicateRev00DrawingsForSub > 0) {
        conflictTypes.push('DUPLICATE_DWG_IN_REV00');
        const detailEn = `SUB Ref. '${displaySubRef}' has ${ rev00Rows.length } Rev 00 rows but ${ seenDwgSet.size } distinct DWG No. (${duplicateRev00DrawingsForSub} duplicate DWG row(s) deduplicated)`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: 'WARNING',
          type: 'DUPLICATE_DWG_IN_REV00',
          sheetName: rev00Rows[0].sheetName,
          excelRowNumbers: rev00Rows.map(r => r.excelRowNumber),
          subRef: displaySubRef,
          messageEn: detailEn,
          messageAr: `التقديم '${displaySubRef}' يحتوي على ${duplicateRev00DrawingsForSub} رقم رسم DWG No. مكرر داخل Rev 00؛ تم احتساب الرسومات المميزة فقط (${seenDwgSet.size})`
        });
      }

      rev00TotalSheets = seenDwgSet.size;
    }

    // Check 4: Last Rev., Date Return, and Code.1
    let lastRev = '';
    let dateReturn = '';
    let code1 = '';
    let lastRevRowCount = 0;

    if (validRevRows.length === 0) {
      conflictTypes.push('ALL_REVISIONS_INVALID');
      const detailEn = `SUB Ref. '${displaySubRef}' has no valid revision across all ${groupRows.length} row(s)`;
      conflictDetails.push(detailEn);
      validationIssues.push({
        id: nextIssueId(),
        severity: 'ERROR',
        type: 'ALL_REVISIONS_INVALID',
        sheetName: firstRow.sheetName,
        excelRowNumbers: groupRows.map(r => r.excelRowNumber),
        subRef: displaySubRef,
        messageEn: detailEn,
        messageAr: `جميع صفوف التقديم '${displaySubRef}' تفتقد رقم مراجعة صالح`
      });
    } else {
      let maxRevWeight = -1;
      for (const r of validRevRows) {
        if (r.revisionWeight > maxRevWeight) {
          maxRevWeight = r.revisionWeight;
        }
      }

      const latestRevRows = validRevRows.filter(r => r.revisionWeight === maxRevWeight);
      lastRevRowCount = latestRevRows.length;
      lastRev = latestRevRows[0].normalizedRev || formatCanonicalEIRevision(latestRevRows[0].rawRev, latestRevRows[0].isRev0);

      // Analyze Date Return & Code across all rows in Last Rev.
      const distinctReturnDates = Array.from(
        new Set(latestRevRows.map(r => r.dateReturn).filter(Boolean))
      ).sort();
      const blankReturnRows = latestRevRows.filter(r => !r.dateReturn);
      const distinctCodes = Array.from(
        new Set(latestRevRows.map(r => r.normalizedCode).filter(Boolean))
      );

      const hasPartialReturn =
        distinctReturnDates.length > 0 && blankReturnRows.length > 0;
      const hasMultipleReturnDates = distinctReturnDates.length > 1;
      const hasMultipleCodes = distinctCodes.length > 1;

      if (hasPartialReturn) {
        conflictTypes.push('PARTIAL_RETURN_IN_LAST_REV');
        const detailEn = `In Last Rev. (${lastRev}) of '${displaySubRef}', ${latestRevRows.length - blankReturnRows.length} drawing(s) have Date Return [${distinctReturnDates.join(', ')}] while ${blankReturnRows.length} drawing(s) have no Date Return`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: 'CONFLICT',
          type: 'PARTIAL_RETURN_IN_LAST_REV',
          sheetName: latestRevRows[0].sheetName,
          excelRowNumbers: latestRevRows.map(r => r.excelRowNumber),
          subRef: displaySubRef,
          conflictingValues: [...distinctReturnDates, '(blank / Under Review)'],
          messageEn: detailEn,
          messageAr: `في المراجعة الأخيرة (${lastRev}) للتقديم '${displaySubRef}'، بعض الرسومات تم الرد عليها وبعضها لم يُرد عليها بعد`
        });
      }

      if (hasMultipleReturnDates) {
        conflictTypes.push('LAST_REV_DATE_RETURN_CONFLICT');
        const breakdown = latestRevRows
          .map(r => `${r.rawDwgNo || 'R' + r.excelRowNumber}: ${r.dateReturn || '(blank)'}`)
          .join('; ');
        const detailEn = `Conflicting Date Return values in Last Rev. (${lastRev}) of '${displaySubRef}': [${distinctReturnDates.join(', ')}] (${breakdown})`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: 'CONFLICT',
          type: 'LAST_REV_DATE_RETURN_CONFLICT',
          sheetName: latestRevRows[0].sheetName,
          excelRowNumbers: latestRevRows.map(r => r.excelRowNumber),
          subRef: displaySubRef,
          conflictingValues: distinctReturnDates,
          messageEn: detailEn,
          messageAr: `تعارض في تاريخ الرد Date Return بين رسومات المراجعة الأخيرة (${lastRev}) للتقديم '${displaySubRef}': [${distinctReturnDates.join('، ')}]`
        });
      }

      if (hasMultipleCodes) {
        conflictTypes.push('LAST_REV_CODE_CONFLICT');
        const breakdown = latestRevRows
          .map(r => `${r.rawDwgNo || 'R' + r.excelRowNumber}: ${r.normalizedCode || '(blank)'}`)
          .join('; ');
        const detailEn = `Conflicting Code.1 values in Last Rev. (${lastRev}) of '${displaySubRef}': [${distinctCodes.join(', ')}] (${breakdown})`;
        conflictDetails.push(detailEn);
        validationIssues.push({
          id: nextIssueId(),
          severity: 'CONFLICT',
          type: 'LAST_REV_CODE_CONFLICT',
          sheetName: latestRevRows[0].sheetName,
          excelRowNumbers: latestRevRows.map(r => r.excelRowNumber),
          subRef: displaySubRef,
          conflictingValues: distinctCodes,
          messageEn: detailEn,
          messageAr: `تعارض في كود الاعتماد Code.1 بين رسومات المراجعة الأخيرة (${lastRev}) للتقديم '${displaySubRef}': [${distinctCodes.join('، ')}]`
        });
      }

      // Deterministic Resolution of Date Return & Code.1 (Never Random!)
      if (!hasPartialReturn && !hasMultipleReturnDates && !hasMultipleCodes) {
        // 100% consistent across all sheets in Last Rev.
        dateReturn = distinctReturnDates[0] || '';
        code1 = distinctCodes[0] || (dateReturn ? '' : 'UR');
        resolutionNotes.push(
          `Consistent across all ${latestRevRows.length} sheet(s) at Last Rev. (${lastRev})`
        );
      } else if (resolutionMode === 'HOLD_ON_CONFLICT') {
        dateReturn = hasMultipleReturnDates || hasPartialReturn ? 'CONFLICT' : distinctReturnDates[0] || '';
        code1 = hasMultipleCodes || hasPartialReturn ? 'CONFLICT' : distinctCodes[0] || '';
        resolutionNotes.push('Held for manual conflict review (HOLD_ON_CONFLICT mode)');
      } else if (resolutionMode === 'EXCEL_FIRST_MATCH') {
        const firstLatest = latestRevRows[0];
        dateReturn = firstLatest.dateReturn || '';
        code1 = firstLatest.normalizedCode || (dateReturn ? '' : 'UR');
        resolutionNotes.push(
          `Resolved via Excel First-Row Lookup (Sheet ${firstLatest.sheetName}!R${firstLatest.excelRowNumber})`
        );
      } else if (resolutionMode === 'EXCEL_LAST_MATCH') {
        const lastLatest = latestRevRows[latestRevRows.length - 1];
        dateReturn = lastLatest.dateReturn || '';
        code1 = lastLatest.normalizedCode || (dateReturn ? '' : 'UR');
        resolutionNotes.push(
          `Resolved via Excel Last-Row Lookup (Sheet ${lastLatest.sheetName}!R${lastLatest.excelRowNumber})`
        );
      } else {
        // GOVERNING_EI_RULE (Default Certified Engineering Rule):
        // 1. If any sheet in Last Rev. is still Under Review (UR / no return date), package is Under Review ('UR', Date Return = '').
        // 2. Otherwise, governing status code is the most restrictive code among Last Rev. sheets (D > C > B > A),
        //    and Date Return is the latest completion return date (MAX Date Return) of the Last Rev. package.
        const sortedBySeverity = [...latestRevRows].sort((a, b) => {
          const sevDiff =
            getEICodeGoverningSeverity(b.normalizedCode, Boolean(b.dateReturn)) -
            getEICodeGoverningSeverity(a.normalizedCode, Boolean(a.dateReturn));
          if (sevDiff !== 0) return sevDiff;
          return (b.dateReturn || '').localeCompare(a.dateReturn || '');
        });
        const governingRow = sortedBySeverity[0];
        const isPackageUnderReview =
          governingRow.normalizedCode === 'UR' || (!governingRow.normalizedCode && !governingRow.dateReturn);

        if (isPackageUnderReview) {
          code1 = 'UR';
          dateReturn = '';
          resolutionNotes.push(
            `Governing EI Rule: Package remains Under Review ('UR') because sheet ${governingRow.rawDwgNo || 'R' + governingRow.excelRowNumber} is not yet returned`
          );
        } else {
          code1 = governingRow.normalizedCode;
          dateReturn =
            distinctReturnDates.length > 0
              ? distinctReturnDates[distinctReturnDates.length - 1]
              : governingRow.dateReturn;
          resolutionNotes.push(
            `Governing EI Rule: Worst-case code '${code1}' (from ${governingRow.rawDwgNo || 'R' + governingRow.excelRowNumber}) & package completion Date Return '${dateReturn}'`
          );
        }
      }
    }

    const allRevisionsFound = Array.from(
      new Set(validRevRows.map(r => r.normalizedRev).filter(Boolean))
    ).sort((a, b) => compareRevisionsCanonical(a, b));

    records.push({
      subRef: displaySubRef,
      rev00DateSent,
      dateReturn,
      lastRev,
      rev00TotalSheets,
      code1,
      discipline,
      sourceSheets,
      excelRowNumbers,
      totalSourceRows: groupRows.length,
      rev00RowCount: rev00Rows.length,
      rev00DistinctDrawings,
      duplicateRev00DrawingsCount: duplicateRev00DrawingsForSub,
      lastRevRowCount,
      allRevisionsFound,
      invalidRevisionRowsCount: invalidRevRows.length,
      hasConflict: conflictTypes.length > 0,
      conflictTypes,
      conflictDetails,
      resolutionRuleApplied: resolutionNotes.join(' | ') || 'Standard Canonical EI Extraction',
      sourceRows: groupRows
    });
  });

  // Build Discipline Breakdown Summary
  const discMap = new Map<
    string,
    {
      discipline: string;
      sheetNames: Set<string>;
      rawRows: number;
      uniqueSubmittals: number;
      rev00TotalSheetsSum: number;
      conflictedSubmittals: number;
      unprocessedRows: number;
    }
  >();

  for (const s of discoveredSheets) {
    if (s.sheetRole === 'DISCIPLINE_REGISTER' && activeSheetSet.has(s.sheetName)) {
      let entry = discMap.get(s.detectedDiscipline);
      if (!entry) {
        entry = {
          discipline: s.detectedDiscipline,
          sheetNames: new Set(),
          rawRows: 0,
          uniqueSubmittals: 0,
          rev00TotalSheetsSum: 0,
          conflictedSubmittals: 0,
          unprocessedRows: 0
        };
        discMap.set(s.detectedDiscipline, entry);
      }
      entry.sheetNames.add(s.sheetName);
      entry.rawRows += s.totalDataRows;
      entry.unprocessedRows += s.unprocessedRows;
    }
  }

  for (const rec of records) {
    let entry = discMap.get(rec.discipline);
    if (!entry) {
      entry = {
        discipline: rec.discipline,
        sheetNames: new Set(rec.sourceSheets),
        rawRows: rec.totalSourceRows,
        uniqueSubmittals: 0,
        rev00TotalSheetsSum: 0,
        conflictedSubmittals: 0,
        unprocessedRows: 0
      };
      discMap.set(rec.discipline, entry);
    }
    entry.uniqueSubmittals++;
    entry.rev00TotalSheetsSum += rec.rev00TotalSheets;
    if (rec.hasConflict) {
      entry.conflictedSubmittals++;
    }
  }

  const byDisciplineBreakdown = Array.from(discMap.values()).map(d => ({
    discipline: d.discipline,
    sheetNames: Array.from(d.sheetNames),
    rawRows: d.rawRows,
    uniqueSubmittals: d.uniqueSubmittals,
    rev00TotalSheetsSum: d.rev00TotalSheetsSum,
    conflictedSubmittals: d.conflictedSubmittals,
    unprocessedRows: d.unprocessedRows
  }));

  const conflictedSubmittalsCount = records.filter(r => r.hasConflict).length;
  const consolidatedDuplicateRowsCount = Math.max(0, filteredRows.length - records.length);

  const summary: EIVerificationSummary = {
    totalSheetsInWorkbook: discoveredSheets.length,
    discoveredDisciplineSheetsCount: discoveredSheets.filter(
      s => s.sheetRole === 'DISCIPLINE_REGISTER'
    ).length,
    disciplinesList: byDisciplineBreakdown.map(d => d.discipline),
    totalRawRowsScanned: filteredRows.length + unprocessedRecords.length,
    validRowsProcessed: filteredRows.length,
    extractedSubmittalsCount: records.length,
    consolidatedDuplicateRowsCount,
    duplicateRev00DrawingsCount: totalDuplicateRev00DrawingsCount,
    conflictedSubmittalsCount,
    cleanSubmittalsCount: records.length - conflictedSubmittalsCount,
    unprocessedRecordsCount: unprocessedRecords.length,
    validationErrorsCount: validationIssues.filter(i => i.severity === 'ERROR').length,
    validationConflictsCount: validationIssues.filter(i => i.severity === 'CONFLICT').length,
    validationWarningsCount: validationIssues.filter(i => i.severity === 'WARNING').length,
    byDisciplineBreakdown
  };

  let autoDetectedReferenceReport: EIReferenceReconciliationReport | undefined;
  if (autoReferenceData && autoReferenceData.records.length > 0) {
    autoDetectedReferenceReport = compareWithReferenceEILog(
      records,
      autoReferenceData.records,
      autoReferenceData.sheetName,
      autoReferenceData.inspectedFormulas
    );
  }

  return {
    fileName,
    generatedAt: new Date().toISOString(),
    resolutionMode,
    discoveredSheets,
    records,
    validationIssues,
    unprocessedRecords,
    summary,
    autoDetectedReferenceReport
  };
}

// ============================================================================
// 6. ENTRY POINTS: FROM RAW EXCEL BUFFER/WORKBOOK OR FROM SUBMITTAL ROWS
// ============================================================================

export function generateEILogFromWorkbook(
  wb: XLSX.WorkBook,
  fileName: string,
  options?: {
    resolutionMode?: EIConflictResolutionMode;
    selectedSheetNames?: string[];
  }
): EILogGenerationResult {
  const discoveredSheets: EIDiscoveredSheet[] = [];
  const allValidRows: EISourceRowEvidence[] = [];
  const allUnprocessed: EIUnprocessedRecord[] = [];
  let autoReferenceData:
    | {
        sheetName: string;
        records: EIReferenceRecord[];
        inspectedFormulas: EIInspectedFormulaPattern[];
      }
    | undefined;

  wb.SheetNames.forEach((sheetName, idx) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const parsed = inspectAndParseWorksheet(ws, sheetName, idx);
    discoveredSheets.push(parsed.discovered);
    allValidRows.push(...parsed.validRows);
    allUnprocessed.push(...parsed.unprocessed);
    if (parsed.referenceData && !autoReferenceData) {
      autoReferenceData = {
        sheetName,
        records: parsed.referenceData.records,
        inspectedFormulas: parsed.referenceData.inspectedFormulas
      };
    }
  });

  return compileEILogFromEvidenceRows(
    allValidRows,
    discoveredSheets,
    allUnprocessed,
    fileName,
    options?.resolutionMode ?? 'GOVERNING_EI_RULE',
    options?.selectedSheetNames,
    autoReferenceData
  );
}

export function generateEILogFromExcelBuffer(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
  options?: {
    resolutionMode?: EIConflictResolutionMode;
    selectedSheetNames?: string[];
  }
): EILogGenerationResult {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: true,
    cellNF: true
  });
  return generateEILogFromWorkbook(wb, fileName, options);
}

/**
 * Generates an EI Log directly from StructuSight's parsed SubmittalRow[] dataset
 * (when the user has already loaded Shop Drawing Registers in the main platform).
 */
export function generateEILogFromSubmittalRows(
  rows: SubmittalRow[],
  fileName: string = 'Active Platform Dataset',
  resolutionMode: EIConflictResolutionMode = 'GOVERNING_EI_RULE'
): EILogGenerationResult {
  const sdwRows = (rows || []).filter(r => {
    const reg = (r.registerIdentity || r.documentType || r.logType || '').toUpperCase();
    return (
      reg.includes('SDW') ||
      reg.includes('SHD') ||
      reg.includes('SHOP') ||
      (!reg.includes('NCR') && !reg.includes('SOR') && !reg.includes('RFI') && !reg.includes('LTR'))
    );
  });

  const sheetMap = new Map<string, EISourceRowEvidence[]>();
  sdwRows.forEach((r, idx) => {
    const sheetName = r.sourceSheetName || r.disciplineSourceSheet || r.discipline || 'SDW';
    const discInfo = detectSheetDisciplineCode(r.discipline || sheetName);
    const rawSubRef = (r.submissionRef || r.docNo || '').trim();
    const rawDwgNo = (r.drawingNo || r.sheetNo || r.docNo || '').trim();
    const rawRev = String(r.rev ?? '').trim();
    const dateSent = formatDate(r.submissionDate);
    const dateReturn = formatDate(r.responseDate);
    const rawCode = String(r.code ?? '').trim();
    const rawStatus = String(r.recordStatus || r.status || '').trim();

    if (!rawSubRef) return;

    const validRev = isValidRevision(rawRev);
    const rev0Flag = isRevision0(rawRev, r.isRev0);
    const revWeight = getRevisionWeight(rawRev);
    const normalizedRev = formatCanonicalEIRevision(rawRev, rev0Flag);
    const normalizedCode = normalizeEICode(rawCode, rawStatus, dateReturn);

    let list = sheetMap.get(sheetName);
    if (!list) {
      list = [];
      sheetMap.set(sheetName, list);
    }

    list.push({
      sheetName,
      discipline: discInfo.code,
      excelRowNumber: idx + 2,
      rawSubRef,
      normalizedSubRef: rawSubRef.toUpperCase().replace(/\s+/g, ' ').trim(),
      rawDwgNo,
      normalizedDwgNo: rawDwgNo.toUpperCase().replace(/\s+/g, ' ').trim(),
      rawRev,
      normalizedRev,
      revisionWeight: revWeight,
      isValidRev: validRev,
      isRev0: rev0Flag,
      dateSent,
      dateReturn,
      rawCode,
      normalizedCode,
      rawStatus,
      drawingTitle: r.subject || r.remarks || ''
    });
  });

  const discoveredSheets: EIDiscoveredSheet[] = [];
  const allValidRows: EISourceRowEvidence[] = [];
  let sIdx = 0;

  sheetMap.forEach((sRows, sName) => {
    const discInfo = detectSheetDisciplineCode(sName);
    discoveredSheets.push({
      sheetIndex: sIdx++,
      sheetName: sName,
      sheetRole: 'DISCIPLINE_REGISTER',
      detectedDiscipline: discInfo.code,
      disciplineLabel: discInfo.label,
      headerRowNumber: 1,
      totalDataRows: sRows.length,
      validSubmittalRows: sRows.length,
      unprocessedRows: 0,
      columnMappings: [
        { fieldKey: 'subRef', fieldLabel: 'SUB Ref.', required: true, matchedHeader: 'SUB Ref.', columnIndex: 0 },
        { fieldKey: 'dwgNo', fieldLabel: 'DWG No.', required: true, matchedHeader: 'DWG No.', columnIndex: 1 },
        { fieldKey: 'rev', fieldLabel: 'Rev.', required: true, matchedHeader: 'Rev.', columnIndex: 2 },
        { fieldKey: 'dateSent', fieldLabel: 'Date Sent', required: true, matchedHeader: 'Date Sent', columnIndex: 3 },
        { fieldKey: 'dateReturn', fieldLabel: 'Date Return', required: true, matchedHeader: 'Date Return', columnIndex: 4 },
        { fieldKey: 'code', fieldLabel: 'Code', required: true, matchedHeader: 'Code', columnIndex: 5 }
      ],
      missingRequiredColumns: [],
      isSelectedByDefault: true,
      statusMessageEn: `Loaded from active platform memory (${sRows.length} rows)`,
      statusMessageAr: `محمل من بيانات المنصة النشطة (${sRows.length} صف)`
    });
    allValidRows.push(...sRows);
  });

  return compileEILogFromEvidenceRows(
    allValidRows,
    discoveredSheets,
    [],
    fileName,
    resolutionMode
  );
}

// ============================================================================
// 7. REFERENCE EI LOG PARITY & FIELD-BY-FIELD RECONCILIATION
// ============================================================================

export function parseReferenceEILogBuffer(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string
): {
  referenceName: string;
  records: EIReferenceRecord[];
  inspectedFormulas: EIInspectedFormulaPattern[];
} {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: true,
    cellNF: true
  });

  // Look for a sheet with EI Log header or first non-empty sheet
  for (const sName of wb.SheetNames) {
    const ws = wb.Sheets[sName];
    if (!ws) continue;
    const extracted = extractReferenceEISheetFromWorksheet(ws, sName);
    if (extracted.records.length > 0) {
      return {
        referenceName: `${fileName} [${sName}]`,
        records: extracted.records,
        inspectedFormulas: extracted.inspectedFormulas
      };
    }
  }

  return { referenceName: fileName, records: [], inspectedFormulas: [] };
}

export function compareWithReferenceEILog(
  generatedRecords: EILogRecord[],
  referenceRecords: EIReferenceRecord[],
  referenceSourceName: string = 'Reference EI Log',
  inspectedFormulas: EIInspectedFormulaPattern[] = []
): EIReferenceReconciliationReport {
  const genMap = new Map<string, EILogRecord>();
  for (const g of generatedRecords) {
    genMap.set(g.subRef.trim().toUpperCase(), g);
  }

  const refMap = new Map<string, EIReferenceRecord>();
  for (const r of referenceRecords) {
    refMap.set(r.subRef.trim().toUpperCase(), r);
  }

  const missingInGenerated: string[] = [];
  const extraInGenerated: string[] = [];
  const discrepancies: EIReferenceDiscrepancy[] = [];

  const perColumnStats: EIReferenceReconciliationReport['perColumnStats'] = {
    'Rev00.Date Sent': { matched: 0, total: 0, matchPct: 100 },
    'Date Return': { matched: 0, total: 0, matchPct: 100 },
    'Last Rev.': { matched: 0, total: 0, matchPct: 100 },
    'Rev00.Total Sheets': { matched: 0, total: 0, matchPct: 100 },
    'Code.1': { matched: 0, total: 0, matchPct: 100 }
  };

  let matchedSubmittalCount = 0;
  let exactRowMatchesCount = 0;

  refMap.forEach((refRec, key) => {
    const genRec = genMap.get(key);
    if (!genRec) {
      missingInGenerated.push(refRec.subRef);
      discrepancies.push({
        subRef: refRec.subRef,
        field: 'SUB_REF_PRESENCE',
        expectedValue: refRec.subRef,
        actualValue: '(Missing)',
        explanationEn: `Submittal '${refRec.subRef}' exists in Reference EI Log (row ${refRec.excelRowNumber}) but was not found in generated output.`,
        explanationAr: `التقديم '${refRec.subRef}' موجود في سجل EI المرجعي (صف ${refRec.excelRowNumber}) ولكنه غير موجود في المخرجات.`,
        sourceTrace: `Ref Row ${refRec.excelRowNumber}`
      });
      return;
    }

    matchedSubmittalCount++;
    let rowAllMatched = true;
    const traceStr = `${genRec.excelRowNumbers.join(', ')} (${genRec.resolutionRuleApplied})`;

    // 1. Rev00.Date Sent
    perColumnStats['Rev00.Date Sent'].total++;
    if (genRec.rev00DateSent === refRec.rev00DateSent) {
      perColumnStats['Rev00.Date Sent'].matched++;
    } else {
      rowAllMatched = false;
      discrepancies.push({
        subRef: genRec.subRef,
        field: 'Rev00.Date Sent',
        expectedValue: refRec.rev00DateSent || '(blank)',
        actualValue: genRec.rev00DateSent || '(blank)',
        explanationEn: `Rev00.Date Sent mismatch for '${genRec.subRef}'`,
        explanationAr: `اختلاف في Rev00.Date Sent للتقديم '${genRec.subRef}'`,
        sourceTrace: traceStr
      });
    }

    // 2. Date Return
    perColumnStats['Date Return'].total++;
    if (genRec.dateReturn === refRec.dateReturn) {
      perColumnStats['Date Return'].matched++;
    } else {
      rowAllMatched = false;
      discrepancies.push({
        subRef: genRec.subRef,
        field: 'Date Return',
        expectedValue: refRec.dateReturn || '(blank)',
        actualValue: genRec.dateReturn || '(blank)',
        explanationEn: `Date Return mismatch for '${genRec.subRef}'`,
        explanationAr: `اختلاف في Date Return للتقديم '${genRec.subRef}'`,
        sourceTrace: traceStr
      });
    }

    // 3. Last Rev.
    perColumnStats['Last Rev.'].total++;
    const normGenRev = formatCanonicalEIRevision(genRec.lastRev, isRevision0(genRec.lastRev));
    const normRefRev = formatCanonicalEIRevision(refRec.lastRev, isRevision0(refRec.lastRev));
    if (normGenRev === normRefRev) {
      perColumnStats['Last Rev.'].matched++;
    } else {
      rowAllMatched = false;
      discrepancies.push({
        subRef: genRec.subRef,
        field: 'Last Rev.',
        expectedValue: refRec.lastRev || '(blank)',
        actualValue: genRec.lastRev || '(blank)',
        explanationEn: `Last Rev. mismatch for '${genRec.subRef}'`,
        explanationAr: `اختلاف في Last Rev. للتقديم '${genRec.subRef}'`,
        sourceTrace: traceStr
      });
    }

    // 4. Rev00.Total Sheets
    perColumnStats['Rev00.Total Sheets'].total++;
    if (genRec.rev00TotalSheets === refRec.rev00TotalSheets) {
      perColumnStats['Rev00.Total Sheets'].matched++;
    } else {
      rowAllMatched = false;
      discrepancies.push({
        subRef: genRec.subRef,
        field: 'Rev00.Total Sheets',
        expectedValue: String(refRec.rev00TotalSheets),
        actualValue: String(genRec.rev00TotalSheets),
        explanationEn: `Rev00.Total Sheets mismatch for '${genRec.subRef}' (Distinct Rev00 DWGs: ${genRec.rev00DistinctDrawings.join(', ')})`,
        explanationAr: `اختلاف في Rev00.Total Sheets للتقديم '${genRec.subRef}'`,
        sourceTrace: traceStr
      });
    }

    // 5. Code.1
    perColumnStats['Code.1'].total++;
    const normGenCode = normalizeEICode(genRec.code1, '', genRec.dateReturn);
    const normRefCode = normalizeEICode(refRec.code1, '', refRec.dateReturn);
    if (normGenCode === normRefCode) {
      perColumnStats['Code.1'].matched++;
    } else {
      rowAllMatched = false;
      discrepancies.push({
        subRef: genRec.subRef,
        field: 'Code.1',
        expectedValue: refRec.code1 || '(blank)',
        actualValue: genRec.code1 || '(blank)',
        explanationEn: `Code.1 mismatch for '${genRec.subRef}'`,
        explanationAr: `اختلاف في Code.1 للتقديم '${genRec.subRef}'`,
        sourceTrace: traceStr
      });
    }

    if (rowAllMatched) {
      exactRowMatchesCount++;
    }
  });

  genMap.forEach((genRec, key) => {
    if (!refMap.has(key)) {
      extraInGenerated.push(genRec.subRef);
      discrepancies.push({
        subRef: genRec.subRef,
        field: 'SUB_REF_PRESENCE',
        expectedValue: '(Not in Reference)',
        actualValue: genRec.subRef,
        explanationEn: `Submittal '${genRec.subRef}' was extracted from source sheet(s) [${genRec.sourceSheets.join(', ')}] but is absent from Reference EI Log.`,
        explanationAr: `التقديم '${genRec.subRef}' تم استخراجه من الشيت [${genRec.sourceSheets.join('، ')}] ولكنه غير مدرج في سجل EI المرجعي.`,
        sourceTrace: genRec.excelRowNumbers.join(', ')
      });
    }
  });

  let totalFieldsChecked = 0;
  let totalFieldsMatched = 0;
  (Object.keys(perColumnStats) as Array<keyof typeof perColumnStats>).forEach(colKey => {
    const st = perColumnStats[colKey];
    st.matchPct = st.total > 0 ? Number(((st.matched / st.total) * 100).toFixed(2)) : 100;
    totalFieldsChecked += st.total;
    totalFieldsMatched += st.matched;
  });

  const overallFieldMatchRatePct =
    totalFieldsChecked > 0
      ? Number(((totalFieldsMatched / totalFieldsChecked) * 100).toFixed(2))
      : 100;

  const is100PercentParity =
    discrepancies.length === 0 &&
    missingInGenerated.length === 0 &&
    extraInGenerated.length === 0 &&
    generatedRecords.length === referenceRecords.length;

  return {
    referenceSourceName,
    referenceSubmittalCount: referenceRecords.length,
    generatedSubmittalCount: generatedRecords.length,
    matchedSubmittalCount,
    missingInGenerated,
    extraInGenerated,
    exactRowMatchesCount,
    overallFieldMatchRatePct,
    is100PercentParity,
    inspectedFormulas,
    perColumnStats,
    discrepancies
  };
}

// ============================================================================
// 8. EXCEL WORKBOOK EXPORT ENGINE (STRICT 6-COLUMN ORDER + AUDIT TABS)
// ============================================================================

export function buildEILogExportWorkbook(
  result: EILogGenerationResult,
  referenceReport?: EIReferenceReconciliationReport
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Canonical 6-Column EI Log (Exact required column order)
  const eiLogAoA: (string | number)[][] = [
    [...EI_LOG_CANONICAL_COLUMNS],
    ...result.records.map(r => [
      r.subRef,
      r.rev00DateSent,
      r.dateReturn,
      r.lastRev,
      r.rev00TotalSheets,
      r.code1
    ])
  ];

  const wsEILog = XLSX.utils.aoa_to_sheet(eiLogAoA);
  wsEILog['!cols'] = [
    { wch: 28 }, // SUB Ref.
    { wch: 16 }, // Rev00.Date Sent
    { wch: 16 }, // Date Return
    { wch: 12 }, // Last Rev.
    { wch: 20 }, // Rev00.Total Sheets
    { wch: 12 }  // Code.1
  ];
  XLSX.utils.book_append_sheet(wb, wsEILog, 'EI Log');

  // Sheet 2: Source Traceability & Provenance
  const traceAoA: (string | number)[][] = [
    [
      'SUB Ref.',
      'Discipline',
      'Rev00.Date Sent',
      'Date Return',
      'Last Rev.',
      'Rev00.Total Sheets',
      'Code.1',
      'Source Sheet(s)',
      'Original Excel Rows',
      'Total Source Rows',
      'Rev00 Distinct DWG No.',
      'All Revisions Found',
      'Conflict Status',
      'Resolution Rule Applied'
    ],
    ...result.records.map(r => [
      r.subRef,
      r.discipline,
      r.rev00DateSent,
      r.dateReturn,
      r.lastRev,
      r.rev00TotalSheets,
      r.code1,
      r.sourceSheets.join(', '),
      r.excelRowNumbers.join(', '),
      r.totalSourceRows,
      r.rev00DistinctDrawings.join(', '),
      r.allRevisionsFound.join(', '),
      r.hasConflict ? `CONFLICT (${r.conflictTypes.join(', ')})` : 'CLEAN',
      r.resolutionRuleApplied
    ])
  ];
  const wsTrace = XLSX.utils.aoa_to_sheet(traceAoA);
  wsTrace['!cols'] = [
    { wch: 28 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 10 },
    { wch: 18 },
    { wch: 30 },
    { wch: 16 },
    { wch: 36 },
    { wch: 18 },
    { wch: 26 },
    { wch: 50 }
  ];
  XLSX.utils.book_append_sheet(wb, wsTrace, 'Traceability Audit');

  // Sheet 3: Validation & Conflicts
  const issuesAoA: (string | number)[][] = [
    [
      'Issue ID',
      'Severity',
      'Issue Type',
      'Sheet Name',
      'Excel Row(s)',
      'SUB Ref.',
      'DWG No.',
      'Conflicting Values',
      'Resolution Applied',
      'Description (EN)',
      'Description (AR)'
    ],
    ...result.validationIssues.map(iss => [
      iss.id,
      iss.severity,
      iss.type,
      iss.sheetName,
      iss.excelRowNumbers.join(', '),
      iss.subRef,
      iss.dwgNo || '-',
      (iss.conflictingValues || []).join(' | '),
      iss.resolutionApplied || '-',
      iss.messageEn,
      iss.messageAr
    ])
  ];
  const wsIssues = XLSX.utils.aoa_to_sheet(issuesAoA);
  wsIssues['!cols'] = [
    { wch: 14 },
    { wch: 12 },
    { wch: 30 },
    { wch: 16 },
    { wch: 16 },
    { wch: 26 },
    { wch: 22 },
    { wch: 28 },
    { wch: 20 },
    { wch: 60 },
    { wch: 60 }
  ];
  XLSX.utils.book_append_sheet(wb, wsIssues, 'Conflicts & Errors');

  // Sheet 4: Verification Summary
  const s = result.summary;
  const summaryAoA: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Source Workbook', result.fileName],
    ['Generated At', result.generatedAt],
    ['Resolution Mode', result.resolutionMode],
    ['Total Workbook Sheets', s.totalSheetsInWorkbook],
    ['Discovered Discipline Sheets', s.discoveredDisciplineSheetsCount],
    ['Disciplines Detected', s.disciplinesList.join(', ')],
    ['Total Raw Rows Scanned', s.totalRawRowsScanned],
    ['Valid Rows Processed', s.validRowsProcessed],
    ['Extracted Unique Submittals (EI Log Rows)', s.extractedSubmittalsCount],
    ['Consolidated Multi-Sheet / Revision Rows', s.consolidatedDuplicateRowsCount],
    ['Deduplicated Rev00 DWG No. Rows', s.duplicateRev00DrawingsCount],
    ['Clean Submittals (Zero Conflict)', s.cleanSubmittalsCount],
    ['Conflicted Submittals Flagged', s.conflictedSubmittalsCount],
    ['Unprocessed / Skipped Rows', s.unprocessedRecordsCount],
    [''],
    ['Discipline Breakdown', 'Sheets', 'Raw Rows', 'Unique Submittals', 'Rev00.Total Sheets Sum', 'Conflicted', 'Unprocessed'],
    ...s.byDisciplineBreakdown.map(d => [
      d.discipline,
      d.sheetNames.join(', '),
      d.rawRows,
      d.uniqueSubmittals,
      d.rev00TotalSheetsSum,
      d.conflictedSubmittals,
      d.unprocessedRows
    ])
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
  wsSummary['!cols'] = [
    { wch: 42 },
    { wch: 24 },
    { wch: 14 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 }
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Verification Summary');

  // Optional Sheet 5: Reference Reconciliation Report
  const activeRef = referenceReport || result.autoDetectedReferenceReport;
  if (activeRef) {
    const refAoA: (string | number)[][] = [
      ['Reference EI Log Reconciliation Summary', ''],
      ['Reference Source', activeRef.referenceSourceName],
      ['Reference Submittal Count', activeRef.referenceSubmittalCount],
      ['Generated Submittal Count', activeRef.generatedSubmittalCount],
      ['Matched Submittals Count', activeRef.matchedSubmittalCount],
      ['Exact Full-Row Matches', activeRef.exactRowMatchesCount],
      ['Overall Field Match Rate (%)', `${activeRef.overallFieldMatchRatePct}%`],
      ['100% Parity Status', activeRef.is100PercentParity ? 'CERTIFIED PASS' : 'VARIANCE DETECTED'],
      [''],
      ['Column Name', 'Matched', 'Total Compared', 'Match Rate (%)'],
      ...Object.entries(activeRef.perColumnStats).map(([colName, st]) => [
        colName,
        st.matched,
        st.total,
        `${st.matchPct}%`
      ]),
      [''],
      ['SUB Ref.', 'Field', 'Reference Expected', 'Generated Actual', 'Diagnostic Explanation', 'Source Trace'],
      ...activeRef.discrepancies.map(d => [
        d.subRef,
        d.field,
        d.expectedValue,
        d.actualValue,
        d.explanationEn,
        d.sourceTrace
      ])
    ];
    const wsRef = XLSX.utils.aoa_to_sheet(refAoA);
    wsRef['!cols'] = [
      { wch: 32 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 55 },
      { wch: 40 }
    ];
    XLSX.utils.book_append_sheet(wb, wsRef, 'Reference Parity');
  }

  return wb;
}

export function downloadEILogExcel(
  result: EILogGenerationResult,
  referenceReport?: EIReferenceReconciliationReport
): void {
  const wb = buildEILogExportWorkbook(result, referenceReport);
  const dateTag = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `StructuSight-EI-Log-${dateTag}.xlsx`);
}

// ============================================================================
// 9. CERTIFIED MULTI-DISCIPLINE BENCHMARK WORKBOOK & REFERENCE GENERATOR
// ============================================================================

/**
 * Builds a realistic multi-discipline Cumulative Shop Drawing Register workbook
 * with an embedded Reference `EI Log` sheet (with Excel formulas + verified values)
 * covering:
 * - Multiple disciplines in custom sheet order: ELEC, STR, ARCH, MECH, INFRA, LAND
 * - Multiple drawings (DWG No.) per SUB Ref. in Rev 00
 * - Multi-revision lifecycle (Rev 00 -> Rev 01 -> Rev 02)
 * - Duplicate DWG No. in Rev 00 (testing distinct DWG No. counting)
 * - Conflicting Date Return / Code across drawings in the same submittal
 * - Missing / invalid revision row handling & unprocessed row with missing SUB Ref.
 */
export function buildBenchmarkCumulativeSDWWorkbook(includeConflictCases: boolean = false): {
  workbook: XLSX.WorkBook;
  buffer: Buffer;
  expectedReferenceRecords: EIReferenceRecord[];
} {
  const wb = XLSX.utils.book_new();

  // Sheet 1: ELEC (placed first to test arbitrary sheet order)
  const elecRows: unknown[][] = [
    ['CUMULATIVE SHOP DRAWING REGISTER - ELECTRICAL (ELEC)'],
    ['SUB Ref.', 'DWG No.', 'Drawing Title', 'Rev.', 'Date Sent', 'Date Return', 'Code', 'Status'],
    // SUB-ELEC-001: 3 distinct drawings in Rev 00, all approved Code B on 2026-06-12
    ['INN-ACE-SDW-ELEC-0001', 'E-LP-101', 'Ground Floor Lighting Layout', '00', '2026-06-01', '2026-06-12', 'B', 'Approved as Noted'],
    ['INN-ACE-SDW-ELEC-0001', 'E-LP-102', 'First Floor Lighting Layout', '00', '2026-06-01', '2026-06-12', 'B', 'Approved as Noted'],
    ['INN-ACE-SDW-ELEC-0001', 'E-LP-103', 'Roof Lighting Layout', '00', '2026-06-01', '2026-06-12', 'B', 'Approved as Noted'],
    // SUB-ELEC-002: 2 drawings in Rev 00 (Rejected C on 2026-06-10), resubmitted in Rev 01 (Under Review / UR)
    ['INN-ACE-SDW-ELEC-0002', 'E-PW-201', 'Main MDB Single Line Diagram', '00', '2026-06-03', '2026-06-10', 'C', 'Revise & Resubmit'],
    ['INN-ACE-SDW-ELEC-0002', 'E-PW-202', 'Sub-Main Panel Schedule', '00', '2026-06-03', '2026-06-10', 'C', 'Revise & Resubmit'],
    ['INN-ACE-SDW-ELEC-0002', 'E-PW-201', 'Main MDB Single Line Diagram', '01', '2026-06-18', '', 'UR', 'Under Review'],
    ['INN-ACE-SDW-ELEC-0002', 'E-PW-202', 'Sub-Main Panel Schedule', '01', '2026-06-18', '', 'UR', 'Under Review']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(elecRows), 'ELEC');

  // Sheet 2: STR
  const strRows: unknown[][] = [
    ['CUMULATIVE SHOP DRAWING REGISTER - STRUCTURAL (STR)'],
    ['SUB Ref.', 'DWG No.', 'Drawing Title', 'Rev.', 'Date Sent', 'Date Return', 'Code', 'Status'],
    // SUB-STR-001: 4 distinct drawings in Rev 00 (+ 1 duplicate DWG row STR-FD-001), Rejected in Rev 00, Approved Code A in Rev 01
    ['INN-ACE-SDW-STR-0001', 'STR-FD-001', 'Raft Foundation General Arrangement', '00', '2026-05-10', '2026-05-20', 'C', 'Rejected'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-001', 'Raft Foundation General Arrangement (Duplicate Row)', '00', '2026-05-10', '2026-05-20', 'C', 'Rejected'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-002', 'Raft Bottom Reinforcement', '00', '2026-05-10', '2026-05-20', 'C', 'Rejected'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-003', 'Raft Top Reinforcement', '00', '2026-05-10', '2026-05-20', 'C', 'Rejected'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-004', 'Raft Edge Details', '00', '2026-05-10', '2026-05-20', 'C', 'Rejected'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-001', 'Raft Foundation General Arrangement', '01', '2026-05-25', '2026-06-02', 'A', 'Approved'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-002', 'Raft Bottom Reinforcement', '01', '2026-05-25', '2026-06-02', 'A', 'Approved'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-003', 'Raft Top Reinforcement', '01', '2026-05-25', '2026-06-02', 'A', 'Approved'],
    ['INN-ACE-SDW-STR-0001', 'STR-FD-004', 'Raft Edge Details', '01', '2026-05-25', '2026-06-02', 'A', 'Approved'],
    // Row with invalid/blank revision on STR-0001 that must be ignored for Last Rev.
    ['INN-ACE-SDW-STR-0001', 'STR-FD-004', 'Corrupted Blank Revision Note', '-', '2026-05-26', '', '', '']
  ];
  if (includeConflictCases) {
    // SUB-STR-002: Conflicting codes & return dates across drawings in Rev 00 (DWG 1 = A on 2026-06-14, DWG 2 = C on 2026-06-16)
    strRows.push(
      ['INN-ACE-SDW-STR-0002', 'STR-CL-101', 'Columns Schedule Zone A', '00', '2026-06-05', '2026-06-14', 'A', 'Approved'],
      ['INN-ACE-SDW-STR-0002', 'STR-CL-102', 'Columns Schedule Zone B', '00', '2026-06-05', '2026-06-16', 'C', 'Revise & Resubmit'],
      // Unprocessed row with missing SUB Ref.
      ['', 'STR-ORPHAN-99', 'Orphan Drawing Missing SUB Ref', '00', '2026-06-07', '', 'UR', 'Under Review']
    );
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(strRows), 'STR');

  // Sheet 3: ARCH
  const archRows: unknown[][] = [
    ['CUMULATIVE SHOP DRAWING REGISTER - ARCHITECTURAL (ARCH)'],
    ['SUB Ref.', 'DWG No.', 'Drawing Title', 'Rev.', 'Date Sent', 'Date Return', 'Code', 'Status'],
    // SUB-ARCH-001: 2 drawings in Rev 00 -> Rev 01 -> Rev 02 (Approved Code A on 2026-06-25)
    ['INN-ACE-SDW-ARCH-0001', 'A-PL-001', 'Basement Floor Plan', '00', '2026-05-04', '2026-05-14', 'C', 'Rejected'],
    ['INN-ACE-SDW-ARCH-0001', 'A-PL-002', 'Ground Floor Plan', '00', '2026-05-04', '2026-05-14', 'C', 'Rejected'],
    ['INN-ACE-SDW-ARCH-0001', 'A-PL-001', 'Basement Floor Plan', '01', '2026-05-20', '2026-05-30', 'C', 'Rejected'],
    ['INN-ACE-SDW-ARCH-0001', 'A-PL-002', 'Ground Floor Plan', '01', '2026-05-20', '2026-05-30', 'C', 'Rejected'],
    ['INN-ACE-SDW-ARCH-0001', 'A-PL-001', 'Basement Floor Plan', '02', '2026-06-15', '2026-06-25', 'A', 'Approved'],
    ['INN-ACE-SDW-ARCH-0001', 'A-PL-002', 'Ground Floor Plan', '02', '2026-06-15', '2026-06-25', 'A', 'Approved']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(archRows), 'ARCH');

  // Sheet 4: MECH
  const mechRows: unknown[][] = [
    ['CUMULATIVE SHOP DRAWING REGISTER - MECHANICAL (MECH)'],
    ['SUB Ref.', 'DWG No.', 'Drawing Title', 'Rev.', 'Date Sent', 'Date Return', 'Code', 'Status'],
    // SUB-MECH-001: 3 drawings in Rev 00, returned Code C on 2026-06-20
    ['INN-ACE-SDW-MECH-0001', 'M-HV-101', 'Chilled Water Piping Layout Z1', '00', '2026-06-08', '2026-06-20', 'C', 'Revise & Resubmit'],
    ['INN-ACE-SDW-MECH-0001', 'M-HV-102', 'Chilled Water Piping Layout Z2', '00', '2026-06-08', '2026-06-20', 'C', 'Revise & Resubmit'],
    ['INN-ACE-SDW-MECH-0001', 'M-HV-103', 'AHU Room Details', '00', '2026-06-08', '2026-06-20', 'C', 'Revise & Resubmit']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mechRows), 'MECH');

  // Sheet 5: Reference EI Log sheet (with formulas & verified values)
  const expectedReferenceRecords: EIReferenceRecord[] = [
    {
      excelRowNumber: 2,
      subRef: 'INN-ACE-SDW-ELEC-0001',
      rev00DateSent: '2026-06-01',
      dateReturn: '2026-06-12',
      lastRev: '00',
      rev00TotalSheets: 3,
      code1: 'B'
    },
    {
      excelRowNumber: 3,
      subRef: 'INN-ACE-SDW-ELEC-0002',
      rev00DateSent: '2026-06-03',
      dateReturn: '',
      lastRev: '01',
      rev00TotalSheets: 2,
      code1: 'UR'
    },
    {
      excelRowNumber: 4,
      subRef: 'INN-ACE-SDW-STR-0001',
      rev00DateSent: '2026-05-10',
      dateReturn: '2026-06-02',
      lastRev: '01',
      rev00TotalSheets: 4,
      code1: 'A'
    },
    ...(includeConflictCases
      ? [
          {
            excelRowNumber: 5,
            subRef: 'INN-ACE-SDW-STR-0002',
            rev00DateSent: '2026-06-05',
            dateReturn: '2026-06-16',
            lastRev: '00',
            rev00TotalSheets: 2,
            code1: 'C'
          }
        ]
      : []),
    {
      excelRowNumber: includeConflictCases ? 6 : 5,
      subRef: 'INN-ACE-SDW-ARCH-0001',
      rev00DateSent: '2026-05-04',
      dateReturn: '2026-06-25',
      lastRev: '02',
      rev00TotalSheets: 2,
      code1: 'A'
    },
    {
      excelRowNumber: includeConflictCases ? 7 : 6,
      subRef: 'INN-ACE-SDW-MECH-0001',
      rev00DateSent: '2026-06-08',
      dateReturn: '2026-06-20',
      lastRev: '00',
      rev00TotalSheets: 3,
      code1: 'C'
    }
  ];

  const refAoA: unknown[][] = [
    [...EI_LOG_CANONICAL_COLUMNS],
    ...expectedReferenceRecords.map(r => [
      r.subRef,
      r.rev00DateSent,
      r.dateReturn,
      r.lastRev,
      r.rev00TotalSheets,
      r.code1
    ])
  ];
  const wsRef = XLSX.utils.aoa_to_sheet(refAoA);
  // Attach representative Excel formulas to row 2 of EI Log reference sheet so Formula Inspector can audit them
  if (wsRef['B2']) wsRef['B2'].f = 'INDEX(ELEC!E:E, MATCH(1, (ELEC!A:A=A2)*(ELEC!D:D="00"), 0))';
  if (wsRef['C2']) wsRef['C2'].f = 'INDEX(ELEC!F:F, MATCH(1, (ELEC!A:A=A2)*(ELEC!D:D=D2), 0))';
  if (wsRef['D2']) wsRef['D2'].f = 'TEXT(MAXIFS(ELEC!D:D, ELEC!A:A, A2), "00")';
  if (wsRef['E2']) wsRef['E2'].f = 'COUNTA(UNIQUE(FILTER(ELEC!B:B, (ELEC!A:A=A2)*(ELEC!D:D="00"))))';
  if (wsRef['F2']) wsRef['F2'].f = 'INDEX(ELEC!G:G, MATCH(1, (ELEC!A:A=A2)*(ELEC!D:D=D2), 0))';

  XLSX.utils.book_append_sheet(wb, wsRef, 'EI Log');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { workbook: wb, buffer, expectedReferenceRecords };
}
