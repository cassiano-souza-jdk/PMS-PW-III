import type { AuthorizationPolicyConfig } from '@/modules/authorization';
import type { OrganizationSettings } from '../domain/organization-settings';

/**
 * Converts persisted `OrganizationSettings` into the canonical `AuthorizationPolicyConfig`
 * consumed by `evaluateAuthorization` / `assertAuthorized` (ADR-0011 §6).
 */
export function toAuthorizationPolicyConfig(
  settings: OrganizationSettings,
): AuthorizationPolicyConfig {
  const defaults = settings.pendingPermissionDefaults;

  return {
    commentEditWindowMinutes: defaults.commentEditWindowMinutes,
    allowMemberCreateTaskInProject: defaults.allowMemberCreateTaskWithoutGrant,
    allowMemberUpdateTaskPriority: defaults.allowMemberChangePriorityOrDueDateWithoutGrant,
    allowMemberUpdateTaskDueDate: defaults.allowMemberChangePriorityOrDueDateWithoutGrant,
    allowFieldLevelTemporaryGrants: defaults.allowFieldLevelTemporaryGrants,
    allowManagerViewIndividualProductivity: defaults.allowManagerViewIndividualProductivity,
    allowMemberManageSubtasksInAccessibleTask:
      defaults.allowMemberManageSubtasksInAccessibleTask ?? false,
    allowMemberResolveOthersImpediment: defaults.allowMemberResolveOthersImpediment ?? false,
    allowUnconfirmedIrreversibleActions:
      !defaults.requireReinforcedConfirmationForIrreversibleActions,
    allowMemberTrashAccess: defaults.allowMemberTrashAccess,
  };
}
