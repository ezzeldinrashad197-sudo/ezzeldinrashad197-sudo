import { SubmittalRow, RegisterSequenceAudit, SequenceAuditResult, SequenceGap, ForensicLedgerEntry } from '../types';
import { getRevisionWeight } from './revisionResolver';
import { getStatusCodeCategory } from './statusResolver';

export interface ParsedDocIdentifier {
  rawDocNo: string;
  prefix: string;
  sequenceNumber: number | null;
  paddingLength: number;
  suffix: string;
  isValidPattern: boolean;
}

/**
 * Parses a document identifier string to extract its prefix, sequence number, padding length, and suffix.
 * Handles patterns like:
 * - WIR-SUR-00009 -> prefix: "WIR-SUR-", seq: 9, padding: 5, suffix: ""
 * - SDW-STR-015 -> prefix: "SDW-STR-", seq: 15, padding: 3, suffix: ""
 * - NCR-0042 -> prefix: "NCR-", seq: 42, padding: 4, suffix: ""
 * - RFI-AR-0001-A -> prefix: "RFI-AR-", seq: 1, padding: 4, suffix: "-A"
 * - 00012 -> prefix: "", seq: 12, padding: 5, suffix: ""
 */
export const parseDocIdentifier = (docNoRaw?: string | null): ParsedDocIdentifier => {
  if (!docNoRaw) {
    return { rawDocNo: '', prefix: '', sequenceNumber: null, paddingLength: 0, suffix: '', isValidPattern: false };
  }
  const raw = String(docNoRaw).trim();
  if (!raw) {
    return { rawDocNo: '', prefix: '', sequenceNumber: null, paddingLength: 0, suffix: '', isValidPattern: false };
  }

  // Pattern 1: Standard Prefix with trailing numeric sequence (e.g., WIR-SUR-00009, SDW-STR-015, NCR-001)
  const prefixMatch = raw.match(/^([A-Za-z0-9_.-]*?[^0-9])(\d+)(\s*[-_./\s][A-Za-z0-9]+)?$/);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const numStr = prefixMatch[2];
    const suffix = prefixMatch[3] || '';
    const num = parseInt(numStr, 10);
    return {
      rawDocNo: raw,
      prefix,
      sequenceNumber: isNaN(num) ? null : num,
      paddingLength: numStr.length,
      suffix,
      isValidPattern: true
    };
  }

  // Pattern 2: Pure number (e.g. 00001, 1999)
  const pureNumMatch = raw.match(/^(\d+)$/);
  if (pureNumMatch) {
    const numStr = pureNumMatch[1];
    const num = parseInt(numStr, 10);
    return {
      rawDocNo: raw,
      prefix: '',
      sequenceNumber: isNaN(num) ? null : num,
      paddingLength: numStr.length,
      suffix: '',
      isValidPattern: true
    };
  }

  // Pattern 3: Embedded number in text (fallback)
  const embeddedMatch = raw.match(/(\d+)/);
  if (embeddedMatch) {
    const numStr = embeddedMatch[1];
    const num = parseInt(numStr, 10);
    const idx = raw.indexOf(numStr);
    const prefix = raw.substring(0, idx);
    const suffix = raw.substring(idx + numStr.length);
    return {
      rawDocNo: raw,
      prefix,
      sequenceNumber: isNaN(num) ? null : num,
      paddingLength: numStr.length,
      suffix,
      isValidPattern: true
    };
  }

  return { rawDocNo: raw, prefix: raw, sequenceNumber: null, paddingLength: 0, suffix: '', isValidPattern: false };
};

/**
 * Formats a sequence number back into a document ID using the specified prefix, padding, and suffix.
 */
export const formatSequenceID = (prefix: string, seqNum: number, padding: number, suffix: string = ''): string => {
  const padLen = Math.max(padding, 1);
  const numPadded = String(seqNum).padStart(padLen, '0');
  return `${prefix}${numPadded}${suffix}`;
};

/**
 * Analyzes sequence integrity, detects missing records, gaps, and population deltas for a specific register group.
 */
export const auditRegisterSequence = (docType: string, rows: SubmittalRow[]): RegisterSequenceAudit => {
  if (!rows || rows.length === 0) {
    return {
      docType,
      prefix: docType ? `${docType}-` : '',
      paddingLength: 5,
      minSequence: 0,
      maxSequence: 0,
      expectedPopulation: 0,
      actualRev0Population: 0,
      actualUniquePopulation: 0,
      totalWorkloadRows: 0,
      furtherRevRows: 0,
      missingCount: 0,
      missingIds: [],
      sequenceGaps: [],
      duplicateRecords: [],
      furtherRevWithoutRev0: [],
      malformedIds: [],
      isSequenceFullyReconciled: true,
      deltaExplanation: 'No records present for this register.',
      deltaExplanationAr: 'لا توجد سجلات مسجلة لهذا النوع من المعاملات.'
    };
  }

  const totalWorkloadRows = rows.length;
  let furtherRevRows = 0;
  
  // Track document histories & duplicates
  const entityHistory = new Map<string, SubmittalRow[]>();
  const exactKeySet = new Map<string, SubmittalRow[]>();
  const malformedIds: string[] = [];

  rows.forEach(r => {
    const rawDoc = (r.docNo || (r as any).ncrRef || (r as any).sorRef || (r as any).rfiRef || r.id || '').trim();
    const rev = String(r.rev || '').trim().toUpperCase();
    const w = getRevisionWeight(rev);
    const isRev0 = w === 0 && rev !== 'AS-BUILT' && rev !== 'IFC' || (r.isRev0 && w === 0);

    if (!isRev0) {
      furtherRevRows++;
    }

    if (!entityHistory.has(rawDoc)) {
      entityHistory.set(rawDoc, []);
    }
    entityHistory.get(rawDoc)!.push(r);

    const exactKey = `${rawDoc}__REV_${rev || '00'}`;
    if (!exactKeySet.has(exactKey)) {
      exactKeySet.set(exactKey, []);
    }
    exactKeySet.get(exactKey)!.push(r);
  });

  // Extract duplicate records
  const duplicateRecords: { docNo: string; rev: string; count: number; ids: string[] }[] = [];
  exactKeySet.forEach((list, key) => {
    if (list.length > 1) {
      const parts = key.split('__REV_');
      duplicateRecords.push({
        docNo: parts[0],
        rev: parts[1] || '00',
        count: list.length,
        ids: list.map(x => x.id || parts[0])
      });
    }
  });

  // Analyze parsed sequence numbers & numbering conventions
  const rev0SequenceNumbers = new Set<number>();
  const allEntitySequenceNumbers = new Set<number>();
  const seqToDocMap = new Map<number, string>();
  
  // Track prefixes and padding lengths to find dominant pattern
  const prefixCounts = new Map<string, number>();
  const paddingCounts = new Map<number, number>();
  const suffixCounts = new Map<string, number>();
  const furtherRevWithoutRev0: { docNo: string; firstRecordedRev: string; count: number }[] = [];

  entityHistory.forEach((histRows, docNo) => {
    const parsed = parseDocIdentifier(docNo);
    if (!parsed.isValidPattern || parsed.sequenceNumber === null) {
      malformedIds.push(docNo);
      return;
    }

    const seq = parsed.sequenceNumber;
    allEntitySequenceNumbers.add(seq);
    seqToDocMap.set(seq, docNo);

    // Track dominant prefix & padding
    prefixCounts.set(parsed.prefix, (prefixCounts.get(parsed.prefix) || 0) + 1);
    paddingCounts.set(parsed.paddingLength, (paddingCounts.get(parsed.paddingLength) || 0) + 1);
    if (parsed.suffix) {
      suffixCounts.set(parsed.suffix, (suffixCounts.get(parsed.suffix) || 0) + 1);
    }

    // Check if this entity has a Rev 00
    const hasRev0 = histRows.some(r => {
      const rev = String(r.rev || '').trim().toUpperCase();
      const w = getRevisionWeight(rev);
      return w === 0 && rev !== 'AS-BUILT' && rev !== 'IFC' || (r.isRev0 && w === 0);
    });

    if (hasRev0) {
      rev0SequenceNumbers.add(seq);
    } else {
      // Entity only exists as Further Rev (e.g. started directly at Rev 01)
      histRows.sort((a, b) => getRevisionWeight(a.rev) - getRevisionWeight(b.rev));
      furtherRevWithoutRev0.push({
        docNo,
        firstRecordedRev: histRows[0]?.rev || '01',
        count: histRows.length
      });
    }
  });

  // Determine dominant prefix and padding length
  let dominantPrefix = `${docType}-`;
  let maxPrefixCount = 0;
  prefixCounts.forEach((count, prefix) => {
    if (count > maxPrefixCount) {
      maxPrefixCount = count;
      dominantPrefix = prefix;
    }
  });

  let dominantPadding = 5;
  let maxPaddingCount = 0;
  paddingCounts.forEach((count, pad) => {
    if (count > maxPaddingCount) {
      maxPaddingCount = count;
      dominantPadding = pad;
    }
  });

  let dominantSuffix = '';
  let maxSuffixCount = 0;
  suffixCounts.forEach((count, suf) => {
    if (count > maxSuffixCount) {
      maxSuffixCount = count;
      dominantSuffix = suf;
    }
  });

  // Calculate Expected Sequence Range
  const allSeqArray = Array.from(allEntitySequenceNumbers);
  let minSeq = 1;
  let maxSeq = 0;

  if (allSeqArray.length > 0) {
    const rawMin = Math.min(...allSeqArray);
    const rawMax = Math.max(...allSeqArray);
    
    // Standard engineering register governance: if min is small (< 100), sequence started from 1
    minSeq = rawMin <= 10 ? 1 : rawMin;
    maxSeq = rawMax;
  }

  const expectedPopulation = maxSeq >= minSeq ? (maxSeq - minSeq + 1) : 0;
  const actualRev0Population = rev0SequenceNumbers.size;
  const actualUniquePopulation = entityHistory.size;

  // Identify Missing Sequence IDs
  const missingNumbers: number[] = [];
  const missingIds: string[] = [];
  const sequenceGaps: SequenceGap[] = [];

  if (expectedPopulation > 0 && maxSeq > 0) {
    let currentGapStart: number | null = null;
    let currentGapEnd: number | null = null;

    for (let s = minSeq; s <= maxSeq; s++) {
      if (!rev0SequenceNumbers.has(s)) {
        missingNumbers.push(s);
        const formatted = formatSequenceID(dominantPrefix, s, dominantPadding, dominantSuffix);
        missingIds.push(formatted);

        if (currentGapStart === null) {
          currentGapStart = s;
          currentGapEnd = s;
        } else {
          currentGapEnd = s;
        }
      } else {
        if (currentGapStart !== null && currentGapEnd !== null) {
          const gapCount = currentGapEnd - currentGapStart + 1;
          const sample = [
            formatSequenceID(dominantPrefix, currentGapStart, dominantPadding, dominantSuffix),
            ...(gapCount > 2 ? ['...'] : []),
            ...(gapCount > 1 ? [formatSequenceID(dominantPrefix, currentGapEnd, dominantPadding, dominantSuffix)] : [])
          ];
          sequenceGaps.push({
            fromNumber: currentGapStart,
            toNumber: currentGapEnd,
            count: gapCount,
            formattedRange: currentGapStart === currentGapEnd 
              ? formatSequenceID(dominantPrefix, currentGapStart, dominantPadding, dominantSuffix)
              : `${formatSequenceID(dominantPrefix, currentGapStart, dominantPadding, dominantSuffix)} → ${formatSequenceID(dominantPrefix, currentGapEnd, dominantPadding, dominantSuffix)}`,
            sampleMissingIds: sample
          });
          currentGapStart = null;
          currentGapEnd = null;
        }
      }
    }

    if (currentGapStart !== null && currentGapEnd !== null) {
      const gapCount = currentGapEnd - currentGapStart + 1;
      const sample = [
        formatSequenceID(dominantPrefix, currentGapStart, dominantPadding, dominantSuffix),
        ...(gapCount > 2 ? ['...'] : []),
        ...(gapCount > 1 ? [formatSequenceID(dominantPrefix, currentGapEnd, dominantPadding, dominantSuffix)] : [])
      ];
      sequenceGaps.push({
        fromNumber: currentGapStart,
        toNumber: currentGapEnd,
        count: gapCount,
        formattedRange: currentGapStart === currentGapEnd 
          ? formatSequenceID(dominantPrefix, currentGapStart, dominantPadding, dominantSuffix)
          : `${formatSequenceID(dominantPrefix, currentGapStart, dominantPadding, dominantSuffix)} → ${formatSequenceID(dominantPrefix, currentGapEnd, dominantPadding, dominantSuffix)}`,
        sampleMissingIds: sample
      });
    }
  }

  const missingCount = missingIds.length;
  const isSequenceFullyReconciled = missingCount === 0 && duplicateRecords.length === 0;

  // Build high-level human readable narrative explanation for delta
  let deltaExplanation = '';
  let deltaExplanationAr = '';

  if (isSequenceFullyReconciled) {
    deltaExplanation = `Sequence perfectly reconciled: Expected ${expectedPopulation} = Actual Rev.00 (${actualRev0Population}) across range ${minSeq} to ${maxSeq}.`;
    deltaExplanationAr = `التسلسل مطابق بنسبة 100%: العدد المتوقع ${expectedPopulation} = عدد مراجعات 00 الفعلي (${actualRev0Population}) ضمن النطاق ${minSeq} إلى ${maxSeq}.`;
  } else {
    const missingSummaryEn = missingCount > 0 ? `${missingCount} missing sequence ID${missingCount > 1 ? 's' : ''} (e.g. ${missingIds.slice(0, 3).join(', ')}${missingIds.length > 3 ? '...' : ''})` : '';
    const missingSummaryAr = missingCount > 0 ? `${missingCount} رقم متسلسل مفقود من مراجعة 00 (مثل: ${missingIds.slice(0, 3).join(', ')}${missingIds.length > 3 ? '...' : ''})` : '';
    
    const furtherSummaryEn = furtherRevWithoutRev0.length > 0 ? `${furtherRevWithoutRev0.length} entities started at Further Revisions without Rev.00` : '';
    const furtherSummaryAr = furtherRevWithoutRev0.length > 0 ? `${furtherRevWithoutRev0.length} معاملة مسجلة فقط بمراجعات لاحقة دون مراجعة 00` : '';

    const partsEn = [missingSummaryEn, furtherSummaryEn].filter(Boolean).join('; ');
    const partsAr = [missingSummaryAr, furtherSummaryAr].filter(Boolean).join('؛ ');

    deltaExplanation = `Sequence Delta Detected: Expected ${expectedPopulation} (from ${dominantPrefix}${String(minSeq).padStart(dominantPadding, '0')} to ${dominantPrefix}${String(maxSeq).padStart(dominantPadding, '0')}), Found Rev.00 = ${actualRev0Population}. Delta = ${missingCount}. Details: ${partsEn}.`;
    deltaExplanationAr = `تم رصد فجوة في التسلسل: المتوقع ${expectedPopulation} (من ${dominantPrefix}${String(minSeq).padStart(dominantPadding, '0')} حتى ${dominantPrefix}${String(maxSeq).padStart(dominantPadding, '0')})، الفعلي لمراجعة 00 = ${actualRev0Population}. الفارق = ${missingCount}. التفاصيل: ${partsAr}.`;
  }

  return {
    docType,
    prefix: dominantPrefix,
    paddingLength: dominantPadding,
    minSequence: minSeq,
    maxSequence: maxSeq,
    expectedPopulation,
    actualRev0Population,
    actualUniquePopulation,
    totalWorkloadRows,
    furtherRevRows,
    missingCount,
    missingIds,
    sequenceGaps,
    duplicateRecords,
    furtherRevWithoutRev0,
    malformedIds,
    isSequenceFullyReconciled,
    deltaExplanation,
    deltaExplanationAr
  };
};

/**
 * Analyzes the complete dataset across all registers/document types and generates full population reconciliation.
 */
export const runComprehensiveSequenceAudit = (rows: SubmittalRow[]): SequenceAuditResult => {
  if (!rows || rows.length === 0) {
    return {
      totalExpectedPopulation: 0,
      totalActualRev0Population: 0,
      totalMissingCount: 0,
      totalDuplicatesCount: 0,
      totalFurtherRevWithoutRev0: 0,
      allMissingIds: [],
      registerAudits: {},
      overallStatus: 'PERFECT_MATCH',
      summaryNarrative: 'No records to audit.',
      summaryNarrativeAr: 'لا توجد سجلات للتدقيق.'
    };
  }

  // Group by documentType / register
  const groups = new Map<string, SubmittalRow[]>();
  rows.forEach(r => {
    const dt = (r.documentType || r.logType || 'DOC-GEN').trim().toUpperCase();
    if (!groups.has(dt)) {
      groups.set(dt, []);
    }
    groups.get(dt)!.push(r);
  });

  const registerAudits: Record<string, RegisterSequenceAudit> = {};
  let totalExpectedPopulation = 0;
  let totalActualRev0Population = 0;
  let totalMissingCount = 0;
  let totalDuplicatesCount = 0;
  let totalFurtherRevWithoutRev0 = 0;
  const allMissingIds: { docType: string; docNo: string; seqNumber: number }[] = [];

  groups.forEach((groupRows, dt) => {
    const audit = auditRegisterSequence(dt, groupRows);
    registerAudits[dt] = audit;

    totalExpectedPopulation += audit.expectedPopulation;
    totalActualRev0Population += audit.actualRev0Population;
    totalMissingCount += audit.missingCount;
    totalDuplicatesCount += audit.duplicateRecords.length;
    totalFurtherRevWithoutRev0 += audit.furtherRevWithoutRev0.length;

    audit.missingIds.forEach(id => {
      const parsed = parseDocIdentifier(id);
      allMissingIds.push({
        docType: dt,
        docNo: id,
        seqNumber: parsed.sequenceNumber || 0
      });
    });
  });

  const overallStatus = totalMissingCount === 0 && totalDuplicatesCount === 0 
    ? 'PERFECT_MATCH' 
    : (totalMissingCount > 50 ? 'CRITICAL_DISCREPANCY' : 'GAPS_DETECTED');

  const summaryNarrative = totalMissingCount === 0
    ? `All ${Object.keys(registerAudits).length} registers show 100% continuous sequence reconciliation (${totalActualRev0Population} / ${totalExpectedPopulation}).`
    : `Forensic Sequence Audit detected ${totalMissingCount} missing expected sequence records across ${Object.keys(registerAudits).length} registers. Expected Rev.00: ${totalExpectedPopulation}, Actual Rev.00: ${totalActualRev0Population}, Delta: ${totalMissingCount}.`;

  const summaryNarrativeAr = totalMissingCount === 0
    ? `كافة السجلات (${Object.keys(registerAudits).length} نوع) متطابقة بنسبة 100% دون أي فجوة تسلسل (${totalActualRev0Population} / ${totalExpectedPopulation}).`
    : `تدقيق التسلسل الجنائي رصد ${totalMissingCount} رقماً متسلسلاً مفقوداً عبر ${Object.keys(registerAudits).length} نوع من السجلات. المتوقع لمراجعة 00: ${totalExpectedPopulation}، الفعلي لمراجعة 00: ${totalActualRev0Population}، الفارق: ${totalMissingCount}.`;

  return {
    totalExpectedPopulation,
    totalActualRev0Population,
    totalMissingCount,
    totalDuplicatesCount,
    totalFurtherRevWithoutRev0,
    allMissingIds,
    registerAudits,
    overallStatus,
    summaryNarrative,
    summaryNarrativeAr
  };
};

/**
 * Generates an end-to-end forensic lifecycle ledger tracking every record from source to final disposition.
 */
export const generateForensicLifecycleLedger = (rows: SubmittalRow[]): ForensicLedgerEntry[] => {
  if (!rows || rows.length === 0) return [];

  const ledger: ForensicLedgerEntry[] = [];
  const auditResult = runComprehensiveSequenceAudit(rows);

  // 1. Process all actual dataset rows
  rows.forEach((r, idx) => {
    const rawDoc = (r.docNo || (r as any).ncrRef || (r as any).sorRef || (r as any).rfiRef || r.id || `ROW-${idx + 1}`).trim();
    const rev = String(r.rev || '').trim().toUpperCase();
    const docType = r.documentType || r.logType || 'DOC-GEN';
    const cat = getStatusCodeCategory(r);

    let disposition: ForensicLedgerEntry['disposition'] = 'SSOT_ACTIVE';
    let reasonEn = 'Record is active in Canonical SSOT population and counted in current metrics.';
    let reasonAr = 'السجل نشط ومعتمد في الحسابات النهائية الحالية.';

    if (!r.isLatestRev) {
      disposition = 'SUPERSEDED_HISTORICAL';
      reasonEn = 'Historical submittal superseded by a newer revision in the workload history.';
      reasonAr = 'تقديم تاريخي تم استبداله بمراجعة أحدث في سجل تاريخ المعاملة.';
    }

    ledger.push({
      id: r.id || `${rawDoc}-${rev}-${idx}`,
      docNo: rawDoc,
      rev: rev || '00',
      docType,
      sourceLocation: r.sourceFile || 'Source Register File',
      parsedStatus: r.status || r.recordStatus || 'Pending',
      canonicalStatus: cat,
      disposition,
      dispositionReason: reasonEn,
      dispositionReasonAr: reasonAr
    });
  });

  // 2. Add Virtual Entries for Missing Expected Sequence IDs
  auditResult.allMissingIds.forEach((missingItem, mIdx) => {
    ledger.push({
      id: `MISSING-SEQ-${missingItem.docType}-${missingItem.seqNumber}-${mIdx}`,
      docNo: missingItem.docNo,
      rev: '00',
      docType: missingItem.docType,
      sourceLocation: 'Expected In Source Register Sequence Range',
      parsedStatus: 'NOT_FOUND_IN_SOURCE',
      canonicalStatus: 'UNCLASSIFIED',
      disposition: 'MISSING_EXPECTED_GAP',
      dispositionReason: `Expected sequential number #${missingItem.seqNumber} is missing from the register and was never submitted or registered in Rev.00.`,
      dispositionReasonAr: `الرقم المتسلسل المتوقع #${missingItem.seqNumber} مفقود من السجل ولم يتم تسجيله أو تقديمه في مراجعة 00.`
    });
  });

  return ledger;
};
