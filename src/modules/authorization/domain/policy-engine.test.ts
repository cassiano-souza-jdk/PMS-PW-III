import { describe, expect, it } from 'vitest';
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
  asEntityId,
  asFeedbackId,
  asGrantId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asSubtaskId,
  asTaskId,
  asTeamId,
  asUserId,
} from '@/shared/kernel';
import {
  GRANT_STATUSES,
  PERMISSION_CODES,
  PERMISSION_CODE_LIST,
  PERMISSION_SCOPE_TYPES,
  asDenyRuleId,
  assertAuthorized,
  canGrantorDelegatePermission,
  deriveGrantStatus,
  evaluateAuthorization,
  isGrantActiveAt,
  isPermissionCode,
  type AuthorizationActor,
  type AuthorizationResource,
  type ExplicitDenyRule,
  type PermissionGrant,
} from '../index';

const NOW = asIsoDateTime('2026-11-19T12:00:00Z');
const PAST = asIsoDateTime('2026-11-18T12:00:00Z');
const FUTURE = asIsoDateTime('2026-11-25T12:00:00Z');

const ORG_A = asOrganizationId('10000000-0000-4000-8000-000000000001');
const ORG_B = asOrganizationId('10000000-0000-4000-8000-000000000002');

const USER_ADMIN = asUserId('20000000-0000-4000-8000-000000000001');
const USER_MANAGER = asUserId('20000000-0000-4000-8000-000000000002');
const USER_MEMBER = asUserId('20000000-0000-4000-8000-000000000003');
const USER_OTHER = asUserId('20000000-0000-4000-8000-000000000004');

const TEAM_1 = asTeamId('30000000-0000-4000-8000-000000000001');
const TEAM_2 = asTeamId('30000000-0000-4000-8000-000000000002');

const PROJECT_X = asProjectId('40000000-0000-4000-8000-000000000001');
const PROJECT_Y = asProjectId('40000000-0000-4000-8000-000000000002');

const TASK_1 = asTaskId('50000000-0000-4000-8000-000000000001');
const SUBTASK_1 = asSubtaskId('51000000-0000-4000-8000-000000000001');
const FEEDBACK_1 = asFeedbackId('60000000-0000-4000-8000-000000000001');
const ENTITY_1 = asEntityId('70000000-0000-4000-8000-000000000001');
const GRANT_1 = asGrantId('80000000-0000-4000-8000-000000000001');
const DENY_1 = asDenyRuleId('90000000-0000-4000-8000-000000000001');

function makeActor(overrides: Partial<AuthorizationActor> = {}): AuthorizationActor {
  return {
    isAuthenticated: true,
    userId: USER_ADMIN,
    organizationMembership: {
      organizationId: ORG_A,
      role: ORGANIZATION_ROLES.ADMIN,
      status: MEMBERSHIP_STATUSES.ACTIVE,
    },
    ...overrides,
  };
}

function makeResource(overrides: Partial<AuthorizationResource> = {}): AuthorizationResource {
  return {
    exists: true,
    organizationId: ORG_A,
    ...overrides,
  };
}

describe('Authorization Catalog — 89 Canonical Permission Codes', () => {
  it('contains exactly 89 unique permission codes and all 89 have active evaluators', () => {
    expect(PERMISSION_CODE_LIST).toHaveLength(89);
    expect(new Set(PERMISSION_CODE_LIST).size).toBe(89);

    const adminActor = makeActor();
    for (const code of PERMISSION_CODE_LIST) {
      expect(isPermissionCode(code)).toBe(true);

      const decision = evaluateAuthorization({
        actor: adminActor,
        action: code,
        resource: makeResource({
          id: ENTITY_1,
          projectId: PROJECT_X,
          teamId: TEAM_1,
          targetTeamId: TEAM_2,
          taskId: TASK_1,
          subtaskId: SUBTASK_1,
          feedbackId: FEEDBACK_1,
          ownerUserId: USER_ADMIN,
          createdBy: USER_ADMIN,
          assigneeId: USER_ADMIN,
          confirmedExplicitly: true,
          ...(code === PERMISSION_CODES.TRASH_RESTORE ||
          code === PERMISSION_CODES.TRASH_DELETE_PERMANENTLY
            ? { deletedAt: PAST }
            : {}),
        }),
        context: { now: NOW },
      });

      expect(Object.isFrozen(decision)).toBe(true);
      expect(decision.reasonCode).not.toBe('DENIED_INVALID_ACTION');
    }

    expect(isPermissionCode('nonexistent.action')).toBe(false);
    expect(
      evaluateAuthorization({
        actor: adminActor,
        action: 'nonexistent.action',
        resource: makeResource(),
        context: { now: NOW },
      }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_INVALID_ACTION',
      errorCode: APP_ERROR_CODES.AUTHORIZATION_ERROR,
    });
  });
});

describe('Authorization Policy Engine — 20 Minimum Acceptance Scenarios (permission-matrix.md §11)', () => {
  it('Cenário 1: ADMIN em Organização A não acessa recurso de Organização B sem associação ativa a B', () => {
    const adminInA = makeActor({
      userId: USER_ADMIN,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.ADMIN,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
    });

    const decisionAuthz = evaluateAuthorization({
      actor: adminInA,
      action: PERMISSION_CODES.PROJECT_VIEW,
      resource: makeResource({ organizationId: ORG_B, projectId: PROJECT_X }),
      context: { now: NOW },
    });
    expect(decisionAuthz).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_CROSS_ORGANIZATION',
      errorCode: APP_ERROR_CODES.AUTHORIZATION_ERROR,
      requiresAudit: true,
    });

    const decisionNonDisclosure = evaluateAuthorization({
      actor: adminInA,
      action: PERMISSION_CODES.PROJECT_VIEW,
      resource: makeResource({
        organizationId: ORG_B,
        projectId: PROJECT_X,
        hideExistenceOnCrossOrg: true,
      }),
      context: { now: NOW },
    });
    expect(decisionNonDisclosure).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_CROSS_ORGANIZATION',
      errorCode: APP_ERROR_CODES.NOT_FOUND,
      requiresAudit: true,
    });
  });

  it('Cenário 2: Papel MANAGER em A não concede gestão organizacional em A', () => {
    const manager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      managedProjectIds: [PROJECT_X],
      managedTeamIds: [TEAM_1],
    });

    const orgAdminActions = [
      PERMISSION_CODES.ORGANIZATION_VIEW,
      PERMISSION_CODES.ORGANIZATION_UPDATE,
      PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE,
      PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE,
      PERMISSION_CODES.INVITATION_CREATE,
      PERMISSION_CODES.ANALYTICS_ORGANIZATION_VIEW,
      PERMISSION_CODES.AUDIT_ORGANIZATION_VIEW,
    ] as const;

    for (const action of orgAdminActions) {
      const decision = evaluateAuthorization({
        actor: manager,
        action,
        resource: makeResource({ kind: 'ORGANIZATION' }),
        context: { now: NOW },
      });
      expect(decision.allowed, `MANAGER should be denied "${action}"`).toBe(false);
      expect(decision.errorCode).toBe(APP_ERROR_CODES.AUTHORIZATION_ERROR);
    }
  });

  it('Cenário 3: MANAGER atribuído ao Projeto X administra Projeto X, mas não administra Projeto Y', () => {
    const manager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      managedProjectIds: [PROJECT_X],
    });

    const allowedX = evaluateAuthorization({
      actor: manager,
      action: PERMISSION_CODES.BOARD_CONFIGURE,
      resource: makeResource({ kind: 'BOARD', projectId: PROJECT_X }),
      context: { now: NOW },
    });
    expect(allowedX.allowed).toBe(true);
    expect(allowedX.reasonCode).toBe('ALLOWED_BY_ROLE');

    const deniedY = evaluateAuthorization({
      actor: manager,
      action: PERMISSION_CODES.BOARD_CONFIGURE,
      resource: makeResource({ kind: 'BOARD', projectId: PROJECT_Y }),
      context: { now: NOW },
    });
    expect(deniedY).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_OUT_OF_SCOPE',
      errorCode: APP_ERROR_CODES.AUTHORIZATION_ERROR,
    });
  });

  it('Cenário 4: MEMBER participante do Projeto X consulta o quadro, mas não altera colunas ou WIP', () => {
    const member = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [PROJECT_X],
    });

    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.BOARD_VIEW,
        resource: makeResource({ kind: 'BOARD', projectId: PROJECT_X }),
        context: { now: NOW },
      }).allowed,
    ).toBe(true);

    for (const action of [
      PERMISSION_CODES.BOARD_CONFIGURE,
      PERMISSION_CODES.BOARD_COLUMNS_MANAGE,
      PERMISSION_CODES.BOARD_WIP_MANAGE,
    ]) {
      const denied = evaluateAuthorization({
        actor: member,
        action,
        resource: makeResource({ kind: 'BOARD', projectId: PROJECT_X }),
        context: { now: NOW },
      });
      expect(denied.allowed).toBe(false);
      expect(denied.reasonCode).toBe('DENIED_INSUFFICIENT_ROLE');
    }
  });

  it('Cenário 5: MEMBER responsável por tarefa executa somente ações operacionais permitidas (Default Deny para §12)', () => {
    const member = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [PROJECT_X],
    });

    const ownTask = makeResource({
      kind: 'TASK',
      projectId: PROJECT_X,
      taskId: TASK_1,
      assigneeId: USER_MEMBER,
    });

    // Operacionais permitidas
    for (const action of [
      PERMISSION_CODES.TASK_VIEW,
      PERMISSION_CODES.TASK_MOVE,
      PERMISSION_CODES.TASK_START,
      PERMISSION_CODES.TASK_PAUSE,
      PERMISSION_CODES.TASK_COMPLETE,
      PERMISSION_CODES.TASK_COMMENT,
    ]) {
      expect(
        evaluateAuthorization({
          actor: member,
          action,
          resource: ownTask,
          context: { now: NOW },
        }).allowed,
        `expected "${action}" to be allowed`,
      ).toBe(true);
    }

    // Edição de título/descrição permitida, mas priority/dueDate bloqueadas sob Default Deny (§12)
    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.TASK_UPDATE,
        resource: { ...ownTask, requestedFields: ['title', 'description'] },
        context: { now: NOW },
      }).allowed,
    ).toBe(true);

    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.TASK_UPDATE,
        resource: { ...ownTask, requestedFields: ['priority'] },
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_POLICY_DEFAULT_DENY' });

    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.TASK_UPDATE,
        resource: { ...ownTask, requestedFields: ['dueDate'] },
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_POLICY_DEFAULT_DENY' });

    // Ações administrativas ou §12 Default Deny bloqueadas
    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.TASK_CREATE,
        resource: ownTask,
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_POLICY_DEFAULT_DENY' });

    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.TASK_CANCEL,
        resource: ownTask,
        context: { now: NOW },
      }).allowed,
    ).toBe(false);
  });

  it('Cenário 6: Ser responsável por subtarefa permite concluir subtarefa, mas NÃO concede controle da tarefa-pai', () => {
    const member = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [PROJECT_X],
    });

    const subtaskOnlyResource = makeResource({
      kind: 'TASK',
      projectId: PROJECT_X,
      taskId: TASK_1,
      subtaskId: SUBTASK_1,
      assigneeId: USER_OTHER,
      participantIds: [],
      subtaskAssigneeId: USER_MEMBER,
    });

    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.SUBTASK_COMPLETE,
        resource: subtaskOnlyResource,
        context: { now: NOW },
      }).allowed,
    ).toBe(true);

    for (const parentAction of [
      PERMISSION_CODES.TASK_UPDATE,
      PERMISSION_CODES.TASK_MOVE,
      PERMISSION_CODES.TASK_COMPLETE,
    ]) {
      const decision = evaluateAuthorization({
        actor: member,
        action: parentAction,
        resource: subtaskOnlyResource,
        context: { now: NOW },
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reasonCode).toBe('DENIED_OUT_OF_SCOPE');
    }
  });

  it('Cenário 7: Revogação de concessão (ex.: ao remover participante) revoga acesso imediatamente', () => {
    const revokedGrant: PermissionGrant = {
      id: GRANT_1,
      organizationId: ORG_A,
      granteeUserId: USER_MEMBER,
      permission: PERMISSION_CODES.TASK_CREATE,
      scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
      scopeId: asEntityId(PROJECT_X as string),
      grantedByUserId: USER_ADMIN,
      grantedByRole: ORGANIZATION_ROLES.ADMIN,
      grantedAt: PAST,
      revokedAt: NOW,
      revokedByUserId: USER_ADMIN,
      reason: 'Participant removed from project',
      status: GRANT_STATUSES.ACTIVE,
    };

    expect(deriveGrantStatus(revokedGrant, NOW)).toBe(GRANT_STATUSES.REVOKED);
    expect(isGrantActiveAt(revokedGrant, NOW)).toBe(false);

    const decision = evaluateAuthorization({
      actor: makeActor({
        userId: USER_MEMBER,
        organizationMembership: {
          organizationId: ORG_A,
          role: ORGANIZATION_ROLES.MEMBER,
          status: MEMBERSHIP_STATUSES.ACTIVE,
        },
        grants: [revokedGrant],
      }),
      action: PERMISSION_CODES.TASK_CREATE,
      resource: makeResource({ kind: 'TASK', projectId: PROJECT_X }),
      context: { now: NOW },
    });

    expect(decision.allowed).toBe(false);
  });

  it('Cenário 8: Concessão expirada é rejeitada mesmo com status ACTIVE persistido no banco', () => {
    const expiredGrant: PermissionGrant = {
      id: GRANT_1,
      organizationId: ORG_A,
      granteeUserId: USER_MEMBER,
      permission: PERMISSION_CODES.TASK_CREATE,
      scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
      scopeId: asEntityId(PROJECT_X as string),
      grantedByUserId: USER_ADMIN,
      grantedByRole: ORGANIZATION_ROLES.ADMIN,
      grantedAt: PAST,
      expiresAt: NOW,
      reason: 'Temporary task creation',
      status: GRANT_STATUSES.ACTIVE,
    };

    expect(deriveGrantStatus(expiredGrant, NOW)).toBe(GRANT_STATUSES.EXPIRED);
    expect(isGrantActiveAt(expiredGrant, NOW)).toBe(false);

    const decision = evaluateAuthorization({
      actor: makeActor({
        userId: USER_MEMBER,
        organizationMembership: {
          organizationId: ORG_A,
          role: ORGANIZATION_ROLES.MEMBER,
          status: MEMBERSHIP_STATUSES.ACTIVE,
        },
        participatedProjectIds: [PROJECT_X],
        grants: [expiredGrant],
      }),
      action: PERMISSION_CODES.TASK_CREATE,
      resource: makeResource({ kind: 'TASK', projectId: PROJECT_X }),
      context: { now: NOW },
    });

    expect(decision.allowed).toBe(false);
  });

  it('Cenário 9: Concessão feita por MANAGER acima da própria autoridade ou fora do escopo é rejeitada', () => {
    const managerGrantor = {
      userId: USER_MANAGER,
      organizationId: ORG_A,
      role: ORGANIZATION_ROLES.MANAGER,
      managedProjectIds: [PROJECT_X],
    } as const;

    // Delegação legítima dentro do Projeto X
    expect(
      canGrantorDelegatePermission(managerGrantor, PERMISSION_CODES.TASK_CREATE, {
        organizationId: ORG_A,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: asEntityId(PROJECT_X as string),
      }),
    ).toBe(true);

    // Proibido: Projeto Y fora do escopo, permissão exclusiva de ADMIN ou escopo organizacional
    expect(
      canGrantorDelegatePermission(managerGrantor, PERMISSION_CODES.TASK_CREATE, {
        organizationId: ORG_A,
        scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
        scopeId: asEntityId(PROJECT_Y as string),
      }),
    ).toBe(false);

    expect(
      canGrantorDelegatePermission(managerGrantor, PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE, {
        organizationId: ORG_A,
        scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
      }),
    ).toBe(false);

    // Mesmo que uma concessão ilegítima de MANAGER esteja persistida, o motor a rejeita na avaliação
    const illegitimateGrant: PermissionGrant = {
      id: GRANT_1,
      organizationId: ORG_A,
      granteeUserId: USER_MEMBER,
      permission: PERMISSION_CODES.TASK_CREATE,
      scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
      scopeId: asEntityId(PROJECT_Y as string),
      grantedByUserId: USER_MANAGER,
      grantedByRole: ORGANIZATION_ROLES.MANAGER,
      grantedByScopeIds: [asEntityId(PROJECT_X as string)],
      grantedAt: PAST,
      expiresAt: FUTURE,
      reason: 'Out-of-scope escalation attempt',
      status: GRANT_STATUSES.ACTIVE,
    };

    const decision = evaluateAuthorization({
      actor: makeActor({
        userId: USER_MEMBER,
        organizationMembership: {
          organizationId: ORG_A,
          role: ORGANIZATION_ROLES.MEMBER,
          status: MEMBERSHIP_STATUSES.ACTIVE,
        },
        participatedProjectIds: [PROJECT_Y],
        grants: [illegitimateGrant],
      }),
      action: PERMISSION_CODES.TASK_CREATE,
      resource: makeResource({ kind: 'TASK', projectId: PROJECT_Y }),
      context: { now: NOW },
    });

    expect(decision.allowed).toBe(false);
  });

  it('Cenário 10: Deny Overrides prevalece sobre papel ADMIN e sobre concessão ativa', () => {
    const activeGrant: PermissionGrant = {
      id: GRANT_1,
      organizationId: ORG_A,
      granteeUserId: USER_ADMIN,
      permission: PERMISSION_CODES.PROJECT_UPDATE,
      scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
      scopeId: asEntityId(PROJECT_X as string),
      grantedByUserId: USER_ADMIN,
      grantedByRole: ORGANIZATION_ROLES.ADMIN,
      grantedAt: PAST,
      expiresAt: FUTURE,
      reason: 'Explicit grant',
      status: GRANT_STATUSES.ACTIVE,
    };

    const explicitDeny: ExplicitDenyRule = {
      id: DENY_1,
      organizationId: ORG_A,
      targetUserId: USER_ADMIN,
      permission: PERMISSION_CODES.PROJECT_UPDATE,
      scopeType: PERMISSION_SCOPE_TYPES.PROJECT,
      scopeId: asEntityId(PROJECT_X as string),
      reason: 'Temporary freeze on project edits',
      createdByUserId: USER_ADMIN,
      createdAt: PAST,
      expiresAt: FUTURE,
    };

    const decision = evaluateAuthorization({
      actor: makeActor({
        grants: [activeGrant],
        explicitDenies: [explicitDeny],
      }),
      action: PERMISSION_CODES.PROJECT_UPDATE,
      resource: makeResource({ kind: 'PROJECT', projectId: PROJECT_X }),
      context: { now: NOW },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_EXPLICIT_DENY',
      errorCode: APP_ERROR_CODES.AUTHORIZATION_ERROR,
      matchedDenyId: DENY_1,
      requiresAudit: true,
    });
  });

  it('Cenário 11: MANAGER consulta apenas feedback atribuído e nunca notas internas de feedback não atribuído; autor MEMBER nunca vê notas internas', () => {
    const manager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
    });

    const assignedFeedback = makeResource({
      kind: 'FEEDBACK',
      feedbackId: FEEDBACK_1,
      createdBy: USER_MEMBER,
      assigneeId: USER_MANAGER,
    });
    const unassignedFeedback = makeResource({
      kind: 'FEEDBACK',
      feedbackId: FEEDBACK_1,
      createdBy: USER_MEMBER,
      assigneeId: USER_OTHER,
    });

    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.FEEDBACK_VIEW,
        resource: assignedFeedback,
        context: { now: NOW },
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
        resource: assignedFeedback,
        context: { now: NOW },
      }).allowed,
    ).toBe(true);

    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.FEEDBACK_VIEW,
        resource: unassignedFeedback,
        context: { now: NOW },
      }).allowed,
    ).toBe(false);
    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
        resource: unassignedFeedback,
        context: { now: NOW },
      }).allowed,
    ).toBe(false);

    // Autor MEMBER consulta o próprio feedback, mas nunca notas internas
    const authorMember = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
    });

    expect(
      evaluateAuthorization({
        actor: authorMember,
        action: PERMISSION_CODES.FEEDBACK_VIEW,
        resource: assignedFeedback,
        context: { now: NOW },
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAuthorization({
        actor: authorMember,
        action: PERMISSION_CODES.FEEDBACK_INTERNAL_NOTE_VIEW,
        resource: assignedFeedback,
        context: { now: NOW },
      }).allowed,
    ).toBe(false);
  });

  it('Cenário 12: MANAGER delegado analisa contestação, mas não pode decidir', () => {
    const analyzeGrant: PermissionGrant = {
      id: GRANT_1,
      organizationId: ORG_A,
      granteeUserId: USER_MANAGER,
      permission: PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE,
      scopeType: PERMISSION_SCOPE_TYPES.RESOURCE,
      scopeId: asEntityId(FEEDBACK_1 as string),
      grantedByUserId: USER_ADMIN,
      grantedByRole: ORGANIZATION_ROLES.ADMIN,
      grantedAt: PAST,
      expiresAt: FUTURE,
      reason: 'Delegated contest analysis',
      status: GRANT_STATUSES.ACTIVE,
    };

    const delegatedManager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      grants: [analyzeGrant],
    });

    const contestResource = makeResource({
      kind: 'FEEDBACK_CONTEST',
      feedbackId: FEEDBACK_1,
    });

    expect(
      evaluateAuthorization({
        actor: delegatedManager,
        action: PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE,
        resource: contestResource,
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: true, reasonCode: 'ALLOWED_BY_GRANT', matchedGrantId: GRANT_1 });

    expect(
      evaluateAuthorization({
        actor: delegatedManager,
        action: PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE,
        resource: contestResource,
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_INSUFFICIENT_ROLE' });
  });

  it('Cenário 13: Somente ADMIN decide contestação e aprova reabertura excepcional', () => {
    const admin = makeActor();
    const manager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
    });

    for (const action of [
      PERMISSION_CODES.FEEDBACK_CONTEST_DECIDE,
      PERMISSION_CODES.FEEDBACK_REOPEN_DECIDE,
    ]) {
      expect(
        evaluateAuthorization({
          actor: admin,
          action,
          resource: makeResource({ feedbackId: FEEDBACK_1 }),
          context: { now: NOW },
        }).allowed,
      ).toBe(true);

      expect(
        evaluateAuthorization({
          actor: manager,
          action,
          resource: makeResource({ feedbackId: FEEDBACK_1 }),
          context: { now: NOW },
        }).allowed,
      ).toBe(false);
    }
  });

  it('Cenário 14: MEMBER não consulta auditoria diretamente', () => {
    const member = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [PROJECT_X],
    });

    for (const action of [
      PERMISSION_CODES.AUDIT_PROJECT_VIEW,
      PERMISSION_CODES.AUDIT_ORGANIZATION_VIEW,
      PERMISSION_CODES.AUDIT_EXPORT,
    ]) {
      expect(
        evaluateAuthorization({
          actor: member,
          action,
          resource: makeResource({ kind: 'AUDIT', projectId: PROJECT_X }),
          context: { now: NOW },
        }),
      ).toMatchObject({ allowed: false, reasonCode: 'DENIED_INSUFFICIENT_ROLE' });
    }
  });

  it('Cenário 15: Analytics, relatórios e exportações bloqueiam recursos fora do escopo e métricas individuais de terceiros sob Default Deny', () => {
    const member = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [PROJECT_X],
    });
    const manager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      managedProjectIds: [PROJECT_X],
    });

    // Projeto Y fora do escopo negado em analytics e relatórios/exportações
    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
        resource: makeResource({ kind: 'ANALYTICS', projectId: PROJECT_Y }),
        context: { now: NOW },
      }).allowed,
    ).toBe(false);
    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.REPORT_EXPORT,
        resource: makeResource({ kind: 'REPORT', projectId: PROJECT_Y }),
        context: { now: NOW },
      }).allowed,
    ).toBe(false);

    // Produtividade individual de terceiros bloqueada para MANAGER por Default Deny (§12)
    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.ANALYTICS_PROJECT_VIEW,
        resource: makeResource({
          kind: 'ANALYTICS',
          projectId: PROJECT_X,
          includesThirdPartyIndividualMetrics: true,
        }),
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_POLICY_DEFAULT_DENY' });
  });

  it('Cenário 16: Notificação própria não concede acesso a recurso cujo acesso foi revogado', () => {
    const memberWithoutProject = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [],
    });

    // Usuário ainda pode listar a própria notificação
    expect(
      evaluateAuthorization({
        actor: memberWithoutProject,
        action: PERMISSION_CODES.NOTIFICATION_VIEW,
        resource: makeResource({ kind: 'NOTIFICATION', ownerUserId: USER_MEMBER }),
        context: { now: NOW },
      }).allowed,
    ).toBe(true);

    // Mas revalidar o recurso de destino bloqueia a abertura porque o acesso ao projeto foi revogado
    expect(
      evaluateAuthorization({
        actor: memberWithoutProject,
        action: PERMISSION_CODES.TASK_VIEW,
        resource: makeResource({
          kind: 'TASK',
          projectId: PROJECT_X,
          taskId: TASK_1,
          assigneeId: USER_MEMBER,
        }),
        context: { now: NOW },
      }).allowed,
    ).toBe(false);
  });

  it('Cenário 17: ADMIN comum não executa manutenção demo sem permissão especial demo.maintenance.*', () => {
    const ordinaryAdmin = makeActor();

    expect(
      evaluateAuthorization({
        actor: ordinaryAdmin,
        action: PERMISSION_CODES.DEMO_MAINTENANCE_VIEW,
        resource: makeResource({ kind: 'DEMO' }),
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_REQUIRES_SPECIAL_GRANT' });

    expect(
      evaluateAuthorization({
        actor: ordinaryAdmin,
        action: PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE,
        resource: makeResource({ kind: 'DEMO', confirmedExplicitly: true }),
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_REQUIRES_SPECIAL_GRANT' });

    const specialGrant: PermissionGrant = {
      id: GRANT_1,
      organizationId: ORG_A,
      granteeUserId: USER_ADMIN,
      permission: PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE,
      scopeType: PERMISSION_SCOPE_TYPES.ORGANIZATION,
      grantedByUserId: USER_ADMIN,
      grantedByRole: ORGANIZATION_ROLES.ADMIN,
      grantedByHasSpecialAuthority: true,
      grantedAt: PAST,
      expiresAt: FUTURE,
      reason: 'Authorized demo reset capability',
      status: GRANT_STATUSES.ACTIVE,
    };

    const adminWithGrant = makeActor({ grants: [specialGrant] });

    // Sem confirmação explícita -> CONFLICT
    expect(
      evaluateAuthorization({
        actor: adminWithGrant,
        action: PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE,
        resource: makeResource({ kind: 'DEMO', confirmedExplicitly: false }),
        context: { now: NOW },
      }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_CONFIRMATION_REQUIRED',
      errorCode: APP_ERROR_CODES.CONFLICT,
    });

    // Com concessão especial e confirmação explícita -> permitido
    expect(
      evaluateAuthorization({
        actor: adminWithGrant,
        action: PERMISSION_CODES.DEMO_MAINTENANCE_RESTORE,
        resource: makeResource({ kind: 'DEMO', confirmedExplicitly: true }),
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: true, reasonCode: 'ALLOWED_BY_GRANT' });
  });

  it('Cenário 18: Projeto arquivado bloqueia mutações operacionais até para ADMIN, mas permite consulta e project.restore', () => {
    const admin = makeActor();
    const archivedProjectResource = makeResource({
      kind: 'PROJECT',
      projectId: PROJECT_X,
      archivedAt: PAST,
    });

    expect(
      evaluateAuthorization({
        actor: admin,
        action: PERMISSION_CODES.TASK_MOVE,
        resource: makeResource({ kind: 'TASK', projectId: PROJECT_X, projectArchivedAt: PAST }),
        context: { now: NOW },
      }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_PROJECT_ARCHIVED',
      errorCode: APP_ERROR_CODES.CONFLICT,
    });

    expect(
      evaluateAuthorization({
        actor: admin,
        action: PERMISSION_CODES.PROJECT_UPDATE,
        resource: archivedProjectResource,
        context: { now: NOW },
      }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_PROJECT_ARCHIVED',
      errorCode: APP_ERROR_CODES.CONFLICT,
    });

    expect(
      evaluateAuthorization({
        actor: admin,
        action: PERMISSION_CODES.PROJECT_RESTORE,
        resource: archivedProjectResource,
        context: { now: NOW },
      }).allowed,
    ).toBe(true);
  });

  it('Cenário 19: Exclusão lógica bloqueia operações normais e restringe acesso a trash.* validando escopo', () => {
    const admin = makeActor();
    const manager = makeActor({
      userId: USER_MANAGER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MANAGER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      managedProjectIds: [PROJECT_X],
    });
    const member = makeActor({
      userId: USER_MEMBER,
      organizationMembership: {
        organizationId: ORG_A,
        role: ORGANIZATION_ROLES.MEMBER,
        status: MEMBERSHIP_STATUSES.ACTIVE,
      },
      participatedProjectIds: [PROJECT_X],
    });

    const deletedTaskX = makeResource({
      kind: 'TASK',
      projectId: PROJECT_X,
      taskId: TASK_1,
      deletedAt: PAST,
    });

    expect(
      evaluateAuthorization({
        actor: admin,
        action: PERMISSION_CODES.TASK_VIEW,
        resource: deletedTaskX,
        context: { now: NOW },
      }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'DENIED_RESOURCE_DELETED',
      errorCode: APP_ERROR_CODES.CONFLICT,
    });

    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.TRASH_RESTORE,
        resource: deletedTaskX,
        context: { now: NOW },
      }).allowed,
    ).toBe(true);

    expect(
      evaluateAuthorization({
        actor: manager,
        action: PERMISSION_CODES.TRASH_RESTORE,
        resource: { ...deletedTaskX, projectId: PROJECT_Y },
        context: { now: NOW },
      }).allowed,
    ).toBe(false);

    expect(
      evaluateAuthorization({
        actor: member,
        action: PERMISSION_CODES.TRASH_VIEW,
        resource: deletedTaskX,
        context: { now: NOW },
      }),
    ).toMatchObject({ allowed: false, reasonCode: 'DENIED_POLICY_DEFAULT_DENY' });
  });

  it('Cenário 20: assertAuthorized lança erros tipados de §10 e sinaliza auditoria em tentativas negadas sensíveis', () => {
    // AUTHENTICATION_ERROR
    expect(() =>
      assertAuthorized({
        actor: { isAuthenticated: false },
        action: PERMISSION_CODES.TASK_VIEW,
        resource: makeResource({ projectId: PROJECT_X }),
        context: { now: NOW },
      }),
    ).toThrow(AuthenticationError);

    // NOT_FOUND
    expect(() =>
      assertAuthorized({
        actor: makeActor(),
        action: PERMISSION_CODES.PROJECT_VIEW,
        resource: makeResource({ exists: false }),
        context: { now: NOW },
      }),
    ).toThrow(NotFoundError);

    // CONFLICT (projeto arquivado)
    expect(() =>
      assertAuthorized({
        actor: makeActor(),
        action: PERMISSION_CODES.TASK_CREATE,
        resource: makeResource({ projectId: PROJECT_X, projectArchivedAt: PAST }),
        context: { now: NOW },
      }),
    ).toThrow(ConflictError);

    // AUTHORIZATION_ERROR + requiresAudit
    let caughtError: unknown;
    try {
      assertAuthorized({
        actor: makeActor({
          userId: USER_MEMBER,
          organizationMembership: {
            organizationId: ORG_A,
            role: ORGANIZATION_ROLES.MEMBER,
            status: MEMBERSHIP_STATUSES.ACTIVE,
          },
        }),
        action: PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE,
        resource: makeResource({ kind: 'ORGANIZATION' }),
        context: { now: NOW },
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AuthorizationError);
    expect((caughtError as AuthorizationError).details).toMatchObject({
      action: PERMISSION_CODES.ORGANIZATION_ROLES_MANAGE,
      requiresAudit: true,
    });
  });
});
