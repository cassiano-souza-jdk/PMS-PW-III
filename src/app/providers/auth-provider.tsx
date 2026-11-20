import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useComposition } from '@/app/composition';
import type {
  AuthSessionResult,
  EnterDemoProfileInput,
  EnterDemoProfileResult,
  LoginWithPasswordInput,
  RegisterUserInput,
  SessionId,
  SimulatePasswordRecoveryInput,
  SimulatePasswordRecoveryResult,
  UserSession,
} from '@/modules/authentication';
import type { User } from '@/modules/users';
import { AuthenticationError } from '@/shared/errors';
import type { OrganizationId } from '@/shared/kernel';
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type RevokeSessionOptions,
} from './auth-context';

export interface AuthProviderProps {
  readonly children: ReactNode;
}

interface AuthState {
  readonly status: AuthStatus;
  readonly user: User | null;
  readonly session: UserSession | null;
  readonly accessToken: string | null;
}

const INITIAL_AUTH_STATE: AuthState = {
  status: 'loading',
  user: null,
  session: null,
  accessToken: null,
};

const UNAUTHENTICATED_STATE: AuthState = {
  status: 'unauthenticated',
  user: null,
  session: null,
  accessToken: null,
};

export function AuthProvider({ children }: AuthProviderProps) {
  const { services } = useComposition();
  const [state, setState] = useState<AuthState>(INITIAL_AUTH_STATE);

  const applyAuthenticatedSession = useCallback((result: AuthSessionResult) => {
    setState({
      status: 'authenticated',
      user: result.user,
      session: result.session,
      accessToken: result.accessToken,
    });
  }, []);

  const clearAuthenticatedSession = useCallback(() => {
    setState(UNAUTHENTICATED_STATE);
  }, []);

  useEffect(() => {
    let isActive = true;

    async function restoreSession() {
      try {
        const restored = await services.auth.restoreActiveSession();
        if (!isActive) {
          return;
        }
        if (restored !== null) {
          applyAuthenticatedSession(restored);
        } else {
          clearAuthenticatedSession();
        }
      } catch {
        // Fallback gracioso em ambientes sem IndexedDB (ex.: testes unitários jsdom)
        if (isActive) {
          clearAuthenticatedSession();
        }
      }
    }

    void restoreSession();

    return () => {
      isActive = false;
    };
  }, [applyAuthenticatedSession, clearAuthenticatedSession, services.auth]);

  const login = useCallback(
    async (input: LoginWithPasswordInput): Promise<AuthSessionResult> => {
      const result = await services.auth.loginWithPassword(input);
      applyAuthenticatedSession(result);
      return result;
    },
    [applyAuthenticatedSession, services.auth],
  );

  const register = useCallback(
    async (input: RegisterUserInput): Promise<AuthSessionResult> => {
      const result = await services.auth.registerUser(input);
      applyAuthenticatedSession(result);
      return result;
    },
    [applyAuthenticatedSession, services.auth],
  );

  const enterDemoProfile = useCallback(
    async (input: EnterDemoProfileInput): Promise<EnterDemoProfileResult> => {
      const result = await services.auth.enterDemoProfile(input);
      applyAuthenticatedSession(result);
      return result;
    },
    [applyAuthenticatedSession, services.auth],
  );

  const logout = useCallback(
    async (activeOrganizationId?: OrganizationId): Promise<void> => {
      if (state.user !== null && state.session !== null) {
        await services.auth.logoutCurrentSession({
          actorUserId: state.user.id,
          sessionId: state.session.id,
          ...(activeOrganizationId !== undefined ? { activeOrganizationId } : {}),
        });
      }
      clearAuthenticatedSession();
    },
    [clearAuthenticatedSession, services.auth, state.session, state.user],
  );

  const refreshProfile = useCallback(async (): Promise<User | null> => {
    if (state.user === null) {
      return null;
    }
    const updatedUser = await services.users.getMyProfile(state.user.id);
    setState((current) => {
      if (current.status !== 'authenticated' || current.user?.id !== updatedUser.id) {
        return current;
      }
      return {
        ...current,
        user: updatedUser,
      };
    });
    return updatedUser;
  }, [services.users, state.user]);

  const listSessions = useCallback(async (): Promise<readonly UserSession[]> => {
    if (state.user === null) {
      return [];
    }
    return services.auth.listUserSessions(state.user.id);
  }, [services.auth, state.user]);

  const revokeSession = useCallback(
    async (sessionId: SessionId, options?: RevokeSessionOptions): Promise<void> => {
      if (state.user === null) {
        throw new AuthenticationError('Authentication is required to revoke a session.');
      }

      await services.auth.revokeSession({
        actorUserId: state.user.id,
        sessionId,
        ...(options?.reason !== undefined ? { reason: options.reason } : {}),
        ...(options?.activeOrganizationId !== undefined
          ? { activeOrganizationId: options.activeOrganizationId }
          : {}),
      });

      if (state.session?.id === sessionId) {
        clearAuthenticatedSession();
      }
    },
    [clearAuthenticatedSession, services.auth, state.session, state.user],
  );

  const revokeAllSessions = useCallback(
    async (options?: RevokeSessionOptions): Promise<void> => {
      if (state.user === null) {
        throw new AuthenticationError('Authentication is required to revoke sessions.');
      }

      await services.auth.revokeAllSessions({
        actorUserId: state.user.id,
        ...(options?.reason !== undefined ? { reason: options.reason } : {}),
        ...(options?.activeOrganizationId !== undefined
          ? { activeOrganizationId: options.activeOrganizationId }
          : {}),
      });

      clearAuthenticatedSession();
    },
    [clearAuthenticatedSession, services.auth, state.user],
  );

  const simulatePasswordRecovery = useCallback(
    async (input: SimulatePasswordRecoveryInput): Promise<SimulatePasswordRecoveryResult> => {
      return services.auth.simulatePasswordRecovery(input);
    },
    [services.auth],
  );

  const simulateEmailVerification = useCallback(async (): Promise<User> => {
    if (state.user === null) {
      throw new AuthenticationError('Authentication is required to verify email.');
    }
    const verifiedUser = await services.auth.simulateEmailVerification({
      actorUserId: state.user.id,
    });
    setState((current) => {
      if (current.status !== 'authenticated' || current.user?.id !== verifiedUser.id) {
        return current;
      }
      return {
        ...current,
        user: verifiedUser,
      };
    });
    return verifiedUser;
  }, [services.auth, state.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      session: state.session,
      accessToken: state.accessToken,
      isAuthenticated: state.status === 'authenticated' && state.user !== null,
      login,
      register,
      enterDemoProfile,
      logout,
      refreshProfile,
      listSessions,
      revokeSession,
      revokeAllSessions,
      simulatePasswordRecovery,
      simulateEmailVerification,
    }),
    [
      enterDemoProfile,
      listSessions,
      login,
      logout,
      refreshProfile,
      register,
      revokeAllSessions,
      revokeSession,
      simulateEmailVerification,
      simulatePasswordRecovery,
      state.accessToken,
      state.session,
      state.status,
      state.user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
