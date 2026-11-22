import {
  APP_ERROR_CODES,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  isIsoDateTime,
  isOrganizationRole,
  type EntityId,
  type FeedbackId,
  type GrantId,
  type IsoDateTime,
  type MembershipStatus,
  type OrganizationId,
  type OrganizationRole,
  type ProjectId,
  type SubtaskId,
  type TaskId,
  type TeamId,
  type UserId,
} from '@/shared/kernel';
import {
  PERMISSION_SCOPE_TYPES,
  isDenyRuleActiveAt,
  isGrantActiveAt,
  isPermissionScopeType,
  type DenyRuleId,
  type ExplicitDenyRule,
  type PermissionGrant,
  type PermissionScopeType,
} from './grants';
import {
  ADMIN_ONLY_PERMISSIONS,
  AUDITABLE_PERMISSIONS,
  DEMO_MAINTENANCE_PERMISSIONS,
  MANAGER_DELEGABLE_PERMISSIONS,
  OPERATIONAL_MUTATION_PERMISSIONS,
  PERMISSION_CODES,
  TRASH_PERMISSIONS,
  isPermissionCode,
  type PermissionCode,
} from './permission-codes';

export type AuthorizationResourceKind =
  | 'ORGANIZATION'
  | 'INVITATION'
  | 'USER'
  | 'TEAM'
  | 'PROJECT'
  | 'BOARD'
  | 'TASK'
  | 'SUBTASK'
  | 'DEPENDENCY'
  | 'IMPEDIMENT'
  | 'FEEDBACK'
  | 'FEEDBACK_CONTEST'
  | 'FEEDBACK_REOPEN'
  | 'NOTIFICATION'
  | 'AUDIT'
  | 'REPORT'
  | 'ANALYTICS'
  | 'BOTTLENECK'
  | 'FOCUS'
  | 'SEARCH'
  | 'TRASH'
  | 'BACKUP'
  | 'DATA'
  | 'DEMO';

export type TaskUpdatableField = 'title' | 'description' | 'priority' | 'dueDate' | 'tags';

/**
 * Parametrização explícita das 8 pendências de `permission-matrix.md` §12
 * e da divergência sobre Lixeira para MEMBER (`PRD.md` §20 vs `permission-matrix.md` §5.9).
 * Todas iniciam em Default Deny (`false` / `0`).
 */
export interface AuthorizationPolicyConfig {
  readonly commentEditWindowMinutes: number;
  readonly allowMemberCreateTaskInProject: boolean;
  readonly allowMemberUpdateTaskPriority: boolean;
  readonly allowMemberUpdateTaskDueDate: boolean;
  readonly allowFieldLevelTemporaryGrants: boolean;
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly allowMemberManageSubtasksInAccessibleTask: boolean;
  readonly allowMemberResolveOthersImpediment: boolean;
  readonly allowUnconfirmedIrreversibleActions: boolean;
  readonly allowMemberTrashAccess: boolean;
}

export const DEFAULT_AUTHORIZATION_POLICY_CONFIG: Readonly<AuthorizationPolicyConfig> =
  Object.freeze({
    commentEditWindowMinutes: 0,
    allowMemberCreateTaskInProject: false,
    allowMemberUpdateTaskPriority: false,
    allowMemberUpdateTaskDueDate: false,
    allowFieldLevelTemporaryGrants: false,
    allowManagerViewIndividualProductivity: false,
    allowMemberManageSubtasksInAccessibleTask: false,
    allowMemberResolveOthersImpediment: false,
    allowUnconfirmedIrreversibleActions: false,
    allowMemberTrashAccess: false,
  });

export interface ActorOrganizationMembership {
  readonly organizationId: OrganizationId;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
}

export interface AuthorizationActor {
  readonly isAuthenticated: boolean;
  readonly userId?: UserId;
  readonly organizationMembership?: ActorOrganizationMembership;
  readonly managedProjectIds?: readonly ProjectId[];
  readonly participatedProjectIds?: readonly ProjectId[];
  readonly managedTeamIds?: readonly TeamId[];
  readonly memberTeamIds?: readonly TeamId[];
  readonly grants?: readonly PermissionGrant[];
  readonly explicitDenies?: readonly ExplicitDenyRule[];
}

export interface AuthorizationResource {
  readonly kind?: AuthorizationResourceKind;
  readonly id?: EntityId;
  readonly exists: boolean;
  readonly organizationId?: OrganizationId;
  readonly projectId?: ProjectId;
  readonly teamId?: TeamId;
  readonly targetTeamId?: TeamId;
  readonly taskId?: TaskId;
  readonly subtaskId?: SubtaskId;
  readonly feedbackId?: FeedbackId;
  readonly createdBy?: UserId;
  readonly ownerUserId?: UserId;
  readonly assigneeId?: UserId;
  readonly participantIds?: readonly UserId[];
  readonly subtaskAssigneeId?: UserId;
  readonly subtaskParticipantIds?: readonly UserId[];
  readonly status?: string;
  readonly archivedAt?: IsoDateTime;
  readonly projectArchivedAt?: IsoDateTime;
  readonly deletedAt?: IsoDateTime;
  readonly hideExistenceOnCrossOrg?: boolean;
  readonly requestedFields?: readonly TaskUpdatableField[];
  readonly includesThirdPartyIndividualMetrics?: boolean;
  readonly confirmedExplicitly?: boolean;
  readonly relatedTasksAccessible?: boolean;
}

export interface AuthorizationContext {
  readonly now: IsoDateTime;
  readonly policyConfig?: Partial<AuthorizationPolicyConfig>;
}

export interface AuthorizationRequest {
  readonly actor: AuthorizationActor;
  readonly action: PermissionCode | (string & {});
  readonly resource: AuthorizationResource;
  readonly context: AuthorizationContext;
}

export type AuthorizationErrorCode =
  | typeof APP_ERROR_CODES.AUTHENTICATION_ERROR
  | typeof APP_ERROR_CODES.AUTHORIZATION_ERROR
  | typeof APP_ERROR_CODES.NOT_FOUND
  | typeof APP_ERROR_CODES.CONFLICT;

export type AuthorizationReasonCode =
  | 'ALLOWED_BY_ROLE'
  | 'ALLOWED_BY_GRANT'
  | 'DENIED_INVALID_ACTION'
  | 'DENIED_UNAUTHENTICATED'
  | 'DENIED_INVALID_TIMESTAMP'
  | 'DENIED_RESOURCE_NOT_FOUND'
  | 'DENIED_MISSING_ORGANIZATION'
  | 'DENIED_NO_ACTIVE_MEMBERSHIP'
  | 'DENIED_CROSS_ORGANIZATION'
  | 'DENIED_RESOURCE_DELETED'
  | 'DENIED_RESOURCE_NOT_DELETED'
  | 'DENIED_PROJECT_ARCHIVED'
  | 'DENIED_TEAM_ARCHIVED'
  | 'DENIED_CONFIRMATION_REQUIRED'
  | 'DENIED_EXPLICIT_DENY'
  | 'DENIED_INSUFFICIENT_ROLE'
  | 'DENIED_OUT_OF_SCOPE'
  | 'DENIED_MISSING_ATTRIBUTE'
  | 'DENIED_REQUIRES_SPECIAL_GRANT'
  | 'DENIED_POLICY_DEFAULT_DENY';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reasonCode: AuthorizationReasonCode;
  readonly errorCode?: AuthorizationErrorCode;
  readonly requiresAudit: boolean;
  readonly matchedGrantId?: GrantId;
  readonly matchedDenyId?: DenyRuleId;
}

interface ResolvedEvaluationContext {
  readonly action: PermissionCode;
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly role: OrganizationRole;
  readonly resource: AuthorizationResource;
  readonly policyConfig: AuthorizationPolicyConfig;
  readonly requiresAudit: boolean;
  readonly managesProject: boolean;
  readonly participatesInProject: boolean;
  readonly managesTeam: boolean;
  readonly managesTargetTeam: boolean;
  readonly isTeamMember: boolean;
  readonly isTaskAssignee: boolean;
  readonly isTaskParticipant: boolean;
  readonly isTaskActor: boolean;
  readonly isSubtaskActor: boolean;
  readonly isResourceCreator: boolean;
  readonly isResourceOwner: boolean;
  readonly isFeedbackAssigned: boolean;
  readonly isFeedbackAuthor: boolean;
  readonly matchedGrant?: PermissionGrant;
}

type ActionRuleEvaluator = (ctx: ResolvedEvaluationContext) => AuthorizationDecision;

const IRREVERSIBLE_CONFIRMATION_PERMISSIONS: ReadonlySet<PermissionCode> = new Set<PermissionCode>([
  PERMISSION_CODES.TRASH_DELETE_PERMANENTLY,
  PERMISSION_CODES.BACKUP_RESTORE,
  PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE,
]);

function allowByRole(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  return Object.freeze({
    allowed: true,
    reasonCode: 'ALLOWED_BY_ROLE',
    requiresAudit: ctx.requiresAudit,
  });
}

function allowByGrant(
  ctx: ResolvedEvaluationContext,
  grant: PermissionGrant,
): AuthorizationDecision {
  return Object.freeze({
    allowed: true,
    reasonCode: 'ALLOWED_BY_GRANT',
    requiresAudit: ctx.requiresAudit,
    matchedGrantId: grant.id,
  });
}

function deny(
  reasonCode: AuthorizationReasonCode,
  errorCode: AuthorizationErrorCode,
  requiresAudit: boolean,
  matchedDenyId?: DenyRuleId,
): AuthorizationDecision {
  return Object.freeze({
    allowed: false,
    reasonCode,
    errorCode,
    requiresAudit,
    ...(matchedDenyId !== undefined ? { matchedDenyId } : {}),
  });
}

function doesScopeMatchResource(
  scopeType: PermissionScopeType,
  scopeId: EntityId | undefined,
  resource: AuthorizationResource,
): boolean {
  if (!isPermissionScopeType(scopeType)) {
    return false;
  }

  switch (scopeType) {
    case PERMISSION_SCOPE_TYPES.ORGANIZATION:
      return true;

    case PERMISSION_SCOPE_TYPES.TEAM:
      return (
        scopeId !== undefined &&
        resource.teamId !== undefined &&
        (scopeId as string) === (resource.teamId as string)
      );

    case PERMISSION_SCOPE_TYPES.PROJECT:
      return (
        scopeId !== undefined &&
        resource.projectId !== undefined &&
        (scopeId as string) === (resource.projectId as string)
      );

    case PERMISSION_SCOPE_TYPES.RESOURCE: {
      if (scopeId === undefined) {
        return false;
      }

      const targetId = scopeId as string;
      return (
        targetId === (resource.id as string | undefined) ||
        targetId === (resource.taskId as string | undefined) ||
        targetId === (resource.subtaskId as string | undefined) ||
        targetId === (resource.feedbackId as string | undefined)
      );
    }
  }
}

function isPersistedGrantorAuthorized(
  grant: PermissionGrant,
  granteeRole: OrganizationRole,
  resource: AuthorizationResource,
): boolean {
  if (!isOrganizationRole(grant.grantedByRole)) {
    return false;
  }

  if (grant.grantedByRole === ORGANIZATION_ROLES.MEMBER) {
    return false;
  }

  if (DEMO_MAINTENANCE_PERMISSIONS.has(grant.permission)) {
    // permission-matrix.md §5.9: G | G | — (MEMBER nunca recebe manutenção demo)
    if (granteeRole === ORGANIZATION_ROLES.MEMBER) {
      return false;
    }

    if (grant.grantedByHasSpecialAuthority === false) {
      return false;
    }

    if (
      grant.grantedByRole === ORGANIZATION_ROLES.MANAGER &&
      grant.grantedByHasSpecialAuthority !== true
    ) {
      return false;
    }

    return true;
  }

  if (grant.grantedByRole === ORGANIZATION_ROLES.ADMIN) {
    return true;
  }

  // MANAGER: nunca delega escopo organizacional, ações exclusivas de ADMIN ou fora da allowlist/escopo administrado (§6, §11 cenário 9)
  if (grant.scopeType === PERMISSION_SCOPE_TYPES.ORGANIZATION) {
    return false;
  }

  if (
    ADMIN_ONLY_PERMISSIONS.has(grant.permission) ||
    !MANAGER_DELEGABLE_PERMISSIONS.has(grant.permission)
  ) {
    return false;
  }

  if (grant.scopeId === undefined || grant.grantedByScopeIds === undefined) {
    return false;
  }

  const grantorScopes = new Set<string>(grant.grantedByScopeIds.map((id) => id as string));

  if (grantorScopes.has(grant.scopeId as string)) {
    return true;
  }

  if (grant.scopeType === PERMISSION_SCOPE_TYPES.RESOURCE) {
    const managesResourceProject =
      resource.projectId !== undefined && grantorScopes.has(resource.projectId as string);
    const managesResourceTeam =
      resource.teamId !== undefined && grantorScopes.has(resource.teamId as string);
    return managesResourceProject || managesResourceTeam;
  }

  return false;
}

function findMatchingGrant(
  grants: readonly PermissionGrant[] | undefined,
  organizationId: OrganizationId,
  userId: UserId,
  granteeRole: OrganizationRole,
  action: PermissionCode,
  resource: AuthorizationResource,
  now: IsoDateTime,
): PermissionGrant | undefined {
  if (grants === undefined || grants.length === 0) {
    return undefined;
  }

  for (const grant of grants) {
    if (grant.organizationId !== organizationId) {
      continue;
    }

    if (grant.granteeUserId !== userId) {
      continue;
    }

    if (grant.permission !== action) {
      continue;
    }

    if (!isGrantActiveAt(grant, now)) {
      continue;
    }

    if (!doesScopeMatchResource(grant.scopeType, grant.scopeId, resource)) {
      continue;
    }

    if (!isPersistedGrantorAuthorized(grant, granteeRole, resource)) {
      continue;
    }

    return grant;
  }

  return undefined;
}

function findMatchingExplicitDeny(
  denies: readonly ExplicitDenyRule[] | undefined,
  organizationId: OrganizationId,
  userId: UserId,
  action: PermissionCode,
  resource: AuthorizationResource,
  now: IsoDateTime,
): ExplicitDenyRule | undefined {
  if (denies === undefined || denies.length === 0) {
    return undefined;
  }

  for (const rule of denies) {
    if (rule.organizationId !== organizationId) {
      continue;
    }

    if (rule.targetUserId !== userId) {
      continue;
    }

    if (rule.permission !== '*' && rule.permission !== action) {
      continue;
    }

    if (!isDenyRuleActiveAt(rule, now)) {
      continue;
    }

    if (!doesScopeMatchResource(rule.scopeType, rule.scopeId, resource)) {
      continue;
    }

    return rule;
  }

  return undefined;
}

// =============================================================================
// Helpers de regras específicas por família de permissão (Passo 9)
// =============================================================================

function adminExclusiveRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
}

function adminOrGrantRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function adminOrManagedProjectRule(
  ctx: ResolvedEvaluationContext,
  allowGrantForMember = true,
): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
    if (ctx.resource.projectId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.managesProject) {
      return allowByRole(ctx);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  }

  if (allowGrantForMember && ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function projectReadRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  if (ctx.resource.projectId === undefined) {
    return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  if (
    ctx.role === ORGANIZATION_ROLES.MANAGER &&
    (ctx.managesProject || ctx.participatesInProject)
  ) {
    return allowByRole(ctx);
  }

  if (ctx.role === ORGANIZATION_ROLES.MEMBER && ctx.participatesInProject) {
    return allowByRole(ctx);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function taskOperationalActorRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  if (ctx.resource.projectId === undefined) {
    return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
    if (ctx.managesProject || (ctx.participatesInProject && ctx.isTaskActor)) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  }

  // MEMBER: exige participação no projeto E ser responsável principal ou participante da tarefa (NUNCA apenas subtarefa — §4.4 / cenário 6)
  if (ctx.participatesInProject && ctx.isTaskActor) {
    return allowByRole(ctx);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function adminOrManagedTeamRule(
  ctx: ResolvedEvaluationContext,
  allowGrantForMember = true,
): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
    if (ctx.resource.teamId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.managesTeam) {
      return allowByRole(ctx);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  }

  if (allowGrantForMember && ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function ownResourceRule(
  ctx: ResolvedEvaluationContext,
  requireExplicitOwner: boolean,
): AuthorizationDecision {
  if (ctx.resource.ownerUserId === undefined) {
    if (requireExplicitOwner) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    return allowByRole(ctx);
  }

  if (ctx.isResourceOwner) {
    return allowByRole(ctx);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
}

function analyticsProjectRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.resource.projectId === undefined) {
    return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
    if (!ctx.managesProject) {
      if (ctx.matchedGrant !== undefined && !ctx.resource.includesThirdPartyIndividualMetrics) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    if (
      ctx.resource.includesThirdPartyIndividualMetrics === true &&
      !ctx.policyConfig.allowManagerViewIndividualProductivity
    ) {
      return deny('DENIED_POLICY_DEFAULT_DENY', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    return allowByRole(ctx);
  }

  // MEMBER: nunca acessa produtividade individual de terceiros
  if (ctx.resource.includesThirdPartyIndividualMetrics === true) {
    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  if (ctx.participatesInProject) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function reportAccessRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
    if (ctx.resource.projectId !== undefined) {
      return ctx.managesProject
        ? allowByRole(ctx)
        : deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    if (ctx.resource.teamId !== undefined) {
      return ctx.managesTeam
        ? allowByRole(ctx)
        : deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    if (ctx.resource.ownerUserId !== undefined && ctx.isResourceOwner) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  }

  if (ctx.resource.projectId !== undefined) {
    return ctx.participatesInProject
      ? allowByRole(ctx)
      : deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  }

  if (ctx.resource.ownerUserId !== undefined && ctx.isResourceOwner) {
    return allowByRole(ctx);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function feedbackViewOrExportRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
    if (ctx.isFeedbackAssigned || ctx.isFeedbackAuthor) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  }

  if (ctx.isFeedbackAuthor) {
    return allowByRole(ctx);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
}

function feedbackInternalNoteRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
    return allowByRole(ctx);
  }

  // Notas internas nunca são visíveis ou criáveis por MEMBER (§4.5, §5.7)
  if (ctx.role === ORGANIZATION_ROLES.MEMBER) {
    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  // MANAGER: estritamente se o feedback estiver atribuído a ele (§11 cenário 11)
  if (ctx.isFeedbackAssigned) {
    return allowByRole(ctx);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
}

function demoMaintenanceRule(ctx: ResolvedEvaluationContext): AuthorizationDecision {
  // Nunca herdado de ADMIN ou MANAGER; MEMBER sempre negado (§1.9, §5.9, §11 cenário 17)
  if (ctx.role === ORGANIZATION_ROLES.MEMBER) {
    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  if (ctx.matchedGrant !== undefined) {
    return allowByGrant(ctx, ctx.matchedGrant);
  }

  return deny('DENIED_REQUIRES_SPECIAL_GRANT', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
}

// =============================================================================
// Mapa exaustivo dos 89 códigos de permissão (garantido em tempo de compilação)
// =============================================================================

const PERMISSION_RULE_EVALUATORS: Readonly<Record<PermissionCode, ActionRuleEvaluator>> = {
  // 5.1 Organização, usuários e convites (8)
  [PERMISSION_CODES.ORGANIZATION_VIEW]: adminOrGrantRule,
  [PERMISSION_CODES.ORGANIZATION_UPDATE]: adminExclusiveRule,
  [PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE]: adminExclusiveRule,
  [PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW]: adminOrGrantRule,
  [PERMISSION_CODES.ORGANIZATION_MEMBERS_MANAGE]: adminExclusiveRule,
  [PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE]: adminExclusiveRule,
  [PERMISSION_CODES.INVITATION_CREATE]: adminExclusiveRule,
  [PERMISSION_CODES.INVITATION_REVOKE]: adminExclusiveRule,

  // 5.2 Equipes (6)
  [PERMISSION_CODES.TEAM_VIEW]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (ctx.resource.teamId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER && (ctx.managesTeam || ctx.isTeamMember)) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MEMBER && ctx.isTeamMember) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  },
  [PERMISSION_CODES.TEAM_CREATE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    // §5.2: Manager somente se a capacidade estiver delegada no escopo organizacional
    if (ctx.role === ORGANIZATION_ROLES.MANAGER && ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  },
  [PERMISSION_CODES.TEAM_UPDATE]: (ctx) => adminOrManagedTeamRule(ctx, true),
  [PERMISSION_CODES.TEAM_MEMBERS_MANAGE]: (ctx) => adminOrManagedTeamRule(ctx, true),
  [PERMISSION_CODES.TEAM_ARCHIVE]: (ctx) => adminOrManagedTeamRule(ctx, false),
  [PERMISSION_CODES.TEAM_DELETE]: adminExclusiveRule,

  // 5.3 Projetos e participantes (8)
  [PERMISSION_CODES.PROJECT_VIEW]: projectReadRule,
  [PERMISSION_CODES.PROJECT_CREATE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    // §5.3: Manager somente com capacidade de criação delegada
    if (ctx.role === ORGANIZATION_ROLES.MANAGER && ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  },
  [PERMISSION_CODES.PROJECT_UPDATE]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.PROJECT_MEMBERS_MANAGE]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.PROJECT_ARCHIVE]: (ctx) => adminOrManagedProjectRule(ctx, false),
  [PERMISSION_CODES.PROJECT_RESTORE]: (ctx) => adminOrManagedProjectRule(ctx, false),
  [PERMISSION_CODES.PROJECT_DELETE]: adminExclusiveRule,
  [PERMISSION_CODES.PROJECT_TRANSFER]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role !== ORGANIZATION_ROLES.MANAGER) {
      return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    // §5.3: Manager somente entre equipes sob sua autoridade (falha fechada se ausente)
    if (ctx.resource.projectId === undefined || ctx.resource.targetTeamId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    const sourceTeamAuthorized = ctx.resource.teamId === undefined || ctx.managesTeam;
    if (ctx.managesProject && sourceTeamAuthorized && ctx.managesTargetTeam) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  },

  // 5.4 Quadros Kanban e colunas (5)
  [PERMISSION_CODES.BOARD_VIEW]: projectReadRule,
  [PERMISSION_CODES.BOARD_CONFIGURE]: (ctx) => adminOrManagedProjectRule(ctx, false),
  [PERMISSION_CODES.BOARD_COLUMNS_MANAGE]: (ctx) => adminOrManagedProjectRule(ctx, false),
  [PERMISSION_CODES.BOARD_WIP_MANAGE]: (ctx) => adminOrManagedProjectRule(ctx, false),
  [PERMISSION_CODES.BOARD_CARD_MOVE]: taskOperationalActorRule,

  // 5.5 Tarefas, subtarefas, dependências e impedimentos (22)
  [PERMISSION_CODES.TASK_VIEW]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_CREATE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.resource.projectId === undefined) {
        return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
      }

      if (ctx.managesProject) {
        return allowByRole(ctx);
      }

      if (ctx.matchedGrant !== undefined) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    // MEMBER: Default Deny (§5.5 e §12); habilitado apenas por concessão explícita ou flag parametrizada
    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (
      ctx.resource.projectId !== undefined &&
      ctx.participatesInProject &&
      ctx.policyConfig.allowMemberCreateTaskInProject
    ) {
      return allowByRole(ctx);
    }

    return deny(
      'DENIED_POLICY_DEFAULT_DENY',
      APP_ERROR_CODES.AUTHORIZATION_ERROR,
      ctx.requiresAudit,
    );
  },
  [PERMISSION_CODES.TASK_UPDATE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.resource.projectId === undefined) {
        return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
      }

      if (ctx.managesProject) {
        return allowByRole(ctx);
      }

      if (ctx.matchedGrant !== undefined) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    // MEMBER: exige tarefa própria/participante (NÃO subtarefa isolada — cenário 6) e checagem §12 para priority/dueDate
    if (ctx.resource.projectId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    const fields = ctx.resource.requestedFields ?? [];
    const requestsPriority = fields.includes('priority');
    const requestsDueDate = fields.includes('dueDate');

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (!ctx.participatesInProject || !ctx.isTaskActor) {
      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    if (requestsPriority && !ctx.policyConfig.allowMemberUpdateTaskPriority) {
      return deny(
        'DENIED_POLICY_DEFAULT_DENY',
        APP_ERROR_CODES.AUTHORIZATION_ERROR,
        ctx.requiresAudit,
      );
    }

    if (requestsDueDate && !ctx.policyConfig.allowMemberUpdateTaskDueDate) {
      return deny(
        'DENIED_POLICY_DEFAULT_DENY',
        APP_ERROR_CODES.AUTHORIZATION_ERROR,
        ctx.requiresAudit,
      );
    }

    return allowByRole(ctx);
  },
  [PERMISSION_CODES.TASK_ASSIGN]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.TASK_PARTICIPANTS_MANAGE]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.TASK_MOVE]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_START]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_PAUSE]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_COMPLETE]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_CANCEL]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.TASK_REOPEN]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.TASK_COMMENT]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_ATTACHMENT_MANAGE]: taskOperationalActorRule,
  [PERMISSION_CODES.TASK_HISTORY_VIEW]: taskOperationalActorRule,
  [PERMISSION_CODES.SUBTASK_MANAGE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.resource.projectId === undefined) {
        return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
      }

      if (ctx.managesProject) {
        return allowByRole(ctx);
      }

      if (ctx.matchedGrant !== undefined) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      if (
        ctx.participatesInProject &&
        ctx.isTaskActor &&
        ctx.policyConfig.allowMemberManageSubtasksInAccessibleTask
      ) {
        return allowByRole(ctx);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (
      ctx.participatesInProject &&
      ctx.isTaskActor &&
      ctx.policyConfig.allowMemberManageSubtasksInAccessibleTask
    ) {
      return allowByRole(ctx);
    }

    return deny(
      'DENIED_POLICY_DEFAULT_DENY',
      APP_ERROR_CODES.AUTHORIZATION_ERROR,
      ctx.requiresAudit,
    );
  },
  [PERMISSION_CODES.SUBTASK_ASSIGN]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.SUBTASK_COMPLETE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (ctx.resource.projectId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (
        ctx.managesProject ||
        (ctx.participatesInProject && (ctx.isSubtaskActor || ctx.isTaskActor))
      ) {
        return allowByRole(ctx);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    // MEMBER: precisa ser responsável/participante da subtarefa (§5.5 / §11 cenário 6)
    if (ctx.participatesInProject && ctx.isSubtaskActor) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  },
  [PERMISSION_CODES.DEPENDENCY_VIEW]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.resource.relatedTasksAccessible === false) {
      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    return taskOperationalActorRule(ctx);
  },
  [PERMISSION_CODES.DEPENDENCY_MANAGE]: (ctx) => adminOrManagedProjectRule(ctx, true),
  [PERMISSION_CODES.IMPEDIMENT_CREATE]: taskOperationalActorRule,
  [PERMISSION_CODES.IMPEDIMENT_VIEW]: taskOperationalActorRule,
  [PERMISSION_CODES.IMPEDIMENT_RESOLVE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (ctx.resource.projectId === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.managesProject) {
        return allowByRole(ctx);
      }

      if (
        ctx.participatesInProject &&
        ctx.isTaskActor &&
        (ctx.isResourceCreator || ctx.policyConfig.allowMemberResolveOthersImpediment)
      ) {
        return allowByRole(ctx);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    if (
      ctx.participatesInProject &&
      ctx.isTaskActor &&
      (ctx.isResourceCreator || ctx.policyConfig.allowMemberResolveOthersImpediment)
    ) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
  },

  // 5.6 Modo Foco, dashboards, Analytics e gargalos (8)
  [PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE]: (ctx) => ownResourceRule(ctx, false),
  [PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW]: (ctx) => ownResourceRule(ctx, false),
  [PERMISSION_CODES.ANALYTICS_PROJECT_VIEW]: analyticsProjectRule,
  [PERMISSION_CODES.ANALYTICS_ORGANIZATION_VIEW]: adminExclusiveRule,
  [PERMISSION_CODES.ANALYTICS_EXPORT]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.resource.projectId !== undefined) {
      return analyticsProjectRule(ctx);
    }

    if (ctx.resource.ownerUserId !== undefined && ctx.isResourceOwner) {
      return allowByRole(ctx);
    }

    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  },
  [PERMISSION_CODES.ANALYTICS_RULES_MANAGE]: adminExclusiveRule,
  [PERMISSION_CODES.BOTTLENECK_VIEW]: projectReadRule,
  [PERMISSION_CODES.BOTTLENECK_RULES_MANAGE]: (ctx) => adminOrManagedProjectRule(ctx, false),

  // 5.7 Feedback, SLA, contestações e reabertura (14)
  [PERMISSION_CODES.FEEDBACK_CREATE]: (ctx) => allowByRole(ctx),
  [PERMISSION_CODES.FEEDBACK_VIEW]: feedbackViewOrExportRule,
  [PERMISSION_CODES.FEEDBACK_MESSAGE_CREATE]: feedbackViewOrExportRule,
  [PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW]: feedbackInternalNoteRule,
  [PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_CREATE]: feedbackInternalNoteRule,
  [PERMISSION_CODES.FEEDBACK_ASSIGN]: adminExclusiveRule,
  [PERMISSION_CODES.FEEDBACK_STATUS_MANAGE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.isFeedbackAssigned) {
        return allowByRole(ctx);
      }

      if (ctx.matchedGrant !== undefined) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  },
  [PERMISSION_CODES.FEEDBACK_CATALOG_MANAGE]: adminExclusiveRule,
  [PERMISSION_CODES.FEEDBACK_SLA_MANAGE]: adminExclusiveRule,
  [PERMISSION_CODES.FEEDBACK_EXPORT]: feedbackViewOrExportRule,
  [PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    // §5.7 e §11 cenário 12: Manager somente quando houver delegação explícita
    if (ctx.role === ORGANIZATION_ROLES.MANAGER && ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  },
  [PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE]: adminExclusiveRule,
  [PERMISSION_CODES.FEEDBACK_REOPEN_REQUEST]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.resource.createdBy === undefined) {
      return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.isFeedbackAuthor) {
      return allowByRole(ctx);
    }

    return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  },
  [PERMISSION_CODES.FEEDBACK_REOPEN_DECIDE]: adminExclusiveRule,

  // 5.8 Notificações, auditoria, relatórios e busca (8)
  [PERMISSION_CODES.NOTIFICATION_VIEW]: (ctx) => ownResourceRule(ctx, true),
  [PERMISSION_CODES.NOTIFICATION_PREFERENCES_MANAGE]: (ctx) => ownResourceRule(ctx, true),
  [PERMISSION_CODES.AUDIT_PROJECT_VIEW]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    // §11 cenário 14: MEMBER nunca consulta auditoria diretamente
    if (ctx.role === ORGANIZATION_ROLES.MEMBER) {
      return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    return adminOrManagedProjectRule(ctx, false);
  },
  [PERMISSION_CODES.AUDIT_ORGANIZATION_VIEW]: adminExclusiveRule,
  [PERMISSION_CODES.AUDIT_EXPORT]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MEMBER) {
      return deny('DENIED_INSUFFICIENT_ROLE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    return adminOrManagedProjectRule(ctx, false);
  },
  [PERMISSION_CODES.REPORT_VIEW]: reportAccessRule,
  [PERMISSION_CODES.REPORT_EXPORT]: reportAccessRule,
  [PERMISSION_CODES.SEARCH_EXECUTE]: (ctx) => allowByRole(ctx),

  // 5.9 Lixeira, backups, importação/exportação e manutenção demo (10)
  [PERMISSION_CODES.TRASH_VIEW]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.resource.projectId === undefined) {
        return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
      }

      if (ctx.managesProject) {
        return allowByRole(ctx);
      }

      if (ctx.matchedGrant !== undefined) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, ctx.requiresAudit);
    }

    // Divergência PRD §20 vs permission-matrix.md §5.9: Default Deny para MEMBER
    if (
      ctx.policyConfig.allowMemberTrashAccess &&
      ctx.isResourceCreator &&
      ctx.participatesInProject
    ) {
      return allowByRole(ctx);
    }

    return deny(
      'DENIED_POLICY_DEFAULT_DENY',
      APP_ERROR_CODES.AUTHORIZATION_ERROR,
      ctx.requiresAudit,
    );
  },
  [PERMISSION_CODES.TRASH_RESTORE]: (ctx) => {
    if (ctx.role === ORGANIZATION_ROLES.ADMIN) {
      return allowByRole(ctx);
    }

    if (ctx.role === ORGANIZATION_ROLES.MANAGER) {
      if (ctx.resource.projectId === undefined) {
        return deny('DENIED_MISSING_ATTRIBUTE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
      }

      if (ctx.managesProject) {
        return allowByRole(ctx);
      }

      if (ctx.matchedGrant !== undefined) {
        return allowByGrant(ctx, ctx.matchedGrant);
      }

      return deny('DENIED_OUT_OF_SCOPE', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
    }

    if (ctx.matchedGrant !== undefined) {
      return allowByGrant(ctx, ctx.matchedGrant);
    }

    if (
      ctx.policyConfig.allowMemberTrashAccess &&
      ctx.isResourceCreator &&
      ctx.participatesInProject
    ) {
      return allowByRole(ctx);
    }

    return deny('DENIED_POLICY_DEFAULT_DENY', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  },
  [PERMISSION_CODES.TRASH_DELETE_PERMANENTLY]: adminExclusiveRule,
  [PERMISSION_CODES.BACKUP_CREATE]: adminExclusiveRule,
  [PERMISSION_CODES.BACKUP_VIEW]: adminExclusiveRule,
  [PERMISSION_CODES.BACKUP_RESTORE]: adminExclusiveRule,
  [PERMISSION_CODES.DATA_IMPORT]: adminExclusiveRule,
  [PERMISSION_CODES.DATA_EXPORT]: adminExclusiveRule,
  [PERMISSION_CODES.DEMO_MAINTENANCE_VIEW]: demoMaintenanceRule,
  [PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE]: demoMaintenanceRule,
};

/**
 * Motor determinístico de autorização RBAC + ABAC seguindo estritamente
 * a ordem de 10 passos de `permission-matrix.md` §7.
 *
 * Princípios aplicados sem atalhos:
 * - Default Deny
 * - Deny Overrides
 * - Isolamento multi-organização (`organizationId`)
 * - Falha fechada diante de atributos obrigatórios ausentes ou timestamps inválidos
 *
 * Limite do protótipo (`SECURITY.md`): executa controles funcionais no cliente;
 * não substitui validação de identidade e autorização no servidor em produção real.
 */
export function evaluateAuthorization(request: AuthorizationRequest): AuthorizationDecision {
  // Passo 1: Identificar ator, ação e recurso (+ validar relógio de avaliação)
  if (!isPermissionCode(request.action)) {
    return deny('DENIED_INVALID_ACTION', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  const action: PermissionCode = request.action;
  const baseRequiresAudit = AUDITABLE_PERMISSIONS.has(action);

  if (!isIsoDateTime(request.context.now)) {
    return deny('DENIED_INVALID_TIMESTAMP', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  const now: IsoDateTime = request.context.now;
  const { actor, resource } = request;
  const policyConfig: AuthorizationPolicyConfig = {
    ...DEFAULT_AUTHORIZATION_POLICY_CONFIG,
    ...(request.context.policyConfig ?? {}),
  };

  // Passo 2: Validar sessão/autenticação simulada
  if (!actor.isAuthenticated || actor.userId === undefined) {
    return deny('DENIED_UNAUTHENTICATED', APP_ERROR_CODES.AUTHENTICATION_ERROR, baseRequiresAudit);
  }

  const userId: UserId = actor.userId;

  // Passo 3: Validar existência do recurso e organização proprietária (falha fechada)
  if (!resource.exists) {
    return deny('DENIED_RESOURCE_NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, baseRequiresAudit);
  }

  if (resource.organizationId === undefined) {
    return deny('DENIED_MISSING_ORGANIZATION', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  const organizationId: OrganizationId = resource.organizationId;

  // Passo 4: Validar associação ativa do ator à organização proprietária
  const membership = actor.organizationMembership;

  if (membership === undefined) {
    return deny('DENIED_NO_ACTIVE_MEMBERSHIP', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  if (membership.organizationId !== organizationId) {
    return deny(
      'DENIED_CROSS_ORGANIZATION',
      resource.hideExistenceOnCrossOrg
        ? APP_ERROR_CODES.NOT_FOUND
        : APP_ERROR_CODES.AUTHORIZATION_ERROR,
      true,
    );
  }

  if (membership.status !== MEMBERSHIP_STATUSES.ACTIVE || !isOrganizationRole(membership.role)) {
    return deny('DENIED_NO_ACTIVE_MEMBERSHIP', APP_ERROR_CODES.AUTHORIZATION_ERROR, true);
  }

  const role: OrganizationRole = membership.role;

  // Passo 5: Validar estado operacional do recurso (excluído, arquivado, confirmação)
  if (resource.deletedAt !== undefined) {
    if (!TRASH_PERMISSIONS.has(action)) {
      return deny('DENIED_RESOURCE_DELETED', APP_ERROR_CODES.CONFLICT, baseRequiresAudit);
    }
  } else if (
    action === PERMISSION_CODES.TRASH_RESTORE ||
    action === PERMISSION_CODES.TRASH_DELETE_PERMANENTLY
  ) {
    return deny('DENIED_RESOURCE_NOT_DELETED', APP_ERROR_CODES.CONFLICT, true);
  }

  const isProjectArchived =
    resource.projectArchivedAt !== undefined ||
    (resource.kind === 'PROJECT' && resource.archivedAt !== undefined);

  if (
    isProjectArchived &&
    (OPERATIONAL_MUTATION_PERMISSIONS.has(action) || action === PERMISSION_CODES.PROJECT_ARCHIVE)
  ) {
    return deny('DENIED_PROJECT_ARCHIVED', APP_ERROR_CODES.CONFLICT, true);
  }

  const isTeamArchived = resource.kind === 'TEAM' && resource.archivedAt !== undefined;
  if (
    isTeamArchived &&
    (action === PERMISSION_CODES.TEAM_UPDATE || action === PERMISSION_CODES.TEAM_MEMBERS_MANAGE)
  ) {
    return deny('DENIED_TEAM_ARCHIVED', APP_ERROR_CODES.CONFLICT, true);
  }

  if (
    IRREVERSIBLE_CONFIRMATION_PERMISSIONS.has(action) &&
    resource.confirmedExplicitly === false &&
    !policyConfig.allowUnconfirmedIrreversibleActions
  ) {
    return deny('DENIED_CONFIRMATION_REQUIRED', APP_ERROR_CODES.CONFLICT, true);
  }

  // Passo 6: Resolver papel organizacional e escopo explícito de projeto/equipe/recurso
  const managesProject =
    resource.projectId !== undefined &&
    (actor.managedProjectIds?.includes(resource.projectId) ?? false);
  const participatesInProject =
    resource.projectId !== undefined &&
    (managesProject || (actor.participatedProjectIds?.includes(resource.projectId) ?? false));
  const managesTeam =
    resource.teamId !== undefined && (actor.managedTeamIds?.includes(resource.teamId) ?? false);
  const managesTargetTeam =
    resource.targetTeamId !== undefined &&
    (actor.managedTeamIds?.includes(resource.targetTeamId) ?? false);
  const isTeamMember =
    resource.teamId !== undefined &&
    (managesTeam || (actor.memberTeamIds?.includes(resource.teamId) ?? false));

  const isTaskAssignee = resource.assigneeId === userId;
  const isTaskParticipant = resource.participantIds?.includes(userId) ?? false;
  const isTaskActor = isTaskAssignee || isTaskParticipant;

  const isSubtaskActor =
    resource.subtaskAssigneeId === userId ||
    (resource.subtaskParticipantIds?.includes(userId) ?? false);

  const isResourceCreator = resource.createdBy === userId;
  const isResourceOwner = resource.ownerUserId === userId;
  const isFeedbackAssigned = resource.assigneeId === userId;
  const isFeedbackAuthor = resource.createdBy === userId;

  // Passo 7: Localizar concessões aplicáveis (escopo, autoridade do concedente e validade temporal)
  const matchedGrant = findMatchingGrant(
    actor.grants,
    organizationId,
    userId,
    role,
    action,
    resource,
    now,
  );

  // Passo 8: Aplicar restrições e negações explícitas (Deny Overrides prevalece sobre papel e concessão)
  const matchedDeny = findMatchingExplicitDeny(
    actor.explicitDenies,
    organizationId,
    userId,
    action,
    resource,
    now,
  );

  if (matchedDeny !== undefined) {
    return deny('DENIED_EXPLICIT_DENY', APP_ERROR_CODES.AUTHORIZATION_ERROR, true, matchedDeny.id);
  }

  // Passo 9: Aplicar a regra específica da ação (todos os 89 códigos mapeados exaustivamente)
  const evaluationContext: ResolvedEvaluationContext = {
    action,
    userId,
    organizationId,
    role,
    resource,
    policyConfig,
    requiresAudit: baseRequiresAudit,
    managesProject,
    participatesInProject,
    managesTeam,
    managesTargetTeam,
    isTeamMember,
    isTaskAssignee,
    isTaskParticipant,
    isTaskActor,
    isSubtaskActor,
    isResourceCreator,
    isResourceOwner,
    isFeedbackAssigned,
    isFeedbackAuthor,
    matchedGrant,
  };

  // Passo 10: Retornar decisão determinística (Default Deny / falha fechada)
  const evaluator = PERMISSION_RULE_EVALUATORS[action];
  return evaluator(evaluationContext);
}

/**
 * Executa a avaliação de autorização e lança erro padronizado de `permission-matrix.md` §10
 * quando a operação é negada (`AuthenticationError`, `AuthorizationError`, `NotFoundError` ou `ConflictError`).
 */
export function assertAuthorized(request: AuthorizationRequest): void {
  const decision = evaluateAuthorization(request);

  if (decision.allowed) {
    return;
  }

  const details: Record<string, unknown> = {
    action: request.action,
    reasonCode: decision.reasonCode,
    requiresAudit: decision.requiresAudit,
    ...(decision.matchedDenyId !== undefined ? { matchedDenyId: decision.matchedDenyId } : {}),
  };

  switch (decision.errorCode) {
    case APP_ERROR_CODES.AUTHENTICATION_ERROR:
      throw new AuthenticationError(
        `Authentication required for action "${request.action}" (${decision.reasonCode}).`,
        { details },
      );

    case APP_ERROR_CODES.NOT_FOUND:
      throw new NotFoundError(
        `Resource not found or inaccessible for action "${request.action}" (${decision.reasonCode}).`,
        { details },
      );

    case APP_ERROR_CODES.CONFLICT:
      throw new ConflictError(
        `Resource state prevents action "${request.action}" (${decision.reasonCode}).`,
        { details },
      );

    case APP_ERROR_CODES.AUTHORIZATION_ERROR:
    default:
      throw new AuthorizationError(
        `Actor is not authorized for action "${request.action}" (${decision.reasonCode}).`,
        { details },
      );
  }
}
