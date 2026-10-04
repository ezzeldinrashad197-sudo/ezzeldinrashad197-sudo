import { useState, useMemo, useEffect, useCallback } from 'react';
import { SubmittalRow } from '../types';
import { auth } from '../firebase';

export interface FilterState {
  registerIdentity: string;
  documentType: string;
  discipline: string;
  contractor: string;
  consultant: string;
  logType: string;
  status: string;
  area: string;
  tradeSystem: string;
}

export interface BackendMetricsResult {
  totalRecords: number;
  openRecords: number;
  closedRecords: number;
  approvedRecords: number;
  rejectedOpenRecords: number;
  rejectedClosedRecords: number;
  pendingRecords: number;
  qualityScore: number;
}

const defaultFilters: FilterState = {
  registerIdentity: 'All',
  documentType: 'All',
  discipline: 'All',
  contractor: 'All',
  consultant: 'All',
  logType: 'All',
  status: 'All',
  area: 'All',
  tradeSystem: 'All'
};

export function useFilters(data: SubmittalRow[], startDate: string, endDate: string) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [pendingFilters, setPendingFilters] = useState<FilterState>(defaultFilters);
  const [backendMetrics, setBackendMetrics] = useState<BackendMetricsResult | null>(null);
  const [isCalculatingBackend, setIsCalculatingBackend] = useState<boolean>(false);

  const calculateBackendMetrics = useCallback(async (activeFilters: FilterState, dataset: SubmittalRow[], signal?: AbortSignal) => {
    if (!dataset || dataset.length === 0) {
      setBackendMetrics(null);
      return;
    }
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token || signal?.aborted) {
        return;
      }
      setIsCalculatingBackend(true);
      // Send only the required fields for calculations to keep the payload lightweight
      const lightweightDataset = dataset.map(d => ({
        id: d.id,
        docNo: d.docNo,
        rev: d.rev,
        revision: (d as any).revision || d.rev,
        status: d.status,
        discipline: d.discipline,
        contractor: d.contractor,
        consultant: d.consultant,
        logType: d.logType,
        documentType: d.documentType,
        workflowFamily: d.workflowFamily,
        registerIdentity: d.registerIdentity,
        area: d.area,
        tradeSystem: d.tradeSystem,
        submissionDate: d.submissionDate,
        responseDate: d.responseDate,
        dueDate: d.dueDate,
        action: d.action,
        code: d.code,
        subject: d.subject,
        title: (d as any).title || d.subject
      }));

      const res = await fetch('/api/metrics/calculate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filters: activeFilters, dataset: lightweightDataset }),
        signal
      });
      if (res.ok && !signal?.aborted) {
        const json = await res.json();
        if (json.status === 'success' && json.metrics) {
          setBackendMetrics(json.metrics);
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('[Metrics Layer] Backend metrics delegation warning:', err);
      }
    } finally {
      if (!signal?.aborted) {
        setIsCalculatingBackend(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!data || data.length === 0) {
      setBackendMetrics(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      calculateBackendMetrics(filters, data, controller.signal);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, data, calculateBackendMetrics]);

  const uniqueOpts = useMemo(() => {
     const registerIdentitySet = new Set<string>();
     const documentTypeSet = new Set<string>();
     const disciplineSet = new Set<string>();
     const contractorSet = new Set<string>();
     const consultantSet = new Set<string>();
     const logTypeSet = new Set<string>();
     const statusSet = new Set<string>();
     const areaSet = new Set<string>();
     const tradeSystemSet = new Set<string>();

     for (let i = 0; i < data.length; i++) {
         const d = data[i];
         const reg = (d.registerIdentity || (d as any).sourceRegisterIdentity || '').trim().toUpperCase();
         if (reg && reg !== 'UNCLASSIFIED') {
             registerIdentitySet.add(reg);
         }

         if (d.workflowFamily && d.workflowFamily !== 'UNKNOWN') {
             const wf = d.workflowFamily.toUpperCase().trim();
             if (wf) documentTypeSet.add(wf);
         }
         const dt = d.documentType || d.logType || "GENERAL";
         const prefix = dt.split('-')[0].trim().toUpperCase();
         if (prefix) documentTypeSet.add(prefix);

         if (d.discipline && typeof d.discipline === 'string' && d.discipline.trim()) disciplineSet.add(d.discipline.trim());
         if (d.contractor && typeof d.contractor === 'string' && d.contractor.trim()) contractorSet.add(d.contractor.trim());
         if (d.consultant && typeof d.consultant === 'string' && d.consultant.trim()) consultantSet.add(d.consultant.trim());
         if (d.logType && typeof d.logType === 'string' && d.logType.trim()) logTypeSet.add(d.logType.trim());
         if (d.status && typeof d.status === 'string' && d.status.trim()) statusSet.add(d.status.trim());
         if (d.area && typeof d.area === 'string' && d.area.trim()) areaSet.add(d.area.trim());
         if (d.tradeSystem && typeof d.tradeSystem === 'string' && d.tradeSystem.trim()) tradeSystemSet.add(d.tradeSystem.trim());
     }

     return {
         registerIdentity: Array.from(registerIdentitySet).sort(),
         documentType: Array.from(documentTypeSet).sort(),
         discipline: Array.from(disciplineSet).sort(),
         contractor: Array.from(contractorSet).sort(),
         consultant: Array.from(consultantSet).sort(),
         logType: Array.from(logTypeSet).sort(),
         status: Array.from(statusSet).sort(),
         area: Array.from(areaSet).sort(),
         tradeSystem: Array.from(tradeSystemSet).sort(),
     };
  }, [data]);

  const applyFilters = useCallback(() => {
     setFilters(pendingFilters);
  }, [pendingFilters]);

  const resetFilters = useCallback(() => {
     setFilters(defaultFilters);
     setPendingFilters(defaultFilters);
  }, []);

  const isDirty = useMemo(() => {
     return JSON.stringify(pendingFilters) !== JSON.stringify(filters);
  }, [pendingFilters, filters]);

  const matchesFilters = useCallback((row: SubmittalRow) => {
       const matchOpt = (rowVal: string | undefined | null, filterVal: string) => {
           if (filterVal === 'All') return true;
           if (!rowVal) return false;
           const rv = String(rowVal).trim();
           const fv = String(filterVal).trim();
           if (rv === fv) return true;
           if (rv.toUpperCase() === fv.toUpperCase()) return true;
           
           const rvUpper = rv.toUpperCase();
           const fvUpper = fv.toUpperCase();
           if (rvUpper.startsWith(fvUpper) || fvUpper.startsWith(rvUpper)) return true;
           if (rvUpper.includes(fvUpper) || fvUpper.includes(rvUpper)) return true;
           
           return false;
       };

       // 1. Authoritative Parent Register Filter (Phase W SSOT)
       if (filters.registerIdentity && filters.registerIdentity !== 'All') {
           const targetReg = filters.registerIdentity.toUpperCase().trim();
           const rowReg = (row.registerIdentity || (row as any).sourceRegisterIdentity || row.workflowFamily || '').toUpperCase().trim();
           if (rowReg !== targetReg) {
               return false;
           }
       }

       // 2. Compatibility DocumentType Filter
       if (filters.documentType !== 'All') {
           const target = filters.documentType.toUpperCase().trim();
           const wf = (row.workflowFamily || '').toUpperCase().trim();
           let dt = (row.documentType || row.logType || "GENERAL").toUpperCase().trim();
           const docNo = (row.docNo || '').toUpperCase().trim();
           const prefix = dt.split('-')[0].trim();

           const isRowABD = wf === 'ABD' || dt.startsWith('ABD') || dt.includes('AS-BUILT') || dt.includes('AS BUILT') || docNo.startsWith('ABD-');

           if (target === 'ABD') {
               if (!isRowABD) return false;
           } else if (target === 'SDW' || target === 'SHD') {
               if (isRowABD) return false;
               const matchesWf = wf === 'SDW' || wf === 'SHD';
               const matchesPrefix = prefix === 'SDW' || prefix === 'SHD' || docNo.startsWith('SDW-') || docNo.startsWith('SHD-');
               const matchesDt = dt.includes('SDW') || dt.includes('SHD') || dt.includes('SHOP');
               if (!matchesWf && !matchesPrefix && !matchesDt) return false;
           } else {
               const matchesWf = wf === target || (target === "LTR" && wf === "LETTER");
               const matchesPrefix = prefix === target || docNo.startsWith(`${target}-`);
               const matchesDt = dt.startsWith(target) || dt.includes(target);
               const matchesKeywords = (target === 'LTR' && (dt.includes('CORRES') || dt.includes('LETTER')));

               if (!matchesWf && !matchesPrefix && !matchesDt && !matchesKeywords) return false;
           }
       }

       if (!matchOpt(row.discipline, filters.discipline)) return false;
       if (!matchOpt(row.contractor, filters.contractor)) return false;
       if (!matchOpt(row.consultant, filters.consultant)) return false;
       if (!matchOpt(row.logType, filters.logType)) return false;
       if (!matchOpt(row.status, filters.status)) return false;
       if (!matchOpt(row.area, filters.area)) return false;
       if (!matchOpt(row.tradeSystem, filters.tradeSystem)) return false;
       return true;
  }, [filters]);

  const filterMonthly = useCallback((row: SubmittalRow) => {
     if (!row.submissionDate) return false;
     if (!matchesFilters(row)) return false;
     return row.submissionDate >= startDate && row.submissionDate <= endDate;
  }, [matchesFilters, startDate, endDate]);

  const filterCumulative = useCallback((row: SubmittalRow) => {
     if (!matchesFilters(row)) return false;
     if (!row.submissionDate) return true;
     return row.submissionDate <= endDate;
  }, [matchesFilters, endDate]);

  return {
    filters,
    pendingFilters,
    setPendingFilters,
    applyFilters,
    resetFilters,
    isDirty,
    uniqueOpts,
    matchesFilters,
    filterMonthly,
    filterCumulative,
    backendMetrics,
    isCalculatingBackend
  };
}
