import type {
  CorrelationId,
  EntityId,
  IsoDateTime,
  OrganizationId,
  ProjectId,
  TeamId,
  UserId,
} from '@/shared/kernel';
import type { PermissionScopeType } from '../../domain/grants';
import type { ActorOrganizationMembership } from '../../domain/policy-engine';

export interface AuthorizationScopeSummary {
  readonly managedTeamIds: readonly TeamId[];
  readonly memberTeamIds: readonly TeamId[];
  readonly managedProjectIds: readonly ProjectId[];
  readonly participatedProjectIds: readonly ProjectId[];
}

/**
 * Local read-only context lookup port allowing `AuthorizationManagementService` to stay inside
 * the leaf module `authorization` without importing other `src/modules/*` modules (ADR-0009 §1).
 */
export interface AuthorizationContextLookupPort {
  getOrganizationMembership(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<ActorOrganizationMembership | null>;

  getActorScopeSummary(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<AuthorizationScopeSummary>;

  isActiveOrganizationMember(organizationId: OrganizationId, userId: UserId): Promise<boolean>;

  scopeExistsInOrganization(
    organizationId: OrganizationId,
    scopeType: PermissionScopeType,
    scopeId?: EntityId,
  ): Promise<boolean>;
}

export interface AuthorizationAuditEntry {
  readonly organizationId: OrganizationId;
  readonly actorId: UserId;
  readonly occurredAt: IsoDateTime;
  readonly eventType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
  readonly correlationId: CorrelationId;
}

/**
 * Local audit writer port allowing `AuthorizationManagementService` to append `AuditEvent` records
 * inside active Dexie transactions while preserving `authorization` as a leaf module (ADR-0009 §1).
 */
export interface AuthorizationAuditWriterPort {
  appendAuthorizationAuditEvent(entry: AuthorizationAuditEntry): Promise<void>;
}
