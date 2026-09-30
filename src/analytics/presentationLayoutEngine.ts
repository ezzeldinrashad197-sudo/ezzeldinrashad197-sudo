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
 */
export function getCanonicalHeader(rawLabel: string, language: 'ar' | 'en' = 'en'): string {
  const norm = rawLabel.trim().toUpperCase();

  if (language === 'ar') {
    if (norm === 'DISCIPLINE' || norm === 'ITEMS') return 'التخصص';
    if (norm === 'UNIQUE REV.00' || norm === 'UNIQUE REV 00') return 'فريدة R00';
    if (norm === 'UNIQUE FURTHER REV.' || norm === 'UNIQUE FURTHER REV' || norm === 'UNIQUE FURTHER') return 'فريدة لاحقة';
    if (norm === 'REV.00 ROWS' || norm === 'REV 00 ROWS') return 'صفوف R00';
    if (norm === 'FURTHER REV. ROWS' || norm === 'FURTHER REV ROWS' || norm === 'FURTHER REV.') return 'صفوف لاحقة';
    if (norm === 'TOTAL ROWS') return 'إجمالي الصفوف';
    if (norm === 'APPROVED') return 'معتمد';
    if (norm === 'REJECTED') return 'مرفوض';
    if (norm === 'REJECTED OPEN' || norm === 'REJ. OPEN') return 'مرفوض مفتوح';
    if (norm === 'REJECTED CLOSED' || norm === 'REJ. CLOSED') return 'مرفوض مغلق';
    if (norm === 'PENDING') return 'معلق';
    if (norm === 'SUPERSEDED' || norm === 'SUPERSEDED ROWS') return 'ملغاة تاريخياً';
    if (norm === 'CURRENT UNIQUE' || norm === 'TOTAL UNIQUE') return 'البنود الفريدة';
    if (norm === 'ROW APP/CLOSED') return 'معتمد صفوف';
    if (norm === 'ROW REJ/OPEN') return 'مرفوض صفوف';
    if (norm === 'ROW PENDING') return 'معلق صفوف';
    if (norm === 'CUR. APP/CLOSED') return 'معتمد حالي';
    if (norm === 'CUR. REJ OPEN') return 'مرفوض مفتوح';
    if (norm === 'CUR. REJ CLOSED') return 'مرفوض مغلق';
    if (norm === 'CUR. PENDING') return 'معلق حالي';
    if (norm === 'PRIORITY') return 'الأولوية';
    if (norm === 'LOG TYPE') return 'نوع المعاملة';
    return rawLabel;
  }

  // English Canonical Short Headers
  if (norm === 'DISCIPLINE' || norm === 'ITEMS') return 'Discipline';
  if (norm === 'UNIQUE REV.00' || norm === 'UNIQUE REV 00') return 'Unique Rev.00';
  if (norm === 'UNIQUE FURTHER REV.' || norm === 'UNIQUE FURTHER REV' || norm === 'UNIQUE FURTHER') return 'Unique Further';
  if (norm === 'REV.00 ROWS' || norm === 'REV 00 ROWS') return 'Rev.00 Rows';
  if (norm === 'FURTHER REV. ROWS' || norm === 'FURTHER REV ROWS' || norm === 'FURTHER REV.') return 'Further Rev.';
  if (norm === 'TOTAL ROWS') return 'Total Rows';
  if (norm === 'APPROVED') return 'Approved';
  if (norm === 'REJECTED') return 'Rejected';
  if (norm === 'REJECTED OPEN' || norm === 'REJ. OPEN') return 'Rej. Open';
  if (norm === 'REJECTED CLOSED' || norm === 'REJ. CLOSED') return 'Rej. Closed';
  if (norm === 'PENDING') return 'Pending';
  if (norm === 'SUPERSEDED' || norm === 'SUPERSEDED ROWS') return 'Superseded';
  if (norm === 'CURRENT UNIQUE' || norm === 'TOTAL UNIQUE') return 'Total Unique';
  if (norm === 'ROW APP/CLOSED') return 'Row Appr.';
  if (norm === 'ROW REJ/OPEN') return 'Row Rej.';
  if (norm === 'ROW PENDING') return 'Row Pend.';
  if (norm === 'CUR. APP/CLOSED') return 'Cur. Appr.';
  if (norm === 'CUR. REJ OPEN') return 'Cur. Rej Open';
  if (norm === 'CUR. REJ CLOSED') return 'Cur. Rej Closed';
  if (norm === 'CUR. PENDING') return 'Cur. Pend.';
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
  maxTableWidth: number = 5.5,
  isFullWidthSlide: boolean = false,
  language: 'ar' | 'en' = 'en'
): TableLayoutResult {
  const colCount = cols.length;

  // Full-width slide (e.g. 13-column detail table)
  if (isFullWidthSlide || colCount >= 11) {
    const totalW = maxTableWidth > 8 ? maxTableWidth : 9.4;
    
    // Proportional column weights based on content types
    const weights: Record<string, number> = {
      discipline: 1.5,
      documentType: 1.4,
      priority: 0.85,
      Rev00Rows: 0.75,
      FurtherRevRows: 0.8,
      TotalRows: 0.8,
      UniqueRev00: 0.8,
      UniqueFurtherRev: 0.85,
      Approved: 0.8,
      RejectedOpen: 0.8,
      RejectedClosed: 0.8,
      Rejected: 0.8,
      Pending: 0.75,
      Superseded: 0.85,
      Total: 0.8
    };

    let totalWeight = 0;
    const colWeights = cols.map(c => {
      const w = weights[c.key] || 0.8;
      totalWeight += w;
      return w;
    });

    const colWidths = colWeights.map(w => Number(((w / totalWeight) * totalW).toFixed(2)));
    // Adjust rounding difference
    const diff = Number((totalW - colWidths.reduce((a, b) => a + b, 0)).toFixed(2));
    if (colWidths.length > 0) colWidths[0] += diff;

    return {
      tableWidth: totalW,
      colWidths,
      headerFontSize: 8.5,
      bodyFontSize: 9.0,
      headerRowHeight: 0.42,
      bodyRowHeight: 0.32,
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
    const totalW = Math.max(maxTableWidth, 5.45);
    
    // Semantic weights tailored for 8-10 columns
    const weights: Record<string, number> = {
      discipline: 1.15,
      UniqueRev00: 0.82,
      UniqueFurtherRev: 0.90,
      Rev00Rows: 0.82,
      FurtherRevRows: 0.85,
      TotalRows: 0.80,
      Approved: 0.72,
      Rejected: 0.72,
      RejectedOpen: 0.72,
      RejectedClosed: 0.72,
      Pending: 0.72,
      Superseded: 0.78,
      Total: 0.80,
      Closed: 0.75,
      Open: 0.75
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
      headerFontSize: 8.5,
      bodyFontSize: 9.5,
      headerRowHeight: 0.40,
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
  const totalW = Math.max(maxTableWidth, 5.0);
  const baseW = Number((totalW / colCount).toFixed(2));
  const colWidths = cols.map((c, i) => i === 0 ? Number((baseW * 1.4).toFixed(2)) : baseW);
  const sumW = colWidths.reduce((a, b) => a + b, 0);
  const scale = totalW / sumW;
  const scaledWidths = colWidths.map(w => Number((w * scale).toFixed(2)));

  return {
    tableWidth: totalW,
    colWidths: scaledWidths,
    headerFontSize: 9.0,
    bodyFontSize: 10.0,
    headerRowHeight: 0.38,
    bodyRowHeight: 0.35,
    columns: cols.map((c, i) => ({
      key: c.key,
      label: getCanonicalHeader(c.label, language),
      width: scaledWidths[i],
      align: i === 0 ? 'left' : 'center'
    }))
  };
}
