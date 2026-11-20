import type { LocalCredential, PasswordVerifierAlgorithm } from '../../domain/local-credential';

export interface PasswordHashResult {
  readonly passwordVerifier: string;
  readonly salt: string;
  readonly algorithm: PasswordVerifierAlgorithm;
}

/**
 * Port for simulated local password hashing and verification (ADR-0008 §2.3 & §2.4).
 *
 * CRITICAL INVARIANT:
 * All calls to `hashPassword` and `verifyPassword` MUST be executed OUTSIDE `TransactionPort.run(...)`
 * to prevent IndexedDB `PrematureCommitError` while awaiting WebCrypto operations.
 */
export interface PasswordVerifierPort {
  hashPassword(plainPassword: string, existingSalt?: string): Promise<PasswordHashResult>;
  verifyPassword(
    plainPassword: string,
    credential: Pick<LocalCredential, 'passwordVerifier' | 'salt' | 'algorithm'>,
  ): Promise<boolean>;
}
