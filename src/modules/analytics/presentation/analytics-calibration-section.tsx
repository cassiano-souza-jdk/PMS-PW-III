import { IconAdjustments, IconDeviceFloppy } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import {
  Alert,
  AlertDescription,
  Badge,
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
  AnalyticsCalibrationDraft,
  AnalyticsCalibrationSettingsView,
  UpdateCalibrationSettingsInput,
} from '../application/contracts';
import {
  CONTROL_TEXTAREA_CLASS_NAME,
  computeCalibrationGroupSums,
  formatAnalyticsDateTime,
} from './analytics-ui-helpers';

export interface AnalyticsCalibrationSectionProps {
  readonly settings: AnalyticsCalibrationSettingsView;
  readonly isBusy: boolean;
  readonly onSaveCalibration: (input: UpdateCalibrationSettingsInput) => Promise<void>;
}

function createInitialDraft(settings: AnalyticsCalibrationSettingsView): AnalyticsCalibrationDraft {
  return {
    ...settings.calibratableWeights,
    justification: '',
  };
}

export function AnalyticsCalibrationSection({
  settings,
  isBusy,
  onSaveCalibration,
}: AnalyticsCalibrationSectionProps) {
  const intl = useIntl();
  const [draft, setDraft] = useState<AnalyticsCalibrationDraft>(() => createInitialDraft(settings));
  const [validationError, setValidationError] = useState<string | null>(null);

  const sums = computeCalibrationGroupSums(draft);
  const workloadPercent = Math.round(sums.workloadSum * 1000) / 10;
  const focusPercent = Math.round(sums.focusSum * 1000) / 10;

  const updateNumericField = (field: keyof AnalyticsCalibrationDraft, rawValue: string) => {
    const parsed = Number(rawValue);
    setValidationError(null);
    setDraft((prev) => ({
      ...prev,
      [field]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sums.isWorkloadSumValid || !sums.isFocusSumValid) {
      setValidationError(intl.formatMessage({ id: 'analytics.calibration.sumMismatchError' }));
      return;
    }

    setValidationError(null);
    const trimmedJustification = draft.justification?.trim();
    await onSaveCalibration({
      calibratableWeights: {
        workloadPriorityWeight: draft.workloadPriorityWeight,
        workloadDelayWeight: draft.workloadDelayWeight,
        workloadImpedimentsWeight: draft.workloadImpedimentsWeight,
        workloadOperationalStateWeight: draft.workloadOperationalStateWeight,
        workloadPausedFactor: draft.workloadPausedFactor,
        focusPriorityWeight: draft.focusPriorityWeight,
        focusDeadlineWeight: draft.focusDeadlineWeight,
        focusDependenciesWeight: draft.focusDependenciesWeight,
        focusInactivityWeight: draft.focusInactivityWeight,
        focusWorkloadCompatibilityWeight: draft.focusWorkloadCompatibilityWeight,
        defaultProjectInactivityThresholdDays: Math.round(
          draft.defaultProjectInactivityThresholdDays,
        ),
      },
      ...(trimmedJustification !== undefined && trimmedJustification.length > 0
        ? { justification: trimmedJustification }
        : {}),
    });
  };

  return (
    <section aria-labelledby="analytics-calibration-heading" className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconAdjustments className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle id="analytics-calibration-heading">
                {intl.formatMessage({ id: 'analytics.calibration.title' })}
              </CardTitle>
            </div>
            <Badge variant="outline">
              {intl.formatMessage(
                { id: 'analytics.calibration.updatedAtLabel' },
                { date: formatAnalyticsDateTime(settings.updatedAt, intl) },
              )}
            </Badge>
          </div>
          <CardDescription>
            {intl.formatMessage({ id: 'analytics.calibration.description' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertDescription>
              {intl.formatMessage({ id: 'analytics.calibration.adminOnlyNotice' })}
            </AlertDescription>
          </Alert>

          {validationError !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
            <fieldset className="space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <legend className="px-1 text-base font-semibold text-foreground">
                  {intl.formatMessage({ id: 'analytics.calibration.workloadSectionTitle' })}
                </legend>
                <Badge variant={sums.isWorkloadSumValid ? 'secondary' : 'destructive'}>
                  {intl.formatMessage(
                    { id: 'analytics.calibration.sumLabel' },
                    { percent: intl.formatNumber(workloadPercent, { maximumFractionDigits: 1 }) },
                  )}
                </Badge>
              </div>

              {!sums.isWorkloadSumValid ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {intl.formatMessage({ id: 'analytics.calibration.sumMismatchError' })}
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cal-workload-priority">
                    {intl.formatMessage({
                      id: 'analytics.calibration.workloadPriorityWeightLabel',
                    })}
                  </Label>
                  <Input
                    id="cal-workload-priority"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.workloadPriorityWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('workloadPriorityWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-workload-delay">
                    {intl.formatMessage({ id: 'analytics.calibration.workloadDelayWeightLabel' })}
                  </Label>
                  <Input
                    id="cal-workload-delay"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.workloadDelayWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('workloadDelayWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-workload-impediments">
                    {intl.formatMessage({
                      id: 'analytics.calibration.workloadImpedimentsWeightLabel',
                    })}
                  </Label>
                  <Input
                    id="cal-workload-impediments"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.workloadImpedimentsWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('workloadImpedimentsWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-workload-state">
                    {intl.formatMessage({
                      id: 'analytics.calibration.workloadOperationalStateWeightLabel',
                    })}
                  </Label>
                  <Input
                    id="cal-workload-state"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.workloadOperationalStateWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('workloadOperationalStateWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-workload-paused">
                    {intl.formatMessage({ id: 'analytics.calibration.workloadPausedFactorLabel' })}
                  </Label>
                  <Input
                    id="cal-workload-paused"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.workloadPausedFactor}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('workloadPausedFactor', event.target.value)
                    }
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <legend className="px-1 text-base font-semibold text-foreground">
                  {intl.formatMessage({ id: 'analytics.calibration.focusSectionTitle' })}
                </legend>
                <Badge variant={sums.isFocusSumValid ? 'secondary' : 'destructive'}>
                  {intl.formatMessage(
                    { id: 'analytics.calibration.sumLabel' },
                    { percent: intl.formatNumber(focusPercent, { maximumFractionDigits: 1 }) },
                  )}
                </Badge>
              </div>

              {!sums.isFocusSumValid ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {intl.formatMessage({ id: 'analytics.calibration.sumMismatchError' })}
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cal-focus-priority">
                    {intl.formatMessage({ id: 'analytics.calibration.focusPriorityWeightLabel' })}
                  </Label>
                  <Input
                    id="cal-focus-priority"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.focusPriorityWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('focusPriorityWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-focus-deadline">
                    {intl.formatMessage({ id: 'analytics.calibration.focusDeadlineWeightLabel' })}
                  </Label>
                  <Input
                    id="cal-focus-deadline"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.focusDeadlineWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('focusDeadlineWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-focus-dependencies">
                    {intl.formatMessage({
                      id: 'analytics.calibration.focusDependenciesWeightLabel',
                    })}
                  </Label>
                  <Input
                    id="cal-focus-dependencies"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.focusDependenciesWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('focusDependenciesWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-focus-inactivity">
                    {intl.formatMessage({ id: 'analytics.calibration.focusInactivityWeightLabel' })}
                  </Label>
                  <Input
                    id="cal-focus-inactivity"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.focusInactivityWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('focusInactivityWeight', event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cal-focus-workload">
                    {intl.formatMessage({
                      id: 'analytics.calibration.focusWorkloadCompatibilityWeightLabel',
                    })}
                  </Label>
                  <Input
                    id="cal-focus-workload"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={draft.focusWorkloadCompatibilityWeight}
                    disabled={isBusy}
                    onChange={(event) =>
                      updateNumericField('focusWorkloadCompatibilityWeight', event.target.value)
                    }
                  />
                </div>
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cal-inactivity-days">
                  {intl.formatMessage({ id: 'analytics.calibration.inactivityThresholdLabel' })}
                </Label>
                <Input
                  id="cal-inactivity-days"
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  value={draft.defaultProjectInactivityThresholdDays}
                  disabled={isBusy}
                  onChange={(event) =>
                    updateNumericField('defaultProjectInactivityThresholdDays', event.target.value)
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cal-justification">
                  {intl.formatMessage({ id: 'analytics.calibration.justificationLabel' })}
                </Label>
                <textarea
                  id="cal-justification"
                  rows={2}
                  maxLength={500}
                  value={draft.justification ?? ''}
                  disabled={isBusy}
                  placeholder={intl.formatMessage({
                    id: 'analytics.calibration.justificationPlaceholder',
                  })}
                  onChange={(event) => {
                    setValidationError(null);
                    setDraft((prev) => ({ ...prev, justification: event.target.value }));
                  }}
                  className={CONTROL_TEXTAREA_CLASS_NAME}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={isBusy || !sums.isWorkloadSumValid || !sums.isFocusSumValid}
                className="min-h-[44px] gap-2"
              >
                <IconDeviceFloppy className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'analytics.calibration.saveAction' })}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
