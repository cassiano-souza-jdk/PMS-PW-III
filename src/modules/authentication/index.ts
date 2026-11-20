export {
  DEMO_CREDENTIALS_BY_ROLE,
  PASSWORD_VERIFIER_ALGORITHM,
  type DemoCredentialDescriptor,
  type LocalCredential,
  type PasswordVerifierAlgorithm,
} from './domain/local-credential';
export {
  asSessionId,
  assertSessionValid,
  isSessionActiveAt,
  type SessionId,
  type UserSession,
} from './domain/user-session';
export type { EphemeralSessionPointerPort } from './application/ports/ephemeral-session-pointer.port';
export type { LocalCredentialRepositoryPort } from './application/ports/local-credential-repository.port';
export type {
  PasswordHashResult,
  PasswordVerifierPort,
} from './application/ports/password-verifier.port';
export type { UserSessionRepositoryPort } from './application/ports/user-session-repository.port';
export {
  AuthService,
  type AuthServiceDependencies,
  type AuthSessionResult,
  type DemoSeedHookResult,
  type EnterDemoProfileInput,
  type EnterDemoProfileResult,
  type LoginWithPasswordInput,
  type LogoutCurrentSessionInput,
  type RegisterUserInput,
  type RevokeAllSessionsInput,
  type RevokeSessionInput,
  type SimulateEmailVerificationInput,
  type SimulatePasswordRecoveryInput,
  type SimulatePasswordRecoveryResult,
} from './application/use-cases/auth-service';
