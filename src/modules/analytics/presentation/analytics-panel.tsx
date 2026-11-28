import {
  IconAlertTriangle,
  IconArrowLeft,
  IconChartBar,
  IconFileAnalytics,
  IconLayoutKanban,
  IconListCheck,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import type { DateRange, ProjectId } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from '@/shared/ui';
import {
  ANALYTICS_TABS,
  ANALYTICS_WIDGET_CATALOG,
  ANALYTICS_WIDGET_KEYS,
  isAnalyticsWidgetKey,
  type AnalyticsCalibrationSettingsView,
  type AnalyticsDashboardDraftState,
  type AnalyticsOverview,
  type AnalyticsPanelFeedback,
  type AnalyticsProjectOption,
  type AnalyticsTabKey,
  type DashboardPreferenceResult,
  type UpdateCalibrationSettingsInput,
} from '../application/contracts';
import { AnalyticsCalibrationSection } from './analytics-calibration-section';
import { FlowCycleComparisonChart, TaskStatusBreakdownChart } from './analytics-charts';
import { AnalyticsDashboardCustomizer } from './analytics-dashboard-customizer';
import {
  BottlenecksAnalyticsSection,
  FeedbackAnalyticsSection,
  FlowAnalyticsSection,
  FlowKpiCardsGrid,
  ImpedimentsAnalyticsSection,
  MyWorkloadWidgetSection,
  TeamWorkloadWidgetSection,
} from './analytics-sections';
import {
  ANALYTICS_PERIOD_PRESET_OPTIONS,
  ANALYTICS_PRESET_LABEL_IDS,
  ANALYTICS_SCOPE_LABEL_IDS,
  ANALYTICS_SCOPE_OPTIONS,
  CONTROL_SELECT_CLASS_NAME,
  type AnalyticsPeriodPreset,
  type DashboardScope,
  type DashboardWidgetConfig,
  areWidgetConfigsEqual,
  buildDefaultCustomDateInputs,
  buildIsoDateInputValue,
  formatAnalyticsDate,
  formatAnalyticsDateTime,
  moveWidgetInDraft,
  parseCustomDateRangeFromInputs,
  toggleWidgetVisibilityInDraft,
} from './analytics-ui-helpers';

const TAB_LABEL_IDS: Readonly<Record<AnalyticsTabKey, MessageId>> = {
  OVERVIEW: 'analytics.tabs.overview',
  FLOW: 'analytics.tabs.flow',
  FEEDBACK: 'analytics.tabs.feedback',
  WORKLOAD_BOTTLENECKS: 'analytics.tabs.workloadBottlenecks',
  CALIBRATION: 'analytics.tabs.calibration',
};

export interface AnalyticsPanelProps {
  readonly organizationName: string;
  readonly isDemoOrganization: boolean;
  readonly isProjectRoute: boolean;
  readonly allowedScopes: readonly DashboardScope[];
  readonly activeScope: DashboardScope;
  readonly accessibleProjects: readonly AnalyticsProjectOption[];
  readonly selectedProjectId: ProjectId | null;
  readonly preset: AnalyticsPeriodPreset;
  readonly customRange?: DateRange;
  readonly compareWithPreviousPeriod: boolean;
  readonly overview: AnalyticsOverview | null;
  readonly preferenceResult: DashboardPreferenceResult | null;
  readonly calibrationSettings: AnalyticsCalibrationSettingsView | null;
  readonly canManageCalibration: boolean;
  readonly canViewReports: boolean;
  readonly canOpenBoard: boolean;
  readonly isBusy: boolean;
  readonly feedback?: AnalyticsPanelFeedback | null;
  readonly announcement?: string;
  readonly focusHeadingTrigger?: string;
  readonly onChangeScope: (scope: DashboardScope) => void;
  readonly onSelectProject: (projectId: string) => void;
  readonly onChangePreset: (preset: AnalyticsPeriodPreset, customRange?: DateRange) => void;
  readonly onChangeCompare: (compare: boolean) => void;
  readonly onSaveDashboardPreference: (widgets: readonly DashboardWidgetConfig[]) => Promise<void>;
  readonly onResetDashboardPreference: () => Promise<void>;
  readonly onSaveCalibrationSettings: (input: UpdateCalibrationSettingsInput) => Promise<void>;
}

export function AnalyticsPanel({
  organizationName,
  isDemoOrganization,
  isProjectRoute,
  allowedScopes,
  activeScope,
  accessibleProjects,
  selectedProjectId,
  preset,
  customRange,
  compareWithPreviousPeriod,
  overview,
  preferenceResult,
  calibrationSettings,
  canManageCalibration,
  canViewReports,
  canOpenBoard,
  isBusy,
  feedback = null,
  announcement = '',
  focusHeadingTrigger,
  onChangeScope,
  onSelectProject,
  onChangePreset,
  onChangeCompare,
  onSaveDashboardPreference,
  onResetDashboardPreference,
  onSaveCalibrationSettings,
}: AnalyticsPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [activeTab, setActiveTab] = useState<AnalyticsTabKey>(ANALYTICS_TABS.OVERVIEW);
  const [isEditingDashboard, setIsEditingDashboard] = useState<boolean>(false);
  const [isSavingDashboard, setIsSavingDashboard] = useState<boolean>(false);
  const [draftWidgets, setDraftWidgets] = useState<readonly DashboardWidgetConfig[]>([]);
  const [customStartInput, setCustomStartInput] = useState<string>(() =>
    customRange !== undefined
      ? buildIsoDateInputValue(customRange.start)
      : buildDefaultCustomDateInputs().start,
  );
  const [customEndInput, setCustomEndInput] = useState<string>(() =>
    customRange !== undefined
      ? buildIsoDateInputValue(customRange.end)
      : buildDefaultCustomDateInputs().end,
  );
  const [customRangeError, setCustomRangeError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<AnalyticsPanelFeedback | null>(null);

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  const savedWidgets = preferenceResult?.preference.widgets ?? [];
  const effectiveDraftWidgets = isEditingDashboard ? draftWidgets : savedWidgets;
  const isDirtyDashboard =
    isEditingDashboard && !areWidgetConfigsEqual(effectiveDraftWidgets, savedWidgets);

  const draftState: AnalyticsDashboardDraftState = {
    widgets: effectiveDraftWidgets,
    isEditing: isEditingDashboard,
    isDirty: isDirtyDashboard,
    isDefault: preferenceResult?.isDefault ?? true,
    isSaving: isSavingDashboard,
  };

  const selectedProject =
    selectedProjectId !== null
      ? (accessibleProjects.find((item) => item.id === selectedProjectId) ?? null)
      : null;

  const pageHeadingText =
    isProjectRoute && selectedProject !== null
      ? intl.formatMessage({ id: 'analytics.projectPage.title' }, { name: selectedProject.name })
      : intl.formatMessage({ id: 'analytics.title' });

  const pageSubtitleText = isProjectRoute
    ? intl.formatMessage({ id: 'analytics.projectPage.subtitle' })
    : intl.formatMessage({ id: 'analytics.subtitle' });

  const availableTabs: readonly AnalyticsTabKey[] = canManageCalibration
    ? [
        ANALYTICS_TABS.OVERVIEW,
        ANALYTICS_TABS.FLOW,
        ANALYTICS_TABS.FEEDBACK,
        ANALYTICS_TABS.WORKLOAD_BOTTLENECKS,
        ANALYTICS_TABS.CALIBRATION,
      ]
    : [
        ANALYTICS_TABS.OVERVIEW,
        ANALYTICS_TABS.FLOW,
        ANALYTICS_TABS.FEEDBACK,
        ANALYTICS_TABS.WORKLOAD_BOTTLENECKS,
      ];

  const resolvedTab = availableTabs.includes(activeTab) ? activeTab : ANALYTICS_TABS.OVERVIEW;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % availableTabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = availableTabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    const nextTab = availableTabs[nextIndex];
    if (nextTab === undefined) {
      return;
    }
    event.preventDefault();
    setActiveTab(nextTab);
    document.getElementById(`analytics-tab-${nextTab}`)?.focus();
  };

  const handleStartEditing = () => {
    setLocalNotice(null);
    setDraftWidgets(savedWidgets.map((widget) => ({ ...widget })));
    setIsEditingDashboard(true);
  };

  const handleToggleWidget = (widgetKey: string) => {
    setDraftWidgets((prev) => toggleWidgetVisibilityInDraft(prev, widgetKey));
  };

  const handleMoveWidget = (index: number, direction: 'up' | 'down') => {
    setDraftWidgets((prev) => moveWidgetInDraft(prev, index, direction));
  };

  const handleDiscardDashboard = () => {
    setIsEditingDashboard(false);
    setDraftWidgets(savedWidgets);
    setLocalNotice({
      type: 'success',
      message: intl.formatMessage({ id: 'analytics.dashboard.discardedNotice' }),
    });
  };

  const handleSaveDashboard = async () => {
    setLocalNotice(null);
    setIsSavingDashboard(true);
    try {
      await onSaveDashboardPreference(effectiveDraftWidgets);
      setIsEditingDashboard(false);
    } finally {
      setIsSavingDashboard(false);
    }
  };

  const handleRestoreDefault = async () => {
    setLocalNotice(null);
    setIsSavingDashboard(true);
    try {
      await onResetDashboardPreference();
      setIsEditingDashboard(false);
    } finally {
      setIsSavingDashboard(false);
    }
  };

  const handlePresetSelection = (nextPreset: AnalyticsPeriodPreset) => {
    setCustomRangeError(null);
    if (nextPreset === 'CUSTOM') {
      const parsed = parseCustomDateRangeFromInputs(customStartInput, customEndInput);
      if (parsed === null) {
        const defaults = buildDefaultCustomDateInputs();
        setCustomStartInput(defaults.start);
        setCustomEndInput(defaults.end);
        const fallbackRange = parseCustomDateRangeFromInputs(defaults.start, defaults.end);
        if (fallbackRange !== null) {
          onChangePreset('CUSTOM', fallbackRange);
        }
        return;
      }
      onChangePreset('CUSTOM', parsed);
      return;
    }
    onChangePreset(nextPreset);
  };

  const handleApplyCustomRange = () => {
    const parsed = parseCustomDateRangeFromInputs(customStartInput, customEndInput);
    if (parsed === null) {
      setCustomRangeError(intl.formatMessage({ id: 'analytics.period.invalidRangeError' }));
      return;
    }
    setCustomRangeError(null);
    onChangePreset('CUSTOM', parsed);
  };

  const renderOverviewWidget = (widget: DashboardWidgetConfig): ReactNode => {
    if (overview === null) {
      return null;
    }
    if (
      isAnalyticsWidgetKey(widget.widgetKey) &&
      !ANALYTICS_WIDGET_CATALOG[widget.widgetKey].allowedScopes.includes(overview.scope)
    ) {
      return null;
    }

    switch (widget.widgetKey) {
      case ANALYTICS_WIDGET_KEYS.FLOW_KPIS:
        return (
          <section
            key={widget.widgetKey}
            aria-labelledby="widget-flow-kpis-heading"
            className="space-y-4"
          >
            <h2 id="widget-flow-kpis-heading" className="text-xl font-semibold text-foreground">
              {intl.formatMessage({ id: 'analytics.flow.title' })}
            </h2>
            <FlowKpiCardsGrid
              overview={overview}
              compareWithPreviousPeriod={compareWithPreviousPeriod}
            />
            <FlowCycleComparisonChart flow={overview.flow} />
          </section>
        );
      case ANALYTICS_WIDGET_KEYS.TASK_STATUS_BREAKDOWN:
        return (
          <section
            key={widget.widgetKey}
            aria-labelledby="widget-task-status-heading"
            className="space-y-4"
          >
            <h2 id="widget-task-status-heading" className="text-xl font-semibold text-foreground">
              {intl.formatMessage({ id: 'analytics.flow.statusBreakdown.title' })}
            </h2>
            <TaskStatusBreakdownChart flow={overview.flow} />
          </section>
        );
      case ANALYTICS_WIDGET_KEYS.MY_WORKLOAD:
        return <MyWorkloadWidgetSection key={widget.widgetKey} overview={overview} />;
      case ANALYTICS_WIDGET_KEYS.TEAM_WORKLOAD:
        return <TeamWorkloadWidgetSection key={widget.widgetKey} overview={overview} />;
      case ANALYTICS_WIDGET_KEYS.IMPEDIMENTS_SUMMARY:
        return <ImpedimentsAnalyticsSection key={widget.widgetKey} overview={overview} />;
      case ANALYTICS_WIDGET_KEYS.BOTTLENECKS_ALERTS:
        return <BottlenecksAnalyticsSection key={widget.widgetKey} overview={overview} />;
      case ANALYTICS_WIDGET_KEYS.FEEDBACK_SUMMARY:
        return <FeedbackAnalyticsSection key={widget.widgetKey} overview={overview} />;
      default:
        return null;
    }
  };

  const visibleWidgets = [...effectiveDraftWidgets]
    .sort((a, b) => a.order - b.order)
    .filter((widget) => widget.visible);

  const displayedFeedback = feedback ?? localNotice;

  return (
    <section aria-labelledby="analytics-heading" className="mx-auto w-full max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'analytics.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconChartBar className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1
            ref={headingRef}
            id="analytics-heading"
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight text-foreground focus:outline-none sm:text-4xl"
          >
            {pageHeadingText}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
          {isDemoOrganization ? (
            <Badge variant="demo">{intl.formatMessage({ id: 'demoBanner.badge' })}</Badge>
          ) : null}
        </div>
        <p className="text-base text-muted-foreground">{pageSubtitleText}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to="/projects">
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'analytics.backToProjects' })}</span>
            </Link>
          </Button>

          {selectedProject !== null && canOpenBoard ? (
            <>
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${selectedProject.id}/board`}>
                  <IconLayoutKanban className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'analytics.openBoardAction' })}</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${selectedProject.id}/tasks`}>
                  <IconListCheck className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'analytics.openTasksAction' })}</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-[44px]">
                <Link to={`/projects/${selectedProject.id}/bottlenecks`}>
                  <IconAlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'analytics.openBottlenecksAction' })}</span>
                </Link>
              </Button>
            </>
          ) : null}

          {canViewReports ? (
            <Button asChild variant="outline" className="min-h-[44px]">
              <Link to="/reports">
                <IconFileAnalytics className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'analytics.openReportsAction' })}</span>
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {isDemoOrganization ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'analytics.demoIsolationNotice' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {displayedFeedback !== null ? (
        <Alert
          variant={displayedFeedback.type === 'destructive' ? 'destructive' : 'success'}
          role={displayedFeedback.type === 'destructive' ? 'alert' : 'status'}
        >
          <AlertDescription>{displayedFeedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'analytics.scope.label' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isProjectRoute ? (
            <div
              role="group"
              aria-label={intl.formatMessage({ id: 'analytics.scope.label' })}
              className="flex flex-wrap gap-2"
            >
              {ANALYTICS_SCOPE_OPTIONS.map((scopeOption) => {
                const isAllowed = allowedScopes.includes(scopeOption);
                const isSelected = activeScope === scopeOption;
                return (
                  <Button
                    key={scopeOption}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    aria-pressed={isSelected}
                    disabled={!isAllowed || isBusy}
                    onClick={() => onChangeScope(scopeOption)}
                    className="min-h-[44px]"
                  >
                    {intl.formatMessage({ id: ANALYTICS_SCOPE_LABEL_IDS[scopeOption] })}
                  </Button>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeScope === 'PROJECT' ? (
              <div className="space-y-1.5">
                <Label htmlFor="analytics-project-select">
                  {intl.formatMessage({ id: 'analytics.projectSelector.label' })}
                </Label>
                {accessibleProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'analytics.projectSelector.empty' })}
                  </p>
                ) : (
                  <select
                    id="analytics-project-select"
                    value={selectedProjectId ?? ''}
                    disabled={isBusy || isProjectRoute}
                    onChange={(event) => onSelectProject(event.target.value)}
                    className={CONTROL_SELECT_CLASS_NAME}
                  >
                    <option value="">
                      {intl.formatMessage({ id: 'analytics.projectSelector.placeholder' })}
                    </option>
                    {accessibleProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="analytics-period-preset">
                {intl.formatMessage({ id: 'analytics.period.presetLabel' })}
              </Label>
              <select
                id="analytics-period-preset"
                value={preset}
                disabled={isBusy}
                onChange={(event) =>
                  handlePresetSelection(event.target.value as AnalyticsPeriodPreset)
                }
                className={CONTROL_SELECT_CLASS_NAME}
              >
                {ANALYTICS_PERIOD_PRESET_OPTIONS.map((presetOption) => (
                  <option key={presetOption} value={presetOption}>
                    {intl.formatMessage({ id: ANALYTICS_PRESET_LABEL_IDS[presetOption] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label
                htmlFor="analytics-compare-toggle"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground"
              >
                <input
                  id="analytics-compare-toggle"
                  type="checkbox"
                  checked={compareWithPreviousPeriod}
                  disabled={isBusy}
                  onChange={(event) => onChangeCompare(event.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <span>{intl.formatMessage({ id: 'analytics.period.compareLabel' })}</span>
              </label>
            </div>
          </div>

          {preset === 'CUSTOM' ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="analytics-custom-start">
                    {intl.formatMessage({ id: 'analytics.period.customStartLabel' })}
                  </Label>
                  <Input
                    id="analytics-custom-start"
                    type="date"
                    value={customStartInput}
                    disabled={isBusy}
                    onChange={(event) => {
                      setCustomRangeError(null);
                      setCustomStartInput(event.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="analytics-custom-end">
                    {intl.formatMessage({ id: 'analytics.period.customEndLabel' })}
                  </Label>
                  <Input
                    id="analytics-custom-end"
                    type="date"
                    value={customEndInput}
                    disabled={isBusy}
                    onChange={(event) => {
                      setCustomRangeError(null);
                      setCustomEndInput(event.target.value);
                    }}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    onClick={handleApplyCustomRange}
                    disabled={isBusy}
                    className="min-h-[44px] w-full sm:w-auto"
                  >
                    {intl.formatMessage({ id: 'analytics.period.applyAction' })}
                  </Button>
                </div>
              </div>
              {customRangeError !== null ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{customRangeError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          {overview !== null ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <span>
                {intl.formatMessage(
                  { id: 'analytics.period.activeRangeLabel' },
                  {
                    start: formatAnalyticsDate(overview.period.start, intl),
                    end: formatAnalyticsDate(overview.period.end, intl),
                  },
                )}
              </span>
              {overview.previousPeriod !== undefined ? (
                <span>
                  {intl.formatMessage(
                    { id: 'analytics.period.previousRangeLabel' },
                    {
                      start: formatAnalyticsDate(overview.previousPeriod.start, intl),
                      end: formatAnalyticsDate(overview.previousPeriod.end, intl),
                    },
                  )}
                </span>
              ) : null}
              <span>
                {intl.formatMessage(
                  { id: 'analytics.period.generatedAtLabel' },
                  { date: formatAnalyticsDateTime(overview.generatedAt, intl) },
                )}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div
        role="tablist"
        aria-label={intl.formatMessage({ id: 'analytics.tabs.label' })}
        className="flex flex-wrap gap-2 border-b border-border pb-2"
      >
        {availableTabs.map((tabKey, index) => {
          const isSelected = resolvedTab === tabKey;
          return (
            <button
              key={tabKey}
              type="button"
              role="tab"
              id={`analytics-tab-${tabKey}`}
              aria-selected={isSelected}
              aria-controls={`analytics-tabpanel-${tabKey}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tabKey)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={cn(
                'inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {intl.formatMessage({ id: TAB_LABEL_IDS[tabKey] })}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`analytics-tabpanel-${resolvedTab}`}
        aria-labelledby={`analytics-tab-${resolvedTab}`}
        className="space-y-6"
      >
        {resolvedTab === ANALYTICS_TABS.CALIBRATION &&
        canManageCalibration &&
        calibrationSettings !== null ? (
          <AnalyticsCalibrationSection
            key={calibrationSettings.updatedAt}
            settings={calibrationSettings}
            isBusy={isBusy}
            onSaveCalibration={onSaveCalibrationSettings}
          />
        ) : null}

        {resolvedTab !== ANALYTICS_TABS.CALIBRATION && overview === null ? (
          <Alert variant="warning">
            <AlertDescription>
              {activeScope === 'PROJECT' && selectedProjectId === null
                ? intl.formatMessage({ id: 'analytics.projectSelector.placeholder' })
                : intl.formatMessage({ id: 'analytics.noPermission' })}
            </AlertDescription>
          </Alert>
        ) : null}

        {resolvedTab === ANALYTICS_TABS.OVERVIEW && overview !== null ? (
          <div className="space-y-6">
            <AnalyticsDashboardCustomizer
              draftState={draftState}
              isBusy={isBusy}
              isDemoIsolated={
                preferenceResult?.preference.isDemoIsolated ?? overview.isDemoOrganization
              }
              onStartEditing={handleStartEditing}
              onToggleWidgetVisibility={handleToggleWidget}
              onMoveWidget={handleMoveWidget}
              onSave={handleSaveDashboard}
              onDiscard={handleDiscardDashboard}
              onRestoreDefault={handleRestoreDefault}
            />

            {visibleWidgets.length === 0 ? (
              <Alert variant="warning">
                <AlertDescription>
                  {intl.formatMessage({ id: 'analytics.dashboard.allHiddenNotice' })}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-6">
                {visibleWidgets.map((widget) => renderOverviewWidget(widget))}
              </div>
            )}
          </div>
        ) : null}

        {resolvedTab === ANALYTICS_TABS.FLOW && overview !== null ? (
          <FlowAnalyticsSection
            overview={overview}
            compareWithPreviousPeriod={compareWithPreviousPeriod}
          />
        ) : null}

        {resolvedTab === ANALYTICS_TABS.FEEDBACK && overview !== null ? (
          <FeedbackAnalyticsSection overview={overview} />
        ) : null}

        {resolvedTab === ANALYTICS_TABS.WORKLOAD_BOTTLENECKS && overview !== null ? (
          <div className="space-y-6">
            <MyWorkloadWidgetSection overview={overview} />
            <TeamWorkloadWidgetSection overview={overview} />
            <ImpedimentsAnalyticsSection overview={overview} />
            <BottlenecksAnalyticsSection overview={overview} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
