import { describe, expect, it } from 'vitest';
import { AuthorizationError, ValidationError } from '@/shared/errors';
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES,
  METRIC_AVAILABILITY_STATUSES,
  METRIC_UNAVAILABLE_REASONS,
  SYSTEM_ACTOR_ID,
  asCorrelationId,
  asEventId,
  asIsoDate,
  asIsoDateTime,
  asOrganizationId,
  asProjectId,
  asTaskId,
  asUserId,
  asUuid,
  assertSameOrganization,
  assertValidDateRange,
  assertValidPaginationParams,
  availableMetric,
  createDateRange,
  createDomainEvent,
  createPaginatedResult,
  diffDurationMs,
  isIsoDate,
  isIsoDateTime,
  isMetricAvailable,
  isSoftDeleted,
  isUuid,
  parseBrandedUuid,
  unavailableMetric,
  validateAttachmentQuota,
} from './index';

const VALID_UUID_1 = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_UPPER = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';

describe('Shared Kernel — Branded UUIDs', () => {
  it('validates canonical UUID format and rejects malformed values', () => {
    expect(isUuid(VALID_UUID_1)).toBe(true);
    expect(isUuid(VALID_UUID_UPPER)).toBe(true);

    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('11111111-1111-4111-8111-11111111111')).toBe(false);
    expect(isUuid('11111111-1111-4111-8111-11111111111g')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });

  it('parses branded UUIDs and throws ValidationError on invalid inputs', () => {
    expect(asUuid(VALID_UUID_1)).toBe(VALID_UUID_1);
    expect(asOrganizationId(VALID_UUID_1)).toBe(VALID_UUID_1);
    expect(asUserId(VALID_UUID_1)).toBe(VALID_UUID_1);
    expect(asProjectId(VALID_UUID_1)).toBe(VALID_UUID_1);
    expect(asTaskId(VALID_UUID_1)).toBe(VALID_UUID_1);
    expect(asEventId(VALID_UUID_1)).toBe(VALID_UUID_1);
    expect(asCorrelationId(VALID_UUID_1)).toBe(VALID_UUID_1);

    expect(() => parseBrandedUuid<'CustomId'>('invalid-id', 'customId')).toThrow(ValidationError);
    expect(() => asOrganizationId('org-1')).toThrow(ValidationError);
    expect(() => asUserId('')).toThrow(ValidationError);
  });
});

describe('Shared Kernel — ISO 8601 Temporal & DateRange', () => {
  it('validates real calendar dates including leap years and rejects impossible dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-11-19')).toBe(true);
    expect(asIsoDate('2026-11-19')).toBe('2026-11-19');

    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2026-04-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('2026-11-19T00:00:00Z')).toBe(false);
    expect(isIsoDate(123)).toBe(false);

    expect(() => asIsoDate('2025-02-29', 'holidayDate')).toThrow(ValidationError);
  });

  it('validates strict ISO 8601 date-time with timezone and rejects invalid calendar/time values', () => {
    expect(isIsoDateTime('2026-11-19T09:30:00Z')).toBe(true);
    expect(isIsoDateTime('2026-11-19T09:30:00.123Z')).toBe(true);
    expect(isIsoDateTime('2026-11-19T09:30:00-03:00')).toBe(true);
    expect(isIsoDateTime('2024-02-29T23:59:59+00:00')).toBe(true);
    expect(asIsoDateTime('2026-11-19T09:30:00Z')).toBe('2026-11-19T09:30:00Z');

    expect(isIsoDateTime('2026-11-19T09:30:00')).toBe(false);
    expect(isIsoDateTime('2025-02-29T09:30:00Z')).toBe(false);
    expect(isIsoDateTime('2026-11-19T24:00:00Z')).toBe(false);
    expect(isIsoDateTime('2026-11-19T12:60:00Z')).toBe(false);
    expect(isIsoDateTime('2026-11-19T12:00:60Z')).toBe(false);
    expect(isIsoDateTime('not-a-date')).toBe(false);

    expect(() => asIsoDateTime('2026-02-30T10:00:00Z', 'occurredAt')).toThrow(ValidationError);
  });

  it('validates and freezes DateRange and rejects inverted ranges', () => {
    const start = asIsoDateTime('2026-11-01T00:00:00Z');
    const end = asIsoDateTime('2026-11-10T00:00:00Z');

    const range = createDateRange(start, end);
    expect(Object.isFrozen(range)).toBe(true);
    expect(diffDurationMs(start, end)).toBe(9 * 24 * 60 * 60 * 1000);

    expect(() => assertValidDateRange({ start: end, end: start })).toThrow(ValidationError);
    expect(() => assertValidDateRange({ start, end: start })).not.toThrow();
  });
});

describe('Shared Kernel — Organization Isolation, SoftDelete & Pagination', () => {
  it('enforces multi-organization isolation in assertSameOrganization', () => {
    const orgA = asOrganizationId(VALID_UUID_1);
    const orgB = asOrganizationId(VALID_UUID_2);

    expect(() => assertSameOrganization(orgA, orgA, 'task')).not.toThrow();
    expect(() => assertSameOrganization(orgA, orgB, 'task')).toThrow(AuthorizationError);
  });

  it('evaluates soft-deletion and validates pagination helpers', () => {
    expect(isSoftDeleted({})).toBe(false);
    expect(isSoftDeleted({ deletedAt: asIsoDateTime('2026-11-19T00:00:00Z') })).toBe(true);

    expect(() => assertValidPaginationParams({ page: 0, pageSize: 10 })).toThrow(ValidationError);
    expect(() => assertValidPaginationParams({ page: 1, pageSize: 0 })).toThrow(ValidationError);

    const emptyPage = createPaginatedResult([], 0, { page: 1, pageSize: 20 });
    expect(emptyPage.totalPages).toBe(0);
    expect(Object.isFrozen(emptyPage)).toBe(true);

    const page = createPaginatedResult(['a', 'b'], 21, { page: 1, pageSize: 10 });
    expect(page.totalPages).toBe(3);
  });
});

describe('Shared Kernel — MetricValue (no implicit zero)', () => {
  it('distinguishes AVAILABLE and UNAVAILABLE metrics explicitly and freezes results', () => {
    const available = availableMetric(42);
    expect(available.status).toBe(METRIC_AVAILABILITY_STATUSES.AVAILABLE);
    expect(available.value).toBe(42);
    expect(isMetricAvailable(available)).toBe(true);
    expect(Object.isFrozen(available)).toBe(true);

    const unavailable = unavailableMetric(METRIC_UNAVAILABLE_REASONS.ZERO_DENOMINATOR);
    expect(unavailable.status).toBe(METRIC_AVAILABILITY_STATUSES.UNAVAILABLE);
    expect(unavailable.reason).toBe('ZERO_DENOMINATOR');
    expect(isMetricAvailable(unavailable)).toBe(false);
    expect('value' in unavailable).toBe(false);
    expect(Object.isFrozen(unavailable)).toBe(true);
  });
});

describe('Shared Kernel — DomainEventEnvelope (event-envelope.md)', () => {
  it('creates an immutable envelope with all required fields for user and SYSTEM actors', () => {
    const event = createDomainEvent({
      eventId: asEventId(VALID_UUID_1),
      eventType: 'task.completed',
      occurredAt: asIsoDateTime('2026-11-19T10:00:00Z'),
      organizationId: asOrganizationId(VALID_UUID_2),
      actorId: asUserId(VALID_UUID_1),
      correlationId: asCorrelationId(VALID_UUID_2),
      aggregateType: 'Task',
      aggregateId: VALID_UUID_1,
      payload: { cycleNumber: 1 },
    });

    expect(Object.isFrozen(event)).toBe(true);
    expect(event.eventType).toBe('task.completed');
    expect(event.organizationId).toBe(VALID_UUID_2);

    const systemEvent = createDomainEvent({
      eventId: asEventId(VALID_UUID_2),
      eventType: 'feedback.auto_closed',
      occurredAt: asIsoDateTime('2026-11-19T10:05:00Z'),
      actorId: SYSTEM_ACTOR_ID,
      correlationId: asCorrelationId(VALID_UUID_1),
      aggregateType: 'Feedback',
      aggregateId: VALID_UUID_2,
      payload: { closureReason: 'EXPIRED_WITHOUT_CONTEST' },
    });

    expect(systemEvent.actorId).toBe('SYSTEM');
    expect('organizationId' in systemEvent).toBe(false);
  });

  it('rejects missing or invalid envelope fields with ValidationError', () => {
    const validBase = {
      eventId: asEventId(VALID_UUID_1),
      eventType: 'task.created',
      occurredAt: asIsoDateTime('2026-11-19T10:00:00Z'),
      organizationId: asOrganizationId(VALID_UUID_2),
      actorId: asUserId(VALID_UUID_1),
      correlationId: asCorrelationId(VALID_UUID_2),
      aggregateType: 'Task',
      aggregateId: VALID_UUID_1,
      payload: {},
    };

    expect(() => createDomainEvent({ ...validBase, eventType: '   ' })).toThrow(ValidationError);
    expect(() => createDomainEvent({ ...validBase, aggregateType: '' })).toThrow(ValidationError);
    expect(() => createDomainEvent({ ...validBase, aggregateId: ' ' })).toThrow(ValidationError);
    expect(() =>
      createDomainEvent({ ...validBase, eventId: 'bad-uuid' as ReturnType<typeof asEventId> }),
    ).toThrow(ValidationError);
    expect(() =>
      createDomainEvent({
        ...validBase,
        occurredAt: '2026-02-30T10:00:00Z' as ReturnType<typeof asIsoDateTime>,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createDomainEvent({ ...validBase, actorId: 'bad-actor' as ReturnType<typeof asUserId> }),
    ).toThrow(ValidationError);
  });
});

describe('Shared Kernel — Attachment Quotas (15 MB file / 50 MB context)', () => {
  it('enforces exact 15 MB per-file and 50 MB cumulative context limits', () => {
    expect(MAX_ATTACHMENT_SIZE_BYTES).toBe(15 * 1024 * 1024);
    expect(MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES).toBe(50 * 1024 * 1024);

    expect(() =>
      validateAttachmentQuota({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_ATTACHMENT_SIZE_BYTES,
        existingContextTotalBytes: MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES - MAX_ATTACHMENT_SIZE_BYTES,
        allowedMimeTypes: ['application/pdf'],
      }),
    ).not.toThrow();

    // 15 MB + 1 byte rejected
    expect(() =>
      validateAttachmentQuota({
        fileName: 'too-big.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
        existingContextTotalBytes: 0,
      }),
    ).toThrow(ValidationError);

    // 50 MB + 1 byte cumulative rejected
    expect(() =>
      validateAttachmentQuota({
        fileName: 'overflow.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        existingContextTotalBytes: MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES - 1023,
      }),
    ).toThrow(ValidationError);

    // Disallowed MIME type rejected
    expect(() =>
      validateAttachmentQuota({
        fileName: 'script.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
        existingContextTotalBytes: 0,
        allowedMimeTypes: ['application/pdf', 'image/png'],
      }),
    ).toThrow(ValidationError);

    // Zero or negative size rejected
    expect(() =>
      validateAttachmentQuota({
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        sizeBytes: 0,
        existingContextTotalBytes: 0,
      }),
    ).toThrow(ValidationError);
  });
});
