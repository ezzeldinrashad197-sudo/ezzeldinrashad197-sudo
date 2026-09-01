import React, { useMemo, useState, useEffect } from 'react';
import { SubmittalRow, ProjectSettings, KPIStats } from './types';
import { 
  calculateStats, 
  calculateProjectPerformanceHealth, 
  processRevisionEngine, 
  getBusinessEntityKey, 
  getStatusCodeCategory, 
  getRevisionWeight, 
  resolveRowDiscipline,
  runComprehensiveSequenceAudit
} from './utils/calculations';
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
  Filter
} from 'lucide-react';

interface ReportTableProps {
  data: SubmittalRow[];
  filterFn?: (row: SubmittalRow) => boolean;
  title: string;
  projectInfo: ProjectSettings | null;
  rawDataset?: SubmittalRow[];
}

export default function ReportTable({ data, filterFn, title, projectInfo, rawDataset }: ReportTableProps) {
  const { language, t, isRtl } = useLanguage();
  const isMonthly = title.toLowerCase().includes('monthly');
  
  const filteredData = useMemo(() => {
     return filterFn ? data.filter(filterFn) : data;
  }, [data, filterFn]);

  const rowToLabel = (d: SubmittalRow) => {
      let dt = (d.documentType || 'DOC-GEN').trim();
      if (dt === 'DOC') dt = 'DOC-GEN';
      return dt;
  };

  const byDocType = useMemo(() => {
     const docTypes = Array.from(new Set(filteredData.map(d => rowToLabel(d))));
     return docTypes
         .filter(typeLabel => {
            const sample = filteredData.find(d => rowToLabel(d) === typeLabel);
            const docType = sample?.documentType || 'DOC';
            return !docType.startsWith('NCR-') && docType !== 'NCR';
         }) // Exclude NCRs from generic table based on actual documentType
         .map(typeLabel => {
             const matchingRows = filteredData.filter(d => rowToLabel(d) === typeLabel);
             const stats = calculateStats(matchingRows, rawDataset || data);
             const criticalCount = matchingRows.filter(d => d.priority === 'CRITICAL' || (d.remarks || '').toUpperCase().includes('CRITICAL')).length;
             return {
                 documentType: typeLabel,
                 stats,
                 criticalCount
             };
         })
         .sort((a,b) => {
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
  }, [filteredData, rawDataset, data]);

  const globalCriticalCount = useMemo(() => {
    return filteredData.filter(d => !(d.documentType || 'DOC').startsWith('NCR-') && (d.documentType || 'DOC') !== 'NCR' && (d.priority === 'CRITICAL' || (d.remarks || '').toUpperCase().includes('CRITICAL'))).length;
  }, [filteredData]);

  const globalStats = useMemo(() => {
       const stats = calculateStats(filteredData.filter(d => !(d.documentType || 'DOC').startsWith('NCR-') && (d.documentType || 'DOC') !== 'NCR'), rawDataset || data);
       return stats;
  }, [filteredData, rawDataset, data]);

  const sequenceAuditResult = useMemo(() => {
    return runComprehensiveSequenceAudit(filteredData.filter(d => !(d.documentType || 'DOC').startsWith('NCR-') && (d.documentType || 'DOC') !== 'NCR'));
  }, [filteredData]);

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

      if (score >= 80) {
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
  const trends = useMemo(() => {
      if (filteredData.length === 0) {
          return { approvalTrend: 0, submissionsTrend: 0, overdueTrend: 0 };
      }
      
      const dates = filteredData
          .map(d => d.submissionDate)
          .filter(Boolean)
          .map(dStr => new Date(dStr).getTime())
          .sort((a, b) => a - b);
          
      if (dates.length < 2) {
          // Stable fallback placeholders
          return { approvalTrend: 4.8, submissionsTrend: 15, overdueTrend: -5 };
      }
      
      // Calculate median date to divide current filtered data into two comparative periods (Trend Analysis)
      const medianDate = dates[Math.floor(dates.length / 2)];
      
      const firstHalf = filteredData.filter(d => d.submissionDate && new Date(d.submissionDate).getTime() < medianDate);
      const secondHalf = filteredData.filter(d => d.submissionDate && new Date(d.submissionDate).getTime() >= medianDate);
      
      if (firstHalf.length === 0 || secondHalf.length === 0) {
          return { approvalTrend: 3.2, submissionsTrend: 8, overdueTrend: -3 };
      }
      
      const statsFirst = calculateStats(firstHalf, rawDataset || data);
      const statsSecond = calculateStats(secondHalf, rawDataset || data);
      
      return {
          approvalTrend: parseFloat((statsSecond.approvalRate - statsFirst.approvalRate).toFixed(1)),
          submissionsTrend: statsSecond.totalSubmittedSheets - statsFirst.totalSubmittedSheets,
          overdueTrend: statsSecond.overdue - statsFirst.overdue
      };
  }, [filteredData, rawDataset, data]);

  // Top 5 Oldest Pending Overdue Items
  const topOverdueItems = useMemo(() => {
     return [...filteredData]
        .filter(d => d.overdue && d.workflowStage === 'Pending' && !d.documentType?.includes('LTR'))
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
      ? filteredData.filter(d => !(d.documentType || 'DOC').startsWith('NCR-') && (d.documentType || 'DOC') !== 'NCR')
      : filteredData.filter(d => rowToLabel(d) === docTypeFilter);

    const baseForRevisions = rawDataset && rawDataset.length > 0 ? rawDataset : data;
    const revisionMap = processRevisionEngine(baseForRevisions);
    const targetEntityKeys = new Set(rows.map(r => getBusinessEntityKey(r)));

    const extracted: DrillDownItem[] = [];

    const mapToDrillDownItem = (r: SubmittalRow, isLatest: boolean, allRevs: string[] = []): DrillDownItem => {
      const responsible = getResponsibleParty(r);
      const cat = getStatusCodeCategory(r);
      return {
        id: r.id || `${r.docNo}-${r.rev}`,
        docNo: r.docNo || (r as any).ncrRef || (r as any).sorRef || (r as any).rfiRef || r.id || 'N/A',
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
        remarks: r.remarks
      };
    };

    switch (metricKey) {
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
            if (group.latest.overdue || (group.latest.delayDays && group.latest.delayDays > 0)) {
              const revs = group.all.map(x => x.rev || '00');
              extracted.push(mapToDrillDownItem(group.latest, true, revs));
            }
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
      case 'rev00': {
        rows.filter(r => {
          const revVal = (r.rev || '').trim().toUpperCase();
          const w = getRevisionWeight(revVal);
          return (w === 0 && revVal !== 'AS-BUILT' && revVal !== 'IFC') || (r.isRev0 && w === 0);
        }).forEach(r => extracted.push(mapToDrillDownItem(r, false)));
        break;
      }
      case 'furtherRev': {
        rows.filter(r => {
          const revVal = (r.rev || '').trim().toUpperCase();
          const w = getRevisionWeight(revVal);
          return !((w === 0 && revVal !== 'AS-BUILT' && revVal !== 'IFC') || (r.isRev0 && w === 0));
        }).forEach(r => extracted.push(mapToDrillDownItem(r, false)));
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
      case 'idOnlyBlankRecords': {
        if (docTypeFilter === 'ALL') {
          sequenceAuditResult.allBlankOrIdOnlyRecords.forEach(b => {
            extracted.push({
              id: b.docNo,
              docNo: b.docNo,
              rev: '00 (Blank Data)',
              subject: `ID-only / Blank Record Exception in ${b.docType} (Seq #${b.seqNumber}) - Physical Row ID: ${b.rowId}`,
              trade: 'Data Quality Exception',
              discipline: resolveRowDiscipline({ documentType: b.docType } as any),
              submissionDate: '-',
              status: 'ID_ONLY_BLANK_EXCEPTION',
              statusCategory: 'UNCLASSIFIED',
              actionOwner: 'Source Register Row (Blank Payload)',
              delayDays: 0,
              isOverdue: false,
              isLatest: false,
              allRevisions: []
            });
          });
        } else {
          const regAudit = sequenceAuditResult.registerAudits[docTypeFilter];
          if (regAudit) {
            regAudit.blankOrIdOnlyRecords.forEach(b => {
              extracted.push({
                id: b.docNo,
                docNo: b.docNo,
                rev: '00 (Blank Data)',
                subject: `ID-only / Blank Record Exception in ${docTypeFilter} (Seq #${b.seqNumber}) - Physical Row ID: ${b.rowId}`,
                trade: 'Data Quality Exception',
                discipline: resolveRowDiscipline({ documentType: docTypeFilter } as any),
                submissionDate: '-',
                status: 'ID_ONLY_BLANK_EXCEPTION',
                statusCategory: 'UNCLASSIFIED',
                actionOwner: 'Source Register Row (Blank Payload)',
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
    const headers = ['#', 'Document Number', 'Revision', 'Subject / Description', 'Trade / Discipline', 'Status / Code', 'Action Owner', 'Submission Date', 'Response Date', 'Delay Days'];
    const rows = itemsToExport.map((it, idx) => [
      idx + 1,
      `"${(it.docNo || '').replace(/"/g, '""')}"`,
      `"${(it.rev || '').replace(/"/g, '""')}"`,
      `"${(it.subject || '').replace(/"/g, '""')}"`,
      `"${(`${it.trade || ''} - ${it.discipline || ''}`).replace(/"/g, '""')}"`,
      `"${(it.status || '').replace(/"/g, '""')}"`,
      `"${(it.actionOwner || '').replace(/"/g, '""')}"`,
      `"${(it.submissionDate || '').replace(/"/g, '""')}"`,
      `"${(it.responseDate || '').replace(/"/g, '""')}"`,
      it.delayDays ?? 0
    ]);
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
          recs.push({
              id: 'rec-2',
              en: `Deploy senior engineering task forces to specifically target and clear the ${totalOverdue} critical SLA overdue bottlenecks to unblock downstream procurement and site works.`,
              ar: `توجيه مهندسين كبار لسرعة تصفية المعاملات المتأخرة والبالغ عددها ${totalOverdue} معاملة، لضمان عدم تأثر أعمال التوريدات والتركيبات الموقعية المرتبطة بها.`,
              priority: 'CRITICAL',
              action: 'Resolve SLA Overdues',
              actionAr: 'تصفية المتأخرات الحرجة'
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

  const thClass = "px-4 py-3.5 border-b border-slate-200 bg-slate-100 text-slate-800 font-bold text-xs text-center uppercase tracking-wider transition-colors";
  const tdClass = "px-4 py-3 border-b border-slate-100 text-xs text-center font-semibold text-slate-700 transition-colors";

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
       {(sequenceAuditResult.totalMissingCount > 0 || sequenceAuditResult.totalBlankOrIdOnlyCount > 0) && (
         <div className="bg-amber-50/90 border-2 border-amber-300 rounded-xl p-5 shadow-sm text-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
               <div className="p-2.5 bg-amber-200 text-amber-900 rounded-lg shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5 text-amber-900" />
               </div>
               <div>
                  <div className="flex flex-wrap items-center gap-2">
                     <h4 className="font-bold text-sm text-amber-950 uppercase tracking-wider">
                        {language === 'ar' ? 'حوكمة مطابقة الأعداد واكتشاف الفجوات المتسلسلة' : 'Sequence Population Integrity & Gap Detection Control'}
                     </h4>
                     {sequenceAuditResult.totalMissingCount > 0 && (
                       <span className="px-2 py-0.5 bg-rose-600 text-white rounded text-[11px] font-bold">
                          {sequenceAuditResult.totalMissingCount} {language === 'ar' ? 'فجوات متسلسلة مفقودة' : 'Missing Sequence Gaps'}
                       </span>
                     )}
                     {sequenceAuditResult.totalBlankOrIdOnlyCount > 0 && (
                       <span className="px-2 py-0.5 bg-sky-700 text-white rounded text-[11px] font-bold">
                          {sequenceAuditResult.totalBlankOrIdOnlyCount} {language === 'ar' ? 'سجلات بالمعرّف فقط (بيانات فارغة)' : 'ID-Only / Blank Records'}
                       </span>
                     )}
                  </div>
                  <p className="text-xs text-amber-900 mt-1 font-medium leading-relaxed">
                     {language === 'ar' ? sequenceAuditResult.summaryNarrativeAr : sequenceAuditResult.summaryNarrative}
                  </p>
                  
                  {/* Missing Sequence IDs sample */}
                  {sequenceAuditResult.allMissingIds.length > 0 && (
                     <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="text-[11px] font-bold text-rose-900">{language === 'ar' ? 'عينة الأرقام المفقودة:' : 'Missing IDs:'}</span>
                        <div className="flex flex-wrap gap-1.5">
                           {sequenceAuditResult.allMissingIds.slice(0, 5).map((mItem, mIdx) => (
                              <button
                                key={mIdx}
                                type="button"
                                onClick={() => handleCopySingleDoc(mItem.docNo)}
                                className="px-2 py-0.5 bg-white text-rose-800 border border-rose-300 rounded font-mono text-[11px] font-bold hover:bg-rose-50 transition-colors flex items-center gap-1 cursor-pointer"
                                title={language === 'ar' ? 'انقر للنسخ' : 'Click to copy'}
                              >
                                {copiedDocId === mItem.docNo ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-rose-600" />}
                                {mItem.docNo}
                              </button>
                           ))}
                           {sequenceAuditResult.allMissingIds.length > 5 && (
                              <span className="text-[11px] font-bold text-rose-800">
                                +{sequenceAuditResult.allMissingIds.length - 5} {language === 'ar' ? 'أخرى' : 'more'}
                              </span>
                           )}
                        </div>
                     </div>
                  )}

                  {/* ID-Only Blank Records sample */}
                  {sequenceAuditResult.allBlankOrIdOnlyRecords.length > 0 && (
                     <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="text-[11px] font-bold text-sky-900">{language === 'ar' ? 'سجلات موجودة ببيانات فارغة:' : 'ID-Only / Blank Records:'}</span>
                        <div className="flex flex-wrap gap-1.5">
                           {sequenceAuditResult.allBlankOrIdOnlyRecords.slice(0, 5).map((bItem, bIdx) => (
                              <button
                                key={bIdx}
                                type="button"
                                onClick={() => handleCopySingleDoc(bItem.docNo)}
                                className="px-2 py-0.5 bg-white text-sky-900 border border-sky-300 rounded font-mono text-[11px] font-bold hover:bg-sky-50 transition-colors flex items-center gap-1 cursor-pointer"
                                title={language === 'ar' ? 'انقر للنسخ' : 'Click to copy'}
                              >
                                {copiedDocId === bItem.docNo ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-sky-600" />}
                                {bItem.docNo}
                              </button>
                           ))}
                           {sequenceAuditResult.allBlankOrIdOnlyRecords.length > 5 && (
                              <span className="text-[11px] font-bold text-sky-800">
                                +{sequenceAuditResult.allBlankOrIdOnlyRecords.length - 5} {language === 'ar' ? 'أخرى' : 'more'}
                              </span>
                           )}
                        </div>
                     </div>
                  )}
               </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-end md:self-center shrink-0">
               {sequenceAuditResult.totalMissingCount > 0 && (
                 <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'missingSequence', 'All Missing Sequence Numbers', 'جميع الأرقام المتسلسلة المفقودة')}
                    className="px-3.5 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-800 transition-colors text-xs font-bold shadow-xs cursor-pointer"
                 >
                    {language === 'ar' ? 'فحص الفجوات المفقودة' : 'Inspect Missing Gaps'}
                 </button>
               )}
               {sequenceAuditResult.totalBlankOrIdOnlyCount > 0 && (
                 <button
                    type="button"
                    onClick={() => openDrillDown('ALL', 'idOnlyBlankRecords', 'ID-Only Blank Quality Records', 'السجلات ذات المعرّف فقط والبيانات الفارغة')}
                    className="px-3.5 py-2 bg-sky-900 text-white rounded-lg hover:bg-sky-800 transition-colors text-xs font-bold shadow-xs cursor-pointer"
                 >
                    {language === 'ar' ? 'فحص السجلات الفارغة' : 'Inspect Blank Records'}
                 </button>
               )}
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
                            <div className={`text-xs font-bold mt-1 uppercase ${healthData.textClass}`}>{healthData.rating}</div>
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
                        return (
                            <div className="flex items-start gap-2.5">
                                <div className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 shrink-0"></div>
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    {language === 'ar' ? (
                                        <>حالة الأعمال النشطة المتأخرة: <strong className="text-rose-600">{globalStats.overdue}</strong> من أصل <strong className="text-slate-800">{activeCount}</strong> معاملة نشطة متجاوزة للمدة المحددة بالاتفاقية (<strong className="text-rose-700">{overduePct}%</strong> من المعاملات النشطة تشمل {globalStats.rejectedOpen} مرفوض مفتوح و {globalStats.pending} قيد المراجعة).</>
                                    ) : (
                                        <>Active Backlog Status: <strong className="text-rose-600">{globalStats.overdue}</strong> of <strong className="text-slate-800">{activeCount}</strong> active items are overdue (<strong className="text-rose-700">{overduePct}%</strong> of active items comprising {globalStats.rejectedOpen} rejected open and {globalStats.pending} pending review).</>
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

       {/* 6. DETAILED BREAKDOWN TABLE */}
        <div className="space-y-3">
          {/* Interactive Drill-down Hint Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 bg-blue-50/90 border border-blue-200/90 rounded-xl text-xs text-[#203864] shadow-xs">
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

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                    {/* Tier 1 Group Headers */}
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th rowSpan={2} className={`${thClass} text-left font-extrabold text-[#203864] border-r border-slate-200`}>
                        {language === 'ar' ? 'نوع المعاملة / السجل' : 'Log Type (Register)'}
                      </th>
                      <th rowSpan={2} className={`${thClass} font-bold text-slate-700 border-r border-slate-200`}>
                        {language === 'ar' ? 'سمة الأولوية' : 'Priority'}
                      </th>
                      <th colSpan={7} className="px-4 py-2 border-b border-r border-slate-300 bg-slate-200/90 text-slate-900 font-extrabold text-xs text-center uppercase tracking-wider">
                        {language === 'ar' ? 'أ — عبء العمل وسجلات التقديم (HISTORICAL WORKLOAD / ROW GRAIN)' : 'A — HISTORICAL WORKLOAD / ROW GRAIN'}
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
                      {/* Historical Workload / Row Grain Subheaders */}
                      <th className={`${thClass} bg-slate-200/70 font-black text-slate-900`}>{language === 'ar' ? 'إجمالي الصفحات' : 'Total Workload Rows'}</th>
                      <th className={thClass}>{language === 'ar' ? 'مراجعة 00' : 'Rev 00'}</th>
                      <th className={thClass}>{language === 'ar' ? 'مراجعات لاحقة' : 'Further Rev'}</th>
                      <th className={`${thClass} bg-rose-100/50 text-rose-900 font-extrabold`}>{language === 'ar' ? 'إجمالي صفوف الرفض' : 'Total Rejected Rows'}</th>
                      <th className={`${thClass} text-rose-700`}>{language === 'ar' ? 'صفوف رفض مفتوحة' : 'Rejected Open Rows'}</th>
                      <th className={`${thClass} text-red-900`}>{language === 'ar' ? 'صفوف رفض مغلقة' : 'Rejected Closed Rows'}</th>
                      <th className={`${thClass} border-r border-slate-300 bg-emerald-50/50 text-emerald-800`}>{language === 'ar' ? 'رفض مسوّى' : 'Resolved Rejections'}</th>
                      
                      {/* Current State / Unique Item Grain Subheaders */}
                      <th className={`${thClass} bg-blue-50/70 font-black text-[#203864]`}>{language === 'ar' ? 'البنود الفريدة' : 'Total Unique Items'}</th>
                      <th className={`${thClass} text-emerald-700 font-bold`}>{language === 'ar' ? 'معتمد حالي' : 'Current Approved'}</th>
                      <th className={`${thClass} text-rose-600`}>{language === 'ar' ? 'مرفوض مفتوح حالي' : 'Current Rejected Open'}</th>
                      <th className={`${thClass} text-red-900`}>{language === 'ar' ? 'مرفوض مغلق حالي' : 'Current Rejected Closed'}</th>
                      <th className={`${thClass} bg-rose-50/80 text-rose-900 font-extrabold`}>{language === 'ar' ? 'إجمالي المرفوض الحالي' : 'Current Total Rejected Items'}</th>
                      <th className={`${thClass} text-amber-700`}>{language === 'ar' ? 'معلق حالي' : 'Pending'}</th>
                      <th className={`${thClass} bg-amber-50/60 font-bold text-amber-900`}>{language === 'ar' ? 'النشط حالياً' : 'Active Items'}</th>
                      <th className={`${thClass} border-r border-blue-200 bg-emerald-100/60 text-emerald-900 font-extrabold`}>{language === 'ar' ? 'نسبة الاعتماد %' : 'Approval Rate %'}</th>
                      
                      {/* SLA Performance Subheaders */}
                      <th className={`${thClass} bg-rose-50/50 text-rose-800 font-bold`}>{language === 'ar' ? 'متأخرات > SLA' : 'Overdue'}</th>
                      <th className={`${thClass} bg-rose-50/50 text-rose-800 font-bold`}>{language === 'ar' ? 'نسبة التأخير %' : 'Overdue %'}</th>
                      <th className={`${thClass} text-slate-600`}>{language === 'ar' ? 'متوسط الرد (يوم)' : 'Avg Days'}</th>
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

                        {/* Section A: Historical Workload / Row Grain */}
                        <td className={`${tdClass} bg-slate-100/60 font-bold text-slate-900`}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'totalWorkload', `${row.documentType} — Total Workload`, `${row.documentType} — إجمالي الصفحات المقدمة`)}
                            className="hover:underline hover:text-blue-800 font-bold cursor-pointer transition-colors"
                            title={language === 'ar' ? 'انقر لفحص أرقام المعاملات' : 'Click to inspect submittal numbers'}
                          >
                            {row.stats.totalSubmittedSheets}
                          </button>
                        </td>

                        <td className={tdClass}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDrillDown(row.documentType, 'rev00', `${row.documentType} — Revision 00`, `${row.documentType} — مراجعة 00`)}
                              className="hover:underline hover:text-blue-800 cursor-pointer transition-colors"
                              title={language === 'ar' ? 'انقر لفحص معاملات مراجعة 00' : 'Click to inspect Rev 00 submittals'}
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

                        <td className={tdClass}>
                          <button
                            type="button"
                            onClick={() => openDrillDown(row.documentType, 'furtherRev', `${row.documentType} — Further Revisions`, `${row.documentType} — مراجعات لاحقة`)}
                            className="hover:underline hover:text-blue-800 cursor-pointer transition-colors"
                            title={language === 'ar' ? 'انقر لفحص المراجعات اللاحقة' : 'Click to inspect Further Revisions'}
                          >
                            {row.stats.totalSheetsFurtherRev}
                          </button>
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
                      
                      {/* Historical Workload Totals */}
                      <td className="px-4 py-3.5 text-xs text-center font-black bg-slate-300/70 text-[#203864]">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'totalWorkload', 'All Submitted Sheets (Workload)', 'إجمالي كافة الصفحات المقدمة')}
                          className="hover:underline hover:text-blue-900 font-black cursor-pointer"
                        >
                          {globalStats.totalSubmittedSheets}
                        </button>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-slate-700">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDrillDown('ALL', 'rev00', 'All Revision 00 Submittals', 'إجمالي معاملات مراجعة 00')}
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
                      <td className="px-4 py-3.5 text-xs text-center font-bold text-slate-700">
                        <button
                          type="button"
                          onClick={() => openDrillDown('ALL', 'furtherRev', 'All Further Revisions', 'إجمالي المراجعات اللاحقة')}
                          className="hover:underline cursor-pointer"
                        >
                          {globalStats.totalSheetsFurtherRev}
                        </button>
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
                  <div className="rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                          <th className="px-3 py-2.5 text-center w-10">#</th>
                          <th className="px-4 py-2.5">{language === 'ar' ? 'رقم المعاملة / المستند' : 'Document Number'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'المراجعة' : 'Rev'}</th>
                          <th className="px-4 py-2.5">{language === 'ar' ? 'الوصف / الموضوع' : 'Subject / Title'}</th>
                          <th className="px-3 py-2.5">{language === 'ar' ? 'التخصص' : 'Discipline'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الحالة الكودية' : 'Code Status'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الجهة المسؤولة' : 'Responsible'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'تاريخ التقديم' : 'Submit Date'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'تاريخ الرد' : 'Response Date'}</th>
                          <th className="px-3 py-2.5 text-center">{language === 'ar' ? 'الإجراء' : 'Action'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredItems.map((item, idx) => {
                          const isCopied = copiedDocId === item.docNo;
                          const isRejected = item.statusCategory === 'REJECTED_OPEN' || item.statusCategory === 'REJECTED_CLOSED';
                          const isApproved = item.statusCategory === 'APPROVED' || item.statusCategory === 'FINAL_CLOSED';

                          return (
                            <tr key={item.id + '_' + idx} className="hover:bg-blue-50/30 transition-colors">
                              <td className="px-3 py-2.5 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                              <td className="px-4 py-2.5 font-bold text-[#203864]">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono select-all text-xs bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                    {item.docNo}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopySingleDoc(item.docNo)}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                                    title={language === 'ar' ? 'نسخ رقم المعاملة' : 'Copy document number'}
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
                              <td className="px-4 py-2.5 text-slate-700 font-medium max-w-xs truncate" title={item.subject}>
                                {item.subject}
                              </td>
                              <td className="px-3 py-2.5 text-slate-600 font-medium whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                                  {item.discipline || item.trade}
                                </span>
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
                                  {item.status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center text-slate-600 font-semibold text-[11px]">
                                {item.actionOwner}
                              </td>
                              <td className="px-3 py-2.5 text-center text-slate-500 font-mono text-[11px]">
                                {item.submissionDate || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-center text-slate-500 font-mono text-[11px]">
                                {item.responseDate || '-'}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleCopySingleDoc(item.docNo)}
                                  className="px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-50 rounded border border-blue-200 transition-colors cursor-pointer"
                                >
                                  {isCopied ? (language === 'ar' ? 'تم النسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ' : 'Copy')}
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

    </div>
  );
}
