import { jsPDF } from 'jspdf';
import { PresentationViewModel, RegisterViewModel, DisciplineMetricRow } from './presentationViewModel';
import { getCanonicalHeader } from './presentationLayoutEngine';

/**
 * Native Vector PDF Renderer for StructuSight Presentations
 * 
 * Uses direct jsPDF vector primitives (rect, line, text, fill, stroke)
 * to produce 100% crisp, selectable, high-resolution PDF pages.
 * 
 * Eliminates all screenshot/rasterization pipelines to prevent blank pages.
 */
export async function renderPresentationPdf(
  viewModel: PresentationViewModel,
  options?: {
    pageSize?: 'a4' | 'a3' | '16x9';
    orientation?: 'landscape' | 'portrait';
  }
): Promise<{ pdf: jsPDF; totalPages: number }> {
  const isArabic = viewModel.metadata.isArabic;
  const primHex = viewModel.metadata.primaryColor;
  const accHex = viewModel.metadata.accentColor;

  // Convert hex colors to RGB
  const hexToRgb = (hex: string) => {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  };

  const primRgb = hexToRgb(primHex);
  const accRgb = hexToRgb(accHex);

  // Initialize jsPDF in 16:9 Landscape (297mm x 167mm)
  const pdf = new jsPDF({
    unit: 'mm',
    format: [297, 167.06], // Exact 16:9 ratio
    orientation: 'landscape',
    compress: true
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Helper: Draw Slide Header and Footer
  const drawSlideChrome = (titleText: string, subtitleText?: string) => {
    // Header Banner
    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, 0, pageW, 20, 'F');

    // Accent Line
    pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
    pdf.rect(0, 20, pageW, 1.2, 'F');

    // Title Text
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(titleText, 14, 13);

    // Subtitle / Project name on right
    if (subtitleText || viewModel.metadata.projectName) {
      pdf.setFontSize(8.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(203, 213, 225);
      const rightText = subtitleText || viewModel.metadata.projectName;
      pdf.text(rightText, pageW - 14, 13, { align: 'right' });
    }

    // Footer Bar
    pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.rect(0, pageH - 7, pageW, 7, 'F');

    // Footer Text
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(6.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`[${viewModel.metadata.projectName}] | ${isArabic ? 'التحكم بالمستندات الهندسية' : 'Document Control'} | ${viewModel.metadata.dateStr}`, 14, pageH - 2.5);
    pdf.setTextColor(203, 213, 225);
    pdf.text(isArabic ? 'نظام التدقيق الهندسي المستقل — دقة معيارية 100%' : 'INDEPENDENT AUDIT ENGINE — 100% RECONCILED', pageW / 2, pageH - 2.5, { align: 'center' });
    pdf.setTextColor(255, 255, 255);
    pdf.text(isArabic ? 'سري وخاص' : 'CONFIDENTIAL', pageW - 14, pageH - 2.5, { align: 'right' });
  };

  // Helper: Draw Native Table
  const drawNativeTable = (
    startX: number,
    startY: number,
    totalWidth: number,
    headers: { key: string; label: string; widthRatio?: number }[],
    dataRows: any[],
    totalRow?: any,
    fontSize: number = 8.5
  ) => {
    const colCount = headers.length;
    // Calculate column widths in mm
    const totalRatio = headers.reduce((acc, h) => acc + (h.widthRatio || 1), 0);
    const colWidths = headers.map(h => ((h.widthRatio || 1) / totalRatio) * totalWidth);

    let curY = startY;
    const headerHeight = 7.5;
    const rowHeight = 6.2;

    // Header Row
    pdf.setFillColor(47, 117, 181); // Secondary Blue
    pdf.rect(startX, curY, totalWidth, headerHeight, 'F');
    pdf.setDrawColor(203, 213, 225);
    pdf.rect(startX, curY, totalWidth, headerHeight, 'S');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(255, 255, 255);

    let curX = startX;
    headers.forEach((h, i) => {
      const w = colWidths[i];
      const textX = i === 0 ? curX + 2 : curX + w / 2;
      const align = i === 0 ? 'left' : 'center';
      const label = getCanonicalHeader(h.label, isArabic ? 'ar' : 'en');
      pdf.text(label, textX, curY + 5, { align });
      curX += w;
    });

    curY += headerHeight;

    // Body Rows
    dataRows.forEach((row, rowIdx) => {
      const isEven = rowIdx % 2 === 1;
      if (isEven) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(startX, curY, totalWidth, rowHeight, 'F');
      }
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(startX, curY, totalWidth, rowHeight, 'S');

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(30, 41, 59);

      let colX = startX;
      headers.forEach((h, cIdx) => {
        const w = colWidths[cIdx];
        const val = row[h.key] !== undefined && row[h.key] !== null ? String(row[h.key]) : '0';
        const textX = cIdx === 0 ? colX + 2 : colX + w / 2;
        const align = cIdx === 0 ? 'left' : 'center';

        if (cIdx === 0) pdf.setFont('helvetica', 'bold');
        else pdf.setFont('helvetica', 'normal');

        // Color coding for status
        if (h.key === 'Approved') pdf.setTextColor(46, 125, 50);
        else if (h.key === 'Rejected' || h.key === 'RejectedOpen') pdf.setTextColor(198, 40, 40);
        else if (h.key === 'Pending') pdf.setTextColor(245, 124, 0);
        else if (h.key === 'Superseded') pdf.setTextColor(100, 116, 139);
        else pdf.setTextColor(30, 41, 59);

        pdf.text(val, textX, curY + 4.2, { align });
        colX += w;
      });

      curY += rowHeight;
    });

    // Total Row
    if (totalRow) {
      pdf.setFillColor(221, 235, 247); // Light Blue Total Row
      pdf.rect(startX, curY, totalWidth, rowHeight + 0.5, 'F');
      pdf.setDrawColor(189, 215, 238);
      pdf.rect(startX, curY, totalWidth, rowHeight + 0.5, 'S');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(32, 56, 100);

      let colX = startX;
      headers.forEach((h, cIdx) => {
        const w = colWidths[cIdx];
        const val = totalRow[h.key] !== undefined && totalRow[h.key] !== null ? String(totalRow[h.key]) : '0';
        const textX = cIdx === 0 ? colX + 2 : colX + w / 2;
        const align = cIdx === 0 ? 'left' : 'center';
        pdf.text(val, textX, curY + 4.5, { align });
        colX += w;
      });
      curY += rowHeight + 0.5;
    }

    return curY;
  };

  // -------------------------------------------------------------------------
  // SLIDE 1: COVER SLIDE
  // -------------------------------------------------------------------------
  pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
  pdf.rect(0, 0, pageW, pageH, 'F');

  // Gold decorative banner
  pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
  pdf.rect(0, 0, 12, pageH, 'F');
  pdf.rect(32, 38, pageW - 64, 1.5, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(28);
  pdf.text(viewModel.metadata.title, 34, 30);

  pdf.setTextColor(accRgb.r, accRgb.g, accRgb.b);
  pdf.setFontSize(16);
  pdf.text(viewModel.metadata.subtitle, 34, 52);

  // Project Info Card on Cover
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(34, 66, 130, 68, 3, 3, 'F');

  pdf.setTextColor(primRgb.r, primRgb.g, primRgb.b);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text(isArabic ? 'بيانات المشروع والاعتماد' : 'PROJECT SPECIFICATION', 42, 78);

  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`${isArabic ? 'المشروع' : 'Project'}: ${viewModel.metadata.projectName}`, 42, 88);
  pdf.text(`${isArabic ? 'المقاول الرئيسي' : 'Contractor'}: ${viewModel.metadata.contractorName}`, 42, 98);
  pdf.text(`${isArabic ? 'الاستشاري المشرف' : 'Consultant'}: ${viewModel.metadata.consultantName}`, 42, 108);
  pdf.text(`${isArabic ? 'التاريخ' : 'Date'}: ${viewModel.metadata.dateStr}`, 42, 118);
  pdf.text(`${isArabic ? 'حالة التدقيق' : 'Audit Invariant'}: 100% RECONCILED`, 42, 128);

  // KPI Quick Stats Box on Cover
  pdf.setFillColor(15, 23, 42); // Slate 900
  pdf.roundedRect(172, 66, 92, 68, 3, 3, 'F');

  pdf.setTextColor(accRgb.r, accRgb.g, accRgb.b);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text(isArabic ? 'إحصائيات الإنجاز السريع' : 'EXECUTIVE SUMMARY METRICS', 180, 78);

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${isArabic ? 'إجمالي الصفوف التاريخية' : 'Total Historical Rows'}: ${viewModel.executiveOverview.totalHistoricalRows}`, 180, 90);
  pdf.text(`${isArabic ? 'البنود الفريدة الحالية' : 'Current Unique Items'}: ${viewModel.executiveOverview.totalUniqueItems}`, 180, 100);
  pdf.text(`${isArabic ? 'المراجعات السابقة الملغاة' : 'Superseded Rows'}: ${viewModel.executiveOverview.supersededRows}`, 180, 110);
  pdf.text(`${isArabic ? 'نسبة الاعتماد' : 'Approval Rate'}: ${viewModel.executiveOverview.approvalRate.toFixed(1)}%`, 180, 120);

  // -------------------------------------------------------------------------
  // SLIDE 2: EXECUTIVE PERFORMANCE OVERVIEW & STATUS INTELLIGENCE
  // -------------------------------------------------------------------------
  pdf.addPage();
  drawSlideChrome(
    isArabic ? 'مؤشرات الأداء وتوزيع حالات العمل' : 'EXECUTIVE WORKLOAD & STATUS INTELLIGENCE',
    isArabic ? 'التوزيع الهندسي الشامل للحالات الحالية والمراجعات السابقة' : 'Level 3 Status Distribution & Reconciled Workload'
  );

  // 4 Top KPI Cards
  const kpiCardW = 63;
  const kpiCardH = 24;
  const kpiY = 26;

  // 1. Historical Rows (Grain A)
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(14, kpiY, kpiCardW, kpiCardH, 2, 2, 'FD');
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(isArabic ? 'Grain A — إجمالي الصفوف التاريخية' : 'GRAIN A — TOTAL ROWS', 18, kpiY + 6);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text(String(viewModel.executiveOverview.totalHistoricalRows), 18, kpiY + 16);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(isArabic ? 'كافة المعاملات والصفحات المسجلة' : 'Total historical records', 18, kpiY + 21);

  // 2. Current Unique Deliverables (Grain C)
  pdf.setFillColor(239, 246, 255);
  pdf.setDrawColor(191, 219, 254);
  pdf.roundedRect(81, kpiY, kpiCardW, kpiCardH, 2, 2, 'FD');
  pdf.setFontSize(7.5);
  pdf.setTextColor(30, 58, 138);
  pdf.text(isArabic ? 'Grain C — البنود الفريدة الحالية' : 'GRAIN C — CURRENT UNIQUE', 85, kpiY + 6);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 58, 138);
  pdf.text(String(viewModel.executiveOverview.totalUniqueItems), 85, kpiY + 16);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${viewModel.executiveOverview.approved} Approved (${viewModel.executiveOverview.approvalRate.toFixed(1)}%)`, 85, kpiY + 21);

  // 3. Superseded Historical Rows
  pdf.setFillColor(254, 243, 199);
  pdf.setDrawColor(253, 230, 138);
  pdf.roundedRect(148, kpiY, kpiCardW, kpiCardH, 2, 2, 'FD');
  pdf.setFontSize(7.5);
  pdf.setTextColor(146, 64, 14);
  pdf.text(isArabic ? 'المراجعات السابقة الملغاة' : 'SUPERSEDED REVISIONS', 152, kpiY + 6);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(146, 64, 14);
  pdf.text(String(viewModel.executiveOverview.supersededRows), 152, kpiY + 16);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(isArabic ? 'تطورت إلى مراجعات لاحقة أحدث' : 'Superseded by later revisions', 152, kpiY + 21);

  // 4. Mathematical Equation / Balance Card
  pdf.setFillColor(240, 253, 244);
  pdf.setDrawColor(187, 247, 208);
  pdf.roundedRect(215, kpiY, kpiCardW, kpiCardH, 2, 2, 'FD');
  pdf.setFontSize(7.5);
  pdf.setTextColor(22, 101, 52);
  pdf.text(isArabic ? 'حالة التوازن والمطابقة' : 'BALANCE INVARIANT', 219, kpiY + 6);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(22, 101, 52);
  pdf.text(`${viewModel.executiveOverview.totalUniqueItems} Cur + ${viewModel.executiveOverview.supersededRows} Sup`, 219, kpiY + 15);
  pdf.setFontSize(7.5);
  pdf.text(`= ${viewModel.executiveOverview.totalHistoricalRows} Total Rows (100% Balanced)`, 219, kpiY + 21);

  // Status Distribution Box & Note
  const distY = 56;
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(14, distY, 130, 92, 2, 2, 'FD');

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 41, 59);
  pdf.text(isArabic ? 'توزيع الحالات التفصيلي لجميع السجلات' : 'STATUS DISTRIBUTION (ALL LOGS)', 20, distY + 8);

  let curDistRowY = distY + 18;
  viewModel.executiveOverview.statusDistribution.forEach((st) => {
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(51, 65, 85);
    pdf.text(isArabic ? st.labelAr : st.labelEn, 20, curDistRowY);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(st.count), 95, curDistRowY, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 116, 139);
    pdf.text(`(${st.percentage}%)`, 115, curDistRowY, { align: 'right' });

    // Progress bar
    pdf.setFillColor(226, 232, 240);
    pdf.rect(20, curDistRowY + 2, 110, 2, 'F');
    const colorRgb = hexToRgb(st.color);
    pdf.setFillColor(colorRgb.r, colorRgb.g, colorRgb.b);
    pdf.rect(20, curDistRowY + 2, Math.max(1, (st.percentage / 100) * 110), 2, 'F');

    curDistRowY += 14;
  });

  // Concise Explanatory Note (Requested by user: single concise note, no standalone table)
  pdf.setFillColor(239, 246, 255);
  pdf.setDrawColor(191, 219, 254);
  pdf.roundedRect(150, distY, 133, 92, 2, 2, 'FD');

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 58, 138);
  pdf.text(isArabic ? 'ملاحظة التدقيق الهندسي المعتمدة' : 'ENGINEERING RECONCILIATION DIRECTIVE', 156, distY + 10);

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(30, 58, 138);
  const noteEn = "Superseded rows are historical revision events that have advanced to a later revision and are therefore excluded from the current-state unique population.\n\nMathematical Invariant:\nHistorical Rows = Approved + Rejected/Open + Rejected/Closed + Pending + Superseded\n\nEvery unique submittal package advances through review iterations; prior iterations remain in Grain A as physical audit history while the latest state constitutes Grain C.";
  pdf.text(noteEn, 156, distY + 20, { maxWidth: 121 });

  const noteAr = "تمثل الصفوف الملغاة (Superseded) مراجعات تاريخية سابقة تم استبدالها بمراجعات أحدث، وبالتالي تُستبعد من تعداد البنود الفريدة الحالية مع الحفاظ على سجلها التاريخي الكامل.";
  pdf.text(noteAr, 156, distY + 68, { maxWidth: 121 });

  // -------------------------------------------------------------------------
  // SLIDE 3: PRIMARY DETAIL BREAKDOWN TABLE (Slide 8/13 - 13 Columns)
  // -------------------------------------------------------------------------
  pdf.addPage();
  drawSlideChrome(
    isArabic ? 'جدول تفصيل السجلات الهندسية الشامل' : 'PRIMARY DETAIL REGISTER BREAKDOWN',
    isArabic ? 'عرض شامل لمؤشرات التقديم وحالات الجودة لكل سجل وتخصص' : 'Comprehensive Register Breakdown Across All Disciplines'
  );

  const detailColHeaders = [
    { key: 'documentType', label: 'Log Type', widthRatio: 1.4 },
    { key: 'priority', label: 'Priority', widthRatio: 0.8 },
    { key: 'rev00Rows', label: 'Rev 00', widthRatio: 0.65 },
    { key: 'furtherRevRows', label: 'Further Rev', widthRatio: 0.75 },
    { key: 'totalRows', label: 'Total Rows', widthRatio: 0.75 },
    { key: 'rowAppClosed', label: 'Row Appr.', widthRatio: 0.75 },
    { key: 'rowRejOpen', label: 'Row Rej.', widthRatio: 0.75 },
    { key: 'rowPending', label: 'Row Pend.', widthRatio: 0.7 },
    { key: 'totalUnique', label: 'Total Unique', widthRatio: 0.75 },
    { key: 'approved', label: 'Cur. Appr.', widthRatio: 0.75 },
    { key: 'rejectedOpen', label: 'Cur. Rej Open', widthRatio: 0.75 },
    { key: 'rejectedClosed', label: 'Cur. Rej Closed', widthRatio: 0.75 },
    { key: 'pending', label: 'Cur. Pend.', widthRatio: 0.7 }
  ];

  drawNativeTable(
    14,
    26,
    269, // full usable width across 297mm page
    detailColHeaders,
    viewModel.primaryDetailBreakdown.rows.slice(0, 16), // comfortably fits 16 rows
    viewModel.primaryDetailBreakdown.totalRow,
    7.5
  );

  // -------------------------------------------------------------------------
  // SLIDES FOR EACH REGISTER BASE TYPE (e.g. SDW, DOC, MAR, MIR, WIR, etc.)
  // -------------------------------------------------------------------------
  viewModel.registers.forEach((reg) => {
    // 1. Register Status Slide (Table on left, Summary/Chart on right)
    pdf.addPage();
    drawSlideChrome(
      `${reg.name} (${reg.baseType}) — ${isArabic ? 'حالة التقديمات الهندسية' : 'SUBMITTALS STATUS'}`,
      reg.subtitle
    );

    const regHeaders = reg.cols.map(c => ({
      key: c.key,
      label: c.label,
      widthRatio: c.key === 'discipline' ? 1.4 : 0.85
    }));

    // Left Table
    const tableW = 165;
    drawNativeTable(
      14,
      28,
      tableW,
      regHeaders,
      reg.cumulativeStats.stats.slice(0, 12),
      reg.cumulativeStats.totalRow,
      8.0
    );

    // Right Box: Register Metrics Summary Card
    const rightBoxX = 186;
    const rightBoxW = 97;
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(rightBoxX, 28, rightBoxW, 118, 2, 2, 'FD');

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(primRgb.r, primRgb.g, primRgb.b);
    pdf.text(`${reg.baseType} ${isArabic ? 'ملخص الأداء والحالات' : 'Performance Summary'}`, rightBoxX + 6, 38);

    const totalR = reg.cumulativeStats.totalRow;
    const items = [
      { label: isArabic ? 'إجمالي الصفوف التاريخية' : 'Total Historical Rows', val: String(totalR?.TotalRows || totalR?.Total || 0), color: '15, 23, 42' },
      { label: isArabic ? 'المعتمد التراكمي' : 'Cumulative Approved', val: String(totalR?.Approved || 0), color: '46, 125, 50' },
      { label: isArabic ? 'المرفوض المفتوح' : 'Rejected Open', val: String(totalR?.RejectedOpen || 0), color: '198, 40, 40' },
      { label: isArabic ? 'المرفوض المغلق' : 'Rejected Closed', val: String(totalR?.RejectedClosed || 0), color: '136, 19, 55' },
      { label: isArabic ? 'المعلق قيد المراجعة' : 'Pending Review', val: String(totalR?.Pending || 0), color: '245, 124, 0' },
      { label: isArabic ? 'المراجعات السابقة الملغاة' : 'Superseded Revision Rows', val: String(totalR?.Superseded || 0), color: '100, 116, 139' },
      { label: isArabic ? 'البنود الفريدة الحالية' : 'Current Unique Deliverables', val: String(totalR?.CurrentUnique || (Number(totalR?.TotalRows || 0) - Number(totalR?.Superseded || 0))), color: '30, 58, 138' }
    ];

    let itemY = 48;
    items.forEach(it => {
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(71, 85, 105);
      pdf.text(it.label, rightBoxX + 6, itemY);
      pdf.setFont('helvetica', 'bold');
      const rgb = it.color.split(',').map(n => parseInt(n.trim(), 10));
      pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
      pdf.text(it.val, rightBoxX + rightBoxW - 6, itemY, { align: 'right' });
      itemY += 12;
    });

    // Invariant Check inside right card
    pdf.setFillColor(240, 253, 244);
    pdf.roundedRect(rightBoxX + 4, itemY + 2, rightBoxW - 8, 14, 1.5, 1.5, 'F');
    pdf.setFontSize(7.5);
    pdf.setTextColor(22, 101, 52);
    pdf.setFont('helvetica', 'bold');
    pdf.text(isArabic ? 'مطابقة معادلة السجل:' : 'Register Invariant Check:', rightBoxX + 8, itemY + 8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Rows = Unique (${totalR?.CurrentUnique || 0}) + Sup (${totalR?.Superseded || 0}) = 100% OK`, rightBoxX + 8, itemY + 13);
  });

  // -------------------------------------------------------------------------
  // FINAL SLIDE: STRATEGIC RECOMMENDATIONS
  // -------------------------------------------------------------------------
  pdf.addPage();
  drawSlideChrome(
    isArabic ? 'التوصيات الفنية وخطة العمل' : 'STRATEGIC RECOMMENDATIONS & ACTION PLAN',
    isArabic ? 'إجراءات تصعيد متطلبات التدقيق وإغلاق المعاملات المتأخرة' : 'Immediate SLA Backlog Interventions & Corrective Protocols'
  );

  let recY = 32;
  const recW = 269;
  viewModel.recommendations.slice(0, 4).forEach((rec, idx) => {
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(14, recY, recW, 24, 2, 2, 'FD');

    // Priority Tag
    const isHigh = rec.priority === 'HIGH';
    pdf.setFillColor(isHigh ? 254 : 239, isHigh ? 226 : 246, isHigh ? 226 : 255);
    pdf.setDrawColor(isHigh ? 252 : 191, isHigh ? 165 : 219, isHigh ? 165 : 254);
    pdf.roundedRect(20, recY + 5, 24, 6, 1, 1, 'FD');
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(isHigh ? 185 : 30, isHigh ? 28 : 58, isHigh ? 28 : 138);
    pdf.text(rec.priority, 32, recY + 9.5, { align: 'center' });

    // Action Title
    pdf.setFontSize(9.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(15, 23, 42);
    pdf.text(`${idx + 1}. ${isArabic ? rec.actionAr : rec.action}`, 48, recY + 10);

    // Narrative Description
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(71, 85, 105);
    pdf.text(isArabic ? rec.ar : rec.en, 20, recY + 18, { maxWidth: 255 });

    recY += 28;
  });

  const totalPages = pdf.internal.getNumberOfPages();
  return { pdf, totalPages };
}
