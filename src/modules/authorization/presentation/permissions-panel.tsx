import { zodResolver } from '@hookform/resolvers/zod';
import { IconKey, IconShieldLock, IconShieldOff, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { MessageId } from '@/shared/i18n';
import {
  asEntityId,
  asIsoDateTime,
  asUserId,
  isUuid,
  type GrantId,
  type OrganizationRole,
  type UserId,
} from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import type { AuthorizationScopeSummary } from '../application/ports/authorization-context.port';
import type {
  CreateExplicitDenyRuleInput,
  ExplicitDenyRuleWithActiveFlag,
  GrantPermissionInput,
  MyActiveAccessRules,
  PermissionGrantWithDerivedStatus,
} from '../application/use-cases/authorization-management-service';

export interface PermissionMemberOption {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: string;
  readonly role: OrganizationRole;
}

export interface PermissionScopeOption {
  readonly id: string;
  readonly label: string;
}

export interface PermissionPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

type PermissionCodeValue = GrantPermissionInput['permission'];
type ScopeTypeValue = GrantPermissionInput['scopeType'];
type GrantDerivedStatusValue = PermissionGrantWithDerivedStatus['derivedStatus'];
type DenyRuleIdValue = ExplicitDenyRuleWithActiveFlag['id'];

const VALIDATION_ERROR_IDS: Readonly<Record<string, MessageId>> = {
  'validation.required': 'validation.required',
  'validation.uuidInvalid': 'validation.uuidInvalid',
  'permissions.reasonMin': 'permissions.reasonMin',
};

function resolveValidationMessageId(code: string | undefined): MessageId {
  if (code !== undefined && code in VALIDATION_ERROR_IDS) {
    return VALIDATION_ERROR_IDS[code] ?? 'validation.required';
  }
  return 'validation.required';
}

function validateScopeId(
  data: { readonly scopeType: ScopeTypeValue; readonly scopeId?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.scopeType === 'ORGANIZATION') {
    return;
  }

  const trimmed = data.scopeId?.trim() ?? '';
  if (trimmed.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'validation.required',
      path: ['scopeId'],
    });
    return;
  }

  if (!isUuid(trimmed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'validation.uuidInvalid',
      path: ['scopeId'],
    });
  }
}

const grantFormSchema = z
  .object({
    granteeUserId: z.string().min(1, 'validation.required').uuid('validation.uuidInvalid'),
    permission: z.string().min(1, 'validation.required'),
    scopeType: z.enum(['ORGANIZATION', 'TEAM', 'PROJECT', 'RESOURCE']),
    scopeId: z.string().optional(),
    reason: z.string().trim().min(3, 'permissions.reasonMin').max(500),
    startsAt: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .superRefine(validateScopeId);

const denyFormSchema = z
  .object({
    targetUserId: z.string().min(1, 'validation.required').uuid('validation.uuidInvalid'),
    permission: z.string().min(1, 'validation.required'),
    scopeType: z.enum(['ORGANIZATION', 'TEAM', 'PROJECT', 'RESOURCE']),
    scopeId: z.string().optional(),
    reason: z.string().trim().min(3, 'permissions.reasonMin').max(500),
    expiresAt: z.string().optional(),
  })
  .superRefine(validateScopeId);

type GrantFormValues = z.infer<typeof grantFormSchema>;
type DenyFormValues = z.infer<typeof denyFormSchema>;

export interface PermissionsPanelProps {
  readonly organizationName: string;
  readonly actorRole: OrganizationRole;
  readonly scopeSummary: AuthorizationScopeSummary;
  readonly myActiveGrants: MyActiveAccessRules['grants'];
  readonly myActiveDenies: MyActiveAccessRules['explicitDenies'];
  readonly canManageGrants: boolean;
  readonly canManageDenies: boolean;
  readonly allowedGrantScopeTypes: readonly ScopeTypeValue[];
  readonly delegablePermissions: readonly PermissionCodeValue[];
  readonly allPermissions: readonly PermissionCodeValue[];
  readonly members: readonly PermissionMemberOption[];
  readonly teamScopes: readonly PermissionScopeOption[];
  readonly projectScopes?: readonly PermissionScopeOption[];
  readonly organizationGrants: readonly PermissionGrantWithDerivedStatus[];
  readonly organizationDenies: readonly ExplicitDenyRuleWithActiveFlag[];
  readonly isLoadingRules: boolean;
  readonly grantsFeedback?: PermissionPanelFeedback | null;
  readonly deniesFeedback?: PermissionPanelFeedback | null;
  readonly onCreateGrant: (input: GrantPermissionInput) => Promise<void>;
  readonly onRevokeGrant: (grantId: GrantId) => Promise<void>;
  readonly onCreateDenyRule: (input: CreateExplicitDenyRuleInput) => Promise<void>;
  readonly onRevokeDenyRule: (denyRuleId: DenyRuleIdValue) => Promise<void>;
}

const ROLE_LABEL_ID_BY_CODE: Readonly<Record<OrganizationRole, MessageId>> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

const GRANT_STATUS_LABEL_ID: Readonly<Record<GrantDerivedStatusValue, MessageId>> = {
  ACTIVE: 'permissions.status.ACTIVE',
  SCHEDULED: 'permissions.status.SCHEDULED',
  EXPIRED: 'permissions.status.EXPIRED',
  REVOKED: 'permissions.status.REVOKED',
};

const SCOPE_LABEL_ID: Readonly<Record<ScopeTypeValue, MessageId>> = {
  ORGANIZATION: 'permissions.scope.ORGANIZATION',
  TEAM: 'permissions.scope.TEAM',
  PROJECT: 'permissions.scope.PROJECT',
  RESOURCE: 'permissions.scope.RESOURCE',
};

function toOptionalIsoDateTime(localDateTime: string | undefined) {
  if (localDateTime === undefined || localDateTime.trim() === '') {
    return undefined;
  }
  const parsed = new Date(localDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return asIsoDateTime(parsed.toISOString());
}

export function PermissionsPanel({
  organizationName,
  actorRole,
  scopeSummary,
  myActiveGrants,
  myActiveDenies,
  canManageGrants,
  canManageDenies,
  allowedGrantScopeTypes,
  delegablePermissions,
  allPermissions,
  members,
  teamScopes,
  projectScopes = [],
  organizationGrants,
  organizationDenies,
  isLoadingRules,
  grantsFeedback = null,
  deniesFeedback = null,
  onCreateGrant,
  onRevokeGrant,
  onCreateDenyRule,
  onRevokeDenyRule,
}: PermissionsPanelProps) {
  const intl = useIntl();
  const [confirmRevokeGrantId, setConfirmRevokeGrantId] = useState<GrantId | null>(null);
  const [confirmRevokeDenyId, setConfirmRevokeDenyId] = useState<DenyRuleIdValue | null>(null);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  const defaultGrantScope: ScopeTypeValue = allowedGrantScopeTypes[0] ?? 'ORGANIZATION';
  const defaultGrantPermission: string = delegablePermissions[0] ?? '';

  const grantForm = useForm<GrantFormValues>({
    resolver: zodResolver(grantFormSchema),
    defaultValues: {
      granteeUserId: members[0]?.userId ?? '',
      permission: defaultGrantPermission,
      scopeType: defaultGrantScope,
      scopeId: defaultGrantScope === 'TEAM' ? (teamScopes[0]?.id ?? '') : '',
      reason: '',
      startsAt: '',
      expiresAt: '',
    },
  });

  const denyForm = useForm<DenyFormValues>({
    resolver: zodResolver(denyFormSchema),
    defaultValues: {
      targetUserId: members[0]?.userId ?? '',
      permission: '*',
      scopeType: 'ORGANIZATION',
      scopeId: '',
      reason: '',
      expiresAt: '',
    },
  });

  const selectedGrantScopeType = useWatch({
    control: grantForm.control,
    name: 'scopeType',
  });
  const selectedDenyScopeType = useWatch({
    control: denyForm.control,
    name: 'scopeType',
  });

  const memberNameById = new Map<string, string>(
    members.map((member) => [member.userId, `${member.displayName} (${member.email})`]),
  );

  const actorRoleLabel = intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[actorRole] });

  const renderFieldError = (errorId: string, error: { readonly message?: string } | undefined) =>
    error !== undefined ? (
      <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
        {intl.formatMessage({ id: resolveValidationMessageId(error.message) })}
      </p>
    ) : null;

  const renderScopeTargetField = ({
    inputId,
    errorId,
    scopeType,
    hasError,
    registration,
    error,
  }: {
    readonly inputId: string;
    readonly errorId: string;
    readonly scopeType: ScopeTypeValue;
    readonly hasError: boolean;
    readonly registration: UseFormRegisterReturn<'scopeId'>;
    readonly error: { readonly message?: string } | undefined;
  }) => {
    const describedBy = hasError ? errorId : undefined;

    if (scopeType === 'TEAM' || scopeType === 'PROJECT') {
      const options = scopeType === 'TEAM' ? teamScopes : projectScopes;
      const placeholderId: MessageId =
        scopeType === 'TEAM'
          ? 'permissions.grants.selectTeamPlaceholder'
          : 'permissions.grants.selectProjectPlaceholder';

      return (
        <div className="space-y-1.5">
          <Label htmlFor={inputId} required>
            {intl.formatMessage({ id: 'permissions.grants.scopeIdLabel' })}
          </Label>
          <select
            key={`${inputId}-${scopeType}`}
            id={inputId}
            aria-invalid={hasError}
            aria-describedby={describedBy}
            className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            {...registration}
          >
            <option value="">{intl.formatMessage({ id: placeholderId })}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {renderFieldError(errorId, error)}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <Label htmlFor={inputId} required>
          {intl.formatMessage({ id: 'permissions.grants.scopeIdLabel' })}
        </Label>
        <Input
          key={`${inputId}-RESOURCE`}
          id={inputId}
          type="text"
          placeholder={intl.formatMessage({ id: 'permissions.grants.resourceUuidPlaceholder' })}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          {...registration}
        />
        {renderFieldError(errorId, error)}
      </div>
    );
  };

  const handleGrantSubmit = async (values: GrantFormValues) => {
    const matchedPermission = delegablePermissions.find((code) => code === values.permission);
    if (matchedPermission === undefined) {
      return;
    }

    const startsAt = toOptionalIsoDateTime(values.startsAt);
    const expiresAt = toOptionalIsoDateTime(values.expiresAt);
    const trimmedScopeId = values.scopeId?.trim() ?? '';

    await onCreateGrant({
      granteeUserId: asUserId(values.granteeUserId, 'granteeUserId'),
      permission: matchedPermission,
      scopeType: values.scopeType,
      ...(values.scopeType !== 'ORGANIZATION' && trimmedScopeId.length > 0
        ? { scopeId: asEntityId(trimmedScopeId, 'scopeId') }
        : {}),
      reason: values.reason,
      ...(startsAt !== undefined ? { startsAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });

    grantForm.reset({
      granteeUserId: values.granteeUserId,
      permission: values.permission,
      scopeType: values.scopeType,
      scopeId: values.scopeId ?? '',
      reason: '',
      startsAt: '',
      expiresAt: '',
    });
  };

  const handleDenySubmit = async (values: DenyFormValues) => {
    const matchedPermission: CreateExplicitDenyRuleInput['permission'] | undefined =
      values.permission === '*' ? '*' : allPermissions.find((code) => code === values.permission);
    if (matchedPermission === undefined) {
      return;
    }

    const expiresAt = toOptionalIsoDateTime(values.expiresAt);
    const trimmedScopeId = values.scopeId?.trim() ?? '';

    await onCreateDenyRule({
      targetUserId: asUserId(values.targetUserId, 'targetUserId'),
      permission: matchedPermission,
      scopeType: values.scopeType,
      ...(values.scopeType !== 'ORGANIZATION' && trimmedScopeId.length > 0
        ? { scopeId: asEntityId(trimmedScopeId, 'scopeId') }
        : {}),
      reason: values.reason,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });

    denyForm.reset({
      targetUserId: values.targetUserId,
      permission: '*',
      scopeType: 'ORGANIZATION',
      scopeId: '',
      reason: '',
      expiresAt: '',
    });
  };

  const handleConfirmRevokeGrant = async (grantId: GrantId) => {
    setBusyRuleId(grantId);
    try {
      await onRevokeGrant(grantId);
      setConfirmRevokeGrantId(null);
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleConfirmRevokeDeny = async (denyRuleId: DenyRuleIdValue) => {
    setBusyRuleId(denyRuleId);
    try {
      await onRevokeDenyRule(denyRuleId);
      setConfirmRevokeDenyId(null);
    } finally {
      setBusyRuleId(null);
    }
  };

  return (
    <section aria-labelledby="permissions-heading" className="mx-auto w-full max-w-5xl space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            id="permissions-heading"
            className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            {intl.formatMessage({ id: 'permissions.title' })}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
          <Badge variant="outline">{actorRoleLabel}</Badge>
        </div>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'permissions.subtitle' })}
        </p>
      </div>

      <Alert variant="info">
        <AlertTitle>{intl.formatMessage({ id: 'permissions.delegationGuide.title' })}</AlertTitle>
        <AlertDescription>
          {intl.formatMessage({ id: 'permissions.delegationGuide.description' })}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <IconKey className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <CardTitle>{intl.formatMessage({ id: 'permissions.myRules.title' })}</CardTitle>
            <CardDescription>
              Equipes gerenciadas: {scopeSummary.managedTeamIds.length} · Equipes participadas:{' '}
              {scopeSummary.memberTeamIds.length} · Projetos gerenciados:{' '}
              {scopeSummary.managedProjectIds.length}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'permissions.grants.title' })} ({myActiveGrants.length})
            </h2>
            {myActiveGrants.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: 'permissions.myRules.emptyGrants' })}
              </p>
            ) : (
              <ul className="space-y-2">
                {myActiveGrants.map((grant) => (
                  <li key={grant.id} className="rounded-md border bg-muted/30 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="default">{grant.permission}</Badge>
                      <Badge variant="outline">
                        {intl.formatMessage({ id: SCOPE_LABEL_ID[grant.scopeType] })}
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{grant.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-foreground">
              {intl.formatMessage({ id: 'permissions.denies.title' })} ({myActiveDenies.length})
            </h2>
            {myActiveDenies.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: 'permissions.myRules.emptyDenies' })}
              </p>
            ) : (
              <ul className="space-y-2">
                {myActiveDenies.map((rule) => (
                  <li key={rule.id} className="rounded-md border bg-destructive/5 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="destructive">{rule.permission}</Badge>
                      <Badge variant="outline">
                        {intl.formatMessage({ id: SCOPE_LABEL_ID[rule.scopeType] })}
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{rule.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <IconShieldLock className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <CardTitle>{intl.formatMessage({ id: 'permissions.grants.title' })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'permissions.grants.description' })}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {grantsFeedback !== null ? (
            <Alert variant={grantsFeedback.type}>
              <AlertDescription>{grantsFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          {!canManageGrants ? (
            <Alert variant="info">
              <AlertDescription>
                {intl.formatMessage(
                  { id: 'permissions.grants.noPermission' },
                  { role: actorRoleLabel },
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <form
                onSubmit={grantForm.handleSubmit(handleGrantSubmit)}
                noValidate
                className="space-y-4 rounded-lg border bg-muted/20 p-4"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="grant-grantee" required>
                      {intl.formatMessage({ id: 'permissions.grants.granteeLabel' })}
                    </Label>
                    <select
                      id="grant-grantee"
                      aria-invalid={grantForm.formState.errors.granteeUserId !== undefined}
                      aria-describedby={
                        grantForm.formState.errors.granteeUserId !== undefined
                          ? 'grant-grantee-error'
                          : undefined
                      }
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...grantForm.register('granteeUserId')}
                    >
                      <option value="">
                        {intl.formatMessage({ id: 'permissions.grants.selectMemberPlaceholder' })}
                      </option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName} ({member.email})
                        </option>
                      ))}
                    </select>
                    {renderFieldError(
                      'grant-grantee-error',
                      grantForm.formState.errors.granteeUserId,
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="grant-permission" required>
                      {intl.formatMessage({ id: 'permissions.grants.permissionLabel' })}
                    </Label>
                    <select
                      id="grant-permission"
                      aria-invalid={grantForm.formState.errors.permission !== undefined}
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...grantForm.register('permission')}
                    >
                      {delegablePermissions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="grant-scope-type" required>
                      {intl.formatMessage({ id: 'permissions.grants.scopeTypeLabel' })}
                    </Label>
                    <select
                      id="grant-scope-type"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...grantForm.register('scopeType', {
                        onChange: () => {
                          grantForm.setValue('scopeId', '', { shouldValidate: false });
                          grantForm.clearErrors('scopeId');
                        },
                      })}
                    >
                      {allowedGrantScopeTypes.map((scopeType) => (
                        <option key={scopeType} value={scopeType}>
                          {intl.formatMessage({ id: SCOPE_LABEL_ID[scopeType] })}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedGrantScopeType !== 'ORGANIZATION'
                    ? renderScopeTargetField({
                        inputId: 'grant-scope-id',
                        errorId: 'grant-scope-id-error',
                        scopeType: selectedGrantScopeType,
                        hasError: grantForm.formState.errors.scopeId !== undefined,
                        registration: grantForm.register('scopeId'),
                        error: grantForm.formState.errors.scopeId,
                      })
                    : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="grant-starts-at">
                      {intl.formatMessage({ id: 'permissions.grants.startsAtLabel' })}
                    </Label>
                    <Input
                      id="grant-starts-at"
                      type="datetime-local"
                      {...grantForm.register('startsAt')}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="grant-expires-at">
                      {intl.formatMessage({ id: 'permissions.grants.expiresAtLabel' })}
                    </Label>
                    <Input
                      id="grant-expires-at"
                      type="datetime-local"
                      {...grantForm.register('expiresAt')}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="grant-reason" required>
                    {intl.formatMessage({ id: 'permissions.grants.reasonLabel' })}
                  </Label>
                  <Input
                    id="grant-reason"
                    type="text"
                    placeholder={intl.formatMessage({ id: 'permissions.grants.reasonPlaceholder' })}
                    aria-invalid={grantForm.formState.errors.reason !== undefined}
                    aria-describedby={
                      grantForm.formState.errors.reason !== undefined
                        ? 'grant-reason-error'
                        : undefined
                    }
                    {...grantForm.register('reason')}
                  />
                  {grantForm.formState.errors.reason !== undefined ? (
                    <p
                      id="grant-reason-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({ id: 'permissions.reasonMin' })}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" disabled={grantForm.formState.isSubmitting}>
                  {intl.formatMessage({
                    id: grantForm.formState.isSubmitting
                      ? 'auth.common.submitting'
                      : 'permissions.grants.createAction',
                  })}
                </Button>
              </form>

              {isLoadingRules ? (
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'app.loading' })}
                </p>
              ) : organizationGrants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'permissions.grants.empty' })}
                </p>
              ) : (
                <ul className="space-y-3">
                  {organizationGrants.map((grant) => {
                    const isRevocable =
                      grant.derivedStatus === 'ACTIVE' || grant.derivedStatus === 'SCHEDULED';
                    const isConfirming = confirmRevokeGrantId === grant.id;
                    const isBusy = busyRuleId === grant.id;

                    return (
                      <li key={grant.id} className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {memberNameById.get(grant.granteeUserId) ?? grant.granteeUserId}
                              </span>
                              <Badge variant="default">{grant.permission}</Badge>
                              <Badge
                                variant={
                                  grant.derivedStatus === 'ACTIVE'
                                    ? 'secondary'
                                    : grant.derivedStatus === 'SCHEDULED'
                                      ? 'outline'
                                      : 'destructive'
                                }
                              >
                                {intl.formatMessage({
                                  id: GRANT_STATUS_LABEL_ID[grant.derivedStatus],
                                })}
                              </Badge>
                              <Badge variant="outline">
                                {intl.formatMessage({ id: SCOPE_LABEL_ID[grant.scopeType] })}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{grant.reason}</p>
                          </div>

                          {isRevocable && !isConfirming ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={isBusy}
                              onClick={() => setConfirmRevokeGrantId(grant.id)}
                            >
                              <IconTrash className="h-4 w-4" aria-hidden="true" />
                              <span>
                                {intl.formatMessage({ id: 'permissions.grants.revokeAction' })}
                              </span>
                            </Button>
                          ) : null}
                        </div>

                        {isConfirming ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                            <span className="text-xs font-medium text-foreground">
                              Confirmar revogação da concessão "{grant.permission}"?
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={isBusy}
                                onClick={() => void handleConfirmRevokeGrant(grant.id)}
                              >
                                {intl.formatMessage({ id: 'permissions.grants.revokeAction' })}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isBusy}
                                onClick={() => setConfirmRevokeGrantId(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <IconShieldOff className="h-5 w-5 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <CardTitle>{intl.formatMessage({ id: 'permissions.denies.title' })}</CardTitle>
            <CardDescription>
              {intl.formatMessage({ id: 'permissions.denies.description' })}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {deniesFeedback !== null ? (
            <Alert variant={deniesFeedback.type}>
              <AlertDescription>{deniesFeedback.message}</AlertDescription>
            </Alert>
          ) : null}

          {!canManageDenies ? (
            <Alert variant="info">
              <AlertDescription>
                {intl.formatMessage({ id: 'permissions.denies.adminOnly' })}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <form
                onSubmit={denyForm.handleSubmit(handleDenySubmit)}
                noValidate
                className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="deny-target-user" required>
                      {intl.formatMessage({ id: 'permissions.denies.targetUserLabel' })}
                    </Label>
                    <select
                      id="deny-target-user"
                      aria-invalid={denyForm.formState.errors.targetUserId !== undefined}
                      aria-describedby={
                        denyForm.formState.errors.targetUserId !== undefined
                          ? 'deny-target-user-error'
                          : undefined
                      }
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...denyForm.register('targetUserId')}
                    >
                      <option value="">
                        {intl.formatMessage({ id: 'permissions.grants.selectMemberPlaceholder' })}
                      </option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName} ({member.email})
                        </option>
                      ))}
                    </select>
                    {renderFieldError(
                      'deny-target-user-error',
                      denyForm.formState.errors.targetUserId,
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="deny-permission" required>
                      {intl.formatMessage({ id: 'permissions.denies.permissionLabel' })}
                    </Label>
                    <select
                      id="deny-permission"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...denyForm.register('permission')}
                    >
                      <option value="*">
                        {intl.formatMessage({ id: 'permissions.denies.wildcardOption' })}
                      </option>
                      {allPermissions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="deny-scope-type" required>
                      {intl.formatMessage({ id: 'permissions.grants.scopeTypeLabel' })}
                    </Label>
                    <select
                      id="deny-scope-type"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...denyForm.register('scopeType', {
                        onChange: () => {
                          denyForm.setValue('scopeId', '', { shouldValidate: false });
                          denyForm.clearErrors('scopeId');
                        },
                      })}
                    >
                      <option value="ORGANIZATION">
                        {intl.formatMessage({ id: 'permissions.scope.ORGANIZATION' })}
                      </option>
                      <option value="TEAM">
                        {intl.formatMessage({ id: 'permissions.scope.TEAM' })}
                      </option>
                      <option value="PROJECT">
                        {intl.formatMessage({ id: 'permissions.scope.PROJECT' })}
                      </option>
                      <option value="RESOURCE">
                        {intl.formatMessage({ id: 'permissions.scope.RESOURCE' })}
                      </option>
                    </select>
                  </div>

                  {selectedDenyScopeType !== 'ORGANIZATION'
                    ? renderScopeTargetField({
                        inputId: 'deny-scope-id',
                        errorId: 'deny-scope-id-error',
                        scopeType: selectedDenyScopeType,
                        hasError: denyForm.formState.errors.scopeId !== undefined,
                        registration: denyForm.register('scopeId'),
                        error: denyForm.formState.errors.scopeId,
                      })
                    : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="deny-expires-at">
                      {intl.formatMessage({ id: 'permissions.grants.expiresAtLabel' })}
                    </Label>
                    <Input
                      id="deny-expires-at"
                      type="datetime-local"
                      {...denyForm.register('expiresAt')}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deny-reason" required>
                    {intl.formatMessage({ id: 'permissions.grants.reasonLabel' })}
                  </Label>
                  <Input
                    id="deny-reason"
                    type="text"
                    placeholder={intl.formatMessage({ id: 'permissions.grants.reasonPlaceholder' })}
                    aria-invalid={denyForm.formState.errors.reason !== undefined}
                    aria-describedby={
                      denyForm.formState.errors.reason !== undefined
                        ? 'deny-reason-error'
                        : undefined
                    }
                    {...denyForm.register('reason')}
                  />
                  {denyForm.formState.errors.reason !== undefined ? (
                    <p
                      id="deny-reason-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({ id: 'permissions.reasonMin' })}
                    </p>
                  ) : null}
                </div>

                <Button
                  type="submit"
                  variant="destructive"
                  disabled={denyForm.formState.isSubmitting}
                >
                  {intl.formatMessage({
                    id: denyForm.formState.isSubmitting
                      ? 'auth.common.submitting'
                      : 'permissions.denies.createAction',
                  })}
                </Button>
              </form>

              {isLoadingRules ? (
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'app.loading' })}
                </p>
              ) : organizationDenies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'permissions.denies.empty' })}
                </p>
              ) : (
                <ul className="space-y-3">
                  {organizationDenies.map((rule) => {
                    const isConfirming = confirmRevokeDenyId === rule.id;
                    const isBusy = busyRuleId === rule.id;

                    return (
                      <li key={rule.id} className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {memberNameById.get(rule.targetUserId) ?? rule.targetUserId}
                              </span>
                              <Badge variant="destructive">{rule.permission}</Badge>
                              <Badge variant={rule.isActive ? 'default' : 'outline'}>
                                {intl.formatMessage({
                                  id: rule.isActive
                                    ? 'permissions.status.ACTIVE'
                                    : 'permissions.status.REVOKED',
                                })}
                              </Badge>
                              <Badge variant="outline">
                                {intl.formatMessage({ id: SCOPE_LABEL_ID[rule.scopeType] })}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{rule.reason}</p>
                          </div>

                          {rule.isActive && !isConfirming ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => setConfirmRevokeDenyId(rule.id)}
                            >
                              <IconTrash className="h-4 w-4" aria-hidden="true" />
                              <span>
                                {intl.formatMessage({ id: 'permissions.denies.revokeAction' })}
                              </span>
                            </Button>
                          ) : null}
                        </div>

                        {isConfirming ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                            <span className="text-xs font-medium text-foreground">
                              Confirmar revogação desta negação explícita?
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={isBusy}
                                onClick={() => void handleConfirmRevokeDeny(rule.id)}
                              >
                                {intl.formatMessage({ id: 'permissions.denies.revokeAction' })}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isBusy}
                                onClick={() => setConfirmRevokeDenyId(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
