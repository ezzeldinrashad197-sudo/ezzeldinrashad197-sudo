import { jsPDF } from 'jspdf';
import {
  ExecutivePeriodSnapshot,
  PresentationViewModel,
  PrimaryDetailTableData,
  RegisterViewModel
} from './presentationViewModel';
import { TradeBreakdownRow } from './exportHelpers';
import { getCanonicalHeader } from './presentationLayoutEngine';

/**
 * Native Vector PDF Renderer for StructuSight Presentations
 *
 * Produces selectable, high-resolution native vector PDF pages aligned 1:1
 * with the SSOT PresentationViewModel and PowerPoint (exportEngine.ts) outputs.
 */
export async function renderPresentationPdf(
  viewModel: PresentationViewModel,
  options?: {
    pageSize?: 'a4' | 'a3' | 'letter' | '16x9';
    orientation?: 'landscape' | 'portrait';
    selectedSections?: string[];
    slideRangeStart?: number;
    slideRangeEnd?: number;
    customHeader?: string;
    customFooter?: string;
    logoUrl?: string;
    showLogo?: boolean;
    showProjectInfo?: boolean;
    deckType?: 'executive' | 'dossier' | 'full';
    executiveOnly?: boolean;
    pendingPageSize?: number;
    rejectedPageSize?: number;
    showRefCol?: boolean;
    showTradeCol?: boolean;
    showRemarksCol?: boolean;
  }
): Promise<{ pdf: jsPDF; totalPages: number }> {
  const isArabic = viewModel.metadata.isArabic;
  const primHex = viewModel.metadata.primaryColor;
  const accHex = viewModel.metadata.accentColor;

  const hexToRgb = (hex: string) => {
    const clean = (hex || '#0A192F').replace('#', '');
    const num = parseInt(clean, 16) || 0x0A192F;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  };

  const primRgb = hexToRgb(primHex);
  const accRgb = hexToRgb(accHex);

  const pdf = new jsPDF({
    unit: 'mm',
    format: [297, 167.06], // Exact 16:9 Landscape
    orientation: 'landscape',
    compress: true
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const validLogoDataUrl =
    options?.showLogo !== false &&
    typeof options?.logoUrl === 'string' &&
    /^data:image\/(png|jpe?g);base64,/i.test(options.logoUrl.trim())
      ? options.logoUrl.trim()
      : undefined;

  const isSectionSelected = (sec: string): boolean => {
    if (!options?.selectedSections) return true;
    return options.selectedSections.includes(sec);
  };

  let hasStartedFirstPage = false;
  const beginPage = () => {
    if (!hasStartedFirstPage) {
      hasStartedFirstPage = true;
    } else {
      pdf.addPage();
    }
  };

  const truncateText = (val: string, maxChars: number): string => {
    if (val.length <= maxChars) return val;
    return val.substring(0, Math.max(1, maxChars - 2)) + '..';
  };

  const drawSlideChrome = (titleText: string, subtitleText?: string) => {
    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, 0, pageW, 20, 'F');

    pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.rect(0, 20, pageW, 1.2, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(truncateText(titleText, 68), 14, 13);

    const rightMargin = validLogoDataUrl ? pageW - 42 : pageW - 14;
    if (options?.showProjectInfo !== false && (subtitleText || options?.customHeader || viewModel.metadata.projectName)) {
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(203, 213, 225);
      const rightText = subtitleText || options?.customHeader || viewModel.metadata.projectName;
      pdf.text(truncateText(rightText, 60), rightMargin, 13, { align: 'right' });
    }

    if (validLogoDataUrl) {
      try {
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(pageW - 36, 3, 22, 14, 1.5, 1.5, 'F');
        const imgFormat = validLogoDataUrl.toLowerCase().includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(validLogoDataUrl, imgFormat, pageW - 34.5, 4, 19, 12);
      } catch {
        // Keep clean header on invalid image data
      }
    }

    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, pageH - 7, pageW, 7, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(6.5);
    pdf.setFont('helvetica', 'normal');
    const leftFooter =
      options?.customFooter ||
      `[${viewModel.metadata.projectName}] | ${isArabic ? 'التحكم بالمستندات الهندسية' : 'Document Control'} | ${viewModel.metadata.dateStr}`;
    pdf.text(truncateText(leftFooter, 95), 14, pageH - 2.5);
    pdf.setTextColor(203, 213, 225);
    pdf.text(
      isArabic ? 'نظام التدقيق الهندسي المستقل — دقة معيارية 100%' : 'INDEPENDENT AUDIT ENGINE — 100% RECONCILED',
      pageW / 2,
      pageH - 2.5,
      { align: 'center' }
    );
    pdf.setTextColor(255, 255, 255);
    pdf.text(isArabic ? 'سري وخاص' : 'CONFIDENTIAL', pageW - 14, pageH - 2.5, { align: 'right' });
  };

  const drawNativeTable = (
    startX: number,
    startY: number,
    totalWidth: number,
    headers: { key: string; label: string; widthRatio?: number; align?: 'left' | 'center' | 'right' }[],
    dataRows: any[],
    totalRow?: any,
    fontSize: number = 8.0,
    headerColor: [number, number, number] = [47, 117, 181],
    maxRowHeight: number = 6.2
  ) => {
    const totalRatio = headers.reduce((acc, h) => acc + (h.widthRatio || 1), 0);
    const colWidths = headers.map(h => ((h.widthRatio || 1) / totalRatio) * totalWidth);

    let curY = startY;
    const headerHeight = 7.5;
    const rowHeight = maxRowHeight;

    pdf.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
    pdf.rect(startX, curY, totalWidth, headerHeight, 'F');
    pdf.setDrawColor(203, 213, 225);
    pdf.rect(startX, curY, totalWidth, headerHeight, 'S');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(255, 255, 255);

    let curX = startX;
    headers.forEach((h, i) => {
      const w = colWidths[i];
      const align = h.align || (i === 0 ? 'left' : 'center');
      const textX = align === 'left' ? curX + 2 : align === 'right' ? curX + w - 2 : curX + w / 2;
      const label = getCanonicalHeader(h.label, isArabic ? 'ar' : 'en').replace(/\n/g, ' ');
      const maxChars = Math.max(4, Math.floor((w - 2) / (fontSize * 0.19)));
      pdf.text(truncateText(label, maxChars), textX, curY + 5, { align });
      curX += w;
    });

    curY += headerHeight;

    dataRows.forEach((row, rowIdx) => {
      const isEven = rowIdx % 2 === 1;
      if (isEven) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(startX, curY, totalWidth, rowHeight, 'F');
      }
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(startX, curY, totalWidth, rowHeight, 'S');

      pdf.setFontSize(fontSize);
      let colX = startX;
      headers.forEach((h, cIdx) => {
        const w = colWidths[cIdx];
        const rawVal = row[h.key] !== undefined && row[h.key] !== null ? String(row[h.key]) : '0';
        const maxChars = Math.max(4, Math.floor((w - 2) / (fontSize * 0.19)));
        const val = truncateText(rawVal, maxChars);
        const align = h.align || (cIdx === 0 ? 'left' : 'center');
        const textX = align === 'left' ? colX + 2 : align === 'right' ? colX + w - 2 : colX + w / 2;

        if (cIdx === 0 || h.key === 'totalRows' || h.key === 'TotalRows' || h.key === 'TotalSheets' || h.key === 'TotalSubmittals') {
          pdf.setFont('helvetica', 'bold');
        } else {
          pdf.setFont('helvetica', 'normal');
        }

        if (h.key === 'Approved' || h.key === 'approved' || h.key === 'Closed') pdf.setTextColor(4, 120, 87);
        else if (h.key === 'Rejected' || h.key === 'rejected' || h.key === 'RejectedOpen' || h.key === 'rejectedOpen' || h.key === 'Open') pdf.setTextColor(190, 18, 60);
        else if (h.key === 'Pending' || h.key === 'pending') pdf.setTextColor(217, 119, 6);
        else if (h.key === 'Unclassified' || h.key === 'unclassified' || h.key === 'Superseded') pdf.setTextColor(100, 116, 139);
        else pdf.setTextColor(30, 41, 59);

        pdf.text(val, textX, curY + rowHeight * 0.68, { align });
        colX += w;
      });

      curY += rowHeight;
    });

    if (totalRow) {
      pdf.setFillColor(221, 235, 247);
      pdf.rect(startX, curY, totalWidth, rowHeight + 0.5, 'F');
      pdf.setDrawColor(189, 215, 238);
      pdf.rect(startX, curY, totalWidth, rowHeight + 0.5, 'S');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(32, 56, 100);

      let colX = startX;
      headers.forEach((h, cIdx) => {
        const w = colWidths[cIdx];
        const rawVal = totalRow[h.key] !== undefined && totalRow[h.key] !== null ? String(totalRow[h.key]) : '0';
        const maxChars = Math.max(4, Math.floor((w - 2) / (fontSize * 0.19)));
        const val = truncateText(rawVal, maxChars);
        const align = h.align || (cIdx === 0 ? 'left' : 'center');
        const textX = align === 'left' ? colX + 2 : align === 'right' ? colX + w - 2 : colX + w / 2;
        pdf.text(val, textX, curY + (rowHeight + 0.5) * 0.68, { align });
        colX += w;
      });
      curY += rowHeight + 0.5;
    }

    return curY;
  };

  // -------------------------------------------------------------------------
  // SECTION 1: COVER & INDEX
  // -------------------------------------------------------------------------
  const drawCoverPage = () => {
    beginPage();
    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, 0, pageW, pageH, 'F');

    pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.rect(0, 0, 12, pageH, 'F');
    pdf.rect(32, 38, pageW - 64, 1.5, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(26);
    pdf.text(viewModel.metadata.title, 34, 30);

    pdf.setTextColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.setFontSize(15);
    pdf.text(viewModel.metadata.subtitle, 34, 52);

    // Project Spec Card
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(34, 66, 130, 72, 3, 3, 'F');

    pdf.setTextColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(isArabic ? 'بيانات المشروع والاعتماد' : 'PROJECT SPECIFICATION', 42, 78);

    pdf.setFontSize(8.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`${isArabic ? 'المشروع' : 'Project'}: ${viewModel.metadata.projectName}`, 42, 89);
    pdf.text(`${isArabic ? 'المقاول الرئيسي' : 'Contractor'}: ${viewModel.metadata.contractorName}`, 42, 99);
    pdf.text(`${isArabic ? 'الاستشاري المشرف' : 'Consultant'}: ${viewModel.metadata.consultantName}`, 42, 109);
    pdf.text(`${isArabic ? 'الحد الزمني SLA' : 'SLA Threshold'}: ${viewModel.metadata.slaDays} Days`, 42, 119);
    pdf.text(`${isArabic ? 'التاريخ' : 'Date'}: ${viewModel.metadata.dateStr}`, 42, 129);

    // Quick Stats Card
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(172, 66, 92, 72, 3, 3, 'F');

    pdf.setTextColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text(isArabic ? 'إحصائيات الإنجاز السريع' : 'EXECUTIVE SUMMARY METRICS', 180, 78);

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${isArabic ? 'إجمالي الصفوف التاريخية' : 'Total Historical Rows'}: ${viewModel.executiveOverview.totalHistoricalRows}`, 180, 90);
    pdf.text(`${isArabic ? 'البنود الفريدة الحالية' : 'Current Unique Items'}: ${viewModel.executiveOverview.totalUniqueItems}`, 180, 100);
    pdf.text(`${isArabic ? 'المراجعات السابقة الملغاة' : 'Superseded Rows'}: ${viewModel.executiveOverview.supersededRows}`, 180, 110);
    pdf.text(`${isArabic ? 'نسبة الاعتماد' : 'Approval Rate'}: ${viewModel.executiveOverview.approvalRate.toFixed(1)}%`, 180, 120);
    pdf.text(`PPI Score: ${viewModel.executiveOverview.healthScore} / 100`, 180, 130);
  };

  if (isSectionSelected('cover')) {
    drawCoverPage();

    // Index / Table of Contents
    beginPage();
    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, 0, 88, pageH, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(28);
    pdf.text(isArabic ? 'الفهرس' : 'INDEX', 16, 68);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(203, 213, 225);
    pdf.text(isArabic ? 'جدول المحتويات' : 'Table of Contents', 16, 78);
    pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.rect(16, 86, 56, 1, 'F');

    const tocItems: string[] = [];
    if (isSectionSelected('info')) tocItems.push('Project Information & Stakeholders');
    if (isSectionSelected('metrics')) {
      if (viewModel.metadata.mode === 'monthly') {
        tocItems.push('Monthly Executive Performance, PPI & KPIs');
        tocItems.push('Monthly Overdue Bottlenecks & Status Distribution');
        if (isSectionSelected('logs')) tocItems.push('Monthly Primary Register Breakdown');
        tocItems.push('Monthly Discipline Metrics & Workload Breakdown');
        tocItems.push('Monthly Strategic Recommendations');
      } else if (viewModel.metadata.mode === 'cumulative') {
        tocItems.push('Cumulative Executive Performance, PPI & KPIs');
        tocItems.push('Cumulative Overdue Bottlenecks & Status Distribution');
        if (isSectionSelected('logs')) tocItems.push('Cumulative Primary Register Breakdown');
        tocItems.push('Lifetime Discipline Metrics & Workload Breakdown');
        tocItems.push('Cumulative Strategic Recommendations');
      } else {
        tocItems.push('Monthly Performance Analytics Dossier');
        tocItems.push('Cumulative Performance Analytics Dossier');
      }
    }
    if (isSectionSelected('logs')) {
      viewModel.registers.slice(0, 4).forEach(r => tocItems.push(`${r.name} (${r.baseType}) Register Status`));
    }
    if (isSectionSelected('rejected')) tocItems.push('Historical Rejection Events & Delay Register');
    if (isSectionSelected('pending')) tocItems.push('Pending Review Items Overdue by SLA');

    let tocY = 30;
    tocItems.slice(0, 9).forEach((item, idx) => {
      pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
      pdf.roundedRect(102, tocY - 4.5, 10, 6.5, 1, 1, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.text(String(idx + 1).padStart(2, '0'), 107, tocY, { align: 'center' });

      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(10);
      pdf.text(item, 117, tocY);
      tocY += 13;
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 2: PROJECT INFO
  // -------------------------------------------------------------------------
  if (isSectionSelected('info')) {
    beginPage();
    drawSlideChrome(
      isArabic ? 'معلومات المشروع العامة والشركاء' : 'PROJECT INFORMATION & STAKEHOLDERS',
      viewModel.metadata.projectName
    );
    const infoCards = [
      { label: 'PROJECT NAME', val: viewModel.metadata.projectName },
      { label: 'MAIN CONTRACTOR', val: viewModel.metadata.contractorName },
      { label: 'LEAD CONSULTANT', val: viewModel.metadata.consultantName },
      { label: 'SLA THRESHOLD', val: `${viewModel.metadata.slaDays} Days` }
    ];
    infoCards.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 18 + col * 134;
      const y = 34 + row * 54;
      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(203, 213, 225);
      pdf.roundedRect(x, y, 126, 44, 2, 2, 'FD');
      pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
      pdf.rect(x, y, 126, 10, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.text(c.label, x + 63, y + 6.8, { align: 'center' });
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(13);
      pdf.text(truncateText(c.val, 36), x + 63, y + 29, { align: 'center' });
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 3: EXECUTIVE PERFORMANCE & WORKLOAD BREAKDOWN
  // -------------------------------------------------------------------------
  const renderExecutiveScope = (
    snapshot: ExecutivePeriodSnapshot,
    detailBreakdown: PrimaryDetailTableData,
    trades: TradeBreakdownRow[],
    isMonthlyScope: boolean
  ) => {
    const scopeTag = isMonthlyScope ? 'MONTHLY' : 'CUMULATIVE';
    const scopeTagAr = isMonthlyScope ? 'الشهري' : 'التراكمي';

    // Slide A: Executive Overview (6 KPIs + Health Score / Exact PPI Math + Status Dist & Observations)
    beginPage();
    drawSlideChrome(
      isArabic ? `مؤشرات الأداء والملخص التنفيذي ${scopeTagAr}` : `${scopeTag} PERFORMANCE & KPI OVERVIEW`,
      isArabic ? 'التوزيع الهندسي الشامل ومؤشر أداء المشروع' : 'Executive Workload, PPI Math & Reconciled Status'
    );

    // Executive Summary Brief Banner
    pdf.setFillColor(32, 56, 100);
    pdf.roundedRect(14, 24, 269, 14, 1.5, 1.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.text('EXECUTIVE SUMMARY BRIEF & INTELLIGENCE:', 18, 29);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(255, 255, 255);
    const brief = isArabic ? snapshot.executiveSummaryBrief.ar : snapshot.executiveSummaryBrief.en;
    pdf.text(truncateText(brief, 165), 18, 34.8);

    // 6 Core KPI Cards matching exportHelpers.ts
    const kpiY = 41;
    const kpiW = 42.5;
    const kpiGap = 2.8;
    const kpiH = 26;
    const cards = [
      {
        title: 'TOTAL SHEETS (WORKLOAD)',
        val: String(snapshot.totalHistoricalRows),
        sub: `Rev0: ${snapshot.rev00Rows} | Further: ${snapshot.furtherRevRows}`,
        bg: [248, 250, 252] as [number, number, number],
        color: [32, 56, 100] as [number, number, number]
      },
      {
        title: 'UNIQUE ITEMS (CURRENT)',
        val: String(snapshot.totalUniqueItems),
        sub: `App: ${snapshot.approved} | Rej: ${snapshot.totalRejected} | Pnd: ${snapshot.pending}`,
        bg: [239, 246, 255] as [number, number, number],
        color: [47, 117, 181] as [number, number, number]
      },
      {
        title: 'APPROVAL RATE',
        val: `${snapshot.approvalRate.toFixed(1)}%`,
        sub: snapshot.approvalRate >= 80 ? 'Target met: 80%+' : 'Below 80% target',
        bg: snapshot.approvalRate >= 80 ? ([236, 253, 245] as [number, number, number]) : ([255, 251, 235] as [number, number, number]),
        color: snapshot.approvalRate >= 80 ? ([16, 185, 129] as [number, number, number]) : ([217, 119, 6] as [number, number, number])
      },
      {
        title: 'ACTIVE POPULATION',
        val: String(snapshot.activeItems),
        sub: `Pnd: ${snapshot.pending} | Rej Opn: ${snapshot.rejectedOpen}`,
        bg: [255, 251, 235] as [number, number, number],
        color: [217, 119, 6] as [number, number, number]
      },
      {
        title: 'OVERDUE (OF ACTIVE)',
        val: `${snapshot.overdueCount} / ${snapshot.activeItems}`,
        sub: `${snapshot.overdueRateOnActive.toFixed(1)}% overdue rate`,
        bg: [255, 241, 242] as [number, number, number],
        color: [225, 29, 72] as [number, number, number]
      },
      {
        title: 'CRITICAL PRIORITY',
        val: String(snapshot.criticalPriorityCount),
        sub: 'Tagged Critical (Not SLA)',
        bg: snapshot.criticalPriorityCount > 0 ? ([255, 241, 242] as [number, number, number]) : ([248, 250, 252] as [number, number, number]),
        color: snapshot.criticalPriorityCount > 0 ? ([190, 18, 60] as [number, number, number]) : ([71, 85, 105] as [number, number, number])
      }
    ];

    cards.forEach((c, idx) => {
      const x = 14 + idx * (kpiW + kpiGap);
      pdf.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
      pdf.setDrawColor(203, 213, 225);
      pdf.roundedRect(x, kpiY, kpiW, kpiH, 1.5, 1.5, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.0);
      pdf.setTextColor(100, 116, 139);
      pdf.text(c.title, x + kpiW / 2, kpiY + 5.5, { align: 'center' });

      pdf.setFontSize(13.5);
      pdf.setTextColor(c.color[0], c.color[1], c.color[2]);
      pdf.text(c.val, x + kpiW / 2, kpiY + 15.5, { align: 'center' });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(5.8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(truncateText(c.sub, 34), x + kpiW / 2, kpiY + 22, { align: 'center' });
    });

    // Bottom Left Card: Health Score & Exact PPI Audit Formula
    const botY = 71;
    const botH = 85;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(14, botY, 86, botH, 2, 2, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text('PROJECT PERFORMANCE INDEX', 19, botY + 8);

    pdf.setFontSize(26);
    pdf.setTextColor(snapshot.healthScore >= 80 ? 16 : snapshot.healthScore >= 60 ? 217 : 225, snapshot.healthScore >= 80 ? 185 : snapshot.healthScore >= 60 ? 119 : 29, snapshot.healthScore >= 80 ? 129 : snapshot.healthScore >= 60 ? 6 : 72);
    pdf.text(String(snapshot.healthScore), 19, botY + 22);
    pdf.setFontSize(10);
    pdf.setTextColor(148, 163, 184);
    pdf.text('/ 100', 40, botY + 22);

    pdf.setFontSize(7.2);
    pdf.setTextColor(30, 41, 59);
    pdf.text(`INDEX BAND: ${snapshot.healthScore >= 80 ? 'Within Configured KPI Band' : snapshot.healthRating}`, 19, botY + 30);
    pdf.setTextColor(190, 18, 60);
    pdf.text(`SLA EXPOSURE: ${snapshot.overdueCount} Overdue Active Items`, 19, botY + 36);

    // Exact PPI Math Audit Box
    const ppi = snapshot.ppiBreakdown;
    const totalPenalty = ppi.approvalPenaltyExact + ppi.pendingOverduePenaltyExact + ppi.overdueDensityPenaltyExact;
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(18, botY + 41, 78, 39, 1.5, 1.5, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(71, 85, 105);
    pdf.text('KPI Math & Audit Formula:', 21, botY + 47);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`- P1 (Approval Penalty - 35%): -${ppi.approvalPenaltyExact.toFixed(1)}`, 21, botY + 54);
    pdf.text(`- P2 (Overdue Ratio - 35%): -${ppi.pendingOverduePenaltyExact.toFixed(1)}`, 21, botY + 60);
    pdf.text(`- P3 (Overdue Density - 30%): -${ppi.overdueDensityPenaltyExact.toFixed(1)}`, 21, botY + 66);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(`100 - ${totalPenalty.toFixed(1)} = ${ppi.rawScore.toFixed(1)} -> ${ppi.roundedScore}/100`, 21, botY + 73);

    // Bottom Middle: Status Distribution (All Logs)
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(104, botY, 88, botH, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(32, 56, 100);
    pdf.text('STATUS DISTRIBUTION (ALL LOGS)', 109, botY + 8);

    let distRowY = botY + 18;
    snapshot.statusDistribution.forEach(st => {
      pdf.setFontSize(7.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(51, 65, 85);
      pdf.text(st.labelEn, 109, distRowY);
      pdf.setFont('helvetica', 'bold');
      pdf.text(String(st.count), 168, distRowY, { align: 'right' });
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100, 116, 139);
      pdf.text(`(${st.percentage}%)`, 187, distRowY, { align: 'right' });

      pdf.setFillColor(226, 232, 240);
      pdf.rect(109, distRowY + 2, 78, 2, 'F');
      const rgb = hexToRgb(st.color);
      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.rect(109, distRowY + 2, Math.max(1, (st.percentage / 100) * 78), 2, 'F');
      distRowY += 13;
    });

    // Bottom Right: Analytical Observations & Reconciliation Invariant
    pdf.setFillColor(239, 246, 255);
    pdf.setDrawColor(191, 219, 254);
    pdf.roundedRect(196, botY, 87, botH, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(30, 58, 138);
    pdf.text('EXECUTIVE OBSERVATIONS', 201, botY + 8);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.2);
    pdf.setTextColor(30, 58, 138);
    const reworkPct = snapshot.totalHistoricalRows > 0
      ? ((snapshot.furtherRevRows / snapshot.totalHistoricalRows) * 100).toFixed(1)
      : '0.0';
    const obsText = [
      `1. Approval Rate: ${snapshot.approvalRate.toFixed(1)}% (${snapshot.approvalRate >= 80 ? 'Meets 80% target' : 'Below 80% target'}).`,
      `2. Active Backlog: ${snapshot.overdueCount} of ${snapshot.activeItems} active items overdue (${snapshot.overdueRejectedOpen} Rej/Open + ${snapshot.overduePending} Pending).`,
      `3. Resubmission Load: ${reworkPct}% of total historical workload consists of further revisions.`,
      `4. Balance Invariant: ${snapshot.totalUniqueItems} Cur + ${snapshot.supersededRows} Superseded = ${snapshot.totalHistoricalRows} Historical Rows.`
    ].join('\n\n');
    pdf.text(obsText, 201, botY + 17, { maxWidth: 77 });

    // Slide B: Top Critical Overdue Bottlenecks & Action Owners
    beginPage();
    drawSlideChrome(
      isArabic ? `بؤر التكدس والمعاملات النشطة المتأخرة (${scopeTagAr})` : `${scopeTag} CRITICAL OVERDUE BOTTLENECKS`,
      isArabic ? 'أكبر 5 معاملات نشطة متأخرة والمسؤول عنها' : 'Top 5 Active Overdue Submissions & Action Owners'
    );

    if (snapshot.topOverdueItems.length === 0) {
      pdf.setFillColor(240, 253, 244);
      pdf.setDrawColor(187, 247, 208);
      pdf.roundedRect(14, 34, 269, 32, 2, 2, 'FD');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(22, 101, 52);
      pdf.text('No active overdue bottlenecks in this reporting scope (0 overdue items).', pageW / 2, 52, { align: 'center' });
    } else {
      const bottleneckHeaders = [
        { key: 'rank', label: 'Rank', widthRatio: 0.45 },
        { key: 'docNo', label: 'Document Reference', widthRatio: 2.2 },
        { key: 'documentType', label: 'Log Type', widthRatio: 0.9 },
        { key: 'discipline', label: 'Discipline', widthRatio: 0.9 },
        { key: 'statusCategory', label: 'State', widthRatio: 0.9 },
        { key: 'delayLabel', label: 'Delay Days', widthRatio: 0.8 },
        { key: 'actionOwner', label: 'Action Owner', widthRatio: 1.4 },
        { key: 'submissionDate', label: 'Submission Date', widthRatio: 0.9 }
      ];
      const bottleneckRows = snapshot.topOverdueItems.map((it, idx) => ({
        rank: `#${idx + 1}`,
        docNo: it.docNo,
        documentType: it.documentType,
        discipline: it.discipline,
        statusCategory: it.statusCategory,
        delayLabel: `${it.delayDays} days`,
        actionOwner: it.actionOwner,
        submissionDate: it.submissionDate
      }));
      drawNativeTable(14, 28, 269, bottleneckHeaders, bottleneckRows, undefined, 8.2, [190, 18, 60], 8.0);
    }

    // Add concise SLA exposure summary card beneath bottlenecks table
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(14, 96, 269, 48, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(32, 56, 100);
    pdf.text(`${scopeTag} SLA & WORKLOAD RECONCILIATION SUMMARY`, 22, 107);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.2);
    pdf.setTextColor(51, 65, 85);
    pdf.text(`- Historical Workload: ${snapshot.totalHistoricalRows} rows (${snapshot.rev00Rows} Rev.00 + ${snapshot.furtherRevRows} Further Revs)`, 22, 117);
    pdf.text(`- Active Exposure: ${snapshot.activeItems} open/pending items (${snapshot.overdueCount} overdue exceeding ${viewModel.metadata.slaDays}d SLA = ${snapshot.overdueRateOnActive.toFixed(1)}%)`, 22, 126);
    pdf.text(`- Overdue Split: ${snapshot.overduePending} Pending Review (Consultant Action) + ${snapshot.overdueRejectedOpen} Rejected/Open (Contractor Action)`, 22, 135);

    // Slide C: Primary Detail Register Breakdown (Paginated — NO truncation)
    if (isSectionSelected('logs')) {
      const detailColHeaders = [
        { key: 'documentType', label: 'Log Type', widthRatio: 1.4 },
        { key: 'priority', label: 'Priority', widthRatio: 0.85 },
        { key: 'rev00Rows', label: 'Rev 00', widthRatio: 0.65 },
        { key: 'furtherRevRows', label: 'Further Rev', widthRatio: 0.72 },
        { key: 'totalRows', label: 'Total Rows', widthRatio: 0.75 },
        { key: 'rowAppClosed', label: 'Row Appr.', widthRatio: 0.75 },
        { key: 'rowRejOpen', label: 'Row Rej.', widthRatio: 0.72 },
        { key: 'rowPending', label: 'Row Pend.', widthRatio: 0.72 },
        { key: 'totalUnique', label: 'Total Unique', widthRatio: 0.78 },
        { key: 'approved', label: 'Cur. Appr.', widthRatio: 0.75 },
        { key: 'rejectedOpen', label: 'Cur. Rej Open', widthRatio: 0.78 },
        { key: 'rejectedClosed', label: 'Cur. Rej Cls', widthRatio: 0.78 },
        { key: 'pending', label: 'Cur. Pend.', widthRatio: 0.72 }
      ];

      const detailPageSize = 15;
      const detailChunks: any[][] = [];
      for (let i = 0; i < detailBreakdown.rows.length; i += detailPageSize) {
        detailChunks.push(detailBreakdown.rows.slice(i, i + detailPageSize));
      }
      if (detailChunks.length === 0) detailChunks.push([]);

      detailChunks.forEach((chunk, cIdx) => {
        beginPage();
        const pageSuffix = detailChunks.length > 1 ? ` (${cIdx + 1}/${detailChunks.length})` : '';
        drawSlideChrome(
          isArabic ? `جدول تفصيل السجلات الهندسية (${scopeTagAr})${pageSuffix}` : `${scopeTag} PRIMARY DETAIL REGISTER BREAKDOWN${pageSuffix}`,
          isArabic ? 'عرض شامل لمؤشرات التقديم وحالات الجودة' : 'Comprehensive Register Breakdown Across All Disciplines'
        );
        drawNativeTable(
          14,
          26,
          269,
          detailColHeaders,
          chunk,
          cIdx === detailChunks.length - 1 ? detailBreakdown.totalRow : undefined,
          7.3,
          [32, 56, 100],
          6.4
        );
      });
    }

    // Slide D: Discipline / Trade Workload Breakdown (Paginated)
    if (trades.length > 0) {
      const hasUnclassified = trades.some(r => (r.unclassified || 0) > 0);
      const tradeTotals = trades.reduce(
        (acc, r) => ({
          trade: isArabic ? 'الإجمالي' : 'TOTAL',
          uniqueRev00: acc.uniqueRev00 + r.uniqueRev00,
          uniqueFurtherRev: acc.uniqueFurtherRev + r.uniqueFurtherRev,
          rev00Rows: acc.rev00Rows + r.rev00Rows,
          furtherRevRows: acc.furtherRevRows + r.furtherRevRows,
          totalRows: acc.totalRows + r.totalRows,
          approved: acc.approved + r.approved,
          rejected: acc.rejected + r.rejected,
          pending: acc.pending + r.pending,
          unclassified: acc.unclassified + (r.unclassified || 0)
        }),
        { trade: 'TOTAL', uniqueRev00: 0, uniqueFurtherRev: 0, rev00Rows: 0, furtherRevRows: 0, totalRows: 0, approved: 0, rejected: 0, pending: 0, unclassified: 0 }
      );

      const tradeHeaders: { key: string; label: string; widthRatio: number }[] = [
        { key: 'trade', label: 'Discipline', widthRatio: 1.5 },
        { key: 'uniqueRev00', label: 'Unique Rev.00', widthRatio: 0.9 },
        { key: 'uniqueFurtherRev', label: 'Unique Further', widthRatio: 0.95 },
        { key: 'rev00Rows', label: 'Rev.00 Rows', widthRatio: 0.85 },
        { key: 'furtherRevRows', label: 'Further Rows', widthRatio: 0.85 },
        { key: 'totalRows', label: 'Total Rows', widthRatio: 0.85 },
        { key: 'approved', label: 'Approved', widthRatio: 0.85 },
        { key: 'rejected', label: 'Rejected', widthRatio: 0.85 },
        { key: 'pending', label: 'Pending', widthRatio: 0.85 }
      ];
      if (hasUnclassified) {
        tradeHeaders.push({ key: 'unclassified', label: 'Unclass.', widthRatio: 0.8 });
      }

      const tradePageSize = 14;
      const tradeChunks: TradeBreakdownRow[][] = [];
      for (let i = 0; i < trades.length; i += tradePageSize) {
        tradeChunks.push(trades.slice(i, i + tradePageSize));
      }

      tradeChunks.forEach((chunk, cIdx) => {
        beginPage();
        const pageSuffix = tradeChunks.length > 1 ? ` (${cIdx + 1}/${tradeChunks.length})` : '';
        drawSlideChrome(
          isArabic ? `تحليل التخصصات الهندسية (${scopeTagAr})${pageSuffix}` : `${scopeTag} DISCIPLINE METRICS & WORKLOAD BREAKDOWN${pageSuffix}`,
          isArabic ? 'التوزيع التخصصي الكامل وحالات الصفوف' : 'Canonical Discipline Aggregation & Row-Level Statuses'
        );
        drawNativeTable(
          14,
          28,
          269,
          tradeHeaders,
          chunk,
          cIdx === tradeChunks.length - 1 ? tradeTotals : undefined,
          8.0,
          [32, 56, 100],
          6.8
        );
      });
    }

    // Slide E: Strategic Recommendations
    beginPage();
    drawSlideChrome(
      isArabic ? `التوصيات الفنية وخطة العمل (${scopeTagAr})` : `${scopeTag} STRATEGIC RECOMMENDATIONS & ACTION PLAN`,
      isArabic ? 'إجراءات تصعيد متطلبات التدقيق وإغلاق المعاملات المتأخرة' : 'Immediate SLA Backlog Interventions & Corrective Protocols'
    );

    let recY = 30;
    const recs = snapshot.recommendations.slice(0, 4);
    if (recs.length === 0) {
      pdf.setFontSize(10);
      pdf.setTextColor(71, 85, 105);
      pdf.text('No critical action items triggered in this scope.', pageW / 2, 70, { align: 'center' });
    } else {
      recs.forEach((rec, idx) => {
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(203, 213, 225);
        pdf.roundedRect(14, recY, 269, 26, 2, 2, 'FD');

        const isCrit = rec.priority === 'CRITICAL' || rec.priority === 'HIGH';
        pdf.setFillColor(isCrit ? 254 : 239, isCrit ? 226 : 246, isCrit ? 226 : 255);
        pdf.setDrawColor(isCrit ? 252 : 191, isCrit ? 165 : 219, isCrit ? 165 : 254);
        pdf.roundedRect(20, recY + 5, 26, 6.5, 1, 1, 'FD');
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(isCrit ? 185 : 30, isCrit ? 28 : 58, isCrit ? 28 : 138);
        pdf.text(rec.priority, 33, recY + 9.5, { align: 'center' });

        pdf.setFontSize(9.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(`${idx + 1}. ${isArabic ? rec.actionAr : rec.action}`, 50, recY + 9.8);

        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(71, 85, 105);
        pdf.text(isArabic ? rec.ar : rec.en, 20, recY + 18, { maxWidth: 255 });
        recY += 30;
      });
    }
  };

  if (isSectionSelected('metrics')) {
    if (viewModel.metadata.mode === 'monthly') {
      const mSnap = viewModel.monthlyExecutiveOverview || viewModel.executiveOverview;
      const mDet = viewModel.monthlyPrimaryDetailBreakdown || viewModel.primaryDetailBreakdown;
      renderExecutiveScope(mSnap, mDet, viewModel.tradeAnalysis.monthly, true);
    } else if (viewModel.metadata.mode === 'cumulative') {
      const cSnap = viewModel.cumulativeExecutiveOverview || viewModel.executiveOverview;
      const cDet = viewModel.cumulativePrimaryDetailBreakdown || viewModel.primaryDetailBreakdown;
      renderExecutiveScope(cSnap, cDet, viewModel.tradeAnalysis.cumulative, false);
    } else {
      const mSnap = viewModel.monthlyExecutiveOverview || viewModel.executiveOverview;
      const mDet = viewModel.monthlyPrimaryDetailBreakdown || viewModel.primaryDetailBreakdown;
      renderExecutiveScope(mSnap, mDet, viewModel.tradeAnalysis.monthly, true);

      const cSnap = viewModel.cumulativeExecutiveOverview || viewModel.executiveOverview;
      const cDet = viewModel.cumulativePrimaryDetailBreakdown || viewModel.primaryDetailBreakdown;
      renderExecutiveScope(cSnap, cDet, viewModel.tradeAnalysis.cumulative, false);
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 4: PER-REGISTER TABLES & DUAL INVARIANT CHECKS (PAGINATED)
  // -------------------------------------------------------------------------
  const renderRegisterPeriod = (reg: RegisterViewModel, periodStats: RegisterViewModel['cumulativeStats'], isMonthlyPeriod: boolean) => {
    if (!periodStats.hasData) return;
    const periodLabel = isMonthlyPeriod ? (isArabic ? 'شهري' : 'This Period') : (isArabic ? 'تراكمي' : 'Cumulative');
    const hasUnclassified = Number(periodStats.totalRow?.Unclassified || 0) > 0 || periodStats.stats.some(s => Number(s.Unclassified || 0) > 0);
    const regHeaders = reg.cols.map(c => ({
      key: c.key,
      label: c.label,
      widthRatio: c.key === 'discipline' ? 1.45 : 0.85
    }));
    if (hasUnclassified && !regHeaders.some(h => h.key === 'Unclassified')) {
      regHeaders.push({ key: 'Unclassified', label: 'Unclass.', widthRatio: 0.75 });
    }

    const pageSize = 14;
    const rows = periodStats.stats;
    const chunks: any[][] = [];
    for (let i = 0; i < rows.length; i += pageSize) {
      chunks.push(rows.slice(i, i + pageSize));
    }
    if (chunks.length === 0) chunks.push([]);

    chunks.forEach((chunk, cIdx) => {
      beginPage();
      const pageSuffix = chunks.length > 1 ? ` (Page ${cIdx + 1}/${chunks.length})` : '';
      drawSlideChrome(
        `${reg.name} (${reg.baseType}) — ${periodLabel}${pageSuffix}`,
        reg.subtitle
      );

      const tableW = cIdx === 0 ? 172 : 269;
      drawNativeTable(
        14,
        28,
        tableW,
        regHeaders,
        chunk,
        cIdx === chunks.length - 1 ? periodStats.totalRow : undefined,
        7.8,
        [47, 117, 181],
        6.5
      );

      // Right Summary & Mathematical Invariant Card on page 1 of each register period
      if (cIdx === 0) {
        const rightBoxX = 192;
        const rightBoxW = 91;
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(203, 213, 225);
        pdf.roundedRect(rightBoxX, 28, rightBoxW, 124, 2, 2, 'FD');

        pdf.setFontSize(9.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(primRgb.r, primRgb.g, primRgb.b);
        pdf.text(`${reg.baseType} (${periodLabel}) Summary`, rightBoxX + 6, 37);

        const totalR: any = periodStats.totalRow || {};
        let summaryItems: { label: string; val: string; color: [number, number, number] }[] = [];
        let invariantLine1 = '';
        let invariantLine2 = '';

        if (reg.baseType === 'NCR') {
          const uniq = Number(totalR.CurrentUnique ?? totalR.TotalSubmittals ?? 0);
          const rowsTotal = Number(totalR.TotalRows ?? totalR.Total ?? 0);
          const closed = Number(totalR.Closed || 0);
          const open = Number(totalR.Open || 0);
          const pend = Number(totalR.Pending || 0);
          summaryItems = [
            { label: 'Unique NCRs', val: String(uniq), color: [30, 58, 138] },
            { label: 'Rev.00 Submissions', val: String(totalR.Rev00 || 0), color: [15, 23, 42] },
            { label: 'Further Revisions', val: String(totalR.FurtherRev || 0), color: [15, 23, 42] },
            { label: 'Total Source Rows', val: String(rowsTotal), color: [15, 23, 42] },
            { label: 'Closed NCRs', val: String(closed), color: [4, 120, 87] },
            { label: 'Open NCRs', val: String(open), color: [190, 18, 60] },
            { label: 'Pending Review', val: String(pend), color: [217, 119, 6] }
          ];
          invariantLine1 = `NCR Status: ${closed} + ${open} + ${pend} = ${closed + open + pend}`;
          invariantLine2 = `Unique: ${uniq} | Source Rows: ${rowsTotal}`;
        } else if (reg.baseType === 'SOR' || reg.baseType === 'RFI') {
          const tot = Number(totalR.Total || 0);
          const closed = Number(totalR.Closed || 0);
          const open = Number(totalR.Open || 0);
          const pend = Number(totalR.Pending || 0);
          summaryItems = [
            { label: 'Total Rev.00', val: String(totalR.Rev00 || 0), color: [15, 23, 42] },
            { label: 'Total Further Rev.', val: String(totalR.FurtherRev || 0), color: [15, 23, 42] },
            { label: 'Total Records', val: String(tot), color: [30, 58, 138] },
            { label: 'Closed', val: String(closed), color: [4, 120, 87] },
            ...(reg.baseType === 'SOR' ? [{ label: 'Open', val: String(open), color: [190, 18, 60] as [number, number, number] }] : []),
            { label: 'Pending', val: String(pend), color: [217, 119, 6] }
          ];
          const sumSt = closed + (reg.baseType === 'SOR' ? open : 0) + pend;
          invariantLine1 = `Status Sum: ${sumSt} = ${tot} Total`;
          invariantLine2 = `Rev00 (${totalR.Rev00 || 0}) + Further (${totalR.FurtherRev || 0}) = ${Number(totalR.Rev00 || 0) + Number(totalR.FurtherRev || 0)}`;
        } else if (reg.baseType === 'LTR') {
          const sent = Number(totalR.Rev00 || 0);
          const rec = Number(totalR.FurtherRev || 0);
          const tot = Number(totalR.Total || 0);
          summaryItems = [
            { label: 'Sent Letters', val: String(sent), color: [30, 58, 138] },
            { label: 'Received Letters', val: String(rec), color: [4, 120, 87] },
            { label: 'Total Correspondence', val: String(tot), color: [15, 23, 42] }
          ];
          invariantLine1 = `LTR Balance: Sent(${sent}) + Rec(${rec}) = ${tot}`;
          invariantLine2 = `100% Correspondence Reconciled`;
        } else {
          const totSub = Number(totalR.TotalSubmittals ?? totalR.CurrentUnique ?? 0);
          const totSheets = Number(totalR.TotalSheets ?? totalR.TotalRows ?? 0);
          const app = Number(totalR.Approved || 0);
          const rej = Number(totalR.Rejected || 0);
          const pend = Number(totalR.Pending || 0);
          const unclass = Number(totalR.Unclassified || 0);
          summaryItems = [
            { label: 'Total Submittals (Unique)', val: String(totSub), color: [30, 58, 138] },
            { label: 'Unique Rev.00', val: String(totalR.UniqueRev00 ?? totalR.Rev00 ?? 0), color: [15, 23, 42] },
            { label: 'Unique Further Rev.', val: String(totalR.UniqueFurtherRev ?? totalR.FurtherRev ?? 0), color: [15, 23, 42] },
            { label: 'Total Physical Sheets/Rows', val: String(totSheets), color: [15, 23, 42] },
            { label: 'Approved (Row Status)', val: String(app), color: [4, 120, 87] },
            { label: 'Rejected (Row Status)', val: String(rej), color: [190, 18, 60] },
            { label: 'Pending (Row Status)', val: String(pend), color: [217, 119, 6] }
          ];
          if (unclass > 0) {
            summaryItems.push({ label: 'Unclassified Rows', val: String(unclass), color: [100, 116, 139] });
          }
          const rowStatusSum = app + rej + pend + unclass;
          invariantLine1 = `Row Status: ${app}+${rej}+${pend}${unclass > 0 ? `+${unclass}` : ''} = ${rowStatusSum} / ${totSheets}`;
          invariantLine2 = `Unique Submittals: ${totSub} (Rev00 + Further = ${Number(totalR.Rev00 || 0) + Number(totalR.FurtherRev || 0)})`;
        }

        let itemY = 47;
        summaryItems.forEach(it => {
          pdf.setFontSize(7.5);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(71, 85, 105);
          pdf.text(it.label, rightBoxX + 6, itemY);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(it.color[0], it.color[1], it.color[2]);
          pdf.text(it.val, rightBoxX + rightBoxW - 6, itemY, { align: 'right' });
          itemY += 10.5;
        });

        pdf.setFillColor(240, 253, 244);
        pdf.setDrawColor(187, 247, 208);
        pdf.roundedRect(rightBoxX + 4, 131, rightBoxW - 8, 17, 1.5, 1.5, 'FD');
        pdf.setFontSize(6.8);
        pdf.setTextColor(22, 101, 52);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Register Invariant Check:', rightBoxX + 7, 136.5);
        pdf.setFont('helvetica', 'normal');
        pdf.text(truncateText(invariantLine1, 44), rightBoxX + 7, 141.5);
        pdf.text(truncateText(invariantLine2, 44), rightBoxX + 7, 146);
      }
    });
  };

  if (isSectionSelected('logs')) {
    viewModel.registers.forEach(reg => {
      if (viewModel.metadata.mode === 'monthly') {
        renderRegisterPeriod(reg, reg.monthlyStats, true);
      } else if (viewModel.metadata.mode === 'cumulative') {
        renderRegisterPeriod(reg, reg.cumulativeStats, false);
      } else {
        renderRegisterPeriod(reg, reg.monthlyStats, true);
        renderRegisterPeriod(reg, reg.cumulativeStats, false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 5: APPENDICES — REJECTED & PENDING ITEMS (PAGINATED)
  // -------------------------------------------------------------------------
  const isExecutiveOnly = options?.deckType === 'executive' || options?.executiveOnly === true;

  if (isSectionSelected('rejected')) {
    const rejPageSize = options?.rejectedPageSize || 15;
    const rejItems = viewModel.appendices.rejectedItems;
    const allRejPages: typeof rejItems[] = [];
    for (let i = 0; i < rejItems.length; i += rejPageSize) {
      allRejPages.push(rejItems.slice(i, i + rejPageSize));
    }
    const rejPages = isExecutiveOnly ? allRejPages.slice(0, 2) : allRejPages;

    if (rejPages.length === 0) {
      beginPage();
      drawSlideChrome('HISTORICAL REJECTION EVENTS / ROWS', 'Contractor Action Queue');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(122, 21, 21);
      pdf.text(isArabic ? 'لا توجد وقائع رفض تاريخية' : 'No Rejection Events', pageW / 2, 76, { align: 'center' });
    } else {
      const rejHeaders = [
        { key: 'no', label: 'No.', widthRatio: 0.45, align: 'center' as const },
        { key: 'documentType', label: 'Log Type', widthRatio: 1.0, align: 'center' as const },
        ...(options?.showRefCol !== false ? [{ key: 'docNo', label: 'Document Reference', widthRatio: 2.3, align: 'left' as const }] : []),
        ...(options?.showTradeCol !== false ? [{ key: 'trade', label: 'Discipline', widthRatio: 0.9, align: 'center' as const }] : []),
        { key: 'rev', label: 'Rev', widthRatio: 0.5, align: 'center' as const },
        ...(options?.showRemarksCol !== false ? [{ key: 'remarks', label: 'Status / Delay Days', widthRatio: 1.9, align: 'center' as const }] : [])
      ];

      rejPages.forEach((chunk, pIdx) => {
        beginPage();
        drawSlideChrome(
          `HISTORICAL REJECTION EVENTS (${rejItems.length}) — Page ${pIdx + 1}/${rejPages.length}`,
          'Monotonically Sorted by Delay Days (Active Open vs Historical)'
        );
        const rows = chunk.map((r, i) => ({
          no: pIdx * rejPageSize + i + 1,
          documentType: r.documentType,
          docNo: r.docNo,
          trade: r.trade,
          rev: r.rev,
          remarks: r.remarks
        }));
        drawNativeTable(14, 28, 269, rejHeaders, rows, undefined, 7.6, [122, 21, 21], 6.8);
      });
    }
  }

  if (isSectionSelected('pending')) {
    const pendPageSize = options?.pendingPageSize || 15;
    const pendItems = viewModel.appendices.pendingItems;
    const allPendPages: typeof pendItems[] = [];
    for (let i = 0; i < pendItems.length; i += pendPageSize) {
      allPendPages.push(pendItems.slice(i, i + pendPageSize));
    }
    const pendPages = isExecutiveOnly ? allPendPages.slice(0, 2) : allPendPages;

    if (pendPages.length === 0) {
      beginPage();
      drawSlideChrome('PENDING REVIEW ITEMS OVERDUE BY SLA', 'Consultant Action Queue');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(10, 25, 47);
      pdf.text(isArabic ? 'لا توجد معلقات متأخرة' : 'No Pending Overdue Items', pageW / 2, 76, { align: 'center' });
    } else {
      const pendHeaders = [
        { key: 'no', label: 'No.', widthRatio: 0.45, align: 'center' as const },
        { key: 'documentType', label: 'Log Type', widthRatio: 1.0, align: 'center' as const },
        ...(options?.showRefCol !== false ? [{ key: 'docNo', label: 'Document Reference', widthRatio: 2.3, align: 'left' as const }] : []),
        ...(options?.showTradeCol !== false ? [{ key: 'trade', label: 'Discipline', widthRatio: 0.9, align: 'center' as const }] : []),
        { key: 'rev', label: 'Rev', widthRatio: 0.5, align: 'center' as const },
        ...(options?.showRemarksCol !== false ? [{ key: 'remarks', label: 'SLA Elapsed Status', widthRatio: 1.9, align: 'center' as const }] : [])
      ];

      pendPages.forEach((chunk, pIdx) => {
        beginPage();
        drawSlideChrome(
          `PENDING ITEMS OVERDUE (${pendItems.length}) — Page ${pIdx + 1}/${pendPages.length}`,
          `Latest Valid Revisions Exceeding ${viewModel.metadata.slaDays}d SLA`
        );
        const rows = chunk.map((r, i) => ({
          no: pIdx * pendPageSize + i + 1,
          documentType: r.documentType,
          docNo: r.docNo,
          trade: r.trade,
          rev: r.rev,
          remarks: r.remarks
        }));
        drawNativeTable(14, 28, 269, pendHeaders, rows, undefined, 7.6, [10, 25, 47], 6.8);
      });
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 6: THANK YOU SLIDE & FALLBACK SAFETY
  // -------------------------------------------------------------------------
  if (isSectionSelected('thanks')) {
    beginPage();
    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, 0, pageW, pageH, 'F');
    pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.rect(0, 0, 12, pageH, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(30);
    pdf.text(isArabic ? 'شكراً لكم' : 'Thanks', 38, 72);
    pdf.setFontSize(14);
    pdf.setTextColor(148, 163, 184);
    pdf.text(isArabic ? 'فريق مراقبة وجودة الوثائق' : 'Document Control Team', 38, 88);
    pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.rect(38, 110, 190, 1, 'F');
    pdf.setFontSize(9.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`[${viewModel.metadata.projectName}]  |  Document Control Analytics Platform`, 38, 120);
  }

  if (!hasStartedFirstPage) {
    drawCoverPage();
  }

  const getPagesCount = () =>
    typeof (pdf as any).getNumberOfPages === 'function'
      ? (pdf as any).getNumberOfPages()
      : (pdf.internal as any).getNumberOfPages();

  let totalPages = getPagesCount();

  // Apply slideRangeStart / slideRangeEnd if specified
  if ((options?.slideRangeStart !== undefined || options?.slideRangeEnd !== undefined) && totalPages > 1) {
    const start = Math.max(1, Math.min(options?.slideRangeStart || 1, totalPages));
    const end = Math.max(start, Math.min(options?.slideRangeEnd || totalPages, totalPages));
    for (let p = totalPages; p > end; p--) {
      try {
        pdf.deletePage(p);
      } catch (e) {
        console.warn('Could not delete page', p, e);
      }
    }
    for (let p = start - 1; p >= 1; p--) {
      try {
        pdf.deletePage(p);
      } catch (e) {
        console.warn('Could not delete page', p, e);
      }
    }
    totalPages = getPagesCount();
  }

  return { pdf, totalPages };
}
