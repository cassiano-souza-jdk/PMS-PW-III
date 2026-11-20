import type { UserId } from '@/shared/kernel';
import type { LocalCredential } from '../../domain/local-credential';

export interface LocalCredentialRepositoryPort {
  findByUserId(userId: UserId): Promise<LocalCredential | null>;
  findByEmail(normalizedEmail: string): Promise<LocalCredential | null>;
  save(credential: LocalCredential): Promise<void>;
}
