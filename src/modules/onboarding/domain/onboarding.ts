import {
  parseBrandedUuid,
  type Brand,
  type IsoDateTime,
  type OrganizationRole,
  type OrganizationScoped,
  type UserId,
} from '@/shared/kernel';

export type OnboardingProgressId = Brand<string, 'OnboardingProgressId'>;

export function asOnboardingProgressId(
  value: string,
  fieldName = 'onboardingProgressId',
): OnboardingProgressId {
  return parseBrandedUuid<'OnboardingProgressId'>(value, fieldName);
}

export interface OnboardingStepDefinition {
  readonly stepId: string;
  readonly required: boolean;
  readonly applicableRoles: readonly OrganizationRole[];
}

/**
 * Per-user, per-organization onboarding progress adapted by role (PRD.md §21).
 */
export interface OnboardingProgress extends OrganizationScoped {
  readonly id: OnboardingProgressId;
  readonly userId: UserId;
  readonly role: OrganizationRole;
  readonly completedStepIds: readonly string[];
  readonly skippedStepIds: readonly string[];
  readonly dismissed: boolean;
  readonly updatedAt: IsoDateTime;
}

/** Only non-mandatory onboarding steps may be skipped (PRD.md §21). */
export function canSkipOnboardingStep(step: OnboardingStepDefinition): boolean {
  return !step.required;
}
