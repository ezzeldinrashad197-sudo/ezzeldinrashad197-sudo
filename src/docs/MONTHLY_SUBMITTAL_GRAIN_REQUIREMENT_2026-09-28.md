# Architectural Specification: Monthly Submittal & Grain Requirement (2026-09-28)

## 1. Executive Summary & Domain Grain Architecture

This document establishes the canonical governance standard for reporting submittal metrics across the system, specifically differentiating between **Submission Grain (Package Event)** and **Row/Sheet Grain (Physical Deliverable/Workload)**.

### The 5 Cardinal Reporting Metrics:

1. **Unique Rev.00 Submittals**
   - Distinct submission packages in their baseline revision (Rev 00).
   - Identity: `Register + Canonical Discipline + SUB Ref`.
   - Invariant: A submission package containing multiple physical drawings or line items is counted exactly **once** (`1`), regardless of row count.

2. **Unique Further Revision Submittals**
   - Distinct submission packages in any successor revision (`Rev > 00`, e.g. Rev 01, 02, etc.).
   - Identity: `Register + Canonical Discipline + SUB Ref`.
   - Invariant: Counted exactly **once** per unique package identifier.

3. **Rev.00 Rows**
   - The exact count of physical rows/sheets registered under Rev 00.
   - Measures actual document control ingestion and drafting workload.

4. **Further Revision Rows**
   - The exact count of physical rows/sheets registered under revisions greater than Rev 00.
   - Measures resubmission drafting, checking, and review workload.

5. **Total Rows**
   - The grand total of all physical rows ingested (`Rev.00 Rows + Further Revision Rows + unclassified/other`).

### Canonical Example:
If `SUB-001` (Rev.00) is submitted with 3 drawings across 3 separate rows in the Shop Drawing register (`SDW-STR`):
- `Unique Rev.00 Submittals` = **1**
- `Unique Further Revision Submittals` = **0**
- `Rev.00 Rows` = **3**
- `Further Revision Rows` = **0**
- `Total Rows` = **3**

---

## 2. Orthogonal Separation by Register and Discipline

### Non-Merge Governance Rule:
Under no circumstances may distinct registers (e.g. `DOC`, `MAR`, `SDW`, `WIR`, `MIR`, `RFI`, `NCR`, `SOR`) or distinct disciplines (e.g. `STR`, `ARCH`, `ELEC`, `MECH`, `INFRA`, `LAND`) be merged into a single conflated count.

- Register identity is preserved strictly at the parent level (`registerIdentity`).
- Discipline identity is resolved and retained as an intrinsic attribute (`STR`, `ARCH`, `MECH`, etc.).
- Multi-row submittals sharing the same SUB Ref within the same Register and Discipline do NOT artificially inflate the Unique Submittal count.
