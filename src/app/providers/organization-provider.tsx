import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useComposition } from '@/app/composition';
import type {
  CreateOrganizationInput,
  CreateOrganizationResult,
  MyOrganizationSummary,
} from '@/modules/organizations';
import { AuthenticationError } from '@/shared/errors';
import type { OrganizationId, UserId } from '@/shared/kernel';
import { useAuth } from './auth-context';
import { OrganizationContext, type OrganizationContextValue } from './organization-context';

export interface OrganizationProviderProps {
  readonly children: ReactNode;
}

interface OrganizationState {
  readonly ownerUserId: UserId | null;
  readonly organizations: readonly MyOrganizationSummary[];
  readonly activeOrganizationId: OrganizationId | null;
}

const EMPTY_ORGANIZATION_STATE: OrganizationState = {
  ownerUserId: null,
  organizations: [],
  activeOrganizationId: null,
};

function resolveNextActiveOrganizationId(
  organizations: readonly MyOrganizationSummary[],
  currentActiveId: OrganizationId | null,
  preferredId?: OrganizationId | null,
): OrganizationId | null {
  if (preferredId !== undefined && preferredId !== null) {
    const preferredMatch = organizations.find((org) => org.id === preferredId);
    if (preferredMatch !== undefined) {
      return preferredMatch.id;
    }
  }

  if (currentActiveId !== null) {
    const currentMatch = organizations.find((org) => org.id === currentActiveId);
    if (currentMatch !== undefined) {
      return currentMatch.id;
    }
  }

  return organizations[0]?.id ?? null;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const { services } = useComposition();
  const { status, user, isAuthenticated } = useAuth();

  const [state, setState] = useState<OrganizationState>(EMPTY_ORGANIZATION_STATE);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const authenticatedUserId = isAuthenticated && user !== null ? user.id : null;

  const loadOrganizationsForUser = useCallback(
    async (
      preferredOrganizationId?: OrganizationId | null,
    ): Promise<readonly MyOrganizationSummary[]> => {
      if (authenticatedUserId === null) {
        setState(EMPTY_ORGANIZATION_STATE);
        return [];
      }

      setIsRefreshing(true);
      try {
        const list = await services.organizations.listMyOrganizations(authenticatedUserId);
        setState((current) => {
          const previousActiveId =
            current.ownerUserId === authenticatedUserId ? current.activeOrganizationId : null;
          return {
            ownerUserId: authenticatedUserId,
            organizations: list,
            activeOrganizationId: resolveNextActiveOrganizationId(
              list,
              previousActiveId,
              preferredOrganizationId,
            ),
          };
        });
        return list;
      } finally {
        setIsRefreshing(false);
      }
    },
    [authenticatedUserId, services.organizations],
  );

  useEffect(() => {
    if (status === 'loading' || authenticatedUserId === null) {
      return;
    }

    let isActive = true;
    const targetUserId = authenticatedUserId;

    async function syncOrganizations() {
      try {
        const list = await services.organizations.listMyOrganizations(targetUserId);
        if (!isActive) {
          return;
        }
        setState((current) => {
          const previousActiveId =
            current.ownerUserId === targetUserId ? current.activeOrganizationId : null;
          return {
            ownerUserId: targetUserId,
            organizations: list,
            activeOrganizationId: resolveNextActiveOrganizationId(list, previousActiveId),
          };
        });
      } catch {
        if (!isActive) {
          return;
        }
        setState({
          ownerUserId: targetUserId,
          organizations: [],
          activeOrganizationId: null,
        });
      }
    }

    void syncOrganizations();

    return () => {
      isActive = false;
    };
  }, [authenticatedUserId, services.organizations, status]);

  const organizations = useMemo<readonly MyOrganizationSummary[]>(() => {
    if (authenticatedUserId === null || state.ownerUserId !== authenticatedUserId) {
      return [];
    }
    return state.organizations;
  }, [authenticatedUserId, state.organizations, state.ownerUserId]);

  const activeOrganizationId = useMemo<OrganizationId | null>(() => {
    if (authenticatedUserId === null || state.ownerUserId !== authenticatedUserId) {
      return null;
    }
    return state.activeOrganizationId;
  }, [authenticatedUserId, state.activeOrganizationId, state.ownerUserId]);

  const isLoading =
    authenticatedUserId !== null && (isRefreshing || state.ownerUserId !== authenticatedUserId);

  const selectOrganization = useCallback(
    (organizationId: OrganizationId) => {
      if (authenticatedUserId === null) {
        return;
      }
      const exists = organizations.some((org) => org.id === organizationId);
      if (exists) {
        setState((current) => ({
          ...current,
          ownerUserId: authenticatedUserId,
          activeOrganizationId: organizationId,
        }));
      }
    },
    [authenticatedUserId, organizations],
  );

  const refreshOrganizations = useCallback(async (): Promise<readonly MyOrganizationSummary[]> => {
    return loadOrganizationsForUser();
  }, [loadOrganizationsForUser]);

  const createOrganization = useCallback(
    async (input: CreateOrganizationInput): Promise<CreateOrganizationResult> => {
      if (authenticatedUserId === null) {
        throw new AuthenticationError('Authentication is required to create an organization.');
      }

      const result = await services.organizations.createOrganization(authenticatedUserId, input);
      await loadOrganizationsForUser(result.organization.id);
      return result;
    },
    [authenticatedUserId, loadOrganizationsForUser, services.organizations],
  );

  const leaveOrganization = useCallback(
    async (organizationId: OrganizationId): Promise<void> => {
      if (authenticatedUserId === null) {
        throw new AuthenticationError('Authentication is required to leave an organization.');
      }

      // PRD.md §5: sair de uma organização remove apenas o vínculo com ela,
      // sem encerrar a sessão global do usuário.
      await services.organizations.leaveOrganization(authenticatedUserId, organizationId);
      const updatedList = await services.organizations.listMyOrganizations(authenticatedUserId);
      setState((current) => {
        const previousActiveId =
          current.ownerUserId === authenticatedUserId ? current.activeOrganizationId : null;
        const nextCurrent = previousActiveId === organizationId ? null : previousActiveId;
        return {
          ownerUserId: authenticatedUserId,
          organizations: updatedList,
          activeOrganizationId: resolveNextActiveOrganizationId(updatedList, nextCurrent),
        };
      });
    },
    [authenticatedUserId, services.organizations],
  );

  const activeOrganization = useMemo<MyOrganizationSummary | null>(() => {
    if (activeOrganizationId === null) {
      return null;
    }
    return organizations.find((org) => org.id === activeOrganizationId) ?? null;
  }, [activeOrganizationId, organizations]);

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      activeOrganization,
      activeOrganizationId: activeOrganization?.id ?? null,
      isLoading,
      isDemoOrganization: activeOrganization?.isDemo === true,
      selectOrganization,
      refreshOrganizations,
      createOrganization,
      leaveOrganization,
    }),
    [
      activeOrganization,
      createOrganization,
      isLoading,
      leaveOrganization,
      organizations,
      refreshOrganizations,
      selectOrganization,
    ],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}
