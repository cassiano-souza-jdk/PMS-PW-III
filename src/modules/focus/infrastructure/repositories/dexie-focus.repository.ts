import { ConflictError } from '@/shared/errors';
import { TRANSACTION_RESOURCES, type OrganizationId, type UserId } from '@/shared/kernel';
import {
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { FocusPreferenceRepositoryPort } from '../../application/ports/focus-repository.port';
import type { FocusPreference, FocusPreferenceId } from '../../domain/focus';

export class DexieFocusPreferenceRepository implements FocusPreferenceRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<FocusPreference, FocusPreferenceId>(
      TRANSACTION_RESOURCES.FOCUS_PREFERENCES,
    );
  }

  async findByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<FocusPreference | null> {
    return withPersistenceErrorHandling('FocusPreference.findByUser', async () => {
      const record = await this.table
        .where('[organizationId+userId]')
        .equals([organizationId, userId])
        .first();
      return record ?? null;
    });
  }

  async save(preference: FocusPreference): Promise<void> {
    await withPersistenceErrorHandling('FocusPreference.save', async () => {
      const existingByUser = await this.table
        .where('[organizationId+userId]')
        .equals([preference.organizationId, preference.userId])
        .first();
      if (existingByUser !== undefined && existingByUser.id !== preference.id) {
        throw new ConflictError(
          `FocusPreference already exists for user "${preference.userId}" in organization "${preference.organizationId}".`,
          {
            details: {
              organizationId: preference.organizationId,
              userId: preference.userId,
            },
          },
        );
      }
    });

    await saveOrganizationScopedEntity(this.table, preference, 'FocusPreference');
  }
}
