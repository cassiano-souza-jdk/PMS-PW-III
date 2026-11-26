import { zodResolver } from '@hookform/resolvers/zod';
import { IconClockCheck, IconDownload, IconEye, IconPlus, IconSettings } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import { PRIORITIES, type Priority } from '@/shared/kernel';
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
  ModalDialog,
} from '@/shared/ui';
import {
  FEEDBACK_MODULE_KEYS,
  FEEDBACK_STATUSES,
  type FeedbackCategoryId,
  type FeedbackCategoryWithVersion,
  type FeedbackExportFormat,
  type FeedbackExportResult,
  type FeedbackListItem,
  type FeedbackStatus,
} from '../application/contracts';
import {
  CONTROL_SELECT_CLASS_NAME,
  CONTROL_TEXTAREA_CLASS_NAME,
  FEEDBACK_PRIORITY_BADGE_VARIANTS,
  FEEDBACK_PRIORITY_LABEL_IDS,
  FEEDBACK_STATUS_BADGE_VARIANTS,
  FEEDBACK_STATUS_LABEL_IDS,
  SLA_EVALUATION_LABEL_IDS,
  formatFeedbackDateTime,
  resolveFeedbackModuleLabelId,
  triggerFeedbackBlobDownload,
  type FeedbackPanelFeedback,
} from './feedback-ui-helpers';

export interface FeedbackQueueFiltersState {
  readonly search: string;
  readonly status: FeedbackStatus | '';
  readonly priority: Priority | '';
  readonly moduleKey: string;
  readonly onlyMine: boolean;
  readonly assignedToMe: boolean;
}

export interface FeedbackListPanelProps {
  readonly organizationName: string;
  readonly currentUserName: string;
  readonly items: readonly FeedbackListItem[];
  readonly countsByStatus: Readonly<Record<FeedbackStatus, number>>;
  readonly totalCount: number;
  readonly page: number;
  readonly totalPages: number;
  readonly categories: readonly FeedbackCategoryWithVersion[];
  readonly filters: FeedbackQueueFiltersState;
  readonly canCreateFeedback: boolean;
  readonly canEvaluateSla: boolean;
  readonly canExportFeedbacks: boolean;
  readonly canAccessGovernance: boolean;
  readonly isBusy: boolean;
  readonly feedback?: FeedbackPanelFeedback | null;
  readonly announcement?: string;
  readonly focusHeadingTrigger?: string;
  readonly onChangeFilters: (next: FeedbackQueueFiltersState) => void;
  readonly onClearFilters: () => void;
  readonly onChangePage: (page: number) => void;
  readonly onCreateFeedback: (input: {
    readonly moduleKey: string;
    readonly categoryId: FeedbackCategoryId;
    readonly title: string;
    readonly description: string;
    readonly priority: Priority;
  }) => Promise<void>;
  readonly onEvaluateSlas: () => Promise<void>;
  readonly onExportFeedbacks: (format: FeedbackExportFormat) => Promise<FeedbackExportResult>;
}

const createFeedbackSchema = z.object({
  moduleKey: z.enum(FEEDBACK_MODULE_KEYS),
  categoryId: z.string().uuid(),
  priority: z.enum([PRIORITIES.LOW, PRIORITIES.MEDIUM, PRIORITIES.HIGH, PRIORITIES.CRITICAL]),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(8000),
});

type CreateFeedbackFormValues = z.infer<typeof createFeedbackSchema>;

export function FeedbackListPanel({
  organizationName,
  currentUserName,
  items,
  countsByStatus,
  totalCount,
  page,
  totalPages,
  categories,
  filters,
  canCreateFeedback,
  canEvaluateSla,
  canExportFeedbacks,
  canAccessGovernance,
  isBusy,
  feedback = null,
  announcement = '',
  focusHeadingTrigger,
  onChangeFilters,
  onClearFilters,
  onChangePage,
  onCreateFeedback,
  onEvaluateSlas,
  onExportFeedbacks,
}: FeedbackListPanelProps) {
  const intl = useIntl();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const searchInputId = useId();
  const statusSelectId = useId();
  const prioritySelectId = useId();
  const moduleSelectId = useId();
  const onlyMineCheckboxId = useId();
  const assignedToMeCheckboxId = useId();
  const createTitleId = useId();
  const createDescId = useId();
  const exportFormatId = useId();

  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<FeedbackExportFormat>('JSON');
  const [exportPreview, setExportPreview] = useState<FeedbackExportResult | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const activeCategories = categories.filter((item) => item.category.active);

  const form = useForm<CreateFeedbackFormValues>({
    resolver: zodResolver(createFeedbackSchema),
    defaultValues: {
      moduleKey: 'general',
      categoryId: activeCategories[0]?.category.id ?? '',
      priority: PRIORITIES.MEDIUM,
      title: '',
      description: '',
    },
  });

  useEffect(() => {
    if (focusHeadingTrigger !== undefined) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger]);

  useEffect(() => {
    const firstActiveId = activeCategories[0]?.category.id ?? '';
    if (firstActiveId !== '' && form.getValues('categoryId') === '') {
      form.setValue('categoryId', firstActiveId);
    }
  }, [activeCategories, form]);

  const titleField = form.register('title');

  const handleOpenCreateModal = () => {
    form.reset({
      moduleKey: 'general',
      categoryId: activeCategories[0]?.category.id ?? '',
      priority: PRIORITIES.MEDIUM,
      title: '',
      description: '',
    });
    setIsCreateOpen(true);
  };

  const handleCreateSubmit = form.handleSubmit(async (values) => {
    await onCreateFeedback({
      moduleKey: values.moduleKey,
      categoryId: values.categoryId as FeedbackCategoryId,
      title: values.title,
      description: values.description,
      priority: values.priority,
    });
    setIsCreateOpen(false);
    form.reset();
  });

  const handlePreviewExport = async () => {
    if (exportPreview !== null && exportPreview.format === exportFormat) {
      setExportPreview(null);
      return;
    }
    setIsExporting(true);
    try {
      const result = await onExportFeedbacks(exportFormat);
      setExportPreview(result);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadExport = async () => {
    setIsExporting(true);
    try {
      const result = await onExportFeedbacks(exportFormat);
      setExportPreview(result);
      triggerFeedbackBlobDownload(result.content, result.mimeType, result.fileName);
    } finally {
      setIsExporting(false);
    }
  };

  const allStatuses = Object.values(FEEDBACK_STATUSES);

  return (
    <section aria-labelledby="feedback-queue-heading" className="mx-auto max-w-6xl space-y-6">
      <div
        role="status"
        aria-live="polite"
        aria-label={intl.formatMessage({ id: 'feedbacks.liveRegionLabel' })}
        className="sr-only"
      >
        {announcement}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{organizationName}</p>
          <h1
            ref={headingRef}
            id="feedback-queue-heading"
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-foreground focus:outline-none"
          >
            {intl.formatMessage({ id: 'feedbacks.queue.title' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'feedbacks.queue.subtitle' })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateFeedback ? (
            <Button
              type="button"
              onClick={handleOpenCreateModal}
              disabled={isBusy}
              className="min-h-[44px] gap-2"
            >
              <IconPlus className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'feedbacks.create.openAction' })}</span>
            </Button>
          ) : null}

          {canEvaluateSla ? (
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
          ) : null}

          {canAccessGovernance ? (
            <Button asChild variant="outline" className="min-h-[44px] gap-2">
              <Link to="/feedback/governance">
                <IconSettings className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'feedbacks.nav.governanceShortcut' })}</span>
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <Alert role="status">
        <AlertDescription className="space-y-1 text-xs sm:text-sm">
          <p>{intl.formatMessage({ id: 'feedbacks.queue.visibilityNotice' })}</p>
          <p className="text-muted-foreground">
            {intl.formatMessage({ id: 'feedbacks.slaEvaluation.pureReadHint' })}
          </p>
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

      <section aria-labelledby="feedback-counters-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="feedback-counters-heading" className="text-base font-semibold text-foreground">
            {intl.formatMessage({ id: 'feedbacks.queue.totalCountLabel' }, { count: totalCount })}
          </h2>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {allStatuses.map((status) => (
            <li key={status} className="rounded-md border border-border bg-card p-3 text-center">
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: FEEDBACK_STATUS_LABEL_IDS[status] })}
              </p>
              <p className="mt-1 text-lg font-bold text-foreground">{countsByStatus[status]}</p>
            </li>
          ))}
        </ul>
      </section>

      <Card aria-labelledby="feedback-filters-heading">
        <CardHeader>
          <CardTitle id="feedback-filters-heading" className="text-lg">
            {intl.formatMessage({ id: 'feedbacks.filters.searchLabel' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor={searchInputId}>
                {intl.formatMessage({ id: 'feedbacks.filters.searchLabel' })}
              </Label>
              <Input
                id={searchInputId}
                type="search"
                value={filters.search}
                onChange={(event) => onChangeFilters({ ...filters, search: event.target.value })}
                placeholder={intl.formatMessage({ id: 'feedbacks.filters.searchPlaceholder' })}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={statusSelectId}>
                {intl.formatMessage({ id: 'feedbacks.filters.statusLabel' })}
              </Label>
              <select
                id={statusSelectId}
                value={filters.status}
                onChange={(event) =>
                  onChangeFilters({
                    ...filters,
                    status: event.target.value as FeedbackStatus | '',
                  })
                }
                className={CONTROL_SELECT_CLASS_NAME}
              >
                <option value="">
                  {intl.formatMessage({ id: 'feedbacks.filters.allStatuses' })}
                </option>
                {allStatuses.map((status) => (
                  <option key={status} value={status}>
                    {intl.formatMessage({ id: FEEDBACK_STATUS_LABEL_IDS[status] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={prioritySelectId}>
                {intl.formatMessage({ id: 'feedbacks.filters.priorityLabel' })}
              </Label>
              <select
                id={prioritySelectId}
                value={filters.priority}
                onChange={(event) =>
                  onChangeFilters({
                    ...filters,
                    priority: event.target.value as Priority | '',
                  })
                }
                className={CONTROL_SELECT_CLASS_NAME}
              >
                <option value="">
                  {intl.formatMessage({ id: 'feedbacks.filters.allPriorities' })}
                </option>
                {Object.values(PRIORITIES).map((priority) => (
                  <option key={priority} value={priority}>
                    {intl.formatMessage({ id: FEEDBACK_PRIORITY_LABEL_IDS[priority] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={moduleSelectId}>
                {intl.formatMessage({ id: 'feedbacks.filters.moduleLabel' })}
              </Label>
              <select
                id={moduleSelectId}
                value={filters.moduleKey}
                onChange={(event) => onChangeFilters({ ...filters, moduleKey: event.target.value })}
                className={CONTROL_SELECT_CLASS_NAME}
              >
                <option value="">
                  {intl.formatMessage({ id: 'feedbacks.filters.allModules' })}
                </option>
                {FEEDBACK_MODULE_KEYS.map((moduleKey) => (
                  <option key={moduleKey} value={moduleKey}>
                    {intl.formatMessage({ id: resolveFeedbackModuleLabelId(moduleKey) })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <label
                htmlFor={onlyMineCheckboxId}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <input
                  id={onlyMineCheckboxId}
                  type="checkbox"
                  checked={filters.onlyMine}
                  onChange={(event) =>
                    onChangeFilters({ ...filters, onlyMine: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-input"
                />
                <span>
                  {intl.formatMessage(
                    { id: 'feedbacks.queue.authorLabel' },
                    { name: currentUserName },
                  )}
                </span>
              </label>

              <label
                htmlFor={assignedToMeCheckboxId}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <input
                  id={assignedToMeCheckboxId}
                  type="checkbox"
                  checked={filters.assignedToMe}
                  onChange={(event) =>
                    onChangeFilters({ ...filters, assignedToMe: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-input"
                />
                <span>
                  {intl.formatMessage(
                    { id: 'feedbacks.queue.assigneeLabel' },
                    { name: currentUserName },
                  )}
                </span>
              </label>
            </div>

            <Button type="button" variant="ghost" onClick={onClearFilters} className="min-h-[44px]">
              {intl.formatMessage({ id: 'feedbacks.filters.clearAction' })}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="feedback-list-items-heading" className="space-y-3">
        <h2 id="feedback-list-items-heading" className="text-lg font-semibold text-foreground">
          {intl.formatMessage(
            { id: 'feedbacks.queue.pageSummary' },
            { page, totalPages: Math.max(1, totalPages), total: totalCount },
          )}
        </h2>

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'feedbacks.queue.empty' })}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const { feedback: fb, slaStatus } = item;
              const authorName =
                item.authorProfile?.displayName ??
                intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });
              const assigneeName =
                item.assigneeProfile?.displayName ??
                intl.formatMessage({ id: 'feedbacks.queue.unassignedLabel' });

              return (
                <li key={fb.id}>
                  <Card>
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={FEEDBACK_STATUS_BADGE_VARIANTS[fb.status]}>
                            {intl.formatMessage({ id: FEEDBACK_STATUS_LABEL_IDS[fb.status] })}
                          </Badge>
                          <Badge variant={FEEDBACK_PRIORITY_BADGE_VARIANTS[fb.priority]}>
                            {intl.formatMessage({ id: FEEDBACK_PRIORITY_LABEL_IDS[fb.priority] })}
                          </Badge>
                          <Badge variant="outline">
                            {intl.formatMessage({ id: resolveFeedbackModuleLabelId(fb.moduleKey) })}
                          </Badge>
                          {item.categoryName !== undefined ? (
                            <Badge variant="outline">{item.categoryName}</Badge>
                          ) : null}
                          {item.hasPendingContest ? (
                            <Badge variant="destructive">
                              {intl.formatMessage({ id: 'feedbacks.queue.pendingContestBadge' })}
                            </Badge>
                          ) : null}
                          {item.hasPendingReopenRequest ? (
                            <Badge variant="default">
                              {intl.formatMessage({ id: 'feedbacks.queue.pendingReopenBadge' })}
                            </Badge>
                          ) : null}
                        </div>

                        <h3 className="text-base font-semibold text-foreground">{fb.title}</h3>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {intl.formatMessage(
                              { id: 'feedbacks.queue.authorLabel' },
                              { name: authorName },
                            )}
                          </span>
                          <span>
                            {intl.formatMessage(
                              { id: 'feedbacks.queue.assigneeLabel' },
                              { name: assigneeName },
                            )}
                          </span>
                          <span>
                            {intl.formatMessage(
                              { id: 'feedbacks.detail.createdAtLabel' },
                              { date: formatFeedbackDateTime(fb.createdAt, intl) },
                            )}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {intl.formatMessage({ id: 'feedbacks.sla.firstResponseLabel' })}:{' '}
                            {slaStatus.firstResponseCompleted
                              ? intl.formatMessage({ id: 'feedbacks.sla.status.COMPLETED' })
                              : intl.formatMessage({
                                  id: SLA_EVALUATION_LABEL_IDS[slaStatus.firstResponseStatus],
                                })}
                          </span>
                          <span>
                            {intl.formatMessage({ id: 'feedbacks.sla.resolutionLabel' })}:{' '}
                            {slaStatus.resolutionCompleted
                              ? intl.formatMessage({ id: 'feedbacks.sla.status.COMPLETED' })
                              : fb.status === 'WAITING_INFO'
                                ? intl.formatMessage({ id: 'feedbacks.sla.status.PAUSED' })
                                : intl.formatMessage({
                                    id: SLA_EVALUATION_LABEL_IDS[slaStatus.resolutionStatus],
                                  })}
                          </span>
                        </div>
                      </div>

                      <Button asChild variant="outline" className="min-h-[44px] shrink-0">
                        <Link to={`/feedback/${fb.id}`}>
                          {intl.formatMessage({ id: 'feedbacks.queue.openDetailAction' })}
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1 || isBusy}
              onClick={() => onChangePage(page - 1)}
              className="min-h-[44px]"
            >
              {intl.formatMessage({ id: 'feedbacks.queue.previousPage' })}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page >= totalPages || isBusy}
              onClick={() => onChangePage(page + 1)}
              className="min-h-[44px]"
            >
              {intl.formatMessage({ id: 'feedbacks.queue.nextPage' })}
            </Button>
          </div>
        ) : null}
      </section>

      {canExportFeedbacks ? (
        <Card aria-labelledby="feedback-export-heading">
          <CardHeader>
            <CardTitle id="feedback-export-heading" className="text-lg">
              {intl.formatMessage({ id: 'feedbacks.export.title' })}
            </CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'feedbacks.export.segmentationNotice' })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full max-w-xs space-y-1.5">
                <Label htmlFor={exportFormatId}>
                  {intl.formatMessage({ id: 'feedbacks.export.formatLabel' })}
                </Label>
                <select
                  id={exportFormatId}
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as FeedbackExportFormat)}
                  className={CONTROL_SELECT_CLASS_NAME}
                  disabled={isBusy || isExporting}
                >
                  <option value="JSON">
                    {intl.formatMessage({ id: 'feedbacks.export.formatJson' })}
                  </option>
                  <option value="CSV">
                    {intl.formatMessage({ id: 'feedbacks.export.formatCsv' })}
                  </option>
                </select>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => void handlePreviewExport()}
                disabled={isBusy || isExporting}
                className="min-h-[44px] gap-2"
              >
                <IconEye className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({
                    id:
                      exportPreview !== null && exportPreview.format === exportFormat
                        ? 'feedbacks.export.hidePreviewAction'
                        : 'feedbacks.export.previewAction',
                  })}
                </span>
              </Button>

              <Button
                type="button"
                onClick={() => void handleDownloadExport()}
                disabled={isBusy || isExporting}
                className="min-h-[44px] gap-2"
              >
                <IconDownload className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'feedbacks.export.downloadAction' })}</span>
              </Button>
            </div>

            {exportPreview !== null ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage(
                    { id: 'feedbacks.export.success' },
                    {
                      fileName: exportPreview.fileName,
                      totalCount: exportPreview.totalCount,
                    },
                  )}
                </p>
                <textarea
                  readOnly
                  aria-label={intl.formatMessage({ id: 'feedbacks.export.title' })}
                  value={exportPreview.content}
                  rows={10}
                  className="w-full overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ModalDialog
        isOpen={isCreateOpen}
        titleId={createTitleId}
        descriptionId={createDescId}
        title={intl.formatMessage({ id: 'feedbacks.create.title' })}
        description={intl.formatMessage({ id: 'feedbacks.create.immutabilityNotice' })}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isBusy || form.formState.isSubmitting}
        initialFocusRef={titleInputRef}
        onClose={() => setIsCreateOpen(false)}
      >
        {activeCategories.length === 0 ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {intl.formatMessage({ id: 'feedbacks.create.noActiveCategories' })}
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleCreateSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-create-title">
                {intl.formatMessage({ id: 'feedbacks.create.titleLabel' })}
              </Label>
              <Input
                id="feedback-create-title"
                {...titleField}
                ref={(element) => {
                  titleField.ref(element);
                  titleInputRef.current = element;
                }}
                placeholder={intl.formatMessage({ id: 'feedbacks.create.titlePlaceholder' })}
                className="min-h-[44px]"
                aria-invalid={form.formState.errors.title !== undefined}
                disabled={isBusy}
              />
              {form.formState.errors.title !== undefined ? (
                <p role="alert" className="text-sm text-destructive">
                  {intl.formatMessage({ id: 'validation.minLength' }, { min: 3 })}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="feedback-create-module">
                  {intl.formatMessage({ id: 'feedbacks.create.moduleLabel' })}
                </Label>
                <select
                  id="feedback-create-module"
                  {...form.register('moduleKey')}
                  className={CONTROL_SELECT_CLASS_NAME}
                  disabled={isBusy}
                >
                  {FEEDBACK_MODULE_KEYS.map((moduleKey) => (
                    <option key={moduleKey} value={moduleKey}>
                      {intl.formatMessage({ id: resolveFeedbackModuleLabelId(moduleKey) })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="feedback-create-category">
                  {intl.formatMessage({ id: 'feedbacks.create.categoryLabel' })}
                </Label>
                <select
                  id="feedback-create-category"
                  {...form.register('categoryId')}
                  className={CONTROL_SELECT_CLASS_NAME}
                  disabled={isBusy}
                >
                  {activeCategories.map((item) => (
                    <option key={item.category.id} value={item.category.id}>
                      {item.currentVersion.name} (v{item.currentVersion.versionNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="feedback-create-priority">
                  {intl.formatMessage({ id: 'feedbacks.create.priorityLabel' })}
                </Label>
                <select
                  id="feedback-create-priority"
                  {...form.register('priority')}
                  className={CONTROL_SELECT_CLASS_NAME}
                  disabled={isBusy}
                >
                  {Object.values(PRIORITIES).map((priority) => (
                    <option key={priority} value={priority}>
                      {intl.formatMessage({ id: FEEDBACK_PRIORITY_LABEL_IDS[priority] })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feedback-create-description">
                {intl.formatMessage({ id: 'feedbacks.create.descriptionLabel' })}
              </Label>
              <textarea
                id="feedback-create-description"
                {...form.register('description')}
                placeholder={intl.formatMessage({ id: 'feedbacks.create.descriptionPlaceholder' })}
                className={CONTROL_TEXTAREA_CLASS_NAME}
                aria-invalid={form.formState.errors.description !== undefined}
                disabled={isBusy}
              />
              {form.formState.errors.description !== undefined ? (
                <p role="alert" className="text-sm text-destructive">
                  {intl.formatMessage({ id: 'validation.minLength' }, { min: 5 })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={isBusy}
                className="min-h-[44px]"
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </Button>
              <Button type="submit" disabled={isBusy} className="min-h-[44px]">
                {intl.formatMessage({
                  id: form.formState.isSubmitting
                    ? 'feedbacks.create.submitting'
                    : 'feedbacks.create.submitAction',
                })}
              </Button>
            </div>
          </form>
        )}
      </ModalDialog>
    </section>
  );
}
