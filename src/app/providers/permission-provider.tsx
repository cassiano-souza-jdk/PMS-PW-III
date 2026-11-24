import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useComposition } from '@/app/composition';
import {
  DEFAULT_AUTHORIZATION_POLICY_CONFIG,
  evaluateAuthorization,
  type AuthorizationActor,
  type AuthorizationDecision,
  type AuthorizationPolicyConfig,
  type AuthorizationResource,
  type AuthorizationScopeSummary,
  type MyActiveAccessRules,
  type PermissionCode,
} from '@/modules/authorization';
import { createDefaultOrganizationSettings, toAuthorizationPolicyConfig } from '@/modules/settings';
import { asIsoDateTime } from '@/shared/kernel';
import { useAuth } from './auth-context';
import { useOrganization } from './organization-context';
import {
  PermissionContext,
  type PermissionContextValue,
  type PermissionResourceOverrides,
} from './permission-context';

export interface PermissionProviderProps {
  readonly children: ReactNode;
}

const EMPTY_ACCESS_RULES: MyActiveAccessRules = Object.freeze({
  grants: Object.freeze([]),
  explicitDenies: Object.freeze([]),
  managedTeamIds: Object.freeze([]),
  memberTeamIds: Object.freeze([]),
  managedProjectIds: Object.freeze([]),
  participatedProjectIds: Object.freeze([]),
});

interface LoadedPermissionRulesState {
  readonly contextKey: string | null;
  readonly rules: MyActiveAccessRules;
  readonly policyConfig: AuthorizationPolicyConfig;
}

const INITIAL_RULES_STATE: LoadedPermissionRulesState = {
  contextKey: null,
  rules: EMPTY_ACCESS_RULES,
  policyConfig: DEFAULT_AUTHORIZATION_POLICY_CONFIG,
};

/**
 * Sincroniza grants ativos, negações explícitas (Deny Overrides) e escopos administrados/participados
 * via `services.authorization.listMyActiveAccessRules` (ADR-0009 §4) e avalia permissões de UX
 * usando o motor puro `evaluateAuthorization` (`@/modules/authorization`).
 *
 * A autorização definitiva permanece obrigatória nos casos de uso de aplicação.
 */
export function PermissionProvider({ children }: PermissionProviderProps) {
  const { services, repositories } = useComposition();
  const { isAuthenticated, user } = useAuth();
  const { activeOrganization } = useOrganization();

  const [rulesState, setRulesState] = useState<LoadedPermissionRulesState>(INITIAL_RULES_STATE);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const authenticatedUserId = isAuthenticated && user !== null ? user.id : null;
  const activeOrgId = activeOrganization?.id ?? null;
  const contextKey =
    authenticatedUserId !== null && activeOrgId !== null
      ? `${authenticatedUserId}:${activeOrgId}`
      : null;

  useEffect(() => {
    if (authenticatedUserId === null || activeOrgId === null || contextKey === null) {
      return;
    }

    let isActive = true;
    const targetUserId = authenticatedUserId;
    const targetOrgId = activeOrgId;
    const targetKey = contextKey;

    async function syncActiveRules() {
      try {
        const [rules, settings] = await Promise.all([
          services.authorization.listMyActiveAccessRules(targetUserId, targetOrgId),
          repositories.settings.organizationSettings
            .findByOrganization(targetOrgId)
            .catch(() => null),
        ]);
        if (!isActive) {
          return;
        }
        const nowIso = asIsoDateTime(new Date().toISOString());
        const policyConfig = toAuthorizationPolicyConfig(
          settings ?? createDefaultOrganizationSettings(targetOrgId, nowIso),
        );
        setRulesState({
          contextKey: targetKey,
          rules,
          policyConfig,
        });
      } catch {
        // Fallback gracioso em ambientes sem IndexedDB (ex.: testes unitários jsdom)
        if (!isActive) {
          return;
        }
        setRulesState({
          contextKey: targetKey,
          rules: EMPTY_ACCESS_RULES,
          policyConfig: DEFAULT_AUTHORIZATION_POLICY_CONFIG,
        });
      }
    }

    void syncActiveRules();

    return () => {
      isActive = false;
    };
  }, [
    activeOrgId,
    authenticatedUserId,
    contextKey,
    repositories.settings.organizationSettings,
    services.authorization,
  ]);

  const refreshPermissions = useCallback(async (): Promise<void> => {
    if (authenticatedUserId === null || activeOrgId === null || contextKey === null) {
      setRulesState(INITIAL_RULES_STATE);
      return;
    }

    const targetKey = contextKey;
    setIsRefreshing(true);
    try {
      const [rules, settings] = await Promise.all([
        services.authorization.listMyActiveAccessRules(authenticatedUserId, activeOrgId),
        repositories.settings.organizationSettings
          .findByOrganization(activeOrgId)
          .catch(() => null),
      ]);
      const nowIso = asIsoDateTime(new Date().toISOString());
      const policyConfig = toAuthorizationPolicyConfig(
        settings ?? createDefaultOrganizationSettings(activeOrgId, nowIso),
      );
      setRulesState({
        contextKey: targetKey,
        rules,
        policyConfig,
      });
    } catch {
      setRulesState({
        contextKey: targetKey,
        rules: EMPTY_ACCESS_RULES,
        policyConfig: DEFAULT_AUTHORIZATION_POLICY_CONFIG,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [
    activeOrgId,
    authenticatedUserId,
    contextKey,
    repositories.settings.organizationSettings,
    services.authorization,
  ]);

  // Reset imediato ao trocar activeOrganizationId ou fazer logout (sem flash cross-org — ADR-0009 §4)
  const effectiveRules = useMemo<MyActiveAccessRules>(() => {
    if (contextKey === null || rulesState.contextKey !== contextKey) {
      return EMPTY_ACCESS_RULES;
    }
    return rulesState.rules;
  }, [contextKey, rulesState.contextKey, rulesState.rules]);

  const effectivePolicyConfig = useMemo<AuthorizationPolicyConfig>(() => {
    if (contextKey === null || rulesState.contextKey !== contextKey) {
      return DEFAULT_AUTHORIZATION_POLICY_CONFIG;
    }
    return rulesState.policyConfig;
  }, [contextKey, rulesState.contextKey, rulesState.policyConfig]);

  const isLoadingPermissions =
    contextKey !== null && (isRefreshing || rulesState.contextKey !== contextKey);

  const scopeSummary = useMemo<AuthorizationScopeSummary>(
    () => ({
      managedTeamIds: effectiveRules.managedTeamIds,
      memberTeamIds: effectiveRules.memberTeamIds,
      managedProjectIds: effectiveRules.managedProjectIds,
      participatedProjectIds: effectiveRules.participatedProjectIds,
    }),
    [effectiveRules],
  );

  const actor = useMemo<AuthorizationActor>(() => {
    if (!isAuthenticated || user === null) {
      return {
        isAuthenticated: false,
      };
    }

    return {
      isAuthenticated: true,
      userId: user.id,
      ...(activeOrganization !== null
        ? {
            organizationMembership: {
              organizationId: activeOrganization.id,
              role: activeOrganization.role,
              status: activeOrganization.status,
            },
          }
        : {}),
      grants: effectiveRules.grants,
      explicitDenies: effectiveRules.explicitDenies,
      managedTeamIds: effectiveRules.managedTeamIds,
      memberTeamIds: effectiveRules.memberTeamIds,
      managedProjectIds: effectiveRules.managedProjectIds,
      participatedProjectIds: effectiveRules.participatedProjectIds,
    };
  }, [activeOrganization, effectiveRules, isAuthenticated, user]);

  const evaluate = useCallback(
    (
      permission: PermissionCode,
      resourceOverrides?: PermissionResourceOverrides,
      policyConfigOverride?: Partial<AuthorizationPolicyConfig>,
    ): AuthorizationDecision => {
      const resource: AuthorizationResource = {
        exists: true,
        ...(activeOrganization !== null ? { organizationId: activeOrganization.id } : {}),
        ...resourceOverrides,
      };

      return evaluateAuthorization({
        actor,
        action: permission,
        resource,
        context: {
          now: asIsoDateTime(new Date().toISOString()),
          policyConfig:
            policyConfigOverride !== undefined
              ? { ...effectivePolicyConfig, ...policyConfigOverride }
              : effectivePolicyConfig,
        },
      });
    },
    [activeOrganization, actor, effectivePolicyConfig],
  );

  const can = useCallback(
    (
      permission: PermissionCode,
      resourceOverrides?: PermissionResourceOverrides,
      policyConfigOverride?: Partial<AuthorizationPolicyConfig>,
    ): boolean => {
      return evaluate(permission, resourceOverrides, policyConfigOverride).allowed;
    },
    [evaluate],
  );

  const value = useMemo<PermissionContextValue>(
    () => ({
      can,
      evaluate,
      refreshPermissions,
      isLoadingPermissions,
      activeGrants: effectiveRules.grants,
      activeDenyRules: effectiveRules.explicitDenies,
      scopeSummary,
    }),
    [
      can,
      effectiveRules.explicitDenies,
      effectiveRules.grants,
      evaluate,
      isLoadingPermissions,
      refreshPermissions,
      scopeSummary,
    ],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
