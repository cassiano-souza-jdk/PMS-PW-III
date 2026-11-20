import { z } from 'zod';
import {
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEvent,
  type AuditEventRepositoryPort,
} from '@/modules/audit';
import { NotFoundError, ValidationError } from '@/shared/errors';
import {
  TRANSACTION_RESOURCES,
  asAuditEventId,
  asCorrelationId,
  asEventId,
  asIsoDateTime,
  asUserId,
  createDomainEvent,
  isSoftDeleted,
  isUuid,
  type CorrelationId,
  type DomainEventPublisherPort,
  type IsoDateTime,
  type OrganizationId,
  type TransactionPort,
  type UserId,
} from '@/shared/kernel';
import type { Logger } from '@/shared/logging';
import type { User } from '../../domain/user';
import type { UserRepositoryPort } from '../ports/user-repository.port';

const updateMyProfileInputSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  avatarUrl: z
    .union([
      z
        .string()
        .trim()
        .url('Avatar URL must be a valid HTTP(S) URL.')
        .max(500)
        .refine(
          (url) => url.startsWith('https://') || url.startsWith('http://'),
          'Avatar URL must use http:// or https:// protocol.',
        ),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  activeOrganizationId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
});

export interface UserServiceDependencies {
  readonly users: UserRepositoryPort;
  readonly auditEvents: AuditEventRepositoryPort;
  readonly transactionPort: TransactionPort;
  readonly eventBus: DomainEventPublisherPort;
  readonly isActiveOrganizationMember?: (
    organizationId: OrganizationId,
    userId: UserId,
  ) => Promise<boolean>;
  readonly logger?: Logger;
  readonly now?: () => IsoDateTime;
  readonly generateUuid?: () => string;
}

export interface UpdateMyProfileInput {
  readonly displayName: string;
  readonly avatarUrl?: string | null;
  readonly activeOrganizationId?: OrganizationId;
  readonly correlationId?: CorrelationId;
}

function defaultNowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}

function defaultUuidGenerator(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return '00000000-0000-4000-8000-000000000001';
}

export class UserService {
  private readonly deps: UserServiceDependencies;
  private readonly now: () => IsoDateTime;
  private readonly nextUuid: () => string;

  constructor(deps: UserServiceDependencies) {
    this.deps = deps;
    this.now = deps.now ?? defaultNowIso;
    this.nextUuid = deps.generateUuid ?? defaultUuidGenerator;
  }

  async getMyProfile(actorUserId: UserId): Promise<User> {
    const validatedUserId = asUserId(actorUserId, 'actorUserId');
    const user = await this.deps.users.findById(validatedUserId);

    if (!user || isSoftDeleted(user)) {
      throw new NotFoundError(`User "${validatedUserId}" was not found.`, {
        details: { userId: validatedUserId },
      });
    }

    return user;
  }

  async updateMyProfile(actorUserId: UserId, input: UpdateMyProfileInput): Promise<User> {
    const validatedUserId = asUserId(actorUserId, 'actorUserId');
    const parsedResult = updateMyProfileInputSchema.safeParse(input);
    if (!parsedResult.success) {
      throw new ValidationError('Invalid profile update payload.', {
        details: {
          issues: parsedResult.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    const parsed = parsedResult.data;
    const now = this.now();
    const correlationId =
      parsed.correlationId && isUuid(parsed.correlationId)
        ? asCorrelationId(parsed.correlationId)
        : asCorrelationId(this.nextUuid());

    const existing = await this.deps.users.findById(validatedUserId);
    if (!existing || isSoftDeleted(existing)) {
      throw new NotFoundError(`User "${validatedUserId}" was not found.`, {
        details: { userId: validatedUserId },
      });
    }

    const { avatarUrl: _previousAvatar, ...existingWithoutAvatar } = existing;
    let nextAvatarUrl: string | undefined = existing.avatarUrl;

    if (parsed.avatarUrl !== undefined) {
      if (parsed.avatarUrl === null || parsed.avatarUrl === '') {
        nextAvatarUrl = undefined;
      } else {
        nextAvatarUrl = parsed.avatarUrl;
      }
    }

    const updatedUser: User = {
      ...existingWithoutAvatar,
      displayName: parsed.displayName,
      ...(nextAvatarUrl !== undefined ? { avatarUrl: nextAvatarUrl } : {}),
      updatedAt: now,
    };

    let verifiedAuditOrganizationId: OrganizationId | undefined = input.activeOrganizationId;
    if (
      verifiedAuditOrganizationId !== undefined &&
      this.deps.isActiveOrganizationMember !== undefined
    ) {
      const isActiveMember = await this.deps.isActiveOrganizationMember(
        verifiedAuditOrganizationId,
        validatedUserId,
      );
      if (!isActiveMember) {
        verifiedAuditOrganizationId = undefined;
      }
    }

    const resources =
      verifiedAuditOrganizationId !== undefined
        ? ([TRANSACTION_RESOURCES.USERS, TRANSACTION_RESOURCES.AUDIT_EVENTS] as const)
        : ([TRANSACTION_RESOURCES.USERS] as const);

    await this.deps.transactionPort.run(resources, async () => {
      await this.deps.users.save(updatedUser);

      if (verifiedAuditOrganizationId !== undefined) {
        const auditEvent: AuditEvent = {
          id: asAuditEventId(this.nextUuid()),
          organizationId: verifiedAuditOrganizationId,
          actorId: validatedUserId,
          occurredAt: now,
          category: AUDIT_CATEGORIES.ORGANIZATION,
          eventType: 'user.profile.updated',
          resourceType: 'User',
          resourceId: validatedUserId,
          before: {
            displayName: existing.displayName,
            hasAvatarUrl: existing.avatarUrl !== undefined,
          },
          after: {
            displayName: updatedUser.displayName,
            hasAvatarUrl: updatedUser.avatarUrl !== undefined,
          },
          result: AUDIT_RESULTS.SUCCESS,
          correlationId,
        };
        await this.deps.auditEvents.append(auditEvent);
      }

      await this.deps.eventBus.publish(
        createDomainEvent({
          eventId: asEventId(this.nextUuid()),
          eventType: 'user.profile.updated',
          occurredAt: now,
          ...(verifiedAuditOrganizationId !== undefined
            ? { organizationId: verifiedAuditOrganizationId }
            : {}),
          actorId: validatedUserId,
          correlationId,
          aggregateType: 'User',
          aggregateId: validatedUserId,
          payload: {
            userId: validatedUserId,
            displayName: updatedUser.displayName,
          },
        }),
      );
    });

    this.deps.logger?.info('User profile updated.', {
      userId: validatedUserId,
      correlationId,
    });

    return updatedUser;
  }
}
