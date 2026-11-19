import { ConflictError } from '@/shared/errors';
import { TRANSACTION_RESOURCES, type UserId } from '@/shared/kernel';
import { withPersistenceErrorHandling, type PmsDatabase } from '@/shared/persistence';
import type { UserRepositoryPort } from '../../application/ports/user-repository.port';
import { normalizeEmail, type User } from '../../domain/user';

export class DexieUserRepository implements UserRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<User, UserId>(TRANSACTION_RESOURCES.USERS);
  }

  async findById(userId: UserId): Promise<User | null> {
    return withPersistenceErrorHandling('User.findById', async () => {
      const record = await this.table.get(userId);
      return record ?? null;
    });
  }

  async findByEmail(normalizedEmail: string): Promise<User | null> {
    return withPersistenceErrorHandling('User.findByEmail', async () => {
      const emailKey = normalizedEmail.trim().toLowerCase();
      if (emailKey.length === 0) {
        return null;
      }
      const record = await this.table.where('email').equals(emailKey).first();
      return record ?? null;
    });
  }

  async findByIds(userIds: readonly UserId[]): Promise<readonly User[]> {
    if (userIds.length === 0) {
      return [];
    }

    return withPersistenceErrorHandling('User.findByIds', async () => {
      const uniqueIds = [...new Set<UserId>(userIds)];
      const records = await this.table.bulkGet(uniqueIds);
      return records.filter((record): record is User => record !== undefined);
    });
  }

  async save(user: User): Promise<void> {
    const normalized = normalizeEmail(user.email, 'email');

    await withPersistenceErrorHandling('User.save', async () => {
      const existingByEmail = await this.table.where('email').equals(normalized).first();
      if (existingByEmail !== undefined && existingByEmail.id !== user.id) {
        throw new ConflictError(`A user with email "${normalized}" already exists.`, {
          details: { field: 'email', email: normalized },
        });
      }

      const recordToSave: User =
        user.email === normalized
          ? user
          : {
              ...user,
              email: normalized,
            };

      await this.table.put(recordToSave);
    });
  }
}
