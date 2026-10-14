# PROPOSED Baseline Revision Record — BRR-2026-10-12
**Status:** PROPOSED — PENDING FORMAL GOVERNANCE AUTHORIZATION GATE  
**Target Release:** StructuSight 3.0.0 (NCR Canonical Semantics & Cross-Consumer Parity)  
**Proposed Date:** October 12, 2026  
**Preceding Active Frozen Baseline:** `BRR-2026-09-27-01` / `BRR-2026-10-07-NCR-SOURCE-IDENTITY` (Certified Commit Lineage: `6a40ef8` -> `46bd155` -> `2cd7cfeea798449793243701e5f27fff1090474c`)  

---

## 1. Executive Rationale for Proposed Baseline Amendment

This proposed Baseline Revision Record documents the mathematical and architectural updates introduced to resolve the NCR canonical status partition and cross-consumer parity requirements:

1. **Canonical 3-Way Status Semantics on Unique Entities (`totalUnique = 439`):**
   - **Currently Open (`open = 103`):** Defined strictly as Stage 1 Not Sent (`notSent = 91`) + Stage 3 Rejected Open (`rejectedOpen = 12`).
   - **Under Review (`underReview = 1`):** Defined strictly as Stage 2 Waiting Consultant (`underReview = 1`).
   - **Currently Closed (`closed = 335`):** Defined strictly as Stage 3 Approved Closed (`approvedClosed = 335`).
   - **Mathematical Partition Invariant:** `open (103) + underReview (1) + closed (335) = totalUnique (439)`.
   - **Total Active Invariant:** `totalActive = 104` is retained as the combined non-closed population (`open + underReview` = 103 + 1 = 104) and is strictly never presented as `Currently Open`.

2. **Population Reconciliation & Provenance Boundary:**
   - **Calculation Logic Status (VERIFIED):** The 484 physical rows / 483 valid rows / 439 unique NCR partition (`91 Stage 1 + 1 Stage 2 + 12 Stage 3 Rej + 335 Stage 3 Closed`) is verified algorithmically in `ER-036` via a deterministic in-memory regression suite.
   - **Physical Disk Source Status (PENDING ARCHIVE RESTORATION):** The file currently residing at `src/test-datasets/16- Non-Conformance Report (NCR).xlsx` is a 3-row fixture left over from prior testing (`c2b15eaec196...`) and is **NOT** the authentic 484-row workbook. The 484-row physical population **cannot and must not be claimed as verified from the current disk file**. Full population certification remains explicitly gated until the authentic workbook is restored from the PMC/client archive and verified against its true SHA-256.

3. **Discipline Integrity:**
   - Pure discipline sheets (`STR`, `ARCH`, `MECH`, `ELEC`, `INFR`, `LAND`, `HSE`) preserve distinct discipline allocations without unintentional merging. `MECH` (55) and `ELEC` (40) remain distinct disciplines unless explicitly part of a combined `MEP` register sheet.

---

## 2. Proposed Artifact Hash Specifications

| Artifact Path | Layer / Role | Current Frozen Expected Hash (`BRR-2026-10-07`) | Proposed New Expected Hash (`BRR-2026-10-12`) | Nature of Modification |
|:---|:---|:---|:---|:---|
| `src/utils/calculations.ts` | Layer 2 Production Analytics Engine | `ac4004e1c58e11b874e169e317bf960709e2708b365690b2810f0ac8f0f7d468` | `3fc729129957ca1c50654f1f39c4c60d47f96cb11167fc9b48df72b2312ee4ea` | Derived field propagation in `getClosedOpenByDocType('NCR')` |
| `src/analytics/calculationFoundation.ts` | Layer 1 Universal Source Identity & Taxonic Lock | `941c00a35561b1e350e53740312b5b2ebaf6033b68d6fa3c365f6d501f797e64` | `4da695157aca2414cf24c8af4ec9667917a81d4d71c0f84df46bdd7141b46e48` | `calculateNCRStats` exposes `totalActive = 104`, `open = 103`, `underReview = 1`, `closed = 335` |
| `src/analytics/ncr/ncrEngine.ts` | Layer 1 Canonical NCR Event, State, Source-Identity SSOT | `008378a886fbeca72deda6d289b26d87b88a9541c63075adef39a70c25381e2b` | `b3c4dd991ef81a5fa1609bee3626a67a8990e2e01f4f339ff71f5328e967d6d4` | Enforces `open = 103` (`notSent + rejectedOpen`), `underReview = 1`, `totalActive = 104` |
| `src/utils/ncrAnalytics.ts` | Layer 2 NCR Analytics Adapter | `1e4df1180c10d49cd4ab8bbccb8b63bd4d2e0d4cf14c90a5e0332fead6aded1c` | `622194e11b05533ca9af0d8ee4b7b43fe91a1f50f2a87946f518a190fc4f24c9` | Exposes `ncrTotalActive = 104`, `ncrOpen = 103`, `ncrUnderReview = 1`, `ncrClosed = 335` |
| `src/analytics/sequenceAuditEngine.ts` | Layer 1 Sequence Discontinuity SSOT | `c824c5d5d0495c979a8be22ad07da4eebadc4280d47d61c3ddc2d87940beb1f4` | `c824c5d5d0495c979a8be22ad07da4eebadc4280d47d61c3ddc2d87940beb1f4` | **UNCHANGED** |
| `src/analytics/revisionResolver.ts` | Layer 1 Revision Hierarchy SSOT | `dfac27649fa845bb2f48c983cdcbbe2f7cb436743bb6953604891005365c27f8` | `dfac27649fa845bb2f48c983cdcbbe2f7cb436743bb6953604891005365c27f8` | **UNCHANGED** |
| `src/utils/parser.ts` | Canonical Excel Ingestion SSOT | `3026c386543635d29e925fb6f97870b85a2f50155912e0e8ea1617946b067239` | `3026c386543635d29e925fb6f97870b85a2f50155912e0e8ea1617946b067239` | **UNCHANGED** |
| `src/test-datasets/GOLDEN_REGRESSION_BASELINE.json` | Empirical Benchmark Golden Standard | `cf28ee271e70d502e826f7da120b1a4a0aa583c7d37af23892bc9b2be9c72ade` | `cf28ee271e70d502e826f7da120b1a4a0aa583c7d37af23892bc9b2be9c72ade` | **UNCHANGED** |
| `firestore.rules` | Hardened Firestore Authorization Rules | `a23aa401964b257f7b044ea42e56e5bd88f123d19847615ab0908b3eca62257e` | `a23aa401964b257f7b044ea42e56e5bd88f123d19847615ab0908b3eca62257e` | **UNCHANGED** |

---

## 3. Governance Gate Status

- **Status:** **PROPOSAL STAGED SEPARATELY.**
- **Active Testing Rule:** In accordance with the Controlled Governance protocol, `scripts/test-authentication-regression.ts` expected hashes **have not been modified** and remain locked to the active frozen baseline until formal sign-off.
