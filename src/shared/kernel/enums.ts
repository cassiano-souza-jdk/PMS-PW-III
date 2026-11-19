export const ORGANIZATION_ROLES = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
} as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[keyof typeof ORGANIZATION_ROLES];

export const MEMBERSHIP_STATUSES = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REMOVED: 'REMOVED',
} as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[keyof typeof MEMBERSHIP_STATUSES];

export const PRIORITIES = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type Priority = (typeof PRIORITIES)[keyof typeof PRIORITIES];

export const IMPEDIMENT_SEVERITIES = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type ImpedimentSeverity = (typeof IMPEDIMENT_SEVERITIES)[keyof typeof IMPEDIMENT_SEVERITIES];

export const BOTTLENECK_SEVERITIES = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type BottleneckSeverity = (typeof BOTTLENECK_SEVERITIES)[keyof typeof BOTTLENECK_SEVERITIES];

export const TASK_STATUSES = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  PAUSED: 'PAUSED',
  BLOCKED: 'BLOCKED',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];

export const EXPORT_FORMATS = {
  CSV: 'CSV',
  PDF: 'PDF',
  XLSX: 'XLSX',
  JSON: 'JSON',
} as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[keyof typeof EXPORT_FORMATS];

const ORGANIZATION_ROLE_SET: ReadonlySet<string> = new Set(Object.values(ORGANIZATION_ROLES));
const MEMBERSHIP_STATUS_SET: ReadonlySet<string> = new Set(Object.values(MEMBERSHIP_STATUSES));
const PRIORITY_SET: ReadonlySet<string> = new Set(Object.values(PRIORITIES));
const IMPEDIMENT_SEVERITY_SET: ReadonlySet<string> = new Set(Object.values(IMPEDIMENT_SEVERITIES));
const BOTTLENECK_SEVERITY_SET: ReadonlySet<string> = new Set(Object.values(BOTTLENECK_SEVERITIES));
const TASK_STATUS_SET: ReadonlySet<string> = new Set(Object.values(TASK_STATUSES));
const EXPORT_FORMAT_SET: ReadonlySet<string> = new Set(Object.values(EXPORT_FORMATS));

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && ORGANIZATION_ROLE_SET.has(value);
}

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && MEMBERSHIP_STATUS_SET.has(value);
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && PRIORITY_SET.has(value);
}

export function isImpedimentSeverity(value: unknown): value is ImpedimentSeverity {
  return typeof value === 'string' && IMPEDIMENT_SEVERITY_SET.has(value);
}

export function isBottleneckSeverity(value: unknown): value is BottleneckSeverity {
  return typeof value === 'string' && BOTTLENECK_SEVERITY_SET.has(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUS_SET.has(value);
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && EXPORT_FORMAT_SET.has(value);
}
