# NCR Calculation Engine Official Specification v2.0
## Single Source of Truth (SSOT) – Event-Driven & Snapshot Architecture

---

### Chapter 1 – Scope (النطاق والهدف)
The Non-Conformance Report (NCR) engine is designed to parse, classify, and audit construction quality compliance data. The engine eliminates general database snapshot bias by bifurcating the analytical model into two completely independent, decoupled calculation pipelines:
1. **Monthly Event-Driven Engine (محرك أحداث الشهر):** A timeline-based transaction analyzer. It does *not* read the current overall status of an NCR, but instead records independent occurrences of workflow events (Received, Submitted, Responded) within a specific reporting month. A single NCR can participate in multiple reporting months depending on when its events took place.
2. **Cumulative Snapshot Engine (المحرك التراكمي):** A state-machine snapshot representing the project's exact status at any point in time. It operates strictly on the **Latest Revision** of each unique NCR.

---

### Chapter 2 – Data Mapping (مخطط وتعيين البيانات)
To prevent guess-work and heuristic failures, the engine maps raw Excel/CSV rows to standardized fields via the centralized Parser:
* **Reference (`ncrRef` or `docNo`):** Unique identifier of the NCR (e.g., `NCR-001`).
* **Revision (`rev`):** Alpha-numeric version (e.g., `0`, `A`, `1`, `B`).
* **Received Date / Issue Date (`submissionDate`):** The date the NCR was issued/received.
* **Sent Date Corrective Action (`sentDateCorrectiveAction` / `ncrSentDateCorrectiveAction`):** The date the contractor submitted the corrective action.
* **Received Date Corrective Action / Response Date (`responseDate`):** The date the consultant responded.
* **Action / Approval Code (`ncrAction` / `action`):** Code indicating approval/rejection (e.g., `Approved`, `Approved with Comments`, `Rejected`, `Revise & Resubmit`).
* **Discipline/Trade (`discipline` / `trade`):** Standardized disciplines (`Arch`, `STR`, `STR/SUR`, `SURVEY`, `Infra`, `HSE`, `Mech`, `Elec`, `Landscape`). `SURVEY` / `SURV` / `SUR` is strictly isolated as `SURVEY` and never mapped to `HSE`.

---

### Chapter 3 – Workflow State Machine (آلة حالة سير العمل)
Every unique NCR lifecycle is modeled as a strictly linear state-machine transition containing three progressive stages:

```
[Stage 1: Waiting Contractor] ──(Sent Corrective Date exists)──> [Stage 2: Waiting Consultant] ──(Response Date exists)──> [Stage 3: Approved/Closed OR Rejected/Open]
```

* **Stage 1: Waiting Contractor (بانتظار المقاول)**
  * *Condition:* Received Date is present AND Sent Date Corrective Action is blank/empty.
  * *Classification:* **Currently Open**
* **Stage 2: Waiting Consultant (بانتظار الاستشاري / قيد المراجعة)**
  * *Condition:* Sent Date Corrective Action is present AND Received Date Corrective Action is blank/empty (or inherited from a prior revision earlier than the current revision's Sent Date).
  * *Classification:* **Currently Under Review**
* **Stage 3: Approved Closed (مغلق معتمد)**
  * *Condition:* Received Date Corrective Action is present ($\ge$ Sent Date) AND (Action is `Approved` OR Status is `Closed`).
  * *Classification:* **Currently Closed**
* **Stage 3: Rejected Open (مرفوض ومفتوح)**
  * *Condition:* Received Date Corrective Action is present ($\ge$ Sent Date) AND (Action is `Rejected` OR Status is NOT closed/approved).
  * *Classification:* **Currently Open (Rejected Cycle)**

---

### Chapter 4 – Monthly Event Engine (محرك أحداث الشهر)
**The Monthly Report is NOT a database snapshot, nor is it a raw row counter.** It tracks genuine, deduplicated workflow events at true Event Grain (`NCR Ref + Event Type + Event Date + Revision`) within the boundaries of the reporting month:
* **Event 1: New NCR Received (مستلمة جديدة):** Recorded **at most once per distinct NCR Reference**, strictly using the Original NCR Issuance (`submissionDate` on the baseline revision). Subsequent revisions (`Rev01`, `Rev02`, ...) carrying an inherited `submissionDate` never inflate `New NCR Received`.
* **Event 2: Corrective Action Submitted (تقديمات الحلول):** Recorded per genuine distinct `(NCR Ref + Sent Date Corrective Action)` within the reporting month, deduplicating any `sentDateCorrectiveAction` inherited from an earlier revision.
* **Event 3: Consultant Response (ردود الاستشاري):** Recorded per genuine distinct `(NCR Ref + Response Date)` within the reporting month, deduplicating any `responseDate` inherited from an earlier revision.
  * Sub-categorized as **Approved** or **Rejected** based on the Action/Status code of the revision that received that response.

---

### Chapter 5 – End of Month Snapshot (لقطة نهاية الشهر الزمنية)
To accurately compute historical metrics (such as carry-forward, backlog, and monthly pending), the engine reconstructs the exact state of the project as it existed on the *last day of the target month*:
1. Compute the true temporal revision activity start date (`getRevisionActivityDateMs`) for each revision by stripping dates inherited from prior revisions (`0 .. idx-1`). This guarantees that future revisions (e.g. a July `Rev01` carrying an inherited June `submissionDate`) never leak into historical month-end snapshots.
2. Filter out all revisions whose true revision activity occurred *after* the last millisecond of the target month, and select the latest eligible revision.
3. Apply the Workflow State Machine to determine if, on that specific date, the NCR was:
   * **Waiting Consultant** (Sent Date $\le$ End of Month AND Response Date is either blank or $>$ End of Month).
   * **Waiting Contractor** (No Sent Date yet, or Rejected on or before End of Month with no subsequent Sent Date).
   * **Critical Overdue (Single-Counted Month-End Snapshot KPI):** Count of distinct NCR references (`COUNT(DISTINCT NCR Ref)`) that were issued on or before End of Month, remained open/unapproved as of End of Month, and had $\text{Days Open} > 14$. Never double-counted with Event 2 submission delays.

---

### Chapter 6 – Cumulative Engine (المحرك التراكمي الموحد)
* **Latest Revision Rule:** The cumulative report operates strictly on the single **Latest Revision** of each unique NCR reference number.
* Past revisions are completely ignored during cumulative aggregations.
* Calculates:
  * **Currently Open:** Sum of `notSent` (Stage 1) + `rejectedOpen` (Stage 3 Rejected).
  * **Currently Under Review:** Sum of `underReview` (Stage 2).
  * **Currently Closed:** Sum of `approvedClosed` (Stage 3 Approved).

---

### Chapter 7 – Cumulative KPI Definitions (مؤشرات التراكمي)
* **Total Unique NCRs** = Count of unique NCR references in the database.
* **Currently Open (المفتوح حالياً)** = `Waiting Contractor` + `Rejected Open`
* **Currently Under Review (قيد المراجعة)** = `Waiting Consultant` (Stage 2)
* **Currently Closed (المغلق حالياً)** = `Approved Closed` (Stage 3 Approved)
* **Critical Overdue (المتجاوز الحرج):** NCRs remaining open for $>14$ days from original issue date to today.

---

### Chapter 8 – Monthly KPI Definitions (المؤشرات الشهرية للأحداث)
* **New NCRs Received:** Count of Event 1 occurrences in target month.
* **Corrective Submitted:** Count of Event 2 occurrences in target month.
* **Responses Received:** Count of Event 3 occurrences in target month.
* **Approved Responses:** Responses within the month that resulted in an Approved status.
* **Waiting Consultant (End of Month):** Count of active submittals awaiting review at month-end.
* **Waiting Contractor (End of Month):** Count of NCRs requiring action/corrective plans at month-end.

---

### Chapter 9 – Mathematical Validation & Integrity (التدقيق الحسابي المتكامل)
To guarantee 100% calculation safety and prevent regressions, the engine executes three strict mathematical identity checks:

$$\text{Identity 1 (Cumulative Partitioning): } \text{Total Unique NCRs} = \text{Currently Open} + \text{Currently Under Review} + \text{Currently Closed}$$

$$\text{Identity 2 (Monthly Response Outcome): } \text{Responses Received} = \text{Approved Responses} + \text{Rejected Responses}$$

$$\text{Identity 3 (Open Integrity): } \text{Currently Open} = \text{Waiting Contractor (Stage 1)} + \text{Rejected Open (Stage 3 Rejected)}$$

If any identity fails, the engine flags an **Integrity Warning** with detailed debugging data to the UI Evidence Console.

---

### Chapter 10 – Evidence Console (لوحة أدلة الاحتساب)
Every single summary card or table row must be auditable. The engine returns a complete log for each NCR explaining exactly:
1. Which revision was chosen as the Latest overall.
2. The exact timeline dates mapped to Event 1, Event 2, and Event 3.
3. The specific mathematical identity path applied.
This enables a user-facing interactive console where clicking any KPI or count displays the exact list of NCRs and dates that generated that number.

---

### Chapter 11 – Event & State Examples (أمثلة معيارية للتتبع)

#### Standard Example: `NCR-001` (Multi-month workflow traversal)
* **Timeline of Events:**
  * **June 3, 2026:** Received Date. (Event 1 occurs)
  * **June 20, 2026:** Sent Corrective. (Event 2 occurs)
  * **July 15, 2026:** Received Response (Approved). (Event 3 occurs)
* **Engine Outputs:**
  * **June 2026 Monthly Report:**
    * New NCR Received = `+1`
    * Corrective Submitted = `+1`
    * Responses Received = `0`
    * State as of June 30: **Waiting Consultant** (Stage 2)
  * **July 2026 Monthly Report:**
    * New NCR Received = `0`
    * Corrective Submitted = `0`
    * Responses Received = `+1` (Approved)
    * State as of July 31: **Closed** (Stage 3 Approved)
  * **Cumulative Report (Latest Snapshot as of Today):**
    * Currently Closed = `1`, Currently Open = `0`, Currently Under Review = `0`

---

### Chapter 12 – Regression Protection (حماية الكود وموثوقيته)
* The Cumulative Snapshot Engine and Monthly Event-Driven Engine must remain strictly separate.
* Any changes to `ncrEngine.ts` must pass the math-integrity checks.
* The frontend uses these independent outputs to populate a high-fidelity, high-contrast, professional-grade dashboard.
