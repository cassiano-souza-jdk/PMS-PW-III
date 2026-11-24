import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconAlertOctagon,
  IconCheck,
  IconEdit,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';
import {
  IMPEDIMENT_SEVERITIES,
  TASK_STATUSES,
  asUserId,
  isUuid,
  parseIsoDateTimeMs,
  type ImpedimentId,
  type ImpedimentSeverity,
  type TaskStatus,
  type UserId,
} from '@/shared/kernel';
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
  Label,
  ModalDialog,
} from '@/shared/ui';
import {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_STATUSES,
  isImpedimentBlocking,
  type Impediment,
  type ImpedimentCategory,
  type ImpedimentStatus,
} from '../application/contracts';
import type {
  CreateImpedimentInput,
  TransitionImpedimentInput,
  UpdateImpedimentInput,
} from '../application/services/impediment-service';

export interface ImpedimentUserOption {
  readonly userId: UserId;
  readonly displayName: string;
}

export interface TaskImpedimentsPanelProps {
  readonly taskStatus: TaskStatus;
  readonly impediments: readonly Impediment[];
  readonly ownerOptions: readonly ImpedimentUserOption[];
  readonly usersById: ReadonlyMap<UserId, ImpedimentUserOption>;
  readonly canViewImpediments: boolean;
  readonly canCreateImpediment: boolean;
  readonly canResolveByImpedimentId: Readonly<Record<string, boolean>>;
  readonly isReadOnly: boolean;
  readonly isMutating?: boolean;
  readonly onCreateImpediment: (input: CreateImpedimentInput) => Promise<void>;
  readonly onUpdateImpediment: (
    impedimentId: ImpedimentId,
    input: UpdateImpedimentInput,
  ) => Promise<void>;
  readonly onTransitionImpediment: (
    impedimentId: ImpedimentId,
    input: TransitionImpedimentInput,
  ) => Promise<void>;
}

const CATEGORY_ORDER: readonly ImpedimentCategory[] = [
  IMPEDIMENT_CATEGORIES.EXTERNAL_DEPENDENCY,
  IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
  IMPEDIMENT_CATEGORIES.MISSING_INFORMATION,
  IMPEDIMENT_CATEGORIES.RESOURCE_UNAVAILABILITY,
  IMPEDIMENT_CATEGORIES.AWAITING_APPROVAL,
  IMPEDIMENT_CATEGORIES.COMMUNICATION,
  IMPEDIMENT_CATEGORIES.OTHER,
];

const SEVERITY_ORDER: readonly ImpedimentSeverity[] = [
  IMPEDIMENT_SEVERITIES.LOW,
  IMPEDIMENT_SEVERITIES.MEDIUM,
  IMPEDIMENT_SEVERITIES.HIGH,
  IMPEDIMENT_SEVERITIES.CRITICAL,
];

const CATEGORY_LABEL_IDS: Readonly<Record<ImpedimentCategory, MessageId>> = {
  EXTERNAL_DEPENDENCY: 'impediments.category.EXTERNAL_DEPENDENCY',
  TECHNICAL_ISSUE: 'impediments.category.TECHNICAL_ISSUE',
  MISSING_INFORMATION: 'impediments.category.MISSING_INFORMATION',
  RESOURCE_UNAVAILABILITY: 'impediments.category.RESOURCE_UNAVAILABILITY',
  AWAITING_APPROVAL: 'impediments.category.AWAITING_APPROVAL',
  COMMUNICATION: 'impediments.category.COMMUNICATION',
  OTHER: 'impediments.category.OTHER',
};

const SEVERITY_LABEL_IDS: Readonly<Record<ImpedimentSeverity, MessageId>> = {
  LOW: 'impediments.severity.LOW',
  MEDIUM: 'impediments.severity.MEDIUM',
  HIGH: 'impediments.severity.HIGH',
  CRITICAL: 'impediments.severity.CRITICAL',
};

const SEVERITY_BADGE_VARIANTS: Readonly<
  Record<ImpedimentSeverity, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'default',
  CRITICAL: 'destructive',
};

const STATUS_LABEL_IDS: Readonly<Record<ImpedimentStatus, MessageId>> = {
  OPEN: 'impediments.status.OPEN',
  IN_RESOLUTION: 'impediments.status.IN_RESOLUTION',
  RESOLVED: 'impediments.status.RESOLVED',
  CANCELLED: 'impediments.status.CANCELLED',
};

const STATUS_BADGE_VARIANTS: Readonly<
  Record<ImpedimentStatus, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  OPEN: 'destructive',
  IN_RESOLUTION: 'default',
  RESOLVED: 'secondary',
  CANCELLED: 'outline',
};

const SELECT_CLASS_NAME =
  'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const TEXTAREA_CLASS_NAME =
  'flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const impedimentFormSchema = z.object({
  category: z.enum([
    IMPEDIMENT_CATEGORIES.EXTERNAL_DEPENDENCY,
    IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
    IMPEDIMENT_CATEGORIES.MISSING_INFORMATION,
    IMPEDIMENT_CATEGORIES.RESOURCE_UNAVAILABILITY,
    IMPEDIMENT_CATEGORIES.AWAITING_APPROVAL,
    IMPEDIMENT_CATEGORIES.COMMUNICATION,
    IMPEDIMENT_CATEGORIES.OTHER,
  ]),
  severity: z.enum([
    IMPEDIMENT_SEVERITIES.LOW,
    IMPEDIMENT_SEVERITIES.MEDIUM,
    IMPEDIMENT_SEVERITIES.HIGH,
    IMPEDIMENT_SEVERITIES.CRITICAL,
  ]),
  description: z.string().trim().min(1, 'validation.required').max(2000, 'validation.maxLength'),
  ownerUserId: z
    .string()
    .trim()
    .refine((value: string): boolean => value === '' || isUuid(value), 'validation.uuidInvalid'),
});

type ImpedimentFormValues = z.infer<typeof impedimentFormSchema>;

interface PendingTransitionDialog {
  readonly impediment: Impediment;
  readonly targetStatus: typeof IMPEDIMENT_STATUSES.RESOLVED | typeof IMPEDIMENT_STATUSES.CANCELLED;
}

function resolveImpedimentErrorId(error: unknown): MessageId {
  return isAppError(error) ? getErrorMessageId(error.code) : 'errors.UNEXPECTED_ERROR';
}

function resolveValidationMessage(
  code: string | undefined,
  intl: ReturnType<typeof useIntl>,
): string {
  if (code === 'validation.maxLength') {
    return intl.formatMessage({ id: 'validation.maxLength' }, { max: 2000 });
  }
  if (code === 'validation.uuidInvalid') {
    return intl.formatMessage({ id: 'validation.uuidInvalid' });
  }
  return intl.formatMessage({ id: 'validation.required' });
}

export function TaskImpedimentsPanel({
  taskStatus,
  impediments,
  ownerOptions,
  usersById,
  canViewImpediments,
  canCreateImpediment,
  canResolveByImpedimentId,
  isReadOnly,
  isMutating = false,
  onCreateImpediment,
  onUpdateImpediment,
  onTransitionImpediment,
}: TaskImpedimentsPanelProps) {
  const intl = useIntl();
  const editCategorySelectRef = useRef<HTMLSelectElement | null>(null);
  const transitionNoteRef = useRef<HTMLTextAreaElement | null>(null);

  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [editingImpediment, setEditingImpediment] = useState<Impediment | null>(null);
  const [pendingTransition, setPendingTransition] = useState<PendingTransitionDialog | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string>('');
  const [resolutionNoteError, setResolutionNoteError] = useState<string | null>(null);

  const createForm = useForm<ImpedimentFormValues>({
    resolver: zodResolver(impedimentFormSchema),
    defaultValues: {
      category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
      severity: IMPEDIMENT_SEVERITIES.MEDIUM,
      description: '',
      ownerUserId: '',
    },
  });

  const editForm = useForm<ImpedimentFormValues>({
    resolver: zodResolver(impedimentFormSchema),
    defaultValues: {
      category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
      severity: IMPEDIMENT_SEVERITIES.MEDIUM,
      description: '',
      ownerUserId: '',
    },
  });

  const sortedImpediments = useMemo(
    () =>
      [...impediments].sort((a, b) => {
        const aBlocking = isImpedimentBlocking(a) ? 0 : 1;
        const bBlocking = isImpedimentBlocking(b) ? 0 : 1;
        if (aBlocking !== bBlocking) {
          return aBlocking - bBlocking;
        }
        return parseIsoDateTimeMs(b.openedAt) - parseIsoDateTimeMs(a.openedAt);
      }),
    [impediments],
  );

  const hasBlockingImpediments = useMemo(
    () => impediments.some((item) => isImpedimentBlocking(item)),
    [impediments],
  );

  const canOpenImpediment =
    canCreateImpediment &&
    !isReadOnly &&
    taskStatus !== TASK_STATUSES.DONE &&
    taskStatus !== TASK_STATUSES.CANCELLED;

  const unknownUserLabel = intl.formatMessage({ id: 'tasks.fields.unknownUser' });

  const handleCreateSubmit = async (values: ImpedimentFormValues): Promise<void> => {
    setLocalError(null);
    setAnnouncement('');
    try {
      const trimmedOwner = values.ownerUserId.trim();
      await onCreateImpediment({
        category: values.category,
        severity: values.severity,
        description: values.description.trim(),
        ...(trimmedOwner.length > 0 ? { ownerUserId: asUserId(trimmedOwner, 'ownerUserId') } : {}),
      });
      createForm.reset({
        category: IMPEDIMENT_CATEGORIES.TECHNICAL_ISSUE,
        severity: IMPEDIMENT_SEVERITIES.MEDIUM,
        description: '',
        ownerUserId: '',
      });
      setAnnouncement(intl.formatMessage({ id: 'impediments.create.success' }));
    } catch (error: unknown) {
      setLocalError(intl.formatMessage({ id: resolveImpedimentErrorId(error) }));
    }
  };

  const handleOpenEdit = (impediment: Impediment): void => {
    setLocalError(null);
    setEditingImpediment(impediment);
    editForm.reset({
      category: impediment.category,
      severity: impediment.severity,
      description: impediment.description,
      ownerUserId: impediment.ownerUserId ?? '',
    });
  };

  const handleEditSubmit = async (values: ImpedimentFormValues): Promise<void> => {
    if (editingImpediment === null) {
      return;
    }
    setLocalError(null);
    setAnnouncement('');
    try {
      const trimmedOwner = values.ownerUserId.trim();
      await onUpdateImpediment(editingImpediment.id, {
        category: values.category,
        severity: values.severity,
        description: values.description.trim(),
        ownerUserId: trimmedOwner.length > 0 ? asUserId(trimmedOwner, 'ownerUserId') : null,
      });
      setEditingImpediment(null);
      setAnnouncement(intl.formatMessage({ id: 'impediments.edit.saveSuccess' }));
    } catch (error: unknown) {
      setLocalError(intl.formatMessage({ id: resolveImpedimentErrorId(error) }));
    }
  };

  const handleQuickTransition = async (
    impedimentId: ImpedimentId,
    targetStatus: typeof IMPEDIMENT_STATUSES.OPEN | typeof IMPEDIMENT_STATUSES.IN_RESOLUTION,
  ): Promise<void> => {
    setLocalError(null);
    setAnnouncement('');
    try {
      await onTransitionImpediment(impedimentId, { targetStatus });
      setAnnouncement(
        intl.formatMessage(
          { id: 'impediments.transition.success' },
          { status: intl.formatMessage({ id: STATUS_LABEL_IDS[targetStatus] }) },
        ),
      );
    } catch (error: unknown) {
      setLocalError(intl.formatMessage({ id: resolveImpedimentErrorId(error) }));
    }
  };

  const handleOpenTerminalDialog = (
    impediment: Impediment,
    targetStatus: typeof IMPEDIMENT_STATUSES.RESOLVED | typeof IMPEDIMENT_STATUSES.CANCELLED,
  ): void => {
    setLocalError(null);
    setResolutionNote('');
    setResolutionNoteError(null);
    setPendingTransition({ impediment, targetStatus });
  };

  const handleConfirmTerminalTransition = async (): Promise<void> => {
    if (pendingTransition === null) {
      return;
    }
    const trimmedNote = resolutionNote.trim();
    if (trimmedNote.length > 2000) {
      setResolutionNoteError(intl.formatMessage({ id: 'validation.maxLength' }, { max: 2000 }));
      return;
    }

    setLocalError(null);
    setResolutionNoteError(null);
    setAnnouncement('');
    try {
      await onTransitionImpediment(pendingTransition.impediment.id, {
        targetStatus: pendingTransition.targetStatus,
        ...(trimmedNote.length > 0 ? { resolutionNote: trimmedNote } : {}),
      });
      const statusLabel = intl.formatMessage({
        id: STATUS_LABEL_IDS[pendingTransition.targetStatus],
      });
      setPendingTransition(null);
      setResolutionNote('');
      setAnnouncement(
        intl.formatMessage({ id: 'impediments.transition.success' }, { status: statusLabel }),
      );
    } catch (error: unknown) {
      setLocalError(intl.formatMessage({ id: resolveImpedimentErrorId(error) }));
      setPendingTransition(null);
    }
  };

  if (!canViewImpediments) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'impediments.title' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              {intl.formatMessage({ id: 'impediments.noPermission' })}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const editCategoryField = editForm.register('category');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: 'impediments.title' })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: 'impediments.description' })}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {localError !== null ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{localError}</AlertDescription>
          </Alert>
        ) : null}

        {hasBlockingImpediments ? (
          <Alert>
            <AlertDescription>
              {intl.formatMessage({ id: 'impediments.transition.noAutoCompleteHint' })}
            </AlertDescription>
          </Alert>
        ) : null}

        {canOpenImpediment ? (
          <form
            onSubmit={createForm.handleSubmit(handleCreateSubmit)}
            noValidate
            className="space-y-4 rounded-lg border bg-muted/30 p-4"
          >
            <h3 className="text-base font-semibold text-foreground">
              {intl.formatMessage({ id: 'impediments.create.title' })}
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="impediment-create-category" required>
                  {intl.formatMessage({ id: 'impediments.create.categoryLabel' })}
                </Label>
                <select
                  id="impediment-create-category"
                  className={SELECT_CLASS_NAME}
                  disabled={isMutating}
                  {...createForm.register('category')}
                >
                  {CATEGORY_ORDER.map((category) => (
                    <option key={category} value={category}>
                      {intl.formatMessage({ id: CATEGORY_LABEL_IDS[category] })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="impediment-create-severity" required>
                  {intl.formatMessage({ id: 'impediments.create.severityLabel' })}
                </Label>
                <select
                  id="impediment-create-severity"
                  className={SELECT_CLASS_NAME}
                  disabled={isMutating}
                  {...createForm.register('severity')}
                >
                  {SEVERITY_ORDER.map((severity) => (
                    <option key={severity} value={severity}>
                      {intl.formatMessage({ id: SEVERITY_LABEL_IDS[severity] })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="impediment-create-description" required>
                {intl.formatMessage({ id: 'impediments.create.descriptionLabel' })}
              </Label>
              <textarea
                id="impediment-create-description"
                className={TEXTAREA_CLASS_NAME}
                placeholder={intl.formatMessage({
                  id: 'impediments.create.descriptionPlaceholder',
                })}
                aria-invalid={createForm.formState.errors.description !== undefined}
                aria-describedby={
                  createForm.formState.errors.description !== undefined
                    ? 'impediment-create-description-error'
                    : undefined
                }
                disabled={isMutating}
                {...createForm.register('description')}
              />
              {createForm.formState.errors.description !== undefined ? (
                <p
                  id="impediment-create-description-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {resolveValidationMessage(createForm.formState.errors.description.message, intl)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="impediment-create-owner">
                  {intl.formatMessage({ id: 'impediments.create.ownerLabel' })}
                </Label>
                <select
                  id="impediment-create-owner"
                  className={SELECT_CLASS_NAME}
                  disabled={isMutating}
                  {...createForm.register('ownerUserId')}
                >
                  <option value="">
                    {intl.formatMessage({ id: 'impediments.create.unassignedOption' })}
                  </option>
                  {ownerOptions.map((option) => (
                    <option key={option.userId} value={option.userId}>
                      {option.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" className="min-h-11 shrink-0" disabled={isMutating}>
                <IconAlertOctagon className="mr-2 h-4 w-4" aria-hidden="true" />
                {intl.formatMessage({ id: 'impediments.create.submit' })}
              </Button>
            </div>
          </form>
        ) : null}

        {sortedImpediments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'impediments.empty' })}
          </p>
        ) : (
          <ul className="space-y-3" aria-label={intl.formatMessage({ id: 'impediments.title' })}>
            {sortedImpediments.map((impediment) => {
              const blocking = isImpedimentBlocking(impediment);
              const canEdit = canCreateImpediment && !isReadOnly && blocking;
              const canResolve =
                (canResolveByImpedimentId[impediment.id] ?? false) && !isReadOnly && blocking;
              const ownerName =
                impediment.ownerUserId !== undefined
                  ? (usersById.get(impediment.ownerUserId)?.displayName ?? unknownUserLabel)
                  : intl.formatMessage({ id: 'impediments.create.unassignedOption' });

              return (
                <li key={impediment.id} className="space-y-3 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_BADGE_VARIANTS[impediment.status]}>
                      {intl.formatMessage({ id: STATUS_LABEL_IDS[impediment.status] })}
                    </Badge>
                    <Badge variant={SEVERITY_BADGE_VARIANTS[impediment.severity]}>
                      {intl.formatMessage({ id: SEVERITY_LABEL_IDS[impediment.severity] })}
                    </Badge>
                    <Badge variant="outline">
                      {intl.formatMessage({ id: CATEGORY_LABEL_IDS[impediment.category] })}
                    </Badge>
                    {blocking ? (
                      <Badge variant="destructive">
                        {intl.formatMessage({ id: 'impediments.blockingBadge' })}
                      </Badge>
                    ) : null}
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {impediment.description}
                  </p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {intl.formatMessage({ id: 'impediments.ownerLabel' }, { name: ownerName })}
                    </span>
                    <span>
                      {intl.formatMessage(
                        { id: 'impediments.openedAtLabel' },
                        {
                          date: intl.formatDate(impediment.openedAt, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }),
                        },
                      )}
                    </span>
                    {impediment.resolvedAt !== undefined ? (
                      <span>
                        {intl.formatMessage(
                          { id: 'impediments.resolvedAtLabel' },
                          {
                            date: intl.formatDate(impediment.resolvedAt, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }),
                          },
                        )}
                      </span>
                    ) : null}
                  </div>

                  {impediment.resolutionNote !== undefined ? (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground">
                      {intl.formatMessage(
                        { id: 'impediments.resolutionNoteDisplay' },
                        { note: impediment.resolutionNote },
                      )}
                    </p>
                  ) : null}

                  {canEdit || canResolve ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={isMutating}
                          onClick={() => handleOpenEdit(impediment)}
                        >
                          <IconEdit className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          {intl.formatMessage({ id: 'impediments.edit.action' })}
                        </Button>
                      ) : null}

                      {canEdit && impediment.status === IMPEDIMENT_STATUSES.OPEN ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={isMutating}
                          onClick={() => {
                            void handleQuickTransition(
                              impediment.id,
                              IMPEDIMENT_STATUSES.IN_RESOLUTION,
                            );
                          }}
                        >
                          <IconPlayerPlay className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          {intl.formatMessage({
                            id: 'impediments.transition.startResolutionAction',
                          })}
                        </Button>
                      ) : null}

                      {canEdit && impediment.status === IMPEDIMENT_STATUSES.IN_RESOLUTION ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={isMutating}
                          onClick={() => {
                            void handleQuickTransition(impediment.id, IMPEDIMENT_STATUSES.OPEN);
                          }}
                        >
                          <IconRefresh className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          {intl.formatMessage({ id: 'impediments.transition.reopenAction' })}
                        </Button>
                      ) : null}

                      {canResolve ? (
                        <>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            className="min-h-11"
                            disabled={isMutating}
                            onClick={() =>
                              handleOpenTerminalDialog(impediment, IMPEDIMENT_STATUSES.RESOLVED)
                            }
                          >
                            <IconCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            {intl.formatMessage({ id: 'impediments.transition.resolveAction' })}
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11 border-destructive/40 text-destructive hover:bg-destructive/10"
                            disabled={isMutating}
                            onClick={() =>
                              handleOpenTerminalDialog(impediment, IMPEDIMENT_STATUSES.CANCELLED)
                            }
                          >
                            <IconX className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            {intl.formatMessage({ id: 'impediments.transition.cancelAction' })}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <ModalDialog
          isOpen={editingImpediment !== null}
          titleId="edit-impediment-dialog-title"
          title={intl.formatMessage({ id: 'impediments.edit.action' })}
          closeLabel={intl.formatMessage({ id: 'common.close' })}
          isBusy={isMutating}
          initialFocusRef={editCategorySelectRef}
          onClose={() => setEditingImpediment(null)}
        >
          <form onSubmit={editForm.handleSubmit(handleEditSubmit)} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="impediment-edit-category" required>
                {intl.formatMessage({ id: 'impediments.create.categoryLabel' })}
              </Label>
              <select
                id="impediment-edit-category"
                className={SELECT_CLASS_NAME}
                disabled={isMutating}
                {...editCategoryField}
                ref={(node) => {
                  editCategoryField.ref(node);
                  editCategorySelectRef.current = node;
                }}
              >
                {CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {intl.formatMessage({ id: CATEGORY_LABEL_IDS[category] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="impediment-edit-severity" required>
                {intl.formatMessage({ id: 'impediments.create.severityLabel' })}
              </Label>
              <select
                id="impediment-edit-severity"
                className={SELECT_CLASS_NAME}
                disabled={isMutating}
                {...editForm.register('severity')}
              >
                {SEVERITY_ORDER.map((severity) => (
                  <option key={severity} value={severity}>
                    {intl.formatMessage({ id: SEVERITY_LABEL_IDS[severity] })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="impediment-edit-description" required>
                {intl.formatMessage({ id: 'impediments.create.descriptionLabel' })}
              </Label>
              <textarea
                id="impediment-edit-description"
                className={TEXTAREA_CLASS_NAME}
                aria-invalid={editForm.formState.errors.description !== undefined}
                aria-describedby={
                  editForm.formState.errors.description !== undefined
                    ? 'impediment-edit-description-error'
                    : undefined
                }
                disabled={isMutating}
                {...editForm.register('description')}
              />
              {editForm.formState.errors.description !== undefined ? (
                <p
                  id="impediment-edit-description-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {resolveValidationMessage(editForm.formState.errors.description.message, intl)}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="impediment-edit-owner">
                {intl.formatMessage({ id: 'impediments.create.ownerLabel' })}
              </Label>
              <select
                id="impediment-edit-owner"
                className={SELECT_CLASS_NAME}
                disabled={isMutating}
                {...editForm.register('ownerUserId')}
              >
                <option value="">
                  {intl.formatMessage({ id: 'impediments.create.unassignedOption' })}
                </option>
                {ownerOptions.map((option) => (
                  <option key={option.userId} value={option.userId}>
                    {option.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={isMutating}
                onClick={() => setEditingImpediment(null)}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </Button>
              <Button type="submit" className="min-h-11" disabled={isMutating}>
                {intl.formatMessage({ id: 'impediments.edit.saveAction' })}
              </Button>
            </div>
          </form>
        </ModalDialog>

        <ModalDialog
          isOpen={pendingTransition !== null}
          titleId="transition-impediment-dialog-title"
          title={intl.formatMessage({ id: 'impediments.transition.confirmTitle' })}
          descriptionId="transition-impediment-dialog-description"
          description={intl.formatMessage({ id: 'impediments.transition.noAutoCompleteHint' })}
          closeLabel={intl.formatMessage({ id: 'common.close' })}
          isBusy={isMutating}
          initialFocusRef={transitionNoteRef}
          onClose={() => setPendingTransition(null)}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="impediment-resolution-note">
                {intl.formatMessage({ id: 'impediments.transition.resolutionNoteLabel' })}
              </Label>
              <textarea
                ref={transitionNoteRef}
                id="impediment-resolution-note"
                className={TEXTAREA_CLASS_NAME}
                value={resolutionNote}
                placeholder={intl.formatMessage({
                  id: 'impediments.transition.resolutionNotePlaceholder',
                })}
                aria-invalid={resolutionNoteError !== null}
                aria-describedby={
                  resolutionNoteError !== null ? 'impediment-resolution-note-error' : undefined
                }
                disabled={isMutating}
                onChange={(event) => setResolutionNote(event.target.value)}
              />
              {resolutionNoteError !== null ? (
                <p
                  id="impediment-resolution-note-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {resolutionNoteError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={isMutating}
                onClick={() => setPendingTransition(null)}
              >
                {intl.formatMessage({ id: 'common.cancel' })}
              </Button>
              <Button
                type="button"
                variant={
                  pendingTransition?.targetStatus === IMPEDIMENT_STATUSES.CANCELLED
                    ? 'destructive'
                    : 'default'
                }
                className="min-h-11"
                disabled={isMutating}
                onClick={() => {
                  void handleConfirmTerminalTransition();
                }}
              >
                {intl.formatMessage({
                  id:
                    pendingTransition?.targetStatus === IMPEDIMENT_STATUSES.CANCELLED
                      ? 'impediments.transition.cancelAction'
                      : 'impediments.transition.resolveAction',
                })}
              </Button>
            </div>
          </div>
        </ModalDialog>
      </CardContent>
    </Card>
  );
}
