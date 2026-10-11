import React, { useState, useRef, useMemo } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Search,
  Layers,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  RefreshCw,
  Table,
  ShieldCheck,
  Eye
} from 'lucide-react';
import { SubmittalRow, ProjectSettings } from '../types';
import { useLanguage } from '../utils/i18n';
import {
  EI_LOG_CANONICAL_COLUMNS,
  EIConflictResolutionMode,
  EILogGenerationResult,
  EIReferenceReconciliationReport,
  generateEILogFromExcelBuffer,
  generateEILogFromSubmittalRows,
  parseReferenceEILogBuffer,
  compareWithReferenceEILog,
  downloadEILogExcel,
  buildBenchmarkCumulativeSDWWorkbook
} from '../analytics/ei/eiLogEngine';

interface EILogGeneratorProps {
  data?: SubmittalRow[];
  projectInfo?: ProjectSettings | null;
}

export const EILogGenerator: React.FC<EILogGeneratorProps> = ({ data = [] }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);

  const [rawWorkbookBuffer, setRawWorkbookBuffer] = useState<ArrayBuffer | Uint8Array | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [resolutionMode, setResolutionMode] = useState<EIConflictResolutionMode>('GOVERNING_EI_RULE');
  const [isLogGenerated, setIsLogGenerated] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<
    'sheets_preview' | 'conflicts_validation' | 'ei_log_table' | 'reference_parity'
  >('sheets_preview');

  const [customRefData, setCustomRefData] = useState<{
    referenceName: string;
    records: ReturnType<typeof parseReferenceEILogBuffer>['records'];
    inspectedFormulas: ReturnType<typeof parseReferenceEILogBuffer>['inspectedFormulas'];
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('ALL');
  const [conflictFilter, setConflictFilter] = useState<'ALL' | 'CONFLICT_ONLY' | 'CLEAN_ONLY'>('ALL');
  const [issueSeverityFilter, setIssueSeverityFilter] = useState<'ALL' | 'ERROR' | 'CONFLICT' | 'WARNING'>('ALL');
  const [expandedSubRef, setExpandedSubRef] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Compute current EI Log result from uploaded raw workbook OR from platform data
  const generationResult: EILogGenerationResult | null = useMemo(() => {
    try {
      if (rawWorkbookBuffer) {
        return generateEILogFromExcelBuffer(rawWorkbookBuffer, uploadedFileName || 'Uploaded_SDW_Register.xlsx', {
          resolutionMode,
          selectedSheetNames: selectedSheets.length > 0 ? selectedSheets : undefined
        });
      }
      if (data && data.length > 0) {
        return generateEILogFromSubmittalRows(data, 'Active Platform Register Dataset', resolutionMode);
      }
      return null;
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to parse workbook');
      return null;
    }
  }, [rawWorkbookBuffer, uploadedFileName, resolutionMode, selectedSheets, data]);

  // Active Reference Reconciliation Report (either from uploaded external Reference file or auto-detected EI sheet)
  const activeReferenceReport: EIReferenceReconciliationReport | undefined = useMemo(() => {
    if (!generationResult) return undefined;
    if (customRefData && customRefData.records.length > 0) {
      return compareWithReferenceEILog(
        generationResult.records,
        customRefData.records,
        customRefData.referenceName,
        customRefData.inspectedFormulas
      );
    }
    return generationResult.autoDetectedReferenceReport;
  }, [generationResult, customRefData]);

  // Handle Main Cumulative Shop Drawing Register Excel Upload
  const handleWorkbookUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const initialPreview = generateEILogFromExcelBuffer(buf, file.name, { resolutionMode });
      const defaultSelected = initialPreview.discoveredSheets
        .filter(s => s.sheetRole === 'DISCIPLINE_REGISTER' && s.isSelectedByDefault)
        .map(s => s.sheetName);

      setRawWorkbookBuffer(buf);
      setUploadedFileName(file.name);
      setSelectedSheets(defaultSelected);
      setIsLogGenerated(false);
      setActiveSection('sheets_preview');
    } catch (err: any) {
      setUploadError(err?.message || 'Error reading Excel workbook');
    }
  };

  // Handle External Reference EI Log Upload
  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const parsedRef = parseReferenceEILogBuffer(buf, file.name);
      if (parsedRef.records.length === 0) {
        setUploadError(
          isAr
            ? 'لم يتم العثور على أعمدة EI Log صالحة في الملف المرجعي المرفوع.'
            : 'No valid EI Log columns found in the uploaded reference workbook.'
        );
        return;
      }
      setCustomRefData(parsedRef);
      setActiveSection('reference_parity');
    } catch (err: any) {
      setUploadError(err?.message || 'Error reading Reference EI Log file');
    }
  };

  // Load Certified Multi-Discipline Benchmark Workbook (with Reference EI Sheet & Edge Cases)
  const handleLoadBenchmarkWorkbook = (withConflicts: boolean) => {
    setUploadError(null);
    const { buffer } = buildBenchmarkCumulativeSDWWorkbook(withConflicts);
    const fName = withConflicts
      ? 'Cumulative_SDW_Register_With_Conflicts_Audit.xlsx'
      : 'Cumulative_SDW_Register_Certified_Benchmark.xlsx';
    const initialPreview = generateEILogFromExcelBuffer(buffer, fName, { resolutionMode });
    const defaultSelected = initialPreview.discoveredSheets
      .filter(s => s.sheetRole === 'DISCIPLINE_REGISTER' && s.isSelectedByDefault)
      .map(s => s.sheetName);

    setRawWorkbookBuffer(buffer);
    setUploadedFileName(fName);
    setSelectedSheets(defaultSelected);
    setCustomRefData(null);
    setIsLogGenerated(true);
    setActiveSection('ei_log_table');
  };

  const toggleSheetSelection = (sheetName: string) => {
    setSelectedSheets(prev =>
      prev.includes(sheetName) ? prev.filter(s => s !== sheetName) : [...prev, sheetName]
    );
  };

  const filteredRecords = useMemo(() => {
    if (!generationResult) return [];
    return generationResult.records.filter(rec => {
      if (disciplineFilter !== 'ALL' && rec.discipline !== disciplineFilter) {
        return false;
      }
      if (conflictFilter === 'CONFLICT_ONLY' && !rec.hasConflict) {
        return false;
      }
      if (conflictFilter === 'CLEAN_ONLY' && rec.hasConflict) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchSub = rec.subRef.toLowerCase().includes(q);
        const matchDisc = rec.discipline.toLowerCase().includes(q);
        const matchDwg = rec.rev00DistinctDrawings.some(d => d.toLowerCase().includes(q));
        return matchSub || matchDisc || matchDwg;
      }
      return true;
    });
  }, [generationResult, disciplineFilter, conflictFilter, searchQuery]);

  const filteredIssues = useMemo(() => {
    if (!generationResult) return [];
    return generationResult.validationIssues.filter(iss => {
      if (issueSeverityFilter !== 'ALL' && iss.severity !== issueSeverityFilter) {
        return false;
      }
      return true;
    });
  }, [generationResult, issueSeverityFilter]);

  return (
    <div className="space-y-6 pb-12">
      {/* MODULE HEADER & UPLOAD BAR */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-6 h-6 text-[#0A192F]" />
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {isAr ? 'مولّد سجل EI الموحد (EI Log Generator)' : 'EI Log Generator — Cumulative Shop Drawing Registers'}
              </h1>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              {isAr
                ? 'استخراج وتجميع سجل EI Log الموحد تلقائيًا من شيتات سجلات الرسومات التراكمية لجميع التخصصات مع التحقق المرجعي الكامل وتتبع المصدر.'
                : 'Automated extraction, conflict detection, and reference verification of unified EI Logs from multi-discipline Cumulative Shop Drawing Registers.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={fileInputRef}
              onChange={handleWorkbookUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#0A192F] hover:bg-slate-800 text-white font-semibold px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors"
            >
              <Upload className="w-4 h-4 text-[#D4AF37]" />
              {isAr ? 'رفع ملف Excel السجل التراكمي' : 'Upload Cumulative SDW Excel'}
            </button>

            <input
              type="file"
              accept=".xlsx,.xls"
              ref={refFileInputRef}
              onChange={handleReferenceUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => refFileInputRef.current?.click()}
              className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold px-4 py-2.5 rounded-lg text-sm border border-slate-300 flex items-center gap-2 transition-colors"
            >
              <FileCheck2 className="w-4 h-4 text-slate-700" />
              {isAr ? 'رفع EI Log مرجعي للمطابقة' : 'Upload Reference EI Log'}
            </button>

            <button
              type="button"
              onClick={() => handleLoadBenchmarkWorkbook(false)}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3.5 py-2.5 rounded-lg text-xs border border-slate-300 transition-colors"
            >
              {isAr ? 'تحميل نموذج قياسي معتمد' : 'Load Certified Benchmark'}
            </button>

            <button
              type="button"
              onClick={() => handleLoadBenchmarkWorkbook(true)}
              className="bg-amber-50 hover:bg-amber-100 text-amber-900 font-medium px-3.5 py-2.5 rounded-lg text-xs border border-amber-300 transition-colors"
            >
              {isAr ? 'تحميل نموذج اختبار التعارضات' : 'Load Conflict Audit Sample'}
            </button>

            {generationResult && generationResult.records.length > 0 && (
              <button
                type="button"
                onClick={() => downloadEILogExcel(generationResult, activeReferenceReport)}
                className="bg-[#D4AF37] hover:bg-[#eab308] text-[#0A192F] font-bold px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                {isAr ? 'تصدير EI Log إلى Excel' : 'Export EI Log (.xlsx)'}
              </button>
            )}
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {!generationResult ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <FileSpreadsheet className="w-14 h-14 text-slate-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-800">
            {isAr ? 'لا يوجد ملف سجل رسومات تراكمي محمّل حاليًا' : 'No Cumulative Shop Drawing Register Loaded'}
          </h2>
          <p className="text-sm text-slate-500 max-w-xl mx-auto mt-1 mb-6">
            {isAr
              ? 'قم برفع ملف Excel يحتوي على شيتات التخصصات (ARCH, STR, MECH, ELEC...) أو اضغط على "تحميل نموذج قياسي معتمد" لمعاينة الشيتات والتحقق من البيانات وإنشاء EI Log الموحد.'
              : 'Upload an Excel workbook containing discipline sheets (ARCH, STR, MECH, ELEC, etc.) or click "Load Certified Benchmark" to inspect sheets, review conflicts, and generate the unified 6-column EI Log.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#0A192F] hover:bg-slate-800 text-white font-semibold px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-2"
            >
              <Upload className="w-4 h-4 text-[#D4AF37]" />
              {isAr ? 'رفع ملف Excel' : 'Upload Excel Workbook'}
            </button>
            <button
              type="button"
              onClick={() => handleLoadBenchmarkWorkbook(false)}
              className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold px-5 py-2.5 rounded-lg text-sm border border-slate-300 inline-flex items-center gap-2"
            >
              <Eye className="w-4 h-4" />
              {isAr ? 'تشغيل النموذج المرجعي المعتمد' : 'Run Certified Reference Sample'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* VERIFICATION SUMMARY METRICS BAR */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {isAr ? 'شيتات التخصصات المكتشفة' : 'Discovered Discipline Sheets'}
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {generationResult.summary.discoveredDisciplineSheetsCount}
              </div>
              <div className="text-xs text-slate-500 mt-1 truncate">
                {generationResult.summary.disciplinesList.join(' · ') || '-'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {isAr ? 'إجمالي التقديمات المستخرجة' : 'Extracted Submittals (SUB Ref.)'}
              </div>
              <div className="text-2xl font-bold text-[#0A192F] mt-1 tabular-nums">
                {generationResult.summary.extractedSubmittalsCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isAr
                  ? `من إجمالي ${generationResult.summary.validRowsProcessed} صف صالح`
                  : `From ${generationResult.summary.validRowsProcessed} valid source rows`}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {isAr ? 'الصفوف المدمجة والمكررة' : 'Consolidated / Duplicate Rows'}
              </div>
              <div className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">
                {generationResult.summary.consolidatedDuplicateRowsCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isAr
                  ? `تكرار DWG في Rev00: ${generationResult.summary.duplicateRev00DrawingsCount}`
                  : `Rev00 duplicate DWGs: ${generationResult.summary.duplicateRev00DrawingsCount}`}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {isAr ? 'التقديمات المتعارضة للمراجعة' : 'Conflicted Submittals'}
              </div>
              <div
                className={`text-2xl font-bold mt-1 tabular-nums ${
                  generationResult.summary.conflictedSubmittalsCount > 0 ? 'text-amber-600' : 'text-emerald-700'
                }`}
              >
                {generationResult.summary.conflictedSubmittalsCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isAr
                  ? `سليمة بالكامل: ${generationResult.summary.cleanSubmittalsCount}`
                  : `Clean submittals: ${generationResult.summary.cleanSubmittalsCount}`}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {isAr ? 'سجلات لم تتم معالجتها' : 'Unprocessed Records'}
              </div>
              <div
                className={`text-2xl font-bold mt-1 tabular-nums ${
                  generationResult.summary.unprocessedRecordsCount > 0 ? 'text-red-600' : 'text-slate-900'
                }`}
              >
                {generationResult.summary.unprocessedRecordsCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isAr
                  ? `أخطاء بيانات: ${generationResult.summary.validationErrorsCount}`
                  : `Validation errors: ${generationResult.summary.validationErrorsCount}`}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {isAr ? 'المطابقة مع EI المرجعي' : 'Reference EI Log Parity'}
              </div>
              <div
                className={`text-2xl font-bold mt-1 tabular-nums ${
                  activeReferenceReport
                    ? activeReferenceReport.is100PercentParity
                      ? 'text-emerald-700'
                      : 'text-amber-600'
                    : 'text-slate-400'
                }`}
              >
                {activeReferenceReport ? `${activeReferenceReport.overallFieldMatchRatePct}%` : 'N/A'}
              </div>
              <div className="text-xs text-slate-500 mt-1 truncate">
                {activeReferenceReport
                  ? activeReferenceReport.is100PercentParity
                    ? isAr
                      ? 'مطابقة تامة 100% لجميع الحقول'
                      : '100% Exact Field Parity'
                    : isAr
                    ? `${activeReferenceReport.discrepancies.length} اختلاف مكتشف`
                    : `${activeReferenceReport.discrepancies.length} variance(s) found`
                  : isAr
                  ? 'ارفع ملف EI مرجعي للمقارنة'
                  : 'Upload Reference EI to verify'}
              </div>
            </div>
          </div>

          {/* WORKFLOW NAVIGATION & RULE CONFIGURATION BAR */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveSection('sheets_preview')}
                className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors flex items-center gap-2 ${
                  activeSection === 'sheets_preview'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-4 h-4" />
                {isAr
                  ? `1. معاينة الشيتات والأعمدة (${generationResult.discoveredSheets.length})`
                  : `1. Sheets & Columns Preview (${generationResult.discoveredSheets.length})`}
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('conflicts_validation')}
                className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors flex items-center gap-2 ${
                  activeSection === 'conflicts_validation'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                {isAr
                  ? `2. أخطاء البيانات والتعارضات (${generationResult.validationIssues.length})`
                  : `2. Data Errors & Conflicts (${generationResult.validationIssues.length})`}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsLogGenerated(true);
                  setActiveSection('ei_log_table');
                }}
                className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors flex items-center gap-2 ${
                  activeSection === 'ei_log_table'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="w-4 h-4 text-emerald-700" />
                {isAr
                  ? `3. سجل EI Log الموحد (${generationResult.records.length})`
                  : `3. Unified EI Log (${generationResult.records.length})`}
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('reference_parity')}
                className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors flex items-center gap-2 ${
                  activeSection === 'reference_parity'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-blue-700" />
                {isAr ? '4. التحقق والمطابقة المرجعية' : '4. Reference EI Verification'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs">
                <label className="font-semibold text-slate-600 whitespace-nowrap">
                  {isAr ? 'قاعدة حسم تعارض الرسومات:' : 'Multi-Drawing Conflict Rule:'}
                </label>
                <select
                  value={resolutionMode}
                  onChange={e => setResolutionMode(e.target.value as EIConflictResolutionMode)}
                  className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-[#0A192F]"
                >
                  <option value="GOVERNING_EI_RULE">
                    {isAr
                      ? 'القاعدة الهندسية المعتمدة (الكود الأكثر تحفظًا + أحدث تاريخ رد)'
                      : 'Governing EI Rule (Worst-Case Code + Package Completion Date)'}
                  </option>
                  <option value="EXCEL_FIRST_MATCH">
                    {isAr
                      ? 'معادلة إكسل INDEX/MATCH (أول صف مطابق للمراجعة)'
                      : 'Excel INDEX/MATCH Parity (First Row in Revision)'}
                  </option>
                  <option value="EXCEL_LAST_MATCH">
                    {isAr
                      ? 'معادلة إكسل XLOOKUP (آخر صف مطابق للمراجعة)'
                      : 'Excel XLOOKUP Parity (Last Row in Revision)'}
                  </option>
                  <option value="HOLD_ON_CONFLICT">
                    {isAr
                      ? 'تعليق القيمة المتعارضة للمراجعة اليدوية (CONFLICT)'
                      : 'Hold Conflicted Value for Manual Review (CONFLICT)'}
                  </option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsLogGenerated(true);
                  setActiveSection('ei_log_table');
                }}
                className="bg-[#0A192F] hover:bg-slate-800 text-white font-semibold px-4 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#D4AF37]" />
                {isAr ? 'إنشاء / تحديث EI Log الموحد' : 'Generate Unified EI Log'}
              </button>
            </div>
          </div>

          {/* SECTION 1: DISCOVERED SHEETS & COLUMN VALIDATION PREVIEW */}
          {activeSection === 'sheets_preview' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      {isAr
                        ? 'الشيتات والتخصصات المكتشفة ومطابقة الأعمدة'
                        : 'Discovered Worksheets, Disciplines & Required Column Verification'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isAr
                        ? `الملف المصدر: ${generationResult.fileName} — يدعم اختلاف ترتيب الشيتات ويتحقق من الحقول الـ 6 الإلزامية قبل التجميع.`
                        : `Source Workbook: ${generationResult.fileName} — Sheet order agnostic with strict 6-field header verification.`}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">{isAr ? 'تضمين' : 'Include'}</th>
                        <th className="py-3 px-3">{isAr ? 'الترتيب' : 'Order'}</th>
                        <th className="py-3 px-4">{isAr ? 'اسم الشيت' : 'Sheet Name'}</th>
                        <th className="py-3 px-4">{isAr ? 'التصنيف / التخصص' : 'Role / Discipline'}</th>
                        <th className="py-3 px-3 text-right">{isAr ? 'صف العناوين' : 'Header Row'}</th>
                        <th className="py-3 px-3 text-right">{isAr ? 'الصفوف الصالحة' : 'Valid Rows'}</th>
                        <th className="py-3 px-3 text-right">{isAr ? 'غير معالجة' : 'Unprocessed'}</th>
                        <th className="py-3 px-4">{isAr ? 'مطابقة الأعمدة المطلوبة (6 حقول)' : 'Required Column Mapping (6 Fields)'}</th>
                        <th className="py-3 px-4">{isAr ? 'حالة التحقق' : 'Validation Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800">
                      {generationResult.discoveredSheets.map(sheet => {
                        const isDisc = sheet.sheetRole === 'DISCIPLINE_REGISTER';
                        const isChecked =
                          isDisc &&
                          (selectedSheets.length === 0
                            ? sheet.isSelectedByDefault
                            : selectedSheets.includes(sheet.sheetName));

                        return (
                          <tr key={sheet.sheetName} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4">
                              {isDisc ? (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSheetSelection(sheet.sheetName)}
                                  className="rounded border-slate-300 text-[#0A192F] focus:ring-[#0A192F]"
                                />
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-500 tabular-nums">
                              #{sheet.sheetIndex + 1}
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900">{sheet.sheetName}</td>
                            <td className="py-3 px-4">
                              {sheet.sheetRole === 'DISCIPLINE_REGISTER' ? (
                                <span className="font-semibold text-slate-800">
                                  {sheet.detectedDiscipline} · {sheet.disciplineLabel}
                                </span>
                              ) : sheet.sheetRole === 'REFERENCE_EI_LOG' ? (
                                <span className="font-semibold text-blue-700">
                                  {isAr ? 'سجل EI مرجعي (للمقارنة)' : 'Reference EI Log (Auto-Compare)'}
                                </span>
                              ) : (
                                <span className="text-slate-400">
                                  {isAr ? 'شيت غير تابع للسجلات' : 'Non-Register Sheet'}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              {sheet.headerRowNumber > 0 ? `Row ${sheet.headerRowNumber}` : '-'}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums">
                              {sheet.validSubmittalRows}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <span className={sheet.unprocessedRows > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}>
                                {sheet.unprocessedRows}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              {sheet.columnMappings.length > 0 ? (
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                                  {sheet.columnMappings.map(col => (
                                    <span
                                      key={col.fieldKey}
                                      className={
                                        col.columnIndex >= 0
                                          ? 'text-slate-700'
                                          : 'text-red-600 font-bold'
                                      }
                                    >
                                      {col.fieldLabel}:{' '}
                                      <span className="font-mono">
                                        {col.matchedHeader ? `"${col.matchedHeader}"` : 'MISSING'}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`font-medium ${
                                  sheet.missingRequiredColumns.length > 0
                                    ? 'text-red-600'
                                    : sheet.sheetRole === 'REFERENCE_EI_LOG'
                                    ? 'text-blue-700'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {isAr ? sheet.statusMessageAr : sheet.statusMessageEn}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* DISCIPLINE SUMMARY TABLE */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    {isAr ? 'ملخص التحقق حسب التخصص' : 'Verification Summary by Discipline'}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">{isAr ? 'التخصص' : 'Discipline'}</th>
                        <th className="py-3 px-4">{isAr ? 'الشيتات المصدرية' : 'Source Sheet(s)'}</th>
                        <th className="py-3 px-4 text-right">{isAr ? 'إجمالي الصفوف' : 'Raw Rows'}</th>
                        <th className="py-3 px-4 text-right">{isAr ? 'التقديمات المميزة (SUB Ref.)' : 'Unique Submittals'}</th>
                        <th className="py-3 px-4 text-right">{isAr ? 'مجموع Rev00.Total Sheets' : 'Sum of Rev00.Total Sheets'}</th>
                        <th className="py-3 px-4 text-right">{isAr ? 'تقديمات متعارضة' : 'Conflicted Submittals'}</th>
                        <th className="py-3 px-4 text-right">{isAr ? 'صفوف غير معالجة' : 'Unprocessed Rows'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800">
                      {generationResult.summary.byDisciplineBreakdown.map(d => (
                        <tr key={d.discipline} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900">{d.discipline}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{d.sheetNames.join(', ')}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">{d.rawRows}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-[#0A192F] tabular-nums">
                            {d.uniqueSubmittals}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums">
                            {d.rev00TotalSheetsSum}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <span className={d.conflictedSubmittals > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}>
                              {d.conflictedSubmittals}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <span className={d.unprocessedRows > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}>
                              {d.unprocessedRows}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: DATA ERRORS, CONFLICTS & UNPROCESSED RECORDS */}
          {activeSection === 'conflicts_validation' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      {isAr
                        ? 'سجل أخطاء البيانات والتعارضات المكتشفة قبل اعتماد السجل'
                        : 'Pre-Generation Data Errors, Multi-Drawing Conflicts & Revision Anomalies'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isAr
                        ? 'يتم رصد أي اختلاف في التواريخ أو الأكواد بين رسومات التقديم الواحد دون اختيار عشوائي، مع توثيق الشيت والصف الأصليين.'
                        : 'Every date or status code discrepancy across drawings of the same SUB Ref. is deterministically resolved and logged with exact sheet & row provenance.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-xs">
                    {(['ALL', 'ERROR', 'CONFLICT', 'WARNING'] as const).map(sev => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setIssueSeverityFilter(sev)}
                        className={`px-3 py-1 rounded font-semibold transition-colors ${
                          issueSeverityFilter === sev
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredIssues.length === 0 ? (
                  <div className="p-10 text-center text-slate-500 text-sm">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                    {isAr
                      ? 'لا توجد أخطاء بيانات أو تعارضات مطابقة للفلتر المحدد.'
                      : 'Zero data errors or conflicts found matching the selected filter.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
                          <th className="py-3 px-4">{isAr ? 'المعرف' : 'ID'}</th>
                          <th className="py-3 px-3">{isAr ? 'الخطورة' : 'Severity'}</th>
                          <th className="py-3 px-4">{isAr ? 'نوع التعارض / الخطأ' : 'Issue Type'}</th>
                          <th className="py-3 px-3">{isAr ? 'الشيت والصفوف' : 'Sheet & Row(s)'}</th>
                          <th className="py-3 px-4">{isAr ? 'رقم التقديم (SUB Ref.)' : 'SUB Ref.'}</th>
                          <th className="py-3 px-4">{isAr ? 'القيم المتعارضة' : 'Conflicting Values'}</th>
                          <th className="py-3 px-4">{isAr ? 'التفاصيل والقاعدة المطبقة' : 'Details & Applied Rule'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-slate-800">
                        {filteredIssues.map(iss => (
                          <tr key={iss.id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-mono text-slate-500">{iss.id}</td>
                            <td className="py-3 px-3 font-bold">
                              <span
                                className={
                                  iss.severity === 'ERROR'
                                    ? 'text-red-600'
                                    : iss.severity === 'CONFLICT'
                                    ? 'text-amber-600'
                                    : 'text-blue-600'
                                }
                              >
                                {iss.severity}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-slate-800">{iss.type}</td>
                            <td className="py-3 px-3 font-mono text-slate-600 tabular-nums">
                              {iss.sheetName} (R{iss.excelRowNumbers.join(', R')})
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-slate-900">{iss.subRef}</td>
                            <td className="py-3 px-4 font-mono text-slate-700">
                              {(iss.conflictingValues || []).join(' vs ') || '-'}
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              {isAr ? iss.messageAr : iss.messageEn}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* UNPROCESSED RECORDS TABLE */}
              {generationResult.unprocessedRecords.length > 0 && (
                <div className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-6 py-4 bg-red-50/60 border-b border-red-200">
                    <h3 className="text-sm font-bold text-red-900">
                      {isAr
                        ? `سجلات لم تتم معالجتها (${generationResult.unprocessedRecords.length})`
                        : `Unprocessed / Skipped Source Records (${generationResult.unprocessedRecords.length})`}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider">
                          <th className="py-2.5 px-4">{isAr ? 'الشيت' : 'Sheet'}</th>
                          <th className="py-2.5 px-4">{isAr ? 'رقم الصف' : 'Excel Row #'}</th>
                          <th className="py-2.5 px-4">SUB Ref.</th>
                          <th className="py-2.5 px-4">DWG No.</th>
                          <th className="py-2.5 px-4">Rev.</th>
                          <th className="py-2.5 px-4">{isAr ? 'سبب عدم المعالجة' : 'Reason'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-slate-800">
                        {generationResult.unprocessedRecords.map((u, idx) => (
                          <tr key={idx} className="hover:bg-red-50/20">
                            <td className="py-2.5 px-4 font-bold">{u.sheetName}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums">Row {u.excelRowNumber}</td>
                            <td className="py-2.5 px-4 font-mono text-red-600">{u.rawSubRef || '(blank)'}</td>
                            <td className="py-2.5 px-4 font-mono">{u.rawDwgNo || '-'}</td>
                            <td className="py-2.5 px-4 font-mono">{u.rawRev || '-'}</td>
                            <td className="py-2.5 px-4 text-red-800">{isAr ? u.reasonAr : u.reasonEn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: UNIFIED 6-COLUMN EI LOG OUTPUT TABLE WITH TRACEABILITY */}
          {activeSection === 'ei_log_table' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {isAr
                      ? 'سجل EI Log الموحد (الترتيب الرسمي للأعمدة الـ 6)'
                      : 'Unified EI Log Output (Canonical 6-Column Order)'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isAr
                      ? 'اضغط على أي صف لعرض التتبع الكامل إلى الشيت الأصلي وأرقام الصفوف والرسومات المميزة في Rev 00.'
                      : 'Click any submittal row to inspect full source sheet & Excel row lineage, distinct Rev00 drawings, and revision history.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder={isAr ? 'بحث برقم التقديم أو الرسم...' : 'Search SUB Ref. or DWG No...'}
                      className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#0A192F]"
                    />
                  </div>

                  <select
                    value={disciplineFilter}
                    onChange={e => setDisciplineFilter(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-medium"
                  >
                    <option value="ALL">{isAr ? 'جميع التخصصات' : 'All Disciplines'}</option>
                    {generationResult.summary.disciplinesList.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>

                  <select
                    value={conflictFilter}
                    onChange={e => setConflictFilter(e.target.value as any)}
                    className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-medium"
                  >
                    <option value="ALL">{isAr ? 'جميع الحالات' : 'All Statuses'}</option>
                    <option value="CLEAN_ONLY">{isAr ? 'سليمة بدون تعارض' : 'Clean Only'}</option>
                    <option value="CONFLICT_ONLY">{isAr ? 'متعارضة فقط' : 'Conflicted Only'}</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#0A192F] text-white font-semibold uppercase tracking-wider">
                      <th className="py-3 px-3 w-8"></th>
                      {EI_LOG_CANONICAL_COLUMNS.map((colName, idx) => (
                        <th
                          key={colName}
                          className={`py-3 px-4 ${idx === 4 ? 'text-right' : idx === 3 || idx === 5 ? 'text-center' : ''}`}
                        >
                          {idx + 1}. {colName}
                        </th>
                      ))}
                      <th className="py-3 px-4 text-slate-300">{isAr ? 'التخصص والمصدر' : 'Discipline & Source Trace'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {filteredRecords.map(rec => {
                      const isExpanded = expandedSubRef === rec.subRef;
                      return (
                        <React.Fragment key={rec.subRef}>
                          <tr
                            onClick={() => setExpandedSubRef(isExpanded ? null : rec.subRef)}
                            className={`cursor-pointer transition-colors ${
                              rec.hasConflict ? 'bg-amber-50/40 hover:bg-amber-50/80' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-3 px-3 text-slate-400">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-slate-700" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </td>
                            {/* 1. SUB Ref. */}
                            <td className="py-3 px-4 font-mono font-bold text-slate-900">{rec.subRef}</td>
                            {/* 2. Rev00.Date Sent */}
                            <td className="py-3 px-4 font-mono tabular-nums text-slate-800">
                              {rec.rev00DateSent || '-'}
                            </td>
                            {/* 3. Date Return */}
                            <td className="py-3 px-4 font-mono tabular-nums text-slate-800">
                              {rec.dateReturn || '-'}
                            </td>
                            {/* 4. Last Rev. */}
                            <td className="py-3 px-4 font-mono font-bold text-center tabular-nums text-[#0A192F]">
                              {rec.lastRev || '-'}
                            </td>
                            {/* 5. Rev00.Total Sheets */}
                            <td className="py-3 px-4 font-mono font-bold text-right tabular-nums text-slate-900">
                              {rec.rev00TotalSheets}
                            </td>
                            {/* 6. Code.1 */}
                            <td className="py-3 px-4 font-mono font-bold text-center">
                              <span
                                className={
                                  rec.code1 === 'A'
                                    ? 'text-emerald-700'
                                    : rec.code1 === 'B'
                                    ? 'text-blue-700'
                                    : rec.code1 === 'C' || rec.code1 === 'D'
                                    ? 'text-red-600'
                                    : 'text-amber-700'
                                }
                              >
                                {rec.code1 || '-'}
                              </span>
                            </td>
                            {/* Provenance Metadata */}
                            <td className="py-3 px-4 text-slate-600">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-800">{rec.discipline}</span>
                                <span>·</span>
                                <span className="font-mono text-[11px]">
                                  {rec.sourceSheets.join(', ')} ({rec.totalSourceRows} rows)
                                </span>
                                {rec.hasConflict && (
                                  <>
                                    <span>·</span>
                                    <span className="text-amber-700 font-semibold">
                                      {rec.conflictTypes.join(', ')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-slate-50/90">
                              <td colSpan={8} className="p-4 border-b border-slate-200">
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <div>
                                      <span className="font-bold text-slate-900">
                                        {isAr ? 'الأصل والتتبع:' : 'Source Lineage:'}
                                      </span>{' '}
                                      <span className="font-mono text-slate-700">
                                        {rec.excelRowNumbers.join(', ')}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="font-bold text-slate-900">
                                        {isAr ? 'الرسومات المميزة في Rev 00:' : 'Distinct Rev 00 DWG No.:'}
                                      </span>{' '}
                                      <span className="font-mono text-slate-700">
                                        {rec.rev00DistinctDrawings.join(', ') || 'None'} ({rec.rev00TotalSheets})
                                      </span>
                                    </div>
                                    <div>
                                      <span className="font-bold text-slate-900">
                                        {isAr ? 'القاعدة المطبقة:' : 'Rule Applied:'}
                                      </span>{' '}
                                      <span className="text-slate-700">{rec.resolutionRuleApplied}</span>
                                    </div>
                                  </div>

                                  <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                                    <table className="w-full text-left border-collapse text-[11px]">
                                      <thead>
                                        <tr className="bg-slate-100 text-slate-600 border-b border-slate-200 font-semibold">
                                          <th className="py-2 px-3">Sheet</th>
                                          <th className="py-2 px-3">Excel Row #</th>
                                          <th className="py-2 px-3">SUB Ref.</th>
                                          <th className="py-2 px-3">DWG No.</th>
                                          <th className="py-2 px-3">Title</th>
                                          <th className="py-2 px-3">Raw Rev.</th>
                                          <th className="py-2 px-3">Norm Rev.</th>
                                          <th className="py-2 px-3">Date Sent</th>
                                          <th className="py-2 px-3">Date Return</th>
                                          <th className="py-2 px-3">Code</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 font-mono">
                                        {rec.sourceRows.map((sr, i) => (
                                          <tr
                                            key={i}
                                            className={!sr.isValidRev ? 'bg-red-50/40 text-red-700' : ''}
                                          >
                                            <td className="py-1.5 px-3 font-sans font-semibold">{sr.sheetName}</td>
                                            <td className="py-1.5 px-3 tabular-nums">Row {sr.excelRowNumber}</td>
                                            <td className="py-1.5 px-3">{sr.rawSubRef}</td>
                                            <td className="py-1.5 px-3 font-bold">{sr.rawDwgNo || '(blank)'}</td>
                                            <td className="py-1.5 px-3 font-sans text-slate-600 truncate max-w-xs">
                                              {sr.drawingTitle || '-'}
                                            </td>
                                            <td className="py-1.5 px-3">{sr.rawRev || '(blank)'}</td>
                                            <td className="py-1.5 px-3 font-bold">
                                              {sr.isValidRev ? sr.normalizedRev : 'INVALID'}
                                            </td>
                                            <td className="py-1.5 px-3 tabular-nums">{sr.dateSent || '-'}</td>
                                            <td className="py-1.5 px-3 tabular-nums">{sr.dateReturn || '-'}</td>
                                            <td className="py-1.5 px-3 font-bold">{sr.normalizedCode || '-'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTION 4: REFERENCE EI LOG PARITY & FORMULA INSPECTION */}
          {activeSection === 'reference_parity' && (
            <div className="space-y-6">
              {!activeReferenceReport ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <ShieldCheck className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <h3 className="text-base font-bold text-slate-800">
                    {isAr
                      ? 'لم يتم تحميل سجل EI Log مرجعي للمقارنة بعد'
                      : 'No Reference EI Log Loaded for Verification'}
                  </h3>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto mt-1 mb-5">
                    {isAr
                      ? 'إذا كان ملف Excel المرفوع يحتوي على شيت باسم "EI" أو "EI Log" فسيتم فحصه تلقائيًا، أو يمكنك رفع ملف EI Log المرجعي المعتمد لمطابقة عدد التقديمات وجميع الحقول الـ 6.'
                      : 'If the uploaded workbook includes an "EI" or "EI Log" sheet it is inspected automatically, or you can upload an approved Reference EI Log (.xlsx) to verify 100% field parity.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => refFileInputRef.current?.click()}
                    className="bg-[#0A192F] hover:bg-slate-800 text-white font-semibold px-4 py-2 rounded-lg text-xs inline-flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4 text-[#D4AF37]" />
                    {isAr ? 'رفع ملف EI Log مرجعي' : 'Upload Reference EI Log (.xlsx)'}
                  </button>
                </div>
              ) : (
                <>
                  {/* PARITY BANNER & COLUMN MATCH BREAKDOWN */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          {activeReferenceReport.is100PercentParity ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="w-6 h-6 text-amber-600" />
                          )}
                          <h2 className="text-lg font-bold text-slate-900">
                            {activeReferenceReport.is100PercentParity
                              ? isAr
                                ? 'تقرير المطابقة المرجعية: تطابق تام 100% مع EI Log المعتمد'
                                : 'Reference EI Log Verification: 100% Certified Field-by-Field Parity'
                              : isAr
                              ? 'تقرير المطابقة المرجعية: تم رصد فروقات موثقة للمراجعة'
                              : 'Reference EI Log Verification: Documented Field Variances Detected'}
                          </h2>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {isAr
                            ? `المصدر المرجعي: ${activeReferenceReport.referenceSourceName} · التقديمات المرجعية: ${activeReferenceReport.referenceSubmittalCount} · المستخرجة: ${activeReferenceReport.generatedSubmittalCount}`
                            : `Reference Source: ${activeReferenceReport.referenceSourceName} · Reference Submittals: ${activeReferenceReport.referenceSubmittalCount} · Generated: ${activeReferenceReport.generatedSubmittalCount}`}
                        </p>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-500 uppercase font-semibold">
                          {isAr ? 'نسبة تطابق الحقول الإجمالية' : 'Overall Field Match Rate'}
                        </div>
                        <div
                          className={`text-3xl font-bold tabular-nums ${
                            activeReferenceReport.is100PercentParity ? 'text-emerald-700' : 'text-amber-600'
                          }`}
                        >
                          {activeReferenceReport.overallFieldMatchRatePct}%
                        </div>
                      </div>
                    </div>

                    {/* PER-COLUMN MATCH CARDS */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {(
                        Object.entries(activeReferenceReport.perColumnStats) as Array<
                          [string, { matched: number; total: number; matchPct: number }]
                        >
                      ).map(([colName, st]) => (
                        <div key={colName} className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                          <div className="text-xs font-bold text-slate-800">{colName}</div>
                          <div
                            className={`text-xl font-bold mt-1 tabular-nums ${
                              st.matchPct === 100 ? 'text-emerald-700' : 'text-amber-600'
                            }`}
                          >
                            {st.matchPct}%
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {st.matched} / {st.total} matched
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* INSPECTED REFERENCE EXCEL FORMULAS */}
                    {activeReferenceReport.inspectedFormulas.length > 0 && (
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-800 border-b border-slate-200">
                          {isAr
                            ? 'معادلات نموذج EI الحالي التي تم فحصها داخل الشيت المرجعي'
                            : 'Inspected Excel Formulas from Current Reference EI Model'}
                        </div>
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                              <th className="py-2 px-4">{isAr ? 'الحقل' : 'EI Column'}</th>
                              <th className="py-2 px-4">{isAr ? 'المعادلة المكتشفة' : 'Inspected Excel Formula'}</th>
                              <th className="py-2 px-4">{isAr ? 'آلية الحساب المعتمدة' : 'Detected Rule Mechanism'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {activeReferenceReport.inspectedFormulas.map((f, i) => (
                              <tr key={i}>
                                <td className="py-2 px-4 font-bold text-slate-900">{f.columnName}</td>
                                <td className="py-2 px-4 font-mono text-blue-800">{f.sampleFormula}</td>
                                <td className="py-2 px-4 text-slate-700">{f.detectedMechanism}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* DISCREPANCY TABLE IF ANY */}
                    {activeReferenceReport.discrepancies.length > 0 && (
                      <div className="border border-amber-200 rounded-lg overflow-hidden">
                        <div className="bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-900 border-b border-amber-200">
                          {isAr
                            ? `تفاصيل الفروقات المكتشفة مع السجل المرجعي (${activeReferenceReport.discrepancies.length})`
                            : `Documented Field-Level Discrepancies vs Reference EI Log (${activeReferenceReport.discrepancies.length})`}
                        </div>
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                              <th className="py-2 px-4">SUB Ref.</th>
                              <th className="py-2 px-4">{isAr ? 'الحقل' : 'Field'}</th>
                              <th className="py-2 px-4">{isAr ? 'القيمة المرجعية المتوقعة' : 'Reference Expected'}</th>
                              <th className="py-2 px-4">{isAr ? 'القيمة المستخرجة' : 'Generated Actual'}</th>
                              <th className="py-2 px-4">{isAr ? 'التفسير وتتبع المصدر' : 'Diagnostic & Source Trace'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 font-mono">
                            {activeReferenceReport.discrepancies.map((d, idx) => (
                              <tr key={idx}>
                                <td className="py-2 px-4 font-bold text-slate-900">{d.subRef}</td>
                                <td className="py-2 px-4">{d.field}</td>
                                <td className="py-2 px-4 text-emerald-700">{d.expectedValue}</td>
                                <td className="py-2 px-4 text-red-600 font-bold">{d.actualValue}</td>
                                <td className="py-2 px-4 font-sans text-slate-700">
                                  <div>{isAr ? d.explanationAr : d.explanationEn}</div>
                                  <div className="text-[11px] font-mono text-slate-500">{d.sourceTrace}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EILogGenerator;
