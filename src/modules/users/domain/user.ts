import { ValidationError } from '@/shared/errors';
import type { AuditableTimestamps, IsoDateTime, SoftDeletable, UserId } from '@/shared/kernel';

export interface User extends AuditableTimestamps, SoftDeletable {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly acceptedTermsAt: IsoDateTime;
  readonly emailVerifiedSimulated: boolean;
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string, fieldName = 'email'): string {
  const normalized = email.trim().toLowerCase();

  if (normalized.length === 0 || !SIMPLE_EMAIL_PATTERN.test(normalized)) {
    throw new ValidationError(`Invalid email address for "${fieldName}".`, {
      details: { field: fieldName },
    });
  }

  return normalized;
}
