import React from 'react';
import { Clock, AlertCircle, UserCheck, ShieldAlert, ArrowRight } from 'lucide-react';
import { KPIStats } from '../types';
import { RegisterItem } from './ExecutiveRegisterSummary';

interface ActiveBacklogIntelligenceProps {
  byDocType: RegisterItem[];
  globalStats: KPIStats;
  activeOverdueCounts: {
    rejectedOpen: number;
    pending: number;
    total: number;
  };
  openDrillDown: (
    docTypeFilter: string,
    metricKey: string,
    metricLabel: string,
    metricLabelAr: string
  ) => void;
  language: 'ar' | 'en';
}

export const ActiveBacklogIntelligence: React.FC<ActiveBacklogIntelligenceProps> = ({
  byDocType,
  globalStats,
  activeOverdueCounts,
  openDrillDown,
  language
}) => {
  const totalActive = globalStats.pending + globalStats.rejectedOpen;
  const rejectedOpenShare = totalActive > 0 ? ((globalStats.rejectedOpen / totalActive) * 100).toFixed(1) : '0.0';
  const pendingShare = totalActive > 0 ? ((globalStats.pending / totalActive) * 100).toFixed(1) : '0.0';

  // Registers with active backlog items
  const activeRegisters = byDocType.filter(r => (r.stats.pending + r.stats.rejectedOpen) > 0);

  return (
    <div id="level2-active-backlog" className="space-y-4 print:break-inside-avoid">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-extrabold uppercase tracking-wider bg-amber-600 text-white">
              Level 2 — Operational Intelligence
            </span>
            <span className="text-xs text-amber-800 font-medium">Action-Required Population</span>
          </div>
          <h3 className="text-lg font-bold text-[#203864] mt-1">
            {language === 'ar' ? 'ذكاء الأعمال النشطة والمعاملات قيد الإجراء (Active Backlog)' : 'Active Backlog Intelligence'}
          </h3>
          <p className="text-xs text-slate-500 font-normal">
            {language === 'ar'
              ? 'تحديد المعاملات الجارية التي تتطلب اتخاذ قرار فوري، وتوزيع المسؤوليات بين المقاول والاستشاري ومتابعة تجاوزات SLA.'
              : 'Operational triage of active submittals requiring contractor resubmission or consultant evaluation, with SLA breach alerts.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-amber-900 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
            {language === 'ar' ? `إجمالي النشط: ${totalActive}` : `Total Active: ${totalActive}`}
          </span>
        </div>
      </div>

      {/* Operational Backlog Summary Matrix */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider">
                <th className="px-4 py-3.5 text-left font-extrabold text-[#203864] border-r border-slate-200">
                  {language === 'ar' ? 'حالة المعاملة التشغيلية' : 'Operational Status'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-slate-800 border-r border-slate-200">
                  {language === 'ar' ? 'عدد البنود' : 'Items'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-slate-800 border-r border-slate-200">
                  {language === 'ar' ? 'الحصة من الأعمال النشطة' : 'Share of Active'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-rose-800 border-r border-slate-200">
                  {language === 'ar' ? 'المتأخر عن SLA' : 'Overdue'}
                </th>
                <th className="px-4 py-3.5 text-left font-extrabold text-slate-700">
                  {language === 'ar' ? 'المسؤولية التشغيلية والإجراء المطلوب' : 'Responsible Party & Action Required'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {/* Row 1: Rejected Open */}
              <tr className="hover:bg-rose-50/30 transition-colors">
                <td className="px-4 py-3.5 border-r border-slate-100 font-bold text-rose-900">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
                    <div>
                      <span className="block font-bold">{language === 'ar' ? 'مرفوض مفتوح (قيد إعادة التقديم)' : 'Rejected Open'}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{language === 'ar' ? 'كود C مفتوح يتطلب مراجعة المقاول' : 'Code C Open awaiting contractor rework'}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-100 text-center font-mono">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'currentRejectedOpen', 'All Current Rejected Open Items', 'إجمالي البنود المرفوضة المفتوحة')}
                    className="inline-block px-3 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold border border-rose-300 transition-all cursor-pointer shadow-xs"
                  >
                    {globalStats.rejectedOpen}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-100 text-center font-mono font-bold text-slate-700">
                  {rejectedOpenShare}%
                </td>
                <td className="px-4 py-3.5 border-r border-slate-100 text-center font-mono">
                  {activeOverdueCounts.rejectedOpen > 0 ? (
                    <button
                      type="button"
                      onClick={() => openDrillDown('ALL', 'overdue', 'Overdue Rejected Open Items', 'المعاملات المرفوضة المفتوحة المتأخرة')}
                      className="inline-block px-2.5 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-extrabold cursor-pointer transition-colors shadow-xs"
                    >
                      {activeOverdueCounts.rejectedOpen}
                    </button>
                  ) : (
                    <span className="text-slate-400 font-medium">0</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-slate-700">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-bold shrink-0">
                      {language === 'ar' ? 'المقاول الرئيسي' : 'Contractor Action'}
                    </span>
                    <span className="text-slate-600 text-xs">
                      {language === 'ar'
                        ? 'معالجة ملاحظات الاستشاري وإعادة تقديم مراجعة جديدة لإغلاق الرفض.'
                        : 'Address consultant comments and resubmit revised package to resolve open rejection.'}
                    </span>
                  </div>
                </td>
              </tr>

              {/* Row 2: Pending Review */}
              <tr className="hover:bg-amber-50/30 transition-colors">
                <td className="px-4 py-3.5 border-r border-slate-100 font-bold text-amber-900">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                    <div>
                      <span className="block font-bold">{language === 'ar' ? 'معلق قيد المراجعة' : 'Pending Review'}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{language === 'ar' ? 'تحت الدراسة لدى الاستشاري' : 'Under evaluation by supervising consultant'}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-100 text-center font-mono">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'pending', 'All Current Pending Items', 'إجمالي البنود المعلقة قيد المراجعة')}
                    className="inline-block px-3 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 font-extrabold border border-amber-300 transition-all cursor-pointer shadow-xs"
                  >
                    {globalStats.pending}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-100 text-center font-mono font-bold text-slate-700">
                  {pendingShare}%
                </td>
                <td className="px-4 py-3.5 border-r border-slate-100 text-center font-mono">
                  {activeOverdueCounts.pending > 0 ? (
                    <button
                      type="button"
                      onClick={() => openDrillDown('ALL', 'overdue', 'Overdue Pending Items', 'المعاملات المعلقة المتأخرة')}
                      className="inline-block px-2.5 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-extrabold cursor-pointer transition-colors shadow-xs"
                    >
                      {activeOverdueCounts.pending}
                    </button>
                  ) : (
                    <span className="text-slate-400 font-medium">0</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-slate-700">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold shrink-0">
                      {language === 'ar' ? 'الاستشاري المشرف' : 'Consultant Action'}
                    </span>
                    <span className="text-slate-600 text-xs">
                      {language === 'ar'
                        ? 'إتمام الفحص الفني وإصدار كود الاعتماد النهائي قبل انقضاء مهلة SLA.'
                        : 'Perform technical review and issue authoritative determination within contract SLA.'}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 text-slate-800 font-extrabold text-xs">
                <td className="px-4 py-3.5 border-r border-slate-200 text-left">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'active', 'Total Active Backlog', 'إجمالي الأعمال النشطة')}
                    className="hover:underline flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
                  >
                    {language === 'ar' ? 'إجمالي المعاملات النشطة (Total Active)' : 'Total Active Backlog'}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-[#203864]">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'active', 'Total Active Items', 'إجمالي البنود النشطة')}
                    className="hover:underline font-extrabold text-sm cursor-pointer"
                  >
                    {totalActive}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono text-slate-900">
                  100.0%
                </td>
                <td className="px-4 py-3.5 border-r border-slate-200 text-center font-mono">
                  {globalStats.overdue > 0 ? (
                    <button
                      type="button"
                      onClick={() => openDrillDown('ALL', 'overdue', 'All Overdue Active Items', 'كافة المعاملات المتأخرة')}
                      className="inline-block px-2.5 py-0.5 rounded bg-rose-600 text-white font-extrabold hover:bg-rose-700 transition-colors cursor-pointer"
                    >
                      {globalStats.overdue}
                    </button>
                  ) : (
                    <span className="text-slate-400 font-bold">0</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-slate-600 font-medium">
                  {language === 'ar'
                    ? 'إجمالي المعاملات الجارية التي تشكل عبء العمل الفعلي الحالي للمشروع.'
                    : 'Represents 100% of live project workload requiring active resolution.'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Active Backlog Distribution by Register (Operational Detail) */}
      {activeRegisters.length > 0 && (
        <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              {language === 'ar' ? 'توزيع الأعمال النشطة حسب السجل الهندسي' : 'Active Backlog Distribution by Register'}
            </h4>
            <span className="text-[11px] text-slate-500 font-medium">
              {language === 'ar' ? `${activeRegisters.length} سجل يحتوي على معاملات نشطة` : `${activeRegisters.length} registers with active items`}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {activeRegisters.map(reg => {
              const regActive = reg.stats.pending + reg.stats.rejectedOpen;
              return (
                <div 
                  key={reg.documentType}
                  className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <span className="font-bold text-xs text-[#203864]">{reg.documentType}</span>
                    <button
                      type="button"
                      onClick={() => openDrillDown(reg.documentType, 'active', `${reg.documentType} — Active Backlog`, `${reg.documentType} — الأعمال النشطة`)}
                      className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold font-mono text-xs hover:bg-amber-200 transition-colors cursor-pointer"
                    >
                      {regActive} {language === 'ar' ? 'نشط' : 'Active'}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1 pt-2 text-center text-[11px]">
                    <div>
                      <span className="block text-[10px] text-slate-400">{language === 'ar' ? 'مرفوض' : 'Rej Open'}</span>
                      <button
                        type="button"
                        onClick={() => openDrillDown(reg.documentType, 'currentRejectedOpen', `${reg.documentType} — Rejected Open`, `${reg.documentType} — مرفوض مفتوح`)}
                        className="font-mono font-bold text-rose-700 hover:underline cursor-pointer"
                      >
                        {reg.stats.rejectedOpen}
                      </button>
                    </div>

                    <div>
                      <span className="block text-[10px] text-slate-400">{language === 'ar' ? 'معلق' : 'Pending'}</span>
                      <button
                        type="button"
                        onClick={() => openDrillDown(reg.documentType, 'pending', `${reg.documentType} — Pending`, `${reg.documentType} — معلق`)}
                        className="font-mono font-bold text-amber-700 hover:underline cursor-pointer"
                      >
                        {reg.stats.pending}
                      </button>
                    </div>

                    <div>
                      <span className="block text-[10px] text-slate-400">{language === 'ar' ? 'متأخر' : 'Overdue'}</span>
                      {reg.stats.overdue > 0 ? (
                        <button
                          type="button"
                          onClick={() => openDrillDown(reg.documentType, 'overdue', `${reg.documentType} — Overdue`, `${reg.documentType} — متأخر`)}
                          className="font-mono font-extrabold text-rose-600 hover:underline cursor-pointer"
                        >
                          {reg.stats.overdue}
                        </button>
                      ) : (
                        <span className="font-mono text-slate-400">0</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
