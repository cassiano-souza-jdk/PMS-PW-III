import { createContext, useContext } from 'react';
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
import type { OrganizationId } from '@/shared/kernel';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface RevokeSessionOptions {
  readonly reason?: string;
  readonly activeOrganizationId?: OrganizationId;
}

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: User | null;
  readonly session: UserSession | null;
  readonly accessToken: string | null;
  readonly isAuthenticated: boolean;
  readonly login: (input: LoginWithPasswordInput) => Promise<AuthSessionResult>;
  readonly register: (input: RegisterUserInput) => Promise<AuthSessionResult>;
  readonly enterDemoProfile: (input: EnterDemoProfileInput) => Promise<EnterDemoProfileResult>;
  readonly logout: (activeOrganizationId?: OrganizationId) => Promise<void>;
  readonly refreshProfile: () => Promise<User | null>;
  readonly listSessions: () => Promise<readonly UserSession[]>;
  readonly revokeSession: (sessionId: SessionId, options?: RevokeSessionOptions) => Promise<void>;
  readonly revokeAllSessions: (options?: RevokeSessionOptions) => Promise<void>;
  readonly simulatePasswordRecovery: (
    input: SimulatePasswordRecoveryInput,
  ) => Promise<SimulatePasswordRecoveryResult>;
  readonly simulateEmailVerification: () => Promise<User>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider.');
  }
  return context;
}
