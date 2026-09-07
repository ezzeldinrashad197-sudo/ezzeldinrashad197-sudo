import { AnyRecord, ValidationIssue } from './models';
import { getStatusCodeCategory } from '../utils/calculations';
import { getNormalizedRevision } from './revisionResolver';

export const validateDataset = (records: AnyRecord[]): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    const docSet = new Set<string>();

    records.forEach(r => {
        // 1. Missing Document Number
        if (!r.docNo) {
            issues.push({ 
                id: `${r.id}-MISSING-DOC-NO`, 
                rowId: r.id, 
                recordType: r.recordType, 
                issueType: 'MISSING_DOC_NO', 
                description: 'Document Number is missing and cannot be registered.' 
            });
        }

        // 2. Missing/Invalid Submission Date
        if (!r.submissionDate) {
            issues.push({ 
                id: `${r.id}-MISSING-DATE`, 
                rowId: r.id, 
                recordType: r.recordType, 
                issueType: 'MISSING_DATE', 
                description: 'Submission Date is missing.' 
            });
        } else {
            const dateParsed = new Date(r.submissionDate);
            if (isNaN(dateParsed.getTime())) {
                issues.push({ 
                    id: `${r.id}-INVALID-DATE`, 
                    rowId: r.id, 
                    recordType: r.recordType, 
                    issueType: 'MISSING_DATE', 
                    description: `Submission Date '${r.submissionDate}' is invalid.` 
                });
            }
        }

        // 3. Invalid Revision Format
        const revStr = String(r.rev || '').trim();
        if (revStr && /[^a-zA-Z0-9.\-_]/.test(revStr)) {
            issues.push({
                id: `${r.id}-INVALID-REV`,
                rowId: r.id,
                recordType: r.recordType,
                issueType: 'INVALID_REV',
                description: `Revision format '${revStr}' contains invalid characters.`
            });
        }
        
        // 4. Duplicate Document & Revision check (Sanity check)
        const normRev = getNormalizedRevision(r.rev);
        const strictKey = `${r.docNo || 'UNKNOWN'}-${normRev}`;
        if (r.docNo && docSet.has(strictKey)) {
            issues.push({ 
                id: `${r.id}-DUPLICATE-DOC`, 
                rowId: r.id, 
                recordType: r.recordType, 
                issueType: 'DUPLICATE_DOC', 
                description: `Duplicate revision found for ${strictKey} within the same ingest cohort.` 
            });
        }
        if (r.docNo) {
            docSet.add(strictKey);
        }

        // 5. Unrecognized Status Code
        const statusVal = r.rawStatus || (r as any).status || '';
        const cat = getStatusCodeCategory(statusVal);
        if ((cat === 'UNCLASSIFIED' || (cat as string) === 'UNKNOWN') && statusVal) {
            issues.push({
                id: `${r.id}-UNRECOGNIZED-STATUS`,
                rowId: r.id,
                recordType: r.recordType,
                issueType: 'UNRECOGNIZED_STATUS',
                description: `Status value '${statusVal}' is unrecognized under standard status mappings.`
            });
        }

        // 6. Invalid / Missing Discipline
        if (!r.discipline || r.discipline.trim() === '') {
            issues.push({
                id: `${r.id}-INVALID-DISCIPLINE`,
                rowId: r.id,
                recordType: r.recordType,
                issueType: 'INVALID_DISCIPLINE',
                description: 'Record is missing a designated engineering discipline.'
            });
        }
    });

    return issues;
};
