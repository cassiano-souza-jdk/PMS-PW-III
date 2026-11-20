import { TRANSACTION_RESOURCES, type UserId } from '@/shared/kernel';
import { withPersistenceErrorHandling, type PmsDatabase } from '@/shared/persistence';
import type { LocalCredentialRepositoryPort } from '../../application/ports/local-credential-repository.port';
import type { LocalCredential } from '../../domain/local-credential';

export class DexieLocalCredentialRepository implements LocalCredentialRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<LocalCredential, UserId>(TRANSACTION_RESOURCES.LOCAL_CREDENTIALS);
  }

  async findByUserId(userId: UserId): Promise<LocalCredential | null> {
    return withPersistenceErrorHandling('LocalCredential.findByUserId', async () => {
      const record = await this.table.get(userId);
      return record ?? null;
    });
  }

  async findByEmail(normalizedEmail: string): Promise<LocalCredential | null> {
    return withPersistenceErrorHandling('LocalCredential.findByEmail', async () => {
      const key = normalizedEmail.trim().toLowerCase();
      const record = await this.table.where('email').equals(key).first();
      return record ?? null;
    });
  }

  async save(credential: LocalCredential): Promise<void> {
    await withPersistenceErrorHandling('LocalCredential.save', async () => {
      const normalizedCredential: LocalCredential = {
        ...credential,
        email: credential.email.trim().toLowerCase(),
      };
      await this.table.put(normalizedCredential);
    });
  }
}
