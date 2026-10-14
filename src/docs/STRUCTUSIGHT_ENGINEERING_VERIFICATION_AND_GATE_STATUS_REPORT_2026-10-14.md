# StructuSight — تقرير المراجعة الهندسية وتدقيق بوابات التحقق
**Document Reference:** `STRUCTUSIGHT-GATE-REVIEW-2026-10-14`  
**تاريخ المراجعة:** 14 أكتوبر 2026  
**المرجع البرمجي الأساسي (Git Commit):** `fc782aa3` (تحديث بيانات التدقيق المعماري والأدلة المؤتمتة)  
**الحالة الفنية الرسمية للمنظومة:** 🟡 **PENDING APPROVAL — BASELINE GATE LOCKED**  
**طبيعة الوثيقة:** تقرير مراجعة فنية وتدقيق لبوابات التحقق الهندسية، وليست شهادة اعتماد إنتاجي نهائي (Engineering Verification & Gate Status Review, Not Final Production Certification).

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
* **النتيجة:** رصد **6 مخالفات لتجاوز حدود الطبقات (Layer Boundary Warnings)** بنتيجة امتثال **70 / 100** (خصم 30 نقطة وفق المعادلة: 100 ناقص (6 ضرب 5) = 70).
* **تفصيل المخالفات الست:**
  1. `src/analytics/__tests__/canonicalCalculations.test.ts` استدعى `src/utils/parser.ts` (الطبقة 2 تستدعي الطبقة 3).
  2. `src/analytics/calculationFoundation.ts` استدعى `src/analytics/ncr/ncrEngine.ts` (الطبقة 1 تستدعي الطبقة 2).
  3. `src/analytics/ei/eiLogEngine.ts` استدعى `src/utils/parser.ts` (الطبقة 2 تستدعي الطبقة 3).
  4. `src/analytics/ei/eiLogEngine.ts` استدعى `src/utils/parentRegisterResolver.ts` (الطبقة 2 تستدعي الطبقة 3).
  5. `src/analytics/ncr/ncrEngine.ts` استدعى `src/utils/parentRegisterResolver.ts` (الطبقة 2 تستدعي الطبقة 3).
  6. `src/utils/classificationEngine.ts` استدعى `src/utils/parentRegisterResolver.ts` (الطبقة 1 تستدعي الطبقة 3).
* **الملاحظة الفنية:** المخالفتان (4 و 5) أضيفتا لتأمين هوية السجل المعتمدة (`parentRegisterResolver`) ومنع تداخل أسماء الشيتات الصرفة.

### ب. فاحص أنماط الهندسة المعمارية التراكمي (`scripts/architecture-audit.ts`)
* **النطاق المحدد:** فحص خلو الواجهات ومكونات العرض (`src/components/`, `src/ReportTable.tsx`, `src/Presentation.tsx`) من إجراء أي حسابات رياضية مضمنة (Zero Inline Calculations)، وخلو الكود من استدعاءات مهجورة لمعرفات التصنيف القديمة.
* **النتيجة:** **0 مخالفات ضمن هذا النطاق المحدد حصراً** عبر 132 ملفاً.
* **الخلاصة:** نتيجة "صفر مخالفات" تخص فاحص الحسابات المضمنة في الواجهة، بينما يظل الهيكل العام متضمناً 6 تحذيرات تجاوز طبقات بدرجة امتثال 70/100.

---

## 3. التمييز الدقيق لتصنيف الأكواد: الاعتماد الفني مقابل الإغلاق النهائي

وفق منطق `src/analytics/statusResolver.ts` ومصفوفة الحقيقة الواحدة (SSOT):

1. **الاعتماد الفني الصريح (Technical Approval):**
   * **Code A:** معتمد بالكامل (Approved).
   * **Code B:** معتمد بملاحظات (Approved as Noted).
2. **الرفض المفتوح المتطلب لإعادة تقديم (Open Rejection):**
   * **Code C:** مرفوض مع طلب مراجعة وإعادة تقديم (Revise & Resubmit). يُصنف كـ `Rejected Open` إذا لم تصدر له مراجعة لاحقة، وهو المسؤول عن توليد متأخرات المقاول.
3. **الإغلاق النهائي (Terminal Closure - Final Closed):**
   * **Code D:** مرفوض رفضاً نهائياً غير مسموح بإعادة تقديمه (Disapproved / Final Closed - No Further Resubmission).
   * **القاعدة المعتمدة لمؤشرات الأداء:**
     * يُعامل الكود D كبند **مغلق نهائياً** (Closed = true)، وبالتالي **لا يُحسب كمتأخرات على المقاول أو الاستشاري**، ويُستبعد من عبء العمل المعلق.
     * في تقارير الجودة ومؤشرات الأداء، لا يُوصف بأنه اعتماد فني، بل يُعرض في تقارير المتابعة كحالة مستقلة `Final Closed`.

---

## 4. الصياغة الصريحة للمعادلات الرياضية والمقامات (Explicit Formulas)

### أ. مؤشر الاعتماد الفني الصرف (Pure Technical Approval Rate)

الصيغة الحسابية المعتمدة:
```
Technical Approval Rate (%) = [ (Unique Code A + Unique Code B) / Eligible Unique Documents ] * 100
```

* **البسط (Numerator):** عدد الوثائق الفريدة المعتمدة فنياً (Code A + Code B) في أحدث مراجعة سارية.
* **المقام (Denominator) - مجموعة الوثائق المؤهلة (Eligible Unique Documents):**
  * **الخيار القياسي المعتمد في StructuSight (Decided/Evaluated Scope):**
    يشمل فقط الوثائق الفريدة التي صدر بشأنها رد استشاري حاسم:
    `Eligible Unique Documents = Code A + Code B + Code C (Open) + Code C (Closed) + Code D`
    (الوثائق قيد المراجعة المعلقة التي لم تتلق رداً بعد لا تدخل في هذا المقام حتى لا تخفض نسبة الجودة ظلماً قبل انتهاء مدة دراستها).
  * **خيار الحساب الشامل (Global Intake Scope):**
    إذا طُلب احتساب النسبة من إجمالي ما تم تقديمه في المشروع، يُضاف المعلق للمقام:
    `Global Eligible Documents = Unique Evaluated + Unique Pending Under Review`
* **معاملة المراجعات المتعددة (Multiple Revisions):**
  كل وثيقة فريدة (تُعرّف بالهوية: السجل + التخصص + الرقم المرجعي للتقديم) تُحسب **مرة واحدة فقط (Count = 1)** وفق حالتها في آخر مراجعة معتمدة (Latest Active Revision). المراجعات السابقة الملغاة (Superseded) تُستبعد بالكامل من البسط والمقام لمنع التكرار.

### ب. مؤشر الإغلاق الإجمالي للمشروع (Total Closeout Rate)

الصيغة الحسابية المعتمدة:
```
Total Closeout Rate (%) = [ Unique Closed Documents / Total Unique Documents ] * 100
```
حيث:
```
Unique Closed Documents = Code A + Code B + Code D + Code C (Closed by Resolution)
Total Unique Documents  = Unique Closed Documents + Code C (Open) + Pending Under Review
```
* **ملاحظة حاسمة:** الكود D يدخل في بسط الإغلاق الإجمالي لأنه معاملة محسومة لا تتطلب أي إجراء إضافي، لكنه **لا يدخل إطلاقاً في بسط مؤشر الاعتماد الفني**.

---

## 5. نموذج الساعتين التعاقديتين لحساب المتأخرات الـ 55 (Dual Contractual Clocks)

لتبرير توزيع المتأخرات الإجمالية الـ 55 (46 على المقاول + 9 على الاستشاري) من واقع السجلات الهندسية مباشرة:

### أ. الساعة الأولى: ساعة مراجعة الاستشاري (Consultant Review Clock)
* **مجتمع البيانات:** المعاملات المعلقة قيد المراجعة (workflowStage = 'Pending') دون رد مسجل (responseDate فارغ).
* **تاريخ البداية (Start Date):** تاريخ استلام المعاملة من المقاول (submissionDate / receivedDate).
* **المهلة التعاقدية (Consultant SLA):** **14 يوماً تقويمياً** (وفق عقد الإشراف القياسي).
* **تاريخ الاستحقاق (Due Date):**
  `Consultant Due Date = submissionDate + 14 Calendar Days`
* **شرط احتساب التأخر (Overdue Condition):**
  `asOfDate (Report Cutoff Date) > Consultant Due Date` مع عدم تسجيل تاريخ رد.
* **العدد الفعلي المحسوب:** **9 معاملات متأخرة** على الاستشاري.

### ب. الساعة الثانية: ساعة إعادة التقديم للمقاول (Contractor Resubmission Clock)
* **مجتمع البيانات:** المعاملات المرفوضة بالكود C والتي لم يُقدم لها مراجعة لاحقة حتى تاريخ التقرير (workflowStage = 'Rejected' / Rejected Open).
* **تاريخ البداية (Start Date):** تاريخ إخطار المقاول بالرفض (responseDate / rejectionDate).
* **المهلة المقررة للمقاول (Contractor Resubmission Window):**
  * تُحدد تعاقدياً أو إجرائياً، والقيمة المعتمدة افتراضياً في نظام الاختبار هي **14 يوماً تقويمياً** من تاريخ الإخطار بالرفض (ملاحظة: هذه المهلة مدخل إجرائي قابل للضبط التعاقدي).
* **تاريخ الاستحقاق لإعادة التقديم (Resubmission Due Date):**
  `Contractor Resubmission Due Date = rejectionDate + Contractor Window (14 Days)`
* **شرط احتساب التأخر (Overdue Condition):**
  `asOfDate (Report Cutoff Date) > Contractor Resubmission Due Date` مع عدم وجود مراجعة بديلة مسجلة بالسجل.
* **العدد الفعلي المحسوب:** **46 معاملة متأخرة** على المقاول في إعادة التقديم.

### ج. المعادلة التكاملية للمتأخرات (SSOT Invariant):
```
Total Active Overdue (55) = 46 (Contractor Overdue Clock) + 9 (Consultant Overdue Clock)
```

---

## 6. تفصيل البصمات الأربعة وسجل التغيير المقترح (The 4 Hashes Breakdown)

الجدول التالي يوضح تفاصيل الملفات الأربعة التي أخفقت في اختبار البصمات `scripts/test-authentication-regression.ts`:

| مسار الملف | البصمة المتوقعة في خط الأساس (BRR-2026-10-07) | البصمة الفعلية الحالية (BRR-2026-10-12 المقترح) | سبب الاختلاف البرمجي | حالة البوابة |
|:---|:---|:---|:---|:---:|
| `src/utils/calculations.ts` | `ac4004e1c58e11b874e169e317bf960709e2708b365690b2810f0ac8f0f7d468` | `3fc729129957ca1c50654f1f39c4c60d47f96cb11167fc9b48df72b2312ee4ea` | إضافة فرع NCR في دالة `getClosedOpenByDocType` لربط المعتمد بالمغلق، والـ (Not Sent + Rej Open) بالمفتوح | **مقفل (LOCKED)** |
| `src/analytics/calculationFoundation.ts` | `941c00a35561b1e350e53740312b5b2ebaf6033b68d6fa3c365f6d501f797e64` | `4da695157aca2414cf24c8af4ec9667917a81d4d71c0f84df46bdd7141b46e48` | تصدير الحقول الصريحة في `calculateNCRStats`: open=103, underReview=1, closed=335, totalActive=104 | **مقفل (LOCKED)** |
| `src/analytics/ncr/ncrEngine.ts` | `008378a886fbeca72deda6d289b26d87b88a9541c63075adef39a70c25381e2b` | `b3c4dd991ef81a5fa1609bee3626a67a8990e2e01f4f339ff71f5328e967d6d4` | ضبط تفكيك الحالات التراكمية في `calculateCumulativeSnapshot` لعزل المفتوح عن تحت المراجعة | **مقفل (LOCKED)** |
| `src/utils/ncrAnalytics.ts` | `1e4df1180c10d49cd4ab8bbccb8b63bd4d2e0d4cf14c90a5e0332fead6aded1c` | `622194e11b05533ca9af0d8ee4b7b43fe91a1f50f2a87946f518a190fc4f24c9` | مواءمة محول العرض القديم مع مخرجات محرك NCR الموحد الجديد | **مقفل (LOCKED)** |

**التزام الحوكمة:** لن يتم تحديث هذه البصمات في ملف فحص الاختبار لمجرد جعله ينجح، وتظل البوابة مقفلة لحين صدور الاعتماد الإداري والفني الرسمي لوثيقة التغيير `BRR-2026-10-12`.

---

## 7. مصفوفة قرار رفع القيد (Gate Release Decision Matrix)

| شرط الاعتماد | الوضع الحالي | الإجراء المطلوب لرفع القيد |
|:---|:---:|:---|
| **استعادة بيانات NCR الأصلية** | 🔴 **معلّق (BLOCKED)** | استعادة سجل NCR الأصلي (484 صفاً) من أرشيف الـ PMC وفحص بصمته المستقلة |
| **حسم اختلافات البصمات الأربعة** | 🔴 **معلّق (BLOCKED)** | اعتماد وثيقة BRR-2026-10-12 رسمياً ثم تحديث قيم خط الأساس في الاختبار |
| **نجاح اختبار Firestore Runtime** | 🔴 **غير مثبت (NOT PROVEN)** | تشغيل محاكي Firestore المحلي لتنفيذ فحص قواعد الأمان في بيئة عمل حقيقية |
| **تسجيل التحذيرات المعمارية الستة** | 🟡 **مطلوب (DOCUMENTED)** | توثيق التحذيرات الستة وقبولها رسمياً كاستدعاءات ضرورية لقفل هوية السجلات |
| **استكمال المعادلات وتحديد المقامات** | 🟢 **مكتمل ومثبت (COMPLETED)** | تم توثيق المعادلات بالتفصيل، وتحديد المقام، وفصل ساعتي المقاول والاستشاري |

---

## 8. الحكم النهائي والقرار التنفيذي الصريح (Formal Engineering Decision)

**Engineering Decision:**  
The engineering verification report is accepted as a record of the current verification status. Production approval remains withheld under **PENDING APPROVAL — BASELINE GATE LOCKED** until the original NCR source is restored and independently verified, the four baseline hash mismatches are resolved through approved change control, Firestore runtime verification passes, and all outstanding architectural and reporting-definition issues are formally resolved or accepted.
