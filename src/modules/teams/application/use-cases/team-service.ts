import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import {
  PERMISSION_CODES,
  PERMISSION_SCOPE_TYPES,
  assertAuthorized,
  evaluateAuthorization,
  type AuthorizationActor,
  type ExplicitDenyRuleRepositoryPort,
  type PermissionGrantRepositoryPort,
} from '@/modules/authorization';
import type { OrganizationMemberRepositoryPort } from '@/modules/organizations';
import type { ProjectRepositoryPort } from '@/modules/projects';
import type { UserRepositoryPort } from '@/modules/users';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asTeamId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type TeamId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  asTeamMemberId,
  assertTeamAcceptsMembers,
  type Team,
  type TeamMember,
} from '../../domain/team';
import type { TeamMemberRepositoryPort, TeamRepositoryPort } from '../ports/team-repository.port';

const createTeamInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  managerUserIds: z.array(z.string().uuid()).optional().default([]),
  correlationId: z.string().uuid().optional(),
});

const updateTeamInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.union([z.string().trim().max(500), z.null()]).optional(),
    correlationId: z.string().uuid().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    'At least one field ("name" or "description") must be provided.',
  );

const setTeamManagersInputSchema = z.object({
  managerUserIds: z.array(z.string().uuid()),
  correlationId: z.string().uuid().optional(),
});

export interface TeamServiceDependencies {
  readonly teams: TeamRepositoryPort;
  readonly teamMembers: TeamMemberRepositoryPort;
  readonly projects: ProjectRepositoryPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly users: UserRepositoryPort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface ListTeamsOptions {
  readonly includeArchived?: boolean;
}

export interface CreateTeamInput {
  readonly name: string;
  readonly description?: string;
  readonly managerUserIds?: readonly UserId[];
  readonly correlationId?: CorrelationId;
}

export interface UpdateTeamInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly correlationId?: CorrelationId;
}

export interface TeamMemberDetails extends TeamMember {
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl?: string;
  readonly isManager: boolean;
}

export interface TeamDetails {
  readonly team: Team;
  readonly members: readonly TeamMemberDetails[];
}

export interface TeamOperationOptions {
  readonly reason?: string;
  readonly correlationId?: CorrelationId;
}

function defaultNowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

function defaultUuidGenerator(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

function parseWithZod<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  input: unknown,
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid team input payload.', {
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

function deduplicateUserIds(ids: readonly UserId[]): readonly UserId[] {
  return Array.from(new Set(ids));
}

export class TeamService {
  private readonly deps: TeamServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: TeamServiceDependencies) {
    this.deps = deps;
    this.now = deps.now ?? defaultNowIso;
    this.nextUuid = deps.generateUuid ?? defaultUuidGenerator;
  }

  private resolveCorrelationId(candidate?: string): CorrelationId {
    if (candidate && isUuid(candidate)) {
      return asCorrelationId(candidate);
    }
    return asCorrelationId(this.nextUuid());
  }

  private async buildAuthorizationActor(
    actorUserId: UserId,
    organizationId: OrganizationId,
    now: IsoDateTime,
  ): Promise<AuthorizationActor> {
    const [membership, orgTeams, actorTeamMemberships, grants, explicitDenies] = await Promise.all([
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
      this.deps.teams.listByOrganization(organizationId, {
        includeArchived: true,
        includeDeleted: true,
      }),
      this.deps.teamMembers.listByUser(organizationId, actorUserId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
    ]);

    const managedTeamIds: TeamId[] = orgTeams
      .filter((team) => !isSoftDeleted(team) && team.managerUserIds.includes(actorUserId))
      .map((team) => team.id);

    const memberTeamIds: TeamId[] = actorTeamMemberships
      .filter((tm) => tm.removedAt === undefined)
      .map((tm) => tm.teamId);

    return {
      isAuthenticated: true,
      userId: actorUserId,
      ...(membership !== null
        ? {
            organizationMembership: {
              organizationId: membership.organizationId,
              role: membership.role,
              status: membership.status,
            },
          }
        : {}),
      managedTeamIds,
      memberTeamIds,
      grants,
      explicitDenies,
    };
  }

  async listTeams(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: ListTeamsOptions = {},
  ): Promise<readonly Team[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const actor = await this.buildAuthorizationActor(validatedActorId, validatedOrgId, now);
    if (
      !actor.organizationMembership ||
      actor.organizationMembership.status !== MEMBERSHIP_STATUSES.ACTIVE
    ) {
      throw new AuthorizationError(
        'Actor does not have an active membership in this organization.',
      );
    }

    const teams = await this.deps.teams.listByOrganization(validatedOrgId, {
      includeArchived: options.includeArchived ?? false,
      includeDeleted: false,
    });

    return teams.filter((team) => {
      const decision = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.TEAM_VIEW,
        resource: {
          kind: 'TEAM',
          id: asEntityId(team.id),
          exists: true,
          organizationId: team.organizationId,
          teamId: team.id,
          deletedAt: team.deletedAt,
          archivedAt: team.archivedAt,
        },
        context: { now },
      });
      return decision.allowed;
    });
  }

  async getTeamDetails(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
  ): Promise<TeamDetails> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const now = this.now();

    const [actor, team] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_VIEW,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: team !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: team?.deletedAt,
        archivedAt: team?.archivedAt,
      },
      context: { now },
    });

    if (!team) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`, {
        details: { organizationId: validatedOrgId, teamId: validatedTeamId },
      });
    }

    const rawMembers = await this.deps.teamMembers.listByTeam(validatedOrgId, validatedTeamId);
    const activeMembers = rawMembers.filter((member) => member.removedAt === undefined);
    const users = await this.deps.users.findByIds(activeMembers.map((member) => member.userId));
    const userById = new Map(users.map((user) => [user.id, user]));
    const managerSet = new Set<UserId>(team.managerUserIds);

    const members: TeamMemberDetails[] = activeMembers.map((member) => {
      const user = userById.get(member.userId);
      return {
        ...member,
        displayName: user?.displayName ?? 'Unknown User',
        email: user?.email ?? '',
        ...(user?.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
        isManager: managerSet.has(member.userId),
      };
    });

    return Object.freeze({ team, members });
  }

  async createTeam(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateTeamInput,
  ): Promise<Team> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(createTeamInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const actor = await this.buildAuthorizationActor(validatedActorId, validatedOrgId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_CREATE,
      resource: {
        kind: 'TEAM',
        exists: true,
        organizationId: validatedOrgId,
      },
      context: { now },
    });

    const requestedManagers = parsed.managerUserIds.map((id) => asUserId(id, 'managerUserIds'));
    const initialManagers =
      actor.organizationMembership?.role === ORGANIZATION_ROLES.MANAGER
        ? deduplicateUserIds([validatedActorId, ...requestedManagers])
        : deduplicateUserIds(requestedManagers);

    for (const managerId of initialManagers) {
      const member = await this.deps.organizationMembers.findByOrganizationAndUser(
        validatedOrgId,
        managerId,
      );
      if (!member || member.status !== MEMBERSHIP_STATUSES.ACTIVE) {
        throw new NotFoundError(
          'All initial team managers must be active members of the organization.',
          {
            details: { organizationId: validatedOrgId, managerId },
          },
        );
      }
    }

    const teamId = asTeamId(this.nextUuid());
    const team: Team = {
      id: teamId,
      organizationId: validatedOrgId,
      name: parsed.name,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      managerUserIds: initialManagers,
      createdByUserId: validatedActorId,
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TEAMS,
        TRANSACTION_RESOURCES.TEAM_MEMBERS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.teams.save(team);

        for (const managerId of initialManagers) {
          const teamMember: TeamMember = {
            id: asTeamMemberId(this.nextUuid()),
            organizationId: validatedOrgId,
            teamId,
            userId: managerId,
            joinedAt: now,
          };
          await this.deps.teamMembers.save(teamMember);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.created',
          resourceType: 'Team',
          resourceId: teamId,
          after: {
            id: team.id,
            name: team.name,
            managerUserIds: team.managerUserIds,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Team',
            aggregateId: teamId,
            payload: {
              teamId,
              name: team.name,
            },
          }),
        );
      },
    );

    return team;
  }

  async updateTeam(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    input: UpdateTeamInput,
  ): Promise<Team> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const parsed = parseWithZod(updateTeamInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_UPDATE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    if (isSoftDeleted(existing) || existing.archivedAt !== undefined) {
      throw new ConflictError('Cannot update an archived or deleted team.', {
        details: { teamId: validatedTeamId },
      });
    }

    const { description: _prevDesc, ...existingWithoutDesc } = existing;
    let nextDescription: string | undefined = existing.description;
    if (parsed.description !== undefined) {
      nextDescription =
        parsed.description === null || parsed.description.length === 0
          ? undefined
          : parsed.description;
    }

    const updated: Team = {
      ...existingWithoutDesc,
      name: parsed.name ?? existing.name,
      ...(nextDescription !== undefined ? { description: nextDescription } : {}),
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TEAMS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.teams.save(updated);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.updated',
          resourceType: 'Team',
          resourceId: validatedTeamId,
          before: { name: existing.name, description: existing.description ?? null },
          after: { name: updated.name, description: updated.description ?? null },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Team',
            aggregateId: validatedTeamId,
            payload: {
              teamId: validatedTeamId,
              name: updated.name,
            },
          }),
        );
      },
    );

    return updated;
  }

  async archiveTeam(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    options: TeamOperationOptions = {},
  ): Promise<Team> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_ARCHIVE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    if (existing.archivedAt !== undefined) {
      return existing;
    }

    const archivedTeam: Team = {
      ...existing,
      archivedAt: now,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TEAMS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.teams.save(archivedTeam);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.archived',
          resourceType: 'Team',
          resourceId: validatedTeamId,
          before: { archivedAt: null },
          after: { archivedAt: now },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.archived',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Team',
            aggregateId: validatedTeamId,
            payload: { teamId: validatedTeamId },
          }),
        );
      },
    );

    return archivedTeam;
  }

  async restoreTeam(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    options: TeamOperationOptions = {},
  ): Promise<Team> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_ARCHIVE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    if (existing.archivedAt === undefined) {
      return existing;
    }

    const { archivedAt: _removedArchivedAt, ...rest } = existing;
    const restoredTeam: Team = {
      ...rest,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TEAMS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.teams.save(restoredTeam);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.restored',
          resourceType: 'Team',
          resourceId: validatedTeamId,
          before: { archivedAt: existing.archivedAt },
          after: { archivedAt: null },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.restored',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Team',
            aggregateId: validatedTeamId,
            payload: { teamId: validatedTeamId },
          }),
        );
      },
    );

    return restoredTeam;
  }

  /**
   * Logical deletion of a team (exclusive to ADMIN — ADR-0009 §3.1).
   * Blocks with `ConflictError` if any non-deleted project is still linked to the team.
   * Atomically soft-deletes the team and revokes all TEAM-scoped grants via `revokeAllByScope`.
   */
  async deleteTeam(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    options: TeamOperationOptions = {},
  ): Promise<Team> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_DELETE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    // ADR-0009 §3.1: Referential integrity check against linked projects
    const linkedProjects = await this.deps.projects.listByTeam(validatedOrgId, validatedTeamId);
    const activeLinkedProjects = linkedProjects.filter((project) => !isSoftDeleted(project));
    if (activeLinkedProjects.length > 0) {
      throw new ConflictError(
        'Cannot delete team while non-deleted projects are still linked to it. Transfer or unlink projects first.',
        {
          details: {
            teamId: validatedTeamId,
            linkedProjectCount: activeLinkedProjects.length,
          },
        },
      );
    }

    const deletedTeam: Team = {
      ...existing,
      deletedAt: now,
      deletedBy: validatedActorId,
      ...(options.reason?.trim() ? { deletionReason: options.reason.trim() } : {}),
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TEAMS,
        TRANSACTION_RESOURCES.TEAM_MEMBERS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.teams.save(deletedTeam);

        const revokedGrantsCount = await this.deps.permissionGrants.revokeAllByScope(
          validatedOrgId,
          PERMISSION_SCOPE_TYPES.TEAM,
          asEntityId(validatedTeamId),
          validatedActorId,
          now,
        );

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.deleted',
          resourceType: 'Team',
          resourceId: validatedTeamId,
          before: { deletedAt: null },
          after: {
            deletedAt: now,
            deletionReason: deletedTeam.deletionReason ?? null,
            revokedGrantsCount,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Team',
            aggregateId: validatedTeamId,
            payload: {
              teamId: validatedTeamId,
              revokedGrantsCount,
            },
          }),
        );
      },
    );

    return deletedTeam;
  }

  async addTeamMember(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    targetUserId: UserId,
    options: TeamOperationOptions = {},
  ): Promise<TeamMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, team] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_MEMBERS_MANAGE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: team !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: team?.deletedAt,
        archivedAt: team?.archivedAt,
      },
      context: { now },
    });

    if (!team) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    assertTeamAcceptsMembers(team);

    const orgMembership = await this.deps.organizationMembers.findByOrganizationAndUser(
      validatedOrgId,
      validatedTargetId,
    );
    if (!orgMembership || orgMembership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new NotFoundError('Target user must be an active member of the same organization.', {
        details: { organizationId: validatedOrgId, targetUserId: validatedTargetId },
      });
    }

    const existingTeamMember = await this.deps.teamMembers.findByTeamAndUser(
      validatedOrgId,
      validatedTeamId,
      validatedTargetId,
    );

    if (existingTeamMember && existingTeamMember.removedAt === undefined) {
      throw new ConflictError('User is already an active member of this team.', {
        details: { teamId: validatedTeamId, targetUserId: validatedTargetId },
      });
    }

    const savedMember: TeamMember = {
      id: existingTeamMember?.id ?? asTeamMemberId(this.nextUuid()),
      organizationId: validatedOrgId,
      teamId: validatedTeamId,
      userId: validatedTargetId,
      joinedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.TEAM_MEMBERS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.teamMembers.save(savedMember);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.member.added',
          resourceType: 'TeamMember',
          resourceId: savedMember.id,
          after: {
            teamId: validatedTeamId,
            userId: validatedTargetId,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.member.added',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TeamMember',
            aggregateId: savedMember.id,
            payload: {
              teamId: validatedTeamId,
              userId: validatedTargetId,
            },
          }),
        );
      },
    );

    return savedMember;
  }

  /**
   * Removes a user from a team, strips them from `managerUserIds` if present, and revokes all
   * TEAM-scoped `PermissionGrant`s atomically (ADR-0009 §3.2, permission-matrix.md §11 scenario 7).
   * NEVER modifies `OrganizationMember` or historical authorship.
   */
  async removeTeamMember(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    targetUserId: UserId,
    options: TeamOperationOptions = {},
  ): Promise<TeamMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [actor, team] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_MEMBERS_MANAGE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: team !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: team?.deletedAt,
        archivedAt: team?.archivedAt,
      },
      context: { now },
    });

    if (!team) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    const existingMember = await this.deps.teamMembers.findByTeamAndUser(
      validatedOrgId,
      validatedTeamId,
      validatedTargetId,
    );

    if (!existingMember || existingMember.removedAt !== undefined) {
      throw new NotFoundError('Active team membership was not found for this user.', {
        details: { teamId: validatedTeamId, targetUserId: validatedTargetId },
      });
    }

    const removedMember: TeamMember = {
      ...existingMember,
      removedAt: now,
    };

    const wasManager = team.managerUserIds.includes(validatedTargetId);
    const updatedTeam: Team | null = wasManager
      ? {
          ...team,
          managerUserIds: team.managerUserIds.filter((id) => id !== validatedTargetId),
          updatedAt: now,
        }
      : null;

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TEAMS,
        TRANSACTION_RESOURCES.TEAM_MEMBERS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.teamMembers.save(removedMember);
        if (updatedTeam !== null) {
          await this.deps.teams.save(updatedTeam);
        }

        const revokedGrantsCount = await this.deps.permissionGrants.revokeByScope(
          validatedOrgId,
          validatedTargetId,
          PERMISSION_SCOPE_TYPES.TEAM,
          asEntityId(validatedTeamId),
          validatedActorId,
          now,
        );

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.member.removed',
          resourceType: 'TeamMember',
          resourceId: existingMember.id,
          before: {
            teamId: validatedTeamId,
            userId: validatedTargetId,
            wasManager,
          },
          after: {
            removedAt: now,
            revokedGrantsCount,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.member.removed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'TeamMember',
            aggregateId: existingMember.id,
            payload: {
              teamId: validatedTeamId,
              userId: validatedTargetId,
              revokedGrantsCount,
            },
          }),
        );
      },
    );

    return removedMember;
  }

  async setTeamManagers(
    actorUserId: UserId,
    organizationId: OrganizationId,
    teamId: TeamId,
    managerUserIds: readonly UserId[],
    options: TeamOperationOptions = {},
  ): Promise<Team> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedTeamId = asTeamId(teamId, 'teamId');
    const parsed = parseWithZod(setTeamManagersInputSchema, {
      managerUserIds,
      ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
    });
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [actor, team] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.teams.findById(validatedOrgId, validatedTeamId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.TEAM_UPDATE,
      resource: {
        kind: 'TEAM',
        id: asEntityId(validatedTeamId),
        exists: team !== null,
        organizationId: validatedOrgId,
        teamId: validatedTeamId,
        deletedAt: team?.deletedAt,
        archivedAt: team?.archivedAt,
      },
      context: { now },
    });

    if (!team) {
      throw new NotFoundError(`Team "${validatedTeamId}" was not found.`);
    }

    if (isSoftDeleted(team) || team.archivedAt !== undefined) {
      throw new ConflictError('Cannot change managers of an archived or deleted team.', {
        details: { teamId: validatedTeamId },
      });
    }

    const nextManagers = deduplicateUserIds(
      parsed.managerUserIds.map((id) => asUserId(id, 'managerUserIds')),
    );

    const isActorManager = actor.organizationMembership?.role === ORGANIZATION_ROLES.MANAGER;
    if (isActorManager && !nextManagers.includes(validatedActorId)) {
      throw new AuthorizationError(
        'A team MANAGER cannot strip their own management scope from the team.',
      );
    }

    for (const candidateId of nextManagers) {
      const orgMember = await this.deps.organizationMembers.findByOrganizationAndUser(
        validatedOrgId,
        candidateId,
      );
      if (!orgMember || orgMember.status !== MEMBERSHIP_STATUSES.ACTIVE) {
        throw new NotFoundError('All team managers must be active members of the organization.', {
          details: { organizationId: validatedOrgId, candidateId },
        });
      }

      if (isActorManager && orgMember.role === ORGANIZATION_ROLES.ADMIN) {
        const wasAlreadyManager = team.managerUserIds.includes(candidateId);
        if (!wasAlreadyManager) {
          throw new AuthorizationError(
            'MANAGER cannot assign authority above their own organizational role.',
            {
              details: { candidateId },
            },
          );
        }
      }
    }

    const updatedTeam: Team = {
      ...team,
      managerUserIds: nextManagers,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.TEAMS,
        TRANSACTION_RESOURCES.TEAM_MEMBERS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.teams.save(updatedTeam);

        for (const managerId of nextManagers) {
          const existingMember = await this.deps.teamMembers.findByTeamAndUser(
            validatedOrgId,
            validatedTeamId,
            managerId,
          );
          if (!existingMember || existingMember.removedAt !== undefined) {
            await this.deps.teamMembers.save({
              id: existingMember?.id ?? asTeamMemberId(this.nextUuid()),
              organizationId: validatedOrgId,
              teamId: validatedTeamId,
              userId: managerId,
              joinedAt: now,
            });
          }
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'team.managers.updated',
          resourceType: 'Team',
          resourceId: validatedTeamId,
          before: { managerUserIds: team.managerUserIds },
          after: { managerUserIds: updatedTeam.managerUserIds },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'team.managers.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Team',
            aggregateId: validatedTeamId,
            payload: {
              teamId: validatedTeamId,
              managerUserIds: updatedTeam.managerUserIds,
            },
          }),
        );
      },
    );

    return updatedTeam;
  }
}
