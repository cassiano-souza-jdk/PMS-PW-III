import { useCallback, useMemo, type ReactNode } from 'react';
import {
  evaluateAuthorization,
  type AuthorizationActor,
  type AuthorizationDecision,
  type AuthorizationResource,
  type PermissionCode,
} from '@/modules/authorization';
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

/**
 * Fornece avaliação reativa de UX via motor puro `evaluateAuthorization` (`@/modules/authorization`).
 * A autorização definitiva permanece obrigatória nos casos de uso de aplicação.
 */
export function PermissionProvider({ children }: PermissionProviderProps) {
  const { isAuthenticated, user } = useAuth();
  const { activeOrganization } = useOrganization();

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
    };
  }, [activeOrganization, isAuthenticated, user]);

  const evaluate = useCallback(
    (
      permission: PermissionCode,
      resourceOverrides?: PermissionResourceOverrides,
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
        },
      });
    },
    [activeOrganization, actor],
  );

  const can = useCallback(
    (permission: PermissionCode, resourceOverrides?: PermissionResourceOverrides): boolean => {
      return evaluate(permission, resourceOverrides).allowed;
    },
    [evaluate],
  );

  const value = useMemo<PermissionContextValue>(
    () => ({
      can,
      evaluate,
    }),
    [can, evaluate],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
