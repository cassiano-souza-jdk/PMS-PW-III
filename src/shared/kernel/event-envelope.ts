import { ValidationError } from '@/shared/errors';
import {
  isUuid,
  type CorrelationId,
  type EventId,
  type OrganizationId,
  type UserId,
} from './identifiers';
import { isIsoDateTime, type IsoDateTime } from './temporal';

export const SYSTEM_ACTOR_ID = 'SYSTEM' as const;

export type EventActorId = UserId | typeof SYSTEM_ACTOR_ID;

/**
 * Canonical domain event envelope (docs/contracts/event-envelope.md).
 * Payload must contain only the minimum required data and never secrets, tokens or passwords.
 */
export interface DomainEventEnvelope<
  TEventType extends string = string,
  TPayload = Record<string, unknown>,
> {
  readonly eventId: EventId;
  readonly eventType: TEventType;
  readonly occurredAt: IsoDateTime;
  readonly organizationId?: OrganizationId;
  readonly actorId: EventActorId;
  readonly correlationId: CorrelationId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
}

export interface CreateDomainEventInput<
  TEventType extends string = string,
  TPayload = Record<string, unknown>,
> {
  readonly eventId: EventId;
  readonly eventType: TEventType;
  readonly occurredAt: IsoDateTime;
  readonly organizationId?: OrganizationId;
  readonly actorId: EventActorId;
  readonly correlationId: CorrelationId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
}

/**
 * Outbound event publisher port.
 * Rule (ARCHITECTURE.md / docs/contracts/event-envelope.md):
 * events MUST be published only after confirmed persistence and MUST NOT replace transactions or authorization.
 */
export interface DomainEventPublisherPort {
  publish(event: DomainEventEnvelope): Promise<void>;
  publishMany(events: readonly DomainEventEnvelope[]): Promise<void>;
}

function assertNonEmptyString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`Domain event "${fieldName}" must be a non-empty string.`, {
      details: { field: fieldName },
    });
  }

  return trimmed;
}

export function createDomainEvent<
  TEventType extends string = string,
  TPayload = Record<string, unknown>,
>(input: CreateDomainEventInput<TEventType, TPayload>): DomainEventEnvelope<TEventType, TPayload> {
  if (!isUuid(input.eventId)) {
    throw new ValidationError('Domain event "eventId" must be a valid UUID.', {
      details: { field: 'eventId' },
    });
  }

  const eventType = assertNonEmptyString(input.eventType, 'eventType') as TEventType;

  if (!isIsoDateTime(input.occurredAt)) {
    throw new ValidationError('Domain event "occurredAt" must be a valid ISO 8601 date-time.', {
      details: { field: 'occurredAt' },
    });
  }

  if (input.organizationId !== undefined && !isUuid(input.organizationId)) {
    throw new ValidationError('Domain event "organizationId" must be a valid UUID when provided.', {
      details: { field: 'organizationId' },
    });
  }

  if (input.actorId !== SYSTEM_ACTOR_ID && !isUuid(input.actorId)) {
    throw new ValidationError('Domain event "actorId" must be a valid UserId UUID or "SYSTEM".', {
      details: { field: 'actorId' },
    });
  }

  if (!isUuid(input.correlationId)) {
    throw new ValidationError('Domain event "correlationId" must be a valid UUID.', {
      details: { field: 'correlationId' },
    });
  }

  const aggregateType = assertNonEmptyString(input.aggregateType, 'aggregateType');
  const aggregateId = assertNonEmptyString(input.aggregateId, 'aggregateId');

  const envelope: DomainEventEnvelope<TEventType, TPayload> = {
    eventId: input.eventId,
    eventType,
    occurredAt: input.occurredAt,
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    actorId: input.actorId,
    correlationId: input.correlationId,
    aggregateType,
    aggregateId,
    payload: input.payload,
  };

  return Object.freeze(envelope);
}
