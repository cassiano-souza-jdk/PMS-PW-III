import { zodResolver } from '@hookform/resolvers/zod';
import { IconLink, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import { isAppError } from '@/shared/errors';
import { getErrorMessageId, type MessageId } from '@/shared/i18n';
import { TASK_STATUSES, asTaskId, isUuid, type TaskId, type TaskStatus } from '@/shared/kernel';
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
import type {
  AddTaskDependencyInput,
  TaskDependencyListItem,
} from '../application/services/dependency-service';
import type { TaskDependencyId } from '../application/contracts';

export interface DependencyPanelItem extends TaskDependencyListItem {
  readonly relatedTaskAccessible?: boolean;
}

export interface DependencyTargetOption {
  readonly id: TaskId;
  readonly title: string;
  readonly status?: TaskStatus;
}

export interface TaskDependenciesPanelProps {
  readonly taskId: TaskId;
  readonly taskStatus: TaskStatus;
  readonly dependencies: readonly DependencyPanelItem[];
  readonly candidateTargets: readonly DependencyTargetOption[];
  readonly canViewDependencies: boolean;
  readonly canManageDependencies: boolean;
  readonly isReadOnly: boolean;
  readonly isMutating?: boolean;
  readonly onAddDependency: (input: AddTaskDependencyInput) => Promise<void>;
  readonly onRemoveDependency: (dependencyId: TaskDependencyId) => Promise<void>;
}

const TASK_STATUS_LABEL_IDS: Readonly<Record<TaskStatus, MessageId>> = {
  TODO: 'tasks.status.TODO',
  IN_PROGRESS: 'tasks.status.IN_PROGRESS',
  PAUSED: 'tasks.status.PAUSED',
  BLOCKED: 'tasks.status.BLOCKED',
  DONE: 'tasks.status.DONE',
  CANCELLED: 'tasks.status.CANCELLED',
};

const addDependencyFormSchema = z.object({
  dependsOnTaskId: z
    .string()
    .trim()
    .refine((value) => isUuid(value), 'validation.required'),
  required: z.boolean(),
});

type AddDependencyFormValues = z.infer<typeof addDependencyFormSchema>;

const SELECT_CLASS_NAME =
  'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

function resolveGenericErrorId(error: unknown): MessageId {
  return isAppError(error) ? getErrorMessageId(error.code) : 'errors.UNEXPECTED_ERROR';
}

function resolveDependencyErrorId(error: unknown): MessageId {
  if (isAppError(error)) {
    const normalizedMessage = error.message.toLowerCase();
    if (
      normalizedMessage.includes('already exists') ||
      error.details?.['dependencyId'] !== undefined
    ) {
      return 'dependencies.add.duplicateError';
    }
    if (
      normalizedMessage.includes('cycle') ||
      normalizedMessage.includes('cyclic') ||
      normalizedMessage.includes('itself')
    ) {
      return 'dependencies.add.cycleError';
    }
  }
  return resolveGenericErrorId(error);
}

export function TaskDependenciesPanel({
  taskId,
  taskStatus,
  dependencies,
  candidateTargets,
  canViewDependencies,
  canManageDependencies,
  isReadOnly,
  isMutating = false,
  onAddDependency,
  onRemoveDependency,
}: TaskDependenciesPanelProps) {
  const intl = useIntl();
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [removingDependency, setRemovingDependency] = useState<DependencyPanelItem | null>(null);

  const form = useForm<AddDependencyFormValues>({
    resolver: zodResolver(addDependencyFormSchema),
    defaultValues: {
      dependsOnTaskId: '',
      required: true,
    },
  });

  const selectableTargets = useMemo(
    () =>
      candidateTargets.filter(
        (candidate) => candidate.id !== taskId && candidate.status !== TASK_STATUSES.CANCELLED,
      ),
    [candidateTargets, taskId],
  );

  const canModifyDependencies =
    canManageDependencies && !isReadOnly && taskStatus !== TASK_STATUSES.CANCELLED;

  const handleAddSubmit = async (values: AddDependencyFormValues): Promise<void> => {
    setLocalError(null);
    setAnnouncement('');
    try {
      await onAddDependency({
        dependsOnTaskId: asTaskId(values.dependsOnTaskId, 'dependsOnTaskId'),
        required: values.required,
      });
      form.reset({
        dependsOnTaskId: '',
        required: true,
      });
      setAnnouncement(intl.formatMessage({ id: 'dependencies.add.success' }));
    } catch (error: unknown) {
      setLocalError(intl.formatMessage({ id: resolveDependencyErrorId(error) }));
    }
  };

  const handleConfirmRemove = async (): Promise<void> => {
    if (removingDependency === null) {
      return;
    }
    setLocalError(null);
    setAnnouncement('');
    try {
      await onRemoveDependency(removingDependency.id);
      setRemovingDependency(null);
      setAnnouncement(intl.formatMessage({ id: 'dependencies.remove.success' }));
    } catch (error: unknown) {
      setLocalError(intl.formatMessage({ id: resolveGenericErrorId(error) }));
      setRemovingDependency(null);
    }
  };

  if (!canViewDependencies) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'dependencies.title' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              {intl.formatMessage({ id: 'dependencies.noPermission' })}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: 'dependencies.title' })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: 'dependencies.description' })}</CardDescription>
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

        {canModifyDependencies ? (
          <form
            onSubmit={form.handleSubmit(handleAddSubmit)}
            noValidate
            className="space-y-4 rounded-lg border bg-muted/30 p-4"
          >
            <h3 className="text-base font-semibold text-foreground">
              {intl.formatMessage({ id: 'dependencies.add.title' })}
            </h3>

            <div className="space-y-1.5">
              <Label htmlFor="dependency-target-select" required>
                {intl.formatMessage({ id: 'dependencies.add.targetLabel' })}
              </Label>
              <select
                id="dependency-target-select"
                className={SELECT_CLASS_NAME}
                aria-invalid={form.formState.errors.dependsOnTaskId !== undefined}
                aria-describedby={
                  form.formState.errors.dependsOnTaskId !== undefined
                    ? 'dependency-target-error'
                    : undefined
                }
                disabled={isMutating}
                {...form.register('dependsOnTaskId')}
              >
                <option value="">
                  {intl.formatMessage({ id: 'dependencies.add.targetPlaceholder' })}
                </option>
                {selectableTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.title}
                  </option>
                ))}
              </select>
              {form.formState.errors.dependsOnTaskId !== undefined ? (
                <p
                  id="dependency-target-error"
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  {intl.formatMessage({ id: 'validation.required' })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label
                htmlFor="dependency-required-checkbox"
                className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <input
                  id="dependency-required-checkbox"
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  disabled={isMutating}
                  {...form.register('required')}
                />
                <span>{intl.formatMessage({ id: 'dependencies.add.requiredLabel' })}</span>
              </label>

              <Button type="submit" disabled={isMutating}>
                <IconLink className="mr-2 h-4 w-4" aria-hidden="true" />
                {intl.formatMessage({ id: 'dependencies.add.submit' })}
              </Button>
            </div>
          </form>
        ) : null}

        {dependencies.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'dependencies.empty' })}
          </p>
        ) : (
          <ul className="space-y-3" aria-label={intl.formatMessage({ id: 'dependencies.title' })}>
            {dependencies.map((dependency) => {
              const isRelatedTaskAccessible = dependency.relatedTaskAccessible !== false;
              const directionLabel = intl.formatMessage({
                id:
                  dependency.direction === 'OUTGOING'
                    ? 'dependencies.direction.OUTGOING'
                    : 'dependencies.direction.INCOMING',
              });

              return (
                <li
                  key={dependency.id}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{directionLabel}</Badge>
                      <Badge variant={dependency.required ? 'default' : 'secondary'}>
                        {intl.formatMessage({
                          id: dependency.required
                            ? 'dependencies.requiredBadge'
                            : 'dependencies.optionalBadge',
                        })}
                      </Badge>
                      {isRelatedTaskAccessible ? (
                        <Badge variant="outline">
                          {intl.formatMessage(
                            { id: 'dependencies.taskStatusLabel' },
                            {
                              status: intl.formatMessage({
                                id: TASK_STATUS_LABEL_IDS[dependency.relatedTask.status],
                              }),
                            },
                          )}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="text-sm font-medium text-foreground">
                      {isRelatedTaskAccessible
                        ? dependency.relatedTask.title
                        : intl.formatMessage({ id: 'dependencies.outOfScopeLabel' })}
                    </p>
                  </div>

                  {canModifyDependencies ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={isMutating}
                      onClick={() => setRemovingDependency(dependency)}
                    >
                      <IconTrash className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {intl.formatMessage({ id: 'dependencies.remove.action' })}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <ModalDialog
          isOpen={removingDependency !== null}
          titleId="remove-dependency-dialog-title"
          title={intl.formatMessage({ id: 'dependencies.remove.confirmTitle' })}
          descriptionId="remove-dependency-dialog-description"
          description={intl.formatMessage({ id: 'dependencies.remove.confirmDescription' })}
          closeLabel={intl.formatMessage({ id: 'common.close' })}
          isBusy={isMutating}
          onClose={() => setRemovingDependency(null)}
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isMutating}
              onClick={() => setRemovingDependency(null)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isMutating}
              onClick={() => {
                void handleConfirmRemove();
              }}
            >
              {intl.formatMessage({ id: 'dependencies.remove.action' })}
            </Button>
          </div>
        </ModalDialog>
      </CardContent>
    </Card>
  );
}
