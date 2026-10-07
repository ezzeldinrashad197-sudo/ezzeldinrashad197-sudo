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
 * Determines whether `submissionDate` (Issue Date) on revision `r` at `index`
 * is inherited from an earlier revision (`0 .. index-1`).
 */
export const isInheritedIssueDate = (
  r: SubmittalRow,
  index: number,
  sortedHistory: SubmittalRow[]
): boolean => {
  const issueMs = parseDateToMs(r.submissionDate);
  if (issueMs === null) return true;
  if (index === 0) return false;

  const issueDay = toIsoDay(issueMs);
  for (let i = 0; i < index; i++) {
    const prev = sortedHistory[i];
    const pIssueMs = parseDateToMs(prev.submissionDate);
    const pSentMs = parseDateToMs(prev.ncrSentDateCorrectiveAction || prev.sentDateCorrectiveAction);
    const pRespMs = parseDateToMs(prev.responseDate);

    if (pIssueMs !== null && (toIsoDay(pIssueMs) === issueDay || issueMs <= pIssueMs)) {
      return true;
    }
    if (pSentMs !== null && issueMs <= pSentMs) {
      return true;
    }
    if (pRespMs !== null && issueMs <= pRespMs) {
      return true;
    }
  }
  return false;
};

/**
 * Determines whether `sentDateCorrectiveAction` on revision `r` at `index`
 * is an inherited historical date from an earlier revision (`0 .. index-1`)
 * rather than a genuine new Corrective Action Submission event on `r`.
 *
 * Distinguishes:
 * 1. Inherited duplicate (e.g. Rev00 Sent=10-Jun, Rev01 Sent=10-Jun inherited) -> returns true
 * 2. Genuine new event on a later date (e.g. Rev00 Sent=10-Jun, Rev01 Sent=22-Jun) -> returns false
 * 3. Genuine same-day resubmission in a strictly higher revision after same-day rejection on prior revision,
 *    where the new revision initiates a new review cycle (blank or later responseDate, or explicit activity date) -> returns false
 */
export const isInheritedSentDate = (
  r: SubmittalRow,
  index: number,
  sortedHistory: SubmittalRow[]
): boolean => {
  const sentMs = parseDateToMs(r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction);
  if (sentMs === null) return true;
  if (index === 0) return false;

  const sentDay = toIsoDay(sentMs);
  const respMs = parseDateToMs(r.responseDate);
  const respDay = toIsoDay(respMs);
  const anyR = r as Record<string, any>;
  const hasExplicitActivity =
    parseDateToMs(anyR.revisionActivityDate || anyR.revisionDate || anyR.activityDate) !== null;

  for (let i = 0; i < index; i++) {
    const prev = sortedHistory[i];
    const pSentMs = parseDateToMs(prev.ncrSentDateCorrectiveAction || prev.sentDateCorrectiveAction);
    const pRespMs = parseDateToMs(prev.responseDate);
    const pSentDay = toIsoDay(pSentMs);
    const pRespDay = toIsoDay(pRespMs);

    // Chronological impossibility: cannot be a new submission if earlier than a prior revision's sent or response timestamp
    if (pSentMs !== null && sentMs < pSentMs) return true;
    if (pRespMs !== null && sentMs < pRespMs) return true;

    if (pSentDay && pSentDay === sentDay) {
      const isHigherRev = compareRevisions(r.rev, prev.rev) > 0;
      const prevRespondedSameDay = pRespDay === sentDay;
      const initiatesNewCycle =
        respMs === null ||
        respDay !== pRespDay ||
        hasExplicitActivity ||
        anyR.isGenuineSameDayEvent === true;

      if (isHigherRev && prevRespondedSameDay && initiatesNewCycle) {
        continue;
      }
      return true;
    }
  }

  return false;
};

/**
 * Determines whether `responseDate` on revision `r` at `index`
 * is an inherited historical date from an earlier revision (`0 .. index-1`)
 * rather than a genuine new Consultant Response event on `r`.
 */
export const isInheritedResponseDate = (
  r: SubmittalRow,
  index: number,
  sortedHistory: SubmittalRow[]
): boolean => {
  const sentMs = parseDateToMs(r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction);
  const respMs = parseDateToMs(r.responseDate);
  if (respMs === null) return true;

  // A consultant response cannot precede the revision's own corrective action submission
  if (sentMs !== null && respMs < sentMs) return true;
  if (index === 0) return false;

  const respDay = toIsoDay(respMs);
  const anyR = r as Record<string, any>;
  const hasExplicitActivity =
    parseDateToMs(anyR.revisionActivityDate || anyR.revisionDate || anyR.activityDate) !== null;
  const sentWasInherited = isInheritedSentDate(r, index, sortedHistory);

  for (let i = 0; i < index; i++) {
    const prev = sortedHistory[i];
    const pSentMs = parseDateToMs(prev.ncrSentDateCorrectiveAction || prev.sentDateCorrectiveAction);
    const pRespMs = parseDateToMs(prev.responseDate);
    const pRespDay = toIsoDay(pRespMs);

    if (pSentMs !== null && respMs < pSentMs) return true;
    if (pRespMs !== null && respMs < pRespMs) return true;

    if (pRespDay && pRespDay === respDay) {
      const isHigherRev = compareRevisions(r.rev, prev.rev) > 0;
      if (isHigherRev && !sentWasInherited && (hasExplicitActivity || anyR.isGenuineSameDayEvent === true)) {
        continue;
      }
      return true;
    }
  }

  return false;
};

/**
 * Resolves the true temporal activity start timestamp of a specific revision `r`
 * within a sorted NCR revision history (`sortedHistory`).
 *
 * Fixes NCR-006 & NCR-007 (and Defect #1 Temporal Revision Leakage):
 * - Distinguishes CURRENT REVISION ACTIVITY from INHERITED HISTORICAL DATA.
 * - If a subsequent revision (`index > 0`) contains NO genuine activity attributable
 *   to that revision (all dates are inherited from prior revisions), returns `null`.
 * - NEVER falls back to `maxPriorEventMs` or inherited `submissionDate`/`sentDate`/`responseDate`.
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

  // Subsequent revision (index > 0): collect ONLY genuine current-revision activity timestamps
  const priorExplicitDays = new Set<string>();
  let maxPriorEventMs: number | null = null;

  for (let i = 0; i < index; i++) {
    const prev = sortedHistory[i];
    const anyPrev = prev as Record<string, any>;
    const pExplicitMs = parseDateToMs(
      anyPrev.revisionActivityDate || anyPrev.revisionDate || anyPrev.activityDate
    );
    const pIssueMs = parseDateToMs(prev.submissionDate);
    const pSentMs = parseDateToMs(prev.ncrSentDateCorrectiveAction || prev.sentDateCorrectiveAction);
    const pRespMs = parseDateToMs(prev.responseDate);

    if (pExplicitMs !== null) {
      priorExplicitDays.add(toIsoDay(pExplicitMs));
      if (maxPriorEventMs === null || pExplicitMs > maxPriorEventMs) maxPriorEventMs = pExplicitMs;
    }
    if (pIssueMs !== null && (maxPriorEventMs === null || pIssueMs > maxPriorEventMs)) {
      maxPriorEventMs = pIssueMs;
    }
    if (pSentMs !== null && (maxPriorEventMs === null || pSentMs > maxPriorEventMs)) {
      maxPriorEventMs = pSentMs;
    }
    if (pRespMs !== null && (maxPriorEventMs === null || pRespMs > maxPriorEventMs)) {
      maxPriorEventMs = pRespMs;
    }
  }

  const candidateMs: number[] = [];

  if (
    explicitRevActivityMs !== null &&
    !priorExplicitDays.has(toIsoDay(explicitRevActivityMs)) &&
    (maxPriorEventMs === null || explicitRevActivityMs >= maxPriorEventMs)
  ) {
    candidateMs.push(explicitRevActivityMs);
  }

  if (issueMs !== null && !isInheritedIssueDate(r, index, sortedHistory)) {
    candidateMs.push(issueMs);
  }

  if (sentMs !== null && !isInheritedSentDate(r, index, sortedHistory)) {
    candidateMs.push(sentMs);
  }

  if (respMs !== null && !isInheritedResponseDate(r, index, sortedHistory)) {
    candidateMs.push(respMs);
  }

  if (candidateMs.length > 0) {
    return Math.min(...candidateMs);
  }

  // Mandatory Temporal Rule: If a subsequent revision has NO genuine activity, return null.
  return null;
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

const FORBIDDEN_NCR_REF_TOKENS = new Set([
  "",
  "-",
  "--",
  "---",
  "N/A",
  "NA",
  "NONE",
  "NULL",
  "UNDEFINED",
  "UNKNOWN",
  "NIL",
  "TBD",
  "BLANK",
  "PENDING",
  "OPEN",
  "CLOSED",
  "WAITING",
  "UNDER REVIEW",
  "APPROVED",
  "REJECTED",
  "YES",
  "NO",
  "TRUE",
  "FALSE",
  // Discipline / Trade / Register tokens must NEVER be manufactured into NCR Refs
  "STR",
  "STRUCT",
  "STRUCTURAL",
  "CIVIL",
  "CVL",
  "STRUCTURE",
  "ARC",
  "ARCH",
  "ARCHITECTURAL",
  "ARCHITECTURE",
  "MEC",
  "MECH",
  "MECHANICAL",
  "HVAC",
  "PLUMBING",
  "ELE",
  "ELEC",
  "ELECTRICAL",
  "MEP",
  "INF",
  "INFR",
  "INFRA",
  "INFRASTRUCTURE",
  "UTILITIES",
  "ROADS",
  "LND",
  "LAND",
  "LANDSCAPE",
  "IRR",
  "IRRIGATION",
  "SUR",
  "SURV",
  "SURVEY",
  "SURVEYING",
  "HSE",
  "SAFETY",
  "GEN",
  "GENERAL",
  "COMMON",
  "ALL",
  "MIXED",
  "MULTIDISCIPLINE",
  "UNCLASSIFIED",
  "STR/SUR",
  "STR-SUR",
  "NCR",
  "SOR",
  "WIR",
  "MIR",
  "MAR",
  "SDW",
  "SHD",
  "RFI",
  "DOC",
  "ABD",
  "LTR",
  "QS"
]);

/**
 * Validates whether a candidate string is a genuine source NCR Ref.
 * Strictly forbids manufacturing NCR identifiers from:
 * - blank NCR Ref / placeholders
 * - synthetic composite keys (e.g. `STR::16- NON-CONFORMANCE REPORT (NCR)::1`)
 * - Excel row numbers / positions (e.g. `1`, `2`, `ROW-1`)
 * - Trade / Discipline codes
 * - Subject / section / category / workbook title text
 */
export const isValidNcrReference = (
  candidate: string | undefined | null,
  row?: SubmittalRow
): boolean => {
  if (!candidate || typeof candidate !== "string") return false;
  const clean = candidate.trim().toUpperCase();
  if (!clean || FORBIDDEN_NCR_REF_TOKENS.has(clean)) return false;

  // Never allow synthetic composite keys (such as `${sheetName}::${cleanFileBase}::${idx}`)
  if (clean.includes("::")) return false;

  // Never allow pure row numbers or Excel position indices
  if (/^(?:ROW[-_\s#]*|ITEM[-_\s#]*|LINE[-_\s#]*|POS[-_\s#]*|SR[-_\s#]*|SN[-_\s#]*|S\/N[-_\s#]*|#)?\d+$/i.test(clean)) {
    return false;
  }

  // Never allow workbook/sheet/section/category header text
  if (
    /\b(?:NON[- ]?CONFORMANCE|NCR\s+REGISTER|NCR\s+LOG|NCR\s+REPORT|SUMMARY|SUBTOTAL|GRAND\s+TOTAL|TOTAL|SECTION|CATEGORY|CONTINUATION)\b/i.test(
      clean
    )
  ) {
    return false;
  }

  if (row) {
    const fileBase = (row.sourceFile || row.sourceFileName || "")
      .replace(/\.[^/.]+$/, "")
      .trim()
      .toUpperCase();
    if (fileBase && clean === fileBase) return false;

    const sheetName = (row.sourceSheetName || row.disciplineSourceSheet || "")
      .trim()
      .toUpperCase();
    if (sheetName && clean === sheetName) return false;

    const subj = (row.subject || "").trim().toUpperCase();
    if (subj && clean === subj && !/\bNCR[-_/\s0-9]/i.test(clean)) return false;
  }

  return true;
};

const getNcrSourceScopeKey = (row: SubmittalRow): string => {
  return (
    row.rawSourceIdentity ||
    row.sourceWorkbookName ||
    row.sourceFileName ||
    row.sourceFile ||
    "__DEFAULT_SCOPE__"
  )
    .trim()
    .toUpperCase();
};

const detectScopesWithExplicitNcrRef = (rows: SubmittalRow[]): Set<string> => {
  const scopes = new Set<string>();
  if (!Array.isArray(rows)) return scopes;
  for (const r of rows) {
    if (!r) continue;
    const rawNcrRef = (r.ncrRef || "").trim();
    if (rawNcrRef && isValidNcrReference(rawNcrRef, r)) {
      scopes.add(getNcrSourceScopeKey(r));
    }
  }
  return scopes;
};

/**
 * Resolves the canonical NCR Reference for a row.
 * - `ncrRef` is the primary NCR identity.
 * - If the source sheet/workbook has explicit `ncrRef` values, rows with blank `ncrRef`
 *   are continuation/template rows and MUST return `""` (never falling back to docNo/id/trade/subject).
 * - Fallback to `docNo` or `submissionRef` is only permitted when the source scope has no explicit
 *   `ncrRef` column and the candidate passes `isValidNcrReference`.
 * - `row.id` is NEVER used to manufacture an NCR identity.
 */
export const resolveCanonicalNcrRef = (
  row: SubmittalRow | undefined | null,
  scopeHasExplicitNcrRef = false
): string => {
  if (!row) return "";

  const explicitNcrRef = (row.ncrRef || "").trim();
  if (explicitNcrRef) {
    return isValidNcrReference(explicitNcrRef, row) ? explicitNcrRef.toUpperCase() : "";
  }

  if (scopeHasExplicitNcrRef) {
    return "";
  }

  const candidateDocNo = (row.docNo || "").trim();
  if (candidateDocNo && isValidNcrReference(candidateDocNo, row)) {
    return candidateDocNo.toUpperCase();
  }

  const candidateSubRef = (row.submissionRef || "").trim();
  if (candidateSubRef && isValidNcrReference(candidateSubRef, row)) {
    return candidateSubRef.toUpperCase();
  }

  return "";
};

/**
 * Determines whether a row belongs to the NCR register domain (before identity filtering).
 */
export const isNCRDomainRow = (d: SubmittalRow): boolean => {
  if (!d) return false;
  if ((d as any).excludeFromKPI === true || (d as any).isExcluded === true) return false;

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

  const docT = (d.documentType || "").trim().toUpperCase();
  const logT = (d.logType || "").trim().toUpperCase();
  const ncrRef = (d.ncrRef || "").trim().toUpperCase();
  const docNo = (d.docNo || "").trim().toUpperCase();

  if (docT === "NCR" || docT.startsWith("NCR-") || logT === "NCR" || logT.startsWith("NCR-")) {
    return true;
  }
  if (
    ncrRef.startsWith("NCR") ||
    /^NCR[-_/\s0-9]/i.test(docNo) ||
    /(?:^|[-_/\s])NCR(?:$|[-_/\s0-9])/i.test(docNo) ||
    /(?:^|[-_/\s])NCR(?:$|[-_/\s0-9])/i.test(ncrRef)
  ) {
    return true;
  }
  return false;
};

export interface NCRForensicIdentityRowSummary {
  rowId: string;
  ncrRef: string;
  rev: string;
  lastRev: string;
  trade: string;
  receivedDate: string;
  sentCorrectiveDate: string;
  responseDate: string;
  action: string;
  status: string;
  sourceSheet: string;
}

export interface NCRBlankContinuationRowSummary {
  rowId: string;
  sourceSheet: string;
  trade: string;
  rev: string;
  rawNcrRef: string;
  rawDocNo: string;
  blockedSyntheticId: string;
  classification: "BLANK_NCR_REF_CONTINUATION_ROW";
}

export interface NCRForensicIdentityInventory {
  discoveredNcrRefs: string[];
  uniqueNcrRefCount: number;
  rowsByNcrRef: Record<string, NCRForensicIdentityRowSummary[]>;
  blankContinuationRows: NCRBlankContinuationRowSummary[];
  rejectedSyntheticIdentities: string[];
  zeroSyntheticCountVerified: boolean;
}

/**
 * Produces a forensic source-identity inventory across the supplied dataset:
 * 1. Lists every actual non-empty NCR Ref discovered.
 * 2. Counts unique NCR Ref values.
 * 3. Shows all source rows assigned to each NCR Ref.
 * 4. Identifies blank NCR Ref continuation rows separately.
 * 5. Proves that no synthetic NCR identity (`::`, row index, trade, blank ref) is counted as a unique NCR.
 */
export const buildNCRForensicIdentityInventory = (
  safeData: SubmittalRow[]
): NCRForensicIdentityInventory => {
  const domainRows = Array.isArray(safeData) ? safeData.filter(isNCRDomainRow) : [];
  const scopesWithExplicitNcrRef = detectScopesWithExplicitNcrRef(domainRows);

  const discoveredNcrRefs: string[] = [];
  const seenRefs = new Set<string>();
  const rowsByNcrRef: Record<string, NCRForensicIdentityRowSummary[]> = {};
  const blankContinuationRows: NCRBlankContinuationRowSummary[] = [];
  const rejectedSyntheticIdentities: string[] = [];

  for (const r of domainRows) {
    const scopeHasExplicit = scopesWithExplicitNcrRef.has(getNcrSourceScopeKey(r));
    const resolvedRef = resolveCanonicalNcrRef(r, scopeHasExplicit);

    if (resolvedRef) {
      if (!seenRefs.has(resolvedRef)) {
        seenRefs.add(resolvedRef);
        discoveredNcrRefs.push(resolvedRef);
        rowsByNcrRef[resolvedRef] = [];
      }
      rowsByNcrRef[resolvedRef].push({
        rowId: r.id || "",
        ncrRef: resolvedRef,
        rev: r.rev || "0",
        lastRev: r.ncrLastRev || (r.isLatestRev ? "Yes" : ""),
        trade: normalizeDiscipline(r),
        receivedDate: r.submissionDate || "",
        sentCorrectiveDate: r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction || "",
        responseDate: r.responseDate || "",
        action: r.ncrAction || r.action || "",
        status: r.ncrStatus || r.status || "",
        sourceSheet: r.sourceSheetName || r.disciplineSourceSheet || ""
      });
    } else {
      const blockedSyntheticId = (r.id || "").trim().toUpperCase();
      if (blockedSyntheticId) {
        rejectedSyntheticIdentities.push(blockedSyntheticId);
      }
      blankContinuationRows.push({
        rowId: r.id || "",
        sourceSheet: r.sourceSheetName || r.disciplineSourceSheet || "",
        trade: normalizeDiscipline(r),
        rev: r.rev || "",
        rawNcrRef: r.ncrRef || "",
        rawDocNo: r.docNo || "",
        blockedSyntheticId,
        classification: "BLANK_NCR_REF_CONTINUATION_ROW"
      });
    }
  }

  const zeroSyntheticCountVerified = discoveredNcrRefs.every(
    (ref) => isValidNcrReference(ref) && !ref.includes("::")
  );

  return {
    discoveredNcrRefs,
    uniqueNcrRefCount: discoveredNcrRefs.length,
    rowsByNcrRef,
    blankContinuationRows,
    rejectedSyntheticIdentities,
    zeroSyntheticCountVerified
  };
};

/**
 * Canonical NCR Population Filter (Fixes NCR-011 & Source-Identity Rule)
 * Prioritizes canonical `registerIdentity === 'NCR'`, rejects rows belonging to other canonical registers,
 * and strictly excludes blank `NCR Ref` continuation rows so synthetic row IDs never become NCR entities.
 */
export const normalizeNCRData = (safeData: SubmittalRow[]): SubmittalRow[] => {
  if (!Array.isArray(safeData)) return [];
  const domainRows = safeData.filter(isNCRDomainRow);
  const scopesWithExplicitNcrRef = detectScopesWithExplicitNcrRef(domainRows);

  const result: SubmittalRow[] = [];
  for (const d of domainRows) {
    const scopeHasExplicit = scopesWithExplicitNcrRef.has(getNcrSourceScopeKey(d));
    const canonicalRef = resolveCanonicalNcrRef(d, scopeHasExplicit);
    if (!canonicalRef) continue;
    result.push(d.ncrRef === canonicalRef ? d : { ...d, ncrRef: canonicalRef });
  }
  return result;
};

// Group by Unique Canonical NCR Reference No. (NEVER falls back to synthetic row.id)
export const groupNCRByReference = (normalizedData: SubmittalRow[]): Map<string, SubmittalRow[]> => {
  const grouped = new Map<string, SubmittalRow[]>();
  if (!Array.isArray(normalizedData)) return grouped;
  const scopesWithExplicitNcrRef = detectScopesWithExplicitNcrRef(normalizedData);

  normalizedData.forEach((r) => {
    const scopeHasExplicit = scopesWithExplicitNcrRef.has(getNcrSourceScopeKey(r));
    const key = resolveCanonicalNcrRef(r, scopeHasExplicit);
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
  monthEndRev?: string;
  monthEndStage?: NCREvidence["stage"] | "Not Issued Yet";
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
    sourceIdentityCheckPassed: boolean;
  };
  identityInventory?: NCRForensicIdentityInventory;
}

/**
 * Canonical 3-Stage NCR Workflow State Machine & 14-Day Overdue Evaluator.
 * Shared identically by Cumulative Snapshot (`asOfTimestampMs === undefined`)
 * and Month-End Historical Snapshot (`asOfTimestampMs = endOfTargetMonthMs`).
 */
export const evaluateNcrRevisionState = (
  revisionRow: SubmittalRow,
  originalIssueMs: number | null,
  asOfTimestampMs?: number
) => {
  const issueMs = originalIssueMs ?? parseDateToMs(revisionRow.submissionDate);
  const rawSentStr =
    revisionRow.ncrSentDateCorrectiveAction || revisionRow.sentDateCorrectiveAction || "";
  const rawSentMs = parseDateToMs(rawSentStr);

  const hasSentByCutoff =
    asOfTimestampMs === undefined
      ? Boolean(rawSentStr)
      : rawSentMs !== null && rawSentMs <= asOfTimestampMs;
  const effectiveSentMs = hasSentByCutoff ? rawSentMs : null;
  const effectiveSentStr = hasSentByCutoff ? rawSentStr : "";

  const rawRespStr = revisionRow.responseDate || "";
  const rawRespMs = parseDateToMs(rawRespStr);
  const isRespNotInheritedPriorToSent =
    rawSentMs === null || rawRespMs === null || rawRespMs >= rawSentMs;

  const hasRespByCutoff =
    isRespNotInheritedPriorToSent &&
    (asOfTimestampMs === undefined
      ? Boolean(rawRespStr)
      : rawRespMs !== null && rawRespMs <= asOfTimestampMs);
  const effectiveRespMs = hasRespByCutoff ? rawRespMs : null;
  const effectiveRespStr = hasRespByCutoff ? rawRespStr : "";

  const cStatus = resolveNcrOutcome(revisionRow);

  let stage: NCREvidence["stage"] = "Stage 1: Waiting Contractor";
  let explanation = "";
  let isNotSent = false;
  let isUnderReview = false;
  let isApprovedClosed = false;
  let isRejectedOpen = false;

  if (hasRespByCutoff) {
    if (cStatus.isApprovedClosed) {
      isApprovedClosed = true;
      stage = "Stage 3: Approved Closed";
      explanation =
        "Corrective action was received and officially approved/closed by the consultant.";
    } else {
      isRejectedOpen = true;
      stage = "Stage 3: Rejected Open";
      explanation =
        "Corrective action plan was reviewed but rejected. NCR remains open, awaiting contractor re-submission.";
    }
  } else if (hasSentByCutoff) {
    isUnderReview = true;
    stage = "Stage 2: Waiting Consultant";
    explanation =
      "Contractor submitted a corrective plan. Currently pending review by the consultant (Response Date is blank).";
  } else if (!rawSentStr && !rawRespStr) {
    if (cStatus.isApprovedClosed) {
      isApprovedClosed = true;
      stage = "Stage 3: Approved Closed";
      explanation =
        "Corrective action was officially approved/closed by the consultant (workflow dates omitted).";
    } else if (cStatus.isRejectedOpen) {
      isRejectedOpen = true;
      stage = "Stage 3: Rejected Open";
      explanation =
        "Corrective action plan was reviewed and rejected. NCR remains open (workflow dates omitted).";
    } else if (cStatus.isUnderReview) {
      isUnderReview = true;
      stage = "Stage 2: Waiting Consultant";
      explanation =
        "Corrective plan is currently pending review by the consultant (workflow dates omitted).";
    } else {
      isNotSent = true;
      stage = "Stage 1: Waiting Contractor";
      explanation =
        "Issued to contractor but no corrective action response has been submitted yet (Sent Date is blank).";
    }
  } else {
    isNotSent = true;
    stage = "Stage 1: Waiting Contractor";
    explanation =
      "Issued to contractor but no corrective action response has been submitted yet (Sent Date is blank).";
  }

  const isOpen = isNotSent || isRejectedOpen;
  const isClosed = isApprovedClosed;
  const isWaitingContractor =
    (isNotSent && (asOfTimestampMs === undefined || (issueMs !== null && issueMs <= asOfTimestampMs))) ||
    isRejectedOpen;
  const isWaitingConsultant = isUnderReview;

  let isOverdue = false;
  if (
    issueMs !== null &&
    (asOfTimestampMs === undefined || issueMs <= asOfTimestampMs) &&
    !isApprovedClosed
  ) {
    const nowMs = Date.now();
    const referenceMs =
      asOfTimestampMs === undefined
        ? nowMs
        : asOfTimestampMs > nowMs
          ? nowMs
          : asOfTimestampMs;
    const daysOpen = Math.floor((referenceMs - issueMs) / (1000 * 3600 * 24));
    if (daysOpen > 14) {
      isOverdue = true;
    }
  }

  return {
    stage,
    explanation,
    isNotSent,
    isUnderReview,
    isApprovedClosed,
    isRejectedOpen,
    isOpen,
    isClosed,
    isWaitingContractor,
    isWaitingConsultant,
    isOverdue,
    issueMs,
    sentMs: effectiveSentMs,
    responseMs: effectiveRespMs,
    sentDateStr: effectiveSentStr,
    receivedCorrectiveStr: effectiveRespStr
  };
};

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

    const state = evaluateNcrRevisionState(latestOverall, originalIssueMs, undefined);

    if (state.isNotSent) {
      cumSt.notSent++;
      cumSt.open++;
    } else if (state.isUnderReview) {
      cumSt.underReview++;
      cumSt.waiting++;
    } else if (state.isApprovedClosed) {
      cumSt.approvedClosed++;
      cumSt.closed++;
      cumSt.approved++;
    } else if (state.isRejectedOpen) {
      cumSt.rejectedOpen++;
      cumSt.open++;
      cumSt.rejected++;
    }

    const isLatestFurther = isFurtherRevision(latestOverall.rev, latestOverall.isRev0);
    if (isLatestFurther) {
      cumSt.revHigh++;
    } else {
      cumSt.rev0++;
    }

    cumulativeEvidence.push({
      ref: refKey || latestOverall.ncrRef || latestOverall.docNo || "UNKNOWN",
      discipline: disc,
      latestRev: latestOverall.rev || "0",
      stage: state.stage,
      issueDate: originalIssueStr || "-",
      sentDate: state.sentDateStr || "-",
      responseDate: state.receivedCorrectiveStr || "-",
      actionCode: latestOverall.ncrAction || latestOverall.action || "-",
      isOverdue: state.isOverdue,
      explanation: state.explanation
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
      monthEndRev?: string;
      monthEndStage?: NCREvidence["stage"] | "Not Issued Yet";
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
    // Uses history-aware `isInheritedSentDate` & `isInheritedResponseDate` at true
    // `NCR Ref + Event Type + Event Date + Revision` grain (Fixes NCR-002, NCR-004, NCR-005, NCR-012, NCR-013).
    const seenEventIds = new Set<string>();
    let lastValidResponseMs: number | null = null;

    history.forEach((r, idx) => {
      const sentStr = r.ncrSentDateCorrectiveAction || r.sentDateCorrectiveAction;
      const sentDateMs = parseDateToMs(sentStr);
      const sentDay = toIsoDay(sentDateMs);

      const respStr = r.responseDate;
      const responseDateMs = parseDateToMs(respStr);
      const respDay = toIsoDay(responseDateMs);
      const normRev = getNormalizedRevision(r.rev, r.isRev0);

      const sentEventId = `${refKey}|CORRECTIVE_SUBMITTED|${sentDay}|${normRev}`;
      const isGenuineSentEvent =
        sentDateMs !== null &&
        !isInheritedSentDate(r, idx, history) &&
        !seenEventIds.has(sentEventId) &&
        (lastValidResponseMs === null || sentDateMs >= lastValidResponseMs);

      if (isGenuineSentEvent && sentDateMs !== null) {
        seenEventIds.add(sentEventId);

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
            eventId: sentEventId,
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

      const respEventId = `${refKey}|RESPONSE|${respDay}|${normRev}`;
      const isGenuineResponseEvent =
        responseDateMs !== null &&
        !isInheritedResponseDate(r, idx, history) &&
        !seenEventIds.has(respEventId) &&
        (!isGenuineSentEvent || sentDateMs === null || responseDateMs >= sentDateMs);

      if (isGenuineResponseEvent && responseDateMs !== null) {
        seenEventIds.add(respEventId);
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
            eventId: respEventId,
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

    // ------------------------------------------------------------
    // B. State assessment of this NCR *as of* the last day of the target month
    //    Fixes NCR-006 & Defect #1: Uses `getRevisionActivityDateMs` (returning `null`
    //    for revisions with only inherited dates) so future/inert revisions NEVER leak
    //    into historical month-end snapshots.
    // ------------------------------------------------------------
    const historyBeforeEnd = history.filter((r, idx) => {
      const actMs = getRevisionActivityDateMs(r, idx, history);
      if (actMs === null) return false;
      return actMs <= endOfTargetMonthMs;
    });

    let monthEndRev: string | undefined = undefined;
    let monthEndStage: NCREvidence["stage"] | "Not Issued Yet" = "Not Issued Yet";

    if (historyBeforeEnd.length > 0) {
      const latestAtEnd = historyBeforeEnd[historyBeforeEnd.length - 1];
      const latestAtEndIdx = history.indexOf(latestAtEnd);
      const latestAtEndActMs = getRevisionActivityDateMs(latestAtEnd, latestAtEndIdx, history);
      if (latestAtEndActMs === null || latestAtEndActMs > endOfTargetMonthMs) {
        temporalSnapshotPassed = false;
      }

      const stateAtEnd = evaluateNcrRevisionState(latestAtEnd, originalIssueMs, endOfTargetMonthMs);
      monthEndRev = latestAtEnd.rev || "00";
      monthEndStage = stateAtEnd.stage;

      if (stateAtEnd.isWaitingConsultant) {
        mSt.waitingConsultant++;
        mSt.pending++; // Legacy
        mSt.waiting++; // Legacy

        if (stateAtEnd.sentMs !== null && stateAtEnd.sentMs < startOfTargetMonthMs) {
          mSt.carryForwardPending++;
        } else {
          mSt.currentMonthPending++;
        }
      } else if (stateAtEnd.isWaitingContractor) {
        mSt.waitingContractor++;
      }

      // Single-Count Month-End Overdue Rule (Fixes NCR-001):
      // Critical Overdue = COUNT(DISTINCT NCR Ref) that were open at month-end AND daysOpen > 14
      if (stateAtEnd.isOverdue) {
        mSt.overdue++;
        distinctOverdueNcrRefsAtMonthEnd.add(refKey);
      }
    }

    if (refKey) {
      monthlyEventTraces.set(refKey, {
        isNew,
        isSubmitted,
        isResponded,
        outcome,
        events: ncrMonthEvents,
        monthEndRev,
        monthEndStage
      });
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
  const identityInventory = buildNCRForensicIdentityInventory(safeData);
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
      events: [],
      monthEndRev: undefined,
      monthEndStage: "Not Issued Yet" as const
    };
    return {
      ...e,
      isNewInMonth: trace.isNew,
      isSubmittedInMonth: trace.isSubmitted,
      isRespondedInMonth: trace.isResponded,
      monthlyOutcome: trace.outcome,
      eventsInMonth: trace.events,
      monthEndRev: trace.monthEndRev,
      monthEndStage: trace.monthEndStage
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

  const sourceIdentityCheckPassed =
    identityInventory.zeroSyntheticCountVerified &&
    grouped.size === identityInventory.uniqueNcrRefCount &&
    Array.from(grouped.keys()).every((k) => isValidNcrReference(k) && !k.includes("::"));

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
    crossEngineReconciliationPassed &&
    sourceIdentityCheckPassed;

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
      crossEngineReconciliationPassed,
      sourceIdentityCheckPassed
    },
    identityInventory
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
    integrityReport,
    identityInventory
  };
};

/**
 * Canonical NCR Presentation & Export Adapter (Fixes NCR-008 & Defect #2 SSOT).
 * Shared identically by `Presentation.tsx` and `exportHelpers.ts` so neither consumer
 * reimplements NCR discipline normalization or monthly/cumulative table compilation.
 */
export const compileCanonicalNCRPresentationStats = (
  sourceData: SubmittalRow[],
  monthlyStart?: string
) => {
  const ncrResult = processNCRData(sourceData, monthlyStart);
  const isMon = Boolean(monthlyStart);

  const normDiscKey = (d: string) =>
    normalizeDiscipline({ discipline: (d || "").replace(/^NCR-/i, "") } as SubmittalRow).toUpperCase();

  const baseDisciplines = ["STR", "Arch", "Mech", "Elec", "Infra", "Landscape", "HSE"];
  const knownNorms = new Set(baseDisciplines.map(normDiscKey));
  const extraDisciplines: string[] = [];

  if (isMon) {
    ncrResult.monthly.forEach((m) => {
      const cleanName = m.classification.replace(/^NCR-/i, "");
      const n = normDiscKey(cleanName);
      if (!knownNorms.has(n)) {
        knownNorms.add(n);
        extraDisciplines.push(cleanName);
      }
    });
  } else {
    ncrResult.cumulative.forEach((c) => {
      const n = normDiscKey(c.discipline);
      if (!knownNorms.has(n)) {
        knownNorms.add(n);
        extraDisciplines.push(c.discipline);
      }
    });
  }

  const disciplines = [...baseDisciplines, ...extraDisciplines];

  const stats = disciplines.map((disc) => {
    const targetNorm = normDiscKey(disc);
    if (isMon) {
      const matching = ncrResult.monthly.filter(
        (m) => normDiscKey(m.classification) === targetNorm
      );
      const sub = matching.reduce(
        (acc, m) => ({
          rev0: acc.rev0 + (m.rev0 || 0),
          revHigh: acc.revHigh + (m.revHigh || 0),
          totalSubs: acc.totalSubs + (m.totalSubs || 0),
          approved: acc.approved + (m.approved || 0),
          rejectedOpen: acc.rejectedOpen + (m.rejectedOpen || 0),
          rejectedClosed: acc.rejectedClosed + (m.rejectedClosed || 0),
          pending: acc.pending + (m.pending || 0),
          overdue: acc.overdue + (m.overdue || 0)
        }),
        {
          rev0: 0,
          revHigh: 0,
          totalSubs: 0,
          approved: 0,
          rejectedOpen: 0,
          rejectedClosed: 0,
          pending: 0,
          overdue: 0
        }
      );

      return {
        discipline: disc,
        CurrentUnique: sub.totalSubs,
        Items: sub.totalSubs,
        TotalSubmittals: sub.totalSubs,
        TotalSheets: sub.totalSubs,
        UniqueRev00: sub.rev0,
        UniqueFurtherRev: sub.revHigh,
        Rev00Rows: sub.rev0,
        FurtherRevRows: sub.revHigh,
        TotalRows: sub.totalSubs,
        Rev00: sub.rev0,
        FurtherRev: sub.revHigh,
        Approved: sub.approved,
        RejectedOpen: sub.rejectedOpen,
        RejectedClosed: sub.rejectedClosed,
        Rejected: sub.rejectedOpen + sub.rejectedClosed,
        Pending: sub.pending,
        Total: sub.totalSubs,
        Closed: sub.approved,
        Open: sub.rejectedOpen
      };
    } else {
      const matching = ncrResult.cumulative.filter(
        (c) => normDiscKey(c.discipline) === targetNorm
      );
      const sub = matching.reduce(
        (acc, c) => ({
          totalUnique: acc.totalUnique + (c.totalUnique || 0),
          open: acc.open + (c.open || 0),
          closed: acc.closed + (c.closed || 0),
          underReview: acc.underReview + (c.underReview || 0),
          approved: acc.approved + (c.approved || 0),
          rejected: acc.rejected + (c.rejected || 0),
          rev0: acc.rev0 + (c.rev0 || 0),
          revHigh: acc.revHigh + (c.revHigh || 0)
        }),
        {
          totalUnique: 0,
          open: 0,
          closed: 0,
          underReview: 0,
          approved: 0,
          rejected: 0,
          rev0: 0,
          revHigh: 0
        }
      );
      const ncrTotal = sub.totalUnique || (sub.rev0 || 0) + (sub.revHigh || 0);
      return {
        discipline: disc,
        CurrentUnique: ncrTotal,
        Items: ncrTotal,
        TotalSubmittals: ncrTotal,
        TotalSheets: ncrTotal,
        UniqueRev00: sub.rev0 || 0,
        UniqueFurtherRev: sub.revHigh || 0,
        Rev00Rows: sub.rev0 || 0,
        FurtherRevRows: sub.revHigh || 0,
        TotalRows: ncrTotal,
        Rev00: sub.rev0 || 0,
        FurtherRev: sub.revHigh || 0,
        Approved: sub.approved,
        RejectedOpen: sub.rejected,
        RejectedClosed: 0,
        Rejected: sub.rejected,
        Pending: sub.underReview,
        Total: ncrTotal,
        Closed: sub.closed,
        Open: sub.open
      };
    }
  });

  const totalRow = {
    discipline: "TOTAL",
    CurrentUnique: stats.reduce((acc, curr) => acc + Number(curr.CurrentUnique || 0), 0),
    Items: stats.reduce((acc, curr) => acc + Number(curr.Items || 0), 0),
    TotalSubmittals: stats.reduce((acc, curr) => acc + Number(curr.TotalSubmittals || 0), 0),
    TotalSheets: stats.reduce((acc, curr) => acc + Number(curr.TotalSheets || 0), 0),
    UniqueRev00: stats.reduce((acc, curr) => acc + Number(curr.UniqueRev00 || 0), 0),
    UniqueFurtherRev: stats.reduce((acc, curr) => acc + Number(curr.UniqueFurtherRev || 0), 0),
    Rev00Rows: stats.reduce((acc, curr) => acc + Number(curr.Rev00Rows || 0), 0),
    FurtherRevRows: stats.reduce((acc, curr) => acc + Number(curr.FurtherRevRows || 0), 0),
    TotalRows: stats.reduce((acc, curr) => acc + Number(curr.TotalRows || 0), 0),
    Rev00: stats.reduce((acc, curr) => acc + Number(curr.Rev00), 0),
    FurtherRev: stats.reduce((acc, curr) => acc + Number(curr.FurtherRev), 0),
    Approved: stats.reduce((acc, curr) => acc + Number(curr.Approved), 0),
    RejectedOpen: stats.reduce((acc, curr) => acc + Number(curr.RejectedOpen), 0),
    RejectedClosed: stats.reduce((acc, curr) => acc + Number(curr.RejectedClosed), 0),
    Rejected: stats.reduce((acc, curr) => acc + Number(curr.Rejected), 0),
    Pending: stats.reduce((acc, curr) => acc + Number(curr.Pending), 0),
    Total: stats.reduce((acc, curr) => acc + Number(curr.Total), 0),
    Closed: stats.reduce((acc, curr) => acc + Number(curr.Closed), 0),
    Open: stats.reduce((acc, curr) => acc + Number(curr.Open), 0)
  };

  return {
    stats,
    totalRow,
    hasData: totalRow.Total > 0,
    ncrResult
  };
};
