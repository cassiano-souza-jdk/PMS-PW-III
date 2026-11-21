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
import type { Task, TaskParticipantRepositoryPort, TaskRepositoryPort } from '@/modules/tasks';
import type { UserRepositoryPort } from '@/modules/users';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TASK_STATUSES,
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEntityId,
  asEventId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTeamId,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type ProjectId,
  type TeamId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import {
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  asProjectMemberId,
  assertParticipantRemovalHandled,
  assertProjectOperational,
  type Project,
  type ProjectMember,
  type ProjectMemberRole,
} from '../../domain/project';
import type {
  BoardColumnExportSummary,
  ProjectBoardExportResult,
  ProjectBoardExportSummary,
  ProjectBoardInitializerPort,
  ProjectTeamLookupPort,
} from '../ports/project-context.port';
import type {
  ProjectMemberRepositoryPort,
  ProjectRepositoryPort,
} from '../ports/project-repository.port';

const createProjectInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  teamId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  inactivityThresholdDays: z.number().int().min(1).default(7),
  correlationId: z.string().uuid().optional(),
});

const updateProjectInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.union([z.string().trim().max(500), z.null()]).optional(),
    inactivityThresholdDays: z.number().int().min(1).optional(),
    ownerUserId: z.string().uuid().optional(),
    correlationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.inactivityThresholdDays !== undefined ||
      data.ownerUserId !== undefined,
    'At least one updatable field ("name", "description", "inactivityThresholdDays", or "ownerUserId") must be provided.',
  );

const transferProjectTeamInputSchema = z.object({
  targetTeamId: z.union([z.string().uuid(), z.null()]),
  reason: z.string().trim().max(500).optional(),
  correlationId: z.string().uuid().optional(),
});

const projectMemberRoleSchema = z.enum([
  PROJECT_MEMBER_ROLES.MANAGER,
  PROJECT_MEMBER_ROLES.PARTICIPANT,
]);

export interface ProjectServiceDependencies {
  readonly projects: ProjectRepositoryPort;
  readonly projectMembers: ProjectMemberRepositoryPort;
  readonly tasks: TaskRepositoryPort;
  readonly taskParticipants: TaskParticipantRepositoryPort;
  readonly organizationMembers: OrganizationMemberRepositoryPort;
  readonly users: UserRepositoryPort;
  readonly permissionGrants: PermissionGrantRepositoryPort;
  readonly explicitDenyRules: ExplicitDenyRuleRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly teamLookup: ProjectTeamLookupPort;
  readonly boardInitializer: ProjectBoardInitializerPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface ListProjectsOptions {
  readonly includeArchived?: boolean;
}

export interface ProjectListItem extends Project {
  readonly teamName?: string;
  readonly ownerName: string;
  readonly participantCount: number;
  readonly myProjectRole?: ProjectMemberRole;
}

export interface ProjectOwnerSummary {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: string;
}

export interface ProjectParticipantDetails extends ProjectMember {
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl?: string;
}

export interface ProjectDetails {
  readonly project: Project;
  readonly teamName?: string;
  readonly owner: ProjectOwnerSummary;
  readonly members: readonly ProjectParticipantDetails[];
  readonly activeParticipantCount: number;
}

export interface CreateProjectInput {
  readonly id?: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly teamId?: TeamId;
  readonly ownerUserId?: UserId;
  readonly inactivityThresholdDays?: number;
  readonly correlationId?: CorrelationId;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly inactivityThresholdDays?: number;
  readonly ownerUserId?: UserId;
  readonly correlationId?: CorrelationId;
}

export interface TransferProjectTeamInput {
  readonly targetTeamId: TeamId | null;
  readonly reason?: string;
  readonly correlationId?: CorrelationId;
}

export interface ProjectOperationOptions {
  readonly reason?: string;
  readonly correlationId?: CorrelationId;
}

export interface ProjectExportParticipant {
  readonly id: ProjectMember['id'];
  readonly userId: UserId;
  readonly projectRole: ProjectMemberRole;
  readonly joinedAt: IsoDateTime;
  readonly displayName: string;
  readonly email: string;
}

export interface ProjectExportData {
  readonly exportedAt: IsoDateTime;
  readonly organizationId: OrganizationId;
  readonly project: Project;
  readonly teamName?: string;
  readonly participants: readonly ProjectExportParticipant[];
  readonly board?: ProjectBoardExportSummary;
  readonly columns: readonly BoardColumnExportSummary[];
  readonly tasks: readonly Task[];
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
    throw new ValidationError('Invalid project input payload.', {
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

export class ProjectService {
  private readonly deps: ProjectServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: ProjectServiceDependencies) {
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
  ): Promise<{
    readonly actor: AuthorizationActor;
    readonly activeProjectMemberships: readonly ProjectMember[];
  }> {
    const [
      membership,
      managedTeamIds,
      orgProjects,
      actorProjectMemberships,
      grants,
      explicitDenies,
    ] = await Promise.all([
      this.deps.organizationMembers.findByOrganizationAndUser(organizationId, actorUserId),
      this.deps.teamLookup.listManagedTeamIds(organizationId, actorUserId),
      this.deps.projects.listByOrganization(organizationId, {
        includeArchived: true,
        includeDeleted: true,
      }),
      this.deps.projectMembers.listByUser(organizationId, actorUserId),
      this.deps.permissionGrants.listActiveByGrantee(organizationId, actorUserId, now),
      this.deps.explicitDenyRules.listActiveByTargetUser(organizationId, actorUserId, now),
    ]);

    const activeProjectIdSet = new Set(
      orgProjects.filter((project) => !isSoftDeleted(project)).map((project) => project.id),
    );

    const activeProjectMemberships = actorProjectMemberships.filter(
      (member) => member.removedAt === undefined && activeProjectIdSet.has(member.projectId),
    );

    const managedProjectIds: ProjectId[] = activeProjectMemberships
      .filter((member) => member.projectRole === PROJECT_MEMBER_ROLES.MANAGER)
      .map((member) => member.projectId);

    const participatedProjectIds: ProjectId[] = activeProjectMemberships.map(
      (member) => member.projectId,
    );

    const actor: AuthorizationActor = {
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
      managedProjectIds,
      participatedProjectIds,
      grants,
      explicitDenies,
    };

    return { actor, activeProjectMemberships };
  }

  async listProjects(
    actorUserId: UserId,
    organizationId: OrganizationId,
    options: ListProjectsOptions = {},
  ): Promise<readonly ProjectListItem[]> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const now = this.now();

    const { actor, activeProjectMemberships } = await this.buildAuthorizationActor(
      validatedActorId,
      validatedOrgId,
      now,
    );

    if (
      !actor.organizationMembership ||
      actor.organizationMembership.status !== MEMBERSHIP_STATUSES.ACTIVE
    ) {
      assertAuthorized({
        actor,
        action: PERMISSION_CODES.ORGANIZATION_VIEW,
        resource: {
          kind: 'ORGANIZATION',
          id: asEntityId(validatedOrgId),
          exists: true,
          organizationId: validatedOrgId,
        },
        context: { now },
      });
      throw new AuthorizationError(
        'Actor does not have an active membership in this organization.',
      );
    }

    const projects = await this.deps.projects.listByOrganization(validatedOrgId, {
      includeArchived: options.includeArchived ?? false,
      includeDeleted: false,
    });

    if (projects.length === 0) {
      return [];
    }

    const visibleProjects = projects.filter((project) => {
      const decision = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.PROJECT_VIEW,
        resource: {
          kind: 'PROJECT',
          id: asEntityId(project.id),
          exists: true,
          organizationId: project.organizationId,
          projectId: project.id,
          teamId: project.teamId,
          ownerUserId: project.ownerUserId,
          deletedAt: project.deletedAt,
          archivedAt: project.archivedAt,
        },
        context: { now },
      });
      return decision.allowed;
    });

    if (visibleProjects.length === 0) {
      return [];
    }

    const [teams, owners, memberCounts] = await Promise.all([
      this.deps.teamLookup.listTeamsForOrganization(validatedOrgId),
      this.deps.users.findByIds(
        Array.from(new Set(visibleProjects.map((project) => project.ownerUserId))),
      ),
      Promise.all(
        visibleProjects.map(async (project) => {
          const members = await this.deps.projectMembers.listByProject(validatedOrgId, project.id);
          return [
            project.id,
            members.filter((member) => member.removedAt === undefined).length,
          ] as const;
        }),
      ),
    ]);

    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
    const ownerNameById = new Map(owners.map((user) => [user.id, user.displayName]));
    const participantCountByProjectId = new Map(memberCounts);
    const myRoleByProjectId = new Map(
      activeProjectMemberships.map((member) => [member.projectId, member.projectRole]),
    );

    return visibleProjects.map((project) => {
      const teamName = project.teamId !== undefined ? teamNameById.get(project.teamId) : undefined;
      const myProjectRole = myRoleByProjectId.get(project.id);

      return {
        ...project,
        ...(teamName !== undefined ? { teamName } : {}),
        ownerName: ownerNameById.get(project.ownerUserId) ?? 'Unknown User',
        participantCount: participantCountByProjectId.get(project.id) ?? 0,
        ...(myProjectRole !== undefined ? { myProjectRole } : {}),
      };
    });
  }

  async getProjectDetails(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<ProjectDetails> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();

    const [{ actor }, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_VIEW,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
      },
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    const [rawMembers, teamSummary] = await Promise.all([
      this.deps.projectMembers.listByProject(validatedOrgId, validatedProjectId),
      project.teamId !== undefined
        ? this.deps.teamLookup.findTeamById(validatedOrgId, project.teamId)
        : Promise.resolve(null),
    ]);

    const activeMembers = rawMembers.filter((member) => member.removedAt === undefined);
    const userIdsToLoad = Array.from(
      new Set([project.ownerUserId, ...activeMembers.map((member) => member.userId)]),
    );
    const users = await this.deps.users.findByIds(userIdsToLoad);
    const userById = new Map(users.map((user) => [user.id, user]));

    const ownerUser = userById.get(project.ownerUserId);
    const members: ProjectParticipantDetails[] = activeMembers.map((member) => {
      const user = userById.get(member.userId);
      return {
        ...member,
        displayName: user?.displayName ?? 'Unknown User',
        email: user?.email ?? '',
        ...(user?.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
      };
    });

    return Object.freeze({
      project,
      ...(teamSummary !== null && teamSummary.deletedAt === undefined
        ? { teamName: teamSummary.name }
        : {}),
      owner: Object.freeze({
        userId: project.ownerUserId,
        displayName: ownerUser?.displayName ?? 'Unknown User',
        email: ownerUser?.email ?? '',
      }),
      members,
      activeParticipantCount: members.length,
    });
  }

  async createProject(
    actorUserId: UserId,
    organizationId: OrganizationId,
    input: CreateProjectInput,
  ): Promise<Project> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const parsed = parseWithZod(createProjectInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const targetTeamId =
      parsed.teamId !== undefined ? asTeamId(parsed.teamId, 'teamId') : undefined;

    const { actor } = await this.buildAuthorizationActor(validatedActorId, validatedOrgId, now);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_CREATE,
      resource: {
        kind: 'PROJECT',
        exists: true,
        organizationId: validatedOrgId,
        ...(targetTeamId !== undefined ? { teamId: targetTeamId } : {}),
      },
      context: { now },
    });

    const actorRole = actor.organizationMembership?.role;

    if (targetTeamId !== undefined) {
      if (
        actorRole === ORGANIZATION_ROLES.MANAGER &&
        !actor.managedTeamIds?.includes(targetTeamId)
      ) {
        throw new AuthorizationError(
          'MANAGER cannot create a project associated with an unmanaged team.',
          {
            details: { teamId: targetTeamId },
          },
        );
      }

      const teamSummary = await this.deps.teamLookup.findTeamById(validatedOrgId, targetTeamId);
      if (!teamSummary || teamSummary.deletedAt !== undefined) {
        throw new NotFoundError(`Team "${targetTeamId}" was not found in this organization.`, {
          details: { organizationId: validatedOrgId, teamId: targetTeamId },
        });
      }

      if (teamSummary.archivedAt !== undefined) {
        throw new ConflictError('Cannot associate a new project with an archived team.', {
          details: { teamId: targetTeamId },
        });
      }
    }

    const resolvedOwnerId =
      parsed.ownerUserId !== undefined
        ? asUserId(parsed.ownerUserId, 'ownerUserId')
        : validatedActorId;

    const ownerMembership = await this.deps.organizationMembers.findByOrganizationAndUser(
      validatedOrgId,
      resolvedOwnerId,
    );
    if (!ownerMembership || ownerMembership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new NotFoundError('Project owner must be an active member of the organization.', {
        details: { organizationId: validatedOrgId, ownerUserId: resolvedOwnerId },
      });
    }

    if (
      actorRole === ORGANIZATION_ROLES.MANAGER &&
      resolvedOwnerId !== validatedActorId &&
      ownerMembership.role === ORGANIZATION_ROLES.ADMIN
    ) {
      throw new AuthorizationError(
        'MANAGER cannot assign project ownership to an organization ADMIN.',
        {
          details: { ownerUserId: resolvedOwnerId },
        },
      );
    }

    const projectId =
      parsed.id !== undefined
        ? asProjectId(parsed.id, 'id')
        : asProjectId(this.nextUuid(), 'projectId');

    const existingProject = await this.deps.projects.findById(validatedOrgId, projectId);
    if (existingProject !== null) {
      throw new ConflictError(`Project "${projectId}" already exists in this organization.`, {
        details: { projectId },
      });
    }

    const newProject: Project = {
      id: projectId,
      organizationId: validatedOrgId,
      ...(targetTeamId !== undefined ? { teamId: targetTeamId } : {}),
      name: parsed.name,
      ...(parsed.description !== undefined && parsed.description.length > 0
        ? { description: parsed.description }
        : {}),
      status: PROJECT_STATUSES.ACTIVE,
      ownerUserId: resolvedOwnerId,
      inactivityThresholdDays: parsed.inactivityThresholdDays,
      createdByUserId: validatedActorId,
      createdAt: now,
      updatedAt: now,
    };

    const initialManagerIds =
      actorRole === ORGANIZATION_ROLES.MANAGER && resolvedOwnerId !== validatedActorId
        ? [resolvedOwnerId, validatedActorId]
        : [resolvedOwnerId];

    const initialMembers: ProjectMember[] = initialManagerIds.map((userId) => ({
      id: asProjectMemberId(this.nextUuid()),
      organizationId: validatedOrgId,
      projectId: newProject.id,
      userId,
      projectRole: PROJECT_MEMBER_ROLES.MANAGER,
      joinedAt: now,
    }));

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.PROJECTS,
        TRANSACTION_RESOURCES.PROJECT_MEMBERS,
        TRANSACTION_RESOURCES.PROJECT_BOARDS,
        TRANSACTION_RESOURCES.BOARD_COLUMNS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.projects.save(newProject);
        await this.deps.projectMembers.saveMany(validatedOrgId, initialMembers);

        await this.deps.boardInitializer.initializePrimaryBoard({
          organizationId: validatedOrgId,
          projectId: newProject.id,
          now,
          nextUuid: () => this.nextUuid(),
        });

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: newProject.id,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.created',
          resourceType: 'Project',
          resourceId: newProject.id,
          after: {
            id: newProject.id,
            name: newProject.name,
            status: newProject.status,
            ownerUserId: newProject.ownerUserId,
            ...(newProject.teamId !== undefined ? { teamId: newProject.teamId } : {}),
            inactivityThresholdDays: newProject.inactivityThresholdDays,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.created',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Project',
            aggregateId: newProject.id,
            payload: {
              projectId: newProject.id,
              name: newProject.name,
            },
          }),
        );
      },
    );

    return newProject;
  }

  async updateProject(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    input: UpdateProjectInput,
  ): Promise<Project> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const parsed = parseWithZod(updateProjectInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const [{ actor }, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_UPDATE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: existing?.teamId,
        ownerUserId: existing?.ownerUserId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    assertProjectOperational(existing);

    const nextOwnerId =
      parsed.ownerUserId !== undefined
        ? asUserId(parsed.ownerUserId, 'ownerUserId')
        : existing.ownerUserId;

    let ownerMemberToSave: ProjectMember | null = null;
    if (nextOwnerId !== existing.ownerUserId) {
      const newOwnerOrgMember = await this.deps.organizationMembers.findByOrganizationAndUser(
        validatedOrgId,
        nextOwnerId,
      );
      if (!newOwnerOrgMember || newOwnerOrgMember.status !== MEMBERSHIP_STATUSES.ACTIVE) {
        throw new NotFoundError('New project owner must be an active member of the organization.', {
          details: { organizationId: validatedOrgId, ownerUserId: nextOwnerId },
        });
      }

      if (
        actor.organizationMembership?.role === ORGANIZATION_ROLES.MANAGER &&
        newOwnerOrgMember.role === ORGANIZATION_ROLES.ADMIN
      ) {
        throw new AuthorizationError(
          'MANAGER cannot transfer project ownership to an organization ADMIN.',
          {
            details: { ownerUserId: nextOwnerId },
          },
        );
      }

      const existingOwnerMember = await this.deps.projectMembers.findByProjectAndUser(
        validatedOrgId,
        validatedProjectId,
        nextOwnerId,
      );

      if (
        existingOwnerMember === null ||
        existingOwnerMember.removedAt !== undefined ||
        existingOwnerMember.projectRole !== PROJECT_MEMBER_ROLES.MANAGER
      ) {
        ownerMemberToSave = {
          id: existingOwnerMember?.id ?? asProjectMemberId(this.nextUuid()),
          organizationId: validatedOrgId,
          projectId: validatedProjectId,
          userId: nextOwnerId,
          projectRole: PROJECT_MEMBER_ROLES.MANAGER,
          joinedAt:
            existingOwnerMember !== null && existingOwnerMember.removedAt === undefined
              ? existingOwnerMember.joinedAt
              : now,
        };
      }
    }

    const { description: _prevDescription, ...existingWithoutDescription } = existing;
    let nextDescription = existing.description;
    if (parsed.description !== undefined) {
      nextDescription =
        parsed.description === null || parsed.description.length === 0
          ? undefined
          : parsed.description;
    }

    const updatedProject: Project = {
      ...existingWithoutDescription,
      name: parsed.name ?? existing.name,
      ...(nextDescription !== undefined ? { description: nextDescription } : {}),
      inactivityThresholdDays: parsed.inactivityThresholdDays ?? existing.inactivityThresholdDays,
      ownerUserId: nextOwnerId,
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.PROJECTS,
        TRANSACTION_RESOURCES.PROJECT_MEMBERS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.projects.save(updatedProject);
        if (ownerMemberToSave !== null) {
          await this.deps.projectMembers.save(ownerMemberToSave);
        }

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.updated',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          before: {
            name: existing.name,
            description: existing.description ?? null,
            inactivityThresholdDays: existing.inactivityThresholdDays,
            ownerUserId: existing.ownerUserId,
          },
          after: {
            name: updatedProject.name,
            description: updatedProject.description ?? null,
            inactivityThresholdDays: updatedProject.inactivityThresholdDays,
            ownerUserId: updatedProject.ownerUserId,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Project',
            aggregateId: validatedProjectId,
            payload: {
              projectId: validatedProjectId,
              name: updatedProject.name,
              ownerUserId: updatedProject.ownerUserId,
            },
          }),
        );
      },
    );

    return updatedProject;
  }

  async transferProjectTeam(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    input: TransferProjectTeamInput,
  ): Promise<Project> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const parsed = parseWithZod(transferProjectTeamInputSchema, input);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(parsed.correlationId);

    const validatedTargetTeamId =
      parsed.targetTeamId !== null ? asTeamId(parsed.targetTeamId, 'targetTeamId') : null;

    const [{ actor }, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    if (
      validatedTargetTeamId === null &&
      actor.organizationMembership?.role === ORGANIZATION_ROLES.MANAGER
    ) {
      throw new AuthorizationError('MANAGER cannot unlink a project from all teams.', {
        details: { projectId: validatedProjectId },
      });
    }

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_TRANSFER,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: existing?.teamId,
        targetTeamId: validatedTargetTeamId ?? undefined,
        ownerUserId: existing?.ownerUserId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`, {
        details: { organizationId: validatedOrgId, projectId: validatedProjectId },
      });
    }

    assertProjectOperational(existing);

    if (validatedTargetTeamId !== null) {
      const targetTeam = await this.deps.teamLookup.findTeamById(
        validatedOrgId,
        validatedTargetTeamId,
      );
      if (!targetTeam || targetTeam.deletedAt !== undefined) {
        throw new NotFoundError(
          `Target team "${validatedTargetTeamId}" was not found in this organization.`,
          {
            details: { organizationId: validatedOrgId, targetTeamId: validatedTargetTeamId },
          },
        );
      }

      if (targetTeam.archivedAt !== undefined) {
        throw new ConflictError('Cannot transfer project to an archived team.', {
          details: { targetTeamId: validatedTargetTeamId },
        });
      }
    }

    const { teamId: _previousTeamId, ...existingWithoutTeam } = existing;
    const transferredProject: Project = {
      ...existingWithoutTeam,
      ...(validatedTargetTeamId !== null ? { teamId: validatedTargetTeamId } : {}),
      updatedAt: now,
    };

    const trimmedReason = parsed.reason?.trim();

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PROJECTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.projects.save(transferredProject);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.team_transferred',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          before: { teamId: existing.teamId ?? null },
          after: { teamId: transferredProject.teamId ?? null },
          ...(trimmedReason && trimmedReason.length > 0 ? { justification: trimmedReason } : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.team_transferred',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Project',
            aggregateId: validatedProjectId,
            payload: {
              projectId: validatedProjectId,
              previousTeamId: existing.teamId ?? null,
              targetTeamId: transferredProject.teamId ?? null,
            },
          }),
        );
      },
    );

    return transferredProject;
  }

  async archiveProject(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: ProjectOperationOptions = {},
  ): Promise<Project> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_ARCHIVE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: existing?.teamId,
        ownerUserId: existing?.ownerUserId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    if (existing.status === PROJECT_STATUSES.ARCHIVED || existing.archivedAt !== undefined) {
      throw new ConflictError('Project is already archived.', {
        details: { projectId: validatedProjectId },
      });
    }

    const archivedProject: Project = {
      ...existing,
      status: PROJECT_STATUSES.ARCHIVED,
      archivedAt: now,
      updatedAt: now,
    };

    const trimmedReason = options.reason?.trim();

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PROJECTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.projects.save(archivedProject);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.archived',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          before: { status: existing.status, archivedAt: null },
          after: { status: archivedProject.status, archivedAt: now },
          ...(trimmedReason && trimmedReason.length > 0 ? { justification: trimmedReason } : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.archived',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Project',
            aggregateId: validatedProjectId,
            payload: { projectId: validatedProjectId },
          }),
        );
      },
    );

    return archivedProject;
  }

  async restoreProject(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: ProjectOperationOptions = {},
  ): Promise<Project> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_RESTORE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: existing?.teamId,
        ownerUserId: existing?.ownerUserId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    if (existing.status !== PROJECT_STATUSES.ARCHIVED && existing.archivedAt === undefined) {
      throw new ConflictError('Project is already active.', {
        details: { projectId: validatedProjectId },
      });
    }

    const { archivedAt: _removedArchivedAt, ...rest } = existing;
    const restoredProject: Project = {
      ...rest,
      status: PROJECT_STATUSES.ACTIVE,
      updatedAt: now,
    };

    const trimmedReason = options.reason?.trim();

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PROJECTS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.projects.save(restoredProject);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.restored',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          before: { status: existing.status, archivedAt: existing.archivedAt ?? null },
          after: { status: restoredProject.status, archivedAt: null },
          ...(trimmedReason && trimmedReason.length > 0 ? { justification: trimmedReason } : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.restored',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Project',
            aggregateId: validatedProjectId,
            payload: { projectId: validatedProjectId },
          }),
        );
      },
    );

    return restoredProject;
  }

  async deleteProject(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: ProjectOperationOptions = {},
  ): Promise<Project> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, existing] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_DELETE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: existing !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: existing?.teamId,
        ownerUserId: existing?.ownerUserId,
        deletedAt: existing?.deletedAt,
        archivedAt: existing?.archivedAt,
      },
      context: { now },
    });

    if (!existing) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    const trimmedReason = options.reason?.trim();
    const deletedProject: Project = {
      ...existing,
      deletedAt: now,
      deletedBy: validatedActorId,
      ...(trimmedReason && trimmedReason.length > 0 ? { deletionReason: trimmedReason } : {}),
      updatedAt: now,
    };

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.PROJECTS,
        TRANSACTION_RESOURCES.PROJECT_MEMBERS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.projects.save(deletedProject);

        const rawMembers = await this.deps.projectMembers.listByProject(
          validatedOrgId,
          validatedProjectId,
        );
        const activeMembers = rawMembers.filter((member) => member.removedAt === undefined);
        if (activeMembers.length > 0) {
          await this.deps.projectMembers.saveMany(
            validatedOrgId,
            activeMembers.map((member) => ({
              ...member,
              removedAt: now,
            })),
          );
        }

        const revokedGrantsCount = await this.deps.permissionGrants.revokeAllByScope(
          validatedOrgId,
          PERMISSION_SCOPE_TYPES.PROJECT,
          asEntityId(validatedProjectId),
          validatedActorId,
          now,
        );

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.deleted',
          resourceType: 'Project',
          resourceId: validatedProjectId,
          before: { deletedAt: null },
          after: {
            deletedAt: now,
            deletionReason: deletedProject.deletionReason ?? null,
            removedMembersCount: activeMembers.length,
            revokedGrantsCount,
          },
          ...(trimmedReason && trimmedReason.length > 0 ? { justification: trimmedReason } : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.deleted',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'Project',
            aggregateId: validatedProjectId,
            payload: {
              projectId: validatedProjectId,
              revokedGrantsCount,
            },
          }),
        );
      },
    );

    return deletedProject;
  }

  async addProjectParticipant(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole = PROJECT_MEMBER_ROLES.PARTICIPANT,
    options: ProjectOperationOptions = {},
  ): Promise<ProjectMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const validatedRole = parseWithZod(projectMemberRoleSchema, role);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_MEMBERS_MANAGE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
      },
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    const targetMembership = await this.deps.organizationMembers.findByOrganizationAndUser(
      validatedOrgId,
      validatedTargetId,
    );
    if (!targetMembership || targetMembership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
      throw new NotFoundError('Target user must be an active member of the same organization.', {
        details: { organizationId: validatedOrgId, targetUserId: validatedTargetId },
      });
    }

    const existing = await this.deps.projectMembers.findByProjectAndUser(
      validatedOrgId,
      validatedProjectId,
      validatedTargetId,
    );

    if (existing !== null && existing.removedAt === undefined) {
      throw new ConflictError('User is already an active participant of this project.', {
        details: { projectId: validatedProjectId, targetUserId: validatedTargetId },
      });
    }

    // ADR-0010 §2.4: Reuse existing.id when reactivating a previously removed participant
    const savedMember: ProjectMember = {
      id: existing?.id ?? asProjectMemberId(this.nextUuid()),
      organizationId: validatedOrgId,
      projectId: validatedProjectId,
      userId: validatedTargetId,
      projectRole: validatedRole,
      joinedAt: now,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PROJECT_MEMBERS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.projectMembers.save(savedMember);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.member.added',
          resourceType: 'ProjectMember',
          resourceId: savedMember.id,
          after: {
            projectId: validatedProjectId,
            userId: validatedTargetId,
            projectRole: validatedRole,
            reactivated: existing !== null,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.member.added',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'ProjectMember',
            aggregateId: savedMember.id,
            payload: {
              projectId: validatedProjectId,
              userId: validatedTargetId,
              projectRole: validatedRole,
            },
          }),
        );
      },
    );

    return savedMember;
  }

  async updateProjectParticipantRole(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
    options: ProjectOperationOptions = {},
  ): Promise<ProjectMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const validatedRole = parseWithZod(projectMemberRoleSchema, role);
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_MEMBERS_MANAGE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
      },
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    const [allMembers, targetOrgMembership] = await Promise.all([
      this.deps.projectMembers.listByProject(validatedOrgId, validatedProjectId),
      this.deps.organizationMembers.findByOrganizationAndUser(validatedOrgId, validatedTargetId),
    ]);

    const existing = allMembers.find(
      (member) => member.userId === validatedTargetId && member.removedAt === undefined,
    );

    if (!existing) {
      throw new NotFoundError('Active project participant was not found.', {
        details: { projectId: validatedProjectId, targetUserId: validatedTargetId },
      });
    }

    if (
      project.ownerUserId === validatedTargetId &&
      validatedRole !== PROJECT_MEMBER_ROLES.MANAGER
    ) {
      throw new ConflictError(
        'Cannot demote the current project owner from MANAGER role. Transfer project ownership first.',
        {
          details: { projectId: validatedProjectId, ownerUserId: project.ownerUserId },
        },
      );
    }

    if (actor.organizationMembership?.role === ORGANIZATION_ROLES.MANAGER) {
      if (
        targetOrgMembership?.role === ORGANIZATION_ROLES.ADMIN &&
        validatedRole !== existing.projectRole
      ) {
        throw new AuthorizationError(
          'MANAGER cannot alter the project role of an organization ADMIN.',
          {
            details: { targetUserId: validatedTargetId },
          },
        );
      }

      if (
        validatedTargetId === validatedActorId &&
        validatedRole !== PROJECT_MEMBER_ROLES.MANAGER
      ) {
        throw new AuthorizationError('MANAGER cannot demote their own project management role.');
      }
    }

    if (
      existing.projectRole === PROJECT_MEMBER_ROLES.MANAGER &&
      validatedRole !== PROJECT_MEMBER_ROLES.MANAGER
    ) {
      const remainingActiveManagers = allMembers.filter(
        (member) =>
          member.removedAt === undefined &&
          member.projectRole === PROJECT_MEMBER_ROLES.MANAGER &&
          member.userId !== validatedTargetId,
      );
      if (remainingActiveManagers.length === 0) {
        throw new ConflictError('Cannot demote the last active MANAGER of the project.', {
          details: { projectId: validatedProjectId, targetUserId: validatedTargetId },
        });
      }
    }

    const updatedMember: ProjectMember = {
      ...existing,
      projectRole: validatedRole,
    };

    await this.deps.transactionPort.run(
      [TRANSACTION_RESOURCES.PROJECT_MEMBERS, TRANSACTION_RESOURCES.AUDIT_EVENTS],
      async () => {
        await this.deps.projectMembers.save(updatedMember);

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.member.role_updated',
          resourceType: 'ProjectMember',
          resourceId: existing.id,
          before: { projectRole: existing.projectRole },
          after: { projectRole: validatedRole },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.member.role_updated',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'ProjectMember',
            aggregateId: existing.id,
            payload: {
              projectId: validatedProjectId,
              userId: validatedTargetId,
              projectRole: validatedRole,
            },
          }),
        );
      },
    );

    return updatedMember;
  }

  async removeProjectParticipant(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetUserId: UserId,
    options: ProjectOperationOptions = {},
  ): Promise<ProjectMember> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const validatedTargetId = asUserId(targetUserId, 'targetUserId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_MEMBERS_MANAGE,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
      },
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    assertProjectOperational(project);

    const allMembers = await this.deps.projectMembers.listByProject(
      validatedOrgId,
      validatedProjectId,
    );
    const existing = allMembers.find(
      (member) => member.userId === validatedTargetId && member.removedAt === undefined,
    );

    if (!existing) {
      throw new NotFoundError('Active project participant was not found.', {
        details: { projectId: validatedProjectId, targetUserId: validatedTargetId },
      });
    }

    if (project.ownerUserId === validatedTargetId) {
      throw new ConflictError(
        'Cannot remove the current project owner. Transfer project ownership first.',
        {
          details: { projectId: validatedProjectId, ownerUserId: project.ownerUserId },
        },
      );
    }

    if (existing.projectRole === PROJECT_MEMBER_ROLES.MANAGER) {
      const remainingActiveManagers = allMembers.filter(
        (member) =>
          member.removedAt === undefined &&
          member.projectRole === PROJECT_MEMBER_ROLES.MANAGER &&
          member.userId !== validatedTargetId,
      );
      if (remainingActiveManagers.length === 0) {
        throw new ConflictError('Cannot remove the last active MANAGER of the project.', {
          details: { projectId: validatedProjectId, targetUserId: validatedTargetId },
        });
      }
    }

    const [projectTasks, userTaskParticipations] = await Promise.all([
      this.deps.tasks.listByProject(validatedOrgId, validatedProjectId),
      this.deps.taskParticipants.listByUser(validatedOrgId, validatedTargetId),
    ]);

    const activeParticipatedTaskIds = new Set(
      userTaskParticipations
        .filter((participation) => participation.removedAt === undefined)
        .map((participation) => participation.taskId),
    );

    const pendingTaskCount = projectTasks.filter(
      (task) =>
        task.status !== TASK_STATUSES.DONE &&
        task.status !== TASK_STATUSES.CANCELLED &&
        (task.assigneeId === validatedTargetId || activeParticipatedTaskIds.has(task.id)),
    ).length;

    assertParticipantRemovalHandled(pendingTaskCount);

    const removedMember: ProjectMember = {
      ...existing,
      removedAt: now,
    };

    const trimmedReason = options.reason?.trim();

    await this.deps.transactionPort.run(
      [
        TRANSACTION_RESOURCES.PROJECT_MEMBERS,
        TRANSACTION_RESOURCES.PERMISSION_GRANTS,
        TRANSACTION_RESOURCES.AUDIT_EVENTS,
      ],
      async () => {
        await this.deps.projectMembers.save(removedMember);

        const revokedGrantsCount = await this.deps.permissionGrants.revokeByScope(
          validatedOrgId,
          validatedTargetId,
          PERMISSION_SCOPE_TYPES.PROJECT,
          asEntityId(validatedProjectId),
          validatedActorId,
          now,
        );

        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          projectId: validatedProjectId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.PROJECT,
          eventType: 'project.member.removed',
          resourceType: 'ProjectMember',
          resourceId: existing.id,
          before: {
            projectId: validatedProjectId,
            userId: validatedTargetId,
            projectRole: existing.projectRole,
          },
          after: {
            removedAt: now,
            revokedGrantsCount,
          },
          ...(trimmedReason && trimmedReason.length > 0 ? { justification: trimmedReason } : {}),
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);

        await this.deps.eventBus.publish(
          createDomainEvent({
            eventId: asEventId(this.nextUuid()),
            eventType: 'project.member.removed',
            occurredAt: now,
            organizationId: validatedOrgId,
            actorId: validatedActorId,
            correlationId,
            aggregateType: 'ProjectMember',
            aggregateId: existing.id,
            payload: {
              projectId: validatedProjectId,
              userId: validatedTargetId,
              revokedGrantsCount,
            },
          }),
        );
      },
    );

    return removedMember;
  }

  async exportProjectData(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: ProjectOperationOptions = {},
  ): Promise<ProjectExportData> {
    const validatedActorId = asUserId(actorUserId, 'actorUserId');
    const validatedOrgId = asOrganizationId(organizationId, 'organizationId');
    const validatedProjectId = asProjectId(projectId, 'projectId');
    const now = this.now();
    const correlationId = this.resolveCorrelationId(options.correlationId);

    const [{ actor }, project] = await Promise.all([
      this.buildAuthorizationActor(validatedActorId, validatedOrgId, now),
      this.deps.projects.findById(validatedOrgId, validatedProjectId),
    ]);

    assertAuthorized({
      actor,
      action: PERMISSION_CODES.PROJECT_VIEW,
      resource: {
        kind: 'PROJECT',
        id: asEntityId(validatedProjectId),
        exists: project !== null,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project?.teamId,
        ownerUserId: project?.ownerUserId,
        deletedAt: project?.deletedAt,
        archivedAt: project?.archivedAt,
      },
      context: { now },
    });

    if (!project) {
      throw new NotFoundError(`Project "${validatedProjectId}" was not found.`);
    }

    const boardViewDecision = evaluateAuthorization({
      actor,
      action: PERMISSION_CODES.BOARD_VIEW,
      resource: {
        kind: 'BOARD',
        id: asEntityId(validatedProjectId),
        exists: true,
        organizationId: validatedOrgId,
        projectId: validatedProjectId,
        teamId: project.teamId,
        ownerUserId: project.ownerUserId,
        deletedAt: project.deletedAt,
        archivedAt: project.archivedAt,
        projectArchivedAt: project.archivedAt,
      },
      context: { now },
    });

    const [rawMembers, projectTasks, teamSummary, boardExport] = await Promise.all([
      this.deps.projectMembers.listByProject(validatedOrgId, validatedProjectId),
      this.deps.tasks.listByProject(validatedOrgId, validatedProjectId),
      project.teamId !== undefined
        ? this.deps.teamLookup.findTeamById(validatedOrgId, project.teamId)
        : Promise.resolve(null),
      boardViewDecision.allowed && this.deps.boardInitializer.findPrimaryBoardForExport
        ? this.deps.boardInitializer.findPrimaryBoardForExport(validatedOrgId, validatedProjectId)
        : Promise.resolve<ProjectBoardExportResult>({ columns: [] }),
    ]);

    const activeMembers = rawMembers.filter((member) => member.removedAt === undefined);
    const users = await this.deps.users.findByIds(activeMembers.map((member) => member.userId));
    const userById = new Map(users.map((user) => [user.id, user]));

    const participants: ProjectExportParticipant[] = activeMembers.map((member) => {
      const user = userById.get(member.userId);
      return {
        id: member.id,
        userId: member.userId,
        projectRole: member.projectRole,
        joinedAt: member.joinedAt,
        displayName: user?.displayName ?? 'Unknown User',
        email: user?.email ?? '',
      };
    });

    const taskParticipantsList = await Promise.all(
      projectTasks.map((task) => this.deps.taskParticipants.listByTask(validatedOrgId, task.id)),
    );

    const visibleTasks = projectTasks.filter((task, index) => {
      const participations = taskParticipantsList[index] ?? [];
      const participantIds = participations
        .filter((participation) => participation.removedAt === undefined)
        .map((participation) => participation.userId);

      const decision = evaluateAuthorization({
        actor,
        action: PERMISSION_CODES.TASK_VIEW,
        resource: {
          kind: 'TASK',
          id: asEntityId(task.id),
          exists: true,
          organizationId: validatedOrgId,
          projectId: validatedProjectId,
          teamId: project.teamId,
          ownerUserId: project.ownerUserId,
          taskId: task.id,
          createdBy: task.createdByUserId,
          assigneeId: task.assigneeId,
          participantIds,
          deletedAt: task.deletedAt,
          projectArchivedAt: project.archivedAt,
        },
        context: { now },
      });

      return decision.allowed;
    });

    await this.deps.transactionPort.run([TRANSACTION_RESOURCES.AUDIT_EVENTS], async () => {
      const auditEvent: AuditEvent = {
        id: asAuditEventId(this.nextUuid()),
        organizationId: validatedOrgId,
        actorId: validatedActorId,
        projectId: validatedProjectId,
        occurredAt: now,
        category: AUDIT_CATEGORIES.EXPORT,
        eventType: 'project.exported',
        resourceType: 'Project',
        resourceId: validatedProjectId,
        after: {
          projectId: validatedProjectId,
          participantCount: participants.length,
          exportedTaskCount: visibleTasks.length,
        },
        result: AUDIT_RESULTS.SUCCESS,
        correlationId,
      };
      await this.deps.auditEvents.append(auditEvent);

      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'project.exported',
          occurredAt: now,
          organizationId: validatedOrgId,
          actorId: validatedActorId,
          correlationId,
          aggregateType: 'Project',
          aggregateId: validatedProjectId,
          payload: {
            projectId: validatedProjectId,
            exportedTaskCount: visibleTasks.length,
          },
        }),
      );
    });

    return Object.freeze({
      exportedAt: now,
      organizationId: validatedOrgId,
      project,
      ...(teamSummary !== null && teamSummary.deletedAt === undefined
        ? { teamName: teamSummary.name }
        : {}),
      participants,
      ...(boardExport.board !== undefined ? { board: boardExport.board } : {}),
      columns: boardExport.columns,
      tasks: visibleTasks,
    });
  }
}
