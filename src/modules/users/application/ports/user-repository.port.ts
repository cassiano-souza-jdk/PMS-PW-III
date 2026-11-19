import type { UserId } from '@/shared/kernel';
import type { User } from '../../domain/user';

export interface UserRepositoryPort {
  findById(userId: UserId): Promise<User | null>;
  findByEmail(normalizedEmail: string): Promise<User | null>;
  findByIds(userIds: readonly UserId[]): Promise<readonly User[]>;
  save(user: User): Promise<void>;
}
