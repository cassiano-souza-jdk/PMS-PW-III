import type { PermissionResourceOverrides } from '@/app/providers';
import {
  PERMISSION_CODES,
  type AuthorizationDecision,
  type AuthorizationPolicyConfig,
  type PermissionCode,
} from '@/modules/authorization';
import type { Impediment } from '@/modules/impediments';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { ProjectDetails } from '@/modules/projects';
import type { TaskDetail } from '@/modules/tasks';
import type { TaskDetailPermissions, TaskUserOption } from '@/modules/tasks/presentation';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';
import {
  ORGANIZATION_ROLES,
  asEntityId,
  isSoftDeleted,
  type OrganizationRole,
  type ProjectId,
  type UserId,
} from '@/shared/kernel';

export type PermissionChecker = (
  permission: PermissionCode,
  resourceOverrides?: PermissionResourceOverrides,
  policyConfig?: Partial<AuthorizationPolicyConfig>,
) => boolean;

export type PermissionEvaluator = (
  permission: PermissionCode,
  resourceOverrides?: PermissionResourceOverrides,
  policyConfig?: Partial<AuthorizationPolicyConfig>,
) => AuthorizationDecision;

export function resolveTaskPageErrorMessageId(error: unknown): MessageId {
  return isAppError(error) ? getErrorMessageId(error.code) : 'errors.UNEXPECTED_ERROR';
}

export function buildTaskUsersDirectory(input: {
  readonly currentUser: TaskUserOption;
  readonly orgMembers: readonly OrganizationMemberDetails[];
  readonly projectDetails: ProjectDetails | null;
}): {
  readonly projectMembers: readonly TaskUserOption[];
  readonly usersById: ReadonlyMap<UserId, TaskUserOption>;
} {
  const usersById = new Map<UserId, TaskUserOption>();
  const projectMemberMap = new Map<UserId, TaskUserOption>();

  usersById.set(input.currentUser.userId, input.currentUser);

  for (const member of input.orgMembers) {
    const option: TaskUserOption = {
      userId: member.userId,
      displayName: member.displayName,
      email: member.email,
    };
    usersById.set(member.userId, option);
  }

  if (input.projectDetails !== null) {
    const ownerOption: TaskUserOption = {
      userId: input.projectDetails.owner.userId,
      displayName: input.projectDetails.owner.displayName,
      email: input.projectDetails.owner.email,
    };
    usersById.set(ownerOption.userId, ownerOption);
    projectMemberMap.set(ownerOption.userId, ownerOption);

    for (const member of input.projectDetails.members) {
      const option: TaskUserOption = {
        userId: member.userId,
        displayName: member.displayName,
        email: member.email,
      };
      usersById.set(option.userId, option);
      projectMemberMap.set(option.userId, option);
    }
  }

  if (projectMemberMap.size === 0) {
    for (const member of input.orgMembers) {
      if (member.status === 'ACTIVE') {
        projectMemberMap.set(member.userId, {
          userId: member.userId,
          displayName: member.displayName,
          email: member.email,
        });
      }
    }
  }

  const projectMembers = Array.from(projectMemberMap.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  return {
    projectMembers,
    usersById,
  };
}

export function buildProjectAbacResource(project: {
  readonly id: ProjectId;
  readonly organizationId: TaskDetail['project']['organizationId'];
  readonly teamId?: TaskDetail['project']['teamId'];
  readonly ownerUserId: UserId;
  readonly deletedAt?: TaskDetail['project']['deletedAt'];
  readonly archivedAt?: TaskDetail['project']['archivedAt'];
}): PermissionResourceOverrides {
  return {
    kind: 'PROJECT',
    id: asEntityId(project.id),
    exists: true,
    organizationId: project.organizationId,
    projectId: project.id,
    teamId: project.teamId,
    ownerUserId: project.ownerUserId,
    deletedAt: project.deletedAt,
    archivedAt: project.archivedAt,
    projectArchivedAt: project.archivedAt,
  };
}

export function buildTaskBaseAbacResource(detail: TaskDetail): PermissionResourceOverrides {
  const activeParticipantIds = detail.participants
    .filter((participant) => participant.removedAt === undefined)
    .map((participant) => participant.userId);

  return {
    kind: 'TASK',
    id: asEntityId(detail.task.id),
    exists: true,
    organizationId: detail.task.organizationId,
    projectId: detail.project.id,
    teamId: detail.project.teamId,
    ownerUserId: detail.project.ownerUserId,
    taskId: detail.task.id,
    createdBy: detail.task.createdByUserId,
    assigneeId: detail.task.assigneeId,
    participantIds: activeParticipantIds,
    deletedAt: detail.task.deletedAt ?? detail.project.deletedAt,
    archivedAt: detail.project.archivedAt,
    projectArchivedAt: detail.project.archivedAt,
  };
}

export function buildTaskDetailCapabilities(input: {
  readonly detail: TaskDetail;
  readonly actorRole: OrganizationRole;
  readonly managedProjectIds: readonly ProjectId[];
  readonly impediments: readonly Impediment[];
  readonly can: PermissionChecker;
  readonly policyConfig: AuthorizationPolicyConfig;
}): {
  readonly permissions: TaskDetailPermissions;
  readonly canViewDependencies: boolean;
  readonly canViewImpediments: boolean;
  readonly canCreateImpediment: boolean;
  readonly canResolveByImpedimentId: Readonly<Record<string, boolean>>;
} {
  const { detail, actorRole, managedProjectIds, impediments, can, policyConfig } = input;
  const baseResource = buildTaskBaseAbacResource(detail);
  const taskEffectiveDeletedAt = detail.task.deletedAt ?? detail.project.deletedAt;

  const canCompleteBySubtaskId: Record<string, boolean> = {};
  for (const subtask of detail.subtasks) {
    canCompleteBySubtaskId[subtask.id] = can(
      PERMISSION_CODES.SUBTASK_COMPLETE,
      {
        ...baseResource,
        kind: 'SUBTASK',
        id: asEntityId(subtask.id),
        subtaskId: subtask.id,
        subtaskAssigneeId: subtask.assigneeId,
        deletedAt: taskEffectiveDeletedAt,
      },
      policyConfig,
    );
  }

  const canComment = can(PERMISSION_CODES.TASK_COMMENT, baseResource, policyConfig);
  const canModerateComments =
    canComment &&
    (actorRole === ORGANIZATION_ROLES.ADMIN ||
      (actorRole === ORGANIZATION_ROLES.MANAGER && managedProjectIds.includes(detail.project.id)));

  const permissions: TaskDetailPermissions = {
    canViewBoard: can(
      PERMISSION_CODES.BOARD_VIEW,
      {
        ...baseResource,
        kind: 'BOARD',
        id: asEntityId(detail.project.id),
      },
      policyConfig,
    ),
    canEditCoreFields: can(
      PERMISSION_CODES.TASK_UPDATE,
      {
        ...baseResource,
        requestedFields: ['title', 'description'],
      },
      policyConfig,
    ),
    canEditPriority: can(
      PERMISSION_CODES.TASK_UPDATE,
      {
        ...baseResource,
        requestedFields: ['priority'],
      },
      policyConfig,
    ),
    canEditDueDate: can(
      PERMISSION_CODES.TASK_UPDATE,
      {
        ...baseResource,
        requestedFields: ['dueDate'],
      },
      policyConfig,
    ),
    canEditTags: can(
      PERMISSION_CODES.TASK_UPDATE,
      {
        ...baseResource,
        requestedFields: ['tags'],
      },
      policyConfig,
    ),
    canAssignTask: can(PERMISSION_CODES.TASK_ASSIGN, baseResource, policyConfig),
    canManageParticipants: can(
      PERMISSION_CODES.TASK_PARTICIPANTS_MANAGE,
      baseResource,
      policyConfig,
    ),
    canStartTask: can(PERMISSION_CODES.TASK_START, baseResource, policyConfig),
    canPauseTask: can(PERMISSION_CODES.TASK_PAUSE, baseResource, policyConfig),
    canCompleteTask: can(PERMISSION_CODES.TASK_COMPLETE, baseResource, policyConfig),
    canCancelTask: can(PERMISSION_CODES.TASK_CANCEL, baseResource, policyConfig),
    canReopenTask: can(PERMISSION_CODES.TASK_REOPEN, baseResource, policyConfig),
    canDeleteTask: can(PERMISSION_CODES.TASK_CANCEL, baseResource, policyConfig),
    canRestoreTask: can(
      PERMISSION_CODES.TRASH_RESTORE,
      {
        ...baseResource,
        kind: 'TRASH',
      },
      policyConfig,
    ),
    canManageSubtasks: can(
      PERMISSION_CODES.SUBTASK_MANAGE,
      {
        ...baseResource,
        kind: 'SUBTASK',
      },
      policyConfig,
    ),
    canAssignSubtasks: can(
      PERMISSION_CODES.SUBTASK_ASSIGN,
      {
        ...baseResource,
        kind: 'SUBTASK',
      },
      policyConfig,
    ),
    canCompleteBySubtaskId,
    canComment,
    canModerateComments,
    canManageAttachments: can(PERMISSION_CODES.TASK_ATTACHMENT_MANAGE, baseResource, policyConfig),
    canViewHistory: can(
      isSoftDeleted(detail.task) && !isSoftDeleted(detail.project)
        ? PERMISSION_CODES.TRASH_VIEW
        : PERMISSION_CODES.TASK_HISTORY_VIEW,
      baseResource,
      policyConfig,
    ),
    canManageDependencies: can(
      PERMISSION_CODES.DEPENDENCY_MANAGE,
      {
        ...baseResource,
        kind: 'DEPENDENCY',
      },
      policyConfig,
    ),
  };

  const canViewDependencies = can(
    PERMISSION_CODES.DEPENDENCY_VIEW,
    {
      ...baseResource,
      kind: 'DEPENDENCY',
      relatedTasksAccessible: true,
    },
    policyConfig,
  );

  const canViewImpediments = can(
    PERMISSION_CODES.IMPEDIMENT_VIEW,
    {
      ...baseResource,
      kind: 'IMPEDIMENT',
    },
    policyConfig,
  );

  const canCreateImpediment = can(
    PERMISSION_CODES.IMPEDIMENT_CREATE,
    {
      ...baseResource,
      kind: 'IMPEDIMENT',
    },
    policyConfig,
  );

  const canResolveByImpedimentId: Record<string, boolean> = {};
  for (const impediment of impediments) {
    canResolveByImpedimentId[impediment.id] = can(
      PERMISSION_CODES.IMPEDIMENT_RESOLVE,
      {
        ...baseResource,
        kind: 'IMPEDIMENT',
        id: asEntityId(impediment.id),
        createdBy: impediment.openedByUserId,
      },
      policyConfig,
    );
  }

  return {
    permissions,
    canViewDependencies,
    canViewImpediments,
    canCreateImpediment,
    canResolveByImpedimentId,
  };
}
