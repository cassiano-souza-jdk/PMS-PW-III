import { zodResolver } from '@hookform/resolvers/zod';
import { IconCheck, IconSettings, IconUsers } from '@tabler/icons-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  type MembershipStatus,
  type OrganizationRole,
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
  Input,
  Label,
} from '@/shared/ui';
import type { OrganizationMemberDetails } from '../application/use-cases/organization-service';

const updateOrgSchema = z.object({
  name: z.string().trim().min(2, 'validation.displayNameMin').max(120),
  description: z.string().trim().max(500),
});

export type UpdateOrganizationFormValues = z.infer<typeof updateOrgSchema>;

export interface OrganizationSettingsFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface OrganizationSettingsPanelProps {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly organizationDescription?: string;
  readonly isDemo: boolean;
  readonly actorRole: OrganizationRole;
  readonly currentUserId: UserId;
  readonly canViewDetails: boolean;
  readonly canUpdateDetails: boolean;
  readonly canViewMembers: boolean;
  readonly canManageRoles: boolean;
  readonly canManageMembers: boolean;
  readonly members: readonly OrganizationMemberDetails[];
  readonly isLoadingDetails: boolean;
  readonly isLoadingMembers: boolean;
  readonly detailsFeedback?: OrganizationSettingsFeedback | null;
  readonly membersFeedback?: OrganizationSettingsFeedback | null;
  readonly onUpdateOrganization: (values: UpdateOrganizationFormValues) => Promise<void>;
  readonly onChangeMemberRole: (targetUserId: UserId, role: OrganizationRole) => Promise<void>;
  readonly onToggleMemberStatus: (
    targetUserId: UserId,
    nextStatus: 'ACTIVE' | 'SUSPENDED',
  ) => Promise<void>;
}

const ROLE_OPTIONS: readonly OrganizationRole[] = [
  ORGANIZATION_ROLES.ADMIN,
  ORGANIZATION_ROLES.MANAGER,
  ORGANIZATION_ROLES.MEMBER,
];

const ROLE_LABEL_ID_BY_CODE: Readonly<Record<OrganizationRole, MessageId>> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

const STATUS_LABEL_ID_BY_CODE: Readonly<Record<MembershipStatus, MessageId>> = {
  ACTIVE: 'membershipStatus.ACTIVE',
  SUSPENDED: 'membershipStatus.SUSPENDED',
  REMOVED: 'membershipStatus.REMOVED',
};

export function OrganizationSettingsPanel({
  organizationName,
  organizationSlug,
  organizationDescription = '',
  isDemo,
  actorRole,
  currentUserId,
  canViewDetails,
  canUpdateDetails,
  canViewMembers,
  canManageRoles,
  canManageMembers,
  members,
  isLoadingDetails,
  isLoadingMembers,
  detailsFeedback = null,
  membersFeedback = null,
  onUpdateOrganization,
  onChangeMemberRole,
  onToggleMemberStatus,
}: OrganizationSettingsPanelProps) {
  const intl = useIntl();
  const [busyMemberId, setBusyMemberId] = useState<UserId | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateOrganizationFormValues>({
    resolver: zodResolver(updateOrgSchema),
    defaultValues: {
      name: organizationName,
      description: organizationDescription,
    },
  });

  useEffect(() => {
    reset({
      name: organizationName,
      description: organizationDescription,
    });
  }, [organizationDescription, organizationName, reset]);

  const actorRoleLabel = intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[actorRole] });

  const handleRoleSelect = async (targetUserId: UserId, event: ChangeEvent<HTMLSelectElement>) => {
    const selectedRole = ROLE_OPTIONS.find((role) => role === event.target.value);
    if (selectedRole === undefined) {
      return;
    }
    setBusyMemberId(targetUserId);
    try {
      await onChangeMemberRole(targetUserId, selectedRole);
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleStatusToggle = async (targetUserId: UserId, nextStatus: 'ACTIVE' | 'SUSPENDED') => {
    setBusyMemberId(targetUserId);
    try {
      await onToggleMemberStatus(targetUserId, nextStatus);
    } finally {
      setBusyMemberId(null);
    }
  };

  return (
    <section aria-labelledby="org-settings-heading" className="mx-auto w-full max-w-5xl space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            id="org-settings-heading"
            className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            {organizationName}
          </h1>
          {isDemo ? (
            <Badge variant="demo">{intl.formatMessage({ id: 'organizations.demoBadge' })}</Badge>
          ) : null}
          <Badge variant="secondary">{actorRoleLabel}</Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{organizationSlug}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <IconSettings className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <CardTitle>{intl.formatMessage({ id: 'organizations.details.title' })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'organizations.details.description' })}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {detailsFeedback !== null ? (
            <Alert variant={detailsFeedback.type}>
              <AlertDescription>{detailsFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          {!canViewDetails ? (
            <Alert variant="info">
              <AlertDescription>
                {intl.formatMessage(
                  { id: 'organizations.details.noPermission' },
                  { role: actorRoleLabel },
                )}
              </AlertDescription>
            </Alert>
          ) : isLoadingDetails ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'app.loading' })}
            </p>
          ) : (
            <form onSubmit={handleSubmit(onUpdateOrganization)} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="settings-org-name" required>
                  {intl.formatMessage({ id: 'organizations.create.nameLabel' })}
                </Label>
                <Input
                  id="settings-org-name"
                  type="text"
                  disabled={!canUpdateDetails}
                  aria-invalid={errors.name !== undefined}
                  aria-describedby={
                    errors.name !== undefined ? 'settings-org-name-error' : undefined
                  }
                  {...register('name')}
                />
                {errors.name !== undefined ? (
                  <p
                    id="settings-org-name-error"
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    {intl.formatMessage({ id: 'validation.displayNameMin' })}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="settings-org-description">
                  {intl.formatMessage({ id: 'organizations.create.descriptionLabel' })}
                </Label>
                <Input
                  id="settings-org-description"
                  type="text"
                  disabled={!canUpdateDetails}
                  {...register('description')}
                />
              </div>

              {canUpdateDetails ? (
                <Button type="submit" disabled={isSubmitting}>
                  <IconCheck className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {intl.formatMessage({
                      id: isSubmitting
                        ? 'auth.common.submitting'
                        : 'organizations.details.saveAction',
                    })}
                  </span>
                </Button>
              ) : null}
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <IconUsers className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <CardTitle>{intl.formatMessage({ id: 'organizations.members.title' })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'organizations.members.description' })}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {membersFeedback !== null ? (
            <Alert variant={membersFeedback.type}>
              <AlertDescription>{membersFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          {!canViewMembers ? (
            <Alert variant="info">
              <AlertDescription>
                {intl.formatMessage(
                  { id: 'organizations.members.noPermission' },
                  { role: actorRoleLabel },
                )}
              </AlertDescription>
            </Alert>
          ) : isLoadingMembers ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'app.loading' })}
            </p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'organizations.members.empty' })}
            </p>
          ) : (
            <ul className="space-y-3">
              {members.map((member) => {
                const isRemoved = member.status === MEMBERSHIP_STATUSES.REMOVED;
                const isSuspended = member.status === MEMBERSHIP_STATUSES.SUSPENDED;
                const isBusy = busyMemberId === member.userId;
                const isCurrentUser = member.userId === currentUserId;
                const roleSelectId = `member-role-${member.id}`;

                return (
                  <li
                    key={member.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{member.displayName}</span>
                        {isCurrentUser ? (
                          <Badge variant="outline">
                            {intl.formatMessage({ id: 'nav.profile' })}
                          </Badge>
                        ) : null}
                        <Badge
                          variant={
                            isRemoved ? 'destructive' : isSuspended ? 'outline' : 'secondary'
                          }
                        >
                          {intl.formatMessage({ id: STATUS_LABEL_ID_BY_CODE[member.status] })}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {canManageRoles && !isRemoved ? (
                        <div>
                          <label htmlFor={roleSelectId} className="sr-only">
                            {intl.formatMessage(
                              { id: 'organizations.members.roleLabel' },
                              { name: member.displayName },
                            )}
                          </label>
                          <select
                            id={roleSelectId}
                            value={member.role}
                            disabled={isBusy}
                            onChange={(event) => void handleRoleSelect(member.userId, event)}
                            className="min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {ROLE_OPTIONS.map((roleOption) => (
                              <option key={roleOption} value={roleOption}>
                                {intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[roleOption] })}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <Badge variant="outline">
                          {intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[member.role] })}
                        </Badge>
                      )}

                      {canManageMembers && !isRemoved ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={isSuspended ? 'secondary' : 'outline'}
                          disabled={isBusy}
                          onClick={() =>
                            void handleStatusToggle(
                              member.userId,
                              isSuspended
                                ? MEMBERSHIP_STATUSES.ACTIVE
                                : MEMBERSHIP_STATUSES.SUSPENDED,
                            )
                          }
                        >
                          {intl.formatMessage({
                            id: isSuspended
                              ? 'organizations.members.reactivateAction'
                              : 'organizations.members.suspendAction',
                          })}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
