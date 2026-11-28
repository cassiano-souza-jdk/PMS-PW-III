import {
  IconArrowDown,
  IconArrowUp,
  IconDeviceFloppy,
  IconEdit,
  IconRestore,
  IconX,
} from '@tabler/icons-react';
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
} from '@/shared/ui';
import type { AnalyticsDashboardDraftState } from '../application/contracts';
import { resolveAnalyticsWidgetLabel } from './analytics-ui-helpers';

export interface AnalyticsDashboardCustomizerProps {
  readonly draftState: AnalyticsDashboardDraftState;
  readonly isBusy: boolean;
  readonly isDemoIsolated: boolean;
  readonly onStartEditing: () => void;
  readonly onToggleWidgetVisibility: (widgetKey: string) => void;
  readonly onMoveWidget: (index: number, direction: 'up' | 'down') => void;
  readonly onSave: () => Promise<void>;
  readonly onDiscard: () => void;
  readonly onRestoreDefault: () => Promise<void>;
}

export function AnalyticsDashboardCustomizer({
  draftState,
  isBusy,
  isDemoIsolated,
  onStartEditing,
  onToggleWidgetVisibility,
  onMoveWidget,
  onSave,
  onDiscard,
  onRestoreDefault,
}: AnalyticsDashboardCustomizerProps) {
  const intl = useIntl();

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>
                {intl.formatMessage({ id: 'analytics.dashboard.customizeTitle' })}
              </CardTitle>
              <Badge variant={draftState.isDefault ? 'secondary' : 'default'}>
                {intl.formatMessage({
                  id: draftState.isDefault
                    ? 'analytics.dashboard.defaultBadge'
                    : 'analytics.dashboard.customBadge',
                })}
              </Badge>
              {isDemoIsolated ? (
                <Badge variant="demo">{intl.formatMessage({ id: 'demoBanner.badge' })}</Badge>
              ) : null}
            </div>
            <CardDescription>
              {intl.formatMessage({ id: 'analytics.dashboard.customizeDescription' })}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!draftState.isEditing ? (
              <Button
                type="button"
                variant="outline"
                onClick={onStartEditing}
                disabled={isBusy || draftState.isSaving}
                className="min-h-[44px] gap-2"
              >
                <IconEdit className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'analytics.dashboard.editAction' })}</span>
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={isBusy || draftState.isSaving || !draftState.isDirty}
                  className="min-h-[44px] gap-2"
                >
                  <IconDeviceFloppy className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'analytics.dashboard.saveAction' })}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onDiscard}
                  disabled={isBusy || draftState.isSaving}
                  className="min-h-[44px] gap-2"
                >
                  <IconX className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'analytics.dashboard.discardAction' })}</span>
                </Button>
              </>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => void onRestoreDefault()}
              disabled={
                isBusy || draftState.isSaving || (draftState.isDefault && !draftState.isDirty)
              }
              className="min-h-[44px] gap-2"
            >
              <IconRestore className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'analytics.dashboard.restoreDefaultAction' })}</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      {draftState.isEditing ? (
        <CardContent className="space-y-4">
          {draftState.isDirty ? (
            <Alert variant="warning" role="status">
              <AlertDescription>
                {intl.formatMessage({ id: 'analytics.dashboard.unsavedChangesWarning' })}
              </AlertDescription>
            </Alert>
          ) : null}

          <ul className="space-y-2">
            {draftState.widgets.map((widget, index) => {
              const label = resolveAnalyticsWidgetLabel(widget.widgetKey, intl);
              const checkboxId = `dashboard-widget-visible-${widget.widgetKey}`;
              return (
                <li
                  key={widget.widgetKey}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <label
                    htmlFor={checkboxId}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground"
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={widget.visible}
                      disabled={isBusy || draftState.isSaving}
                      onChange={() => onToggleWidgetVisibility(widget.widgetKey)}
                      className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <span>
                      {intl.formatMessage(
                        { id: 'analytics.dashboard.widgetVisibleLabel' },
                        { name: label },
                      )}
                    </span>
                  </label>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy || draftState.isSaving || index === 0}
                      aria-label={intl.formatMessage(
                        { id: 'analytics.dashboard.moveUpAction' },
                        { name: label },
                      )}
                      onClick={() => onMoveWidget(index, 'up')}
                      className="min-h-[44px] min-w-[44px]"
                    >
                      <IconArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        isBusy || draftState.isSaving || index === draftState.widgets.length - 1
                      }
                      aria-label={intl.formatMessage(
                        { id: 'analytics.dashboard.moveDownAction' },
                        { name: label },
                      )}
                      onClick={() => onMoveWidget(index, 'down')}
                      className="min-h-[44px] min-w-[44px]"
                    >
                      <IconArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
