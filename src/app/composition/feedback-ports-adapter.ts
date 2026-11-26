import type { FeedbackActorProfile, FeedbackContextPort } from '@/modules/feedback';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  type OrganizationId,
  type UserId,
} from '@/shared/kernel';
import type { AppRepositoriesRegistry } from './repositories-registry';

/**
 * Thin composition-layer adapter bridging `FeedbackContextPort` to `users` and
 * `organizations` repositories without importing `@/modules/users` inside
 * `src/modules/feedback/**` (preserving the acyclic DAG — ADR-0013 §3).
 */
export function createFeedbackContextAdapter(
  repositories: AppRepositoriesRegistry,
): FeedbackContextPort {
  return {
    async findActorProfile(
      organizationId: OrganizationId,
      userId: UserId,
    ): Promise<FeedbackActorProfile | null> {
      const [user, membership] = await Promise.all([
        repositories.users.users.findById(userId),
        repositories.organizations.organizationMembers.findByOrganizationAndUser(
          organizationId,
          userId,
        ),
      ]);

      if (!user) {
        return null;
      }

      return {
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
        ...(membership !== null
          ? {
              organizationRole: membership.role,
              membershipStatus: membership.status,
            }
          : {}),
      };
    },

    async listActorProfiles(
      organizationId: OrganizationId,
      userIds: readonly UserId[],
    ): Promise<ReadonlyMap<UserId, FeedbackActorProfile>> {
      const uniqueIds = [...new Set(userIds)];
      if (uniqueIds.length === 0) {
        return new Map();
      }

      const [users, memberships] = await Promise.all([
        repositories.users.users.findByIds(uniqueIds),
        repositories.organizations.organizationMembers.listByOrganization(organizationId),
      ]);

      const membershipByUserId = new Map(memberships.map((member) => [member.userId, member]));
      const profileMap = new Map<UserId, FeedbackActorProfile>();

      for (const user of users) {
        const membership = membershipByUserId.get(user.id);
        profileMap.set(user.id, {
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
          ...(membership !== undefined
            ? {
                organizationRole: membership.role,
                membershipStatus: membership.status,
              }
            : {}),
        });
      }

      return profileMap;
    },

    async listAssignableHandlers(
      organizationId: OrganizationId,
    ): Promise<readonly FeedbackActorProfile[]> {
      const memberships =
        await repositories.organizations.organizationMembers.listByOrganization(organizationId);

      const eligibleMembers = memberships.filter(
        (member) =>
          member.status === MEMBERSHIP_STATUSES.ACTIVE &&
          (member.role === ORGANIZATION_ROLES.ADMIN || member.role === ORGANIZATION_ROLES.MANAGER),
      );

      if (eligibleMembers.length === 0) {
        return [];
      }

      const users = await repositories.users.users.findByIds(
        eligibleMembers.map((member) => member.userId),
      );
      const userById = new Map(users.map((user) => [user.id, user]));

      const profiles: FeedbackActorProfile[] = [];
      for (const member of eligibleMembers) {
        const user = userById.get(member.userId);
        if (!user) {
          continue;
        }
        profiles.push({
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
          organizationRole: member.role,
          membershipStatus: member.status,
        });
      }

      return profiles.sort(
        (a, b) => a.displayName.localeCompare(b.displayName) || a.userId.localeCompare(b.userId),
      );
    },
  };
}
