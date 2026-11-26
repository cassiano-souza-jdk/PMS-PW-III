import type { MembershipStatus, OrganizationId, OrganizationRole, UserId } from '@/shared/kernel';

export interface FeedbackActorProfile {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl?: string;
  readonly organizationRole?: OrganizationRole;
  readonly membershipStatus?: MembershipStatus;
}

/**
 * Local anti-cycle port allowing `FeedbackService` to resolve user profile details
 * and eligible organizational handlers (`ADMIN` / `MANAGER`) without importing
 * `@/modules/users` (preserving the acyclic DAG — ADR-0013 §3).
 */
export interface FeedbackContextPort {
  findActorProfile(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<FeedbackActorProfile | null>;
  listActorProfiles(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, FeedbackActorProfile>>;
  listAssignableHandlers(organizationId: OrganizationId): Promise<readonly FeedbackActorProfile[]>;
}
