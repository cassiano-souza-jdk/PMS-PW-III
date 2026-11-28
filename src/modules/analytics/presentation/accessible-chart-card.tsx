import { IconTable } from '@tabler/icons-react';
import { useId, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Button, Card, CardContent, CardDescription, CardHeader } from '@/shared/ui';
import type { AnalyticsChartDataRow } from '../application/contracts';

export interface AccessibleChartCardProps {
  readonly title: string;
  readonly description?: string;
  readonly textSummary: string;
  readonly rows: readonly AnalyticsChartDataRow[];
  readonly emptyMessage: string;
  readonly dimensionColumnLabel?: string;
  readonly valueColumnLabel?: string;
  readonly badge?: ReactNode;
  readonly defaultShowTable?: boolean;
  readonly children: ReactNode;
}

export function AccessibleChartCard({
  title,
  description,
  textSummary,
  rows,
  emptyMessage,
  dimensionColumnLabel,
  valueColumnLabel,
  badge,
  defaultShowTable = true,
  children,
}: AccessibleChartCardProps) {
  const intl = useIntl();
  const [showTable, setShowTable] = useState<boolean>(defaultShowTable);
  const tableRegionId = useId();
  const headingId = useId();

  const resolvedDimensionLabel =
    dimensionColumnLabel ?? intl.formatMessage({ id: 'analytics.a11y.tableDimensionColumn' });
  const resolvedValueLabel =
    valueColumnLabel ?? intl.formatMessage({ id: 'analytics.a11y.tableValueColumn' });

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h3 id={headingId} className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </h3>
            {description !== undefined ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {badge}
        </div>
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage(
            { id: 'analytics.a11y.chartTextSummaryLabel' },
            { summary: textSummary },
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <>
            <div role="img" aria-labelledby={headingId} className="w-full overflow-x-auto">
              {children}
            </div>

            <div className="space-y-3 border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={showTable}
                aria-controls={tableRegionId}
                onClick={() => setShowTable((prev) => !prev)}
                className="min-h-[44px] gap-2"
              >
                <IconTable className="h-4 w-4" aria-hidden="true" />
                <span>
                  {intl.formatMessage({
                    id: showTable
                      ? 'analytics.a11y.chartDataTableToggleHide'
                      : 'analytics.a11y.chartDataTableToggleShow',
                  })}
                </span>
              </Button>

              {showTable ? (
                <div id={tableRegionId} className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full border-collapse text-left text-sm">
                    <caption className="sr-only">
                      {`${title} — ${intl.formatMessage({ id: 'analytics.a11y.chartDataTableTitle' })}`}
                    </caption>
                    <thead className="bg-muted/50">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                          {resolvedDimensionLabel}
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-semibold text-foreground"
                        >
                          {resolvedValueLabel}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-t border-border">
                          <td className="px-3 py-2 text-foreground">{row.label}</td>
                          <td className="px-3 py-2 text-right font-medium text-foreground">
                            {row.formattedValue ?? intl.formatNumber(row.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
