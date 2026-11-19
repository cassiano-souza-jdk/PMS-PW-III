import type {
  AuditEventId,
  CorrelationId,
  EventActorId,
  IsoDateTime,
  OrganizationScoped,
  ProjectId,
} from '@/shared/kernel';

export const AUDIT_RESULTS = {
  SUCCESS: 'SUCCESS',
  DENIED: 'DENIED',
  FAILURE: 'FAILURE',
} as const;

export type AuditResult = (typeof AUDIT_RESULTS)[keyof typeof AUDIT_RESULTS];

export const AUDIT_CATEGORIES = {
  AUTH: 'AUTH',
  ORGANIZATION: 'ORGANIZATION',
  PERMISSIONS: 'PERMISSIONS',
  PROJECT: 'PROJECT',
  KANBAN: 'KANBAN',
  TASK: 'TASK',
  FEEDBACK: 'FEEDBACK',
  BACKUP: 'BACKUP',
  EXPORT: 'EXPORT',
  DEMO_MAINTENANCE: 'DEMO_MAINTENANCE',
  SYSTEM: 'SYSTEM',
} as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[keyof typeof AUDIT_CATEGORIES];

/**
 * Append-only logical audit event (PRD.md §17, DOMAIN.md).
 * `before` and `after` snapshots must be sanitized and never contain passwords, tokens or secrets.
 */
export interface AuditEvent extends OrganizationScoped {
  readonly id: AuditEventId;
  readonly actorId: EventActorId;
  readonly projectId?: ProjectId;
  readonly occurredAt: IsoDateTime;
  readonly category: AuditCategory;
  readonly eventType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly result: AuditResult;
  readonly justification?: string;
  readonly correlationId: CorrelationId;
}
