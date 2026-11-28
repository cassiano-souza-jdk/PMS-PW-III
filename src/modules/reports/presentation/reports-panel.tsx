import {
  IconArrowLeft,
  IconDownload,
  IconEye,
  IconFileAnalytics,
  IconShieldCheck,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
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
  cn,
} from '@/shared/ui';
import {
  REPORT_CATALOG,
  REPORT_PREVIEW_STATUSES,
  REPORT_SCOPES,
  type ExportReportInput,
  type PreviewReportInput,
  type ReportCatalogCapabilityView,
  type ReportExportState,
  type ReportFilterFormState,
  type ReportFormat,
  type ReportKind,
  type ReportPeriodPreset,
  type ReportPreviewState,
  type ReportProjectOption,
  type ReportScope,
  type ReportsPanelFeedback,
} from '../application/contracts';
import {
  CONTROL_SELECT_CLASS_NAME,
  METRIC_UNAVAILABLE_REASON_IDS,
  REPORT_EXPORT_BUTTON_IDS,
  REPORT_FORMAT_OPTIONS,
  REPORT_KIND_DESCRIPTION_IDS,
  REPORT_KIND_TITLE_IDS,
  REPORT_PRESET_LABEL_IDS,
  REPORT_PRESET_OPTIONS,
  REPORT_SCOPE_LABEL_IDS,
  buildDefaultReportCustomDateInputs,
  formatReportCellValue,
  formatReportDateTime,
  parseReportCustomDateRange,
  resolveReportPeriodFromPreset,
} from './reports-ui-helpers';

export interface ReportsPanelProps {
  readonly organizationName: string;
  readonly isDemoOrganization: boolean;
  readonly catalog: readonly ReportCatalogCapabilityView[];
  readonly accessibleProjects: readonly ReportProjectOption[];
  readonly filters: ReportFilterFormState;
  readonly previewState: ReportPreviewState;
  readonly exportState: ReportExportState;
  readonly canExportSelectedReport: boolean;
  readonly isBusy: boolean;
  readonly feedback?: ReportsPanelFeedback | null;
  readonly announcement?: string;
  readonly focusHeadingTrigger?: string;
  readonly onChangeFilters: (next: ReportFilterFormState) => void;
  readonly onPreviewReport: (input: PreviewReportInput) => Promise<void>;
  readonly onExportReport: (input: ExportReportInput) => Promise<void>;
}

export function ReportsPanel({
  organizationName,
  isDemoOrganization,
  catalog,
  accessibleProjects,
  filters,
  previewState,
  exportState,
  canExportSelectedReport,
  isBusy,
  feedback = null,
  announcement = '',
  focusHeadingTrigger,
  onChangeFilters,
  onPreviewReport,
  onExportReport,
}: ReportsPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [customStart, setCustomStart] = useState<string>(
    () => filters.customRange?.start.slice(0, 10) ?? buildDefaultReportCustomDateInputs().start,
  );
  const [customEnd, setCustomEnd] = useState<string>(
    () => filters.customRange?.end.slice(0, 10) ?? buildDefaultReportCustomDateInputs().end,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  const activeCatalogEntry =
    catalog.find((entry) => entry.kind === filters.kind) ?? catalog[0] ?? null;

  const allowedScopesForKind: readonly ReportScope[] =
    activeCatalogEntry !== null
      ? activeCatalogEntry.allowedScopes
      : REPORT_CATALOG[filters.kind].allowedScopes;

  const isScopeAuthorized = (scope: ReportScope): boolean => {
    if (activeCatalogEntry === null) {
      return true;
    }
    return scope === REPORT_SCOPES.ORGANIZATION
      ? activeCatalogEntry.canRunInOrganizationScope
      : activeCatalogEntry.canRunInProjectScope;
  };

  const handleSelectKind = (nextKind: ReportKind) => {
    setValidationError(null);
    const definition = REPORT_CATALOG[nextKind];
    const nextCatalogEntry = catalog.find((entry) => entry.kind === nextKind);

    let nextScope: ReportScope = filters.scope;
    if (!definition.allowedScopes.includes(nextScope)) {
      nextScope = definition.allowedScopes[0] ?? REPORT_SCOPES.ORGANIZATION;
    } else if (nextCatalogEntry !== undefined) {
      if (
        nextScope === REPORT_SCOPES.ORGANIZATION &&
        !nextCatalogEntry.canRunInOrganizationScope &&
        definition.allowedScopes.includes(REPORT_SCOPES.PROJECT) &&
        nextCatalogEntry.canRunInProjectScope
      ) {
        nextScope = REPORT_SCOPES.PROJECT;
      } else if (
        nextScope === REPORT_SCOPES.PROJECT &&
        !nextCatalogEntry.canRunInProjectScope &&
        definition.allowedScopes.includes(REPORT_SCOPES.ORGANIZATION) &&
        nextCatalogEntry.canRunInOrganizationScope
      ) {
        nextScope = REPORT_SCOPES.ORGANIZATION;
      }
    }

    const nextProjectId =
      nextScope === REPORT_SCOPES.PROJECT
        ? (filters.projectId ?? accessibleProjects[0]?.id)
        : undefined;

    onChangeFilters({
      ...filters,
      kind: nextKind,
      scope: nextScope,
      ...(nextProjectId !== undefined ? { projectId: nextProjectId } : { projectId: undefined }),
    });
  };

  const handleSelectScope = (nextScope: ReportScope) => {
    setValidationError(null);
    const nextProjectId =
      nextScope === REPORT_SCOPES.PROJECT
        ? (filters.projectId ?? accessibleProjects[0]?.id)
        : undefined;

    onChangeFilters({
      ...filters,
      scope: nextScope,
      ...(nextProjectId !== undefined ? { projectId: nextProjectId } : { projectId: undefined }),
    });
  };

  const handleSelectPreset = (nextPreset: ReportPeriodPreset) => {
    setValidationError(null);
    if (nextPreset === 'CUSTOM') {
      const parsed = parseReportCustomDateRange(customStart, customEnd);
      onChangeFilters({
        ...filters,
        preset: nextPreset,
        ...(parsed !== null ? { customRange: parsed } : {}),
      });
      return;
    }
    onChangeFilters({
      ...filters,
      preset: nextPreset,
      customRange: undefined,
    });
  };

  const handleSubmitPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);

    if (filters.scope === REPORT_SCOPES.PROJECT && filters.projectId === undefined) {
      setValidationError(intl.formatMessage({ id: 'reports.filters.scopeProjectRequiredError' }));
      return;
    }

    let resolvedCustomRange = filters.customRange;
    if (filters.preset === 'CUSTOM') {
      const parsed = parseReportCustomDateRange(customStart, customEnd);
      if (parsed === null) {
        setValidationError(intl.formatMessage({ id: 'analytics.period.invalidRangeError' }));
        return;
      }
      resolvedCustomRange = parsed;
    }

    const period = resolveReportPeriodFromPreset(filters.preset, resolvedCustomRange);
    if (period === null) {
      setValidationError(intl.formatMessage({ id: 'analytics.period.invalidRangeError' }));
      return;
    }

    await onPreviewReport({
      kind: filters.kind,
      scope: filters.scope,
      ...(filters.scope === REPORT_SCOPES.PROJECT && filters.projectId !== undefined
        ? { projectId: filters.projectId }
        : {}),
      period,
      compareWithPreviousPeriod: filters.compareWithPreviousPeriod,
    });
  };

  const handleExportFormat = async (format: ReportFormat) => {
    const snapshot = previewState.snapshot;
    if (snapshot === null) {
      return;
    }
    await onExportReport({
      kind: snapshot.filters.kind,
      scope: snapshot.filters.scope,
      ...(snapshot.filters.projectId !== undefined ? { projectId: snapshot.filters.projectId } : {}),
      period: snapshot.filters.period,
      compareWithPreviousPeriod: snapshot.filters.compareWithPreviousPeriod,
      format,
    });
  };

  const isPreviewLoading = previewState.status === REPORT_PREVIEW_STATUSES.LOADING;
  const snapshot = previewState.snapshot;

  return (
    <section aria-labelledby="reports-heading" className="mx-auto w-full max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'reports.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconFileAnalytics className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1
            ref={headingRef}
            id="reports-heading"
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight text-foreground focus:outline-none sm:text-4xl"
          >
            {intl.formatMessage({ id: 'reports.title' })}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
          {isDemoOrganization ? (
            <Badge variant="demo">{intl.formatMessage({ id: 'demoBanner.badge' })}</Badge>
          ) : null}
        </div>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'reports.subtitle' })}
        </p>
        <div>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to="/analytics">
              <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'nav.analytics' })}</span>
            </Link>
          </Button>
        </div>
      </header>

      {isDemoOrganization ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'reports.demoIsolationNotice' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {feedback !== null ? (
        <Alert
          variant={feedback.type === 'destructive' ? 'destructive' : 'success'}
          role={feedback.type === 'destructive' ? 'alert' : 'status'}
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="reports-catalog-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="reports-catalog-heading" className="text-xl font-semibold text-foreground">
            {intl.formatMessage({ id: 'reports.catalog.title' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'reports.catalog.description' })}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {catalog.map((entry) => {
            const isSelected = filters.kind === entry.kind;
            return (
              <Card
                key={entry.kind}
                className={cn(
                  'transition-colors',
                  isSelected ? 'border-primary ring-1 ring-primary' : '',
                )}
              >
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-none tracking-tight">
                      {intl.formatMessage({ id: REPORT_KIND_TITLE_IDS[entry.kind] })}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {entry.allowedScopes.map((scope) => (
                        <Badge key={scope} variant="outline">
                          {intl.formatMessage({ id: REPORT_SCOPE_LABEL_IDS[scope] })}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <CardDescription>
                    {intl.formatMessage({ id: REPORT_KIND_DESCRIPTION_IDS[entry.kind] })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    aria-pressed={isSelected}
                    disabled={isBusy || isPreviewLoading}
                    onClick={() => handleSelectKind(entry.kind)}
                    className="min-h-[44px]"
                  >
                    {intl.formatMessage({ id: REPORT_KIND_TITLE_IDS[entry.kind] })}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'reports.filters.title' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleSubmitPreview(event)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="report-kind-select">
                  {intl.formatMessage({ id: 'reports.filters.kindLabel' })}
                </Label>
                <select
                  id="report-kind-select"
                  value={filters.kind}
                  disabled={isBusy || isPreviewLoading}
                  onChange={(event) => handleSelectKind(event.target.value as ReportKind)}
                  className={CONTROL_SELECT_CLASS_NAME}
                >
                  {catalog.map((entry) => (
                    <option key={entry.kind} value={entry.kind}>
                      {intl.formatMessage({ id: REPORT_KIND_TITLE_IDS[entry.kind] })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-scope-select">
                  {intl.formatMessage({ id: 'reports.filters.scopeLabel' })}
                </Label>
                <select
                  id="report-scope-select"
                  value={filters.scope}
                  disabled={isBusy || isPreviewLoading}
                  onChange={(event) => handleSelectScope(event.target.value as ReportScope)}
                  className={CONTROL_SELECT_CLASS_NAME}
                >
                  {allowedScopesForKind.map((scope) => (
                    <option key={scope} value={scope} disabled={!isScopeAuthorized(scope)}>
                      {intl.formatMessage({ id: REPORT_SCOPE_LABEL_IDS[scope] })}
                    </option>
                  ))}
                </select>
              </div>

              {filters.scope === REPORT_SCOPES.PROJECT ? (
                <div className="space-y-1.5">
                  <Label htmlFor="report-project-select">
                    {intl.formatMessage({ id: 'reports.filters.projectLabel' })}
                  </Label>
                  <select
                    id="report-project-select"
                    value={filters.projectId ?? ''}
                    disabled={isBusy || isPreviewLoading}
                    onChange={(event) => {
                      setValidationError(null);
                      const nextId = event.target.value;
                      onChangeFilters({
                        ...filters,
                        projectId: nextId !== '' ? (nextId as ReportProjectOption['id']) : undefined,
                      });
                    }}
                    className={CONTROL_SELECT_CLASS_NAME}
                  >
                    <option value="">
                      {intl.formatMessage({ id: 'reports.filters.projectPlaceholder' })}
                    </option>
                    {accessibleProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="report-preset-select">
                  {intl.formatMessage({ id: 'reports.filters.presetLabel' })}
                </Label>
                <select
                  id="report-preset-select"
                  value={filters.preset}
                  disabled={isBusy || isPreviewLoading}
                  onChange={(event) =>
                    handleSelectPreset(event.target.value as ReportPeriodPreset)
                  }
                  className={CONTROL_SELECT_CLASS_NAME}
                >
                  {REPORT_PRESET_OPTIONS.map((presetOption) => (
                    <option key={presetOption} value={presetOption}>
                      {intl.formatMessage({ id: REPORT_PRESET_LABEL_IDS[presetOption] })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filters.preset === 'CUSTOM' ? (
              <div className="grid gap-4 rounded-md border border-border bg-muted/30 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="report-custom-start">
                    {intl.formatMessage({ id: 'reports.filters.customStartLabel' })}
                  </Label>
                  <Input
                    id="report-custom-start"
                    type="date"
                    value={customStart}
                    disabled={isBusy || isPreviewLoading}
                    onChange={(event) => {
                      setValidationError(null);
                      setCustomStart(event.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report-custom-end">
                    {intl.formatMessage({ id: 'reports.filters.customEndLabel' })}
                  </Label>
                  <Input
                    id="report-custom-end"
                    type="date"
                    value={customEnd}
                    disabled={isBusy || isPreviewLoading}
                    onChange={(event) => {
                      setValidationError(null);
                      setCustomEnd(event.target.value);
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <label
                htmlFor="report-compare-toggle"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
              >
                <input
                  id="report-compare-toggle"
                  type="checkbox"
                  checked={filters.compareWithPreviousPeriod}
                  disabled={isBusy || isPreviewLoading}
                  onChange={(event) =>
                    onChangeFilters({
                      ...filters,
                      compareWithPreviousPeriod: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <span>{intl.formatMessage({ id: 'reports.filters.compareLabel' })}</span>
              </label>

              <Button
                type="submit"
                disabled={isBusy || isPreviewLoading || !isScopeAuthorized(filters.scope)}
                className="min-h-[44px] gap-2"
              >
                <IconEye className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({
                    id: isPreviewLoading
                      ? 'reports.filters.previewing'
                      : 'reports.filters.previewAction',
                  })}
                </span>
              </Button>
            </div>

            {!isScopeAuthorized(filters.scope) ? (
              <Alert variant="warning">
                <AlertDescription>
                  {intl.formatMessage({ id: 'reports.noPermission' })}
                </AlertDescription>
              </Alert>
            ) : null}

            {validationError !== null ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="reports-preview-heading" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle id="reports-preview-heading">
              {intl.formatMessage({ id: 'reports.preview.title' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {previewState.status === REPORT_PREVIEW_STATUSES.ERROR ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {previewState.errorMessage ?? intl.formatMessage({ id: 'errors.UNEXPECTED_ERROR' })}
                </AlertDescription>
              </Alert>
            ) : null}

            {snapshot === null ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <h3 className="text-base font-semibold text-foreground">
                  {intl.formatMessage({ id: 'reports.preview.emptyTitle' })}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'reports.preview.emptyDescription' })}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <Alert>
                  <AlertDescription>
                    {intl.formatMessage({ id: 'reports.preview.parityNotice' })}
                  </AlertDescription>
                </Alert>

                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <Badge variant="secondary">
                    {intl.formatMessage(
                      { id: 'reports.preview.organizationLabel' },
                      { name: snapshot.organizationName },
                    )}
                  </Badge>
                  {snapshot.projectName !== undefined ? (
                    <Badge variant="outline">
                      {intl.formatMessage(
                        { id: 'reports.preview.projectLabel' },
                        { name: snapshot.projectName },
                      )}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    {intl.formatMessage(
                      { id: 'reports.preview.generatedAtLabel' },
                      { date: formatReportDateTime(snapshot.snapshotGeneratedAt, intl) },
                    )}
                  </Badge>
                  <Badge variant="outline">
                    {intl.formatMessage(
                      { id: 'reports.preview.rowCountLabel' },
                      { count: snapshot.rows.length },
                    )}
                  </Badge>
                </div>

                {REPORT_CATALOG[snapshot.kind].mayIncludeThirdPartyIndividualMetrics ? (
                  <Alert variant={snapshot.includesThirdPartyIndividualMetrics ? 'info' : 'warning'}>
                    <AlertDescription>
                      {intl.formatMessage({
                        id: snapshot.includesThirdPartyIndividualMetrics
                          ? 'reports.privacy.thirdPartyIncludedNotice'
                          : 'reports.privacy.thirdPartyHiddenNotice',
                      })}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {REPORT_CATALOG[snapshot.kind].includesFeedbackData ? (
                  <Alert>
                    <AlertDescription>
                      {intl.formatMessage({ id: 'reports.privacy.feedbackSegregationNotice' })}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {snapshot.kpis.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {snapshot.kpis.map((kpi) => (
                      <div
                        key={kpi.key}
                        className="rounded-md border border-border bg-muted/30 p-3 space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            {kpi.label}
                          </span>
                          {kpi.unavailableReason !== undefined ? (
                            <Badge variant="outline">
                              {intl.formatMessage({ id: 'analytics.metric.unavailableBadge' })}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-base font-bold text-foreground">{kpi.value}</p>
                        {kpi.unavailableReason !== undefined ? (
                          <p className="text-xs text-muted-foreground">
                            {intl.formatMessage({
                              id: METRIC_UNAVAILABLE_REASON_IDS[kpi.unavailableReason],
                            })}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {snapshot.rows.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'reports.preview.emptyRows' })}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full border-collapse text-left text-sm">
                      <caption className="sr-only">{snapshot.title}</caption>
                      <thead className="bg-muted/50">
                        <tr>
                          {snapshot.columns.map((column) => (
                            <th
                              key={column.key}
                              scope="col"
                              className="px-3 py-2 font-semibold text-foreground"
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-t border-border">
                            {snapshot.columns.map((column) => (
                              <td key={column.key} className="px-3 py-2 text-foreground">
                                {formatReportCellValue(row[column.key] ?? null, intl)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="space-y-4 border-t border-border pt-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <IconShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                      <h3 className="text-lg font-semibold text-foreground">
                        {intl.formatMessage({ id: 'reports.export.title' })}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {intl.formatMessage({ id: 'reports.export.description' })}
                    </p>
                  </div>

                  <Alert>
                    <AlertDescription>
                      {intl.formatMessage({ id: 'reports.export.sanitizationNotice' })}
                    </AlertDescription>
                  </Alert>

                  {!canExportSelectedReport ? (
                    <Alert variant="warning">
                      <AlertDescription>
                        {intl.formatMessage({ id: 'reports.export.noPermission' })}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {REPORT_FORMAT_OPTIONS.map((format) => {
                        const isExportingThis =
                          exportState.isExporting && exportState.activeFormat === format;
                        return (
                          <Button
                            key={format}
                            type="button"
                            variant="outline"
                            disabled={isBusy || isPreviewLoading || exportState.isExporting}
                            onClick={() => void handleExportFormat(format)}
                            className="min-h-[44px] gap-2"
                          >
                            <IconDownload className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {isExportingThis
                                ? intl.formatMessage({ id: 'reports.export.exporting' }, { format })
                                : intl.formatMessage({ id: REPORT_EXPORT_BUTTON_IDS[format] })}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  {exportState.errorMessage !== undefined ? (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{exportState.errorMessage}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </section>
  );
}
