# BASELINE REVISION RECORD: BRR-2026-09-27-01

- **Record Identifier**: `BRR-2026-09-27-01`
- **Effective Date**: 2026-09-27
- **Authority / Sign-off**: Engineering Governance & Architecture Direction
- **Subject**: Formal Approval & Freezing of Submission-Level Grain Identity & KPI Extensions
- **Associated Commit**: `6a40ef8b1a1b4b128e5741d416633d37062037c6`

---

## 1. Executive Summary & Purpose
This Baseline Revision Record formally certifies the architectural expansion of the StructuSight Mathematical SSOT from a Dual-Dimension Model (Workload Rows vs. Physical Drawings) to a **Triple-Grain Orthogonal Domain Model**:
1. **Workload / Event Grain**: Physical input rows (`totalSubmittedSheets`, `totalRows`).
2. **Submission Contract Grain**: Contractual submittal packages (`totalUniqueSubmittals`, `totalSubmittalsRev0`, `totalSubmittalsFurtherRev`).
3. **Physical Deliverable Grain**: Unique engineering drawings and physical deliverable entities (`totalUniqueDrawings`, `totalEligible`).

This addition provides exact transparency for consulting PMO reviews where a single Submittal Package may encapsulate multiple physical engineering drawing sheets, without polluting drawing-level denominators or corrupting contract approval rates.

---

## 2. Invariant & Mathematical Integrity Proofs
Prior to freezing the new baseline, the following non-negotiable mathematical guarantees have been proven empirically:

1. **Approval Rate Invariance**:
   - Denominator remains strictly bounded to deliverable entities: `totalEligible = totalUniqueDrawings`.
   - Numerator remains strictly bounded to current approved deliverables: `approvedCurrent`.
   - Formula: `(approvedCurrent / totalEligible) * 100`.
   - Mathematical Variance across Golden Regression Benchmark: **0.000% (Zero Variance)**.

2. **Overdue Backlog Invariance**:
   - Overdue calculation remains strictly governed by: `overdueFinal <= activeCurrentItems`.
   - Active population invariant: `activeCurrentItems = pendingCurrent + rejectedOpenCurrent`.
   - Full 7-layer crosswalk parity is verified and identical across KPI Cards, Register Summary, Active Backlog Intelligence, Audit Matrix, Drilldown Items, Presentation Appendices, and PPTX Export.

3. **Golden Dataset Parity**:
   - Execution against `GOLDEN_REGRESSION_BASELINE.json` (770 records) yields **20 / 20 Tests Passed** with 100.0% zero-variance compliance.

4. **Additive Non-Destructive Design**:
   - `totalUniqueSubmittals` **adds** the contractual package dimension; it does **not** replace or alter `totalUniqueDrawings`.

---

## 3. Canonical Frozen Hashes (SHA-256)

### A. Updated Artifacts Under This Revision:
| File Path | Previous Frozen Hash | New Canonical Frozen Hash (SHA-256) |
|:---|:---|:---|
| `src/utils/calculations.ts` | `f3650a20789bf28e680eedfdb070a6b43a75e677705a85e2faf7a0605cbfbc03` | `26a859f736ac872c12f9a8af4f298512a8258236671e409992d998278a54c287` |
| `src/analytics/calculationFoundation.ts` | `9e6bf9034395b754836ee1ce5d0e5da13b36d8cbdba2bedede55aa7270f20203` | `ddc2e312bd2e44081cf251ccf60e79334b7ef50a372ea10699c082f04248bd6e` |

### B. Unchanged Immutable Artifacts (Verified 100% Unmodified):
| File Path | Canonical Frozen Hash (SHA-256) | Status |
|:---|:---|:---|
| `src/analytics/sequenceAuditEngine.ts` | `c824c5d5d0495c979a8be22ad07da4eebadc4280d47d61c3ddc2d87940beb1f4` | UNCHANGED |
| `src/analytics/revisionResolver.ts` | `dfac27649fa845bb2f48c983cdcbbe2f7cb436743bb6953604891005365c27f8` | UNCHANGED |
| `src/test-datasets/GOLDEN_REGRESSION_BASELINE.json` | `cf28ee271e70d502e826f7da120b1a4a0aa583c7d37af23892bc9b2be9c72ade` | UNCHANGED |
| `firestore.rules` | `a23aa401964b257f7b044ea42e56e5bd88f123d19847615ab0908b3eca62257e` | UNCHANGED |

---

## 4. Governance Authorization
This record represents the authoritative baseline for all subsequent CI runs, security audits, and production deployments.
No further modification to these hashes is permitted without an explicit subsequent Baseline Revision Record.
