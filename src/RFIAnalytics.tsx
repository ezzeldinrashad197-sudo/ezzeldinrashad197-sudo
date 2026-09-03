import React, { useMemo } from 'react';
import { SubmittalRow, ProjectSettings } from './types';
import { getRevisionWeight } from './analytics/revisionResolver';
import { getNormalizedStatusCore } from './analytics/analyticsCore';
import { resolveCanonicalTrade } from './analytics/calculationFoundation';
const parseRfiDate = (value?: string): Date | null => {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  // Canonical Excel DD/MM/YYYY or DD-MM-YYYY
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }

    return null;
  }

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
export default function RFIAnalytics(props: { data: SubmittalRow[], monthlyStart?: string, monthlyEnd?: string, projectInfo?: ProjectSettings | null }) {
  const { data, monthlyStart, projectInfo } = props;
  const safeData = Array.isArray(data) ? data : [];
  const projectId = projectInfo?.id || 'default';

  const { cumulativeStats, monthlyStats, cumTotals, monTotals } = useMemo(() => {
    // Filter out only RFI objects
    const rfiData = safeData.filter((row: SubmittalRow) => {
  const family = String(row.workflowFamily || '').trim().toUpperCase();
  const documentType = String(row.documentType || '').trim().toUpperCase();
  const logType = String(row.logType || '').trim().toUpperCase();

  // Primary SSOT classification
  if (family === 'RFI') {
    return true;
  }

  // Controlled legacy fallback only
  return documentType === 'RFI' ||
         logType === 'RFI' ||
         documentType.startsWith('RFI-') ||
         logType.startsWith('RFI-');
});

    const targetMonth = parseRfiDate(monthlyStart) ?? new Date(2026, 4, 1);

const targetYear = targetMonth.getFullYear();
const targetMonthIndex = targetMonth.getMonth();

    const buildStats = (isMonthly: boolean) => {
        const m = new Map<string, Record<string, any>>();
        rfiData.forEach(row => {
            if (isMonthly) {
               const sd = row.submissionDate || row.responseDate;
const dDate = parseRfiDate(sd);

if (!dDate) {
  return;
}

if (
  dDate.getFullYear() !== targetYear ||
  dDate.getMonth() !== targetMonthIndex
) {
  return;
}
            }

            const canonicalTrade = resolveCanonicalTrade(row);

const displayDisc = canonicalTrade.presentationDisc || 'GENERAL';

            if (!m.has(displayDisc)) m.set(displayDisc, { items: displayDisc, rev00: 0, furtherRev: 0, total: 0, pending: 0, closed: 0 });
            const st = m.get(displayDisc)!;

            st.total++;
            const revVal = String(row.rev ?? '').trim().toUpperCase();
            const w = getRevisionWeight(revVal);
            const isRev0 = row.isRev0 ?? (w === 0 && revVal !== 'AS-BUILT' && revVal !== 'IFC');
            if (isRev0) st.rev00++; else st.furtherRev++;

            // Use centralized StatusMatrixEngine normalization through analyticsCore
            const norm = getNormalizedStatusCore(row, projectId, projectInfo);
            const isClosed = norm === 'CLOSED';

            if (isClosed) st.closed++; else st.pending++;
        });

        const arr = Array.from(m.values()).sort((a,b) => b.total - a.total);
        // Sort explicitly by specific order if needed, but total is fine
        const totalLine = {
            items: 'Total',
            rev00: arr.reduce((a,c) => a+c.rev00, 0),
            furtherRev: arr.reduce((a,c) => a+c.furtherRev, 0),
            total: arr.reduce((a,c) => a+c.total, 0),
            pending: arr.reduce((a,c) => a+c.pending, 0),
            closed: arr.reduce((a,c) => a+c.closed, 0)
        };
        return { data: arr, total: totalLine };
    };

    return {
       cumulativeStats: buildStats(false).data,
       cumTotals: buildStats(false).total,
       monthlyStats: buildStats(true).data,
       monTotals: buildStats(true).total
    };
  }, [safeData, monthlyStart, projectId, projectInfo]);

  // Extract month year string for headers
  const targetDateStr = monthlyStart ? new Date(monthlyStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '30 Apr 2026';

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col gap-8">
        
        {/* Monthly Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-900">Monthly RFI Summary</h2>
            <p className="text-xs text-slate-500 mt-1">RFI processed and received this period.</p>
          </div>
          <div className="overflow-x-auto overflow-y-visible" style={{ padding: '4px' }}>
            <div style={{ minWidth: 'max-content', padding: '4px' }}>
            <table className="w-full text-sm text-left" style={{ margin: 0 }}>
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3 text-right">Total Rev.00</th>
                  <th className="px-4 py-3 text-right">Total Further Rev.</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlyStats.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.items}</td>
                    <td className="px-4 py-3 text-right">{row.rev00}</td>
                    <td className="px-4 py-3 text-right">{row.furtherRev}</td>
                    <td className="px-4 py-3 text-right">{row.total}</td>
                    <td className="px-4 py-3 text-right">{row.pending}</td>
                    <td className="px-4 py-3 text-right text-emerald-600">{row.closed}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold text-slate-900 border-t border-slate-200">
                <tr>
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 text-right">{monTotals.rev00}</td>
                  <td className="px-4 py-3 text-right">{monTotals.furtherRev}</td>
                  <td className="px-4 py-3 text-right">{monTotals.total}</td>
                  <td className="px-4 py-3 text-right">{monTotals.pending}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{monTotals.closed}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        </div>

        {/* Cumulative Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-900">Cumulative RFI Summary (Project to date)</h2>
            <p className="text-xs text-slate-500 mt-1">Status of all RFIs over the project lifecycle.</p>
          </div>
          <div className="overflow-x-auto overflow-y-visible" style={{ padding: '4px' }}>
            <div style={{ minWidth: 'max-content', padding: '4px' }}>
            <table className="w-full text-sm text-left" style={{ margin: 0 }}>
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3 text-right">Total Rev.00</th>
                  <th className="px-4 py-3 text-right">Total Further Rev.</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cumulativeStats.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.items}</td>
                    <td className="px-4 py-3 text-right">{row.rev00}</td>
                    <td className="px-4 py-3 text-right">{row.furtherRev}</td>
                    <td className="px-4 py-3 text-right">{row.total}</td>
                    <td className="px-4 py-3 text-right">{row.pending}</td>
                    <td className="px-4 py-3 text-right text-emerald-600">{row.closed}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold text-slate-900 border-t border-slate-200">
                <tr>
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 text-right">{cumTotals.rev00}</td>
                  <td className="px-4 py-3 text-right">{cumTotals.furtherRev}</td>
                  <td className="px-4 py-3 text-right">{cumTotals.total}</td>
                  <td className="px-4 py-3 text-right">{cumTotals.pending}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{cumTotals.closed}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
