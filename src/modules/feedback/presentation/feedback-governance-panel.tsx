import { IconArrowLeft, IconClockCheck, IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import { PRIORITIES, isIsoDate, type IsoDate, type Priority } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui';
import type {
  CreateCatalogItemInput,
  FeedbackCategoryId,
  FeedbackCategoryWithVersion,
  FeedbackContestReasonId,
  FeedbackContestReasonWithVersion,
  FeedbackSlaSettingsView,
  SlaBreakIntervalUtc,
  SlaCalendarMode,
  UpdateCatalogItemInput,
  UpdateFeedbackSlaSettingsInput,
} from '../application/contracts';
import { FeedbackCatalogSection, type CatalogItemRow } from './feedback-catalog-section';
import {
  CONTROL_SELECT_CLASS_NAME,
  FEEDBACK_PRIORITY_LABEL_IDS,
  type FeedbackPanelFeedback,
} from './feedback-ui-helpers';

const MS_PER_HOUR = 60 * 60 * 1000;

const WORK_DAY_LABEL_IDS: readonly MessageId[] = [
  'feedbacks.governance.sla.workDay0',
  'feedbacks.governance.sla.workDay1',
  'feedbacks.governance.sla.workDay2',
  'feedbacks.governance.sla.workDay3',
  'feedbacks.governance.sla.workDay4',
  'feedbacks.governance.sla.workDay5',
  'feedbacks.governance.sla.workDay6',
];

export interface FeedbackGovernancePanelProps {
  readonly organizationName: string;
  readonly categories: readonly FeedbackCategoryWithVersion[];
  readonly contestReasons: readonly FeedbackContestReasonWithVersion[];
  readonly slaSettings: FeedbackSlaSettingsView;
  readonly isBusy: boolean;
  readonly feedback?: FeedbackPanelFeedback | null;
  readonly announcement?: string;
  readonly focusHeadingTrigger?: string;
  readonly onCreateCategory: (input: CreateCatalogItemInput) => Promise<void>;
  readonly onUpdateCategory: (
    categoryId: FeedbackCategoryId,
    input: UpdateCatalogItemInput,
  ) => Promise<void>;
  readonly onReorderCategories: (orderedIds: readonly FeedbackCategoryId[]) => Promise<void>;
  readonly onDeleteCategory: (categoryId: FeedbackCategoryId) => Promise<void>;
  readonly onCreateContestReason: (input: CreateCatalogItemInput) => Promise<void>;
  readonly onUpdateContestReason: (
    reasonId: FeedbackContestReasonId,
    input: UpdateCatalogItemInput,
  ) => Promise<void>;
  readonly onReorderContestReasons: (
    orderedIds: readonly FeedbackContestReasonId[],
  ) => Promise<void>;
  readonly onDeleteContestReason: (reasonId: FeedbackContestReasonId) => Promise<void>;
  readonly onSaveSlaSettings: (input: UpdateFeedbackSlaSettingsInput) => Promise<void>;
  readonly onEvaluateSlas: () => Promise<void>;
}

function toHours(ms: number): string {
  return String(Math.max(1, Math.round(ms / MS_PER_HOUR)));
}

export function FeedbackGovernancePanel({
  organizationName,
  categories,
  contestReasons,
  slaSettings,
  isBusy,
  feedback = null,
  announcement = '',
  focusHeadingTrigger,
  onCreateCategory,
  onUpdateCategory,
  onReorderCategories,
  onDeleteCategory,
  onCreateContestReason,
  onUpdateContestReason,
  onReorderContestReasons,
  onDeleteContestReason,
  onSaveSlaSettings,
  onEvaluateSlas,
}: FeedbackGovernancePanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  const categoryRows: readonly CatalogItemRow[] = categories.map((item) => ({
    id: item.category.id,
    code: item.category.code,
    active: item.category.active,
    sortOrder: item.category.sortOrder,
    hasBeenUsed: item.category.hasBeenUsed,
    deletedAt: item.category.deletedAt,
    currentVersion: item.currentVersion,
    versions: item.versions,
  }));

  const reasonRows: readonly CatalogItemRow[] = contestReasons.map((item) => ({
    id: item.reason.id,
    code: item.reason.code,
    active: item.reason.active,
    sortOrder: item.reason.sortOrder,
    hasBeenUsed: item.reason.hasBeenUsed,
    deletedAt: item.reason.deletedAt,
    currentVersion: item.currentVersion,
    versions: item.versions,
  }));

  return (
    <section aria-labelledby="feedback-governance-heading" className="mx-auto max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'feedbacks.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/feedback">
            <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'feedbacks.nav.backToQueue' })}</span>
          </Link>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => void onEvaluateSlas()}
          disabled={isBusy}
          className="min-h-[44px] gap-2"
        >
          <IconClockCheck className="h-4 w-4" aria-hidden="true" />
          <span>{intl.formatMessage({ id: 'feedbacks.slaEvaluation.action' })}</span>
        </Button>
      </div>

      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{organizationName}</p>
        <h1
          ref={headingRef}
          id="feedback-governance-heading"
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-foreground focus:outline-none"
        >
          {intl.formatMessage({ id: 'feedbacks.governance.title' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({ id: 'feedbacks.governance.subtitle' })}
        </p>
      </header>

      <Alert role="status">
        <AlertDescription>
          {intl.formatMessage({ id: 'feedbacks.governance.adminOnlyNotice' })}
        </AlertDescription>
      </Alert>

      {feedback !== null ? (
        <Alert
          variant={feedback.type === 'destructive' ? 'destructive' : 'success'}
          role={feedback.type === 'destructive' ? 'alert' : 'status'}
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <FeedbackCatalogSection
        kind="category"
        items={categoryRows}
        isBusy={isBusy}
        onCreate={onCreateCategory}
        onUpdate={(id, input) => onUpdateCategory(id as FeedbackCategoryId, input)}
        onReorder={(orderedIds) => onReorderCategories(orderedIds as FeedbackCategoryId[])}
        onDelete={(id) => onDeleteCategory(id as FeedbackCategoryId)}
      />

      <FeedbackCatalogSection
        kind="reason"
        items={reasonRows}
        isBusy={isBusy}
        onCreate={onCreateContestReason}
        onUpdate={(id, input) => onUpdateContestReason(id as FeedbackContestReasonId, input)}
        onReorder={(orderedIds) => onReorderContestReasons(orderedIds as FeedbackContestReasonId[])}
        onDelete={(id) => onDeleteContestReason(id as FeedbackContestReasonId)}
      />

      <FeedbackSlaSettingsForm
        key={`${slaSettings.organizationId}:${slaSettings.updatedAt}`}
        slaSettings={slaSettings}
        isBusy={isBusy}
        onSaveSlaSettings={onSaveSlaSettings}
      />
    </section>
  );
}

interface FeedbackSlaSettingsFormProps {
  readonly slaSettings: FeedbackSlaSettingsView;
  readonly isBusy: boolean;
  readonly onSaveSlaSettings: (input: UpdateFeedbackSlaSettingsInput) => Promise<void>;
}

function FeedbackSlaSettingsForm({
  slaSettings,
  isBusy,
  onSaveSlaSettings,
}: FeedbackSlaSettingsFormProps) {
  const intl = useIntl();
  const calendarModeId = useId();
  const workStartId = useId();
  const workEndId = useId();
  const holidayInputId = useId();
  const manifestationWindowId = useId();
  const contestWindowId = useId();

  const [mode, setMode] = useState<SlaCalendarMode>(slaSettings.calendar.mode);
  const [workDays, setWorkDays] = useState<readonly number[]>(
    slaSettings.calendar.workDaysOfWeekUtc,
  );
  const [workStartHour, setWorkStartHour] = useState<string>(
    String(slaSettings.calendar.workStartHourUtc),
  );
  const [workEndHour, setWorkEndHour] = useState<string>(
    String(slaSettings.calendar.workEndHourUtc),
  );
  const [breaks, setBreaks] = useState<readonly SlaBreakIntervalUtc[]>(
    slaSettings.calendar.breakIntervalsUtc,
  );
  const [holidays, setHolidays] = useState<readonly IsoDate[]>(slaSettings.calendar.holidayDates);
  const [newHolidayDate, setNewHolidayDate] = useState<string>('');
  const [policyHours, setPolicyHours] = useState<
    Record<Priority, { firstResponse: string; resolution: string }>
  >({
    CRITICAL: {
      firstResponse: toHours(slaSettings.slaPoliciesByPriority.CRITICAL.firstResponseTargetMs),
      resolution: toHours(slaSettings.slaPoliciesByPriority.CRITICAL.resolutionTargetMs),
    },
    HIGH: {
      firstResponse: toHours(slaSettings.slaPoliciesByPriority.HIGH.firstResponseTargetMs),
      resolution: toHours(slaSettings.slaPoliciesByPriority.HIGH.resolutionTargetMs),
    },
    MEDIUM: {
      firstResponse: toHours(slaSettings.slaPoliciesByPriority.MEDIUM.firstResponseTargetMs),
      resolution: toHours(slaSettings.slaPoliciesByPriority.MEDIUM.resolutionTargetMs),
    },
    LOW: {
      firstResponse: toHours(slaSettings.slaPoliciesByPriority.LOW.firstResponseTargetMs),
      resolution: toHours(slaSettings.slaPoliciesByPriority.LOW.resolutionTargetMs),
    },
  });
  const [manifestationHours, setManifestationHours] = useState<string>(
    toHours(slaSettings.feedbackManifestationWindowMs),
  );
  const [contestHours, setContestHours] = useState<string>(
    toHours(slaSettings.feedbackContestWindowMs),
  );
  const [slaFormError, setSlaFormError] = useState<string | null>(null);

  const toggleWorkDay = (day: number) => {
    setWorkDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  };

  const handleAddBreak = () => {
    setBreaks((current) => [...current, { startHour: 12, endHour: 13 }]);
  };

  const handleAddHoliday = () => {
    const trimmed = newHolidayDate.trim();
    if (!isIsoDate(trimmed)) {
      setSlaFormError(intl.formatMessage({ id: 'validation.dateInvalid' }));
      return;
    }
    setSlaFormError(null);
    if (!holidays.includes(trimmed)) {
      setHolidays((current) => [...current, trimmed].sort());
    }
    setNewHolidayDate('');
  };

  const handleSaveSla = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startHour = Number.parseInt(workStartHour, 10);
    const endHour = Number.parseInt(workEndHour, 10);
    const manifestationMs = Number.parseInt(manifestationHours, 10) * MS_PER_HOUR;
    const contestMs = Number.parseInt(contestHours, 10) * MS_PER_HOUR;

    if (
      !Number.isInteger(startHour) ||
      !Number.isInteger(endHour) ||
      startHour < 0 ||
      endHour > 24 ||
      endHour <= startHour ||
      (mode === 'BUSINESS_HOURS' && workDays.length === 0) ||
      !Number.isFinite(manifestationMs) ||
      manifestationMs <= 0 ||
      !Number.isFinite(contestMs) ||
      contestMs <= 0
    ) {
      setSlaFormError(intl.formatMessage({ id: 'errors.VALIDATION_ERROR' }));
      return;
    }

    for (const brk of breaks) {
      if (brk.startHour < startHour || brk.endHour > endHour || brk.endHour <= brk.startHour) {
        setSlaFormError(intl.formatMessage({ id: 'errors.VALIDATION_ERROR' }));
        return;
      }
    }

    setSlaFormError(null);
    await onSaveSlaSettings({
      calendar: {
        mode,
        workDaysOfWeekUtc: workDays,
        workStartHourUtc: startHour,
        workEndHourUtc: endHour,
        breakIntervalsUtc: breaks,
        holidayDates: holidays,
      },
      slaPoliciesByPriority: {
        CRITICAL: {
          firstResponseTargetMs:
            Math.max(1, Number.parseInt(policyHours.CRITICAL.firstResponse, 10) || 1) * MS_PER_HOUR,
          resolutionTargetMs:
            Math.max(1, Number.parseInt(policyHours.CRITICAL.resolution, 10) || 1) * MS_PER_HOUR,
        },
        HIGH: {
          firstResponseTargetMs:
            Math.max(1, Number.parseInt(policyHours.HIGH.firstResponse, 10) || 1) * MS_PER_HOUR,
          resolutionTargetMs:
            Math.max(1, Number.parseInt(policyHours.HIGH.resolution, 10) || 1) * MS_PER_HOUR,
        },
        MEDIUM: {
          firstResponseTargetMs:
            Math.max(1, Number.parseInt(policyHours.MEDIUM.firstResponse, 10) || 1) * MS_PER_HOUR,
          resolutionTargetMs:
            Math.max(1, Number.parseInt(policyHours.MEDIUM.resolution, 10) || 1) * MS_PER_HOUR,
        },
        LOW: {
          firstResponseTargetMs:
            Math.max(1, Number.parseInt(policyHours.LOW.firstResponse, 10) || 1) * MS_PER_HOUR,
          resolutionTargetMs:
            Math.max(1, Number.parseInt(policyHours.LOW.resolution, 10) || 1) * MS_PER_HOUR,
        },
      },
      feedbackManifestationWindowMs: manifestationMs,
      feedbackContestWindowMs: contestMs,
    });
  };

  return (
    <Card aria-labelledby="feedback-governance-sla-heading">
      <CardHeader>
        <CardTitle id="feedback-governance-sla-heading" className="text-lg">
          {intl.formatMessage({ id: 'feedbacks.governance.sla.title' })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void handleSaveSla(event)} className="space-y-6" noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={calendarModeId}>
                {intl.formatMessage({ id: 'feedbacks.governance.sla.calendarModeLabel' })}
              </Label>
              <select
                id={calendarModeId}
                value={mode}
                onChange={(event) => setMode(event.target.value as SlaCalendarMode)}
                className={CONTROL_SELECT_CLASS_NAME}
                disabled={isBusy}
              >
                <option value="BUSINESS_HOURS">
                  {intl.formatMessage({ id: 'feedbacks.sla.calendarMode.BUSINESS_HOURS' })}
                </option>
                <option value="CONTINUOUS">
                  {intl.formatMessage({ id: 'feedbacks.sla.calendarMode.CONTINUOUS' })}
                </option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={workStartId}>
                {intl.formatMessage({ id: 'feedbacks.governance.sla.workStartHourLabel' })}
              </Label>
              <Input
                id={workStartId}
                type="number"
                min={0}
                max={23}
                value={workStartHour}
                onChange={(event) => setWorkStartHour(event.target.value)}
                className="min-h-[44px]"
                disabled={isBusy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={workEndId}>
                {intl.formatMessage({ id: 'feedbacks.governance.sla.workEndHourLabel' })}
              </Label>
              <Input
                id={workEndId}
                type="number"
                min={1}
                max={24}
                value={workEndHour}
                onChange={(event) => setWorkEndHour(event.target.value)}
                className="min-h-[44px]"
                disabled={isBusy}
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">
              {intl.formatMessage({ id: 'feedbacks.governance.sla.workDaysLabel' })}
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {WORK_DAY_LABEL_IDS.map((labelId, dayIndex) => {
                const checkboxId = `work-day-${dayIndex}`;
                return (
                  <label
                    key={labelId}
                    htmlFor={checkboxId}
                    className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground"
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={workDays.includes(dayIndex)}
                      onChange={() => toggleWorkDay(dayIndex)}
                      disabled={isBusy}
                      className="h-4 w-4 rounded border-input"
                    />
                    <span>{intl.formatMessage({ id: labelId })}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {intl.formatMessage({ id: 'feedbacks.governance.sla.breaksTitle' })}
              </h3>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddBreak}
                disabled={isBusy}
                className="min-h-[44px] gap-2"
              >
                <IconPlus className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'feedbacks.governance.sla.addBreakAction' })}</span>
              </Button>
            </div>

            {breaks.map((brk, index) => (
              <div
                key={`${index}-${brk.startHour}-${brk.endHour}`}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="space-y-1">
                  <Label htmlFor={`break-start-${index}`}>
                    {intl.formatMessage({ id: 'feedbacks.governance.sla.breakStartLabel' })}
                  </Label>
                  <Input
                    id={`break-start-${index}`}
                    type="number"
                    min={0}
                    max={23}
                    value={brk.startHour}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10) || 0;
                      setBreaks((prev) =>
                        prev.map((item, idx) =>
                          idx === index ? { ...item, startHour: value } : item,
                        ),
                      );
                    }}
                    className="min-h-[44px] w-28"
                    disabled={isBusy}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`break-end-${index}`}>
                    {intl.formatMessage({ id: 'feedbacks.governance.sla.breakEndLabel' })}
                  </Label>
                  <Input
                    id={`break-end-${index}`}
                    type="number"
                    min={1}
                    max={24}
                    value={brk.endHour}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10) || 1;
                      setBreaks((prev) =>
                        prev.map((item, idx) =>
                          idx === index ? { ...item, endHour: value } : item,
                        ),
                      );
                    }}
                    className="min-h-[44px] w-28"
                    disabled={isBusy}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBreaks((prev) => prev.filter((_, idx) => idx !== index))}
                  disabled={isBusy}
                  className="min-h-[44px]"
                >
                  {intl.formatMessage({ id: 'feedbacks.governance.sla.removeBreakAction' })}
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'feedbacks.governance.sla.holidaysTitle' })}
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor={holidayInputId}>
                  {intl.formatMessage({ id: 'feedbacks.governance.sla.holidayDateLabel' })}
                </Label>
                <Input
                  id={holidayInputId}
                  type="date"
                  value={newHolidayDate}
                  onChange={(event) => setNewHolidayDate(event.target.value)}
                  className="min-h-[44px]"
                  disabled={isBusy}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddHoliday}
                disabled={isBusy}
                className="min-h-[44px] gap-2"
              >
                <IconPlus className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({ id: 'feedbacks.governance.sla.addHolidayAction' })}
                </span>
              </Button>
            </div>
            {holidays.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {holidays.map((date) => (
                  <li
                    key={date}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-1 text-sm"
                  >
                    <span>{date}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isBusy}
                      onClick={() => setHolidays((prev) => prev.filter((item) => item !== date))}
                      aria-label={`${intl.formatMessage({ id: 'feedbacks.governance.sla.removeHolidayAction' })}: ${date}`}
                      className="min-h-[44px] min-w-[44px]"
                    >
                      <IconTrash className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'feedbacks.governance.sla.policiesTitle' })}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.values(PRIORITIES).map((priority) => {
                const priorityLabel = intl.formatMessage({
                  id: FEEDBACK_PRIORITY_LABEL_IDS[priority],
                });
                return (
                  <div
                    key={priority}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
                  >
                    <div className="space-y-1">
                      <Label htmlFor={`sla-fr-${priority}`}>
                        {intl.formatMessage(
                          { id: 'feedbacks.governance.sla.firstResponseHoursLabel' },
                          { priority: priorityLabel },
                        )}
                      </Label>
                      <Input
                        id={`sla-fr-${priority}`}
                        type="number"
                        min={1}
                        value={policyHours[priority].firstResponse}
                        onChange={(event) =>
                          setPolicyHours((prev) => ({
                            ...prev,
                            [priority]: {
                              ...prev[priority],
                              firstResponse: event.target.value,
                            },
                          }))
                        }
                        className="min-h-[44px]"
                        disabled={isBusy}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`sla-res-${priority}`}>
                        {intl.formatMessage(
                          { id: 'feedbacks.governance.sla.resolutionHoursLabel' },
                          { priority: priorityLabel },
                        )}
                      </Label>
                      <Input
                        id={`sla-res-${priority}`}
                        type="number"
                        min={1}
                        value={policyHours[priority].resolution}
                        onChange={(event) =>
                          setPolicyHours((prev) => ({
                            ...prev,
                            [priority]: {
                              ...prev[priority],
                              resolution: event.target.value,
                            },
                          }))
                        }
                        className="min-h-[44px]"
                        disabled={isBusy}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'feedbacks.governance.sla.windowsTitle' })}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={manifestationWindowId}>
                  {intl.formatMessage({
                    id: 'feedbacks.governance.sla.manifestationWindowHoursLabel',
                  })}
                </Label>
                <Input
                  id={manifestationWindowId}
                  type="number"
                  min={1}
                  value={manifestationHours}
                  onChange={(event) => setManifestationHours(event.target.value)}
                  className="min-h-[44px]"
                  disabled={isBusy}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={contestWindowId}>
                  {intl.formatMessage({ id: 'feedbacks.governance.sla.contestWindowHoursLabel' })}
                </Label>
                <Input
                  id={contestWindowId}
                  type="number"
                  min={1}
                  value={contestHours}
                  onChange={(event) => setContestHours(event.target.value)}
                  className="min-h-[44px]"
                  disabled={isBusy}
                />
              </div>
            </div>
          </div>

          {slaFormError !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{slaFormError}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={isBusy} className="min-h-[44px]">
            {intl.formatMessage({ id: 'feedbacks.governance.sla.saveAction' })}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
