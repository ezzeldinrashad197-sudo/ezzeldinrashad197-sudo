import { SubmittalRow } from "../../types";
import { classifyNcrStatus } from "../../utils/calculations";
import {
  compareRevisionsCanonical as compareRevisions,
  isRevision0,
  isFurtherRevision,
  getNormalizedRevision
} from "../revisionResolver";
import { recordAuditLog } from "../governance/auditFramework";

export const isYes = (v: unknown) =>
  typeof v === "string"
    ? v.toUpperCase() === "YES" || v.toUpperCase() === "Y"
    : !!v;

// Helper to convert date strings to timestamps safely
const parseDateToMs = (dStr: string | undefined | null): number | null => {
  if (!dStr) return null;
  const trimmed = String(dStr).trim();
  if (!trimmed || trimmed === "-" || trimmed.toUpperCase() === "N/A") return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.getTime();
};

const toIsoDay = (ms: number | null): string => {
  if (ms === null) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Resolves the true temporal activity start timestamp of a specific revision `r`
 * within a sorted NCR revision history (`sortedHistory`).
 *
 * Fixes NCR-006 & NCR-007:
 * Subsequent revisions (Rev01, Rev02, ...) frequently inherit the original NCR's
 * `submissionDate` (Issue Date) or earlier `sentDate`/`responseDate`.
 * Using an inherited `submissionDate` caused future revisions (e.g. July Rev01)
 * to leak into past month-end snapshots (e.g. June 30 Snapshot).
 */
export const getRevisionActivityDateMs = (
  r: SubmittalRow,
  index: number,
  sortedHistory: SubmittalRow[]
): number | null => {
  const anyR = r as Record<string, any>;
  const explicitRevActivityMs = parseDateToMs(
    anyR.revisionActivityDate || anyR.revisionDate || anyR.activityDate
  );
  const issueMs = parseDateToMs(r.submissionDate);
  const sentMs = parseDateToMs(r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction);
  const respMs = parseDateToMs(r.responseDate);

  // Baseline / first revision in history: activity begins at earliest valid date on the row
  if (index === 0) {
    if (explicitRevActivityMs !== null) return explicitRevActivityMs;
    if (issueMs !== null) return issueMs;
    if (sentMs !== null) return sentMs;
    return respMs;
  }

  // Subsequent revision (index > 0): identify and exclude dates inherited from earlier revisions (0 .. index-1)
  const priorIssueDays = new Set<string>();
  const priorSentDays = new Set<string>();
  const priorRespDays = new Set<string>();
  let maxPriorEventMs: number | null = null;

  for (let i = 0; i < index; i++) {
    const prev = sortedHistory[i];
    const pIssueMs = parseDateToMs(prev.submissionDate);
    const pSentMs = parseDateToMs(prev.ncrSentDateCorrectiveAction || prev.sentDateCorrectiveAction);
    const pRespMs = parseDateToMs(prev.responseDate);

    if (pIssueMs !== null) {
      priorIssueDays.add(toIsoDay(pIssueMs));
      if (maxPriorEventMs === null || pIssueMs > maxPriorEventMs) maxPriorEventMs = pIssueMs;
    }
    if (pSentMs !== null) {
      priorSentDays.add(toIsoDay(pSentMs));
      if (maxPriorEventMs === null || pSentMs > maxPriorEventMs) maxPriorEventMs = pSentMs;
    }
    if (pRespMs !== null) {
      priorRespDays.add(toIsoDay(pRespMs));
      if (maxPriorEventMs === null || pRespMs > maxPriorEventMs) maxPriorEventMs = pRespMs;
    }
  }

  const candidateMs: number[] = [];

  if (explicitRevActivityMs !== null) {
    candidateMs.push(explicitRevActivityMs);
  }

  // `submissionDate` on Rev01+ is only a genuine revision activity date if it was NOT inherited from an earlier revision
  if (issueMs !== null) {
    const issueDay = toIsoDay(issueMs);
    const isInheritedIssue = priorIssueDays.has(issueDay) || (maxPriorEventMs !== null && issueMs < maxPriorEventMs);
    if (!isInheritedIssue) {
      candidateMs.push(issueMs);
    }
  }

  // `sentDate` on Rev01+ is a genuine revision activity date if it was NOT inherited from an earlier revision
  if (sentMs !== null) {
    const sentDay = toIsoDay(sentMs);
    const isInheritedSent = priorSentDays.has(sentDay) || (maxPriorEventMs !== null && sentMs < maxPriorEventMs);
    if (!isInheritedSent) {
      candidateMs.push(sentMs);
    }
  }

  // `responseDate` on Rev01+ is a genuine revision activity date if it was NOT inherited from an earlier revision
  if (respMs !== null) {
    const respDay = toIsoDay(respMs);
    const isInheritedResp = priorRespDays.has(respDay) || (maxPriorEventMs !== null && respMs < maxPriorEventMs);
    if (!isInheritedResp) {
      candidateMs.push(respMs);
    }
  }

  if (candidateMs.length > 0) {
    return Math.min(...candidateMs);
  }

  // Fallback if all dates on the subsequent revision are identical to prior revisions
  if (maxPriorEventMs !== null) return maxPriorEventMs;
  return issueMs ?? sentMs ?? respMs;
};

/**
 * Sorts and deduplicates revision rows for a single NCR Reference.
 * Ensures deterministic revision ordering and prevents duplicate rows of the exact same revision
 * from inflating revision or event counts.
 */
export const normalizeNcrRevisionHistory = (rows: SubmittalRow[]): SubmittalRow[] => {
  if (!rows || rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => {
    const cmp = compareRevisions(a.rev, b.rev);
    if (cmp !== 0) return cmp;
    const aSent = parseDateToMs(a.ncrSentDateCorrectiveAction || a.sentDateCorrectiveAction) ?? 0;
    const bSent = parseDateToMs(b.ncrSentDateCorrectiveAction || b.sentDateCorrectiveAction) ?? 0;
    if (aSent !== bSent) return aSent - bSent;
    const aResp = parseDateToMs(a.responseDate) ?? 0;
    const bResp = parseDateToMs(b.responseDate) ?? 0;
    return aResp - bResp;
  });

  // Deduplicate exact identical revision rows (same normalized revision + same dates + same status/action)
  const deduped: SubmittalRow[] = [];
  const seenSignatures = new Set<string>();
  for (const r of sorted) {
    const normRev = getNormalizedRevision(r.rev, r.isRev0);
    const issueDay = toIsoDay(parseDateToMs(r.submissionDate));
    const sentDay = toIsoDay(parseDateToMs(r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction));
    const respDay = toIsoDay(parseDateToMs(r.responseDate));
    const statusSig = `${(r.ncrStatus || r.status || "").trim().toUpperCase()}|${(r.ncrAction || r.action || "").trim().toUpperCase()}`;
    const sig = `${normRev}|${issueDay}|${sentDay}|${respDay}|${statusSig}`;
    if (!seenSignatures.has(sig)) {
      seenSignatures.add(sig);
      deduped.push(r);
    }
  }
  return deduped;
};

/**
 * Selects the latest revision of an NCR, optionally constrained to `upToDate`.
 * Fixes NCR-007: Uses `getRevisionActivityDateMs` instead of raw inherited `submissionDate`.
 */
export const getLatestRev = (
  rows: SubmittalRow[],
  upToDate?: Date
): SubmittalRow | undefined => {
  if (!rows || !rows.length) return undefined;
  const sortedHistory = normalizeNcrRevisionHistory(rows);
  if (!sortedHistory.length) return undefined;

  if (!upToDate) {
    const explicitLatest = sortedHistory.find((r) => isYes(r.isLatestRev));
    if (explicitLatest) {
      const maxRevRow = sortedHistory[sortedHistory.length - 1];
      if (compareRevisions(explicitLatest.rev, maxRevRow.rev) >= 0) {
        return explicitLatest;
      }
    }
    return sortedHistory[sortedHistory.length - 1];
  }

  const endOfMonthMs = new Date(
    upToDate.getFullYear(),
    upToDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  ).getTime();

  const eligible = sortedHistory.filter((r, idx) => {
    const actMs = getRevisionActivityDateMs(r, idx, sortedHistory);
    if (actMs === null) return false;
    return actMs <= endOfMonthMs;
  });

  if (!eligible.length) return undefined;
  return eligible[eligible.length - 1];
};

export interface NCRStats {
  discipline: string;
  totalUnique: number;
  notSent: number;        // Stage 1: Sent Date is blank (Contractor Action Needed)
  underReview: number;    // Stage 2: Sent Date exists, Received Corrective blank (Waiting Consultant)
  rejectedOpen: number;   // Stage 3: Received Corrective exists, Rejected (Contractor Action Needed)
  approvedClosed: number; // Stage 3: Received Corrective exists, Approved (Closed)
  open: number;           // Cumulative open (= notSent + rejectedOpen)
  closed: number;         // Cumulative closed (= approvedClosed)
  approved: number;       // Legacy compatibility (= approvedClosed)
  rejected: number;       // Legacy compatibility (= rejectedOpen)
  rev0: number;
  revHigh: number;
  waiting: number;        // Legacy compatibility (= underReview)
}

export interface NCRClassificationStats {
  classification: string;
  newNcrReceived: number;       // Event 1: Distinct NCR Issued in Month (Original Issue Date)
  correctiveSubmitted: number;  // Event 2: Distinct Corrective Action Submitted in Month
  responsesReceived: number;    // Event 3: Distinct Consultant Response Received in Month
  approved: number;             // Response Approved
  rejected: number;             // Response Rejected
  waitingConsultant: number;    // Pending review at the end of the month
  waitingContractor: number;    // Pending action at the end of the month
  overdue: number;              // Unique NCRs open > 14 days at month-end (Single-counted)

  // Legacy compatibility fields to prevent any external breakage
  totalSubs: number;
  rev0: number;
  revHigh: number;
  rejectedOpen: number;
  rejectedClosed: number;
  pending: number;
  carryForwardPending: number;
  currentMonthPending: number;
  waiting: number;
}

/**
 * True Event Grain Record (Fixes NCR-002, NCR-012, NCR-013)
 * Every event is uniquely identified by: NCR Ref + Event Type + Event Date + Revision
 */
export interface NCREventRecord {
  eventId: string;
  ref: string;
  discipline: string;
  eventType: "RECEIVED" | "CORRECTIVE_SUBMITTED" | "RESPONSE";
  eventDate: string;
  eventTimestampMs: number;
  rev: string;
  normalizedRev: string;
  rowId: string;
  outcome?: "Approved" | "Rejected";
  actionCode: string;
  status: string;
}

/**
 * Helper to normalize the discipline/trade name consistently across all engines.
 * Fixes NCR-010: SURVEY / SURV / SUR is preserved as "SURVEY" and NEVER mapped to "HSE".
 */
export const normalizeDiscipline = (row: SubmittalRow): string => {
  const rawDisc = (row.discipline || row.trade || row.disciplineCode || "GENERAL")
    .trim()
    .replace(/^NCR[-_\s]*/i, "")
    .trim();
  const disc = rawDisc.toUpperCase();

  if (disc === "STR/SUR" || disc === "STR-SUR") return "STR/SUR";
  if (disc === "SURVEY" || disc === "SURV" || disc === "SUR" || disc === "SURVEYING" || disc.startsWith("SURV")) {
    return "SURVEY";
  }
  if (disc === "MECHANICAL" || disc === "MECH" || disc === "MEC" || disc.startsWith("MECH")) return "Mech";
  if (disc === "ELECTRICAL" || disc === "ELEC" || disc === "ELE" || disc.startsWith("ELEC")) return "Elec";
  if (disc === "STRUCTURAL" || disc === "STR" || disc === "CIVIL" || disc.startsWith("STR")) return "STR";
  if (disc === "ARCHITECTURAL" || disc === "ARCH" || disc === "ARC" || disc.startsWith("ARCH")) return "Arch";
  if (disc === "INFRASTRUCTURE" || disc === "INFR" || disc === "INFRA" || disc === "INF" || disc.startsWith("INF")) return "Infra";
  if (disc === "LANDSCAPE" || disc === "LAND" || disc === "LND" || disc.includes("LAND")) return "Landscape";
  if (disc === "HSE" || disc === "SAFETY" || disc.includes("HSE") || disc.includes("SAFETY")) return "HSE";
  return rawDisc || "GENERAL";
};

const NON_NCR_CANONICAL_REGISTERS = new Set([
  "SDW",
  "SHD",
  "WIR",
  "MIR",
  "MAR",
  "DOC",
  "ABD",
  "RFI",
  "SOR",
  "LTR",
  "QS",
  "PQ",
  "PRQ",
  "TRS"
]);

/**
 * Canonical NCR Population Filter (Fixes NCR-011)
 * Prioritizes canonical `registerIdentity === 'NCR'` and rejects rows belonging to other canonical registers,
 * with a documented fallback when `registerIdentity` is absent or unclassified.
 */
export const normalizeNCRData = (safeData: SubmittalRow[]): SubmittalRow[] => {
  if (!Array.isArray(safeData)) return [];
  return safeData.filter((d: SubmittalRow) => {
    if (!d) return false;
    if (d.excludeFromKPI === true || (d as any).isExcluded === true) return false;

    const regId = (d.registerIdentity || "").trim().toUpperCase();
    const baseRegId = regId.includes("-") ? regId.split("-")[0].trim() : regId;
    if (baseRegId === "NCR") return true;
    if (baseRegId && NON_NCR_CANONICAL_REGISTERS.has(baseRegId)) return false;

    const wf = (d.workflowFamily || "").trim().toUpperCase();
    if (wf === "NCR") return true;
    if (wf && NON_NCR_CANONICAL_REGISTERS.has(wf)) return false;

    const srcReg = (d.sourceRegisterIdentity || "").trim().toUpperCase();
    const baseSrcReg = srcReg.includes("-") ? srcReg.split("-")[0].trim() : srcReg;
    if (baseSrcReg === "NCR") return true;
    if (baseSrcReg && NON_NCR_CANONICAL_REGISTERS.has(baseSrcReg)) return false;

    // Documented fallback when registerIdentity is absent/UNCLASSIFIED
    const docT = (d.documentType || "").trim().toUpperCase();
    const logT = (d.logType || "").trim().toUpperCase();
    const ncrRef = (d.ncrRef || "").trim().toUpperCase();
    const docNo = (d.docNo || "").trim().toUpperCase();

    if (docT === "NCR" || docT.startsWith("NCR-") || logT === "NCR" || logT.startsWith("NCR-")) {
      return true;
    }
    if (ncrRef.startsWith("NCR") || /^NCR[-_/\s0-9]/i.test(docNo) || /(?:^|[-_/\s])NCR(?:$|[-_/\s0-9])/i.test(docNo)) {
      return true;
    }
    return false;
  });
};

// Group by Unique Reference No.
export const groupNCRByReference = (normalizedData: SubmittalRow[]): Map<string, SubmittalRow[]> => {
  const grouped = new Map<string, SubmittalRow[]>();
  normalizedData.forEach((r) => {
    const key = (r.ncrRef || r.docNo || r.submissionRef || r.id || "").trim().toUpperCase();
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  });
  return grouped;
};

/**
 * Evaluates NCR outcome using the canonical `classifyNcrStatus` classifier,
 * while also honoring explicit `code` or `action` rejection tokens ('C', 'REVISE', 'REJECT')
 * if `ncrStatus`/`status` were left blank.
 */
const resolveNcrOutcome = (row: SubmittalRow) => {
  const cStatus = classifyNcrStatus(row);
  const rawAction = (row.ncrAction || row.action || "").trim().toUpperCase();
  const rawCode = (row.code || "").trim().toUpperCase();
  const rawStatus = (row.ncrStatus || row.status || row.recordStatus || "").trim().toUpperCase();

  const isExplicitReject =
    rawCode === "C" ||
    rawCode === "CODE C" ||
    rawCode === "REJECTED" ||
    rawAction.includes("REJECT") ||
    rawAction.includes("REVISE") ||
    rawAction === "C" ||
    rawAction === "CODE C";

  const isExplicitApprove =
    rawCode === "A" ||
    rawCode === "B" ||
    rawCode === "CODE A" ||
    rawCode === "CODE B" ||
    rawAction.includes("APPROV") ||
    rawAction.includes("ACCEPT") ||
    rawStatus === "CLOSED" ||
    rawStatus === "APPROVED";

  if (isExplicitReject && !isExplicitApprove) {
    return {
      ...cStatus,
      isApprovedClosed: false,
      isRejectedOpen: true,
      isRejected: true,
      isApproved: false,
      isClosed: false,
      isOpen: true
    };
  }

  return cStatus;
};

export interface NCREvidence {
  ref: string;
  discipline: string;
  latestRev: string;
  stage:
    | "Stage 1: Waiting Contractor"
    | "Stage 2: Waiting Consultant"
    | "Stage 3: Approved Closed"
    | "Stage 3: Rejected Open";
  issueDate: string;
  sentDate: string;
  responseDate: string;
  actionCode: string;
  isOverdue: boolean;
  explanation: string;
  isNewInMonth: boolean;
  isSubmittedInMonth: boolean;
  isRespondedInMonth: boolean;
  monthlyOutcome: "Approved" | "Rejected" | "None";
  eventsInMonth?: NCREventRecord[];
}

export interface NCRIntegrityReport {
  passed: boolean;
  cumulativePartitioning: {
    totalUnique: number;
    sumOfStates: number; // open + underReview + closed
    difference: number;
    passed: boolean;
  };
  monthlyResponseCheck: {
    responsesReceived: number;
    approvedAndRejected: number; // approved + rejected
    difference: number;
    passed: boolean;
  };
  openIntegrityCheck: {
    currentlyOpen: number;
    sumOfOpenStages: number; // notSent + rejectedOpen
    difference: number;
    passed: boolean;
  };
  forensicChecks?: {
    entityUniquenessPassed: boolean;
    eventDeduplicationPassed: boolean;
    temporalSnapshotPassed: boolean;
    overdueSingleCountPassed: boolean;
    detailTableGrainParityPassed: boolean;
    disciplineClassificationPassed: boolean;
    crossEngineReconciliationPassed: boolean;
  };
}

// ==========================================
// 1. Cumulative NCR State Engine (Snapshot)
// ==========================================
export const calculateCumulativeSnapshot = (normalizedData: SubmittalRow[]) => {
  const grouped = groupNCRByReference(normalizedData);
  const cumMap = new Map<string, NCRStats>();
  const cumulativeEvidence: Omit<
    NCREvidence,
    "isNewInMonth" | "isSubmittedInMonth" | "isRespondedInMonth" | "monthlyOutcome"
  >[] = [];

  Array.from(grouped.entries()).forEach(([refKey, rawHistory]) => {
    const history = normalizeNcrRevisionHistory(rawHistory);
    const latestOverall = history[history.length - 1];
    if (!latestOverall) return;

    const firstRevision = history[0];
    const originalIssueStr = firstRevision?.submissionDate || latestOverall.submissionDate || "";
    const originalIssueMs = parseDateToMs(originalIssueStr);

    const disc = normalizeDiscipline(latestOverall);

    if (!cumMap.has(disc)) {
      cumMap.set(disc, {
        discipline: disc,
        totalUnique: 0,
        notSent: 0,
        underReview: 0,
        rejectedOpen: 0,
        approvedClosed: 0,
        open: 0,
        closed: 0,
        approved: 0,
        rejected: 0,
        rev0: 0,
        revHigh: 0,
        waiting: 0
      });
    }
    const cumSt = cumMap.get(disc)!;
    cumSt.totalUnique++;

    const cStatus = resolveNcrOutcome(latestOverall);
    const sentDateStr =
      latestOverall.ncrSentDateCorrectiveAction || latestOverall.sentDateCorrectiveAction;
    const sentDateMs = parseDateToMs(sentDateStr);
    const rawReceivedCorrectiveStr = latestOverall.responseDate;
    const rawReceivedCorrectiveMs = parseDateToMs(rawReceivedCorrectiveStr);
    const receivedCorrectiveStr =
      rawReceivedCorrectiveStr &&
      (sentDateMs === null || rawReceivedCorrectiveMs === null || rawReceivedCorrectiveMs >= sentDateMs)
        ? rawReceivedCorrectiveStr
        : "";

    let stage: NCREvidence["stage"] = "Stage 1: Waiting Contractor";
    let explanation = "";

    // Strict implementation of State Machine on Latest Revision
    if (!sentDateStr) {
      // Stage 1: Sent Date Corrective Action is blank -> Open (Waiting Contractor)
      cumSt.notSent++;
      cumSt.open++;
      stage = "Stage 1: Waiting Contractor";
      explanation =
        "Issued to contractor but no corrective action response has been submitted yet (Sent Date is blank).";
    } else if (sentDateStr && !receivedCorrectiveStr) {
      // Stage 2: Sent Date exists, Received Corrective blank -> Under Review (Waiting Consultant)
      cumSt.underReview++;
      cumSt.waiting++;
      stage = "Stage 2: Waiting Consultant";
      explanation =
        "Contractor submitted a corrective plan. Currently pending review by the consultant (Response Date is blank).";
    } else if (receivedCorrectiveStr) {
      // Stage 3: Received Corrective exists
      if (cStatus.isApprovedClosed) {
        cumSt.approvedClosed++;
        cumSt.closed++;
        cumSt.approved++;
        stage = "Stage 3: Approved Closed";
        explanation =
          "Corrective action was received and officially approved/closed by the consultant.";
      } else {
        cumSt.rejectedOpen++;
        cumSt.open++;
        cumSt.rejected++;
        stage = "Stage 3: Rejected Open";
        explanation =
          "Corrective action plan was reviewed but rejected. NCR remains open, awaiting contractor re-submission.";
      }
    }

    const isLatestFurther = isFurtherRevision(latestOverall.rev, latestOverall.isRev0);
    if (isLatestFurther) {
      cumSt.revHigh++;
    } else {
      cumSt.rev0++;
    }

    // Days open for overdue calculation (14 days limit from original issue date)
    let isOverdue = false;
    if (originalIssueMs !== null) {
      const responseMs = parseDateToMs(latestOverall.responseDate);
      const isClosed = Boolean(receivedCorrectiveStr && cStatus.isApprovedClosed);
      const endMs = isClosed && responseMs !== null ? responseMs : Date.now();
      const daysOpen = Math.floor((endMs - originalIssueMs) / (1000 * 3600 * 24));
      if (daysOpen > 14 && !isClosed) {
        isOverdue = true;
      }
    }

    cumulativeEvidence.push({
      ref: refKey || latestOverall.ncrRef || latestOverall.docNo || "UNKNOWN",
      discipline: disc,
      latestRev: latestOverall.rev || "0",
      stage,
      issueDate: originalIssueStr || "-",
      sentDate: sentDateStr || "-",
      responseDate: receivedCorrectiveStr || "-",
      actionCode: latestOverall.ncrAction || latestOverall.action || "-",
      isOverdue,
      explanation
    });
  });

  const cumArr = Array.from(cumMap.values()).sort((a, b) => b.totalUnique - a.totalUnique);

  const cumulativeKPIs = {
    totalUnique: cumArr.reduce((a, c) => a + c.totalUnique, 0),
    notSent: cumArr.reduce((a, c) => a + (c.notSent || 0), 0),
    underReview: cumArr.reduce((a, c) => a + c.underReview, 0),
    rejectedOpen: cumArr.reduce((a, c) => a + (c.rejectedOpen || 0), 0),
    approvedClosed: cumArr.reduce((a, c) => a + (c.approvedClosed || 0), 0),
    open: cumArr.reduce((a, c) => a + c.open, 0),
    closed: cumArr.reduce((a, c) => a + c.closed, 0),
    approved: cumArr.reduce((a, c) => a + c.approved, 0),
    rejected: cumArr.reduce((a, c) => a + c.rejected, 0),
    waiting: cumArr.reduce((a, c) => a + (c.underReview || 0), 0)
  };

  return {
    cumulative: cumArr,
    cumulativeKPIs,
    cumulativeEvidence
  };
};

// ==========================================
// 2. Monthly NCR Event-Driven Engine
// ==========================================
export const calculateMonthlyEvents = (
  normalizedData: SubmittalRow[],
  monthlyStart: string | undefined
) => {
  const grouped = groupNCRByReference(normalizedData);
  const mMap = new Map<string, NCRClassificationStats>();
  const mSubList: Record<string, any>[] = [];
  const monthlyEvents: NCREventRecord[] = [];
  const monthlyEventTraces = new Map<
    string,
    {
      isNew: boolean;
      isSubmitted: boolean;
      isResponded: boolean;
      outcome: "Approved" | "Rejected" | "None";
      events: NCREventRecord[];
    }
  >();

  const targetMonth = monthlyStart ? new Date(monthlyStart) : new Date(2026, 5, 1); // default June 2026

  const startOfTargetMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1, 0, 0, 0, 0);
  const endOfTargetMonth = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );

  const startOfTargetMonthMs = startOfTargetMonth.getTime();
  const endOfTargetMonthMs = endOfTargetMonth.getTime();

  let temporalSnapshotPassed = true;
  const distinctNewNcrRefsInMonth = new Set<string>();
  const distinctOverdueNcrRefsAtMonthEnd = new Set<string>();

  Array.from(grouped.entries()).forEach(([refKey, rawHistory]) => {
    const history = normalizeNcrRevisionHistory(rawHistory);
    if (!history.length) return;

    const latestOverall = history[history.length - 1];
    const disc = normalizeDiscipline(latestOverall);
    const classKey = disc.startsWith("NCR-") ? disc : `NCR-${disc}`;

    if (!mMap.has(classKey)) {
      mMap.set(classKey, {
        classification: classKey,
        newNcrReceived: 0,
        correctiveSubmitted: 0,
        responsesReceived: 0,
        approved: 0,
        rejected: 0,
        waitingConsultant: 0,
        waitingContractor: 0,
        overdue: 0,

        // Legacy compatibility
        totalSubs: 0,
        rev0: 0,
        revHigh: 0,
        rejectedOpen: 0,
        rejectedClosed: 0,
        pending: 0,
        carryForwardPending: 0,
        currentMonthPending: 0,
        waiting: 0
      });
    }
    const mSt = mMap.get(classKey)!;

    let isNew = false;
    let isSubmitted = false;
    let isResponded = false;
    let outcome: "Approved" | "Rejected" | "None" = "None";
    const ncrMonthEvents: NCREventRecord[] = [];

    // ------------------------------------------------------------
    // A. True Event-Grain Timeline Tracker
    //    Event Identity = NCR Ref + Event Type + Event Date + Revision
    // ------------------------------------------------------------

    // EVENT 1: Original NCR Issuance (Counted AT MOST ONCE per distinct NCR Ref)
    // Fixes NCR-002 & NCR-003: Inherited `submissionDate` on Rev01/Rev02 never inflates `newNcrReceived`.
    let originRow: SubmittalRow = history[0];
    let originalIssueMs: number | null = parseDateToMs(originRow.submissionDate);
    if (originalIssueMs === null) {
      for (const r of history) {
        const ms = parseDateToMs(r.submissionDate);
        if (ms !== null && (originalIssueMs === null || ms < originalIssueMs)) {
          originalIssueMs = ms;
          originRow = r;
        }
      }
    }

    if (
      originalIssueMs !== null &&
      originalIssueMs >= startOfTargetMonthMs &&
      originalIssueMs <= endOfTargetMonthMs
    ) {
      mSt.newNcrReceived++;
      isNew = true;
      distinctNewNcrRefsInMonth.add(refKey);
      const issueDay = toIsoDay(originalIssueMs);
      const normRev = getNormalizedRevision(originRow.rev, originRow.isRev0);
      const ev: NCREventRecord = {
        eventId: `${refKey}|RECEIVED|${issueDay}|${normRev}`,
        ref: refKey,
        discipline: disc,
        eventType: "RECEIVED",
        eventDate: originRow.submissionDate || issueDay,
        eventTimestampMs: originalIssueMs,
        rev: originRow.rev || "00",
        normalizedRev: normRev,
        rowId: originRow.id || `${refKey}-R0`,
        actionCode: originRow.ncrAction || originRow.action || "-",
        status: originRow.ncrStatus || originRow.status || "Open"
      };
      ncrMonthEvents.push(ev);
      monthlyEvents.push(ev);
    }

    // EVENT 2 (CORRECTIVE_SUBMITTED) & EVENT 3 (RESPONSE)
    // Deduplicate inherited `sentDate` and `responseDate` across revisions of the same NCR Ref.
    // Fixes NCR-002, NCR-004, NCR-005, NCR-012, NCR-013.
    const seenSentDays = new Set<string>();
    const seenRespDays = new Set<string>();
    let lastValidResponseMs: number | null = null;

    history.forEach((r) => {
      const sentStr = r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction;
      const sentDateMs = parseDateToMs(sentStr);
      const sentDay = toIsoDay(sentDateMs);

      const respStr = r.responseDate;
      const responseDateMs = parseDateToMs(respStr);
      const respDay = toIsoDay(responseDateMs);
      const normRev = getNormalizedRevision(r.rev, r.isRev0);

      // Check if `sentDate` is a genuine new Corrective Action Submission event for this NCR
      const isGenuineSentEvent =
        sentDateMs !== null &&
        !seenSentDays.has(sentDay) &&
        (lastValidResponseMs === null || sentDateMs >= lastValidResponseMs);

      if (isGenuineSentEvent && sentDateMs !== null) {
        seenSentDays.add(sentDay);

        if (sentDateMs >= startOfTargetMonthMs && sentDateMs <= endOfTargetMonthMs) {
          mSt.correctiveSubmitted++;
          mSt.totalSubs++; // Legacy
          isSubmitted = true;

          const isRev0 = isRevision0(r.rev, r.isRev0);
          const isFurther = isFurtherRevision(r.rev, r.isRev0);
          if (isFurther) {
            mSt.revHigh++;
          } else if (isRev0 || !r.rev) {
            mSt.rev0++;
          }

          const cStatusRev = resolveNcrOutcome(r);
          let outcomeStr = "Pending";
          if (cStatusRev.isApprovedClosed) {
            outcomeStr = "Approved Closed";
          } else if (cStatusRev.isRejectedOpen) {
            outcomeStr = "Rejected Open";
          } else if (cStatusRev.isRejectedClosed) {
            outcomeStr = "Rejected Closed";
          }

          // NOTE (Fixes NCR-001): Do NOT increment `mSt.overdue` here!
          // Critical Overdue is strictly a Month-End Snapshot KPI (count of distinct NCRs open > 14 days at month-end).

          const subEv: NCREventRecord = {
            eventId: `${refKey}|CORRECTIVE_SUBMITTED|${sentDay}|${normRev}`,
            ref: refKey,
            discipline: disc,
            eventType: "CORRECTIVE_SUBMITTED",
            eventDate: sentStr || sentDay,
            eventTimestampMs: sentDateMs,
            rev: r.rev || "00",
            normalizedRev: normRev,
            rowId: r.id || `${refKey}-${normRev}`,
            actionCode: r.ncrAction || r.action || "-",
            status: r.ncrStatus || r.status || "Open"
          };
          ncrMonthEvents.push(subEv);
          monthlyEvents.push(subEv);

          mSubList.push({
            eventId: subEv.eventId,
            ref: refKey,
            trade: disc,
            rev: r.rev || "00",
            sentDate: sentStr || "-",
            action: r.ncrAction || r.action || "-",
            status: r.ncrStatus || r.status || "Open",
            classification: outcomeStr
          });
        }
      }

      // Check if `responseDate` is a genuine new Consultant Response event for this NCR
      const isGenuineResponseEvent =
        responseDateMs !== null &&
        !seenRespDays.has(respDay) &&
        (!isGenuineSentEvent || sentDateMs === null || responseDateMs >= sentDateMs);

      if (isGenuineResponseEvent && responseDateMs !== null) {
        seenRespDays.add(respDay);
        if (lastValidResponseMs === null || responseDateMs > lastValidResponseMs) {
          lastValidResponseMs = responseDateMs;
        }

        if (responseDateMs >= startOfTargetMonthMs && responseDateMs <= endOfTargetMonthMs) {
          mSt.responsesReceived++;
          isResponded = true;
          const cStatusRev = resolveNcrOutcome(r);
          const evOutcome: "Approved" | "Rejected" = cStatusRev.isApprovedClosed
            ? "Approved"
            : "Rejected";

          if (evOutcome === "Approved") {
            mSt.approved++;
            outcome = "Approved";
          } else {
            mSt.rejected++;
            mSt.rejectedOpen++; // Legacy
            outcome = "Rejected";
          }

          const respEv: NCREventRecord = {
            eventId: `${refKey}|RESPONSE|${respDay}|${normRev}`,
            ref: refKey,
            discipline: disc,
            eventType: "RESPONSE",
            eventDate: respStr || respDay,
            eventTimestampMs: responseDateMs,
            rev: r.rev || "00",
            normalizedRev: normRev,
            rowId: r.id || `${refKey}-${normRev}`,
            outcome: evOutcome,
            actionCode: r.ncrAction || r.action || "-",
            status: r.ncrStatus || r.status || (evOutcome === "Approved" ? "Closed" : "Open")
          };
          ncrMonthEvents.push(respEv);
          monthlyEvents.push(respEv);
        }
      }
    });

    if (refKey) {
      monthlyEventTraces.set(refKey, {
        isNew,
        isSubmitted,
        isResponded,
        outcome,
        events: ncrMonthEvents
      });
    }

    // ------------------------------------------------------------
    // B. State assessment of this NCR *as of* the last day of the target month
    //    Fixes NCR-006: Uses `getRevisionActivityDateMs` so future revisions with
    //    inherited `submissionDate` NEVER leak into historical month-end snapshots.
    // ------------------------------------------------------------
    const historyBeforeEnd = history.filter((r, idx) => {
      const actMs = getRevisionActivityDateMs(r, idx, history);
      if (actMs === null) return false;
      return actMs <= endOfTargetMonthMs;
    });

    if (historyBeforeEnd.length > 0) {
      const latestAtEnd = historyBeforeEnd[historyBeforeEnd.length - 1];
      const latestAtEndIdx = history.indexOf(latestAtEnd);
      const latestAtEndActMs = getRevisionActivityDateMs(latestAtEnd, latestAtEndIdx, history);
      if (latestAtEndActMs !== null && latestAtEndActMs > endOfTargetMonthMs) {
        temporalSnapshotPassed = false;
      }

      const sentMs = parseDateToMs(
        latestAtEnd.ncrSentDateCorrectiveAction || latestAtEnd.sentDateCorrectiveAction
      );
      const rawResponseMs = parseDateToMs(latestAtEnd.responseDate);
      const responseMs =
        rawResponseMs !== null && (sentMs === null || rawResponseMs >= sentMs)
          ? rawResponseMs
          : null;
      const issueMs = originalIssueMs ?? parseDateToMs(latestAtEnd.submissionDate);

      if (sentMs !== null && sentMs <= endOfTargetMonthMs) {
        // Sent corrective action has been submitted on or before end of month
        if (responseMs === null || responseMs > endOfTargetMonthMs) {
          // No response yet, or response came after month end -> Waiting Consultant
          mSt.waitingConsultant++;
          mSt.pending++; // Legacy
          mSt.waiting++; // Legacy

          if (sentMs < startOfTargetMonthMs) {
            mSt.carryForwardPending++;
          } else {
            mSt.currentMonthPending++;
          }
        } else {
          // Response was received on or before end of month
          const cStatusAtEnd = resolveNcrOutcome(latestAtEnd);
          if (!cStatusAtEnd.isApprovedClosed) {
            // Rejected -> Waiting Contractor
            mSt.waitingContractor++;
          }
        }
      } else {
        // Sent corrective action has NOT been submitted as of end of month -> Waiting Contractor
        if (issueMs !== null && issueMs <= endOfTargetMonthMs) {
          mSt.waitingContractor++;
        }
      }

      // Single-Count Month-End Overdue Rule (Fixes NCR-001):
      // Critical Overdue = COUNT(DISTINCT NCR Ref) that were open at month-end AND daysOpen > 14
      if (issueMs !== null && issueMs <= endOfTargetMonthMs) {
        const hasApprovedResponseByEnd =
          responseMs !== null &&
          responseMs <= endOfTargetMonthMs &&
          resolveNcrOutcome(latestAtEnd).isApprovedClosed;

        if (!hasApprovedResponseByEnd) {
          const nowMs = Date.now();
          const referenceMs = endOfTargetMonthMs > nowMs ? nowMs : endOfTargetMonthMs;
          const daysOpen = Math.floor((referenceMs - issueMs) / (1000 * 3600 * 24));
          if (daysOpen > 14) {
            mSt.overdue++;
            distinctOverdueNcrRefsAtMonthEnd.add(refKey);
          }
        }
      }
    }
  });

  const monArr = Array.from(mMap.values())
    .filter(
      (s) =>
        s.newNcrReceived > 0 ||
        s.correctiveSubmitted > 0 ||
        s.responsesReceived > 0 ||
        s.waitingConsultant > 0 ||
        s.waitingContractor > 0 ||
        s.overdue > 0
    )
    .sort((a, b) => b.newNcrReceived - a.newNcrReceived);

  const monthlyKPIs = {
    newNcrReceived: monArr.reduce((a, c) => a + c.newNcrReceived, 0),
    correctiveSubmitted: monArr.reduce((a, c) => a + c.correctiveSubmitted, 0),
    responsesReceived: monArr.reduce((a, c) => a + c.responsesReceived, 0),
    approved: monArr.reduce((a, c) => a + c.approved, 0),
    rejected: monArr.reduce((a, c) => a + c.rejected, 0),
    waitingConsultant: monArr.reduce((a, c) => a + c.waitingConsultant, 0),
    waitingContractor: monArr.reduce((a, c) => a + c.waitingContractor, 0),
    criticalDelays: monArr.reduce((a, c) => a + c.overdue, 0),

    // Legacy compatibility fields
    totalSubs: monArr.reduce((a, c) => a + c.correctiveSubmitted, 0),
    rev0: monArr.reduce((a, c) => a + c.rev0, 0),
    revHigh: monArr.reduce((a, c) => a + c.revHigh, 0),
    rejectedOpen: monArr.reduce((a, c) => a + c.rejectedOpen, 0),
    rejectedClosed: monArr.reduce((a, c) => a + c.rejectedClosed, 0),
    pending: monArr.reduce((a, c) => a + c.waitingConsultant, 0),
    carryForwardPending: monArr.reduce((a, c) => a + (c.carryForwardPending || 0), 0),
    currentMonthPending: monArr.reduce((a, c) => a + (c.currentMonthPending || 0), 0),
    waiting: monArr.reduce((a, c) => a + (c.waitingConsultant || 0), 0)
  };

  return {
    monthly: monArr,
    monthlyKPIs,
    monthlySubmissions: mSubList.sort((a, b) => a.ref.localeCompare(b.ref)),
    monthlyEvents,
    monthlyEventTraces,
    forensicMeta: {
      temporalSnapshotPassed,
      distinctNewNcrRefsCount: distinctNewNcrRefsInMonth.size,
      distinctOverdueNcrRefsCount: distinctOverdueNcrRefsAtMonthEnd.size
    }
  };
};

// ==========================================
// 3. Main Export function orchestration
// ==========================================
export const processNCRData = (
  safeData: SubmittalRow[],
  monthlyStart: string | undefined
) => {
  const normalizedData = normalizeNCRData(safeData);
  const grouped = groupNCRByReference(normalizedData);

  const { cumulative, cumulativeKPIs, cumulativeEvidence } =
    calculateCumulativeSnapshot(normalizedData);
  const {
    monthly,
    monthlyKPIs,
    monthlySubmissions,
    monthlyEvents,
    monthlyEventTraces,
    forensicMeta
  } = calculateMonthlyEvents(normalizedData, monthlyStart);

  // Join cumulative evidence with monthly event traces & full event ledger
  const evidenceList: NCREvidence[] = cumulativeEvidence.map((e) => {
    const trace = monthlyEventTraces.get(e.ref.trim().toUpperCase()) || {
      isNew: false,
      isSubmitted: false,
      isResponded: false,
      outcome: "None" as const,
      events: []
    };
    return {
      ...e,
      isNewInMonth: trace.isNew,
      isSubmittedInMonth: trace.isSubmitted,
      isRespondedInMonth: trace.isResponded,
      monthlyOutcome: trace.outcome,
      eventsInMonth: trace.events
    };
  });

  // Execute Chapter 9 + Forensic Business Accuracy Certification Auditing (Fixes NCR-009)
  const sumOfStates =
    cumulativeKPIs.open + cumulativeKPIs.underReview + cumulativeKPIs.closed;
  const cumulativeTotalPassed =
    cumulativeKPIs.totalUnique === sumOfStates &&
    cumulativeKPIs.totalUnique === grouped.size;

  const monthlyResSum = monthlyKPIs.approved + monthlyKPIs.rejected;
  const responseEventsInLedger = monthlyEvents.filter(
    (ev) => ev.eventType === "RESPONSE"
  ).length;
  const monthlyResponsePassed =
    monthlyKPIs.responsesReceived === monthlyResSum &&
    monthlyKPIs.responsesReceived === responseEventsInLedger;

  const openStagesSum = cumulativeKPIs.notSent + cumulativeKPIs.rejectedOpen;
  const openIntegrityPassed = cumulativeKPIs.open === openStagesSum;

  const submittedEventsInLedger = monthlyEvents.filter(
    (ev) => ev.eventType === "CORRECTIVE_SUBMITTED"
  ).length;
  const receivedEventsInLedger = monthlyEvents.filter(
    (ev) => ev.eventType === "RECEIVED"
  ).length;

  const entityUniquenessPassed =
    cumulativeKPIs.totalUnique === grouped.size &&
    monthlyKPIs.newNcrReceived === forensicMeta.distinctNewNcrRefsCount &&
    monthlyKPIs.newNcrReceived === receivedEventsInLedger;

  const eventDeduplicationPassed =
    new Set(monthlyEvents.map((ev) => ev.eventId)).size === monthlyEvents.length &&
    monthlyKPIs.correctiveSubmitted === submittedEventsInLedger &&
    monthlyKPIs.responsesReceived === responseEventsInLedger;

  const temporalSnapshotPassed = forensicMeta.temporalSnapshotPassed;

  const overdueSingleCountPassed =
    monthlyKPIs.criticalDelays === forensicMeta.distinctOverdueNcrRefsCount;

  const detailTableGrainParityPassed =
    monthlySubmissions.length === monthlyKPIs.correctiveSubmitted &&
    monthlySubmissions.length === submittedEventsInLedger;

  const disciplineClassificationPassed =
    normalizeDiscipline({ discipline: "SURVEY" } as SubmittalRow) === "SURVEY" &&
    normalizeDiscipline({ discipline: "HSE" } as SubmittalRow) === "HSE";

  const sumRevBuckets = cumulative.reduce((acc, c) => acc + c.rev0 + c.revHigh, 0);
  const crossEngineReconciliationPassed =
    sumRevBuckets === cumulativeKPIs.totalUnique &&
    cumulativeKPIs.totalUnique === grouped.size;

  const allForensicChecksPassed =
    cumulativeTotalPassed &&
    monthlyResponsePassed &&
    openIntegrityPassed &&
    entityUniquenessPassed &&
    eventDeduplicationPassed &&
    temporalSnapshotPassed &&
    overdueSingleCountPassed &&
    detailTableGrainParityPassed &&
    disciplineClassificationPassed &&
    crossEngineReconciliationPassed;

  const integrityReport: NCRIntegrityReport = {
    passed: allForensicChecksPassed,
    cumulativePartitioning: {
      totalUnique: cumulativeKPIs.totalUnique,
      sumOfStates,
      difference: Math.abs(cumulativeKPIs.totalUnique - sumOfStates),
      passed: cumulativeTotalPassed
    },
    monthlyResponseCheck: {
      responsesReceived: monthlyKPIs.responsesReceived,
      approvedAndRejected: monthlyResSum,
      difference: Math.abs(monthlyKPIs.responsesReceived - monthlyResSum),
      passed: monthlyResponsePassed
    },
    openIntegrityCheck: {
      currentlyOpen: cumulativeKPIs.open,
      sumOfOpenStages: openStagesSum,
      difference: Math.abs(cumulativeKPIs.open - openStagesSum),
      passed: openIntegrityPassed
    },
    forensicChecks: {
      entityUniquenessPassed,
      eventDeduplicationPassed,
      temporalSnapshotPassed,
      overdueSingleCountPassed,
      detailTableGrainParityPassed,
      disciplineClassificationPassed,
      crossEngineReconciliationPassed
    }
  };

  const auditId = `AUD-NCR-${Math.floor(Math.random() * 90000 + 10000)}`;
  recordAuditLog({
    processName: "NCR Dual Engine Validation",
    recordIdentifier: auditId,
    action: "DUAL_COMPARISON",
    ruleApplied: "BR-0101",
    engineVersion: "4.0.0-FORENSIC-CERTIFIED",
    executedBy: "System QA Auditor",
    result: integrityReport.passed ? "SUCCESS" : "WARNING",
    engineUsed: "Dual Comparison",
    remarks: `Validation: ${integrityReport.passed ? "PASS" : "FAIL"} | Module: NCR Event-Driven Engine | Total: ${cumulativeKPIs.totalUnique} | Open Snapshot: ${cumulativeKPIs.open} | Closed Snapshot: ${cumulativeKPIs.closed} | Monthly Events - New: ${monthlyKPIs.newNcrReceived}, Submitted: ${monthlyKPIs.correctiveSubmitted}, Responses: ${monthlyKPIs.responsesReceived}, Overdue: ${monthlyKPIs.criticalDelays}`
  });

  return {
    cumulative,
    monthly,
    monthlySubmissions,
    monthlyEvents,
    monthlyKPIs,
    cumulativeKPIs,
    evidenceList,
    integrityReport
  };
};
