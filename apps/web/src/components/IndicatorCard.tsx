import { Link } from 'react-router-dom';
import type { IndicatorSummary } from '@pulse-fx/shared';
import {
  describeVariation,
  formatRefDate,
  formatRelativeTime,
  formatValue,
} from '../lib/format.js';
import { VariationBadge } from './VariationBadge.js';

interface Props {
  indicator: IndicatorSummary;
  onToggleFavorite: (code: string, isFavorite: boolean) => void;
}

/**
 * Card do dashboard (briefing, secao 4.1): nome, ultimo valor, data de
 * referencia e variacao percentual.
 *
 * A data de referencia e a hora da ultima sincronizacao aparecem como campos
 * SEPARADOS e rotulados. Sao coisas diferentes - o briefing avisa
 * explicitamente para nao confundi-las - e um dado de sexta-feira exibido no
 * domingo precisa deixar isso obvio.
 */
export function IndicatorCard({ indicator, onToggleFavorite }: Props): JSX.Element {
  const { latest, variation } = indicator;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4 transition hover:border-slate-500">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/indicadores/${indicator.code}`}
            className="block truncate font-semibold text-slate-100 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
          >
            {indicator.shortName}
          </Link>
          <p className="truncate text-xs text-slate-400" title={indicator.name}>
            {indicator.name}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggleFavorite(indicator.code, indicator.isFavorite)}
          aria-pressed={indicator.isFavorite}
          aria-label={
            indicator.isFavorite
              ? `Remover ${indicator.shortName} dos meus indicadores`
              : `Adicionar ${indicator.shortName} aos meus indicadores`
          }
          className="shrink-0 rounded p-1 text-lg leading-none transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <span aria-hidden="true" className={indicator.isFavorite ? 'text-amber-400' : 'text-slate-600'}>
            {indicator.isFavorite ? '★' : '☆'}
          </span>
        </button>
      </header>

      <div>
        <p className="text-2xl font-bold tabular-nums text-slate-50">
          {latest ? formatValue(latest.value, indicator.unit, indicator.precision) : '--'}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <VariationBadge variation={variation} description={describeVariation(indicator)} />
          {latest && (
            <span className="text-xs text-slate-400">
              referencia: <time dateTime={latest.refDate}>{formatRefDate(latest.refDate)}</time>
            </span>
          )}
        </div>
      </div>

      <footer className="mt-auto border-t border-slate-700/60 pt-2 text-[11px] text-slate-500">
        sincronizado {formatRelativeTime(indicator.lastSyncedAt)}
      </footer>
    </article>
  );
}
