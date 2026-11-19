import type { OrganizationId, UserId } from '@/shared/kernel';
import type { FocusPreference } from '../../domain/focus';

export interface FocusPreferenceRepositoryPort {
  findByUser(organizationId: OrganizationId, userId: UserId): Promise<FocusPreference | null>;
  save(preference: FocusPreference): Promise<void>;
}
