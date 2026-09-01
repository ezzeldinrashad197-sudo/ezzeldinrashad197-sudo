import React, { useMemo, useState } from 'react';
import { SubmittalRow, RegisterSequenceAudit } from '../types';
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Download, 
  DatabaseZap, 
  FileText, 
  CheckSquare, 
  Search, 
  Copy, 
  Check, 
  Layers, 
  ShieldCheck, 
  ShieldAlert, 
  ArrowRight,
  Sparkles,
  Filter,
  Eye
} from 'lucide-react';
import { getStatusCodeCategory, parseDateTimestamp } from '../utils/calculations';
import { getPerformanceValidationRows } from '../analytics/calculationFoundation';
import { compareRevisions } from '../analytics/analyticsCore';
import { getRevisionWeight } from '../analytics/revisionResolver';
import { 
  runComprehensiveSequenceAudit, 
  generateForensicLifecycleLedger,
  auditRegisterSequence
} from '../analytics/sequenceAuditEngine';

const getNormalizedRevision = (rev?: string | number, isRev0?: boolean): string => {
    if (rev === undefined || rev === null) {
        return isRev0 ? '0' : 'Unknown';
    }
    const r = String(rev).trim().toUpperCase();
    if (r === '00' || r === '0' || r === 'REV0' || r === 'REV00' || r === 'REV.0' || r === 'REV.00' || r === '') {
        return '0';
    }
    let cleaned = r.replace(/^REV\.?\s*/, '');
    if (cleaned === '00' || cleaned === '0' || cleaned === '') {
        return '0';
    }
    if (/^0+[1-9]\d*$/.test(cleaned)) {
        cleaned = cleaned.replace(/^0+/, '');
    }
    return cleaned;
};

interface Props {
    data: SubmittalRow[];
}

export default function DataValidationEngine({ data }: Props) {
    const [activeTab, setActiveTab] = useState<'sequence_audit' | 'audit_report' | 'anomalies' | 'forensic_ledger'>('sequence_audit');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRegisterFilter, setSelectedRegisterFilter] = useState<string>('ALL');
    const [copiedDocId, setCopiedDocId] = useState<string | null>(null);
    const [copiedAllMissing, setCopiedAllMissing] = useState(false);
    const [selectedRegisterDetails, setSelectedRegisterDetails] = useState<RegisterSequenceAudit | null>(null);

    // 1. Comprehensive Sequence Audit
    const sequenceAuditResult = useMemo(() => {
        return runComprehensiveSequenceAudit(data);
    }, [data]);

    // 2. Forensic Lifecycle Ledger
    const forensicLedger = useMemo(() => {
        return generateForensicLifecycleLedger(data);
    }, [data]);

    // 3. Workflow Audit Rows
    const auditRows = useMemo(() => {
        return getPerformanceValidationRows(data);
    }, [data]);

    const auditSummary = useMemo(() => {
        let approved = 0;
        let pending = 0;
        let rejectedOpen = 0;
        let rejectedClosed = 0;
        auditRows.forEach(r => {
            if (r.resolvedStatus === 'APPROVED') approved++;
            else if (r.resolvedStatus === 'REJECTED_OPEN') rejectedOpen++;
            else if (r.resolvedStatus === 'REJECTED_CLOSED') rejectedClosed++;
            else pending++;
        });
        return { total: auditRows.length, approved, pending, rejectedOpen, rejectedClosed };
    }, [auditRows]);

    // 4. Data Quality & Anomaly Checks
    const { score, errors, categories } = useMemo(() => {
        let totalChecks = 0;
        let failedChecks = 0;
        const errs: any[] = [];
        const cats = {
            missingFields: 0,
            dateLogic: 0,
            statusLogic: 0,
            revisionLogic: 0,
            duplicates: 0,
            other: 0,
        };

        const docHistory: Record<string, SubmittalRow[]> = {};
        const exactRecordMap: Map<string, SubmittalRow> = new Map();

        data.forEach(row => {
            const rowRef = row.docNo || row.ncrRef || row.sorRef || row.normalizedRef || row.id;
            
            if (rowRef && rowRef !== 'Unknown') {
                if (!docHistory[rowRef]) docHistory[rowRef] = [];
                docHistory[rowRef].push(row);
                
                const normRev = getNormalizedRevision(row.rev, row.isRev0);
                const exactKey = `${rowRef}_${normRev}`;
                
                if (exactRecordMap.has(exactKey)) {
                    const existingRow = exactRecordMap.get(exactKey)!;
                    const existingStatus = (existingRow.status || existingRow.recordStatus || '').trim().toUpperCase();
                    const currentStatus = (row.status || row.recordStatus || '').trim().toUpperCase();
                    
                    if (existingStatus && currentStatus && existingStatus !== currentStatus) {
                        failedChecks++; 
                        cats.duplicates++; 
                        errs.push({ 
                            ref: rowRef, 
                            type: 'Revision Conflict', 
                            desc: `Critical Conflict: Same revision (${normRev || 'N/A'}) found with conflicting statuses: "${existingRow.status || 'N/A'}" vs "${row.status || 'N/A'}"` 
                        });
                        totalChecks++;
                    } else {
                        failedChecks++; 
                        cats.duplicates++; 
                        errs.push({ 
                            ref: rowRef, 
                            type: 'Duplicate Record', 
                            desc: `Duplicate entry found for revision ${row.rev || normRev}` 
                        });
                        totalChecks++;
                    }
                } else {
                    exactRecordMap.set(exactKey, row);
                }
            }

            // 1. Missing Fields
            totalChecks += 4;
            if (!rowRef) { failedChecks++; cats.missingFields++; errs.push({ ref: 'Unknown', type: 'Missing ID/DocNo', desc: 'Row has no reference number' }); }
            if (row.rev === undefined && !row.isRev0) { failedChecks++; cats.missingFields++; errs.push({ ref: rowRef || 'Unknown', type: 'Missing Revision', desc: 'No revision provided' }); }
            if (!row.status && !row.recordStatus && !row.ncrStatus && !row.sorStatus) { failedChecks++; cats.missingFields++; errs.push({ ref: rowRef || 'Unknown', type: 'Missing Status', desc: 'No status code or text provided' }); }
            if (!row.submissionDate) { failedChecks++; cats.missingFields++; errs.push({ ref: rowRef || 'Unknown', type: 'Missing Submit Date', desc: 'No submission date available' }); }

            // 2. Date Logic
            totalChecks += 2;
            const subD = row.submissionDate ? new Date(row.submissionDate) : null;
            const resD = row.responseDate ? new Date(row.responseDate) : null;
            
            if (subD && resD && resD < subD) {
                failedChecks++; cats.dateLogic++; errs.push({ ref: rowRef || 'Unknown', type: 'Date Inconsistency', desc: `Response date (${row.responseDate}) is before submission date (${row.submissionDate})` });
            }
            if (subD && subD > new Date()) {
                failedChecks++; cats.dateLogic++; errs.push({ ref: rowRef || 'Unknown', type: 'Future Submission', desc: `Submission date (${row.submissionDate}) is in the future` });
            }

            // 3. Status Logic
            totalChecks += 1;
            const statusCat = getStatusCodeCategory(row);
            if (statusCat === 'UNCLASSIFIED' || (statusCat as string) === 'UNKNOWN') {
                failedChecks++; cats.statusLogic++; errs.push({ ref: rowRef || 'Unknown', type: 'Unclassified Status', desc: `Status code/text "${row.status || (row as any).recordStatus || ''}" is unrecognized` });
            }
        });

        // 4. Revision Logic
        Object.keys(docHistory).forEach(ref => {
            const rows = docHistory[ref];
            if (rows.length > 1) {
                totalChecks += (rows.length - 1);
                const revs = rows.map(r => getNormalizedRevision(r.rev, r.isRev0)).filter(r => r !== 'Unknown');
                revs.sort((a, b) => compareRevisions(a, b));
                
                for (let i = 1; i < revs.length; i++) {
                    const prev = revs[i-1];
                    const curr = revs[i];
                    if (prev === curr) continue;
                    
                    if (prev.length === 1 && curr.length === 1 && /[A-Z]/.test(prev) && /[A-Z]/.test(curr)) {
                        const dist = curr.charCodeAt(0) - prev.charCodeAt(0);
                        if (dist > 1) {
                            failedChecks++; cats.revisionLogic++; errs.push({ ref, type: 'Missing Revision', desc: `Skipped revision from ${prev} to ${curr}` });
                        } else if (dist < 0) {
                            failedChecks++; cats.revisionLogic++; errs.push({ ref, type: 'Revision Regression', desc: `Revision reverted from ${prev} to ${curr}` });
                        }
                    } else if (/[0-9]+/.test(prev) && /[0-9]+/.test(curr)) {
                         const prevNum = getRevisionWeight(prev);
                         const currNum = getRevisionWeight(curr);
                         const dist = currNum - prevNum;
                         if (dist > 1) {
                            failedChecks++; cats.revisionLogic++; errs.push({ ref, type: 'Missing Revision', desc: `Skipped revision from ${prev} to ${curr}` });
                        } else if (dist < 0) {
                            failedChecks++; cats.revisionLogic++; errs.push({ ref, type: 'Revision Regression', desc: `Revision reverted from ${prev} to ${curr}` });
                        }
                    }
                }
            }
        });

        const scoreVal = totalChecks > 0 ? Math.max(0, 100 - (failedChecks / totalChecks) * 100) : 100;

        return {
            score: scoreVal,
            errors: errs,
            categories: cats
        };
    }, [data]);

    const handleCopyDocId = (docNo: string) => {
        navigator.clipboard.writeText(docNo);
        setCopiedDocId(docNo);
        setTimeout(() => setCopiedDocId(null), 2500);
    };

    const handleCopyAllMissing = () => {
        const allIds = sequenceAuditResult.allMissingIds.map(x => x.docNo).join('\n');
        navigator.clipboard.writeText(allIds);
        setCopiedAllMissing(true);
        setTimeout(() => setCopiedAllMissing(false), 2500);
    };

    const handleExport = () => {
        if (activeTab === 'sequence_audit') {
            let csv = '\uFEFFRegister,Prefix,Expected Population,Actual Rev 00,Missing Count,Range From,Range To,Sequence Gaps,Missing Sample IDs\r\n';
            Object.values(sequenceAuditResult.registerAudits).forEach(reg => {
                const gapsStr = reg.sequenceGaps.map(g => g.formattedRange).join('; ');
                const missingStr = reg.missingIds.join('; ');
                csv += `"${reg.docType}","${reg.prefix}",${reg.expectedPopulation},${reg.actualRev0Population},${reg.missingCount},"${reg.prefix}${String(reg.minSequence).padStart(reg.paddingLength, '0')}","${reg.prefix}${String(reg.maxSequence).padStart(reg.paddingLength, '0')}","${gapsStr.replace(/"/g, '""')}","${missingStr.replace(/"/g, '""')}"\r\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Sequence_Integrity_Audit_Report_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } else if (activeTab === 'forensic_ledger') {
            let csv = '\uFEFFRecord Ref,Rev,Document Type,Source File,Parsed Status,Canonical Status,Disposition,Disposition Reason (EN),Disposition Reason (AR)\r\n';
            forensicLedger.forEach(e => {
                csv += `"${(e.docNo || '').replace(/"/g, '""')}","${(e.rev || '').replace(/"/g, '""')}","${(e.docType || '').replace(/"/g, '""')}","${(e.sourceLocation || '').replace(/"/g, '""')}","${(e.parsedStatus || '').replace(/"/g, '""')}","${(e.canonicalStatus || '').replace(/"/g, '""')}","${e.disposition}","${e.dispositionReason.replace(/"/g, '""')}","${e.dispositionReasonAr.replace(/"/g, '""')}"\r\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Forensic_Record_Lifecycle_Ledger_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } else if (activeTab === 'audit_report') {
            let csv = '\uFEFFSubmission Ref,Latest Rev,Submission Date,Latest Status,Resolved Status\r\n';
            auditRows.forEach(r => {
                csv += `"${(r.businessEntityKey || '').replace(/"/g, '""')}","${(r.latestRevision || '').replace(/"/g, '""')}","${r.latestSubmissionDate || ''}","${(r.latestStatus || '').replace(/"/g, '""')}","${r.resolvedStatus}"\r\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Submission_Workflow_Audit_Report_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } else {
            let csv = '\uFEFFRecord Ref,Error Category,Description\r\n';
            errors.forEach(e => {
                csv += `"${(e.ref || '').replace(/"/g, '""')}","${(e.type || '').replace(/"/g, '""')}","${e.desc.replace(/"/g, '""')}"\r\n`;
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Data_Anomalies_Registry_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        }
    };

    const registersList = Object.values(sequenceAuditResult.registerAudits);
    const filteredRegisters = useMemo(() => {
        return registersList.filter(reg => {
            if (selectedRegisterFilter !== 'ALL' && reg.docType !== selectedRegisterFilter) return false;
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return reg.docType.toLowerCase().includes(q) ||
                reg.prefix.toLowerCase().includes(q) ||
                reg.missingIds.some(id => id.toLowerCase().includes(q));
        });
    }, [registersList, selectedRegisterFilter, searchQuery]);

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen">
            {/* 1. Header with Title & Export Actions */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 border-b border-slate-200 pb-6">
                <div>
                    <h1 className="text-3xl font-light text-slate-900 tracking-tight flex items-center gap-3">
                        Integrity & Sequence Control
                        <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2.5 py-1 rounded uppercase tracking-widest border border-purple-200">Forensic SSOT</span>
                    </h1>
                    <p className="text-slate-500 text-sm mt-1 font-medium">
                        Missing-Sequence Detection, Forensic Population Reconciliation & Lifecycle Governance
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {activeTab === 'sequence_audit' && sequenceAuditResult.totalMissingCount > 0 && (
                        <button
                            onClick={handleCopyAllMissing}
                            className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-900 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors font-bold text-xs shadow-sm cursor-pointer"
                        >
                            {copiedAllMissing ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-amber-700" />}
                            {copiedAllMissing ? 'Copied Missing IDs!' : `Copy All Missing IDs (${sequenceAuditResult.totalMissingCount})`}
                        </button>
                    )}
                    <button 
                        onClick={handleExport}
                        className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-bold text-sm shadow-sm cursor-pointer"
                    >
                        <Download className="w-4 h-4" /> 
                        Export ({activeTab === 'sequence_audit' ? 'Sequence Audit CSV' : activeTab === 'forensic_ledger' ? 'Forensic Ledger CSV' : activeTab === 'audit_report' ? 'Audit CSV' : 'Anomalies CSV'})
                    </button>
                </div>
            </div>

            {/* 2. TOP POPULATION RECONCILIATION SUMMARY BANNER */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-2xl shadow-lg border border-indigo-800/40 mb-8">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                    <div className="flex items-start gap-4">
                        <div className={`p-3.5 rounded-xl shrink-0 ${sequenceAuditResult.totalMissingCount === 0 ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400' : 'bg-amber-500/20 border border-amber-500/40 text-amber-400'}`}>
                            {sequenceAuditResult.totalMissingCount === 0 ? <ShieldCheck className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-bold tracking-tight text-white">
                                    Population Reconciliation & Missing Sequence Control
                                </h2>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
                                    sequenceAuditResult.totalMissingCount === 0 
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
                                        : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                }`}>
                                    {sequenceAuditResult.totalMissingCount === 0 ? '100% Sequence Reconciled' : `${sequenceAuditResult.totalMissingCount} Missing Sequence IDs`}
                                </span>
                            </div>
                            <p className="text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                                {sequenceAuditResult.summaryNarrative}
                            </p>
                            <p className="text-xs text-amber-200/90 mt-1 font-arabic" dir="rtl">
                                {sequenceAuditResult.summaryNarrativeAr}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 bg-white/10 p-4 rounded-xl border border-white/10 shrink-0 w-full lg:w-auto">
                        <div className="text-center px-2">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Expected Rev 00</span>
                            <span className="text-2xl font-black text-white font-mono">{sequenceAuditResult.totalExpectedPopulation}</span>
                        </div>
                        <div className="text-center px-2 border-x border-white/10">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actual Rev 00</span>
                            <span className="text-2xl font-black text-indigo-300 font-mono">{sequenceAuditResult.totalActualRev0Population}</span>
                        </div>
                        <div className="text-center px-2">
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Missing Delta</span>
                            <span className={`text-2xl font-black font-mono ${sequenceAuditResult.totalMissingCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {sequenceAuditResult.totalMissingCount}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. Primary KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-8">
                <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm text-center">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Quality Score</h3>
                    <div className={`text-5xl font-light ${score >= 95 ? 'text-emerald-500' : score >= 80 ? 'text-amber-500' : 'text-red-500'}`}>
                        {score.toFixed(1)}%
                    </div>
                </div>
                <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm flex flex-col items-center justify-center">
                    <AlertTriangle className={`w-8 h-8 ${sequenceAuditResult.totalMissingCount > 0 ? 'text-rose-500' : 'text-emerald-500'} mb-2`} />
                    <span className="text-3xl font-bold text-slate-900">{sequenceAuditResult.totalMissingCount}</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase text-center mt-1">Missing Expected IDs</span>
                </div>
                <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm flex flex-col items-center justify-center">
                    <DatabaseZap className="w-8 h-8 text-purple-500 mb-2" />
                    <span className="text-3xl font-bold text-slate-900">{sequenceAuditResult.totalFurtherRevWithoutRev0}</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase text-center mt-1">Further Revs without 00</span>
                </div>
                <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm flex flex-col items-center justify-center">
                    <XCircle className="w-8 h-8 text-amber-500 mb-2" />
                    <span className="text-3xl font-bold text-slate-900">{sequenceAuditResult.totalDuplicatesCount}</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase text-center mt-1">Duplicate Submissions</span>
                </div>
                <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm flex flex-col items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                    <span className="text-3xl font-bold text-slate-900">{data.length}</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase text-center mt-1">Total Workload Rows</span>
                </div>
            </div>

            {/* 4. Tab Navigation & Content Container */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col min-h-[680px]">
                {/* Navigation Bar */}
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => setActiveTab('sequence_audit')}
                            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                                activeTab === 'sequence_audit'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <ShieldCheck className="w-4 h-4" />
                            Missing-Sequence Audit ({sequenceAuditResult.totalMissingCount} Missing)
                        </button>
                        <button
                            onClick={() => setActiveTab('audit_report')}
                            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                                activeTab === 'audit_report'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <FileText className="w-4 h-4" />
                            Workflow Audit Report ({auditRows.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('anomalies')}
                            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                                activeTab === 'anomalies'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <AlertTriangle className="w-4 h-4" />
                            Anomaly Registry ({errors.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('forensic_ledger')}
                            className={`px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${
                                activeTab === 'forensic_ledger'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            <Layers className="w-4 h-4" />
                            Forensic Lifecycle Ledger ({forensicLedger.length})
                        </button>
                    </div>

                    {/* Filter / Search Bar */}
                    <div className="flex items-center gap-3">
                        {activeTab === 'sequence_audit' && (
                            <div className="relative">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    placeholder="Search register or missing ID..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none w-60"
                                />
                            </div>
                        )}
                        {activeTab === 'audit_report' && (
                            <div className="flex items-center gap-4 text-xs font-bold text-slate-700 bg-slate-100 px-4 py-2 rounded-lg border border-slate-200">
                                <span>Approved: <strong className="text-emerald-600">{auditSummary.approved}</strong></span>
                                <span>Pending: <strong className="text-amber-600">{auditSummary.pending}</strong></span>
                                <span>Rej. Open: <strong className="text-red-600">{auditSummary.rejectedOpen}</strong></span>
                                <span>Rej. Closed: <strong className="text-purple-600">{auditSummary.rejectedClosed}</strong></span>
                                <span>Total Unique: <strong className="text-indigo-600">{auditSummary.total}</strong></span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 5. TAB 1: MISSING-SEQUENCE AUDIT */}
                {activeTab === 'sequence_audit' && (
                    <div className="flex-1 p-6 overflow-y-auto">
                        <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-indigo-600" />
                                Population Reconciliation Governance Rule: Count alone is not sufficient
                            </h3>
                            <p className="text-xs text-slate-600 leading-relaxed">
                                The engine verifies the sequential continuity of each register from <span className="font-mono font-bold text-slate-800">Min Sequence → Max Sequence</span>. Any missing sequence number, gaps in Rev.00, or items appearing only in subsequent revisions without Rev.00 are explicitly flagged and attributed.
                            </p>
                        </div>

                        <div className="space-y-6">
                            {filteredRegisters.map((reg, idx) => (
                                <div key={idx} className="border border-slate-200 rounded-xl p-5 bg-white shadow-sm hover:border-indigo-300 transition-all">
                                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4 pb-4 border-b border-slate-100">
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-lg font-bold text-slate-900 font-mono">{reg.docType}</span>
                                                <span className="text-xs px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded font-mono font-bold border border-slate-200">
                                                    Range: {reg.prefix}{String(reg.minSequence).padStart(reg.paddingLength, '0')} → {reg.prefix}{String(reg.maxSequence).padStart(reg.paddingLength, '0')}
                                                </span>
                                                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${
                                                    reg.isSequenceFullyReconciled
                                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                                }`}>
                                                    {reg.isSequenceFullyReconciled ? 'Reconciled 100%' : `${reg.missingCount} Missing Sequence Numbers`}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-600 mt-1 font-medium">
                                                {reg.deltaExplanation}
                                            </p>
                                            <p className="text-xs text-indigo-900 mt-0.5 font-arabic" dir="rtl">
                                                {reg.deltaExplanationAr}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-6 bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-200 shrink-0 text-xs">
                                            <div>
                                                <span className="block text-[10px] font-bold text-slate-400 uppercase">Expected</span>
                                                <span className="font-bold text-slate-900 text-sm font-mono">{reg.expectedPopulation}</span>
                                            </div>
                                            <div className="border-l border-slate-200 pl-4">
                                                <span className="block text-[10px] font-bold text-slate-400 uppercase">Actual Rev 00</span>
                                                <span className="font-bold text-indigo-600 text-sm font-mono">{reg.actualRev0Population}</span>
                                            </div>
                                            <div className="border-l border-slate-200 pl-4">
                                                <span className="block text-[10px] font-bold text-slate-400 uppercase">Further Revs</span>
                                                <span className="font-bold text-purple-600 text-sm font-mono">{reg.furtherRevRows}</span>
                                            </div>
                                            <div className="border-l border-slate-200 pl-4">
                                                <span className="block text-[10px] font-bold text-slate-400 uppercase">Missing</span>
                                                <span className={`font-bold text-sm font-mono ${reg.missingCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                    {reg.missingCount}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Missing IDs & Gaps Breakdown */}
                                    {reg.missingCount > 0 && (
                                        <div className="bg-rose-50/60 border border-rose-200 p-4 rounded-lg mt-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-bold text-rose-900 uppercase tracking-wider flex items-center gap-2">
                                                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                                                    Missing Document Numbers in Sequence ({reg.missingCount}):
                                                </span>
                                                <span className="text-[11px] text-rose-700 font-medium">Click ID to copy</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {reg.missingIds.map((mid, mIdx) => (
                                                    <button
                                                        key={mIdx}
                                                        onClick={() => handleCopyDocId(mid)}
                                                        className="px-2.5 py-1 bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 rounded font-mono text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                                        title="Click to copy ID"
                                                    >
                                                        {copiedDocId === mid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3 h-3 text-rose-400" />}
                                                        {mid}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Further Revisions without Rev 00 */}
                                    {reg.furtherRevWithoutRev0.length > 0 && (
                                        <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-lg mt-3">
                                            <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block mb-2">
                                                Submittals First Recorded at Further Revisions ({reg.furtherRevWithoutRev0.length}):
                                            </span>
                                            <div className="flex flex-wrap gap-2">
                                                {reg.furtherRevWithoutRev0.map((fItem, fIdx) => (
                                                    <span key={fIdx} className="px-2.5 py-1 bg-white text-amber-900 border border-amber-300 rounded font-mono text-xs font-bold">
                                                        {fItem.docNo} <span className="text-slate-400">({fItem.firstRecordedRev})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {filteredRegisters.length === 0 && (
                                <div className="text-center py-12 text-slate-500 font-medium">
                                    No registers found matching your search.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 6. TAB 2: SUBMISSION WORKFLOW AUDIT REPORT */}
                {activeTab === 'audit_report' && (
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-[10px] text-slate-500 uppercase bg-white sticky top-0 tracking-widest">
                                <tr>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Submission Ref</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Latest Rev</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Submission Date</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Latest Status</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Counted As (Resolved Status)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {auditRows.map((r, i) => (
                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-mono font-bold text-slate-900">{r.businessEntityKey}</td>
                                        <td className="px-6 py-4 font-mono text-slate-700">{r.latestRevision}</td>
                                        <td className="px-6 py-4 text-slate-600">{r.latestSubmissionDate || '-'}</td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-slate-100 text-slate-800 border border-slate-200">
                                                {r.latestStatus || 'Pending/W'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border ${
                                                r.resolvedStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                r.resolvedStatus === 'REJECTED_OPEN' ? 'bg-red-50 text-red-700 border-red-200' :
                                                r.resolvedStatus === 'REJECTED_CLOSED' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                                'bg-amber-50 text-amber-700 border-amber-200'
                                            }`}>
                                                {r.resolvedStatus}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {auditRows.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-500 font-medium">No submission records found.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* 7. TAB 3: ANOMALY REGISTRY */}
                {activeTab === 'anomalies' && (
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-[10px] text-slate-500 uppercase bg-white sticky top-0 tracking-widest">
                                <tr>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Record Ref</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Error Category</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Description</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {errors.map((err, i) => (
                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-mono font-bold text-slate-900">{err.ref}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border ${
                                                err.type.includes('Duplicate') || err.type.includes('Revision') 
                                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                                : err.type.includes('Date') || err.type.includes('Status')
                                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                : 'bg-red-50 text-red-700 border-red-200'
                                            }`}>
                                                {err.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 font-medium">{err.desc}</td>
                                    </tr>
                                ))}
                                {errors.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="px-6 py-12 text-center text-slate-500 font-medium">No anomalies detected. Data passes validation.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* 8. TAB 4: FORENSIC LIFECYCLE LEDGER */}
                {activeTab === 'forensic_ledger' && (
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-[10px] text-slate-500 uppercase bg-white sticky top-0 tracking-widest">
                                <tr>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Doc Ref</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Rev</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Type</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Lifecycle Disposition</th>
                                    <th className="px-6 py-4 font-bold border-b border-slate-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">Audit Disposition Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {forensicLedger.map((f, i) => (
                                    <tr key={i} className={`hover:bg-slate-50 transition-colors ${f.disposition === 'MISSING_EXPECTED_GAP' ? 'bg-rose-50/40' : ''}`}>
                                        <td className="px-6 py-4 font-mono font-bold text-slate-900">{f.docNo}</td>
                                        <td className="px-6 py-4 font-mono text-slate-700">{f.rev}</td>
                                        <td className="px-6 py-4 font-mono text-xs text-slate-600">{f.docType}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border ${
                                                f.disposition === 'SSOT_ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                f.disposition === 'SUPERSEDED_HISTORICAL' ? 'bg-slate-100 text-slate-700 border-slate-300' :
                                                f.disposition === 'MISSING_EXPECTED_GAP' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                'bg-amber-50 text-amber-700 border-amber-200'
                                            }`}>
                                                {f.disposition}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-slate-600">
                                            <div>{f.dispositionReason}</div>
                                            <div className="text-slate-400 font-arabic mt-0.5" dir="rtl">{f.dispositionReasonAr}</div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
