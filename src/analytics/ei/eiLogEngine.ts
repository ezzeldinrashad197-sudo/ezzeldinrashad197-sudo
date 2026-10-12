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
  'date sent',
  'sent date',
  'submission date',
  'submit date',
  'submittal date',
  'date submitted',
  'date of submission',
  'rev00.date sent',
  'rev00 date sent',
  'rev.00 date sent',
  'issue date',
  'date issued',
  'date in',
  'in date',
  'تاريخ التقديم',
  'تاريخ الإرسال',
  'تاريخ الطلب',
  'received date'
];

const DATE_RETURN_ALIASES = [
  'date return',
  'return date',
  'date returned',
  'returned date',
  'date of return',
  'actual return date',
  'date retrun',
  'retrun date',
  'date ret.',
  'date ret',
  'ret. date',
  'ret date',
  'response date',
  'date of response',
  'consultant response date',
  'consultant return date',
  'consultant response',
  'consultant return',
  'consultant date',
  'consultant reply date',
  'consultant reply',
  'consultant action date',
  'engineer response date',
  'engineer return date',
  'engineer date',
  'client response date',
  'reply date',
  'date replied',
  'replied date',
  'date of reply',
  'received date',
  'date received',
  'date of receipt',
  'receipt date',
  'date rec.',
  'date rec',
  'rec. date',
  'rec date',
  'approval date',
  'approved date',
  'date approved',
  'date of approval',
  'review date',
  'reviewed date',
  'date reviewed',
  'date of review',
  'action date',
  'status date',
  'closed date',
  'date closed',
  'closing date',
  'completion date',
  'closeout date',
  'verified date',
  'answered date',
  'disposition date',
  'sign off date',
  'clearance date',
  'date out',
  'out date',
  'return',
  'returned',
  'reply',
  'response',
  'تاريخ الرد',
  'تاريخ الإرجاع',
  'تاريخ الاعتماد',
  'تاريخ الاستشاري',
  'تاريخ الإغلاق',
  'تاريخ المراجعة',
  'تاريخ الانتهاء',
  'تاريخ الاستجابة',
  'تاريخ الفحص',
  'تاريخ الاستلام',
  'تاريخ العودة',
  'الرد'
];

const CODE_ALIASES = [
  'code',
  'code.1',
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
  'كود',
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

// Shared in-memory cache of the most recently uploaded Excel workbook buffer from the main platform header
let cachedPlatformWorkbook: { buffer: ArrayBuffer; fileName: string; updatedAt: number } | null = null;

export function registerPlatformWorkbookBuffer(buffer: ArrayBuffer, fileName: string): void {
  cachedPlatformWorkbook = {
    buffer: buffer.slice(0),
    fileName,
    updatedAt: Date.now()
  };
}

export function getPlatformWorkbookBuffer(): { buffer: ArrayBuffer; fileName: string; updatedAt: number } | null {
  return cachedPlatformWorkbook;
}

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1, january: 1, 'يناير': 1,
  feb: 2, february: 2, 'فبراير': 2,
  mar: 3, march: 3, 'مارس': 3,
  apr: 4, april: 4, 'ابريل': 4, 'أبريل': 4,
  may: 5, 'مايو': 5,
  jun: 6, june: 6, 'يونيو': 6,
  jul: 7, july: 7, 'يوليو': 7,
  aug: 8, august: 8, 'اغسطس': 8, 'أغسطس': 8,
  sep: 9, sept: 9, september: 9, 'سبتمبر': 9,
  oct: 10, october: 10, 'اكتوبر': 10, 'أكتوبر': 10,
  nov: 11, november: 11, 'نوفمبر': 11,
  dec: 12, december: 12, 'ديسمبر': 12
};

function buildSafeYMD(year: number, month: number, day: number): string {
  if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
  if (year < 1970 || year > 2100) return '';
  if (month < 1 || month > 12) return '';
  const maxDays = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDays) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateObjectToYMD(d: Date): string {
  if (isNaN(d.getTime())) return '';
  // Add 12 hours to prevent UTC midnight timezone rollback (e.g. 2025-11-24T22:00:00Z -> 2025-11-25)
  const adjusted = new Date(d.getTime() + 12 * 3600 * 1000);
  return buildSafeYMD(
    adjusted.getUTCFullYear(),
    adjusted.getUTCMonth() + 1,
    adjusted.getUTCDate()
  );
}

function excelSerialToYMD(serial: number): string {
  if (!isFinite(serial) || serial < 20000 || serial > 80000) return '';
  // Excel epoch: 25569 is 1970-01-01 UTC
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utcMs + 12 * 3600 * 1000);
  return buildSafeYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Ultra-resilient date extractor for Excel cells (supports Date objects, Excel serial numbers,
 * 2-digit and 4-digit year strings dd/mm/yy, dd/mm/yyyy, mm/dd/yy, dd-MMM-yy, timestamps,
 * formula cached values, and Eastern Arabic numerals).
 */
export function parseEIDateValue(
  rawVal: unknown,
  formattedVal?: unknown,
  cellObj?: XLSX.CellObject
): string {
  // 1. Direct Date instance
  if (rawVal instanceof Date) {
    const res = dateObjectToYMD(rawVal);
    if (res) return res;
  }
  if (cellObj?.v instanceof Date) {
    const res = dateObjectToYMD(cellObj.v);
    if (res) return res;
  }

  // 2. Numeric Excel serial
  if (typeof rawVal === 'number') {
    const res = excelSerialToYMD(rawVal);
    if (res) return res;
  }
  if (typeof cellObj?.v === 'number') {
    const res = excelSerialToYMD(cellObj.v);
    if (res) return res;
  }

  // 3. Candidate string representations
  const candidates: string[] = [];
  if (typeof formattedVal === 'string' && formattedVal.trim()) candidates.push(formattedVal.trim());
  if (typeof rawVal === 'string' && rawVal.trim()) candidates.push(rawVal.trim());
  if (typeof cellObj?.w === 'string' && cellObj.w.trim()) candidates.push(cellObj.w.trim());
  if (typeof cellObj?.v === 'string' && cellObj.v.trim()) candidates.push(cellObj.v.trim());

  for (const rawCandidate of candidates) {
    // Normalize Eastern Arabic numerals & invisible chars
    const str = rawCandidate
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[\u200B-\u200F\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();

    if (!str || ['-', '--', 'n/a', 'na', 'nil', 'none', 'null', 'ur', 'u.r', 'under review', 'pending', 'open', 'waiting'].includes(str.toLowerCase())) {
      continue;
    }

    // 3a. 5-digit Excel serial stored as string (e.g. "45986" or "45986.5")
    if (/^\d{5}(?:\.\d+)?$/.test(str)) {
      const serialRes = excelSerialToYMD( parseFloat(str) );
      if (serialRes) return serialRes;
      continue;
    }

    // Strip trailing time component if present (e.g. "25/11/2025 12:00:00 AM" or "2025-11-25T00:00:00")
    const datePartOnly = str
      .replace(/T\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i, '')
      .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|ص|م))?$/i, '')
      .trim();

    // 3b. YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    const ymdMatch = datePartOnly.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (ymdMatch) {
      const y = parseInt(ymdMatch[1], 10);
      const m = parseInt(ymdMatch[2], 10);
      const d = parseInt(ymdMatch[3], 10);
      const res = buildSafeYMD(y, m, d) || buildSafeYMD(y, d, m);
      if (res) return res;
    }

    // 3c. DD/MM/YYYY or MM/DD/YYYY (4-digit year)
    const dmy4Match = datePartOnly.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (dmy4Match) {
      const p1 = parseInt(dmy4Match[1], 10);
      const p2 = parseInt(dmy4Match[2], 10);
      const y = parseInt(dmy4Match[3], 10);
      // Prefer DD/MM/YYYY (standard in MENA/UK engineering registers), fallback to MM/DD/YYYY if p2 > 12
      const res = buildSafeYMD(y, p2, p1) || buildSafeYMD(y, p1, p2);
      if (res) return res;
    }

    // 3d. DD/MM/YY or MM/DD/YY (2-digit year, e.g. "25/11/25" or "04/01/26")
    const dmy2Match = datePartOnly.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
    if (dmy2Match) {
      const p1 = parseInt(dmy2Match[1], 10);
      const p2 = parseInt(dmy2Match[2], 10);
      const yy = parseInt(dmy2Match[3], 10);
      const fullYear = yy < 70 ? 2000 + yy : 1900 + yy;
      const res = buildSafeYMD(fullYear, p2, p1) || buildSafeYMD(fullYear, p1, p2);
      if (res) return res;
    }

    // 3e. DD-MMM-YYYY or DD-MMM-YY (e.g. "25-Nov-25", "25 Nov 2025")
    const dMonYMatch = datePartOnly.match(/^(\d{1,2})[\s\/\-.]+([A-Za-z\u0600-\u06FF]+)[\s\/\-.]+(\d{2,4})$/);
    if (dMonYMatch) {
      const d = parseInt(dMonYMatch[1], 10);
      const monToken = dMonYMatch[2].toLowerCase();
      const m = MONTH_NAME_MAP[monToken] || MONTH_NAME_MAP[monToken.slice(0, 3)];
      let y = parseInt(dMonYMatch[3], 10);
      if (y < 100) y = y < 70 ? 2000 + y : 1900 + y;
      if (m) {
        const res = buildSafeYMD(y, m, d);
        if (res) return res;
      }
    }

    // 3f. MMM DD, YYYY or MMM-DD-YY
    const monDYMatch = datePartOnly.match(/^([A-Za-z\u0600-\u06FF]+)[\s\/\-.]+(\d{1,2})[,\s\/\-.]+(\d{2,4})$/);
    if (monDYMatch) {
      const monToken = monDYMatch[1].toLowerCase();
      const m = MONTH_NAME_MAP[monToken] || MONTH_NAME_MAP[monToken.slice(0, 3)];
      const d = parseInt(monDYMatch[2], 10);
      let y = parseInt(monDYMatch[3], 10);
      if (y < 100) y = y < 70 ? 2000 + y : 1900 + y;
      if (m) {
        const res = buildSafeYMD(y, m, d);
        if (res) return res;
      }
    }

    // 3g. Fallback to platform formatDate if it produces a valid year in 1970..2100
    const stdFormatted = formatDate(datePartOnly);
    if (stdFormatted && /^(19[7-9]\d|20\d{2})-\d{2}-\d{2}$/.test(stdFormatted)) {
      return stdFormatted;
    }
  }

  return '';
}

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
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeHeaderTokens(val: unknown): string {
  return normalizeHeaderCell(val)
    .replace(/[_/\-.:;()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatchingColumnIndex(
  headers: string[],
  aliases: string[],
  exclusions: string[] = [],
  usedIndices: Set<number> = new Set(),
  overrideExclusionKeywords: string[] = []
): { index: number; matchedHeader: string | null } {
  const isExcludedHeader = (h: string): boolean => {
    if (overrideExclusionKeywords.length > 0 && overrideExclusionKeywords.some(ov => h.includes(ov))) {
      // Only enforce hard planned/due exclusions if header explicitly has return/response override
      return ['expected', 'planned', 'target', 'due', 'forecast', 'scheduled', 'sla'].some(
        hardEx => exclusions.includes(hardEx) && h.includes(hardEx)
      );
    }
    return exclusions.some(ex => h.includes(ex));
  };

  // Pass 1: Exact match (raw normalized or token-normalized)
  for (const alias of aliases) {
    const aliasTokens = normalizeHeaderTokens(alias);
    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue;
      const h = normalizeHeaderCell(headers[i]);
      const hTokens = normalizeHeaderTokens(headers[i]);
      if (!h) continue;
      if (isExcludedHeader(h)) continue;
      if (h === alias || (aliasTokens && hTokens === aliasTokens)) {
        return { index: i, matchedHeader: String(headers[i]).trim() };
      }
    }
  }

  // Pass 2: Substring match (raw normalized or token-normalized)
  for (const alias of aliases) {
    const aliasTokens = normalizeHeaderTokens(alias);
    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue;
      const h = normalizeHeaderCell(headers[i]);
      const hTokens = normalizeHeaderTokens(headers[i]);
      if (!h) continue;
      if (isExcludedHeader(h)) continue;
      if (h.includes(alias) || (aliasTokens.length >= 4 && hTokens.includes(aliasTokens))) {
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
  const rawRows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: ''
  }) as unknown[][];
  const rawValueRows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null
  }) as unknown[][];
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

  const dateReturnMatch = findMatchingColumnIndex(
    headers,
    DATE_RETURN_ALIASES,
    ['expected', 'planned', 'target', 'due', 'forecast', 'sent', 'submit'],
    used,
    ['return', 'returned', 'retrun', 'response', 'reply', 'replied', 'approval', 'approved', 'الرد', 'الإرجاع', 'الاعتماد']
  );
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
    const valRow = rawValueRows[r] || [];
    if (!Array.isArray(row)) continue;
    const rawSubRef = subRefMatch.index >= 0 ? String(row[subRefMatch.index] ?? '').trim() : '';
    if (!rawSubRef || rawSubRef.toUpperCase() === 'TOTAL' || rawSubRef.toUpperCase() === 'SUB REF.') {
      continue;
    }

    const rev00DateCell =
      rev00DateMatch.index >= 0
        ? (ws[XLSX.utils.encode_cell({ r, c: rev00DateMatch.index })] as XLSX.CellObject | undefined)
        : undefined;
    const rev00DateSent =
      rev00DateMatch.index >= 0
        ? parseEIDateValue(valRow[rev00DateMatch.index], row[rev00DateMatch.index], rev00DateCell)
        : '';

    const dateReturnCell =
      dateReturnMatch.index >= 0
        ? (ws[XLSX.utils.encode_cell({ r, c: dateReturnMatch.index })] as XLSX.CellObject | undefined)
        : undefined;
    const dateReturn =
      dateReturnMatch.index >= 0
        ? parseEIDateValue(valRow[dateReturnMatch.index], row[dateReturnMatch.index], dateReturnCell)
        : '';

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
  const rawRows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: ''
  }) as unknown[][];
  const rawValueRows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null
  }) as unknown[][];
  const upperName = sheetName.trim().toUpperCase();
  const discInfo = detectSheetDisciplineCode(sheetName);

  // Build merge lookup map so merged header cells and vertically merged data cells resolve to their top-left origin
  const merges = ws['!merges'] || [];
  const resolveMergedCoord = (r: number, c: number): { r: number; c: number; isMerged: boolean } => {
    for (let m = 0; m < merges.length; m++) {
      const rng = merges[m];
      if (r >= rng.s.r && r <= rng.e.r && c >= rng.s.c && c <= rng.e.c) {
        return { r: rng.s.r, c: rng.s.c, isMerged: r !== rng.s.r || c !== rng.s.c };
      }
    }
    return { r, c, isMerged: false };
  };

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

  // Locate best header row in discipline sheet (scoring candidate rows in top 30 rows)
  let bestHeaderScore = 0;
  for (let i = 0; i < Math.min(30, rawRows.length); i++) {
    const r = rawRows[i];
    if (!Array.isArray(r)) continue;
    const joined = r.map(c => normalizeHeaderTokens(c)).join(' | ');
    const hasRefSignal =
      joined.includes('sub ref') ||
      joined.includes('submittal ref') ||
      joined.includes('submission ref') ||
      joined.includes('dwg no') ||
      joined.includes('drawing no') ||
      joined.includes('document no') ||
      joined.includes('doc no') ||
      joined.includes('رقم التقديم') ||
      joined.includes('رقم اللوحة');
    const hasRevOrDateSignal =
      joined.includes('rev') ||
      joined.includes('date sent') ||
      joined.includes('submission date') ||
      joined.includes('date return') ||
      joined.includes('return date') ||
      joined.includes('response date') ||
      joined.includes('المراجعة') ||
      joined.includes('تاريخ');

    if (hasRefSignal && hasRevOrDateSignal) {
      let score = 2;
      if (joined.includes('sub ref') || joined.includes('submittal ref') || joined.includes('submission ref')) score += 2;
      if (joined.includes('dwg') || joined.includes('drawing')) score += 2;
      if (joined.includes('rev')) score += 2;
      if (joined.includes('sent') || joined.includes('submission date')) score += 2;
      if (joined.includes('return') || joined.includes('response') || joined.includes('reply') || joined.includes('received')) score += 2;
      if (joined.includes('code') || joined.includes('status')) score += 1;
      if (score > bestHeaderScore) {
        bestHeaderScore = score;
        headerRowIdx = i;
      }
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

  // Build effective headers supporting multi-row merged headers (headerRowIdx - 1, headerRowIdx, headerRowIdx + 1)
  const baseHeaderRow = rawRows[headerRowIdx] || [];
  const nextRow = rawRows[headerRowIdx + 1] || [];
  const prevRow = headerRowIdx > 0 ? rawRows[headerRowIdx - 1] || [] : [];
  const maxHeaderCols = Math.max(baseHeaderRow.length, nextRow.length, prevRow.length);

  const getHeaderCellResolved = (r: number, c: number): string => {
    const resolved = resolveMergedCoord(r, c);
    return String(rawRows[resolved.r]?.[resolved.c] ?? '').trim();
  };

  // Determine if headerRowIdx + 1 is a sub-header row (rather than the first data row)
  let hasSubHeaderRow = false;
  if (Array.isArray(nextRow) && nextRow.length > 0) {
    const nextJoined = nextRow.map(c => normalizeHeaderTokens(c)).join(' | ');
    const hasSubHeaderKeywords =
      /\b(date return|return date|date sent|sent date|response date|reply date|received date|code|status|rev|dwg no|sub ref)\b/.test(
        nextJoined
      ) || nextJoined.includes('تاريخ الرد') || nextJoined.includes('تاريخ الإرسال');
    // Check if nextRow has any valid date cell (a real data row will have a date in Date Sent, whereas a sub-header row has text labels)
    const nextValRow = rawValueRows[headerRowIdx + 1] || [];
    const hasAnyParsedDateInNextRow = nextRow.some((cell, cIdx) => {
      const cellObj = ws[XLSX.utils.encode_cell({ r: headerRowIdx + 1, c: cIdx })] as XLSX.CellObject | undefined;
      return Boolean(parseEIDateValue(nextValRow[cIdx], cell, cellObj));
    });
    if (hasSubHeaderKeywords && !hasAnyParsedDateInNextRow) {
      hasSubHeaderRow = true;
    }
  }

  const dataStartRowIdx = hasSubHeaderRow ? headerRowIdx + 2 : headerRowIdx + 1;
  const headers: string[] = [];
  for (let c = 0; c < maxHeaderCols; c++) {
    const primary = String(baseHeaderRow[c] ?? '').trim() || getHeaderCellResolved(headerRowIdx, c);
    const sub = hasSubHeaderRow ? String(nextRow[c] ?? '').trim() : '';
    const parent = headerRowIdx > 0 ? getHeaderCellResolved(headerRowIdx - 1, c) : '';

    if (sub && primary && normalizeHeaderTokens(sub) !== normalizeHeaderTokens(primary)) {
      // Prefer sub-header if it is a specific column name under a group header, or combine them
      const subNorm = normalizeHeaderTokens(sub);
      if (
        DATE_RETURN_ALIASES.some(a => subNorm === normalizeHeaderTokens(a)) ||
        DATE_SENT_ALIASES.some(a => subNorm === normalizeHeaderTokens(a)) ||
        CODE_ALIASES.some(a => subNorm === normalizeHeaderTokens(a))
      ) {
        headers.push(sub);
      } else {
        headers.push(`${primary} ${sub}`.trim());
      }
    } else if (sub && !primary) {
      headers.push(sub);
    } else if (
      primary &&
      parent &&
      normalizeHeaderTokens(primary) === 'date' &&
      normalizeHeaderTokens(parent) !== 'date'
    ) {
      headers.push(`${parent} ${primary}`.trim());
    } else {
      headers.push(primary);
    }
  }

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

  let dateReturnCol = findMatchingColumnIndex(
    headers,
    DATE_RETURN_ALIASES,
    ['expected', 'planned', 'target', 'due', 'forecast', 'scheduled', 'sla', 'sent', 'submit', 'issue'],
    usedIndices,
    [
      'return',
      'returned',
      'retrun',
      'response',
      'reply',
      'replied',
      'approval',
      'approved',
      'review',
      'consultant',
      'الرد',
      'الإرجاع',
      'الاعتماد',
      'الاستلام'
    ]
  );

  const codeCol = findMatchingColumnIndex(
    headers,
    CODE_ALIASES,
    ['date', 'time', 'duration', 'project', 'area', 'wbs'],
    usedIndices
  );
  if (codeCol.index >= 0) usedIndices.add(codeCol.index);

  // Helper to read a cell's parsed date (accounting for vertical merges within the sheet)
  const extractCellDateAt = (rIdx: number, cIdx: number): string => {
    if (cIdx < 0) return '';
    const directCell = ws[XLSX.utils.encode_cell({ r: rIdx, c: cIdx })] as XLSX.CellObject | undefined;
    const directDate = parseEIDateValue(rawValueRows[rIdx]?.[cIdx], rawRows[rIdx]?.[cIdx], directCell);
    if (directDate) return directDate;

    const merged = resolveMergedCoord(rIdx, cIdx);
    if (merged.isMerged) {
      const mergedCell = ws[XLSX.utils.encode_cell({ r: merged.r, c: merged.c })] as XLSX.CellObject | undefined;
      return parseEIDateValue(rawValueRows[merged.r]?.[merged.c], rawRows[merged.r]?.[merged.c], mergedCell);
    }
    return '';
  };

  // Verify that dateReturnCol actually contains valid dates if the sheet has returned submittals;
  // if dateReturnCol is -1 or has 0 valid dates across data rows, check other candidate columns!
  const countValidDatesInCol = (cIdx: number): number => {
    if (cIdx < 0) return 0;
    let count = 0;
    for (let rIdx = dataStartRowIdx; rIdx < rawRows.length; rIdx++) {
      if (extractCellDateAt(rIdx, cIdx)) count++;
    }
    return count;
  };

  const initialReturnDatesCount = countValidDatesInCol(dateReturnCol.index);
  if (initialReturnDatesCount === 0) {
    // 1. Check if another column matching DATE_RETURN_ALIASES has > 0 valid dates
    const tempExclusions = new Set(usedIndices);
    if (dateReturnCol.index >= 0) tempExclusions.add(dateReturnCol.index);
    const altMatch = findMatchingColumnIndex(
      headers,
      DATE_RETURN_ALIASES,
      ['expected', 'planned', 'target', 'due', 'forecast', 'scheduled', 'sla'],
      tempExclusions,
      ['return', 'returned', 'retrun', 'response', 'reply', 'replied', 'approval', 'approved', 'review', 'consultant']
    );
    if (altMatch.index >= 0 && countValidDatesInCol(altMatch.index) > 0) {
      dateReturnCol = altMatch;
    } else {
      // 2. Content-based discovery: scan unused columns (especially near dateSentCol and codeCol) for valid return dates
      let bestFallbackCol = -1;
      let bestFallbackScore = 0;
      const maxColsToScan = Math.max(
        headers.length,
        ...rawRows.slice(dataStartRowIdx, Math.min(dataStartRowIdx + 50, rawRows.length)).map(r => (Array.isArray(r) ? r.length : 0))
      );

      for (let c = 0; c < maxColsToScan; c++) {
        if (usedIndices.has(c) || c === dateReturnCol.index) continue;
        const hNorm = normalizeHeaderTokens(headers[c] || '');
        if (/\b(due|planned|expected|target|forecast|sla|rev00|total sheets|dwg|sub ref)\b/.test(hNorm)) {
          continue;
        }
        let validDates = 0;
        let validAfterSent = 0;
        for (let rIdx = dataStartRowIdx; rIdx < rawRows.length; rIdx++) {
          const dRet = extractCellDateAt(rIdx, c);
          if (dRet) {
            validDates++;
            const dSent = extractCellDateAt(rIdx, dateSentCol.index);
            if (!dSent || dRet >= dSent) {
              validAfterSent++;
            }
          }
        }
        if (validDates > 0 && validAfterSent >= validDates * 0.5) {
          // Prefer columns adjacent to dateSentCol or codeCol
          const distToSent = dateSentCol.index >= 0 ? Math.abs(c - dateSentCol.index) : 5;
          const distToCode = codeCol.index >= 0 ? Math.abs(c - codeCol.index) : 5;
          const proximityBonus = (distToSent <= 2 ? 20 : 0) + (distToCode <= 2 ? 20 : 0);
          const score = validDates * 10 + proximityBonus;
          if (score > bestFallbackScore) {
            bestFallbackScore = score;
            bestFallbackCol = c;
          }
        }
      }

      if (bestFallbackCol >= 0) {
        const colLetter = XLSX.utils.encode_col(bestFallbackCol);
        dateReturnCol = {
          index: bestFallbackCol,
          matchedHeader: headers[bestFallbackCol]?.trim() || `Date Return (Col ${colLetter})`
        };
      }
    }
  }

  if (dateReturnCol.index >= 0) usedIndices.add(dateReturnCol.index);

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

  const getCellTextWithMerge = (rIdx: number, cIdx: number): string => {
    if (cIdx < 0) return '';
    const direct = String(rawRows[rIdx]?.[cIdx] ?? '').trim();
    if (direct) return direct;
    const merged = resolveMergedCoord(rIdx, cIdx);
    if (merged.isMerged) {
      return String(rawRows[merged.r]?.[merged.c] ?? '').trim();
    }
    return '';
  };

  for (let rIdx = dataStartRowIdx; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    if (!Array.isArray(row)) continue;

    const rawSubRef = getCellTextWithMerge(rIdx, subRefCol.index);
    const rawDwgNo = dwgNoCol.index >= 0 ? String(row[dwgNoCol.index] ?? '').trim() : '';
    const rawRev = getCellTextWithMerge(rIdx, revCol.index);
    const rawDateSent = getCellTextWithMerge(rIdx, dateSentCol.index);
    const rawDateReturn = getCellTextWithMerge(rIdx, dateReturnCol.index);
    const rawCode = getCellTextWithMerge(rIdx, codeCol.index);
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

    const dateSent = extractCellDateAt(rIdx, dateSentCol.index);
    const dateReturn = extractCellDateAt(rIdx, dateReturnCol.index);
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
      // A blank-return row is only genuinely unreturned (Under Review) if it lacks a completed disposition code (A/B/C/D)
      const genuinelyUnreturnedRows = blankReturnRows.filter(
        r => !r.normalizedCode || r.normalizedCode === 'UR'
      );
      const distinctCodes = Array.from(
        new Set(latestRevRows.map(r => r.normalizedCode).filter(Boolean))
      );

      const hasPartialReturn =
        distinctReturnDates.length > 0 && genuinelyUnreturnedRows.length > 0;
      const hasMultipleReturnDates = distinctReturnDates.length > 1;
      const hasMultipleCodes = distinctCodes.length > 1;

      if (hasPartialReturn) {
        conflictTypes.push('PARTIAL_RETURN_IN_LAST_REV');
        const detailEn = `In Last Rev. (${lastRev}) of '${displaySubRef}', ${latestRevRows.length - genuinelyUnreturnedRows.length} drawing(s) have Date Return [${distinctReturnDates.join(', ')}] while ${genuinelyUnreturnedRows.length} drawing(s) are still Under Review without Date Return`;
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
        const fallbackDate =
          firstLatest.normalizedCode && firstLatest.normalizedCode !== 'UR'
            ? distinctReturnDates[0] || ''
            : '';
        dateReturn = firstLatest.dateReturn || fallbackDate;
        code1 = firstLatest.normalizedCode || (dateReturn ? '' : 'UR');
        resolutionNotes.push(
          `Resolved via Excel First-Row Lookup (Sheet ${firstLatest.sheetName}!R${firstLatest.excelRowNumber})`
        );
      } else if (resolutionMode === 'EXCEL_LAST_MATCH') {
        const lastLatest = latestRevRows[latestRevRows.length - 1];
        const fallbackDate =
          lastLatest.normalizedCode && lastLatest.normalizedCode !== 'UR'
            ? distinctReturnDates[distinctReturnDates.length - 1] || ''
            : '';
        dateReturn = lastLatest.dateReturn || fallbackDate;
        code1 = lastLatest.normalizedCode || (dateReturn ? '' : 'UR');
        resolutionNotes.push(
          `Resolved via Excel Last-Row Lookup (Sheet ${lastLatest.sheetName}!R${lastLatest.excelRowNumber})`
        );
      } else {
        // GOVERNING_EI_RULE (Default Certified Engineering Rule):
        // 1. If any sheet in Last Rev. is still Under Review (UR / no return date and no completed code), package is Under Review ('UR', Date Return = '').
        // 2. Otherwise, governing status code is the most restrictive code among Last Rev. sheets (D > C > B > A),
        //    and Date Return is the latest completion return date (MAX Date Return) of the Last Rev. package.
        const sortedBySeverity = [...latestRevRows].sort((a, b) => {
          const aHasReturn = Boolean(a.dateReturn) || (Boolean(a.normalizedCode) && a.normalizedCode !== 'UR' && distinctReturnDates.length > 0);
          const bHasReturn = Boolean(b.dateReturn) || (Boolean(b.normalizedCode) && b.normalizedCode !== 'UR' && distinctReturnDates.length > 0);
          const sevDiff =
            getEICodeGoverningSeverity(b.normalizedCode, bHasReturn) -
            getEICodeGoverningSeverity(a.normalizedCode, aHasReturn);
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
    dateNF: 'yyyy-mm-dd',
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

  // Build return-date recovery map from cached raw workbook buffer if available
  // (protects against main parser.ts dropping "Date Return" when header is not in its fixed alias list)
  const cachedReturnBySubAndRev = new Map<string, string>();
  const cachedReturnBySubRef = new Map<string, string>();
  const cachedWb = getPlatformWorkbookBuffer();
  if (cachedWb) {
    try {
      const wbRes = generateEILogFromExcelBuffer(cachedWb.buffer, cachedWb.fileName, { resolutionMode });
      for (const rec of wbRes.records) {
        const normSub = rec.subRef.toUpperCase().replace(/\s+/g, ' ').trim();
        if (rec.dateReturn && rec.dateReturn !== 'CONFLICT') {
          cachedReturnBySubRef.set(normSub, rec.dateReturn);
        }
        for (const ev of (rec as any).sourceRowTrace || []) {
          if (ev.dateReturn) {
            cachedReturnBySubAndRev.set(`${normSub}|${ev.normalizedRev}`, ev.dateReturn);
          }
        }
      }
    } catch {
      // ignore cached workbook recovery error
    }
  }

  const sheetMap = new Map<string, EISourceRowEvidence[]>();
  sdwRows.forEach((r, idx) => {
    const sheetName = r.sourceSheetName || r.disciplineSourceSheet || r.discipline || 'SDW';
    const discInfo = detectSheetDisciplineCode(r.discipline || sheetName);
    const rawSubRef = String(r.submissionRef || (r as any).submittalRef || r.docNo || '').trim();
    const rawDwgNo = String(r.drawingNo || r.sheetNo || r.docNo || '').trim();
    const rawRev = String(r.rev ?? '').trim();
    const dateSent = parseEIDateValue(r.submissionDate);
    let dateReturn = parseEIDateValue(
      r.responseDate || (r as any).dateReturn || (r as any).returnDate || (r as any).consultantReturnDate
    );
    const rawCode = String(r.code ?? (r as any).rawCode ?? '').trim();
    const rawStatus = String(r.recordStatus || r.status || '').trim();

    if (!rawSubRef) return;

    const validRev = isValidRevision(rawRev);
    const rev0Flag = isRevision0(rawRev, r.isRev0);
    const revWeight = getRevisionWeight(rawRev);
    const normalizedRev = formatCanonicalEIRevision(rawRev, rev0Flag);
    const normalizedSubRef = rawSubRef.toUpperCase().replace(/\s+/g, ' ').trim();

    if (!dateReturn) {
      dateReturn =
        cachedReturnBySubAndRev.get(`${normalizedSubRef}|${normalizedRev}`) ||
        cachedReturnBySubRef.get(normalizedSubRef) ||
        '';
    }

    const normalizedCode = normalizeEICode(rawCode, rawStatus, dateReturn);

    let list = sheetMap.get(sheetName);
    if (!list) {
      list = [];
      sheetMap.set(sheetName, list);
    }

    list.push({
      sheetName,
      discipline: discInfo.code,
      excelRowNumber: (r as any).sourceRowIndex || idx + 2,
      rawSubRef,
      normalizedSubRef,
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
    dateNF: 'yyyy-mm-dd',
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
