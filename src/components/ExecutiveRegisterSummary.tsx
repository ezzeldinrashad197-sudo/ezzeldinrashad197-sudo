import React from 'react';
import { Eye, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { KPIStats } from '../types';

export interface RegisterItem {
  documentType: string;
  stats: KPIStats;
  criticalCount: number;
}

interface ExecutiveRegisterSummaryProps {
  byDocType: RegisterItem[];
  globalStats: KPIStats;
  openDrillDown: (
    docTypeFilter: string,
    metricKey: string,
    metricLabel: string,
    metricLabelAr: string
  ) => void;
  getRegisterHealth: (stats: KPIStats) => {
    labelEn: string;
    labelAr: string;
    badgeClass: string;
    dotClass: string;
  };
  language: 'ar' | 'en';
}

export const ExecutiveRegisterSummary: React.FC<ExecutiveRegisterSummaryProps> = ({
  byDocType,
  globalStats,
  openDrillDown,
  getRegisterHealth,
  language
}) => {
  return (
    <div id="level1-executive-summary" className="space-y-4 print:break-inside-avoid">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-extrabold uppercase tracking-wider bg-[#203864] text-white">
              Level 1 — Executive Intelligence
            </span>
            <span className="text-xs text-slate-500 font-medium">Current State / Unique Item Grain</span>
          </div>
          <h3 className="text-lg font-bold text-[#203864] mt-1">
            {language === 'ar' ? 'ملخص ذكاء السجلات الهندسية (الوضع الحالي للبنود الفريدة)' : 'Primary Register Intelligence Summary'}
          </h3>
          <p className="text-xs text-slate-500 font-normal">
            {language === 'ar'
              ? 'مؤشرات الأداء التنفيذية ومستوى الامتثال لكل سجل هندسي وفقاً لحالة البنود الفريدة الحالية دون دمج لأحجام العمل التاريخية.'
              : 'Certified current-state deliverable population, active backlog, approval ratios, and compliance rating per register.'}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
            {language === 'ar' ? `إجمالي السجلات: ${byDocType.length}` : `Registers: ${byDocType.length}`}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider">
                <th className="px-4 py-3.5 text-left font-extrabold text-[#203864] border-r border-slate-200">
                  {language === 'ar' ? 'السجل الهندسي (Register)' : 'Register'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-slate-800 border-r border-slate-200">
                  {language === 'ar' ? 'إجمالي البنود الفريدة' : 'Unique Items'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-emerald-800 border-r border-slate-200">
                  {language === 'ar' ? 'المعتمد (Approved)' : 'Approved'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-amber-800 border-r border-slate-200">
                  {language === 'ar' ? 'النشط (Active)' : 'Active'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-slate-800 border-r border-slate-200">
                  {language === 'ar' ? 'نسبة الاعتماد' : 'Approval Rate'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-rose-800 border-r border-slate-200">
                  {language === 'ar' ? 'متأخر SLA' : 'Overdue'}
                </th>
                <th className="px-4 py-3.5 text-center font-extrabold text-slate-800">
                  {language === 'ar' ? 'حالة الامتثال' : 'Health'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byDocType.map((row, idx) => {
                const activeCount = row.stats.pending + row.stats.rejectedOpen;
                const health = getRegisterHealth(row.stats);
                return (
                  <tr 
                    key={row.documentType} 
                    className={`hover:bg-blue-50/40 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
                  >
                    {/* Register */}
                    <td className="px-4 py-3 border-r border-slate-100 text-xs font-bold text-[#203864]">
                      <div className="flex items-center gap-2">
                        <span>{row.documentType}</span>
                        <button
                          type="button"
                          onClick={() => openDrillDown(row.documentType, 'totalUnique', `${row.documentType} — All Unique Items`, `${row.documentType} — البنود الفريدة`)}
                          className="text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                          title={language === 'ar' ? 'فحص بنود السجل' : 'Inspect Register Deliverables'}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Unique Items */}
                    <td className="px-4 py-3 border-r border-slate-100 text-xs text-center font-semibold text-slate-800 font-mono">
                      <button
                        type="button"
                        onClick={() => openDrillDown(row.documentType, 'totalUnique', `${row.documentType} — Unique Items`, `${row.documentType} — إجمالي البنود الفريدة`)}
                        className="hover:underline hover:text-blue-700 font-bold cursor-pointer"
                      >
                        {row.stats.totalUniqueDrawings}
                      </button>
                    </td>

                    {/* Approved */}
                    <td className="px-4 py-3 border-r border-slate-100 text-xs text-center font-mono">
                      <button
                        type="button"
                        onClick={() => openDrillDown(row.documentType, 'approved', `${row.documentType} — Approved Deliverables`, `${row.documentType} — البنود المعتمدة`)}
                        className="inline-block px-2.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 transition-colors cursor-pointer"
                      >
                        {row.stats.approved}
                      </button>
                    </td>

                    {/* Active */}
                    <td className="px-4 py-3 border-r border-slate-100 text-xs text-center font-mono">
                      <button
                        type="button"
                        onClick={() => openDrillDown(row.documentType, 'active', `${row.documentType} — Active Backlog`, `${row.documentType} — البنود النشطة`)}
                        className={`inline-block px-2.5 py-0.5 rounded font-bold border transition-colors cursor-pointer ${
                          activeCount > 0 
                            ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200' 
                            : 'bg-slate-50 text-slate-400 border-slate-200'
                        }`}
                      >
                        {activeCount}
                      </button>
                    </td>

                    {/* Approval Rate */}
                    <td className="px-4 py-3 border-r border-slate-100 text-xs text-center font-mono font-bold">
                      <span className={row.stats.approvalRate >= 80 ? 'text-emerald-700 font-extrabold' : 'text-amber-700'}>
                        {row.stats.approvalRate.toFixed(1)}%
                      </span>
                    </td>

                    {/* Overdue */}
                    <td className="px-4 py-3 border-r border-slate-100 text-xs text-center font-mono">
                      {row.stats.overdue > 0 ? (
                        <button
                          type="button"
                          onClick={() => openDrillDown(row.documentType, 'overdue', `${row.documentType} — Overdue SLA Items`, `${row.documentType} — البنود المتأخرة`)}
                          className="inline-block px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold border border-rose-300 transition-colors cursor-pointer"
                        >
                          {row.stats.overdue}
                        </button>
                      ) : (
                        <span className="text-slate-400 font-medium">0</span>
                      )}
                    </td>

                    {/* Health */}
                    <td className="px-4 py-3 text-xs text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${health.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${health.dotClass}`}></span>
                        {language === 'ar' ? health.labelAr : health.labelEn}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#203864] text-white font-extrabold text-xs">
                <td className="px-4 py-3.5 border-r border-slate-700">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'totalUnique', 'All Registered Deliverables', 'كافة البنود الهندسية المسجلة')}
                    className="hover:underline flex items-center gap-1.5 text-left cursor-pointer uppercase tracking-wider"
                  >
                    {language === 'ar' ? 'الإجمالي الكلي (GRAND TOTAL)' : 'GRAND TOTAL'}
                    <Eye className="w-3.5 h-3.5 text-slate-300" />
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-700 text-center font-mono text-white">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'totalUnique', 'All Unique Engineering Items', 'إجمالي البنود الفريدة')}
                    className="hover:underline font-bold cursor-pointer"
                  >
                    {globalStats.totalUniqueDrawings}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-700 text-center font-mono text-emerald-300">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'approved', 'All Approved Items', 'إجمالي البنود المعتمدة')}
                    className="hover:underline font-bold cursor-pointer"
                  >
                    {globalStats.approved}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-700 text-center font-mono text-amber-300">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'active', 'All Active Items (Pending + Rejected Open)', 'إجمالي البنود النشطة')}
                    className="hover:underline font-bold cursor-pointer"
                  >
                    {globalStats.pending + globalStats.rejectedOpen}
                  </button>
                </td>
                <td className="px-4 py-3.5 border-r border-slate-700 text-center font-mono text-emerald-300">
                  {globalStats.approvalRate.toFixed(1)}%
                </td>
                <td className="px-4 py-3.5 border-r border-slate-700 text-center font-mono text-rose-300">
                  <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'overdue', 'All Overdue SLA Items', 'إجمالي المعاملات المتأخرة')}
                    className="hover:underline font-bold cursor-pointer"
                  >
                    {globalStats.overdue}
                  </button>
                </td>
                <td className="px-4 py-3.5 text-center">
                  {(() => {
                    const gh = getRegisterHealth(globalStats);
                    return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20 text-white border border-white/30">
                        <span className={`w-1.5 h-1.5 rounded-full ${gh.dotClass}`}></span>
                        {language === 'ar' ? gh.labelAr : gh.labelEn}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
