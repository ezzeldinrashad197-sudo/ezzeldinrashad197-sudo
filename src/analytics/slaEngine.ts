import { SubmittalRow, ProjectSettings, SLASettings, DEFAULT_SLA_SETTINGS } from "../types";
import { parseDateTimestamp, getStatusCodeCategory } from "./calculationFoundation";

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

export function calculateRecordDeadline(
  record: SubmittalRow,
  slaSettings?: Partial<SLASettings> | ProjectSettings | null,
  options?: { forceSlaRecalculation?: boolean }
): CalculatedDeadline {
  const category = resolveDocumentSLACategory(record);
  const slaDays = resolveSLAThresholdDays(record, slaSettings);

  const hasContractualFlag = Boolean((record as any).isContractualDueDate);
  const hasExplicitDueDate = Boolean(record.dueDate && String(record.dueDate).trim());

  if (!options?.forceSlaRecalculation && (hasContractualFlag || hasExplicitDueDate)) {
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

  if (!options?.forceSlaRecalculation && latest.dueDate && String(latest.dueDate).trim()) {
    const dueTime = parseDateTimestamp(latest.dueDate);
    if (dueTime > 0) {
      // Date-boundary rule: an item due on YYYY-MM-DD is exactly at its deadline during that day.
      // It becomes overdue only after the deadline day has fully elapsed (nowTime >= dueTime + 86400000).
      const endOfDueDateMs = dueTime + 86400000;
      return nowTime >= endOfDueDateMs;
    }
  }

  let startStr = latest.submissionDate || "";
  if (!startStr && cat === "REJECTED_OPEN" && latest.responseDate) {
    startStr = latest.responseDate;
  }

  if (!startStr) {
    return false;
  }

  const startMs = parseDateTimestamp(startStr);
  if (startMs <= 0) {
    return false;
  }

  if (nowTime < startMs) {
    return false;
  }

  const slaDays = resolveSLAThresholdDays(latest, slaSettings);
  const diffDays = (nowTime - startMs) / 86400000;

  return diffDays > slaDays;
}
