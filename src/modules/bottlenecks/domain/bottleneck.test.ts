import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors';
import {
  DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS,
  assertValidProjectBottleneckThresholds,
  normalizeProjectBottleneckThresholds,
  type ProjectBottleneckThresholds,
} from '../index';

describe('ProjectBottleneckThresholds — Defaults, Validation & Normalization (ADR-0012 DN-03)', () => {
  it('falls back deterministically to DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS when undefined or partially specified', () => {
    expect(DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS).toEqual({
      wipUtilizationPercent: 80,
      inactivityWarningCount: 2,
      inactivityCriticalCount: 5,
      overdueWarningCount: 1,
      overdueCriticalCount: 3,
      blockedWarningCount: 1,
      blockedCriticalCount: 3,
      overloadHighScore: 50,
      overloadCriticalScore: 75,
    });

    expect(normalizeProjectBottleneckThresholds(undefined)).toEqual(
      DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS,
    );

    const partial: ProjectBottleneckThresholds = {
      wipUtilizationPercent: 90,
      overdueWarningCount: 2,
      overdueCriticalCount: 6,
      blockedCriticalCount: 4,
      overloadHighScore: undefined,
    };

    expect(normalizeProjectBottleneckThresholds(partial)).toEqual({
      ...DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS,
      wipUtilizationPercent: 90,
      overdueWarningCount: 2,
      overdueCriticalCount: 6,
      blockedCriticalCount: 4,
    });
  });

  it('rejects non-integer, out-of-bounds and inverted warning/critical threshold pairs', () => {
    expect(() => assertValidProjectBottleneckThresholds({ wipUtilizationPercent: 0 })).toThrow(
      ValidationError,
    );
    expect(() => assertValidProjectBottleneckThresholds({ wipUtilizationPercent: 101 })).toThrow(
      ValidationError,
    );
    expect(() => assertValidProjectBottleneckThresholds({ wipUtilizationPercent: 82.5 })).toThrow(
      ValidationError,
    );
    expect(() => assertValidProjectBottleneckThresholds({ overdueWarningCount: 0 })).toThrow(
      ValidationError,
    );
    expect(() => assertValidProjectBottleneckThresholds({ blockedCriticalCount: -1 })).toThrow(
      ValidationError,
    );
    expect(() => assertValidProjectBottleneckThresholds({ overloadCriticalScore: 101 })).toThrow(
      ValidationError,
    );

    expect(() =>
      assertValidProjectBottleneckThresholds({
        inactivityWarningCount: 5,
        inactivityCriticalCount: 4,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      assertValidProjectBottleneckThresholds({
        overdueWarningCount: 4,
        overdueCriticalCount: 2,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      assertValidProjectBottleneckThresholds({
        blockedWarningCount: 3,
        blockedCriticalCount: 2,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      assertValidProjectBottleneckThresholds({
        overloadHighScore: 80,
        overloadCriticalScore: 70,
      }),
    ).toThrow(ValidationError);

    // Partial override conflicting with resolved default critical threshold is caught on normalize
    expect(() => normalizeProjectBottleneckThresholds({ overdueWarningCount: 5 })).toThrow(
      ValidationError,
    );
  });
});
