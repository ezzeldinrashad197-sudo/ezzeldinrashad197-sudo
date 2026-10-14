# StructuSight — تقرير المراجعة الهندسية وحالة بوابات التحقق
**Document Reference:** `STRUCTUSIGHT-GATE-REVIEW-2026-10-14`  
**تاريخ المراجعة:** 14 أكتوبر 2026  
**المرجع البرمجي (Git Commit):** `fc782aa3` (تحديث بيانات التدقيق المعماري والأدلة المؤتمتة)  
**الحالة الفنية الرسمية للمنظومة:** 🟡 **PENDING APPROVAL — BASELINE GATE LOCKED**  
**طبيعة الوثيقة:** تقرير مراجعة هندسية وتدقيق بوابات، وليست شهادة اعتماد إنتاجي نهائي (Engineering Verification & Gate Status Review, Not Final Production Certification).

---

## 1. جدول الحقيقة الفنية: ما هو مثبت وما هو معلّق (Evidence Provenance Matrix)

| البند المفحوص | الحكم الفني المعتمد | الأدلة والسجلات الملموسة في المستودع |
|:---|:---:|:---|
| **وجود قواعد تصنيف مركزية للأكواد** | **مثبت في الشيفرة (PROVEN)** | ملف `src/analytics/statusResolver.ts` ودوال `classifyRow` و`normalizeCanonicalString` محكومة باختبارات الانحدار `ER-014` و`ER-017`. |
| **وجود فحوص لبصمات خط الأساس** | **مثبت في الشيفرة (PROVEN)** | ملف `scripts/test-authentication-regression.ts` يفحص 9 بصمات، ويسجل **4 إخفاقات متعمدة ومحمية** عند بوابة خط الأساس. |
| **وجود أوامر لاختبارات التكامل والبناء والمصادقة** | **مثبت في package.json (PROVEN)** | الأوامر `lint`, `test`, `test:auth`, `test:firestore-runtime`, `run-integration-tests`, `build`, `architecture-audit`. |
| **نجاح الاختبارات على النسخة الحالية** | **مثبت بسجلات التنفيذ الحية (PROVEN)** | `npm run lint` (0 أخطاء)، `npm run test` (36 جناح بتباين 0.000%)، `npm run run-integration-tests` (8/8 نجاح)، `npm run build` (نجاح في 28 ثانية). |
| **نجاح تحقق قواعد Firestore الفعلي** | **غير مثبت بالمحاكي (NOT PROVEN)** | اختبار `scripts/test-firestore-rules-runtime.ts` فشل لعدم تشغيل محاكي Firebase محلياً (405 Not Allowed)، بينما التحقق الثابت اجتاز في `AUTH-024/025`. |
| **صحة بيانات NCR الإنتاجية** | **معلّق / غير مثبت (BLOCKED / PENDING)** | ملف القرص الحالي هو أثر اصطناعي من 3 صفوف (`c2b15eaec1...`)؛ السجل الحقيقي ذو الـ 484 صفاً قيد الاستعادة من أرشيف الـ PMC. |
| **خلو الهيكل المعماري بالكامل من المخالفات** | **غير مثبت (NOT PROVEN)** | تقرير الامتثال التلقائي يسجل **6 مخالفات لعزل الطبقات** بدرجة امتثال **70 / 100**، بينما نتيجة الصفر مخالفات تخص فاحص الـ AST المحدد فقط. |

---

## 2. تفكيك التعارض في تقييم الهيكل المعماري (Differentiating the Two Architectural Checkers)

يجب الفصل التام وعدم الدمج بين أداتي التدقيق المعماري داخل المستودع:

### أ. تقرير الامتثال المعماري الآلي (`src/docs/AutomatedEvidenceReport.md`)
* **النطاق:** فحص تدفق التبعيات الهرمي الصارم للطبقات (Strict Downward Directed Acyclic Graph - DAG).
* **النتيجة:** رصد **6 مخالفات لتجاوز حدود الطبقات (Layer Boundary Warnings)** بنتيجة امتثال **70 / 100** (خصم 30 نقطة: $100 - (6 \times 5)$).
* **تفصيل المخالفات الست:**
  1. `src/analytics/__tests__/canonicalCalculations.test.ts` $\rightarrow$ `src/utils/parser.ts` (الطبقة 2 تستدعي الطبقة 3).
  2. `src/analytics/calculationFoundation.ts` $\rightarrow$ `src/analytics/ncr/ncrEngine.ts` (الطبقة 1 تستدعي الطبقة 2).
  3. `src/analytics/ei/eiLogEngine.ts` $\rightarrow$ `src/utils/parser.ts` (الطبقة 2 تستدعي الطبقة 3).
  4. `src/analytics/ei/eiLogEngine.ts` $\rightarrow$ `src/utils/parentRegisterResolver.ts` (الطبقة 2 تستدعي الطبقة 3).
  5. `src/analytics/ncr/ncrEngine.ts` $\rightarrow$ `src/utils/parentRegisterResolver.ts` (الطبقة 2 تستدعي الطبقة 3).
  6. `src/utils/classificationEngine.ts` $\rightarrow$ `src/utils/parentRegisterResolver.ts` (الطبقة 1 تستدعي الطبقة 3).
* **الملاحظة:** المخالفتان (4 و 5) أضيفتا لتأمين هوية السجل المعتمدة (`parentRegisterResolver`) ومنع خلط الشيتات.

### ب. فاحص أنماط الهندسة المعمارية التراكمي (`scripts/architecture-audit.ts`)
* **النطاق المحدد:** فحص خلو الواجهات ومكونات العرض (`src/components/`, `src/ReportTable.tsx`, `src/Presentation.tsx`) من إجراء أي حسابات رياضية مضمنة (Zero Inline Calculations)، وخلو الكود من استدعاءات مهجورة لمعرفات التصنيف القديمة.
* **النتيجة:** **0 مخالفات ضمن هذا النطاق المحدد حصراً** عبر 132 ملفاً.
* **الخلاصة:** نتيجة "صفر مخالفات" لا تعني خلو الهيكل المعماري ككل من الملاحظات، بل تؤكد حظر الحسابات في واجهة المستخدم، بينما يظل مؤشر الامتثال الهرمي عند 70/100 بوجود التحذيرات الستة.

---

## 3. التمييز الدقيق لتصنيف الأكواد: الاعتماد الفني مقابل الإغلاق النهائي

وفق منطق `src/analytics/statusResolver.ts` ومصفوفة الحقيقة الواحدة (SSOT):

1. **الاعتماد الفني الصريح (Technical Approval):**
   * **Code A:** معتمد بالكامل (Approved).
   * **Code B:** معتمد بملاحظات (Approved as Noted).
2. **الرفض المفتوح المتطلب لإعادة تقديم (Open Rejection):**
   * **Code C:** مرفوض مع طلب مراجعة وإعادة تقديم (`Revise & Resubmit`). يُصنف كـ `Rejected Open` إذا لم تصدر له مراجعة لاحقة، وهو المسؤول عن توليد متأخرات المقاول.
3. **الإغلاق النهائي (Terminal Closure - Final Closed):**
   * **Code D:** مرفوض رفضاً نهائياً غير مسموح بإعادة تقديمه (`Disapproved / Final Closed`).
   * **القاعدة المعتمدة لمؤشرات الأداء:**
     * يُعامل `Code D` كبند **مغلق نهائياً** (`Closed = true`)، وبالتالي لا يُحسب كمتأخرات على المقاول أو الاستشاري، ويُستبعد من عبء العمل المعلق.
     * في تقارير الجودة الصارمة: يجب عدم تسميته «معتمداً فنياً»، بل يُعرض في تقارير المتابعة كحالة مستقلة `Final Closed`.
     * **معادلة نسبة الاعتماد الفني الصرف (Pure Technical Approval Rate):**
       $$\text{Technical Approval Rate \%} = \frac{\text{Unique Code A} + \text{Unique Code B}}{\text{Total Unique Documents}} \times 100\%$$
     * **معادلة نسبة الإنجاز والإغلاق الإجمالي (Total Closeout Rate \%):**
       $$\text{Closeout Rate \%} = \frac{(\text{Code A} + \text{Code B}) + \text{Code D}}{\text{Total Unique Documents}} \times 100\%$$

---

## 4. نموذج الساعتين التعاقديتين لحساب المتأخرات (Dual Contractual Clocks)

لتبرير التقسيم الرياضي للمتأخرات ($55 = 46 + 9$) من واقع السجلات الهندسية، تم فصل ساعتي الاحتساب التعاقديتين:

```
                          ┌──────────────────────────────────────────────┐
                          │     تاريخ التقديم الأولي / submissionDate     │
                          └──────────────────────┬───────────────────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │   الساعة الأولى: مراجعة الاستشاري (Consultant) │
                          │   المهلة القياسية: 14 يوماً تقويمياً         │
                          └──────────────────────┬───────────────────────┘
                                                 │
                    ┌────────────────────────────┴────────────────────────────┐
                    ▼                                                         ▼
         [تم الرد بالاعتماد A/B أو D]                               [تم الرد بالرفض الكود C]
                    │                                                         │
                    ▼                                                         ▼
        [إغلاق دورة العمل / محسوم]                        ┌──────────────────────────────────────────────┐
                                                          │     تاريخ إخطار الرفض / rejectionDate        │
                                                          └──────────────────────┬───────────────────────┘
                                                                                 │
                                                                                 ▼
                                                          ┌──────────────────────────────────────────────┐
                                                          │    الساعة الثانية: إعادة التقديم (Contractor) │
                                                          │    المهلة القياسية: 14 يوماً تقويمياً        │
                                                          └──────────────────────────────────────────────┘
```

### أ. الساعة الأولى: تأخر مراجعة الاستشاري (Consultant Review Clock)
* **مجتمع البيانات:** الوثائق قيد المراجعة المعلقة (`workflowStage === 'Pending'`) حيث `responseDate == null`.
* **معادلة مدة التأخير:**
  $$\text{Delay}_{\text{consultant}} = \text{asOfDate} - \text{submissionDate}$$
* **شرط احتساب المتأخرات:** $\text{Delay}_{\text{consultant}} > 14\text{ Calendar Days}$.
* **العدد الفعلي المحسوب:** **9 معاملات متأخرة** على الاستشاري.

### ب. الساعة الثانية: تأخر المقاول في إعادة التقديم (Contractor Resubmission Clock)
* **مجتمع البيانات:** المعاملات المرفوضة بالكود C التي تنتظر مراجعة بديلة (`workflowStage === 'Rejected'` / `isRejectedOpen === true`).
* **معادلة مدة التأخير:**
  $$\text{Delay}_{\text{contractor}} = \text{asOfDate} - \text{responseDate / rejectionDate}$$
* **شرط احتساب المتأخرات:** $\text{Delay}_{\text{contractor}} > 14\text{ Calendar Days}$.
* **العدد الفعلي المحسوب:** **46 معاملة متأخرة** على المقاول في إعادة التقديم.

### ج. المعادلة التكاملية للمتأخرات (SSOT Invariant):
$$\text{إجمالي المتأخرات النشطة (55)} = 46\text{ (ساعة المقاول)} + 9\text{ (ساعة الاستشاري)}$$

---

## 5. مخرجات التصدير المادية وملفات التحقق المحفوظة

تم توليد وحفظ مخرجات التصدير المادية في المستودع وتأكيد تطابقها الحسابي بنسبة 100%:
1. `StructuSight-Presentation-2026-10-14.pptx` (984,805 بايت): العرض التقديمي التنفيذي الكامل شاملاً جداول الشهر والتراكمي ومصفوفة التخصصات دون أي تشويه للأعمدة.
2. `evidence/certification/StructuSight-NCR-Verification.pdf` (29,877 بايت): تقرير PDF ذو صفحتين يطابق جداول العرض التقديمي بنسبة 100%.
3. `evidence/certification/StructuSight-NCR-Verification.pptx` (984,805 بايت): نسخة الأرشيف المعتمدة للمقارنة الرقمية.

---

## 6. القرار النهائي والتوصية الهندسية الملزمة

يظل القرار الهندسي للمنظومة:  
🟡 **PENDING APPROVAL — BASELINE GATE LOCKED**

**خارطة الطريق الإلزامية لإغلاق البوابات:**
1. **استعادة ملف NCR:** تزويد النظام بنسخة أصلية موثقة من أرشيف الـ PMC ذات الـ 484 صفاً، وتسجيل بصمتها المستقلة.
2. **اعتماد خط الأساس:** صدور الموافقة الإدارية الصريحة على وثيقة `BRR-2026-10-12`، وعندها فقط تُحدث البصمات الأربعة في `scripts/test-authentication-regression.ts`.
3. **تشغيل محاكي Firestore:** توفير بيئة تشغيل محلية للمحاكي لاجتياز اختبار `test:firestore-runtime` الحقيقي.
4. **توثيق المخالفات المعمارية الست:** إما بإعادة هيكلة الاستدعاءات عبر وسيط واجهات (Interface Inversion) أو قبولها رسمياً كتحذيرات غير مانعة للإصدار.
