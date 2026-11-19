import type { OrganizationId, UserId } from '@/shared/kernel';
import type { OnboardingProgress } from '../../domain/onboarding';

export interface OnboardingProgressRepositoryPort {
  findByUser(organizationId: OrganizationId, userId: UserId): Promise<OnboardingProgress | null>;
  save(progress: OnboardingProgress): Promise<void>;
}
