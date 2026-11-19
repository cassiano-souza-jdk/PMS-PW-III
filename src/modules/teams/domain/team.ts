import { ConflictError } from '@/shared/errors';
import {
  isSoftDeleted,
  parseBrandedUuid,
  type AuditableTimestamps,
  type Brand,
  type IsoDateTime,
  type OrganizationScoped,
  type SoftDeletable,
  type TeamId,
  type UserId,
} from '@/shared/kernel';

export type TeamMemberId = Brand<string, 'TeamMemberId'>;

export function asTeamMemberId(value: string, fieldName = 'teamMemberId'): TeamMemberId {
  return parseBrandedUuid<'TeamMemberId'>(value, fieldName);
}

export interface Team extends OrganizationScoped, AuditableTimestamps, SoftDeletable {
  readonly id: TeamId;
  readonly name: string;
  readonly description?: string;
  readonly managerUserIds: readonly UserId[];
  readonly archivedAt?: IsoDateTime;
  readonly createdByUserId: UserId;
}

export interface TeamMember extends OrganizationScoped {
  readonly id: TeamMemberId;
  readonly teamId: TeamId;
  readonly userId: UserId;
  readonly joinedAt: IsoDateTime;
  readonly removedAt?: IsoDateTime;
}

/**
 * Archived or logically deleted teams cannot accept new member associations (PRD.md §7.3).
 */
export function assertTeamAcceptsMembers(team: Team): void {
  if (isSoftDeleted(team)) {
    throw new ConflictError('Cannot associate members to a deleted team.', {
      details: { teamId: team.id },
    });
  }

  if (team.archivedAt !== undefined) {
    throw new ConflictError('Cannot associate new members to an archived team.', {
      details: { teamId: team.id },
    });
  }
}
