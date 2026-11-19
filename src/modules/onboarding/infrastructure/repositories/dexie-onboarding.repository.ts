import { ConflictError } from '@/shared/errors';
import { TRANSACTION_RESOURCES, type OrganizationId, type UserId } from '@/shared/kernel';
import {
  saveOrganizationScopedEntity,
  withPersistenceErrorHandling,
  type PmsDatabase,
} from '@/shared/persistence';
import type { OnboardingProgressRepositoryPort } from '../../application/ports/onboarding-repository.port';
import type { OnboardingProgress, OnboardingProgressId } from '../../domain/onboarding';

export class DexieOnboardingProgressRepository implements OnboardingProgressRepositoryPort {
  private readonly db: PmsDatabase;

  constructor(db: PmsDatabase) {
    this.db = db;
  }

  private get table() {
    return this.db.getTable<OnboardingProgress, OnboardingProgressId>(
      TRANSACTION_RESOURCES.ONBOARDING_PROGRESS,
    );
  }

  async findByUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OnboardingProgress | null> {
    return withPersistenceErrorHandling('OnboardingProgress.findByUser', async () => {
      const record = await this.table
        .where('[organizationId+userId]')
        .equals([organizationId, userId])
        .first();
      return record ?? null;
    });
  }

  async save(progress: OnboardingProgress): Promise<void> {
    await withPersistenceErrorHandling('OnboardingProgress.save', async () => {
      const existingByUser = await this.table
        .where('[organizationId+userId]')
        .equals([progress.organizationId, progress.userId])
        .first();
      if (existingByUser !== undefined && existingByUser.id !== progress.id) {
        throw new ConflictError(
          `OnboardingProgress already exists for user "${progress.userId}" in organization "${progress.organizationId}".`,
          {
            details: {
              organizationId: progress.organizationId,
              userId: progress.userId,
            },
          },
        );
      }
    });

    await saveOrganizationScopedEntity(this.table, progress, 'OnboardingProgress');
  }
}
