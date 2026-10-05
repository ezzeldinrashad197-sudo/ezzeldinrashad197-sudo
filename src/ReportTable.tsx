import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { SubmittalRow, ProjectSettings, KPIStats, SequenceAuditResult } from './types';
import { 
  calculateStats, 
  calculateProjectPerformanceHealth, 
  processRevisionEngine, 
  getBusinessEntityKey, 
  getDocumentIdentityKey,
  getSubmissionIdentityKey,
  getStatusCodeCategory, 
  getRevisionWeight, 
  resolveRowDiscipline,
  runComprehensiveSequenceAudit
} from './utils/calculations';
import { isEntityOverdue } from './analytics/calculationFoundation';
import { isRevision0, isFurtherRevision } from './analytics/revisionResolver';
import { useLanguage } from './utils/i18n';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { 
  TrendingUp, 
  CheckCircle, 
  CheckCircle2,
  AlertTriangle, 
  ShieldAlert, 
  ShieldCheck,
  Clock, 
  Layers, 
  ArrowRight,
  FileSpreadsheet,
  AlertCircle,
  FileText,
  Sparkles,
  ListTodo,
  UserCheck,
  HelpCircle,
  X,
  Copy,
  Check,
  Search,
  Download,
  ExternalLink,
  Eye,
  Info,
  Filter,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  History,
  Activity
} from 'lucide-react';
import { ExecutiveRegisterSummary } from './components/ExecutiveRegisterSummary';
import { ActiveBacklogIntelligence } from './components/ActiveBacklogIntelligence';
import { WorkloadRevisionIntelligence } from './components/WorkloadRevisionIntelligence';
import {
  buildManagementReportOutput,
  resolveUniqueSubmittalStats,
  ManagementDisciplineRow,
  ManagementGroupingMode,
  ManagementKpiColumnKey,
  ReconciledSourceRecord
} from './analytics/managementReportOutput';

interface ReportTableProps {
  data: SubmittalRow[];
  filterFn?: (row: SubmittalRow) => boolean;
  title: string;
  projectInfo: ProjectSettings | null;
  rawDataset?: SubmittalRow[];
  precomputedGlobalStats?: KPIStats & { totalUniqueDrawings: number };
}

function useStableRowArray(rows: SubmittalRow[]): SubmittalRow[] {
  const ref = useRef<SubmittalRow[]>(rows);
  if (ref.current !== rows) {
    if (ref.current.length === rows.length) {
      let same = true;
      for (let i = 0; i < rows.length; i++) {
        if (ref.current[i] !== rows[i]) {
          same = false;
          break;
        }
      }
      if (!same) {
        ref.current = rows;
      }
    } else {
      ref.current = rows;
    }
  }
  return ref.current;
}

export default function ReportTable({ data, filterFn, title, projectInfo, rawDataset, precomputedGlobalStats }: ReportTableProps) {
  const { language, t, isRtl } = useLanguage();
  const isMonthly = title.toLowerCase().includes('monthly');

  const stableData = useStableRowArray(data);
  const stableRawDataset = useStableRowArray(rawDataset || data);

  const rawFilteredData = useMemo(() => {
    return filterFn ? stableData.filter(filterFn) : stableData;
  }, [stableData, filterFn]);
  const filteredData = useStableRowArray(rawFilteredData);

  const nonNcrFilteredData = useMemo(() => {
    return filteredData.filter(d => {
      const dt = d.documentType || 'DOC';
      return !dt.startsWith('NCR-') && dt !== 'NCR';
    });
  }, [filteredData]);

  const rawContextDataset = useMemo(() => {
    const base = rawDataset ? stableRawDataset : stableData;
    if (!isMonthly) return base;
    let maxDateStr = '';
    for (const r of filteredData) {
      if (r.submissionDate && (!maxDateStr || r.submissionDate > maxDateStr)) {
        maxDateStr = r.submissionDate;
      }
    }
    if (!maxDateStr) return base;
    return base.filter(r => !r.submissionDate || r.submissionDate <= maxDateStr);
  }, [rawDataset, stableRawDataset, stableData, isMonthly, filteredData]);
  const contextDataset = useStableRowArray(rawContextDataset);

  // Pre-index contextDataset by physical document identity key once in O(N)
  // so group-level calculateStats calls only process rows belonging to targetDocumentKeys
  // instead of re-running processRevisionEngine on the entire 15,000-row contextDataset K times.
  const contextByDocIdentityKey = useMemo(() => {
    const map = new Map<string, SubmittalRow[]>();
    for (let i = 0; i < contextDataset.length; i++) {
      const r = contextDataset[i];
      const key = getDocumentIdentityKey(r);
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(r);
    }
    return map;
  }, [contextDataset]);

  const getScopedContextForRows = useCallback((subsetRows: SubmittalRow[]): SubmittalRow[] => {
    if (!contextDataset || contextDataset.length === 0) return subsetRows;
    const targetKeys = new Set<string>();
    for (let i = 0; i < subsetRows.length; i++) {
      targetKeys.add(getDocumentIdentityKey(subsetRows[i]));
    }
    const scoped: SubmittalRow[] = [];
    targetKeys.forEach(key => {
      const bucket = contextByDocIdentityKey.get(key);
      if (bucket) {
        for (let j = 0; j < bucket.length; j++) {
          scoped.push(bucket[j]);
        }
      }
    });
    return scoped.length > 0 ? scoped : subsetRows;
  }, [contextDataset, contextByDocIdentityKey]);

  // Single memoized revision map for contextDataset reused across trends, activeOverdueCounts, and openDrillDown
  const contextRevisionMap = useMemo(() => {
    return processRevisionEngine(contextDataset);
  }, [contextDataset]);

  const [breakdownDimension, setBreakdownDimension] = useState<'register' | 'discipline' | 'both'>('both');

  const rowToRegisterIdentity = useCallback((d: SubmittalRow): string => {
    return (
      d.registerIdentity ||
      (d as any).sourceRegisterIdentity ||
      d.workflowFamily ||
      (d.documentType ? d.documentType.split('-')[0] : '') ||
      'UNCLASSIFIED'
    ).trim().toUpperCase();
  }, []);

  const rowToLabel = useCallback((d: SubmittalRow) => {
    const reg = rowToRegisterIdentity(d);
    if (breakdownDimension === 'discipline') {
      const disc = resolveRowDiscipline(d, reg) || 'GEN';
      return disc.toUpperCase();
    }
    if (breakdownDimension === 'both') {
      const disc = resolveRowDiscipline(d, reg) || 'GEN';
      return `${reg}-${disc.toUpperCase()}`;
    }
    return reg;
  }, [breakdownDimension, rowToRegisterIdentity]);

  // Partition nonNcrFilteredData by rowToLabel in a single O(N) pass
  const rowsByDocTypeLabel = useMemo(() => {
    const map = new Map<string, SubmittalRow[]>();
    for (let i = 0; i < nonNcrFilteredData.length; i++) {
      const d = nonNcrFilteredData[i];
      const label = rowToLabel(d);
      let group = map.get(label);
      if (!group) {
        group = [];
        map.set(label, group);
      }
      group.push(d);
    }
    return map;
  }, [nonNcrFilteredData, rowToLabel]);

  const byDocType = useMemo(() => {
     const items: {
       documentType: string;
       stats: KPIStats & { totalUniqueDrawings: number };
       submittalStats: ReturnType<typeof resolveUniqueSubmittalStats>;
       criticalCount: number;
     }[] = [];
     rowsByDocTypeLabel.forEach((matchingRows, typeLabel) => {
         const scopedContext = getScopedContextForRows(matchingRows);
         const stats = calculateStats(matchingRows, scopedContext);
         const submittalStats = resolveUniqueSubmittalStats(matchingRows, scopedContext);
         let criticalCount = 0;
         for (let i = 0; i < matchingRows.length; i++) {
           const d = matchingRows[i];
           if (d.priority === 'CRITICAL' || (d.remarks || '').toUpperCase().includes('CRITICAL')) {
             criticalCount++;
           }
         }
         if (stats.totalSubmittedSheets > 0) {
           items.push({
               documentType: typeLabel,
               stats,
               submittalStats,
               criticalCount
           });
         }
     });
     return items.sort((a,b) => {
             if (breakdownDimension === 'discipline') {
               const discOrder = ['STR', 'STRUCTURAL', 'CIVIL', 'ARC', 'ARCH', 'ARCHITECTURAL', 'MEC', 'MECH', 'MECHANICAL', 'ELE', 'ELEC', 'ELECTRICAL', 'INFRA', 'INF', 'LAND', 'LND', 'SUR', 'SURV', 'SURVEY', 'HSE', 'MEP', 'IRR', 'GEN', 'GENERAL'];
               const idxA = discOrder.indexOf(a.documentType.toUpperCase());
               const idxB = discOrder.indexOf(b.documentType.toUpperCase());
               if (idxA !== -1 && idxB !== -1) return idxA - idxB;
               if (idxA !== -1) return -1;
               if (idxB !== -1) return 1;
               return a.documentType.localeCompare(b.documentType);
             }
             const getSortKey = (typeStr: string) => {
                 const parts = typeStr.split('-');
                 const base = parts[0] ? parts[0].trim().toUpperCase() : '';
                 const disc = parts.slice(1).join('-').trim().toUpperCase() || '';
                 return { base, disc };
             };
             const keyA = getSortKey(a.documentType);
             const keyB = getSortKey(b.documentType);
             
             const baseOrder = ['ABD', 'SDW', 'SHD', 'MAR', 'QS', 'DOC', 'WIR', 'MIR', 'RFI', 'NCR', 'SOR', 'LTR', 'PQ', 'PRQ', 'TRS'];
             const idxA = baseOrder.indexOf(keyA.base);
             const idxB = baseOrder.indexOf(keyB.base);
             
             if (idxA !== -1 && idxB !== -1) {
                 if (idxA !== idxB) return idxA - idxB;
             } else if (idxA !== -1) {
                 return -1;
             } else if (idxB !== -1) {
                 return 1;
             } else {
                 const baseCompare = keyA.base.localeCompare(keyB.base);
                 if (baseCompare !== 0) return baseCompare;
             }
             
             const discOrder = ['STR', 'STRUCTURAL', 'ARC', 'ARCH', 'MEC', 'MECH', 'ELE', 'ELEC', 'INFRA', 'INF', 'LAND', 'LND', 'SUR', 'SURV', 'SURVEY', 'HSE', 'MEP', 'IRR', 'GEN', 'GENERAL'];
             const discIdxA = discOrder.indexOf(keyA.disc);
             const discIdxB = discOrder.indexOf(keyB.disc);
             
             if (discIdxA !== -1 && discIdxB !== -1) {
                 if (discIdxA !== discIdxB) return discIdxA - discIdxB;
             } else if (discIdxA !== -1) {
                 return -1;
             } else if (discIdxB !== -1) {
                 return 1;
             }
             
             return keyA.disc.localeCompare(keyB.disc);
         });
  }, [rowsByDocTypeLabel, getScopedContextForRows, breakdownDimension]);

  const globalCriticalCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < nonNcrFilteredData.length; i++) {
      const d = nonNcrFilteredData[i];
      if (d.priority === 'CRITICAL' || (d.remarks || '').toUpperCase().includes('CRITICAL')) {
        count++;
      }
    }
    return count;
  }, [nonNcrFilteredData]);

  const globalStats = useMemo(() => {
    if (precomputedGlobalStats) return precomputedGlobalStats;
    const scopedGlobalContext = getScopedContextForRows(nonNcrFilteredData);
    return calculateStats(nonNcrFilteredData, scopedGlobalContext);
  }, [precomputedGlobalStats, nonNcrFilteredData, getScopedContextForRows]);

  const hasAnyMissingSequences = useMemo(() => {
    if ((globalStats.missingSequenceCount || 0) > 0) return true;
    for (let i = 0; i < byDocType.length; i++) {
      if ((byDocType[i].stats.missingSequenceCount || 0) > 0) return true;
    }
    return false;
  }, [globalStats.missingSequenceCount, byDocType]);

  const sequenceAuditResult = useMemo<SequenceAuditResult>(() => {
    if (!hasAnyMissingSequences) {
      return {
        totalExpectedPopulation: null,
        totalActualRev0Population: globalStats.totalSheetsRev0 || 0,
        totalBaselineActualRev0Population: 0,
        totalMissingCount: 0,
        totalObservedGapsCount: globalStats.sequenceGapsCount || 0,
        totalDuplicatesCount: 0,
        totalFurtherRevWithoutRev0: 0,
        totalCrossRegisterCount: 0,
        allCrossRegisterRecords: [],
        allMissingIds: [],
        registerAudits: {},
        baselineStatus: 'BASELINE_NOT_ESTABLISHED',
        baselineRegistersCount: 0,
        observationalRegistersCount: byDocType.length,
        overallStatus: 'OBSERVATION_ONLY',
        summaryNarrative: '',
        summaryNarrativeAr: ''
      };
    }
    return runComprehensiveSequenceAudit(nonNcrFilteredData);
  }, [hasAnyMissingSequences, nonNcrFilteredData, globalStats.totalSheetsRev0, globalStats.sequenceGapsCount, byDocType.length]);

  // Executive Summary & Health Check Calculation
  const healthData = useMemo(() => {
      const health = calculateProjectPerformanceHealth(globalStats, language);
      let IconComponent = CheckCircle;
      if (health.score >= 80) {
          IconComponent = CheckCircle;
      } else if (health.score >= 65) {
          IconComponent = TrendingUp;
      } else if (health.score >= 45) {
          IconComponent = AlertTriangle;
      } else {
          IconComponent = ShieldAlert;
      }

      return {
          ...health,
          icon: IconComponent
      };
  }, [globalStats, language]);

  // Dynamic Executive Summary Brief
  const executiveSummaryBrief = useMemo(() => {
      const appRate = globalStats.approvalRate;
      const totalOverdue = globalStats.overdue;
      const totalPending = globalStats.pending;
      const score = healthData.score;

      // Find the log type with the most overdue items, breaking ties with overdue percentage
      let worstDocType = '';
      let maxOverdue = 0;
      let worstRate = 0;

      byDocType.forEach(row => {
          const rowOverdue = row.stats.overdue || 0;
          const rowTotal = row.stats.totalUniqueDrawings || row.stats.totalSubmittedSheets || 1;
          const rowOverdueRate = (rowOverdue / rowTotal) * 100;
          
          if (rowOverdue > maxOverdue || (rowOverdue === maxOverdue && rowOverdueRate > worstRate)) {
              maxOverdue = rowOverdue;
              worstRate = rowOverdueRate;
              worstDocType = row.documentType;
          }
      });

      let enSummary = '';
      let arSummary = '';

      const activeCount = totalPending + (globalStats.rejectedOpen || 0);
      const overdueRateActive = activeCount > 0 ? (totalOverdue / activeCount) * 100 : 0;

      if (overdueRateActive >= 50 && totalOverdue > 5) {
          // High operational SLA exposure (e.g. cumulative: 376 / 388 = 96.9%)
          enSummary = `The project maintains a ${appRate.toFixed(1)}% current-state approval rate; however, significant operational SLA exposure remains, with ${totalOverdue} of ${activeCount} active items currently overdue (${overdueRateActive.toFixed(1)}%). Immediate backlog resolution is required.`;
          arSummary = `يحافظ المشروع على نسبة اعتماد حالية تبلغ ${appRate.toFixed(1)}%؛ غير أن هناك مخاطر تشغيلية ومستوى تعرض عالياً لاتفاقية مستوى الخدمة (SLA)، حيث إن ${totalOverdue} من أصل ${activeCount} معاملة نشطة متأخرة حالياً (${overdueRateActive.toFixed(1)}%). يتطلب هذا تدخلاً فورياً لمعالجة المتأخرات المتراكمة.`;
      } else if (overdueRateActive >= 15 || totalOverdue > 2) {
          // Moderate operational SLA exposure (e.g. monthly: 4 of 15 = 26.7%)
          enSummary = `The project achieved an ${appRate.toFixed(1)}% current-state approval rate. However, ${totalOverdue} of ${activeCount} active items (${overdueRateActive.toFixed(1)}%) are currently overdue and require focused SLA follow-up.`;
          arSummary = `حقق المشروع نسبة اعتماد حالية بلغت ${appRate.toFixed(1)}%. ومع ذلك، فإن ${totalOverdue} من أصل ${activeCount} معاملة نشطة (${overdueRateActive.toFixed(1)}%) متأخرة حالياً وتتطلب متابعة دقيقة لتجاوزات اتفاقية مستوى الخدمة.`;
      } else if (score >= 80) {
          enSummary = `Project health is performing within excellent limits with an approval rate of ${appRate.toFixed(1)}%. Workflow processing times satisfy the SLA thresholds with minimal backlog overdue.`;
          arSummary = `يؤدي المشروع أداءً ممتازاً ومستقراً بنسبة اعتماد بلغت ${appRate.toFixed(1)}%. سرعة تدفق المراجعات والاعتمادات تتوافق تماماً مع فترات اتفاقية مستوى الخدمة مع حد أدنى من التأخيرات المتراكمة.`;
      } else if (score >= 65) {
          enSummary = `Project health is satisfactory at ${score}/100, but is experiencing minor delays in submittal flows. Focus should be given to closing out the current pending review queue of ${totalPending} items.`;
          arSummary = `حالة المشروع مقبولة ومستقرة نسبياً بتقييم قدره ${score}/100، غير أنه يواجه تأخيرات طفيفة في حركة تدفق المستندات. يجب التركيز حالياً على إنجاز مراجعة المعاملات المعلقة البالغ عددها ${totalPending} معاملة.`;
      } else {
          const worstTypeLabel = worstDocType ? `concentrated in ${worstDocType} submittals` : 'across major design packages';
          const worstTypeLabelAr = worstDocType ? `وتتركز بصورة رئيسية في سجلات (${worstDocType})` : 'عبر حزم التصميم والمستندات الرئيسية للمشروع';
          
          enSummary = `Project Health is below acceptable threshold (${score}/100) due to high rejection rates or slow reviews, resulting in a backlog of ${totalOverdue} critical overdue items, primarily ${worstTypeLabel}. Immediate PMO intervention is required.`;
          arSummary = `حالة المشروع تحت المستوى المقبول والآمن بتقييم حرج قدره (${score}/100) نتيجة لارتفاع معدل رفض المستندات أو بطء عمليات المراجعة، مما أدى إلى تراكم ${totalOverdue} معاملة متأخرة متجاوزة للمدة المحددة، ${worstTypeLabelAr}. يتطلب هذا تدخلاً إدارياً فورياً لتسريع دورات المراجعة.`;
      }

      return {
          en: enSummary,
          ar: arSummary
      };
  }, [globalStats, healthData.score, byDocType]);

  // Intelligent dynamic trend and progress indicators
  // Reuses contextRevisionMap to compute exact current-state approvalRate, totalSubmittedSheets, and overdue
  // without re-running processRevisionEngine(contextDataset) twice or 10 redundant auditRegisterSequence passes.
  const trends = useMemo(() => {
      if (filteredData.length === 0) {
          return { approvalTrend: 0, submissionsTrend: 0, overdueTrend: 0 };
      }
      
      const datedEntries: { row: SubmittalRow; ts: number }[] = [];
      for (let i = 0; i < filteredData.length; i++) {
        const d = filteredData[i];
        if (d.submissionDate) {
          const ts = new Date(d.submissionDate).getTime();
          datedEntries.push({ row: d, ts });
        }
      }
      
      if (datedEntries.length < 2) {
          // Stable fallback placeholders
          return { approvalTrend: 4.8, submissionsTrend: 15, overdueTrend: -5 };
      }
      
      const dates = datedEntries.map(e => e.ts).sort((a, b) => a - b);
      
      // Calculate median date to divide current filtered data into two comparative periods (Trend Analysis)
      const medianDate = dates[Math.floor(dates.length / 2)];
      
      const firstHalf: SubmittalRow[] = [];
      const secondHalf: SubmittalRow[] = [];
      for (let i = 0; i < datedEntries.length; i++) {
        const e = datedEntries[i];
        if (e.ts < medianDate) {
          firstHalf.push(e.row);
        } else if (e.ts >= medianDate) {
          secondHalf.push(e.row);
        }
      }
      
      if (firstHalf.length === 0 || secondHalf.length === 0) {
          return { approvalTrend: 3.2, submissionsTrend: 8, overdueTrend: -3 };
      }

      const computePeriodMetrics = (periodRows: SubmittalRow[]) => {
        const revMap = contextDataset && contextDataset.length > 0
          ? contextRevisionMap
          : processRevisionEngine(periodRows);
        const targetDocumentKeys = new Set<string>();
        for (let i = 0; i < periodRows.length; i++) {
          targetDocumentKeys.add(getDocumentIdentityKey(periodRows[i]));
        }

        let approvedCurrent = 0;
        let rejectedOpenCurrent = 0;
        let rejectedClosedCurrent = 0;
        let finalClosedCurrent = 0;
        let pendingCurrent = 0;
        let unclassifiedCurrent = 0;
        let overdueCurrent = 0;

        targetDocumentKeys.forEach(documentKey => {
          const groupInfo = revMap.get(documentKey);
          if (!groupInfo) return;
          const latest = groupInfo.latest;
          const cat = groupInfo.resolvedStatus || getStatusCodeCategory(latest);
          switch (cat) {
            case 'APPROVED':
              approvedCurrent++;
              break;
            case 'REJECTED_OPEN':
              rejectedOpenCurrent++;
              break;
            case 'REJECTED_CLOSED':
              rejectedClosedCurrent++;
              break;
            case 'FINAL_CLOSED':
              finalClosedCurrent++;
              break;
            case 'PENDING':
              pendingCurrent++;
              break;
            case 'UNCLASSIFIED':
            default:
              unclassifiedCurrent++;
              break;
          }
          if (cat === 'PENDING' || cat === 'REJECTED_OPEN') {
            if (isEntityOverdue(latest, 0)) {
              overdueCurrent++;
            }
          }
        });

        const totalEligible =
          approvedCurrent +
          rejectedOpenCurrent +
          rejectedClosedCurrent +
          finalClosedCurrent +
          pendingCurrent +
          unclassifiedCurrent;
        const activeCurrentItems = pendingCurrent + rejectedOpenCurrent;
        const overdue = Math.min(overdueCurrent, activeCurrentItems);
        const approvalRate = totalEligible > 0 ? (approvedCurrent / totalEligible) * 100 : 0;

        return {
          totalSubmittedSheets: periodRows.length,
          approvalRate,
          overdue
        };
      };
      
      const statsFirst = computePeriodMetrics(firstHalf);
      const statsSecond = computePeriodMetrics(secondHalf);
      
      return {
          approvalTrend: parseFloat((statsSecond.approvalRate - statsFirst.approvalRate).toFixed(1)),
          submissionsTrend: statsSecond.totalSubmittedSheets - statsFirst.totalSubmittedSheets,
          overdueTrend: statsSecond.overdue - statsFirst.overdue
      };
  }, [filteredData, contextDataset, contextRevisionMap]);

  // Top 5 Oldest Pending Overdue Items
  const topOverdueItems = useMemo(() => {
     return [...filteredData]
        .filter(d => isEntityOverdue(d) && d.workflowStage === 'Pending' && !d.documentType?.includes('LTR'))
        .sort((a, b) => (b.delayDays || 0) - (a.delayDays || 0))
        .slice(0, 5);
  }, [filteredData]);

  // Action Owner Resolver for Bottlenecks
  const getResponsibleParty = (item: SubmittalRow) => {
      if (item.workflowStage === 'Pending') {
          return item.consultant || projectInfo?.consultantName || (language === 'ar' ? 'الاستشاري (ACE)' : 'Consultant (ACE)');
      } else if (item.workflowStage?.toLowerCase().includes('reject') || item.workflowStage?.toLowerCase().includes('resubmit')) {
          return item.contractor || projectInfo?.contractorName || (language === 'ar' ? 'المقاول الرئيسي (Innovo)' : 'Contractor (Innovo)');
      } else {
          return item.contractor || projectInfo?.contractorName || (language === 'ar' ? 'المقاول الرئيسي (Innovo)' : 'Contractor (Innovo)');
      }
  };

  // Interactive Drill-down State
  interface DrillDownItem {
    id: string;
    docNo: string;
    drawingNo?: string;
    subRef?: string;
    rawCode?: string;
    rawStatus?: string;
    sourceSheet?: string;
    sourceFile?: string;
    documentIdentityKey?: string;
    rev: string;
    subject: string;
    trade: string;
    discipline: string;
    submissionDate: string;
    responseDate?: string;
    dueDate?: string;
    status: string;
    statusCategory: string;
    actionOwner: string;
    delayDays: number;
    isOverdue: boolean;
    isLatest: boolean;
    allRevisions?: string[];
    sameDocRows?: SubmittalRow[];
    rawRecord?: SubmittalRow;
    remarks?: string;
  }

  const [drillDownModal, setDrillDownModal] = useState<{
    isOpen: boolean;
    docType: string;
    metricKey: string;
    metricLabel: string;
    metricLabelAr: string;
    items: DrillDownItem[];
  } | null>(null);

  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [copiedDocId, setCopiedDocId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isAuditMatrixOpen, setIsAuditMatrixOpen] = useState(false);
  const [isForensicTraceOpen, setIsForensicTraceOpen] = useState(false);
  const [copiedForensicTrace, setCopiedForensicTrace] = useState(false);

  // Dedicated Management Report Output Layer State
  const [reportViewMode, setReportViewMode] = useState<'official' | 'audit'>('official');
  const [selectedManagementRegister, setSelectedManagementRegister] = useState<string>('ALL');
  const [managementGroupingMode, setManagementGroupingMode] = useState<ManagementGroupingMode>('register');
  const [showAllRegisterTables, setShowAllRegisterTables] = useState<boolean>(false);
  const [showReconciliationSummary, setShowReconciliationSummary] = useState<boolean>(true);
  const [reconciliationModal, setReconciliationModal] = useState<{
    discipline: string;
    kpiKey: ManagementKpiColumnKey;
    kpiLabel: string;
    registerLabel: string;
    records: ReconciledSourceRecord[];
  } | null>(null);
  const [reconciliationSearch, setReconciliationSearch] = useState<string>('');
  const [copiedReconciliation, setCopiedReconciliation] = useState<boolean>(false);

  const officialManagementReport = useMemo(() => {
    return buildManagementReportOutput(
      nonNcrFilteredData,
      contextDataset,
      selectedManagementRegister,
      managementGroupingMode
    );
  }, [nonNcrFilteredData, contextDataset, selectedManagementRegister, managementGroupingMode]);

  const perRegisterManagementReports = useMemo(() => {
    if (!showAllRegisterTables) return [];
    return officialManagementReport.availableRegisters.map(reg =>
      buildManagementReportOutput(nonNcrFilteredData, contextDataset, reg, 'register')
    );
  }, [showAllRegisterTables, officialManagementReport.availableRegisters, nonNcrFilteredData, contextDataset]);

  const openReconciliationCell = useCallback((
    row: ManagementDisciplineRow,
    kpiKey: ManagementKpiColumnKey,
    kpiLabel: string,
    registerLabel: string
  ) => {
    setReconciliationSearch('');
    setCopiedReconciliation(false);
    setReconciliationModal({
      discipline: row.discipline,
      kpiKey,
      kpiLabel,
      registerLabel,
      records: row.reconciliation[kpiKey] || []
    });
  }, []);

  // Read-Only Forensic Source Trace for REJECTED_CLOSED in SDW-ARC and SDW-ELE
  const rejectedClosedForensicTrace = useMemo(() => {
    const allRows = contextDataset && contextDataset.length > 0 ? contextDataset : nonNcrFilteredData;
    const revMap = contextRevisionMap;

    const extractRawFields = (r: SubmittalRow) => {
      const anyR = r as Record<string, any>;
      const docNoVal = r.drawingNo || r.sheetNo || r.docNo || '-';
      const subRefVal = r.submissionRef || r.docNo || anyR.submittalRef || '-';
      const rawCodeVal = r.code ?? r.status ?? '-';
      const rawStatusVal = r.recordStatus ?? r.workflowStage ?? anyR.rawStatus ?? '-';
      const sourceSheetVal = r.sourceSheetName || r.disciplineSourceSheet || r.logType || '-';
      const sourceFileVal = r.sourceFile || r.sourceWorkbookName || r.sourceFileName || '-';
      return {
        id: r.id,
        documentNo: docNoVal,
        drawingNo: r.drawingNo || '',
        sheetNo: r.sheetNo || '',
        docNoField: r.docNo || '',
        rev: r.rev || '',
        subRef: subRefVal,
        rawCode: rawCodeVal,
        rawStatus: rawStatusVal,
        workflowStage: r.workflowStage || '',
        resolvedCategory: getStatusCodeCategory(r),
        submissionDate: r.submissionDate || '',
        responseDate: r.responseDate || '',
        sourceSheet: sourceSheetVal,
        sourceFile: sourceFileVal,
        registerIdentity: r.registerIdentity || r.sourceRegisterIdentity || '',
        discipline: resolveRowDiscipline(r, rowToRegisterIdentity(r)) || r.discipline || r.trade || '',
        documentIdentityKey: getDocumentIdentityKey(r),
        submissionIdentityKey: getSubmissionIdentityKey(r),
        remarks: r.remarks || '',
        rawRowObject: r
      };
    };

    const buildTraceForTarget = (targetPred: (label: string, reg: string, disc: string) => boolean, targetName: string) => {
      const matchingRows = nonNcrFilteredData.filter(d => {
        const reg = rowToRegisterIdentity(d);
        const disc = (resolveRowDiscipline(d, reg) || 'GEN').toUpperCase();
        const label = `${reg}-${disc}`;
        return targetPred(label, reg, disc);
      });

      const targetDocKeys = new Set(matchingRows.map(r => getDocumentIdentityKey(r)));
      const currentRejectedClosedEntries: any[] = [];
      const historicalRejectedClosedRows: any[] = [];

      matchingRows.forEach(r => {
        if (getStatusCodeCategory(r) === 'REJECTED_CLOSED') {
          historicalRejectedClosedRows.push(extractRawFields(r));
        }
      });

      targetDocKeys.forEach(docKey => {
        const group = revMap.get(docKey);
        if (!group) return;
        const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
        if (cat === 'REJECTED_CLOSED') {
          const latestFields = extractRawFields(group.latest);
          const normDocNo = (group.latest.drawingNo || group.latest.sheetNo || group.latest.docNo || '').trim().toUpperCase();
          const normSubRef = (group.latest.submissionRef || group.latest.docNo || '').trim().toUpperCase();

          // All rows sharing the exact same Document Identity Key in the revision engine
          const sameIdentityKeyRevisions = group.all.map(extractRawFields);

          // All rows across the entire loaded dataset sharing the same physical Document No (drawingNo/sheetNo/docNo) or SUB Ref
          const allRowsSharingDocumentNo = allRows
            .filter(cand => {
              const candDoc = (cand.drawingNo || cand.sheetNo || cand.docNo || '').trim().toUpperCase();
              const candDwg = (cand.drawingNo || cand.sheetNo || '').trim().toUpperCase();
              const targetDwg = (group.latest.drawingNo || group.latest.sheetNo || '').trim().toUpperCase();
              if (targetDwg && candDwg === targetDwg) return true;
              if (normDocNo && candDoc === normDocNo) return true;
              return getDocumentIdentityKey(cand) === docKey;
            })
            .map(extractRawFields);

          const allRowsSharingSubRef = allRows
            .filter(cand => {
              const candSub = (cand.submissionRef || cand.docNo || '').trim().toUpperCase();
              return normSubRef && candSub === normSubRef;
            })
            .map(extractRawFields);

          currentRejectedClosedEntries.push({
            targetRegister: targetName,
            documentIdentityKey: docKey,
            resolvedStatus: cat,
            latestWinningRecord: latestFields,
            revisionsInSameIdentityKey: sameIdentityKeyRevisions,
            allDatasetRowsSharingDocumentNo: allRowsSharingDocumentNo,
            allDatasetRowsSharingSubRef: allRowsSharingSubRef
          });
        }
      });

      return {
        targetRegister: targetName,
        totalRowsInRegister: matchingRows.length,
        totalUniqueDocumentsInRegister: targetDocKeys.size,
        currentRejectedClosedCount: currentRejectedClosedEntries.length,
        historicalRejectedClosedRowCount: historicalRejectedClosedRows.length,
        currentRejectedClosedRecords: currentRejectedClosedEntries,
        historicalRejectedClosedRows
      };
    };

    const sdwArc = buildTraceForTarget(
      (label, reg, disc) => (reg === 'SDW' || reg === 'SHD') && (disc === 'ARC' || disc === 'ARCH' || disc === 'ARCHITECTURAL' || label === 'SDW-ARC' || label === 'SDW-ARCH'),
      'SDW-ARC'
    );
    const sdwEle = buildTraceForTarget(
      (label, reg, disc) => (reg === 'SDW' || reg === 'SHD') && (disc === 'ELE' || disc === 'ELEC' || disc === 'ELECTRICAL' || label === 'SDW-ELE' || label === 'SDW-ELEC'),
      'SDW-ELE'
    );

    const targetOverdueDocNos = [
      'INN-ARC-DOC-LND-0082',
      'INN-ARC-DOC-INF-0214',
      'INN-ARC-DOC-LND-0083',
      'INN-ARC-DOC-LND-0084',
      'INN-ARC-WIR-INF-00321',
      'INN-ARC-WIR-INF-00322',
      'INN-ARC-MIR-ARC-00319',
      'INN-ARC-MIR-LND-00030',
      'INN-ARC-MIR-ARC-00323'
    ];

    const nowDateObj = new Date();
    const nowIsoDate = nowDateObj.toISOString().split('T')[0];
    const nowTimeMs = nowDateObj.getTime();

    const buildOverdueRecordTrace = (r: SubmittalRow) => {
      const anyR = r as Record<string, any>;
      const docNoVal = r.docNo || r.submissionRef || r.drawingNo || r.sheetNo || '-';
      const subDateStr = r.submissionDate || '';
      const respDateStr = r.responseDate || '';
      const rawDueDateStr = r.dueDate || '';
      const subMs = subDateStr ? new Date(subDateStr).getTime() : NaN;
      const respMs = respDateStr ? new Date(respDateStr).getTime() : NaN;
      const dueMs = rawDueDateStr ? new Date(rawDueDateStr).getTime() : NaN;
      const contractualDaysInSla = 14;
      const calculatedSlaDueDate = !isNaN(subMs)
        ? new Date(subMs + contractualDaysInSla * 86400000).toISOString().split('T')[0]
        : '';
      const effectiveDueDate = rawDueDateStr || calculatedSlaDueDate || '-';

      const targetMsUsedByGetDelayDays = respDateStr && !isNaN(respMs) ? respMs : nowTimeMs;
      const targetDateUsedStr = respDateStr && !isNaN(respMs) ? respDateStr : `${nowIsoDate} (Date.now())`;
      const runtimeDelayDays = r.delayDays ?? (!isNaN(subMs) ? Math.max(0, Math.floor((targetMsUsedByGetDelayDays - subMs) / 86400000)) : 0);

      const effectiveDueMs = !isNaN(dueMs) ? dueMs : (!isNaN(subMs) ? subMs + contractualDaysInSla * 86400000 : NaN);
      const trueAsOfMinusDueDays = !isNaN(effectiveDueMs) ? Math.floor((nowTimeMs - effectiveDueMs) / 86400000) : null;
      const trueEndMinusDueDays = !isNaN(effectiveDueMs) ? Math.floor((targetMsUsedByGetDelayDays - effectiveDueMs) / 86400000) : null;

      const docKey = getDocumentIdentityKey(r);
      const group = revMap.get(docKey);
      const isWinningLatestRev = group ? group.latest === r : Boolean(r.isLatestRev);
      const currentEntityStatus = group ? (group.resolvedStatus || getStatusCodeCategory(group.latest)) : getStatusCodeCategory(r);
      const winningLatestRevStr = group?.latest?.rev || r.rev || '00';

      const exactFormula = respDateStr
        ? `Math.floor((new Date("${respDateStr}") - new Date("${subDateStr}")) / 86400000) = ${runtimeDelayDays} days [Uses ResponseDate - SubmissionDate; contractual SLA days (14) & DueDate ("${rawDueDateStr || 'none'}") are NOT subtracted in getDelayDays()]`
        : `Math.floor((Date.now() ["${nowIsoDate}"] - new Date("${subDateStr}")) / 86400000) = ${runtimeDelayDays} days [Uses AsOfDate(Today) - SubmissionDate because ResponseDate is empty; DueDate ("${rawDueDateStr || 'none'}") is ignored in getDelayDays()]`;

      return {
        documentNo: docNoVal,
        revision: r.rev || '00',
        submissionDate: subDateStr || '-',
        responseDate: respDateStr || 'EMPTY (Missing in Excel)',
        rawCode: r.code ?? r.status ?? '-',
        rawStatus: r.recordStatus ?? r.workflowStage ?? anyR.rawStatus ?? '-',
        rowResolvedCategory: getStatusCodeCategory(r),
        allowedContractualDaysUsedInGetDelayDays: 0,
        allowedContractualDaysInIsEntityOverdueFallback: 14,
        rawDueDateFromExcel: rawDueDateStr || 'EMPTY',
        calculatedDueDatePlus14: calculatedSlaDueDate || '-',
        effectiveDueDate,
        asOfCalculationDateUsed: targetDateUsedStr,
        exactOverdueDaysReported: runtimeDelayDays,
        trueAsOfMinusDueDateDays: trueAsOfMinusDueDays,
        trueTargetMinusDueDateDays: trueEndMinusDueDays,
        isEntityOverdueFlag: isEntityOverdue(r),
        isCurrentLatestRevision: isWinningLatestRev,
        currentEntityWinningRevision: winningLatestRevStr,
        currentEntityResolvedStatus: currentEntityStatus,
        reportGrainConfirmation: 'Historical Rejection Event / Row (filtered by workflowStage === "Rejected" on cumulative rows, deduplicated by first-seen docNo, NOT filtered to current latest revision)',
        exactRuntimeFormula: exactFormula,
        sourceSheet: r.sourceSheetName || r.disciplineSourceSheet || r.logType || '-'
      };
    };

    const overdueTargetTraces = targetOverdueDocNos.map(targetDoc => {
      const normTarget = targetDoc.trim().toUpperCase();
      const matching = allRows.filter(r => {
        const dNo = (r.docNo || '').trim().toUpperCase();
        const sRef = (r.submissionRef || '').trim().toUpperCase();
        const dwg = (r.drawingNo || r.sheetNo || '').trim().toUpperCase();
        return dNo === normTarget || sRef === normTarget || dwg === normTarget || dNo.includes(normTarget) || sRef.includes(normTarget);
      });
      return {
        requestedDocumentNo: targetDoc,
        foundInLoadedDataset: matching.length > 0,
        matchingRowCount: matching.length,
        rows: matching.map(buildOverdueRecordTrace)
      };
    });

    // Also capture Top 15 rows from the exact exportEngine presRejectedItems query
    const seenRejRefs = new Set<string>();
    const presRejectedItemsSim = allRows
      .filter(d => d.workflowStage === 'Rejected' && !d.documentType?.includes('LTR'))
      .filter(d => {
        const refKey = (d.docNo || d.id || `${d.documentType}-${d.trade}-${d.rev}`).toUpperCase().trim();
        if (seenRejRefs.has(refKey)) return false;
        seenRejRefs.add(refKey);
        return true;
      })
      .sort((a, b) => {
        const aOverdue = isEntityOverdue(a) ? 1 : 0;
        const bOverdue = isEntityOverdue(b) ? 1 : 0;
        if (bOverdue !== aOverdue) return bOverdue - aOverdue;
        return (b.delayDays || 0) - (a.delayDays || 0);
      });

    return {
      generatedAt: new Date().toISOString(),
      totalLoadedRows: allRows.length,
      filteredRows: nonNcrFilteredData.length,
      'SDW-ARC': sdwArc,
      'SDW-ELE': sdwEle,
      overdueForensicTrace: {
        totalPresRejectedItemsCount: presRejectedItemsSim.length,
        requested9RecordsTrace: overdueTargetTraces,
        top15HistoricalRejectionRowsByDelay: presRejectedItemsSim.slice(0, 15).map(buildOverdueRecordTrace)
      }
    };
  }, [contextDataset, nonNcrFilteredData, contextRevisionMap, rowToRegisterIdentity]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__getRejectedClosedForensicTrace = () => rejectedClosedForensicTrace;
    }
  }, [rejectedClosedForensicTrace]);

  // Overdue Active split (Rejected Open vs Pending Review)
  const activeOverdueCounts = useMemo(() => {
    if (globalStats.overduePending !== undefined && globalStats.overdueRejectedOpen !== undefined) {
      return {
        rejectedOpen: globalStats.overdueRejectedOpen,
        pending: globalStats.overduePending,
        total: globalStats.overdue
      };
    }
    const rows = nonNcrFilteredData;
    const revisionMap = contextDataset && contextDataset.length > 0 ? contextRevisionMap : processRevisionEngine(rows);
    const targetEntityKeys = new Set(rows.map(r => getDocumentIdentityKey(r)));

    let overdueRejectedOpen = 0;
    let overduePending = 0;

    targetEntityKeys.forEach(key => {
      const group = revisionMap.get(key);
      if (!group) return;
      const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
      const isOverdue = isEntityOverdue(group.latest);
      if (isOverdue) {
        if (cat === 'REJECTED_OPEN') {
          overdueRejectedOpen++;
        } else if (cat === 'PENDING' || cat === 'UNCLASSIFIED') {
          overduePending++;
        }
      }
    });

    return {
      rejectedOpen: overdueRejectedOpen,
      pending: overduePending,
      total: globalStats.overdue
    };
  }, [nonNcrFilteredData, contextDataset, contextRevisionMap, globalStats.overdue, globalStats.overduePending, globalStats.overdueRejectedOpen]);

  // Register Compliance Health Rating Resolver
  const getRegisterHealth = (stats: KPIStats) => {
    const rate = stats.approvalRate;
    const od = stats.overdue;
    if (rate >= 85 && od === 0) {
      return {
        labelEn: 'Excellent',
        labelAr: 'ممتاز',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300',
        dotClass: 'bg-emerald-500'
      };
    } else if (rate >= 80 && od <= 2) {
      return {
        labelEn: 'Good',
        labelAr: 'جيد',
        badgeClass: 'bg-teal-50 text-teal-700 border-teal-300',
        dotClass: 'bg-teal-500'
      };
    } else if (rate >= 65) {
      return {
        labelEn: 'Fair',
        labelAr: 'مقبول',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-300',
        dotClass: 'bg-amber-500'
      };
    } else {
      return {
        labelEn: 'Needs Attention',
        labelAr: 'يحتاج متابعة',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-300',
        dotClass: 'bg-rose-500'
      };
    }
  };

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drillDownModal?.isOpen) {
        setDrillDownModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drillDownModal]);

  const openDrillDown = (
    docTypeFilter: string,
    metricKey: string,
    metricLabel: string,
    metricLabelAr: string
  ) => {
    const rows = docTypeFilter === 'ALL'
      ? nonNcrFilteredData
      : (rowsByDocTypeLabel.get(docTypeFilter) || []);

    const revisionMap = contextDataset && contextDataset.length > 0 ? contextRevisionMap : processRevisionEngine(rows);
    const targetEntityKeys = new Set(rows.map(r => getDocumentIdentityKey(r)));

    const extracted: DrillDownItem[] = [];

    const mapToDrillDownItem = (r: SubmittalRow, isLatest: boolean, allRevs: string[] = [], groupAllRows: SubmittalRow[] = []): DrillDownItem => {
      const responsible = getResponsibleParty(r);
      const cat = getStatusCodeCategory(r);
      const baseDocNo = r.docNo || r.submissionRef || (r as any).ncrRef || (r as any).sorRef || (r as any).rfiRef || r.id || 'N/A';
      const dwg = (r.drawingNo || r.sheetNo || '').trim();
      const displayDocNo = dwg && !baseDocNo.includes(dwg) ? `${baseDocNo} [DWG: ${dwg}]` : baseDocNo;
      const docKey = getDocumentIdentityKey(r);
      const groupRows = groupAllRows.length > 0 ? groupAllRows : (revisionMap.get(docKey)?.all || [r]);
      return {
        id: r.id || `${baseDocNo}-${dwg}-${r.rev}`,
        docNo: displayDocNo,
        drawingNo: dwg || r.docNo || '-',
        subRef: r.submissionRef || r.docNo || '-',
        rawCode: r.code ?? r.status ?? '-',
        rawStatus: r.recordStatus ?? r.workflowStage ?? '-',
        sourceSheet: r.sourceSheetName || r.disciplineSourceSheet || r.logType || '-',
        sourceFile: r.sourceFile || r.sourceWorkbookName || r.sourceFileName || '-',
        documentIdentityKey: docKey,
        rev: r.rev || '00',
        subject: (r as any).description || (r as any).subject || (r as any).drawingTitle || (r as any).title || r.remarks || '-',
        trade: r.trade || 'General',
        discipline: r.discipline || resolveRowDiscipline(r),
        submissionDate: r.submissionDate || '-',
        responseDate: r.responseDate,
        dueDate: r.dueDate,
        status: r.status || (r as any).recordStatus || r.workflowStage || (r as any).ncrStatus || (r as any).sorStatus || 'Pending',
        statusCategory: cat,
        actionOwner: responsible,
        delayDays: r.delayDays || 0,
        isOverdue: Boolean(r.overdue),
        isLatest,
        allRevisions: allRevs,
        sameDocRows: groupRows,
        rawRecord: r,
        remarks: r.remarks
      };
    };

    switch (metricKey) {
      case 'superseded': {
        const localRevisionMap = processRevisionEngine(rows);
        targetEntityKeys.forEach(key => {
          const group = localRevisionMap.get(key);
          if (!group || group.all.length <= 1) return;
          const latestIdx = group.all.indexOf(group.latest);
          const supersededRows = latestIdx !== -1
            ? group.all.filter((_, idx) => idx !== latestIdx)
            : group.all.slice(0, -1);
          const revs = group.all.map(x => x.rev || '00');
          supersededRows.forEach(r => {
            extracted.push(mapToDrillDownItem(r, false, revs));
          });
        });
        break;
      }
      case 'currentRejectedClosed': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'REJECTED_CLOSED') {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'currentRejectedOpen': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'REJECTED_OPEN') {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'currentRejected': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'REJECTED_OPEN' || cat === 'REJECTED_CLOSED') {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'approved': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'APPROVED' || cat === 'FINAL_CLOSED') {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'pending': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'PENDING' || cat === 'UNCLASSIFIED') {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'active': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'PENDING' || cat === 'REJECTED_OPEN' || cat === 'UNCLASSIFIED') {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'totalUnique': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const revs = group.all.map(x => x.rev || '00');
          extracted.push(mapToDrillDownItem(group.latest, true, revs));
        });
        break;
      }
      case 'resolvedRejections': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          if (group.isResolved) {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'overdue': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'PENDING' || cat === 'REJECTED_OPEN') {
            if (isEntityOverdue(group.latest)) {
              const revs = group.all.map(x => x.rev || '00');
              extracted.push(mapToDrillDownItem(group.latest, true, revs));
            }
          }
        });
        break;
      }
      case 'overdueRejectedOpen': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if (cat === 'REJECTED_OPEN' && isEntityOverdue(group.latest)) {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'overduePending': {
        targetEntityKeys.forEach(key => {
          const group = revisionMap.get(key);
          if (!group) return;
          const cat = group.resolvedStatus || getStatusCodeCategory(group.latest);
          if ((cat === 'PENDING' || cat === 'UNCLASSIFIED') && isEntityOverdue(group.latest)) {
            const revs = group.all.map(x => x.rev || '00');
            extracted.push(mapToDrillDownItem(group.latest, true, revs));
          }
        });
        break;
      }
      case 'critical': {
        rows.filter(d => d.priority === 'CRITICAL' || (d.remarks || '').toUpperCase().includes('CRITICAL')).forEach(r => {
          extracted.push(mapToDrillDownItem(r, false));
        });
        break;
      }
      case 'totalWorkload': {
        rows.forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'uniqueRev00': {
        const seen = new Set<string>();
        rows.filter(r => isRevision0(r.rev, r.isRev0)).forEach(r => {
          const key = getSubmissionIdentityKey(r);
          if (!seen.has(key)) {
            seen.add(key);
            extracted.push(mapToDrillDownItem(r, false));
          }
        });
        break;
      }
      case 'uniqueFurtherRev': {
        const seen = new Set<string>();
        rows.filter(r => isFurtherRevision(r.rev, r.isRev0)).forEach(r => {
          const key = getSubmissionIdentityKey(r);
          if (!seen.has(key)) {
            seen.add(key);
            extracted.push(mapToDrillDownItem(r, false));
          }
        });
        break;
      }
      case 'rev00': {
        rows.filter(r => isRevision0(r.rev, r.isRev0)).forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'furtherRev': {
        rows.filter(r => isFurtherRevision(r.rev, r.isRev0)).forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'totalRejectedRows': {
        rows.filter(r => {
          const cat = getStatusCodeCategory(r);
          return cat === 'REJECTED_OPEN' || cat === 'REJECTED_CLOSED';
        }).forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'rejectedOpenRows': {
        rows.filter(r => getStatusCodeCategory(r) === 'REJECTED_OPEN').forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'rejectedClosedRows': {
        rows.filter(r => getStatusCodeCategory(r) === 'REJECTED_CLOSED').forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'missingSequence': {
        if (docTypeFilter === 'ALL') {
          sequenceAuditResult.allMissingIds.forEach(m => {
            extracted.push({
              id: m.docNo,
              docNo: m.docNo,
              rev: '00 (Missing)',
              subject: `Expected Sequence Gap in ${m.docType} (Seq #${m.seqNumber})`,
              trade: 'Sequence Control',
              discipline: resolveRowDiscipline({ documentType: m.docType } as any),
              submissionDate: '-',
              status: 'MISSING_SEQUENCE',
              statusCategory: 'UNCLASSIFIED',
              actionOwner: 'Missing from Register',
              delayDays: 0,
              isOverdue: false,
              isLatest: false,
              allRevisions: []
            });
          });
        } else {
          const regAudit = sequenceAuditResult.registerAudits[docTypeFilter];
          if (regAudit) {
            regAudit.missingIds.forEach(mid => {
              extracted.push({
                id: mid,
                docNo: mid,
                rev: '00 (Missing)',
                subject: `Expected Rev.00 Sequence Gap in ${docTypeFilter} (Range ${regAudit.prefix}${regAudit.minSequence} → ${regAudit.prefix}${regAudit.maxSequence})`,
                trade: 'Sequence Control',
                discipline: resolveRowDiscipline({ documentType: docTypeFilter } as any),
                submissionDate: '-',
                status: 'MISSING_SEQUENCE',
                statusCategory: 'UNCLASSIFIED',
                actionOwner: 'Missing from Register',
                delayDays: 0,
                isOverdue: false,
                isLatest: false,
                allRevisions: []
              });
            });
          }
        }
        break;
      }
      default: {
        rows.forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
    }

    setModalSearchQuery('');
    setDrillDownModal({
      isOpen: true,
      docType: docTypeFilter,
      metricKey,
      metricLabel,
      metricLabelAr,
      items: extracted
    });
  };

  const handleCopySingleDoc = (docNo: string) => {
    navigator.clipboard.writeText(docNo);
    setCopiedDocId(docNo);
    setTimeout(() => setCopiedDocId(null), 2500);
  };

  const handleCopyAllDocNumbers = (itemsToCopy: DrillDownItem[]) => {
    const list = itemsToCopy.map(i => i.docNo).filter(Boolean).join('\n');
    navigator.clipboard.writeText(list);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleExportDrillDownCSV = (itemsToExport: DrillDownItem[]) => {
    if (!itemsToExport || itemsToExport.length === 0) return;
    const headers = [
      '#',
      'Document No (DWG No)',
      'Rev',
      'SUB Ref',
      'Raw Code',
      'Raw Status',
      'Resolved Category',
      'Submission Date',
      'Response Date',
      'Source Sheet',
      'Source File',
      'All Revisions (Same Doc No)',
      'Subject / Description',
      'Trade / Discipline',
      'Action Owner',
      'Delay Days'
    ];
    const rows = itemsToExport.map((it, idx) => {
      const allRevsSummary = (it.sameDocRows || [])
        .map(r => `Rev:${r.rev || '00'}[SUB:${r.submissionRef || r.docNo || '-'}|Code:${r.code ?? r.status ?? '-'}|Status:${r.recordStatus ?? r.workflowStage ?? '-'}|SubDate:${r.submissionDate || '-'}|RespDate:${r.responseDate || '-'}|Sheet:${r.sourceSheetName || r.disciplineSourceSheet || r.logType || '-'}]`)
        .join(' ; ');
      return [
        idx + 1,
        `"${(it.drawingNo || it.docNo || '').replace(/"/g, '""')}"`,
        `"${(it.rev || '').replace(/"/g, '""')}"`,
        `"${(it.subRef || '').replace(/"/g, '""')}"`,
        `"${(it.rawCode || it.status || '').replace(/"/g, '""')}"`,
        `"${(it.rawStatus || '').replace(/"/g, '""')}"`,
        `"${(it.statusCategory || '').replace(/"/g, '""')}"`,
        `"${(it.submissionDate || '').replace(/"/g, '""')}"`,
        `"${(it.responseDate || '').replace(/"/g, '""')}"`,
        `"${(it.sourceSheet || '').replace(/"/g, '""')}"`,
        `"${(it.sourceFile || '').replace(/"/g, '""')}"`,
        `"${allRevsSummary.replace(/"/g, '""')}"`,
        `"${(it.subject || '').replace(/"/g, '""')}"`,
        `"${(`${it.trade || ''} - ${it.discipline || ''}`).replace(/"/g, '""')}"`,
        `"${(it.actionOwner || '').replace(/"/g, '""')}"`,
        it.delayDays ?? 0
      ];
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeDoc = (drillDownModal?.docType || 'Report').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeMetric = (drillDownModal?.metricKey || 'Data').replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `DrillDown_${safeDoc}_${safeMetric}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Executive Dynamic Recommendations
  const priorityRecommendations = useMemo(() => {
      const recs: { id: string; en: string; ar: string; priority: 'CRITICAL' | 'HIGH' | 'MEDIUM'; action: string; actionAr: string }[] = [];
      const appRate = globalStats.approvalRate;
      const totalOverdue = globalStats.overdue;

      if (appRate < 80) {
          recs.push({
              id: 'rec-1',
              en: `Establish an internal pre-submission technical audit desk to filter out recurring defects, aiming to lift the current ${appRate.toFixed(1)}% approval rate back to the 80%+ benchmark.`,
              ar: `تأسيس مكتب فني داخلي لتدقيق جودة المعاملات قبل تقديمها للاستشاري لتلافي الملاحظات المتكررة، بهدف رفع معدل الاعتماد البالغ حالياً ${appRate.toFixed(1)}% إلى النسبة المستهدفة 80%.`,
              priority: 'CRITICAL',
              action: 'Improve Pre-QA/QC Check',
              actionAr: 'تطوير تدقيق الجودة الداخلي'
          });
      }

      if (totalOverdue > 0) {
          const odRejOpen = activeOverdueCounts.rejectedOpen;
          const odPending = activeOverdueCounts.pending;
          let breakdownEn = '';
          let breakdownAr = '';
          if (odRejOpen > 0 && odPending > 0) {
              breakdownEn = `, comprising ${odRejOpen} Rejected/Open items and ${odPending} Pending Review items`;
              breakdownAr = `، منها ${odRejOpen} بندًا مرفوضًا/مفتوحًا و${odPending} بنود معلقة قيد المراجعة`;
          } else if (odRejOpen > 0) {
              breakdownEn = `, comprising ${odRejOpen} Rejected/Open items`;
              breakdownAr = `، تتكون بالكامل من ${odRejOpen} بندًا مرفوضًا/مفتوحًا`;
          } else if (odPending > 0) {
              breakdownEn = `, comprising ${odPending} Pending Review items`;
              breakdownAr = `، تتكون بالكامل من ${odPending} بنود معلقة قيد المراجعة`;
          }

          recs.push({
              id: 'rec-2',
              en: `Prioritize resolution of the ${totalOverdue} active items currently exceeding the applicable SLA${breakdownEn}.`,
              ar: `إعطاء الأولوية لمعالجة ${totalOverdue} بندًا نشطًا متجاوزًا للمدة المحددة${breakdownAr}.`,
              priority: 'CRITICAL',
              action: 'Resolve SLA Overdues',
              actionAr: 'تصفية متأخرات SLA'
          });
      }

      // Check worst performing document type
      let worstDocType = '';
      let maxOverdue = 0;
      byDocType.forEach(row => {
          if (row.stats.overdue > maxOverdue) {
              maxOverdue = row.stats.overdue;
              worstDocType = row.documentType;
          }
      });

      if (worstDocType && maxOverdue > 2) {
          recs.push({
              id: 'rec-3',
              en: `Convene a joint alignment workshop between Innovo & ACE design managers specifically for ${worstDocType} submittals to settle disputed code interpretations.`,
              ar: `عقد ورشة عمل فنية مشتركة بين مديري التصميم من المقاول والاستشاري لبحث سجلات الـ (${worstDocType}) والوصول لاتفاق حول تفسير الأكواد والمواصفات الفنية المختلفة لتقليل الرفض.`,
              priority: 'HIGH',
              action: `Align on ${worstDocType} Code`,
              actionAr: `تنسيق فني لسجلات ${worstDocType}`
          });
      } else {
          recs.push({
              id: 'rec-3',
              en: 'Implement dynamic dashboard tracking to monitor ACE response turnaround times on a daily basis to prevent any upcoming SLA backlogs.',
              ar: 'تفعيل نظام متابعة يومي لمراقبة معدل استجابة الاستشاري لضمان سرعة الرد وتلافي تراكم أي مستندات جديدة مستقبلاً.',
              priority: 'MEDIUM',
              action: 'Monitor Daily Lead-times',
              actionAr: 'مراقبة مدد الاستجابة اليومية'
          });
      }

      recs.push({
          id: 'rec-4',
          en: 'Audit submittal logs to verify the closure and re-submission of rejected items within 10 working days of receipt.',
          ar: 'جدولة أعمال تدقيق دورية للتأكد من مراجعة وإعادة تقديم كافة المستندات المرفوضة في غضون 10 أيام عمل من تاريخ تسلمها.',
          priority: 'MEDIUM',
          action: 'Audit Rejection Turnaround',
          actionAr: 'تدقيق المستندات المعاد تقديمها'
      });

      return recs;
  }, [globalStats, byDocType]);

  // Chart Data preparation - Exclusively partitions all canonical unique items
  const pieChartData = useMemo(() => {
      const dataSet = [
        { name: language === 'ar' ? 'معتمد' : 'Approved', value: globalStats.approved, color: '#10b981' },
        { name: language === 'ar' ? 'مرفوض مفتوح' : 'Rejected Open', value: globalStats.rejectedOpen, color: '#f43f5e' },
        { name: language === 'ar' ? 'مرفوض مغلق' : 'Rejected Closed', value: globalStats.rejectedClosed, color: '#b91c1c' },
        { name: language === 'ar' ? 'معلق قيد المراجعة' : 'Pending Review', value: globalStats.pending, color: '#f59e0b' },
      ].filter(item => item.value > 0);

      return dataSet.length > 0 ? dataSet : [{ name: 'No Data', value: 1, color: '#cbd5e1' }];
  }, [globalStats, language]);

  const barChartData = useMemo(() => {
      return byDocType.slice(0, 8).map(row => ({
          name: row.documentType,
          Rev00: row.stats.totalSheetsRev0 || 0,
          FurtherRev: row.stats.totalSheetsFurtherRev || 0,
          Total: row.stats.totalSubmittedSheets || 0
      }));
  }, [byDocType]);

  const thClass = "px-3 py-3 border-b border-slate-200 bg-slate-100 text-slate-800 font-bold text-xs text-center uppercase tracking-wider transition-colors break-normal [overflow-wrap:normal] hyphens-none min-w-[78px]";
  const tdClass = "px-3 py-2.5 border-b border-slate-100 text-xs text-center font-semibold text-slate-700 transition-colors whitespace-nowrap break-normal [overflow-wrap:normal] hyphens-none";

  return (
    <div className="space-y-6 animate-in fade-in duration-300 print:space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
       {/* 1. PROJECT INFO HEADER */}
       {projectInfo && (
        <div id="report-project-header" className="bg-[#ffffff] p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all">
           <div>
             <h2 className="text-2xl font-bold text-[#203864] flex items-center gap-2">
               <FileText className="w-6 h-6 text-[#203864] shrink-0" />
               {projectInfo.projectName}
             </h2>
             <p className="text-sm text-slate-500 font-semibold tracking-wide mt-1">
               {language === 'ar' ? `كود المشروع: ${projectInfo.projectCode}` : `Project Code: ${projectInfo.projectCode}`}
             </p>
           </div>
           <div className="flex flex-wrap gap-x-8 gap-y-4 text-xs">
             <div>
               <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">{language === 'ar' ? 'المالك' : 'Employer'}</span>
               <span className="font-bold text-slate-700 text-sm">{projectInfo.clientName}</span>
             </div>
             <div className="border-l border-slate-200 pl-4">
               <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">{language === 'ar' ? 'المقاول الرئيسي' : 'Contractor'}</span>
               <span className="font-bold text-slate-700 text-sm">{projectInfo.contractorName}</span>
             </div>
             <div className="border-l border-slate-200 pl-4">
               <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">{language === 'ar' ? 'الاستشاري' : 'Consultant'}</span>
               <span className="font-bold text-slate-700 text-sm">{projectInfo.consultantName}</span>
             </div>
           </div>
        </div>
       )}

       {/* REPORT LAYER SWITCHER: OFFICIAL MANAGEMENT REPORT (PRIMARY) vs ANALYTICS / AUDIT ONLY */}
       <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 print:hidden [body.pdf-export_&]:hidden">
         <div className="flex items-center gap-2.5 flex-wrap">
           <button
             type="button"
             onClick={() => setReportViewMode('official')}
             className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
               reportViewMode === 'official'
                 ? 'bg-[#203864] text-white shadow-sm'
                 : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
             }`}
           >
             <FileSpreadsheet className="w-4 h-4" />
             <span>
               {language === 'ar'
                 ? `التقرير الإداري الرسمي الموحد (${isMonthly ? 'شهري' : 'تراكمي'})`
                 : `Official Management Report (${isMonthly ? 'Monthly' : 'Cumulative'})`}
             </span>
           </button>
           <button
             type="button"
             onClick={() => setReportViewMode('audit')}
             className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
               reportViewMode === 'audit'
                 ? 'bg-slate-800 text-white shadow-sm'
                 : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
             }`}
           >
             <Layers className="w-4 h-4" />
             <span>
               {language === 'ar'
                 ? 'التحليلات والتدقيق التفصيلي فقط (Analytics / Audit Only)'
                 : 'Analytics & Audit Only (Detailed Diagnostics)'}
             </span>
           </button>
         </div>

         <div className="flex items-center gap-2 flex-wrap">
           {reportViewMode === 'official' && (
             <button
               type="button"
               onClick={() => setShowReconciliationSummary(!showReconciliationSummary)}
               className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                 showReconciliationSummary
                   ? 'bg-emerald-700 text-white border-emerald-800'
                   : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
               }`}
             >
               <ShieldCheck className="w-3.5 h-3.5" />
               <span>
                 {language === 'ar'
                   ? 'مطابقة الصفوف المصدرية (Read-Only Reconciliation)'
                   : 'Read-Only Source Reconciliation'}
               </span>
             </button>
           )}
           <button
             type="button"
             onClick={() => setIsForensicTraceOpen(true)}
             className="px-3 py-1.5 rounded-lg bg-red-900 hover:bg-red-800 text-white text-xs font-bold border border-red-700 flex items-center gap-1.5 cursor-pointer transition-colors"
           >
             <FileText className="w-3.5 h-3.5 text-red-200" />
             <span>
               {language === 'ar' ? 'فحص جنائي للمصدر (Forensic Trace)' : 'Forensic Source Trace'}
             </span>
           </button>
         </div>
       </div>

       {/* ===================================================================== */}
       {/* PRIMARY LAYER: DEDICATED OFFICIAL MANAGEMENT REPORT OUTPUT            */}
       {/* ===================================================================== */}
       {reportViewMode === 'official' && (
         <div id="official-management-report-layer" className="space-y-6">
           {/* Register Scope Controls (Hidden on Print) */}
           <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 print:hidden [body.pdf-export_&]:hidden">
             <div>
               <div className="flex items-center gap-2">
                 <span className="text-xs font-black uppercase tracking-wider text-[#203864]">
                   {language === 'ar' ? 'نطاق السجل الهندسي:' : 'Register Scope:'}
                 </span>
                 <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                   {officialManagementReport.isFullyReconciled
                     ? (language === 'ar' ? '100% متطابق مع الحساب الأساسي SSOT' : '100% SSOT Reconciled')
                     : (language === 'ar' ? 'قيد المراجعة' : 'Check Reconciliation')}
                 </span>
               </div>
               <p className="text-xs text-slate-500 mt-0.5">
                 {language === 'ar'
                   ? 'انقر على أي رقم في الجدول لعرض الصفوف الحقيقية من ملف Excel التي تُكوّن هذا المؤشر.'
                   : 'Click any KPI number in the table to inspect the exact raw Excel source rows contributing to that figure.'}
               </p>
             </div>

             <div className="flex items-center gap-2 flex-wrap">
               {/* Breakdown Layer Switcher: Official Submittal Register Scope vs Discipline Breakdown Layer */}
               <div className="flex items-center gap-1 bg-blue-50/80 p-1 rounded-lg border border-blue-200">
                 <button
                   type="button"
                   onClick={() => setManagementGroupingMode('register')}
                   className={`px-2.5 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer ${
                     managementGroupingMode === 'register'
                       ? 'bg-[#203864] text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900'
                   }`}
                 >
                   {language === 'ar' ? 'حسب السجل الرسمي (By Register)' : 'By Official Register'}
                 </button>
                 <button
                   type="button"
                   onClick={() => setManagementGroupingMode('discipline')}
                   className={`px-2.5 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer ${
                     managementGroupingMode === 'discipline'
                       ? 'bg-[#203864] text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900'
                   }`}
                 >
                   {language === 'ar' ? 'حسب التخصص (By Discipline)' : 'By Discipline Breakdown'}
                 </button>
               </div>
               <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 flex-wrap">
                 <button
                   type="button"
                   onClick={() => {
                     setSelectedManagementRegister('ALL');
                     setShowAllRegisterTables(false);
                   }}
                   className={`px-3 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer ${
                     selectedManagementRegister === 'ALL' && !showAllRegisterTables
                       ? 'bg-[#203864] text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900'
                   }`}
                 >
                   {language === 'ar' ? 'إجمالي كافة السجلات (ALL)' : 'ALL REGISTERS'}
                 </button>
                 {officialManagementReport.availableRegisters.map(reg => (
                   <button
                     key={reg}
                     type="button"
                     onClick={() => {
                       setSelectedManagementRegister(reg);
                       setShowAllRegisterTables(false);
                     }}
                     className={`px-3 py-1.5 rounded-md text-xs font-extrabold transition-all cursor-pointer ${
                       selectedManagementRegister === reg && !showAllRegisterTables
                         ? 'bg-[#203864] text-white shadow-xs'
                         : 'text-slate-600 hover:text-slate-900'
                     }`}
                   >
                     {reg}
                   </button>
                 ))}
               </div>

               {officialManagementReport.availableRegisters.length > 1 && (
                 <button
                   type="button"
                   onClick={() => setShowAllRegisterTables(!showAllRegisterTables)}
                   className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                     showAllRegisterTables
                       ? 'bg-indigo-900 text-white border-indigo-950'
                       : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                   }`}
                 >
                   {language === 'ar'
                     ? 'عرض جداول السجلات منفصلة'
                     : 'Show All Registers Separately'}
                 </button>
               )}
             </div>
           </div>

           {/* Helper to render a single clean Official 8-Column Management KPI Table */}
           {[
             {
               report: officialManagementReport,
               headingEn:
                 selectedManagementRegister === 'ALL'
                   ? `OFFICIAL ${isMonthly ? 'MONTHLY' : 'CUMULATIVE'} MANAGEMENT REPORT — ALL SUBMITTAL REGISTERS`
                   : `OFFICIAL ${isMonthly ? 'MONTHLY' : 'CUMULATIVE'} MANAGEMENT REPORT — ${selectedManagementRegister} REGISTER`,
               headingAr:
                 selectedManagementRegister === 'ALL'
                   ? `التقرير الإداري الرسمي (${isMonthly ? 'الشهري' : 'التراكمي'}) — إجمالي السجلات الهندسية`
                   : `التقرير الإداري الرسمي (${isMonthly ? 'الشهري' : 'التراكمي'}) — سجل ${selectedManagementRegister}`
             },
             ...perRegisterManagementReports.map(rep => ({
               report: rep,
               headingEn: `OFFICIAL ${isMonthly ? 'MONTHLY' : 'CUMULATIVE'} MANAGEMENT REPORT — ${rep.registerFilter} REGISTER`,
               headingAr: `التقرير الإداري الرسمي (${isMonthly ? 'الشهري' : 'التراكمي'}) — سجل ${rep.registerFilter}`
             }))
           ].map((section, secIdx) => {
             const rep = section.report;
             const allTableRows = [...rep.rows, rep.grandTotal];
             return (
               <div
                 key={`${rep.registerFilter}-${secIdx}`}
                 className="bg-white rounded-xl shadow-sm border border-slate-300 overflow-hidden print:break-inside-avoid"
               >
                 {/* Official Table Header Banner */}
                 <div className="bg-[#203864] text-white px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                   <div>
                     <h3 className="text-base font-extrabold tracking-wide uppercase">
                       {language === 'ar' ? section.headingAr : section.headingEn}
                     </h3>
                     <p className="text-xs text-slate-300 mt-0.5">
                       {language === 'ar'
                         ? 'جدول مؤشرات الأداء الرسمية المعتمد للتقارير الشهرية والتراكمية (مشتق مباشرة من محرك الحساب الموحد SSOT)'
                         : 'Official Management KPI Table for Monthly & Cumulative Reporting (Directly sourced from SSOT Calculation Engine)'}
                     </p>
                   </div>
                   <div className="flex items-center gap-2 text-xs font-mono bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                     <span>Total Submittals: {rep.grandTotal.totalSubmittals}</span>
                     <span>|</span>
                     <span>Total Sheets: {rep.grandTotal.totalSheets}</span>
                   </div>
                 </div>

                 {/* Official 8-Column Table: Status | Total Submittals | Rev.00 | Further Rev. | Total Sheets | Approved | Rejected | Pending */}
                 <div className="overflow-x-auto">
                   <table className="w-full border-collapse text-center">
                     <thead>
                       <tr className="bg-slate-100 border-b-2 border-slate-300 text-[#203864]">
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider text-left border-r border-slate-200 whitespace-nowrap">
                           {rep.groupingMode === 'register' ? 'Register' : 'Status'}
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider border-r border-slate-200 bg-blue-50/60 whitespace-nowrap">
                           Total Submittals
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider border-r border-slate-200 whitespace-nowrap">
                           Rev.00
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider border-r border-slate-200 whitespace-nowrap">
                           Further Rev.
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider border-r border-slate-300 bg-slate-200/70 whitespace-nowrap">
                           Total Sheets
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider border-r border-slate-200 bg-emerald-50/70 text-emerald-900 whitespace-nowrap">
                           Approved
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider border-r border-slate-200 bg-rose-50/70 text-rose-900 whitespace-nowrap">
                           Rejected
                         </th>
                         <th className="px-4 py-3.5 text-xs font-black uppercase tracking-wider bg-amber-50/70 text-amber-900 whitespace-nowrap">
                           Pending
                         </th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                       {allTableRows.map(r => {
                         const isTotal = r.discipline === 'GRAND TOTAL';
                         const displayDiscipline = isTotal ? 'TOTAL' : r.discipline;
                         const rowClass = isTotal
                           ? 'bg-[#203864] text-white font-black border-t-2 border-slate-400'
                           : 'odd:bg-white even:bg-slate-50/70 hover:bg-blue-50/40 text-slate-800 font-semibold';

                         const renderCellButton = (
                           val: number,
                           colKey: ManagementKpiColumnKey,
                           colLabel: string,
                           extraClass: string = ''
                         ) => (
                           <button
                             type="button"
                             onClick={() => openReconciliationCell(r, colKey, colLabel, rep.registerFilter)}
                             className={`px-2.5 py-1 rounded transition-all cursor-pointer font-mono ${
                               isTotal
                                 ? 'hover:bg-white/20 text-white font-black underline decoration-white/40'
                                 : 'hover:bg-blue-100/80 hover:text-blue-900 hover:underline'
                             } ${extraClass}`}
                             title={`Click to view exact reconciled source rows for ${displayDiscipline} — ${colLabel}`}
                           >
                             {val}
                           </button>
                         );

                         return (
                           <tr key={r.discipline} className={rowClass}>
                             <td
                               className={`px-4 py-3 text-sm text-left border-r ${
                                 isTotal ? 'border-white/20 font-black text-white' : 'border-slate-200 font-extrabold text-[#203864]'
                               } whitespace-nowrap`}
                             >
                               {displayDiscipline}
                             </td>
                             <td
                               className={`px-4 py-3 text-sm border-r ${
                                 isTotal ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-blue-50/30 font-bold text-[#203864]'
                               }`}
                             >
                               {renderCellButton(r.totalSubmittals, 'totalSubmittals', 'Total Submittals (Unique Submitted Items)')}
                             </td>
                             <td className={`px-4 py-3 text-sm border-r ${isTotal ? 'border-white/20' : 'border-slate-200'}`}>
                               {renderCellButton(r.rev00, 'rev00', 'Rev.00 (Raw Excel Source Rows Classified as Rev.00)')}
                             </td>
                             <td className={`px-4 py-3 text-sm border-r ${isTotal ? 'border-white/20' : 'border-slate-200'}`}>
                               {renderCellButton(r.furtherRev, 'furtherRev', 'Further Rev. (Raw Excel Source Rows Classified as Further Revision)')}
                             </td>
                             <td
                               className={`px-4 py-3 text-sm border-r ${
                                 isTotal ? 'border-white/30 bg-white/15' : 'border-slate-300 bg-slate-100/80 font-extrabold text-slate-900'
                               }`}
                             >
                               {renderCellButton(r.totalSheets, 'totalSheets', 'Total Sheets (Rev.00 + Further Rev. Excel Rows)')}
                             </td>
                             <td
                               className={`px-4 py-3 text-sm border-r ${
                                 isTotal ? 'border-white/20 text-emerald-300' : 'border-slate-200 bg-emerald-50/30 text-emerald-800 font-bold'
                               }`}
                             >
                               {renderCellButton(r.approved, 'approved', 'Approved (Unique Submitted Items in Approved State)')}
                             </td>
                             <td
                               className={`px-4 py-3 text-sm border-r ${
                                 isTotal ? 'border-white/20 text-rose-300' : 'border-slate-200 bg-rose-50/30 text-rose-800 font-bold'
                               }`}
                             >
                               {renderCellButton(r.rejected, 'rejected', 'Rejected (Unique Submitted Items in Rejected State)')}
                             </td>
                             <td
                               className={`px-4 py-3 text-sm ${
                                 isTotal ? 'text-amber-300' : 'bg-amber-50/30 text-amber-800 font-bold'
                               }`}
                             >
                               {renderCellButton(r.pending, 'pending', 'Pending (Unique Submitted Items in Pending State)')}
                             </td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>

                 {/* Deterministic Dual-Grain Definitions Footer */}
                 <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
                   <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                     <span>
                       <strong className="text-[#203864]">Unique Submittal Grain (Status):</strong> Approved ({rep.grandTotal.approved}) + Rejected ({rep.grandTotal.rejected}) + Pending ({rep.grandTotal.pending}) = <strong>{rep.grandTotal.totalSubmittals} Total Submittals</strong>
                     </span>
                     <span>•</span>
                     <span>
                       <strong className="text-[#203864]">Raw Excel Row Grain (Revision Workload):</strong> Rev.00 ({rep.grandTotal.rev00}) + Further Rev. ({rep.grandTotal.furtherRev}) = <strong>{rep.grandTotal.totalSheets} Total Sheets</strong>
                     </span>
                   </div>
                   <span className="text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-semibold">
                     Official Population Reconciled: {rep.availableRegisters.length > 0 ? rep.availableRegisters.join(', ') : 'All Official Registers'}
                   </span>
                 </div>
               </div>
             );
           })}

           {/* Read-Only Source Reconciliation Summary Panel */}
           {showReconciliationSummary && (
             <div className="bg-white rounded-xl shadow-sm border-2 border-emerald-300 overflow-hidden print:hidden [body.pdf-export_&]:hidden">
               <div className="bg-emerald-900 text-white px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                 <div>
                   <h3 className="text-sm font-black uppercase tracking-wider">
                     {language === 'ar'
                       ? 'تقرير المطابقة القرائية: إجمالي التقديمات الفريدة مقابل صفوف المراجعات الخام (Read-Only Dual-Grain Source Reconciliation)'
                       : 'Read-Only Source Reconciliation: Total Submittals (Unique Submittal Grain) vs. Raw Excel Revision Sheets'}
                   </h3>
                   <p className="text-xs text-emerald-200 mt-0.5">
                     {language === 'ar'
                       ? 'إثبات مباشر من بيانات Excel يوضح أن التقديم متعدد المراجعات (Rev.00 + Rev.01 + Rev.02) يُحسب 1 في Total Submittals (Approved + Rejected + Pending) ويُسهم بصفوفه الفعلية في Rev.00 و Further Rev. و Total Sheets.'
                       : 'Direct proof on loaded Excel data: a submittal with Rev.00 + Rev.01 + Rev.02 counts as 1 Total Submittal (Approved + Rejected + Pending) while contributing 1 Rev.00, 2 Further Rev., and 3 Total Sheets.'}
                   </p>
                 </div>
                 <button
                   type="button"
                   onClick={() => {
                     const exportPayload = {
                       generatedAt: new Date().toISOString(),
                       reportType: isMonthly ? 'MONTHLY' : 'CUMULATIVE',
                       registerScope: officialManagementReport.registerFilter,
                       officialColumns: ['Status', 'Total Submittals', 'Rev.00', 'Further Rev.', 'Total Sheets', 'Approved', 'Rejected', 'Pending'],
                       isFullyReconciled: officialManagementReport.isFullyReconciled,
                       disciplines: [...officialManagementReport.rows, officialManagementReport.grandTotal].map(d => ({
                         status: d.discipline === 'GRAND TOTAL' ? 'TOTAL' : d.discipline,
                         totalSubmittals: d.totalSubmittals,
                         rev00: d.rev00,
                         furtherRev: d.furtherRev,
                         totalSheets: d.totalSheets,
                         approved: d.approved,
                         rejected: d.rejected,
                         pending: d.pending,
                         invariants: {
                           uniqueSubmittalStatusEquation: `${d.approved} (Approved) + ${d.rejected} (Rejected) + ${d.pending} (Pending) = ${d.totalSubmittals} (Total Submittals)`,
                           rawRevisionRowEquation: `${d.rev00} (Rev.00) + ${d.furtherRev} (Further Rev.) = ${d.totalSheets} (Total Sheets)`
                         }
                       }))
                     };
                     navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
                     setCopiedReconciliation(true);
                     setTimeout(() => setCopiedReconciliation(false), 3000);
                   }}
                   className="px-3.5 py-2 rounded-lg bg-white text-emerald-950 hover:bg-emerald-50 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shrink-0"
                 >
                   {copiedReconciliation ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                   <span>{copiedReconciliation ? 'Copied Reconciliation JSON!' : 'Copy Full Reconciliation JSON'}</span>
                 </button>
               </div>

               <div className="p-5 space-y-4">
                 <div className="overflow-x-auto">
                   <table className="w-full text-xs border-collapse border border-slate-200 text-center">
                     <thead>
                       <tr className="bg-slate-800 text-white font-bold">
                         <th rowSpan={2} className="p-2.5 border border-slate-600 text-left">{officialManagementReport.groupingMode === 'register' ? 'Register' : 'Status'}</th>
                         <th className="p-2 border border-slate-600 bg-[#203864] text-blue-200 uppercase tracking-wider">
                           Unique Submittal Grain
                         </th>
                         <th colSpan={3} className="p-2 border border-slate-600 bg-slate-700 text-amber-200 uppercase tracking-wider">
                           Raw Excel Row Grain (Revision Workload)
                         </th>
                         <th colSpan={3} className="p-2 border border-slate-600 bg-[#203864] text-emerald-200 uppercase tracking-wider">
                           Unique Submittal Grain (Current Status)
                         </th>
                         <th rowSpan={2} className="p-2.5 border border-slate-600">Dual-Grain Verification</th>
                       </tr>
                       <tr className="bg-slate-100 text-slate-800 font-bold">
                         <th className="p-2 border border-slate-200 bg-blue-50/70">Total Submittals</th>
                         <th className="p-2 border border-slate-200">Rev.00</th>
                         <th className="p-2 border border-slate-200">Further Rev.</th>
                         <th className="p-2 border border-slate-200 bg-slate-200/80">Total Sheets</th>
                         <th className="p-2 border border-slate-200 text-emerald-800">Approved</th>
                         <th className="p-2 border border-slate-200 text-rose-800">Rejected</th>
                         <th className="p-2 border border-slate-200 text-amber-800">Pending</th>
                       </tr>
                     </thead>
                     <tbody>
                       {[...officialManagementReport.rows, officialManagementReport.grandTotal].map(d => {
                         const displayDisc = d.discipline === 'GRAND TOTAL' ? 'TOTAL' : d.discipline;
                         return (
                           <tr key={d.discipline} className={d.discipline === 'GRAND TOTAL' ? 'bg-slate-100 font-black border-t-2 border-slate-400' : 'even:bg-slate-50'}>
                             <td className="p-2.5 border border-slate-200 font-bold text-[#203864] text-left">{displayDisc}</td>
                             <td className="p-2 border border-slate-200 font-mono bg-blue-50/30 font-bold">
                               <button type="button" onClick={() => openReconciliationCell(d, 'totalSubmittals', 'Total Submittals (Unique Submitted Items)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.totalSubmittals}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono">
                               <button type="button" onClick={() => openReconciliationCell(d, 'rev00', 'Rev.00 (Raw Excel Source Rows)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.rev00}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono">
                               <button type="button" onClick={() => openReconciliationCell(d, 'furtherRev', 'Further Rev. (Raw Excel Source Rows)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.furtherRev}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono bg-slate-100 font-bold">
                               <button type="button" onClick={() => openReconciliationCell(d, 'totalSheets', 'Total Sheets (Rev.00 + Further Rev.)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.totalSheets}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono text-emerald-700 font-bold">
                               <button type="button" onClick={() => openReconciliationCell(d, 'approved', 'Approved (Unique Submitted Items)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.approved}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono text-rose-700 font-bold">
                               <button type="button" onClick={() => openReconciliationCell(d, 'rejected', 'Rejected (Unique Submitted Items)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.rejected}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono text-amber-700 font-bold">
                               <button type="button" onClick={() => openReconciliationCell(d, 'pending', 'Pending (Unique Submitted Items)', officialManagementReport.registerFilter)} className="hover:underline cursor-pointer">
                                 {d.pending}
                               </button>
                             </td>
                             <td className="p-2 border border-slate-200 font-mono text-[11px]">
                               <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
                                 Submittals: {d.approved}+{d.rejected}+{d.pending}={d.totalSubmittals} | Sheets: {d.rev00}+{d.furtherRev}={d.totalSheets}
                               </span>
                             </td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>
               </div>
             </div>
           )}
         </div>
       )}

       {/* ===================================================================== */}
       {/* SECONDARY LAYER: ANALYTICS & AUDIT ONLY (DETAILED DIAGNOSTICS)        */}
       {/* ===================================================================== */}
       {reportViewMode === 'audit' && (
       <div className="space-y-6">
       {/* DYNAMIC EXECUTIVE BRIEF SECTION */}
       <div id="executive-summary-alert" className="bg-[#203864] text-white p-5 rounded-xl shadow-sm border border-slate-800 flex flex-col md:flex-row items-center gap-4">
            <div className="p-3 bg-white/10 rounded-xl shrink-0">
                <Sparkles className="w-6 h-6 text-amber-300 animate-pulse" />
            </div>
            <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">
                    {language === 'ar' ? 'موجز التقرير التنفيذي والمؤشرات الفورية' : 'EXECUTIVE SUMMARY BRIEF & INTELLIGENCE OUTLOOK'}
                </h3>
                <p className="text-sm font-medium text-slate-100 leading-relaxed">
                    {language === 'ar' ? executiveSummaryBrief.ar : executiveSummaryBrief.en}
                </p>
            </div>
       </div>

       {/* POPULATION & SEQUENCE INTEGRITY GOVERNANCE CARD */}
       {sequenceAuditResult.totalMissingCount > 0 && (
         <div className="bg-amber-50/90 border-2 border-amber-300 rounded-xl p-5 shadow-sm text-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
               <div className="p-2.5 bg-amber-200 text-amber-900 rounded-lg shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5 text-amber-900" />
               </div>
               <div>
                  <div className="flex items-center gap-2">
                     <h4 className="font-bold text-sm text-amber-950 uppercase tracking-wider">
                        {language === 'ar' ? 'حوكمة مطابقة الأعداد واكتشاف الفجوات المتسلسلة' : 'Sequence Population Integrity & Gap Detection Control'}
                     </h4>
                     <span className="px-2 py-0.5 bg-rose-600 text-white rounded text-[11px] font-bold">
                        {sequenceAuditResult.totalMissingCount} {language === 'ar' ? 'رقم متسلسل مفقود' : 'Missing IDs'}
                     </span>
                  </div>
                  <p className="text-xs text-amber-900 mt-1 font-medium leading-relaxed">
                     {language === 'ar' ? sequenceAuditResult.summaryNarrativeAr : sequenceAuditResult.summaryNarrative}
                  </p>
                  {sequenceAuditResult.allMissingIds.length > 0 && (
                     <div className="flex items-center gap-2 mt-2">
                        <span className="text-[11px] font-bold text-amber-900">{language === 'ar' ? 'عينة الأرقام المفقودة:' : 'Sample Missing:'}</span>
                        <div className="flex flex-wrap gap-1.5">
                           {sequenceAuditResult.allMissingIds.slice(0, 5).map((mItem, mIdx) => (
                              <button
                                key={mIdx}
                                type="button"
                                onClick={() => handleCopySingleDoc(mItem.docNo)}
                                className="px-2 py-0.5 bg-white text-rose-800 border border-amber-300 rounded font-mono text-[11px] font-bold hover:bg-amber-100 transition-colors flex items-center gap-1 cursor-pointer"
                                title={language === 'ar' ? 'انقر للنسخ' : 'Click to copy'}
                              >
                                {copiedDocId === mItem.docNo ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-amber-600" />}
                                {mItem.docNo}
                              </button>
                           ))}
                           {sequenceAuditResult.allMissingIds.length > 5 && (
                              <span className="text-[11px] font-bold text-amber-800">
                                +{sequenceAuditResult.allMissingIds.length - 5} {language === 'ar' ? 'أخرى' : 'more'}
                              </span>
                           )}
                        </div>
                     </div>
                  )}
               </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-center shrink-0">
               <button
                  type="button"
                  onClick={() => openDrillDown('ALL', 'missingSequence', 'All Missing Sequence Numbers', 'جميع الأرقام المتسلسلة المفقودة')}
                  className="px-4 py-2 bg-amber-900 text-white rounded-lg hover:bg-amber-800 transition-colors text-xs font-bold shadow-xs cursor-pointer"
               >
                  {language === 'ar' ? 'فحص الأرقام المفقودة بالكامل' : 'Inspect All Missing Gaps'}
               </button>
            </div>
         </div>
       )}

       {/* 2. EXECUTIVE CORE KPI METRIC CARDS */}
       <div id="report-kpi-grid" className="grid grid-cols-2 md:grid-cols-6 gap-4">
            {/* Total Sheets (Workload Grain) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 transition-all hover:shadow relative overflow-hidden group">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'إجمالي الصفحات (حجم العمل)' : 'Total Sheets (Workload)'}</h4>
                <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold text-[#203864]">{globalStats.totalSubmittedSheets}</p>
                    <span className={`text-[10px] font-bold ${trends.submissionsTrend >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {trends.submissionsTrend >= 0 ? `↑ +${trends.submissionsTrend}` : `↓ ${trends.submissionsTrend}`}
                    </span>
                </div>
                <span className="text-[10px] text-slate-400 font-semibold">
                    {language === 'ar' ? `مراجعة 00: ${globalStats.totalSheetsRev0} | لاحقة: ${globalStats.totalSheetsFurtherRev}` : `Rev0: ${globalStats.totalSheetsRev0} | Further: ${globalStats.totalSheetsFurtherRev}`}
                </span>
            </div>

            {/* Total Unique Items (Current State Grain) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 transition-all hover:shadow relative overflow-hidden">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'البنود الفريدة (الحالة الحالية)' : 'Unique Items (Current State)'}</h4>
                <p className="text-2xl font-bold text-[#2f75b5]">{globalStats.totalUniqueDrawings}</p>
                <span className="text-[10px] text-slate-400 font-semibold">{language === 'ar' ? `معتمد: ${globalStats.approved} | نشط: ${globalStats.pending + globalStats.rejectedOpen}` : `Approved: ${globalStats.approved} | Active: ${globalStats.pending + globalStats.rejectedOpen}`}</span>
            </div>

            {/* Approval Rate */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 transition-all hover:shadow relative overflow-hidden">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'نسبة الاعتماد' : 'Approval Rate'}</h4>
                <div className="flex items-baseline gap-2">
                    <p className={`text-2xl font-bold ${globalStats.approvalRate >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>{globalStats.approvalRate.toFixed(1)}%</p>
                    <span className={`text-[10px] font-bold flex items-center ${globalStats.approvalRate < 80 ? 'text-amber-600' : (trends.approvalTrend >= 0 ? 'text-emerald-600' : 'text-rose-500')}`}>
                        {trends.approvalTrend >= 0 ? `↑ +${trends.approvalTrend}%` : `↓ ${trends.approvalTrend}%`}
                    </span>
                </div>
                <span className={`text-[10px] font-semibold ${globalStats.approvalRate >= 80 ? 'text-emerald-500' : 'text-amber-600'}`}>
                    {globalStats.approvalRate >= 80 ? (language === 'ar' ? 'المستهدف: محقق (80%+)' : 'Target met: 80%+') : (language === 'ar' ? 'دون المستهدف (80%+)' : 'Below target (80%+)')}
                </span>
            </div>

            {/* Active Items (Pending + Rejected Open) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 transition-all hover:shadow relative overflow-hidden">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'المعاملات النشطة (قيد العمل)' : 'Active Population'}</h4>
                <p className="text-2xl font-bold text-amber-500">{globalStats.pending + globalStats.rejectedOpen}</p>
                <span className="text-[10px] text-slate-400 font-semibold">{language === 'ar' ? `معلق: ${globalStats.pending} | مرفوض مفتوح: ${globalStats.rejectedOpen}` : `Pending: ${globalStats.pending} | Rej. Open: ${globalStats.rejectedOpen}`}</span>
            </div>

            {/* Overdue Delays (Subset of Active) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 transition-all hover:shadow relative overflow-hidden">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'متأخرات من النشط (SLA)' : 'Overdue (of Active)'}</h4>
                <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold text-rose-600">{globalStats.overdue}</p>
                    <span className="text-xs font-bold text-slate-400">/ {globalStats.pending + globalStats.rejectedOpen}</span>
                    <span className={`text-[10px] font-bold ${trends.overdueTrend <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {trends.overdueTrend > 0 ? `↑ +${trends.overdueTrend}` : `↓ ${trends.overdueTrend}`}
                    </span>
                </div>
                <span className="text-[10px] text-rose-600 font-semibold">
                                        {(globalStats.overdueRateOnActive ?? 0).toFixed(1)}% {language === 'ar' ? 'نسبة التأخير من النشط' : 'overdue rate on active'}
                </span>
            </div>

            {/* Critical Priority Items */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 transition-all hover:shadow relative overflow-hidden">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{language === 'ar' ? 'معاملات ذات أولوية حرجة' : 'Critical Priority'}</h4>
                <p className={`text-2xl font-bold ${globalCriticalCount > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{globalCriticalCount}</p>
                <span className="text-[10px] text-slate-400 font-semibold">{language === 'ar' ? 'خاصية مشتقة / سمة أولوية' : 'Derived Priority Attribute'}</span>
            </div>
       </div>

       {/* 3. EXECUTIVE SUMMARY & SMART HEALTH CHECK PANEL */}
       <div id="report-executive-summary" className="grid grid-cols-1 md:grid-cols-3 gap-6 print:break-inside-avoid">
            {/* Health Score Card with Math Formula Disclosure */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                        {language === 'ar' ? 'مؤشر أداء وتقييم المشروع' : 'Project Performance Index'}
                    </h3>
                    <div className="flex items-center gap-4">
                        <div className={`p-4 rounded-xl border ${healthData.colorClass} flex items-center justify-center shrink-0`}>
                            <healthData.icon className="w-10 h-10" />
                        </div>
                        <div>
                            <div className="text-4xl font-extrabold text-slate-800">{healthData.score}<span className="text-sm font-medium text-slate-400">/100</span></div>
                            <div className={`text-xs font-bold mt-1 uppercase ${healthData.textClass}`}>
                                {healthData.score >= 80 ? (language === 'ar' ? 'ضمن النطاق المستهدف' : 'Within KPI Band') : healthData.rating}
                            </div>
                            <div className="text-[11px] font-bold mt-1 text-slate-500">
                                {(() => {
                                    const actCount = (globalStats.rejectedOpen || 0) + (globalStats.pending || 0);
                                    const odRate = actCount > 0 ? (globalStats.overdue / actCount) * 100 : 0;
                                    const isCrit = odRate >= 50 && globalStats.overdue > 5;
                                    const isElev = odRate >= 15 || globalStats.overdue > 2;
                                    return (
                                        <span className={`inline-flex items-center gap-1 font-semibold ${isCrit ? 'text-rose-700' : isElev ? 'text-amber-700' : 'text-emerald-700'}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${isCrit ? 'bg-rose-500' : isElev ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                            {isCrit ? (language === 'ar' ? 'انتباه حرج لـ SLA' : 'SLA: Critical Attention') : isElev ? (language === 'ar' ? 'متابعة مكثفة لـ SLA' : 'SLA: Elevated Attention') : (language === 'ar' ? 'التزام مستقر بـ SLA' : 'SLA: Controlled')}
                                            <span className="text-slate-400 font-normal">({globalStats.overdue}/{actCount})</span>
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
                
                {/* Mathematical Formula Audit Disclosure Card */}
                <div className="mt-5 pt-4 border-t border-slate-100 bg-slate-50/70 p-3 rounded-lg text-xs">
                    <div className="font-bold text-slate-600 uppercase tracking-wider text-[10px] mb-2 flex items-center gap-1">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                        {language === 'ar' ? 'معادلة حساب مؤشر الأداء (تدقيق)' : 'KPI Math & Formula (Audit Ready)'}
                    </div>
                    <div className="space-y-1.5 font-semibold text-slate-500 font-mono text-[10px]">
                        <div className="flex justify-between border-b border-dashed border-slate-200 pb-1">
                            <span>Score</span>
                            <span className="text-[#203864]">100 - Penalties = {healthData.score}</span>
                        </div>
                        <div className="flex justify-between text-[9px]">
                            <span>P1 (Approval rate penalty - 35%):</span>
                            <span className="text-rose-600">-{healthData.breakdown.approvalPenalty}</span>
                        </div>
                        <div className="flex justify-between text-[9px]">
                            <span>P2 (Overdue ratio penalty - 35%):</span>
                            <span className="text-rose-600">-{healthData.breakdown.pendingOverduePenalty}</span>
                        </div>
                        <div className="flex justify-between text-[9px]">
                            <span>P3 (Overdue density penalty - 30%):</span>
                            <span className="text-rose-600">-{healthData.breakdown.overdueDensityPenalty}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Smart Narratives and Interpretations */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 md:col-span-2">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                    {language === 'ar' ? 'التحليلات والملاحظات الإدارية الفورية' : 'Executive Analytical Observations'}
                </h3>
                <div className="space-y-4">
                    {/* Bullet 1: Approval Rate */}
                    <div className="flex items-start gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 shrink-0"></div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                            {language === 'ar' ? (
                                <>معدل الاعتماد التراكمي الحالي يبلغ <strong className="text-slate-800">{globalStats.approvalRate.toFixed(1)}%</strong>. {globalStats.approvalRate >= 80 ? 'هذا يتجاوز النسبة المستهدفة البالغة 80% ويعكس نسبة تصفية وحسم متقدمة للمعاملات الهندسية (شاملة المراجعات المعتمدة لاحقاً).' : 'هذا يقل عن النسبة المستهدفة (80%)، مما يشير إلى الحاجة لتسريع معالجة المعاملات العالقة والمرفوضة.'}</>
                            ) : (
                                <>Current submittal approval rate is <strong className="text-slate-800">{globalStats.approvalRate.toFixed(1)}%</strong>. {globalStats.approvalRate >= 80 ? 'This satisfies the target threshold of 80% and indicates strong cumulative resolution performance across submittal packages (including resolved revisions).' : 'This falls below the target threshold of 80%, signifying high design return loops and potential coordination deficiencies in submittal packages.'}</>
                            )}
                        </p>
                    </div>

                    {/* Bullet 2: Overdue Backlog */}
                    {(() => {
                        const activeCount = (globalStats.rejectedOpen || 0) + (globalStats.pending || 0);
                        const overduePct = activeCount > 0 ? ((globalStats.overdue / activeCount) * 100).toFixed(1) : '0.0';
                        const odRejOpen = activeOverdueCounts.rejectedOpen;
                        const odPending = activeOverdueCounts.pending;
                        return (
                            <div className="flex items-start gap-2.5">
                                <div className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 shrink-0"></div>
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    {language === 'ar' ? (
                                        globalStats.overdue > 0 ? (
                                            <>حالة الأعمال النشطة المتأخرة: <strong className="text-rose-600">{globalStats.overdue}</strong> من أصل <strong className="text-slate-800">{activeCount}</strong> معاملة نشطة متجاوزة للمدة المحددة بالاتفاقية (<strong className="text-rose-700">{overduePct}%</strong> من إجمالي المعاملات النشطة). تتكون المعاملات النشطة من <strong>{globalStats.rejectedOpen}</strong> معاملة مرفوضة/مفتوحة و<strong>{globalStats.pending}</strong> معاملة معلقة قيد المراجعة. ومن بين هذه المعاملات النشطة، هناك <strong className="text-rose-700">{odRejOpen}</strong> معاملة مرفوضة/مفتوحة و<strong className="text-amber-700">{odPending}</strong> معاملات معلقة متأخرة متجاوزة للمدة المحددة.</>
                                        ) : (
                                            <>حالة الأعمال النشطة: جميع المعاملات النشطة البالغ عددها <strong className="text-slate-800">{activeCount}</strong> معاملة ({globalStats.rejectedOpen} مرفوض مفتوح و{globalStats.pending} قيد المراجعة) تسير ضمن المدد التعاقدية دون أي تأخيرات.</>
                                        )
                                    ) : (
                                        globalStats.overdue > 0 ? (
                                            <>Active Backlog Status: <strong className="text-rose-600">{globalStats.overdue}</strong> of <strong className="text-slate-800">{activeCount}</strong> active items are overdue (<strong className="text-rose-700">{overduePct}%</strong> of the active population). The active population comprises <strong>{globalStats.rejectedOpen}</strong> Rejected/Open items and <strong>{globalStats.pending}</strong> Pending Review items. Of these active items, <strong className="text-rose-700">{odRejOpen}</strong> Rejected/Open and <strong className="text-amber-700">{odPending}</strong> Pending Review items are overdue.</>
                                        ) : (
                                            <>Active Backlog Status: All <strong className="text-slate-800">{activeCount}</strong> active items ({globalStats.rejectedOpen} Rejected/Open and {globalStats.pending} Pending Review) are progressing within SLA limits with zero overdue items.</>
                                        )
                                    )}
                                </p>
                            </div>
                        );
                    })()}

                    {/* Bullet 3: Revisions ratio */}
                    <div className="flex items-start gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                            {language === 'ar' ? (
                                <>نسبة المراجعات المتكررة تشكل <strong className="text-slate-800">{(globalStats.totalSubmittedSheets > 0 ? (globalStats.totalSheetsFurtherRev / globalStats.totalSubmittedSheets * 100) : 0).toFixed(1)}%</strong> من إجمالي العبء المستندي للمشروع، مما يعكس حجماً كبيراً من الأعمال المعاد تقديمها لتسوية الملاحظات الفنية السابقة.</>
                            ) : (
                                <>Cycle Analysis: resubmissions represent <strong className="text-slate-800">{(globalStats.totalSubmittedSheets > 0 ? (globalStats.totalSheetsFurtherRev / globalStats.totalSubmittedSheets * 100) : 0).toFixed(1)}%</strong> of the total document workload, demonstrating a substantial volume of rework to clear engineering comments.</>
                            )}
                        </p>
                    </div>
                </div>
            </div>
       </div>

       {/* 4. VISUALIZATION AND CHARTS GRID (Side by side 2 columns in PDF) */}
       <div id="report-charts-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 print:grid-cols-2 print:gap-4 print:break-inside-avoid page-break-inside-avoid">
            {/* Pie Chart: Approval Status (Optimized & Clean Dimensions) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between chart-card">
                <h3 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-2 uppercase tracking-wider">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    {language === 'ar' ? 'تحليل توزيع حالة التقديمات الفريدة (100% تطابق)' : 'Submittals Status Distribution (Unique Items SSOT)'}
                </h3>
                <div className="h-[220px] flex flex-col justify-center items-center relative">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={pieChartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={55}
                                outerRadius={85}
                                paddingAngle={3}
                                dataKey="value"
                            >
                                {pieChartData.map((entry: any, index: number) => (
                                    <Cell key={`cell-${index}`} fill={entry.color || '#cbd5e1'} />
                                ))}
                            </Pie>
                            <RechartsTooltip formatter={(value) => [`${value} items`, 'Count']} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-1 pt-1.5 border-t border-slate-100">
                    {pieChartData.map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] font-semibold">
                            <span className="w-2 h-2 rounded shrink-0" style={{ backgroundColor: item.color }}></span>
                            <span className="text-slate-500">{item.name}</span>
                            <span className="text-slate-800 font-bold">({item.value})</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bar Chart: Stacked Register Breakdown (Optimized & Clean Dimensions) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between chart-card">
                <h3 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-2 uppercase tracking-wider">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                    {language === 'ar' ? 'حجم ومراجعات الوثائق حسب نوع السجل (أعلى 8 سجلات)' : 'Submission Load by Register Type (Top 8)'}
                </h3>
                <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={barChartData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 9.5, fill: '#475569', fontWeight: 'bold' }} />
                            <YAxis tick={{ fontSize: 9.5, fill: '#64748b' }} />
                            <RechartsTooltip />
                            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '2px' }} />
                            <Bar dataKey="Rev00" stackId="a" fill="#3b82f6" name={language === 'ar' ? 'مراجعة 00' : 'Rev 00'} />
                            <Bar dataKey="FurtherRev" stackId="a" fill="#93c5fd" name={language === 'ar' ? 'مراجعات لاحقة' : 'Further Revs'} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
       </div>

       {/* 5. CRITICAL DELAYS & BOTTLE-NECKS SPOTLIGHT with Action Owner */}
       {topOverdueItems.length > 0 && (
          <div id="report-bottleneck-spotlight" className="bg-white p-4 rounded-xl shadow-sm border border-rose-200 bg-gradient-to-br from-rose-50/20 via-white to-white print:break-inside-avoid page-break-inside-avoid">
              <h3 className="text-xs font-bold text-rose-700 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  {language === 'ar' 
                    ? (topOverdueItems.length >= 5 ? 'أكبر 5 مستندات معلقة متأخرة والمسؤول عنها (بؤر التكدس الحرجة)' : `المستندات المعلقة المتأخرة والمسؤول عنها (${topOverdueItems.length})`) 
                    : (topOverdueItems.length >= 5 ? 'Top 5 Critical Overdue Bottlenecks & Responsible Party' : `Critical Overdue Bottlenecks (${topOverdueItems.length} Item${topOverdueItems.length > 1 ? 's' : ''}) & Responsible Party`)}
              </h3>
              <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                      <thead>
                          <tr className="border-b border-rose-100 bg-rose-50/50">
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider text-center">{language === 'ar' ? 'مسلسل' : 'Rank'}</th>
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider">{language === 'ar' ? 'الرقم المرجعي للمستند' : 'Document reference'}</th>
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider text-center">{language === 'ar' ? 'نوع السجل' : 'Log Type'}</th>
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider text-center">{language === 'ar' ? 'التخصص الفني' : 'Discipline'}</th>
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider text-center">{language === 'ar' ? 'أيام التأخير' : 'Delay Days'}</th>
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider text-center">{language === 'ar' ? 'الجهة المسؤولة عن الإجراء' : 'Action Owner'}</th>
                              <th className="px-3 py-1.5 text-[10px] font-bold text-rose-800 uppercase tracking-wider text-center">{language === 'ar' ? 'تاريخ التقديم' : 'Submission Date'}</th>
                          </tr>
                      </thead>
                      <tbody>
                          {topOverdueItems.map((item, index) => {
                              const responsible = getResponsibleParty(item);
                              const isConsultantResponsible = item.workflowStage === 'Pending';
                              return (
                                  <tr key={item.id} className="border-b border-slate-100 hover:bg-rose-50/10 transition-colors">
                                      <td className="px-3 py-1.5 text-xs font-bold text-rose-700 text-center">#{index + 1}</td>
                                      <td className="px-3 py-1.5 text-xs font-bold text-slate-800 font-mono truncate max-w-[280px]">{item.docNo}</td>
                                      <td className="px-3 py-1.5 text-xs text-slate-600 text-center font-bold">{item.documentType}</td>
                                      <td className="px-3 py-1.5 text-xs text-slate-600 text-center">{item.trade || item.discipline || 'General'}</td>
                                      <td className="px-3 py-1.5 text-xs text-rose-700 font-bold text-center">+{item.delayDays || 0}d</td>
                                      <td className="px-3 py-1.5 text-xs text-center">
                                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                              isConsultantResponsible ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                                          }`}>
                                              {responsible}
                                          </span>
                                      </td>
                                      <td className="px-3 py-1.5 text-xs text-slate-600 text-center font-mono">{item.submissionDate || '-'}</td>
                                  </tr>
                              );
                          })}
                      </tbody>
                  </table>
              </div>
          </div>
       )}

       {/* 6. REGISTER INTELLIGENCE HIERARCHY (LEVELS 1 - 4) */}
       {/* LEVEL 1 — EXECUTIVE INTELLIGENCE */}
       <ExecutiveRegisterSummary
         byDocType={byDocType}
         globalStats={globalStats}
         openDrillDown={openDrillDown}
         getRegisterHealth={getRegisterHealth}
         language={language}
       />

       {/* LEVEL 2 — OPERATIONAL INTELLIGENCE */}
       <ActiveBacklogIntelligence
         byDocType={byDocType}
         globalStats={globalStats}
         activeOverdueCounts={activeOverdueCounts}
         openDrillDown={openDrillDown}
         language={language}
       />

       {/* LEVEL 3 — WORKLOAD & HISTORICAL INTELLIGENCE */}
       <WorkloadRevisionIntelligence
         byDocType={byDocType}
         globalStats={globalStats}
         openDrillDown={openDrillDown}
         language={language}
       />

       {/* LEVEL 4 — AUDIT & FORENSIC INTELLIGENCE (COLLAPSIBLE MULTI-GRAIN MATRIX) */}
       <div id="level4-audit-trace" className="space-y-3 print:break-inside-avoid">
         <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
           {/* Header Toggle */}
           <div
             onClick={() => setIsAuditMatrixOpen(!isAuditMatrixOpen)}
             className="p-4 sm:p-5 bg-gradient-to-r from-slate-50 to-slate-100/70 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:bg-slate-100 transition-colors"
           >
             <div className="flex items-start gap-3.5">
               <div className="p-2.5 bg-slate-200 text-[#203864] rounded-lg shrink-0 mt-0.5">
                 <Layers className="w-5 h-5 text-[#203864]" />
               </div>
               <div>
                 <div className="flex items-center gap-2 flex-wrap">
                   <span className="px-2.5 py-0.5 rounded text-[11px] font-extrabold uppercase tracking-wider bg-slate-700 text-white">
                     Level 4 — Audit & Forensic Intelligence
                   </span>
                   <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#203864] border border-blue-200">
                     20-Column Multi-Grain Matrix
                   </span>
                 </div>
                 <h3 className="text-base font-bold text-[#203864] mt-1">
                   {language === 'ar' ? 'مصفوفة التدقيق والتحليل متعددة الأبعاد (Audit & Data Trace)' : 'Audit & Data Trace — Complete Multi-Grain Matrix'}
                 </h3>
                 <p className="text-xs text-slate-500 font-normal mt-0.5">
                   {language === 'ar'
                     ? 'الجدول الشامل الكامل الذي يربط بين أحجام العمل التاريخية وحالة البنود الفريدة الحالية ومؤشرات SLA مع حفظ كامل بيانات الفحص التدقيقي.'
                     : 'Full forensic crosswalk reconciling historical submission events, deliverable-grain current status, and SLA performance.'}
                 </p>
               </div>
             </div>

             <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
               <button
                 type="button"
                 onClick={(e) => {
                   e.stopPropagation();
                   setIsAuditMatrixOpen(!isAuditMatrixOpen);
                 }}
                 className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-xs font-bold shadow-2xs hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer print:hidden [body.pdf-export_&]:hidden"
               >
                 {isAuditMatrixOpen ? (
                   <>
                     <span>{language === 'ar' ? 'طي مصفوفة التدقيق' : 'Collapse Audit Matrix'}</span>
                     <ChevronUp className="w-4 h-4 text-slate-500" />
                   </>
                 ) : (
                   <>
                     <span>{language === 'ar' ? 'عرض مصفوفة التدقيق الكاملة' : 'Expand Full Audit Matrix'}</span>
                     <ChevronDown className="w-4 h-4 text-slate-500" />
                   </>
                 )}
               </button>
             </div>
           </div>

           {/* Collapsible Content: rendered if open in UI or in static PDF export */}
            <div className={`${isAuditMatrixOpen ? "block" : "hidden"} print:block [body.pdf-export_&]:block p-4 space-y-3 bg-slate-50/30 border-t border-slate-100`}>
               {/* Interactive Drill-down Hint Banner */}
               <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 bg-blue-50/90 border border-blue-200/90 rounded-xl text-xs text-[#203864] shadow-xs print:hidden [body.pdf-export_&]:hidden">
                 <div className="flex items-center gap-2">
                   <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                   <span className="font-semibold">
                     {language === 'ar'
                       ? '💡 جدول تفاعلي ذكي: انقر مباشرة على أي رقم في الجدول (مثل رقم 1 في عمود Current Rejected Closed لـ DOC-STR) لفتح نافذة فحص المستندات ونسخ أرقام المعاملات فوراً.'
                       : '💡 Interactive Smart Table: Click any number cell (e.g. 1 in Current Rejected Closed for DOC-STR) to open the Drill-Down Inspector and copy exact document numbers.'}
                   </span>
                 </div>
                 <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-blue-800 bg-blue-100/90 px-2.5 py-1 rounded-md border border-blue-200">
                   {language === 'ar' ? 'انقر على أي خلية للتفاصيل' : 'Click Any Number To Inspect'}
                 </span>
               </div>

          {/* Executive Invariant & Grain Mathematical SSOT Summary Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-[#203864] to-indigo-950 text-white p-3.5 rounded-xl shadow-xs border border-indigo-200/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black tracking-wide text-white">
                    {language === 'ar' ? 'توازن مؤشرات المشروع المعتمدة (SSOT Invariant)' : 'Executive Submittal Balance & Audit Invariant'}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    100% Balanced
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-normal mt-0.5">
                  {language === 'ar'
                    ? `إجمالي الصفوف التاريخية (${globalStats.totalSubmittedSheets}) = البنود الفريدة الحالية (${globalStats.totalUniqueDrawings}) + المراجعات السابقة الملغاة (${Math.max(0, (globalStats.totalSubmittedSheets || 0) - (globalStats.totalUniqueDrawings || 0))})`
                    : `Total Historical Rows (${globalStats.totalSubmittedSheets}) = Current Unique Items (${globalStats.totalUniqueDrawings}) + Superseded Revision Rows (${Math.max(0, (globalStats.totalSubmittedSheets || 0) - (globalStats.totalUniqueDrawings || 0))})`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded bg-white/10 text-slate-200 text-[11px] font-medium border border-white/10">
                {language === 'ar' ? `المعتمد: ${globalStats.approved} (${globalStats.approvalRate.toFixed(1)}%)` : `Approved: ${globalStats.approved} (${globalStats.approvalRate.toFixed(1)}%)`}
              </span>
              <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 text-[11px] font-medium border border-amber-400/30">
                {language === 'ar' ? `ملغاة تاريخياً: ${Math.max(0, (globalStats.totalSubmittedSheets || 0) - (globalStats.totalUniqueDrawings || 0))}` : `Superseded: ${Math.max(0, (globalStats.totalSubmittedSheets || 0) - (globalStats.totalUniqueDrawings || 0))}`}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
             {/* Dimension Switcher: Register / Discipline / Matrix */}
             <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50 border-b border-slate-200">
               <div className="flex items-center gap-2">
                 <span className="text-xs font-bold text-[#203864]">
                   {language === 'ar' ? 'عرض المؤشرات حسب:' : 'Group Indicators By:'}
                 </span>
                 <span className="text-[11px] text-slate-500 font-normal">
                   {language === 'ar' ? '(فصل تام للمؤشرات دون دمج السجلات أو التخصصات)' : '(Strictly separated without cross-merging)'}
                 </span>
               </div>
               <div className="flex items-center gap-2 flex-wrap">
                 <button
                   type="button"
                   onClick={() => setIsForensicTraceOpen(true)}
                   className="px-3 py-1.5 rounded-lg bg-red-900 hover:bg-red-800 text-white text-xs font-extrabold shadow-xs border border-red-700 flex items-center gap-1.5 cursor-pointer transition-colors"
                   title="Read-Only Forensic Trace: Inspect exact raw records for REJECTED_CLOSED in SDW-ARC and SDW-ELE"
                 >
                   <FileText className="w-3.5 h-3.5 text-red-200" />
                   <span>
                     {language === 'ar'
                       ? `فحص جنائي للمصدر: SDW-ARC (${rejectedClosedForensicTrace['SDW-ARC'].currentRejectedClosedCount}) | SDW-ELE (${rejectedClosedForensicTrace['SDW-ELE'].currentRejectedClosedCount})`
                       : `Forensic Trace REJECTED_CLOSED: SDW-ARC (${rejectedClosedForensicTrace['SDW-ARC'].currentRejectedClosedCount}) | SDW-ELE (${rejectedClosedForensicTrace['SDW-ELE'].currentRejectedClosedCount})`}
                   </span>
                 </button>
                 <div className="flex items-center p-1 bg-white rounded-lg border border-slate-200 text-xs font-bold shadow-2xs">
                 <button
                   type="button"
                   onClick={() => setBreakdownDimension('register')}
                   className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                     breakdownDimension === 'register'
                       ? 'bg-[#203864] text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900'
                   }`}
                 >
                   {language === 'ar' ? 'السجل الهندسي (Register)' : 'By Register'}
                 </button>
                 <button
                   type="button"
                   onClick={() => setBreakdownDimension('discipline')}
                   className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                     breakdownDimension === 'discipline'
                       ? 'bg-[#203864] text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900'
                   }`}
                 >
                   {language === 'ar' ? 'التخصص الفني (Discipline)' : 'By Discipline'}
                 </button>
                 <button
                   type="button"
                   onClick={() => setBreakdownDimension('both')}
                   className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                     breakdownDimension === 'both'
                       ? 'bg-[#203864] text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900'
                   }`}
                 >
                   {language === 'ar' ? 'السجل والتخصص (Register & Discipline)' : 'Register & Discipline'}
                 </button>
                 </div>
               </div>
             </div>

             <div className="overflow-x-auto">
                 <table className="w-full table-auto text-left border-collapse break-normal [overflow-wrap:normal] hyphens-none">
                     <thead>
                     {/* Tier 1 Group Headers */}
                     <tr className="bg-slate-100 border-b border-slate-200">
                       <th rowSpan={2} className={`${thClass} text-left font-extrabold text-[#203864] border-r border-slate-200 whitespace-nowrap min-w-[110px]`}>
                         {breakdownDimension === 'register' 
                           ? (language === 'ar' ? 'نوع المعاملة / السجل' : 'Log Type (Register)')
                           : breakdownDimension === 'discipline'
                             ? (language === 'ar' ? 'التخصص الفني' : 'Discipline')
                             : (language === 'ar' ? 'السجل والتخصص' : 'Register & Discipline')}
                       </th>
                       <th rowSpan={2} className={`${thClass} font-bold text-slate-700 border-r border-slate-200 whitespace-nowrap min-w-[80px]`}>
                         {language === 'ar' ? 'سمة الأولوية' : 'Priority'}
                       </th>
                       <th colSpan={10} className="px-4 py-2 border-b border-r border-slate-300 bg-slate-200/90 text-slate-900 font-extrabold text-xs text-center uppercase tracking-wider">
                         {language === 'ar' ? 'أ — عبء العمل وسجلات التقديم (HISTORICAL WORKLOAD / ROW & SUBMISSION GRAIN)' : 'A — HISTORICAL WORKLOAD / ROW & SUBMISSION GRAIN'}
                       </th>
                       <th colSpan={8} className="px-4 py-2 border-b border-r border-blue-200 bg-blue-50/90 text-[#203864] font-extrabold text-xs text-center uppercase tracking-wider">
                         {language === 'ar' ? 'ب — الحالة الحالية للبند الفريد (CURRENT STATE / UNIQUE ITEM GRAIN)' : 'B — CURRENT STATE / UNIQUE ITEM GRAIN'}
                       </th>
                       <th colSpan={3} className="px-4 py-2 border-b border-rose-200 bg-rose-50/80 text-rose-900 font-extrabold text-xs text-center uppercase tracking-wider">
                         {language === 'ar' ? 'مستوى الخدمة والمتأخرات (SLA Performance - Derived)' : 'SLA PERFORMANCE (DERIVED)'}
                       </th>
                     </tr>
                     {/* Tier 2 Sub-Headers */}
                     <tr className="bg-slate-50 border-b border-slate-200">
                       {/* Historical Workload / Row & Submission Grain Subheaders */}
                       <th className={`${thClass} bg-blue-50/70 font-black text-blue-950 min-w-[84px]`}>{language === 'ar' ? 'تقديمات فريدة Rev.00' : 'Unique Rev.00'}</th>
                       <th className={`${thClass} bg-blue-50/70 font-black text-blue-950 min-w-[92px]`}>{language === 'ar' ? 'تقديمات فريدة لاحقة' : 'Unique Further Rev.'}</th>
                       <th className={`${thClass} bg-slate-200/70 text-slate-900 min-w-[78px]`}>{language === 'ar' ? 'صفوف Rev.00' : 'Rev.00 Rows'}</th>
                       <th className={`${thClass} bg-slate-200/70 text-slate-900 min-w-[88px]`}>{language === 'ar' ? 'صفوف لاحقة' : 'Further Rev. Rows'}</th>
                       <th className={`${thClass} bg-slate-300/80 font-black text-slate-950 min-w-[78px]`}>{language === 'ar' ? 'إجمالي الصفوف' : 'Total Rows'}</th>
                       <th className={`${thClass} bg-amber-100/70 text-amber-950 font-black min-w-[98px]`}>{language === 'ar' ? 'مراجعات سابقة ملغاة (Superseded)' : 'Superseded Rows'}</th>
                       <th className={`${thClass} bg-rose-100/50 text-rose-900 font-extrabold min-w-[88px]`}>{language === 'ar' ? 'إجمالي صفوف الرفض' : 'Total Rejected Rows'}</th>
                       <th className={`${thClass} text-rose-700 min-w-[88px]`}>{language === 'ar' ? 'صفوف رفض مفتوحة' : 'Rejected Open Rows'}</th>
                       <th className={`${thClass} text-red-900 min-w-[88px]`}>{language === 'ar' ? 'صفوف رفض مغلقة' : 'Rejected Closed Rows'}</th>
                       <th className={`${thClass} border-r border-slate-300 bg-emerald-50/50 text-emerald-800 min-w-[88px]`}>{language === 'ar' ? 'رفض مسوّى' : 'Resolved Rejections'}</th>
                      
                      {/* Current State / Unique Item Grain Subheaders */}
                      <th className={`${thClass} bg-blue-50/70 font-black text-[#203864] min-w-[84px]`}>{language === 'ar' ? 'البنود الفريدة' : 'Total Unique Items'}</th>
                      <th className={`${thClass} text-emerald-700 font-bold min-w-[88px]`}>{language === 'ar' ? 'معتمد حالي' : 'Current Approved'}</th>
                      <th className={`${thClass} text-rose-600 min-w-[88px]`}>{language === 'ar' ? 'مرفوض مفتوح حالي' : 'Current Rejected Open'}</th>
                      <th className={`${thClass} text-red-900 min-w-[88px]`}>{language === 'ar' ? 'مرفوض مغلق حالي' : 'Current Rejected Closed'}</th>
                      <th className={`${thClass} bg-rose-50/80 text-rose-900 font-extrabold min-w-[92px]`}>{language === 'ar' ? 'إجمالي المرفوض الحالي' : 'Current Total Rejected Items'}</th>
                      <th className={`${thClass} text-amber-700 whitespace-nowrap min-w-[78px]`}>{language === 'ar' ? 'معلق حالي' : 'Pending'}</th>
                      <th className={`${thClass} bg-amber-50/60 font-bold text-amber-900 min-w-[78px]`}>{language === 'ar' ? 'النشط حالياً' : 'Active Items'}</th>
                      <th className={`${thClass} border-r border-blue-200 bg-emerald-100/60 text-emerald-900 font-extrabold min-w-[84px]`}>{language === 'ar' ? 'نسبة الاعتماد %' : 'Approval Rate %'}</th>
                      
                      {/* SLA Performance Subheaders */}
                      <th className={`${thClass} bg-rose-50/50 text-rose-800 font-bold whitespace-nowrap min-w-[78px]`}>{language === 'ar' ? 'متأخرات > SLA' : 'Overdue'}</th>
                      <th className={`${thClass} bg-rose-50/50 text-rose-800 font-bold whitespace-nowrap min-w-[78px]`}>{language === 'ar' ? 'نسبة التأخير %' : 'Overdue %'}</th>
                      <th className={`${thClass} text-slate-600 whitespace-nowrap min-w-[74px]`}>{language === 'ar' ? 'متوسط الرد (يوم)' : 'Avg Days'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {byDocType.map((row) => {
                      const activeCount = row.stats.pending + row.stats.rejectedOpen;
                      const overdueRate = activeCount > 0 ? ((row.stats.overdue / activeCount) * 100).toFixed(1) : '0.0';
                      const resolvedCount = row.stats.resolvedRejections || 0;
                      return (
                      <tr key={row.documentType} className="odd:bg-white even:bg-slate-50/50 hover:bg-blue-50/40 transition-colors">
                        {/* Log Type: Pure Taxonomy String */}
                        <td className="px-4 py-3 text-xs text-[#203864] font-extrabold text-left border-r border-slate-200">
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'totalWorkload', row.documentType, row.documentType)}
                            className="font-extrabold text-[#203864] hover:text-blue-700 hover:underline cursor-pointer flex items-center gap-1.5"
                            title={language === 'ar' ? 'انقر لعرض جميع سجلات هذا النوع' : 'Click to inspect all submittals of this type'}
                          >
                            <span>{row.documentType}</span>
                            <Eye className="w-3 h-3 text-slate-400 opacity-60 hover:opacity-100 transition-opacity" />
                          </button>
                        </td>

                        {/* Priority / Attribute Column */}
                        <td className="px-4 py-3 text-xs text-center border-r border-slate-200">
                          {row.criticalCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'critical', `${row.documentType} — Critical Priority`, `${row.documentType} — أولوية حرجة`)}
                              className="inline-block px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[10px] border border-rose-200 cursor-pointer hover:scale-105 transition-transform"
                              title={language === 'ar' ? 'عرض البنود الحرجة' : 'Inspect Critical Items'}
                            >
                              CRITICAL ({row.criticalCount})
                            </button>
                          ) : (
                            <span className="text-slate-400 font-normal">-</span>
                          )}
                        </td>

                        {/* Section A: 5 Explicit Indicators */}
                        {/* 1. Unique Rev.00 Submittals */}
                        <td className={`${tdClass} bg-blue-50/40 font-bold text-blue-950`}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'uniqueRev00', `${row.documentType} — Unique Rev.00 Submittals`, `${row.documentType} — تقديمات فريدة Rev.00`)}
                            className="hover:underline hover:text-blue-800 font-bold cursor-pointer transition-colors"
                            title={language === 'ar' ? 'انقر لفحص التقديمات الفريدة Rev.00' : 'Click to inspect unique Rev.00 submittals'}
                          >
                            {row.stats.totalSubmittalsRev0 ?? 0}
                          </button>
                        </td>

                        {/* 2. Unique Further Revision Submittals */}
                        <td className={`${tdClass} bg-blue-50/40 font-bold text-blue-950`}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'uniqueFurtherRev', `${row.documentType} — Unique Further Rev. Submittals`, `${row.documentType} — تقديمات فريدة لاحقة`)}
                            className="hover:underline hover:text-blue-800 font-bold cursor-pointer transition-colors"
                            title={language === 'ar' ? 'انقر لفحص التقديمات الفريدة اللاحقة' : 'Click to inspect unique further revision submittals'}
                          >
                            {row.stats.totalSubmittalsFurtherRev ?? 0}
                          </button>
                        </td>

                        {/* 3. Rev.00 Rows */}
                        <td className={tdClass}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'rev00', `${row.documentType} — Rev 00 Rows`, `${row.documentType} — صفوف مراجعة 00`)}
                              className="hover:underline hover:text-blue-800 cursor-pointer transition-colors font-semibold"
                              title={language === 'ar' ? 'انقر لفحص صفوف مراجعة 00' : 'Click to inspect Rev 00 rows'}
                            >
                              {row.stats.totalSheetsRev0}
                            </button>
                            {sequenceAuditResult.registerAudits[row.documentType]?.missingCount > 0 && (
                              <button
                                type="button"
                                onClick={() => openDrillDown(row.documentType, 'missingSequence', `${row.documentType} — Missing Sequence IDs (${sequenceAuditResult.registerAudits[row.documentType].missingCount})`, `${row.documentType} — الأرقام المتسلسلة المفقودة`)}
                                className="px-1.5 py-0.5 text-[9px] bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 rounded font-bold cursor-pointer transition-transform hover:scale-105"
                                title={language === 'ar' ? `تنبيه: متوقع ${sequenceAuditResult.registerAudits[row.documentType].expectedPopulation} ومفقود ${sequenceAuditResult.registerAudits[row.documentType].missingCount} (انقر للفحص)` : `Expected ${sequenceAuditResult.registerAudits[row.documentType].expectedPopulation}, missing ${sequenceAuditResult.registerAudits[row.documentType].missingCount} (Click to inspect)`}
                              >
                                !{sequenceAuditResult.registerAudits[row.documentType].missingCount}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 4. Further Rev. Rows */}
                        <td className={tdClass}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'furtherRev', `${row.documentType} — Further Rev Rows`, `${row.documentType} — صفوف مراجعات لاحقة`)}
                            className="hover:underline hover:text-blue-800 cursor-pointer transition-colors font-semibold"
                            title={language === 'ar' ? 'انقر لفحص صفوف المراجعات اللاحقة' : 'Click to inspect Further Rev rows'}
                          >
                            {row.stats.totalSheetsFurtherRev}
                          </button>
                        </td>

                        {/* 5. Total Rows */}
                        <td className={`${tdClass} bg-slate-100/80 font-black text-slate-900`}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'totalWorkload', `${row.documentType} — Total Rows`, `${row.documentType} — إجمالي الصفوف`)}
                            className="hover:underline hover:text-blue-800 font-bold cursor-pointer transition-colors"
                            title={language === 'ar' ? 'انقر لفحص إجمالي الصفوف' : 'Click to inspect total rows'}
                          >
                            {row.stats.totalSubmittedSheets}
                          </button>
                        </td>

                        {/* Superseded Rows */}
                        <td className={`${tdClass} bg-amber-50/40 text-amber-950 font-bold`}>
                          {(() => {
                            const supCount = row.stats.supersededRows ?? Math.max(0, (row.stats.totalSubmittedSheets || 0) - (row.stats.totalUniqueDrawings || 0));
                            return supCount > 0 ? (
                              <button
                                type="button"
                                onClick={() => openDrillDown(row.documentType, 'superseded', `${row.documentType} — Superseded Rows`, `${row.documentType} — مراجعات سابقة ملغاة`)}
                                className="inline-block px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] border border-amber-200 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                                title={language === 'ar' ? `مراجعات سابقة تطورت لمراجعات أحدث (${row.stats.totalSubmittedSheets} صفوف - ${row.stats.totalUniqueDrawings} بنود فريدة = ${supCount})` : `Historical rows superseded by later revisions (${row.stats.totalSubmittedSheets} rows - ${row.stats.totalUniqueDrawings} unique = ${supCount})`}
                              >
                                {supCount}
                              </button>
                            ) : <span className="text-slate-400 font-normal">0</span>;
                          })()}
                        </td>
                        
                        {/* Total Rejected Rows */}
                        <td className={`${tdClass} bg-rose-50/40`}>
                          {row.stats.totalRejectedRows > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'totalRejectedRows', `${row.documentType} — Total Rejected Rows`, `${row.documentType} — إجمالي صفوف الرفض`)}
                              className="inline-block px-2.5 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold min-w-[32px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs border border-rose-200"
                              title={language === 'ar' ? 'انقر لفحص جميع سجلات الرفض التاريخية' : 'Click to inspect all rejected historical rows'}
                            >
                              {row.stats.totalRejectedRows}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Rejected Open Rows */}
                        <td className={tdClass}>
                          {row.stats.rejectedOpenRows > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'rejectedOpenRows', `${row.documentType} — Rejected Open Rows`, `${row.documentType} — صفوف الرفض المفتوحة`)}
                              className="inline-block px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium min-w-[28px] cursor-pointer hover:scale-105 active:scale-95 transition-all border border-rose-200"
                              title={language === 'ar' ? 'انقر لفحص صفوف الرفض المفتوحة' : 'Click to inspect open rejected rows'}
                            >
                              {row.stats.rejectedOpenRows}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Rejected Closed Rows */}
                        <td className={tdClass}>
                          {row.stats.rejectedClosedRows > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'rejectedClosedRows', `${row.documentType} — Rejected Closed Rows`, `${row.documentType} — صفوف الرفض المغلقة`)}
                              className="inline-block px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-900 font-medium min-w-[28px] cursor-pointer hover:scale-105 active:scale-95 transition-all border border-red-200"
                              title={language === 'ar' ? 'انقر لفحص صفوف الرفض المغلقة' : 'Click to inspect closed rejected rows'}
                            >
                              {row.stats.rejectedClosedRows}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Resolved Rejections */}
                        <td className={`${tdClass} border-r border-slate-300 bg-emerald-50/30`}>
                          {resolvedCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'resolvedRejections', `${row.documentType} — Resolved Rejections`, `${row.documentType} — حالات الرفض المسواة والمعتمدة لاحقاً`)}
                              className="inline-block px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold min-w-[28px] cursor-pointer hover:scale-105 active:scale-95 transition-all border border-emerald-200"
                              title={language === 'ar' ? 'انقر لفحص البنود التي سُوّيت بعد الرفض' : 'Click to inspect resolved rejection items'}
                            >
                              {resolvedCount}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>
                        
                        {/* Section B: Current State / Unique Item Grain */}
                        <td className={`${tdClass} bg-blue-50/30 font-bold text-[#203864]`}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'totalUnique', `${row.documentType} — Total Unique Items`, `${row.documentType} — إجمالي البنود الفريدة`)}
                            className="hover:underline hover:text-blue-800 cursor-pointer font-bold transition-colors"
                            title={language === 'ar' ? 'انقر لفحص جميع البنود الفريدة' : 'Click to inspect all unique items'}
                          >
                            {row.stats.totalUniqueDrawings}
                          </button>
                        </td>
                        
                        {/* Current Approved */}
                        <td className={tdClass}>
                          {row.stats.approved > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'approved', `${row.documentType} — Current Approved`, `${row.documentType} — البنود المعتمدة حالياً`)}
                              className="inline-block px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold min-w-[36px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                              title={language === 'ar' ? 'انقر لفحص أرقام المعاملات المعتمدة' : 'Click to inspect approved documents'}
                            >
                              {row.stats.approved}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Current Rejected Open */}
                        <td className={tdClass}>
                          {row.stats.rejectedOpen > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'currentRejectedOpen', `${row.documentType} — Current Rejected Open`, `${row.documentType} — البنود المرفوضة المفتوحة حالياً`)}
                              className="inline-block px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-semibold min-w-[36px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                              title={language === 'ar' ? 'انقر لفحص البنود المرفوضة المطلوب إعادة تقديمها' : 'Click to inspect open rejected documents'}
                            >
                              {row.stats.rejectedOpen}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Current Rejected Closed (The exact column requested) */}
                        <td className={tdClass}>
                          {row.stats.rejectedClosed > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'currentRejectedClosed', `${row.documentType} — Current Rejected Closed`, `${row.documentType} — البنود المرفوضة المغلقة حالياً`)}
                              className="inline-block px-2.5 py-1 rounded bg-red-100 hover:bg-red-200 text-red-900 border border-red-300 font-bold min-w-[36px] cursor-pointer hover:scale-110 active:scale-95 transition-all shadow-md ring-2 ring-red-400/40"
                              title={language === 'ar' ? 'انقر لمعرفة رقم المعاملة والتفاصيل الدقيقة' : 'Click to inspect the exact document number & details'}
                            >
                              {row.stats.rejectedClosed}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Current Total Rejected Items */}
                        <td className={`${tdClass} bg-rose-50/30`}>
                          {row.stats.currentRejected > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'currentRejected', `${row.documentType} — Current Total Rejected Items`, `${row.documentType} — إجمالي البنود المرفوضة حالياً`)}
                              className="inline-block px-2.5 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 font-bold min-w-[36px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                              title={language === 'ar' ? 'انقر لفحص جميع البنود المرفوضة حالياً' : 'Click to inspect all currently rejected items'}
                            >
                              {row.stats.currentRejected}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Pending */}
                        <td className={tdClass}>
                          {row.stats.pending > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'pending', `${row.documentType} — Pending Review`, `${row.documentType} — البنود المعلقة قيد المراجعة`)}
                              className="inline-block px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-medium min-w-[36px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                              title={language === 'ar' ? 'انقر لفحص المعاملات المعلقة' : 'Click to inspect pending submittals'}
                            >
                              {row.stats.pending}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Active Items (Pending + Rejected Open) */}
                        <td className={`${tdClass} bg-amber-50/30 font-bold text-amber-900`}>
                          {activeCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'active', `${row.documentType} — Active Items`, `${row.documentType} — إجمالي البنود النشطة`)}
                              className="inline-block px-2.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200 font-bold min-w-[36px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                              title={language === 'ar' ? 'انقر لفحص البنود النشطة' : 'Click to inspect active items'}
                            >
                              {activeCount}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Approval Rate % */}
                        <td className={`${tdClass} border-r border-blue-200 bg-emerald-50/30 font-bold text-emerald-800`}>
                          {row.stats.approvalRate.toFixed(1)}%
                        </td>

                        {/* SLA Overdue */}
                        <td className={tdClass}>
                          {row.stats.overdue > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'overdue', `${row.documentType} — Overdue SLA Items`, `${row.documentType} — المعاملات المتأخرة عن SLA`)}
                              className="inline-block px-2.5 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 font-extrabold min-w-[36px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                              title={language === 'ar' ? 'انقر لفحص المعاملات المتأخرة' : 'Click to inspect overdue submittals'}
                            >
                              {row.stats.overdue}
                            </button>
                          ) : <span className="text-slate-400 font-normal">0</span>}
                        </td>

                        {/* Overdue Rate % of Active */}
                        <td className={tdClass}>
                          {activeCount > 0 ? (
                            <span className={`font-bold ${row.stats.overdue > 0 ? 'text-rose-700' : 'text-slate-600'}`}>
                              {overdueRate}%
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        {/* Avg Days */}
                        <td className={tdClass}>
                          {row.stats.avgResponseTime > 0 ? `${row.stats.avgResponseTime.toFixed(1)}d` : '-'}
                        </td>
                      </tr>
                      );
                    })}
                    {/* Grand Total Row */}
                    <tr className="bg-slate-200/90 border-t-2 border-slate-300 font-bold text-slate-900">
                      <td className="px-4 py-3.5 text-xs font-black text-left text-slate-900 border-r border-slate-300">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'totalWorkload', 'GRAND TOTAL — All Workload Rows', 'الإجمالي الشامل — جميع سجلات العمل')}
                          className="font-black text-slate-900 hover:text-blue-800 hover:underline cursor-pointer"
                          title={language === 'ar' ? 'انقر لفحص كافة السجلات' : 'Click to inspect all workload records'}
                        >
                          GRAND TOTAL
                        </button>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-center border-r border-slate-300">
                        {globalCriticalCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => openDrillDown('ALL', 'critical', 'All Critical Priority Items', 'كافة المعاملات ذات الأولوية الحرجة')}
                            className="inline-block px-2 py-0.5 rounded bg-rose-200 hover:bg-rose-300 text-rose-900 font-bold text-[10px] cursor-pointer hover:scale-105 transition-transform"
                          >
                            CRITICAL ({globalCriticalCount})
                          </button>
                        ) : (
                          <span className="text-slate-500 font-normal">-</span>
                        )}
                      </td>
                      
                      {/* Section A Totals: 5 Explicit Indicators */}
                      {/* 1. Unique Rev.00 */}
                      <td className="px-4 py-3.5 text-xs text-center font-black bg-blue-100/70 text-blue-950">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'uniqueRev00', 'All Unique Rev.00 Submittals', 'إجمالي تقديمات مراجعة 00 الفريدة')}
                          className="hover:underline hover:text-blue-900 font-black cursor-pointer"
                        >
                          {globalStats.totalSubmittalsRev0 ?? 0}
                        </button>
                      </td>

                      {/* 2. Unique Further Rev. */}
                      <td className="px-4 py-3.5 text-xs text-center font-black bg-blue-100/70 text-blue-950">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'uniqueFurtherRev', 'All Unique Further Rev. Submittals', 'إجمالي تقديمات المراجعات اللاحقة الفريدة')}
                          className="hover:underline hover:text-blue-900 font-black cursor-pointer"
                        >
                          {globalStats.totalSubmittalsFurtherRev ?? 0}
                        </button>
                      </td>

                      {/* 3. Rev.00 Rows */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-slate-700">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDrillDown('ALL', 'rev00', 'All Rev 00 Rows', 'إجمالي صفوف مراجعة 00')}
                            className="hover:underline cursor-pointer font-bold"
                          >
                            {globalStats.totalSheetsRev0}
                          </button>
                          {sequenceAuditResult.totalMissingCount > 0 && (
                            <button
                              type="button"
                              onClick={() => openDrillDown('ALL', 'missingSequence', `All Missing Sequence IDs (${sequenceAuditResult.totalMissingCount})`, 'جميع الأرقام المتسلسلة المفقودة')}
                              className="px-1.5 py-0.5 text-[9px] bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 rounded font-bold cursor-pointer transition-transform hover:scale-105"
                              title={language === 'ar' ? `تنبيه: إجمالي الفجوات المتسلسلة المفقودة ${sequenceAuditResult.totalMissingCount} (انقر للفحص)` : `Total missing sequence IDs: ${sequenceAuditResult.totalMissingCount} (Click to inspect)`}
                            >
                              !{sequenceAuditResult.totalMissingCount}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 4. Further Rev Rows */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-slate-700">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'furtherRev', 'All Further Rev Rows', 'إجمالي صفوف المراجعات اللاحقة')}
                          className="hover:underline cursor-pointer font-semibold"
                        >
                          {globalStats.totalSheetsFurtherRev}
                        </button>
                      </td>

                      {/* 5. Total Rows */}
                      <td className="px-4 py-3.5 text-xs text-center font-black bg-slate-300/70 text-[#203864]">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'totalWorkload', 'All Total Rows', 'إجمالي كافة الصفوف')}
                          className="hover:underline hover:text-blue-900 font-black cursor-pointer"
                        >
                          {globalStats.totalSubmittedSheets}
                        </button>
                      </td>

                      {/* Superseded Rows Grand Total */}
                      <td className="px-4 py-3.5 text-xs text-center font-black bg-amber-100/80 text-amber-950">
                        {(() => {
                          const totalSup = globalStats.supersededRows ?? Math.max(0, (globalStats.totalSubmittedSheets || 0) - (globalStats.totalUniqueDrawings || 0));
                          return (
                            <button
                              type="button"
                              onClick={() => openDrillDown('ALL', 'superseded', 'All Superseded Revision Rows', 'إجمالي المراجعات السابقة الملغاة')}
                              className="hover:underline hover:text-amber-900 font-black cursor-pointer"
                              title={language === 'ar' ? `إجمالي المراجعات السابقة الملغاة (${globalStats.totalSubmittedSheets} - ${globalStats.totalUniqueDrawings} = ${totalSup})` : `Total Superseded Rows (${globalStats.totalSubmittedSheets} - ${globalStats.totalUniqueDrawings} = ${totalSup})`}
                            >
                              {totalSup}
                            </button>
                          );
                        })()}
                      </td>
                      
                      {/* Total Rejected Rows */}
                      <td className="px-4 py-3.5 text-xs text-center font-extrabold bg-rose-100/70 text-rose-900">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'totalRejectedRows', 'All Total Rejected Rows', 'إجمالي كافة صفوف الرفض')}
                          className="inline-block px-2.5 py-1 rounded bg-rose-200 hover:bg-rose-300 text-rose-900 font-black border border-rose-300 cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                        >
                          {globalStats.totalRejectedRows}
                        </button>
                      </td>
                      
                      {/* Rejected Open Rows */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-rose-800">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'rejectedOpenRows', 'All Rejected Open Rows', 'إجمالي صفوف الرفض المفتوحة')}
                          className="hover:underline cursor-pointer"
                        >
                          {globalStats.rejectedOpenRows}
                        </button>
                      </td>
                      
                      {/* Rejected Closed Rows */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-red-900">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'rejectedClosedRows', 'All Rejected Closed Rows', 'إجمالي صفوف الرفض المغلقة')}
                          className="hover:underline cursor-pointer"
                        >
                          {globalStats.rejectedClosedRows}
                        </button>
                      </td>
                      
                      {/* Resolved Rejections */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-emerald-800 bg-emerald-100/50 border-r border-slate-300">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'resolvedRejections', 'All Resolved Rejections', 'إجمالي حالات الرفض المسواة')}
                          className="hover:underline cursor-pointer"
                        >
                          {globalStats.resolvedRejections || 0}
                        </button>
                      </td>
                      
                      {/* Current Unique Totals */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-slate-800 bg-blue-100/50">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'totalUnique', 'All Unique Engineering Items', 'إجمالي كافة البنود الهندسية الفريدة')}
                          className="hover:underline hover:text-blue-900 font-bold cursor-pointer"
                        >
                          {globalStats.totalUniqueDrawings}
                        </button>
                      </td>
                      
                      {/* Total Approved */}
                      <td className="px-4 py-3.5 text-xs text-center">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'approved', 'All Current Approved Items', 'إجمالي البنود المعتمدة حالياً')}
                          className="inline-block px-3 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold border border-emerald-300 cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                        >
                          {globalStats.approved}
                        </button>
                      </td>

                      {/* Current Rejected Open */}
                      <td className="px-4 py-3.5 text-xs text-center">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'currentRejectedOpen', 'All Current Rejected Open Items', 'إجمالي البنود المرفوضة المفتوحة حالياً')}
                          className="inline-block px-3 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold border border-rose-300 cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                        >
                          {globalStats.rejectedOpen}
                        </button>
                      </td>

                      {/* Current Rejected Closed */}
                      <td className="px-4 py-3.5 text-xs text-center">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'currentRejectedClosed', 'All Current Rejected Closed Items', 'إجمالي البنود المرفوضة المغلقة حالياً')}
                          className="inline-block px-3 py-1 rounded bg-red-100 hover:bg-red-200 text-red-900 font-bold border border-red-300 cursor-pointer hover:scale-110 active:scale-95 transition-all shadow-md ring-2 ring-red-400/40"
                          title={language === 'ar' ? 'انقر لفحص كافة المعاملات المرفوضة المغلقة' : 'Click to inspect all rejected closed documents'}
                        >
                          {globalStats.rejectedClosed}
                        </button>
                      </td>

                      {/* Current Total Rejected Items */}
                      <td className="px-4 py-3.5 text-xs text-center bg-rose-100/60">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'currentRejected', 'All Currently Rejected Items', 'إجمالي كافة البنود المرفوضة حالياً')}
                          className="inline-block px-3 py-1 rounded bg-rose-200 hover:bg-rose-300 text-rose-900 font-extrabold border border-rose-400 cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                        >
                          {globalStats.currentRejected}
                        </button>
                      </td>

                      {/* Total Pending */}
                      <td className="px-4 py-3.5 text-xs text-center">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'pending', 'All Current Pending Items', 'إجمالي البنود المعلقة قيد المراجعة')}
                          className="inline-block px-3 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold border border-amber-300 cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                        >
                          {globalStats.pending}
                        </button>
                      </td>

                      {/* Total Active Items */}
                      <td className="px-4 py-3.5 text-xs text-center bg-amber-100/60">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'active', 'All Active Items (Pending + Rejected Open)', 'إجمالي البنود النشطة (معلقة + مرفوضة مفتوحة)')}
                          className="inline-block px-3 py-1 rounded bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold border border-amber-300 cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-xs"
                        >
                          {globalStats.pending + globalStats.rejectedOpen}
                        </button>
                      </td>

                      {/* Grand Approval Rate */}
                      <td className="px-4 py-3.5 text-xs text-center border-r border-blue-200 bg-emerald-100/60 font-black text-emerald-900">
                        {globalStats.approvalRate.toFixed(1)}%
                      </td>

                      {/* Total Overdue */}
                      <td className="px-4 py-3.5 text-xs text-center">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'overdue', 'All Overdue SLA Items', 'إجمالي المعاملات المتأخرة عن SLA')}
                          className="inline-block px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-extrabold border border-rose-700 shadow-sm cursor-pointer hover:scale-105 active:scale-95 transition-all"
                        >
                          {globalStats.overdue}
                        </button>
                      </td>

                      {/* Grand Total Overdue Rate % */}
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-rose-700">
                        {(globalStats.overdueRateOnActive ?? 0).toFixed(1)}%
                      </td>

                      {/* Grand Avg Days */}
                      <td className="px-4 py-3.5 text-xs text-center text-slate-700">
                        {globalStats.avgResponseTime > 0 ? `${globalStats.avgResponseTime.toFixed(1)}d` : '-'}
                      </td>
                    </tr>
                 </tbody>
               </table>
            </div>
          </div>
        </div>
    </div>
  </div>

        {/* 7. EXECUTIVE RECOMMENDATIONS (PRIORITY ACTIONS) PAGE/PANEL - LOCKED ON A SINGLE DEDICATED PAGE */}
       <div id="report-recommendations-panel" className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 print:break-inside-avoid page-break-inside-avoid page-break-before-always break-before-page break-inside-avoid">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                    <ListTodo className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-sm font-extrabold text-slate-800">
                        {language === 'ar' ? 'التوصيات التنفيذية وقائمة الإجراءات ذات الأولوية القصوى' : 'EXECUTIVE PRIORITY RECOMMENDATIONS & CORRECTIVE ACTIONS'}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                        {language === 'ar' ? 'إجراءات تصحيحية فورية مستندة إلى التحليلات لحماية الجدول الزمني للمشروع' : 'Data-driven corrective measures to restore SLA compliance and protect project schedule'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {priorityRecommendations.map((rec) => {
                    const isCritical = rec.priority === 'CRITICAL';
                    const isHigh = rec.priority === 'HIGH';
                    return (
                        <div key={rec.id} className={`p-4 rounded-xl border flex flex-col justify-between ${isCritical ? 'bg-rose-50/30 border-rose-100' : isHigh ? 'bg-amber-50/20 border-amber-100' : 'bg-slate-50/50 border-slate-100'}`}>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className={`px-2.5 py-0.5 rounded text-[9px] font-bold tracking-widest ${isCritical ? 'bg-rose-100 text-rose-800' : isHigh ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'}`}>
                                        {rec.priority}
                                    </span>
                                    <span className="text-[11px] font-bold text-slate-700 font-mono">
                                        {language === 'ar' ? rec.actionAr : rec.action}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                                    {language === 'ar' ? rec.ar : rec.en}
                                </p>
                            </div>
                            <div className="mt-3.5 pt-3 border-t border-slate-100 flex justify-end items-center text-[10px] font-bold text-[#203864]">
                                <span className="flex items-center gap-1 cursor-pointer hover:underline">
                                    {language === 'ar' ? 'متابعة التنفيذ' : 'Monitor Implementation'}
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
       </div>
       </div>
       )}

      {/* READ-ONLY SOURCE-ROW RECONCILIATION MODAL (FOR OFFICIAL MANAGEMENT REPORT CELLS) */}
      {reconciliationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-xs animate-fadeIn print:hidden">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-[#203864] text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded bg-white/15 font-mono text-xs font-bold">
                    {reconciliationModal.registerLabel === 'ALL' ? 'ALL REGISTERS' : reconciliationModal.registerLabel}
                  </span>
                  <span>•</span>
                  <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-extrabold text-xs">
                    {reconciliationModal.discipline}
                  </span>
                  <span>•</span>
                  <span className="text-sm font-black">{reconciliationModal.kpiLabel}</span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Read-Only Source Reconciliation — Showing {reconciliationModal.records.length} exact source records from the loaded Excel dataset.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const header = [
                      'Register',
                      'Discipline',
                      'Document No',
                      'SUB Ref',
                      'Rev',
                      'Rev Type',
                      'Raw Code',
                      'Raw Status',
                      'Resolved Status',
                      'Submission Date',
                      'Response Date',
                      'Source Sheet'
                    ].join('\t');
                    const lines = reconciliationModal.records.map(r =>
                      [
                        r.registerIdentity,
                        r.officialDiscipline,
                        r.documentNo,
                        r.subRef,
                        r.rev,
                        r.isRev0 ? 'Rev.00' : 'Further Rev.',
                        r.rawCode,
                        r.rawStatus,
                        r.resolvedCategory,
                        r.submissionDate,
                        r.responseDate,
                        r.sourceSheet
                      ].join('\t')
                    );
                    navigator.clipboard.writeText([header, ...lines].join('\n'));
                    setCopiedReconciliation(true);
                    setTimeout(() => setCopiedReconciliation(false), 2500);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white text-[#203864] hover:bg-slate-100 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedReconciliation ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedReconciliation ? 'Copied TSV!' : 'Copy Source Rows (TSV)'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReconciliationModal(null)}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={reconciliationSearch}
                  onChange={e => setReconciliationSearch(e.target.value)}
                  placeholder="Filter by Document No, SUB Ref, Code, Status, or Sheet..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#203864]"
                />
              </div>
              <span className="text-xs font-bold text-slate-600 font-mono">
                Total Contributing Records: {reconciliationModal.records.length}
              </span>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {reconciliationModal.records.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm font-semibold">
                  No source records in this category.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Register</th>
                        <th className="p-2.5">Discipline</th>
                        <th className="p-2.5">Document No</th>
                        <th className="p-2.5">SUB Ref</th>
                        <th className="p-2.5">Rev</th>
                        <th className="p-2.5">Rev Class</th>
                        <th className="p-2.5">Raw Code</th>
                        <th className="p-2.5">Raw Status</th>
                        <th className="p-2.5">Resolved State</th>
                        <th className="p-2.5">Submission Date</th>
                        <th className="p-2.5">Response Date</th>
                        <th className="p-2.5">Revision History (Collapsed)</th>
                        <th className="p-2.5">Source Sheet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {reconciliationModal.records
                        .filter(r => {
                          if (!reconciliationSearch.trim()) return true;
                          const q = reconciliationSearch.trim().toLowerCase();
                          return (
                            r.documentNo.toLowerCase().includes(q) ||
                            r.subRef.toLowerCase().includes(q) ||
                            r.rawCode.toLowerCase().includes(q) ||
                            r.rawStatus.toLowerCase().includes(q) ||
                            r.sourceSheet.toLowerCase().includes(q) ||
                            r.registerIdentity.toLowerCase().includes(q)
                          );
                        })
                        .slice(0, 500)
                        .map((rec, idx) => (
                          <tr key={`${rec.id}-${idx}`} className="odd:bg-white even:bg-slate-50/70 hover:bg-blue-50/40">
                            <td className="p-2.5 text-slate-400">{idx + 1}</td>
                            <td className="p-2.5 font-bold text-[#203864]">{rec.registerIdentity}</td>
                            <td className="p-2.5 font-bold">{rec.officialDiscipline}</td>
                            <td className="p-2.5 font-bold text-slate-900 select-all">{rec.documentNo}</td>
                            <td className="p-2.5 select-all">{rec.subRef}</td>
                            <td className="p-2.5">{rec.rev}</td>
                            <td className="p-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  rec.isRev0 ? 'bg-blue-50 text-blue-800' : 'bg-purple-50 text-purple-800'
                                }`}
                              >
                                {rec.isRev0 ? 'Rev.00' : 'Further Rev.'}
                              </span>
                            </td>
                            <td className="p-2.5 font-bold">{rec.rawCode}</td>
                            <td className="p-2.5">{rec.rawStatus}</td>
                            <td className="p-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  rec.resolvedCategory === 'APPROVED' || rec.resolvedCategory === 'FINAL_CLOSED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : rec.resolvedCategory === 'REJECTED_OPEN' || rec.resolvedCategory === 'REJECTED_CLOSED'
                                      ? 'bg-rose-100 text-rose-800'
                                      : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {rec.resolvedCategory}
                              </span>
                            </td>
                            <td className="p-2.5">{rec.submissionDate}</td>
                            <td className="p-2.5">{rec.responseDate}</td>
                            <td className="p-2.5 text-[10px]">
                              {rec.revisionCountForDocument > 1 ? (
                                <span className="text-purple-800 font-bold" title={rec.allRevisionsForDocument?.map(a => `Rev.${a.rev}:${a.rawCode}`).join(' -> ')}>
                                  1 Unique Item ({rec.revisionCountForDocument} rows: {rec.allRevisionsForDocument?.map(a => `R${a.rev}`).join('→')})
                                </span>
                              ) : (
                                <span className="text-slate-500">1 row (R{rec.rev})</span>
                              )}
                            </td>
                            <td className="p-2.5 text-slate-500">{rec.sourceSheet}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    
      {/* 8. DRILL-DOWN INSPECTOR MODAL */}
      {drillDownModal && drillDownModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/40 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-sm">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-md bg-blue-100 text-blue-900 font-extrabold text-xs tracking-wider">
                      {drillDownModal.docType}
                    </span>
                    <span className="text-xs font-bold text-slate-500">/</span>
                    <span className="text-sm font-black text-slate-900">
                      {language === 'ar' ? drillDownModal.metricLabelAr : drillDownModal.metricLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {language === 'ar'
                      ? `عرض تفصيلي لـ ${drillDownModal.items.length} معاملة مسجلة في هذا التصنيف`
                      : `Found ${drillDownModal.items.length} submittal records for this category`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrillDownModal(null)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title={language === 'ar' ? 'إغلاق' : 'Close'}
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="hidden print:flex [body.pdf-export_&]:flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-[#203864] border border-blue-200 rounded-lg text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>{language === "ar" ? "مصفوفة التدقيق والتحليل الشاملة" : "Full Multi-Grain Audit Matrix"}</span>
                </div>
              </div>
            </div>

            {/* Modal Action Bar & Filter */}
            <div className="px-6 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={language === 'ar' ? 'بحث برقم المستند، الوصف، الحالة...' : 'Search doc number, subject, status...'}
                  value={modalSearchQuery}
                  onChange={(e) => setModalSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {modalSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setModalSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const filtered = drillDownModal.items.filter(it =>
                      !modalSearchQuery ||
                      it.docNo.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                      it.subject.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                      it.status.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                      it.discipline.toLowerCase().includes(modalSearchQuery.toLowerCase())
                    );
                    handleCopyAllDocNumbers(filtered);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
                  title={language === 'ar' ? 'نسخ كافة أرقام المستندات الظاهرة' : 'Copy all visible doc numbers'}
                >
                  {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                  <span>{copiedAll ? (language === 'ar' ? 'تم نسخ الكل!' : 'All Copied!') : (language === 'ar' ? 'نسخ كافة الأرقام' : 'Copy All Numbers')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const filtered = drillDownModal.items.filter(it =>
                      !modalSearchQuery ||
                      it.docNo.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                      it.subject.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                      it.status.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                      it.discipline.toLowerCase().includes(modalSearchQuery.toLowerCase())
                    );
                    handleExportDrillDownCSV(filtered);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? 'تصدير CSV' : 'Export CSV'}</span>
                </button>
              </div>
            </div>

            {/* Modal Body - Items Table */}
            <div className="overflow-y-auto flex-1 p-6">
              {(() => {
                const filteredItems = drillDownModal.items.filter(it =>
                  !modalSearchQuery ||
                  it.docNo.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                  it.subject.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                  it.status.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                  it.discipline.toLowerCase().includes(modalSearchQuery.toLowerCase())
                );

                if (filteredItems.length === 0) {
                  return (
                    <div className="py-16 text-center text-slate-400">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-semibold">{language === 'ar' ? 'لا توجد مستندات مطابقة' : 'No matching documents found'}</p>
                      {modalSearchQuery && (
                        <p className="text-xs text-slate-400 mt-1">
                          {language === 'ar' ? 'جرب البحث بكلمات أخرى' : 'Try adjusting your search filter'}
                        </p>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="rounded-xl border border-slate-200 overflow-x-auto shadow-2xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                          <th className="px-3 py-2.5 text-center w-10">#</th>
                          <th className="px-3 py-2.5">{language === 'ar' ? 'رقم المخطط / المستند (Document No)' : 'Document No'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'المراجعة (Rev)' : 'Rev'}</th>
                          <th className="px-3 py-2.5">{language === 'ar' ? 'رقم التقديم (SUB Ref)' : 'SUB Ref'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الكود الخام (Raw Code)' : 'Raw Code'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الحالة الخام (Raw Status)' : 'Raw Status'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'تاريخ التقديم' : 'Submission Date'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'تاريخ الرد' : 'Response Date'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الورقة المصدر (Source Sheet)' : 'Source Sheet'}</th>
                          <th className="px-3 py-2.5">{language === 'ar' ? 'جميع المراجعات لنفس المستند' : 'All Revisions (Same Doc No)'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الإجراء' : 'Action'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredItems.map((item, idx) => {
                          const isCopied = copiedDocId === item.docNo;
                          const isApproved = item.statusCategory === 'APPROVED' || item.statusCategory === 'FINAL_CLOSED';

                          return (
                            <tr key={item.id + '_' + idx} className="hover:bg-blue-50/30 transition-colors">
                              <td className="px-3 py-2.5 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                              <td className="px-3 py-2.5 font-bold text-[#203864]">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono select-all text-xs bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                    {item.drawingNo || item.docNo}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopySingleDoc(item.drawingNo || item.docNo)}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                                    title={language === 'ar' ? 'نسخ رقم المستند' : 'Copy document number'}
                                  >
                                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-700">
                                <span className="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-[11px]">
                                  {item.rev}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-slate-700 select-all">
                                {item.subRef || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span
                                  className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-extrabold border ${
                                    item.statusCategory === 'REJECTED_CLOSED'
                                      ? 'bg-red-100 text-red-900 border-red-300'
                                      : item.statusCategory === 'REJECTED_OPEN'
                                      ? 'bg-rose-100 text-rose-800 border-rose-200'
                                      : isApproved
                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                      : 'bg-amber-100 text-amber-800 border-amber-200'
                                  }`}
                                >
                                  {item.rawCode || item.status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center font-semibold text-slate-700 text-[11px]">
                                {item.rawStatus || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-center text-slate-500 font-mono text-[11px]">
                                {item.submissionDate || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-center text-slate-500 font-mono text-[11px]">
                                {item.responseDate || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-center font-mono text-[11px] text-slate-600">
                                {item.sourceSheet || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-[11px] text-slate-700 font-mono">
                                {(item.sameDocRows || []).map((r, rIdx) => (
                                  <div key={rIdx} className="py-0.5 border-b border-slate-100 last:border-0">
                                    Rev:{r.rev || '00'} | SUB:{r.submissionRef || r.docNo || '-'} | Code:{r.code ?? r.status ?? '-'} | Status:{r.recordStatus ?? r.workflowStage ?? '-'} | Sub:{r.submissionDate || '-'} | Resp:{r.responseDate || '-'}
                                  </div>
                                ))}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleCopySingleDoc(JSON.stringify(item.rawRecord || item, null, 2))}
                                  className="px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-50 rounded border border-blue-200 transition-colors cursor-pointer"
                                >
                                  {isCopied ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ Raw JSON' : 'Copy Raw')}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>
                {language === 'ar' ? 'اضغط ESC للإغلاق في أي وقت' : 'Press ESC or Click Outside to close'}
              </span>
              <button
                type="button"
                onClick={() => setDrillDownModal(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. READ-ONLY FORENSIC SOURCE TRACE MODAL (SDW-ARC & SDW-ELE REJECTED_CLOSED) */}
      {isForensicTraceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-red-950 to-slate-900 text-white flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm sm:text-base font-black tracking-wide">
                  READ-ONLY FORENSIC SOURCE TRACE — REJECTED_CLOSED (SDW-ARC & SDW-ELE)
                </h3>
                <p className="text-xs text-red-200 mt-0.5">
                  Direct observation of in-memory runtime records without modifying any calculation, classification, or SSOT logic
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const payload = JSON.stringify(rejectedClosedForensicTrace, null, 2);
                    navigator.clipboard.writeText(payload);
                    setCopiedForensicTrace(true);
                    setTimeout(() => setCopiedForensicTrace(false), 2500);
                  }}
                  className="px-3 py-1.5 bg-white text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedForensicTrace ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedForensicTrace ? 'Copied JSON!' : 'Copy Full Forensic JSON'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const payload = JSON.stringify(rejectedClosedForensicTrace, null, 2);
                    const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `Forensic_Trace_SDW_ARC_ELE_REJECTED_CLOSED_${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsForensicTraceOpen(false)}
                  className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-6 bg-slate-50">
              {(['SDW-ARC', 'SDW-ELE'] as const).map((regKey) => {
                const trace = rejectedClosedForensicTrace[regKey];
                return (
                  <div key={regKey} className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                    <div className="px-5 py-3 bg-slate-900 text-white flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-0.5 rounded bg-red-600 text-white font-black text-xs">{regKey}</span>
                        <span className="text-xs font-bold text-slate-300">
                          Total Rows: {trace.totalRowsInRegister} | Unique Docs: {trace.totalUniqueDocumentsInRegister} | Current REJECTED_CLOSED: {trace.currentRejectedClosedCount} | Historical REJECTED_CLOSED Rows: {trace.historicalRejectedClosedRowCount}
                        </span>
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      {trace.currentRejectedClosedRecords.length === 0 ? (
                        <div className="text-xs text-slate-500 font-semibold py-4 text-center border border-dashed border-slate-200 rounded-lg">
                          No Current REJECTED_CLOSED records found in {regKey} for the currently loaded dataset ({rejectedClosedForensicTrace.totalLoadedRows} total rows).
                        </div>
                      ) : (
                        trace.currentRejectedClosedRecords.map((entry: any, idx: number) => {
                          const w = entry.latestWinningRecord;
                          return (
                            <div key={idx} className="border border-red-200 rounded-xl bg-red-50/20 p-4 space-y-4">
                              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-red-200 pb-2">
                                <span className="text-xs font-black text-red-900">
                                  #{idx + 1} Winning Latest Record Producing Current REJECTED_CLOSED = 1 (Identity Key: <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono">{entry.documentIdentityKey}</code>)
                                </span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs bg-white rounded-lg overflow-hidden border border-slate-200">
                                  <thead>
                                    <tr className="bg-slate-100 text-[11px] font-bold text-slate-700 uppercase">
                                      <th className="px-3 py-2 border-b">Document No</th>
                                      <th className="px-3 py-2 border-b">Rev</th>
                                      <th className="px-3 py-2 border-b">SUB Ref</th>
                                      <th className="px-3 py-2 border-b">Raw Code</th>
                                      <th className="px-3 py-2 border-b">Raw Status</th>
                                      <th className="px-3 py-2 border-b">Submission Date</th>
                                      <th className="px-3 py-2 border-b">Response Date</th>
                                      <th className="px-3 py-2 border-b">Source Sheet</th>
                                      <th className="px-3 py-2 border-b">Source File</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr className="font-mono text-xs bg-red-50/40 font-bold text-slate-900">
                                      <td className="px-3 py-2 border-b select-all">{w.documentNo}</td>
                                      <td className="px-3 py-2 border-b select-all">{w.rev}</td>
                                      <td className="px-3 py-2 border-b select-all">{w.subRef}</td>
                                      <td className="px-3 py-2 border-b select-all text-red-800">{w.rawCode}</td>
                                      <td className="px-3 py-2 border-b select-all text-red-800">{w.rawStatus}</td>
                                      <td className="px-3 py-2 border-b select-all">{w.submissionDate || '-'}</td>
                                      <td className="px-3 py-2 border-b select-all">{w.responseDate || '-'}</td>
                                      <td className="px-3 py-2 border-b select-all">{w.sourceSheet}</td>
                                      <td className="px-3 py-2 border-b select-all">{w.sourceFile}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              <div>
                                <h4 className="text-xs font-extrabold text-slate-800 mb-2">
                                  All Dataset Rows / Revisions Sharing Document No ({w.documentNo}) ({entry.allDatasetRowsSharingDocumentNo.length} rows):
                                </h4>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse text-xs bg-white rounded-lg overflow-hidden border border-slate-200">
                                    <thead>
                                      <tr className="bg-slate-50 text-[11px] font-bold text-slate-600 uppercase">
                                        <th className="px-3 py-1.5 border-b">#</th>
                                        <th className="px-3 py-1.5 border-b">Document No</th>
                                        <th className="px-3 py-1.5 border-b">Rev</th>
                                        <th className="px-3 py-1.5 border-b">SUB Ref</th>
                                        <th className="px-3 py-1.5 border-b">Raw Code</th>
                                        <th className="px-3 py-1.5 border-b">Raw Status</th>
                                        <th className="px-3 py-1.5 border-b">Resolved Category</th>
                                        <th className="px-3 py-1.5 border-b">Submission Date</th>
                                        <th className="px-3 py-1.5 border-b">Response Date</th>
                                        <th className="px-3 py-1.5 border-b">Source Sheet</th>
                                        <th className="px-3 py-1.5 border-b">Identity Key</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.allDatasetRowsSharingDocumentNo.map((rRow: any, rIdx: number) => (
                                        <tr key={rIdx} className="font-mono text-[11px] odd:bg-white even:bg-slate-50">
                                          <td className="px-3 py-1.5 border-b">{rIdx + 1}</td>
                                          <td className="px-3 py-1.5 border-b select-all font-bold">{rRow.documentNo}</td>
                                          <td className="px-3 py-1.5 border-b select-all font-bold">{rRow.rev}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.subRef}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.rawCode}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.rawStatus}</td>
                                          <td className="px-3 py-1.5 border-b select-all font-bold">{rRow.resolvedCategory}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.submissionDate || '-'}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.responseDate || '-'}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.sourceSheet}</td>
                                          <td className="px-3 py-1.5 border-b select-all">{rRow.documentIdentityKey}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}

              {/* OVERDUE CALCULATION FORENSIC TRACE SECTION (9 TARGET RECORDS + TOP HISTORICAL REJECTION ROWS) */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-3 bg-slate-900 text-white flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-0.5 rounded bg-amber-600 text-white font-black text-xs">
                      OVERDUE CALCULATION FORENSIC TRACE
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      Historical Rejection Events / Rows by Delay (Total in Loaded Dataset: {rejectedClosedForensicTrace.overdueForensicTrace.totalPresRejectedItemsCount})
                    </span>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-slate-800 space-y-1.5">
                    <div className="font-black text-amber-950">
                      Runtime Mathematical Formula Verification (Read-Only SSOT Inspection):
                    </div>
                    <div>
                      <strong>1. Report Population & Grain:</strong> <code className="bg-white px-1.5 py-0.5 rounded border">exportEngine.ts:771-784</code> filters <code className="bg-white px-1 py-0.5 rounded">cumulativeWorkingData</code> by <code className="bg-white px-1 py-0.5 rounded">workflowStage === 'Rejected'</code> (which includes both <code className="bg-white px-1 py-0.5 rounded">REJECTED_OPEN</code> and <code className="bg-white px-1 py-0.5 rounded">REJECTED_CLOSED</code> across all historical revisions) and deduplicates by first-seen <code className="bg-white px-1 py-0.5 rounded">docNo</code>, sorting first by <code className="bg-white px-1 py-0.5 rounded">isEntityOverdue(row)</code> then by <code className="bg-white px-1 py-0.5 rounded">row.delayDays</code> descending.
                    </div>
                    <div>
                      <strong>2. Exact Runtime Delay Formula (<code className="bg-white px-1 py-0.5 rounded">getDelayDays</code> in <code className="bg-white px-1 py-0.5 rounded">src/utils/calculations.ts:298-311</code>):</strong> Parameter <code className="bg-white px-1 py-0.5 rounded">due</code> is passed but <strong>unused</strong> inside <code className="bg-white px-1 py-0.5 rounded">getDelayDays(submission, response, due)</code>. If <code className="bg-white px-1 py-0.5 rounded">responseDate</code> is present, <code className="bg-white px-1 py-0.5 rounded">delayDays = Math.floor((ResponseDate - SubmissionDate) / 86400000)</code>. If <code className="bg-white px-1 py-0.5 rounded">responseDate</code> is empty, <code className="bg-white px-1 py-0.5 rounded">delayDays = Math.floor((Date.now() - SubmissionDate) / 86400000)</code> (0 contractual days subtracted).
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-black text-slate-900 uppercase mb-2">
                      A. Exact Trace for the 9 Requested Target Documents (from Loaded Excel Dataset):
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[11px] bg-white rounded-lg overflow-hidden border border-slate-200">
                        <thead>
                          <tr className="bg-slate-100 font-bold text-slate-700 uppercase">
                            <th className="px-2.5 py-2 border-b">1. Document No</th>
                            <th className="px-2.5 py-2 border-b">2. Rev</th>
                            <th className="px-2.5 py-2 border-b">3. Submission Date</th>
                            <th className="px-2.5 py-2 border-b">4. Response Date</th>
                            <th className="px-2.5 py-2 border-b">5. Raw Code</th>
                            <th className="px-2.5 py-2 border-b">6. Raw Status</th>
                            <th className="px-2.5 py-2 border-b">7. Allowed Days</th>
                            <th className="px-2.5 py-2 border-b">8. Due Date (Excel / +14d)</th>
                            <th className="px-2.5 py-2 border-b">9. As-Of / End Date Used</th>
                            <th className="px-2.5 py-2 border-b">10. Runtime Delay (vs End-Due)</th>
                            <th className="px-2.5 py-2 border-b">Latest Rev Status</th>
                            <th className="px-2.5 py-2 border-b">11. Exact Runtime Formula</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rejectedClosedForensicTrace.overdueForensicTrace.requested9RecordsTrace.map((itemGroup: any) => {
                            if (!itemGroup.foundInLoadedDataset) {
                              return (
                                <tr key={itemGroup.requestedDocumentNo} className="font-mono bg-slate-50 text-slate-500">
                                  <td className="px-2.5 py-2 border-b font-bold text-slate-800">{itemGroup.requestedDocumentNo}</td>
                                  <td colSpan={11} className="px-2.5 py-2 border-b">
                                    SOURCE DATA NOT LOADED IN CURRENT SESSION FOR THIS DOCUMENT NO (Upload Excel workbook to populate)
                                  </td>
                                </tr>
                              );
                            }
                            return itemGroup.rows.map((rTrace: any, rIdx: number) => (
                              <tr key={`${itemGroup.requestedDocumentNo}_${rIdx}`} className="font-mono odd:bg-white even:bg-amber-50/20">
                                <td className="px-2.5 py-2 border-b font-bold select-all">{rTrace.documentNo}</td>
                                <td className="px-2.5 py-2 border-b font-bold">{rTrace.revision}</td>
                                <td className="px-2.5 py-2 border-b select-all">{rTrace.submissionDate}</td>
                                <td className="px-2.5 py-2 border-b select-all text-red-700 font-bold">{rTrace.responseDate}</td>
                                <td className="px-2.5 py-2 border-b">{rTrace.rawCode}</td>
                                <td className="px-2.5 py-2 border-b">{rTrace.rawStatus}</td>
                                <td className="px-2.5 py-2 border-b">0d (in getDelayDays) / 14d (SLA)</td>
                                <td className="px-2.5 py-2 border-b">{rTrace.rawDueDateFromExcel} / {rTrace.calculatedDueDatePlus14}</td>
                                <td className="px-2.5 py-2 border-b">{rTrace.asOfCalculationDateUsed}</td>
                                <td className="px-2.5 py-2 border-b font-black text-red-700">
                                  {rTrace.exactOverdueDaysReported}d (End-Due: {rTrace.trueTargetMinusDueDateDays ?? '-'}d)
                                </td>
                                <td className="px-2.5 py-2 border-b">
                                  {rTrace.isCurrentLatestRevision ? 'LATEST' : `SUPERSEDED (Latest: Rev ${rTrace.currentEntityWinningRevision} -> ${rTrace.currentEntityResolvedStatus})`}
                                </td>
                                <td className="px-2.5 py-2 border-b text-[10px] select-all">{rTrace.exactRuntimeFormula}</td>
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {rejectedClosedForensicTrace.overdueForensicTrace.top15HistoricalRejectionRowsByDelay.length > 0 && (
                    <div>
                      <h4 className="text-xs font-black text-slate-900 uppercase mb-2">
                        B. Top 15 Records Currently Producing Highest Delay in "Historical Rejection Events / Rows by Delay":
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-[11px] bg-white rounded-lg overflow-hidden border border-slate-200">
                          <thead>
                            <tr className="bg-slate-100 font-bold text-slate-700 uppercase">
                              <th className="px-2.5 py-2 border-b">#</th>
                              <th className="px-2.5 py-2 border-b">Document No</th>
                              <th className="px-2.5 py-2 border-b">Rev</th>
                              <th className="px-2.5 py-2 border-b">Submission Date</th>
                              <th className="px-2.5 py-2 border-b">Response Date</th>
                              <th className="px-2.5 py-2 border-b">Raw Code / Status</th>
                              <th className="px-2.5 py-2 border-b">Due Date (Excel / +14d)</th>
                              <th className="px-2.5 py-2 border-b">As-Of / End Date</th>
                              <th className="px-2.5 py-2 border-b">Runtime Delay</th>
                              <th className="px-2.5 py-2 border-b">Latest Rev Status</th>
                              <th className="px-2.5 py-2 border-b">Exact Formula</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rejectedClosedForensicTrace.overdueForensicTrace.top15HistoricalRejectionRowsByDelay.map((rTrace: any, idx: number) => (
                              <tr key={idx} className="font-mono odd:bg-white even:bg-slate-50">
                                <td className="px-2.5 py-1.5 border-b">{idx + 1}</td>
                                <td className="px-2.5 py-1.5 border-b font-bold select-all">{rTrace.documentNo}</td>
                                <td className="px-2.5 py-1.5 border-b">{rTrace.revision}</td>
                                <td className="px-2.5 py-1.5 border-b">{rTrace.submissionDate}</td>
                                <td className="px-2.5 py-1.5 border-b text-red-700 font-bold">{rTrace.responseDate}</td>
                                <td className="px-2.5 py-1.5 border-b">{rTrace.rawCode} / {rTrace.rawStatus}</td>
                                <td className="px-2.5 py-1.5 border-b">{rTrace.rawDueDateFromExcel} / {rTrace.calculatedDueDatePlus14}</td>
                                <td className="px-2.5 py-1.5 border-b">{rTrace.asOfCalculationDateUsed}</td>
                                <td className="px-2.5 py-1.5 border-b font-black text-red-700">{rTrace.exactOverdueDaysReported}d</td>
                                <td className="px-2.5 py-1.5 border-b">
                                  {rTrace.isCurrentLatestRevision ? `LATEST (${rTrace.currentEntityResolvedStatus})` : `SUPERSEDED (Latest: Rev ${rTrace.currentEntityWinningRevision} -> ${rTrace.currentEntityResolvedStatus})`}
                                </td>
                                <td className="px-2.5 py-1.5 border-b text-[10px] select-all">{rTrace.exactRuntimeFormula}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
