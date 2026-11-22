import { describe, expect, it } from 'vitest';
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  ORGANIZATION_ROLES,
  PRIORITIES,
  asBackupId,
  asEventId,
  asFeedbackContestId,
  asFeedbackCycleId,
  asFeedbackId,
  asIsoDate,
  asIsoDateTime,
  asOrganizationId,
  asUserId,
} from '@/shared/kernel';
import {
  BACKUP_KINDS,
  MAX_AUTOMATIC_DAILY_BACKUPS,
  assertBackupMatchesTargetOrganization,
  selectExpiredAutoBackupsForRetention,
  type Backup,
} from '@/modules/backups';
import { buildNotificationDeduplicationKey } from '@/modules/notifications';
import { createDefaultOrganizationSettings } from '@/modules/settings';
import {
  CONTEST_RECOMMENDATIONS,
  CONTEST_STATUSES,
  CYCLE_ORIGINS,
  FEEDBACK_CLOSURE_REASONS,
  FEEDBACK_STATUSES,
  asFeedbackContestAnalysisId,
  asFeedbackSlaSnapshotId,
  assertCategoryDeletionAllowed,
  assertContestCanBeOpened,
  assertContestDecisionValid,
  assertExceptionalReopenAllowed,
  autoCloseResolvedFeedback,
  calculateSlaElapsedMs,
  canAutoCloseResolvedFeedback,
  confirmFeedbackResolution,
  createReopenedFeedbackCycle,
  evaluateSlaStatus,
  type FeedbackContestAnalysis,
  type FeedbackCycle,
  type FeedbackSlaSnapshot,
} from '../index';

const ORG_A = asOrganizationId('13000000-0000-4000-8000-000000000001');
const ORG_B = asOrganizationId('13000000-0000-4000-8000-000000000002');
const USER_AUTHOR = asUserId('23000000-0000-4000-8000-000000000001');
const USER_MANAGER = asUserId('23000000-0000-4000-8000-000000000002');
const USER_ADMIN = asUserId('23000000-0000-4000-8000-000000000003');
const FEEDBACK_1 = asFeedbackId('33000000-0000-4000-8000-000000000001');
const CYCLE_1 = asFeedbackCycleId('34000000-0000-4000-8000-000000000001');
const CYCLE_2 = asFeedbackCycleId('34000000-0000-4000-8000-000000000002');
const SLA_1 = asFeedbackSlaSnapshotId('35000000-0000-4000-8000-000000000001');
const SLA_2 = asFeedbackSlaSnapshotId('35000000-0000-4000-8000-000000000002');
const CONTEST_1 = asFeedbackContestId('36000000-0000-4000-8000-000000000001');

const HOUR_MS = 60 * 60 * 1000;

function makeBusinessHoursSnapshot(
  overrides: Partial<FeedbackSlaSnapshot> = {},
): FeedbackSlaSnapshot {
  return {
    id: SLA_1,
    organizationId: ORG_A,
    feedbackId: FEEDBACK_1,
    cycleId: CYCLE_1,
    prioritySnapshot: PRIORITIES.HIGH,
    calendarMode: 'BUSINESS_HOURS',
    workDaysOfWeekUtc: [1, 2, 3, 4, 5], // Mon–Fri
    workStartHourUtc: 9,
    workEndHourUtc: 18,
    breakIntervalsUtc: [{ startHour: 12, endHour: 13 }], // 8h/day effective
    holidayDates: [asIsoDate('2026-11-17')], // Tuesday holiday
    firstResponseTargetMs: 4 * HOUR_MS,
    resolutionTargetMs: 16 * HOUR_MS,
    manifestationWindowMs: 5 * 24 * HOUR_MS,
    contestWindowMs: 7 * 24 * HOUR_MS,
    capturedAt: asIsoDateTime('2026-11-16T09:00:00Z'),
    ...overrides,
  };
}

function makeResolvedCycle(overrides: Partial<FeedbackCycle> = {}): FeedbackCycle {
  return {
    id: CYCLE_1,
    organizationId: ORG_A,
    feedbackId: FEEDBACK_1,
    cycleNumber: 1,
    origin: CYCLE_ORIGINS.INITIAL,
    status: FEEDBACK_STATUSES.RESOLVED,
    prioritySnapshot: PRIORITIES.HIGH,
    initialAssigneeId: USER_MANAGER,
    assigneeId: USER_MANAGER,
    slaSnapshotId: SLA_1,
    startedAt: asIsoDateTime('2026-11-10T09:00:00Z'),
    firstRespondedAt: asIsoDateTime('2026-11-10T10:00:00Z'),
    resolvedAt: asIsoDateTime('2026-11-12T15:00:00Z'),
    resolutionDescription: 'Issue fixed in local state.',
    manifestationDeadlineAt: asIsoDateTime('2026-11-17T15:00:00Z'),
    contestDeadlineAt: asIsoDateTime('2026-11-19T15:00:00Z'),
    authorConfirmedResolution: false,
    ...overrides,
  };
}

describe('Feedback SLA Calculator (PRD §15.5)', () => {
  it('never pauses FIRST_RESPONSE in WAITING_INFO, pauses RESOLUTION in WAITING_INFO and skips holidays/breaks/weekends', () => {
    const snapshot = makeBusinessHoursSnapshot();
    // Mon 2026-11-16 09:00 -> Wed 2026-11-18 15:00 (Tue Nov 17 is holiday!)
    // Mon business hours: 09-12 (3h) + 13-18 (5h) = 8h
    // Tue holiday: 0h
    // Wed business hours until 15:00: 09-12 (3h) + 13-15 (2h) = 5h
    // Total business hours = 13h
    const waitingInfoPause = {
      startedAt: asIsoDateTime('2026-11-16T10:00:00Z'),
      endedAt: asIsoDateTime('2026-11-16T15:00:00Z'), // covers 10-12 (2h) + 13-15 (2h) = 4 business hours
    };

    const firstResponseElapsed = calculateSlaElapsedMs({
      target: 'FIRST_RESPONSE',
      snapshot,
      startedAt: asIsoDateTime('2026-11-16T09:00:00Z'),
      evaluatedAt: asIsoDateTime('2026-11-18T15:00:00Z'),
      waitingInfoPauses: [waitingInfoPause],
    });
    expect(firstResponseElapsed).toBe(13 * HOUR_MS);

    const resolutionElapsed = calculateSlaElapsedMs({
      target: 'RESOLUTION',
      snapshot,
      startedAt: asIsoDateTime('2026-11-16T09:00:00Z'),
      evaluatedAt: asIsoDateTime('2026-11-18T15:00:00Z'),
      waitingInfoPauses: [waitingInfoPause],
    });
    expect(resolutionElapsed).toBe(9 * HOUR_MS);

    // SLA status thresholds
    expect(evaluateSlaStatus(9 * HOUR_MS, snapshot.resolutionTargetMs)).toBe('ON_TRACK');
    expect(evaluateSlaStatus(13 * HOUR_MS, snapshot.resolutionTargetMs)).toBe('WARNING');
    expect(evaluateSlaStatus(17 * HOUR_MS, snapshot.resolutionTargetMs)).toBe('BREACHED');

    // Snapshot targets remain immutable for the running cycle regardless of mid-cycle priority change
    expect(snapshot.prioritySnapshot).toBe(PRIORITIES.HIGH);
    expect(snapshot.resolutionTargetMs).toBe(16 * HOUR_MS);
  });
});

describe('Feedback Resolution, Reconciled Closure, Contestations & Exceptional Reopen (ADR-0006 §4)', () => {
  it('blocks auto-closure on pending contest, preserves status RESOLVED on expiration closure and transitions to CLOSED on explicit author confirmation', () => {
    const resolvedCycle = makeResolvedCycle();
    const afterDeadlines = asIsoDateTime('2026-11-20T00:00:00Z');
    const beforeContestDeadline = asIsoDateTime('2026-11-18T00:00:00Z');

    // Pending contest blocks auto-closure
    expect(canAutoCloseResolvedFeedback(resolvedCycle, true, afterDeadlines)).toBe(false);
    expect(() => autoCloseResolvedFeedback(resolvedCycle, true, afterDeadlines)).toThrow(
      ConflictError,
    );

    // Before contest deadline -> not eligible
    expect(canAutoCloseResolvedFeedback(resolvedCycle, false, beforeContestDeadline)).toBe(false);

    // Expiration closure keeps status = RESOLVED and authorConfirmedResolution = false
    const expiredClosed = autoCloseResolvedFeedback(resolvedCycle, false, afterDeadlines);
    expect(expiredClosed.status).toBe(FEEDBACK_STATUSES.RESOLVED);
    expect(expiredClosed.closedAt).toBe(afterDeadlines);
    expect(expiredClosed.closureReason).toBe(FEEDBACK_CLOSURE_REASONS.EXPIRED_WITHOUT_CONTEST);
    expect(expiredClosed.authorConfirmedResolution).toBe(false);

    // Explicit author confirmation transitions to CLOSED and authorConfirmedResolution = true
    const confirmed = confirmFeedbackResolution(
      resolvedCycle,
      USER_AUTHOR,
      USER_AUTHOR,
      false,
      beforeContestDeadline,
    );
    expect(confirmed.status).toBe(FEEDBACK_STATUSES.CLOSED);
    expect(confirmed.closedAt).toBe(beforeContestDeadline);
    expect(confirmed.closureReason).toBe(FEEDBACK_CLOSURE_REASONS.CONFIRMED_BY_AUTHOR);
    expect(confirmed.authorConfirmedResolution).toBe(true);

    // Non-author cannot confirm resolution
    expect(() =>
      confirmFeedbackResolution(
        resolvedCycle,
        USER_MANAGER,
        USER_AUTHOR,
        false,
        beforeContestDeadline,
      ),
    ).toThrow(AuthorizationError);
  });

  it('validates contest opening, ADMIN-only decisions, divergence justification, reopened cycles and category deletion protection', () => {
    const resolvedCycle = makeResolvedCycle();
    const withinWindow = asIsoDateTime('2026-11-18T12:00:00Z');

    // Valid opening
    expect(() =>
      assertContestCanBeOpened({
        cycle: resolvedCycle,
        hasPendingContest: false,
        reasonVersionActive: true,
        justification: 'O problema ainda persiste após a correção.',
        now: withinWindow,
      }),
    ).not.toThrow();

    // Missing justification or inactive reason version or expired window rejected
    expect(() =>
      assertContestCanBeOpened({
        cycle: resolvedCycle,
        hasPendingContest: false,
        reasonVersionActive: true,
        justification: '  ',
        now: withinWindow,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertContestCanBeOpened({
        cycle: resolvedCycle,
        hasPendingContest: false,
        reasonVersionActive: false,
        justification: 'Justificativa válida',
        now: withinWindow,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      assertContestCanBeOpened({
        cycle: resolvedCycle,
        hasPendingContest: false,
        reasonVersionActive: true,
        justification: 'Fora do prazo',
        now: asIsoDateTime('2026-11-20T00:00:00Z'),
      }),
    ).toThrow(ConflictError);

    const analysis: FeedbackContestAnalysis = {
      id: asFeedbackContestAnalysisId('37000000-0000-4000-8000-000000000001'),
      organizationId: ORG_A,
      contestId: CONTEST_1,
      analystUserId: USER_MANAGER,
      recommendation: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
      summary: 'Evidence supports keeping resolution.',
      createdAt: withinWindow,
    };

    // MANAGER cannot decide contestation
    expect(() =>
      assertContestDecisionValid({
        actorRole: ORGANIZATION_ROLES.MANAGER,
        outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        analysis,
        justification: 'Not allowed',
      }),
    ).toThrow(AuthorizationError);

    // ADMIN diverging from analysis without justification throws ValidationError
    expect(() =>
      assertContestDecisionValid({
        actorRole: ORGANIZATION_ROLES.ADMIN,
        outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
        analysis,
        justification: '   ',
      }),
    ).toThrow(ValidationError);

    // ADMIN accepting contestation (diverging from analysis) spawns CONTESTATION_REOPEN cycle
    const acceptedDecision = assertContestDecisionValid({
      actorRole: ORGANIZATION_ROLES.ADMIN,
      outcome: CONTEST_RECOMMENDATIONS.RESUME_SERVICE,
      analysis,
      justification: 'New logs confirmed intermittent bug; reopening service.',
    });
    expect(acceptedDecision).toEqual({
      contestStatus: CONTEST_STATUSES.CLOSED,
      nextFeedbackStatus: FEEDBACK_STATUSES.IN_PROGRESS,
      divergedFromAnalysis: true,
      createsNewCycle: true,
      newCycleOrigin: CYCLE_ORIGINS.CONTESTATION_REOPEN,
    });

    // ADMIN rejecting contestation keeps RESOLVED and auto-closes contest
    const rejectedDecision = assertContestDecisionValid({
      actorRole: ORGANIZATION_ROLES.ADMIN,
      outcome: CONTEST_RECOMMENDATIONS.KEEP_RESOLUTION,
      analysis,
      justification: 'Verified working per acceptance criteria.',
    });
    expect(rejectedDecision).toEqual({
      contestStatus: CONTEST_STATUSES.CLOSED,
      nextFeedbackStatus: FEEDBACK_STATUSES.RESOLVED,
      divergedFromAnalysis: false,
      createsNewCycle: false,
    });

    // Exceptional reopen after expiration closure spawns EXCEPTIONAL_REOPEN preserving assignee & priority with new SLA snapshot
    const expiredClosed = autoCloseResolvedFeedback(
      resolvedCycle,
      false,
      asIsoDateTime('2026-11-20T00:00:00Z'),
    );
    expect(() =>
      assertExceptionalReopenAllowed({
        cycle: expiredClosed,
        hasPendingReopenRequest: false,
        justification: 'Autor estava em férias durante a janela de contestação.',
      }),
    ).not.toThrow();

    const reopenedCycle = createReopenedFeedbackCycle(
      expiredClosed,
      CYCLE_2,
      CYCLE_ORIGINS.EXCEPTIONAL_REOPEN,
      SLA_2,
      asIsoDateTime('2026-11-22T10:00:00Z'),
    );
    expect(reopenedCycle).toMatchObject({
      id: CYCLE_2,
      cycleNumber: 2,
      origin: CYCLE_ORIGINS.EXCEPTIONAL_REOPEN,
      status: FEEDBACK_STATUSES.IN_PROGRESS,
      prioritySnapshot: PRIORITIES.HIGH,
      initialAssigneeId: USER_MANAGER,
      assigneeId: USER_MANAGER,
      slaSnapshotId: SLA_2,
      authorConfirmedResolution: false,
    });

    // Used category cannot be deleted
    expect(() => assertCategoryDeletionAllowed(true)).toThrow(ConflictError);
    expect(() => assertCategoryDeletionAllowed(false)).not.toThrow();
  });
});

describe('Governance — Notifications, Backups Retention/Isolation & Default-Deny Settings', () => {
  it('builds deterministic deduplication keys per (eventId, recipientUserId)', () => {
    const event1 = asEventId('44000000-0000-4000-8000-000000000001');
    const event2 = asEventId('44000000-0000-4000-8000-000000000002');

    expect(buildNotificationDeduplicationKey(event1, USER_AUTHOR)).toBe(`${event1}:${USER_AUTHOR}`);
    expect(buildNotificationDeduplicationKey(event1, USER_AUTHOR)).not.toBe(
      buildNotificationDeduplicationKey(event1, USER_MANAGER),
    );
    expect(buildNotificationDeduplicationKey(event1, USER_AUTHOR)).not.toBe(
      buildNotificationDeduplicationKey(event2, USER_AUTHOR),
    );
  });

  it('retains latest 7 AUTO_DAILY backups, preserves 100% of MANUAL backups and blocks cross-org restore', () => {
    expect(MAX_AUTOMATIC_DAILY_BACKUPS).toBe(7);

    const autoBackups: Backup[] = Array.from({ length: 10 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return {
        id: asBackupId(`55000000-0000-4000-8000-0000000000${day}`),
        organizationId: ORG_A,
        kind: BACKUP_KINDS.AUTO_DAILY,
        schemaVersion: 1,
        integrityHash: `hash-auto-${day}`,
        entityCounts: { tasks: 10 },
        createdAt: asIsoDateTime(`2026-11-${day}T03:00:00Z`),
        createdByUserId: USER_ADMIN,
      };
    });

    const manualBackup: Backup = {
      id: asBackupId('55000000-0000-4000-8000-000000000099'),
      organizationId: ORG_A,
      kind: BACKUP_KINDS.MANUAL,
      schemaVersion: 1,
      integrityHash: 'hash-manual-old',
      entityCounts: { tasks: 5 },
      createdAt: asIsoDateTime('2026-01-01T00:00:00Z'), // very old manual backup
      createdByUserId: USER_ADMIN,
    };

    const expired = selectExpiredAutoBackupsForRetention([...autoBackups, manualBackup]);
    expect(expired).toHaveLength(3);
    expect(expired.every((item) => item.kind === BACKUP_KINDS.AUTO_DAILY)).toBe(true);
    expect(expired.some((item) => item.id === manualBackup.id)).toBe(false);
    expect(expired.map((item) => item.createdAt)).toEqual([
      '2026-11-03T03:00:00Z',
      '2026-11-02T03:00:00Z',
      '2026-11-01T03:00:00Z',
    ]);

    expect(() => assertBackupMatchesTargetOrganization(manualBackup, ORG_A)).not.toThrow();
    expect(() => assertBackupMatchesTargetOrganization(manualBackup, ORG_B)).toThrow(
      AuthorizationError,
    );
  });

  it('initializes OrganizationSettings with strict Default Deny on all §12 pending capabilities', () => {
    const settings = createDefaultOrganizationSettings(
      ORG_A,
      asIsoDateTime('2026-11-19T12:00:00Z'),
    );

    expect(Object.isFrozen(settings)).toBe(true);
    expect(settings.invitationExpiryDays).toBe(15);
    expect(settings.pendingPermissionDefaults).toEqual({
      commentEditWindowMinutes: 0,
      maxAttachmentSizeBytes: MAX_ATTACHMENT_SIZE_BYTES,
      maxContextAttachmentsSizeBytes: MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
      maxAttachmentsPerContext: 10,
      allowMemberCreateTaskWithoutGrant: false,
      allowMemberChangePriorityOrDueDateWithoutGrant: false,
      allowFieldLevelTemporaryGrants: false,
      allowManagerViewIndividualProductivity: false,
      allowMemberManageSubtasksInAccessibleTask: false,
      allowMemberResolveOthersImpediment: false,
      trashRetentionDays: null,
      requireReinforcedConfirmationForIrreversibleActions: true,
      allowMemberTrashAccess: false,
    });
  });
});
