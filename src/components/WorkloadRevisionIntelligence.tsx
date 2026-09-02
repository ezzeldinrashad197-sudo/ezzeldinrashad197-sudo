import React, { useState } from 'react';
import { History, RotateCcw, AlertTriangle, CheckCircle2, HelpCircle, ArrowRight, Layers, Info } from 'lucide-react';
import { KPIStats } from '../types';
import { RegisterItem } from './ExecutiveRegisterSummary';

interface WorkloadRevisionIntelligenceProps {
  byDocType: RegisterItem[];
  globalStats: KPIStats;
  openDrillDown: (
    docTypeFilter: string,
    metricKey: string,
    metricLabel: string,
    metricLabelAr: string
  ) => void;
  language: 'ar' | 'en';
}

export const WorkloadRevisionIntelligence: React.FC<WorkloadRevisionIntelligenceProps> = ({
  byDocType,
  globalStats,
  openDrillDown,
  language
}) => {
  const [activeTab, setActiveTab] = useState<'workload' | 'rejection'>('workload');
  const [showSemanticHelp, setShowSemanticHelp] = useState(false);

  const reworkRatio = globalStats.totalSubmittedSheets > 0
    ? ((globalStats.totalSheetsFurtherRev / globalStats.totalSubmittedSheets) * 100).toFixed(1)
    : '0.0';

  return (
    <div id="level3-workload-intelligence" className="space-y-4 print:break-inside-avoid">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-extrabold uppercase tracking-wider bg-indigo-600 text-white">
              Level 3 — Workload & Historical Intelligence
            </span>
            <span className="text-xs text-indigo-900 font-medium">Historical Submission & Revision Grain</span>
          </div>
          <h3 className="text-lg font-bold text-[#203864] mt-1">
            {language === 'ar' ? 'ذكاء حجم الأعمال ومسار المراجعات وحالات الرفض' : 'Workload, Revision & Rejection Intelligence'}
          </h3>
          <p className="text-xs text-slate-500 font-normal">
            {language === 'ar'
              ? 'تحليل إجمالي أحداث التقديمات التاريخية، ومعدلات إعادة العمل (Rework)، وتتبع دورة حياة الرفض من البداية حتى التسوية.'
              : 'Cumulative historical submission transactions, engineering rework ratio, and comprehensive rejection lifecycle tracking.'}
          </p>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('workload')}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
              activeTab === 'workload'
                ? 'bg-white text-[#203864] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {language === 'ar' ? 'أحجام العمل وإعادة التقديم' : 'Workload & Revisions'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rejection')}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
              activeTab === 'rejection'
                ? 'bg-white text-[#203864] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {language === 'ar' ? 'دورة حياة الرفض والتسوية' : 'Rejection Lifecycle'}
          </button>
        </div>
      </div>

      {/* CRITICAL ARCHITECTURAL GRAIN SEPARATION CALLOUT */}
      <div className="bg-indigo-50/90 border border-indigo-200 rounded-xl p-4 text-xs text-[#203864] flex items-start gap-3">
        <Info className="w-5 h-5 text-indigo-700 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-extrabold block text-indigo-950">
            {language === 'ar'
              ? 'مبدأ الفصل المعماري: أحداث التقديم التاريخية ≠ عدد البنود الفريدة الحالية'
              : 'Information Architecture Principle: Historical Workload Events ≠ Current Unique Items'}
          </span>
          <span className="text-indigo-900/90 font-medium">
            {language === 'ar'
              ? 'تقيس مقاييس هذا القسم جميع أحداث التقديم التراكمية عبر الزمن (Rev 00 والمراجعات اللاحقة Rev 01, 02..)، بينما تقيس البنود الفريدة الأصول الهندسية الفعلية بحالتها المعتمدة أو النشطة الحالية فقط.'
              : 'Workload rows represent the continuous event stream of submissions and resubmissions across all revision iterations. Unique items represent distinct physical deliverables in their latest state.'}
          </span>
        </div>
      </div>

      {/* TAB 1: WORKLOAD & REVISION INTELLIGENCE */}
      {activeTab === 'workload' && (
        <div className="space-y-4">
          {/* 4 Core Workload Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Total Submission Events */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'إجمالي أحداث التقديم' : 'Total Submission Events'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'totalWorkload', 'All Submission Workload Rows', 'إجمالي صفوف أحداث التقديم التاريخية')}
                  className="text-2xl font-black text-[#203864] hover:underline font-mono cursor-pointer"
                >
                  {globalStats.totalSubmittedSheets}
                </button>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'معاملة مسجلة' : 'Rows'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'كافة السجلات والمراجعات التراكمية' : 'All historical submission rows'}
              </p>
            </div>

            {/* Rev 00 */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'التقديم الأول (Rev 00)' : 'Rev 00 Submissions'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'rev00', 'All Rev 00 Submissions', 'إجمالي تقديمات المراجعة 00')}
                  className="text-2xl font-black text-blue-900 hover:underline font-mono cursor-pointer"
                >
                  {globalStats.totalSheetsRev0}
                </button>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'تقديم أولي' : 'First Issues'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'التقديمات الهندسية الأساسية' : 'Initial revision submissions'}
              </p>
            </div>

            {/* Further Revisions */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'مراجعات لاحقة (Further Rev)' : 'Further Revisions'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'furtherRev', 'All Further Revisions (Rev > 00)', 'إجمالي المراجعات اللاحقة')}
                  className="text-2xl font-black text-amber-900 hover:underline font-mono cursor-pointer"
                >
                  {globalStats.totalSheetsFurtherRev}
                </button>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'إعادة تقديم' : 'Re-issues'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'معاملات المراجعات Rev 01, 02..' : 'Resubmitted packages (Rev > 0)'}
              </p>
            </div>

            {/* Rework Ratio */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'معدل إعادة العمل (Rework Ratio)' : 'Rework Ratio'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-indigo-900 font-mono">
                  {reworkRatio}%
                </span>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'نسبة التعديلات' : 'of Workload'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'نسبة المراجعات اللاحقة من إجمالي الأحداث' : 'Further Rev / Total Workload Events'}
              </p>
            </div>
          </div>

          {/* Workload Breakdown by Register Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider">
                    <th className="px-4 py-3.5 text-left font-extrabold text-[#203864] border-r border-slate-200">
                      {language === 'ar' ? 'السجل الهندسي (Register)' : 'Register'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-slate-800 border-r border-slate-200">
                      {language === 'ar' ? 'إجمالي أحداث التقديم' : 'Total Workload Rows'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-blue-800 border-r border-slate-200">
                      {language === 'ar' ? 'التقديم الأول (Rev 00)' : 'Rev 00'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-amber-800 border-r border-slate-200">
                      {language === 'ar' ? 'مراجعات لاحقة (Further Rev)' : 'Further Revisions'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-indigo-800">
                      {language === 'ar' ? 'معدل إعادة العمل' : 'Rework Ratio'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {byDocType.map((row, idx) => {
                    const regRework = row.stats.totalSubmittedSheets > 0
                      ? ((row.stats.totalSheetsFurtherRev / row.stats.totalSubmittedSheets) * 100).toFixed(1)
                      : '0.0';
                    return (
                      <tr 
                        key={row.documentType} 
                        className={`hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'}`}
                      >
                        <td className="px-4 py-3 border-r border-slate-100 font-bold text-[#203864]">
                          {row.documentType}
                        </td>
                        <td className="px-4 py-3 border-r border-slate-100 text-center font-mono">
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'totalWorkload', `${row.documentType} — Workload Rows`, `${row.documentType} — صفوف التقديم`)}
                            className="font-bold text-slate-800 hover:underline cursor-pointer"
                          >
                            {row.stats.totalSubmittedSheets}
                          </button>
                        </td>
                        <td className="px-4 py-3 border-r border-slate-100 text-center font-mono">
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'rev00', `${row.documentType} — Rev 00`, `${row.documentType} — تقديم أول`)}
                            className="font-semibold text-blue-900 hover:underline cursor-pointer"
                          >
                            {row.stats.totalSheetsRev0}
                          </button>
                        </td>
                        <td className="px-4 py-3 border-r border-slate-100 text-center font-mono">
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'furtherRev', `${row.documentType} — Further Rev`, `${row.documentType} — مراجعات لاحقة`)}
                            className="font-semibold text-amber-900 hover:underline cursor-pointer"
                          >
                            {row.stats.totalSheetsFurtherRev}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-indigo-900">
                          {regRework}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-extrabold text-xs text-slate-800">
                    <td className="px-4 py-3.5 border-r border-slate-200 uppercase tracking-wider">
                      {language === 'ar' ? 'الإجمالي الكلي (GRAND TOTAL)' : 'GRAND TOTAL'}
                    </td>
                    <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono font-extrabold text-[#203864]">
                      {globalStats.totalSubmittedSheets}
                    </td>
                    <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-blue-900 font-extrabold">
                      {globalStats.totalSheetsRev0}
                    </td>
                    <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-amber-900 font-extrabold">
                      {globalStats.totalSheetsFurtherRev}
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-indigo-900 font-extrabold">
                      {reworkRatio}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REJECTION LIFECYCLE & RESOLUTION JOURNEY */}
      {activeTab === 'rejection' && (
        <div className="space-y-4">
          {/* SEMANTIC CLARIFICATION CALLOUT */}
          <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4 text-xs text-amber-950 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-amber-700" />
                <span className="font-extrabold">
                  {language === 'ar'
                    ? 'التفرقة الدلالية والتدقيقية بين صفوف الرفض المغلقة وحالات الرفض المسواة'
                    : 'Certified Semantic Audit Definition: Rejected Closed Rows vs. Resolved Rejections'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSemanticHelp(!showSemanticHelp)}
                className="text-amber-800 underline font-bold hover:text-amber-950 cursor-pointer"
              >
                {showSemanticHelp ? (language === 'ar' ? 'إخفاء الشرح' : 'Hide Details') : (language === 'ar' ? 'عرض تفاصيل التدقيق' : 'View Audit Rule')}
              </button>
            </div>

            {showSemanticHelp && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-amber-200/80 text-[11px] leading-relaxed">
                <div className="bg-white/70 p-3 rounded-lg border border-amber-200">
                  <span className="font-bold text-red-900 block mb-1">
                    1. {language === 'ar' ? 'صفوف الرفض المغلقة (Rejected Closed Rows)' : 'Rejected Closed Rows (Row Grain)'}
                  </span>
                  <p className="text-slate-700">
                    {language === 'ar'
                      ? 'مقياس على مستوى الصف/الحدث التاريخي. يعبر عن عدد صفوف التقديم التي ختمت برفض وأغلقت (Code C/D Closed) دون اعتماد لاحق لنفس الصف. يقيس حجم معاملات الرفض المغلقة تاريخياً.'
                      : 'Historical row grain metric. Measures specific submittal transaction rows stamped with Code C/D Closed with no successor row accepted. Tracks historical closed rejection events.'}
                  </p>
                </div>

                <div className="bg-white/70 p-3 rounded-lg border border-amber-200">
                  <span className="font-bold text-emerald-900 block mb-1">
                    2. {language === 'ar' ? 'حالات الرفض المسواة والمعتمدة (Resolved Rejections)' : 'Resolved Rejections (Deliverable Lifecycle Grain)'}
                  </span>
                  <p className="text-slate-700">
                    {language === 'ar'
                      ? 'مقياس على مستوى البند/الأصل الهندسي الفريد. يعبر عن البنود الفريدة التي تلقت رفضاً سابقاً في مراجعة مبكرة (Rev 00 مثلاً)، ولكن تم تصحيحها وإعادة تقديمها وحصلت على اعتماد نهائي (Approved) في مراجعة لاحقة.'
                      : 'Unique deliverable lifecycle grain metric. Measures unique deliverables that experienced a past rejection in an earlier revision (e.g. Rev 00), but through subsequent revisions were successfully resolved and are now Approved.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 4 Lifecycle Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Total Rejected Rows */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'إجمالي صفوف الرفض التاريخية' : 'Total Historical Rejection Rows'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'totalRejectedRows', 'All Historical Rejected Rows', 'إجمالي صفوف الرفض التاريخية')}
                  className="text-2xl font-black text-rose-900 hover:underline font-mono cursor-pointer"
                >
                  {globalStats.totalRejectedRows}
                </button>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'حدث رفض' : 'Events'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'جميع صفوف المعاملات التي تلقت كود C/D' : 'Cumulative rows stamped with Code C'}
              </p>
            </div>

            {/* Rejected Open Rows */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'صفوف الرفض المفتوحة حالياً' : 'Rejected Open Rows'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'rejectedOpenRows', 'All Rejected Open Rows', 'إجمالي صفوف الرفض المفتوحة')}
                  className="text-2xl font-black text-amber-900 hover:underline font-mono cursor-pointer"
                >
                  {globalStats.rejectedOpenRows}
                </button>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'قيد التعديل' : 'Open'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'معاملات مرفوضة مفتوحة بانتظار إعادة التقديم' : 'Awaiting contractor rework & re-submittal'}
              </p>
            </div>

            {/* Rejected Closed Rows */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'صفوف الرفض المغلقة' : 'Rejected Closed Rows'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'rejectedClosedRows', 'All Rejected Closed Rows', 'إجمالي صفوف الرفض المغلقة')}
                  className="text-2xl font-black text-red-900 hover:underline font-mono cursor-pointer"
                >
                  {globalStats.rejectedClosedRows}
                </button>
                <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'صف مغلق' : 'Closed Rows'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'صفوف مرفوضة ومغلقة (Code C Closed)' : 'Closed under rejection status (row grain)'}
              </p>
            </div>

            {/* Resolved Rejections */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {language === 'ar' ? 'حالات الرفض المسواة والمعتمدة' : 'Resolved Rejections'}
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'resolvedRejections', 'All Resolved Rejections', 'إجمالي حالات الرفض المسواة والمعتمدة')}
                  className="text-2xl font-black text-emerald-800 hover:underline font-mono cursor-pointer"
                >
                  {globalStats.resolvedRejections || 0}
                </button>
                <span className="text-xs text-emerald-700 font-bold">{language === 'ar' ? 'تمت تسويتها' : 'Resolved'}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'بنود كانت مرفوضة واعتمدت لاحقاً' : 'Past rejected items now fully Approved'}
              </p>
            </div>
          </div>

          {/* Rejection Tracking per Register */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider">
                    <th className="px-4 py-3.5 text-left font-extrabold text-[#203864] border-r border-slate-200">
                      {language === 'ar' ? 'السجل الهندسي (Register)' : 'Register'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-rose-900 border-r border-slate-200">
                      {language === 'ar' ? 'إجمالي صفوف الرفض' : 'Historical Rejection Rows'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-amber-800 border-r border-slate-200">
                      {language === 'ar' ? 'صفوف الرفض المفتوحة' : 'Rejected Open Rows'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-red-900 border-r border-slate-200">
                      {language === 'ar' ? 'صفوف الرفض المغلقة' : 'Rejected Closed Rows'}
                    </th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-emerald-800">
                      {language === 'ar' ? 'حالات الرفض المسواة' : 'Resolved Rejections'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {byDocType.map((row, idx) => (
                    <tr 
                      key={row.documentType} 
                      className={`hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'}`}
                    >
                      <td className="px-4 py-3 border-r border-slate-100 font-bold text-[#203864]">
                        {row.documentType}
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center font-mono">
                        <button
                          type="button"
                          onClick={() => openDrillDown(row.documentType, 'totalRejectedRows', `${row.documentType} — Rejection Rows`, `${row.documentType} — صفوف الرفض`)}
                          className="font-bold text-rose-900 hover:underline cursor-pointer"
                        >
                          {row.stats.totalRejectedRows}
                        </button>
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center font-mono">
                        <button
                          type="button"
                          onClick={() => openDrillDown(row.documentType, 'rejectedOpenRows', `${row.documentType} — Rejected Open Rows`, `${row.documentType} — صفوف الرفض المفتوحة`)}
                          className="font-semibold text-amber-900 hover:underline cursor-pointer"
                        >
                          {row.stats.rejectedOpenRows}
                        </button>
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center font-mono">
                        <button
                          type="button"
                          onClick={() => openDrillDown(row.documentType, 'rejectedClosedRows', `${row.documentType} — Rejected Closed Rows`, `${row.documentType} — صفوف الرفض المغلقة`)}
                          className="font-semibold text-red-900 hover:underline cursor-pointer"
                        >
                          {row.stats.rejectedClosedRows}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {(row.stats.resolvedRejections || 0) > 0 ? (
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'resolvedRejections', `${row.documentType} — Resolved Rejections`, `${row.documentType} — حالات الرفض المسواة`)}
                            className="inline-block px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-extrabold border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                          >
                            {row.stats.resolvedRejections || 0}
                          </button>
                        ) : (
                          <span className="text-slate-400 font-medium">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-extrabold text-xs text-slate-800">
                    <td className="px-4 py-3.5 border-r border-slate-200 uppercase tracking-wider">
                      {language === 'ar' ? 'الإجمالي الكلي (GRAND TOTAL)' : 'GRAND TOTAL'}
                    </td>
                    <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-rose-900 font-extrabold">
                      {globalStats.totalRejectedRows}
                    </td>
                    <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-amber-900 font-extrabold">
                      {globalStats.rejectedOpenRows}
                    </td>
                    <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-red-900 font-extrabold">
                      {globalStats.rejectedClosedRows}
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono text-emerald-800 font-extrabold">
                      {globalStats.resolvedRejections || 0}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
