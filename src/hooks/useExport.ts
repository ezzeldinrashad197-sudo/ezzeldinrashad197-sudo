import { useState } from 'react';
import html2pdf from 'html2pdf.js';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import pptxgen from "pptxgenjs";
import { generatePptxReport } from '../analytics/exportEngine';
import { buildPresentationViewModel } from '../analytics/presentationViewModel';
import { renderPresentationPdf } from '../analytics/presentationPdfRenderer';
import { ProjectSettings, SubmittalRow } from '../types';
import { useLanguage } from '../utils/i18n';

const prepareChartsForCapture = (clonedContainer: HTMLElement, originalContainer?: HTMLElement) => {
    const doc = clonedContainer.ownerDocument || document;

    // 1. Remove Recharts tooltips, portals, legends, and outer containers from the entire cloned document
    const tooltips = doc.querySelectorAll('.recharts-tooltip-wrapper, .recharts-tooltip, .recharts-portal, .recharts-legend-wrapper, .recharts-default-tooltip');
    tooltips.forEach(tw => {
        (tw as HTMLElement).style.display = 'none';
        tw.remove();
    });

    // 2. Fully strip all non-visual SVG support structures (defs, clipPath, clippath, mask, filter, foreignObject, etc.) from the entire cloned document
    // Since isAnimationActive is set to false, all vector visual paths/rectangles are already fully scaled.
    // Pruning these non-visual elements stops html2canvas from rendering them as solid/clutter shapes.
    const nonVisualSvgs = doc.querySelectorAll('defs, clipPath, clippath, mask, filter, foreignObject, foreignobject');
    nonVisualSvgs.forEach(el => {
        el.remove();
    });

    // Strip any SVG clipping, filter, or masking attributes referencing the discarded defs across the entire cloned document
    const clippedElements = doc.querySelectorAll('[clip-path], [clipPath], [mask], [filter]');
    clippedElements.forEach(el => {
        el.removeAttribute('clip-path');
        el.removeAttribute('clipPath');
        el.removeAttribute('mask');
        el.removeAttribute('filter');
    });

    // Remove CartesianGrid backgrounds, hidden layers, or overlays that could capture poorly across the entire cloned document
    const hiddenOverlays = doc.querySelectorAll('.recharts-cartesian-grid-background, .recharts-background');
    hiddenOverlays.forEach(bg => {
        bg.remove();
    });

    const id = clonedContainer.id;
    let orig: HTMLElement | null = originalContainer || null;
    
    if (!orig && id) {
        orig = document.getElementById(id);
    }
    if (!orig) {
        orig = document.getElementById('export-container') || document.getElementById('presentation-container');
    }

    const clonedWrappers = Array.from(clonedContainer.querySelectorAll('.recharts-wrapper'));
    const originalWrappers = orig ? Array.from(orig.querySelectorAll('.recharts-wrapper')) : [];
    
    clonedWrappers.forEach((clonedWrap, idx) => {
        const originalWrap = originalWrappers[idx] as HTMLElement | undefined;
        const cEl = clonedWrap as HTMLElement;
        
        let w = 0;
        let h = 0;
        
        if (originalWrap) {
            const rect = originalWrap.getBoundingClientRect();
            w = rect.width;
            h = rect.height;
            if (w === 0) {
                w = originalWrap.offsetWidth;
            }
            if (h === 0) {
                h = originalWrap.offsetHeight;
            }
        }
        
        if (w === 0) {
            const rect = cEl.getBoundingClientRect();
            w = rect.width || cEl.offsetWidth || 600;
        }
        if (h === 0) {
            const rect = cEl.getBoundingClientRect();
            h = rect.height || cEl.offsetHeight || 350;
        }
        
        cEl.style.width = `${w}px`;
        cEl.style.height = `${h}px`;
        
        const svgs = cEl.querySelectorAll('svg');
        svgs.forEach(svg => {
            const svgEl = svg as SVGElement;
            svgEl.setAttribute('width', `${w}`);
            svgEl.setAttribute('height', `${h}`);
            svgEl.style.width = `${w}px`;
            svgEl.style.height = `${h}px`;
        });
    });

    const scrollWrappers = clonedContainer.querySelectorAll('.overflow-x-auto, .overflow-y-auto, .overflow-auto');
    scrollWrappers.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.overflow = 'visible';
        htmlEl.style.maxHeight = 'none';
        if (!htmlEl.classList.contains('h-full') && !htmlEl.classList.contains('h-screen')) {
            htmlEl.style.height = 'max-content'; 
        }
        htmlEl.style.flex = 'none';
    });

    const explicitContainers = clonedContainer.querySelectorAll('[class*="h-[600px]"], [class*="h-[500px]"], [class*="h-64"], [class*="h-80"]');
    explicitContainers.forEach(el => {
        const htmlEl = el as HTMLElement;
        if (!htmlEl.querySelector('.recharts-wrapper') && !htmlEl.className.includes('recharts')) {
            htmlEl.style.height = 'max-content';
            htmlEl.style.minHeight = 'max-content';
        }
    });
};

// Standardized High-Fidelity PDF Header/Footer Overlay Generator
const drawPdfHeaderFooter = (pdf: any, projectInfo: ProjectSettings | null, activeTab: string, startDate?: string, endDate?: string, options?: any) => {
    const totalPages = pdf.internal.getNumberOfPages();
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const dateStr = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    
    // Helper to parse hex colors
    const hexToRgb = (hex: string) => {
        const cleanHex = hex.replace('#', '');
        const num = parseInt(cleanHex, 16);
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    };

    const primaryColor = options?.primaryColor || "#0A192F";
    const accentColor = options?.accentColor || "#D4AF37";
    const primRgb = hexToRgb(primaryColor);
    const accRgb = hexToRgb(accentColor);
    const showProjectInfo = options?.showProjectInfo !== false;

    // Format reporting period cleanly
    let periodStr = "Cumulative Period";
    if (activeTab === 'monthly') {
        periodStr = "Monthly Period";
    }
    if (startDate && endDate) {
        const start = new Date(startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const end = new Date(endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        periodStr = `${start} - ${end}`;
    }

    const rawProjName = projectInfo?.projectName;
    const projName = (rawProjName && rawProjName !== 'No Project Configured' && rawProjName !== 'NO PROJECT CONFIGURED' ? rawProjName : 'StructuSight Master Project').substring(0, 35);
    const projCode = projectInfo?.projectCode || "STS-P1.17";
    const contractor = projectInfo?.contractorName || "Innovo Construction";
    const consultant = projectInfo?.consultantName || "ACE Consulting Engineers";
    const reportName = activeTab.toUpperCase() + " PERFORMANCE REPORT";

    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        
        // --- DRAW HEADER BAR ---
        // Header background (Custom Primary)
        pdf.setFillColor(primRgb.r, primRgb.g, primRgb.b);
        pdf.rect(0, 0, pdfWidth, 14, 'F');
        
        // Custom Accent bottom line
        pdf.setFillColor(accRgb.r, accRgb.g, accRgb.b);
        pdf.rect(0, 14, pdfWidth, 0.8, 'F');
        
        // Title on the left
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9);
        const headerTitle = options?.customHeader || "STRUCTUSIGHT ENTERPRISE INTELLIGENCE";
        pdf.text(headerTitle.toUpperCase(), 10, 6);
        
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(accRgb.r, accRgb.g, accRgb.b);
        pdf.text(reportName, 10, 10.5);
        
        // Metadata on the right
        if (showProjectInfo) {
            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(6.5);
            
            // Draw elegant metadata columns
            let metaX = pdfWidth - 215; // default start pos
            if (metaX < 120) metaX = 120; // safe bounds
            
            // Column 1: Project & Code
            pdf.setTextColor(148, 163, 184); // silver/slate
            pdf.text("PROJECT:", metaX, 5.5);
            pdf.text("PARCEL/CODE:", metaX, 10);
            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "bold");
            pdf.text(projName, metaX + 22, 5.5);
            pdf.text(projCode, metaX + 22, 10);
            
            // Column 2: Contractor & Consultant
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(148, 163, 184);
            pdf.text("CONTRACTOR:", metaX + 70, 5.5);
            pdf.text("CONSULTANT:", metaX + 70, 10);
            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "bold");
            pdf.text(contractor, metaX + 92, 5.5);
            pdf.text(consultant, metaX + 92, 10);

            // Column 3: Period & Generated Date
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(148, 163, 184);
            pdf.text("PERIOD:", metaX + 140, 5.5);
            pdf.text("GENERATED:", metaX + 140, 10);
            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "bold");
            pdf.text(periodStr, metaX + 158, 5.5);
            pdf.text(dateStr, metaX + 158, 10);
        }

        // --- DRAW FOOTER BAR ---
        // Top line for footer
        pdf.setDrawColor(226, 232, 240); // light slate border
        pdf.setLineWidth(0.2);
        pdf.line(10, pdfHeight - 12, pdfWidth - 10, pdfHeight - 12);
        
        // Footer texts
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139); // slate-500
        const footerText = options?.customFooter || `StructuSight Enterprise Engineering Intelligence Platform | CONCEPT & PRODUCT VISION BY EZZ RASHAD`;
        pdf.text(footerText, 10, pdfHeight - 7);
        pdf.text(`Page ${i} of ${totalPages}`, pdfWidth - 30, pdfHeight - 7);
    }
};

interface UseExportProps {
    data: SubmittalRow[];
    activeTab: string;
    filterMonthly: (row: SubmittalRow) => boolean;
    filterCumulative: (row: SubmittalRow) => boolean;
    activeProject: ProjectSettings | null;
    setParseMessage: (msg: string) => void;
    setIsError: (err: boolean) => void;
    startDate?: string;
    endDate?: string;
}

export function useExport({ data, activeTab, filterMonthly, filterCumulative, activeProject, setParseMessage, setIsError, startDate, endDate }: UseExportProps) {
    const [isExporting, setIsExporting] = useState(false);
    const { language } = useLanguage();

    const handleDownloadPPTX = async (options?: any) => {
        setIsExporting(true);
        console.log("[Export Diagnostics] Starting PPTX export with options:", options);
        const startTime = Date.now();
        
        try {
            await new Promise(r => setTimeout(r, 100));
            const isArabic = (language === 'ar') && !!options?.arabicEnabled;
            const mergedOptions = { monthlyStart: startDate, ...options, arabicEnabled: isArabic };

            if (activeTab === 'presentation') {
                // Programmatic, native slide-by-slide generator for presentation mode
                // This builds native tables, text blocks, and vector shapes that are 100% editable
                await generatePptxReport(data, activeProject, 'presentation', { filterMonthly, filterCumulative }, mergedOptions);
            } else {
                // Standard flow for other tabs using programmatic report generator
                const filteredData = data.filter(activeTab === 'monthly' ? filterMonthly : filterCumulative);
                await generatePptxReport(filteredData, activeProject, activeTab === 'monthly' ? 'monthly' : 'cumulative', undefined, mergedOptions);
            }

            const exportDuration = Date.now() - startTime;
            console.log(`[Export Diagnostics] PPTX Programmatic Native Export successful! Duration: ${exportDuration}ms`);
            
        } catch (e: unknown) {
            console.error(e);
            if (e instanceof Error) {
                setParseMessage(`Error exporting PPTX: ${e.message}`);
            } else {
                setParseMessage(`Error exporting PPTX`);
            }
            setIsError(true);
        } finally {
            setIsExporting(false);
        }
    };

    const handleDownloadPDF = async (options?: any) => {
        setIsExporting(true);
        console.log("[Export Diagnostics] Starting PDF export with options:", options);
        const startTime = Date.now();

        try {
            await new Promise(r => setTimeout(r, 100));

            const isLandscape = ['monthly', 'cumulative', 'register', 'delay', 'presentation', 'ncr', 'sor', 'rfi', 'ltr'].includes(activeTab);
            const elementId = activeTab === 'presentation' ? 'presentation-container' : 'export-container';
            const element = document.getElementById(elementId);

            if (!element) {
                console.error(`Export container #${elementId} not found`);
                setParseMessage(`Error: Could not find report container ${elementId} to export.`);
                setIsError(true);
                setIsExporting(false);
                return;
            }

            if (activeTab !== 'presentation') {
                document.body.classList.add('pdf-export');
                const headersFooters = element.querySelectorAll('.pdf-only-header, .pdf-only-footer');
                headersFooters.forEach(el => {
                    (el as HTMLElement).classList.remove('hidden');
                    (el as HTMLElement).classList.add('flex');
                });
            }

            const htmlFinalEl = element as HTMLElement;
            const originalWidth = htmlFinalEl.style.width;
            const originalPadding = htmlFinalEl.style.padding;
            const originalMaxWidth = htmlFinalEl.style.maxWidth;

            htmlFinalEl.style.width = '1500px';
            htmlFinalEl.style.maxWidth = '1500px';
            htmlFinalEl.style.padding = activeTab === 'presentation' ? '0' : '20px';

            await new Promise(r => setTimeout(r, 2500));
            
            const exportElement = document.getElementById(elementId);
            if (!exportElement) {
                throw new Error(`Element #${elementId} was unmounted during export wait.`);
            }

            const filename = `StructuSight-${activeTab}-${new Date().toISOString().split('T')[0]}.pdf`;

            if (activeTab === 'presentation') {
                const isArabic = !!options?.arabicEnabled;
                const viewModel = buildPresentationViewModel(data, activeProject, 'presentation', {
                    ...options,
                    arabicEnabled: isArabic,
                    startDate,
                    endDate,
                    primaryColor: options?.primaryColor || (activeProject as any)?.primaryColor || '#203864',
                    accentColor: options?.accentColor || (activeProject as any)?.accentColor || '#D4AF37'
                });

                const { pdf, totalPages } = await renderPresentationPdf(viewModel, {
                    pageSize: options?.pageSize?.toLowerCase() || '16x9',
                    orientation: options?.orientation?.toLowerCase() || 'landscape',
                    selectedSections: options?.selectedSections,
                    slideRangeStart: options?.slideRangeStart,
                    slideRangeEnd: options?.slideRangeEnd
                });

                pdf.save(filename);
                const exportDuration = Date.now() - startTime;
                console.log(`[Export Diagnostics] Native Vector Presentation PDF Export successful (${totalPages} pages)! Duration: ${exportDuration}ms`);

            } else {
                // Standard html2pdf for other reports
                let exportScale = 2;
                if (exportElement.scrollHeight > 15000) {
                    exportScale = 1; 
                }

                const exportWidth = 1500;

                // --- EXPORT VALIDATION LAYER INITIALIZATION ---
                const totalRenderedCharts = exportElement.querySelectorAll('.recharts-wrapper').length;
                const totalRenderedSVGs = exportElement.querySelectorAll('.recharts-wrapper svg').length;
                let totalCapturedCharts = 0;
                let totalCapturedSVGs = 0;

                if (totalRenderedCharts !== totalRenderedSVGs) {
                    console.warn("[Export Validation Warn] Standard report charts & SVG mismatch:", totalRenderedCharts, "vs", totalRenderedSVGs);
                }

                const opt = {
                    margin:       [15, 10, 15, 10] as [number, number, number, number],
                    filename,
                    image:        { type: 'jpeg' as const, quality: 1 },
                    html2canvas:  { 
                        scale: exportScale, 
                        useCORS: true, 
                        scrollY: 0, 
                        scrollX: 0, 
                        windowWidth: exportWidth,
                        onclone: (doc: Document) => {
                            // Inject style block to disable translations & animations
                            const style = doc.createElement('style');
                            style.innerHTML = `
                                * {
                                    transition-property: none !important;
                                    animation: none !important;
                                    transition: none !important;
                                }
                            `;
                            doc.head.appendChild(style);

                            // Clean absolute-positioned Recharts portals in the body root
                            doc.body.querySelectorAll('.recharts-portal, .recharts-tooltip-wrapper, .recharts-legend-wrapper, .recharts-default-tooltip').forEach(p => {
                                p.remove();
                            });
                            
                            const cloneEl = doc.getElementById(elementId);
                            if (cloneEl) {
                                prepareChartsForCapture(cloneEl);
                                
                                totalCapturedCharts = cloneEl.querySelectorAll('.recharts-wrapper').length;
                                totalCapturedSVGs = cloneEl.querySelectorAll('.recharts-wrapper svg').length;
                                
                                if (totalRenderedCharts !== totalCapturedCharts || totalRenderedSVGs !== totalCapturedSVGs) {
                                    console.warn("[Export Validation Warn] Standard final count mismatch. Charts:", totalRenderedCharts, "captured:", totalCapturedCharts, "; SVGs:", totalRenderedSVGs, "captured:", totalCapturedSVGs);
                                }
                            }
                        }
                    },
                    jsPDF:        { unit: 'mm', format: options?.pageSize?.toLowerCase() || 'a3', orientation: options?.orientation?.toLowerCase() || (isLandscape ? 'landscape' : 'portrait') },
                    pagebreak:    { mode: ['css', 'legacy'], avoid: ['tr', '.page-break-inside-avoid', '.chart-card', '.kpi-card', '#report-charts-grid', '#report-bottleneck-spotlight', '#report-executive-summary', '#report-kpi-grid', '.recharts-wrapper'], after: ['.page-break-after-always', '.presentation-slide'], before: ['.page-break-before-always', '#report-recommendations-panel'] }
                };

                await (html2pdf().set(opt).from(exportElement).toPdf().get('pdf').then((pdf: any) => {
                    // Apply Custom Page Range filter first if options provided
                    let totalPages = pdf.internal.getNumberOfPages();
                    if (options?.slideRangeStart !== undefined && options?.slideRangeEnd !== undefined && totalPages > 1) {
                        const start = Math.max(1, Math.min(options.slideRangeStart, totalPages));
                        const end = Math.max(start, Math.min(options.slideRangeEnd, totalPages));

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
                    }

                    // Draw clean headers and footers with local pagination: Page 1 of N, Page 2 of N, etc.
                    drawPdfHeaderFooter(pdf, activeProject, activeTab, startDate, endDate, options);
                }) as any).save();
            }

            // Restore dimensions immediately after imaging
            htmlFinalEl.style.width = originalWidth;
            htmlFinalEl.style.maxWidth = originalMaxWidth;
            htmlFinalEl.style.padding = originalPadding;
            
        } catch (error: unknown) {
            document.body.classList.remove('pdf-export');
            console.error('Error generating PDF', error);
            if (error instanceof Error && error.message === "PDF Export Validation Failed") {
                setParseMessage("PDF Export Validation Failed");
            } else if (error instanceof Error) {
                setParseMessage(`Error exporting PDF: ${error.message}`);
            } else {
                setParseMessage(`Error exporting PDF: ${String(error)}`);
            }
            setIsError(true);
        } finally {
            document.body.classList.remove('pdf-export');
            
            const element = document.getElementById(activeTab === 'presentation' ? 'presentation-container' : 'export-container');
            if (element && activeTab !== 'presentation') {
                const headersFooters = element.querySelectorAll('.pdf-only-header, .pdf-only-footer');
                headersFooters.forEach(el => {
                    (el as HTMLElement).classList.add('hidden');
                    (el as HTMLElement).classList.remove('flex');
                });
            }
            
            setIsExporting(false);
        }
    };

    return { isExporting, setIsExporting, handleDownloadPPTX, handleDownloadPDF };
}
