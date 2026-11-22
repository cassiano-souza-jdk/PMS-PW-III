import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  PRIORITIES,
  type IsoDate,
  type IsoDateTime,
  type OrganizationId,
  type OrganizationScoped,
  type Priority,
} from '@/shared/kernel';

export type OrganizationCalendarMode = 'CONTINUOUS' | 'BUSINESS_HOURS';

export interface CalendarBreakIntervalUtc {
  readonly startHour: number;
  readonly endHour: number;
}

export interface OrganizationCalendarConfig {
  readonly mode: OrganizationCalendarMode;
  readonly workDaysOfWeekUtc: readonly number[];
  readonly workStartHourUtc: number;
  readonly workEndHourUtc: number;
  readonly breakIntervalsUtc: readonly CalendarBreakIntervalUtc[];
  readonly holidayDates: readonly IsoDate[];
}

export interface SlaPriorityPolicy {
  readonly priority: Priority;
  readonly firstResponseTargetMs: number;
  readonly resolutionTargetMs: number;
}

/**
 * Default-Deny parameterization for the 8 open points in permission-matrix.md §12
 * plus the MEMBER trash divergence (PRD.md §20 vs permission-matrix.md §5.9).
 */
export interface PendingPermissionDefaults {
  readonly commentEditWindowMinutes: number;
  readonly maxAttachmentSizeBytes: number;
  readonly maxContextAttachmentsSizeBytes: number;
  readonly maxAttachmentsPerContext: number;
  readonly allowMemberCreateTaskWithoutGrant: boolean;
  readonly allowMemberChangePriorityOrDueDateWithoutGrant: boolean;
  readonly allowFieldLevelTemporaryGrants: boolean;
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly allowMemberManageSubtasksInAccessibleTask?: boolean;
  readonly allowMemberResolveOthersImpediment?: boolean;
  readonly trashRetentionDays: number | null;
  readonly requireReinforcedConfirmationForIrreversibleActions: boolean;
  readonly allowMemberTrashAccess: boolean;
}

export interface CalibratableWeightsConfig {
  readonly workloadPriorityWeight: number;
  readonly workloadDelayWeight: number;
  readonly workloadImpedimentsWeight: number;
  readonly workloadOperationalStateWeight: number;
  readonly workloadPausedFactor: number;
  readonly focusPriorityWeight: number;
  readonly focusDeadlineWeight: number;
  readonly focusDependenciesWeight: number;
  readonly focusInactivityWeight: number;
  readonly focusWorkloadCompatibilityWeight: number;
  readonly defaultProjectInactivityThresholdDays: number;
}

export interface OrganizationSettings extends OrganizationScoped {
  readonly calendar: OrganizationCalendarConfig;
  readonly slaPoliciesByPriority: Readonly<Record<Priority, SlaPriorityPolicy>>;
  readonly feedbackManifestationWindowMs: number;
  readonly feedbackContestWindowMs: number;
  readonly invitationExpiryDays: number;
  readonly pendingPermissionDefaults: PendingPermissionDefaults;
  readonly calibratableWeights: CalibratableWeightsConfig;
  readonly updatedAt: IsoDateTime;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Produces normative default settings for a new organization with strict Default Deny
 * on all pending parameterizable capabilities (permission-matrix.md §12, ADR-0006 §5).
 */
export function createDefaultOrganizationSettings(
  organizationId: OrganizationId,
  now: IsoDateTime,
): OrganizationSettings {
  return Object.freeze({
    organizationId,
    calendar: Object.freeze({
      mode: 'BUSINESS_HOURS' as const,
      workDaysOfWeekUtc: Object.freeze([1, 2, 3, 4, 5]),
      workStartHourUtc: 9,
      workEndHourUtc: 18,
      breakIntervalsUtc: Object.freeze([{ startHour: 12, endHour: 13 }]),
      holidayDates: Object.freeze([]),
    }),
    slaPoliciesByPriority: Object.freeze({
      [PRIORITIES.CRITICAL]: Object.freeze({
        priority: PRIORITIES.CRITICAL,
        firstResponseTargetMs: 2 * MS_PER_HOUR,
        resolutionTargetMs: 8 * MS_PER_HOUR,
      }),
      [PRIORITIES.HIGH]: Object.freeze({
        priority: PRIORITIES.HIGH,
        firstResponseTargetMs: 4 * MS_PER_HOUR,
        resolutionTargetMs: 24 * MS_PER_HOUR,
      }),
      [PRIORITIES.MEDIUM]: Object.freeze({
        priority: PRIORITIES.MEDIUM,
        firstResponseTargetMs: 8 * MS_PER_HOUR,
        resolutionTargetMs: 48 * MS_PER_HOUR,
      }),
      [PRIORITIES.LOW]: Object.freeze({
        priority: PRIORITIES.LOW,
        firstResponseTargetMs: 16 * MS_PER_HOUR,
        resolutionTargetMs: 72 * MS_PER_HOUR,
      }),
    }),
    feedbackManifestationWindowMs: 5 * MS_PER_DAY,
    feedbackContestWindowMs: 7 * MS_PER_DAY,
    invitationExpiryDays: 15,
    pendingPermissionDefaults: Object.freeze({
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
    }),
    calibratableWeights: Object.freeze({
      workloadPriorityWeight: 0.3,
      workloadDelayWeight: 0.3,
      workloadImpedimentsWeight: 0.25,
      workloadOperationalStateWeight: 0.15,
      workloadPausedFactor: 0.5,
      focusPriorityWeight: 0.3,
      focusDeadlineWeight: 0.3,
      focusDependenciesWeight: 0.2,
      focusInactivityWeight: 0.1,
      focusWorkloadCompatibilityWeight: 0.1,
      defaultProjectInactivityThresholdDays: 7,
    }),
    updatedAt: now,
  });
}
