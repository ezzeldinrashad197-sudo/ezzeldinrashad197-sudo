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
    if (norm === 'DISCIPLINE' || norm === 'ITEMS') return 'التخصص';
    if (norm === 'UNIQUE REV.00' || norm === 'UNIQUE REV 00') return 'فريدة\nR00';
    if (norm === 'UNIQUE FURTHER REV.' || norm === 'UNIQUE FURTHER REV' || norm === 'UNIQUE FURTHER') return 'فريدة\nلاحقة';
    if (norm === 'REV.00 ROWS' || norm === 'REV 00 ROWS') return 'صفوف\nR00';
    if (norm === 'FURTHER REV. ROWS' || norm === 'FURTHER REV ROWS' || norm === 'FURTHER REV.') return 'صفوف\nلاحقة';
    if (norm === 'TOTAL ROWS') return 'إجمالي\nالصفوف';
    if (norm === 'APPROVED') return 'معتمد';
    if (norm === 'REJECTED') return 'مرفوض';
    if (norm === 'REJECTED OPEN' || norm === 'REJ. OPEN') return 'مرفوض\nمفتوح';
    if (norm === 'REJECTED CLOSED' || norm === 'REJ. CLOSED') return 'مرفوض\nمغلق';
    if (norm === 'PENDING') return 'معلق';
    if (norm === 'SUPERSEDED' || norm === 'SUPERSEDED ROWS') return 'ملغاة\nسابقاً';
    if (norm === 'CURRENT UNIQUE' || norm === 'TOTAL UNIQUE') return 'البنود\nالفريدة';
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
  if (norm === 'DISCIPLINE' || norm === 'ITEMS') return 'Discipline';
  if (norm === 'UNIQUE REV.00' || norm === 'UNIQUE REV 00') return 'Unique\nRev.00';
  if (norm === 'UNIQUE FURTHER REV.' || norm === 'UNIQUE FURTHER REV' || norm === 'UNIQUE FURTHER') return 'Unique\nFurther';
  if (norm === 'REV.00 ROWS' || norm === 'REV 00 ROWS') return 'Rev.00\nRows';
  if (norm === 'FURTHER REV. ROWS' || norm === 'FURTHER REV ROWS' || norm === 'FURTHER REV.') return 'Further\nRev.';
  if (norm === 'TOTAL ROWS') return 'Total\nRows';
  if (norm === 'APPROVED') return 'Approved';
  if (norm === 'REJECTED') return 'Rejected';
  if (norm === 'REJECTED OPEN' || norm === 'REJ. OPEN') return 'Rej.\nOpen';
  if (norm === 'REJECTED CLOSED' || norm === 'REJ. CLOSED') return 'Rej.\nClosed';
  if (norm === 'PENDING') return 'Pending';
  if (norm === 'SUPERSEDED' || norm === 'SUPERSEDED ROWS') return 'Superseded';
  if (norm === 'CURRENT UNIQUE' || norm === 'TOTAL UNIQUE') return 'Total\nUnique';
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

  // Full-width slide (e.g. 13-column detail table)
  if (isFullWidthSlide || colCount >= 11) {
    const totalW = maxTableWidth > 8 ? maxTableWidth : 9.45;
    
    // Proportional column weights based on content types
    const weights: Record<string, number> = {
      discipline: 1.35,
      documentType: 1.30,
      priority: 0.85,
      rev00Rows: 0.60,
      Rev00Rows: 0.60,
      furtherRevRows: 0.70,
      FurtherRevRows: 0.70,
      totalRows: 0.70,
      TotalRows: 0.70,
      rowAppClosed: 0.72,
      rowRejOpen: 0.70,
      rowPending: 0.68,
      totalUnique: 0.72,
      TotalUnique: 0.72,
      approved: 0.72,
      Approved: 0.72,
      rejectedOpen: 0.65,
      RejectedOpen: 0.65,
      rejectedClosed: 0.65,
      RejectedClosed: 0.65,
      pending: 0.65,
      Pending: 0.65,
      superseded: 0.70,
      Superseded: 0.70
    };

    let totalWeight = 0;
    const colWeights = cols.map(c => {
      const w = weights[c.key] || 0.75;
      totalWeight += w;
      return w;
    });

    const colWidths = colWeights.map(w => Number(((w / totalWeight) * totalW).toFixed(2)));
    const diff = Number((totalW - colWidths.reduce((a, b) => a + b, 0)).toFixed(2));
    if (colWidths.length > 0) colWidths[0] += diff;

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
    const totalW = Math.max(maxTableWidth, 5.7);
    
    // Semantic weights tailored for 8-10 columns:
    // Yields exact desired widths: Discipline: ~0.76", Unique Rev.00: ~0.62", Unique Further: ~0.78",
    // Rev.00 Rows: ~0.70", Further Rev. Rows: ~0.82", Total Rows: ~0.62", Approved: ~0.62", Rejected: ~0.62", Pending: ~0.62"
    const weights: Record<string, number> = {
      discipline: 1.22,
      UniqueRev00: 0.88,
      UniqueFurtherRev: 1.05,
      Rev00Rows: 0.94,
      FurtherRevRows: 1.05,
      TotalRows: 0.88,
      Approved: 0.84,
      Rejected: 0.84,
      RejectedOpen: 0.84,
      RejectedClosed: 0.84,
      Pending: 0.84,
      Superseded: 0.92,
      Total: 0.88,
      Closed: 0.84,
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
    if (colWidths.length > 0) colWidths[0] += diff;

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
