
export interface SLASettings {
  shopDrawings: number;
  materialSubmittals: number;
  rfi: number;
  ncr: number;
  sor: number;
  letters: number;
  wir: number;
  mir: number;
  default: number;
}

export interface ProjectSettings {
  id: string;
  projectName: string;
  projectCode: string;
  clientName: string;
  contractorName: string;
  consultantName: string;
  projectManager: string;
  documentControlManager: string;
  slaDays?: SLASettings;
  logoUrl?: string;
}

export interface SubmittalRow {
  id: string;
  logType: string;         // E.g. raw sheet name
  sourceFile?: string;     // The original filename this row came from
  
  // Normalized Standard Fields
  documentType: string;    // 'MIR', 'WIR', 'RFI', 'SHD', 'MAR', 'DOC', 'SNA'
  trade: string;           // 'Structural', 'Architectural', 'Mechanical', 'Electrical', 'Infrastructure', 'Civil', 'Landscape', 'General'
  tradeShort?: string;     // 'STR', 'ARC', 'MEC', 'ELE', 'INFRA', 'LAND', 'GEN'
  workflowStage: string;   // 'Approved', 'Pending', 'Rejected', 'Returned', 'Waiting Consultant', 'Resubmit'
  isLatestRev: boolean;    // Used to filter duplicates
  isRev0: boolean;
  delayDays: number;
  overdue: boolean;

  docNo: string;
  rev: string;
  sheetNo: string;

  // Explicit Document Identity Components
  // For engineering/shop-drawing registers:
  // Document Identity = Submission Ref + DWG No.
  submissionRef?: string;
  drawingNo?: string;

  discipline: string;
  contractor: string;
  consultant: string;
  submissionDate: string; // YYYY-MM-DD
  dueDate: string;        // YYYY-MM-DD
  responseDate: string;   // YYYY-MM-DD
  status: string;         // Raw code A, B, C...
  code?: string;           // Explicit review outcome code (A, B, C, D, etc.)
  remarks: string;
  area: string;
  tradeSystem: string;

  priority?: 'CRITICAL' | 'NORMAL' | string;

  // NCR/SOR Specific fields
  ncrRef?: string;
  ncrLastRev?: string;
  ncrStatus?: string;
  ncrAction?: string;
  ncrSentDateCorrectiveAction?: string;

  // New fields for SOR & Letters
  sorStatus?: string;
  sorAction?: string;
  sorRef?: string;
  sorSentDateCorrectiveAction?: string;

  subject?: string;
  sentDateCorrectiveAction?: string;
  action?: string;           // e.g. Under Review, Open
  recordStatus?: string;     // e.g. Waiting, Closed, Open
  responseTime?: number;
  reviewTime?: number;
  totalDuration?: number;

  // Letter specific fields
  direction?: 'IN' | 'OUT';
  stakeholder?: 'Archimid' | 'ACE' | 'IMKAN' | string;
  normalizedRef?: string;
  actionRequired?: boolean;
  distributionStatus?: string;
  hyperlink?: string;

  // Mapping Spec Fields (SSOT)
  workflowFamily?: string;
  displayDocType?: string;
  isUnknownWorkflow?: boolean;
  calculationEngine?: string;

  // Composite Identity Fields
  rawSourceIdentity?: string;
  contextDiscipline?: string;
  compositeIdentity?: CompositeIdentity;
}

export type EvidenceLevel = 
  | 'LEVEL_1_FILENAME_COMPOSITE'
  | 'LEVEL_2_WORKSHEET_COMPOSITE'
  | 'LEVEL_3_HEADER_TITLE_BLOCK'
  | 'LEVEL_4_ROW_DATA_CELL'
  | 'LEVEL_5_CONTENT_PATTERN'
  | 'LEVEL_6_PROJECT_DEFAULT'
  | 'LEVEL_7_UNCLASSIFIED_FALLBACK';

export interface CompositeIdentity {
  family: string;
  discipline: string;
  compositeCode: string;
  rawSourceIdentity: string;
  evidenceSource: string;
  evidenceLevel: EvidenceLevel;
  confidence: number;
  lockedBy: string;
  fallbackState: boolean;
  hasConflict: boolean;
  conflictDetails?: string;
}

export interface KPIStats {
  // 1. Workload / Physical Row Metrics (Row / Record Grain)
  totalSubmittedSheets: number; // Total Rows / Sheets submitted
  totalRows?: number;           // Alias for totalSubmittedSheets
  totalSheetsRev0: number;      // Rows with Rev = 0
  totalSheetsFurtherRev: number; // Rows with Rev > 0
  totalDrawingsRev0: number;    // Legacy alias
  totalDrawingsFurtherRev: number; // Legacy alias

  // Row-Level Workload Status Metrics (Grain: Row / Physical Submission Event)
  rowApproved?: number;         // Total rows with Approved Status (Code A, Code B, etc.)
  rowApprovedClosed?: number;   // Total rows with Approved/Closed Status (Approved + Closed Rejections)
  rowRejectedOpen?: number;     // Total rows with Rejected Open Status (Alias for rejectedOpenRows)
  rowRejectedClosed?: number;   // Total rows with Rejected Closed Status (Alias for rejectedClosedRows)
  rowPending?: number;          // Total rows with Pending / No Response / Waiting Status
  totalRejectedRows: number;    // Total rows with Rejected Status (Open or Closed)
  rejectedOpenRows: number;     // Total rows with Rejected Open Status (e.g. Code C Open)
  rejectedClosedRows: number;   // Total rows with Rejected Closed Status (e.g. Code C Closed)
  finalClosedRows?: number;     // Total rows with Final Closed Status (Code D)

  // 2. Current State Metrics (Grain: Unique Entity / Latest Valid Revision)
  totalUniqueDrawings: number;  // Total Unique Document Identities (SUB Ref + DWG No. where applicable)
  totalUniqueItems?: number;    // Alias for totalUniqueDrawings
  currentApproved: number;      // Current Approved Items (Unique grain)
  currentRejectedOpen: number;  // Current Rejected Open Items (Unique grain)
  currentRejectedClosed: number;// Current Rejected Closed Items (Unique grain)
  currentFinalClosed?: number;  // Current Final Closed Items (Unique grain: Code D)
  currentRejected: number;      // Current Rejected Items (Unique grain: Open + Closed)
  currentPending: number;       // Current Pending Items (Unique grain)
  currentOpen: number;          // Current Open Items (Unique grain: Pending + Rejected Open)
  currentClosed: number;        // Current Closed Items (Unique grain: Approved + Rejected Closed + Final Closed)

  // Standard & Backwards Compatible Aliases
  approved: number;             // Approved Current Items (Alias for currentApproved)
  rejectedOpen: number;         // Rejected Open Current Items (Alias for currentRejectedOpen)
  rejectedClosed: number;       // Rejected Closed Current Items (Alias for currentRejectedClosed)
  finalClosed?: number;         // Final Closed Current Items (Alias for currentFinalClosed)
  totalRejected?: number;       // Rejected Open + Rejected Closed (Combined)
  pending: number;              // Pending Current Items (Alias for currentPending)
  unclassified?: number;        // Unclassified Current Items

  // 3. Historical Rejection Events & Resolution Metrics
  rejectionEvents?: number;        // Total rows with Code C/D (Alias for totalRejectedRows)
  rejectionEventsOpen?: number;    // Rows with Status=Open & Code C/D (Alias for rejectedOpenRows)
  rejectionEventsClosed?: number;  // Rows with Status=Closed & Code C/D (Alias for rejectedClosedRows)
  resolvedRejections?: number;     // Unique SUB Ref with past C/D now Approved
  rejectionResolutionRate?: number;// Resolution percentage

  // 4. Overdue & Performance (Derived Attribute on Active Population)
  activeItems?: number;               // Pending + Rejected Open
  activeCurrentItems?: number;        // Pending + Rejected Open (Alias)
  slaEligibleActiveItems?: number;    // Active items with defined SLA
  overdue: number;                    // Current Active items > SLA
  overduePending?: number;            // Overdue items among Pending Review
  overdueRejectedOpen?: number;       // Overdue items among Rejected Open
  overdueRateOnActive?: number;       // (Overdue / Active Current Items) * 100
  avgResponseTime: number;            // Days

  approvalRate: number;
  rejectionOpenRate: number;
  rejectionClosedRate: number;
  delayRate: number;
  
  // 5. Mathematical Reconciliation Verification
  isWorkloadReconciled?: boolean;
  isCurrentStateReconciled?: boolean;
  reconciliationPassed?: boolean;

  // 6. Mandatory Missing-Sequence & Population Integrity Control
  expectedPopulation?: number;       // Expected sequential items count (Max - Min + 1)
  actualRev0Population?: number;     // Actual Rev 00 population found
  missingSequenceCount?: number;     // Expected Population - Actual Rev 00 Population (Delta)
  missingSequenceIds?: string[];     // Sample/All missing formatted document IDs
  sequenceGapsCount?: number;        // Number of sequence gap intervals
  sequenceAuditReconciled?: boolean; // true if missingSequenceCount === 0
}

export type SequenceDiscrepancyType = 
  | 'MISSING_SEQUENCE_RECORD'     // Expected in sequence (Min..Max) but completely missing from Rev 00 / dataset
  | 'DROPPED_DURING_PIPELINE'     // Present in raw source/parsed but dropped in pipeline
  | 'DUPLICATE_RECORD'            // Same DocNo + Rev multiple times
  | 'FURTHER_REV_WITHOUT_REV0'    // Entity appeared first at Rev 01/02 without Rev 00
  | 'MALFORMED_IDENTIFIER'        // Doc number does not follow expected naming pattern
  | 'SEQUENCE_GAP'                // Contiguous range of missing numbers
  | 'EXCLUDED_RULE';              // Filtered by explicit rule

export interface SequenceGap {
  fromNumber: number;
  toNumber: number;
  count: number;
  formattedRange: string;
  sampleMissingIds: string[];
}

export interface RegisterSequenceAudit {
  docType: string;               // e.g. "WIR-SUR", "SDW-STR", etc.
  prefix: string;                // e.g. "WIR-SUR-"
  paddingLength: number;         // e.g. 5
  minSequence: number;           // e.g. 1
  maxSequence: number;            // e.g. 2000
  expectedPopulation: number;    // e.g. 2000 (max - min + 1)
  actualRev0Population: number;  // e.g. 1998
  actualUniquePopulation: number;// e.g. 1998
  totalWorkloadRows: number;     // e.g. 2045
  furtherRevRows: number;        // e.g. 47
  
  missingCount: number;          // e.g. 2
  missingIds: string[];          // ["WIR-SUR-00009", "WIR-SUR-00045"]
  sequenceGaps: SequenceGap[];
  duplicateRecords: { docNo: string; rev: string; count: number; ids: string[] }[];
  furtherRevWithoutRev0: { docNo: string; firstRecordedRev: string; count: number }[];
  malformedIds: string[];
  isSequenceFullyReconciled: boolean; // true if missingCount === 0 && duplicateRecords.length === 0
  deltaExplanation: string;      // Human-readable English summary of the delta
  deltaExplanationAr: string;    // Human-readable Arabic summary of the delta
}

export interface SequenceAuditResult {
  totalExpectedPopulation: number;
  totalActualRev0Population: number;
  totalMissingCount: number;
  totalDuplicatesCount: number;
  totalFurtherRevWithoutRev0: number;
  allMissingIds: { docType: string; docNo: string; seqNumber: number }[];
  registerAudits: Record<string, RegisterSequenceAudit>;
  overallStatus: 'PERFECT_MATCH' | 'GAPS_DETECTED' | 'CRITICAL_DISCREPANCY';
  summaryNarrative: string;
  summaryNarrativeAr: string;
}

export interface ForensicLedgerEntry {
  id: string;
  docNo: string;
  rev: string;
  docType: string;
  sourceLocation: string;
  parsedStatus: string;
  canonicalStatus: string;
  disposition: 'SSOT_ACTIVE' | 'SUPERSEDED_HISTORICAL' | 'DROPPED_PARSER' | 'DUPLICATE_DISCARDED' | 'MISSING_EXPECTED_GAP' | 'FURTHER_REV_ENTRY' | 'EXCLUDED_RULE';
  dispositionReason: string;
  dispositionReasonAr: string;
}
```
