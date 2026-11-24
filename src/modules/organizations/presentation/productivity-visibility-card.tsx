import { IconCheck, IconShieldLock } from '@tabler/icons-react';
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

export interface ProductivityVisibilityFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface ProductivityVisibilityCardProps {
  readonly canManageProductivityVisibility: boolean;
  readonly allowManagerViewIndividualProductivity: boolean;
  readonly isLoading: boolean;
  readonly feedback?: ProductivityVisibilityFeedback | null;
  readonly onSave: (input: {
    readonly allowManagerViewIndividualProductivity: boolean;
    readonly justification?: string;
  }) => Promise<void>;
}

export function ProductivityVisibilityCard({
  canManageProductivityVisibility,
  allowManagerViewIndividualProductivity,
  isLoading,
  feedback = null,
  onSave,
}: ProductivityVisibilityCardProps) {
  const intl = useIntl();
  const [draftAllowView, setDraftAllowView] = useState<boolean | null>(null);
  const [justification, setJustification] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const allowView = draftAllowView ?? allowManagerViewIndividualProductivity;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const trimmed = justification.trim();
      await onSave({
        allowManagerViewIndividualProductivity: allowView,
        ...(trimmed.length > 0 ? { justification: trimmed } : {}),
      });
      setDraftAllowView(null);
      setJustification('');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="flex items-start gap-3">
          <IconShieldLock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <CardTitle>
              {intl.formatMessage({ id: 'settings.productivityVisibility.title' })}
            </CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'settings.productivityVisibility.description' })}
            </CardDescription>
          </div>
        </div>
        {canManageProductivityVisibility && !isLoading ? (
          <Badge variant={allowManagerViewIndividualProductivity ? 'default' : 'secondary'}>
            {intl.formatMessage({
              id: allowManagerViewIndividualProductivity
                ? 'settings.productivityVisibility.statusEnabled'
                : 'settings.productivityVisibility.statusDisabled',
            })}
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {feedback !== null ? (
          <Alert
            variant={feedback.type}
            role={feedback.type === 'destructive' ? 'alert' : 'status'}
          >
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        ) : null}

        {!canManageProductivityVisibility ? (
          <Alert variant="info">
            <AlertDescription>
              {intl.formatMessage({ id: 'settings.productivityVisibility.adminOnlyNotice' })}
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'app.loading' })}
          </p>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="settings-allow-manager-productivity"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
              >
                <input
                  id="settings-allow-manager-productivity"
                  type="checkbox"
                  checked={allowView}
                  disabled={isSaving}
                  onChange={(event) => setDraftAllowView(event.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span>
                  {intl.formatMessage({ id: 'settings.productivityVisibility.toggleLabel' })}
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: 'settings.productivityVisibility.defaultDenyHint' })}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-productivity-justification">
                {intl.formatMessage({ id: 'settings.productivityVisibility.justificationLabel' })}
              </Label>
              <Input
                id="settings-productivity-justification"
                type="text"
                maxLength={500}
                value={justification}
                disabled={isSaving}
                onChange={(event) => setJustification(event.target.value)}
                placeholder={intl.formatMessage({
                  id: 'settings.productivityVisibility.justificationPlaceholder',
                })}
              />
            </div>

            <Button type="submit" className="min-h-[44px]" disabled={isSaving}>
              <IconCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isSaving
                    ? 'auth.common.submitting'
                    : 'settings.productivityVisibility.saveAction',
                })}
              </span>
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
