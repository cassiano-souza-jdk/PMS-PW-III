import { AUDIT_CATEGORIES, AUDIT_RESULTS } from '@/modules/audit';
import {
  PERMISSION_SCOPE_TYPES,
  type AuthorizationAuditEntry,
  type AuthorizationAuditWriterPort,
  type AuthorizationContextLookupPort,
} from '@/modules/authorization';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import {
  MEMBERSHIP_STATUSES,
  asAuditEventId,
  asFeedbackId,
  asProjectId,
  asTaskId,
  asTeamId,
  isSoftDeleted,
  type EntityId,
  type OrganizationId,
  type ProjectId,
  type TeamId,
  type UserId,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';

function defaultUuidGenerator(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

/**
 * Thin composition-layer adapter bridging `AuthorizationContextLookupPort` to domain repositories
 * without breaking the leaf-module invariant of `src/modules/authorization/**` (ADR-0009 §1.3).
 */
export function createAuthorizationContextLookupAdapter(
  repositories: AppRepositoriesRegistry,
): AuthorizationContextLookupPort {
  return {
    async getOrganizationMembership(organizationId: OrganizationId, userId: UserId) {
      const member = await repositories.organizations.organizationMembers.findByOrganizationAndUser(
        organizationId,
        userId,
      );
      if (!member) {
        return null;
      }

      return {
        organizationId: member.organizationId,
        role: member.role,
        status: member.status,
      };
    },

    async getActorScopeSummary(organizationId: OrganizationId, userId: UserId) {
      const [orgTeams, userTeamMemberships, userProjectMemberships] = await Promise.all([
        repositories.teams.teams.listByOrganization(organizationId, {
          includeArchived: true,
          includeDeleted: false,
        }),
        repositories.teams.teamMembers.listByUser(organizationId, userId),
        repositories.projects.projectMembers.listByUser(organizationId, userId),
      ]);

      const managedTeamIds: TeamId[] = orgTeams
        .filter((team) => !isSoftDeleted(team) && team.managerUserIds.includes(userId))
        .map((team) => team.id);

      const memberTeamIds: TeamId[] = userTeamMemberships
        .filter((member) => member.removedAt === undefined)
        .map((member) => member.teamId);

      const activeProjectMemberships = userProjectMemberships.filter(
        (member) => member.removedAt === undefined,
      );

      const managedProjectIds: ProjectId[] = activeProjectMemberships
        .filter((member) => member.projectRole === PROJECT_MEMBER_ROLES.MANAGER)
        .map((member) => member.projectId);

      const participatedProjectIds: ProjectId[] = activeProjectMemberships.map(
        (member) => member.projectId,
      );

      return {
        managedTeamIds,
        memberTeamIds,
        managedProjectIds,
        participatedProjectIds,
      };
    },

    async isActiveOrganizationMember(organizationId: OrganizationId, userId: UserId) {
      const member = await repositories.organizations.organizationMembers.findByOrganizationAndUser(
        organizationId,
        userId,
      );
      return member !== null && member.status === MEMBERSHIP_STATUSES.ACTIVE;
    },

    async scopeExistsInOrganization(
      organizationId: OrganizationId,
      scopeType,
      scopeId?: EntityId,
    ): Promise<boolean> {
      if (scopeType === PERMISSION_SCOPE_TYPES.ORGANIZATION) {
        const org = await repositories.organizations.organizations.findById(organizationId);
        return org !== null && !isSoftDeleted(org);
      }

      if (scopeId === undefined) {
        return false;
      }

      if (scopeType === PERMISSION_SCOPE_TYPES.TEAM) {
        const team = await repositories.teams.teams.findById(
          organizationId,
          asTeamId(scopeId, 'scopeId'),
        );
        return team !== null && !isSoftDeleted(team);
      }

      if (scopeType === PERMISSION_SCOPE_TYPES.PROJECT) {
        const project = await repositories.projects.projects.findById(
          organizationId,
          asProjectId(scopeId, 'scopeId'),
        );
        return project !== null && !isSoftDeleted(project);
      }

      // RESOURCE scope: check canonical entity stores scoped by organizationId
      const [task, project, team, feedback] = await Promise.all([
        repositories.tasks.tasks
          .findById(organizationId, asTaskId(scopeId, 'scopeId'))
          .catch(() => null),
        repositories.projects.projects
          .findById(organizationId, asProjectId(scopeId, 'scopeId'))
          .catch(() => null),
        repositories.teams.teams
          .findById(organizationId, asTeamId(scopeId, 'scopeId'))
          .catch(() => null),
        repositories.feedback.feedbacks
          .findById(organizationId, asFeedbackId(scopeId, 'scopeId'))
          .catch(() => null),
      ]);

      return (
        (task !== null && !isSoftDeleted(task)) ||
        (project !== null && !isSoftDeleted(project)) ||
        (team !== null && !isSoftDeleted(team)) ||
        feedback !== null
      );
    },
  };
}

/**
 * Thin composition-layer adapter bridging `AuthorizationAuditWriterPort` to `AuditEventRepositoryPort`
 * inside active Dexie transactions (ADR-0009 §1.3).
 */
export function createAuthorizationAuditWriterAdapter(
  repositories: AppRepositoriesRegistry,
  generateUuid: () => string = defaultUuidGenerator,
): AuthorizationAuditWriterPort {
  return {
    async appendAuthorizationAuditEvent(entry: AuthorizationAuditEntry): Promise<void> {
      await repositories.audit.auditEvents.append({
        id: asAuditEventId(generateUuid()),
        organizationId: entry.organizationId,
        actorId: entry.actorId,
        occurredAt: entry.occurredAt,
        category: AUDIT_CATEGORIES.PERMISSIONS,
        eventType: entry.eventType,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
        result: AUDIT_RESULTS.SUCCESS,
        correlationId: entry.correlationId,
      });
    },
  };
}
