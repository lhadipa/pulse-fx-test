import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HistoryWindow } from '@pulse-fx/shared';
import { SeriesChart } from '../components/SeriesChart.js';
import { StateMessage } from '../components/StateMessage.js';
import { VariationBadge } from '../components/VariationBadge.js';
import { useIndicator, useSeries } from '../hooks/useIndicators.js';
import {
  describeVariation,
  formatRefDate,
  formatRelativeTime,
  formatValue,
} from '../lib/format.js';

/** Janelas oferecidas por frequencia. 90 dias de serie mensal seriam 3 pontos. */
const WINDOWS: Record<'DAILY' | 'MONTHLY', HistoryWindow[]> = {
  DAILY: ['30d', '90d', '1y', '5y'],
  MONTHLY: ['1y', '5y', 'max'],
};

const WINDOW_LABEL: Record<HistoryWindow, string> = {
  '30d': '30 dias',
  '90d': '90 dias',
  '1y': '1 ano',
  '5y': '5 anos',
  max: 'Tudo',
};

export function IndicatorDetail(): JSX.Element {
  const { code = '' } = useParams<{ code: string }>();
  const [window, setWindow] = useState<HistoryWindow | undefined>(undefined);

  const indicatorQuery = useIndicator(code);
  const seriesQuery = useSeries(code, window);

  if (indicatorQuery.isPending) {
    return <div className="h-96 animate-pulse rounded-xl bg-slate-800/40" aria-hidden="true" />;
  }

  if (indicatorQuery.isError || !indicatorQuery.data) {
    return (
      <StateMessage
        title="Indicador nao encontrado"
        description={
          indicatorQuery.error instanceof Error ? indicatorQuery.error.message : undefined
        }
      />
    );
  }

  const indicator = indicatorQuery.data;
  const availableWindows = WINDOWS[indicator.frequency];
  const activeWindow = window ?? indicator.defaultWindow;

  return (
    <article className="flex flex-col gap-6">
      <Link
        to="/"
        className="w-fit text-sm text-sky-400 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
      >
        &larr; Voltar ao painel
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">{indicator.name}</h1>
          <p className="text-sm text-slate-400">
            Fonte: {indicator.source.replace('_', ' ')} &middot;{' '}
            {indicator.frequency === 'DAILY' ? 'serie diaria' : 'serie mensal'}
          </p>
        </div>

        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums text-slate-50">
            {indicator.latest
              ? formatValue(indicator.latest.value, indicator.unit, indicator.precision)
              : '--'}
          </p>
          <div className="mt-1 flex items-center justify-end gap-2">
            <VariationBadge
              variation={indicator.variation}
              description={describeVariation(indicator)}
              size="lg"
            />
          </div>
          {indicator.latest && (
            <p className="mt-1 text-xs text-slate-400">
              referencia:{' '}
              <time dateTime={indicator.latest.refDate}>
                {formatRefDate(indicator.latest.refDate)}
              </time>{' '}
              &middot; sincronizado {formatRelativeTime(indicator.lastSyncedAt)}
            </p>
          )}
        </div>
      </header>

      <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-100">Historico</h2>

          <div className="flex gap-1 rounded-lg border border-slate-700 p-1" role="group" aria-label="Janela de historico">
            {availableWindows.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setWindow(option)}
                aria-pressed={activeWindow === option}
                className={`rounded-md px-3 py-1 text-xs transition ${
                  activeWindow === option
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {WINDOW_LABEL[option]}
              </button>
            ))}
          </div>
        </div>

        {seriesQuery.isPending && (
          <div className="h-72 animate-pulse rounded-lg bg-slate-800/60" aria-hidden="true" />
        )}

        {seriesQuery.isError && (
          <StateMessage
            title="Nao foi possivel carregar a serie"
            onRetry={() => void seriesQuery.refetch()}
          />
        )}

        {seriesQuery.data && seriesQuery.data.observations.length === 0 && (
          <StateMessage
            title="Sem observacoes nesta janela"
            description="A serie pode ainda nao ter sido sincronizada, ou nao ter dado publicado no periodo."
          />
        )}

        {seriesQuery.data && seriesQuery.data.observations.length > 0 && (
          <>
            <SeriesChart
              observations={seriesQuery.data.observations}
              unit={indicator.unit}
              precision={indicator.precision}
            />

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-sky-400 hover:text-sky-300">
                Ver tabela ({seriesQuery.data.count} observacoes)
              </summary>
              <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800 text-left text-slate-300">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Data de referencia</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...seriesQuery.data.observations].reverse().map((observation) => (
                      <tr key={observation.refDate} className="border-t border-slate-700/60">
                        <td className="px-3 py-1.5 text-slate-300">
                          {formatRefDate(observation.refDate)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-100">
                          {formatValue(observation.value, indicator.unit, indicator.precision)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
          <h2 className="mb-2 font-semibold text-slate-100">Por que este indicador</h2>
          <p className="text-sm leading-relaxed text-slate-300">{indicator.rationale}</p>
        </section>

        {/* Exigido pelo briefing (secao 4.2): limitacoes dos dados visiveis. */}
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="mb-2 font-semibold text-amber-200">Limitacoes dos dados</h2>
          <p className="text-sm leading-relaxed text-slate-300">{indicator.limitations}</p>
          <a
            href={indicator.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300"
          >
            Documentacao oficial da fonte &rarr;
          </a>
        </section>
      </div>
    </article>
  );
}
