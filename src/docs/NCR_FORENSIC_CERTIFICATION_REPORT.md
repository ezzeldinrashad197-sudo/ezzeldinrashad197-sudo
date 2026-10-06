# STRUCTUSIGHT — FINAL NCR FORENSIC CERTIFICATION REPORT

- **Audit & Certification Type:** Full Forensic / Logic / SSOT / Business Accuracy / Baseline Certification
- **Certified Commit (Final Baseline Lock):** `2cd7cfeea798449793243701e5f27fff1090474c` (`refactor(ncr): implement canonical NCR presentation engine`)
- **Pre-Remediation Audited Base Commit:** `46bd155fa438ad54df8de9d96f8cbe8696113df8` (3 commits prior to Certified HEAD)
- **Baseline Record:** `BRR-2026-09-27-01` (Amended by `BRR-2026-10-06-NCR-SSOT` — Locked to `2cd7cfeea798449793243701e5f27fff1090474c`)
- **Final Verdict:** 🟢 **FINAL NCR FORENSIC CERTIFICATION — CERTIFIED & CLOSED**

---

## 1. Canonical NCR Calculation Entry Point (SSOT)

The **single authoritative calculation module (SSOT)** for all Non-Conformance Report (NCR) analytics, state evaluation, event deduplication, temporal snapshots, and discipline classification is:

- **Primary Module:** `src/analytics/ncr/ncrEngine.ts`
- **Primary Orchestrator Entry Point:** `processNCRData(safeData: SubmittalRow[], monthlyStart: string | undefined)`
- **Canonical Sub-Engines within `ncrEngine.ts`:**
  1. `normalizeNCRData(safeData)` — Canonical NCR population filter (`registerIdentity === 'NCR'`, rejecting non-NCR canonical registers).
  2. `groupNCRByReference(normalizedData)` & `normalizeNcrRevisionHistory(rows)` — Unique entity grouping and deterministic revision sorting/deduplication.
  3. `evaluateNcrRevisionState(revisionRow, originalIssueMs, asOfTimestampMs)` — Unified 3-Stage NCR Workflow State Machine & 14-day overdue evaluator shared identically by Cumulative and Month-End snapshots.
  4. `getRevisionActivityDateMs(r, index, sortedHistory)` — Strict temporal revision activity resolver returning `null` when a subsequent revision contains only inherited historical dates.
  5. `calculateCumulativeSnapshot(normalizedData)` — Cumulative unique NCR state engine.
  6. `calculateMonthlyEvents(normalizedData, monthlyStart)` — True event-grain (`NCR Ref + Event Type + Event Date + Revision`) monthly engine + month-end historical snapshot.
  7. `compileCanonicalNCRPresentationStats(sourceData, monthlyStart)` — Shared adapter for Presentation and Export consumers.

---

## 2. Every NCR Consumer → Exact Canonical Function Mapping

| Consumer Module / File | Role in Application | Exact Canonical Function Invoked | SSOT Source |
|:---|:---|:---|:---|
| `src/NCRAnalytics.tsx` | Dedicated NCR Dashboard, Monthly & Cumulative KPI Cards, Detail Tables, Evidence Ledger | `processNCRData(data, monthlyStart)` | `src/analytics/ncr/ncrEngine.ts` |
| `src/Presentation.tsx` | Corporate Management Presentation (`compileStatsForBaseType` when `family === 'NCR'`) | `compileCanonicalNCRPresentationStats(sourceData, monthlyStart)` → `processNCRData(...)` | `src/analytics/ncr/ncrEngine.ts` |
| `src/analytics/exportHelpers.ts` | PPTX / Executive Report Table Compiler (`compileStatsForBaseType` when `bt === 'NCR'`) | `compileCanonicalNCRPresentationStats(sourceData, monthlyStart)` → `processNCRData(...)` | `src/analytics/ncr/ncrEngine.ts` |
| `src/analytics/calculationFoundation.ts` | Canonical Foundation `calculateNCRStats(data, fullDataset)` | `calculateCumulativeSnapshot(data)` → `evaluateNcrRevisionState(...)` | `src/analytics/ncr/ncrEngine.ts` |
| `src/utils/calculations.ts` | Re-exports `calculateNCRStats`; `getClosedOpenByDocType('NCR', s)` | Honors `s.closed` (`approvedClosed`) and `s.open` (`notSent + rejectedOpen`) produced by `ncrEngine.ts` | `src/analytics/ncr/ncrEngine.ts` |
| `src/utils/ncrAnalytics.ts` | Legacy NCR Analytics helper `calculateNCRStats(data, targetMonth)` | `normalizeNCRData`, `groupNCRByReference`, `normalizeNcrRevisionHistory`, `evaluateNcrRevisionState` | `src/analytics/ncr/ncrEngine.ts` |

---

## 3. Proof of Zero Independent NCR Calculation Paths

- **Cumulative & Month-End State Machine:** Both `calculateCumulativeSnapshot()` and `calculateMonthlyEvents()` call `evaluateNcrRevisionState()`. No other file implements a separate NCR 3-stage classifier.
- **Foundation & Legacy Helpers:** `src/analytics/calculationFoundation.ts` (`calculateNCRStats`) delegates directly to `calculateCumulativeSnapshot()` from `src/analytics/ncr/ncrEngine.ts`. `src/utils/ncrAnalytics.ts` delegates filtering, grouping, revision sorting, and state evaluation directly to `src/analytics/ncr/ncrEngine.ts`.
- **Presentation & Export Parity:** Both `src/Presentation.tsx` and `src/analytics/exportHelpers.ts` delegate NCR table compilation to `compileCanonicalNCRPresentationStats()` in `src/analytics/ncr/ncrEngine.ts`.

---

## 4. Forensic Audit Findings Matrix (`NCR-001` → `NCR-013`)

| Finding ID | Forensic Defect Description | Remediation Implemented | Verification Test | Status |
|:---|:---|:---|:---|:---:|
| **NCR-001** | Monthly Critical Overdue double-counted (Event 2 + Month-End Snapshot) | Removed `mSt.overdue++` from Event 2; Critical Overdue is counted strictly once per distinct open NCR > 14 days at month-end | `ER-026` | ✅ **PASS** |
| **NCR-002** | Event counting performed at raw Revision Row grain instead of true Event grain | Implemented `NCREventRecord` with deterministic identity `NCR Ref\|EventType\|EventDate\|NormalizedRev` and `seenEventIds` deduplication | `ER-027`, `ER-032` | ✅ **PASS** |
| **NCR-003** | `newNcrReceived` inflated when `Rev01`/`Rev02` inherit `submissionDate` | Event 1 (`RECEIVED`) is evaluated at most once per distinct `NCR Ref` using `originalIssueMs` | `ER-027`, `ER-031` | ✅ **PASS** |
| **NCR-004** | `correctiveSubmitted` inflated when subsequent revisions inherit prior `sentDate` | Implemented `isInheritedSentDate(r, idx, history)` distinguishing inherited dates from genuine new or same-day resubmissions | `ER-027`, `ER-031`, `ER-032` | ✅ **PASS** |
| **NCR-005** | `responsesReceived` inflated when subsequent revisions inherit prior `responseDate` | Implemented `isInheritedResponseDate(r, idx, history)` & chronological guard `responseMs >= sentMs` | `ER-027`, `ER-031`, `ER-032` | ✅ **PASS** |
| **NCR-006** | Month-End Snapshot corrupted by future revisions inheriting early `submissionDate` | Filtered `historyBeforeEnd` via `getRevisionActivityDateMs(r, idx, history)` returning `null` for revisions with only inherited dates | `ER-028`, `ER-031` | ✅ **PASS** |
| **NCR-007** | `getLatestRev(rows, upToDate)` selected future revisions due to inherited `submissionDate` | Updated `getLatestRev` to filter eligible revisions strictly by `getRevisionActivityDateMs(r, idx, sortedHistory) <= endOfMonthMs` | `ER-028`, `ER-031` | ✅ **PASS** |
| **NCR-008** | Dual NCR calculation engines (`ncrEngine.ts` vs `calculationFoundation.ts` / `ncrAnalytics.ts`) | Unified `calculateNCRStats` in `calculationFoundation.ts` and `utils/ncrAnalytics.ts` to delegate to `ncrEngine.ts` SSOT | `ER-030`, `ER-032` | ✅ **PASS** |
| **NCR-009** | Integrity Check could return `PASS` despite business-number inflation | Added 7 `forensicChecks` verifying entity uniqueness, event deduplication, temporal snapshot validity, single-count overdue, grain parity, and discipline isolation | `ER-026` → `ER-030` | ✅ **PASS** |
| **NCR-010** | Discipline normalization mapped `SURVEY` / `SURV` / `SUR` into `HSE` | Isolated `SURVEY` / `SURV` / `SUR` → `'SURVEY'` and `STR/SUR` → `'STR/SUR'` before `HSE` in `normalizeDiscipline` and `parser.ts` | `ER-029` | ✅ **PASS** |
| **NCR-011** | `normalizeNCRData` used loose substring matching that could admit non-NCR rows | Prioritized canonical `registerIdentity === 'NCR'` and explicitly rejected rows from `NON_NCR_CANONICAL_REGISTERS` | `ER-030` | ✅ **PASS** |
| **NCR-012** | Detail table (`monthlySubmissions`) could diverge from `correctiveSubmitted` KPI | Populated `monthlySubmissions` exclusively from deduplicated Event 2 (`CORRECTIVE_SUBMITTED`) occurrences and enforced `detailTableGrainParityPassed` | `ER-027` | ✅ **PASS** |
| **NCR-013** | Evidence trace lacked event-level provenance and month-end revision/stage visibility | Added `NCREventRecord[]` (`eventsInMonth`, `monthlyEvents`) and `monthEndRev` / `monthEndStage` to `NCREvidence` and UI modal | `ER-027`, `ER-031` | ✅ **PASS** |

---

## 5. Regression Suite `ER-026` → `ER-032` Execution Matrix

| Test ID | Scenario Tested | Expected Business Values | Actual Engine Output | Status |
|:---|:---|:---|:---|:---:|
| **ER-026** | Single-Count Monthly Critical Overdue (`NCR-001`, Issued Jun 1, Sent Jun 20, Open Jun 30) | `criticalDelays = 1`, `overdue = 1`, `overdueSingleCountPassed = true` | `criticalDelays = 1`, `overdue = 1`, `overdueSingleCountPassed = true` | ✅ **PASS** |
| **ER-027** | Inherited Dates across `Rev00` / `Rev01` (inherited) / `Rev02` (`NCR-100`) | `newNcrReceived = 1`, `correctiveSubmitted = 2`, `responsesReceived = 2` (`1 Approved`, `1 Rejected`), `monthlySubmissions.length = 2` | `newNcrReceived = 1`, `correctiveSubmitted = 2`, `responsesReceived = 2` (`1 Approved`, `1 Rejected`), `monthlySubmissions.length = 2` | ✅ **PASS** |
| **ER-028** | Temporal Month-End Snapshot (`NCR-200` `Rev00` Jun 20 vs `Rev01` Jul 10/18 with inherited Jun 03 Issue Date) | June: `waitingConsultant = 1, waitingContractor = 0, latestRev = '00'`; July: `waitingConsultant = 0, approved = 1` | June: `waitingConsultant = 1, waitingContractor = 0, latestRev = '00'`; July: `waitingConsultant = 0, approved = 1` | ✅ **PASS** |
| **ER-029** | Discipline Normalization Isolation (`SURVEY`, `SURV`, `SUR`, `STR/SUR`, `HSE`) | `SURVEY/SURV/SUR → 'SURVEY'`, `STR/SUR → 'STR/SUR'`, `HSE → 'HSE'` | `SURVEY/SURV/SUR → 'SURVEY'`, `STR/SUR → 'STR/SUR'`, `HSE → 'HSE'` | ✅ **PASS** |
| **ER-030** | Single NCR SSOT Equivalence (`processNCRData` vs `calculateNCRStats`) & Non-NCR (`SDW`) Exclusion | `filteredNcr = 4`, `totalUnique = 4`, `notSent = 1`, `underReview = 1`, `rejectedOpen = 1`, `approvedClosed = 1`, `open = 2`, `closed = 1` | Exact match across `processNCRData` and `calculateNCRStats` | ✅ **PASS** |
| **ER-031** | **Mandatory Defect #1 (`NCR-TEMP-001`):** `Rev00` (`Rejected/Open`) vs `Rev01` (`Approved/Closed`, all dates inherited) | `rev01ActivityDate = null`, June 30 Selected Rev = `'00'`, `waitingContractor = 1`, `criticalDelays = 1`, `approved = 0`, `rejected = 1` | `rev01ActivityDate = null`, June 30 Selected Rev = `'00'`, `waitingContractor = 1`, `criticalDelays = 1`, `approved = 0`, `rejected = 1` | ✅ **PASS** |
| **ER-032** | Genuine Same-Day Resubmission Cycle (`Rev00` Rejected Jun 10 → `Rev01` Resent Jun 10, Approved Jun 18) & Cross-Consumer Parity | `correctiveSubmitted = 2`, `responsesReceived = 2`, `Total = 1`, `Closed = 1` across `Presentation`, `exportHelpers`, and `ncrAnalytics` | Exact match across all consumers | ✅ **PASS** |

---

## 6. Modified Files Audit (Git Diff Scope)

Only files strictly required to close `NCR-001` → `NCR-013`, unify the NCR SSOT, and record the certified baseline were modified:

| File Path | Reason for Modification | Non-NCR Logic Affected? |
|:---|:---|:---:|
| `src/analytics/ncr/ncrEngine.ts` | Core NCR SSOT remediation (`NCR-001` → `NCR-013`, `getRevisionActivityDateMs`, `evaluateNcrRevisionState`, `compileCanonicalNCRPresentationStats`) | **No** (NCR-only module) |
| `src/analytics/calculationFoundation.ts` | Delegated `calculateNCRStats()` to `calculateCumulativeSnapshot()` from `ncrEngine.ts` (`NCR-008`) | **No** (Only `calculateNCRStats` modified) |
| `src/utils/calculations.ts` | Updated `getClosedOpenByDocType` for `docType === 'NCR'` to honor Stage 1 (`notSent`) + Stage 3 (`rejectedOpen`) | **No** (Guarded by `if (docType === 'NCR')`) |
| `src/utils/ncrAnalytics.ts` | Delegated legacy NCR analytics helper to `ncrEngine.ts` SSOT functions (`NCR-008`) | **No** (NCR-only module) |
| `src/utils/parser.ts` | Prevented `NCR-SURV` / `NCR-SURVEY` from falling into `NCR-HSE` during parser normalization (`NCR-010`) | **No** (Guarded by `NCR` branch) |
| `src/NCRAnalytics.tsx` | Added Event-Grain Ledger and Month-End Snapshot columns to NCR Evidence Modal (`NCR-013`) | **No** (NCR-only view) |
| `src/Presentation.tsx` | Replaced inline NCR compilation block (`if (family === 'NCR')`) with `compileCanonicalNCRPresentationStats` (`NCR-008`) | **No** (Guarded by `if (family === 'NCR')`) |
| `src/analytics/exportHelpers.ts` | Replaced inline NCR compilation block (`if (bt === 'NCR')`) with `compileCanonicalNCRPresentationStats` (`NCR-008`) | **No** (Guarded by `if (bt === 'NCR')`) |
| `src/analytics/ncr/NCR_SPECIFICATION_v2.md` | Updated NCR specification to v2.1 reflecting true event grain, temporal rules, and `SURVEY ≠ HSE` | **No** (Documentation) |
| `src/analytics/__tests__/canonicalCalculations.test.ts` | Added deterministic NCR forensic regression tests `ER-026` → `ER-032` | **No** (Additive tests only) |
| `scripts/test-authentication-regression.ts` | Updated expected SHA-256 hashes for `calculations.ts` and `calculationFoundation.ts` per `BRR-2026-10-06-NCR-SSOT` | **No** (Hash baseline sync) |
| `src/docs/BASELINE_REVISION_RECORD_BRR-2026-09-27-01.md` | Recorded amended SHA-256 baseline hashes and audited commit `46bd155fa438ad54df8de9d96f8cbe8696113df8` | **No** (Governance documentation) |

---

## 7. Certified SHA-256 Baseline Hashes

| Artifact Path | Previous Frozen SHA-256 | New Certified SHA-256 (`BRR-2026-10-06-NCR-SSOT`) | Status |
|:---|:---|:---|:---:|
| `src/utils/calculations.ts` | `26a859f736ac872c12f9a8af4f298512a8258236671e409992d998278a54c287` | `ac4004e1c58e11b874e169e317bf960709e2708b365690b2810f0ac8f0f7d468` | **UPDATED (NCR SSOT)** |
| `src/analytics/calculationFoundation.ts` | `ddc2e312bd2e44081cf251ccf60e79334b7ef50a372ea10699c082f04248bd6e` | `c75a63f4cc664dbad6d5988f4b717bf4af33c7489317dfc1731795887c81546b` | **UPDATED (NCR SSOT)** |
| `src/analytics/ncr/ncrEngine.ts` | *(Pre-Remediation)* | `2f980f7a0806bb9cc577d5cc2d05186ad0f0c2a7400ca8944dd46ab540db9c37` | **FROZEN (NCR SSOT)** |
| `src/utils/ncrAnalytics.ts` | *(Pre-Remediation)* | `1e4df1180c10d49cd4ab8bbccb8b63bd4d2e0d4cf14c90a5e0332fead6aded1c` | **FROZEN (NCR SSOT)** |
| `src/analytics/sequenceAuditEngine.ts` | `c824c5d5d0495c979a8be22ad07da4eebadc4280d47d61c3ddc2d87940beb1f4` | `c824c5d5d0495c979a8be22ad07da4eebadc4280d47d61c3ddc2d87940beb1f4` | **UNCHANGED** |
| `src/analytics/revisionResolver.ts` | `dfac27649fa845bb2f48c983cdcbbe2f7cb436743bb6953604891005365c27f8` | `dfac27649fa845bb2f48c983cdcbbe2f7cb436743bb6953604891005365c27f8` | **UNCHANGED** |
| `src/test-datasets/GOLDEN_REGRESSION_BASELINE.json` | `cf28ee271e70d502e826f7da120b1a4a0aa583c7d37af23892bc9b2be9c72ade` | `cf28ee271e70d502e826f7da120b1a4a0aa583c7d37af23892bc9b2be9c72ade` | **UNCHANGED** |
| `firestore.rules` | `a23aa401964b257f7b044ea42e56e5bd88f123d19847615ab0908b3eca62257e` | `a23aa401964b257f7b044ea42e56e5bd88f123d19847615ab0908b3eca62257e` | **UNCHANGED** |

---

## 8. Final Certification Gate Summary

- **Full `npm test` Suite (Golden Reference + Formula Failsafes + 8 Invariants + 32 Canonical/NCR Tests + Stress Benchmark):** ✅ **PASS (0 Failures)**
- **Authentication & Zero-Trust Regression Suite (`npm run test:auth`):** ✅ **PASS (39 / 39 Passed)**
- **Closed/Open by DocType Direct Suite (`scripts/test-closed-open-by-doctype.ts`):** ✅ **PASS (15 / 15 Passed)**
- **Unrelated Domain Regression Suites (`test:sequence`, `test:overdue`, `test:rfi`, `test:usi`, `test:wir-str`, `test:l99`, `test:lifecycle`):** ✅ **PASS (100% Invariant)**
- **Production Build & TypeScript Verification (`compile_applet` / `npm run build`):** ✅ **PASS**

🟢 **FINAL NCR FORENSIC CERTIFICATION — CERTIFIED & CLOSED**
