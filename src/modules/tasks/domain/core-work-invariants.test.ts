import { describe, expect, it } from 'vitest';
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  IMPEDIMENT_SEVERITIES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  TASK_STATUSES,
  asBoardColumnId,
  asBoardId,
  asImpedimentId,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asSubtaskId,
  asTaskId,
  asUserId,
} from '@/shared/kernel';
import {
  assertNoDependencyCycle,
  asTaskDependencyId,
  getPendingRequiredDependencies,
  hasDependencyCycle,
  type DependencyEdge,
  type TaskDependency,
} from '@/modules/dependencies';
import {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_STATUSES,
  assertImpedimentTransitionAllowed,
  isImpedimentBlocking,
  type Impediment,
} from '@/modules/impediments';
import {
  DEFAULT_INVITATION_EXPIRY_DAYS,
  DEFAULT_INVITATION_INITIAL_ROLE,
  INVITATION_STATUSES,
  asInvitationId,
  assertInvitationCanBeAccepted,
  deriveInvitationStatus,
  type Invitation,
} from '@/modules/invitations';
import {
  BOARD_COLUMN_ROLES,
  assertCardMoveAllowed,
  assertColumnCanBeDeleted,
  assertValidBoardColumns,
  assertWipAllowsCardMove,
  doesTaskStatusOccupyWip,
  type BoardColumn,
} from '@/modules/kanban';
import {
  asOrganizationMemberId,
  assertCanChangeOrRemoveAdmin,
  type OrganizationMember,
} from '@/modules/organizations';
import {
  SUBTASK_STATUSES,
  asTaskCommentId,
  asTaskExecutionCycleId,
  asTaskPauseId,
  assertTaskCanBeCancelled,
  assertTaskCanBeCompleted,
  assertTaskCommentEditable,
  assertTaskPauseJustification,
  assertTaskReopenCreatesNewCycle,
  calculateTaskEffectiveDurationMs,
  validateTaskAttachmentSize,
  type Subtask,
  type TaskComment,
  type TaskExecutionCycle,
  type TaskPause,
} from '../index';

const ORG_A = asOrganizationId('11000000-0000-4000-8000-000000000001');
const ORG_B = asOrganizationId('11000000-0000-4000-8000-000000000002');
const USER_1 = asUserId('21000000-0000-4000-8000-000000000001');
const USER_2 = asUserId('21000000-0000-4000-8000-000000000002');
const PROJECT_1 = asProjectId('31000000-0000-4000-8000-000000000001');
const BOARD_1 = asBoardId('41000000-0000-4000-8000-000000000001');
const BOARD_2 = asBoardId('41000000-0000-4000-8000-000000000002');
const COL_TODO = asBoardColumnId('42000000-0000-4000-8000-000000000001');
const COL_DOING = asBoardColumnId('42000000-0000-4000-8000-000000000002');
const COL_DONE = asBoardColumnId('42000000-0000-4000-8000-000000000003');
const TASK_A = asTaskId('51000000-0000-4000-8000-000000000001');
const TASK_B = asTaskId('51000000-0000-4000-8000-000000000002');
const TASK_C = asTaskId('51000000-0000-4000-8000-000000000003');
const SUBTASK_1 = asSubtaskId('52000000-0000-4000-8000-000000000001');
const SUBTASK_2 = asSubtaskId('52000000-0000-4000-8000-000000000002');
const IMPEDIMENT_1 = asImpedimentId('53000000-0000-4000-8000-000000000001');
const CYCLE_1 = asTaskExecutionCycleId('54000000-0000-4000-8000-000000000001');
const CYCLE_2 = asTaskExecutionCycleId('54000000-0000-4000-8000-000000000002');
const PAUSE_1 = asTaskPauseId('55000000-0000-4000-8000-000000000001');
const PAUSE_2 = asTaskPauseId('55000000-0000-4000-8000-000000000002');

const T0 = asIsoDateTime('2026-11-01T09:00:00Z');
const T1 = asIsoDateTime('2026-11-01T10:00:00Z');
const T2 = asIsoDateTime('2026-11-01T11:00:00Z');
const T3 = asIsoDateTime('2026-11-01T12:00:00Z');
const T4 = asIsoDateTime('2026-11-01T13:00:00Z');
const T5 = asIsoDateTime('2026-11-01T14:00:00Z');

function makeColumn(overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: COL_DOING,
    organizationId: ORG_A,
    boardId: BOARD_1,
    name: 'Em Progresso',
    columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
    order: 1,
    wipLimit: 2,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('Organizations — Last Active ADMIN Protection', () => {
  it('blocks removing or demoting the last active ADMIN and allows when another active ADMIN exists', () => {
    const soleAdmin: OrganizationMember = {
      id: asOrganizationMemberId('61000000-0000-4000-8000-000000000001'),
      organizationId: ORG_A,
      userId: USER_1,
      role: ORGANIZATION_ROLES.ADMIN,
      status: MEMBERSHIP_STATUSES.ACTIVE,
      joinedAt: T0,
      updatedAt: T0,
    };
    const suspendedAdmin: OrganizationMember = {
      id: asOrganizationMemberId('61000000-0000-4000-8000-000000000002'),
      organizationId: ORG_A,
      userId: USER_2,
      role: ORGANIZATION_ROLES.ADMIN,
      status: MEMBERSHIP_STATUSES.SUSPENDED,
      joinedAt: T0,
      suspendedAt: T1,
      updatedAt: T1,
    };

    expect(() => assertCanChangeOrRemoveAdmin([soleAdmin, suspendedAdmin], USER_1)).toThrow(
      ConflictError,
    );

    const secondActiveAdmin: OrganizationMember = {
      ...suspendedAdmin,
      status: MEMBERSHIP_STATUSES.ACTIVE,
    };
    expect(() =>
      assertCanChangeOrRemoveAdmin([soleAdmin, secondActiveAdmin], USER_1),
    ).not.toThrow();
  });
});

describe('Invitations — Expiry and Anti-Reuse Invariants', () => {
  it('enforces 15-day default expiry, MEMBER default role, and blocks reuse of accepted/revoked/expired invitations', () => {
    expect(DEFAULT_INVITATION_EXPIRY_DAYS).toBe(15);
    expect(DEFAULT_INVITATION_INITIAL_ROLE).toBe(ORGANIZATION_ROLES.MEMBER);

    const pendingInvitation: Invitation = {
      id: asInvitationId('62000000-0000-4000-8000-000000000001'),
      organizationId: ORG_A,
      email: 'member@example.com',
      code: 'INV-001',
      tokenHashOrCode: 'hash-inv-001',
      initialRole: DEFAULT_INVITATION_INITIAL_ROLE,
      status: INVITATION_STATUSES.PENDING,
      invitedByUserId: USER_1,
      createdAt: asIsoDateTime('2026-11-01T00:00:00Z'),
      expiresAt: asIsoDateTime('2026-11-16T00:00:00Z'),
    };

    expect(deriveInvitationStatus(pendingInvitation, asIsoDateTime('2026-11-10T00:00:00Z'))).toBe(
      INVITATION_STATUSES.PENDING,
    );
    expect(() =>
      assertInvitationCanBeAccepted(pendingInvitation, asIsoDateTime('2026-11-10T00:00:00Z')),
    ).not.toThrow();

    // Expired even if persisted status is still PENDING
    expect(deriveInvitationStatus(pendingInvitation, asIsoDateTime('2026-11-16T00:00:00Z'))).toBe(
      INVITATION_STATUSES.EXPIRED,
    );
    expect(() =>
      assertInvitationCanBeAccepted(pendingInvitation, asIsoDateTime('2026-11-16T00:00:00Z')),
    ).toThrow(ConflictError);

    // Already accepted
    const acceptedInvitation: Invitation = {
      ...pendingInvitation,
      status: INVITATION_STATUSES.ACCEPTED,
      acceptedAt: T1,
      acceptedByUserId: USER_2,
    };
    expect(() => assertInvitationCanBeAccepted(acceptedInvitation, T2)).toThrow(ConflictError);

    // Revoked
    const revokedInvitation: Invitation = {
      ...pendingInvitation,
      status: INVITATION_STATUSES.REVOKED,
      revokedAt: T1,
      revokedByUserId: USER_1,
    };
    expect(() => assertInvitationCanBeAccepted(revokedInvitation, T2)).toThrow(ConflictError);
  });
});

describe('Kanban — Board Columns, WIP Limits & Card Movement Invariants', () => {
  it('enforces mandatory 1 operational + 1 final active column and blocks unsafe column deletion', () => {
    const colInitial = makeColumn({
      id: COL_TODO,
      name: 'A Fazer',
      columnRole: BOARD_COLUMN_ROLES.INITIAL,
      order: 0,
      wipLimit: null,
    });
    const colDoing = makeColumn({
      id: COL_DOING,
      name: 'Em Progresso',
      columnRole: BOARD_COLUMN_ROLES.OPERATIONAL,
      order: 1,
      wipLimit: 2,
    });
    const colDone = makeColumn({
      id: COL_DONE,
      name: 'Concluído',
      columnRole: BOARD_COLUMN_ROLES.FINAL,
      order: 2,
      wipLimit: null,
    });

    expect(() => assertValidBoardColumns([colInitial, colDoing, colDone])).not.toThrow();
    expect(() => assertValidBoardColumns([colInitial, colDoing])).toThrow(ConflictError);
    expect(() => assertValidBoardColumns([colDone])).toThrow(ConflictError);

    // Cannot delete column with tasks without migration target
    expect(() => assertColumnCanBeDeleted(colDoing, [colInitial, colDoing, colDone], 3)).toThrow(
      ConflictError,
    );

    // Cannot migrate to another board or organization
    expect(() =>
      assertColumnCanBeDeleted(
        colDoing,
        [colInitial, colDoing, colDone],
        2,
        makeColumn({ id: COL_TODO, boardId: BOARD_2 }),
      ),
    ).toThrow(ConflictError);
    expect(() =>
      assertColumnCanBeDeleted(
        colDoing,
        [colInitial, colDoing, colDone],
        2,
        makeColumn({ id: COL_TODO, organizationId: ORG_B }),
      ),
    ).toThrow(AuthorizationError);

    // Valid deletion with migration target
    expect(() =>
      assertColumnCanBeDeleted(colDoing, [colInitial, colDoing, colDone], 2, colInitial),
    ).not.toThrow();

    // Cannot delete last final column even when empty
    expect(() => assertColumnCanBeDeleted(colDone, [colInitial, colDone], 0)).toThrow(
      ConflictError,
    );
  });

  it('counts BLOCKED toward WIP, excludes DONE/CANCELLED, blocks WIP overflow by default and audits authorized exceptions', () => {
    expect(doesTaskStatusOccupyWip(TASK_STATUSES.TODO)).toBe(true);
    expect(doesTaskStatusOccupyWip(TASK_STATUSES.IN_PROGRESS)).toBe(true);
    expect(doesTaskStatusOccupyWip(TASK_STATUSES.PAUSED)).toBe(true);
    expect(doesTaskStatusOccupyWip(TASK_STATUSES.BLOCKED)).toBe(true);
    expect(doesTaskStatusOccupyWip(TASK_STATUSES.DONE)).toBe(false);
    expect(doesTaskStatusOccupyWip(TASK_STATUSES.CANCELLED)).toBe(false);

    const doingCol = makeColumn({ wipLimit: 2 });

    // BLOCKED task exceeding WIP limit (2 -> 3) is rejected by default
    expect(() =>
      assertWipAllowsCardMove({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 2,
        movingTaskStatus: TASK_STATUSES.BLOCKED,
      }),
    ).toThrow(ConflictError);

    // DONE / CANCELLED does not occupy WIP
    expect(
      assertWipAllowsCardMove({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 2,
        movingTaskStatus: TASK_STATUSES.DONE,
      }),
    ).toEqual({ allowed: true, exceededWip: false, requiresAudit: false });

    // Unauthorized WIP exception throws AuthorizationError; empty justification throws ValidationError
    expect(() =>
      assertWipAllowsCardMove({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 2,
        movingTaskStatus: TASK_STATUSES.IN_PROGRESS,
        wipException: { authorized: false, justification: 'Urgent' },
      }),
    ).toThrow(AuthorizationError);

    expect(() =>
      assertWipAllowsCardMove({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 2,
        movingTaskStatus: TASK_STATUSES.IN_PROGRESS,
        wipException: { authorized: true, justification: '   ' },
      }),
    ).toThrow(ValidationError);

    // Authorized + justified exception succeeds and requires audit
    expect(
      assertWipAllowsCardMove({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 2,
        movingTaskStatus: TASK_STATUSES.IN_PROGRESS,
        wipException: { authorized: true, justification: 'Critical production hotfix' },
      }),
    ).toEqual({ allowed: true, exceededWip: true, requiresAudit: true });
  });

  it('blocks card movement on archived projects and paused tasks without authorized exception', () => {
    const doingCol = makeColumn({ wipLimit: 5 });

    expect(() =>
      assertCardMoveAllowed({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 1,
        movingTaskStatus: TASK_STATUSES.IN_PROGRESS,
        projectArchived: true,
        isTaskPaused: false,
      }),
    ).toThrow(ConflictError);

    expect(() =>
      assertCardMoveAllowed({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 1,
        movingTaskStatus: TASK_STATUSES.PAUSED,
        projectArchived: false,
        isTaskPaused: true,
      }),
    ).toThrow(ConflictError);

    expect(
      assertCardMoveAllowed({
        targetColumn: doingCol,
        currentColumnOccupyingTaskCount: 1,
        movingTaskStatus: TASK_STATUSES.PAUSED,
        projectArchived: false,
        isTaskPaused: true,
        pausedMoveException: { authorized: true, justification: 'Manager override for triage' },
      }),
    ).toEqual({ allowed: true, exceededWip: false, requiresAudit: true });
  });
});

describe('Dependencies — Cycle Detection & Pending Required Dependencies', () => {
  it('detects self-dependency, direct cycle (A->B->A) and indirect cycle (A->B->C->A)', () => {
    // Self-dependency
    expect(hasDependencyCycle([], { taskId: TASK_A, dependsOnTaskId: TASK_A })).toBe(true);
    expect(() => assertNoDependencyCycle([], { taskId: TASK_A, dependsOnTaskId: TASK_A })).toThrow(
      ConflictError,
    );

    // Direct cycle A -> B -> A
    const directExisting: DependencyEdge[] = [{ taskId: TASK_A, dependsOnTaskId: TASK_B }];
    expect(hasDependencyCycle(directExisting, { taskId: TASK_B, dependsOnTaskId: TASK_A })).toBe(
      true,
    );
    expect(() =>
      assertNoDependencyCycle(directExisting, { taskId: TASK_B, dependsOnTaskId: TASK_A }),
    ).toThrow(ConflictError);

    // Indirect cycle A -> B -> C -> A
    const indirectExisting: DependencyEdge[] = [
      { taskId: TASK_A, dependsOnTaskId: TASK_B },
      { taskId: TASK_B, dependsOnTaskId: TASK_C },
    ];
    expect(hasDependencyCycle(indirectExisting, { taskId: TASK_C, dependsOnTaskId: TASK_A })).toBe(
      true,
    );
    expect(() =>
      assertNoDependencyCycle(indirectExisting, { taskId: TASK_C, dependsOnTaskId: TASK_A }),
    ).toThrow(ConflictError);

    // Valid acyclic edge A -> C
    expect(hasDependencyCycle(indirectExisting, { taskId: TASK_A, dependsOnTaskId: TASK_C })).toBe(
      false,
    );
    expect(() =>
      assertNoDependencyCycle(indirectExisting, { taskId: TASK_A, dependsOnTaskId: TASK_C }),
    ).not.toThrow();
  });

  it('returns only unfinished required dependencies for the target task', () => {
    const deps: TaskDependency[] = [
      {
        id: asTaskDependencyId('71000000-0000-4000-8000-000000000001'),
        organizationId: ORG_A,
        projectId: PROJECT_1,
        taskId: TASK_A,
        dependsOnTaskId: TASK_B,
        required: true,
        createdByUserId: USER_1,
        createdAt: T0,
      },
      {
        id: asTaskDependencyId('71000000-0000-4000-8000-000000000002'),
        organizationId: ORG_A,
        projectId: PROJECT_1,
        taskId: TASK_A,
        dependsOnTaskId: TASK_C,
        required: false,
        createdByUserId: USER_1,
        createdAt: T0,
      },
    ];

    expect(getPendingRequiredDependencies(TASK_A, deps, new Set())).toHaveLength(1);
    expect(getPendingRequiredDependencies(TASK_A, deps, new Set([TASK_B]))).toHaveLength(0);
  });
});

describe('Tasks & Impediments — Completion, Pauses, Reopen Cycles & Attachments', () => {
  it('enforces required subtasks, blocking impediments, dependency exceptions and non-auto-completing impediments', () => {
    const openRequiredSubtask: Subtask = {
      id: SUBTASK_1,
      organizationId: ORG_A,
      taskId: TASK_A,
      title: 'Checklist obrigatório',
      required: true,
      status: SUBTASK_STATUSES.OPEN,
      order: 0,
      createdAt: T0,
      updatedAt: T0,
    };
    const doneRequiredSubtask: Subtask = {
      ...openRequiredSubtask,
      id: SUBTASK_2,
      status: SUBTASK_STATUSES.DONE,
      completedAt: T1,
    };

    expect(() =>
      assertTaskCanBeCompleted({
        requiredSubtasks: [openRequiredSubtask],
        pendingRequiredDependencyIds: [],
        openBlockingImpedimentIds: [],
      }),
    ).toThrow(ConflictError);

    expect(() =>
      assertTaskCanBeCompleted({
        requiredSubtasks: [doneRequiredSubtask],
        pendingRequiredDependencyIds: [],
        openBlockingImpedimentIds: [IMPEDIMENT_1],
      }),
    ).toThrow(ConflictError);

    expect(() =>
      assertTaskCanBeCompleted({
        requiredSubtasks: [doneRequiredSubtask],
        pendingRequiredDependencyIds: [TASK_B],
        openBlockingImpedimentIds: [],
      }),
    ).toThrow(ConflictError);

    expect(
      assertTaskCanBeCompleted({
        requiredSubtasks: [doneRequiredSubtask],
        pendingRequiredDependencyIds: [TASK_B],
        openBlockingImpedimentIds: [],
        dependencyException: { authorized: true, justification: 'Approved parallel delivery' },
      }),
    ).toEqual({ allowed: true, usedDependencyException: true, requiresAudit: true });

    // Resolving an impediment NEVER auto-completes the task
    const openImpediment: Impediment = {
      id: IMPEDIMENT_1,
      organizationId: ORG_A,
      projectId: PROJECT_1,
      taskId: TASK_A,
      category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
      severity: IMPEDIMENT_SEVERITIES.HIGH,
      description: 'API spec pending',
      status: IMPEDIMENT_STATUSES.OPEN,
      openedByUserId: USER_1,
      openedAt: T0,
      updatedAt: T0,
    };
    expect(isImpedimentBlocking(openImpediment)).toBe(true);
    expect(
      assertImpedimentTransitionAllowed(IMPEDIMENT_STATUSES.OPEN, IMPEDIMENT_STATUSES.RESOLVED),
    ).toEqual({ allowed: true, autoCompletesTask: false });
    expect(() =>
      assertImpedimentTransitionAllowed(IMPEDIMENT_STATUSES.RESOLVED, IMPEDIMENT_STATUSES.OPEN),
    ).toThrow(ConflictError);

    // Comment immutability and justification requirements
    const systemComment: TaskComment = {
      id: asTaskCommentId('72000000-0000-4000-8000-000000000001'),
      organizationId: ORG_A,
      taskId: TASK_A,
      authorUserId: USER_1,
      body: 'Status changed automatically',
      isSystem: true,
      createdAt: T0,
      updatedAt: T0,
    };
    expect(() => assertTaskCommentEditable(systemComment)).toThrow(ConflictError);
    expect(() => assertTaskPauseJustification('   ')).toThrow(ValidationError);
    expect(() => assertTaskCanBeCancelled('')).toThrow(ValidationError);
  });

  it('computes effective duration (total - pauses), rejects invalid/overlapping pauses and creates new cycle on reopen', () => {
    const cycle1: TaskExecutionCycle = {
      id: CYCLE_1,
      organizationId: ORG_A,
      projectId: PROJECT_1,
      taskId: TASK_A,
      cycleNumber: 1,
      startedAt: T0,
      effectiveStartedAt: T0,
      completedAt: T5, // 5 hours total
    };
    const pauses: TaskPause[] = [
      {
        id: PAUSE_1,
        organizationId: ORG_A,
        taskId: TASK_A,
        cycleId: CYCLE_1,
        startedAt: T1,
        endedAt: T2, // 1 hour
        startedByUserId: USER_1,
        reason: 'Waiting client info',
      },
      {
        id: PAUSE_2,
        organizationId: ORG_A,
        taskId: TASK_A,
        cycleId: CYCLE_1,
        startedAt: T3,
        endedAt: T4, // 1 hour
        startedByUserId: USER_1,
        reason: 'Infra maintenance',
      },
    ];

    const duration = calculateTaskEffectiveDurationMs(cycle1, pauses, T5);
    const HOUR_MS = 60 * 60 * 1000;
    expect(duration).toEqual({
      totalDurationMs: 5 * HOUR_MS,
      pausedDurationMs: 2 * HOUR_MS,
      effectiveDurationMs: 3 * HOUR_MS,
    });

    // Overlapping pauses rejected
    expect(() =>
      calculateTaskEffectiveDurationMs(
        cycle1,
        [
          { ...pauses[0]!, startedAt: T1, endedAt: T3 },
          { ...pauses[1]!, startedAt: T2, endedAt: T4 },
        ],
        T5,
      ),
    ).toThrow(ValidationError);

    // Negative pause interval rejected
    expect(() =>
      calculateTaskEffectiveDurationMs(cycle1, [{ ...pauses[0]!, startedAt: T3, endedAt: T2 }], T5),
    ).toThrow(ValidationError);

    // Reopening creates cycle 2 while preserving cycle 1
    const cycle2 = assertTaskReopenCreatesNewCycle([cycle1], T5, CYCLE_2, 'Regression found');
    expect(cycle2).toMatchObject({
      id: CYCLE_2,
      organizationId: ORG_A,
      projectId: PROJECT_1,
      taskId: TASK_A,
      cycleNumber: 2,
      reopenedFromCycleId: CYCLE_1,
      reopenReason: 'Regression found',
      startedAt: T5,
    });
    expect(cycle1.completedAt).toBe(T5);

    // Cannot reopen while cycle 2 is still open
    expect(() => assertTaskReopenCreatesNewCycle([cycle1, cycle2], T5, CYCLE_2)).toThrow(
      ConflictError,
    );
  });

  it('rejects task attachments over 15 MB per file or 50 MB cumulative context', () => {
    expect(() => validateTaskAttachmentSize(0, MAX_ATTACHMENT_SIZE_BYTES)).not.toThrow();
    expect(() => validateTaskAttachmentSize(0, MAX_ATTACHMENT_SIZE_BYTES + 1)).toThrow(
      ValidationError,
    );
    expect(() =>
      validateTaskAttachmentSize(MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES - 1000, 1001),
    ).toThrow(ValidationError);
  });
});
