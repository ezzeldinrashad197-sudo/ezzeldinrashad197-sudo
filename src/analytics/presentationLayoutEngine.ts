/**
 * StructuSight Presentation Typography & Layout Engine
 * 
 * Enforces the Canonical Presentation Typography Contract:
 * - Table body target: 9–10 pt (minimum 8.5 pt; never drop to 6.5–7 pt)
 * - Table header target: 8.5–9.5 pt
 * - Title: 24–30 pt
 * - Section Title: 18–22 pt
 * - KPI: 18–24 pt
 * - Footer: 7.5–8 pt
 * 
 * Prevents character-level wrapping (e.g. Disci/pline, Furth/er)
 * by rebalancing column widths, expanding table widths, and applying canonical short headers.
 */

export interface TableColumnDef {
  key: string;
  label: string;
  shortLabel?: string;
  minWidth?: number;
  preferredWidth?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export interface TableLayoutResult {
  tableWidth: number;
  tableHeight?: number;
  colWidths: number[];
  headerFontSize: number;
  bodyFontSize: number;
  headerRowHeight: number;
  bodyRowHeight: number;
  columns: {
    key: string;
    label: string;
    width: number;
    align: 'left' | 'center' | 'right';
  }[];
}

/**
 * Returns canonical concise headers that prevent ugly line-breaking on small columns
 * Uses clean two-line whole words to prevent intra-word character splitting.
 */
export function getCanonicalHeader(rawLabel: string, language: 'ar' | 'en' = 'en'): string {
  const norm = rawLabel.trim().toUpperCase();

  if (language === 'ar') {
    if (norm === 'DISCIPLINE' || norm === 'STATUS') return 'التخصص';
    if (norm === 'UNIQUE ITEMS' || norm === 'CURRENT UNIQUE' || norm === 'TOTAL UNIQUE') return 'البنود\nالفريدة';
    if (norm === 'REV.00' || norm === 'REV 00') return 'Rev.00';
    if (norm === 'UNIQUE REV.00' || norm === 'UNIQUE REV 00') return 'فريدة\nR00';
    if (norm === 'UNIQUE FURTHER REV.' || norm === 'UNIQUE FURTHER REV' || norm === 'UNIQUE FURTHER') return 'فريدة\nلاحقة';
    if (norm === 'REV.00 ROWS' || norm === 'REV 00 ROWS') return 'صفوف\nRev.00';
    if (norm === 'FURTHER REV. ROWS' || norm === 'FURTHER REV ROWS' || norm === 'FURTHER REV.') return 'صفوف\nلاحقة';
    if (norm === 'TOTAL ROWS') return 'إجمالي\nالصفوف';
    if (norm === 'APPROVED') return 'معتمد';
    if (norm === 'REJECTED') return 'مرفوض';
    if (norm === 'REJECTED OPEN' || norm === 'REJ. OPEN') return 'مرفوض\nمفتوح';
    if (norm === 'REJECTED CLOSED' || norm === 'REJ. CLOSED') return 'مرفوض\nمغلق';
    if (norm === 'PENDING') return 'معلق';
    if (norm === 'SUPERSEDED' || norm === 'SUPERSEDED ROWS') return 'ملغاة\nسابقاً';
    if (norm === 'ROW APP/CLOSED') return 'معتمد\nصفوف';
    if (norm === 'ROW REJ/OPEN') return 'مرفوض\nصفوف';
    if (norm === 'ROW PENDING') return 'معلق\nصفوف';
    if (norm === 'CUR. APP/CLOSED') return 'معتمد\nحالي';
    if (norm === 'CUR. REJ OPEN') return 'مرفوض\nمفتوح';
    if (norm === 'CUR. REJ CLOSED') return 'مرفوض\nمغلق';
    if (norm === 'CUR. PENDING') return 'معلق\nحالي';
    if (norm === 'PRIORITY') return 'الأولوية';
    if (norm === 'LOG TYPE') return 'نوع السجل';
    return rawLabel;
  }

  // English Canonical Short Headers with clean two-line whole words
  if (norm === 'STATUS') return 'Status';
  if (norm === 'DISCIPLINE') return 'Discipline';
  if (norm === 'TOTAL SUBMITTALS') return 'Total\nSubmittals';
  if (norm === 'TOTAL SHEETS') return 'Total\nSheets';
  if (norm === 'UNIQUE ITEMS' || norm === 'CURRENT UNIQUE' || norm === 'TOTAL UNIQUE') return 'Unique\nItems';
  if (norm === 'REV.00' || norm === 'REV 00') return 'Rev.00';
  if (norm === 'FURTHER REV.') return 'Further\nRev.';
  if (norm === 'UNIQUE REV.00' || norm === 'UNIQUE REV 00') return 'Unique\nRev.00';
  if (norm === 'UNIQUE FURTHER REV.' || norm === 'UNIQUE FURTHER REV' || norm === 'UNIQUE FURTHER') return 'Unique\nFurther';
  if (norm === 'REV.00 ROWS' || norm === 'REV 00 ROWS') return 'Rev.00\nRows';
  if (norm === 'FURTHER REV. ROWS' || norm === 'FURTHER REV ROWS') return 'Further\nRev. Rows';
  if (norm === 'TOTAL ROWS') return 'Total\nRows';
  if (norm === 'APPROVED') return 'Approved';
  if (norm === 'REJECTED') return 'Rejected';
  if (norm === 'REJECTED OPEN' || norm === 'REJ. OPEN') return 'Rej.\nOpen';
  if (norm === 'REJECTED CLOSED' || norm === 'REJ. CLOSED') return 'Rej.\nClosed';
  if (norm === 'PENDING') return 'Pending';
  if (norm === 'SUPERSEDED' || norm === 'SUPERSEDED ROWS') return 'Superseded';
  if (norm === 'ROW APP/CLOSED') return 'Row\nApp/Cls';
  if (norm === 'ROW REJ/OPEN') return 'Row\nRej/Opn';
  if (norm === 'ROW PENDING') return 'Row\nPend.';
  if (norm === 'CUR. APP/CLOSED') return 'Cur.\nAppr.';
  if (norm === 'CUR. REJ OPEN') return 'Cur. Rej\nOpen';
  if (norm === 'CUR. REJ CLOSED') return 'Cur. Rej\nClosed';
  if (norm === 'CUR. PENDING') return 'Cur.\nPend.';
  if (norm === 'PRIORITY') return 'Priority';
  if (norm === 'LOG TYPE') return 'Log Type';

  return rawLabel;
}

/**
 * Calculates responsive, robust table layout parameters for PptxGenJS and native PDF.
 * Guaranteed never to drop below font size 8.5 pt for standard executive tables.
 */
export function calculateTableLayout(
  cols: { key: string; label: string }[],
  maxTableWidth: number = 5.7,
  isFullWidthSlide: boolean = false,
  language: 'ar' | 'en' = 'en'
): TableLayoutResult {
  const colCount = cols.length;

  // Full-width slide (e.g. 13-column detail table or 9-column full-width register summary)
  if (isFullWidthSlide || colCount >= 11) {
    const totalW = maxTableWidth > 8 ? maxTableWidth : (isFullWidthSlide ? 9.45 : Math.max(maxTableWidth, 5.8));
    
    // Proportional column weights prioritizing single-word headers so they never break mid-word
    const weights: Record<string, number> = {
      discipline: 1.35,
      register: 1.30,
      documentType: 1.30,
      priority: 0.85,
      uniqueDocs: 0.78,
      rev00Rows: 0.62,
      Rev00Rows: 0.62,
      furtherRevRows: 0.70,
      FurtherRevRows: 0.70,
      totalRows: 0.70,
      TotalRows: 0.70,
      rowAppClosed: 0.72,
      rowRejOpen: 0.70,
      rowPending: 0.68,
      totalUnique: 0.72,
      TotalUnique: 0.72,
      approved: 0.88,
      Approved: 0.88,
      rejected: 0.86,
      Rejected: 0.86,
      rejectedOpen: 0.72,
      RejectedOpen: 0.72,
      rejectedClosed: 0.74,
      RejectedClosed: 0.74,
      pending: 0.82,
      Pending: 0.82,
      superseded: 1.15,
      Superseded: 1.15,
      supersededRows: 1.15,
      overdue: 0.82,
      Overdue: 0.82
    };

    let totalWeight = 0;
    const colWeights = cols.map(c => {
      const w = weights[c.key] || 0.78;
      totalWeight += w;
      return w;
    });

    const colWidths = colWeights.map(w => Number(((w / totalWeight) * totalW).toFixed(2)));
    const diff = Number((totalW - colWidths.reduce((a, b) => a + b, 0)).toFixed(2));
    if (colWidths.length > 0) colWidths[0] = Number((colWidths[0] + diff).toFixed(2));

    return {
      tableWidth: totalW,
      colWidths,
      headerFontSize: 9.0,
      bodyFontSize: 9.0,
      headerRowHeight: 0.44,
      bodyRowHeight: 0.38,
      columns: cols.map((c, i) => ({
        key: c.key,
        label: getCanonicalHeader(c.label, language),
        width: colWidths[i],
        align: i === 0 ? 'left' : 'center'
      }))
    };
  }

  // 8 to 10 Column Tables (e.g. Slide A: Register Status Table alongside Bar Chart)
  if (colCount >= 8) {
    const totalW = Math.max(maxTableWidth, colCount >= 10 ? 5.8 : 5.7);
    
    // Semantic weights tailored for 8-10 columns:
    // Single-word headers (Discipline, Superseded, Approved, Rejected, Pending) receive higher weights
    // than two-line split headers (Unique\nRev.00, Further\nRev.) so no word ever breaks mid-word.
    const weights: Record<string, number> = {
      discipline: 1.28,
      register: 1.28,
      UniqueRev00: 0.78,
      UniqueFurtherRev: 0.84,
      Rev00Rows: 0.76,
      FurtherRevRows: 0.84,
      TotalRows: 0.74,
      Approved: 0.98,
      approved: 0.98,
      Rejected: 0.96,
      rejected: 0.96,
      RejectedOpen: 0.78,
      rejectedOpen: 0.78,
      RejectedClosed: 0.80,
      rejectedClosed: 0.80,
      Pending: 0.90,
      pending: 0.90,
      Superseded: 1.25,
      superseded: 1.25,
      supersededRows: 1.25,
      Total: 0.84,
      Closed: 0.86,
      Open: 0.84
    };

    let totalWeight = 0;
    const colWeights = cols.map(c => {
      const w = weights[c.key] || 0.85;
      totalWeight += w;
      return w;
    });

    const colWidths = colWeights.map(w => Number(((w / totalWeight) * totalW).toFixed(2)));
    const diff = Number((totalW - colWidths.reduce((a, b) => a + b, 0)).toFixed(2));
    if (colWidths.length > 0) colWidths[0] = Number((colWidths[0] + diff).toFixed(2));

    return {
      tableWidth: totalW,
      colWidths,
      headerFontSize: 8.5,
      bodyFontSize: 9.5,
      headerRowHeight: 0.44,
      bodyRowHeight: 0.34,
      columns: cols.map((c, i) => ({
        key: c.key,
        label: getCanonicalHeader(c.label, language),
        width: colWidths[i],
        align: i === 0 ? 'left' : 'center'
      }))
    };
  }

  // 4 to 7 Column Tables
  const totalW = Math.max(maxTableWidth, 5.2);
  const baseW = Number((totalW / colCount).toFixed(2));
  const colWidths = cols.map((c, i) => i === 0 ? Number((baseW * 1.35).toFixed(2)) : baseW);
  const sumW = colWidths.reduce((a, b) => a + b, 0);
  const scale = totalW / sumW;
  const scaledWidths = colWidths.map(w => Number((w * scale).toFixed(2)));

  return {
    tableWidth: totalW,
    colWidths: scaledWidths,
    headerFontSize: 9.0,
    bodyFontSize: 10.0,
    headerRowHeight: 0.40,
    bodyRowHeight: 0.35,
    columns: cols.map((c, i) => ({
      key: c.key,
      label: getCanonicalHeader(c.label, language),
      width: scaledWidths[i],
      align: i === 0 ? 'left' : 'center'
    }))
  };
}
