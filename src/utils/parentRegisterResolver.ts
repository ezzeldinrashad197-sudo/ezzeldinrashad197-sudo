// ============================================================================
// STRUCTUSIGHT — CANONICAL PARENT REGISTER RESOLUTION ENGINE (PHASE W SSOT)
// ============================================================================

export interface RegisterMetadata {
  identity: string;       // e.g. 'DOC', 'MAR', 'WIR', 'SDW', 'MIR', 'RFI', 'NCR', 'SOR', 'LTR', 'ABD', 'QS', 'UNCLASSIFIED'
  registerIdentity: string; // Alias matching SubmittalRow.registerIdentity
  displayNameEn: string;  // e.g. 'Document Submittals (DOC)'
  displayNameAr: string;  // e.g. 'سجل تقديم المستندات الفنية (DOC)'
  workflowFamily: string; // e.g. 'DOC', 'MAR', 'WIR', 'SDW', etc.
  isAuthoritative: boolean;
}

export const KNOWN_PARENT_REGISTERS: Record<string, RegisterMetadata> = {
  DOC: {
    identity: 'DOC',
    registerIdentity: 'DOC',
    displayNameEn: 'Document Submittals (DOC)',
    displayNameAr: 'سجل تقديم المستندات الفنية (DOC)',
    workflowFamily: 'DOC',
    isAuthoritative: true,
  },
  MAR: {
    identity: 'MAR',
    registerIdentity: 'MAR',
    displayNameEn: 'Material Approval Requests (MAR)',
    displayNameAr: 'سجل اعتمادات المواد (MAR)',
    workflowFamily: 'MAR',
    isAuthoritative: true,
  },
  SDW: {
    identity: 'SDW',
    registerIdentity: 'SDW',
    displayNameEn: 'Shop Drawings (SDW)',
    displayNameAr: 'سجل المخططات التنفيذية (SDW)',
    workflowFamily: 'SDW',
    isAuthoritative: true,
  },
  SHD: {
    identity: 'SDW',
    registerIdentity: 'SDW',
    displayNameEn: 'Shop Drawings (SDW)',
    displayNameAr: 'سجل المخططات التنفيذية (SDW)',
    workflowFamily: 'SDW',
    isAuthoritative: true,
  },
  WIR: {
    identity: 'WIR',
    registerIdentity: 'WIR',
    displayNameEn: 'Work Inspection Requests (WIR)',
    displayNameAr: 'سجل طلبات فحص واستلام الأعمال (WIR)',
    workflowFamily: 'WIR',
    isAuthoritative: true,
  },
  MIR: {
    identity: 'MIR',
    registerIdentity: 'MIR',
    displayNameEn: 'Material Inspection Requests (MIR)',
    displayNameAr: 'سجل طلبات فحص المواد (MIR)',
    workflowFamily: 'MIR',
    isAuthoritative: true,
  },
  RFI: {
    identity: 'RFI',
    registerIdentity: 'RFI',
    displayNameEn: 'Requests for Information (RFI)',
    displayNameAr: 'سجل طلبات الاستفسار والمعلومات (RFI)',
    workflowFamily: 'RFI',
    isAuthoritative: true,
  },
  NCR: {
    identity: 'NCR',
    registerIdentity: 'NCR',
    displayNameEn: 'Non-Conformance Reports (NCR)',
    displayNameAr: 'سجل تقارير عدم المطابقة (NCR)',
    workflowFamily: 'NCR',
    isAuthoritative: true,
  },
  SOR: {
    identity: 'SOR',
    registerIdentity: 'SOR',
    displayNameEn: 'Site Observation Reports (SOR)',
    displayNameAr: 'سجل ملاحظات الموقع والسلامة (SOR)',
    workflowFamily: 'SOR',
    isAuthoritative: true,
  },
  LTR: {
    identity: 'LTR',
    registerIdentity: 'LTR',
    displayNameEn: 'Letters & Correspondence (LTR)',
    displayNameAr: 'سجل المراسلات والخطابات (LTR)',
    workflowFamily: 'LETTER',
    isAuthoritative: true,
  },
  LETTER: {
    identity: 'LTR',
    registerIdentity: 'LTR',
    displayNameEn: 'Letters & Correspondence (LTR)',
    displayNameAr: 'سجل المراسلات والخطابات (LTR)',
    workflowFamily: 'LETTER',
    isAuthoritative: true,
  },
  ABD: {
    identity: 'ABD',
    registerIdentity: 'ABD',
    displayNameEn: 'As-Built Drawings (ABD)',
    displayNameAr: 'سجل مخططات كما تم التنفيذ (ABD)',
    workflowFamily: 'ABD',
    isAuthoritative: true,
  },
  QS: {
    identity: 'QS',
    registerIdentity: 'QS',
    displayNameEn: 'Quantity Survey (QS)',
    displayNameAr: 'سجل حصر الكميات والمستخلصات (QS)',
    workflowFamily: 'QS',
    isAuthoritative: true,
  },
  UNCLASSIFIED: {
    identity: 'UNCLASSIFIED',
    registerIdentity: 'UNCLASSIFIED',
    displayNameEn: 'Unclassified Register',
    displayNameAr: 'سجل غير مصنف',
    workflowFamily: 'UNKNOWN',
    isAuthoritative: false,
  },
};

// Pure discipline sheet identifiers that must NEVER become parent registers
export const DISCIPLINE_SHEET_NAMES = new Set([
  'GEN', 'GENERAL', 'GEN.', 'COMMON',
  'STR', 'STRUCT', 'STRUCTURAL', 'CIVIL', 'STRUCTURE',
  'ARC', 'ARCH', 'ARCHITECTURAL', 'ARCHITECTURE',
  'MEC', 'MECH', 'MECHANICAL', 'HVAC', 'PLUMBING',
  'ELE', 'ELEC', 'ELECTRICAL', 'LOW VOLTAGE',
  'INF', 'INFR', 'INFRA', 'INFRASTRUCTURE', 'UTILITIES', 'ROADS',
  'LND', 'LAND', 'LANDSCAPE', 'IRR', 'IRRIGATION',
  'SUR', 'SURV', 'SURVEY',
  'HSE', 'SAFETY',
  'MEP'
]);

export function isDisciplineSheet(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toUpperCase();
  return DISCIPLINE_SHEET_NAMES.has(clean);
}

export function normalizeDisciplineName(name: string): { normalized: string; code: string } {
  const clean = (name || '').trim().toUpperCase();
  if (['STR', 'STRUCT', 'STRUCTURAL', 'CIVIL', 'STRUCTURE'].includes(clean)) {
    return { normalized: 'Structural', code: 'STR' };
  }
  if (['ARC', 'ARCH', 'ARCHITECTURAL', 'ARCHITECTURE'].includes(clean)) {
    return { normalized: 'Architectural', code: 'ARCH' };
  }
  if (['MEC', 'MECH', 'MECHANICAL', 'HVAC', 'PLUMBING'].includes(clean)) {
    return { normalized: 'Mechanical', code: 'MECH' };
  }
  if (['ELE', 'ELEC', 'ELECTRICAL', 'LOW VOLTAGE'].includes(clean)) {
    return { normalized: 'Electrical', code: 'ELEC' };
  }
  if (['INF', 'INFR', 'INFRA', 'INFRASTRUCTURE', 'UTILITIES', 'ROADS'].includes(clean)) {
    return { normalized: 'Infrastructure', code: 'INFRA' };
  }
  if (['LND', 'LAND', 'LANDSCAPE'].includes(clean)) {
    return { normalized: 'Landscape', code: 'LAND' };
  }
  if (['IRR', 'IRRIGATION'].includes(clean)) {
    return { normalized: 'Irrigation', code: 'IRR' };
  }
  if (['SUR', 'SURV', 'SURVEY'].includes(clean)) {
    return { normalized: 'Survey', code: 'SURV' };
  }
  if (['HSE', 'SAFETY'].includes(clean)) {
    return { normalized: 'HSE', code: 'HSE' };
  }
  if (['MEP'].includes(clean)) {
    return { normalized: 'MEP', code: 'MEP' };
  }
  return { normalized: 'General', code: 'GEN' };
}

/**
 * Resolves the Parent Register for a Workbook/File context.
 * Strict Precedence (Phase U & Phase W Invariants):
 * 1. Explicit metadata / user selection
 * 2. File/Workbook name register token (e.g. DOC_Register.xlsx -> DOC, WIR_Log -> WIR)
 * 3. Inspection of document references (SUB Refs) across sheets
 * 4. Compound sheet names (e.g. WIR-STR -> WIR)
 * 5. Return UNCLASSIFIED (NEVER default to SDW!)
 */
export function resolveParentRegister(params: {
  fileName: string;
  sheetNames?: string[];
  sampleDocRefs?: string[];
  explicitRegister?: string;
}): RegisterMetadata {
  const { fileName, sheetNames = [], sampleDocRefs = [], explicitRegister } = params;

  // 1. Explicit register
  if (explicitRegister && KNOWN_PARENT_REGISTERS[explicitRegister.toUpperCase()]) {
    return KNOWN_PARENT_REGISTERS[explicitRegister.toUpperCase()];
  }

  // 2. File name token
  const cleanFileName = (fileName || '').replace(/\.[^/.]+$/, '').toUpperCase();
  const fileTokens = cleanFileName.split(/[\s\-_.()[\]]+/);

  for (const token of fileTokens) {
    if (KNOWN_PARENT_REGISTERS[token]) {
      return KNOWN_PARENT_REGISTERS[token];
    }
  }

  // Check phrase matches in file name
  if (cleanFileName.includes('SHOP DRAWING') || cleanFileName.includes('SHOP-DRAWING')) return KNOWN_PARENT_REGISTERS['SDW'];
  if (cleanFileName.includes('AS-BUILT') || cleanFileName.includes('AS BUILT')) return KNOWN_PARENT_REGISTERS['ABD'];
  if (cleanFileName.includes('MATERIAL APPROVAL') || cleanFileName.includes('MATERIAL SUBMITTAL')) return KNOWN_PARENT_REGISTERS['MAR'];
  if (cleanFileName.includes('MATERIAL INSPECTION')) return KNOWN_PARENT_REGISTERS['MIR'];
  if (cleanFileName.includes('WORK INSPECTION') || cleanFileName.includes('SITE INSPECTION')) return KNOWN_PARENT_REGISTERS['WIR'];
  if (cleanFileName.includes('REQUEST FOR INFORMATION') || cleanFileName.includes('TECHNICAL QUERY')) return KNOWN_PARENT_REGISTERS['RFI'];
  if (cleanFileName.includes('NON CONFORMANCE') || cleanFileName.includes('NON-CONFORMANCE')) return KNOWN_PARENT_REGISTERS['NCR'];
  if (cleanFileName.includes('SITE OBSERVATION')) return KNOWN_PARENT_REGISTERS['SOR'];
  if (cleanFileName.includes('QUANTITY SURVEY')) return KNOWN_PARENT_REGISTERS['QS'];
  if (cleanFileName.includes('LETTER') || cleanFileName.includes('CORRESPONDENCE')) return KNOWN_PARENT_REGISTERS['LTR'];
  if (cleanFileName.includes('DOCUMENT') || cleanFileName.includes('DOCUMENTS') || cleanFileName.includes('TRANSMITTAL')) return KNOWN_PARENT_REGISTERS['DOC'];

  // 3. Inspect sample document references across the workbook
  if (sampleDocRefs.length > 0) {
    const hits: Record<string, number> = {
      DOC: 0, SDW: 0, MAR: 0, WIR: 0, MIR: 0, RFI: 0, NCR: 0, SOR: 0, ABD: 0, LTR: 0, QS: 0
    };
    for (const ref of sampleDocRefs) {
      const upperRef = (ref || '').toUpperCase();
      if (/\b(?:DOC|TECHNICAL)\b|[-_]DOC[-_]/i.test(upperRef)) hits.DOC++;
      if (/\b(?:SDW|SHD|DWG)\b|[-_]SDW[-_]|[-_]SHD[-_]/i.test(upperRef)) hits.SDW++;
      if (/\bMAR\b|[-_]MAR[-_]/i.test(upperRef)) hits.MAR++;
      if (/\bWIR\b|[-_]WIR[-_]/i.test(upperRef)) hits.WIR++;
      if (/\bMIR\b|[-_]MIR[-_]/i.test(upperRef)) hits.MIR++;
      if (/\bRFI\b|[-_]RFI[-_]/i.test(upperRef)) hits.RFI++;
      if (/\bNCR\b|[-_]NCR[-_]/i.test(upperRef)) hits.NCR++;
      if (/\bSOR\b|[-_]SOR[-_]/i.test(upperRef)) hits.SOR++;
      if (/\bABD\b|[-_]ABD[-_]/i.test(upperRef)) hits.ABD++;
    }

    let topHit = '';
    let maxCount = 0;
    for (const [k, v] of Object.entries(hits)) {
      if (v > maxCount) {
        maxCount = v;
        topHit = k;
      }
    }
    if (topHit && maxCount >= 2 && KNOWN_PARENT_REGISTERS[topHit]) {
      return KNOWN_PARENT_REGISTERS[topHit];
    }
  }

  // 4. Inspect sheet names for compound register indicators (e.g. WIR-STR, DOC-GEN)
  for (const sName of sheetNames) {
    const upperSheet = sName.toUpperCase().trim();
    const parts = upperSheet.split(/[-_ ]+/);
    if (parts.length > 1 && KNOWN_PARENT_REGISTERS[parts[0]]) {
      return KNOWN_PARENT_REGISTERS[parts[0]];
    }
    if (KNOWN_PARENT_REGISTERS[upperSheet] && !isDisciplineSheet(upperSheet)) {
      return KNOWN_PARENT_REGISTERS[upperSheet];
    }
  }

  // 5. Default is strictly UNCLASSIFIED (NEVER default to SDW!)
  return KNOWN_PARENT_REGISTERS.UNCLASSIFIED;
}

export function getCanonicalRegisterTitle(regIdentity: string, language: 'ar' | 'en'): { name: string; subtitle: string } {
  const upper = (regIdentity || '').toUpperCase().trim();
  const meta = KNOWN_PARENT_REGISTERS[upper];

  if (upper === 'SDW' || upper === 'SHD') {
    return {
      name: language === 'ar' ? 'المخططات التنفيذية (Shop Drawings)' : 'Shop Drawings Register',
      subtitle: language === 'ar' ? 'سجل اعتمادات ومراجعات مخططات الورشة التنفيذية' : 'Shop Drawing Approval & Engineering Review'
    };
  }
  if (upper === 'MAR') {
    return {
      name: language === 'ar' ? 'اعتمادات المواد (Material Approvals)' : 'Material Approval Requests Register',
      subtitle: language === 'ar' ? 'سجل اعتمادات ومراجعات العينات والمواد الهندسية' : 'Material Submittals & Approvals'
    };
  }
  if (upper === 'WIR') {
    return {
      name: language === 'ar' ? 'طلبات فحص الأعمال (WIR)' : 'Work Inspection Requests Register',
      subtitle: language === 'ar' ? 'سجل تفتيش واستلام أعمال الموقع والإنشاءات' : 'Site Work Inspection Requests'
    };
  }
  if (upper === 'MIR') {
    return {
      name: language === 'ar' ? 'طلبات فحص وتوريد المواد (MIR)' : 'Material Inspection Requests Register',
      subtitle: language === 'ar' ? 'سجل فحص وتوريد المواد عند وصولها للموقع' : 'Material Delivery & Site Inspection'
    };
  }
  if (upper === 'DOC') {
    return {
      name: language === 'ar' ? 'المستندات الفنية (Technical Submittals)' : 'Document Submittals Register',
      subtitle: language === 'ar' ? 'سجل تقديم واعتماد المستندات ووثائق المشروع الفنية' : 'Technical Documents & Method Statements'
    };
  }
  if (upper === 'RFI') {
    return {
      name: language === 'ar' ? 'طلبات الاستفسار والمعلومات (RFI)' : 'Requests for Information Register',
      subtitle: language === 'ar' ? 'سجل استفسارات وتوضيحات وثائق ومخططات المشروع' : 'Requests for Technical Clarification'
    };
  }
  if (upper === 'NCR') {
    return {
      name: language === 'ar' ? 'تقارير عدم المطابقة (NCR)' : 'Non-Conformance Reports Register',
      subtitle: language === 'ar' ? 'سجل مخالفات الجودة والإجراءات التصحيحية' : 'Quality Non-Conformance Reports'
    };
  }
  if (upper === 'SOR') {
    return {
      name: language === 'ar' ? 'ملاحظات الموقع والسلامة (SOR)' : 'Site Observation Reports Register',
      subtitle: language === 'ar' ? 'سجل ملاحظات السلامة والجودة الدورية' : 'Site Safety & Quality Observations'
    };
  }
  if (upper === 'LTR' || upper === 'LETTER') {
    return {
      name: language === 'ar' ? 'المراسلات والخطابات (Letters)' : 'Letters & Correspondence Register',
      subtitle: language === 'ar' ? 'سجل المراسلات الرسمية والخطابات المتبادلة' : 'Project Formal Correspondence'
    };
  }
  if (upper === 'ABD') {
    return {
      name: language === 'ar' ? 'مخططات كما تم التنفيذ (As-Built)' : 'As-Built Drawings Register',
      subtitle: language === 'ar' ? 'سجل مخططات المنفذ على الطبيعة ومطابقة الواقع' : 'As-Built Drawings Submittals'
    };
  }
  if (upper === 'QS') {
    return {
      name: language === 'ar' ? 'حصر الكميات والمستخلصات (QS)' : 'Quantity Survey Register',
      subtitle: language === 'ar' ? 'سجل حصر الكميات ودفاتر الحصر ومستخلصات الأعمال' : 'Quantity Survey & Measurements'
    };
  }

  // Fallback for custom or unclassified register
  return {
    name: meta ? (language === 'ar' ? meta.displayNameAr : meta.displayNameEn) : (language === 'ar' ? `سجل [${upper}]` : `Register [${upper}]`),
    subtitle: language === 'ar' ? 'سجل المتابعة والتدقيق الفني' : 'Engineering Log & Register Tracking'
  };
}
