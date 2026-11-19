import { IconAccessible, IconLanguage, IconLayersLinked, IconTerminal2 } from '@tabler/icons-react';
import { useIntl } from 'react-intl';
import { useComposition } from '@/app/composition';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui';

export function FoundationHomePage() {
  const intl = useIntl();
  const { env } = useComposition();

  const pillars = [
    {
      id: 'architecture',
      icon: IconLayersLinked,
      title: intl.formatMessage({ id: 'foundation.card.architecture.title' }),
      description: intl.formatMessage({ id: 'foundation.card.architecture.description' }),
    },
    {
      id: 'accessibility',
      icon: IconAccessible,
      title: intl.formatMessage({ id: 'foundation.card.accessibility.title' }),
      description: intl.formatMessage({ id: 'foundation.card.accessibility.description' }),
    },
    {
      id: 'i18n',
      icon: IconLanguage,
      title: intl.formatMessage({ id: 'foundation.card.i18n.title' }),
      description: intl.formatMessage({ id: 'foundation.card.i18n.description' }),
    },
    {
      id: 'runtime',
      icon: IconTerminal2,
      title: intl.formatMessage({ id: 'foundation.card.runtime.title' }),
      description: intl.formatMessage(
        { id: 'foundation.card.runtime.description' },
        {
          env: env.VITE_APP_ENV,
          version: env.VITE_APP_VERSION,
          logLevel: env.VITE_LOG_LEVEL,
        },
      ),
    },
  ] as const;

  return (
    <section aria-labelledby="foundation-heading" className="space-y-8">
      <div className="space-y-3">
        <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {intl.formatMessage({ id: 'foundation.statusBadge' })}
        </span>
        <h1
          id="foundation-heading"
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
        >
          {intl.formatMessage({ id: 'foundation.title' })}
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          {intl.formatMessage({ id: 'foundation.subtitle' })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pillars.map((pillar) => {
          const Icon = pillar.icon;

          return (
            <Card key={pillar.id}>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <CardTitle>{pillar.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {pillar.description}
                </CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export default FoundationHomePage;
