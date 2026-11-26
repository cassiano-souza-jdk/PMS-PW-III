import {
  IconAlertTriangle,
  IconBuilding,
  IconDeviceDesktop,
  IconLayoutKanban,
  IconLogout,
  IconMoon,
  IconSun,
  IconUserCircle,
} from '@tabler/icons-react';
import type { ChangeEvent } from 'react';
import { useIntl } from 'react-intl';
import { Link, NavLink, Outlet } from 'react-router';
import { useComposition } from '@/app/composition';
import {
  useAuth,
  useOrganization,
  usePermission,
  useTheme,
  type ThemePreference,
} from '@/app/providers';
import { PERMISSION_CODES } from '@/modules/authorization';
import type { MessageId } from '@/shared/i18n';
import type { OrganizationRole } from '@/shared/kernel';
import { Badge, Button, cn } from '@/shared/ui';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly labelId: MessageId;
  readonly icon: typeof IconSun;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', labelId: 'theme.light', icon: IconSun },
  { value: 'dark', labelId: 'theme.dark', icon: IconMoon },
  { value: 'system', labelId: 'theme.system', icon: IconDeviceDesktop },
];

const ROLE_LABEL_ID_BY_CODE: Record<OrganizationRole, MessageId> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

function navLinkClassName({ isActive }: { readonly isActive: boolean }): string {
  return cn(
    'inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-secondary font-semibold text-secondary-foreground underline decoration-2 underline-offset-4'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  );
}

export function AppShell() {
  const intl = useIntl();
  const { env } = useComposition();
  const { theme, setTheme } = useTheme();
  const { isAuthenticated, user, logout } = useAuth();
  const {
    organizations,
    activeOrganization,
    activeOrganizationId,
    isLoading: isLoadingOrganizations,
    isDemoOrganization,
    selectOrganization,
  } = useOrganization();
  const { can } = usePermission();

  const canViewOrganizationSettings = isAuthenticated && can(PERMISSION_CODES.ORGANIZATION_VIEW);
  const canViewFocus =
    isAuthenticated &&
    user !== null &&
    activeOrganization !== null &&
    can(PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE, {
      kind: 'FOCUS',
      ownerUserId: user.id,
    });
  const canViewBottlenecks =
    isAuthenticated &&
    user !== null &&
    activeOrganization !== null &&
    (can(PERMISSION_CODES.BOTTLENECK_VIEW) ||
      can(PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW, {
        kind: 'BOTTLENECK',
        ownerUserId: user.id,
      }));
  const canViewFeedback =
    isAuthenticated &&
    user !== null &&
    activeOrganization !== null &&
    (can(PERMISSION_CODES.FEEDBACK_CREATE) ||
      can(PERMISSION_CODES.FEEDBACK_VIEW, {
        kind: 'FEEDBACK',
        createdBy: user.id,
      }) ||
      can(PERMISSION_CODES.FEEDBACK_VIEW, {
        kind: 'FEEDBACK',
        assigneeId: user.id,
      }) ||
      can(PERMISSION_CODES.FEEDBACK_VIEW));

  const handleOrganizationChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = organizations.find((org) => org.id === event.target.value);
    if (selected !== undefined) {
      selectOrganization(selected.id);
    }
  };

  const handleLogout = () => {
    void logout(activeOrganizationId ?? undefined);
  };

  const activeRoleLabel =
    activeOrganization !== null
      ? intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[activeOrganization.role] })
      : '';

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg"
      >
        {intl.formatMessage({ id: 'app.skipToMain' })}
      </a>

      {isDemoOrganization && activeOrganization !== null ? (
        <div
          role="region"
          aria-label={intl.formatMessage({ id: 'demoBanner.regionLabel' })}
          className="border-b-2 border-amber-700 bg-amber-100 text-slate-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-50"
        >
          <div className="container flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2.5">
              <IconAlertTriangle
                className="h-5 w-5 shrink-0 text-amber-900 dark:text-amber-300"
                aria-hidden="true"
              />
              <Badge variant="demo">{intl.formatMessage({ id: 'demoBanner.badge' })}</Badge>
              <span className="font-semibold">
                {intl.formatMessage(
                  { id: 'demoBanner.activeProfile' },
                  {
                    role: activeRoleLabel,
                    roleCode: activeOrganization.role,
                  },
                )}
              </span>
              <span className="hidden text-xs md:inline">
                {intl.formatMessage({ id: 'demoBanner.description' })}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/demo"
                className="inline-flex min-h-[40px] items-center rounded-md border border-amber-900 bg-amber-200 px-3 py-1.5 text-xs font-semibold text-slate-950 underline-offset-4 hover:bg-amber-300 hover:underline dark:border-amber-300 dark:bg-amber-900 dark:text-amber-50 dark:hover:bg-amber-800"
              >
                {intl.formatMessage({ id: 'demoBanner.switchProfile' })}
              </Link>
              <Link
                to="/organizations"
                className="inline-flex min-h-[40px] items-center rounded-md border border-amber-900/60 bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground underline-offset-4 hover:bg-background hover:underline dark:border-amber-300/60 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900"
              >
                {intl.formatMessage({ id: 'demoBanner.manageOrganizations' })}
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container flex min-h-16 flex-wrap items-center justify-between gap-4 py-2">
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md px-2 text-base font-bold tracking-tight text-foreground hover:text-primary"
            >
              <IconLayoutKanban className="h-6 w-6 text-primary" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'app.shortName' })}</span>
            </Link>

            <nav aria-label={intl.formatMessage({ id: 'nav.primaryLabel' })}>
              <ul className="flex flex-wrap items-center gap-1.5">
                {isAuthenticated ? (
                  <>
                    <li>
                      <NavLink to="/" end className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.home' })}
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/organizations" className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.organizations' })}
                      </NavLink>
                    </li>
                    {activeOrganization !== null ? (
                      <li>
                        <NavLink to="/teams" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.teams' })}
                        </NavLink>
                      </li>
                    ) : null}
                    {activeOrganization !== null ? (
                      <li>
                        <NavLink to="/projects" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.projects' })}
                        </NavLink>
                      </li>
                    ) : null}
                    {canViewFocus ? (
                      <li>
                        <NavLink to="/focus" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.focus' })}
                        </NavLink>
                      </li>
                    ) : null}
                    {canViewBottlenecks ? (
                      <li>
                        <NavLink to="/bottlenecks" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.bottlenecks' })}
                        </NavLink>
                      </li>
                    ) : null}
                    {canViewFeedback ? (
                      <li>
                        <NavLink to="/feedback" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.feedback' })}
                        </NavLink>
                      </li>
                    ) : null}
                    <li>
                      <NavLink to="/invitations" className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.invitations' })}
                      </NavLink>
                    </li>
                    {activeOrganization !== null ? (
                      <li>
                        <NavLink to="/permissions" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.permissions' })}
                        </NavLink>
                      </li>
                    ) : null}
                    <li>
                      <NavLink to="/profile" className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.profile' })}
                      </NavLink>
                    </li>
                    {canViewOrganizationSettings ? (
                      <li>
                        <NavLink to="/settings" className={navLinkClassName}>
                          {intl.formatMessage({ id: 'nav.settings' })}
                        </NavLink>
                      </li>
                    ) : null}
                  </>
                ) : (
                  <>
                    <li>
                      <NavLink to="/" end className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.foundation' })}
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/login" className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.login' })}
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/register" className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.register' })}
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/demo" className={navLinkClassName}>
                        {intl.formatMessage({ id: 'nav.demo' })}
                      </NavLink>
                    </li>
                  </>
                )}
              </ul>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isAuthenticated && user !== null ? (
              <div
                aria-label={intl.formatMessage({ id: 'nav.accountRegionLabel' })}
                className="flex flex-wrap items-center gap-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <IconBuilding
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <label htmlFor="active-organization-select" className="sr-only">
                    {intl.formatMessage({ id: 'orgSwitcher.label' })}
                  </label>
                  <select
                    id="active-organization-select"
                    value={activeOrganizationId ?? ''}
                    onChange={handleOrganizationChange}
                    disabled={isLoadingOrganizations || organizations.length === 0}
                    className="min-h-[44px] max-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {organizations.length === 0 ? (
                      <option value="">
                        {intl.formatMessage({
                          id: isLoadingOrganizations ? 'orgSwitcher.loading' : 'orgSwitcher.empty',
                        })}
                      </option>
                    ) : (
                      organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.isDemo
                            ? `${org.name} ${intl.formatMessage({ id: 'orgSwitcher.demoSuffix' })}`
                            : org.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
                  <IconUserCircle
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span
                    className="max-w-[160px] truncate font-medium text-foreground"
                    title={intl.formatMessage({ id: 'nav.signedInAs' }, { name: user.displayName })}
                  >
                    {user.displayName}
                  </span>
                </div>

                <Button size="sm" variant="outline" onClick={handleLogout} className="gap-1.5">
                  <IconLogout className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'nav.logout' })}</span>
                </Button>
              </div>
            ) : null}

            <div
              role="group"
              aria-label={intl.formatMessage({ id: 'theme.switcherLabel' })}
              className="inline-flex items-center gap-1 rounded-lg border bg-muted/50 p-1"
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = theme === option.value;
                const label = intl.formatMessage({ id: option.labelId });

                return (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={isSelected ? 'default' : 'ghost'}
                    aria-pressed={isSelected}
                    onClick={() => setTheme(option.value)}
                    className="gap-1.5"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{label}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="container flex-1 py-8 focus:outline-none">
        <Outlet />
      </main>

      <footer className="border-t bg-muted/40">
        <div className="container flex flex-col gap-2 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{intl.formatMessage({ id: 'footer.prototypeNotice' })}</p>
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
            <span>
              {intl.formatMessage({ id: 'footer.version' }, { version: env.VITE_APP_VERSION })}
            </span>
            <span>
              {intl.formatMessage({ id: 'footer.environment' }, { env: env.VITE_APP_ENV })}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
