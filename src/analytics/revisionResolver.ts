/**
 * Canonical revision resolver.
 * Single source of truth for revision validity, ordering and weighting.
 *
 * CANONICAL REVISION BUSINESS RULES (SSOT ARCHITECTURE):
 * 1. CLASSIFICATION OF BLANK / NULL / UNDEFINED / INVALID REVISIONS:
 *    Any revision that is null, undefined, empty string (""), whitespace-only,
 *    or placeholder values ("N/A", "-", "NONE", "NULL", "UNDEFINED", "BLANK", "(BLANK)")
 *    is strictly classified as INVALID_REVISION (Semantic: 'Unknown' / Missing Revision).
 *    - isValidRevision(raw) === false
 *    - getRevisionWeight(raw) === -1
 *    - getNormalizedRevision(raw, isRev0Flag) === (isRev0Flag === true ? '0' : 'Unknown')
 *    - isRevision0(raw, isRev0Flag) === (isRev0Flag === true)
 *    - isFurtherRevision(raw, isRev0Flag) === false
 *
 *    UNDER NO CIRCUMSTANCES can a blank/invalid revision:
 *    a) Implicitly collapse into Rev00 without an explicit, authoritative boolean flag (isRev0 === true).
 *    b) Mistakenly fall through into Further Revision.
 *    c) Disagree between different KPI engines or calculation paths.
 *
 * 2. CLASSIFICATION OF REV 00 / BASELINE REVISIONS:
 *    Revisions representing initial baseline release:
 *    '0', '00', '0.0', 'REV 0', 'REV 00', 'REV.0', 'REV.00', 'REV0', 'REV00', 'R0', 'R00', 'R0.0'.
 *    - isValidRevision(raw) === true
 *    - getRevisionWeight(raw) === 0
 *    - getNormalizedRevision(raw) === '0'
 *    - isRevision0(raw) === true
 *    - isFurtherRevision(raw) === false
 *
 * 3. CLASSIFICATION OF FURTHER REVISIONS:
 *    Any valid revision with weight > 0 (numeric > 0 like '1', '01', 'REV1', '2', 'REV2',
 *    alphabetic 'A', 'B', or milestone 'IFC', 'AS-BUILT').
 *    - isValidRevision(raw) === true
 *    - getRevisionWeight(raw) > 0
 *    - getNormalizedRevision(raw) === cleaned canonical string (e.g. '1', '2', 'IFC', 'AS-BUILT')
 *    - isRevision0(raw) === false
 *    - isFurtherRevision(raw) === true
 */

export const isValidRevision = (revStr: string | number | null | undefined): boolean => {
  if (revStr === undefined || revStr === null) return false;
  const val = String(revStr).trim().toUpperCase();
  if (val === '' || ['N/A', '-', 'NONE', 'NULL', 'UNDEFINED', 'BLANK', '(BLANK)'].includes(val)) return false;
  return true;
};

export const getRevisionWeight = (revStr: string | number | null | undefined): number => {
  if (!isValidRevision(revStr)) return -1;
  const val = String(revStr).trim().toUpperCase();

  if (['0', '00', '0.0', 'REV 0', 'REV 00', 'REV.0', 'REV.00', 'REV0', 'REV00', 'R0', 'R00', 'R0.0'].includes(val)) return 0;
  if (val === 'AS-BUILT' || val === 'ASBUILT') return 100000;
  if (val === 'IFC') return 90000;

  if (val.startsWith('IFC')) {
    const num = parseInt(val.replace(/[^\d]/g, ''), 10) || 0;
    return 90000 + num;
  }

  if (val.startsWith('P')) {
    const num = parseInt(val.substring(1), 10);
    if (num === 0) return 0;
    if (!isNaN(num)) return 1000 + num;
  }

  if (val.startsWith('C') && val.length > 1 && !isNaN(parseInt(val.substring(1), 10))) {
    const num = parseInt(val.substring(1), 10);
    if (num === 0) return 0;
    return 2000 + num;
  }

  const numCheck = parseInt(val, 10);
  if (!isNaN(numCheck) && (String(numCheck) === val || String(numCheck).padStart(val.length, '0') === val)) return numCheck;

  if (/^[A-Z]+$/.test(val)) {
    let score = 0;
    for (let i = 0; i < val.length; i++) score = score * 26 + (val.charCodeAt(i) - 64);
    return 5000 + score;
  }

  const cleanedNum = parseInt(val.replace(/[^\d]/g, ''), 10);
  if (!isNaN(cleanedNum)) {
    if (cleanedNum === 0) return 0;
    return 3000 + cleanedNum;
  }

  let alphaSum = 0;
  for (let i = 0; i < Math.min(val.length, 5); i++) alphaSum += val.charCodeAt(i) * Math.pow(10, 5 - i);
  return alphaSum;
};

export const compareRevisionsCanonical = (
  revA: string | number | undefined | null,
  revB: string | number | undefined | null
): number => {
  const a = getRevisionWeight(revA);
  const b = getRevisionWeight(revB);
  if (a < 0 && b < 0) return 0;
  if (a < 0) return -1;
  if (b < 0) return 1;
  return a - b;
};

/**
 * Canonical helper to normalize revision representation.
 * Explicitly follows the Business Rule:
 * - If invalid/blank: returns '0' if isRev0 is explicitly true; otherwise returns 'Unknown'.
 * - If Rev0/00/REV0/etc: returns '0'.
 * - If Further Revision: returns cleaned string ('1', '2', 'IFC', etc.).
 */
export const getNormalizedRevision = (
  rev?: string | number | null,
  isRev0?: boolean
): string => {
  if (isRev0 === true) {
    return '0';
  }

  if (!isValidRevision(rev)) {
    return 'Unknown';
  }

  const r = String(rev).trim().toUpperCase();
  if (
    r === '00' ||
    r === '0' ||
    r === 'REV 0' ||
    r === 'REV 00' ||
    r === 'REV0' ||
    r === 'REV00' ||
    r === 'REV.0' ||
    r === 'REV.00' ||
    r === 'R0' ||
    r === 'R00' ||
    r === 'R0.0' ||
    r === '0.0'
  ) {
    return '0';
  }

  let cleaned = r.replace(/^REV\.?\s*/, '').replace(/^R\s*/, '');
  if (cleaned === '00' || cleaned === '0' || cleaned === '0.0') {
    return '0';
  }
  if (/^0+[1-9]\d*$/.test(cleaned)) {
    cleaned = cleaned.replace(/^0+/, '');
  }
  return cleaned;
};

/**
 * Canonical extraction of raw revision string from any submittal record or raw object.
 * Maps standard and legacy field aliases ('rev', 'revision', 'revNo') consistently.
 */
export const extractRevisionRaw = (row: unknown): string => {
  if (!row || typeof row !== 'object') return '';
  const r = row as Record<string, unknown>;
  const raw = r.rev ?? r.revision ?? r.revNo ?? '';
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
};

/**
 * Canonical predicate: Determines if a submittal or revision represents Rev00 / Baseline.
 */
export const isRevision0 = (
  rev: string | number | null | undefined,
  isRev0Flag?: boolean
): boolean => {
  if (isRev0Flag === true) return true;
  if (!isValidRevision(rev)) return false;
  const w = getRevisionWeight(rev);
  const val = String(rev).trim().toUpperCase();
  return w === 0 && val !== 'AS-BUILT' && val !== 'ASBUILT' && val !== 'IFC';
};

/**
 * Canonical predicate: Determines if a submittal or revision represents Further Revision (> Rev00).
 * Enforces that blank or invalid revisions can NEVER be classified as Further Revision.
 */
export const isFurtherRevision = (
  rev: string | number | null | undefined,
  isRev0Flag?: boolean
): boolean => {
  if (isRevision0(rev, isRev0Flag)) return false;
  if (!isValidRevision(rev)) return false;
  const w = getRevisionWeight(rev);
  return w > 0;
};

/**
 * Assert Revision Invariant:
 * Guarantees that for any input value, the revision classification is:
 * 1) Mutually exclusive: A value cannot be both Rev0 and Further Revision.
 * 2) Blank/invalid values can NEVER become Rev00 without explicit isRev0 flag.
 * 3) Blank/invalid values can NEVER become Further Revision under any circumstance.
 * 4) Weight, normalization, and validity are strictly synchronized.
 */
export const assertRevisionInvariants = (
  rev: string | number | null | undefined,
  isRev0Flag?: boolean
): void => {
  const valid = isValidRevision(rev);
  const weight = getRevisionWeight(rev);
  const norm = getNormalizedRevision(rev, isRev0Flag);
  const isR0 = isRevision0(rev, isRev0Flag);
  const isFurther = isFurtherRevision(rev, isRev0Flag);

  // Invariant 1: Mutually exclusive
  if (isR0 && isFurther) {
    throw new Error(`Revision invariant violation: '${rev}' cannot be both Rev0 and Further Revision.`);
  }

  // Invariant 2: Invalid values cannot be Further Revision
  if (!valid && isFurther) {
    throw new Error(`Revision invariant violation: Invalid revision '${rev}' cannot be classified as Further Revision.`);
  }

  // Invariant 3: Invalid values cannot be Rev0 unless explicitly flagged
  if (!valid && isR0 && isRev0Flag !== true) {
    throw new Error(`Revision invariant violation: Invalid revision '${rev}' cannot be classified as Rev0 without explicit isRev0 flag.`);
  }

  // Invariant 4: Weight and Validity consistency
  if (!valid && weight !== -1) {
    throw new Error(`Revision invariant violation: Invalid revision '${rev}' must have weight -1, got ${weight}.`);
  }

  // Invariant 5: Normalization consistency
  if (!valid && isRev0Flag !== true && norm !== 'Unknown') {
    throw new Error(`Revision invariant violation: Invalid revision '${rev}' must normalize to 'Unknown', got '${norm}'.`);
  }
};

export type RevisionClassification = 'Rev0' | 'Further Rev' | 'Missing Revision';

/**
 * Canonical helper: Maps any revision to its strict tripartite classification:
 * - 'Rev0': Baseline revision (Rev 00, Rev 0, etc. or explicit isRev0 flag)
 * - 'Further Rev': Revision > Rev 00 (e.g. Rev 01, Rev 1, IFC, etc.)
 * - 'Missing Revision': Blank, null, undefined, or invalid tokens (N/A, NONE, etc.)
 */
export const classifyRevision = (
  rev: string | number | null | undefined,
  isRev0Flag?: boolean
): RevisionClassification => {
  if (isRevision0(rev, isRev0Flag)) return 'Rev0';
  if (isFurtherRevision(rev, isRev0Flag)) return 'Further Rev';
  return 'Missing Revision';
};

/**
 * Sorts any list of items by canonical revision precedence.
 */
export const sortByRevisionPrecedence = <T extends { rev?: string | number | null }>(
  items: T[]
): T[] => {
  return [...items].sort((a, b) => compareRevisionsCanonical(a.rev, b.rev));
};
