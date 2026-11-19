import { IconDeviceDesktop, IconLayoutKanban, IconMoon, IconSun } from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { Link, NavLink, Outlet } from 'react-router';
import { useComposition } from '@/app/composition';
import { useTheme, type ThemePreference } from '@/app/providers';
import type { MessageId } from '@/shared/i18n';
import { Button, cn } from '@/shared/ui';

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

export function AppShell() {
  const intl = useIntl();
  const { env } = useComposition();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg"
      >
        {intl.formatMessage({ id: 'app.skipToMain' })}
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container flex min-h-16 flex-wrap items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md px-2 text-base font-bold tracking-tight text-foreground hover:text-primary"
            >
              <IconLayoutKanban className="h-6 w-6 text-primary" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'app.shortName' })}</span>
            </Link>

            <nav aria-label={intl.formatMessage({ id: 'nav.primaryLabel' })}>
              <ul className="flex items-center gap-2">
                <li>
                  <NavLink
                    to="/"
                    end
                    className={({ isActive }) =>
                      cn(
                        'inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-secondary font-semibold text-secondary-foreground underline decoration-2 underline-offset-4'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )
                    }
                  >
                    {intl.formatMessage({ id: 'nav.foundation' })}
                  </NavLink>
                </li>
              </ul>
            </nav>
          </div>

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
