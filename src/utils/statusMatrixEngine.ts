import { SubmittalRow, ProjectSettings } from '../types';
import { isEntityOverdue } from '../analytics/slaEngine';
import { getStatusCategory as getCanonicalStatusCategory } from '../analytics/statusResolver';

export interface StatusMapConfig {
  open: string[];
  closed: string[];
  rejected: string[];
}

export const DEFAULT_STATUS_MAP: StatusMapConfig = {
  open: ['DRAFT', 'SUBMITTED', 'UNDER REVIEW', 'PENDING', 'PENDING RESPONSE', 'W', 'WAITING', 'PEND', 'OPEN', 'CODE W'],
  closed: ['APPROVED', 'ACCEPTED', 'CLOSED', 'A', 'B', 'CODE A', 'CODE B', 'APPROVED WITH COMMENTS', 'CLOSED WITH COMMENTS'],
  rejected: ['REJECTED', 'RETURNED', 'C', 'CODE C', 'REJ', 'RETURNED WITH COMMENTS']
};

export const getProjectStatusMap = (projectId: string): StatusMapConfig => {
  if (!projectId) return DEFAULT_STATUS_MAP;
  const saved = localStorage.getItem(`statusMap_${projectId}`);
  return saved ? JSON.parse(saved) : DEFAULT_STATUS_MAP;
};

export const saveProjectStatusMap = (projectId: string, map: StatusMapConfig) => {
  localStorage.setItem(`statusMap_${projectId}`, JSON.stringify(map));
};

export type NormalizedStatus = 'OPEN' | 'CLOSED' | 'REJECTED' | 'OVERDUE' | 'UNKNOWN';

export const getStatusCategory = getCanonicalStatusCategory;

export const getNormalizedStatus = (
  row: SubmittalRow,
  projectId: string,
  projectSettings?: ProjectSettings | null,
  contextAsOfDate?: string
): NormalizedStatus => {
  const isOverdue = checkIfOverdueDynamically(row, projectSettings, contextAsOfDate);
  
  const rawStatus = (row.status || '').trim().toUpperCase();
  if (!rawStatus) {
    return isOverdue ? 'OVERDUE' : 'UNKNOWN';
  }
  
  const config = getProjectStatusMap(projectId);
  const category = getCanonicalStatusCategory(rawStatus, config);
  if (category === 'CLOSED') return 'CLOSED';
  if (category === 'REJECTED') return 'REJECTED';
  if (category === 'OPEN') return isOverdue ? 'OVERDUE' : 'OPEN';
  return 'UNKNOWN';
};

export const checkIfOverdueDynamically = (
  row: SubmittalRow,
  projectSettings?: ProjectSettings | null,
  contextAsOfDate?: string
): boolean => {
  return isEntityOverdue(row, contextAsOfDate, projectSettings);
};
