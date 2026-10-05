import { SubmittalRow, ProjectSettings } from '../types';
import { calculateStats, calculateNCRStats, calculateSORStats, calculateLTRStats, resolveRowDiscipline } from '../utils/calculations';
import { calculateExecutiveDashboardData, compileStatsForBaseType, getRegisterTitle } from './exportHelpers';
import { calculateTableLayout, getCanonicalHeader, TableLayoutResult } from './presentationLayoutEngine';

export interface DisciplineMetricRow {
  discipline: string;
  UniqueRev00: number;
  UniqueFurtherRev: number;
  Rev00Rows: number;
  FurtherRevRows: number;
  TotalRows: number;
  Approved: number;
  RejectedOpen: number;
  RejectedClosed: number;
  Rejected: number;
  Pending: number;
  Superseded: number;
  CurrentUnique: number;
  Total?: number;
  Closed?: number;
  Open?: number;
  [key: string]: any;
}

export interface RegisterViewModel {
  baseType: string;
  name: string;
  subtitle: string;
  isRevisionBased: boolean;
  cols: { key: string; label: string }[];
  layout: TableLayoutResult;
  monthlyStats: {
    stats: DisciplineMetricRow[];
    totalRow: DisciplineMetricRow;
    hasData: boolean;
    barChartData: { name: string; labels: string[]; values: number[] }[];
  };
  cumulativeStats: {
    stats: DisciplineMetricRow[];
    totalRow: DisciplineMetricRow;
    hasData: boolean;
    barChartData: { name: string; labels: string[]; values: number[] }[];
  };
}

export interface PresentationViewModel {
  metadata: {
    title: string;
    subtitle: string;
    projectName: string;
    contractorName: string;
    consultantName: string;
    dateStr: string;
    primaryColor: string;
    accentColor: string;
    fontFace: string;
    isArabic: boolean;
    mode: 'monthly' | 'cumulative' | 'presentation';
  };
  executiveOverview: {
    totalHistoricalRows: number;
    totalUniqueItems: number;
    supersededRows: number;
    approved: number;
    rejectedOpen: number;
    rejectedClosed: number;
    totalRejected: number;
    pending: number;
    activeItems: number;
    approvalRate: number;
    overdueCount: number;
    overdueRateOnActive: number;
    avgDelay: number;
    healthScore: number;
    executiveSummaryBrief: { en: string; ar: string };
    statusDistribution: {
      status: string;
      labelEn: string;
      labelAr: string;
      count: number;
      percentage: number;
      color: string;
    }[];
  };
  primaryDetailBreakdown: {
    layout: TableLayoutResult;
    headers: { key: string; label: string }[];
    rows: {
      documentType: string;
      priority: string;
      criticalCount: number;
      rev00Rows: number;
      furtherRevRows: number;
      totalRows: number;
      uniqueRev00: number;
      uniqueFurtherRev: number;
      totalUnique: number;
      approved: number;
      rejectedOpen: number;
      rejectedClosed: number;
      pending: number;
      superseded: number;
      rowAppClosed: number;
      rowRejOpen: number;
      rowPending: number;
    }[];
    totalRow: {
      documentType: string;
      priority: string;
      criticalCount: number;
      rev00Rows: number;
      furtherRevRows: number;
      totalRows: number;
      uniqueRev00: number;
      uniqueFurtherRev: number;
      totalUnique: number;
      approved: number;
      rejectedOpen: number;
      rejectedClosed: number;
      pending: number;
      superseded: number;
      rowAppClosed: number;
      rowRejOpen: number;
      rowPending: number;
    };
  };
  registers: RegisterViewModel[];
  recommendations: {
    id: string;
    en: string;
    ar: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    action: string;
    actionAr: string;
  }[];
  rawDataset: SubmittalRow[];
}

/**
 * Builds the SSOT PresentationViewModel used identically by PPTX and PDF renderers.
 */
export function buildPresentationViewModel(
  data: SubmittalRow[],
  projectInfo: ProjectSettings | null,
  modeOrOptions: 'monthly' | 'cumulative' | 'presentation' | any = 'presentation',
  options?: any
): PresentationViewModel {
  const mode: 'monthly' | 'cumulative' | 'presentation' = (typeof modeOrOptions === 'string' && (modeOrOptions === 'monthly' || modeOrOptions === 'cumulative')) ? modeOrOptions : 'presentation';
  const opts = typeof modeOrOptions === 'object' && modeOrOptions !== null ? modeOrOptions : (options || {});
  const isArabic = !!opts?.arabicEnabled;
  const fontFace = opts?.fontFace || "Arial";
  const primaryColor = opts?.primaryColor ? opts.primaryColor.replace('#', '') : "203864";
  const accentColor = opts?.accentColor ? opts.accentColor.replace('#', '') : "EAB308";

  // Date Filters
  const monthlyStart = opts?.monthlyStart;
  const isMonthlyRow = (r: SubmittalRow) => !monthlyStart || !r.submissionDate || r.submissionDate >= monthlyStart;
  const monthlyData = data.filter(isMonthlyRow);
  const cumulativeData = data;

  const activeDataset = mode === 'monthly' ? monthlyData : cumulativeData;

  // 1. Executive Dashboard Data
  const dashData = calculateExecutiveDashboardData(activeDataset, data, mode === 'monthly', isArabic ? 'ar' : 'en');
  const globalStats = dashData.globalStats;

  const totalHistoricalRows = globalStats.totalSubmittedSheets || activeDataset.length;
  const totalUniqueItems = globalStats.totalUniqueDrawings || totalHistoricalRows;
  const supersededRows = Math.max(0, totalHistoricalRows - totalUniqueItems);

  const approved = globalStats.approved || 0;
  const rejectedOpen = globalStats.rejectedOpen || 0;
  const rejectedClosed = globalStats.rejectedClosed || 0;
  const totalRejected = rejectedOpen + rejectedClosed;
  const pending = globalStats.pending || 0;
  const activeItems = rejectedOpen + pending;
  const approvalRate = globalStats.approvalRate || 0;
  const overdueCount = globalStats.overdue || 0;
  const overdueRateOnActive = activeItems > 0 ? (overdueCount / activeItems) * 100 : 0;
  const avgDelay = globalStats.avgResponseTime || 0;
  const healthScore = dashData.healthData?.score || 85;

  // Status Distribution Array
  const statusDistribution = [
    {
      status: 'APPROVED',
      labelEn: 'Approved',
      labelAr: 'معتمد',
      count: approved,
      percentage: totalHistoricalRows > 0 ? Number(((approved / totalHistoricalRows) * 100).toFixed(1)) : 0,
      color: '2E7D32'
    },
    {
      status: 'REJECTED_OPEN',
      labelEn: 'Rejected / Open',
      labelAr: 'مرفوض مفتوح',
      count: rejectedOpen,
      percentage: totalHistoricalRows > 0 ? Number(((rejectedOpen / totalHistoricalRows) * 100).toFixed(1)) : 0,
      color: 'C62828'
    },
    {
      status: 'REJECTED_CLOSED',
      labelEn: 'Rejected / Closed',
      labelAr: 'مرفوض مغلق',
      count: rejectedClosed,
      percentage: totalHistoricalRows > 0 ? Number(((rejectedClosed / totalHistoricalRows) * 100).toFixed(1)) : 0,
      color: '881337'
    },
    {
      status: 'PENDING',
      labelEn: 'Pending / Review',
      labelAr: 'معلق قيد المراجعة',
      count: pending,
      percentage: totalHistoricalRows > 0 ? Number(((pending / totalHistoricalRows) * 100).toFixed(1)) : 0,
      color: 'F57C00'
    },
    {
      status: 'SUPERSEDED',
      labelEn: 'Superseded',
      labelAr: 'ملغاة تاريخياً',
      count: supersededRows,
      percentage: totalHistoricalRows > 0 ? Number(((supersededRows / totalHistoricalRows) * 100).toFixed(1)) : 0,
      color: '64748B'
    }
  ];

  // 2. Primary Detail Breakdown Table (Slide 8/13)
  const detailHeaders = [
    { key: 'documentType', label: 'Log Type' },
    { key: 'priority', label: 'Priority' },
    { key: 'rev00Rows', label: 'Rev 00' },
    { key: 'furtherRevRows', label: 'Further Rev' },
    { key: 'totalRows', label: 'Total Rows' },
    { key: 'rowAppClosed', label: 'Row App/Closed' },
    { key: 'rowRejOpen', label: 'Row Rej/Open' },
    { key: 'rowPending', label: 'Row Pending' },
    { key: 'totalUnique', label: 'Total Unique' },
    { key: 'approved', label: 'Cur. App/Closed' },
    { key: 'rejectedOpen', label: 'Cur. Rej Open' },
    { key: 'rejectedClosed', label: 'Cur. Rej Closed' },
    { key: 'pending', label: 'Cur. Pending' }
  ];

  const detailLayout = calculateTableLayout(detailHeaders, 9.4, true, isArabic ? 'ar' : 'en');

  let sumRev0 = 0;
  let sumFurther = 0;
  let sumSheets = 0;
  let sumRowAppClosed = 0;
  let sumRowRejOpen = 0;
  let sumRowPending = 0;
  let sumUnique = 0;
  let sumCurApp = 0;
  let sumCurRejOpen = 0;
  let sumCurRejClosed = 0;
  let sumCurPending = 0;
  let sumCritical = 0;
  let sumSuperseded = 0;

  const detailRows = dashData.byDocType.map(row => {
    const crit = row.criticalCount || 0;
    const rowAppClosed = row.stats.rowApprovedClosed ?? ((row.stats.rowApproved || 0) + (row.stats.rowRejectedClosed || 0));
    const rowRejOpen = row.stats.rowRejectedOpen ?? (row.stats.rejectedOpenRows || 0);
    const rowPend = row.stats.rowPending || 0;
    const tRows = row.stats.totalSubmittedSheets || 0;
    const tUnique = row.stats.totalUniqueDrawings || 0;
    const superRows = Math.max(0, tRows - tUnique);

    sumRev0 += (row.stats.totalSheetsRev0 || 0);
    sumFurther += (row.stats.totalSheetsFurtherRev || 0);
    sumSheets += tRows;
    sumRowAppClosed += rowAppClosed;
    sumRowRejOpen += rowRejOpen;
    sumRowPending += rowPend;
    sumUnique += tUnique;
    sumCurApp += (row.stats.currentApproved || 0);
    sumCurRejOpen += (row.stats.currentRejectedOpen || 0);
    sumCurRejClosed += (row.stats.currentRejectedClosed || 0);
    sumCurPending += (row.stats.currentPending || 0);
    sumCritical += crit;
    sumSuperseded += superRows;

    return {
      documentType: row.documentType,
      priority: crit > 0 ? `CRITICAL (${crit})` : '-',
      criticalCount: crit,
      rev00Rows: row.stats.totalSheetsRev0 || 0,
      furtherRevRows: row.stats.totalSheetsFurtherRev || 0,
      totalRows: tRows,
      uniqueRev00: row.stats.totalSubmittalsRev0 || 0,
      uniqueFurtherRev: row.stats.totalSubmittalsFurtherRev || 0,
      totalUnique: tUnique,
      approved: row.stats.currentApproved || 0,
      rejectedOpen: row.stats.currentRejectedOpen || 0,
      rejectedClosed: row.stats.currentRejectedClosed || 0,
      pending: row.stats.currentPending || 0,
      superseded: superRows,
      rowAppClosed,
      rowRejOpen,
      rowPending: rowPend
    };
  });

  const detailTotalRow = {
    documentType: isArabic ? "الإجمالي الكلي" : "TOTAL",
    priority: sumCritical > 0 ? `CRITICAL (${sumCritical})` : "-",
    criticalCount: sumCritical,
    rev00Rows: sumRev0,
    furtherRevRows: sumFurther,
    totalRows: sumSheets,
    uniqueRev00: dashData.byDocType.reduce((acc, r) => acc + (r.stats.totalSubmittalsRev0 || 0), 0),
    uniqueFurtherRev: dashData.byDocType.reduce((acc, r) => acc + (r.stats.totalSubmittalsFurtherRev || 0), 0),
    totalUnique: sumUnique,
    approved: sumCurApp,
    rejectedOpen: sumCurRejOpen,
    rejectedClosed: sumCurRejClosed,
    pending: sumCurPending,
    superseded: sumSuperseded,
    rowAppClosed: sumRowAppClosed,
    rowRejOpen: sumRowRejOpen,
    rowPending: sumRowPending
  };

  // 3. Register-Level Models
  const baseTypesOrder = ['SDW', 'SHD', 'ABD', 'MAR', 'DOC', 'WIR', 'MIR', 'RFI', 'NCR', 'SOR', 'LTR'];
  const presentBaseTypes = Array.from(new Set(data.map(d => (d.documentType || d.logType || 'DOC').split('-')[0].trim().toUpperCase())));
  const sortedBaseTypes = baseTypesOrder.filter(bt => presentBaseTypes.includes(bt));
  presentBaseTypes.forEach(bt => {
    if (!sortedBaseTypes.includes(bt) && bt !== 'UNKNOWN' && bt !== 'UNCLASSIFIED') sortedBaseTypes.push(bt);
  });

  const registers: RegisterViewModel[] = sortedBaseTypes.map(bt => {
    const regTitle = getRegisterTitle(bt, isArabic ? 'ar' : 'en');
    const isRevBased = bt !== 'LTR' && bt !== 'RFI' && bt !== 'NCR' && bt !== 'SOR';

    // Canonical column definitions (Official Management Table: Status | Total Submittals | Rev.00 | Further Rev. | Total Sheets | Approved | Rejected | Pending)
    let cols = [
      { label: "Status", key: "discipline" },
      { label: "Total Submittals", key: "TotalSubmittals" },
      { label: "Rev.00", key: "Rev00" },
      { label: "Further Rev.", key: "FurtherRev" },
      { label: "Total Sheets", key: "TotalSheets" },
      { label: "Approved", key: "Approved" },
      { label: "Rejected", key: "Rejected" },
      { label: "Pending", key: "Pending" }
    ];

    if (bt === 'NCR' || bt === 'SOR') {
      cols = [
        { label: "Discipline", key: "discipline" },
        { label: "Total Rev.00", key: "Rev00" },
        { label: "Total Further", key: "FurtherRev" },
        { label: "Total", key: "Total" },
        { label: "Closed", key: "Closed" },
        { label: "Open", key: "Open" },
        { label: "Pending", key: "Pending" }
      ];
    } else if (bt === 'RFI') {
      cols = [
        { label: "Discipline", key: "discipline" },
        { label: "Total Rev.00", key: "Rev00" },
        { label: "Total Further", key: "FurtherRev" },
        { label: "Total", key: "Total" },
        { label: "Closed", key: "Closed" },
        { label: "Pending", key: "Pending" }
      ];
    } else if (bt === 'LTR') {
      cols = [
        { label: "Stakeholder", key: "discipline" },
        { label: "Sent", key: "Rev00" },
        { label: "Received", key: "FurtherRev" },
        { label: "Total", key: "Total" }
      ];
    }

    const mStats = compileStatsForBaseType(monthlyData, bt, monthlyStart, data);
    const cStats = compileStatsForBaseType(cumulativeData, bt, undefined, data);

    const layout = calculateTableLayout(cols, 5.5, false, isArabic ? 'ar' : 'en');

    // Chart Data (Raw Excel Row Grain matching Rev.00 Rows and Further Rev. Rows in the table)
    const chartVal1Label = bt === 'LTR' ? "Sent" : "Rev.00 Rows";
    const chartVal2Label = bt === 'LTR' ? "Received" : "Further Rev. Rows";
    
    const mChartData = [
      {
        name: chartVal1Label,
        labels: mStats.stats.map((s: any) => s.discipline),
        values: mStats.stats.map((s: any) => Number(s.Rev00Rows ?? s.Rev00) || 0)
      },
      {
        name: chartVal2Label,
        labels: mStats.stats.map((s: any) => s.discipline),
        values: mStats.stats.map((s: any) => Number(s.FurtherRevRows ?? s.FurtherRev) || 0)
      }
    ];

    const cChartData = [
      {
        name: chartVal1Label,
        labels: cStats.stats.map((s: any) => s.discipline),
        values: cStats.stats.map((s: any) => Number(s.Rev00Rows ?? s.Rev00) || 0)
      },
      {
        name: chartVal2Label,
        labels: cStats.stats.map((s: any) => s.discipline),
        values: cStats.stats.map((s: any) => Number(s.FurtherRevRows ?? s.FurtherRev) || 0)
      }
    ];

    // Map each discipline row to include clean Superseded count
    const enrichStatsRows = (rows: any[]) => rows.map(r => {
      const tRows = Number(r.TotalRows || r.Total || 0);
      const curUniq = Number(r.TotalSubmittals || r.TotalUnique || (Number(r.Approved || 0) + Number(r.RejectedOpen || 0) + Number(r.RejectedClosed || 0) + Number(r.Pending || 0)));
      const superRows = Math.max(0, tRows - curUniq);
      return {
        ...r,
        Superseded: superRows,
        CurrentUnique: curUniq
      };
    });

    const enrichedMStats = {
      ...mStats,
      stats: enrichStatsRows(mStats.stats),
      totalRow: enrichStatsRows([mStats.totalRow])[0],
      barChartData: mChartData
    };

    const enrichedCStats = {
      ...cStats,
      stats: enrichStatsRows(cStats.stats),
      totalRow: enrichStatsRows([cStats.totalRow])[0],
      barChartData: cChartData
    };

    return {
      baseType: bt,
      name: regTitle.name,
      subtitle: regTitle.subtitle,
      isRevisionBased: isRevBased,
      cols,
      layout,
      monthlyStats: enrichedMStats,
      cumulativeStats: enrichedCStats
    };
  });

  return {
    metadata: {
      title: isArabic ? "مراقبة وإدارة الوثائق الهندسية" : "ENGINEERING DOCUMENT CONTROL",
      subtitle: mode === 'monthly'
        ? (isArabic ? "التقرير الإحصائي ومؤشرات الأداء الشهرية" : "MONTHLY PERFORMANCE & KPI REPORT")
        : (mode === 'cumulative'
            ? (isArabic ? "التقرير الإحصائي ومؤشرات الأداء التراكمية" : "CUMULATIVE PERFORMANCE ANALYTICS REPORT")
            : (isArabic ? "العرض التنفيذي التراكمي الشامل" : "EXECUTIVE PERFORMANCE PRESENTATION")),
      projectName: projectInfo?.projectName || "STRUCTUSIGHT ENTERPRISE",
      contractorName: projectInfo?.contractorName || "MAIN CONTRACTOR",
      consultantName: projectInfo?.consultantName || "LEAD CONSULTANT",
      dateStr: new Date().toLocaleDateString(isArabic ? 'ar-EG' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      primaryColor,
      accentColor,
      fontFace,
      isArabic,
      mode
    },
    executiveOverview: {
      totalHistoricalRows,
      totalUniqueItems,
      supersededRows,
      approved,
      rejectedOpen,
      rejectedClosed,
      totalRejected,
      pending,
      activeItems,
      approvalRate,
      overdueCount,
      overdueRateOnActive,
      avgDelay,
      healthScore,
      executiveSummaryBrief: dashData.executiveSummaryBrief,
      statusDistribution
    },
    primaryDetailBreakdown: {
      layout: detailLayout,
      headers: detailHeaders,
      rows: detailRows,
      totalRow: detailTotalRow
    },
    registers,
    recommendations: (dashData.priorityRecommendations || []).map((rec: any) => ({
      ...rec,
      priority: (rec.priority === 'HIGH' || rec.priority === 'LOW' ? rec.priority : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW'
    })),
    rawDataset: activeDataset
  };
}
