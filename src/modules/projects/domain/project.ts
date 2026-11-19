import { ConflictError, ValidationError } from '@/shared/errors';
import {
  isSoftDeleted,
  parseBrandedUuid,
  type AuditableTimestamps,
  type Brand,
  type IsoDateTime,
  type OrganizationScoped,
  type ProjectId,
  type SoftDeletable,
  type TeamId,
  type UserId,
} from '@/shared/kernel';

export type ProjectMemberId = Brand<string, 'ProjectMemberId'>;

export function asProjectMemberId(value: string, fieldName = 'projectMemberId'): ProjectMemberId {
  return parseBrandedUuid<'ProjectMemberId'>(value, fieldName);
}

export const PROJECT_STATUSES = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[keyof typeof PROJECT_STATUSES];

export const PROJECT_MEMBER_ROLES = {
  MANAGER: 'MANAGER',
  PARTICIPANT: 'PARTICIPANT',
} as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[keyof typeof PROJECT_MEMBER_ROLES];

export interface Project extends OrganizationScoped, AuditableTimestamps, SoftDeletable {
  readonly id: ProjectId;
  readonly teamId?: TeamId;
  readonly name: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly ownerUserId: UserId;
  readonly inactivityThresholdDays: number;
  readonly archivedAt?: IsoDateTime;
  readonly createdByUserId: UserId;
}

export interface ProjectMember extends OrganizationScoped {
  readonly id: ProjectMemberId;
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly projectRole: ProjectMemberRole;
  readonly joinedAt: IsoDateTime;
  readonly removedAt?: IsoDateTime;
}

/**
 * Archived or logically deleted projects reject new operational mutations (PRD.md §8 / permission-matrix.md §11).
 */
export function assertProjectOperational(project: Project): void {
  if (isSoftDeleted(project)) {
    throw new ConflictError('Cannot execute operational actions on a deleted project.', {
      details: { projectId: project.id },
    });
  }

  if (project.status === PROJECT_STATUSES.ARCHIVED || project.archivedAt !== undefined) {
    throw new ConflictError('Cannot execute operational actions on an archived project.', {
      details: { projectId: project.id },
    });
  }
}

/**
 * Removing a project participant requires handling all pending responsibilities first (PRD.md §8).
 */
export function assertParticipantRemovalHandled(pendingTaskCount: number): void {
  if (!Number.isInteger(pendingTaskCount) || pendingTaskCount < 0) {
    throw new ValidationError('Parameter "pendingTaskCount" must be an integer >= 0.', {
      details: { field: 'pendingTaskCount' },
    });
  }

  if (pendingTaskCount > 0) {
    throw new ConflictError(
      'Cannot remove project participant while pending task responsibilities remain unhandled.',
      {
        details: { pendingTaskCount },
      },
    );
  }
}
