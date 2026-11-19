import { ConflictError } from '@/shared/errors';
import type {
  ImpedimentId,
  ImpedimentSeverity,
  IsoDateTime,
  OrganizationScoped,
  ProjectId,
  TaskId,
  UserId,
} from '@/shared/kernel';

/** Exact 7 impediment categories specified in PRD.md §11. */
export const IMPEDIMENT_CATEGORIES = {
  EXTERNAL_DEPENDENCY: 'EXTERNAL_DEPENDENCY',
  TECHNICAL_ISSUE: 'TECHNICAL_ISSUE',
  MISSING_INFORMATION: 'MISSING_INFORMATION',
  RESOURCE_UNAVAILABILITY: 'RESOURCE_UNAVAILABILITY',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  COMMUNICATION: 'COMMUNICATION',
  OTHER: 'OTHER',
} as const;

export type ImpedimentCategory = (typeof IMPEDIMENT_CATEGORIES)[keyof typeof IMPEDIMENT_CATEGORIES];

export const IMPEDIMENT_STATUSES = {
  OPEN: 'OPEN',
  IN_RESOLUTION: 'IN_RESOLUTION',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
} as const;

export type ImpedimentStatus = (typeof IMPEDIMENT_STATUSES)[keyof typeof IMPEDIMENT_STATUSES];

export interface Impediment extends OrganizationScoped {
  readonly id: ImpedimentId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly category: ImpedimentCategory;
  readonly severity: ImpedimentSeverity;
  readonly description: string;
  readonly ownerUserId?: UserId;
  readonly status: ImpedimentStatus;
  readonly openedByUserId: UserId;
  readonly openedAt: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
  readonly resolvedByUserId?: UserId;
  readonly resolutionNote?: string;
  readonly updatedAt: IsoDateTime;
}

export interface ImpedimentTransitionResult {
  readonly allowed: true;
  /** Resolving an impediment never automatically completes its task (PRD.md §11). */
  readonly autoCompletesTask: false;
}

const ALLOWED_TRANSITIONS: Readonly<Record<ImpedimentStatus, readonly ImpedimentStatus[]>> = {
  [IMPEDIMENT_STATUSES.OPEN]: [
    IMPEDIMENT_STATUSES.IN_RESOLUTION,
    IMPEDIMENT_STATUSES.RESOLVED,
    IMPEDIMENT_STATUSES.CANCELLED,
  ],
  [IMPEDIMENT_STATUSES.IN_RESOLUTION]: [
    IMPEDIMENT_STATUSES.OPEN,
    IMPEDIMENT_STATUSES.RESOLVED,
    IMPEDIMENT_STATUSES.CANCELLED,
  ],
  [IMPEDIMENT_STATUSES.RESOLVED]: [],
  [IMPEDIMENT_STATUSES.CANCELLED]: [],
};

export function isImpedimentBlocking(impediment: Impediment): boolean {
  return (
    impediment.status === IMPEDIMENT_STATUSES.OPEN ||
    impediment.status === IMPEDIMENT_STATUSES.IN_RESOLUTION
  );
}

/**
 * Validates impediment status transitions (PRD.md §11):
 * resolved/cancelled impediments are terminal; resolving an impediment never concludes the task.
 */
export function assertImpedimentTransitionAllowed(
  from: ImpedimentStatus,
  to: ImpedimentStatus,
): ImpedimentTransitionResult {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`Invalid impediment status transition from "${from}" to "${to}".`, {
      details: { from, to },
    });
  }

  return Object.freeze({
    allowed: true,
    autoCompletesTask: false,
  });
}
