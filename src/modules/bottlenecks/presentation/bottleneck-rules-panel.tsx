import { zodResolver } from '@hookform/resolvers/zod';
import { IconAdjustments, IconCheck } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui';
import type {
  ResolvedProjectBottleneckThresholds,
  UpdateProjectBottleneckRulesInput,
} from '../application/contracts';

const bottleneckRulesSchema = z
  .object({
    inactivityThresholdDays: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR')
      .max(365, 'errors.VALIDATION_ERROR'),
    wipUtilizationPercent: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR')
      .max(100, 'errors.VALIDATION_ERROR'),
    inactivityWarningCount: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR'),
    inactivityCriticalCount: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR'),
    overdueWarningCount: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR'),
    overdueCriticalCount: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR'),
    blockedWarningCount: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR'),
    blockedCriticalCount: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR'),
    overloadHighScore: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR')
      .max(100, 'errors.VALIDATION_ERROR'),
    overloadCriticalScore: z.coerce
      .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
      .int('errors.VALIDATION_ERROR')
      .min(1, 'errors.VALIDATION_ERROR')
      .max(100, 'errors.VALIDATION_ERROR'),
  })
  .superRefine((data, ctx) => {
    if (data.inactivityCriticalCount < data.inactivityWarningCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inactivityCriticalCount'],
        message: 'bottlenecks.rules.invalidRangeError',
      });
    }
    if (data.overdueCriticalCount < data.overdueWarningCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['overdueCriticalCount'],
        message: 'bottlenecks.rules.invalidRangeError',
      });
    }
    if (data.blockedCriticalCount < data.blockedWarningCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blockedCriticalCount'],
        message: 'bottlenecks.rules.invalidRangeError',
      });
    }
    if (data.overloadCriticalScore < data.overloadHighScore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['overloadCriticalScore'],
        message: 'bottlenecks.rules.invalidRangeError',
      });
    }
  });

export type BottleneckRulesFormValues = z.infer<typeof bottleneckRulesSchema>;

interface RuleFieldConfig {
  readonly name: keyof BottleneckRulesFormValues;
  readonly labelId: MessageId;
  readonly min: number;
  readonly max?: number;
}

const RULE_FIELDS: readonly RuleFieldConfig[] = [
  {
    name: 'inactivityThresholdDays',
    labelId: 'bottlenecks.rules.inactivityThresholdDaysLabel',
    min: 1,
    max: 365,
  },
  {
    name: 'wipUtilizationPercent',
    labelId: 'bottlenecks.rules.wipUtilizationPercentLabel',
    min: 1,
    max: 100,
  },
  {
    name: 'inactivityWarningCount',
    labelId: 'bottlenecks.rules.inactivityWarningCountLabel',
    min: 1,
  },
  {
    name: 'inactivityCriticalCount',
    labelId: 'bottlenecks.rules.inactivityCriticalCountLabel',
    min: 1,
  },
  {
    name: 'overdueWarningCount',
    labelId: 'bottlenecks.rules.overdueWarningCountLabel',
    min: 1,
  },
  {
    name: 'overdueCriticalCount',
    labelId: 'bottlenecks.rules.overdueCriticalCountLabel',
    min: 1,
  },
  {
    name: 'blockedWarningCount',
    labelId: 'bottlenecks.rules.blockedWarningCountLabel',
    min: 1,
  },
  {
    name: 'blockedCriticalCount',
    labelId: 'bottlenecks.rules.blockedCriticalCountLabel',
    min: 1,
  },
  {
    name: 'overloadHighScore',
    labelId: 'bottlenecks.rules.overloadHighScoreLabel',
    min: 1,
    max: 100,
  },
  {
    name: 'overloadCriticalScore',
    labelId: 'bottlenecks.rules.overloadCriticalScoreLabel',
    min: 1,
    max: 100,
  },
];

function resolveRuleErrorId(message: string | undefined): MessageId {
  if (message === 'bottlenecks.rules.invalidRangeError') {
    return 'bottlenecks.rules.invalidRangeError';
  }
  return 'errors.VALIDATION_ERROR';
}

export interface BottleneckRulesPanelProps {
  readonly inactivityThresholdDays: number;
  readonly thresholds: ResolvedProjectBottleneckThresholds;
  readonly canManageRules: boolean;
  readonly isProjectArchived: boolean;
  readonly isBusy: boolean;
  readonly onSaveRules: (input: UpdateProjectBottleneckRulesInput) => Promise<void>;
}

export function BottleneckRulesPanel({
  inactivityThresholdDays,
  thresholds,
  canManageRules,
  isProjectArchived,
  isBusy,
  onSaveRules,
}: BottleneckRulesPanelProps) {
  const intl = useIntl();
  const isReadOnly = !canManageRules || isProjectArchived;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BottleneckRulesFormValues>({
    resolver: zodResolver(bottleneckRulesSchema),
    defaultValues: {
      inactivityThresholdDays,
      wipUtilizationPercent: thresholds.wipUtilizationPercent,
      inactivityWarningCount: thresholds.inactivityWarningCount,
      inactivityCriticalCount: thresholds.inactivityCriticalCount,
      overdueWarningCount: thresholds.overdueWarningCount,
      overdueCriticalCount: thresholds.overdueCriticalCount,
      blockedWarningCount: thresholds.blockedWarningCount,
      blockedCriticalCount: thresholds.blockedCriticalCount,
      overloadHighScore: thresholds.overloadHighScore,
      overloadCriticalScore: thresholds.overloadCriticalScore,
    },
  });

  useEffect(() => {
    reset({
      inactivityThresholdDays,
      wipUtilizationPercent: thresholds.wipUtilizationPercent,
      inactivityWarningCount: thresholds.inactivityWarningCount,
      inactivityCriticalCount: thresholds.inactivityCriticalCount,
      overdueWarningCount: thresholds.overdueWarningCount,
      overdueCriticalCount: thresholds.overdueCriticalCount,
      blockedWarningCount: thresholds.blockedWarningCount,
      blockedCriticalCount: thresholds.blockedCriticalCount,
      overloadHighScore: thresholds.overloadHighScore,
      overloadCriticalScore: thresholds.overloadCriticalScore,
    });
  }, [inactivityThresholdDays, reset, thresholds]);

  const onSubmit = async (values: BottleneckRulesFormValues) => {
    await onSaveRules({
      inactivityThresholdDays: values.inactivityThresholdDays,
      thresholds: {
        wipUtilizationPercent: values.wipUtilizationPercent,
        inactivityWarningCount: values.inactivityWarningCount,
        inactivityCriticalCount: values.inactivityCriticalCount,
        overdueWarningCount: values.overdueWarningCount,
        overdueCriticalCount: values.overdueCriticalCount,
        blockedWarningCount: values.blockedWarningCount,
        blockedCriticalCount: values.blockedCriticalCount,
        overloadHighScore: values.overloadHighScore,
        overloadCriticalScore: values.overloadCriticalScore,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <IconAdjustments className="h-5 w-5 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <CardTitle>{intl.formatMessage({ id: 'bottlenecks.rules.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'bottlenecks.rules.description' })}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!canManageRules ? (
          <Alert variant="info">
            <AlertDescription>
              {intl.formatMessage({ id: 'bottlenecks.rules.noPermission' })}
            </AlertDescription>
          </Alert>
        ) : null}

        {isProjectArchived ? (
          <Alert variant="warning">
            <AlertDescription>
              {intl.formatMessage({ id: 'bottlenecks.archivedLockBanner' })}
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {RULE_FIELDS.map((field) => {
              const fieldError = errors[field.name];
              const inputId = `bottleneck-rule-${field.name}`;
              const errorId = `${inputId}-error`;
              return (
                <div key={field.name} className="space-y-1.5">
                  <Label htmlFor={inputId} required>
                    {intl.formatMessage({ id: field.labelId })}
                  </Label>
                  <Input
                    id={inputId}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={1}
                    disabled={isReadOnly || isBusy || isSubmitting}
                    aria-invalid={fieldError !== undefined}
                    aria-describedby={fieldError !== undefined ? errorId : undefined}
                    {...register(field.name)}
                  />
                  {fieldError !== undefined ? (
                    <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
                      {intl.formatMessage({ id: resolveRuleErrorId(fieldError.message) })}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <Button
            type="submit"
            className="min-h-[44px]"
            disabled={isReadOnly || isBusy || isSubmitting}
          >
            <IconCheck className="h-4 w-4" aria-hidden="true" />
            <span>
              {intl.formatMessage({
                id: isSubmitting ? 'auth.common.submitting' : 'bottlenecks.rules.saveAction',
              })}
            </span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
