import { zodResolver } from '@hookform/resolvers/zod';
import { IconBuildingPlus, IconCheck, IconDoorExit } from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import type { OrganizationId, OrganizationRole } from '@/shared/kernel';
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
  CreateOrganizationInput,
  MyOrganizationSummary,
} from '../application/use-cases/organization-service';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createOrgSchema = z.object({
  name: z.string().trim().min(2, 'validation.displayNameMin').max(120),
  slug: z.string().trim().toLowerCase().min(2, 'validation.slugFormat').max(60).regex(SLUG_REGEX, {
    message: 'validation.slugFormat',
  }),
  description: z.string().trim().max(500).optional(),
});

export type CreateOrganizationFormValues = z.infer<typeof createOrgSchema>;

export interface OrganizationPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface OrganizationsPanelProps {
  readonly organizations: readonly MyOrganizationSummary[];
  readonly activeOrganizationId: OrganizationId | null;
  readonly isLoading: boolean;
  readonly feedback?: OrganizationPanelFeedback | null;
  readonly onSelectOrganization: (organizationId: OrganizationId) => void;
  readonly onCreateOrganization: (input: CreateOrganizationInput) => Promise<void>;
  readonly onLeaveOrganization: (organizationId: OrganizationId) => Promise<void>;
}

const ROLE_LABEL_ID_BY_CODE: Readonly<Record<OrganizationRole, MessageId>> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

function slugifyOrganizationName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function OrganizationsPanel({
  organizations,
  activeOrganizationId,
  isLoading,
  feedback = null,
  onSelectOrganization,
  onCreateOrganization,
  onLeaveOrganization,
}: OrganizationsPanelProps) {
  const intl = useIntl();
  const [slugTouchedManually, setSlugTouchedManually] = useState(false);
  const [confirmLeaveOrgId, setConfirmLeaveOrgId] = useState<OrganizationId | null>(null);
  const [leavingOrgId, setLeavingOrgId] = useState<OrganizationId | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationFormValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
    },
  });

  const nameField = register('name', {
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!slugTouchedManually) {
        setValue('slug', slugifyOrganizationName(event.target.value), { shouldValidate: false });
      }
    },
  });

  const slugField = register('slug', {
    onChange: () => {
      setSlugTouchedManually(true);
    },
  });

  const handleCreateSubmit = async (values: CreateOrganizationFormValues) => {
    await onCreateOrganization({
      name: values.name,
      slug: values.slug,
      ...(values.description !== undefined && values.description.trim().length > 0
        ? { description: values.description.trim() }
        : {}),
    });
    reset({ name: '', slug: '', description: '' });
    setSlugTouchedManually(false);
  };

  const handleConfirmLeave = async (orgId: OrganizationId) => {
    setLeavingOrgId(orgId);
    try {
      await onLeaveOrganization(orgId);
      setConfirmLeaveOrgId(null);
    } finally {
      setLeavingOrgId(null);
    }
  };

  return (
    <section aria-labelledby="organizations-heading" className="mx-auto w-full max-w-5xl space-y-8">
      <div className="space-y-2">
        <h1
          id="organizations-heading"
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          {intl.formatMessage({ id: 'organizations.title' })}
        </h1>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'organizations.subtitle' })}
        </p>
      </div>

      {feedback !== null ? (
        <Alert variant={feedback.type}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-4">
        {isLoading ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'orgSwitcher.loading' })}
          </p>
        ) : organizations.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{intl.formatMessage({ id: 'organizations.emptyTitle' })}</CardTitle>
              <CardDescription>
                {intl.formatMessage({ id: 'organizations.emptyDescription' })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <Link to="/demo">{intl.formatMessage({ id: 'auth.login.demoShortcut' })}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {organizations.map((org) => {
              const isSelected = org.id === activeOrganizationId;
              const isConfirmingLeave = confirmLeaveOrgId === org.id;
              const isLeaving = leavingOrgId === org.id;

              return (
                <Card
                  key={org.id}
                  className={isSelected ? 'border-primary ring-1 ring-primary/30' : undefined}
                >
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-lg">{org.name}</CardTitle>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isSelected ? (
                          <Badge variant="default">
                            <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{intl.formatMessage({ id: 'organizations.activeBadge' })}</span>
                          </Badge>
                        ) : null}
                        {org.isDemo ? (
                          <Badge variant="demo">
                            {intl.formatMessage({ id: 'organizations.demoBadge' })}
                          </Badge>
                        ) : null}
                        <Badge variant="secondary">
                          {intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[org.role] })}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription className="font-mono text-xs">{org.slug}</CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isSelected ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          onClick={() => onSelectOrganization(org.id)}
                        >
                          {intl.formatMessage({ id: 'organizations.selectAction' })}
                        </Button>
                      ) : (
                        <span className="text-xs font-semibold text-primary">
                          {intl.formatMessage({ id: 'organizations.selectedLabel' })}
                        </span>
                      )}

                      {!isConfirmingLeave ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmLeaveOrgId(org.id)}
                        >
                          <IconDoorExit className="h-4 w-4" aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'organizations.leave.action' })}</span>
                        </Button>
                      ) : null}
                    </div>

                    {isConfirmingLeave ? (
                      <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <p className="text-xs text-foreground">
                          {intl.formatMessage({ id: 'organizations.leave.hint' })}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={isLeaving}
                            onClick={() => void handleConfirmLeave(org.id)}
                          >
                            {intl.formatMessage({
                              id: isLeaving
                                ? 'auth.common.submitting'
                                : 'organizations.leave.action',
                            })}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isLeaving}
                            onClick={() => setConfirmLeaveOrgId(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: 'organizations.create.title' })}</CardTitle>
          <CardDescription>
            {intl.formatMessage({ id: 'organizations.create.description' })}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(handleCreateSubmit)} noValidate className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-org-name" required>
                  {intl.formatMessage({ id: 'organizations.create.nameLabel' })}
                </Label>
                <Input
                  id="create-org-name"
                  type="text"
                  placeholder={intl.formatMessage({ id: 'organizations.create.namePlaceholder' })}
                  aria-invalid={errors.name !== undefined}
                  aria-describedby={errors.name !== undefined ? 'create-org-name-error' : undefined}
                  {...nameField}
                />
                {errors.name !== undefined ? (
                  <p
                    id="create-org-name-error"
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    {intl.formatMessage({ id: 'validation.displayNameMin' })}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-org-slug" required>
                  {intl.formatMessage({ id: 'organizations.create.slugLabel' })}
                </Label>
                <Input
                  id="create-org-slug"
                  type="text"
                  placeholder={intl.formatMessage({ id: 'organizations.create.slugPlaceholder' })}
                  aria-invalid={errors.slug !== undefined}
                  aria-describedby={
                    errors.slug !== undefined
                      ? 'create-org-slug-error create-org-slug-hint'
                      : 'create-org-slug-hint'
                  }
                  {...slugField}
                />
                <p id="create-org-slug-hint" className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: 'organizations.create.slugHint' })}
                </p>
                {errors.slug !== undefined ? (
                  <p
                    id="create-org-slug-error"
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    {intl.formatMessage({ id: 'validation.slugFormat' })}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-org-description">
                {intl.formatMessage({ id: 'organizations.create.descriptionLabel' })}
              </Label>
              <Input
                id="create-org-description"
                type="text"
                placeholder={intl.formatMessage({
                  id: 'organizations.create.descriptionPlaceholder',
                })}
                {...register('description')}
              />
            </div>

            <Button type="submit" disabled={isSubmitting}>
              <IconBuildingPlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id: isSubmitting ? 'auth.common.submitting' : 'organizations.create.submit',
                })}
              </span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
