import { SubmittalRow, ProjectSettings, SLASettings, DEFAULT_SLA_SETTINGS } from "../types";
import { getStatusCodeCategory } from "./statusResolver";

function parseDateTimestamp(dateStr?: string | number | Date | null): number {
  if (!dateStr) return 0;
  if (dateStr instanceof Date) {
    const t = dateStr.getTime();
    return isNaN(t) ? 0 : t;
  }
  if (typeof dateStr === "number") {
    return isNaN(dateStr) ? 0 : dateStr;
  }
  const s = String(dateStr).trim();
  if (!s) return 0;
  const parsed = new Date(s).getTime();
  if (!isNaN(parsed)) return parsed;
  const parts = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (parts) {
    const d = parseInt(parts[1], 10);
    const m = parseInt(parts[2], 10) - 1;
    const y = parseInt(parts[3], 10);
    const dt = new Date(Date.UTC(y, m, d)).getTime();
    if (!isNaN(dt)) return dt;
  }
  return 0;
}

export { DEFAULT_SLA_SETTINGS };

export type SLACategory = keyof SLASettings;

function matchTokensToCategory(tokens: string[]): SLACategory {
  const combinedTokens = tokens
    .map(t => String(t || "").toUpperCase().trim())
    .filter(Boolean);

  if (combinedTokens.length === 0) {
    return "default";
  }

  const rawCombined = combinedTokens.join(" ");
  const normalized = rawCombined.replace(/[^A-Z0-9]/g, "");

  const hasWIR =
    combinedTokens.some(
      t =>
        t === "WIR" ||
        t.startsWith("WIR-") ||
        t.startsWith("WIR_") ||
        t.endsWith("-WIR") ||
        t.includes("WORK INSPECTION") ||
        t.includes("WORKS INSPECTION")
    ) ||
    normalized.includes("WORKINSPECTION") ||
    normalized.includes("WORKSINSPECTION") ||
    normalized.startsWith("WIR");

  if (hasWIR) {
    return "wir";
  }

  const hasMIR =
    combinedTokens.some(
      t =>
        t === "MIR" ||
        t.startsWith("MIR-") ||
        t.startsWith("MIR_") ||
        t.endsWith("-MIR") ||
        t.includes("MATERIAL INSPECTION")
    ) ||
    normalized.includes("MATERIALINSPECTION") ||
    normalized.startsWith("MIR");

  if (hasMIR) {
    return "mir";
  }

  const hasNCR =
    combinedTokens.some(
      t =>
        t === "NCR" ||
        t.startsWith("NCR-") ||
        t.startsWith("NCR_") ||
        t.includes("NON-CONFORMANCE") ||
        t.includes("NON CONFORMANCE")
    ) ||
    normalized.includes("NONCONFORMANCE") ||
    normalized.startsWith("NCR");

  if (hasNCR) {
    return "ncr";
  }

  const hasSOR =
    combinedTokens.some(
      t =>
        t === "SOR" ||
        t.startsWith("SOR-") ||
        t.startsWith("SOR_") ||
        t.includes("SITE OBSERVATION")
    ) ||
    normalized.includes("SITEOBSERVATION") ||
    normalized.startsWith("SOR");

  if (hasSOR) {
    return "sor";
  }

  const hasLTR =
    combinedTokens.some(
      t =>
        t === "LTR" ||
        t === "LETTER" ||
        t.startsWith("LTR-") ||
        t.startsWith("LET-") ||
        t.includes("LETTER") ||
        t.includes("CORRESPONDENCE")
    ) ||
    normalized.includes("CORRESPONDENCE") ||
    normalized.includes("LETTER") ||
    normalized.startsWith("LTR");

  if (hasLTR) {
    return "letters";
  }

  const hasSDW =
    combinedTokens.some(
      t =>
        t === "SDW" ||
        t === "SHD" ||
        t.startsWith("SDW-") ||
        t.startsWith("SHD-") ||
        t.includes("SHOP DRAWING") ||
        t.includes("SHOP DRAWINGS")
    ) ||
    normalized.includes("SHOPDRAWING") ||
    normalized.startsWith("SDW") ||
    normalized.startsWith("SHD");

  if (hasSDW) {
    return "shopDrawings";
  }

  const hasMAR =
    combinedTokens.some(
      t =>
        t === "MAR" ||
        t === "MAT" ||
        t.startsWith("MAR-") ||
        t.startsWith("MAT-") ||
        t.includes("MATERIAL SUBMITTAL") ||
        t.includes("MATERIAL APPROVAL")
    ) ||
    normalized.includes("MATERIALSUBMITTAL") ||
    normalized.includes("MATERIALAPPROVAL") ||
    normalized.startsWith("MAR");

  if (hasMAR) {
    return "materialSubmittals";
  }

  const hasRFI =
    combinedTokens.some(
      t =>
        t === "RFI" ||
        t.startsWith("RFI-") ||
        t.startsWith("RFI_") ||
        t.includes("REQUEST FOR INFORMATION") ||
        t.includes("REQUESTS FOR INFORMATION") ||
        (t.includes("REQUEST") && t.includes("INFORMATION"))
    ) ||
    normalized.includes("REQUESTFORINFORMATION") ||
    normalized.includes("REQUESTSFORINFORMATION") ||
    normalized.startsWith("RFI");

  if (hasRFI) {
    return "rfi";
  }

  return "default";
}

export function resolveDocumentSLACategory(
  recordOrType?: SubmittalRow | string | null
): SLACategory {
  if (!recordOrType) {
    return "default";
  }

  if (typeof recordOrType === "string") {
    return matchTokensToCategory([recordOrType]);
  }

  if (recordOrType.documentType) {
    const docCat = matchTokensToCategory([recordOrType.documentType]);
    if (docCat !== "default") {
      return docCat;
    }
  }

  const fallbackTokens = [
    recordOrType.logType,
    recordOrType.registerIdentity,
    recordOrType.sourceRegisterIdentity,
    recordOrType.workflowFamily,
  ].filter(Boolean) as string[];

  return matchTokensToCategory(fallbackTokens);
}

export function normalizeSLASettings(
  slaInput?: Partial<SLASettings> | ProjectSettings | null
): SLASettings {
  const result: SLASettings = { ...DEFAULT_SLA_SETTINGS };

  if (!slaInput) {
    return result;
  }

  const rawSla: Partial<SLASettings> =
    "slaDays" in slaInput && slaInput.slaDays
      ? (slaInput as ProjectSettings).slaDays || {}
      : (slaInput as Partial<SLASettings>);

  const keys: (keyof SLASettings)[] = [
    "shopDrawings",
    "materialSubmittals",
    "rfi",
    "ncr",
    "sor",
    "letters",
    "wir",
    "mir",
    "default",
  ];

  for (const key of keys) {
    const val = rawSla[key];
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      result[key] = Math.round(val);
    }
  }

  return result;
}

export function resolveSLAThresholdDays(
  recordOrType?: SubmittalRow | string | null,
  slaSettings?: Partial<SLASettings> | ProjectSettings | null
): number {
  const category = resolveDocumentSLACategory(recordOrType);
  const normalizedSla = normalizeSLASettings(slaSettings);
  return normalizedSla[category] ?? normalizedSla.default ?? DEFAULT_SLA_SETTINGS.default;
}

export interface CalculatedDeadline {
  deadlineDate: string;
  deadlineMs: number;
  isContractual: boolean;
  slaDaysUsed: number;
  slaCategory: SLACategory;
  startDateUsed: string;
}

export function isContractualDeadline(record?: SubmittalRow | null): boolean {
  if (!record) return false;
  return Boolean(
    (record as any).isContractualDueDate ||
    (record as any).dueDateProvenance === "CONTRACTUAL" ||
    (record as any).dueDateType === "CONTRACTUAL"
  );
}

/**
 * Calculates deadline for a record.
 * 
 * Provenance Invariant:
 * An explicit contractual deadline is recognized ONLY if the record has explicit contractual
 * provenance (`isContractualDueDate: true`, `dueDateProvenance: 'CONTRACTUAL'`, or `dueDateType: 'CONTRACTUAL'`).
 * Merely having `dueDate` populated does NOT confer contractual status (`isContractual: false`).
 */
export function calculateRecordDeadline(
  record: SubmittalRow,
  slaSettings?: Partial<SLASettings> | ProjectSettings | null,
  options?: { forceSlaRecalculation?: boolean }
): CalculatedDeadline {
  const category = resolveDocumentSLACategory(record);
  const slaDays = resolveSLAThresholdDays(record, slaSettings);
  const isContractual = isContractualDeadline(record);
  const hasExplicitDueDate = Boolean(record.dueDate && String(record.dueDate).trim());

  // Explicit contractual deadline: always governs unless forceSlaRecalculation is requested
  if (isContractual && !options?.forceSlaRecalculation && hasExplicitDueDate) {
    const explicitDueMs = parseDateTimestamp(record.dueDate);
    if (explicitDueMs > 0) {
      const explicitDateStr = new Date(explicitDueMs).toISOString().split("T")[0];
      return {
        deadlineDate: explicitDateStr,
        deadlineMs: explicitDueMs,
        isContractual: true,
        slaDaysUsed: slaDays,
        slaCategory: category,
        startDateUsed: record.submissionDate || "",
      };
    }
  }

  // If not contractual, but row already has an explicit dueDate and no custom SLA settings are overriding it:
  if (!isContractual && !slaSettings && !options?.forceSlaRecalculation && hasExplicitDueDate) {
    const explicitDueMs = parseDateTimestamp(record.dueDate);
    if (explicitDueMs > 0) {
      const explicitDateStr = new Date(explicitDueMs).toISOString().split("T")[0];
      return {
        deadlineDate: explicitDateStr,
        deadlineMs: explicitDueMs,
        isContractual: false, // Provenance: SLA-derived / non-contractual
        slaDaysUsed: slaDays,
        slaCategory: category,
        startDateUsed: record.submissionDate || "",
      };
    }
  }

  // Calculate deadline from submission/response date + SLA days (calendar-day arithmetic)
  const cat = getStatusCodeCategory(record);
  let startStr = record.submissionDate || "";
  if (!startStr && cat === "REJECTED_OPEN" && record.responseDate) {
    startStr = record.responseDate;
  }

  const startMs = parseDateTimestamp(startStr);
  if (startMs <= 0) {
    return {
      deadlineDate: "",
      deadlineMs: 0,
      isContractual: false,
      slaDaysUsed: slaDays,
      slaCategory: category,
      startDateUsed: "",
    };
  }

  const calculatedDeadlineMs = startMs + slaDays * 86400000;
  const calculatedDeadlineStr = new Date(calculatedDeadlineMs).toISOString().split("T")[0];

  return {
    deadlineDate: calculatedDeadlineStr,
    deadlineMs: calculatedDeadlineMs,
    isContractual: false,
    slaDaysUsed: slaDays,
    slaCategory: category,
    startDateUsed: startStr,
  };
}

/**
 * StructuSight Master Canonical Overdue Engine
 * 
 * SLA Arithmetic Standard:
 * CALENDAR-DAY ARITHMETIC (86,400,000 ms / 24 continuous hours per day).
 * SLA durations are calculated continuously from start date to cutoff/response.
 * Working-day / weekend exclusions are not applied, ensuring deterministic,
 * reproducible mathematical invariants across all project registers and reports.
 * 
 * Contractual vs SLA-Derived Due Date Provenance:
 * 1. Contractual Due Dates: Require explicit provenance (`isContractualDueDate: true`,
 *    `dueDateProvenance: 'CONTRACTUAL'`, or `dueDateType: 'CONTRACTUAL'`).
 *    Contractual due dates always govern and are NOT altered by project SLA configuration changes.
 * 2. SLA-Derived Due Dates: Merely having `dueDate` populated does NOT confer contractual status.
 *    When project SLA settings change or dynamic SLA recalculation is performed,
 *    SLA-derived items are dynamically evaluated against the active configured SLA days.
 */
export function isEntityOverdue(
  latest?: SubmittalRow | null,
  cutoffTimeOrDate?: number | string | Date | null,
  slaSettings?: Partial<SLASettings> | ProjectSettings | null,
  options?: { forceSlaRecalculation?: boolean }
): boolean {
  if (!latest) {
    return false;
  }

  const cat = getStatusCodeCategory(latest);
  if (cat !== "PENDING" && cat !== "REJECTED_OPEN") {
    return false;
  }

  let nowTime: number;
  if (typeof cutoffTimeOrDate === "number") {
    nowTime = cutoffTimeOrDate > 0 ? cutoffTimeOrDate : Date.now();
  } else if (cutoffTimeOrDate instanceof Date) {
    nowTime = !isNaN(cutoffTimeOrDate.getTime()) ? cutoffTimeOrDate.getTime() : Date.now();
  } else if (typeof cutoffTimeOrDate === "string" && cutoffTimeOrDate.trim()) {
    const parsed = parseDateTimestamp(cutoffTimeOrDate);
    nowTime = parsed > 0 ? parsed : Date.now();
  } else {
    nowTime = Date.now();
  }

  const isContractual = isContractualDeadline(latest);
  const hasExplicitDueDate = Boolean(latest.dueDate && String(latest.dueDate).trim());

  // 1. Explicit Contractual Deadline: Governs when present unless forceSlaRecalculation
  if (isContractual && !options?.forceSlaRecalculation && hasExplicitDueDate) {
    const dueTime = parseDateTimestamp(latest.dueDate);
    if (dueTime > 0) {
      const endOfDueDateMs = dueTime + 86400000;
      return nowTime >= endOfDueDateMs;
    }
  }

  // 2. Dynamic SLA configuration passed or forceSlaRecalculation:
  // When SLA settings are explicitly passed (or recalculation forced), non-contractual
  // items dynamically resolve against the configured SLA days from start date.
  if (slaSettings || options?.forceSlaRecalculation) {
    let startStr = latest.submissionDate || "";
    if (!startStr && cat === "REJECTED_OPEN" && latest.responseDate) {
      startStr = latest.responseDate;
    }

    if (startStr) {
      const startMs = parseDateTimestamp(startStr);
      if (startMs > 0) {
        if (nowTime < startMs) {
          return false;
        }
        const slaDays = resolveSLAThresholdDays(latest, slaSettings);
        const diffDays = (nowTime - startMs) / 86400000;
        return diffDays > slaDays;
      }
    }
  }

  // 3. Fallback to existing dueDate for non-contractual rows if no custom SLA settings passed
  if (hasExplicitDueDate) {
    const dueTime = parseDateTimestamp(latest.dueDate);
    if (dueTime > 0) {
      const endOfDueDateMs = dueTime + 86400000;
      return nowTime >= endOfDueDateMs;
    }
  }

  // 4. Default SLA calculation from start date
  let startStr = latest.submissionDate || "";
  if (!startStr && cat === "REJECTED_OPEN" && latest.responseDate) {
    startStr = latest.responseDate;
  }

  if (!startStr) {
    return false;
  }

  const startMs = parseDateTimestamp(startStr);
  if (startMs <= 0 || nowTime < startMs) {
    return false;
  }

  const slaDays = resolveSLAThresholdDays(latest, slaSettings);
  const diffDays = (nowTime - startMs) / 86400000;

  return diffDays > slaDays;
}
