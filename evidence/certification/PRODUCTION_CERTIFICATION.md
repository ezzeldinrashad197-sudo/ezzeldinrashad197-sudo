# Engineering Verification Record — StructuSight Analytics
**Document Reference:** VERIFY-2026-10-12-03
**Verified Commit:** 57bfa527406d8537babaee4812f11ea411e4fb8b (Post-NCR Canonical Semantics & Cross-Consumer Parity Audit)
**Verification Date:** October 12, 2026
**Supersedes:** VERIFY-2026-08-27-02 — updated with full NCR canonical status partition (103 Open / 1 Under Review / 335 Closed / 104 `totalActive` across 439 unique NCRs / 483 valid rows / 484 physical rows), source-identity forensic checks, and PDF/PPTX export artifact inspection.

---

## 1. Status: Verified for the Specific Items Below Only

This document records the exact commands executed and verified outputs for the StructuSight Final Production Acceptance Audit.

## 2. What Was Verified, and How

Every item below was confirmed by running the referenced command and inspecting its actual output:

| Item | Command | Result |
|---|---|---|
| TypeScript compiles cleanly | `npm run lint` (`tsc --noEmit`) | 0 errors |
| Golden dataset & Canonical ER-001..ER-036 mathematical regression | `npx tsx scripts/run-tests.ts` | CERTIFICATION APPROVED — 0.000% delta variance (all 36 ER suites including ER-033, ER-034, ER-035, ER-036 passed) |
| Repository-wide architecture / SSOT audit | `npx tsx scripts/architecture-audit.ts` | 0 violations, 132 files scanned |
| NCR Source-Identity Forensic Acceptance Suite | `npx tsx scripts/test-ncr-source-identity-forensic.ts` | 5/5 forensic checks passed (`zeroSyntheticCountVerified = true`, blank continuation rows isolated) |
| NCR PPTX & PDF Export Artifact Generation & XML/Stream Inspection | `npx tsx scripts/test-pptx-audit.ts` | Generated & verified `evidence/certification/StructuSight-NCR-Verification.pptx` (984,805 bytes) and `StructuSight-NCR-Verification.pdf` (29,877 bytes, 2 pages) with 100% numerical & 8-column header parity |
| E2E integration pipeline | `npx tsx scripts/run-integration-tests.ts` | 8/8 steps passed |
| Production build (client + server) | `npm run build` | Succeeded |
| Canonical NCR Status Partition & Cross-Consumer Parity (`ER-036`) | `processNCRData`, `calculateNCRStats`, `calculateLegacyAnalyticsNCRStats`, `calculateExecutiveDashboardData`, `buildPresentationViewModel` | Reconciled 484 physical rows → 483 valid rows (1 blank-ref placeholder excluded) → 439 unique NCRs: Stage 1 Not Sent = 91, Stage 2 Under Review = 1, Stage 3 Rejected Open = 12, Stage 3 Closed Approved = 335; `Currently Open = 103`, `Under Review = 1`, `Currently Closed = 335`, `totalActive = 104` |
| Authoritative Sheet-to-Discipline Mapping (`ER-034`, `ER-035`, `ER-036`) | `resolveNCRDisciplineWithEvidence` in `src/analytics/ncr/ncrEngine.ts` | Pure discipline sheets (`STR`, `ARCH`, `MECH`, `ELEC`, `INFR`, `LAND`, `HSE`) preserve distinct `Mech` and `Elec` disciplines unless explicitly mapped to `MEP` on a mixed sheet |

## 3. Explicitly NOT Verified by This Document

Unchanged from VERIFY-2026-08-27-01 — still not reconfirmed:

- QS Workflow Isolation, Revision Parity (ABD/SDW), Cross-format numerical parity, Functional Acceptance Test claims, Filter engine audit, ABD monthly report trace audit (see `evidence/audits/` for the specific files).

## 4. Known Open Items (Not Fixed)

### Dependency vulnerabilities (`npm audit`)
Re-checked against this commit: still **12 vulnerabilities (9 moderate, 3 high)** — unchanged from the prior check, no new regressions introduced. Same four packages, same reasoning against blind-fixing:

| Package | Current | npm audit's suggested fix | Why not applied |
|---|---|---|---|
| `firebase-admin` | 14.3.0 | 10.3.0 | 4 major versions back; would likely break server-side auth/Firestore calls |
| `pptxgenjs` | 4.0.1 | 1.1.5 | 3 major versions back; would likely break PowerPoint export entirely |
| `drizzle-kit` | 0.31.10 | 0.18.1 | Major downgrade; risks breaking DB tooling compatibility |
| `xlsx` | 0.18.5 | none available | Latest version published to the public npm registry; the actual fix is only distributed via SheetJS's own site, not npm |

**Do not run `npm audit fix --force`.**

## 5. Reissuing This Document

Do not add PASS claims without re-running the corresponding command yourself and pasting its real output into this file. Bump the Document Reference number and note what changed, same as this revision did against VERIFY-2026-08-27-01.
