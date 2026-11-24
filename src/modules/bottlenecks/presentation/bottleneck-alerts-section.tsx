import { IconAlertTriangle, IconCheck, IconEyeCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import type { MessageId } from '@/shared/i18n';
import type { BottleneckSeverity, ProjectId } from '@/shared/kernel';
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
  BOTTLENECK_ALERT_STATUSES,
  BOTTLENECK_INDICATORS,
  type BottleneckAlert,
  type BottleneckAlertId,
  type BottleneckAlertStatus,
  type BottleneckIndicator,
} from '../application/contracts';

const INDICATOR_LABEL_ID: Readonly<Record<BottleneckIndicator, MessageId>> = {
  WIP: 'bottlenecks.indicator.WIP',
  INACTIVITY: 'bottlenecks.indicator.INACTIVITY',
  OVERDUE: 'bottlenecks.indicator.OVERDUE',
  IMPEDIMENTS: 'bottlenecks.indicator.IMPEDIMENTS',
  OVERLOAD: 'bottlenecks.indicator.OVERLOAD',
};

const SEVERITY_LABEL_ID: Readonly<Record<BottleneckSeverity, MessageId>> = {
  LOW: 'bottlenecks.severity.LOW',
  MODERATE: 'bottlenecks.severity.MODERATE',
  HIGH: 'bottlenecks.severity.HIGH',
  CRITICAL: 'bottlenecks.severity.CRITICAL',
};

const ALERT_STATUS_LABEL_ID: Readonly<Record<BottleneckAlertStatus, MessageId>> = {
  OPEN: 'bottlenecks.status.OPEN',
  ACKNOWLEDGED: 'bottlenecks.status.ACKNOWLEDGED',
  RESOLVED: 'bottlenecks.status.RESOLVED',
};

const INDICATOR_OPTIONS: readonly BottleneckIndicator[] = [
  BOTTLENECK_INDICATORS.WIP,
  BOTTLENECK_INDICATORS.INACTIVITY,
  BOTTLENECK_INDICATORS.OVERDUE,
  BOTTLENECK_INDICATORS.IMPEDIMENTS,
  BOTTLENECK_INDICATORS.OVERLOAD,
];

const STATUS_OPTIONS: readonly BottleneckAlertStatus[] = [
  BOTTLENECK_ALERT_STATUSES.OPEN,
  BOTTLENECK_ALERT_STATUSES.ACKNOWLEDGED,
  BOTTLENECK_ALERT_STATUSES.RESOLVED,
];

interface PendingAlertAction {
  readonly kind: 'ACKNOWLEDGE' | 'RESOLVE';
  readonly alert: BottleneckAlert;
}

export interface BottleneckAlertsSectionProps {
  readonly alerts: readonly BottleneckAlert[];
  readonly projectNameById: ReadonlyMap<ProjectId, string>;
  readonly indicatorFilter: string;
  readonly statusFilter: string;
  readonly includeResolved: boolean;
  readonly isBusy: boolean;
  readonly canManageAlert: (alert: BottleneckAlert) => boolean;
  readonly onChangeIndicatorFilter: (indicator: string) => void;
  readonly onChangeStatusFilter: (status: string) => void;
  readonly onChangeIncludeResolved: (includeResolved: boolean) => void;
  readonly onAcknowledgeAlert: (alertId: BottleneckAlertId, note?: string) => Promise<void>;
  readonly onResolveAlert: (alertId: BottleneckAlertId, note?: string) => Promise<void>;
}

export function BottleneckAlertsSection({
  alerts,
  projectNameById,
  indicatorFilter,
  statusFilter,
  includeResolved,
  isBusy,
  canManageAlert,
  onChangeIndicatorFilter,
  onChangeStatusFilter,
  onChangeIncludeResolved,
  onAcknowledgeAlert,
  onResolveAlert,
}: BottleneckAlertsSectionProps) {
  const intl = useIntl();
  const [pendingAction, setPendingAction] = useState<PendingAlertAction | null>(null);
  const [note, setNote] = useState('');

  const filteredAlerts = alerts.filter((alert) => {
    if (indicatorFilter !== '' && alert.indicator !== indicatorFilter) {
      return false;
    }
    if (statusFilter !== '' && alert.status !== statusFilter) {
      return false;
    }
    if (!includeResolved && alert.status === BOTTLENECK_ALERT_STATUSES.RESOLVED) {
      return false;
    }
    return true;
  });

  const handleCloseModal = () => {
    if (!isBusy) {
      setPendingAction(null);
      setNote('');
    }
  };

  const handleConfirmAction = async () => {
    if (pendingAction === null) {
      return;
    }
    const trimmedNote = note.trim() === '' ? undefined : note.trim();
    if (pendingAction.kind === 'ACKNOWLEDGE') {
      await onAcknowledgeAlert(pendingAction.alert.id, trimmedNote);
    } else {
      await onResolveAlert(pendingAction.alert.id, trimmedNote);
    }
    setPendingAction(null);
    setNote('');
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <IconAlertTriangle className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>{intl.formatMessage({ id: 'bottlenecks.alerts.title' })}</CardTitle>
        </div>
        <CardDescription>
          {intl.formatMessage({ id: 'bottlenecks.status.acknowledgedNotResolvedHint' })}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="bottleneck-indicator-filter">
              {intl.formatMessage({ id: 'bottlenecks.alerts.indicatorFilterLabel' })}
            </Label>
            <select
              id="bottleneck-indicator-filter"
              value={indicatorFilter}
              disabled={isBusy}
              onChange={(event) => onChangeIndicatorFilter(event.target.value)}
              className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">
                {intl.formatMessage({ id: 'bottlenecks.alerts.allIndicators' })}
              </option>
              {INDICATOR_OPTIONS.map((indicator) => (
                <option key={indicator} value={indicator}>
                  {intl.formatMessage({ id: INDICATOR_LABEL_ID[indicator] })}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bottleneck-status-filter">
              {intl.formatMessage({ id: 'bottlenecks.alerts.statusFilterLabel' })}
            </Label>
            <select
              id="bottleneck-status-filter"
              value={statusFilter}
              disabled={isBusy}
              onChange={(event) => onChangeStatusFilter(event.target.value)}
              className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">
                {intl.formatMessage({ id: 'bottlenecks.alerts.allStatuses' })}
              </option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {intl.formatMessage({ id: ALERT_STATUS_LABEL_ID[status] })}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label
              htmlFor="bottleneck-include-resolved"
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
            >
              <input
                id="bottleneck-include-resolved"
                type="checkbox"
                checked={includeResolved}
                disabled={isBusy}
                onChange={(event) => onChangeIncludeResolved(event.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>{intl.formatMessage({ id: 'bottlenecks.alerts.includeResolved' })}</span>
            </label>
          </div>
        </div>

        <Alert variant="info">
          <AlertDescription>
            {intl.formatMessage({ id: 'bottlenecks.status.acknowledgedNotResolvedHint' })}
          </AlertDescription>
        </Alert>

        {filteredAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'bottlenecks.alerts.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {filteredAlerts.map((alert) => {
              const projectName =
                alert.projectId !== undefined ? projectNameById.get(alert.projectId) : undefined;
              const isActionable = canManageAlert(alert);
              const isOpen = alert.status === BOTTLENECK_ALERT_STATUSES.OPEN;
              const isResolved = alert.status === BOTTLENECK_ALERT_STATUSES.RESOLVED;

              return (
                <li key={alert.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {intl.formatMessage({ id: INDICATOR_LABEL_ID[alert.indicator] })}
                      </Badge>
                      <Badge variant={alert.severity === 'CRITICAL' ? 'destructive' : 'secondary'}>
                        {intl.formatMessage({ id: SEVERITY_LABEL_ID[alert.severity] })}
                      </Badge>
                      <Badge
                        variant={isResolved ? 'secondary' : isOpen ? 'destructive' : 'outline'}
                      >
                        {intl.formatMessage({ id: ALERT_STATUS_LABEL_ID[alert.status] })}
                      </Badge>
                      {projectName !== undefined ? (
                        <Badge variant="outline">{projectName}</Badge>
                      ) : null}
                    </div>

                    <Badge variant="secondary">
                      {intl.formatMessage(
                        { id: 'bottlenecks.alerts.occurrenceCountLabel' },
                        { count: alert.occurrenceCount },
                      )}
                    </Badge>
                  </div>

                  <p className="text-sm font-medium text-foreground">{alert.summary}</p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {intl.formatMessage(
                        { id: 'bottlenecks.alerts.detectedAtLabel' },
                        {
                          date: intl.formatDate(new Date(alert.detectedAt), {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }),
                        },
                      )}
                    </span>
                    <span>
                      {intl.formatMessage(
                        { id: 'bottlenecks.alerts.lastSeenAtLabel' },
                        {
                          date: intl.formatDate(new Date(alert.lastSeenAt), {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }),
                        },
                      )}
                    </span>
                    {alert.acknowledgedAt !== undefined ? (
                      <span>
                        {intl.formatMessage(
                          { id: 'bottlenecks.alerts.acknowledgedAtLabel' },
                          {
                            date: intl.formatDate(new Date(alert.acknowledgedAt), {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }),
                          },
                        )}
                      </span>
                    ) : null}
                    {alert.resolvedAt !== undefined ? (
                      <span>
                        {intl.formatMessage(
                          { id: 'bottlenecks.alerts.resolvedAtLabel' },
                          {
                            date: intl.formatDate(new Date(alert.resolvedAt), {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }),
                          },
                        )}
                      </span>
                    ) : null}
                  </div>

                  {isActionable && !isResolved ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {isOpen ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px]"
                          disabled={isBusy}
                          onClick={() => setPendingAction({ kind: 'ACKNOWLEDGE', alert })}
                        >
                          <IconEyeCheck className="h-4 w-4" aria-hidden="true" />
                          <span>
                            {intl.formatMessage({ id: 'bottlenecks.actions.acknowledge' })}
                          </span>
                        </Button>
                      ) : null}

                      <Button
                        type="button"
                        variant="default"
                        className="min-h-[44px]"
                        disabled={isBusy}
                        onClick={() => setPendingAction({ kind: 'RESOLVE', alert })}
                      >
                        <IconCheck className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'bottlenecks.actions.resolve' })}</span>
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ModalDialog
        isOpen={pendingAction !== null}
        titleId="bottleneck-alert-dialog-title"
        title={intl.formatMessage({
          id:
            pendingAction?.kind === 'ACKNOWLEDGE'
              ? 'bottlenecks.actions.dialogTitleAcknowledge'
              : 'bottlenecks.actions.dialogTitleResolve',
        })}
        descriptionId="bottleneck-alert-dialog-desc"
        description={intl.formatMessage({
          id:
            pendingAction?.kind === 'ACKNOWLEDGE'
              ? 'bottlenecks.actions.dialogDescriptionAcknowledge'
              : 'bottlenecks.actions.dialogDescriptionResolve',
        })}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isBusy}
        onClose={handleCloseModal}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bottleneck-alert-action-note">
              {intl.formatMessage({ id: 'bottlenecks.actions.noteLabel' })}
            </Label>
            <textarea
              id="bottleneck-alert-action-note"
              rows={3}
              value={note}
              disabled={isBusy}
              onChange={(event) => setNote(event.target.value)}
              placeholder={intl.formatMessage({ id: 'bottlenecks.actions.notePlaceholder' })}
              className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isBusy}
              onClick={handleCloseModal}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              type="button"
              variant="default"
              className="min-h-[44px]"
              disabled={isBusy}
              onClick={() => void handleConfirmAction()}
            >
              {intl.formatMessage({
                id:
                  pendingAction?.kind === 'ACKNOWLEDGE'
                    ? 'bottlenecks.actions.confirmAcknowledge'
                    : 'bottlenecks.actions.confirmResolve',
              })}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </Card>
  );
}
