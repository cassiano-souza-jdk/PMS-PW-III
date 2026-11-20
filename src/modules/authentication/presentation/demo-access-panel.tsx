import {
  IconArrowLeft,
  IconShieldCheck,
  IconSparkles,
  IconUser,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import type { MessageId } from '@/shared/i18n';
import type { OrganizationRole } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui';

export interface DemoProfileOption {
  readonly role: OrganizationRole;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface DemoAccessPanelProps {
  readonly profiles: readonly DemoProfileOption[];
  readonly activeDemoRole?: OrganizationRole | null;
  readonly loadingRole?: OrganizationRole | null;
  readonly errorMessage?: string | null;
  readonly onEnterProfile: (role: OrganizationRole) => Promise<void>;
}

const ROLE_META: Readonly<
  Record<
    OrganizationRole,
    {
      readonly titleId: MessageId;
      readonly descriptionId: MessageId;
      readonly roleLabelId: MessageId;
      readonly icon: typeof IconShieldCheck;
    }
  >
> = {
  ADMIN: {
    titleId: 'auth.demo.admin.title',
    descriptionId: 'auth.demo.admin.description',
    roleLabelId: 'roles.ADMIN',
    icon: IconShieldCheck,
  },
  MANAGER: {
    titleId: 'auth.demo.manager.title',
    descriptionId: 'auth.demo.manager.description',
    roleLabelId: 'roles.MANAGER',
    icon: IconUsersGroup,
  },
  MEMBER: {
    titleId: 'auth.demo.member.title',
    descriptionId: 'auth.demo.member.description',
    roleLabelId: 'roles.MEMBER',
    icon: IconUser,
  },
};

export function DemoAccessPanel({
  profiles,
  activeDemoRole = null,
  loadingRole = null,
  errorMessage = null,
  onEnterProfile,
}: DemoAccessPanelProps) {
  const intl = useIntl();

  return (
    <section aria-labelledby="demo-access-heading" className="mx-auto w-full max-w-5xl space-y-6">
      <div className="space-y-2">
        <Badge variant="demo">{intl.formatMessage({ id: 'demoBanner.badge' })}</Badge>
        <h1
          id="demo-access-heading"
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          {intl.formatMessage({ id: 'auth.demo.title' })}
        </h1>
        <p className="max-w-3xl text-base text-muted-foreground">
          {intl.formatMessage({ id: 'auth.demo.subtitle' })}
        </p>
      </div>

      <Alert variant="warning">
        <AlertDescription>
          {intl.formatMessage({ id: 'auth.demo.isolationNotice' })}
        </AlertDescription>
      </Alert>

      {errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {profiles.map((profile) => {
          const meta = ROLE_META[profile.role];
          const Icon = meta.icon;
          const isCurrent = activeDemoRole === profile.role;
          const isLoading = loadingRole === profile.role;
          const roleName = intl.formatMessage({ id: meta.roleLabelId });

          return (
            <Card key={profile.role} className="flex flex-col justify-between">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  {isCurrent ? (
                    <Badge variant="demo">
                      {intl.formatMessage({ id: 'organizations.activeBadge' })}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{profile.role}</Badge>
                  )}
                </div>
                <CardTitle>{intl.formatMessage({ id: meta.titleId })}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {intl.formatMessage({ id: meta.descriptionId })}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">{profile.displayName}</p>
                  <p>
                    {intl.formatMessage(
                      { id: 'auth.demo.credentialsHint' },
                      { email: profile.email },
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-foreground/80">
                    {intl.formatMessage({ id: 'auth.common.passwordLabel' })}: {profile.password}
                  </p>
                </div>
              </CardContent>

              <CardFooter>
                <Button
                  type="button"
                  disabled={loadingRole !== null}
                  onClick={() => void onEnterProfile(profile.role)}
                  className="w-full"
                >
                  <IconSparkles className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {isLoading
                      ? intl.formatMessage({ id: 'auth.demo.entering' })
                      : intl.formatMessage({ id: 'auth.demo.enterButton' }, { role: roleName })}
                  </span>
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/login">
            <IconArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'auth.demo.backToLogin' })}</span>
          </Link>
        </Button>
      </div>
    </section>
  );
}
